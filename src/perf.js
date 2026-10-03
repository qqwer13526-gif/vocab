/* 帧率浮层（v45：改成"能直接看懂"的版本）
 *
 * 打开方式（两种都行）：
 *   - 设置 → 调试 → 「帧率浮层」开关
 *   - 网址后加 ?perf=1
 *
 * 它回答一个问题：**切页那一下到底卡不卡、卡在哪个环节**。
 * 关键两个数：
 *   「切页最卡的一帧」= 从换页开始到卡片全部落定，其中最慢的一帧（这就是"顿一下"的量）
 *   「最近一次切页」  = 刚才那一次切页最慢的一帧
 * 判定：16.7ms 是 60Hz 一帧的预算 —— 低于它就顺；超过 32ms（两帧）就是肉眼可见的顿。
 *
 * 下面四个开关用来**归因**：关掉某一项再切页，看「最近一次切页」掉不掉 —— 掉下来的就是它。
 */

const FRAME_BUDGET = 32; // 超过它 = 掉帧（60Hz 两帧）
/* 超过它的帧间隔一律当"系统把页面挂起了"（iOS 滑动过渡、切后台、锁屏都会挂起 rAF），
   不计入"最长帧" —— 否则一次过渡的暂停会被算成 485ms 这种巨帧（用户就见过，而且四个开关都改不动它）。 */
const MAX_REAL_FRAME = 200;

const TOGGLE_KEY = 'vocab.perfToggles';

/** 读回上次的开关状态 —— ⚠️ 必须持久化：用户为了拿到新版本做一次"强制重新加载"，
    开关就会全部回到默认的"勾上"，于是"全勾掉再测"的结论其实是全开（真发生过 ✗） */
function loadToggles() {
  const def = { ambient: true, entry: true, glass: true, count: true };
  try {
    const raw = localStorage.getItem(TOGGLE_KEY);
    return raw ? { ...def, ...JSON.parse(raw) } : def;
  } catch {
    return def;
  }
}

const state = {
  frames: [],
  swaps: [],
  longtasks: [],
  pauses: [],
  toggles: loadToggles()
};

let hud = null;
let rafId = 0;
let last = 0;
let currentSwap = null;
let currentFrom = '#/';
let currentFromPrev = '#/';

/** 换页窗口的长度：整套入场最长 ~930ms，取 1s 覆盖得住 */
const SWAP_WINDOW_MS = 1000;

/** 阶段标记：app.js 在"开始换页"时调 perfMark('entry') */
export function perfMark(name) {
  if (!hud) return;
  // 记【从哪页到哪页】：entry 这一刻 hash 已经是新页了，所以要用上一次记下的那个
  if (name === 'entry') { currentFromPrev = currentFrom; currentFrom = location.hash || '#/'; }
  // ⚠️ 触发后**不要**等一个"结束"标记：v37 之后"起入场"和"对调"在同一个同步块里，
  //    两次标记之间一帧都跑不到 → 按标记配对测量会永远是 0（浮层显示"—"，踩过）。
  //    改成开一个时间窗，窗内最慢的一帧就是"这一次切页最卡的一帧"。
  if (name === 'entry') currentSwap = { at: performance.now(), worst: 0, frames: 0, from: currentFromPrev };
}

function tick(now) {
  const raw = last ? now - last : 16;
  last = now;
  // 暂停（系统挂起 rAF）不计入帧统计
  if (raw > MAX_REAL_FRAME) {
    state.pauses.push({ ms: Math.round(raw), at: Math.round(performance.now()), page: location.hash || '#/' });
    if (state.pauses.length > 20) state.pauses.shift();
    currentSwap = null;      // 这一窗口作废（中间被挂起了，数不可信）
    paint();
    rafId = requestAnimationFrame(tick);
    return;
  }
  const dt = raw;
  state.frames.push(dt);
  if (state.frames.length > 200) state.frames.shift();
  if (currentSwap) {
    currentSwap.worst = Math.max(currentSwap.worst, Math.round(dt));
    currentSwap.frames++;
    if (now - currentSwap.at >= SWAP_WINDOW_MS) {
      currentSwap.to = location.hash || '#/';
      state.swaps.push(currentSwap);
      if (state.swaps.length > 20) state.swaps.shift();
      currentSwap = null;
    }
  }
  paint();
  rafId = requestAnimationFrame(tick);
}

