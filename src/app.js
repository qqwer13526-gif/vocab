/* 背单词 App —— 应用外壳：hash 路由 + 全局小工具。
 *
 * 各界面是一个模块（ui-*.js），导出自己的 render 函数，在这里注册。
 * 状态放 URL（#/practice?lib=xxx&dir=zh2en），这样刷新和回退都靠得住。
 *
 * 这里还负责"更新"这件事：iOS 上的主屏幕应用不会自己发现新版本，
 * 所以应用在前台时会**主动检查**，发现新版就在顶部显示一条"立即更新"。
 *
 * v30 启动优化：
 *   - 首屏只静态 import 首页那条链；其余界面（练习/导入/词条/设置）改成**按需 import**，
 *     冷启动要下的模块从 21 个降到 ~12 个（国内到 GitHub Pages 每个请求 ~400ms）
 *   - 首屏骨架（index.html 里的内联块）在第一屏渲染完后删掉，冷启动不再白屏
 *   - 记一次启动耗时 + 申请持久化存储，都写进设置页的「数据状态」
 *
 * v32：
 *   - 主题三态（浅色 / 深色 / 跟随系统）：启动时应用一次 + 监听系统变化；见 src/theme.js
 *   - 全局按钮按压反馈（0.96 + 轻微超调）：一处委托，全 app 都有；见 src/press.js
 *   - 氛围光：把当前词库色铺成页面底的柔光
 */

import { renderHome } from './ui-home.js';
import { showToast } from './toast.js';
import { icon } from './icons.js';
import { applyTheme, loadTheme, setAmbient, watchSystemTheme } from './theme.js';
import { wirePressFeedback } from './press.js';
import { wireNavGlass } from './glass.js';
import { bumpMotionGen, staggerPage } from './motion.js';
import { APP_VERSION, VERSION_URL } from './version.js';
import { setupViewport } from './viewport.js';

const VIEWS = {
  home: '#view-home',
  practice: '#view-practice',
  import: '#view-import',
  word: '#view-word',
  settings: '#view-settings'
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** 建元素的小助手：el('div', {className:'x'}, ['文本', 子元素]) */
export function el(tag, props = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    // ⚠️ 必须走属性赋值：setAttribute('className', ...) 不会真的加上 class
    else if (k === 'className') n.className = v;
    else if (k === 'htmlFor') n.htmlFor = v;
    else if (k === 'value') n.value = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) if (kid != null) n.append(kid);
  return n;
}

export const RENDER = {};

/** 界面模块用它注册自己的渲染函数 */
export function register(name, fn) {
  RENDER[name] = fn;
}

/** 按需加载的界面：值是"返回渲染函数"的 loader（见 v30 的启动优化） */
const LAZY = {};
export function registerLazy(name, loader) {
  LAZY[name] = loader;
}

let bootRecorded = false;

/** 第一屏渲染完：删掉骨架、记下这次启动花了多久（设置页会显示） */
function markFirstPaint() {
  const sk = document.getElementById('boot-skeleton');
  if (sk) sk.remove();
  if (bootRecorded) return; // 只记"这一次会话的第一屏"，后面切界面不算启动
  bootRecorded = true;
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    const bytes = res.reduce((s, r) => s + (r.transferSize || 0), 0);
    localStorage.setItem('vocab.lastBoot', JSON.stringify({
      at: Date.now(),
      ms: Math.round(performance.now()),
      responseEnd: Math.round(nav?.responseEnd || 0),
      requests: res.length,
      kb: Math.round(bytes / 102.4) / 10,
      sw: !!navigator.serviceWorker?.controller
    }));
  } catch {
    /* 隐私模式不让写就算了 */
  }
  // 设置页可能已经渲染出来了（直接打开 #/settings 的情况），叫它把这行字补上
  window.dispatchEvent(new Event('vocab:boot'));
}

let current = { name: null, params: {} };
export const currentRoute = () => current;

