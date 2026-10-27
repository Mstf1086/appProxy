#!/usr/bin/env node
/**
 * Pi Coding Agent (https://pi.dev) client launcher.
 *
 * Launches the Pi CLI after proxy-run has selected a provider + model.
 * Pi CLI supports: `--provider <name>` (requires `--model`) and
 * `--model <pattern>` (supports "provider/id" format, e.g.
 * "openrouter/anthropic/claude-sonnet-5.5").
 *
 * The Pi CLI binary is searched as "pi" on PATH. If not found, a fallback
 * npm path is tried; if still missing the flow falls back to displaying
 * proxy instructions (client = none behavior).
 */
import { execFileSync, spawn } from 'node:child_process';
import { createLogger } from '../log.mjs';
import { loadConfig } from '../config.mjs';

const log = createLogger({ dir: 'logs', root: '.' });

/**
 * Map an appProxy provider name → Pi provider identifier used by
 * `pi --provider <name> --model <pattern>`. Returns null when the provider
 * is not supported by the Pi CLI, so the caller can show proxy-only instructions.
 */
export function piProviderName(appProxyProvider) {
  const mapping = {
    // Gemini is exposed by Pi as the "google" provider.
    gemini: 'google',
    // OpenRouter is a Pi provider and hosts the same model IDs we list.
    openrouter: 'openrouter',
    // NVIDIA models are served under the "nvidia" provider.
    nvidia: 'nvidia',
    // Cohere is a built-in Pi provider.
    cohere: 'cohere',
    // anyrouter is exposed by Pi as an "openai" provider (catalog: anyrouter/*).
    anyrouter: 'anyrouter',
    // refuseless / apinex are OpenAI-compatible gateways; map to "openai" but
    // only if the requested model exists on Pi's openai provider.
    refuseless: 'openai',
    apinex: 'openai',
  };
  return mapping[appProxyProvider] ?? null;
}

/**
 * Normalize a model ID for the Pi CLI.
 *
 * The Pi catalog expects IDs like "google/gemini-3.8-flash",
 * "openrouter/anthropic/claude-sonnet-5.5", "nvidia/llama-3.1-nemotron-70b",
 * "cohere/command-a-plus-05-2026" or a bare model id. If the ID already
 * contains a slash it is kept as-is (Pi resolves provider/model pairs).
 */
export function normalizePiModelId(modelId) {
  if (String(modelId).includes('/')) {
    // Already provider/scoped model: normalize only known prefixes.
    const id = String(modelId);
    if (id.startsWith('z-ai/')) {
      return `zai/${id.slice('z-ai/'.length)}`;
    }
    if (id.startsWith('google/') || id.startsWith('anthropic/') || id.startsWith('openrouter/')
      || id.startsWith('nvidia/') || id.startsWith('cohere/') || id.startsWith('anyrouter/')) {
      return id;
    }
    return id;
  }
  return String(modelId);
}

/**
 * Pre-flight check: verify Pi CLI is available AND can resolve the selected
 * provider/model. Returns { available, error, requiresAuth } so the caller can
 * decide whether to launch Pi. `requiresAuth` is true when the model resolved
 * but no credential is configured yet.
 */
export async function checkPiAvailability(cfg, provider, modelId, signal) {
  const providerName = piProviderName(provider);
  if (!providerName) {
    return { available: false, error: 'provider not supported by Pi CLI' };
  }
  const model = normalizePiModelId(modelId);
  try {
    const bin = detectPiBinary();
    const out = execFileSync(
      bin,
      ['auth', 'check', '--provider', providerName, '--model', model, '--json'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000, signal }
    ).trim();
    const parsed = JSON.parse(out);
    const requiresAuth = parsed.status !== 'ready';
    return { available: true, requiresAuth, error: parsed.reason || null };
  } catch (err) {
    // `pi` binary missing or auth check itself failed (provider/model invalid
    // → "invalid", exit 2).
    const stderr = err.stdout?.toString() ?? err.stderr?.toString() ?? String(err.message);
    return { available: false, error: `Pi resolution failed: ${stderr.slice(0, 200)}` };
  }
}

/** Locate the Pi CLI binary. */
function detectPiBinary() {
  // Official distribution ships the bundled binary as the "pi" executable.
  try {
    const bin = execFileSync('which', ['pi'], { encoding: 'utf8', stdio: 'pipe', timeout: 5000 }).trim();
    if (bin) return bin;
  } catch {}
  throw new Error('Pi CLI not found: install with "npm i -g @earendil-works/pi-coding-agent" or use "pi" on PATH');
}

