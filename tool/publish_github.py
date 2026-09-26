"""把项目发布到 GitHub Pages（永久 https 地址，iPhone 才能"添加到主屏幕"）。

它做四件事：
    1. 从 Windows 凭据管理器取出 git 凭据（**绝不打印 token**）
    2. 查这个账号是谁、有没有建仓库的权限
    3. 需要的话创建仓库，把代码推上去
    4. 打开 GitHub Pages，并等它构建好

用法：
    python tool/publish_github.py --check      # 只体检：账号、权限、仓库是否存在，什么都不改
    python tool/publish_github.py --repo vocab # 创建/更新仓库并开启 Pages
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://api.github.com"


def get_credential() -> tuple[str, str]:
    """从 git 凭据管理器取 github.com 的账号密码。返回 (user, token)，调用方负责不外泄。"""
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never"}
    try:
        p = subprocess.run(
            ["git", "-c", "credential.helper=manager", "credential", "fill"],
            input="protocol=https\nhost=github.com\n\n",
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=30,
        )
    except Exception as e:  # noqa: BLE001
        raise SystemExit(f"取凭据失败：{type(e).__name__}: {e}")
    data = {}
    for line in (p.stdout or "").splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            data[k.strip()] = v.strip()
    if not data.get("password"):
        raise SystemExit(
            "凭据管理器里没有可用的 github.com 凭据。\n"
            "可以在这个目录里先手动推一次（会让你登录一次，之后凭据就存下来了）：\n"
            "    git remote add origin https://github.com/<你的用户名>/vocab.git\n"
            "    git push -u origin main"
        )
    return data.get("username") or "", data["password"]


def api(path: str, token: str, method: str = "GET", body: dict | None = None) -> tuple[int, dict, dict]:
    req = urllib.request.Request(
        API + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "vocab-pwa-publisher",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "{}"), dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw or "{}"), dict(e.headers)
        except json.JSONDecodeError:
            return e.code, {"message": raw[:300]}, dict(e.headers)


def git(*args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)


def main() -> int:
    check_only = "--check" in sys.argv
    repo_name = "vocab"
    for a in sys.argv[1:]:
        if a.startswith("--repo"):
            repo_name = a.split("=", 1)[1] if "=" in a else repo_name
    argv = [a for a in sys.argv[1:] if not a.startswith("--")]
    if argv:
        repo_name = argv[0]

    user, token = get_credential()
    status, me, headers = api("/user", token)
    if status != 200:
        print(f"凭据无效（HTTP {status}）：{me.get('message')}")
        return 1
    login = me["login"]
    scopes = headers.get("x-oauth-scopes", "（未返回，可能是细粒度 token）")
    print(f"账号：{login}（{me.get('name') or '未填姓名'}）")
    print(f"token 权限范围：{scopes}")
    print(f"仓库：{login}/{repo_name}")

    status, repo, _ = api(f"/repos/{login}/{repo_name}", token)
    exists = status == 200
    print(f"仓库状态：{'已存在' if exists else '不存在（需要创建）'}（HTTP {status}）")

    if check_only:
        if not exists:
            print("\n--check 模式：没有创建任何东西。要真的发布就运行：python tool/publish_github.py")
        else:
            st, pages, _ = api(f"/repos/{login}/{repo_name}/pages", token)
            print(f"Pages：{'已开启 ' + str(pages.get('html_url')) if st == 200 else '还没开启'}（HTTP {st}）")
        return 0

    if not exists:
        st, created, _ = api(
            "/user/repos",
            token,
            "POST",
            {
                "name": repo_name,
                "description": "自己的背单词 PWA：两个方向手打练习 + Leitner 遗忘曲线，离线可用",
                "private": False,
                "has_issues": False,
                "has_wiki": False,
                "auto_init": False,
            },
        )
        if st not in (200, 201):
            print(f"创建仓库失败（HTTP {st}）：{created.get('message')}")
            print("如果提示权限不足，就自己在 https://github.com/new 建一个空的 public 仓库，再重新运行本脚本。")
            return 1
        print(f"已创建仓库：{created.get('html_url')}")

    remote = f"https://github.com/{login}/{repo_name}.git"
    if git("remote").stdout and "origin" in git("remote").stdout.split():
        git("remote", "set-url", "origin", remote)
    else:
        git("remote", "add", "origin", remote)
    print("远端：", remote)

    push = git("push", "-u", "origin", "main")
    print("推送：", (push.stdout or push.stderr or "").strip()[-300:])
    if push.returncode != 0:
        print("推送失败。可以在这个目录里手动跑：git push -u origin main")
        return 1

    st, pages, _ = api(f"/repos/{login}/{repo_name}/pages", token)
    if st == 404:
        st2, pages, _ = api(
            f"/repos/{login}/{repo_name}/pages",
            token,
            "POST",
            {"source": {"branch": "main", "path": "/"}},
        )
        print(f"开启 Pages：HTTP {st2}")
        if st2 not in (200, 201, 204):
            print("  ", pages.get("message"))
            print("  也可以自己在网页上点：Settings → Pages → Deploy from a branch → main / root → Save")
            return 1
    else:
        print(f"Pages 已经开着了：{pages.get('html_url')}")

    url = f"https://{login}.github.io/{repo_name}/"
    print(f"\n地址：{url}")
    print("GitHub 构建通常要 30–90 秒，我在等它…")
    for i in range(20):
        time.sleep(10)
        try:
            with urllib.request.urlopen(url, timeout=15) as r:
                body = r.read(4000).decode(errors="replace")
            if r.status == 200 and "背单词" in body:
                print(f"\n已经上线了：{url}")
                print("手机 Safari 打开它 → 分享 → 添加到主屏幕。")
                return 0
            print(f"  第 {i + 1} 次：HTTP {r.status}（还没构建好）")
        except Exception as e:  # noqa: BLE001
            print(f"  第 {i + 1} 次：{type(e).__name__}")
    print(f"\n还没等到构建完成，过一两分钟自己打开看看：{url}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
