/**
 * 音声認識の結果（文字）から、径級の数値を取り出す部分。
 * ブラウザの音声認識（window）に触らないので、単体でテストできる。
 *
 * 「18、22、22、24」のように続けて読み上げたときは、全部を順番に取り出す。
 */
import { normalizeDiameter } from './jas.js';

const KANJI_DIGITS = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 1回の読み上げで受け付ける最大の数。これを超えるときは雑音とみなし、超えた分は取り込まない */
export const MAX_PER_UTTERANCE = 20;

/** 漢数字（十の位まで対応すれば径級6〜99cmは網羅できる） */
function kanjiValue(k) {
  if (k.includes('十')) {
    const [tens, ones] = k.split('十');
    const t = tens === '' ? 1 : KANJI_DIGITS[tens] ?? 0;
    const o = ones ? KANJI_DIGITS[ones] ?? 0 : 0;
    return t * 10 + o;
  }
  let n = 0;
  for (const ch of k) n = n * 10 + (KANJI_DIGITS[ch] ?? 0);
  return n || null;
}

/**
 * 認識結果から、数値を出てくる順にすべて取り出す。
 * 「にじゅうよん」「24」「二十四」「24センチ」「18 22 22 24」「18、22、22、24」に対応。
 * くっついて聞き取られた「1822」のような数字は、2桁ずつに分けられるときだけ分ける。
 * 分けられない数字（3桁・5桁など）は、間違って入れないよう null にして、あとで「聞き取れず」と知らせる。
 * @param {string} text
 * @returns {Array<number|null>}
 */
export function parseDiameters(text) {
  if (!text) return [];
  let s = String(text).trim();
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));   // 全角数字→半角
  s = s.replace(/(センチ|せんち|cm|ｃｍ|の|本|ほん|ミリ)/gi, '');                       // 単位・助詞などのノイズ
  const out = [];
  for (const m of s.matchAll(/\d+|[〇零一二三四五六七八九十]+/g)) {
    const token = m[0];
    if (/^\d+$/.test(token)) {
      if (token.length <= 2) out.push(Number(token));
      else if (token.length % 2 === 0) for (let i = 0; i < token.length; i += 2) out.push(Number(token.slice(i, i + 2)));
      else out.push(null);
    } else {
      out.push(kanjiValue(token));
    }
  }
  return out;
}

/**
 * 認識結果から、最初の数値を取り出す（1つだけ読み上げたとき用）。
 * @param {string} text
 * @returns {number|null}
 */
export function parseDiameter(text) {
  return parseDiameters(text)[0] ?? null;
}

/**
 * 認識した数値を、対象範囲内の有効な径級へ寄せる。範囲外は null。
 * @param {number|null} value
 * @param {number[]} allowed 表示中の径級一覧
 */
export function matchDiameter(value, allowed) {
  if (value == null || !allowed.length) return null;
  const n = normalizeDiameter(value);
  if (allowed.includes(n)) return n;
  return null;
}

/**
 * 取り出した数値を、入れられるもの（hits）と、入れないもの（misses）に分ける。
 * 順番は読み上げた順のまま。同じ径級が続いても、そのまま本数として数える。
 * @param {Array<number|null>} values
 * @param {number[]} allowed
 * @returns {{hits:number[], misses:Array<number|null>}}
 */
export function matchDiameters(values, allowed) {
  const hits = [];
  const misses = [];
  values.forEach((v, i) => {
    if (i >= MAX_PER_UTTERANCE) { misses.push(v); return; }
    const hit = matchDiameter(v, allowed);
    if (hit == null) misses.push(v);
    else hits.push(hit);
  });
  return { hits, misses };
}

/**
 * 認識エンジンが返す候補（最大3つ）のうち、いちばん多く入れられるものを選ぶ。
 * 同点なら、エンジンが最も確からしいとした先頭の候補を使う。
 * @param {string[]} transcripts
 * @param {number[]} allowed
 * @returns {{raw:string, hits:number[], misses:Array<number|null>}}
 */
export function bestReading(transcripts, allowed) {
  let best = null;
  for (const raw of transcripts) {
    const { hits, misses } = matchDiameters(parseDiameters(raw), allowed);
    const score = hits.length * 2 - misses.length;
    if (!best || score > best.score) best = { raw, hits, misses, score };
  }
  return best ? { raw: best.raw, hits: best.hits, misses: best.misses } : { raw: '', hits: [], misses: [] };
}
