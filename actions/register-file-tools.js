/**
 * File Controller Tools Integration — Buddy 2.0
 * 
 * Registra FileController como tools no Tool Registry.
 * Tools: file_list, file_create, file_delete, file_move, file_copy,
 *        file_rename, file_read, file_write, file_find, file_disk_usage
 * 
 * @module actions/register-file-tools
 */

const { FileController } = require('./file-controller');
const { getToolRegistry } = require('../agent/tool-registry');

function registerFileTools(options = {}) {
  const { onExpression } = options;
  const registry = getToolRegistry();
  const fc = new FileController();

  console.log('[FileTools] Registrando tools de arquivo...');

  registry.register({
    name: 'file_list',
    description: 'Lista arquivos e pastas de um diretório. Aceita atalhos: "desktop", "downloads", "documents", "home", "temp", "pictures", "music", "videos".',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho ou atalho. Ex: "desktop", "C:\\Users\\user", "downloads"' },
        recursive: { type: 'boolean', description: 'Listar recursivamente (padrão: false)' },
        filter: { type: 'string', description: 'Filtrar por extensão. Ex: ".js", ".pdf"' },
      },
      required: ['path'],
    },
    execute: async (args) => {
      const r = await fc.list(args.path, { recursive: args.recursive, filter: args.filter });
      if (!r.success) return `Erro: ${r.error}`;
      const summary = r.items.slice(0, 30).map(i => `${i.type === 'directory' ? '[DIR]' : '[FILE]'} ${i.name}${i.size ? ' (' + fc._formatSize(i.size) + ')' : ''}`).join('\n');
      return `${r.count} itens em ${r.path}:\n${summary}${r.count > 30 ? `\n... e mais ${r.count - 30}` : ''}`;
    },
    source: 'files', metadata: { category: 'files' },
  });

  registry.register({
    name: 'file_create',
    description: 'Cria arquivo ou diretório. Para diretório, use isDirectory=true.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo/pasta a criar' },
        isDirectory: { type: 'boolean', description: 'true para criar pasta (padrão: false)' },
        content: { type: 'string', description: 'Conteúdo inicial do arquivo (opcional)' },
      },
      required: ['path'],
    },
    execute: async (args) => {
      const r = await fc.create(args.path, { isDirectory: args.isDirectory, content: args.content });
      if (!r.success) return `Erro: ${r.error}`;
      return `Criado ${r.type}: ${r.path}`;
    },
    source: 'files', metadata: { category: 'files' },
  });

  registry.register({
    name: 'file_delete',
    description: 'Deleta arquivo ou diretório (recursivo). AÇÃO DESTRUTIVA — use com cuidado.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Caminho do arquivo/pasta a deletar' } },
      required: ['path'],
    },
    execute: async (args) => {
      const r = await fc.delete(args.path);
      if (!r.success) return `Erro: ${r.error}`;
      return `Deletado: ${r.path}`;
    },
    source: 'files', metadata: { category: 'files', destructive: true },
  });

  registry.register({
    name: 'file_move',
    description: 'Move arquivo ou diretório para outro local.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Caminho de origem' },
        destination: { type: 'string', description: 'Caminho de destino' },
      },
      required: ['source', 'destination'],
    },
    execute: async (args) => {
      const r = await fc.move(args.source, args.destination);
      if (!r.success) return `Erro: ${r.error}`;
      return `Movido: ${r.from} → ${r.to}`;
    },
    source: 'files', metadata: { category: 'files' },
  });

  registry.register({
    name: 'file_copy',
    description: 'Copia arquivo ou diretório.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Caminho de origem' },
        destination: { type: 'string', description: 'Caminho de destino' },
      },
      required: ['source', 'destination'],
    },
    execute: async (args) => {
      const r = await fc.copy(args.source, args.destination);
      if (!r.success) return `Erro: ${r.error}`;
      return `Copiado: ${r.from} → ${r.to}`;
    },
    source: 'files', metadata: { category: 'files' },
  });

  registry.register({
    name: 'file_rename',
    description: 'Renomeia arquivo ou diretório.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo/pasta' },
        newName: { type: 'string', description: 'Novo nome (só o nome, sem caminho)' },
      },
      required: ['path', 'newName'],
    },
    execute: async (args) => {
      const r = await fc.rename(args.path, args.newName);
      if (!r.success) return `Erro: ${r.error}`;
      return `Renomeado: ${r.from} → ${r.newName}`;
    },
    source: 'files', metadata: { category: 'files' },
  });

  registry.register({
    name: 'file_read',
    description: 'Lê o conteúdo de um arquivo de texto. Retorna o texto até o limite configurado.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo' },
        maxSize: { type: 'number', description: 'Máximo de bytes (padrão: 100000)' },
      },
      required: ['path'],
    },
    execute: async (args) => {
      const r = await fc.read(args.path, { maxSize: args.maxSize });
      if (!r.success) return `Erro: ${r.error}`;
      return `Conteúdo de ${r.path}${r.truncated ? ' (truncado)' : ''}:\n${r.content}`;
    },
    source: 'files', metadata: { category: 'files' },
  });

  registry.register({
    name: 'file_write',
    description: 'Escreve conteúdo em um arquivo. Cria o arquivo se não existir. Use append=true para adicionar ao final.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo' },
        content: { type: 'string', description: 'Conteúdo a escrever' },
        append: { type: 'boolean', description: 'Adicionar ao final (padrão: false, sobrescreve)' },
      },
      required: ['path', 'content'],
    },
    execute: async (args) => {
      const r = await fc.write(args.path, args.content, { append: args.append });
      if (!r.success) return `Erro: ${r.error}`;
      return `Escrito ${r.bytes} bytes em ${r.path}`;
    },
    source: 'files', metadata: { category: 'files' },
  });

  registry.register({
    name: 'file_find',
    description: 'Busca arquivos por nome ou extensão dentro de um diretório. Aceita atalhos.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Diretório raiz da busca. Ex: "desktop", "C:\\"' },
        query: { type: 'string', description: 'Nome parcial ou extensão. Ex: ".pdf", "readme", "foto"' },
        maxResults: { type: 'number', description: 'Máximo de resultados (padrão: 20)' },
      },
      required: ['path', 'query'],
    },
    execute: async (args) => {
      const r = await fc.find(args.path, args.query, { maxResults: args.maxResults });
      if (!r.success) return `Erro: ${r.error}`;
      if (r.count === 0) return `Nenhum resultado para "${r.query}" em ${r.searchPath}`;
      const list = r.results.map(f => `${f.type === 'directory' ? '[DIR]' : '[FILE]'} ${f.path} (${fc._formatSize(f.size)})`).join('\n');
      return `${r.count} resultados para "${r.query}":\n${list}`;
    },
    source: 'files', metadata: { category: 'files' },
  });

  registry.register({
    name: 'file_disk_usage',
    description: 'Retorna uso de disco de um diretório e os N maiores arquivos. Aceita atalhos.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Diretório para analisar. Ex: "downloads", "desktop"' },
        topN: { type: 'number', description: 'Top N maiores arquivos (padrão: 5)' },
      },
      required: ['path'],
    },
    execute: async (args) => {
      if (onExpression) onExpression('working');
      const r = await fc.diskUsage(args.path, { topN: args.topN });
      if (onExpression) onExpression('happy');
      if (!r.success) return `Erro: ${r.error}`;
      const topList = r.topFiles.map((f, i) => `${i + 1}. ${f.name} — ${f.sizeFormatted}`).join('\n');
      return `Uso de disco em ${r.path}:\nTotal: ${r.totalFormatted} (${r.fileCount} arquivos)\n\nMaiores arquivos:\n${topList}`;
    },
    source: 'files', metadata: { category: 'files' },
  });

  const stats = registry.getBySource('files');
  console.log(`[FileTools] ${stats.length} tools registradas`);

  return { fileController: fc };
}

module.exports = { registerFileTools };
