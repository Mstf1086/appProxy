#!/usr/bin/env node
import http from 'node:http';
import { loadConfig } from './config.mjs';
import { createLogger, upstreamBodyFields, summarizeErrorMessage } from './log.mjs';
import { UpstreamError, sendAnthropicError } from './errors.mjs';
import { normalizeRequest } from './translate/anthropic-in.mjs';
import { handleAnthropicProvider } from './providers/anthropic.mjs';
import { handleOpenAiProvider } from './providers/openai.mjs';
import { handleGeminiProvider } from './providers/gemini.mjs';
import { handleCohereProvider } from './providers/cohere.mjs';
import { runWithRateLimitRetry } from './rate-limit.mjs';
import { withModelFallback } from './model-fallback.mjs';
import { checkProxyToken, isLoopbackHost } from './auth.mjs';
import { estimateRequestTokens } from './tokens.mjs';
import {
  handleCohereCompatible,
  handleOpenAiCompatible,
  handleOpenAiModels,
  prepareOpenAiRequest,
  sendOpenAiError,
} from './openai-compat.mjs';

const cfg = loadConfig();
const log = createLogger({ dir: 'logs', root: cfg.root, bodies: cfg.server.logBodies });

// `PROVIDER` is kept for the legacy bin/claude-* wrappers; DEFAULT_PROVIDER is
// what bin/claude-proxy and bin/proxy-run export.
const defaultProvider =
  process.env.DEFAULT_PROVIDER || process.env.PROVIDER || process.argv[2] || 'openrouter';

