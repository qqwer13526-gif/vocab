/* 界面 E：设置
 *
 * 这里放三件"跟数据安全有关"的事：
 *   1. 更新：iOS 的主屏幕应用不会自己发现新版本，这里可以手动查、一键更新
 *   2. 数据状态：本地到底存了多少东西、有没有申请到"持久化存储"
 *   3. 备份 / 恢复：导出一个 JSON 文件；换手机、误删、换容器都能救回来
 * 还写清楚 iOS 的坑：主屏幕应用和 Safari 是两套存储，删图标会连数据一起删。
 */

import { $, el, checkForUpdate, updateState, applyUpdate } from './app.js';
import { exportToFile, formatBytes, importFromText, requestPersist, storageInfo } from './backup.js';
import { APP_VERSION } from './version.js';

export async function renderSettings() {
  const view = $('#view-settings');
  if (!view) return;

  const info = await storageInfo();
  const status = el('div', { className: 'word-status', dataset: { testid: 'settings-status' } }, '');
  const say = (text, kind = 'ok') => {
    status.textContent = text;
    status.dataset.kind = kind;
  };

  // ---------------------------------------------------------------- 更新
  const updateStatus = el('div', { className: 'settings-note', dataset: { testid: 'update-status' } },
    '打开应用、切回前台时会自动检查一次。');
  const btnCheck = el('button', {
    className: 'ghost',
    dataset: { testid: 'btn-check-update' },
    type: 'button',
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      updateStatus.textContent = '检查中…';
      const res = await checkForUpdate({ force: true });
      btn.disabled = false;
      if (!res.checked) {
        updateStatus.textContent = '这个环境里没有 service worker（比如直接打开本地文件），没法检查更新。';
      } else if (res.ready) {
        updateStatus.textContent = `发现新版本 ${res.remote || ''}（本机 ${res.local}），点顶部那条"立即更新"。`;
      } else if (res.error) {
        updateStatus.textContent = `查不到最新版本（可能没网）：${res.error}。本机是 ${res.local}。`;
      } else {
        updateStatus.textContent = `已是最新（${res.local}）。`;
      }
    }
  }, '检查更新');

  const updateCard = el('div', { className: 'card settings-card' }, [
    el('div', { className: 'field-label' }, '版本'),
    el('div', { className: 'settings-big', dataset: { testid: 'settings-version' } }, APP_VERSION),
    el('div', { className: 'settings-note' }, '更新不会动你的数据（词库和学习进度都在本机存储里，不在代码里）。'),
    el('div', { className: 'row-2' }, [btnCheck, updateState().ready
      ? el('button', { className: 'primary', dataset: { testid: 'btn-update-now' }, type: 'button', onclick: () => applyUpdate() }, '立即更新')
      : null]),
    updateStatus
  ]);

  // ---------------------------------------------------------------- 数据状态
  const persistLine = el('div', { className: 'settings-note', dataset: { testid: 'persist-status' } },
    info.persisted == null ? '持久化存储：这个浏览器不支持查询' : info.persisted ? '持久化存储：已开启 ✅' : '持久化存储：未开启（建议点右边申请，免得系统在空间紧张时清理）');
  const btnPersist = el('button', {
    className: 'ghost',
    dataset: { testid: 'btn-persist' },
    type: 'button',
    onclick: async () => {
      const res = await requestPersist();
      if (!res.supported) persistLine.textContent = '持久化存储：这个浏览器不支持';
      else if (res.persisted) persistLine.textContent = '持久化存储：已开启 ✅';
      else persistLine.textContent = '持久化存储：申请了但系统没给（主屏幕应用通常会给；继续用也不影响，记得定期备份）';
    }
  }, '申请持久化存储');

  const dataCard = el('div', { className: 'card settings-card' }, [
    el('div', { className: 'field-label' }, '本机数据'),
    el('div', { className: 'settings-list', dataset: { testid: 'storage-summary' } }, [
      el('div', {}, `词条 ${info.words} 个${info.wordsAll > info.words ? `（另有 ${info.wordsAll - info.words} 个已删除）` : ''}`),
      el('div', {}, `词库 ${info.libs} 个 · 归属 ${info.links} 条`),
      el('div', {}, `学习记录 ${info.prog} 条`),
      el('div', {}, `占用约 ${formatBytes(info.usage)}${info.quota ? `（可用 ${formatBytes(info.quota)}）` : ''}`)
    ]),
    persistLine,
    btnPersist
  ]);

  // ---------------------------------------------------------------- 备份 / 恢复
  const fileInput = el('input', {
    type: 'file',
    accept: '.json,application/json',
    dataset: { testid: 'import-backup' },
    'aria-label': '选择备份文件',
    hidden: true
  });
  const plan = el('div', { className: 'settings-plan', dataset: { testid: 'backup-plan' }, hidden: true });
  let pending = null;

  const btnExport = el('button', {
    className: 'primary',
    dataset: { testid: 'btn-export' },
    type: 'button',
    onclick: async () => {
      try {
        const { name, backup } = await exportToFile();
        say(`已生成备份 ${name}（${backup.counts.words} 个词条）。在 iOS 上会弹出"存储到文件"，存到「文件」或发给自己都行。`);
      } catch (err) {
        say('导出失败：' + (err && err.message ? err.message : err), 'bad');
      }
    }
  }, '导出备份文件');

  const btnPick = el('button', {
    className: 'ghost',
    dataset: { testid: 'btn-pick-backup' },
    type: 'button',
    onclick: () => fileInput.click()
  }, '从备份恢复…');

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    try {
      const text = await f.text();
      // 先解析一下，把要恢复的东西亮出来让用户确认（不直接动数据）
      const { parseBackup } = await import('./backup.js');
      const data = parseBackup(text);
      pending = text;
      plan.hidden = false;
      plan.replaceChildren(
        el('div', { className: 'settings-plan-title' }, `这个备份里有：${data.words.length} 个词条 · ${data.libs.length} 个词库 · ${data.prog.length} 条学习记录`),
        el('div', { className: 'settings-note' }, data.exportedAt ? `导出时间：${data.exportedAt.slice(0, 19).replace('T', ' ')}` : ''),
        el('div', { className: 'field-label' }, '怎么合并？'),
        el('div', { className: 'row-2' }, [
          el('button', { className: 'ghost', type: 'button', dataset: { testid: 'btn-restore-cancel' }, onclick: () => { plan.hidden = true; pending = null; } }, '取消'),
          el('button', { className: 'ghost', type: 'button', dataset: { testid: 'btn-restore-merge' }, onclick: () => doRestore('merge') }, '合并进来'),
          el('button', { className: 'primary', type: 'button', dataset: { testid: 'btn-restore-replace' }, onclick: () => doRestore('replace') }, '覆盖本机')
        ]),
        el('div', { className: 'settings-note' }, '「合并」把备份里较新的那份并进来（推荐换手机时用）；「覆盖」会清掉本机现有数据再导入。')
      );
      say('选好了备份文件，确认下面的方式再恢复。', 'ok');
    } catch (err) {
      pending = null;
      plan.hidden = true;
      say('这个文件读不了：' + (err && err.message ? err.message : err), 'bad');
    }
  });

  async function doRestore(mode) {
    if (!pending) return;
    try {
      const res = await importFromText(pending, { mode });
      pending = null;
      plan.hidden = true;
      say(`恢复完成（${mode === 'replace' ? '覆盖' : '合并'}）：词条 ${res.counts.words} · 词库 ${res.counts.libs} · 归属 ${res.counts.links} · 学习记录 ${res.counts.prog}`);
      setTimeout(() => renderSettings(), 1200);
    } catch (err) {
      say('恢复失败：' + (err && err.message ? err.message : err), 'bad');
    }
  }

  const backupCard = el('div', { className: 'card settings-card' }, [
    el('div', { className: 'field-label' }, '备份 / 恢复'),
    el('div', { className: 'settings-note' }, '备份是一个 JSON 文件（不含 3.8MB 的音标库，恢复后重新补一次就行）。换手机、误删、或者数据看起来不见了，都用它救。'),
    btnExport,
    btnPick,
    fileInput,
    plan
  ]);

  // ---------------------------------------------------------------- iOS 注意事项
  const notes = el('div', { className: 'card settings-card' }, [
    el('div', { className: 'field-label' }, '手机上要注意的两件事'),
    el('ol', { className: 'settings-notes' }, [
      el('li', {}, '主屏幕上的应用和 Safari 里打开的网页是**两套独立存储**（iOS 的规定）：你在 Safari 里看到的可能是空的，数据其实在主屏幕那个应用里。平时就用主屏幕图标打开。'),
      el('li', {}, '千万别删主屏幕图标再重加 —— 那会连数据一起删掉。要更新就用顶部的「立即更新」，或者这里的「检查更新」。'),
      el('li', {}, '换手机、或者想保险一点：在这里「导出备份文件」，存到「文件」App 或发给自己。')
    ])
  ]);

  view.replaceChildren(
    el('div', { className: 'word-head' }, [
      el('button', { className: 'prac-quit', type: 'button', 'aria-label': '回首页', onclick: () => { location.hash = '#/'; } }, '‹'),
      el('h2', { className: 'page-title' }, '设置')
    ]),
    updateCard,
    dataCard,
    backupCard,
    notes,
    status
  );
}
