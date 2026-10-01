/**
 * 運営者コンソールのサーバー側（TERRA TX の運営者だけが使う）
 * ------------------------------------------------------------------
 * 目的：事務所に共有された検収データを、運営者が閲覧できるようにし、
 *       研究・販売に使うときのために、匿名化したデータを書き出せるようにする。
 *       これは利用規約・プライバシーポリシーに明記してある取り扱いで、
 *       事務所の初期設定のとき（同意文の版 CONSENT_VERSION）に利用者の同意を得ている。
 *
 * 【守っていること】
 *   ・閲覧専用。会社のデータを書き換える操作は1つもない（書くのは閲覧記録だけ）
 *   ・認証は環境変数 OPERATOR_KEY（24文字以上）。未設定なら機能全体が無効
 *   ・すべての閲覧・書き出しを閲覧記録（ops:audit:YYYYMM）に残す
 *   ・扱うのは、現行の同意文に同意している会社のデータだけ（書き出し）。閲覧画面は、同意がなくても
 *     「存在する」ことだけは会社一覧に出す（同意が欠けた会社を運営者が把握できるように）
 *   ・匿名化の書き出しでは、会社名・車番・現場名・納入先・備考・伝票番号・正確な日付を含めない。
 *     会社は鍵付きの仮名（運営者にも元に戻せない）に置き換え、会社数が少ない組み合わせは出さない（k匿名）
 *
 * 注意：ここでの「匿名化」は、個々の便と会社を結びつけにくくする処理であって、個人情報保護法の
 * 「匿名加工情報」の基準を満たすことまでは保証しない。第三者へ販売・提供する前に、必ず専門家に確認すること。
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { signPayload, verifyPayload } from './_lib.js';
import { key, parseJson, readTicketsFrom, dayRangeKeys, isDateString } from './_office-core.js';
import { CONSENT_VERSION, isValidId, normalizeName } from '../src/js/office-rules.js';
import { formatVolume, formatLength, toHundredths } from '../src/js/jas.js';

const LOCK_MAX = 8;
const LOCK_SEC = 15 * 60;
const SESSION_MS = 12 * 3600 * 1000;
const MIN_KEY_LENGTH = 24;
const MIN_K = 3;
const PER_COMPANY_LIMIT = 15_000;
const AUDIT_KEEP = 300;

class Fail extends Error {
  constructor(error, extra = {}, status = 200) { super(error); this.error = error; this.extra = extra; this.status = status; }
}
const fail = (error, extra, status) => new Fail(error, extra, status);
const sha = (s) => createHash('sha256').update(String(s)).digest();

/**
 * @param {object} deps
 * @param {import('./_office-store.js').Store|null} deps.store
 * @param {() => number} [deps.now]
 * @param {() => string|undefined} [deps.operatorKey] 運営者の鍵（既定は環境変数 OPERATOR_KEY）
 * @param {() => string|undefined} [deps.pseudonymSecret] 会社の仮名を作る鍵（既定は LICENSE_SECRET）
 */
