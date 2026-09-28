"""线上（GitHub Pages）与本地的一致性检查。

发版流程的最后一步：`git push` 之后 Pages 要重建几分钟，用户那边看到的才是新版。
这个脚本把线上真实的那份抓下来，和本地逐文件比，确认"本地跑过的那两百多项验证，
对线上这份代码同样成立"。

比法有两处讲究：
  1. 从线上 sw.js 的预缓存清单里读要检查哪些文件 —— 清单就是应用真正要用的那批，
     不用在脚本里再维护一份（也就不会漏掉新加的模块）。
  2. **换行归一后再比**：git 在提交时会把 CRLF 规范化成 LF，所以线上是 LF、本地工作区
     往往是 CRLF；直接逐字节比会永远报"不一致"，那是假阳性（这个坑真踩过一次）。

用法：
    python tool/check_live.py                      # 默认线上地址
    python tool/check_live.py --base=http://127.0.0.1:5191   # 也可以拿来比本地服务
"""

from __future__ import annotations

import hashlib
import re
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BASE = "https://qqwer13526-gif.github.io/vocab/"
CTX = ssl.create_default_context()


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "vocab-check-live", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=40, context=CTX) as r:
        return r.read()


def norm(b: bytes) -> bytes:
    """换行归一：CRLF / CR → LF。"""
    return b.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()[:8]


def main() -> int:
    base = DEFAULT_BASE
    for a in sys.argv[1:]:
        if a.startswith("--base="):
            base = a.split("=", 1)[1]
    if not base.endswith("/"):
        base += "/"

    print(f"线上地址：{base}")
    try:
        sw = fetch(base + "sw.js").decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"!! 抓不到线上 sw.js：{exc}")
        return 1

    m = re.search(r"const VERSION = '([^']+)'", sw)
    print(f"线上 sw.js 的 VERSION = {m.group(1) if m else '（读不到）'}")

    assets = re.findall(r"^\s*'(\./[^']+)',", sw, re.M)
    print(f"从预缓存清单读出 {len(assets)} 个文件\n")

    bad: list[str] = []
    for rel in assets:
        local_rel = rel[2:]
        if local_rel == "":
            local_rel = "index.html"
        p = ROOT / local_rel
        if not p.exists():
            bad.append(f"{local_rel} 本地没有这个文件")
            print(f"  [缺失] {local_rel}")
            continue
        try:
            remote = fetch(base + rel[2:])
        except (urllib.error.URLError, TimeoutError) as exc:
            bad.append(f"{local_rel} 抓取失败：{exc}")
            print(f"  [抓不到] {local_rel}  {exc}")
            continue
        lraw, rraw = p.read_bytes(), remote
        if norm(lraw) == norm(rraw):
            extra = "（仅换行不同，内容一致）" if lraw != rraw else ""
            print(f"  [一致] {local_rel:26s} {sha(norm(lraw))} {extra}")
        else:
            bad.append(f"{local_rel} 本地={sha(norm(lraw))} 线上={sha(norm(rraw))}")
            print(f"  [不一致] {local_rel:26s} 本地={sha(norm(lraw))} 线上={sha(norm(rraw))}")

    # 版本三处一致（本地 sw.js 已经读过线上那份，这里只比本地文件）
    local_sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    local_js = (ROOT / "src" / "version.js").read_text(encoding="utf-8")
    local_json = (ROOT / "version.json").read_text(encoding="utf-8")
    v_sw = re.search(r"VERSION = '([^']+)'", local_sw).group(1)
    v_js = re.search(r"APP_VERSION = '([^']+)'", local_js).group(1)
    v_json = re.search(r'"version":\s*"([^"]+)"', local_json).group(1)
    live_v = m.group(1) if m else "?"
    print(f"\n版本：本地 sw={v_sw} version.js={v_js} version.json={v_json}；线上 sw={live_v}")
    if not (v_sw == v_js == v_json):
        bad.append("本地三处版本号不一致")
    if live_v != v_sw:
        bad.append(f"线上还是 {live_v}，本地已经是 {v_sw}（Pages 可能还在重建，等几分钟再看）")

    print(f"\n逐字节一致（换行归一后）：{len(assets) - len(bad)}/{len(assets)}")
    if bad:
        print("需要处理：")
        for b in bad:
            print("  -", b)
        print("\nRESULT: FAIL")
        return 1
    print("RESULT: OK —— 线上就是本地验证过的那份")
    return 0


if __name__ == "__main__":
    sys.exit(main())
