/* 弹簧与手势数学的单元测试（纯函数，不碰 DOM、不碰时钟）。
   跑法：node --test （配合 tests 目录下的 glob，见 README）
   注意：注释里千万别写带星号的 glob 字面量，会把块注释提前结束掉（踩过）。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideFlip, project, rubberband, rubberbandBeyond, simulate, springAccel, velocityFrom } from '../src/spring.js';

const CARW = 390; // 一张卡的宽度（用于按比例判定）

test('惯性投射用的是 Apple 的指数衰减式，不是 v²/2a', () => {
  // (v/1000)·d/(1−d)，d=0.998 → v=1000px/s 时约 499px
  assert.ok(Math.abs(project(1000) - 499) < 1, `project(1000)=${project(1000)}`);
  assert.equal(project(0), 0);
});

test('投射随速度单调增、且方向跟着速度', () => {
  const a = project(300);
  const b = project(800);
  const c = project(2000);
  assert.ok(a < b && b < c, `${a} < ${b} < ${c}`);
  assert.ok(project(-800) < 0 && project(800) > 0);
});

test('速度投射是"轻扫也能翻"的关键：小距离 + 快速度 = 翻', () => {
  const dx = 40;        // 只拖了 40px
  const slow = 50;      // 50px/s：慢慢挪
  const fast = 1200;    // 1200px/s：一甩
  assert.equal(decideFlip(dx, slow, CARW), false, '慢拖 40px 不该翻');
  assert.equal(decideFlip(dx, fast, CARW), true, '快甩 40px 该翻');
  assert.equal(decideFlip(-dx, -fast, CARW), true, '反方向同理');
});

test('慢拖到底也翻（距离本身够远）', () => {
  assert.equal(decideFlip(CARW * 0.6, 0, CARW), true);
  assert.equal(decideFlip(CARW * 0.2, 0, CARW), false);
});

test('阻尼 1.0 不冲过目标；阻尼 0.8 会冲过去再回来', () => {
  const noBounce = simulate({ from: 0, velocity: 0, to: 200, damping: 1.0, response: 0.35 });
  assert.ok(Math.max(...noBounce) <= 200.05, `临界阻尼不该过冲，最大 ${Math.max(...noBounce).toFixed(3)}`);

  const bounce = simulate({ from: 0, velocity: 0, to: 200, damping: 0.8, response: 0.35 });
  const peak = Math.max(...bounce);
  // 理论过冲 exp(−πζ/√(1−ζ²)) ≈ 1.5% → 200px 上约 3px
  assert.ok(peak > 202 && peak < 205, `欠阻尼该过冲 2~5px，实测 ${(peak - 200).toFixed(2)}px`);
});

test('同一根弹簧在不同刷新率下手感一致（解析解，不是欧拉积分）', () => {
  // 这条是防回归：欧拉积分在 60Hz 下会把回弹吃成 0.08px（肉眼无感），240Hz 才 2px
  const peaks = [1 / 60, 1 / 90, 1 / 120, 1 / 240].map((dt) =>
    Math.max(...simulate({ from: 0, velocity: 0, to: 200, damping: 0.8, response: 0.35 }, { dt }))
  );
  const spread = Math.max(...peaks) - Math.min(...peaks);
  assert.ok(spread < 0.2, `各帧率下的峰值差 ${spread.toFixed(3)}px（应 <0.2）: ${peaks.map((p) => p.toFixed(2)).join(', ')}`);
});

test('弹簧最终会停住（不会一直抖）', () => {
  const out = simulate({ from: 0, velocity: 0, to: 200, damping: 0.9, response: 0.32 });
  const end = out[out.length - 1];
  assert.ok(Math.abs(end - 200) < 0.5, `末值 ${end.toFixed(3)}`);
  assert.ok(out.length < 300, `步数 ${out.length}（应该早就收敛）`);
});

test('速度接管：手指末速会带进弹簧，越快越早到', () => {
  const slow = simulate({ from: 0, velocity: 0, to: 300, damping: 0.9, response: 0.3 });
  const flick = simulate({ from: 0, velocity: 2000, to: 300, damping: 0.9, response: 0.3 });
  const reach = (xs) => xs.findIndex((x) => x >= 300 * 0.95);
  assert.ok(reach(flick) < reach(slow), `带速度 ${reach(flick)} 步 vs 静止 ${reach(slow)} 步`);
});

test('加速度方向正确：在目标左边被拉向右', () => {
  assert.ok(springAccel(0, 0, 100) > 0);
  assert.ok(springAccel(200, 0, 100) < 0);
  // 正好在目标上：加速度应为 0（浮点可能给 -0，所以比绝对值）
  assert.ok(Math.abs(springAccel(100, 0, 100)) < 1e-9);
});

test('橡皮筋：越拖越难，永远小于实际位移', () => {
  assert.ok(rubberband(50, 400) < 50);
  assert.ok(rubberband(200, 400) < 200);
  // 比例上也要更"硬"：拖得越远，能走到的比例越小
  const r1 = rubberband(50, 400) / 50;
  const r2 = rubberband(200, 400) / 200;
  assert.ok(r2 < r1, `${r2.toFixed(3)} 应小于 ${r1.toFixed(3)}`);
  assert.equal(rubberband(0, 400), 0);
});

test('rubberbandBeyond：限内 1:1，越界部分才衰减', () => {
  assert.equal(rubberbandBeyond(300, 400), 300, '限内原样');
  const over = rubberbandBeyond(600, 400);
  assert.ok(over > 400 && over < 600, `600 → ${over.toFixed(1)} 应落在 (400,600)`);
  assert.equal(rubberbandBeyond(-600, 400) < -400, true, '反方向也一样');
});

test('末速只取最近 80ms：先慢后快不会被抹平', () => {
  const now = 1000;
  const h = [
    { t: 700, x: 0 },
    { t: 900, x: 10 },   // 很慢
    { t: 960, x: 60 },
    { t: 1000, x: 140 }  // 最近 40ms 走了 80px → 2000px/s
  ];
  const v = velocityFrom(h, now);
  assert.ok(v > 1500, `末速 ${v.toFixed(0)}px/s 应反映最后的快移`);
});

test('采样间隔太密时速度算 0（避免把抖动当甩动）', () => {
  const h = [{ t: 1000, x: 0 }, { t: 1003, x: 30 }];
  assert.equal(velocityFrom(h, 1003), 0);
});
