/**
 * Executor — Buddy 2.0
 * 
 * Recebe um plano do Planner e executa step-by-step.
 * - Injeta contexto de steps anteriores nos próximos
 * - Chama Error Handler em caso de falha
 * - Pode re-planejar até 2x via Planner
 * - Sumariza resultado final via LLM
 * - Emite eventos para a UI (progresso, status)
 * 
 * @module agent/executor
 */

const { EventEmitter } = require('events');
const { getToolRegistry } = require('./tool-registry');
const { DECISIONS } = require('./error-handler');

// ============================================================
// CONSTANTES
// ============================================================
const EXECUTOR_MODEL = 'gpt-4o-mini';
const MAX_REPLANS = 2;
const STEP_TIMEOUT_MS = 60000; // 60s por step
const RESULT_TRUNCATE = 3000; // Truncar resultado de tool

/** Status possíveis de uma task */
const TASK_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

/** Prompt para sumarizar o resultado final */
const SUMMARY_PROMPT = `Você é o Buddy, um assistente de desktop simpático.
Resuma o resultado da tarefa abaixo em 2-3 frases curtas para o usuário.
Use tom casual, pt-BR, com 1-2 emojis.
Se houve erros parciais, mencione brevemente o que funcionou e o que não.
Retorne APENAS o texto do resumo, sem JSON.`;

