/* 轻量提示条（toast）。
 *
 * **什么时候用**：操作后界面立刻变了、就地提示根本看不见的结果 ——
 *   删除词条（马上跳回列表）、覆盖恢复（界面会重渲染）。
 * **什么时候不用**：表单里的就地提示（错误必须贴着字段，这是无障碍要求）。
 *   所以这个模块故意做得小：只补那两三个"反馈会丢"的地方，不搞成统一通知中心。
 *
 * 动效按 review-animations 的标准：只动 transform/opacity、< 300ms、
 * 用 transition（可打断）而不是 keyframes、减弱动效下位移归零只剩淡入。
 */

const MAX_VISIBLE = 3;
let stack = null;

function ensureStack() {
  if (stack && stack.isConnected) return stack;
  stack = document.createElement('div');
  stack.className = 'toast-stack';
  stack.dataset.testid = 'toast-stack';
  stack.setAttribute('role', 'status');
  stack.setAttribute('aria-live', 'polite');
  document.body.append(stack);
  return stack;
}

/**
 * 弹一条提示。
 * @param text    文案（一句话，别写太长）
 * @param kind    'info' | 'ok' | 'bad'
 * @param timeout 多久自动消失；点一下可以提前关掉
 * @param action  可选的一个动作按钮（例如「撤销」）：{ label, onClick, timeout }
 * @returns 立刻关掉它的函数
 */
export function showToast(text, { kind = 'info', timeout = 2600, action = null } = {}) {
  const host = ensureStack();
  const node = document.createElement('div');
  node.className = 'toast';
  node.dataset.kind = kind;
  node.dataset.testid = 'toast';
  node.textContent = text;
  host.append(node);

  while (host.children.length > MAX_VISIBLE) host.firstElementChild.remove();

  let done = false;
  const hide = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    node.classList.add('toast-out');
    setTimeout(() => node.remove(), 240);
  };

  // 有动作时给足时间：撤销窗口太短等于没有（默认 6 秒）
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // 别让外面那层"点一下关掉"抢走这次点击
      hide();
      action.onClick();
    });
    node.append(btn);
    timeout = action.timeout ?? 6000;
  }

  const timer = setTimeout(hide, timeout);
  node.addEventListener('click', hide); // 点一下就能关掉
  return hide;
}
