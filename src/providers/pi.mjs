#!/usr/bin/env node
/**
 * Pi Coding Agent (https://pi.dev) client launcher.
 *
 * proxy-run, provider + model seçtikten sonra bu modülü çağırır:
 *   node src/providers/pi.mjs <provider> <model> [cwd]
 *
 * İki yol ile Pi'yi seçilen provider/model ile başlatır:
 *
 * 1. Yerleşik (native) Pi provider'ları:
 *      gemini -> google, openrouter -> openrouter, nvidia -> nvidia
 *    Model ID bilinmese bile Pi "custom model id" geri düşümü ile isteği
 *    gönderir (pi --provider <p> --model <m>).
 *
 * 2. Özel (custom) provider: Pi'nin yerleşik desteklemediği sağlayıcılar
 *    (cohere, refuseless, apinex, ... ve sihirbazla eklenenler) için
 *    ~/.pi/agent/models.json içine "managedBy: appProxy" işaretli bir provider
 *    tanımı yazılır (bkz. https://pi.dev/docs/latest/cli -> models.json).
 *    - openai kind    -> api: openai-completions, sağlayıcının kendi baseUrl'i
 *    - cohere kind    -> api: openai-completions, Cohere'nin resmî OpenAI-uyumlu
 *                        ucu: {baseUrl}/compatibility/v1
 *    - anthropic kind -> api: anthropic-messages
 *    - gemini kind    -> api: google-generative-ai
 *
 * Pi bir ara yüz olarak appProxy'yi KULLANMAZ; proxy arka planda çalışır,
 * Pi doğrudan sağlayıcının ucuna bağlanır. appProxy .env'sindeki anahtar,
 * Pi'nin beklediği ortam değişkeni adına çevrilerek alt sürece aktarılır.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createLogger } from '../log.mjs';
import { loadConfig } from '../config.mjs';
import { discoverModels } from '../models.mjs';
import { readBodyText, upstreamFetch } from '../http.mjs';

const log = createLogger({ dir: 'logs', root: '.', echo: false });

/** appProxy provider -> Pi'nin yerleşik provider adı. */
const NATIVE_PI_PROVIDERS = {
  gemini: 'google',
  openrouter: 'openrouter',
  nvidia: 'nvidia',
};

/** Yerleşik Pi provider'larının okuduğu ortam değişkenleri. */
const NATIVE_PI_ENV = {
  google: 'GOOGLE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
};

/** models.json'da bizim yazdığımız tanımların işareti. */
const PI_MANAGED_MARKER = 'appProxy';
/** Özel provider model girişlerindeki güvenli varsayılanlar. */
const PI_MAX_TOKENS_DEFAULT = 8192;
const PI_CONTEXT_DEFAULT = 128000;

/** Pi agent dizini (~/.pi/agent; PI_CODING_AGENT_DIR ile değiştirilebilir). */
export function piAgentDir() {
  return process.env.PI_CODING_AGENT_DIR
    ?? path.join(os.homedir(), '.pi', 'agent');
}

export function piModelsFile() {
  return path.join(piAgentDir(), 'models.json');
}

/** Pi'nin yerleşik desteklediği provider adı; yoksa null. */
export function piProviderName(appProxyProvider) {
  return NATIVE_PI_PROVIDERS[appProxyProvider] ?? null;
}

/**
 * Yerleşik provider'lar için model ID'sini Pi'ye uygun biçimde bırakır.
 * "provider/..." önekli ID'ler aynen korunur; z-ai öneki zai'ye düzeltilir.
 */
export function normalizePiModelId(modelId) {
  const id = String(modelId);
  if (id.startsWith('z-ai/')) return `zai/${id.slice('z-ai/'.length)}`;
  return id;
}

/** appProxy provider kind'ına göre Pi custom provider ucu (baseUrl + api). */
function piCustomEndpoint(p) {
  const base = String(p.baseUrl ?? '').replace(/\/+$/, '');
  switch (p.kind) {
    case 'openai':
      return { baseUrl: base, api: 'openai-completions', authHeader: true };
    case 'cohere':
      // Cohere'nin resmî OpenAI-uyumlu ucu (api.cohere.com/compatibility/v1).
      return {
        baseUrl: `${base || 'https://api.cohere.com'}/compatibility/v1`,
        api: 'openai-completions',
        authHeader: true,
      };
    case 'anthropic':
      return { baseUrl: base, api: 'anthropic-messages' };
    case 'gemini':
      return { baseUrl: base, api: 'google-generative-ai' };
    default:
      return null;
  }
}

/**
 * Cohere native /v1/models listesinden model -> context_length haritası.
 * Model pencere bilgisi pi'de doğru kompaksiyon/limit için kullanılır.
 */
