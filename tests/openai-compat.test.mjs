import test from 'node:test';
import assert from 'node:assert/strict';
import {
  openAiAuthHeaders,
  openAiChatUrl,
  openAiModelsUrl,
  normalizeModelIds,
  fallbackModelIds,
} from '../src/models.mjs';
import { prepareOpenAiRequest } from '../src/openai-compat.mjs';

test('openAiChatUrl maps provider kinds to their official endpoints', () => {
  assert.equal(
    openAiChatUrl({ kind: 'openai', baseUrl: 'https://api.example.com/v1' }),
    'https://api.example.com/v1/chat/completions',
  );
  assert.equal(
    openAiChatUrl({ kind: 'anthropic', baseUrl: 'https://openrouter.ai/api' }),
    'https://openrouter.ai/api/v1/chat/completions',
  );
  assert.equal(
    openAiChatUrl({
      kind: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiVersion: 'v1beta',
    }),
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  );
});

test('openAiModelsUrl maps provider kinds to their official endpoints', () => {
  assert.equal(
    openAiModelsUrl({ kind: 'openai', baseUrl: 'https://api.example.com/v1' }),
    'https://api.example.com/v1/models',
  );
  assert.equal(
    openAiModelsUrl({ kind: 'anthropic', baseUrl: 'https://openrouter.ai/api' }),
    'https://openrouter.ai/api/v1/models',
  );
  assert.equal(
    openAiModelsUrl({
      kind: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiVersion: 'v1beta',
    }),
    'https://generativelanguage.googleapis.com/v1beta/models',
  );
});

test('normalizeModelIds handles OpenAI and Gemini model list shapes', () => {
  assert.deepEqual(normalizeModelIds({ data: [{ id: 'a' }, { id: 'b' }] }), ['a', 'b']);
  assert.deepEqual(
    normalizeModelIds({
      models: [
        { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ],
    }),
    ['gemini-3.8-flash'],
  );
});

test('openAiAuthHeaders uses bearer for Gemini and bearer + x-api-key otherwise', () => {
  const gemini = openAiAuthHeaders({ kind: 'gemini' }, 'k');
  assert.equal(gemini.authorization, 'Bearer k');
  assert.equal(gemini['x-api-key'], undefined);

  const openai = openAiAuthHeaders({ kind: 'openai' }, 'k');
  assert.equal(openai.authorization, 'Bearer k');
  assert.equal(openai['x-api-key'], 'k');
});

test('prepareOpenAiRequest maps a Claude model id to the provider model', () => {
  const { request, meta } = prepareOpenAiRequest(
    { model: 'claude-sonnet-4-5-20250929', messages: [{ role: 'user', content: 'hi' }] },
    {
      providerName: 'refuseless',
      providerCfg: { defaultModel: 'glm-5.3-abliterated' },
      modelRules: {
        passthroughPrefixes: ['glm-5.3-'],
        rules: [{ match: '*', model: 'glm-5.3-abliterated' }],
      },
    },
  );
  assert.equal(request.model, 'glm-5.3-abliterated');
  assert.equal(meta.requestedModel, 'claude-sonnet-4-5-20250929');
  assert.equal(meta.modelMatchedBy, '*');
});

test('prepareOpenAiRequest rejects a body without messages', () => {
  assert.throws(
    () =>
      prepareOpenAiRequest(
        { model: 'x' },
        { providerName: 'refuseless', providerCfg: {}, modelRules: {} },
      ),
    /messages must be a non-empty array/,
  );
});

test('fallbackModelIds includes presets and provider defaults', () => {
  const cfg = {
    models: { demo: { presets: [{ id: 'p1' }, { id: 'p2' }] } },
    active: () => ({ defaultModel: 'd1', fastModel: 'f1' }),
  };
  assert.deepEqual(fallbackModelIds(cfg, 'demo'), ['p1', 'p2', 'd1', 'f1']);
});
