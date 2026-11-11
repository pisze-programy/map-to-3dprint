#!/usr/bin/env python3
"""
gis/overpass_dem.py
Fetches REAL OpenStreetMap Overpass vector data + REAL AWS Terrarium DEM elevation tiles.
"""
import json
import math
import os
import struct
import subprocess
import zlib

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(ROOT_DIR, "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

OVERPASS_ENDPOINTS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]


def decode_png_rgb(png_bytes):
    """Pure-Python PNG decoder for 256x256 RGB/RGBA Terrarium DEM tiles."""
    assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n", "Not a valid PNG"
    pos = 8
    width = height = color_type = 0
    idat_chunks = []
    while pos < len(png_bytes):
        length = struct.unpack(">I", png_bytes[pos : pos + 4])[0]
        chunk_type = png_bytes[pos + 4 : pos + 8]
        chunk_data = png_bytes[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if chunk_type == b"IHDR":
            width, height, _, color_type, _, _, _ = struct.unpack(">IIBBBBB", chunk_data)
        elif chunk_type == b"IDAT":
            idat_chunks.append(chunk_data)
        elif chunk_type == b"IEND":
            break

    raw = zlib.decompress(b"".join(idat_chunks))
    bpp = 3 if color_type == 2 else 4 if color_type == 6 else 1
    stride = width * bpp
    pixels = [[(0, 0, 0) for _ in range(width)] for _ in range(height)]

    prev_row = bytearray(stride)
    idx = 0
    for y in range(height):
        filter_type = raw[idx]
        idx += 1
        row = bytearray(raw[idx : idx + stride])
        idx += stride

        if filter_type == 1:
            for i in range(bpp, stride):
                row[i] = (row[i] + row[i - bpp]) & 0xFF
        elif filter_type == 2:
            for i in range(stride):
                row[i] = (row[i] + prev_row[i]) & 0xFF
        elif filter_type == 3:
            for i in range(stride):
                left = row[i - bpp] if i >= bpp else 0
                up = prev_row[i]
                row[i] = (row[i] + ((left + up) >> 1)) & 0xFF
        elif filter_type == 4:
            for i in range(stride):
                a = row[i - bpp] if i >= bpp else 0
                b = prev_row[i]
                c = prev_row[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                row[i] = (row[i] + pr) & 0xFF

        prev_row = row
        for x in range(width):
            off = x * bpp
            pixels[y][x] = (row[off], row[off + 1], row[off + 2])

    return width, height, pixels


def deg2tile_float(lat_deg, lon_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = (lon_deg + 180.0) / 360.0 * n
    ytile = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n
    return xtile, ytile


def choose_adaptive_dem_zoom(span_meters):
    """Selects Terrarium DEM tile zoom level (11-14) based on area span in meters."""
    s = float(span_meters or 1200)
    if s <= 2200:
        return 14
    if s <= 5500:
        return 13
    if s <= 11500:
        return 12
    return 11


def fetch_terrarium_dem_grid(south, west, north, east, grid_size=64, zoom=None):
    """Fetches real AWS Terrarium DEM tiles covering [south, west, north, east]."""
    if zoom is None:
        cos_lat = max(0.2, math.cos(math.radians((south + north) * 0.5)))
        span_ns_m = abs(north - south) * 111320.0
        span_ew_m = abs(east - west) * 111320.0 * cos_lat
        max_span_m = max(span_ns_m, span_ew_m)
        zoom = choose_adaptive_dem_zoom(max_span_m)

    x_min_f, y_min_f = deg2tile_float(north, west, zoom)
    x_max_f, y_max_f = deg2tile_float(south, east, zoom)

    tx0, tx1 = int(math.floor(x_min_f)), int(math.floor(x_max_f))
    ty0, ty1 = int(math.floor(y_min_f)), int(math.floor(y_max_f))

    tiles = {}
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            cache_path = os.path.join(CACHE_DIR, f"terrarium_{zoom}_{tx}_{ty}.png")
            if os.path.exists(cache_path):
                with open(cache_path, "rb") as f:
                    png_bytes = f.read()
            else:
                url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{zoom}/{tx}/{ty}.png"
                res = subprocess.run(
                    ["curl", "-4", "-s", "-f", "--max-time", "12", "-A", "Map3DPrintStudio/1.0", url],
                    capture_output=True,
                    timeout=14,
                )
                if res.returncode != 0 or not res.stdout:
                    raise RuntimeError(f"Failed to fetch DEM tile {url}")
                png_bytes = res.stdout
                with open(cache_path, "wb") as f:
                    f.write(png_bytes)
            _, _, px = decode_png_rgb(png_bytes)
            tiles[(tx, ty)] = px

    grid = []
    min_elev = float("inf")
    max_elev = float("-inf")

    for gy in range(grid_size):
        lat = south + (gy / (grid_size - 1)) * (north - south)
        row = []
        for gx in range(grid_size):
            lon = west + (gx / (grid_size - 1)) * (east - west)
            xf, yf = deg2tile_float(lat, lon, zoom)
            tx, ty = int(math.floor(xf)), int(math.floor(yf))
            px_x = min(255, max(0, int((xf - tx) * 256)))
            px_y = min(255, max(0, int((yf - ty) * 256)))
            r, g, b = tiles[(tx, ty)][px_y][px_x]
            elev = (r * 256.0 + g + b / 256.0) - 32768.0
            row.append(round(elev, 2))
            if elev < min_elev:
                min_elev = elev
            if elev > max_elev:
                max_elev = elev
        grid.append(row)

    return {
        "gridSize": grid_size,
        "minElev": round(min_elev, 2),
        "maxElev": round(max_elev, 2),
        "grid": grid,
        "zoom": zoom,
    }


def validate_overpass_payload(parsed):
    """Validates that an Overpass JSON payload is complete."""
    if not isinstance(parsed, dict):
        return False
    if str(parsed.get("remark", "")).strip():
        return False
    elements = parsed.get("elements")
    if not isinstance(elements, list) or len(elements) <= 10:
        return False
    node_ids = {
        el["id"]
        for el in elements
        if isinstance(el, dict) and el.get("type") == "node" and "lat" in el and "lon" in el
    }
    if len(node_ids) <= 10:
        return False
    ways = [el for el in elements if isinstance(el, dict) and el.get("type") == "way" and el.get("nodes")]
    if not ways:
        return False
    for w in ways:
        for nid in w.get("nodes", []):
            if nid not in node_ids:
                return False
    return True


def fetch_osm_overpass(south, west, north, east):
    """Fetches full OSM vector features inside bounding box."""
    bbox = f"{south:.5f},{west:.5f},{north:.5f},{east:.5f}"
    cache_key = f"osm_{south:.4f}_{west:.4f}_{north:.4f}_{east:.4f}.json"
    cache_path = os.path.join(CACHE_DIR, cache_key)

    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if validate_overpass_payload(cached):
                return cached
        except Exception:
            pass
        try:
            os.remove(cache_path)
        except OSError:
            pass

    query = f"""
    [out:json][timeout:35][bbox:{bbox}];
    (
      way["building"];
      relation["building"];
      relation["type"="building"];
      way["building:part"];
      relation["building:part"];
      way["natural"];
      relation["natural"];
      way["waterway"];
      relation["waterway"];
      relation["water"];
      way["landuse"];
      relation["landuse"];
      way["leisure"];
      relation["leisure"];
      node["natural"="tree"];
      way["highway"];
      relation["highway"="pedestrian"];
      way["place"="square"];
      way["railway"];
      way["man_made"="bridge"];
      relation["man_made"="bridge"];
      way["man_made"="pier"];
      way["man_made"="breakwater"];
      way["man_made"="groyne"];
    );
    out body qt;
    >;
    out skel qt;
    """

    last_err = None
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            res = subprocess.run(
                [
                    "curl", "-4", "-s", "-f",
                    "--max-time", "38",
                    "-A", "Map3DPrintStudio/1.0 (https://github.com/pisze-programy/map-to-3dprint)",
                    endpoint,
                    "--data-urlencode", f"data={query}",
                ],
                capture_output=True,
                text=True,
                timeout=40,
            )
            if res.returncode == 0 and res.stdout:
                parsed = json.loads(res.stdout)
                if not validate_overpass_payload(parsed):
                    last_err = parsed.get("remark") or "Incomplete Overpass payload"
                    continue
                with open(cache_path, "w", encoding="utf-8") as f:
                    json.dump(parsed, f)
                return parsed
        except Exception as e:
            last_err = e
            continue

    raise RuntimeError(f"All Overpass endpoints failed: {last_err}")
