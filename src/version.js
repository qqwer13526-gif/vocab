/* 应用版本号。
 *
 * ⚠️ 发版时三个地方一起改：
 *   src/version.js 的 APP_VERSION   ← 应用自己认为的版本
 *   sw.js 的 VERSION                ← service worker 的缓存名
 *   version.json 的 version         ← 服务端"应该是最新版"的版本，应用用 no-store 取它做对比
 * tool/verify_sw.py 会检查三者一致，改漏了会红。
 */
export const APP_VERSION = 'v27';

/** 版本探测文件：每次启动都用 no-store 拉一次，用来发现"服务端已经更新了" */
export const VERSION_URL = 'version.json';
