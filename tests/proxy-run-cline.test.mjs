/**
 * `--client cline`: proxy-run, Cline CLI'ı proxy'nin OpenAI uyumlu ucuna
 * yönlendirmeli. Cline `openai-compatible` sağlayıcısını kullanır ve baseUrl'i
 * ~/.cline altında saklar; bu yüzden `cline auth` her oturumda yeniden
 * çağrılmalı (port/örnek değişebilir).
 *
 * Test gerçek `cline` ikilisi yerine argümanları kaydeden bir vekil kullanır.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hasProc = fs.existsSync('/proc/self/cmdline');
const hasCurl = spawnSync('curl', ['--version'], { stdio: 'ignore' }).status === 0;
const skip = (!hasProc && '/proc yok') || (!hasCurl && 'curl yok');

function makeSandbox(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'appproxy-cline-'));
  const appRoot = path.join(base, 'appProxy');
  const projectA = path.join(base, 'appNews');
  const fakeBin = path.join(base, 'fakebin');
  fs.mkdirSync(path.join(appRoot, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(appRoot, 'run', 'instances'), { recursive: true });
  fs.mkdirSync(path.join(appRoot, 'logs'), { recursive: true });
  fs.mkdirSync(projectA, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  for (const file of ['proxy-run', 'claude-env.sh']) {
    fs.copyFileSync(path.join(repoRoot, 'bin', file), path.join(appRoot, 'bin', file));
    fs.chmodSync(path.join(appRoot, 'bin', file), 0o755);
  }
  // Sahte `cline`: çağrıyı satır olarak kaydeder, `auth` için başarı mesajı yazar.
  const argsLog = path.join(base, 'cline-args.log');
  const fake = path.join(fakeBin, 'cline');
  fs.writeFileSync(
    fake,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> '${argsLog}'\n` +
      `if [[ "\${1:-}" == "auth" ]]; then echo "Provider configured: openai-compatible (fake)"; fi\n` +
      `exit 0\n`,
  );
  fs.chmodSync(fake, 0o755);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { appRoot, projectA, fakeBin, argsLog };
}

function fakeProxy(t, cwd) {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', 'src/server.mjs'], {
    cwd,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  t.after(() => {
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch {
      /* zaten ölmüş */
    }
  });
  return child.pid;
}

/** Ayrı süreçte /health sunucusu: test spawnSync ile bloke olurken de yanıtlar. */
function healthServer(t) {
  const script = `
const http = require('http');
const s = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, {'content-type': 'application/json'}); res.end('{"status":"ok"}'); }
  else res.writeHead(404).end();
});
s.listen(0, '127.0.0.1', () => console.log(s.address().port));
`;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => {
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch {
      /* zaten ölmüş */
    }
  });
  return new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      const line = buf.split('\n')[0].trim();
      if (/^\d+$/.test(line)) resolve(Number(line));
    });
    child.on('error', reject);
  });
}

function addInstance(appRoot, name, { pid, project, provider = 'nvidia', model = 'test-model', port }) {
  const dir = path.join(appRoot, 'run', 'instances', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pid'), `${pid}\n`);
  fs.writeFileSync(path.join(dir, 'provider'), `${provider}\n`);
  fs.writeFileSync(path.join(dir, 'model'), `${model}\n`);
  fs.writeFileSync(path.join(dir, 'host'), '127.0.0.1\n');
  fs.writeFileSync(path.join(dir, 'port'), `${port}\n`);
  fs.writeFileSync(path.join(dir, 'project'), `${project}\n`);
}

function runProxyRun(appRoot, cwd, args, { fakeBin }) {
  return spawnSync('bash', [path.join(appRoot, 'bin', 'proxy-run'), ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
  });
}

test('--client cline: Cline proxy"nin OpenAI ucuna yönlendirilir', { skip }, async (t) => {
  const { appRoot, projectA, fakeBin, argsLog } = makeSandbox(t);
  const port = await healthServer(t);
  const pid = fakeProxy(t, appRoot);
  addInstance(appRoot, 'pr3', { pid, project: projectA, model: 'test-model', port });

  const res = runProxyRun(appRoot, projectA, ['pr3', '--client', 'cline'], { fakeBin });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Cline CLI başlıyor/);

  const calls = fs.readFileSync(argsLog, 'utf8').trim().split('\n');
  assert.equal(calls.length, 2, `beklenen 2 cline çağrısı, alınan: ${calls.join(' | ')}`);
  // 1) yapılandırma: openai-compatible + proxy taban URL'i + proxy token'ı
  assert.match(calls[0], /^auth openai-compatible /);
  assert.match(calls[0], new RegExp(`-b http://127\\.0\\.0\\.1:${port}/nvidia/v1( |$)`));
  assert.match(calls[0], /-m test-model( |$)/);
  assert.match(calls[0], /-k \S+/);
  // 2) oturum: aynı sağlayıcı ve model
  assert.match(calls[1], /^-P openai-compatible -m test-model$/);
});

test('--client doğrulaması cline değerini kabul eder, yazım hatasını reddeder', { skip }, async (t) => {
  const { appRoot, projectA, fakeBin } = makeSandbox(t);

  // Geçersiz değer: hata mesajı geçerli istemcileri (cline dahil) saymalı.
  const bad = runProxyRun(appRoot, projectA, ['pr3', '--client', 'cline2'], { fakeBin });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--client yalnızca cline, claude, pi veya none olabilir/);
});
