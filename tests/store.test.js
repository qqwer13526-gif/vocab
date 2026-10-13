/* 子词库（v52）—— store.js 的派生逻辑与级联删除的**纯函数**部分。
 *
 * 数据模型没变：仍然是 words + links 多对多，libs 只是标签。
 * 子词库只是在 libs 上多了一个可选字段 parentId，所以"父库的词"是**读的时候算出来**的，
 * 不往 links 里写冗余归属 —— 这样永远不会有"两边不同步"的 bug。
 *
 * 规则（用户 2026-10-09 定的）：
 *   · 父库包含子库的词（练父库 = 练整棵）
 *   · 只允许一层（子库不能再有子库）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  childLibs,
  descendantLibIds,
  libTree,
  libWordIds,
  nextSiblingOrder,
  parentOf
} from '../src/store.js';

/** 造一份 loadAll() 形状的数据：2 个顶层库，其中"四级"下有 2 个子库 */
function fixture() {
  const libs = [
    { id: 'cet', name: '四级', order: 0, color: '#3b5bff' },
    { id: 'cet-u1', name: '四级 Unit 1', order: 0, parentId: 'cet' },
    { id: 'cet-u2', name: '四级 Unit 2', order: 1, parentId: 'cet' },
    { id: 'ky', name: '考研', order: 1, color: '#ff9f0a' }
  ];
  const words = ['w1', 'w2', 'w3', 'w4', 'w5'];
  const links = [
    { id: 'w1|cet', wordId: 'w1', libId: 'cet' },      // 父库自己的词
    { id: 'w2|cet-u1', wordId: 'w2', libId: 'cet-u1' },
    { id: 'w3|cet-u1', wordId: 'w3', libId: 'cet-u1' },
    { id: 'w4|cet-u2', wordId: 'w4', libId: 'cet-u2' },
    // w1 同时也在子库里：父库的词不能因此被算两遍
    { id: 'w1|cet-u2', wordId: 'w1', libId: 'cet-u2' },
    { id: 'w5|ky', wordId: 'w5', libId: 'ky' }
  ];
  return {
    words: words.map((id) => ({ id, term: id })),
    wordsById: new Map(words.map((id) => [id, { id, term: id }])),
    libs,
    links,
    progs: {}
  };
}

test('父库包含子库的词，且同一个词不会算两遍', () => {
  const data = fixture();
  const ids = libWordIds(data, 'cet');
  assert.deepEqual([...ids].sort(), ['w1', 'w2', 'w3', 'w4'], '父库 = 自己 + 两个子库，去重');
});

test('子库只算自己的词（不会反过来包含父库的）', () => {
  const data = fixture();
  assert.deepEqual([...libWordIds(data, 'cet-u1')].sort(), ['w2', 'w3']);
});

test('没有子库的库行为跟以前完全一样（平铺库不受影响）', () => {
  const data = fixture();
  assert.deepEqual(libWordIds(data, 'ky'), ['w5']);
});

test('childLibs 只给直接子库，且按 order 排', () => {
  const data = fixture();
  assert.deepEqual(childLibs(data, 'cet').map((l) => l.id), ['cet-u1', 'cet-u2']);
  assert.deepEqual(childLibs(data, 'ky'), []);
});

test('descendantLibIds 给出自己 + 子库（只一层）', () => {
  const data = fixture();
  assert.deepEqual(descendantLibIds(data, 'cet'), ['cet', 'cet-u1', 'cet-u2']);
});

test('libTree：顶层在前，子库挂在父下面，不重复出现在顶层', () => {
  const data = fixture();
  const tree = libTree(data);
  assert.deepEqual(tree.map((n) => n.lib.id), ['cet', 'ky']);
  assert.deepEqual(tree[0].children.map((l) => l.id), ['cet-u1', 'cet-u2']);
  assert.deepEqual(tree[1].children, []);
});

test('parentOf：子库认得父库，顶层库给 null', () => {
  const data = fixture();
  assert.equal(parentOf(data, 'cet-u1')?.id, 'cet');
  assert.equal(parentOf(data, 'cet'), null);
});

test('nextSiblingOrder：子库的序号在**兄弟之间**排队，不会跟顶层库抢', () => {
  const data = fixture();
  assert.equal(nextSiblingOrder(data, 'cet'), 2, '四级下面已有 order 0/1 → 下一个是 2');
  assert.equal(nextSiblingOrder(data, null), 2, '顶层已有 order 0/1 → 下一个是 2');
});

test('父库被删（或 parentId 指向不存在的库）时，子库自动升为顶层，不会从界面上消失', () => {
  const data = fixture();
  data.libs = data.libs.filter((l) => l.id !== 'cet');   // 父库没了
  const tree = libTree(data);
  assert.deepEqual(tree.map((n) => n.lib.id).sort(), ['cet-u1', 'cet-u2', 'ky'], '孤儿库要能被看见');
});
