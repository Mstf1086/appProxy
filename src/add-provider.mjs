#!/usr/bin/env node
/**
 * "Yeni provider ekle" sihirbazı.
 *
 * bin/proxy-run provider menüsündeki "+ yeni provider ekle" seçeneği ve
 * `node src/cli.mjs add-provider` buraya düşer.
 *
 * Kurallar:
 *  - Tüm sorular stderr'e yazılır; stdout yalnızca makine satırı taşır
 *    (ADDED_PROVIDER=<slug>, cli.mjs yazar) — böylece bin/proxy-run yakalarken
 *    sorular terminalde görünür.
 *  - API anahtarı gizli girilir, yalnızca .env'e yazılır; ekrana/loga asla yazılmaz.
 *  - Kaydetmeden önce upstream /models denenir; liste gelirse varsayılan/hızlı model
 *    o listeden seçilir (kullanıcı isteği: anahtar girildikten sonra model ekranında
 *    yeni provider'ın modelleri listelenir).
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { ROOT } from './config.mjs';
import { discoverModels } from './models.mjs';

const PROVIDER_NAME_RE = /^[a-z0-9_-]+$/;
const KINDS = { 1: 'openai', 2: 'anthropic', 3: 'gemini', 4: 'cohere' };

/**
 * Sihirbaz girişi kapanınca (Ctrl+D / pipe EOF) fırlatılır.
 *
 * Node v24'te promise-tarzı `rl.question()` cevabı beklemeden `undefined`
 * çözülür ve stdin EOF'ta callback-tarzı sorular hiç çözülmez; ikisi de
 * yakalanmazsa validate döngüsü sonsuza dek döner ya da sihirbaz asılı
 * kalır. runWizard bu hatayı yakalayıp kontrollü biçimde null döner.
 */
export class WizardInputClosedError extends Error {
  constructor(message = 'giriş akışı kapandı (Ctrl+D / EOF)') {
    super(message);
    this.name = 'WizardInputClosedError';
    this.code = 'APPPROXY_WIZARD_INPUT_CLOSED';
  }
}

/** Slug doğrulaması: küçük harf/rakam/-/_ ve mevcut isimlerle çakışma. */
export function validateProviderName(name, existingNames = []) {
  const slug = String(name ?? '').trim().toLowerCase();
  if (!slug) return { ok: false, error: 'ad boş olamaz' };
  if (!PROVIDER_NAME_RE.test(slug)) {
    return { ok: false, error: 'yalnızca küçük harf, rakam, - ve _ kullanılabilir' };
  }
  if (existingNames.includes(slug)) {
    return { ok: false, error: `'${slug}' zaten tanımlı` };
  }
  return { ok: true, slug };
}

/**
 * Keşfedilen model kimliklerinden satıcı öneklerini çıkarır (deepseek/, z-ai/, ...).
 * passthroughPrefixes önerisi olarak kullanılır: istemci sağlayıcının gerçek
 * model kimliğini verdiğinde '*' kuralı onu varsayılan modele eşlemesin.
 */
export function derivePassthroughPrefixes(modelIds = [], { max = 12 } = {}) {
  const prefixes = [
    ...new Set(
      modelIds
        .map((id) => String(id ?? ''))
        .filter((id) => id.includes('/'))
        .map((id) => `${id.split('/')[0]}/`),
    ),
  ];
  return prefixes.slice(0, max);
}

/** Base URL normalizasyonu. openai kind'da /v1 eksikse eklenmeyi önerir. */
export function normalizeBaseUrl(raw, kind) {
  let url = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!url) return { url: '', appended: false };
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (kind === 'openai' && !/\/v\d+$/.test(url)) {
    return { url: `${url}/v1`, appended: true };
  }
  return { url, appended: false };
}

