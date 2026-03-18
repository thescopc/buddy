/**
 * Planner — Buddy 2.0
 * 
 * Recebe um goal em linguagem natural, usa LLM (OpenAI) para
 * decompor em steps executáveis. Cada step tem:
 * - tool: nome da ferramenta a usar
 * - args: parâmetros da tool
 * - description: descrição legível do passo
 * - critical: se falhar, aborta o plano inteiro
 * 
 * @module agent/planner
 */

const { getToolRegistry } = require('./tool-registry');

// ============================================================
// CONSTANTES
// ============================================================
const MAX_STEPS = 10;
const PLANNER_MODEL = 'gpt-4o-mini'; // Modelo barato pro planner

/**
 * Prompt template para o Planner.
 * Variáveis: {tools_json}, {goal}, {context}
 */
const PLANNER_SYSTEM_PROMPT = `Você é um planejador de tarefas para um agente de desktop chamado Buddy.

Seu trabalho é receber um OBJETIVO (goal) em linguagem natural e decompô-lo em STEPS executáveis.

REGRAS:
1. Máximo de ${MAX_STEPS} steps por plano
2. Cada step deve usar UMA tool da lista fornecida
3. Steps devem ser na ordem correta de execução
4. Marque steps essenciais como "critical": true (se falharem, o plano inteiro falha)
5. Steps não-críticos podem ser pulados sem abortar o plano
6. Se um step depende do resultado de outro, indique no campo "depends_on" (índice do step)
7. Use EXATAMENTE os nomes das tools disponíveis
8. Preencha os args com os parâmetros corretos da tool
9. Se o goal for simples (conversa, pergunta), retorne um plano vazio

FORMATO DE RESPOSTA (JSON puro, sem markdown):
{
  "goal": "descrição resumida do objetivo",
  "steps": [
    {
      "index": 0,
      "tool": "nome_da_tool",
      "args": { "param1": "valor1" },
      "description": "O que este passo faz",
      "critical": true,
      "depends_on": null
    }
  ],
  "estimated_complexity": "low|medium|high"
}

Se o goal for apenas conversa ou pergunta simples, retorne:
{
  "goal": "descrição",
  "steps": [],
  "estimated_complexity": "low",
  "reason": "Não requer ferramentas, é uma conversa/pergunta"
}

IMPORTANTE: Retorne APENAS o JSON, sem texto antes ou depois, sem backticks markdown.`;

class Planner {
  /**
   * @param {Object} options
   * @param {Function} options.callLLM - Função async que chama a LLM. Recebe (messages, model) e retorna string.
   * @param {string} [options.model] - Modelo a usar (default: gpt-4o-mini)
   */
  constructor(options = {}) {
    if (!options.callLLM || typeof options.callLLM !== 'function') {
      throw new Error('[Planner] Precisa de uma função callLLM');
    }

    this._callLLM = options.callLLM;
    this._model = options.model || PLANNER_MODEL;
    this._registry = getToolRegistry();
  }

