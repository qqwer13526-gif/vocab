"""验证 PWA 外壳：静态资源齐全 + service worker 真的做到"断网还能用"。

这是任务 1 的验收脚本。

离线怎么验（关键）：
  1. 用 tool/sw_harness.html 装上 SW、等它激活、确认预缓存落地
  2. 让测试服务器**关掉自己**（/__shutdown 端点只存在于这个脚本里，不进产品代码）
  3. harness 导航回首页 —— 服务器已经没了，页面还能渲染出来，
     就只能是 service worker 从缓存里端出来的 → 离线可用的硬证据
  4. 重启服务器，读 tool/sw_report.html（harness 把体检数据存在 localStorage 里）

用法：python tool/verify_sw.py
"""

from __future__ import annotations

import json
import re
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import testserver  # noqa: E402
from headless import Report, body_flag, main_guard, read_result, run_dom  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PORT = 5181
PREFIX = ""  # --prefix=/vocab 时，模拟 GitHub Pages 的子路径部署


def start_server(port: int):
    """测试服务器（带 /__slow 与 /__shutdown，见 tool/testserver.py）。"""
    return testserver.start(port, PREFIX)


def get(url: str) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception:
        return 0, b""


def check() -> int:
    reps = Report(f"任务1 · PWA 外壳{PREFIX or ''}")
    httpd, base = start_server(PORT)
    profile = tempfile.mkdtemp(prefix="dsh-sw-")

    try:
        # ---- 1. 静态资源 ----
        st, body = get(base + "/")
        reps.check("index.html 可访问", st == 200 and b'<main id="app"' in body, f"HTTP {st}")

        st, mf = get(base + "/manifest.webmanifest")
        ok_json, detail = False, f"HTTP {st}"
        if st == 200:
            try:
                m = json.loads(mf.decode("utf-8"))
                icons = m.get("icons", [])
                ok_json = (
                    bool(m.get("name"))
                    and m.get("display") == "standalone"
                    and bool(m.get("start_url"))
                    and len(icons) >= 3
                )
                detail = f"name={m.get('name')!r} display={m.get('display')!r} icons={len(icons)}"
            except Exception as e:  # noqa: BLE001
                detail = f"JSON 解析失败: {e}"
        reps.check("manifest 是合法 JSON 且字段齐全", ok_json, detail)

        st, sw = get(base + "/sw.js")
        reps.check("sw.js 可访问", st == 200 and b"addEventListener" in sw, f"HTTP {st}")

        text = sw.decode("utf-8", "replace")
        m = re.search(r"const ASSETS = \[(.*?)\];", text, re.S)
        listed = re.findall(r"'([^']+)'", m.group(1)) if m else []
        md = re.search(r"const DEFERRED = \[(.*?)\];", text, re.S)
        deferred = re.findall(r"'([^']+)'", md.group(1)) if md else []
        missing = [p for p in listed + deferred if get(base + "/" + p.removeprefix("./"))[0] != 200]
        reps.check(
            "sw 缓存清单（预缓存 + 按需）里的文件都存在",
            bool(listed) and bool(deferred) and not missing,
            f"预缓存 {len(listed)} 项 / 按需 {len(deferred)} 项，缺失 {missing}",
        )

        # 反向检查：src 下每个模块都得有着落（预缓存 或 按需），不然离线时会缺文件
        src_files = sorted(p.name for p in (ROOT / "src").glob("*.js"))
        not_listed = [
            f"./src/{n}" for n in src_files
            if f"./src/{n}" not in listed and f"./src/{n}" not in deferred
        ]
        reps.check("src 下每个模块都在清单里（预缓存或按需）", not not_listed, f"漏了：{not_listed}")

        # 首屏那几个必须在**预缓存**里（在按需里就等于首屏要等网络）
        # manifest 的 background_color / theme_color 决定独立 App 窗口四周与状态栏的底色。
        # 涂白 = 深色主题下过渡时"四周一闪白边"（用户报过），这里钉住。
        mf = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
        for key in ("background_color", "theme_color"):
            val = str(mf.get(key, "")).lower()
            reps.check(
                f"manifest 的 {key} 不是白色（独立 App 窗口四周露的就是它）",
                val not in ("#fff", "#ffffff", "white"),
                val,
            )

        first_screen = ["./index.html", "./style.css", "./src/app.js", "./src/ui-home.js",
                        "./src/store.js", "./src/db.js", "./src/srs.js", "./src/judge.js",
                        "./src/theme.js", "./src/press.js", "./src/glass.js", "./src/motion.js"]
        late = [p for p in first_screen if p not in listed]
        reps.check("首屏必需的文件都在预缓存清单里", not late, f"被挪到按需了：{late}")
        both = [p for p in listed if p in deferred]
        reps.check("预缓存与按需清单不重叠", not both, f"重复：{both}")

        # 静态资源必须是"缓存优先"（v30）：verif 靠源码里有没有那个分支
        reps.check(
            "静态资源走缓存优先（首屏不等网络）",
            "const cached = await caches.match(req" in text and "e.waitUntil(refreshing)" in text,
            "sw.js 里没找到缓存优先 + 后台更新的分支",
        )

        # 应用版本号必须和 sw.js 的缓存版本一致（发版时一起改，改漏了这里会红）
        app_ver = re.search(r"APP_VERSION = '([^']+)'", (ROOT / "src" / "version.js").read_text(encoding="utf-8"))
        sw_ver = re.search(r"const VERSION = '([^']+)'", text)
        reps.check(
            "src/version.js 与 sw.js 的版本号一致",
            bool(app_ver and sw_ver and app_ver.group(1) == sw_ver.group(1)),
            f"app={app_ver.group(1) if app_ver else '?'} sw={sw_ver.group(1) if sw_ver else '?'}",
        )

        # version.json 是应用用来"发现服务端已更新"的探测文件：三处版本要一致，而且**不能**被预缓存
        vpath = ROOT / "version.json"
        vjson = json.loads(vpath.read_text(encoding="utf-8")) if vpath.exists() else {}
        reps.check(
            "version.json 存在且版本号与另外两处一致",
            bool(app_ver and vjson.get("version") == app_ver.group(1)),
            f"version.json={vjson.get('version')!r} app={app_ver.group(1) if app_ver else '?'}",
        )
        reps.check("version.json 不在预缓存清单里（要每次联网取它）", "./version.json" not in listed)

        for name in ("icon-192.png", "icon-512.png", "apple-touch-icon.png"):
            st, blob = get(base + "/" + name)
            reps.check(f"{name} 是 PNG", st == 200 and blob[:8] == b"\x89PNG\r\n\x1a\n", f"HTTP {st}")

        # ---- 2. 联网时页面骨架 ----
        dom_online = run_dom(base + "/", profile=profile, budget_ms=6000)
        reps.check("四个界面容器都在", dom_online.count('class="view"') >= 4)
        reps.check("默认显示库列表", body_flag(dom_online, "view") == "home", f"data-view={body_flag(dom_online, 'view')}")
        reps.check("底部导航存在", 'data-testid="tab-import"' in dom_online)

        dom_hash = run_dom(base + "/#/import", profile=profile, budget_ms=6000)
        reps.check("hash 路由能切到导入页", body_flag(dom_hash, "view") == "import", f"data-view={body_flag(dom_hash, 'view')}")

        # ---- 3. 离线：harness 装好 SW 后把服务器关掉，再导航回首页 ----
        dom_off = run_dom(base + "/tool/sw_harness.html", profile=profile, budget_ms=None, timeout=90)
        view = body_flag(dom_off, "view")
        ok_off = view == "home" and '<main id="app"' in dom_off
        reps.check(
            "断网后首页仍然能打开（service worker 供的页面）",
            ok_off,
            "" if ok_off else "离线后拿到的不是应用页面：" + json.dumps(read_result(dom_off) or {}, ensure_ascii=False)[:300],
        )
        reps.check("离线加载时页面已被 service worker 接管", body_flag(dom_off, "sw") == "ready", f"data-sw={body_flag(dom_off, 'sw')}")

        # ---- 4. 重启服务器，读 harness 留下的体检报告 ----
        httpd2, base2 = start_server(PORT)
        try:
            reps.check("服务器能在同一端口重启（后续用例要用）", base2 == base)
            dom_rep = run_dom(base + "/tool/sw_report.html", profile=profile, budget_ms=8000)
            rep = read_result(dom_rep) or {}
            reps.check("service worker 已激活", rep.get("active") == "activated", json.dumps(rep, ensure_ascii=False)[:200])
            # 期望条数直接从 sw.js 的 ASSETS 清单里数，别写死（加了模块就自动跟上）
            reps.check(
                f"预缓存了全部 {len(listed)} 个资源",
                int(rep.get("cached") or 0) >= len(listed),
                f"cached={rep.get('cached')} 清单={len(listed)}",
            )
        finally:
            httpd2.shutdown()
            httpd2.server_close()
    finally:
        httpd.shutdown()
        httpd.server_close()

    return reps.finish()


if __name__ == "__main__":
    for a in sys.argv[1:]:
        if a.startswith("--prefix="):
            PREFIX = a.split("=", 1)[1].rstrip("/")
    main_guard(check)
