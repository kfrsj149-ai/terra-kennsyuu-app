import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appHeight, syncAppHeight, initViewport } from '../src/js/viewport.js';

const fakeRoot = () => {
  const props = {};
  return { props, style: { getPropertyValue: (k) => props[k] ?? '', setProperty: (k, v) => { props[k] = v; } } };
};
const fakeWin = (h) => {
  const listeners = {};
  const docListeners = {};
  const win = {
    innerHeight: h,
    listeners,
    timers: [],
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    setTimeout: (fn, ms) => { win.timers.push({ fn, ms }); },
    document: { visibilityState: 'visible', addEventListener: (type, fn) => { (docListeners[type] ??= []).push(fn); }, docListeners },
  };
  return win;
};

test('実際に見えている高さ（innerHeight）を整数で返し、測れないときは0', () => {
  assert.equal(appHeight({ innerHeight: 844.4 }), 844);
  assert.equal(appHeight({ innerHeight: 0 }), 0);
  assert.equal(appHeight({}), 0);
  assert.equal(appHeight(undefined), 0);
});

test('--app-h に入れる。測れなかったときは書き込まず、CSSの100dvhに任せる', () => {
  const root = fakeRoot();
  assert.equal(syncAppHeight({ innerHeight: 780 }, root), 780);
  assert.equal(root.props['--app-h'], '780px');
  syncAppHeight({ innerHeight: 0 }, root);
  assert.equal(root.props['--app-h'], '780px', '0のときは前の値のまま');
});

test('起動直後に高さが変わっても、測り直しのたびに追いつく', () => {
  const root = fakeRoot();
  const win = fakeWin(900);                 // 起動の直後：実際より大きい
  initViewport(win, root);
  assert.equal(root.props['--app-h'], '900px');
  win.innerHeight = 812;                    // 画面の寸法が落ち着いた
  for (const t of win.timers) t.fn();
  assert.equal(root.props['--app-h'], '812px');
  assert.deepEqual(win.timers.map((t) => t.ms), [0, 100, 300, 800, 1500]);
  // 回転・サイズ変更・画面への復帰でも測り直す
  win.innerHeight = 390;
  for (const type of ['resize', 'orientationchange', 'pageshow']) {
    assert.ok(win.listeners[type]?.length, `${type} を見張っている`);
  }
  win.listeners.resize[0]();
  assert.equal(root.props['--app-h'], '390px');
  win.innerHeight = 700;
  win.document.docListeners.visibilitychange[0]();
  assert.equal(root.props['--app-h'], '700px');
});

test('画面の高さを実測値で使う設定が、HTMLとCSSに入っている', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/css/app.css', import.meta.url), 'utf8');
  // 描画の前（head の中）で一度入れる
  assert.match(html.split('</head>')[0], /setProperty\('--app-h'/);
  // CSSは --app-h を使い、測れないときは 100dvh に戻る
  assert.match(css, /height:\s*var\(--app-h,\s*100dvh\)/);
  // 押した瞬間の暗転は filter ではなく内側の影（ちらつき対策）
  assert.doesNotMatch(css, /button\.is-pressed[^{]*\{[^}]*filter:/);
});
