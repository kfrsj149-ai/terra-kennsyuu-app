/**
 * TERRA 事務所端末（PC向け。スマホでも開ける）
 * ------------------------------------------------------------------
 * 現場アプリから届いた便を見る・納入枠とお知らせを現場に送る・現場の台帳を管理する。
 * 事務員は「クリックだけ」で使える前提で、コマンドや専門用語は一切出さない。
 *
 * 画面に出す文字は、すべて textContent / createTextNode 経由（HTML文字列を組み立てない）。
 * 現場名や備考は利用者が自由に入力するため、HTMLとして解釈されないようにしている。
 */
import { formatVolume, formatLength, toHundredths } from '../src/js/jas.js';
import {
  windowStatus, noticeState, blocksUnloading, findSiteByName, nameKey, normalizeName, parseM3, dateKey, csvCell, CONSENT_VERSION,
} from '../src/js/office-rules.js';

const STORE_KEY = 'terra-office';
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

const state = {
  token: '', code: '',
  tab: 'tickets',
  filter: { from: '', to: '' },
  tickets: [], hasMore: false,
  quotas: null, usage: {},
  notices: null,
  sites: null, unlinked: [],
  masters: null,
  diff: null, diffFilter: null,
  inbox: null,
};

/* ==================================================================
 * 小物
 * ================================================================== */
const $ = (sel) => document.querySelector(sel);

/** 要素を作る。on* はイベント、class/dataset/value は専用処理、それ以外は属性 */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

let toastTimer = null;
function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', isErr);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), isErr ? 5000 : 2200);
}

/**
 * 本体エリアを入れ替える。配列・null・false が混じっていても安全に並べる。
 * 通信が終わるのを待っている間に別のタブへ移ったとき、遅れて返ってきた結果が
 * いまのタブの表示を上書きしないよう、「自分のタブが開いているときだけ」描く。
 */
const setView = (tab, ...kids) => {
  if (state.tab !== tab) return;
  $('#view').replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
};

/** 画面が狭い（スマホ・タブレット縦）か。狭いときは、列の多い表をカード表示にする */
const NARROW = '(max-width: 860px)';
const narrow = () => window.matchMedia(NARROW).matches;

const fmtVol = (num) => formatVolume(BigInt(num ?? 0));
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDay = (ds) => { const d = new Date(`${ds}T00:00`); return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`; };
const fmtDateTime = (d) => `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]}) ${d.getHours()}:${pad2(d.getMinutes())}`;
const today = () => dateKey(new Date());
const localNow = () => { const d = new Date(); return `${dateKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const spaced = (id) => `${id.slice(0, 4)}-${id.slice(4)}`;

/* ---------------- 通信 ---------------- */
class ApiError extends Error {
  constructor(code, info = {}) { super(code); this.code = code; this.info = info; }
}

async function api(op, args = {}, { as = 'office' } = {}) {
  const body = { op, ...args };
  if (as === 'office') body.token = state.token;
  let res;
  try {
    res = await fetch('/api/office', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError('offline');
  }
  const json = await res.json().catch(() => ({ ok: false, error: 'server_error' }));
  if (res.status === 401 && as === 'office') {
    logout('ログインの有効期限が切れました。もう一度ログインしてください。');
    throw new ApiError('unauthorized');
  }
  if (!json.ok) throw new ApiError(json.error ?? 'server_error', json);
  return json;
}

const FIELD_NAMES = {
  amount: '数量', from: '開始日', to: '終了日', destination: '工場名', species: '樹種', timeFrom: '開始時刻', timeTo: '終了時刻',
  weekdays: '曜日', body: '本文', kind: '種類', name: '現場名', aliases: '別名', image: '写真', volume: '工場の検収材積',
  'attrs.rinban': '林班', 'attrs.address': '住所', 'attrs.note': '備考', note: '備考', place: '土場', title: '題名', imageId: '写真',
};

function explain(e) {
  if (!(e instanceof ApiError)) return '予期しないエラーが起きました。';
  const field = FIELD_NAMES[e.info?.field] ?? e.info?.field ?? '入力';
  switch (e.code) {
    case 'offline': return '通信できません。電波のある場所でやり直してください。';
    case 'not_configured': return 'データの保存先がまだ設定されていません。設定手順書の「保存先を足す」を行ってください。';
    case 'office_not_set_up': return 'この契約では、事務所の初期設定がまだ行われていません。「はじめて使う」から設定してください。';
    case 'already_setup': return 'この契約は、すでに事務所の初期設定が済んでいます。事務所コードでログインしてください。';
    case 'invalid_code': return 'ライセンスコードが正しくありません。コピーし直してください。';
    case 'bad_office_code': return `事務所コードが違います（あと${e.info.triesLeft}回でロックされます）。`;
    case 'locked': return '間違いが続いたため、15分間ログインできません。事務所コードをなくした場合は、メールアドレスでの復旧もお試しください。';
    case 'subscription_inactive': return 'サブスクリプションが有効ではありません。';
    case 'subscription_unverified': return '契約の状態を確認できませんでした。少し待ってからやり直してください。';
    case 'license_in_use': return 'そのライセンスコードは、別の事業体につながっています。';
    case 'name_taken': return `その名前は、すでに現場「${e.info.with?.name ?? ''}」として登録されています（名前・別名のどちらかが同じです）。`;
    case 'too_long': return `${field}が長すぎます。`;
    case 'too_large': return '大きすぎて受け付けられません。';
    case 'bad_email': return `メールアドレスが、購入時に登録されたものと違います（あと${e.info.triesLeft}回でロックされます）。`;
    case 'no_email': return '購入時のメールアドレスを確認できませんでした。サポートへご連絡ください。';
    case 'consent_required': return 'データの取り扱いへの同意が必要です。';
    case 'rate_limited': return '短い時間にたくさん送られたため、少し待ってからやり直してください。';
    case 'limit_reached': return e.info?.max ? `これ以上は登録できません（1種類あたり${e.info.max}件まで）。使わないものは「使わない」にしても数に含まれます。` : '保存できる便の数の上限に達しました。古い便を削除してください。';
    case 'master_name_taken': return `その名前は、すでに${MASTER_LABEL[e.info.kind] ?? ''}「${e.info.with?.name ?? ''}」として登録されています（名前・別名のどちらかが同じです）。`;
    case 'in_use': return '枠かお知らせで使っている写真は消せません。';
    case 'not_found': return '見つかりませんでした。画面を開き直してください。';
    case 'invalid': return `${field}の入力を確認してください。`;
    default: return '失敗しました。少し待ってからやり直してください。';
  }
}

async function guard(fn) {
  try { return await fn(); } catch (e) { if (!(e instanceof ApiError && e.code === 'unauthorized')) toast(explain(e), true); return undefined; }
}

/* ---------------- ログインの保存 ---------------- */
function saveLogin() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ token: state.token, code: state.code })); } catch { /* 保存できなくても動く */ }
}
function loadLogin() {
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null'); if (v?.token) { state.token = v.token; state.code = v.code ?? ''; } } catch { /* 無視 */ }
}
function logout(message = '') {
  state.token = ''; state.quotas = null; state.notices = null; state.sites = null; state.masters = null; state.diff = null; state.diffFilter = null; state.inbox = null; state.tickets = [];
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ token: '', code: state.code })); } catch { /* 無視 */ }
  showLogin(message);
}

/* ==================================================================
 * 汎用ダイアログ
 * ================================================================== */
/**
 * @param {string} title
 * @param {Node[]} body
 * @param {{ok?:string, cancel?:string|null, onOk?:()=>Promise<boolean|void>}} opts
 *   onOk が false を返す・例外を投げると閉じない（例外はダイアログ内に表示）
 */
function dialog(title, body, { ok = '保存', cancel = 'キャンセル', onOk } = {}) {
  const err = h('p', { class: 'dlg-error', role: 'alert' });
  const okBtn = h('button', { type: 'submit', class: 'btn primary' }, ok);
  const dlg = h('dialog', {},
    h('form', { method: 'dialog' },
      h('div', { class: 'dlg-head' }, title),
      h('div', { class: 'dlg-body stack' }, body),
      err,
      h('div', { class: 'dlg-foot' },
        cancel ? h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, cancel) : null,
        okBtn)));
  dlg.querySelector('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!onOk) { dlg.close(); return; }
    okBtn.disabled = true; err.textContent = '';
    try {
      const keep = await onOk();
      if (keep !== false) dlg.close();
    } catch (e) {
      err.textContent = explain(e);
    } finally {
      okBtn.disabled = false;
    }
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function confirmDialog(message, okLabel = '実行する') {
  return new Promise((resolve) => {
    const dlg = dialog('確認', [h('p', {}, message)], { ok: okLabel, cancel: 'やめる', onOk: async () => { resolve(true); } });
    dlg.addEventListener('close', () => resolve(false));
  });
}

/* ==================================================================
 * 写真（スマホで撮ったFAXなど）
 * ================================================================== */
/** 大きな写真は端末内で縮めてから送る（通信量とサーバー容量を抑える） */
async function compressImage(file) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new ApiError('invalid', { field: 'image' });
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let quality = 0.78;
  let url = canvas.toDataURL('image/jpeg', quality);
  while (url.length > 650_000 && quality > 0.3) {
    quality -= 0.1;
    url = canvas.toDataURL('image/jpeg', quality);
  }
  return url;
}

