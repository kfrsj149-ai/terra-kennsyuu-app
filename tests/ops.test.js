/**
 * 運営者コンソール（/api/ops）のテスト
 * 確かめたいのは：運営者の鍵がなければ何も見えない／閲覧専用／すべて記録される／
 * 匿名化した書き出しに、会社名・車番・現場名などが含まれない／会社が少ない組み合わせは出ない
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.LICENSE_SECRET = 'テスト用の十分に長い署名鍵-0123456789';

const lib = await import('../api/_lib.js');
const { createOffice } = await import('../api/_office-core.js');
const { createOps } = await import('../api/_ops-core.js');
const { memoryStore } = await import('../api/_office-store.js');
const { CONSENT_VERSION } = await import('../src/js/office-rules.js');
const { formatVolume } = await import('../src/js/jas.js');

const OP_KEY = 'operator-key-0123456789-abcdefghij';

function env({ operatorKey = OP_KEY } = {}) {
  const clock = { t: Date.UTC(2026, 9, 5) };
  const store = memoryStore(() => clock.t);
  const active = new Set();
  const emails = {};
  const office = createOffice({
    store, now: () => clock.t,
    isSubscriptionActive: async (id) => active.has(id),
    getCustomerEmail: async (p) => emails[p.c] ?? null,
    limits: { verifyVolume: false },
  });
  const ops = createOps({ store, now: () => clock.t, operatorKey: () => operatorKey, pseudonymSecret: () => process.env.LICENSE_SECRET });
  const o = async (body) => (await office.handle(body)).payload;
  const p = async (body, ctx) => (await ops.handle(body, ctx));
  const login = async () => (await p({ op: 'ops.login', key: OP_KEY })).payload.token;

  /** 会社を作る（同意つき）。返り値：{cid, code, token} */
  async function company(n, { consent = CONSENT_VERSION } = {}) {
    const code = lib.signToken({ s: `sub_${n}`, c: `cus_${n}` });
    active.add(`sub_${n}`); emails[`cus_${n}`] = `owner${n}@example.com`;
    const s = await o({ op: 'office.setup', code, email: `owner${n}@example.com`, consent });
    assert.equal(s.ok, true, JSON.stringify(s));
    return { cid: s.companyId, code, token: s.token };
  }
  return { clock, store, office, ops, o, p, login, company };
}

const N = (m3) => String(BigInt(Math.round(m3 * 1000)) * 40_000_000n);
function ticket(id, over = {}) {
  return {
    id, ticketNo: '001', dateStr: '2026-10-05', truck: '岩手100あ12-34', destination: '秋田プライウッド', ownCompany: '杉澤林業', note: '午前便・本谷の件',
    outputAt: 1,
    lots: [{ species: 'カラマツ', lengthM: '4.00', minD: 14, maxD: 30, site: '本谷', siteId: null, rows: [{ d: 20, n: 10, volNum: N(1.6) }, { d: 22, n: 5, volNum: N(1.0) }] }],
    ...over,
  };
}

/* ------------------------------------------------------------------ */
test('運営者の鍵が未設定・短いときは、機能全体が無効', async () => {
  for (const operatorKey of [null, '', 'short-key']) {
    const e = env({ operatorKey });
    const r = await e.p({ op: 'ops.login', key: operatorKey ?? 'x' });
    assert.equal(r.payload.error, 'ops_not_configured');
    assert.equal((await e.p({ op: 'ops.companies', token: 'x' })).payload.error, 'ops_not_configured');
  }
});

test('保存先が未設定なら何もしない', async () => {
  const ops = createOps({ store: null });
  assert.deepEqual((await ops.handle({ op: 'ops.login', key: OP_KEY })).payload, { ok: false, error: 'not_configured' });
});

