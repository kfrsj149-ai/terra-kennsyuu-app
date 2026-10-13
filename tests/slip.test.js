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
const tr = (key) => ja[key] ?? key;

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
  assert.ok(existsSync(new URL('../src/js/slip.js', import.meta.url)));
  assert.ok(existsSync(new URL('../src/css/slip.css', import.meta.url)));
  // キャッシュ名は sw.js と config.js で一致している
  const cfg = readFileSync(new URL('../src/js/config.js', import.meta.url), 'utf8');
  const swVer = sw.match(/VERSION = '([^']+)'/)[1];
  assert.match(cfg, new RegExp(`cacheVersion: '${swVer}'`));
});

test('文言：手書き伝票で使うキーがすべての言語にそろっている', async () => {
  const keys = Object.keys(ja).filter((k) => k.startsWith('slip.'));
  assert.ok(keys.length >= 25);
  for (const code of ['vi', 'tl', 'th', 'ms']) {
    const dict = (await import(`../src/js/locales/${code}.js`)).default;
    for (const k of keys) assert.ok(dict[k], `${code} に ${k} が無い`);
  }
});
