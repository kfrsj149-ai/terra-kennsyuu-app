/**
 * 音声入力：続けて読み上げた径級を、全部取り出して入れる
 * 「18、22、22、24」と読み上げたら、4本を順番に入れる。範囲外は入れず、知らせる。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiameter, parseDiameters, matchDiameter, matchDiameters, bestReading, MAX_PER_UTTERANCE } from '../src/js/voice-parse.js';
import { diameterRange } from '../src/js/jas.js';
import ja from '../src/js/locales/ja.js';

const ALLOWED = diameterRange(18, 50);

test('1つだけ読み上げたときは、これまでどおり1つ取り出す', () => {
  assert.equal(parseDiameter('24'), 24);
  assert.equal(parseDiameter('24センチ'), 24);
  assert.equal(parseDiameter('２４'), 24);
  assert.equal(parseDiameter('二十四'), 24);
  assert.equal(parseDiameter('十八'), 18);
  assert.equal(parseDiameter(''), null);
  assert.equal(parseDiameter('こんにちは'), null);
});

test('続けて読み上げた数を、読み上げた順に全部取り出す', () => {
  assert.deepEqual(parseDiameters('18 22 22 24'), [18, 22, 22, 24]);
  assert.deepEqual(parseDiameters('18、22、22、24'), [18, 22, 22, 24]);
  assert.deepEqual(parseDiameters('18,22,22,24'), [18, 22, 22, 24]);
  assert.deepEqual(parseDiameters('十八 二十二 二十二 二十四'), [18, 22, 22, 24]);
  assert.deepEqual(parseDiameters('１８ ２２'), [18, 22]);
  assert.deepEqual(parseDiameters('18センチ 22センチ'), [18, 22]);
});

test('くっついて聞き取られた数字は、2桁ずつに分けられるときだけ分ける', () => {
  assert.deepEqual(parseDiameters('1822'), [18, 22]);
  assert.deepEqual(parseDiameters('182224'), [18, 22, 24]);
  // 3桁・5桁は、分け方が決められない。間違って入れないよう null（入れない）にする
  assert.deepEqual(parseDiameters('222'), [null]);
  assert.deepEqual(parseDiameters('18222'), [null]);
});

test('同じ径級が続いても、そのまま本数として数える（22が2本）', () => {
  const { hits, misses } = matchDiameters(parseDiameters('18 22 22 24'), ALLOWED);
  assert.deepEqual(hits, [18, 22, 22, 24]);
  assert.deepEqual(misses, []);
});

test('範囲外・読めなかった数は入れず、入れなかった数として返す（入れられる分は入れる）', () => {
  const { hits, misses } = matchDiameters([18, 60, 22, null, 6], ALLOWED);
  assert.deepEqual(hits, [18, 22]);
  assert.deepEqual(misses, [60, null, 6]);
  assert.equal(matchDiameter(null, ALLOWED), null);
  assert.equal(matchDiameter(20, []), null);
});

test('2cm刻みの径級は、読み上げた奇数を偶数に寄せる（19→20）', () => {
  assert.deepEqual(matchDiameters([19, 21], ALLOWED).hits, [20, 22]);
});

test('1回の読み上げで入れる数に上限がある（雑音で何十本も入らない）', () => {
  const many = Array.from({ length: MAX_PER_UTTERANCE + 5 }, () => 20);
  const { hits, misses } = matchDiameters(many, ALLOWED);
  assert.equal(hits.length, MAX_PER_UTTERANCE);
  assert.equal(misses.length, 5);
});

test('認識エンジンの候補が複数あるとき、いちばん多く入れられる候補を使う。同点なら先頭の候補', () => {
  // 先頭の候補は「1822」を2桁に分けて2本、2番目は「18 22 22」で3本
  const r = bestReading(['1822', '18 22 22', '18'], ALLOWED);
  assert.deepEqual(r.hits, [18, 22, 22]);
  assert.equal(r.raw, '18 22 22');
  // 同点なら先頭
  assert.equal(bestReading(['20', '22'], ALLOWED).raw, '20');
  // 1つも入れられなければ、hits は空
  assert.deepEqual(bestReading(['こんにちは', '60'], ALLOWED).hits, []);
  assert.deepEqual(bestReading([], ALLOWED), { raw: '', hits: [], misses: [] });
});

test('文言：入れた本数と入れなかった数を知らせる文言がある', () => {
  assert.match(ja['measure.voiceBatch'], /\{count\}.*\{list\}/);
  assert.match(ja['measure.voiceSkipped'], /\{count\}.*\{list\}.*\{skipped\}/);
});
