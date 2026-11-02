import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPiModelDefinition } from '../src/providers/pi.mjs';
import { loadConfig } from '../src/config.mjs';

test('Pi model definition uses hosted-provider defaults when no local limits are configured', () => {
  const model = buildPiModelDefinition('model-a', undefined, {});
  assert.equal(model.contextWindow, 128000);
  assert.equal(model.maxTokens, 8192);
});

test('Pi model definition honors local provider context, output, and sampling limits', () => {
  const model = buildPiModelDefinition(
    'LFM3-1.7B-Q8_0',
    { label: 'LFM3 1.7B Q8_0' },
    {
      contextWindow: 8192,
      maxTokens: 2048,
      samplingParams: { temperature: 0.1, top_p: 0.95, top_k: 50 },
    },
  );
  assert.equal(model.name, 'LFM3 1.7B Q8_0');
  assert.equal(model.contextWindow, 8192);
  assert.equal(model.maxTokens, 2048);
  assert.deepEqual(model.samplingParams, { temperature: 0.1, top_p: 0.95, top_k: 50 });
});

test('Pi model definition prefers discovered context length and clamps output tokens', () => {
  const model = buildPiModelDefinition(
    'model-a',
    undefined,
    { contextWindow: 4096, maxTokens: 8192 },
    { 'model-a': 2048 },
  );
  assert.equal(model.contextWindow, 2048);
  assert.equal(model.maxTokens, 2048);
});

test('lfm3 keeps enough context for Pi safety and compaction reserves', () => {
  const provider = loadConfig().providers.lfm3;
  // Pi reserves 4096 tokens on every request and compacts at
  // contextWindow - 16384. A 32K window prevents max_tokens collapsing to 1
  // during normal coding/tool conversations.
  assert.ok(provider.contextWindow >= 32768);
  assert.ok(provider.maxTokens >= 2048);
  assert.equal(provider.baseUrl, 'http://127.0.0.1:8080/v1');
  assert.equal(provider.defaultModel, 'LFM3-1.7B-Q8_0');
});
