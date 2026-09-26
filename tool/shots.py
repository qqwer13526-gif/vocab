"""给界面截图（开发 / 验收用）。

流程：起测试服务 → tool/seed_demo.html?seed=1 灌示例数据（**共用同一个浏览器 profile**，
否则数据不在同一个 IndexedDB 里）→ 打开 tool/shot.html（把应用装进固定尺寸 iframe
并等它渲染完）→ 截图 → 按 iframe 尺寸裁掉窗口多出来的部分。

用法：
    python tool/shots.py                 # 默认首页：手机浅色 + 手机深色 + 桌面浅色
    python tool/shots.py practice "#/practice"     # 换界面
输出：shots/<前缀>-{phone,phone-dark,desktop}.png
"""

from __future__ import annotations

import sys
import tempfile
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import testserver  # noqa: E402
from headless import main_guard, run_dom  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "shots"
PHONE = (390, 844)
DESKTOP = (1280, 900)
# Chromium 的窗口有最小宽度（约 500），所以窗口开得比视口大，再裁掉多余部分
WINDOW_MIN_W = 520


def one(base: str, profile: str, prefix: str, hash_: str, theme: str, size: tuple[int, int], paste: str = "") -> Path:
    w, h = size
    suffix = "phone" if size == PHONE else "desktop"
    if theme == "dark":
        suffix += "-dark"
    path = OUT / f"{prefix}-{suffix}.png"
    win = (max(WINDOW_MIN_W, w), h)
    # hash 里带 # 和 ?，必须编码，否则会被当成 URL 片段截断（截出来还是首页）
    url = f"{base}/tool/shot.html?w={w}&h={h}&theme={theme}&hash={urllib.parse.quote(hash_, safe='')}"
    if paste:
        # 必须以 / 开头：这是在 iframe 里 fetch，相对路径会解析到 /tool/ 下面
        p = paste if paste.startswith("/") else "/" + paste
        url += f"&paste={urllib.parse.quote(p, safe='')}"
    run_dom(url, budget_ms=None, profile=profile, size=win, screenshot=str(path), timeout=120)

    if win != (w, h):
        from PIL import Image

        with Image.open(path) as im:
            im.crop((0, 0, min(w, im.width), min(h, im.height))).save(path)
    return path


def main() -> int:
    argv = sys.argv[1:]
    paste = ""
    for a in list(argv):
        if a.startswith("--paste="):
            paste = a.split("=", 1)[1]
            argv.remove(a)
    prefix = argv[0] if argv else "home"
    hash_ = argv[1] if len(argv) > 1 else "#/"
    OUT.mkdir(exist_ok=True)
    profile = tempfile.mkdtemp(prefix="dsh-shot-")

    httpd, base = testserver.start_free(5203)
    try:
        seeded = run_dom(f"{base}/tool/seed_demo.html?seed=1", budget_ms=None, profile=profile, timeout=120)
        print("示例数据：", "已灌入" if "已灌入" in seeded else "疑似失败（截图可能是空的）")
        jobs = [("light", PHONE), ("dark", PHONE), ("light", DESKTOP)]
        for theme, size in jobs:
            p = one(base, profile, prefix, hash_, theme, size, paste)
            print(f"已生成 {p.relative_to(ROOT)}  ({p.stat().st_size} 字节)")
    finally:
        httpd.shutdown()
        httpd.server_close()
    return 0


if __name__ == "__main__":
    main_guard(main)
