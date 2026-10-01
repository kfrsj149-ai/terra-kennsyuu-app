/**
 * TERRA 検収PWA - 画面制御
 * 炎天下・手袋・重機騒音下で、説明文を読まずに使えることを最優先に設計している。
 */
import { CONFIG } from './config.js';
import {
  toHundredths, formatLength, formatVolume, volumeNumerator,
  diameterRange, nextDiameter, prevDiameter, normalizeDiameter,
} from './jas.js';
import { t, applyTranslations, setLocale, detectLocale, getLocale, LOCALES } from './i18n.js';
import * as db from './db.js';
import { aggregateTicket, ticketTotals, shareCsv } from './csv.js';
import { newLot, normalizeTicket, indexOfSameLot, lotLabel, activeCount, clampRangeToEntries } from './lots.js';
import { feedbackAdd, feedbackUndo, feedbackError, beep, vibrate, requestWakeLock, releaseWakeLock, initWakeLockAutoRenew } from './feedback.js';
import { VoiceInput, isVoiceSupported, isVoiceAvailable } from './voice.js';
import * as subscription from './subscription.js';
import * as backup from './backup.js';
import * as updater from './updater.js';
import * as officeSync from './office-sync.js';
import { nameKey, resolveSiteId, noticesFor, quotasFor, blocksUnloading } from './office-rules.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const LIST_KINDS = ['company', 'truck', 'site', 'destination'];
const LONG_PRESS_MS = 2000; // 誤操作対策：-1 は2秒長押し

/** アプリ全体の状態 */
const state = {
  screen: 'setup',
  settings: { locale: 'ja', side: 'left', voiceConsent: false },
  setup: { minD: 14, maxD: 30 },
  /** 計測中の伝票＝便（入力の都度 IndexedDB に保存される）。lots[] の中に材ごとの入力が入る */
  draft: null,
  /** いま入力している材（ロット）の径級一覧 */
  diameters: [],
  voice: null,
  /** 事務所から最後に受け取った 納入枠・お知らせ・現場の台帳（圏外では、これを使い続ける） */
  feed: null,
};

/* ==================================================================
 * 小物ユーティリティ
 * ================================================================== */
let toastTimer = null;
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-show'), ms);
}

function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 自由入力（樹種・現場名など）をHTMLに埋め込むときのエスケープ */
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showScreen(name) {
  state.screen = name;
  document.body.dataset.screen = name;
  $$('.screen').forEach((el) => el.classList.toggle('is-active', el.id === `screen-${name}`));
  if (name === 'measure') requestWakeLock();
  else releaseWakeLock();
  // 計測が終わって戻ってきたら、保留していたアプリ更新をここで反映する
  if (name !== 'measure' && updater.hasPending()) updater.applyPending();
  renderOfficeInfo();
}

/**
 * アプリの更新確認。
 * 計測中は絶対にリロードしない（入力中の画面が飛ぶため）。
 * その場合は「計測が終わったら反映します」と伝えるだけにして、
 * showScreen で計測画面を離れた瞬間に反映する。
 */
async function checkForUpdate() {
  const res = await updater.check({
    canReload: () => state.screen !== 'measure',
    onPending: (info) => toast(t('update.pending', { v: info.short }), 6000),
  });
  if (res?.pendingReload) renderVersion();
  return res;
}

/** メニューに、いま動いている版を表示する（山で反映を確認するため） */
async function renderVersion() {
  const el = $('#version-note');
  if (!el) return;
  const v = await updater.info();
  if (!v.short) { el.textContent = t('update.unknown'); return; }
  const parts = [`${t('update.version')}: ${v.short}`];
  if (v.message) parts.push(v.message);
  if (v.pending) parts.push(t('update.pending', { v: v.pending }));
  el.textContent = parts.join(' / ');
}

/* ==================================================================
 * 設定の読み書き
 * ================================================================== */
async function loadSettings() {
  const saved = await db.kvGet('settings', null);
  state.settings = {
    locale: saved?.locale ?? detectLocale(),
    side: saved?.side ?? 'left',
    size: saved?.size ?? 'm',          // 文字とボタンの大きさ（m / l / xl）
    voiceConsent: saved?.voiceConsent ?? false,
    lots: saved?.lots ?? CONFIG.features.lotsDefault,   // 1台に複数の材を積む機能
    office: saved?.office ?? false,                      // 事務所とデータを共有する（初期はオフ）
  };
  await applySettings();
}

async function applySettings() {
  setLocale(state.settings.locale);
  document.body.dataset.side = state.settings.side;
  document.body.dataset.size = state.settings.size;
  applyTranslations();
  $('#sel-language').value = state.settings.locale;
  $$('#seg-side button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.side === state.settings.side)));
  $$('#size-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === state.settings.size)));
  // 文字が大きくなるとカードに入る行数が変わるので、必ず測り直す
  if (state.screen === 'measure') autoSizeCards();
  // 音声データを収集していない間は、同意を求める欄自体を出さない
  $('#voice-consent-section').hidden = !CONFIG.voiceDataCollection;
  $('#voice-consent').checked = state.settings.voiceConsent;
  $('#lots-enabled').checked = state.settings.lots;
  $('#office-enabled').checked = state.settings.office;
  $('#office-sync-now').hidden = !state.settings.office;
  renderSetupStatics();
  if (state.draft) renderMeasure();
}

async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await db.kvSet('settings', state.settings);
  await applySettings();
}

/* ==================================================================
 * 事前登録リスト（会社名・車番・現場名・納入先）
 * ================================================================== */
async function renderLists() {
  for (const kind of LIST_KINDS) {
    const section = $(`.menu-section[data-list="${kind}"]`);
    const items = await db.listOptions(kind);
    const wrap = section.querySelector('.chip-list');
    wrap.innerHTML = '';
    if (items.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'note';
      empty.textContent = t('common.none');
      wrap.appendChild(empty);
    }
    for (const item of items) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = item.value;
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '×';
      del.setAttribute('aria-label', t('common.delete'));
      del.addEventListener('click', async () => {
        await db.removeOption(item.id);
        await renderLists();
        await fillSelects();
      });
      chip.appendChild(del);
      wrap.appendChild(chip);
    }
  }
}

