/**
 * Proxy token check.
 *
 * A token is optional for loopback peers so a local-only setup keeps working
 * with zero configuration. It is NOT optional for anybody else: an empty
 * PROXY_TOKEN used to mean "no authentication at all", so binding to 0.0.0.0
 * (or putting the proxy behind a tunnel) handed every caller the upstream API
 * keys. Now an unset token fails closed for non-loopback clients.
 */

/** `127.0.0.0/8`, `::1` and IPv4-mapped loopback addresses. */
export function isLoopbackAddress(address = '') {
  const addr = String(address ?? '').replace(/^::ffff:/i, '').toLowerCase();
  if (!addr) return false;
  return addr === '::1' || addr === 'localhost' || /^127\./.test(addr);
}

/** Hostnames/IPs that only accept local connections (what a listen() bind means). */
export function isLoopbackHost(host = '') {
  const value = String(host ?? '').toLowerCase();
  if (!value) return false;
  if (value === 'localhost' || value === '::1') return true;
  return /^127\./.test(value);
}

function tokenFromHeaders(headers = {}) {
  const apiKey = headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey) return apiKey;
  const auth = headers.authorization;
  if (typeof auth === 'string') return auth.replace(/^Bearer\s+/i, '');
  return undefined;
}

/**
 * @returns {{ok: true} | {ok: false, status: number, message: string}}
 */
export function checkProxyToken({ token = '', headers = {}, remoteAddress = '' } = {}) {
  const provided = tokenFromHeaders(headers);
  if (token) {
    return provided === token ? { ok: true } : { ok: false, status: 401, message: 'invalid proxy token' };
  }
  if (isLoopbackAddress(remoteAddress)) return { ok: true };
  return {
    ok: false,
    status: 401,
    message: 'PROXY_TOKEN is not set; non-loopback clients are rejected',
  };
}