function parseRoute(rawUrl) {
  // Tolerate a base URL that already ends in /v1 (-> /<provider>/v1/v1/messages).
  const pathname = (new URL(rawUrl, 'http://localhost').pathname.replace(/\/+$/, '') || '/').replace(/\/v1\/v1\//g, '/v1/');
  let m;
  if ((m = pathname.match(/^\/([a-z0-9_-]+)\/v1\/messages$/))) {
    return { endpoint: 'messages', provider: m[1], protocol: 'anthropic' };
  }
  if ((m = pathname.match(/^\/([a-z0-9_-]+)\/v1\/messages\/count_tokens$/))) {
    return { endpoint: 'count_tokens', provider: m[1], protocol: 'anthropic' };
  }
  if ((m = pathname.match(/^\/([a-z0-9_-]+)\/v1\/models\/.+$/))) {
    return { endpoint: 'model', provider: m[1], protocol: 'anthropic', modelId: decodeURIComponent(pathname.split('/v1/models/')[1]) };
  }
  if ((m = pathname.match(/^\/([a-z0-9_-]+)\/v1\/chat\/completions$/))) {
    return { endpoint: 'chat', provider: m[1], protocol: 'openai' };
  }
  if ((m = pathname.match(/^\/([a-z0-9_-]+)\/v1\/models$/))) {
    return { endpoint: 'models', provider: m[1], protocol: 'openai' };
  }
  if (pathname === '/v1/messages/count_tokens') return { endpoint: 'count_tokens', provider: defaultProvider, protocol: 'anthropic' };
  if (pathname.startsWith('/v1/models/')) return { endpoint: 'model', provider: defaultProvider, protocol: 'anthropic', modelId: decodeURIComponent(pathname.slice('/v1/models/'.length)) };
  if (pathname === '/v1/messages') return { endpoint: 'messages', provider: defaultProvider, protocol: 'anthropic' };
  if (pathname === '/v1/chat/completions') return { endpoint: 'chat', provider: defaultProvider, protocol: 'openai' };
  if (pathname === '/v1/models') return { endpoint: 'models', provider: defaultProvider, protocol: 'openai' };
  return null;
}

function authorized(req) {
  return checkProxyToken({
    token: cfg.proxyToken,
    headers: req.headers,
    remoteAddress: req.socket?.remoteAddress ?? '',
  });
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    // Collect raw Buffers and decode ONCE at the end. Decoding each TCP chunk on
    // its own (raw += chunk) corrupts any multi-byte character that straddles a
    // chunk boundary: both halves become U+FFFD, silently mangling prompts that
    // contain Turkish/Chinese/emoji characters.
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        fail(new UpstreamError(`request body too large (max ${maxBytes} bytes)`, { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => fail(error));
  });
}

function responseHelpers(res) {
  function sendJsonResponse(status, body, headers) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
      ...(headers ?? {}),
    });
    res.end(payload);
  }

  async function streamRaw(response, passthrough, onText = null) {
    res.writeHead(200, {
      'content-type': response.headers.get('content-type') || 'text/event-stream',
      ...(passthrough ?? {}),
    });
    if (!response.body) {
      res.end();
      return;
    }
    const reader = response.body.getReader();
    const decoder = onText ? new TextDecoder() : null;
    // SSE comment lines (": ping") are ignored by every compliant parser but keep
    // the client connection alive when the upstream stays silent for a long time
    // (reasoning models can think for tens of seconds before the first token —
    // without pings the client aborts the idle turn).
    const pingMs = Number(cfg.server.keepAlivePingMs ?? 15000) || 15000;
    let pendingRead = null;
    const readWithPing = async () => {
      for (;;) {
        if (!res.writableEnded) {
          // Reuse the same pending read across ping cycles: issuing a second
          // concurrent reader.read() would consume and drop a chunk.
          if (!pendingRead) pendingRead = reader.read();
          let timer;
          const timeout = new Promise((resolve) => {
            timer = setTimeout(() => resolve(null), pingMs);
            timer.unref?.();
          });
          const result = await Promise.race([pendingRead, timeout]);
          clearTimeout(timer);
          if (result === null) {
            res.write(': ping\n\n');
            continue;
          }
          pendingRead = null;
          return result;
        }
        const result = await reader.read();
        pendingRead = null;
        return result;
      }
    };
    const onClose = () => {
      reader.cancel().catch(() => {});
    };
    res.on('close', onClose);
    try {
      for (;;) {
        const { done, value } = await readWithPing();
        if (done) break;
        if (decoder && onText) {
          try {
            onText(decoder.decode(value, { stream: true }));
          } catch {
            // Signature capture must never break the stream.
          }
        }
        if (!res.write(value)) await new Promise((resolve) => res.once('drain', resolve));
      }
    } catch {
      // Client disconnected; nothing left to do.
    } finally {
      res.off('close', onClose);
      reader.releaseLock?.();
      if (!res.writableEnded) res.end();
    }
  }

  return { sendJsonResponse, streamRaw };
}

