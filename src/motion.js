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
  // 帧率浮层里的归因开关：关掉"数字滚动"这一项（只用来测量，正常使用不会设这个标记）
  if (typeof document !== 'undefined' && document.documentElement.dataset.perfNoCount) {
    node.textContent = `${Math.round(Number(to) || 0)}${suffix}`;
    return;
  }
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
  // 写 textContent 会触发布局，而它又和"切页入场"同时跑 → 最多 ~14 次/秒（肉眼一样顺）
  const MIN_GAP = 70;
  let lastWrite = -1e9;
  let shown = Math.round(from);
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    const e = 1 - Math.pow(1 - p, 3); // ease-out-cubic：滚得很快、收得很稳
    if (p >= 1) {
      write(target);
      return;
    }
    const v = Math.round(from + (target - from) * e);
    if (v !== shown && now - lastWrite >= MIN_GAP) {
      write(v);
      shown = v;
      lastWrite = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const lastGen = new Map();
/* 入场节奏（v38）：照 UI 仓库 07「物理弹簧交错流」来 ——
 * 那张卡是 stagger 100ms + translateY(26px) + scale(.94) + 弹簧(stiffness 190 / damping 17, ζ≈0.62)。
 * 之前这里是 28ms 一步、整批封顶 320ms、还去掉了过冲 —— 结果"延迟重拍"完全看不出来（用户反馈）。
 * 现在：步长 90ms、整批上限放宽到 900ms（只有卡片特别多时才压缩步长）、保留约 8% 的过冲。
 * 弹道用多段关键帧近似，仍然跑在合成器上（不回到每帧 rAF 写 style 那条老路）。 */
const MAX_STAGGER = 12;
const STEP = 90;            // 每张延迟（07 是 100ms；90ms 在"看得出重拍"和"别太慢"之间）
const PAGE_CAP = 12;        // 硬上限（真正决定给谁做交错的是"这一屏看不看得见"，见 staggerPage）
const ENTRY_MS = 480;       // 单张时长（07 的 settle ≈ 470ms）
const ENTRY_TOTAL_MS = 960; // 整批上限：6 张 × 90ms + 480ms = 930ms，所以 90ms 的步长保得住

/**
 * 交错入场：行依次"弹上来"。
 * @param nodes 行元素数组
 * @param opts.scope 范围标识（同一个 scope 在**同一代**里只播一次）
 * @param opts.step  每行延迟 ms
 * @param opts.cap   最多播几行（默认 12）
 */
export function staggerIn(nodes, { scope = '', step = STEP, cap = MAX_STAGGER, offset = 26, scale = 1, delay = 0 } = {}) {
  const rows = [...(nodes || [])].filter(Boolean);
  if (!rows.length) return;
  // 帧率浮层里的归因开关：关掉"入场动画"这一项
  if (typeof document !== 'undefined' && document.documentElement.dataset.perfNoEntry) return;
  const stamp = String(gen);
  const played = lastGen.get(scope) === stamp;
  lastGen.set(scope, stamp);
  if (reduced || played) return;
  const list = rows.slice(0, cap);
  // 整批上限只做"兜底"：卡片特别多时才缩短步长（正常情况下 90ms 一步是有意为之）
  const useStep = list.length > 1 ? Math.min(step, Math.max(24, (ENTRY_TOTAL_MS - ENTRY_MS) / (list.length - 1))) : step;
  list.forEach((r, i) => {
    if (!r.animate) return;
    const anim = r.animate(entryFrames(offset, scale), {
      duration: ENTRY_MS,
      delay: Math.round(delay + i * useStep),
      // 每段之间用 ease-out；过冲由关键帧本身给出（近似 07 那条 ζ≈0.62 的弹簧）
      easing: 'ease-out',
      fill: 'backwards'
    });
    // 跑完把动画撤掉，别让合成层一直挂着
    anim.addEventListener?.('finish', () => anim.cancel());
  });
}

/**
 * 入场关键帧：近似 UI 仓库 07 那条弹簧（stiffness 190 / damping 17 → ζ≈0.62，过冲 ≈8.5%）。
 * 用一个关键帧序列代替每帧 rAF，好处是整段跑在合成器上（手机上不掉帧）。
 */
export function entryFrames(offset = 26, scale = 1) {
  const over = offset * 0.085; // 过冲峰值 ≈ 8.5%
  // ⚠️ scale 默认就是 1（**不做缩放**）：07 的起点是 scale(.94)，但那会把卡片里的控件一起缩小，
  //    实测 34px 的按钮 × 0.94 = 31.96、32px 的标签 × 0.94 = 30.1 → 全部掉出"点按区域 ≥32×24"，
  //    真机上还意味着"刚出现的卡片一瞬间不好点"。要开 scale 的话，先把所有小控件的最小高度提到 36px。
  const s0 = `scale(${scale})`;
  return [
    { opacity: 0, transform: `translate3d(0, ${offset}px, 0) ${s0}`, offset: 0 },
    { opacity: 1, transform: `translate3d(0, 0, 0) ${s0}`, offset: 0.35 },
    { opacity: 1, transform: `translate3d(0, ${(-over).toFixed(2)}px, 0) ${s0}`, offset: 0.62 },
    { opacity: 1, transform: `translate3d(0, ${(over * 0.27).toFixed(2)}px, 0) ${s0}`, offset: 0.82 },
    { opacity: 1, transform: `translate3d(0, 0, 0) ${s0}`, offset: 1 }
  ];
}

/**
 * 整页入场：把这一页的卡片按文档顺序依次"落"进来（底部导航切页时的那个感觉）。
 * 只取一层：直接的 .card，以及容器（section.pinned / section.libs / .word-list）里的卡片。
 * 练习页不调用它 —— 那张卡片是拖拽面，动画会跟拖拽抢 transform。
 */
export function staggerPage(root, { scope = 'page', step = STEP, cap = null, offset = 26, scale = 1, delay = 0 } = {}) {
  if (!root || reduced) return;
  const blocks = [];
  for (const child of root.children || []) {
    if (child.hidden || child.classList.contains('word-head')) continue; // 返回+标题是外壳，不动
    if (child.classList.contains('card')) { blocks.push(child); continue; }
    for (const inner of child.children || []) {
      if (inner.classList.contains('card') || inner.classList.contains('newlib-row')) blocks.push(inner);
    }
  }
  // 只给"这一屏看得见的卡片"做交错（v40）：
  // 以前写死给前 6 张 —— 于是第 7 张之后（比如首页第 6 个词库）直接出现，肉眼就是"这张没动画"。
  // 屏幕外的直接到位是合理的：出现时你看不到它。
  // ⚠️ 调用方必须**先把滚动归零**（否则量到的是上一页的滚动位置，判断会错）。
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
  const visible = blocks.filter((n) => {
    const r = n.getBoundingClientRect();
    return r.top < vh && r.bottom > 0;
  });
  const list = visible.length ? visible : blocks;
  // cap 没传 = 屏内可见的全都要（这是 v40 修"最后一张直接出现"的关键）；传了就尊重调用方
  const want = cap == null ? list.length : Math.min(cap, list.length);
  staggerIn(list, { scope, step, cap: want, offset, scale, delay });
}

/** 换页/换范围时清掉记忆，让下次进场重新播（一般不用手动调：换页会自动 +1 代） */
export function resetMotion(scope = null) {
  if (scope === null) { lastGen.clear(); lastValue.clear(); }
  else { lastGen.delete(scope); }
}

export const _internal = { lastValue, lastGen };
