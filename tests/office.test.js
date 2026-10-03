/**
 * 事務所API（/api/office）のテスト
 * 保存先はメモリ、サブスク確認と時計は差し替える。確かめたいのは次の点：
 *   ・他社のデータは読めない・書けない
 *   ・事務所コードを間違え続けるとロックされる／札は作り直しで無効になる
 *   ・納入枠の消化は「工場の値があればそれ、なければこちら」で、確定と見込みが分かれる
 *   ・入力は検査され、不正な値は保存されない
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.LICENSE_SECRET = 'テスト用の十分に長い署名鍵-0123456789';

const lib = await import('../api/_lib.js');
const { createOffice } = await import('../api/_office-core.js');
const { memoryStore } = await import('../api/_office-store.js');
const { formatVolume } = await import('../src/js/jas.js');
const { CONSENT_VERSION: CONSENT } = await import('../src/js/office-rules.js');

const EMAILS = { cus_A: 'owner-a@example.com', cus_B: 'owner-b@example.com', cus_C: 'owner-c@example.com' };

function setupEnv({ active = new Set(['sub_A', 'sub_B']), limits } = {}) {
  const clock = { t: Date.UTC(2026, 9, 5, 0, 0, 0) };     // 2026-10-05 09:00 JST
  const store = memoryStore(() => clock.t);
  const stripeDown = { v: false };
  const office = createOffice({
    store,
    now: () => clock.t,
    isSubscriptionActive: async (id) => { if (stripeDown.v) throw new Error('down'); return active.has(id); },
    getCustomerEmail: async (p) => EMAILS[p.c] ?? null,
    limits: { verifyVolume: false, ...limits },        // 既存テストは材積に適当な整数を使うため、検算は専用のテストで確かめる
  });
  const call = async (body) => (await office.handle(body));
  const ok = async (body) => {
    const r = await call(body);
    assert.equal(r.payload.ok, true, `${body.op}: ${JSON.stringify(r.payload)}`);
    return r.payload;
  };
  const err = async (body, code, status) => {
    const r = await call(body);
    assert.equal(r.payload.ok, false, `${body.op} should fail`);
    assert.equal(r.payload.error, code, JSON.stringify(r.payload));
    if (status) assert.equal(r.status, status);
    return r.payload;
  };
  return { office, store, clock, stripeDown, active, call, ok, err };
}

const codeA = lib.signToken({ s: 'sub_A', c: 'cus_A' });
const codeB = lib.signToken({ s: 'sub_B', c: 'cus_B' });

async function companyWithOffice(env, code) {
  const s = await env.ok({ op: 'office.setup', consent: CONSENT, code, email: EMAILS[lib.verifyToken(code).c] });
  return { token: s.token, officeCode: s.officeCode, cid: s.companyId, code };
}

const ticket = (over = {}) => ({
  id: 'tk-0001', dateStr: '2026-10-05', ticketNo: '001', truck: '岩手100あ1', destination: '秋田プライウッド',
  ownCompany: '杉澤林業', note: '', outputAt: 1,
  lots: [{
    species: 'カラマツ', lengthM: '4.00', minD: 14, maxD: 30, site: '本谷', siteId: null,
    rows: [{ d: 20, n: 10, volNum: String(10n * 16n * 4_000_000n * 1n) }],     // 値は検査対象でないので適当な整数
  }],
  ...over,
});

/* ------------------------------------------------------------------ */
test('保存先が未設定なら、何も保存せず not_configured を返す', async () => {
  const office = createOffice({ store: null });
  const r = await office.handle({ op: 'feed', code: codeA });
  assert.deepEqual(r.payload, { ok: false, error: 'not_configured' });
});

test('知らない操作は400、大きすぎる本体は413', async () => {
  const env = setupEnv();
  assert.equal((await env.call({ op: 'nope' })).status, 400);
  assert.equal((await env.call({ op: 'feed', code: 'x'.repeat(130_000) })).status, 413);
});

test('初期設定：事務所コードは一度だけ表示され、二度目の設定はできない', async () => {
  const env = setupEnv();
  const s = await env.ok({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_A });
  assert.match(s.officeCode, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.match(s.companyId, /^[0-9A-HJKMNP-TV-Z]{8}$/);
  await env.err({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_A }, 'already_setup');
});

test('初期設定：偽のライセンスコード・無効なサブスクは通らない', async () => {
  const env = setupEnv();
  await env.err({ op: 'office.setup', consent: CONSENT, code: codeA.slice(0, -2) + 'xx', email: EMAILS.cus_A }, 'invalid_code');
  await env.err({ op: 'office.setup', consent: CONSENT, code: 'でたらめ', email: EMAILS.cus_A }, 'invalid_code');
  const dead = lib.signToken({ s: 'sub_dead', c: 'cus_dead' });
  await env.err({ op: 'office.setup', consent: CONSENT, code: dead, email: 'x@example.com' }, 'subscription_inactive', 402);
});

test('サーバーには事務所コードの平文を残さない', async () => {
  const env = setupEnv();
  const s = await env.ok({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_A });
  const raw = await env.store.get(`co:${s.companyId}:auth`);
  assert.ok(!raw.includes(s.officeCode.replaceAll('-', '')));
  assert.match(raw, /"hash":"[0-9a-f]{64}"/);
});

test('ログイン：正しい事務所コードで札が得られる。ゆらぎ（小文字・空白）も許す', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  const l = await env.ok({ op: 'office.login', code: codeA, officeCode: co.officeCode.toLowerCase().replaceAll('-', ' ') });
  assert.equal(l.companyId, co.cid);
  await env.ok({ op: 'site.list', token: l.token });
});

test('ログイン：間違えると回数が減り、規定回数でロックされる。成功すれば数え直し', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  const first = await env.err({ op: 'office.login', code: codeA, officeCode: 'AAAA-AAAA-AAAA' }, 'bad_office_code');
  assert.equal(first.triesLeft, 7);
  for (let i = 0; i < 6; i += 1) await env.err({ op: 'office.login', code: codeA, officeCode: 'AAAA-AAAA-AAAA' }, 'bad_office_code');
  await env.err({ op: 'office.login', code: codeA, officeCode: 'AAAA-AAAA-AAAA' }, 'locked', 429);
  // ロック中は、正しいコードでも入れない
  await env.err({ op: 'office.login', code: codeA, officeCode: co.officeCode }, 'locked', 429);
  // 15分たてば解ける
  env.clock.t += 16 * 60 * 1000;
  await env.ok({ op: 'office.login', code: codeA, officeCode: co.officeCode });
});

test('ライセンスコードだけでは事務所の操作ができない（運転手は事務所に入れない）', async () => {
  const env = setupEnv();
  await companyWithOffice(env, codeA);
  await env.err({ op: 'site.list', code: codeA }, 'unauthorized', 401);
  await env.err({ op: 'quota.put', code: codeA, quota: {} }, 'unauthorized', 401);
  await env.err({ op: 'ticket.list', token: lib.signToken({ s: 'x' }) }, 'unauthorized', 401);
});