test('ログイン：正しい鍵で札が得られ、間違いは8回まで。9回目からは（正しい鍵でも）解除までロック', async () => {
  const e = env();
  for (let i = 0; i < 8; i += 1) assert.equal((await e.p({ op: 'ops.login', key: 'wrong' }, { ip: '1.1.1.1' })).payload.error, 'bad_key');
  assert.equal((await e.p({ op: 'ops.login', key: 'wrong' }, { ip: '1.1.1.1' })).status, 429);
  assert.equal((await e.p({ op: 'ops.login', key: OP_KEY }, { ip: '1.1.1.1' })).status, 429);
  // 別のIPからは入れる（1つのIPが運営者を締め出し続けられない）
  assert.equal((await e.p({ op: 'ops.login', key: OP_KEY }, { ip: '2.2.2.2' })).payload.ok, true);
  e.clock.t += 16 * 60 * 1000;
  assert.equal((await e.p({ op: 'ops.login', key: OP_KEY }, { ip: '1.1.1.1' })).payload.ok, true);
});

test('【点検4】ログインの試行は先に数える：並列に大量に送っても、8回を超えて照合されない', async () => {
  const e = env();
  const results = await Promise.all(Array.from({ length: 200 }, (_, i) => e.p({ op: 'ops.login', key: i === 150 ? OP_KEY : `wrong-${i}` }, { ip: '9.9.9.9' })));
  const checked = results.filter((r) => r.status !== 429).length;
  assert.ok(checked <= 8, `照合された回数: ${checked}`);
  // 200件目まででロック。全体のロック（200回）にも達する
  assert.equal((await e.p({ op: 'ops.login', key: OP_KEY }, { ip: '3.3.3.3' })).status, 429);
});

test('【点検6】ログインの失敗・ロックも閲覧記録に残る。ログアウトで、発行済みの札がすべて無効になる', async () => {
  const e = env();
  await e.p({ op: 'ops.login', key: 'wrong' }, { ip: '4.4.4.4' });
  const token = await e.login();
  e.clock.t += 1000;
  assert.equal((await e.p({ op: 'ops.companies', token })).payload.ok, true);
  const t2 = (await e.p({ op: 'ops.login', key: OP_KEY })).payload.token;
  await e.p({ op: 'ops.logout', token });
  assert.equal((await e.p({ op: 'ops.companies', token })).status, 401);
  assert.equal((await e.p({ op: 'ops.companies', token: t2 })).status, 401);               // 別に発行した札も無効
  const fresh = (await e.p({ op: 'ops.login', key: OP_KEY })).payload.token;
  const { entries } = (await e.p({ op: 'ops.audit', token: fresh })).payload;
  const ops = entries.map((x) => x.op);
  assert.ok(ops.includes('ops.login.failed'));
  assert.ok(ops.includes('ops.logout'));
  assert.ok(!JSON.stringify(entries).includes('4.4.4.4'));                                  // IPそのものは残さない（指紋だけ）
});

test('【点検6】閲覧記録の「直近2か月」は、月末でも前の月を含む', async () => {
  const e = env();
  e.clock.t = Date.UTC(2026, 8, 30, 12);                      // 9/30
  const t1 = await e.login();
  e.clock.t = Date.UTC(2026, 9, 31, 12);                      // 10/31（月末）
  const t2 = await e.login();
  const { entries } = (await e.p({ op: 'ops.audit', token: t2 })).payload;
  assert.equal(entries.filter((x) => x.op === 'ops.login').length, 2, '9月の記録が出ていない');
  assert.ok(t1);
});

test('札：なし・改ざん・期限切れ・事務所の札やライセンスコードの流用は通らない。鍵を変えると旧札は無効', async () => {
  const e = env();
  const co = await e.company(1);
  const token = await e.login();
  assert.equal((await e.p({ op: 'ops.companies', token })).payload.ok, true);
  for (const bad of [undefined, '', 'abc', token.slice(0, -3) + 'xyz', co.token, co.code]) {
    const r = await e.p({ op: 'ops.companies', token: bad });
    assert.equal(r.status, 401, String(bad).slice(0, 20));
  }
  e.clock.t += 13 * 3600 * 1000;                                                   // 12時間で切れる
  assert.equal((await e.p({ op: 'ops.companies', token })).status, 401);
  // 鍵を変えた運営者環境では、古い札は使えない
  const e2 = env({ operatorKey: 'another-operator-key-0123456789xyz' });
  assert.equal((await e2.p({ op: 'ops.companies', token })).status, 401);
});