export function show(name, params = {}) {
  if (!VIEWS[name]) name = 'home';
  const view = $(VIEWS[name]);
  const prev = current.name && current.name !== name ? $(VIEWS[current.name]) : null;
  // 原子换页：新视图先"画好但不可见"，等渲染完再和旧页在同一帧里对调。
  // 以前是"旧页立刻 hidden → 等新页异步渲染"，中间会空一帧（实测 ~8ms），看着就是抖一下。
  // ⚠️ 用 visibility 而不是 display:none —— 有些界面要量 getBoundingClientRect（练习页的滑片），
  //    display:none 会让量出来全是 0。
  if (view) {
    // 让新视图**参与布局但看不见**（.is-swapping = 脱离文档流 + opacity:0）：
    // 渲染期间界面要量尺寸（练习页的折叠判断、键盘避让），display:none 会量出 0 —— 踩过。
    // ⚠️ 用 opacity 而不是 visibility：visibility:hidden 的内容不绘制，整页绘制会全砸在对调那一帧。
    view.hidden = false;
    if (prev) {
      view.classList.add('is-swapping');
      view.inert = true; // 不可见期间别让键盘焦点跑进去
    }
  }
  for (const [k, sel] of Object.entries(VIEWS)) {
    const v = $(sel);
    if (!v) continue;
    if (k !== name) v.hidden = true;
  }
  current = { name, params };
  document.body.dataset.view = name;
  // 底部导航：语义上的"当前项"（aria-current）只给真正对应的那一格；
  // 视觉上的指示器（白药丸）在 word/practice 这种子界面里停在它所属的那一格。
  const TAB_OF_VIEW = { home: 'home', import: 'import', settings: 'settings', word: 'home', practice: 'home' };
  const tabs = [...document.querySelectorAll('#tabbar a')];
  const activeKey = TAB_OF_VIEW[name] || 'home';
  const idx = Math.max(0, tabs.findIndex((a) => a.dataset.nav === activeKey));
  for (const a of tabs) {
    if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const bar = document.getElementById('tabbar');
  if (bar) {
    bar.style.setProperty('--nav-count', String(tabs.length || 3));
    bar.style.setProperty('--nav-i', String(idx));
  }
  delete document.body.dataset.ready;
  if (!RENDER[name] && !LAZY[name]) return;
  // 渲染函数可以是异步的（要读 IndexedDB），也可能要先按需把界面模块 import 进来；
  // 渲染完打一个 ready 标记，验证脚本靠它，骨架也在这一刻撤掉
  Promise.resolve()
    .then(async () => {
      const fn = RENDER[name] || (await LAZY[name]());
      if (fn) await fn(params);
    })
    .catch((err) => console.error('[route] 渲染失败', name, err))
    .finally(() => {
      // 这一帧要做的三件事（顺序有意义）：
      //   ① 滚动归零 —— staggerPage 要按"新页在顶部的样子"判断哪些卡片在屏内
      //   ② 起入场 —— 此时新页还不可见（.is-swapping = 脱离文档流 + opacity:0），
      //      所以建层/绘制的成本摊在渲染期间，不挤在对调那一帧
      //   ③ 对调 —— 撤掉不可见、藏旧页（同一帧只画最终状态，用户看不到中间态）
      const commitView = () => {
        // 历史导航（返回/前进/边缘滑动）不播入场：那段时间页面被系统冻住，播了也看不到，
        // 反而会停在第一帧（一片空白）。原生 App 返回时也不重播。详见文件上方 routeIsHistory 的注释。
        const skipEntry = routeIsHistory;
        routeIsHistory = false;
        // 切页窗口内先关掉底栏模糊（见 style.css 里 body[data-switching] 那条注释）
        try {
          document.body.dataset.switching = '1';
          clearTimeout(commitView.__t);
          commitView.__t = setTimeout(() => { delete document.body.dataset.switching; }, 450);
        } catch {
          /* 无所谓 */
        }
        window.scrollTo(0, 0);
        if (name !== 'practice' && !skipEntry) staggerPage(view, { scope: `page:${name}` });
        perfMark('entry');
        if (view) {
          view.hidden = false;
          if (prev && prev !== view) prev.hidden = true;
          view.classList.remove('is-swapping');
          view.inert = false;
        }
        perfMark('swap');
      };

      commitView();
      document.body.dataset.ready = '1';
      markFirstPaint();
  // 首屏画完之后再预热（别和首屏抢带宽/主线程）
  if (typeof requestIdleCallback === 'function') requestIdleCallback(warmLazyViews, { timeout: 3000 });
  else setTimeout(warmLazyViews, 1500);
    });
}

export function go(hash) {
  if (location.hash === hash) show(...Object.values(parseHash()));
  else location.hash = hash;
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  const seg = (path || '').split('/')[0];
  return { name: seg || 'home', params };
}

export function route() {
  const { name, params } = parseHash();
  // 这次是"历史导航"（返回/前进/边缘滑动）还是"点导航"？
  routeIsHistory = popstateSeen && history.length === histLen;
  popstateSeen = false;
  histLen = history.length;
  try {
    document.body.dataset.lastNav = routeIsHistory ? 'history' : 'tap'; // 诊断/测试用
  } catch {
    /* 无所谓 */
  }
  bumpMotionGen(); // v34：换页 = 新一代 → 整页卡片的交错入场会重新播
  show(name, params);
}

// ---------------------------------------------------------------- 各界面
// 首页静态引入（首屏就要它）；其余四个按需 import —— 冷启动不必先把练习/导入/词条/设置的代码也下下来
register('home', renderHome);
registerLazy('practice', () => import('./ui-practice.js').then((m) => m.renderPractice));
registerLazy('import', () => import('./ui-import.js').then((m) => m.renderImport));
registerLazy('word', () => import('./ui-word.js').then((m) => m.renderWord));
registerLazy('settings', () => import('./ui-settings.js').then((m) => m.renderSettings));

// ---------------------------------------------------------------- service worker 与"更新"

/* 帧率浮层（?perf=1）的钩子：只有你主动打开时才 import src/perf.js，
   正常使用一个字节都不加载。perfMark 是给"切页两个阶段"打点用的。 */
/* ⚠️ 别只在自己 import 时赋值：从设置里的开关启动浮层时也要能接上，
   否则 perfMark 全被丢掉、浮层永远显示"切页次数 0"（用户就碰到过，而且那份对照数据因此无效 ✗）。
   所以让 perf.js 自己在启动时挂到 window 上，这里只做转发。 */
function perfMark(name) {
  if (typeof window !== 'undefined' && window.__perfMark) window.__perfMark(name);
}

/* 历史导航（返回/前进/边缘滑动）的判据，以及它为什么要特殊对待（v50）。
   判据：`popstate 触发` **且** `history.length 与上次相同`。
   ⚠️ 只用 popstate 不行 —— Chromium 里程序化改 hash 也触发它（踩过：点导航也被当成返回）。
   规范上 push 一个历史项会让 length +1，返回/前进不会。

   为什么历史导航**不播入场**（这里是第三个方案，前两个都错）：
     ① 延迟入场动画 → fill:backwards 让卡片在延迟期间保持 opacity:0 → 新页一出现全是隐形 ✗
     ② 延迟整页对调 → 过渡结束时露出的是实时 DOM，那时它还是旧页 → 先看到旧页再跳 ✗
     ③ 不播入场（现在）—— 因为真机数据证明：**每一次边缘滑动都会把页面冻住约 485ms**
        （系统挂起明细 4 条 485~489ms，而只切成功 1 次 → 连取消的滑动也各冻一次）
        在冻结期间创建的动画，等冻结结束时间轴早已走完 → 用户只会看到"落定"或"一片空白"。
        原生 App 从返回手势回来时也不会重播入场，所以这不播是符合直觉的行为 ✓ */
let popstateSeen = false;
let histLen = typeof history !== 'undefined' ? history.length : 0;
let routeIsHistory = false;

let swReg = null;
let lastCheck = 0;
let hadControllerAtBoot = false;
const CHECK_THROTTLE_MS = 30 * 1000;

function markSW() {
  document.body.dataset.sw = navigator.serviceWorker && navigator.serviceWorker.controller ? 'ready' : 'pending';
}

/**
 * 顶部那条"有新版本"。
 * ⚠️ 只该由**一处**信号驱动：version.json（no-store 取）报出的版本 ≠ 本机 APP_VERSION。
 * 曾经 controllerchange 也来点亮它 —— 而更新成功后新 SW 会 clients.claim()，
 * 正好又触发 controllerchange，于是"刚更新完横幅又弹回来"，用户以为没更新成功（踩过）。
 */
export function markUpdateReady(on, remote = null) {
  document.body.dataset.update = on ? 'ready' : 'no';
  if (remote) document.body.dataset.updateVersion = remote;
  const bar = document.getElementById('update-bar');
  if (!bar) return;
  bar.hidden = !on;
  if (on) {
    const label = bar.querySelector('span');
    if (label) {
      label.textContent = remote
        ? `有新版本 ${remote}（当前 ${APP_VERSION}）· 更新后数据不会丢`
        : '有新版本了 · 更新后数据不会丢';
    }
  }
}

/* ---------------------------------------------------------------- 更新完成后的"确认" */

const UPDATE_TO_KEY = 'vocab.updateTo';
const UPDATE_TRIES_KEY = 'vocab.updateTries';

function readSession(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, String(value));
  } catch {
    /* 隐私模式下写不了就算了 */
  }
}

