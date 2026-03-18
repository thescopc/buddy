/**
 * Computer Control — Buddy 2.0
 * 
 * Controle de mouse, teclado e clipboard via @nut-tree-fork/nut-js.
 * Integra com VisionAnalyzer para screen_find (descreve → encontra → clica).
 * 
 * Actions: click, doubleClick, rightClick, type, hotkey, scroll,
 *          moveMouse, screen_find, screen_click, clipboard
 * 
 * @module actions/computer-control
 */

const { mouse, keyboard, clipboard, screen, Key, Button, Point } = require('@nut-tree-fork/nut-js');

// ============================================================
// CONSTANTES
// ============================================================
const DEFAULT_DELAY_MS = 100; // Delay entre ações
const TYPE_DELAY_MS = 50;     // Delay entre teclas ao digitar

// Configura nut-js
keyboard.config.autoDelayMs = TYPE_DELAY_MS;
mouse.config.autoDelayMs = DEFAULT_DELAY_MS;
mouse.config.mouseSpeed = 1500; // pixels/s

/** Mapeamento de nomes amigáveis para teclas */
const KEY_MAP = {
  'enter': Key.Enter, 'return': Key.Enter,
  'tab': Key.Tab, 'escape': Key.Escape, 'esc': Key.Escape,
  'space': Key.Space, 'backspace': Key.Backspace, 'delete': Key.Delete,
  'up': Key.Up, 'down': Key.Down, 'left': Key.Left, 'right': Key.Right,
  'home': Key.Home, 'end': Key.End, 'pageup': Key.PageUp, 'pagedown': Key.PageDown,
  'ctrl': Key.LeftControl, 'control': Key.LeftControl,
  'alt': Key.LeftAlt, 'shift': Key.LeftShift,
  'super': Key.LeftSuper, 'win': Key.LeftSuper, 'cmd': Key.LeftSuper,
  'f1': Key.F1, 'f2': Key.F2, 'f3': Key.F3, 'f4': Key.F4,
  'f5': Key.F5, 'f6': Key.F6, 'f7': Key.F7, 'f8': Key.F8,
  'f9': Key.F9, 'f10': Key.F10, 'f11': Key.F11, 'f12': Key.F12,
  'a': Key.A, 'b': Key.B, 'c': Key.C, 'd': Key.D, 'e': Key.E,
  'f': Key.F, 'g': Key.G, 'h': Key.H, 'i': Key.I, 'j': Key.J,
  'k': Key.K, 'l': Key.L, 'm': Key.M, 'n': Key.N, 'o': Key.O,
  'p': Key.P, 'q': Key.Q, 'r': Key.R, 's': Key.S, 't': Key.T,
  'u': Key.U, 'v': Key.V, 'w': Key.W, 'x': Key.X, 'y': Key.Y, 'z': Key.Z
};

class ComputerControl {
  /**
   * @param {Object} [options={}]
   * @param {Object} [options.visionAnalyzer] - Instância do VisionAnalyzer (para screen_find)
   * @param {Object} [options.screenCapture] - Instância do ScreenCapture
   */
  constructor(options = {}) {
    this._vision = options.visionAnalyzer || null;
    this._screenCapture = options.screenCapture || null;
  }

  // ============================================================
  // MOUSE
  // ============================================================

