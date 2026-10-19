/**
 * 「選べるものは選択式に寄せる」ための候補づくり（画面に触れない純粋な関数）
 * ------------------------------------------------------------------
 * 樹種と規格長さは自由入力のまま（決定済み）。そのうえで、入力欄の下に「直近に使ったもの」と
 * 「よく使うもの」をボタンで並べ、タップだけで入れられるようにする。手袋でキーボードを使う場面を減らす。
 */
import { formatLength, toHundredths } from './jas.js';

/** よく使う規格長さ（m）。直近に使った長さが先に並び、足りない分をここから埋める */
export const COMMON_LENGTHS = ['2', '3', '3.65', '4', '5', '6', '8', '10', '12'];

/** 規格長さを表示用の形にそろえる（"3.00" → "3"）。読めないものは null */
function normLength(value) {
  try {
    const s = formatLength(toHundredths(String(value ?? '').trim()));
    return Number(s) > 0 ? s : null;
  } catch {
    return null;
  }
}

/** 重複（空白・大小の違い）を除いて、先に出てきたものを残す */
function uniq(values, key = (v) => v) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    const k = key(v);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

const nameKey = (s) => String(s ?? '').normalize('NFKC').trim().toLowerCase();

/**
 * 保存済みの伝票（新しい順）から、直近に使った値を取り出す。
 * @param {object[]} tickets normalizeTicket 済みの伝票（lots を持つ）
 * @param {'species'|'lengthM'|'site'} field
 * @returns {string[]} 新しく使った順、重複なし
 */
export function recentValues(tickets, field) {
  const raw = [];
  for (const ticket of tickets ?? []) {
    for (const lot of ticket?.lots ?? []) raw.push(lot?.[field]);
  }
  if (field === 'lengthM') return uniq(raw.map(normLength));
  return uniq(raw.map((v) => String(v ?? '').trim()), nameKey);
}

/**
 * 規格長さのボタン候補。直近に使った長さ（最大4つ）→ よく使う長さ、の順。
 * @param {string[]} recent recentValues(…, 'lengthM') の結果
 * @param {number} [limit=9]
 * @returns {string[]}
 */
export function lengthChoices(recent, limit = 9) {
  const first = (recent ?? []).map(normLength).filter(Boolean).slice(0, 4);
  return uniq([...first, ...COMMON_LENGTHS]).slice(0, limit);
}

/**
 * 樹種のボタン候補。直近に使った樹種 → 事務所のマスター・事前登録の樹種、の順。
 * @param {string[]} recent 直近に使った樹種
 * @param {string[]} masters 事務所が配った樹種など
 * @param {number} [limit=6]
 * @returns {string[]}
 */
export function speciesChoices(recent, masters, limit = 6) {
  return uniq([...(recent ?? []), ...(masters ?? [])].map((v) => String(v ?? '').trim()), nameKey).slice(0, limit);
}