/**
 * 启动时收口"上一次点了立即更新"这件事：
 *   版本对上了 → 祝贺一下（这就是"更新成功了"那个可见的确认）+ 确保横幅隐藏
 *   版本没变   → 自动走一次硬路径；已经试过还不行就说明白，别让人反复点
 */
function settleUpdateAttempt() {
  const want = readSession(UPDATE_TO_KEY);
  if (!want) return;
  if (want === APP_VERSION) {
    writeSession(UPDATE_TO_KEY, null);
    writeSession(UPDATE_TRIES_KEY, null);
    markUpdateReady(false);
    setTimeout(() => showToast(`已更新到 ${APP_VERSION}`, { kind: 'ok' }), 400);
    return;
  }
  const tries = Number(readSession(UPDATE_TRIES_KEY) || 0);
  if (tries < 1) {
    writeSession(UPDATE_TRIES_KEY, String(tries + 1));
    // 硬路径：注销 SW + 清缓存 + 带时间戳重开（绕开一切缓存）
    hardReload(want);
    return;
  }
  writeSession(UPDATE_TRIES_KEY, null);
  markUpdateReady(true, want);
  const bar = document.getElementById('update-bar');
  const label = bar && bar.querySelector('span');
  if (label) label.textContent = '更新没生效：请把这个 App 完全关掉（上滑划掉）再打开';
}

