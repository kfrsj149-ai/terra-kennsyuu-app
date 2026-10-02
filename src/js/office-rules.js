/**
 * 事務所端末まわりの共通ルール（純粋な関数だけ。画面にもサーバーにも触れない）
 * ------------------------------------------------------------------
 * 現場名・ID・納入枠の時間判定・お知らせの有効期間。
 * 画面（事務所ダッシュボード／現場アプリ）とサーバー（/api/office）が
 * 同じ判定を使うため、ここ1か所に置いてテストで固めてある。
 *
 * 【正本は terra-common】
 *   このファイルの正本は kfrsj149-ai/terra-common の shared-code/office-rules.js。
 *   決まりは rules/現場名とID.md と rules/データの取り扱いと同意.md に書いてある。
 *   変更は terra-common で行い、各アプリにコピーして、各アプリのテストを流す
 *   （他のアプリ・日報・造林・サテイラ・シンラにも、このファイルをそのままコピーして使う。依存はない）。
 */

/** IDに使う文字。QR規格（docs/QR書式の統一.md）と同じ。紛らわしい I L O U は除く */
export const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ID_LENGTH = 8;
export const ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{8}$/;

export const isValidId = (v) => typeof v === 'string' && ID_PATTERN.test(v);

/** 現場名の最大文字数（画面の1行に収まる長さ） */
export const SITE_NAME_MAX = 30;

/**
 * 名前を整える。表記ゆれを入口でそろえるための決まり：
 *  ・全角英数・半角カナ等は NFKC で統一（「ＡＢＣ１」→「ABC1」）
 *  ・前後の空白を削る／途中の空白の連続は1つにする
 *  ・改行・タブなどの制御文字は取り除く
 */
export function normalizeName(raw) {
  return String(raw ?? '')
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 同じ現場かどうかを比べるためのキー。
 * 空白を全部取り、英字は小文字にする（「本谷 2号」「本谷2号」「ＨＯＮ谷」を同一視する）。
 * ただし表示には normalizeName() の結果を使い、このキーは比較にしか使わない。
 */
export function nameKey(raw) {
  return normalizeName(raw).replace(/ /g, '').toLowerCase();
}

/** @returns {{ok:true, name:string}|{ok:false, error:'empty'|'too_long'}} */
export function validateSiteName(raw) {
  const name = normalizeName(raw);
  if (!name) return { ok: false, error: 'empty' };
  if ([...name].length > SITE_NAME_MAX) return { ok: false, error: 'too_long' };
  return { ok: true, name };
}

/**
 * 名前（または別名）が登録済みの現場のどれかと重なるか。
 * @param {Array<{id:string,name:string,aliases?:string[]}>} sites
 * @param {string} candidate
 * @param {string} [exceptId] 自分自身は除く（名前の修正時）
 * @returns {object|null} ぶつかった現場
 */
export function findSiteByName(sites, candidate, exceptId = null) {
  const key = nameKey(candidate);
  if (!key) return null;
  for (const s of sites) {
    if (exceptId && s.id === exceptId) continue;
    if (nameKey(s.name) === key) return s;
    if ((s.aliases ?? []).some((a) => nameKey(a) === key)) return s;
  }
  return null;
}

/**
 * 記録に入っている現場名から、現場IDを引く（名前でも別名でも引ける）。
 * 見つからなければ null。記録は止めない（IDなしの「未登録の現場名」として扱う）。
 */
export function resolveSiteId(sites, name) {
  return findSiteByName(sites ?? [], name)?.id ?? null;
}

/* ------------------------------------------------------------------
 * 材積の入力（工場の検収値など）。m³の小数3桁までを、jas.js と同じ内部単位に直す
 * ------------------------------------------------------------------ */
/** jas.js の VOLUME_DENOMINATOR（4×10^10）÷1000。1/1000 m³ あたりの内部単位 */
const NUM_PER_MILLI = 40_000_000n;

/** "12.345" → 内部単位(BigInt)。書式が違えば null */
export function parseM3(text) {
  const s = String(text ?? '').normalize('NFKC').trim();
  const m = /^(\d{1,7})(?:\.(\d{1,3}))?$/.exec(s);
  if (!m) return null;
  const milli = BigInt(m[1]) * 1000n + BigInt((m[2] ?? '').padEnd(3, '0') || '0');
  return milli * NUM_PER_MILLI;
}

/* ------------------------------------------------------------------
 * 納入枠：今は荷下ろしできる時間か
 * ------------------------------------------------------------------ */
const pad2 = (n) => String(n).padStart(2, '0');
export const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** 'HH:MM' → 分。書式が違えば null */
export function parseHm(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 24 && min < 60 && (h < 24 || min === 0) ? h * 60 + min : null;
}

/**
 * 枠の期間・曜日・時間帯に、いまが入っているか。
 * @param {{from?:string,to?:string,weekdays?:number[],timeFrom?:string,timeTo?:string}} quota
 *   weekdays: 0=日〜6=土。空（または未設定）なら毎日。時間帯が空なら終日。
 * @returns {{open:boolean, reason:null|'before'|'after'|'weekday'|'time', nextOpenAt:Date|null}}
 */
export function windowStatus(quota, now = new Date()) {
  const dayOk = (d) => {
    const k = dateKey(d);
    if (quota.from && k < quota.from) return 'before';
    if (quota.to && k > quota.to) return 'after';
    if (quota.weekdays?.length && !quota.weekdays.includes(d.getDay())) return 'weekday';
    return null;
  };
  const fromMin = parseHm(quota.timeFrom) ?? 0;
  const toMin = parseHm(quota.timeTo) ?? 24 * 60;
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const dayReason = dayOk(now);
  if (!dayReason && nowMin >= fromMin && nowMin < toMin) return { open: true, reason: null, nextOpenAt: null };
  const reason = dayReason ?? 'time';

  // 次に開く時刻を、最大60日先まで探す
  for (let i = 0; i < 60; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (dayOk(d)) continue;
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(fromMin / 60), fromMin % 60);
    if (start > now) return { open: false, reason, nextOpenAt: start };
  }
  return { open: false, reason, nextOpenAt: null };
}

