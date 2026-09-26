/* 词表解析（纯函数，不碰 DOM → 用 node --test 直接测）。
 *
 * 要对付的真实形态（用户的《英语词汇背诵检查表》）：
 *     第 1 行  标题（合并单元格）
 *     第 2 行  总词数/已背/未背 统计
 *     第 3 行  空行
 *     第 4 行  表头：序号 | 单词 | 词性 | 释义 | 常用搭配 | 背诵确认
 *     第 5 行+ 数据（释义是英汉混排："take in or soak up吸收；使专心"）
 * 所以：先按表头关键词认列，认不出再按"拉丁字母 vs 汉字占比"猜；
 *       表头以上的杂行靠"单词列必须有英文字母 + 释义不能为空"过滤掉。
 */

import { extractPos, normAnswer, normTerm, splitMeanings } from './judge.js';

/** 认表头用的关键词（比对前会归一化：去掉标点空格、转小写） */
const HEADER_KEYS = {
  term: ['单词', '词汇', '词条', '生词', '英文', 'word', 'term', 'vocabulary'],
  mean: ['释义', '词义', '意思', '含义', '中文', '翻译', '解释', 'meaning', 'definition', 'translation'],
  pos: ['词性', '词类', 'partofspeech', 'pos'],
  example: ['常用搭配', '搭配', '例句', '用法', '短语', 'example', 'collocation', 'phrase'],
  phonetic: ['音标', '发音', 'phonetic', 'pronunciation']
};

const hasLatin = (s) => /[a-z]/i.test(s);
const hasCjk = (s) => /[\u3400-\u9fff]/.test(s);

/** 整行按分隔符切开（CSV 要处理引号） */
function splitLine(line, delim) {
  if (delim === ',') return splitCsvLine(line);
  if (delim === 'spaces') return line.trim().split(/\s{2,}/).map((s) => s.trim());
  return line.split('\t').map((s) => s.trim());
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/** 认分隔符：Tab > 逗号 > 连续两个以上空格 */
export function detectDelimiter(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 12);
  const score = { '\t': 0, ',': 0, spaces: 0 };
  for (const l of lines) {
    if (l.includes('\t')) score['\t']++;
    else if (l.includes(',')) score[',']++;
    else if (/\S {2,}\S/.test(l)) score.spaces++;
  }
  let best = '\t';
  let bestN = 0;
  for (const d of ['\t', ',', 'spaces']) {
    if (score[d] > bestN) {
      bestN = score[d];
      best = d;
    }
  }
  return best;
}

/** 把文本切成二维数组（空行丢掉） */
export function parseTable(text, delim = null) {
  const d = delim || detectDelimiter(text);
  const rows = String(text ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => splitLine(l, d));
  return { rows, delim: d };
}

/**
 * 认列。先找表头（前 10 行里关键词命中最多、且同时认出"单词"和"释义"的那一行），
 * 找不到就按占比猜：拉丁字母最多的列是单词列，汉字最多的列是释义列。
 */
export function guessColumns(rows) {
  const list = rows || [];
  let bestRow = -1;
  let bestHits = 0;
  let bestMap = null;

  for (let r = 0; r < Math.min(list.length, 10); r++) {
    const map = {};
    let hits = 0;
    let exact = 0;
    let numeric = false;
    (list[r] || []).forEach((cell, c) => {
      const raw = String(cell ?? '');
      const key = normAnswer(raw);
      if (!key) return;
      for (const [field, keys] of Object.entries(HEADER_KEYS)) {
        if (map[field] !== undefined) continue;
        if (keys.some((kw) => key === kw || key.includes(kw))) {
          map[field] = c;
          hits++;
          if (keys.includes(key)) exact++;
          // 命中的单元格里有数字 → 更像数据行（word000 / 单词1）
          if (/\d/.test(raw)) numeric = true;
          break;
        }
      }
    });
    // 三个条件都满足才算表头：
    //   1) 同时认出"单词"和"释义"
    //   2) 命中的单元格里没有数字（word000 是数据，不是表头）
    //   3) 至少有一个**精确**命中（"单词"/"word"/"释义"），只有包含关系的不算
    //      —— 否则 keyword、password 这种打头的词表会被当成表头，吃掉第一行
    const isHeader = map.term !== undefined && map.mean !== undefined && !numeric && (exact > 0 || hits >= 3);
    if (isHeader && hits > bestHits) {
      bestHits = hits;
      bestRow = r;
      bestMap = map;
    }
  }

  if (bestMap) {
    return {
      source: 'header',
      headerRow: bestRow,
      termCol: bestMap.term,
      meanCol: bestMap.mean,
      posCol: bestMap.pos ?? -1,
      exampleCol: bestMap.example ?? -1,
      phoneticCol: bestMap.phonetic ?? -1
    };
  }

  const width = list.reduce((m, r) => Math.max(m, (r || []).length), 0);
  const latin = new Array(width).fill(0);
  const cjk = new Array(width).fill(0);
  for (const row of list) {
    for (let c = 0; c < width; c++) {
      const v = String(row?.[c] ?? '');
      if (hasLatin(v)) latin[c]++;
      if (hasCjk(v)) cjk[c]++;
    }
  }
  const argmax = (arr, exclude = -1) => {
    let bi = -1;
    let bv = 0;
    arr.forEach((v, i) => {
      if (i === exclude) return;
      if (v > bv) {
        bv = v;
        bi = i;
      }
    });
    return bi;
  };
  const termCol = Math.max(0, argmax(latin));
  const meanCol = Math.max(0, argmax(cjk, termCol));
  return { source: 'ratio', headerRow: -1, termCol, meanCol, posCol: -1, exampleCol: -1, phoneticCol: -1 };
}