/** 最硬的一招：注销所有 SW、清掉所有缓存，然后带 ?v= 时间戳重新加载 */
async function hardReload(want = null) {
  try {
    if (want) writeSession(UPDATE_TO_KEY, want);
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* 走到最后还是要在下面重开 */
  }
  const url = new URL(location.href);
  url.searchParams.set('v', String(Date.now()));
  location.replace(url.toString());
}

export const updateState = () => ({
  version: APP_VERSION,
  hasReg: !!swReg,
  ready: document.body.dataset.update === 'ready',
  remote: document.body.dataset.updateVersion || null
});

/** 版本探测文件的地址（测试时可以指向别处） */
function versionUrl() {
  try {
    return localStorage.getItem('vocab.versionUrl') || VERSION_URL;
  } catch {
    return VERSION_URL;
  }
}

/**
 * 问服务端"现在最新是哪个版本"。
 * 用 no-store 取，绕开 HTTP 缓存 —— GitHub Pages 给静态文件的 max-age=600
 * 就是"发版后 10 分钟内手机上发现不了新版本"的元凶。
 */
export async function fetchRemoteVersion() {
  const url = new URL(versionUrl(), document.baseURI);
  url.searchParams.set('t', String(Date.now()));
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const v = typeof data === 'string' ? data : data && data.version;
  return v ? String(v) : null;
}

/**
 * 主动检查有没有新版本。三层保险：
 *   1) 直接取 version.json 对比版本号（不依赖 service worker 的任何行为）
 *   2) 顺手 reg.update()，让浏览器去取新的 sw.js
 *   3) 聊天窗口切回前台、网络恢复时都会再查一次
 */
export async function checkForUpdate({ force = false } = {}) {
  // ⚠️ 这里**不能**因为"没有 service worker"就退出：版本对比是独立的一层，
  //    真机上就出现过注册没成功（设置页写着"这个环境里没有 service worker"）→ 于是永远发现不了新版本。
  const now = Date.now();
  if (!force && now - lastCheck < CHECK_THROTTLE_MS) return { checked: false, reason: 'throttled' };
  lastCheck = now;

  let remote = null;
  let error = null;
  try {
    remote = await fetchRemoteVersion();
  } catch (err) {
    error = String((err && err.message) || err);
  }
  if (remote && remote === APP_VERSION) markUpdateReady(false); // 已经是最新 → 把横幅收掉
  if (remote && remote !== APP_VERSION) markUpdateReady(true, remote);

  try {
    if (swReg) await swReg.update();
  } catch {
    /* 离线或 SW 有问题都不影响上面的版本对比 */
  }
  return {
    checked: true,
    local: APP_VERSION,
    remote,
    ready: document.body.dataset.update === 'ready',
    hasReg: !!swReg,
    error
  };
}

