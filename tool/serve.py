"""本地静态服务（开发 / 验证用）。

为什么必须有它：service worker 在 `file://` 下不工作，PWA 的安装与离线能力
只有通过 http(s) 才生效。本地开发就用它，部署时用 GitHub Pages（https）。

用法：
    python tool/serve.py            # 默认 5173
    python tool/serve.py 8080
"""

from __future__ import annotations

import functools
import os
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".webmanifest": "application/manifest+json; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
    }

    def do_GET(self):  # noqa: N802
        # 浏览器总要 favicon：没有就安静地回 204，别在日志里刷一堆 404 回溯
        if self.path.split("?")[0] == "/favicon.ico" and not (ROOT / "favicon.ico").exists():
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()

    def end_headers(self):  # 开发时别缓存，免得改完看不到
        self.send_header("Cache-Control", "no-store")
        self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()

    def log_message(self, fmt, *args):  # 安静点
        pass


def pick_port(start: int) -> int:
    for p in range(start, start + 40):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    raise SystemExit(f"{start} 起 40 个端口都被占用了")


def make_server(port: int | None = None, start: int = 5173) -> tuple[ThreadingHTTPServer, int]:
    """起一个绑定 127.0.0.1 的服务器，返回 (httpd, port)。调用方负责 shutdown。"""
    port = pick_port(port or start)
    handler = functools.partial(Handler, directory=str(ROOT))
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    return httpd, port


def serve_in_thread(start: int = 5179) -> tuple[ThreadingHTTPServer, str]:
    """验证脚本用：后台线程起服务，返回 (httpd, base_url)。"""
    httpd, port = make_server(start=start)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{port}"


def main() -> int:
    port_arg = int(sys.argv[1]) if len(sys.argv) > 1 else None
    httpd, port = make_server(port=port_arg)
    url = f"http://127.0.0.1:{port}/"
    print(f"背单词 App 本地服务已启动：{url}")
    print(f"（服务目录：{ROOT}）")
    print("iPhone 上想用同一个 Wi-Fi 打开的话，把 127.0.0.1 换成本机局域网 IP。")
    print("按 Ctrl+C 停止。")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    os.chdir(ROOT)
    sys.exit(main())
