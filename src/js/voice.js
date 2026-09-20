/**
 * 音声入力（Web Speech API）
 * オンライン前提の補助機能。圏外ではボタンを無効化し、タップ入力を促す。
 */
import { normalizeDiameter } from './jas.js';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export function isVoiceSupported() {
  return Boolean(SpeechRecognition);
}

/** 音声認識は通信を使うため、圏外では使えない */
export function isVoiceAvailable() {
  return isVoiceSupported() && navigator.onLine;
}

const KANJI_DIGITS = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/**
 * 認識結果の表記揺れを吸収して数値を取り出す。
 * 「にじゅうよん」「24」「二十四」「24センチ」などをすべて 24 にする。
 * @param {string} text
 * @returns {number|null}
 */
export function parseDiameter(text) {
  if (!text) return null;
  let s = String(text).trim();
  // 全角数字→半角
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  // 単位・助詞などのノイズを除去
  s = s.replace(/(センチ|せんち|cm|ｃｍ|の|本|ほん|ミリ)/gi, '');

  const direct = s.match(/\d+/);
  if (direct) return Number(direct[0]);

  // 漢数字（十の位まで対応すれば径級6〜99cmは網羅できる）
  const kanji = s.match(/[〇零一二三四五六七八九十]+/);
  if (kanji) {
    const k = kanji[0];
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
  return null;
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
 * 連続音声認識を管理する。
 */
export class VoiceInput {
  /**
   * @param {{lang: string, onResult: (d: number, raw: string) => void, onMiss: (raw: string) => void, onStateChange: (listening: boolean) => void, getAllowed: () => number[]}} opts
   */
  constructor(opts) {
    this.opts = opts;
    this.recognition = null;
    this.listening = false;
    this.wantListening = false;
  }

  start() {
    if (!isVoiceAvailable() || this.listening) return false;
    const rec = new SpeechRecognition();
    rec.lang = this.opts.lang || 'ja-JP';
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 3;

    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        if (!result.isFinal) continue;
        const allowed = this.opts.getAllowed();
        let hit = null;
        let raw = '';
        for (let a = 0; a < result.length; a++) {
          raw = result[a].transcript;
          hit = matchDiameter(parseDiameter(raw), allowed);
          if (hit != null) break;
        }
        if (hit != null) this.opts.onResult(hit, raw);
        else this.opts.onMiss(raw);
      }
    };
    rec.onend = () => {
      this.listening = false;
      this.opts.onStateChange(false);
      // 継続指定中で、まだ通信があるなら自動で再開する
      if (this.wantListening && navigator.onLine) {
        setTimeout(() => { if (this.wantListening) this.start(); }, 250);
      }
    };
    rec.onerror = () => { /* onend で後始末される */ };

    try {
      rec.start();
    } catch {
      return false;
    }
    this.recognition = rec;
    this.listening = true;
    this.wantListening = true;
    this.opts.onStateChange(true);
    return true;
  }

  stop() {
    this.wantListening = false;
    try {
      this.recognition?.stop();
    } catch {
      /* 無視 */
    }
    this.listening = false;
    this.opts.onStateChange(false);
  }

  toggle() {
    if (this.wantListening) this.stop();
    else this.start();
  }
}
