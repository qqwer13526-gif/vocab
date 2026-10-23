/* 长按拖动排序（v57 起）：首页「我的词库」长按拖动重排。
 *
 * v57 修的三件事（都是真机反馈出来的）：
 *   ① **拖动容易变成滑动** —— 取消阈值 10px 太小（拇指长按几乎必超 ✗）；
 *      而且页面一旦开始滚，长按到点会变成"半拖半滚"。现在：阈值 16px ✓、
 *      手指停住 150ms 后**重新计时**（慢慢挪不会永远失败 ✓）、长按到点时若页面已滚动就**不启动** ✓
 *   ② **拖到边缘不自动滚 / 卡片不跟手** —— 原来只在 touchmove 里滚（手指停住就不滚 ✗），
 *      而且卡片位移没有补偿滚动量。现在：拖动期间常驻 rAF 循环 ✓ + 位移补偿 `+scrolledBy` ✓
 *   ③ **落位后闪烁** —— 原来是"清 transform → 整页重渲染"，中间那 1~2 帧是旧顺序复位 + 新顺序没到 ✗。
 *      现在：**原地挪 DOM 节点**（节点身份不变、行高不变、滚动位置不动 ✓），只把顺序写库 ✓
 *
 * 手势仍用 touch 而不是 pointer：长按后要阻止滚动，而 pointermove 不可取消 ✗；
 * 手指没动过就还没开始滚，这时挂非 passive 的 touchmove + preventDefault 才拦得住 ✓
 */

import { runSpring } from './spring.js';

