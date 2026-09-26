/* 背单词 App —— 应用外壳：hash 路由 + 全局小工具。
 *
 * 四个界面各自是一个模块（ui-*.js），导出自己的 render 函数，在这里注册。
 * 状态放 URL（#/practice?lib=xxx&dir=zh2en），这样刷新和回退都靠得住。
 */

import { renderHome } from './ui-home.js';
import { renderPractice } from './ui-practice.js';
import { renderImport } from './ui-import.js';
import { renderWord } from './ui-word.js';

const VIEWS = {
  home: '#view-home',
  practice: '#view-practice',
  import: '#view-import',
  word: '#view-word'
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

// ---------------------------------------------------------------- service worker
function markSW() {
  document.body.dataset.sw = navigator.serviceWorker && navigator.serviceWorker.controller ? 'ready' : 'pending';
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) {
    document.body.dataset.swreg = 'unsupported';
    return;
  }
  try {
    // 用 document.baseURI 解析：本地在根目录、GitHub Pages 在 /vocab/ 子路径都对。
    // （别用 import.meta.url —— 那会解析成 /src/sw.js，注册范围就错了）
    const reg = await navigator.serviceWorker.register(new URL('./sw.js', document.baseURI));
    document.body.dataset.swreg = reg.active ? 'active' : reg.installing ? 'installing' : reg.waiting ? 'waiting' : 'registered';
    // 把安装/激活进度暴露到 body 上，验证脚本和排查都靠它
    for (const w of [reg.installing, reg.waiting, reg.active]) {
      if (!w) continue;
      document.body.dataset.swstate = w.state;
      w.addEventListener('statechange', (e) => {
        document.body.dataset.swstate = e.target.state;
      });
    }
    navigator.serviceWorker.addEventListener('controllerchange', markSW);
    markSW();
  } catch (err) {
    document.body.dataset.swreg = 'error:' + err.message;
    console.warn('[sw] 注册失败（file:// 下属于正常现象，不影响使用）', err);
  }
}

function boot() {
  markSW();
  // 先把界面渲染出来：service worker 是后台的事，注册失败/挂起都不能挡着用
  route();
  registerSW();
}

addEventListener('hashchange', route);
boot();
