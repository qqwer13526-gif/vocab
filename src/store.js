/* 界面共用的数据读取与小工具。
 *
 * 数据量是"个人词表"级别（几百到几千词），所以直接全量读进内存算，
 * 不做增量索引——简单、够快、不会有缓存不同步的 bug。
 */

import { all, get } from './db.js';
import { MAX_BOX } from './srs.js';

export const DEFAULT_NEW_LIMIT = 10;

export const PALETTE = ['#3b5bff', '#ff9f0a', '#34c759', '#ff375f', '#af52de', '#5ac8fa'];

/** 一次把要用的都读出来（软删除的已经滤掉） */
export async function loadAll() {
  const [words, libs, links, progs, settings] = await Promise.all([
    all('words'),
    all('libs'),
    all('links'),
    all('prog'),
    get('meta', 'settings')
  ]);
  const liveWords = words.filter((w) => !w.deleted);
  return {
    words: liveWords,
    wordsById: new Map(liveWords.map((w) => [w.id, w])),
    libs: libs.filter((l) => !l.deleted).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
    links: links.filter((l) => !l.deleted),
    progs: Object.fromEntries(progs.map((p) => [p.wordId, p])),
    newLimit: settings?.value?.dailyNewLimit ?? DEFAULT_NEW_LIMIT
  };
}

/** 某个库里的词 id（去重，且只保留还存在的词） */
export function libWordIds(data, libId) {
  const ids = new Set();
  for (const l of data.links) {
    if (l.libId === libId && data.wordsById.has(l.wordId)) ids.add(l.wordId);
  }
  return [...ids];
}

/** 某个库的统计：总词数 / 待复习 / 已掌握（盒子 6）/ 生疏（手动标过「生疏」的）
 *
 * 首页那条堆叠进度条要用三段的宽度，所以这里同时给出 mastered / unfamiliar 的原始个数，
 * 不给百分比 —— 四舍五入过的百分比拼三段会凑不满或溢出 100%。
 */
export function libStats(data, libId, now) {
  let due = 0;
  let mastered = 0;
  let unfamiliar = 0;
  for (const id of libWordIds(data, libId)) {
    const p = data.progs[id];
    if (!p) continue;
    if (p.box >= MAX_BOX) mastered++;
    else if (p.level === 'unfamiliar') unfamiliar++;
    if (p.dueAt <= now) due++;
  }
  const total = libWordIds(data, libId).length;
  return {
    total,
    due,
    mastered,
    unfamiliar,
    // 未掌握也没标生疏的（含"从没练过"）：堆叠条的第三段
    rest: Math.max(0, total - mastered - unfamiliar),
    percent: total ? Math.round((mastered / total) * 100) : 0
  };
}

/** 中文的"今天/明天"式日期，界面统一用它 */
export function formatDue(ms, now = Date.now()) {
  const d = new Date(ms);
  const today = new Date(now);
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return '今天';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(d);
}

/** 新建一个词库（order 排在最后） */
export function nextLibOrder(libs) {
  return libs.reduce((m, l) => Math.max(m, l.order ?? 0), -1) + 1;
}
