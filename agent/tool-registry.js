/**
 * Tool Registry — Buddy 2.0
 * 
 * Sistema centralizado de registro de ferramentas.
 * Cada tool se auto-registra com nome, descrição e schema de parâmetros.
 * Suporta carregamento automático de tools MCP e Skills .md.
 * Hot-reload via fs.watch na pasta de skills.
 * 
 * @module agent/tool-registry
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

class ToolRegistry extends EventEmitter {
  constructor() {
    super();

    /** @type {Map<string, ToolDefinition>} */
    this._tools = new Map();

    /** @type {Set<string>} Fontes registradas (ex: 'mcp', 'skill:google-calendar') */
    this._sources = new Set();

    /** @type {fs.FSWatcher|null} */
    this._skillsWatcher = null;

    /** @type {string|null} Caminho da pasta de skills */
    this._skillsDir = null;
  }

  // ============================================================
  // REGISTRO MANUAL DE TOOLS
  // ============================================================

  /**
   * Registra uma tool no registry.
   * 
   * @param {Object} toolDef - Definição da tool
   * @param {string} toolDef.name - Nome único da tool
   * @param {string} toolDef.description - Descrição do que a tool faz
   * @param {Object} toolDef.parameters - JSON Schema dos parâmetros
   * @param {Function} toolDef.execute - Função que executa a tool (async)
   * @param {string} [toolDef.source='manual'] - Origem (mcp, skill:nome, manual)
   * @param {Object} [toolDef.metadata={}] - Dados extras (caminho do skill, etc)
   * @returns {boolean} true se registrou, false se já existia
   */
  register(toolDef) {
    const { name, description, parameters, execute, source = 'manual', metadata = {} } = toolDef;

    if (!name || typeof name !== 'string') {
      throw new Error('[ToolRegistry] Tool precisa de um name (string)');
    }
    if (!description || typeof description !== 'string') {
      throw new Error(`[ToolRegistry] Tool "${name}" precisa de uma description`);
    }
    if (typeof execute !== 'function') {
      throw new Error(`[ToolRegistry] Tool "${name}" precisa de uma função execute`);
    }

    const wasRegistered = this._tools.has(name);
    
    this._tools.set(name, {
      name,
      description,
      parameters: parameters || { type: 'object', properties: {} },
      execute,
      source,
      metadata,
      registeredAt: new Date().toISOString()
    });

    this._sources.add(source);

    const action = wasRegistered ? 'updated' : 'registered';
    console.log(`[ToolRegistry] Tool ${action}: ${name} (source: ${source})`);
    this.emit('tool-' + action, { name, source });

    return !wasRegistered;
  }

  /**
   * Remove uma tool do registry.
   * @param {string} name - Nome da tool
   * @returns {boolean} true se removeu, false se não existia
   */
  unregister(name) {
    if (!this._tools.has(name)) return false;
    
    const tool = this._tools.get(name);
    this._tools.delete(name);
    console.log(`[ToolRegistry] Tool removida: ${name}`);
    this.emit('tool-unregistered', { name, source: tool.source });
    return true;
  }

  /**
   * Retorna uma tool pelo nome.
   * @param {string} name
   * @returns {ToolDefinition|null}
   */
  get(name) {
    return this._tools.get(name) || null;
  }

  /**
   * Verifica se uma tool existe.
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._tools.has(name);
  }

  /**
   * Retorna todas as tools registradas.
   * @returns {ToolDefinition[]}
   */
  getAll() {
    return Array.from(this._tools.values());
  }

  /**
   * Retorna tools filtradas por source.
   * @param {string} source - ex: 'mcp', 'skill:google-calendar'
   * @returns {ToolDefinition[]}
   */
  getBySource(source) {
    return this.getAll().filter(t => t.source === source);
  }

  /**
   * Retorna lista formatada para OpenAI function calling.
   * @returns {Array<{type: string, function: Object}>}
   */
  getOpenAITools() {
    return this.getAll().map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
  }

  /**
   * Retorna nomes de todas as tools (para log/debug).
   * @returns {string[]}
   */
  getNames() {
    return Array.from(this._tools.keys());
  }

  /**
   * Retorna contagem de tools por source.
   * @returns {Object} ex: { mcp: 26, 'skill:calendar': 1 }
   */
  getStats() {
    const stats = {};
    for (const tool of this._tools.values()) {
      stats[tool.source] = (stats[tool.source] || 0) + 1;
    }
    stats.total = this._tools.size;
    return stats;
  }

  // ============================================================
  // CARREGAMENTO AUTOMÁTICO — MCP
  // ============================================================

  /**
   * Carrega todas as tools do MCP Desktop Commander.
   * @param {MCPClient} mcpClient - Instância do mcp-client.js
   * @returns {number} Quantidade de tools carregadas
   */
  loadFromMCP(mcpClient) {
    if (!mcpClient || !mcpClient.ready) {
      console.warn('[ToolRegistry] MCP não está pronto, pulando carregamento');
      return 0;
    }

    const mcpTools = mcpClient.getTools();
    let count = 0;

    for (const t of mcpTools) {
      this.register({
        name: t.name,
        description: t.description || `MCP tool: ${t.name}`,
        parameters: t.inputSchema || { type: 'object', properties: {} },
        execute: async (args) => mcpClient.callTool(t.name, args),
        source: 'mcp',
        metadata: { origin: 'desktop-commander' }
      });
      count++;
    }

    console.log(`[ToolRegistry] ${count} tools carregadas do MCP`);
    this.emit('mcp-loaded', { count });
    return count;
  }

  // ============================================================
  // CARREGAMENTO AUTOMÁTICO — SKILLS (.md)
  // ============================================================

  /**
   * Parseia um arquivo .md de skill e extrai tools definidas nele.
   * 
   * Formato esperado no .md:
   * ## Tools
   * ### nome_da_tool
   * Descrição da tool
   * **Parâmetros:** param1 (tipo) - descrição, param2 (tipo) - descrição
   * 
   * @param {string} filePath - Caminho do arquivo .md
   * @returns {Array<{name: string, description: string, parameters: Object}>}
   */
  _parseSkillTools(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const skillName = path.basename(filePath, '.md');
      const tools = [];

      // Procura seção ## Tools ou ## Ferramentas
      const toolsSectionMatch = content.match(/## (?:Tools|Ferramentas)\s*\n([\s\S]*?)(?=\n## [^#]|\n# |$)/i);
      if (!toolsSectionMatch) return tools;

      const toolsSection = toolsSectionMatch[1];
      // Cada tool é um ### nome_da_tool
      const toolBlocks = toolsSection.split(/### /).filter(b => b.trim());

      for (const block of toolBlocks) {
        const lines = block.trim().split('\n');
        const toolName = lines[0].trim().replace(/\s+/g, '_').toLowerCase();
        const description = lines.slice(1).find(l => l.trim() && !l.startsWith('**'))?.trim() || `Tool from skill: ${skillName}`;

        // Extrai parâmetros se definidos
        const paramsLine = lines.find(l => l.startsWith('**Parâmetros:') || l.startsWith('**Parameters:'));
        const parameters = { type: 'object', properties: {} };

        if (paramsLine) {
          const paramsText = paramsLine.replace(/^\*\*(?:Parâmetros|Parameters):\*\*\s*/, '');
          const paramParts = paramsText.split(',').map(p => p.trim());
          for (const part of paramParts) {
            const paramMatch = part.match(/(\w+)\s*\((\w+)\)\s*(?:-\s*(.+))?/);
            if (paramMatch) {
              parameters.properties[paramMatch[1]] = {
                type: paramMatch[2] === 'string' ? 'string' : paramMatch[2] === 'number' ? 'number' : 'string',
                description: paramMatch[3] || ''
              };
            }
          }
        }

        tools.push({ name: `skill_${skillName}_${toolName}`, description, parameters });
      }

      return tools;
    } catch (e) {
      console.error(`[ToolRegistry] Erro ao parsear skill ${filePath}:`, e.message);
      return [];
    }
  }

  /**
   * Carrega tools de todos os arquivos .md na pasta de skills.
   * @param {string} skillsDir - Caminho da pasta de skills
   * @param {Function} [skillExecutor] - Função que executa skill tools (recebe name, args)
   * @returns {number} Quantidade de tools carregadas
   */
  loadFromSkills(skillsDir, skillExecutor = null) {
    this._skillsDir = skillsDir;

    if (!fs.existsSync(skillsDir)) {
      console.warn(`[ToolRegistry] Pasta de skills não encontrada: ${skillsDir}`);
      return 0;
    }

    const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));
    let count = 0;

    for (const file of files) {
      const filePath = path.join(skillsDir, file);
      const skillName = file.replace('.md', '');
      const skillTools = this._parseSkillTools(filePath);

      for (const t of skillTools) {
        const executor = skillExecutor
          ? async (args) => skillExecutor(t.name, args, filePath)
          : async () => ({ info: `Skill tool "${t.name}" não tem executor configurado. Leia o skill em ${filePath}` });

        this.register({
          ...t,
          execute: executor,
          source: `skill:${skillName}`,
          metadata: { skillFile: filePath }
        });
        count++;
      }
    }

    console.log(`[ToolRegistry] ${count} tools carregadas de ${files.length} skills`);
    this.emit('skills-loaded', { count, files: files.length });
    return count;
  }

  // ============================================================
  // HOT-RELOAD
  // ============================================================

  /**
   * Inicia watcher na pasta de skills para hot-reload.
   * Quando um .md é adicionado/modificado, re-carrega suas tools.
   * Quando um .md é removido, desregistra suas tools.
   * @param {string} skillsDir - Caminho da pasta de skills
   * @param {Function} [skillExecutor] - Função que executa skill tools
   */
  watchSkills(skillsDir, skillExecutor = null) {
    this._skillsDir = skillsDir || this._skillsDir;
    if (!this._skillsDir || !fs.existsSync(this._skillsDir)) return;

    // Para watcher anterior se existir
    this.stopWatching();

    this._skillsWatcher = fs.watch(this._skillsDir, (eventType, filename) => {
      if (!filename || !filename.endsWith('.md')) return;

      const filePath = path.join(this._skillsDir, filename);
      const skillName = filename.replace('.md', '');
      const source = `skill:${skillName}`;

      // Debounce simples (100ms)
      if (this._watchDebounce) clearTimeout(this._watchDebounce);
      this._watchDebounce = setTimeout(() => {
        if (fs.existsSync(filePath)) {
          // Arquivo criado ou modificado → remove tools antigas e re-carrega
          const oldTools = this.getBySource(source);
          for (const t of oldTools) this.unregister(t.name);

          const newTools = this._parseSkillTools(filePath);
          for (const t of newTools) {
            const executor = skillExecutor
              ? async (args) => skillExecutor(t.name, args, filePath)
              : async () => ({ info: `Skill tool "${t.name}" sem executor. Leia: ${filePath}` });

            this.register({ ...t, execute: executor, source, metadata: { skillFile: filePath } });
          }
          console.log(`[ToolRegistry] Hot-reload: ${filename} → ${newTools.length} tools`);
          this.emit('skill-reloaded', { file: filename, tools: newTools.length });
        } else {
          // Arquivo removido → desregistra todas as tools dessa skill
          const oldTools = this.getBySource(source);
          for (const t of oldTools) this.unregister(t.name);
          console.log(`[ToolRegistry] Skill removida: ${filename} (${oldTools.length} tools)`);
          this.emit('skill-removed', { file: filename, tools: oldTools.length });
        }
      }, 100);
    });

    console.log(`[ToolRegistry] Watching skills em: ${this._skillsDir}`);
  }

  /**
   * Para o watcher de skills.
   */
  stopWatching() {
    if (this._skillsWatcher) {
      this._skillsWatcher.close();
      this._skillsWatcher = null;
    }
  }

  // ============================================================
  // CLEANUP
  // ============================================================

  /**
   * Remove todas as tools e para watchers.
   */
  destroy() {
    this.stopWatching();
    this._tools.clear();
    this._sources.clear();
    this.removeAllListeners();
    console.log('[ToolRegistry] Destruído');
  }
}

// ============================================================
// SINGLETON
// ============================================================
let _instance = null;

/**
 * Retorna a instância singleton do ToolRegistry.
 * @returns {ToolRegistry}
 */
function getToolRegistry() {
  if (!_instance) {
    _instance = new ToolRegistry();
  }
  return _instance;
}

module.exports = { ToolRegistry, getToolRegistry };
