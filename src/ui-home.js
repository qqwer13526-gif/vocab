/* 界面 A：词库列表（首页）
 *
 * v18 的结构（用户定的）：首页**只有词库**，不放"今天"大卡片、不放导入/新建/设置按钮 ——
 * 导入与设置搬到底部悬浮胶囊里。
 *
 *   左/上：固定入口  —— 总词库（所有词，删库也删不掉它）+ 自动收集（生疏词 / 熟记词）
 *   右/下：我的词库  —— 每个库一行（点名字练这个库，⋯ 里有 看词条 / 重命名 / 删除）
 *                      末尾一行虚线「＋ 新建词库」
 *
 * 数据模型本来就是"词是全局的、词库只是标签"（words + links 多对多），所以：
 *   - 总词库不需要存任何东西，永远 = 所有还活着的词
 *   - 删库只删"库 + 归属关系"，词一个都不删
 */

import { $, el } from './app.js';
import { put } from './db.js';
import { confirmThen } from './confirm.js';
import { icon } from './icons.js';
import { SMART_LIBS, smartCount } from './smart.js';
import {
  DEFAULT_NEW_LIMIT,
  PALETTE,
  allWordIds,
  deleteLibCascade,
  libStats,
  loadAll,
  nextLibOrder,
  statsFor,
  undoDeleteLibCascade
} from './store.js';
import { showToast } from './toast.js';

