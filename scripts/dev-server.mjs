/**
 * 開発用の簡易サーバー（依存ライブラリなし）
 *   npm run dev  →  http://localhost:5173 を開く
 * PWAの動作確認は localhost であれば https でなくても Service Worker が動く。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path === '/' || path === '\\') path = '/index.html';
  const file = join(ROOT, path);

  try {
    const info = await stat(file);
    if (info.isDirectory()) throw new Error('dir');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...(path === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}),
    });
    res.end(body);
  } catch {
    // SPAなので未知のパスは index.html を返す
    try {
      res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' });
      res.end(await readFile(join(ROOT, 'index.html')));
    } catch {
      res.writeHead(404).end('Not found');
    }
  }
}).listen(PORT, () => {
  console.log(`TERRA 検収PWA: http://localhost:${PORT}`);
});
