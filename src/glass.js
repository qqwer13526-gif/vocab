/* 底部胶囊的「液态玻璃」活行为（v33）。
 *
 * 胶囊的**材质**在 v21 就按参考视频逐帧量好了（card 72% 透明 + blur(20px) saturate(180%) + 上沿亮边）；
 * 这里补的是那支视频里另外两条**活的行为**：
 *   ① 边缘高光随滚动位移（--nav-hl / --nav-hl-o）
 *   ② 玻璃与文字配色按"底下压着什么内容"自适应（data-under="card"）
 *
 * 纪律：
 *   - 读写在同一个 rAF 里分先后（先 elementFromPoint 读，再写 CSS 变量），不制造布局抖动
 *   - elementFromPoint 比较贵 → 只在滚动中每 4 帧采一次，滚动停下再补一次
 *   - 提高对比度 / 减弱动效 / 减弱透明度时：不做这套（CSS 那边也会退回实底）
 */

let raf = 0;
let settle = 0;
let frame = 0;
let force = true;

function unsupported() {
  try {
    if (matchMedia('(prefers-contrast: more)').matches) return true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    if (matchMedia('(prefers-reduced-transparency: reduce)').matches) return true;
  } catch {
    /* 老浏览器没有这些媒体查询：当作支持 */
  }
  return typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('backdrop-filter', 'blur(2px)');
}

export function wireNavGlass() {
  const bar = document.getElementById('tabbar');
  if (!bar) return () => {};
  if (unsupported()) {
    bar.dataset.glass = 'off';
    return () => {};
  }
  bar.dataset.glass = 'on';

  const paint = () => {
    raf = 0;
    const doc = document.documentElement;
    const max = Math.max(1, doc.scrollHeight - window.innerHeight);
    const p = Math.min(1, Math.max(0, window.scrollY / max));
    // ① 高光：从左往右走，滚动越多越亮
    bar.style.setProperty('--nav-hl', (16 + p * 68).toFixed(1) + '%');
    bar.style.setProperty('--nav-hl-o', (0.20 + p * 0.7).toFixed(2));

    // ② 底下压着卡片吗：滚动中每 4 帧采一次；**停下来再补采一次**
    //    （只靠"滚动事件里采样"是不够的：手指一停就没有新事件了，最后一次采样可能落在空隙里）
    if (force || frame++ % 4 === 0) {
      force = false;
      // ⚠️ 采样点要在胶囊**上沿之外**：elementFromPoint 命中的是最上层元素，
      //    直接采胶囊中心只会采到胶囊自己（这个坑今天就踩了）
      const r = bar.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, Math.max(1, r.top - 6));
      const overCard = !!(el && el.closest && el.closest('.card, .word-row, .lib-row'));
      bar.dataset.under = overCard ? 'card' : 'page';
    }
  };

  const onScroll = () => {
    if (!raf) raf = requestAnimationFrame(paint);
    clearTimeout(settle);
    settle = setTimeout(() => {
      force = true;
      if (!raf) raf = requestAnimationFrame(paint);
    }, 120);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  paint();

  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    clearTimeout(settle);
    if (raf) cancelAnimationFrame(raf);
  };
}
