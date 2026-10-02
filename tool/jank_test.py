"""切页卡顿的可重复回归测试（v37 第 ⑳ 步）。

⚠️ 先说清它的局限（别把它当真理）：
    无头 Chromium **没有真实 GPU 合成路径** —— backdrop-filter、混合模式、建层的开销
    在这里基本不出现。所以这个测试**测不出手机上那种卡**，它只守两件事：
      ① 主线程上有没有出现明显的长帧（>32ms 且成片出现）
      ② 切页相关的代码有没有把"每帧的活"越堆越多
    真机数字以 App 里的帧率浮层（?perf=1）为准 —— 那才是唯一裁判。

跑法：python tool/jank_test.py
"""

from __future__ import annotations

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tool"))

import testserver  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BUDGET = 32          # 一帧超过它就当掉帧（60Hz 两帧）
SWITCHES = ["#/settings", "#/", "#/import", "#/", "#/word", "#/settings", "#/"]
LIMIT_WORST = 80     # 粗粒度：任何一帧不该超过 80ms（真出长任务一般都 100ms+）
LIMIT_DROPS = 2      # 6~7 次切页里，>32ms 的帧不该超过 2 个

PASS, FAIL = [], []


def check(label: str, ok: bool, detail: str = "") -> None:
    (PASS if ok else FAIL).append(label)
    print(("[PASS] " if ok else "[FAIL] ") + label + (f"   {detail}" if detail else ""))


SAMPLE = """() => {
  window.__f = [];
  let last = performance.now();
  const tick = (now) => {
    window.__f.push(Math.round(now - last));
    last = now;
    if (window.__f.length < 400) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}"""


def main() -> int:
    httpd, base = testserver.start_free(5291)
    base = base.rstrip("/") + "/"
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(channel="msedge", headless=True)
            ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
            page = ctx.new_page()
            page.goto(base + "tool/seed_demo.html?seed=1", wait_until="load")
            page.wait_for_timeout(1800)
            page.goto(base, wait_until="load")
            page.wait_for_timeout(1200)

            # 逐档量：满速 / 4× / 8×，看主线程有没有被堆爆
            cdp = ctx.new_cdp_session(page)
            for rate, label in ((1, "满速"), (4, "4× 降速"), (8, "8× 降速")):
                cdp.send("Emulation.setCPUThrottlingRate", {"rate": rate})
                page.evaluate("() => { location.reload(); }")
                page.wait_for_timeout(1500)
                page.evaluate(SAMPLE)
                page.wait_for_timeout(200)
                for target in SWITCHES:
                    page.evaluate("(h) => { location.hash = h; }", target)
                    page.wait_for_timeout(560)
                frames = page.evaluate("() => window.__f")
                worst = max(frames) if frames else 0
                drops = len([f for f in frames if f > BUDGET])
                avg = round(sum(frames) / max(1, len(frames)), 1)
                print(f"  {label}: 最长帧 {worst}ms · 平均 {avg}ms · 掉帧 {drops}/{len(frames)}（{len(SWITCHES)} 次切页）")
                if rate == 4:
                    check("4× 降速下没有超过 80ms 的长帧", worst <= LIMIT_WORST, f"{worst}ms")
                    check(f"4× 降速下掉帧不超过 {LIMIT_DROPS} 个", drops <= LIMIT_DROPS, f"{drops} 个")
            b.close()
    finally:
        httpd.shutdown()

    print("\n" + "=" * 64)
    if FAIL:
        print(f"切页卡顿测试：{len(PASS)} 通过 / {len(FAIL)} 失败")
        for f in FAIL:
            print("  -", f)
        print("提示：数字以真机 ?perf=1 浮层为准（无头环境没有真实 GPU 合成路径）")
        return 1
    print(f"RESULT: OK —— {len(PASS)} 项通过（粗粒度回归；真机数字请看 ?perf=1 浮层）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
