#!/usr/bin/env node
/**
 * Cohere v2 Chat provider (Anthropic Messages ingress icin).
 *
 * docs.cohere.com/reference/chat -> POST {baseUrl}/v2/chat, bearer auth.
 * Cohere v2 mesaj/araç semasi OpenAI'ye yakindir; ceviriler iki adimli:
 *   istek:  Anthropic -> OpenAI (toOpenAiRequest) -> Cohere (toCohereFromOpenAi)
 *   yanit:  Cohere -> OpenAI (cohereToOpenAiResponse) -> Anthropic (fromOpenAiResponse)
 *   SSE:    Cohere olaylari -> OpenAI chunk'lari -> OpenAiStreamAdapter
 * Boylece hem streaming, hem tool calling ve thinking (tool_plan -> reasoning)
 * mevcut, sinanmis kod yollarindan gecer.
 */
import { UpstreamError, rateLimitHeadersFrom, retryHeadersFrom } from '../errors.mjs';
import { anthropicAuthHeaders, readJsonLoose, readSseEvents, upstreamFetch } from '../http.mjs';
import { AnthropicStream, buildMessage } from '../sse.mjs';
import { OpenAiStreamAdapter, fromOpenAiResponse } from '../translate/openai-in.mjs';
import { cohereChatUrl, toCohereRequest } from '../translate/cohere-out.mjs';
import { cohereEventToOpenAiChunks, cohereToOpenAiResponse } from '../translate/cohere-in.mjs';

export async function handleCohereProvider(ctx) {
  const { providerCfg, request, meta, res, log, signal, sendJsonResponse } = ctx;
  const wantsStream = Boolean(request.stream);

  const { body, droppedBlocks } = toCohereRequest(request, {
    systemText: meta.systemText,
    providerCfg,
    stream: wantsStream,
  });
  if (droppedBlocks.length) meta.dropped = [...(meta.dropped ?? []), ...droppedBlocks];

  const url = cohereChatUrl(providerCfg);
  const headers = {
    'content-type': 'application/json',
    accept: wantsStream ? 'text/event-stream' : 'application/json',
    'user-agent': 'appProxy/0.1',
    ...anthropicAuthHeaders(ctx.apiKey, { providerCfg }),
  };

  const response = await upstreamFetch(url, {
    headers,
    body: JSON.stringify(body),
    timeoutMs: providerCfg.upstreamTimeoutMs ?? ctx.server.upstreamTimeoutMs,
    signal,
  });

  if (!response.ok) {
    const json = await readJsonLoose(response);
    const message =
      json?.message ??
      json?.error?.message ??
      json?.detail ??
      JSON.stringify(json ?? {}).slice(0, 400);
    throw new UpstreamError(`upstream ${response.status}: ${message}`, {
      status: response.status,
      body: JSON.stringify(json ?? {}),
      headers: { ...retryHeadersFrom(response.headers), ...rateLimitHeadersFrom(response.headers) },
    });
  }

  const passthrough = { ...retryHeadersFrom(response.headers), ...rateLimitHeadersFrom(response.headers) };

  if (!wantsStream) {
    const json = await readJsonLoose(response);
    const converted = fromOpenAiResponse(cohereToOpenAiResponse(json, { model: request.model }), {
      requestedModel: meta.requestedModel ?? request.model,
    });
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
  stream.writeHead();
  log.info('upstream.stream.open', { provider: providerCfg.name, url, model: request.model });

  try {
    for await (const event of readSseEvents(response)) {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        continue;
      }
      if (payload?.type === 'error' || payload?.error) {
        throw new UpstreamError(payload?.error?.message ?? 'upstream error', { status: 502 });
      }
      for (const chunk of cohereEventToOpenAiChunks(payload, { model: request.model })) {
        adapter.feed(chunk);
      }
    }
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
