/**
 * Browser Control — Buddy 2.0
 * 
 * Controle programático do navegador via Playwright (Chromium).
 * Lifecycle: launch → page → actions → close
 * 
 * - Usa Playwright para automação real de browser
 * - Detecta Chrome/Edge instalado do usuário (preferência)
 * - Fallback para Chromium bundled do Playwright
 * - Totalmente async para não bloquear a UI do Electron
 * - Gerencia contexto (browser, page) com auto-cleanup
 * 
 * @module actions/browser-control
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// ============================================================
// CONSTANTES
// ============================================================
const DEFAULT_TIMEOUT_MS = 30000;     // Timeout padrão para ações
const NAVIGATION_TIMEOUT_MS = 45000;  // Timeout para navegação
const PAGE_LOAD_WAIT_MS = 2000;       // Espera extra após load
const MAX_PAGES = 5;                  // Máximo de abas simultâneas

/** Caminhos comuns do Chrome/Edge no Windows */
const BROWSER_PATHS_WIN = [
  // Chrome
  path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  // Edge
  path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
];

class BrowserControl {
  constructor(options = {}) {
    /** @type {import('playwright').Browser|null} */
    this._browser = null;

    /** @type {import('playwright').BrowserContext|null} */
    this._context = null;

    /** @type {import('playwright').Page|null} */
    this._activePage = null;

    /** @type {Map<string, import('playwright').Page>} Páginas abertas por ID */
    this._pages = new Map();

    /** @type {number} Contador de páginas */
    this._pageCounter = 0;

    /** @type {boolean} Se o browser está aberto */
    this._isRunning = false;

    /** @type {string|null} Caminho do executável do browser */
    this._executablePath = options.executablePath || null;

    /** @type {boolean} Se deve abrir em modo headless */
    this._headless = options.headless !== undefined ? options.headless : false;

    /** @type {number} Timeout padrão */
    this._defaultTimeout = options.timeout || DEFAULT_TIMEOUT_MS;

    /** @type {Function|null} Callback para eventos */
    this._onEvent = options.onEvent || null;
  }

  // ============================================================
  // LIFECYCLE — Launch / Close
  // ============================================================

  /**
   * Detecta o browser instalado do usuário (Chrome ou Edge).
   * @returns {string|null} Caminho do executável ou null
   */
  _detectBrowser() {
    if (this._executablePath && fs.existsSync(this._executablePath)) {
      return this._executablePath;
    }

    if (process.platform === 'win32') {
      for (const p of BROWSER_PATHS_WIN) {
        if (p && fs.existsSync(p)) {
          console.log(`[BrowserControl] Detectado browser: ${p}`);
          return p;
        }
      }
    }

    // Em outros OS, Playwright usa o bundled Chromium
    console.log('[BrowserControl] Nenhum browser local encontrado, usando Chromium bundled');
    return null;
  }

  /**
   * Inicia o browser.
   * Detecta Chrome/Edge instalado; fallback para Chromium do Playwright.
   * 
   * @param {Object} [options={}]
   * @param {boolean} [options.headless=false] - Modo headless
   * @returns {Promise<{success: boolean, browser?: string, error?: string}>}
   */
  async launch(options = {}) {
    try {
      if (this._isRunning) {
        return { success: true, browser: 'already-running' };
      }

      const headless = options.headless !== undefined ? options.headless : this._headless;
      const executablePath = this._detectBrowser();

      const launchOptions = {
        headless,
        args: [
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-infobars',
        ],
      };

      if (executablePath) {
        launchOptions.executablePath = executablePath;
      }

      this._emit('launching', { headless, executablePath });

      this._browser = await chromium.launch(launchOptions);
      this._context = await this._browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
      });

      this._context.setDefaultTimeout(this._defaultTimeout);
      this._context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

      // Cria a primeira página
      this._activePage = await this._context.newPage();
      const pageId = this._generatePageId();
      this._pages.set(pageId, this._activePage);

      this._isRunning = true;

      console.log(`[BrowserControl] Browser iniciado (${executablePath ? 'local' : 'chromium-bundled'}, headless=${headless})`);
      this._emit('launched', { browser: executablePath || 'chromium-bundled' });

