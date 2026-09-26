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
