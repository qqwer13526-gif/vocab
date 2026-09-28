/* 界面共用的数据读取与小工具。
 *
 * 数据量是"个人词表"级别（几百到几千词），所以直接全量读进内存算，
 * 不做增量索引——简单、够快、不会有缓存不同步的 bug。
 */

import { all, get, put, softDelete } from './db.js';
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
  return statsFor(libId ? libWordIds(data, libId) : allWordIds(data), data, now);
}

/** 总词库：**所有**导入过的词（不属于任何库、或库被删掉的词也在这里）
 *
 * 数据模型本来就是"词是全局的、库只是标签"（words + links 多对多），
 * 所以总词库不需要存任何东西 —— 它永远是"所有还活着的词"，删库也删不掉它。
 */
export function allWordIds(data) {
  return [...data.wordsById.keys()];
}

/** 一组词 id 的统计（libStats 与总词库共用） */
export function statsFor(ids, data, now) {
  let due = 0;
  let mastered = 0;
  let unfamiliar = 0;
  for (const id of ids) {
    const p = data.progs[id];
    if (!p) continue;
    if (p.box >= MAX_BOX) mastered++;
    else if (p.level === 'unfamiliar') unfamiliar++;
    if (p.dueAt <= now) due++;
  }
  const total = ids.length;
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

// ---------------------------------------------------------------- 删除词库
//
// 语义（用户 2026-09-26 定的）：**删库不删词**。
// 词永远留在"总词库"里；删掉的只是"这个词库"和"词与它的归属关系"。
// 所以级联范围只有 libs + links，一个字都不动 words。
// 全部是软删除，配一个可撤销快照。

/**
 * 删除一个词库：软删除 它的关联 + 它自己。返回撤销快照。
 * @returns {{libId: string, linkIds: string[], at: number}}
 */
export async function deleteLibCascade(data, libId, now = Date.now()) {
  const linkIds = data.links.filter((l) => l.libId === libId).map((l) => l.id);
  for (const id of linkIds) await softDelete('links', id, now);
  await softDelete('libs', libId, now);
  return { libId, linkIds, at: now };
}

/** 撤销上面那次删除（把 deleted 标记清回去） */
export async function undoDeleteLibCascade(snap) {
  for (const id of snap.linkIds) {
    const row = await get('links', id);
    if (row) await put('links', { ...row, deleted: false, updatedAt: Date.now() });
  }
  const lib = await get('libs', snap.libId);
  if (lib) await put('libs', { ...lib, deleted: false, updatedAt: Date.now() });
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