const imageCache = new Map();
async function loadImage(id) {
  if (imageCache.has(id)) return imageCache.get(id);
  const { image } = await api('image.get', { id });
  imageCache.set(id, image);
  return image;
}

function viewImage(id) {
  const img = h('img', { class: 'viewer', alt: '' });
  dialog('写真', [img], { ok: '閉じる', cancel: null });
  guard(async () => { img.src = await loadImage(id); });
}

/** 写真の選択欄（新しく選ぶ／受信箱から選ぶ）。get() で選ばれたIDを返す */
function imagePicker(initialId) {
  let current = initialId ?? '';
  const status = h('span', { class: 'muted' }, current ? '写真が付いています' : '写真なし');
  const select = h('select', {}, h('option', { value: '' }, '受信箱から選ぶ…'));
  const refresh = async () => {
    await ensureInbox();
    for (const it of state.inbox) {
      select.append(h('option', { value: it.id }, `${fmtDateTime(new Date(it.createdAt))} ${it.caption}`.trim()));
    }
    select.value = state.inbox.some((i) => i.id === current) ? current : '';
  };
  guard(refresh);
  select.addEventListener('change', () => { current = select.value; status.textContent = current ? '写真が付いています' : '写真なし'; });
  const file = h('input', { type: 'file', accept: 'image/*', onchange: async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    status.textContent = '送信中…';
    await guard(async () => {
      const image = await compressImage(f);
      const { item } = await api('inbox.put', { image, caption: '' });
      state.inbox = [item, ...(state.inbox ?? [])];
      select.append(h('option', { value: item.id }, `${fmtDateTime(new Date(item.createdAt))}`));
      select.value = item.id; current = item.id; status.textContent = '写真を付けました';
    });
    if (!current) status.textContent = '写真なし';
  } });
  const view = h('button', { type: 'button', class: 'btn sm', onclick: () => current && viewImage(current) }, '見る');
  const clear = h('button', { type: 'button', class: 'btn sm', onclick: () => { current = ''; select.value = ''; status.textContent = '写真なし'; } }, '外す');
  return {
    node: h('div', { class: 'stack' },
      h('label', {}, 'FAX・メールの写真（任意）', file),
      h('div', { class: 'row' }, select, view, clear, status)),
    get: () => current,
  };
}

/* ==================================================================
 * データの読み込み
 * ================================================================== */
async function loadTickets({ append = false } = {}) {
  const { from, to } = state.filter;
  const r = await api('ticket.list', { from: from || undefined, to: to || undefined, limit: 200, offset: append ? state.tickets.length : 0 });
  state.tickets = append ? [...state.tickets, ...r.tickets] : r.tickets;
  state.hasMore = r.hasMore;
}
const ensureQuotas = async (force = false) => { if (force || !state.quotas) { const r = await api('quota.list'); state.quotas = r.quotas; state.usage = r.usage; } };
const ensureNotices = async (force = false) => { if (force || !state.notices) state.notices = (await api('notice.list')).notices; };
const ensureSites = async (force = false) => {
  if (force || !state.sites) { const [a, b] = await Promise.all([api('site.list'), api('site.unlinked')]); state.sites = a.sites; state.unlinked = b.unlinked; }
};
const ensureMasters = async (force = false) => { if (force || !state.masters) state.masters = (await api('master.list')).masters; };
const ensureInbox = async (force = false) => { if (force || !state.inbox) state.inbox = (await api('inbox.list')).items; };

/** 候補（入力欄の予測変換）に使う工場名・樹種 */
function knownValues() {
  const dest = new Set(); const species = new Set();
  for (const t of state.tickets) { if (t.destination) dest.add(t.destination); for (const l of t.lots) species.add(l.species); }
  for (const q of state.quotas ?? []) { dest.add(q.destination); if (q.species) species.add(q.species); }
  for (const n of state.notices ?? []) if (n.destination) dest.add(n.destination);
  for (const m of state.masters?.destination ?? []) if (!m.closed) dest.add(m.name);
  for (const m of state.masters?.species ?? []) if (!m.closed) species.add(m.name);
  return { dest: [...dest], species: [...species] };
}
const datalist = (id, values) => h('datalist', { id }, values.map((v) => h('option', { value: v })));

/* ==================================================================
 * タブ：便
 * ================================================================== */
function ticketVolumes(t) {
  const ours = BigInt(t.totalVolNum);
  const factory = t.factoryNum != null ? BigInt(t.factoryNum) : null;
  return { ours, factory };
}

function groupSummary(tickets) {
  const dest = new Map();
  for (const t of tickets) {
    const dk = nameKey(t.destination) || '(未設定)';
    const d = dest.get(dk) ?? { name: t.destination || '(納入先なし)', count: 0, vol: 0n, species: new Map() };
    for (const l of t.lots) {
      const sk = nameKey(l.species);
      const s = d.species.get(sk) ?? { name: l.species, count: 0, vol: 0n };
      s.count += l.count; s.vol += BigInt(l.volNum);
      d.species.set(sk, s);
      d.count += l.count; d.vol += BigInt(l.volNum);
    }
    dest.set(dk, d);
  }
  return [...dest.values()].sort((a, b) => (a.vol < b.vol ? 1 : -1));
}

