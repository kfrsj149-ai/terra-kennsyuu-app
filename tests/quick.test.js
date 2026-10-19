import test from 'node:test';
import assert from 'node:assert/strict';
import { recentValues, lengthChoices, speciesChoices, COMMON_LENGTHS } from '../src/js/quick.js';

const ticket = (...lots) => ({ lots });
const lot = (species, lengthM, site = '') => ({ species, lengthM, site });

test('直近に使った値は、新しい順に重複なしで取り出す', () => {
  const tickets = [ticket(lot('スギ', '4.00'), lot('ヒノキ', '3')), ticket(lot('スギ', '4')), ticket(lot('カラマツ', '6.00'))];
  assert.deepEqual(recentValues(tickets, 'species'), ['スギ', 'ヒノキ', 'カラマツ']);
  // "4.00" と "4" は同じ長さ。表示用の形（4）にそろえる
  assert.deepEqual(recentValues(tickets, 'lengthM'), ['4', '3', '6']);
});

test('空・読めない値・伝票なしでも落ちない', () => {
  assert.deepEqual(recentValues([], 'species'), []);
  assert.deepEqual(recentValues(undefined, 'lengthM'), []);
  assert.deepEqual(recentValues([ticket(lot('', 'abc'), lot('  ', '0'))], 'species'), []);
  assert.deepEqual(recentValues([ticket(lot('', 'abc'), lot('スギ', '0'))], 'lengthM'), []);
});

test('樹種の重複は、全角半角・空白・大小の違いを同一視する', () => {
  const tickets = [ticket(lot('スギ', '4'), lot(' スギ ', '4'), lot('ＳＵＧＩ', '4'), lot('sugi', '4'))];
  assert.deepEqual(recentValues(tickets, 'species'), ['スギ', 'ＳＵＧＩ']);
});

test('規格長さの候補：直近（最大4つ）が先で、残りをよく使う長さで埋め、重複しない', () => {
  const recent = ['3.65', '12', '4', '2.7', '9.9'];
  const out = lengthChoices(recent);
  assert.deepEqual(out.slice(0, 4), ['3.65', '12', '4', '2.7']);
  assert.equal(new Set(out).size, out.length);
  assert.ok(out.length <= 9);
  // 直近がなければ、よく使う長さがそのまま出る
  assert.deepEqual(lengthChoices([]), COMMON_LENGTHS);
  // 読めない値は無視する
  assert.deepEqual(lengthChoices(['abc', '', '3']).slice(0, 1), ['3']);
});

test('樹種の候補：直近 → マスターの順で、最大6つ、重複なし', () => {
  const out = speciesChoices(['スギ', 'ヒノキ'], ['ヒノキ', 'カラマツ', 'アカマツ', 'ケヤキ', 'ナラ', 'クリ']);
  assert.deepEqual(out, ['スギ', 'ヒノキ', 'カラマツ', 'アカマツ', 'ケヤキ', 'ナラ']);
  assert.deepEqual(speciesChoices([], []), []);
  assert.deepEqual(speciesChoices(undefined, ['スギ']), ['スギ']);
});
