/**
 * TERRA 運営者コンソール
 * ------------------------------------------------------------------
 * 運営者（TERRA TX）だけが使う。事務所に共有された検収データの閲覧と、匿名化した書き出し。
 * 閲覧専用で、会社のデータを書き換える操作はない。すべての操作はサーバー側で記録される。
 * 画面に出す文字はすべて textContent 経由（HTML文字列は組み立てない）。
 */
import { formatVolume, formatLength, toHundredths } from '../src/js/jas.js';
import { csvCell } from '../src/js/office-rules.js';

const STORE_KEY = 'terra-ops-token';
const state = { token: '', tab: 'companies', cid: null };
const $ = (sel) => document.querySelector(sel);

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
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
const setView = (tab, ...kids) => {
  if (state.tab !== tab) return;
  $('#view').replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
};

let toastTimer = null;
function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg; el.classList.toggle('err', isErr); el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), isErr ? 5000 : 2200);
}

class ApiError extends Error { constructor(code, info = {}) { super(code); this.code = code; this.info = info; } }

async function api(op, args = {}, { auth = true } = {}) {
  const body = { op, ...args };
  if (auth) body.token = state.token;
  let res;
  try {
    res = await fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch { throw new ApiError('offline'); }
  const json = await res.json().catch(() => ({ ok: false, error: 'server_error' }));
  if (res.status === 401 && auth) { logout('ログインの有効期限が切れました。'); throw new ApiError('unauthorized'); }
  if (!json.ok) throw new ApiError(json.error ?? 'server_error', json);
  return json;
}

const MESSAGES = {
  offline: '通信できません。', not_configured: '保存先（Upstash）が未設定です。', ops_not_configured: '運営者の鍵（環境変数 OPERATOR_KEY・24文字以上）が未設定です。',
  bad_key: '鍵が違います。', locked: '間違いが続いたため、15分間ログインできません。', invalid: '入力を確認してください。', server_error: 'サーバーでエラーが起きました。',
};
const explain = (e) => (e instanceof ApiError ? (MESSAGES[e.code] ?? `失敗しました（${e.code}）`) : '予期しないエラーです。');
const guard = async (fn) => { try { return await fn(); } catch (e) { if (!(e instanceof ApiError && e.code === 'unauthorized')) toast(explain(e), true); return undefined; } };

const pad2 = (n) => String(n).padStart(2, '0');
const fmtAt = (ms) => { if (!ms) return '—'; const d = new Date(ms); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const spaced = (id) => `${id.slice(0, 4)}-${id.slice(4)}`;

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/* ---------------- 会社 ---------------- */
async function renderCompanies() {
  const { companies, consentVersion } = await api('ops.companies');
  const noConsent = companies.filter((c) => !c.consentOk).length;
  setView('companies',
    h('h2', {}, '会社（事務所を設定した事業体）'),
    h('p', { class: 'hint' }, `現行の同意文の版：${consentVersion}。${noConsent ? `同意が現行版でない会社が ${noConsent} 社あります（書き出しには含まれません）。` : 'すべての会社が現行版に同意しています。'}`),
    companies.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['事業体ID', '設定した日', '便に入っている会社名', '最新の便', '同意'].map((x) => h('th', {}, x)), h('th', { class: 'num' }, '便数'), h('th', {}))),
      h('tbody', {}, companies.map((c) => h('tr', {},
        h('td', {}, spaced(c.id)), h('td', {}, fmtAt(c.createdAt)), h('td', {}, c.latestOwnCompany || '—'), h('td', {}, c.latestDate || '—'),
        h('td', {}, c.consentOk ? h('span', { class: 'ok' }, '✓ 同意済み') : h('span', { class: 'ng' }, `要再同意（${c.consentVersion ?? '未'}）`)),
        h('td', { class: 'num' }, c.tickets.toLocaleString()),
        h('td', {}, h('button', { type: 'button', class: 'btn sm', onclick: () => { state.cid = c.id; guard(() => renderTickets()); } }, '便を見る'))))))) : h('div', { class: 'empty' }, 'まだ会社がありません。'));
}

