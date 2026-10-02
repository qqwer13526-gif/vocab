/* 主题（浅色 / 深色 / 跟随系统）+ 氛围光。
 *
 * 为什么要有它：v32 之前只有 `@media (prefers-color-scheme: dark)` —— 手机切深色它跟着变，
 * 但想在白天强制深色（或反过来）是做不到的。这里补上"手动三态"。
 *
 * 三条实现纪律：
 *   1. **不闪**：`index.html` 里有一段内联脚本，在第一帧之前就把 data-theme 写上去（见 index.html 头部）
 *   2. **两处 token 必须一致**：样式表里深色写了两遍（媒体查询 + `[data-theme='dark']`），
 *      tool/check_contrast.py 会逐项比对，防漂移
 *   3. **状态栏跟着换**：`theme-color` 两条 meta 是给"跟随系统"用的；强制时这里动态改写它们，
 *      否则 iOS 地址栏/状态栏颜色会跟界面对不上
 */

const KEY = 'vocab.theme';
const META = { light: '#ffffff', dark: '#0f1012' };

export const THEMES = ['auto', 'light', 'dark'];
export const THEME_LABEL = { auto: '跟随系统', light: '浅色', dark: '深色' };

export function loadTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** 现在**实际**是深色还是浅色（跟随系统时要问系统） */
export function resolvedTheme(theme = loadTheme()) {
  if (theme === 'dark' || theme === 'light') return theme;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function paintMeta(theme) {
  const dark = resolvedTheme(theme) === 'dark';
  // 强制时把两条 meta 的 media 摘掉、都写成同一个值；跟随系统时恢复成原来的媒体查询版本
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  metas.forEach((m, i) => {
    if (theme === 'auto') {
      m.setAttribute('media', i === 0 ? '(prefers-color-scheme: light)' : '(prefers-color-scheme: dark)');
      m.setAttribute('content', i === 0 ? META.light : META.dark);
    } else {
      m.removeAttribute('media');
      m.setAttribute('content', dark ? META.dark : META.light);
    }
  });
}

/** 应用一个主题：写 data-theme、同步 theme-color、记进 localStorage */
export function applyTheme(theme = loadTheme()) {
  const t = THEMES.includes(theme) ? theme : 'auto';
  const root = document.documentElement;
  if (t === 'auto') delete root.dataset.theme;
  else root.dataset.theme = t;
  paintMeta(t);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* 隐私模式不让写就算了 */
  }
  document.body.dataset.themeResolved = resolvedTheme(t); // 给测试和排查看
  return t;
}

/** 跟随系统时，"系统换了主题"要跟着走（强制时不理会） */
export function watchSystemTheme() {
  if (typeof matchMedia !== 'function') return;
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (loadTheme() === 'auto') applyTheme('auto');
  };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else mq.addListener?.(onChange);
}

/* ---------------------------------------------------------------- 氛围光 */

const AMBIENT_DEFAULT = '#3b5bff';
let ambientNow = null;

function hexToRgb(hex) {
  const h = String(hex || '').trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [59, 91, 255];
}

/**
 * 设置氛围光颜色（词库色）。换库/换页时用 spring 插值过去 —— 和"换封面颜色连续过渡"同一套路。
 * @param color 十六进制；不给就用品牌色
 * @param opts.immediate 首次绘制或 reduced-motion 时直接落位
 */
export function setAmbient(color, { immediate = false } = {}) {
  const layers = ambientLayers();
  if (!layers.length) return;
  const rgb = hexToRgb(color || AMBIENT_DEFAULT);
  const same = ambientNow && ambientNow.join() === rgb.join();
  ambientNow = rgb;
  const css = `rgb(${rgb.map(Math.round).join(' ')})`;

  if (immediate || same) {
    const cur = layers.find((l) => l.classList.contains('is-on')) || layers[0];
    for (const l of layers) l.style.setProperty('--ambient-color', css);
    if (immediate) {
      for (const l of layers) l.style.transition = 'none';
      cur.classList.add('is-on');
      requestAnimationFrame(() => { for (const l of layers) l.style.transition = ''; });
    }
    return;
  }

  // 交叉淡入：给"另一层"染上新颜色、点亮它、把旧层淡出 —— **每帧零 JS**，全交给合成器。
  // （v37 的性能修复点：以前每帧写 CSS 变量 + 全屏 mix-blend-mode，手机上很贵）
  const cur = layers.find((l) => l.classList.contains('is-on')) || layers[0];
  const idx = layers.indexOf(cur);
  const next = layers[(idx + 1) % layers.length] || cur;
  next.style.setProperty('--ambient-color', css);
  next.classList.add('is-on');
  if (next !== cur) cur.classList.remove('is-on');
}

let ambientCache = null;
function ambientLayers() {
  if (!ambientCache || !ambientCache.length || !ambientCache[0].isConnected) {
    ambientCache = [...document.querySelectorAll('.ambient')];
  }
  return ambientCache;
}

export function currentAmbient() {
  return ambientNow;
}
