"""主题截图：强制浅色 / 强制深色 各出两张（首页 + 练习页），用来肉眼验收 v32。

为什么要单独一个脚本：`tool/shots.py` 是靠**仿真系统配色**出深浅两套图的，
而 v32 新增的是"**应用内手动强制**"这条路 —— 它不依赖系统配色，得靠 localStorage 里那个键触发。
跑法：python tool/shot_theme.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import testserver  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "shots"
SHOTS.mkdir(exist_ok=True)

JOBS = [("home", "#/", '[data-testid="tab-home"]'), ("practice", "#/practice?mode=review", '[data-testid="practice-prompt"]')]


def main() -> int:
    httpd, base = testserver.start_free(5209)
    base = base.rstrip("/") + "/"
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(channel="msedge", headless=True, args=["--disable-gpu", "--no-first-run"])
            for theme in ("light", "dark"):
                ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
                page = ctx.new_page()
                # ① 先灌示例数据（seed_demo 会写 IndexedDB；?seed=1 才会自动执行，否则要手点按钮）
                page.goto(base + "tool/seed_demo.html?seed=1", wait_until="load", timeout=60000)
                page.wait_for_timeout(2000)
                # ② 把"应用内强制主题"写进 localStorage —— 注意：**不**仿真系统配色，验的就是这条路
                page.evaluate("(t) => localStorage.setItem('vocab.theme', t)", theme)
                for name, hash_, wait in JOBS:
                    page.goto(base + hash_, wait_until="load", timeout=60000)
                    page.wait_for_selector(wait, timeout=30000)
                    page.wait_for_timeout(700)
                    out = SHOTS / f"theme-{theme}-{name}.png"
                    page.screenshot(path=str(out))
                    print("已生成 " + str(out.relative_to(ROOT)) + f"（{out.stat().st_size // 1024} KB）")
                ctx.close()
            b.close()
    finally:
        httpd.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