function csvOfTickets(tickets) {
  const head = ['日付', '伝票番号', '車番', '納入先', '現場', '樹種', '納入規格(cm)', '規格長(m)', '径級(cm)', '本数', '小計材積(m³)', '便の合計材積(m³)', '工場の検収材積(m³)', 'メモ'];
  const esc = csvCell;   // 先頭が = + - @ の文字は、Excelに数式として実行されないよう ' を付ける
  const lines = [head.map(esc).join(',')];
  for (const t of [...tickets].sort((a, b) => (a.dateStr + a.ticketNo < b.dateStr + b.ticketNo ? -1 : 1))) {
    for (const l of t.lots) {
      for (const r of l.rows) {
        if (r.n === 0) continue;
        lines.push([
          t.dateStr, t.ticketNo, t.truck, t.destination, l.site, l.species, `${l.minD}-${l.maxD}`, formatLength(toHundredths(l.lengthM)),
          r.d, r.n, formatVolume(BigInt(r.volNum)), fmtVol(t.totalVolNum), t.factoryNum != null ? fmtVol(t.factoryNum) : '', t.note,
        ].map(esc).join(','));
      }
    }
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

function download(name, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 読み込んでから描く */
async function renderTickets() {
  if (!state.filter.from) {
    const d = new Date();
    state.filter.from = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
    state.filter.to = today();
  }
  await Promise.all([loadTickets(), ensureSites().catch(() => {})]);
  drawTickets();
}

/** いま持っているデータだけで描く（通信しない） */
function drawTickets() {
  const sites = state.sites ?? [];
  const tickets = state.tickets;

  const totalCount = tickets.reduce((a, t) => a + t.totalCount, 0);
  const totalOurs = tickets.reduce((a, t) => a + BigInt(t.totalVolNum), 0n);
  const withFactory = tickets.filter((t) => t.factoryNum != null);
  const factoryOurs = withFactory.reduce((a, t) => a + BigInt(t.totalVolNum), 0n);
  const factoryVal = withFactory.reduce((a, t) => a + BigInt(t.factoryNum), 0n);
  const diff = factoryVal - factoryOurs;

  const fromIn = h('input', { type: 'date', value: state.filter.from });
  const toIn = h('input', { type: 'date', value: state.filter.to });
  const apply = () => { state.filter = { from: fromIn.value, to: toIn.value }; guard(renderTickets); };

  const summary = h('div', { class: 'card summary' },
    h('div', { class: 'big' },
      h('div', {}, h('b', {}, tickets.length), h('span', {}, '便')),
      h('div', {}, h('b', {}, totalCount.toLocaleString()), h('span', {}, '本')),
      h('div', {}, h('b', {}, fmtVol(totalOurs)), h('span', {}, 'm³（現場の検収値）')),
      withFactory.length ? h('div', {}, h('b', {}, fmtVol(factoryVal)), h('span', {},
        `m³（工場の検収値・${withFactory.length}便）　差 ${diff >= 0n ? '+' : '−'}${formatVolume(diff < 0n ? -diff : diff)}`)) : null),
    groupSummary(tickets).length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '納入先'), h('th', {}, '樹種'), h('th', { class: 'num' }, '本数'), h('th', { class: 'num' }, '材積 m³'))),
      h('tbody', {}, groupSummary(tickets).flatMap((d) => [
        h('tr', {}, h('td', {}, h('b', {}, d.name)), h('td', {}), h('td', { class: 'num' }, d.count), h('td', { class: 'num' }, h('b', {}, formatVolume(d.vol)))),
        ...[...d.species.values()].sort((a, b) => (a.vol < b.vol ? 1 : -1)).map((s) =>
          h('tr', {}, h('td', {}), h('td', {}, s.name), h('td', { class: 'num' }, s.count), h('td', { class: 'num' }, formatVolume(s.vol)))),
      ])))) : null);

  const lotsCell = (t) => t.lots.map((l) => {
    const linked = l.siteId || findSiteByName(sites, l.site);
    return h('div', { class: 'lot-line' },
      `${l.species} ${formatLength(toHundredths(l.lengthM))}m `, h('span', { class: 'muted' }, `${l.minD}-${l.maxD}cm`),
      l.site ? [' · ', l.site, linked ? null : h('span', { class: 'tag', title: '現場タブの「名寄せ」で台帳につなげられます' }, '未登録')] : null,
      h('span', { class: 'muted' }, ` · ${l.count}本 ${fmtVol(l.volNum)}m³`));
  });

  /** 1便ぶんの操作部品（表でもカードでも同じものを使う） */
  const partsOf = (t) => {
    const { ours, factory } = ticketVolumes(t);
    const input = h('input', {
      class: 'factory-input', type: 'text', inputmode: 'decimal', placeholder: '—', value: factory != null ? formatVolume(factory) : '',
      'aria-label': '工場の検収材積',
      onchange: () => guard(async () => {
        const r = await api('ticket.setFactory', { id: t.id, volume: input.value });
        Object.assign(t, r.ticket);
        state.quotas = null;
        drawTickets();
        toast(r.ticket.factoryNum != null ? '工場の検収値を保存しました' : '工場の検収値を消しました');
      }),
    });
    const d = factory != null ? factory - ours : null;
    const diff = d == null ? null : h('span', { class: d >= 0n ? 'diff-plus' : 'diff-minus' }, `${d >= 0n ? '+' : '−'}${formatVolume(d < 0n ? -d : d)}`);
    const del = h('button', { type: 'button', class: 'btn sm danger', onclick: async () => {
      if (!(await confirmDialog(`${fmtDay(t.dateStr)} No.${t.ticketNo}（${t.truck || '車番なし'}）を削除します。元に戻せません。`, '削除する'))) return;
      await guard(async () => { await api('ticket.delete', { id: t.id }); state.quotas = null; await renderTickets(); toast('削除しました'); });
    } }, '削除');
    return { ours, input, diff, del };
  };

  const rows = narrow() ? [] : tickets.map((t) => {
    const { ours, input, diff, del } = partsOf(t);
    return h('tr', {},
      h('td', {}, fmtDay(t.dateStr), h('br'), h('span', { class: 'muted' }, `No.${t.ticketNo}`)),
      h('td', {}, t.truck || '—'),
      h('td', {}, t.destination || '—', t.ownCompany ? h('div', { class: 'muted' }, t.ownCompany) : null),
      h('td', {}, lotsCell(t), t.note ? h('div', { class: 'muted' }, `備考：${t.note}`) : null),
      h('td', { class: 'num' }, t.totalCount),
      h('td', { class: 'num' }, h('b', {}, formatVolume(ours))),
      h('td', { class: 'num' }, input),
      h('td', { class: 'num' }, diff),
      h('td', {}, del));
  });

  /** スマホ・タブレット縦用。1便を1枚のカードにする */
  const cards = narrow() ? tickets.map((t) => {
    const { ours, input, diff, del } = partsOf(t);
    return h('div', { class: 'card ticket-card' },
      h('div', { class: 'tc-head' },
        h('div', {}, h('b', {}, fmtDay(t.dateStr)), h('span', { class: 'muted' }, `　No.${t.ticketNo}`)),
        del),
      h('div', { class: 'tc-route' }, h('b', {}, t.truck || '車番なし'), ' → ', t.destination || '納入先なし', t.ownCompany ? h('span', { class: 'muted' }, `（${t.ownCompany}）`) : null),
      h('div', { class: 'tc-lots' }, lotsCell(t)),
      t.note ? h('div', { class: 'muted' }, `備考：${t.note}`) : null,
      h('div', { class: 'tc-nums' },
        h('div', {}, h('span', { class: 'muted' }, '本数'), h('b', {}, t.totalCount)),
        h('div', {}, h('span', { class: 'muted' }, '現場の材積'), h('b', {}, `${formatVolume(ours)} m³`))),
      h('div', { class: 'tc-factory' }, h('label', {}, '工場の検収 m³', input), diff ? h('div', { class: 'tc-diff' }, h('span', { class: 'muted' }, '差'), diff) : null));
  }) : [];

  setView('tickets', 
    h('h2', {}, '現場から届いた便'),
    h('div', { class: 'toolbar' },
      h('label', {}, '期間（から）', fromIn), h('label', {}, '（まで）', toIn),
      h('button', { type: 'button', class: 'btn', onclick: apply }, '表示する'),
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'btn', disabled: !tickets.length, onclick: () => download(`terra-bin-${state.filter.from}_${state.filter.to}.csv`, csvOfTickets(tickets)) }, 'Excel用CSVをダウンロード')),
    tickets.length ? [summary,
      narrow()
        ? h('div', { class: 'ticket-cards' }, cards)
        : h('div', { class: 'table-wrap' }, h('table', { class: 'wide' },
          h('thead', {}, h('tr', {}, ['日付', '車番', '納入先', '積み荷'].map((x) => h('th', {}, x)),
            h('th', { class: 'num' }, '本数'), h('th', { class: 'num' }, '現場の材積 m³'), h('th', { class: 'num' }, '工場の検収 m³'), h('th', { class: 'num' }, '差'), h('th', {}))),
          h('tbody', {}, rows),
          h('tfoot', {}, h('tr', {}, h('td', { colspan: 4 }, '合計'), h('td', { class: 'num' }, totalCount.toLocaleString()), h('td', { class: 'num' }, formatVolume(totalOurs)), h('td', {}), h('td', {}), h('td', {}))))),
      state.hasMore ? h('p', {}, h('button', { type: 'button', class: 'btn', onclick: () => guard(async () => { await loadTickets({ append: true }); drawTickets(); }) }, 'さらに読み込む')) : null,
      h('p', { class: 'hint' }, '「工場の検収 m³」には、FAXや戻りの伝票に書かれた工場の値を入れます（入れると納入枠の消化は工場の値で数えます）。'),
    ] : h('div', { class: 'empty' },
      h('p', {}, 'この期間に届いた便はありません。'),
      h('p', { class: 'hint' }, '現場アプリのメニューで「事務所とデータを共有する」をオンにすると、出力した便が自動でここに届きます。')));
}


/* ==================================================================
 * タブ：納入枠
 * ================================================================== */
function weekdaysText(q) {
  if (!q.weekdays?.length || q.weekdays.length === 7) return '毎日';
  return q.weekdays.map((d) => WEEK[d]).join('・');
}
const timeText = (q) => (q.timeFrom || q.timeTo ? `${q.timeFrom || '0:00'}〜${q.timeTo || '24:00'}` : '終日');

