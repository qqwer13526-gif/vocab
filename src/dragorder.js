/* 长按拖动排序（v56）：首页「我的词库」可以长按拖动重排。
 *
 * 为什么不用 pointer events：长按之后需要**阻止页面滚动**，而 pointermove 不可取消 ✗。
 * 正确做法是"等长按结束、手指还没动过"的时候再挂非 passive 的 touchmove 并 preventDefault ✓
 * （手指没动就还没开始滚 → 这时拦得住 ✓）。
 *
 * 单元本身是"单元"：顶层词库 + 它下面的子词库算**一个单元**一起走（拖父库时子库跟着 ✓）。
 * 子词库只在自己那一组里换位。
 */

import { runSpring } from './spring.js';

export const LONG_PRESS_MS = 400; // 长按多久才开始拖（真机可能要调）
export const MOVE_TOLERANCE = 10; // 长按期间手指抖超过这个距离就取消（交给页面滚动）
const GAP = 12; // 和 .libs 的 gap 一致
const EDGE = 80; // 手指进入上下这么多像素 → 自动滚动
const SCROLL_STEP = 10;

/* ------------------------------------------------------------------ 纯逻辑 */

/**
 * 手指（用被拖卡片的中心 Y）穿过了几张卡的中线 → 就该落在第几位。
 * @param {{top:number,height:number}[]} rects 其它卡片的矩形（视觉顺序，上→下）
 * @param {number} y 被拖卡片的中心 Y
 */
export function computeTargetIndex(rects, y) {
  let idx = 0;
  for (const r of rects) {
    if (y > r.top + r.height / 2) idx++;
  }
  return idx;
}

/**
 * 重排后要写回数据库的 libs 行（同层 order 从 0 连续）。
 * 传进来的 id 有缺漏时，把漏掉的按原顺序补在后面 —— 绝不能让卡从界面上消失 ✗
 */
export function orderRowsFor(libs, parentId, orderedIds, now = Date.now()) {
  const pid = parentId || null;
  const siblings = libs.filter((l) => (l.parentId || null) === pid && !l.deleted);
  const byId = new Map(siblings.map((l) => [l.id, l]));
  const seen = new Set();
  const ordered = [];
  for (const id of orderedIds || []) {
    const row = byId.get(id);
    if (row && !seen.has(id)) {
      ordered.push(row);
      seen.add(id);
    }
  }
  for (const row of siblings) {
    if (!seen.has(row.id)) ordered.push(row);
  }
  return ordered.map((row, i) => ({ ...row, order: i, updatedAt: now }));
}

/* ------------------------------------------------------------------ 手势 */

