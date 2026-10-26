/**
 * Anthropic-shaped errors and response helpers.
 *
 * Source of truth: docs/anthropic/api/errors.md and
 * docs/anthropic/claude-code/llm-gateway-protocol.md (response headers section).
 */

export const ANTHROPIC_VERSION = '2023-06-01';

const ERROR_TYPE_BY_STATUS = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  405: 'invalid_request_error',
  408: 'timeout_error',
  409: 'conflict_error',
  413: 'request_too_large',
  422: 'invalid_request_error',
  429: 'rate_limit_error',
  500: 'api_error',
  502: 'api_error',
  503: 'api_error',
  504: 'api_error',
  529: 'overloaded_error',
};

export function errorTypeForStatus(status) {
  return ERROR_TYPE_BY_STATUS[status] ?? (status >= 500 ? 'api_error' : 'invalid_request_error');
}

export function errorBody(type, message) {
  return { type: 'error', error: { type, message } };
}

export function jsonError(status, message, extraHeaders = {}) {
  return {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: errorBody(errorTypeForStatus(status), message),
  };
}

/**
 * Claude Code reads `x-should-retry` (pass the upstream value through) and
 * `retry-after` (integer seconds, never an HTTP date).
 */
export const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export function shouldRetryStatus(status) {
  return RETRYABLE_STATUSES.has(status);
}

export function retryHeadersFrom(upstreamHeaders) {
  const out = {};
  const shouldRetry = upstreamHeaders.get('x-should-retry');
  if (shouldRetry) out['x-should-retry'] = shouldRetry;

  const retryAfter = upstreamHeaders.get('retry-after');
  if (retryAfter && /^\d+$/.test(retryAfter.trim())) {
    out['retry-after'] = retryAfter.trim();
  } else if (retryAfter) {
    const seconds = Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000);
    if (Number.isFinite(seconds) && seconds > 0) out['retry-after'] = String(seconds);
  } else {
    const statusVal = upstreamHeaders.get('status') || upstreamHeaders.get('statusCode');
    if (shouldRetryStatus(Number(statusVal ?? 0))) {
      out['retry-after'] = '1';
    }
  }
  return out;
}

/** Rate-limit headers Claude Code reads to display plan usage. */
export function rateLimitHeadersFrom(upstreamHeaders) {
  const out = {};
  for (const [key, value] of upstreamHeaders.entries()) {
    const lower = key.toLowerCase();
    if (lower.startsWith('anthropic-ratelimit-')) out[lower] = value;
  }
  return out;
}

export function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

export function sendAnthropicError(res, status, message, extraHeaders = {}) {
  const { headers, body } = jsonError(status, message, extraHeaders);
  sendJson(res, status, body, headers);
}

/** HTTP error raised by a provider layer; carries the upstream payload. */
export class UpstreamError extends Error {
  constructor(message, { status = 502, body = null, headers = {} } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}
