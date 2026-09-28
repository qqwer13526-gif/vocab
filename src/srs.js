/* Leitner 遗忘曲线（纯函数，不碰 DOM、不碰数据库 → 可以用 node --test 直接测）。
 *
 * 六个盒子，答对升一盒、答错回第一盒：
 *     盒 1 → 10 分钟      盒 4 → 7 天
 *     盒 2 → 1 天         盒 5 → 21 天
 *     盒 3 → 3 天         盒 6 → 60 天（已掌握）
 *
 * "差点（拼错一个字母）"由界面处理：不调用 grade，让用户重打一遍。
 *
 * ⚠️ 时间一律由调用方通过 now 传进来（不读 Date.now()），这样才好测。
 */

export const MIN = 60 * 1000;
export const DAY = 24 * 60 * MIN;
export const MAX_BOX = 6;

/** 下标就是盒子号；INTERVALS[1] 表示盒 1 答对/答错后等多久再来 */
export const INTERVALS = [0, 10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 21 * DAY, 60 * DAY];

export const NEXT_DUE_LABEL = (box) => {
  const ms = INTERVALS[Math.min(Math.max(box, 1), MAX_BOX)];
  return ms < 60 * MIN ? `${Math.round(ms / MIN)} 分钟` : `${Math.round(ms / DAY)} 天`;
};

/** 新词的初始记录：盒 1、马上可以学 */
export function newProg(wordId, now) {
  return { wordId, box: 1, dueAt: now, streak: 0, lapses: 0, lastDir: null, updatedAt: now };
}

/** 没有任何学习记录 = 新词 */
export const isNew = (prog) => !prog;

/**
 * 判完一次之后更新学习状态。返回**新对象**（不改传进来的那个）。
 *
 * 顺手维护"熟记 / 生疏"标记（这就是生疏词库的来源）：
 *   - **答错 → 自动标生疏**（覆盖之前的熟记；不然答错了还挂在熟记里很怪）
 *   - 答对**不动**标记（生疏的词答对一次仍留在生疏库，否则库一答就空）
 *   - 但一路答对**爬到盒 6（已掌握）→ 自动移出生疏库**，改记成熟记
 *     （从盒 1 爬到盒 6 要连对 5 次、跨 30 多天，所以"自己清干净"不会误伤）
 *
 * @param prog    上一次的 prog 记录
 * @param correct 这次算不算对（"差点算我对"也走 true）
 */
export function grade(prog, correct, { now, dir = null }) {
  const p = { ...prog, lastDir: dir ?? prog.lastDir ?? null, updatedAt: now };
  if (correct) {
    p.box = Math.min(MAX_BOX, (prog.box || 1) + 1);
    p.streak = (prog.streak || 0) + 1;
    if (p.box >= MAX_BOX && p.level === 'unfamiliar') {
      p.level = 'known';
      p.levelFrom = 'mastered';
      p.levelAt = now;
    }
  } else {
    p.box = 1;
    p.streak = 0;
    p.lapses = (prog.lapses || 0) + 1;
    p.level = 'unfamiliar';
    p.levelFrom = 'wrong';
    p.levelAt = now;
  }
  p.dueAt = now + INTERVALS[p.box];
  return p;
}

/**
 * 组今天的练习队列：先复习到期的，再上新词。
 * @param words   全部词（含软删除的，函数内部会过滤）
 * @param progs   wordId → prog 的字典
 * @param links   词与库的归属关系
 * @param libIds  只练这些库；null/空数组 = 所有库
 * @param now     当前时间
 * @param newLimit 这次最多上多少个新词（默认 10）
 * @param wordIds 指定一批词（智能库的专项学习）：只练这些，顺序照给的来，
 *                且不考虑到期时间与新词上限
 * @returns { review: wordId[], fresh: wordId[] }
 */
export function buildQueue({ words, progs, links, libIds = null, now, newLimit = 10, wordIds = null }) {
  // 指定了一批词（生疏词这类智能库的"专项学习"）：只练这些，不管到期没到期、也不受新词上限限制
  if (Array.isArray(wordIds)) {
    const known = new Set((words || []).filter((w) => w && !w.deleted).map((w) => w.id));
    return { review: wordIds.filter((id) => known.has(id)), fresh: [] };
  }

  const wanted = libIds && libIds.length ? new Set(libIds) : null;
  const inLib = wanted ? new Set((links || []).filter((l) => !l.deleted && wanted.has(l.libId)).map((l) => l.wordId)) : null;

  const review = [];
  const fresh = [];
  for (const w of words || []) {
    if (w.deleted) continue;
    if (inLib && !inLib.has(w.id)) continue;
    const p = (progs || {})[w.id];
    if (!p) fresh.push(w);
    else if (p.dueAt <= now) review.push({ id: w.id, dueAt: p.dueAt });
  }

  review.sort((a, b) => a.dueAt - b.dueAt);
  fresh.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

  return {
    review: review.map((r) => r.id),
    fresh: fresh.slice(0, Math.max(0, newLimit)).map((w) => w.id)
  };
}

/** 抽查时自己定的两个等级 */
export const LEVELS = ['known', 'unfamiliar'];

export const LEVEL_LABEL = { known: '熟记', unfamiliar: '生疏' };

/**
 * 手动给一个词定级（抽查时点的「熟记 / 生疏」）。
 *   熟记   → 直接进盒子 6（60 天后再见）
 *   生疏   → 回盒子 1（10 分钟后再见）
 * 有意**不动** lapses / streak：那是答题统计，不该混进手动判断。
 * 返回新对象，不改传进来的那个。
 */
export function markLevel(prog, level, { now }) {
  if (!LEVELS.includes(level)) throw new Error(`未知的等级：${level}`);
  const p = { ...prog, level, levelFrom: 'manual', levelAt: now, updatedAt: now };
  p.box = level === 'known' ? MAX_BOX : 1;
  p.dueAt = now + INTERVALS[p.box];
  return p;
}
