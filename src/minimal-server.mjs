#!/usr/bin/env node
import http from 'node:http';

const log = {
  info: (msg, ...args) => process.stderr.write(`[INFO] ${msg} ${args.map(a => JSON.stringify(a)).join(' ')}\n`),
  error: (msg, ...args) => process.stderr.write(`[ERROR] ${msg} ${args.map(a => JSON.stringify(a)).join(' ')}\n`),
};

const port = 8790;
const host = '127.0.0.1';
const proxyToken = 'appproxy-local-dev';

const server = http.createServer((req, res) => {
  log.info('request', `${req.method} ${req.url}`);
  
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  
  if (req.method !== 'POST' || !req.url.includes('/v1/messages')) {
    sendError(res, 404, 'not found');
    return;
  }
  
  // Auth check
  const hdr = req.headers['x-api-key'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (hdr !== proxyToken) {
    sendError(res, 401, 'invalid proxy token');
    return;
  }
  
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    let parsed;
    try {
      parsed = JSON.parse(body || '{}');
    } catch {
      sendError(res, 400, 'invalid json');
      return;
    }
    log.info('received body', Object.keys(parsed).length, 'keys');
    sendSuccess(res, { status: 'ok', received: Object.keys(parsed).length });
  });
});

function sendError(res, status, message) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

function sendSuccess(res, body) {
  const payload = JSON.stringify(body);
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

server.listen(port, host, () => {
  log.info(`proxy listening on http://${host}:${port}`);
  process.stderr.write(`appProxy listening on http://${host}:${port}\n`);
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});