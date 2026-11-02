import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = 8797;
async function withServer(fn) {
  const child = spawn('node', ['src/server.mjs', 'nvidia'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PROXY_PORT: String(PORT), DEFAULT_PROVIDER: 'nvidia', NVIDIA_API_KEY: 'x', PROXY_TOKEN: 'tok' },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    await fn();
  } finally {
    child.kill();
    await once(child, 'exit');
  }
}

test('a base URL ending in /v1 (…/nvidia/v1/v1/messages/count_tokens) is still routed, not 404', async () => {
  await withServer(async () => {
    const h = { 'x-api-key': 'tok', 'content-type': 'application/json' };
    const body = JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] });
    for (const path of ['/nvidia/v1/messages/count_tokens', '/nvidia/v1/v1/messages/count_tokens']) {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST', headers: h, body });
      assert.equal(r.status, 200, path);
    }
    const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
    assert.equal(typeof health.pid, 'number');
  });
});
