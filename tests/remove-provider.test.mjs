import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import {
  removeEnvLine,
  removeProvider,
  runRemoveWizard,
} from '../src/remove-provider.mjs';

function makeFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appproxy-remove-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(
    path.join(root, 'config', 'providers.json'),
    JSON.stringify({
      server: { host: '127.0.0.1', port: 8790 },
      providers: {
        gemini: { kind: 'gemini', baseUrl: 'https://example.com', apiKeyEnv: 'GEMINI_API_KEY' },
        silinecek: {
          kind: 'openai',
          baseUrl: 'https://llm.example.com/v1',
          apiKeyEnv: 'SILINECEK_API_KEY',
        },
      },
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(root, 'config', 'models.json'),
    JSON.stringify({
      _comment: ['test'],
      silinecek: { passthroughPrefixes: [], rules: [{ match: '*', model: 'x' }] },
    }, null, 2),
  );
  fs.writeFileSync(path.join(root, '.env'), 'PROXY_TOKEN=t\nGEMINI_API_KEY=g\n\nSILINECEK_API_KEY=s\n');
  fs.writeFileSync(
    path.join(root, '.env.example'),
    'PROXY_TOKEN=\nGEMINI_API_KEY=\n\n# silinecek (https://llm.example.com/v1)\nSILINECEK_API_KEY=\n',
  );
  return root;
}

function readJson(root, rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

test('removeEnvLine KEY satırını kaldırır', () => {
  assert.equal(removeEnvLine('A=1\nB=2\n', 'B'), 'A=1\n');
  assert.equal(removeEnvLine('A=1\nB=2\n', 'C'), 'A=1\nB=2\n'); // yoksa dokunmaz
  assert.equal(removeEnvLine('B=2\n', 'B'), '');
});

test('removeEnvLine .env.example yorumunu da temizler', () => {
  const text = 'A=1\n\n# silinecek (https://x.example/v1)\nSILINECEK_API_KEY=\n';
  assert.equal(removeEnvLine(text, 'SILINECEK_API_KEY', { commentPrefix: 'silinecek' }), 'A=1\n');
  // yorum adı uyuşmuyorsa yalnızca KEY satırı gider
  const text2 = 'A=1\n\n# baska (https://x.example/v1)\nSILINECEK_API_KEY=\n';
  assert.equal(removeEnvLine(text2, 'SILINECEK_API_KEY', { commentPrefix: 'silinecek' }), 'A=1\n\n# baska (https://x.example/v1)\n');
});

test('removeProvider tüm dosyalardan temizler', () => {
  const root = makeFixtureRoot();
  const result = removeProvider({
    root,
    name: 'silinecek',
    config: {
      root,
      providers: { silinecek: { apiKeyEnv: 'SILINECEK_API_KEY' } },
      models: {},
    },
  });

  assert.deepEqual(result, { ok: true, name: 'silinecek', apiKeyEnv: 'SILINECEK_API_KEY', hadModels: true });
  assert.deepEqual(Object.keys(readJson(root, 'config/providers.json').providers), ['gemini']);
  assert.equal(readJson(root, 'config/models.json').silinecek, undefined);
  assert.equal(readJson(root, 'config/models.json')._comment.length, 1); // diğer bloklar korunur
  const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
  assert.ok(!env.includes('SILINECEK'), '.env anahtar satırı silinmeli');
  assert.ok(env.includes('GEMINI_API_KEY=g'), 'diğer anahtarlar korunmalı');
  const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.ok(!envExample.includes('SILINECEK'), '.env.example temizlenmeli');
  assert.ok(!envExample.includes('# silinecek ('), 'yorum satırı da gitmeli');
  fs.rmSync(root, { recursive: true, force: true });
});

test('removeProvider bilinmeyen adı reddeder', () => {
  const root = makeFixtureRoot();
  const result = removeProvider({ root, name: 'yok', config: { root, providers: {}, models: {} } });
  assert.equal(result.ok, false);
  assert.match(result.error, /bilinmeyen provider/);
  assert.deepEqual(Object.keys(readJson(root, 'config/providers.json').providers), ['gemini', 'silinecek']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('runRemoveWizard onaysız hiçbir dosyaya dokunmaz', async () => {
  const root = makeFixtureRoot();
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (c) => chunks.push(String(c)));

  const wizard = runRemoveWizard({
    input,
    output,
    name: 'silinecek',
    cfg: { root, providers: readJson(root, 'config/providers.json').providers, models: {} },
  });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  input.write('h\n'); // Hayır
  await tick();
  input.end();
  const result = await wizard;

  assert.equal(result, null);
  assert.match(chunks.join(''), /Vazgeçildi/);
  assert.deepEqual(
    Object.keys(readJson(root, 'config/providers.json').providers),
    ['gemini', 'silinecek'],
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('runRemoveWizard onayla siler', async () => {
  const root = makeFixtureRoot();
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (c) => chunks.push(String(c)));

  const wizard = runRemoveWizard({
    input,
    output,
    name: 'silinecek',
    cfg: { root, providers: readJson(root, 'config/providers.json').providers, models: {} },
  });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  input.write('e\n'); // Evet
  await tick();
  input.end();
  const result = await wizard;

  assert.deepEqual(result, { name: 'silinecek' });
  assert.match(chunks.join(''), /Provider kaldırıldı: silinecek/);
  assert.deepEqual(Object.keys(readJson(root, 'config/providers.json').providers), ['gemini']);
  assert.ok(!fs.readFileSync(path.join(root, '.env'), 'utf8').includes('SILINECEK'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('runRemoveWizard stdin EOF kontrolü iptal eder', async () => {
  const root = makeFixtureRoot();
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (c) => chunks.push(String(c)));

  const wizard = runRemoveWizard({
    input,
    output,
    cfg: { root, providers: readJson(root, 'config/providers.json').providers, models: {} },
  });
  input.end(); // ad seçimi beklerken EOF
  const result = await wizard;

  assert.equal(result, null);
  assert.match(chunks.join(''), /Sihirbaz iptal edildi/);
  assert.deepEqual(
    Object.keys(readJson(root, 'config/providers.json').providers),
    ['gemini', 'silinecek'],
  );
  fs.rmSync(root, { recursive: true, force: true });
});
