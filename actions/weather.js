/**
 * Weather — Buddy 2.0
 * 
 * Consulta clima via OpenWeatherMap API (free tier).
 * - Clima atual: temperatura, condição, humidade, vento
 * - Previsão 5 dias / 3 horas
 * - Detecta cidade do usuário pela memória
 * 
 * @module actions/weather
 */

const https = require('https');

// ============================================================
// CONSTANTES
// ============================================================
const OWM_BASE = 'https://api.openweathermap.org/data/2.5';
const REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_LANG = 'pt_br';
const DEFAULT_UNITS = 'metric'; // Celsius

class Weather {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.apiKey] - OpenWeatherMap API Key
   * @param {string} [options.defaultCity] - Cidade padrão do usuário
   */
  constructor(options = {}) {
    this._apiKey = options.apiKey || null;
    this._defaultCity = options.defaultCity || null;
  }

  /**
   * Define a API key.
   */
  setApiKey(key) { this._apiKey = key; }

  /**
   * Define a cidade padrão.
   */
  setDefaultCity(city) { this._defaultCity = city; }

  // ============================================================
  // CLIMA ATUAL
  // ============================================================

  /**
   * Retorna clima atual de uma cidade.
   * @param {string} [city] - Cidade (usa defaultCity se omitido)
   * @returns {Promise<{success:boolean, data?:Object, error?:string}>}
   */
  async current(city) {
    try {
      this._ensureApiKey();
      const q = city || this._defaultCity;
      if (!q) return { success: false, error: 'Cidade não informada e sem cidade padrão configurada' };

      const params = new URLSearchParams({
        q, appid: this._apiKey, units: DEFAULT_UNITS, lang: DEFAULT_LANG,
      });
      const url = `${OWM_BASE}/weather?${params}`;
      const raw = await this._httpGet(url);
      const d = JSON.parse(raw);

      if (d.cod && d.cod !== 200) {
        return { success: false, error: d.message || `Erro ${d.cod}` };
      }

      const data = {
        city: d.name,
        country: d.sys?.country,
        temp: Math.round(d.main.temp),
        feelsLike: Math.round(d.main.feels_like),
        tempMin: Math.round(d.main.temp_min),
        tempMax: Math.round(d.main.temp_max),
        humidity: d.main.humidity,
        condition: d.weather?.[0]?.description || '',
        icon: d.weather?.[0]?.icon || '',
        windSpeed: d.wind?.speed,
        windDeg: d.wind?.deg,
        clouds: d.clouds?.all,
        visibility: d.visibility,
        sunrise: d.sys?.sunrise ? new Date(d.sys.sunrise * 1000).toLocaleTimeString('pt-BR') : null,
        sunset: d.sys?.sunset ? new Date(d.sys.sunset * 1000).toLocaleTimeString('pt-BR') : null,
      };

      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // PREVISÃO 5 DIAS
  // ============================================================

  /**
   * Retorna previsão de 5 dias (intervalos de 3h).
   * @param {string} [city]
   * @returns {Promise<{success:boolean, forecast?:Array, error?:string}>}
   */
  async forecast(city) {
    try {
      this._ensureApiKey();
      const q = city || this._defaultCity;
      if (!q) return { success: false, error: 'Cidade não informada' };

      const params = new URLSearchParams({
        q, appid: this._apiKey, units: DEFAULT_UNITS, lang: DEFAULT_LANG, cnt: '40',
      });
      const url = `${OWM_BASE}/forecast?${params}`;
      const raw = await this._httpGet(url);
      const d = JSON.parse(raw);

      if (d.cod && String(d.cod) !== '200') {
        return { success: false, error: d.message || `Erro ${d.cod}` };
      }

      // Agrupa por dia
      const days = {};
      for (const item of d.list || []) {
        const date = item.dt_txt.split(' ')[0];
        if (!days[date]) days[date] = { temps: [], conditions: [], items: [] };
        days[date].temps.push(item.main.temp);
        days[date].conditions.push(item.weather?.[0]?.description || '');
        days[date].items.push(item);
      }

      const forecast = Object.entries(days).map(([date, info]) => ({
        date,
        tempMin: Math.round(Math.min(...info.temps)),
        tempMax: Math.round(Math.max(...info.temps)),
        condition: this._mostFrequent(info.conditions),
      }));

      return { success: true, city: d.city?.name, forecast };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // FORMATAÇÃO
  // ============================================================

  /**
   * Formata clima atual para texto legível.
   */
  formatCurrent(data) {
    return [
      `${data.city}, ${data.country}`,
      `${data.temp}°C (sensação ${data.feelsLike}°C)`,
      `${data.condition}`,
      `Min: ${data.tempMin}°C | Max: ${data.tempMax}°C`,
      `Humidade: ${data.humidity}% | Vento: ${data.windSpeed} m/s`,
      `Nascer: ${data.sunrise} | Pôr: ${data.sunset}`,
    ].join('\n');
  }

  /**
   * Formata previsão para texto.
   */
  formatForecast(forecast) {
    return forecast.map(d => {
      const dayName = new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' });
      return `${dayName} (${d.date}): ${d.tempMin}°C ~ ${d.tempMax}°C — ${d.condition}`;
    }).join('\n');
  }

  // ============================================================
  // HELPERS
  // ============================================================

  _ensureApiKey() {
    if (!this._apiKey) throw new Error('API Key do OpenWeatherMap não configurada. Configure em Settings ou peça ao usuário.');
  }

  _mostFrequent(arr) {
    const freq = {};
    arr.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
    return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  }

  _httpGet(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 400) resolve(data);
          else reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        });
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.on('error', reject);
    });
  }
}

module.exports = { Weather };
