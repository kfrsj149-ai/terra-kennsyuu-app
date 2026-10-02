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
import { createHash } from 'node:crypto';

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

test('鍵の当てずっぽうは、接続元ごとに回数で止まる。ただし正しい鍵は、止まっている間も必ず通る', async () => {
  const e = env();
  const ctx = { ip: '203.0.113.9' };
  for (let i = 0; i < 20; i += 1) await e.err(ensure('cus_AAAAAAAA', `ちがう${i}`), 'unauthorized', 401, ctx);
  await e.err(ensure('cus_AAAAAAAA', 'さらにちがう'), 'locked', 429, ctx);
  await e.err(ensure('cus_AAAAAAAA', 'もっとちがう'), 'locked', 429, ctx);
  // 同じ出口IPの誰かに間違いを重ねられても、正規のサーバー（正しい鍵）は止まらない
  await e.ok(ensure(), ctx);
  // 別の接続元には影響しない
  await e.err(ensure('cus_AAAAAAAA', 'ちがう'), 'unauthorized', 401, { ip: '198.51.100.7' });
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

test('ensure と初期設定が同時に走っても、IDが二つに割れない（実行順をばらして何度も確かめる）', async () => {
  for (let i = 0; i < 30; i += 1) {
    const e = env();
    const [r, s2] = await Promise.all([e.call(ensure('cus_AAAAAAAA')), setup(e, codeA, EMAILS.cus_AAAAAAAA)]);
    assert.equal(r.payload.ok, true);
    assert.equal(s2.payload.ok, true, JSON.stringify(s2.payload));          // 割れて失敗、にはならない
    assert.equal(s2.payload.companyId, r.payload.entityId);
    const later = await e.ok(ensure('cus_AAAAAAAA'));
    assert.equal(later.entityId, r.payload.entityId);
    assert.equal(later.officeSetUp, true);
  }
});

test('【点検】setup が顧客IDとの結びつきを取る直前に ensure が割り込んでも、先に返したIDが使われる', async () => {
  const e = env();
  const orig = e.store.setIfAbsent.bind(e.store);
  let injected = null;
  let armed = true;
  e.store.setIfAbsent = async (k, v) => {
    if (k.startsWith('ent:') && armed) { armed = false; injected = await e.ok(ensure('cus_AAAAAAAA')); }   // 先に ensure が全部終わる
    return orig(k, v);
  };
  const s2 = await e.ok({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_AAAAAAAA });
  assert.ok(injected);
  assert.equal(s2.companyId, injected.entityId);
  assert.equal((await e.ok(ensure('cus_AAAAAAAA'))).entityId, injected.entityId);
  await e.ok({ op: 'office.login', code: codeA, officeCode: s2.officeCode });
});

test('【点検】setup の途中で止まっても、会社は半端な状態に残らず、すぐやり直せる（発行済みのIDのまま）', async () => {
  const e = env();
  const a = await e.ok(ensure('cus_AAAAAAAA'));
  const orig = e.store.set.bind(e.store);
  let boom = true;
  e.store.set = async (k, ...rest) => { if (boom && k.endsWith(':consent')) { boom = false; throw new Error('redis hang'); } return orig(k, ...rest); };
  const r1 = await e.call({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_AAAAAAAA });
  assert.equal(r1.status, 500);
  // 契約との結びつきは取っていない＝設定済みではない。現場の端末は使えない
  await e.err({ op: 'feed', code: codeA }, 'office_not_set_up');
  // すぐやり直せて、同じ事業体IDで設定できる
  const s2 = await e.ok({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_AAAAAAAA });
  assert.equal(s2.companyId, a.entityId);
  await e.ok({ op: 'office.login', code: codeA, officeCode: s2.officeCode });
  await e.ok({ op: 'feed', code: codeA });                                  // 同意・契約の確認が揃っている
  assert.equal((await e.ok({ op: 'office.status', token: s2.token })).consentOk, true);
});

test('【点検】発行済みの契約を、他社が office.link で横取りできない。つなぐには契約者のメールも要る', async () => {
  const e = env();
  const victim = await e.ok(ensure('cus_BBBBBBBB'));                         // 別アプリがBの会社のIDを先に受け取った
  const a = await e.ok({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_AAAAAAAA });
  // Aの事務所が、Bのライセンスコード（運転手も知っている）をつなごうとしても、メールが違えば通らない
  await e.err({ op: 'office.link', token: a.token, code: codeB, email: EMAILS.cus_AAAAAAAA }, 'bad_email');
  // メールが分かっても、すでに別の会社のIDとして発行済みの契約は、つなげられない
  await e.err({ op: 'office.link', token: a.token, code: codeB, email: EMAILS.cus_BBBBBBBB }, 'license_in_use');
  // Bの本来の持ち主は、今までどおり初期設定できて、IDは変わらない
  const b = await e.ok({ op: 'office.setup', consent: CONSENT, code: codeB, email: EMAILS.cus_BBBBBBBB });
  assert.equal(b.companyId, victim.entityId);
  assert.equal((await e.ok(ensure('cus_BBBBBBBB'))).entityId, victim.entityId);
});

test('【点検】先に office.link でつないだ契約は、ensure でもそのつないだ会社のIDになる', async () => {
  const e = env();
  const a = await e.ok({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_AAAAAAAA });
  await e.ok({ op: 'office.link', token: a.token, code: codeB, email: EMAILS.cus_BBBBBBBB });
  const r = await e.ok(ensure('cus_BBBBBBBB'));
  assert.equal(r.entityId, a.companyId);
  assert.equal(r.officeSetUp, true);
  // 同じ契約を、もう一度つないでも問題ない（冪等）
  await e.ok({ op: 'office.link', token: a.token, code: codeB, email: EMAILS.cus_BBBBBBBB });
});

test('【点検】この改修より前に設定済みの会社（結びつきが lic だけにある）にも、ensure は同じIDを返す', async () => {
  const e = env();
  const s2 = await e.ok({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_AAAAAAAA });
  await e.store.del(`ent:${createHash('sha256').update('cus_AAAAAAAA').digest('hex').slice(0, 32)}`);     // 古い会社を再現：ent を消す
  const r = await e.ok(ensure('cus_AAAAAAAA'));
  assert.equal(r.entityId, s2.companyId);
  assert.equal(r.officeSetUp, true);
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
