"""无头 Edge 的共用管道：跑一个页面，把最终 DOM 取回来。

所有验证脚本都用它，避免把浏览器命令行拼两遍。

原则（见 ~/.dsh/AGENTS.md 第 5 节）：
- 一律 `--headless=new`，绝不开可见窗口，不抢用户焦点
- 每次用独立 profile 目录（临时），需要跨次保留状态时由调用方传入同一目录
"""

from __future__ import annotations

import html as _html
import json
import os
import re
import subprocess
import sys
import tempfile
import time

_EDGE_CANDIDATES = [
    os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
    os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
    os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"),
]

_RESULT_RE = re.compile(r'<pre[^>]*id="result"[^>]*>(.*?)</pre>', re.S | re.I)


def find_edge() -> str:
    env = os.environ.get("DSH_EDGE")
    if env and os.path.exists(env):
        return env
    for c in _EDGE_CANDIDATES:
        if os.path.exists(c):
            return c
    raise SystemExit("找不到 msedge.exe；可用环境变量 DSH_EDGE 指定路径")


def run_dom(
    url: str,
    *,
    budget_ms: int | None = 8000,
    profile: str | None = None,
    size: tuple[int, int] | None = None,
    screenshot: str | None = None,
    keep_profile: bool = False,
    timeout: float = 90.0,
) -> str:
    """加载 url，返回最终 DOM 文本。

    profile 传入目录则跨次复用（Cookie / service worker / IndexedDB 都活在里面）；
    否则自动建临时目录，用完删除。

    budget_ms=None 表示不加 --virtual-time-budget：dump 等真正的 load 事件。
    需要页面自己"拖住 load 事件"（比如挂一个慢请求）时用这个。
    """
    tmp = None
    if profile is None:
        tmp = tempfile.mkdtemp(prefix="dsh-edge-")
        profile = tmp
    os.makedirs(profile, exist_ok=True)

    args = [
        find_edge(),
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-sync",
        "--disable-background-networking",
        "--disable-features=Translate,MediaRouter",
        f"--user-data-dir={profile}",
    ]
    if budget_ms:
        args.append(f"--virtual-time-budget={int(budget_ms)}")
    if size:
        args.append(f"--window-size={int(size[0])},{int(size[1])}")
    if screenshot:
        args.append(f"--screenshot={os.path.abspath(screenshot)}")
    else:
        args.append("--dump-dom")
    args.append(url)

    try:
        out = subprocess.run(
            args,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        return out.stdout or ""
    finally:
        if tmp and not keep_profile:
            # Edge 有时还攥着 profile 文件，删不掉就算了（临时目录，系统会收）
            for _ in range(3):
                try:
                    import shutil

                    shutil.rmtree(tmp, ignore_errors=False)
                    break
                except Exception:
                    time.sleep(0.4)


def read_result(dom: str) -> dict | None:
    """读取页面写在 <pre id="result"> 里的 JSON 测试结果。"""
    m = _RESULT_RE.search(dom or "")
    if not m:
        return None
    raw = _html.unescape(m.group(1)).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"_raw": raw}


def body_flag(dom: str, key: str) -> str | None:
    """从 <body ... data-key="value"> 里取一个标记。"""
    m = re.search(r"<body[^>]*\bdata-" + re.escape(key) + r'="([^"]*)"', dom or "", re.I)
    return m.group(1) if m else None


class Report:
    """极简的断言收集器：跑完全部再汇总，失败返回退出码 1。"""

    def __init__(self, title: str):
        self.title = title
        self.rows: list[tuple[str, bool, str]] = []

    def check(self, name: str, ok, detail: str = "") -> bool:
        ok = bool(ok)
        self.rows.append((name, ok, detail))
        print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f"   {detail}" if detail else ""))
        return ok

    def finish(self) -> int:
        bad = [r for r in self.rows if not r[1]]
        print(f"\n{self.title}: {len(self.rows) - len(bad)}/{len(self.rows)} passed")
        if bad:
            print("失败项：")
            for n, _, d in bad:
                print(f"  - {n}  {d}")
        print("RESULT: " + ("FAIL" if bad else "OK"))
        return 1 if bad else 0


def main_guard(fn):
    """统一入口：捕获异常也算失败，便于 pwsh 看退出码。"""
    try:
        sys.exit(fn())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        import traceback

        traceback.print_exc()
        print(f"RESULT: FAIL ({type(exc).__name__}: {exc})")
        sys.exit(1)