/**
 * 点「立即更新」。
 * 除了让新 SW 接管，还会**清掉所有缓存**：旧 SW 卡在旧代码上时，这是最有效的一招 ——
 * 下次加载它只能从网络取，新的 HTML/JS 立刻就进来了。数据在 IndexedDB 里，不受影响。
 */
export async function applyUpdate() {
  const target = document.body.dataset.updateVersion || null;
  if (target) writeSession(UPDATE_TO_KEY, target);
  // ① 立刻给反馈（以前点了毫无变化，用户只能连点）
  for (const sel of ['[data-testid="btn-update"]', '[data-testid="btn-update-now"]']) {
    const b = document.querySelector(sel);
    if (!b) continue;
    b.disabled = true;
    b.setAttribute('aria-busy', 'true');
    b.textContent = '正在更新…';
  }
  document.body.dataset.updating = '1';

  // ② 准备：让新 worker 接管 + 清掉旧缓存。整段有总上限（见下），绝不会把用户按在"正在更新…"上。
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // 阶段计时：点更新这一下到底把时间花哪了（排查"要等半天"用，设置页的启动诊断也会读它）
  const T0 = performance.now();
  const phases = {};
  const mark = (k) => { phases[k] = Math.round(performance.now() - T0); };
  const prep = (async () => {
    try {
      if (swReg && swReg.waiting) swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
      if (swReg) swReg.update().catch(() => {});
    } catch {
      /* 失败也不影响"最后一定要 reload" */
    }
    // 清缓存：不是全删（全删会把新 SW 刚预缓存的也删掉，更新后首屏反而变慢）。
    // 没有 SW 时（真机上遇到过）缓存可能整片都是旧的 → 那种情况才全清。
    // ⚠️ 这一步就是"立刻生效"的关键：缓存名带版本号（vocab-v38），这里把**旧版本那份删掉**，
    //    于是哪怕控制页面的还是旧 worker，它去缓存里也找不到旧文件，只能走网络取新的。
    mark('sw');
    if (navigator.onLine && typeof caches !== 'undefined') {
      const keys = await caches.keys();
      mark('keys');
      // 以【目标版本】为准（不是【当前版本】）：目标是 v41 就保留 vocab-v41、删掉 vocab-v40。
      // 拿不到目标版本时才退回全清。⚠️ 改成只删【非当前 APP_VERSION】的缓存会导致双重重载（踩过）。
      const stale = target ? keys.filter((k) => !k.includes(target)) : keys;
      phases.stale = stale.length;
      await Promise.race([Promise.all(stale.map((k) => caches.delete(k))), wait(600)]);
      mark('cleared');
      if (swReg && swReg.active) swReg.active.postMessage({ type: 'CLEAN' });
    }
    // ⚠️ 这里**不等**新 worker 接管 —— 以前无条件等最多 2.5s（而且新 worker 已经在接管时
    //    controllerchange 根本不会再触发，等于每次白等满）；现在既然旧缓存已经删了，
    //    重载时旧 worker 也只能走网络，不必等它。实测这一段省掉 ~0.8s。
    //    真出问题也有兜底：重载后版本不对 → settleUpdateAttempt() 走硬路径。
  })();
  // 总上限 900ms：无论如何都要 reload。剩下的交给"重载后版本对不对"的校验与硬路径兜底。
  await Promise.race([prep.catch(() => {}), wait(900)]);
  mark('prep');
  try {
    // 存 sessionStorage：重载后新文档还能读到（用来回答"这次更新把时间花哪了"）
    sessionStorage.setItem('vocab.updPhases', JSON.stringify(phases));
    document.body.dataset.updPhases = JSON.stringify(phases);
  } catch {
    /* 无所谓 */
  }

  if (swReg) {
    location.reload();
    return;
  }
  // 没有 SW 可等：带时间戳重开，绕开 HTTP 缓存（这就是那条硬路径）
  const url = new URL(location.href);
  url.searchParams.set('v', String(Date.now()));
  location.replace(url.toString());
}

