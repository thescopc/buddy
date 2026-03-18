/**
 * Task Queue — Buddy 2.0
 * 
 * Fila de execução com prioridade para o Agent.
 * - Prioridades: LOW, NORMAL, HIGH
 * - Execução single-thread (uma task por vez)
 * - Cancelamento de tasks em andamento
 * - Status tracking (PENDING, RUNNING, COMPLETED, FAILED, CANCELLED)
 * - Callback onComplete para notificar a UI
 * 
 * @module agent/task-queue
 */

const { EventEmitter } = require('events');
const { TASK_STATUS } = require('./executor');

// ============================================================
// CONSTANTES
// ============================================================
const PRIORITY = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2
};

let _taskIdCounter = 0;

/** Gera um ID único para task */
function generateTaskId() {
  _taskIdCounter++;
  return `task_${Date.now()}_${_taskIdCounter}`;
}

class TaskQueue extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.executor - Instância do Executor
   * @param {Object} options.planner - Instância do Planner
   */
  constructor(options = {}) {
    super();

    if (!options.executor) throw new Error('[TaskQueue] Precisa de executor');
    if (!options.planner) throw new Error('[TaskQueue] Precisa de planner');

    this._executor = options.executor;
    this._planner = options.planner;

    /** @type {Array<TaskEntry>} Fila ordenada por prioridade */
    this._queue = [];

    /** @type {TaskEntry|null} Task em execução */
    this._running = null;

    /** @type {Map<string, TaskEntry>} Todas as tasks por ID (para lookup) */
    this._tasks = new Map();

    /** @type {boolean} Se está processando a fila */
    this._processing = false;
  }

  /**
   * Submete uma nova task para a fila.
   * 
   * @param {Object} params
   * @param {string} params.goal - Objetivo em linguagem natural
   * @param {number} [params.priority=PRIORITY.NORMAL] - Prioridade (LOW=0, NORMAL=1, HIGH=2)
   * @param {Object} [params.context={}] - Contexto extra (memória, etc)
   * @param {Function} [params.onComplete] - Callback quando completar
   * @returns {string} taskId
   */
  submit({ goal, priority = PRIORITY.NORMAL, context = {}, onComplete = null }) {
    const taskId = generateTaskId();

    const entry = {
      taskId,
      goal,
      priority,
      context,
      onComplete,
      status: TASK_STATUS.PENDING,
      submittedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null
    };

    this._tasks.set(taskId, entry);
    this._insertByPriority(entry);

    console.log(`[TaskQueue] Task submetida: ${taskId} (priority: ${priority}, goal: "${goal.substring(0, 60)}")`);
    this.emit('task-submitted', { taskId, goal, priority, queueSize: this._queue.length });

    // Inicia processamento se não está rodando
    this._processNext();

    return taskId;
  }

  /**
   * Insere entry na fila respeitando prioridade (maior primeiro).
   * @private
   */
  _insertByPriority(entry) {
    // Encontra posição correta (maior prioridade vem antes)
    let insertIdx = this._queue.length;
    for (let i = 0; i < this._queue.length; i++) {
      if (entry.priority > this._queue[i].priority) {
        insertIdx = i;
        break;
      }
    }
    this._queue.splice(insertIdx, 0, entry);
  }

  /**
   * Processa a próxima task da fila.
   * @private
   */
  async _processNext() {
    // Se já está processando ou fila vazia, sai
    if (this._processing || this._queue.length === 0) return;

    this._processing = true;
    const entry = this._queue.shift();
    this._running = entry;

    entry.status = TASK_STATUS.RUNNING;
    entry.startedAt = new Date().toISOString();

    console.log(`[TaskQueue] Processando: ${entry.taskId} (fila restante: ${this._queue.length})`);
    this.emit('task-running', { taskId: entry.taskId, goal: entry.goal });

    try {
      // 1. Planeja
      const plan = await this._planner.createPlan(entry.goal, entry.context);

      // Se plano vazio (conversa simples), completa direto
      if (!plan.steps || plan.steps.length === 0) {
        entry.status = TASK_STATUS.COMPLETED;
        entry.completedAt = new Date().toISOString();
        entry.result = { summary: plan.reason || 'Não requer ferramentas', steps: [] };
        this.emit('task-completed', { taskId: entry.taskId, result: entry.result });
        if (entry.onComplete) entry.onComplete(null, entry.result);
        this._finishProcessing();
        return;
      }

      // 2. Executa
      const result = await this._executor.execute(plan, entry.taskId, entry.context);

      entry.completedAt = new Date().toISOString();
      entry.result = result;

      if (result.status === TASK_STATUS.COMPLETED) {
        entry.status = TASK_STATUS.COMPLETED;
        this.emit('task-completed', { taskId: entry.taskId, result });
      } else if (result.status === TASK_STATUS.CANCELLED) {
        entry.status = TASK_STATUS.CANCELLED;
        this.emit('task-cancelled', { taskId: entry.taskId });
      } else {
        entry.status = TASK_STATUS.FAILED;
        entry.error = result.error || 'Falha desconhecida';
        this.emit('task-failed', { taskId: entry.taskId, error: entry.error });
      }

      if (entry.onComplete) entry.onComplete(entry.error, entry.result);

    } catch (err) {
      console.error(`[TaskQueue] Erro fatal na task ${entry.taskId}:`, err.message);
      entry.status = TASK_STATUS.FAILED;
      entry.completedAt = new Date().toISOString();
      entry.error = err.message;
      this.emit('task-failed', { taskId: entry.taskId, error: err.message });
      if (entry.onComplete) entry.onComplete(err, null);
    }

    this._finishProcessing();
  }

  /**
   * Finaliza processamento e tenta próxima task.
   * @private
   */
  _finishProcessing() {
    this._running = null;
    this._processing = false;

    // Processa próxima automaticamente
    if (this._queue.length > 0) {
      // Pequeno delay para permitir que eventos sejam processados
      setImmediate(() => this._processNext());
    }
  }

  // ============================================================
  // CANCELAMENTO
  // ============================================================

  /**
   * Cancela uma task (em andamento ou pendente).
   * @param {string} taskId
   * @returns {boolean} true se encontrou e cancelou
   */
  cancel(taskId) {
    const entry = this._tasks.get(taskId);
    if (!entry) return false;

    if (entry.status === TASK_STATUS.PENDING) {
      // Remove da fila
      this._queue = this._queue.filter(e => e.taskId !== taskId);
      entry.status = TASK_STATUS.CANCELLED;
      entry.completedAt = new Date().toISOString();
      console.log(`[TaskQueue] Task pendente cancelada: ${taskId}`);
      this.emit('task-cancelled', { taskId });
      if (entry.onComplete) entry.onComplete('Cancelada pelo usuário', null);
      return true;
    }

    if (entry.status === TASK_STATUS.RUNNING) {
      // Sinaliza cancelamento pro executor
      this._executor.cancel(taskId);
      console.log(`[TaskQueue] Cancelamento sinalizado para task em execução: ${taskId}`);
      return true;
    }

    return false; // Já completou/falhou/cancelou
  }

  // ============================================================
  // STATUS & QUERIES
  // ============================================================

  /**
   * Retorna status de uma task.
   * @param {string} taskId
   * @returns {TaskEntry|null}
   */
  getTask(taskId) {
    return this._tasks.get(taskId) || null;
  }

  /**
   * Retorna a task em execução (ou null).
   * @returns {TaskEntry|null}
   */
  getRunning() {
    return this._running;
  }

  /**
   * Retorna tasks pendentes na fila.
   * @returns {TaskEntry[]}
   */
  getPending() {
    return [...this._queue];
  }

  /**
   * Retorna tamanho da fila (pendentes).
   * @returns {number}
   */
  getQueueSize() {
    return this._queue.length;
  }

  /**
   * Retorna histórico de todas as tasks.
   * @param {number} [limit=20] - Máximo de tasks a retornar
   * @returns {Array<{taskId, goal, status, priority, submittedAt, completedAt}>}
   */
  getHistory(limit = 20) {
    return Array.from(this._tasks.values())
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
      .slice(0, limit)
      .map(t => ({
        taskId: t.taskId,
        goal: t.goal,
        status: t.status,
        priority: t.priority,
        submittedAt: t.submittedAt,
        completedAt: t.completedAt,
        error: t.error
      }));
  }

  /**
   * Retorna stats da fila.
   * @returns {Object}
   */
  getStats() {
    const all = Array.from(this._tasks.values());
    return {
      total: all.length,
      pending: this._queue.length,
      running: this._running ? 1 : 0,
      completed: all.filter(t => t.status === TASK_STATUS.COMPLETED).length,
      failed: all.filter(t => t.status === TASK_STATUS.FAILED).length,
      cancelled: all.filter(t => t.status === TASK_STATUS.CANCELLED).length
    };
  }

  /**
   * Limpa histórico de tasks completadas/falhadas/canceladas.
   */
  clearHistory() {
    for (const [id, entry] of this._tasks.entries()) {
      if (entry.status !== TASK_STATUS.PENDING && entry.status !== TASK_STATUS.RUNNING) {
        this._tasks.delete(id);
      }
    }
    console.log('[TaskQueue] Histórico limpo');
  }

  /**
   * Para a fila e cancela tudo.
   */
  destroy() {
    // Cancela task em execução
    if (this._running) {
      this._executor.cancel(this._running.taskId);
    }
    // Cancela pendentes
    for (const entry of this._queue) {
      entry.status = TASK_STATUS.CANCELLED;
    }
    this._queue = [];
    this._processing = false;
    this._running = null;
    this.removeAllListeners();
    console.log('[TaskQueue] Destruída');
  }
}

module.exports = { TaskQueue, PRIORITY, generateTaskId };
