/**
 * 自動更新（スマホだけで開発するための仕組み）
 * ------------------------------------------------------------------
 * 目的：山でスマホから指示 → コードが直り → アプリを開き直すだけで最新になる。
 *
 * PWAはオフラインのためにアプリ本体をキャッシュする。そのままだと、
 * 新しい版をデプロイしても端末は古いキャッシュを表示し続ける。
 * そこで「いま配信されている版（コミット）」を /api/version に聞き、
 * 端末が持っている版と違えばキャッシュを全部捨てて読み直す。
 *
 * 安全のため、計測中は絶対に自動リロードしない（入力中の画面が飛ぶため）。
 * 計測が終わってセットアップ画面に戻ったとき、または次にアプリを開いたときに反映する。
 */
import { kvGet, kvSet } from './db.js';

const KEY = 'appVersion';
const ENDPOINT = './api/version';

let pending = null;   // 更新が見つかったが、計測中で保留している版
let current = null;   // この画面が動いている版

/** いま配信されている版を聞く。圏外・失敗時は null（何もしない） */
async function fetchLive() {
  if (!navigator.onLine) return null;
  try {
    const res = await fetch(`${ENDPOINT}?t=${Date.now()}`, { cache: 'no-store' });
    const json = await res.json();
    return json?.sha ? json : null;
  } catch {
    return null;
  }
}

/** キャッシュを全部捨てて、Service Workerを更新してから読み直す */
async function hardReload(sha) {
  await kvSet(KEY, { sha, at: Date.now() });
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* キャッシュが使えない環境でも進む */ }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch { /* 同上 */ }
  // キャッシュを消した直後に読み直すので、次の表示は必ず最新になる
  location.reload();
}

/**
 * 更新を確認する。
 * @param {{canReload:()=>boolean, onPending:(info:object)=>void}} hooks
 *   canReload … いまリロードしてよいか（計測中は false を返すこと）
 *   onPending … 更新はあるがリロードできないときに呼ばれる
 */
export async function check({ canReload, onPending } = {}) {
  const live = await fetchLive();
  if (!live) return { skipped: true };

  const saved = await kvGet(KEY, null);
  current = live;

  // 初回起動（保存が無い）は、いまの版を記録するだけ。いきなりリロードしない
  if (!saved?.sha) {
    await kvSet(KEY, { sha: live.sha, at: Date.now() });
    return { first: true, sha: live.sha };
  }
  if (saved.sha === live.sha) return { upToDate: true, sha: live.sha };

  if (canReload && !canReload()) {
    pending = live;
    onPending?.(live);
    return { pendingReload: true, sha: live.sha };
  }
  await hardReload(live.sha);
  return { reloading: true, sha: live.sha };
}

/** 保留していた更新を反映する（計測が終わった直後などに呼ぶ） */
export async function applyPending() {
  if (!pending) return false;
  await hardReload(pending.sha);
  return true;
}

export function hasPending() {
  return Boolean(pending);
}

/** メニューに出す表示用の版情報 */
export async function info() {
  const saved = await kvGet(KEY, null);
  return {
    sha: current?.sha ?? saved?.sha ?? null,
    short: current?.short ?? saved?.sha?.slice(0, 7) ?? null,
    message: current?.message ?? null,
    env: current?.env ?? null,
    pending: pending ? pending.short : null,
  };
}

/** 「最新に更新」ボタン用。版が同じでもキャッシュを捨てて読み直す */
export async function forceReload() {
  const live = await fetchLive();
  await hardReload(live?.sha ?? 'manual');
}