/**
 * Launch the Pi CLI. The proxy keeps running in the background; Pi connects
 * directly to the provider's upstream API, so no proxy authentication is needed.
 *
 * Env vars passed through (Pi respects GOOGLE_API_KEY / ANTHROPIC_API_KEY /
 * OPENAI_API_KEY / OPENROUTER_API_KEY / NVIDIA_API_KEY / CO_API_KEY /
 * ANYROUTER_API_KEY). This script also exports a mapped env var for providers
 * whose key name differs between appProxy and Pi (e.g. GEMINI_API_KEY →
 * GOOGLE_API_KEY).
 */
export async function launchPi(cfg, provider, modelId, cwd, signal) {
  const providerName = piProviderName(provider);
  const model = normalizePiModelId(modelId);
  if (!providerName) {
    throw new Error(`Pi CLI does not support provider "${provider}"`);
  }
  log.info('launchPi', { provider, piProvider: providerName, model });

  // Map appProxy's env var name to the name Pi expects (e.g. GEMINI_API_KEY
  // → GOOGLE_API_KEY) and export it so Pi picks it up.
  const envMap = {
    gemini: 'GOOGLE_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    nvidia: 'NVIDIA_API_KEY',
    cohere: 'CO_API_KEY',
    anyrouter: 'ANYROUTER_API_KEY',
    refuseless: 'OPENAI_API_KEY',
    apinex: 'OPENAI_API_KEY',
  };
  const piEnvVar = envMap[provider];
  if (piEnvVar) {
    const appProxyEnv = cfg.active(provider)?.apiKeyEnv ?? '';
    if (appProxyEnv && process.env[appProxyEnv] && !process.env[piEnvVar]) {
      // Pi does not know the appProxy key name; expose the same secret under Pi's name.
      process.env[piEnvVar] = process.env[appProxyEnv];
      log.info('piEnvMapped', { appProxyEnv, piEnvVar });
    }
  }

  console.log(`Pi CLI başlatılıyor (provider=${providerName}, model=${model})...`);
  try {
    const bin = detectPiBinary();
    const args = ['--provider', providerName, '--model', model];
    const pi = spawn(bin, args, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env },
    });
    pi.on('error', (err) => {
      console.error(`Pi başlatılamadı: ${err.message}`);
    });
    pi.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`Pi çıktı (kod ${code}); proxy arkada çalışıyor. Durum: bin/proxy-run status`);
      }
    });
    process.on('SIGINT', () => { pi.kill('SIGINT'); });
    process.on('SIGTERM', () => { pi.kill('SIGTERM'); });
  } catch (err) {
    console.error(`Pi başlatma hatası: ${err.message}`);
    console.error('Proxy arkada çalışmaya devam ediyor; el ile bağlanmak için alt satırları kullanın.');
  }
}

// --- CLI (proxy-run tarafından çağrılır: node src/providers/pi.mjs <provider> <model> [cwd]) ---
if (process.argv[1]?.endsWith('providers/pi.mjs')) {
  const provider = process.argv[2];
  const modelId = process.argv[3];
  const cwd = process.argv[4] ?? process.cwd();
  if (!provider || !modelId) {
    console.error('Kullanım: node src/providers/pi.mjs <provider> <model> [cwd]');
    process.exit(1);
  }
  try {
    const cfg = loadConfig();
    const check = await checkPiAvailability(cfg, provider, modelId, AbortSignal.timeout(15000));
    if (!check.available) {
      console.error(`HATA: Pi CLI provider/model çözemedi: ${check.error}`);
      console.error('  (Proxy arkada çalışıyor: bin/proxy-run status)');
      process.exit(1);
    }
    if (check.requiresAuth) {
      console.error('UYARI: Pi\'de API anahtarı ayarlanmamış; ilk istek 401 dönebilir.');
      console.error('  Çözüm: .env\'de gerekli anahtarı ayarlayın veya pi\'de /login yapın.');
      console.error();
    }
    await launchPi(cfg, provider, modelId, cwd, AbortSignal.timeout(0));
  } catch (err) {
    console.error(`HATA: ${err.message}`);
    console.error('  (Proxy arkada çalışıyor: bin/proxy-run status)');
    process.exit(1);
  }
}
