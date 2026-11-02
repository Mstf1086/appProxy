/**
 * OpenAI Chat Completions upstream (NVIDIA hosted NIM, Gemini OpenAI-compat, any
 * OpenAI-compatible gateway).
 *
 * docs/nvidia/nim-api-reference.md → "POST /v1/chat/completions ... Supports
 * streaming and tool calling". These upstreams serve no Anthropic-format route,
 * so the proxy translates both directions.
 *
 * `runOpenAiChat` holds the whole request/response pipeline so every
 * OpenAI-shaped upstream (openai.mjs, gemini.mjs) shares one code path instead of
 * forking the SSE translation.
 */
import { UpstreamError, rateLimitHeadersFrom, retryHeadersFrom } from '../errors.mjs';
import { anthropicAuthHeaders, readJsonLoose, readSseEvents, upstreamFetch } from '../http.mjs';
import { AnthropicStream, buildMessage } from '../sse.mjs';
import { OpenAiStreamAdapter, fromOpenAiResponse } from '../translate/openai-in.mjs';
import { toOpenAiRequest } from '../translate/openai-out.mjs';
import { applyGeminiSignatures, captureGeminiSignatures, StreamSignatureCapture } from '../gemini-signature.mjs';

/**
 * Send one converted request to an OpenAI-compatible endpoint and translate the
 * answer back into Anthropic Messages (JSON or SSE).
 *
 * @param {object} ctx provider handler context
 * @param {{url: string, headers: object, captureSignatures?: boolean}} target
 */
export async function runOpenAiChat(ctx, { url, headers, captureSignatures = false }) {
  const { providerCfg, request, meta, res, log, signal, sendJsonResponse } = ctx;
  const wantsStream = Boolean(request.stream);

  const { body, droppedBlocks } = toOpenAiRequest(request, {
    systemText: meta.systemText,
    providerCfg,
    stream: wantsStream,
  });
  if (droppedBlocks.length) meta.dropped = [...(meta.dropped ?? []), ...droppedBlocks];

  // Gemini 3+ requires the thought_signature of every earlier tool call to be
  // echoed back; clients (and our own Anthropic translation) drop it, so it is
  // re-attached here by tool-call id.
  if (captureSignatures) {
    const patched = applyGeminiSignatures(body);
    if (patched) log.info('gemini.signature.injected', { provider: providerCfg.name, count: patched });
  }

  log.info('upstream.request', { provider: providerCfg.name, url, model: request.model, stream: wantsStream });
  const response = await upstreamFetch(url, {
    headers,
    body: JSON.stringify(body),
    timeoutMs: providerCfg.upstreamTimeoutMs ?? ctx.server.upstreamTimeoutMs,
    signal,
  });

  log.info('upstream.response', { provider: providerCfg.name, status: response.status, model: request.model });
  if (!response.ok) {
    const json = await readJsonLoose(response);
    const message =
      json?.error?.message ??
      json?.detail ??
      json?.message ??
      JSON.stringify(json ?? {}).slice(0, 400);
    // NVIDIA returns 410 Gone for end-of-life models; Claude Code users expect a
    // "model does not exist" style 404 (docs/nvidia/use-claude-code-with-nim.md).
    const status = response.status === 410 ? 404 : response.status;
    throw new UpstreamError(`upstream ${response.status}: ${message}`, {
      status,
      body: JSON.stringify(json ?? {}),
      headers: { ...retryHeadersFrom(response.headers), ...rateLimitHeadersFrom(response.headers) },
    });
  }

  const passthrough = { ...retryHeadersFrom(response.headers), ...rateLimitHeadersFrom(response.headers) };

  if (!wantsStream) {
    const json = await readJsonLoose(response);
    if (captureSignatures) captureGeminiSignatures(json);
    const converted = fromOpenAiResponse(json, { requestedModel: meta.requestedModel ?? request.model });
    meta.usage = converted.usage;
    sendJsonResponse(
      200,
      buildMessage({
        model: meta.requestedModel ?? request.model,
        content: converted.content,
        stopReason: converted.stopReason,
        usage: converted.usage,
      }),
      passthrough,
    );
    return;
  }

  const stream = new AnthropicStream(res, { headers: passthrough });
  const adapter = new OpenAiStreamAdapter(stream, {
    requestedModel: meta.requestedModel ?? request.model,
    upstreamModel: request.model,
    mapReasoning: providerCfg.mapReasoningToThinking !== false,
  });
  const capture = captureSignatures ? new StreamSignatureCapture() : null;
  stream.writeHead();
  log.info('upstream.stream.open', { provider: providerCfg.name, url, model: request.model });

  try {
    for await (const event of readSseEvents(response)) {
      if (event.data === '[DONE]') break;
      let chunk;
      try {
        chunk = JSON.parse(event.data);
      } catch {
        continue;
      }
      if (chunk?.error) throw new UpstreamError(chunk.error.message ?? 'upstream error', { status: 502 });
      capture?.handleChunk(chunk);
      adapter.feed(chunk);
    }
    capture?.finish();
    adapter.done();
    meta.usage = adapter.usage;
  } catch (error) {
    if (stream.state === 'streaming') {
      log.warn('upstream.stream.error', { provider: providerCfg.name, message: error.message });
      stream.errorEvent('api_error', error.message);
    } else {
      throw error;
    }
  } finally {
    stream.end();
  }
}

/** OpenAI-compatible upstream: {baseUrl}/chat/completions with bearer + x-api-key. */
export async function handleOpenAiProvider(ctx) {
  const { providerCfg, request } = ctx;
  const url = `${providerCfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers = {
    'content-type': 'application/json',
    accept: request.stream ? 'text/event-stream' : 'application/json',
    'user-agent': 'appProxy/0.1',
    ...anthropicAuthHeaders(ctx.apiKey, { providerCfg }),
  };
  return runOpenAiChat(ctx, { url, headers });
}
