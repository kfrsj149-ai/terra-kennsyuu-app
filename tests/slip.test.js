import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  slipRows, slipColumns, rowHeightMm, validateSlip, renderSlip,
  COUNT_DIGITS, SLIP_MAX_ROWS, SLIP_ONE_COLUMN_MAX,
} from '../src/js/slip.js';
import { diameterRange, volumeNumerator, formatVolume } from '../src/js/jas.js';
import ja from '../src/js/locales/ja.js';

/** DOMがない環境で描画の構造だけ確かめるための、ごく小さな代用品 */
function fakeDoc() {
  const make = (tag) => {
    const node = {
      tag, className: '', textContent: '', children: [], style: { props: {}, setProperty(k, v) { this.props[k] = v; } },
      appendChild(child) { this.children.push(child); return child; },
    };
    return node;
  };
  return { createElement: make };
}
const walk = (node, fn) => { fn(node); node.children.forEach((c) => walk(c, fn)); };
const find = (node, pred) => { const out = []; walk(node, (n) => { if (pred(n)) out.push(n); }); return out; };
const tr = (key, params = {}) => Object.entries(params).reduce((v, [k, x]) => v.replace(`{${k}}`, x), ja[key] ?? key);

test('径級の行は、径級の刻み（14cm未満は1cm、以上は2cm）どおりで、12m材6〜72cmは38段', () => {
  const rows = slipRows('12', 6, 72);
  assert.equal(rows.length, 38);
  assert.deepEqual(rows.map((r) => r.diameter), diameterRange(6, 72));
});

test('【最重要】単材積はJASの式どおりで、4桁で刷る（12m・20cm＝0.6912、3m・14cm＝0.0588）', () => {
  const byD = (rows, d) => rows.find((r) => r.diameter === d).unit;
  assert.equal(byD(slipRows('12', 14, 30), 20), '0.6912');
  assert.equal(byD(slipRows('3', 14, 30), 14), '0.0588');
  // 6m未満は径級補正なし、6m以上は長さ補正のみ。エンジンの値とぴったり一致する
  for (const L of ['2', '3.65', '4', '6', '12']) {
    for (const r of slipRows(L, 6, 40)) {
      assert.equal(r.unit, formatVolume(volumeNumerator(L, r.diameter), 4), `${L}m ${r.diameter}cm`);
    }
  }
});

test('手計算（単材積×本数）が、小計の目安として使える（100本でも誤差は0.005m³以内）', () => {
  // 単材積は4桁に丸めて刷るので、100本でも最大0.005m³のずれ。正式な値は取り込み後の再計算
  const row = slipRows('12', 20, 20)[0];
  const exact = volumeNumerator('12', 20) * 100n;
  const byHand = Number(row.unit) * 100;
  const exactNum = Number(exact) / 4e10;
  assert.ok(Math.abs(byHand - exactNum) <= 0.005);
});

test('22段までは1列、それを超えたら半分ずつの2列にする', () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => i);
  assert.equal(slipColumns(mk(SLIP_ONE_COLUMN_MAX)).length, 1);
  const two = slipColumns(mk(23));
  assert.equal(two.length, 2);
  assert.deepEqual(two.map((c) => c.length), [12, 11]);
  assert.equal(slipColumns(mk(38)).map((c) => c.length).join(), '19,19');
});

test('段が多いほど1段を低くして1枚に収め、少なくても10mmを超えない', () => {
  assert.equal(rowHeightMm(3), 10);
  assert.ok(rowHeightMm(19) < rowHeightMm(8));
  // 見出し1段＋22段で、表に使える高さ（188mm）を超えない
  assert.ok(rowHeightMm(22) * 23 <= 188 + 0.01);
  // 小さくなりすぎない（手書きできる高さを確保する）
  assert.ok(rowHeightMm(22) >= 8);
});

