/**
 * 多言語対応。辞書は src/js/locales/*.js に1言語1ファイル。
 * UI文言もCSVヘッダーもすべてここを通す（1か所変更で全体反映）。
 */
import ja from './locales/ja.js';
import vi from './locales/vi.js';
import tl from './locales/tl.js';
import th from './locales/th.js';
import ms from './locales/ms.js';

export const LOCALES = {
  ja: { label: '日本語', dict: ja },
  vi: { label: 'Tiếng Việt', dict: vi },
  tl: { label: 'Tagalog', dict: tl },
  th: { label: 'ไทย', dict: th },
  ms: { label: 'Bahasa Melayu', dict: ms },
};

export const DEFAULT_LOCALE = 'ja';

let current = DEFAULT_LOCALE;

/** ブラウザの言語設定から対応言語を推定する */
export function detectLocale() {
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
  for (const raw of candidates) {
    const lang = String(raw).toLowerCase();
    const base = lang.split('-')[0];
    if (base === 'fil') return 'tl'; // フィリピン語はタガログ語として扱う
    if (LOCALES[base]) return base;
  }
  return DEFAULT_LOCALE;
}

export function setLocale(locale) {
  current = LOCALES[locale] ? locale : DEFAULT_LOCALE;
  document.documentElement.lang = current;
  return current;
}

export function getLocale() {
  return current;
}

/**
 * 文言を取得する。{name} 形式のプレースホルダを params で置換する。
 * 未翻訳のキーは日本語にフォールバックし、それも無ければキーをそのまま返す。
 */
export function t(key, params) {
  const dict = LOCALES[current]?.dict ?? ja;
  let s = dict[key] ?? ja[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/**
 * data-i18n / data-i18n-placeholder / data-i18n-aria を持つ要素を一括で翻訳する。
 * @param {ParentNode} root
 */
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
}
