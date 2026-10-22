/**
 * 画面の高さを、実際に見えている高さに合わせる
 * ------------------------------------------------------------------
 * 「ホーム画面に追加」して開いたアプリ（standalone）では、起動の直後に、CSSの 100dvh が
 * 実際に見えている高さより一瞬大きくなることがあり、画面の下端にあるボタン
 * （計測開始・直前取消・データ出力）が見えない位置に出てしまう。ブラウザのタブでは起こらない。
 *
 * そこで、実際の高さ（innerHeight）を --app-h に入れて使う。
 *  - 描画の前（index.html の先頭）で一度入れ、起動直後から正しい高さにする
 *  - 回転・サイズ変更・画面への復帰・起動直後の数回、測り直す
 * 測れなかったときは、CSSの 100dvh がそのまま使われる（var のフォールバック）。
 */

/** 実際に見えている高さ（px）。測れないときは 0 */
export function appHeight(win) {
  const h = Math.round(Number(win?.innerHeight) || 0);
  return h > 0 ? h : 0;
}

/** --app-h を最新にする。変わったときだけ書き換える */
export function syncAppHeight(win = window, root = document.documentElement) {
  const h = appHeight(win);
  if (h && root.style.getPropertyValue('--app-h') !== `${h}px`) root.style.setProperty('--app-h', `${h}px`);
  return h;
}

/** 測り直すきっかけを登録する。起動直後は画面の寸法が落ち着くまで、数回測り直す */
export function initViewport(win = window, root = document.documentElement) {
  const sync = () => syncAppHeight(win, root);
  sync();
  win.addEventListener('resize', sync);
  win.addEventListener('orientationchange', sync);
  win.addEventListener('pageshow', sync);
  win.document?.addEventListener('visibilitychange', () => { if (win.document.visibilityState === 'visible') sync(); });
  for (const ms of [0, 100, 300, 800, 1500]) win.setTimeout(sync, ms);
  return sync;
}