      return {
        success: true,
        browser: executablePath ? path.basename(executablePath) : 'chromium-bundled',
        pageId,
      };
    } catch (err) {
      console.error('[BrowserControl] Erro ao iniciar browser:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Fecha o browser e limpa recursos.
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async close() {
    try {
      if (!this._isRunning) {
        return { success: true };
      }

      this._pages.clear();
      this._activePage = null;
      this._pageCounter = 0;

      if (this._context) {
        await this._context.close().catch(() => {});
        this._context = null;
      }

      if (this._browser) {
        await this._browser.close().catch(() => {});
        this._browser = null;
      }

      this._isRunning = false;
      console.log('[BrowserControl] Browser fechado');
      this._emit('closed', {});

      return { success: true };
    } catch (err) {
      console.error('[BrowserControl] Erro ao fechar browser:', err.message);
      this._isRunning = false;
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // NAVEGAÇÃO
  // ============================================================

  /**
   * Navega para uma URL.
   * Auto-launch se o browser não estiver rodando.
   * 
   * @param {string} url - URL para navegar (aceita sem http://)
   * @param {Object} [options={}]
   * @param {number} [options.waitAfterLoad=2000] - Ms para esperar após page load
   * @returns {Promise<{success: boolean, url?: string, title?: string, error?: string}>}
   */
  async goTo(url, options = {}) {
    try {
      // Auto-launch se necessário
      if (!this._isRunning) {
        const launchResult = await this.launch();
        if (!launchResult.success) {
          return { success: false, error: `Falha ao iniciar browser: ${launchResult.error}` };
        }
      }

      // Normaliza URL
      let normalizedUrl = url.trim();
      if (!normalizedUrl.match(/^https?:\/\//i)) {
        normalizedUrl = 'https://' + normalizedUrl;
      }

      this._emit('navigating', { url: normalizedUrl });

      const page = this._getActivePage();
      await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded' });

      // Espera extra para JS render
      const waitMs = options.waitAfterLoad || PAGE_LOAD_WAIT_MS;
      await page.waitForTimeout(waitMs);

      const title = await page.title();
      const finalUrl = page.url();

      console.log(`[BrowserControl] Navegou para: ${finalUrl} — "${title}"`);
      this._emit('navigated', { url: finalUrl, title });

      return { success: true, url: finalUrl, title };
    } catch (err) {
      console.error('[BrowserControl] Erro ao navegar:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Volta para a página anterior.
   * @returns {Promise<{success: boolean, url?: string, title?: string, error?: string}>}
   */
  async goBack() {
    try {
      this._ensureRunning();
      const page = this._getActivePage();
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(PAGE_LOAD_WAIT_MS);
      return { success: true, url: page.url(), title: await page.title() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Avança para a próxima página.
   * @returns {Promise<{success: boolean, url?: string, title?: string, error?: string}>}
   */
  async goForward() {
    try {
      this._ensureRunning();
      const page = this._getActivePage();
      await page.goForward({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(PAGE_LOAD_WAIT_MS);
      return { success: true, url: page.url(), title: await page.title() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // INTERAÇÃO COM PÁGINA
  // ============================================================

  /**
   * Clica em um elemento por seletor CSS ou texto visível.
   * 
   * @param {string} selector - Seletor CSS ou texto (prefixe com "text=" para texto)
   * @param {Object} [options={}]
   * @param {number} [options.timeout] - Timeout em ms
   * @returns {Promise<{success: boolean, selector?: string, error?: string}>}
   */
  async click(selector, options = {}) {
    try {
      this._ensureRunning();
      const page = this._getActivePage();
      const resolvedSelector = this._resolveSelector(selector);
      await page.click(resolvedSelector, { timeout: options.timeout || this._defaultTimeout });
      await page.waitForTimeout(500); // pequena espera após clique
      return { success: true, selector: resolvedSelector };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Digita texto em um campo de input.
   * 
   * @param {string} selector - Seletor CSS do campo
   * @param {string} text - Texto a digitar
   * @param {Object} [options={}]
   * @param {boolean} [options.clear=true] - Limpa o campo antes de digitar
   * @param {number} [options.delay=50] - Delay entre teclas em ms
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async type(selector, text, options = {}) {
    try {
      this._ensureRunning();
      const page = this._getActivePage();
      const resolvedSelector = this._resolveSelector(selector);

      if (options.clear !== false) {
        await page.click(resolvedSelector, { clickCount: 3 }); // seleciona tudo
        await page.keyboard.press('Backspace');
      }

      await page.type(resolvedSelector, text, { delay: options.delay || 50 });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Pressiona uma tecla ou combinação.
   * 
   * @param {string} key - Tecla (Enter, Tab, Escape, Control+A, etc.)
   * @returns {Promise<{success: boolean, key?: string, error?: string}>}
   */
  async press(key) {
    try {
      this._ensureRunning();
      const page = this._getActivePage();
      await page.keyboard.press(key);
      return { success: true, key };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Scroll na página.
   * 
   * @param {string} [direction='down'] - 'up' ou 'down'
   * @param {number} [amount=3] - Quantidade de scrolls
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async scroll(direction = 'down', amount = 3) {
    try {
      this._ensureRunning();
      const page = this._getActivePage();
      const delta = direction === 'up' ? -300 : 300;
      for (let i = 0; i < amount; i++) {
        await page.mouse.wheel(0, delta);
        await page.waitForTimeout(100);
      }
      return { success: true, direction, amount };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Extrai o texto visível da página ou de um elemento.
   * 
   * @param {string} [selector] - Seletor CSS (opcional; sem ele, pega todo o body)
   * @param {Object} [options={}]
   * @param {number} [options.maxLength=5000] - Máximo de caracteres
   * @returns {Promise<{success: boolean, text?: string, url?: string, title?: string, error?: string}>}
   */
  async getText(selector, options = {}) {
    try {
      this._ensureRunning();
      const page = this._getActivePage();
      const maxLen = options.maxLength || 5000;

      let text;
      if (selector) {
        const resolvedSelector = this._resolveSelector(selector);
        text = await page.textContent(resolvedSelector);
      } else {
        text = await page.evaluate(() => {
          // Extrai texto limpo do body, removendo scripts e styles
          const clone = document.body.cloneNode(true);
          clone.querySelectorAll('script, style, noscript, svg').forEach(el => el.remove());
          return clone.innerText || clone.textContent || '';
        });
      }

      // Limpa whitespace excessivo
      text = (text || '').replace(/\s+/g, ' ').trim();
      if (text.length > maxLen) {
        text = text.substring(0, maxLen) + '... [truncado]';
      }

      return {
        success: true,
        text,
        url: page.url(),
        title: await page.title(),
        length: text.length,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Busca no Google/DuckDuckGo.
   * Navega para o motor de busca e digita a query.
   * 
   * @param {string} query - Termo de busca
   * @param {string} [engine='google'] - Motor: 'google' ou 'duckduckgo'
   * @returns {Promise<{success: boolean, results?: string, error?: string}>}
   */
  async search(query, engine = 'google') {
    try {
      const searchUrls = {
        google: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        duckduckgo: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        bing: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
      };

      const url = searchUrls[engine] || searchUrls.google;
      const navResult = await this.goTo(url, { waitAfterLoad: 3000 });
      if (!navResult.success) return navResult;

      // Extrai resultados da busca
      const textResult = await this.getText(null, { maxLength: 3000 });
      return {
        success: true,
        query,
        engine,
        results: textResult.text || 'Sem resultados visíveis',
        url: navResult.url,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Tira screenshot da página atual.
   * 
   * @param {Object} [options={}]
   * @param {boolean} [options.fullPage=false] - Captura a página inteira
   * @returns {Promise<{success: boolean, base64?: string, error?: string}>}
   */
  async screenshot(options = {}) {
    try {
      this._ensureRunning();
      const page = this._getActivePage();
      const buffer = await page.screenshot({
        fullPage: options.fullPage || false,
        type: 'jpeg',
        quality: 70,
      });
      const base64 = buffer.toString('base64');
      return { success: true, base64, sizeKB: Math.round(buffer.length / 1024) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // GERENCIAMENTO DE PÁGINAS (ABAS)
  // ============================================================

  /**
   * Abre uma nova aba.
   * @param {string} [url] - URL para abrir (opcional)
   * @returns {Promise<{success: boolean, pageId?: string, error?: string}>}
   */
  async newPage(url) {
    try {
      this._ensureRunning();

      if (this._pages.size >= MAX_PAGES) {
        return { success: false, error: `Limite de ${MAX_PAGES} abas atingido` };
      }

      const page = await this._context.newPage();
      const pageId = this._generatePageId();
      this._pages.set(pageId, page);
      this._activePage = page;

      if (url) {
        await this.goTo(url);
      }

      return { success: true, pageId };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Troca para uma aba específica.
   * @param {string} pageId - ID da aba
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async switchPage(pageId) {
    try {
      this._ensureRunning();
      const page = this._pages.get(pageId);
      if (!page) {
        return { success: false, error: `Aba "${pageId}" não encontrada. Disponíveis: ${[...this._pages.keys()].join(', ')}` };
      }
      this._activePage = page;
      await page.bringToFront();
      return { success: true, pageId, url: page.url(), title: await page.title() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Fecha uma aba.
   * @param {string} [pageId] - ID da aba (fecha a ativa se omitido)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async closePage(pageId) {
    try {
      this._ensureRunning();

      const targetId = pageId || this._getActivePageId();
      const page = this._pages.get(targetId);
      if (!page) {
        return { success: false, error: `Aba "${targetId}" não encontrada` };
      }

      await page.close();
      this._pages.delete(targetId);

      // Se fechou a ativa, troca pra outra
      if (this._activePage === page) {
        const remaining = [...this._pages.values()];
        this._activePage = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      }

      // Se não tem mais abas, fecha o browser
      if (this._pages.size === 0) {
        await this.close();
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Lista todas as abas abertas.
   * @returns {Promise<{success: boolean, pages?: Array, error?: string}>}
   */
  async listPages() {
    try {
      this._ensureRunning();
      const pages = [];
      for (const [id, page] of this._pages) {
        pages.push({
          id,
          url: page.url(),
          title: await page.title(),
          active: page === this._activePage,
        });
      }
      return { success: true, pages };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // UTILITÁRIOS INTERNOS
  // ============================================================

  /**
   * Garante que o browser está rodando.
   * @throws {Error} Se browser não está rodando
   */
  _ensureRunning() {
    if (!this._isRunning || !this._browser) {
      throw new Error('Browser não está rodando. Use launch() ou goTo() primeiro.');
    }
  }

  /**
   * Retorna a página ativa.
   * @returns {import('playwright').Page}
   */
  _getActivePage() {
    if (!this._activePage) {
      throw new Error('Nenhuma página ativa. Use goTo() ou newPage() primeiro.');
    }
    return this._activePage;
  }

  /**
   * Retorna o ID da página ativa.
   * @returns {string|null}
   */
  _getActivePageId() {
    for (const [id, page] of this._pages) {
      if (page === this._activePage) return id;
    }
    return null;
  }

  /**
   * Gera um ID único para página.
   * @returns {string}
   */
  _generatePageId() {
    this._pageCounter++;
    return `page_${this._pageCounter}`;
  }

  /**
   * Resolve seletor: se começa com "text=", usa Playwright text selector.
   * Senão, trata como CSS selector.
   * @param {string} selector
   * @returns {string}
   */
  _resolveSelector(selector) {
    if (!selector) throw new Error('Seletor não pode ser vazio');
    // Já é um seletor Playwright (text=, role=, etc.)
    if (selector.match(/^(text=|role=|css=|xpath=)/i)) {
      return selector;
    }
    // Se parece texto natural (sem . # [ etc), converte pra text=
    if (!selector.match(/^[.#\[]/) && !selector.match(/^[a-z]+\s*[>~+\s]/i) && selector.includes(' ')) {
      return `text=${selector}`;
    }
    return selector;
  }

  /**
   * Emite um evento via callback.
   * @param {string} event
   * @param {Object} data
   */
  _emit(event, data) {
    if (this._onEvent) {
      try {
        this._onEvent(event, data);
      } catch (err) {
        console.error(`[BrowserControl] Erro no evento ${event}:`, err.message);
      }
    }
  }

  // ============================================================
  // STATUS / INFO
  // ============================================================

  /**
   * Retorna informações sobre o estado atual do browser.
   * @returns {Object}
   */
  getStatus() {
    return {
      isRunning: this._isRunning,
      pagesOpen: this._pages.size,
      activePageUrl: this._activePage ? this._activePage.url() : null,
    };
  }

  /**
   * Retorna a URL da página ativa.
   * @returns {string|null}
   */
  getCurrentUrl() {
    return this._activePage ? this._activePage.url() : null;
  }

  /**
   * Verifica se o browser está rodando.
   * @returns {boolean}
   */
  isRunning() {
    return this._isRunning;
  }
}

module.exports = { BrowserControl };