/** kind'a göre provider bloğu (config/providers.json'a yazılacak). */
export function buildProviderBlock({
  name,
  kind,
  baseUrl,
  apiVersion,
  apiKeyEnv,
  defaultModel,
  fastModel,
  extraHeaders,
}) {
  const block = { kind, baseUrl, apiKeyEnv };
  if (kind === 'gemini') {
    block.apiVersion = apiVersion || 'v1beta';
    block.maxOutputTokens = 65536;
    block.thinking = { mode: 'auto', budgetTokens: 8192, includeThoughts: false };
    block.safetySettings = [];
  }
  if (kind === 'openai') {
    block.maxTokensField = 'max_tokens';
    block.streamIncludeUsage = true;
    block.mapReasoningToThinking = true;
  }
  if (defaultModel) block.defaultModel = defaultModel;
  if (fastModel) block.fastModel = fastModel;
  if (extraHeaders && Object.keys(extraHeaders).length > 0) block.extraHeaders = extraHeaders;
  block.docNote = `${name}: sihirbaz ile eklendi (bin/proxy-run)`;
  return block;
}

/** config/models.json bloğu: kurallar + presetler. */
export function buildModelsBlock({ defaultModel, fastModel, presets = [], passthroughPrefixes = [] }) {
  const rules = [];
  if (fastModel) rules.push({ match: '*haiku*', model: fastModel });
  rules.push({ match: '*', model: defaultModel });
  const ids = [...new Set([defaultModel, fastModel, ...presets].filter(Boolean))];
  return {
    passthroughPrefixes,
    rules,
    presets: ids.map((id) => ({ id, label: id, description: 'sihirbaz ile eklendi' })),
  };
}

