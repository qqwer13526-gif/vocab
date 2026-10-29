"""交接自检：版本三处一致 + changelog 第一条 = 当前版本 + 关键文件在不在。

跑法：python check_handover.py  （在仓库根目录）
"""

from __future__ import annotations

import json
import pathlib
import re

R = pathlib.Path(__file__).resolve().parent
ok = True


def say(label: str, good: bool, detail: str = "") -> None:
    global ok
    ok = ok and good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}" + (f"   {detail}" if detail else ""))


ver = json.loads((R / "version.json").read_text(encoding="utf-8"))["version"]
sw = re.search(r"VERSION = '([^']+)'", (R / "sw.js").read_text(encoding="utf-8")).group(1)
app = re.search(r"APP_VERSION = '([^']+)'", (R / "src" / "version.js").read_text(encoding="utf-8")).group(1)
first = re.search(r"v: '([^']+)'", (R / "src" / "changelog.js").read_text(encoding="utf-8")).group(1)

say("版本三处一致", ver == sw == app, f"version.json={ver} sw.js={sw} version.js={app}")
say("changelog 第一条 = 当前版本", first == app, f"changelog={first} APP_VERSION={app}")

for rel in ("AGENTS.md", "SPEC.md", "README.md", "tool/bump.py", "tool/verify_all.py", "docs/导入表格规范.md"):
    say(f"关键文件存在：{rel}", (R / rel).is_file())

# 交接不该把密钥写进来
leaks = []
for p in list(R.rglob("*.md")) + list(R.rglob("*.py")) + list(R.rglob("*.js")):
    if ".git" in p.parts:
        continue
    t = p.read_text(encoding="utf-8", errors="ignore")
    if re.search(r"(gh[pousr]_[A-Za-z0-9]{20,})|(github_pat_[A-Za-z0-9_]{20,})", t):
        leaks.append(str(p.relative_to(R)))
say("没有把 GitHub token 写进文件", not leaks, ", ".join(leaks))

print("\nRESULT:", "OK" if ok else "FAIL")
