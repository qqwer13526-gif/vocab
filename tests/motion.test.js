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

/** 假元素：只有 classList / children / hidden / animate —— staggerPage 需要的那点接口 */
function fakeEl(cls, className = cls) {
  const node = fakeNode();
  node.className = className;
  node.classList = { contains: (c) => String(className).split(/\s+/).includes(c) };
  node.hidden = false;
  node.children = [];
  return node;
}

function fakeRoot(children, cls = 'div', className = cls) {
  const node = fakeEl(cls, className);
  node.children = children;
  node.all = [];
  const flat = (n) => { node.all.push(n); (n.children || []).forEach(flat); };
  children.forEach(flat);
  return node;
}

/** 整批里「最晚开始」的那个动画的参数 */
function animationLast(nodes) {
  return nodes
    .flatMap((n) => n.anims)
    .sort((a, b) => (b.opts.delay || 0) - (a.opts.delay || 0))[0];
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

test('交错入场：默认步长 90ms、单张 480ms（照 UI 仓库 07）', () => {
  const rows = Array.from({ length: 3 }, fakeNode);
  motion.staggerIn(rows, { scope: 's1' });
  assert.equal(rows[0].anims[0].opts.delay, 0, '第一张不延迟');
  assert.equal(rows[1].anims[0].opts.delay, 90, '第二张 90ms');
  assert.equal(rows[2].anims[0].opts.delay, 180, '第三张 180ms');
  assert.equal(rows[0].anims[0].opts.duration, 480, '单张 480ms');
  const frames = rows[0].anims[0].frames;
  assert.ok(frames[0].transform.includes('26px'), '起点 translateY(26px)（07 的位移）');
  assert.ok(frames[0].transform.includes('scale(1)'), '不做 scale（会缩小点按区域，a11y 审计不允许）');
  assert.ok(frames.some((f) => /-\d/.test(f.transform) && f.transform.includes('translate3d')), '有向上的过冲关键帧');
  assert.equal(frames.length, 5, '5 段关键帧近似弹簧');
});

test('交错入场：只给前 cap 张做动画（默认 12）', () => {
  const rows = Array.from({ length: 20 }, fakeNode);
  motion.staggerIn(rows, { scope: 's1b' });
  assert.equal(rows.filter((r) => r.anims.length).length, 12, '只动前 12 行');
  assert.equal(rows[19].anims.length, 0, '第 20 行不动');
});

test('整页入场：最多 6 张，步长 90ms（一页卡片多也不会拖太久）', () => {
  const page = fakeRoot(Array.from({ length: 10 }, () => fakeEl('div', 'card')));
  motion.bumpMotionGen();
  motion.staggerPage(page, { scope: 'page:many' });
  const animated = page.all.filter((n) => n.anims.length);
  assert.equal(animated.length, 6, '只给前 6 张');
  assert.equal(animated[5].anims[0].opts.delay, 450, '第 6 张 5×90ms');
  assert.ok(animated[5].anims[0].opts.delay + animated[5].anims[0].opts.duration <= 1000, '整批 ≈930ms');
});

test('交错入场：同一代里不重播（搜索逐字重渲染时不闪）', () => {
  const first = Array.from({ length: 5 }, fakeNode);
  motion.staggerIn(first, { scope: 's2' });
  assert.equal(first.filter((r) => r.anims.length).length, 5);
  const again = Array.from({ length: 5 }, fakeNode);
  motion.staggerIn(again, { scope: 's2' });
  assert.equal(again.filter((r) => r.anims.length).length, 0, '没换页就不该再动');
});

test('交错入场：换页（新一代）一定重播 —— 底部导航切页就是这个', () => {
  const a = Array.from({ length: 3 }, fakeNode);
  motion.staggerIn(a, { scope: 'sA' });
  const b = Array.from({ length: 3 }, fakeNode);
  motion.staggerIn(b, { scope: 'sB' });
  assert.equal(b.filter((r) => r.anims.length).length, 3, '换范围重播');

  const home1 = Array.from({ length: 4 }, fakeNode);
  motion.staggerIn(home1, { scope: 'page:home' });
  motion.bumpMotionGen();               // 切到别的页
  motion.bumpMotionGen();               // 再切回首页
  const home2 = Array.from({ length: 4 }, fakeNode);
  motion.staggerIn(home2, { scope: 'page:home' });
  assert.equal(home2.filter((r) => r.anims.length).length, 4, '切回同一页也要重播');
});

test('整页入场：取一层卡片（直接的 .card + 容器里的卡片），跳过 word-head，尊重 cap', () => {
  const page = fakeRoot([
    fakeEl('div', 'word-head'),
    fakeEl('div', 'card'),
    fakeRoot([fakeEl('div', 'card lib-row'), fakeEl('div', 'card lib-row'), fakeEl('div', 'newlib-row')], 'section', 'libs'),
    fakeEl('div', 'card')
  ]);
  motion.bumpMotionGen(); // 新的一代（否则会被上一轮同代记忆正确地挡掉）
  motion.staggerPage(page, { scope: 'page:settings', step: 40, cap: 4, offset: 26 });
  const animated = page.all.filter((n) => n.anims.length);
  assert.equal(animated.length, 4, '只动 cap 指定的前 4 个');
  assert.equal(page.all[0].anims.length, 0, 'word-head 不动');
  assert.equal(animated[0].anims[0].opts.delay, 0);
  assert.ok(animated[2].anims[0].opts.delay >= animated[1].anims[0].opts.delay, '延迟递增');
  assert.equal(page.all[page.all.length - 1].anims.length, 0, 'cap 之外的卡片不动');
});

test('整页入场：减弱动效下什么也不做', async () => {
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, addListener() {} });
  const m3 = await import('../src/motion.js?reduced-page=1');
  const page = fakeRoot([fakeEl('div', 'card'), fakeEl('div', 'card')]);
  m3.staggerPage(page, { scope: 'page:x' });
  assert.equal(page.all.filter((n) => n.anims.length).length, 0);
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
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
