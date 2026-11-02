/**
 * Log gizliliği: upstream hata gövdeleri prompt'u geri yansıtır (400
 * invalid_request_error tipik olarak mesajın kendisini döndürür). Gövdeyi
 * olduğu gibi loglamak "istek gövdeleri asla loglanmaz" sözünü bozuyordu.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeErrorMessage, upstreamBodyFields } from '../src/log.mjs';

test('gövde kapalıyken yalnızca boyut loglanır', () => {
  const fields = upstreamBodyFields('{"error":{"message":"gizli prompt"}}');
  assert.equal(fields.upstreamBody, '<omitted>');
  assert.equal(fields.upstreamBodyBytes, Buffer.byteLength('{"error":{"message":"gizli prompt"}}'));
  assert.equal(JSON.stringify(fields).includes('gizli prompt'), false);
});

test('PROXY_LOG_BODIES=1 iken gövde kırpılarak yazılır', () => {
  const body = 'x'.repeat(2000);
  const fields = upstreamBodyFields(body, { enabled: true, max: 100 });
  assert.equal(fields.upstreamBody.length, 100);
  assert.equal(fields.upstreamBodyBytes, 2000);
});

test('boş gövde için alan üretilmez', () => {
  assert.deepEqual(upstreamBodyFields(''), {});
  assert.deepEqual(upstreamBodyFields(undefined), {});
});

test('hata mesajındaki upstream gövdesi kırpılır', () => {
  const message = 'upstream 400: {"error":{"message":"messages.0.content: kullanıcı promptu burada"}}';
  const summary = summarizeErrorMessage(message);
  assert.equal(summary, 'upstream 400: <upstream body omitted>');
  assert.equal(summary.includes('promptu'), false);
});

test('düz metin upstream gövdesi de kırpılır (JSON olmayan kısa yanıt)', () => {
  // İlk sürüm yalnızca JSON/uzun gövdeleri kırpıyordu; kısa düz metin sızıyordu.
  const summary = summarizeErrorMessage('upstream 400: messages.0.content: GIZLI-PROMPT-42 geçersiz');
  assert.equal(summary.includes('GIZLI-PROMPT-42'), false);
  assert.equal(summary, 'upstream 400: <upstream body omitted>');
});

test('kısa ve düz metin hata mesajları korunur', () => {
  assert.equal(summarizeErrorMessage('upstream timeout after 600000ms'), 'upstream timeout after 600000ms');
  assert.equal(summarizeErrorMessage('unknown provider: foo'), 'unknown provider: foo');
});

test('gövde logu açıkken mesaj da tam gelir', () => {
  const message = 'upstream 400: {"error":"x"}';
  assert.equal(summarizeErrorMessage(message, { enabled: true }), message);
});
