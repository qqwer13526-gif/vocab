"""更新链路测试（v35 新增）：模拟一次真实发版，走用户路径点一遍。

为什么必须有这个：v34 之前"更新"这条路没有任何自动化覆盖，于是
"更新成功后横幅又弹回来"（controllerchange 无条件点亮横幅）这种 bug 能一直活着 ——
用户看到的表现就是"点了立即更新没反应"，反复点也没用。

做法：把项目复制到临时目录 → 改那份拷贝的版本号（version.json / sw.js / src/version.js）
      → 用本地服务器提供它 → 在浏览器里走「检查更新 → 立即更新」→ 检查最终落在哪个版本。

断言：
  ① 检查更新后顶部横幅出现（带新版本号）
  ② 点「立即更新」后会重新加载，并且**落在新版本**上
  ③ 重载后横幅必须消失 ← 就是 v34 那个 bug 的回归点
  ④ 更新完成后有一条"已更新到 vX"的提示
  ⑤ 慢网络（sw.js 延迟 800ms）也必须能更新成功

跑法：python tool/update_test.py
"""

from __future__ import annotations

import pathlib
import shutil
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tool"))

import serve  # noqa: E402
import testserver  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

PASS, FAIL = [], []


def check(label: str, ok: bool, detail: str = "") -> None:
    (PASS if ok else FAIL).append(label)
    print(("[PASS] " if ok else "[FAIL] ") + label + (f"   {detail}" if detail else ""))


def make_site(tmp: pathlib.Path) -> pathlib.Path:
    site = tmp / "site"
    shutil.copytree(ROOT, site, ignore=shutil.ignore_patterns(".git", "shots", "node_modules", "__pycache__"))
    return site


def current_version(site: pathlib.Path) -> str:
    import json

    return json.loads((site / "version.json").read_text(encoding="utf-8"))["version"]


def publish(site: pathlib.Path, new: str) -> None:
    """把磁盘上的站点"发成下一版"（改三处版本号 + 一处可见文案）。"""
    import json

    (site / "version.json").write_text(json.dumps({"version": new}) + "\n", encoding="utf-8")
    for rel, pat in (("sw.js", "const VERSION = "), ("src/version.js", "APP_VERSION = ")):
        p = site / rel
        s = p.read_text(encoding="utf-8")
        i = s.index(pat) + len(pat)
        quote = s[i]
        j = s.index(quote, i + 1)
        p.write_text(s[:i] + quote + new + s[j:], encoding="utf-8")
    # 一处肉眼可见的变化：设置页第一条注意事项（用来确认"真的换了代码"）
    p = site / "src" / "ui-settings.js"
    s = p.read_text(encoding="utf-8")
    s = s.replace("千万别删主屏幕图标再重加", f"[{new}] 千万别删主屏幕图标再重加", 1)
    p.write_text(s, encoding="utf-8")


