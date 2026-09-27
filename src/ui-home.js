/* 界面 A：库列表（首页）
 *
 * 顶部是今天的量 + 开始练习；下面每个词库一行（词数 / 待复习 / 掌握进度）；
 * 底部是导入词表与新建词库。没有词库时给引导，而不是空白。
 */

import { $, el } from './app.js';
import { put } from './db.js';
import { countMissing, fillPhonetics } from './phonetic.js';
import { buildQueue } from './srs.js';
import { DEFAULT_NEW_LIMIT, PALETTE, libStats, loadAll, nextLibOrder } from './store.js';
import { SMART_LIBS, smartCount } from './smart.js';
import { APP_VERSION } from './version.js';

export async function renderHome() {
  const view = $('#view-home');
  if (!view) return;
  const now = Date.now();
  const data = await loadAll();
  const queue = buildQueue({
    words: data.words,
    progs: data.progs,
    links: data.links,
    libIds: null,
    now,
    newLimit: data.newLimit ?? DEFAULT_NEW_LIMIT
  });

  const dueToday = queue.review.length;
  const newToday = queue.fresh.length;
  const todo = dueToday + newToday;

  // ---------------------------------------------------------------- 顶部
  const head = el('div', { className: 'card home-head' }, [
    el('div', { className: 'home-title' }, '今天'),
    el('div', { className: 'home-stats' }, [
      el('span', { dataset: { testid: 'today-review' } }, `待复习 ${dueToday}`),
      el('span', { className: 'dot-sep' }, '·'),
      el('span', { dataset: { testid: 'today-new' } }, `新词 ${newToday}`)
    ]),
    el(
      'button',
      {
        className: 'primary',
        dataset: { testid: 'btn-start' },
        type: 'button',
        disabled: todo === 0,
        onclick: () => {
          location.hash = '#/practice';
        }
      },
      todo === 0 ? '今天的都练完了 🎉' : `开始练习（${todo}）`
    )
  ]);

  // ---------------------------------------------------------------- 词库列表
  const list = el('section', { className: 'libs' });

  // 智能库（生疏词）放在最上面：练习时标「生疏」的词会自动进来，标「熟记」自动移出
  for (const smart of SMART_LIBS) {
    const n = smartCount(data, smart.id);
    // 生疏词永远露个脸（哪怕是 0，也是个提示）；熟记词有货才显示
    if (n === 0 && smart.level !== 'unfamiliar') continue;
    list.append(
      el('div', { className: 'card lib-row smart-row', dataset: { testid: 'smart-row', smart: smart.id } }, [
        el('span', { className: 'lib-dot', style: { background: smart.color } }),
        el('div', { className: 'lib-body' }, [
          el(
            'button',
            {
              className: 'lib-name',
              type: 'button',
              title: `专项练习「${smart.name}」`,
              onclick: () => {
                location.hash = `#/practice?smart=${encodeURIComponent(smart.id)}`;
              }
            },
            [smart.name, el('span', { className: 'smart-tag' }, '自动')]
          ),
          el('div', { className: 'lib-meta', dataset: { testid: 'smart-count' } },
            n ? `${n} 个词 · 点名字直接专项练习` : '还没有——练习时点「生疏」就会自动进来'),
          el('div', { className: 'lib-meta smart-hint' }, smart.hint)
        ]),
        el(
          'button',
          {
            className: 'lib-more',
            dataset: { testid: 'btn-smart-words' },
            type: 'button',
            'aria-label': `看「${smart.name}」的词条`,
            onclick: () => {
              location.hash = `#/word?smart=${encodeURIComponent(smart.id)}`;
            }
          },
          '›'
        )
      ])
    );
  }

  if (!data.libs.length) {
    list.append(
      el('div', { className: 'card empty', dataset: { testid: 'empty-state' } }, [
        el('div', { className: 'empty-title' }, '还没有词库'),
        el('div', { className: 'empty-sub' }, '先导入一份词表（Excel 里选中单词和释义两列，Ctrl+C 粘进来），或者自己新建一个词库。')
      ])
    );
  }

  for (const lib of data.libs) {
    const s = libStats(data, lib.id, now);
    list.append(
      el('div', { className: 'card lib-row', dataset: { testid: 'lib-row', lib: lib.id } }, [
        el('span', { className: 'lib-dot', style: { background: lib.color || PALETTE[0] } }),
        el('div', { className: 'lib-body' }, [
          el(
            'button',
            {
              className: 'lib-name',
              type: 'button',
              title: `练「${lib.name}」`,
              onclick: () => {
                location.hash = `#/practice?lib=${encodeURIComponent(lib.id)}`;
              }
            },
            lib.name
          ),
          el('div', { className: 'lib-meta' }, `共 ${s.total} 词 · 待复习 ${s.due} · 已掌握 ${s.mastered}`),
          el('div', { className: 'lib-bar', dataset: { testid: 'lib-progress' } }, [
            el('i', { style: { width: `${s.percent}%`, background: lib.color || PALETTE[0] } })
          ])
        ]),
        el(
          'button',
          {
            className: 'lib-more',
            dataset: { testid: 'btn-lib-words' },
            type: 'button',
            'aria-label': `看「${lib.name}」的词条`,
            onclick: () => {
              location.hash = `#/word?lib=${encodeURIComponent(lib.id)}`;
            }
          },
          '›'
        )
      ])
    );
  }

  // ---------------------------------------------------------------- 底部
  const foot = el('div', { className: 'home-foot' }, [
    el(
      'button',
      {
        className: 'ghost',
        dataset: { testid: 'btn-import' },
        type: 'button',
        onclick: () => {
          location.hash = '#/import';
        }
      },
      '导入词表'
    ),
    el(
      'button',
      {
        className: 'ghost',
        dataset: { testid: 'btn-newlib' },
        type: 'button',
        onclick: (e) => openNewLibForm(e.currentTarget, data)
      },
      '新建词库'
    ),
    el(
      'button',
      {
        className: 'ghost',
        dataset: { testid: 'btn-settings' },
        type: 'button',
        onclick: () => {
          location.hash = '#/settings';
        }
      },
      '设置 · ' + APP_VERSION
    )
  ]);

  // 有词缺音标时，底部多一个入口（补完自己就消失）
  const missing = await countMissing(data.words);
  const phoneticBtn = missing
    ? el('button', {
        className: 'ghost home-phonetic',
        dataset: { testid: 'btn-home-phonetic' },
        type: 'button',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            await fillPhonetics({
              words: data.words,
              onProgress: (p) => {
                const which = p.dict === 'fallback' ? '美式兜底' : '英式';
                btn.textContent = p.phase === 'download' ? `下载${which}音标库 ${Math.round((p.ratio || 0) * 100)}%` : '匹配中…';
              }
            });
          } catch (err) {
            btn.textContent = `补齐失败：${err && err.message ? err.message : err}`;
            btn.disabled = false;
            return;
          }
          await renderHome();
        }
      }, `补齐音标（还差 ${missing} 个）`)
    : null;

  // ⚠️ 不能直接 replaceChildren(head, list, foot, phoneticBtn)：phoneticBtn 可能是 null，
  //    而 replaceChildren(null) 会在页面上渲染出字符串 "null"
  view.replaceChildren(...[head, list, foot, phoneticBtn].filter(Boolean));
}

