/**
 * POST /api/verify
 * ------------------------------------------------------------------
 * 保存済みのライセンスコードが今も有効かを確認し、最新の有効期限を返す。
 * オンラインのときだけアプリから呼ばれる。圏外のときはアプリ側が
 * 「最後に確認できた日時＋猶予日数」で判断するので、ここは呼ばれない。
 */
import { stripeGet, verifyToken, describeSubscription, readBody, json, rejectNonPost } from './_lib.js';

export default async function handler(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const { code } = await readBody(req);
    const payload = verifyToken(String(code ?? '').trim());
    if (!payload) return json(res, 200, { ok: false, error: 'invalid_code' });

    const sub = await stripeGet(`/subscriptions/${encodeURIComponent(payload.s)}`);
    const info = describeSubscription(sub);
    return json(res, 200, { ok: info.status === 'active', ...info });
  } catch (err) {
    // 解約済みでStripeから消えている場合もここに来る。アプリ側は
    // 「確認できなかった」扱いにして猶予期間で吸収する。
    return json(res, 500, { ok: false, error: 'server_error', message: err?.message ?? String(err) });
  }
}
