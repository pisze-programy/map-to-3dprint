"""Shared 3D room backdrop helpers for Customer Persona scenes (skyline, windows, bookcases)."""

from __future__ import annotations

from typing import Any, List, Sequence, Tuple

import bmesh
from mathutils import Matrix, Vector

from .. import assets_cc0, materials
from ..materials_core import add_mix_color, get_or_create_material
from ..materials_personas import (
    make_leather_spine_material,
    make_polished_gold_material,
    make_sky_gradient_material,
)
from .common import add_bevel, create_mesh_object


def box_mat(sx: float, sy: float, sz: float, center: Tuple[float, float, float]) -> Any:
    """Build translation-scale 4x4 matrix for bmesh cube creation."""
    return Matrix.Translation(Vector(center)) @ Matrix.Diagonal((sx, sy, sz, 1.0))


def _make_frosted_hdri_window_material(
    name: str,
    hdri_id: str,
    frost_rgb: Tuple[float, float, float],
    frost_mix: float = 0.62,
    strength: float = 1.45,
) -> Any:
    """Frosted/overcast architectural daylight glass blending real Poly Haven HDRI exterior glow."""
    hdri_path = assets_cc0.ensure_hdri(hdri_id, resolution="1k")
    if hdri_path is None:
        return make_sky_gradient_material(name, frost_rgb, (frost_rgb[0] * 0.88, frost_rgb[1] * 0.90, frost_rgb[2] * 0.94), strength=strength)

    mat, nt, _, out = get_or_create_material(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (-860, 0)
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.location = (-660, 0)
    mp.inputs["Rotation"].default_value = (0.0, 0.0, 0.45)
    nt.links.new(tc.outputs["Camera"], mp.inputs["Vector"])

    env_tex = nt.nodes.new("ShaderNodeTexEnvironment")
    env_tex.location = (-440, 80)
    env_tex.image = assets_cc0.load_image_cached(hdri_path, colorspace="Linear Rec.709")
    nt.links.new(mp.outputs["Vector"], env_tex.inputs["Vector"])

    # Softly desaturate and blend with bright frosted architectural daylight glass
    hsv = nt.nodes.new("ShaderNodeHueSaturation")
    hsv.location = (-200, 80)
    hsv.inputs["Saturation"].default_value = 0.22
    hsv.inputs["Value"].default_value = 0.65
    nt.links.new(env_tex.outputs["Color"], hsv.inputs["Color"])

    _, fac, col_a, col_b, col_out = add_mix_color(nt, "MIX", loc=(20, 80))
    fac.default_value = float(frost_mix)
    nt.links.new(hsv.outputs["Color"], col_a)
    col_b.default_value = (frost_rgb[0], frost_rgb[1], frost_rgb[2], 1.0)

    em = nt.nodes.new("ShaderNodeEmission")
    em.location = (240, 80)
    em.inputs["Strength"].default_value = float(strength)
    nt.links.new(col_out, em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return mat


def build_metropolitan_skyline_backdrop(
    desk_z: float,
    collection: Any,
    golden_hour: bool = False,
    prefix: str = "MetroSkyline",
) -> List[Any]:
    """Build natural frosted/overcast daylight window glass + real Poly Haven HDRI exterior glow."""
    if golden_hour:
        sky_mat = _make_frosted_hdri_window_material(
            f"{prefix}_WarmFrostedGlass",
            hdri_id="brown_photostudio_03",
            frost_rgb=(0.96, 0.85, 0.70),
            frost_mix=0.66,
            strength=1.55,
        )
    else:
        sky_mat = _make_frosted_hdri_window_material(
            f"{prefix}_OvercastFrostedGlass",
            hdri_id="photo_studio_loft_hall",
            frost_rgb=(0.91, 0.92, 0.92),
            frost_mix=0.68,
            strength=1.45,
        )

    bm_sky = bmesh.new()
    bmesh.ops.create_cube(bm_sky, size=1.0, matrix=box_mat(10.0, 0.02, 5.4, (0.2, 3.60, desk_z + 1.35)))
    sky = create_mesh_object(f"{prefix}_DaylightGlassPane", bm_sky, collection, sky_mat, False)
    for attr in ("visible_diffuse", "visible_shadow"):
        if hasattr(sky, attr):
            setattr(sky, attr, False)
    return [sky]


def build_window_mullions(
    prefix: str,
    win_y: float,
    x_positions: Sequence[float],
    z_positions: Sequence[float],
    collection: Any,
    m_thick: float = 0.022,
    m_depth: float = 0.045,
) -> List[Any]:
    """Create crisp dark-anodized architectural steel window mullions and transoms."""
    mat_steel = materials.make_matte_black_tech_material(f"{prefix}_MullionSteel")
    x0, x1 = min(x_positions), max(x_positions)
    z0, z1 = min(z_positions), max(z_positions)
    bm = bmesh.new()
    for mx in x_positions:
        bmesh.ops.create_cube(bm, size=1.0, matrix=box_mat(m_thick, m_depth, z1 - z0, (mx, win_y, 0.5 * (z0 + z1))))
    for mz in z_positions:
        bmesh.ops.create_cube(bm, size=1.0, matrix=box_mat(x1 - x0 + m_thick, m_depth, m_thick, (0.5 * (x0 + x1), win_y, mz)))
    obj = create_mesh_object(f"{prefix}_Mullions", bm, collection, mat_steel, False)
    add_bevel(obj, width=0.0014, segments=2)
    return [obj]


def _build_bookcase_shelf_books(
    prefix: str,
    x0: float,
    x1: float,
    shelf_y: float,
    shelf_z: float,
    collection: Any,
    seed: int = 1,
    gold_bands: bool = True,
) -> List[Any]:
    """Stock one built-in library shelf bay with varied leather & linen volumes (ZERO text)."""
    palette = (
        make_leather_spine_material("LibBookEspresso", (0.11, 0.062, 0.036)),
        make_leather_spine_material("LibBookOxblood", (0.15, 0.040, 0.032)),
        make_leather_spine_material("LibBookCharcoal", (0.065, 0.065, 0.068)),
        make_leather_spine_material("LibBookCognac", (0.22, 0.115, 0.052)),
        make_leather_spine_material("LibBookNavy", (0.042, 0.062, 0.105)),
        materials.make_book_cover_material("LibBookWarmTaupe", (0.42, 0.36, 0.30, 1.0)),
        materials.make_book_cover_material("LibBookDeepOlive", (0.085, 0.115, 0.082, 1.0)),
    )
    mat_gold = make_polished_gold_material("LibShelfGoldBand")

    objs: List[Any] = []
    bms = [bmesh.new() for _ in palette]
    bm_gold = bmesh.new()
    cur_x, idx = x0 + 0.012, 0
    while cur_x < x1 - 0.042:
        hv = (idx * 37 + seed * 19) % 100
        thick = 0.024 + (hv % 19) * 0.0011
        height = 0.195 + ((hv * 7) % 13) * 0.0052
        depth = 0.155 + ((hv * 3) % 7) * 0.0045
        pidx = (idx + seed * 3 + (hv % 5)) % len(palette)
        if cur_x + thick > x1 - 0.008:
            break
        cx = cur_x + thick * 0.5
        cy = shelf_y - depth * 0.5 + 0.004 * ((hv % 5) - 2)
        bmesh.ops.create_cube(bms[pidx], size=1.0, matrix=box_mat(thick - 0.0015, depth, height, (cx, cy, shelf_z + height * 0.5)))

        if gold_bands and pidx <= 4 and (idx % 2 == 0):
            front_y = cy - depth * 0.5 - 0.0008
            for bf in (0.18, 0.78, 0.83):
                bmesh.ops.create_cube(bm_gold, size=1.0, matrix=box_mat(thick - 0.0025, 0.003, 0.0034, (cx, front_y, shelf_z + height * bf)))
        cur_x += thick + 0.0016
        idx += 1

    for pidx, bm in enumerate(bms):
        if len(bm.verts) > 0:
            b_obj = create_mesh_object(f"{prefix}_Books_{pidx}", bm, collection, palette[pidx], False)
            add_bevel(b_obj, width=0.0016, segments=2)
            objs.append(b_obj)
        else:
            bm.free()

    if len(bm_gold.verts) > 0:
        objs.append(create_mesh_object(f"{prefix}_GoldBands", bm_gold, collection, mat_gold, False))
    else:
        bm_gold.free()
    return objs


def build_library_bookcase(
    prefix: str,
    desk_z: float,
    back_y: float,
    x_min: float,
    x_max: float,
    wood_mat: Any,
    collection: Any,
    bays: int = 4,
    gold_bands: bool = True,
) -> List[Any]:
    """Build multi-bay architectural dark wood library bookcase stocked with text-free books."""
    objs: List[Any] = []
    width = x_max - x_min
    cx_mid = 0.5 * (x_min + x_max)
    case_d = 0.25
    shelf_zs = (desk_z - 0.04, desk_z + 0.28, desk_z + 0.60, desk_z + 0.94, desk_z + 1.28)
    z_bot, z_top = shelf_zs[0] - 0.40, shelf_zs[-1] + 0.14

    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=box_mat(width, 0.03, z_top - z_bot, (cx_mid, back_y + 0.015, 0.5 * (z_bot + z_top))))
    for sz in shelf_zs:
        bmesh.ops.create_cube(bm, size=1.0, matrix=box_mat(width, case_d, 0.028, (cx_mid, back_y - case_d * 0.5, sz - 0.014)))
    bay_w = width / float(bays)
    for i in range(bays + 1):
        sx = x_min + i * bay_w
        bmesh.ops.create_cube(bm, size=1.0, matrix=box_mat(0.036, case_d + 0.010, z_top - z_bot, (sx, back_y - case_d * 0.5, 0.5 * (z_bot + z_top))))

    case = create_mesh_object(f"{prefix}_Carcass", bm, collection, wood_mat, False)
    add_bevel(case, width=0.0018, segments=2)
    objs.append(case)

    for row_idx, sz in enumerate(shelf_zs[:3]):
        for b_idx in range(bays):
            bx0 = x_min + b_idx * bay_w + 0.022
            bx1 = x_min + (b_idx + 1) * bay_w - 0.022
            objs.extend(
                _build_bookcase_shelf_books(
                    f"{prefix}_R{row_idx}B{b_idx}", bx0, bx1, back_y - 0.035, sz, collection,
                    seed=row_idx * 11 + b_idx * 5 + 3, gold_bands=gold_bands,
                )
            )
    return objs