/* ---------------- 便の生データ ---------------- */
async function renderTickets(offset = 0) {
  const from = $('#f-from')?.value ?? ''; const to = $('#f-to')?.value ?? '';
  const r = await api('ops.tickets', { cid: state.cid, from: from || undefined, to: to || undefined, offset, limit: 100 });
  const fromIn = h('input', { id: 'f-from', type: 'date', value: from }); const toIn = h('input', { id: 'f-to', type: 'date', value: to });
  setView('companies',
    h('h2', {}, `便の生データ　事業体 ${spaced(state.cid)}`),
    h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: 'btn', onclick: () => { state.cid = null; guard(renderCompanies); } }, '← 会社一覧'),
      h('label', {}, '期間（から）', fromIn), h('label', {}, '（まで）', toIn),
      h('button', { type: 'button', class: 'btn', onclick: () => guard(() => renderTickets(0)) }, '表示する')),
    r.tickets.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'wide' },
      h('thead', {}, h('tr', {}, ['日付', 'No.', '車番', '納入先', '会社', '積み荷', '備考'].map((x) => h('th', {}, x)), h('th', { class: 'num' }, '本数'), h('th', { class: 'num' }, '材積 m³'), h('th', { class: 'num' }, '工場の値'))),
      h('tbody', {}, r.tickets.map((t) => h('tr', {},
        h('td', {}, t.dateStr), h('td', {}, t.ticketNo), h('td', {}, t.truck || '—'), h('td', {}, t.destination || '—'), h('td', {}, t.ownCompany || '—'),
        h('td', {}, t.lots.map((l) => h('div', { class: 'lot-line' }, `${l.species} ${formatLength(toHundredths(l.lengthM))}m ${l.minD}-${l.maxD}cm${l.site ? ` · ${l.site}` : ''} · ${l.count}本`))),
        h('td', {}, t.note || ''), h('td', { class: 'num' }, t.totalCount), h('td', { class: 'num' }, formatVolume(BigInt(t.totalVolNum))),
        h('td', { class: 'num' }, t.factoryNum != null ? formatVolume(BigInt(t.factoryNum)) : '')))))) : h('div', { class: 'empty' }, '便がありません。'),
    h('div', { class: 'row', style: 'margin-top:12px' },
      offset > 0 ? h('button', { type: 'button', class: 'btn', onclick: () => guard(() => renderTickets(Math.max(0, offset - 100))) }, '← 前の100件') : null,
      r.hasMore ? h('button', { type: 'button', class: 'btn', onclick: () => guard(() => renderTickets(offset + 100)) }, '次の100件 →') : null));
}

