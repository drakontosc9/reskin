"""Reskin local server.

Serves this folder on http://localhost:8766 and adds one extra endpoint:

    GET /proxy?url=<https url>

which fetches a page from a short allow-list of component sites (uiverse.io, mui.com,
21st.dev, GitHub) so the app can import components by link. Browsers block those
fetches from a web page directly. The proxy only ever does GET requests to the hosts
below and only listens on 127.0.0.1.

Run:  python serve.py   (optional: --port 8766)
"""
import argparse
import http.server
import os
import urllib.error
import urllib.parse
import urllib.request

ALLOWED_HOSTS = {
    "uiverse.io", "www.uiverse.io",
    "21st.dev", "www.21st.dev",
    "mui.com", "www.mui.com",
    "raw.githubusercontent.com", "api.github.com",
}
MAX_BYTES = 6 * 1024 * 1024
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"


class Handler(http.server.SimpleHTTPRequestHandler):
    # Reskin's own files change while you work on it: make the browser check for a newer copy every time
    def end_headers(self):
        if not any(b"Cache-Control" in h for h in getattr(self, "_headers_buffer", [])):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/proxy":
            return super().do_GET()
        target = urllib.parse.parse_qs(parsed.query).get("url", [""])[0]
        t = urllib.parse.urlparse(target)
        if t.scheme != "https" or t.hostname not in ALLOWED_HOSTS:
            return self._send(403, b"This address is not on the allow-list.", "text/plain")
        req = urllib.request.Request(target, headers={"User-Agent": UA, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                body = r.read(MAX_BYTES + 1)
                if len(body) > MAX_BYTES:
                    return self._send(413, b"Page too large.", "text/plain")
                self._send(200, body, r.headers.get("Content-Type", "text/plain"))
        except urllib.error.HTTPError as e:
            self._send(e.code, f"The site answered {e.code}.".encode(), "text/plain")
        except Exception as e:  # network errors, timeouts
            self._send(502, f"Could not reach the site: {e}".encode(), "text/plain")

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        if "/proxy" in (args[0] if args else ""):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8766)
    a = ap.parse_args()
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"Reskin running at http://localhost:{a.port}/")
    http.server.ThreadingHTTPServer(("127.0.0.1", a.port), Handler).serve_forever()
