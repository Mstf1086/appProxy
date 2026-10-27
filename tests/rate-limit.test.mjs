import test from 'node:test';
import assert from 'node:assert/strict';
import { UpstreamError } from '../src/errors.mjs';
import {
  parseRetryDelayMs,
  runWithRateLimitRetry,
  DEFAULT_RATE_LIMIT_WAIT_MS,
  DEFAULT_RATE_LIMIT_MAX_RETRIES,
  MAX_RATE_LIMIT_WAIT_MS,
} from '../src/rate-limit.mjs';

test('parseRetryDelayMs retry-after header (saniye) kullanır', () => {
  assert.equal(parseRetryDelayMs('limit', { 'retry-after': '45' }), 45000);
  assert.equal(parseRetryDelayMs('limit', { 'Retry-After': '0' }), 0);
});

test('parseRetryDelayMs süresiz Cohere mesajı null döner', () => {
  assert.equal(
    parseRetryDelayMs(
      '{"id":"275edf8b","message":"You are past the per-minute request limit for this model, please wait and try again later."}',
      {},
    ),
    null,
  );
});

test('parseRetryDelayMs metinden saniye çıkarır', () => {
  assert.equal(parseRetryDelayMs('please wait 42 seconds and try again', {}), 42000);
  assert.equal(parseRetryDelayMs('Rate limit exceeded: try again in 20s', {}), 20000);
  assert.equal(parseRetryDelayMs('please retry in 1.5 seconds', {}), 1500);
});

test('parseRetryDelayMs Gemini/protobuf retryDelay alanını okur', () => {
  assert.equal(parseRetryDelayMs('{"error":{"details":[{"retryDelay":"42s"}]}}', {}), 42000);
  assert.equal(parseRetryDelayMs('{"retry_delay": "7s"}', {}), 7000);
  assert.equal(parseRetryDelayMs('{"retryDelayMs": 5000}', {}), 5000);
});

test('parseRetryDelayMs Türkçe süre ifadelerini okur', () => {
  assert.equal(parseRetryDelayMs('Limit aşıldı: 30 saniye sonra tekrar deneyin', {}), 30000);
  assert.equal(parseRetryDelayMs('lütfen 5 sn bekleyip tekrar deneyin', {}), 5000);
});

test('parseRetryDelayMs dakika birimini çevirir', () => {
  assert.equal(parseRetryDelayMs('please wait 1 minute before retrying', {}), 60000);
});

test('parseRetryDelayMs üst sınırı uygular', () => {
  assert.equal(parseRetryDelayMs('x', { 'retry-after': '999' }), MAX_RATE_LIMIT_WAIT_MS);
  assert.equal(parseRetryDelayMs('please wait 999 seconds', {}), MAX_RATE_LIMIT_WAIT_MS);
});

test('parseRetryDelayMs ilgisiz sayıları yok sayar', () => {
  assert.equal(parseRetryDelayMs('model 8790 üzerinde 429 hatası', {}), null);
});

test('varsayılanlar 30 sn / 2 deneme', () => {
  assert.equal(DEFAULT_RATE_LIMIT_WAIT_MS, 30000);
  assert.equal(DEFAULT_RATE_LIMIT_MAX_RETRIES, 2);
});

test('runWithRateLimitRetry 429 sonrası bekleyip başarır', async () => {
  let calls = 0;
  const started = Date.now();
  const result = await runWithRateLimitRetry(
    async () => {
      calls += 1;
      if (calls < 3) {
        throw new UpstreamError('upstream 429: limit', { status: 429 });
      }
      return 'ok';
    },
    { maxRetries: 2, defaultWaitMs: 30, maxWaitMs: 30 },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  // İki bekleme: her biri en az defaultWaitMs kadar sürmeli.
  assert.ok(Date.now() - started >= 55, 'bekleme süreleri uygulanmalı');
});

test('runWithRateLimitRetry retry-after 0 ipucunda hemen dener', async () => {
  let calls = 0;
  const started = Date.now();
  await runWithRateLimitRetry(
    async () => {
      calls += 1;
      if (calls === 1) {
        throw new UpstreamError('upstream 429: limit', { status: 429, headers: { 'retry-after': '0' } });
      }
      return 'ok';
    },
    { maxRetries: 1, defaultWaitMs: 30000 },
  );
  assert.equal(calls, 2);
  assert.ok(Date.now() - started < 5000, 'upstream 0 sn dediği için beklememeli');
});

test('runWithRateLimitRetry upstream ipucundaki süreyi kullanır', async () => {
  let calls = 0;
  const started = Date.now();
  await runWithRateLimitRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw new UpstreamError('upstream 429: rate limit, please wait 2 seconds', { status: 429 });
      return 'ok';
    },
    { maxRetries: 1, defaultWaitMs: 5, maxWaitMs: 2000 },
  );
  // İpucu (2000ms) defaultWaitMs(5) yerine geçerli olmalı; ancak üst sınır maxWaitMs.
  assert.ok(Date.now() - started >= 2000, 'ipucu süresi beklenmeli');
});

test('runWithRateLimitRetry maxRetries aşılınca hatayı iletilir', async () => {
  let calls = 0;
  await assert.rejects(
    runWithRateLimitRetry(
      async () => {
        calls += 1;
        throw new UpstreamError('upstream 429: limit', { status: 429 });
      },
      { maxRetries: 2, defaultWaitMs: 1, maxWaitMs: 1 },
    ),
    (err) => err.status === 429,
  );
  assert.equal(calls, 3, '1 ilk deneme + 2 yeniden deneme');
});

test('runWithRateLimitRetry 429 olmayan hataları beklemeden iletir', async () => {
  let calls = 0;
  await assert.rejects(
    runWithRateLimitRetry(
      async () => {
        calls += 1;
        throw new UpstreamError('upstream 500: boom', { status: 500 });
      },
      { maxRetries: 3, defaultWaitMs: 1000 },
    ),
    (err) => err.status === 500,
  );
  assert.equal(calls, 1);
});

test('runWithRateLimitRetry UpstreamError olmayanları hemen iletir', async () => {
  let calls = 0;
  await assert.rejects(
    runWithRateLimitRetry(
      async () => {
        calls += 1;
        throw new Error('plain error');
      },
      { maxRetries: 3, defaultWaitMs: 1000 },
    ),
    /plain error/,
  );
  assert.equal(calls, 1);
});

test('runWithRateLimitRetry istemciye yazma başladıysa deneme yok', async () => {
  let calls = 0;
  const res = { headersSent: true, writableEnded: false };
  await assert.rejects(
    runWithRateLimitRetry(
      async () => {
        calls += 1;
        throw new UpstreamError('upstream 429: limit', { status: 429 });
      },
      { maxRetries: 3, defaultWaitMs: 1, maxWaitMs: 1, res },
    ),
    (err) => err.status === 429,
  );
  assert.equal(calls, 1, 'headersSent true iken yeniden denenmemeli');
});

test('runWithRateLimitRetry log.upstream.rateLimited yazar', async () => {
  const events = [];
  const log = { warn: (event, fields) => events.push({ event, fields }) };
  let calls = 0;
  await runWithRateLimitRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw new UpstreamError('upstream 429: limit', { status: 429 });
      return 'ok';
    },
    { log, provider: 'cohere', model: 'tiny-aya-global', maxRetries: 1, defaultWaitMs: 1, maxWaitMs: 1 },
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'upstream.rateLimited');
  assert.equal(events[0].fields.provider, 'cohere');
  assert.equal(events[0].fields.attempt, 1);
});