test('会社一覧：同意の状態・便数が分かる。会社名は便に入っているもの（最新）だけ', async () => {
  const e = env();
  const a = await e.company(1);
  const b = await e.company(2);
  await e.o({ op: 'ticket.put', code: a.code, ticket: ticket('tk-a001') });
  await e.o({ op: 'ticket.put', code: a.code, ticket: ticket('tk-a002', { ticketNo: '002', dateStr: '2026-10-06' }) });
  // b の同意を古い版にする
  await e.store.set(`co:${b.cid}:consent`, JSON.stringify({ version: '2025-01-01', at: 1 }));
  const { companies } = (await e.p({ op: 'ops.companies', token: await e.login() })).payload;
  assert.equal(companies.length, 2);
  const ca = companies.find((c) => c.id === a.cid);
  assert.deepEqual([ca.tickets, ca.latestDate, ca.latestOwnCompany, ca.consentOk], [2, '2026-10-06', '杉澤林業', true]);
  assert.equal(companies.find((c) => c.id === b.cid).consentOk, false);
  // メールアドレスやライセンスコードは返さない
  const text = JSON.stringify(companies);
  assert.ok(!text.includes('example.com'));
  assert.ok(!text.includes(a.code));
});

test('生データの閲覧：会社を指定して、車番・現場・備考を含む便が読める。IDの形が違えば拒否', async () => {
  const e = env();
  const a = await e.company(1);
  await e.o({ op: 'ticket.put', code: a.code, ticket: ticket('tk-a001') });
  const token = await e.login();
  const r = (await e.p({ op: 'ops.tickets', token, cid: a.cid })).payload;
  assert.equal(r.tickets.length, 1);
  assert.equal(r.tickets[0].truck, '岩手100あ12-34');
  assert.equal(r.tickets[0].note, '午前便・本谷の件');
  assert.equal(r.tickets[0].lots[0].site, '本谷');
  for (const cid of ['../x', 'abc', 'ILLEGAL1', undefined, `${a.cid}:t:tk-a001`]) {
    assert.equal((await e.p({ op: 'ops.tickets', token, cid })).payload.error, 'invalid', String(cid));
  }
  assert.equal((await e.p({ op: 'ops.tickets', token, cid: 'ZZZZZZZZ' })).payload.error, 'not_found');   // 存在しない会社
  assert.equal((await e.p({ op: 'ops.tickets', token, cid: a.cid, from: '2026-02-31' })).payload.error, 'invalid');
});

test('運営者は閲覧専用：どの操作も、会社のデータを1バイトも書き換えない', async () => {
  const e = env();
  const a = await e.company(1);
  await e.o({ op: 'ticket.put', code: a.code, ticket: ticket('tk-a001') });
  const snapshot = async () => {
    const dump = {};
    // メモリ保存先の中身を、監査ログ以外すべて比べる
    for (const k of [`co:${a.cid}:t:tk-a001`, `co:${a.cid}:auth`, `co:${a.cid}:consent`, `co:${a.cid}:primary`]) dump[k] = await e.store.get(k);
    dump.tidx = await e.store.zrevrangebyscore(`co:${a.cid}:tidx`, '+inf', '-inf', 0, 100);
    dump.companies = await e.store.hgetall('companies');
    return JSON.stringify(dump);
  };
  const before = await snapshot();
  const token = await e.login();
  await e.p({ op: 'ops.companies', token });
  await e.p({ op: 'ops.tickets', token, cid: a.cid });
  await e.p({ op: 'ops.export', token, mode: 'records' });
  await e.p({ op: 'ops.audit', token });
  assert.equal(await snapshot(), before);
});

