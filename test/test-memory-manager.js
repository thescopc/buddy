/**
 * Testes unitários — memory/memory-manager.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const MEMORY_DIR = path.join(__dirname, '..', 'memory');
const TEST_FILE = path.join(MEMORY_DIR, 'structured-memory.json');

// Limpa singleton entre testes
function freshManager() {
  delete require.cache[require.resolve('../memory/memory-manager')];
  if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
  const { getMemoryManager } = require('../memory/memory-manager');
  return getMemoryManager(MEMORY_DIR);
}

async function run() {
  let passed = 0;
  let failed = 0;
  
  function ok(name, condition) {
    if (condition) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}`); }
  }

  console.log('\n📦 memory-manager.js');
  
  // Init
  const mm = freshManager();
  await mm.init();
  ok('init — cria memória vazia', mm._countEntries() === 0);
  ok('init — versão 2.0', (await mm.getAll())._meta.version === '2.0');

  // Update + Get
  await mm.update({ identity: { name: { value: 'Francesco' } } });
  const name = await mm.get('identity', 'name');
  ok('update/get — salva e recupera', name?.value === 'Francesco');

  // Merge recursivo
  await mm.update({ identity: { city: 'Uberlândia' } });
  const id = await mm.get('identity');
  ok('merge — preserva name', id.name?.value === 'Francesco');
  ok('merge — adiciona city', id.city?.value === 'Uberlândia');

  // Truncate
  await mm.update({ notes: { long: { value: 'A'.repeat(400) } } });
  const note = await mm.get('notes', 'long');
  ok('truncate — 303 chars', note.value.length === 303);

  // Remove
  await mm.remove('notes', 'long');
  ok('remove — retorna null', (await mm.get('notes', 'long')) === null);

  // Search
  const results = await mm.search('Francesco');
  ok('search — encontra', results.length > 0 && results[0].value === 'Francesco');

  // formatMemoryForPrompt
  const prompt = await mm.formatMemoryForPrompt();
  ok('prompt — contém [USER MEMORY]', prompt.includes('[USER MEMORY]'));
  ok('prompt — contém nome', prompt.includes('Francesco'));

  // Flush + persist
  await mm.flush();
  ok('flush — arquivo existe', fs.existsSync(TEST_FILE));
  const raw = JSON.parse(fs.readFileSync(TEST_FILE, 'utf-8'));
  ok('persist — nome no arquivo', raw.identity?.name?.value === 'Francesco');

  // Stats
  const stats = await mm.stats();
  ok('stats — totalEntries', stats.totalEntries >= 2);

  // Clear
  await mm.clear();
  ok('clear — zera', mm._countEntries() === 0);

  await mm.destroy();
  if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);

  return { passed, failed };
}

module.exports = run;
