/* 主题与氛围光的纯逻辑测试（src/theme.js）。
 *
 * 为什么值得单独测：这里有一处**曾把整页打成空白**的 bug —— 氛围光颜色插值把 rAF 的 id（数字）
 * 当函数调用，只要上一段过渡没跑完就再切一次页（连点两个词库、快速切页）就抛异常，
 * app.js 的渲染被中断、页面什么都不画。这个用例就是钉住它。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// ---- 假环境 ----
let rafId = 0;
const rafQueue = new Map();
globalThis.requestAnimationFrame = (cb) => { const id = ++rafId; rafQueue.set(id, cb); return id; };
globalThis.cancelAnimationFrame = (id) => rafQueue.delete(id);
globalThis.performance = { now: () => 0 };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};

function fakeMeta(media, content) {
  return { media, content, getAttribute: (n) => (n === 'media' ? media : content), setAttribute: (n, v) => { if (n === 'media') media = v; else content = v; }, removeAttribute: (n) => { if (n === 'media') media = null; }, hasAttribute: (n) => n === 'media' && media !== null };
}

const ambientEl = { style: { props: {}, setProperty(k, v) { this.props[k] = v; } } };
const metas = [fakeMeta('(prefers-color-scheme: light)', '#ffffff'), fakeMeta('(prefers-color-scheme: dark)', '#0f1012')];
const root = { dataset: {}, style: {} };
globalThis.document = {
  documentElement: root,
  body: { dataset: {} },
  querySelector: (sel) => (sel === '.ambient' ? ambientEl : null),
  querySelectorAll: (sel) => (sel.includes('theme-color') ? metas : [])
};

const theme = await import('../src/theme.js');

test('主题：默认跟随系统（不写 data-theme）', () => {
  theme.applyTheme('auto');
  assert.equal('theme' in root.dataset, false);
  assert.equal(localStorage.getItem('vocab.theme'), 'auto');
  assert.equal(metas[0].getAttribute('media'), '(prefers-color-scheme: light)', '两条 media 版主题色要还原');
  assert.equal(metas[1].getAttribute('content'), '#0f1012');
});

test('主题：强制深色写 data-theme + 改写 theme-color + 记本机', () => {
  theme.applyTheme('dark');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(localStorage.getItem('vocab.theme'), 'dark');
  assert.equal(metas[0].getAttribute('media'), null, '强制时不再靠媒体查询');
  assert.equal(metas[1].getAttribute('content'), '#0f1012');
  assert.equal(document.body.dataset.themeResolved, 'dark');
});

test('主题：坏数据（localStorage 里是乱七八糟的值）退回跟随系统', () => {
  localStorage.setItem('vocab.theme', 'neon');
  assert.equal(theme.loadTheme(), 'auto');
  theme.applyTheme('neon');
  assert.equal(root.dataset.theme, undefined);
});

test('氛围光：连续两次换色不能抛（曾经把整页打成空白）', () => {
  theme.setAmbient('#3b5bff');
  assert.doesNotThrow(() => theme.setAmbient('#ff9f0a'), '上一段插值还没跑完就换色，必须安全');
  assert.doesNotThrow(() => theme.setAmbient('#34c759'));
  // 而且旧的那一帧应该被取消（只留最新的一段）
  assert.ok(rafQueue.size <= 1, `不该堆着多段插值，实际 ${rafQueue.size}`);
});

test('氛围光：颜色插值真的在写 --ambient-color，并且最终落到目标色', () => {
  theme.setAmbient('#000000', { immediate: true });
  theme.setAmbient('#ffffff');
  const ids = [...rafQueue.keys()];
  assert.ok(ids.length >= 1, '应该排了一帧');
  // 手动推进到结束（dur=420，performance.now 固定为 0 → 传 1000 表示已到点）
  for (const id of ids) { const cb = rafQueue.get(id); rafQueue.delete(id); cb(1000); }
  assert.equal(ambientEl.style.props['--ambient-color'], 'rgb(255 255 255)');
});

test('氛围光：ima 直接落位（首帧/reduced-motion 用）', () => {
  theme.setAmbient('#ff9f0a', { immediate: true });
  assert.equal(ambientEl.style.props['--ambient-color'], 'rgb(255 159 10)');
  assert.deepEqual(theme.currentAmbient(), [255, 159, 10]);
});
