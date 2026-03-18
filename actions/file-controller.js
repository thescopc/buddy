/**
 * File Controller — Buddy 2.0
 * 
 * Controle avançado de arquivos e pastas.
 * Ações: list, create, delete, move, copy, rename, read, write, find, disk_usage
 * Atalhos: "desktop", "downloads", "documents" resolvem pro caminho real.
 * 
 * @module actions/file-controller
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// ============================================================
// ATALHOS DE DIRETÓRIOS
// ============================================================
const HOME = os.homedir();
const DIR_SHORTCUTS = {
  'desktop':   path.join(HOME, 'Desktop'),
  'downloads': path.join(HOME, 'Downloads'),
  'documents': path.join(HOME, 'Documents'),
  'home':      HOME,
  'temp':      os.tmpdir(),
  'pictures':  path.join(HOME, 'Pictures'),
  'music':     path.join(HOME, 'Music'),
  'videos':    path.join(HOME, 'Videos'),
};

class FileController {
  /**
   * Resolve atalhos e caminhos relativos.
   * @param {string} p - Caminho ou atalho
   * @returns {string} Caminho absoluto
   */
  resolve(p) {
    if (!p) return HOME;
    const lower = p.toLowerCase().trim();
    if (DIR_SHORTCUTS[lower]) return DIR_SHORTCUTS[lower];
    if (lower.startsWith('~')) return path.join(HOME, p.substring(1));
    return path.resolve(p);
  }

  /**
   * Lista arquivos e pastas de um diretório.
   * @param {string} dirPath - Caminho ou atalho
   * @param {Object} [options={}]
   * @param {boolean} [options.recursive=false]
   * @param {string} [options.filter] - Filtro por extensão (ex: ".js")
   * @returns {Promise<{success:boolean, items?:Array, error?:string}>}
   */
  async list(dirPath, options = {}) {
    try {
      const resolved = this.resolve(dirPath);
      const entries = await fsp.readdir(resolved, { withFileTypes: true });
      let items = [];

      for (const entry of entries) {
        const fullPath = path.join(resolved, entry.name);
        const isDir = entry.isDirectory();

        if (options.filter && !isDir && !entry.name.endsWith(options.filter)) continue;

        let size = 0;
        try { if (!isDir) { const stat = await fsp.stat(fullPath); size = stat.size; } } catch (_) {}

        items.push({
          name: entry.name,
          path: fullPath,
          type: isDir ? 'directory' : 'file',
          size,
          ext: isDir ? '' : path.extname(entry.name),
        });

        if (options.recursive && isDir) {
          try {
            const sub = await this.list(fullPath, { ...options, recursive: true });
            if (sub.success) items = items.concat(sub.items);
          } catch (_) {}
        }
      }

      return { success: true, path: resolved, count: items.length, items };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Cria arquivo ou diretório.
   * @param {string} targetPath - Caminho
   * @param {Object} [options={}]
   * @param {boolean} [options.isDirectory=false]
   * @param {string} [options.content=''] - Conteúdo inicial do arquivo
   * @returns {Promise<{success:boolean, path?:string, error?:string}>}
   */
  async create(targetPath, options = {}) {
    try {
      const resolved = this.resolve(targetPath);
      if (options.isDirectory) {
        await fsp.mkdir(resolved, { recursive: true });
      } else {
        await fsp.mkdir(path.dirname(resolved), { recursive: true });
        await fsp.writeFile(resolved, options.content || '', 'utf-8');
      }
      return { success: true, path: resolved, type: options.isDirectory ? 'directory' : 'file' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Deleta arquivo ou diretório.
   */
  async delete(targetPath) {
    try {
      const resolved = this.resolve(targetPath);
      const stat = await fsp.stat(resolved);
      if (stat.isDirectory()) {
        await fsp.rm(resolved, { recursive: true, force: true });
      } else {
        await fsp.unlink(resolved);
      }
      return { success: true, path: resolved, deleted: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Move arquivo ou diretório.
   */
  async move(source, destination) {
    try {
      const src = this.resolve(source);
      const dst = this.resolve(destination);
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      await fsp.rename(src, dst);
      return { success: true, from: src, to: dst };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Copia arquivo ou diretório.
   */
  async copy(source, destination) {
    try {
      const src = this.resolve(source);
      const dst = this.resolve(destination);
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      const stat = await fsp.stat(src);
      if (stat.isDirectory()) {
        await fsp.cp(src, dst, { recursive: true });
      } else {
        await fsp.copyFile(src, dst);
      }
      return { success: true, from: src, to: dst };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Renomeia arquivo ou diretório.
   */
  async rename(targetPath, newName) {
    try {
      const src = this.resolve(targetPath);
      const dst = path.join(path.dirname(src), newName);
      await fsp.rename(src, dst);
      return { success: true, from: src, to: dst, newName };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Lê conteúdo de um arquivo.
   * @param {string} filePath
   * @param {Object} [options={}]
   * @param {number} [options.maxSize=100000] - Máximo de bytes a ler
   * @returns {Promise<{success:boolean, content?:string, error?:string}>}
   */
  async read(filePath, options = {}) {
    try {
      const resolved = this.resolve(filePath);
      const stat = await fsp.stat(resolved);
      const maxSize = options.maxSize || 100000;
      if (stat.size > maxSize) {
        const fd = await fsp.open(resolved, 'r');
        const buf = Buffer.alloc(maxSize);
        await fd.read(buf, 0, maxSize, 0);
        await fd.close();
        return { success: true, path: resolved, content: buf.toString('utf-8'), truncated: true, totalSize: stat.size };
      }
      const content = await fsp.readFile(resolved, 'utf-8');
      return { success: true, path: resolved, content, size: stat.size };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Escreve conteúdo em um arquivo.
   */
  async write(filePath, content, options = {}) {
    try {
      const resolved = this.resolve(filePath);
      await fsp.mkdir(path.dirname(resolved), { recursive: true });
      if (options.append) {
        await fsp.appendFile(resolved, content, 'utf-8');
      } else {
        await fsp.writeFile(resolved, content, 'utf-8');
      }
      return { success: true, path: resolved, bytes: Buffer.byteLength(content) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Busca arquivos por nome ou extensão.
   * @param {string} dirPath - Diretório raiz da busca
   * @param {string} query - Nome parcial ou extensão (ex: ".js", "readme")
   * @param {Object} [options={}]
   * @param {number} [options.maxResults=20]
   * @param {number} [options.maxDepth=5]
   * @returns {Promise<{success:boolean, results?:Array, error?:string}>}
   */
  async find(dirPath, query, options = {}) {
    try {
      const resolved = this.resolve(dirPath);
      const maxResults = options.maxResults || 20;
      const maxDepth = options.maxDepth || 5;
      const queryLower = query.toLowerCase();
      const results = [];

      const _scan = async (dir, depth) => {
        if (depth > maxDepth || results.length >= maxResults) return;
        let entries;
        try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
        for (const entry of entries) {
          if (results.length >= maxResults) break;
          const fullPath = path.join(dir, entry.name);
          if (entry.name.toLowerCase().includes(queryLower)) {
            let size = 0;
            try { const s = await fsp.stat(fullPath); size = s.size; } catch (_) {}
            results.push({ name: entry.name, path: fullPath, type: entry.isDirectory() ? 'directory' : 'file', size });
          }
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await _scan(fullPath, depth + 1);
          }
        }
      };

      await _scan(resolved, 0);
      return { success: true, query, searchPath: resolved, count: results.length, results };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Retorna uso de disco de um diretório.
   * Também retorna os N maiores arquivos.
   * @param {string} dirPath
   * @param {Object} [options={}]
   * @param {number} [options.topN=5] - Top N maiores arquivos
   * @returns {Promise<{success:boolean, totalSize?:number, topFiles?:Array, error?:string}>}
   */
  async diskUsage(dirPath, options = {}) {
    try {
      const resolved = this.resolve(dirPath);
      const topN = options.topN || 5;
      let totalSize = 0;
      const allFiles = [];

      const _scan = async (dir) => {
        let entries;
        try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
              await _scan(fullPath);
            }
          } else {
            try {
              const stat = await fsp.stat(fullPath);
              totalSize += stat.size;
              allFiles.push({ name: entry.name, path: fullPath, size: stat.size });
            } catch (_) {}
          }
        }
      };

      await _scan(resolved);

      allFiles.sort((a, b) => b.size - a.size);
      const topFiles = allFiles.slice(0, topN).map(f => ({
        ...f,
        sizeFormatted: this._formatSize(f.size),
      }));

      return {
        success: true,
        path: resolved,
        totalSize,
        totalFormatted: this._formatSize(totalSize),
        fileCount: allFiles.length,
        topFiles,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Formata tamanho em bytes para string legível.
   */
  _formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}

module.exports = { FileController, DIR_SHORTCUTS };
