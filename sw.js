/* 背单词 App 的 service worker。
 *
 * 策略：
 *   - 安装时把 ASSETS 全部预缓存（这样第一次装完就能离线用）
 *   - 导航请求：缓存优先，没命中就回 index.html（单页应用）
 *   - 同源静态资源：stale-while-revalidate（先用缓存秒开，后台更新）
 *   - 改代码后记得把 VERSION 加一，旧缓存会在 activate 时清掉
 *
 * 注意：ASSETS 清单必须和真实文件一一对应；tool/verify_sw.py 会逐个 HEAD 检查。
 */
const VERSION = 'v5';
const CACHE = `vocab-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './src/app.js',
  './src/db.js',
  './src/store.js',
  './src/srs.js',
  './src/judge.js',
  './src/parse.js',
  './src/ui-home.js',
  './src/ui-practice.js',
  './src/ui-import.js',
  './src/ui-word.js',
  './src/xlsx.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
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

  // 静态资源：先给缓存，再后台更新
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
