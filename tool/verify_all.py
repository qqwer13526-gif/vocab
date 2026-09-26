"""一条命令跑完全部验证，并对照 SPEC.md §10 的验收清单。

用法：
    python tool/verify_all.py            # 全部跑
    python tool/verify_all.py --quick    # 跳过浏览器界面测试（只跑单元测试与资源检查）

每一步都独立跑、独立报结果；有任何一步失败，整体退出码为 1。
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
NODE_BIN = "node"

STEPS: list[tuple[str, list[str], str]] = [
    ("① 纯逻辑单元测试（SRS / 判定 / 解析）", [NODE_BIN, "--test", "tests/**/*.test.js"], "unit"),
    ("② PWA 外壳与离线可用", [PY, "tool/verify_sw.py"], "sw"),
    ("②b PWA 挂在子路径下（模拟 GitHub Pages 的 /vocab/）", [PY, "tool/verify_sw.py", "--prefix=/vocab"], "sw"),
    ("③ 数据层 db.js（浏览器内）", [PY, "tool/browser_test.py", "tests/browser/db.test.html"], "ui"),
    ("④ 界面：库列表", [PY, "tool/browser_test.py", "tests/browser/ui-home.test.html"], "ui"),
    ("⑤ 界面：练习", [PY, "tool/browser_test.py", "tests/browser/ui-practice.test.html"], "ui"),
    ("⑥ 界面：导入", [PY, "tool/browser_test.py", "tests/browser/ui-import.test.html"], "ui"),
    ("⑦ 界面：词条", [PY, "tool/browser_test.py", "tests/browser/ui-word.test.html"], "ui"),
    ("⑧ 布局：各界面无横向滚动", [PY, "tool/browser_test.py", "tests/browser/layout.test.html"], "ui"),
    ("⑨ 无障碍与移动端（常规）", [PY, "tool/browser_test.py", "tests/browser/a11y.test.html"], "ui"),
    ("⑩ 无障碍与移动端（系统开启减弱动效）", [PY, "tool/browser_test.py", "tests/browser/a11y.test.html", "--reduced-motion"], "ui"),
    ("⑪ 直接读 Excel（.xlsx）", [PY, "tool/browser_test.py", "tests/browser/xlsx.test.html"], "ui"),
]

CHECKLIST: list[tuple[str, list[int] | None]] = [
    ("node --test 全绿（SRS / 判定 / 解析）", [1]),
    ("浏览器内测试页全绿（IndexedDB 增删改查、软删除、事务原子性）", [3]),
    ("四个界面都能打开并走完一次真实操作（导入 → 练习 → 判定 → 进度更新）", [4, 5, 6, 7]),
    ("断网后刷新仍能用（service worker 生效）", [2]),
    ("部署到子路径（GitHub Pages 的 /vocab/）后 service worker 仍正常", [11]),
    ("手机与桌面尺寸都不出现横向滚动、不溢出", [8]),
    ("无障碍：按钮有名字、输入有标签、点按区域够大、输入框字号 ≥16px、减弱动效生效", [9, 10]),
    ("iPhone 真机安装（Safari → 添加到主屏幕 → 离线可用）", None),
]


def main() -> int:
    quick = "--quick" in sys.argv
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    results: list[tuple[str, bool, str]] = []

    for title, cmd, kind in STEPS:
        if quick and kind == "ui":
            results.append((title, True, "（--quick 跳过）"))
            print(f"\n=== {title} ===\n跳过")
            continue
        print(f"\n=== {title} ===")
        proc = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
        tail = [ln for ln in (proc.stdout or "").splitlines() if ln.strip()]
        for ln in tail[-14:]:
            print("   ", ln)
        if proc.returncode != 0:
            # 失败时把具体失败项也打出来，不然只看到 tail 会不知道该修什么
            bad = [ln for ln in tail if "[FAIL]" in ln or "失败项" in ln or ln.strip().startswith("- ")]
            if bad:
                print("    ---- 失败明细 ----")
                for ln in bad[:20]:
                    print("   ", ln)
        if proc.returncode != 0 and (proc.stderr or "").strip():
            print("    [stderr]", (proc.stderr or "").strip().splitlines()[-1][:300])
        last = next((ln for ln in reversed(tail) if "passed" in ln or "RESULT" in ln), "")
        results.append((title, proc.returncode == 0, last.strip() or f"exit={proc.returncode}"))

    print("\n" + "=" * 62)
    print("验证汇总")
    print("=" * 62)
    for title, ok, last in results:
        print(f"{'PASS' if ok else 'FAIL'}  {title}   {last}")

    step_ok = {i + 1: ok for i, (_, ok, _) in enumerate(results)}
    print("\n对照 SPEC.md §10 验收清单：")
    for text, ids in CHECKLIST:
        if ids is None:
            print(f"  ----  {text}（由你在手机上确认）")
        else:
            print(f"  {'PASS' if all(step_ok.get(i, False) for i in ids) else 'FAIL'}  {text}")

    failed = [t for t, ok, _ in results if not ok]
    if failed:
        print("\n失败的步骤：")
        for f in failed:
            print("  -", f)
    print("\nRESULT: " + ("FAIL" if failed else "OK"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
