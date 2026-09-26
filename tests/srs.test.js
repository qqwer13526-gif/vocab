/* srs.js 的单元测试（Leitner 盒子 + 每日队列）
 * 跑法：node --test tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { DAY, INTERVALS, MAX_BOX, NEXT_DUE_LABEL, buildQueue, grade, isNew, newProg } from '../src/srs.js';

const MIN = 60 * 1000;
const T0 = 1_700_000_000_000;

test('新词：进盒子 1，立刻可以学', () => {
  const p = newProg('w1', T0);
  assert.equal(p.wordId, 'w1');
  assert.equal(p.box, 1);
  assert.equal(p.dueAt, T0);
  assert.equal(p.streak, 0);
  assert.equal(p.lapses, 0);
  assert.equal(p.lastDir, null);
  assert.equal(p.updatedAt, T0);
});

test('没有 prog 记录才算新词', () => {
  assert.equal(isNew(undefined), true);
  assert.equal(isNew(null), true);
  assert.equal(isNew(newProg('w', T0)), false);
});

test('连对六次：盒子 1→2→3→4→5→6→6', () => {
  let q = newProg('w', T0);
  const seen = [q.box];
  for (let i = 0; i < 6; i++) {
    q = grade(q, true, { now: q.dueAt, dir: 'en2zh' });
    seen.push(q.box);
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 6]);
});

test('盒子与间隔的对应表', () => {
  assert.deepEqual(INTERVALS, [0, 10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 21 * DAY, 60 * DAY]);
});

test('新词一路答对：1 天 → 3 天 → 7 天 → 21 天 → 60 天，最后停在 60 天', () => {
  let q = newProg('w', T0);
  const measured = [];
  for (let i = 0; i < 6; i++) {
    const before = q.dueAt;
    q = grade(q, true, { now: before, dir: 'en2zh' });
    measured.push(q.dueAt - before);
  }
  // 间隔按"答对后进入的新盒子"算。盒 1 的 10 分钟是**答错回到盒 1**时的间隔；
  // 新词本身是立刻可学（dueAt = now），不需要等 10 分钟。
  assert.deepEqual(measured, [1 * DAY, 3 * DAY, 7 * DAY, 21 * DAY, 60 * DAY, 60 * DAY]);
});

test('答错回到盒 1，10 分钟后再来', () => {
  const p = grade({ ...newProg('w', T0), box: 3, streak: 4 }, false, { now: T0, dir: 'en2zh' });
  assert.equal(p.box, 1);
  assert.equal(p.dueAt - T0, 10 * MIN);
});

test('到了盒子 6 就不再往上升', () => {
  const p = grade({ ...newProg('w', T0), box: MAX_BOX, streak: 9 }, true, { now: T0, dir: 'en2zh' });
  assert.equal(p.box, MAX_BOX);
  assert.equal(p.streak, 10);
});

test('答错：回盒子 1、lapses+1、streak 归零、10 分钟后再来', () => {
  const p0 = { ...newProg('w', T0), box: 4, streak: 5, lapses: 1 };
  const now = T0 + 3 * DAY;
  const p = grade(p0, false, { now, dir: 'zh2en' });
  assert.equal(p.box, 1);
  assert.equal(p.streak, 0);
  assert.equal(p.lapses, 2);
  assert.equal(p.dueAt, now + INTERVALS[1]);
  assert.equal(p.dueAt, now + 10 * MIN);
});

test('盒子 6 答错也直接回 1（不是只退一格）', () => {
  const p = grade({ ...newProg('w', T0), box: MAX_BOX, lapses: 0 }, false, { now: T0, dir: 'en2zh' });
  assert.equal(p.box, 1);
  assert.equal(p.lapses, 1);
});

test('grade 不改原对象，并记住这次的方向', () => {
  const p0 = newProg('w', T0);
  const p1 = grade(p0, true, { now: T0 + 1, dir: 'zh2en' });
  assert.equal(p0.box, 1, '原对象必须没被改');
  assert.equal(p0.updatedAt, T0);
  assert.equal(p1.lastDir, 'zh2en');
  assert.equal(p1.updatedAt, T0 + 1);
});

test('不传方向时沿用上一次的方向', () => {
  const p1 = grade(newProg('w', T0), true, { now: T0, dir: 'zh2en' });
  const p2 = grade(p1, true, { now: T0 + 1 });
  assert.equal(p2.lastDir, 'zh2en');
});

test('下次复习的文案', () => {
  assert.equal(NEXT_DUE_LABEL(1), '10 分钟');
  assert.equal(NEXT_DUE_LABEL(2), '1 天');
  assert.equal(NEXT_DUE_LABEL(6), '60 天');
});

// ---------------------------------------------------------------- 队列

const words = [
  { id: 'a', termNorm: 'a', createdAt: 3 },
  { id: 'b', termNorm: 'b', createdAt: 1 },
  { id: 'c', termNorm: 'c', createdAt: 2 },
  { id: 'd', termNorm: 'd', createdAt: 0, deleted: true },
  { id: 'e', termNorm: 'e', createdAt: 4 },
  { id: 'f', termNorm: 'f', createdAt: 5 },
  { id: 'g', termNorm: 'g', createdAt: 6 },
  { id: 'h', termNorm: 'h', createdAt: 7 }
];
const links = [
  { id: 'a|L1', wordId: 'a', libId: 'L1' },
  { id: 'b|L1', wordId: 'b', libId: 'L1' },
  { id: 'c|L2', wordId: 'c', libId: 'L2' },
  { id: 'd|L1', wordId: 'd', libId: 'L1' },
  { id: 'e|L3', wordId: 'e', libId: 'L3' },
  { id: 'f|L1', wordId: 'f', libId: 'L1' },
  { id: 'g|L1', wordId: 'g', libId: 'L1' },
  { id: 'h|L2', wordId: 'h', libId: 'L2' }
];
const progs = {
  a: { wordId: 'a', box: 2, dueAt: 100, streak: 1, lapses: 0 },
  b: { wordId: 'b', box: 1, dueAt: 50, streak: 0, lapses: 1 },
  h: { wordId: 'h', box: 3, dueAt: 999, streak: 2, lapses: 0 } // 还没到期
};

test('队列只收指定库里的词', () => {
  const q = buildQueue({ words, progs, links, libIds: ['L1'], now: 200, newLimit: 10 });
  assert.deepEqual(q.review, ['b', 'a']);
  assert.deepEqual(q.fresh, ['f', 'g']);
  assert.ok(!q.review.includes('c') && !q.fresh.includes('c'), 'L2 的词不该出现');
});

test('不传 libIds 就是全部库', () => {
  const q = buildQueue({ words, progs, links, libIds: null, now: 200, newLimit: 10 });
  assert.deepEqual(q.review, ['b', 'a']);
  assert.deepEqual(q.fresh, ['c', 'e', 'f', 'g']);
});

test('软删除的词永远不进队列', () => {
  for (const now of [0, 200, 5000]) {
    const q = buildQueue({ words, progs, links, libIds: ['L1'], now, newLimit: 10 });
    assert.ok(!q.review.includes('d') && !q.fresh.includes('d'), `now=${now} 时 d 不该出现`);
  }
});

test('有记录但没到期的词，既不在复习里也不算新词', () => {
  const q = buildQueue({ words, progs, links, libIds: null, now: 200, newLimit: 10 });
  assert.ok(!q.review.includes('h'), 'h 没到期，不该进复习');
  assert.ok(!q.fresh.includes('h'), 'h 已经有学习记录，不算新词');
});

test('复习按到期时间先后排，新词按导入先后排', () => {
  const q = buildQueue({ words, progs, links, libIds: null, now: 5000, newLimit: 10 });
  assert.deepEqual(q.review, ['b', 'a', 'h']);
  assert.deepEqual(q.fresh, ['c', 'e', 'f', 'g']);
});

test('每天的新词数量受上限限制', () => {
  assert.deepEqual(buildQueue({ words, progs, links, libIds: null, now: 200, newLimit: 1 }).fresh, ['c']);
  assert.deepEqual(buildQueue({ words, progs, links, libIds: null, now: 200, newLimit: 0 }).fresh, []);
});

test('队列里不重复', () => {
  const q = buildQueue({ words, progs, links, libIds: ['L1', 'L2'], now: 5000, newLimit: 10 });
  const allIds = [...q.review, ...q.fresh];
  assert.equal(new Set(allIds).size, allIds.length);
});

test('空数据不炸', () => {
  const q = buildQueue({ words: [], progs: {}, links: [], libIds: null, now: 0 });
  assert.deepEqual(q, { review: [], fresh: [] });
});
