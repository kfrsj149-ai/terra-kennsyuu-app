/**
 * JAS材積計算エンジン（本アプリの心臓部・正確性最優先）
 * =====================================================
 * 【設計方針】
 * JavaScriptの浮動小数点(Number)は 0.1+0.2 !== 0.3 になるため、材積計算には一切使わない。
 * すべて BigInt（整数）で「分子だけ」を持ち回り、表示・出力の瞬間にだけ文字列へ変換する。
 * これにより何万本積み上げても誤差が1mm³も発生しない。
 *
 * 【計算式】（CLAUDE.md 準拠）
 *   L < 6m の場合:
 *       D < 14cm  → V = D^2 * L / 10000            （補正なし）
 *       D >= 14cm → V = (D + (L-4)/2)^2 * L / 10000（長さ補正のみ）
 *   L >= 6m の場合:
 *       D >= 14cm → p = (L-4)/2 + (D-12)/2
 *                   V = (D + p)^2 * L / 10000      （長さ補正 + 径級補正）
 *       D < 14cm  → V = (D + (L-4)/2)^2 * L / 10000（長さ補正のみ）
 *
 * 競合アプリ「Log Counter Plus」は L>=6 でも径級補正 (D-12)/2 を欠落させており、
 * 12m材38本で 92.112m³（正しくは 166.698m³）という過小評価を起こす。
 * tests/jas.test.js でこのケースを毎回検証している。
 *
 * 【内部表現】
 * S = 200 * (D + 補正)  … 1/200cm 単位の整数
 * V = (S/200)^2 * (Li/100) / 10000 = S^2 * Li / 4e10
 * よって「分子 = S^2 * Li」「分母 = 4e10(固定)」で材積を完全な有理数として扱える。
 */

/** 材積の固定分母。材積(m³) = 分子 / VOLUME_DENOMINATOR */
export const VOLUME_DENOMINATOR = 40_000_000_000n; // 4 * 10^10

/** 小数第3位まで（第4位以下切り捨て）にするための除数 */
const MILLI_DIVISOR = VOLUME_DENOMINATOR / 1000n; // 4 * 10^7

/** 径級の刻みが1cmから2cmへ切り替わる境界（JAS: 14cm未満は1cm括り） */
export const DIAMETER_STEP_BOUNDARY = 14;

/** 規格長さの分岐点（6m以上は長尺式） */
export const LONG_LOG_THRESHOLD_HUNDREDTHS = 600n; // 6.00m

/**
 * 「2」「2.15」などの規格長さを 1/100m 単位の BigInt に変換する。
 * parseFloat を通さず文字列のまま解析するため、2.15 が 2.1499999 になる事故が起きない。
 * @param {string|number} value 規格長さ（m、小数点以下2桁まで）
 * @returns {bigint} 1/100m単位の長さ（例: "2.15" -> 215n）
 */
export function toHundredths(value) {
  const s = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new RangeError(`規格長さが不正です: ${value}`);
  }
  const [intPart, fracPart = ''] = s.split('.');
  const frac = (fracPart + '00').slice(0, 2);
  return BigInt(intPart) * 100n + BigInt(frac);
}

/**
 * 1/100m単位の長さを表示用文字列にする。
 * 2.00m -> "2"、2.15m -> "2.15"、2.50m -> "2.5"（末尾ゼロは落とす）
 * @param {bigint|number|string} hundredths
 * @returns {string}
 */
export function formatLength(hundredths) {
  const h = typeof hundredths === 'bigint' ? hundredths : toHundredths(hundredths);
  const int = h / 100n;
  const frac = h % 100n;
  if (frac === 0n) return String(int);
  const s = String(frac).padStart(2, '0').replace(/0$/, '');
  return `${int}.${s}`;
}

/**
 * 丸太1本あたりの材積の「分子」を求める（分母は VOLUME_DENOMINATOR 固定）。
 * 切り捨ては一切行わない。合計してから最後に切り捨てるのが仕様。
 * @param {string|number} lengthM 規格長さ(m)
 * @param {number} diameterCm 径級(cm)
 * @returns {bigint} 材積の分子
 */
