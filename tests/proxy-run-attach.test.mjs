/**
 * `bin/proxy-run <isim>` ile çalışan bir proxy'ye YENİDEN BAĞLANMA davranışı:
 * istemciden (/exit) çıktıktan sonra aynı proxy'ye dönmek için kullanılır.
 * Yeni süreç başlatılmamalı, provider/model sorulmamalı, kayıtlı port ve model
 * kullanılmalı.
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
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'appproxy-attach-'));
  const appRoot = path.join(base, 'appProxy');
  const projectA = path.join(base, 'appNews');
  fs.mkdirSync(path.join(appRoot, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(appRoot, 'run', 'instances'), { recursive: true });
  fs.mkdirSync(path.join(appRoot, 'logs'), { recursive: true });
  fs.mkdirSync(projectA, { recursive: true });
  for (const file of ['proxy-run', 'claude-env.sh']) {
    fs.copyFileSync(path.join(repoRoot, 'bin', file), path.join(appRoot, 'bin', file));
    fs.chmodSync(path.join(appRoot, 'bin', file), 0o755);
  }
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { appRoot, projectA };
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

/**
 * /health yanıtlayan gerçek bir HTTP sunucusu; attach akışı bunu arar.
 * Ayrı bir süreçte çalışır: test `spawnSync` ile bloke olduğu için aynı
 * süreçteki sunucu isteği yanıtlayamaz.
 */
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

function runProxyRun(appRoot, cwd, args) {
  return spawnSync('bash', [path.join(appRoot, 'bin', 'proxy-run'), ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 20000,
  });
}

test('proxy-run <isim> çalışan proxy"ye bağlanır, yenisini başlatmaz', { skip }, async (t) => {
  const { appRoot, projectA } = makeSandbox(t);
  const port = await healthServer(t);
  const pid = fakeProxy(t, appRoot);
  addInstance(appRoot, 'pr3', { pid, project: projectA, port });

  const res = runProxyRun(appRoot, projectA, ['pr3', '--client', 'none']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Çalışan proxy'ye bağlanılıyor/);
  assert.match(res.stdout, /Örnek\s+: pr3/);
  assert.match(res.stdout, /Provider : nvidia/);
  assert.match(res.stdout, /Model\s+: test-model/);
  // Anthropic taban URL'i /v1 İÇERMEZ (Claude Code yolu kendisi ekler).
  assert.match(res.stdout, new RegExp(`Anthropic: http://127\\.0\\.0\\.1:${port}/nvidia\\b`));
  assert.doesNotMatch(res.stdout, /Anthropic: .*\/v1/);

  // Yeni süreç/örnek oluşmamalı.
  const instances = fs.readdirSync(path.join(appRoot, 'run', 'instances'));
  assert.deepEqual(instances, ['pr3']);
  assert.equal(fs.existsSync(path.join(appRoot, 'run', 'proxy-run.pid')), false);
  assert.equal(fs.existsSync(path.join(appRoot, 'run', 'proxy-run.port')), false);
});

test('proxy-run attach <isim> açık yazımla da bağlanır', { skip }, async (t) => {
  const { appRoot, projectA } = makeSandbox(t);
  const port = await healthServer(t);
  const pid = fakeProxy(t, appRoot);
  addInstance(appRoot, 'pr7', { pid, project: projectA, provider: 'gemini', model: 'gemini-x', port });

  const res = runProxyRun(appRoot, projectA, ['attach', 'pr7', '--client', 'none']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Örnek\s+: pr7/);
  assert.match(res.stdout, /Provider : gemini/);
  assert.match(res.stdout, new RegExp(`OpenAI\\s+: http://127\\.0\\.0\\.1:${port}/gemini/v1`));
});

test('olmayan isim hata verir ve çalışan örnekleri listeler', { skip }, async (t) => {
  const { appRoot, projectA } = makeSandbox(t);
  const port = await healthServer(t);
  const pid = fakeProxy(t, appRoot);
  addInstance(appRoot, 'pr3', { pid, project: projectA, port });

  const res = runProxyRun(appRoot, projectA, ['pr9', '--client', 'none']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /bilinmeyen provider: pr9/);
  assert.match(res.stderr, /Çalışan proxy örnekleri/);
  assert.match(res.stderr, /pr3/);
  assert.match(res.stderr, /bin\/proxy-run <isim>/);
});

test('health yanıt vermiyorsa istemci açılmaz', { skip }, async (t) => {
  const { appRoot, projectA } = makeSandbox(t);
  // Sunucu yok: kayıt var ama port dinlemiyor.
  const pid = fakeProxy(t, appRoot);
  addInstance(appRoot, 'pr3', { pid, project: projectA, port: 1 });

  const res = runProxyRun(appRoot, projectA, ['pr3', '--client', 'none']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /health yanıt vermiyor/);
  assert.doesNotMatch(res.stdout, /İstemci açılmadı/);
});

test('istemci seçimi terminal yokken --client ister', { skip }, async (t) => {
  const { appRoot, projectA } = makeSandbox(t);
  const port = await healthServer(t);
  const pid = fakeProxy(t, appRoot);
  addInstance(appRoot, 'pr3', { pid, project: projectA, port });

  // stdin boru (terminal değil): menü gösterilemez, net hata verilmeli.
  const res = runProxyRun(appRoot, projectA, ['pr3']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /terminal gerekli/);
  assert.match(res.stderr, /--client cline\|claude\|pi\|none/);
});
