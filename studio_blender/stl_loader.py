"""Universal STL loader for Variant C 13x18, A4 passe-partout, and multi-tile frames."""

from __future__ import annotations

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

from studio_blender.landmark_analyzer import (
    analyze_city_mesh,
    get_mesh_coords_array,
    transform_analysis_to_wall_mount,
)


MM_TO_M = 0.001
VARIANT_C_OUTER_W_MM = 130.0
VARIANT_C_OUTER_H_MM = 180.0
A4_OPENING_W_MM = 120.0
A4_OPENING_H_MM = 170.0
_FRAME_MM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*(?:mm)?")


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
        tri_count = struct.unpack("<I", count_bytes)[0]
        raw = f.read()

    expected_size = tri_count * 50
    if len(raw) < expected_size:
        raise ValueError(
            f"STL '{abs_path}' is not a valid binary STL (expected {expected_size} bytes, got {len(raw)})."
        )

    verts: List[Tuple[float, float, float]] = []
    faces: List[Tuple[int, int, int]] = []
    for i in range(tri_count):
        v = struct.unpack_from("<9f", raw, i * 50 + 12)
        base = i * 3
        verts.extend(((v[0], v[1], v[2]), (v[3], v[4], v[5]), (v[6], v[7], v[8])))
        faces.append((base, base + 1, base + 2))

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

    existing = set(bpy.data.objects)
    imported_ok = False

    if hasattr(bpy.ops, "wm") and hasattr(bpy.ops.wm, "stl_import"):
        try:
            op = bpy.ops.wm.stl_import
            props = op.get_rna_type().properties
            kwargs: Dict[str, Any] = {"filepath": abs_path}
            if "global_scale" in props:
                kwargs["global_scale"] = 1.0
            if "use_scene_unit" in props:
                kwargs["use_scene_unit"] = False
            if "FINISHED" in op(**kwargs):
                imported_ok = True
        except Exception:
            imported_ok = False

    if not imported_ok:
        try:
            op_leg = bpy.ops.import_mesh.stl
            op_leg.get_rna_type()
            if "FINISHED" in op_leg(filepath=abs_path, global_scale=1.0):
                imported_ok = True
        except Exception:
            imported_ok = False

    new_objs = [o for o in bpy.data.objects if o not in existing and o.type == "MESH"]
    if imported_ok and new_objs:
        return new_objs[0]

    return _import_binary_stl_fallback(abs_path)


def _measure_raw_mm(obj: Any) -> Tuple[Tuple[float, float, float], Tuple[float, float, float], float]:
    """Bake object world transform and return (min_mm, max_mm, scale_to_m)."""
    if obj.matrix_world != Matrix.Identity(4):
        obj.data.transform(obj.matrix_world)
        obj.matrix_world = Matrix.Identity(4)

    pts = get_mesh_coords_array(obj)
    if np is not None:
        rmin = pts.min(axis=0)
        rmax = pts.max(axis=0)
    else:  # pragma: no cover
        rmin = (min(p[0] for p in pts), min(p[1] for p in pts), min(p[2] for p in pts))
        rmax = (max(p[0] for p in pts), max(p[1] for p in pts), max(p[2] for p in pts))

    span_xy = max(float(rmax[0] - rmin[0]), float(rmax[1] - rmin[1]))
    scale_to_m = MM_TO_M if span_xy > 1.5 else 1.0
    to_mm = 1.0 if scale_to_m == MM_TO_M else 1000.0
    min_mm = (float(rmin[0]) * to_mm, float(rmin[1]) * to_mm, float(rmin[2]) * to_mm)
    max_mm = (float(rmax[0]) * to_mm, float(rmax[1]) * to_mm, float(rmax[2]) * to_mm)
    return min_mm, max_mm, scale_to_m


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


