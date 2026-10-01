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
  });
  const ops = createOps({ store, now: () => clock.t, operatorKey: () => operatorKey, pseudonymSecret: () => process.env.LICENSE_SECRET });
  const o = async (body) => (await office.handle(body)).payload;
  const p = async (body) => (await ops.handle(body));
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

test('ログイン：正しい鍵で札が得られ、間違いは8回でロックされる（正しくても解除まで入れない）', async () => {
  const e = env();
  for (let i = 0; i < 7; i += 1) assert.equal((await e.p({ op: 'ops.login', key: 'wrong' })).payload.error, 'bad_key');
  const locked = await e.p({ op: 'ops.login', key: 'wrong' });
  assert.equal(locked.status, 429);
  assert.equal((await e.p({ op: 'ops.login', key: OP_KEY })).status, 429);
  e.clock.t += 16 * 60 * 1000;
  assert.equal((await e.p({ op: 'ops.login', key: OP_KEY })).payload.ok, true);
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
  assert.deepEqual((await e.p({ op: 'ops.tickets', token, cid: 'ZZZZZZZZ' })).payload.tickets, []);   // 存在しない会社は空
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
  await e.p({ op: 'ops.export', token, mode: 'aggregate', k: 5 });
  const { entries } = (await e.p({ op: 'ops.audit', token })).payload;
  assert.deepEqual(entries.map((x) => x.op), ['ops.export', 'ops.tickets', 'ops.companies', 'ops.login']);
  assert.equal(entries[1].cid, a.cid);
  assert.equal(entries[1].from, '2026-10-01');
  assert.equal(entries[0].k, 5);
  // 失敗した認証は記録しない（ロックで守る）。札のない要求は何も記録されない
  await e.p({ op: 'ops.companies', token: 'bad' });
  assert.equal((await e.p({ op: 'ops.audit', token })).payload.entries.length, 4);
});

/* ---------------- 匿名化した書き出し ---------------- */
async function threeCompaniesWithData(e) {
  const cos = [];
  for (const n of [1, 2, 3]) {
    const c = await e.company(n);
    await e.o({ op: 'ticket.put', code: c.code, ticket: ticket(`tk-${n}001`, {
      truck: `ナンバー${n}`, destination: `工場${n}`, ownCompany: `会社${n}`, note: `備考${n}`, ticketNo: `00${n}`, dateStr: `2026-10-0${n}`,
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
  for (const secret of ['ナンバー', '工場', '会社1', '会社2', '現場', '備考', 'tk-', '2026-10-0', ...cos.map((c) => c.cid), ...cos.map((c) => c.code), 'example.com', '杉澤']) {
    assert.ok(!text.includes(secret), `漏れている: ${secret}`);
  }
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), ['company', 'd', 'lengthM', 'maxD', 'minD', 'n', 'period', 'species', 'volM3']);
    assert.match(r.period, /^\d{4}-\d{2}$/);                 // 月まで。日は出さない
    assert.match(r.company, /^c_[0-9a-f]{10}$/);
  }
});

test('匿名化：同じ会社は常に同じ仮名、別の会社は別の仮名。仮名は鍵が変わると変わる（元に戻せない）', async () => {
  const e = env();
  const cos = await threeCompaniesWithData(e);
  const token = await e.login();
  const one = (await e.p({ op: 'ops.export', token, mode: 'records' })).payload.rows;
  const two = (await e.p({ op: 'ops.export', token, mode: 'records' })).payload.rows;
  assert.deepEqual(one, two);
  assert.equal(new Set(one.map((r) => r.company)).size, 3);
  assert.equal(e.ops.pseudonym(cos[0].cid), e.ops.pseudonym(cos[0].cid));
  assert.notEqual(e.ops.pseudonym(cos[0].cid), e.ops.pseudonym(cos[1].cid));
  const other = createOps({ store: e.store, operatorKey: () => OP_KEY, pseudonymSecret: () => '別の鍵-0123456789-abcdefghijklmnop' });
  assert.notEqual(other.pseudonym(cos[0].cid), e.ops.pseudonym(cos[0].cid));
});

test('匿名化：関わった会社がk社未満の組み合わせは出さない（k匿名）。kは3未満にできない', async () => {
  const e = env();
  await threeCompaniesWithData(e);
  const d = await e.company(4);
  // 4社目だけが扱うヒノキ。1社しかいないので、個別でも集計でも出てはいけない
  await e.o({ op: 'ticket.put', code: d.code, ticket: ticket('tk-4001', { lots: [{ species: 'ヒノキ', lengthM: '3.00', minD: 14, maxD: 30, site: '', siteId: null, rows: [{ d: 18, n: 7, volNum: N(0.9) }] }] }) });
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
  assert.deepEqual(rows[0], { period: '2026-10', species: 'カラマツ', lengthM: '4', d: 20, n: 60, volM3: formatVolume(BigInt(N(1.6)) + BigInt(N(3.2)) + BigInt(N(4.8))), companies: 3 });
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

test('匿名化：期間で絞れる。日付の形が違えば拒否', async () => {
  const e = env();
  await threeCompaniesWithData(e);
  const token = await e.login();
  const r = (await e.p({ op: 'ops.export', token, mode: 'records', k: 3, from: '2026-10-02', to: '2026-10-03' })).payload;
  assert.equal(r.meta.companiesIncluded, 3);
  assert.equal(r.rows.length, 0);                                                    // 期間内は2社ぶんだけ → k=3未満で出ない
  assert.equal((await e.p({ op: 'ops.export', token, mode: 'records', from: 'x' })).payload.error, 'invalid');
});

test('未知の操作・大きすぎる本体', async () => {
  const e = env();
  assert.equal((await e.p({ op: 'ops.nothing' })).status, 400);
  assert.equal((await e.p({ op: 'ops.login', key: 'x'.repeat(30_000) })).status, 413);
});
