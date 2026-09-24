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
async function toCacheable(response) {
  if (!response.redirected) return response;
  const body = await response.arrayBuffer();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
const VERSION = 'terra-kennsyuu-v3';
const CACHE = `${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './privacy.html',
  './manifest.webmanifest',
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

  // 外部API（Lemon Squeezy / Google）はキャッシュせず、常にネットワークへ
  if (url.origin !== self.location.origin) return;

  // 画面遷移はクエリパラメータに関係なく必ずアプリ本体を返す
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', await toCacheable(fresh.clone())).catch(() => {});
        return fresh;
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html', { ignoreSearch: true }))
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
