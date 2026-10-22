import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { markRecent } from '../src/js/feedback.js';
import { CONFIG } from '../src/js/config.js';

/** DOMがない環境で、クラスの付け外しだけ確かめるための代用品 */
const fakeEl = () => {
  const set = new Set();
  return { classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) } };
};

test('押した直後は濃くなり、1.5秒たつと元に戻る', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const el = fakeEl();
  assert.equal(CONFIG.ui.recentMs, 1500);
  markRecent(el);
  assert.equal(el.classList.contains('is-recent'), true, '押した瞬間に濃くなる');
  t.mock.timers.tick(1499);
  assert.equal(el.classList.contains('is-recent'), true, '1.5秒の手前ではまだ濃い');
  t.mock.timers.tick(1);
  assert.equal(el.classList.contains('is-recent'), false, '1.5秒たつと戻る');
});

test('続けて押したときは、最後に押した時点から数え直す', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const el = fakeEl();
  markRecent(el);
  t.mock.timers.tick(1000);
  markRecent(el);                       // 1.0秒後にもう一度押す
  t.mock.timers.tick(1000);             // 最初の押下から2.0秒 ＝ 2回目から1.0秒
  assert.equal(el.classList.contains('is-recent'), true, '2回目の押下から1.5秒はまだ濃い');
  t.mock.timers.tick(500);
  assert.equal(el.classList.contains('is-recent'), false);
});

test('カードごとに独立している（別のカードの時間に影響しない）', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = fakeEl();
  const b = fakeEl();
  markRecent(a);
  t.mock.timers.tick(1000);
  markRecent(b);
  t.mock.timers.tick(500);
  assert.equal(a.classList.contains('is-recent'), false, 'aは1.5秒で戻る');
  assert.equal(b.classList.contains('is-recent'), true, 'bはまだ濃い');
});

test('要素がなくても落ちない／時間を指定できる', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.doesNotThrow(() => markRecent(null));
  const el = fakeEl();
  markRecent(el, 300);
  t.mock.timers.tick(300);
  assert.equal(el.classList.contains('is-recent'), false);
});

test('入れた径級が、色づいたままにならない（色は押した直後だけ）', () => {
  const css = readFileSync(new URL('../src/css/app.css', import.meta.url), 'utf8');
  const tokens = readFileSync(new URL('../src/css/tokens.css', import.meta.url), 'utf8');
  // 本数が入っているだけで背景色を変える規則が無い
  assert.doesNotMatch(css, /data-has-count='true'\]\s*\{[^}]*background/);
  // 押した直後の色は、クラスと配色トークンでつくる
  assert.match(css, /\.dia-card\.is-recent\s*\{[^}]*background:\s*var\(--c-tap-recent\)/);
  assert.match(tokens, /--c-tap-recent:\s*#[0-9a-f]{6}/i);
  // 入れていない径級は本数を薄くする（色以外の目印）
  assert.match(css, /data-has-count='false'\]\s*\.n\s*\{[^}]*opacity/);
});