/** 名前の表記ゆれ（空白・全角半角）で重複しないようにまとめる */
function uniqueNames(values) {
  const seen = new Set();
  return values.filter((v) => {
    const k = nameKey(v);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 選択肢の一覧。事務所とデータを共有している端末では、事務所が登録した
 * 現場の台帳（現場名）と納入枠の工場名を先頭に混ぜる。端末で登録した名前もそのまま残す
 * （台帳に無い名前でも記録を止めない）。
 */
async function choicesFor(kind) {
  const local = (await db.listOptions(kind)).map((o) => o.value);
  const feed = state.settings.office ? state.feed : null;
  let fromOffice = [];
  if (kind === 'site') fromOffice = (feed?.sites ?? []).filter((x) => !x.closed).map((x) => x.name);
  if (kind === 'destination') fromOffice = (feed?.quotas ?? []).filter((q) => q.status === 'active').map((q) => q.destination);
  return uniqueNames([...fromOffice, ...local]);
}

/** 現場名から、事務所の台帳のIDを引く。引けなければ null（記録は止めない） */
const siteIdFor = (name) => resolveSiteId(state.feed?.sites ?? [], name);

async function fillSelects() {
  const map = {
    '#in-truck': 'truck',
    '#in-site': 'site',
    '#in-destination': 'destination',
    '#in-own': 'company',
  };
  for (const [sel, kind] of Object.entries(map)) {
    const el = $(sel);
    const prev = el.value;
    const values = await choicesFor(kind);
    el.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = values.length ? t('common.select') : t('common.none');
    el.appendChild(blank);
    for (const value of values) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      el.appendChild(opt);
    }
    if (prev) el.value = prev;
  }
}

/* ==================================================================
 * よく使う設定（マニュアル登録方式）
 * ================================================================== */
async function renderPresets() {
  const presets = await db.listPresets();
  const bar = $('#preset-bar');
  bar.innerHTML = '';
  if (presets.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'note';
    empty.textContent = t('common.none');
    bar.appendChild(empty);
  }
  for (const p of presets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-chip';
    btn.textContent = p.name;
    btn.addEventListener('click', () => {
      $('#in-species').value = p.species;
      $('#in-length').value = p.lengthM;
      state.setup.minD = p.minD;
      state.setup.maxD = p.maxD;
      renderRange();
      beep('tap');
    });
    bar.appendChild(btn);
  }

  const manage = $('#preset-manage');
  manage.innerHTML = '';
  if (presets.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'note';
    empty.textContent = t('common.none');
    manage.appendChild(empty);
  }
  for (const p of presets) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = `${p.name}（${p.species} ${formatLength(toHundredths(p.lengthM))}m ${p.minD}-${p.maxD}cm）`;
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.addEventListener('click', async () => {
      await db.removePreset(p.id);
      await renderPresets();
    });
    chip.appendChild(del);
    manage.appendChild(chip);
  }
}

/* ==================================================================
 * 画面1：セットアップ
 * ================================================================== */
function renderSetupStatics() {
  const sel = $('#sel-language');
  if (sel.options.length !== Object.keys(LOCALES).length) {
    sel.innerHTML = '';
    for (const [code, { label }] of Object.entries(LOCALES)) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = label;
      sel.appendChild(opt);
    }
  }
  $('#buy-link').href = CONFIG.stripe.checkoutUrl;
  $('#price-note').textContent = CONFIG.stripe.priceLabel;
  renderRange();
}

function renderRange() {
  if (state.setup.minD > state.setup.maxD) state.setup.maxD = state.setup.minD;
  $('#val-min').textContent = state.setup.minD;
  $('#val-max').textContent = state.setup.maxD;
  const list = diameterRange(state.setup.minD, state.setup.maxD);
  $('#range-count').textContent = `${list.length} ${t('measure.unitCount')}`.replace(/本$/, '径級');
}

function readSetup() {
  const species = $('#in-species').value.trim();
  const lengthRaw = $('#in-length').value.trim();
  if (!species) return { error: t('setup.needSpecies') };
  let lengthM;
  try {
    lengthM = formatLength(toHundredths(lengthRaw));
  } catch {
    return { error: t('setup.needLength') };
  }
  if (Number(lengthM) <= 0) return { error: t('setup.needLength') };
  if (state.setup.minD > state.setup.maxD) return { error: t('setup.needRange') };
  /*
   * 車番は必須。
   * 工場側は「どの会社の、どの車で来た荷か」でこの伝票を探すことになるため、
   * 車番が入っていない伝票は工場で永久に見つからない。
   * 後から必須に変えると既に溜まった伝票が壊れるので、先に入れておく。
   */
  if (!$('#in-truck').value) return { error: t('setup.needTruck') };
  return {
    species,
    lengthM,
    minD: state.setup.minD,
    maxD: state.setup.maxD,
    truck: $('#in-truck').value,
    site: $('#in-site').value,
    destination: $('#in-destination').value,
    ownCompany: $('#in-own').value,
    note: $('#in-note').value.trim(),
  };
}

/* ==================================================================
 * 伝票番号（日付が変わったら001にリセット）
 * ================================================================== */
async function nextTicketNo(dateStr) {
  const seq = await db.kvGet('ticketSeq', null);
  const n = seq && seq.date === dateStr ? seq.n + 1 : 1;
  return String(n).padStart(3, '0');
}

async function commitTicketNo(dateStr, ticketNo) {
  const n = Number(ticketNo.replace(/\D/g, '')) || 1;
  const seq = await db.kvGet('ticketSeq', null);
  if (!seq || seq.date !== dateStr || n > seq.n) {
    await db.kvSet('ticketSeq', { date: dateStr, n });
  }
}

/* ==================================================================
 * 下書き（計測中データ）の保存 —— 入力の都度、即座にIndexedDBへ
 * ================================================================== */
async function persistDraft() {
  if (!state.draft) return;
  await db.kvSet('draft', state.draft);
}

/** いま入力している材（ロット） */
const curLot = () => state.draft.lots[state.draft.activeLot];

/* ==================================================================
 * 画面3：計測入力
 * ================================================================== */
function startMeasure(setup, { resume = false } = {}) {
  if (!resume) {
    // 便（トラック1台ぶん）。車番・納入先などは便ぜんたいの項目、樹種・長さ・現場・範囲はロットの項目
    state.draft = {
      id: uid(),
      createdAt: Date.now(),
      dateStr: todayStr(),
      ticketNo: null,
      truck: setup.truck,
      destination: setup.destination,
      ownCompany: setup.ownCompany,
      note: setup.note,
      lots: [newLot({ ...setup, siteId: siteIdFor(setup.site) })],
      activeLot: 0,
      syncState: 'pending',
    };
  }
  state.diameters = diameterRange(curLot().minD, curLot().maxD);
  showScreen('measure');
  buildGrid();
  renderMeasure();
  persistDraft();
}

/** 径級グリッドを作り直す（範囲が狭ければカードを自動的に大きくする） */
function buildGrid() {
  const grid = $('#grid');
  grid.innerHTML = '';
  for (const d of state.diameters) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'dia-card';
    card.dataset.d = String(d);
    // 入力ボタンには材積を出さない（押す数字＝本数だけに集中させる）
    card.innerHTML = `
      <span class="d">${d}<small>cm</small></span>
      <span class="n" data-role="n">0<small>${t('measure.unitCount')}</small></span>`;
    attachCardHandlers(card, d);
    grid.appendChild(card);
  }
  autoSizeCards();
}

/**
 * 表示する径級が少ないときはカードを大きく、多いときは一定高＋スクロール。
 */
