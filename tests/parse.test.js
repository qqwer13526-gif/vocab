/* parse.js 的单元测试（表格解析 + 认列 + 导入计划）
 * 跑法：npm test
 *
 * 这里的样例刻意照抄用户真实词表《英语词汇背诵检查表（一）.xlsx》的形态：
 * 前三行是标题/统计/空行，表头在第 4 行，释义列英汉混排。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { detectDelimiter, guessColumns, parseTable, planImport, rowsToWords } from '../src/parse.js';

const T = '\t';

/** 真实词表的形态（Tab 分隔，直接从 Excel 里复制出来的样子） */
const REAL_TSV = [
  `英语词汇背诵检查表（四级 Test 1）${T}${T}${T}${T}${T}${T}`,
  `总词数${T}187${T}已背${T}0${T}未背${T}187${T}加粗=四级核心词`,
  `${T}${T}${T}${T}${T}${T}`,
  `序号${T}单词${T}词性${T}释义${T}常用搭配${T}背诵确认${T}`,
  `1${T}absorb${T}v.${T}take in or soak up吸收；使专心${T}be absorbed in全神贯注于${T}☐${T}`,
  `2${T}acceptable${T}adj.${T}good enough to be accepted; satisfactory可接受的，合意的${T}an acceptable excuse可接受借口${T}☐${T}`,
  `3${T}acceptance${T}n.${T}act of accepting; approval or agreement接受；认可${T}gain acceptance获得认可${T}☐${T}`,
  `4${T}access${T}v./n.${T}way to enter or reach; ability to use存取（信息）；接近；通道${T}have access to有机会使用${T}☐${T}`,
  `5${T}accomplish${T}v.${T}succeed in doing; finish successfully完成；实现${T}accomplish a task完成任务${T}☐${T}`
].join('\n');

// ---------------------------------------------------------------- 分隔符

test('认分隔符：Tab / 逗号 / 连续空格', () => {
  assert.equal(detectDelimiter(REAL_TSV), '\t');
  assert.equal(detectDelimiter('apple,苹果\nrun,跑'), ',');
  assert.equal(detectDelimiter('apple    苹果\nrun      跑'), 'spaces');
});

test('认分隔符：空文本不炸', () => {
  assert.equal(detectDelimiter(''), '\t');
  assert.equal(detectDelimiter('   \n  '), '\t');
});

// ---------------------------------------------------------------- 表格

test('Tab 表格：空行丢掉，每行按列切开', () => {
  const { rows, delim } = parseTable(REAL_TSV);
  assert.equal(delim, '\t');
  // 原文 9 行（标题 / 统计 / 空行 / 表头 / 5 行数据）→ 丢掉纯空行后 8 行，
  // 之后所有行号都是"丢掉空行后的下标"。
  assert.equal(rows.length, 8, '纯空行应被丢掉');
  assert.deepEqual(rows[0].slice(0, 3), ['英语词汇背诵检查表（四级 Test 1）', '', '']);
  assert.deepEqual(rows[2].slice(0, 6), ['序号', '单词', '词性', '释义', '常用搭配', '背诵确认']);
  assert.equal(rows[3][1], 'absorb');
});

test('CSV：引号里的逗号不能被切开，"" 表示一个引号', () => {
  const { rows, delim } = parseTable('word,mean\ngreet,"你好, 世界"\nsay,"他说""行"""');
  assert.equal(delim, ',');
  assert.deepEqual(rows[1], ['greet', '你好, 世界']);
  assert.deepEqual(rows[2], ['say', '他说"行"']);
});

test('连续空格也能切', () => {
  const { rows } = parseTable('apple    苹果\nrun      跑');
  assert.deepEqual(rows[0], ['apple', '苹果']);
  assert.deepEqual(rows[1], ['run', '跑']);
});

// ---------------------------------------------------------------- 认列

test('认列：靠表头关键词，认得出表头（真实词表里它在原文第 4 行）', () => {
  const { rows } = parseTable(REAL_TSV);
  const cols = guessColumns(rows);
  assert.equal(cols.source, 'header');
  assert.equal(cols.headerRow, 2, '丢掉空行后表头在下标 2（原文第 4 行）');
  assert.equal(cols.termCol, 1);
  assert.equal(cols.meanCol, 3);
  assert.equal(cols.posCol, 2);
  assert.equal(cols.exampleCol, 4);
});

test('认列：只有两列、没有表头时退回"拉丁 vs 汉字占比"猜', () => {
  const { rows } = parseTable('apple\t苹果\nrun\t跑\nbook\t书');
  const cols = guessColumns(rows);
  assert.equal(cols.source, 'ratio');
  assert.equal(cols.headerRow, -1);
  assert.equal(cols.termCol, 0);
  assert.equal(cols.meanCol, 1);
});

test('认列：英文表头也认', () => {
  const { rows } = parseTable('word,meaning,pos\napple,苹果,n.');
  const cols = guessColumns(rows);
  assert.equal(cols.source, 'header');
  assert.equal(cols.headerRow, 0);
  assert.equal(cols.termCol, 0);
  assert.equal(cols.meanCol, 1);
  assert.equal(cols.posCol, 2);
});

test('认列：表头在第 4 行时，上面的杂行不会被当成数据', () => {
  const { rows } = parseTable(REAL_TSV);
  const cols = guessColumns(rows);
  const items = rowsToWords(rows, cols);
  assert.equal(items.length, 5);
  assert.equal(items[0].term, 'absorb');
  assert.ok(!items.some((i) => i.term.includes('总词数')));
  assert.ok(!items.some((i) => i.term.includes('词汇背诵检查表')));
});

// ---------------------------------------------------------------- 行 → 词条