export function volumeNumerator(lengthM, diameterCm) {
  const Li = toHundredths(lengthM);
  const D = BigInt(Math.trunc(diameterCm));
  if (D <= 0n) throw new RangeError(`径級が不正です: ${diameterCm}`);

  // S = 200 * (D + 補正)
  let S;
  if (Li < LONG_LOG_THRESHOLD_HUNDREDTHS) {
    // 短尺材（6m未満）
    S = D < 14n
      ? 200n * D                    // 補正なし: V = D^2 * L / 10000
      : 200n * D + (Li - 400n);     // 長さ補正のみ
  } else {
    // 長尺材（6m以上）
    S = D >= 14n
      ? 300n * D + Li - 1600n       // 長さ補正 + 径級補正 (D + (L-4)/2 + (D-12)/2)
      : 200n * D + (Li - 400n);     // 長さ補正のみ
  }
  if (S < 0n) S = 0n;
  return S * S * Li;
}

/**
 * 材積の分子を切り捨ての文字列にする。四捨五入は行わない。
 * 既定は仕様どおり小数第3位まで（第4位以下切り捨て）。
 * 単材積を表示するときだけ decimals=4 を使う。3桁だと
 * 「単材積 × 本数 = 小計材積」が手計算で合わなくなり、工場での突き合わせで揉めるため。
 * @param {bigint} numerator
 * @param {number} [decimals=3]
 * @returns {string} 例 "166.698"
 */
export function formatVolume(numerator, decimals = 3) {
  const scale = 10n ** BigInt(decimals);
  const units = numerator / (VOLUME_DENOMINATOR / scale); // BigInt除算は正数では切り捨て
  const int = units / scale;
  const frac = units % scale;
  return `${int}.${String(frac).padStart(decimals, '0')}`;
}

/**
 * 分子を「小数第4位以下を切り捨てた値」の分子に丸める。
 * 径級ごとに切り捨ててから合計する方針を採る場合に使う。
 * @param {bigint} numerator
 * @returns {bigint}
 */
export function truncateNumerator(numerator) {
  return (numerator / MILLI_DIVISOR) * MILLI_DIVISOR;
}

/**
 * 材積の分子を Number(m³) に変換する。表示以外（グラフ等）の補助用。
 * @param {bigint} numerator
 * @returns {number}
 */
export function volumeToNumber(numerator) {
  return Number(numerator) / Number(VOLUME_DENOMINATOR);
}

/**
 * その径級の刻み幅を返す。JAS: 14cm未満は1cm括り、14cm以上は2cm括り。
 * @param {number} diameterCm
 * @returns {number} 1 または 2
 */
export function diameterStep(diameterCm) {
  return diameterCm < DIAMETER_STEP_BOUNDARY ? 1 : 2;
}

/**
 * 任意の数値を有効な径級に丸める（▲▼ピッカー・音声入力の正規化用）。
 * @param {number} value
 * @returns {number}
 */
export function normalizeDiameter(value) {
  const v = Math.round(value);
  if (v < DIAMETER_STEP_BOUNDARY) return Math.max(1, v);
  return Math.round(v / 2) * 2;
}

/**
 * 径級を1段階上げる。
 * @param {number} diameterCm
 * @returns {number}
 */
export function nextDiameter(diameterCm) {
  const d = normalizeDiameter(diameterCm);
  return d < DIAMETER_STEP_BOUNDARY ? d + 1 : d + 2;
}

/**
 * 径級を1段階下げる。
 * @param {number} diameterCm
 * @returns {number}
 */
export function prevDiameter(diameterCm) {
  const d = normalizeDiameter(diameterCm);
  if (d <= 1) return 1;
  return d <= DIAMETER_STEP_BOUNDARY ? d - 1 : d - 2;
}

/**
 * 納入規格範囲から、実際に表示する径級の配列を作る。
 * 例: (6, 72) -> [6,7,8,9,10,11,12,13,14,16,...,72]（38要素）
 * @param {number} minCm 最小径級
 * @param {number} maxCm 最大径級
 * @returns {number[]}
 */
export function diameterRange(minCm, maxCm) {
  const min = normalizeDiameter(minCm);
  const max = normalizeDiameter(maxCm);
  const list = [];
  for (let d = min; d <= max; d = nextDiameter(d)) {
    list.push(d);
    if (list.length > 500) break; // 暴走防止
  }
  return list;
}
