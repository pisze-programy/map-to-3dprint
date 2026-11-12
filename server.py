#!/usr/bin/env python3
"""
Local HTTP & Live GIS Server for Map3D Print Studio.
Serves the interactive frontend and provides live endpoints:
- POST /api/interpreter (and /api/overpass) -> Fast multi-mirror Overpass QL proxy
- GET  /api/gis?south=...&west=...&north=...&east=...&title=...
- GET  /api/geocode?q=...
"""
from datetime import datetime
import gzip
import hashlib
import importlib
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import fetch_gis
import gis_pipeline
import gis.scene_pipeline

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

DEFAULT_SERVER_LOG_PATH = (
    "/Users/krystianblaszczyk/.gemini/antigravity/brain/"
    "acf68bd7-959f-4001-b031-f431964aa593/scratch/server_live.log"
)
SERVER_LOG_PATH = os.environ.get("MAP3D_SERVER_LOG", DEFAULT_SERVER_LOG_PATH)

OVERPASS_USER_AGENT = (
    "Map3DPrintStudio/2.0 (+https://github.com/pisze-programy/map-to-3dprint; "
    "contact@piszeprogramy.pl)"
)
OVERPASS_ATTEMPT_TIMEOUT_SEC = 14.0
OVERPASS_TOTAL_BUDGET_SEC = 14.5
OVERPASS_UNPROVEN_FAIL_PROBE_SEC = 5.0

