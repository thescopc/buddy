/**
 * Weather Tools Integration — Buddy 2.0
 * 
 * Registra Weather como tools no Tool Registry.
 * Tools: weather_current, weather_forecast
 * 
 * @module actions/register-weather-tools
 */

const { Weather } = require('./weather');
const { getToolRegistry } = require('../agent/tool-registry');

function registerWeatherTools(options = {}) {
  const { weatherApiKey, defaultCity, onExpression } = options;
  const registry = getToolRegistry();

  const weather = new Weather({ apiKey: weatherApiKey, defaultCity });

  console.log('[WeatherTools] Registrando tools de clima...');

  registry.register({
    name: 'weather_current',
    description: 'Retorna o clima atual de uma cidade. Mostra temperatura, sensação térmica, condição, humidade, vento, nascer/pôr do sol. Requer API Key do OpenWeatherMap configurada.',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'Nome da cidade. Ex: "Uberlândia", "São Paulo", "New York". Se omitido, usa a cidade padrão do usuário.' },
      },
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const r = await weather.current(args.city);
      if (onExpression) onExpression('happy');
      if (!r.success) return `Erro ao consultar clima: ${r.error}`;
      return weather.formatCurrent(r.data);
    },
    source: 'weather', metadata: { category: 'weather' },
  });

  registry.register({
    name: 'weather_forecast',
    description: 'Retorna previsão do tempo para os próximos 5 dias de uma cidade. Mostra temperatura mín/máx e condição por dia.',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'Nome da cidade. Se omitido, usa a cidade padrão.' },
      },
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const r = await weather.forecast(args.city);
      if (onExpression) onExpression('happy');
      if (!r.success) return `Erro na previsão: ${r.error}`;
      return `Previsão para ${r.city}:\n${weather.formatForecast(r.forecast)}`;
    },
    source: 'weather', metadata: { category: 'weather' },
  });

  const stats = registry.getBySource('weather');
  console.log(`[WeatherTools] ${stats.length} tools registradas`);

  return { weather };
}

module.exports = { registerWeatherTools };
