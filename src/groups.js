/* 库内分组：定义与归属分开，归属键固定为 libId|wordId。 */
import { updateStores } from './db.js';
import { libWordIds } from './store.js';

export function groupsFor(data, libId) {
  return (data.groups || []).filter(g => !g.deleted && g.libId === libId)
    .sort((a,b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));
}

export function groupWordIds(data, libId, groupId = 'all') {
  const members = libWordIds(data, libId);
  if (groupId === 'all') return members;
  const live = new Set(groupsFor(data, libId).map(g => g.id));
  if (groupId !== 'ungrouped' && !live.has(groupId)) return [];
  const assigned = new Map((data.groupWords || []).filter(r => !r.deleted && r.libId === libId && live.has(r.groupId)).map(r => [r.wordId,r.groupId]));
  return members.filter(id => groupId === 'ungrouped' ? !assigned.has(id) : assigned.get(id) === groupId);
}

const TABLES = ['words','libs','links','groups','groupWords'];
const stamp = row => Math.max(Date.now(), (row?.updatedAt || 0) + 1);
function liveData(rows) {
  const words = rows.words.filter(w => !w.deleted);
  return { ...rows, words, wordsById:new Map(words.map(w=>[w.id,w])),
    libs:rows.libs.filter(l=>!l.deleted), links:rows.links.filter(l=>!l.deleted) };
}
function library(data, id) {
  if (!data.libs.some(l => l.id === id)) throw new Error('词库已不存在，请重新打开');
}
function group(data, libId, id) {
  if (id && !groupsFor(data,libId).some(g=>g.id===id)) throw new Error('分组已不存在或不属于这个词库');
}
function nameFor(data, libId, value, except = null) {
  const name = String(value || '').trim();
  if (!name || name.length > 40) throw new Error('分组名称需要 1–40 个字符');
  if (groupsFor(data,libId).some(g => g.id !== except && g.name === name)) throw new Error('这个词库已有同名分组');
  return name;
}
function edit(prepare) {
  return updateStores(TABLES, rows => {
    const changes = [];
    const writes = {};
    const write = (store, row) => {
      const before = rows[store].find(r=>r.id===row.id) || null;
      const after = { ...row, updatedAt:stamp(before) };
      (writes[store] ||= []).push(after);
      changes.push({store,before,after});
      return after;
    };
    const value = prepare(liveData(rows), write);
    return {writes, value:value || {changes}};
  });
}

export function createGroup(libId, name) {
  return edit((data,write) => {
    library(data,libId);
    return write('groups',{id:crypto.randomUUID(),libId,name:nameFor(data,libId,name),order:groupsFor(data,libId).length,createdAt:Date.now()});
  });
}
export function renameGroup(id,name) {
  return edit((data,write) => {
    const prev = data.groups.find(g=>g.id===id&&!g.deleted);
    if (!prev) throw new Error('分组已不存在');
    library(data,prev.libId);
    write('groups',{...prev,name:nameFor(data,prev.libId,name,id)});
  });
}
export function deleteGroup(id) {
  return edit((data,write) => {
    const prev = data.groups.find(g=>g.id===id&&!g.deleted);
    if (!prev) throw new Error('分组已不存在');
    write('groups',{...prev,deleted:true});
  });
}
export function assignGroup(libId, wordIds, groupId = null) {
  return edit((data,write) => {
    library(data,libId); group(data,libId,groupId);
    const members = new Set(libWordIds(data,libId));
    for (const wordId of new Set(wordIds)) {
      if (!members.has(wordId)) throw new Error('选中的单词已不在这个词库中');
      write('groupWords',{id:`${libId}|${wordId}`,libId,wordId,groupId,deleted:false});
    }
  });
}
export function collectWord(wordId, targets) {
  return edit((data,write) => {
    if (!data.wordsById.has(wordId)) throw new Error('单词已不存在');
    for (const {libId,groupId = null} of new Map(targets.map(t=>[t.libId,t])).values()) {
      library(data,libId); group(data,libId,groupId);
      if (!libWordIds(data,libId).includes(wordId)) {
        const prev = data.links.find(l=>l.id===`${wordId}|${libId}`);
        write('links',{...prev,id:`${wordId}|${libId}`,wordId,libId,addedAt:prev?.addedAt || Date.now(),deleted:false});
      }
      write('groupWords',{id:`${libId}|${wordId}`,libId,wordId,groupId,deleted:false});
    }
  });
}
/** 只撤销仍与本次写入一致的行，避免旧撤销覆盖后续整理或收集。 */
export function undoGroupChange(snapshot) {
  return updateStores(['groups','groupWords','links'], rows => {
    const writes = {};
    for (const {store,before,after} of snapshot.changes || []) {
      const current = rows[store].find(r=>r.id===after.id);
      if (JSON.stringify(current) !== JSON.stringify(after)) continue;
      (writes[store] ||= []).push({...(before || after),deleted:before?.deleted || !before,updatedAt:stamp(current)});
    }
    return {writes};
  });
}
