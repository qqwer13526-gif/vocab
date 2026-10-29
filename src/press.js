/* 全局按压反馈：按下压到 0.96，松手从当前画面平稳复位。
 *
 * 为什么用**事件委托 + WAAPI**而不是给每个按钮写样式/监听：
 *   - 委托：一处代码，全 app 所有按钮（含以后新加的）立刻都有，不用逐个改
 *   - WAAPI：动画跑在合成器上，不动布局、不写 style 属性，不会和 CSS 的 :active / transform 打架
 *     （动画结束后元素自动回到它原本的 CSS 状态）
 *
 * 纪律：
 *   - `prefers-reduced-motion: reduce` 时**完全不动**（连 scale 都不做）
 *   - 只认真正的"按下"（主指针 + 左键），滑块/拖拽区不参与（它们不是 button）
 *   - 普通点按不超调；重入时读取当前呈现值，避免突然跳回固定起点
 */

function reduced() {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function animatePress(btn, to, duration, release = false) {
  if (!btn.animate) return;
  const current = getComputedStyle(btn).transform;
  btn.__pressAnim?.cancel();
  const anim = btn.animate([
    { transform: current === 'none' ? 'scale(1)' : current },
    { transform: `scale(${to})` }
  ], {
    duration,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    fill: 'forwards'
  });
  btn.__pressAnim = anim;
  if (release) anim.addEventListener?.('finish', () => {
    anim.cancel();
    if (btn.__pressAnim === anim) btn.__pressAnim = null;
  });
}

function pressIn(btn) { animatePress(btn, 0.96, 90); }
function pressOut(btn) { animatePress(btn, 1, 180, true); }

const hit = (e) => e.target?.closest?.('button:not([disabled])');

export function wirePressFeedback(root = document) {
  let active = null;
  const release = () => {
    if (!active) return;
    const { btn } = active;
    active = null;
    if (reduced() || !btn.isConnected) {
      btn.__pressAnim?.cancel();
      btn.__pressAnim = null;
    } else pressOut(btn);
  };
  root.addEventListener(
    'pointerdown',
    (e) => {
      if (reduced() || e.isPrimary === false || (e.button != null && e.button !== 0)) return;
      const btn = hit(e);
      if (btn) {
        release();
        active = { btn, pointerId: e.pointerId };
        pressIn(btn);
      }
    },
    true
  );
  const out = (e) => {
    if (active?.pointerId === e.pointerId) release();
  };
  root.addEventListener('pointerup', out, true);
  root.addEventListener('pointercancel', out, true);
  root.addEventListener('pointerleave', (e) => {
    if (e.target === active?.btn) out(e);
  }, true);
  root.defaultView?.addEventListener('blur', release);
  root.addEventListener('visibilitychange', () => { if (root.hidden) release(); });
}

export const _internal = { pressIn, pressOut };
