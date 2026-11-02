import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, parseEnvFile, stripInlineComment } from '../src/config.mjs';

test('.env satır sonu yorumu değere dahil edilmez', () => {
  const env = parseEnvFile(
    ['PROXY_TOKEN=appproxy-local-dev   # yerel kimlik', 'PROXY_PORT=8790', 'PROXY_LOG_BODIES=0  # kapalı'].join('\n'),
  );
  assert.equal(env.PROXY_TOKEN, 'appproxy-local-dev');
  assert.equal(env.PROXY_PORT, '8790');
  assert.equal(env.PROXY_LOG_BODIES, '0');
});

test('tırnak içindeki # ve bitişik # korunur', () => {
  const env = parseEnvFile(['A="deger # burada"', 'B=deger#bitisik', 'C=deger # yorum'].join('\n'));
  assert.equal(env.A, 'deger # burada');
  assert.equal(env.B, 'deger#bitisik');
  assert.equal(env.C, 'deger');
});

test('stripInlineComment tek başına da doğru çalışır', () => {
  assert.equal(stripInlineComment('abc  # x'), 'abc');
  assert.equal(stripInlineComment('abc'), 'abc');
  assert.equal(stripInlineComment(''), '');
});

test('NVIDIA_MODE=nim selfHosted bloğu olmadan çökmez ve /v1 ekler', () => {
  const saved = { mode: process.env.NVIDIA_MODE, base: process.env.NIM_BASE_URL };
  process.env.NVIDIA_MODE = 'nim';
  process.env.NIM_BASE_URL = 'http://127.0.0.1:8000';
  try {
    const cfg = loadConfig();
    assert.equal(cfg.active('nvidia').baseUrl, 'http://127.0.0.1:8000/v1');
    assert.equal(cfg.apiKeyOf(cfg.active('nvidia')), 'not-used');
  } finally {
    if (saved.mode === undefined) delete process.env.NVIDIA_MODE; else process.env.NVIDIA_MODE = saved.mode;
    if (saved.base === undefined) delete process.env.NIM_BASE_URL; else process.env.NIM_BASE_URL = saved.base;
  }
});

test('NVIDIA_MODE=nim zaten /v1 ile biten URL’i iki kez eklemez', () => {
  const saved = { mode: process.env.NVIDIA_MODE, base: process.env.NIM_BASE_URL };
  process.env.NVIDIA_MODE = 'nim';
  process.env.NIM_BASE_URL = 'http://127.0.0.1:8000/v1';
  try {
    assert.equal(loadConfig().active('nvidia').baseUrl, 'http://127.0.0.1:8000/v1');
  } finally {
    if (saved.mode === undefined) delete process.env.NVIDIA_MODE; else process.env.NVIDIA_MODE = saved.mode;
    if (saved.base === undefined) delete process.env.NIM_BASE_URL; else process.env.NIM_BASE_URL = saved.base;
  }
});
