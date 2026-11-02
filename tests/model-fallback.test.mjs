import test from 'node:test';
import assert from 'node:assert/strict';
import { isModelNotFound, fallbackModelFor, fallbackCandidates, withModelFallback } from '../src/model-fallback.mjs';

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

test('fallbackCandidates: default, fast, then presets, de-duplicated', () => {
  const cfg = { defaultModel: 'd', fastModel: 'f' };
  assert.deepEqual(fallbackCandidates('x', cfg, [{ id: 'p1' }, { id: 'd' }]), ['d', 'f', 'p1']);
  assert.deepEqual(fallbackCandidates('d', cfg, []), ['f']);
});

test('withModelFallback tries the next candidate when the first fallback also 404s', async () => {
  const seen = [];
  const ctx = {
    res: { headersSent: false },
    request: { model: 'a' },
    meta: { model: 'a' },
    providerCfg: { name: 'nvidia', defaultModel: 'd', fastModel: 'f' },
    log: { warn() {}, error() {} },
  };
  await withModelFallback(ctx, async () => {
    seen.push(ctx.request.model);
    if (ctx.request.model !== 'f') throw Object.assign(new Error('nf'), { status: 404 });
  });
  assert.deepEqual(seen, ['a', 'd', 'f']);
});

test('withModelFallback rethrows the ORIGINAL error when all candidates fail', async () => {
  const ctx = {
    res: { headersSent: false },
    request: { model: 'a' },
    meta: { model: 'a' },
    providerCfg: { name: 'nvidia', defaultModel: 'd' },
    log: { warn() {}, error() {} },
  };
  await assert.rejects(
    withModelFallback(ctx, async () => {
      throw Object.assign(new Error(`nf ${ctx.request.model}`), { status: 404 });
    }),
    (e) => e.message === 'nf a',
  );
});

test('withModelFallback does not mask non-model errors (e.g. 401)', async () => {
  const ctx = { res: { headersSent: false }, request: { model: 'a' }, meta: {}, providerCfg: { defaultModel: 'd' }, log: {} };
  await assert.rejects(
    withModelFallback(ctx, async () => {
      throw Object.assign(new Error('bad key'), { status: 401 });
    }),
    /bad key/,
  );
});