test('閲覧記録：ログイン・一覧・閲覧・書き出しがすべて残り、誰がどの会社を見たかが分かる', async () => {
  const e = env();
  const a = await e.company(1);
  const token = await e.login();
  e.clock.t += 1000;
  await e.p({ op: 'ops.companies', token });
  e.clock.t += 1000;
  await e.p({ op: 'ops.tickets', token, cid: a.cid, from: '2026-10-01', to: '2026-10-31' });
  e.clock.t += 1000;
  await e.p({ op: 'ops.export', token, mode: 'aggregate', k: 5, from: '2026-08' });
  e.clock.t += 1000;
  const { entries } = (await e.p({ op: 'ops.audit', token })).payload;
  assert.deepEqual(entries.map((x) => x.op), ['ops.export', 'ops.tickets', 'ops.companies', 'ops.login']);
  assert.equal(entries[1].cid, a.cid);
  assert.equal(entries[1].from, '2026-10-01');
  assert.equal(entries[0].k, 5);
  assert.equal(entries[0].from, '2026-08');
  // 記録を見たこと自体も記録される。札のない要求は何も記録されない
  e.clock.t += 1000;
  await e.p({ op: 'ops.companies', token: 'bad' });
  e.clock.t += 1000;
  const again = (await e.p({ op: 'ops.audit', token })).payload.entries.map((x) => x.op);
  assert.deepEqual(again, ['ops.audit', 'ops.export', 'ops.tickets', 'ops.companies', 'ops.login']);
});

/* ---------------- 匿名化した書き出し ---------------- */
async function threeCompaniesWithData(e) {
  const cos = [];
  for (const n of [1, 2, 3]) {
    const c = await e.company(n);
    await e.o({ op: 'ticket.put', code: c.code, ticket: ticket(`tk-${n}001`, {
      truck: `ナンバー${n}`, destination: `工場${n}`, ownCompany: `会社${n}`, note: `備考${n}`, ticketNo: `00${n}`, dateStr: `2026-09-0${n}`,
      lots: [{ species: 'カラマツ', lengthM: '4.00', minD: 14, maxD: 30, site: `現場${n}`, siteId: null, rows: [{ d: 20, n: 10 * n, volNum: N(1.6 * n) }] }],
    }) });
    cos.push(c);
  }
  return cos;
}

test('匿名化（個別）：会社名・車番・現場・納入先・備考・伝票番号・便ID・正確な日付・会社IDを含まない', async () => {
  const e = env();
  const cos = await threeCompaniesWithData(e);
  const token = await e.login();
  const { rows, meta } = (await e.p({ op: 'ops.export', token, mode: 'records', k: 3 })).payload;
  assert.equal(meta.companiesIncluded, 3);
  assert.ok(rows.length >= 3);
  const text = JSON.stringify(rows);
  for (const secret of ['ナンバー', '工場', '会社1', '会社2', '現場', '備考', 'tk-', '2026-09-0', ...cos.map((c) => c.cid), ...cos.map((c) => c.code), 'example.com', '杉澤']) {
    assert.ok(!text.includes(secret), `漏れている: ${secret}`);
  }
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), ['company', 'd', 'lengthM', 'maxD', 'minD', 'n', 'period', 'species', 'volM3']);
    assert.equal(r.period, '2026-09');                       // 月まで。日は出さない
    assert.match(r.company, /^c_[0-9a-f]{10}$/);
  }
});

