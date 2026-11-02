/**
 * Gemini provider (Anthropic Messages ingress → Gemini).
 *
 * Uses Gemini's **OpenAI-compatible** endpoint
 * `{baseUrl}/{apiVersion}/openai/chat/completions`
 * (docs/gemini/openai-compatibility.md) instead of hand-translating to the native
 * `:generateContent` API.
 *
 * The previous native path could only carry plain text: tool definitions,
 * `tool_result`, images, usage and `finishReason` were all dropped, so Claude
 * Code lost every tool (Read/Edit/Bash) and could not work. The OpenAI-compatible
 * endpoint supports tool calling, vision, streaming and usage, so the shared
 * OpenAI pipeline in `providers/openai.mjs` is reused here — one translation
 * path, less to maintain.
 */
import { runOpenAiChat } from './openai.mjs';

/** Gemini OpenAI-compatible chat URL. */
export function geminiChatUrl(providerCfg) {
  const base = String(providerCfg.baseUrl ?? '').replace(/\/$/, '');
  return `${base}/${providerCfg.apiVersion ?? 'v1beta'}/openai/chat/completions`;
}

/** Gemini accepts the OpenAI-style bearer token; x-goog-api-key keeps parity with native routes. */
export function geminiChatHeaders(apiKey, providerCfg = {}) {
  const headers = { 'content-type': 'application/json' };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
    headers['x-goog-api-key'] = apiKey;
  }
  Object.assign(headers, providerCfg.extraHeaders ?? {});
  return headers;
}

export async function handleGeminiProvider(ctx) {
  const { providerCfg, request } = ctx;
  const headers = {
    ...geminiChatHeaders(ctx.apiKey, providerCfg),
    accept: request.stream ? 'text/event-stream' : 'application/json',
    'user-agent': 'appProxy/0.1',
  };
  // captureSignatures: Gemini 3+ rejects the next request when a tool call's
  // thought_signature is missing (docs/gemini/openai-compatibility.md).
  return runOpenAiChat(ctx, { url: geminiChatUrl(providerCfg), headers, captureSignatures: true });
}
