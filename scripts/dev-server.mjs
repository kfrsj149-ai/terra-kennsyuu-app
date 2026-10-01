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

/**
 * /api/* を Vercel のサーバーレス関数と同じように動かす。
 * 事前にシークレットを渡しておくこと：
 *   STRIPE_SECRET_KEY=sk_test_... LICENSE_SECRET=適当な長い文字列 npm run dev
 */
async function serveApi(req, res, name) {
  // 事務所端末・運営者コンソールの確認用：OFFICE_DEV=1 のときだけ、メモリ保存・サブスク常時有効で動かす（本番では使わない）
  if ((name === 'office' || name === 'ops') && process.env.OFFICE_DEV === '1' && !globalThis.__officeDevReady) {
    const { createOffice } = await import(new URL('../api/_office-core.js', import.meta.url));
    const { createOps } = await import(new URL('../api/_ops-core.js', import.meta.url));
    const { memoryStore } = await import(new URL('../api/_office-store.js', import.meta.url));
    const store = memoryStore();                       // 事務所と運営者が同じ保存先を見る
    (await import(new URL('../api/office.js', import.meta.url))).__setOfficeForTests(
      createOffice({ store, isSubscriptionActive: async () => true, getCustomerEmail: async () => 'dev@example.com',
        limits: { verifyVolume: process.env.OFFICE_DEV_NOVERIFY !== '1' } }));   // 材積の検算。確認用の適当な値を使うときだけ OFFICE_DEV_NOVERIFY=1
    (await import(new URL('../api/ops.js', import.meta.url))).__setOpsForTests(createOps({ store }));
    globalThis.__officeDevReady = true;
    console.log('事務所API・運営者API: 開発モード（メモリ保存・購入時メールは dev@example.com。再起動で消えます）');
  }
  const mod = await import(new URL(`../api/${name}.js`, import.meta.url)).catch(() => null);
  if (!mod?.default) {
    res.writeHead(404, { 'Content-Type': TYPES['.json'] }).end('{"ok":false,"error":"not_found"}');
    return;
  }
  // Vercel の res（Express風）に合わせた最小の橋渡し
  res.status = (code) => { res.statusCode = code; return res; };
  res.send = (body) => res.end(body);
  await mod.default(req, res);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');

  const api = path.match(/^\/api\/([a-z0-9-]+)$/i);
  if (api) {
    try {
      await serveApi(req, res, api[1]);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': TYPES['.json'] });
      res.end(JSON.stringify({ ok: false, error: 'server_error', message: String(err) }));
    }
    return;
  }
  if (path === '/' || path === '\\') path = '/index.html';
  let file = join(ROOT, path);

  try {
    let info = await stat(file);
    // ディレクトリなら中の index.html を返す（Vercelと同じ挙動にするため）
    if (info.isDirectory()) {
      file = join(file, 'index.html');
      info = await stat(file);
    }
    if (info.isDirectory()) throw new Error('dir');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      // 本番（vercel.json）と同じ表示のセキュリティ設定。画面が壊れないか手元で確かめるため
      ...(/^\/(office|ops)\//.test(path) ? { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'", 'X-Frame-Options': 'DENY' } : {}),
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
