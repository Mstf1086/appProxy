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

/**
 * Fields for logging an upstream error body.
 *
 * Error payloads are not safe by default: a 400 from any provider typically
 * echoes the offending prompt/messages back in `error.message`, so writing the
 * body into logs breaks the "request bodies are never logged" promise. Unless
 * PROXY_LOG_BODIES=1, log only the size — enough to tell an empty body from a
 * 20 KB HTML error page.
 */
export function upstreamBodyFields(body, { enabled = false, max = 800 } = {}) {
  if (typeof body !== 'string' || !body) return {};
  const bytes = Buffer.byteLength(body, 'utf8');
  if (!enabled) return { upstreamBodyBytes: bytes, upstreamBody: '<omitted>' };
  return { upstreamBodyBytes: bytes, upstreamBody: body.slice(0, max) };
}

/**
 * Keep the actionable head of an error message and drop the upstream payload.
 *
 * Providers echo the offending request back in their error messages
 * (`upstream 400: messages.0.content: <prompt> ...`), so the payload can never
 * be logged safely: it is not always JSON and not always long, which is exactly
 * how the first version of this filter leaked the prompt. Unless
 * PROXY_LOG_BODIES=1, only the status survives — the client still receives the
 * full message.
 */
export function summarizeErrorMessage(message, { enabled = false, max = 200 } = {}) {
  if (!message) return message;
  const text = String(message);
  if (enabled) return text.length > max ? `${text.slice(0, max)}…` : text;
  const upstream = text.match(/^upstream\s+(\d{3})\s*:/i);
  if (upstream) return `upstream ${upstream[1]}: <upstream body omitted>`;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function fmtValue(value) {
  if (value === undefined) return null;
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return null;
  text = text.replace(/\s+/g, ' ');
  if (text.length > 600) text = `${text.slice(0, 600)}…`;
  return /[\s="]/.test(text) ? JSON.stringify(text) : text;
}

/** One plain-text line: `ts LEVEL event key=value ...` (for the .log file). */
export function formatTextLine(record) {
  const { ts, level, event, ...fields } = record;
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    const v = fmtValue(value);
    if (v !== null) parts.push(`${key}=${v}`);
  }
  return `${ts} ${level.toUpperCase().padEnd(5)} ${event}${parts.length ? ` ${parts.join(' ')}` : ''}`;
}

export function createLogger({ dir, root, bodies = false, echo = true, textFile = process.env.PROXY_LOG_FILE }) {
  const logDir = path.isAbsolute(dir) ? dir : path.join(root, dir);
  fs.mkdirSync(logDir, { recursive: true });

  let stream = null;
  let streamDay = null;

  // Optional plain-text log (PROXY_LOG_FILE): every event, one line each.
  let textPath = null;
  if (textFile) {
    textPath = path.isAbsolute(textFile) ? textFile : path.join(root, textFile);
    fs.mkdirSync(path.dirname(textPath), { recursive: true });
  }
  function writeText(record) {
    if (!textPath) return;
    try {
      fs.appendFileSync(textPath, `${formatTextLine(record)}\n`);
    } catch {
      /* logging must never crash the proxy */
    }
  }

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
    writeText(record);
  }

  return {
    dir: logDir,
    textPath,
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
