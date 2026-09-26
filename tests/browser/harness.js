/* 浏览器内测试的小框架：收集断言 → 写进 <pre id="result">。
 *
 * 用法（测试页里）：
 *     import { ok, eq, threw, holdLoad, report } from './harness.js';
 *     const release = holdLoad();       // 拖住 load 事件
 *     ...断言...
 *     report(); release();              // 报告 + 放行，无头 Edge 正好在这时 dump
 */

export const RESULTS = [];

export function ok(name, cond, detail = '') {
  RESULTS.push({ name, ok: !!cond, detail: cond ? '' : String(detail) });
}

export function eq(name, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  ok(name, same, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

/** 断言 fn() 会抛错（同步或异步） */
export async function threw(name, fn) {
  try {
    await fn();
    ok(name, false, '本来应该抛错的，却没有');
  } catch {
    ok(name, true);
  }
}

/** 拖住 load 事件：无头 Edge 的 --dump-dom 要等 load，于是 dump 就发生在测试结束时 */
export function holdLoad(url = '../../__slow?ms=90000') {
  const img = new Image();
  img.alt = '';
  img.width = 1;
  img.height = 1;
  img.src = url;
  document.body.append(img);
  let released = false;
  return function release() {
    if (released) return;
    released = true;
    // 换成一个立刻完成的请求，放行 load 事件
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  };
}

export function report() {
  const el = document.getElementById('result');
  const pass = RESULTS.filter((r) => r.ok).length;
  const payload = {
    total: RESULTS.length,
    pass,
    fail: RESULTS.length - pass,
    results: RESULTS
  };
  el.textContent = JSON.stringify(payload, null, 1);
  document.body.dataset.done = '1';
  return payload;
}

/** 轮询等某个条件成立（界面是异步渲染的，断言前必须等） */
export async function waitFor(fn, { timeout = 15000, step = 40, label = '条件' } = {}) {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* 还没好，继续等 */
    }
    if (Date.now() - t0 > timeout) throw new Error(`等不到：${label}（等了 ${timeout}ms）`);
    await new Promise((r) => setTimeout(r, step));
  }
}

export async function wait(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * 把真正的应用装进 iframe 跑（同一个源，共用 IndexedDB）。
 * @param hash 要打开的 hash 路由，例如 '#/practice?lib=xxx'
 * @param sel  等这个选择器出现再返回
 */
export async function openApp({ hash = '', size = [390, 844], sel = null, timeout = 15000 } = {}) {
  document.querySelectorAll('iframe.app-frame').forEach((f) => f.remove());
  const frame = document.createElement('iframe');
  frame.className = 'app-frame';
  frame.style.cssText = `width:${size[0]}px;height:${size[1]}px;border:0;display:block`;
  const loaded = new Promise((r) => frame.addEventListener('load', r, { once: true }));
  frame.src = '../../index.html' + hash;
  document.body.append(frame);
  await loaded;
  if (sel) await waitFor(() => frame.contentDocument.querySelector(sel), { timeout, label: sel });
  return frame;
}

/** 触发一次真正的输入（框架和 React 之外，原生事件就够） */
export function type(input, value) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function click(node) {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** 按回车（练习界面判定靠它） */
export function pressEnter(node) {
  node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}