test('【点検5】仮名：1回の書き出しの中では同じ会社は同じ仮名・別の会社は別の仮名。書き出しごとに変わり、別々の書き出しを結合できない', async () => {
  const e = env();
  await threeCompaniesWithData(e);
  const token = await e.login();
  const one = (await e.p({ op: 'ops.export', token, mode: 'records' })).payload;
  assert.equal(new Set(one.rows.map((r) => r.company)).size, 3);
  // 同じ条件の再書き出しは凍結した同じ結果（仮名も同じ）
  const again = (await e.p({ op: 'ops.export', token, mode: 'records' })).payload;
  assert.equal(again.meta.frozen, true);
  assert.deepEqual(again.rows, one.rows);
  // 作り直す（refresh）と、仮名が別のものになる
  const fresh = (await e.p({ op: 'ops.export', token, mode: 'records', refresh: true })).payload;
  assert.notEqual(fresh.meta.exportId, one.meta.exportId);
  assert.equal(new Set(fresh.rows.map((r) => r.company)).size, 3);
  assert.equal(fresh.rows.filter((r) => one.rows.some((x) => x.company === r.company)).length, 0);
  // 条件が違う（kが違う）書き出しも、別の仮名
  const k4 = (await e.p({ op: 'ops.export', token, mode: 'records', k: 3, to: '2026-09' })).payload;
  assert.notEqual(k4.meta.exportId, one.meta.exportId);
  // 鍵が違うと、同じ会社でも違う仮名
  const cos = Object.keys(await e.store.hgetall('companies'));
  const other = createOps({ store: e.store, operatorKey: () => OP_KEY, pseudonymSecret: () => '別の鍵-0123456789-abcdefghijklmnop' });
  assert.notEqual(other.pseudonym(cos[0], 'x'), e.ops.pseudonym(cos[0], 'x'));
  assert.notEqual(e.ops.pseudonym(cos[0], 'x'), e.ops.pseudonym(cos[0], 'y'));
});

test('匿名化：関わった会社がk社未満の組み合わせは出さない（k匿名）。kは3未満にできない', async () => {
  const e = env();
  await threeCompaniesWithData(e);
  const d = await e.company(4);
  // 4社目だけが扱うヒノキ。1社しかいないので、個別でも集計でも出てはいけない
  await e.o({ op: 'ticket.put', code: d.code, ticket: ticket('tk-4001', { dateStr: '2026-09-04', lots: [{ species: 'ヒノキ', lengthM: '3.00', minD: 14, maxD: 30, site: '', siteId: null, rows: [{ d: 18, n: 7, volNum: N(0.9) }] }] }) });
  const token = await e.login();
  for (const mode of ['records', 'aggregate']) {
    const r = (await e.p({ op: 'ops.export', token, mode, k: 1 })).payload;          // k=1 を指定しても3に引き上げる
    assert.equal(r.meta.k, 3);
    assert.ok(!JSON.stringify(r.rows).includes('ヒノキ'), mode);
    assert.ok(r.meta.suppressedGroups >= 1);
  }
  // k=4 にすると、3社しかいないカラマツも出なくなる
  assert.equal((await e.p({ op: 'ops.export', token, mode: 'aggregate', k: 4 })).payload.rows.length, 0);
});

test('匿名化（集計）：月×樹種×長さ×径級ごとの合計。端数を保持して足し、最後に丸める', async () => {
  const e = env();
  await threeCompaniesWithData(e);
  const token = await e.login();
  const { rows } = (await e.p({ op: 'ops.export', token, mode: 'aggregate', k: 3 })).payload;
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { period: '2026-09', species: 'カラマツ', lengthM: '4', d: 20, n: 60, volM3: formatVolume(BigInt(N(1.6)) + BigInt(N(3.2)) + BigInt(N(4.8))), companies: 3 });
});

test('匿名化：現行の同意がない会社のデータは、書き出しに含めない', async () => {
  const e = env();
  const cos = await threeCompaniesWithData(e);
  await e.store.set(`co:${cos[2].cid}:consent`, JSON.stringify({ version: '2025-01-01', at: 1 }));    // 3社目の同意が古い
  const token = await e.login();
  const r = (await e.p({ op: 'ops.export', token, mode: 'aggregate', k: 3 })).payload;
  assert.equal(r.meta.companiesIncluded, 2);
  assert.equal(r.meta.companiesExcludedNoConsent, 1);
  assert.equal(r.rows.length, 0);                                                    // 2社ではk=3を満たさない
});

