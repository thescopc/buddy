/**
 * Send Message — Buddy 2.0
 * 
 * Envia mensagens via:
 * - Telegram Bot API (direto, requer bot token + chat_id)
 * - WhatsApp Web (via browser automation, requer login prévio)
 * 
 * @module actions/send-message
 */

const https = require('https');

const TELEGRAM_API = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 10000;

class SendMessage {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.telegramToken] - Telegram Bot API token
   * @param {Object} [options.browserControl] - Instância do BrowserControl (para WhatsApp)
   */
  constructor(options = {}) {
    this._telegramToken = options.telegramToken || null;
    this._browserControl = options.browserControl || null;
  }

  // ============================================================
  // TELEGRAM
  // ============================================================

  /**
   * Envia mensagem via Telegram Bot API.
   * @param {string} chatId - Chat ID do destinatário
   * @param {string} message - Mensagem a enviar
   * @returns {Promise<{success:boolean, error?:string}>}
   */
  async sendTelegram(chatId, message) {
    try {
      if (!this._telegramToken) {
        return { success: false, error: 'Token do Telegram Bot não configurado' };
      }

      const url = `${TELEGRAM_API}/bot${this._telegramToken}/sendMessage`;
      const body = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' });

      const result = await this._httpPost(url, body, { 'Content-Type': 'application/json' });
      const data = JSON.parse(result);

      if (!data.ok) {
        return { success: false, error: data.description || 'Erro desconhecido do Telegram' };
      }

      return { success: true, messageId: data.result?.message_id, chatId };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // WHATSAPP WEB (via Browser Automation)
  // ============================================================

  /**
   * Envia mensagem no WhatsApp Web via automação de browser.
   * Requer que o WhatsApp Web já esteja logado.
   * Usa a URL API do WhatsApp para abrir conversa diretamente.
   * 
   * @param {string} contact - Nome do contato ou número (+5511999999999)
   * @param {string} message - Mensagem a enviar
   * @returns {Promise<{success:boolean, error?:string}>}
   */
  async sendWhatsApp(contact, message) {
    try {
      if (!this._browserControl) {
        return { success: false, error: 'BrowserControl não disponível para WhatsApp' };
      }

      // Se é número, usa a API direta do WhatsApp
      const isNumber = /^\+?\d{10,15}$/.test(contact.replace(/[\s\-()]/g, ''));

      if (isNumber) {
        const cleanNumber = contact.replace(/[\s\-()+]/g, '');
        const encodedMsg = encodeURIComponent(message);
        const url = `https://web.whatsapp.com/send?phone=${cleanNumber}&text=${encodedMsg}`;

        const nav = await this._browserControl.goTo(url, { waitAfterLoad: 5000 });
        if (!nav.success) return { success: false, error: `Erro ao abrir WhatsApp: ${nav.error}` };
      } else {
        // Se é nome de contato, abre WhatsApp Web e busca
        const nav = await this._browserControl.goTo('https://web.whatsapp.com', { waitAfterLoad: 5000 });
        if (!nav.success) return { success: false, error: `Erro ao abrir WhatsApp: ${nav.error}` };

        // Busca o contato
        const searchResult = await this._browserControl.smartClick('campo de busca');
        if (!searchResult.success) {
          // Tenta pelo seletor direto
          await this._browserControl.click('[data-testid="chat-list-search"]').catch(() => {});
        }

        // Digita o nome do contato na busca
        const page = this._browserControl._getActivePage();
        const searchBox = page.locator('[contenteditable="true"][data-tab="3"]').first();
        await searchBox.fill(contact);
        await page.waitForTimeout(2000);

        // Clica no primeiro resultado
        const contactResult = page.locator(`span[title*="${contact}" i]`).first();
        try {
          await contactResult.click({ timeout: 5000 });
          await page.waitForTimeout(1000);
        } catch (_) {
          return { success: false, error: `Contato "${contact}" não encontrado no WhatsApp` };
        }

        // Digita a mensagem
        const msgBox = page.locator('[contenteditable="true"][data-tab="10"]').first();
        await msgBox.click();
        await msgBox.fill(message);
      }

      // Aguarda o botão de enviar e pressiona Enter
      const page = this._browserControl._getActivePage();
      await page.waitForTimeout(2000);

      // Tenta clicar no botão de enviar ou pressionar Enter
      try {
        const sendBtn = page.locator('[data-testid="send"], [aria-label="Enviar"], [aria-label="Send"]').first();
        await sendBtn.click({ timeout: 3000 });
      } catch (_) {
        await page.keyboard.press('Enter');
      }

      await page.waitForTimeout(2000);

      console.log(`[SendMessage] WhatsApp: mensagem enviada para "${contact}"`);
      return { success: true, contact, platform: 'whatsapp' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // HTTP HELPER
  // ============================================================

  _httpPost(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        timeout: REQUEST_TIMEOUT_MS,
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = { SendMessage };
