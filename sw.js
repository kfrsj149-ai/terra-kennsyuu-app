/**
 * Service Worker（オフラインファーストPWAの要）
 * 圏外でもアプリ本体（HTML/CSS/JS）が確実に読み込めるようにする。
 *
 * 【姉妹PWA（免税軽油管理PWA）で確認済みの不具合への対策】
 * クエリパラメータ付きURL（例 /?ticket=123）がキャッシュにヒットせず、
 * オフライン時にフォールバック画面になってしまう問題があった。
 * 本SWでは
 *   - ナビゲーション要求は必ず index.html を返す（URLのクエリを問わない）
 *   - cache.match に ignoreSearch: true を付ける
 * の2点で確実に回避している。
 *
 * 【リダイレクトされた応答について】
 * 配信側の設定（Vercelの cleanUrls など）で /index.html が別URLへリダイレクトされると、
 * その応答をそのままキャッシュしてもナビゲーションには使えず、圏外で真っ白になる。
 * 実際に再現して確認済みのため、キャッシュに入れる前に必ず素の応答へ作り直している。
 */

/**
 * リダイレクト経由で得た応答を、キャッシュから配信できる素の応答に作り直す。
 * @param {Response} response
 * @returns {Promise<Response>}
 */
/**
 * ディレクトリ形式のURL（/legal/terms/）を、実体のファイル（/legal/terms/index.html）に対応づける。
 * 末尾のスラッシュの有無で取りこぼさないようにするためのもの。
 * @param {Request} request
 * @returns {string}
 */
function indexOf(request) {
  const url = new URL(request.url);
  url.search = '';
  url.hash = '';
  if (url.pathname.endsWith('/')) return `${url.pathname}index.html`;
  if (!url.pathname.split('/').pop().includes('.')) return `${url.pathname}/index.html`;
  return url.pathname;
}

async function toCacheable(response) {
  if (!response.redirected) return response;
  const body = await response.arrayBuffer();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
const VERSION = 'terra-kennsyuu-v5';
const CACHE = `${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './legal/legal.css',
  './legal/index.html',
  './legal/tokushoho/index.html',
  './legal/terms/index.html',
  './legal/privacy/index.html',
  './legal/refund/index.html',
  './src/css/app.css',
  './src/css/tokens.css',
  './src/js/app.js',
  './src/js/config.js',
  './src/js/jas.js',
  './src/js/db.js',
  './src/js/i18n.js',
  './src/js/csv.js',
  './src/js/feedback.js',
  './src/js/voice.js',
  './src/js/subscription.js',
  './src/js/backup.js',
  './src/js/locales/ja.js',
  './src/js/locales/vi.js',
  './src/js/locales/tl.js',
  './src/js/locales/th.js',
  './src/js/locales/ms.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 1つでも失敗すると全体が失敗するため、個別に取得して取りこぼしを防ぐ
    await Promise.all(SHELL.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, await toCacheable(res));
      } catch {
        /* 1件くらい取れなくてもアプリは動く */
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 外部API（Google ドライブ等）はキャッシュせず、常にネットワークへ
  if (url.origin !== self.location.origin) return;

  // サブスク確認用のサーバーレス関数もキャッシュしない。
  // 古い「有効」の返事を返してしまうと、解約後も使えてしまう。
  if (url.pathname.startsWith('/api/')) return;

  /*
   * 画面遷移。圏外のときは
   *   1. そのURL自体がキャッシュにあればそれを返す（規約やポリシーの各ページ）
   *   2. 無ければアプリ本体を返す（クエリパラメータの有無を問わない）
   * の順で探す。1を入れないと、圏外で /legal/privacy/ を開いたときに
   * ポリシーではなくアプリ画面が表示されてしまう（実機ブラウザで再現確認済み）。
   */
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(request);
        cache.put(request, await toCacheable(fresh.clone())).catch(() => {});
        return fresh;
      } catch {
        return (await cache.match(request, { ignoreSearch: true }))
          ?? (await cache.match(indexOf(request), { ignoreSearch: true }))
          ?? (await cache.match('./index.html', { ignoreSearch: true }))
          ?? (await cache.match('./', { ignoreSearch: true }))
          ?? Response.error();
      }
    })());
    return;
  }

  // それ以外はキャッシュ優先（現場での起動速度を最優先）＋裏で更新
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    const network = fetch(request).then(async (res) => {
      if (res && res.ok && res.type === 'basic') {
        cache.put(request, await toCacheable(res.clone())).catch(() => {});
      }
      return res;
    }).catch(() => null);
    return cached ?? (await network) ?? Response.error();
  })());
});
