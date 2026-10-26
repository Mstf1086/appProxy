import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  buildModelsBlock,
  buildProviderBlock,
  derivePassthroughPrefixes,
  normalizeBaseUrl,
  runWizard,
  upsertEnvLine,
  validateProviderName,
} from '../src/add-provider.mjs';

test('validateProviderName slug kuralları', () => {
  assert.deepEqual(validateProviderName('deepseek', []), { ok: true, slug: 'deepseek' });
  assert.deepEqual(validateProviderName('  My-Provider_2 ', []), { ok: true, slug: 'my-provider_2' });
  assert.equal(validateProviderName('', []).ok, false);
  assert.equal(validateProviderName('sağlayıcı', []).ok, false); // Türkçe karakter reddedilir
  assert.equal(validateProviderName('a b', []).ok, false);
  assert.equal(validateProviderName('deepseek', ['deepseek']).ok, false); // çakışma
});

test('normalizeBaseUrl openai kind /v1 eklemeyi önerir', () => {
  assert.deepEqual(
    normalizeBaseUrl('https://llm.onerouter.pro', 'openai'),
    { url: 'https://llm.onerouter.pro/v1', appended: true },
  );
  assert.deepEqual(
    normalizeBaseUrl('https://llm.onerouter.pro/v1/', 'openai'),
    { url: 'https://llm.onerouter.pro/v1', appended: false },
  );
  assert.deepEqual(
    normalizeBaseUrl('llm.onerouter.pro', 'openai'),
    { url: 'https://llm.onerouter.pro/v1', appended: true },
  );
  assert.deepEqual(
    normalizeBaseUrl('https://openrouter.ai/api/', 'anthropic'),
    { url: 'https://openrouter.ai/api', appended: false },
  );
});

test('buildProviderBlock openai alanlarını doldurur', () => {
  const block = buildProviderBlock({
    name: 'onerouter',
    kind: 'openai',
    baseUrl: 'https://llm.onerouter.pro/v1',
    apiKeyEnv: 'ONEROUTER_API_KEY',
    defaultModel: 'deepseek/deepseek-v3.2',
  });
  assert.equal(block.kind, 'openai');
  assert.equal(block.maxTokensField, 'max_tokens');
  assert.equal(block.streamIncludeUsage, true);
  assert.equal(block.mapReasoningToThinking, true);
  assert.equal(block.defaultModel, 'deepseek/deepseek-v3.2');
  assert.match(block.docNote, /sihirbaz/);
});

test('buildProviderBlock gemini alanlarını doldurur', () => {
  const block = buildProviderBlock({
    name: 'x',
    kind: 'gemini',
    baseUrl: 'https://example.com',
    apiKeyEnv: 'X_API_KEY',
  });
  assert.equal(block.apiVersion, 'v1beta');
  assert.equal(block.maxOutputTokens, 65536);
  assert.deepEqual(block.safetySettings, []);
});

test('buildModelsBlock kuralları ve presetleri üretir', () => {
  const block = buildModelsBlock({
    defaultModel: 'deepseek/deepseek-v3.2',
    fastModel: 'deepseek/deepseek-v3.2-flash',
    presets: ['deepseek/deepseek-v3.2', 'other/model'],
    passthroughPrefixes: ['deepseek/'],
  });
  assert.deepEqual(block.rules, [
    { match: '*haiku*', model: 'deepseek/deepseek-v3.2-flash' },
    { match: '*', model: 'deepseek/deepseek-v3.2' },
  ]);
  assert.deepEqual(block.passthroughPrefixes, ['deepseek/']);
  assert.deepEqual(
    block.presets.map((p) => p.id),
    ['deepseek/deepseek-v3.2', 'deepseek/deepseek-v3.2-flash', 'other/model'],
  );
});

test('upsertEnvLine mevcut satırı günceller, yoksa ekler', () => {
  assert.equal(upsertEnvLine('A=1\nB=eskideger\n', 'B', 'yeni'), 'A=1\nB=yeni\n');
  assert.equal(upsertEnvLine('A=1\n', 'B', 'x'), 'A=1\n\nB=x\n');
  assert.equal(upsertEnvLine('A=1', 'B', ''), 'A=1\n\nB=\n');
  assert.equal(upsertEnvLine('', 'B', 'x'), '\nB=x\n');
});


// --- runWizard stdin EOF (Ctrl+D) regresyonu -------------------------------
// Node, kapalı readline arayüzündeki promise-tarzı question() çağrılarını
// anında `undefined` ile çözer; eskiden bu cevap sanılıp validate döngüsü
// sonsuza dek dönüyor ve süreç heap OOM ile çöküyordu.
const WIZARD_TEST_CFG = {
  root: '/tmp/appproxy-wizard-test',
  providers: { gemini: {} },
  models: {},
  active: () => ({}),
  apiKeyOf: () => '',
};

test('stdin EOF sihirbazı sonsuz döngüye sokmaz (OOM regresyonu)', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (c) => chunks.push(String(c)));

  const wizardPromise = runWizard({ input, output, cfg: WIZARD_TEST_CFG });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  // Satırları tek tek yaz: aynı chunk'ta gelirse readline soru beklemeyen
  // satırları düşürür (gerçek terminalde böyle olmaz).
  input.write('yeni-saglayici\n'); // ad sorusu
  await tick();
  input.write('5\n'); // kind sorusuna geçersiz cevap
  await tick();
  input.end(); // Ctrl+D / EOF

  const result = await wizardPromise;
  assert.equal(result, null);

  const text = chunks.join('');
  // Geçersiz cevap için tek bir hata satırı gelir, EOF seli değil.
  assert.equal((text.match(/HATA: 1, 2, 3 veya 4 gir/g) ?? []).length, 1);
  assert.match(text, /Sihirbaz iptal edildi/);
});


test('gizli API anahtarı promptu görünür ve akış devam eder', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (c) => chunks.push(String(c)));

  const wizardPromise = runWizard({ input, output, cfg: WIZARD_TEST_CFG });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  input.write('infron\n'); await tick();                       // ad
  input.write('1\n'); await tick();                            // kind: openai
  input.write('https://llm.onerouter.pro/v1\n'); await tick(); // base url (/v1 → onay sorusu yok)
  input.write('\n'); await tick();                              // api anahtarı: boş

  const soFar = chunks.join('');
  // Prompt muted'a değil gerçek çıktıya yazılmalı; yoksa sihirbaz takılı gibi görünür.
  assert.match(soFar, /API anahtarı \(INFRON_API_KEY, gizli/);
  assert.match(soFar, /Model listesi alınamadı \(API anahtarı girilmedi\)/);

  input.end(); // Ctrl+D / EOF
  const result = await wizardPromise;
  assert.equal(result, null);
});


test('derivePassthroughPrefixes satıcı öneklerini türetir', () => {
  assert.deepEqual(
    derivePassthroughPrefixes(['z-ai/glm-5.3-flash', 'deepseek/deepseek-v4.1-flash:free', 'z-ai/glm-4']),
    ['z-ai/', 'deepseek/'],
  );
  // öneksiz kimlikler yok sayılır
  assert.deepEqual(derivePassthroughPrefixes(['gemini-3.8-flash']), []);
  // max sınırı uygular
  assert.deepEqual(derivePassthroughPrefixes(['a/x', 'b/y', 'c/z'], { max: 2 }), ['a/', 'b/']);
});
