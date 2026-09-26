/* 给词库里的单词补音标。
 *
 * 数据来自 ipa-dict：一行是 `单词<Tab>/音标/`。
 *   主库：英式（约 1.3MB，四级/高考的习惯口音）
 *   兜底：美式（约 2.5MB）—— 英式库不全（6.5 万条 vs 12.6 万条），
 *        实测某份 187 词的四级词表英式只覆盖 169 个，缺的都是名词/动词重音不同的词
 *        （apply / research / conduct …），补一次美式就到 100%
 * 两个库都**只在应用里下载一次**，存进 IndexedDB（meta 表），之后完全离线。
 *
 * 内存上刻意不做"全量字典 Map"（十万条在手机上太吃内存）：
 * 只有"需要补的词"进集合，然后一次扫过音标库，找齐了就提前结束。
 *
 * 纯函数（parseDictLine / pickPhonetics）在 Node 里测；
 * 下载与写库在浏览器测试页里测（见 tests/browser/phonetic.test.html）。
 */

import { get, put, putMany } from './db.js';
import { normTerm } from './judge.js';

export const DEFAULT_DICT_URL = 'https://cdn.jsdelivr.net/gh/open-dict-data/ipa-dict@master/data/en_UK.txt';
export const FALLBACK_DICT_URL = 'https://cdn.jsdelivr.net/gh/open-dict-data/ipa-dict@master/data/en_US.txt';

/** 两个库在 meta 表里的键 */
export const DICT_META_KEYS = { primary: 'phoneticDict', fallback: 'phoneticDictFallback' };
/** 兼容老名字（第一版只有英式库） */
export const DICT_META_KEY = DICT_META_KEYS.primary;

/** 允许把音标库地址指到别的镜像（jsDelivr 打不开时用；测试也用它） */
export function dictUrl(kind = 'primary') {
  const fallback = kind === 'fallback';
  try {
    const custom = localStorage.getItem(fallback ? 'vocab.dictUrlFallback' : 'vocab.dictUrl');
    if (custom) return custom;
  } catch {
    /* 隐私模式等取不到 localStorage，就用默认地址 */
  }
  return fallback ? FALLBACK_DICT_URL : DEFAULT_DICT_URL;
}

/** 解析一行：'absorb\t/əbˈzɔːb/' → ['absorb', '/əbˈzɔːb/']；不是音标行就返回 null */
export function parseDictLine(line) {
  const text = String(line ?? '');
  const tab = text.indexOf('\t');
  if (tab <= 0) return null;
  const term = normTerm(text.slice(0, tab));
  if (!term) return null;
  const rest = text.slice(tab + 1).trim();
  if (!rest) return null;
  const m = rest.match(/\/[^/]*\//); // 有多个变体时取第一个
  if (!m) return null;
  const ipa = m[0].trim();
  return ipa.length > 2 ? [term, ipa] : null;
}

/**
 * 一次扫过整个音标库，挑出我们要的词。
 * @param {string} dictText 音标库全文
 * @param {string[]} terms  需要的单词
 * @returns {Map<string, string>} 归一化单词 → 音标（没收录的不会出现在里面）
 */
export function pickPhonetics(dictText, terms) {
  const want = new Set((terms || []).map(normTerm).filter(Boolean));
  const out = new Map();
  if (!want.size) return out;
  for (const line of String(dictText ?? '').split('\n')) {
    if (!line || line.charCodeAt(0) === 35 /* # */) continue;
    const parsed = parseDictLine(line);
    if (!parsed) continue;
    const [term, ipa] = parsed;
    if (want.has(term) && !out.has(term)) {
      out.set(term, ipa);
      if (out.size === want.size) break; // 要的都找到了，不用再扫
    }
  }
  return out;
}

/** 本地缓存的音标库（没有就是 null） */
export async function loadDict(kind = 'primary') {
  const rec = await get('meta', DICT_META_KEYS[kind] || DICT_META_KEYS.primary);
  return rec && rec.value ? rec : null;
}

export async function saveDict(text, source, kind = 'primary') {
  const key = DICT_META_KEYS[kind] || DICT_META_KEYS.primary;
  await put('meta', { key, value: text, source: source || dictUrl(kind), fetchedAt: Date.now() });
}

/** 拿一个库：有缓存就用缓存，没有就下载 */
async function ensureDict(kind, { url, force = false, onProgress } = {}) {
  if (!force) {
    const cached = await loadDict(kind);
    if (cached) return { text: cached.value, downloaded: false };
  }
  const target = url || dictUrl(kind);
  onProgress?.({ phase: 'download', dict: kind, ratio: 0 });
  const text = await downloadDict({ url: target, onProgress: (r) => onProgress?.({ phase: 'download', dict: kind, ratio: r }) });
  await saveDict(text, target, kind);
  return { text, downloaded: true };
}

/** 下载音标库，顺便报进度 */
export async function downloadDict({ url = dictUrl(), onProgress } = {}) {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`下载音标库失败（HTTP ${res.status}）`);
  const total = Number(res.headers.get('Content-Length') || 0);
  if (!res.body || !total) {
    const text = await res.text();
    onProgress?.(1);
    return text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(got / total);
  }
  const buf = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return new TextDecoder('utf-8').decode(buf);
}