test('行转词条：释义按分号逗号拆开，保留英汉混排的那一段', () => {
  const { rows } = parseTable(REAL_TSV);
  const items = rowsToWords(rows, guessColumns(rows));
  assert.deepEqual(items[0].meanings, ['take in or soak up吸收', '使专心']);
  assert.equal(items[0].pos, 'v.');
  assert.equal(items[0].example, 'be absorbed in全神贯注于');
  assert.equal(items[0].termNorm, 'absorb');
  assert.equal(items[3].pos, 'v./n.');
});

test('行转词条：释义三种分隔符都拆', () => {
  const { rows } = parseTable('apple\t苹果；果实, 苹果树/苹');
  const items = rowsToWords(rows, { termCol: 0, meanCol: 1, headerRow: -1 });
  assert.deepEqual(items[0].meanings, ['苹果', '果实', '苹果树', '苹']);
});

test('行转词条：单词列里没有英文字母的行丢掉（统计行、空行）', () => {
  const rows = [
    ['总词数', '187'],
    ['', ''],
    ['187', '一百八十七'],
    ['apple', '苹果']
  ];
  const items = rowsToWords(rows, { termCol: 0, meanCol: 1, headerRow: -1 });
  assert.deepEqual(items.map((i) => i.term), ['apple']);
});

test('行转词条：没有释义的行丢掉', () => {
  const rows = [
    ['apple', ''],
    ['run', '跑']
  ];
  const items = rowsToWords(rows, { termCol: 0, meanCol: 1, headerRow: -1 });
  assert.deepEqual(items.map((i) => i.term), ['run']);
});

test('行转词条：没有词性列时，从释义里把词性拎出来', () => {
  const { rows } = parseTable('run\tv. 跑；经营');
  const items = rowsToWords(rows, { termCol: 0, meanCol: 1, headerRow: -1 });
  assert.equal(items[0].pos, 'v.');
  assert.deepEqual(items[0].meanings, ['跑', '经营']);
});

test('行转词条：同一批里重复的词合并成一条，释义取并集', () => {
  const { rows } = parseTable('apple\t苹果\nApple\t果实\napple\t苹果');
  const items = rowsToWords(rows, { termCol: 0, meanCol: 1, headerRow: -1 });
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].meanings, ['苹果', '果实']);
});

test('行转词条：首尾空白和全角空格都清掉', () => {
  const { rows } = parseTable('  apple \t 苹果\u3000 ');
  const items = rowsToWords(rows, { termCol: 0, meanCol: 1, headerRow: -1 });
  assert.equal(items[0].term, 'apple');
  assert.deepEqual(items[0].meanings, ['苹果']);
});

test('行转词条：手机号那种超长串不当单词（防止把标题行吃进来）', () => {
  const rows = [['a'.repeat(61), '很长'], ['apple', '苹果']];
  const items = rowsToWords(rows, { termCol: 0, meanCol: 1, headerRow: -1 });
  assert.deepEqual(items.map((i) => i.term), ['apple']);
});

// ---------------------------------------------------------------- 导入计划

const existing = [
  { id: 'w-apple', termNorm: 'apple', meanings: ['苹果'], deleted: false },
  { id: 'w-gone', termNorm: 'gone', meanings: ['走了'], deleted: true }
];
const incoming = [
  { term: 'apple', termNorm: 'apple', meanings: ['苹果', '果实'], pos: 'n.' },
  { term: 'gone', termNorm: 'gone', meanings: ['走了'] },
  { term: 'run', termNorm: 'run', meanings: ['跑'], pos: 'v.' }
];

test('导入计划：重复的跳过', () => {
  const plan = planImport(incoming, existing, 'skip');
  assert.deepEqual(plan.create.map((c) => c.term), ['run']);
  assert.equal(plan.skip, 1, 'apple 已存在且没被删过 → 跳过');
  assert.deepEqual(plan.merge.map((m) => m.id), ['w-gone'], '软删除过的要复活，不算跳过');
});

test('导入计划：重复的合并释义，只带新的那几条', () => {
  const plan = planImport(incoming, existing, 'merge');
  assert.deepEqual(plan.create.map((c) => c.term), ['run']);
  assert.equal(plan.skip, 0);
  const apple = plan.merge.find((m) => m.id === 'w-apple');
  assert.deepEqual(apple.addMeanings, ['果实'], '苹果已经有了，不该重复加');
  assert.equal(apple.revive, undefined);
});

test('导入计划：软删除过的词重新导入要复活，不管什么模式', () => {
  for (const mode of ['skip', 'merge']) {
    const plan = planImport(incoming, existing, mode);
    const gone = plan.merge.find((m) => m.id === 'w-gone');
    assert.ok(gone, `${mode} 模式下也该复活 gone`);
    assert.equal(gone.revive, true);
  }
});

test('导入计划：库里没有的词都进 create，并且带上 createdAt', () => {
  const plan = planImport(incoming, existing, 'skip');
  assert.equal(plan.create.length, 1);
  assert.ok(plan.create[0].createdAt > 0);
});

test('导入计划：同一批里的重复词只建一条', () => {
  const dup = [
    { term: 'apple', termNorm: 'apple', meanings: ['苹果'] },
    { term: 'Apple', termNorm: 'apple', meanings: ['果实'] }
  ];
  const plan = planImport(dup, [], 'skip');
  assert.equal(plan.create.length, 1);
  assert.deepEqual(plan.create[0].meanings, ['苹果', '果实']);
});

test('导入计划：空输入不炸', () => {
  assert.deepEqual(planImport([], existing, 'skip'), { create: [], merge: [], skip: 0 });
  assert.deepEqual(planImport(incoming, undefined, 'skip').create.length, 3);
});
