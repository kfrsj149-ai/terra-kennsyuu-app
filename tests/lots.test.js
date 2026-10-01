import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newLot, normalizeTicket, sameLot, indexOfSameLot, lotLabel, activeCount, clampRangeToEntries,
} from '../src/js/lots.js';
import { aggregateTicket, ticketTotals, buildCsv, aggregate } from '../src/js/csv.js';
import { formatVolume } from '../src/js/jas.js';

function push(lot, d, n) {
  for (let i = 0; i < n; i++) lot.entries.push({ id: `${d}-${lot.entries.length}`, ts: i, d, source: 'tap', cancelled: false });
  return lot;
}

function legacy(extra = {}) {
  return {
    id: 'x1', dateStr: '2026-09-20', ticketNo: '001', truck: '車A', site: '本谷', destination: '工場',
    species: 'スギ', lengthM: '4.00', minD: 14, maxD: 30, note: '', syncState: 'pending',
    entries: [{ id: 'a', ts: 1, d: 20, source: 'tap', cancelled: false }, { id: 'b', ts: 2, d: 22, source: 'tap', cancelled: true }],
    ...extra,
  };
}

test('古い形の伝票は、1ロットの便として読める', () => {
  const n = normalizeTicket(legacy());
  assert.equal(n.lots.length, 1);
  assert.equal(n.activeLot, 0);
  const lot = n.lots[0];
  assert.equal(lot.species, 'スギ');
  assert.equal(lot.site, '本谷');
  assert.equal(lot.lengthM, '4.00');
  assert.equal(lot.entries.length, 2);
  // 伝票全体の項目は伝票に残り、ロットの項目は伝票直下から消える
  assert.equal(n.truck, '車A');
  assert.equal(n.species, undefined);
  assert.equal(n.entries, undefined);
});

test('normalizeTicket は何度通しても同じ（冪等）', () => {
  const once = normalizeTicket(legacy());
  assert.equal(normalizeTicket(once), once);
  assert.deepEqual(normalizeTicket(normalizeTicket(legacy())), once);
});

test('範囲外の activeLot は先頭に戻る', () => {
  const n = normalizeTicket(legacy());
  assert.equal(normalizeTicket({ ...n, activeLot: 5 }).activeLot, 0);
  assert.equal(normalizeTicket({ ...n, activeLot: -1 }).activeLot, 0);
});

test('同じ材の判定は 樹種・長さ・現場', () => {
  const a = newLot({ species: 'スギ', lengthM: '4.00', minD: 14, maxD: 30, site: '本谷' });
  assert.ok(sameLot(a, { species: ' スギ ', lengthM: '4', site: '本谷' }));
  assert.ok(!sameLot(a, { species: 'スギ', lengthM: '2.00', site: '本谷' }));
  assert.ok(!sameLot(a, { species: 'ヒノキ', lengthM: '4.00', site: '本谷' }));
  assert.ok(!sameLot(a, { species: 'スギ', lengthM: '4.00', site: '向かい沢' }));
  assert.equal(indexOfSameLot([a], { species: 'スギ', lengthM: '4', site: '本谷' }), 0);
  assert.equal(indexOfSameLot([a], { species: 'スギ', lengthM: '3', site: '本谷' }), -1);
});

test('タブ名は樹種と長さ。同じ樹種・長さが並ぶときだけ現場を付ける', () => {
  const a = newLot({ species: 'スギ', lengthM: '4.00', minD: 14, maxD: 30, site: '本谷' });
  const b = newLot({ species: 'スギ', lengthM: '2.00', minD: 14, maxD: 30, site: '本谷' });
  const c = newLot({ species: 'スギ', lengthM: '4.00', minD: 14, maxD: 30, site: '向かい沢' });
  assert.equal(lotLabel(a, [a, b]), 'スギ 4m');
  assert.equal(lotLabel(b, [a, b]), 'スギ 2m');
  assert.equal(lotLabel(a, [a, c]), '本谷 スギ 4m');
  assert.equal(lotLabel(c, [a, c]), '向かい沢 スギ 4m');
});