def _align_single_13x18(
    raw_objs: List[Any],
    raw_stats: List[Tuple[Tuple[float, float, float], Tuple[float, float, float], float]],
    stl_paths: Sequence[str],
    rim_width_mm: float,
    frame_mm_override: Optional[Tuple[float, float]],
    tight_frameless: bool = False,
) -> Tuple[float, float, List[Dict[str, Any]]]:
    """Assemble 1 or 2 tiles inside a Variant C 130x180mm opening or tight frameless bbox."""
    inner_w_portrait = VARIANT_C_OUTER_W_MM - 2.0 * rim_width_mm
    inner_h_portrait = VARIANT_C_OUTER_H_MM - 2.0 * rim_width_mm
    n_tiles = len(raw_objs)
    tile_metas: List[Dict[str, Any]] = []

    if n_tiles >= 2:
        # Seamless vertical 2-tile stack: tile 0 = North/Top (+Y), tile 1 = South/Bottom (0)
        y_spans = [max(1.0, st[1][1] - st[0][1]) for st in raw_stats]
        min_x_all, max_x_all = min(st[0][0] for st in raw_stats), max(st[1][0] for st in raw_stats)
        span_x, total_y = max_x_all - min_x_all, sum(y_spans)

        if frame_mm_override is not None:
            inner_w_mm, inner_h_mm = frame_mm_override
        elif tight_frameless:
            inner_w_mm, inner_h_mm = span_x, total_y
        else:
            inner_w_mm, inner_h_mm = max(inner_w_portrait, span_x), total_y

        # Align East (+X) flush to +0.5*inner_w_mm (exact symmetric center when inner_w_mm == span_x)
        shift_x_mm = 0.5 * inner_w_mm - max_x_all
        y_cursor = 0.5 * total_y
        for idx, (obj, (mn, mx, sc), sp) in enumerate(zip(raw_objs, raw_stats, stl_paths)):
            tile_h = y_spans[idx]
            y_bot_target = y_cursor - tile_h
            _apply_mesh_transform(obj, (shift_x_mm, y_bot_target - mn[1], -mn[2]), sc)
            y_cursor -= tile_h
            tile_metas.append({
                "object": obj, "stl_path": str(Path(sp).resolve()),
                "mesh_size_m": [(mx[0] - mn[0]) * MM_TO_M, tile_h * MM_TO_M, (mx[2] - mn[2]) * MM_TO_M],
                "offset_x_m": 0.0, "offset_y_m": (y_bot_target + 0.5 * tile_h) * MM_TO_M,
            })
        return inner_w_mm * MM_TO_M, inner_h_mm * MM_TO_M, tile_metas

    mn, mx, sc = raw_stats[0]
    size_x, size_y, size_z = mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]
    nom_mm = _infer_frame_mm_from_filename(stl_paths[0])
    nom_w = nom_mm[0] if nom_mm else max(mx[0], size_x)
    nom_h = nom_mm[1] if nom_mm else max(mx[1], size_y)

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
        in_nom_x = (mn[0] >= -2.0) and (mx[0] <= nom_w + 2.0)
        in_nom_y = (mn[1] >= -2.0) and (mx[1] <= nom_h + 2.0)
        shift_x_mm = -0.5 * nom_w if in_nom_x else -0.5 * (mn[0] + mx[0])
        shift_y_mm = -0.5 * nom_h if in_nom_y else -0.5 * (mn[1] + mx[1])
    _apply_mesh_transform(raw_objs[0], (shift_x_mm, shift_y_mm, -mn[2]), sc)

    tile_metas.append({
        "object": raw_objs[0], "stl_path": str(Path(stl_paths[0]).resolve()),
        "mesh_size_m": [size_x * MM_TO_M, size_y * MM_TO_M, size_z * MM_TO_M],
        "offset_x_m": 0.0, "offset_y_m": 0.0,
    })
    return inner_w_mm * MM_TO_M, inner_h_mm * MM_TO_M, tile_metas


