/**
 * Screen & Control Tools Integration — Buddy 2.0
 * 
 * Registra ScreenCapture, VisionAnalyzer e ComputerControl
 * como tools no Tool Registry do Agent.
 * 
 * @module actions/register-screen-tools
 */

const { ScreenCapture } = require('./screen-capture');
const { VisionAnalyzer } = require('./vision-analyzer');
const { ComputerControl } = require('./computer-control');
const { getToolRegistry } = require('../agent/tool-registry');

/**
 * Inicializa e registra todas as tools de tela/visão/controle.
 * 
 * @param {Object} options
 * @param {string} options.apiKey - OpenAI API Key (para vision)
 * @param {Function} [options.onExpression] - Callback para mudar expressão do Buddy
 * @returns {Object} { screenCapture, visionAnalyzer, computerControl }
 */
function registerScreenTools(options = {}) {
  const { apiKey, onExpression } = options;
  const registry = getToolRegistry();

  // Instancia os módulos
  const screenCapture = new ScreenCapture();
  const visionAnalyzer = apiKey
    ? new VisionAnalyzer({ apiKey, screenCapture })
    : null;
  const computerControl = new ComputerControl({
    visionAnalyzer,
    screenCapture
  });

  console.log('[ScreenTools] Registrando tools de tela/visão/controle...');

  // ============================================================
  // SCREEN CAPTURE TOOLS
  // ============================================================

  registry.register({
    name: 'screen_capture',
    description: 'Captura uma screenshot da tela. Retorna imagem JPEG otimizada em base64. Use para ver o que está na tela do usuário.',
    parameters: {
      type: 'object',
      properties: {
        screen: { type: 'number', description: 'Índice do monitor (0=principal). Default: 0' }
      }
    },
    execute: async (args) => {
      if (onExpression) onExpression('observing');
      const result = await screenCapture.captureScreen({ screen: args.screen || 0 });
      if (onExpression) onExpression('working');
      if (!result.success) return `Erro ao capturar tela: ${result.error}`;
      return `Screenshot capturada: ${result.sizeKB}KB, ${result.width}x${result.height}. Base64 disponível para análise.`;
    },
    source: 'screen',
    metadata: { category: 'vision' }
  });

  // ============================================================
  // VISION TOOLS
  // ============================================================

  if (visionAnalyzer) {
    registry.register({
      name: 'screen_describe',
      description: 'Analisa a tela e descreve o que vê. Pode responder perguntas específicas sobre o conteúdo da tela.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Pergunta sobre a tela (opcional). Ex: "Qual programa está aberto?"' }
        }
      },
      execute: async (args) => {
        if (onExpression) onExpression('observing');
        const result = await visionAnalyzer.describe({ question: args.question });
        if (onExpression) onExpression('working');
        if (!result.success) return `Erro na análise: ${result.error}`;
        return result.description;
      },
      source: 'screen',
      metadata: { category: 'vision' }
    });

    registry.register({
      name: 'screen_find',
      description: 'Encontra um elemento visual na tela por descrição. Retorna coordenadas x,y do centro do elemento. Use antes de screen_click.',
      parameters: {
        type: 'object',
        properties: {
          element: { type: 'string', description: 'Descrição do elemento. Ex: "botão Iniciar", "campo de busca", "ícone do Chrome"' }
        },
        required: ['element']
      },
      execute: async (args) => {
        if (onExpression) onExpression('observing');
        const result = await computerControl.screenFind(args.element);
        if (onExpression) onExpression('working');
        if (!result.success) return `Erro ao buscar elemento: ${result.error}`;
        if (!result.found) return `Elemento "${args.element}" não encontrado na tela. ${result.reason || ''}`;
        return `Elemento encontrado em (${result.x}, ${result.y}) com confiança ${result.confidence}`;
      },
      source: 'screen',
      metadata: { category: 'vision' }
    });

    registry.register({
      name: 'screen_read_text',
      description: 'Extrai todo o texto visível na tela (OCR via IA). Útil para ler conteúdo de janelas, documentos, etc.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        if (onExpression) onExpression('observing');
        const result = await visionAnalyzer.readText();
        if (onExpression) onExpression('working');
        if (!result.success) return `Erro no OCR: ${result.error}`;
        return result.text;
      },
      source: 'screen',
      metadata: { category: 'vision' }
    });
  } // end if visionAnalyzer

  // ============================================================
  // COMPUTER CONTROL TOOLS
  // ============================================================

  registry.register({
    name: 'computer_click',
    description: 'Clica com o mouse em coordenadas x,y da tela. Use screen_find primeiro para obter coordenadas.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Coordenada X' },
        y: { type: 'number', description: 'Coordenada Y' },
        button: { type: 'string', description: 'Botão: left (padrão), right, double' }
      },
      required: ['x', 'y']
    },
    execute: async (args) => {
      const btn = (args.button || 'left').toLowerCase();
      let result;
      if (btn === 'double') result = await computerControl.doubleClick(args.x, args.y);
      else if (btn === 'right') result = await computerControl.rightClick(args.x, args.y);
      else result = await computerControl.click(args.x, args.y);
      if (!result.success) return `Erro ao clicar: ${result.error}`;
      return `Clicado em (${result.x}, ${result.y})`;
    },
    source: 'screen',
    metadata: { category: 'control' }
  });

  registry.register({
    name: 'screen_click',
    description: 'Encontra um elemento na tela por descrição e clica nele. Combo de screen_find + click. Ex: "botão Salvar", "ícone do Chrome".',
    parameters: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'Descrição do elemento para clicar' }
      },
      required: ['element']
    },
    execute: async (args) => {
      if (onExpression) onExpression('observing');
      const result = await computerControl.screenClick(args.element);
      if (onExpression) onExpression('working');
      if (!result.success) return `Erro: ${result.error}`;
      if (!result.found) return `Elemento "${args.element}" não encontrado na tela`;
      if (!result.clicked) return `Encontrado mas erro ao clicar`;
      return `Clicado em "${args.element}" na posição (${result.x}, ${result.y})`;
    },
    source: 'screen',
    metadata: { category: 'control' }
  });

  registry.register({
    name: 'computer_type',
    description: 'Digita texto no campo/aplicação atualmente em foco.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Texto a digitar' }
      },
      required: ['text']
    },
    execute: async (args) => {
      const result = await computerControl.type(args.text);
      if (!result.success) return `Erro ao digitar: ${result.error}`;
      return `Digitado: "${args.text.substring(0, 50)}"`;
    },
    source: 'screen',
    metadata: { category: 'control' }
  });

  registry.register({
    name: 'computer_hotkey',
    description: 'Pressiona combinação de teclas. Ex: ["ctrl","c"] para copiar, ["alt","f4"] para fechar.',
    parameters: {
      type: 'object',
      properties: {
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Teclas a pressionar. Disponíveis: ctrl, alt, shift, win, enter, tab, escape, space, backspace, delete, up, down, left, right, f1-f12, a-z'
        }
      },
      required: ['keys']
    },
    execute: async (args) => {
      const result = await computerControl.hotkey(args.keys);
      if (!result.success) return `Erro: ${result.error}`;
      return `Hotkey executada: ${args.keys.join('+')}`;
    },
    source: 'screen',
    metadata: { category: 'control' }
  });

  registry.register({
    name: 'computer_scroll',
    description: 'Faz scroll na janela em foco. Positivo=baixo, negativo=cima.',
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Quantidade de scroll. Positivo=baixo, negativo=cima. Ex: 5, -3' }
      },
      required: ['amount']
    },
    execute: async (args) => {
      const result = await computerControl.scroll(args.amount);
      if (!result.success) return `Erro: ${result.error}`;
      return `Scroll: ${args.amount > 0 ? 'baixo' : 'cima'} (${Math.abs(args.amount)})`;
    },
    source: 'screen',
    metadata: { category: 'control' }
  });

  registry.register({
    name: 'computer_clipboard',
    description: 'Copia texto para ou lê texto do clipboard.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '"copy" para copiar texto, "paste" para ler o clipboard' },
        text: { type: 'string', description: 'Texto a copiar (obrigatório se action=copy)' }
      },
      required: ['action']
    },
    execute: async (args) => {
      if (args.action === 'copy') {
        const result = await computerControl.clipboardCopy(args.text || '');
        return result.success ? 'Texto copiado para o clipboard' : `Erro: ${result.error}`;
      } else {
        const result = await computerControl.clipboardPaste();
        return result.success ? `Clipboard: "${result.text}"` : `Erro: ${result.error}`;
      }
    },
    source: 'screen',
    metadata: { category: 'control' }
  });

  const stats = registry.getBySource('screen');
  console.log(`[ScreenTools] ${stats.length} tools registradas`);

  return { screenCapture, visionAnalyzer, computerControl };
}

module.exports = { registerScreenTools };
