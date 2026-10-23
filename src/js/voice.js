/**
 * 音声入力（Web Speech API）
 * オンライン前提の補助機能。圏外ではボタンを無効化し、タップ入力を促す。
 * 認識結果から径級を取り出す部分は voice-parse.js（「18、22、22、24」のように続けて読み上げた分も全部入れる）。
 */
import { bestReading, parseDiameter, matchDiameter } from './voice-parse.js';

export { parseDiameter, matchDiameter };

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export function isVoiceSupported() {
  return Boolean(SpeechRecognition);
}

/** 音声認識は通信を使うため、圏外では使えない */
export function isVoiceAvailable() {
  return isVoiceSupported() && navigator.onLine;
}

/**
 * 連続音声認識を管理する。
 */
export class VoiceInput {
  /**
   * @param {{lang: string, onBatch: (r: {hits:number[], misses:Array<number|null>, raw:string}) => void, onMiss: (raw: string) => void, onStateChange: (listening: boolean) => void, getAllowed: () => number[]}} opts
   *   onBatch … 1回の読み上げで入れられる径級（hits、読み上げた順）と、入れられなかった数（misses）
   *   onMiss  … 入れられる径級が1つもなかったとき
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
        const transcripts = [];
        for (let a = 0; a < result.length; a++) transcripts.push(result[a].transcript);
        const best = bestReading(transcripts, this.opts.getAllowed());
        if (best.hits.length > 0) this.opts.onBatch(best);
        else this.opts.onMiss(best.raw);
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
