/**
 * Code Helper Tools Integration — Buddy 2.0
 * Tools: code_generate, code_run, code_explain, code_edit, code_auto_build
 * @module actions/register-code-tools
 */

const { CodeHelper } = require('./code-helper');
const { getToolRegistry } = require('../agent/tool-registry');

function registerCodeTools(options = {}) {
  const { callLLM, onExpression } = options;
  const registry = getToolRegistry();

  const codeHelper = new CodeHelper({ callLLM });

  console.log('[CodeTools] Registrando tools...');

  registry.register({
    name: 'code_generate',
    description: 'Gera código via IA e salva em arquivo. Descreva o que o código deve fazer. Suporta JavaScript, Python, TypeScript, Shell, Batch, PowerShell.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'O que o código deve fazer. Ex: "script Python que baixa imagens de uma URL"' },
        filePath: { type: 'string', description: 'Onde salvar. Ex: "C:\\Users\\user\\Desktop\\script.py"' },
        language: { type: 'string', description: 'Linguagem (auto-detecta pela extensão se omitido)' },
      },
      required: ['description', 'filePath'],
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const r = await codeHelper.generate(args.description, args.filePath, args.language);
      if (onExpression) onExpression('happy');
      if (!r.success) return `Erro: ${r.error}`;
      return `Código ${r.language} gerado: ${r.path} (${r.lines} linhas)`;
    },
    source: 'code', metadata: { category: 'code' },
  });

  registry.register({
    name: 'code_run',
    description: 'Executa um arquivo de código (JavaScript, Python, etc.) e retorna a saída. Timeout de 30s.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Caminho do arquivo a executar' },
        timeout: { type: 'number', description: 'Timeout em ms (padrão: 30000)' },
      },
      required: ['filePath'],
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const r = await codeHelper.run(args.filePath, { timeout: args.timeout });
      if (onExpression) onExpression('happy');
      if (!r.success) return `Erro (exit ${r.exitCode || '?'}): ${r.error}\n${r.output || ''}`;
      return `Executado com sucesso:\n${r.output}`;
    },
    source: 'code', metadata: { category: 'code' },
  });

  registry.register({
    name: 'code_explain',
    description: 'Explica o que um código faz. Aceita código direto ou caminho de arquivo.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Código ou caminho de arquivo para explicar' },
      },
      required: ['code'],
    },
    execute: async (args) => {
      if (onExpression) onExpression('thinking');
      const r = await codeHelper.explain(args.code);
      if (onExpression) onExpression('happy');
      if (!r.success) return `Erro: ${r.error}`;
      return r.explanation;
    },
    source: 'code', metadata: { category: 'code' },
  });

  registry.register({
    name: 'code_edit',
    description: 'Edita código existente via IA. Descreva o que mudar e a IA refatora o arquivo.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Caminho do arquivo a editar' },
        instruction: { type: 'string', description: 'O que mudar. Ex: "adiciona tratamento de erro", "converte para async/await"' },
      },
      required: ['filePath', 'instruction'],
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const r = await codeHelper.edit(args.filePath, args.instruction);
      if (onExpression) onExpression('happy');
      if (!r.success) return `Erro: ${r.error}`;
      return `Código editado: ${r.path} (${r.lines} linhas)`;
    },
    source: 'code', metadata: { category: 'code' },
  });

  registry.register({
    name: 'code_auto_build',
    description: 'Gera código, executa, e se der erro corrige automaticamente em loop (até 3 tentativas). Ideal para scripts que precisam funcionar de primeira.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'O que o código deve fazer' },
        filePath: { type: 'string', description: 'Onde salvar' },
      },
      required: ['description', 'filePath'],
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const r = await codeHelper.autoBuild(args.description, args.filePath);
      if (onExpression) onExpression('happy');
      if (!r.success) return `Auto-build falhou após ${r.attempts} tentativas: ${r.error}\n${r.lastOutput || ''}`;
      return `Auto-build sucesso em ${r.attempts} tentativa(s)!\n${r.output}`;
    },
    source: 'code', metadata: { category: 'code' },
  });

  const stats = registry.getBySource('code');
  console.log(`[CodeTools] ${stats.length} tools registradas`);
  return { codeHelper };
}

module.exports = { registerCodeTools };
