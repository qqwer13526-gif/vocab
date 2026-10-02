/* 动效小工具（v33）：数字滚动 + 列表交错入场。
 *
 * 两件事都按"**只在需要的时候动**"来写：
 *   - 数字滚动：记住上一次的值（按 key），从旧值滚到新值 —— 练完一轮回首页才看得见它在滚
 *   - 交错入场：只在"换了个范围"（进词库、切筛选范围）时播一次；搜索逐字重渲染时不该每敲一下都重播
 * 两者都尊重 prefers-reduced-motion（直接落位/直接显示，不留动画）。
 */

let reduced = false;
try {
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', (e) => { reduced = e.matches; });
} catch {
  reduced = false;
}

/* 「换页」的代号：路由每次切换都会 +1（app.js 的 route() 调）。
   交错入场要不要播，看的是**这一代有没有播过**，而不是看内容变没变 ——
   这样"底部导航切页"一定重播，"同一次渲染里重绘"（搜索逐字过滤之类）不会闪。 */
let gen = 0;
export function bumpMotionGen() {
  gen += 1;
}

const lastValue = new Map();

/**
 * 数字滚动（码表感）：从上次这个 key 的值滚到 to。
 * @param node 文本节点/元素
 * @param to   目标数字
 * @param opts.key  记忆用的键（同一处数字每次渲染传同一个 key）
 * @param opts.suffix 后缀，例如 ' 词'
 */
export function countUp(node, to, { key = '', suffix = '', duration = 520 } = {}) {
  if (!node) return;
  const target = Number(to) || 0;
  const from = lastValue.has(key) ? lastValue.get(key) : target;
  lastValue.set(key, target);
  const write = (v) => { node.textContent = `${Math.round(v)}${suffix}`; };
  if (reduced || from === target) {
    write(target);
    return;
  }
  write(from); // 先把旧值写上去：别让这一格在等第一帧的时间里空着
  const t0 = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    const e = 1 - Math.pow(1 - p, 3); // ease-out-cubic：滚得很快、收得很稳
    write(from + (target - from) * e);
    if (p < 1) requestAnimationFrame(tick);
    else write(target);
  };
  requestAnimationFrame(tick);
}

const lastGen = new Map();
const MAX_STAGGER = 12;   // 只给前 12 行做交错 —— 词条库有 191 行，全播会变成"等 3 秒"
const STEP = 28;          // 每行延迟（v35：46 → 28，尾长砍掉一半）
const ENTRY_MS = 240;     // 单张时长
const ENTRY_TOTAL_MS = 320; // 整批总时长上限：卡片多就自动缩短步长，别让页面看起来"还在动"

/**
 * 交错入场：行依次"弹上来"。
 * @param nodes 行元素数组
 * @param opts.scope 范围标识（同一个 scope 在**同一代**里只播一次）
 * @param opts.step  每行延迟 ms
 * @param opts.cap   最多播几行（默认 12）
 */
export function staggerIn(nodes, { scope = '', step = STEP, cap = MAX_STAGGER } = {}) {
  const rows = [...(nodes || [])].filter(Boolean);
  if (!rows.length) return;
  const stamp = String(gen);
  const played = lastGen.get(scope) === stamp;
  lastGen.set(scope, stamp);
  if (reduced || played) return;
  const list = rows.slice(0, cap);
  // 总时长封顶：卡片多的时候自动缩短步长（8 张 × 28ms + 240ms = 436ms 太拖，封到 ~320ms）
  const useStep = list.length > 1 ? Math.min(step, Math.max(8, (ENTRY_TOTAL_MS - ENTRY_MS) / (list.length - 1))) : step;
  list.forEach((r, i) => {
    if (!r.animate) return;
    const anim = r.animate(
      [
        // ⚠️ 只用位移 + 透明度，**不要 scale**：缩放会让"点按区域"在动画期间变小，
        //    a11y 的"点按区域 ≥32×24"就是这么被抓出来的（真回归，不是测试太严）
        { opacity: 0, transform: 'translate3d(0, 6px, 0)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' }
      ], {
        duration: ENTRY_MS,
        delay: Math.round(i * useStep),
        // 临界阻尼那种收尾：**不过冲**（过冲在整页入场里读作"晃"，那是按钮/药丸的曲线）
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'backwards'
      }
    );
    // 跑完把动画撤掉，别让合成层一直挂着
    anim.addEventListener?.('finish', () => anim.cancel());
  });
}

/**
 * 整页入场：把这一页的卡片按文档顺序依次"落"进来（底部导航切页时的那个感觉）。
 * 只取一层：直接的 .card，以及容器（section.pinned / section.libs / .word-list）里的卡片。
 * 练习页不调用它 —— 那张卡片是拖拽面，动画会跟拖拽抢 transform。
 */
export function staggerPage(root, { scope = 'page', step = STEP, cap = 8 } = {}) {
  if (!root || reduced) return;
  const blocks = [];
  for (const child of root.children || []) {
    if (child.hidden || child.classList.contains('word-head')) continue; // 返回+标题是外壳，不动
    if (child.classList.contains('card')) { blocks.push(child); continue; }
    for (const inner of child.children || []) {
      if (inner.classList.contains('card') || inner.classList.contains('newlib-row')) blocks.push(inner);
    }
  }
  staggerIn(blocks, { scope, step, cap });
}

/** 换页/换范围时清掉记忆，让下次进场重新播（一般不用手动调：换页会自动 +1 代） */
export function resetMotion(scope = null) {
  if (scope === null) { lastGen.clear(); lastValue.clear(); }
  else { lastGen.delete(scope); }
}

export const _internal = { lastValue, lastGen };
