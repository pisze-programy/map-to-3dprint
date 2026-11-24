"""Luxury interior architecture stages: Milanese boiserie, living room, loft shelf, credenzas."""

from __future__ import annotations

from typing import Any, List, Tuple

import bmesh
from mathutils import Matrix, Vector

from .. import materials
from ..props.cad_tableware import build_arch_book
from ..props.cc0_props import build_cc0_prop, build_room_furniture
from .common import add_bevel, create_area_light, create_mesh_object, make_box_bm


def _box_mat(sx: float, sy: float, sz: float, center: Tuple[float, float, float]) -> Any:
    return Matrix.Translation(Vector(center)) @ Matrix.Diagonal((sx, sy, sz, 1.0))


def _add_boiserie_panel_bm(
    bm: Any,
    cx: float,
    cz: float,
    w: float,
    h: float,
    wall_front_y: float,
    trim_w: float = 0.018,
    trim_d: float = 0.012,
) -> None:
    """Append a crisp Milanese double-step architectural boiserie frame onto wall_front_y."""
    hw = w * 0.5
    hh = h * 0.5
    cy = wall_front_y - trim_d * 0.5
    # Outer architectural molding strips (top, bottom, left, right)
    bmesh.ops.create_cube(bm, size=1.0, matrix=_box_mat(w + trim_w, trim_d, trim_w, (cx, cy, cz + hh)))
    bmesh.ops.create_cube(bm, size=1.0, matrix=_box_mat(w + trim_w, trim_d, trim_w, (cx, cy, cz - hh)))
    bmesh.ops.create_cube(bm, size=1.0, matrix=_box_mat(trim_w, trim_d, h - trim_w, (cx - hw, cy, cz)))
    bmesh.ops.create_cube(bm, size=1.0, matrix=_box_mat(trim_w, trim_d, h - trim_w, (cx + hw, cy, cz)))

    # Delicate recessed inner fillet border for authentic Milanese shadow catch
    iw = w - 0.044
    ih = h - 0.044
    if iw > 0.12 and ih > 0.12:
        fw = 0.008
        fd = 0.006
        fcy = wall_front_y - fd * 0.5
        bmesh.ops.create_cube(bm, size=1.0, matrix=_box_mat(iw + fw, fd, fw, (cx, fcy, cz + ih * 0.5)))
        bmesh.ops.create_cube(bm, size=1.0, matrix=_box_mat(iw + fw, fd, fw, (cx, fcy, cz - ih * 0.5)))
        bmesh.ops.create_cube(bm, size=1.0, matrix=_box_mat(fw, fd, ih - fw, (cx - iw * 0.5, fcy, cz)))
        bmesh.ops.create_cube(bm, size=1.0, matrix=_box_mat(fw, fd, ih - fw, (cx + iw * 0.5, fcy, cz)))