test('札の偽造・期限切れ・事務所コード再発行後の旧札は無効', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  await env.ok({ op: 'site.list', token: co.token });
  // 別の鍵で署名した札（ライセンスコードの署名を流用）
  await env.err({ op: 'site.list', token: codeA }, 'unauthorized', 401);
  // 改ざん
  await env.err({ op: 'site.list', token: co.token.slice(0, -3) + 'abc' }, 'unauthorized', 401);
  // 再発行で、古い札が全部無効になる
  const re = await env.ok({ op: 'office.resetCode', token: co.token });
  await env.err({ op: 'site.list', token: co.token }, 'unauthorized', 401);
  await env.ok({ op: 'site.list', token: re.token });
  await env.err({ op: 'office.login', code: codeA, officeCode: co.officeCode }, 'bad_office_code');
  await env.ok({ op: 'office.login', code: codeA, officeCode: re.officeCode });
  // 30日で期限切れ
  env.clock.t += 31 * 86_400_000;
  await env.err({ op: 'site.list', token: re.token }, 'unauthorized', 401);
});

test('会社どうしのデータは見えない・書けない', async () => {
  const env = setupEnv();
  const a = await companyWithOffice(env, codeA);
  const b = await companyWithOffice(env, codeB);
  assert.notEqual(a.cid, b.cid);

  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket() });
  await env.ok({ op: 'site.put', token: a.token, site: { name: '本谷' } });
  await env.ok({ op: 'quota.put', token: a.token, quota: { destination: '秋田プライウッド', amount: '400', from: '2026-10-01', to: '2026-10-31' } });
  await env.ok({ op: 'notice.put', token: a.token, notice: { kind: 'closed', body: '明日は納入できません' } });

  assert.equal((await env.ok({ op: 'ticket.list', token: b.token })).tickets.length, 0);
  assert.equal((await env.ok({ op: 'site.list', token: b.token })).sites.length, 0);
  assert.equal((await env.ok({ op: 'quota.list', token: b.token })).quotas.length, 0);
  assert.equal((await env.ok({ op: 'notice.list', token: b.token })).notices.length, 0);
  const feedB = await env.ok({ op: 'feed', code: codeB });
  assert.equal(feedB.sites.length + feedB.quotas.length + feedB.notices.length, 0);
  // B の運転手が A の便を消そうとしても、B の領域には無いので何も起きない
  await env.ok({ op: 'ticket.delete', token: b.token, id: 'tk-0001' });
  assert.equal((await env.ok({ op: 'ticket.list', token: a.token })).tickets.length, 1);
});

test('契約が切れた会社は、現場の端末も事務所端末も使えない。ただしStripeに繋がらないだけなら最近までの確認結果で通す', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  await env.ok({ op: 'feed', code: codeA });

  // 通信できない：キャッシュ（1時間以内）があるのでそのまま通る
  env.stripeDown.v = true;
  env.clock.t += 2 * 3600_000;                       // キャッシュ期限切れ → 再確認を試みて失敗
  await env.ok({ op: 'feed', code: codeA });         // 最近まで有効だったので通す
  await env.ok({ op: 'site.list', token: co.token });
  env.clock.t += 31 * 86_400_000;                    // 30日を超えて確認できない
  await env.err({ op: 'feed', code: codeA }, 'subscription_unverified', 503);

  // 解約
  env.stripeDown.v = false;
  env.active.delete('sub_A');
  await env.err({ op: 'feed', code: codeA }, 'subscription_inactive', 402);
  await env.err({ op: 'site.list', token: co.token }, 'unauthorized', 401);   // 札自体も30日で切れている
});

test('事務所が未設定の会社の端末は feed で office_not_set_up を受け取る', async () => {
  const env = setupEnv();
  await env.err({ op: 'feed', code: codeA }, 'office_not_set_up');
  await env.err({ op: 'ticket.put', code: codeA, ticket: ticket() }, 'office_not_set_up');
});

/* ---------------- 便 ---------------- */
test('便の保存：合計はサーバーが足し直す（クライアントの合計は信用しない）', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  const t = ticket();
  t.lots[0].rows = [{ d: 20, n: 3, volNum: '300' }, { d: 22, n: 2, volNum: '500' }];
  t.totalCount = 999; t.lots[0].count = 999; t.lots[0].volNum = '1';
  await env.ok({ op: 'ticket.put', code: codeA, ticket: t });
  const { tickets } = await env.ok({ op: 'ticket.list', token: co.token });
  assert.equal(tickets[0].totalCount, 5);
  assert.equal(tickets[0].totalVolNum, '800');
  assert.equal(tickets[0].lots[0].count, 5);
});

test('便の保存：不正な値は保存されない', async () => {
  const env = setupEnv();
  const bad = (fn) => { const t = ticket(); fn(t); return t; };
  const cases = [
    bad((t) => { t.id = 'あ'; }),
    bad((t) => { t.dateStr = '2026-13-45'; }),
    bad((t) => { t.lots = []; }),
    bad((t) => { t.lots[0].lengthM = 'abc'; }),
    bad((t) => { t.lots[0].species = ''; }),
    bad((t) => { t.lots[0].siteId = 'ILLEGAL1'; }),
    bad((t) => { t.lots[0].rows[0].volNum = '-5'; }),
    bad((t) => { t.lots[0].rows[0].n = 1.5; }),
    bad((t) => { t.note = 'あ'.repeat(501); }),
  ];
  const co = await companyWithOffice(env, codeA);
  for (const c of cases) {
    const r = await env.call({ op: 'ticket.put', code: codeA, ticket: c });
    assert.equal(r.payload.ok, false, JSON.stringify(r.payload));
  }
  assert.equal((await env.ok({ op: 'ticket.list', token: co.token })).tickets.length, 0);
});

test('同じ便を再送しても1件のまま、工場の検収値は消えない', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket() });
  await env.ok({ op: 'ticket.setFactory', token: co.token, id: 'tk-0001', volume: '1.234' });
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ note: '追記' }) });
  const { tickets } = await env.ok({ op: 'ticket.list', token: co.token });
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].note, '追記');
  assert.equal(formatVolume(BigInt(tickets[0].factoryNum)), '1.234');
});

test('便の一覧：日付で絞れて、新しい順に並び、ページ送りできる', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  for (const [i, d] of [[1, '2026-10-01'], [2, '2026-10-03'], [3, '2026-10-05'], [4, '2026-10-05']]) {
    await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: `tk-000${i}`, dateStr: d, ticketNo: String(i).padStart(3, '0') }) });
  }
  const all = (await env.ok({ op: 'ticket.list', token: co.token })).tickets.map((t) => t.id);
  assert.deepEqual(all, ['tk-0004', 'tk-0003', 'tk-0002', 'tk-0001']);
  const ranged = (await env.ok({ op: 'ticket.list', token: co.token, from: '2026-10-02', to: '2026-10-04' })).tickets.map((t) => t.id);
  assert.deepEqual(ranged, ['tk-0002']);
  const p1 = await env.ok({ op: 'ticket.list', token: co.token, limit: 3 });
  assert.equal(p1.tickets.length, 3); assert.equal(p1.hasMore, true);
  const p2 = await env.ok({ op: 'ticket.list', token: co.token, limit: 3, offset: 3 });
  assert.deepEqual(p2.tickets.map((t) => t.id), ['tk-0001']); assert.equal(p2.hasMore, false);
});