/**
 * 硬路径（设置页的「强制重新加载」）：注销 service worker、清掉缓存、带时间戳重开。
 * 没有 SW 的安装上，这是唯一可靠的更新方式 —— 真机截图里那台就是这样。
 */
export async function forceReload() {
  const target = document.body.dataset.updateVersion || null;
  if (target) writeSession(UPDATE_TO_KEY, target);
  await hardReload(target);
}

function waitForControllerChange(ms) {
  return new Promise((resolve) => {
    if (!navigator.serviceWorker) return resolve();
    const done = () => {
      navigator.serviceWorker.removeEventListener('controllerchange', done);
      resolve();
    };
    navigator.serviceWorker.addEventListener('controllerchange', done);
    setTimeout(done, ms);
  });
}

async function setupServiceWorker() {
  markSW();
  document.body.dataset.appVersion = APP_VERSION;
  if (document.body.dataset.update !== 'ready') document.body.dataset.update = 'no';
  if (!('serviceWorker' in navigator)) {
    document.body.dataset.swreg = 'unsupported';
    return;
  }
  try {
    // 用 document.baseURI 解析：本地在根目录、GitHub Pages 在 /vocab/ 子路径都对。
    // （别用 import.meta.url —— 那会解析成 /src/sw.js，注册范围就错了）
    const hadController = !!navigator.serviceWorker.controller;
    hadControllerAtBoot = hadController;
    // updateViaCache: 'none' —— 检查 sw.js 更新时不走 HTTP 缓存（Pages 给的是 max-age=600）
    const reg = await navigator.serviceWorker.register(new URL('./sw.js', document.baseURI), { updateViaCache: 'none' });
    swReg = reg;
    document.body.dataset.swreg = reg.active ? 'active' : reg.installing ? 'installing' : reg.waiting ? 'waiting' : 'registered';
    // 把安装/激活进度暴露到 body 上，验证脚本和排查都靠它
    for (const w of [reg.installing, reg.waiting, reg.active]) {
      if (!w) continue;
      document.body.dataset.swstate = w.state;
      w.addEventListener('statechange', (e) => {
        document.body.dataset.swstate = e.target.state;
      });
    }
    // ⚠️ SW 的生命周期只用来写诊断（body.dataset.sw*），**不再**点亮横幅 ——
    //    横幅的唯一依据是 version.json 对比（见 checkForUpdate）。
    //    以前 controllerchange 也点亮它，而更新成功后新 SW 的 clients.claim() 正好触发它，
    //    于是"刚更新完横幅又弹回来"（用户读作：点了没反应）。别再改回去。
    document.body.dataset.swwaiting = reg.waiting ? '1' : '0';
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        document.body.dataset.swstate = sw.state;
        if (sw.state === 'installed') document.body.dataset.swinstalled = hadControllerAtBoot ? 'update' : 'first';
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      markSW();
      document.body.dataset.swclaimed = '1';
    });
    // 切回前台时查一次更新（节流），这样不用回 Safari 也能拿到新版
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkForUpdate();
    });
    window.addEventListener('online', () => checkForUpdate());
    markSW();
    checkForUpdate({ force: true });
  } catch (err) {
    document.body.dataset.swreg = 'error:' + err.message;
    console.warn('[sw] 注册失败（file:// 下属于正常现象，不影响使用）', err);
  }
}

function wireUpdateButton() {
  const btn = document.querySelector('[data-testid="btn-update"]');
  btn?.addEventListener('click', () => applyUpdate());
}

/**
 * 预热"按需加载"的四个界面（v45）。
 * 为什么：这几个界面是 lazy import 的，第一次切过去要**下载 + 解析模块** ——
 * 手机上那一段就是"切页顿一下"。首屏画完之后在空闲时把它们拉进来，
 * 并按本文件的约定塞进 RENDER，之后 show() 直接用，不再走 LAZY。
 */
