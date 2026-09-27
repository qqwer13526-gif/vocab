/* backup.js 的纯逻辑单元测试（备份结构、校验、合并策略）
 * 跑法：npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { BACKUP_KIND, BACKUP_VERSION, buildBackup, mergeByKey, parseBackup } from '../src/backup.js';

const T0 = 1_700_000_000_000;

const sample = {
  words: [{ id: 'w1', term: 'absorb', updatedAt: T0 }],
  libs: [{ id: 'l1', name: '四级', updatedAt: T0 }],
  links: [{ id: 'w1|l1', wordId: 'w1', libId: 'l1', updatedAt: T0 }],
  prog: [{ wordId: 'w1', box: 2, updatedAt: T0 }],
  meta: [
    { key: 'settings', value: { dailyNewLimit: 10 } },
    { key: 'phoneticDict', value: 'x'.repeat(1000) },
    { key: 'phoneticDictFallback', value: 'y'.repeat(1000) }
  ]
};

test('备份里带上身份和计数', () => {
  const b = buildBackup(sample, { now: T0 });
  assert.equal(b.kind, BACKUP_KIND);
  assert.equal(b.version, BACKUP_VERSION);
  assert.equal(b.exportedAt, new Date(T0).toISOString());
  assert.deepEqual(b.counts, { words: 1, libs: 1, links: 1, prog: 1 });
});

test('音标库这种大文件不进备份（3.8MB 没必要，恢复后重下一次就行）', () => {
  const b = buildBackup(sample, { now: T0 });
  assert.deepEqual(b.meta.map((m) => m.key), ['settings']);
});

test('备份能原样读回来', () => {
  const b = buildBackup(sample, { now: T0 });
  const back = parseBackup(JSON.stringify(b));
  assert.deepEqual(back.words, sample.words);
  assert.deepEqual(back.prog, sample.prog);
  assert.deepEqual(back.meta.map((m) => m.key), ['settings']);
});

test('不是备份文件要说清楚，而不是报一堆 JSON 错', () => {
  assert.throws(() => parseBackup('not json'), /不是 JSON/);
  assert.throws(() => parseBackup('{"kind":"something-else"}'), /不是本应用的备份/);
  assert.throws(() => parseBackup('{"kind":"vocab-pwa-backup"}'), /缺少词条/);
});

test('缺 links/prog/meta 的老备份也能读（给空数组）', () => {
  const back = parseBackup(JSON.stringify({ kind: BACKUP_KIND, words: [], libs: [] }));
  assert.deepEqual([back.links, back.prog, back.meta], [[], [], []]);
});

test('合并：同键按 updatedAt 取新的', () => {
  const local = [{ id: 'a', v: 'old', updatedAt: 100 }, { id: 'b', v: 'only-local', updatedAt: 100 }];
  const incoming = [{ id: 'a', v: 'new', updatedAt: 200 }, { id: 'c', v: 'only-incoming', updatedAt: 100 }];
  const out = mergeByKey(local, incoming, 'id');
  const by = Object.fromEntries(out.map((r) => [r.id, r.v]));
  assert.deepEqual(by, { a: 'new', b: 'only-local', c: 'only-incoming' });
});

test('合并：本地更新时不被旧备份覆盖', () => {
  const local = [{ id: 'a', v: 'local-newer', updatedAt: 300 }];
  const incoming = [{ id: 'a', v: 'backup-older', updatedAt: 100 }];
  assert.equal(mergeByKey(local, incoming, 'id')[0].v, 'local-newer');
});

test('合并：prog 用 wordId 当键', () => {
  const local = [{ wordId: 'w1', box: 3, updatedAt: 100 }];
  const incoming = [{ wordId: 'w1', box: 1, updatedAt: 200 }, { wordId: 'w2', box: 1, updatedAt: 200 }];
  const out = mergeByKey(local, incoming, 'wordId');
  assert.equal(out.length, 2);
  assert.equal(out.find((r) => r.wordId === 'w1').box, 1, '更新的那份赢');
});

test('合并：乱七八糟的行不会炸', () => {
  assert.deepEqual(mergeByKey([], [], 'id'), []);
  assert.deepEqual(mergeByKey(null, [{ id: 'a' }], 'id').length, 1);
  assert.deepEqual(mergeByKey([{ nope: 1 }], [{ id: 'a' }], 'id').length, 1, '没有键的行会被丢掉');
});
