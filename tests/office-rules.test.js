import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ID_ALPHABET, isValidId, normalizeName, nameKey, validateSiteName, findSiteByName, resolveSiteId,
  parseM3, parseHm, windowStatus, noticeState, blocksUnloading, noticeAppliesTo, SITE_NAME_MAX,
} from '../src/js/office-rules.js';
import { VOLUME_DENOMINATOR, formatVolume } from '../src/js/jas.js';

test('IDの文字種：紛らわしい I L O U を含まない32文字', () => {
  assert.equal(ID_ALPHABET.length, 32);
  for (const c of 'ILOU') assert.ok(!ID_ALPHABET.includes(c));
  assert.ok(isValidId('7K3QX9AB'));
  assert.ok(!isValidId('7K3QX9A'));      // 7文字
  assert.ok(!isValidId('7K3QX9AI'));     // I は使わない
  assert.ok(!isValidId('7k3qx9ab'));     // 小文字は不可
  assert.ok(!isValidId(null));
});

test('名前の整え方：全角英数・空白・制御文字', () => {
  assert.equal(normalizeName('  ＨＯＮ谷　２号\t'), 'HON谷 2号');
  assert.equal(normalizeName('本谷\n2号'), '本谷 2号');
  assert.equal(normalizeName('ﾎﾝﾀﾞﾆ'), 'ホンダニ');
  assert.equal(normalizeName(null), '');
});

test('名前のキー：空白の違い・全角半角・英字の大小を同一視する', () => {
  assert.equal(nameKey('本谷 2号'), nameKey('本谷2号'));
  assert.equal(nameKey('ＡＢｃ'), nameKey('abc'));
  assert.notEqual(nameKey('本谷'), nameKey('向かい沢'));
});

test('現場名の検査：空・長すぎ', () => {
  assert.deepEqual(validateSiteName('  '), { ok: false, error: 'empty' });
  assert.equal(validateSiteName('あ'.repeat(SITE_NAME_MAX)).ok, true);
  assert.deepEqual(validateSiteName('あ'.repeat(SITE_NAME_MAX + 1)), { ok: false, error: 'too_long' });
  assert.equal(validateSiteName(' 本谷 ').name, '本谷');
});

test('名前・別名の重なり検出と、記録の現場名からのID引き当て', () => {
  const sites = [
    { id: 'AAAAAAAA', name: '本谷', aliases: ['ホンダニ', '本谷山'] },
    { id: 'BBBBBBBB', name: '向かい沢', aliases: [] },
  ];
  assert.equal(findSiteByName(sites, '本谷 ')?.id, 'AAAAAAAA');
  assert.equal(findSiteByName(sites, 'ﾎﾝﾀﾞﾆ')?.id, 'AAAAAAAA');       // 半角カナの別名
  assert.equal(findSiteByName(sites, '向かい 沢')?.id, 'BBBBBBBB');
  assert.equal(findSiteByName(sites, '本谷', 'AAAAAAAA'), null);       // 自分自身は除く
  assert.equal(resolveSiteId(sites, '本谷山'), 'AAAAAAAA');
  assert.equal(resolveSiteId(sites, '知らない山'), null);
  assert.equal(resolveSiteId(null, '本谷'), null);
});

test('m³の入力を jas.js と同じ内部単位に直す', () => {
  assert.equal(parseM3('1'), VOLUME_DENOMINATOR);
  assert.equal(formatVolume(parseM3('12.345')), '12.345');
  assert.equal(formatVolume(parseM3('０．５')), '0.500');      // 全角
  assert.equal(parseM3('1.2345'), null);                       // 4桁目は不可
  assert.equal(parseM3('abc'), null);
  assert.equal(parseM3(''), null);
  assert.equal(parseM3('-1'), null);
});

test('時刻の読み取り', () => {
  assert.equal(parseHm('6:00'), 360);
  assert.equal(parseHm('18:30'), 1110);
  assert.equal(parseHm('24:00'), 1440);
  assert.equal(parseHm('24:30'), null);
  assert.equal(parseHm('25:00'), null);
  assert.equal(parseHm('6'), null);
});

// 2026-10-05 は月曜
const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm);

test('枠の窓：曜日と時間帯の中なら荷下ろしできる', () => {
  const q = { from: '2026-10-01', to: '2026-10-31', weekdays: [1, 2, 3, 4, 5], timeFrom: '06:00', timeTo: '17:00' };
  assert.deepEqual(windowStatus(q, at(2026, 10, 5, 9, 0)), { open: true, reason: null, nextOpenAt: null });
});

test('枠の窓：時間外は次に開く時刻を返す（同日の朝／翌営業日）', () => {
  const q = { from: '2026-10-01', to: '2026-10-31', weekdays: [1, 2, 3, 4, 5], timeFrom: '06:00', timeTo: '17:00' };
  const early = windowStatus(q, at(2026, 10, 5, 4, 0));
  assert.equal(early.open, false); assert.equal(early.reason, 'time');
  assert.deepEqual(early.nextOpenAt, at(2026, 10, 5, 6, 0));
  const late = windowStatus(q, at(2026, 10, 5, 17, 0));
  assert.equal(late.reason, 'time');
  assert.deepEqual(late.nextOpenAt, at(2026, 10, 6, 6, 0));
});

test('枠の窓：土日は休み。金曜の夜は月曜の朝が次', () => {
  const q = { from: '2026-10-01', to: '2026-10-31', weekdays: [1, 2, 3, 4, 5], timeFrom: '06:00', timeTo: '17:00' };
  const sat = windowStatus(q, at(2026, 10, 10, 10, 0));
  assert.equal(sat.reason, 'weekday');
  assert.deepEqual(sat.nextOpenAt, at(2026, 10, 12, 6, 0));
});

