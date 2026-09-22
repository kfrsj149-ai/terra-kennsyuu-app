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

test('【最重要】12m材・径級6〜72cm各1本＝38本で合計92.112m³になる', () => {
  const ds = diameterRange(6, 72);
  assert.equal(ds.length, 38, '納入規格6〜72cmは38径級（14cm未満1cm刻み+14cm以上2cm刻み）');
  // 素材の日本農林規格どおり (D + (L'-4)/2)^2 * L / 10000 で計算した値。
  // 長野県の丸太材積表1578セルとの照合で裏づけ済み（tests/table.test.js）。
  assert.equal(formatVolume(totalOf(12, ds)), '92.112');
});

test('【回帰】径級補正(D-12)/2を加える誤った式に戻っていない', () => {
  // かつてCLAUDE.mdに書かれていた式。12m材38本で166.698m³となり、材積表と1314件が不一致になる。
  const wrong = diameterRange(6, 72).reduce((sum, d) => {
    const S = d >= 14 ? 300n * BigInt(d) + 1200n - 1600n : 200n * BigInt(d) + (1200n - 400n);
    return sum + S * S * 1200n;
  }, 0n);
  assert.equal(formatVolume(wrong), '166.698', '誤った式の再現値の確認');
  assert.notEqual(formatVolume(totalOf(12, diameterRange(6, 72))), '166.698');
});

test('長尺材(6m以上)は長さ補正のみで、径級による補正はしない', () => {
  // D=14, L=12 -> (14 + (12-4)/2)^2 * 12/10000 = 18^2 * 0.0012 = 0.3888
  assert.equal(formatVolume(volumeNumerator(12, 14)), '0.389');
  // D=72, L=12 -> 76^2 * 0.0012 = 6.9312
  assert.equal(formatVolume(volumeNumerator(12, 72)), '6.931');
  // D=6, L=12 -> 10^2 * 0.0012 = 0.12
  assert.equal(formatVolume(volumeNumerator(12, 6)), '0.120');
  // 径級が2倍になっても補正項は変わらない（長さだけで決まる）
  const c = (d) => Math.sqrt(Number(formatVolume(volumeNumerator(12, d))) / 12 * 10000) - d;
  assert.ok(Math.abs(c(20) - c(40)) < 0.01, '補正量は径級によらず一定');
});

test('短尺材(6m未満)は径級によらず補正なし V = D^2 * L / 10000', () => {
  assert.equal(formatVolume(volumeNumerator(3, 10)), '0.030'); // 100*3/10000
  assert.equal(formatVolume(volumeNumerator(5, 12)), '0.072'); // 144*5/10000
  assert.equal(formatVolume(volumeNumerator(3, 20)), '0.120'); // 400*3/10000（14cm以上でも補正なし）
  assert.equal(formatVolume(volumeNumerator(4, 20)), '0.160');
});

test('長さの端数は補正の計算では切り捨てる（L′＝長さの整数部）', () => {
  // 6.0m も 6.8m も補正は (6-4)/2 = 1cm。長さ本体には実寸を使う
  assert.equal(formatVolume(volumeNumerator(6, 20)), '0.265');     // 21^2 * 6 /10000 = 0.2646
  assert.equal(formatVolume(volumeNumerator('6.8', 20)), '0.300'); // 21^2 * 6.8/10000 = 0.29988
  // 7.0m になると補正が (7-4)/2 = 1.5cm に上がる
  assert.equal(formatVolume(volumeNumerator(7, 20)), '0.324');     // 21.5^2 * 7 /10000 = 0.32335
});

test('6.00m ちょうどから長尺式に切り替わる', () => {
  assert.equal(formatVolume(volumeNumerator(6, 20)), '0.265');
  assert.equal(formatVolume(volumeNumerator('5.99', 20)), '0.240'); // 短尺式 400*5.99/10000
});

test('端数処理は四捨五入（工場が引く丸太材積表に合わせている）', () => {
  assert.equal(formatVolume(volumeNumerator(12, 8)), '0.173');  // 0.1728 -> 0.173
  assert.equal(formatVolume(volumeNumerator(4, 14)), '0.078');  // 0.0784 -> 0.078
  assert.equal(formatVolume(volumeNumerator('6.8', 20)), '0.300'); // 0.29988 -> 0.300
});

test('単材積は4桁表示で「単材積×本数=小計」の手計算が合う', () => {
  assert.equal(formatVolume(volumeNumerator(4, 14), 4), '0.0784');
  assert.equal(formatVolume(volumeNumerator(4, 14)), '0.078');
  for (const d of diameterRange(6, 72)) {
    for (const n of [1, 7, 27, 53, 100]) {
      const perLog4 = formatVolume(volumeNumerator(4, d), 4);
      const subtotal = formatVolume(volumeNumerator(4, d) * BigInt(n));
      const handCalc = Math.round(Number(perLog4) * n * 1000) / 1000;
      assert.equal(handCalc.toFixed(3), subtotal, `D=${d} n=${n}`);
    }
  }
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

test('大量本数でも誤差が蓄積しない', () => {
  let sum = 0n;
  for (let i = 0; i < 10000; i++) sum += volumeNumerator(12, 8);
  assert.equal(formatVolume(sum), '1728.000'); // 0.1728 * 10000
});
