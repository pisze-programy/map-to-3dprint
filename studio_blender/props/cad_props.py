"""CAD-precision hard-surface industrial design scale props (laptop, desk mat, pen, phone, ruler)."""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, List

import bmesh

from .. import materials
from ..envs.common import (
    Vec3,
    add_bevel,
    create_mesh_object,
    make_box_bm,
    make_lathe_bm,
    parent_objects_to_empty,
)
from .cad_tableware import (
    build_arch_book,
    build_coffee_mug,
    build_crystal_glass,
    build_espresso_cup,
    build_glass_tumbler,
    build_leather_notebook,
    build_monograph_stack,
)


def _create_laptop_meshes(collection: Any, prefix: str, z_offset: float = 0.0) -> List[Any]:
    """Build precision 14-inch anodized silver aluminum laptop meshes resting on z_offset."""
    mat_alu = materials.make_anodized_aluminum_material(name="LaptopAluminum")
    mat_key = materials.make_matte_black_tech_material(name="LaptopKeywell")
    mat_scr = materials.make_dark_screen_glass_material(name="LaptopScreenGlass")
    mat_foot = materials.make_rubber_foot_material(name="LaptopFeet")

    bw, bd, bh = 0.312, 0.221, 0.0112
    foot_h = 0.0015
    z0 = z_offset

    base = create_mesh_object(f"{prefix}_Base", make_box_bm(bw, bd, bh, (0.0, 0.0, z0 + foot_h + bh * 0.5)), collection, mat_alu, False)
    add_bevel(base, width=0.0028, segments=4)

    keywell = create_mesh_object(
        f"{prefix}_Keywell",
        make_box_bm(0.278, 0.112, 0.0014, (0.0, 0.032, z0 + foot_h + bh + 0.0001)),
        collection,
        mat_key,
        False,
    )
    add_bevel(keywell, width=0.0004, segments=2)

    tpad = create_mesh_object(
        f"{prefix}_Trackpad",
        make_box_bm(0.128, 0.078, 0.0005, (0.0, -0.062, z0 + foot_h + bh + 0.00015)),
        collection,
        mat_alu,
        False,
    )
    add_bevel(tpad, width=0.0002, segments=2)

    lid_thick = 0.0044
    lid_h = 0.214
    tilt_rad = math.radians(-16.0)
    hinge_y = bd * 0.5 - 0.004
    hinge_z = z0 + foot_h + bh + 0.002

    lid = create_mesh_object(
        f"{prefix}_Lid",
        make_box_bm(bw, lid_thick, lid_h, (0.0, 0.0, lid_h * 0.5)),
        collection,
        mat_alu,
        False,
        location=(0.0, hinge_y, hinge_z),
        rotation=(tilt_rad, 0.0, 0.0),
    )
    add_bevel(lid, width=0.0014, segments=3)

    screen = create_mesh_object(
        f"{prefix}_Screen",
        make_box_bm(bw - 0.008, 0.0008, lid_h - 0.009, (0.0, -lid_thick * 0.5 - 0.0002, lid_h * 0.5 + 0.001)),
        collection,
        mat_scr,
        False,
        location=(0.0, hinge_y, hinge_z),
        rotation=(tilt_rad, 0.0, 0.0),
    )

    feet = create_mesh_object(f"{prefix}_FootPad", make_box_bm(bw - 0.03, bd - 0.03, foot_h, (0.0, 0.0, z0 + foot_h * 0.5)), collection, mat_foot, False)
    return [base, keywell, tpad, lid, screen, feet]


