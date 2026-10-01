/**
 * 便とロット（1台に複数の材を積む）
 * ------------------------------------------------------------------
 * 「便」＝トラック1台ぶんの伝票。その中身が「ロット」。
 * ロット＝樹種・長さ・現場の組み合わせ（径級の範囲も持つ）。
 * 例：1台に「本谷のスギ4m」と「本谷のスギ2m」を積む、「本谷」と「向かいの沢」を積む。
 *
 * このファイルは画面に触れない純粋な関数だけ。テストで固めてある。
 *
 * 【古いデータとの互換】
 * これまでの伝票は「1伝票＝1ロット」の平らな形（species・lengthM・minD・maxD・site・entries が
 * 伝票の直下にある）で保存されている。読み込むときに normalizeTicket() で新しい形へ直す。
 * 何度通しても結果は同じ（冪等）。保存済みの伝票も、計測途中の下書きも、そのまま読める。
 */

/** ロット1つを作る。entries には径級ごとの入力（取消も残す）が入る */
export function newLot({ id, species, lengthM, minD, maxD, site = '', siteId = null }) {
  return {
    id: id ?? `lot-${Math.random().toString(36).slice(2, 10)}`,
    species: String(species ?? '').trim(),
    lengthM: String(lengthM),
    minD: Number(minD),
    maxD: Number(maxD),
    site: String(site ?? ''),
    siteId: siteId || null,         // 事務所の現場台帳のID。台帳に無い名前なら null（記録は止めない）
    entries: [],
  };
}

/**
 * 古い形（1伝票＝1ロット）を新しい形（lots 配列）に直す。冪等。
 * @param {object} ticket
 * @returns {object} lots と activeLot を持つ伝票
 */
export function normalizeTicket(ticket) {
  if (!ticket) return ticket;
  if (Array.isArray(ticket.lots)) {
    // 新しい形。activeLot が範囲外なら先頭に戻す
    const n = ticket.lots.length;
    const active = Number.isInteger(ticket.activeLot) && ticket.activeLot >= 0 && ticket.activeLot < n ? ticket.activeLot : 0;
    return active === ticket.activeLot ? ticket : { ...ticket, activeLot: active };
  }
  const { species, lengthM, minD, maxD, site, siteId, entries, ...rest } = ticket;
  return {
    ...rest,
    lots: [{
      id: `lot-${ticket.id ?? '0'}`,
      species: species ?? '',
      lengthM: String(lengthM ?? '0'),
      minD: Number(minD),
      maxD: Number(maxD),
      site: site ?? '',
      siteId: siteId ?? null,
      entries: entries ?? [],
    }],
    activeLot: 0,
  };
}

/** 同じ材か（樹種・長さ・現場が同じ）。長さは文字の違い（4 と 4.00）を無視して比べる */
export function sameLot(a, b) {
  return a.species.trim() === b.species.trim()
    && Number(a.lengthM) === Number(b.lengthM)
    && (a.site ?? '') === (b.site ?? '');
}

/** 同じ材のロットの添字。無ければ -1 */
export function indexOfSameLot(lots, spec) {
  return lots.findIndex((lot) => sameLot(lot, spec));
}

/**
 * タブに出す短い名前。樹種と長さ。
 * 樹種と長さが同じロットが並ぶ（現場だけ違う）ときは、現場を付けて見分ける。
 * @param {object} lot
 * @param {object[]} lots
 * @param {(m:string)=>string} formatLen 長さの整形（例：'4.00' → '4'）
 */
export function lotLabel(lot, lots, formatLen = (m) => String(Number(m))) {
  const base = `${lot.species} ${formatLen(lot.lengthM)}m`;
  const clash = lots.some((other) => other !== lot
    && other.species.trim() === lot.species.trim()
    && Number(other.lengthM) === Number(lot.lengthM));
  return clash && lot.site ? `${lot.site} ${base}` : base;
}

/** 有効な（取消でない）入力の本数 */
export function activeCount(lot) {
  let n = 0;
  for (const e of lot.entries) if (!e.cancelled) n += 1;
  return n;
}

/**
 * 径級の範囲を変えてよいか確かめる。すでに入力のある径級を範囲から外すと、
 * 画面に出ない入力が合計にだけ入ってしまうため、外せないようにする。
 * @returns {{minD:number, maxD:number}} 入力のある径級を含む範囲に直した値
 */
export function clampRangeToEntries(lot, minD, maxD) {
  let lo = minD;
  let hi = maxD;
  for (const e of lot.entries) {
    if (e.cancelled) continue;
    if (e.d < lo) lo = e.d;
    if (e.d > hi) hi = e.d;
  }
  return { minD: lo, maxD: hi };
}
