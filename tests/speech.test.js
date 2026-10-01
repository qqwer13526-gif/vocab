/* 朗读模块（src/speech.js）的纯逻辑测试。
 *
 * 这里测的是"喂给系统 TTS 的东西对不对"（文本 / 语言 / 语速 / 音色挑选 / 降级），
 * 真机出不出声只有手机能验（见 README「朗读单词」那节）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// ---- 最小浏览器环境（模块只在函数内部读 window / localStorage，所以这里按需造）----
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear()
};

class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.lang = '';
    this.rate = 1;
    this.volume = 1;
    this.voice = null;
  }
}

let spoken = [];
globalThis.window = {
  SpeechSynthesisUtterance: FakeUtterance,
  speechSynthesis: {
    cancel: () => spoken.push({ cancel: true }),
    speak: (u) => spoken.push({ text: u.text, lang: u.lang, rate: u.rate, volume: u.volume, voice: u.voice?.name || null }),
    getVoices: () => [
      { name: 'Daniel', lang: 'en-GB' },
      { name: 'Samantha', lang: 'en-US' },
      { name: 'Ting-Ting', lang: 'zh-CN' }
    ],
    speaking: false
  }
};

const { ACCENT_LABELS, RATE_LABELS, saveSpeechSettings, speakWord, speechSettings, speechSupported, unlockSpeech, voices } =
  await import('../src/speech.js');

const reset = () => {
  spoken = [];
  localStorage.clear();
};

test('默认设置：开、英式、正常语速、不自动朗读', () => {
  reset();
  assert.deepEqual(speechSettings(), { on: true, accent: 'en-GB', rate: 1, auto: false });
});

test('存了坏数据也退回默认值（坏一个值不能把发音弄哑）', () => {
  reset();
  localStorage.setItem('vocab.speech', '{ 这不是 JSON');
  assert.deepEqual(speechSettings(), { on: true, accent: 'en-GB', rate: 1, auto: false });

  localStorage.setItem('vocab.speech', JSON.stringify({ accent: 'fr-FR', rate: 9 }));
  assert.equal(speechSettings().accent, 'en-GB', '不认识的口音退回英式');
  assert.equal(speechSettings().rate, 1, '不认识的语速退回正常');
  assert.equal(speechSettings().on, true, '没写 on 就是开');
});

test('保存设置是"合并"，不是覆盖', () => {
  reset();
  saveSpeechSettings({ accent: 'en-US' });
  saveSpeechSettings({ auto: true });
  assert.deepEqual(speechSettings(), { on: true, accent: 'en-US', rate: 1, auto: true });
});

test('speakWord：先掐掉上一条，再把"单词 + 语言 + 语速"交给系统', () => {
  reset();
  assert.equal(speakWord('absorb'), true);
  assert.deepEqual(spoken[0], { cancel: true }, '先 cancel，连点不排队');
  assert.deepEqual(
    { text: spoken[1].text, lang: spoken[1].lang, rate: spoken[1].rate },
    { text: 'absorb', lang: 'en-GB', rate: 1 }
  );
  assert.equal(spoken[1].voice, 'Daniel', '英式要挑到 en-GB 的音色');
});

test('speakWord：换口音会挑对应音色（美式 → Samantha）', () => {
  reset();
  speakWord('absent', { accent: 'en-US' });
  assert.equal(spoken[1].lang, 'en-US');
  assert.equal(spoken[1].voice, 'Samantha');
});

test('speakWord：空词不发声（返回 false，也不留 cancel）', () => {
  reset();
  assert.equal(speakWord('   '), false);
  assert.equal(speakWord(null), false);
  assert.deepEqual(spoken, []);
});

test('speakWord：只读单词本身（不加例句、不加中文）', () => {
  reset();
  speakWord('amid');
  assert.equal(spoken[1].text, 'amid');
  assert.ok(!/We camped|在…之中/.test(spoken[1].text));
});

test('unlockSpeech：只在第一次塞一个空朗读（iOS 解锁惯性）', () => {
  reset();
  unlockSpeech();
  unlockSpeech();
  unlockSpeech();
  const unlocks = spoken.filter((s) => s.text === ' ');
  assert.equal(unlocks.length, 1);
  assert.equal(unlocks[0].volume, 0, '解锁那次要静音');
});

test('voices()：能按语言过滤，且不含无关语言', () => {
  assert.equal(voices().length, 3);
  assert.deepEqual(voices('en-GB').map((v) => v.name), ['Daniel'], 'en-GB 只要 en-GB');
  assert.deepEqual(voices('en').map((v) => v.name), ['Daniel', 'Samantha'], '只给 en 时两种英文都算');
});

test('设备只有美式音色时，要英式也照样出声（退回同语言的音色）', () => {
  reset();
  const synth = globalThis.window.speechSynthesis;
  const kept = synth.getVoices;
  synth.getVoices = () => [{ name: 'Samantha', lang: 'en-US' }];
  try {
    speakWord('amid', { accent: 'en-GB' });
    assert.equal(spoken[1].lang, 'en-GB', '语言还按用户选的英式');
    assert.equal(spoken[1].voice, 'Samantha', '音色退回同语言（美式）的那个');
  } finally {
    synth.getVoices = kept;
  }
});

test('不支持 TTS 的环境：speechSupported=false、speakWord 返回 false、voices 空', () => {
  const kept = globalThis.window.speechSynthesis;
  globalThis.window.speechSynthesis = undefined;
  try {
    assert.equal(speechSupported(), false);
    assert.equal(speakWord('absorb'), false);
    assert.deepEqual(voices(), []);
  } finally {
    globalThis.window.speechSynthesis = kept;
  }
});

test('标签表与实现里的取值一一对应', () => {
  assert.deepEqual(Object.keys(ACCENT_LABELS).sort(), ['en-GB', 'en-US']);
  // 注意：JS 对象里"整数样"的键会排到前面（'1' 会跑到 '0.85' 前面），所以比排序后的集合
  assert.deepEqual(Object.keys(RATE_LABELS).sort(), ['0.85', '1', '1.15']);
  assert.equal(RATE_LABELS['0.85'], '慢');
  assert.equal(RATE_LABELS['1'], '正常');
  assert.equal(RATE_LABELS['1.15'], '快');
});
