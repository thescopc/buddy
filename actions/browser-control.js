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

  // ============================================================
  // SMART ACTIONS (IA) — Encontra elementos por descrição
  // ============================================================

  /**
   * Encontra um elemento na página por descrição em linguagem natural.
   * Usa múltiplas estratégias: aria-label, texto visível, placeholder, title, role.
   * 
   * @param {string} description - Descrição do elemento. Ex: "botão de login", "campo de email"
   * @param {Object} [options={}]
   * @param {number} [options.timeout=10000] - Timeout em ms
   * @returns {Promise<{success: boolean, selector?: string, text?: string, error?: string}>}
   */
  async smartFind(description, options = {}) {
    try {
      this._ensureRunning();
      const page = this._getActivePage();
      const timeout = options.timeout || 10000;
      const desc = description.toLowerCase().trim();

      // Estratégia 1: getByRole com name (botão, link, etc.)
      const roleMap = [
        { keywords: ['botão', 'botao', 'button', 'btn'], role: 'button' },
        { keywords: ['link', 'ancora'], role: 'link' },
        { keywords: ['campo', 'input', 'field', 'caixa de texto'], role: 'textbox' },
        { keywords: ['checkbox', 'caixa de seleção', 'marcar'], role: 'checkbox' },
        { keywords: ['menu', 'dropdown', 'select', 'seleção'], role: 'combobox' },
        { keywords: ['heading', 'título', 'titulo', 'cabeçalho'], role: 'heading' },
      ];

      // Extrai possível label do elemento
      const nameHint = desc
        .replace(/bot[ãa]o\s*(de\s*)?/i, '')
        .replace(/campo\s*(de\s*)?/i, '')
        .replace(/link\s*(de\s*|para\s*)?/i, '')
        .replace(/input\s*(de\s*)?/i, '')
        .replace(/caixa\s*(de\s*)?/i, '')
        .trim();

      // Palavras-chave de busca para detectar campos search
      const searchKeywords = ['busca', 'pesquisa', 'search', 'pesquisar', 'buscar', 'procurar'];
      const buttonKeywords = ['botão', 'botao', 'button', 'btn', 'clicar', 'clique', 'submeter', 'enviar'];
      const isSearchField = searchKeywords.some(k => desc.includes(k)) && !buttonKeywords.some(k => desc.includes(k));
      // Só aplica search-field se NÃO mencionar "botão" e se parecer ser um campo (não "Pesquisa Google" botão)
      const looksLikeField = desc.includes('campo') || desc.includes('input') || desc.includes('caixa')
        || (!desc.includes('google') && !desc.includes('bing') && !desc.includes('enviar'));

      // Estratégia 0: Se é campo de busca, tenta input[type=search], textarea[name*=q], etc.
      if (isSearchField && looksLikeField) {
        const searchSelectors = [
          'input[type="search"]',
          'textarea[name="q"]', 'input[name="q"]',
          'textarea[aria-label*="earch" i]', 'input[aria-label*="earch" i]',
          'textarea[aria-label*="usca" i]', 'input[aria-label*="usca" i]',
          'textarea[aria-label*="esquis" i]', 'input[aria-label*="esquis" i]',
          'textarea[title*="earch" i]', 'input[title*="earch" i]',
          'textarea[title*="usca" i]', 'input[title*="usca" i]',
          '[role="combobox"]', '[role="searchbox"]',
        ];
        for (const sel of searchSelectors) {
          try {
            const locator = page.locator(sel).first();
            if (await locator.count() > 0 && await locator.isVisible()) {
              return { success: true, locator, text: '', strategy: 'search-field' };
            }
          } catch (_) { /* continue */ }
        }
      }

      for (const { keywords, role } of roleMap) {
        if (keywords.some(k => desc.includes(k))) {
          try {
            const locator = nameHint
              ? page.getByRole(role, { name: new RegExp(nameHint, 'i') })
              : page.getByRole(role);
            const count = await locator.count();
            if (count > 0) {
              const el = locator.first();
              const text = await el.textContent().catch(() => '');
              return { success: true, locator: el, role, text: (text || '').trim(), strategy: 'role' };
            }
          } catch (_) { /* continue */ }
        }
      }

      // Estratégia 1.5: getByRole com aria-label genérica
      try {
        const locator = page.locator(`[aria-label*="${nameHint || desc}" i]`).first();
        if (await locator.count() > 0 && await locator.isVisible()) {
          const text = await locator.textContent().catch(() => '');
          return { success: true, locator, text: (text || '').trim(), strategy: 'aria-label' };
        }
      } catch (_) { /* continue */ }

      // Estratégia 2: getByText (texto visível)
      try {
        const locator = page.getByText(new RegExp(this._escapeRegex(nameHint || desc), 'i')).first();
        if (await locator.count() > 0) {
          const text = await locator.textContent().catch(() => '');
          return { success: true, locator, text: (text || '').trim(), strategy: 'text' };
        }
      } catch (_) { /* continue */ }

      // Estratégia 3: getByPlaceholder
      try {
        const locator = page.getByPlaceholder(new RegExp(this._escapeRegex(nameHint || desc), 'i')).first();
        if (await locator.count() > 0) {
          return { success: true, locator, text: '', strategy: 'placeholder' };
        }
      } catch (_) { /* continue */ }

      // Estratégia 4: getByLabel
      try {
        const locator = page.getByLabel(new RegExp(this._escapeRegex(nameHint || desc), 'i')).first();
        if (await locator.count() > 0) {
          return { success: true, locator, text: '', strategy: 'label' };
        }
      } catch (_) { /* continue */ }

      // Estratégia 5: getByTitle
      try {
        const locator = page.getByTitle(new RegExp(this._escapeRegex(nameHint || desc), 'i')).first();
        if (await locator.count() > 0) {
          const text = await locator.textContent().catch(() => '');
          return { success: true, locator, text: (text || '').trim(), strategy: 'title' };
        }
      } catch (_) { /* continue */ }

      // Estratégia 6: CSS selector genérico via evaluate
      try {
        const found = await page.evaluate((searchText) => {
          const allElements = document.querySelectorAll('button, a, input, select, textarea, [role], [onclick]');
          for (const el of allElements) {
            const content = (el.textContent || '') + (el.getAttribute('aria-label') || '') +
              (el.getAttribute('placeholder') || '') + (el.getAttribute('title') || '') +
              (el.getAttribute('value') || '') + (el.getAttribute('alt') || '');
            if (content.toLowerCase().includes(searchText.toLowerCase())) {
              // Gera um seletor único
              el.setAttribute('data-buddy-found', 'true');
              return { found: true, tag: el.tagName, text: (el.textContent || '').substring(0, 100) };
            }
          }
          return { found: false };
        }, nameHint || desc);

        if (found.found) {
          const locator = page.locator('[data-buddy-found="true"]').first();
          // Limpa o marcador
          await page.evaluate(() => {
            document.querySelectorAll('[data-buddy-found]').forEach(el => el.removeAttribute('data-buddy-found'));
          });
          return { success: true, locator, text: found.text || '', strategy: 'evaluate' };
        }
      } catch (_) { /* continue */ }

      return { success: false, error: `Elemento "${description}" não encontrado na página` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Clica em um elemento descrito em linguagem natural (sem CSS selector).
   * 
   * @param {string} description - Ex: "botão de login", "link Sobre", "Enviar"
   * @returns {Promise<{success: boolean, strategy?: string, text?: string, error?: string}>}
   */
  async smartClick(description) {
    try {
      this._ensureRunning();
      const findResult = await this.smartFind(description);
      if (!findResult.success) return findResult;

      try {
        await findResult.locator.click({ timeout: 10000 });
      } catch (clickErr) {
        // Fallback: se o elemento existe mas não é clicável (ex: botão oculto do Google),
        // tenta forçar click via JS ou pressionar Enter
        try {
          await findResult.locator.click({ force: true, timeout: 5000 });
        } catch (_) {
          // Último fallback: dispara click via JS
          await findResult.locator.evaluate(el => el.click());
        }
      }
      await this._getActivePage().waitForTimeout(500);

      console.log(`[BrowserControl] smartClick "${description}" via ${findResult.strategy}`);
      return {
        success: true,
        description,
        strategy: findResult.strategy,
        text: findResult.text,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Digita em um campo descrito em linguagem natural (sem CSS selector).
   * 
   * @param {string} description - Ex: "campo de email", "busca", "senha"
   * @param {string} text - Texto a digitar
   * @param {Object} [options={}]
   * @param {boolean} [options.clear=true] - Limpa antes de digitar
   * @param {boolean} [options.pressEnter=false] - Pressiona Enter após digitar
   * @returns {Promise<{success: boolean, strategy?: string, error?: string}>}
   */
  async smartType(description, text, options = {}) {
    try {
      this._ensureRunning();
      const findResult = await this.smartFind(description);
      if (!findResult.success) return findResult;

      if (options.clear !== false) {
        await findResult.locator.click({ clickCount: 3 });
        await this._getActivePage().keyboard.press('Backspace');
      }

      await findResult.locator.fill(text);

      if (options.pressEnter) {
        await this._getActivePage().keyboard.press('Enter');
        await this._getActivePage().waitForTimeout(1000);
      }

      console.log(`[BrowserControl] smartType "${description}" via ${findResult.strategy}`);
      return {
        success: true,
        description,
        strategy: findResult.strategy,
        typed: text.substring(0, 50),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Preenche um formulário inteiro a partir de um dicionário campo→valor.
   * Cada chave é uma descrição do campo, cada valor é o texto a digitar.
   * 
   * @param {Object} fields - Ex: { "email": "user@test.com", "senha": "123", "nome": "João" }
   * @param {Object} [options={}]
   * @param {boolean} [options.submit=false] - Clica no botão de submit após preencher
   * @param {string} [options.submitButton='enviar'] - Descrição do botão de submit
   * @returns {Promise<{success: boolean, filled?: Array, errors?: Array, error?: string}>}
   */
  async fillForm(fields, options = {}) {
    try {
      this._ensureRunning();
      const filled = [];
      const errors = [];

      for (const [fieldDesc, value] of Object.entries(fields)) {
        const result = await this.smartType(fieldDesc, value, { clear: true });
        if (result.success) {
          filled.push({ field: fieldDesc, strategy: result.strategy });
        } else {
          errors.push({ field: fieldDesc, error: result.error });
        }
      }

      // Submit se solicitado
      if (options.submit && filled.length > 0) {
        const submitDesc = options.submitButton || 'enviar';
        const submitResult = await this.smartClick(submitDesc);
        if (!submitResult.success) {
          // Tenta alternativas comuns de submit
          const alternatives = ['submit', 'entrar', 'login', 'cadastrar', 'salvar', 'confirmar'];
          let submitted = false;
          for (const alt of alternatives) {
            const altResult = await this.smartClick(alt);
            if (altResult.success) { submitted = true; break; }
          }
          if (!submitted) {
            errors.push({ field: '_submit', error: `Botão de submit não encontrado: "${submitDesc}"` });
          }
        }
      }

      console.log(`[BrowserControl] fillForm: ${filled.length} preenchidos, ${errors.length} erros`);
      return {
        success: errors.length === 0,
        filled,
        errors: errors.length > 0 ? errors : undefined,
        totalFields: Object.keys(fields).length,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Escapa caracteres especiais de regex.
   * @param {string} str
   * @returns {string}
   */
  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
