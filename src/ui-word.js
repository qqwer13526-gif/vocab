/* 界面 D：词条（列表 + 编辑）
 *
 * 列表：某个词库的词（带搜索、盒子标记、熟记/生疏筛选）；编辑：改释义/音标/例句/笔记、换库、重置进度、删除。
 * 路由：#/word?lib=xxx      #/word?id=yyy&lib=xxx      #/word?smart=smart:unfamiliar（智能库）
 */

import { $, el } from './app.js';
import { confirmThen } from './confirm.js';
import { all, byIndex, put, softDelete } from './db.js';
import { normTerm } from './judge.js';
import { countMissing, fillPhonetics } from './phonetic.js';
import { LEVELS, LEVEL_LABEL } from './srs.js';
import { isSmartId, smartDef, smartWordIds } from './smart.js';
import { libWordIds, loadAll, nextLibOrder, PALETTE } from './store.js';
import { showToast } from './toast.js';

export async function renderWord(params = {}) {
  const view = $('#view-word');
  if (!view) return;
  const data = await loadAll();
  if (params.id) return renderEditor(view, params, data);
  return renderList(view, params, data);
}

// ---------------------------------------------------------------- 列表
async function renderList(view, params, data) {
  const smart = isSmartId(params.smart) ? smartDef(params.smart) : null;
  const libId = smart ? null : params.lib || null;
  const lib = libId ? data.libs.find((l) => l.id === libId) : null;
  const ids = smart ? smartWordIds(data, smart.id) : libId ? libWordIds(data, libId) : data.words.map((w) => w.id);
  const words = ids
    .map((id) => data.wordsById.get(id))
    .filter(Boolean)
    .sort((a, b) => a.termNorm.localeCompare(b.termNorm));

  const search = el('input', {
    className: 'word-search',
    dataset: { testid: 'word-search' },
    type: 'search',
    placeholder: '搜单词或中文释义',
    autocomplete: 'off',
    'aria-label': '搜索词条'
  });
  const list = el('div', { className: 'word-list' });
  const count = el('div', { className: 'word-count' });
  const status = el('div', { className: 'word-status', dataset: { testid: 'word-status' } }, '');

  // 熟记 / 生疏 的分布与筛选
  const levelOf = (w) => data.progs[w.id]?.level || null;
  const counts = { all: words.length, known: 0, unfamiliar: 0, none: 0 };
  for (const w of words) {
    const lv = levelOf(w);
    if (lv === 'known') counts.known++;
    else if (lv === 'unfamiliar') counts.unfamiliar++;
    else counts.none++;
  }
  let levelFilter = smart
    ? smart.level
    : params.level === 'known' || params.level === 'unfamiliar' || params.level === 'none'
      ? params.level
      : 'all';

  // 分批渲染用：一次 60 行，滚到底自动续
  const PAGE_SIZE = 60;
  let rendered = 0;
  let current = [];
  let sentinel = null;
  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) appendBatch();
      }, { rootMargin: '200px' })
    : null;
  const chips = el('div', { className: 'level-filter', dataset: { testid: 'level-filter' } }, [
    chip('all', `全部 ${counts.all}`),
    chip('known', `熟记 ${counts.known}`),
    chip('unfamiliar', `生疏 ${counts.unfamiliar}`),
    chip('none', `未标 ${counts.none}`)
  ]);

  function chip(key, label) {
    return el('button', {
      className: 'chip',
      type: 'button',
      dataset: { level: key },
      'aria-pressed': String(key === levelFilter),
      onclick: (e) => {
        levelFilter = key;
        for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b.dataset.level === key));
        // 筛选项进 URL，刷新/回退都还在
        const qs = new URLSearchParams();
        if (libId) qs.set('lib', libId);
        if (key !== 'all') qs.set('level', key);
        history.replaceState(null, '', `#/word${qs.toString() ? `?${qs}` : ''}`);
        paint();
      }
    }, label);
  }

  // 还差多少个词没音标 → 显示"补齐音标"按钮（已经查过、库里确实没有的不再算）
  const missing = await countMissing(words);
  const tools = el('div', { className: 'word-tools-row' });
  if (missing > 0) {
    const btn = el('button', {
      className: 'ghost',
      dataset: { testid: 'btn-fill-phonetic' },
      type: 'button',
      onclick: () => doFill(btn)
    }, `补齐音标（还差 ${missing} 个）`);
    tools.append(btn);
  }

  async function doFill(btn) {
    btn.disabled = true;
    status.dataset.kind = '';
    try {
      const res = await fillPhonetics({
        words: await all('words'),
        onProgress: (p) => {
          const which = p.dict === 'fallback' ? '美式兜底' : '英式';
          btn.textContent = p.phase === 'download' ? `下载${which}音标库 ${Math.round((p.ratio || 0) * 100)}%` : '匹配中…';
        }
      });
      status.dataset.kind = 'ok';
      status.textContent =
        (res.filled ? `已补 ${res.filled} 个音标` : '没有可补的') + (res.missing ? `；${res.missing} 个音标库里没有收录` : '');
      await renderList(view, params, await loadAll()); // 重画：音标会立刻显示出来
    } catch (err) {
      status.dataset.kind = 'bad';
      btn.textContent = `补齐音标（还差 ${await countMissing(await all('words'))} 个）`;
      status.textContent = `补齐失败：${err && err.message ? err.message : err}`;
    } finally {
      btn.disabled = false;
    }
  }

  function paint() {
    const query = search.value.trim();
    const nq = normTerm(query);
    const searched = nq
      ? words.filter((w) => w.termNorm.includes(nq) || w.meanings.join(' ').toLowerCase().includes(query.toLowerCase()))
      : words;
    const filtered = levelFilter === 'all' ? searched : searched.filter((w) => (levelOf(w) || 'none') === levelFilter);

    count.textContent = `${filtered.length} 个词${query || levelFilter !== 'all' ? `（共 ${words.length}）` : ''}`;
    list.replaceChildren();
    rendered = 0;
    current = filtered;
    if (!filtered.length) {
      list.append(
        el('div', { className: 'card empty', dataset: { testid: 'word-empty' } }, [
          el('div', { className: 'empty-title' }, '没有匹配的词条'),
          el('div', { className: 'empty-sub' }, words.length ? '换个词试试，或者清空搜索/筛选。' : '这个词库还是空的，去导入一份词表吧。')
        ])
      );
      return;
    }
    appendBatch();
  }

  /** 一次只画一屏多一点（60 行）；滚到底自动接着画 —— 几百个词也不会一次建上千个节点 */
  function appendBatch() {
    const slice = current.slice(rendered, rendered + PAGE_SIZE);
    for (const w of slice) list.append(rowFor(w));
    rendered += slice.length;

    if (sentinel) {
      observer?.unobserve(sentinel);
      sentinel.remove();
      sentinel = null;
    }
    if (rendered < current.length) {
      const left = current.length - rendered;
      sentinel = el('button', {
        className: 'ghost list-more',
        type: 'button',
        dataset: { testid: 'btn-list-more' }
      }, `还有 ${left} 个 · 继续加载`);
      sentinel.addEventListener('click', appendBatch);
      list.append(sentinel);
      observer?.observe(sentinel);
    }
  }

  function rowFor(w) {
    const p = data.progs[w.id];
    const lv = levelOf(w);
    return el('button', {
      className: 'card word-row',
      type: 'button',
      dataset: { testid: 'word-row', id: w.id },
      onclick: () => {
        location.hash = `#/word?id=${encodeURIComponent(w.id)}${libId ? `&lib=${encodeURIComponent(libId)}` : ''}`;
      }
    }, [
      el('div', { className: 'word-row-main' }, [
        el('span', { className: 'word-term' }, w.term),
        w.phonetic ? el('span', { className: 'word-phonetic', dataset: { testid: 'word-phonetic' } }, w.phonetic) : null,
        el('span', { className: 'word-mean' }, w.meanings.join('；'))
      ]),
      el('div', { className: 'word-row-side' }, [
        lv
          ? el('span', {
              className: 'level-pill',
              dataset: { testid: 'level-pill', level: lv }
            }, LEVEL_LABEL[lv] || lv)
          : null,
        el('span', {
          className: 'box-pill',
          dataset: { testid: 'box-pill', box: String(p ? p.box : 0) }
        }, p ? `盒 ${p.box}` : '新')
      ])
    ]);
  }

  search.addEventListener('input', paint);

  view.replaceChildren(
    el('div', { className: 'word-head' }, [
      el('button', { className: 'prac-quit', type: 'button', 'aria-label': '回首页', onclick: () => { location.hash = '#/'; } }, '‹'),
      el('h2', { className: 'page-title' }, smart ? smart.name : lib ? lib.name : '全部词条')
    ]),
    el('div', { className: 'card word-tools' }, [search, count, chips, tools, status]),
    list
  );
  paint();
}

