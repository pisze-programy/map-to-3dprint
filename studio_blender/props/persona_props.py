"""CAD and CC0 props for Architect (12), Traveler (13), and Lawyer (14) personas."""

from __future__ import annotations

import math
from typing import Any, List, Tuple

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

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
    make_leather_spine_material,
    make_vellum_grid_material,
    make_vintage_globe_material,
)
from .cad_tableware import _build_single_book_parts


def _make_spiral_roll_bm(
    length: float,
    inner_r: float,
    turns: float = 2.6,
    pitch: float = 0.0022,
    wall_t: float = 0.00055,
    steps: int = 72,
) -> Any:
    """Create a realistic hollow multi-layer spiral-rolled vellum paper tube along local Y."""
    bm = bmesh.new()
    hy = length * 0.5
    outer_rings: List[Tuple[Any, Any]] = []
    inner_rings: List[Tuple[Any, Any]] = []
    for i in range(steps + 1):
        frac = i / float(steps)
        ang = frac * turns * 2.0 * math.pi
        r_mid = inner_r + frac * turns * pitch
        r_out = r_mid + wall_t * 0.5
        r_in = max(0.001, r_mid - wall_t * 0.5)
        ca, sa = math.cos(ang), math.sin(ang)
        outer_rings.append((bm.verts.new((r_out * ca, -hy, r_out * sa)), bm.verts.new((r_out * ca, hy, r_out * sa))))
        inner_rings.append((bm.verts.new((r_in * ca, -hy, r_in * sa)), bm.verts.new((r_in * ca, hy, r_in * sa))))

    for i in range(steps):
        o0a, o0b = outer_rings[i]
        o1a, o1b = outer_rings[i + 1]
        i0a, i0b = inner_rings[i]
        i1a, i1b = inner_rings[i + 1]
        bm.faces.new((o0a, o0b, o1b, o1a))
        bm.faces.new((i1a, i1b, i0b, i0a))
        bm.faces.new((o0a, o1a, i1a, i0a))
        bm.faces.new((i0b, i1b, o1b, o0b))

    # Cap start and end strip edges cleanly
    bm.faces.new((outer_rings[0][0], inner_rings[0][0], inner_rings[0][1], outer_rings[0][1]))
    bm.faces.new((inner_rings[-1][0], outer_rings[-1][0], outer_rings[-1][1], inner_rings[-1][1]))
    return bm


