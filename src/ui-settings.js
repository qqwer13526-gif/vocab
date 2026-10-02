/* 界面 E：设置
 *
 * 这里放三件"跟数据安全有关"的事：
 *   1. 更新：iOS 的主屏幕应用不会自己发现新版本，这里可以手动查、一键更新
 *   2. 数据状态：本地到底存了多少东西、有没有申请到"持久化存储"
 *   3. 备份 / 恢复：导出一个 JSON 文件；换手机、误删、换容器都能救回来
 * 还写清楚 iOS 的坑：主屏幕应用和 Safari 是两套存储，删图标会连数据一起删。
 */

import { icon } from './icons.js';
import { $, el, checkForUpdate, updateState, applyUpdate } from './app.js';
import { all } from './db.js';
import { exportToFile, formatBytes, importFromText, requestPersist, storageInfo } from './backup.js';
import { countMissing, fillPhonetics } from './phonetic.js';
import { confirmThen } from './confirm.js';
import { ACCENT_LABELS, RATE_LABELS, saveSpeechSettings, speakWord, speechSettings, speechSupported, unlockSpeech, voices } from './speech.js';
import { THEMES, THEME_LABEL, applyTheme, loadTheme, setAmbient } from './theme.js';
import { showToast } from './toast.js';
import { APP_VERSION } from './version.js';

