/**
 * Yetkilendirme: boş PROXY_TOKEN eskiden "kimlik doğrulama kapalı" demekti.
 * Sunucu 0.0.0.0'a bağlandığında (veya bir tünel arkasına alındığında) bu, ağdaki
 * herkese upstream API anahtarlarını açıyordu. Artık loopback dışı istemciler
 * token yoksa reddediliyor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProxyToken, isLoopbackAddress, isLoopbackHost } from '../src/auth.mjs';

test('loopback adresleri tanınır', () => {
  for (const address of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1', 'localhost']) {
    assert.equal(isLoopbackAddress(address), true, address);
  }
  for (const address of ['192.168.1.10', '10.0.0.5', '::ffff:8.8.8.8', '']) {
    assert.equal(isLoopbackAddress(address), false, address);
  }
});

test('loopback host tespiti', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
  assert.equal(isLoopbackHost('::'), false);
});

test('token varsa yanlış token 401 alır', () => {
  assert.deepEqual(
    checkProxyToken({ token: 'abc', headers: { 'x-api-key': 'abc' }, remoteAddress: '127.0.0.1' }),
    { ok: true },
  );
  const rejected = checkProxyToken({ token: 'abc', headers: { 'x-api-key': 'xyz' }, remoteAddress: '127.0.0.1' });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 401);
  assert.match(rejected.message, /invalid proxy token/);
});

test('Bearer başlığı da kabul edilir', () => {
  assert.deepEqual(
    checkProxyToken({ token: 'abc', headers: { authorization: 'Bearer abc' }, remoteAddress: '10.0.0.2' }),
    { ok: true },
  );
});

test('token yokken loopback serbest, dış istemci reddedilir', () => {
  assert.deepEqual(checkProxyToken({ token: '', remoteAddress: '127.0.0.1' }), { ok: true });
  const rejected = checkProxyToken({ token: '', remoteAddress: '192.168.1.50' });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 401);
  assert.match(rejected.message, /PROXY_TOKEN/);
});