def build_drafting_vellum_rolls(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Two spiral-rolled heavy architectural vellum tubes resting on a clean CAD grid sheet."""
    mat_grid = make_vellum_grid_material("ArchVellumGridSheet")
    mat_roll = make_vellum_grid_material("ArchVellumRolledTube")

    # Flat clean architectural grid vellum sheet (zero text!)
    sheet = create_mesh_object(
        "Prop_VellumFlatSheet",
        make_box_bm(0.220, 0.300, 0.0008, (-0.015, -0.020, 0.0004)),
        collection,
        mat_grid,
        False,
    )
    # Primary back rolled vellum tube (radius ~21 mm, length 265 mm) positioned cleanly inside frame
    r1_outer = 0.016 + 2.5 * 0.0022 + 0.0005
    roll_a = create_mesh_object(
        "Prop_VellumRollA",
        _make_spiral_roll_bm(0.260, inner_r=0.015, turns=2.5, pitch=0.0022),
        collection,
        mat_roll,
        True,
        location=(0.015, 0.028, r1_outer + 0.0008),
        rotation=(0.0, 0.0, math.radians(-10.0)),
    )
    # Secondary slightly smaller foreground roll tucked cleanly beside Roll A
    r2_outer = 0.013 + 2.3 * 0.0020 + 0.0005
    roll_b = create_mesh_object(
        "Prop_VellumRollB",
        _make_spiral_roll_bm(0.240, inner_r=0.012, turns=2.3, pitch=0.0020),
        collection,
        mat_roll,
        True,
        location=(0.056, 0.052, r2_outer + 0.0008),
        rotation=(0.0, 0.0, math.radians(-15.0)),
    )
    objs = [sheet, roll_a, roll_b]
    root = parent_objects_to_empty("Prop_drafting_vellum_rolls_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def build_concrete_pencil_cup(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Turned architectural honed-concrete pencil cup holding 4 angled drafting pens/pencils."""
    mat_cup = materials.make_surface_material("honed_concrete_pot", name="ArchConcretePencilCup")
    mat_blk = materials.make_matte_black_tech_material("CupDraftingPenBlk")
    mat_brass = materials.make_brass_metal_material("CupDraftingPenBrass")
    mat_wood = materials.make_surface_material("brushed_oak", name="CupCedarPencil")

    cup_prof = [
        (0.036, 0.000), (0.038, 0.003), (0.0385, 0.092), (0.0365, 0.094),
        (0.0315, 0.094), (0.0305, 0.092), (0.0300, 0.012), (0.001, 0.011),
    ]
    cup = create_mesh_object("Prop_ConcreteCup", make_lathe_bm(cup_prof, 56, True, True), collection, mat_cup, True)

    objs: List[Any] = [cup]
    pen_specs = (
        (-0.011, 0.007, 0.146, 0.0044, math.radians(9.0), math.radians(-11.0), mat_blk, mat_brass),
        (0.012, 0.005, 0.154, 0.0045, math.radians(-10.0), math.radians(8.0), mat_brass, mat_blk),
        (0.002, -0.010, 0.142, 0.0042, math.radians(8.0), math.radians(10.0), mat_wood, mat_brass),
        (-0.008, -0.008, 0.136, 0.0041, math.radians(-7.0), math.radians(-8.0), mat_blk, mat_brass),
    )
    for idx, (px, py, plen, prad, rx, ry, mat_p, mat_cap) in enumerate(pen_specs):
        # Technical drafting pens rest tips-down with flat knurled metal clicker caps UP
        p_prof = [(prad, 0.0), (prad, plen - 0.010), (prad * 0.86, plen - 0.008)]
        pen = create_mesh_object(
            f"Prop_CupPen_{idx}", make_lathe_bm(p_prof, 24, True, True),
            collection, mat_p, True, location=(px, py, 0.012), rotation=(rx, ry, 0.0),
        )
        cap_prof = [(prad * 0.88, plen - 0.010), (prad * 0.88, plen), (prad * 0.65, plen + 0.005)]
        cap = create_mesh_object(
            f"Prop_CupPenCap_{idx}", make_lathe_bm(cap_prof, 20, True, True),
            collection, mat_cap, True, location=(px, py, 0.012), rotation=(rx, ry, 0.0),
        )
        objs.extend([pen, cap])

    root = parent_objects_to_empty("Prop_concrete_pencil_cup_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def build_basswood_maquette(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Minimalist Swiss architectural basswood pavilion massing model (zero text)."""
    mat_wood = materials.make_surface_material("basswood_ply", name="ArchBasswoodMaquette")
    mat_core = materials.make_surface_material("pale_ash_oak", name="ArchBasswoodCore")

    bm = bmesh.new()
    def _add(sx: float, sy: float, sz: float, cx: float, cy: float, cz: float) -> None:
        m = Matrix.Translation(Vector((cx, cy, cz))) @ Matrix.Diagonal((sx, sy, sz, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)

    # Stepped architectural site plinth + lower podium terrace
    _add(0.160, 0.125, 0.012, 0.0, 0.0, 0.006)
    _add(0.136, 0.102, 0.008, -0.004, 0.004, 0.016)
    # Recessed inner pavilion core walls (ground & second floor)
    _add(0.112, 0.072, 0.038, -0.004, 0.008, 0.039)
    # Crisp vertical modernist colonnade fins along front & side facades
    for ix in range(-3, 4):
        _add(0.0045, 0.012, 0.038, -0.004 + ix * 0.019, -0.032, 0.039)
    # Second floor slab overhang + cantilevered upper studio volume
    _add(0.130, 0.092, 0.005, -0.002, 0.004, 0.0605)
    _add(0.088, 0.074, 0.036, 0.012, 0.006, 0.081)
    for ix in range(-2, 3):
        _add(0.0040, 0.010, 0.036, 0.012 + ix * 0.019, -0.033, 0.081)
    # Roof parapet deck + architectural skylight clerestory monitor
    _add(0.096, 0.082, 0.005, 0.012, 0.004, 0.1015)
    _add(0.044, 0.036, 0.012, 0.014, 0.008, 0.110)

    pav = create_mesh_object("Prop_BasswoodPavilion", bm, collection, mat_wood, False)
    add_bevel(pav, width=0.0005, segments=2)

    # Subtle recessed warm-wood shadow core inside colonnade bays
    shadow_core = create_mesh_object(
        "Prop_BasswoodCoreShadow",
        make_box_bm(0.104, 0.066, 0.034, (-0.004, 0.008, 0.038)),
        collection,
        mat_core,
        False,
    )
    objs = [pav, shadow_core]
    root = parent_objects_to_empty("Prop_basswood_maquette_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def build_vintage_camera(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Real Poly Haven CC0 Camera_01 Leica rangefinder (strap stripped for clean desk framing)."""
    gltf_path = assets_cc0.ensure_gltf_model("Camera_01", resolution="1k")
    if gltf_path is None:
        return []
    root, meshes = assets_cc0.import_external_prop(
        filepath=gltf_path,
        collection=collection,
        name_prefix="Prop_VintageCamera",
        target_height_m=0.077,
        scale_factor=scale,
    )
    if root is None:
        return []

    kept: List[Any] = []
    for mobj in meshes:
        if "strap" in mobj.name.lower() or (
            mobj.data and len(mobj.data.materials) == 1 and mobj.data.materials[0] and "strap" in mobj.data.materials[0].name.lower()
        ):
            bpy.data.objects.remove(mobj, do_unlink=True)
        else:
            kept.append(mobj)

    if not kept:
        bpy.data.objects.remove(root, do_unlink=True)
        return []

    # Re-center & ground the camera body cleanly after removing the sprawling strap
    bpy.context.view_layer.update()
    pts = [mobj.matrix_world @ Vector(c) for mobj in kept for c in mobj.bound_box]
    min_z = min(p.z for p in pts)
    cx = 0.5 * (min(p.x for p in pts) + max(p.x for p in pts))
    cy = 0.5 * (min(p.y for p in pts) + max(p.y for p in pts))
    inv_s = 1.0 / max(1e-4, float(root.scale.x))
    for mobj in kept:
        mobj.location = (
            mobj.location.x - cx * inv_s,
            mobj.location.y - cy * inv_s,
            mobj.location.z - min_z * inv_s,
        )

    root.location = Vector(location)
    root.rotation_euler = Euler((0.0, 0.0, math.radians(yaw_deg)), "XYZ")
    return [root] + kept


def build_vintage_compass(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Real Poly Haven CC0 seadogs_compass antique brass travel compass."""
    gltf_path = assets_cc0.ensure_gltf_model("seadogs_compass", resolution="1k")
    if gltf_path is None:
        return []
    root, meshes = assets_cc0.import_external_prop(
        filepath=gltf_path,
        collection=collection,
        name_prefix="Prop_VintageCompass",
        target_height_m=0.056,
        scale_factor=scale,
    )
    if root is None:
        return []
    root.location = Vector(location)
    root.rotation_euler = Euler((0.0, 0.0, math.radians(yaw_deg)), "XYZ")
    return [root] + meshes


def build_travel_monograph_stack(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Three stacked blind-debossed linen & leather travel monographs (ZERO spine text)."""
    mat_pages = materials.make_book_pages_material("TravelMonographPages")
    mat_b1 = make_leather_spine_material("TravelBookEspresso", (0.10, 0.055, 0.032))
    mat_b1_d = make_leather_spine_material("TravelBookEspressoDeb", (0.07, 0.038, 0.022))
    mat_b2 = materials.make_book_cover_material("TravelBookSandLinen", (0.52, 0.47, 0.40, 1.0))
    mat_b2_d = materials.make_book_cover_material("TravelBookSandDeb", (0.42, 0.38, 0.32, 1.0))
    mat_b3 = materials.make_book_cover_material("TravelBookCharcoal", (0.16, 0.17, 0.18, 1.0))
    mat_b3_d = materials.make_book_cover_material("TravelBookCharcoalDeb", (0.11, 0.12, 0.13, 1.0))

    objs: List[Any] = []
    objs.extend(_build_single_book_parts("Prop_TravBook1", 0.188, 0.236, 0.024, 0.0000, mat_b1, mat_b1_d, mat_pages, collection, 0.0))
    objs.extend(_build_single_book_parts("Prop_TravBook2", 0.178, 0.226, 0.022, 0.0242, mat_b2, mat_b2_d, mat_pages, collection, math.radians(3.5)))
    objs.extend(_build_single_book_parts("Prop_TravBook3", 0.166, 0.214, 0.020, 0.0464, mat_b3, mat_b3_d, mat_pages, collection, math.radians(-2.5)))
    root = parent_objects_to_empty("Prop_travel_monograph_stack_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def build_brass_tabletop_globe(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Sculptural brushed-brass meridian ring tabletop globe with vintage cartography (zero text)."""
    mat_brass = materials.make_brass_metal_material("TravelGlobeBrass")
    mat_globe = make_vintage_globe_material("TravelGlobeSphere")

    # Stepped turned brass pedestal base + short collar stem
    base_prof = [
        (0.048, 0.000), (0.049, 0.004), (0.045, 0.011), (0.036, 0.018),
        (0.026, 0.024), (0.012, 0.030), (0.009, 0.044), (0.013, 0.050), (0.007, 0.054),
    ]
    base = create_mesh_object("Prop_GlobeBase", make_lathe_bm(base_prof, 48, True, True), collection, mat_brass, True)

    globe_r = 0.078
    center_z = 0.146
    tilt = math.radians(23.5)

    # Smooth UV-mapped sphere tilted 23.5 deg on Earth axis
    bm_sph = bmesh.new()
    bmesh.ops.create_uvsphere(bm_sph, u_segments=48, v_segments=32, radius=globe_r)
    sphere = create_mesh_object(
        "Prop_GlobeSphere",
        bm_sph,
        collection,
        mat_globe,
        True,
        location=(0.0, 0.0, center_z),
        rotation=(0.0, tilt, 0.0),
    )

    # Curved brushed-brass half-meridian arc embracing the globe from south pole to north pole
    arc_r = globe_r + 0.010
    arc_pts: List[Vector] = []
    for i in range(29):
        ang = -math.pi * 0.5 + (i / 28.0) * math.pi
        lx = arc_r * math.cos(ang)
        lz = arc_r * math.sin(ang)
        # Rotate meridian into 23.5 deg axial tilt plane
        wx = lx * math.cos(tilt) + lz * math.sin(tilt)
        wz = center_z - lx * math.sin(tilt) + lz * math.cos(tilt)
        arc_pts.append(Vector((wx, 0.0, wz)))
    meridian = create_mesh_object("Prop_GlobeMeridian", make_tube_bm(arc_pts, 0.0038, 12), collection, mat_brass, True)
    add_subsurf(meridian, levels=1)

    # Axial spindle rod piercing north & south poles into the meridian ring
    axis_bm = make_lathe_bm([(0.0024, -arc_r - 0.003), (0.0024, arc_r + 0.005)], 16, True, True)
    axis = create_mesh_object(
        "Prop_GlobeAxis",
        axis_bm,
        collection,
        mat_brass,
        True,
        location=(0.0, 0.0, center_z),
        rotation=(0.0, tilt, 0.0),
    )

    objs = [base, sphere, meridian, axis]
    root = parent_objects_to_empty("Prop_brass_tabletop_globe_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs
