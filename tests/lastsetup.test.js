/**
 * 準備画面の「前回の設定」
 * 計測を始めた設定を覚えて、次の準備画面で初期入力する。備考は覚えない。選択肢に無い値は空に戻す。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lastSetupOf, restorableLastSetup, LAST_SETUP_KEY } from '../src/js/lastsetup.js';
import ja from '../src/js/locales/ja.js';

const setup = { species: 'カラマツ', lengthM: '2', minD: 18, maxD: 50, truck: '21', site: 'テスト1', destination: '丸太工場', ownCompany: '丸々林業', note: '雨で遅れ' };
const CHOICES = { truck: ['21', '22'], site: ['テスト1'], destination: ['丸太工場'], ownCompany: ['丸々林業'] };

test('覚えるのは、樹種・長さ・径級の範囲・車番・現場・納入先・自社名。備考は覚えない', () => {
  const saved = lastSetupOf(setup);
  assert.deepEqual(saved, { species: 'カラマツ', lengthM: '2', minD: 18, maxD: 50, truck: '21', site: 'テスト1', destination: '丸太工場', ownCompany: '丸々林業' });
  assert.equal('note' in saved, false);
  assert.equal(LAST_SETUP_KEY, 'lastSetup');
});

test('前回の設定を、そのまま初期入力として返す', () => {
  const r = restorableLastSetup(lastSetupOf(setup), CHOICES);
  assert.deepEqual(r, { species: 'カラマツ', lengthM: '2', minD: 18, maxD: 50, truck: '21', site: 'テスト1', destination: '丸太工場', ownCompany: '丸々林業', any: true });
});

test('選択肢にもう無い値（削除した・休みにした車番など）は、空に戻す。ほかの項目は入れる', () => {
  const r = restorableLastSetup(lastSetupOf(setup), { ...CHOICES, truck: ['22'], site: [] });
  assert.equal(r.truck, '');
  assert.equal(r.site, '');
  assert.equal(r.species, 'カラマツ');
  assert.equal(r.destination, '丸太工場');
  assert.equal(r.any, true);
});

test('保存が無い・壊れている・範囲が不正なときは、何も入れない（または範囲だけ入れない）', () => {
  for (const bad of [null, undefined, 'x', 5]) {
    const r = restorableLastSetup(bad, CHOICES);
    assert.equal(r.any, false);
    assert.equal(r.species, '');
    assert.equal(r.minD, null);
  }
  const r = restorableLastSetup({ species: 'スギ', lengthM: '4', minD: 50, maxD: 18 }, CHOICES);
  assert.equal(r.minD, null);
  assert.equal(r.maxD, null);
  assert.equal(r.species, 'スギ');
  assert.equal(restorableLastSetup({ minD: 'a', maxD: 'b' }, CHOICES).minD, null);
});

test('保存時に前後の空白を取り、足りない項目は空にする', () => {
  const saved = lastSetupOf({ species: ' スギ ', lengthM: '4', minD: 14, maxD: 30 });
  assert.equal(saved.species, 'スギ');
  assert.equal(saved.truck, '');
  assert.equal(saved.ownCompany, '');
});

test('画面：開始確認で車番と現場を見せ、準備画面に「前回の設定」の案内がある', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/js/app.js', import.meta.url), 'utf8');
  assert.match(html, /id="start-detail"/);
  assert.match(html, /id="prefill-note"/);
  // 開始確認に車番と現場を出す／はいを押したら前回の設定として覚える
  assert.match(app, /\[t\('setup\.truck'\), setup\.truck\][\s\S]*#start-detail/);
  assert.match(app, /t\('setup\.site'\), setup\.site/);
  assert.match(app, /saveLastSetup\(setup\)/);
  // 起動時・ホームへ戻ったとき・出力が終わったときに、前回の設定を入れる
  assert.ok((app.match(/await applyLastSetup\(\)/g) ?? []).length >= 3);
  assert.ok(ja['setup.prefilled']);
});
