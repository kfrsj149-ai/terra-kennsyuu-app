/**
 * 車番の「使用中／休み」と契約台数のテスト
 * 確かめたいのは「契約台数まで数えるのは使用中の車番だけ」「登録は止めない」
 * 「契約台数が分からないときは制限しない」「入れ替えで6台目の契約が要らない」こと。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isResting, activeOf, seatsOf, hasRoom, registerAsResting, planActivate } from '../src/js/fleet.js';
import * as db from '../src/js/db.js';
import ja from '../src/js/locales/ja.js';

const truck = (name, resting = false) => ({ id: `truck:${name}`, kind: 'truck', value: name, ...(resting ? { resting: true } : {}) });
// 運転手5人でトラック6台（1台は予備）
const fleet = [truck('100'), truck('200'), truck('300'), truck('400'), truck('500'), truck('600', true)];

test('数えるのは使用中だけ。resting が無い古い登録は使用中として扱う', () => {
  assert.equal(isResting(truck('1')), false);
  assert.equal(isResting(truck('1', true)), true);
  assert.equal(isResting(undefined), false);
  assert.deepEqual(activeOf(fleet).map((o) => o.value), ['100', '200', '300', '400', '500']);
  assert.deepEqual(activeOf(undefined), []);
});

test('契約台数は正の整数だけ。それ以外（未取得・試用中）は null で、制限しない', () => {
  assert.equal(seatsOf(5), 5);
  assert.equal(seatsOf('5'), 5);
  for (const v of [null, undefined, 0, -1, 2.5, 'abc', '']) assert.equal(seatsOf(v), null, String(v));
  assert.equal(hasRoom(fleet, null), true);
  assert.equal(hasRoom(fleet, undefined), true);
});

test('5台契約で、予備車を入れて6台登録しても、使用中が5台なら満員（6台目の契約は要らない）', () => {
  assert.equal(fleet.length, 6);
  assert.equal(activeOf(fleet).length, 5);
  assert.equal(hasRoom(fleet, 5), false);
  assert.equal(hasRoom(fleet, 6), true);
});

test('登録は止めない：満員なら「休み」で登録し、空きがあれば使用中で登録する', () => {
  assert.equal(registerAsResting(fleet, 5), true);
  assert.equal(registerAsResting(fleet.slice(0, 3), 5), false);
  assert.equal(registerAsResting(fleet, null), false);
});

test('休みの車を使うとき：空きがあればそのまま、満員なら休ませる車の候補（使用中の車）を出す', () => {
  const rest = 'truck:600';
  assert.deepEqual(planActivate(fleet, rest, 6), { kind: 'activate' });
  assert.deepEqual(planActivate(fleet, rest, null), { kind: 'activate' });
  const full = planActivate(fleet, rest, 5);
  assert.equal(full.kind, 'swap');
  assert.deepEqual(full.candidates.map((o) => o.value), ['100', '200', '300', '400', '500']);
  // 使用中の車、存在しない車は何もしない
  assert.deepEqual(planActivate(fleet, 'truck:100', 5), { kind: 'noop' });
  assert.deepEqual(planActivate(fleet, 'truck:999', 5), { kind: 'noop' });
});

test('入れ替えても、使用中の台数は契約台数のまま', () => {
  const swapped = fleet.map((o) => (o.id === 'truck:300' ? { ...o, resting: true } : o.id === 'truck:600' ? { ...o, resting: false } : o));
  assert.equal(activeOf(swapped).length, 5);
  assert.equal(hasRoom(swapped, 5), false);
});

test('契約台数より多く使用中になっている端末（契約が減った・古い登録）でも、データは消さず、増やす操作だけ止める', () => {
  const many = [truck('1'), truck('2'), truck('3'), truck('4', true)];
  assert.equal(activeOf(many).length, 3);
  assert.equal(hasRoom(many, 2), false);          // 3台使用中・契約2台：増やせない
  assert.equal(planActivate(many, 'truck:4', 2).kind, 'swap');
  assert.equal(many.length, 4);                    // 何も消えていない
});

test('保存：休みの切り替えは、名前や他の登録を変えない', async () => {
  const kind = `truck-test-${Date.now()}`;
  const a = await db.addOption(kind, '1111');
  await db.addOption(kind, '2222', { resting: true });
  assert.equal(a.resting, undefined);
  assert.deepEqual((await db.listOptions(kind)).map((o) => [o.value, isResting(o)]), [['1111', false], ['2222', true]]);
  await db.setOptionResting(kind, `${kind}:2222`, false);
  await db.setOptionResting(kind, `${kind}:1111`, true);
  assert.deepEqual((await db.listOptions(kind)).map((o) => [o.value, isResting(o)]), [['1111', true], ['2222', false]]);
  assert.equal(await db.setOptionResting(kind, `${kind}:なし`, true), null);
  for (const o of await db.listOptions(kind)) await db.removeOption(o.id);
});

test('文言：車を入れ替える画面と車番の状態の文言が日本語にある', () => {
  for (const key of ['fleet.active', 'fleet.resting', 'fleet.swapTitle', 'fleet.swapBody', 'fleet.swapped', 'fleet.addedResting', 'fleet.limitNote']) {
    assert.ok(ja[key], key);
  }
  assert.match(ja['fleet.swapBody'], /\{name\}/);
  assert.match(ja['fleet.limitNote'], /\{seats\}.*\{active\}/);
});