test('入力の検査：長さの誤り・範囲の逆転・段数の超過を止める', () => {
  assert.equal(validateSlip({ lengthRaw: 'abc', minD: 14, maxD: 30 }).error, 'slip.errLength');
  assert.equal(validateSlip({ lengthRaw: '0', minD: 14, maxD: 30 }).error, 'slip.errLength');
  assert.equal(validateSlip({ lengthRaw: '3.456', minD: 14, maxD: 30 }).error, 'slip.errLength');
  assert.equal(validateSlip({ lengthRaw: '3', minD: 30, maxD: 14 }).error, 'setup.needRange');
  const tooMany = validateSlip({ lengthRaw: '3', minD: 1, maxD: 120 });
  assert.equal(tooMany.error, 'slip.errRows');
  assert.equal(tooMany.errorParams.max, SLIP_MAX_ROWS);
  const ok = validateSlip({ lengthRaw: ' 3.65 ', minD: 14, maxD: 30 });
  assert.equal(ok.error, undefined);
  assert.equal(ok.lengthM, '3.65');
  assert.equal(ok.rows.length, 9);
  // 一般的な範囲（6〜72cmの38段）は1枚に収まる
  assert.equal(validateSlip({ lengthRaw: '12', minD: 6, maxD: 72 }).error, undefined);
});

test('描画：本数の枠は4桁、四隅の印は4つ、径級の行数は入力どおり', () => {
  const v = validateSlip({ lengthRaw: '12', minD: 6, maxD: 72 });
  const slip = renderSlip(fakeDoc(), { owner: '丸々林業', truck: '517', species: 'スギ', site: '', lengthM: v.lengthM, rows: v.rows }, tr);
  assert.equal(find(slip, (n) => n.className.startsWith('slip-mark ')).length, 4);
  const dataRows = find(slip, (n) => n.tag === 'tr' && n.children[0]?.className === 'slip-dia');
  assert.equal(dataRows.length, 38);
  // 各行の本数セルには、1桁ずつの枠が4つ
  for (const row of dataRows) {
    const comb = find(row, (n) => n.className.startsWith('slip-comb'))[0];
    assert.equal(comb.children.length, COUNT_DIGITS);
  }
  // 38段は2列になる
  assert.equal(find(slip, (n) => n.tag === 'table').length, 2);
  assert.match(slip.className, /slip-double/);
});

test('描画：荷主・車番・樹種・長さが刷られ、空欄は手書き用に空のまま残る', () => {
  const v = validateSlip({ lengthRaw: '4', minD: 14, maxD: 24 });
  const slip = renderSlip(fakeDoc(), { owner: '丸々林業', truck: '517', species: '', site: '', lengthM: v.lengthM, rows: v.rows }, tr);
  const values = find(slip, (n) => n.className === 'slip-value').map((n) => n.textContent);
  assert.ok(values.includes('丸々林業'));
  assert.ok(values.includes('517'));
  assert.ok(values.includes('4 m'));
  assert.ok(values.includes(''), '樹種・現場が空欄なら手書き欄になる');
  assert.match(find(slip, (n) => n.className === 'slip-title')[0].textContent, /出荷伝票/);
  // 11径級（14〜24cm）は1列
  assert.match(slip.className, /slip-single/);
  assert.equal(find(slip, (n) => n.tag === 'table').length, 1);
});

test('描画：会社名などの入力は、HTMLとしてではなく文字として入る（textContent）', () => {
  const v = validateSlip({ lengthRaw: '3', minD: 14, maxD: 16 });
  const evil = '<img src=x onerror=alert(1)>';
  const slip = renderSlip(fakeDoc(), { owner: evil, truck: '', species: '', site: '', lengthM: v.lengthM, rows: v.rows }, tr);
  const node = find(slip, (n) => n.className === 'slip-value' && n.textContent === evil);
  assert.equal(node.length, 1);
  // fakeDoc には innerHTML が無い。使っていれば未定義のプロパティに入って検出される
  walk(slip, (n) => assert.equal(n.innerHTML, undefined));
});

