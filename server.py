#!/usr/bin/env python3
"""
Local HTTP & Live GIS Server for Map3D Print Studio.
Serves the interactive frontend and provides live endpoints:
- POST /api/interpreter (and /api/overpass) -> Fast multi-mirror Overpass QL proxy
- GET  /api/gis?south=...&west=...&north=...&east=...&title=...
- GET  /api/geocode?q=...
"""
from collections import OrderedDict
from datetime import datetime
import gzip
import hashlib
import http.client
import importlib
import json
import os
import re
import socket
import ssl
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

GEOCODE_CACHE_TTL_SEC = 900.0
GEOCODE_CACHE_MAX = 256
GEOCODE_PROVIDERS = ("arcgis", "nominatim", "open_meteo", "photon")

_GEOCODE_LOCK = threading.Lock()
_GEOCODE_CACHE = OrderedDict()
_GEOCODE_INFLIGHT = {}
_GEOCODE_PROVIDER_STATE = {
    name: {
        "ewma_ms": 280.0 + idx * 140.0,
        "cooldown_until": 0.0,
        "ok": 0,
        "fail": 0,
        "consec_fail": 0,
    }
    for idx, name in enumerate(GEOCODE_PROVIDERS)
}
_NOMINATIM_LOCK = threading.Lock()
_NOMINATIM_LAST_REQ_TS = 0.0
_SSL_DEFAULT_CTX = ssl.create_default_context()
_COORD_QUERY_RE = re.compile(
    r"^\s*([NSns])?\s*(-?\d{1,2}(?:\.\d+)?)\s*°?\s*[,;\s]+\s*([EWew])?\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*$"
)


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
        if saw_query_timeout:
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


class _IPv4PreferredHTTPSConnection(http.client.HTTPSConnection):
    """Connects over IPv4 first to avoid broken IPv6 AAAA hangs on Nominatim/Open-Meteo."""

    def connect(self):
        last_exc = None
        for family in (socket.AF_INET, socket.AF_UNSPEC):
            try:
                infos = socket.getaddrinfo(
                    self.host, self.port, family, socket.SOCK_STREAM
                )
            except OSError as exc:
                last_exc = exc
                continue
            for af, socktype, proto, _, sa in infos:
                sock = None
                try:
                    sock = socket.socket(af, socktype, proto)
                    if self.timeout is not socket._GLOBAL_DEFAULT_TIMEOUT:
                        sock.settimeout(self.timeout)
                    sock.connect(sa)
                    self.sock = _SSL_DEFAULT_CTX.wrap_socket(
                        sock, server_hostname=self.host
                    )
                    return
                except OSError as exc:
                    last_exc = exc
                    if sock is not None:
                        try:
                            sock.close()
                        except OSError:
                            pass
        if last_exc is not None:
            raise last_exc
        raise OSError(f"Unable to resolve {self.host}:{self.port}")


def _fetch_json_ipv4_preferred(url, headers=None, timeout_sec=3.0):
    parsed = urllib.parse.urlsplit(url)
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    path_and_query = parsed.path or "/"
    if parsed.query:
        path_and_query = f"{path_and_query}?{parsed.query}"

    req_headers = {
        "User-Agent": OVERPASS_USER_AGENT,
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "Accept-Language": "pl,en;q=0.9",
        "Connection": "close",
    }
    if headers:
        req_headers.update(headers)

    conn_cls = (
        _IPv4PreferredHTTPSConnection
        if parsed.scheme == "https"
        else http.client.HTTPConnection
    )
    conn = conn_cls(host, port=port, timeout=timeout_sec)
    try:
        conn.request("GET", path_and_query, headers=req_headers)
        resp = conn.getresponse()
        status = resp.status
        raw = resp.read()
        encoding = (resp.getheader("Content-Encoding") or "").lower()
    finally:
        try:
            conn.close()
        except Exception:
            pass

    if status != 200:
        raise RuntimeError(f"HTTP {status} from {host}")
    if encoding == "gzip" or raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))


def _make_photon_feature(
    lat,
    lon,
    name,
    city="",
    state="",
    country="",
    street="",
    housenumber="",
    osm_value="miejsce",
):
    props = {"name": name, "osm_value": osm_value, "type": osm_value}
    if city:
        props["city"] = city
    if state:
        props["state"] = state
    if country:
        props["country"] = country
    if street:
        props["street"] = street
    if housenumber:
        props["housenumber"] = housenumber
    return {
        "type": "Feature",
        "properties": props,
        "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
    }