def build_laptop_corner(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Precision 14-inch anodized silver aluminum laptop (312 x 221 x 11.5 mm) with open lid."""
    objs = _create_laptop_meshes(collection, "Prop_Laptop", z_offset=0.0)
    root = parent_objects_to_empty("Prop_laptop_corner_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def build_desk_mat_laptop(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Beveled charcoal wool-felt desk pad (370 x 250 mm) with straight-aligned 14-inch aluminum laptop."""
    mat_felt = materials.make_surface_material("dark_wool_felt", name="DeskMatWoolFelt")
    pad_t = 0.0032
    pad_bm = _make_rounded_rect_prism_bm(0.370, 0.250, 0.0, pad_t, corner_r=0.012, corner_segs=8)
    pad = create_mesh_object("Prop_DeskMatFelt", pad_bm, collection, mat_felt, True)
    add_bevel(pad, width=0.0008, segments=2)

    laptop_objs = _create_laptop_meshes(collection, "Prop_DeskMatLaptop", z_offset=pad_t)
    objs = [pad] + laptop_objs
    root = parent_objects_to_empty("Prop_desk_mat_laptop_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def _make_rounded_rect_prism_bm(
    w: float,
    d: float,
    z0: float,
    z1: float,
    corner_r: float,
    corner_segs: int = 8,
) -> Any:
    """Build a clean manifold prism with exact circular rounded XY corners."""
    bm = bmesh.new()
    hw = w * 0.5 - corner_r
    hh = d * 0.5 - corner_r
    centers = ((hw, hh, 0.0), (-hw, hh, math.pi * 0.5), (-hw, -hh, math.pi), (hw, -hh, 1.5 * math.pi))
    ring_2d = []
    for cx, cy, a0 in centers:
        for i in range(corner_segs + 1):
            ang = a0 + (i / float(corner_segs)) * (math.pi * 0.5)
            ring_2d.append((cx + corner_r * math.cos(ang), cy + corner_r * math.sin(ang)))

    bot = [bm.verts.new((x, y, z0)) for x, y in ring_2d]
    top = [bm.verts.new((x, y, z1)) for x, y in ring_2d]
    n = len(ring_2d)
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    for i in range(n):
        ni = (i + 1) % n
        bm.faces.new((bot[i], bot[ni], top[ni], top[i]))
    return bm


def build_smartphone(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Matte-black modern smartphone (71.5 x 147.6 x 7.8 mm) with smooth rounded corners."""
    mat_body = materials.make_matte_black_tech_material(name="SmartphoneBody")
    mat_glass = materials.make_dark_screen_glass_material(name="SmartphoneGlass")

    pw, pd, ph = 0.0715, 0.1476, 0.0078
    bm_body = _make_rounded_rect_prism_bm(pw, pd, 0.0, ph, corner_r=0.0105, corner_segs=8)
    body = create_mesh_object("Prop_SmartphoneBody", bm_body, collection, mat_body, True)
    add_bevel(body, width=0.0008, segments=3)

    bm_glass = _make_rounded_rect_prism_bm(pw - 0.0030, pd - 0.0030, ph - 0.0002, ph + 0.00035, corner_r=0.0092, corner_segs=8)
    glass = create_mesh_object("Prop_SmartphoneScreen", bm_glass, collection, mat_glass, True)

    objs = [body, glass]
    root = parent_objects_to_empty("Prop_smartphone_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def build_architect_pen(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Precision machined matte-black architectural technical pen (140 mm x 9.8 mm)."""
    mat_blk = materials.make_matte_black_tech_material(name="ArchPenBody")
    mat_steel = materials.make_brushed_metal_material(name="ArchPenSteel")

    rad = 0.0049
    pen_prof = [
        (0.0004, -0.070),
        (0.0012, -0.064),
        (0.0036, -0.052),
        (0.0046, -0.036),
        (0.0049, -0.024),
        (0.0049, 0.056),
        (0.0045, 0.064),
        (0.0032, 0.070),
    ]
    rot_flat = (0.0, math.pi * 0.5, 0.0)
    barrel = create_mesh_object(
        "Prop_ArchPenBarrel",
        make_lathe_bm(pen_prof, 32, True, True),
        collection,
        mat_blk,
        True,
        location=(0.0, 0.0, rad),
        rotation=rot_flat,
    )

    ring_prof = [(0.00505, -0.028), (0.00505, -0.023)]
    ring = create_mesh_object(
        "Prop_ArchPenRing",
        make_lathe_bm(ring_prof, 32, True, True),
        collection,
        mat_steel,
        True,
        location=(0.0, 0.0, rad),
        rotation=rot_flat,
    )
    click_prof = [(0.0034, 0.068), (0.0034, 0.074), (0.0028, 0.075)]
    clicker = create_mesh_object(
        "Prop_ArchPenClicker",
        make_lathe_bm(click_prof, 24, True, True),
        collection,
        mat_steel,
        True,
        location=(0.0, 0.0, rad),
        rotation=rot_flat,
    )

    clip = create_mesh_object(
        "Prop_ArchPenClip",
        make_box_bm(0.044, 0.0026, 0.0014, (0.034, 0.0, rad * 2.0 + 0.0010)),
        collection,
        mat_steel,
        False,
    )
    add_bevel(clip, width=0.0003, segments=2)

    objs = [barrel, ring, clicker, clip]
    root = parent_objects_to_empty("Prop_architect_pen_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def build_steel_ruler(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Optional 180 mm triangular brushed gunmetal-steel architectural scale ruler."""
    mat_steel = materials.make_ruler_metal_material(name="ArchScaleRulerGunmetal")
    mat_groove = materials.make_matte_black_tech_material(name="ArchScaleRulerGroove")

    length = 0.180
    width = 0.018
    height = width * 0.82

    bm = bmesh.new()
    hl = length * 0.5
    hw = width * 0.5
    cross = [(-hw, 0.0), (hw, 0.0), (0.0, height)]
    left_v = [bm.verts.new((-hl, y, z)) for y, z in cross]
    right_v = [bm.verts.new((hl, y, z)) for y, z in cross]
    bm.faces.new((left_v[2], left_v[1], left_v[0]))
    bm.faces.new((right_v[0], right_v[1], right_v[2]))
    for i in range(3):
        ni = (i + 1) % 3
        bm.faces.new((left_v[i], right_v[i], right_v[ni], left_v[ni]))

    ruler = create_mesh_object("Prop_SteelScaleRuler", bm, collection, mat_steel, False)
    add_bevel(ruler, width=0.00045, segments=3)

    stripe = create_mesh_object(
        "Prop_SteelRulerIndexBand",
        make_box_bm(length - 0.008, 0.0022, 0.0022, (0.0, 0.0, height * 0.45)),
        collection,
        mat_groove,
        False,
    )

    objs = [ruler, stripe]
    root = parent_objects_to_empty("Prop_steel_ruler_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


CAD_PROP_BUILDERS: Dict[str, Callable[[Any, Vec3, float, float], List[Any]]] = {
    "espresso_cup": build_espresso_cup,
    "coffee_mug": build_coffee_mug,
    "glass_tumbler": build_glass_tumbler,
    "crystal_glass": build_crystal_glass,
    "arch_book": build_arch_book,
    "monograph_stack": build_monograph_stack,
    "leather_notebook": build_leather_notebook,
    "laptop_corner": build_laptop_corner,
    "desk_mat_laptop": build_desk_mat_laptop,
    "smartphone": build_smartphone,
    "architect_pen": build_architect_pen,
    "steel_ruler": build_steel_ruler,
}