async function cohereContextLengths(p, apiKey) {
  const base = String(p.baseUrl ?? '').replace(/\/+$/, '');
  const url = `${base || 'https://api.cohere.com'}/v1/models?page_size=1000`;
  try {
    const response = await upstreamFetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      timeoutMs: 8000,
    });
    if (!response.ok) return {};
    const json = JSON.parse(await readBodyText(response));
    const out = {};
    for (const m of json.models ?? []) {
      if (typeof m?.name === 'string' && Number.isFinite(m.context_length)) {
        out[m.name] = m.context_length;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * ~/.pi/agent/models.json'a (gerekirse) appProxy yönetiminde bir provider
 * tanımı yazar. Kullanıcının kendi tanımı varsa (managedBy != appProxy)
 * dokunulmaz. models listesi: seçili model + presetler + canlı liste.
 */
export async function ensurePiCustomProvider(cfg, providerName, modelId) {
  const p = cfg.active(providerName);
  if (!p) return { error: `unknown provider: ${providerName}` };
  const endpoint = piCustomEndpoint(p);
  if (!endpoint) {
    return {
      error: `Pi custom provider, "${p.kind}" kind'ını desteklemiyor ` +
        '(desteklenenler: openai, anthropic, gemini, cohere)',
    };
  }
  if (!p.apiKeyEnv) return { error: `provider config has no apiKeyEnv: ${providerName}` };

  const modelsFile = piModelsFile();
  let doc = {};
  try {
    doc = JSON.parse(fs.readFileSync(modelsFile, 'utf8'));
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) doc = {};
  } catch {
    doc = {};
  }
  doc.providers ??= {};

  const existing = doc.providers[providerName];
  if (existing && existing.managedBy !== PI_MANAGED_MARKER) {
    // Kullanıcının kendi models.json tanımı: saygı göster, üzerine yazma.
    log.info('piCustomProvider.userOwned', { provider: providerName, modelsFile });
    return { managed: 'user', provider: providerName, model: modelId, modelsFile, endpoint };
  }

  // Kaydedilecek model ID'leri: seçili model + presetler + canlı keşif.
  const ids = new Set([String(modelId)]);
  const presets = cfg.models[providerName]?.presets ?? [];
  for (const preset of presets) if (preset?.id) ids.add(preset.id);
  try {
    const discovered = await discoverModels(cfg, providerName, { timeoutMs: 6000 });
    for (const id of discovered.ids) ids.add(id);
  } catch {
    // Keşif başarısızsa seçili model + presetlerle devam et.
  }

  const apiKey = cfg.apiKeyOf(p);
  let contextByModel = {};
  if (p.kind === 'cohere' && apiKey) {
    contextByModel = await cohereContextLengths(p, apiKey);
  }

  const models = [...ids].sort((a, b) => a.localeCompare(b)).map((id) => {
    const preset = presets.find((pr) => pr.id === id);
    const ctx = contextByModel[id] ?? PI_CONTEXT_DEFAULT;
    return {
      id,
      name: preset?.label ?? id,
      contextWindow: ctx,
      // API'nin model üst sınırını aşmamak için güvenli çıktı limiti.
      maxTokens: Math.min(PI_MAX_TOKENS_DEFAULT, ctx),
    };
  });

  doc.providers[providerName] = {
    name: `appProxy · ${providerName}`,
    baseUrl: endpoint.baseUrl,
    api: endpoint.api,
    ...(endpoint.authHeader ? { authHeader: true } : {}),
    apiKey: `$${p.apiKeyEnv}`,
    managedBy: PI_MANAGED_MARKER,
    models,
  };

  fs.mkdirSync(piAgentDir(), { recursive: true });
  fs.writeFileSync(modelsFile, JSON.stringify(doc, null, 2) + '\n');
  log.info('piCustomProvider.written', { provider: providerName, models: models.length, modelsFile });
  return { managed: PI_MANAGED_MARKER, provider: providerName, model: modelId, modelsFile, endpoint, wrote: true };
}

/**
 * Provider/model'i Pi tarafında nasıl karşılayacağımızı çözer:
 * yerleşik provider adı veya models.json'a yazılmış özel provider.
 * @returns {Promise<{piProvider: string, piModel: string, custom: boolean, setup?: object}|{error: string}>}
 */
export async function resolvePiTarget(cfg, providerName, modelId) {
  const native = piProviderName(providerName);
  if (native) {
    return { piProvider: native, piModel: normalizePiModelId(modelId), custom: false };
  }
  const setup = await ensurePiCustomProvider(cfg, providerName, modelId);
  if (setup.error) return { error: setup.error };
  return { piProvider: providerName, piModel: String(modelId), custom: true, setup };
}

/**
 * appProxy .env'sindeki anahtarı Pi'nin okuduğu ortam değişkenine çevirip
 * alt sürece aktarılacak env haritasını döndürür. (Pi .env dosyalarını
 * kendisi okumaz; anahtarın süreç ortamında bulunması gerekir.)
 */
export function piLaunchEnv(cfg, providerName, target) {
  const p = cfg.active(providerName);
  if (!p) return {};
  const apiKey = cfg.apiKeyOf(p);
  if (!apiKey) return {};
  const piEnvName = target.custom
    ? p.apiKeyEnv
    : (NATIVE_PI_ENV[target.piProvider] ?? p.apiKeyEnv);
  return { [piEnvName]: apiKey };
}

/**
 * Pre-flight: Pi kurulu mu + provider/model çözülebiliyor mu?
 * @returns {{available: boolean, requiresAuth?: boolean, reason?: string, error?: string, target?: object}}
 */
export async function checkPiAvailability(cfg, provider, modelId, signal) {
  let target;
  try {
    target = await resolvePiTarget(cfg, provider, modelId);
  } catch (err) {
    return { available: false, error: `Pi setup failed: ${err.message}` };
  }
  if (target.error) return { available: false, error: target.error };
  let parsed = null;
  let rawErr = null;
  try {
    const bin = detectPiBinary();
    const env = { ...process.env, ...piLaunchEnv(cfg, provider, target) };
    const out = execFileSync(
      bin,
      ['auth', 'check', '--provider', target.piProvider, '--model', target.piModel, '--json'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000, signal, env }
    ).trim();
    parsed = JSON.parse(out);
  } catch (err) {
    // `pi auth check` exit kodları: ready=0, not_ready=1, invalid=2.
    // execFileSync, sıfır olmayan çıkışta fırlatır; JSON yanıtı stdout'tadır.
    const stdout = (err.stdout?.toString() ?? '').trim();
    try {
      parsed = JSON.parse(stdout);
    } catch {
      rawErr = stdout || err.message;
    }
  }
  if (parsed?.status === 'ready') {
    return { available: true, requiresAuth: false, target };
  }
  if (parsed?.status === 'not_ready') {
    // Anahtar yok/pi'de oturum açılmamış: başlatılabilir ama 401 riski var.
    return { available: true, requiresAuth: true, reason: parsed.reason ?? 'not_ready', target };
  }
  // invalid (exit 2): provider/model çözümlenemedi veya pi durumu bozuk.
  return {
    available: false,
    reason: parsed?.reason ?? 'invalid_state',
    error: parsed
      ? `pi auth check -> ${JSON.stringify(parsed)}`
      : `pi auth check başarısız: ${rawErr ?? 'bilinmeyen hata'}`,
    target,
  };
}

/** Locate the Pi CLI binary. */
function detectPiBinary() {
  try {
    const bin = execFileSync('which', ['pi'], { encoding: 'utf8', stdio: 'pipe', timeout: 5000 }).trim();
    if (bin) return bin;
  } catch {}
  throw new Error('Pi CLI not found: install with "npm i -g @earendil-works/pi-coding-agent" or use "pi" on PATH');
}

/**
 * Pi CLI'ı seçilen provider/model ile başlatır. Proxy arkada çalışmaya devam
 * eder; Pi doğrudan sağlayıcının ucuna bağlanır.
 */
export async function launchPi(cfg, provider, modelId, cwd, signal) {
  const target = await resolvePiTarget(cfg, provider, modelId);
  if (target.error) throw new Error(target.error);

  const env = { ...process.env, ...piLaunchEnv(cfg, provider, target) };
  log.info('launchPi', {
    provider,
    piProvider: target.piProvider,
    model: target.piModel,
    custom: target.custom,
  });

  const managed = target.setup?.managed === PI_MANAGED_MARKER;
  console.log(
    `Pi CLI başlatılıyor (provider=${target.piProvider}${target.custom ? ' · appProxy özel tanımı' : ''}, model=${target.piModel})...`
  );
  if (managed) {
    console.log(`  Pi provider tanımı güncellendi: ${target.setup.modelsFile}`);
  } else if (target.setup?.managed === 'user') {
    console.log(`  Pi provider tanımı kullanıcının kendi tanımı: ${target.setup.modelsFile}`);
  }

  const bin = detectPiBinary();
  const args = ['--provider', target.piProvider, '--model', target.piModel];
  const pi = spawn(bin, args, { cwd, stdio: 'inherit', env });
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
  return new Promise((resolve) => pi.on('exit', (code) => resolve(code)));
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
    const check = await checkPiAvailability(cfg, provider, modelId, AbortSignal.timeout(30000));
    if (!check.available) {
      console.error(`HATA: Pi CLI provider/model'i çözemedi: ${check.error}`);
      console.error("  Pi tarafındaki provider/model listesi: pi --list-models");
      console.error('  (Proxy arkada çalışıyor: bin/proxy-run status)');
      process.exit(1);
    }
    if (check.requiresAuth) {
      const p = cfg.active(provider);
      console.error(`UYARI: Pi'de kimlik hazır değil (reason: ${check.reason}); ilk istekte 401 dönebilir.`);
      console.error(`  Çözüm: .env'de ${p?.apiKeyEnv ?? '<API anahtarı>'} ayarlayın — proxy-run bu anahtarı Pi'ye aktarır.`);
      console.error();
    }
    process.exit(await launchPi(cfg, provider, modelId, cwd, AbortSignal.timeout(0)) ?? 0);
  } catch (err) {
    console.error(`HATA: ${err.message}`);
    console.error('  (Proxy arkada çalışıyor: bin/proxy-run status)');
    process.exit(1);
  }
}
