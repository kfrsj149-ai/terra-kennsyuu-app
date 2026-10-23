/**
 * 準備画面の「前回の設定」
 * ------------------------------------------------------------------
 * 計測を始めたときの設定（樹種・長さ・径級の範囲・車番・現場・納入先・自社名）を端末に覚えておき、
 * 次に準備画面を開いたときに初期入力する。違うところだけ選び直す。
 * 備考は、その伝票だけの内容なので覚えない（毎回空欄）。
 * 選択式の項目は、いまの選択肢に無い値（削除した・休みにした）なら空に戻す。
 */

export const LAST_SETUP_KEY = 'lastSetup';

/** 覚える項目。備考は含めない */
const TEXT_FIELDS = ['species', 'lengthM'];
const CHOICE_FIELDS = ['truck', 'site', 'destination', 'ownCompany'];

/**
 * 保存する内容を作る。
 * @param {{species?:string, lengthM?:string, minD?:number, maxD?:number, truck?:string, site?:string, destination?:string, ownCompany?:string}} setup
 */
export function lastSetupOf(setup) {
  const out = {};
  for (const key of [...TEXT_FIELDS, ...CHOICE_FIELDS]) out[key] = String(setup?.[key] ?? '').trim();
  out.minD = Number(setup?.minD);
  out.maxD = Number(setup?.maxD);
  return out;
}

/**
 * 保存した前回の設定のうち、いま入れてよいものだけを返す。
 * @param {object|null} saved 保存した内容
 * @param {{truck?:string[], site?:string[], destination?:string[], ownCompany?:string[]}} choices いまの選択肢
 * @returns {{species:string, lengthM:string, minD:number|null, maxD:number|null, truck:string, site:string, destination:string, ownCompany:string, any:boolean}}
 */
export function restorableLastSetup(saved, choices = {}) {
  const r = { species: '', lengthM: '', minD: null, maxD: null, truck: '', site: '', destination: '', ownCompany: '', any: false };
  if (!saved || typeof saved !== 'object') return r;
  for (const key of TEXT_FIELDS) r[key] = String(saved[key] ?? '');
  for (const key of CHOICE_FIELDS) {
    const value = String(saved[key] ?? '');
    r[key] = value && (choices[key] ?? []).includes(value) ? value : '';
  }
  const min = Number(saved.minD);
  const max = Number(saved.maxD);
  if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && min <= max) { r.minD = min; r.maxD = max; }
  r.any = Boolean(r.species || r.lengthM || r.minD !== null || CHOICE_FIELDS.some((k) => r[k]));
  return r;
}