/** 手袋をしたままでも余裕をもって押せる高さ。スクロールするならこれ以上を保つ */
const MIN_CARD_H = 56;
/**
 * 「全部を1画面に出す」ためなら、ここまでは詰めてよい高さ。
 * 指の腹はおよそ45px。48pxあれば手袋でも押せる。
 * 現場の判断として、少し小さくなることより、目的の径級を探して
 * スクロールすることのほうが確実にストレスになる。
 */
const FIT_MIN_CARD_H = 48;
const GRID_GAP = 5;

/**
 * 径級ボタンの大きさを決める。
 *
 * 最優先は「1画面に収める」こと。マウントに付けたまま手袋で使う道具なので、
 * 目的の径級を探してスクロールするのが最大のストレスになる。
 * そのため、収まる限りは高さを削ってでも全部を表示し、
 * 収まりきらない広範囲（7〜60cm全域など）のときだけスクロールを許す。
 */
function autoSizeCards() {
  const wrap = $('#grid-wrap');
  const grid = $('#grid');
  const n = state.diameters.length;
  if (n === 0) return;

  const cols = Number(getComputedStyle(document.documentElement).getPropertyValue('--grid-cols')) || 2;
  const rows = Math.ceil(n / cols);
  // clientHeight から自前の padding を引く（子要素の実測に頼ると初回描画でずれる）
  const pad = parseFloat(getComputedStyle(wrap).paddingTop) || 0;
  const avail = wrap.clientHeight - pad * 2;
  if (avail <= 0) return;

  const fit = Math.floor((avail - GRID_GAP * (rows - 1)) / rows);
  // 上限はカード幅（＝正方形）まで。それ以上伸ばしても押しやすくならず間延びする
  const cardWidth = Math.floor((grid.clientWidth - GRID_GAP * (cols - 1)) / cols);
  const fits = fit >= FIT_MIN_CARD_H;

  document.documentElement.style.setProperty('--card-w', `${cardWidth}px`);

  let h;
  if (fits) {
    // 正方形より縦長まで許す。径級が4つなどのとき、上に大きな余白が残るより、
    // タップ目標が大きいほうが現場では確実に押せる。
    // 文字の大きさは別途カード幅から頭打ちになるので、間延びはしない
    h = Math.min(Math.round(cardWidth * 1.6), fit);
  } else {
    /*
     * どうしても収まらない広範囲（7〜60cm全域など）。
     * このときは「画面にちょうど何行か入り切る高さ」にそろえる。
     * 中途半端な高さにすると上下の行が必ず半分だけ見える状態になり、
     * 手袋で押すと切れたカードを押してしまう。
     */
    const visibleRows = Math.max(1, Math.floor((avail + GRID_GAP) / (MIN_CARD_H + GRID_GAP)));
    // ここに来るのは、詰めても収まらなかったとき。行の高さはゆとりのある方に戻す
    h = Math.floor((avail - GRID_GAP * (visibleRows - 1)) / visibleRows);
  }
  document.documentElement.style.setProperty('--card-h', `${h}px`);

  grid.classList.toggle('is-fits', fits);
  // 収まらなかったときだけ、上下に「まだ続きがある」影を出す
  wrap.classList.toggle('is-scrollable', !fits);
}

/**
 * 画面の高さは、バナーの出入り・キーボード・画面回転・アドレスバーの伸縮で動く。
 * その都度測り直さないと、9径級でも最後の1枚が画面外に落ちる（実測で確認した）。
 */
function watchGridSize() {
  const wrap = $('#grid-wrap');
  if (!wrap || typeof ResizeObserver === 'undefined') return;
  new ResizeObserver(() => { if (state.screen === 'measure') autoSizeCards(); }).observe(wrap);
}

/**
 * タップ = +1
 * 長押し(2秒) = 押した場所で動作が変わる
 *   本数の数字の上 → 本数を直接入力（山を数えてまとめて入れるとき用）
 *   それ以外       → -1（押し間違いの取消）
 */
function attachCardHandlers(card, d) {
  let timer = null;
  let longFired = false;

  const clear = () => {
    clearTimeout(timer);
    timer = null;
    card.classList.remove('is-longpress');
    delete card.dataset.lp;
  };

  const onDown = (ev) => {
    longFired = false;
    const mode = ev.target.closest('.n') ? 'count' : 'minus';
    card.dataset.lp = mode;
    card.classList.add('is-longpress');
    timer = setTimeout(() => {
      longFired = true;
      clear();
      if (mode === 'count') openCountDialog(d);
      else cancelOne(d);
    }, LONG_PRESS_MS);
  };

  card.addEventListener('pointerdown', onDown);
  card.addEventListener('pointerup', () => {
    const wasLong = longFired;
    clear();
    if (!wasLong) addOne(d, 'tap');
  });
  card.addEventListener('pointerleave', clear);
  card.addEventListener('pointercancel', clear);
  card.addEventListener('contextmenu', (e) => e.preventDefault());
}

function addOne(d, source = 'tap') {
  if (!state.draft) return;
  curLot().entries.push({ id: uid(), ts: Date.now(), d, source, cancelled: false });
  const card = $(`.dia-card[data-d="${d}"]`);
  feedbackAdd(card);
  renderMeasure();
  persistDraft();
}

/** 指定径級の最後の有効な入力を取消す（履歴からは消さない） */
function cancelOne(d) {
  if (!state.draft) return;
  const entries = curLot().entries;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.d === d && !e.cancelled) {
      e.cancelled = true;
      e.cancelledAt = Date.now();
      feedbackUndo();
      renderMeasure();
      persistDraft();
      return true;
    }
  }
  feedbackError();
  toast(t('measure.nothingToCancel'));
  return false;
}

/** その径級の現在の本数（取消を除く） */
function countOf(d) {
  return curLot().entries.filter((e) => e.d === d && !e.cancelled).length;
}

/**
 * その径級の本数を指定の数にそろえる。
 * 増やすぶんは入力を追加し、減らすぶんは新しい方から取消として印を付ける。
 * こうすることで履歴・取消の扱いがタップ入力とまったく同じになる。
 */
function setCount(d, target) {
  const entries = curLot().entries;
  const current = countOf(d);
  if (target === current) return;
  if (target > current) {
    for (let i = current; i < target; i++) {
      entries.push({ id: uid(), ts: Date.now(), d, source: 'manual', cancelled: false });
    }
  } else {
    let remove = current - target;
    for (let i = entries.length - 1; i >= 0 && remove > 0; i--) {
      const e = entries[i];
      if (e.d === d && !e.cancelled) {
        e.cancelled = true;
        e.cancelledAt = Date.now();
        remove -= 1;
      }
    }
  }
  renderMeasure();
  persistDraft();
}

/** 本数の直接入力ダイアログを開く */
function openCountDialog(d) {
  const dlg = $('#dlg-count');
  dlg.dataset.d = String(d);
  $('#count-title').textContent = t('measure.directTitle', { d });
  const input = $('#count-input');
  input.value = String(countOf(d));
  beep('tap');
  vibrate(40);
  dlg.showModal();
  input.focus();
  input.select();
}