def build_living_room_backdrop(
    desk_z: float,
    wall_mat: Any,
    collection: Any,
) -> List[Any]:
    """Build sunlit Milanese living room behind finite coffee table (sofa, rug, floor plant, wall)."""
    objs: List[Any] = []
    floor_z = desk_z - 0.36

    # Solid recessed sandstone coffee-table pedestal base under finite top slab
    ped_mat = materials.make_surface_material("honed_sandstone", name="CoffeeTablePedestal")
    ped = create_mesh_object(
        "Arch_CoffeeTablePedestal",
        make_box_bm(0.76, 0.40, 0.32, (0.0, 0.08, desk_z - 0.032 - 0.16)),
        collection,
        ped_mat,
    )
    add_bevel(ped, width=0.004, segments=2)
    objs.append(ped)

    # Warm pale ash-oak living room hardwood floor
    floor_mat = materials.make_surface_material("pale_ash_oak", name="LivingRoomOakFloor")
    objs.append(create_mesh_object("Arch_LivingFloor", make_box_bm(4.40, 3.40, 0.04, (0.0, 0.85, floor_z - 0.02)), collection, floor_mat))

    # Creamy woven wool boucle living-room area rug
    rug_mat = materials.make_surface_material("honed_sandstone", name="LivingRoomCreamRug")
    rug = create_mesh_object("Arch_LivingRug", make_box_bm(2.60, 1.95, 0.010, (0.0, 0.72, floor_z + 0.005)), collection, rug_mat)
    add_bevel(rug, width=0.003, segments=2)
    objs.append(rug)

    # Real CC0 photogrammetry luxury sofa in warm cream boucle + sunlit botanical floor plant
    sofa_mat = materials.make_surface_material("cream_boucle", name="LivingRoomCreamBoucleSofa")
    objs.extend(
        build_room_furniture(
            asset_id="sofa_03",
            collection=collection,
            location=(0.08, 1.24, floor_z + 0.010),
            yaw_deg=180.0,
            scale=0.92,
            name_prefix="Room_LuxurySofa",
            override_material=sofa_mat,
        )
    )
    objs.extend(
        build_room_furniture(
            asset_id="potted_plant_01",
            collection=collection,
            location=(0.72, 0.96, floor_z + 0.010),
            yaw_deg=-25.0,
            target_height_m=1.18,
            name_prefix="Room_LivingFloorPlant",
        )
    )

    # Sunlit ivory plaster back wall + warm living-room daylight wash illuminating sofa & greenery
    wall_y = 1.95
    objs.append(create_mesh_object("Arch_LivingWall", make_box_bm(4.60, 0.08, 2.80, (0.0, wall_y + 0.04, floor_z + 1.30)), collection, wall_mat))
    bm_trim = bmesh.new()
    for cx in (-1.05, 0.0, 1.05):
        _add_boiserie_panel_bm(bm_trim, cx, floor_z + 1.12, 0.88, 1.15, wall_y, trim_w=0.024, trim_d=0.016)
    trim = create_mesh_object("Arch_LivingBoiserie", bm_trim, collection, wall_mat)
    add_bevel(trim, width=0.0018, segments=2)
    objs.append(trim)

    room_sun = create_area_light(
        name="Light_LivingRoomSunWash",
        collection=collection,
        location=Vector((1.05, 0.95, desk_z + 1.18)),
        target=Vector((0.05, 1.35, desk_z + 0.10)),
        energy=28.0,
        color=(1.0, 0.95, 0.86),
        size_x=0.85,
        size_y=0.95,
        spread_deg=72.0,
        visible_camera=False,
    )
    objs.append(room_sun)
    return objs


def build_boiserie_console_wall(
    desk_z: float,
    wall_mat: Any,
    collection: Any,
) -> List[Any]:
    """Build sunlit Milanese entryway wall with crisp 3D boiserie molding behind oak console."""
    objs: List[Any] = []
    wall_y = 0.44
    objs.append(create_mesh_object("Arch_ConsoleWall", make_box_bm(3.20, 0.08, 2.20, (0.0, wall_y + 0.04, desk_z + 0.85)), collection, wall_mat))

    bm_trim = bmesh.new()
    # Delicate vertical Milanese boiserie panels cleanly clear of the skyline silhouette
    _add_boiserie_panel_bm(bm_trim, 0.0, desk_z + 0.50, 0.66, 0.72, wall_y, trim_w=0.013, trim_d=0.009)
    _add_boiserie_panel_bm(bm_trim, -0.76, desk_z + 0.50, 0.66, 0.72, wall_y, trim_w=0.013, trim_d=0.009)
    _add_boiserie_panel_bm(bm_trim, 0.76, desk_z + 0.50, 0.66, 0.72, wall_y, trim_w=0.013, trim_d=0.009)
    trim = create_mesh_object("Arch_ConsoleBoiserie", bm_trim, collection, wall_mat)
    add_bevel(trim, width=0.0014, segments=2)
    objs.append(trim)
    return objs


def build_loft_shelving_wall(
    desk_z: float,
    wall_mat: Any,
    oak_mat: Any,
    collection: Any,
) -> List[Any]:
    """Build airy Scandinavian studio back wall with floating oak wall shelf & blurred ceramics."""
    objs: List[Any] = []
    wall_y = 0.74
    objs.append(create_mesh_object("Arch_LoftWall", make_box_bm(3.20, 0.08, 2.20, (0.0, wall_y + 0.04, desk_z + 0.85)), collection, wall_mat))

    # Sleek floating natural-oak Scandinavian shelf peeking cleanly into upper bokeh
    shelf_z = desk_z + 0.18
    shelf_d = 0.16
    shelf = create_mesh_object(
        "Arch_LoftOakShelf",
        make_box_bm(1.45, shelf_d, 0.024, (0.05, wall_y - shelf_d * 0.5, shelf_z - 0.012)),
        collection,
        oak_mat,
    )
    add_bevel(shelf, width=0.0015, segments=2)
    objs.append(shelf)

    objs.extend(build_cc0_prop("ceramic_vessel_low", "ceramic_vase_02", 0.115, collection, (-0.16, wall_y - 0.085, shelf_z), yaw_deg=18.0))
    objs.extend(build_cc0_prop("ceramic_vessel_tall", "ceramic_vase_03", 0.185, collection, (0.28, wall_y - 0.085, shelf_z), yaw_deg=-22.0))
    objs.extend(build_arch_book(collection, (0.08, wall_y - 0.085, shelf_z), yaw_deg=90.0, scale=0.72))
    return objs


