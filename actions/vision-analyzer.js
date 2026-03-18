/**
 * Vision Analyzer — Buddy 2.0
 * 
 * Envia screenshots para OpenAI GPT-4o (vision) para análise.
 * - Modo "describe": descreve o que vê na tela
 * - Modo "find": localiza elemento por descrição, retorna coordenadas x,y
 * - Modo "read": extrai texto visível da tela
 * 
 * @module actions/vision-analyzer
 */

const https = require('https');

// ============================================================
// CONSTANTES
// ============================================================
const VISION_MODEL = 'gpt-4o';
const MAX_TOKENS_DESCRIBE = 500;
const MAX_TOKENS_FIND = 300;

/** Prompts otimizados para cada modo */
const PROMPTS = {
  describe: `Você é um assistente de visão para um agente de desktop chamado Buddy.
Descreva de forma concisa e objetiva o que você vê nesta captura de tela.
Foque em: janelas abertas, programas visíveis, conteúdo principal, barra de tarefas.
Responda em pt-BR, máximo 3-4 frases. Seja direto e útil.`,

  find: `Você é um sistema de localização de elementos de tela para um agente de desktop.
O usuário vai descrever um elemento visual (botão, ícone, campo, texto, etc).
Você deve encontrar esse elemento na imagem e retornar suas coordenadas.

REGRAS:
1. A imagem tem resolução ORIGINAL (antes do redimensionamento). As coordenadas devem ser relativas à imagem fornecida.
2. Retorne as coordenadas do CENTRO do elemento encontrado.
3. Se encontrar o elemento, responda APENAS com JSON: {"found": true, "x": 123, "y": 456, "confidence": "high|medium|low", "description": "breve descrição do elemento"}
4. Se NÃO encontrar, responda: {"found": false, "reason": "motivo"}
5. Retorne APENAS o JSON, sem texto antes ou depois.`,

  read: `Você é um OCR inteligente para um agente de desktop.
Extraia todo o texto visível nesta captura de tela.
Organize por seção/janela quando possível.
Responda em formato limpo, sem comentários extras.`
};

class VisionAnalyzer {
  /**
   * @param {Object} options
   * @param {string} options.apiKey - OpenAI API Key
   * @param {string} [options.model] - Modelo de visão (default: gpt-4o)
   * @param {Object} [options.screenCapture] - Instância do ScreenCapture
   */
  constructor(options = {}) {
    if (!options.apiKey) {
      throw new Error('[VisionAnalyzer] Precisa de apiKey');
    }

    this._apiKey = options.apiKey;
    this._model = options.model || VISION_MODEL;
    this._screenCapture = options.screenCapture || null;
  }

  /**
   * Descreve o que vê na tela (ou em uma imagem fornecida).
   * 
   * @param {Object} [options={}]
   * @param {string} [options.base64] - Imagem em base64 (se não fornecida, captura a tela)
   * @param {string} [options.question] - Pergunta específica sobre a tela
   * @returns {Promise<{success: boolean, description?: string, error?: string}>}
   */
  async describe(options = {}) {
    const startTime = Date.now();
    console.log('[VisionAnalyzer] Modo describe...');

    try {
      const imageBase64 = await this._getImage(options.base64);
      const userContent = options.question
        ? `Pergunta sobre a tela: ${options.question}`
        : 'Descreva o que você vê nesta tela.';

      const response = await this._callVisionAPI({
        systemPrompt: PROMPTS.describe,
        userText: userContent,
        imageBase64,
        maxTokens: MAX_TOKENS_DESCRIBE
      });

      return {
        success: true,
        description: response,
        elapsed_ms: Date.now() - startTime
      };
    } catch (err) {
      console.error('[VisionAnalyzer] Erro describe:', err.message);
      return { success: false, error: err.message, elapsed_ms: Date.now() - startTime };
    }
  }

