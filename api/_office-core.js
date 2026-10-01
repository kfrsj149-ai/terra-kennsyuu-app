/**
 * 事務所端末のサーバー側の中身（認証・データ・各操作）
 * ------------------------------------------------------------------
 * 入口は api/office.js の1か所だけ。ここは「保存先・時計・サブスク確認」を
 * 外から受け取る形（createOffice）にして、テストで差し替えられるようにしてある。
 *
 * 【誰が何をできるか】
 *   member（現場の端末）… ライセンスコードを持っている。できるのは
 *       ・便（伝票）を事務所に送る        ticket.put
 *       ・納入枠・お知らせ・現場の台帳を読む  feed
 *       ・添付の写真を読む                image.get
 *   office（事務所端末）… ログインして得た札（token）を持っている。上のほか
 *       ・便の一覧・工場の検収値の入力・削除
 *       ・納入枠／お知らせ／現場の台帳の登録・修正
 *       ・スマホで撮った写真（FAXなど）の受信箱
 *
 * 【会社の見分け方】
 *   ライセンスコード（Stripeの顧客ID入り・署名付き）→ 事業体ID（事務所の初期設定で発行）。
 *   事業体IDごとにデータを分けて保存するので、他社のデータは構造上読めない。
 *
 * 【事務所コード】
 *   初期設定のとき一度だけ画面に出す12文字の合言葉。サーバーには「ハッシュ」しか残さない。
 *   ライセンスコードは運転手も持っているので、事務所の操作はライセンスコード＋事務所コードの両方が要る。
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { verifyToken, signPayload, verifyPayload, stripeGet, describeSubscription } from './_lib.js';
import {
  ID_ALPHABET, isValidId, normalizeName, validateSiteName, findSiteByName, nameKey,
  parseM3, parseHm, SITE_NAME_MAX,
} from '../src/js/office-rules.js';

const HOUR = 3600;
const DAY_MS = 86_400_000;
const SUB_CACHE_SEC = HOUR;              // サブスクの確認結果を使い回す時間
const SUB_STALE_OK_MS = 30 * DAY_MS;     // Stripeに繋がらないとき、最後に有効と確認できてからこの期間は通す
const SESSION_MS = 30 * DAY_MS;          // 事務所端末のログインが続く期間
const LOCK_MAX = 8;                      // 事務所コードを間違えてよい回数
const LOCK_SEC = 15 * 60;
const USAGE_CACHE_SEC = 60;
const MAX_TICKETS_SCAN = 2000;

/** 画面の操作に対する「想定内の失敗」。HTTP 200 で ok:false を返す */
class Fail extends Error {
  constructor(error, extra = {}, status = 200) { super(error); this.error = error; this.extra = extra; this.status = status; }
}
const fail = (error, extra, status) => new Fail(error, extra, status);

/* ------------------------------------------------------------------
 * 小物
 * ------------------------------------------------------------------ */
function randomChars(n) {
  const bytes = randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i += 1) out += ID_ALPHABET[bytes[i] & 31];   // 32文字なので偏りなし
  return out;
}

const formatOfficeCode = (raw) => raw.match(/.{4}/g).join('-');

