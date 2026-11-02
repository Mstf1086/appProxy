/**
 * `bin/proxy-run status` / `stop` davranışı: örnekler başlatıldıkları proje
 * diziniyle kaydedilir ve `stop` yalnızca o projenin proxy'lerini durdurur.
 *
 * Test, gerçek `src/server.mjs` süreci yerine komut satırında "src/server.mjs"
 * geçen uzun ömürlü bir node süreci kullanır; proxy-run süreçleri komut
 * satırından tanıdığı için bu yeterli.
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

function makeSandbox(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'appproxy-run-'));
  const appRoot = path.join(base, 'appProxy');
  const projectA = path.join(base, 'appNews');
  const projectB = path.join(base, 'otherProject');
  fs.mkdirSync(path.join(appRoot, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(appRoot, 'run', 'instances'), { recursive: true });
  fs.mkdirSync(path.join(appRoot, 'logs'), { recursive: true });
  fs.mkdirSync(projectA, { recursive: true });
  fs.mkdirSync(projectB, { recursive: true });
  for (const file of ['proxy-run', 'claude-env.sh']) {
    fs.copyFileSync(path.join(repoRoot, 'bin', file), path.join(appRoot, 'bin', file));
    fs.chmodSync(path.join(appRoot, 'bin', file), 0o755);
  }
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { appRoot, projectA, projectB };
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

function addInstance(appRoot, name, { pid, project, provider = 'nvidia', port = 8790 }) {
  const dir = path.join(appRoot, 'run', 'instances', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pid'), `${pid}\n`);
  fs.writeFileSync(path.join(dir, 'provider'), `${provider}\n`);
  fs.writeFileSync(path.join(dir, 'model'), 'test-model\n');
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

/**
 * Süreç yaşıyor mu? Zombiler "ölü" sayılır: test süreci `spawnSync` içinde
 * bloke olduğu için öldürülen çocuğu hemen toplayamaz ve `kill -0` zombiye
 * de başarılı döner.
 */
function alive(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    const state = stat.slice(close + 2, close + 3);
    if (state === 'Z') return false;
  } catch {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('status her örnek için başlatıldığı projeyi gösterir', { skip: !hasProc && '/proc yok' }, (t) => {
  const { appRoot, projectA, projectB } = makeSandbox(t);
  const pidA = fakeProxy(t, appRoot);
  const pidB = fakeProxy(t, appRoot);
  addInstance(appRoot, 'pr3', { pid: pidA, project: projectA });
  addInstance(appRoot, 'pr9', { pid: pidB, project: projectB, provider: 'gemini' });

  const res = runProxyRun(appRoot, projectA, ['status']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, new RegExp(`Proje\\s+: ${projectA}`));
  assert.match(res.stdout, new RegExp(`Proje\\s+: ${projectB}`));
  assert.match(res.stdout, /\[pr3\][^\n]*\(bu proje\)/);
  assert.match(res.stdout, /\[pr9\][^\n]*\(başka proje\)/);
  // Sunucunun çalıştığı dizin (repo kökü) projeden ayrı gösterilir.
  assert.match(res.stdout, new RegExp(`Dizin\\s+: ${appRoot}`));
});

test('stop yalnızca bu projenin proxy"sini durdurur', { skip: !hasProc && '/proc yok' }, (t) => {
  const { appRoot, projectA, projectB } = makeSandbox(t);
  const pidA = fakeProxy(t, appRoot);
  const pidB = fakeProxy(t, appRoot);
  addInstance(appRoot, 'pr3', { pid: pidA, project: projectA });
  addInstance(appRoot, 'pr9', { pid: pidB, project: projectB, provider: 'gemini' });

  const res = runProxyRun(appRoot, projectA, ['stop']);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(alive(pidA), false, 'bu projenin proxy si durdurulmalı');
  assert.equal(alive(pidB), true, 'başka projenin proxy si çalışmaya devam etmeli');
  assert.match(res.stdout, /başka projelerden başlatılmış 1 proxy'ye dokunulmadı/);
});

test('başka projenin örneği --force olmadan durdurulmaz', { skip: !hasProc && '/proc yok' }, (t) => {
  const { appRoot, projectA, projectB } = makeSandbox(t);
  const pidB = fakeProxy(t, appRoot);
  addInstance(appRoot, 'pr9', { pid: pidB, project: projectB });

  const refused = runProxyRun(appRoot, projectA, ['stop', 'pr9']);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /başka bir projeden başlatılmış/);
  assert.equal(alive(pidB), true);

  const forced = runProxyRun(appRoot, projectA, ['stop', 'pr9', '--force']);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(alive(pidB), false);
});

test('stop all proje ayrımı yapmadan tümünü durdurur', { skip: !hasProc && '/proc yok' }, (t) => {
  const { appRoot, projectA, projectB } = makeSandbox(t);
  const pidA = fakeProxy(t, appRoot);
  const pidB = fakeProxy(t, appRoot);
  addInstance(appRoot, 'pr3', { pid: pidA, project: projectA });
  addInstance(appRoot, 'pr9', { pid: pidB, project: projectB });

  const res = runProxyRun(appRoot, projectA, ['stop', 'all']);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(alive(pidA), false);
  assert.equal(alive(pidB), false);
});

test('proje kaydı olmayan eski örnek stop ile öldürülmez', { skip: !hasProc && '/proc yok' }, (t) => {
  const { appRoot, projectA } = makeSandbox(t);
  const pid = fakeProxy(t, appRoot);
  const dir = path.join(appRoot, 'run', 'instances', 'old');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pid'), `${pid}\n`);
  fs.writeFileSync(path.join(dir, 'provider'), 'nvidia\n');
  fs.writeFileSync(path.join(dir, 'model'), 'm\n');
  fs.writeFileSync(path.join(dir, 'host'), '127.0.0.1\n');
  fs.writeFileSync(path.join(dir, 'port'), '8790\n');

  const res = runProxyRun(appRoot, projectA, ['stop']);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(alive(pid), true, 'proje bilinmediği için dokunulmamalı');
  assert.match(res.stdout, /proje kaydı yok/);

  const status = runProxyRun(appRoot, projectA, ['status']);
  assert.match(status.stdout, /bilinmiyor \(eski kayıt/);
});
