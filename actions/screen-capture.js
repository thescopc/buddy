/**
 * Screen Capture — Buddy 2.0
 * 
 * Captura de tela e webcam para o sistema de visão.
 * - Usa screenshot-desktop para captura no main process
 * - Usa sharp para redimensionar/otimizar JPEG
 * - Webcam via getUserMedia (executa no renderer via IPC)
 * 
 * @module actions/screen-capture
 */

const sharp = require('sharp');
const screenshot = require('screenshot-desktop');

// ============================================================
// CONSTANTES
// ============================================================
const TARGET_WIDTH = 640;
const TARGET_HEIGHT = 360;
const JPEG_QUALITY = 70; // 0-100
const MAX_SIZE_BYTES = 100 * 1024; // 100KB

class ScreenCapture {
  constructor() {
    /** @type {Buffer|null} Último screenshot capturado */
    this._lastScreenshot = null;

    /** @type {Buffer|null} Último frame de webcam */
    this._lastWebcamFrame = null;

    /** @type {number} Timestamp da última captura */
    this._lastCaptureTime = 0;
  }

  /**
   * Captura a tela inteira via screenshot-desktop.
   * Redimensiona e otimiza para JPEG econômico.
   * 
   * @param {Object} [options={}]
   * @param {number} [options.width=640] - Largura alvo
   * @param {number} [options.height=360] - Altura alvo
   * @param {number} [options.quality=70] - Qualidade JPEG (0-100)
   * @param {number} [options.screen=0] - Índice do monitor (0 = principal)
   * @returns {Promise<CaptureResult>}
   */
  async captureScreen(options = {}) {
    const {
      width = TARGET_WIDTH,
      height = TARGET_HEIGHT,
      quality = JPEG_QUALITY,
      screen = 0
    } = options;

    const startTime = Date.now();
    console.log(`[ScreenCapture] Capturando tela (${width}x${height}, q=${quality})...`);

    try {
      // Captura tela como buffer PNG
      const displays = await screenshot.listDisplays();
      const targetDisplay = displays[screen] || displays[0];

      const rawBuffer = await screenshot({ screen: targetDisplay.id, format: 'png' });

      // Redimensiona e converte para JPEG otimizado
      let jpegBuffer = await sharp(rawBuffer)
        .resize(width, height, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

      // Se ainda está grande demais, reduz qualidade progressivamente
      let currentQuality = quality;
      while (jpegBuffer.length > MAX_SIZE_BYTES && currentQuality > 20) {
        currentQuality -= 10;
        jpegBuffer = await sharp(rawBuffer)
          .resize(width, height, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: currentQuality, mozjpeg: true })
          .toBuffer();
      }

      const elapsed = Date.now() - startTime;
      this._lastScreenshot = jpegBuffer;
      this._lastCaptureTime = Date.now();

      const result = {
        success: true,
        buffer: jpegBuffer,
        base64: jpegBuffer.toString('base64'),
        mimeType: 'image/jpeg',
        width,
        height,
        sizeBytes: jpegBuffer.length,
        sizeKB: Math.round(jpegBuffer.length / 1024),
        quality: currentQuality,
        elapsed_ms: elapsed,
        display: {
          id: targetDisplay.id,
          name: targetDisplay.name || `Display ${screen}`
        }
      };

      console.log(`[ScreenCapture] Tela capturada: ${result.sizeKB}KB em ${elapsed}ms (q=${currentQuality})`);
      return result;

    } catch (err) {
      console.error('[ScreenCapture] Erro ao capturar tela:', err.message);
      return {
        success: false,
        error: err.message,
        elapsed_ms: Date.now() - startTime
      };
    }
  }

  /**
   * Lista os displays/monitores disponíveis.
   * @returns {Promise<Array<{id, name}>>}
   */
  async listDisplays() {
    try {
      const displays = await screenshot.listDisplays();
      return displays.map((d, i) => ({
        id: d.id,
        name: d.name || `Display ${i}`,
        index: i
      }));
    } catch (err) {
      console.error('[ScreenCapture] Erro ao listar displays:', err.message);
      return [];
    }
  }

  /**
   * Processa um frame de webcam recebido do renderer (base64 data URL).
   * Redimensiona e otimiza para JPEG.
   * 
   * @param {string} dataUrl - Data URL do frame (ex: "data:image/png;base64,...")
   * @param {Object} [options={}]
   * @returns {Promise<CaptureResult>}
   */
  async processWebcamFrame(dataUrl, options = {}) {
    const {
      width = TARGET_WIDTH,
      height = TARGET_HEIGHT,
      quality = JPEG_QUALITY
    } = options;

    const startTime = Date.now();

    try {
      // Extrai base64 do data URL
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const rawBuffer = Buffer.from(base64Data, 'base64');

      // Redimensiona e converte
      const jpegBuffer = await sharp(rawBuffer)
        .resize(width, height, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

      this._lastWebcamFrame = jpegBuffer;
      const elapsed = Date.now() - startTime;

      const result = {
        success: true,
        buffer: jpegBuffer,
        base64: jpegBuffer.toString('base64'),
        mimeType: 'image/jpeg',
        sizeBytes: jpegBuffer.length,
        sizeKB: Math.round(jpegBuffer.length / 1024),
        elapsed_ms: elapsed,
        source: 'webcam'
      };

      console.log(`[ScreenCapture] Webcam processada: ${result.sizeKB}KB em ${elapsed}ms`);
      return result;

    } catch (err) {
      console.error('[ScreenCapture] Erro ao processar webcam:', err.message);
      return { success: false, error: err.message, elapsed_ms: Date.now() - startTime };
    }
  }

  /**
   * Retorna o último screenshot capturado.
   * @returns {Buffer|null}
   */
  getLastScreenshot() {
    return this._lastScreenshot;
  }

  /**
   * Retorna o último frame de webcam.
   * @returns {Buffer|null}
   */
  getLastWebcamFrame() {
    return this._lastWebcamFrame;
  }

  /**
   * Retorna base64 do último screenshot (para enviar à API de visão).
   * @returns {string|null}
   */
  getLastScreenshotBase64() {
    return this._lastScreenshot ? this._lastScreenshot.toString('base64') : null;
  }
}

module.exports = { ScreenCapture };
