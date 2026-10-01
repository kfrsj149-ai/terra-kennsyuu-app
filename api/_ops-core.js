/**
 * 運営者コンソールのサーバー側（TERRA TX の運営者だけが使う）
 * ------------------------------------------------------------------
 * 目的：事務所に共有された検収データを、運営者が閲覧できるようにし、
 *       研究・販売に使うときのために、匿名化したデータを書き出せるようにする。
 *       これは利用規約・プライバシーポリシーに明記してある取り扱いで、
 *       事務所の初期設定のとき（同意文の版 CONSENT_VERSION）に利用者の同意を得ている。
 *
 * 【守っていること】
 *   ・閲覧専用。会社のデータを書き換える操作はない（書くのは閲覧記録・ログインの試行回数・書き出しの凍結だけ）
 *   ・認証は環境変数 OPERATOR_KEY（24文字以上）。未設定なら機能全体が無効。ログインの試行はIPごと・全体で数え、
 *     数えてから照合する（並列に送っても回数を超えて試せない）。失敗・ロックも閲覧記録に残す
 *   ・すべての閲覧・書き出しを閲覧記録（ops:audit:YYYYMM）に残す。記録→返却の順なので、記録できなければ何も返さない
 *   ・生データの閲覧も、書き出しも、現行の同意文に同意している会社だけ
 *   ・札はサーバー側で失効できる（ops.logout）。鍵を変えても全部失効する
 *
 * 【匿名化の書き出しで守っていること】
 *   ・含めない：会社名・車番・現場名・納入先・備考・伝票番号・便ID・正確な日付（月まで）
 *   ・k匿名：関わった会社がk社（3以上）未満の組み合わせは出さない。さらに、1社の寄与が8割を超える組み合わせも出さない（優位性）
 *   ・期間は「確定した過去の月」だけを月単位で受け付ける。同じ条件の再書き出しは、凍結した同じ結果を返す
 *     （期間を少しずつずらしたり、時点を変えて2回書き出して引き算すると、特定の1社・1日分が復元できてしまうため）。
 *     作り直す（refresh）と凍結が更新され、その旨が閲覧記録に残る
 *   ・会社は、書き出しごとに変わる鍵付きの仮名にする。別々の書き出し同士を結合できない
 *
 * 【できないこと・限界（正直に）】
 *   ・仮名は、運営者が鍵（LICENSE_SECRET）と会社一覧を持っていれば、再計算して元の会社に結びつけられる。
 *     つまり個別モードは「匿名」ではなく「仮名化」であり、運営者に対する匿名性はない。第三者へ渡すときの保護である
 *   ・同じ人が複数の契約（複数の事業体）を作って会社数を水増しすることは、システムでは見分けられない
 *   ・個人情報保護法の「匿名加工情報」の基準を満たすことまでは保証しない。第三者へ販売・提供する前に、必ず専門家に確認すること
 *   ・閲覧記録は、同じ保存先（Upstash）の認証情報を持つ人なら消せる。APIの上では消す操作がない、という意味である
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { signPayload, verifyPayload } from './_lib.js';
import { key, parseJson, readTicketsFrom, dayRangeKeys, isDateString } from './_office-core.js';
import { CONSENT_VERSION, isValidId, normalizeName } from '../src/js/office-rules.js';
import { formatVolume, formatLength, toHundredths } from '../src/js/jas.js';

const LOCK_MAX = 8;                      // 1つのIPが15分に試せる回数
const GLOBAL_LOCK_MAX = 200;             // 全体で15分に試せる回数（IPを変えて試し続けるのを止める）
const LOCK_SEC = 15 * 60;
const SESSION_MS = 12 * 3600 * 1000;
const MIN_KEY_LENGTH = 24;
const MIN_K = 3;
const DOMINANCE = 0.8;                   // 1社の寄与がこの割合を超える組み合わせは出さない
const SNAPSHOT_MAX = 900_000;            // 凍結した結果の保存サイズ上限（圧縮後）
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

  const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m)) && Number(String(m).slice(0, 4)) >= 2000 && Number(String(m).slice(0, 4)) <= 2100;
  /** UTCで見た「いまの月」の前の月。いまの月は未確定なので、書き出しの対象にしない */
  const lastCompletedMonth = () => {
    const d = new Date(now());
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  };
  const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };

  /* ---------------- 閲覧記録 ---------------- */
  const monthKey = (y, m0) => `ops:audit:${y}${String(m0 + 1).padStart(2, '0')}`;      // m0 は 0〜11
  const auditKey = (t) => { const d = new Date(t); return monthKey(d.getUTCFullYear(), d.getUTCMonth()); };
  async function audit(op, detail = {}) {
    const t = now();
    await store.hset(auditKey(t), `${t}-${Math.random().toString(36).slice(2, 7)}`, JSON.stringify({ at: t, op, ...detail }));
  }

  /* ---------------- 認証 ---------------- */
  const ipId = (ip) => sha(String(ip ?? 'unknown')).toString('hex').slice(0, 12);     // 記録には、IPそのものでなく指紋だけを残す

  async function login(body, ctx = {}) {
    const k = configuredKey();
    if (!k) throw fail('ops_not_configured');
    // 先に回数を数え、その結果で止める（確認してから数えると、並列に送られたとき回数を超えて試せてしまう）
    const who = ipId(ctx.ip);
    const ipKey = `ops:fail:ip:${who}`;
    const nIp = await store.incr(ipKey, LOCK_SEC);
    const nAll = await store.incr('ops:fail:all', LOCK_SEC);
    if (nIp > LOCK_MAX || nAll > GLOBAL_LOCK_MAX) {
      if (nIp === LOCK_MAX + 1 || nAll === GLOBAL_LOCK_MAX + 1) await audit('ops.login.locked', { ip: who });
      throw fail('locked', { retryAfterSec: LOCK_SEC }, 429);
    }
    if (!timingSafeEqual(sha(String(body.key ?? '')), sha(k))) {
      await audit('ops.login.failed', { ip: who });
      throw fail('bad_key');
    }
    await store.del(ipKey);
    await audit('ops.login', { ip: who });
    const epoch = Number(await store.get('ops:epoch') ?? 0);
    return { token: signPayload(purpose(k), { x: now() + SESSION_MS, ep: epoch }) };
  }

  async function requireOperator(body) {
    const k = configuredKey();
    if (!k) throw fail('ops_not_configured');
    const tok = verifyPayload(purpose(k), String(body.token ?? ''));
    if (!tok || !(tok.x > now()) || tok.ep !== Number(await store.get('ops:epoch') ?? 0)) throw fail('unauthorized', {}, 401);
  }

  /** すべての札を無効にする（ログアウト。盗まれた札の無効化にも使える） */
  async function logout(body) {
    await requireOperator(body);
    await store.incr('ops:epoch');
    await audit('ops.logout');
    return {};
  }

  /* ---------------- 会社一覧 ---------------- */
  async function companies(body) {
    await requireOperator(body);
    const index = await store.hgetall('companies');
    const list = [];
    for (const [cid, raw] of Object.entries(index)) {
      if (!isValidId(cid)) continue;
      const meta = parseJson(raw, {});
      const consent = parseJson(await store.get(key(cid, 'consent')));
      const consentOk = consent?.version === CONSENT_VERSION;
      // 現行の同意がない会社は、存在と件数だけ。便の中身（会社名を含む）は見ない
      const latest = consentOk ? (await readTicketsFrom(store, cid, 1)).tickets : [];
      list.push({
        id: cid,
        createdAt: meta.createdAt ?? null,
        consentOk,
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
    await requireOperator(body);
    if (!isValidId(body.cid)) throw fail('invalid', { field: 'cid' });
    // 同意が現行版でない会社の生データは閲覧しない（利用者が同意した範囲でだけ見る）
    const consent = parseJson(await store.get(key(body.cid, 'consent')));
    if (!consent) throw fail('not_found');                  // 事務所を設定していない（存在しない）会社
    if (consent.version !== CONSENT_VERSION) {
      await audit('ops.tickets.denied', { cid: body.cid, reason: 'no_consent' });
      throw fail('no_consent');
    }
    const from = body.from ? (isDateString(body.from) ? body.from : (() => { throw fail('invalid', { field: 'from' }); })()) : null;
    const to = body.to ? (isDateString(body.to) ? body.to : (() => { throw fail('invalid', { field: 'to' }); })()) : null;
    const limit = Math.min(200, Math.max(1, Number.isInteger(Number(body.limit)) ? Number(body.limit) : 100));
    const offset = Number.isInteger(Number(body.offset)) && Number(body.offset) >= 0 ? Math.min(Number(body.offset), 100_000) : 0;
    const r = await readTicketsFrom(store, body.cid, limit + 1, { ...dayRangeKeys(from, to), offset });
    await audit('ops.tickets', { cid: body.cid, from, to, offset, returned: Math.min(r.tickets.length, limit) });
    return { tickets: r.tickets.slice(0, limit), hasMore: r.tickets.length > limit };
  }

  /* ---------------- 匿名化した書き出し ---------------- */
  /**
   * 会社を鍵付きのハッシュで仮名にする。書き出しごとに salt が変わるので、別々の書き出し同士は結合できない。
   * （運営者が鍵と会社一覧を持てば再計算できるので、運営者に対する匿名性はない。第三者へ渡すときの保護）
   */
  const pseudonym = (cid, salt = '') => `c_${createHmac('sha256', String(pseudonymSecret() ?? '')).update(`export-pseudonym-v2:${salt}:${cid}`).digest('hex').slice(0, 10)}`;

  /** 1つの組み合わせ（セル）を出してよいか。会社がk社以上で、1社の寄与が8割以下 */
  const publishable = (contrib, k) => {
    const total = [...contrib.values()].reduce((a, b) => a + b, 0);
    const max = Math.max(...contrib.values());
    return contrib.size >= k && total > 0 && max / total <= DOMINANCE;
  };

  async function exportData(body) {
    await requireOperator(body);
    const mode = body.mode === 'records' ? 'records' : 'aggregate';
    const k = Math.max(MIN_K, Math.min(100, Number.isInteger(Number(body.k)) ? Number(body.k) : MIN_K));
    if (!String(pseudonymSecret() ?? '')) throw fail('ops_not_configured');
    // 期間は月単位。確定した過去の月（いまの月より前）だけ
    if ((body.from && !isMonth(body.from)) || (body.to && !isMonth(body.to))) throw fail('invalid', { field: 'month' });
    const last = lastCompletedMonth();
    const from = body.from || '2000-01';
    const to = body.to && body.to < last ? body.to : last;
    const refresh = body.refresh === true;

    const snapKey = `ops:export:${mode}:${k}:${from}:${to}`;
    if (!refresh) {
      const frozen = await store.get(snapKey);
      if (frozen) {
        const r = JSON.parse(gunzipSync(Buffer.from(frozen, 'base64')).toString('utf8'));
        r.meta.frozen = true;
        await audit('ops.export', { mode, k, from, to, rows: r.rows.length, frozen: true });
        return r;
      }
    }

    const salt = randomBytes(8).toString('hex');
    const index = await store.hgetall('companies');
    let included = 0;
    let excluded = 0;
    /** 1行ぶんの材料（会社・月・樹種・長さ・径級・本数・材積）。会社名や車番はここで捨てる */
    const items = [];
    if (from <= to) {
      for (const cid of Object.keys(index).filter(isValidId)) {
        const consent = parseJson(await store.get(key(cid, 'consent')));
        if (consent?.version !== CONSENT_VERSION) { excluded += 1; continue; }     // 現行の同意がない会社のデータは使わない
        included += 1;
        const { tickets: ts } = await readTicketsFrom(store, cid, PER_COMPANY_LIMIT, dayRangeKeys(`${from}-01`, monthEnd(to)));
        const who = pseudonym(cid, salt);
        for (const t of ts) {
          const period = String(t.dateStr).slice(0, 7);
          for (const lot of t.lots) {
            const species = normalizeName(lot.species);
            const lengthM = formatLength(toHundredths(lot.lengthM));
            for (const r of lot.rows) {
              if (!(r.n > 0) || BigInt(r.volNum) <= 0n) continue;                  // 実体のない行は、会社数の水増しになるので数えない
              items.push({ who, period, species, lengthM, minD: lot.minD, maxD: lot.maxD, d: r.d, n: r.n, vol: BigInt(r.volNum) });
            }
          }
        }
      }
    }

    let rows;
    let suppressed = 0;
    if (mode === 'aggregate') {
      // 月×樹種×長さ×径級ごとに合計する
      const groups = new Map();
      for (const it of items) {
        const g = `${it.period}|${it.species}|${it.lengthM}|${it.d}`;
        const cur = groups.get(g) ?? { period: it.period, species: it.species, lengthM: it.lengthM, d: it.d, n: 0, vol: 0n, contrib: new Map() };
        cur.n += it.n; cur.vol += it.vol; cur.contrib.set(it.who, (cur.contrib.get(it.who) ?? 0) + it.n);
        groups.set(g, cur);
      }
      rows = [];
      for (const g of groups.values()) {
        if (!publishable(g.contrib, k)) { suppressed += 1; continue; }
        rows.push({ period: g.period, species: g.species, lengthM: g.lengthM, d: g.d, n: g.n, volM3: formatVolume(g.vol), companies: g.contrib.size });
      }
      rows.sort((a, b) => (a.period + a.species + a.lengthM).localeCompare(b.period + b.species + b.lengthM, 'ja') || a.d - b.d);
    } else {
      // 1行ずつ。月×樹種×長さの組み合わせ（セル）が出してよい条件を満たすときだけ
      const cells = new Map();
      for (const it of items) {
        const c = `${it.period}|${it.species}|${it.lengthM}`;
        if (!cells.has(c)) cells.set(c, new Map());
        cells.get(c).set(it.who, (cells.get(c).get(it.who) ?? 0) + it.n);
      }
      rows = [];
      const dropped = new Set();
      for (const it of items) {
        const c = `${it.period}|${it.species}|${it.lengthM}`;
        if (!publishable(cells.get(c), k)) { dropped.add(c); continue; }
        rows.push({ company: it.who, period: it.period, species: it.species, lengthM: it.lengthM, minD: it.minD, maxD: it.maxD, d: it.d, n: it.n, volM3: formatVolume(it.vol) });
      }
      suppressed = dropped.size;
      // 並びは、元の便の順序が残らないよう、内容だけで決める
      rows.sort((a, b) => (a.period + a.species + a.lengthM + a.company).localeCompare(b.period + b.species + b.lengthM + b.company, 'ja') || a.d - b.d || a.n - b.n);
    }

    const meta = {
      mode, k, from, to, exportId: salt, dominance: DOMINANCE, frozen: false, refreshed: refresh,
      companiesIncluded: included, companiesExcludedNoConsent: excluded, suppressedGroups: suppressed, rows: rows.length,
      generatedAt: now(), consentVersion: CONSENT_VERSION,
    };
    const result = { rows, meta };
    // 同じ条件の再書き出しが同じ結果になるよう凍結する（差分から個別の便が推測されるのを防ぐ）。大きすぎる場合は凍結できない
    const packed = gzipSync(Buffer.from(JSON.stringify(result), 'utf8')).toString('base64');
    if (packed.length <= SNAPSHOT_MAX) await store.set(snapKey, packed);
    else meta.freezeSkipped = true;
    await audit('ops.export', { mode, k, from, to, rows: rows.length, companies: included, refresh });
    return result;
  }

  /* ---------------- 閲覧記録 ---------------- */
  async function auditList(body) {
    await requireOperator(body);
    const d = new Date(now());
    const keys = [monthKey(d.getUTCFullYear(), d.getUTCMonth())];
    const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));       // 月末でも前の月になる作り方
    keys.push(monthKey(prev.getUTCFullYear(), prev.getUTCMonth()));
    const entries = [];
    for (const k of keys) {
      for (const v of Object.values(await store.hgetall(k))) { const e = parseJson(v); if (e) entries.push(e); }
    }
    entries.sort((a, b) => b.at - a.at);
    await audit('ops.audit');                         // 記録を見たこと自体も記録する
    return { entries: entries.slice(0, AUDIT_KEEP) };
  }

  const OPS = { 'ops.login': login, 'ops.logout': logout, 'ops.companies': companies, 'ops.tickets': tickets, 'ops.export': exportData, 'ops.audit': auditList };

  /** @returns {Promise<{status:number, payload:object}>} */
  async function handle(body, ctx = {}) {
    if (!store) return { status: 200, payload: { ok: false, error: 'not_configured' } };
    const op = String(body?.op ?? '');
    const run = OPS[op];
    if (!run) return { status: 400, payload: { ok: false, error: 'unknown_op' } };
    if (JSON.stringify(body).length > 20_000) return { status: 413, payload: { ok: false, error: 'too_large' } };
    try {
      return { status: 200, payload: { ok: true, ...(await run(body, ctx)) } };
    } catch (err) {
      if (err instanceof Fail) return { status: err.status, payload: { ok: false, error: err.error, ...err.extra } };
      console.error('ops error', op, err?.message ?? err);
      return { status: 500, payload: { ok: false, error: 'server_error' } };
    }
  }

  return { handle, OPS, pseudonym };
}
