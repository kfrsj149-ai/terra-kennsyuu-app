/**
 * サブスク確認用サーバーレス関数のテスト
 * ------------------------------------------------------------------
 * Stripeへの通信は差し替えて（fetchを置き換えて）検証する。
 * 確かめたいのは「ライセンスコードを改ざんしても通らないこと」と
 * 「Stripeの返事から有効期限を正しく取り出せること」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.LICENSE_SECRET = 'テスト用の十分に長い署名鍵-0123456789';

const lib = await import('../api/_lib.js');
const activate = (await import('../api/activate.js')).default;
const verify = (await import('../api/verify.js')).default;

/** Vercelのres（Express風）の最小モック */
function mockRes() {
  const out = { statusCode: 0, headers: {}, body: null };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    status(code) { out.statusCode = code; return this; },
    send(body) { out.body = JSON.parse(body); },
  };
}

/** fetchを差し替える。url→返すJSONの対応表を渡す */
function withFetch(routes, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return { ok: false, status: 404, json: async () => ({ error: { message: `no stub: ${url}` } }) };
    return { ok: true, status: 200, json: async () => routes[key] };
  };
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = original; });
}

const ONE_YEAR_LATER = 1822102566; // 2027-09-28 頃（秒）

/** 実際にStripeのサンドボックスから返ってきた形に合わせたサブスクリプション */
const SUB = {
  id: 'sub_TEST',
  status: 'active',
  customer: 'cus_TEST',
  cancel_at_period_end: false,
  items: { data: [{ current_period_end: ONE_YEAR_LATER }] },
};

test('ライセンスコードは署名され、改ざんすると通らない', () => {
  const code = lib.signToken({ s: 'sub_TEST', c: 'cus_TEST' });
  assert.deepEqual(lib.verifyToken(code), { s: 'sub_TEST', c: 'cus_TEST' });

  // 中身だけ他人のサブスクIDに書き換えたコード
  const forged = `${Buffer.from(JSON.stringify({ s: 'sub_OTHER' })).toString('base64url')}.${code.split('.')[1]}`;
  assert.equal(lib.verifyToken(forged), null);
  assert.equal(lib.verifyToken('でたらめな文字列'), null);
  assert.equal(lib.verifyToken(''), null);
  assert.equal(lib.verifyToken(undefined), null);
});

test('有効期限は items 側・本体側のどちらに入っていても取り出せる', () => {
  // 新しいAPIバージョン（明細側にある）
  assert.equal(lib.describeSubscription(SUB).expiresAt, ONE_YEAR_LATER * 1000);
  // 古いAPIバージョン（本体側にある）
  assert.equal(
    lib.describeSubscription({ status: 'active', current_period_end: ONE_YEAR_LATER }).expiresAt,
    ONE_YEAR_LATER * 1000,
  );
  // 支払リトライ中は現場を止めない
  assert.equal(lib.describeSubscription({ ...SUB, status: 'past_due' }).status, 'active');
  // 解約済みは無効
  assert.equal(lib.describeSubscription({ ...SUB, status: 'canceled' }).status, 'canceled');
});

test('POST以外は405で弾く', async () => {
  const res = mockRes();
  await verify({ method: 'GET' }, res);
  assert.equal(res.out.statusCode, 405);
});

test('決済完了の戻り（session_id）でライセンスコードが発行される', async () => {
  const res = mockRes();
  await withFetch({ '/checkout/sessions/cs_TEST': { id: 'cs_TEST', subscription: SUB } }, () =>
    activate({ method: 'POST', body: { sessionId: 'cs_TEST' } }, res));
  assert.equal(res.out.statusCode, 200);
  assert.equal(res.out.body.ok, true);
  assert.equal(res.out.body.expiresAt, ONE_YEAR_LATER * 1000);
  assert.deepEqual(lib.verifyToken(res.out.body.code), { s: 'sub_TEST', c: 'cus_TEST' });
});

test('メールアドレスからでも復旧できる（機種変更・コード紛失時）', async () => {
  const res = mockRes();
  await withFetch({
    '/customers': { data: [{ id: 'cus_TEST' }] },
    '/subscriptions?': { data: [SUB] },
  }, () => activate({ method: 'POST', body: { email: 'Test-Kennsyuu@Example.com' } }, res));
  assert.equal(res.out.body.ok, true);
  assert.deepEqual(lib.verifyToken(res.out.body.code), { s: 'sub_TEST', c: 'cus_TEST' });
});

test('偽のライセンスコードでは有効化できない', async () => {
  const res = mockRes();
  await activate({ method: 'POST', body: { code: 'abc.def' } }, res);
  assert.equal(res.out.body.ok, false);
  assert.equal(res.out.body.error, 'invalid_code');
});

test('解約済みのサブスクは有効化されない', async () => {
  const res = mockRes();
  await withFetch({ '/checkout/sessions/cs_X': { subscription: { ...SUB, status: 'canceled' } } }, () =>
    activate({ method: 'POST', body: { sessionId: 'cs_X' } }, res));
  assert.equal(res.out.body.ok, false);
  assert.equal(res.out.body.error, 'not_active');
});

test('再確認（verify）は最新の有効期限を返す', async () => {
  const code = lib.signToken({ s: 'sub_TEST', c: 'cus_TEST' });
  const res = mockRes();
  await withFetch({ '/subscriptions/sub_TEST': SUB }, () =>
    verify({ method: 'POST', body: { code } }, res));
  assert.equal(res.out.body.ok, true);
  assert.equal(res.out.body.expiresAt, ONE_YEAR_LATER * 1000);
});
