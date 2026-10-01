/**
 * /api/* の共通処理（Stripe呼び出しと、ライセンスコードの署名・検証）
 * ------------------------------------------------------------------
 * なぜサーバー側の処理が必要か：
 *   Stripeのシークレットキーはブラウザに置けない（置くと第三者に決済を
 *   操作されてしまう）。そのため「このサブスクは有効か？」の問い合わせだけ
 *   Vercelのサーバーレス関数に出し、アプリ本体は結果を受け取るだけにする。
 *   アプリ本体（計測・材積計算・保存）は今までどおり完全にオフラインで動く。
 *
 * 依存パッケージは使わない（stripe パッケージも入れない）。
 * Node標準の fetch と node:crypto だけで完結させる。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const STRIPE_API = 'https://api.stripe.com/v1';

/** 有効と見なすサブスクリプションの状態。past_due は支払リトライ中なので現場では止めない */
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function secretKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY が未設定です');
  return key;
}

function licenseSecret() {
  const key = process.env.LICENSE_SECRET;
  if (!key) throw new Error('LICENSE_SECRET が未設定です');
  return key;
}

/** Stripe API を叩く。paramsはブラケット記法のクエリ文字列に展開する */
export async function stripeGet(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((item) => qs.append(`${k}[]`, item));
    else if (v !== undefined && v !== null) qs.append(k, String(v));
  }
  const url = `${STRIPE_API}${path}${qs.size ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secretKey()}`, 'Stripe-Version': '2024-06-20' },
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json?.error?.message ?? 'stripe error'), { stripe: json, httpStatus: res.status });
  return json;
}

export async function stripePost(path, body = {}) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null) form.append(k, String(v));
  }
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Stripe-Version': '2024-06-20',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json?.error?.message ?? 'stripe error'), { stripe: json, httpStatus: res.status });
  return json;
}

/* ------------------------------------------------------------------
 * ライセンスコード
 *   中身は {s:サブスクID, c:顧客ID} だけ。これに HMAC-SHA256 の署名を付ける。
 *   署名鍵（LICENSE_SECRET）はサーバーにしか無いので、利用者が中身を
 *   書き換えて期限を延ばすことはできない。
 *   有効期限はコードの中に入れない。必ず毎回Stripeに問い合わせて取得する。
 * ------------------------------------------------------------------ */
const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(createHmac('sha256', licenseSecret()).update(body).digest());
  return `${body}.${mac}`;
}

/** @returns {{s:string, c:string}|null} 署名が合わなければ null */
export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = b64url(createHmac('sha256', licenseSecret()).update(body).digest());
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload?.s ? payload : null;
  } catch {
    return null;
  }
}

/**
 * 用途ごとに鍵を分けた署名（事務所端末のログイン札など）。
 * ライセンスコードと同じ LICENSE_SECRET から、用途名を混ぜて別の鍵を作る。
 * こうしておくと、ライセンスコードをログイン札として使い回すことができない。
 */
const purposeKey = (purpose) => createHmac('sha256', licenseSecret()).update(`purpose:${purpose}`).digest();

export function signPayload(purpose, payload) {
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(createHmac('sha256', purposeKey(purpose)).update(body).digest());
  return `${body}.${mac}`;
}

/** @returns {object|null} 署名が合わない・壊れているなら null */
export function verifyPayload(purpose, token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = b64url(createHmac('sha256', purposeKey(purpose)).update(body).digest());
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------
 * サブスクリプションの状態をアプリが使う形に直す
 * ------------------------------------------------------------------ */
/**
 * 期間終了日（ミリ秒）を取り出す。
 * StripeのAPIバージョンによって current_period_end の置き場所が
 * サブスクリプション本体から明細（items）へ移ったため、両方見る。
 */
function periodEndMs(sub) {
  const sec = sub?.items?.data?.[0]?.current_period_end ?? sub?.current_period_end ?? null;
  return sec ? sec * 1000 : null;
}

export function describeSubscription(sub) {
  const active = ACTIVE_STATUSES.has(sub?.status);
  return {
    status: active ? 'active' : (sub?.status ?? 'invalid'),
    rawStatus: sub?.status ?? null,
    expiresAt: periodEndMs(sub),
    cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end),
  };
}

/* ------------------------------------------------------------------
 * リクエスト処理のお作法
 * ------------------------------------------------------------------ */
export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export function json(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(payload));
}

/** POST以外を弾く。true を返したら呼び出し側は処理を続けない */
export function rejectNonPost(req, res) {
  if (req.method === 'POST') return false;
  res.setHeader('Allow', 'POST');
  json(res, 405, { ok: false, error: 'method_not_allowed' });
  return true;
}
