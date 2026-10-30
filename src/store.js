/* 界面共用的数据读取与小工具。
 *
 * 数据量是"个人词表"级别（几百到几千词），所以直接全量读进内存算，
 * 不做增量索引——简单、够快、不会有缓存不同步的 bug。
 */

import { all, get, hardDelete, put, softDelete } from './db.js';
import { MAX_BOX } from './srs.js';

export const PALETTE = ['#3b5bff', '#ff9f0a', '#34c759', '#ff375f', '#af52de', '#5ac8fa'];

/** 一次把要用的都读出来（软删除的已经滤掉） */
export async function loadAll() {
  const [words, libs, links, progs, groups, groupWords] = await Promise.all([
    all('words'),
    all('libs'),
    all('links'),
    all('prog'), all('groups'), all('groupWords')
  ]);
  const liveWords = words.filter((w) => !w.deleted);
  return {
    words: liveWords,
    wordsById: new Map(liveWords.map((w) => [w.id, w])),
    libs: libs.filter((l) => !l.deleted).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
    links: links.filter((l) => !l.deleted),
    groups: groups.filter((g) => !g.deleted),
    groupWords: groupWords.filter((g) => !g.deleted),
    progs: Object.fromEntries(progs.map((p) => [p.wordId, p]))
  };
}

/** 某个库里的词 id（去重，且只保留还存在的词）
 *
 * v52 起包含**子词库**的词：父库 = 自己 + 直接子库（只允许一层）。
 * 为什么是"读时算"而不是往 links 里补冗余归属：数据模型里词库只是标签，
 * 补冗余就得在新建/移动/删除/导入四处维护一致性，迟早不同步；
 * 这里 `libWordIds` 是全项目**唯一**的取词入口（练习、统计、词条页都走它），
 * 所以在这一处认层级，其余地方自动跟着对。
 */
export function libWordIds(data, libId) {
  const ids = new Set();
  const want = new Set(descendantLibIds(data, libId));
  for (const l of data.links) {
    if (want.has(l.libId) && data.wordsById.has(l.wordId)) ids.add(l.wordId);
  }
  return [...ids];
}

/** 一个库 + 它的直接子库（只一层）。父库的取词/统计都用它。 */
export function descendantLibIds(data, libId) {
  return [libId, ...childLibs(data, libId).map((l) => l.id)];
}

/** 直接子库（按 order 排，和顶层用同一套排序） */
export function childLibs(data, libId) {
  return data.libs.filter((l) => l.parentId === libId && l.id !== libId);
}

/** 父库对象；顶层库给 null */
export function parentOf(data, libId) {
  const self = data.libs.find((l) => l.id === libId);
  if (!self || !self.parentId) return null;
  return data.libs.find((l) => l.id === self.parentId) || null;
}

/** 首页要的树：顶层库（含各自子库），子库不会重复出现在顶层 */
export function libTree(data) {
  return data.libs
    .filter((l) => !l.parentId || !data.libs.some((p) => p.id === l.parentId))
    .map((lib) => ({ lib, children: childLibs(data, lib.id) }));
}

/** 同级的下一个 order（子库在兄弟之间排队，不跟顶层抢） */
export function nextSiblingOrder(data, parentId) {
  const siblings = data.libs.filter((l) => (l.parentId || null) === (parentId || null));
  return siblings.reduce((m, l) => Math.max(m, l.order ?? 0), -1) + 1;
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
 * 删除一个词库：软删除 它自己 + 它的**直接子库** + 它们的所有归属关系。返回撤销快照。
 *
 * v52：删父库要连子库一起删 —— 否则子库会变成指着一个已删父库的孤儿
 * （虽然 libTree 会把孤儿当顶层显示，但"删了父库、子库还留着"不是用户要的语义）。
 * 词本身仍然一个字都不动（词永远在总词库）。
 *
 * @returns {{libId: string, childLibIds: string[], linkIds: string[], at: number}}
 */
export async function deleteLibCascade(data, libId, now = Date.now()) {
  const childLibIds = childLibs(data, libId).map((l) => l.id);
  const libIds = [libId, ...childLibIds];
  const linkIds = data.links.filter((l) => libIds.includes(l.libId)).map((l) => l.id);
  for (const id of linkIds) await softDelete('links', id, now);
  for (const id of libIds) await softDelete('libs', id, now);
  return { libId, childLibIds, linkIds, at: now };
}

/** 撤销上面那次删除（把 deleted 标记清回去；老快照没有 childLibIds 也能用） */
export async function undoDeleteLibCascade(snap) {
  for (const id of snap.linkIds) {
    const row = await get('links', id);
    if (row) await put('links', { ...row, deleted: false, updatedAt: Date.now() });
  }
  for (const id of [snap.libId, ...(snap.childLibIds || [])]) {
    const lib = await get('libs', id);
    if (lib) await put('libs', { ...lib, deleted: false, updatedAt: Date.now() });
  }
}

// ---------------------------------------------------------------- 删除单个词（v54）
//
// 语义（用户定）：左滑露出的「删除」= **彻底删除** —— 词 + 它在所有库里的归属 + 练习进度，
// 一起删掉（软删，配 6 秒撤销）。
// ⚠️ 进度用 hardDelete 真删：软删的 prog 会让这个词被当成"已经练过"，进不了新词队列 ✗

/** @returns {{wordId: string, linkIds: string[], prog: object|null, at: number}} */
export async function deleteWordCascade(data, wordId, now = Date.now()) {
  const linkIds = data.links.filter((l) => l.wordId === wordId).map((l) => l.id);
  for (const id of linkIds) await softDelete('links', id, now);
  const prog = (await get('prog', wordId)) || null;
  if (prog) await hardDelete('prog', wordId);
  await softDelete('words', wordId, now);
  return { wordId, linkIds, prog, at: now };
}

/** 撤销上面那次删除（词、归属、进度全部回来） */
export async function undoDeleteWord(snap) {
  for (const id of snap.linkIds || []) {
    const row = await get('links', id);
    if (row) await put('links', { ...row, deleted: false, updatedAt: Date.now() });
  }
  if (snap.prog) await put('prog', { ...snap.prog, updatedAt: Date.now() });
  const w = await get('words', snap.wordId);
  if (w) await put('words', { ...w, deleted: false, updatedAt: Date.now() });
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
