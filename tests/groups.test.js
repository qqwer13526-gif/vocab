import test from 'node:test';
import assert from 'node:assert/strict';
import { groupWordIds, groupsFor } from '../src/groups.js';
import { buildBackup, parseBackup } from '../src/backup.js';

const words = [{ id:'a' },{ id:'b' },{ id:'c' }];
const data = { words, wordsById:new Map(words.map(w=>[w.id,w])),
  libs:[{id:'parent'},{id:'child',parentId:'parent'},{id:'other'}],
  links:[{wordId:'a',libId:'parent'},{wordId:'b',libId:'child'},{wordId:'c',libId:'other'}],
  groups:[{id:'g',libId:'parent',name:'易混词'},{id:'gc',libId:'child',name:'第一组'},{id:'old',libId:'parent',deleted:true}],
  groupWords:[{id:'parent|a',libId:'parent',wordId:'a',groupId:'g'},
    {id:'child|b',libId:'child',wordId:'b',groupId:'gc'},
    {id:'parent|b',libId:'parent',wordId:'b',groupId:'old'},
    {id:'parent|c',libId:'parent',wordId:'c',groupId:'g'}]
};
test('分组只取本库成员，同词在父子库的分组独立',()=>{
  assert.deepEqual(groupWordIds(data,'parent','g'),['a']);
  assert.deepEqual(groupWordIds(data,'child','gc'),['b']);
  assert.deepEqual(groupWordIds(data,'parent','ungrouped'),['b']);
  assert.deepEqual(groupWordIds(data,'parent','all'),['a','b']);
  assert.deepEqual(groupWordIds(data,'parent','gc'),[]);
  assert.deepEqual(groupsFor(data,'parent').map(g=>g.id),['g']);
});
test('分组和归属随备份往返，v1/v2 备份默认无分组',()=>{
  const backup=buildBackup({groups:[{id:'g',libId:'l',name:'A'}],groupWords:[{id:'l|w',libId:'l',wordId:'w',groupId:'g'}]});
  assert.equal(backup.version,3);
  assert.deepEqual(parseBackup(JSON.stringify(backup)).groups,backup.groups);
  assert.deepEqual(parseBackup(JSON.stringify(backup)).groupWords,backup.groupWords);
  for(const version of [1,2]){
    const old=parseBackup(JSON.stringify({kind:backup.kind,version,words:[],libs:[]}));
    assert.deepEqual(old.groups,[]);assert.deepEqual(old.groupWords,[]);
  }
});
