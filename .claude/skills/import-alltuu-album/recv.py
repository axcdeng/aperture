#!/usr/bin/env python3
"""One-shot localhost receiver for the harvest manifest.

The browser harvest can hold 1000s of photos (100s of KB of signed URLs) — far
too large to route back through the agent's context via a javascript_tool
return value. Instead the agent runs this tiny server, then the album page
POSTs `window.__harvestDump()` straight to it and it writes the body to disk.

Usage:
    python3 recv.py <out-file> [port]        # default port 8799
Then, in the browser (javascript_tool), POST to http://127.0.0.1:<port>/.
Writes the POST body verbatim to <out-file> and exits after one payload.
"""
import http.server
import os
import socketserver
import sys
import threading

OUT = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8799


class H(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n)
        with open(OUT, "wb") as f:
            f.write(body)
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")
        print(f"WROTE {len(body)} bytes to {OUT}")
        threading.Timer(0.5, lambda: os._exit(0)).start()

    def log_message(self, *a):
        pass


with socketserver.TCPServer(("127.0.0.1", PORT), H) as s:
    print(f"listening 127.0.0.1:{PORT} -> {OUT}")
    s.serve_forever()