test('合計欄：合計本数は5桁の枠、合計材積と備考がある', () => {
  const v = validateSlip({ lengthRaw: '3', minD: 14, maxD: 16 });
  const slip = renderSlip(fakeDoc(), { lengthM: v.lengthM, rows: v.rows }, tr);
  const total = find(slip, (n) => n.className.includes('slip-comb-total'))[0];
  assert.equal(total.children.length, 5);
  assert.equal(find(slip, (n) => n.className === 'slip-vol-box').length, 1);
  assert.equal(find(slip, (n) => n.className === 'slip-memo').length, 1);
  assert.match(find(slip, (n) => n.className === 'slip-note')[0].textContent, /手計算の目安/);
});

test('印刷に必要なファイルが、オフラインで読めるようServiceWorkerの一覧に入っている', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /\.\/src\/js\/slip\.js/);
  assert.match(sw, /\.\/src\/css\/slip\.css/);
  assert.match(sw, /\.\/src\/js\/quick\.js/);
  assert.match(sw, /\.\/src\/js\/viewport\.js/);
  assert.match(sw, /\.\/src\/js\/fleet\.js/);
  assert.match(sw, /\.\/src\/js\/voice-parse\.js/);
  assert.match(sw, /\.\/src\/js\/lastsetup\.js/);
  assert.ok(existsSync(new URL('../src/js/slip.js', import.meta.url)));
  assert.ok(existsSync(new URL('../src/css/slip.css', import.meta.url)));
  // キャッシュ名は sw.js と config.js で一致している
  const cfg = readFileSync(new URL('../src/js/config.js', import.meta.url), 'utf8');
  const swVer = sw.match(/VERSION = '([^']+)'/)[1];
  assert.match(cfg, new RegExp(`cacheVersion: '${swVer}'`));
});

test('文言：手書き伝票で使うキーがすべての言語にそろっている', async () => {
  const keys = Object.keys(ja).filter((k) => k.startsWith('slip.'));
  assert.ok(keys.length >= 24);
  for (const code of ['vi', 'tl', 'th', 'ms']) {
    const dict = (await import(`../src/js/locales/${code}.js`)).default;
    for (const k of keys) assert.ok(dict[k], `${code} に ${k} が無い`);
  }
});

/* ---------------- 積んだ伝票を紙伝票の形で見る ---------------- */
import { ticketSlips } from '../src/js/slip.js';
import { buildCsv } from '../src/js/csv.js';

const COUNTS = { 18: 15, 20: 31, 22: 30, 24: 16, 26: 14, 28: 10, 30: 3, 32: 3 };
const lotOfCounts = (counts, extra = {}) => ({
  id: 'l', species: 'カラマツ', lengthM: '2.00', minD: 18, maxD: 56, site: 'テスト1', siteId: null,
  entries: Object.entries(counts).flatMap(([d, n]) => Array.from({ length: n }, (_, i) => ({ id: `${d}-${i}`, ts: 1, d: Number(d), source: 'tap', cancelled: false }))),
  ...extra,
});
const ticketOf = (...lots) => ({ id: 't', dateStr: '2026-10-22', ticketNo: '002', truck: '21', ownCompany: '丸々林業', note: '', lots, activeLot: 0 });

test('紙伝票の形：本数・小計・合計が、実際に出力するCSVと同じ数字になる', () => {
  const ticket = ticketOf(lotOfCounts(COUNTS));
  const [slip] = ticketSlips(ticket);
  assert.equal(slip.totalCount, '122');
  assert.equal(slip.totalVolume, '12.814');
  assert.equal(slip.lengthM, '2');
  assert.equal(slip.owner, '丸々林業');
  assert.equal(slip.truck, '21');
  assert.equal(slip.dateStr, '2026-10-22');
  const row = (d) => slip.rows.find((r) => r.diameter === d);
  assert.equal(row(20).count, 31);
  assert.equal(row(20).subtotal, '2.480');
  assert.equal(row(20).unit, '0.0800');
  assert.equal(row(32).subtotal, '0.614');
  // 入れていない径級（範囲の中）は、本数0・小計は空欄のまま残る
  assert.equal(row(34).count, 0);
  assert.equal(row(34).subtotal, '');
  // CSVの小計と、1行ずつ一致する
  const csv = buildCsv(ticket).trim().split('\r\n').slice(1).map((l) => l.split(','));
  for (const c of csv) {
    const d = Number(c[7]);
    assert.equal(String(row(d).count), c[8], `${d}cm 本数`);
    assert.equal(row(d).subtotal, c[9], `${d}cm 小計`);
  }
});

