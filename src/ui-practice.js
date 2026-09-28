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
import { hardDelete, put } from './db.js';
import { judgeEn2Zh, judgeZh2En } from './judge.js';
import { buildQueue, grade, markLevel, newProg } from './srs.js';
import { isSmartId, smartDef, smartWordIds } from './smart.js';
import { loadAll } from './store.js';
import { keepFocusVisible } from './viewport.js';

const DIRS = [
  { key: 'en2zh', label: '英→中' },
  { key: 'zh2en', label: '中→英' },
  { key: 'mix', label: '混合' }
];

const EMPTY_STATS = () => ({ ok: 0, bad: 0, near: 0, nearPass: 0, marked: 0, known: 0, unfamiliar: 0, skipped: 0 });

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
  const smartId = isSmartId(params.smart) ? params.smart : null;
  const mode0 = DIRS.some((d) => d.key === params.dir) ? params.dir : 'en2zh';
  let data = await loadAll();

  // 「过一遍」还是「默写」：智能库（生疏词）默认过一遍 —— 不认识的词本来也打不出来
  const review0 = params.review === '1' || params.mode === 'review' ? true : params.mode === 'quiz' ? false : !!smartId;

  const s = {
    mode: mode0,
    review: review0,
    queue: [],
    i: 0,
    answered: false,
    retried: false,
    nearCounted: false,
    curDir: 'en2zh',
    stats: EMPTY_STATS(),
    ended: false,
    history: [], // 每题作答前的快照，给「上一题」用
    snapTaken: false
  };

  function buildSession() {
    // 智能库（生疏词）：把这批词直接当队列，不管到期没到期、也不限新词数量
    const q = smartId
      ? buildQueue({ words: data.words, progs: data.progs, links: data.links, now: Date.now(), wordIds: smartWordIds(data, smartId) })
      : buildQueue({
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
    s.history = [];
    s.snapTaken = false;
    s.stats = EMPTY_STATS();
  }
  buildSession();

  // ---------------------------------------------------------------- DOM
  const quit = el('button', { className: 'prac-quit', dataset: { testid: 'btn-quit' }, type: 'button', 'aria-label': '退出练习', onclick: () => { location.hash = '#/'; } }, '✕');
  // 「上一题」= 把上一次作答整个撤回去再回到那一题（重新答会重新计分）
  const btnBack = el('button', {
    className: 'prac-quit',
    dataset: { testid: 'btn-back' },
    type: 'button',
    'aria-label': '回退到上一个词（会撤销上一次作答）',
    title: '回退到上一个词（撤销上一次作答）',
    onclick: () => goBack()
  }, '↶');
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
  // 「过一遍」模式：答案直接摊开给你看，不用打字
  const answerLine = el('div', { className: 'prac-answer', dataset: { testid: 'practice-answer' }, hidden: true }, '');
  const feedback = el('div', { className: 'feedback', dataset: { testid: 'feedback' }, hidden: true, role: 'status', 'aria-live': 'polite' }, '');
  const btnForce = el('button', { className: 'ghost', dataset: { testid: 'btn-force-ok' }, type: 'button', hidden: true, onclick: () => forceOk() }, '算我对');
  const btnNext = el('button', { className: 'primary', dataset: { testid: 'btn-next' }, type: 'button', hidden: true, onclick: () => next() }, '下一题');
  const btnSkip = el('button', { className: 'ghost', dataset: { testid: 'btn-skip' }, type: 'button', hidden: true, onclick: () => skipOne() }, '下一个（不标）');

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
  const levelHint = el('div', { className: 'level-hint' }, '');
  const levelRow = el('div', { className: 'level-block' }, [
    el('div', { className: 'level-row' }, [btnUnfamiliar, btnKnown, btnSkip]),
    levelHint
  ]);

  // 模式切换：默写（考自己） ⇄ 过一遍（只看不考，专门用来刷生疏词）
  const modeBtn = el('button', {
    className: 'link-btn',
    dataset: { testid: 'btn-toggle-mode' },
    type: 'button',
    onclick: () => setReview(!s.review)
  }, '');
  const swipeTip = el('div', { className: 'swipe-tip', dataset: { testid: 'swipe-tip' }, hidden: true }, '← 左滑算生疏 · 右滑算熟记 →');
  const modeRow = el('div', { className: 'mode-row' }, [swipeTip, modeBtn]);

  const card = el('div', { className: 'card prac-card' }, [
    prompt,
    hint,
    answerLine,
    input,
    submit,
    feedback,
    el('div', { className: 'fb-actions' }, [btnForce, btnNext]),
    levelRow
  ]);
  // 滑动时浮出来的提示（绿=熟记 / 红=生疏）
  const swipeBadge = el('div', { className: 'swipe-badge', dataset: { testid: 'swipe-badge' }, hidden: true }, '');
  const cardWrap = el('div', { className: 'prac-wrap' }, [card, swipeBadge]);

  const summary = el('div', { className: 'card session-summary', dataset: { testid: 'session-summary' }, hidden: true }, [
    el('div', { className: 'summary-text', dataset: { testid: 'summary-text' } }, ''),
    el('div', { className: 'row-2' }, [
      el('button', { className: 'ghost', dataset: { testid: 'btn-home' }, type: 'button', onclick: () => { location.hash = '#/'; } }, '回首页'),
      el('button', { className: 'primary', dataset: { testid: 'btn-again' }, type: 'button', onclick: () => again() }, '再来一轮')
    ])
  ]);

  const top = el('div', { className: 'prac-top' }, [quit, btnBack, progress, dirSwitch]);
  view.replaceChildren(top, modeRow, cardWrap, summary);

  // ---------------------------------------------------------------- 逻辑
  const answerText = (w, dir) => (dir === 'en2zh' ? w.meanings.join('；') : w.term);

  /** 切「默写 / 过一遍」。只改地址栏，不触发 hashchange（否则这一轮就白练了） */
  function setReview(on, { render = true } = {}) {
    s.review = !!on;
    input.hidden = s.review;
    submit.hidden = s.review;
    dirSwitch.hidden = s.review; // 过一遍时词和释义同时看得见，方向没意义
    answerLine.hidden = !s.review;
    btnSkip.hidden = !s.review;
    swipeTip.hidden = !s.review;
    card.classList.toggle('swipeable', s.review);
    if (!s.review) swipeBadge.hidden = true;
    modeBtn.textContent = s.review ? '→ 换成默写（考自己）' : '→ 过一遍（只看不考，适合刷生疏词）';
    levelHint.textContent = s.review
      ? '看清了就点：熟记 → 60 天后再见；生疏 → 10 分钟后再见'
      : '自己定：熟记 → 60 天后再见；生疏 → 10 分钟后再见';
    const qs = new URLSearchParams();
    if (libId) qs.set('lib', libId);
    if (smartId) qs.set('smart', smartId);
    if (s.mode !== 'en2zh') qs.set('dir', s.mode);
    qs.set('mode', s.review ? 'review' : 'quiz');
    history.replaceState(null, '', `#/practice?${qs}`);
    if (render && !s.answered && s.queue.length) renderQuestion();
  }

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
    // 上一次滑动可能被打断，清掉残留的位移
    card.classList.remove('swiping', 'snapping');
    card.style.transform = '';
    card.style.opacity = '';
    swipeBadge.hidden = true;
    s.snapTaken = false;
    syncBackBtn();
    if (s.review) {
      // 过一遍：词、音标、释义同时摊开，只需要点「熟记 / 生疏」
      prompt.textContent = w.term;
      hint.textContent = [w.phonetic, w.pos].filter(Boolean).join(' · ');
      answerLine.textContent = (w.meanings || []).join('；');
    } else {
      prompt.textContent = s.curDir === 'en2zh' ? w.term : w.meanings.join('；');
      hint.textContent = [s.curDir === 'en2zh' ? w.phonetic : '', w.pos].filter(Boolean).join(' · ');
      answerLine.textContent = '';
    }
    // 提示里是英文词的时候用词头字体（字典式衬线）；中文释义保持系统无衬线
    prompt.classList.toggle('is-word', s.review || s.curDir === 'en2zh');
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
    // 内容换了一张"卡"：轻微上浮淡入，给一点"下一张从下面来"的空间感。
    // 只动 prompt / answerLine（不动输入框，免得打字时画面在抖）。
    popIn(prompt, 6);
    if (!answerLine.hidden) popIn(answerLine, 4);
    if (!s.review) input.focus();
  }

  /** 一次性的进场动效：WAAPI，只动 transform/opacity；减弱动效时直接跳过 */
  function popIn(node, dy = 6) {
    if (!node || typeof node.animate !== 'function') return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ms = Number((getComputedStyle(document.documentElement).getPropertyValue('--dur-ui') || '').replace('ms', '')) || 170;
    node.animate(
      [{ opacity: 0, transform: `translateY(${dy}px)` }, { opacity: 1, transform: 'none' }],
      { duration: ms, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    );
  }

  // ---------------------------------------------------------------- 过一遍模式的手势
  // 横向拖动卡片：跟手 → 松手按"距离或速度"决定飞出去还是弹回来（可打断，不是 keyframes 重放）
  const SWIPE_THRESHOLD = 96; // px
  const SWIPE_VELOCITY = 0.5; // px/ms
  let drag = null;
  const canSwipe = () => s.review && !s.ended && !card.hidden;

  function resetCard() {
    card.classList.remove('swiping');
    card.classList.add('snapping');
    card.style.transform = '';
    card.style.opacity = '';
    swipeBadge.hidden = true;
    setTimeout(() => card.classList.remove('snapping'), 260);
  }

  function onDown(e) {
    if (!canSwipe() || (e.button != null && e.button !== 0)) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, t0: performance.now(), active: false };
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.active) {
      // 先分清是"横向滑动"还是"纵向滚动/轻点"
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
      drag.active = true;
      try {
        card.setPointerCapture(e.pointerId);
      } catch {
        /* 某些环境不支持，忽略 */
      }
      card.classList.add('swiping');
    }
    drag.dx = dx;
    card.style.transform = `translateX(${dx}px)`;
    const p = Math.min(1, Math.abs(dx) / SWIPE_THRESHOLD);
    swipeBadge.hidden = false;
    swipeBadge.dataset.dir = dx > 0 ? 'known' : 'unfamiliar';
    swipeBadge.textContent = dx > 0 ? '熟记' : '生疏';
    swipeBadge.style.opacity = String(p);
  }

  async function onUp(e) {
    if (!drag || (e && e.pointerId != null && e.pointerId !== drag.id)) return;
    const { dx, t0, active } = drag;
    drag = null;
    if (!active) return; // 只是轻点，让按钮自己处理
    // 速度：采样间隔太短（<8ms）就不算 —— 否则一次极快的轻微拖动会被误判成"甩出去"
    const dt = Math.max(1, performance.now() - t0);
    const v = dt >= 8 ? dx / dt : 0;
    const flew = Math.abs(dx) > SWIPE_THRESHOLD || (Math.abs(dx) > 24 && Math.abs(v) > SWIPE_VELOCITY);
    if (!flew) return resetCard();
    const dir = dx > 0 ? 'known' : 'unfamiliar';
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) {
      card.classList.remove('swiping');
      card.classList.add('snapping');
      card.style.transform = `translateX(${dx > 0 ? 120 : -120}%)`;
      card.style.opacity = '0';
      // 等多久看的是同一个时长令牌，不写魔法数字（改了 --dur-ui 这里跟着变）
      const ms = Number((getComputedStyle(document.documentElement).getPropertyValue('--dur-ui') || '').replace('ms', '')) || 170;
      await new Promise((r) => setTimeout(r, ms + 30));
    }
    await markAndNext(dir); // 会渲染下一题
    card.classList.remove('snapping');
    card.style.transform = '';
    card.style.opacity = '';
    swipeBadge.hidden = true;
  }

  card.addEventListener('pointerdown', onDown);
  card.addEventListener('pointermove', onMove);
  card.addEventListener('pointerup', onUp);
  card.addEventListener('pointercancel', onUp);

  /** 过一遍模式里的"不标，直接下一个" */
  function skipOne() {
    if (s.ended) return;
    s.stats.skipped++;
    s.answered = true;
    next();
  }

  function showNothing() {
    card.hidden = true;
    summary.hidden = true;
    const smart = smartDef(smartId);
    const isSmart = !!smart;
    view.replaceChildren(top, modeRow, el('div', { className: 'card empty', dataset: { testid: 'nothing-due' } }, [
      el('div', { className: 'empty-title' }, isSmart ? `「${smart.name}」里还没有词` : '今天没有要练的'),
      el('div', { className: 'empty-sub' },
        isSmart ? '练习时点一下「生疏」，这个词就会自动进到这个库，下次就能专项练它。' : '复习都做完了，也没有新词。明早再来，或者去导入更多词表。'),
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

  /** 「上一题」按钮的可用状态：没答过任何题就点不动 */
  function syncBackBtn() {
    btnBack.disabled = s.history.length === 0;
    btnBack.setAttribute('aria-disabled', String(btnBack.disabled));
  }

  /**
   * 「上一题」：把上一次作答整个撤回去，回到那一题重新来。
   * 撤销是"数据级"的：那次作答写的 prog 记录会被还原（原本没有记录的，就彻底删掉，
   * 这样那个词明天还算新词），统计也一并还原。
   */
  async function goBack() {
    const snap = s.history.pop();
    if (!snap) return;
    if (snap.hadProg && snap.prog) {
      await put('prog', { ...snap.prog });
      data.progs[snap.wordId] = { ...snap.prog };
    } else {
      await hardDelete('prog', snap.wordId);
      delete data.progs[snap.wordId];
    }
    s.stats = { ...snap.stats };
    s.i = snap.i;
    s.answered = false;
    s.retried = false;
    s.snapTaken = false;
    s.ended = false;
    renderQuestion();
  }

  /** 作答前先留个快照，「上一题」就是拿它把那次作答整个撤回去 */
  function beforeAnswer() {
    const w = s.queue[s.i];
    if (!w || s.snapTaken) return;
    s.snapTaken = true;
    s.history.push({
      i: s.i,
      wordId: w.id,
      hadProg: !!data.progs[w.id],
      prog: data.progs[w.id] ? { ...data.progs[w.id] } : null,
      stats: { ...s.stats }
    });
    syncBackBtn();
  }

  async function finish(correct) {
    const w = s.queue[s.i];
    beforeAnswer();
    s.answered = true;
    if (correct) s.stats.ok++;
    else s.stats.bad++;
    const before = data.progs[w.id];
    await writeResult(w, correct);
    const after = data.progs[w.id];
    if (correct) {
      // 一路答对爬到"已掌握"会自动移出生疏库，值得说一声
      if (after?.level === 'known' && after.levelFrom === 'mastered' && before?.level !== 'known') {
        showFeedback('true', '对了 ✓ 已掌握，移出生疏词库');
      } else {
        showFeedback('true', '对了 ✓');
      }
    } else {
      showFeedback('false', `正确答案：${answerText(w, s.curDir)}　·　已加入生疏词库`);
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
    beforeAnswer();
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
    const textEl = summary.querySelector('[data-testid="summary-text"]');
    if (s.review) {
      // 过一遍模式的成绩单：不考对错，只看你把多少词归到了哪边
      const total = s.stats.known + s.stats.unfamiliar + s.stats.skipped;
      textEl.textContent =
        `过了一遍 ${total} 个词 · 熟记 ${s.stats.known} · 生疏 ${s.stats.unfamiliar}` +
        (s.stats.skipped ? ` · 跳过 ${s.stats.skipped}` : '') +
        (s.stats.unfamiliar ? '（生疏的还在这个库里，下次再来一遍）' : '');
      return;
    }
    // "练了 N 题"把"自己标级"的也算进去，否则标完的题会显得凭空少掉
    const total = s.stats.ok + s.stats.bad + s.stats.marked;
    textEl.textContent =
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

  // 键盘：回车判定/下一题，Esc 退出，1/2 快速定级（只在没在打字时生效）
  keepFocusVisible(input); // 手机上聚焦后，等键盘动画结束把输入框滚进可视区
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter();
    } else if (e.key === 'Escape') {
      location.hash = '#/';
    }
  });
  view.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      location.hash = '#/';
      return;
    }
    if (e.key !== '1' && e.key !== '2') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    // 正在输入框里打字就不抢键（默写模式下"1"是答案的一部分）
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (s.ended || card.hidden || summary.hidden === false) return;
    e.preventDefault();
    markAndNext(e.key === '1' ? 'unfamiliar' : 'known');
  });

  syncBackBtn(); // 一开始"上一题"是点不动的
  if (!s.queue.length) showNothing();
  else {
    setReview(s.review, { render: false }); // 先把模式对应的界面元素摆好
    renderQuestion();
  }
}