/* ------------------------------------------------------------------
 * お知らせ（納入不可・入場制限・案内）の有効期間
 * ------------------------------------------------------------------ */
/** 'YYYY-MM-DD' なら from は0:00、to は23:59 とみなす。'YYYY-MM-DDTHH:MM' はそのまま */
function parseWhen(text, edge) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const iso = s.length === 10 ? `${s}T${edge === 'to' ? '23:59' : '00:00'}` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** @returns {'active'|'upcoming'|'expired'} */
export function noticeState(notice, now = new Date()) {
  const from = parseWhen(notice.from, 'from');
  const to = parseWhen(notice.to, 'to');
  if (to && now > to) return 'expired';
  if (from && now < from) return 'upcoming';
  return 'active';
}

/** 荷下ろしを止める種類か（赤い帯で出すもの） */
export const blocksUnloading = (notice) => notice.kind === 'closed' || notice.kind === 'restricted';

/** そのお知らせが、この納入先に関係あるか（宛先が空なら全体向け） */
export function noticeAppliesTo(notice, destination) {
  if (!notice.destination) return true;
  return nameKey(notice.destination) === nameKey(destination);
}

/* ------------------------------------------------------------------
 * 現場の端末に出す情報（事務所から届いた feed の読み方）
 * ------------------------------------------------------------------ */
/**
 * 枠の残り。確定（工場の値）と見込み（現場の値）を分けて返す。
 * @param {{amountNum:string}} quota
 * @param {{confirmedNum:string, estimatedNum:string}|undefined} usage
 * @returns {{amount:bigint, confirmed:bigint, estimated:bigint, remain:bigint, over:boolean}}
 */
export function quotaRemaining(quota, usage) {
  const amount = BigInt(quota.amountNum);
  const confirmed = BigInt(usage?.confirmedNum ?? 0);
  const estimated = BigInt(usage?.estimatedNum ?? 0);
  const remain = amount - confirmed - estimated;
  return { amount, confirmed, estimated, remain, over: remain < 0n };
}

/**
 * この納入先の、いま出すべきお知らせ。止める種類（納入不可・入場制限）を先に並べる。
 * @returns {Array<object>} 掲示中（active）のものだけ。納入先が未選択なら全体向けのものだけ
 */
export function noticesFor(notices, destination, now = new Date()) {
  return (notices ?? [])
    .filter((n) => noticeState(n, now) === 'active')
    .filter((n) => (destination ? noticeAppliesTo(n, destination) : !n.destination))
    .sort((a, b) => Number(blocksUnloading(b)) - Number(blocksUnloading(a)) || b.createdAt - a.createdAt);
}

/**
 * この納入先の、いま有効な枠（期間内で、完了していないもの）。
 * @returns {Array<{quota:object, usage:object|undefined, window:ReturnType<typeof windowStatus>, left:ReturnType<typeof quotaRemaining>}>}
 */
export function quotasFor(feed, destination, now = new Date()) {
  if (!feed || !destination) return [];
  const today = dateKey(now);
  return (feed.quotas ?? [])
    .filter((q) => q.status === 'active' && q.to >= today && nameKey(q.destination) === nameKey(destination))
    .map((q) => ({ quota: q, usage: feed.usage?.[q.id], window: windowStatus(q, now), left: quotaRemaining(q, feed.usage?.[q.id]) }));
}

/** お知らせが納入を止める「いま」の状態か（納入先の指定がなければ全体向けだけを見る） */
export const isBlocked = (notices, destination, now = new Date()) =>
  noticesFor(notices, destination, now).some(blocksUnloading);

/* ------------------------------------------------------------------
 * CSV（Excelで開く前提）
 * ------------------------------------------------------------------ */
/**
 * CSVの1セル分の文字列にする。
 * ・カンマ・引用符・改行を含むなら "…" で囲む
 * ・先頭が = + - @ タブ 復帰 のセルは、Excelが「数式」として実行してしまう（CSVインジェクション）。
 *   運転手が備考欄などに入れた文字で事務員のPCが操作されないよう、先頭に ' を付けて文字として扱わせる。
 *   数値のセルは、先頭が - になることがないので、この処理を通しても変わらない。
 */
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/* ------------------------------------------------------------------
 * データの取り扱いへの同意（事務所の初期設定で取得する）
 * ------------------------------------------------------------------ */
/**
 * 同意文の版。文面（規約・プライバシーポリシーの該当部分）を変えたら、この日付を更新する。
 * 版が変わると、事務所はもう一度同意するまで、現場からの便の受信が止まる。
 * 同意の内容：運営者が事務所に共有された生データを閲覧できること、研究・販売に使うときは匿名化すること。
 */
export const CONSENT_VERSION = '2026-10-01';
