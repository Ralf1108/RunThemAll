#!/usr/bin/env node
// Small static file server for local testing.
// Sends COOP/COEP headers so the multi-threaded build can use SharedArrayBuffer.
//
// Usage: node scripts/serve.mjs [--port 8080] [--no-coi]
//   --no-coi  omit the headers (behaves like GitHub Pages without service worker)

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const PORT = portIndex >= 0 ? Number(args[portIndex + 1]) : 8080;
const COI = !args.includes('--no-coi');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.gz': 'application/gzip',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (path !== ROOT && !path.startsWith(ROOT + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let info = await stat(path).catch(() => null);
    if (info?.isDirectory()) {
      path = join(path, 'index.html');
      info = await stat(path).catch(() => null);
    }
    if (!info) {
      res.writeHead(404).end('Not found');
      return;
    }
    const lastModified = new Date(Math.floor(info.mtimeMs / 1000) * 1000);
    const headers = {
      'Content-Type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache', // cache, but revalidate (like GitHub Pages after max-age)
      'Last-Modified': lastModified.toUTCString(),
    };
    if (COI) {
      headers['Cross-Origin-Opener-Policy'] = 'same-origin';
      headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
    }
    const since = Date.parse(req.headers['if-modified-since'] || '');
    if (since && since >= lastModified.getTime()) {
      delete headers['Content-Length'];
      res.writeHead(304, headers).end();
      return;
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(path).pipe(res);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
}).listen(PORT, () => {
  console.log(`Run Them All läuft auf http://localhost:${PORT}/  (COOP/COEP: ${COI ? 'an' : 'aus'})`);
});
