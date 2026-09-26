/* 界面 B：练习（核心）
 *
 * 一次一个词，上方是提示（英→中显示单词，中→英显示释义），下面输入框，回车判定。
 * 判定规则都在 judge.js 里，这里只管"什么时候写库、界面给什么反馈"：
 *   - 判对        → 绿条，写库（盒子升一级）
 *   - 英→中 差点   → 黄条 + 「算我对」按钮，由用户定夺；点了才写库（按对算）
 *   - 中→英 差点   → 黄条「再试一次」，清空输入框，**不写库、不算错**；第二次才严格判
 *   - 判错        → 红条 + 公布正确答案，写库（回盒子 1）
 */

import { $, el } from './app.js';
import { put } from './db.js';
import { judgeEn2Zh, judgeZh2En } from './judge.js';
import { buildQueue, grade, markLevel, newProg } from './srs.js';
import { loadAll } from './store.js';

const DIRS = [
  { key: 'en2zh', label: '英→中' },
  { key: 'zh2en', label: '中→英' },
  { key: 'mix', label: '混合' }
];

const EMPTY_STATS = () => ({ ok: 0, bad: 0, near: 0, nearPass: 0, marked: 0, known: 0, unfamiliar: 0 });

const hashStr = (s) => {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
};

/** 混合模式下，同一个词永远用同一个方向（不随机，免得同一个词每次不一样） */
const dirForWord = (wordId, mode) => (mode === 'mix' ? (hashStr(wordId) % 2 ? 'zh2en' : 'en2zh') : mode);