test('紙伝票の形：取消した入力は含まない', () => {
  const lot = lotOfCounts({ 20: 5 });
  lot.entries[0].cancelled = true;
  lot.entries[1].cancelled = true;
  const [slip] = ticketSlips(ticketOf(lot));
  assert.equal(slip.rows.find((r) => r.diameter === 20).count, 3);
  assert.equal(slip.totalCount, '3');
});

test('紙伝票の形：材が複数なら1材1枚、本数のない材は出さない', () => {
  const a = lotOfCounts({ 20: 4 });
  const b = lotOfCounts({ 24: 2 }, { id: 'b', species: 'スギ', lengthM: '4.00', site: '向かいの沢' });
  const empty = lotOfCounts({}, { id: 'c', species: 'ヒノキ', lengthM: '3.00' });
  const slips = ticketSlips(ticketOf(a, b, empty));
  assert.equal(slips.length, 2);
  assert.deepEqual(slips.map((s) => [s.species, s.lengthM, s.site]), [['カラマツ', '2', 'テスト1'], ['スギ', '4', '向かいの沢']]);
  assert.equal(ticketSlips(ticketOf(empty)).length, 0);
});

test('紙伝票の形：範囲外の入力が混じっても落ちない／範囲が広すぎるときは入力のある径級だけにする', () => {
  const out = lotOfCounts({ 16: 2, 20: 3 }, { minD: 18, maxD: 30 });   // 16cm は範囲の外
  const [slip] = ticketSlips(ticketOf(out));
  assert.ok(slip.rows.some((r) => r.diameter === 16 && r.count === 2));
  assert.deepEqual(slip.rows.map((r) => r.diameter), [...slip.rows.map((r) => r.diameter)].sort((x, y) => x - y));
  const wide = lotOfCounts({ 20: 3, 90: 1 }, { minD: 4, maxD: 120 });
  const [w] = ticketSlips(ticketOf(wide));
  assert.ok(w.rows.length <= SLIP_MAX_ROWS);
  assert.deepEqual(w.rows.map((r) => r.diameter), [20, 90]);
});

test('描画：本数は右寄せで1桁ずつ枠に入り、合計・日付・小計も入る', () => {
  const [data] = ticketSlips(ticketOf(lotOfCounts(COUNTS)));
  const slip = renderSlip(fakeDoc(), data, tr);
  const rows = find(slip, (n) => n.tag === 'tr' && n.children[0]?.className === 'slip-dia');
  const row20 = rows.find((r) => r.children[0].textContent === '20');
  const digits = find(row20, (n) => n.tag === 'i').map((n) => n.textContent);
  assert.deepEqual(digits, ['', '', '3', '1'], '31本は、右の2つの枠に入る');
  assert.equal(find(row20, (n) => n.className === 'slip-sub')[0].textContent, '2.480');
  assert.match(row20.className, /slip-filled/);
  // 入れていない行は空欄で、色もつかない
  const row34 = rows.find((r) => r.children[0].textContent === '34');
  assert.deepEqual(find(row34, (n) => n.tag === 'i').map((n) => n.textContent), ['', '', '', '']);
  assert.doesNotMatch(row34.className, /slip-filled/);
  // 合計
  const total = find(slip, (n) => n.className.includes('slip-comb-total'))[0];
  assert.deepEqual(total.children.map((n) => n.textContent), ['', '', '1', '2', '2']);
  assert.equal(find(slip, (n) => n.className === 'slip-vol-box')[0].textContent, '12.814');
  // 日付（日本語）
  assert.ok(find(slip, (n) => n.className === 'slip-value').some((n) => n.textContent === '2026年10月22日'));
});