test('工場の検収値：書式の検査・消去・存在しない便', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket() });
  await env.err({ op: 'ticket.setFactory', token: co.token, id: 'tk-0001', volume: '1.2345' }, 'invalid');
  await env.err({ op: 'ticket.setFactory', token: co.token, id: 'nothing', volume: '1' }, 'not_found');
  await env.ok({ op: 'ticket.setFactory', token: co.token, id: 'tk-0001', volume: '2' });
  const cleared = await env.ok({ op: 'ticket.setFactory', token: co.token, id: 'tk-0001', volume: '' });
  assert.equal(cleared.ticket.factoryNum, null);
});

/* ---------------- 納入枠 ---------------- */
const N = (m3) => String(BigInt(Math.round(m3 * 1000)) * 40_000_000n);      // m³ → 内部単位

function lotOf(species, m3, over = {}) {
  return { species, lengthM: '4.00', minD: 14, maxD: 30, site: '本谷', siteId: null, rows: [{ d: 20, n: 1, volNum: N(m3) }], ...over };
}

test('納入枠の消化：工場の値があればそれ、なければこちらの値。確定と見込みを分けて返す', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  const q = (await env.ok({ op: 'quota.put', token: co.token, quota: {
    destination: '秋田プライウッド', species: 'カラマツ', amount: '400', from: '2026-10-01', to: '2026-10-31',
    weekdays: [1, 2, 3, 4, 5], timeFrom: '06:00', timeTo: '17:00',
  } })).quota;

  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-1001', lots: [lotOf('カラマツ', 30)] }) });
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-1002', ticketNo: '002', lots: [lotOf('カラマツ', 20)] }) });
  // 工場が測り直したら 19.5 だった
  await env.ok({ op: 'ticket.setFactory', token: co.token, id: 'tk-1002', volume: '19.5' });
  // 別の工場・別の樹種・期間外は数えない
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-1003', ticketNo: '003', destination: '別の工場', lots: [lotOf('カラマツ', 50)] }) });
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-1004', ticketNo: '004', lots: [lotOf('スギ', 40)] }) });
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-1005', ticketNo: '005', dateStr: '2026-11-02', lots: [lotOf('カラマツ', 60)] }) });

  const { usage } = await env.ok({ op: 'quota.list', token: co.token });
  const u = usage[q.id];
  assert.equal(formatVolume(BigInt(u.confirmedNum)), '19.500');
  assert.equal(formatVolume(BigInt(u.estimatedNum)), '30.000');
  assert.equal(u.confirmedTickets, 1);
  assert.equal(u.estimatedTickets, 1);
});

test('納入枠の消化：複数の材を積んだ便の工場値は、枠に関係する材へ按分する', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  const q = (await env.ok({ op: 'quota.put', token: co.token, quota: {
    destination: '秋田プライウッド', species: 'カラマツ', amount: '400', from: '2026-10-01', to: '2026-10-31',
  } })).quota;
  // カラマツ 30 + スギ 10 = 40、工場の値は 36 → カラマツのぶんは 36 × 30/40 = 27
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-2001', lots: [lotOf('カラマツ', 30), lotOf('スギ', 10)] }) });
  await env.ok({ op: 'ticket.setFactory', token: co.token, id: 'tk-2001', volume: '36' });
  const u = (await env.ok({ op: 'quota.list', token: co.token })).usage[q.id];
  assert.equal(formatVolume(BigInt(u.confirmedNum)), '27.000');
});

test('納入枠：樹種を空にすると全樹種が対象。工場名は表記ゆれ（空白・全角）を吸収する', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  const q = (await env.ok({ op: 'quota.put', token: co.token, quota: { destination: '秋田 プライウッド', amount: '100', from: '2026-10-01', to: '2026-10-31' } })).quota;
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-3001', lots: [lotOf('スギ', 5), lotOf('ヒノキ', 7)] }) });
  const u = (await env.ok({ op: 'quota.list', token: co.token })).usage[q.id];
  assert.equal(formatVolume(BigInt(u.estimatedNum)), '12.000');
});

test('納入枠の入力検査', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  const base = { destination: '工場', amount: '100', from: '2026-10-01', to: '2026-10-31' };
  const put = (over) => env.call({ op: 'quota.put', token: co.token, quota: { ...base, ...over } });
  for (const over of [
    { amount: '0' }, { amount: 'abc' }, { amount: '' }, { destination: '' },
    { from: '2026-11-01' }, { to: '2026-10-01x' }, { weekdays: [7] }, { timeFrom: '18:00', timeTo: '06:00' },
    { timeFrom: '6' }, { imageId: 'bad' },
  ]) {
    const r = await put(over);
    assert.equal(r.payload.ok, false, JSON.stringify(over));
  }
  assert.equal((await put({})).payload.ok, true);
});

test('納入枠：修正・削除と、現場の端末への配信（終わった枠は送らない）', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  const a = (await env.ok({ op: 'quota.put', token: co.token, quota: { destination: '工場', amount: '100', from: '2026-10-01', to: '2026-10-31' } })).quota;
  await env.ok({ op: 'quota.put', token: co.token, quota: { destination: '終わった工場', amount: '100', from: '2026-08-01', to: '2026-08-31' } });
  await env.ok({ op: 'quota.put', token: co.token, quota: { destination: '工場', amount: '100', from: '2026-10-01', to: '2026-10-31', status: 'archived' } });
  const edited = (await env.ok({ op: 'quota.put', token: co.token, quota: { id: a.id, destination: '工場', amount: '150', from: '2026-10-01', to: '2026-10-31' } })).quota;
  assert.equal(edited.id, a.id); assert.equal(edited.amount, '150');
  await env.err({ op: 'quota.put', token: co.token, quota: { id: 'ZZZZZZZZ', destination: '工場', amount: '1', from: '2026-10-01', to: '2026-10-31' } }, 'not_found');
  const feed = await env.ok({ op: 'feed', code: codeA });
  assert.deepEqual(feed.quotas.map((q) => q.id), [a.id]);
  await env.ok({ op: 'quota.delete', token: co.token, id: a.id });
  assert.equal((await env.ok({ op: 'feed', code: codeA })).quotas.length, 0);
});

/* ---------------- お知らせ ---------------- */
test('お知らせ：登録・検査・期限が切れたものは配信しない', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  await env.err({ op: 'notice.put', token: co.token, notice: { kind: 'oops', body: 'x' } }, 'invalid');
  await env.err({ op: 'notice.put', token: co.token, notice: { kind: 'closed', body: '' } }, 'invalid');
  await env.err({ op: 'notice.put', token: co.token, notice: { kind: 'closed', body: 'x', from: '2026-10-10', to: '2026-10-09' } }, 'invalid');
  const live = (await env.ok({ op: 'notice.put', token: co.token, notice: { kind: 'restricted', destination: '工場', place: '第1土場', body: '工事のため第3土場の係員に従ってください', from: '2026-10-05', to: '2026-10-07' } })).notice;
  await env.ok({ op: 'notice.put', token: co.token, notice: { kind: 'closed', body: '終わった', from: '2026-09-01', to: '2026-09-02' } });
  await env.ok({ op: 'notice.put', token: co.token, notice: { kind: 'info', body: '期限なし' } });
  const feed = await env.ok({ op: 'feed', code: codeA });
  assert.equal(feed.notices.length, 2);
  assert.ok(feed.notices.some((n) => n.id === live.id));
  // 事務所の一覧には終わったものも残る
  assert.equal((await env.ok({ op: 'notice.list', token: co.token })).notices.length, 3);
  await env.ok({ op: 'notice.delete', token: co.token, id: live.id });
  assert.equal((await env.ok({ op: 'feed', code: codeA })).notices.length, 1);
});

