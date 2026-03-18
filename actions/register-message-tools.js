/**
 * Send Message Tools Integration — Buddy 2.0
 * Tools: send_whatsapp, send_telegram
 * @module actions/register-message-tools
 */

const { SendMessage } = require('./send-message');
const { getToolRegistry } = require('../agent/tool-registry');

function registerMessageTools(options = {}) {
  const { telegramToken, browserControl, onExpression } = options;
  const registry = getToolRegistry();

  const messenger = new SendMessage({ telegramToken, browserControl });

  console.log('[MessageTools] Registrando tools...');

  registry.register({
    name: 'send_whatsapp',
    description: 'Envia mensagem no WhatsApp Web. Aceita nome de contato ou número de telefone. Requer WhatsApp Web logado no browser.',
    parameters: {
      type: 'object',
      properties: {
        contact: { type: 'string', description: 'Nome do contato ou número (+5511999999999)' },
        message: { type: 'string', description: 'Mensagem a enviar' },
      },
      required: ['contact', 'message'],
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const r = await messenger.sendWhatsApp(args.contact, args.message);
      if (onExpression) onExpression('happy');
      if (!r.success) return `Erro ao enviar WhatsApp: ${r.error}`;
      return `Mensagem enviada para "${args.contact}" no WhatsApp`;
    },
    source: 'message', metadata: { category: 'message' },
  });

  registry.register({
    name: 'send_telegram',
    description: 'Envia mensagem via Telegram Bot API. Requer bot token e chat_id configurados.',
    parameters: {
      type: 'object',
      properties: {
        chatId: { type: 'string', description: 'Chat ID do destinatário no Telegram' },
        message: { type: 'string', description: 'Mensagem a enviar (suporta HTML)' },
      },
      required: ['chatId', 'message'],
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const r = await messenger.sendTelegram(args.chatId, args.message);
      if (onExpression) onExpression('happy');
      if (!r.success) return `Erro ao enviar Telegram: ${r.error}`;
      return `Mensagem enviada no Telegram (msg ID: ${r.messageId})`;
    },
    source: 'message', metadata: { category: 'message' },
  });

  const stats = registry.getBySource('message');
  console.log(`[MessageTools] ${stats.length} tools registradas`);
  return { messenger };
}

module.exports = { registerMessageTools };
