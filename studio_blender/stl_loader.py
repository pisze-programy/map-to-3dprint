"""Universal STL loader for Variant C 13x18, A4 passe-partout, and multi-tile frames."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import struct
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None  # type: ignore

try:
    import bpy
    from mathutils import Matrix
except ImportError:  # pragma: no cover
    bpy = None  # type: ignore
    Matrix = None  # type: ignore

from studio_blender.landmark_analyzer import analyze_city_mesh, get_mesh_coords_array, transform_analysis_to_wall_mount

RawStat = Tuple[Tuple[float, float, float], Tuple[float, float, float], float]
MM_TO_M, VARIANT_C_OUTER_W_MM, VARIANT_C_OUTER_H_MM = 0.001, 130.0, 180.0
A4_OPENING_W_MM, A4_OPENING_H_MM = 120.0, 170.0
_FRAME_MM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*(?:mm)?")
_GRID_RC_RE = re.compile(r"_R([12])C([12])", re.IGNORECASE)


def parse_frame_mm(spec: Optional[str]) -> Optional[Tuple[float, float]]:
    """Parse a frame size string such as '145x79' or '122x172mm' into (w_mm, h_mm)."""
    if not spec:
        return None
    m = _FRAME_MM_RE.search(spec.strip())
    if not m:
        raise ValueError(f"Invalid frame_mm specification '{spec}'. Expected e.g. '122x172'.")
    w_mm, h_mm = float(m.group(1)), float(m.group(2))
    if w_mm <= 0.0 or h_mm <= 0.0:
        raise ValueError(f"Frame dimensions must be positive, got {w_mm}x{h_mm}.")
    return (w_mm, h_mm)


def infer_city_title(stl_paths: Sequence[str]) -> str:
    """Derive a clean uppercase display title (e.g. 'NEW YORK', 'DUBAI') from STL path."""
    if not stl_paths:
        return "CITY MAP"
    stem = Path(stl_paths[0]).stem
    cleaned = re.sub(r"(?i)^map3d[_\-\s]*", "", stem)
    cleaned = re.sub(r"(?i)[_\-\s]*\d+(?:\.\d+)?x\d+(?:\.\d+)?mm.*$", "", cleaned)
    cleaned = re.sub(r"(?i)[_\-\s]*(pelna[_\-\s]*bryla|triptych.*|r\d+c\d+.*)$", "", cleaned)
    tokens = [t for t in re.split(r"[_\-\s]+", cleaned) if t]
    if not tokens:
        return "CITY MAP"
    aliases = {
        "NYC": "NEW YORK", "NY": "NEW YORK", "WTC": "NEW YORK",
        "WAW": "WARSAW", "KRK": "KRAKOW", "DXB": "DUBAI",
        "LON": "LONDON", "PAR": "PARIS", "TYO": "TOKYO",
        "CHI": "CHICAGO", "SF": "SAN FRANCISCO",
    }
    return aliases.get(tokens[0].upper(), " ".join(tokens[:2]).upper())


def _infer_frame_mm_from_filename(stl_path: str) -> Optional[Tuple[float, float]]:
    m = re.search(r"(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*mm", Path(stl_path).name, re.IGNORECASE)
    return (float(m.group(1)), float(m.group(2))) if m else None


def _import_binary_stl_fallback(abs_path: str) -> Any:
    """Fast pure-Python binary STL importer fallback."""
    with open(abs_path, "rb") as f:
        f.read(80)
        count_bytes = f.read(4)
        if len(count_bytes) < 4:
            raise ValueError(f"Corrupt or empty STL file: {abs_path}")
        tri_count, raw = struct.unpack("<I", count_bytes)[0], f.read()
    if len(raw) < tri_count * 50:
        raise ValueError(f"Invalid binary STL '{abs_path}': expected {tri_count * 50} bytes, got {len(raw)}.")
    verts: List[Tuple[float, float, float]] = []
    faces: List[Tuple[int, int, int]] = []
    for i in range(tri_count):
        v = struct.unpack_from("<9f", raw, i * 50 + 12)
        b = i * 3
        verts.extend(((v[0], v[1], v[2]), (v[3], v[4], v[5]), (v[6], v[7], v[8])))
        faces.append((b, b + 1, b + 2))
    mesh_name = Path(abs_path).stem[:56]
    mesh = bpy.data.meshes.new(mesh_name)
    mesh.from_pydata(verts, [], faces)
    mesh.update(calc_edges=True)
    obj = bpy.data.objects.new(mesh_name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _import_stl_raw(stl_path: str) -> Any:
    """Import an STL file using Blender 4.2+/5.x wm.stl_import with safe fallbacks."""
    if bpy is None:
        raise RuntimeError("stl_loader must be run inside Blender (bpy unavailable).")
    abs_path = str(Path(stl_path).resolve())
    if not os.path.isfile(abs_path):
        raise FileNotFoundError(f"STL file not found: {abs_path}")
    existing, imported_ok = set(bpy.data.objects), False
    if hasattr(bpy.ops, "wm") and hasattr(bpy.ops.wm, "stl_import"):
        try:
            op = bpy.ops.wm.stl_import
            props = op.get_rna_type().properties
            kwargs: Dict[str, Any] = {"filepath": abs_path}
            if "global_scale" in props:
                kwargs["global_scale"] = 1.0
            if "use_scene_unit" in props:
                kwargs["use_scene_unit"] = False
            imported_ok = "FINISHED" in op(**kwargs)
        except Exception:
            imported_ok = False
    if not imported_ok:
        try:
            op_leg = bpy.ops.import_mesh.stl
            op_leg.get_rna_type()
            imported_ok = "FINISHED" in op_leg(filepath=abs_path, global_scale=1.0)
        except Exception:
            imported_ok = False
    new_objs = [o for o in bpy.data.objects if o not in existing and o.type == "MESH"]
    return new_objs[0] if (imported_ok and new_objs) else _import_binary_stl_fallback(abs_path)


def _measure_raw_mm(obj: Any) -> Tuple[Tuple[float, float, float], Tuple[float, float, float], float]:
    """Bake object world transform and return (min_mm, max_mm, scale_to_m)."""
    if obj.matrix_world != Matrix.Identity(4):
        obj.data.transform(obj.matrix_world)
        obj.matrix_world = Matrix.Identity(4)
    pts = get_mesh_coords_array(obj)
    rmin = pts.min(axis=0) if np is not None else tuple(min(p[k] for p in pts) for k in range(3))
    rmax = pts.max(axis=0) if np is not None else tuple(max(p[k] for p in pts) for k in range(3))
    scale_to_m = MM_TO_M if max(float(rmax[0] - rmin[0]), float(rmax[1] - rmin[1])) > 1.5 else 1.0
    to_mm = 1.0 if scale_to_m == MM_TO_M else 1000.0
    return (
        (float(rmin[0]) * to_mm, float(rmin[1]) * to_mm, float(rmin[2]) * to_mm),
        (float(rmax[0]) * to_mm, float(rmax[1]) * to_mm, float(rmax[2]) * to_mm),
        scale_to_m,
    )


def _apply_mesh_transform(obj: Any, shift_mm: Tuple[float, float, float], scale_to_m: float) -> None:
    """Scale raw mesh to meters, translate by shift_mm, and enforce crisp flat architectural faces."""
    tx, ty, tz = shift_mm[0] * MM_TO_M, shift_mm[1] * MM_TO_M, shift_mm[2] * MM_TO_M
    obj.data.transform(Matrix.Translation((tx, ty, tz)) @ Matrix.Scale(scale_to_m, 4))
    obj.matrix_world = Matrix.Identity(4)
    mesh = obj.data
    n_polys = len(mesh.polygons)
    if n_polys > 0:
        mesh.polygons.foreach_set("use_smooth", [False] * n_polys)
    mesh.update()


def _tile_meta(
    obj: Any, stl_path: str, mn: Tuple[float, float, float], mx: Tuple[float, float, float],
    offset_x_m: float, offset_y_m: float, fit: Optional[float] = None,
) -> Dict[str, Any]:
    """Build normalized tile metadata dict for a transformed city STL object."""
    f = 1.0 if fit is None else fit
    meta: Dict[str, Any] = {
        "object": obj, "stl_path": str(Path(stl_path).resolve()),
        "mesh_size_m": [(mx[0] - mn[0]) * f * MM_TO_M, (mx[1] - mn[1]) * f * MM_TO_M, (mx[2] - mn[2]) * f * MM_TO_M],
        "offset_x_m": offset_x_m, "offset_y_m": offset_y_m,
    }
    if fit is not None:
        meta["fit_scale"] = round(fit, 5)
    return meta


def _align_single_13x18(
    raw_objs: List[Any],
    raw_stats: List[Tuple[Tuple[float, float, float], Tuple[float, float, float], float]],
    stl_paths: Sequence[str], rim_width_mm: float,
    frame_mm_override: Optional[Tuple[float, float]], tight_frameless: bool = False,
) -> Tuple[float, float, List[Dict[str, Any]]]:
    """Assemble 1-3 tiles inside a Variant C 130x180mm opening or tight frameless bbox."""
    inner_w_portrait, inner_h_portrait = VARIANT_C_OUTER_W_MM - 2.0 * rim_width_mm, VARIANT_C_OUTER_H_MM - 2.0 * rim_width_mm
    tile_metas: List[Dict[str, Any]] = []
    if len(raw_objs) >= 2:
        y_spans = [max(1.0, st[1][1] - st[0][1]) for st in raw_stats]
        min_x_all, max_x_all = min(st[0][0] for st in raw_stats), max(st[1][0] for st in raw_stats)
        span_x, total_y = max_x_all - min_x_all, sum(y_spans)
        if frame_mm_override is not None:
            inner_w_mm, inner_h_mm = frame_mm_override
        elif tight_frameless:
            inner_w_mm, inner_h_mm = span_x, total_y
        else:
            inner_w_mm, inner_h_mm = max(inner_w_portrait, span_x), total_y
        in_nom_x = (not tight_frameless) and (min_x_all >= -2.0) and (max_x_all <= inner_w_mm + 2.0)
        shift_x_mm, y_cursor = (-0.5 * inner_w_mm) if in_nom_x else (-0.5 * (min_x_all + max_x_all)), 0.5 * total_y
        for idx, (obj, (mn, mx, sc), sp) in enumerate(zip(raw_objs, raw_stats, stl_paths)):
            tile_h = y_spans[idx]
            y_bot = y_cursor - tile_h
            _apply_mesh_transform(obj, (shift_x_mm, y_bot - mn[1], -mn[2]), sc)
            y_cursor -= tile_h
            tile_metas.append(_tile_meta(obj, sp, mn, mx, 0.0, (y_bot + 0.5 * tile_h) * MM_TO_M))
        return inner_w_mm * MM_TO_M, inner_h_mm * MM_TO_M, tile_metas

    mn, mx, sc = raw_stats[0]
    size_x, size_y = mx[0] - mn[0], mx[1] - mn[1]
    nom_mm = _infer_frame_mm_from_filename(stl_paths[0])
    nom_w, nom_h = (nom_mm[0], nom_mm[1]) if nom_mm else (max(mx[0], size_x), max(mx[1], size_y))
    if frame_mm_override is not None:
        inner_w_mm, inner_h_mm = frame_mm_override
    elif tight_frameless:
        inner_w_mm, inner_h_mm = size_x, size_y
    elif nom_w > inner_w_portrait + 1.0 or size_x > inner_w_portrait + 1.0:
        inner_w_mm, inner_h_mm = max(inner_h_portrait, nom_w, size_x), max(inner_w_portrait, nom_h, size_y)
    else:
        inner_w_mm, inner_h_mm = max(inner_w_portrait, size_x), max(inner_h_portrait, size_y)
    if tight_frameless and frame_mm_override is None:
        shift_x_mm, shift_y_mm = -0.5 * (mn[0] + mx[0]), -0.5 * (mn[1] + mx[1])
    else:
        in_x, in_y = (mn[0] >= -2.0 and mx[0] <= nom_w + 2.0), (mn[1] >= -2.0 and mx[1] <= nom_h + 2.0)
        shift_x_mm = -0.5 * nom_w if in_x else -0.5 * (mn[0] + mx[0])
        shift_y_mm = -0.5 * nom_h if in_y else -0.5 * (mn[1] + mx[1])
    _apply_mesh_transform(raw_objs[0], (shift_x_mm, shift_y_mm, -mn[2]), sc)
    tile_metas.append(_tile_meta(raw_objs[0], stl_paths[0], mn, mx, 0.0, 0.0))
    return inner_w_mm * MM_TO_M, inner_h_mm * MM_TO_M, tile_metas


def _is_landscape_a4_strips(raw_stats: Sequence[RawStat], stl_paths: Sequence[str], frame_mm_override: Optional[Tuple[float, float]]) -> bool:
    """Return True when multi-tile A4 inputs are landscape 3x1 (56.7x120mm) or 2x1 (85x120mm) strips."""
    n = len(raw_stats)
    if n < 2:
        return False
    if frame_mm_override is not None:
        return frame_mm_override[0] > frame_mm_override[1] + 5.0
    for sp in stl_paths:
        fm = _infer_frame_mm_from_filename(sp)
        if fm and abs(fm[1] - A4_OPENING_W_MM) <= 1.5 and (abs(fm[0] - 56.7) <= 1.2 or abs(fm[0] - 85.0) <= 1.2):
            return True
        if fm and abs(fm[0] - A4_OPENING_W_MM) <= 1.5 and (abs(fm[1] - 56.7) <= 1.2 or abs(fm[1] - 85.0) <= 1.2):
            return False
    nom_w = A4_OPENING_H_MM / float(n)
    max_dy = max(mx[1] - mn[1] for mn, mx, _ in raw_stats)
    return max_dy > nom_w + 5.0 and all(mn[0] >= -2.0 and mx[0] <= nom_w + 2.0 and mn[1] >= -2.0 and mx[1] <= A4_OPENING_W_MM + 2.0 for mn, mx, _ in raw_stats)


def _align_a4_passepartout(
    raw_objs: List[Any], raw_stats: List[RawStat], stl_paths: Sequence[str], frame_mm_override: Optional[Tuple[float, float]],
) -> Tuple[float, float, List[Dict[str, Any]]]:
    """Fit Portrait 1x3/1x2 (120x170mm), Landscape 3x1/2x1 (170x120mm), 2x2 (_R#C#), or 1 tile flush."""
    n_tiles = len(raw_objs)
    tile_metas: List[Dict[str, Any]] = []
    rc_matches = [_GRID_RC_RE.search(Path(sp).stem) for sp in stl_paths]
    if n_tiles == 4 and all(rc_matches):
        op_w, op_h = frame_mm_override if frame_mm_override else (A4_OPENING_W_MM, A4_OPENING_H_MM)
        cw, ch = 0.5 * op_w, 0.5 * op_h
        max_dx, max_dy = max(st[1][0] - st[0][0] for st in raw_stats), max(st[1][1] - st[0][1] for st in raw_stats)
        fit = 1.0 if (2.0 * max_dx <= op_w + 0.5 and 2.0 * max_dy <= op_h + 0.5) else min(1.0, op_w / max(2.0 * max_dx, 1.0), op_h / max(2.0 * max_dy, 1.0))
        for obj, (mn, mx, sc), sp, m in zip(raw_objs, raw_stats, stl_paths, rc_matches):
            row, col = int(m.group(1)), int(m.group(2))  # type: ignore[union-attr]
            x_lo, y_lo = (-0.5 * op_w + (col - 1) * cw) * fit, (0.5 * op_h - row * ch) * fit
            in_x, in_y = (mn[0] >= -2.0 and mx[0] <= cw + 2.0), (mn[1] >= -2.0 and mx[1] <= ch + 2.0)
            sx = x_lo if in_x else (x_lo + 0.5 * cw * fit - 0.5 * (mn[0] + mx[0]) * fit)
            sy = y_lo if in_y else (y_lo + 0.5 * ch * fit - 0.5 * (mn[1] + mx[1]) * fit)
            _apply_mesh_transform(obj, (sx, sy, -mn[2] * fit), sc * fit)
            tile_metas.append(_tile_meta(obj, sp, mn, mx, (x_lo + 0.5 * cw * fit) * MM_TO_M, (y_lo + 0.5 * ch * fit) * MM_TO_M, fit))
        return op_w * MM_TO_M, op_h * MM_TO_M, tile_metas

    if n_tiles >= 2:
        is_land = _is_landscape_a4_strips(raw_stats, stl_paths, frame_mm_override)
        op_w, op_h = frame_mm_override if frame_mm_override else ((A4_OPENING_H_MM, A4_OPENING_W_MM) if is_land else (A4_OPENING_W_MM, A4_OPENING_H_MM))
        s, c = (0, 1) if is_land else (1, 0)
        op_s, op_c = (op_w, op_h) if is_land else (op_h, op_w)
        s_spans = [max(1.0, st[1][s] - st[0][s]) for st in raw_stats]
        min_c, max_c = min(st[0][c] for st in raw_stats), max(st[1][c] for st in raw_stats)
        total_s, span_c, nom_s = sum(s_spans), max_c - min_c, op_s / float(n_tiles)
        in_nom_c = (min_c >= -2.0) and (max_c <= op_c + 2.0)
        in_nom_s = all((st[0][s] >= -2.0) and (st[1][s] <= nom_s + 2.0) for st in raw_stats)
        eff_s, eff_c = (op_s if in_nom_s else total_s), (op_c if in_nom_c else span_c)
        fit = 1.0 if (eff_s <= op_s + 0.35 and eff_c <= op_c + 0.35) else min(1.0, op_s / max(eff_s, 1.0), op_c / max(eff_c, 1.0))
        shift_c = (-0.5 * op_c * fit) if in_nom_c else (-0.5 * (min_c + max_c) * fit)
        cursor_s = (-0.5 * total_s * fit) if is_land else (0.5 * total_s * fit)
        for idx, (obj, (mn, mx, sc), sp) in enumerate(zip(raw_objs, raw_stats, stl_paths)):
            if in_nom_s:
                ts = nom_s * fit
                s_lo = ((-0.5 * op_s + idx * nom_s) if is_land else (0.5 * op_s - (idx + 1) * nom_s)) * fit
                shift_s = s_lo
            else:
                ts = s_spans[idx] * fit
                s_lo = cursor_s if is_land else (cursor_s - ts)
                shift_s, cursor_s = s_lo - mn[s] * fit, (cursor_s + ts if is_land else cursor_s - ts)
            sh_x, sh_y = (shift_s, shift_c) if is_land else (shift_c, shift_s)
            off_x, off_y = (((s_lo + 0.5 * ts) * MM_TO_M, 0.0) if is_land else (0.0, (s_lo + 0.5 * ts) * MM_TO_M))
            _apply_mesh_transform(obj, (sh_x, sh_y, -mn[2] * fit), sc * fit)
            tile_metas.append(_tile_meta(obj, sp, mn, mx, off_x, off_y, fit))
        return op_w * MM_TO_M, op_h * MM_TO_M, tile_metas

    mn, mx, sc = raw_stats[0]
    sx, sy = mx[0] - mn[0], mx[1] - mn[1]
    op_w, op_h = frame_mm_override if frame_mm_override else ((A4_OPENING_H_MM, A4_OPENING_W_MM) if sx > sy * 1.05 else (A4_OPENING_W_MM, A4_OPENING_H_MM))
    in_nom_x, in_nom_y = (mn[0] >= -2.0 and mx[0] <= op_w + 2.0), (mn[1] >= -2.0 and mx[1] <= op_h + 2.0)
    fit = 1.0 if (sx <= op_w + 0.25 and sy <= op_h + 0.25) else min(1.0, op_w / max(sx, 1.0), op_h / max(sy, 1.0))
    shx, shy = ((-0.5 * op_w * fit) if in_nom_x else (-0.5 * (mn[0] + mx[0]) * fit)), ((-0.5 * op_h * fit) if in_nom_y else (-0.5 * (mn[1] + mx[1]) * fit))
    _apply_mesh_transform(raw_objs[0], (shx, shy, -mn[2] * fit), sc * fit)
    tile_metas.append(_tile_meta(raw_objs[0], stl_paths[0], mn, mx, 0.0, 0.0, fit))
    return op_w * MM_TO_M, op_h * MM_TO_M, tile_metas


def _align_multi_or_tight(
    raw_objs: List[Any], raw_stats: List[RawStat], stl_paths: Sequence[str], frame_style: str,
    rim_width_mm: float, frame_mm_override: Optional[Tuple[float, float]], tile_gap_m: float,
) -> Tuple[float, float, List[Tuple[float, float]], List[Dict[str, Any]]]:
    """Align single tight frame, triptych_3x1 (1x3), or quartet_2x2 (2x2)."""
    n_tiles, tile_dims_mm = len(raw_objs), []
    for (mn, mx, _), sp in zip(raw_stats, stl_paths):
        sx, sy = mx[0] - mn[0], mx[1] - mn[1]
        fm = frame_mm_override or _infer_frame_mm_from_filename(sp)
        if fm is None:
            fm = (max(mx[0], sx), max(mx[1], sy)) if (mn[0] >= -1.0 and mn[1] >= -1.0) else (sx, sy)
        tile_dims_mm.append((max(fm[0], sx), max(fm[1], sy)))
    tile_w_m, tile_h_m = max(d[0] for d in tile_dims_mm) * MM_TO_M, max(d[1] for d in tile_dims_mm) * MM_TO_M
    border_m = 2.0 * rim_width_mm * MM_TO_M
    pitch_x, pitch_y = tile_w_m + border_m + tile_gap_m, tile_h_m + border_m + tile_gap_m
    if frame_style == "quartet_2x2" and n_tiles >= 4:
        centers_xy = [(-0.5 * pitch_x, 0.5 * pitch_y), (0.5 * pitch_x, 0.5 * pitch_y), (-0.5 * pitch_x, -0.5 * pitch_y), (0.5 * pitch_x, -0.5 * pitch_y)][:n_tiles]
    elif n_tiles == 1:
        centers_xy = [(0.0, 0.0)]
    else:
        centers_xy = [(-0.5 * (n_tiles - 1) * pitch_x + i * pitch_x, 0.0) for i in range(n_tiles)]
    tile_metas: List[Dict[str, Any]] = []
    for obj, (mn, mx, sc), sp, (fw_mm, fh_mm), (cx, cy) in zip(raw_objs, raw_stats, stl_paths, tile_dims_mm, centers_xy):
        in_x, in_y = (mn[0] >= -2.0 and mx[0] <= fw_mm + 2.0), (mn[1] >= -2.0 and mx[1] <= fh_mm + 2.0)
        sx_mm = (-0.5 * fw_mm if in_x else -0.5 * (mn[0] + mx[0])) + cx / MM_TO_M
        sy_mm = (-0.5 * fh_mm if in_y else -0.5 * (mn[1] + mx[1])) + cy / MM_TO_M
        _apply_mesh_transform(obj, (sx_mm, sy_mm, -mn[2]), sc)
        tile_metas.append(_tile_meta(obj, sp, mn, mx, cx, cy))
    return tile_w_m, tile_h_m, centers_xy, tile_metas


def _is_a4_strip_set(raw_stats: Sequence[RawStat], stl_paths: Sequence[str], frame_mm_override: Optional[Tuple[float, float]]) -> bool:
    """Return True when multi-tile frameless inputs are Portrait 1x3/1x2 or Landscape 3x1/2x1 A4 strips."""
    n = len(raw_stats)
    if n < 2:
        return False
    if frame_mm_override is not None or _is_landscape_a4_strips(raw_stats, stl_paths, frame_mm_override):
        return True
    for sp in stl_paths:
        fm = _infer_frame_mm_from_filename(sp)
        if fm and abs(fm[0] - A4_OPENING_W_MM) <= 1.5 and (abs(fm[1] - 56.7) <= 1.2 or abs(fm[1] - 85.0) <= 1.2):
            return True
    nom_h = A4_OPENING_H_MM / float(n)
    return all(mn[0] >= -2.0 and mx[0] <= A4_OPENING_W_MM + 2.0 and mn[1] >= -2.0 and mx[1] <= nom_h + 2.0 for mn, mx, _ in raw_stats)


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def apply_draft_prefix(filename: str, is_draft: bool) -> str:
    """Prefix DRAFT_UNVALIDATED_ onto a filename or path basename when rendering unvalidated drafts."""
    if not is_draft:
        return filename
    p = Path(filename)
    if p.name.startswith("DRAFT_UNVALIDATED_"):
        return filename
    return str(p.with_name(f"DRAFT_UNVALIDATED_{p.name}")) if str(p.parent) not in ("", ".") else f"DRAFT_UNVALIDATED_{p.name}"


def verify_manifest_for_render(manifest_path: str, allow_draft: bool = False) -> Tuple[Dict[str, Any], bool]:
    """Verify assembly_manifest.json SHA-256 integrity, report digest, and PASS verdict.

    Returns (manifest_dict, is_draft_unvalidated). Raises RuntimeError on failure unless allow_draft=True.
    """
    m_path = Path(manifest_path).resolve()
    if not m_path.is_file():
        raise FileNotFoundError(f"assembly_manifest.json not found: {m_path}")
    manifest: Dict[str, Any] = json.loads(m_path.read_text(encoding="utf-8"))
    base_dir = m_path.parent
    errors: List[str] = []

    val = manifest.get("validation") or {}
    if val.get("verdict") != "PASS":
        errors.append(f"validation.verdict is '{val.get('verdict')}' (must be 'PASS')")

    rep_file = val.get("report_file")
    rep_sha = val.get("report_sha256")
    if not isinstance(rep_file, str) or not rep_file.strip():
        errors.append("validation.report_file is missing or empty")
    if not isinstance(rep_sha, str) or not rep_sha.strip():
        errors.append("validation.report_sha256 is missing or empty")
    if isinstance(rep_file, str) and rep_file.strip():
        rp = base_dir / rep_file.strip()
        if not rp.is_file():
            errors.append(f"validation report missing: {rp}")
        else:
            if isinstance(rep_sha, str) and rep_sha.strip():
                act_rep_sha = _sha256_file(rp)
                if act_rep_sha != rep_sha.strip():
                    errors.append(f"validation report SHA-256 mismatch: {rp}")
            try:
                rep_doc = json.loads(rp.read_text(encoding="utf-8"))
                if not isinstance(rep_doc, dict) or rep_doc.get("verdict") != "PASS":
                    errors.append(f"validation report verdict is '{rep_doc.get('verdict') if isinstance(rep_doc, dict) else None}' (must be 'PASS')")
            except Exception as exc:
                errors.append(f"validation report unreadable JSON ({rp}): {exc}")

    tiles = manifest.get("tiles") or []
    if not tiles:
        errors.append("manifest contains zero tiles")
    for t in tiles:
        if t.get("skipped_empty_water"):
            continue
        rel = t.get("file")
        if not rel:
            errors.append(f"tile {t.get('tile_id')} has no STL file")
            continue
        sp = base_dir / str(rel)
        if not sp.is_file():
            errors.append(f"tile {t.get('tile_id')} file missing: {sp}")
            continue
        exp_sha = t.get("sha256")
        if not exp_sha:
            errors.append(f"tile {t.get('tile_id')} missing sha256 in manifest")
        else:
            act_sha = _sha256_file(sp)
            if act_sha != exp_sha:
                errors.append(f"tile {t.get('tile_id')} SHA-256 mismatch (expected {exp_sha}, got {act_sha})")

    if errors and not allow_draft:
        raise RuntimeError(
            "Refusing production Blender render for unvalidated or modified STL assembly "
            "(pass --draft-unvalidated to render marked draft previews):\n  - " + "\n  - ".join(errors)
        )
    return manifest, bool(errors)


def validate_render_source(
    assembly_manifest: Optional[str],
    stl_paths: Optional[Sequence[str]],
    draft_unvalidated: bool = False,
) -> Tuple[Optional[Dict[str, Any]], bool]:
    """Enforce manifest-locked validation for production renders; return (manifest_or_None, is_draft)."""
    if assembly_manifest:
        manifest, manifest_errors = verify_manifest_for_render(assembly_manifest, allow_draft=draft_unvalidated)
        return manifest, bool(manifest_errors or draft_unvalidated)
    if not stl_paths:
        raise ValueError("Either assembly_manifest (--manifest) or --stl path (with --draft-unvalidated) is required.")
    if not draft_unvalidated:
        raise RuntimeError(
            "Refusing production Blender render from raw --stl without a validated assembly_manifest.json "
            "(pass --manifest <path> for production or --draft-unvalidated for marked DRAFT_UNVALIDATED_ previews)."
        )
    return None, True


def load_from_manifest(
    manifest_path: str,
    frame_style: Optional[str] = None,
    material: Any = None,
    gallery_frame_gap_m: float = 0.018,
    continuous_flush: bool = False,
    allow_draft: bool = False,
    collection: Any = None,
) -> Dict[str, Any]:
    """Load tiles from assembly_manifest.json using exact nominal_rect_mm + un-rotation."""
    if bpy is None:
        raise RuntimeError("load_from_manifest must be run inside Blender.")
    manifest, is_draft = verify_manifest_for_render(manifest_path, allow_draft=allow_draft)
    m_path = Path(manifest_path).resolve()
    base_dir = m_path.parent
    fmt_id = str(manifest.get("format_id") or "custom_grid")
    frames = list(manifest.get("frames") or [])
    tiles = list(manifest.get("tiles") or [])
    if collection is None:
        collection = bpy.data.collections.new("CityModels")
        bpy.context.scene.collection.children.link(collection)

    # Compute per-frame display offsets when multi-frame lifestyle/gallery frame is shown
    frame_shift_mm: Dict[str, Tuple[float, float]] = {}
    frame_specs: List[Dict[str, Any]] = []
    n_frames = len(frames)
    if n_frames > 1 and not continuous_flush and frame_style != "none":
        from studio_blender.envs.frame_gallery import resolve_gallery_frame_dims_m

        outer_w_m, outer_h_m, _, _, _, _ = resolve_gallery_frame_dims_m(format_id=fmt_id)
        f_cols = max(f.get("frame_col", 0) for f in frames) + 1
        f_rows = max(f.get("frame_row", 0) for f in frames) + 1
        pitch_x_m = outer_w_m + max(0.0, float(gallery_frame_gap_m))
        pitch_y_m = outer_h_m + max(0.0, float(gallery_frame_gap_m))
        for fr in frames:
            fid = str(fr.get("frame_id", "F1"))
            fc = int(fr.get("frame_col", 0))
            fr_r = int(fr.get("frame_row", 0))
            target_cx_m = (fc - 0.5 * (f_cols - 1)) * pitch_x_m
            target_cy_m = (fr_r - 0.5 * (f_rows - 1)) * pitch_y_m
            win = fr.get("window_mm") or [120.0, 170.0]
            orig = fr.get("nominal_origin_mm") or [-0.5 * float(win[0]), -0.5 * float(win[1])]
            src_cx_mm = float(orig[0]) + 0.5 * float(win[0])
            src_cy_mm = float(orig[1]) + 0.5 * float(win[1])
            frame_shift_mm[fid] = (target_cx_m / MM_TO_M - src_cx_mm, target_cy_m / MM_TO_M - src_cy_mm)
            frame_specs.append({
                "frame_id": fid,
                "format_id": fmt_id,
                "opening_w_m": float(win[0]) * MM_TO_M,
                "opening_h_m": float(win[1]) * MM_TO_M,
                "center_xy": (target_cx_m, target_cy_m),
            })
    else:
        for fr in (frames or [{"frame_id": "F1", "window_mm": manifest.get("source_params", {}).get("window_mm", [120.0, 170.0]), "nominal_origin_mm": None}]):
            fid = str(fr.get("frame_id", "F1"))
            win = fr.get("window_mm") or [120.0, 170.0]
            orig = fr.get("nominal_origin_mm")
            cx_m = (float(orig[0]) + 0.5 * float(win[0])) * MM_TO_M if orig else 0.0
            cy_m = (float(orig[1]) + 0.5 * float(win[1])) * MM_TO_M if orig else 0.0
            frame_shift_mm[fid] = (0.0, 0.0)
            frame_specs.append({
                "frame_id": fid,
                "format_id": fmt_id,
                "opening_w_m": float(win[0]) * MM_TO_M,
                "opening_h_m": float(win[1]) * MM_TO_M,
                "center_xy": (cx_m, cy_m),
            })

    raw_objs: List[Any] = []
    tile_metas: List[Dict[str, Any]] = []
    for idx, t in enumerate(tiles):
        if t.get("skipped_empty_water") or not t.get("file"):
            continue
        sp = base_dir / str(t["file"])
        obj = _import_stl_raw(str(sp))
        obj.name = f"CityTile_{idx + 1:02d}_{t.get('tile_id', idx)}"
        for col in list(obj.users_collection):
            col.objects.unlink(obj)
        collection.objects.link(obj)
        mn, mx, sc = _measure_raw_mm(obj)
        rect = t["nominal_rect_mm"]
        h_mm = float(rect["y_max"]) - float(rect["y_min"])
        rot90 = (int(t.get("stl_rotation_deg", 0)) % 360) == 90
        fid = str(t.get("frame_id", "F1"))
        dx_mm, dy_mm = frame_shift_mm.get(fid, (0.0, 0.0))
        x_dst_mm = float(rect["x_min"]) + dx_mm
        y_dst_mm = float(rect["y_min"]) + dy_mm

        if rot90:
            # Inverse of stl_writer.js (outX = h_mm - yLocal, outY = xLocal) -> xLocal = outY, yLocal = h_mm - outX
            mat = (
                Matrix.Translation((x_dst_mm * MM_TO_M, (y_dst_mm + h_mm) * MM_TO_M, -mn[2] * MM_TO_M))
                @ Matrix.Rotation(-math.pi * 0.5, 4, "Z")
                @ Matrix.Scale(sc, 4)
            )
        else:
            mat = (
                Matrix.Translation((x_dst_mm * MM_TO_M, y_dst_mm * MM_TO_M, -mn[2] * MM_TO_M))
                @ Matrix.Scale(sc, 4)
            )
        obj.data.transform(mat)
        obj.matrix_world = Matrix.Identity(4)
        mesh = obj.data
        if len(mesh.polygons) > 0:
            mesh.polygons.foreach_set("use_smooth", [False] * len(mesh.polygons))
        mesh.update()
        if material is not None:
            if len(obj.data.materials) == 0:
                obj.data.materials.append(material)
            else:
                obj.data.materials[0] = material
        raw_objs.append(obj)
        cx_m = 0.5 * (float(rect["x_min"]) + float(rect["x_max"]) + 2.0 * dx_mm) * MM_TO_M
        cy_m = 0.5 * (float(rect["y_min"]) + float(rect["y_max"]) + 2.0 * dy_mm) * MM_TO_M
        tile_metas.append(_tile_meta(obj, str(sp), mn, mx, cx_m, cy_m, fit=1.0))

    if frame_specs:
        xs_c = [fs["center_xy"][0] for fs in frame_specs]
        ys_c = [fs["center_xy"][1] for fs in frame_specs]
        fw0 = frame_specs[0]["opening_w_m"]
        fh0 = frame_specs[0]["opening_h_m"]
        total_w_m = (max(xs_c) - min(xs_c)) + fw0
        total_h_m = (max(ys_c) - min(ys_c)) + fh0
    else:
        win = manifest.get("source_params", {}).get("window_mm", [120.0, 170.0])
        fw0, fh0 = float(win[0]) * MM_TO_M, float(win[1]) * MM_TO_M
        total_w_m, total_h_m = fw0, fh0

    analysis = analyze_city_mesh(raw_objs, frame_width_m=total_w_m, frame_height_m=total_h_m)
    return {
        "objects": raw_objs,
        "collection": collection,
        "tiles": tile_metas,
        "frame_centers_xy": [fs["center_xy"] for fs in frame_specs] or [(0.0, 0.0)],
        "offsets_x": [fs["center_xy"][0] for fs in frame_specs] or [0.0],
        "frame_specs": frame_specs,
        "format_id": fmt_id,
        "manifest": manifest,
        "manifest_path": str(m_path),
        "draft_unvalidated": is_draft,
        "tile_width_m": fw0,
        "tile_height_m": fh0,
        "total_width_m": total_w_m,
        "total_height_m": total_h_m,
        "max_z_m": analysis["max_z"],
        "analysis": analysis,
    }


def load_city_stls(
    stl_paths: Sequence[str], frame_style: str = "single_13x18", rim_width_mm: float = 4.0,
    frame_mm: Optional[str] = None, material: Any = None, tile_gap_m: float = 0.016, collection: Any = None,
) -> Dict[str, Any]:
    """Load 1-4 STL files, align into Variant C / A4 passe-partout / multi-frame, and analyze."""
    if not stl_paths:
        raise ValueError("At least one STL path must be provided.")
    if bpy is None:
        raise RuntimeError("load_city_stls must be run inside Blender.")
    frame_mm_override = parse_frame_mm(frame_mm) if isinstance(frame_mm, str) else frame_mm
    if collection is None:
        collection = bpy.data.collections.new("CityModels")
        bpy.context.scene.collection.children.link(collection)
    raw_objs: List[Any] = []
    raw_stats: List[RawStat] = []
    for idx, stl_path in enumerate(stl_paths):
        obj = _import_stl_raw(stl_path)
        obj.name = f"CityTile_{idx + 1:02d}"
        for col in list(obj.users_collection):
            col.objects.unlink(obj)
        collection.objects.link(obj)
        raw_objs.append(obj)
        raw_stats.append(_measure_raw_mm(obj))
    if frame_style == "a4_passepartout" or (frame_style == "none" and _is_a4_strip_set(raw_stats, stl_paths, frame_mm_override)):
        frame_w_m, frame_h_m, tile_metas = _align_a4_passepartout(raw_objs, raw_stats, stl_paths, frame_mm_override)
        frame_centers_xy, total_w_m, total_h_m = [(0.0, 0.0)], frame_w_m, frame_h_m
    elif frame_style in ("single_13x18", "none"):
        is_none = frame_style == "none"
        frame_w_m, frame_h_m, tile_metas = _align_single_13x18(
            raw_objs, raw_stats, stl_paths, 0.0 if is_none else rim_width_mm, frame_mm_override, tight_frameless=is_none
        )
        frame_centers_xy, total_w_m, total_h_m = [(0.0, 0.0)], frame_w_m, frame_h_m
    else:
        frame_w_m, frame_h_m, frame_centers_xy, tile_metas = _align_multi_or_tight(
            raw_objs, raw_stats, stl_paths, frame_style, rim_width_mm, frame_mm_override, tile_gap_m
        )
        xs, ys = [c[0] for c in frame_centers_xy], [c[1] for c in frame_centers_xy]
        total_w_m, total_h_m = (max(xs) - min(xs)) + frame_w_m, (max(ys) - min(ys)) + frame_h_m
    if material is not None:
        for obj in raw_objs:
            if len(obj.data.materials) == 0:
                obj.data.materials.append(material)
            else:
                obj.data.materials[0] = material
    analysis = analyze_city_mesh(raw_objs, frame_width_m=total_w_m, frame_height_m=total_h_m)
    return {
        "objects": raw_objs, "collection": collection, "tiles": tile_metas,
        "frame_centers_xy": frame_centers_xy, "offsets_x": [c[0] for c in frame_centers_xy],
        "tile_width_m": frame_w_m, "tile_height_m": frame_h_m,
        "total_width_m": total_w_m, "total_height_m": total_h_m,
        "max_z_m": analysis["max_z"], "analysis": analysis,
    }


__all__ = [
    "A4_OPENING_H_MM", "A4_OPENING_W_MM", "MM_TO_M",
    "VARIANT_C_OUTER_H_MM", "VARIANT_C_OUTER_W_MM",
    "analyze_city_mesh", "apply_draft_prefix", "infer_city_title", "load_city_stls",
    "load_from_manifest", "parse_frame_mm", "transform_analysis_to_wall_mount",
    "validate_render_source", "verify_manifest_for_render",
]
