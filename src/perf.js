/* 帧率浮层（v37）：给"手机上到底哪里卡"提供一把能量出来的尺子。
 *
 * 为什么要有它：切页卡顿在无头浏览器里测不出来（没有真实 GPU 合成路径，
 * backdrop-filter / 混合模式 / 建层的开销都不出现）。按 mobile-native 的纪律 ——
 * 手机才是唯一裁判。所以做一把尺子放进 App，让你在真机上读数、并且当场做归因实验。
 *
 * 打开方式：网址后加 ?perf=1（或 ?debug=1 时顺带开）
 * 它只在你主动打开时才 import —— 正常使用时一个字节都不加载。
 *
 * 浮层给的东西：
 *   - 最长帧 / >32ms 的帧数 / 最近 200 帧的分布（60Hz 下一帧 16.7ms，120Hz 下 8.3ms）
 *   - 最近 20 次切页各自的最长帧（就是"两个界面切换那一下"）
 *   - 四个开关：氛围光 / 入场动画 / 底栏玻璃 / 数字滚动 —— 逐项关掉看哪个让最长帧掉下来
 *   - 「复制数据」：把 JSON 复制出来发我，最后一刀按数据定
 */

const FRAME_BUDGET = 32; // 超过它就当作"掉帧"（60Hz 两帧）

const state = {
  frames: [],
  swaps: [],
  longtasks: [],
  marks: [],
  toggles: { ambient: true, entry: true, glass: true, count: true }
};

let hud = null;
let rafId = 0;
let last = 0;
let currentSwap = null;

/** 阶段标记：app.js / theme.js 调，用来把帧和"刚发生了什么"对上 */
export function perfMark(name) {
  if (!hud) return;
  state.marks.push({ t: Math.round(performance.now()), name });
  if (state.marks.length > 60) state.marks.shift();
  if (name === 'entry') currentSwap = { t: Math.round(performance.now()), worst: 0, frames: 0 };
  if (name === 'swap' && currentSwap) {
    state.swaps.push(currentSwap);
    if (state.swaps.length > 20) state.swaps.shift();
    currentSwap = null;
  }
}

function tick(now) {
  const dt = last ? now - last : 16;
  last = now;
  state.frames.push(dt);
  if (state.frames.length > 200) state.frames.shift();
  if (currentSwap) {
    currentSwap.worst = Math.max(currentSwap.worst, Math.round(dt));
    currentSwap.frames++;
  }
  paint();
  rafId = requestAnimationFrame(tick);
}

function stats() {
  const f = state.frames;
  if (!f.length) return { worst: 0, drops: 0, avg: 0, n: 0 };
  const worst = Math.round(Math.max(...f));
  const drops = f.filter((x) => x > FRAME_BUDGET).length;
  const avg = Math.round((f.reduce((a, b) => a + b, 0) / f.length) * 10) / 10;
  return { worst, drops, avg, n: f.length };
}

function paint() {
  if (!hud) return;
  const s = stats();
  const swapWorst = state.swaps.length ? Math.max(...state.swaps.map((x) => x.worst)) : 0;
  const now = state.swaps.length ? state.swaps[state.swaps.length - 1].worst : 0;
  const set = (sel, text) => {
    const n = hud.querySelector(sel);
    if (n && n.textContent !== text) n.textContent = text;
  };
  set('[data-perf="worst"]', `${s.worst}ms`);
  set('[data-perf="drops"]', `${s.drops}/${s.n}`);
  set('[data-perf="avg"]', `${s.avg}ms`);
  set('[data-perf="lastswap"]', `${now}ms`);
  set('[data-perf="worstswap"]', `${swapWorst}ms`);
  set('[data-perf="longtask"]', state.longtasks.length ? `${Math.max(...state.longtasks)}ms` : '—');
}