  /**
   * Gera a lista de tools formatada para o prompt do planner.
   * @returns {string} JSON string com as tools disponíveis
   */
  _buildToolsDescription() {
    const tools = this._registry.getAll();
    const simplified = tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: Object.keys(t.parameters.properties || {}).map(key => {
        const prop = t.parameters.properties[key];
        return `${key} (${prop.type || 'string'}): ${prop.description || ''}`;
      })
    }));
    return JSON.stringify(simplified, null, 2);
  }

  /**
   * Cria um plano de execução a partir de um goal.
   * 
   * @param {string} goal - Objetivo em linguagem natural
   * @param {Object} [context={}] - Contexto adicional (resultados anteriores, memória, etc)
   * @param {string} [context.previousResults] - Resultados de steps anteriores (para replanejamento)
   * @param {string} [context.errorInfo] - Info sobre erro que causou replanejamento
   * @param {string} [context.userMemory] - Memória do usuário para contexto
   * @returns {Promise<PlanResult>} Plano com steps ou fallback
   */
  async createPlan(goal, context = {}) {
    console.log(`[Planner] Criando plano para: "${goal.substring(0, 80)}..."`);

    const toolsJson = this._buildToolsDescription();

    // Monta contexto extra
    let contextBlock = '';
    if (context.previousResults) {
      contextBlock += `\nRESULTADOS ANTERIORES (use como referência):\n${context.previousResults}\n`;
    }
    if (context.errorInfo) {
      contextBlock += `\nERRO ANTERIOR (o plano anterior falhou, re-planeje com abordagem diferente):\n${context.errorInfo}\n`;
    }
    if (context.userMemory) {
      contextBlock += `\nMEMÓRIA DO USUÁRIO:\n${context.userMemory}\n`;
    }

    const messages = [
      {
        role: 'system',
        content: PLANNER_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: `TOOLS DISPONÍVEIS:\n${toolsJson}\n${contextBlock}\nOBJETIVO: ${goal}`
      }
    ];

    try {
      const response = await this._callLLM(messages, this._model);
      const plan = this._parseResponse(response);
      const validated = this._validatePlan(plan, goal);
      console.log(`[Planner] Plano criado: ${validated.steps.length} steps (${validated.estimated_complexity})`);
      return validated;
    } catch (err) {
      console.error(`[Planner] Erro ao criar plano:`, err.message);
      return this._fallbackPlan(goal, err.message);
    }
  }

  /**
   * Parseia a resposta da LLM em um objeto de plano.
   * @param {string} response - Resposta raw da LLM
   * @returns {Object} Plano parseado
   */
  _parseResponse(response) {
    // Remove possíveis backticks markdown
    let cleaned = response.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '');
    cleaned = cleaned.replace(/\n?```\s*$/i, '');
    cleaned = cleaned.trim();

    try {
      return JSON.parse(cleaned);
    } catch (err) {
      // Tenta extrair JSON de dentro do texto
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e) {
          throw new Error(`Resposta da LLM não é JSON válido: ${cleaned.substring(0, 200)}`);
        }
      }
      throw new Error(`Resposta da LLM não contém JSON: ${cleaned.substring(0, 200)}`);
    }
  }

  /**
   * Valida o plano: verifica se tools existem, corrige índices, limita steps.
   * @param {Object} plan - Plano parseado
   * @param {string} goal - Goal original (para fallback)
   * @returns {PlanResult} Plano validado
   */
  _validatePlan(plan, goal) {
    // Garante estrutura mínima
    if (!plan || typeof plan !== 'object') {
      return this._fallbackPlan(goal, 'Plano inválido retornado pela LLM');
    }

    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    const validatedSteps = [];
    const warnings = [];

    for (let i = 0; i < Math.min(steps.length, MAX_STEPS); i++) {
      const step = steps[i];

      // Verifica campos obrigatórios
      if (!step.tool || typeof step.tool !== 'string') {
        warnings.push(`Step ${i}: sem tool definida, pulado`);
        continue;
      }

      // Verifica se tool existe no registry
      if (!this._registry.has(step.tool)) {
        // Tenta encontrar tool com nome similar
        const similar = this._findSimilarTool(step.tool);
        if (similar) {
          warnings.push(`Step ${i}: tool "${step.tool}" não existe, usando "${similar}" (similar)`);
          step.tool = similar;
        } else {
          warnings.push(`Step ${i}: tool "${step.tool}" não existe no registry, pulado`);
          continue;
        }
      }

      validatedSteps.push({
        index: validatedSteps.length,
        tool: step.tool,
        args: step.args || {},
        description: step.description || `Executar ${step.tool}`,
        critical: step.critical !== undefined ? Boolean(step.critical) : true,
        depends_on: typeof step.depends_on === 'number' ? step.depends_on : null,
        status: 'pending' // pending, running, completed, failed, skipped
      });
    }

    return {
      goal: plan.goal || goal,
      steps: validatedSteps,
      estimated_complexity: plan.estimated_complexity || 'medium',
      warnings: warnings.length > 0 ? warnings : undefined,
      reason: plan.reason || undefined,
      created_at: new Date().toISOString()
    };
  }

  /**
   * Tenta encontrar uma tool com nome similar (fuzzy match simples).
   * @param {string} name - Nome da tool não encontrada
   * @returns {string|null} Nome da tool similar ou null
   */
  _findSimilarTool(name) {
    const allNames = this._registry.getNames();
    const lowerName = name.toLowerCase().replace(/[-_]/g, '');

    // Match exato sem hífens/underscores
    for (const n of allNames) {
      if (n.toLowerCase().replace(/[-_]/g, '') === lowerName) return n;
    }

    // Match parcial (contém)
    for (const n of allNames) {
      const lowerN = n.toLowerCase();
      if (lowerN.includes(lowerName) || lowerName.includes(lowerN)) return n;
    }

    return null;
  }

  /**
   * Gera um plano fallback quando a LLM falha.
   * O fallback tenta usar execute_command como tool genérica.
   * @param {string} goal - Goal original
   * @param {string} reason - Motivo do fallback
   * @returns {PlanResult}
   */
  _fallbackPlan(goal, reason) {
    console.warn(`[Planner] Usando plano fallback: ${reason}`);

    // Se tem execute_command, tenta usá-la como fallback genérico
    const hasExecute = this._registry.has('execute_command');

    return {
      goal,
      steps: hasExecute ? [
        {
          index: 0,
          tool: 'execute_command',
          args: { command: `echo "Planner fallback — goal: ${goal.replace(/"/g, '\\"').substring(0, 100)}"` },
          description: `Fallback: executar comando genérico para "${goal.substring(0, 50)}"`,
          critical: false,
          depends_on: null,
          status: 'pending'
        }
      ] : [],
      estimated_complexity: 'low',
      warnings: [`Plano fallback ativado: ${reason}`],
      is_fallback: true,
      created_at: new Date().toISOString()
    };
  }

  /**
   * Verifica se um goal precisa de planejamento ou é conversa simples.
   * Heurística rápida antes de chamar a LLM.
   * @param {string} goal
   * @returns {boolean} true se parece precisar de ferramentas
   */
  needsPlanning(goal) {
    const lower = goal.toLowerCase();

    // Palavras-chave que indicam necessidade de tools
    const actionKeywords = [
      'cria', 'crie', 'criar', 'faça', 'faz', 'fazer',
      'abre', 'abra', 'abrir', 'execut', 'rodar', 'roda',
      'instala', 'instale', 'instalar',
      'busca', 'busque', 'pesquisa', 'pesquise',
      'salva', 'salve', 'salvar', 'escreva', 'escreve',
      'lista', 'liste', 'listar',
      'apaga', 'apague', 'delete', 'remov',
      'move', 'mova', 'mover', 'renomei',
      'copia', 'copie', 'copiar',
      'baixa', 'baixe', 'download',
      'agenda', 'lembr', 'remind',
      'configur', 'sett',
      'create', 'make', 'build', 'write', 'open', 'run',
      'search', 'find', 'delete', 'move', 'copy'
    ];

    return actionKeywords.some(kw => lower.includes(kw));
  }
}

module.exports = { Planner };
