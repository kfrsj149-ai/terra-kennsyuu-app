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
import { totalsOf, aggregate, buildCsv, shareCsv } from './csv.js';
import { feedbackAdd, feedbackUndo, feedbackError, beep, vibrate, requestWakeLock, releaseWakeLock, initWakeLockAutoRenew } from './feedback.js';
import { VoiceInput, isVoiceSupported, isVoiceAvailable } from './voice.js';
import * as subscription from './subscription.js';
import * as backup from './backup.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const LIST_KINDS = ['company', 'truck', 'site', 'destination'];
const LONG_PRESS_MS = 2000; // 誤操作対策：-1 は2秒長押し

/** アプリ全体の状態 */
const state = {
  screen: 'setup',
  settings: { locale: 'ja', side: 'left', voiceConsent: false },
  setup: { minD: 14, maxD: 30 },
  /** 計測中の伝票（入力の都度 IndexedDB に保存される） */
  draft: null,
  diameters: [],
  voice: null,
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

function showScreen(name) {
  state.screen = name;
  $$('.screen').forEach((el) => el.classList.toggle('is-active', el.id === `screen-${name}`));
  if (name === 'measure') requestWakeLock();
  else releaseWakeLock();
}

/* ==================================================================
 * 設定の読み書き
 * ================================================================== */
async function loadSettings() {
  const saved = await db.kvGet('settings', null);
  state.settings = {
    locale: saved?.locale ?? detectLocale(),
    side: saved?.side ?? 'left',
    voiceConsent: saved?.voiceConsent ?? false,
  };
  await applySettings();
}

async function applySettings() {
  setLocale(state.settings.locale);
  document.body.dataset.side = state.settings.side;
  applyTranslations();
  $('#sel-language').value = state.settings.locale;
  $$('#seg-side button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.side === state.settings.side)));
  $('#voice-consent').checked = state.settings.voiceConsent;
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
    const items = await db.listOptions(kind);
    el.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = items.length ? t('common.select') : t('common.none');
    el.appendChild(blank);
    for (const item of items) {
      const opt = document.createElement('option');
      opt.value = item.value;
      opt.textContent = item.value;
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
  $('#buy-link').href = CONFIG.lemonSqueezy.checkoutUrl || CONFIG.lemonSqueezy.portalUrl;
  $('#portal-link').href = CONFIG.lemonSqueezy.portalUrl;
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

/* ==================================================================
 * 画面3：計測入力
 * ================================================================== */
function startMeasure(setup, { resume = false } = {}) {
  if (!resume) {
    state.draft = {
      id: uid(),
      createdAt: Date.now(),
      dateStr: todayStr(),
      ticketNo: null,
      ...setup,
      entries: [],
      syncState: 'pending',
    };
  }
  state.diameters = diameterRange(state.draft.minD, state.draft.maxD);
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
function autoSizeCards() {
  const wrap = $('#grid-wrap');
  const grid = $('#grid');
  const n = state.diameters.length;
  if (n === 0) return;
  const cols = Number(getComputedStyle(document.documentElement).getPropertyValue('--grid-cols')) || 2;
  const rows = Math.ceil(n / cols);
  const avail = wrap.clientHeight - 16;
  const gap = 6;
  const ideal = Math.floor((avail - gap * (rows - 1)) / rows);
  // 上限はカード幅（＝正方形）まで。それ以上伸ばしても押しやすくならず間延びする
  const cardWidth = grid.firstElementChild?.getBoundingClientRect().width ?? 160;
  const h = Math.max(72, Math.min(Math.round(cardWidth), ideal));
  document.documentElement.style.setProperty('--card-h', `${h}px`);
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
  state.draft.entries.push({ id: uid(), ts: Date.now(), d, source, cancelled: false });
  const card = $(`.dia-card[data-d="${d}"]`);
  feedbackAdd(card);
  renderMeasure();
  persistDraft();
}

/** 指定径級の最後の有効な入力を取消す（履歴からは消さない） */
function cancelOne(d) {
  if (!state.draft) return;
  for (let i = state.draft.entries.length - 1; i >= 0; i--) {
    const e = state.draft.entries[i];
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
  return state.draft.entries.filter((e) => e.d === d && !e.cancelled).length;
}

/**
 * その径級の本数を指定の数にそろえる。
 * 増やすぶんは入力を追加し、減らすぶんは新しい方から取消として印を付ける。
 * こうすることで履歴・取消の扱いがタップ入力とまったく同じになる。
 */
function setCount(d, target) {
  const draft = state.draft;
  const current = countOf(d);
  if (target === current) return;
  if (target > current) {
    for (let i = current; i < target; i++) {
      draft.entries.push({ id: uid(), ts: Date.now(), d, source: 'manual', cancelled: false });
    }
  } else {
    let remove = current - target;
    for (let i = draft.entries.length - 1; i >= 0 && remove > 0; i--) {
      const e = draft.entries[i];
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
  for (let i = state.draft.entries.length - 1; i >= 0; i--) {
    const e = state.draft.entries[i];
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

  $('#meta-line').textContent = `${draft.species} / ${formatLength(toHundredths(draft.lengthM))}m / ${draft.minD}-${draft.maxD}cm`;

  // 径級ごとの本数と小計材積（リアルタイム、小数第4位切り捨て）
  const counts = new Map();
  for (const e of draft.entries) {
    if (e.cancelled) continue;
    counts.set(e.d, (counts.get(e.d) ?? 0) + 1);
  }
  for (const card of $$('.dia-card')) {
    const d = Number(card.dataset.d);
    const n = counts.get(d) ?? 0;
    card.dataset.hasCount = String(n > 0);
    card.querySelector('[data-role="n"]').innerHTML = `${n}<small>${t('measure.unitCount')}</small>`;
  }

  const { count, volume } = totalsOf(draft.entries, draft.lengthM);
  $('#total-count').textContent = String(count);
  $('#total-volume').textContent = formatVolume(volume);

  renderHistory();
  updateVoiceButton();
}

/** 入力履歴（取消済みも消さずに残す） */
function renderHistory() {
  const box = $('#history');
  // 1行しか見せないので、描画するのも直近ぶんだけでよい（数百本入力しても重くならない）
  const entries = state.draft.entries.slice(-40);
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
  const { rows, totalCount, totalVolume } = aggregate(draft);
  if (totalCount === 0) {
    feedbackError();
    toast(t('output.empty'));
    return;
  }
  const table = $('#output-summary');
  table.innerHTML = `
    <tr><th>${t('csv.date')}</th><td>${draft.dateStr}</td></tr>
    <tr><th>${t('setup.species')}</th><td>${draft.species}</td></tr>
    <tr><th>${t('setup.length')}</th><td>${formatLength(toHundredths(draft.lengthM))} m</td></tr>
    <tr><th>${t('setup.range')}</th><td>${draft.minD}-${draft.maxD} cm</td></tr>
    <tr><th>${t('measure.count')}</th><td><b>${totalCount}</b> ${t('measure.unitCount')}</td></tr>
    <tr><th>${t('measure.volume')}</th><td><b>${formatVolume(totalVolume)}</b> m³</td></tr>`;

  // 工場の手書き伝票へ書き写すための明細。径級・単材積・本数・小計材積を並べる
  $('#output-detail').innerHTML = `
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
    </tr></tfoot>`;
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
  for (const ticket of tickets) {
    const { totalCount, totalVolume } = aggregate(ticket);
    const el = document.createElement('div');
    el.className = 'ticket';
    const icon = ticket.syncState === 'synced' ? '✅' : '☁️';
    const syncLabel = ticket.syncState === 'synced' ? t('history.synced') : t('history.pending');
    el.innerHTML = `
      <div class="head"><span>${ticket.dateStr} No.${ticket.ticketNo}</span><span>${icon}</span></div>
      <div class="sub">${ticket.species} / ${formatLength(toHundredths(ticket.lengthM))}m / ${ticket.minD}-${ticket.maxD}cm</div>
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
async function renderSubscription() {
  const result = await subscription.evaluate();
  const el = $('#sub-status');
  const banner = $('#sub-banner');
  const dateOf = (ms) => (ms ? new Date(ms).toLocaleDateString() : '-');

  let text;
  switch (result.reason) {
    case 'active':
      text = t('license.valid', { date: dateOf(result.state.expiresAt) });
      break;
    case 'grace':
      text = `${t('license.valid', { date: dateOf(result.state.expiresAt) })} / ${t('license.offlineNote', { days: result.graceDaysLeft })}`;
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

  // 直前取消（長押しで径級ごとの取消）
  const undoBtn = $('#undo-btn');
  let undoTimer = null;
  let undoLong = false;
  undoBtn.addEventListener('pointerdown', () => {
    undoLong = false;
    undoTimer = setTimeout(() => { undoLong = true; openCancelPick(); }, 700);
  });
  const clearUndo = () => { clearTimeout(undoTimer); undoTimer = null; };
  undoBtn.addEventListener('pointerup', () => {
    const wasLong = undoLong;
    clearUndo();
    if (!wasLong) undoLast();
  });
  undoBtn.addEventListener('pointerleave', clearUndo);
  undoBtn.addEventListener('pointercancel', clearUndo);

  $('#cancel-pick-close').addEventListener('click', () => $('#dlg-cancel-pick').close());

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
    const key = $('#in-license').value.trim();
    if (!key) return;
    const res = await subscription.activate(key);
    toast(res.ok ? t('license.valid', { date: '' }) : t('license.invalid'));
    $('#in-license').value = '';
    renderSubscription();
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
    $('#net-badge').dataset.online = String(navigator.onLine);
    updateVoiceButton();
  };
  window.addEventListener('online', () => { updateNet(); subscription.revalidate().then(renderSubscription); });
  window.addEventListener('offline', updateNet);
  updateNet();

  window.addEventListener('resize', () => { if (state.screen === 'measure') autoSizeCards(); });
}

function openCancelPick() {
  const counts = new Map();
  for (const e of state.draft?.entries ?? []) {
    if (!e.cancelled) counts.set(e.d, (counts.get(e.d) ?? 0) + 1);
  }
  const box = $('#cancel-pick-list');
  box.innerHTML = '';
  if (counts.size === 0) {
    feedbackError();
    toast(t('measure.nothingToCancel'));
    return;
  }
  for (const d of [...counts.keys()].sort((a, b) => a - b)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `${d}cm<br><small>${counts.get(d)}${t('measure.unitCount')}</small>`;
    btn.addEventListener('click', () => {
      cancelOne(d);
      $('#dlg-cancel-pick').close();
    });
    box.appendChild(btn);
  }
  $('#dlg-cancel-pick').showModal();
}

/* ==================================================================
 * 起動
 * ================================================================== */
async function boot() {
  await loadSettings();
  await renderLists();
  await fillSelects();
  await renderPresets();
  wireEvents();
  setupVoice();
  initWakeLockAutoRenew(() => state.screen === 'measure');
  backup.initAutoSync();

  // 中断した計測があれば復帰する（ページ再読み込み・アプリ終了でも消えない）
  const draft = await db.kvGet('draft', null);
  if (draft?.entries?.length >= 0 && draft.species) {
    state.draft = draft;
    state.setup.minD = draft.minD;
    state.setup.maxD = draft.maxD;
    startMeasure(null, { resume: true });
  } else {
    renderRange();
  }

  await renderSubscription();
  subscription.revalidate().then(() => renderSubscription());

  // 保存できない環境なら、黙って動くのではなくはっきり伝える
  if (db.isMemoryMode()) toast(t('storage.memoryWarn'), 6000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
