/**
 * Regression: a multi-byte character split across two TCP chunks must survive.
 *
 * Before the fix `readBody` did `raw += chunk`, decoding every chunk on its own,
 * so a Turkish/Chinese character straddling a chunk boundary turned into U+FFFD
 * and the upstream received a corrupted prompt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const UPSTREAM_PORT = 8795;
const PROXY_PORT = 8796;

function startUpstream(received) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received.push(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'x',
          model: 'm',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
    });
  });
  return new Promise((resolve) => server.listen(UPSTREAM_PORT, '127.0.0.1', () => resolve(server)));
}

async function waitForHealth(url) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

test('bölünmüş çok baytlı karakterler bozulmadan upstream’e ulaşır', async () => {
  const received = [];
  const upstream = await startUpstream(received);
  const child = spawn('node', ['src/server.mjs', 'nvidia'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      PROXY_PORT: String(PROXY_PORT),
      DEFAULT_PROVIDER: 'nvidia',
      PROXY_TOKEN: 'tok',
      NVIDIA_MODE: 'nim',
      NIM_BASE_URL: `http://127.0.0.1:${UPSTREAM_PORT}`,
      NIM_API_KEY: 'not-used',
    },
    stdio: 'ignore',
  });

  try {
    assert.ok(await waitForHealth(`http://127.0.0.1:${PROXY_PORT}/health`), 'proxy başlamadı');

    const text = 'Türkçe: çğıöşü — 中文测试 🚀';
    const payload = Buffer.from(
      JSON.stringify({ model: 'm', messages: [{ role: 'user', content: text }] }),
      'utf8',
    );
    // Split in the middle of the first multi-byte character ("ü" = 2 bytes).
    const cut = payload.indexOf(Buffer.from('ü')) + 1;
    const head = payload.subarray(0, cut);
    const tail = payload.subarray(cut);

    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: PROXY_PORT,
          path: '/nvidia/v1/messages',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': 'tok',
            'content-length': payload.length,
          },
        },
        (res) => {
          res.resume();
          res.on('end', resolve);
        },
      );
      req.on('error', reject);
      req.write(head);
      // Separate TCP write => separate `data` event on the server side.
      setTimeout(() => {
        req.write(tail);
        req.end();
      }, 80);
    });

    assert.equal(received.length, 1, 'upstream isteği almadı');
    assert.equal(received[0].includes('\uFFFD'), false, 'bozuk karakter (U+FFFD) oluştu');
    const sent = JSON.parse(received[0]);
    assert.equal(sent.messages[0].content, text);
  } finally {
    child.kill();
    await once(child, 'exit');
    await new Promise((resolve) => upstream.close(resolve));
  }
});
