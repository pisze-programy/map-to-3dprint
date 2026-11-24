"""Variant C ultra-thin matte-black 13x18 cm frame assembly and archival matte backing."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

import bmesh
import bpy
from mathutils import Euler, Vector

from .. import materials
from .common import (
    add_bevel,
    create_mesh_object,
    get_or_create_collection,
    make_box_bm,
)
from .frame_a4 import build_a4_passepartout_frame

# Default dimensions by frame style (mm -> meters inside build_frame_assembly)
_STYLE_DEFAULTS: Dict[str, Dict[str, float]] = {
    "single_13x18": {"rim_w_mm": 4.0, "frame_h_mm": 7.5, "top_z_mm": 3.4, "bevel_mm": 0.35},
    "single_thin": {"rim_w_mm": 4.0, "frame_h_mm": 7.5, "top_z_mm": 3.4, "bevel_mm": 0.35},
    "single_thick": {"rim_w_mm": 9.0, "frame_h_mm": 12.0, "top_z_mm": 4.2, "bevel_mm": 0.45},
    "cube_plinth": {"rim_w_mm": 5.0, "frame_h_mm": 8.5, "top_z_mm": 3.6, "bevel_mm": 0.35},
    "triptych_3x1": {"rim_w_mm": 4.0, "frame_h_mm": 7.5, "top_z_mm": 3.4, "bevel_mm": 0.35},
    "quartet_2x2": {"rim_w_mm": 4.0, "frame_h_mm": 7.5, "top_z_mm": 3.4, "bevel_mm": 0.35},
}


def _make_miter_rail_bm(inner_len: float, rim_w: float, bottom_z: float, top_z: float) -> Any:
    """Create a 45-degree mitered frame rail aligned along local +X."""
    half_in = inner_len * 0.5
    half_out = half_in + rim_w

    bm = bmesh.new()
    b0 = bm.verts.new((-half_in, 0.0, bottom_z))
    b1 = bm.verts.new((half_in, 0.0, bottom_z))
    b2 = bm.verts.new((half_out, rim_w, bottom_z))
    b3 = bm.verts.new((-half_out, rim_w, bottom_z))

    t0 = bm.verts.new((-half_in, 0.0, top_z))
    t1 = bm.verts.new((half_in, 0.0, top_z))
    t2 = bm.verts.new((half_out, rim_w, top_z))
    t3 = bm.verts.new((-half_out, rim_w, top_z))

    bm.faces.new((b3, b2, b1, b0))
    bm.faces.new((t0, t1, t2, t3))
    bm.faces.new((b0, b1, t1, t0))
    bm.faces.new((b2, b3, t3, t2))
    bm.faces.new((b1, b2, t2, t1))
    bm.faces.new((b3, b0, t0, t3))
    return bm


def _build_optional_nameplate(
    text_str: str,
    center_x: float,
    front_outer_y: float,
    bottom_z: float,
    top_z: float,
    frame_width_m: float,
    collection: Any,
    prefix: str,
) -> List[Any]:
    """Optional opt-in brushed silver nameplate (disabled by default)."""
    objects: List[Any] = []
    frame_h = top_z - bottom_z
    plate_h = min(0.0056, frame_h * 0.72)
    plate_z = 0.5 * (bottom_z + top_z)
    plate_thick = 0.0005

    raw_lines = [ln.strip() for ln in str(text_str).replace("|", "\n").splitlines() if ln.strip()]
    if not raw_lines:
        return objects
    max_chars = max(len(ln) for ln in raw_lines)
    plate_w = max(0.028, min(frame_width_m * 0.42, 0.012 + max_chars * 0.0020))

    mat_metal = materials.make_brushed_metal_material()
    mat_ink = materials.make_etched_ink_material()

    bm_p = make_box_bm(plate_w, plate_thick, plate_h, (center_x, front_outer_y - plate_thick * 0.5, plate_z))
    plaque = create_mesh_object(f"{prefix}_Nameplate", bm_p, collection, material=mat_metal, smooth=False)
    add_bevel(plaque, width=0.00014, segments=2)
    objects.append(plaque)

    font_curve = bpy.data.curves.new(name=f"{prefix}_NameplateText_Curve", type="FONT")
    font_curve.body = "\n".join(raw_lines)
    font_curve.align_x = "CENTER"
    font_curve.align_y = "CENTER"
    font_curve.extrude = 0.00007
    font_curve.bevel_depth = 0.000015
    size_by_h = (plate_h * 0.48) if len(raw_lines) == 1 else (plate_h * 0.30)
    size_by_w = (plate_w * 0.78) / max(1.0, max_chars * 0.62)
    font_curve.size = max(0.0012, min(size_by_h, size_by_w))
    font_curve.space_character = 1.12
    font_curve.materials.append(mat_ink)

    txt_obj = bpy.data.objects.new(f"{prefix}_NameplateText", font_curve)
    txt_obj.location = Vector((center_x, front_outer_y - plate_thick - 0.00005, plate_z))
    txt_obj.rotation_euler = Euler((math.pi * 0.5, 0.0, 0.0), "XYZ")
    collection.objects.link(txt_obj)
    objects.append(txt_obj)
    return objects


def _build_acrylic_cover(
    width_m: float,
    height_m: float,
    base_z: float,
    cover_top_z: float,
    center_xy: Tuple[float, float],
    collection: Any,
    prefix: str,
) -> Any:
    """Build crystal-clear 5-sided beveled museum acrylic display cover."""
    cx, cy = center_xy
    cov_w = width_m + 0.004
    cov_h = height_m + 0.004
    cov_z_span = max(0.06, cover_top_z - base_z)

    bm = bmesh.new()
    hw = cov_w * 0.5
    hh = cov_h * 0.5
    z0 = base_z
    z1 = base_z + cov_z_span

    v0 = bm.verts.new((cx - hw, cy - hh, z0))
    v1 = bm.verts.new((cx + hw, cy - hh, z0))
    v2 = bm.verts.new((cx + hw, cy + hh, z0))
    v3 = bm.verts.new((cx - hw, cy + hh, z0))
    v4 = bm.verts.new((cx - hw, cy - hh, z1))
    v5 = bm.verts.new((cx + hw, cy - hh, z1))
    v6 = bm.verts.new((cx + hw, cy + hh, z1))
    v7 = bm.verts.new((cx - hw, cy + hh, z1))

    bm.faces.new((v0, v1, v5, v4))
    bm.faces.new((v1, v2, v6, v5))
    bm.faces.new((v2, v3, v7, v6))
    bm.faces.new((v3, v0, v4, v7))
    bm.faces.new((v4, v5, v6, v7))

    mat_acrylic = materials.make_acrylic_cover_material()
    cover = create_mesh_object(f"{prefix}_AcrylicCover", bm, collection, material=mat_acrylic, smooth=False)
    sol = cover.modifiers.new(name="Solidify", type="SOLIDIFY")
    sol.thickness = 0.0022
    sol.offset = -1.0
    sol.use_even_offset = True
    add_bevel(cover, width=0.0004, segments=3)
    return cover


def build_frame_assembly(
    width_m: float,
    height_m: float,
    style: str = "single_13x18",
    rim_width_mm: Optional[float] = None,
    frame_height_mm: Optional[float] = None,
    rim_height_mm: Optional[float] = None,
    backing_finish: str = "matte_black",
    add_cover: bool = False,
    add_nameplate_text: Optional[str] = None,
    show_nameplate: bool = False,
    center_xy: Tuple[float, float] = (0.0, 0.0),
    offset_x: Optional[float] = None,
    max_z_m: float = 0.095,
    mount: str = "desk_flat",
    frame_material_style: str = "matte_black",
    passepartout_color: str = "white",
) -> Dict[str, Any]:
    """Build matte-black gallery frame + archival backing (supports Variant C 13x18 & A4 passe-partout)."""
    style_key = (style or "single_13x18").lower()
    if style_key == "a4_passepartout":
        return build_a4_passepartout_frame(
            width_m=width_m,
            height_m=height_m,
            passepartout_color=passepartout_color,
            center_xy=center_xy,
            offset_x=offset_x,
            mount=mount,
        )
    if style_key == "cube_cover":
        add_cover = True
        spec_key = "cube_plinth"
    elif style_key in _STYLE_DEFAULTS:
        spec_key = style_key
    else:
        spec_key = "single_13x18"

    spec = _STYLE_DEFAULTS[spec_key]
    eff_rim_w = float(rim_width_mm if rim_width_mm is not None else spec["rim_w_mm"]) * 0.001
    eff_frame_h_mm = rim_height_mm if rim_height_mm is not None else (
        frame_height_mm if frame_height_mm is not None else spec["frame_h_mm"]
    )
    eff_frame_h = max(0.0045, float(eff_frame_h_mm) * 0.001)
    top_z = min(eff_frame_h * 0.55, spec["top_z_mm"] * 0.001)
    bottom_z = top_z - eff_frame_h
    bevel_w = min(eff_rim_w * 0.14, spec["bevel_mm"] * 0.001)

    mount_key = (mount or "desk_flat").lower()
    feet_h = 0.0008 if mount_key != "wall_mount" else 0.0
    desk_z = bottom_z - feet_h
    wall_y = 0.0015

    cx = float(offset_x) if offset_x is not None else float(center_xy[0])
    cy = float(center_xy[1])
    outer_w = width_m + 2.0 * eff_rim_w
    outer_h = height_m + 2.0 * eff_rim_w

    col = get_or_create_collection("StudioFrame")
    tag = f"Frame_{int(round(cx * 1000))}_{int(round(cy * 1000))}"
    objects: List[Any] = []

    mat_frame = materials.make_black_frame_material(style=frame_material_style)
    mat_backing = materials.make_matte_black_backing_material(finish=backing_finish)
    mat_feet = materials.make_rubber_foot_material()

    # Tight 0.1 mm fit eliminates hairline gaps around the city footprint
    in_w = max(0.01, width_m - 0.0002)
    in_h = max(0.01, height_m - 0.0002)
    hx = in_w * 0.5
    hy = in_h * 0.5

    rail_configs = (
        ("Back", in_w, (cx, cy + hy, 0.0), (0.0, 0.0, 0.0)),
        ("Front", in_w, (cx, cy - hy, 0.0), (0.0, 0.0, math.pi)),
        ("Right", in_h, (cx + hx, cy, 0.0), (0.0, 0.0, -math.pi * 0.5)),
        ("Left", in_h, (cx - hx, cy, 0.0), (0.0, 0.0, math.pi * 0.5)),
    )
    for rname, rlen, rloc, rrot in rail_configs:
        bm_r = _make_miter_rail_bm(rlen, eff_rim_w, bottom_z, top_z)
        rail = create_mesh_object(f"{tag}_Rail_{rname}", bm_r, col, mat_frame, False, rloc, rrot)
        add_bevel(rail, width=bevel_w, segments=3)
        objects.append(rail)

    # Flush matte/satin black archival backing board at Z = -0.00005 m (zero mirror reflection)
    backing_top_z = -0.00005
    backing_thick = max(0.0018, backing_top_z - (bottom_z + 0.0002))
    bm_back = make_box_bm(
        width_m + 0.003,
        height_m + 0.003,
        backing_thick,
        (cx, cy, backing_top_z - backing_thick * 0.5),
    )
    back_board = create_mesh_object(f"{tag}_MatteBlackBacking", bm_back, col, mat_backing, False)
    objects.append(back_board)

    # Subtle recessed corner pads on desk_flat (cast clean hairline contact shadow; zero feet on wall_mount)
    if feet_h > 0.0:
        pad_sz = 0.008
        pad_inset = max(0.006, eff_rim_w + 0.004)
        fx = max(0.01, outer_w * 0.5 - pad_inset)
        fy = max(0.01, outer_h * 0.5 - pad_inset)
        for idx, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
            bm_f = make_box_bm(pad_sz, pad_sz, feet_h, (cx + sx * fx, cy + sy * fy, desk_z + feet_h * 0.5))
            foot = create_mesh_object(f"{tag}_Foot_{idx}", bm_f, col, mat_feet, False)
            objects.append(foot)

    # Nameplate strictly OPT-IN (never rendered by default)
    if show_nameplate and add_nameplate_text:
        objects.extend(
            _build_optional_nameplate(
                add_nameplate_text,
                center_x=cx,
                front_outer_y=cy - outer_h * 0.5,
                bottom_z=bottom_z,
                top_z=top_z,
                frame_width_m=width_m,
                collection=col,
                prefix=tag,
            )
        )

    cover_top_z: Optional[float] = None
    if add_cover:
        cover_top_z = max(float(max_z_m) + 0.024, 0.110)
        objects.append(
            _build_acrylic_cover(
                width_m=width_m,
                height_m=height_m,
                base_z=top_z - 0.0005,
                cover_top_z=cover_top_z,
                center_xy=(cx, cy),
                collection=col,
                prefix=tag,
            )
        )

    return {
        "collection": col,
        "objects": objects,
        "outer_width_m": outer_w,
        "outer_height_m": outer_h,
        "frame_top_z": top_z,
        "frame_bottom_z": bottom_z,
        "desk_z": desk_z,
        "wall_y": wall_y,
        "cover_top_z": cover_top_z,
        "center_xy": (cx, cy),
    }
