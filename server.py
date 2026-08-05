"""
Ankimo 本地开发服务器
- 静态文件服务（替代 python -m http.server）
"""
import http.server

PORT = 3000


class AnkimoHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    with http.server.HTTPServer(("", PORT), AnkimoHandler) as httpd:
        print(f"Ankimo server running at http://127.0.0.1:{PORT}")
        print(f"   Static files: current directory")
        httpd.serve_forever()