function quotaCard(q) {
  const u = state.usage[q.id] ?? { confirmedNum: '0', estimatedNum: '0', confirmedTickets: 0, estimatedTickets: 0 };
  const amount = BigInt(q.amountNum);
  const confirmed = BigInt(u.confirmedNum);
  const estimated = BigInt(u.estimatedNum);
  const remain = amount - confirmed - estimated;
  const over = remain < 0n;
  const pct = (n) => Math.min(100, Number((n * 10000n) / (amount || 1n)) / 100);
  const win = windowStatus(q, new Date());
  const winText = win.open ? '今は荷下ろしできます'
    : `いまは時間外です${win.nextOpenAt ? `（次は ${fmtDateTime(win.nextOpenAt)} から）` : ''}`;

  return h('div', { class: 'card quota' },
    h('h3', {}, q.destination, q.species ? h('span', { class: 'muted' }, `　${q.species}`) : null,
      q.status === 'archived' ? h('span', { class: 'tag gray' }, '完了') : null),
    h('div', { class: 'muted' }, `${fmtDay(q.from)} 〜 ${fmtDay(q.to)}　${weekdaysText(q)}　${timeText(q)}`),
    h('div', { class: `remain${over ? ' over' : ''}` }, over ? `超過 ${formatVolume(-remain)} m³` : `あと ${formatVolume(remain)} m³`),
    h('div', { class: `bar${over ? ' over' : ''}` },
      h('i', { class: 'confirmed', style: `width:${pct(confirmed)}%` }),
      h('i', { class: 'estimated', style: `width:${Math.min(pct(estimated), 100 - pct(confirmed))}%` })),
    h('div', { class: 'muted' },
      `枠 ${q.amount} m³　／　確定 ${formatVolume(confirmed)}（工場の値・${u.confirmedTickets}便）＋ 見込み ${formatVolume(estimated)}（現場の値・${u.estimatedTickets}便）`),
    u.truncated ? h('div', { class: 'error' }, '⚠ 便が多すぎて、一部が集計に含まれていません。期間を短く区切ってください。') : null,
    q.status === 'active' ? h('div', { class: `window ${win.open ? 'open' : 'shut'}` }, win.open ? '● ' : '○ ', winText) : null,
    q.note ? h('p', {}, q.note) : null,
    h('div', { class: 'card-actions' },
      q.imageId ? h('button', { type: 'button', class: 'btn sm', onclick: () => viewImage(q.imageId) }, '📎 FAXの写真') : null,
      h('button', { type: 'button', class: 'btn sm', onclick: () => quotaDialog(q) }, '修正'),
      h('button', { type: 'button', class: 'btn sm', onclick: () => guard(async () => {
        await api('quota.put', { quota: { ...q, status: q.status === 'active' ? 'archived' : 'active' } });
        await renderQuotas(true);
      }) }, q.status === 'active' ? '完了にする' : '再開する'),
      h('button', { type: 'button', class: 'btn sm danger', onclick: async () => {
        if (!(await confirmDialog(`「${q.destination}」の枠を削除します。元に戻せません。`, '削除する'))) return;
        await guard(async () => { await api('quota.delete', { id: q.id }); await renderQuotas(true); });
      } }, '削除')));
}

async function renderQuotas(force = false) {
  await Promise.all([ensureQuotas(force), ensureNotices(), ensureMasters().catch(() => {}), state.tickets.length ? null : loadTickets()]);
  const active = state.quotas.filter((q) => q.status === 'active');
  const archived = state.quotas.filter((q) => q.status !== 'active');
  setView('quotas', 
    h('h2', {}, '納入枠'),
    h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => quotaDialog() }, '＋ 枠を追加'),
      h('span', { class: 'hint' }, '組合や工場からFAXで届く「納入可能枠」を入れます。現場の運転手の画面にも、残りと荷下ろしできる時間が出ます。')),
    active.length ? h('div', { class: 'cards' }, active.map(quotaCard)) : h('div', { class: 'empty' }, '登録された枠はありません。'),
    archived.length ? [h('h3', {}, '完了した枠'), h('div', { class: 'cards' }, archived.map(quotaCard))] : null);
}

function quotaDialog(existing) {
  const q = existing ?? { destination: '', species: '', amount: '', from: today(), to: '', weekdays: [], timeFrom: '', timeTo: '', note: '', imageId: '', status: 'active' };
  const { dest, species } = knownValues();
  const f = {
    destination: h('input', { type: 'text', list: 'dl-dest', value: q.destination, required: true, autocomplete: 'off' }),
    species: h('input', { type: 'text', list: 'dl-species', value: q.species, autocomplete: 'off', placeholder: '空欄なら全樹種' }),
    amount: h('input', { type: 'text', inputmode: 'decimal', value: q.amount, required: true, placeholder: '例：400' }),
    from: h('input', { type: 'date', value: q.from, required: true }),
    to: h('input', { type: 'date', value: q.to, required: true }),
    timeFrom: h('input', { type: 'time', value: q.timeFrom }),
    timeTo: h('input', { type: 'time', value: q.timeTo }),
    note: h('textarea', { rows: 3 }, q.note),
  };
  const days = WEEK.map((w, i) => h('label', {}, h('input', { type: 'checkbox', value: i, checked: q.weekdays.includes(i) }), w));
  const setDays = (list) => days.forEach((l, i) => { l.firstChild.checked = list.includes(i); });
  const pic = imagePicker(q.imageId);

  dialog(existing ? '納入枠を修正' : '納入枠を追加', [
    datalist('dl-dest', dest), datalist('dl-species', species),
    h('label', {}, '工場名', f.destination),
    h('p', { class: 'hint' }, '現場アプリの「納入先」と同じ名前で入れると、納めた量が自動で引かれます（空白や全角・半角の違いは吸収します）。'),
    h('div', { class: 'grid2' }, h('label', {}, '樹種（任意）', f.species), h('label', {}, '納入可能枠（m³）', f.amount)),
    h('div', { class: 'grid2' }, h('label', {}, '期間（から）', f.from), h('label', {}, '（まで）', f.to)),
    h('div', {}, h('label', {}, '納入できる曜日（選ばなければ毎日）'),
      h('div', { class: 'checks' }, days),
      h('div', { class: 'row', style: 'margin-top:6px' },
        h('button', { type: 'button', class: 'btn sm', onclick: () => setDays([1, 2, 3, 4, 5]) }, '平日'),
        h('button', { type: 'button', class: 'btn sm', onclick: () => setDays([]) }, 'クリア'))),
    h('div', { class: 'grid2' }, h('label', {}, '時間帯（から）', f.timeFrom), h('label', {}, '（まで）', f.timeTo)),
    h('p', { class: 'hint' }, '空欄なら終日です。'),
    h('label', {}, '備考（任意）', f.note),
    pic.node,
  ], {
    onOk: async () => {
      const quota = {
        ...(existing ? { id: existing.id } : {}),
        destination: normalizeName(f.destination.value), species: normalizeName(f.species.value), amount: f.amount.value,
        from: f.from.value, to: f.to.value, timeFrom: f.timeFrom.value, timeTo: f.timeTo.value, note: f.note.value,
        weekdays: days.filter((l) => l.firstChild.checked).map((l) => Number(l.firstChild.value)),
        imageId: pic.get(), status: q.status,
      };
      if (parseM3(quota.amount) === null) { const e = new ApiError('invalid', { field: 'amount' }); throw e; }
      await api('quota.put', { quota });
      await renderQuotas(true);
      toast('保存しました');
    },
  });
}

/* ==================================================================
 * タブ：お知らせ
 * ================================================================== */
const KIND = {
  closed: { label: '納入不可', cls: 'red' },
  restricted: { label: '入場制限', cls: 'orange' },
  info: { label: '案内', cls: 'blue' },
};

const periodText = (n) => {
  const part = (s, edge) => (s ? (s.length === 10 ? fmtDay(s) : fmtDateTime(new Date(s))) : edge);
  return `${part(n.from, '今から')} 〜 ${part(n.to, '手で消すまで')}`;
};

function noticeCard(n) {
  const st = noticeState(n, new Date());
  const kind = KIND[n.kind];
  return h('div', { class: `card notice ${n.kind}` },
    h('div', { class: 'row' },
      h('span', { class: `tag ${kind.cls}` }, kind.label),
      h('b', {}, n.destination || '全工場'), n.place ? h('span', {}, `／${n.place}`) : null,
      st === 'upcoming' ? h('span', { class: 'tag gray' }, '予告') : null,
      st === 'expired' ? h('span', { class: 'tag gray' }, '終了') : null),
    n.title ? h('b', {}, n.title) : null,
    h('div', { class: 'body' }, n.body),
    h('div', { class: 'muted' }, periodText(n)),
    h('div', { class: 'card-actions' },
      n.imageId ? h('button', { type: 'button', class: 'btn sm', onclick: () => viewImage(n.imageId) }, '📎 写真') : null,
      h('button', { type: 'button', class: 'btn sm', onclick: () => noticeDialog(n) }, '修正'),
      st !== 'expired' ? h('button', { type: 'button', class: 'btn sm', onclick: () => guard(async () => {
        await api('notice.put', { notice: { ...n, to: localNow() } });
        await renderNotices(true); toast('終了にしました');
      }) }, '今すぐ終了') : null,
      h('button', { type: 'button', class: 'btn sm danger', onclick: async () => {
        if (!(await confirmDialog('このお知らせを削除します。元に戻せません。', '削除する'))) return;
        await guard(async () => { await api('notice.delete', { id: n.id }); await renderNotices(true); });
      } }, '削除')));
}

