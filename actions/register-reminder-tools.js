/**
 * Reminder Tools Integration — Buddy 2.0
 * 
 * Registra Reminder como tools no Tool Registry.
 * Tools: reminder_add, reminder_list, reminder_remove
 * 
 * @module actions/register-reminder-tools
 */

const { Reminder } = require('./reminder');
const { getToolRegistry } = require('../agent/tool-registry');

function registerReminderTools(options = {}) {
  const { onReminder, onExpression } = options;
  const registry = getToolRegistry();

  const reminder = new Reminder({ onReminder });
  reminder.start();

  console.log('[ReminderTools] Registrando tools...');

  registry.register({
    name: 'reminder_add',
    description: 'Adiciona um lembrete/alarme. Aceita horário ("14:30"), data ("2026-03-20 10:00"), relativo ("em 30min", "em 2h"), ou "amanhã 09:00". Pode repetir daily ou weekly.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Mensagem do lembrete. Ex: "Reunião com o time", "Tomar remédio"' },
        datetime: { type: 'string', description: 'Quando disparar. Ex: "15:00", "2026-03-20 10:00", "em 30min", "amanhã 09:00"' },
        repeat: { type: 'string', description: 'Repetição: "daily", "weekly", ou null (padrão)' },
      },
      required: ['message', 'datetime'],
    },
    execute: async (args) => {
      const r = reminder.add({ message: args.message, datetime: args.datetime, repeat: args.repeat });
      if (!r.success) return `Erro: ${r.error}`;
      return `Lembrete criado! "${r.message}" agendado para ${r.datetime} (ID: ${r.id})`;
    },
    source: 'reminder', metadata: { category: 'reminder' },
  });

  registry.register({
    name: 'reminder_list',
    description: 'Lista todos os lembretes ativos.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const r = reminder.list();
      if (r.count === 0) return 'Nenhum lembrete agendado.';
      const list = r.reminders.map(rem => `[${rem.id}] ${rem.datetime} — "${rem.message}"${rem.repeat ? ` (${rem.repeat})` : ''}`).join('\n');
      return `${r.count} lembretes:\n${list}`;
    },
    source: 'reminder', metadata: { category: 'reminder' },
  });

  registry.register({
    name: 'reminder_remove',
    description: 'Remove um lembrete pelo ID.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID do lembrete (use reminder_list para ver IDs)' },
      },
      required: ['id'],
    },
    execute: async (args) => {
      const r = reminder.remove(args.id);
      if (!r.success) return `Erro: ${r.error}`;
      return `Lembrete removido: "${r.message}"`;
    },
    source: 'reminder', metadata: { category: 'reminder' },
  });

  const stats = registry.getBySource('reminder');
  console.log(`[ReminderTools] ${stats.length} tools registradas`);

  return { reminder };
}

module.exports = { registerReminderTools };
