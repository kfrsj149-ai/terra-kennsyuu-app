import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toHundredths, formatLength, volumeNumerator, formatVolume,
  diameterRange, diameterStep, normalizeDiameter, nextDiameter, prevDiameter,
} from '../src/js/jas.js';

/** 合計材積の分子を積み上げるヘルパー */
function totalOf(lengthM, diameters) {
  return diameters.reduce((sum, d) => sum + volumeNumerator(lengthM, d), 0n);
}

test('【最重要】12m材・径級6〜72cm各1本＝38本で合計166.698m³になる', () => {
  const ds = diameterRange(6, 72);
  assert.equal(ds.length, 38, '納入規格6〜72cmは38径級（14cm未満1cm刻み+14cm以上2cm刻み）');
  assert.equal(formatVolume(totalOf(12, ds)), '166.698');
});

test('【回帰】競合アプリのバグ値92.112m³には絶対にならない', () => {
  const ds = diameterRange(6, 72);
  const buggy = ds.reduce((sum, d) => {
    // 径級補正を欠落させた誤った式（Log Counter Plus の挙動）
    const S = 200n * BigInt(d) + (toHundredths(12) - 400n);
    return sum + S * S * toHundredths(12);
  }, 0n);
  assert.equal(formatVolume(buggy), '92.112', 'バグ再現値の妥当性確認');
  assert.notEqual(formatVolume(totalOf(12, ds)), '92.112');
});

test('長尺材(L>=6, D>=14)に径級補正が効いている', () => {
  // D=14, L=12 -> p = 4 + 1 = 5 -> (14+5)^2 * 12 / 10000 = 361*0.0012 = 0.4332
  assert.equal(formatVolume(volumeNumerator(12, 14)), '0.433');
  // D=72, L=12 -> p = 4 + 30 = 34 -> 106^2 * 0.0012 = 13.4832
  assert.equal(formatVolume(volumeNumerator(12, 72)), '13.483');
});

test('長尺材でも径級14cm未満には径級補正を掛けない', () => {
  // D=6, L=12 -> (6+4)^2 * 0.0012 = 0.12
  assert.equal(formatVolume(volumeNumerator(12, 6)), '0.120');
  // D=13, L=12 -> (13+4)^2 * 0.0012 = 0.3468
  assert.equal(formatVolume(volumeNumerator(12, 13)), '0.346');
});

test('短尺材(L<6, D<14)は補正なし V = D^2 * L / 10000', () => {
  // D=10, L=3 -> 100 * 3 / 10000 = 0.03
  assert.equal(formatVolume(volumeNumerator(3, 10)), '0.030');
  // D=12, L=5 -> 144 * 5 / 10000 = 0.072
  assert.equal(formatVolume(volumeNumerator(5, 12)), '0.072');
});

test('短尺材(L<6, D>=14)は長さ補正のみ', () => {
  // D=20, L=3 -> (20 + (3-4)/2)^2 * 3 /10000 = 19.5^2 * 0.0003 = 0.114075
  assert.equal(formatVolume(volumeNumerator(3, 20)), '0.114');
  // L=4 は補正 0 なので D^2*L/10000 と一致する -> 20^2*4/10000 = 0.16
  assert.equal(formatVolume(volumeNumerator(4, 20)), '0.160');
});

test('L=4.00m では両式が一致する（補正項がゼロ）', () => {
  for (const d of diameterRange(6, 40)) {
    // D^2 * L / 10000 を分子表現に換算: S=200D, Li=400 -> (200D)^2 * 400 = 16,000,000 * D^2
    const plain = 16_000_000n * BigInt(d) * BigInt(d);
    assert.equal(volumeNumerator(4, d), plain, `D=${d}`);
  }
});

test('切り捨て（四捨五入ではない）', () => {
  // 0.1728 -> 0.172 （四捨五入なら 0.173）
  assert.equal(formatVolume(volumeNumerator(12, 8)), '0.172');
  // 0.5808 -> 0.580
  assert.equal(formatVolume(volumeNumerator(12, 16)), '0.580');
});

test('小数2桁の規格長さを誤差なく扱える', () => {
  assert.equal(toHundredths('2.15'), 215n);
  assert.equal(toHundredths('2'), 200n);
  assert.equal(toHundredths(6.05), 605n);
  assert.equal(formatLength(215n), '2.15');
  assert.equal(formatLength(200n), '2');
  assert.equal(formatLength(250n), '2.5');
  assert.throws(() => toHundredths('2.155'));
  assert.throws(() => toHundredths('abc'));
});

test('6.00m ちょうどは長尺式で計算される', () => {
  // D=20, L=6 -> p = 1 + 4 = 5 -> 25^2 * 6 / 10000 = 0.375
  assert.equal(formatVolume(volumeNumerator(6, 20)), '0.375');
  // D=20, L=5.99 -> 短尺式 (20 + 0.995)^2 * 5.99 /10000 = 0.264033...
  assert.equal(formatVolume(volumeNumerator('5.99', 20)), '0.264');
});

test('径級の刻みと丸め', () => {
  assert.equal(diameterStep(13), 1);
  assert.equal(diameterStep(14), 2);
  assert.equal(nextDiameter(13), 14);
  assert.equal(prevDiameter(14), 13);
  assert.equal(nextDiameter(14), 16);
  assert.equal(normalizeDiameter(15), 16);
  assert.equal(normalizeDiameter(13.4), 13);
  assert.deepEqual(diameterRange(12, 18), [12, 13, 14, 16, 18]);
  assert.deepEqual(diameterRange(20, 20), [20]);
});

test('単材積は4桁表示で「単材積×本数=小計」の手計算が合う', () => {
  // 14cm/4m: 0.0784 -> 3桁だと0.078になり 0.078*27=2.106 で小計2.116と食い違う
  assert.equal(formatVolume(volumeNumerator(4, 14), 4), '0.0784');
  assert.equal(formatVolume(volumeNumerator(4, 14)), '0.078');
  for (const d of diameterRange(6, 72)) {
    for (const n of [1, 7, 27, 53, 100]) {
      const perLog4 = formatVolume(volumeNumerator(4, d), 4);
      const subtotal = formatVolume(volumeNumerator(4, d) * BigInt(n));
      const handCalc = Math.floor(Number(perLog4) * n * 1000 + 1e-6) / 1000;
      assert.equal(handCalc.toFixed(3), subtotal, `D=${d} n=${n}`);
    }
  }
});

test('大量本数でも誤差が蓄積しない', () => {
  // 0.1728m³ の丸太を10000本 -> ちょうど 1728.000m³
  let sum = 0n;
  for (let i = 0; i < 10000; i++) sum += volumeNumerator(12, 8);
  assert.equal(formatVolume(sum), '1728.000');
});
