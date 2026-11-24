"""CAD/CC0 props for Corporate (15), Real Estate (16), Study (17) + persona prop catalog."""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Optional, Tuple

import bmesh
import bpy
from mathutils import Vector

from .. import assets_cc0, materials
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
from ..materials_personas import (
    make_calacatta_marble_material,
    make_matte_jet_ceramic_material,
)
from .persona_props import (
    build_basswood_maquette,
    build_brass_tabletop_globe,
    build_concrete_pencil_cup,
    build_drafting_vellum_rolls,
    build_travel_monograph_stack,
    build_vintage_camera,
    build_vintage_compass,
)
from .persona_props_exec import (
    build_brass_arch_print_frame,
    build_brass_dome_lamp,
    build_gold_fountain_pen,
    build_law_volumes_row,
    build_leather_desk_folio,
)


def _import_single_foliage_cluster(
    asset_id: str,
    keep_substring: str,
    target_height_m: float,
    collection: Any,
    name_prefix: str,
) -> Tuple[Optional[Any], List[Any]]:
    """Import a Poly Haven multi-plant glTF and isolate one centered lush botanical cluster."""
    gltf_path = assets_cc0.ensure_gltf_model(asset_id, resolution="1k")
    if gltf_path is None:
        return None, []
    root, meshes = assets_cc0.import_external_prop(
        filepath=gltf_path,
        collection=collection,
        name_prefix=name_prefix,
        target_height_m=None,
        scale_factor=1.0,
    )
    if root is None or not meshes:
        return None, []

    chosen = [m for m in meshes if keep_substring.lower() in m.name.lower()]
    if not chosen:
        # Pick the second mesh (usually the centered _b variant) or first
        chosen = [meshes[min(1, len(meshes) - 1)]]

    keep_set = set(chosen)
    for mobj in list(meshes):
        if mobj not in keep_set:
            bpy.data.objects.remove(mobj, do_unlink=True)

    bpy.context.view_layer.update()
    pts = [m.matrix_world @ Vector(c) for m in chosen for c in m.bound_box]
    min_x, max_x = min(p.x for p in pts), max(p.x for p in pts)
    min_y, max_y = min(p.y for p in pts), max(p.y for p in pts)
    min_z, max_z = min(p.z for p in pts), max(p.z for p in pts)
    cur_h = max(1e-4, max_z - min_z)
    scale_f = target_height_m / cur_h
    cx, cy = 0.5 * (min_x + max_x), 0.5 * (min_y + max_y)

    for mobj in chosen:
        mobj.location = (mobj.location.x - cx, mobj.location.y - cy, mobj.location.z - min_z)
    root.scale = (scale_f, scale_f, scale_f)
    return root, chosen


