/**
 * 購入リンクと価格の表示を、日付で切り替える。
 * 2026-12-31 までの申込は、初年度の特典（2台目から5,000円）のリンク。2027-01-01 からは通常のリンク。
 * 日付は日本時間で数える（端末の時計を使う。確認が要る場面ではないので、サーバーには聞かない）。
 */
import { CONFIG } from './config.js';

const JST_MS = 9 * 3600_000;

/** @param {number} [now] ミリ秒 @returns {string} 日本時間の YYYY-MM-DD */
export function jstDate(now = Date.now()) {
  return new Date(now + JST_MS).toISOString().slice(0, 10);
}

/** 初年度の特典の期間中か */
export function isEarlyPeriod(now = Date.now(), cfg = CONFIG.stripe) {
  return Boolean(cfg.earlyCheckoutUrl) && jstDate(now) <= cfg.earlyUntil;
}

export function checkoutUrl(now = Date.now(), cfg = CONFIG.stripe) {
  return isEarlyPeriod(now, cfg) ? cfg.earlyCheckoutUrl : cfg.checkoutUrl;
}

export function priceLabel(now = Date.now(), cfg = CONFIG.stripe) {
  return isEarlyPeriod(now, cfg) ? cfg.earlyPriceLabel : cfg.priceLabel;
}
