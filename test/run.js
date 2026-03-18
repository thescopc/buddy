/**
 * test/run.js — Test runner do Buddy 2.0
 * Executa todos os testes unitários
 * Uso: node test/run.js
 */

const testMemoryManager = require('./test-memory-manager');
const testSettings = require('./test-settings');
const testLLMProvider = require('./test-llm-provider');

async function main() {
  console.log('🧪 Buddy 2.0 — Testes Unitários\n' + '='.repeat(40));
  
  let totalPassed = 0;
  let totalFailed = 0;

  const suites = [
    testMemoryManager,
    testSettings,
    testLLMProvider,
  ];

  for (const suite of suites) {
    try {
      const { passed, failed } = await suite();
      totalPassed += passed;
      totalFailed += failed;
    } catch (e) {
      console.error(`  💥 CRASH: ${e.message}`);
      totalFailed++;
    }
  }

  console.log('\n' + '='.repeat(40));
  console.log(`📊 Total: ${totalPassed + totalFailed} testes`);
  console.log(`   ✅ Passed: ${totalPassed}`);
  console.log(`   ❌ Failed: ${totalFailed}`);
  console.log('='.repeat(40));

  process.exit(totalFailed > 0 ? 1 : 0);
}

main();
