/**
 * Agent System — Buddy 2.0
 * 
 * Ponto de entrada que inicializa e conecta todos os módulos do agente:
 * ToolRegistry, Planner, ErrorHandler, Executor, TaskQueue.
 * 
 * Uso:
 *   const { initAgent } = require('./agent');
 *   const agent = await initAgent({ callLLM, mcpClient, skillsDir });
 *   agent.taskQueue.submit({ goal: '...' });
 * 
 * @module agent/index
 */

const { getToolRegistry } = require('./tool-registry');
const { Planner } = require('./planner');
const { ErrorHandler } = require('./error-handler');
const { Executor } = require('./executor');
const { TaskQueue, PRIORITY } = require('./task-queue');

/**
 * Inicializa todo o sistema de agente.
 * 
 * @param {Object} options
 * @param {Function} options.callLLM - Função async (messages, model) => string
 * @param {Object} [options.mcpClient] - Instância do MCPClient
 * @param {string} [options.skillsDir] - Caminho da pasta de skills
 * @param {Function} [options.onEvent] - Callback para eventos (type, data)
 * @returns {Object} { toolRegistry, planner, errorHandler, executor, taskQueue }
 */
async function initAgent(options = {}) {
  const { callLLM, mcpClient, skillsDir, onEvent } = options;

  if (!callLLM || typeof callLLM !== 'function') {
    throw new Error('[Agent] Precisa de uma função callLLM');
  }

  console.log('[Agent] Inicializando sistema de agente...');

  // 1. Tool Registry
  const toolRegistry = getToolRegistry();

  // Carrega tools do MCP
  if (mcpClient && mcpClient.ready) {
    toolRegistry.loadFromMCP(mcpClient);
  }

  // Carrega tools de Skills
  if (skillsDir) {
    toolRegistry.loadFromSkills(skillsDir);
    toolRegistry.watchSkills(skillsDir);
  }

  // 2. Planner
  const planner = new Planner({ callLLM });

  // 3. Error Handler
  const errorHandler = new ErrorHandler({ callLLM });

  // 4. Executor
  const executor = new Executor({ callLLM, planner, errorHandler });

  // 5. Task Queue
  const taskQueue = new TaskQueue({ executor, planner });

  // Propaga eventos para o callback onEvent (usado pelo main.js para IPC)
  if (onEvent && typeof onEvent === 'function') {
    // Eventos do Executor
    executor.on('task-start', (data) => onEvent('agent-task-start', data));
    executor.on('task-end', (data) => onEvent('agent-task-end', data));
    executor.on('task-replan', (data) => onEvent('agent-task-replan', data));
    executor.on('task-cancel', (data) => onEvent('agent-task-cancel', data));
    executor.on('step-start', (data) => onEvent('agent-step-start', data));
    executor.on('step-end', (data) => onEvent('agent-step-end', data));
    executor.on('step-error', (data) => onEvent('agent-step-error', data));
    executor.on('step-decision', (data) => onEvent('agent-step-decision', data));

    // Eventos da TaskQueue
    taskQueue.on('task-submitted', (data) => onEvent('agent-queue-submitted', data));
    taskQueue.on('task-running', (data) => onEvent('agent-queue-running', data));
    taskQueue.on('task-completed', (data) => onEvent('agent-queue-completed', data));
    taskQueue.on('task-failed', (data) => onEvent('agent-queue-failed', data));
    taskQueue.on('task-cancelled', (data) => onEvent('agent-queue-cancelled', data));

    // Eventos do ToolRegistry
    toolRegistry.on('tool-registered', (data) => onEvent('agent-tool-registered', data));
    toolRegistry.on('skill-reloaded', (data) => onEvent('agent-skill-reloaded', data));
  }

  const stats = toolRegistry.getStats();
  console.log(`[Agent] Sistema inicializado! Tools: ${stats.total} (MCP: ${stats.mcp || 0}, Skills: ${stats.total - (stats.mcp || 0)})`);

  return {
    toolRegistry,
    planner,
    errorHandler,
    executor,
    taskQueue,
    PRIORITY,

    /**
     * Atalho: submete uma task e retorna o resultado.
     * @param {string} goal
     * @param {Object} [context]
     * @returns {Promise<Object>} Resultado da execução
     */
    async runTask(goal, context = {}) {
      return new Promise((resolve) => {
        taskQueue.submit({
          goal,
          priority: PRIORITY.NORMAL,
          context,
          onComplete: (err, result) => resolve(result || { error: err })
        });
      });
    },

    /**
     * Limpa tudo ao fechar o app.
     */
    destroy() {
      taskQueue.destroy();
      toolRegistry.destroy();
      console.log('[Agent] Sistema destruído');
    }
  };
}

module.exports = { initAgent, PRIORITY };
