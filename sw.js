/* 背单词 App 的 service worker。
 *
 * 策略（v34 起：外壳预缓存 + 静态资源"缓存优先，后台更新"）：
 *   - 安装时只预缓存 ASSETS（**首屏必需的那一小撮**）→ 第一次打开要下的东西少一半
 *   - DEFERRED 里那些（练习/导入/词条/设置界面及其重依赖）首次用到时才下，下完就进缓存
 *   - 导航请求：联网时取最新（一刷新就是新代码），断网回退缓存外壳
 *   - 同源静态资源：**先给缓存**（首屏 ~100ms 出来），同时在后台把新版本写进缓存
 *     v9~v34 是"联网就取最新"：Pages 的 max-age=600 一过期，每次打开都要把 20 多个模块
 *     重新从网上拉一遍（国内每请求 ~400ms）→ 进应用要好几秒。要立刻换版本仍走
 *     「立即更新」按钮（它清缓存 + 让新 SW 接管），或等新 SW 装上后自动换。
 *   - 改代码后把 VERSION 加一，旧缓存会在 activate 时清掉
 *
 * ⚠️ version.json **不要**放进 ASSETS：应用要用 no-store 取它来发现新版本，缓存住就没用了。
 * ⚠️ ASSETS + DEFERRED 必须覆盖 src 下每个模块；tool/verify_sw.py 会逐个检查。
 */
const VERSION = 'v34';
const CACHE = `vocab-${VERSION}`;

// 首屏必需的（首页要用的那条链 + 外壳 + 字体图标）
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './fonts/InstrumentSerif-Regular.ttf',
  './src/app.js',
  './src/version.js',
  './src/viewport.js',
  './src/theme.js',   // app.js 静态 import：主题要在第一帧前就位，不能按需
  './src/press.js',   // 同上：全局按压反馈
  './src/glass.js',   // 同上：底部胶囊的液态行为
  './src/motion.js',  // 首页数字滚动/列表入场（首页链上）
  './src/icons.js',
  './src/toast.js',
  './src/confirm.js',
  './src/db.js',
  './src/store.js',
  './src/smart.js',
  './src/srs.js',
  './src/judge.js',
  './src/ui-home.js'
];

// 按需缓存：首次进对应界面时下载（之后离线也能用）。
// 只是"登记"，好让 verify_sw.py 能核对"每个模块都有着落"。
const DEFERRED = [
  './src/spring.js',
  './src/speech.js',
  './src/parse.js',
  './src/backup.js',
  './src/ui-practice.js',
  './src/ui-import.js',
  './src/ui-word.js',
  './src/ui-settings.js',
  './src/xlsx.js',
  './src/phonetic.js'
];
// 注意：version.json 故意不在清单里 —— 它必须每次都从网络取

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 页面上的「立即更新」按钮会让新的 SW 立刻接管，然后页面自己 reload
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // 版本探测文件永远交给网络（应用用 no-store + ?t= 取它，缓存住就发现不了新版本）
  if (url.pathname.endsWith('/version.json')) return;

  // 页面导航：联网时取最新（开发时不会吃陈旧外壳），断网时回退到缓存里的外壳
  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res && res.ok) {
            const c = await caches.open(CACHE);
            c.put('./index.html', res.clone());
          }
          return res;
        } catch {
          return (await caches.match(req, { ignoreSearch: true })) || (await caches.match('./index.html')) || Response.error();
        }
      })()
    );
    return;
  }

  // 静态资源：**缓存优先 + 后台更新**（stale-while-revalidate）。
  //   有缓存 → 立刻给（首屏不等网络），同时后台 fetch 一份新的写回缓存
  //   没缓存 → 走网络（首屏/按需模块第一次用到就是这样），成功就缓存下来
  e.respondWith(
    (async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      const refreshing = fetch(req)
        .then(async (res) => {
          if (res && res.ok) {
            const c = await caches.open(CACHE);
            c.put(req, res.clone());
          }
          return res;
        })
        .catch(() => null);
      if (cached) {
        e.waitUntil(refreshing); // 后台更新，不挡这次响应
        return cached;
      }
      const res = await refreshing;
      return res || Response.error();
    })()
  );
});
