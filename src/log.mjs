/**
 * Structured JSONL logging.
 *
 * Privacy rules (project convention): request/response bodies and credentials are
 * NEVER logged unless PROXY_LOG_BODIES=1 is explicitly set, and even then the
 * authentication headers are redacted.
 */
import fs from 'node:fs';
import path from 'node:path';

const SECRET_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'x-goog-api-key',
  'proxy-authorization',
  'cookie',
]);

export function redactHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SECRET_HEADERS.has(key.toLowerCase()) ? '<redacted>' : value;
  }
  return out;
}

export function createLogger({ dir, root, bodies = false, echo = true }) {
  const logDir = path.isAbsolute(dir) ? dir : path.join(root, dir);
  fs.mkdirSync(logDir, { recursive: true });

  let stream = null;
  let streamDay = null;

  const today = () => new Date().toISOString().slice(0, 10);

  function fileStream() {
    const day = today();
    if (stream && streamDay === day) return stream;
    if (stream) stream.end();
    streamDay = day;
    stream = fs.createWriteStream(path.join(logDir, `proxy-${day}.jsonl`), { flags: 'a' });
    return stream;
  }

  function write(level, event, fields = {}) {
    const record = { ts: new Date().toISOString(), level, event, ...fields };
    const line = JSON.stringify(record);
    // stderr keeps stdout free for CLI output (echo=false: only the file).
    if (echo) process.stderr.write(`${line}\n`);
    fileStream().write(`${line}\n`);
  }

  return {
    dir: logDir,
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    body: (event, fields) => {
      if (bodies) write('body', event, fields);
    },
    close() {
      if (stream) stream.end();
      stream = null;
    },
  };
}
