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

import functools
import json
import re
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import serve  # noqa: E402
from headless import Report, body_flag, main_guard, read_result, run_dom  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PORT = 5181


class HarnessHandler(serve.Handler):
    """/__slow 拖住 load 事件；/__shutdown 让服务器当场关门（仅测试用）。"""

    def do_GET(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/__slow":
            ms = int(urllib.parse.parse_qs(parsed.query).get("ms", ["15000"])[0])
            time.sleep(min(ms, 40000) / 1000)
            self.send_response(204)
            self.end_headers()
            return
        if parsed.path == "/__shutdown":
            body = b"ok"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            self.wfile.flush()
            srv = self.server
            # 连监听 socket 一起关掉，后续请求立刻 ECONNREFUSED（否则浏览器会挂在那儿等）
            threading.Thread(target=lambda: (srv.shutdown(), srv.server_close()), daemon=True).start()
            return
        super().do_GET()


def start_server(port: int) -> tuple[serve.ThreadingHTTPServer, str]:
    handler = functools.partial(HarnessHandler, directory=str(ROOT))
    httpd = serve.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{port}"


def get(url: str) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception:
        return 0, b""


def check() -> int:
    reps = Report("任务1 · PWA 外壳")
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
        missing = [p for p in listed if get(base + "/" + p.removeprefix("./"))[0] != 200]
        reps.check("sw 预缓存清单里的文件都存在", bool(listed) and not missing, f"清单 {len(listed)} 项，缺失 {missing}")

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
            reps.check("预缓存了全部 8 个资源", int(rep.get("cached") or 0) >= 8, f"cached={rep.get('cached')}")
        finally:
            httpd2.shutdown()
            httpd2.server_close()
    finally:
        httpd.shutdown()
        httpd.server_close()

    return reps.finish()


if __name__ == "__main__":
    main_guard(check)
