/**
 * CSV生成と共有。カラム構成は CLAUDE.md 準拠（ヘッダーは選択言語で出力）。
 * 日付,伝票番号,納入規格(cm),規格長(m),径級(cm),本数,小計材積(m³),累計本数,累計材積(m³),メモ
 */
import { t } from './i18n.js';
import { formatVolume, formatLength, toHundredths, volumeNumerator, quantizeNumerator, diameterRange } from './jas.js';

/**
 * 合計材積の丸め方針。ここ1か所を変えれば画面もCSVも同時に切り替わる。
 *   'exact'       : 端数を保持したまま合計し、表示の瞬間だけ切り捨てる
 *                   （CLAUDE.mdのテストケース 12m材38本 = 166.698m³ に一致する）
 *   'perDiameter' : 径級ごとに切り捨ててから合計する
 *                   （材積表を使った手計算と1円単位まで一致するが、合計は 166.683m³ になる）
 */
export const VOLUME_ROUNDING = 'exact';

const applyRounding = (numerator) =>
  (VOLUME_ROUNDING === 'perDiameter' ? quantizeNumerator(numerator) : numerator);

const CSV_KEYS = [
  'csv.date', 'csv.ticketNo', 'csv.spec', 'csv.length', 'csv.diameter',
  'csv.count', 'csv.subtotal', 'csv.totalCount', 'csv.totalVolume', 'csv.memo',
];

/**
 * 伝票データから径級ごとの集計を作る（取消済みは除外）。
 * @param {object} ticket
 * @returns {{rows: Array, totalCount: number, totalVolume: bigint}}
 */
export function aggregate(ticket) {
  const counts = new Map();
  for (const e of ticket.entries) {
    if (e.cancelled) continue;
    counts.set(e.d, (counts.get(e.d) ?? 0) + 1);
  }
  const order = diameterRange(ticket.minD, ticket.maxD);
  // 範囲外の径級（設定変更前の入力など）が混じっていても落とさない
  for (const d of counts.keys()) if (!order.includes(d)) order.push(d);
  order.sort((a, b) => a - b);

  let runningCount = 0;
  let runningVolume = 0n;
  const rows = [];
  for (const d of order) {
    const n = counts.get(d) ?? 0;
    if (n === 0) continue;
    const perLog = volumeNumerator(ticket.lengthM, d);          // 1本あたりの材積（単材積）
    const subtotal = applyRounding(perLog * BigInt(n));
    runningCount += n;
    runningVolume += subtotal;
    rows.push({ d, count: n, perLog, subtotal, runningCount, runningVolume });
  }
  return { rows, totalCount: runningCount, totalVolume: runningVolume };
}

/**
 * 取消を除いた合計（画面のリアルタイム表示用）。
 * 出力確認画面・CSVと必ず同じ数字になるよう、径級ごとに集計してから丸め方針を適用する。
 */
export function totalsOf(entries, lengthM) {
  const counts = new Map();
  let count = 0;
  for (const e of entries) {
    if (e.cancelled) continue;
    count += 1;
    counts.set(e.d, (counts.get(e.d) ?? 0) + 1);
  }
  let volume = 0n;
  for (const [d, n] of counts) {
    volume += applyRounding(volumeNumerator(lengthM, d) * BigInt(n));
  }
  return { count, volume };
}

function escapeCell(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * 伝票をCSV文字列にする。
 * @param {object} ticket
 * @returns {string}
 */
export function buildCsv(ticket) {
  const { rows } = aggregate(ticket);
  const spec = `${ticket.minD}-${ticket.maxD}`;
  const length = formatLength(toHundredths(ticket.lengthM));
  const lines = [CSV_KEYS.map((k) => escapeCell(t(k))).join(',')];
  for (const r of rows) {
    lines.push([
      ticket.dateStr,
      ticket.ticketNo,
      spec,
      length,
      r.d,
      r.count,
      formatVolume(r.subtotal),
      r.runningCount,
      formatVolume(r.runningVolume),
      ticket.note ?? '',
    ].map(escapeCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/** Excelで文字化けしないよう UTF-8 BOM を付ける */
export function csvBlob(csv) {
  return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
}

export function csvFileName(ticket) {
  return `terra-${ticket.dateStr.replaceAll('-', '')}-${ticket.ticketNo}.csv`;
}

/**
 * Web Share API でOS標準の共有ダイアログを開く。
 * 非対応環境では <a download> によるファイル保存にフォールバックする。
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function shareCsv(ticket) {
  const csv = buildCsv(ticket);
  const blob = csvBlob(csv);
  const name = csvFileName(ticket);
  const file = new File([blob], name, { type: 'text/csv' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      // 共有に失敗したらダウンロードへ落とす
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
