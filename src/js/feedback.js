/**
 * 屋外・騒音・手袋前提の操作フィードバック。
 * 「光る／震える／鳴る」の3つを同時に出し、押せたことを必ず分からせる。
 */

let audioCtx = null;

/** Web Audio は最初のユーザー操作の後でないと鳴らせないため、遅延生成する */
function ctx() {
  if (audioCtx === null) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    audioCtx = Ctor ? new Ctor() : false;
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx || null;
}

/**
 * 短い操作音を鳴らす。
 * @param {'tap'|'undo'|'error'|'done'} kind
 */
export function beep(kind = 'tap') {
  const ac = ctx();
  if (!ac) return;
  const tones = {
    tap: [{ f: 880, d: 0.06 }],
    undo: [{ f: 420, d: 0.09 }],
    error: [{ f: 220, d: 0.16 }],
    done: [{ f: 660, d: 0.08 }, { f: 990, d: 0.12 }],
  };
  let start = ac.currentTime;
  for (const { f, d } of tones[kind] ?? tones.tap) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'square';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.28, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + d);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + d + 0.02);
    start += d;
  }
}

/**
 * 端末を振動させる（対応端末のみ）。
 * @param {number|number[]} pattern
 */
export function vibrate(pattern = 25) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* 非対応端末は黙って無視 */
  }
}

/**
 * 要素をCSSアニメーションで発光させる。
 * @param {HTMLElement} el
 */
export function glow(el) {
  if (!el) return;
  el.classList.remove('is-hit');
  void el.offsetWidth; // アニメーションを確実に再実行させる
  el.classList.add('is-hit');
  setTimeout(() => el.classList.remove('is-hit'), 300);
}

/** 入力成功時のフィードバック一式 */
export function feedbackAdd(el) {
  glow(el);
  vibrate(25);
  beep('tap');
}

/** 取消時のフィードバック一式 */
export function feedbackUndo() {
  vibrate([40, 50, 40]);
  beep('undo');
}

/** 失敗・不可時のフィードバック */
export function feedbackError() {
  vibrate([80, 60, 80]);
  beep('error');
}

/* ---------------- 画面消灯防止（Screen Wake Lock API） ---------------- */
let wakeLock = null;

export async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return false;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
    return true;
  } catch {
    return false;
  }
}

export async function releaseWakeLock() {
  try {
    await wakeLock?.release();
  } catch {
    /* 無視 */
  }
  wakeLock = null;
}

/** タブ復帰時に自動で取り直す（Wake Lock はバックグラウンドで解放されるため） */
export function initWakeLockAutoRenew(isActive) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isActive()) requestWakeLock();
  });
}
