"""Parametric passe-partout gallery frame builder driven by config/format_catalog.json."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..materials_city import (
    make_a4_gallery_frame_material,
    make_matte_black_paper_material,
    make_passepartout_material,
)
from .common import create_mesh_object, get_or_create_collection, make_box_bm
from .frame_a4 import (
    A4_BEVEL_M,
    A4_BOTTOM_Z_M,
    A4_MAT_BOTTOM_Z_M,
    A4_MAT_THICK_M,
    A4_RIM_W_M,
    A4_TOP_Z_M,
    _add_angle_bevel,
    _make_beveled_passepartout_bm,
    _make_hollow_gallery_frame_bm,
)

_CATALOG_PATH = Path(__file__).resolve().parent.parent.parent / "config" / "format_catalog.json"


def _load_catalog() -> Dict[str, Any]:
    if _CATALOG_PATH.is_file():
        return json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    return {"formats": {}}


def resolve_gallery_frame_dims_m(
    format_id: Optional[str] = None,
    opening_w_m: Optional[float] = None,
    opening_h_m: Optional[float] = None,
) -> Tuple[float, float, float, float, float, float]:
    """Return (outer_w_m, outer_h_m, cut_w_m, cut_h_m, rim_w_m, depth_m)."""
    cat = _load_catalog()
    fmt = cat.get("formats", {}).get(format_id or "", {})
    outer_mm = fmt.get("frame_outer_mm")
    win_mm = fmt.get("window_mm")
    f_cols = max(1, int(fmt.get("frame_cols", 1)))
    f_rows = max(1, int(fmt.get("frame_rows", 1)))

    if outer_mm and win_mm:
        cut_w_m = (float(win_mm[0]) / f_cols) * 0.001
        cut_h_m = (float(win_mm[1]) / f_rows) * 0.001
        outer_w_m = float(outer_mm[0]) * 0.001
        outer_h_m = float(outer_mm[1]) * 0.001
        rim_w_m = 0.018 if format_id == "flagship_50x70_3x9" else A4_RIM_W_M
        depth_m = 0.032 if format_id == "flagship_50x70_3x9" else 0.030
        return outer_w_m, outer_h_m, cut_w_m, cut_h_m, rim_w_m, depth_m

    cw = float(opening_w_m or 0.120)
    ch = float(opening_h_m or 0.170)
    if abs(cw - 0.170) < 0.004 and abs(ch - 0.120) < 0.004:
        return 0.297, 0.210, cw, ch, A4_RIM_W_M, 0.030
    if abs(cw - 0.120) < 0.004 and abs(ch - 0.170) < 0.004:
        return 0.210, 0.297, cw, ch, A4_RIM_W_M, 0.030
    margin = 0.045 if max(cw, ch) < 0.26 else 0.065
    return cw + 2.0 * margin, ch + 2.0 * margin, cw, ch, A4_RIM_W_M, 0.030


def build_gallery_frame(
    opening_w_m: float,
    opening_h_m: float,
    format_id: Optional[str] = None,
    center_xy: Tuple[float, float] = (0.0, 0.0),
    mount: str = "desk_flat",
    frame_label: Optional[str] = None,
) -> Dict[str, Any]:
    """Build parametric heavy matte-black gallery frame with 45-deg beveled white passe-partout."""
    outer_w, outer_h, cut_w, cut_h, rim_w, depth_m = resolve_gallery_frame_dims_m(
        format_id=format_id,
        opening_w_m=opening_w_m,
        opening_h_m=opening_h_m,
    )
    if opening_w_m > 0.01 and opening_h_m > 0.01:
        cut_w = min(outer_w - 2.0 * rim_w - 0.01, float(opening_w_m))
        cut_h = min(outer_h - 2.0 * rim_w - 0.01, float(opening_h_m))

    top_z = A4_TOP_Z_M
    bottom_z = top_z - depth_m
    inner_w = outer_w - 2.0 * rim_w
    inner_h = outer_h - 2.0 * rim_w
    cx, cy = float(center_xy[0]), float(center_xy[1])

    col = get_or_create_collection("StudioFrame")
    tag = frame_label or f"GalleryFrame_{int(round(cx * 1000))}_{int(round(cy * 1000))}"
    objects: List[Any] = []

    mat_frame = make_a4_gallery_frame_material()
    mat_top = make_passepartout_material(is_bevel_core=False)
    mat_core = make_passepartout_material(is_bevel_core=True)
    mat_paper = make_matte_black_paper_material()

    bm_frame = _make_hollow_gallery_frame_bm(
        outer_w=outer_w,
        outer_h=outer_h,
        inner_w=inner_w,
        inner_h=inner_h,
        bottom_z=bottom_z,
        top_z=top_z,
        center_xy=(cx, cy),
    )
    frame_obj = create_mesh_object(f"{tag}_GalleryFrame", bm_frame, col, material=mat_frame, smooth=False)
    _add_angle_bevel(frame_obj, width=A4_BEVEL_M, segments=3)
    objects.append(frame_obj)

    bm_mat = _make_beveled_passepartout_bm(
        outer_w=inner_w + 0.0006,
        outer_h=inner_h + 0.0006,
        cut_w=cut_w,
        cut_h=cut_h,
        bottom_z=A4_MAT_BOTTOM_Z_M,
        thickness=A4_MAT_THICK_M,
        center_xy=(cx, cy),
    )
    mat_obj = create_mesh_object(f"{tag}_PassePartout", bm_mat, col, material=mat_top, smooth=False)
    mat_obj.data.materials.append(mat_core)
    objects.append(mat_obj)

    backing_top_z = -0.00005
    backing_bot_z = bottom_z + 0.00010
    backing_thick = max(0.002, backing_top_z - backing_bot_z)
    bm_back = make_box_bm(
        inner_w + 0.0012,
        inner_h + 0.0012,
        backing_thick,
        (cx, cy, backing_top_z - backing_thick * 0.5),
    )
    back_obj = create_mesh_object(f"{tag}_MatteBlackPaper", bm_back, col, material=mat_paper, smooth=False)
    objects.append(back_obj)

    desk_z = bottom_z
    wall_y = abs(bottom_z) + 0.0015
    return {
        "collection": col,
        "objects": objects,
        "outer_width_m": outer_w,
        "outer_height_m": outer_h,
        "inner_aperture_w_m": inner_w,
        "inner_aperture_h_m": inner_h,
        "passepartout_opening_w_m": cut_w,
        "passepartout_opening_h_m": cut_h,
        "frame_top_z": top_z,
        "frame_bottom_z": bottom_z,
        "desk_z": desk_z,
        "wall_y": wall_y,
        "cover_top_z": None,
        "center_xy": (cx, cy),
        "mount": (mount or "desk_flat").lower(),
    }