export function attachDragOrder(list, { itemSelector = '.lib-row', onCommit, onHaptic } = {}) {
  if (!list) return null;
  const haptic = (ms = 8) => {
    try {
      if (navigator.vibrate) navigator.vibrate(ms); // Android 有；iOS 静默不支持（不报错）
    } catch {
      /* 无所谓 */
    }
    onHaptic?.(ms);
  };

  const rows = () => [...list.children].filter((n) => n.matches(itemSelector));
  const parentKey = (r) => r.dataset.parent || '';

  /** 单元：顶层行 + 紧跟它的子行算一个；子行各自一个 */
  function unitsFor(row) {
    const all = rows();
    if (!parentKey(row)) {
      const units = [];
      for (const r of all) {
        if (!parentKey(r)) units.push({ root: r, elements: [r] });
        else if (units.length) units[units.length - 1].elements.push(r);
      }
      return units;
    }
    return all.filter((r) => parentKey(r) === parentKey(row)).map((r) => ({ root: r, elements: [r] }));
  }

  function unitRect(u) {
    // ⚠️ 只量**可见**的元素：折叠时子库行是 hidden 的，getBoundingClientRect() 全是 0
    //    → 单元的 bottom = 0、top = 父库的 top → 高度变成**负数**（真踩过 ✗）
    const els = u.elements.filter((el) => el.getClientRects().length > 0);
    if (!els.length) return { top: 0, height: 0 };
    const first = els[0].getBoundingClientRect();
    const last = els[els.length - 1].getBoundingClientRect();
    return { top: first.top, height: last.bottom - first.top };
  }

  let pressTimer = 0;
  let pressed = null;
  let armed = false;
  let startX = 0;
  let startY = 0;
  let drag = null;
  let scrollRaf = 0;
  let scrollDir = 0;
  let suppressClickUntil = 0;

  function clearTimer() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = 0;
  }

  function onPressStart(e) {
    if (drag || e.touches.length !== 1) return;
    const row = e.target.closest(itemSelector);
    if (!row || !list.contains(row)) return;
    pressed = row;
    armed = true;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    clearTimer();
    pressTimer = setTimeout(() => beginDrag(), LONG_PRESS_MS);
  }

  function onPressMove(e) {
    if (!armed || drag) return;
    const t = e.touches[0];
    if (!t) return;
    if (Math.hypot(t.clientX - startX, t.clientY - startY) > MOVE_TOLERANCE) {
      // 手指先动了 → 用户想滚页面，不是想拖
      armed = false;
      clearTimer();
    }
  }

  function onPressEnd() {
    if (drag) return;
    armed = false;
    clearTimer();
  }

  function beginDrag() {
    if (!armed || !pressed) return;
    armed = false;
    const units = unitsFor(pressed);
    const me = units.find((u) => u.root === pressed);
    if (!me) return;
    const meRect = unitRect(me);
    const others = units.filter((u) => u !== me);
    drag = {
      row: pressed,
      me,
      others,
      rects: others.map(unitRect),
      startCenterY: meRect.top + meRect.height / 2,
      height: meRect.height,
      from: units.indexOf(me),
      target: units.indexOf(me),
      dy: 0,
      shift: 0
    };
    drag.shift = meRect.height + GAP;
    list.classList.add('is-reordering');
    for (const el of me.elements) el.classList.add('is-dragged');
    haptic(12);
    // 手指没动过 → 现在拦滚动才是有效的
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd, { passive: false });
    document.addEventListener('touchcancel', onDragEnd, { passive: false });
  }

  function applyShifts() {
    if (!drag) return;
    const { others, from, target, shift } = drag;
    others.forEach((u, i) => {
      const full = i < from ? i : i + 1;
      let dy = 0;
      if (target > from && full > from && full <= target) dy = -shift; // 往下拖：中间的往上让
      if (target < from && full >= target && full < from) dy = shift; // 往上拖：中间的往下让
      for (const el of u.elements) {
        el.style.transition = 'transform 200ms cubic-bezier(.2,.8,.2,1)';
        el.style.transform = dy ? `translate3d(0, ${dy}px, 0)` : '';
      }
    });
  }

  function onDragMove(e) {
    if (!drag) return;
    e.preventDefault();
    const t = e.touches[0];
    if (!t) return;
    const dy = t.clientY - startY;
    drag.dy = dy;
    for (const el of drag.me.elements) el.style.transform = `translate3d(0, ${dy}px, 0)`;
    const idx = computeTargetIndex(drag.rects, drag.startCenterY + dy);
    if (idx !== drag.target) {
      drag.target = idx;
      haptic(6); // 每跨过一张"卡"一下
      applyShifts();
    }
    autoScroll(t.clientY);
  }

  function autoScroll(clientY) {
    const h = window.innerHeight;
    const dir = clientY < EDGE ? -1 : clientY > h - EDGE ? 1 : 0;
    scrollDir = dir;
    if (!dir || scrollRaf) return;
    const step = () => {
      if (!drag || !scrollDir) {
        scrollRaf = 0;
        return;
      }
      window.scrollBy(0, scrollDir * SCROLL_STEP);
      // 滚过之后"其它卡"的位置跟着变 → 把之前量的矩形整体挪一下（不必重排布局）
      for (const r of drag.rects) r.top -= scrollDir * SCROLL_STEP;
      drag.startCenterY -= scrollDir * SCROLL_STEP;
      scrollRaf = requestAnimationFrame(step);
    };
    scrollRaf = requestAnimationFrame(step);
  }

  function cleanup() {
    list.classList.remove('is-reordering');
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('touchend', onDragEnd);
    document.removeEventListener('touchcancel', onDragEnd);
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    scrollRaf = 0;
    scrollDir = 0;
  }

  function onDragEnd() {
    if (!drag) return;
    const { me, others, from, target, shift, dy } = drag;
    cleanup();

    const settle = () => {
      for (const el of me.elements) {
        el.style.transform = '';
        el.classList.remove('is-dragged');
      }
      for (const u of others) {
        for (const el of u.elements) {
          el.style.transition = '';
          el.style.transform = '';
        }
      }
      suppressClickUntil = performance.now() + 300; // 别让松手那一下顺手进词库 ✗
      const moved = target !== from;
      const ids = others.map((u) => u.root.dataset.lib);
      ids.splice(target, 0, me.root.dataset.lib);
      const pid = parentKey(me.root) || null;
      drag = null;
      if (moved) onCommit?.(ids, pid);
    };

    const finalDy = (target - from) * shift;
    if (Math.abs(finalDy - dy) < 0.5) {
      settle();
      return;
    }
    runSpring({
      from: dy,
      velocity: 0,
      to: finalDy,
      damping: 1,
      response: 0.3,
      onFrame: (y) => {
        for (const el of me.elements) el.style.transform = `translate3d(0, ${y}px, 0)`;
      },
      onDone: settle
    });
  }

  // 松手后的那一下 click 吞掉（否则拖完顺手进词库 ✗）
  const onClickCapture = (e) => {
    if (performance.now() < suppressClickUntil) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  // 调试钩子：真机/测试里能读到当前拖动状态（只读，别在业务里依赖它）
  list.__dragState = () => (drag ? { from: drag.from, target: drag.target, dy: drag.dy, shift: drag.shift, rects: drag.rects.length } : null);

  list.addEventListener('touchstart', onPressStart, { passive: true });
  list.addEventListener('touchmove', onPressMove, { passive: true });
  list.addEventListener('touchend', onPressEnd, { passive: true });
  list.addEventListener('touchcancel', onPressEnd, { passive: true });
  list.addEventListener('click', onClickCapture, true);

  return {
    destroy() {
      cleanup();
      clearTimer();
      list.removeEventListener('touchstart', onPressStart);
      list.removeEventListener('touchmove', onPressMove);
      list.removeEventListener('touchend', onPressEnd);
      list.removeEventListener('touchcancel', onPressEnd);
      list.removeEventListener('click', onClickCapture, true);
    }
  };
}
