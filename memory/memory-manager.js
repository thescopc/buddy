/**
 * memory-manager.js — Memória Estruturada 2.0
 * 
 * Gerencia memória persistente em JSON com:
 * - Estrutura: { identity, preferences, relationships, notes }
 * - CRUD thread-safe com lock (mutex via Promise)
 * - Truncar valores longos (máx 300 chars)
 * - Merge recursivo sem perder dados existentes
 * - Persistência em memory/structured-memory.json
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const MAX_VALUE_LENGTH = 300;
const SAVE_DEBOUNCE_MS = 1000;

// Estrutura padrão da memória
const DEFAULT_MEMORY = {
  identity: {},
  preferences: {},
  relationships: {},
  notes: {},
  _meta: {
    version: '2.0',
    createdAt: null,
    updatedAt: null,
    totalUpdates: 0
  }
};

class MemoryManager extends EventEmitter {
  constructor(memoryDir) {
    super();
    this.memoryDir = memoryDir || path.join(__dirname);
    this.filePath = path.join(this.memoryDir, 'structured-memory.json');
    this.data = null;
    this._lock = Promise.resolve();
    this._saveTimer = null;
    this._dirty = false;
    this._initialized = false;
  }

  // ─── Inicialização ───────────────────────────────────
  async init() {
    if (this._initialized) return this.data;
    
    await this._withLock(async () => {
      if (fs.existsSync(this.filePath)) {
        try {
          const raw = fs.readFileSync(this.filePath, 'utf-8');
          this.data = JSON.parse(raw);
          // Garante que todas as categorias existam
          for (const key of Object.keys(DEFAULT_MEMORY)) {
            if (key === '_meta') continue;
            if (!this.data[key]) this.data[key] = {};
          }
          if (!this.data._meta) {
            this.data._meta = { ...DEFAULT_MEMORY._meta, createdAt: new Date().toISOString() };
          }
        } catch (e) {
          console.error('[MEMORY-MGR] Erro ao ler JSON, criando novo:', e.message);
          this.data = this._createDefault();
        }
      } else {
        this.data = this._createDefault();
        this._dirty = true;
      }
    });

    if (this._dirty) await this._save();
    this._initialized = true;
    console.log('[MEMORY-MGR] Inicializado com', this._countEntries(), 'entradas');
    return this.data;
  }

  _createDefault() {
    return {
      ...JSON.parse(JSON.stringify(DEFAULT_MEMORY)),
      _meta: {
        ...DEFAULT_MEMORY._meta,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };
  }

  // ─── Lock (Mutex via Promise chain) ──────────────────
  async _withLock(fn) {
    let release;
    const next = new Promise(resolve => { release = resolve; });
    const prev = this._lock;
    this._lock = next;
    
    try {
      await prev;
      return await fn();
    } finally {
      release();
    }
  }

  // ─── Truncar valores longos ──────────────────────────
  _truncate(value) {
    if (typeof value === 'string' && value.length > MAX_VALUE_LENGTH) {
      return value.substring(0, MAX_VALUE_LENGTH) + '...';
    }
    return value;
  }

  // ─── Merge recursivo ─────────────────────────────────
  _deepMerge(target, source) {
    for (const key of Object.keys(source)) {
      if (key === '_meta') continue; // _meta é gerenciado internamente
      
      const srcVal = source[key];
      const tgtVal = target[key];

      if (srcVal === null || srcVal === undefined) {
        // null/undefined = deletar a chave
        delete target[key];
      } else if (
        typeof srcVal === 'object' && !Array.isArray(srcVal) &&
        typeof tgtVal === 'object' && !Array.isArray(tgtVal)
      ) {
        // Ambos são objetos: merge recursivo
        this._deepMerge(tgtVal, srcVal);
      } else if (typeof srcVal === 'object' && !Array.isArray(srcVal) && srcVal.value !== undefined) {
        // Formato { value, source?, timestamp? }
        target[key] = {
          value: this._truncate(srcVal.value),
          source: srcVal.source || 'user',
          updatedAt: new Date().toISOString()
        };
      } else if (typeof srcVal === 'string') {
        // String simples → converte para formato estruturado
        target[key] = {
          value: this._truncate(srcVal),
          source: 'user',
          updatedAt: new Date().toISOString()
        };
      } else {
        // Qualquer outro valor
        target[key] = srcVal;
      }
    }
    return target;
  }

  // ─── CRUD ────────────────────────────────────────────

  /**
   * Atualiza a memória com merge recursivo
   * @param {Object} updates - Ex: { identity: { name: { value: "Francesco" } } }
   * @returns {Object} dados atualizados
   */
  async update(updates) {
    await this._ensureInit();
    
    return this._withLock(async () => {
      this._deepMerge(this.data, updates);
      this.data._meta.updatedAt = new Date().toISOString();
      this.data._meta.totalUpdates++;
      this._dirty = true;
      this._scheduleSave();
      this.emit('updated', { updates, total: this._countEntries() });
      return this.data;
    });
  }

  /**
   * Lê uma categoria inteira ou um campo específico
   * @param {string} category - 'identity', 'preferences', 'relationships', 'notes'
   * @param {string} [key] - chave específica (opcional)
   * @returns {Object|null}
   */
  async get(category, key) {
    await this._ensureInit();
    
    if (!this.data[category]) return null;
    if (key) return this.data[category][key] || null;
    return { ...this.data[category] };
  }

  /**
   * Remove um campo específico de uma categoria
   * @param {string} category
   * @param {string} key
   * @returns {boolean} true se removido
   */
  async remove(category, key) {
    await this._ensureInit();
    
    return this._withLock(async () => {
      if (!this.data[category] || !this.data[category][key]) return false;
      delete this.data[category][key];
      this.data._meta.updatedAt = new Date().toISOString();
      this.data._meta.totalUpdates++;
      this._dirty = true;
      this._scheduleSave();
      this.emit('removed', { category, key });
      return true;
    });
  }

  /**
   * Retorna toda a memória (snapshot read-only)
   * @returns {Object}
   */
  async getAll() {
    await this._ensureInit();
    return JSON.parse(JSON.stringify(this.data));
  }

  /**
   * Limpa toda a memória (reset)
   */
  async clear() {
    return this._withLock(async () => {
      this.data = this._createDefault();
      this._dirty = true;
      await this._save();
      this.emit('cleared');
      return this.data;
    });
  }

  // ─── Persistência ────────────────────────────────────

  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._save(), SAVE_DEBOUNCE_MS);
  }

  async _save() {
    if (!this._dirty) return;
    try {
      const json = JSON.stringify(this.data, null, 2);
      fs.writeFileSync(this.filePath, json, 'utf-8');
      this._dirty = false;
      console.log('[MEMORY-MGR] Salvo:', this._countEntries(), 'entradas');
    } catch (e) {
      console.error('[MEMORY-MGR] Erro ao salvar:', e.message);
    }
  }

  /** Força salvamento imediato (útil antes de shutdown) */
  async flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    await this._withLock(() => this._save());
  }

  // ─── Utilitários ─────────────────────────────────────

  async _ensureInit() {
    if (!this._initialized) await this.init();
  }

  _countEntries() {
    if (!this.data) return 0;
    let count = 0;
    for (const cat of ['identity', 'preferences', 'relationships', 'notes']) {
      if (this.data[cat]) count += Object.keys(this.data[cat]).length;
    }
    return count;
  }

  /**
   * Formata a memória para injeção no system prompt
   * Limite de ~800 tokens (~3200 chars)
   * @returns {string}
   */
  async formatMemoryForPrompt() {
    await this._ensureInit();
    
    const MAX_CHARS = 3200;
    const sections = [];

    // Identity
    const identity = this.data.identity || {};
    if (Object.keys(identity).length > 0) {
      const lines = Object.entries(identity)
        .map(([k, v]) => `- ${k}: ${typeof v === 'object' ? v.value : v}`)
        .join('\n');
      sections.push(`[IDENTIDADE DO USUÁRIO]\n${lines}`);
    }

    // Preferences
    const prefs = this.data.preferences || {};
    if (Object.keys(prefs).length > 0) {
      const lines = Object.entries(prefs)
        .map(([k, v]) => `- ${k}: ${typeof v === 'object' ? v.value : v}`)
        .join('\n');
      sections.push(`[PREFERÊNCIAS]\n${lines}`);
    }

    // Relationships
    const rels = this.data.relationships || {};
    if (Object.keys(rels).length > 0) {
      const lines = Object.entries(rels)
        .map(([k, v]) => `- ${k}: ${typeof v === 'object' ? v.value : v}`)
        .join('\n');
      sections.push(`[RELACIONAMENTOS]\n${lines}`);
    }

    // Notes
    const notes = this.data.notes || {};
    if (Object.keys(notes).length > 0) {
      const lines = Object.entries(notes)
        .map(([k, v]) => `- ${k}: ${typeof v === 'object' ? v.value : v}`)
        .join('\n');
      sections.push(`[NOTAS]\n${lines}`);
    }

    let result = sections.join('\n\n');

    // Truncar se exceder o limite
    if (result.length > MAX_CHARS) {
      result = result.substring(0, MAX_CHARS) + '\n... (memória truncada por limite de tokens)';
    }

    return result.length > 0 ? `[USER MEMORY]\n${result}` : '';
  }

  /**
   * Busca na memória por valor (across all categories)
   * @param {string} query - termo de busca
   * @returns {Array<{category, key, value}>}
   */
  async search(query) {
    await this._ensureInit();
    
    const results = [];
    const q = query.toLowerCase();
    
    for (const cat of ['identity', 'preferences', 'relationships', 'notes']) {
      const data = this.data[cat] || {};
      for (const [key, val] of Object.entries(data)) {
        const value = typeof val === 'object' ? val.value : val;
        if (
          key.toLowerCase().includes(q) ||
          (typeof value === 'string' && value.toLowerCase().includes(q))
        ) {
          results.push({ category: cat, key, value });
        }
      }
    }
    return results;
  }

  /**
   * Retorna estatísticas da memória
   */
  async stats() {
    await this._ensureInit();
    
    const cats = {};
    for (const cat of ['identity', 'preferences', 'relationships', 'notes']) {
      cats[cat] = Object.keys(this.data[cat] || {}).length;
    }
    return {
      totalEntries: this._countEntries(),
      categories: cats,
      version: this.data._meta?.version,
      createdAt: this.data._meta?.createdAt,
      updatedAt: this.data._meta?.updatedAt,
      totalUpdates: this.data._meta?.totalUpdates || 0
    };
  }

  /** Destroy — flush e cleanup */
  async destroy() {
    await this.flush();
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this.removeAllListeners();
  }
}

// ─── Singleton export ──────────────────────────────────
let instance = null;

function getMemoryManager(memoryDir) {
  if (!instance) {
    instance = new MemoryManager(memoryDir);
  }
  return instance;
}

module.exports = { MemoryManager, getMemoryManager };
