#!/usr/bin/env node
/**
 * "Provider kaldır" sihirbazı.
 *
 * bin/proxy-run remove <ad> ve `node src/cli.mjs remove-provider <ad>` buraya düşer.
 *
 * Kurallar:
 *  - Tüm sorular stderr'e yazılır; stdout yalnızca makine satırı taşır
 *    (REMOVED_PROVIDER=<slug>, cli.mjs yazar) — bin/proxy-run ile aynı sözleşme.
 *  - Silme öncesi interaktif onay ister; onaylanmazsa hiçbir dosyaya dokunmaz.
 *  - .env'deki anahtar SATIRI kaldırılır; anahtarın değeri asla yazdırılmaz.
 *  - Temizlenen dosyalar: config/providers.json, config/models.json,
 *    .env (KEY= satırı) ve .env.example (KEY= satırı + üstündeki yorum).
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { ROOT } from './config.mjs';
import { WizardInputClosedError } from './add-provider.mjs';

/**
 * .env/.env.example metninden `key=` satırını kaldırır.
 * commentPrefix verilirse, anahtarın hemen üstündeki `# <slug> (...)` yorumu da silinir
 * (sihirbaz .env.example'e bu biçimde yorum + satır ekler).
 */
export function removeEnvLine(text, key, { commentPrefix = '' } = {}) {
  const lines = String(text ?? '').split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    if (line.startsWith(`${key}=`)) {
      if (commentPrefix && kept.length && kept[kept.length - 1].startsWith(`# ${commentPrefix} (`)) {
        kept.pop();
      }
      continue;
    }
    kept.push(line);
  }
  const out = kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '');
  return out ? `${out}\n` : '';
}

/**
 * Bir provider'ı tüm config dosyalarından kaldırır (onay wizard içinde alınır).
 * @returns {{ok: true, name: string, apiKeyEnv: string, hadModels: boolean}|
 *           {ok: false, error: string}}
 */
export function removeProvider({ root = ROOT, name, config } = {}) {
  if (!name) return { ok: false, error: 'provider adı gerekli' };
  const providerCfg = config?.providers?.[name];
  if (!providerCfg) return { ok: false, error: `bilinmeyen provider: ${name}` };

  const rootDir = config?.root ?? root;
  const apiKeyEnv = providerCfg.apiKeyEnv ?? '';

  const providersPath = path.join(rootDir, 'config', 'providers.json');
  const providersFile = JSON.parse(fs.readFileSync(providersPath, 'utf8'));
  delete providersFile.providers[name];
  fs.writeFileSync(providersPath, `${JSON.stringify(providersFile, null, 2)}\n`);

  const modelsPath = path.join(rootDir, 'config', 'models.json');
  const modelsFile = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
  const hadModels = Boolean(modelsFile[name]);
  delete modelsFile[name];
  fs.writeFileSync(modelsPath, `${JSON.stringify(modelsFile, null, 2)}\n`);

  for (const [file, opts] of [
    [path.join(rootDir, '.env'), {}],
    [path.join(rootDir, '.env.example'), { commentPrefix: name }],
  ]) {
    if (apiKeyEnv && fs.existsSync(file)) {
      fs.writeFileSync(file, removeEnvLine(fs.readFileSync(file, 'utf8'), apiKeyEnv, opts));
    }
  }

  return { ok: true, name, apiKeyEnv, hadModels };
}

/**
 * İnteraktif kaldırma sihirbazı. stdin/stdout parametreleri test edilebilirlik içindir.
 * @returns {Promise<{name: string}|null>}
 */
export async function runRemoveWizard({ input = process.stdin, output = process.stderr, cfg, name = '' } = {}) {
  const config = cfg ?? (await import('./config.mjs')).loadConfig();
  const say = (text = '') => output.write(`${text}\n`);
  const names = Object.keys(config.providers ?? {});

  const terminal = Boolean(input.isTTY && output.isTTY);
  const rl = readline.createInterface({ input, output, terminal });

  // add-provider.mjs'dekiyle aynı koruma: Node v24'te promise-tarzı question()
  // bozuk (anında `undefined` çözer), stdin EOF'ta callback-tarzı sorular hiç
  // çözülmez. Bu yüzden callback-tarzı + `close` yarıştırması kullanıyoruz.
  let inputClosed = false;
  const closed = new Promise((resolve) => {
    rl.once('close', () => {
      inputClosed = true;
      resolve();
    });
  });
  const questionOnce = (prompt) => new Promise((resolve) => rl.question(prompt, (answer) => resolve(answer)));
  async function askOnce(question) {
    if (inputClosed) throw new WizardInputClosedError();
    const raw = await Promise.race([questionOnce(`${question} `), closed]);
    if (raw === undefined || inputClosed) throw new WizardInputClosedError();
    return String(raw ?? '').trim();
  }

  try {
    let slug = String(name ?? '').trim();
    if (!slug) {
      if (!names.length) {
        say('Kaldırılacak provider yok.');
        return null;
      }
      say('Kaldırılacak provider:');
      names.forEach((n, i) => say(`  ${i + 1}) ${n}`));
      say('');
      for (;;) {
        const answer = await askOnce('Numara veya ad (boş = vazgeç):');
        if (!answer) {
          say('Vazgeçildi.');
          return null;
        }
        if (/^\d+$/.test(answer)) {
          const n = Number(answer);
          if (n >= 1 && n <= names.length) {
            slug = names[n - 1];
            break;
          }
          say(`  HATA: 1-${names.length} arasında bir numara gir.`);
          continue;
        }
        if (!names.includes(answer)) {
          say(`  HATA: bilinmeyen provider: ${answer}`);
          continue;
        }
        slug = answer;
        break;
      }
    } else if (!names.includes(slug)) {
      say(`HATA: bilinmeyen provider: ${slug}`);
      if (names.length) say(`Geçerli adlar: ${names.join(' ')}`);
      return null;
    }

    const p = config.providers[slug];
    say('');
    say('--- Kaldırılacak ---');
    say(`  Ad       : ${slug}`);
    say(`  Kind     : ${p?.kind ?? '?'}`);
    say(`  Base URL : ${p?.baseUrl ?? '?'}`);
    say(`  Anahtar  : ${p?.apiKeyEnv ?? '?'} (.env satırı silinecek; değer gösterilmez)`);
    say(`  Model bl.: ${config.models?.[slug] ? 'var (config/models.json)' : 'yok'}`);
    say('');

    const confirm = await askOnce('Silinsin mi? [e/H]'); // boş = HAYIR
    if (!confirm.toLowerCase().startsWith('e')) {
      say('Vazgeçildi; hiçbir dosyaya dokunulmadı.');
      return null;
    }

    const result = removeProvider({ name: slug, config });
    if (!result.ok) {
      say(`  HATA: ${result.error}`);
      return null;
    }
    say('');
    say(`Provider kaldırıldı: ${slug}`);
    say('  config/providers.json bloğu silindi');
    if (result.hadModels) say('  config/models.json bloğu silindi');
    if (result.apiKeyEnv) say(`  .env / .env.example: ${result.apiKeyEnv} satırı silindi`);
    say('  Not: çalışan proxy bu provider ile ayaktaysa yeniden başlat: bin/proxy-run stop');
    say('');
    return { name: slug };
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
