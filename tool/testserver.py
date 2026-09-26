"""测试用的本地服务器：比开发用的多两个只有测试才需要的端点。

    /__slow?ms=N   —— 故意慢慢响应。页面用一个 <img src="../__slow?ms=60000">
                      把 load 事件拖住，测试跑完再释放，这样无头 Edge 的 --dump-dom
                      正好在"测试结束"那一刻发生，不用靠猜时间。
    /__shutdown    —— 让服务器当场连监听 socket 一起关掉，用来验证"断网后还能用"。

产品代码里没有这些（只存在于 tool/ 下）。
"""

from __future__ import annotations

import functools
import threading
import time
import urllib.parse
from http.server import ThreadingHTTPServer
from pathlib import Path

import serve

ROOT = Path(__file__).resolve().parent.parent


class Handler(serve.Handler):
    # 支持挂在子路径下（例如 /vocab/），用来复现 GitHub Pages 的部署形态
    prefix = ""

    def do_GET(self):  # noqa: N802
        if self.prefix and self.path.startswith(self.prefix):
            # 去掉前缀再交给父类：这样文件查找和 /__slow、/__shutdown 判断都按原样工作
            self.path = self.path[len(self.prefix):] or "/"
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/__slow":
            ms = int(urllib.parse.parse_qs(parsed.query).get("ms", ["15000"])[0])
            time.sleep(min(ms, 120000) / 1000)
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
            # 连监听 socket 一起关，后续请求立刻 ECONNREFUSED（否则浏览器会挂在那儿等）
            threading.Thread(target=lambda: (srv.shutdown(), srv.server_close()), daemon=True).start()
            return

        super().do_GET()


def start(port: int, prefix: str = "") -> tuple[ThreadingHTTPServer, str]:
    """按指定端口起服务（要重启在同一端口时必须指定）。

    prefix 例如 "/vocab"：服务会挂在 http://127.0.0.1:port/vocab/ 下，
    用来验证"部署到 GitHub Pages 子路径"这种情况下的 service worker 作用域。
    """
    cls = type("PrefixedHandler", (Handler,), {"prefix": prefix})
    handler = functools.partial(cls, directory=str(ROOT))
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{port}{prefix}"


def start_free(start_port: int = 5191, prefix: str = "") -> tuple[ThreadingHTTPServer, str]:
    httpd, port = serve.make_server(start=start_port)  # 只借它挑个空端口
    httpd.server_close()
    return start(port, prefix)
