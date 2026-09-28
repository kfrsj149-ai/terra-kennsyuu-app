/**
 * 年額サブスクリプション判定（Stripe）
 * ------------------------------------------------------------------
 * オフラインファーストのアプリなので「通信できないと使えない」は絶対に避ける。
 *  - 確認はオンライン時だけ行う
 *  - 最後に確認できた日時から offlineGraceDays の間は、圏外でもそのまま使える
 *  - 初回起動から trialDays の間は無条件で使える（試用）
 *
 * Stripeのシークレットキーはブラウザに置けないため、確認は同一オリジンの
 * サーバーレス関数（/api/activate, /api/verify）経由で行う。
 * アプリが保存するのは、その関数が発行した署名付きライセンスコードだけ。
 */
import { CONFIG } from './config.js';
import { kvGet, kvSet } from './db.js';

const KEY = 'subscription';
const DAY = 86_400_000;

/** @typedef {{code:string|null, status:string|null, expiresAt:number|null, cancelAtPeriodEnd:boolean, lastCheckedAt:number|null, firstLaunchAt:number}} SubState */

/** @returns {Promise<SubState>} */
export async function loadState() {
  const now = Date.now();
  const state = await kvGet(KEY, null);
  if (state) {
    // Lemon Squeezy 時代の保存内容が残っていても、試用開始日だけは引き継ぐ
    if (!('code' in state)) {
      return { code: null, status: null, expiresAt: null, cancelAtPeriodEnd: false, lastCheckedAt: null, firstLaunchAt: state.firstLaunchAt ?? now };
    }
    return state;
  }
  const fresh = {
    code: null, status: null, expiresAt: null,
    cancelAtPeriodEnd: false, lastCheckedAt: null, firstLaunchAt: now,
  };
  await kvSet(KEY, fresh);
  return fresh;
}

async function saveState(patch) {
  const state = { ...(await loadState()), ...patch };
  await kvSet(KEY, state);
  return state;
}

/**
 * 現在の利用可否を判定する。
 * @returns {Promise<{allowed:boolean, reason:'active'|'grace'|'trial'|'trial-ended'|'expired'|'none', trialDaysLeft:number, graceDaysLeft:number, state:SubState}>}
 */
export async function evaluate() {
  const s = await loadState();
  const now = Date.now();
  const trialDaysLeft = Math.max(0, Math.ceil((s.firstLaunchAt + CONFIG.subscription.trialDays * DAY - now) / DAY));

  if (s.code && s.lastCheckedAt) {
    const graceEnd = s.lastCheckedAt + CONFIG.subscription.offlineGraceDays * DAY;
    const graceDaysLeft = Math.max(0, Math.ceil((graceEnd - now) / DAY));
    const notExpired = !s.expiresAt || s.expiresAt > now;
    if (s.status === 'active' && notExpired) {
      const fresh = now - s.lastCheckedAt < CONFIG.subscription.revalidateIntervalDays * DAY;
      return { allowed: true, reason: fresh ? 'active' : 'grace', trialDaysLeft, graceDaysLeft, state: s };
    }
    if (now < graceEnd && s.status === 'active') {
      return { allowed: true, reason: 'grace', trialDaysLeft, graceDaysLeft, state: s };
    }
    return { allowed: false, reason: 'expired', trialDaysLeft, graceDaysLeft: 0, state: s };
  }

  if (trialDaysLeft > 0) {
    return { allowed: true, reason: 'trial', trialDaysLeft, graceDaysLeft: 0, state: s };
  }
  return { allowed: false, reason: s.code ? 'expired' : 'trial-ended', trialDaysLeft: 0, graceDaysLeft: 0, state: s };
}

async function callApi(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function applyResponse(json) {
  return {
    status: json?.status === 'active' ? 'active' : (json?.status ?? 'invalid'),
    expiresAt: typeof json?.expiresAt === 'number' ? json.expiresAt : null,
    cancelAtPeriodEnd: Boolean(json?.cancelAtPeriodEnd),
    lastCheckedAt: Date.now(),
  };
}

/** 入力欄の文字列がメールアドレスらしいか（@を含み空白が無ければメール扱い） */
function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * 有効化の共通処理。
 * @param {{sessionId?:string, code?:string, email?:string}} payload
 */
async function activateWith(payload) {
  if (!navigator.onLine) return { ok: false, error: 'offline' };
  try {
    const json = await callApi(CONFIG.api.activate, payload);
    if (!json?.ok || !json?.code) return { ok: false, error: json?.error ?? 'invalid' };
    await saveState({ code: json.code, ...applyResponse(json) });
    return { ok: true, state: await loadState() };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * 利用者が入力した文字列で有効化する。
 * ライセンスコードでも、購入時のメールアドレスでも通る（機種変更・紛失対策）。
 * @param {string} input
 */
export async function activate(input) {
  const value = String(input ?? '').trim();
  if (!value) return { ok: false, error: 'empty' };
  return activateWith(looksLikeEmail(value) ? { email: value } : { code: value });
}

/**
 * Stripeの決済完了後、アプリに戻ってきたときの自動有効化。
 * @param {string} sessionId Checkout セッションID（URLの session_id）
 */
export async function activateFromCheckout(sessionId) {
  return activateWith({ sessionId: String(sessionId) });
}

/**
 * オンライン時に有効期限を再確認する。圏外なら何もしない（失敗扱いにしない）。
 */
export async function revalidate({ force = false } = {}) {
  const s = await loadState();
  if (!s.code || !navigator.onLine) return { skipped: true };
  const due = !s.lastCheckedAt || Date.now() - s.lastCheckedAt >= CONFIG.subscription.revalidateIntervalDays * DAY;
  if (!due && !force) return { skipped: true };
  try {
    const json = await callApi(CONFIG.api.verify, { code: s.code });
    // サーバー障害（error: server_error）のときは判定を書き換えない。
    // ここで無効にしてしまうと、Stripe側の一時障害で現場が止まる。
    if (json?.error === 'server_error') return { ok: false };
    await saveState(applyResponse(json));
    return { ok: true };
  } catch {
    // 通信エラーは猶予期間で吸収する（ここで使えなくしてはいけない）
    return { ok: false };
  }
}

/** 支払い・解約の管理画面（Stripeカスタマーポータル）のURLを取得する */
export async function portalUrl() {
  const s = await loadState();
  if (!s.code || !navigator.onLine) return null;
  try {
    const json = await callApi(CONFIG.api.portal, { code: s.code, returnUrl: location.href });
    return json?.ok ? json.url : null;
  } catch {
    return null;
  }
}

/** 他の端末に貼り付けるためのライセンスコード（未購入なら null） */
export async function licenseCode() {
  return (await loadState()).code;
}

/** ライセンスを端末から外す */
export async function deactivateLocally() {
  return saveState({ code: null, status: null, expiresAt: null, cancelAtPeriodEnd: false, lastCheckedAt: null });
}
