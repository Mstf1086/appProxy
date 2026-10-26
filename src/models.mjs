/**
 * Provider model discovery + OpenAI-compatible endpoint helpers.
 *
 * Official sources (docs/ mirrors):
 *  - OpenAI-compatible upstreams: GET {baseUrl}/models
 *    (docs/nvidia/nim-api-reference.md, docs/openrouter/api-reference-overview.md)
 *  - Anthropic-compatible upstreams: GET {baseUrl}/v1/models
 *    (OpenRouter, self-hosted NVIDIA NIM)
 *  - Gemini native: GET {baseUrl}/{apiVersion}/models
 *    (docs/gemini/models.md)
 *  - Gemini OpenAI compatibility: {baseUrl}/{apiVersion}/openai/chat/completions
 *    (docs/gemini/openai-compatibility.md)
 */
import { readBodyText, upstreamFetch } from './http.mjs';

export const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const modelCache = new Map();

/** OpenAI Chat Completions URL for one provider. */
export function openAiChatUrl(providerCfg) {
  const base = String(providerCfg.baseUrl ?? '').replace(/\/$/, '');
  if (providerCfg.kind === 'gemini') {
    return `${base}/${providerCfg.apiVersion ?? 'v1beta'}/openai/chat/completions`;
  }
  if (providerCfg.kind === 'anthropic') {
    return `${base}/v1/chat/completions`;
  }
  if (providerCfg.kind === 'cohere') {
    return `${base}/v2/chat`;
  }
  return `${base}/chat/completions`;
}

/** Model list URL for one provider. */
export function openAiModelsUrl(providerCfg) {
  const base = String(providerCfg.baseUrl ?? '').replace(/\/$/, '');
  if (providerCfg.kind === 'gemini') {
    return `${base}/${providerCfg.apiVersion ?? 'v1beta'}/models`;
  }
  if (providerCfg.kind === 'anthropic') {
    return `${base}/v1/models`;
  }
  if (providerCfg.kind === 'cohere') {
    // Cohere /v1/models sayfalar (default 20); tum listeyi tek istekte cek.
    return `${base}/v1/models?page_size=1000`;
  }
  return `${base}/models`;
}

/** Headers for OpenAI-compatible upstream calls (chat + model list). */
export function openAiAuthHeaders(providerCfg, apiKey) {
  const headers = { 'content-type': 'application/json' };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
    // OpenRouter/NIM accept bearer; x-api-key keeps Anthropic-compatible
    // gateways working without changing the request shape.
    if (providerCfg.kind !== 'gemini') headers['x-api-key'] = apiKey;
  }
  Object.assign(headers, providerCfg.extraHeaders ?? {});
  return headers;
}

/** Gemini's native model list uses x-goog-api-key, not Authorization. */
export function geminiNativeHeaders(apiKey) {
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers['x-goog-api-key'] = apiKey;
  return headers;
}

/** Normalize the three official model-list shapes to a flat id array. */
function stripModelPrefix(id) {
  // Gemini's OpenAI-compatible /models lists ids as "models/gemini-..." while
  // chat/completions expects them without the prefix (docs/gemini/openai-compatibility.md).
  return String(id).replace(/^models\//, '');
}

export function normalizeModelIds(json) {
  if (!json) return [];
  if (Array.isArray(json.data)) {
    return json.data.map((m) => m?.id ?? m?.name).filter(Boolean).map(stripModelPrefix);
  }
  if (Array.isArray(json.models)) {
    return json.models
      .filter((m) => {
        const methods = m?.supportedGenerationMethods;
        if (Array.isArray(methods)) return methods.includes('generateContent');
        // Cohere /v1/models: yalnizca chat destekleyen modeller (docs/cohere/api-notes.md)
        const endpoints = m?.endpoints;
        if (Array.isArray(endpoints)) return endpoints.includes('chat');
        return true;
      })
      .map((m) => stripModelPrefix(m?.name ?? ''))
      .filter(Boolean);
  }
  if (Array.isArray(json)) {
    return json.map((m) => m?.id ?? m?.name).filter(Boolean).map(stripModelPrefix);
  }
  return [];
}

/** Presets + defaults from config/models.json and config/providers.json. */
export function fallbackModelIds(cfg, providerName) {
  const providerCfg = cfg.active(providerName);
  const presets = cfg.models[providerName]?.presets ?? [];
  const ids = [
    ...presets.map((preset) => preset.id),
    providerCfg?.defaultModel,
    providerCfg?.fastModel,
  ].filter(Boolean);
  return [...new Set(ids)];
}

export function clearModelCache() {
  modelCache.clear();
}

/**
 * List every model the provider exposes. Falls back to config presets when the
 * upstream model endpoint is unavailable (offline, missing key, ...).
 *
 * @returns {Promise<{ids: string[], source: 'upstream'|'fallback', error: string|null, url: string}>}
 */
export async function discoverModels(cfg, providerName, { timeoutMs = 5000, useCache = true } = {}) {
  const providerCfg = cfg.active(providerName);
  if (!providerCfg) {
    return { ids: [], source: 'fallback', error: `unknown provider: ${providerName}`, url: '' };
  }

  const cacheKey = [providerName, providerCfg.kind, providerCfg.baseUrl, providerCfg.apiVersion ?? ''].join('|');
  if (useCache) {
    const hit = modelCache.get(cacheKey);
    if (hit && Date.now() - hit.at < MODEL_CACHE_TTL_MS) {
      return { ...hit.value, cached: true };
    }
  }

  const apiKey = cfg.apiKeyOf(providerCfg);
  const url = openAiModelsUrl(providerCfg);
  const headers = providerCfg.kind === 'gemini'
    ? geminiNativeHeaders(apiKey)
    : openAiAuthHeaders(providerCfg, apiKey);

  let ids = [];
  let error = null;
  try {
    const response = await upstreamFetch(url, { method: 'GET', headers, timeoutMs });
    const text = await readBodyText(response);
    if (!response.ok) {
      error = `upstream ${response.status}: ${text.slice(0, 200)}`;
    } else {
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        error = 'invalid JSON from model endpoint';
      }
      if (json) ids = normalizeModelIds(json);
    }
  } catch (e) {
    error = e.message;
  }

  ids = [...new Set(ids)].sort((a, b) => a.localeCompare(b));
  let source = ids.length ? 'upstream' : 'fallback';
  if (!ids.length) ids = fallbackModelIds(cfg, providerName);

  const value = { ids, source, error, url };
  if (useCache && ids.length) modelCache.set(cacheKey, { at: Date.now(), value });
  return value;
}
