import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackNav } from '../src/js/backnav.js';

/** 履歴を持つだけの偽の window。go(-n) は、すぐに popstate を1回だけ出す（実際は少し遅れる） */
function fakeWin() {
  const entries = [{ state: null }];
  let i = 0;
  const listeners = [];
  const win = {
    history: {
      get state() { return entries[i].state; },
      pushState(state) { entries.splice(i + 1); entries.push({ state }); i += 1; },
      replaceState(state) { entries[i] = { state }; },
      go(d) { i = Math.max(0, i + d); listeners.forEach((f) => f()); },
    },
    addEventListener(type, f) { if (type === 'popstate') listeners.push(f); },
  };
  return { win, back: () => { if (i === 0) return false; win.history.go(-1); return true; }, index: () => i };
}

function setup() {
  const w = fakeWin();
  const open = [];
  let clock = 1000;
  const warns = [];
  const nav = createBackNav({
    win: w.win,
    getOpen: () => [...open],
    close: (k) => { const n = open.indexOf(k); if (n >= 0) open.splice(n, 1); nav.sync(); },
    onRootBack: () => warns.push(clock),
    now: () => clock,
  });
  nav.start();
  return { w, open, nav, warns, tick: (ms) => { clock += ms; } };
}

test('開いているものがあるとき、戻るで新しいほうから1つずつ閉じる', () => {
  const { w, open, nav, warns } = setup();
  open.push('drawer'); nav.sync();
  open.push('dlg-lot'); nav.sync();
  assert.equal(w.index(), 3);                 // 最初の1枚＋ガード＋2つ
  w.back();
  assert.deepEqual(open, ['drawer']);          // 新しい dlg-lot だけ閉じた
  w.back();
  assert.deepEqual(open, []);
  assert.equal(warns.length, 0);               // アプリの外へ出る話にはなっていない
  assert.equal(w.index(), 1);                  // ガードの上に戻った
});

test('ボタンで閉じたとき、履歴の枚数もそろう（あとで戻るを押しても余計に閉じない）', () => {
  const { w, open, nav, warns } = setup();
  open.push('dlg-start'); nav.sync();
  open.splice(0); nav.sync();                  // 「はい」などで閉じた
  assert.equal(w.index(), 1);
  assert.equal(warns.length, 0);
  w.back();                                    // この戻るは、何も開いていない状態での戻る
  assert.equal(warns.length, 1);
});

test('何も開いていないとき：1回目は知らせるだけ、2回目は外へ出られる', () => {
  const { w, nav, warns, tick } = setup();
  assert.equal(w.index(), 1);                  // ガードが積まれている
  w.back();
  assert.equal(warns.length, 1);               // 「もう一度戻ると閉じます」
  assert.equal(w.index(), 0);                  // ガードが外れ、最初の1枚だけ。次の戻るで本当に外へ出る
  assert.equal(w.back(), false);               // （ここから先は端末の動作）
  // 時間がたてば、ガードがまた積まれる
  tick(3000);
  nav.sync();
});

test('2回目を待たずに時間が過ぎたら、またガードが積まれて、1回目の扱いに戻る', async () => {
  const w = fakeWin();
  const warns = [];
  let clock = 0;
  const nav = createBackNav({
    win: w.win, getOpen: () => [], close() {}, onRootBack: () => warns.push(clock),
    now: () => clock, warnMs: 20,
  });
  nav.start();
  w.back();
  assert.equal(w.index(), 0);
  await new Promise((r) => setTimeout(r, 40));
  clock = 100;
  assert.equal(w.index(), 1);                  // ガードが戻っている
  w.back();
  assert.equal(warns.length, 2);
});

test('開いたまま再読み込みされても、おかしな戻り方をしない', () => {
  const w = fakeWin();
  w.win.history.pushState({ 'lognav-overlay': true }, '');
  const warns = [];
  const nav = createBackNav({ win: w.win, getOpen: () => [], close() {}, onRootBack: () => warns.push(1) });
  nav.start();
  assert.equal(w.index(), 1);                  // 新しい履歴を足さず、ガードとして使い直す
  w.back();
  assert.equal(warns.length, 1);
});
