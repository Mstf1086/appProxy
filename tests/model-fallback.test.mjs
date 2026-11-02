import test from 'node:test';
import assert from 'node:assert/strict';
import { isModelNotFound, fallbackModelFor, withModelFallback } from '../src/model-fallback.mjs';

test('isModelNotFound: 404/410 and model-related 400', () => {
  assert.equal(isModelNotFound({ status: 404 }), true);
  assert.equal(isModelNotFound({ status: 410 }), true);
  assert.equal(isModelNotFound({ status: 400, message: 'model does not exist' }), true);
  assert.equal(isModelNotFound({ status: 400, message: 'bad tools schema' }), false);
  assert.equal(isModelNotFound({ status: 429 }), false);
});

test('fallbackModelFor: skips when default missing or identical', () => {
  assert.equal(fallbackModelFor('a', { defaultModel: 'b' }), 'b');
  assert.equal(fallbackModelFor('b', { defaultModel: 'b' }), null);
  assert.equal(fallbackModelFor('a', {}), null);
});

test('withModelFallback retries once with defaultModel', async () => {
  const seen = [];
  const ctx = {
    res: { headersSent: false },
    request: { model: 'z-ai/glm-5.3-flash' },
    meta: { model: 'z-ai/glm-5.3-flash' },
    providerCfg: { name: 'nvidia', defaultModel: 'nvidia/llama-3.1-nemotron-70b-instruct' },
    log: { warn() {} },
  };
  await withModelFallback(ctx, async () => {
    seen.push(ctx.request.model);
    if (seen.length === 1) throw Object.assign(new Error('nf'), { status: 404 });
  });
  assert.deepEqual(seen, ['z-ai/glm-5.3-flash', 'nvidia/llama-3.1-nemotron-70b-instruct']);
  assert.equal(ctx.meta.model, 'nvidia/llama-3.1-nemotron-70b-instruct');
});