class Executor extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Function} options.callLLM - Função async (messages, model) => string
   * @param {Object} options.planner - Instância do Planner
   * @param {Object} options.errorHandler - Instância do ErrorHandler
   * @param {string} [options.model] - Modelo para sumarização
   */
  constructor(options = {}) {
    super();

    if (!options.callLLM) throw new Error('[Executor] Precisa de callLLM');
    if (!options.planner) throw new Error('[Executor] Precisa de planner');
    if (!options.errorHandler) throw new Error('[Executor] Precisa de errorHandler');

    this._callLLM = options.callLLM;
    this._planner = options.planner;
    this._errorHandler = options.errorHandler;
    this._model = options.model || EXECUTOR_MODEL;
    this._registry = getToolRegistry();

    /** @type {Map<string, boolean>} Flags de cancelamento por taskId */
    this._cancelFlags = new Map();
  }

  /**
   * Executa um plano completo.
   * 
   * @param {Object} plan - Plano gerado pelo Planner
   * @param {string} taskId - ID único da task
   * @param {Object} [context={}] - Contexto extra (memória, etc)
   * @returns {Promise<ExecutionResult>}
   */
  async execute(plan, taskId, context = {}) {
    console.log(`[Executor] Iniciando task ${taskId}: "${plan.goal}" (${plan.steps.length} steps)`);

    this._cancelFlags.set(taskId, false);
    let currentPlan = plan;
    let replanCount = 0;
    let allResults = []; // Acumula resultados de todos os steps (incluindo replans)

    this.emit('task-start', { taskId, goal: plan.goal, totalSteps: plan.steps.length });

    try {
      while (replanCount <= MAX_REPLANS) {
        const result = await this._executePlan(currentPlan, taskId, allResults, context);

        if (result.status === 'completed' || result.status === 'cancelled') {
          // Plano completou ou foi cancelado
          const summary = await this._summarize(plan.goal, allResults);
          const finalResult = {
            taskId,
            goal: plan.goal,
            status: result.status,
            steps: allResults,
            summary,
            replans: replanCount,
            duration_ms: result.duration_ms
          };
          this.emit('task-end', finalResult);
          this._cancelFlags.delete(taskId);
          this._errorHandler.resetTask(taskId);
          return finalResult;
        }

        if (result.status === 'needs_replan') {
          replanCount++;
          console.log(`[Executor] Re-planejando (${replanCount}/${MAX_REPLANS}): ${result.replanReason}`);
          this.emit('task-replan', { taskId, replanCount, reason: result.replanReason });

          // Formata resultados anteriores como contexto
          const prevResults = allResults
            .map(r => `Step "${r.description}": ${r.status} → ${String(r.result || r.error).substring(0, 200)}`)
            .join('\n');

          currentPlan = await this._planner.createPlan(plan.goal, {
            previousResults: prevResults,
            errorInfo: result.replanReason,
            userMemory: context.userMemory
          });

          // Se planner retornou plano vazio ou fallback, aborta
          if (!currentPlan.steps || currentPlan.steps.length === 0) {
            const summary = await this._summarize(plan.goal, allResults);
            const finalResult = {
              taskId, goal: plan.goal, status: TASK_STATUS.FAILED,
              steps: allResults, summary,
              replans: replanCount, error: 'Re-planejamento não gerou novos steps'
            };
            this.emit('task-end', finalResult);
            this._cancelFlags.delete(taskId);
            this._errorHandler.resetTask(taskId);
            return finalResult;
          }
          continue;
        }

        // status === 'aborted'
        const summary = await this._summarize(plan.goal, allResults);
        const finalResult = {
          taskId, goal: plan.goal, status: TASK_STATUS.FAILED,
          steps: allResults, summary,
          replans: replanCount, error: result.abortReason
        };
        this.emit('task-end', finalResult);
        this._cancelFlags.delete(taskId);
        this._errorHandler.resetTask(taskId);
        return finalResult;
      }

      // Esgotou replans
      const summary = await this._summarize(plan.goal, allResults);
      const finalResult = {
        taskId, goal: plan.goal, status: TASK_STATUS.FAILED,
        steps: allResults, summary,
        replans: replanCount, error: 'Máximo de re-planejamentos atingido'
      };
      this.emit('task-end', finalResult);
      this._cancelFlags.delete(taskId);
      this._errorHandler.resetTask(taskId);
      return finalResult;

    } catch (err) {
      console.error(`[Executor] Erro fatal na task ${taskId}:`, err.message);
      const finalResult = {
        taskId, goal: plan.goal, status: TASK_STATUS.FAILED,
        steps: allResults, summary: `Erro inesperado: ${err.message}`,
        replans: replanCount, error: err.message
      };
      this.emit('task-end', finalResult);
      this._cancelFlags.delete(taskId);
      this._errorHandler.resetTask(taskId);
      return finalResult;
    }
  }

  /**
   * Executa os steps de um plano sequencialmente.
   * @private
   * @returns {Object} { status: 'completed'|'needs_replan'|'aborted'|'cancelled', ... }
   */
  async _executePlan(plan, taskId, allResults, context) {
    const startTime = Date.now();
    const stepResults = {}; // index → resultado (para injeção de contexto)

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];

      // Checa cancelamento
      if (this._cancelFlags.get(taskId)) {
        console.log(`[Executor] Task ${taskId} cancelada no step ${i}`);
        step.status = 'cancelled';
        allResults.push({ ...step, status: 'cancelled' });
        return { status: 'cancelled', duration_ms: Date.now() - startTime };
      }

      this.emit('step-start', {
        taskId, stepIndex: i, totalSteps: plan.steps.length,
        tool: step.tool, description: step.description
      });

      // Verifica dependência
      if (step.depends_on !== null && step.depends_on !== undefined) {
        const depResult = stepResults[step.depends_on];
        if (!depResult) {
          console.warn(`[Executor] Step ${i} depende de ${step.depends_on} que não completou`);
          // Injeta info de que dependência falhou
          step.args = this._injectContext(step.args, `[Dependência step ${step.depends_on} não disponível]`);
        } else {
          step.args = this._injectContext(step.args, depResult);
        }
      }

      // Executa o step
      try {
        const tool = this._registry.get(step.tool);
        if (!tool) {
          throw new Error(`Tool "${step.tool}" não encontrada no registry`);
        }

        console.log(`[Executor] Step ${i}/${plan.steps.length - 1}: ${step.tool} — ${step.description}`);

        // Executa com timeout
        const result = await this._executeWithTimeout(tool.execute, step.args, STEP_TIMEOUT_MS);
        const truncated = this._truncateResult(result);

        step.status = 'completed';
        stepResults[i] = truncated;
        allResults.push({ ...step, status: 'completed', result: truncated });

        this.emit('step-end', {
          taskId, stepIndex: i, tool: step.tool,
          status: 'completed', result: truncated
        });

      } catch (err) {
        console.error(`[Executor] Step ${i} falhou:`, err.message);

        this.emit('step-error', {
          taskId, stepIndex: i, tool: step.tool, error: err.message
        });

        // Chama Error Handler
        const decision = await this._errorHandler.analyze({
          step,
          error: err.message,
          taskId,
          planContext: {
            goal: plan.goal,
            completedSteps: allResults.filter(r => r.status === 'completed').length
          }
        });

        console.log(`[Executor] Error Handler decidiu: ${decision.decision} — ${decision.reason}`);
        this.emit('step-decision', { taskId, stepIndex: i, decision });

        switch (decision.decision) {
          case DECISIONS.RETRY:
            // Decrementa i para repetir o step
            console.log(`[Executor] Retrying step ${i}...`);
            allResults.push({ ...step, status: 'retrying', error: err.message });
            i--; // O for vai incrementar de volta
            continue;

          case DECISIONS.SKIP:
            console.log(`[Executor] Skipping step ${i}`);
            step.status = 'skipped';
            allResults.push({ ...step, status: 'skipped', error: err.message });
            this.emit('step-end', { taskId, stepIndex: i, tool: step.tool, status: 'skipped' });
            continue;

          case DECISIONS.REPLAN:
            step.status = 'failed';
            allResults.push({ ...step, status: 'failed', error: err.message });
            return {
              status: 'needs_replan',
              replanReason: `${decision.reason}. Sugestão: ${decision.suggestion}`,
              duration_ms: Date.now() - startTime
            };

          case DECISIONS.ABORT:
          default:
            step.status = 'failed';
            allResults.push({ ...step, status: 'failed', error: err.message });
            return {
              status: 'aborted',
              abortReason: decision.reason,
              duration_ms: Date.now() - startTime
            };
        }
      }
    }

    return { status: 'completed', duration_ms: Date.now() - startTime };
  }

  // ============================================================
  // HELPERS
  // ============================================================

  /**
   * Executa uma função com timeout.
   * @private
   */
  _executeWithTimeout(fn, args, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout: step excedeu ${timeoutMs}ms`));
      }, timeoutMs);

      Promise.resolve(fn(args))
        .then(result => { clearTimeout(timer); resolve(result); })
        .catch(err => { clearTimeout(timer); reject(err); });
    });
  }

  /**
   * Trunca resultado de tool para não estourar contexto.
   * @private
   */
  _truncateResult(result) {
    if (result === null || result === undefined) return '';
    const str = typeof result === 'string' ? result : JSON.stringify(result);
    if (str.length <= RESULT_TRUNCATE) return str;
    return str.substring(0, RESULT_TRUNCATE) + `\n... (truncado, ${str.length} chars total)`;
  }

  /**
   * Injeta resultado de step anterior nos args do step atual.
   * Se args tem campos com placeholder {{previous}}, substitui.
   * Caso contrário, adiciona como _context.
   * @private
   */
  _injectContext(args, previousResult) {
    const injected = { ...args };
    const resultStr = typeof previousResult === 'string'
      ? previousResult : JSON.stringify(previousResult);

    // Substitui placeholders {{previous}} nos valores string
    for (const [key, value] of Object.entries(injected)) {
      if (typeof value === 'string' && value.includes('{{previous}}')) {
        injected[key] = value.replace(/\{\{previous\}\}/g, resultStr);
      }
    }

    // Adiciona como _context para referência
    injected._context = resultStr.substring(0, 1000);
    return injected;
  }

  /**
   * Sumariza o resultado final da task via LLM.
   * @private
   */
  async _summarize(goal, results) {
    try {
      const stepsInfo = results.map(r =>
        `- ${r.description}: ${r.status}${r.result ? ' → ' + String(r.result).substring(0, 150) : ''}${r.error ? ' (erro: ' + r.error + ')' : ''}`
      ).join('\n');

      const messages = [
        { role: 'system', content: SUMMARY_PROMPT },
        { role: 'user', content: `OBJETIVO: ${goal}\n\nRESULTADO DOS PASSOS:\n${stepsInfo}` }
      ];

      return await this._callLLM(messages, this._model);
    } catch (err) {
      console.error('[Executor] Erro ao sumarizar:', err.message);
      // Fallback sem LLM
      const completed = results.filter(r => r.status === 'completed').length;
      const total = results.length;
      return `Completei ${completed}/${total} passos da tarefa "${goal}" ✅`;
    }
  }

  /**
   * Cancela uma task em andamento.
   * @param {string} taskId
   */
  cancel(taskId) {
    this._cancelFlags.set(taskId, true);
    console.log(`[Executor] Cancelamento solicitado para task ${taskId}`);
    this.emit('task-cancel', { taskId });
  }

  /**
   * Verifica se uma task foi cancelada.
   * @param {string} taskId
   * @returns {boolean}
   */
  isCancelled(taskId) {
    return this._cancelFlags.get(taskId) === true;
  }
}

module.exports = { Executor, TASK_STATUS };