function warmLazyViews() {
  try {
    if (navigator.connection && navigator.connection.saveData) return; // 省流模式：不偷跑流量
  } catch {
    /* 拿不到 connection 就照常预热 */
  }
  for (const name of ['settings', 'import', 'word', 'practice']) {
    if (RENDER[name] || !LAZY[name]) continue;
    Promise.resolve()
      .then(() => LAZY[name]())
      .then((fn) => {
        if (fn) RENDER[name] = fn;
        document.body.dataset.warmed = (document.body.dataset.warmed || '') + name + ',';
      })
      .catch(() => {
        /* 预热失败无所谓，真要用时还会再 import 一次 */
      });
  }
}

function boot() {
  markSW();
  // 换页时我们自己把滚动归零（原子换页那一帧做），别让浏览器再"恢复滚动位置"来搅局
  try {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  } catch {
    /* 老浏览器没有就算了 */
  }
  settleUpdateAttempt();
  // ?edge=1 才加载"白边定位"（真机排查过渡时露白用）
  try {
    if (new URLSearchParams(location.search).has('edge')) {
      import('./edge.js').then((m) => m.startEdgeProbe()).catch(() => {});
    }
  } catch {
    /* 无所谓 */
  }
  // ?perf=1 才加载帧率浮层（真机排查切页卡顿用）
  try {
    // 认两种：网址参数，或设置里的开关（手机上不用手打 ?perf=1）
    if (new URLSearchParams(location.search).has('perf') || localStorage.getItem('vocab.perf') === '1') {
      import('./perf.js')
        .then((m) => m.startPerfHud())
        .catch(() => {});
    }
  } catch {
    /* 无所谓 */
  }
  // ?v=xxx 只是用来破缓存的，进页面后把地址栏恢复干净
  try {
    const u = new URL(location.href);
    if (u.searchParams.has('v')) {
      u.searchParams.delete('v');
      history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams : '') + u.hash);
    }
  } catch {
    /* 无所谓 */
  }
  applyTheme(loadTheme()); // 主题：内联脚本已在第一帧前写过 data-theme，这里做状态栏/持久化的收口
  watchSystemTheme();
  wirePressFeedback(); // 全局按压反馈：按下 0.96、松手轻微超调（减弱动效下自动不动）
  wireNavGlass(); // 底部胶囊的"液态"行为：高光随滚动位移 + 压着卡片时玻璃更浓
  setAmbient(undefined, { immediate: true }); // 氛围光先落品牌色，进词库页/练习页会被换成库色
  // 底部导航的图标只写在 icons.js 一处，这里按 data-nav 注入（HTML 里保持纯文字）
  const TAB_ICONS = { home: 'layers', import: 'upload', settings: 'settings' };
  for (const a of document.querySelectorAll('#tabbar a')) {
    a.prepend(icon(TAB_ICONS[a.dataset.nav], { size: 24 }));
  }
  // 先把界面渲染出来：service worker 是后台的事，注册失败/挂起都不能挡着用
  route();
  wireUpdateButton();
  setupServiceWorker();
  setupViewport(); // 键盘高度写进 CSS 变量，输入框不会被键盘盖住
  requestPersistence(); // 尽量别让系统清掉缓存/数据（"每次打开都要重下"多半是这个）
}

/**
 * 申请持久化存储。iOS 在空间紧张 / 长期不打开时会清掉 service worker 缓存和 IndexedDB，
 * 结果就是"每次进应用都像第一次"（要重新下载 200 多 KB）。申请到了就稳得多。
 * 不弹权限框、失败也不影响使用，结果写进 body 供设置页与排查看。
 */
function requestPersistence() {
  if (!navigator.storage?.persist) {
    document.body.dataset.persist = 'unsupported';
    return;
  }
  navigator.storage.persisted?.()
    .then((already) => (already ? true : navigator.storage.persist()))
    .then((ok) => {
      document.body.dataset.persist = ok ? 'granted' : 'denied';
    })
    .catch(() => {
      document.body.dataset.persist = 'error';
    });
}

addEventListener('hashchange', route);
// 返回/前进/边缘滑动会先来 popstate（hash 变了的话浏览器随后补 hashchange → route() 在那里跑）
addEventListener('popstate', () => {
  popstateSeen = true;
});
// 从 bfcache 回来（比如从别的 App 切回来、或跨文档返回）：DOM 还是旧样子，重新播一次入场
addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  bumpMotionGen();
  const view = document.querySelector(`#view-${current.name}`);
  if (view && current.name !== 'practice') staggerPage(view, { scope: `page:${current.name}` });
});
boot();