/* ---------------- 現場の台帳 ---------------- */
test('現場：IDはサーバーが発行し、名前が変わってもIDは変わらない', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  const s = (await env.ok({ op: 'site.put', token: co.token, site: { name: ' 本谷　２号 ', attrs: { rinban: '12-ろ' } } })).site;
  assert.match(s.id, /^[0-9A-HJKMNP-TV-Z]{8}$/);
  assert.equal(s.name, '本谷 2号');
  const renamed = (await env.ok({ op: 'site.put', token: co.token, site: { id: s.id, name: '本谷第2', closed: true } })).site;
  assert.equal(renamed.id, s.id);
  assert.equal(renamed.closed, true);
  assert.equal(renamed.createdAt, s.createdAt);
});

test('現場：名前・別名が他の現場とぶつかると作れない（表記ゆれも同じ扱い）', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  const a = (await env.ok({ op: 'site.put', token: co.token, site: { name: '本谷', aliases: ['ホンダニ'] } })).site;
  const r1 = await env.err({ op: 'site.put', token: co.token, site: { name: '本 谷' } }, 'name_taken');
  assert.equal(r1.with.id, a.id);
  await env.err({ op: 'site.put', token: co.token, site: { name: '向かい沢', aliases: ['ﾎﾝﾀﾞﾆ'] } }, 'name_taken');
  const b = (await env.ok({ op: 'site.put', token: co.token, site: { name: '向かい沢' } })).site;
  await env.err({ op: 'site.put', token: co.token, site: { id: b.id, name: '向かい沢', aliases: ['本谷'] } }, 'name_taken');
  // 自分自身の名前は何度保存してもよい
  await env.ok({ op: 'site.put', token: co.token, site: { id: a.id, name: '本谷', aliases: ['ホンダニ', '本谷山'] } });
});

test('現場：入力の検査（空・長すぎ・不正なID・存在しないID）', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  await env.err({ op: 'site.put', token: co.token, site: { name: '   ' } }, 'invalid');
  await env.err({ op: 'site.put', token: co.token, site: { name: 'あ'.repeat(31) } }, 'too_long');
  await env.err({ op: 'site.put', token: co.token, site: { id: 'bad', name: 'x' } }, 'invalid');
  await env.err({ op: 'site.put', token: co.token, site: { id: 'ZZZZZZZZ', name: 'x' } }, 'not_found');
});

test('現場の端末は feed で台帳を受け取れる（完了した現場も、引き当て用に含む）', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  await env.ok({ op: 'site.put', token: co.token, site: { name: '本谷' } });
  await env.ok({ op: 'site.put', token: co.token, site: { name: '古い現場', closed: true } });
  const feed = await env.ok({ op: 'feed', code: codeA });
  assert.deepEqual(feed.sites.map((s) => [s.name, s.closed]), [['本谷', false], ['古い現場', true]]);
});

test('名寄せの候補：台帳で引けない現場名だけが、使われた回数つきで出る', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  await env.ok({ op: 'site.put', token: co.token, site: { name: '本谷', aliases: ['ホンダニ'] } });
  const lots = (site) => [lotOf('スギ', 1, { site })];
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-4001', lots: lots('本谷') }) });
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-4002', ticketNo: '002', lots: lots('ホンダニ') }) });
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-4003', ticketNo: '003', lots: lots('裏山') }) });
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-4004', ticketNo: '004', dateStr: '2026-10-06', lots: lots('裏 山') }) });
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-4005', ticketNo: '005', lots: lots('') }) });
  const { unlinked } = await env.ok({ op: 'site.unlinked', token: co.token });
  assert.equal(unlinked.length, 1);
  assert.equal(unlinked[0].count, 2);
  assert.equal(unlinked[0].lastDate, '2026-10-06');
});

/* ---------------- 受信箱（スマホの写真） ---------------- */
const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

test('受信箱：写真を受け取り、一覧・取得・削除ができる。使用中の写真は消せない', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  await env.err({ op: 'inbox.put', token: co.token, image: 'data:text/html;base64,PGI+' }, 'invalid');
  await env.err({ op: 'inbox.put', token: co.token, image: 'http://evil.example/x.jpg' }, 'invalid');
  const item = (await env.ok({ op: 'inbox.put', token: co.token, image: IMG, caption: '10/5 FAX' })).item;
  assert.equal((await env.ok({ op: 'inbox.list', token: co.token })).items[0].caption, '10/5 FAX');
  assert.equal((await env.ok({ op: 'image.get', token: co.token, id: item.id })).image, IMG);
  assert.equal((await env.ok({ op: 'image.get', code: codeA, id: item.id })).image, IMG);   // 現場の端末も見られる

  const q = (await env.ok({ op: 'quota.put', token: co.token, quota: { destination: '工場', amount: '10', from: '2026-10-01', to: '2026-10-31', imageId: item.id } })).quota;
  await env.err({ op: 'inbox.delete', token: co.token, id: item.id }, 'in_use');
  await env.ok({ op: 'quota.delete', token: co.token, id: q.id });
  await env.ok({ op: 'inbox.delete', token: co.token, id: item.id });
  await env.err({ op: 'image.get', token: co.token, id: item.id }, 'not_found');
});

test('受信箱：他社の写真は取得できない。大きすぎる写真は拒否', async () => {
  const env = setupEnv();
  const a = await companyWithOffice(env, codeA);
  const b = await companyWithOffice(env, codeB);
  const item = (await env.ok({ op: 'inbox.put', token: a.token, image: IMG })).item;
  await env.err({ op: 'image.get', token: b.token, id: item.id }, 'not_found');
  await env.err({ op: 'image.get', code: codeB, id: item.id }, 'not_found');
  const big = `data:image/jpeg;base64,${'A'.repeat(710_000)}`;
  await env.err({ op: 'inbox.put', token: a.token, image: big }, 'too_large', 413);
});

test('別のアプリの契約を、同じ事業体につなげる', async () => {
  const env = setupEnv();
  const a = await companyWithOffice(env, codeA);
  await env.err({ op: 'feed', code: codeB }, 'office_not_set_up');
  await env.err({ op: 'office.link', token: a.token, code: codeB }, 'bad_email');                                 // メール無しでは、つなげられない
  await env.err({ op: 'office.link', token: a.token, code: codeB, email: 'wrong@example.com' }, 'bad_email');       // 他人のメールでも
  await env.ok({ op: 'office.link', token: a.token, code: codeB, email: EMAILS.cus_B });
  await env.ok({ op: 'site.put', token: a.token, site: { name: '本谷' } });
  assert.equal((await env.ok({ op: 'feed', code: codeB })).sites[0].name, '本谷');
  // すでに別の事業体につながっている契約は奪えない
  const other = lib.signToken({ s: 'sub_C', c: 'cus_C' });
  env.active.add('sub_C');
  const c = await companyWithOffice(env, other);
  await env.err({ op: 'office.link', token: c.token, code: codeB, email: EMAILS.cus_B }, 'license_in_use');
});

