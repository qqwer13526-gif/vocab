/* 极简弹簧 + 手势数学（零依赖，纯函数部分可在 Node 里测）。
 *
 * 为什么不用 CSS transition：手势驱动的动效必须**可打断**，而且要把手指的速度接过去。
 * CSS transition 只能"从当前值到目标值"重放，接不住速度；这里用 40 行把 Apple 那套做出来。
 *
 * 参数就用 Apple 的两个量（WWDC 2018《Designing Fluid Interfaces》）：
 *   damping  —— 阻尼比。1.0 = 临界阻尼，不弹；0.8 = 抽屉那种带一点回弹
 *   response —— "多久到"（秒）。越小越跟手。注意它不是 duration：弹簧没有固定时长
 */

const TAU = Math.PI * 2;

/** 弹簧加速度：a = -ω₀²(x - target) - 2ζω₀·v */
export function springAccel(x, v, target, { damping = 1, response = 0.35 } = {}) {
  const w0 = TAU / response;
  return -w0 * w0 * (x - target) - 2 * damping * w0 * v;
}

/**
 * 推进一步（**解析解**，不是欧拉积分）。
 *
 * 为什么不用欧拉：60Hz 下欧拉积分会把回弹吃掉 —— 实测 damping=0.8、位移 200px 时，
 * 60Hz 只过冲 0.08px（肉眼看不出"弹"），240Hz 才 2.02px。同一个弹簧在不同刷新率的手机上
 * 手感不该不一样，所以直接解这个阻尼振子：
 *   x(t) = target + e^{σt}(A·cos(ω_d t) + B·sin(ω_d t))，σ = −ζω₀，ω_d = ω₀√(1−ζ²)
 * 解出来与 dt 无关，帧率高低只影响采样密度。
 */
export function springAdvance({ x, v, target, damping = 1, response = 0.35 }, dt) {
  const w0 = TAU / response;
  const z = damping;
  const d = x - target;

  if (Math.abs(z - 1) < 1e-3) {
    // 临界阻尼
    const e = Math.exp(-w0 * dt);
    const c = v + w0 * d;
    return { x: target + (d + c * dt) * e, v: (v - w0 * c * dt) * e };
  }

  if (z < 1) {
    // 欠阻尼（有回弹）
    const wd = w0 * Math.sqrt(1 - z * z);
    const e = Math.exp(-z * w0 * dt);
    const cos = Math.cos(wd * dt);
    const sin = Math.sin(wd * dt);
    const A = d;
    const B = (v + z * w0 * d) / wd;
    return {
      x: target + e * (A * cos + B * sin),
      v: e * ((B * wd - z * w0 * A) * cos - (A * wd + z * w0 * B) * sin)
    };
  }

  // 过阻尼：两个实根
  const r = w0 * Math.sqrt(z * z - 1);
  const r1 = -z * w0 + r;
  const r2 = -z * w0 - r;
  const c2 = (v - r1 * d) / (r2 - r1);
  const c1 = d - c2;
  const e1 = Math.exp(r1 * dt);
  const e2 = Math.exp(r2 * dt);
  return { x: target + c1 * e1 + c2 * e2, v: c1 * r1 * e1 + c2 * r2 * e2 };
}

/**
 * 单纯推演一段弹簧轨迹（Node 里可测：不碰 DOM、不碰时钟）。
 * @returns 位移序列，第一个元素是起点
 */
export function simulate({ from, velocity = 0, to, damping = 1, response = 0.35 }, { dt = 1 / 120, maxSteps = 900 } = {}) {
  let x = from;
  let v = velocity;
  const out = [x];
  for (let i = 0; i < maxSteps; i++) {
    ({ x, v } = springAdvance({ x, v, target: to, damping, response }, dt));
    out.push(x);
    if (Math.abs(x - to) < 0.05 && Math.abs(v) < 0.5) break;
  }
  return out;
}

/**
 * 惯性投射：松手后"按这个速度滑下去会停在哪"（Apple 的原式，不是物理课本的 v²/2a）。
 * @param velocity px/s
 * @param deceleration 0.998 是正常滚动的手感
 */
export function project(velocity, deceleration = 0.998) {
  return ((velocity / 1000) * deceleration) / (1 - deceleration);
}

/** 橡皮筋：越拖越难拖。real things slow before they stop */
export function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** 超出 limit 的部分按橡皮筋衰减（limit 以内 1:1） */
export function rubberbandBeyond(x, limit, dimension = 400) {
  if (Math.abs(x) <= limit) return x;
  const sign = Math.sign(x);
  const over = Math.abs(x) - limit;
  return sign * (limit + rubberband(over, dimension));
}

/**
 * 松手后到底"翻页"还是"回原位"。
 * 先按速度投射出落点，落点够远就翻；另外距离本身够远也翻（慢拖到底）。
 */
export function decideFlip(dx, velocity, width, { ratio = 0.35, hardRatio = 0.5 } = {}) {
  const projected = dx + project(velocity);
  if (Math.abs(projected) >= width * ratio) return true;
  return Math.abs(dx) >= width * hardRatio;
}

/**
 * 从最近几次 pointermove 推出手指末速（px/s）。
 * 只取最近 windowMs 里的样本：用整段历史会把"先慢后快"抹平。
 */
export function velocityFrom(history, now, { windowMs = 80 } = {}) {
  if (!history || history.length < 2) return 0;
  const last = history[history.length - 1];
  const recent = history.filter((p) => now - p.t <= windowMs);
  const first = recent.length >= 2 ? recent[0] : history[history.length - 2];
  const dt = last.t - first.t;
  if (dt < 8) return 0; // 采样太密，速度没有意义（避免把抖动当成甩）
  return ((last.x - first.x) / dt) * 1000;
}

/**
 * 用 rAF 把弹簧跑起来。
 * @returns {{ stop: () => void, value: () => number }}
 */
export function runSpring({ from, velocity = 0, to, damping = 1, response = 0.35, onFrame, onDone }) {
  let x = from;
  let v = velocity;
  let raf = 0;
  let last = 0;
  let stopped = false;

  const tick = (now) => {
    if (stopped) return;
    if (!last) last = now;
    // 掉帧时也稳住：单帧最多按 1/30 秒推（解析解本身与 dt 无关，这里只是防止一次跳太远）
    const dt = Math.min(1 / 30, Math.max(1 / 240, (now - last) / 1000));
    last = now;
    ({ x, v } = springAdvance({ x, v, target: to, damping, response }, dt));
    if (Math.abs(x - to) < 0.3 && Math.abs(v) < 2) {
      x = to;
      onFrame?.(x);
      onDone?.();
      return;
    }
    onFrame?.(x);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    stop() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
    },
    value: () => x
  };
}