export async function renderSettings() {
  const view = $('#view-settings');
  if (!view) return;
  setAmbient(); // 设置页没有单一库色 → 回到品牌色柔光

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

  // 启动诊断（v30）：手机上觉得"进应用慢"时，这一行能说清慢在哪
  //   —— 网络那段（首次要下多少）、app 自己那段、以及 SW 有没有接管（接管了就该是 0 KB）
  const bootLine = el('div', { className: 'settings-note', dataset: { testid: 'boot-status' } }, '启动诊断：还没记录');
  const paintBoot = async () => {
    let last = null;
    try {
      last = JSON.parse(localStorage.getItem('vocab.lastBoot') || 'null');
    } catch {
      last = null;
    }
    let cached = null;
    try {
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        const mine = keys.find((k) => k.startsWith('vocab-')) || keys[0];
        if (mine) cached = { name: mine, n: (await (await caches.open(mine)).keys()).length };
      }
    } catch {
      cached = null;
    }
    const swOn = !!navigator.serviceWorker?.controller;
    const parts = [];
    if (last) {
      const when = new Date(last.at).toLocaleString('zh-CN', { hour12: false });
      parts.push(`上次启动 ${last.ms}ms（其中等响应 ${last.responseEnd}ms · ${last.requests} 个请求 · ${last.kb}KB）`);
      parts.push(`当时 ${last.sw ? '已接管' : '未接管'} · ${when}`);
    }
    parts.push(`service worker：${swOn ? '已接管 ✅' : '未接管（首次打开会慢，之后就快了）'}`);
    if (cached) parts.push(`缓存 ${cached.name} 里有 ${cached.n} 个文件`);
    bootLine.textContent = '启动诊断：' + parts.join(' · ');
  };
  paintBoot();
  // 直接打开设置页时，第一屏还没渲染完 → 数据要等 app.js 记完再补一次
  window.addEventListener('vocab:boot', paintBoot, { once: true });

  // 补音标：从首页搬过来的 —— 这是"数据维护"，属于设置；首页只留词库
  const missing = await countMissing(await all('words'));
  const btnPhonetic = missing
    ? el('button', {
        className: 'ghost',
        dataset: { testid: 'btn-settings-phonetic' },
        type: 'button',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            const res = await fillPhonetics({
              words: await all('words'),
              onProgress: (p) => {
                const which = p.dict === 'fallback' ? '美式兜底' : '英式';
                btn.textContent = p.phase === 'download' ? `下载${which}音标库 ${Math.round((p.ratio || 0) * 100)}%` : '匹配中…';
              }
            });
            say((res.filled ? `已补 ${res.filled} 个音标` : '没有可补的') + (res.missing ? `；${res.missing} 个音标库里没有收录` : ''));
            await renderSettings();
          } catch (err) {
            say('补齐失败：' + (err && err.message ? err.message : err), 'bad');
            btn.disabled = false;
          }
        }
      }, `补齐音标（还差 ${missing} 个）`)
    : null;

  // ---------------------------------------------------------------- 发音（只读单词，系统 TTS）
  // 零字节、离线可用；不支持 Web Speech API 的浏览器就整块不显示，免得点了没反应。
  const spCfg = speechSettings();
  const spSupported = speechSupported();
  const spOn = el('input', {
    type: 'checkbox',
    dataset: { testid: 'speech-on' },
    checked: spCfg.on,
    onchange: (e) => {
      saveSpeechSettings({ on: e.currentTarget.checked });
      spSay(e.currentTarget.checked ? '发音已开启' : '发音已关闭');
    }
  });
  const spAccent = el('select', {
    className: 'field',
    dataset: { testid: 'speech-accent' },
    'aria-label': '口音',
    onchange: (e) => { saveSpeechSettings({ accent: e.currentTarget.value }); speakWord('vocabulary', { accent: e.currentTarget.value }); }
  }, Object.entries(ACCENT_LABELS).map(([v, label]) => el('option', { value: v, selected: v === spCfg.accent }, label)));
  const spRate = el('select', {
    className: 'field',
    dataset: { testid: 'speech-rate' },
    'aria-label': '语速',
    onchange: (e) => { saveSpeechSettings({ rate: Number(e.currentTarget.value) }); speakWord('vocabulary', { rate: Number(e.currentTarget.value) }); }
  }, Object.entries(RATE_LABELS).map(([v, label]) => el('option', { value: v, selected: Number(v) === spCfg.rate }, label)));
  const spAuto = el('input', {
    type: 'checkbox',
    dataset: { testid: 'speech-auto' },
    checked: spCfg.auto,
    onchange: (e) => saveSpeechSettings({ auto: e.currentTarget.checked })
  });
  const spSay = (text, kind = 'ok') => { spStatus.textContent = text; spStatus.dataset.kind = kind; };
  const spStatus = el('div', { className: 'settings-note', dataset: { testid: 'speech-status' } }, '');
  const spEnVoices = spSupported ? voices().filter((v) => /^en/i.test(v.lang || '')).length : 0;
  const speechCard = spSupported
    ? el('div', { className: 'card settings-card' }, [
        el('div', { className: 'field-label' }, '发音（只读单词）'),
        el('label', { className: 'lib-check-label' }, [spOn, el('span', {}, '显示喇叭按钮')]),
        el('div', { className: 'grid-2' }, [spAccent, spRate]),
        el('label', { className: 'lib-check-label' }, [spAuto, el('span', {}, '切到新词时自动读一遍')]),
        el('button', {
          className: 'ghost',
          dataset: { testid: 'btn-speech-try' },
          type: 'button',
          onclick: () => {
            unlockSpeech();
            const cfg = speechSettings();
            const okSpoken = speakWord('vocabulary');
            spSay(okSpoken ? `试听：本机 ${spEnVoices} 个英文音色` : '这台设备没给出英文音色，可能读不出声', okSpoken ? 'ok' : 'warn');
            if (okSpoken && !cfg.auto) spStatus.dataset.hint = 'auto-off';
          }
        }, '试听'),
        spStatus,
        el('div', { className: 'settings-note' }, '用的是设备自带的朗读（不下载音频、离线也能响）。iPhone 上侧边静音键可能会压掉它；音色在「设置 → 辅助功能 → 朗读内容」里可下载更好的。')
      ])
    : null;

  // ---------------------------------------------------------------- 外观（v32）
  // 夜间模式以前只有"跟随系统"（@media prefers-color-scheme）；这里补手动三态。
  // 强制深色时同时改 theme-color（状态栏/地址栏配色）与 color-scheme（表单控件/滚动条）。
  const themeCard = el('div', { className: 'card settings-card' }, [
    el('div', { className: 'field-label' }, '外观'),
    el('div', { className: 'seg-box theme-switch', dataset: { testid: 'theme-switch' }, role: 'group', 'aria-label': '外观主题' },
      THEMES.map((t) =>
        el('button', {
          type: 'button',
          dataset: { testid: `btn-theme-${t}`, theme: t },
          'aria-pressed': String(t === loadTheme()),
          onclick: (e) => {
            applyTheme(t);
            for (const b of e.currentTarget.parentElement.children) {
              b.setAttribute('aria-pressed', String(b.dataset.theme === t));
            }
          }
        }, THEME_LABEL[t])
      )
    ),
    el('div', { className: 'settings-note', dataset: { testid: 'theme-note' } },
      '强制深色用的是同一套深色令牌（和「跟随系统」逐项一致，对比度脚本会比对）。切换不闪白、不动你的数据。')
  ]);

  const dataCard = el('div', { className: 'card settings-card' }, [
    el('div', { className: 'field-label' }, '本机数据'),
    el('div', { className: 'settings-list', dataset: { testid: 'storage-summary' } }, [
      el('div', {}, `词条 ${info.words} 个${info.wordsAll > info.words ? `（另有 ${info.wordsAll - info.words} 个已删除）` : ''}`),
      el('div', {}, `词库 ${info.libs} 个 · 归属 ${info.links} 条`),
      el('div', {}, `学习记录 ${info.prog} 条`),
      el('div', {}, `占用约 ${formatBytes(info.usage)}${info.quota ? `（可用 ${formatBytes(info.quota)}）` : ''}`)
    ]),
    persistLine,
    btnPersist,
    bootLine,
    btnPhonetic
  ].filter(Boolean));

  // ---------------------------------------------------------------- 调试（真机上定位交互问题用）
  // 无头浏览器里合成的事件跑得通，不代表 iOS 真实触摸跑得通。真机出问题时打开这个开关，
  // 练习页左上角会把"模式 / touch-action / 各类事件计数 / 当前位移"直接摆在屏幕上。
  const dbgBox = el('input', {
    type: 'checkbox',
    dataset: { testid: 'debug-toggle' },
    checked: localStorage.getItem('vocab.debug') === '1',
    onchange: (e) => {
      if (e.currentTarget.checked) localStorage.setItem('vocab.debug', '1');
      else localStorage.removeItem('vocab.debug');
    }
  });
  const debugCard = el('div', { className: 'card settings-card' }, [
    el('div', { className: 'field-label' }, '调试'),
    el('label', { className: 'settings-note', style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [
      dbgBox,
      el('span', {}, '练习页显示「滑动调试浮层」（手机上排查拖不动的问题用）')
    ])
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
          (() => {
            // 「覆盖」会清掉本机数据 → 点一下只武装，再点一下才执行
            const btn = el('button', { className: 'primary', type: 'button', dataset: { testid: 'btn-restore-replace' } }, '覆盖本机');
            confirmThen(btn, () => doRestore('replace'), { label: '确认覆盖？' });
            return btn;
          })()
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
      // 恢复完界面会重渲染，就地提示留不住 → 用提示条
      showToast(
        `恢复完成（${mode === 'replace' ? '覆盖' : '合并'}）：词条 ${res.counts.words} · 词库 ${res.counts.libs} · 学习记录 ${res.counts.prog}`,
        { kind: 'ok', timeout: 4000 }
      );
      await renderSettings();
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

  // ⚠️ replaceChildren(null) 会在页面上真的渲染出字符串 "null"（踩过的老坑）→ 先 filter(Boolean)
  view.replaceChildren(
    ...[
      el('div', { className: 'word-head' }, [
        el('button', { className: 'prac-quit', type: 'button', 'aria-label': '回首页', onclick: () => { location.hash = '#/'; } }, [icon('chevronLeft', { size: 20 })]),
        el('h2', { className: 'page-title' }, '设置')
      ]),
      updateCard,
      themeCard,
      dataCard,
      speechCard,
      backupCard,
      debugCard,
      notes,
      status
    ].filter(Boolean)
  );
}
