/**
 * memory-extractor.js — Extração automática de memória via LLM
 * 
 * Estágio 1 (Triagem): gpt-4o-mini faz YES/NO — "essa mensagem contém fatos pessoais?"
 * Estágio 2 (Extração): Se YES, extrai JSON estruturado e salva no MemoryManager
 * 
 * - Skip se mensagem < 10 chars ou idêntica à anterior
 * - Execução assíncrona (não bloqueia o fluxo principal)
 * - Configurável: intervalo de turnos entre extrações
 */

const EventEmitter = require('events');
const https = require('https');

const TRIAGE_MODEL = 'gpt-4o-mini';
const EXTRACT_MODEL = 'gpt-4o-mini';
const MIN_MESSAGE_LENGTH = 10;
const DEFAULT_TURN_INTERVAL = 1; // Extrai a cada N turnos

class MemoryExtractor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.memoryManager = options.memoryManager;
    this.apiKey = options.apiKey;
    this.turnInterval = options.turnInterval || DEFAULT_TURN_INTERVAL;
    this.turnCount = 0;
    this.lastMessage = '';
    this._running = false;
    this._queue = [];
  }

  /**
   * Processa uma mensagem do usuário (chamado a cada turno)
   * @param {string} userMessage - Mensagem do usuário
   * @param {string} [assistantResponse] - Resposta do assistant (contexto extra)
   */
  async processMessage(userMessage, assistantResponse) {
    // Skip: mensagem curta
    if (!userMessage || userMessage.length < MIN_MESSAGE_LENGTH) {
      return { skipped: true, reason: 'too_short' };
    }

    // Skip: idêntica à anterior
    if (userMessage === this.lastMessage) {
      return { skipped: true, reason: 'duplicate' };
    }
    this.lastMessage = userMessage;

    // Skip: não é o turno de extrair
    this.turnCount++;
    if (this.turnCount % this.turnInterval !== 0) {
      return { skipped: true, reason: 'interval' };
    }

    // Executa extração assíncrona (não bloqueia)
    this._enqueue(userMessage, assistantResponse);
    return { skipped: false, queued: true };
  }

  _enqueue(userMessage, assistantResponse) {
    this._queue.push({ userMessage, assistantResponse });
    if (!this._running) this._processQueue();
  }

  async _processQueue() {
    if (this._running || this._queue.length === 0) return;
    this._running = true;

    while (this._queue.length > 0) {
      const { userMessage, assistantResponse } = this._queue.shift();
      try {
        await this._extract(userMessage, assistantResponse);
      } catch (e) {
        console.error('[MEMORY-EXT] Erro na extração:', e.message);
        if (this.listenerCount('error') > 0) this.emit('error', e);
      }
    }

    this._running = false;
  }

  // ─── Estágio 1: Triagem (YES/NO) ──────────────────────
  async _triage(userMessage, assistantResponse) {
    const context = assistantResponse 
      ? `Usuário: "${userMessage}"\nAssistente: "${assistantResponse.substring(0, 300)}"`
      : `Usuário: "${userMessage}"`;

    const messages = [
      {
        role: 'system',
        content: `Você é um classificador. Analise a mensagem abaixo e responda APENAS "YES" ou "NO".
Responda YES se a mensagem contém QUALQUER um destes tipos de informação pessoal sobre o USUÁRIO:
- Nome, idade, profissão, localização, cidade
- Preferências (comida, música, cor, idioma, tecnologia)
- Relacionamentos (família, amigos, colegas, pets)
- Rotina, hábitos, hobbies
- Opiniões, sentimentos duradouros
- Dados úteis que o assistente deveria lembrar para futuras conversas

Responda NO se:
- É apenas uma pergunta factual ou técnica
- É um comando/tarefa sem informação pessoal
- É uma saudação simples
- A informação é sobre outra pessoa que não o usuário
- É sobre eventos temporários sem relevância futura`
      },
      { role: 'user', content: context }
    ];

    const result = await this._callLLM(messages, TRIAGE_MODEL, 10);
    const answer = result.trim().toUpperCase();
    return answer.startsWith('YES');
  }

  // ─── Estágio 2: Extração JSON ─────────────────────────
  async _extractFacts(userMessage, assistantResponse) {
    const context = assistantResponse
      ? `Usuário: "${userMessage}"\nAssistente: "${assistantResponse.substring(0, 500)}"`
      : `Usuário: "${userMessage}"`;

    // Carrega memória atual para evitar duplicatas
    let currentMemory = '';
    try {
      const all = await this.memoryManager.getAll();
      const entries = [];
      for (const cat of ['identity', 'preferences', 'relationships', 'notes']) {
        for (const [k, v] of Object.entries(all[cat] || {})) {
          entries.push(`${cat}.${k}: ${typeof v === 'object' ? v.value : v}`);
        }
      }
      if (entries.length > 0) currentMemory = `\nMemória atual:\n${entries.join('\n')}`;
    } catch (e) { /* ignora */ }

    const messages = [
      {
        role: 'system',
        content: `Extraia FATOS PESSOAIS do usuário a partir da mensagem. Retorne APENAS JSON válido (sem markdown, sem backticks).
${currentMemory}

Formato de resposta:
{
  "identity": { "chave": "valor" },
  "preferences": { "chave": "valor" },
  "relationships": { "chave": "valor" },
  "notes": { "chave": "valor" }
}
Categorias:
- identity: nome, idade, profissão, cidade, país, idioma nativo
- preferences: comida favorita, música, cor, tecnologia, editor, SO, linguagens
- relationships: família, pets, amigos próximos, colegas
- notes: qualquer outro fato relevante para lembrar

Regras:
- Use chaves descritivas em snake_case (ex: "nome", "cidade", "pet_nome")
- Valores são strings curtas (máx 100 chars)
- NÃO repita informações que já estão na memória atual
- Se não há NADA novo para extrair, retorne: {}
- Apenas fatos SOBRE O USUÁRIO, não sobre outros`
      },
      { role: 'user', content: context }
    ];

    const result = await this._callLLM(messages, EXTRACT_MODEL, 500);
    
    try {
      // Limpa possíveis artefatos
      const cleaned = result
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      
      const parsed = JSON.parse(cleaned);
      return parsed;
    } catch (e) {
      console.error('[MEMORY-EXT] JSON inválido da LLM:', result.substring(0, 200));
      return null;
    }
  }

  // ─── Pipeline completa ────────────────────────────────
  async _extract(userMessage, assistantResponse) {
    console.log('[MEMORY-EXT] Triagem para:', userMessage.substring(0, 60));

    // Estágio 1: Triagem
    const shouldExtract = await this._triage(userMessage, assistantResponse);
    this.emit('triage', { message: userMessage.substring(0, 60), result: shouldExtract });

    if (!shouldExtract) {
      console.log('[MEMORY-EXT] Triagem: NO — sem fatos pessoais');
      return;
    }

    console.log('[MEMORY-EXT] Triagem: YES — extraindo fatos...');

    // Estágio 2: Extração
    const facts = await this._extractFacts(userMessage, assistantResponse);
    
    if (!facts || Object.keys(facts).length === 0) {
      console.log('[MEMORY-EXT] Extração: nenhum fato novo');
      return;
    }

    // Filtra categorias vazias
    const filtered = {};
    let totalNew = 0;
    for (const cat of ['identity', 'preferences', 'relationships', 'notes']) {
      if (facts[cat] && Object.keys(facts[cat]).length > 0) {
        filtered[cat] = facts[cat];
        totalNew += Object.keys(facts[cat]).length;
      }
    }

    if (totalNew === 0) {
      console.log('[MEMORY-EXT] Extração: nenhum fato novo após filtro');
      return;
    }

    // Salva no MemoryManager
    console.log(`[MEMORY-EXT] Salvando ${totalNew} fato(s):`, JSON.stringify(filtered));
    await this.memoryManager.update(filtered);
    this.emit('extracted', { facts: filtered, count: totalNew });
  }

  // ─── LLM Helper ──────────────────────────────────────
  _callLLM(messages, model, maxTokens) {
    return new Promise((resolve, reject) => {
      if (!this.apiKey) {
        reject(new Error('API key não configurada'));
        return;
      }

      const bodyObj = { model, max_tokens: maxTokens, messages, temperature: 0 };
      const body = JSON.stringify(bodyObj);
      const opts = {
        hostname: 'api.openai.com', port: 443,
        path: '/v1/chat/completions', method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
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
              reject(new Error('Resposta LLM inválida'));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // ─── Stats e Destroy ──────────────────────────────────
  getStats() {
    return {
      turnCount: this.turnCount,
      queueLength: this._queue.length,
      isRunning: this._running
    };
  }

  destroy() {
    this._queue = [];
    this._running = false;
    this.removeAllListeners();
  }
}

module.exports = { MemoryExtractor };