/** 入力ゆれを直す（小文字・ハイフン・空白、読み間違えやすい O→0 I,L→1） */
function normalizeOfficeCode(input) {
  return String(input ?? '').normalize('NFKC').toUpperCase().replace(/[\s-]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1');
}

const hashCode = (code, salt) => scryptSync(normalizeOfficeCode(code), salt, 32).toString('hex');

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

const sha = (s) => createHash('sha256').update(s).digest('hex');
const licKey = (payload) => `lic:${sha(String(payload.c ?? payload.s)).slice(0, 32)}`;
const key = (cid, name) => `co:${cid}:${name}`;

const parseJson = (s, fallback = null) => { if (s == null) return fallback; try { return JSON.parse(s); } catch { return fallback; } };

/* ------------------------------------------------------------------
 * 入力の検査（サーバーは画面を信用しない）
 * ------------------------------------------------------------------ */
// eslint-disable-next-line no-control-regex
const clean = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
const str = (v, max, { required = false, field = 'value' } = {}) => {
  const s = clean(v);
  if (required && !s) throw fail('invalid', { field });
  if ([...s].length > max) throw fail('too_long', { field });
  return s;
};
const intIn = (v, min, max, field) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw fail('invalid', { field });
  return n;
};
const digits = (v, field) => {
  const s = String(v ?? '');
  if (!/^\d{1,30}$/.test(s)) throw fail('invalid', { field });
  return s;
};
const dateStr = (v, field, required = true) => {
  const s = clean(v);
  if (!s && !required) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00`).getTime())) throw fail('invalid', { field });
  return s;
};
const whenStr = (v, field) => {
  const s = clean(v);
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s) || Number.isNaN(new Date(s.length === 10 ? `${s}T00:00` : s).getTime())) throw fail('invalid', { field });
  return s;
};
const dayKey = (ds) => Number(ds.replaceAll('-', ''));                 // 20261001
const ticketScore = (ds, ticketNo) => dayKey(ds) * 1_000_000 + (Number(String(ticketNo).replace(/\D/g, '')) || 0);

/* ==================================================================
 * 本体
 * ================================================================== */
/**
 * @param {object} deps
 * @param {import('./_office-store.js').Store|null} deps.store
 * @param {() => number} [deps.now]
 * @param {(subId:string) => Promise<boolean>} [deps.isSubscriptionActive]
 */
export function createOffice({ store, now = () => Date.now(), isSubscriptionActive = defaultIsActive }) {
  /* ---------------- サブスクの確認（キャッシュつき） ---------------- */
  async function ensureSubscription(cid, subId) {
    const ck = key(cid, `sub:${subId}`);
    const cached = parseJson(await store.get(ck));
    if (cached && now() - cached.checkedAt < SUB_CACHE_SEC * 1000) {
      if (!cached.active) throw fail('subscription_inactive', {}, 402);
      return;
    }
    let active;
    try {
      active = await isSubscriptionActive(subId);
    } catch {
      // Stripeに繋がらない。最近まで有効だったなら通す（現場を止めない）
      if (cached?.active && now() - cached.checkedAt < SUB_STALE_OK_MS) return;
      throw fail('subscription_unverified', {}, 503);
    }
    await store.set(ck, JSON.stringify({ active, checkedAt: now() }), 40 * 86400);
    if (!active) throw fail('subscription_inactive', {}, 402);
  }

  /* ---------------- 誰からの要求か ---------------- */
  async function memberCtx(body) {
    const payload = verifyToken(String(body.code ?? '').trim());
    if (!payload) throw fail('invalid_code');
    const cid = await store.get(licKey(payload));
    if (!cid) throw fail('office_not_set_up');
    await ensureSubscription(cid, payload.s);
    return { cid };
  }

  async function officeCtx(body) {
    const tok = verifyPayload('office', String(body.token ?? ''));
    if (!tok || !tok.cid || !(tok.x > now())) throw fail('unauthorized', {}, 401);
    const auth = parseJson(await store.get(key(tok.cid, 'auth')));
    if (!auth || auth.epoch !== tok.ep) throw fail('unauthorized', {}, 401);
    const primary = parseJson(await store.get(key(tok.cid, 'primary')));
    if (primary?.s) await ensureSubscription(tok.cid, primary.s);
    return { cid: tok.cid };
  }

  const issueToken = (cid, epoch) => signPayload('office', { cid, ep: epoch, x: now() + SESSION_MS });

  /* ---------------- 初期設定・ログイン ---------------- */
  async function setup(body) {
    const payload = verifyToken(String(body.code ?? '').trim());
    if (!payload) throw fail('invalid_code');
    if (await store.get(licKey(payload))) throw fail('already_setup');
    let active;
    try { active = await isSubscriptionActive(payload.s); } catch { throw fail('subscription_unverified', {}, 503); }
    if (!active) throw fail('subscription_inactive', {}, 402);

    let cid = null;
    for (let i = 0; i < 10 && !cid; i += 1) {
      const candidate = randomChars(8);
      if (await store.setIfAbsent(key(candidate, 'created'), String(now()))) cid = candidate;
    }
    if (!cid) throw fail('server_busy', {}, 503);

    const raw = randomChars(12);
    const salt = randomBytes(16).toString('hex');
    const auth = { salt, hash: hashCode(raw, salt), epoch: 1, createdAt: now() };
    await store.set(key(cid, 'auth'), JSON.stringify(auth));
    await store.set(key(cid, 'primary'), JSON.stringify({ s: payload.s }));
    // 同じ契約で同時に初期設定されても、先に結びついたほうだけを有効にする
    if (!(await store.setIfAbsent(licKey(payload), cid))) {
      await store.del(key(cid, 'auth')); await store.del(key(cid, 'primary')); await store.del(key(cid, 'created'));
      throw fail('already_setup');
    }
    await store.set(key(cid, 'sub:' + payload.s), JSON.stringify({ active: true, checkedAt: now() }), 40 * 86400);
    return { companyId: cid, officeCode: formatOfficeCode(raw), token: issueToken(cid, auth.epoch) };
  }

  async function login(body) {
    const payload = verifyToken(String(body.code ?? '').trim());
    if (!payload) throw fail('invalid_code');
    const cid = await store.get(licKey(payload));
    if (!cid) throw fail('office_not_set_up');

    const failKey = key(cid, 'fail');
    if (Number(await store.get(failKey) ?? 0) >= LOCK_MAX) throw fail('locked', { retryAfterSec: LOCK_SEC }, 429);

    const auth = parseJson(await store.get(key(cid, 'auth')));
    if (!auth || !safeEqualHex(hashCode(body.officeCode, auth.salt), auth.hash)) {
      const n = await store.incr(failKey, LOCK_SEC);
      throw fail(n >= LOCK_MAX ? 'locked' : 'bad_office_code', n >= LOCK_MAX ? { retryAfterSec: LOCK_SEC } : { triesLeft: LOCK_MAX - n }, n >= LOCK_MAX ? 429 : 200);
    }
    await store.del(failKey);
    await ensureSubscription(cid, payload.s);
    return { companyId: cid, token: issueToken(cid, auth.epoch) };
  }

  /** 別のアプリの契約を、この事業体につなぐ */
  async function link(body) {
    const { cid } = await officeCtx(body);
    const payload = verifyToken(String(body.code ?? '').trim());
    if (!payload) throw fail('invalid_code');
    let active;
    try { active = await isSubscriptionActive(payload.s); } catch { throw fail('subscription_unverified', {}, 503); }
    if (!active) throw fail('subscription_inactive', {}, 402);
    const lk = licKey(payload);
    const existing = await store.get(lk);
    if (existing && existing !== cid) throw fail('license_in_use');
    if (!existing) await store.set(lk, cid);
    return {};
  }

  /** 事務所コードを作り直す。古い札はすべて無効になる（紛失・退職時） */
  async function resetCode(body) {
    const { cid } = await officeCtx(body);
    const old = parseJson(await store.get(key(cid, 'auth')));
    const raw = randomChars(12);
    const salt = randomBytes(16).toString('hex');
    const auth = { salt, hash: hashCode(raw, salt), epoch: (old?.epoch ?? 0) + 1, createdAt: now() };
    await store.set(key(cid, 'auth'), JSON.stringify(auth));
    return { officeCode: formatOfficeCode(raw), token: issueToken(cid, auth.epoch) };
  }

  /* ---------------- 現場の台帳 ---------------- */
  async function loadSites(cid) {
    const all = await store.hgetall(key(cid, 'sites'));
    return Object.values(all).map((s) => parseJson(s)).filter(Boolean)
      .sort((a, b) => (a.closed === b.closed ? a.name.localeCompare(b.name, 'ja') : a.closed ? 1 : -1));
  }

  async function siteList(body) {
    const { cid } = await officeCtx(body);
    return { sites: await loadSites(cid) };
  }

  async function sitePut(body) {
    const { cid } = await officeCtx(body);
    const input = body.site ?? {};
    const v = validateSiteName(input.name);
    if (!v.ok) throw fail(v.error === 'empty' ? 'invalid' : 'too_long', { field: 'name', max: SITE_NAME_MAX });

    const aliases = [];
    for (const a of (Array.isArray(input.aliases) ? input.aliases : []).slice(0, 10)) {
      const av = validateSiteName(a);
      if (!av.ok) { if (av.error === 'too_long') throw fail('too_long', { field: 'aliases' }); continue; }
      if (nameKey(av.name) !== nameKey(v.name) && !aliases.some((x) => nameKey(x) === nameKey(av.name))) aliases.push(av.name);
    }

    const sites = await loadSites(cid);
    let existing = null;
    if (input.id) {
      if (!isValidId(input.id)) throw fail('invalid', { field: 'id' });
      existing = sites.find((s) => s.id === input.id);
      if (!existing) throw fail('not_found');
    }
    // 名前・別名が他の現場とぶつからないこと
    for (const candidate of [v.name, ...aliases]) {
      const hit = findSiteByName(sites, candidate, existing?.id);
      if (hit) throw fail('name_taken', { name: candidate, with: { id: hit.id, name: hit.name } });
    }

    let id = existing?.id;
    if (!id) {
      for (let i = 0; i < 10 && !id; i += 1) {
        const c = randomChars(8);
        if (!sites.some((s) => s.id === c)) id = c;
      }
      if (!id) throw fail('server_busy', {}, 503);
    }
    const attrs = input.attrs ?? {};
    const site = {
      id,
      name: v.name,
      aliases,
      attrs: {
        rinban: str(attrs.rinban, 40, { field: 'attrs.rinban' }),
        address: str(attrs.address, 100, { field: 'attrs.address' }),
        note: str(attrs.note, 200, { field: 'attrs.note' }),
      },
      closed: Boolean(input.closed),
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    };
    await store.hset(key(cid, 'sites'), id, JSON.stringify(site));
    return { site };
  }

  /** まだ台帳で引けない現場名（現場の端末が自由入力したもの）。名寄せの候補 */
  async function siteUnlinked(body) {
    const { cid } = await officeCtx(body);
    const sites = await loadSites(cid);
    const tickets = await recentTickets(cid, MAX_TICKETS_SCAN);
    const seen = new Map();
    for (const t of tickets) {
      for (const lot of t.lots) {
        const name = normalizeName(lot.site);
        if (!name || findSiteByName(sites, name)) continue;
        const k = nameKey(name);
        const cur = seen.get(k) ?? { name, count: 0, lastDate: '' };
        cur.count += 1;
        if (t.dateStr > cur.lastDate) cur.lastDate = t.dateStr;
        seen.set(k, cur);
      }
    }
    return { unlinked: [...seen.values()].sort((a, b) => b.count - a.count) };
  }

  /* ---------------- 便（伝票） ---------------- */
  async function recentTickets(cid, limit, { fromKey = 0, toKey = 99_999_999_999_999, offset = 0 } = {}) {
    const ids = await store.zrevrangebyscore(key(cid, 'tidx'), toKey, fromKey, offset, limit);
    if (!ids.length) return [];
    const rows = await store.mget(ids.map((id) => key(cid, `t:${id}`)));
    return rows.map((r) => parseJson(r)).filter(Boolean);
  }

  function cleanTicket(input, previous) {
    if (!input || typeof input !== 'object') throw fail('invalid', { field: 'ticket' });
    const id = clean(input.id);
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) throw fail('invalid', { field: 'id' });
    const lotsIn = Array.isArray(input.lots) ? input.lots : [];
    if (!lotsIn.length || lotsIn.length > 50) throw fail('invalid', { field: 'lots' });

    let totalCount = 0;
    let totalVol = 0n;
    const lots = lotsIn.map((l, i) => {
      const rowsIn = Array.isArray(l.rows) ? l.rows : [];
      if (rowsIn.length > 200) throw fail('invalid', { field: `lots[${i}].rows` });
      let count = 0;
      let vol = 0n;
      const rows = rowsIn.map((r, j) => {
        const n = intIn(r.n, 0, 100000, `lots[${i}].rows[${j}].n`);
        const v = digits(r.volNum, `lots[${i}].rows[${j}].volNum`);
        count += n; vol += BigInt(v);
        return { d: intIn(r.d, 1, 200, `lots[${i}].rows[${j}].d`), n, volNum: v };
      });
      totalCount += count; totalVol += vol;
      const siteId = l.siteId == null || l.siteId === '' ? null : (isValidId(l.siteId) ? l.siteId : (() => { throw fail('invalid', { field: `lots[${i}].siteId` }); })());
      return {
        species: str(l.species, 40, { required: true, field: `lots[${i}].species` }),
        lengthM: (() => { const s = clean(l.lengthM); if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) throw fail('invalid', { field: `lots[${i}].lengthM` }); return s; })(),
        minD: intIn(l.minD, 1, 200, `lots[${i}].minD`),
        maxD: intIn(l.maxD, 1, 200, `lots[${i}].maxD`),
        site: str(l.site, 60, { field: `lots[${i}].site` }),
        siteId,
        count,
        volNum: vol.toString(),
        rows,
      };
    });

    return {
      id,
      dateStr: dateStr(input.dateStr, 'dateStr'),
      ticketNo: str(input.ticketNo, 12, { required: true, field: 'ticketNo' }),
      truck: str(input.truck, 40, { field: 'truck' }),
      destination: str(input.destination, 60, { field: 'destination' }),
      ownCompany: str(input.ownCompany, 60, { field: 'ownCompany' }),
      note: str(input.note, 500, { field: 'note' }),
      outputAt: Number.isFinite(Number(input.outputAt)) ? Number(input.outputAt) : now(),
      receivedAt: now(),
      lots,
      totalCount,
      totalVolNum: totalVol.toString(),
      // 工場の検収値は事務所が入れるもの。現場から再送されても消さない
      factoryNum: previous?.factoryNum ?? null,
      factoryAt: previous?.factoryAt ?? null,
    };
  }

  async function ticketPut(body) {
    const { cid } = await memberCtx(body);
    const id = clean(body.ticket?.id);
    const previous = /^[A-Za-z0-9_-]{4,64}$/.test(id) ? parseJson(await store.get(key(cid, `t:${id}`))) : null;
    const ticket = cleanTicket(body.ticket, previous);
    if (previous && previous.dateStr !== ticket.dateStr) await store.zrem(key(cid, 'tidx'), ticket.id);
    await store.set(key(cid, `t:${ticket.id}`), JSON.stringify(ticket));
    await store.zadd(key(cid, 'tidx'), ticketScore(ticket.dateStr, ticket.ticketNo), ticket.id);
    await store.del(key(cid, 'usage'));
    return { id: ticket.id };
  }

  async function ticketList(body) {
    const { cid } = await officeCtx(body);
    const from = body.from ? dateStr(body.from, 'from') : null;
    const to = body.to ? dateStr(body.to, 'to') : null;
    const limit = Math.min(200, Math.max(1, Number(body.limit) || 100));
    const offset = Math.max(0, Number(body.offset) || 0);
    const tickets = await recentTickets(cid, limit + 1, {
      fromKey: from ? dayKey(from) * 1_000_000 : 0,
      toKey: to ? dayKey(to) * 1_000_000 + 999_999 : 99_999_999_999_999,
      offset,
    });
    return { tickets: tickets.slice(0, limit), hasMore: tickets.length > limit };
  }

  async function ticketSetFactory(body) {
    const { cid } = await officeCtx(body);
    const id = clean(body.id);
    const t = parseJson(await store.get(key(cid, `t:${id}`)));
    if (!t) throw fail('not_found');
    const text = clean(body.volume);
    if (text === '') { t.factoryNum = null; t.factoryAt = null; } else {
      const num = parseM3(text);
      if (num === null) throw fail('invalid', { field: 'volume' });
      t.factoryNum = num.toString();
      t.factoryAt = now();
    }
    await store.set(key(cid, `t:${id}`), JSON.stringify(t));
    await store.del(key(cid, 'usage'));
    return { ticket: t };
  }

  async function ticketDelete(body) {
    const { cid } = await officeCtx(body);
    const id = clean(body.id);
    await store.del(key(cid, `t:${id}`));
    await store.zrem(key(cid, 'tidx'), id);
    await store.del(key(cid, 'usage'));
    return {};
  }

  /* ---------------- 納入枠 ---------------- */
  function cleanQuota(input) {
    if (!input || typeof input !== 'object') throw fail('invalid', { field: 'quota' });
    const amountText = clean(input.amount);
    const amountNum = parseM3(amountText);
    if (amountNum === null || amountNum <= 0n) throw fail('invalid', { field: 'amount' });
    const timeFrom = clean(input.timeFrom);
    const timeTo = clean(input.timeTo);
    if (timeFrom && parseHm(timeFrom) === null) throw fail('invalid', { field: 'timeFrom' });
    if (timeTo && parseHm(timeTo) === null) throw fail('invalid', { field: 'timeTo' });
    if (timeFrom && timeTo && parseHm(timeFrom) >= parseHm(timeTo)) throw fail('invalid', { field: 'timeTo' });
    const from = dateStr(input.from, 'from');
    const to = dateStr(input.to, 'to');
    if (from > to) throw fail('invalid', { field: 'to' });
    const weekdays = [...new Set((Array.isArray(input.weekdays) ? input.weekdays : []).map((d) => intIn(d, 0, 6, 'weekdays')))].sort();
    const imageId = clean(input.imageId);
    if (imageId && !isValidId(imageId)) throw fail('invalid', { field: 'imageId' });
    return {
      destination: str(input.destination, 60, { required: true, field: 'destination' }),
      species: str(input.species, 40, { field: 'species' }),
      amount: amountText.normalize('NFKC'),
      amountNum: amountNum.toString(),
      from, to, weekdays, timeFrom, timeTo,
      note: str(input.note, 500, { field: 'note' }),
      imageId,
      status: input.status === 'archived' ? 'archived' : 'active',
    };
  }

  const loadQuotas = async (cid) => Object.values(await store.hgetall(key(cid, 'quotas'))).map((q) => parseJson(q)).filter(Boolean)
    .sort((a, b) => (a.from < b.from ? 1 : -1));

  async function quotaPut(body) {
    const { cid } = await officeCtx(body);
    const fields = cleanQuota(body.quota);
    let existing = null;
    if (body.quota.id) {
      if (!isValidId(body.quota.id)) throw fail('invalid', { field: 'id' });
      existing = parseJson(await store.hget(key(cid, 'quotas'), body.quota.id));
      if (!existing) throw fail('not_found');
    }
    const id = existing?.id ?? randomChars(8);
    const quota = { id, ...fields, createdAt: existing?.createdAt ?? now(), updatedAt: now() };
    await store.hset(key(cid, 'quotas'), id, JSON.stringify(quota));
    await store.del(key(cid, 'usage'));
    return { quota };
  }

  async function quotaDelete(body) {
    const { cid } = await officeCtx(body);
    await store.hdel(key(cid, 'quotas'), clean(body.id));
    await store.del(key(cid, 'usage'));
    return {};
  }

  /**
   * 枠ごとの消化量。工場の検収値がある便はそれを、無い便はこちらの値を使う。
   * 両者は混ぜずに別々に返す（確定と見込みを区別して見せるため）。
   */
  async function computeUsage(cid, quotas) {
    const cached = parseJson(await store.get(key(cid, 'usage')));
    if (cached && quotas.every((q) => cached[q.id])) return cached;

    const usage = {};
    for (const q of quotas) {
      const tickets = await recentTickets(cid, MAX_TICKETS_SCAN, {
        fromKey: dayKey(q.from) * 1_000_000,
        toKey: dayKey(q.to) * 1_000_000 + 999_999,
      });
      let confirmed = 0n; let estimated = 0n; let confirmedTickets = 0; let estimatedTickets = 0;
      for (const t of tickets) {
        if (nameKey(t.destination) !== nameKey(q.destination)) continue;
        const total = BigInt(t.totalVolNum);
        const matched = t.lots.filter((l) => !q.species || nameKey(l.species) === nameKey(q.species));
        if (!matched.length) continue;
        let mine = 0n;
        for (const l of matched) {
          const own = BigInt(l.volNum);
          // 工場の値は便ぜんたいの値。枠に関係する材のぶんだけ、こちらの比率で按分する
          mine += t.factoryNum != null ? (total > 0n ? (BigInt(t.factoryNum) * own) / total : 0n) : own;
        }
        if (t.factoryNum != null) { confirmed += mine; confirmedTickets += 1; } else { estimated += mine; estimatedTickets += 1; }
      }
      usage[q.id] = {
        confirmedNum: confirmed.toString(), estimatedNum: estimated.toString(),
        confirmedTickets, estimatedTickets,
      };
    }
    await store.set(key(cid, 'usage'), JSON.stringify(usage), USAGE_CACHE_SEC);
    return usage;
  }

  async function quotaList(body) {
    const { cid } = await officeCtx(body);
    const quotas = await loadQuotas(cid);
    return { quotas, usage: await computeUsage(cid, quotas) };
  }

  /* ---------------- お知らせ ---------------- */
  const NOTICE_KINDS = new Set(['closed', 'restricted', 'info']);

  async function noticePut(body) {
    const { cid } = await officeCtx(body);
    const input = body.notice ?? {};
    if (!NOTICE_KINDS.has(input.kind)) throw fail('invalid', { field: 'kind' });
    const from = whenStr(input.from, 'from');
    const to = whenStr(input.to, 'to');
    const norm = (s, edge) => (s.length === 10 ? `${s}T${edge}` : s);
    if (from && to && norm(from, '00:00') > norm(to, '23:59')) throw fail('invalid', { field: 'to' });
    const imageId = clean(input.imageId);
    if (imageId && !isValidId(imageId)) throw fail('invalid', { field: 'imageId' });
    let existing = null;
    if (input.id) {
      if (!isValidId(input.id)) throw fail('invalid', { field: 'id' });
      existing = parseJson(await store.hget(key(cid, 'notices'), input.id));
      if (!existing) throw fail('not_found');
    }
    const id = existing?.id ?? randomChars(8);
    const notice = {
      id,
      kind: input.kind,
      destination: str(input.destination, 60, { field: 'destination' }),
      place: str(input.place, 40, { field: 'place' }),
      title: str(input.title, 40, { field: 'title' }),
      body: str(input.body, 500, { required: true, field: 'body' }),
      from, to, imageId,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    };
    await store.hset(key(cid, 'notices'), id, JSON.stringify(notice));
    return { notice };
  }

  const loadNotices = async (cid) => Object.values(await store.hgetall(key(cid, 'notices'))).map((n) => parseJson(n)).filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);

  async function noticeList(body) {
    const { cid } = await officeCtx(body);
    return { notices: await loadNotices(cid) };
  }

  async function noticeDelete(body) {
    const { cid } = await officeCtx(body);
    await store.hdel(key(cid, 'notices'), clean(body.id));
    return {};
  }

  /* ---------------- 現場の端末が読むもの ---------------- */
  async function feed(body) {
    const { cid } = await memberCtx(body);
    const [sites, quotasAll, noticesAll] = await Promise.all([loadSites(cid), loadQuotas(cid), loadNotices(cid)]);
    const today = new Date(now() + 9 * 3600_000).toISOString().slice(0, 10);    // 日本時間の今日
    const quotas = quotasAll.filter((q) => q.status === 'active' && q.to >= today);
    const usage = await computeUsage(cid, quotas);
    // 終わったお知らせは送らない（端末側でも期間を見て畳むが、無駄な通信を減らす）
    const notices = noticesAll.filter((n) => !n.to || (n.to.length === 10 ? n.to : n.to.slice(0, 10)) >= today);
    return { serverTime: now(), sites, quotas, usage, notices };
  }

  /* ---------------- 受信箱（スマホで撮った写真） ---------------- */
  const IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
  const IMAGE_MAX = 700_000;

  async function inboxPut(body) {
    const { cid } = await officeCtx(body);
    const image = String(body.image ?? '');
    if (!IMAGE_RE.test(image)) throw fail('invalid', { field: 'image' });
    if (image.length > IMAGE_MAX) throw fail('too_large', { max: IMAGE_MAX }, 413);
    let id = null;
    for (let i = 0; i < 10 && !id; i += 1) {
      const c = randomChars(8);
      if (await store.setIfAbsent(key(cid, `img:${c}`), image)) id = c;
    }
    if (!id) throw fail('server_busy', {}, 503);
    const meta = { id, caption: str(body.caption, 80, { field: 'caption' }), bytes: image.length, createdAt: now() };
    await store.hset(key(cid, 'inbox'), id, JSON.stringify(meta));
    return { item: meta };
  }

  async function inboxList(body) {
    const { cid } = await officeCtx(body);
    const items = Object.values(await store.hgetall(key(cid, 'inbox'))).map((m) => parseJson(m)).filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt);
    return { items };
  }

  async function inboxDelete(body) {
    const { cid } = await officeCtx(body);
    const id = clean(body.id);
    if (!isValidId(id)) throw fail('invalid', { field: 'id' });
    const used = [...await loadQuotas(cid), ...await loadNotices(cid)].some((x) => x.imageId === id);
    if (used) throw fail('in_use');
    await store.del(key(cid, `img:${id}`));
    await store.hdel(key(cid, 'inbox'), id);
    return {};
  }

  async function imageGet(body) {
    const { cid } = (body.token ? await officeCtx(body) : await memberCtx(body));
    const id = clean(body.id);
    if (!isValidId(id)) throw fail('invalid', { field: 'id' });
    const image = await store.get(key(cid, `img:${id}`));
    if (!image) throw fail('not_found');
    return { image };
  }

  /* ---------------- 振り分け ---------------- */
  const OPS = {
    'office.setup': setup, 'office.login': login, 'office.link': link, 'office.resetCode': resetCode,
    'feed': feed, 'image.get': imageGet,
    'ticket.put': ticketPut, 'ticket.list': ticketList, 'ticket.setFactory': ticketSetFactory, 'ticket.delete': ticketDelete,
    'site.list': siteList, 'site.put': sitePut, 'site.unlinked': siteUnlinked,
    'quota.list': quotaList, 'quota.put': quotaPut, 'quota.delete': quotaDelete,
    'notice.list': noticeList, 'notice.put': noticePut, 'notice.delete': noticeDelete,
    'inbox.put': inboxPut, 'inbox.list': inboxList, 'inbox.delete': inboxDelete,
  };

  /**
   * @returns {Promise<{status:number, payload:object}>}
   */
  async function handle(body) {
    if (!store) return { status: 200, payload: { ok: false, error: 'not_configured' } };
    const op = String(body?.op ?? '');
    const run = OPS[op];
    if (!run) return { status: 400, payload: { ok: false, error: 'unknown_op' } };
    const limit = op === 'inbox.put' ? 1_000_000 : 120_000;
    if (JSON.stringify(body).length > limit) return { status: 413, payload: { ok: false, error: 'too_large' } };
    try {
      return { status: 200, payload: { ok: true, ...(await run(body)) } };
    } catch (err) {
      if (err instanceof Fail) return { status: err.status, payload: { ok: false, error: err.error, ...err.extra } };
      console.error('office error', op, err?.message ?? err);
      return { status: 500, payload: { ok: false, error: 'server_error' } };
    }
  }

  return { handle, OPS };
}

async function defaultIsActive(subId) {
  const sub = await stripeGet(`/subscriptions/${encodeURIComponent(subId)}`);
  return describeSubscription(sub).status === 'active';
}
