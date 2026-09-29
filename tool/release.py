"""发一个 GitHub Release（发布页）：打应用 zip → 打 tag → 建 Release → 传附件。

为什么要它：这个项目是"零构建"的静态站点，所以"发版"= 打一个只含应用本体的 zip，
挂到 GitHub 的 Releases 页，别人就能下载自托管；同时写一份更新说明。

用法（需要 GitHub token，放环境变量 GH_TOKEN）：
    $env:GH_TOKEN = "ghp_xxx"
    python tool/release.py v25 "这一版改了什么"

token 从哪来：GitHub → Settings → Developer settings → Personal access tokens，
勾 `repo`（公开仓库其实只需要 `public_repo`）即可。
"""

from __future__ import annotations

import json
import mimetypes
import os
import pathlib
import ssl
import sys
import urllib.error
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
REPO = "qqwer13526-gif/vocab"
SITE = "https://qqwer13526-gif.github.io/vocab/"
CTX = ssl.create_default_context()

APP_FILES = [
    "index.html", "style.css", "sw.js", "manifest.webmanifest", "version.json",
    "icon-192.png", "icon-512.png", "apple-touch-icon.png",
    "fonts/InstrumentSerif-Regular.ttf", "fonts/OFL.txt", "README.md", "SPEC.md",
]


def api(url: str, method: str = "GET", payload: dict | None = None, raw: bytes | None = None, ctype: str | None = None):
    token = os.environ.get("GH_TOKEN", "")
    headers = {"User-Agent": "vocab-release", "Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    if raw is not None:
        data = raw
        headers["Content-Type"] = ctype or "application/octet-stream"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120, context=CTX) as r:
            body = r.read()
            return r.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode("utf-8", "replace")[:400]}


def build_zip(version: str) -> pathlib.Path:
    out = ROOT / "dist" / f"vocab-{version}.zip"
    out.parent.mkdir(exist_ok=True)
    src_files = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "src").glob("*.js"))
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in APP_FILES + src_files:
            p = ROOT / rel
            if p.exists():
                z.write(p, f"vocab-{version}/{rel}")
            else:
                print("  !! 缺文件：", rel)
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    version = sys.argv[1]
    notes = sys.argv[2] if len(sys.argv) > 2 else f"发版 {version}"
    if not os.environ.get("GH_TOKEN"):
        print("!! 先设 GH_TOKEN（GitHub → Settings → Developer settings → Personal access tokens）")
        return 1

    zip_path = build_zip(version)
    print(f"[1/4] 打好 {zip_path.name}：{zip_path.stat().st_size / 1024:.0f} KB")

    code, res = api(f"https://api.github.com/repos/{REPO}", "PATCH", {"homepage": SITE})
    print(f"[2/4] 仓库 Website 指向 Pages：{code}")

    body = (
        f"{notes}\n\n### 直接用（不用下载）\n\n打开 **{SITE}**\n\n"
        "| 平台 | 装成 App |\n|---|---|\n"
        "| 安卓 | Chrome → 右上 `⋮` → 「安装应用」 |\n"
        "| iPhone | Safari → 分享 → 「添加到主屏幕」（⚠️ 别删图标） |\n"
        "| 电脑 | 直接打开网址 |\n\n"
        f"### 下载\n\n- **`{zip_path.name}`** —— 应用本体（零依赖、无构建），解压到任意静态服务器即可自托管\n"
        "- GitHub 自动附的 Source code (zip / tar.gz)\n"
    )
    code, res = api(
        f"https://api.github.com/repos/{REPO}/releases",
        "POST",
        {"tag_name": version, "target_commitish": "main", "name": version, "body": body, "draft": False, "prerelease": False},
    )
    if code >= 300:
        print("!! 建 Release 失败：", code, res)
        return 1
    print(f"[3/4] Release 建好：{res.get('html_url')}")

    ctype = mimetypes.guess_type(zip_path.name)[0] or "application/zip"
    code, res = api(f"{res['upload_url'].split('{')[0]}?name={zip_path.name}", "POST", raw=zip_path.read_bytes(), ctype=ctype)
    print(f"[4/4] 附件：{code} {res.get('name')}")
    print("提示：本地记得 git tag 一下再 push（或让 GitHub 从 Release 自动建 tag）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
