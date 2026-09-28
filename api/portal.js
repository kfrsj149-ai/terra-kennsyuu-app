/**
 * POST /api/portal
 * ------------------------------------------------------------------
 * Stripeのカスタマーポータル（支払方法の変更・解約・領収書の取得）を開くための
 * 一時URLを発行する。特商法表記で案内している「解約手続きができる管理画面」が
 * これに当たる。
 *
 * 事前にStripeダッシュボードで
 *   設定 → 請求 → カスタマーポータル
 * を一度保存しておく必要がある（本番モードのみ。テストモードは自動で用意される）。
 */
import { stripeGet, stripePost, verifyToken, readBody, json, rejectNonPost } from './_lib.js';

export default async function handler(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const { code, returnUrl } = await readBody(req);
    const payload = verifyToken(String(code ?? '').trim());
    if (!payload) return json(res, 200, { ok: false, error: 'invalid_code' });

    let customer = payload.c;
    if (!customer) {
      const sub = await stripeGet(`/subscriptions/${encodeURIComponent(payload.s)}`);
      customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    }
    if (!customer) return json(res, 200, { ok: false, error: 'not_found' });

    const session = await stripePost('/billing_portal/sessions', {
      customer,
      ...(returnUrl ? { return_url: String(returnUrl) } : {}),
    });
    return json(res, 200, { ok: true, url: session.url });
  } catch (err) {
    return json(res, 500, { ok: false, error: 'server_error', message: err?.message ?? String(err) });
  }
}