def build_matte_black_mug(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Unbranded matte jet-black architectural ceramic coffee mug (ZERO logos/icons)."""
    mat_ext = make_matte_jet_ceramic_material("CorporateMatteBlackMugExt")
    mat_rim = materials.make_porcelain_material("CorporateMugCreamRim", color=(0.86, 0.83, 0.78, 1.0), roughness=0.22)
    mat_coffee = materials.make_espresso_crema_material("CorporateBlackCoffee")

    outer_prof = [
        (0.036, 0.000), (0.039, 0.003), (0.0405, 0.012),
        (0.0410, 0.089), (0.0398, 0.091), (0.0382, 0.091),
    ]
    mug = create_mesh_object("Prop_JetBlackMug", make_lathe_bm(outer_prof, 64, True, False), collection, mat_ext, True)

    inner_prof = [
        (0.0392, 0.0912), (0.0372, 0.0895), (0.0365, 0.012),
        (0.032, 0.008), (0.001, 0.0075),
    ]
    liner = create_mesh_object("Prop_JetBlackMugLiner", make_lathe_bm(inner_prof, 64, False, True), collection, mat_rim, True)

    handle_pts = [
        Vector((0.039, 0.0, 0.072)), Vector((0.052, 0.0, 0.073)), Vector((0.061, 0.0, 0.064)),
        Vector((0.064, 0.0, 0.049)), Vector((0.060, 0.0, 0.034)), Vector((0.051, 0.0, 0.024)),
        Vector((0.039, 0.0, 0.022)),
    ]
    handle = create_mesh_object("Prop_JetBlackMugHandle", make_tube_bm(handle_pts, 0.0040, 16), collection, mat_ext, True)
    add_subsurf(handle, levels=2)

    liq_prof = [(0.001, 0.070), (0.0365, 0.070), (0.0365, 0.075), (0.001, 0.075)]
    coffee = create_mesh_object("Prop_JetBlackMugCoffee", make_lathe_bm(liq_prof, 48, True, True), collection, mat_coffee, True)

    objs = [mug, liner, handle, coffee]
    root = parent_objects_to_empty("Prop_matte_black_mug_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def build_concrete_planter_plant(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Minimalist architectural honed-concrete cube planter with real CC0 lush green foliage."""
    mat_pot = materials.make_surface_material("honed_concrete_pot", name="CorpConcreteCubePlanter")
    mat_soil = materials.make_ceramic_vessel_material("PlanterDarkSoil", color=(0.055, 0.042, 0.032, 1.0))

    pw, ph = 0.118, 0.106
    pot = create_mesh_object("Prop_ConcreteCubePot", make_box_bm(pw, pw, ph, (0.0, 0.0, ph * 0.5)), collection, mat_pot, False)
    add_bevel(pot, width=0.0032, segments=3)
    soil = create_mesh_object("Prop_ConcretePotSoil", make_box_bm(pw - 0.014, pw - 0.014, 0.012, (0.0, 0.0, ph - 0.008)), collection, mat_soil, False)

    fol_root, fol_meshes = _import_single_foliage_cluster("anthurium_botany_01", "_b", 0.185, collection, "Prop_CorpPlantFoliage")
    objs: List[Any] = [pot, soil]
    if fol_root is not None:
        fol_root.location = Vector((0.0, 0.0, ph - 0.014))
        objs.append(fol_root)
    else:
        # Offline graceful fallback to cached potted_plant_02
        fb = assets_cc0.ensure_gltf_model("potted_plant_02", resolution="1k")
        if fb is not None:
            fr, _ = assets_cc0.import_external_prop(fb, collection, "Prop_CorpPlantFallback", 0.250, 1.0)
            if fr is not None:
                objs.append(fr)

    root = parent_objects_to_empty("Prop_concrete_planter_plant_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs + fol_meshes


def _make_fluted_vase_bm(
    profile_rz: List[Tuple[float, float]],
    n_flutes: int = 22,
    flute_amp: float = 0.0022,
    segs_per_flute: int = 4,
) -> Any:
    """Build scalloped vertically-fluted crystal vase mesh with smooth thick base and lip."""
    bm = bmesh.new()
    segs = n_flutes * segs_per_flute
    z_min, z_max = profile_rz[0][1], max(z for _, z in profile_rz)
    rings: List[List[Any]] = []

    for r_base, z in profile_rz:
        # Fade fluting smoothly near bottom foot and upper lip rim
        env = math.sin(max(0.0, min(1.0, (z - z_min) / max(1e-4, z_max - z_min))) * math.pi)
        ring = []
        for i in range(segs):
            ang = 2.0 * math.pi * i / float(segs)
            r = max(0.001, r_base + flute_amp * env * math.cos(n_flutes * ang))
            ring.append(bm.verts.new((r * math.cos(ang), r * math.sin(ang), z)))
        rings.append(ring)

    for j in range(len(rings) - 1):
        r0, r1 = rings[j], rings[j + 1]
        for i in range(segs):
            ni = (i + 1) % segs
            bm.faces.new((r0[i], r0[ni], r1[ni], r1[i]))

    c_bot = bm.verts.new((0.0, 0.0, profile_rz[0][1]))
    for i in range(segs):
        ni = (i + 1) % segs
        bm.faces.new((rings[0][ni], rings[0][i], c_bot))
    c_top = bm.verts.new((0.0, 0.0, profile_rz[-1][1]))
    for i in range(segs):
        ni = (i + 1) % segs
        bm.faces.new((rings[-1][i], rings[-1][ni], c_top))
    return bm


def build_fluted_crystal_vase_greenery(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Ribbed clear crystal glass vase with water and lush real CC0 botanical stems."""
    mat_glass = materials.make_clear_glass_material("ShowroomFlutedCrystalVase")
    mat_water = materials.make_water_liquid_material("ShowroomVaseWater")
    mat_stem = materials.make_ceramic_vessel_material("ShowroomGreenStem", color=(0.14, 0.25, 0.09, 1.0))

    # Rounded bulbous fluted vase profile (h 116 mm, max diam 124 mm)
    outer = [
        (0.042, 0.000), (0.048, 0.006), (0.060, 0.032), (0.062, 0.064),
        (0.056, 0.094), (0.048, 0.114), (0.0455, 0.116),
    ]
    inner = [
        (0.0435, 0.114), (0.051, 0.092), (0.0565, 0.062),
        (0.054, 0.032), (0.042, 0.015), (0.001, 0.014),
    ]
    vase = create_mesh_object("Prop_FlutedCrystalVase", _make_fluted_vase_bm(outer + inner, 22, 0.0020, 4), collection, mat_glass, True)

    # Crystal-clear water filling lower 62% of the fluted vase
    w_prof = [
        (0.042, 0.015), (0.054, 0.032), (0.0566, 0.062),
        (0.0548, 0.076), (0.046, 0.0745), (0.001, 0.0742),
    ]
    water = create_mesh_object("Prop_FlutedVaseWater", make_lathe_bm(w_prof, 48, True, True), collection, mat_water, True)

    objs: List[Any] = [vase, water]
    # Organic submerged botanical stems visible through clear crystal glass refraction
    stem_paths = (
        [Vector((-0.016, 0.006, 0.018)), Vector((-0.005, 0.002, 0.066)), Vector((0.012, -0.004, 0.125))],
        [Vector((0.014, -0.008, 0.019)), Vector((0.004, -0.003, 0.068)), Vector((-0.010, 0.006, 0.128))],
        [Vector((0.002, 0.015, 0.018)), Vector((0.000, 0.004, 0.070)), Vector((-0.004, -0.012, 0.124))],
        [Vector((-0.008, -0.014, 0.020)), Vector((-0.002, -0.005, 0.068)), Vector((0.008, 0.010, 0.126))],
    )
    for idx, pts in enumerate(stem_paths):
        st = create_mesh_object(f"Prop_VaseStem_{idx}", make_tube_bm(pts, 0.0022, 10), collection, mat_stem, True)
        objs.append(st)

    # Real CC0 broad botanical leaves emerging gracefully from vase mouth
    fol_root, fol_meshes = _import_single_foliage_cluster("calathea_orbifolia_01", "_b", 0.175, collection, "Prop_ShowroomVaseFoliage")
    if fol_root is not None:
        fol_root.location = Vector((0.0, 0.0, 0.088))
        objs.append(fol_root)

    root = parent_objects_to_empty("Prop_fluted_crystal_vase_greenery_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs + fol_meshes


def build_material_sample_board(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Luxury architectural interior finish sample folio board (ZERO text or brochures)."""
    mat_board = materials.make_book_cover_material("ShowroomSampleLinenBoard", color=(0.15, 0.145, 0.14, 1.0))
    mat_pages = materials.make_book_pages_material("ShowroomSamplePages")
    mat_stone = make_calacatta_marble_material("SampleSwatchMarble")
    mat_oak = materials.make_surface_material("brushed_oak", name="SampleSwatchOak")
    mat_walnut = materials.make_surface_material("smoked_executive_walnut", name="SampleSwatchWalnut")
    mat_brass = materials.make_brass_metal_material("SampleSwatchBrass")

    bw, bd, bh = 0.175, 0.228, 0.011
    board = create_mesh_object("Prop_SampleBoardBase", make_box_bm(bw, bd, bh, (0.0, 0.0, bh * 0.5)), collection, mat_board, False)
    add_bevel(board, width=0.0010, segments=2)
    under = create_mesh_object("Prop_SampleBoardStack", make_box_bm(bw - 0.008, bd - 0.008, 0.005, (0.006, 0.005, 0.0025)), collection, mat_pages, False)

    # Four tactile real architectural material chips arranged in a clean Swiss 2x2 grid
    swatches = (
        ("Prop_SwatchMarble", 0.068, 0.078, 0.0055, (-0.039, 0.044, bh + 0.0028), mat_stone),
        ("Prop_SwatchOak", 0.068, 0.078, 0.0050, (0.039, 0.044, bh + 0.0025), mat_oak),
        ("Prop_SwatchWalnut", 0.068, 0.078, 0.0050, (-0.039, -0.044, bh + 0.0025), mat_walnut),
        ("Prop_SwatchBrass", 0.068, 0.078, 0.0032, (0.039, -0.044, bh + 0.0016), mat_brass),
    )
    objs: List[Any] = [board, under]
    for sname, sx, sy, sz, loc_s, smat in swatches:
        sw = create_mesh_object(sname, make_box_bm(sx, sy, sz, loc_s), collection, smat, False)
        add_bevel(sw, width=0.0008, segments=2)
        objs.append(sw)

    root = parent_objects_to_empty("Prop_material_sample_board_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


PERSONA_PROP_CATALOG: Dict[str, Dict[str, Any]] = {
    "drafting_vellum_rolls": {
        "kind": "cad", "size_mm": "240 x 320 x 45",
        "description": "Spiral-rolled architectural vellum paper tubes over clean CAD grid sheet",
        "default_anchor": "left", "default_offset_mm": (-145.0, 28.0),
    },
    "concrete_pencil_cup": {
        "kind": "cad", "size_mm": "78 x 78 x 156",
        "description": "Turned honed-concrete pencil cup holding angled drafting pens and pencils",
        "default_anchor": "back_right", "default_offset_mm": (72.0, 118.0),
    },
    "basswood_maquette": {
        "kind": "cad", "size_mm": "160 x 125 x 116",
        "description": "Minimalist Swiss architectural basswood pavilion block massing study",
        "default_anchor": "back_right", "default_offset_mm": (182.0, 128.0),
    },
    "vintage_camera": {
        "kind": "cad", "size_mm": "148 x 89 x 77",
        "description": "Real Poly Haven CC0 vintage Leica rangefinder film camera",
        "default_anchor": "back_left", "default_offset_mm": (-108.0, 82.0),
    },
    "vintage_compass": {
        "kind": "cad", "size_mm": "55 x 68 x 56",
        "description": "Real Poly Haven CC0 antique brass pocket compass",
        "default_anchor": "right", "default_offset_mm": (78.0, 18.0),
    },
    "travel_monograph_stack": {
        "kind": "cad", "size_mm": "188 x 236 x 66",
        "description": "Three stacked blind-debossed linen and leather travel monographs (zero text)",
        "default_anchor": "front_left", "default_offset_mm": (-148.0, 18.0),
    },
    "brass_tabletop_globe": {
        "kind": "cad", "size_mm": "176 x 176 x 235",
        "description": "Sculptural brushed-brass meridian ring tabletop globe with antique cartography",
        "default_anchor": "back_right", "default_offset_mm": (132.0, 116.0),
    },
    "law_volumes_row": {
        "kind": "cad", "size_mm": "195 x 172 x 244",
        "description": "Standing row of classic dark leather-bound law volumes with subtle gold bands",
        "default_anchor": "back_left", "default_offset_mm": (-148.0, 106.0),
    },
    "leather_desk_folio": {
        "kind": "cad", "size_mm": "175 x 238 x 24",
        "description": "Thick stitched espresso-leather legal desk folio with brass corner trim",
        "default_anchor": "right", "default_offset_mm": (135.0, 22.0),
    },
    "gold_fountain_pen": {
        "kind": "cad", "size_mm": "144 x 12 x 12",
        "description": "Sleek jet-black lacquer and 18k brushed-gold executive fountain pen",
        "default_anchor": "front_right", "default_offset_mm": (52.0, 10.0),
    },
    "matte_black_mug": {
        "kind": "cad", "size_mm": "82 x 106 x 91",
        "description": "Unbranded matte jet-black architectural stoneware coffee mug (zero logo)",
        "default_anchor": "back_left", "default_offset_mm": (-76.0, 74.0),
    },
    "concrete_planter_plant": {
        "kind": "cad", "size_mm": "145 x 145 x 275",
        "description": "Honed concrete cube planter holding real CC0 lush green architectural foliage",
        "default_anchor": "back_right", "default_offset_mm": (146.0, 128.0),
    },
    "fluted_crystal_vase_greenery": {
        "kind": "cad", "size_mm": "145 x 145 x 265",
        "description": "Vertically fluted clear crystal glass vase with water and real CC0 botanical stems",
        "default_anchor": "back_left", "default_offset_mm": (-114.0, 96.0),
    },
    "material_sample_board": {
        "kind": "cad", "size_mm": "175 x 228 x 17",
        "description": "Architectural stone, timber, and brass material-sample presentation board",
        "default_anchor": "front_left", "default_offset_mm": (-140.0, 12.0),
    },
    "brass_dome_lamp": {
        "kind": "cad", "size_mm": "210 x 210 x 325",
        "description": "Spun brushed-brass mid-century dome table lamp with warm 2600K light pool",
        "default_anchor": "back_right", "default_offset_mm": (175.0, 118.0),
    },
    "brass_arch_print_frame": {
        "kind": "cad", "size_mm": "145 x 72 x 178",
        "description": "Brushed-brass tabletop frame displaying monochrome architectural canal print",
        "default_anchor": "back_right", "default_offset_mm": (86.0, 134.0),
    },
}

PERSONA_PROP_BUILDERS: Dict[str, Callable[[Any, Vec3, float, float], List[Any]]] = {
    "drafting_vellum_rolls": build_drafting_vellum_rolls,
    "concrete_pencil_cup": build_concrete_pencil_cup,
    "basswood_maquette": build_basswood_maquette,
    "vintage_camera": build_vintage_camera,
    "vintage_compass": build_vintage_compass,
    "travel_monograph_stack": build_travel_monograph_stack,
    "brass_tabletop_globe": build_brass_tabletop_globe,
    "law_volumes_row": build_law_volumes_row,
    "leather_desk_folio": build_leather_desk_folio,
    "gold_fountain_pen": build_gold_fountain_pen,
    "matte_black_mug": build_matte_black_mug,
    "concrete_planter_plant": build_concrete_planter_plant,
    "fluted_crystal_vase_greenery": build_fluted_crystal_vase_greenery,
    "material_sample_board": build_material_sample_board,
    "brass_dome_lamp": build_brass_dome_lamp,
    "brass_arch_print_frame": build_brass_arch_print_frame,
}