async function renderNotices(force = false) {
  await Promise.all([ensureNotices(force), ensureQuotas(), state.tickets.length ? null : loadTickets()]);
  const groups = { active: [], upcoming: [], expired: [] };
  for (const n of state.notices) groups[noticeState(n, new Date())].push(n);
  setView('notices', 
    h('h2', {}, 'お知らせ'),
    h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => noticeDialog() }, '＋ お知らせを出す'),
      h('span', { class: 'hint' }, '「明日は納入できません」「工事のため第1土場に入れません」など。現場の画面の一番上に赤い帯で出ます。期限が来ると自動で消えます。')),
    groups.active.length ? h('div', { class: 'cards' }, groups.active.map(noticeCard)) : h('div', { class: 'empty' }, '掲示中のお知らせはありません。'),
    groups.upcoming.length ? [h('h3', {}, '予告（まだ始まっていません）'), h('div', { class: 'cards' }, groups.upcoming.map(noticeCard))] : null,
    groups.expired.length ? h('details', {}, h('summary', {}, `終了したお知らせ（${groups.expired.length}件）`), h('div', { class: 'cards', style: 'margin-top:8px' }, groups.expired.map(noticeCard))) : null);
}

function noticeDialog(existing) {
  const n = existing ?? { kind: 'closed', destination: '', place: '', title: '', body: '', from: localNow(), to: '', imageId: '' };
  const { dest } = knownValues();
  const kindRadios = Object.entries(KIND).map(([k, v]) => h('label', {}, h('input', { type: 'radio', name: 'kind', value: k, checked: n.kind === k }), v.label));
  const f = {
    destination: h('input', { type: 'text', list: 'dl-dest', value: n.destination, autocomplete: 'off', placeholder: '空欄なら全工場' }),
    place: h('input', { type: 'text', value: n.place, autocomplete: 'off', placeholder: '例：第1土場' }),
    body: h('textarea', { rows: 4, required: true, placeholder: '例：近隣の道路工事のため、第1土場には入れません。第3土場の係員に従ってください。' }, n.body),
    from: h('input', { type: 'datetime-local', value: n.from.length === 10 ? `${n.from}T00:00` : n.from }),
    to: h('input', { type: 'datetime-local', value: n.to.length === 10 ? `${n.to}T23:59` : n.to }),
  };
  const warn = h('p', { class: 'hint' });
  const updWarn = () => { warn.textContent = f.to.value ? '' : '⚠ 終了日時が空だと、手で消すまで出続けます。'; };
  f.to.addEventListener('input', updWarn); updWarn();
  const pic = imagePicker(n.imageId);

  dialog(existing ? 'お知らせを修正' : 'お知らせを出す', [
    datalist('dl-dest', dest),
    h('div', {}, h('label', {}, '種類'), h('div', { class: 'checks' }, kindRadios)),
    h('div', { class: 'grid2' }, h('label', {}, '工場（任意）', f.destination), h('label', {}, '土場（任意）', f.place)),
    h('label', {}, '内容', f.body),
    h('div', { class: 'grid2' }, h('label', {}, '掲示を始める日時', f.from), h('label', {}, '終わる日時', f.to)),
    warn,
    pic.node,
  ], {
    ok: existing ? '保存' : '現場に出す',
    onOk: async () => {
      const notice = {
        ...(existing ? { id: existing.id } : {}),
        kind: kindRadios.find((l) => l.firstChild.checked).firstChild.value,
        destination: normalizeName(f.destination.value), place: f.place.value, title: n.title, body: f.body.value,
        from: f.from.value, to: f.to.value, imageId: pic.get(),
      };
      await api('notice.put', { notice });
      await renderNotices(true);
      toast('保存しました');
    },
  });
}

/* ==================================================================
 * タブ：現場（台帳）
 * ================================================================== */
async function renderSites(force = false) {
  await ensureSites(force);
  const open = state.sites.filter((s) => !s.closed);
  const closed = state.sites.filter((s) => s.closed);

  const unlinked = state.unlinked.length ? h('div', { class: 'card', style: 'margin-bottom:16px' },
    h('h3', { style: 'margin-top:0' }, `台帳にまだ無い現場名（${state.unlinked.length}件）`),
    h('p', { class: 'hint' }, '現場の端末が自由に入力した名前です。同じ現場なら「別名」として既存の現場につなぐと、集計が1つにまとまります。'),
    (() => {
      /** 名寄せの操作（新しい現場にする／既存の別名にする）。表でもカードでも同じ部品 */
      const actionsOf = (u) => {
        const sel = h('select', { style: 'width:auto;max-width:100%' }, h('option', { value: '' }, '既存の現場の別名にする…'), open.map((s) => h('option', { value: s.id }, s.name)));
        return h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn sm', onclick: () => siteDialog(null, { name: u.name }) }, '新しい現場にする'),
          sel,
          h('button', { type: 'button', class: 'btn sm', onclick: () => {
            const target = state.sites.find((s) => s.id === sel.value);
            if (!target) { toast('つなぐ現場を選んでください', true); return; }
            guard(async () => {
              await api('site.put', { site: { ...target, aliases: [...target.aliases, u.name] } });
              await renderSites(true); toast(`「${u.name}」を「${target.name}」の別名にしました`);
            });
          } }, 'つなぐ'));
      };
      return narrow()
        ? h('div', { class: 'stack' }, state.unlinked.map((u) => h('div', { class: 'card' },
          h('div', {}, h('b', {}, u.name), h('span', { class: 'muted' }, `　${u.count}回・最後 ${fmtDay(u.lastDate)}`)),
          actionsOf(u))))
        : h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, '入力された名前'), h('th', { class: 'num' }, '回数'), h('th', {}, '最後'), h('th', {}, '対応'))),
          h('tbody', {}, state.unlinked.map((u) => h('tr', {},
            h('td', {}, u.name), h('td', { class: 'num' }, u.count), h('td', {}, fmtDay(u.lastDate)), h('td', {}, actionsOf(u)))))));
    })()) : null;

  const siteRow = (s) => h('tr', {},
    h('td', {}, h('b', {}, s.name), s.closed ? h('span', { class: 'tag gray' }, '完了') : null, h('div', { class: 'muted' }, `ID ${spaced(s.id)}`)),
    h('td', {}, s.aliases.join('、') || '—'),
    h('td', {}, [s.attrs.rinban && `林班 ${s.attrs.rinban}`, s.attrs.address, s.attrs.note].filter(Boolean).join(' / ') || '—'),
    h('td', {}, h('button', { type: 'button', class: 'btn sm', onclick: () => siteDialog(s) }, '修正')));

  const siteCard = (s) => h('div', { class: 'card' },
    h('div', { class: 'row' }, h('b', { class: 'grow' }, s.name, s.closed ? h('span', { class: 'tag gray' }, '完了') : null),
      h('button', { type: 'button', class: 'btn sm', onclick: () => siteDialog(s) }, '修正')),
    h('div', { class: 'muted' }, `ID ${spaced(s.id)}`),
    s.aliases.length ? h('div', {}, `別名：${s.aliases.join('、')}`) : null,
    [s.attrs.rinban && `林班 ${s.attrs.rinban}`, s.attrs.address, s.attrs.note].filter(Boolean).length
      ? h('div', { class: 'muted' }, [s.attrs.rinban && `林班 ${s.attrs.rinban}`, s.attrs.address, s.attrs.note].filter(Boolean).join(' / ')) : null);

  const table = (list) => (narrow()
    ? h('div', { class: 'cards' }, list.map(siteCard))
    : h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['現場名', '別名', '林班・住所・備考', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, list.map(siteRow)))));

  setView('sites', 
    h('h2', {}, '現場の台帳'),
    h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => siteDialog() }, '＋ 現場を追加'),
      h('span', { class: 'hint' }, 'ここに登録した現場が、現場アプリの選択肢になります。名前を直しても、過去の記録は同じ現場として集計されます。')),
    unlinked,
    open.length ? table(open) : h('div', { class: 'empty' }, '現場が登録されていません。'),
    closed.length ? [h('h3', {}, '完了した現場'), table(closed)] : null);
}

