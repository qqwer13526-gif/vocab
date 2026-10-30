/* 数据备份与恢复。
 *
 * 为什么必须有：iOS 上"添加到主屏幕"的应用和 Safari 是**两套独立存储**
 * （WebKit bug 181849），而且**删掉主屏幕图标会连数据一起删掉**。
 * 所以除了"别删图标"这条纪律，还要有一个能自己掌握的安全网：
 *   导出 → 一个 JSON 文件（存到「文件」/ iCloud / 发给自己）
 *   恢复 → 选那个文件，把数据灌回来（换手机、误删、换容器都能救）
 *
 * 纯逻辑（buildBackup / parseBackup / mergeByKey）在 Node 里测，
 * 文件读写与 IndexedDB 在浏览器测试页里测（tests/browser/settings.test.html）。
 */

import { all, restoreAll, STORES as DB_STORES } from './db.js';

export const BACKUP_KIND = 'vocab-pwa-backup';
export const BACKUP_VERSION = 3;   // v61：包含分组，仍可读取 v1/v2

/** 音标库是大文件（3.8MB），不进备份 —— 恢复后重新下载一次就行 */
const SKIP_META = new Set(['phoneticDict', 'phoneticDictFallback']);
const STORES = Object.keys(DB_STORES);
const KEYS = Object.fromEntries(Object.entries(DB_STORES).map(([name, spec]) => [name, spec.keyPath]));

/** 在任何删除/写入前检查主键和唯一索引，不把损坏的可选表默认为空。 */
function validateRows(data) {
  for (const store of STORES) {
    if (!Array.isArray(data[store])) throw new Error(`备份中的 ${store} 不是有效的数据表`);
    const seen = new Set();
    const norms = new Set();
    for (const row of data[store]) {
      const key = row?.[KEYS[store]];
      if (!row || typeof row !== 'object' || typeof key !== 'string' || !key || seen.has(key)) {
        throw new Error(`备份中的 ${store} 缺少有效主键或主键重复`);
      }
      seen.add(key);
      if(store==='groups' && (typeof row.libId!=='string'||!row.libId||typeof row.name!=='string'||!row.name.trim()))throw new Error('备份中的分组数据无效');
      if(store==='groupWords' && (typeof row.libId!=='string'||!row.libId||typeof row.wordId!=='string'||!row.wordId||row.id!==`${row.libId}|${row.wordId}`||(row.groupId!=null&&typeof row.groupId!=='string')))throw new Error('备份中的分组归属无效');
      if (store === 'words' && row.termNorm != null) {
        if (typeof row.termNorm !== 'string' || !row.termNorm || norms.has(row.termNorm)) {
          throw new Error('备份中的单词拼写无效或重复');
        }
        norms.add(row.termNorm);
      }
    }
  }
}

export function buildBackup({ words = [], libs = [], links = [], prog = [], notes = [], groups = [], groupWords = [], meta = [] } = {}, { now = Date.now() } = {}) {
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date(now).toISOString(),
    counts: { words: words.length, libs: libs.length, links: links.length, prog: prog.length, notes: notes.length, groups:groups.length, groupWords:groupWords.length },
    words,
    libs,
    links,
    prog,
    notes,
    groups,
    groupWords,
    meta: meta.filter((m) => m && !SKIP_META.has(m.key))
  };
}

