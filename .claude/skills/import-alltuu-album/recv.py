#!/usr/bin/env python3
"""One-shot localhost receiver for the harvest manifest.

The browser harvest can hold 1000s of photos (100s of KB of signed URLs) — far
too large to route back through the agent's context via a javascript_tool
return value. Instead the agent runs this tiny server, then the album page
POSTs `window.__harvestDump()` (or the raw photos array) straight to it and it
writes the body to disk.

Usage:
    python3 recv.py <out-file> [port] [lifetime-seconds]
      port default 8799, lifetime default 300s.
Then, in the browser (javascript_tool), POST to http://127.0.0.1:<port>/.
Writes the POST body to <out-file> only if it is a non-empty JSON array/object,
then exits. Self-exits after <lifetime> seconds even if no POST arrives, so a
missed POST never wedges the port for the next attempt.
"""
import http.server
import json
import os
import socketserver
import sys
import threading

OUT = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8799
LIFETIME = float(sys.argv[3]) if len(sys.argv) > 3 else 300.0


class Server(socketserver.TCPServer):
    # http.server.HTTPServer sets this True; raw TCPServer defaults False, which
    # makes a re-run within the ~60s TIME_WAIT window fail to bind. The
    # documented 403 -> re-harvest retry hits exactly that path.
    allow_reuse_address = True


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
        body = self.rfile.read(n) if n else b""
        # Only overwrite <out-file> with a well-formed, non-empty manifest —
        # honors the SKILL's "never write an empty manifest over a good one".
        ok, msg = self._validate(body)
        if ok:
            with open(OUT, "wb") as f:
                f.write(body)
            status, note = 200, f"WROTE {len(body)} bytes to {OUT}"
        else:
            status, note = 400, f"REJECTED body ({msg}); {OUT} left untouched"
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(note.encode())
        print(note)
        if ok:
            threading.Timer(0.5, lambda: os._exit(0)).start()

    @staticmethod
    def _validate(body):
        if not body:
            return False, "empty"
        try:
            data = json.loads(body)
        except Exception as e:
            return False, f"not JSON: {e}"
        if isinstance(data, list) and not data:
            return False, "empty array"
        if not isinstance(data, (list, dict)):
            return False, "not array/object"
        return True, "ok"

    def log_message(self, *a):
        pass


with Server(("127.0.0.1", PORT), H) as s:
    threading.Timer(LIFETIME, lambda: os._exit(2)).start()
    print(f"listening 127.0.0.1:{PORT} -> {OUT} (lifetime {LIFETIME:.0f}s)")
    s.serve_forever()
