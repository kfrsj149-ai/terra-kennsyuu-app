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

/* ------------------------------------------------------------------
 * 押した瞬間のフィードバック（すべてのボタン共通）
 * ------------------------------------------------------------------ */
const PRESS_SELECTOR = 'button, .preset-chip, summary, label.switch, [role="button"]';

/**
 * 押した瞬間に、見た目（縮む・暗くなる）と触覚（短い振動）を返す。
 * 計測の径級カードは専用の演出（光る・震える・鳴る）があるので対象外。
 * iPhoneの Safari は :active の反応が遅いので、クラスを付けて確実に見せる。
 */
export function initPressFeedback(root = document) {
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.(PRESS_SELECTOR);
    if (!el || el.disabled || el.closest('.dia-card')) return;
    el.classList.add('is-pressed');
    vibrate(8);
    const release = () => setTimeout(() => el.classList.remove('is-pressed'), 90);
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      el.addEventListener(type, release, { once: true });
    }
  }, { passive: true });
}

/**
 * 通信・保存を待つボタンに使う。押した瞬間に回転マークを出し、終わるまで押せなくする
 * （連続タップでの二重実行も防ぐ）。
 * @param {HTMLButtonElement} btn
 * @param {() => Promise<unknown>} fn
 */
export async function withBusy(btn, fn) {
  if (!btn || btn.classList.contains('is-busy')) return undefined;
  const wasDisabled = btn.disabled;
  btn.classList.add('is-busy');
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  try {
    return await fn();
  } finally {
    btn.classList.remove('is-busy');
    btn.removeAttribute('aria-busy');
    btn.disabled = wasDisabled;
  }
}
