/**
 * mcp-client.js - Cliente MCP para comunicar com Desktop Commander
 * Protocolo: JSON-RPC 2.0 sobre stdio
 * O servidor MCP roda como processo filho
 */
const { spawn } = require('child_process');
const path = require('path');

class MCPClient {
  constructor() {
    this.process = null;
    this.requestId = 0;
    this.pending = new Map(); // id -> {resolve, reject}
    this.buffer = '';
    this.ready = false;
    this.tools = [];
  }

  async start() {
    const serverPath = path.join(
      __dirname, 'mcp-tools', 'desktopcommanderbuddy',
      'node_modules', '@wonderwhy-er', 'desktop-commander', 'dist', 'index.js'
    );

    return new Promise(async (resolve, reject) => {
      this.process = spawn('node', ['--no-warnings', serverPath, '--no-onboarding'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, TELEMETRY_ENABLED: 'false' }
      });

      this.process.stdout.on('data', (data) => {
        this.buffer += data.toString();
        this._processBuffer();
      });

      this.process.stderr.on('data', (data) => {
        // Ignora stderr do MCP (logs)
      });

      this.process.on('error', (err) => {
        console.error('[MCP] Erro ao iniciar:', err.message);
        reject(err);
      });

      this.process.on('close', (code) => {
        console.log('[MCP] Servidor encerrou com código:', code);
        this.ready = false;
      });

      // Espera o processo iniciar
      setTimeout(async () => {
        try {
          const initResult = await this._request('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'buddy-desktop', version: '1.0.0' }
        });
        console.log('[MCP] Inicializado:', initResult?.serverInfo?.name || 'ok');

        // Notifica initialized
        this._notify('notifications/initialized', {});

        // Lista tools disponíveis
        const toolsResult = await this._request('tools/list', {});
        this.tools = toolsResult?.tools || [];
        console.log(`[MCP] ${this.tools.length} ferramentas disponíveis`);

        this.ready = true;
        resolve(this.tools);
      } catch (e) {
        console.error('[MCP] Falha ao inicializar:', e);
        reject(e);
      }
      }, 2000); // espera 2s pro server subir
    });
  }

  // Envia request JSON-RPC e espera resposta
  _request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pending.set(id, { resolve, reject });

      const msg = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      });
      this._send(msg);

      // Timeout 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP timeout: ${method}`));
        }
      }, 30000);
    });
  }

  // Envia notificação (sem id, sem resposta)
  _notify(method, params) {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    this._send(msg);
  }

  // Envia mensagem pelo stdin (JSON por linha)
  _send(jsonStr) {
    if (!this.process || !this.process.stdin.writable) return;
    this.process.stdin.write(jsonStr + '\n');
  }

  // Processa buffer de respostas (JSON por linha OU Content-Length)
  _processBuffer() {
    while (true) {
      // Tenta Content-Length primeiro
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        const header = this.buffer.substring(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (match) {
          const len = parseInt(match[1]);
          const bodyStart = headerEnd + 4;
          if (this.buffer.length < bodyStart + len) break;
          const body = this.buffer.substring(bodyStart, bodyStart + len);
          this.buffer = this.buffer.substring(bodyStart + len);
          this._handleMessage(body);
          continue;
        }
      }

      // Fallback: JSON por linha
      const newlineIdx = this.buffer.indexOf('\n');
      if (newlineIdx === -1) break;
      const line = this.buffer.substring(0, newlineIdx).trim();
      this.buffer = this.buffer.substring(newlineIdx + 1);
      if (line) this._handleMessage(line);
    }
  }

  _handleMessage(text) {
    try {
      const msg = JSON.parse(text);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    } catch (e) {}
  }

  // Chama uma tool do MCP
  async callTool(name, args = {}) {
    if (!this.ready) throw new Error('MCP não está pronto');
    const result = await this._request('tools/call', { name, arguments: args });
    // Extrai texto do resultado
    if (result?.content) {
      return result.content.map(c => c.text || '').join('\n');
    }
    return JSON.stringify(result);
  }

  // Lista ferramentas disponíveis (com schema completo)
  getTools() {
    return this.tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema || { type: 'object', properties: {} }
    }));
  }

  // Para o servidor MCP
  stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.ready = false;
    }
  }
}

module.exports = MCPClient;
