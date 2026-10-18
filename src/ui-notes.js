/* 笔记 / 提纲（v53）：挂在词库上的一段可阅读内容。
 *
 * 为什么要它：有些词库不只是背单词，还要放"作文思路 / 提纲"。
 * 笔记**不进练习**（不进待复习、不参与音标补齐），所以它是独立的一张表（db.js 的 notes）。
 *
 * 三个界面：
 *   #/note?id=…           阅读区（正文按 notes.js 的 Markdown 子集渲染）
 *   #/note?id=…&edit=1    编辑（标题 + 正文，等宽 textarea，粘贴提纲用）
 *   #/note?lib=…&new=1    在某个词库里新建
 * 词库页里那张「笔记 / 提纲」卡片由 notesCard() 提供。
 */

import { $, el } from './app.js';
import { all, get, put, softDelete } from './db.js';
import { icon } from './icons.js';
import { mdToHtml } from './notes.js';
import { loadAll } from './store.js';
import { showToast } from './toast.js';

/** 某个词库下的笔记（活着、按 order 再按时间排） */
export async function notesOf(libId) {
  const rows = (await all('notes')).filter((n) => !n.deleted && n.libId === libId);
  return rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

const fmtDate = (ms) => {
  if (!ms) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(ms));
};

/** 纯文本摘要：把 Markdown 记号去掉，只留一段话 */
function summary(body, n = 60) {
  const t = String(body || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/**
 * 词库页里那张卡：标题 + 摘要 + 日期，点进阅读区。
 * @param {object} data loadAll() 的结果
 * @param {string} libId
 * @param {Array} notes 已经读好的笔记
 */
export function notesCard(libId, notes) {
  if (!notes.length) {
    return el('div', { className: 'card notes-card', dataset: { testid: 'notes-card' } }, [
      el('div', { className: 'notes-head' }, [el('span', { className: 'notes-title' }, '笔记 / 提纲')]),
      el('button', {
        className: 'ghost notes-new',
        dataset: { testid: 'btn-new-note' },
        type: 'button',
        onclick: () => { location.hash = `#/note?lib=${encodeURIComponent(libId)}&new=1`; }
      }, [icon('plus', { size: 16 }), el('span', {}, '新建笔记')])
    ]);
  }
  const rows = notes.map((n) =>
    el('button', {
      className: 'note-row',
      dataset: { testid: 'note-row', note: n.id },
      type: 'button',
      onclick: () => { location.hash = `#/note?id=${encodeURIComponent(n.id)}`; }
    }, [
      el('span', { className: 'note-row-title' }, n.title || '（未命名）'),
      el('span', { className: 'note-row-sub' }, summary(n.body)),
      el('span', { className: 'note-row-date' }, fmtDate(n.updatedAt || n.createdAt))
    ])
  );
  return el('div', { className: 'card notes-card', dataset: { testid: 'notes-card' } }, [
    el('div', { className: 'notes-head' }, [
      el('span', { className: 'notes-title' }, `笔记 / 提纲`),
      el('span', { className: 'notes-count', dataset: { testid: 'notes-count' } }, `${notes.length} 篇`),
      el('button', {
        className: 'ghost notes-new',
        dataset: { testid: 'btn-new-note' },
        type: 'button',
        onclick: () => { location.hash = `#/note?lib=${encodeURIComponent(libId)}&new=1`; }
      }, [icon('plus', { size: 16 })])
    ]),
    ...rows
  ]);
}

/** 阅读区 / 编辑区 / 新建 */
export async function renderNote(params) {
  const view = $('#view-note');
  if (!view) return;
  const data = await loadAll();
  const id = params.id || null;
  const editing = params.edit === '1' || params.new === '1' || !id;
  let note = id ? await get('notes', id) : null;
  if (note && note.deleted) note = null;
  const libId = note?.libId || params.lib || data.libs[0]?.id || null;
  const lib = data.libs.find((l) => l.id === libId) || null;
  const backHash = libId ? `#/word?lib=${encodeURIComponent(libId)}` : '#/';

  if (editing) {
    const title = el('input', {
      className: 'field note-title-input',
      dataset: { testid: 'note-title' },
      type: 'text',
      value: note?.title || '',
      placeholder: '标题，例如：机器人进校园 · 作文提纲',
      maxlength: '80',
      'aria-label': '笔记标题'
    });
    const body = el('textarea', {
      className: 'field note-body-input',
      dataset: { testid: 'note-body' },
      rows: '18',
      placeholder: '把提纲粘进来。支持 # 标题、- 列表、1. 有序、**加粗**、```代码块```、|表格|',
      'aria-label': '笔记正文'
    });
    body.value = note?.body || '';
    const save = el('button', { className: 'primary', dataset: { testid: 'btn-note-save' }, type: 'submit' }, '保存');
    const form = el('form', { className: 'note-editor' }, [
      title,
      body,
      el('div', { className: 'row-2' }, [
        el('button', { className: 'ghost', type: 'button', onclick: () => { location.hash = backHash; } }, '取消'),
        save
      ])
    ]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = title.value.trim();
      if (!t) {
        title.focus();
        return;
      }
      const now = Date.now();
      const next = {
        id: note?.id || crypto.randomUUID(),
        libId,
        title: t,
        body: body.value,
        order: note?.order ?? now,
        createdAt: note?.createdAt ?? now,
        updatedAt: now
      };
      await put('notes', next);
      location.hash = `#/note?id=${encodeURIComponent(next.id)}`;
    });
    view.replaceChildren(
      el('div', { className: 'word-head' }, [
        el('button', {
          className: 'prac-quit',
          type: 'button',
          'aria-label': '返回',
          onclick: () => { location.hash = backHash; }
        }, [icon('chevronLeft', { size: 20 })]),
        el('h2', { className: 'page-title' }, note ? '编辑笔记' : '新建笔记'),
        lib ? el('span', { className: 'note-lib' }, lib.name) : null
      ].filter(Boolean)),
      el('div', { className: 'card note-editor-card' }, [form])
    );
    title.focus();
    return;
  }

  // 阅读区
  const md = el('div', { className: 'md-body', dataset: { testid: 'note-body-rendered' } });
  md.innerHTML = mdToHtml(note.body);
  view.replaceChildren(
    el('div', { className: 'word-head' }, [
      el('button', {
        className: 'prac-quit',
        type: 'button',
        'aria-label': '返回',
        onclick: () => { location.hash = backHash; }
      }, [icon('chevronLeft', { size: 20 })]),
      el('h2', { className: 'page-title note-page-title' }, note.title),
      el('button', {
        className: 'ghost note-edit-btn',
        dataset: { testid: 'btn-note-edit' },
        type: 'button',
        onclick: () => { location.hash = `#/note?id=${encodeURIComponent(note.id)}&edit=1`; }
      }, '编辑')
    ]),
    el('div', { className: 'card note-read' }, [
      el('div', { className: 'note-meta' }, [
        lib ? lib.name : '',
        fmtDate(note.updatedAt || note.createdAt)
      ].filter(Boolean).join(' · ')),
      md
    ]),
    el('button', {
      className: 'ghost note-del',
      dataset: { testid: 'btn-note-delete' },
      type: 'button',
      onclick: async () => {
        await softDelete('notes', note.id);
        showToast(`已删除「${note.title}」`, {
          kind: 'ok',
          action: {
            label: '撤销',
            onClick: async () => {
              const row = await get('notes', note.id);
              if (row) await put('notes', { ...row, deleted: false, updatedAt: Date.now() });
              location.hash = `#/note?id=${encodeURIComponent(note.id)}`;
            }
          }
        });
        location.hash = backHash;
      }
    }, '删除这篇笔记')
  );
}