test('入力に混じった制御文字は取り除かれる', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  const n = (await env.ok({ op: 'notice.put', token: co.token, notice: { kind: 'info', body: 'こんにちは\u0000\u0007世界' } })).notice;
  assert.equal(n.body, 'こんにちは世界');
});

/* ================================================================
 * セキュリティ点検（2026-10-01）で見つかった問題の再発防止
 * ================================================================ */
test('【点検A】ライセンスコードだけを知る運転手は、事務所の初期設定を先取りできない', async () => {
  const env = setupEnv();
  await env.err({ op: 'office.setup', consent: CONSENT, code: codeA }, 'bad_email');                                            // メールなし（違うものとして数える）
  await env.err({ op: 'office.setup', consent: CONSENT, code: codeA, email: 'driver@example.com' }, 'bad_email');            // 当てずっぽう
  // 本人（購入時のメール）は、大文字小文字・全角・前後の空白の違いがあっても設定できる
  const s = await env.ok({ op: 'office.setup', consent: CONSENT, code: codeA, email: '  Owner-A＠Example.com ' });
  assert.ok(s.officeCode);
});

test('【点検A】メールアドレスの当てずっぽうは、回数でロックされる', async () => {
  const env = setupEnv();
  for (let i = 0; i < 7; i += 1) await env.err({ op: 'office.setup', consent: CONSENT, code: codeA, email: `g${i}@example.com` }, 'bad_email');
  await env.err({ op: 'office.setup', consent: CONSENT, code: codeA, email: 'g8@example.com' }, 'locked', 429);
  await env.err({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_A }, 'locked', 429);          // ロック中は本人でも待つ
  env.clock.t += 16 * 60 * 1000;
  await env.ok({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_A });
});

test('【点検A】購入時のメールが登録されていない契約は、初期設定できない（安全側）', async () => {
  const env = setupEnv();
  const noMail = lib.signToken({ s: 'sub_A', c: 'cus_nomail' });
  await env.err({ op: 'office.setup', consent: CONSENT, code: noMail, email: 'a@example.com' }, 'no_email');
});

test('【点検A】事務所コードをなくしても、契約者本人はメールで復旧できる。古い札・コードは無効になる', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  await env.err({ op: 'office.recover', code: codeA, email: 'driver@example.com' }, 'bad_email');
  await env.err({ op: 'office.recover', code: codeB, email: EMAILS.cus_B }, 'office_not_set_up');          // 設定していない会社
  const r = await env.ok({ op: 'office.recover', code: codeA, email: EMAILS.cus_A });
  assert.notEqual(r.officeCode, co.officeCode);
  assert.equal(r.companyId, co.cid);                                                                      // 同じ事業体のまま（データは残る）
  await env.err({ op: 'site.list', token: co.token }, 'unauthorized', 401);
  await env.err({ op: 'office.login', code: codeA, officeCode: co.officeCode }, 'bad_office_code');
  await env.ok({ op: 'site.list', token: r.token });
  await env.ok({ op: 'office.login', code: codeA, officeCode: r.officeCode });
});

test('【点検A・E】運転手が事務所コードを間違え続けて締め出しても、本人はメールで復旧して入れる', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  for (let i = 0; i < 8; i += 1) await env.call({ op: 'office.login', code: codeA, officeCode: 'AAAA-AAAA-AAAA' });
  await env.err({ op: 'office.login', code: codeA, officeCode: co.officeCode }, 'locked', 429);
  const r = await env.ok({ op: 'office.recover', code: codeA, email: EMAILS.cus_A });
  await env.ok({ op: 'site.list', token: r.token });
  await env.ok({ op: 'office.login', code: codeA, officeCode: r.officeCode });                          // 復旧でロックも解ける
});

test('【点検B】1社が保存できる便の数・1分あたりの送信数・1便の大きさに上限がある', async () => {
  const env = setupEnv({ limits: { maxTickets: 3, putsPerMinute: 5 } });
  await companyWithOffice(env, codeA);
  for (let i = 1; i <= 3; i += 1) await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: `tk-${i}000`, ticketNo: String(i) }) });
  await env.err({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-4000', ticketNo: '4' }) }, 'limit_reached');
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-1000', ticketNo: '1', note: '再送は件数に数えない' }) });
  await env.err({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-1000' }) }, 'rate_limited', 429);
  env.clock.t += 61_000;
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-1000' }) });
});

test('【点検B】極端に大きい便は受け付けない', async () => {
  const env = setupEnv();
  await companyWithOffice(env, codeA);
  const big = ticket();
  big.lots = Array.from({ length: 20 }, (_, i) => ({
    species: `樹種${i}`, lengthM: '4.00', minD: 6, maxD: 72, site: '', siteId: null,
    rows: Array.from({ length: 80 }, (__, j) => ({ d: 6 + j, n: 99999, volNum: '9'.repeat(30) })),
  }));
  await env.err({ op: 'ticket.put', code: codeA, ticket: big }, 'too_large', 413);
  const manyLots = ticket(); manyLots.lots = Array.from({ length: 21 }, () => lotOf('スギ', 1));
  await env.err({ op: 'ticket.put', code: codeA, ticket: manyLots }, 'invalid');
});

test('【点検B】枠の集計で読む便が多すぎるときは、黙って落とさず truncated を返す', async () => {
  const env = setupEnv({ limits: { scan: 2 } });
  const co = await companyWithOffice(env, codeA);
  const q = (await env.ok({ op: 'quota.put', token: co.token, quota: { destination: '秋田プライウッド', amount: '100', from: '2026-10-01', to: '2026-10-31' } })).quota;
  for (let i = 1; i <= 3; i += 1) await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: `tk-${i}000`, ticketNo: String(i), lots: [lotOf('スギ', 1)] }) });
  assert.equal((await env.ok({ op: 'quota.list', token: co.token })).usage[q.id].truncated, true);
});

test('【点検C】伝票番号に日付などの大きな数を入れても、別の日の便として扱われない', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-big1', dateStr: '2026-10-05', ticketNo: '20261005' }) });
  const day5 = (await env.ok({ op: 'ticket.list', token: co.token, from: '2026-10-05', to: '2026-10-05' })).tickets.map((t) => t.id);
  const day25 = (await env.ok({ op: 'ticket.list', token: co.token, from: '2026-10-25', to: '2026-10-25' })).tickets.map((t) => t.id);
  assert.deepEqual(day5, ['tk-big1']);
  assert.deepEqual(day25, []);
});