def _build_monolithic_concrete_bench(
    prefix: str,
    wall_y: float,
    top_z: float,
    collection: Any,
) -> List[Any]:
    """Build a clean cantilevered monolithic architectural concrete gallery bench/plinth."""
    objs: List[Any] = []
    bench_mat = materials.make_surface_material("pale_terrazzo", name=f"{prefix}_ConcreteMat")
    shadow_mat = materials.make_surface_material("charcoal_plaster", name=f"{prefix}_ShadowPlinth")

    bw, bd, slab_t = 2.80, 0.36, 0.072
    slab = create_mesh_object(
        f"{prefix}_ConcreteSlab",
        make_box_bm(bw, bd, slab_t, (0.0, wall_y - bd * 0.5, top_z - slab_t * 0.5)),
        collection,
        bench_mat,
    )
    add_bevel(slab, width=0.0024, segments=3)
    objs.append(slab)

    # Deeply recessed matte-charcoal architectural shadow plinth below the cantilevered concrete bench
    plinth_h = 0.58
    plinth_d = bd - 0.11
    plinth = create_mesh_object(
        f"{prefix}_RecessedPlinth",
        make_box_bm(bw - 0.08, plinth_d, plinth_h, (0.0, wall_y - plinth_d * 0.5, top_z - slab_t - plinth_h * 0.5)),
        collection,
        shadow_mat,
    )
    objs.append(plinth)
    return objs


def build_gallery_wall_mount_stage(
    wall_y: float,
    outer_h_m: float,
    wall_mat: Any,
    credenza_mat: Any,
    collection: Any,
) -> List[Any]:
    """Build pure minimalist museum gallery plaster wall (zero fake moldings, zero clutter)."""
    _ = (outer_h_m, credenza_mat)
    wall_thick = 0.08
    wall = create_mesh_object(
        "Arch_GalleryWall",
        make_box_bm(3.60, wall_thick, 2.80, (0.0, wall_y + wall_thick * 0.5, 0.05)),
        collection,
        wall_mat,
    )
    return [wall]


def build_acoustic_slat_wall_stage(
    wall_y: float,
    outer_w_m: float,
    outer_h_m: float,
    slat_mat: Any,
    backing_mat: Any,
    collection: Any,
) -> List[Any]:
    """Build continuous brushed-oak acoustic slats over felt backing + monolithic concrete bench."""
    _ = (outer_w_m, backing_mat)
    objs: List[Any] = []
    slat_w = 0.024
    slat_d = 0.018
    slat_pitch = 0.036
    slat_h = 2.60

    # Matte charcoal acoustic felt directly behind the continuous vertical oak slats
    felt_mat = materials.make_surface_material("charcoal_plaster", name="Arch_AcousticFeltBacking")
    wall_thick = 0.08
    objs.append(
        create_mesh_object(
            "Arch_AcousticFeltWall",
            make_box_bm(3.60, wall_thick, 2.80, (0.0, wall_y + slat_d + wall_thick * 0.5, 0.05)),
            collection,
            felt_mat,
        )
    )

    # Continuous refined vertical brushed-oak slats (front face at exact wall_y so frame mounts flush!)
    bm_slats = bmesh.new()
    for i in range(-40, 41):
        sx = i * slat_pitch
        bmesh.ops.create_cube(
            bm_slats,
            size=1.0,
            matrix=_box_mat(slat_w, slat_d, slat_h, (sx, wall_y + slat_d * 0.5, 0.05)),
        )
    slats = create_mesh_object("Arch_AcousticOakSlats", bm_slats, collection, slat_mat)
    add_bevel(slats, width=0.0012, segments=2)
    objs.append(slats)

    # Clean monolithic architectural poured-concrete gallery bench/plinth below frame
    bench_z = min(-0.195, -(outer_h_m * 0.5) - 0.092)
    objs.extend(_build_monolithic_concrete_bench("Arch_SlatConcreteBench", wall_y, bench_z, collection))
    return objs