function worstSwap() {
  return state.swaps.length ? Math.max(...state.swaps.map((s) => s.worst)) : 0;
}

function verdict(ms) {
  if (!ms) return { text: '还没测到', cls: 'idle' };
  if (ms <= 20) return { text: '很顺', cls: 'good' };
  if (ms <= FRAME_BUDGET) return { text: '一般（掉 1 帧）', cls: 'mid' };
  return { text: '卡（掉 2 帧以上）', cls: 'bad' };
}

function paint() {
  if (!hud) return;
  const w = worstSwap();
  const lastSwap = state.swaps.length ? state.swaps[state.swaps.length - 1].worst : 0;
  const set = (sel, text) => {
    const n = hud.querySelector(sel);
    if (n && n.textContent !== text) n.textContent = text;
  };
  set('[data-perf="worstswap"]', w ? `${w}ms` : '—');
  set('[data-perf="lastswap"]', lastSwap ? `${lastSwap}ms` : '—');
  set('[data-perf="worst"]', `${Math.round(Math.max(0, ...state.frames))}ms`);
  set('[data-perf="drops"]', `${state.frames.filter((f) => f > FRAME_BUDGET).length}/${state.frames.length}`);
  set('[data-perf="longtask"]', state.longtasks.length ? `${Math.max(...state.longtasks)}ms` : '—');
  set('[data-perf="pauses"]', state.pauses.length
    ? `${state.pauses.length} 次（最长 ${Math.max(...state.pauses.map((p) => p.ms))}ms，不计入）`
    : '0');
  const off = Object.entries(state.toggles).filter(([, v]) => !v).map(([k]) => ({ ambient: '氛围光', entry: '入场动画', glass: '底栏玻璃', count: '数字滚动' })[k]);
  set('[data-perf="mode"]', off.length ? `已关：${off.join('、')}` : '全开');
  set('[data-perf="count"]', `${state.swaps.length} 次${state.swaps.length ? `（最近 ${state.swaps[state.swaps.length - 1].from} → ${state.swaps[state.swaps.length - 1].to}）` : '：先切一次页'}`);
  const v = verdict(w);
  const badge = hud.querySelector('[data-perf="verdict"]');
  if (badge) {
    badge.textContent = v.text;
    badge.dataset.kind = v.cls;
  }
}

function apply(toggles) {
  const root = document.documentElement;
  for (const a of document.querySelectorAll('.ambient')) a.style.display = toggles.ambient ? '' : 'none';
  root.dataset.perfNoEntry = toggles.entry ? '' : '1';
  const bar = document.getElementById('tabbar');
  if (bar) bar.style.backdropFilter = toggles.glass ? '' : 'none';
  root.dataset.perfNoCount = toggles.count ? '' : '1';
}