/**
 * 给这些词补音标（只补 phonetic 还空着的）。
 * 先用英式库；剩下没找到的再用美式库兜底（两级都查不到才算"未收录"）。
 * @returns {{filled:number, missing:number, total:number, downloaded:boolean, missingWords:string[]}}
 */
export async function fillPhonetics({ words = [], onProgress, url, urlFallback, force = false } = {}) {
  const need = (words || []).filter((w) => w && w.term && !w.phonetic);
  if (!need.length) return { filled: 0, missing: 0, total: 0, downloaded: false, missingWords: [] };

  let pending = [...new Set(need.map((w) => normTerm(w.term)))];
  const found = new Map();
  let downloaded = false;

  for (const kind of ['primary', 'fallback']) {
    if (!pending.length) break;
    const { text, downloaded: dl } = await ensureDict(kind, {
      url: kind === 'fallback' ? urlFallback : url,
      force,
      onProgress
    });
    downloaded = downloaded || dl;
    onProgress?.({ phase: 'match', dict: kind, ratio: 0 });
    const got = pickPhonetics(text, pending);
    for (const [term, ipa] of got) found.set(term, ipa);
    pending = pending.filter((t) => !found.has(t));
  }

  const now = Date.now();
  const rows = [];
  const missingWords = [];
  for (const w of need) {
    const ipa = found.get(normTerm(w.term));
    if (ipa) rows.push({ ...w, phonetic: ipa, updatedAt: now });
    else missingWords.push(normTerm(w.term));
  }
  if (rows.length) await putMany('words', rows);
  if (missingWords.length) await rememberMisses(missingWords);

  return { filled: rows.length, missing: missingWords.length, total: need.length, downloaded, missingWords };
}

const MISS_KEY = 'phoneticMiss';

/** 记住"音标库里查不到"的词 —— 否则按钮会一直显示"还差 N 个"，很烦 */
async function rememberMisses(terms) {
  const rec = (await get('meta', MISS_KEY)) || { key: MISS_KEY, value: [] };
  const set = new Set(rec.value || []);
  for (const t of terms) set.add(t);
  await put('meta', { ...rec, key: MISS_KEY, value: [...set], updatedAt: Date.now() });
}

export async function missList() {
  const rec = await get('meta', MISS_KEY);
  return new Set(rec?.value || []);
}

/** 还差多少个词需要补音标（已经查过、库里确实没有的不算） */
export async function countMissing(words) {
  const miss = await missList();
  return (words || []).filter((w) => w && w.term && !w.phonetic && !miss.has(normTerm(w.term))).length;
}

/** 清掉"查不到"的名单（音标库更新后想再试一次时用） */
export async function forgetMisses() {
  await put('meta', { key: MISS_KEY, value: [], updatedAt: Date.now() });
}
