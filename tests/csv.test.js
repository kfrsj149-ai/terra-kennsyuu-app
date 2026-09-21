import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, totalsOf, buildCsv, VOLUME_ROUNDING } from '../src/js/csv.js';
import { formatVolume } from '../src/js/jas.js';

function ticketOf(lengthM, pairs, extra = {}) {
  const entries = [];
  for (const [d, n] of pairs) {
    for (let i = 0; i < n; i++) entries.push({ id: `${d}-${i}`, ts: i, d, source: 'tap', cancelled: false });
  }
  return {
    dateStr: '2026-09-20', ticketNo: '001', species: 'スギ', lengthM,
    minD: 6, maxD: 72, note: '', entries, ...extra,
  };
}

test('画面の合計(totalsOf)と出力の合計(aggregate)が必ず一致する', () => {
  const t = ticketOf(4, [[14, 27], [16, 27], [18, 53], [22, 53], [30, 26]]);
  const agg = aggregate(t);
  const live = totalsOf(t.entries, t.lengthM);
  assert.equal(live.count, agg.totalCount);
  assert.equal(formatVolume(live.volume), formatVolume(agg.totalVolume));
});

test('取消した入力は本数にも材積にも入らない', () => {
  const t = ticketOf(4, [[20, 3]]);
  t.entries[0].cancelled = true;
  assert.equal(aggregate(t).totalCount, 2);
  assert.equal(formatVolume(aggregate(t).totalVolume), '0.320'); // 0.16 * 2
});

test('丸め方針ごとに合計が定義どおりになる', () => {
  // 12m材・径級6〜72cm各1本
  const pairs = [];
  for (let d = 6; d < 14; d++) pairs.push([d, 1]);
  for (let d = 14; d <= 72; d += 2) pairs.push([d, 1]);
  const total = formatVolume(aggregate(ticketOf(12, pairs)).totalVolume);
  if (VOLUME_ROUNDING === 'exact') {
    // 端数を保持して合計
    assert.equal(total, '92.112');
  } else {
    // 径級ごとに丸めてから合計（明細表の縦計と一致する）
    assert.equal(total, '92.097');
  }
});

test('perDiameter方針なら明細の小計を足した値が合計に一致する', () => {
  const t = ticketOf(4, [[14, 27], [16, 27], [18, 53], [22, 53], [30, 26]]);
  const { rows, totalVolume } = aggregate(t);
  const sumOfRows = rows.reduce((a, r) => a + r.subtotal, 0n);
  if (VOLUME_ROUNDING === 'perDiameter') {
    assert.equal(formatVolume(sumOfRows), formatVolume(totalVolume));
  } else {
    // exact方針では、表の小計を縦に足した値と合計がわずかにずれ得る（切り捨ての位置が違うため）
    assert.equal(sumOfRows, totalVolume);
  }
});

test('CSVのカラム構成が仕様どおり', () => {
  const csv = buildCsv(ticketOf(4, [[20, 2]]));
  const [header, row] = csv.trim().split('\r\n');
  assert.equal(header, '日付,伝票番号,納入規格(cm),規格長(m),径級(cm),本数,小計材積(m³),累計本数,累計材積(m³),メモ');
  assert.equal(row, '2026-09-20,001,6-72,4,20,2,0.320,2,0.320,');
});