// ---------------------------------------------------------------- 编辑
async function renderEditor(view, params, data) {
  const w = data.wordsById.get(params.id);
  const libId = params.lib || null;
  const backHash = `#/word${libId ? `?lib=${encodeURIComponent(libId)}` : ''}`;

  if (!w) {
    view.replaceChildren(
      el('div', { className: 'card empty' }, [
        el('div', { className: 'empty-title' }, '词条不存在或已被删除'),
        el('button', { className: 'ghost', type: 'button', style: { marginTop: '12px' }, onclick: () => { location.hash = backHash; } }, '回词条列表')
      ])
    );
    return;
  }

  const links = (await byIndex('links', 'by_word', w.id)).filter((l) => !l.deleted);
  const myLibs = new Set(links.map((l) => l.libId));

  const term = el('h2', { className: 'page-title is-word', dataset: { testid: 'word-term' } }, w.term);
  const phonetic = el('input', { className: 'field', dataset: { testid: 'word-phonetic' }, type: 'text', value: w.phonetic || '', placeholder: '音标', 'aria-label': '音标' });
  const pos = el('input', { className: 'field', dataset: { testid: 'word-pos' }, type: 'text', value: w.pos || '', placeholder: '词性，例如 v.', 'aria-label': '词性' });
  const meanings = el('textarea', { className: 'field', dataset: { testid: 'word-meanings' }, rows: '3', 'aria-label': '释义（一行一条）' });
  meanings.value = (w.meanings || []).join('\n');
  const example = el('input', { className: 'field', dataset: { testid: 'word-example' }, type: 'text', value: w.example || '', placeholder: '例句 / 常用搭配', 'aria-label': '例句' });
  const note = el('textarea', { className: 'field', dataset: { testid: 'word-note' }, rows: '2', 'aria-label': '笔记', placeholder: '笔记' });
  note.value = w.note || '';

  const libChecks = el('div', { className: 'lib-checks' },
    data.libs.map((lib) =>
      el('label', { className: 'lib-check-label' }, [
        el('input', {
          type: 'checkbox',
          dataset: { testid: 'word-lib-check' },
          value: lib.id,
          checked: myLibs.has(lib.id)
        }),
        el('span', { className: 'lib-check-dot', style: { background: lib.color || PALETTE[0] } }),
        lib.name
      ])
    )
  );

  const status = el('div', { className: 'word-status', dataset: { testid: 'word-status' } }, '');
  const say = (text, kind = 'ok') => {
    status.textContent = text;
    status.dataset.kind = kind;
  };

  const save = el('button', { className: 'primary', dataset: { testid: 'btn-save' }, type: 'button', onclick: () => doSave() }, '保存');
  // 删除 / 重置进度都是"会丢东西"的操作：点一下只武装，再点一下才真的执行
  const reset = el('button', { className: 'ghost', dataset: { testid: 'btn-reset-progress' }, type: 'button' }, '重置进度');
  confirmThen(reset, () => doReset(), { label: '确认重置？', kind: 'warn' });
  const del = el('button', { className: 'ghost danger', dataset: { testid: 'btn-delete' }, type: 'button' }, '删除');
  confirmThen(del, () => doDelete(), { label: '确认删除？' });

  async function doSave() {
    const list = meanings.value.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!list.length) return say('至少要留一条释义', 'bad');
    const now = Date.now();
    await put('words', {
      ...w,
      phonetic: phonetic.value.trim(),
      pos: pos.value.trim(),
      meanings: list,
      example: example.value.trim(),
      note: note.value.trim(),
      updatedAt: now
    });
    await setLibs(w.id, libChecks.querySelectorAll('input:checked'), now);
    w.meanings = list;
    say('已保存', 'ok');
  }

  /** 换库：取消的软删除（记录留着，第二阶段同步要用），新增的直接写，重复导入天然幂等 */
  async function setLibs(wordId, checkedNodes, now) {
    const keep = new Set([...checkedNodes].map((n) => n.value));
    const existing = new Map((await byIndex('links', 'by_word', wordId)).map((l) => [l.libId, l]));
    for (const lib of keep) {
      const prev = existing.get(lib);
      if (!prev || prev.deleted) {
        await put('links', { id: `${wordId}|${lib}`, wordId, libId: lib, addedAt: prev?.addedAt ?? now, updatedAt: now });
      }
    }
    for (const [lib, prev] of existing) {
      if (!keep.has(lib) && !prev.deleted) await softDelete('links', prev.id, now);
    }
  }

  async function doReset() {
    const now = Date.now();
    await put('prog', { wordId: w.id, box: 1, streak: 0, lapses: 0, dueAt: now, lastDir: null, updatedAt: now });
    say('进度已重置，这个词会重新出现', 'ok');
  }

  async function doDelete() {
    await softDelete('words', w.id, Date.now());
    // 界面马上跳回列表，就地提示看不见 → 用提示条说一声
    showToast(`已删除「${w.term}」（记录还留着，可以从备份恢复）`, { kind: 'ok' });
    location.hash = backHash;
  }

  view.replaceChildren(
    el('div', { className: 'word-head' }, [
      el('button', { className: 'prac-quit', type: 'button', 'aria-label': '回词条列表', onclick: () => { location.hash = backHash; } }, '‹'),
      term
    ]),
    el('div', { className: 'card word-edit', dataset: { testid: 'word-edit' } }, [
      el('div', { className: 'field-label' }, '释义（一行一条）'),
      meanings,
      el('div', { className: 'grid-2' }, [phonetic, pos]),
      el('div', { className: 'field-label' }, '例句 / 常用搭配'),
      example,
      el('div', { className: 'field-label' }, '笔记'),
      note,
      el('div', { className: 'field-label' }, '属于哪些词库'),
      libChecks,
      status,
      save,
      el('div', { className: 'row-2' }, [reset, del])
    ])
  );
}
