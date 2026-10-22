/**
 * 手書き伝票テンプレート（印刷用の記入用紙）
 * ============================================================
 * 圏外・電池切れ・アプリを使えない運転手のために、径級ごとの単材積を刷り込んだ
 * 記入用紙を作る。本数・小計・合計は手書き。
 *
 * 【決まっていること（2026-10-03 神田さんと合意）】
 *  ・荷主・車番・規格長さ・径級の範囲を選ぶと用紙ができる。主要な長さは多めに刷って渡し、
 *    特殊な長さは必要なときに1枚ずつ刷る
 *  ・単材積は4桁で刷る（3桁だと「単材積×本数＝小計」が手計算で合わず、工場で揉めるため。jas.js 参照）
 *  ・本数は「1桁ずつの枠」×4桁（最大9999本）。郵便番号の欄のような形にして、
 *    将来、写真から自動で読み取るときの誤読を減らす
 *  ・紙の四隅に位置合わせの印（写真が斜めでも補正するため）
 *  ・小計と合計も手書き欄にする（読み取った本数×単材積と突き合わせて誤読を見つける）
 *  ・手計算は目安。正式な材積は、取り込み後にシステムが計算し直した値
 *
 * 【QRについて】
 * このファイルは「QRなし」の部分。QRはドメイン（q.terra-tx-jp.com）が決まってから足す。
 * 刷ったあとで住所を変えられないため。QRを足す位置は、用紙の右上（ヘッダー内）に空けてある。
 */
import { toHundredths, formatLength, volumeNumerator, formatVolume, diameterRange } from './jas.js';
import { aggregate } from './csv.js';
import { normalizeTicket } from './lots.js';

/** 本数の枠の数（最大9999本） */
export const COUNT_DIGITS = 4;
/** 合計本数の枠の数 */
export const TOTAL_DIGITS = 5;
/** 1列に並べる最大段数。これを超えると2列にする */
export const SLIP_ONE_COLUMN_MAX = 22;
/** 1枚に収まる最大段数（2列×22段）。6〜72cmの38段は余裕で入る */
export const SLIP_MAX_ROWS = SLIP_ONE_COLUMN_MAX * 2;

/** 表のために使える高さ（mm）。ヘッダー・フッターを除いた分 */
const TABLE_HEIGHT_MM = 188;
const ROW_HEIGHT_MAX_MM = 10;

/**
 * 用紙に刷る径級の行を作る。
 * @param {string|number} lengthM 規格長さ(m)
 * @param {number} minD 最小径級(cm)
 * @param {number} maxD 最大径級(cm)
 * @returns {{diameter:number, unit:string}[]} unit は単材積（m³、小数第4位まで）
 */
export function slipRows(lengthM, minD, maxD) {
  return diameterRange(minD, maxD).map((diameter) => ({
    diameter,
    unit: formatVolume(volumeNumerator(lengthM, diameter), 4),
  }));
}

/**
 * 行を列に分ける。22段までは1列、それを超えたら半分ずつの2列。
 * @param {unknown[]} rows
 * @returns {unknown[][]}
 */
export function slipColumns(rows) {
  if (rows.length <= SLIP_ONE_COLUMN_MAX) return [rows];
  const half = Math.ceil(rows.length / 2);
  return [rows.slice(0, half), rows.slice(half)];
}

/**
 * 1段の高さ（mm）。段数が多いほど低くして、1枚に収める。
 * @param {number} rowsPerColumn 1列あたりの段数
 * @returns {number}
 */
export function rowHeightMm(rowsPerColumn) {
  // 見出し行の分を1段足して割る
  const h = Math.floor((TABLE_HEIGHT_MM / (rowsPerColumn + 1)) * 10) / 10;
  return Math.min(ROW_HEIGHT_MAX_MM, h);
}

/**
 * 入力を検査して、印刷できる内容にする。エラーのときは error に i18n キーを返す。
 * @param {{lengthRaw:string, minD:number, maxD:number}} input
 * @returns {{error?:string, errorParams?:object, lengthM?:string, rows?:{diameter:number, unit:string}[]}}
 */