/** 直前の1件を取消す */
function undoLast() {
  if (!state.draft) return;
  const entries = curLot().entries;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e.cancelled) {
      e.cancelled = true;
      e.cancelledAt = Date.now();
      feedbackUndo();
      renderMeasure();
      persistDraft();
      return;
    }
  }
  feedbackError();
  toast(t('measure.nothingToCancel'));
}

function renderMeasure() {
  const draft = state.draft;
  if (!draft) return;
  const lot = curLot();

  $('#meta-text').textContent = `${lot.species} / ${formatLength(toHundredths(lot.lengthM))}m / ${lot.minD}-${lot.maxD}cm`;
  renderLotTabs();

  // 径級ごとの本数（リアルタイム）。いま入力している材のぶん
  const counts = new Map();
  for (const e of lot.entries) {
    if (e.cancelled) continue;
    counts.set(e.d, (counts.get(e.d) ?? 0) + 1);
  }
  for (const card of $$('.dia-card')) {
    const d = Number(card.dataset.d);
    const n = counts.get(d) ?? 0;
    card.dataset.hasCount = String(n > 0);
    card.dataset.wide = String(n >= 100);   // 3桁は文字を一段小さくして折り返しを防ぐ
    card.querySelector('[data-role="n"]').innerHTML = `${n}<small>${t('measure.unitCount')}</small>`;
  }

  // 合計は便ぜんたい（すべての材）。出力確認・CSVと必ず同じ数字になる
  const { count, volume } = ticketTotals(draft);
  $('#total-count').textContent = String(count);
  $('#total-volume').textContent = formatVolume(volume);

  renderHistory();
  updateVoiceButton();
}

/** 入力履歴（取消済みも消さずに残す） */
function renderHistory() {
  const box = $('#history');
  // 1行しか見せないので、描画するのも直近ぶんだけでよい（数百本入力しても重くならない）
  const entries = curLot().entries.slice(-40);
  box.innerHTML = '';
  box.classList.toggle('is-empty', entries.length === 0);
  if (entries.length === 0) {
    const p = document.createElement('div');
    p.id = 'history-empty';
    p.textContent = t('measure.historyEmpty');
    box.appendChild(p);
    return;
  }
  // 時刻や単位は出さず、径級の数字だけを古い順に並べる。最新が常に右端に残る
  for (const e of entries) {
    const item = document.createElement('span');
    item.className = 'hist-item' + (e.cancelled ? ' is-cancelled' : '');
    item.textContent = String(e.d);
    box.appendChild(item);
  }
}

/* ==================================================================
 * 便：1台に複数の材（ロット）を積む
 * タブで材を切り替える。直前取消・径級カードの操作は、いま選んでいる材にだけ効く。
 * ================================================================== */
/** タブを出すか。機能がオンのとき、または既に複数の材を積んでいる便のとき */
const lotsVisible = () => state.settings.lots || (state.draft?.lots.length ?? 0) > 1;

