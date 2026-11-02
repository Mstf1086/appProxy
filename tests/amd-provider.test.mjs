/**
 * AMD Radeon Cloud / Token Factory sağlayıcısı: OpenAI uyumlu uç, Bearer API
 * anahtarı. Claude Code Anthropic konuşur; proxy isteği OpenAI'ye çevirir.
 * Bu test, config'in (uç, anahtar adı, model eşlemesi) bozulmadığını doğrular.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.mjs';
import { resolveModel } from '../src/translate/anthropic-in.mjs';

test('amd: OpenAI uyumlu uç ve Bearer anahtar tanımlı', () => {
  const cfg = loadConfig();
  const p = cfg.active('amd');
  assert.ok(p, 'amd sağlayıcısı yok');
  assert.equal(p.kind, 'openai');
  assert.equal(p.baseUrl, 'https://developer.amd.com.cn/radeon/api/v1');
  assert.equal(p.apiKeyEnv, 'AMD_API_KEY');
  // Base URL zaten /v1 ile bitiyor: proxy yol eklerken çift /v1 üretmemeli.
  assert.equal(p.baseUrl.endsWith('/v1'), true);
});

test('amd: claude takma adları DeepSeek modeline eşlenir', () => {
  const cfg = loadConfig();
  const rules = cfg.modelRules('amd');
  assert.equal(resolveModel('claude-sonnet-4-5-20250929', rules).model, 'DeepSeek-V4-Flash-0731');
  assert.equal(resolveModel('claude-3-5-haiku-20241022', rules).model, 'DeepSeek-V4-Flash-0731');
  assert.equal(resolveModel('claude-opus-4-1', rules).model, 'DeepSeek-V4-Flash-0731');
});

test('amd: sağlayıcının kendi model kimlikleri olduğu gibi geçer', () => {
  const cfg = loadConfig();
  const rules = cfg.modelRules('amd');
  for (const id of ['DeepSeek-V4-Flash-0731', 'DeepSeek-V4-Flash-Vision-Exp', 'Qwen3.8-Flash-Next', 'MiniCPM5-1B']) {
    const out = resolveModel(id, rules);
    assert.equal(out.model, id, `${id} değiştirilmemeli`);
    assert.equal(out.matched, 'passthrough');
  }
});

test('amd: keşif başarısız olursa ön ayarlar listelenir', () => {
  const cfg = loadConfig();
  const presets = cfg.modelRules('amd').presets ?? [];
  assert.ok(presets.length >= 4, 'preset listesi eksik');
  assert.ok(presets.some((p) => p.id === 'DeepSeek-V4-Flash-0731'));
});