test('【点検5】同意が現行版でない会社の生データは閲覧できない（会社一覧には、存在と件数だけが出る）', async () => {
  const e = env();
  const a = await e.company(1);
  await e.o({ op: 'ticket.put', code: a.code, ticket: ticket('tk-a001') });
  await e.store.set(`co:${a.cid}:consent`, JSON.stringify({ version: '2025-01-01', at: 1 }));
  const token = await e.login();
  const r = await e.p({ op: 'ops.tickets', token, cid: a.cid });
  assert.equal(r.payload.error, 'no_consent');
  const list = (await e.p({ op: 'ops.companies', token })).payload.companies[0];
  assert.equal(list.consentOk, false);
  assert.equal(list.tickets, 1);
  assert.equal(list.latestOwnCompany, '');                                      // 便の中身（会社名）は見ない
  assert.equal(list.latestDate, null);
  const audit = (await e.p({ op: 'ops.audit', token })).payload.entries;
  assert.ok(audit.some((x) => x.op === 'ops.tickets.denied' && x.reason === 'no_consent'));
});

test('【点検1】期間は月単位で、確定した過去の月だけ。いまの月・日付での指定は受け付けない', async () => {
  const e = env();
  await threeCompaniesWithData(e);                                                   // データは 2026-09、いまは 2026-10-05
  for (const n of [1, 2, 3]) {
    const c = Object.keys(await e.store.hgetall('companies'))[n - 1];
    assert.ok(c);
  }
  const token = await e.login();
  const ex = async (extra) => (await e.p({ op: 'ops.export', token, mode: 'aggregate', k: 3, ...extra })).payload;
  assert.equal((await ex({})).rows.length, 1);
  assert.equal((await ex({ from: '2026-09', to: '2026-09' })).rows.length, 1);
  assert.equal((await ex({ from: '2026-10' })).rows.length, 0);                      // いまの月は未確定なので対象外
  assert.equal((await ex({ from: '2026-10' })).meta.to, '2026-09');
  assert.equal((await ex({ to: '2026-08' })).rows.length, 0);                        // データのない月
  for (const bad of ['2026-09-01', '2026-13', '09', 'x', '1999-12']) assert.equal((await ex({ from: bad })).error, 'invalid', bad);
});

test('【点検1】期間をずらして2回書き出して引き算する攻撃：日単位の指定ができず、同じ条件は凍結した同じ結果になる', async () => {
  const e = env();
  await threeCompaniesWithData(e);
  // 後から1社だけに遅れて届いた便（A社の同じ月・同じ樹種・長さ・径級に大量）
  const a = Object.keys(await e.store.hgetall('companies'))[0];
  const code = lib.signToken({ s: 'sub_1', c: 'cus_1' });
  const token = await e.login();
  const before = (await e.p({ op: 'ops.export', token, mode: 'aggregate', k: 3 })).payload;
  await e.o({ op: 'ticket.put', code, ticket: ticket('tk-late', { ticketNo: '009', dateStr: '2026-09-30', lots: [{ species: 'カラマツ', lengthM: '4.00', minD: 14, maxD: 30, site: '', siteId: null, rows: [{ d: 20, n: 100, volNum: N(16) }] }] }) });
  const after = (await e.p({ op: 'ops.export', token, mode: 'aggregate', k: 3 })).payload;
  assert.equal(after.meta.frozen, true);
  assert.deepEqual(after.rows, before.rows);                                         // 引き算しても差が出ない
  assert.ok(a);
  // 日単位の指定は受け付けない（月末の1日だけを切り出せない）
  assert.equal((await e.p({ op: 'ops.export', token, mode: 'aggregate', from: '2026-09-30', to: '2026-09-30' })).payload.error, 'invalid');
  // 作り直すと、遅れて届いた分も入る。その旨は閲覧記録に残る
  const fresh = (await e.p({ op: 'ops.export', token, mode: 'aggregate', k: 3, refresh: true })).payload;
  assert.equal(fresh.meta.refreshed, true);
  const log = (await e.p({ op: 'ops.audit', token })).payload.entries.filter((x) => x.op === 'ops.export');
  assert.ok(log.some((x) => x.refresh === true));
  assert.ok(log.some((x) => x.frozen === true));
});

