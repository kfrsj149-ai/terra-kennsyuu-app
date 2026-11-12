import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/js/config.js';
import { jstDate, isEarlyPeriod, checkoutUrl, priceLabel } from '../src/js/pricing.js';

const at = (iso) => Date.parse(iso);

test('日付は日本時間で数える。12月31日の終わりまでは特典のリンク、1月1日（日本時間）からは通常のリンク', () => {
  assert.equal(jstDate(at('2026-12-31T14:59:59Z')), '2026-12-31');   // 日本時間 23:59:59
  assert.equal(jstDate(at('2026-12-31T15:00:00Z')), '2027-01-01');   // 日本時間 0:00
  assert.equal(isEarlyPeriod(at('2026-12-31T14:59:59Z')), true);
  assert.equal(isEarlyPeriod(at('2026-12-31T15:00:00Z')), false);
  assert.equal(checkoutUrl(at('2026-11-12T00:00:00Z')), CONFIG.stripe.earlyCheckoutUrl);
  assert.equal(checkoutUrl(at('2027-01-01T00:00:00Z')), CONFIG.stripe.checkoutUrl);
});

test('特典のリンクが無い設定なら、いつでも通常のリンク', () => {
  const cfg = { ...CONFIG.stripe, earlyCheckoutUrl: '' };
  assert.equal(checkoutUrl(at('2026-11-12T00:00:00Z'), cfg), cfg.checkoutUrl);
});

test('アプリ内の価格表示は、特商法の金額と一致している（1台目9,800円・2台目から7,500円／特典の期間は5,000円・すべて税込）', () => {
  const law = readFileSync(new URL('../legal/tokushoho/index.html', import.meta.url), 'utf8');
  for (const amount of ['9,800円', '7,500円', '5,000円', '150,000円']) assert.ok(law.includes(amount), amount);
  assert.match(priceLabel(at('2027-02-01T00:00:00Z')), /9,800円.*7,500円.*税込/);
  assert.match(priceLabel(at('2026-11-12T00:00:00Z')), /9,800円.*5,000円.*初年度のみ.*税込/);
  assert.notEqual(priceLabel(at('2026-11-12T00:00:00Z')), priceLabel(at('2027-02-01T00:00:00Z')));
});
