/**
 * YouTube Tools Integration — Buddy 2.0
 * Tools: youtube_search, youtube_play
 * @module actions/register-youtube-tools
 */

const { YouTubeController } = require('./youtube');
const { getToolRegistry } = require('../agent/tool-registry');

function registerYouTubeTools(options = {}) {
  const { onExpression } = options;
  const registry = getToolRegistry();
  const yt = new YouTubeController();

  console.log('[YouTubeTools] Registrando tools...');

  registry.register({
    name: 'youtube_search',
    description: 'Busca vídeos no YouTube. Retorna título, URL, canal, duração e views.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Termo de busca. Ex: "lofi hip hop", "tutorial Node.js"' },
        maxResults: { type: 'number', description: 'Máximo de resultados (padrão: 5)' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const r = await yt.search(args.query, args.maxResults);
      if (onExpression) onExpression('happy');
      if (!r.success) return `Erro: ${r.error}`;
      return `${r.count} vídeos para "${r.query}":\n\n${yt.formatResults(r.results)}`;
    },
    source: 'youtube', metadata: { category: 'youtube' },
  });

  registry.register({
    name: 'youtube_play',
    description: 'Busca um vídeo no YouTube e abre no browser padrão. Ex: "Buddy, toca lofi no YouTube".',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'O que tocar. Ex: "lofi hip hop", "música relaxante"' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const r = await yt.play(args.query);
      if (onExpression) onExpression('happy');
      if (!r.success) return `Erro: ${r.error}`;
      return `Abrindo: "${r.video.title}" (${r.video.channel})\n${r.url}`;
    },
    source: 'youtube', metadata: { category: 'youtube' },
  });

  const stats = registry.getBySource('youtube');
  console.log(`[YouTubeTools] ${stats.length} tools registradas`);
  return { youtubeController: yt };
}

module.exports = { registerYouTubeTools };
