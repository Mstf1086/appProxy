/**
 * Gemini artık yerel :generateContent çevirisi yerine OpenAI uyumlu ucu
 * kullanıyor (docs/gemini/openai-compatibility.md). Bu test, araç tanımlarının
 * upstream'e ulaştığını ve tool_call yanıtının Anthropic tool_use bloğuna
 * çevrildiğini doğrular — eski kodda ikisi de kayboluyordu.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.mjs';
import { geminiChatHeaders, geminiChatUrl, handleGeminiProvider } from '../src/providers/gemini.mjs';

function fakeRes() {
  const chunks = [];
  const res = {
    headersSent: false,
    writableEnded: false,
    statusCode: 0,
    headers: {},
    writeHead(status, headers) {
      res.statusCode = status;
      res.headers = headers ?? {};
      res.headersSent = true;
    },
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
    end(chunk) {
      if (chunk) chunks.push(String(chunk));
      res.writableEnded = true;
    },
    on() {},
    once() {},
    off() {},
    get body() {
      return chunks.join('');
    },
  };
  return res;
}

const quietLog = { info() {}, warn() {}, error() {} };

function makeCtx(res) {
  const cfg = loadConfig();
  return {
    cfg,
    providerCfg: cfg.active('gemini'),
    apiKey: 'test-key',
    server: { upstreamTimeoutMs: 5000 },
    request: {
      model: 'gemini-3.8-flash',
      max_tokens: 1024,
      stream: false,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'dosyayı oku' }] }],
      tools: [
        {
          name: 'read_file',
          description: 'read a file',
          input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
      ],
    },
    meta: { systemText: 'sistem', requestedModel: 'claude-sonnet-5.5', provider: 'gemini' },
    log: quietLog,
    res,
    signal: null,
    sendJsonResponse(status, body, headers) {
      res.writeHead(status, { 'content-type': 'application/json', ...(headers ?? {}) });
      res.end(JSON.stringify(body));
    },
  };
}

test('gemini URL ve başlıkları OpenAI uyumlu ucu hedefler', () => {
  const cfg = loadConfig();
  const p = cfg.active('gemini');
  assert.equal(geminiChatUrl(p), 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  const headers = geminiChatHeaders('k', p);
  assert.equal(headers.authorization, 'Bearer k');
  assert.equal(headers['x-goog-api-key'], 'k');
});

test('araç tanımları Gemini’ye iletilir, tool_call yanıtı tool_use olur', async () => {
  const res = fakeRes();
  const ctx = makeCtx(res);
  const realFetch = globalThis.fetch;
  let captured = null;

  globalThis.fetch = async (url, opts) => {
    captured = { url: String(url), body: JSON.parse(opts.body), headers: opts.headers };
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gemini-3.8-flash',
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"/tmp/x"}' } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  try {
    await handleGeminiProvider(ctx);
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(captured.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(captured.body.model, 'gemini-3.8-flash');
  assert.equal(captured.body.tools.length, 1, 'araç tanımı upstream’e gitmedi');
  assert.equal(captured.body.tools[0].function.name, 'read_file');
  assert.equal(captured.body.messages[0].role, 'system');

  const message = JSON.parse(res.body);
  assert.equal(message.stop_reason, 'tool_use');
  assert.equal(message.model, 'claude-sonnet-5.5', 'istemciye istenen model adı dönmeli');
  const toolUse = message.content.find((block) => block.type === 'tool_use');
  assert.ok(toolUse, 'tool_use bloğu yok');
  assert.equal(toolUse.name, 'read_file');
  assert.deepEqual(toolUse.input, { path: '/tmp/x' });
  assert.equal(message.usage.input_tokens, 12);
});

test('akış yanıtı geçerli Anthropic SSE dizisine çevrilir', async () => {
  const res = fakeRes();
  const ctx = makeCtx(res);
  ctx.request.stream = true;
  const realFetch = globalThis.fetch;

  const events = [
    { id: 'c1', model: 'gemini-3.8-flash', choices: [{ index: 0, delta: { content: 'merhaba ' } }] },
    { id: 'c1', model: 'gemini-3.8-flash', choices: [{ index: 0, delta: { content: 'dünya' } }] },
    { id: 'c1', model: 'gemini-3.8-flash', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ];
  const sse = `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')}data: [DONE]\n\n`;

  globalThis.fetch = async () =>
    new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });

  try {
    await handleGeminiProvider(ctx);
  } finally {
    globalThis.fetch = realFetch;
  }

  const body = res.body;
  assert.match(body, /event: message_start/);
  assert.match(body, /event: content_block_delta/);
  assert.match(body, /merhaba /);
  assert.match(body, /event: message_delta/);
  assert.match(body, /event: message_stop/);
  // Sıra korunmalı: message_stop en sonda.
  assert.ok(body.lastIndexOf('message_stop') > body.lastIndexOf('message_delta'));
});
