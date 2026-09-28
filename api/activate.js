/**
 * POST /api/activate
 * ------------------------------------------------------------------
 * この端末を有効化する。次の3つのどれかを受け取れる。
 *
 *  1. { sessionId }  … 決済直後にStripeから戻ってきたとき（自動）
 *  2. { code }       … 他の端末に表示されたライセンスコードを貼ったとき
 *  3. { email }      … コードを紛失した／機種変更したときの復旧手段
 *
 * 返すもの: { ok, code, status, expiresAt, cancelAtPeriodEnd }
 *   code はこの端末に保存し、以後の確認（/api/verify）に使う。
 */
import { stripeGet, signToken, verifyToken, describeSubscription, readBody, json, rejectNonPost } from './_lib.js';

/** メールアドレスでの復旧を止めたいときは Vercel の環境変数で false にする */
const emailActivationAllowed = () => process.env.ALLOW_EMAIL_ACTIVATION !== 'false';

async function subscriptionFromSession(sessionId) {
  const session = await stripeGet(`/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    'expand': ['subscription'],
  });
  const sub = typeof session.subscription === 'object' ? session.subscription : null;
  if (!sub) return null;
  return sub;
}

async function subscriptionFromEmail(email) {
  const customers = await stripeGet('/customers', { email: email.trim().toLowerCase(), limit: 10 });
  for (const customer of customers.data ?? []) {
    const subs = await stripeGet('/subscriptions', { customer: customer.id, status: 'all', limit: 10 });
    const hit = (subs.data ?? []).find((s) => ['active', 'trialing', 'past_due'].includes(s.status));
    if (hit) return hit;
  }
  return null;
}

export default async function handler(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const { sessionId, code, email } = await readBody(req);
    let sub = null;

    if (sessionId) {
      sub = await subscriptionFromSession(String(sessionId));
    } else if (code) {
      const payload = verifyToken(String(code).trim());
      if (!payload) return json(res, 200, { ok: false, error: 'invalid_code' });
      sub = await stripeGet(`/subscriptions/${encodeURIComponent(payload.s)}`);
    } else if (email) {
      if (!emailActivationAllowed()) return json(res, 200, { ok: false, error: 'email_activation_disabled' });
      sub = await subscriptionFromEmail(String(email));
    } else {
      return json(res, 400, { ok: false, error: 'missing_input' });
    }

    if (!sub) return json(res, 200, { ok: false, error: 'not_found' });
    const info = describeSubscription(sub);
    if (info.status !== 'active') return json(res, 200, { ok: false, error: 'not_active', ...info });

    return json(res, 200, {
      ok: true,
      code: signToken({ s: sub.id, c: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null }),
      ...info,
    });
  } catch (err) {
    return json(res, 500, { ok: false, error: 'server_error', message: err?.message ?? String(err) });
  }
}
