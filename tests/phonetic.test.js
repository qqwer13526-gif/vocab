/* phonetic.js 的纯逻辑单元测试（解析音标库、按需挑音标）
 * 跑法：npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseDictLine, pickPhonetics } from '../src/phonetic.js';

const SAMPLE = readFileSync(new URL('./fixtures/ipa-sample.txt', import.meta.url), 'utf8');

test('解析音标库里的一行', () => {
  assert.deepEqual(parseDictLine('absorb\t/əbˈzɔːb/'), ['absorb', '/əbˈzɔːb/']);
  assert.deepEqual(parseDictLine('ice cream\t/ˌaɪs ˈkriːm/'), ['ice cream', '/ˌaɪs ˈkriːm/'], '词条按 normTerm 归一化（内部空格保留）');
  assert.deepEqual(parseDictLine('Access\t/ˈæksɛs/'), ['access', '/ˈæksɛs/'], '大小写归一化');
});

test('一行有多个音标变体时取第一个', () => {
  assert.deepEqual(parseDictLine('read\t/riːd/, /rɛd/'), ['read', '/riːd/']);
});

test('不像音标行的都返回 null', () => {
  assert.equal(parseDictLine('# 注释'), null);
  assert.equal(parseDictLine(''), null);
  assert.equal(parseDictLine('没有制表符'), null);
  assert.equal(parseDictLine('term\t'), null);
  assert.equal(parseDictLine('term\t没有斜杠'), null);
  assert.equal(parseDictLine('\t/ipa/'), null);
});

test('CRLF 换行也能解析', () => {
  assert.deepEqual(parseDictLine('absorb\t/əbˈzɔːb/\r'), ['absorb', '/əbˈzɔːb/']);
});

test('一次扫过音标库，只挑出要的词', () => {
  const got = pickPhonetics(SAMPLE, ['absorb', 'artist', 'apply']);
  assert.equal(got.size, 3);
  assert.equal(got.get('absorb'), '/əbˈzɔːb/');
  assert.equal(got.get('artist'), '/ˈɑːtɪst/');
  assert.equal(got.get('apply'), '/əˈplaɪ/');
});

test('大小写和多余空格不影响匹配', () => {
  const got = pickPhonetics(SAMPLE, ['  Absorb ', 'ICE   CREAM']);
  assert.equal(got.get('absorb'), '/əbˈzɔːb/');
  assert.equal(got.get('ice cream'), '/ˌaɪs ˈkriːm/', '多个空格会被压成一个，但不会去掉');
});

test('库里没有的词就不返回（调用方据此报"未收录"）', () => {
  const got = pickPhonetics(SAMPLE, ['absorb', 'zzzznotaword', 'notab']);
  assert.equal(got.size, 1);
  assert.equal(got.has('zzzznotaword'), false);
  assert.equal(got.has('notab'), false, '那行虽然有词但没音标，不算命中');
});

test('注释行不会被当成词条', () => {
  const got = pickPhonetics(SAMPLE, ['ipa-dict', '测试用的小样本']);
  assert.equal(got.size, 0);
});

test('空输入不炸', () => {
  assert.equal(pickPhonetics('', ['absorb']).size, 0);
  assert.equal(pickPhonetics(SAMPLE, []).size, 0);
  assert.equal(pickPhonetics(SAMPLE, ['   ']).size, 0);
});

test('同一个词出现两次时取第一个', () => {
  const got = pickPhonetics('word\t/w1/\nword\t/w2/\n', ['word']);
  assert.equal(got.get('word'), '/w1/');
});