/* ---------------- 匿名化エクスポート ---------------- */
function renderExport() {
  const mode = h('select', {}, h('option', { value: 'aggregate' }, '集計（月×樹種×長さ×径級）'), h('option', { value: 'records' }, '個別（仮名の会社つき・1行ずつ）'));
  const from = h('input', { type: 'date' }); const to = h('input', { type: 'date' });
  const k = h('input', { type: 'number', min: 3, max: 100, value: 3 });
  const out = h('div', {});
  let last = null;

  const run = () => guard(async () => {
    out.replaceChildren(h('p', { class: 'muted' }, '作成中…'));
    const r = await api('ops.export', { mode: mode.value, from: from.value || undefined, to: to.value || undefined, k: Number(k.value) });
    last = r;
    const keys = r.rows[0] ? Object.keys(r.rows[0]) : [];
    out.replaceChildren(
      h('div', { class: 'card' },
        h('p', {}, `${r.meta.rows.toLocaleString()} 行（含めた会社 ${r.meta.companiesIncluded} 社／同意が現行版でないため除外 ${r.meta.companiesExcludedNoConsent} 社／k=${r.meta.k} 未満で出さなかった組み合わせ ${r.meta.suppressedGroups}）`),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', disabled: !r.rows.length, onclick: () => {
          const head = keys.join(',');
          download(`terra-anonymized-${r.meta.mode}-${new Date(r.meta.generatedAt).toISOString().slice(0, 10)}.csv`,
            `﻿${[head, ...r.rows.map((row) => keys.map((key) => csvCell(row[key])).join(','))].join('\r\n')}\r\n`);
        } }, 'CSVをダウンロード'))),
      r.rows.length ? h('div', { class: 'table-wrap', style: 'margin-top:12px' }, h('table', {},
        h('thead', {}, h('tr', {}, keys.map((x) => h('th', {}, x)))),
        h('tbody', {}, r.rows.slice(0, 100).map((row) => h('tr', {}, keys.map((key) => h('td', {}, String(row[key])))))))) : h('div', { class: 'empty' }, '条件に合うデータがありません（会社が少ない場合は出ません）。'),
      r.rows.length > 100 ? h('p', { class: 'hint' }, '先頭の100行だけ表示しています。CSVには全行が入ります。') : null);
  });

  setView('export',
    h('h2', {}, '匿名化エクスポート'),
    h('div', { class: 'card stack' },
      h('p', { class: 'hint' }, '会社名・車番・現場名・納入先・備考・伝票番号・正確な日付は含めません。会社は鍵付きの仮名にし、関わった会社がk社未満の組み合わせは出しません（kは3未満にできません）。現行の同意文に同意した会社のデータだけを使います。'),
      h('p', { class: 'hint' }, '※ これは個人情報保護法の「匿名加工情報」の基準を満たすことまでは保証しません。第三者へ販売・提供する前に、専門家に確認してください。'),
      h('label', {}, '種類', mode),
      h('div', { class: 'grid2' }, h('label', {}, '期間（から）', from), h('label', {}, '（まで）', to)),
      h('label', {}, '最小の会社数 k（3以上）', k),
      h('div', {}, h('button', { type: 'button', class: 'btn primary', onclick: run }, '作成する'))),
    out);
}

/* ---------------- 閲覧記録 ---------------- */
async function renderAudit() {
  const { entries } = await api('ops.audit');
  const detail = (e) => Object.entries(e).filter(([k]) => !['at', 'op'].includes(k)).map(([k, v]) => `${k}=${v ?? ''}`).join('  ');
  setView('audit',
    h('h2', {}, '閲覧記録（新しい順・直近2か月・最大300件）'),
    entries.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['日時', '操作', '内容'].map((x) => h('th', {}, x)))),
      h('tbody', {}, entries.map((e) => h('tr', {}, h('td', {}, fmtAt(e.at)), h('td', {}, e.op), h('td', {}, detail(e))))))) : h('div', { class: 'empty' }, '記録はありません。'));
}

/* ---------------- 画面 ---------------- */
const TABS = { companies: () => (state.cid ? renderTickets() : renderCompanies()), export: renderExport, audit: renderAudit };

async function openTab(name) {
  if (name === 'logout') { logout(); return; }
  state.tab = name;
  if (name === 'companies') state.cid = null;
  for (const b of document.querySelectorAll('#tabs button')) {
    if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  $('#view').replaceChildren(h('p', { class: 'muted' }, '読み込み中…'));
  await guard(() => TABS[name]());
}

function showLogin(message = '') {
  $('#app').hidden = true; $('#login').hidden = false; $('#login-error').textContent = message;
}
function logout(message = '') {
  state.token = '';
  try { sessionStorage.removeItem(STORE_KEY); } catch { /* 無視 */ }
  showLogin(message);
}

async function boot() {
  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter; btn.disabled = true; $('#login-error').textContent = '';
    try {
      const r = await api('ops.login', { key: $('#in-key').value }, { auth: false });
      state.token = r.token; $('#in-key').value = '';
      try { sessionStorage.setItem(STORE_KEY, r.token); } catch { /* 無視 */ }
      $('#login').hidden = true; $('#app').hidden = false;
      await openTab('companies');
    } catch (e) { $('#login-error').textContent = explain(e); } finally { btn.disabled = false; }
  });
  for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => openTab(b.dataset.tab));

  // 札は、タブを閉じたら消える場所（sessionStorage）にだけ置く
  try { state.token = sessionStorage.getItem(STORE_KEY) ?? ''; } catch { /* 無視 */ }
  if (!state.token) { showLogin(); return; }
  $('#login').hidden = true; $('#app').hidden = false;
  await openTab('companies');
}

boot();
