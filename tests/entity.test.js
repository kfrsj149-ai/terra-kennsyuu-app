/**
 * 事業体IDの先行発行（entity.ensure）のテスト
 * 日報など、検収アプリより先に導入する会社にも、同じ事業体IDを渡す操作。確かめたいのは次の点：
 *   ・サービス間の鍵を持つ別アプリのサーバーだけが呼べる（ブラウザ・運転手・事務所の札では呼べない）
 *   ・同じ顧客IDなら何度呼んでも、同時に呼んでも、同じIDが返る
 *   ・後で事務所の初期設定をしても、そのIDをそのまま使う（別のIDにならない）
 *   ・発行しただけの会社は「事務所が未設定」のまま。現場の端末や運営者の一覧には現れない
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.LICENSE_SECRET = 'テスト用の十分に長い署名鍵-0123456789';

const lib = await import('../api/_lib.js');
const { createOffice } = await import('../api/_office-core.js');
const { memoryStore } = await import('../api/_office-store.js');
const { CONSENT_VERSION: CONSENT, isValidId } = await import('../src/js/office-rules.js');

const SERVICE_KEY = 'テスト用のサービス間の鍵-ABCDEFGHIJKLMNOP-0123456789';
const EMAILS = { cus_AAAAAAAA: 'owner-a@example.com', cus_BBBBBBBB: 'owner-b@example.com' };

function env({ serviceKey = SERVICE_KEY } = {}) {
  const clock = { t: Date.UTC(2026, 9, 5, 0, 0, 0) };
  const store = memoryStore(() => clock.t);
  const office = createOffice({
    store,
    now: () => clock.t,
    isSubscriptionActive: async () => true,
    getCustomerEmail: async (p) => EMAILS[p.c] ?? null,
    limits: { verifyVolume: false },
    serviceKey: () => serviceKey,
  });
  const call = async (body, ctx) => office.handle(body, ctx);
  const ok = async (body, ctx) => {
    const r = await call(body, ctx);
    assert.equal(r.payload.ok, true, `${body.op}: ${JSON.stringify(r.payload)}`);
    return r.payload;
  };
  const err = async (body, code, status, ctx) => {
    const r = await call(body, ctx);
    assert.equal(r.payload.ok, false, `${body.op} should fail`);
    assert.equal(r.payload.error, code, JSON.stringify(r.payload));
    if (status) assert.equal(r.status, status);
    return r.payload;
  };
  return { office, store, clock, call, ok, err };
}

const ensure = (customer = 'cus_AAAAAAAA', key = SERVICE_KEY) => ({ op: 'entity.ensure', serviceKey: key, stripeCustomerId: customer });
const codeA = lib.signToken({ s: 'sub_A', c: 'cus_AAAAAAAA' });
const codeB = lib.signToken({ s: 'sub_B', c: 'cus_BBBBBBBB' });
const setup = (e, code, email) => e.call({ op: 'office.setup', consent: CONSENT, code, email });

test('鍵が設定されていない（または短い）と、サービス間の操作は使えない', async () => {
  const e = env({ serviceKey: '' });
  await e.err(ensure(), 'service_not_configured', 503);
  const e2 = env({ serviceKey: 'short' });
  await e2.err(ensure('cus_AAAAAAAA', 'short'), 'service_not_configured', 503);
});

test('鍵が違う・無いと401。ブラウザ・運転手・事務所の札では呼べない', async () => {
  const e = env();
  await e.err(ensure('cus_AAAAAAAA', 'ちがう鍵'), 'unauthorized', 401);
  await e.err({ op: 'entity.ensure', stripeCustomerId: 'cus_AAAAAAAA' }, 'unauthorized', 401);
  await e.err({ op: 'entity.ensure', code: codeA, stripeCustomerId: 'cus_AAAAAAAA' }, 'unauthorized', 401);
  const s = await e.ok({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_AAAAAAAA });
  await e.err({ op: 'entity.ensure', token: s.token, stripeCustomerId: 'cus_BBBBBBBB' }, 'unauthorized', 401);
});

test('鍵の当てずっぽうは、接続元ごとに回数で止まる。正しい鍵なら数え直し', async () => {
  const e = env();
  const ctx = { ip: '203.0.113.9' };
  for (let i = 0; i < 20; i += 1) await e.err(ensure('cus_AAAAAAAA', `ちがう${i}`), 'unauthorized', 401, ctx);
  await e.err(ensure('cus_AAAAAAAA', 'さらにちがう'), 'locked', 429, ctx);
  await e.err(ensure(), 'locked', 429, ctx);                      // 止まっている間は、正しい鍵でも通さない
  // 別の接続元には影響しない
  await e.ok(ensure(), { ip: '198.51.100.7' });
  // 正しい鍵なら、そこまでの失敗は数え直される
  const e2 = env();
  for (let i = 0; i < 5; i += 1) await e2.err(ensure('cus_AAAAAAAA', `x${i}`), 'unauthorized', 401, { ip: '1.1.1.1' });
  await e2.ok(ensure(), { ip: '1.1.1.1' });
  for (let i = 0; i < 20; i += 1) await e2.err(ensure('cus_AAAAAAAA', `y${i}`), 'unauthorized', 401, { ip: '1.1.1.1' });
});

test('顧客IDの書式が違えば受け付けない', async () => {
  const e = env();
  for (const bad of ['', 'cus_', 'cus_ab', 'sub_AAAAAAAA', 'cus_あいうえおかきく', 'cus_AAAA AAAA', `cus_${'A'.repeat(65)}`, null, 123]) {
    await e.err({ op: 'entity.ensure', serviceKey: SERVICE_KEY, stripeCustomerId: bad }, 'invalid', 200);
  }
});

test('発行：8文字の事業体ID。同じ顧客IDなら何度でも同じ。別の顧客なら別のID', async () => {
  const e = env();
  const a = await e.ok(ensure('cus_AAAAAAAA'));
  assert.ok(isValidId(a.entityId), a.entityId);
  assert.equal(a.created, true);
  assert.equal(a.officeSetUp, false);
  const again = await e.ok(ensure('cus_AAAAAAAA'));
  assert.equal(again.entityId, a.entityId);
  assert.equal(again.created, false);
  const b = await e.ok(ensure('cus_BBBBBBBB'));
  assert.notEqual(b.entityId, a.entityId);
});

test('同時に何度呼んでも、IDは1つだけ（二重発行しない）', async () => {
  const e = env();
  const results = await Promise.all(Array.from({ length: 8 }, () => e.ok(ensure('cus_AAAAAAAA'))));
  const ids = new Set(results.map((r) => r.entityId));
  assert.equal(ids.size, 1);
  assert.equal(results.filter((r) => r.created).length, 1);
  assert.equal(Object.keys(await e.store.hgetall('entities')).length, 1);
});

test('発行しただけの会社は「事務所が未設定」。現場の端末は使えず、運営者の会社一覧にも載らない', async () => {
  const e = env();
  const a = await e.ok(ensure('cus_AAAAAAAA'));
  await e.err({ op: 'feed', code: codeA }, 'office_not_set_up');
  await e.err({ op: 'ticket.put', code: codeA, ticket: {} }, 'office_not_set_up');
  await e.err({ op: 'office.login', code: codeA, officeCode: 'AAAA-AAAA-AAAA' }, 'office_not_set_up');
  assert.deepEqual(await e.store.hgetall('companies'), {});
  assert.ok(a.entityId);
});

test('発行したIDで事務所の初期設定ができる（別のIDにならない）。条件（同意・メール）は今までどおり', async () => {
  const e = env();
  const a = await e.ok(ensure('cus_AAAAAAAA'));
  // 同意なし・メール違いは今までどおり通らない
  await e.err({ op: 'office.setup', code: codeA, email: EMAILS.cus_AAAAAAAA }, 'consent_required');
  await e.err({ op: 'office.setup', consent: CONSENT, code: codeA, email: 'wrong@example.com' }, 'bad_email');
  const s = await e.ok({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_AAAAAAAA });
  assert.equal(s.companyId, a.entityId);
  // 設定後は、ログインでき、現場の端末は feed を受け取れる
  const login = await e.ok({ op: 'office.login', code: codeA, officeCode: s.officeCode });
  assert.equal(login.companyId, a.entityId);
  await e.ok({ op: 'feed', code: codeA });
  // 二度目の設定はできない。ensure も同じIDを返し、設定済みと分かる
  await e.err({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_AAAAAAAA }, 'already_setup');
  const after = await e.ok(ensure('cus_AAAAAAAA'));
  assert.deepEqual({ id: after.entityId, created: after.created, set: after.officeSetUp }, { id: a.entityId, created: false, set: true });
  assert.ok((await e.store.hgetall('companies'))[a.entityId]);
});

test('先に事務所の初期設定をした会社にも、ensure は同じIDを返す（新しいIDを作らない）', async () => {
  const e = env();
  const s = await e.ok({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_AAAAAAAA });
  const r = await e.ok(ensure('cus_AAAAAAAA'));
  assert.equal(r.entityId, s.companyId);
  assert.equal(r.created, false);
  assert.equal(r.officeSetUp, true);
  assert.deepEqual(Object.keys(await e.store.hgetall('entities')), []);      // 先行発行の索引には載らない
});

test('発行済みの会社を、同時に2か所から初期設定しても、有効な事務所コードは1つだけ', async () => {
  const e = env();
  const a = await e.ok(ensure('cus_AAAAAAAA'));
  const rs = await Promise.all([setup(e, codeA, EMAILS.cus_AAAAAAAA), setup(e, codeA, EMAILS.cus_AAAAAAAA), setup(e, codeA, EMAILS.cus_AAAAAAAA)]);
  const oks = rs.filter((r) => r.payload.ok);
  assert.equal(oks.length, 1, JSON.stringify(rs.map((r) => r.payload)));
  assert.equal(oks[0].payload.companyId, a.entityId);
  assert.ok(rs.filter((r) => !r.payload.ok).every((r) => r.payload.error === 'already_setup'));
  await e.ok({ op: 'office.login', code: codeA, officeCode: oks[0].payload.officeCode });
});

test('ensure と初期設定が同時に走っても、IDが二つに割れない', async () => {
  for (let i = 0; i < 20; i += 1) {
    const e = env();
    const [r, s] = await Promise.all([e.call(ensure('cus_AAAAAAAA')), setup(e, codeA, EMAILS.cus_AAAAAAAA)]);
    // 割れたときは「やり直し」(server_busy) になるか、同じIDになるかのどちらか
    if (s.payload.ok) assert.equal(r.payload.entityId, s.payload.companyId);
    else assert.equal(s.payload.error, 'server_busy');
    const final = await e.ok(ensure('cus_AAAAAAAA'));
    if (s.payload.ok) assert.equal(final.entityId, s.payload.companyId);
    // やり直しなら、次は発行済みのIDで設定できる
    if (!s.payload.ok) {
      const retry = await setup(e, codeA, EMAILS.cus_AAAAAAAA);
      assert.equal(retry.payload.ok, true, JSON.stringify(retry.payload));
      assert.equal(retry.payload.companyId, final.entityId);
    }
  }
});

test('他社のデータは、発行や初期設定をまたいでも混ざらない', async () => {
  const e = env();
  const a = await e.ok(ensure('cus_AAAAAAAA'));
  const sb = await e.ok({ op: 'office.setup', consent: CONSENT, code: codeB, email: EMAILS.cus_BBBBBBBB });
  assert.notEqual(sb.companyId, a.entityId);
  const sa = await e.ok({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_AAAAAAAA });
  assert.equal(sa.companyId, a.entityId);
  await e.ok({ op: 'site.put', token: sb.token, site: { name: 'B社の現場' } });
  const feedA = await e.ok({ op: 'feed', code: codeA });
  assert.deepEqual(feedA.sites, []);
});
