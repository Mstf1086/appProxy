/**
 * Upstream HTTP helpers: timeout-aware fetch, SSE reader, safe JSON reads.
 */
import { UpstreamError } from './errors.mjs';

export function timeoutSignal(ms, externalSignal = undefined) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`upstream timeout after ${ms}ms`)), ms);
  timer.unref?.();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true });
  }
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export async function upstreamFetch(url, { method = 'POST', headers = {}, body, timeoutMs = 600000, signal } = {}) {
  const { signal: timeout, cancel } = timeoutSignal(timeoutMs, signal);
  try {
    return await fetch(url, { method, headers, body, signal: timeout });
  } finally {
    cancel();
  }
}

export async function readBodyText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/** Parse a JSON error body without throwing; falls back to the raw text. */
export async function readJsonLoose(response) {
  const text = await readBodyText(response);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function parseEventBlock(raw) {
  if (!raw || !raw.trim() || raw.startsWith(':')) return null;
  const lines = raw.split('\n');
  let event = 'message';
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

/** Async generator over `text/event-stream` payloads. */
export async function* readSseEvents(response) {
  if (!response.body) throw new UpstreamError('upstream returned no body for a streaming request', { status: 502 });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let index = buffer.indexOf('\n\n');
      while (index !== -1) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const event = parseEventBlock(block);
        if (event) yield event;
        index = buffer.indexOf('\n\n');
      }
    }
    const tail = parseEventBlock(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock?.();
  }
}

export function anthropicAuthHeaders(apiKey, { providerCfg = {} } = {}) {
  const headers = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    // Some upstreams (NIM honours neither, OpenRouter prefers bearer) accept x-api-key.
    headers['x-api-key'] = apiKey;
  }
  Object.assign(headers, providerCfg.extraHeaders ?? {});
  return headers;
}
