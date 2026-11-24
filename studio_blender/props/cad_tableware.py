"""CAD-precision tableware, books, crystal glassware, and leather journal props (meters)."""

from __future__ import annotations

import math
from typing import Any, List, Tuple

import bmesh
from mathutils import Vector

from .. import materials
from ..envs.common import (
    Vec3,
    add_bevel,
    add_subsurf,
    create_mesh_object,
    make_box_bm,
    make_lathe_bm,
    make_tube_bm,
    parent_objects_to_empty,
)


def build_espresso_cup(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Revolved stoneware porcelain espresso demitasse + saucer + hazelnut crema coffee."""
    mat_porc = materials.make_porcelain_material(name="EspressoPorcelain", color=(0.86, 0.83, 0.79, 1.0), roughness=0.22)
    mat_coffee = materials.make_espresso_crema_material()

    saucer_prof = [
        (0.028, 0.000),
        (0.031, 0.002),
        (0.048, 0.007),
        (0.057, 0.0125),
        (0.056, 0.014),
        (0.046, 0.009),
        (0.029, 0.0045),
        (0.025, 0.0038),
        (0.001, 0.0038),
    ]
    saucer = create_mesh_object("Prop_EspressoSaucer", make_lathe_bm(saucer_prof, 64, True, True), collection, mat_porc, True)

    cup_z = 0.004
    cup_prof = [
        (0.019, cup_z),
        (0.021, cup_z + 0.004),
        (0.026, cup_z + 0.016),
        (0.0295, cup_z + 0.036),
        (0.0305, cup_z + 0.053),
        (0.0292, cup_z + 0.0545),
        (0.0276, cup_z + 0.053),
        (0.0262, cup_z + 0.034),
        (0.0225, cup_z + 0.016),
        (0.016, cup_z + 0.006),
        (0.001, cup_z + 0.0055),
    ]
    cup = create_mesh_object("Prop_EspressoCup", make_lathe_bm(cup_prof, 64, True, True), collection, mat_porc, True)

    handle_pts = [
        Vector((0.027, 0.0, cup_z + 0.044)),
        Vector((0.036, 0.0, cup_z + 0.045)),
        Vector((0.044, 0.0, cup_z + 0.041)),
        Vector((0.046, 0.0, cup_z + 0.033)),
        Vector((0.043, 0.0, cup_z + 0.024)),
        Vector((0.035, 0.0, cup_z + 0.017)),
        Vector((0.024, 0.0, cup_z + 0.014)),
    ]
    handle = create_mesh_object("Prop_EspressoHandle", make_tube_bm(handle_pts, 0.0030, 16), collection, mat_porc, True)
    add_subsurf(handle, levels=2)

    liq_z = cup_z + 0.042
    liq_prof = [(0.001, liq_z - 0.003), (0.0270, liq_z - 0.003), (0.0271, liq_z + 0.0008), (0.024, liq_z), (0.001, liq_z)]
    liquid = create_mesh_object("Prop_EspressoLiquid", make_lathe_bm(liq_prof, 48, True, True), collection, mat_coffee, True)

    objs = [saucer, cup, handle, liquid]
    root = parent_objects_to_empty("Prop_espresso_cup_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def build_coffee_mug(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Minimalist matte speckled stoneware architect coffee mug (diam 78 mm, h 86 mm)."""
    mat_mug = materials.make_ceramic_vessel_material(name="ArchitectMugStoneware", color=(0.30, 0.27, 0.24, 1.0))
    mat_coffee = materials.make_espresso_crema_material()

    mug_prof = [
        (0.035, 0.000),
        (0.038, 0.003),
        (0.039, 0.012),
        (0.0395, 0.084),
        (0.0378, 0.086),
        (0.0360, 0.084),
        (0.0355, 0.012),
        (0.032, 0.008),
        (0.001, 0.0075),
    ]
    mug = create_mesh_object("Prop_CoffeeMug", make_lathe_bm(mug_prof, 64, True, True), collection, mat_mug, True)

    handle_pts = [
        Vector((0.037, 0.0, 0.069)),
        Vector((0.050, 0.0, 0.070)),
        Vector((0.059, 0.0, 0.062)),
        Vector((0.062, 0.0, 0.048)),
        Vector((0.059, 0.0, 0.033)),
        Vector((0.050, 0.0, 0.023)),
        Vector((0.037, 0.0, 0.021)),
    ]
    handle = create_mesh_object("Prop_CoffeeMugHandle", make_tube_bm(handle_pts, 0.0042, 16), collection, mat_mug, True)
    add_subsurf(handle, levels=2)

    liq_prof = [(0.001, 0.068), (0.0358, 0.068), (0.0358, 0.072), (0.001, 0.072)]
    liquid = create_mesh_object("Prop_CoffeeMugLiquid", make_lathe_bm(liq_prof, 48, True, True), collection, mat_coffee, True)

    objs = [mug, handle, liquid]
    root = parent_objects_to_empty("Prop_coffee_mug_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def build_glass_tumbler(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Thin-walled optical water tumbler (h 96 mm) half-filled with clear refractive water."""
    mat_glass = materials.make_clear_glass_material()
    mat_water = materials.make_water_liquid_material()

    outer_pts = [
        (0.025, 0.000),
        (0.028, 0.002),
        (0.0345, 0.014),
        (0.0385, 0.032),
        (0.0378, 0.054),
        (0.0350, 0.078),
        (0.0318, 0.0945),
        (0.0308, 0.096),
    ]
    inner_pts = [
        (0.0296, 0.0945),
        (0.0328, 0.078),
        (0.0356, 0.054),
        (0.0362, 0.032),
        (0.0318, 0.016),
        (0.0235, 0.009),
        (0.0008, 0.0085),
    ]
    glass = create_mesh_object("Prop_GlassTumbler", make_lathe_bm(outer_pts + inner_pts, 64, True, True), collection, mat_glass, True)

    ov = 0.00018
    wh = 0.044
    w_prof = [
        (0.0235 + ov, 0.009),
        (0.0318 + ov, 0.016),
        (0.0362 + ov, 0.032),
        (0.0359 + ov, wh + 0.0014),
        (0.0335, wh + 0.0002),
        (0.0180, wh),
        (0.0008, wh),
    ]
    water = create_mesh_object("Prop_GlassWater", make_lathe_bm(w_prof, 64, True, True), collection, mat_water, True)

    objs = [glass, water]
    root = parent_objects_to_empty("Prop_glass_tumbler_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def build_crystal_glass(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Heavy-base faceted cut-crystal lowball glass (h 88 mm) with warm amber spirit/tea."""
    mat_glass = materials.make_clear_glass_material(name="CutCrystalGlass")
    mat_amber = materials.make_amber_drink_material(name="AmberCrystalLiquid")

    outer_pts = [
        (0.034, 0.000),
        (0.036, 0.003),
        (0.037, 0.018),
        (0.038, 0.046),
        (0.039, 0.086),
        (0.0378, 0.088),
    ]
    inner_pts = [
        (0.0362, 0.0865),
        (0.0350, 0.052),
        (0.0338, 0.020),
        (0.0315, 0.016),
        (0.0008, 0.0155),
    ]
    # 14 crisp architectural crystal facets around the heavy base and body
    bm_glass = make_lathe_bm(outer_pts + inner_pts, segments=14, cap_bottom=True, cap_top=True)
    glass = create_mesh_object("Prop_CrystalLowball", bm_glass, collection, mat_glass, False)
    add_bevel(glass, width=0.0006, segments=2)

    ov = 0.00018
    wh = 0.046
    a_prof = [
        (0.0315 + ov, 0.016),
        (0.0338 + ov, 0.020),
        (0.0348 + ov, wh + 0.0012),
        (0.0320, wh + 0.0002),
        (0.0160, wh),
        (0.0008, wh),
    ]
    liquid = create_mesh_object("Prop_CrystalAmberLiquid", make_lathe_bm(a_prof, 48, True, True), collection, mat_amber, True)

    objs = [glass, liquid]
    root = parent_objects_to_empty("Prop_crystal_glass_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def _build_single_book_parts(
    prefix: str,
    bw: float,
    bd: float,
    bh: float,
    z0: float,
    mat_cover: Any,
    mat_deboss: Any,
    mat_pages: Any,
    collection: Any,
    yaw_rad: float = 0.0,
) -> List[Any]:
    """Create beveled hardcover monograph mesh group at vertical offset z0."""
    board_t = 0.0028
    overhang = 0.0032
    pages_h = bh - 2.0 * board_t

    bot = create_mesh_object(f"{prefix}_Bot", make_box_bm(bw, bd, board_t, (0.0, 0.0, z0 + board_t * 0.5)), collection, mat_cover, False)
    add_bevel(bot, width=0.0005, segments=2)

    top = create_mesh_object(f"{prefix}_Top", make_box_bm(bw, bd, board_t, (0.0, 0.0, z0 + bh - board_t * 0.5)), collection, mat_cover, False)
    add_bevel(top, width=0.0005, segments=2)

    spine_bm = make_box_bm(board_t * 1.6, bd, bh, (-bw * 0.5 + board_t * 0.65, 0.0, z0 + bh * 0.5))
    spine = create_mesh_object(f"{prefix}_Spine", spine_bm, collection, mat_cover, True)
    add_bevel(spine, width=0.0018, segments=4)

    pages = create_mesh_object(
        f"{prefix}_Pages",
        make_box_bm(bw - overhang * 2.0, bd - overhang * 2.0, pages_h, (overhang * 0.4, 0.0, z0 + board_t + pages_h * 0.5)),
        collection,
        mat_pages,
        False,
    )

    inset = create_mesh_object(
        f"{prefix}_Deboss",
        make_box_bm(bw * 0.56, bd * 0.42, 0.00035, (0.008, 0.020, z0 + bh + 0.00008)),
        collection,
        mat_deboss,
        False,
    )
    add_bevel(inset, width=0.00015, segments=2)

    parts = [bot, top, spine, pages, inset]
    if abs(yaw_rad) > 1e-5:
        for obj in parts:
            obj.rotation_euler = (0.0, 0.0, yaw_rad)
    return parts


def build_arch_book(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Tactile warm oatmeal-linen Phaidon/Taschen architectural monograph (185 x 235 x 25 mm)."""
    mat_cover = materials.make_book_cover_material(name="ArchMonographLinen", color=(0.64, 0.59, 0.52, 1.0))
    mat_deboss = materials.make_book_cover_material(name="ArchMonographDeboss", color=(0.54, 0.49, 0.43, 1.0))
    mat_pages = materials.make_book_pages_material()

    objs = _build_single_book_parts("Prop_Monograph", 0.185, 0.235, 0.025, 0.0, mat_cover, mat_deboss, mat_pages, collection)
    root = parent_objects_to_empty("Prop_arch_book_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def build_monograph_stack(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Two stacked linen hardcover coffee-table design monographs (warm sand + deep taupe)."""
    mat_bot = materials.make_book_cover_material(name="StackBookLinenSand", color=(0.74, 0.69, 0.61, 1.0))
    mat_bot_deb = materials.make_book_cover_material(name="StackBookSandDeboss", color=(0.64, 0.59, 0.51, 1.0))
    mat_top = materials.make_book_cover_material(name="StackBookLinenCharcoal", color=(0.30, 0.28, 0.26, 1.0))
    mat_top_deb = materials.make_book_cover_material(name="StackBookCharcoalDeboss", color=(0.24, 0.22, 0.20, 1.0))
    mat_pages = materials.make_book_pages_material()

    bot_objs = _build_single_book_parts("Prop_StackBot", 0.195, 0.245, 0.024, 0.0, mat_bot, mat_bot_deb, mat_pages, collection)
    top_objs = _build_single_book_parts(
        "Prop_StackTop",
        0.174,
        0.222,
        0.021,
        0.0242,
        mat_top,
        mat_top_deb,
        mat_pages,
        collection,
        yaw_rad=math.radians(4.5),
    )
    objs = bot_objs + top_objs
    root = parent_objects_to_empty("Prop_monograph_stack_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def build_leather_notebook(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Stitched espresso-cognac CC0 leather architect notebook (145 x 210 x 17 mm) with elastic strap."""
    mat_leather = materials.make_leather_notebook_material(name="JournalEspressoLeather")
    mat_pages = materials.make_book_pages_material(name="JournalCreamPages")
    mat_band = materials.make_matte_black_tech_material(name="JournalElasticBand")

    bw, bd, bh = 0.145, 0.210, 0.017
    board_t = 0.0022
    pages_h = bh - 2.0 * board_t

    bot = create_mesh_object("Prop_JournalBot", make_box_bm(bw, bd, board_t, (0.0, 0.0, board_t * 0.5)), collection, mat_leather, False)
    add_bevel(bot, width=0.0012, segments=3)

    top = create_mesh_object("Prop_JournalTop", make_box_bm(bw, bd, board_t, (0.0, 0.0, bh - board_t * 0.5)), collection, mat_leather, False)
    add_bevel(top, width=0.0012, segments=3)

    spine = create_mesh_object("Prop_JournalSpine", make_box_bm(board_t * 1.8, bd, bh, (-bw * 0.5 + board_t * 0.7, 0.0, bh * 0.5)), collection, mat_leather, True)
    add_bevel(spine, width=0.0018, segments=4)

    pages = create_mesh_object(
        "Prop_JournalPages",
        make_box_bm(bw - 0.005, bd - 0.005, pages_h, (0.0015, 0.0, board_t + pages_h * 0.5)),
        collection,
        mat_pages,
        False,
    )

    band = create_mesh_object(
        "Prop_JournalStrap",
        make_box_bm(0.0075, bd + 0.0014, bh + 0.0012, (bw * 0.34, 0.0, bh * 0.5)),
        collection,
        mat_band,
        False,
    )
    add_bevel(band, width=0.0004, segments=2)

    objs = [bot, top, spine, pages, band]
    root = parent_objects_to_empty("Prop_leather_notebook_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs
