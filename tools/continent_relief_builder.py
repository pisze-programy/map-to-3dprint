#!/usr/bin/env python3
"""Orbital topographic relief binary STL generator powered by AWS Terrarium DEM tiles.

Fetches and caches Terrarium RGB PNG elevation tiles (z=1..14), decodes metric
elevations in pure Python stdlib (zlib + struct), resamples with cosine-latitude
aspect preservation, removes pinch corners for strict 2-manifold topology, and writes
a watertight binary STL with optional ocean or canyon cutouts.
"""

from __future__ import annotations

import argparse
import collections
import math
import ssl
import struct
import time
import urllib.request
import zlib
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
USER_AGENT = "map-to-3dprint-relief/1.0"
MAX_MERCATOR_LAT = 85.05112878
Vec3 = Tuple[float, float, float]


def _parse_bool(val: str) -> bool:
    low = str(val).strip().lower()
    if low in ("1", "true", "yes", "y", "on"):
        return True
    if low in ("0", "false", "no", "n", "off"):
        return False
    raise argparse.ArgumentTypeError(f"Expected boolean value, got '{val}'")


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)


def decode_terrarium_png(png_bytes: bytes) -> Tuple[int, int, List[float]]:
    """Decode an 8-bit RGB/RGBA PNG into a flat row-major elevation list (meters)."""
    if png_bytes[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Invalid PNG signature in DEM tile.")
    pos, w, h, depth, ct, interlace, idats = 8, 0, 0, 0, 0, 0, []
    while pos + 8 <= len(png_bytes):
        ln, ctype = struct.unpack_from(">I4s", png_bytes, pos)
        chunk = png_bytes[pos + 8 : pos + 8 + ln]
        pos += 12 + ln
        if ctype == b"IHDR":
            w, h, depth, ct, _, _, interlace = struct.unpack(">IIBBBBB", chunk)
        elif ctype == b"IDAT":
            idats.append(chunk)
        elif ctype == b"IEND":
            break
    if depth != 8 or interlace != 0 or ct not in (2, 6):
        raise ValueError(f"Unsupported PNG format: depth={depth}, ct={ct}, interlace={interlace}")

    bpp = 3 if ct == 2 else 4
    stride, raw = w * bpp, zlib.decompress(b"".join(idats))
    elevs, prev, idx = [0.0] * (w * h), bytearray(stride), 0
    for y in range(h):
        ft, row = raw[idx], bytearray(raw[idx + 1 : idx + 1 + stride])
        idx += 1 + stride
        if ft == 1:
            for i in range(bpp, stride):
                row[i] = (row[i] + row[i - bpp]) & 255
        elif ft == 2:
            for i in range(stride):
                row[i] = (row[i] + prev[i]) & 255
        elif ft == 3:
            for i in range(stride):
                row[i] = (row[i] + (((row[i - bpp] if i >= bpp else 0) + prev[i]) >> 1)) & 255
        elif ft == 4:
            for i in range(stride):
                l, ul = (row[i - bpp], prev[i - bpp]) if i >= bpp else (0, 0)
                row[i] = (row[i] + _paeth(l, prev[i], ul)) & 255
        elif ft != 0:
            raise ValueError(f"Unknown PNG filter byte {ft}")
        base = y * w
        for x in range(w):
            o = x * bpp
            elevs[base + x] = (row[o] * 256.0 + row[o + 1] + row[o + 2] / 256.0) - 32768.0
        prev = row
    return w, h, elevs


def _fetch_tile_bytes(z: int, x: int, y: int, cache_dir: Path, retries: int = 3) -> bytes:
    tile_path = cache_dir / f"z{z}_{x}_{y}.png"
    if tile_path.is_file() and tile_path.stat().st_size > 100:
        return tile_path.read_bytes()
    cache_dir.mkdir(parents=True, exist_ok=True)
    url = TERRARIUM_URL.format(z=z, x=x, y=y)
    last_err: Optional[Exception] = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                data = resp.read()
        except ssl.SSLError:
            with urllib.request.urlopen(req, timeout=25, context=ssl._create_unverified_context()) as resp:
                data = resp.read()
        except Exception as exc:  # pragma: no cover
            last_err = exc
            time.sleep(0.6 * (attempt + 1))
            continue
        tile_path.write_bytes(data)
        return data
    raise RuntimeError(f"Failed to fetch Terrarium tile {url}: {last_err}")


def _latlon_to_merc_px(lat: float, lon: float, zoom: int) -> Tuple[float, float]:
    n = float(1 << zoom)
    rad = math.radians(max(-MAX_MERCATOR_LAT, min(MAX_MERCATOR_LAT, lat)))
    tx = ((lon + 180.0) / 360.0) * n
    ty = (1.0 - math.log(math.tan(rad) + 1.0 / math.cos(rad)) / math.pi) * 0.5 * n
    return tx * 256.0, ty * 256.0


def _resolve_geo_and_mm_bounds(
    lat_min: float, lat_max: float, lon_min: float, lon_max: float,
    width_mm: float, height_mm: float, fit_mode: str, use_cutout: bool,
) -> Tuple[float, float, float, float, float, float, float, float]:
    """Preserve true cosine-latitude metric proportions inside width_mm x height_mm."""
    mode = ("contain" if use_cutout else "cover") if fit_mode == "auto" else fit_mode
    lat_mid = 0.5 * (lat_min + lat_max)
    cos_mid = max(0.15, math.cos(math.radians(lat_mid)))
    geo_w, geo_h = (lon_max - lon_min) * cos_mid, lat_max - lat_min
    geo_aspect, box_aspect = geo_w / max(1e-9, geo_h), width_mm / max(1e-9, height_mm)
    if mode == "stretch":
        return lat_min, lat_max, lon_min, lon_max, 0.0, 0.0, width_mm, height_mm
    if mode == "cover":
        if geo_aspect < box_aspect:
            dlon, lc = (geo_h * box_aspect) / cos_mid, 0.5 * (lon_min + lon_max)
            lon_min, lon_max = max(-179.99, lc - 0.5 * dlon), min(179.99, lc + 0.5 * dlon)
        else:
            dlat = geo_w / box_aspect
            lat_min = max(-MAX_MERCATOR_LAT, lat_mid - 0.5 * dlat)
            lat_max = min(MAX_MERCATOR_LAT, lat_mid + 0.5 * dlat)
        return lat_min, lat_max, lon_min, lon_max, 0.0, 0.0, width_mm, height_mm
    mw, mh = (height_mm * geo_aspect, height_mm) if geo_aspect <= box_aspect else (width_mm, width_mm / geo_aspect)
    return lat_min, lat_max, lon_min, lon_max, 0.5 * (width_mm - mw), 0.5 * (height_mm - mh), mw, mh


def sample_dem_grid(
    lat_min: float, lat_max: float, lon_min: float, lon_max: float,
    zoom: int, nx: int, ny: int, cache_dir: Path,
) -> List[List[float]]:
    """Fetch required AWS Terrarium tiles and bilinearly resample onto an ny x nx grid."""
    n_tiles = 1 << zoom
    px_min, py_top = _latlon_to_merc_px(lat_max, lon_min, zoom)
    px_max, py_bot = _latlon_to_merc_px(lat_min, lon_max, zoom)
    tx0, tx1 = max(0, int(px_min // 256)), min(n_tiles - 1, int(px_max // 256) + 1)
    ty0, ty1 = max(0, int(py_top // 256)), min(n_tiles - 1, int(py_bot // 256) + 1)
    tiles: Dict[Tuple[int, int], Tuple[int, int, List[float]]] = {
        (tx % n_tiles, ty): decode_terrarium_png(_fetch_tile_bytes(zoom, tx % n_tiles, ty, cache_dir))
        for ty in range(ty0, min(n_tiles, ty1 + 1)) for tx in range(tx0, min(n_tiles, tx1 + 1))
    }
    span_px, max_px = n_tiles * 256, float(n_tiles * 256 - 1)

    def _get(ix: int, iy: int) -> float:
        iy_c = 0 if iy < 0 else (span_px - 1 if iy >= span_px else iy)
        ix_w = ix % span_px
        tw, _, data = tiles[(ix_w >> 8, iy_c >> 8)]
        return data[(iy_c & 255) * tw + (ix_w & 255)]

    lon_step, lat_step = (lon_max - lon_min) / max(1, nx - 1), (lat_max - lat_min) / max(1, ny - 1)
    xs_px = [max(0.0, min(max_px - 1e-6, ((lon_min + c * lon_step + 180.0) / 360.0) * span_px)) for c in range(nx)]
    grid: List[List[float]] = []
    for r in range(ny):
        py = max(0.0, min(max_px - 1e-6, _latlon_to_merc_px(lat_min + r * lat_step, 0.0, zoom)[1]))
        y0, fy, y1 = int(py), py - int(py), min(span_px - 1, int(py) + 1)
        row_out = [0.0] * nx
        for c, px in enumerate(xs_px):
            x0, fx = int(px), px - int(px)
            row_out[c] = (
                (1.0 - fy) * ((1.0 - fx) * _get(x0, y0) + fx * _get(x0 + 1, y0))
                + fy * ((1.0 - fx) * _get(x0, y1) + fx * _get(x0 + 1, y1))
            )
        grid.append(row_out)
    return grid


def _smooth_elevations(grid: List[List[float]], passes: int) -> List[List[float]]:
    cur = grid
    for _ in range(max(0, passes)):
        ny, nx = len(cur), len(cur[0])
        nxt = [row[:] for row in cur]
        for r in range(1, ny - 1):
            rm, r0, rp, out = cur[r - 1], cur[r], cur[r + 1], nxt[r]
            for c in range(1, nx - 1):
                out[c] = (
                    0.56 * r0[c] + 0.085 * (r0[c - 1] + r0[c + 1] + rm[c] + rp[c])
                    + 0.025 * (rm[c - 1] + rm[c + 1] + rp[c - 1] + rp[c + 1])
                )
        cur = nxt
    return cur


def _flood_collect(
    mask: List[List[int]], vis: List[bytearray], seeds: Sequence[Tuple[int, int]], target: int,
) -> List[Tuple[int, int]]:
    cy, cx = len(mask), len(mask[0])
    q: collections.deque[Tuple[int, int]] = collections.deque()
    comp: List[Tuple[int, int]] = []
    for r, c in seeds:
        if mask[r][c] == target and not vis[r][c]:
            vis[r][c] = 1
            q.append((r, c))
    while q:
        r, c = q.popleft()
        comp.append((r, c))
        for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
            if 0 <= nr < cy and 0 <= nc < cx and mask[nr][nc] == target and not vis[nr][nc]:
                vis[nr][nc] = 1
                q.append((nr, nc))
    return comp


def build_manifold_cell_mask(
    elev: List[List[float]], cutout_threshold_m: Optional[float],
    min_island_cells: int, exterior_ocean_only: bool = True,
) -> List[List[int]]:
    """Build a 4-connected, inland-hole-free, zero-pinch 2-manifold active cell mask."""
    cy, cx = len(elev) - 1, len(elev[0]) - 1
    if cutout_threshold_m is None:
        return [[1] * cx for _ in range(cy)]
    cell_e = [
        [0.25 * (elev[r][c] + elev[r][c + 1] + elev[r + 1][c] + elev[r + 1][c + 1]) for c in range(cx)]
        for r in range(cy)
    ]
    mask = [[1 if cell_e[r][c] > cutout_threshold_m else 0 for c in range(cx)] for r in range(cy)]
    if exterior_ocean_only:
        ocean = [bytearray(cx) for _ in range(cy)]
        border = [(r, c) for r in range(cy) for c in (0, cx - 1)] + [(r, c) for c in range(cx) for r in (0, cy - 1)]
        _flood_collect(mask, ocean, border, target=0)
        for r in range(cy):
            for c in range(cx):
                if mask[r][c] == 0 and not ocean[r][c]:
                    mask[r][c] = 1
    if min_island_cells > 1:
        vis = [bytearray(cx) for _ in range(cy)]
        for r0 in range(cy):
            for c0 in range(cx):
                if mask[r0][c0] and not vis[r0][c0]:
                    comp = _flood_collect(mask, vis, [(r0, c0)], target=1)
                    if len(comp) < min_island_cells:
                        for r, c in comp:
                            mask[r][c] = 0
    for _ in range(24):
        changed = False
        for r in range(cy - 1):
            m0, m1 = mask[r], mask[r + 1]
            for c in range(cx - 1):
                a, b, d, e = m0[c], m0[c + 1], m1[c], m1[c + 1]
                if a == e == 1 and b == d == 0:
                    br, bc = (r, c + 1) if cell_e[r][c + 1] >= cell_e[r + 1][c] else (r + 1, c)
                    mask[br][bc], changed = 1, True
                elif b == d == 1 and a == e == 0:
                    br, bc = (r, c) if cell_e[r][c] >= cell_e[r + 1][c + 1] else (r + 1, c + 1)
                    mask[br][bc], changed = 1, True
        if not changed:
            break
    return mask


def _smooth_coastline_xy(
    xs: List[List[float]], ys: List[List[float]], mask: List[List[int]], passes: int, min_area2: float,
) -> None:
    """Area-guarded tangential smoothing of interior coastline vertices to remove stairsteps."""
    if passes <= 0:
        return
    cy, cx = len(mask), len(mask[0])
    b_edges: Dict[Tuple[int, int], List[Tuple[int, int]]] = collections.defaultdict(list)
    v_cells: Dict[Tuple[int, int], List[Tuple[int, int]]] = collections.defaultdict(list)
    for r in range(cy):
        for c in range(cx):
            if not mask[r][c]:
                continue
            for v in ((r, c), (r, c + 1), (r + 1, c), (r + 1, c + 1)):
                v_cells[v].append((r, c))
            for cond, u, v in (
                (r == 0 or not mask[r - 1][c], (r, c), (r, c + 1)),
                (r == cy - 1 or not mask[r + 1][c], (r + 1, c), (r + 1, c + 1)),
                (c == 0 or not mask[r][c - 1], (r, c), (r + 1, c)),
                (c == cx - 1 or not mask[r][c + 1], (r, c + 1), (r + 1, c + 1)),
            ):
                if cond:
                    b_edges[u].append(v); b_edges[v].append(u)
    verts = [(vr, vc) for (vr, vc), nbs in b_edges.items() if len(nbs) == 2 and 0 < vr < cy and 0 < vc < cx]
    for _ in range(passes):
        updates = [
            (vr, vc, 0.5 * xs[vr][vc] + 0.25 * (xs[r1][c1] + xs[r2][c2]), 0.5 * ys[vr][vc] + 0.25 * (ys[r1][c1] + ys[r2][c2]))
            for vr, vc in verts for (r1, c1), (r2, c2) in (b_edges[(vr, vc)],)
        ]
        for vr, vc, tx, ty in updates:
            ox, oy = xs[vr][vc], ys[vr][vc]
            xs[vr][vc], ys[vr][vc] = tx, ty
            for r, c in v_cells[(vr, vc)]:
                x00, y00, x10, y10 = xs[r][c], ys[r][c], xs[r][c + 1], ys[r][c + 1]
                x11, y11, x01, y01 = xs[r + 1][c + 1], ys[r + 1][c + 1], xs[r + 1][c], ys[r + 1][c]
                if ((x10 - x00) * (y11 - y00) - (y10 - y00) * (x11 - x00)) < min_area2 or (
                    (x11 - x00) * (y01 - y00) - (y11 - y00) * (x01 - x00)
                ) < min_area2:
                    xs[vr][vc], ys[vr][vc] = ox, oy
                    break


def write_relief_stl(
    out_path: Path, xs: List[List[float]], ys: List[List[float]], zs: List[List[float]], mask: List[List[int]],
) -> int:
    """Emit a watertight binary STL from grid vertex tables and a 2-manifold cell mask."""
    cy, cx = len(mask), len(mask[0])
    buf, pack_tri, n_tris = bytearray(), struct.Struct("<12fH").pack, 0

    def _emit(p0: Vec3, p1: Vec3, p2: Vec3) -> None:
        nonlocal n_tris
        ux, uy, uz = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
        vx, vy, vz = p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]
        nx_v, ny_v, nz_v = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        ln = math.sqrt(nx_v * nx_v + ny_v * ny_v + nz_v * nz_v)
        inv = (1.0 / ln) if ln > 1e-12 else 0.0
        buf.extend(pack_tri(nx_v * inv, ny_v * inv, nz_v * inv, *p0, *p1, *p2, 0))
        n_tris += 1

    for r in range(cy):
        mrow = mask[r]
        for c in range(cx):
            if not mrow[c]:
                continue
            tsw, tse = (xs[r][c], ys[r][c], zs[r][c]), (xs[r][c + 1], ys[r][c + 1], zs[r][c + 1])
            tne, tnw = (xs[r + 1][c + 1], ys[r + 1][c + 1], zs[r + 1][c + 1]), (xs[r + 1][c], ys[r + 1][c], zs[r + 1][c])
            bsw, bse, bne, bnw = (tsw[0], tsw[1], 0.0), (tse[0], tse[1], 0.0), (tne[0], tne[1], 0.0), (tnw[0], tnw[1], 0.0)
            _emit(tsw, tse, tne); _emit(tsw, tne, tnw); _emit(bsw, bne, bse); _emit(bsw, bnw, bne)
            if r == 0 or not mask[r - 1][c]:
                _emit(bsw, bse, tse); _emit(bsw, tse, tsw)
            if c == cx - 1 or not mrow[c + 1]:
                _emit(bse, bne, tne); _emit(bse, tne, tse)
            if r == cy - 1 or not mask[r + 1][c]:
                _emit(bne, bnw, tnw); _emit(bne, tnw, tne)
            if c == 0 or not mrow[c - 1]:
                _emit(bnw, bsw, tsw); _emit(bnw, tsw, tnw)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(b"map-to-3dprint orbital continent relief (AWS Terrarium DEM)".ljust(80, b" ")[:80])
        f.write(struct.pack("<I", n_tris))
        f.write(buf)
    return n_tris


def build_continent_relief_stl(args: argparse.Namespace) -> Dict[str, object]:
    """Run Terrarium fetch -> resample -> 2-manifold relief mesh -> binary STL export."""
    t0, out_path = time.time(), Path(args.out).resolve()
    cache_dir = Path(args.cache_dir).resolve() if args.cache_dir else (out_path.parent / "dem_tile_cache")
    cutout_thr: Optional[float] = (
        float(args.cutout_below_m) if args.cutout_below_m is not None
        else (float(args.sea_level_m) if args.ocean_cutout else None)
    )
    lat0, lat1, lon0, lon1, off_x, off_y, mw, mh = _resolve_geo_and_mm_bounds(
        args.lat_min, args.lat_max, args.lon_min, args.lon_max,
        args.width_mm, args.height_mm, args.fit_mode, cutout_thr is not None,
    )
    g = max(32, int(args.grid_max))
    nx, ny = (
        (max(16, int(args.nx)), max(16, int(args.ny))) if (args.nx and args.ny)
        else ((g, max(16, int(round(g * mh / max(1e-6, mw))))) if mw >= mh else (max(16, int(round(g * mw / max(1e-6, mh)))), g))
    )
    elev = _smooth_elevations(sample_dem_grid(lat0, lat1, lon0, lon1, args.zoom, nx, ny, cache_dir), args.elev_smooth)
    ext_only = bool(args.ocean_cutout and args.cutout_below_m is None and not args.allow_inland_holes)
    mask = build_manifold_cell_mask(elev, cutout_thr, args.min_island_cells, exterior_ocean_only=ext_only)
    active = sum(sum(row) for row in mask)
    if active == 0:
        raise ValueError("No land cells found above cutout threshold in requested bounding box.")
    vals = [elev[vr][vc] for r in range(ny - 1) for c in range(nx - 1) if mask[r][c] for vr, vc in ((r, c), (r, c + 1), (r + 1, c), (r + 1, c + 1))]
    e_floor, e_max = (cutout_thr if cutout_thr is not None else min(vals)), max(vals)
    e_span, dx, dy = max(1.0, e_max - e_floor), mw / max(1, nx - 1), mh / max(1, ny - 1)
    xs = [[off_x + c * dx for c in range(nx)] for _ in range(ny)]
    ys = [[off_y + r * dy for c in range(nx)] for r in range(ny)]
    zs = [[float(args.base_mm) + float(args.max_relief_mm) * (max(0.0, (elev[r][c] - e_floor) / e_span) ** float(args.z_gamma)) for c in range(nx)] for r in range(ny)]
    if cutout_thr is not None:
        _smooth_coastline_xy(xs, ys, mask, args.coast_smooth, min_area2=0.18 * dx * dy)
    n_tris = write_relief_stl(out_path, xs, ys, zs, mask)
    return {
        "out": str(out_path), "grid": (nx, ny), "active_cells": active, "triangles": n_tris,
        "mesh_mm": (round(mw, 2), round(mh, 2)), "elev_m": (round(e_floor, 1), round(e_max, 1)),
        "z_max_mm": round(float(args.base_mm) + float(args.max_relief_mm), 2), "elapsed_s": round(time.time() - t0, 2),
    }


def _parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build watertight orbital topographic relief STL from AWS Terrarium DEM.")
    for flag in ("--lat-min", "--lat-max", "--lon-min", "--lon-max"):
        p.add_argument(flag, type=float, required=True)
    for flag, dval in (("--width-mm", 240.0), ("--height-mm", 170.0), ("--max-relief-mm", 26.0), ("--base-mm", 4.0), ("--z-gamma", 0.78), ("--sea-level-m", 0.5)):
        p.add_argument(flag, type=float, default=dval)
    for flag, dval in (("--zoom", 4), ("--grid-max", 380), ("--min-island-cells", 8), ("--coast-smooth", 2), ("--elev-smooth", 1)):
        p.add_argument(flag, type=int, default=dval)
    p.add_argument("--ocean-cutout", nargs="?", const=True, default=True, type=_parse_bool)
    p.add_argument("--no-ocean-cutout", dest="ocean_cutout", action="store_false")
    p.add_argument("--cutout-below-m", type=float, default=None); p.add_argument("--allow-inland-holes", action="store_true", default=False)
    p.add_argument("--nx", type=int, default=None); p.add_argument("--ny", type=int, default=None)
    p.add_argument("--fit-mode", choices=("auto", "contain", "cover", "stretch"), default="auto")
    p.add_argument("--out", required=True); p.add_argument("--cache-dir", default=None)
    return p.parse_args(argv)


def main() -> int:
    i = build_continent_relief_stl(_parse_args())
    print(f"[CONTINENT_STL] {i['out']} | grid={i['grid']} active={i['active_cells']} tris={i['triangles']} mesh_mm={i['mesh_mm']} elev_m={i['elev_m']} z_max={i['z_max_mm']}mm ({i['elapsed_s']}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
