/* 动效小工具（src/motion.js）的纯逻辑测试：数字滚动 / 交错入场 / 减弱动效。 */

import assert from 'node:assert/strict';
import test from 'node:test';

// ---- 造一个能控制时间的浏览器环境（rAF 只入队，测试自己 tick）----
let vnow = 0;
let queue = [];
globalThis.performance = { now: () => vnow };
globalThis.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
globalThis.cancelAnimationFrame = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });

function tick(ms) {
  vnow += ms;
  const batch = queue;
  queue = [];
  for (const cb of batch) cb(vnow);
}

/** 假元素：记 textContent，animate 记下关键帧 */
function fakeNode() {
  const anims = [];
  return {
    textContent: '',
    animate(frames, opts) { anims.push({ frames, opts }); return { finished: Promise.resolve(), cancel() {} }; },
    anims
  };
}

const motion = await import('../src/motion.js');

test('数字滚动：第一次直接落位（没有"从 0 滚上来"的假动作）', () => {
  const n = fakeNode();
  motion.countUp(n, 42, { key: 'k1', suffix: ' 词' });
  assert.equal(n.textContent, '42 词');
});

test('数字滚动：同一个 key 第二次是从旧值滚到新值', () => {
  const n = fakeNode();
  motion.countUp(n, 10, { key: 'k2' });
  const n2 = fakeNode();
  motion.countUp(n2, 20, { key: 'k2' });
  assert.equal(n2.textContent, '10', '刚开始应该还停在旧值附近');
  for (let i = 0; i < 60; i++) tick(16);
  assert.equal(n2.textContent, '20', '滚完停在目标值');
});

test('数字滚动：滚动过程中是单调递增、且中途不等于终点', () => {
  const a = fakeNode();
  motion.countUp(a, 5, { key: 'k3' });
  const b = fakeNode();
  motion.countUp(b, 100, { key: 'k3' });
  tick(16);
  const mid = Number(b.textContent);
  assert.ok(mid > 5 && mid < 100, `中途值应介于 5 和 100 之间，实际 ${mid}`);
  for (let i = 0; i < 60; i++) tick(16);
  assert.equal(b.textContent, '100');
});

test('交错入场：只给前 12 行做动画，且带递增延迟', () => {
  const rows = Array.from({ length: 20 }, fakeNode);
  motion.staggerIn(rows, { scope: 's1', step: 50 });
  const animated = rows.filter((r) => r.anims.length);
  assert.equal(animated.length, 12, '只动前 12 行');
  assert.equal(rows[0].anims[0].opts.delay, 0);
  assert.equal(rows[3].anims[0].opts.delay, 150);
  assert.equal(rows[19].anims.length, 0, '第 20 行不动');
});

test('交错入场：同一范围 + 同样行数不重播（搜索逐字重渲染时不闪）', () => {
  const first = Array.from({ length: 5 }, fakeNode);
  motion.staggerIn(first, { scope: 's2' });
  assert.equal(first.filter((r) => r.anims.length).length, 5);
  const again = Array.from({ length: 5 }, fakeNode);
  motion.staggerIn(again, { scope: 's2' });
  assert.equal(again.filter((r) => r.anims.length).length, 0, '第二次不该再动');
  const changed = Array.from({ length: 7 }, fakeNode);
  motion.staggerIn(changed, { scope: 's2' });
  assert.equal(changed.filter((r) => r.anims.length).length, 7, '行数变了就重播');
});

test('交错入场：换范围会重新播', () => {
  const a = Array.from({ length: 3 }, fakeNode);
  motion.staggerIn(a, { scope: 'sA' });
  const b = Array.from({ length: 3 }, fakeNode);
  motion.staggerIn(b, { scope: 'sB' });
  assert.equal(b.filter((r) => r.anims.length).length, 3);
});

test('减弱动效：数字直接落位、列表完全不产生动画', async () => {
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, addListener() {} });
  const m2 = await import('../src/motion.js?reduced=1');
  const n = fakeNode();
  m2.countUp(n, 3, { key: 'r1' });
  const n2 = fakeNode();
  m2.countUp(n2, 99, { key: 'r1' });
  assert.equal(n2.textContent, '99', '不该有滚动过程');
  for (let i = 0; i < 60; i++) tick(16);
  assert.equal(n2.textContent, '99');

  const rows = Array.from({ length: 5 }, fakeNode);
  m2.staggerIn(rows, { scope: 'r2' });
  assert.equal(rows.filter((r) => r.anims.length).length, 0, '减弱动效下不产生任何入场动画');
});

test('resetMotion：清掉记忆后，同一范围也会重新播', () => {
  const a = Array.from({ length: 4 }, fakeNode);
  motion.staggerIn(a, { scope: 's3' });
  motion.resetMotion('s3');
  const b = Array.from({ length: 4 }, fakeNode);
  motion.staggerIn(b, { scope: 's3' });
  assert.equal(b.filter((r) => r.anims.length).length, 4);
});
