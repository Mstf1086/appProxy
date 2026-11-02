/**
 * Configuration loading: `.env` + `config/providers.json` + `config/models.json`.
 * No third-party packages are used anywhere in this project.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Strip a trailing `# comment` from an unquoted dotenv value.
 * `KEY=value  # note` → `value`; a `#` without preceding whitespace (`a#b`) or
 * inside quotes is part of the value. `.env.example` documents values with
 * inline comments, so without this a copied `PROXY_TOKEN=...  # local` line
 * yields a token that never matches and every client gets a silent 401.
 */
export function stripInlineComment(value) {
  const text = String(value ?? '');
  if (!text) return text;
  const match = text.match(/(^|\s)#/);
  if (!match) return text;
  return text.slice(0, match.index).trimEnd();
}

/** Parse a dotenv-style file. Comments, blank lines and optional quotes. */
export function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = stripInlineComment(value);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Values from the real environment win, but an *empty* variable counts as
 * unset so that `.env` can fill it in.
 */
export function readEnv(env, key, fallback = undefined) {
  const fromProcess = process.env[key];
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess;
  const fromFile = env[key];
  if (fromFile !== undefined && fromFile !== '') return fromFile;
  return fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadConfig({ root = ROOT } = {}) {
  const envFile = path.join(root, '.env');
  const env = fs.existsSync(envFile) ? parseEnvFile(fs.readFileSync(envFile, 'utf8')) : {};

  const providersFile = readJson(path.join(root, 'config', 'providers.json'));
  const models = readJson(path.join(root, 'config', 'models.json'));

  const server = { ...providersFile.server };
  server.host = readEnv(env, 'PROXY_HOST', server.host);
  server.port = Number.parseInt(readEnv(env, 'PROXY_PORT', String(server.port)), 10);
  server.logBodies = readEnv(env, 'PROXY_LOG_BODIES', server.logBodies ? '1' : '0') === '1';

  // 429 (rate limit) bekle-yeniden-dene davranışı (src/rate-limit.mjs).
  const rateWait = Number.parseInt(
    readEnv(env, 'PROXY_RATE_LIMIT_WAIT_MS', String(server.rateLimitWaitMs ?? 30000)), 10
  );
  server.rateLimitWaitMs = Number.isFinite(rateWait) && rateWait >= 0 ? rateWait : 30000;
  const rateRetries = Number.parseInt(
    readEnv(env, 'PROXY_RATE_LIMIT_MAX_RETRIES', String(server.rateLimitMaxRetries ?? 2)), 10
  );
  server.rateLimitMaxRetries = Number.isFinite(rateRetries) && rateRetries >= 0 ? rateRetries : 2;

  const providers = providersFile.providers;

  // NVIDIA has two official transport modes; pick the active one.
  // (nvidia kaldırılmışsa atlanır; bkz. `bin/proxy-run remove`.)
  const nvidia = providers.nvidia;
  if (nvidia) {
    const nvidiaMode = readEnv(env, 'NVIDIA_MODE', nvidia.mode ?? 'hosted');
    nvidia.mode = nvidiaMode;
    if (nvidiaMode === 'nim') {
      // A self-hosted NIM serves the OpenAI API under /v1. Accept both
      // "http://host:8000" and "http://host:8000/v1" (the README and .env.example
      // document the former), and never crash when the block is missing.
      const selfHosted = (nvidia.selfHosted ??= {});
      const raw = readEnv(env, 'NIM_BASE_URL', selfHosted.baseUrl ?? 'http://127.0.0.1:8000/v1');
      selfHosted.baseUrl = /\/v1\/?$/.test(raw) ? raw.replace(/\/+$/, '') : `${raw.replace(/\/+$/, '')}/v1`;
    }
  }

  const cfg = {
    root,
    env,
    server,
    providers,
    models: { ...models },
    proxyToken: readEnv(env, 'PROXY_TOKEN', ''),
    apiKeyOf(config) {
      if (!config) return '';
      return readEnv(env, config.apiKeyEnv, config.apiKeyFallback ?? '');
    },
    /** Active transport config for a provider name (handles `nvidia.mode`). */
    active(name) {
      const base = providers[name];
      if (!base) return undefined;
      if (name === 'nvidia' && base.mode === 'nim') {
        return { ...base, ...base.selfHosted, name, mode: 'nim' };
      }
      return { ...base, name };
    },
    /** provider model mapping rules for one provider */
    modelRules(name) {
      return models[name] ?? { passthroughPrefixes: [], rules: [{ match: '*', model: undefined }] };
    },
  };
  return cfg;
}

export function maskSecret(value) {
  if (!value) return '(unset)';
  const s = String(value);
  if (s.length <= 8) return '***';
  return `${s.slice(0, 4)}***${s.slice(-2)}`;
}