function siteDialog(existing, preset = {}) {
  const s = existing ?? { name: preset.name ?? '', aliases: [], attrs: { rinban: '', address: '', note: '' }, closed: false };
  const f = {
    name: h('input', { type: 'text', value: s.name, required: true, maxlength: 30, autocomplete: 'off' }),
    aliases: h('textarea', { rows: 3, placeholder: '1行に1つ' }, s.aliases.join('\n')),
    rinban: h('input', { type: 'text', value: s.attrs.rinban, autocomplete: 'off' }),
    address: h('input', { type: 'text', value: s.attrs.address, autocomplete: 'off' }),
    note: h('input', { type: 'text', value: s.attrs.note, autocomplete: 'off' }),
    closed: h('input', { type: 'checkbox', checked: s.closed }),
  };
  dialog(existing ? '現場を修正' : '現場を追加', [
    h('label', {}, '現場名（30文字まで）', f.name),
    existing ? h('p', { class: 'hint' }, `ID ${spaced(existing.id)}（名前を直してもIDは変わりません）`) : null,
    h('label', {}, '別名（昔からの呼び名・書き間違いやすい名前）', f.aliases),
    h('div', { class: 'grid2' }, h('label', {}, '林班（任意）', f.rinban), h('label', {}, '住所・場所（任意）', f.address)),
    h('label', {}, '備考（任意）', f.note),
    h('label', { class: 'row', style: 'font-weight:600' }, f.closed, '終わった現場（選択肢から隠す）'),
  ], {
    onOk: async () => {
      await api('site.put', { site: {
        ...(existing ? { id: existing.id } : {}),
        name: f.name.value, aliases: f.aliases.value.split('\n'), closed: f.closed.checked,
        attrs: { rinban: f.rinban.value, address: f.address.value, note: f.note.value },
      } });
      await renderSites(true);
      toast('保存しました');
    },
  });
}

/* ==================================================================
 * タブ：工場との差（現場の検収値と、工場の検収値の違い）
 * ================================================================== */
const signed = (num) => { const n = BigInt(num); return `${n >= 0n ? '+' : '−'}${formatVolume(n < 0n ? -n : n)}`; };
/** 差の率（%）。差÷現場の値。現場の値が0なら — */
function diffRate(diffNum, oursNum) {
  const o = BigInt(oursNum);
  if (o <= 0n) return '—';
  const r = Number((BigInt(diffNum) * 10000n) / o) / 100;
  return `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}%`;
}
const dayAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dateKey(d); };

async function renderDiff(force = false) {
  state.diffFilter ??= { from: dayAgo(90), to: '' };
  if (force || !state.diff) state.diff = await api('analysis.diff', { from: state.diffFilter.from || undefined, to: state.diffFilter.to || undefined });
  const r = state.diff;

  const fromIn = h('input', { type: 'date', value: state.diffFilter.from });
  const toIn = h('input', { type: 'date', value: state.diffFilter.to });
  const apply = (from, to) => { state.diffFilter = { from, to }; state.diff = null; guard(() => renderDiff(true)); };

  const groupTable = (title, list, hint) => (!list.length ? null : h('section', { style: 'margin-bottom:24px' },
    h('h3', {}, title), hint ? h('p', { class: 'hint' }, hint) : null,
    narrow()
      ? h('div', { class: 'cards' }, list.map((g) => h('div', { class: 'card' },
        h('div', { class: 'row' }, h('b', { class: 'grow' }, g.name), g.flagged ? h('span', { class: 'tag orange' }, `要確認 ${g.flagged}便`) : null),
        h('div', { class: 'muted' }, `${g.n}便　現場 ${fmtVol(g.oursNum)} → 工場 ${fmtVol(g.factoryNum)} m³`),
        h('div', {}, h('b', {}, `${signed(g.diffNum)} m³　${diffRate(g.diffNum, g.oursNum)}`)))))
      : h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, [['', ''], ['便', 'num'], ['現場 m³', 'num'], ['工場 m³', 'num'], ['差 m³', 'num'], ['差の率', 'num'], ['要確認', 'num']].map(([x, c]) => h('th', { class: c }, x)))),
        h('tbody', {}, list.map((g) => h('tr', {},
          h('td', {}, h('b', {}, g.name)), h('td', { class: 'num' }, g.n), h('td', { class: 'num' }, fmtVol(g.oursNum)), h('td', { class: 'num' }, fmtVol(g.factoryNum)),
          h('td', { class: 'num' }, h('b', {}, signed(g.diffNum))), h('td', { class: 'num' }, diffRate(g.diffNum, g.oursNum)),
          h('td', { class: 'num' }, g.flagged ? h('span', { class: 'tag orange' }, `${g.flagged}便`) : '—'))))))));

  const flaggedBlock = r.flaggedTotal ? h('section', { style: 'margin-bottom:24px' },
    h('h3', {}, `要確認の便（差が${r.flagPercent}%以上・${r.flaggedTotal}便${r.flaggedTotal > r.flagged.length ? `のうち差の大きい${r.flagged.length}便` : ''}）`),
    h('p', { class: 'hint' }, '測り直しや規格外のはね、入力のまちがいの可能性があります。「便」タブで、この日付・伝票番号の便を開いて確かめられます。'),
    h('div', { class: 'cards' }, r.flagged.map((f) => h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', { class: 'grow' }, `${fmtDay(f.dateStr)}　伝票 ${f.ticketNo || '—'}`), h('span', { class: 'tag orange' }, diffRate(f.diffNum, f.oursNum))),
      h('div', {}, [f.destination, f.species, f.truck].filter(Boolean).join(' / ')),
      h('div', { class: 'muted' }, `現場 ${fmtVol(f.oursNum)} → 工場 ${fmtVol(f.factoryNum)} m³（差 ${signed(f.diffNum)}）`))))) : null;

  setView('diff',
    h('h2', {}, '工場との差'),
    h('p', { class: 'hint' }, '「便」タブで入れた工場の検収値と、現場の検収値を比べます。差＝工場の値 − 現場の値。プラスは、工場のほうが多く検収した便です。工場との話し合いの材料になります。'),
    h('div', { class: 'toolbar' },
      h('label', { class: 'row' }, '期間', fromIn, '〜', toIn),
      h('button', { type: 'button', class: 'btn sm', onclick: () => apply(fromIn.value, toIn.value) }, '表示'),
      h('button', { type: 'button', class: 'btn sm', onclick: () => apply(dayAgo(90), '') }, '直近3か月'),
      h('button', { type: 'button', class: 'btn sm', onclick: () => apply(`${new Date().getFullYear()}-01-01`, '') }, '今年'),
      h('button', { type: 'button', class: 'btn sm', onclick: () => apply('', '') }, 'すべて')),
    r.truncated ? h('p', { class: 'dlg-error' }, '便が多いため、新しい便の一部だけを集計しています。期間をせまくして見てください。') : null,
    h('div', { class: 'card summary' },
      r.total.n ? h('div', { class: 'big' },
        h('div', {}, h('b', {}, r.total.n), h('span', {}, '便（工場の値あり）')),
        h('div', {}, h('b', {}, fmtVol(r.total.oursNum)), h('span', {}, 'm³（現場の検収値）')),
        h('div', {}, h('b', {}, fmtVol(r.total.factoryNum)), h('span', {}, 'm³（工場の検収値）')),
        h('div', {}, h('b', {}, signed(r.total.diffNum)), h('span', {}, `m³（差 ${diffRate(r.total.diffNum, r.total.oursNum)}）`)))
        : h('div', { class: 'empty' }, 'この期間に、工場の検収値が入っている便はありません。「便」タブの「工場の検収 m³」に入れると、ここに集計されます。'),
      r.withoutFactory ? h('p', { class: 'hint' }, `工場の値が未入力の便が ${r.withoutFactory} 便あります（集計に入っていません）。`) : null),
    flaggedBlock,
    groupTable('納入先ごと', r.byDestination),
    groupTable('樹種ごと', r.bySpecies, r.mixedSpecies ? `複数の樹種を積んだ便（${r.mixedSpecies}便）は、工場の値が便ぜんたいの値なので、樹種ごとには入れていません。` : null),
    groupTable('月ごと', r.byMonth));
}

/* ==================================================================
 * タブ：マスター（車番・納入先・樹種）
 * ================================================================== */
