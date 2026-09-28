/* 视口与键盘（iOS 上的那些坑，见 mobile-native skill）。
 *
 * 1) **键盘遮挡**：键盘弹出时 `position: fixed` 和 100vh 都不会跟着缩，输入框会被盖住。
 *    解决办法是把"键盘占了多高"算出来写成 CSS 变量 `--kb-inset`，让页面自己留出这段空间。
 * 2) **聚焦后滚进可视区**：iOS 键盘入场有动画，必须等它结束再滚，否则滚了个空。
 *
 * `keyboardInset` 是纯函数，可以在 Node 里直接测；其余部分在浏览器测试页里验。
 */

/** 键盘高度 = 布局视口高 − 可视视口高 − 可视视口偏移（负数和抖动都归零） */
export function keyboardInset({ innerHeight = 0, vvHeight = 0, vvOffsetTop = 0 } = {}) {
  const inset = innerHeight - vvHeight - vvOffsetTop;
  return inset > 0 ? Math.round(inset) : 0;
}

/** 小于这个高度多半只是地址栏伸缩，不算键盘 */
export const KEYBOARD_MIN = 80;

/**
 * 把可视视口的变化同步到 CSS 变量上。
 * @returns 手动重算的函数（测试用）
 */
export function setupViewport({ onKeyboardChange } = {}) {
  const root = document.documentElement;
  const vv = window.visualViewport;
  if (!vv) {
    root.style.setProperty('--kb-inset', '0px');
    document.body.dataset.keyboard = 'closed';
    return () => {};
  }

  const apply = () => {
    const inset = keyboardInset({
      innerHeight: window.innerHeight,
      vvHeight: vv.height,
      vvOffsetTop: vv.offsetTop
    });
    const open = inset >= KEYBOARD_MIN;
    root.style.setProperty('--kb-inset', `${inset}px`);
    document.body.dataset.keyboard = open ? 'open' : 'closed';
    onKeyboardChange?.(open, inset);
  };

  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  addEventListener('orientationchange', () => setTimeout(apply, 60));
  apply();
  return apply;
}

/** 输入框聚焦后，等键盘动画结束再把它滚到可视区中间（减弱动效时不要平滑滚动） */
export function keepFocusVisible(input, { delay = 260 } = {}) {
  if (!input) return;
  input.addEventListener('focus', () => {
    setTimeout(() => {
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      try {
        input.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      } catch {
        input.scrollIntoView();
      }
    }, delay);
  });
}
