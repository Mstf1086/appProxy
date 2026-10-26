/**
 * OpenAI-compatible ingress (Chat Completions + Models).
 *
 * Cline CLI's "openai-compatible" provider speaks this protocol. The proxy
 * forwards the request to the provider's own OpenAI-compatible endpoint:
 *  - kind: openai      -> {baseUrl}/chat/completions
 *  - kind: anthropic   -> {baseUrl}/v1/chat/completions (OpenRouter, NIM)
 *  - kind: gemini      -> {baseUrl}/{apiVersion}/openai/chat/completions
 *
 * Sources:
 *  - docs/gemini/openai-compatibility.md
 *  - docs/openrouter/api-reference-overview.md
 *  - docs/nvidia/nim-api-reference.md
 */
import { UpstreamError, rateLimitHeadersFrom, retryHeadersFrom } from './errors.mjs';
import { readBodyText, readSseEvents, upstreamFetch } from './http.mjs';
import { resolveModel } from './translate/anthropic-in.mjs';
import { SSE_HEADERS } from './sse.mjs';
import { discoverModels, openAiAuthHeaders, openAiChatUrl } from './models.mjs';
import { toCohereFromOpenAi } from './translate/cohere-out.mjs';
import { cohereEventToOpenAiChunks, cohereToOpenAiResponse } from './translate/cohere-in.mjs';
import {
  applyGeminiSignatures,
  captureGeminiSignatures,
  StreamSignatureCapture,
} from './gemini-signature.mjs';

const OPENAI_ERROR_TYPES = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  408: 'timeout_error',
  409: 'conflict_error',
  413: 'invalid_request_error',
  422: 'invalid_request_error',
  429: 'rate_limit_error',
  500: 'api_error',
  502: 'api_error',
  503: 'api_error',
  504: 'api_error',
};

export function openAiErrorType(status) {
  return OPENAI_ERROR_TYPES[status] ?? (status >= 500 ? 'api_error' : 'invalid_request_error');
}

export function openAiErrorBody(message, type = 'api_error', code = null) {
  return { error: { message, type, param: null, code } };
}

export function sendOpenAiError(res, status, message, { type, code, headers } = {}) {
  const payload = JSON.stringify(openAiErrorBody(message, type ?? openAiErrorType(status), code ?? null));
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...(headers ?? {}),
  });
  res.end(payload);
}

/** Validate an inbound OpenAI Chat Completions body and map its model id. */
export function prepareOpenAiRequest(body, { providerName, providerCfg, modelRules }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new UpstreamError('invalid JSON body: expected an object', { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new UpstreamError('messages must be a non-empty array', { status: 400 });
  }

  const requestedModel = body.model || providerCfg.defaultModel;
  const { model, matched } = resolveModel(requestedModel, modelRules, providerCfg.defaultModel);
  const meta = {
    provider: providerName,
    requestedModel: requestedModel ?? null,
    model,
    modelMatchedBy: matched,
    stream: Boolean(body.stream),
  };
  return { request: { ...body, model }, meta };
}

function upstreamErrorMessage(text, status) {
  if (!text) return `upstream ${status}`;
  try {
    const json = JSON.parse(text);
    return json?.error?.message ?? json?.message ?? json?.detail ?? text.slice(0, 500);
  } catch {
    return text.slice(0, 500);
  }
}

export async function handleOpenAiCompatible(ctx) {
  const { providerCfg, request, meta, apiKey, log, signal, streamRaw, sendJsonResponse } = ctx;
  const wantsStream = Boolean(request.stream);
  const isGemini = providerCfg.kind === 'gemini';
  if (isGemini) {
    const patched = applyGeminiSignatures(request);
    if (patched) log.info('gemini.signature.injected', { provider: providerCfg.name, count: patched });
  }
  const url = openAiChatUrl(providerCfg);
  const headers = {
    ...openAiAuthHeaders(providerCfg, apiKey),
    accept: wantsStream ? 'text/event-stream' : 'application/json',
    'user-agent': 'appProxy/0.1',
  };

  const response = await upstreamFetch(url, {
    headers,
    body: JSON.stringify(request),
    timeoutMs: providerCfg.upstreamTimeoutMs ?? ctx.server.upstreamTimeoutMs,
    signal,
  });

  const retryHeaders = { ...retryHeadersFrom(response.headers), ...rateLimitHeadersFrom(response.headers) };

  if (!response.ok) {
    const text = await readBodyText(response);
    // NVIDIA returns 410 Gone for end-of-life models; clients expect 404.
    const status = response.status === 410 ? 404 : response.status;
    throw new UpstreamError(upstreamErrorMessage(text, response.status), {
      status,
      body: text,
      headers: retryHeaders,
    });
  }

  const passthrough = { ...retryHeaders };
  for (const name of ['content-type', 'request-id', 'x-request-id']) {
    const value = response.headers.get(name);
    if (value) passthrough[name] = value;
  }

  if (wantsStream) {
    log.info('upstream.stream.open', { provider: providerCfg.name, url, model: request.model, protocol: 'openai' });
    let capture = null;
    let onText = null;
    if (isGemini) {
      capture = new StreamSignatureCapture();
      onText = (text) => capture.feed(text);
    }
    await streamRaw(response, passthrough, onText);
    if (capture) capture.finish();
    return;
  }

  const text = await readBodyText(response);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new UpstreamError('upstream returned invalid JSON', { status: 502 });
  }
  if (isGemini) captureGeminiSignatures(json);
  meta.usage = json?.usage;
  sendJsonResponse(200, json, passthrough);
}

