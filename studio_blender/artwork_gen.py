"""GIS-backed & CAD 2K artwork generator for Customer Persona studio props.

Caches high-resolution textures under gitignored
`studio_blender/assets/generated_textures/`:
  - `earth_vintage_globe_2k.png` + `earth_vintage_globe_bump_2k.png` (Natural Earth 110m)
  - `architect_blueprint_2k.png` (CAD architectural floorplan, elevation, compass rose)
"""

from __future__ import annotations

import json
import math
import ssl
import struct
import urllib.error
import urllib.request
import zlib
from pathlib import Path
from typing import Any, Dict, Optional, Sequence, Tuple

import numpy as np

ASSETS_ROOT = Path(__file__).resolve().parent / "assets"
GEN_TEX_DIR = ASSETS_ROOT / "generated_textures"
_NE_LAND_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_110m_land.geojson"
)
_USER_AGENT = "map-to-3dprint-studio/1.0"


def _write_png_rgb(path: Path, rgb: np.ndarray) -> Path:
    """Encode an HxWx3 uint8 numpy array to a valid RGB PNG using stdlib zlib."""
    h, w, c = rgb.shape
    if c != 3 or rgb.dtype != np.uint8:
        raise ValueError(f"Expected HxWx3 uint8 array, got {rgb.shape} {rgb.dtype}")
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = np.concatenate([np.zeros((h, 1), dtype=np.uint8), rgb.reshape(h, w * 3)], axis=1).tobytes()
    comp = zlib.compress(raw, level=6)

    def _chunk(tag: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", comp) + _chunk(b"IEND", b"")
    tmp = path.with_suffix(".png.part")
    tmp.write_bytes(png)
    tmp.replace(path)
    return path


def _ensure_ne_land_geojson() -> Optional[Dict[str, Any]]:
    """Load cached Natural Earth 110m land GeoJSON, downloading if absent."""
    GEN_TEX_DIR.mkdir(parents=True, exist_ok=True)
    cache = GEN_TEX_DIR / "ne_110m_land.geojson"
    if cache.is_file() and cache.stat().st_size > 1024:
        try:
            return json.loads(cache.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    req = urllib.request.Request(_NE_LAND_URL, headers={"User-Agent": _USER_AGENT})
    for ctx in (ssl.create_default_context(), ssl._create_unverified_context()):
        try:
            with urllib.request.urlopen(req, timeout=25, context=ctx) as resp:
                raw = resp.read()
            data = json.loads(raw.decode("utf-8"))
            cache.write_bytes(raw)
            return data
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
            continue
    return None


def _rasterize_polygon_ring(mask: np.ndarray, ring: Sequence[Sequence[float]], w: int, h: int) -> None:
    """XOR scanline-fill one GeoJSON lon/lat ring onto a boolean HxW equirectangular mask."""
    if len(ring) < 3:
        return
    xs = np.array([(pt[0] + 180.0) / 360.0 * (w - 1) for pt in ring], dtype=np.float64)
    ys = np.array([(90.0 - pt[1]) / 180.0 * (h - 1) for pt in ring], dtype=np.float64)
    y_min, y_max = max(0, int(math.floor(float(ys.min())))), min(h - 1, int(math.ceil(float(ys.max()))))
    if y_min > y_max:
        return
    x0, y0, x1, y1 = xs, ys, np.roll(xs, -1), np.roll(ys, -1)
    valid = (np.abs(y1 - y0) > 1e-9) & (np.abs(x1 - x0) < w * 0.48)
    x0, y0, x1, y1 = x0[valid], y0[valid], x1[valid], y1[valid]
    if x0.size == 0:
        return
    lo_y, hi_y, inv_dy = np.minimum(y0, y1), np.maximum(y0, y1), 1.0 / (y1 - y0)
    for row in range(y_min, y_max + 1):
        yr = row + 0.5
        hit = (lo_y <= yr) & (yr < hi_y)
        if not np.any(hit):
            continue
        xi = np.sort(x0[hit] + (yr - y0[hit]) * (x1[hit] - x0[hit]) * inv_dy[hit])
        for k in range(0, xi.size - 1, 2):
            c0, c1 = max(0, int(math.ceil(float(xi[k])))), min(w, int(math.ceil(float(xi[k + 1]))))
            if c0 < c1:
                mask[row, c0:c1] ^= True


def _dilate_mask(mask: np.ndarray, radius: int) -> np.ndarray:
    """Separable 2D dilation with horizontal longitude wrap-around."""
    out = mask.copy()
    for _ in range(radius):
        out = out | np.roll(out, 1, axis=1) | np.roll(out, -1, axis=1)
        pad = np.pad(out, ((1, 1), (0, 0)), mode="edge")
        out = out | pad[:-2, :] | pad[2:, :]
    return out


def ensure_earth_globe_textures(force: bool = False) -> Tuple[Path, Path]:
    """Generate and cache 2048x1024 real-Earth vintage globe diffuse + relief bump PNGs."""
    GEN_TEX_DIR.mkdir(parents=True, exist_ok=True)
    diff_path = GEN_TEX_DIR / "earth_vintage_globe_2k.png"
    bump_path = GEN_TEX_DIR / "earth_vintage_globe_bump_2k.png"
    if not force and diff_path.is_file() and bump_path.is_file() and diff_path.stat().st_size > 16384:
        return diff_path, bump_path

    w, h = 2048, 1024
    land = np.zeros((h, w), dtype=bool)
    geo = _ensure_ne_land_geojson()
    if geo and "features" in geo:
        for feat in geo["features"]:
            geom = feat.get("geometry") or {}
            gtype, coords = geom.get("type"), geom.get("coordinates") or []
            if gtype == "Polygon":
                for ring in coords:
                    _rasterize_polygon_ring(land, ring, w, h)
            elif gtype == "MultiPolygon":
                for poly in coords:
                    for ring in poly:
                        _rasterize_polygon_ring(land, ring, w, h)

    v = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None]
    lat_abs = np.abs(v - 0.5) * 2.0
    rng = np.random.default_rng(42)
    mottle = np.repeat(np.repeat(rng.normal(0.0, 1.0, (h // 8, w // 8)).astype(np.float32), 8, axis=0), 8, axis=1)
    for _ in range(3):
        mottle = (mottle + np.roll(mottle, 3, axis=1) + np.roll(mottle, -3, axis=1) + np.roll(mottle, 3, axis=0) + np.roll(mottle, -3, axis=0)) * 0.2
    fine = rng.normal(0.0, 0.012, (h, w)).astype(np.float32)

    # Rich antique ocean slate-teal-parchment + subtle copperplate coastal bathymetry halos
    img = np.zeros((h, w, 3), dtype=np.float32)
    img[:, :, 0] = 0.22 - 0.05 * lat_abs + 0.028 * mottle + fine
    img[:, :, 1] = 0.34 - 0.04 * lat_abs + 0.026 * mottle + fine
    img[:, :, 2] = 0.38 - 0.04 * lat_abs + 0.022 * mottle + fine

    d1 = _dilate_mask(land, 3) & (~land)
    d2 = _dilate_mask(land, 9) & (~land) & (~d1)
    d3 = _dilate_mask(land, 18) & (~land) & (~d1) & (~d2)
    img[d3] = img[d3] * 0.88 + np.array([0.09, 0.08, 0.05], dtype=np.float32)
    img[d2] = img[d2] * 0.78 + np.array([0.16, 0.14, 0.09], dtype=np.float32)
    img[d1] = np.array([0.11, 0.09, 0.07], dtype=np.float32)

    # Warm vintage aged parchment-ochre continents with coastal sepia shading
    inner_land = ~_dilate_mask(~land, 6)
    img[land, 0] = (0.76 - 0.08 * lat_abs + 0.050 * mottle + fine)[land]
    img[land, 1] = (0.63 - 0.07 * lat_abs + 0.042 * mottle + fine)[land]
    img[land, 2] = (0.41 - 0.05 * lat_abs + 0.032 * mottle + fine)[land]
    img[land & (~inner_land)] *= 0.80
    ice = land & (v > 0.86)
    img[ice] = img[ice] * 0.45 + np.array([0.45, 0.43, 0.38], dtype=np.float32)

    # Crisp 15-degree lat/lon graticules, bold Equator, dashed Tropics & Polar Circles
    grat = np.zeros((h, w), dtype=np.float32)
    for deg in range(-75, 90, 15):
        row = int(round((90.0 - deg) / 180.0 * (h - 1)))
        tk = 2 if deg == 0 else 1
        grat[max(0, row - tk) : min(h, row + tk + 1), :] = 0.72 if deg == 0 else 0.36
    for deg in (-66.5, -23.5, 23.5, 66.5):
        row = int(round((90.0 - deg) / 180.0 * (h - 1)))
        grat[max(0, row - 1) : min(h, row + 1), (np.arange(w) // 10) % 2 == 0] = 0.44
    for deg in range(-180, 180, 15):
        col = int(round((deg + 180.0) / 360.0 * (w - 1)))
        grat[:, max(0, col - 1) : min(w, col + 1)] = np.maximum(grat[:, max(0, col - 1) : min(w, col + 1)], 0.34)

    ink_col = np.array([0.13, 0.10, 0.07], dtype=np.float32)
    img = img * (1.0 - grat[:, :, None]) + ink_col[None, None, :] * grat[:, :, None]

    bump = np.full((h, w), 0.44, dtype=np.float32)
    bump[land] = 0.70 + 0.08 * mottle[land]
    bump[d1] = 0.22
    bump -= grat * 0.16
    bump += fine * 2.0

    _write_png_rgb(diff_path, np.clip(img * 255.0, 0, 255).astype(np.uint8))
    _write_png_rgb(bump_path, np.repeat(np.clip(bump * 255.0, 0, 255).astype(np.uint8)[:, :, None], 3, axis=2))
    return diff_path, bump_path


def _draw_line(
    canvas: np.ndarray, x0: float, y0: float, x1: float, y1: float,
    color: Tuple[float, float, float], width: float = 1.6, dashed: bool = False,
) -> None:
    h, w, _ = canvas.shape
    dx, dy = x1 - x0, y1 - y0
    dist = math.hypot(dx, dy)
    if dist < 1e-4:
        return
    ts = np.linspace(0.0, 1.0, max(2, int(math.ceil(dist * 1.4))), dtype=np.float32)
    if dashed:
        ts = ts[((ts * dist) // 14.0).astype(np.int32) % 2 == 0]
    px, py = np.round(x0 + dx * ts).astype(np.int32), np.round(y0 + dy * ts).astype(np.int32)
    rad, col = max(0, int(round(width * 0.5))), np.array(color, dtype=np.float32)
    for oy in range(-rad, rad + 1):
        for ox in range(-rad, rad + 1):
            if rad > 0 and ox * ox + oy * oy > (rad + 0.35) ** 2:
                continue
            xx, yy = px + ox, py + oy
            ok = (xx >= 0) & (xx < w) & (yy >= 0) & (yy < h)
            canvas[yy[ok], xx[ok]] = col


def _draw_rect(
    canvas: np.ndarray, x0: float, y0: float, x1: float, y1: float,
    color: Tuple[float, float, float], width: float = 2.0, fill: Optional[Tuple[float, float, float]] = None,
) -> None:
    if fill is not None:
        h, w, _ = canvas.shape
        canvas[max(0, int(min(y0, y1))) : min(h, int(max(y0, y1))), max(0, int(min(x0, x1))) : min(w, int(max(x0, x1)))] = np.array(fill, dtype=np.float32)
    _draw_line(canvas, x0, y0, x1, y0, color, width)
    _draw_line(canvas, x1, y0, x1, y1, color, width)
    _draw_line(canvas, x1, y1, x0, y1, color, width)
    _draw_line(canvas, x0, y1, x0, y0, color, width)


def _draw_arc(
    canvas: np.ndarray, cx: float, cy: float, radius: float, deg0: float, deg1: float,
    color: Tuple[float, float, float], width: float = 1.6, dashed: bool = False,
) -> None:
    segs = max(16, int(abs(deg1 - deg0) * 0.6))
    angs = np.linspace(math.radians(deg0), math.radians(deg1), segs + 1)
    for i in range(segs):
        if dashed and (i % 2 == 1):
            continue
        _draw_line(canvas, cx + radius * math.cos(angs[i]), cy + radius * math.sin(angs[i]), cx + radius * math.cos(angs[i + 1]), cy + radius * math.sin(angs[i + 1]), color, width)


def ensure_architect_blueprint_texture(force: bool = False) -> Path:
    """Generate and cache a 2048x2048 crisp architectural blueprint & elevation vellum PNG."""
    GEN_TEX_DIR.mkdir(parents=True, exist_ok=True)
    out_path = GEN_TEX_DIR / "architect_blueprint_2k.png"
    if not force and out_path.is_file() and out_path.stat().st_size > 16384:
        return out_path

    sz = 2048
    rng = np.random.default_rng(7)
    paper = np.empty((sz, sz, 3), dtype=np.float32)
    paper[:, :, 0], paper[:, :, 1], paper[:, :, 2] = 0.865, 0.822, 0.742
    paper = np.clip(paper + rng.normal(0.0, 0.012, (sz, sz, 1)).astype(np.float32), 0.0, 1.0)
    ink, ink_mid, ink_faint, ink_acc, wall_f = (0.14, 0.17, 0.21), (0.32, 0.37, 0.42), (0.68, 0.65, 0.59), (0.20, 0.29, 0.38), (0.20, 0.23, 0.27)

    for g in range(64, sz, 64):
        paper[g : g + 1, 72 : sz - 72] = paper[g : g + 1, 72 : sz - 72] * 0.65 + np.array(ink_faint) * 0.35
        paper[72 : sz - 72, g : g + 1] = paper[72 : sz - 72, g : g + 1] * 0.65 + np.array(ink_faint) * 0.35

    _draw_rect(paper, 64, 64, sz - 64, sz - 64, ink, 3.5)
    _draw_rect(paper, 82, 82, sz - 82, sz - 82, ink_mid, 1.6)
    _draw_rect(paper, 1460, 1680, sz - 82, sz - 82, ink, 2.4)
    for ry in (1760, 1835, 1905):
        _draw_line(paper, 1460, ry, sz - 82, ry, ink_mid, 1.6)
    _draw_line(paper, 1720, 1760, 1720, sz - 82, ink_mid, 1.6)
    for i in range(6):
        _draw_rect(paper, 1485 + i * 36, 1922, 1521 + i * 36, 1940, ink, 1.4, fill=ink if i % 2 == 0 else None)

    # Lower-left architectural floorplan: grid, bubbles, masonry walls, doors, spiral stair, dims
    px0, py0, px1, py1, wt = 220, 960, 1260, 1790, 18
    for gx in (220, 480, 740, 1000, 1260):
        _draw_line(paper, gx, 880, gx, 1860, ink_mid, 1.2, dashed=True)
        _draw_arc(paper, gx, 855, 22, 0, 360, ink, 1.6)
    for gy in (960, 1240, 1520, 1790):
        _draw_line(paper, 145, gy, 1340, gy, ink_mid, 1.2, dashed=True)
        _draw_arc(paper, 122, gy, 22, 0, 360, ink, 1.6)
    for r in ((px0, py0, px1, py0 + wt), (px0, py1 - wt, px1, py1), (px0, py0, px0 + wt, py1), (px1 - wt, py0, px1, py1),
              (473, py0, 487, 1360), (473, 1460, 487, py1), (480, 1233, 900, 1247), (990, 1233, px1, 1247), (733, 1240, 747, 1650)):
        _draw_rect(paper, r[0], r[1], r[2], r[3], ink, 1.8, fill=wall_f)
    _draw_line(paper, 487, 1360, 582, 1360, ink_acc, 2.0)
    _draw_arc(paper, 487, 1360, 95, 0, 90, ink_acc, 1.4, dashed=True)
    _draw_line(paper, 900, 1233, 900, 1143, ink_acc, 2.0)
    _draw_arc(paper, 900, 1233, 90, 270, 360, ink_acc, 1.4, dashed=True)
    for gx in (480, 740, 1000):
        for gy in (1240, 1520):
            _draw_rect(paper, gx - 16, gy - 16, gx + 16, gy + 16, ink, 1.8, fill=wall_f)
    _draw_arc(paper, 1090, 1540, 135, 0, 360, ink, 2.4)
    _draw_arc(paper, 1090, 1540, 44, 0, 360, ink, 2.0)
    for k in range(18):
        a = math.radians(k * 20.0)
        _draw_line(paper, 1090 + 44 * math.cos(a), 1540 + 44 * math.sin(a), 1090 + 135 * math.cos(a), 1540 + 135 * math.sin(a), ink_mid, 1.5)
    _draw_line(paper, px0, 1895, px1, 1895, ink_acc, 1.6)
    for gx in (220, 480, 740, 1000, 1260):
        _draw_line(paper, gx, 1880, gx, 1910, ink_acc, 1.4)
        _draw_line(paper, gx - 9, 1904, gx + 9, 1886, ink, 2.2)

    # Upper terraced skyscraper elevation & section sketch with ground hatching & datum markers
    base_y = 750
    _draw_line(paper, 180, base_y, 1890, base_y, ink, 3.2)
    for hx in range(195, 1875, 24):
        _draw_line(paper, hx, base_y, hx - 26, base_y + 26, ink_mid, 1.3)
    for tx0, tx1, ty_top in ((260, 460, 410), (470, 690, 290), (700, 960, 155), (970, 1180, 340), (1195, 1445, 235), (1460, 1690, 455)):
        _draw_rect(paper, tx0, ty_top, tx1, base_y, ink, 2.6)
        for mx in range(tx0 + 26, tx1 - 12, 26):
            _draw_line(paper, mx, ty_top, mx, base_y, ink_mid, 1.2)
        for fy in range(ty_top + 38, base_y - 16, 38):
            _draw_line(paper, tx0, fy, tx1, fy, ink_faint, 1.1)
    _draw_rect(paper, 755, 115, 905, 155, ink, 2.2)
    _draw_line(paper, 830, 88, 830, 115, ink, 2.8)
    for dy in (155, 290, 455, 600):
        _draw_line(paper, 175, dy, 1860, dy, ink_acc, 1.1, dashed=True)
        _draw_line(paper, 1765, dy, 1785, dy - 16, ink, 1.8)
        _draw_line(paper, 1785, dy - 16, 1805, dy, ink, 1.8)

    # Architectural compass north rose
    ncx, ncy = 1660, 1280
    _draw_arc(paper, ncx, ncy, 120, 0, 360, ink, 2.2)
    _draw_arc(paper, ncx, ncy, 96, 0, 360, ink_mid, 1.4)
    _draw_line(paper, ncx, ncy - 148, ncx, ncy + 148, ink, 2.0)
    _draw_line(paper, ncx - 148, ncy, ncx + 148, ncy, ink, 2.0)
    for ox, oy, col in ((22, 0, ink), (-22, 0, ink)):
        _draw_line(paper, ncx, ncy - 120, ncx + ox, ncy + oy, col, 2.4)
        _draw_line(paper, ncx + ox, ncy + oy, ncx, ncy + 120, ink_mid, 1.8)

    _write_png_rgb(out_path, np.clip(paper * 255.0, 0, 255).astype(np.uint8))
    return out_path
