/* 朗读单词（系统 TTS）。
 *
 * 为什么用 Web Speech API 而不是音频文件：
 *   - **零字节**：不下载任何 mp3，和"启动要快"的目标不冲突
 *   - **离线可用**：iOS / Android 的系统语音都在本机，飞行模式照样响
 *   - 所有目标平台都有：iOS Safari / 主屏幕应用、Android Chrome、桌面 Edge / Chrome
 *
 * iOS 的两个坑（真机行为，代码里都处理了）：
 *   1. 第一次朗读必须发生在**用户手势**里 → 我们点喇叭本来就是点击；"自动朗读"要靠
 *      unlock()：你在页面上第一次点任何地方时塞一个空朗读，之后程序化调用才出声
 *   2. 侧边静音键在部分 iOS 版本下会压掉系统朗读（设置页里写了提示，真机行为只能实测）
 *
 * 只读单词。例句、中文释义故意不读（用户 2026-10-01 明确要求"只读单词"）。
 */

const KEY = 'vocab.speech';
const ACCENTS = { 'en-GB': '英式', 'en-US': '美式' };
const RATES = { 0.85: '慢', 1: '正常', 1.15: '快' };

export const ACCENT_LABELS = ACCENTS;
export const RATE_LABELS = RATES;

const DEFAULTS = { on: true, accent: 'en-GB', rate: 1, auto: false };

export function speechSupported() {
  return typeof window !== 'undefined' && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function';
}

/** 读设置（坏数据一律退回默认值，绝不让一个坏值把发音弄哑） */
export function speechSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      on: raw.on !== false,
      accent: ACCENTS[raw.accent] ? raw.accent : DEFAULTS.accent,
      rate: RATES[raw.rate] ? Number(raw.rate) : DEFAULTS.rate,
      auto: raw.auto === true
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSpeechSettings(patch) {
  const next = { ...speechSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式不让写就算了 */
  }
  return next;
}

/** 本机有哪些音色（设置页要显示"有没有对应口音的音色"）。
 *  传 'en-GB' 就只要 en-GB；传 'en' 才把英式美式都算上（前缀匹配，可预测）。 */
export function voices(lang = null) {
  if (!speechSupported()) return [];
  const all = window.speechSynthesis.getVoices() || [];
  if (!lang) return all;
  const want = lang.toLowerCase();
  return all.filter((v) => (v.lang || '').toLowerCase().startsWith(want));
}

let unlocked = false;

/**
 * iOS 解锁：第一次用户手势里说一个空串，之后程序化（自动朗读）才会出声。
 * 挂一次就够，重复调用无副作用。
 */
export function unlockSpeech() {
  if (unlocked || !speechSupported()) return;
  unlocked = true;
  try {
    const u = new window.SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    /* 忽略 */
  }
}

/**
 * 读一个单词。
 * @param term 单词（英文）
 * @param opts.accent 'en-GB' | 'en-US'；不给就用设置里的
 * @param opts.rate   语速；不给就用设置里的
 */
export function speakWord(term, opts = {}) {
  const word = String(term || '').trim();
  if (!word || !speechSupported()) return false;
  const s = speechSettings();
  const accent = opts.accent || s.accent;
  const rate = Number(opts.rate || s.rate) || 1;
  try {
    // 连点两个词时不要排队念旧的：直接掐掉上一条
    window.speechSynthesis.cancel();
    const u = new window.SpeechSynthesisUtterance(word);
    u.lang = accent;
    u.rate = rate;
    // 挑一个真的匹配这个口音的音色；只有别的英文音色（比如设备只装了美式）也凑合用它；
    // 一个英文音色都没有就让系统按 lang 自己选
    const pool = voices(accent);
    const exact = pool.find((v) => (v.lang || '').toLowerCase() === accent.toLowerCase()) || pool[0];
    const fallback = exact || voices(accent.split('-')[0])[0];
    if (fallback) u.voice = fallback;
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

/** 测试与设置页用：现在有没有在念 */
export function speaking() {
  return speechSupported() ? !!window.speechSynthesis.speaking : false;
}