function renderLotTabs() {
  const bar = $('#lot-tabs');
  const show = lotsVisible();
  bar.hidden = !show;
  $('#meta-text').hidden = show;   // タブに樹種と長さが出ているので、1行目はタブに譲る
  if (!show) return;
  const { lots, activeLot } = state.draft;
  const prevScroll = bar.scrollLeft;
  bar.innerHTML = '';
  lots.forEach((lot, i) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'lot-tab' + (i === activeLot ? ' is-active' : '');
    tab.dataset.i = String(i);
    const label = document.createElement('span');
    label.textContent = lotLabel(lot, lots, (m) => formatLength(toHundredths(m)));
    const n = document.createElement('b');
    n.textContent = String(activeCount(lot));
    tab.append(label, n);
    tab.addEventListener('click', () => {
      if (i === state.draft.activeLot) { openLotDialog('edit'); return; }   // 選択中のタブをもう一度押すと内容を直せる
      switchLot(i);
    });
    bar.appendChild(tab);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'lot-add';
  add.textContent = '＋';
  add.setAttribute('aria-label', t('lots.addAria'));
  add.addEventListener('click', () => openLotDialog('add'));
  bar.appendChild(add);
  bar.scrollLeft = prevScroll;
}

function switchLot(i) {
  state.draft.activeLot = i;
  state.diameters = diameterRange(curLot().minD, curLot().maxD);
  buildGrid();
  renderMeasure();
  persistDraft();
  beep('tap');
  $('#lot-tabs .lot-tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** 材の追加・修正ダイアログ。範囲のピッカーはセットアップ画面と同じ操作 */
const lotForm = { mode: 'add', minD: 14, maxD: 30 };

function renderLotRange() {
  if (lotForm.minD > lotForm.maxD) lotForm.maxD = lotForm.minD;
  $('#lot-val-min').textContent = lotForm.minD;
  $('#lot-val-max').textContent = lotForm.maxD;
}

async function openLotDialog(mode) {
  const lot = curLot();
  lotForm.mode = mode;
  lotForm.minD = lot.minD;
  lotForm.maxD = lot.maxD;
  $('#lot-title').textContent = t(mode === 'add' ? 'lots.addTitle' : 'lots.editTitle');
  // 追加のときは、いま入力している材をそのまま初期値にする（違うところだけ直せばよい）
  $('#lot-species').value = lot.species;
  $('#lot-length').value = formatLength(toHundredths(lot.lengthM));
  const sel = $('#lot-site');
  sel.innerHTML = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '-';
  sel.appendChild(blank);
  const sites = await choicesFor('site');
  if (lot.site && !sites.some((v) => nameKey(v) === nameKey(lot.site))) sites.push(lot.site);
  for (const v of sites) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
  sel.value = lot.site ?? '';
  renderLotRange();
  // 削除は修正のときだけ。便に材が1つしかないときは消せない
  $('#lot-delete').hidden = !(mode === 'edit' && state.draft.lots.length > 1);
  $('#dlg-lot').showModal();
}

function applyLotDialog() {
  const species = $('#lot-species').value.trim();
  if (!species) { feedbackError(); toast(t('setup.needSpecies')); return; }
  let lengthM;
  try {
    lengthM = formatLength(toHundredths($('#lot-length').value.trim()));
  } catch {
    feedbackError(); toast(t('setup.needLength')); return;
  }
  if (Number(lengthM) <= 0) { feedbackError(); toast(t('setup.needLength')); return; }

  const spec = { species, lengthM, minD: lotForm.minD, maxD: lotForm.maxD, site: $('#lot-site').value };
  const draft = state.draft;
  const dup = indexOfSameLot(draft.lots, spec);

  if (lotForm.mode === 'add') {
    $('#dlg-lot').close();
    if (dup >= 0) {
      // 同じ材をもう一つ作ると集計が分かれてしまう。作らずに、あるほうへ移る
      toast(t('lots.dup'));
      switchLot(dup);
      return;
    }
    draft.lots.push(newLot({ ...spec, siteId: siteIdFor(spec.site) }));
    switchLot(draft.lots.length - 1);
    return;
  }

  // 修正：他の材と同じ内容にはできない
  if (dup >= 0 && dup !== draft.activeLot) { feedbackError(); toast(t('lots.dupEdit')); return; }
  const lot = curLot();
  // すでに入力のある径級を範囲から外すと、画面に出ない入力が合計にだけ入ってしまう
  const range = clampRangeToEntries(lot, spec.minD, spec.maxD);
  if (range.minD !== spec.minD || range.maxD !== spec.maxD) toast(t('lots.rangeKept'), 4000);
  Object.assign(lot, { species, lengthM, site: spec.site, siteId: siteIdFor(spec.site), minD: range.minD, maxD: range.maxD });
  $('#dlg-lot').close();
  state.diameters = diameterRange(lot.minD, lot.maxD);
  buildGrid();
  renderMeasure();
  persistDraft();
  beep('done');
}

/* ==================================================================
 * 音声入力（圏外では使えないことをはっきり伝える）
 * ================================================================== */
function updateVoiceButton() {
  const btn = $('#voice-btn');
  const available = isVoiceAvailable();
  btn.disabled = !available;
  btn.title = available ? t('measure.voice') : t('measure.voiceOffline');
  if (!available && state.voice?.wantListening) state.voice.stop();
}

function setupVoice() {
  if (!isVoiceSupported()) return;
  const langMap = { ja: 'ja-JP', vi: 'vi-VN', tl: 'fil-PH', th: 'th-TH', ms: 'ms-MY' };
  state.voice = new VoiceInput({
    lang: langMap[getLocale()] ?? 'ja-JP',
    getAllowed: () => state.diameters,
    onResult: (d) => addOne(d, 'voice'),
    onMiss: () => { feedbackError(); },
    onStateChange: (listening) => {
      $('#voice-btn').classList.toggle('is-listening', listening);
      if (listening) toast(t('measure.voiceListening'), 1500);
    },
  });
}

/* ==================================================================
 * 画面4：出力確認 → CSV共有
 * ================================================================== */
async function openOutputDialog() {
  const draft = state.draft;
  const agg = aggregateTicket(draft);
  if (agg.totalCount === 0) {
    feedbackError();
    toast(t('output.empty'));
    return;
  }
  const lots = agg.lots.filter((l) => l.totalCount > 0);
  const single = lots.length === 1;
  const lenOf = (lot) => formatLength(toHundredths(lot.lengthM));

  const table = $('#output-summary');
  if (single) {
    const lot = lots[0].lot;
    table.innerHTML = `
      <tr><th>${t('csv.date')}</th><td>${esc(draft.dateStr)}</td></tr>
      <tr><th>${t('setup.species')}</th><td>${esc(lot.species)}</td></tr>
      <tr><th>${t('setup.length')}</th><td>${lenOf(lot)} m</td></tr>
      <tr><th>${t('setup.range')}</th><td>${lot.minD}-${lot.maxD} cm</td></tr>
      <tr><th>${t('measure.count')}</th><td><b>${agg.totalCount}</b> ${t('measure.unitCount')}</td></tr>
      <tr><th>${t('measure.volume')}</th><td><b>${formatVolume(agg.totalVolume)}</b> m³</td></tr>`;
  } else {
    // 複数の材を積んだ便：まず便ぜんたいの合計。明細は材ごとに分けて下に並べる
    table.innerHTML = `
      <tr><th>${t('csv.date')}</th><td>${esc(draft.dateStr)}</td></tr>
      <tr><th colspan="2" class="sum-head">${t('lots.tripTotal')}</th></tr>
      <tr><th>${t('measure.count')}</th><td><b>${agg.totalCount}</b> ${t('measure.unitCount')}</td></tr>
      <tr><th>${t('measure.volume')}</th><td><b>${formatVolume(agg.totalVolume)}</b> m³</td></tr>`;
  }

  // 工場の手書き伝票へ書き写すための明細。径級・単材積・本数・小計材積を並べる（材ごと）
  $('#output-detail').innerHTML = lots.map(({ lot, rows, totalCount, totalVolume }) => `
    ${single ? '' : `<div class="lot-head">${esc(lot.species)} ${lenOf(lot)}m <small>${lot.minD}-${lot.maxD}cm${lot.site ? ` · ${esc(lot.site)}` : ''}</small></div>`}
    <table class="detail-table">
      <thead><tr>
        <th>${t('csv.diameter')}</th>
        <th>${t('output.perLog')}</th>
        <th>${t('csv.count')}</th>
        <th>${t('csv.subtotal')}</th>
      </tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td>${r.d}</td>
          <td class="per">${formatVolume(r.perLog, 4)}</td>
          <td class="n">${r.count}</td>
          <td class="v">${formatVolume(r.subtotal)}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr>
        <td>${t('common.total')}</td>
        <td></td>
        <td>${totalCount}</td>
        <td>${formatVolume(totalVolume)}</td>
      </tr></tfoot>
    </table>`).join('');
  $('#out-ticket-no').value = draft.ticketNo ?? await nextTicketNo(draft.dateStr);
  $('#out-note').value = draft.note ?? '';
  $('#dlg-output').showModal();
}

async function doOutput() {
  const draft = state.draft;
  draft.ticketNo = ($('#out-ticket-no').value.trim() || '001').padStart(3, '0');
  draft.note = $('#out-note').value.trim();
  draft.outputAt = Date.now();
  draft.syncState = 'pending';
  // 台帳が更新されていたら、現場IDを引き直して記録に入れる（名前は記録時点のまま残す）
  for (const lot of draft.lots) lot.siteId = siteIdFor(lot.site) ?? lot.siteId ?? null;

  await db.saveTicket({ ...draft });
  await commitTicketNo(draft.dateStr, draft.ticketNo);
  $('#dlg-output').close();

  const result = await shareCsv(draft);
  if (result !== 'cancelled') {
    beep('done');
    toast(t('output.done'));
  }

  // 出力済み。次の伝票へ備えて下書きを空にする
  await db.kvDelete('draft');
  state.draft = null;
  showScreen('setup');
  $('#in-note').value = '';
  backup.runBackup().catch(() => {});
  // 事務所とデータを共有している端末は、通信できるとき事務所へ送る（失敗しても現場の操作は止めない）
  officeSync.enqueue(draft.id).then(() => syncOffice()).catch(() => {});
}

/* ==================================================================
 * 伝票履歴
 * ================================================================== */
async function openHistory() {
  const tickets = await db.listTickets();
  const box = $('#ticket-list');
  box.innerHTML = '';
  if (tickets.length === 0) {
    box.innerHTML = `<p class="note">${t('history.empty')}</p>`;
  }
  for (const raw of tickets) {
    const ticket = normalizeTicket(raw);   // 古い形（1伝票＝1材）の伝票もそのまま読める
    const { totalCount, totalVolume } = aggregateTicket(ticket);
    const el = document.createElement('div');
    el.className = 'ticket';
    const icon = ticket.syncState === 'synced' ? '✅' : '☁️';
    const syncLabel = ticket.syncState === 'synced' ? t('history.synced') : t('history.pending');
    el.innerHTML = `
      <div class="head"><span>${ticket.dateStr} No.${ticket.ticketNo}</span><span>${icon}</span></div>
      ${ticket.lots.map((lot) => `<div class="sub">${esc(lot.species)} / ${formatLength(toHundredths(lot.lengthM))}m / ${lot.minD}-${lot.maxD}cm${ticket.lots.length > 1 && lot.site ? ` / ${esc(lot.site)}` : ''}</div>`).join('')}
      <div class="sub">${totalCount} ${t('measure.unitCount')} / ${formatVolume(totalVolume)} m³ · ${syncLabel}</div>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm';
    btn.style.marginTop = '8px';
    btn.textContent = t('history.reexport');
    btn.addEventListener('click', () => shareCsv(ticket));
    el.appendChild(btn);
    box.appendChild(el);
  }
  $('#dlg-history').showModal();
}

/* ==================================================================
 * サブスクリプション表示
 * ================================================================== */
/**
 * Stripeの決済が終わってアプリに戻ってきたときの自動有効化。
 * Payment Link の戻り先を ?checkout=success&session_id=... にしてあるので、
 * 利用者はコードを入力しなくても、そのまま使えるようになる。
 * 処理後はURLを元に戻す（履歴に session_id を残さない）。
 */
async function handleCheckoutReturn() {
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session_id');
  if (!sessionId) return;
  toast(t('license.checking'));
  const res = await subscription.activateFromCheckout(sessionId);
  toast(res.ok ? t('license.activated') : t('license.invalid'), 6000);
  if (!res.ok) feedbackError();
  history.replaceState(null, '', location.pathname);
}

async function renderSubscription() {
  const result = await subscription.evaluate();
  const el = $('#sub-status');
  const banner = $('#sub-banner');
  const dateOf = (ms) => (ms ? new Date(ms).toLocaleDateString() : '-');
  // 解約済み（期間満了で止まる）ことを隠さずに伝える
  const validText = (r) => t(r.state.cancelAtPeriodEnd ? 'license.canceled' : 'license.valid', { date: dateOf(r.state.expiresAt) });

  let text;
  switch (result.reason) {
    case 'active':
      text = validText(result);
      break;
    case 'grace':
      text = `${validText(result)} / ${t('license.offlineNote', { days: result.graceDaysLeft })}`;
      break;
    case 'trial':
      text = t('license.trial', { days: result.trialDaysLeft });
      break;
    case 'trial-ended':
      text = t('license.trialEnded');
      break;
    default:
      text = t('license.expired');
  }
  el.textContent = text;

  const warn = !result.allowed || result.reason === 'trial';
  banner.classList.toggle('is-show', warn);
  banner.textContent = warn ? text : '';

  // 他の端末に移すためのライセンスコード。購入済みのときだけ出す
  const code = result.state.code;
  $('#license-code-box').hidden = !code;
  $('#out-license').value = code ?? '';
  $('#portal-link').disabled = !code;
  return result;
}

/* ==================================================================
 * Googleドライブ表示
 * ================================================================== */
async function renderBackupStatus() {
  const s = await backup.status();
  const el = $('#backup-status');
  if (!s.configured) {
    el.textContent = t('backup.unconfigured');
    $('#drive-connect').disabled = true;
    $('#drive-now').disabled = true;
    return;
  }
  el.textContent = s.connected
    ? t('backup.connected', { date: s.lastBackupAt ? new Date(s.lastBackupAt).toLocaleString() : '-' })
    : t('backup.never');
}

/* ==================================================================
 * 事務所との連携（お知らせの帯・納入枠・同期の状態）
 * ================================================================== */
/** いま見ている納入先。計測中は便の納入先、準備中は選択中のもの */
const currentDestination = () => (state.screen === 'measure' ? (state.draft?.destination ?? '') : $('#in-destination').value);

const whenText = (ms) => new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function appendText(parent, cls, text, tag = 'span') {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

/** 最終更新の表示。古い情報で空振りしないよう、圏外のときは「最新でない可能性」を必ず添える */
function staleLine(parent, cls) {
  const feed = state.feed;
  if (!feed) return;
  const line = appendText(parent, cls, t('office.updatedAt', { when: whenText(feed.fetchedAt) }), 'div');
  if (!navigator.onLine) {
    line.classList.add('is-warn');
    line.textContent += ` — ${t('office.stale')}`;
  }
}

function renderOfficeInfo() {
  const band = $('#notice-band');
  const card = $('#quota-card');
  const feed = state.settings.office ? state.feed : null;
  if (!feed) { band.hidden = true; card.hidden = true; return; }
  const now = new Date();
  const dest = currentDestination();

  // お知らせの帯（止める種類を先頭に。納入先が決まっていれば、その工場宛と全体向けだけ）
  const notices = noticesFor(feed.notices, dest, now);
  band.replaceChildren();
  if (notices.length) {
    const top = notices[0];
    band.hidden = false;
    band.dataset.kind = top.kind;
    appendText(band, 'nb-kind', t(`office.kind.${top.kind}`));
    const where = [top.destination || t('office.allFactories'), top.place].filter(Boolean).join(' ');
    appendText(band, 'nb-text', `${where}：${top.body}`);
    if (notices.length > 1) appendText(band, 'nb-more', t('office.more', { n: notices.length - 1 }));
  } else {
    band.hidden = true;
  }

  // 納入枠（準備画面だけ。計測中は画面を使わない）
  card.replaceChildren();
  const quotas = state.screen === 'setup' ? quotasFor(feed, dest, now) : [];
  card.hidden = quotas.length === 0;
  for (const { quota, window: win, left } of quotas.slice(0, 3)) {
    const item = document.createElement('div');
    item.className = 'qc-item';
    appendText(item, 'qc-title', `${t('office.quota')}　${quota.destination}${quota.species ? ` ${quota.species}` : ''}`, 'div');
    appendText(item, `qc-left${left.over ? ' is-over' : ''}`,
      left.over ? t('office.quotaOver', { v: formatVolume(-left.remain) }) : t('office.quotaLeft', { v: formatVolume(left.remain) }), 'div');
    const next = win.nextOpenAt ? ` (${t('office.nextOpen', { when: whenText(win.nextOpenAt.getTime()) })})` : '';
    appendText(item, `qc-window ${win.open ? 'is-open' : 'is-shut'}`, win.open ? t('office.canUnload') : `${t('office.cannotUnload')}${next}`, 'div');
    card.appendChild(item);
  }
  if (quotas.length) staleLine(card, 'qc-stale');
}

function openNoticeList() {
  const feed = state.feed;
  if (!feed) return;
  const list = $('#notice-list');
  list.replaceChildren();
  for (const n of noticesFor(feed.notices, currentDestination(), new Date())) {
    const item = document.createElement('div');
    item.className = 'nl-item';
    const head = [t(`office.kind.${n.kind}`), n.destination || t('office.allFactories'), n.place].filter(Boolean).join('　');
    appendText(item, 'nl-head', head, 'div');
    appendText(item, 'nl-body', n.body, 'div');
    const period = [n.from, n.to].some(Boolean) ? `${(n.from || '').replace('T', ' ')} 〜 ${(n.to || '').replace('T', ' ')}` : '';
    if (period) appendText(item, 'nl-period', period, 'div');
    list.appendChild(item);
  }
  const stale = $('#notice-stale');
  stale.replaceChildren();
  staleLine(stale, 'qc-stale');
  $('#dlg-notices').showModal();
}

async function renderOfficeStatus() {
  const el = $('#office-status');
  if (!state.settings.office) { el.textContent = ''; return; }
  const st = await officeSync.status();
  const parts = [];
  if (st.pending > 0) parts.push(t('office.pending', { n: st.pending }));
  if (st.lastSyncAt) parts.push(t('office.synced', { date: whenText(st.lastSyncAt) }));
  if (st.feedAt) parts.push(t('office.updatedAt', { when: whenText(st.feedAt) }));
  if (st.error === 'office_not_set_up') parts.push(t('office.notSetUp'));
  else if (st.error === 'no_license') parts.push(t('office.needLicense'));
  else if (st.error && st.error !== 'offline') parts.push(t('office.error'));
  el.textContent = parts.join(' / ');
}

/** 送れていない便を送り、事務所の最新を受け取る。通信できなければ何もしない */
async function syncOffice({ force = false } = {}) {
  if (!state.settings.office) return;
  try {
    await officeSync.flush();
    const feed = await officeSync.refreshFeed({ force });
    if (feed) state.feed = feed;
  } catch {
    // 事務所との連携が失敗しても、計測・保存は止めない
  }
  await fillSelects();
  renderOfficeInfo();
  renderOfficeStatus();
}

/* ==================================================================
 * ドロワー
 * ================================================================== */
function openDrawer() {
  $('#drawer').classList.add('is-open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#drawer-scrim').classList.add('is-open');
  renderLists();
  renderPresets();
  renderSubscription();
  renderBackupStatus();
  renderOfficeStatus();
}

function closeDrawer() {
  $('#drawer').classList.remove('is-open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#drawer-scrim').classList.remove('is-open');
}

/* ==================================================================
 * イベント配線
 * ================================================================== */
function wireEvents() {
  $('#menu-btn').addEventListener('click', openDrawer);
  $('#menu-btn-2').addEventListener('click', openDrawer);

  $$('#size-seg button').forEach((b) => {
    b.addEventListener('click', () => saveSettings({ size: b.dataset.size }));
  });
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-scrim').addEventListener('click', closeDrawer);

  $('#sel-language').addEventListener('change', (e) => {
    saveSettings({ locale: e.target.value });
    setupVoice();
  });
  $$('#seg-side button').forEach((b) => {
    b.addEventListener('click', () => saveSettings({ side: b.dataset.side }));
  });
  $('#voice-consent').addEventListener('change', (e) => saveSettings({ voiceConsent: e.target.checked }));
  $('#lots-enabled').addEventListener('change', (e) => saveSettings({ lots: e.target.checked }));
  $('#office-enabled').addEventListener('change', async (e) => {
    await saveSettings({ office: e.target.checked });
    if (e.target.checked) {
      state.feed = (await officeSync.getFeed()) ?? state.feed;
      await syncOffice({ force: true });
    } else {
      state.feed = null;       // オフにしたら、事務所の情報は画面にも選択肢にも出さない
      await fillSelects();
    }
    renderOfficeInfo();
    renderOfficeStatus();
  });
  $('#office-sync-now').addEventListener('click', async () => {
    await syncOffice({ force: true });
    toast(t('office.syncNow'));
  });
  $('#notice-band').addEventListener('click', openNoticeList);
  $('#notices-close').addEventListener('click', () => $('#dlg-notices').close());
  $('#in-destination').addEventListener('change', renderOfficeInfo);

  // 事前登録リストの追加
  $$('.menu-section[data-list]').forEach((section) => {
    const kind = section.dataset.list;
    const input = section.querySelector('input');
    const add = async () => {
      const value = input.value.trim();
      if (!value) return;
      await db.addOption(kind, value);
      input.value = '';
      await renderLists();
      await fillSelects();
    };
    section.querySelector('.inline-add button').addEventListener('click', add);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  });

  // 径級レンジの▲▼
  $$('.picker-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.dia === 'min' ? 'minD' : 'maxD';
      const dir = Number(btn.dataset.dir);
      const next = dir > 0 ? nextDiameter(state.setup[key]) : prevDiameter(state.setup[key]);
      state.setup[key] = normalizeDiameter(Math.max(1, Math.min(200, next)));
      if (key === 'minD' && state.setup.minD > state.setup.maxD) state.setup.maxD = state.setup.minD;
      if (key === 'maxD' && state.setup.maxD < state.setup.minD) state.setup.minD = state.setup.maxD;
      renderRange();
      beep('tap');
    });
  });

  // 材の追加・修正ダイアログ
  $$('.lot-picker-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.dia === 'min' ? 'minD' : 'maxD';
      const next = Number(btn.dataset.dir) > 0 ? nextDiameter(lotForm[key]) : prevDiameter(lotForm[key]);
      lotForm[key] = normalizeDiameter(Math.max(1, Math.min(200, next)));
      if (key === 'minD' && lotForm.minD > lotForm.maxD) lotForm.maxD = lotForm.minD;
      if (key === 'maxD' && lotForm.maxD < lotForm.minD) lotForm.minD = lotForm.maxD;
      renderLotRange();
      beep('tap');
    });
  });
  $('#lot-ok').addEventListener('click', applyLotDialog);
  $('#lot-cancel').addEventListener('click', () => $('#dlg-lot').close());
  $('#lot-delete').addEventListener('click', () => {
    const draft = state.draft;
    // 入力のある材を消すと、積んだ本数が黙って消える。先に本数を0にしてもらう
    if (activeCount(curLot()) > 0) { feedbackError(); toast(t('lots.deleteBlocked'), 4000); return; }
    draft.lots.splice(draft.activeLot, 1);
    $('#dlg-lot').close();
    switchLot(Math.min(draft.activeLot, draft.lots.length - 1));
  });

  $('#save-preset-btn').addEventListener('click', async () => {
    const setup = readSetup();
    if (setup.error) { feedbackError(); toast(setup.error); return; }
    const name = prompt(t('setup.presetName'), `${setup.species} ${setup.lengthM}m`);
    if (!name) return;
    await db.savePreset({ id: uid(), name: name.trim(), species: setup.species, lengthM: setup.lengthM, minD: setup.minD, maxD: setup.maxD });
    await renderPresets();
    toast(t('common.save'));
  });

  // 計測開始 → 画面2の確認ポップアップ（樹種の切替忘れ防止）
  $('#start-btn').addEventListener('click', async () => {
    const setup = readSetup();
    if (setup.error) { feedbackError(); toast(setup.error); return; }
    const sub = await subscription.evaluate();
    if (!sub.allowed) {
      feedbackError();
      toast(t('license.needed'));
      openDrawer();
      return;
    }
    $('#start-question').textContent = t('start.question', {
      species: setup.species,
      length: formatLength(toHundredths(setup.lengthM)),
      min: setup.minD,
      max: setup.maxD,
    });
    $('#dlg-start').dataset.payload = JSON.stringify(setup);
    $('#dlg-start').showModal();
  });
  $('#start-yes').addEventListener('click', () => {
    const setup = JSON.parse($('#dlg-start').dataset.payload);
    $('#dlg-start').close();
    startMeasure(setup);
  });
  $('#start-no').addEventListener('click', () => $('#dlg-start').close());

  /*
   * 直前取消は「押したら最後の1本が消える」だけにする。
   * 以前は長押しで径級を選んで取り消す一覧を出していたが、
   *   - 径級カードの長押し（-1）とやることが同じで重複していた
   *   - 0.7秒と短く、揺れる車内や手袋だと意図せず出てしまう
   *   - 計測中に画面いっぱいのダイアログが出るのがいちばん危ない
   * ため 2026-10-01 に廃止した（現場判断）。
   */
  $('#undo-btn').addEventListener('click', undoLast);

  // 本数の直接入力
  const applyCount = () => {
    const dlg = $('#dlg-count');
    const d = Number(dlg.dataset.d);
    const raw = Number($('#count-input').value);
    if (!Number.isFinite(raw) || raw < 0) { feedbackError(); return; }
    setCount(d, Math.min(9999, Math.trunc(raw)));
    dlg.close();
    beep('done');
  };
  $('#count-ok').addEventListener('click', applyCount);
  $('#count-cancel').addEventListener('click', () => $('#dlg-count').close());
  $('#count-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCount(); });

  // データ出力（ボタンとポップアップを分離して誤出力を防ぐ）
  $('#export-btn').addEventListener('click', openOutputDialog);
  $('#output-yes').addEventListener('click', doOutput);
  $('#output-no').addEventListener('click', () => $('#dlg-output').close());

  $('#voice-btn').addEventListener('click', () => {
    if (!isVoiceAvailable()) { feedbackError(); toast(t('measure.voiceOffline')); return; }
    state.voice?.toggle();
  });

  $('#open-history').addEventListener('click', openHistory);
  $('#history-close').addEventListener('click', () => $('#dlg-history').close());

  $('#activate-btn').addEventListener('click', async () => {
    const input = $('#in-license').value.trim();
    if (!input) return;
    toast(t('license.checking'));
    const res = await subscription.activate(input);
    if (res.ok) {
      toast(t('license.activated'));
      $('#in-license').value = '';
    } else {
      feedbackError();
      toast(res.error === 'offline' ? t('license.needOnline') : t('license.invalid'), 5000);
    }
    renderSubscription();
  });

  // 支払方法の変更・解約はStripeのカスタマーポータルで行う
  $('#portal-link').addEventListener('click', async () => {
    toast(t('license.checking'));
    const url = await subscription.portalUrl();
    if (url) window.open(url, '_blank', 'noopener');
    else { feedbackError(); toast(t('license.needOnline'), 5000); }
  });

  $('#copy-license').addEventListener('click', async () => {
    const code = $('#out-license').value;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast(t('license.copied'));
    } catch {
      // クリップボードが使えない環境では選択状態にして手動コピーしてもらう
      $('#out-license').select();
      toast(t('license.copyManual'), 5000);
    }
  });

  $('#drive-connect').addEventListener('click', async () => {
    const res = await backup.connect();
    if (res.ok) await backup.runBackup({ force: true });
    renderBackupStatus();
  });
  $('#drive-now').addEventListener('click', async () => {
    const res = await backup.runBackup({ force: true });
    toast(res.ok ? t('common.ok') : t('backup.never'));
    renderBackupStatus();
  });

  // 通信状態の表示更新
  const updateNet = () => {
    const online = String(navigator.onLine);
    $('#net-badge').dataset.online = online;
    $('#meta-net').dataset.online = online;   // 計測中はアプリバーを隠しているため
    updateVoiceButton();
  };
  window.addEventListener('online', () => {
    updateNet();
    syncOffice({ force: true });
    subscription.revalidate().then(renderSubscription);
    checkForUpdate();
  });
  window.addEventListener('offline', updateNet);
  updateNet();

  // アプリを開き直した／他アプリから戻ってきたときに最新かどうか確かめる。
  // 山でスマホだけで直すとき、これがあると「開き直すだけ」で反映される。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { checkForUpdate(); syncOffice(); }
  });

  $('#update-btn').addEventListener('click', async () => {
    toast(t('update.checking'));
    await updater.forceReload();
  });

  window.addEventListener('resize', () => { if (state.screen === 'measure') autoSizeCards(); });
  watchGridSize();
}

/* ==================================================================
 * 起動
 * ================================================================== */
async function boot() {
  await loadSettings();
  state.feed = state.settings.office ? await officeSync.getFeed() : null;   // 圏外でも、最後に受け取った事務所の情報で始める
  await renderLists();
  await fillSelects();
  await renderPresets();
  wireEvents();
  setupVoice();
  initWakeLockAutoRenew(() => state.screen === 'measure');
  backup.initAutoSync();

  // 中断した計測があれば復帰する（ページ再読み込み・アプリ終了でも消えない）
  const saved = await db.kvGet('draft', null);
  const draft = saved ? normalizeTicket(saved) : null;   // 便機能より前の下書きも、そのまま続きから読める
  if (draft?.lots?.length && draft.lots[0].species) {
    state.draft = draft;
    const lot = curLot();
    state.setup.minD = lot.minD;
    state.setup.maxD = lot.maxD;
    startMeasure(null, { resume: true });
  } else {
    renderRange();
  }

  syncOffice();                       // 待たない。通信できれば事務所と同期する
  setInterval(renderOfficeInfo, 60_000);   // 時間の経過で、お知らせの期限や荷下ろしできる時間が変わるため

  await handleCheckoutReturn();
  checkForUpdate().then(renderVersion);
  await renderSubscription();
  subscription.revalidate().then(() => renderSubscription());

  // 保存できない環境なら、黙って動くのではなくはっきり伝える
  if (db.isMemoryMode()) toast(t('storage.memoryWarn'), 6000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
