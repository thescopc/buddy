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

let registerScreenTools = null;
try {
  registerScreenTools = require('../actions/register-screen-tools').registerScreenTools;
} catch (e) {
  console.warn('[Agent] Screen tools não disponíveis:', e.message);
}

let registerBrowserTools = null;
try {
  registerBrowserTools = require('../actions/register-browser-tools').registerBrowserTools;
} catch (e) {
  console.warn('[Agent] Browser tools não disponíveis:', e.message);
}

let registerSearchTools = null;
try {
  registerSearchTools = require('../actions/register-search-tools').registerSearchTools;
} catch (e) {
  console.warn('[Agent] Search tools não disponíveis:', e.message);
}

let registerFileTools = null;
try {
  registerFileTools = require('../actions/register-file-tools').registerFileTools;
} catch (e) {
  console.warn('[Agent] File tools não disponíveis:', e.message);
}

let registerWeatherTools = null;
try {
  registerWeatherTools = require('../actions/register-weather-tools').registerWeatherTools;
} catch (e) {
  console.warn('[Agent] Weather tools não disponíveis:', e.message);
}

/**
 * Inicializa todo o sistema de agente.
 * 
 * @param {Object} options
 * @param {Function} options.callLLM - Função async (messages, model) => string
 * @param {Object} [options.mcpClient] - Instância do MCPClient
 * @param {string} [options.skillsDir] - Caminho da pasta de skills
 * @param {string} [options.apiKey] - OpenAI API Key (para vision)
 * @param {Function} [options.onEvent] - Callback para eventos (type, data)
 * @param {Function} [options.onExpression] - Callback para mudar expressão do Buddy
 * @returns {Object} { toolRegistry, planner, errorHandler, executor, taskQueue }
 */
async function initAgent(options = {}) {
  const { callLLM, mcpClient, skillsDir, apiKey, onEvent, onExpression } = options;

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

  // Carrega screen/vision/control tools
  let screenModules = null;
  if (registerScreenTools) {
    try {
      screenModules = registerScreenTools({ apiKey, onExpression });
    } catch (e) {
      console.warn('[Agent] Erro ao registrar screen tools:', e.message);
    }
  }

  // Carrega browser automation tools
  let browserModules = null;
  if (registerBrowserTools) {
    try {
      browserModules = registerBrowserTools({ onExpression });
    } catch (e) {
      console.warn('[Agent] Erro ao registrar browser tools:', e.message);
    }
  }

  // Carrega web search tools
  if (registerSearchTools) {
    try {
      registerSearchTools({ onExpression });
    } catch (e) {
      console.warn('[Agent] Erro ao registrar search tools:', e.message);
    }
  }

  // Carrega file controller tools
  if (registerFileTools) {
    try {
      registerFileTools({ onExpression });
    } catch (e) {
      console.warn('[Agent] Erro ao registrar file tools:', e.message);
    }
  }

  // Carrega weather tools
  if (registerWeatherTools) {
    try {
      registerWeatherTools({ onExpression });
    } catch (e) {
      console.warn('[Agent] Erro ao registrar weather tools:', e.message);
    }
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
    async destroy() {
      taskQueue.destroy();
      toolRegistry.destroy();
      // Fecha browser se estiver aberto
      if (browserModules && browserModules.browserControl) {
        await browserModules.browserControl.close().catch(() => {});
      }
      console.log('[Agent] Sistema destruído');
    }
  };
}

module.exports = { initAgent, PRIORITY };
