/**
 * llm-provider.js — Multi-provider LLM abstraction
 * 
 * Suporta: OpenAI, Anthropic (Claude), Google (Gemini)
 * Cada provider tem a mesma interface:
 *   callLLM(bodyObj) → Promise<{content, tool_calls?}>
 * 
 * Fallback automático: se o provider principal falhar, tenta o próximo
 */

const https = require('https');

// ─── Provider configs ──────────────────────────────────
const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano'],
    authHeader: (key) => `Bearer ${key}`,
    formatRequest: (bodyObj) => bodyObj,
    parseResponse: (data) => {
      const p = JSON.parse(data);
      if (p.error) throw new Error(p.error.message);
      const msg = p.choices?.[0]?.message;
      if (!msg) throw new Error('Resposta OpenAI inválida');
      return msg; // { content, tool_calls? }
    }
  },
  anthropic: {
    name: 'Anthropic',
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-opus-4-20250514'],
    authHeader: (key) => key, // x-api-key header
    formatRequest: (bodyObj) => {
      // Converte formato OpenAI → Anthropic
      const messages = bodyObj.messages || [];
      const systemMsg = messages.find(m => m.role === 'system');
      const nonSystem = messages.filter(m => m.role !== 'system');
      
      const req = {
        model: bodyObj.model,
        max_tokens: bodyObj.max_tokens || 1000,
        messages: nonSystem.map(m => ({
          role: m.role === 'tool' ? 'user' : m.role,
          content: m.content || ''
        }))
      };
      if (systemMsg) req.system = systemMsg.content;
      
      // Converte tools OpenAI → Anthropic
      if (bodyObj.tools && bodyObj.tools.length > 0) {
        req.tools = bodyObj.tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters || {}
        }));
      }
      return req;
    },
    parseResponse: (data) => {
      const p = JSON.parse(data);
      if (p.error) throw new Error(p.error?.message || 'Erro Anthropic');
      if (p.type === 'error') throw new Error(p.error?.message || 'Erro Anthropic');
      
      // Extrai content text
      let content = '';
      let tool_calls = null;
      
      if (p.content) {
        for (const block of p.content) {
          if (block.type === 'text') content += block.text;
          if (block.type === 'tool_use') {
            if (!tool_calls) tool_calls = [];
            tool_calls.push({
              id: block.id,
              type: 'function',
              function: { name: block.name, arguments: JSON.stringify(block.input) }
            });
          }
        }
      }
      const result = { content: content || null };
      if (tool_calls) result.tool_calls = tool_calls;
      return result;
    }
  },
  google: {
    name: 'Google Gemini',
    hostname: 'generativelanguage.googleapis.com',
    path: '/v1beta/models/{model}:generateContent',
    models: ['gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    authHeader: null, // usa query param key=
    formatRequest: (bodyObj) => {
      const messages = bodyObj.messages || [];
      const systemMsg = messages.find(m => m.role === 'system');
      const nonSystem = messages.filter(m => m.role !== 'system');
      
      const contents = nonSystem.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content || '' }]
      }));
      
      const req = { contents };
      if (systemMsg) {
        req.systemInstruction = { parts: [{ text: systemMsg.content }] };
      }
      req.generationConfig = { maxOutputTokens: bodyObj.max_tokens || 1000 };
      return req;
    },
    parseResponse: (data) => {
      const p = JSON.parse(data);
      if (p.error) throw new Error(p.error.message);
      const candidate = p.candidates?.[0];
      if (!candidate) throw new Error('Resposta Gemini inválida');
      const content = candidate.content?.parts?.map(p => p.text).join('') || '';
      return { content };
    }
  }
};

// ─── Detectar provider pelo modelo ─────────────────────
function detectProvider(model) {
  for (const [key, provider] of Object.entries(PROVIDERS)) {
    if (provider.models.includes(model)) return key;
  }
  // Heurística por prefixo
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gemini-')) return 'google';
  return 'openai'; // fallback
}

// ─── HTTP request genérico ─────────────────────────────
function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── Chamada LLM principal ─────────────────────────────
/**
 * Chama uma LLM com fallback automático entre providers
 * @param {Object} bodyObj - Formato OpenAI padrão { model, messages, max_tokens, tools? }
 * @param {Object} apiKeys - { openai, anthropic, google }
 * @param {string[]} [fallbackOrder] - Ordem de fallback ['openai','anthropic','google']
 * @returns {Promise<{content, tool_calls?}>}
 */
async function callLLM(bodyObj, apiKeys, fallbackOrder) {
  const model = bodyObj.model;
  const primaryProvider = detectProvider(model);
  
  // Monta lista de providers para tentar
  const order = [primaryProvider];
  if (fallbackOrder) {
    for (const fb of fallbackOrder) {
      if (fb !== primaryProvider && apiKeys[fb]) order.push(fb);
    }
  }

  let lastError = null;
  for (const providerKey of order) {
    const provider = PROVIDERS[providerKey];
    const apiKey = apiKeys[providerKey];
    if (!apiKey) {
      lastError = new Error(`API key não configurada para ${provider.name}`);
      continue;
    }

    try {
      const formattedBody = provider.formatRequest(bodyObj);
      const bodyStr = JSON.stringify(formattedBody);

      let reqPath = provider.path;
      const headers = { 'Content-Type': 'application/json' };

      if (providerKey === 'google') {
        reqPath = reqPath.replace('{model}', model) + `?key=${apiKey}`;
      } else if (providerKey === 'anthropic') {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers['Authorization'] = provider.authHeader(apiKey);
      }

      const opts = {
        hostname: provider.hostname,
        port: 443,
        path: reqPath,
        method: 'POST',
        headers
      };

      console.log(`[LLM] Chamando ${provider.name} (${model})`);
      const raw = await httpRequest(opts, bodyStr);
      const result = provider.parseResponse(raw);
      return result;

    } catch (e) {
      console.error(`[LLM] Erro com ${provider.name}:`, e.message);
      lastError = e;
      // Continua para o próximo provider no fallback
    }
  }

  throw lastError || new Error('Nenhum provider LLM disponível');
}

// ─── Exports ───────────────────────────────────────────
module.exports = { callLLM, detectProvider, PROVIDERS };
