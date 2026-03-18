/**
 * Error Handler — Buddy 2.0
 * 
 * Analisa erros de cada step via LLM e decide a ação:
 * - RETRY: Erro transiente, tentar de novo (mesmo step, mesmos args)
 * - SKIP: Step não-crítico, pular e continuar
 * - REPLAN: Abordagem errada, precisa re-planejar com sugestão de fix
 * - ABORT: Impossível continuar, abortar o plano inteiro
 * 
 * @module agent/error-handler
 */

const ERROR_HANDLER_MODEL = 'gpt-4o-mini';
const MAX_RETRIES_PER_STEP = 2;
const MAX_REPLANS_PER_TASK = 2;

/** Decisões possíveis do error handler */
const DECISIONS = {
  RETRY: 'RETRY',
  SKIP: 'SKIP',
  REPLAN: 'REPLAN',
  ABORT: 'ABORT'
};

/** Padrões de erro conhecidos (heurística rápida antes de chamar LLM) */
const ERROR_PATTERNS = {
  transient: [
    /ECONNRESET/i,
    /ETIMEDOUT/i,
    /ECONNREFUSED/i,
    /socket hang up/i,
    /rate limit/i,
    /429/,
    /503/,
    /timeout/i,
    /EBUSY/i
  ],
  permission: [
    /EACCES/i,
    /EPERM/i,
    /permission denied/i,
    /access denied/i
  ],
  notFound: [
    /ENOENT/i,
    /not found/i,
    /no such file/i,
    /does not exist/i,
    /não encontrad/i
  ],
  fatal: [
    /ENOMEM/i,
    /out of memory/i,
    /disk full/i,
    /ENOSPC/i
  ]
};

const ERROR_HANDLER_PROMPT = `Você é um analisador de erros para um agente de desktop chamado Buddy.

Analise o erro abaixo e decida a melhor ação:

DECISÕES POSSÍVEIS:
- RETRY: Erro temporário/transiente. Tentar de novo pode funcionar. Ex: timeout, rate limit, conexão recusada.
- SKIP: O step falhou mas NÃO é crítico. Pode pular e continuar o plano. Ex: falha ao anotar log, erro em step opcional.
- REPLAN: A abordagem está errada. Precisa re-planejar com estratégia diferente. Ex: arquivo não existe, comando errado, caminho incorreto. Forneça sugestão de fix.
- ABORT: Impossível continuar. Ex: sem permissão, disco cheio, erro fatal irrecuperável.

REGRAS:
1. Se o step é marcado como "critical" e falhou de forma não-recuperável → ABORT
2. Se o step NÃO é critical e falhou → prefira SKIP
3. Se o erro parece transiente (timeout, rate limit) → RETRY
4. Se o erro indica abordagem errada (arquivo não encontrado, comando inválido) → REPLAN com sugestão
5. Máximo de retries já feitos? Se sim, escale para REPLAN ou ABORT

FORMATO DE RESPOSTA (JSON puro, sem markdown):
{
  "decision": "RETRY|SKIP|REPLAN|ABORT",
  "reason": "Explicação curta do motivo",
  "suggestion": "Sugestão de fix (obrigatório para REPLAN, null para outros)",
  "user_message": "Mensagem amigável para mostrar ao usuário (1 frase, com emoji)"
}

IMPORTANTE: Retorne APENAS o JSON.`;

class ErrorHandler {
  /**
   * @param {Object} options
   * @param {Function} options.callLLM - Função async (messages, model) => string
   * @param {string} [options.model] - Modelo a usar
   */
  constructor(options = {}) {
    if (!options.callLLM || typeof options.callLLM !== 'function') {
      throw new Error('[ErrorHandler] Precisa de uma função callLLM');
    }

    this._callLLM = options.callLLM;
    this._model = options.model || ERROR_HANDLER_MODEL;

    /** @type {Map<string, number>} Contagem de retries por step (key: "taskId:stepIndex") */
    this._retryCount = new Map();

    /** @type {Map<string, number>} Contagem de replans por task */
    this._replanCount = new Map();
  }