test('描画：本数が枠（4桁）に入りきらないときは、数字を割らずにそのまま出す', () => {
  const lot = lotOfCounts({ 20: 1 });
  const [data] = ticketSlips(ticketOf(lot));
  data.rows.find((r) => r.diameter === 20).count = 12345;
  const slip = renderSlip(fakeDoc(), data, tr);
  const overflow = find(slip, (n) => n.className.includes('slip-comb-overflow'));
  assert.equal(overflow.length, 1);
  assert.equal(overflow[0].children[0].textContent, '12345');
});

test('空欄の用紙は、これまでどおり本数・小計が空欄のまま', () => {
  const v = validateSlip({ lengthRaw: '3', minD: 14, maxD: 16 });
  const slip = renderSlip(fakeDoc(), { lengthM: v.lengthM, rows: v.rows }, tr);
  assert.equal(find(slip, (n) => n.className.includes('slip-filled')).length, 0);
  assert.ok(find(slip, (n) => n.tag === 'i' && !n.className).every((n) => n.textContent === ''));
  assert.ok(find(slip, (n) => n.className === 'slip-value').some((n) => n.textContent === ja['slip.dateFmt']));
});

/* ---------------- 単材積4桁：どの画面も同じ数字になる ---------------- */
import { aggregate } from '../src/js/csv.js';

/** JASエンジンとは別に、整数だけで単材積を出す（4桁・第5位を四捨五入）。V=(D+p)²·L/10000、p=max(0,(L'-4)/2)（L≥6のとき） */
function independentUnit4(lengthStr, d) {
  const L = Number(lengthStr);
  const Lh = BigInt(Math.round(L * 100));
  const q = BigInt(L >= 6 ? Math.max(0, Math.floor(L) - 4) : 0);   // 2p
  const num = (2n * BigInt(d) + q) ** 2n * Lh;                       // (2(D+p))² · L·100
  const den = 4_000_000n;                                            // 4 · 10000 · 100
  const units = (num * 10000n * 2n + den) / (2n * den);              // 小数第5位を四捨五入
  return `${units / 10000n}.${String(units % 10000n).padStart(4, '0')}`;
}

test('単材積4桁：紙伝票・紙伝票の形（積んだ伝票）・出力確認の集計が、全組み合わせで別計算と一致する', () => {
  const lengths = ['1.9', '2', '2.1', '2.7', '3', '3.3', '3.65', '4', '4.3', '5', '5.99', '6', '6.5', '7', '8', '9', '10', '11', '12'];
  let checked = 0;
  for (const L of lengths) {
    const blank = slipRows(L, 6, 72);                                 // 空欄の用紙
    const lot = lotOfCounts(Object.fromEntries(diameterRange(6, 72).map((d) => [d, 1])), { lengthM: L, minD: 6, maxD: 72 });
    const filled = ticketSlips(ticketOf(lot))[0].rows;                // 積んだ伝票
    const agg = aggregate(lot).rows;                                  // 出力確認・CSVの集計
    assert.equal(blank.length, 38, L);
    assert.equal(agg.length, 38, L);
    for (const row of blank) {
      const want = independentUnit4(L, row.diameter);
      assert.equal(row.unit, want, `空欄の用紙 ${L}m ${row.diameter}cm`);
      assert.equal(filled.find((r) => r.diameter === row.diameter).unit, want, `積んだ伝票 ${L}m ${row.diameter}cm`);
      assert.equal(formatVolume(agg.find((r) => r.d === row.diameter).perLog, 4), want, `出力確認 ${L}m ${row.diameter}cm`);
      checked++;
    }
  }
  assert.equal(checked, lengths.length * 38);
});

test('単材積4桁の例：3.65m・18cm は 0.11826 → 0.1183（第5位を四捨五入）。2m・18cm は 0.0648', () => {
  assert.equal(independentUnit4('3.65', 18), '0.1183');
  assert.equal(slipRows('3.65', 18, 18)[0].unit, '0.1183');
  assert.equal(slipRows('2', 18, 18)[0].unit, '0.0648');
});