  /**
   * Move o mouse para uma posição.
   * @param {number} x
   * @param {number} y
   * @returns {Promise<{success: boolean}>}
   */
  async moveMouse(x, y) {
    try {
      await mouse.move([new Point(x, y)]);
      console.log(`[ComputerControl] Mouse movido para (${x}, ${y})`);
      return { success: true, x, y };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Clica em uma posição (ou posição atual).
   * @param {number} [x] - Se omitido, clica na posição atual
   * @param {number} [y]
   * @returns {Promise<{success: boolean}>}
   */
  async click(x, y) {
    try {
      if (x !== undefined && y !== undefined) {
        await mouse.move([new Point(x, y)]);
      }
      await mouse.click(Button.LEFT);
      const pos = await mouse.getPosition();
      console.log(`[ComputerControl] Click em (${pos.x}, ${pos.y})`);
      return { success: true, x: pos.x, y: pos.y };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Duplo clique.
   */
  async doubleClick(x, y) {
    try {
      if (x !== undefined && y !== undefined) {
        await mouse.move([new Point(x, y)]);
      }
      await mouse.doubleClick(Button.LEFT);
      const pos = await mouse.getPosition();
      console.log(`[ComputerControl] DoubleClick em (${pos.x}, ${pos.y})`);
      return { success: true, x: pos.x, y: pos.y };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Clique direito.
   */
  async rightClick(x, y) {
    try {
      if (x !== undefined && y !== undefined) {
        await mouse.move([new Point(x, y)]);
      }
      await mouse.click(Button.RIGHT);
      const pos = await mouse.getPosition();
      console.log(`[ComputerControl] RightClick em (${pos.x}, ${pos.y})`);
      return { success: true, x: pos.x, y: pos.y };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Scroll vertical.
   * @param {number} amount - Positivo = scroll down, negativo = scroll up
   */
  async scroll(amount) {
    try {
      if (amount > 0) {
        await mouse.scrollDown(Math.abs(amount));
      } else {
        await mouse.scrollUp(Math.abs(amount));
      }
      console.log(`[ComputerControl] Scroll: ${amount}`);
      return { success: true, amount };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // TECLADO
  // ============================================================

  /**
   * Digita texto.
   * @param {string} text - Texto a digitar
   * @returns {Promise<{success: boolean}>}
   */
  async type(text) {
    try {
      await keyboard.type(text);
      console.log(`[ComputerControl] Digitou: "${text.substring(0, 50)}..."`);
      return { success: true, text: text.substring(0, 50) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Pressiona combinação de teclas (hotkey).
   * @param {string[]} keys - Array de nomes de teclas (ex: ['ctrl', 'c'])
   * @returns {Promise<{success: boolean}>}
   */
  async hotkey(keys) {
    try {
      const nutKeys = keys.map(k => {
        const mapped = KEY_MAP[k.toLowerCase()];
        if (!mapped) throw new Error(`Tecla desconhecida: "${k}"`);
        return mapped;
      });

      // Pressiona todas as teclas em sequência, segura, e solta
      await keyboard.pressKey(...nutKeys);
      await keyboard.releaseKey(...nutKeys);
      console.log(`[ComputerControl] Hotkey: ${keys.join('+')}`);
      return { success: true, keys };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Pressiona uma única tecla.
   * @param {string} keyName - Nome da tecla (ex: 'enter', 'tab', 'f5')
   */
  async pressKey(keyName) {
    try {
      const nutKey = KEY_MAP[keyName.toLowerCase()];
      if (!nutKey) throw new Error(`Tecla desconhecida: "${keyName}"`);
      await keyboard.pressKey(nutKey);
      await keyboard.releaseKey(nutKey);
      console.log(`[ComputerControl] Tecla: ${keyName}`);
      return { success: true, key: keyName };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // CLIPBOARD
  // ============================================================

  /**
   * Copia texto para o clipboard.
   * @param {string} text
   */
  async clipboardCopy(text) {
    try {
      await clipboard.setContent(text);
      console.log(`[ComputerControl] Clipboard: copiado "${text.substring(0, 30)}..."`);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Lê texto do clipboard.
   * @returns {Promise<{success: boolean, text?: string}>}
   */
  async clipboardPaste() {
    try {
      const text = await clipboard.getContent();
      console.log(`[ComputerControl] Clipboard: lido "${text.substring(0, 30)}..."`);
      return { success: true, text };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // VISION + MOUSE (screen_find / screen_click)
  // ============================================================

  /**
   * Encontra um elemento na tela usando visão IA.
   * @param {string} description - Descrição do elemento (ex: "botão Iniciar")
   * @returns {Promise<{success, found, x, y, confidence}>}
   */
  async screenFind(description) {
    if (!this._vision) {
      return { success: false, error: 'VisionAnalyzer não configurado' };
    }

    try {
      // Pega resolução real da tela
      const screenSize = await screen.width();
      const screenH = await screen.height();

      const result = await this._vision.findElement(description, {
        screenWidth: screenSize,
        screenHeight: screenH
      });

      return result;
    } catch (err) {
      return { success: false, found: false, error: err.message };
    }
  }

  /**
   * Encontra um elemento e clica nele.
   * Combo: screen_find → move mouse → click
   * @param {string} description - Descrição do elemento
   * @returns {Promise<{success, found, clicked, x, y}>}
   */
  async screenClick(description) {
    console.log(`[ComputerControl] screenClick: "${description}"`);

    const found = await this.screenFind(description);
    if (!found.success || !found.found) {
      return { success: false, found: false, clicked: false, error: found.error || found.reason };
    }

    const clickResult = await this.click(found.x, found.y);
    return {
      success: clickResult.success,
      found: true,
      clicked: clickResult.success,
      x: found.x,
      y: found.y,
      confidence: found.confidence
    };
  }

  // ============================================================
  // UTILITÁRIOS
  // ============================================================

  /**
   * Retorna posição atual do mouse.
   */
  async getMousePosition() {
    try {
      const pos = await mouse.getPosition();
      return { success: true, x: pos.x, y: pos.y };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Retorna resolução da tela.
   */
  async getScreenSize() {
    try {
      const w = await screen.width();
      const h = await screen.height();
      return { success: true, width: w, height: h };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Espera um tempo (útil entre ações).
   * @param {number} ms
   */
  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Lista todas as teclas disponíveis para hotkey.
   * @returns {string[]}
   */
  getAvailableKeys() {
    return Object.keys(KEY_MAP);
  }
}

module.exports = { ComputerControl, KEY_MAP };