/** 校验备份文件；不是本应用的备份就明确报错 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('这个文件不是 JSON，可能选错了');
  }
  if (!data || data.kind !== BACKUP_KIND) throw new Error('这不是本应用的备份文件');
  if (!Array.isArray(data.words) || !Array.isArray(data.libs)) throw new Error('备份文件缺少词条或词库数据');
  if (data.version != null && (!Number.isInteger(data.version) || data.version < 1 || data.version > BACKUP_VERSION)) {
    throw new Error('不支持这个备份版本，请更新应用后再恢复');
  }
  const parsed = {
    words: data.words,
    libs: data.libs,
    links: data.links === undefined ? [] : data.links,
    notes: data.notes === undefined ? [] : data.notes,
    groups: data.groups === undefined ? [] : data.groups,
    groupWords: data.groupWords === undefined ? [] : data.groupWords,
    prog: data.prog === undefined ? [] : data.prog,
    meta: data.meta === undefined ? [] : data.meta,
    exportedAt: data.exportedAt || '',
    counts: data.counts || null
  };
  validateRows(parsed);
  return parsed;
}

/** 按某个键合并：同键的按 updatedAt 取新的（用于"合并恢复"） */
export function mergeByKey(localRows = [], incomingRows = [], key) {
  const out = new Map();
  for (const row of localRows || []) if (row && row[key] != null) out.set(row[key], row);
  for (const row of incomingRows || []) {
    if (!row || row[key] == null) continue;
    const prev = out.get(row[key]);
    if (!prev || (row.updatedAt ?? 0) >= (prev.updatedAt ?? 0)) out.set(row[key], row);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------- 浏览器侧

/** 把当前所有数据打成一个备份对象 */
export async function collectBackup() {
  const rows = await Promise.all(STORES.map((s) => all(s)));
  return buildBackup(Object.fromEntries(STORES.map((s, i) => [s, rows[i]])));
}

/** 两台设备独立导入时 UUID 不同：按拼写沿用本机 id，并重映射关联和进度。
 * 词条字段和进度仍遵循原来的 updatedAt 规则，较新的一份获胜。
 */
function mergeBackup(local, incoming) {
  const byNorm = new Map(local.words.filter((w) => w.termNorm).map((w) => [w.termNorm, w.id]));
  const ids = new Map(incoming.words.map((w) => [w.id, byNorm.get(w.termNorm) || w.id]));
  const remap = (id) => ids.get(id) || id;
  // 两台设备在同一个库里独立建立同名分组时，沿用本机分组，归属一起映射。
  const knownGroups = new Set(local.groups.map(g => g.id));
  const groupNames = new Map(local.groups.filter(g => !g.deleted).map(g => [JSON.stringify([g.libId,g.name]),g.id]));
  const groupIds = new Map(incoming.groups.map(g => [g.id,knownGroups.has(g.id)?g.id:groupNames.get(JSON.stringify([g.libId,g.name]))||g.id]));
  const mapped = {
    ...incoming,
    words: incoming.words.map((w) => ({ ...w, id: remap(w.id) })),
    groups: incoming.groups.map(g => ({...g,id:groupIds.get(g.id)})),
    links: incoming.links.map((l) => {
      const wordId = remap(l.wordId);
      return { ...l, wordId, id: `${wordId}|${l.libId}` };
    }),
    prog: incoming.prog.map((p) => ({ ...p, wordId: remap(p.wordId) })),
    groupWords: incoming.groupWords.map((r) => {
      const wordId = remap(r.wordId);
      return { ...r, wordId, groupId:groupIds.get(r.groupId)||r.groupId, id: `${r.libId}|${wordId}` };
    })
  };
  return Object.fromEntries(STORES.map((s) => [s, mergeByKey(local[s], mapped[s], KEYS[s])]));
}

/** 导出成文件（iOS 上会走"存储到文件/分享"） */
export async function exportToFile() {
  const backup = await collectBackup();
  const name = `背单词备份-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { name, backup };
}

/**
 * 恢复。
 * @param text  备份文件内容
 * @param mode  'replace'（先清空，默认）| 'merge'（同键按 updatedAt 取新）
 */
export async function importFromText(text, { mode = 'replace' } = {}) {
  const data = parseBackup(text);
  if (!['replace', 'merge'].includes(mode)) throw new Error('未知的恢复方式');
  const added = await restoreAll((local) => {
    const next = mode === 'merge' ? mergeBackup(local, data) : {
      ...data,
      meta: [...local.meta.filter((m) => SKIP_META.has(m.key)), ...data.meta.filter((m) => !SKIP_META.has(m.key))]
    };
    validateRows(next);
    return next;
  });
  return { mode, counts: added, exportedAt: data.exportedAt };
}

/** 本地数据概况：有多少东西、占多少地方、有没有申请到持久化 */
export async function storageInfo() {
  const [words, libs, links, prog] = await Promise.all([all('words'), all('libs'), all('links'), all('prog')]);
  let usage = null;
  let quota = null;
  let persisted = null;
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      usage = est.usage ?? null;
      quota = est.quota ?? null;
    }
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
  } catch {
    /* 某些浏览器不支持，忽略 */
  }
  return {
    words: words.filter((w) => !w.deleted).length,
    wordsAll: words.length,
    libs: libs.filter((l) => !l.deleted).length,
    links: links.filter((l) => !l.deleted).length,
    prog: prog.length,
    usage,
    quota,
    persisted
  };
}

/** 申请"持久化存储"（iOS 上装了主屏幕应用就能申请到，避免被系统清理） */
export async function requestPersist() {
  try {
    if (!navigator.storage?.persist) return { supported: false, persisted: null };
    const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    if (already) return { supported: true, persisted: true };
    const ok = await navigator.storage.persist();
    return { supported: true, persisted: ok };
  } catch (e) {
    return { supported: false, persisted: null, error: String(e && e.message ? e.message : e) };
  }
}

export const formatBytes = (n) => {
  if (n == null) return '未知';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
