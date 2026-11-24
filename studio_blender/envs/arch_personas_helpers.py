"""Shared 3D room backdrop helpers for Customer Persona scenes (skyline, windows, bookcases)."""

from __future__ import annotations

from typing import Any, List, Sequence, Tuple

import bmesh
from mathutils import Matrix, Vector

from .. import materials
from ..materials_personas import (
    make_leather_spine_material,
    make_polished_gold_material,
    make_sky_gradient_material,
    make_skyline_glass_material,
)
from .common import add_bevel, create_area_light, create_mesh_object


def box_mat(sx: float, sy: float, sz: float, center: Tuple[float, float, float]) -> Any:
    """Build translation-scale 4x4 matrix for bmesh cube creation."""
    return Matrix.Translation(Vector(center)) @ Matrix.Diagonal((sx, sy, sz, 1.0))


def build_metropolitan_skyline_backdrop(
    desk_z: float,
    collection: Any,
    golden_hour: bool = False,
    prefix: str = "MetroSkyline",
) -> List[Any]:
    """Build 3D sunlit metropolitan skyscrapers + sky gradient far outside studio windows."""
    objs: List[Any] = []
    if golden_hour:
        sky_mat = make_sky_gradient_material(f"{prefix}_GoldenSky", (0.98, 0.64, 0.32), (0.20, 0.32, 0.52), strength=1.75)
        g_warm = make_skyline_glass_material(f"{prefix}_TowerAmber", (0.36, 0.24, 0.16, 1.0), emit_strength=0.06)
        g_cool = make_skyline_glass_material(f"{prefix}_TowerSlate", (0.14, 0.18, 0.28, 1.0), emit_strength=0.03)
        g_pale = make_skyline_glass_material(f"{prefix}_TowerSun", (0.50, 0.35, 0.22, 1.0), emit_strength=0.08)
    else:
        sky_mat = make_sky_gradient_material(f"{prefix}_DaySky", (0.86, 0.89, 0.92), (0.38, 0.56, 0.78), strength=1.55)
        g_warm = make_skyline_glass_material(f"{prefix}_TowerStone", (0.28, 0.29, 0.31, 1.0), emit_strength=0.04)
        g_cool = make_skyline_glass_material(f"{prefix}_TowerGlass", (0.14, 0.23, 0.36, 1.0), emit_strength=0.05)
        g_pale = make_skyline_glass_material(f"{prefix}_TowerBright", (0.36, 0.44, 0.54, 1.0), emit_strength=0.06)

    palette = (g_cool, g_warm, g_pale)
    bm_sky = bmesh.new()
    bmesh.ops.create_cube(bm_sky, size=1.0, matrix=box_mat(10.0, 0.02, 5.4, (0.2, 5.80, desk_z + 1.50)))
    sky = create_mesh_object(f"{prefix}_SkyPane", bm_sky, collection, sky_mat, False)
    for attr in ("visible_diffuse", "visible_shadow"):
        if hasattr(sky, attr):
            setattr(sky, attr, False)
    objs.append(sky)

    # 15 staggered 3D skyscraper silhouettes across X in [-2.6, +2.8], Y in [2.6, 5.0]
    tower_specs = (
        (-2.35, 3.85, 0.42, 0.38, 2.20, 0), (-1.82, 4.35, 0.36, 0.34, 2.65, 1),
        (-1.32, 3.20, 0.44, 0.36, 2.05, 2), (-0.82, 4.60, 0.34, 0.32, 2.75, 0),
        (-0.34, 3.65, 0.42, 0.38, 2.35, 1), (0.14, 4.80, 0.38, 0.34, 3.10, 0),
        (0.58, 3.30, 0.46, 0.38, 2.45, 2), (1.06, 4.10, 0.38, 0.34, 2.95, 0),
        (1.52, 2.95, 0.48, 0.40, 2.15, 1), (1.96, 4.45, 0.40, 0.36, 2.85, 2),
        (2.48, 3.55, 0.46, 0.38, 2.40, 0), (-0.56, 2.75, 0.32, 0.28, 1.55, 2),
        (0.32, 2.85, 0.34, 0.30, 1.72, 1), (1.26, 2.70, 0.32, 0.28, 1.62, 0),
        (2.22, 2.90, 0.36, 0.30, 1.85, 1),
    )
    base_z = desk_z - 0.90
    for idx, (tx, ty, tw, td, th, midx) in enumerate(tower_specs):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0, matrix=box_mat(tw, td, th, (0.0, 0.0, th * 0.5)))
        bmesh.ops.create_cube(bm, size=1.0, matrix=box_mat(tw * 0.68, td * 0.68, th * 0.14, (0.0, 0.0, th + th * 0.07)))
        t_obj = create_mesh_object(f"{prefix}_Tower_{idx:02d}", bm, collection, palette[midx], False, location=(tx, ty, base_z))
        if hasattr(t_obj, "visible_shadow"):
            t_obj.visible_shadow = False
        objs.append(t_obj)

    sun_col = (1.0, 0.78, 0.52) if golden_hour else (1.0, 0.97, 0.92)
    sky_sun = create_area_light(
        name=f"Light_{prefix}_FacadeSun",
        collection=collection,
        location=(3.4, 2.2, desk_z + 2.8),
        target=(0.2, 3.8, desk_z + 0.8),
        energy=220.0 if golden_hour else 320.0,
        color=sun_col,
        size_x=2.2,
        size_y=2.2,
        spread_deg=85.0,
        visible_camera=False,
    )
    objs.append(sky_sun)
    return objs


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