/**
 * Cohere v2 upstream (kind: cohere) — OpenAI Chat Completions ingress icin.
 * Istek zaten OpenAI bicimindedir; yalnizca Cohere'nin alan adlarindaki
 * farklar yamalanir, yanit/SSE OpenAI bicimine cevrilir (translate/cohere-in.mjs).
 */
export async function handleCohereCompatible(ctx) {
  const { providerCfg, request, meta, apiKey, log, signal, res, sendJsonResponse } = ctx;
  const wantsStream = Boolean(request.stream);
  const body = toCohereFromOpenAi(request, { providerCfg, stream: wantsStream });

  const url = openAiChatUrl(providerCfg);
  const headers = {
    ...openAiAuthHeaders(providerCfg, apiKey),
    accept: wantsStream ? 'text/event-stream' : 'application/json',
    'user-agent': 'appProxy/0.1',
  };

  const response = await upstreamFetch(url, {
    headers,
    body: JSON.stringify(body),
    timeoutMs: providerCfg.upstreamTimeoutMs ?? ctx.server.upstreamTimeoutMs,
    signal,
  });

  if (!response.ok) {
    const text = await readBodyText(response);
    throw new UpstreamError(upstreamErrorMessage(text, response.status), {
      status: response.status,
      body: text,
      headers: { ...retryHeadersFrom(response.headers), ...rateLimitHeadersFrom(response.headers) },
    });
  }

  const passthrough = { ...retryHeadersFrom(response.headers), ...rateLimitHeadersFrom(response.headers) };

  if (!wantsStream) {
    const text = await readBodyText(response);
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new UpstreamError('upstream returned invalid JSON', { status: 502 });
    }
    const converted = cohereToOpenAiResponse(json, { model: request.model });
    meta.usage = converted.usage;
    sendJsonResponse(200, converted, passthrough);
    return;
  }

  res.writeHead(200, { ...SSE_HEADERS, ...passthrough });
  log.info('upstream.stream.open', { provider: providerCfg.name, url, model: request.model, protocol: 'openai' });

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
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
  } catch (error) {
    log.warn('upstream.stream.error', { provider: providerCfg.name, message: error.message });
    // Istemciye gecerli bir son chunk yazmayi dene, sonra baglantiyi kapat.
    try {
      res.write(`data: ${JSON.stringify({ error: { message: error.message, type: 'api_error' } })}\n\n`);
      res.write('data: [DONE]\n\n');
    } catch {
      // istemci kopmussa yapilacak bir sey yok
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
}

export async function handleOpenAiModels(ctx) {
  const { cfg, providerName, providerCfg, log, sendJsonResponse } = ctx;
  const { ids, source, error } = await discoverModels(cfg, providerName);
  if (error) log.warn('models.discovery.failed', { provider: providerName, message: error });
  log.info('models.list', { provider: providerName, count: ids.length, source });
  sendJsonResponse(200, {
    object: 'list',
    data: ids.map((id) => ({
      id,
      object: 'model',
      created: 0,
      owned_by: providerCfg?.name ?? providerName,
    })),
  });
}
