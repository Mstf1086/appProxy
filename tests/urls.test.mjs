/**
 * `urls` çıktısı kopyalanabilir olmalı: Anthropic SDK yola kendisi /v1/messages
 * ekler, taban URL'de /v1 varsa istek /<provider>/v1/v1/messages olur ve 404
 * döner ("selected model" hatası).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;

test('urls: anthropic tabanı /v1 içermez, openai tabanı içerir', () => {
  const out = execFileSync('node', ['src/cli.mjs', 'urls', 'nvidia'], { cwd: root, encoding: 'utf8' });
  const fields = Object.fromEntries(
    out
      .trim()
      .split('\t')
      .slice(1)
      .map((pair) => pair.split('=')),
  );
  assert.ok(fields.anthropic, `anthropic alanı yok: ${out}`);
  assert.equal(fields.anthropic.endsWith('/v1'), false, `anthropic tabanı /v1 içeriyor: ${fields.anthropic}`);
  assert.equal(fields.openai, `${fields.anthropic}/v1`);
  assert.match(fields.chat, /chat\/completions$/);
});