def _parse_direct_coordinate_query(q):
    m = _COORD_QUERY_RE.match(q or "")
    if not m:
        return None
    ns, lat_s, ew, lon_s = m.groups()
    try:
        lat = float(lat_s)
        lon = float(lon_s)
    except ValueError:
        return None
    if ns and ns.upper() == "S":
        lat = -abs(lat)
    if ew and ew.upper() == "W":
        lon = -abs(lon)
    if not (-85.0 <= lat <= 85.0 and -180.0 <= lon <= 180.0):
        return None
    label = f"{lat:.4f}°, {lon:.4f}°"
    return [
        _make_photon_feature(
            lat=lat,
            lon=lon,
            name=label,
            state="Współrzędne geograficzne",
            country="WGS84",
            osm_value="coordinates",
        )
    ]


def _dedupe_features(features, limit):
    kept = []
    for f in features:
        coords = (f.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        name_norm = ((f.get("properties") or {}).get("name") or "").strip().lower()
        is_dup = False
        for prev in kept:
            pcoords = prev["geometry"]["coordinates"]
            pname = (prev["properties"].get("name") or "").strip().lower()
            if (
                pname == name_norm
                and abs(pcoords[1] - lat) < 0.0025
                and abs(pcoords[0] - lon) < 0.0025
            ):
                is_dup = True
                break
        if not is_dup:
            kept.append(f)
            if len(kept) >= limit:
                break
    return kept


def _geocode_via_arcgis(q, limit):
    qs = urllib.parse.urlencode(
        {
            "f": "json",
            "maxLocations": max(limit * 2, 10),
            "outFields": "PlaceName,Place_addr,Type,Country,Region,City,ShortLabel",
            "SingleLine": q,
        }
    )
    url = f"https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?{qs}"
    data = _fetch_json_ipv4_preferred(url, timeout_sec=3.2)
    candidates = data.get("candidates") if isinstance(data, dict) else []
    if not isinstance(candidates, list):
        return []
    out = []
    for c in candidates:
        loc = c.get("location") or {}
        lon = loc.get("x")
        lat = loc.get("y")
        if lon is None or lat is None:
            continue
        attrs = c.get("attributes") or {}
        place_name = (attrs.get("PlaceName") or "").strip()
        short_lbl = (attrs.get("ShortLabel") or "").strip()
        place_addr = (attrs.get("Place_addr") or c.get("address") or "").strip()
        name = (
            place_name
            or short_lbl
            or (place_addr.split(",")[0].strip() if place_addr else q)
        )
        city = (attrs.get("City") or "").strip()
        state = (attrs.get("Region") or "").strip()
        country = (attrs.get("Country") or "").strip()
        street = ""
        if place_addr:
            addr_parts = [p.strip() for p in place_addr.split(",") if p.strip()]
            extra_parts = [
                p
                for p in addr_parts
                if p.lower()
                not in {
                    name.lower(),
                    city.lower(),
                    state.lower(),
                    country.lower(),
                }
            ]
            if extra_parts:
                street = ", ".join(extra_parts[:2])
        kind = (attrs.get("Type") or "miejsce").strip().lower()
        out.append(
            _make_photon_feature(
                lat=lat,
                lon=lon,
                name=name,
                city=city if city.lower() != name.lower() else "",
                state=state,
                country=country,
                street=street,
                osm_value=kind or "miejsce",
            )
        )
    return _dedupe_features(out, limit)


def _geocode_via_nominatim(q, limit):
    global _NOMINATIM_LAST_REQ_TS
    with _NOMINATIM_LOCK:
        now = time.monotonic()
        wait_s = 1.05 - (now - _NOMINATIM_LAST_REQ_TS)
        if wait_s > 0.45:
            # Respect Nominatim 1 req/s policy without blocking rapid autocomplete
            return None
        if wait_s > 0:
            time.sleep(wait_s)
        _NOMINATIM_LAST_REQ_TS = time.monotonic()

    qs = urllib.parse.urlencode(
        {"format": "jsonv2", "addressdetails": 1, "limit": limit, "q": q}
    )
    url = f"https://nominatim.openstreetmap.org/search?{qs}"
    data = _fetch_json_ipv4_preferred(url, timeout_sec=3.2)
    if not isinstance(data, list):
        return []
    out = []
    for item in data:
        try:
            lat = float(item["lat"])
            lon = float(item["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        addr = item.get("address") or {}
        road = (addr.get("road") or addr.get("pedestrian") or "").strip()
        house = (addr.get("house_number") or "").strip()
        city = (
            addr.get("city")
            or addr.get("town")
            or addr.get("village")
            or addr.get("municipality")
            or ""
        ).strip()
        state = (addr.get("state") or addr.get("county") or "").strip()
        country = (addr.get("country") or "").strip()
        disp_head = (item.get("display_name") or "").split(",")[0].strip()
        road_with_num = " ".join([p for p in (road, house) if p]).strip()
        name = (item.get("name") or "").strip() or road_with_num or disp_head or q
        out.append(
            _make_photon_feature(
                lat=lat,
                lon=lon,
                name=name,
                city=city if city.lower() != name.lower() else "",
                state=state,
                country=country,
                street=road if road.lower() != name.lower() else "",
                housenumber=house if house not in name else "",
                osm_value=(item.get("type") or item.get("category") or "miejsce"),
            )
        )
    return _dedupe_features(out, limit)


def _geocode_via_open_meteo(q, limit):
    qs = urllib.parse.urlencode(
        {"name": q, "count": limit, "language": "pl", "format": "json"}
    )
    url = f"https://geocoding-api.open-meteo.com/v1/search?{qs}"
    data = _fetch_json_ipv4_preferred(url, timeout_sec=2.8)
    results = data.get("results") if isinstance(data, dict) else []
    if not isinstance(results, list):
        return []
    out = []
    for r in results:
        lat = r.get("latitude")
        lon = r.get("longitude")
        if lat is None or lon is None:
            continue
        out.append(
            _make_photon_feature(
                lat=lat,
                lon=lon,
                name=(r.get("name") or q).strip(),
                city=(r.get("admin2") or "").strip(),
                state=(r.get("admin1") or "").strip(),
                country=(r.get("country") or r.get("country_code") or "").strip(),
                osm_value=(r.get("feature_code") or "city").lower(),
            )
        )
    return _dedupe_features(out, limit)


def _geocode_via_photon(q, limit):
    qs = urllib.parse.urlencode({"q": q, "limit": limit})
    url = f"https://photon.komoot.io/api/?{qs}"
    data = _fetch_json_ipv4_preferred(url, timeout_sec=2.2)
    features = data.get("features") if isinstance(data, dict) else None
    if not isinstance(features, list):
        raise ValueError("Invalid Photon FeatureCollection")
    return features[:limit]


_GEOCODE_FETCHERS = {
    "arcgis": _geocode_via_arcgis,
    "nominatim": _geocode_via_nominatim,
    "open_meteo": _geocode_via_open_meteo,
    "photon": _geocode_via_photon,
}


def _ordered_geocode_providers():
    now = time.monotonic()
    with _GEOCODE_LOCK:
        ranked = []
        for idx, name in enumerate(GEOCODE_PROVIDERS):
            st = _GEOCODE_PROVIDER_STATE[name]
            cooling = st["cooldown_until"] > now
            tier = 0 if (st["ok"] > 0 and not cooling) else (1 if not cooling else 2)
            ranked.append((tier, st["consec_fail"], st["ewma_ms"], idx, name))
        ranked.sort(key=lambda x: (x[0], x[1], x[2], x[3]))
        return [item[4] for item in ranked]


def resolve_geocode_query(q, limit=6):
    """
    Multi-provider live geocoder returning Photon-compatible GeoJSON bytes:
    (payload_bytes, feature_count, provider_name).
    """
    clean_q = (q or "").strip()
    limit = max(1, min(12, int(limit or 6)))
    if not clean_q:
        return b'{"type":"FeatureCollection","features":[]}', 0, "empty"

    coord_features = _parse_direct_coordinate_query(clean_q)
    if coord_features is not None:
        payload = json.dumps(
            {"type": "FeatureCollection", "features": coord_features},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        return payload, len(coord_features), "coords"

    cache_key = f"{clean_q.lower()}|{limit}"
    now = time.monotonic()
    leader = False
    with _GEOCODE_LOCK:
        cached = _GEOCODE_CACHE.get(cache_key)
        if cached and cached["expires"] > now:
            _GEOCODE_CACHE.move_to_end(cache_key)
            return cached["payload"], cached["count"], f"{cached['provider']}(cache)"
        entry = _GEOCODE_INFLIGHT.get(cache_key)
        if entry is None:
            entry = {"event": threading.Event(), "result": None, "error": None}
            _GEOCODE_INFLIGHT[cache_key] = entry
            leader = True

    if not leader:
        entry["event"].wait(timeout=6.5)
        if entry["result"] is not None:
            payload, cnt, prov = entry["result"]
            return payload, cnt, f"{prov}(coalesced)"
        if entry["error"] is not None:
            raise RuntimeError(str(entry["error"]))

    try:
        providers = _ordered_geocode_providers()
        errors = []
        any_provider_succeeded_empty = False
        chosen_empty_provider = "none"

        for name in providers:
            fn = _GEOCODE_FETCHERS[name]
            t0 = time.perf_counter()
            try:
                features = fn(clean_q, limit)
                if features is None:
                    continue
                dt_ms = (time.perf_counter() - t0) * 1000.0
                with _GEOCODE_LOCK:
                    st = _GEOCODE_PROVIDER_STATE[name]
                    st["cooldown_until"] = 0.0
                    st["consec_fail"] = 0
                    st["ewma_ms"] = 0.7 * st["ewma_ms"] + 0.3 * dt_ms
                    st["ok"] += 1

                if features:
                    payload = json.dumps(
                        {"type": "FeatureCollection", "features": features},
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ).encode("utf-8")
                    with _GEOCODE_LOCK:
                        _GEOCODE_CACHE[cache_key] = {
                            "payload": payload,
                            "count": len(features),
                            "provider": name,
                            "expires": time.monotonic() + GEOCODE_CACHE_TTL_SEC,
                        }
                        while len(_GEOCODE_CACHE) > GEOCODE_CACHE_MAX:
                            _GEOCODE_CACHE.popitem(last=False)
                        entry["result"] = (payload, len(features), name)
                        entry["event"].set()
                    return payload, len(features), name

                any_provider_succeeded_empty = True
                chosen_empty_provider = name
            except Exception as exc:
                dt_ms = (time.perf_counter() - t0) * 1000.0
                with _GEOCODE_LOCK:
                    st = _GEOCODE_PROVIDER_STATE[name]
                    st["fail"] += 1
                    st["consec_fail"] += 1
                    st["cooldown_until"] = max(
                        st["cooldown_until"], time.monotonic() + 60.0
                    )
                    st["ewma_ms"] = min(6000.0, st["ewma_ms"] * 1.4 + 400.0)
                err_txt = f"{name}({dt_ms:.0f}ms): {type(exc).__name__}: {exc}"
                errors.append(err_txt)
                log_server_event(
                    "GEOCODE_WARN", f"Provider {err_txt} for q={clean_q!r}"
                )

        if any_provider_succeeded_empty:
            empty_payload = b'{"type":"FeatureCollection","features":[]}'
            with _GEOCODE_LOCK:
                entry["result"] = (empty_payload, 0, chosen_empty_provider)
                entry["event"].set()
            return empty_payload, 0, chosen_empty_provider

        combined = "; ".join(errors) if errors else "No geocode providers available"
        err = RuntimeError(f"All geocode providers failed: {combined}")
        with _GEOCODE_LOCK:
            entry["error"] = err
            entry["event"].set()
        raise err
    finally:
        if leader:
            with _GEOCODE_LOCK:
                _GEOCODE_INFLIGHT.pop(cache_key, None)
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
            try:
                limit = int(qs.get("limit", ["6"])[0] or 6)
            except ValueError:
                limit = 6
            if not q:
                self._send_json_bytes(200, b'{"type":"FeatureCollection","features":[]}')
                return
            t0 = time.perf_counter()
            try:
                raw, feat_count, provider = resolve_geocode_query(q, limit=limit)
                self._log_details.append(f"geocode_provider={provider}")
                self._log_details.append(f"geocode_features={feat_count}")
                self._send_json_bytes(200, raw)
            except Exception as exc:
                dt_ms = (time.perf_counter() - t0) * 1000.0
                log_server_event(
                    "UPSTREAM_ERR",
                    f"Geocode failed q={q!r} elapsed_ms={dt_ms:.1f}: {type(exc).__name__}: {exc}",
                )
                self._log_details.append("geocode_error=true")
                err = json.dumps({"error": str(exc)}).encode("utf-8")
                self._send_json_bytes(502, err)
            return

        if parsed.path == "/favicon.ico":
            svg = (
                b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
                b'<rect width="32" height="32" rx="6" fill="#2563eb"/>'
                b'<text x="16" y="21" font-family="sans-serif" font-size="13" '
                b'font-weight="bold" fill="#fff" text-anchor="middle">3D</text></svg>'
            )
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml")
            self.send_header("Content-Length", str(len(svg)))
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            self.wfile.write(svg)
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