test('【点検F】配列の中身が null でも 500 にならず invalid を返す。存在しない日付・年は通らない', async () => {
  const env = setupEnv();
  await companyWithOffice(env, codeA);
  const nullLot = ticket(); nullLot.lots = [null];
  const nullRow = ticket(); nullRow.lots[0].rows = [null];
  await env.err({ op: 'ticket.put', code: codeA, ticket: nullLot }, 'invalid', 200);
  await env.err({ op: 'ticket.put', code: codeA, ticket: nullRow }, 'invalid', 200);
  for (const d of ['2026-02-31', '2026-13-01', '2026-04-31', '1999-12-31', '2101-01-01']) {
    await env.err({ op: 'ticket.put', code: codeA, ticket: ticket({ dateStr: d }) }, 'invalid');
  }
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-leap', dateStr: '2028-02-29' }) });   // うるう日は通る
});

test('【点検F】一覧の offset・limit に変な値が来ても、エラーにならず既定値で動く', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket() });
  for (const v of ['Infinity', 1.5, -1, 'abc', null, 1e30]) {
    const r = await env.ok({ op: 'ticket.list', token: co.token, offset: v, limit: v });
    assert.ok(Array.isArray(r.tickets));
  }
});

test('【点検F】お知らせの日時も、存在しない日付・時刻は通らない', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  for (const from of ['2026-02-31', '2026-10-05T25:00', '2026-10-05T10:60']) {
    await env.err({ op: 'notice.put', token: co.token, notice: { kind: 'info', body: 'x', from } }, 'invalid');
  }
  await env.ok({ op: 'notice.put', token: co.token, notice: { kind: 'info', body: 'x', from: '2026-10-05T23:59' } });
});

test('【点検G】Stripeの返事の種類で扱いを分ける（404は無効・設定ミスは猶予なし・通信障害だけ猶予）', async () => {
  const store = memoryStore();
  const clock = { t: Date.UTC(2026, 9, 5) };
  const office = createOffice({ store, now: () => clock.t, getCustomerEmail: async (p) => EMAILS[p.c] });
  const stripe = { mode: 'ok' };
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (stripe.mode === 'ok') return { ok: true, status: 200, json: async () => ({ id: 'sub_A', status: 'active', customer: 'cus_A', items: { data: [{ current_period_end: 1822102566 }] } }) };
    const status = { notfound: 404, unauthorized: 401, down: 503, network: 0 }[stripe.mode];
    if (status === 0) throw new Error('network');
    return { ok: false, status, json: async () => ({ error: { message: 'x' } }) };
  };
  try {
    const call = async (body) => (await office.handle(body)).payload;
    const s = await call({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_A });
    assert.equal(s.ok, true, JSON.stringify(s));
    const expire = () => { clock.t += 2 * 3600_000; };                     // 確認結果のキャッシュ（1時間）を切らす

    stripe.mode = 'down'; expire();
    assert.equal((await call({ op: 'feed', code: codeA })).ok, true, '5xx：最近有効だったので猶予で通す');
    stripe.mode = 'network'; expire();
    assert.equal((await call({ op: 'feed', code: codeA })).ok, true, '通信エラー：猶予で通す');
    stripe.mode = 'unauthorized'; expire();
    assert.equal((await call({ op: 'feed', code: codeA })).error, 'subscription_unverified', '401（鍵の誤り）：猶予を与えない');
    stripe.mode = 'notfound'; expire();
    assert.equal((await call({ op: 'feed', code: codeA })).error, 'subscription_inactive', '404（契約が無い）：無効');
    stripe.mode = 'ok'; expire();
    assert.equal((await call({ op: 'feed', code: codeA })).ok, true);
  } finally { globalThis.fetch = original; }
});

test('【点検H】工場の検収値は便とは別に保存され、現場からの再送・削除と競合しない', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket() });
  await env.ok({ op: 'ticket.setFactory', token: co.token, id: 'tk-0001', volume: '5' });
  // 便の本体を直接読んでも、工場の値は入っていない（別の場所にある）
  const raw = JSON.parse(await env.store.get(`co:${co.cid}:t:tk-0001`));
  assert.equal('factoryNum' in raw, false);
  // 再送しても消えない
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ note: '再送' }) });
  assert.equal(formatVolume(BigInt((await env.ok({ op: 'ticket.list', token: co.token })).tickets[0].factoryNum)), '5.000');
  // 便を削除して同じIDで送り直しても、昔の工場の値は引き継がれない
  await env.ok({ op: 'ticket.delete', token: co.token, id: 'tk-0001' });
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket() });
  assert.equal((await env.ok({ op: 'ticket.list', token: co.token })).tickets[0].factoryNum, null);
});

/* ================================================================
 * データの取り扱いへの同意（運営者が生データを閲覧し、研究・販売には匿名化して使う）
 * ================================================================ */
test('【同意】同意なしでは、事務所の初期設定ができない（何も作られない）', async () => {
  const env = setupEnv();
  const noConsent = { op: 'office.setup', code: codeA, email: EMAILS.cus_A };
  await env.err(noConsent, 'consent_required');
  await env.err({ ...noConsent, consent: 'old-version' }, 'consent_required');
  await env.err({ ...noConsent, consent: true }, 'consent_required');
  await env.err({ op: 'feed', code: codeA }, 'office_not_set_up');                // 何も作られていない
  const s = await env.ok({ ...noConsent, consent: CONSENT });
  const st = await env.ok({ op: 'office.status', token: s.token });
  assert.equal(st.consentOk, true);
  assert.ok(st.consentAt > 0);
});

test('【同意】同意文の版が変わると、事務所が改めて同意するまで、便の受信が止まる（データは残る）', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket() });
  // サーバー側の同意記録を古い版に書き換えて、版が変わった状況をつくる
  await env.store.set(`co:${co.cid}:consent`, JSON.stringify({ version: '2025-01-01', at: 1 }));
  assert.equal((await env.ok({ op: 'office.status', token: co.token })).consentOk, false);
  await env.err({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-0002', ticketNo: '002' }) }, 'consent_required');
  assert.equal((await env.ok({ op: 'ticket.list', token: co.token })).tickets.length, 1);        // 既存データは読める
  await env.ok({ op: 'feed', code: codeA });                                                     // 枠・お知らせの配信は止めない
  await env.err({ op: 'office.consent', token: co.token, consent: 'wrong' }, 'consent_required');
  await env.ok({ op: 'office.consent', token: co.token, consent: CONSENT });
  await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: 'tk-0002', ticketNo: '002' }) });
});

test('【点検2】本数0の行・材積が径級と本数に合わない行は受け付けない（集計の汚染・会社数の水増しを防ぐ）', async () => {
  const store = memoryStore();
  const office = createOffice({ store, isSubscriptionActive: async () => true, getCustomerEmail: async (p) => EMAILS[p.c] });   // 検算あり（既定）
  const { volumeNumerator } = await import('../src/js/jas.js');
  const s = await office.handle({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_A });
  assert.equal(s.payload.ok, true);
  const real = (d, n) => String(volumeNumerator('4.00', d) * BigInt(n));
  const put = (rows) => office.handle({ op: 'ticket.put', code: codeA, ticket: ticket({ lots: [{ species: 'ヒノキ', lengthM: '4.00', minD: 14, maxD: 30, site: '', siteId: null, rows }] }) });
  assert.equal((await put([{ d: 24, n: 7, volNum: real(24, 7) }])).payload.ok, true);                       // 正しい値
  assert.equal((await put([{ d: 24, n: 7, volNum: String(BigInt(real(24, 7)) + 5_000_000n) }])).payload.ok, true);   // 丸めの違いの範囲
  assert.equal((await put([{ d: 24, n: 0, volNum: '0' }])).payload.error, 'invalid');                       // 本数0
  assert.equal((await put([{ d: 24, n: 7, volNum: '0' }])).payload.error, 'invalid');                       // 材積0
  assert.equal((await put([{ d: 24, n: 7, volNum: real(24, 70) }])).payload.error, 'invalid');              // 10倍の材積
  assert.equal((await put([{ d: 24, n: 7, volNum: '1' }])).payload.error, 'invalid');
  assert.equal((await put([{ d: 24, n: 7, volNum: real(20, 7) }])).payload.error, 'invalid');               // 別の径級の材積
});