test('【点検2】本数0の行や架空の会社でk社に見せかけても、実体のある会社が3社なければ出ない', async () => {
  const e = env();
  const v = await e.company(9);
  await e.o({ op: 'ticket.put', code: v.code, ticket: ticket('tk-v001', { dateStr: '2026-09-05', lots: [{ species: 'ヒノキ', lengthM: '3.00', minD: 14, maxD: 30, site: '', siteId: null, rows: [{ d: 24, n: 7, volNum: N(1.9) }] }] }) });
  for (const n of [1, 2]) {
    const s = await e.company(n);
    // 実体のない行（本数0）。サーバーの検査で拒否される（検算を有効にした環境）か、書き出しで数えられない
    await e.o({ op: 'ticket.put', code: s.code, ticket: ticket(`tk-s${n}`, { dateStr: '2026-09-05', lots: [{ species: 'ヒノキ', lengthM: '3.00', minD: 14, maxD: 30, site: '', siteId: null, rows: [{ d: 24, n: 0, volNum: '0' }] }] }) });
  }
  const token = await e.login();
  for (const mode of ['aggregate', 'records']) {
    const r = (await e.p({ op: 'ops.export', token, mode, k: 3, refresh: true })).payload;
    assert.ok(!JSON.stringify(r.rows).includes('ヒノキ'), `${mode}: 1社だけの値が出ている`);
  }
});

test('【点検3】1社の寄与が8割を超える組み合わせは、k社そろっていても出さない（優位性ルール）', async () => {
  const e = env();
  const mk = async (n, count) => {
    const c = await e.company(n);
    await e.o({ op: 'ticket.put', code: c.code, ticket: ticket(`tk-${n}`, { dateStr: '2026-09-05', lots: [{ species: 'カラマツ', lengthM: '4.00', minD: 14, maxD: 30, site: '', siteId: null, rows: [{ d: 20, n: count, volNum: N(0.16 * count) }] }] }) });
  };
  await mk(1, 100); await mk(2, 5); await mk(3, 5);                                 // A社が 100/110 = 91%
  const token = await e.login();
  for (const mode of ['aggregate', 'records']) {
    const r = (await e.p({ op: 'ops.export', token, mode, k: 3, refresh: true })).payload;
    assert.equal(r.rows.length, 0, mode);
    assert.equal(r.meta.suppressedGroups, 1);
  }
  // 偏りが小さければ出る（A社 40/50 = 80% ちょうどは出る）
  const e2 = env();
  const mk2 = async (n, count) => {
    const c = await e2.company(n);
    await e2.o({ op: 'ticket.put', code: c.code, ticket: ticket(`tk-${n}`, { dateStr: '2026-09-05', lots: [{ species: 'カラマツ', lengthM: '4.00', minD: 14, maxD: 30, site: '', siteId: null, rows: [{ d: 20, n: count, volNum: N(0.16 * count) }] }] }) });
  };
  await mk2(1, 40); await mk2(2, 5); await mk2(3, 5);
  assert.equal((await e2.p({ op: 'ops.export', token: await e2.login(), mode: 'aggregate', k: 3 })).payload.rows.length, 1);
});

test('未知の操作・大きすぎる本体', async () => {
  const e = env();
  assert.equal((await e.p({ op: 'ops.nothing' })).status, 400);
  assert.equal((await e.p({ op: 'ops.login', key: 'x'.repeat(30_000) })).status, 413);
});