  /**
   * Tenta classificar o erro por padrões conhecidos (sem LLM).
   * @param {string} errorMsg
   * @returns {string|null} Categoria ou null se desconhecido
   */
  _quickClassify(errorMsg) {
    const msg = String(errorMsg);
    for (const [category, patterns] of Object.entries(ERROR_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(msg)) return category;
      }
    }
    return null;
  }

  /**
   * Analisa um erro e decide a ação.
   * 
   * @param {Object} params
   * @param {Object} params.step - O step que falhou
   * @param {string} params.error - Mensagem de erro
   * @param {string} params.taskId - ID da task (para tracking de retries/replans)
   * @param {Object} [params.planContext] - Contexto do plano (goal, steps anteriores)
   * @returns {Promise<ErrorDecision>}
   */
  async analyze({ step, error, taskId, planContext = {} }) {
    const errorMsg = String(error);
    const stepIdx = step.index ?? 0;
    const retryKey = `${taskId}:${stepIdx}`;
    const currentRetries = this._retryCount.get(retryKey) || 0;
    const currentReplans = this._replanCount.get(taskId) || 0;

    console.log(`[ErrorHandler] Analisando erro no step ${stepIdx} (tool: ${step.tool}): ${errorMsg.substring(0, 100)}`);
    console.log(`[ErrorHandler] Retries: ${currentRetries}/${MAX_RETRIES_PER_STEP}, Replans: ${currentReplans}/${MAX_REPLANS_PER_TASK}`);

    // === HEURÍSTICA RÁPIDA (sem LLM) ===
    const quickCategory = this._quickClassify(errorMsg);

    if (quickCategory === 'fatal') {
      return this._buildDecision(DECISIONS.ABORT, 'Erro fatal detectado', null, 
        'Encontrei um problema grave que não consigo contornar 😰', taskId, retryKey);
    }

    if (quickCategory === 'transient' && currentRetries < MAX_RETRIES_PER_STEP) {
      this._retryCount.set(retryKey, currentRetries + 1);
      return this._buildDecision(DECISIONS.RETRY, `Erro transiente (${quickCategory}), tentando de novo`,
        null, 'Deu um errinho temporário, tentando de novo... 🔄', taskId, retryKey);
    }

    // Se já esgotou retries e é transiente, escala
    if (quickCategory === 'transient' && currentRetries >= MAX_RETRIES_PER_STEP) {
      if (!step.critical) {
        return this._buildDecision(DECISIONS.SKIP, 'Retries esgotados em step não-crítico',
          null, 'Não consegui completar esse passo, mas vou continuar ⏭️', taskId, retryKey);
      }
      if (currentReplans < MAX_REPLANS_PER_TASK) {
        return this._buildDecision(DECISIONS.REPLAN, 'Retries esgotados, precisa de abordagem diferente',
          'Tentar com timeout maior ou ferramenta alternativa', 'Preciso repensar a estratégia aqui 🤔', taskId, retryKey);
      }
      return this._buildDecision(DECISIONS.ABORT, 'Retries e replans esgotados',
        null, 'Tentei de tudo mas não consegui resolver 😓', taskId, retryKey);
    }

    // Se não-crítico e erro de notFound/permission → SKIP rápido
    if (!step.critical && (quickCategory === 'notFound' || quickCategory === 'permission')) {
      return this._buildDecision(DECISIONS.SKIP, `Erro ${quickCategory} em step não-crítico`,
        null, 'Passo opcional falhou, seguindo em frente ⏭️', taskId, retryKey);
    }

    // === ANÁLISE VIA LLM (para casos ambíguos) ===
    try {
      const decision = await this._analyzeLLM({ step, error: errorMsg, taskId, planContext, currentRetries, currentReplans });
      return decision;
    } catch (llmError) {
      console.error('[ErrorHandler] LLM falhou, usando fallback:', llmError.message);
      return this._fallbackDecision(step, errorMsg, currentRetries, currentReplans, taskId, retryKey);
    }
  }

  /**
   * Análise via LLM para erros ambíguos.
   * @private
   */
  async _analyzeLLM({ step, error, taskId, planContext, currentRetries, currentReplans }) {
    const retryKey = `${taskId}:${step.index ?? 0}`;

    const messages = [
      { role: 'system', content: ERROR_HANDLER_PROMPT },
      {
        role: 'user',
        content: `STEP QUE FALHOU:
- Tool: ${step.tool}
- Descrição: ${step.description || 'N/A'}
- Args: ${JSON.stringify(step.args || {})}
- Crítico: ${step.critical ? 'SIM' : 'NÃO'}

ERRO:
${error}

CONTEXTO:
- Goal do plano: ${planContext.goal || 'N/A'}
- Retries já feitos neste step: ${currentRetries}/${MAX_RETRIES_PER_STEP}
- Replans já feitos nesta task: ${currentReplans}/${MAX_REPLANS_PER_TASK}
- Steps anteriores concluídos: ${planContext.completedSteps || 0}`
      }
    ];

    const response = await this._callLLM(messages, this._model);
    const parsed = this._parseResponse(response);

    // Valida e ajusta a decisão baseada nos limites
    let decision = parsed.decision;
    if (decision === DECISIONS.RETRY && currentRetries >= MAX_RETRIES_PER_STEP) {
      decision = step.critical ? DECISIONS.REPLAN : DECISIONS.SKIP;
      parsed.reason += ' (retries esgotados, escalado)';
    }
    if (decision === DECISIONS.REPLAN && currentReplans >= MAX_REPLANS_PER_TASK) {
      decision = DECISIONS.ABORT;
      parsed.reason += ' (replans esgotados, abortando)';
    }

    // Atualiza contadores
    if (decision === DECISIONS.RETRY) {
      this._retryCount.set(retryKey, currentRetries + 1);
    }
    if (decision === DECISIONS.REPLAN) {
      this._replanCount.set(taskId, currentReplans + 1);
    }

    return {
      decision,
      reason: parsed.reason || 'Análise LLM',
      suggestion: parsed.suggestion || null,
      user_message: parsed.user_message || this._defaultUserMessage(decision),
      retries: decision === DECISIONS.RETRY ? currentRetries + 1 : currentRetries,
      replans: decision === DECISIONS.REPLAN ? currentReplans + 1 : currentReplans,
      source: 'llm'
    };
  }

  /**
   * Parseia resposta da LLM.
   * @private
   */
  _parseResponse(response) {
    let cleaned = String(response).trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '');
    cleaned = cleaned.replace(/\n?```\s*$/i, '');
    cleaned = cleaned.trim();

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch (e2) { /* fall through */ }
      }
      // Retorna decisão padrão se LLM retornou lixo
      return { decision: DECISIONS.SKIP, reason: 'Resposta LLM inválida', suggestion: null, user_message: 'Hmm, algo deu errado 🤔' };
    }
  }

  /**
   * Constrói objeto de decisão padronizado.
   * @private
   */
  _buildDecision(decision, reason, suggestion, userMessage, taskId, retryKey) {
    return {
      decision,
      reason,
      suggestion,
      user_message: userMessage,
      retries: this._retryCount.get(retryKey) || 0,
      replans: this._replanCount.get(taskId) || 0,
      source: 'heuristic'
    };
  }

  /**
   * Fallback quando a LLM também falha.
   * @private
   */
  _fallbackDecision(step, errorMsg, currentRetries, currentReplans, taskId, retryKey) {
    // Se pode tentar de novo → RETRY
    if (currentRetries < MAX_RETRIES_PER_STEP) {
      this._retryCount.set(retryKey, currentRetries + 1);
      return this._buildDecision(DECISIONS.RETRY, 'Fallback: tentando de novo', null,
        'Deu um problema, tentando de novo... 🔄', taskId, retryKey);
    }
    // Se não é crítico → SKIP
    if (!step.critical) {
      return this._buildDecision(DECISIONS.SKIP, 'Fallback: pulando step não-crítico', null,
        'Não consegui esse passo, mas sigo em frente ⏭️', taskId, retryKey);
    }
    // Se pode re-planejar → REPLAN
    if (currentReplans < MAX_REPLANS_PER_TASK) {
      this._replanCount.set(taskId, currentReplans + 1);
      return this._buildDecision(DECISIONS.REPLAN, 'Fallback: re-planejando',
        'Tentar abordagem diferente', 'Preciso repensar isso 🤔', taskId, retryKey);
    }
    // Último recurso → ABORT
    return this._buildDecision(DECISIONS.ABORT, 'Fallback: sem mais opções', null,
      'Não consegui resolver, preciso de ajuda 😓', taskId, retryKey);
  }

  /**
   * Mensagem padrão por tipo de decisão.
   * @private
   */
  _defaultUserMessage(decision) {
    const messages = {
      [DECISIONS.RETRY]: 'Tentando de novo... 🔄',
      [DECISIONS.SKIP]: 'Pulando esse passo ⏭️',
      [DECISIONS.REPLAN]: 'Repensando a estratégia 🤔',
      [DECISIONS.ABORT]: 'Não consegui completar essa tarefa 😓'
    };
    return messages[decision] || 'Hmm, algo deu errado 🤔';
  }

  /**
   * Reseta contadores de uma task (chamar quando task completa/aborta).
   * @param {string} taskId
   */
  resetTask(taskId) {
    // Remove todos os retries dessa task
    for (const key of this._retryCount.keys()) {
      if (key.startsWith(taskId + ':')) {
        this._retryCount.delete(key);
      }
    }
    this._replanCount.delete(taskId);
    console.log(`[ErrorHandler] Contadores resetados para task ${taskId}`);
  }

  /**
   * Reseta todos os contadores.
   */
  resetAll() {
    this._retryCount.clear();
    this._replanCount.clear();
  }
}

module.exports = { ErrorHandler, DECISIONS, MAX_RETRIES_PER_STEP, MAX_REPLANS_PER_TASK };