/** .env / .env.example içinde bir KEY= satırını güncelle; yoksa sona ekle. */
export function upsertEnvLine(text, key, value) {
  const lines = String(text ?? '').split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  const entry = `${key}=${value ?? ''}`;
  if (index !== -1) {
    lines[index] = entry;
  } else {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push('', entry);
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

/**
 * İnteraktif sihirbaz. stdin/stdout parametreleri test edilebilirlik içindir.
 * @returns {Promise<{name,kind,baseUrl,apiKeyEnv,defaultModel,fastModel}|null>}
 */
export async function runWizard({ input = process.stdin, output = process.stderr, cfg } = {}) {
  const config = cfg ?? (await import('./config.mjs')).loadConfig();
  const root = config.root ?? ROOT;
  const say = (text = '') => {
    output.write(`${text}\n`);
  };

  const terminal = Boolean(input.isTTY && output.isTTY);
  const rl = readline.createInterface({ input, output, terminal });
  const realOutput = rl.output;
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });

  // İki Node v24 tuzağına karşı koruma:
  //  1) Promise-tarzı `rl.question()` (callback'siz) Node v24'te bozuk: cevap
  //     beklemeden anında `undefined` ile çözülür (prompt hiç yazılmaz).
  //     `String(undefined)` = "undefined" geçerli slug olduğundan sihirbaz
  //     görünmez cevaplarla ilerler ve Kind adımında sonsuz validate döngüsüne
  //     girip heap OOM ile çöker ("HATA: 1, 2 veya 3 gir" seli).
  //     -> Bu yüzden question'ı callback-tarzı kullanıp kendimiz promise'a sarıyoruz.
  //  2) stdin EOF (Ctrl+D / kapanan pipe): pending callback-question hiç
  //     çözülmez, sihirbaz sonsuza dek asılı kalır.
  //     -> Her soruyu `close` olayıyla yarıştırıp EOF'u kontrollü iptal sayıyoruz.
  let inputClosed = false;
  const closed = new Promise((resolve) => {
    rl.once('close', () => {
      inputClosed = true;
      resolve();
    });
  });

  function questionOnce(prompt) {
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => resolve(answer));
    });
  }

  async function askOnce(question) {
    if (inputClosed) throw new WizardInputClosedError();
    const raw = await Promise.race([questionOnce(`${question} `), closed]);
    if (raw === undefined || inputClosed) throw new WizardInputClosedError();
    return String(raw ?? '').trim();
  }

  async function ask(question, { validate } = {}) {
    for (;;) {
      const answer = await askOnce(question);
      if (!validate) return answer;
      const error = validate(answer);
      if (!error) return answer;
      say(`  HATA: ${error}`);
    }
  }

  async function askSecret(question) {
    if (inputClosed) throw new WizardInputClosedError();
    // Prompt'u mute ETMEDEN gerçek çıktıya yaz: readline prompt'u rl.output'a
    // (yani muted'a) yazdığı için soru ekranda hiç görünmüyor ve sihirbaz
    // "takılıyor" sanılıyordu. Yalnızca girilen karakterler maskelenir.
    output.write(`${question} `);
    rl.output = muted;
    let raw;
    try {
      raw = await Promise.race([questionOnce(''), closed]);
    } finally {
      rl.output = realOutput;
      say();
    }
    if (raw === undefined || inputClosed) throw new WizardInputClosedError();
    return String(raw ?? '').trim();
  }

  async function pickFromList(label, ids, { optional = false } = {}) {
    for (;;) {
      const answer = await ask(`${label} (numara veya kimlik)${optional ? ' [boş = yok]' : ' [1]'}:`);
      if (!answer) {
        if (optional) return '';
        return ids[0];
      }
      if (/^\d+$/.test(answer)) {
        const n = Number(answer);
        if (n >= 1 && n <= ids.length) return ids[n - 1];
        say(`  HATA: 1-${ids.length} arasında bir numara gir.`);
        continue;
      }
      return answer;
    }
  }

  try {
    say('Yeni provider ekleme (vazgeçmek için Ctrl+C)');
    say('');

    const existingNames = Object.keys(config.providers ?? {});
    const slug = await ask('Provider adı (slug, örn. deepseek):', {
      validate: (a) => {
        const result = validateProviderName(a, existingNames);
        return result.ok ? null : result.error;
      },
    });

    const kindAnswer = await ask(
      'Kind: 1) openai (chat/completions)  2) anthropic (/v1/messages)  3) gemini  4) cohere (/v2/chat) [1]:',
      {
        validate: (a) => (!a || KINDS[a] ? null : '1, 2, 3 veya 4 gir'),
      },
    );
    const kind = KINDS[kindAnswer || '1'];

    const rawUrl = await ask('Base URL:', { validate: (a) => (a ? null : 'boş olamaz') });
    const normalized = normalizeBaseUrl(rawUrl, kind);
    let baseUrl = normalized.url;
    if (normalized.appended) {
      const confirm = await ask(`OpenAI-uyumlu base URL genelde /v1 ile biter: "${baseUrl}" kullanılsın mı? [E/h]`);
      if (confirm.toLowerCase().startsWith('h')) baseUrl = rawUrl.replace(/\/+$/, '');
    }

    const apiVersion = kind === 'gemini' ? (await ask('API sürümü [v1beta]:') || 'v1beta') : undefined;

    const apiKeyEnv = `${slug.toUpperCase().replace(/-/g, '_')}_API_KEY`;
    const apiKey = await askSecret(`API anahtarı (${apiKeyEnv}, gizli; boş = şimdi değil):`);

    // Kaydetmeden önce upstream model listesini dene.
    let modelIds = [];
    let discoveryNote = '';
    if (apiKey) {
      say('');
      say('Model listesi getiriliyor...');
      const tempProviderCfg = buildProviderBlock({ name: slug, kind, baseUrl, apiVersion, apiKeyEnv });
      const tempCfg = {
        root,
        providers: {},
        models: {},
        active: () => tempProviderCfg,
        apiKeyOf: () => apiKey,
      };
      const result = await discoverModels(tempCfg, slug, { timeoutMs: 8000, useCache: false });
      modelIds = result.ids;
      if (modelIds.length) {
        say(`  ${modelIds.length} model bulundu.`);
      } else {
        discoveryNote = result.error ?? 'liste boş geldi';
      }
    } else {
      discoveryNote = 'API anahtarı girilmedi';
    }

    let defaultModel = '';
    let fastModel = '';
    if (modelIds.length) {
      say('');
      modelIds.forEach((id, i) => say(`  ${i + 1}) ${id}`));
      say('');
      defaultModel = await pickFromList('Varsayılan model', modelIds);
      fastModel = await pickFromList('Hızlı model', modelIds, { optional: true });
    } else {
      say(`  Model listesi alınamadı (${discoveryNote}); model kimliğini elle gireceksin.`);
      defaultModel = await ask('Varsayılan model kimliği:', { validate: (a) => (a ? null : 'boş olamaz') });
      fastModel = await ask('Hızlı model (boş = yok):');
    }

    // Öneri: keşfedilen TÜM satıcı önekleri. Böylece kullanıcı sağlayıcının gerçek
    // model kimliğini (ör. deepseek/deepseek-v4.1-flash:free) istediğinde '*'
    // kuralı onu varsayılan (ücretli) modele eşlemez; model aynen geçer.
    const suggestedPrefixes = derivePassthroughPrefixes([defaultModel, fastModel, ...modelIds]);
    const prefixAnswer = await ask(
      `Model önekleri — passthrough (virgülle; boş = önerilenler) [${suggestedPrefixes.join(',') || 'yok'}]:`,
    );
    const passthroughPrefixes = prefixAnswer
      ? [
          ...new Set(
            prefixAnswer
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
              .map((item) => (item.endsWith('/') ? item : `${item}/`)),
          ),
        ]
      : suggestedPrefixes;

    const headersAnswer = await ask("Ekstra header'lar (JSON, boş = yok):");
    let extraHeaders;
    if (headersAnswer) {
      try {
        extraHeaders = JSON.parse(headersAnswer);
      } catch {
        say('  HATA: geçersiz JSON; ekstra header yok sayıldı.');
      }
    }

    say('');
    say('--- Özet ---');
    say(`  Ad        : ${slug}`);
    say(`  Kind      : ${kind}`);
    say(`  Base URL  : ${baseUrl}`);
    if (apiVersion) say(`  Sürüm     : ${apiVersion}`);
    say(`  Anahtar   : ${apiKey ? 'girildi (.env\'e yazılacak)' : 'girilmedi (.env satırı boş kalır)'}`);
    say(`  Modeller  : ${defaultModel}${fastModel ? ` / hızlı: ${fastModel}` : ''}`);
    say(`  Önekler   : ${passthroughPrefixes.join(', ') || '-'}`);

    const confirmSave = await ask('Kaydedilsin mi? [E/h]');
    if (confirmSave.toLowerCase().startsWith('h')) {
      say('Vazgeçildi.');
      return null;
    }

    const providersPath = path.join(root, 'config', 'providers.json');
    const modelsPath = path.join(root, 'config', 'models.json');
    const envPath = path.join(root, '.env');
    const envExamplePath = path.join(root, '.env.example');

    const providersFile = JSON.parse(fs.readFileSync(providersPath, 'utf8'));
    providersFile.providers[slug] = buildProviderBlock({
      name: slug,
      kind,
      baseUrl,
      apiVersion,
      apiKeyEnv,
      defaultModel,
      fastModel,
      extraHeaders,
    });
    fs.writeFileSync(providersPath, `${JSON.stringify(providersFile, null, 2)}\n`);

    const modelsFile = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
    modelsFile[slug] = buildModelsBlock({
      defaultModel,
      fastModel,
      presets: modelIds.slice(0, 8),
      passthroughPrefixes,
    });
    fs.writeFileSync(modelsPath, `${JSON.stringify(modelsFile, null, 2)}\n`);

    const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    fs.writeFileSync(envPath, upsertEnvLine(envText, apiKeyEnv, apiKey));

    if (fs.existsSync(envExamplePath)) {
      const envExampleText = fs.readFileSync(envExamplePath, 'utf8');
      if (new RegExp(`^${apiKeyEnv}=`, 'm').test(envExampleText)) {
        fs.writeFileSync(envExamplePath, upsertEnvLine(envExampleText, apiKeyEnv, ''));
      } else {
        const base = envExampleText.replace(/\n+$/, '');
        fs.writeFileSync(envExamplePath, `${base}\n\n# ${slug} (${baseUrl})\n${apiKeyEnv}=\n`);
      }
    }

    say('');
    say(`Provider eklendi: ${slug}`);
    say(`Model listesi : bin/proxy-run ${slug} --list`);
    say(`Doğrulama    : npm run doctor`);
    say('');
    return { name: slug, kind, baseUrl, apiKeyEnv, defaultModel, fastModel };
  } catch (err) {
    if (err instanceof WizardInputClosedError) {
      say('');
      say('  Sihirbaz iptal edildi: giriş akışı kapandı (Ctrl+D / EOF).');
      return null;
    }
    throw err;
  } finally {
    rl.close();
  }
}