  /**
   * Encontra um elemento na tela por descrição.
   * Retorna coordenadas x,y do centro do elemento.
   * 
   * @param {string} elementDescription - Descrição do elemento (ex: "botão Iniciar", "campo de busca")
   * @param {Object} [options={}]
   * @param {string} [options.base64] - Imagem em base64
   * @param {number} [options.screenWidth] - Largura real da tela (para escalar coordenadas)
   * @param {number} [options.screenHeight] - Altura real da tela
   * @returns {Promise<FindResult>}
   */
  async findElement(elementDescription, options = {}) {
    const startTime = Date.now();
    console.log(`[VisionAnalyzer] Modo find: "${elementDescription}"`);

    try {
      const imageBase64 = await this._getImage(options.base64);

      const response = await this._callVisionAPI({
        systemPrompt: PROMPTS.find,
        userText: `Encontre este elemento na tela: "${elementDescription}"`,
        imageBase64,
        maxTokens: MAX_TOKENS_FIND
      });

      // Parseia resposta JSON
      const parsed = this._parseJSON(response);

      if (!parsed) {
        return { success: false, found: false, error: 'Resposta da IA não é JSON válido', raw: response, elapsed_ms: Date.now() - startTime };
      }

      if (!parsed.found) {
        return { success: true, found: false, reason: parsed.reason || 'Elemento não encontrado', elapsed_ms: Date.now() - startTime };
      }

      // Escala coordenadas se necessário
      let x = parsed.x;
      let y = parsed.y;

      if (options.screenWidth && options.screenHeight) {
        // A imagem enviada foi redimensionada, escala as coordenadas de volta
        const scaleX = options.screenWidth / 640;
        const scaleY = options.screenHeight / 360;
        x = Math.round(parsed.x * scaleX);
        y = Math.round(parsed.y * scaleY);
      }

      const result = {
        success: true,
        found: true,
        x,
        y,
        confidence: parsed.confidence || 'medium',
        description: parsed.description || elementDescription,
        elapsed_ms: Date.now() - startTime
      };

      console.log(`[VisionAnalyzer] Elemento encontrado: (${x}, ${y}) confidence=${result.confidence}`);
      return result;

    } catch (err) {
      console.error('[VisionAnalyzer] Erro find:', err.message);
      return { success: false, found: false, error: err.message, elapsed_ms: Date.now() - startTime };
    }
  }

  /**
   * Extrai texto visível da tela (OCR via IA).
   * 
   * @param {Object} [options={}]
   * @param {string} [options.base64] - Imagem em base64
   * @returns {Promise<{success: boolean, text?: string, error?: string}>}
   */
  async readText(options = {}) {
    const startTime = Date.now();
    console.log('[VisionAnalyzer] Modo read (OCR)...');

    try {
      const imageBase64 = await this._getImage(options.base64);

      const response = await this._callVisionAPI({
        systemPrompt: PROMPTS.read,
        userText: 'Extraia todo o texto visível desta tela.',
        imageBase64,
        maxTokens: 1000
      });

      return { success: true, text: response, elapsed_ms: Date.now() - startTime };
    } catch (err) {
      console.error('[VisionAnalyzer] Erro read:', err.message);
      return { success: false, error: err.message, elapsed_ms: Date.now() - startTime };
    }
  }

  // ============================================================
  // INTERNOS
  // ============================================================

  /**
   * Obtém imagem base64: usa a fornecida ou captura a tela.
   * @private
   */
  async _getImage(providedBase64) {
    if (providedBase64) return providedBase64;

    if (!this._screenCapture) {
      throw new Error('Nenhuma imagem fornecida e ScreenCapture não configurado');
    }

    const capture = await this._screenCapture.captureScreen();
    if (!capture.success) {
      throw new Error(`Falha na captura: ${capture.error}`);
    }
    return capture.base64;
  }

  /**
   * Chama a OpenAI Vision API.
   * @private
   */
  _callVisionAPI({ systemPrompt, userText, imageBase64, maxTokens }) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: this._model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${imageBase64}`,
                  detail: 'low' // low=65 tokens, high=até 1k tokens
                }
              }
            ]
          }
        ]
      });

      const opts = {
        hostname: 'api.openai.com',
        port: 443,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this._apiKey}`
        }
      };

      const req = https.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const p = JSON.parse(data);
            if (p.choices?.[0]?.message?.content) {
              resolve(p.choices[0].message.content);
            } else if (p.error) {
              reject(new Error(p.error.message));
            } else {
              reject(new Error('Resposta inválida da Vision API'));
            }
          } catch (e) { reject(e); }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /**
   * Parseia JSON da resposta da IA.
   * @private
   */
  _parseJSON(response) {
    let cleaned = String(response).trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '');
    cleaned = cleaned.replace(/\n?```\s*$/i, '');
    cleaned = cleaned.trim();

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch (e2) { /* fall */ }
      }
      return null;
    }
  }
}

module.exports = { VisionAnalyzer };