export const LONG_PRESS_MS = 400; // 长按多久才开始拖
export const MOVE_TOLERANCE = 16; // 长按期间允许的手抖（v57：10 → 16，10px 太容易取消 ✗）
const RESUME_MS = 150; // 手指停住多久后重新开始计时
const SCROLLED_LIMIT = 8; // 长按完成时页面已经滚过这么多 → 判定用户在滚动，不启动拖动
const GAP = 12; // 和 .libs 的 gap 一致
const EDGE = 100; // 手指进入上下这么多像素 → 自动滚动（v57：80 → 100）
const SCROLL_MAX = 16; // 自动滚每帧最大像素

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
  let resumeTimer = 0;
  let pressed = null;
  let armed = false;
  let startX = 0;
  let startY = 0;
  let startScrollY = 0;
  let lastTouch = null;
  let drag = null;
  let loopRaf = 0;
  let suppressClickUntil = 0;

  const clearTimers = () => {
    if (pressTimer) clearTimeout(pressTimer);
    if (resumeTimer) clearTimeout(resumeTimer);
    pressTimer = 0;
    resumeTimer = 0;
  };

  function onPressStart(e) {
    if (drag || e.touches.length !== 1) return;
    const row = e.target.closest(itemSelector);
    if (!row || !list.contains(row)) return;
    pressed = row;
    armed = true;
    lastTouch = e.touches[0];
    startX = lastTouch.clientX;
    startY = lastTouch.clientY;
    startScrollY = window.scrollY;
    clearTimers();
    pressTimer = setTimeout(beginDrag, LONG_PRESS_MS);
  }

  function onPressMove(e) {
    if (!armed || drag) return;
    const t = e.touches[0];
    if (!t) return;
    lastTouch = t;
    if (Math.hypot(t.clientX - startX, t.clientY - startY) <= MOVE_TOLERANCE) return;
    // 手指动了：先撤掉长按，但**等它停住**再重新计时 —— 慢慢挪不该永远失败 ✓
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = 0;
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      if (!armed || drag || !lastTouch) return;
      startX = lastTouch.clientX;
      startY = lastTouch.clientY;
      startScrollY = window.scrollY;
      pressTimer = setTimeout(beginDrag, LONG_PRESS_MS);
    }, RESUME_MS);
  }

  function onPressEnd() {
    if (drag) return;
    armed = false;
    clearTimers();
  }

  function beginDrag() {
    if (!armed || !pressed) return;
    armed = false;
    clearTimers();
    // 页面已经滚过了 → 用户是在滚页面，不是要拖（否则会"半拖半滚" ✗）
    if (Math.abs(window.scrollY - startScrollY) > SCROLLED_LIMIT) return;
    const units = unitsFor(pressed);
    const me = units.find((u) => u.root === pressed);
    if (!me) return;
    const meRect = unitRect(me);
    const others = units.filter((u) => u !== me);
    drag = {
      row: pressed,
      me,
      others,
      units,
      rects: others.map(unitRect),
      startCenterY: meRect.top + meRect.height / 2,
      height: meRect.height,
      from: units.indexOf(me),
      target: units.indexOf(me),
      dyScreen: 0,
      scrolledBy: 0,
      shift: meRect.height + GAP
    };
    list.classList.add('is-reordering');
    for (const el of me.elements) el.classList.add('is-dragged');
    haptic(12);
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd, { passive: false });
    document.addEventListener('touchcancel', onDragEnd, { passive: false });
    loopRaf = requestAnimationFrame(loop);
  }

  /** 拖动期间常驻的循环：自动滚（只靠 touchmove 会"手指停住就不滚" ✗） */
  function loop() {
    if (!drag) return;
    autoScrollStep();
    loopRaf = requestAnimationFrame(loop);
  }

  function autoScrollStep() {
    if (!drag || !lastTouch) return;
    const vh = window.innerHeight;
    const y = lastTouch.clientY;
    let dir = 0;
    let depth = 0;
    if (y < EDGE) {
      dir = -1;
      depth = (EDGE - y) / EDGE;
    } else if (y > vh - EDGE) {
      dir = 1;
      depth = (y - (vh - EDGE)) / EDGE;
    }
    if (!dir) return;
    const step = Math.min(SCROLL_MAX, 2 + SCROLL_MAX * Math.min(1, depth * 1.6));
    const before = window.scrollY;
    window.scrollBy(0, dir * step);
    const moved = window.scrollY - before;
    if (!moved) return; // 已经到顶/到底
    drag.scrolledBy += moved;
    // 别的卡跟着滚动（它们的 top 变了）→ 只挪量好的矩形，不重新量布局
    for (const r of drag.rects) r.top -= moved;
    applyTransform();
    applyTarget();
  }

  function applyTransform() {
    if (!drag) return;
    // 卡片要**永远贴着手指**：页面往上滚了多少，transform 就要加回多少 ✓
    const y = drag.dyScreen + drag.scrolledBy;
    for (const el of drag.me.elements) el.style.transform = `translate3d(0, ${y}px, 0)`;
  }

  function applyTarget() {
    if (!drag) return;
    const idx = computeTargetIndex(drag.rects, drag.startCenterY + drag.dyScreen);
    if (idx === drag.target) return;
    drag.target = idx;
    haptic(6);
    applyShifts();
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
    lastTouch = t;
    drag.dyScreen = t.clientY - startY;
    applyTransform();
    applyTarget();
  }

  function cleanup() {
    list.classList.remove('is-reordering');
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('touchend', onDragEnd);
    document.removeEventListener('touchcancel', onDragEnd);
    if (loopRaf) cancelAnimationFrame(loopRaf);
    loopRaf = 0;
  }

  /** 原地把节点挪到新顺序（不重建 DOM → 不闪、不跳 ✓） */
  function applyDomOrder(ids) {
    if (!drag) return;
    const anchor = list.querySelector('.newlib-row'); // 「＋ 新建词库」永远留在最后 ✓
    const byId = new Map();
    for (const u of drag.units) byId.set(u.root.dataset.lib, u);
    for (const id of ids) {
      const u = byId.get(id);
      if (!u) continue;
      for (const el of u.elements) list.insertBefore(el, anchor);
    }
  }

  function onDragEnd() {
    if (!drag) return;
    const { me, others, from, target, dyScreen, shift, scrolledBy } = drag;
    cleanup();

    const settle = () => {
      const moved = target !== from;
      const ids = others.map((u) => u.root.dataset.lib);
      ids.splice(target, 0, me.root.dataset.lib);
      const pid = parentKey(me.root) || null;
      if (moved) applyDomOrder(ids); // 先按新顺序挪节点（同一帧里紧接着清 transform，看不出中间态 ✓）
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
      drag = null;
      if (moved) onCommit?.(ids, pid);
    };

    const finalDy = (target - from) * shift;
    if (Math.abs(finalDy - dyScreen) < 0.5) {
      settle();
      return;
    }
    runSpring({
      from: dyScreen,
      velocity: 0,
      to: finalDy,
      damping: 1,
      response: 0.3,
      onFrame: (y) => {
        for (const el of me.elements) el.style.transform = `translate3d(0, ${y + scrolledBy}px, 0)`;
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

  list.addEventListener('touchstart', onPressStart, { passive: true });
  list.addEventListener('touchmove', onPressMove, { passive: true });
  list.addEventListener('touchend', onPressEnd, { passive: true });
  list.addEventListener('touchcancel', onPressEnd, { passive: true });
  list.addEventListener('click', onClickCapture, true);

  return {
    destroy() {
      cleanup();
      clearTimers();
      list.removeEventListener('touchstart', onPressStart);
      list.removeEventListener('touchmove', onPressMove);
      list.removeEventListener('touchend', onPressEnd);
      list.removeEventListener('touchcancel', onPressEnd);
      list.removeEventListener('click', onClickCapture, true);
    }
  };
}
