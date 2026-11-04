/**
 * 「戻る」（Androidの戻るスワイプ・ボタン、ブラウザの戻る）の受け止め。
 *
 * 手袋で画面の端をなぞると、戻るの操作になりやすい。何もしないと、計測の途中でアプリの外へ出てしまう。
 * （記録は端末に残るが、現場では「消えた」と感じる）
 *   ・ダイアログやメニューを開いているとき … 戻るで、それを閉じる（1つ前へ）
 *   ・何も開いていないとき … 1回目は「もう一度戻ると閉じます」と知らせるだけ。続けて2回目で、はじめて閉じる
 *
 * ブラウザの履歴に「いま何枚開いているか」を積んで実現する。画面の部品には触らないよう、
 * 開いているものの一覧と、閉じ方は呼び出し側から渡してもらう（テストしやすいように window も渡せる）。
 */

const GUARD = 'lognav-guard';
const OVERLAY = 'lognav-overlay';

/**
 * @param {object} deps
 * @param {Window} deps.win history と popstate を持つもの
 * @param {() => string[]} deps.getOpen いま開いているものの名前（開いた順でなくてよい。新しく開いたものを後ろに足す）
 * @param {(key: string) => void} deps.close 名前を渡されたものを閉じる
 * @param {() => void} deps.onRootBack 何も開いていないときの1回目の戻る（案内を出す）
 * @param {number} [deps.warnMs] 2回目の戻るを受け付ける時間
 * @param {() => number} [deps.now]
 */
export function createBackNav({ win, getOpen, close, onRootBack, warnMs = 2500, now = () => Date.now() }) {
  const history = win.history;
  let stack = [];
  let overlayDepth = 0;
  let ignore = 0;
  let guardPresent = false;
  let lastWarn = -Infinity;
  let timer = null;

  function ensureGuard() {
    if (guardPresent) return;
    history.pushState({ [GUARD]: true }, '');
    guardPresent = true;
  }

  /** 開いているものと履歴の枚数を合わせる */
  function sync() {
    const open = getOpen();
    const before = stack.length;
    stack = stack.filter((k) => open.includes(k));
    for (const k of open) if (!stack.includes(k)) stack.push(k);
    const depth = overlayDepth;
    if (stack.length > depth) {
      for (let i = depth; i < stack.length; i++) history.pushState({ [OVERLAY]: true }, '');
    } else if (stack.length < depth) {
      ignore += 1;
      history.go(-(depth - stack.length));
    }
    overlayDepth = stack.length;
    if (stack.length === 0 && before > 0) maybeGuard();
  }

  function maybeGuard() {
    if (now() - lastWarn > warnMs) ensureGuard();
  }

  function onPop() {
    if (ignore > 0) { ignore -= 1; return; }
    if (stack.length > 0) {
      // 開いているものを、新しいほうから1つ閉じる
      const top = stack.pop();
      overlayDepth = stack.length;
      close(top);
      return;
    }
    // 何も開いていない：ガードの履歴を1枚戻った状態
    guardPresent = false;
    if (now() - lastWarn <= warnMs) return; // 続けて2回目。そのまま外へ出る
    lastWarn = now();
    onRootBack();
    clearTimeout(timer);
    timer = setTimeout(() => { if (stack.length === 0) ensureGuard(); }, warnMs);
  }

  function start() {
    const s = history.state;
    if (s && s[OVERLAY]) {
      // 開いたまま再読み込みされた。開いているものは無いので、ガードとして使い直す
      history.replaceState({ [GUARD]: true }, '');
      guardPresent = true;
    } else if (s && s[GUARD]) {
      guardPresent = true;
    } else {
      ensureGuard();
    }
    win.addEventListener('popstate', onPop);
    sync();
  }

  return { start, sync, _stack: () => stack.slice() };
}

/** 画面につなぐ。開閉の変化は MutationObserver で拾う（開く・閉じる処理には手を入れない） */
export function initBackNav({ doc = document, win = window, close, onRootBack }) {
  const OPEN_SELECTORS = [
    ...doc.querySelectorAll('dialog'),
  ];
  const drawer = doc.getElementById('drawer');
  const isOpen = (el) => (el.tagName === 'DIALOG' ? el.open : el.classList.contains('is-open'));
  const targets = drawer ? [...OPEN_SELECTORS, drawer] : OPEN_SELECTORS;
  const keyOf = (el) => el.id;

  const nav = createBackNav({
    win,
    getOpen: () => targets.filter(isOpen).map(keyOf),
    close: (key) => close(doc.getElementById(key)),
    onRootBack,
  });
  const observer = new MutationObserver(() => nav.sync());
  for (const el of targets) observer.observe(el, { attributes: true, attributeFilter: ['open', 'class'] });
  nav.start();
  return nav;
}