const MASTER_LABEL = { truck: '車番', destination: '納入先', species: '樹種' };
const MASTER_HINT = {
  truck: '現場アプリの「トラック車番」の選択肢になります。表記のゆれ（全角半角・空白）は同じものとして扱います。',
  destination: '現場アプリの「納入先」の選択肢になります。納入枠の工場名もここから選べます。',
  species: '現場アプリの樹種の入力欄に、候補として出ます（自由入力もできます）。',
};

async function renderMasters(force = false) {
  await ensureMasters(force);
  const section = (kind) => {
    const list = state.masters[kind];
    const open = list.filter((m) => !m.closed);
    const closed = list.filter((m) => m.closed);
    const card = (m) => h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', { class: 'grow' }, m.name, m.closed ? h('span', { class: 'tag gray' }, '使わない') : null),
        h('button', { type: 'button', class: 'btn sm', onclick: () => masterDialog(kind, m) }, '修正')),
      m.aliases.length ? h('div', { class: 'muted' }, `別名：${m.aliases.join('、')}`) : null);
    const row = (m) => h('tr', {},
      h('td', {}, h('b', {}, m.name), m.closed ? h('span', { class: 'tag gray' }, '使わない') : null),
      h('td', {}, m.aliases.join('、') || '—'),
      h('td', {}, h('button', { type: 'button', class: 'btn sm', onclick: () => masterDialog(kind, m) }, '修正')));
    const table = (items) => (narrow()
      ? h('div', { class: 'cards' }, items.map(card))
      : h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['名前', '別名', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, items.map(row)))));
    return h('section', { style: 'margin-bottom:28px' },
      h('h3', {}, `${MASTER_LABEL[kind]}（${open.length}件）`),
      h('div', { class: 'toolbar' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => masterDialog(kind) }, `＋ ${MASTER_LABEL[kind]}を追加`),
        h('span', { class: 'hint' }, MASTER_HINT[kind])),
      open.length ? table(open) : h('div', { class: 'empty' }, `${MASTER_LABEL[kind]}はまだ登録されていません。`),
      closed.length ? h('details', {}, h('summary', {}, `使わなくなったもの（${closed.length}件）`), table(closed)) : null);
  };
  setView('masters',
    h('h2', {}, 'マスター（車番・納入先・樹種）'),
    h('p', { class: 'hint' }, 'ここに登録すると、事務所とデータを共有している全部の現場アプリに配られます。圏外でも、最後に受け取った内容で使えます。端末で個別に登録した名前も、そのまま使えます。消す代わりに「使わない」にすると、選択肢から隠れます（過去の記録は変わりません）。'),
    ['truck', 'destination', 'species'].map(section));
}

function masterDialog(kind, existing) {
  const m = existing ?? { name: '', aliases: [], closed: false };
  const f = {
    name: h('input', { type: 'text', value: m.name, required: true, maxlength: 30, autocomplete: 'off' }),
    aliases: h('textarea', { rows: 3, placeholder: '1行に1つ' }, m.aliases.join('\n')),
    closed: h('input', { type: 'checkbox', checked: m.closed }),
  };
  dialog(existing ? `${MASTER_LABEL[kind]}を修正` : `${MASTER_LABEL[kind]}を追加`, [
    h('label', {}, `${MASTER_LABEL[kind]}（30文字まで）`, f.name),
    h('label', {}, '別名（昔からの呼び名・書き間違いやすい名前）', f.aliases),
    h('label', { class: 'row', style: 'font-weight:600' }, f.closed, '使わない（選択肢から隠す）'),
  ], {
    onOk: async () => {
      await api('master.put', { master: { ...(existing ? { id: existing.id } : {}), kind, name: f.name.value, aliases: f.aliases.value.split('\n'), closed: f.closed.checked } });
      await renderMasters(true);
      toast('保存しました');
    },
  });
}

/* ==================================================================
 * タブ：受信箱（スマホで撮った写真）
 * ================================================================== */
async function renderInbox(force = false) {
  await ensureInbox(force);
  const file = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    toast('送信中…');
    await guard(async () => {
      const image = await compressImage(f);
      await api('inbox.put', { image, caption: f.name.replace(/\.[^.]+$/, '').slice(0, 40) });
      await renderInbox(true);
      toast('受信箱に入れました');
    });
  } });
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const id = e.target.dataset.id;
      guard(async () => { e.target.replaceChildren(h('img', { src: await loadImage(id), alt: '' })); });
    }
  }) : null;

  const thumb = (it) => {
    const img = h('div', { class: 'img', dataset: { id: it.id }, onclick: () => viewImage(it.id) }, '読み込み中…');
    if (io) io.observe(img); else guard(async () => { img.replaceChildren(h('img', { src: await loadImage(it.id), alt: '' })); });
    return h('div', { class: 'thumb' }, img,
      h('div', { class: 'cap' }, fmtDateTime(new Date(it.createdAt)), it.caption ? h('div', {}, it.caption) : null,
        h('button', { type: 'button', class: 'btn sm danger', style: 'margin-top:4px', onclick: async () => {
          if (!(await confirmDialog('この写真を削除します。', '削除する'))) return;
          await guard(async () => { await api('inbox.delete', { id: it.id }); await renderInbox(true); });
        } }, '削除')));
  };

  setView('inbox', 
    h('h2', {}, '受信箱'),
    h('div', { class: 'toolbar' },
      file,
      h('button', { type: 'button', class: 'btn primary', onclick: () => file.click() }, '📷 写真を送る'),
      h('span', { class: 'hint' }, 'スマホでこの画面を開いて、FAXや精算書を撮って送ると、PCのこの画面に届きます。枠やお知らせに添付できます。')),
    state.inbox.length ? h('div', { class: 'thumbs' }, state.inbox.map(thumb)) : h('div', { class: 'empty' }, '写真はありません。'));
}

/* ==================================================================
 * タブ：設定
 * ================================================================== */
function showOfficeCode(code, title) {
  let checked = false;
  const box = h('input', { type: 'checkbox', onchange: (e) => { checked = e.target.checked; } });
  dialog(title, [
    h('p', {}, '事務所コードです。', h('b', {}, 'この画面でしか表示されません。'), '紙に書き写すか、パスワード管理アプリに保存してください。'),
    h('div', { class: 'bigcode' }, code),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn sm', onclick: () => navigator.clipboard?.writeText(code).then(() => toast('コピーしました')) }, 'コピー')),
    h('label', { class: 'row', style: 'font-weight:600' }, box, '控えました'),
  ], { ok: '閉じる', cancel: null, onOk: async () => { if (!checked) throw new ApiError('invalid', { field: '「控えました」のチェック' }); } });
}

/* ---------------- 全データのダウンロード（契約の期間中だけ） ---------------- */
/** 便を、新しい順に全部読む（200件ずつ） */
async function fetchAllTickets(onProgress) {
  const all = [];
  for (let offset = 0; offset < 100_000; offset += 200) {
    const r = await api('ticket.list', { limit: 200, offset });
    all.push(...r.tickets);
    onProgress?.(all.length);
    if (!r.hasMore) break;
  }
  return all;
}

async function exportEverything(kind, setLabel) {
  const tickets = await fetchAllTickets((n) => setLabel(`読み込み中… ${n}便`));
  const stamp = `${today()}`;
  if (kind === 'csv') { download(`terra-全便-${stamp}.csv`, csvOfTickets(tickets)); return tickets.length; }
  setLabel('まとめています…');
  const [sites, quotas, notices, masters] = await Promise.all([api('site.list'), api('quota.list'), api('notice.list'), api('master.list')]);
  const bundle = {
    app: 'TERRA 事務所', exportedAt: new Date().toISOString(), note: '契約の期間中だけ書き出せます。写真（受信箱）は含まれません。材積の数値（*Num）は内部単位で、1 m³ = 40,000,000,000 です。',
    tickets, sites: sites.sites, quotas: quotas.quotas, notices: notices.notices, masters: masters.masters,
  };
  download(`terra-全データ-${stamp}.json`, JSON.stringify(bundle, null, 1), 'application/json;charset=utf-8');
  return tickets.length;
}