export function validateSlip({ lengthRaw, minD, maxD }) {
  let lengthM;
  try {
    lengthM = formatLength(toHundredths(String(lengthRaw ?? '').trim()));
  } catch {
    return { error: 'slip.errLength' };
  }
  if (Number(lengthM) <= 0) return { error: 'slip.errLength' };
  if (!(minD <= maxD)) return { error: 'setup.needRange' };
  const rows = slipRows(lengthM, minD, maxD);
  if (rows.length > SLIP_MAX_ROWS) {
    return { error: 'slip.errRows', errorParams: { max: SLIP_MAX_ROWS } };
  }
  return { lengthM, rows };
}

/* ------------------------------------------------------------------
 * 描画（DOM）。文字はすべて textContent で入れる（会社名などの入力をHTMLとして解釈しない）
 * ------------------------------------------------------------------ */

function el(doc, tag, cls, text) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * 本数の枠（1桁ずつ）。value があれば、右寄せで1桁ずつ枠に入れる（積んだ本数を書き写すための表示）。
 * 枠に入りきらない桁数のときは、数字を割らずに、枠のかわりにそのまま出す。
 */
function comb(doc, digits, cls = '', value = '') {
  const text = String(value ?? '');
  const over = text.length > digits;
  const wrap = el(doc, 'div', ['slip-comb', cls, over ? 'slip-comb-overflow' : ''].filter(Boolean).join(' '));
  if (over) {
    wrap.appendChild(el(doc, 'b', '', text));
    return wrap;
  }
  const pad = digits - text.length;
  for (let i = 0; i < digits; i++) wrap.appendChild(el(doc, 'i', '', i >= pad ? text[i - pad] : ''));
  return wrap;
}

/** 見出し＋記入欄の1項目 */
function field(doc, label, value, cls = '') {
  const box = el(doc, 'div', `slip-field ${cls}`.trim());
  box.appendChild(el(doc, 'span', 'slip-label', label));
  box.appendChild(el(doc, 'b', 'slip-value', value || ''));
  return box;
}

/**
 * 伝票1枚ぶんのDOMを作る。
 * @param {Document} doc
 * @param {{owner?:string, truck?:string, species?:string, site?:string, lengthM:string, rows:{diameter:number, unit:string}[]}} data
 * @param {(key:string, params?:object)=>string} tr 翻訳関数（i18n の t）
 * @returns {HTMLElement}
 */
