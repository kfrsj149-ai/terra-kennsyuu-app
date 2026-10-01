import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayload } from '../src/js/office-sync.js';
import { newLot } from '../src/js/lots.js';
import { aggregateTicket, ticketTotals } from '../src/js/csv.js';

function lotWith(spec, pairs) {
  const lot = newLot(spec);
  for (const [d, n] of pairs) for (let i = 0; i < n; i++) lot.entries.push({ id: `${d}-${i}`, ts: i, d, source: 'tap', cancelled: false });
  return lot;
}

const base = { id: 'tk-0001', dateStr: '2026-10-05', ticketNo: '001', truck: '岩手100あ1', destination: '秋田プライウッド', ownCompany: '杉澤林業', note: 'メモ', outputAt: 123 };

test('事務所に送る形：径級ごとの本数と材積（整数）だけ。取消は含めない', () => {
  const lot = lotWith({ id: 'l1', species: 'カラマツ', lengthM: '4.00', minD: 14, maxD: 30, site: '本谷' }, [[20, 3], [22, 2]]);
  lot.entries[0].cancelled = true;                       // 20cm のうち1本を取消
  const p = buildPayload({ ...base, lots: [lot], activeLot: 0 });
  assert.equal(p.lots.length, 1);
  assert.deepEqual(p.lots[0].rows.map((r) => [r.d, r.n]), [[20, 2], [22, 2]]);
  for (const r of p.lots[0].rows) assert.match(r.volNum, /^\d+$/);
  assert.equal(p.truck, '岩手100あ1');
  assert.equal(p.destination, '秋田プライウッド');
  assert.ok(!('entries' in p.lots[0]));
});

test('事務所に送った合計は、現場の画面の合計と一致する（内部の整数のまま足すため）', () => {
  const l1 = lotWith({ id: 'l1', species: 'カラマツ', lengthM: '4.00', minD: 14, maxD: 30 }, [[20, 3], [22, 2]]);
  const l2 = lotWith({ id: 'l2', species: 'スギ', lengthM: '2.00', minD: 14, maxD: 30 }, [[16, 7]]);
  const ticket = { ...base, lots: [l1, l2], activeLot: 0 };
  const p = buildPayload(ticket);
  const sum = p.lots.flatMap((l) => l.rows).reduce((a, r) => a + BigInt(r.volNum), 0n);
  assert.equal(sum, ticketTotals(ticket).volume);
  assert.equal(sum, aggregateTicket(ticket).totalVolume);
});

test('入力のないロットは送らない／旧形式の伝票も送れる', () => {
  const empty = lotWith({ id: 'l0', species: 'ヒノキ', lengthM: '4.00', minD: 14, maxD: 30 }, []);
  const full = lotWith({ id: 'l1', species: 'スギ', lengthM: '4.00', minD: 14, maxD: 30 }, [[20, 1]]);
  assert.equal(buildPayload({ ...base, lots: [empty, full], activeLot: 1 }).lots.length, 1);

  const legacy = { ...base, species: 'スギ', lengthM: '4.00', minD: 14, maxD: 30, site: '本谷',
    entries: [{ id: 'a', ts: 1, d: 20, source: 'tap', cancelled: false }] };
  const p = buildPayload(legacy);
  assert.equal(p.lots[0].species, 'スギ');
  assert.equal(p.lots[0].site, '本谷');
  assert.equal(p.lots[0].rows[0].n, 1);
});

test('現場IDは、記録に入っていればそれを、無ければ台帳から名前（別名）で引く。引けなければ null', () => {
  const sites = [{ id: 'AAAAAAAA', name: '本谷', aliases: ['ホンダニ'] }];
  const spec = (site, siteId) => ({ id: 'l', species: 'スギ', lengthM: '4.00', minD: 14, maxD: 30, site, siteId });
  const make = (lot) => buildPayload({ ...base, lots: [lot], activeLot: 0 }, sites).lots[0].siteId;
  assert.equal(make(lotWith(spec('ホンダニ', null), [[20, 1]])), 'AAAAAAAA');
  assert.equal(make(lotWith(spec('本 谷', null), [[20, 1]])), 'AAAAAAAA');
  assert.equal(make(lotWith(spec('裏山', null), [[20, 1]])), null);
  assert.equal(make(lotWith(spec('裏山', 'BBBBBBBB'), [[20, 1]])), 'BBBBBBBB');
  assert.equal(make(lotWith(spec('', null), [[20, 1]])), null);
});
