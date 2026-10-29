"""发版：三处版本号一起改（仓库自带版，与所在路径无关）。

用法：
    python tool/bump.py v57 v58

改的三处（必须一致，tool/verify_all.py 会检查）：
    sw.js 的 VERSION  ·  src/version.js 的 APP_VERSION  ·  version.json 的 version
"""

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]  # 仓库根目录（不依赖绝对路径 ✓）

if len(sys.argv) > 2:
    OLD, NEW = sys.argv[1], sys.argv[2]
else:
    print(__doc__)
    sys.exit(2)

for p in (ROOT / "sw.js", ROOT / "src" / "version.js", ROOT / "version.json"):
    s = p.read_text(encoding="utf-8")
    if OLD not in s:
        print(f"!! {p.name} 里没有 {OLD}")
        sys.exit(1)
    p.write_text(s.replace(OLD, NEW), encoding="utf-8")
    print(f"{p.name}: {OLD} → {NEW}")

print(
    "校验：",
    json.loads((ROOT / "version.json").read_text(encoding="utf-8"))["version"],
    re.search(r"VERSION = '([^']+)'", (ROOT / "sw.js").read_text(encoding="utf-8")).group(1),
    re.search(r"APP_VERSION = '([^']+)'", (ROOT / "src" / "version.js").read_text(encoding="utf-8")).group(1),
)
