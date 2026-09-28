/* 危险操作的二次确认。
 *
 * 不用 `window.confirm()`：丑、手机上更丑、没法做样式，而且会阻塞。
 * 做法是"原地武装"：第一次点把按钮变成「确认删除」，再点一次才真的执行；
 *   4 秒没动作、点了别处、按了 Esc —— 都会自己变回去。
 */

export const CONFIRM_TIMEOUT = 4000;

/**
 * 给一个按钮装上"二次确认"。
 * @param button  目标按钮
 * @param action  确认后真正要做的事
 * @param label   武装状态下的文字（默认「确认删除」）
 * @param timeout 多久没动作就自动解除（毫秒）
 * @returns 手动解除的函数
 */
export function confirmThen(button, action, { label = '确认删除', timeout = CONFIRM_TIMEOUT, kind = 'danger' } = {}) {
  if (!button) return () => {};
  const text0 = button.textContent;
  let timer = null;
  let armed = false;

  const disarm = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    armed = false;
    button.textContent = text0;
    button.classList.remove('confirming', `confirming-${kind}`);
    button.removeAttribute('data-armed');
    button.setAttribute('aria-label', text0);
    document.removeEventListener('click', onOutside, true);
    document.removeEventListener('keydown', onKey);
  };

  function onOutside(e) {
    if (e.target !== button) disarm();
  }
  function onKey(e) {
    if (e.key === 'Escape') disarm();
  }

  const arm = () => {
    armed = true;
    button.textContent = label;
    button.classList.add('confirming', `confirming-${kind}`);
    button.setAttribute('data-armed', '1');
    button.setAttribute('aria-label', label);
    timer = setTimeout(disarm, timeout);
    // 点别处就撤（捕获阶段，避免被其它处理器挡住）
    setTimeout(() => {
      document.addEventListener('click', onOutside, true);
      document.addEventListener('keydown', onKey);
    }, 0);
  };

  button.addEventListener('click', async (e) => {
    if (!armed) {
      e.preventDefault();
      arm();
      return;
    }
    disarm();
    await action?.(e);
  });

  return disarm;
}