export function startPerfHud() {
  if (hud) return hud;
  hud = document.createElement('div');
  hud.className = 'perf-hud';
  hud.dataset.testid = 'perf-hud';
  hud.innerHTML = `
    <div class="perf-row perf-title"><span>帧率浮层</span><button type="button" data-perf="close" aria-label="关闭">×</button></div>
    <div class="perf-row perf-mode"><span>当前状态</span><b data-perf="mode">全开</b></div>
    <div class="perf-hero">
      <div class="perf-hero-label">切页最卡的一帧</div>
      <div class="perf-hero-num"><b data-perf="worstswap">—</b><span class="perf-badge" data-perf="verdict" data-kind="idle">还没测到</span></div>
      <div class="perf-hero-hint">低于 20ms 很顺 · 超过 32ms 就是肉眼可见的顿</div>
    </div>
    <div class="perf-row"><span>切页次数</span><b data-perf="count">0 次：先切一次页</b></div>
    <div class="perf-row"><span>最近一次切页</span><b data-perf="lastswap">—</b></div>
    <div class="perf-row"><span>最近 200 帧最长</span><b data-perf="worst">—</b></div>
    <div class="perf-row"><span>掉帧（&gt;32ms）</span><b data-perf="drops">—</b></div>
    <div class="perf-row"><span>长任务 longtask</span><b data-perf="longtask">—</b></div>
    <div class="perf-row"><span>系统挂起</span><b data-perf="pauses">0</b></div>
    <div class="perf-row perf-toggles">
      <label><input type="checkbox" checked data-perf="t-ambient">氛围光</label>
      <label><input type="checkbox" checked data-perf="t-entry">入场动画</label>
      <label><input type="checkbox" checked data-perf="t-glass">底栏玻璃</label>
      <label><input type="checkbox" checked data-perf="t-count">数字滚动</label>
    </div>
    <div class="perf-row perf-btns">
      <button type="button" data-perf="reset">清除重测</button>
      <button type="button" data-perf="copy">复制数据</button>
    </div>
  `;
  document.body.append(hud);

  for (const [key, sel] of [['ambient', 't-ambient'], ['entry', 't-entry'], ['glass', 't-glass'], ['count', 't-count']]) {
    const box = hud.querySelector(`[data-perf="${sel}"]`);
    box.checked = !!state.toggles[key];   // 复选框状态以持久化的状态为准（别让"勾着但实际关着"骗人）
    box.addEventListener('change', (e) => {
      state.toggles[key] = e.currentTarget.checked;
      try { localStorage.setItem(TOGGLE_KEY, JSON.stringify(state.toggles)); } catch { /* 无所谓 */ }
      apply(state.toggles);
      paint();
    });
  }
  hud.querySelector('[data-perf="reset"]').addEventListener('click', () => {
    state.frames = [];
    state.swaps = [];
    state.longtasks = [];
    state.pauses = [];
    paint();
  });
  hud.querySelector('[data-perf="copy"]').addEventListener('click', async (e) => {
    const payload = {
      切页最卡的一帧: worstSwap() || null,
      系统挂起次数: state.pauses.length,
      系统挂起最长: state.pauses.length ? Math.max(...state.pauses.map((p) => p.ms)) : null,
      系统挂起明细: state.pauses.map((p) => `${p.ms}ms@${p.page}`),
      最近一次切页: state.swaps.length ? state.swaps[state.swaps.length - 1].worst : null,
      切页次数: state.swaps.length,
      每次切页: state.swaps.map((s) => ({ 从: s.from, 到: s.to, 最慢帧: s.worst })),
      当前页面: location.hash || '#/',
      最近200帧最长: Math.round(Math.max(0, ...state.frames)),
      掉帧数: state.frames.filter((f) => f > FRAME_BUDGET).length,
      长任务: state.longtasks,
      开关: state.toggles,
      版本: document.body.dataset.appVersion || '?',
      显示模式: matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
      设备像素比: devicePixelRatio,
      视口: `${innerWidth}×${innerHeight}`
    };
    const text = JSON.stringify(payload, null, 1);
    try {
      await navigator.clipboard.writeText(text);
      e.currentTarget.textContent = '已复制 ✅';
    } catch {
      window.prompt('复制下面这段发我：', text);
    }
    setTimeout(() => { e.currentTarget.textContent = '复制数据'; }, 1500);
  });
  hud.querySelector('[data-perf="close"]').addEventListener('click', () => {
    hud.remove();
    hud = null;
    cancelAnimationFrame(rafId);
    try { localStorage.removeItem('vocab.perf'); } catch { /* 无所谓 */ }
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

  // 页面被挂起/恢复时重置计时起点：否则"回来后的第一帧"会被算成巨帧
  const resetClock = () => { last = 0; };
  document.addEventListener('visibilitychange', resetClock);
  window.addEventListener('pageshow', resetClock);
  window.addEventListener('focus', resetClock);

  // 钩子挂到 window 上：app.js 的 perfMark 通过它转发（两条启动路径都能接上）
  window.__perfMark = perfMark;
  currentFrom = location.hash || '#/';   // 首屏就是某个页面时，别让第一次切换的 from 记成 #/

  apply(state.toggles);
  last = 0;
  rafId = requestAnimationFrame(tick);
  return hud;
}

export const _internal = { state, verdict, worstSwap };
// 给排查脚本用：能看到每次切页窗口的最慢帧清单（真机排查也可以从这里复制）
if (typeof window !== 'undefined') window.__perfState = state;