function renderSettings() {
  const linkCode = h('textarea', { rows: 3, spellcheck: 'false', placeholder: '別のアプリのライセンスコード' });
  const linkEmail = h('input', { type: 'email', autocomplete: 'off' });
  setView('settings', 
    h('h2', {}, '設定'),
    h('div', { class: 'stack' },
      h('div', { class: 'card stack' },
        h('h3', { style: 'margin-top:0' }, 'スマホでこの画面を開く'),
        h('p', { class: 'hint' }, 'ログイン用のリンクを作ります。LINEなどで自分のスマホに送って開くと、そのスマホでも使えます（写真を送るときに便利です）。このリンクを知っている人は事務所の画面に入れるので、他の人には送らないでください。有効期間は30日です。'),
        h('div', {}, h('button', { type: 'button', class: 'btn', onclick: async () => {
          const link = `${location.origin}/office/#t=${state.token}`;
          try { await navigator.clipboard.writeText(link); toast('リンクをコピーしました'); } catch { prompt('このリンクをコピーしてください', link); }
        } }, 'ログイン用リンクをコピー'))),
      h('div', { class: 'card stack' },
        h('h3', { style: 'margin-top:0' }, '事務所コードの再発行'),
        h('p', { class: 'hint' }, 'コードを紛失した・担当者が替わったときに使います。古いコードと、ログイン済みのすべての端末のログインが無効になります。'),
        h('div', {}, h('button', { type: 'button', class: 'btn danger', onclick: async () => {
          if (!(await confirmDialog('事務所コードを作り直します。すべての端末が一度ログアウトされます。', '作り直す'))) return;
          await guard(async () => {
            const r = await api('office.resetCode');
            state.token = r.token; saveLogin();
            showOfficeCode(r.officeCode, '新しい事務所コード');
          });
        } }, '事務所コードを作り直す'))),
      h('div', { class: 'card stack' },
        h('h3', { style: 'margin-top:0' }, '全データのダウンロード'),
        h('p', { class: 'hint' }, '届いた便をすべて、お手元に保存できます。Excelで開く一覧（CSV）と、すべてをまとめたファイル（JSON：便・現場・納入枠・お知らせ・マスター）の2種類です。写真（受信箱）は含まれません。'),
        h('p', { class: 'hint' }, '**契約の期間中だけ**使えます。解約して契約が終わると（無料の試用期間中に解約した場合も）、この画面のデータは見られなくなり、ダウンロードもできません。必要なデータは、契約が続いているうちに保存してください。'.replaceAll('**', '')),
        (() => {
          const mk = (label, kind) => {
            const btn = h('button', { type: 'button', class: 'btn' }, label);
            btn.addEventListener('click', () => guard(async () => {
              btn.disabled = true;
              try { const n = await exportEverything(kind, (t) => { btn.textContent = t; }); toast(`${n}便ぶんを保存しました`); }
              finally { btn.disabled = false; btn.textContent = label; }
            }));
            return btn;
          };
          return h('div', { class: 'row' }, mk('全便をCSVでダウンロード（Excel用）', 'csv'), mk('全データをJSONでダウンロード', 'json'));
        })()),
      h('div', { class: 'card stack' },
        h('h3', { style: 'margin-top:0' }, '別のアプリの契約をつなぐ'),
        h('p', { class: 'hint' }, '日報・造林など別のTERRAアプリを別々に契約した場合、そのライセンスコードをここで入れると、同じ現場の台帳を共有できます。'),
        linkCode,
        h('label', {}, 'そのアプリを購入したときのメールアドレス（契約者ご本人の確認）', linkEmail),
        h('div', {}, h('button', { type: 'button', class: 'btn', onclick: () => guard(async () => {
          await api('office.link', { code: linkCode.value.trim(), email: linkEmail.value.trim() }); linkCode.value = ''; linkEmail.value = ''; toast('つなぎました');
        }) }, 'つなぐ'))),
      h('div', {}, h('button', { type: 'button', class: 'btn', onclick: () => logout() }, 'この端末でログアウト'))));
}

/* ==================================================================
 * 画面の切り替え
 * ================================================================== */
// タブを開くたびに最新を読み直す（現場から便が届くと、枠の残りや名寄せ候補が変わるため）
const TABS = { tickets: renderTickets, quotas: () => renderQuotas(true), notices: () => renderNotices(true), sites: () => renderSites(true), diff: () => renderDiff(true), masters: () => renderMasters(true), inbox: () => renderInbox(true), settings: renderSettings };

async function openTab(name) {
  state.tab = name;
  for (const b of document.querySelectorAll('#tabs button')) {
    if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  $('#view').replaceChildren(h('p', { class: 'muted' }, '読み込み中…'));
  await guard(() => TABS[name]());
}

function showLogin(message = '') {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-error').textContent = message;
  if (state.code) $('#in-code').value = state.code;
}

/**
 * 同意文の版が変わっていたら、同意し直してもらう（同意するまで、現場からの便は受け取れない）。
 * 同意しない場合はログアウトする。
 */
async function ensureConsent() {
  const st = await api('office.status');
  if (st.consentOk) return true;
  return new Promise((resolve) => {
    const dlg = dialog('データの取り扱いへの同意', [
      h('p', {}, 'データの取り扱いの内容が更新されました。内容を確認し、同意してください。'),
      h('ul', { class: 'hint' },
        h('li', {}, '事務所に共有された検収データ（生データ）を、運営者（TERRA TX）が閲覧できます。'),
        h('li', {}, '研究・販売などに利用する場合は、会社名・車番・現場名・納入先・備考などを除いて匿名化したうえで利用します。'),
        h('li', {}, '詳しくは利用規約（第5条）とプライバシーポリシーをご覧ください。')),
    ], {
      ok: '同意する', cancel: '同意しない（ログアウト）',
      onOk: async () => { await api('office.consent', { consent: CONSENT_VERSION }); resolve(true); },
    });
    dlg.addEventListener('close', () => resolve(false));
  });
}

async function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  if (!(await guard(ensureConsent))) { logout('データの取り扱いに同意いただけない場合は、事務所の画面はご利用になれません。'); return; }
  return openTab(state.tab);
}

function wireLogin() {
  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter; btn.disabled = true;
    $('#login-error').textContent = '';
    try {
      const code = $('#in-code').value.trim();
      const r = await api('office.login', { code, officeCode: $('#in-office-code').value }, { as: 'none' });
      state.token = r.token; state.code = code; saveLogin();
      $('#in-office-code').value = '';
      await showApp();
    } catch (e) { $('#login-error').textContent = explain(e); } finally { btn.disabled = false; }
  });

  $('#setup-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter; btn.disabled = true;
    $('#login-error').textContent = '';
    try {
      const code = $('#in-setup-code').value.trim();
      const r = await api('office.setup', { code, email: $('#in-setup-email').value, consent: $('#in-consent').checked ? CONSENT_VERSION : '' }, { as: 'none' });
      state.token = r.token; state.code = code; saveLogin();
      await showApp();
      showOfficeCode(r.officeCode, '事務所の準備ができました');
    } catch (e) { $('#login-error').textContent = explain(e); } finally { btn.disabled = false; }
  });

  $('#recover-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter; btn.disabled = true;
    $('#login-error').textContent = '';
    try {
      const code = $('#in-recover-code').value.trim();
      const r = await api('office.recover', { code, email: $('#in-recover-email').value }, { as: 'none' });
      state.token = r.token; state.code = code; saveLogin();
      await showApp();
      showOfficeCode(r.officeCode, '新しい事務所コード');
    } catch (e) { $('#login-error').textContent = explain(e); } finally { btn.disabled = false; }
  });

  for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => openTab(b.dataset.tab));
}

async function boot() {
  wireLogin();
  // 画面の幅が変わった（タブレットの縦横・ウィンドウの拡大縮小）ら、表とカードを切り替える
  window.matchMedia(NARROW).addEventListener('change', () => {
    if (!state.token) return;
    if (state.tab === 'tickets' && state.tickets.length) drawTickets();
    else if (state.tab === 'sites' && state.sites) guard(() => renderSites(false));
    else if (state.tab === 'masters' && state.masters) guard(() => renderMasters(false));
  });
  loadLogin();
  // スマホ用のログインリンク（#t=…）。札はサーバーに送られない部分（#以降）に入れてある
  const m = /^#t=([\w.-]+)$/.exec(location.hash);
  if (m) {
    const linkToken = m[1];
    history.replaceState(null, '', location.pathname);
    // 他人が作ったリンクを開かされて、知らない事務所に入ってしまうのを防ぐため、必ず確認する
    const adopt = await confirmDialog('ログイン用のリンクが開かれました。ご自身が「設定」でコピーして送ったリンクですか？ 心当たりがなければ「やめる」を押してください。', 'このリンクでログインする');
    if (adopt) { state.token = linkToken; saveLogin(); }
  }
  if (!state.token) { showLogin(); return; }
  try {
    await api('site.list');           // 札がまだ有効か確かめる
    await showApp();
  } catch (e) {
    if (!(e instanceof ApiError && e.code === 'unauthorized')) showLogin(explain(e));
  }
}

boot();
