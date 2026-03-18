/**
 * Code Helper — Buddy 2.0
 * 
 * Geração, execução, edição e explicação de código via LLM.
 * - Escrever código (LLM gera, salva em arquivo)
 * - Rodar código (subprocess com timeout)
 * - Editar código existente
 * - Explicar código
 * - Auto-build: gera, testa, corrige em loop
 * 
 * @module actions/code-helper
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const EXEC_TIMEOUT_MS = 30000;
const MAX_OUTPUT_CHARS = 5000;

/** Detecta linguagem pela extensão */
const LANG_MAP = {
  '.js': { cmd: 'node', name: 'JavaScript' },
  '.py': { cmd: 'python', name: 'Python' },
  '.ts': { cmd: 'npx ts-node', name: 'TypeScript' },
  '.sh': { cmd: 'bash', name: 'Shell' },
  '.bat': { cmd: 'cmd /c', name: 'Batch' },
  '.ps1': { cmd: 'powershell -File', name: 'PowerShell' },
};

class CodeHelper {
  /**
   * @param {Object} [options={}]
   * @param {Function} [options.callLLM] - Função para chamar LLM
   */
  constructor(options = {}) {
    this._callLLM = options.callLLM || null;
  }

  // ============================================================
  // GERAR CÓDIGO
  // ============================================================

  /**
   * Gera código via LLM e salva em arquivo.
   * @param {string} description - O que o código deve fazer
   * @param {string} filePath - Onde salvar
   * @param {string} [language] - Linguagem (auto-detecta pela extensão)
   * @returns {Promise<{success:boolean, path?:string, code?:string, error?:string}>}
   */
  async generate(description, filePath, language) {
    try {
      if (!this._callLLM) return { success: false, error: 'callLLM não configurado' };

      const ext = path.extname(filePath);
      const lang = language || LANG_MAP[ext]?.name || 'JavaScript';

      const messages = [{
        role: 'user',
        content: `Gere código ${lang} que faça o seguinte: ${description}\n\nRetorne APENAS o código, sem explicações, sem markdown, sem \`\`\`. Código limpo e funcional.`
      }];

      const code = await this._callLLM(messages);
      // Limpa possíveis backticks residuais
      const cleanCode = code.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();

      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, cleanCode, 'utf-8');

      console.log(`[CodeHelper] Código gerado: ${filePath} (${cleanCode.length} chars)`);
      return { success: true, path: filePath, language: lang, lines: cleanCode.split('\n').length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // EXECUTAR CÓDIGO
  // ============================================================

  /**
   * Executa um arquivo de código em subprocess com timeout.
   * @param {string} filePath - Caminho do arquivo
   * @param {Object} [options={}]
   * @param {number} [options.timeout=30000] - Timeout em ms
   * @returns {Promise<{success:boolean, output?:string, exitCode?:number, error?:string}>}
   */
  async run(filePath, options = {}) {
    try {
      const ext = path.extname(filePath);
      const langInfo = LANG_MAP[ext];
      if (!langInfo) {
        return { success: false, error: `Extensão "${ext}" não suportada. Use: ${Object.keys(LANG_MAP).join(', ')}` };
      }

      if (!fs.existsSync(filePath)) {
        return { success: false, error: `Arquivo não encontrado: ${filePath}` };
      }

      const timeout = options.timeout || EXEC_TIMEOUT_MS;
      const cmdParts = langInfo.cmd.split(' ');
      const cmd = cmdParts[0];
      const args = [...cmdParts.slice(1), filePath];

      return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const proc = spawn(cmd, args, {
          cwd: path.dirname(filePath),
          timeout,
          shell: true,
        });

        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill('SIGTERM');
        }, timeout);

        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        proc.on('close', (code) => {
          clearTimeout(timer);
          const output = (stdout + (stderr ? '\n[STDERR]\n' + stderr : '')).substring(0, MAX_OUTPUT_CHARS);
          if (timedOut) {
            resolve({ success: false, error: `Timeout após ${timeout / 1000}s`, output });
          } else if (code !== 0) {
            resolve({ success: false, exitCode: code, error: `Processo terminou com código ${code}`, output });
          } else {
            resolve({ success: true, exitCode: 0, output });
          }
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({ success: false, error: err.message });
        });
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // EXPLICAR CÓDIGO
  // ============================================================

  /**
   * Explica o que um trecho de código faz.
   * @param {string} code - Código ou caminho de arquivo
   * @returns {Promise<{success:boolean, explanation?:string, error?:string}>}
   */
  async explain(code) {
    try {
      if (!this._callLLM) return { success: false, error: 'callLLM não configurado' };

      let codeContent = code;
      // Se parece um caminho de arquivo, lê o conteúdo
      if (code.includes('/') || code.includes('\\') || code.match(/\.\w{1,5}$/)) {
        try {
          codeContent = await fsp.readFile(code, 'utf-8');
        } catch (_) { /* usa como código direto */ }
      }

      const messages = [{
        role: 'user',
        content: `Explique de forma clara e concisa o que este código faz:\n\n${codeContent.substring(0, 3000)}`
      }];

      const explanation = await this._callLLM(messages);
      return { success: true, explanation };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // EDITAR CÓDIGO
  // ============================================================

  /**
   * Edita código existente via LLM.
   * @param {string} filePath - Caminho do arquivo
   * @param {string} instruction - O que mudar
   * @returns {Promise<{success:boolean, path?:string, error?:string}>}
   */
  async edit(filePath, instruction) {
    try {
      if (!this._callLLM) return { success: false, error: 'callLLM não configurado' };

      const content = await fsp.readFile(filePath, 'utf-8');
      const messages = [{
        role: 'user',
        content: `Edite o código abaixo conforme a instrução. Retorne APENAS o código editado completo, sem explicações, sem markdown.\n\nInstrução: ${instruction}\n\nCódigo atual:\n${content.substring(0, 6000)}`
      }];

      const edited = await this._callLLM(messages);
      const cleanCode = edited.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();
      await fsp.writeFile(filePath, cleanCode, 'utf-8');

      return { success: true, path: filePath, lines: cleanCode.split('\n').length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // AUTO-BUILD (gera, testa, corrige em loop)
  // ============================================================

  /**
   * Gera código, executa, e se falhar, corrige automaticamente (até 3x).
   * @param {string} description - O que o código deve fazer
   * @param {string} filePath - Onde salvar
   * @param {number} [maxAttempts=3]
   * @returns {Promise<{success:boolean, attempts?:number, output?:string, error?:string}>}
   */
  async autoBuild(description, filePath, maxAttempts = 3) {
    try {
      // 1. Gera
      const genResult = await this.generate(description, filePath);
      if (!genResult.success) return genResult;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // 2. Executa
        const runResult = await this.run(filePath);
        if (runResult.success) {
          return { success: true, attempts: attempt, output: runResult.output, path: filePath };
        }

        // 3. Se falhou e ainda tem tentativas, corrige
        if (attempt < maxAttempts) {
          console.log(`[CodeHelper] Auto-build tentativa ${attempt} falhou, corrigindo...`);
          const fixInstruction = `O código deu erro ao executar. Corrija o seguinte erro:\n${runResult.output || runResult.error}`;
          await this.edit(filePath, fixInstruction);
        } else {
          return { success: false, attempts: attempt, error: `Falhou após ${maxAttempts} tentativas`, lastOutput: runResult.output };
        }
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = { CodeHelper, LANG_MAP };