def _align_a4_passepartout(
    raw_objs: List[Any],
    raw_stats: List[Tuple[Tuple[float, float, float], Tuple[float, float, float], float]],
    stl_paths: Sequence[str],
    frame_mm_override: Optional[Tuple[float, float]],
) -> Tuple[float, float, List[Dict[str, Any]]]:
    """Fit 1-2 tiles flush at 1:1 scale inside the A4 120x170mm white passe-partout cutout."""
    n_tiles = len(raw_objs)
    tile_metas: List[Dict[str, Any]] = []
    if n_tiles >= 2:
        op_w, op_h = frame_mm_override if frame_mm_override else (A4_OPENING_W_MM, A4_OPENING_H_MM)
        y_spans = [max(1.0, st[1][1] - st[0][1]) for st in raw_stats]
        min_x_all, max_x_all = min(st[0][0] for st in raw_stats), max(st[1][0] for st in raw_stats)
        span_x, total_y = max_x_all - min_x_all, sum(y_spans)
        # Keep exact 1.0x physical scale for native 120x85mm tiles; scale down only if oversized
        fit = 1.0 if (span_x <= op_w + 0.25 and total_y <= op_h + 0.25) else min(1.0, op_w / max(span_x, 1.0), op_h / max(total_y, 1.0))
        # Flush East (+X), North (+Y), and South (-Y) against 120x170mm cutout; West shows water
        shift_x, y_cursor = 0.5 * op_w - max_x_all * fit, 0.5 * total_y * fit
        for idx, (obj, (mn, mx, sc), sp) in enumerate(zip(raw_objs, raw_stats, stl_paths)):
            th = y_spans[idx] * fit
            y_bot = y_cursor - th
            _apply_mesh_transform(obj, (shift_x, y_bot - mn[1] * fit, -mn[2] * fit), sc * fit)
            y_cursor -= th
            tile_metas.append({
                "object": obj, "stl_path": str(Path(sp).resolve()),
                "mesh_size_m": [(mx[0] - mn[0]) * fit * MM_TO_M, th * MM_TO_M, (mx[2] - mn[2]) * fit * MM_TO_M],
                "offset_x_m": 0.0, "offset_y_m": (y_bot + 0.5 * th) * MM_TO_M, "fit_scale": round(fit, 5),
            })
        return op_w * MM_TO_M, op_h * MM_TO_M, tile_metas

    mn, mx, sc = raw_stats[0]
    sx, sy, sz = mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]
    op_w, op_h = frame_mm_override if frame_mm_override else ((A4_OPENING_H_MM, A4_OPENING_W_MM) if sx > sy * 1.05 else (A4_OPENING_W_MM, A4_OPENING_H_MM))
    fit = 1.0 if (sx <= op_w + 0.25 and sy <= op_h + 0.25) else min(1.0, op_w / max(sx, 1.0), op_h / max(sy, 1.0))
    _apply_mesh_transform(raw_objs[0], (-0.5 * (mn[0] + mx[0]) * fit, -0.5 * (mn[1] + mx[1]) * fit, -mn[2] * fit), sc * fit)
    tile_metas.append({
        "object": raw_objs[0], "stl_path": str(Path(stl_paths[0]).resolve()),
        "mesh_size_m": [sx * fit * MM_TO_M, sy * fit * MM_TO_M, sz * fit * MM_TO_M],
        "offset_x_m": 0.0, "offset_y_m": 0.0, "fit_scale": round(fit, 5),
    })
    return op_w * MM_TO_M, op_h * MM_TO_M, tile_metas


