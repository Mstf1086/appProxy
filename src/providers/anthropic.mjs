/**
 * Anthropic-format passthrough.
 *
 * Used for OpenRouter (docs/openrouter/claude-code-integration.md: Claude Code talks
 * to https://openrouter.ai/api with the Anthropic Messages API) and for a
 * self-hosted NVIDIA NIM container (docs/nvidia/nim-api-reference.md: NIM exposes an
 * "Anthropic-compatible messages endpoint" at /v1/messages).
 *
 * The gateway compatibility guide requires `anthropic-version` and `anthropic-beta`
 * to be forwarded unchanged, error bodies to reach the client unmodified, and
 * `retry-after` / `x-should-retry` / `anthropic-ratelimit-*` to be passed through.
 */
import { ANTHROPIC_VERSION, UpstreamError, rateLimitHeadersFrom, retryHeadersFrom } from '../errors.mjs';
import { anthropicAuthHeaders, readBodyText, upstreamFetch } from '../http.mjs';

const FORWARDED_RESPONSE_HEADERS = ['content-type', 'request-id', 'x-request-id'];

/** Claude Code sends adaptive reasoning for model IDs it does not recognise. */
export function normalizeThinking(request, providerCfg = {}) {
  const thinking = request.thinking;
  const notes = [];
  if (thinking?.type === 'adaptive' && providerCfg.normalizeAdaptiveThinking) {
    notes.push('thinking:adaptive->enabled');
    request.thinking = { type: 'enabled', budget_tokens: providerCfg.thinkingBudgetTokens ?? 8192 };
  } else if (thinking && !['enabled', 'disabled', 'adaptive'].includes(thinking.type)) {
    notes.push('thinking:dropped');
    delete request.thinking;
  }
  return notes;
}

export async function handleAnthropicProvider(ctx) {
  const { providerCfg, request, meta, sendJsonResponse, streamRaw, log, signal } = ctx;
  const apiKey = ctx.apiKey;

  const notes = normalizeThinking(request, providerCfg);
  if (notes.length) meta.notes = [...(meta.notes ?? []), ...notes];

  const wantsStream = Boolean(request.stream);
  const url = `${providerCfg.baseUrl.replace(/\/$/, '')}/v1/messages`;

  const headers = {
    'content-type': 'application/json',
    accept: wantsStream ? 'text/event-stream' : 'application/json',
    'anthropic-version': ctx.beta?.version ?? ANTHROPIC_VERSION,
    'user-agent': 'appProxy/0.1',
    ...anthropicAuthHeaders(apiKey, { providerCfg }),
  };
  if (ctx.beta?.header) headers['anthropic-beta'] = ctx.beta.header;

  const response = await upstreamFetch(url, {
    headers,
    body: JSON.stringify(request),
    timeoutMs: providerCfg.upstreamTimeoutMs ?? ctx.server.upstreamTimeoutMs,
    signal,
  });

  if (!response.ok) {
    const text = await readBodyText(response);
    throw new UpstreamError(`upstream ${response.status}: ${text.slice(0, 500)}`, {
      status: response.status === 410 ? 404 : response.status,
      body: text,
      headers: { ...retryHeadersFrom(response.headers), ...rateLimitHeadersFrom(response.headers) },
    });
  }

  const passthrough = { ...retryHeadersFrom(response.headers), ...rateLimitHeadersFrom(response.headers) };
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) passthrough[name] = value;
  }

  if (wantsStream) {
    log.info('upstream.stream.open', { provider: providerCfg.name, url, model: request.model });
    await streamRaw(response, passthrough);
    return;
  }

  const text = await readBodyText(response);
  sendJsonResponse(200, JSON.parse(text), passthrough);
}
