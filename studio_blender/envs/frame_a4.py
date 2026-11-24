"""Millimeter-exact heavy A4 (210x297x30mm) gallery frame with 45-deg beveled passe-partout."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

import bmesh

from ..materials_city import (
    make_a4_gallery_frame_material,
    make_matte_black_paper_material,
    make_passepartout_material,
)
from .common import (
    add_bevel,
    create_mesh_object,
    get_or_create_collection,
    make_box_bm,
)

# Exact physical gallery frame dimensions (meters)
A4_OUTER_W_M = 0.210
A4_OUTER_H_M = 0.297
A4_RIM_W_M = 0.015
A4_TOP_Z_M = 0.009
A4_BOTTOM_Z_M = -0.021
A4_MAT_BOTTOM_Z_M = 0.000
A4_MAT_THICK_M = 0.002
A4_MAT_TOP_Z_M = A4_MAT_BOTTOM_Z_M + A4_MAT_THICK_M
A4_OPENING_W_M = 0.120
A4_OPENING_H_M = 0.170
A4_BEVEL_M = 0.0005
A4_WALL_SHADOW_GAP_M = 0.0015


def _make_rect_ring(
    bm: Any,
    cx: float,
    cy: float,
    hx: float,
    hy: float,
    z: float,
) -> List[Any]:
    """Create 4 counter-clockwise rectangle vertices around (cx, cy) at height z."""
    return [
        bm.verts.new((cx - hx, cy - hy, z)),
        bm.verts.new((cx + hx, cy - hy, z)),
        bm.verts.new((cx + hx, cy + hy, z)),
        bm.verts.new((cx - hx, cy + hy, z)),
    ]


def _make_hollow_gallery_frame_bm(
    outer_w: float,
    outer_h: float,
    inner_w: float,
    inner_h: float,
    bottom_z: float,
    top_z: float,
    center_xy: Tuple[float, float],
) -> Any:
    """Create watertight 3D hollow rectangular gallery frame with 45-deg corner miter topology."""
    cx, cy = center_xy
    bm = bmesh.new()
    ob = _make_rect_ring(bm, cx, cy, outer_w * 0.5, outer_h * 0.5, bottom_z)
    ot = _make_rect_ring(bm, cx, cy, outer_w * 0.5, outer_h * 0.5, top_z)
    ib = _make_rect_ring(bm, cx, cy, inner_w * 0.5, inner_h * 0.5, bottom_z)
    it = _make_rect_ring(bm, cx, cy, inner_w * 0.5, inner_h * 0.5, top_z)

    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((ot[i], ot[j], it[j], it[i]))
        bm.faces.new((ob[j], ob[i], ib[i], ib[j]))
        bm.faces.new((ob[i], ob[j], ot[j], ot[i]))
        bm.faces.new((ib[j], ib[i], it[i], it[j]))

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def _make_beveled_passepartout_bm(
    outer_w: float,
    outer_h: float,
    cut_w: float,
    cut_h: float,
    bottom_z: float,
    thickness: float,
    center_xy: Tuple[float, float],
) -> Any:
    """Create 2mm cotton-rag passe-partout with exact 45-deg outward-flaring bevel (slot 1)."""
    cx, cy = center_xy
    ix0, iy0 = cut_w * 0.5, cut_h * 0.5
    # Exact 45-deg outward bevel flare (+thickness per side -> +4.0mm top opening width/height)
    ix1, iy1 = ix0 + thickness, iy0 + thickness
    z0, z1 = bottom_z, bottom_z + thickness

    bm = bmesh.new()
    ob = _make_rect_ring(bm, cx, cy, outer_w * 0.5, outer_h * 0.5, z0)
    ot = _make_rect_ring(bm, cx, cy, outer_w * 0.5, outer_h * 0.5, z1)
    ib = _make_rect_ring(bm, cx, cy, ix0, iy0, z0)
    it = _make_rect_ring(bm, cx, cy, ix1, iy1, z1)

    for i in range(4):
        j = (i + 1) % 4
        f_top = bm.faces.new((ot[i], ot[j], it[j], it[i]))
        f_top.material_index = 0

        # Classic 45-deg cut core bevel faces assigned to material slot 1 (PassePartoutBevelCore)
        f_bevel = bm.faces.new((it[i], it[j], ib[j], ib[i]))
        f_bevel.material_index = 1

        f_bot = bm.faces.new((ob[j], ob[i], ib[i], ib[j]))
        f_bot.material_index = 0

        f_out = bm.faces.new((ob[i], ob[j], ot[j], ot[i]))
        f_out.material_index = 0

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def _add_angle_bevel(obj: Any, width: float, segments: int = 3) -> None:
    """Apply crisp angle-limited bevel so 90-deg edges chamfer cleanly while flat miters stay crisp."""
    mod = add_bevel(obj, width=width, segments=segments)
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(30.0)


def build_a4_passepartout_frame(
    width_m: float,
    height_m: float,
    center_xy: Tuple[float, float] = (0.0, 0.0),
    offset_x: Optional[float] = None,
    mount: str = "desk_flat",
) -> Dict[str, Any]:
    """Build exact 210x297x30mm A4 gallery frame, classic white 45-deg passe-partout, and black paper.

    Auto-orients to landscape (297x210mm, 170x120mm opening) when a landscape single tile is passed.
    No glass, no nameplate, no stands. Supports desk_flat (desk_z=-0.021m) and wall_mount
    (wall_y=0.0225m after +90 deg X rotation).
    """
    is_landscape = float(width_m) > float(height_m) + 0.005
    outer_w = A4_OUTER_H_M if is_landscape else A4_OUTER_W_M
    outer_h = A4_OUTER_W_M if is_landscape else A4_OUTER_H_M
    cut_w = A4_OPENING_H_M if is_landscape else A4_OPENING_W_M
    cut_h = A4_OPENING_W_M if is_landscape else A4_OPENING_H_M

    inner_w = outer_w - 2.0 * A4_RIM_W_M
    inner_h = outer_h - 2.0 * A4_RIM_W_M
    cx = float(offset_x) if offset_x is not None else float(center_xy[0])
    cy = float(center_xy[1])

    col = get_or_create_collection("StudioFrame")
    tag = f"FrameA4_{int(round(cx * 1000))}_{int(round(cy * 1000))}"
    objects: List[Any] = []

    mat_frame = make_a4_gallery_frame_material()
    mat_top = make_passepartout_material(is_bevel_core=False)
    mat_core = make_passepartout_material(is_bevel_core=True)
    mat_paper = make_matte_black_paper_material()

    # 1. Heavy 30.0mm deep matte jet-black A4 gallery frame (Z = -21.0mm .. +9.0mm, 15.0mm rim)
    bm_frame = _make_hollow_gallery_frame_bm(
        outer_w=outer_w,
        outer_h=outer_h,
        inner_w=inner_w,
        inner_h=inner_h,
        bottom_z=A4_BOTTOM_Z_M,
        top_z=A4_TOP_Z_M,
        center_xy=(cx, cy),
    )
    frame_obj = create_mesh_object(f"{tag}_GalleryFrame", bm_frame, col, material=mat_frame, smooth=False)
    _add_angle_bevel(frame_obj, width=A4_BEVEL_M, segments=3)
    objects.append(frame_obj)

    # 2. 2.0mm cotton-rag passe-partout (Z = 0.0mm .. +2.0mm -> exact 7.0mm step below +9.0mm lip)
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

    # 3. Thick matte-black archival paper backing (Z = -0.05mm top down to closed -20.9mm back panel)
    backing_top_z = -0.00005
    backing_bot_z = A4_BOTTOM_Z_M + 0.00010
    backing_thick = backing_top_z - backing_bot_z
    bm_back = make_box_bm(
        inner_w + 0.0012,
        inner_h + 0.0012,
        backing_thick,
        (cx, cy, backing_top_z - backing_thick * 0.5),
    )
    back_obj = create_mesh_object(f"{tag}_MatteBlackPaper", bm_back, col, material=mat_paper, smooth=False)
    objects.append(back_obj)

    desk_z = A4_BOTTOM_Z_M
    wall_y = abs(A4_BOTTOM_Z_M) + A4_WALL_SHADOW_GAP_M

    return {
        "collection": col,
        "objects": objects,
        "outer_width_m": outer_w,
        "outer_height_m": outer_h,
        "inner_aperture_w_m": inner_w,
        "inner_aperture_h_m": inner_h,
        "passepartout_opening_w_m": cut_w,
        "passepartout_opening_h_m": cut_h,
        "passepartout_top_opening_w_m": cut_w + 2.0 * A4_MAT_THICK_M,
        "passepartout_top_opening_h_m": cut_h + 2.0 * A4_MAT_THICK_M,
        "passepartout_color": "white",
        "passepartout_top_z": A4_MAT_TOP_Z_M,
        "frame_top_z": A4_TOP_Z_M,
        "frame_bottom_z": A4_BOTTOM_Z_M,
        "desk_z": desk_z,
        "wall_y": wall_y,
        "cover_top_z": None,
        "center_xy": (cx, cy),
        "mount": (mount or "desk_flat").lower(),
        "orientation": "landscape" if is_landscape else "portrait",
    }
