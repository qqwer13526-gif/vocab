/* 自检：把转换出来的 TSV 用应用自己的解析逻辑（src/parse.js）跑一遍，
 * 看看认不认得出单词列/释义列、能拆出多少词。
 *
 * 用法：node tool/check_tsv.mjs "路径/表一.tsv"
 * 输出：一行 JSON（给 tool/xlsx_to_tsv.py 或人看）
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { guessColumns, parseTable, rowsToWords } from '../src/parse.js';

const file = process.argv[2];
if (!file) {
  console.error('用法：node tool/check_tsv.mjs <文件.tsv>');
  process.exit(2);
}

const text = readFileSync(file, 'utf8');
const { rows, delim } = parseTable(text);
const cols = guessColumns(rows);
const items = rowsToWords(rows, cols);

const out = {
  file: basename(file),
  lines: rows.length,
  delimiter: delim === '\t' ? 'Tab' : delim,
  columnSource: cols.source, // header = 靠表头关键词认出；ratio = 按拉丁/汉字占比猜
  headerRow: cols.headerRow,
  termCol: cols.termCol,
  meanCol: cols.meanCol,
  posCol: cols.posCol,
  exampleCol: cols.exampleCol,
  words: items.length,
  sample: items.slice(0, 3).map((i) => ({
    term: i.term,
    pos: i.pos || '',
    meanings: i.meanings.slice(0, 3),
    example: i.example || ''
  }))
};

console.log(JSON.stringify(out, null, 1));