test('【点検7】事務所の初期設定で、会社の一覧の索引が契約との結びつきより先に書かれる（途中で失敗しても一覧から漏れない）', async () => {
  const env = setupEnv();
  const co = await companyWithOffice(env, codeA);
  assert.ok(await env.store.hget('companies', co.cid));
  // 同じ契約の2度目の設定は、索引を増やさない
  await env.err({ op: 'office.setup', consent: CONSENT, code: codeA, email: EMAILS.cus_A }, 'already_setup');
  assert.equal(Object.keys(await env.store.hgetall('companies')).length, 1);
});

/* ------------------------------------------------------------------
 * 車番・納入先・樹種のマスター
 * ------------------------------------------------------------------ */
test('マスター：事務所が登録すると、現場の端末が feed で受け取る。使わないものは送らない', async () => {
  const env = setupEnv();
  const a = await companyWithOffice(env, codeA);
  const truck = (await env.ok({ op: 'master.put', token: a.token, master: { kind: 'truck', name: '岩手100あ1234' } })).master;
  assert.match(truck.id, /^[0-9A-HJKMNP-TV-Z]{8}$/);
  const dest = (await env.ok({ op: 'master.put', token: a.token, master: { kind: 'destination', name: '秋田プライウッド', aliases: ['秋田PW'] } })).master;
  await env.ok({ op: 'master.put', token: a.token, master: { kind: 'species', name: 'カラマツ' } });
  const old = (await env.ok({ op: 'master.put', token: a.token, master: { kind: 'truck', name: '岩手100あ9999' } })).master;
  await env.ok({ op: 'master.put', token: a.token, master: { ...old, closed: true } });

  const list = (await env.ok({ op: 'master.list', token: a.token })).masters;
  assert.equal(list.truck.length, 2);                       // 事務所の一覧には「使わない」ものも出る
  assert.equal(list.truck.find((m) => m.id === old.id).closed, true);

  const feed = await env.ok({ op: 'feed', code: codeA });
  assert.deepEqual(feed.masters.trucks.map((m) => m.name), ['岩手100あ1234']);
  assert.deepEqual(feed.masters.destinations.map((m) => [m.id, m.name, m.aliases]), [[dest.id, '秋田プライウッド', ['秋田PW']]]);
  assert.deepEqual(feed.masters.species.map((m) => m.name), ['カラマツ']);
  assert.equal(truck.id, feed.masters.trucks[0].id);
});

test('マスター：名前は表記ゆれ（全角半角・空白・英字の大小）を吸収して、同じ種類の中では重ならない。種類が違えば同じ名前でもよい', async () => {
  const env = setupEnv();
  const a = await companyWithOffice(env, codeA);
  const put = (master) => ({ op: 'master.put', token: a.token, master });
  await env.ok(put({ kind: 'truck', name: '岩手100あ1234' }));
  const taken = await env.err(put({ kind: 'truck', name: '岩手 １００ あ １２３４' }), 'master_name_taken');
  assert.equal(taken.with.name, '岩手100あ1234');
  assert.equal(taken.kind, 'truck');
  await env.ok(put({ kind: 'destination', name: 'ABC工場' }));
  await env.err(put({ kind: 'destination', name: 'abc 工場' }), 'master_name_taken');
  await env.err(put({ kind: 'destination', name: '別の工場', aliases: ['ａｂｃ工場'] }), 'master_name_taken');   // 別名が他とぶつかる
  await env.ok(put({ kind: 'species', name: 'ABC工場' }));                                                          // 種類が違えばよい
});

test('マスター：名前を直してもIDは変わらない。入力は検査される', async () => {
  const env = setupEnv();
  const a = await companyWithOffice(env, codeA);
  const put = (master) => ({ op: 'master.put', token: a.token, master });
  const m = (await env.ok(put({ kind: 'species', name: 'からまつ' }))).master;
  const renamed = (await env.ok(put({ id: m.id, kind: 'species', name: 'カラマツ', aliases: ['唐松', '唐松', 'カラマツ', ''] }))).master;
  assert.equal(renamed.id, m.id);
  assert.equal(renamed.createdAt, m.createdAt);
  assert.deepEqual(renamed.aliases, ['唐松']);                 // 重複・本名と同じ・空は除く
  await env.err(put({ kind: 'bogus', name: 'x' }), 'invalid');
  await env.err(put({ kind: 'species', name: '   ' }), 'invalid');
  await env.err(put({ kind: 'species', name: 'あ'.repeat(31) }), 'too_long');
  await env.err(put({ id: 'bad', kind: 'species', name: 'x' }), 'invalid');
  await env.err(put({ id: 'ZZZZZZZZ', kind: 'species', name: 'x' }), 'not_found');
  await env.err(put({ kind: 'species', name: 'あ', aliases: ['い'.repeat(31)] }), 'too_long');
  // 「使わない」は真偽値だけを受け付ける（文字列の "false" を「使わない」と取り違えない）
  assert.equal((await env.ok(put({ id: m.id, kind: 'species', name: 'カラマツ', closed: 'false' }))).master.closed, false);
  // 種類をまたいだIDでは修正できない
  const t = (await env.ok(put({ kind: 'truck', name: '岩手100あ1' }))).master;
  await env.err(put({ id: t.id, kind: 'species', name: '何か' }), 'not_found');
});

test('マスター：他社のマスターは見えない・書けない。ライセンスコードだけでは登録できない', async () => {
  const env = setupEnv();
  const a = await companyWithOffice(env, codeA);
  const b = await companyWithOffice(env, codeB);
  await env.ok({ op: 'master.put', token: a.token, master: { kind: 'destination', name: 'A社の工場' } });
  assert.deepEqual((await env.ok({ op: 'feed', code: codeB })).masters.destinations, []);
  assert.deepEqual((await env.ok({ op: 'master.list', token: b.token })).masters.destination, []);
  await env.err({ op: 'master.put', code: codeA, master: { kind: 'truck', name: 'x' } }, 'unauthorized', 401);   // 運転手は登録できない
  await env.err({ op: 'master.list', token: 'forged' }, 'unauthorized', 401);
  // 同じ名前でも、会社が違えば別々に登録できる
  await env.ok({ op: 'master.put', token: b.token, master: { kind: 'destination', name: 'A社の工場' } });
});

