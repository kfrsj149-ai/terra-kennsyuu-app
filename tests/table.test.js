import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { volumeNumerator, VOLUME_DENOMINATOR } from '../src/js/jas.js';

/**
 * 公的な材積表との突き合わせ（このアプリの正確性を担保する最重要テスト）
 * 出典: 長野県「林業積算基準 3-4 丸太材積表」(3-4_3.pdf) をPDFから機械的に抽出したもの。
 * 表の値は小数第3位で四捨五入されているため、切り捨て前の厳密値を四捨五入して比較する。
 * こうすることで、アプリ側の端数処理方針（ROUNDING_MODE）を変えてもこのテストは
 * 「計算式そのものが正しいか」だけを検証し続ける。
 */
const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/nagano-volume-table.json', import.meta.url)), 'utf8'));

/** 厳密値を小数第3位で四捨五入した文字列にする */
function roundHalfUp3(numerator) {
  const divisor = VOLUME_DENOMINATOR / 1000n;
  let milli = numerator / divisor;
  if ((numerator % divisor) * 2n >= divisor) milli += 1n;
  return `${milli / 1000n}.${String(milli % 1000n).padStart(3, '0')}`;
}

test('長野県の丸太材積表の全セルと一致する', () => {
  const mismatches = [];
  for (const [lengthM, diameterCm, expected] of fixture.cells) {
    const got = roundHalfUp3(volumeNumerator(lengthM, diameterCm));
    if (Number(got) !== expected) mismatches.push(`${lengthM}m×${diameterCm}cm 表=${expected} 計算=${got}`);
  }
  assert.deepEqual(mismatches, [], `材積表と一致しないセル ${mismatches.length} 件`);
});

test('材積表が十分な範囲を覆っている（テストが空振りしていないことの確認）', () => {
  const lengths = new Set(fixture.cells.map((c) => c[0]));
  const diameters = new Set(fixture.cells.map((c) => c[1]));
  assert.ok(fixture.cells.length >= 1500, `セル数 ${fixture.cells.length}`);
  assert.ok(lengths.has(4), '4m材を含むこと');
  assert.ok(lengths.has(6), '6m材（長尺式の境界）を含むこと');
  assert.ok(lengths.has(12), '12m材を含むこと');
  assert.ok(diameters.has(20) && diameters.has(56), '細い材から大径材まで含むこと');
});

test('個別に確認済みの代表セル', () => {
  const cases = [[12, 20, '0.691'], [12, 30, '1.387'], [12, 40, '2.323'],
                 [6, 20, '0.265'], [8, 24, '0.541'], [3.2, 20, '0.128'], [4, 20, '0.160']];
  for (const [L, D, expected] of cases) {
    assert.equal(roundHalfUp3(volumeNumerator(L, D)), expected, `${L}m×${D}cm`);
  }
});
