#!/usr/bin/env python3
"""
Local HTTP & Live GIS Server for Map3D Print Studio.
Serves the interactive frontend and provides live endpoints:
- GET /api/gis?south=...&west=...&north=...&east=...&title=...
- GET /api/geocode?q=...
"""
import importlib
import json
import os
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import fetch_gis
import gis_pipeline

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))


class Map3DRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/gis":
            qs = urllib.parse.parse_qs(parsed.query)
            try:
                importlib.reload(fetch_gis)
                importlib.reload(gis_pipeline)
                south = float(qs["south"][0])
                west = float(qs["west"][0])
                north = float(qs["north"][0])
                east = float(qs["east"][0])
                title = qs.get("title", [""])[0]
                scene = gis_pipeline.build_scene_from_bbox(south, west, north, east, title)
                payload = json.dumps(scene, separators=(",", ":")).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except Exception as e:
                err = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(err)))
                self.end_headers()
                self.wfile.write(err)
            return

        if parsed.path == "/api/geocode":
            qs = urllib.parse.parse_qs(parsed.query)
            q = qs.get("q", [""])[0]
            try:
                url = f"https://photon.komoot.io/api/?q={urllib.parse.quote(q)}&limit=6"
                req = urllib.request.Request(
                    url,
                    headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Map3DStudio/2.0"}
                )
                with urllib.request.urlopen(req, timeout=8) as resp:
                    raw = resp.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            except Exception as e:
                err = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(err)
            return

        return super().do_GET()


if __name__ == "__main__":
    port = 8765
    server = ThreadingHTTPServer(("127.0.0.1", port), Map3DRequestHandler)
    print(f"Map3D Studio Server listening on http://127.0.0.1:{port}")
    server.serve_forever()