OVERPASS_UPSTREAM_MIRRORS = [
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

_LOG_LOCK = threading.Lock()
_MIRROR_LOCK = threading.Lock()
_MIRROR_STATE = {
    url: {
        "ewma_ms": 1200.0 + idx * 250.0,
        "cooldown_until": 0.0,
        "ok": 0,
        "fail": 0,
        "consec_fail": 0,
    }
    for idx, url in enumerate(OVERPASS_UPSTREAM_MIRRORS)
}

_INFLIGHT_LOCK = threading.Lock()
_INFLIGHT_QUERIES = {}


class OverpassQueryTimeoutError(RuntimeError):
    """Raised when a query times out or hits an Overpass runtime remark on a live mirror."""


def _now_iso():
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def log_server_event(level, message):
    """Writes a structured log line to stdout and SERVER_LOG_PATH with flush=True."""
    line = f"{_now_iso()} [{level}] {message}"
    with _LOG_LOCK:
        print(line, file=sys.stdout, flush=True)
        if SERVER_LOG_PATH:
            try:
                log_dir = os.path.dirname(SERVER_LOG_PATH)
                if log_dir:
                    os.makedirs(log_dir, exist_ok=True)
                with open(SERVER_LOG_PATH, "a", encoding="utf-8") as fh:
                    fh.write(line + "\n")
                    fh.flush()
            except OSError as exc:
                print(
                    f"{_now_iso()} [LOG_WARN] Failed writing {SERVER_LOG_PATH}: {exc}",
                    file=sys.stderr,
                    flush=True,
                )


def _short_mirror_name(url):
    try:
        return urllib.parse.urlparse(url).netloc or url
    except Exception:
        return url


def _ordered_overpass_mirrors():
    """
    Orders mirrors so proven healthy mirrors (ok > 0) are NEVER demoted behind
    zero-success or consecutively failing mirrors.
    """
    now = time.monotonic()
    with _MIRROR_LOCK:
        ranked = []
        for idx, url in enumerate(OVERPASS_UPSTREAM_MIRRORS):
            st = _MIRROR_STATE[url]
            is_cooling = st["cooldown_until"] > now
            has_ok = st["ok"] > 0
            consec_fail = st["consec_fail"]
            if has_ok and not is_cooling:
                tier = 0
            elif not has_ok and consec_fail == 0 and not is_cooling:
                tier = 1
            elif has_ok and is_cooling:
                tier = 2
            else:
                tier = 3
            ranked.append((tier, consec_fail, st["ewma_ms"], idx, url, dict(st)))
        ranked.sort(key=lambda item: (item[0], item[1], item[2], item[3]))
        return [(item[4], item[5]) for item in ranked]


def _has_healthy_proven_mirror():
    now = time.monotonic()
    with _MIRROR_LOCK:
        for st in _MIRROR_STATE.values():
            if st["ok"] > 0 and st["consec_fail"] < 3 and st["cooldown_until"] <= now:
                return True
    return False


def _record_mirror_success(url, elapsed_ms):
    with _MIRROR_LOCK:
        st = _MIRROR_STATE.get(url)
        if st:
            st["cooldown_until"] = 0.0
            st["consec_fail"] = 0
            st["ewma_ms"] = 0.7 * st["ewma_ms"] + 0.3 * elapsed_ms
            st["ok"] += 1


def _record_mirror_failure(url, cooldown_sec=40.0, is_query_timeout=False):
    now = time.monotonic()
    with _MIRROR_LOCK:
        st = _MIRROR_STATE.get(url)
        if not st:
            return
        st["fail"] += 1
        st["consec_fail"] += 1
        # Never cooldown-poison a proven mirror (ok > 0) on isolated heavy-query timeouts
        if is_query_timeout and st["ok"] > 0 and st["consec_fail"] < 3:
            return
        st["cooldown_until"] = max(st["cooldown_until"], now + cooldown_sec)
        st["ewma_ms"] = min(15000.0, st["ewma_ms"] * 1.3 + 600.0)


def _validate_overpass_json_bytes(raw_bytes):
    """
    Validates raw upstream Overpass bytes:
    - Rejects empty responses and HTML/XML/Markdown 429/502/504 error pages
    - Parses UTF-8 JSON and checks `elements` is a list
    - Rejects Overpass 200 OK payloads carrying a runtime timeout/OOM `remark`
    Returns (canonical_bytes, element_count).
    """
    if not raw_bytes:
        raise ValueError("Empty upstream response body")
    stripped = raw_bytes.lstrip()
    if not stripped:
        raise ValueError("Whitespace-only upstream response body")
    first_byte = stripped[:1]
    if first_byte in (b"<", b"#"):
        preview = stripped[:120].decode("utf-8", errors="replace").replace("\n", " ").strip()
        raise ValueError(f"Non-JSON upstream error page: {preview}")

    try:
        text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError(f"Invalid UTF-8 from upstream: {exc}") from exc

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        preview = text[:120].replace("\n", " ").strip()
        raise ValueError(f"Invalid JSON ({exc.msg}): {preview}") from exc

    if not isinstance(parsed, dict):
        raise ValueError("Overpass JSON root is not an object")

    remark = str(parsed.get("remark", "") or "").strip()
    if remark:
        raise OverpassQueryTimeoutError(f"Overpass runtime remark: {remark[:180]}")

    elements = parsed.get("elements")
    if not isinstance(elements, list):
        raise ValueError("Overpass JSON missing 'elements' array")

    return raw_bytes, len(elements)


def _is_timeout_exception(exc):
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return True
    if isinstance(exc, urllib.error.URLError) and isinstance(
        getattr(exc, "reason", None), (TimeoutError, socket.timeout)
    ):
        return True
    return "timed out" in str(exc).lower()


def _fetch_overpass_upstream_once(mirror_url, encoded_form_body, attempt_timeout_sec):
    t0 = time.perf_counter()
    req = urllib.request.Request(
        mirror_url,
        data=encoded_form_body,
        headers={
            "User-Agent": OVERPASS_USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=attempt_timeout_sec) as resp:
            status = getattr(resp, "status", 200)
            raw = resp.read()
            content_encoding = (resp.headers.get("Content-Encoding") or "").lower()
            content_type = (resp.headers.get("Content-Type") or "").lower()
    except urllib.error.HTTPError as exc:
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        err_body = ""
        try:
            err_raw = exc.read(240)
            if (exc.headers.get("Content-Encoding") or "").lower() == "gzip":
                err_raw = gzip.decompress(err_raw)
            err_body = err_raw.decode("utf-8", errors="replace").replace("\n", " ").strip()
        except Exception:
            err_body = ""
        is_gw_timeout = exc.code == 504
        cooldown = 20.0 if exc.code in (429, 504) else 45.0
        _record_mirror_failure(
            mirror_url, cooldown_sec=cooldown, is_query_timeout=is_gw_timeout
        )
        detail = f"HTTP {exc.code} {exc.reason}" + (f" ({err_body[:120]})" if err_body else "")
        log_server_event(
            "UPSTREAM_WARN",
            f"Overpass mirror={_short_mirror_name(mirror_url)} failed "
            f"elapsed_ms={elapsed_ms:.1f} reason={detail!r}",
        )
        if is_gw_timeout:
            raise OverpassQueryTimeoutError(f"{_short_mirror_name(mirror_url)}: {detail}") from exc
        raise RuntimeError(f"{_short_mirror_name(mirror_url)}: {detail}") from exc
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        timed_out = _is_timeout_exception(exc)
        _record_mirror_failure(
            mirror_url, cooldown_sec=45.0, is_query_timeout=timed_out
        )
        detail = f"{type(exc).__name__}: {exc}"
        log_server_event(
            "UPSTREAM_WARN",
            f"Overpass mirror={_short_mirror_name(mirror_url)} failed "
            f"elapsed_ms={elapsed_ms:.1f} reason={detail!r}",
        )
        if timed_out:
            raise OverpassQueryTimeoutError(f"{_short_mirror_name(mirror_url)}: {detail}") from exc
        raise RuntimeError(f"{_short_mirror_name(mirror_url)}: {detail}") from exc

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    if status != 200:
        _record_mirror_failure(mirror_url, cooldown_sec=35.0)
        detail = f"Unexpected HTTP {status}"
        log_server_event(
            "UPSTREAM_WARN",
            f"Overpass mirror={_short_mirror_name(mirror_url)} failed "
            f"elapsed_ms={elapsed_ms:.1f} reason={detail!r}",
        )
        raise RuntimeError(f"{_short_mirror_name(mirror_url)}: {detail}")

    if content_encoding == "gzip" or raw[:2] == b"\x1f\x8b":
        try:
            raw = gzip.decompress(raw)
        except Exception as exc:
            _record_mirror_failure(mirror_url, cooldown_sec=35.0)
            detail = f"Corrupt gzip payload: {exc}"
            log_server_event(
                "UPSTREAM_WARN",
                f"Overpass mirror={_short_mirror_name(mirror_url)} failed "
                f"elapsed_ms={elapsed_ms:.1f} reason={detail!r}",
            )
            raise RuntimeError(f"{_short_mirror_name(mirror_url)}: {detail}") from exc

    if "html" in content_type or "xml" in content_type:
        _record_mirror_failure(mirror_url, cooldown_sec=35.0)
        preview = raw[:120].decode("utf-8", errors="replace").replace("\n", " ").strip()
        detail = f"Rejected Content-Type={content_type!r} preview={preview!r}"
        log_server_event(
            "UPSTREAM_WARN",
            f"Overpass mirror={_short_mirror_name(mirror_url)} failed "
            f"elapsed_ms={elapsed_ms:.1f} reason={detail}",
        )
        raise RuntimeError(f"{_short_mirror_name(mirror_url)}: Non-JSON {content_type}")

    try:
        validated_bytes, element_count = _validate_overpass_json_bytes(raw)
    except OverpassQueryTimeoutError as exc:
        _record_mirror_failure(mirror_url, cooldown_sec=20.0, is_query_timeout=True)
        log_server_event(
            "UPSTREAM_WARN",
            f"Overpass mirror={_short_mirror_name(mirror_url)} query remark "
            f"elapsed_ms={elapsed_ms:.1f} reason={str(exc)!r}",
        )
        raise OverpassQueryTimeoutError(f"{_short_mirror_name(mirror_url)}: {exc}") from exc
    except ValueError as exc:
        _record_mirror_failure(mirror_url, cooldown_sec=30.0)
        log_server_event(
            "UPSTREAM_WARN",
            f"Overpass mirror={_short_mirror_name(mirror_url)} invalid payload "
            f"elapsed_ms={elapsed_ms:.1f} reason={str(exc)!r}",
        )
        raise RuntimeError(f"{_short_mirror_name(mirror_url)}: {exc}") from exc

    _record_mirror_success(mirror_url, elapsed_ms)
    return validated_bytes, element_count, _short_mirror_name(mirror_url), elapsed_ms


def forward_overpass_query(query_str):
    """
    Forwards an Overpass QL query directly to healthy upstream Overpass mirrors
    with in-flight deduplication, strict ~14.5s total budget cap (zero 60s dead-mirror
    waterfall), JSON validation, and non-poisoning mirror ranking.
    """
    q_hash = hashlib.sha256(query_str.encode("utf-8")).hexdigest()[:16]
    leader = False
    with _INFLIGHT_LOCK:
        entry = _INFLIGHT_QUERIES.get(q_hash)
        if entry is None:
            entry = {"event": threading.Event(), "result": None, "error": None}
            _INFLIGHT_QUERIES[q_hash] = entry
            leader = True

    if not leader:
        entry["event"].wait(timeout=OVERPASS_TOTAL_BUDGET_SEC + 1.5)
        if entry["result"] is not None:
            payload, elem_count, mirror_name, _ = entry["result"]
            return payload, elem_count, f"{mirror_name}(coalesced)"
        if entry["error"] is not None:
            err = entry["error"]
            if isinstance(err, OverpassQueryTimeoutError):
                raise OverpassQueryTimeoutError(str(err))
            raise RuntimeError(str(err))

    try:
        encoded_body = urllib.parse.urlencode({"data": query_str}).encode("utf-8")
        deadline = time.monotonic() + OVERPASS_TOTAL_BUDGET_SEC
        mirrors_with_state = _ordered_overpass_mirrors()
        errors = []
        saw_query_timeout = False

        for mirror_url, st_snapshot in mirrors_with_state:
            remaining = deadline - time.monotonic()
            if remaining < 2.0:
                break

            attempt_timeout = min(OVERPASS_ATTEMPT_TIMEOUT_SEC, remaining)
            if st_snapshot["ok"] == 0 and st_snapshot["consec_fail"] > 0:
                attempt_timeout = min(OVERPASS_UNPROVEN_FAIL_PROBE_SEC, remaining)

            try:
                res = _fetch_overpass_upstream_once(
                    mirror_url, encoded_body, attempt_timeout
                )
                with _INFLIGHT_LOCK:
                    entry["result"] = res
                    entry["event"].set()
                payload, elem_count, mirror_name, _ = res
                return payload, elem_count, mirror_name
            except OverpassQueryTimeoutError as exc:
                saw_query_timeout = True
                errors.append(str(exc))
                continue
            except Exception as exc:
                errors.append(str(exc))
                continue

        combined = "; ".join(errors) if errors else "No upstream mirrors available"
        log_server_event(
            "UPSTREAM_ERR",
            f"Overpass attempts exhausted for query_hash={q_hash} "
            f"ql_bytes={len(query_str)} timeout_or_remark={saw_query_timeout}: {combined}",
        )
        if saw_query_timeout and _has_healthy_proven_mirror():
            err = OverpassQueryTimeoutError(combined)
        else:
            err = RuntimeError(f"All Overpass mirrors failed: {combined}")
        with _INFLIGHT_LOCK:
            entry["error"] = err
            entry["event"].set()
        raise err
    finally:
        if leader:
            with _INFLIGHT_LOCK:
                _INFLIGHT_QUERIES.pop(q_hash, None)
                entry["event"].set()


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class Map3DRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def setup(self):
        super().setup()
        orig_write = self.wfile.write

        def counting_write(data):
            written = orig_write(data)
            if getattr(self, "_headers_ended", False):
                self._resp_bytes += len(data) if written is None else written
            return written

        self.wfile.write = counting_write

    def parse_request(self):
        self._req_start_ts = time.perf_counter()
        self._resp_status = 0
        self._resp_bytes = 0
        self._headers_ended = False
        self._log_details = []
        return super().parse_request()

    def handle_one_request(self):
        self._req_start_ts = None
        self._resp_status = 0
        self._resp_bytes = 0
        self._headers_ended = False
        self._log_details = []
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError):
            self._log_details.append("client_aborted=true")
        finally:
            if self._req_start_ts is not None:
                elapsed_ms = (time.perf_counter() - self._req_start_ts) * 1000.0
                method = getattr(self, "command", None) or "UNKNOWN"
                path = getattr(self, "path", None) or "-"
                extra = (" " + " ".join(self._log_details)) if self._log_details else ""
                log_server_event(
                    "HTTP",
                    f"{method} {path} -> {self._resp_status or 0} "
                    f"elapsed_ms={elapsed_ms:.1f} bytes={self._resp_bytes}{extra}",
                )

    def log_message(self, fmt, *args):
        # Suppressed in favor of structured real-time logging in handle_one_request.
        return

    def send_response(self, code, message=None):
        self._resp_status = code
        super().send_response(code, message)

    def end_headers(self):
        origin = self.headers.get("Origin", "")
        if origin in ("http://127.0.0.1:8765", "http://localhost:8765"):
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()
        self._headers_ended = True

    def _send_json_bytes(self, status_code, payload_bytes, head_only=False):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload_bytes)))
        self.end_headers()
        if not head_only:
            self.wfile.write(payload_bytes)

    def _is_forbidden_path(self):
        parsed = urllib.parse.urlparse(self.path)
        req_path = urllib.parse.unquote(parsed.path or "/")
        parts = [p for p in req_path.split("/") if p]
        if any(p.startswith(".") or p == "__pycache__" for p in parts):
            return True
        if req_path.endswith((".py", ".pyc", ".pyo", ".sh", ".env")):
            return True
        return False

    def send_Error_403(self, head_only=False):
        self._send_json_bytes(403, b'{"error":"Forbidden"}', head_only=head_only)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        if self._is_forbidden_path():
            self.send_Error_403(head_only=False)
            return

        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/api/interpreter", "/api/overpass"):
            length = int(self.headers.get("Content-Length", 0) or 0)
            raw_body = self.rfile.read(length) if length > 0 else b""
            body_str = raw_body.decode("utf-8", errors="replace")

            query_str = ""
            if body_str:
                data_qs = urllib.parse.parse_qs(body_str, keep_blank_values=True)
                if "data" in data_qs and data_qs["data"]:
                    query_str = data_qs["data"][0].strip()
                elif body_str.lstrip().startswith(("[", "(", "node", "way", "rel", "out")):
                    query_str = body_str.strip()

            if not query_str:
                self._log_details.append("error=missing_overpass_query")
                self._send_json_bytes(
                    400,
                    b'{"error":"Missing Overpass QL query parameter \'data\'"}',
                )
                return

            self._log_details.append(f"ql_bytes={len(query_str)}")
            try:
                payload, elem_count, mirror_name = forward_overpass_query(query_str)
                self._log_details.append(f"mirror={mirror_name}")
                self._log_details.append(f"elements={elem_count}")
                self._send_json_bytes(200, payload)
            except OverpassQueryTimeoutError:
                # Emit standard Overpass JSON timeout remark so browser immediately
                # triggers 2x2 sub-chunk splitting (isQueryTooHeavy=true) with zero 502 console noise.
                self._log_details.append("overpass_remark=timeout")
                remark_payload = json.dumps(
                    {
                        "version": 0.6,
                        "generator": "Map3D Overpass Proxy",
                        "elements": [],
                        "remark": "runtime error: Query timed out after 14s",
                    }
                ).encode("utf-8")
                self._send_json_bytes(200, remark_payload)
            except Exception as exc:
                err_msg = str(exc)
                self._log_details.append("upstream_failed=true")
                err_payload = json.dumps({"error": err_msg}).encode("utf-8")
                self._send_json_bytes(502, err_payload)
            return

        self._send_json_bytes(404, b'{"error":"Not Found"}')

    def do_HEAD(self):
        if self._is_forbidden_path():
            self.send_Error_403(head_only=True)
            return
        return super().do_HEAD()

    def do_GET(self):
        if self._is_forbidden_path():
            self.send_Error_403(head_only=False)
            return

        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/gis":
            qs = urllib.parse.parse_qs(parsed.query)
            try:
                importlib.reload(gis.scene_pipeline)
                importlib.reload(fetch_gis)
                importlib.reload(gis_pipeline)
                south = float(qs["south"][0])
                west = float(qs["west"][0])
                north = float(qs["north"][0])
                east = float(qs["east"][0])
                title = qs.get("title", [""])[0]
                scene = gis_pipeline.build_scene_from_bbox(south, west, north, east, title)
                payload = json.dumps(scene, separators=(",", ":")).encode("utf-8")
                self._log_details.append(
                    f"buildings={len(scene.get('buildings', []))}"
                )
                self._send_json_bytes(200, payload)
            except Exception as exc:
                log_server_event("UPSTREAM_ERR", f"/api/gis failed: {type(exc).__name__}: {exc}")
                err = json.dumps({"error": str(exc)}).encode("utf-8")
                self._send_json_bytes(500, err)
            return

        if parsed.path == "/api/geocode":
            qs = urllib.parse.parse_qs(parsed.query)
            q = qs.get("q", [""])[0].strip()
            if not q:
                self._send_json_bytes(200, b'{"type":"FeatureCollection","features":[]}')
                return
            t0 = time.perf_counter()
            try:
                url = f"https://photon.komoot.io/api/?q={urllib.parse.quote(q)}&limit=6"
                req = urllib.request.Request(
                    url,
                    headers={
                        "User-Agent": OVERPASS_USER_AGENT,
                        "Accept": "application/json",
                        "Accept-Encoding": "gzip",
                    },
                )
                with urllib.request.urlopen(req, timeout=8) as resp:
                    raw = resp.read()
                    if (resp.headers.get("Content-Encoding") or "").lower() == "gzip":
                        raw = gzip.decompress(raw)
                parsed_geo = json.loads(raw.decode("utf-8"))
                feat_count = len(parsed_geo.get("features", [])) if isinstance(parsed_geo, dict) else 0
                self._log_details.append(f"photon_features={feat_count}")
                self._send_json_bytes(200, raw)
            except Exception as exc:
                dt_ms = (time.perf_counter() - t0) * 1000.0
                log_server_event(
                    "UPSTREAM_ERR",
                    f"Photon geocode failed q={q!r} elapsed_ms={dt_ms:.1f}: {type(exc).__name__}: {exc}",
                )
                self._log_details.append("photon_error=true")
                err = json.dumps({"error": str(exc)}).encode("utf-8")
                self._send_json_bytes(502, err)
            return

        return super().do_GET()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    server = ReusableThreadingHTTPServer(("127.0.0.1", port), Map3DRequestHandler)
    log_server_event(
        "BOOT",
        f"Map3D Studio Server listening on http://127.0.0.1:{port} "
        f"log={SERVER_LOG_PATH} mirrors={len(OVERPASS_UPSTREAM_MIRRORS)} "
        f"budget_sec={OVERPASS_TOTAL_BUDGET_SEC}",
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log_server_event("SHUTDOWN", "Server interrupted, shutting down.")
        server.server_close()
