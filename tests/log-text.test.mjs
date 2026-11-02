import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger, formatTextLine } from '../src/log.mjs';

test('formatTextLine: key=value, quotes values with spaces, skips undefined', () => {
  const line = formatTextLine({ ts: 'T', level: 'error', event: 'request.failed', status: 404, message: 'not found', x: undefined });
  assert.equal(line, 'T ERROR request.failed status=404 message="not found"');
});

test('createLogger writes every event to PROXY_LOG_FILE', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'applog-'));
  const textFile = path.join(dir, 'x.log');
  const log = createLogger({ dir: path.join(dir, 'logs'), root: dir, echo: false, textFile });
  log.info('http.request', { path: '/a' });
  log.warn('model.fallback', { from: 'a', to: 'b' });
  const lines = fs.readFileSync(textFile, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /INFO\s+http\.request path=\/a$/);
  assert.match(lines[1], /WARN\s+model\.fallback from=a to=b$/);
});
