import test from 'node:test';
import assert from 'node:assert/strict';
import { specsFor, specSetup, specStillMatches, destinationKeys } from '../src/js/specs.js';

const feed = {
  masters: { destinations: [{ id: 'd1', name: '秋田プライウッド', aliases: ['秋田PW'] }] },
  specs: [
    { id: 's1', name: '3m 柱取り', destination: '秋田プライウッド', species: 'スギ', lengthM: '3', minD: 14, maxD: 30, grade: 'A材' },
    { id: 's2', name: '合板用', destination: '秋田PW', species: '', lengthM: '', minD: null, maxD: null, grade: '合板用' },
    { id: 's3', name: '4m', destination: '二和木材', species: 'カラマツ', lengthM: '4', minD: 16, maxD: 40, grade: '' },
  ],
};

test('選んだ納入先の規格だけが、名前の順に出る（別名・全角半角・空白は同じ相手）', () => {
  assert.deepEqual(specsFor(feed, '秋田プライウッド').map((x) => x.id), ['s1', 's2']);   // 別名で登録された規格（秋田PW）も同じ納入先。名前の順
  assert.equal(specsFor(feed, '秋田ＰＷ').length, 2);                         // 全角でも、別名として同じ
  assert.deepEqual(specsFor(feed, '二和木材').map((x) => x.id), ['s3']);
  assert.deepEqual(specsFor(feed, '知らない工場'), []);
  assert.deepEqual(specsFor(feed, ''), []);
  assert.deepEqual(specsFor(null, '二和木材'), []);
  assert.ok(destinationKeys(feed, '秋田プライウッド').size >= 2);
});

test('規格を選ぶと入る値。空の項目は変えない。太さは有効な径級に丸める', () => {
  assert.deepEqual(specSetup(feed.specs[0]), { species: 'スギ', lengthM: '3', minD: 14, maxD: 30 });
  assert.deepEqual(specSetup(feed.specs[1]), { species: '', lengthM: '', minD: null, maxD: null });
  assert.deepEqual(specSetup({ minD: 15, maxD: 31 }), { species: '', lengthM: '', minD: 16, maxD: 32 });   // 14cm以上は2cm刻み
});

test('手で変えたら、規格の選択は外れる。規格に空の項目があれば、その項目は何でもよい', () => {
  const same = { species: 'スギ', lengthRaw: '3.00', minD: 14, maxD: 30 };
  assert.equal(specStillMatches(feed.specs[0], same), true);                   // 3 と 3.00 は同じ
  assert.equal(specStillMatches(feed.specs[0], { ...same, species: 'ヒノキ' }), false);
  assert.equal(specStillMatches(feed.specs[0], { ...same, lengthRaw: '4' }), false);
  assert.equal(specStillMatches(feed.specs[0], { ...same, maxD: 32 }), false);
  assert.equal(specStillMatches(feed.specs[1], { species: '何でも', lengthRaw: '12', minD: 6, maxD: 72 }), true);
});
