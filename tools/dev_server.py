"""Local static server for development: same as `python -m http.server`,
but tells the browser not to cache, so edits show up on every reload."""
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):
        """Dev only: POST /__save?name=<file> stores the body in export/ (used to export models
        and screenshots)."""
        from urllib.parse import urlparse, parse_qs
        url = urlparse(self.path)
        name = parse_qs(url.query).get("name", [""])[0]
        safe = os.path.basename(name)
        if url.path != "/__save" or not safe or not safe.lower().endswith((".glb", ".gltf", ".json", ".png", ".jpg")):
            self.send_error(400, "Bad save request")
            return
        length = int(self.headers.get("Content-Length", 0))
        if length > 200 * 1024 * 1024:
            self.send_error(413, "Too large")
            return
        out_dir = os.path.join(ROOT, "export")
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, safe), "wb") as f:
            f.write(self.rfile.read(length))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"saved")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