export async function renderHome() {
  const view = $('#view-home');
  if (!view) return;
  const now = Date.now();
  const data = await loadAll();

  // ---------------------------------------------------------------- 固定入口
  const pinned = el('section', { className: 'pinned' });

  // 总词库：所有导入过的词。库被删了词也在这儿，所以它是"词不会丢"的兜底视图。
  const all = statsFor(allWordIds(data), data, now);
  pinned.append(
    libRow({
      testid: 'all-lib-row',
      name: '总词库',
      color: 'var(--accent)',
      stats: all,
      badge: '全部词',
      onPractice: () => {
        location.hash = '#/practice';
      },
      menu: [
        { testid: 'btn-all-menu-words', icon: 'list', label: '看全部词条', run: () => { location.hash = '#/word'; } }
      ]
    })
  );

  // 自动收集（智能库）：练习时标「生疏」自动进来，标「熟记」自动移出。
  // v21 起不再写说明句（"练习时点「生疏」就会自动进来"这种），只留数字 —— 和词库行统一。
  const smartRows = [];
  for (const smart of SMART_LIBS) {
    const n = smartCount(data, smart.id);
    // 生疏词永远露个脸（哪怕是 0，也是个提示）；熟记词有货才显示
    if (n === 0 && smart.level !== 'unfamiliar') continue;
    smartRows.push(
      libRow({
        testid: 'smart-row',
        smart: smart.id,
        name: smart.name,
        color: smart.color,
        badge: '自动',
        metaTestid: 'smart-count',
        meta: n ? `${n} 个词` : '还没有',
        onPractice: () => {
          location.hash = `#/practice?smart=${encodeURIComponent(smart.id)}`;
        },
        // 智能库只有一个次要动作（看词条），就直接给箭头，不套一层菜单
        trailing: {
          testid: 'btn-smart-words',
          label: `看「${smart.name}」的词条`,
          icon: 'chevronRight',
          run: () => {
            location.hash = `#/word?smart=${encodeURIComponent(smart.id)}`;
          }
        }
      })
    );
  }
  if (smartRows.length) {
    pinned.append(
      el('section', { className: 'card smart-strip', dataset: { testid: 'smart-strip' } }, [
        el('div', { className: 'strip-head' }, '自动收集'),
        ...smartRows
      ])
    );
  }

  // ---------------------------------------------------------------- 我的词库
  const list = el('section', { className: 'libs' });

  for (const lib of data.libs) {
    list.append(
      libRow({
        testid: 'lib-row',
        lib: lib.id,
        name: lib.name,
        color: lib.color || PALETTE[0],
        stats: libStats(data, lib.id, now),
        onPractice: () => {
          location.hash = `#/practice?lib=${encodeURIComponent(lib.id)}`;
        },
        menu: [
          { testid: 'btn-lib-menu-words', icon: 'list', label: '看词条', run: () => { location.hash = `#/word?lib=${encodeURIComponent(lib.id)}`; } },
          { testid: 'btn-lib-menu-rename', icon: 'pencil', label: '重命名', run: (menu) => renameLib(menu, lib) },
          {
            testid: 'btn-lib-menu-delete',
            icon: 'trash',
            label: '删除词库',
            danger: true,
            // 两步确认由 toggleMenu 在"建元素时"装上（见那里的注释）
            confirm: async () => {
              const snap = await deleteLibCascade(data, lib.id);
              closeMenu();
              // 正在看/正在练这个库的话，路径已经失效 → 回首页
              if (location.hash.includes(encodeURIComponent(lib.id))) location.hash = '#/';
              showToast(`已删除「${lib.name}」，${snap.linkIds.length} 个词还在总词库里`, {
                kind: 'ok',
                action: {
                  label: '撤销',
                  onClick: async () => {
                    await undoDeleteLibCascade(snap);
                    await renderHome();
                  }
                }
              });
              await renderHome();
            }
          }
        ]
      })
    );
  }

  if (!data.libs.length) {
    list.append(
      el('div', { className: 'card empty', dataset: { testid: 'empty-state' } }, [
        el('div', { className: 'empty-title' }, '还没有词库'),
        el('div', { className: 'empty-sub' }, '先导入一份词表（Excel 里选中单词和释义两列，Ctrl+C 粘进来），词会先进「总词库」，再按你的分类放进来。'),
        el('button', {
          className: 'primary',
          dataset: { testid: 'btn-empty-import' },
          type: 'button',
          style: { marginTop: '12px' },
          onclick: () => {
            location.hash = '#/import';
          }
        }, '去导入词表')
      ])
    );
  }

  // 新建词库：列表末尾的一行虚线（属于"词库列表"的一部分，不破坏"首页只有词库"）
  list.append(
    el('button', {
      className: 'newlib-row',
      dataset: { testid: 'btn-newlib' },
      type: 'button',
      onclick: (e) => openNewLibForm(e.currentTarget, data)
    }, [icon('plus', { size: 18 }), el('span', {}, '新建词库')])
  );

  view.replaceChildren(pinned, list);

  // ---------------------------------------------------------------- 行内操作

  /** 一行的 DOM：总词库 / 词库 / 智能库共用一套（保证等高、等距、同圆角）。
   *  点名字 = 练这一组；右侧要么是 ⋯ 菜单（多个动作），要么是一个箭头（只有一个动作）。
   *  ◎ meta 给了就不画进度条（智能库那两行不画"掌握率"，那是没意义的数据）。 */
  function libRow({ testid, lib = null, smart = null, name, color, stats = null, badge = '', meta = '', metaTestid = '', onPractice, menu = null, trailing = null }) {
    const metaText = meta || (
      `共 ${stats.total} 词 · 待复习 ${stats.due} · 已掌握 ${stats.mastered}` +
      (stats.unfamiliar ? ` · 生疏 ${stats.unfamiliar}` : '')
    );
    const ratio = (n) => (stats && stats.total ? Number((n / stats.total).toFixed(4)) : 0);
    const pMastered = ratio(stats ? stats.mastered : 0);
    const pUnfamiliar = ratio(stats ? stats.unfamiliar : 0);

    let action;
    if (trailing) {
      action = el('button', {
        className: 'lib-more',
        dataset: { testid: trailing.testid },
        type: 'button',
        'aria-label': trailing.label,
        onclick: trailing.run
      }, [icon(trailing.icon, { size: 20 })]);
    } else {
      action = el('button', {
        className: 'lib-more',
        dataset: { testid: 'btn-lib-more' },
        type: 'button',
        'aria-label': `「${name}」的更多操作`,
        'aria-expanded': 'false',
        onclick: () => toggleMenu(action, menu)
      }, [icon('more', { size: 20 })]);
    }

    return el('div', {
      className: 'card lib-row' + (testid === 'all-lib-row' ? ' all-lib-row' : '') + (smart ? ' smart-row' : ''),
      dataset: lib ? { testid, lib } : smart ? { testid, smart } : { testid }
    }, [
      el('span', { className: 'lib-dot', style: { background: color } }),
      el('div', { className: 'lib-body' }, [
        el('button', {
          className: 'lib-name',
          type: 'button',
          title: `练「${name}」`,
          onclick: onPractice
        }, badge ? [name, el('span', { className: 'smart-tag' }, badge)] : name),
        el('div', { className: 'lib-meta', dataset: metaTestid ? { testid: metaTestid } : {} }, metaText),
        stats
          ? el('div', { className: 'lib-bar', dataset: { testid: 'lib-progress' } }, [
              // 用 scaleX 而不是 width：动 width 会触发布局、掉帧（GPU 上只有 transform/opacity 是免费的）
              el('i', { style: { transform: `scaleX(${pMastered})`, background: color }, dataset: { testid: 'lib-progress-fill' } }),
              pUnfamiliar
                ? el('i', {
                    className: 'seg-unfamiliar',
                    style: { transform: `translateX(${pMastered * 100}%) scaleX(${pUnfamiliar})` },
                    dataset: { testid: 'lib-progress-unfamiliar' }
                  })
                : null
            ].filter(Boolean))
          : null
      ].filter(Boolean)),
      action
    ]);
  }

  /** ⋯ 菜单：行内展开（和"新建词库"同一套模式），不是弹窗 */
  function toggleMenu(btn, items) {
    const open = view.querySelector('[data-testid="lib-menu"]');
    if (open) {
      closeMenu();
      return;
    }
    const menu = el('div', { className: 'lib-menu', dataset: { testid: 'lib-menu' }, role: 'menu' });
    for (const it of items) {
      // 直接建元素再挂监听：确认类操作要改"这个菜单项自己"的文案，得拿到它的引用
      const item = el('button', {
        className: 'lib-menu-item' + (it.danger ? ' is-danger' : ''),
        dataset: { testid: it.testid },
        role: 'menuitem',
        type: 'button'
      }, [icon(it.icon, { size: 18 }), el('span', {}, it.label)]);
      if (it.confirm) {
        // ⚠️ 确认必须在**建元素时**装一次：装进 click 处理器里会导致"第一次点只是注册了监听、
        //    同一事件的监听列表已经快照过了"→ 要等下一次点击才武装（真踩过这个坑）
        confirmThen(item, it.confirm, { label: '确认删除' });
      } else {
        item.addEventListener('click', () => it.run(menu, item));
      }
      menu.append(item);
    }
    const cancel = el('button', {
      className: 'lib-menu-item',
      dataset: { testid: 'btn-lib-menu-cancel' },
      role: 'menuitem',
      type: 'button'
    }, [icon('close', { size: 18 }), el('span', {}, '取消')]);
    cancel.addEventListener('click', () => closeMenu());
    menu.append(cancel);

    btn.setAttribute('aria-expanded', 'true');
    btn.closest('.lib-row').insertAdjacentElement('afterend', menu);
    // Esc 关掉（键盘用户不必去找那个 ⋯）
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeMenu();
        btn.focus();
      }
    });
    menu.querySelector('button')?.focus();
  }

  function closeMenu() {
    for (const m of view.querySelectorAll('[data-testid="lib-menu"], [data-testid="rename-form"]')) m.remove();
    for (const b of view.querySelectorAll('[aria-expanded="true"]')) b.setAttribute('aria-expanded', 'false');
  }

  /** 行内重命名：菜单原地换成一个小表单（不用 window.prompt —— 会打断、手机上更难看） */
  function renameLib(menu, lib) {
    const input = el('input', {
      className: 'field',
      dataset: { testid: 'rename-input' },
      type: 'text',
      value: lib.name,
      maxlength: '40',
      'aria-label': '词库名字'
    });
    const form = el('form', { className: 'lib-menu', dataset: { testid: 'rename-form' } }, [
      input,
      el('div', { className: 'row-2' }, [
        el('button', { className: 'ghost', type: 'button', onclick: () => closeMenu() }, '取消'),
        el('button', { className: 'primary', dataset: { testid: 'btn-rename-ok' }, type: 'submit' }, '保存')
      ])
    ]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }
      await put('libs', { ...lib, name, updatedAt: Date.now() });
      await renderHome();
    });
    menu.replaceWith(form);
    input.focus();
    input.select();
  }

  /** 删除词库：两步确认由 toggleMenu 装；这里不再自己调 confirmThen */
}

/** 内联的新建词库表单（不用浏览器 prompt：难看、手机上体验也差） */
function openNewLibForm(anchor, data) {
  const existing = document.querySelector('[data-testid="newlib-form"]');
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

  // 替换锚点本身：它现在是词库列表里的一行，表单要顶在那一行的位置
  anchor.replaceWith(form);
  input.focus();
}
