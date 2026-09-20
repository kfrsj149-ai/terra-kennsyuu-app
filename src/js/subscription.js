/**
 * 年額サブスクリプション判定（Lemon Squeezy）
 * ------------------------------------------------------------------
 * オフラインファーストのアプリなので「通信できないと使えない」は絶対に避ける。
 *  - 確認はオンライン時だけ行う
 *  - 最後に確認できた日時から offlineGraceDays の間は、圏外でもそのまま使える
 *  - 初回起動から trialDays の間は無条件で使える（試用）
 */
import { CONFIG } from './config.js';
import { kvGet, kvSet } from './db.js';

const KEY = 'subscription';
const DAY = 86_400_000;

/** @typedef {{licenseKey:string|null, instanceId:string|null, status:string|null, expiresAt:number|null, lastCheckedAt:number|null, firstLaunchAt:number}} SubState */

/** @returns {Promise<SubState>} */
export async function loadState() {
  const now = Date.now();
  const state = await kvGet(KEY, null);
  if (state) return state;
  const fresh = {
    licenseKey: null, instanceId: null, status: null,
    expiresAt: null, lastCheckedAt: null, firstLaunchAt: now,
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

  if (s.licenseKey && s.lastCheckedAt) {
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
  return { allowed: false, reason: s.licenseKey ? 'expired' : 'trial-ended', trialDaysLeft: 0, graceDaysLeft: 0, state: s };
}

async function callLemonSqueezy(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  });
  return res.json();
}

function applyLicenseResponse(json) {
  const lk = json?.license_key ?? {};
  const expiresAt = lk.expires_at ? Date.parse(lk.expires_at) : null;
  return {
    status: json?.valid && (lk.status === 'active' || lk.status === 'inactive') ? 'active' : (lk.status ?? 'invalid'),
    expiresAt: Number.isNaN(expiresAt) ? null : expiresAt,
    lastCheckedAt: Date.now(),
  };
}

/**
 * ライセンスキーを有効化する（購入直後の1回だけ）。
 * @param {string} licenseKey
 */
export async function activate(licenseKey) {
  if (!navigator.onLine) return { ok: false, error: 'offline' };
  try {
    const json = await callLemonSqueezy(CONFIG.lemonSqueezy.activateUrl, {
      license_key: licenseKey.trim(),
      instance_name: `terra-kennsyuu-${Date.now()}`,
    });
    if (!json?.activated && !json?.valid) return { ok: false, error: json?.error ?? 'invalid' };
    await saveState({
      licenseKey: licenseKey.trim(),
      instanceId: json?.instance?.id ?? null,
      ...applyLicenseResponse(json),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * オンライン時に有効期限を再確認する。圏外なら何もしない（失敗扱いにしない）。
 */
export async function revalidate({ force = false } = {}) {
  const s = await loadState();
  if (!s.licenseKey || !navigator.onLine) return { skipped: true };
  const due = !s.lastCheckedAt || Date.now() - s.lastCheckedAt >= CONFIG.subscription.revalidateIntervalDays * DAY;
  if (!due && !force) return { skipped: true };
  try {
    const json = await callLemonSqueezy(CONFIG.lemonSqueezy.validateUrl, {
      license_key: s.licenseKey,
      ...(s.instanceId ? { instance_id: s.instanceId } : {}),
    });
    await saveState(applyLicenseResponse(json));
    return { ok: true };
  } catch {
    // 通信エラーは猶予期間で吸収する（ここで使えなくしてはいけない）
    return { ok: false };
  }
}

/** ライセンスを端末から外す */
export async function deactivateLocally() {
  return saveState({ licenseKey: null, instanceId: null, status: null, expiresAt: null, lastCheckedAt: null });
}
