import test from 'node:test';
import assert from 'node:assert/strict';
import { contextWindowFor, DEFAULT_CONTEXT_TOKENS } from '../src/context-window.mjs';

test('default is 200000', () => {
  assert.equal(contextWindowFor({ model: 'x' }), DEFAULT_CONTEXT_TOKENS);
});
test('preset contextWindow beats provider, env beats both', () => {
  const args = { providerCfg: { contextWindow: 100000 }, presets: [{ id: 'm', contextWindow: 256000 }], model: 'm' };
  assert.equal(contextWindowFor(args), 256000);
  assert.equal(contextWindowFor({ ...args, model: 'other' }), 100000);
  assert.equal(contextWindowFor({ ...args, env: { APPPROXY_CONTEXT_TOKENS: '1000000' } }), 1000000);
});
test('invalid values fall back', () => {
  assert.equal(contextWindowFor({ model: 'm', presets: [{ id: 'm', contextWindow: 'abc' }], env: { APPPROXY_CONTEXT_TOKENS: '-5' } }), DEFAULT_CONTEXT_TOKENS);
});
