/* 白边定位开关（v41）：网址后加 ?edge=1
 *
 * 为什么要有它：iOS 过渡时的"白边"可能来自好几个地方（根画布、body、页面容器、
 * manifest 的 background_color、状态栏区域……），只在真机上出现，无头环境复现不了。
 * 与其我猜，不如把每一层分别涂成刺眼的颜色 —— 再看到白边，就知道是哪一层在发白。
 *
 * 它还会把诊断信息（版本 / 显示模式 / 各层算出来的背景色 / manifest 里的颜色 / 视口尺寸）
 * 打印在一个浮层上，一键复制发我。
 *
 * 只有带 ?edge=1 时才会被 import；正常使用一个字节都不加载。
 */

const PAINT = [
  ['html', '#ff00ff'],                 // 根画布：洋红
  ['body', '#00ffff'],                 // 页面底：青
  ['#app', '#ffff00'],                 // 应用容器：黄
  ['.view:not([hidden])', '#00ff00']   // 当前界面：绿
];

export function startEdgeProbe() {
  const box = document.createElement('div');
  box.className = 'edge-probe';
  box.dataset.testid = 'edge-probe';
  document.body.append(box);

  const style = document.createElement('style');
  style.textContent = `
    ${PAINT.map(([sel, color]) => `${sel} { background: ${color} !important; }`).join('\n')}
    .ambient { display: none !important; }
    body::before { background: #ff0000 !important; }
    .edge-probe {
      position: fixed; z-index: 90; left: 8px; right: 8px; bottom: 8px;
      background: rgb(0 0 0 / 88%); color: #fff; font-size: 11px; line-height: 1.5;
      padding: 8px 10px; border-radius: 10px; white-space: pre-wrap; word-break: break-all;
      font-variant-numeric: tabular-nums;
    }
    .edge-probe b { color: #ffd866; }
    .edge-probe pre { margin: 0 0 6px; white-space: pre-wrap; word-break: break-all; font: inherit; }
    .edge-probe button {
      margin-top: 6px; width: 100%; padding: 6px; border-radius: 8px;
      border: 1px solid rgb(255 255 255 / 30%); background: rgb(255 255 255 / 12%); color: #fff; font-size: 12px;
    }
  `;
  document.head.append(style);

  const bg = (sel) => {
    const n = sel === 'html' ? document.documentElement : document.querySelector(sel);
    if (!n) return '（没有这个元素）';
    const cs = getComputedStyle(n);
    return `${cs.backgroundColor} / ${cs.backgroundImage === 'none' ? '无图' : '有图'}`;
  };

  async function manifestInfo() {
    try {
      const res = await fetch(new URL('./manifest.webmanifest', document.baseURI));
      const m = await res.json();
      return `background_color=${m.background_color} theme_color=${m.theme_color} display=${m.display}`;
    } catch (e) {
      return '读不到 manifest：' + (e && e.message);
    }
  }

  async function report() {
    const meta = [...document.querySelectorAll('meta[name="theme-color"]')]
      .map((m) => `${m.getAttribute('media') || '（无条件）'}=${m.content}`)
      .join(' · ');
    const lines = [
      `版本 ${document.body.dataset.appVersion || '?'} · 主题 ${document.documentElement.dataset.theme || 'auto'}`,
      `显示模式 ${matchMedia('(display-mode: standalone)').matches ? 'standalone（主屏幕 App）' : 'browser（浏览器标签）'}`,
      `视口 ${innerWidth}×${innerHeight} · dpr ${devicePixelRatio} · 安全区 上${getComputedStyle(document.documentElement).getPropertyValue('--safe-t').trim() || '0px'}`,
      `manifest：${await manifestInfo()}`,
      `theme-color meta：${meta}`,
      '',
      '被涂色的层（看到哪一层在发白就告诉我它的颜色名）：',
      `  html 根画布 = 洋红（#f0f）→ ${bg('html')}`,
      `  body 页面底 = 青（#0ff）→ ${bg('body')}`,
      `  #app 容器 = 黄（#ff0）→ ${bg('#app')}`,
      `  当前界面 = 绿（#0f0）→ ${bg('.view:not([hidden])')}`,
      '  body::before 顶部安全区 = 红（#f00）',
      '',
      '现在请滑动切换一次界面；如果还有白边，白边就来自"没有涂色的那一层"（多半是系统/浏览器自己的底，比如 manifest 的 background_color）。'
    ];
    return lines.join('\n');
  }

  // 诊断文本 + 复制按钮分开两个节点（别像第一版那样把按钮当旧内容删掉 ✗）
  const pre = document.createElement('pre');
  pre.className = 'edge-report';
  pre.dataset.testid = 'edge-report';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.testid = 'edge-copy';
  btn.textContent = '复制诊断';
  box.append(pre, btn);

  report().then((text) => {
    pre.textContent = text;
    btn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = '已复制 ✅ 直接发我';
      } catch {
        window.prompt('复制下面这段发我：', text);
      }
    };
  });
}
