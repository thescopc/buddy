/**
 * Testes unitários — settings-manager.js
 */
const path = require('path');
const fs = require('fs');

const SETTINGS_FILE = path.join(__dirname, '..', 'settings.json');

function freshSettings() {
  delete require.cache[require.resolve('../settings-manager')];
  if (fs.existsSync(SETTINGS_FILE)) fs.unlinkSync(SETTINGS_FILE);
  return require('../settings-manager');
}

async function run() {
  let passed = 0;
  let failed = 0;
  function ok(name, condition) {
    if (condition) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}`); }
  }

  console.log('\n⚙️  settings-manager.js');

  // Load defaults
  const sm = freshSettings();
  const s = sm.load();
  ok('load — retorna defaults', s.aiModel === 'gpt-4o-mini');
  ok('load — voiceEnabled true', s.voiceEnabled === true);
  ok('load — anthropicApiKey vazio', s.anthropicApiKey === '');

  // Save
  sm.save({ aiModel: 'gpt-4o', openaiApiKey: 'sk-test123' });
  ok('save — modelo atualizado', sm.get('aiModel') === 'gpt-4o');
  ok('save — API key salva', sm.get('openaiApiKey') === 'sk-test123');
  ok('save — arquivo existe', fs.existsSync(SETTINGS_FILE));

  // getAllSafe mascara keys
  const safe = sm.getAllSafe();
  ok('getAllSafe — key mascarada', safe.openaiApiKey.includes('•'));
  ok('getAllSafe — começa com sk-t', safe.openaiApiKey.startsWith('sk-t'));

  // Merge preserva outros campos
  sm.save({ voiceEnabled: false });
  ok('merge — model preservado', sm.get('aiModel') === 'gpt-4o');
  ok('merge — voice atualizado', sm.get('voiceEnabled') === false);

  // Migrate
  const sm2 = freshSettings();
  sm2.migrateFromMainJs('sk-real-key', 'gpt-4.1');
  ok('migrate — API key', sm2.get('openaiApiKey') === 'sk-real-key');
  ok('migrate — model', sm2.get('aiModel') === 'gpt-4.1');

  // Idempotência do migrate
  sm2.save({ aiModel: 'gpt-4o' });
  const migrated = sm2.migrateFromMainJs('sk-other', 'gpt-4.1-mini');
  ok('migrate idempotente — não sobrescreve', migrated === false);
  ok('migrate idempotente — model preservado', sm2.get('aiModel') === 'gpt-4o');

  // Cleanup
  if (fs.existsSync(SETTINGS_FILE)) fs.unlinkSync(SETTINGS_FILE);
  return { passed, failed };
}

module.exports = run;
