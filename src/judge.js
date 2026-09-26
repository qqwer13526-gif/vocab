/* 答案判定与归一化（纯函数，不碰 DOM → 用 node --test 直接测）。
 *
 * 这里有两个**不能混用**的归一化：
 *   normTerm   —— 词的"身份"。用于去重和 termNorm：全角→半角、小写、压缩空白，
 *                 **保留标点**（can't 和 cant 是两个不同的词）。
 *   normAnswer —— 判答案。在 normTerm 基础上再把标点和空格全扔掉，
 *                 这样"苹果。""苹 果""ＡＰＰＬＥ"都能判对。
 */

const FULLWIDTH = /[\uFF01-\uFF5E]/g; // 全角 ！-～ → 半角
const IDEOGRAPHIC_SPACE = /\u3000/g; // 全角空格
const PUNCT_AND_SPACE = /[\s,.;:!?'"()[\]{}<>、。，；：！？（）【】《》…·~^_+=|\\/@#$%&*`-]/g;

/** 词的归一化身份：统一大小写/全角/空白，保留标点 */
export function normTerm(s) {
  return String(s ?? '')
    .replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(IDEOGRAPHIC_SPACE, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** 判答案用的归一化：标点和空格一律不算 */
export function normAnswer(s) {
  return normTerm(s).replace(PUNCT_AND_SPACE, '');
}

/** 编辑距离。相邻两个字符打反算 1 步（recieve → receive），因为那是最常见的错法 */
export function lev(a, b) {
  const s = String(a ?? '');
  const t = String(b ?? '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  const d = Array.from({ length: s.length + 1 }, () => new Array(t.length + 1).fill(0));
  for (let i = 0; i <= s.length; i++) d[i][0] = i;
  for (let j = 0; j <= t.length; j++) d[0][j] = j;

  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[s.length][t.length];
}

/** 一条释义里可能塞了好几条（"跑；奔跑, 经营"） */
export function splitMeanings(s) {
  return String(s ?? '')
    .split(/[;；,，/、]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const POS_RE = /^(n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|aux|abbr)\.?$/i;

/** 把 "v. 跑" 里的词性拎出来：{ pos: 'v.', meanings: ['跑'] } */
export function extractPos(meanings = []) {
  const out = [];
  let pos = '';
  for (const raw of meanings || []) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    const parts = text.split(/\s+/);
    if (parts.length > 1 && POS_RE.test(parts[0])) {
      if (!pos) pos = parts[0].replace(/\.?$/, '.');
      out.push(parts.slice(1).join(' '));
    } else {
      out.push(text);
    }
  }
  return { pos, meanings: out.filter(Boolean) };
}

/** 把一组释义摊平成"可以命中的答案集合" */
function targetsOf(meanings) {
  const { meanings: clean } = extractPos(meanings || []);
  return clean.flatMap(splitMeanings).map(normAnswer).filter(Boolean);
}

/**
 * 看英文写中文。
 * @returns { ok, near } near=true 表示差一点点，界面给「算我对」按钮，由用户定夺
 */
export function judgeEn2Zh(input, meanings) {
  const targets = targetsOf(meanings);
  const parts = splitMeanings(input).map(normAnswer).filter(Boolean);
  if (!parts.length || !targets.length) return { ok: false, near: false };

  if (parts.some((p) => targets.includes(p))) return { ok: true, near: false };

  // 差一个字才算"差点"；单字不玩这个（太容易蒙）
  const near = parts.some((p) => p.length >= 2 && targets.some((t) => lev(p, t) <= 1));
  return { ok: false, near };
}

/**
 * 看中文写单词。忽略大小写与首尾空格，但**内部空格算数**（ice cream ≠ icecream）。
 * @returns { ok, near } near=true 时界面提示「再试一次」，不算错、不动盒子
 */
export function judgeZh2En(input, term) {
  const a = normTerm(input);
  const b = normTerm(term);
  if (!a || !b) return { ok: false, near: false };
  if (a === b) return { ok: true, near: false };
  // 短词（<=3 个字母）不玩"差点"，否则 is/in、cat/at 全是"差点"
  return { ok: false, near: b.length > 3 && lev(a, b) <= 1 };
}
