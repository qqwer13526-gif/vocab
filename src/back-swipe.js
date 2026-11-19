import { project, runSpring, velocityFrom } from './spring.js';

const EDGE_INSET = 24;
const INTENT_DISTANCE = 10;

/** 词库详情内的空白区域可以发起返回，文字和控件保留各自的手势。 */
export function wireBackSwipe(app, { canStart, homeScroll, onReturn }) {
  const home = app.querySelector('#view-home');
  const word = app.querySelector('#view-word');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let drag;
  let spring;
  let frame = 0;
  let x = 0;
  let painted = 0;
  let width = 0;
  let returning = false;

  function paint(offset) {
    painted = Math.max(0, Math.min(width, offset));
    word.style.transform = `translate3d(${painted}px, 0, 0)`;
  }

  function reset() {
    drag = null;
    spring?.stop();
    spring = null;
    cancelAnimationFrame(frame);
    frame = 0;
    x = painted = 0;
    returning = false;
    if (app.classList.contains('is-back-swiping')) {
      app.classList.remove('is-back-swiping');
      app.style.removeProperty('--back-home-offset');
      word.style.removeProperty('transform');
      home.hidden = true;
      home.inert = false;
    }
  }

  function beginPreview() {
    if (reducedMotion.matches || app.classList.contains('is-back-swiping')) return;
    app.style.setProperty('--back-home-offset', `${window.scrollY - homeScroll()}px`);
    home.inert = true;
    home.hidden = false;
    app.classList.add('is-back-swiping');
  }

  app.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || returning) return;
    if (!e.isPrimary) {
      if (drag) end(e, true);
      return;
    }
    if (!canStart() || !home.hasChildNodes() || getSelection()?.isCollapsed === false) return;
    if (e.target !== word && !e.target.matches('#view-word > .word-head[data-back-swipe]')) return;
    width = document.documentElement.clientWidth;
    if (e.clientX < EDGE_INSET || e.clientX > width - EDGE_INSET) return;

    const grabbed = !!spring;
    spring?.stop();
    spring = null;
    drag = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      base: painted,
      active: grabbed,
      samples: [{ x: e.clientX, t: e.timeStamp }]
    };
    x = painted;
  });

  app.addEventListener('pointermove', (e) => {
    if (e.pointerId !== drag?.id) return;
    const dx = e.clientX - drag.startX;
    const dy = Math.abs(e.clientY - drag.startY);
    if (!drag.active) {
      if (Math.max(Math.abs(dx), dy) < INTENT_DISTANCE) return;
      if (dx < INTENT_DISTANCE || dx < dy * 1.25) {
        drag = null;
        return;
      }
      drag.active = true;
      beginPreview();
      // 触摸通常已有隐式捕获，维持它以便移出标题栏后还收到结束事件。
      if (e.isTrusted && !e.target.hasPointerCapture(e.pointerId)) {
        word.setPointerCapture(e.pointerId);
      }
    }
    x = Math.max(0, Math.min(width, drag.base + dx));
    drag.samples.push({ x: e.clientX, t: e.timeStamp });
    if (drag.samples.length > 8) drag.samples.shift();
    if (!reducedMotion.matches && !frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        paint(x);
      });
    }
  });

  function end(e, cancelled = false) {
    if (!drag || (!cancelled && e.pointerId !== drag.id)) return;
    const { active, samples } = drag;
    drag = null;
    if (!active) return;
    cancelAnimationFrame(frame);
    frame = 0;

    const recent = samples.filter(({ t }) => e.timeStamp - t <= 80);
    const velocity = cancelled ? 0 : Math.max(-1200, Math.min(1200, velocityFrom(recent, e.timeStamp)));
    const commit = !cancelled && x >= INTENT_DISTANCE && x + project(velocity, 0.994) >= width * 0.35;
    const finish = () => {
      spring = null;
      if (commit) {
        returning = true;
        onReturn();
      } else reset();
    };
    if (reducedMotion.matches || !app.classList.contains('is-back-swiping')) {
      finish();
      return;
    }
    paint(x);
    spring = runSpring({ from: x, velocity, to: commit ? width : 0, response: 0.24, onFrame: paint, onDone: finish });
  }

  app.addEventListener('pointerup', (e) => end(e));
  app.addEventListener('pointercancel', (e) => { if (e.pointerId === drag?.id) end(e, true); });
  addEventListener('resize', () => { if (!returning) reset(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && !returning) reset(); });
  reducedMotion.addEventListener('change', () => { if (!returning) reset(); });
  return { returning: () => returning, previewing: () => app.classList.contains('is-back-swiping'), reset };
}
