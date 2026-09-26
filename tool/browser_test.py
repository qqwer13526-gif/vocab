"""跑一个"浏览器内测试页"，把结果打出来，有失败就返回退出码 1。

用法：
    python tool/browser_test.py tests/browser/db.test.html
    python tool/browser_test.py tests/browser/db.test.html --port 5195 --budget 20000

测试页把结果写进 <pre id="result">（见 tests/browser/harness.js）。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import testserver  # noqa: E402
from headless import main_guard, read_result, run_dom  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def run(rel_path: str, port: int = 5191, budget: int | None = None, timeout: float = 120.0, extra: tuple[str, ...] = ()) -> int:
    page = (ROOT / rel_path).resolve()
    if not page.exists():
        print(f"找不到测试页：{page}")
        return 1
    url_path = page.relative_to(ROOT).as_posix()

    httpd, base = testserver.start_free(port)
    print(f"测试页：{url_path}   服务：{base}")
    try:
        # budget=None：靠页面自己拖住 load 事件，测试结束才 dump
        dom = run_dom(f"{base}/{url_path}", budget_ms=budget, timeout=timeout, extra=extra)
    finally:
        httpd.shutdown()
        httpd.server_close()

    res = read_result(dom)
    if not res:
        print("[FAIL] 测试页没有产出结果（模块加载失败或脚本崩了？）")
        print("页面片段：", (dom or "")[:600].replace("\n", " "))
        print("RESULT: FAIL")
        return 1

    if "results" not in res:
        print(f"[FAIL] 测试没跑完，页面停在：{json.dumps(res, ensure_ascii=False)}")
        print("RESULT: FAIL")
        return 1

    for r in res["results"]:
        print(f"[{'PASS' if r['ok'] else 'FAIL'}] {r['name']}" + (f"   {r['detail']}" if r["detail"] else ""))
    print(f"\n{url_path}: {res['pass']}/{res['total']} passed")
    if res.get("fail"):
        print("失败项：")
        for r in res["results"]:
            if not r["ok"]:
                print(f"  - {r['name']}  {r['detail']}")
    print("RESULT: " + ("FAIL" if res.get("fail") else "OK"))
    return 1 if res.get("fail") else 0


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    opts = {a.split("=")[0]: a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--") and "=" in a}
    flags = {a for a in sys.argv[1:] if a.startswith("--") and "=" not in a}
    if not args:
        print(__doc__)
        return 2
    budget = int(opts["--budget"]) if "--budget" in opts else None
    extra: tuple[str, ...] = ()
    if "--reduced-motion" in flags:
        # 让浏览器报告"系统已开启减弱动效"，用来验证 CSS 的对应处理真的生效
        extra = ("--force-prefers-reduced-motion",)
    return run(args[0], port=int(opts.get("--port", 5191)), budget=budget, extra=extra)


if __name__ == "__main__":
    main_guard(main)