/** 内联的新建词库表单（不用浏览器 prompt：难看、手机上体验也差） */
function openNewLibForm(anchor, data) {
  const existing = anchor.parentElement.querySelector('[data-testid="newlib-form"]');
  if (existing) {
    existing.remove();
    return;
  }
  let color = PALETTE[data.libs.length % PALETTE.length];

  const input = el('input', { name: 'name', type: 'text', placeholder: '词库名字，例如：四级 Test 2', maxlength: '40', 'aria-label': '新词库名字' });
  const swatches = PALETTE.map((c, i) =>
    el('button', {
      className: 'color',
      type: 'button',
      'aria-label': `颜色 ${i + 1}`,
      'aria-pressed': String(c === color),
      style: { background: c },
      onclick: (e) => {
        color = c;
        for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
      }
    })
  );

  const form = el('form', { className: 'card newlib-form', dataset: { testid: 'newlib-form' } }, [
    input,
    el('div', { className: 'colors' }, swatches),
    el('div', { className: 'row-2' }, [
      el('button', { className: 'ghost', type: 'button', onclick: () => form.remove() }, '取消'),
      el('button', { className: 'primary', dataset: { testid: 'btn-newlib-ok' }, type: 'submit' }, '创建')
    ])
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }
    const now = Date.now();
    await put('libs', {
      id: crypto.randomUUID(),
      name,
      color,
      order: nextLibOrder(data.libs),
      createdAt: now,
      updatedAt: now
    });
    await renderHome();
  });

  anchor.parentElement.append(form);
  input.focus();
}