/**
 * 把表格变成词条。
 * 过滤规则：单词列必须有英文字母、释义不能为空、单词不能长过 60 字符。
 * 词性：优先用词性列；没有的话从释义里把 "v." 之类的拎出来。
 * 同一批里的重复词合并成一条（释义取并集）。
 */
export function rowsToWords(rows, cols = {}) {
  const { termCol = 0, meanCol = 1, posCol = -1, exampleCol = -1, phoneticCol = -1, headerRow = -1 } = cols;
  const out = [];
  const byNorm = new Map();

  for (let r = headerRow + 1; r < (rows || []).length; r++) {
    const row = rows[r] || [];
    const term = String(row[termCol] ?? '').trim();
    const meanRaw = String(row[meanCol] ?? '').trim();
    if (!term || !meanRaw) continue;
    if (!hasLatin(term) || term.length > 60) continue;

    const termNorm = normTerm(term);
    if (!termNorm) continue;
    const meanings = splitMeanings(meanRaw);
    if (!meanings.length) continue;

    const hit = byNorm.get(termNorm);
    if (hit) {
      for (const m of meanings) if (!hit.meanings.includes(m)) hit.meanings.push(m);
      continue;
    }

    const item = {
      term,
      termNorm,
      pos: posCol >= 0 ? String(row[posCol] ?? '').trim() : '',
      meanings,
      example: exampleCol >= 0 ? String(row[exampleCol] ?? '').trim() : '',
      phonetic: phoneticCol >= 0 ? String(row[phoneticCol] ?? '').trim() : '',
      createdAt: 0
    };
    if (!item.pos) {
      const ex = extractPos(meanings);
      if (ex.pos) {
        item.pos = ex.pos;
        item.meanings = ex.meanings;
      }
    }
    byNorm.set(termNorm, item);
    out.push(item);
  }
  return out;
}

const newMeanings = (word, item) => (item.meanings || []).filter((m) => !(word.meanings || []).includes(m));

/**
 * 算出这次导入要做什么（不落库，落库是 db.applyImport 的事）。
 *
 * @param items    rowsToWords 的产出
 * @param existing 库里已有的词（用来判重）
 * @param mode     'skip' 重复就跳过 / 'merge' 重复就把新释义并进去
 * @returns { create: [...], merge: [{id, addMeanings, revive?}], skip: number }
 *
 * 规则：软删除过的词**无论什么模式都复活**（用户既然又导入一次，就是还要它）。
 */
export function planImport(items, existingWords, mode = 'skip', { now = Date.now() } = {}) {
  const byNorm = new Map((existingWords || []).filter(Boolean).map((w) => [w.termNorm, w]));
  const create = [];
  const merge = [];
  let skip = 0;
  let order = 0;

  for (const it of items || []) {
    const norm = it.termNorm || normTerm(it.term);
    if (!norm) continue;
    const hit = byNorm.get(norm);

    if (hit) {
      if (hit.deleted) merge.push({ id: hit.id, addMeanings: newMeanings(hit, it), revive: true });
      else if (mode === 'merge') merge.push({ id: hit.id, addMeanings: newMeanings(hit, it) });
      else skip++;
      continue;
    }

    const dup = create.find((c) => c.termNorm === norm);
    if (dup) {
      for (const m of it.meanings || []) if (!dup.meanings.includes(m)) dup.meanings.push(m);
      continue;
    }

    create.push({
      term: it.term,
      termNorm: norm,
      meanings: [...(it.meanings || [])],
      pos: it.pos || '',
      example: it.example || '',
      phonetic: it.phonetic || '',
      createdAt: now + order // +order 保证导入顺序就是新词的先后顺序
    });
    order++;
  }

  return { create, merge, skip };
}
