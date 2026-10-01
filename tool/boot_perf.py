"""量启动耗时：网络 / JS+DB / 版本检查 三段分开看。

跑法：python tool/boot_perf.py

三组对照：
  冷启动              新 profile（SW 要现装，全部资源走网络）
  同 profile 连开两次  第一次让 SW 装完接管，第二次就该走缓存
  版本检查慢 5 秒      把版本检查指到一个慢端点，看首屏会不会等它

为什么要有它：v29 之后用户反馈「进入太慢」。用这个量出来是**网络那段**慢
（冷启动 23 个请求 / ≈243 KB，而 app 自己只花 20~50ms），版本检查不挡首屏
（慢 5 秒时首屏照样 100ms 内出来，那一刻 body.dataset.update 还是 "no"）。
"""

from __future__ import annotations

import json
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tool"))

import headless  # noqa: E402
import testserver  # noqa: E402

PROBE = "tool/boot-probe.html"


def run(base: str, profile: str, query: str, timeout: float = 120.0) -> list[dict]:
    dom = headless.run_dom(
        f"{base.rstrip('/')}/{PROBE}?{query}",
        budget_ms=None,   # 真时间：不要用 --virtual-time-budget，会把计时全打乱
        profile=profile,  # 同一个目录 = SW / IndexedDB 都活着
        size=(420, 900),
        timeout=timeout,
    )
    got = headless.read_result(dom)
    if not got:
        print("   !! 探针没回结果，DOM 末尾 600 字：")
        print("   " + (dom or "")[-600:].replace("\n", "\n   "))
        return []
    if got.get("stage") != "done":
        print("   !! 探针没跑完：" + str(got))
    return got.get("runs") or []


def main() -> int:
    httpd, base = testserver.start_free(5207)
    profile = tempfile.mkdtemp(prefix="vocab-perf-")
    print("服务：" + base + "    profile：" + profile + "\n")
    rows: list[dict] = []
    try:
        print("① 冷启动（新 profile，SW 现装）…")
        rows += run(base, profile, "label=cold")
        print("② 同 profile 连开两次（第一次让 SW 装上，第二次才该走缓存）…")
        rows += run(base, profile, "label=warm&twice=1")
        print("③ 版本检查慢 5 秒（首屏会不会等它）…")
        rows += run(base, profile, "label=slow-update&slow=1")
    finally:
        httpd.shutdown()

    head = (
        f"{'情形':<14}{'网络 ms':>8}{'JS+DB ms':>10}{'首屏 ms':>9}{'FCP ms':>8}"
        f"{'请求数':>7}{'传输 KB':>9}{'SW 接管':>9}{'渲染时 data-update':>18}"
    )
    print("\n" + head)
    print("-" * len(head))
    for r in rows:
        print(
            f"{r['tag']:<14}{r['net_ms']:>8}{r['app_ms']:>10}{r['home_ms']:>9}"
            f"{str(r['fcp']):>8}{r['requests']:>7}{r['kb']:>9}{str(r['sw_controlled']):>9}{str(r['update_at_render']):>18}"
        )
    print("\n最慢的 5 个请求（名字=毫秒）：")
    for r in rows:
        print("  " + r["tag"] + ": " + ", ".join(f"{n}={d}" for n, d in r["slowest"]))

    bad = [r["tag"] for r in rows if r["update_at_render"] not in ("no", "ready")]
    print("\nRESULT: " + ("OK" if rows else "FAIL（一个情形都没量到）"))
    return 0 if rows else 1


if __name__ == "__main__":
    sys.exit(headless.main_guard(main))