def run_case(browser, site: pathlib.Path, cur: str, nxt: str, *, slow_sw: bool, label: str, block_sw: bool = False) -> None:
    serve.ROOT = site
    testserver.ROOT = site
    httpd, base = testserver.start_free(5251)
    base = base.rstrip("/") + "/"
    try:
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        slow = {"on": False}

        def handle(route):
            if route.request.url.endswith("/sw.js"):
                if block_sw:
                    return route.abort()          # 让注册彻底失败
                if slow["on"]:
                    time.sleep(0.8)
            route.continue_()

        ctx.route("**/*", handle)
        page = ctx.new_page()
        # 先正常打开两次，让 SW 装好并接管（模拟"用户平时打开"的状态）
        page.goto(base, wait_until="load")
        page.wait_for_timeout(2200)
        page.goto(base, wait_until="load")
        if not block_sw:
            page.wait_for_function("() => !!navigator.serviceWorker.controller", timeout=15000)
        page.wait_for_timeout(800)
        check(f"{label}：起始版本是 {cur}", page.evaluate("() => document.body.dataset.appVersion") == cur)
        if block_sw:
            swreg = page.evaluate("() => document.body.dataset.swreg || ''")
            check(f"{label}：确实没有可用的 service worker（注册失败/不支持）",
                  "error" in swreg or swreg == "unsupported", swreg)

        publish(site, nxt)
        slow["on"] = slow_sw
        page.evaluate("() => { location.hash = '#/settings'; }")
        page.wait_for_selector('[data-testid="btn-check-update"]', timeout=15000)
        page.click('[data-testid="btn-check-update"]')

        # ① 横幅出现
        appeared = False
        for _ in range(300):
            if page.evaluate("() => document.body.dataset.update") == "ready":
                appeared = True
                break
            page.wait_for_timeout(50)
        check(f"{label}：检查更新后横幅出现", appeared)
        bar_text = page.evaluate("() => (document.querySelector('#update-bar span') || {}).textContent || ''")
        check(f"{label}：横幅文案带上新版本号与当前版本", nxt in bar_text and cur in bar_text, bar_text.strip())
        check(f"{label}：设置页也出现了「立即更新」按钮",
              page.evaluate("() => !document.querySelector('[data-testid=\\'btn-update-now\\']').hasAttribute('hidden')"))

        # ② 点「立即更新」：要重新加载
        loads = {"n": 0}
        page.on("load", lambda _: loads.update(n=loads["n"] + 1))
        t0 = time.time()
        has_force = page.evaluate("() => !!document.querySelector('[data-testid=btn-force-reload]')")
        check(f"{label}：设置页给了「强制重新加载」兜底按钮", has_force)
        page.click('[data-testid="btn-update"]')
        for _ in range(200):
            page.wait_for_timeout(100)
            if loads["n"]:
                break
        # 阶段计时（页面在 reload 之前把它写进 body.dataset.updPhases）
        try:
            phases = page.evaluate("() => sessionStorage.getItem('vocab.updPhases') || document.body.dataset.updPhases || ''")
        except Exception:
            phases = ''
        print(f"    阶段计时：{phases}")
        try:
            boot = page.evaluate("() => localStorage.getItem('vocab.lastBoot') || ''")
        except Exception:
            boot = ''
        print(f"    重载后的启动诊断：{boot}")
        took = time.time() - t0
        check(f"{label}：点了会重新加载", loads["n"] > 0, f"{took:.2f}s")
        # v39：有 SW 的那条路以前白等 ~1.2s（最多 3.7s）→ 用户读作"桌面端要等半天"。这里钉住 2.5s。
        check(f"{label}：重载发生在 2.5s 内（不许再白等）", loads["n"] and took <= 2.5, f"{took:.2f}s")
        page.wait_for_timeout(3000)
        # v42：点更新只该重载**一次**。以前第一次重载会拿到旧文件（旧缓存没删对）→
        # settleUpdateAttempt() 判定「没生效」→ 又走硬路径 → 用户看到「白闪之后页面又重载一遍」。
        check(f"{label}：整个过程只重载了一次（没有第二次兜底重载）", loads["n"] == 1, f"{loads['n']} 次")

        final = page.evaluate(
            """() => ({
                 v: document.body.dataset.appVersion,
                 bar: !document.getElementById('update-bar').hidden,
                 barText: (document.querySelector('#update-bar span') || {}).textContent || '',
                 toast: [...document.querySelectorAll('.toast, [data-testid="toast"]')].map((n) => n.textContent).join(' | '),
                 bodyText: (document.querySelector('#view-settings') || document.body).innerText || ''
               })"""
        )
        # ③ 落在新版本
        check(f"{label}：更新后版本变成 {nxt}", final["v"] == nxt, f"实际 {final['v']}")
        check(f"{label}：新代码确实生效（能看到发版标记）", f"[{nxt}]" in final["bodyText"])
        # ④ 横幅必须消失（v34 的 bug 就在这）
        check(f"{label}：更新后横幅消失（不再提示有新版本）", not final["bar"], final["barText"].strip())
        # ⑤ 更新完成的提示
        toast_ok = f"已更新到 {nxt}" in final["toast"] or f"已更新到 {nxt}" in final["bodyText"]
        check(f"{label}：给了「已更新到 {nxt}」的确认", toast_ok, final["toast"][:80])
        ctx.close()
    finally:
        httpd.shutdown()


def main() -> int:
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="vocab-update-test-"))
    site = make_site(tmp)
    cur = current_version(site)
    nxt = cur + "t"   # 一个测试专用版本号（跟真实版本号区分开）
    print(f"临时站点：{site}\n本地版本 {cur} → 模拟发成 {nxt}\n")
    with sync_playwright() as p:
        b = p.chromium.launch(channel="msedge", headless=True)
        run_case(b, site, cur, nxt, slow_sw=False, label="正常网络")
        # 第二次：再造一份干净的站点，这次拖慢 sw.js
        site2 = make_site(pathlib.Path(tempfile.mkdtemp(prefix="vocab-update-slow-")))
        run_case(b, site2, cur, nxt, slow_sw=True, label="慢网络(sw.js +800ms)")
        # 第三种：service worker 根本装不起来（真机上就出现过：设置页写着"没有 service worker"）
        # 此时**必须**还能发现新版本，并且靠「强制重新加载」更新上去
        site3 = make_site(pathlib.Path(tempfile.mkdtemp(prefix="vocab-update-nosw-")))
        run_case(b, site3, cur, nxt, slow_sw=False, label="没有 service worker", block_sw=True)
        b.close()

    print("\n" + "=" * 64)
    if FAIL:
        print(f"更新链路测试：{len(PASS)} 通过 / {len(FAIL)} 失败")
        for f in FAIL:
            print("  -", f)
        return 1
    print(f"RESULT: OK —— 更新链路 {len(PASS)} 项全通过（含「更新后横幅必须消失」这条回归）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
