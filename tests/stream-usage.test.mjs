/**
 * Akış kullanımı, keep-alive ve geri basınç.
 *
 * 1) `stream_options.include_usage` yalnızca SON chunk'ta `prompt_tokens`
 *    gönderir; bu yüzden `message_start` her zaman input_tokens=0 diyordu ve
 *    Claude Code bağlam penceresini yanlış hesaplıyordu.
 * 2) Uzun düşünen modellerde istemci boşta kalıp isteği iptal ediyordu; artık
 *    `event: ping` gönderiliyor.
 * 3) res.write() false döndüğünde okuma döngüsü durmalı (yavaş istemci =
 *    sınırsız bellek değil).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicStream } from '../src/sse.mjs';
import { OpenAiStreamAdapter } from '../src/translate/openai-in.mjs';

function fakeRes({ writeResult = true } = {}) {
  const chunks = [];
  const handlers = new Map();
  const res = {
    headersSent: false,
    writableEnded: false,
    write(chunk) {
      chunks.push(String(chunk));
      return writeResult;
    },
    writeHead() {
      res.headersSent = true;
    },
    end() {
      res.writableEnded = true;
    },
    on(event, fn) {
      const list = handlers.get(event) ?? [];
      list.push(fn);
      handlers.set(event, list);
    },
    emit(event) {
      for (const fn of handlers.get(event) ?? []) fn();
    },
    get body() {
      return chunks.join('');
    },
  };
  return res;
}

function parseEvents(body) {
  return body
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      return { event, data: data ? JSON.parse(data) : null };
    });
}

test('message_start tahmini input_tokens taşır, message_delta gerçek değeri düzeltir', () => {
  const res = fakeRes();
  const stream = new AnthropicStream(res);
  const adapter = new OpenAiStreamAdapter(stream, { requestedModel: 'claude-x', estimatedInputTokens: 1234 });

  adapter.feed({ id: 'c1', choices: [{ index: 0, delta: { content: 'merhaba' } }] });
  adapter.feed({ id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  // include_usage: son chunk'ta gerçek kullanım gelir.
  adapter.feed({ id: 'c1', choices: [], usage: { prompt_tokens: 1500, completion_tokens: 42 } });
  adapter.done();

  const events = parseEvents(res.body);
  const start = events.find((e) => e.event === 'message_start');
  const delta = events.find((e) => e.event === 'message_delta');

  assert.equal(start.data.message.usage.input_tokens, 1234, 'tahmin message_start’a yazılmalı');
  assert.equal(delta.data.usage.input_tokens, 1500, 'gerçek input_tokens message_delta’da düzeltilmeli');
  assert.equal(delta.data.usage.output_tokens, 42);
});

test('upstream kullanım bildirmezse message_delta’da input_tokens uydurulmaz', () => {
  const res = fakeRes();
  const stream = new AnthropicStream(res);
  const adapter = new OpenAiStreamAdapter(stream, { requestedModel: 'claude-x', estimatedInputTokens: 10 });
  adapter.feed({ id: 'c1', choices: [{ index: 0, delta: { content: 'a' }, finish_reason: 'stop' }] });
  adapter.done();

  const delta = parseEvents(res.body).find((e) => e.event === 'message_delta');
  assert.equal('input_tokens' in delta.data.usage, false);
});

test('boşta kalan akışta ping gönderilir, bitince durur', async () => {
  const res = fakeRes();
  const stream = new AnthropicStream(res);
  stream.writeHead();
  stream.startHeartbeat(20);
  await new Promise((resolve) => setTimeout(resolve, 70));
  const pings = parseEvents(res.body).filter((e) => e.event === 'ping');
  assert.ok(pings.length >= 2, `beklenen en az 2 ping, gelen ${pings.length}`);

  stream.finish({ stopReason: 'end_turn', outputTokens: 1 });
  const afterFinish = res.body.length;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(res.body.length, afterFinish, 'finish sonrası ping devam etmemeli');
});

test('geri basınç: write false dönünce throttle drain bekler', async () => {
  const res = fakeRes({ writeResult: false });
  const stream = new AnthropicStream(res);
  stream.send('message_start', { type: 'message_start' });
  assert.equal(stream.paused, true);

  let released = false;
  const waiting = stream.throttle({ timeoutMs: 5000 }).then(() => {
    released = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(released, false, 'drain gelmeden throttle çözülmemeli');

  res.emit('drain');
  await waiting;
  assert.equal(released, true);
  assert.equal(stream.paused, false);
});

test('geri basınç: istemci kaybolursa throttle takılı kalmaz', async () => {
  const res = fakeRes({ writeResult: false });
  const stream = new AnthropicStream(res);
  stream.send('message_start', { type: 'message_start' });
  const waiting = stream.throttle({ timeoutMs: 5000 });
  res.emit('close');
  await waiting; // close handler'ı serbest bırakmalı
  assert.equal(stream.paused, false);
});
