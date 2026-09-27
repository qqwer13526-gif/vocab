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

import { all, putMany, wipeAll } from './db.js';

export const BACKUP_KIND = 'vocab-pwa-backup';
export const BACKUP_VERSION = 1;

/** 音标库是大文件（3.8MB），不进备份 —— 恢复后重新下载一次就行 */
const SKIP_META = new Set(['phoneticDict', 'phoneticDictFallback']);

export function buildBackup({ words = [], libs = [], links = [], prog = [], meta = [] } = {}, { now = Date.now() } = {}) {
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date(now).toISOString(),
    counts: { words: words.length, libs: libs.length, links: links.length, prog: prog.length },
    words,
    libs,
    links,
    prog,
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
  return {
    words: data.words,
    libs: data.libs,
    links: Array.isArray(data.links) ? data.links : [],
    prog: Array.isArray(data.prog) ? data.prog : [],
    meta: Array.isArray(data.meta) ? data.meta : [],
    exportedAt: data.exportedAt || '',
    counts: data.counts || null
  };
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

const STORES = ['words', 'libs', 'links', 'prog', 'meta'];
const KEYS = { words: 'id', libs: 'id', links: 'id', prog: 'wordId', meta: 'key' };

/** 把当前所有数据打成一个备份对象 */
export async function collectBackup() {
  const [words, libs, links, prog, meta] = await Promise.all(STORES.map((s) => all(s)));
  return buildBackup({ words, libs, links, prog, meta });
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
  const added = {};
  if (mode === 'replace') {
    // ⚠️ 必须在清空**之前**把音标库缓存捞出来，否则恢复完还得重新下载 3.8MB
    const keepMeta = (await all('meta')).filter((m) => m && SKIP_META.has(m.key));
    await wipeAll();
    for (const store of STORES) {
      if (store === 'meta') {
        const rows = [...keepMeta, ...data.meta.filter((m) => m && !SKIP_META.has(m.key))];
        added[store] = await putMany('meta', rows);
      } else {
        added[store] = await putMany(store, data[store] ?? []);
      }
    }
  } else {
    for (const store of STORES) {
      const local = await all(store);
      const merged = mergeByKey(local, data[store] ?? [], KEYS[store]);
      added[store] = await putMany(store, merged);
    }
  }
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
