/**
 * 事務所との連携（現場の端末側）
 * ------------------------------------------------------------------
 * 「事務所とデータを共有する」をオンにした端末だけが動く（初期はオフ）。
 *
 *   上り：出力した便を、通信できるときに事務所へ送る。
 *         送れなかった便は端末内の待ち行列に残し続ける（圏外が何日続いても消えない）。
 *   下り：事務所が登録した 納入枠・お知らせ・現場の台帳 を受け取り、端末内に保存する。
 *         圏外では、最後に受け取ったものを使う（画面側で「最終更新」を必ず出す）。
 *
 * 圏外の操作は一切ブロックしない。ここの処理が失敗しても、計測・保存・CSV出力は止まらない。
 */
import { CONFIG } from './config.js';
import { kvGet, kvSet, getTicket } from './db.js';
import * as subscription from './subscription.js';
import { aggregateTicket } from './csv.js';
import { normalizeTicket } from './lots.js';
import { resolveSiteId } from './office-rules.js';

const QUEUE = 'officeQueue';
const FEED = 'officeFeed';
const META = 'officeMeta';
const FEED_MIN_INTERVAL_MS = 2 * 60 * 1000;

export const isEnabled = async () => Boolean((await kvGet('settings', null))?.office);

async function post(body) {
  try {
    const res = await fetch(CONFIG.api.office, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({ ok: false, error: 'server_error' }));
    return { ...json, httpStatus: res.status };
  } catch {
    return { ok: false, error: 'offline', httpStatus: 0 };
  }
}

/** 事務所に送る形に直す。径級ごとの本数と材積（内部単位の整数）だけを送る */
export function buildPayload(ticket, sites = []) {
  const norm = normalizeTicket(ticket);
  const { lots } = aggregateTicket(norm);
  return {
    id: norm.id,
    dateStr: norm.dateStr,
    ticketNo: norm.ticketNo,
    truck: norm.truck ?? '',
    destination: norm.destination ?? '',
    ownCompany: norm.ownCompany ?? '',
    note: norm.note ?? '',
    outputAt: norm.outputAt ?? Date.now(),
    lots: lots.filter((l) => l.rows.length).map(({ lot, rows }) => ({
      species: lot.species,
      lengthM: lot.lengthM,
      minD: lot.minD,
      maxD: lot.maxD,
      site: lot.site ?? '',
      siteId: lot.siteId ?? resolveSiteId(sites, lot.site) ?? null,
      rows: rows.map((r) => ({ d: r.d, n: r.count, volNum: r.subtotal.toString() })),
    })),
  };
}

async function setMeta(patch) {
  const meta = { ...(await kvGet(META, {})), ...patch };
  await kvSet(META, meta);
  return meta;
}

export async function status() {
  const meta = await kvGet(META, {});
  const queue = await kvGet(QUEUE, []);
  return { enabled: await isEnabled(), pending: queue.length, lastSyncAt: meta.lastSyncAt ?? null, feedAt: meta.feedAt ?? null, error: meta.error ?? null };
}

/** 送る便を待ち行列に入れる（出力した直後に呼ぶ） */
export async function enqueue(ticketId) {
  if (!(await isEnabled())) return;
  const queue = await kvGet(QUEUE, []);
  if (!queue.includes(ticketId)) await kvSet(QUEUE, [...queue, ticketId]);
}

/** 機能をオンにしたとき、すでに出力済みの便も送りたい場合に使う（今は新しい便だけを送る） */
let flushing = false;

/**
 * 待ち行列の便を順に送る。送れたものから消す。
 * 通信できない・サーバーの不調は、次の機会（オンライン復帰・次回起動）にやり直す。
 */
export async function flush() {
  if (flushing || !(await isEnabled()) || !navigator.onLine) return status();
  flushing = true;
  try {
    const code = (await subscription.loadState()).code;
    if (!code) { await setMeta({ error: 'no_license' }); return status(); }
    let queue = await kvGet(QUEUE, []);
    const sites = (await kvGet(FEED, null))?.sites ?? [];
    for (const id of [...queue]) {
      const ticket = await getTicket(id);
      if (!ticket) { queue = queue.filter((x) => x !== id); await kvSet(QUEUE, queue); continue; }
      const r = await post({ op: 'ticket.put', code, ticket: buildPayload(ticket, sites) });
      if (r.ok) {
        queue = queue.filter((x) => x !== id);
        await kvSet(QUEUE, queue);
        await setMeta({ lastSyncAt: Date.now(), error: null });
      } else if (r.error === 'invalid' || r.error === 'too_long' || r.error === 'too_large') {
        // この便は事務所に受け付けてもらえない（形の問題）。いつまでも再送せず、待ち行列から外して知らせる
        queue = queue.filter((x) => x !== id);
        await kvSet(QUEUE, queue);
        await setMeta({ error: `rejected:${r.field ?? ''}` });
      } else {
        await setMeta({ error: r.error ?? 'unknown' });
        break;                                            // 通信・契約・設定の問題は、次の機会にやり直す
      }
    }
  } finally {
    flushing = false;
  }
  return status();
}

/** 事務所の納入枠・お知らせ・現場の台帳を受け取って保存する */
export async function refreshFeed({ force = false } = {}) {
  if (!(await isEnabled()) || !navigator.onLine) return null;
  const meta = await kvGet(META, {});
  if (!force && meta.feedAt && Date.now() - meta.feedAt < FEED_MIN_INTERVAL_MS) return getFeed();
  const code = (await subscription.loadState()).code;
  if (!code) { await setMeta({ error: 'no_license' }); return getFeed(); }
  const r = await post({ op: 'feed', code });
  if (!r.ok) {
    await setMeta({ error: r.error ?? 'unknown' });
    return getFeed();                                      // 取れなければ、前回のものを使い続ける
  }
  const feed = { sites: r.sites, quotas: r.quotas, usage: r.usage, notices: r.notices, serverTime: r.serverTime, fetchedAt: Date.now() };
  await kvSet(FEED, feed);
  await setMeta({ feedAt: Date.now(), error: null });
  return feed;
}

export const getFeed = () => kvGet(FEED, null);
export async function clear() { await kvSet(QUEUE, []); await kvSet(FEED, null); await kvSet(META, {}); }
