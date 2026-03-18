/**
 * Browser Tools Integration — Buddy 2.0
 * 
 * Registra as actions do BrowserControl como tools no Tool Registry.
 * Etapa 3.2 — 8 actions básicas: go_to, search, click, type, scroll,
 *             get_text, press, browser_close
 * 
 * @module actions/register-browser-tools
 */

const { BrowserControl } = require('./browser-control');
const { getToolRegistry } = require('../agent/tool-registry');

/**
 * Inicializa e registra todas as browser tools.
 * 
 * @param {Object} [options={}]
 * @param {Function} [options.onExpression] - Callback para mudar expressão do Buddy
 * @returns {Object} { browserControl }
 */
function registerBrowserTools(options = {}) {
  const { onExpression } = options;
  const registry = getToolRegistry();

  // Instância compartilhada (singleton por sessão)
  const browserControl = new BrowserControl({
    onEvent: (event, data) => {
      console.log(`[BrowserTools] ${event}:`, JSON.stringify(data).substring(0, 200));
    },
  });

  console.log('[BrowserTools] Registrando tools de browser...');

  // ============================================================
  // 1. GO_TO — Navegar para URL
  // ============================================================

  registry.register({
    name: 'browser_go_to',
    description: 'Abre uma URL no navegador. Inicia o browser automaticamente se não estiver aberto. Aceita URLs com ou sem https://. Ex: "google.com", "https://github.com".',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL para navegar. Ex: "google.com", "https://github.com/thescopc"' },
      },
      required: ['url'],
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const result = await browserControl.goTo(args.url);
      if (!result.success) return `Erro ao navegar: ${result.error}`;
      return `Navegou para ${result.url} — Título: "${result.title}"`;
    },
    source: 'browser',
    metadata: { category: 'browser' },
  });

  // ============================================================
  // 2. SEARCH — Buscar na web
  // ============================================================

  registry.register({
    name: 'browser_search',
    description: 'Busca um termo na web usando Google, DuckDuckGo ou Bing. Abre o browser, navega para o motor de busca e retorna o texto dos resultados.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Termo de busca. Ex: "clima em Uberlândia"' },
        engine: { type: 'string', description: 'Motor de busca: "google" (padrão), "duckduckgo", "bing"' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const result = await browserControl.search(args.query, args.engine || 'google');
      if (!result.success) return `Erro na busca: ${result.error}`;
      return `Busca "${result.query}" (${result.engine}):\n${result.results}`;
    },
    source: 'browser',
    metadata: { category: 'browser' },
  });

  // ============================================================
  // 3. CLICK — Clicar em elemento
  // ============================================================

  registry.register({
    name: 'browser_click',
    description: 'Clica em um elemento na página do browser. Aceita seletor CSS (ex: "#btn-login", ".submit") ou texto visível (ex: "Entrar", "Próximo"). Para texto, use o prefixo "text=" ou apenas escreva o texto com espaços.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Seletor CSS ou texto do elemento. Ex: "#login-btn", "text=Entrar", "Enviar"' },
      },
      required: ['selector'],
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const result = await browserControl.click(args.selector);
      if (!result.success) return `Erro ao clicar: ${result.error}`;
      return `Clicado em "${args.selector}"`;
    },
    source: 'browser',
    metadata: { category: 'browser' },
  });

  // ============================================================
  // 4. TYPE — Digitar em campo
  // ============================================================

  registry.register({
    name: 'browser_type',
    description: 'Digita texto em um campo de input na página. Limpa o campo antes de digitar por padrão. Aceita seletor CSS ou texto do label.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Seletor CSS do campo. Ex: "#search-input", "input[name=email]", "[placeholder=Buscar]"' },
        text: { type: 'string', description: 'Texto a digitar no campo' },
        clear: { type: 'boolean', description: 'Limpar campo antes de digitar (padrão: true)' },
      },
      required: ['selector', 'text'],
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const result = await browserControl.type(args.selector, args.text, { clear: args.clear });
      if (!result.success) return `Erro ao digitar: ${result.error}`;
      return `Digitado "${args.text.substring(0, 50)}" em "${args.selector}"`;
    },
    source: 'browser',
    metadata: { category: 'browser' },
  });

  // ============================================================
  // 5. SCROLL — Scroll na página
  // ============================================================

  registry.register({
    name: 'browser_scroll',
    description: 'Faz scroll na página do browser. Use para ver mais conteúdo acima ou abaixo.',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', description: '"down" (padrão) ou "up"' },
        amount: { type: 'number', description: 'Quantidade de scrolls (padrão: 3)' },
      },
    },
    execute: async (args) => {
      const result = await browserControl.scroll(args.direction || 'down', args.amount || 3);
      if (!result.success) return `Erro no scroll: ${result.error}`;
      return `Scroll ${result.direction} (${result.amount}x)`;
    },
    source: 'browser',
    metadata: { category: 'browser' },
  });

  // ============================================================
  // 6. GET_TEXT — Extrair texto da página
  // ============================================================

  registry.register({
    name: 'browser_get_text',
    description: 'Extrai o texto visível da página atual do browser. Útil para ler conteúdo de sites, resultados de busca, artigos, etc. Pode extrair de um elemento específico via seletor CSS.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Seletor CSS do elemento (opcional). Sem ele, extrai todo o texto da página.' },
        maxLength: { type: 'number', description: 'Máximo de caracteres (padrão: 5000)' },
      },
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const result = await browserControl.getText(args.selector, { maxLength: args.maxLength });
      if (!result.success) return `Erro ao extrair texto: ${result.error}`;
      return `Texto de ${result.url} (${result.length} chars):\n${result.text}`;
    },
    source: 'browser',
    metadata: { category: 'browser' },
  });

  // ============================================================
  // 7. PRESS — Pressionar tecla
  // ============================================================

  registry.register({
    name: 'browser_press',
    description: 'Pressiona uma tecla no browser. Útil para Enter após digitar, Tab para próximo campo, Escape para fechar popups, etc.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Tecla a pressionar. Ex: "Enter", "Tab", "Escape", "Control+A", "Control+C"' },
      },
      required: ['key'],
    },
    execute: async (args) => {
      const result = await browserControl.press(args.key);
      if (!result.success) return `Erro ao pressionar tecla: ${result.error}`;
      return `Tecla pressionada: ${result.key}`;
    },
    source: 'browser',
    metadata: { category: 'browser' },
  });

  // ============================================================
  // 8. CLOSE — Fechar browser
  // ============================================================

  registry.register({
    name: 'browser_close',
    description: 'Fecha o navegador e libera recursos. Use quando terminar a tarefa de navegação.',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async () => {
      const result = await browserControl.close();
      if (!result.success) return `Erro ao fechar browser: ${result.error}`;
      return 'Browser fechado com sucesso';
    },
    source: 'browser',
    metadata: { category: 'browser' },
  });

  // ============================================================
  // RESUMO
  // ============================================================

  const stats = registry.getBySource('browser');
  console.log(`[BrowserTools] ${stats.length} tools registradas`);

  return { browserControl };
}

module.exports = { registerBrowserTools };