/** 四个归因开关：关掉某一项后重新切页，看"最近一次切页最长帧"掉不掉 */
function apply(toggles) {
  const root = document.documentElement;
  const amb = document.querySelectorAll('.ambient');
  for (const a of amb) a.style.display = toggles.ambient ? '' : 'none';
  root.dataset.perfNoEntry = toggles.entry ? '' : '1';
  const bar = document.getElementById('tabbar');
  if (bar) bar.style.backdropFilter = toggles.glass ? '' : 'none';
  root.dataset.perfNoCount = toggles.count ? '' : '1';
}

export function startPerfHud() {
  if (hud) return;
  hud = document.createElement('div');
  hud.className = 'perf-hud';
  hud.dataset.testid = 'perf-hud';
  hud.innerHTML = `
    <div class="perf-row perf-title">帧率浮层（?perf=1）<button type="button" data-perf="close" aria-label="关闭">×</button></div>
    <div class="perf-row"><span>最长帧</span><b data-perf="worst">—</b></div>
    <div class="perf-row"><span>掉帧(&gt;32ms)</span><b data-perf="drops">—</b></div>
    <div class="perf-row"><span>平均帧</span><b data-perf="avg">—</b></div>
    <div class="perf-row"><span>最近一次切页</span><b data-perf="lastswap">—</b></div>
    <div class="perf-row"><span>切页最差</span><b data-perf="worstswap">—</b></div>
    <div class="perf-row"><span>longtask</span><b data-perf="longtask">—</b></div>
    <div class="perf-row perf-toggles">
      <label><input type="checkbox" checked data-perf="t-ambient">氛围光</label>
      <label><input type="checkbox" checked data-perf="t-entry">入场动画</label>
      <label><input type="checkbox" checked data-perf="t-glass">底栏玻璃</label>
      <label><input type="checkbox" checked data-perf="t-count">数字滚动</label>
    </div>
    <div class="perf-row"><button type="button" data-perf="reset">重置</button><button type="button" data-perf="copy">复制数据</button></div>
  `;
  document.body.append(hud);

  for (const [key, sel] of [['ambient', 't-ambient'], ['entry', 't-entry'], ['glass', 't-glass'], ['count', 't-count']]) {
    hud.querySelector(`[data-perf="${sel}"]`).addEventListener('change', (e) => {
      state.toggles[key] = e.currentTarget.checked;
      apply(state.toggles);
    });
  }
  hud.querySelector('[data-perf="reset"]').addEventListener('click', () => {
    state.frames = [];
    state.swaps = [];
    state.longtasks = [];
    paint();
  });
  hud.querySelector('[data-perf="copy"]').addEventListener('click', async (e) => {
    const payload = {
      最长帧: stats().worst,
      平均帧: stats().avg,
      掉帧数: stats().drops,
      最近一次切页最长帧: state.swaps.length ? state.swaps[state.swaps.length - 1].worst : null,
      切页最长帧: state.swaps.length ? Math.max(...state.swaps.map((x) => x.worst)) : null,
      切页次数: state.swaps.length,
      longtask: state.longtasks,
      开关: state.toggles,
      设备像素比: window.devicePixelRatio,
      视口: `${window.innerWidth}×${window.innerHeight}`
    };
    const text = JSON.stringify(payload, null, 1);
    try {
      await navigator.clipboard.writeText(text);
      e.currentTarget.textContent = '已复制 ✅';
    } catch {
      window.prompt('复制下面这段发给我：', text);
    }
    setTimeout(() => { e.currentTarget.textContent = '复制数据'; }, 1500);
  });
  hud.querySelector('[data-perf="close"]').addEventListener('click', () => {
    hud.remove();
    hud = null;
    cancelAnimationFrame(rafId);
  });

  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        state.longtasks.push(Math.round(e.duration));
        if (state.longtasks.length > 30) state.longtasks.shift();
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    /* 不支持就算了 */
  }

  apply(state.toggles);
  last = 0;
  rafId = requestAnimationFrame(tick);
  return hud;
}

export const _internal = { state, stats };
