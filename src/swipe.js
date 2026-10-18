/* 左滑露出操作（v54）：给列表行用的手势控制器。
 *
 * 真机上最怕的两件事，这里都堵住了：
 *   ① 抢纵向滚动 —— 行上 `touch-action: pan-y`（浏览器保住纵向），且起手 10px 内先判方向：
 *      纵向优先就彻底放手，绝不接管（否则滚页面会误删 ✗）
 *   ② 和 iOS 的返回手势打架 —— 起点距屏幕左边缘 24px 以内直接不接管
 *
 * 松手去哪用**速度投影**算（小输入大输出），而不只看拖到哪 —— 快速一甩就能开到底。
 * 收尾用项目自己的 spring.js（可被打断、有惯性感）。
 */

import { runSpring } from './spring.js';

const THRESHOLD = 10; // 起手迟滞（px）
const EDGE_GUARD = 24; // 距左边缘这么近就不接管（让给 iOS 返回手势）
const ACTION_W = 84; // 露出的按钮宽度（和 CSS 里 .word-del 的 width 一致）

/** 同一时刻只允许一行是打开的 */
let openItem = null;

export function closeOpenSwipe() {
  if (openItem && openItem.__close) openItem.__close();
}

export function attachSwipe(item, { width = ACTION_W, onOpen, onClose } = {}) {
  const content = item.querySelector('[data-testid="word-row"]') || item.firstElementChild;
  if (!content) return null;

  let startX = 0;
  let startY = 0;
  let dx = 0;
  let axis = null; // null | 'x' | 'y'
  let active = false;
  let history = []; // [t, clientX]
  let totalMx = 0;  // 这次手势的净水平位移（判"向右收"用）
  let suppressUntil = 0; // 刚滑完的一小会儿，吞掉这一下 click（不然会顺带进练习页 ✗）

  const setX = (x) => {
    content.style.transform = x ? `translate3d(${x.toFixed(1)}px, 0, 0)` : '';
  };
  const mark = (open) => {
    item.dataset.swiped = open ? '1' : '0';
  };

  function settle(open, velocity = 0) {
    const from = dx;
    const to = open ? -width : 0;
    mark(open);
    if (open) {
      if (openItem && openItem !== item) openItem.__close?.();
      openItem = item;
    } else if (openItem === item) {
      openItem = null;
    }
    // damping 0.8 / response 0.3 —— 有动量的交互才配过冲（Apple 抽屉那档参数）
    runSpring({
      from,
      velocity,
      to,
      damping: 0.8,
      response: 0.3,
      onFrame: (x) => setX(x),
      onDone: () => setX(to)
    });
    dx = to;
    (open ? onOpen : onClose)?.();
  }

  item.__close = () => {
    axis = null;
    if ((item.dataset.swiped || '0') === '1') settle(false, 0);
  };

  function reset() {
    axis = null;
    active = false;
    history = [];
  }

  content.addEventListener(
    'pointerdown',
    (e) => {
      if (!e.isPrimary) return;
      const rect = item.getBoundingClientRect();
      if (e.clientX - rect.left < EDGE_GUARD) return; // 边缘让给系统
      startX = e.clientX;
      startY = e.clientY;
      dx = (item.dataset.swiped || '0') === '1' ? -width : 0;
      axis = null;
      active = true;
      totalMx = 0;
      history = [[performance.now(), e.clientX]];
    },
    { passive: true }
  );

  content.addEventListener(
    'pointermove',
    (e) => {
      if (!active || !e.isPrimary || axis === 'y') return;
      const mx = e.clientX - startX;
      const my = e.clientY - startY;

      if (!axis) {
        // 先判方向：纵向优先 → 立刻放手，让页面照常滚
        if (Math.abs(my) > THRESHOLD && Math.abs(my) >= Math.abs(mx)) {
          axis = 'y';
          return;
        }
        if (Math.abs(mx) > THRESHOLD) {
          axis = 'x';
          item.classList.add('is-swiping');
          try {
            content.setPointerCapture(e.pointerId);
          } catch {
            /* 合成事件没有真实指针，忽略 */
          }
        }
      }
      if (axis !== 'x') return;

      totalMx = mx;
      history.push([performance.now(), e.clientX]);
      if (history.length > 8) history.shift();

      const base = (item.dataset.swiped || '0') === '1' ? -width : 0;
      let next = base + mx;
      if (next < -width) next = -width - Math.pow(-(next + width), 0.6) * 1.6; // 越界阻尼
      if (next > 0) next = Math.pow(next, 0.6) * 1.6;
      dx = next;
      suppressUntil = performance.now() + 700;
      setX(next);
    },
    { passive: true }
  );

  const finish = () => {
    if (!active) return;
    if (axis === 'x') {
      let vpx = 0;
      if (history.length >= 2) {
        const [t0, x0] = history[0];
        const [t1, x1] = history[history.length - 1];
        const dt = Math.max(1, t1 - t0);
        vpx = ((x1 - x0) / dt) * 1000;
      }
      const projected = dx + Math.sign(vpx) * Math.min(Math.abs(vpx) * 0.22, 140);
      // 向右拖过 20px ＝ 明确要收（不然越界阻尼会把位移压得很小，判不回来 ✗）
      const open = !(totalMx > 20) && (projected < -width / 2 || vpx < -420);
      item.classList.remove('is-swiping');
      settle(open, vpx);
      suppressUntil = performance.now() + 400;
    }
    reset();
  };

  content.addEventListener('pointerup', finish, { passive: true });
  content.addEventListener('pointercancel', finish, { passive: true });

  // 刚滑完的这一下 click 要吞掉 —— 但**只吞行内容上的**，
  // 否则"滑开 → 立刻点删除"会没反应（真踩过 ✗）
  item.addEventListener(
    'click',
    (e) => {
      if (performance.now() < suppressUntil && content.contains(e.target)) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true
  );

  return { close: () => item.__close() };
}
