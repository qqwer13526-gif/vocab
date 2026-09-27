/* 背单词 App —— 应用外壳：hash 路由 + 全局小工具。
 *
 * 各界面是一个模块（ui-*.js），导出自己的 render 函数，在这里注册。
 * 状态放 URL（#/practice?lib=xxx&dir=zh2en），这样刷新和回退都靠得住。
 *
 * 这里还负责"更新"这件事：iOS 上的主屏幕应用不会自己发现新版本，
 * 所以应用在前台时会**主动检查**，发现新版就在顶部显示一条"立即更新"。
 */

import { renderHome } from './ui-home.js';
import { renderPractice } from './ui-practice.js';
import { renderImport } from './ui-import.js';
import { renderWord } from './ui-word.js';
import { renderSettings } from './ui-settings.js';
import { APP_VERSION } from './version.js';

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

let current = { name: null, params: {} };
export const currentRoute = () => current;

export function show(name, params = {}) {
  if (!VIEWS[name]) name = 'home';
  for (const [k, sel] of Object.entries(VIEWS)) {
    const v = $(sel);
    if (v) v.hidden = k !== name;
  }
  current = { name, params };
  document.body.dataset.view = name;
  delete document.body.dataset.ready;
  const fn = RENDER[name];
  if (!fn) return;
  // 渲染函数可以是异步的（要读 IndexedDB）；渲染完打一个 ready 标记，验证脚本靠它
  Promise.resolve()
    .then(() => fn(params))
    .catch((err) => console.error('[route] 渲染失败', name, err))
    .finally(() => {
      document.body.dataset.ready = '1';
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
  show(name, params);
}

// ---------------------------------------------------------------- 各界面
register('home', renderHome);
register('practice', renderPractice);
register('import', renderImport);
register('word', renderWord);
register('settings', renderSettings);

// ---------------------------------------------------------------- service worker 与"更新"

let swReg = null;
let lastCheck = 0;
let hadControllerAtBoot = false;
const CHECK_THROTTLE_MS = 30 * 1000;

function markSW() {
  document.body.dataset.sw = navigator.serviceWorker && navigator.serviceWorker.controller ? 'ready' : 'pending';
}

/** 顶部那条"有新版本" */
export function markUpdateReady(on) {
  document.body.dataset.update = on ? 'ready' : 'no';
  const bar = document.getElementById('update-bar');
  if (bar) bar.hidden = !on;
}

export const updateState = () => ({ version: APP_VERSION, hasReg: !!swReg, ready: document.body.dataset.update === 'ready' });

/**
 * 主动检查有没有新版本。
 * iOS 上的主屏幕应用不刷新页面就不会发现新版，所以打开应用/切回前台时都要查一次。
 *
 * ⚠️ 不要用 `reg.installing` 判断"有新版本"：update() 期间它会短暂非空，
 * 结果是明明没新版也把横幅挂出来。真正的信号是 updatefound→installed 或 controllerchange。
 */
export async function checkForUpdate({ force = false } = {}) {
  if (!swReg) return { checked: false, reason: 'no-registration' };
  const now = Date.now();
  if (!force && now - lastCheck < CHECK_THROTTLE_MS) return { checked: false, reason: 'throttled' };
  lastCheck = now;
  try {
    await swReg.update();
  } catch (err) {
    return { checked: true, error: String((err && err.message) || err) };
  }
  return { checked: true, ready: document.body.dataset.update === 'ready' };
}

/** 点「立即更新」：让新 SW 立刻接管，然后重新加载页面（数据在原存储里，不会丢） */
export async function applyUpdate() {
  try {
    if (swReg && swReg.waiting) {
      swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 2500);
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => {
            clearTimeout(t);
            resolve();
          },
          { once: true }
        );
      });
    }
  } catch {
    /* 继续 reload 就是 */
  }
  location.reload();
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
    const reg = await navigator.serviceWorker.register(new URL('./sw.js', document.baseURI));
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
    // 真的有个装好但没接管的新 SW 才算"有新版本"
    if (reg.waiting && hadController) markUpdateReady(true);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && hadControllerAtBoot) markUpdateReady(true);
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      markSW();
      // 首次安装（之前没有 controller）不算"有新版本"
      if (hadControllerAtBoot) markUpdateReady(true);
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

function boot() {
  markSW();
  // 先把界面渲染出来：service worker 是后台的事，注册失败/挂起都不能挡着用
  route();
  wireUpdateButton();
  setupServiceWorker();
}

addEventListener('hashchange', route);
boot();