export function createOps({
  store,
  now = () => Date.now(),
  operatorKey = () => process.env.OPERATOR_KEY,
  pseudonymSecret = () => process.env.LICENSE_SECRET,
}) {
  const configuredKey = () => {
    const k = operatorKey();
    return typeof k === 'string' && k.length >= MIN_KEY_LENGTH ? k : null;
  };
  /** 鍵を変えたら、発行済みの札がすべて無効になるよう、札の用途名に鍵の指紋を混ぜる */
  const purpose = (k) => `operator:${sha(k).toString('hex').slice(0, 16)}`;

  /* ---------------- 閲覧記録 ---------------- */
  const auditKey = (t) => `ops:audit:${new Date(t).toISOString().slice(0, 7).replace('-', '')}`;
  async function audit(op, detail = {}) {
    const t = now();
    await store.hset(auditKey(t), `${t}-${Math.random().toString(36).slice(2, 7)}`, JSON.stringify({ at: t, op, ...detail }));
  }

  /* ---------------- 認証 ---------------- */
  async function login(body) {
    const k = configuredKey();
    if (!k) throw fail('ops_not_configured');
    if (Number(await store.get('ops:fail') ?? 0) >= LOCK_MAX) throw fail('locked', { retryAfterSec: LOCK_SEC }, 429);
    const given = sha(String(body.key ?? ''));
    if (!timingSafeEqual(given, sha(k))) {
      const n = await store.incr('ops:fail', LOCK_SEC);
      throw fail(n >= LOCK_MAX ? 'locked' : 'bad_key', n >= LOCK_MAX ? { retryAfterSec: LOCK_SEC } : {}, n >= LOCK_MAX ? 429 : 200);
    }
    await store.del('ops:fail');
    await audit('ops.login');
    return { token: signPayload(purpose(k), { x: now() + SESSION_MS }) };
  }

  function requireOperator(body) {
    const k = configuredKey();
    if (!k) throw fail('ops_not_configured');
    const tok = verifyPayload(purpose(k), String(body.token ?? ''));
    if (!tok || !(tok.x > now())) throw fail('unauthorized', {}, 401);
  }

  /* ---------------- 会社一覧 ---------------- */
  async function companies(body) {
    requireOperator(body);
    const index = await store.hgetall('companies');
    const list = [];
    for (const [cid, raw] of Object.entries(index)) {
      if (!isValidId(cid)) continue;
      const meta = parseJson(raw, {});
      const consent = parseJson(await store.get(key(cid, 'consent')));
      const { tickets: latest } = await readTicketsFrom(store, cid, 1);
      list.push({
        id: cid,
        createdAt: meta.createdAt ?? null,
        consentOk: consent?.version === CONSENT_VERSION,
        consentVersion: consent?.version ?? null,
        tickets: await store.zcard(key(cid, 'tidx')),
        latestDate: latest[0]?.dateStr ?? null,
        latestOwnCompany: latest[0]?.ownCompany ?? '',
      });
    }
    list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    await audit('ops.companies', { count: list.length });
    return { companies: list, consentVersion: CONSENT_VERSION };
  }

  /* ---------------- 生データの閲覧 ---------------- */
  async function tickets(body) {
    requireOperator(body);
    if (!isValidId(body.cid)) throw fail('invalid', { field: 'cid' });
    const from = body.from ? (isDateString(body.from) ? body.from : (() => { throw fail('invalid', { field: 'from' }); })()) : null;
    const to = body.to ? (isDateString(body.to) ? body.to : (() => { throw fail('invalid', { field: 'to' }); })()) : null;
    const limit = Math.min(200, Math.max(1, Number.isInteger(Number(body.limit)) ? Number(body.limit) : 100));
    const offset = Number.isInteger(Number(body.offset)) && Number(body.offset) >= 0 ? Math.min(Number(body.offset), 100_000) : 0;
    const r = await readTicketsFrom(store, body.cid, limit + 1, { ...dayRangeKeys(from, to), offset });
    await audit('ops.tickets', { cid: body.cid, from, to, offset, returned: Math.min(r.tickets.length, limit) });
    return { tickets: r.tickets.slice(0, limit), hasMore: r.tickets.length > limit };
  }

  /* ---------------- 匿名化した書き出し ---------------- */
  /** 会社を鍵付きのハッシュで仮名にする。同じ会社は常に同じ仮名になるが、鍵がなければ元に戻せない */
  const pseudonym = (cid) => `c_${createHmac('sha256', String(pseudonymSecret() ?? '')).update(`export-pseudonym-v1:${cid}`).digest('hex').slice(0, 10)}`;

  async function exportData(body) {
    requireOperator(body);
    const mode = body.mode === 'records' ? 'records' : 'aggregate';
    const k = Math.max(MIN_K, Math.min(100, Number.isInteger(Number(body.k)) ? Number(body.k) : MIN_K));
    const from = body.from ? (isDateString(body.from) ? body.from : (() => { throw fail('invalid', { field: 'from' }); })()) : null;
    const to = body.to ? (isDateString(body.to) ? body.to : (() => { throw fail('invalid', { field: 'to' }); })()) : null;
    if (!String(pseudonymSecret() ?? '')) throw fail('ops_not_configured');

    const index = await store.hgetall('companies');
    let included = 0;
    let excluded = 0;
    /** 1行ぶんの材料（会社・月・樹種・長さ・径級・本数・材積）。会社名や車番はここで捨てる */
    const items = [];
    for (const cid of Object.keys(index).filter(isValidId)) {
      const consent = parseJson(await store.get(key(cid, 'consent')));
      if (consent?.version !== CONSENT_VERSION) { excluded += 1; continue; }     // 現行の同意がない会社のデータは使わない
      included += 1;
      const { tickets: ts } = await readTicketsFrom(store, cid, PER_COMPANY_LIMIT, dayRangeKeys(from, to));
      const who = pseudonym(cid);
      for (const t of ts) {
        const period = String(t.dateStr).slice(0, 7);
        for (const lot of t.lots) {
          const species = normalizeName(lot.species);
          const lengthM = formatLength(toHundredths(lot.lengthM));
          for (const r of lot.rows) {
            items.push({ who, period, species, lengthM, minD: lot.minD, maxD: lot.maxD, d: r.d, n: r.n, vol: BigInt(r.volNum) });
          }
        }
      }
    }

    let rows;
    let suppressed = 0;
    if (mode === 'aggregate') {
      // 月×樹種×長さ×径級ごとに合計する。関わった会社がk社未満の組み合わせは出さない
      const groups = new Map();
      for (const it of items) {
        const g = `${it.period}|${it.species}|${it.lengthM}|${it.d}`;
        const cur = groups.get(g) ?? { period: it.period, species: it.species, lengthM: it.lengthM, d: it.d, n: 0, vol: 0n, who: new Set() };
        cur.n += it.n; cur.vol += it.vol; cur.who.add(it.who);
        groups.set(g, cur);
      }
      rows = [];
      for (const g of groups.values()) {
        if (g.who.size < k) { suppressed += 1; continue; }
        rows.push({ period: g.period, species: g.species, lengthM: g.lengthM, d: g.d, n: g.n, volM3: formatVolume(g.vol), companies: g.who.size });
      }
      rows.sort((a, b) => (a.period + a.species + a.lengthM).localeCompare(b.period + b.species + b.lengthM, 'ja') || a.d - b.d);
    } else {
      // 1行ずつ。ただし、月×樹種×長さの組み合わせに関わった会社がk社未満なら、その組み合わせは出さない
      const cells = new Map();
      for (const it of items) {
        const c = `${it.period}|${it.species}|${it.lengthM}`;
        if (!cells.has(c)) cells.set(c, new Set());
        cells.get(c).add(it.who);
      }
      rows = [];
      const dropped = new Set();
      for (const it of items) {
        const c = `${it.period}|${it.species}|${it.lengthM}`;
        if (cells.get(c).size < k) { dropped.add(c); continue; }
        rows.push({ company: it.who, period: it.period, species: it.species, lengthM: it.lengthM, minD: it.minD, maxD: it.maxD, d: it.d, n: it.n, volM3: formatVolume(it.vol) });
      }
      suppressed = dropped.size;
      rows.sort((a, b) => (a.period + a.species + a.lengthM + a.company).localeCompare(b.period + b.species + b.lengthM + b.company, 'ja') || a.d - b.d);
    }

    const meta = { mode, k, from, to, companiesIncluded: included, companiesExcludedNoConsent: excluded, suppressedGroups: suppressed, rows: rows.length, generatedAt: now(), consentVersion: CONSENT_VERSION };
    await audit('ops.export', { mode, k, from, to, rows: rows.length, companies: included });
    return { rows, meta };
  }

  /* ---------------- 閲覧記録 ---------------- */
  async function auditList(body) {
    requireOperator(body);
    const t = now();
    const prev = new Date(t); prev.setUTCMonth(prev.getUTCMonth() - 1);
    const entries = [];
    for (const k of [auditKey(t), auditKey(prev.getTime())]) {
      for (const v of Object.values(await store.hgetall(k))) { const e = parseJson(v); if (e) entries.push(e); }
    }
    entries.sort((a, b) => b.at - a.at);
    return { entries: entries.slice(0, AUDIT_KEEP) };
  }

  const OPS = { 'ops.login': login, 'ops.companies': companies, 'ops.tickets': tickets, 'ops.export': exportData, 'ops.audit': auditList };

  /** @returns {Promise<{status:number, payload:object}>} */
  async function handle(body) {
    if (!store) return { status: 200, payload: { ok: false, error: 'not_configured' } };
    const op = String(body?.op ?? '');
    const run = OPS[op];
    if (!run) return { status: 400, payload: { ok: false, error: 'unknown_op' } };
    if (JSON.stringify(body).length > 20_000) return { status: 413, payload: { ok: false, error: 'too_large' } };
    try {
      return { status: 200, payload: { ok: true, ...(await run(body)) } };
    } catch (err) {
      if (err instanceof Fail) return { status: err.status, payload: { ok: false, error: err.error, ...err.extra } };
      console.error('ops error', op, err?.message ?? err);
      return { status: 500, payload: { ok: false, error: 'server_error' } };
    }
  }

  return { handle, OPS, pseudonym };
}
