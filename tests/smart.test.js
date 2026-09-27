/* smart.js 的单元测试（智能库：生疏词 / 熟记词）
 * 跑法：npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { SMART_LIBS, isSmartId, smartCount, smartDef, smartWordIds } from '../src/smart.js';

const data = {
  words: [
    { id: 'w1', term: 'apply' },
    { id: 'w2', term: 'research' },
    { id: 'w3', term: 'absorb' },
    { id: 'w4', term: 'gone', deleted: true },
    { id: 'w5', term: 'never-studied' }
  ],
  progs: {
    w1: { wordId: 'w1', level: 'unfamiliar', levelAt: 300 },
    w2: { wordId: 'w2', level: 'unfamiliar', levelAt: 500 },
    w3: { wordId: 'w3', level: 'known', levelAt: 400 },
    w4: { wordId: 'w4', level: 'unfamiliar', levelAt: 900 }
  }
};

test('生疏词库 = 标了生疏的词', () => {
  assert.deepEqual(smartWordIds(data, 'smart:unfamiliar'), ['w2', 'w1'], '按最近标记的排前面');
});

test('熟记词库 = 标了熟记的词', () => {
  assert.deepEqual(smartWordIds(data, 'smart:known'), ['w3']);
});

test('没标过级的词不进任何智能库', () => {
  const all = [...smartWordIds(data, 'smart:unfamiliar'), ...smartWordIds(data, 'smart:known')];
  assert.ok(!all.includes('w5'), '没学过、没标级的词不该出现');
});

test('软删除的词不进智能库', () => {
  assert.ok(!smartWordIds(data, 'smart:unfamiliar').includes('w4'));
});

test('数量统计', () => {
  assert.equal(smartCount(data, 'smart:unfamiliar'), 2);
  assert.equal(smartCount(data, 'smart:known'), 1);
});

test('标成熟记后自动移出生疏库（同一份数据实时算）', () => {
  const after = { ...data, progs: { ...data.progs, w1: { wordId: 'w1', level: 'known', levelAt: 600 } } };
  assert.deepEqual(smartWordIds(after, 'smart:unfamiliar'), ['w2']);
  assert.deepEqual(smartWordIds(after, 'smart:known').sort(), ['w1', 'w3'], '标成熟记后进了熟记库');
});

test('认不出/空数据都不炸', () => {
  assert.deepEqual(smartWordIds(data, 'smart:nope'), []);
  assert.deepEqual(smartWordIds({}, 'smart:unfamiliar'), []);
  assert.deepEqual(smartWordIds({ words: [], progs: {} }, 'smart:unfamiliar'), []);
  assert.equal(smartCount({}, 'smart:unfamiliar'), 0);
});

test('id 判断与定义表', () => {
  assert.equal(isSmartId('smart:unfamiliar'), true);
  assert.equal(isSmartId('lib-4ji'), false);
  assert.equal(isSmartId(null), false);
  assert.equal(smartDef('smart:known').name, '熟记词');
  assert.equal(smartDef('nope'), null);
  assert.ok(SMART_LIBS.every((s) => s.id.startsWith('smart:') && s.name && s.level));
});
