/**
 * Reminder/Scheduler — Buddy 2.0
 * 
 * Agenda tarefas com data/hora, persistência JSON, e notificação.
 * - Agendamentos one-shot (data/hora específica)
 * - Agendamentos recorrentes (cron expression)
 * - Persistência em JSON
 * - Callback para notificação (TTS)
 * 
 * @module actions/reminder
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

// ============================================================
// CONSTANTES
// ============================================================
const CHECK_INTERVAL_MS = 30000; // Checa a cada 30s
const DEFAULT_FILE = path.join(__dirname, '..', 'memory', 'reminders.json');

class Reminder {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.filePath] - Caminho do JSON de persistência
   * @param {Function} [options.onReminder] - Callback(reminder) quando dispara
   */
  constructor(options = {}) {
    this._filePath = options.filePath || DEFAULT_FILE;
    this._onReminder = options.onReminder || null;
    this._reminders = [];
    this._interval = null;
    this._counter = 0;

    this._load();
  }

  // ============================================================
  // CRUD
  // ============================================================

  /**
   * Adiciona um lembrete.
   * @param {Object} opts
   * @param {string} opts.message - Mensagem do lembrete
   * @param {string} opts.datetime - Data/hora ISO ou "HH:MM" para hoje
   * @param {string} [opts.repeat] - 'daily', 'weekly', ou null
   * @returns {{success:boolean, id?:string, datetime?:string, error?:string}}
   */
  add(opts) {
    try {
      const { message, datetime, repeat } = opts;
      if (!message) return { success: false, error: 'Mensagem obrigatória' };
      if (!datetime) return { success: false, error: 'Data/hora obrigatória' };

      const parsedDate = this._parseDateTime(datetime);
      if (!parsedDate) return { success: false, error: `Data/hora inválida: "${datetime}"` };

      this._counter++;
      const id = `rem_${Date.now()}_${this._counter}`;

      const reminder = {
        id,
        message,
        datetime: parsedDate.toISOString(),
        repeat: repeat || null,
        active: true,
        createdAt: new Date().toISOString(),
        firedCount: 0,
      };

      this._reminders.push(reminder);
      this._save();

      console.log(`[Reminder] Adicionado: "${message}" em ${parsedDate.toLocaleString('pt-BR')}`);
      return { success: true, id, datetime: parsedDate.toLocaleString('pt-BR'), message };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Remove um lembrete por ID.
   */
  remove(id) {
    const idx = this._reminders.findIndex(r => r.id === id);
    if (idx === -1) return { success: false, error: `Lembrete "${id}" não encontrado` };
    const removed = this._reminders.splice(idx, 1)[0];
    this._save();
    return { success: true, id, message: removed.message };
  }

  /**
   * Lista lembretes ativos.
   */
  list(includeInactive = false) {
    const filtered = includeInactive ? this._reminders : this._reminders.filter(r => r.active);
    return {
      success: true,
      count: filtered.length,
      reminders: filtered.map(r => ({
        id: r.id,
        message: r.message,
        datetime: new Date(r.datetime).toLocaleString('pt-BR'),
        repeat: r.repeat,
        active: r.active,
      })),
    };
  }

  /**
   * Limpa lembretes inativos (já disparados e sem repeat).
   */
  cleanup() {
    const before = this._reminders.length;
    this._reminders = this._reminders.filter(r => r.active);
    this._save();
    return { success: true, removed: before - this._reminders.length };
  }

  // ============================================================
  // SCHEDULER (loop de checagem)
  // ============================================================

  /**
   * Inicia o loop de checagem.
   */
  start() {
    if (this._interval) return;
    this._interval = setInterval(() => this._check(), CHECK_INTERVAL_MS);
    console.log(`[Reminder] Scheduler iniciado (check a cada ${CHECK_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Para o loop.
   */
  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  /**
   * Checa se algum lembrete precisa disparar.
   */
  _check() {
    const now = new Date();
    for (const r of this._reminders) {
      if (!r.active) continue;
      const target = new Date(r.datetime);
      if (now >= target) {
        this._fire(r);
      }
    }
  }

  /**
   * Dispara um lembrete.
   */
  _fire(reminder) {
    reminder.firedCount++;
    console.log(`[Reminder] DISPARADO: "${reminder.message}"`);

    if (this._onReminder) {
      try { this._onReminder(reminder); } catch (_) {}
    }

    if (reminder.repeat === 'daily') {
      const next = new Date(reminder.datetime);
      next.setDate(next.getDate() + 1);
      reminder.datetime = next.toISOString();
    } else if (reminder.repeat === 'weekly') {
      const next = new Date(reminder.datetime);
      next.setDate(next.getDate() + 7);
      reminder.datetime = next.toISOString();
    } else {
      reminder.active = false;
    }

    this._save();
  }

  // ============================================================
  // PERSISTÊNCIA E PARSING
  // ============================================================

  _load() {
    try {
      if (fs.existsSync(this._filePath)) {
        const data = fs.readFileSync(this._filePath, 'utf-8');
        this._reminders = JSON.parse(data);
        this._counter = this._reminders.length;
      }
    } catch (err) {
      console.warn('[Reminder] Erro ao carregar:', err.message);
      this._reminders = [];
    }
  }

  _save() {
    try {
      const dir = path.dirname(this._filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._filePath, JSON.stringify(this._reminders, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Reminder] Erro ao salvar:', err.message);
    }
  }

  /**
   * Parse data/hora flexível.
   * Aceita: "HH:MM", "HH:MM:SS", "YYYY-MM-DD HH:MM", ISO, "amanhã HH:MM", etc.
   */
  _parseDateTime(str) {
    const s = str.trim();

    // ISO ou data completa
    const isoDate = new Date(s);
    if (!isNaN(isoDate.getTime()) && s.includes('-')) return isoDate;

    // "HH:MM" ou "HH:MM:SS" — hoje
    const timeMatch = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (timeMatch) {
      const now = new Date();
      now.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), parseInt(timeMatch[3] || '0'), 0);
      // Se já passou, agenda pra amanhã
      if (now <= new Date()) now.setDate(now.getDate() + 1);
      return now;
    }

    // "amanhã HH:MM" ou "amanha HH:MM"
    const tomorrowMatch = s.match(/^amanh[ãa]\s+(\d{1,2}):(\d{2})/i);
    if (tomorrowMatch) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(parseInt(tomorrowMatch[1]), parseInt(tomorrowMatch[2]), 0, 0);
      return d;
    }

    // "em Xmin" ou "em X minutos"
    const minMatch = s.match(/^em\s+(\d+)\s*min/i);
    if (minMatch) {
      const d = new Date();
      d.setMinutes(d.getMinutes() + parseInt(minMatch[1]));
      return d;
    }

    // "em Xh" ou "em X horas"
    const hourMatch = s.match(/^em\s+(\d+)\s*h/i);
    if (hourMatch) {
      const d = new Date();
      d.setHours(d.getHours() + parseInt(hourMatch[1]));
      return d;
    }

    return null;
  }
}

module.exports = { Reminder };