test('マスター：1種類あたりの登録数に上限がある（上限でも、既存の修正はできる）', async () => {
  const env = setupEnv();
  const a = await companyWithOffice(env, codeA);
  let first = null;
  for (let i = 0; i < 500; i += 1) {
    const r = await env.ok({ op: 'master.put', token: a.token, master: { kind: 'truck', name: `車${i}` } });
    first ??= r.master;
  }
  await env.err({ op: 'master.put', token: a.token, master: { kind: 'truck', name: '501台目' } }, 'limit_reached');
  await env.ok({ op: 'master.put', token: a.token, master: { ...first, name: '車0改' } });
  await env.ok({ op: 'master.put', token: a.token, master: { kind: 'species', name: '樹種は別枠' } });
});

/* ------------------------------------------------------------------
 * 工場との差の分析
 * ------------------------------------------------------------------ */
const M3 = (x) => String(BigInt(Math.round(x * 1000)) * 40_000_000n);          // m³ → 内部単位
const diffLot = (species, m3v, n = 1) => ({ species, lengthM: '4.00', minD: 14, maxD: 30, site: '本谷', siteId: null, rows: [{ d: 20, n, volNum: M3(m3v) }] });

async function diffFixture() {
  const env = setupEnv();
  const a = await companyWithOffice(env, codeA);
  const put = async (id, dateStr, destination, lots, factory) => {
    await env.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id, dateStr, destination, lots }) });
    if (factory != null) await env.ok({ op: 'ticket.setFactory', token: a.token, id, volume: factory });
  };
  await put('tk-t1', '2026-10-05', '秋田プライウッド', [diffLot('カラマツ', 10)], '10.400');           // +4%  → 要確認
  await put('tk-t2', '2026-10-06', '秋田　プライウッド', [diffLot('カラマツ', 5)], '5.000');            // ±0（全角空白のゆれ）
  await put('tk-t3', '2026-11-02', '別の工場', [diffLot('スギ', 8)], '7.800');                          // −2.5% → 挙げない
  await put('tk-t4', '2026-10-07', '秋田プライウッド', [diffLot('カラマツ', 3), diffLot('スギ', 3)], '6.600');   // 積み合わせ +10% → 要確認
  await put('tk-t5', '2026-10-08', '秋田プライウッド', [diffLot('スギ', 2)], null);                     // 工場の値なし
  await put('tk-t6', '2026-10-09', '秋田プライウッド', [diffLot('スギ', 0.05)], '0.060');               // +20% だが小さい便 → 挙げない
  return { env, a };
}

test('差の分析：納入先別・樹種別・月別に、現場の値と工場の値と差を集計する（工場の値が入った便だけ）', async () => {
  const { env, a } = await diffFixture();
  const r = await env.ok({ op: 'analysis.diff', token: a.token });
  assert.equal(r.total.n, 5);
  assert.equal(r.total.oursNum, M3(29.05)); assert.equal(r.total.factoryNum, M3(29.86)); assert.equal(r.total.diffNum, M3(0.81));
  assert.equal(r.withoutFactory, 1);
  assert.equal(r.mixedSpecies, 1);

  const dest = Object.fromEntries(r.byDestination.map((g) => [g.name, g]));
  assert.equal(r.byDestination.length, 2);                                   // 全角空白のゆれは同じ納入先にまとまる
  assert.deepEqual([dest['秋田プライウッド'].n, dest['秋田プライウッド'].diffNum], [4, M3(1.01)]);
  assert.deepEqual([dest['別の工場'].n, dest['別の工場'].diffNum], [1, M3(-0.2)]);
  assert.equal(r.byDestination[0].name, '秋田プライウッド');                  // 現場の値が大きい順

  // 樹種別は「1つの樹種だけを積んだ便」だけ（積み合わせの便は入らない）
  const sp = Object.fromEntries(r.bySpecies.map((g) => [g.name, g]));
  assert.deepEqual([sp['カラマツ'].n, sp['カラマツ'].oursNum, sp['カラマツ'].factoryNum], [2, M3(15), M3(15.4)]);
  assert.deepEqual([sp['スギ'].n, sp['スギ'].oursNum, sp['スギ'].factoryNum], [2, M3(8.05), M3(7.86)]);

  assert.deepEqual(r.byMonth.map((g) => [g.name, g.n]), [['2026-11', 1], ['2026-10', 4]]);      // 新しい月が先
});

test('差の分析：割合が大きい便を「要確認」に挙げる（小さい便は挙げない。差の大きい順）', async () => {
  const { env, a } = await diffFixture();
  const r = await env.ok({ op: 'analysis.diff', token: a.token });
  assert.equal(r.flagPercent, 3);
  assert.equal(r.flaggedTotal, 2);
  assert.deepEqual(r.flagged.map((f) => f.id), ['tk-t4', 'tk-t1']);
  assert.equal(r.flagged[0].diffNum, M3(0.6));
  assert.equal(r.flagged[0].species, 'カラマツ・スギ');
  assert.equal(r.byDestination.find((g) => g.name === '秋田プライウッド').flagged, 2);
  assert.ok(!r.flagged.some((f) => f.id === 'tk-t6' || f.id === 'tk-t3'));
  assert.equal(r.flagged.every((f) => !('abs' in f)), true);                                        // 内部の値は返さない
});

test('差の分析：期間で絞れる。工場の値が1つも無ければ空', async () => {
  const { env, a } = await diffFixture();
  const nov = await env.ok({ op: 'analysis.diff', token: a.token, from: '2026-11-01', to: '2026-11-30' });
  assert.equal(nov.total.n, 1); assert.equal(nov.byDestination[0].name, '別の工場'); assert.equal(nov.flaggedTotal, 0);
  assert.deepEqual(nov.range, { from: '2026-11-01', to: '2026-11-30' });
  const none = await env.ok({ op: 'analysis.diff', token: a.token, from: '2027-01-01' });
  assert.equal(none.total.n, 0); assert.deepEqual(none.byDestination, []); assert.equal(none.total.diffNum, '0');
});

test('差の分析：事務所の札が要る。他社の便は混ざらない。日付の検査。読む便が多すぎるときは truncated', async () => {
  const { env, a } = await diffFixture();
  await env.err({ op: 'analysis.diff', code: codeA }, 'unauthorized', 401);                         // 運転手は見られない
  const b = await companyWithOffice(env, codeB);
  const rb = await env.ok({ op: 'analysis.diff', token: b.token });
  assert.equal(rb.total.n, 0);
  await env.err({ op: 'analysis.diff', token: a.token, from: '2026-02-31' }, 'invalid');
  const small = setupEnv({ limits: { scan: 2 } });
  const s = await companyWithOffice(small, codeA);
  for (const [i, d] of ['2026-10-05', '2026-10-06', '2026-10-07'].entries()) {
    await small.ok({ op: 'ticket.put', code: codeA, ticket: ticket({ id: `tk-s${i}`, dateStr: d, lots: [diffLot('カラマツ', 1)] }) });
    await small.ok({ op: 'ticket.setFactory', token: s.token, id: `tk-s${i}`, volume: '1.000' });
  }
  const r = await small.ok({ op: 'analysis.diff', token: s.token });
  assert.equal(r.truncated, true);
  assert.equal(r.total.n, 2);
});
