/**
 * YouTube Controller — Buddy 2.0
 * 
 * Busca, abre e extrai info de vídeos do YouTube.
 * - Busca via scraping leve (sem API key)
 * - Abre vídeos no browser padrão
 * - Extrai info: título, duração, views
 * 
 * @module actions/youtube
 */

const https = require('https');
const { exec } = require('child_process');

const YT_SEARCH_URL = 'https://www.youtube.com/results?search_query=';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const REQUEST_TIMEOUT_MS = 10000;

class YouTubeController {
  /**
   * Busca vídeos no YouTube.
   * @param {string} query - Termo de busca
   * @param {number} [maxResults=5]
   * @returns {Promise<{success:boolean, results?:Array, error?:string}>}
   */
  async search(query, maxResults = 5) {
    try {
      const url = YT_SEARCH_URL + encodeURIComponent(query);
      const html = await this._httpGet(url);

      // YouTube retorna dados em JSON dentro de ytInitialData
      const dataMatch = html.match(/var\s+ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
      if (!dataMatch) {
        // Fallback: tenta outro pattern
        const altMatch = html.match(/ytInitialData['"]\s*\]\s*=\s*(\{.+?\});\s*/s);
        if (!altMatch) return { success: false, error: 'Não foi possível parsear resultados do YouTube' };
        return this._parseResults(altMatch[1], maxResults, query);
      }
      return this._parseResults(dataMatch[1], maxResults, query);
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Parse dos resultados do YouTube.
   */
  _parseResults(jsonStr, maxResults, query) {
    try {
      const data = JSON.parse(jsonStr);
      const contents = data?.contents?.twoColumnSearchResultsRenderer
        ?.primaryContents?.sectionListRenderer?.contents?.[0]
        ?.itemSectionRenderer?.contents || [];

      const results = [];
      for (const item of contents) {
        if (results.length >= maxResults) break;
        const video = item.videoRenderer;
        if (!video) continue;

        results.push({
          title: video.title?.runs?.[0]?.text || '',
          videoId: video.videoId || '',
          url: `https://www.youtube.com/watch?v=${video.videoId}`,
          duration: video.lengthText?.simpleText || 'Live/N/A',
          views: video.viewCountText?.simpleText || video.viewCountText?.runs?.[0]?.text || '',
          channel: video.ownerText?.runs?.[0]?.text || '',
          published: video.publishedTimeText?.simpleText || '',
          thumbnail: video.thumbnail?.thumbnails?.pop()?.url || '',
        });
      }

      return { success: true, query, count: results.length, results };
    } catch (err) {
      return { success: false, error: `Parse error: ${err.message}` };
    }
  }

  /**
   * Abre um vídeo no browser padrão do sistema.
   * @param {string} urlOrId - URL ou videoId
   * @returns {Promise<{success:boolean, url?:string, error?:string}>}
   */
  async open(urlOrId) {
    try {
      let url = urlOrId;
      if (!url.startsWith('http')) {
        url = `https://www.youtube.com/watch?v=${urlOrId}`;
      }

      return new Promise((resolve) => {
        const cmd = process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`;
        exec(cmd, (err) => {
          if (err) resolve({ success: false, error: err.message });
          else resolve({ success: true, url });
        });
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Busca e abre o primeiro resultado.
   */
  async play(query) {
    const search = await this.search(query, 1);
    if (!search.success || search.count === 0) {
      return { success: false, error: search.error || 'Nenhum vídeo encontrado' };
    }
    const video = search.results[0];
    const openResult = await this.open(video.url);
    return { ...openResult, video };
  }

  /**
   * Formata resultados para texto.
   */
  formatResults(results) {
    if (!results || results.length === 0) return 'Nenhum vídeo encontrado.';
    return results.map((r, i) => {
      return `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.channel} | ${r.duration} | ${r.views}${r.published ? ' | ' + r.published : ''}`;
    }).join('\n\n');
  }

  _httpGet(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'pt-BR,pt;q=0.9' },
        timeout: REQUEST_TIMEOUT_MS,
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this._httpGet(res.headers.location).then(resolve).catch(reject);
        }
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.on('error', reject);
    });
  }
}

module.exports = { YouTubeController };