def _align_multi_or_tight(
    raw_objs: List[Any],
    raw_stats: List[Tuple[Tuple[float, float, float], Tuple[float, float, float], float]],
    stl_paths: Sequence[str],
    frame_style: str,
    rim_width_mm: float,
    frame_mm_override: Optional[Tuple[float, float]],
    tile_gap_m: float,
) -> Tuple[float, float, List[Tuple[float, float]], List[Dict[str, Any]]]:
    """Align single tight frame, triptych_3x1 (1x3), or quartet_2x2 (2x2)."""
    n_tiles = len(raw_objs)
    tile_dims_mm: List[Tuple[float, float]] = []
    for (mn, mx, _), sp in zip(raw_stats, stl_paths):
        sx, sy = mx[0] - mn[0], mx[1] - mn[1]
        fm = frame_mm_override or _infer_frame_mm_from_filename(sp)
        if fm is None:
            fm = (max(mx[0], sx), max(mx[1], sy)) if (mn[0] >= -1.0 and mn[1] >= -1.0) else (sx, sy)
        tile_dims_mm.append((max(fm[0], sx), max(fm[1], sy)))

    tile_w_m = max(d[0] for d in tile_dims_mm) * MM_TO_M
    tile_h_m = max(d[1] for d in tile_dims_mm) * MM_TO_M
    border_m = 2.0 * rim_width_mm * MM_TO_M
    pitch_x, pitch_y = tile_w_m + border_m + tile_gap_m, tile_h_m + border_m + tile_gap_m

    if frame_style == "quartet_2x2" and n_tiles >= 4:
        centers_xy = [(-0.5 * pitch_x, 0.5 * pitch_y), (0.5 * pitch_x, 0.5 * pitch_y), (-0.5 * pitch_x, -0.5 * pitch_y), (0.5 * pitch_x, -0.5 * pitch_y)][:n_tiles]
    elif n_tiles == 1:
        centers_xy = [(0.0, 0.0)]
    else:
        start_x = -0.5 * (n_tiles - 1) * pitch_x
        centers_xy = [(start_x + i * pitch_x, 0.0) for i in range(n_tiles)]

    tile_metas: List[Dict[str, Any]] = []
    for obj, (mn, mx, sc), sp, (fw_mm, fh_mm), (cx, cy) in zip(raw_objs, raw_stats, stl_paths, tile_dims_mm, centers_xy):
        in_x = (mn[0] >= -2.0) and (mx[0] <= fw_mm + 2.0)
        in_y = (mn[1] >= -2.0) and (mx[1] <= fh_mm + 2.0)
        sx_mm = (-0.5 * fw_mm if in_x else -0.5 * (mn[0] + mx[0])) + cx / MM_TO_M
        sy_mm = (-0.5 * fh_mm if in_y else -0.5 * (mn[1] + mx[1])) + cy / MM_TO_M
        _apply_mesh_transform(obj, (sx_mm, sy_mm, -mn[2]), sc)
        tile_metas.append({
            "object": obj, "stl_path": str(Path(sp).resolve()),
            "mesh_size_m": [(mx[0] - mn[0]) * MM_TO_M, (mx[1] - mn[1]) * MM_TO_M, (mx[2] - mn[2]) * MM_TO_M],
            "offset_x_m": cx, "offset_y_m": cy,
        })
    return tile_w_m, tile_h_m, centers_xy, tile_metas


def load_city_stls(
    stl_paths: Sequence[str],
    frame_style: str = "single_13x18",
    rim_width_mm: float = 4.0,
    frame_mm: Optional[str] = None,
    material: Any = None,
    tile_gap_m: float = 0.016,
    collection: Any = None,
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
    raw_stats: List[Tuple[Tuple[float, float, float], Tuple[float, float, float], float]] = []
    for idx, stl_path in enumerate(stl_paths):
        obj = _import_stl_raw(stl_path)
        obj.name = f"CityTile_{idx + 1:02d}"
        for col in list(obj.users_collection):
            col.objects.unlink(obj)
        collection.objects.link(obj)
        raw_objs.append(obj)
        raw_stats.append(_measure_raw_mm(obj))

    if frame_style in ("single_13x18", "none"):
        is_none = frame_style == "none"
        frame_w_m, frame_h_m, tile_metas = _align_single_13x18(
            raw_objs, raw_stats, stl_paths, 0.0 if is_none else rim_width_mm, frame_mm_override, tight_frameless=is_none
        )
        frame_centers_xy, total_w_m, total_h_m = [(0.0, 0.0)], frame_w_m, frame_h_m
    elif frame_style == "a4_passepartout":
        frame_w_m, frame_h_m, tile_metas = _align_a4_passepartout(raw_objs, raw_stats, stl_paths, frame_mm_override)
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
    "analyze_city_mesh", "infer_city_title", "load_city_stls",
    "parse_frame_mm", "transform_analysis_to_wall_mount",
]
