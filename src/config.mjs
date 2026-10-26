/**
 * Configuration loading: `.env` + `config/providers.json` + `config/models.json`.
 * No third-party packages are used anywhere in this project.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

  const providers = providersFile.providers;

  // NVIDIA has two official transport modes; pick the active one.
  // (nvidia kaldırılmışsa atlanır; bkz. `bin/proxy-run remove`.)
  const nvidia = providers.nvidia;
  if (nvidia) {
    const nvidiaMode = readEnv(env, 'NVIDIA_MODE', nvidia.mode);
    nvidia.mode = nvidiaMode;
    if (nvidiaMode === 'nim') {
      nvidia.selfHosted.baseUrl = readEnv(env, 'NIM_BASE_URL', nvidia.selfHosted.baseUrl);
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
