/* 全局按压反馈（v32）：按下压到 0.96、松手轻微超调回弹。
 *
 * 为什么用**事件委托 + WAAPI**而不是给每个按钮写样式/监听：
 *   - 委托：一处代码，全 app 所有按钮（含以后新加的）立刻都有，不用逐个改
 *   - WAAPI：动画跑在合成器上，不动布局、不写 style 属性，不会和 CSS 的 :active / transform 打架
 *     （动画结束后元素自动回到它原本的 CSS 状态）
 *
 * 纪律：
 *   - `prefers-reduced-motion: reduce` 时**完全不动**（连 scale 都不做）
 *   - 只认真正的"按下"（主指针 + 左键），滑块/拖拽区不参与（它们不是 button）
 *   - 超调只给"松手"那一小段（阻尼小才有 ζ<1 的过冲）
 */

const pressInFrames = [{ transform: 'scale(1)' }, { transform: 'scale(0.96)' }];

function reduced() {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function pressIn(btn) {
  if (!btn.animate) return;
  btn.__pressAnim?.cancel();
  btn.__pressAnim = btn.animate(pressInFrames, {
    duration: 110,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    fill: 'forwards'
  });
}

function pressOut(btn) {
  if (!btn.animate) return;
  btn.__pressAnim?.cancel();
  // 阻尼小一点 → 冲过 1 一点点再回来（Spring Overshoot）
  btn.__pressAnim = btn.animate(
    [
      { transform: 'scale(0.96)' },
      { transform: 'scale(1.022)', offset: 0.35 },
      { transform: 'scale(0.997)', offset: 0.7 },
      { transform: 'scale(1)' }
    ],
    { duration: 300, easing: 'cubic-bezier(0.34, 1.25, 0.64, 1)', fill: 'forwards' }
  );
  btn.__pressAnim.addEventListener?.('finish', () => {
    btn.__pressAnim?.cancel(); // 交还给 CSS，别一直挂着 fill:forwards
    btn.__pressAnim = null;
  });
}

const hit = (e) => e.target?.closest?.('button:not([disabled])');

export function wirePressFeedback(root = document) {
  root.addEventListener(
    'pointerdown',
    (e) => {
      if (reduced() || (e.button != null && e.button !== 0)) return;
      const btn = hit(e);
      if (btn) pressIn(btn);
    },
    true
  );
  const out = (e) => {
    const btn = hit(e);
    if (btn && btn.__pressAnim) pressOut(btn);
  };
  root.addEventListener('pointerup', out, true);
  root.addEventListener('pointercancel', out, true);
  root.addEventListener('pointerleave', out, true);
}

export const _internal = { pressIn, pressOut };
