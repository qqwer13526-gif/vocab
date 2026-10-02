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

STEPS: list[tuple[str, str, list[str], str]] = [
    # (标题, key, 命令, 类型)。key 是"验收清单"引用的稳定名字 —— 别用序号，插一步就全错位了。
    ("① 纯逻辑单元测试（SRS / 判定 / 解析）", "unit", [NODE_BIN, "--test", "tests/**/*.test.js"], "unit"),
    ("② PWA 外壳与离线可用", "sw", [PY, "tool/verify_sw.py"], "sw"),
    ("②b PWA 挂在子路径下（模拟 GitHub Pages 的 /vocab/）", "sw-prefix", [PY, "tool/verify_sw.py", "--prefix=/vocab"], "sw"),
    ("②c 配色对比度（WCAG AA；提高对比度模式下 AAA 7:1）", "contrast", [PY, "tool/check_contrast.py"], "unit"),
    ("③ 数据层 db.js（浏览器内）", "db", [PY, "tool/browser_test.py", "tests/browser/db.test.html"], "ui"),
    ("④ 界面：库列表", "ui-home", [PY, "tool/browser_test.py", "tests/browser/ui-home.test.html"], "ui"),
    ("⑤ 界面：练习", "ui-practice", [PY, "tool/browser_test.py", "tests/browser/ui-practice.test.html"], "ui"),
    ("⑥ 界面：导入", "ui-import", [PY, "tool/browser_test.py", "tests/browser/ui-import.test.html"], "ui"),
    ("⑦ 界面：词条", "ui-word", [PY, "tool/browser_test.py", "tests/browser/ui-word.test.html"], "ui"),
    ("⑦b 界面：底部导航（三项 / aria-current / 点按尺寸 / 练习页隐藏）", "ui-nav", [PY, "tool/browser_test.py", "tests/browser/ui-nav.test.html"], "ui"),
    ("⑦c 界面：删除词库（两步确认 / 只删库不删词 / 撤销）", "ui-lib-delete", [PY, "tool/browser_test.py", "tests/browser/ui-lib-delete.test.html"], "ui"),
    ("⑧ 布局：各界面无横向滚动", "layout", [PY, "tool/browser_test.py", "tests/browser/layout.test.html"], "ui"),
    ("⑨ 无障碍与移动端（常规）", "a11y", [PY, "tool/browser_test.py", "tests/browser/a11y.test.html"], "ui"),
    ("⑩ 无障碍与移动端（系统开启减弱动效）", "a11y-reduced", [PY, "tool/browser_test.py", "tests/browser/a11y.test.html", "--reduced-motion"], "ui"),
    ("⑪ 直接读 Excel（.xlsx）", "xlsx", [PY, "tool/browser_test.py", "tests/browser/xlsx.test.html"], "ui"),
    ("⑫ 补音标（下载→匹配→写库）", "phonetic", [PY, "tool/browser_test.py", "tests/browser/phonetic.test.html"], "ui"),
    ("⑬ 设置页：版本/检查更新/数据状态/备份恢复", "settings", [PY, "tool/browser_test.py", "tests/browser/settings.test.html"], "ui"),
    ("⑭ 生疏/熟记专项：内置于词库（总词库=全局）+ 专项练习", "smart", [PY, "tool/browser_test.py", "tests/browser/smart.test.html"], "ui"),
    ("⑮ 手机基线：键盘不遮输入框 / 不缩放 / 不误触发下拉刷新", "mobile", [PY, "tool/browser_test.py", "tests/browser/mobile.test.html"], "ui"),
    ("⑯ 朗读单词（只读单词 / 口音语速 / 不漏答案 / 降级）", "speech", [PY, "tool/browser_test.py", "tests/browser/speech.test.html"], "ui"),
    ("⑰ 主题三态 / 氛围光 / 按压反馈", "theme", [PY, "tool/browser_test.py", "tests/browser/theme.test.html"], "ui"),
    ("⑱ 液态玻璃底栏 / 数字滚动 / 交错入场", "glass", [PY, "tool/browser_test.py", "tests/browser/glass.test.html"], "ui"),
]

CHECKLIST: list[tuple[str, list[str] | None]] = [
    ("node --test 全绿（SRS / 判定 / 解析）", ["unit"]),
    ("浏览器内测试页全绿（IndexedDB 增删改查、软删除、事务原子性）", ["db"]),
    ("四个界面都能打开并走完一次真实操作（导入 → 练习 → 判定 → 进度更新）", ["ui-home", "ui-practice", "ui-import", "ui-word", "ui-nav"]),
    ("断网后刷新仍能用（service worker 生效）", ["sw"]),
    ("部署到子路径（GitHub Pages 的 /vocab/）后 service worker 仍正常", ["sw-prefix"]),
    ("手机与桌面尺寸都不出现横向滚动、不溢出", ["layout"]),
    ("无障碍：按钮有名字、输入有标签、点按区域够大、输入框字号 ≥16px、减弱动效生效", ["a11y", "a11y-reduced"]),
    ("Excel（.xlsx）能直接导入；音标能一键补齐（下载→匹配→写库，之后离线）", ["xlsx", "phonetic"]),
    ("配色对比度达标（正文 AA；提高对比度模式下 AAA）", ["contrast"]),
    ("删词库：两步确认、只删库不删词（词留在总词库）、6 秒内可撤销", ["ui-lib-delete"]),
    ("朗读单词：只读单词、口音/语速跟着设置、中→英答完才给喇叭、不支持的系统不渲染按钮", ["speech"]),
    ("主题三态（跟随系统/浅色/深色）：token 与 theme-color 跟着换、不闪白、氛围光染库色、按压反馈尊重减弱动效", ["theme"]),
    ("底栏玻璃：高光随滚动位移、压着卡片时变浓、不支持时退回实底；数字滚动与列表交错入场只在该播的时候播", ["glass"]),
    ("iPhone 真机安装（Safari → 添加到主屏幕 → 离线可用）", None),
]


def main() -> int:
    quick = "--quick" in sys.argv
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    results: list[tuple[str, str, bool, str]] = []  # (key, 标题, 是否通过, 最后一行)

    for title, key, cmd, kind in STEPS:
        if quick and kind == "ui":
            results.append((key, title, True, "（--quick 跳过）"))
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
        results.append((key, title, proc.returncode == 0, last.strip() or f"exit={proc.returncode}"))

    print("\n" + "=" * 62)
    print("验证汇总")
    print("=" * 62)
    for _, title, ok, last in results:
        print(f"{'PASS' if ok else 'FAIL'}  {title}   {last}")

    step_ok = {key: ok for key, _, ok, _ in results}
    # key 写错时不能静默当成"跳过"：清单里引用了不存在的步骤就直接报出来
    unknown = sorted({k for _, keys in CHECKLIST if keys for k in keys if k not in step_ok})
    if unknown:
        print("\n!! 验收清单引用了不存在的步骤 key：" + ", ".join(unknown))
    print("\n对照 SPEC.md §10 验收清单：")
    for text, keys in CHECKLIST:
        if keys is None:
            print(f"  ----  {text}（由你在手机上确认）")
        else:
            print(f"  {'PASS' if all(step_ok.get(k, False) for k in keys) else 'FAIL'}  {text}")

    failed = [t for _, t, ok, _ in results if not ok]
    if failed:
        print("\n失败的步骤：")
        for f in failed:
            print("  -", f)
    print("\nRESULT: " + ("FAIL" if failed else "OK"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
