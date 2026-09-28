/* 背单词 App 的 service worker。
 *
 * 策略（v9 起改为"联网优先"）：
 *   - 安装时把 ASSETS 全部预缓存（装完就能离线用）
 *   - 导航请求：联网时取最新，断网回退缓存外壳
 *   - 同源静态资源：**联网时也取最新**，失败才回退缓存
 *     （以前是"先用缓存、后台更新"，结果手机上更新完还得刷两次；
 *      代价只是联网时多一次请求，换来"一刷新就是新代码"）
 *   - 改代码后把 VERSION 加一，旧缓存会在 activate 时清掉
 *
 * ⚠️ version.json **不要**放进 ASSETS：应用要用 no-store 取它来发现新版本，缓存住就没用了。
 * ⚠️ ASSETS 清单必须和真实文件一一对应；tool/verify_sw.py 会逐个检查。
 */
const VERSION = 'v21';
const CACHE = `vocab-${VERSION}`;

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
  './src/confirm.js',
  './src/icons.js',
  './src/spring.js',
  './src/toast.js',
  './src/db.js',
  './src/store.js',
  './src/smart.js',
  './src/srs.js',
  './src/judge.js',
  './src/parse.js',
  './src/backup.js',
  './src/ui-home.js',
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

  // 静态资源：联网时取最新（保证更新立刻生效），断网才用缓存
  e.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const c = await caches.open(CACHE);
          c.put(req, res.clone());
        }
        return res;
      } catch {
        return (await caches.match(req, { ignoreSearch: true })) || Response.error();
      }
    })()
  );
});