test('便の合計は、ロットごとの集計の合計と一致する', () => {
  const l1 = push(newLot({ id: 'l1', species: 'スギ', lengthM: '4.00', minD: 14, maxD: 30, site: '本谷' }), 20, 3);
  push(l1, 22, 2);
  const l2 = push(newLot({ id: 'l2', species: 'ヒノキ', lengthM: '2.00', minD: 14, maxD: 30 }), 16, 4);
  const ticket = { dateStr: '2026-09-20', ticketNo: '001', truck: '車A', note: '', lots: [l1, l2], activeLot: 1 };
  const agg = aggregateTicket(ticket);
  const live = ticketTotals(ticket);
  assert.equal(agg.totalCount, 9);
  assert.equal(live.count, 9);
  assert.equal(live.volume, agg.totalVolume);
  assert.equal(agg.totalVolume, aggregate(l1).totalVolume + aggregate(l2).totalVolume);
});

test('古い伝票でも便の集計・CSVが同じ結果になる', () => {
  const old = legacy();
  assert.equal(buildCsv(old), buildCsv(normalizeTicket(old)));
  const { totalCount, totalVolume } = aggregateTicket(old);
  assert.equal(totalCount, 1);
  assert.equal(formatVolume(totalVolume), '0.160');
});

test('複数ロットのCSV：ロットごとに行が続き、累計はロットごとに数え直す', () => {
  const l1 = push(newLot({ id: 'l1', species: 'スギ', lengthM: '4.00', minD: 14, maxD: 30, site: '本谷' }), 20, 2);
  push(l1, 22, 1);
  const l2 = push(newLot({ id: 'l2', species: 'ヒノキ', lengthM: '2.00', minD: 6, maxD: 20, site: '向かい沢' }), 16, 3);
  const ticket = { dateStr: '2026-09-20', ticketNo: '002', truck: '車A', note: 'メモ', lots: [l1, l2], activeLot: 0 };
  const lines = buildCsv(ticket).trim().split('\r\n');
  assert.equal(lines.length, 1 + 2 + 1);
  const cols = lines.slice(1).map((l) => l.split(','));
  // 1行目：スギ 20cm 2本
  assert.deepEqual(cols[0].slice(0, 5), ['2026-09-20', '002', '車A', '本谷', 'スギ']);
  assert.equal(cols[0][5], '14-30');
  assert.equal(cols[0][6], '4');
  assert.equal(cols[0][8], '2');
  assert.equal(cols[0][10], '2');
  // 2行目：スギ 22cm 1本。累計は3本
  assert.equal(cols[1][7], '22');
  assert.equal(cols[1][10], '3');
  // 3行目：ヒノキ。累計はそのロットだけで数え直す
  assert.deepEqual(cols[2].slice(0, 5), ['2026-09-20', '002', '車A', '向かい沢', 'ヒノキ']);
  assert.equal(cols[2][5], '6-20');
  assert.equal(cols[2][6], '2');
  assert.equal(cols[2][8], '3');
  assert.equal(cols[2][10], '3');
  assert.equal(cols[2][12], 'メモ');
});

test('取消だけのロットはCSVに行が出ない・本数にも入らない', () => {
  const l1 = push(newLot({ id: 'l1', species: 'スギ', lengthM: '4.00', minD: 14, maxD: 30 }), 20, 1);
  const l2 = push(newLot({ id: 'l2', species: 'ヒノキ', lengthM: '2.00', minD: 14, maxD: 30 }), 20, 2);
  l2.entries.forEach((e) => { e.cancelled = true; });
  const ticket = { dateStr: '2026-09-20', ticketNo: '001', truck: '車A', lots: [l1, l2], activeLot: 0 };
  assert.equal(buildCsv(ticket).trim().split('\r\n').length, 2);
  assert.equal(ticketTotals(ticket).count, 1);
  assert.equal(activeCount(l2), 0);
});

test('範囲を狭めても、入力のある径級は範囲に残る', () => {
  const lot = push(newLot({ species: 'スギ', lengthM: '4.00', minD: 14, maxD: 30 }), 28, 1);
  push(lot, 16, 1);
  assert.deepEqual(clampRangeToEntries(lot, 18, 24), { minD: 16, maxD: 28 });
  // 取消済みの入力は範囲を縛らない
  lot.entries.forEach((e) => { e.cancelled = true; });
  assert.deepEqual(clampRangeToEntries(lot, 18, 24), { minD: 18, maxD: 24 });
});
