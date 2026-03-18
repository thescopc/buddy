/**
 * migrate-memory.js — Migração one-shot da memória legada para JSON estruturado
 * 
 * Converte:
 * - memory/user.md → structured-memory.json (identity)
 * - memory/personality.md → structured-memory.json (identity.buddy_*)
 * 
 * Mantém compatibilidade:
 * - memory/daily/*.md → NÃO migra (continua como diário markdown)
 * - memory/tasks.md → NÃO migra (continua como lista markdown)
 * - Arquivos .md originais são preservados (não deleta)
 * 
 * Uso: node memory/migrate-memory.js
 * Ou: require('./migrate-memory').migrate(memoryDir)
 */

const fs = require('fs');
const path = require('path');
const { getMemoryManager } = require('./memory-manager');

/**
 * Parseia um arquivo .md com formato "chave: valor" por linha
 * @param {string} filePath
 * @returns {Object} { chave: valor, ... }
 */
function parseMdKeyValue(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  if (!content) return {};

  const result = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Ignora linhas vazias, headers markdown, e comentários
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    
    // Formato "chave: valor"
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.substring(0, colonIdx).trim().toLowerCase().replace(/\s+/g, '_');
      const value = trimmed.substring(colonIdx + 1).trim();
      if (key && value) {
        result[key] = value;
      }
    }
  }
  return result;
}

/**
 * Executa a migração
 * @param {string} memoryDir - Caminho da pasta memory/
 * @returns {Object} Resumo da migração
 */
async function migrate(memoryDir) {
  memoryDir = memoryDir || path.join(__dirname);
  
  const jsonPath = path.join(memoryDir, 'structured-memory.json');
  const userMdPath = path.join(memoryDir, 'user.md');
  const personalityMdPath = path.join(memoryDir, 'personality.md');
  
  const summary = {
    alreadyMigrated: false,
    userFields: 0,
    personalityFields: 0,
    totalMigrated: 0
  };

  // Se já existe structured-memory.json com dados, não sobrescreve
  if (fs.existsSync(jsonPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      const hasData = ['identity', 'preferences', 'relationships', 'notes']
        .some(cat => existing[cat] && Object.keys(existing[cat]).length > 0);
      if (hasData) {
        console.log('[MIGRATE] structured-memory.json já existe com dados. Pulando migração.');
        summary.alreadyMigrated = true;
        return summary;
      }
    } catch (e) { /* JSON inválido, prossegue */ }
  }

  // Parseia os .md legados
  const userData = parseMdKeyValue(userMdPath);
  const personalityData = parseMdKeyValue(personalityMdPath);
  
  console.log('[MIGRATE] user.md:', JSON.stringify(userData));
  console.log('[MIGRATE] personality.md:', JSON.stringify(personalityData));

  // Monta o update para o MemoryManager
  const updates = { identity: {}, notes: {} };

  // user.md → identity (dados do usuário)
  // Mapeamento de chaves conhecidas
  const userKeyMap = {
    nome: 'nome',
    name: 'nome',
    idade: 'idade',
    age: 'idade',
    cidade: 'cidade',
    city: 'cidade',
    profissao: 'profissao',
    profissão: 'profissao',
    email: 'email',
    telefone: 'telefone',
    github: 'github'
  };

  for (const [key, value] of Object.entries(userData)) {
    const mappedKey = userKeyMap[key] || key;
    updates.identity[mappedKey] = { value, source: 'migration' };
    summary.userFields++;
  }

  // personality.md → identity com prefixo buddy_ (dados do Buddy)
  for (const [key, value] of Object.entries(personalityData)) {
    const buddyKey = `buddy_${key}`;
    updates.identity[buddyKey] = { value, source: 'migration' };
    summary.personalityFields++;
  }

  summary.totalMigrated = summary.userFields + summary.personalityFields;

  if (summary.totalMigrated === 0) {
    console.log('[MIGRATE] Nenhum dado encontrado nos .md legados.');
    return summary;
  }

  // Inicializa o MemoryManager e aplica os updates
  const mm = getMemoryManager(memoryDir);
  await mm.init();
  await mm.update(updates);
  await mm.flush();
  
  console.log(`[MIGRATE] ✅ Migração concluída: ${summary.totalMigrated} campo(s) migrado(s)`);
  console.log(`[MIGRATE]   - user.md: ${summary.userFields} campo(s)`);
  console.log(`[MIGRATE]   - personality.md: ${summary.personalityFields} campo(s)`);
  console.log(`[MIGRATE]   Arquivos .md originais preservados.`);
  console.log(`[MIGRATE]   daily/*.md e tasks.md NÃO foram alterados.`);
  
  return summary;
}

module.exports = { migrate, parseMdKeyValue };

// Execução direta: node memory/migrate-memory.js
if (require.main === module) {
  const memDir = process.argv[2] || path.join(__dirname);
  console.log(`[MIGRATE] Migrando memória em: ${memDir}`);
  migrate(memDir).then(summary => {
    console.log('[MIGRATE] Resumo:', JSON.stringify(summary, null, 2));
    process.exit(0);
  }).catch(e => {
    console.error('[MIGRATE] Erro:', e.message);
    process.exit(1);
  });
}
