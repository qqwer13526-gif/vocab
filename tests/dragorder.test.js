/* 长按拖动排序（v56）—— 纯逻辑部分。
 *
 * 拖动这件事最容易错的不是"跟手"，是**落点计算**：
 *   · 手指穿过某张卡的**中线**才算换位（而不是碰到边就换 ✗）
 *   · 拖到最上/最下要能到首尾
 *   · 落库时同层 order 要连续（0,1,2…），否则重开 App 顺序会乱
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeTargetIndex, orderRowsFor } from '../src/dragorder.js';

/** 造一组"其它卡"的矩形（按视觉顺序，上→下） */
const rects = (heights, gap = 12, start = 0) => {
  const out = [];
  let top = start;
  for (const h of heights) {
    out.push({ top, height: h });
    top += h + gap;
  }
  return out;
};

test('手指在最上面：落到第一位', () => {
  assert.equal(computeTargetIndex(rects([100, 100, 100]), -50), 0);
});

test('手指在最下面：落到最后一位', () => {
  assert.equal(computeTargetIndex(rects([100, 100, 100]), 9999), 3);
});

test('手指没过第一张的中线：还是第一位（不能"碰边就换"）', () => {
  // 第一张 top=0 h=100 → 中线 50
  assert.equal(computeTargetIndex(rects([100, 100]), 40), 0);
  assert.equal(computeTargetIndex(rects([100, 100]), 60), 1);
});

test('手指在两张之间：按中线决定落在第几位', () => {
  // 三张：中线分别是 50 / 162 / 274
  const r = rects([100, 100, 100]);
  assert.equal(computeTargetIndex(r, 100), 1);
  assert.equal(computeTargetIndex(r, 200), 2);
  assert.equal(computeTargetIndex(r, 300), 3);
});

test('高度不一样的卡片也按各自中线算', () => {
  // 40 高的卡（中线 20）+ 200 高的卡（top=52 中线 152）
  const r = rects([40, 200]);
  assert.equal(computeTargetIndex(r, 10), 0);
  assert.equal(computeTargetIndex(r, 30), 1);
  assert.equal(computeTargetIndex(r, 100), 1);
  assert.equal(computeTargetIndex(r, 200), 2);
});

test('没有别的卡（只剩自己）：落到 0', () => {
  assert.equal(computeTargetIndex([], 123), 0);
});

// ---------------------------------------------------------------- 落库顺序

test('orderRowsFor：同层重排后 order 从 0 连续递增', () => {
  const libs = [
    { id: 'a', name: 'A', order: 0 },
    { id: 'b', name: 'B', order: 1 },
    { id: 'c', name: 'C', order: 2 },
    { id: 'x', name: 'X', order: 7, parentId: 'a' }   // 子库：不参与顶层重排
  ];
  const rows = orderRowsFor(libs, null, ['c', 'a', 'b']);
  assert.deepEqual(rows.map((r) => r.id), ['c', 'a', 'b']);
  assert.deepEqual(rows.map((r) => r.order), [0, 1, 2]);
  assert.ok(rows.every((r) => r.updatedAt > 0), '要打 updatedAt（以后同步靠它）');
});

test('orderRowsFor：子库在**自己那组**里重排，不碰顶层', () => {
  const libs = [
    { id: 'a', name: 'A', order: 0 },
    { id: 'x1', name: 'X1', order: 0, parentId: 'a' },
    { id: 'x2', name: 'X2', order: 1, parentId: 'a' },
    { id: 'x3', name: 'X3', order: 2, parentId: 'a' }
  ];
  const rows = orderRowsFor(libs, 'a', ['x3', 'x1', 'x2']);
  assert.deepEqual(rows.map((r) => r.id), ['x3', 'x1', 'x2']);
  assert.deepEqual(rows.map((r) => r.order), [0, 1, 2]);
  assert.ok(!rows.some((r) => r.id === 'a'), '父库自己不能被这次重排带上');
});

test('orderRowsFor：传进来的 id 有缺漏时，把漏掉的按原顺序补在后面（不丢卡）', () => {
  const libs = [
    { id: 'a', name: 'A', order: 0 },
    { id: 'b', name: 'B', order: 1 },
    { id: 'c', name: 'C', order: 2 }
  ];
  const rows = orderRowsFor(libs, null, ['c']);   // 只给了 c
  assert.deepEqual(rows.map((r) => r.id), ['c', 'a', 'b'], '漏掉的要按原顺序补在后面，不能从界面上消失');
  assert.deepEqual(rows.map((r) => r.order), [0, 1, 2]);
});
