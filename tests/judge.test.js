/* judge.js 的单元测试（归一化 + 两个方向的判定）
 * 跑法：npm test（即 package.json 里的 test 脚本）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { extractPos, judgeEn2Zh, judgeZh2En, lev, normAnswer, normTerm, splitMeanings } from '../src/judge.js';

// ---------------------------------------------------------------- 归一化

test('normTerm：词的"身份"，只统一大小写/全角/空白，保留标点', () => {
  assert.equal(normTerm('  Ice Cream '), 'ice cream');
  assert.equal(normTerm('Ice   CREAM'), 'ice cream');
  assert.equal(normTerm('ＡＢＣ'), 'abc');
  assert.equal(normTerm("can't"), "can't", '撇号要留着，can\'t 和 cant 是不同词');
  assert.equal(normTerm('well-known'), 'well-known');
});

test('normAnswer：判答案用，标点和空格都扔掉', () => {
  assert.equal(normAnswer('  Ice-Cream! '), 'icecream');
  assert.equal(normAnswer('苹果。'), '苹果');
  assert.equal(normAnswer('ａｂｃ'), 'abc');
  assert.equal(normAnswer('跑、奔'), '跑奔');
  assert.equal(normAnswer(''), '');
  assert.equal(normAnswer(null), '');
});

test('编辑距离（相邻字符打反算 1 步）', () => {
  assert.equal(lev('kitten', 'sitting'), 3);
  assert.equal(lev('abc', 'abc'), 0);
  assert.equal(lev('', 'abc'), 3);
  assert.equal(lev('书中', '书中'), 0);
  assert.equal(lev('书中', '书'), 1);
  assert.equal(lev('recieve', 'receive'), 1, '把 ie 打反是最常见的错法，只该算 1 步');
});

test('释义拆分', () => {
  assert.deepEqual(splitMeanings('跑；奔跑, 经营'), ['跑', '奔跑', '经营']);
  assert.deepEqual(splitMeanings('你好, 世界'), ['你好', '世界']);
  assert.deepEqual(splitMeanings(''), []);
  assert.deepEqual(splitMeanings('  '), []);
});

test('词性从释义里拎出来', () => {
  assert.deepEqual(extractPos(['v. 跑', 'n. 奔跑']), { pos: 'v.', meanings: ['跑', '奔跑'] });
  assert.deepEqual(extractPos(['苹果']), { pos: '', meanings: ['苹果'] });
  assert.deepEqual(extractPos(['adj 好的']), { pos: 'adj.', meanings: ['好的'] });
});

// ---------------------------------------------------------------- 英 → 中

test('英译中：命中任意一条释义就算对', () => {
  assert.deepEqual(judgeEn2Zh('苹果', ['苹果', '果实']), { ok: true, near: false });
  assert.deepEqual(judgeEn2Zh('果实', ['苹果', '果实']), { ok: true, near: false });
});

test('英译中：自己写了多条、命中其中一条也算对', () => {
  assert.equal(judgeEn2Zh('苹果；果实', ['苹果']).ok, true);
  assert.equal(judgeEn2Zh('苹果, 果实', ['果实']).ok, true);
});

test('英译中：忽略标点、空格、大小写、全角', () => {
  assert.equal(judgeEn2Zh(' 苹果。 ', ['苹果']).ok, true);
  assert.equal(judgeEn2Zh('ＡＰＰＬＥ', ['apple']).ok, true);
});

test('英译中：差一个字给"算我对"的机会，但不直接判对', () => {
  assert.deepEqual(judgeEn2Zh('苹里', ['苹果']), { ok: false, near: true });
  assert.deepEqual(judgeEn2Zh('苹果树', ['苹果']), { ok: false, near: true });
});

test('英译中：差太多的不给 near', () => {
  assert.deepEqual(judgeEn2Zh('香蕉', ['苹果']), { ok: false, near: false });
  assert.deepEqual(judgeEn2Zh('', ['苹果']), { ok: false, near: false });
});

test('英译中：单个字不玩"差点"（太容易蒙）', () => {
  assert.deepEqual(judgeEn2Zh('跑', ['书']), { ok: false, near: false });
  assert.deepEqual(judgeEn2Zh('画', ['书']), { ok: false, near: false });
});

test('英译中：释义里带词性也能判对', () => {
  assert.equal(judgeEn2Zh('跑', ['v. 跑']).ok, true);
  assert.equal(judgeEn2Zh('奔跑', ['v. 跑', 'n. 奔跑']).ok, true);
});

test('英译中：没有释义时不炸', () => {
  assert.deepEqual(judgeEn2Zh('苹果', []), { ok: false, near: false });
  assert.deepEqual(judgeEn2Zh('苹果', undefined), { ok: false, near: false });
});

// ---------------------------------------------------------------- 中 → 英

test('中译英：忽略大小写和首尾空格', () => {
  assert.equal(judgeZh2En('Ice cream', 'ice cream').ok, true);
  assert.equal(judgeZh2En('  apple ', 'apple').ok, true);
  assert.equal(judgeZh2En('APPLE', 'apple').ok, true);
});

test('中译英：内部空格不能吞（ice cream ≠ icecream，只是"差点"）', () => {
  assert.deepEqual(judgeZh2En('icecream', 'ice cream'), { ok: false, near: true });
});

test('中译英：拼错一个字母 → 差点，先让人再试一次', () => {
  assert.deepEqual(judgeZh2En('recieve', 'receive'), { ok: false, near: true });
  assert.deepEqual(judgeZh2En('cat', 'cats'), { ok: false, near: true });
});

test('中译英：差太多的不给 near', () => {
  assert.deepEqual(judgeZh2En('banana', 'apple'), { ok: false, near: false });
  assert.deepEqual(judgeZh2En('', 'apple'), { ok: false, near: false });
});

test('中译英：短词不玩"差点"', () => {
  assert.deepEqual(judgeZh2En('cat', 'at'), { ok: false, near: false });
  assert.deepEqual(judgeZh2En('is', 'in'), { ok: false, near: false });
});

test('中译英：撇号要算数（can\'t ≠ cant）', () => {
  assert.deepEqual(judgeZh2En('cant', "can't"), { ok: false, near: true });
});