export async function renderPractice(params = {}) {
  const view = $('#view-practice');
  if (!view) return;

  const libId = params.lib || null;
  const mode0 = DIRS.some((d) => d.key === params.dir) ? params.dir : 'en2zh';
  let data = await loadAll();

  const s = {
    mode: mode0,
    queue: [],
    i: 0,
    answered: false,
    retried: false,
    nearCounted: false,
    curDir: 'en2zh',
    stats: EMPTY_STATS(),
    ended: false
  };

  function buildSession() {
    const q = buildQueue({
      words: data.words,
      progs: data.progs,
      links: data.links,
      libIds: libId ? [libId] : null,
      now: Date.now(),
      newLimit: data.newLimit
    });
    s.queue = [...q.review, ...q.fresh].map((id) => data.wordsById.get(id)).filter(Boolean);
    s.i = 0;
    s.answered = false;
    s.retried = false;
    s.nearCounted = false;
    s.ended = false;
    s.stats = EMPTY_STATS();
  }
  buildSession();

  // ---------------------------------------------------------------- DOM
  const quit = el('button', { className: 'prac-quit', dataset: { testid: 'btn-quit' }, type: 'button', 'aria-label': '退出练习', onclick: () => { location.hash = '#/'; } }, '✕');
  const progress = el('span', { className: 'prac-progress', dataset: { testid: 'progress-text' } }, '');
  const dirSwitch = el('div', { className: 'dir-switch', dataset: { testid: 'dir-switch' }, role: 'group', 'aria-label': '练习方向' },
    DIRS.map((d) =>
      el('button', {
        type: 'button',
        dataset: { dir: d.key },
        'aria-pressed': String(d.key === s.mode),
        onclick: (e) => setMode(d.key, e.currentTarget)
      }, d.label)
    )
  );

  const prompt = el('div', { className: 'prac-prompt', dataset: { testid: 'practice-prompt' } }, '');
  const hint = el('div', { className: 'prac-hint', dataset: { testid: 'practice-hint' } }, '');
  const input = el('input', {
    className: 'prac-input',
    dataset: { testid: 'practice-input' },
    type: 'text',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    enterkeyhint: 'done',
    'aria-label': '答案',
    placeholder: '写出答案'
  });
  const submit = el('button', { className: 'primary', dataset: { testid: 'btn-submit' }, type: 'button', onclick: () => onEnter() }, '检查');
  const feedback = el('div', { className: 'feedback', dataset: { testid: 'feedback' }, hidden: true, role: 'status', 'aria-live': 'polite' }, '');
  const btnForce = el('button', { className: 'ghost', dataset: { testid: 'btn-force-ok' }, type: 'button', hidden: true, onclick: () => forceOk() }, '算我对');
  const btnNext = el('button', { className: 'primary', dataset: { testid: 'btn-next' }, type: 'button', hidden: true, onclick: () => next() }, '下一题');

  // 抽查时的自我判断：熟记 / 生疏（点了就自动进下一题）
  const btnUnfamiliar = el('button', {
    className: 'ghost lvl lvl-unfamiliar',
    dataset: { testid: 'btn-level-unfamiliar' },
    type: 'button',
    onclick: () => markAndNext('unfamiliar')
  }, '生疏');
  const btnKnown = el('button', {
    className: 'ghost lvl lvl-known',
    dataset: { testid: 'btn-level-known' },
    type: 'button',
    onclick: () => markAndNext('known')
  }, '熟记');
  const levelRow = el('div', { className: 'level-block' }, [
    el('div', { className: 'level-row' }, [btnUnfamiliar, btnKnown]),
    el('div', { className: 'level-hint' }, '自己定：熟记 → 60 天后再见；生疏 → 10 分钟后再见')
  ]);

  const card = el('div', { className: 'card prac-card' }, [
    prompt,
    hint,
    input,
    submit,
    feedback,
    el('div', { className: 'fb-actions' }, [btnForce, btnNext]),
    levelRow
  ]);

  const summary = el('div', { className: 'card session-summary', dataset: { testid: 'session-summary' }, hidden: true }, [
    el('div', { className: 'summary-text', dataset: { testid: 'summary-text' } }, ''),
    el('div', { className: 'row-2' }, [
      el('button', { className: 'ghost', dataset: { testid: 'btn-home' }, type: 'button', onclick: () => { location.hash = '#/'; } }, '回首页'),
      el('button', { className: 'primary', dataset: { testid: 'btn-again' }, type: 'button', onclick: () => again() }, '再来一轮')
    ])
  ]);

  const top = el('div', { className: 'prac-top' }, [quit, progress, dirSwitch]);
  view.replaceChildren(top, card, summary);

  // ---------------------------------------------------------------- 逻辑
  const answerText = (w, dir) => (dir === 'en2zh' ? w.meanings.join('；') : w.term);

  function showFeedback(kind, text) {
    feedback.hidden = false;
    feedback.dataset.ok = kind;
    feedback.textContent = text;
  }

  function setMode(mode, btn) {
    s.mode = mode;
    for (const b of dirSwitch.children) b.setAttribute('aria-pressed', String(b.dataset.dir === mode));
    // 只改地址栏，不触发 hashchange（否则整个界面会重建、这一轮就白练了）
    const qs = new URLSearchParams();
    if (libId) qs.set('lib', libId);
    if (mode !== 'en2zh') qs.set('dir', mode);
    history.replaceState(null, '', `#/practice${qs.toString() ? `?${qs}` : ''}`);
    if (!s.answered && s.queue.length) renderQuestion();
  }

  function renderQuestion() {
    const w = s.queue[s.i];
    if (!w) return showNothing();
    s.answered = false;
    s.retried = false;
    s.nearCounted = false;
    s.curDir = dirForWord(w.id, s.mode);
    prompt.textContent = s.curDir === 'en2zh' ? w.term : w.meanings.join('；');
    hint.textContent = [s.curDir === 'en2zh' ? w.phonetic : '', w.pos].filter(Boolean).join(' · ');
    input.value = '';
    input.placeholder = s.curDir === 'en2zh' ? '写出中文意思' : '写出英文单词';
    input.disabled = false;
    feedback.hidden = true;
    delete feedback.dataset.ok;
    feedback.textContent = '';
    btnNext.hidden = true;
    btnForce.hidden = true;
    btnNext.textContent = s.i + 1 < s.queue.length ? '下一题' : '看小结';
    progress.textContent = `第 ${s.i + 1}/${s.queue.length}`;
    card.hidden = false;
    summary.hidden = true;
    input.focus();
  }

  function showNothing() {
    card.hidden = true;
    summary.hidden = true;
    view.replaceChildren(top, el('div', { className: 'card empty', dataset: { testid: 'nothing-due' } }, [
      el('div', { className: 'empty-title' }, '今天没有要练的'),
      el('div', { className: 'empty-sub' }, '复习都做完了，也没有新词。明早再来，或者去导入更多词表。'),
      el('button', { className: 'ghost', type: 'button', style: { marginTop: '12px' }, onclick: () => { location.hash = '#/'; } }, '回首页')
    ]));
  }

  async function writeResult(word, correct) {
    const now = Date.now();
    const prev = data.progs[word.id];
    const next = grade(prev || newProg(word.id, now), correct, { now, dir: s.curDir });
    await put('prog', next);
    data.progs[word.id] = next;
  }

  async function finish(correct) {
    const w = s.queue[s.i];
    s.answered = true;
    if (correct) s.stats.ok++;
    else s.stats.bad++;
    await writeResult(w, correct);
    if (correct) {
      showFeedback('true', '对了 ✓');
    } else {
      showFeedback('false', `正确答案：${answerText(w, s.curDir)}`);
    }
    btnForce.hidden = true;
    btnNext.hidden = false;
    btnNext.textContent = s.i + 1 < s.queue.length ? '下一题' : '看小结';
    btnNext.focus();
  }

  function forceOk() {
    if (s.answered) return;
    s.stats.nearPass++;
    btnForce.hidden = true;
    finish(true);
  }

  /**
   * 手动定级：熟记 → 盒子 6（60 天）；生疏 → 盒子 1（10 分钟）。
   * 就算这题已经答过（盒子已按对错变过），手动判断**优先覆盖**。
   * 点完直接进下一题。
   */
  async function markAndNext(level) {
    const w = s.queue[s.i];
    if (!w || s.ended) return;
    const now = Date.now();
    const next_prog = markLevel(data.progs[w.id] || newProg(w.id, now), level, { now });
    await put('prog', next_prog);
    data.progs[w.id] = next_prog;
    s.stats.marked++;
    if (level === 'known') s.stats.known++;
    else s.stats.unfamiliar++;
    s.answered = true; // 已经处理过这题，回车不应该再判一次
    next();
  }

  async function onEnter() {
    if (s.answered) return next();
    const w = s.queue[s.i];
    if (!w) return;
    const raw = input.value;
    if (!raw.trim()) {
      input.focus();
      return;
    }
    const res = s.curDir === 'en2zh' ? judgeEn2Zh(raw, w.meanings) : judgeZh2En(raw, w.term);

    if (res.ok) return finish(true);

    if (res.near) {
      if (!s.nearCounted) {
        s.stats.near++;
        s.nearCounted = true;
      }
      if (s.curDir === 'zh2en' && !s.retried) {
        // 差一个字母：先让人再打一遍（不算错、不写库）
        s.retried = true;
        input.value = '';
        showFeedback('retry', '差一点点，再试一次');
        input.focus();
        return;
      }
      if (s.curDir === 'en2zh') {
        showFeedback('near', `差不多对：${answerText(w, s.curDir)}　—　算你答对了吗？`);
        btnForce.hidden = false;
        return;
      }
    }

    return finish(false);
  }

  function next() {
    if (s.i + 1 < s.queue.length) {
      s.i++;
      renderQuestion();
    } else {
      showSummary();
    }
  }

  function showSummary() {
    s.ended = true;
    card.hidden = true;
    summary.hidden = false;
    // "练了 N 题"把"自己标级"的也算进去，否则标完的题会显得凭空少掉
    const total = s.stats.ok + s.stats.bad + s.stats.marked;
    summary.querySelector('[data-testid="summary-text"]').textContent =
      `练了 ${total} 题 · 对 ${s.stats.ok} · 错 ${s.stats.bad} · 差点 ${s.stats.near}` +
      (s.stats.nearPass ? `（其中 ${s.stats.nearPass} 个算你对）` : '') +
      (s.stats.marked ? ` · 手动标了 ${s.stats.marked} 个（熟记 ${s.stats.known} / 生疏 ${s.stats.unfamiliar}）` : '');
  }

  async function again() {
    data = await loadAll();
    buildSession();
    if (!s.queue.length) return showNothing();
    renderQuestion();
  }

  // 键盘：回车判定/下一题，Esc 退出
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter();
    } else if (e.key === 'Escape') {
      location.hash = '#/';
    }
  });
  view.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') location.hash = '#/';
  });

  if (!s.queue.length) showNothing();
  else renderQuestion();
}
