/**
 * Testes unitários — llm-provider.js
 * Testa apenas lógica local (sem chamadas API reais)
 */
const { detectProvider, PROVIDERS } = require('../llm-provider');

async function run() {
  let passed = 0;
  let failed = 0;
  function ok(name, condition) {
    if (condition) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}`); }
  }

  console.log('\n🔌 llm-provider.js');

  // detectProvider
  ok('detect — gpt-4o-mini → openai', detectProvider('gpt-4o-mini') === 'openai');
  ok('detect — gpt-4.1 → openai', detectProvider('gpt-4.1') === 'openai');
  ok('detect — claude-sonnet-4 → anthropic', detectProvider('claude-sonnet-4-20250514') === 'anthropic');
  ok('detect — claude-haiku → anthropic', detectProvider('claude-haiku-4-5-20251001') === 'anthropic');
  ok('detect — gemini-2.0-flash → google', detectProvider('gemini-2.0-flash') === 'google');
  ok('detect — unknown → openai fallback', detectProvider('unknown-model') === 'openai');
  ok('detect — gpt-prefix → openai', detectProvider('gpt-5-turbo') === 'openai');
  ok('detect — claude-prefix → anthropic', detectProvider('claude-next') === 'anthropic');
  ok('detect — gemini-prefix → google', detectProvider('gemini-3.0') === 'google');

  // PROVIDERS structure
  ok('providers — openai exists', PROVIDERS.openai != null);
  ok('providers — anthropic exists', PROVIDERS.anthropic != null);
  ok('providers — google exists', PROVIDERS.google != null);

  // formatRequest — Anthropic
  const anthBody = PROVIDERS.anthropic.formatRequest({
    model: 'claude-sonnet-4-20250514',
    messages: [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' }
    ],
    max_tokens: 500,
    tools: [{ function: { name: 'test', description: 'test tool', parameters: {} } }]
  });
  ok('anthropic fmt — system extracted', anthBody.system === 'You are helpful');
  ok('anthropic fmt — messages filtered', anthBody.messages.length === 1);
  ok('anthropic fmt — tools mapped', anthBody.tools?.[0]?.name === 'test');

  // formatRequest — Google
  const gBody = PROVIDERS.google.formatRequest({
    model: 'gemini-2.0-flash',
    messages: [
      { role: 'system', content: 'Be concise' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' }
    ],
    max_tokens: 200
  });
  ok('google fmt — systemInstruction', gBody.systemInstruction?.parts?.[0]?.text === 'Be concise');
  ok('google fmt — contents mapped', gBody.contents.length === 2);
  ok('google fmt — role model', gBody.contents[1].role === 'model');

  // parseResponse — OpenAI
  const oaiResp = PROVIDERS.openai.parseResponse(JSON.stringify({
    choices: [{ message: { content: 'Hello!', tool_calls: null } }]
  }));
  ok('openai parse — content', oaiResp.content === 'Hello!');

  return { passed, failed };
}

module.exports = run;
