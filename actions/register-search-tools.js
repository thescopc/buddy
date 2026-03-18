/**
 * Web Search Tools Integration — Buddy 2.0
 * 
 * Registra WebSearch como tools no Tool Registry.
 * Tools: web_search, web_compare
 * 
 * @module actions/register-search-tools
 */

const { WebSearch } = require('./web-search');
const { getToolRegistry } = require('../agent/tool-registry');

/**
 * Inicializa e registra as tools de web search.
 * 
 * @param {Object} [options={}]
 * @param {string} [options.googleApiKey] - Google CSE API Key
 * @param {string} [options.googleCx] - Google CSE Engine ID
 * @param {Function} [options.onExpression] - Callback expressão
 * @returns {Object} { webSearch }
 */
function registerSearchTools(options = {}) {
  const { googleApiKey, googleCx, onExpression } = options;
  const registry = getToolRegistry();

  const webSearch = new WebSearch({ googleApiKey, googleCx });

  console.log('[SearchTools] Registrando tools de web search...');

  // ============================================================
  // WEB_SEARCH — Busca na web
  // ============================================================

  registry.register({
    name: 'web_search',
    description: 'Busca na web usando DuckDuckGo (ou Google se configurado). Retorna título, URL e snippet de cada resultado. Use para pesquisar qualquer assunto na internet.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Termo de busca. Ex: "IA generativa 2026", "receita de bolo de chocolate"' },
        maxResults: { type: 'number', description: 'Máximo de resultados (padrão: 5, máx: 10)' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const result = await webSearch.search(args.query, { maxResults: args.maxResults });
      if (onExpression) onExpression('happy');
      if (!result.success) return `Erro na busca: ${result.error}`;
      return `Busca "${result.query}" (${result.engine}, ${result.count} resultados):\n\n${webSearch.formatResults(result.results)}`;
    },
    source: 'search',
    metadata: { category: 'search' },
  });

  // ============================================================
  // WEB_COMPARE — Comparar itens na web
  // ============================================================

  registry.register({
    name: 'web_compare',
    description: 'Compara múltiplos itens buscando cada um na web. Útil para comparar produtos, tecnologias, etc. Ex: comparar "iPhone 15" vs "Galaxy S24" por "câmera".',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'Itens a comparar. Ex: ["iPhone 15", "Galaxy S24", "Pixel 8"]',
        },
        aspect: { type: 'string', description: 'Aspecto da comparação (opcional). Ex: "preço", "câmera", "bateria"' },
        maxPerItem: { type: 'number', description: 'Resultados por item (padrão: 3)' },
      },
      required: ['items'],
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const result = await webSearch.compare(args.items, args.aspect, args.maxPerItem);
      if (onExpression) onExpression('happy');
      if (!result.success) return `Erro na comparação: ${result.error}`;

      let output = `Comparação: ${result.items.join(' vs ')} (aspecto: ${result.aspect})\n\n`;
      for (const [item, results] of Object.entries(result.comparison)) {
        output += `=== ${item} ===\n${webSearch.formatResults(results)}\n\n`;
      }
      return output;
    },
    source: 'search',
    metadata: { category: 'search' },
  });

  const stats = registry.getBySource('search');
  console.log(`[SearchTools] ${stats.length} tools registradas`);

  return { webSearch };
}

module.exports = { registerSearchTools };
