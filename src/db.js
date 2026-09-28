/* 数据层：IndexedDB 的薄封装。
 *
 * 设计要点（对齐 SPEC.md §3）：
 *   - words 用 termNorm 唯一索引保证"同一个词只存一条"
 *   - 掌握状态（prog）挂在**词**上，不在"词×库"上，所以它的主键是 wordId
 *   - 库归属放 links，一个词可以同时属于多个库（多对多）
 *   - 删除一律软删除（deleted=true + updatedAt），第二阶段同步要靠它
 *   - applyImport 是**一个事务**：要么整批进，要么一条都不进
 *
 * 只给浏览器用（Node 里没有 IndexedDB），测试在 tests/browser/db.test.html。
 */

const DB_NAME = 'vocab';
const DB_VERSION = 1;

export const STORES = {
  words: { keyPath: 'id', indexes: [['by_termNorm', 'termNorm', { unique: true }]] },
  libs: { keyPath: 'id', indexes: [['by_order', 'order']] },
  links: { keyPath: 'id', indexes: [['by_word', 'wordId'], ['by_lib', 'libId']] },
  prog: { keyPath: 'wordId', indexes: [['by_dueAt', 'dueAt']] },
  meta: { keyPath: 'key', indexes: [] }
};

const ALL_STORES = Object.keys(STORES);

let dbPromise = null;

/** 打开（首次会自动建表）。同一个页面里只开一次。 */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, def] of Object.entries(STORES)) {
        const store = db.objectStoreNames.contains(name)
          ? req.transaction.objectStore(name)
          : db.createObjectStore(name, { keyPath: def.keyPath });
        for (const [idx, keyPath, opts] of def.indexes) {
          if (!store.indexNames.contains(idx)) store.createIndex(idx, keyPath, opts || {});
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('数据库被其它标签页占用，请关掉其它窗口再试'));
  });
  return dbPromise;
}

/** 测试用：把连接关掉，下次调用重新打开 */
export function closeDB() {
  return dbPromise?.then((db) => {
    db.close();
    dbPromise = null;
  });
}

const reqP = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** 等整个事务提交完成（写操作用它才是真的落库） */
const txDone = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('事务被中止'));
    tx.onerror = () => reject(tx.error || new Error('事务出错'));
  });

export async function storeNames() {
  const db = await openDB();
  return [...db.objectStoreNames];
}

export async function indexNames(store) {
  const db = await openDB();
  return [...db.transaction(store).objectStore(store).indexNames];
}

export async function put(store, obj) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(obj);
  return txDone(tx);
}

/** 一批一起写（一个事务；给"补音标""批量改"这类场景用） */
export async function putMany(store, rows) {
  const list = rows || [];
  if (!list.length) return 0;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const row of list) os.put(row);
  await txDone(tx);
  return list.length;
}

export async function get(store, key) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).get(key));
}

export async function all(store) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).getAll());
}

export async function count(store) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).count());
}

export async function byIndex(store, index, query) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).index(index).getAll(query));
}

/** 软删除：只置标记 + 更新时间，记录留着（同步要用） */
export async function softDelete(store, key, now = Date.now()) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  const req = os.get(key);
  req.onsuccess = () => {
    const row = req.result;
    if (row) os.put({ ...row, deleted: true, updatedAt: now });
  };
  return txDone(tx);
}

/** 清空所有表（测试用，也可以将来做"清空数据"） */
export async function wipeAll() {
  const db = await openDB();
  const tx = db.transaction(ALL_STORES, 'readwrite');
  for (const s of ALL_STORES) tx.objectStore(s).clear();
  return txDone(tx);
}

/**
 * 硬删除（记录真的没了）。
 * 用途：练习里"回退上一题"时，要把那次作答**刚建出来**的 prog 记录彻底删掉 ——
 * 软删除会留个 deleted 标记，那个词就不算"新词"了，进不了明天的队列。
 */
export async function hardDelete(store, key) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return txDone(tx);
}

/**
 * 应用一份导入计划（parse.js 的 planImport 产出），一个事务搞定。
 *
 * plan.create: [{ term, termNorm, meanings, pos?, phonetic?, createdAt? }]
 * plan.merge:  [{ id, addMeanings: string[], revive?: boolean }]
 * libIds:      要归入的库（新词和合并到的词都会进这些库；links 用确定性主键，重复导入天然幂等）
 *
 * 返回 { created, merged }。任何一条失败（比如撞唯一索引）整个事务回滚。
 */
export async function applyImport(plan, { libIds = [], now = Date.now() } = {}) {
  const db = await openDB();
  const tx = db.transaction(['words', 'links'], 'readwrite');
  const words = tx.objectStore('words');
  const links = tx.objectStore('links');

  const linkTo = (wordId) => {
    for (const libId of libIds) {
      links.put({ id: `${wordId}|${libId}`, wordId, libId, addedAt: now, updatedAt: now });
    }
  };

  let created = 0;
  for (const c of plan.create || []) {
    const id = crypto.randomUUID();
    words.put({
      id,
      term: c.term,
      termNorm: c.termNorm,
      phonetic: c.phonetic || '',
      pos: c.pos || '',
      meanings: [...(c.meanings || [])],
      example: c.example || '',
      note: c.note || '',
      createdAt: c.createdAt ?? now,
      updatedAt: now
    });
    linkTo(id);
    created++;
  }

  let merged = 0;
  for (const m of plan.merge || []) {
    const req = words.get(m.id);
    req.onsuccess = () => {
      const w = req.result;
      if (!w) return;
      const set = new Set(w.meanings || []);
      for (const x of m.addMeanings || []) set.add(x);
      const next = { ...w, meanings: [...set], updatedAt: now };
      if (m.revive) delete next.deleted;
      words.put(next);
      linkTo(w.id);
    };
    merged++;
  }

  await txDone(tx);
  return { created, merged };
}