test('枠の窓：期間前・期間後・曜日と時間帯を省略したとき', () => {
  const q = { from: '2026-10-10', to: '2026-10-20' };
  assert.equal(windowStatus(q, at(2026, 10, 9, 12)).reason, 'before');
  assert.deepEqual(windowStatus(q, at(2026, 10, 9, 12)).nextOpenAt, at(2026, 10, 10, 0, 0));
  assert.equal(windowStatus(q, at(2026, 10, 21, 12)).reason, 'after');
  assert.equal(windowStatus(q, at(2026, 10, 21, 12)).nextOpenAt, null);
  assert.equal(windowStatus(q, at(2026, 10, 15, 3)).open, true);       // 終日・毎日
});

test('お知らせの期間：日付だけなら終日、期限が切れたら畳む', () => {
  const n = { from: '2026-10-10', to: '2026-10-12' };
  assert.equal(noticeState(n, at(2026, 10, 9, 23, 59)), 'upcoming');
  assert.equal(noticeState(n, at(2026, 10, 10, 0, 0)), 'active');
  assert.equal(noticeState(n, at(2026, 10, 12, 23, 58)), 'active');
  assert.equal(noticeState(n, at(2026, 10, 13, 0, 1)), 'expired');
  assert.equal(noticeState({ from: '', to: '' }, at(2030, 1, 1)), 'active');
  assert.equal(noticeState({ from: '2026-10-10T08:00', to: '2026-10-10T12:00' }, at(2026, 10, 10, 12, 1)), 'expired');
});

test('お知らせの種類と宛先', () => {
  assert.ok(blocksUnloading({ kind: 'closed' }));
  assert.ok(blocksUnloading({ kind: 'restricted' }));
  assert.ok(!blocksUnloading({ kind: 'info' }));
  assert.ok(noticeAppliesTo({ destination: '' }, '秋田プライウッド'));
  assert.ok(noticeAppliesTo({ destination: '秋田 プライウッド' }, '秋田プライウッド'));
  assert.ok(!noticeAppliesTo({ destination: '別の工場' }, '秋田プライウッド'));
});

import { quotaRemaining, noticesFor, quotasFor, isBlocked } from '../src/js/office-rules.js';

test('枠の残り：確定と見込みを引く。超えたら over', () => {
  const q = { amountNum: String(400n * 40_000_000_000n / 1n) };      // 400 m³
  const r = quotaRemaining(q, { confirmedNum: String(100n * 40_000_000_000n), estimatedNum: String(50n * 40_000_000_000n) });
  assert.equal(formatVolume(r.remain), '250.000');
  assert.equal(r.over, false);
  const o = quotaRemaining(q, { confirmedNum: String(450n * 40_000_000_000n), estimatedNum: '0' });
  assert.equal(o.over, true);
  assert.equal(formatVolume(-o.remain), '50.000');
  assert.equal(quotaRemaining(q, undefined).remain, r.amount);
});

test('お知らせの出し分け：宛先・期間・止める種類が先', () => {
  const now = at(2026, 10, 5, 9, 0);
  const notices = [
    { id: '1', kind: 'info', destination: '', from: '', to: '', createdAt: 3 },
    { id: '2', kind: 'closed', destination: '秋田プライウッド', from: '2026-10-05', to: '2026-10-06', createdAt: 1 },
    { id: '3', kind: 'restricted', destination: '', from: '2026-10-01', to: '2026-10-31', createdAt: 2 },
    { id: '4', kind: 'closed', destination: '別の工場', from: '', to: '', createdAt: 4 },
    { id: '5', kind: 'closed', destination: '秋田プライウッド', from: '2026-09-01', to: '2026-09-02', createdAt: 5 },   // 終了
    { id: '6', kind: 'closed', destination: '秋田プライウッド', from: '2026-10-09', to: '', createdAt: 6 },             // 予告
  ];
  assert.deepEqual(noticesFor(notices, '秋田プライウッド', now).map((n) => n.id), ['3', '2', '1']);
  assert.deepEqual(noticesFor(notices, '別の工場', now).map((n) => n.id), ['4', '3', '1']);
  assert.deepEqual(noticesFor(notices, '', now).map((n) => n.id), ['3', '1']);       // 納入先未選択：全体向けだけ
  assert.ok(isBlocked(notices, '秋田プライウッド', now));
  assert.ok(!isBlocked([notices[0]], '秋田プライウッド', now));
});

test('納入先に合う枠だけを返す（表記ゆれ吸収・期間外と完了は除く）', () => {
  const feed = {
    quotas: [
      { id: 'a', status: 'active', destination: '秋田 プライウッド', from: '2026-10-01', to: '2026-10-31', amountNum: '40000000000' },
      { id: 'b', status: 'archived', destination: '秋田プライウッド', from: '2026-10-01', to: '2026-10-31', amountNum: '1' },
      { id: 'c', status: 'active', destination: '秋田プライウッド', from: '2026-08-01', to: '2026-08-31', amountNum: '1' },
      { id: 'd', status: 'active', destination: '別の工場', from: '2026-10-01', to: '2026-10-31', amountNum: '1' },
    ],
    usage: { a: { confirmedNum: '0', estimatedNum: '20000000000' } },
  };
  const hit = quotasFor(feed, '秋田プライウッド', at(2026, 10, 5, 9, 0));
  assert.deepEqual(hit.map((h) => h.quota.id), ['a']);
  assert.equal(formatVolume(hit[0].left.remain), '0.500');
  assert.deepEqual(quotasFor(feed, '', at(2026, 10, 5)), []);
  assert.deepEqual(quotasFor(null, '工場'), []);
});
