/* 内联 SVG 图标（零依赖、零 CDN，颜色跟着 currentColor 走）。
 *
 * 为什么不用文字符号（‹ › ✕ ↶）：这些字形在不同系统的字体里粗细、基线、视觉大小都不一样，
 * 字号一变它们跟着变，跟旁边的文字对不齐；SVG 能锁死 viewBox 与线宽，跨平台长得一样。
 *
 * 只用描边（stroke），不用填充，线宽统一 2（配 24 的 viewBox，视觉上接近 1.7px @20px）。
 * 装饰性图标一律 aria-hidden —— 按钮的可访问名字靠 aria-label 或可见文字，不靠图形。
 */

const NS = 'http://www.w3.org/2000/svg';

/** name → path 的 d（一个或多个子路径） */
const PATHS = {
  close: ['M6 6l12 12', 'M18 6L6 18'],
  chevronRight: ['M9 5l7 7-7 7'],
  chevronLeft: ['M15 5l-7 7 7 7'],
  // 回退：一条往回拐的箭头
  undo: ['M9 14L4 9l5-5', 'M4 9h9a7 7 0 0 1 0 14h-3'],
  check: ['M4 12.5l5 5L20 6.5'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
  upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 20h16'],
  layers: ['M12 3l9 5-9 5-9-5 9-5', 'M3 13l9 5 9-5'],
  settings: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M4 12h2M18 12h2M12 4v2M12 18v2'],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  play: ['M7 4.5l12 7.5-12 7.5z'],   // 实心三角：从这里开始练
  list: ['M4 6h16', 'M4 12h16', 'M4 18h10'],
  plus: ['M12 5v14', 'M5 12h14'],
  pencil: ['M4 20h4L18 10l-4-4L4 16v4z', 'M13 7l4 4'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3']
};

/**
 * 造一个图标元素。
 * @param {string} name PATHS 里的名字
 * @param {{size?: number, className?: string}} [opts]
 * @returns {SVGElement}
 */
export function icon(name, { size = 20, className = '' } = {}) {
  const d = PATHS[name];
  if (!d) throw new Error(`没有这个图标：${name}`);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (className) svg.setAttribute('class', className);
  for (const one of d) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', one);
    svg.append(path);
  }
  return svg;
}
