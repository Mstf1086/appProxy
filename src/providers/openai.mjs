/**
 * OpenAI Chat Completions provider (used for NVIDIA hosted NIM).
 *
 * docs/nvidia/nim-api-reference.md → "POST /v1/chat/completions ... Supports
 * streaming and tool calling". The hosted endpoint serves no Anthropic-format
 * route, so the proxy translates both directions.
 */
import { UpstreamError, rateLimitHeadersFrom, retryHeadersFrom } from '../errors.mjs';
import { anthropicAuthHeaders, readJsonLoose, readSseEvents, upstreamFetch } from '../http.mjs';
import { AnthropicStream, buildMessage } from '../sse.mjs';
import { OpenAiStreamAdapter, fromOpenAiResponse } from '../translate/openai-in.mjs';
import { toOpenAiRequest } from '../translate/openai-out.mjs';

export async function handleOpenAiProvider(ctx) {
  const { providerCfg, request, meta, res, log, signal, sendJsonResponse } = ctx;
  const wantsStream = Boolean(request.stream);

  const { body, droppedBlocks } = toOpenAiRequest(request, {
    systemText: meta.systemText,
    providerCfg,
    stream: wantsStream,
  });
  if (droppedBlocks.length) meta.dropped = [...(meta.dropped ?? []), ...droppedBlocks];

  const url = `${providerCfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
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
      adapter.feed(chunk);
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
