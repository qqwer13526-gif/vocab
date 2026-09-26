/* 界面 D：词条（列表 + 编辑）
 *
 * 列表：某个词库的词（带搜索、盒子标记）；编辑：改释义/音标/例句/笔记、换库、重置进度、删除。
 * 路由：#/word?lib=xxx（列表）  #/word?id=yyy&lib=xxx（编辑）
 */

import { $, el } from './app.js';
import { byIndex, put, softDelete } from './db.js';
import { normTerm } from './judge.js';
import { libWordIds, loadAll, nextLibOrder, PALETTE } from './store.js';

export async function renderWord(params = {}) {
  const view = $('#view-word');
  if (!view) return;
  const data = await loadAll();
  if (params.id) return renderEditor(view, params, data);
  return renderList(view, params, data);
}

// ---------------------------------------------------------------- 列表
function renderList(view, params, data) {
  const libId = params.lib || null;
  const lib = libId ? data.libs.find((l) => l.id === libId) : null;
  const ids = libId ? libWordIds(data, libId) : data.words.map((w) => w.id);
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

  function paint() {
    const query = search.value.trim();
    const nq = normTerm(query);
    const filtered = nq
      ? words.filter((w) => w.termNorm.includes(nq) || w.meanings.join(' ').toLowerCase().includes(query.toLowerCase()))
      : words;

    count.textContent = `${filtered.length} 个词${query ? `（共 ${words.length}）` : ''}`;
    list.replaceChildren();
    if (!filtered.length) {
      list.append(
        el('div', { className: 'card empty', dataset: { testid: 'word-empty' } }, [
          el('div', { className: 'empty-title' }, '没有匹配的词条'),
          el('div', { className: 'empty-sub' }, words.length ? '换个词试试，或者清空搜索框。' : '这个词库还是空的，去导入一份词表吧。')
        ])
      );
      return;
    }
    for (const w of filtered) {
      const p = data.progs[w.id];
      list.append(
        el('button', {
          className: 'card word-row',
          type: 'button',
          dataset: { testid: 'word-row', id: w.id },
          onclick: () => {
            location.hash = `#/word?id=${encodeURIComponent(w.id)}${libId ? `&lib=${encodeURIComponent(libId)}` : ''}`;
          }
        }, [
          el('div', { className: 'word-row-main' }, [
            el('span', { className: 'word-term' }, w.term),
            el('span', { className: 'word-mean' }, w.meanings.join('；'))
          ]),
          el('span', {
            className: 'box-pill',
            dataset: { testid: 'box-pill', box: String(p ? p.box : 0) }
          }, p ? `盒 ${p.box}` : '新')
        ])
      );
    }
  }

  search.addEventListener('input', paint);

  view.replaceChildren(
    el('div', { className: 'word-head' }, [
      el('button', { className: 'prac-quit', type: 'button', 'aria-label': '回首页', onclick: () => { location.hash = '#/'; } }, '‹'),
      el('h2', { className: 'page-title' }, lib ? lib.name : '全部词条')
    ]),
    el('div', { className: 'card word-tools' }, [search, count]),
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

  const term = el('h2', { className: 'page-title', dataset: { testid: 'word-term' } }, w.term);
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
  const reset = el('button', { className: 'ghost', dataset: { testid: 'btn-reset-progress' }, type: 'button', onclick: () => doReset() }, '重置进度');
  const del = el('button', { className: 'ghost danger', dataset: { testid: 'btn-delete' }, type: 'button', onclick: () => doDelete() }, '删除');

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
