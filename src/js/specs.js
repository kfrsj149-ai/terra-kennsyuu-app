/**
 * 納入先ごとの規格（事務所が登録して、現場の端末に配る）を、準備画面で使うための純粋な関数。
 * 規格を選ぶと、樹種・長さ・太さの範囲が自動で入る。選んだあとで手で変えたら、規格の選択は外れる。
 * 単価など、運転手に見せない項目は、そもそも端末に届かない（サーバーが送らない）。
 */
import { formatLength, toHundredths, normalizeDiameter } from './jas.js';
import { nameKey } from './office-rules.js';

/** 選んだ納入先と同じ相手を指す名前の目印（名前と、事務所のマスターに登録された別名） */
export function destinationKeys(feed, destination) {
  const keys = new Set();
  const own = nameKey(destination);
  if (!own) return keys;
  keys.add(own);
  for (const m of feed?.masters?.destinations ?? []) {
    const group = [m.name, ...(m.aliases ?? [])].map(nameKey);
    if (group.includes(own)) group.forEach((k) => keys.add(k));
  }
  return keys;
}

/** その納入先の規格を、名前の順に返す。納入先が空、または規格が無ければ空 */
export function specsFor(feed, destination) {
  const keys = destinationKeys(feed, destination);
  if (keys.size === 0) return [];
  return (feed?.specs ?? [])
    .filter((sp) => keys.has(nameKey(sp.destination)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ja'));
}

const hasRange = (sp) => sp.minD !== null && sp.minD !== undefined && sp.maxD !== null && sp.maxD !== undefined;

/**
 * 規格を準備画面に入れる値にする。空のものは「変えない」（species / lengthM は ''、太さは null）。
 * 太さは、有効な径級（14cm未満1cm刻み、以上2cm刻み）に丸める。
 */
export function specSetup(sp) {
  return {
    species: String(sp?.species ?? '').trim(),
    lengthM: String(sp?.lengthM ?? '').trim(),
    minD: hasRange(sp) ? normalizeDiameter(Number(sp.minD)) : null,
    maxD: hasRange(sp) ? normalizeDiameter(Number(sp.maxD)) : null,
  };
}

const sameLength = (a, b) => {
  try { return formatLength(toHundredths(a)) === formatLength(toHundredths(b)); } catch { return false; }
};

/** 画面の入力が、規格の内容のままか（手で変えていたら false。規格に空の項目があれば、その項目は何でもよい） */
export function specStillMatches(sp, { species, lengthRaw, minD, maxD }) {
  const s = specSetup(sp);
  if (s.species && nameKey(species) !== nameKey(s.species)) return false;
  if (s.lengthM && !sameLength(lengthRaw, s.lengthM)) return false;
  if (s.minD !== null && (Number(minD) !== s.minD || Number(maxD) !== s.maxD)) return false;
  return true;
}
