/**
 * settings-manager.js — Gerenciador de Configurações do Buddy
 * 
 * Persiste em settings.json na raiz do projeto.
 * Configs: modelo IA, API keys, toggles de voz e proteção destrutiva.
 */

const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

const DEFAULT_SETTINGS = {
  // Modelo de IA
  aiModel: 'gpt-4o-mini',
  aiProvider: 'openai', // openai, anthropic, google
  
  // API Keys
  openaiApiKey: '',
  anthropicApiKey: '',
  googleApiKey: '',
  weatherApiKey: '',
  telegramBotToken: '',
  
  // Fallback
  fallbackEnabled: true,
  fallbackOrder: ['openai', 'anthropic', 'google'],
  
  // Toggles
  voiceEnabled: true,
  destructiveProtection: true,
  memoryExtraction: true,
  
  // Agent
  maxAgentIterations: 25,

  // Aparência
  faceStyle: 'v1', // 'v1' (SVG clássico) ou 'v2' (CSS tech)
};

class SettingsManager {
  constructor() {
    this.settings = null;
    this.loaded = false;
  }

  load() {
    if (this.loaded) return this.settings;
    
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
        const saved = JSON.parse(raw);
        // Merge com defaults (garante novas keys)
        this.settings = { ...DEFAULT_SETTINGS, ...saved };
      } else {
        this.settings = { ...DEFAULT_SETTINGS };
      }
    } catch (e) {
      console.error('[SETTINGS] Erro ao carregar:', e.message);
      this.settings = { ...DEFAULT_SETTINGS };
    }
    
    this.loaded = true;
    return this.settings;
  }

  save(newSettings) {
    try {
      // Merge parcial
      this.settings = { ...this.settings, ...newSettings };
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2), 'utf-8');
      console.log('[SETTINGS] Salvo com sucesso');
      return true;
    } catch (e) {
      console.error('[SETTINGS] Erro ao salvar:', e.message);
      return false;
    }
  }

  get(key) {
    if (!this.loaded) this.load();
    return this.settings[key];
  }

  getAll() {
    if (!this.loaded) this.load();
    // Retorna cópia com API keys mascaradas para o frontend
    const safe = { ...this.settings };
    return safe;
  }

  getAllSafe() {
    if (!this.loaded) this.load();
    const safe = { ...this.settings };
    // Mascara API keys para enviar ao renderer
    for (const key of ['openaiApiKey', 'anthropicApiKey', 'googleApiKey', 'weatherApiKey', 'telegramBotToken']) {
      if (safe[key] && safe[key].length > 8) {
        safe[key] = safe[key].substring(0, 4) + '•'.repeat(safe[key].length - 8) + safe[key].slice(-4);
      }
    }
    return safe;
  }

  /**
   * Migra settings do main.js hardcoded para settings.json
   * Roda uma vez — se settings.json já existe, pula
   */
  migrateFromMainJs(apiKey, model) {
    if (fs.existsSync(SETTINGS_FILE)) return false;
    
    this.settings = { ...DEFAULT_SETTINGS };
    if (apiKey && apiKey !== 'SUA_OPENAI_API_KEY_AQUI') {
      this.settings.openaiApiKey = apiKey;
    }
    if (model) {
      this.settings.aiModel = model;
    }
    this.save(this.settings);
    console.log('[SETTINGS] Migrado do main.js para settings.json');
    return true;
  }
}

// Singleton
const settingsManager = new SettingsManager();
module.exports = settingsManager;
