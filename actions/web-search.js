/**
 * Web Search — Buddy 2.0
 * 
 * Busca na web via múltiplos engines:
 * - DuckDuckGo (padrão, sem API key, via HTML lite)
 * - Google Custom Search (opcional, requer API key + CX)
 * - Modo comparação: compara N itens por aspectos
 * 
 * @module actions/web-search
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// ============================================================
// CONSTANTES
// ============================================================
const DDG_LITE_URL = 'https://lite.duckduckgo.com/lite/';
const GOOGLE_CSE_URL = 'https://www.googleapis.com/customsearch/v1';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RESULTS = 10;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

class WebSearch {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.googleApiKey] - Google Custom Search API Key
   * @param {string} [options.googleCx] - Google Custom Search Engine ID
   */
  constructor(options = {}) {
    this._googleApiKey = options.googleApiKey || null;
    this._googleCx = options.googleCx || null;
  }

  // ============================================================
  // BUSCA PRINCIPAL
  // ============================================================

  /**
   * Busca na web.
   * Usa Google CSE se configurado, senão DuckDuckGo.
   * 
   * @param {string} query - Termo de busca
   * @param {Object} [options={}]
   * @param {number} [options.maxResults=5] - Máximo de resultados
   * @param {string} [options.engine] - 'duckduckgo' ou 'google' (auto se omitido)
   * @returns {Promise<{success:boolean, results?:Array, error?:string}>}
   */
  async search(query, options = {}) {
    const maxResults = Math.min(options.maxResults || 5, MAX_RESULTS);
    const engine = options.engine || (this._googleApiKey ? 'google' : 'duckduckgo');

    try {
      let results;
      if (engine === 'google' && this._googleApiKey) {
        results = await this._searchGoogle(query, maxResults);
      } else {
        results = await this._searchDDG(query, maxResults);
      }

      return {
        success: true,
        query,
        engine,
        count: results.length,
        results,
      };
    } catch (err) {
      // Fallback: se Google falha, tenta DDG
      if (engine === 'google') {
        try {
          const results = await this._searchDDG(query, maxResults);
          return { success: true, query, engine: 'duckduckgo-fallback', count: results.length, results };
        } catch (_) { /* fall through */ }
      }
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // DUCKDUCKGO (via HTML lite)
  // ============================================================

  /**
   * Busca no DuckDuckGo via versão lite (HTML simples).
   * Não requer API key.
   */
  async _searchDDG(query, maxResults) {
    const formData = `q=${encodeURIComponent(query)}`;
    const html = await this._httpPost(DDG_LITE_URL, formData, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    });

    return this._parseDDGResults(html, maxResults);
  }

  /**
   * Parse dos resultados HTML do DuckDuckGo lite.
   */
  _parseDDGResults(html, maxResults) {
    const results = [];

    // DDG lite: <a rel="nofollow" href="URL" class='result-link'>TITLE</a>
    // href com aspas duplas, class com aspas simples
    const links = [];
    const snippets = [];

    // Extrai links: split por 'result-link' e busca href no chunk anterior
    const linkParts = html.split('result-link');
    for (let i = 1; i < linkParts.length; i++) {
      const before = linkParts[i - 1];
      // href="URL" está imediatamente antes do class='result-link'
      // Pegamos o ÚLTIMO href no chunk anterior para evitar false matches
      const hrefMatches = before.match(/href="([^"]+)"/g);
      const lastHref = hrefMatches ? hrefMatches[hrefMatches.length - 1] : null;
      const hrefUrl = lastHref ? lastHref.match(/href="([^"]+)"/)[1] : null;      // Título está logo após: '>TITLE</a>
      const after = linkParts[i];
      const titleMatch = after.match(/^[^>]*>([\s\S]*?)<\/a>/i);
      if (hrefUrl && titleMatch) {
        links.push({
          url: this._decodeEntities(hrefUrl),
          title: this._stripTags(titleMatch[1]).trim(),
        });
      }
    }

    // Extrai snippets: <td class='result-snippet'>TEXT</td>
    const snippetParts = html.split('result-snippet');
    for (let i = 1; i < snippetParts.length; i++) {
      const after = snippetParts[i];
      const contentMatch = after.match(/^[^>]*>([\s\S]*?)<\/td>/i);
      if (contentMatch) {
        snippets.push(this._stripTags(contentMatch[1]).trim());
      }
    }

    for (let i = 0; i < Math.min(links.length, maxResults); i++) {
      if (links[i].url && links[i].title) {
        results.push({
          title: links[i].title,
          url: links[i].url,
          snippet: snippets[i] || '',
          position: i + 1,
        });
      }
    }

    return results;
  }

  // ============================================================
  // GOOGLE CUSTOM SEARCH
  // ============================================================

  /**
   * Busca via Google Custom Search API.
   * Requer apiKey e cx configurados.
   */
  async _searchGoogle(query, maxResults) {
    if (!this._googleApiKey || !this._googleCx) {
      throw new Error('Google Custom Search não configurado (falta apiKey ou cx)');
    }

    const params = new URLSearchParams({
      key: this._googleApiKey,
      cx: this._googleCx,
      q: query,
      num: String(Math.min(maxResults, 10)),
    });

    const url = `${GOOGLE_CSE_URL}?${params.toString()}`;
    const json = await this._httpGet(url);
    const data = JSON.parse(json);

    if (!data.items) return [];

    return data.items.slice(0, maxResults).map((item, i) => ({
      title: item.title || '',
      url: item.link || '',
      snippet: item.snippet || '',
      position: i + 1,
    }));
  }

  // ============================================================
  // MODO COMPARAÇÃO
  // ============================================================

  /**
   * Compara N itens buscando cada um e retornando resultados lado a lado.
   * 
   * @param {string[]} items - Itens para comparar. Ex: ["iPhone 15", "Galaxy S24"]
   * @param {string} [aspect] - Aspecto da comparação. Ex: "preço", "câmera", "bateria"
   * @param {number} [maxPerItem=3] - Resultados por item
   * @returns {Promise<{success:boolean, comparison?:Object, error?:string}>}
   */
  async compare(items, aspect, maxPerItem = 3) {
    try {
      const comparison = {};

      for (const item of items) {
        const query = aspect ? `${item} ${aspect}` : item;
        const result = await this.search(query, { maxResults: maxPerItem });
        comparison[item] = result.success ? result.results : [];
      }

      return {
        success: true,
        items,
        aspect: aspect || 'geral',
        comparison,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // HTTP HELPERS
  // ============================================================

  /**
   * HTTP GET simples.
   */
  _httpGet(url) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: REQUEST_TIMEOUT_MS }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 400) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.on('error', reject);
    });
  }

  /**
   * HTTP POST simples (form-encoded).
   */
  _httpPost(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: REQUEST_TIMEOUT_MS,
      };

      const req = client.request(options, (res) => {
        let data = '';
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this._httpGet(res.headers.location).then(resolve).catch(reject);
        }
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 400) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // ============================================================
  // STRING HELPERS
  // ============================================================

  /** Remove tags HTML */
  _stripTags(str) {
    return (str || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
  }

  /** Decodifica entidades HTML básicas */
  _decodeEntities(str) {
    return (str || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'");
  }

  /**
   * Formata resultados para exibição em texto.
   * @param {Array} results
   * @returns {string}
   */
  formatResults(results) {
    if (!results || results.length === 0) return 'Nenhum resultado encontrado.';
    return results.map((r, i) => {
      return `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`;
    }).join('\n\n');
  }
}

module.exports = { WebSearch };