function sendProtocolError(res, protocol, status, message, headers) {
  if (protocol === 'openai') sendOpenAiError(res, status, message, { headers });
  else sendAnthropicError(res, status, message, headers);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  // Log every inbound HTTP request/response (health checks are skipped: noise).
  if (!(req.method === 'GET' && (pathname === '/health' || pathname === '/healthz'))) {
    const startedAt = Date.now();
    log.info('http.request', {
      method: req.method,
      path: pathname,
      ua: req.headers['user-agent'],
      length: req.headers['content-length'],
    });
    res.on('finish', () =>
      log.info('http.response', { method: req.method, path: pathname, status: res.statusCode, ms: Date.now() - startedAt }),
    );
    res.on('close', () => {
      if (!res.writableFinished) log.warn('http.aborted', { method: req.method, path: pathname, status: res.statusCode });
    });
  }

  if (req.method === 'GET' && (pathname === '/health' || pathname === '/healthz')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, pid: process.pid, defaultProvider, providers: Object.keys(cfg.providers) }));
    return;
  }

  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        defaultProvider,
        providers: Object.keys(cfg.providers),
        endpoints: {
          anthropic: '/<provider>/v1/messages',
          openai: '/<provider>/v1/chat/completions',
          models: '/<provider>/v1/models',
        },
      }),
    );
    return;
  }

  const route = parseRoute(req.url);
  if (!route) {
    log.warn('route.unknown', { method: req.method, path: pathname });
    sendAnthropicError(res, 404, 'not found');
    return;
  }

  const auth = authorized(req);
  if (!auth.ok) {
    log.warn('auth.rejected', { path: pathname, status: auth.status, remote: req.socket?.remoteAddress });
    sendProtocolError(res, route.protocol, auth.status, auth.message);
    return;
  }

  const providerCfg = cfg.active(route.provider);
  if (!providerCfg) {
    sendProtocolError(res, route.protocol, 400, `unknown provider: ${route.provider}`);
    return;
  }

  const helpers = responseHelpers(res);
  if (route.endpoint === 'model') {
    // Claude Code may probe GET /v1/models/<id>; answer instead of a (misleading) 404.
    helpers.sendJsonResponse(200, { type: 'model', id: route.modelId, display_name: route.modelId, created_at: '2026-01-01T00:00:00Z' });
    return;
  }
  const retryOpts = {
    log,
    provider: route.provider,
    maxRetries: cfg.server.rateLimitMaxRetries,
    defaultWaitMs: cfg.server.rateLimitWaitMs,
    res,
  };
  if (route.endpoint === 'models') {
    if (req.method !== 'GET') {
      sendOpenAiError(res, 405, 'method not allowed');
      return;
    }
    try {
      await runWithRateLimitRetry(
        () =>
          handleOpenAiModels({
            cfg,
            providerName: route.provider,
            providerCfg,
            log,
            res,
            sendJsonResponse: helpers.sendJsonResponse,
          }),
        { ...retryOpts, model: '' }
      );
    } catch (e) {
      log.error('request.failed', { message: e.message, status: e.status, endpoint: 'models' });
      if (!res.headersSent) sendOpenAiError(res, e.status || 502, e.message, { headers: e.headers });
      else res.end();
    }
    return;
  }

  if (req.method !== 'POST') {
    sendProtocolError(res, route.protocol, 405, 'method not allowed');
    return;
  }

  let raw;
  try {
    raw = await readBody(req, cfg.server.maxBodyBytes ?? 32 * 1024 * 1024);
  } catch (e) {
    sendProtocolError(res, route.protocol, e.status ?? 400, e.message);
    return;
  }

  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    sendProtocolError(res, route.protocol, 400, 'invalid json');
    return;
  }

  const apiKey = cfg.apiKeyOf(providerCfg);
  const modelRules = cfg.modelRules(route.provider);
  const fallbackPresets = cfg.models?.[route.provider]?.presets ?? [];

  if (route.endpoint === 'count_tokens') {
    // Optional endpoint: a rough estimate keeps Claude Code from hitting a 404.
    const inputTokens = estimateRequestTokens(body);
    log.info('count_tokens.estimate', { provider: route.provider, input_tokens: inputTokens });
    helpers.sendJsonResponse(200, { input_tokens: inputTokens });
    return;
  }

  if (route.endpoint === 'chat') {
    let prepared;
    try {
      prepared = prepareOpenAiRequest(body, {
        providerName: route.provider,
        providerCfg,
        modelRules,
      });
    } catch (e) {
      sendOpenAiError(res, e.status ?? 400, e.message);
      return;
    }

    const ctx = {
      cfg,
      providerCfg,
      request: prepared.request,
      meta: prepared.meta,
      apiKey,
      server: cfg.server,
      log,
      res,
      signal: null,
      fallbackPresets,
      ...helpers,
    };

    log.info('request.start', {
      protocol: 'openai',
      provider: route.provider,
      model: prepared.meta.model,
      requestedModel: prepared.meta.requestedModel,
      stream: prepared.meta.stream,
      messages: body.messages?.length,
      tools: body.tools?.length,
    });

    try {
      await withModelFallback(ctx, () =>
        runWithRateLimitRetry(
          () => (providerCfg.kind === 'cohere' ? handleCohereCompatible(ctx) : handleOpenAiCompatible(ctx)),
          { ...retryOpts, model: ctx.request.model }
        )
      );
      log.info('request.done', { protocol: 'openai', provider: route.provider, model: prepared.meta.model });
    } catch (e) {
      log.error('request.failed', {
        message: summarizeErrorMessage(e.message, { enabled: cfg.server.logBodies }),
        status: e.status,
        protocol: 'openai',
        provider: route.provider,
        model: ctx.request.model,
        ...upstreamBodyFields(e.body, { enabled: cfg.server.logBodies }),
      });
      if (!res.headersSent) sendOpenAiError(res, e.status || 502, e.message, { headers: e.headers || {} });
      else res.end();
    }
    return;
  }

  const dropThinking = route.provider === 'nvidia' && providerCfg.mode === 'hosted';
  const { request, meta } = normalizeRequest(body, {
    provider: route.provider,
    providerCfg,
    modelRules,
    dropThinking,
  });
  meta.provider = route.provider;

  const ctx = {
    providerCfg,
    request,
    meta,
    apiKey,
    server: cfg.server,
    log,
    res,
    signal: null,
    beta: { version: req.headers['anthropic-version'], header: req.headers['anthropic-beta'] },
    fallbackPresets,
    ...helpers,
  };

  log.info('request.start', {
    protocol: 'anthropic',
    provider: route.provider,
    model: meta.model,
    requestedModel: meta.requestedModel,
    stream: Boolean(request.stream),
    messages: body.messages?.length,
    tools: body.tools?.length,
  });

  try {
    const useOpenAi = providerCfg.kind === 'openai';
    const useGemini = providerCfg.kind === 'gemini';
    await withModelFallback(ctx, () =>
      runWithRateLimitRetry(
        () => {
          if (useGemini) return handleGeminiProvider(ctx);
          if (providerCfg.kind === 'cohere') return handleCohereProvider(ctx);
          if (useOpenAi) return handleOpenAiProvider(ctx);
          return handleAnthropicProvider(ctx);
        },
        { ...retryOpts, model: ctx.request.model }
      )
    );
    log.info('request.done', { protocol: 'anthropic', provider: route.provider, model: ctx.request.model, usage: meta.usage });
  } catch (e) {
    log.error('request.failed', {
      message: summarizeErrorMessage(e.message, { enabled: cfg.server.logBodies }),
      status: e.status,
      protocol: 'anthropic',
      provider: route.provider,
      model: ctx.request.model,
      requestedModel: meta.requestedModel,
      ...upstreamBodyFields(e.body, { enabled: cfg.server.logBodies }),
    });
    if (!res.headersSent) sendAnthropicError(res, e.status || 502, e.message, e.headers || {});
    else res.end();
  }
});

const port = cfg.server.port;
const host = cfg.server.host;
server.listen(port, host, () => {
  log.info('server.start', { host, port, defaultProvider, tokenRequired: Boolean(cfg.proxyToken) });
  process.stderr.write(`appProxy listening on http://${host}:${port} (default=${defaultProvider})\n`);
  if (!cfg.proxyToken) {
    if (isLoopbackHost(host)) {
      // Fine: only this machine can reach the port. Non-loopback peers are still
      // rejected per request, so a later tunnel/proxy does not silently open it.
      log.info('server.token.absent', { scope: 'loopback-only' });
    } else {
      log.warn('server.token.absent', {
        host,
        hint: 'set PROXY_TOKEN in .env; non-loopback requests are rejected while it is empty',
      });
      process.stderr.write(
        `[uyarı] PROXY_TOKEN boş ve sunucu ${host} üzerinde dinliyor: loopback dışı istekler 401 ile reddedilecek.\n`,
      );
    }
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log.info('server.stop', { signal });
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