export function renderSlip(doc, data, tr) {
  const columns = slipColumns(data.rows);
  const single = columns.length === 1;
  const slip = el(doc, 'div', `slip ${single ? 'slip-single' : 'slip-double'}`);
  slip.style.setProperty('--slip-row-h', `${rowHeightMm(columns[0].length)}mm`);

  // 四隅の位置合わせの印
  for (const pos of ['tl', 'tr', 'bl', 'br']) slip.appendChild(el(doc, 'i', `slip-mark slip-mark-${pos}`));

  // ヘッダー
  const head = el(doc, 'div', 'slip-head');
  head.appendChild(el(doc, 'div', 'slip-title', tr('slip.sheetTitle')));
  const meta = el(doc, 'div', 'slip-meta');
  meta.appendChild(field(doc, tr('slip.owner'), data.owner, 'slip-w2'));
  meta.appendChild(field(doc, tr('slip.truck'), data.truck));
  meta.appendChild(field(doc, tr('slip.sheetLength'), `${data.lengthM} m`));
  // 書き込み済みの伝票は日付も入れる（空欄の用紙は、年月日の欄だけ）
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data.dateStr ?? '');
  const dateText = m ? tr('slip.dateFilled', { y: m[1], m: String(Number(m[2])), d: String(Number(m[3])) }) : tr('slip.dateFmt');
  const date = field(doc, tr('slip.date'), dateText, 'slip-w4 slip-date');
  meta.appendChild(date);
  meta.appendChild(field(doc, tr('slip.site'), data.site, 'slip-w3'));
  meta.appendChild(field(doc, tr('slip.species'), data.species));
  head.appendChild(meta);
  // QRを足す場所（ドメインが決まったら使う）。いまは空けておくだけ
  head.appendChild(el(doc, 'div', 'slip-qr-slot'));
  slip.appendChild(head);

  // 径級の表（1列または2列）
  const cols = el(doc, 'div', 'slip-cols');
  for (const rows of columns) {
    const table = el(doc, 'table', 'slip-table');
    const thead = el(doc, 'thead');
    const hr = el(doc, 'tr');
    for (const key of ['slip.dia', 'slip.unit', 'slip.count', 'slip.sub']) hr.appendChild(el(doc, 'th', '', tr(key)));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el(doc, 'tbody');
    for (const row of rows) {
      const filled = Number(row.count) > 0;
      const r = el(doc, 'tr', filled ? 'slip-filled' : '');
      r.appendChild(el(doc, 'td', 'slip-dia', String(row.diameter)));
      r.appendChild(el(doc, 'td', 'slip-unit', row.unit));
      const countCell = el(doc, 'td', 'slip-count');
      countCell.appendChild(comb(doc, COUNT_DIGITS, '', filled ? String(row.count) : ''));
      r.appendChild(countCell);
      r.appendChild(el(doc, 'td', 'slip-sub', filled ? row.subtotal : ''));
      tbody.appendChild(r);
    }
    table.appendChild(tbody);
    cols.appendChild(table);
  }
  slip.appendChild(cols);

  // フッター（合計・備考・注意書き）
  const foot = el(doc, 'div', 'slip-foot');
  const totals = el(doc, 'div', 'slip-totals');
  const tc = el(doc, 'div', 'slip-total');
  tc.appendChild(el(doc, 'span', 'slip-label', tr('slip.totalCount')));
  tc.appendChild(comb(doc, TOTAL_DIGITS, 'slip-comb-total', data.totalCount ?? ''));
  tc.appendChild(el(doc, 'span', 'slip-unit-mark', tr('slip.countUnit')));
  totals.appendChild(tc);
  const tv = el(doc, 'div', 'slip-total');
  tv.appendChild(el(doc, 'span', 'slip-label', tr('slip.totalVol')));
  tv.appendChild(el(doc, 'div', 'slip-vol-box', data.totalVolume ?? ''));
  totals.appendChild(tv);
  foot.appendChild(totals);
  const memo = el(doc, 'div', 'slip-memo');
  memo.appendChild(el(doc, 'span', 'slip-label', tr('slip.memo')));
  foot.appendChild(memo);
  foot.appendChild(el(doc, 'p', 'slip-note', tr('slip.note')));
  slip.appendChild(foot);

  return slip;
}

/**
 * 積み込んだ伝票を、紙伝票の形（径級ごとの本数・小計・合計）にする。便に複数の材があれば、材ごとに1枚。
 * 本数が入っていない材は出さない。範囲が広すぎて1枚に収まらないときは、入力のある径級だけにする。
 * @param {object} ticket 保存済みの伝票または計測中の下書き（古い形でも可）
 * @returns {object[]} renderSlip に渡せる形（rows に count・subtotal が入る）
 */
export function ticketSlips(ticket) {
  const norm = normalizeTicket(ticket);
  const slips = [];
  for (const lot of norm.lots) {
    const agg = aggregate(lot);
    if (agg.totalCount === 0) continue;
    const byD = new Map(agg.rows.map((r) => [r.d, r]));
    let diameters = diameterRange(lot.minD, lot.maxD);
    for (const d of byD.keys()) if (!diameters.includes(d)) diameters.push(d);
    diameters.sort((a, b) => a - b);
    if (diameters.length > SLIP_MAX_ROWS) diameters = diameters.filter((d) => byD.has(d));
    slips.push({
      owner: norm.ownCompany ?? '',
      truck: norm.truck ?? '',
      species: lot.species,
      site: lot.site ?? '',
      dateStr: norm.dateStr,
      lengthM: formatLength(toHundredths(lot.lengthM)),
      rows: diameters.map((d) => {
        const r = byD.get(d);
        return {
          diameter: d,
          unit: formatVolume(volumeNumerator(lot.lengthM, d), 4),
          count: r ? r.count : 0,
          subtotal: r ? formatVolume(r.subtotal) : '',
        };
      }),
      totalCount: String(agg.totalCount),
      totalVolume: formatVolume(agg.totalVolume),
    });
  }
  return slips;
}
