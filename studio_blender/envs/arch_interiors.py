"""Luxury interior architecture stages: Milanese boiserie, living room, loft shelf, credenzas."""

from __future__ import annotations

from typing import Any, List, Tuple

import bmesh
from mathutils import Matrix, Vector

from .. import materials
from ..props.cad_tableware import build_arch_book, build_monograph_stack
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


def _build_credenza_cabinet(
    prefix: str,
    wall_y: float,
    top_z: float,
    oak_mat: Any,
    collection: Any,
) -> List[Any]:
    """Build full luxury natural-oak architectural sideboard credenza below wall-mounted art."""
    objs: List[Any] = []
    cw, cd, top_t = 1.72, 0.34, 0.026
    body_h = 0.64

    # Precision mitered oak top slab flush against wall_y
    top = create_mesh_object(
        f"{prefix}_Top",
        make_box_bm(cw, cd, top_t, (0.0, wall_y - cd * 0.5, top_z - top_t * 0.5)),
        collection,
        oak_mat,
    )
    add_bevel(top, width=0.0018, segments=3)
    objs.append(top)

    # Recessed cabinet carcass with minimalist vertical door shadow reveals
    body_d = cd - 0.018
    body = create_mesh_object(
        f"{prefix}_Body",
        make_box_bm(cw - 0.024, body_d, body_h, (0.0, wall_y - body_d * 0.5, top_z - top_t - body_h * 0.5)),
        collection,
        oak_mat,
    )
    objs.append(body)

    # Four subtle front cabinet door panels with crisp shadow gaps
    door_w = (cw - 0.056) * 0.25
    door_h = body_h - 0.020
    door_y = wall_y - body_d - 0.009
    door_z = top_z - top_t - 0.010 - door_h * 0.5
    bm_doors = bmesh.new()
    for i in range(4):
        dx = -(cw - 0.056) * 0.5 + (i + 0.5) * door_w
        bmesh.ops.create_cube(
            bm_doors,
            size=1.0,
            matrix=_box_mat(door_w - 0.005, 0.014, door_h, (dx, door_y, door_z)),
        )
    doors = create_mesh_object(f"{prefix}_Doors", bm_doors, collection, oak_mat)
    add_bevel(doors, width=0.0012, segments=2)
    objs.append(doors)
    return objs


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


def build_gallery_wall_mount_stage(
    wall_y: float,
    outer_h_m: float,
    wall_mat: Any,
    credenza_mat: Any,
    collection: Any,
) -> List[Any]:
    """Build luminous Venetian plaster gallery wall + Milanese boiserie + styled oak credenza."""
    objs: List[Any] = []
    wall_thick = 0.08
    objs.append(
        create_mesh_object(
            "Arch_GalleryWall",
            make_box_bm(3.40, wall_thick, 2.60, (0.0, wall_y + wall_thick * 0.5, 0.10)),
            collection,
            wall_mat,
        )
    )

    # Refined delicate Milanese boiserie molding framing the 13x18 NYC artwork generously
    bm_trim = bmesh.new()
    _add_boiserie_panel_bm(bm_trim, 0.0, 0.032, 0.52, 0.40, wall_y, trim_w=0.011, trim_d=0.008)
    _add_boiserie_panel_bm(bm_trim, -0.60, 0.032, 0.52, 0.40, wall_y, trim_w=0.011, trim_d=0.008)
    _add_boiserie_panel_bm(bm_trim, 0.60, 0.032, 0.52, 0.40, wall_y, trim_w=0.011, trim_d=0.008)
    trim = create_mesh_object("Arch_GalleryBoiserie", bm_trim, collection, wall_mat)
    add_bevel(trim, width=0.0012, segments=2)
    objs.append(trim)

    # Full brushed-oak credenza visibly anchored in the lower third (Z = -0.175 m)
    cred_z = min(-0.175, -(outer_h_m * 0.5) - 0.095)
    objs.extend(_build_credenza_cabinet("Arch_GalleryCredenza", wall_y, cred_z, credenza_mat, collection))

    # Styled Architectural Digest objects on credenza with generous air around the 13x18 frame
    prop_y = wall_y - 0.155
    objs.extend(build_cc0_prop("ceramic_vessel", "ceramic_vase_01", 0.145, collection, (-0.215, prop_y, cred_z), yaw_deg=15.0))
    objs.extend(build_cc0_prop("ceramic_vessel_low", "ceramic_vase_02", 0.082, collection, (-0.148, prop_y + 0.045, cred_z), yaw_deg=-25.0))
    objs.extend(build_monograph_stack(collection, (0.172, prop_y + 0.015, cred_z), yaw_deg=-8.0, scale=0.80))
    objs.extend(build_cc0_prop("potted_plant", "potted_plant_04", 0.210, collection, (0.252, prop_y - 0.010, cred_z), yaw_deg=-30.0))
    return objs


def build_acoustic_slat_wall_stage(
    wall_y: float,
    outer_w_m: float,
    outer_h_m: float,
    slat_mat: Any,
    backing_mat: Any,
    collection: Any,
) -> List[Any]:
    """Build Copenhagen warm greige plaster & honey-oak acoustic slat wall + styled oak credenza."""
    objs: List[Any] = []
    wall_thick = 0.08
    objs.append(
        create_mesh_object(
            "Arch_GreigeBackingWall",
            make_box_bm(3.40, wall_thick, 2.60, (0.0, wall_y + wall_thick * 0.5, 0.10)),
            collection,
            backing_mat,
        )
    )

    # Warm honey-oak vertical acoustic slats framing a clean recessed warm-greige gallery niche
    slat_w = 0.025
    slat_d = 0.018
    slat_pitch = 0.039
    slat_h = 2.40
    clear_half_x = max(0.112, outer_w_m * 0.5 + 0.042)

    bm_slats = bmesh.new()
    for i in range(-32, 33):
        sx = i * slat_pitch
        if abs(sx) < clear_half_x:
            continue
        bmesh.ops.create_cube(
            bm_slats,
            size=1.0,
            matrix=_box_mat(slat_w, slat_d, slat_h, (sx, wall_y - slat_d * 0.5, 0.10)),
        )
    slats = create_mesh_object("Arch_AcousticOakSlats", bm_slats, collection, slat_mat)
    add_bevel(slats, width=0.0012, segments=2)
    objs.append(slats)

    # Matching brushed-oak architectural credenza cleanly visible at Z = -0.175 m
    cred_z = min(-0.175, -(outer_h_m * 0.5) - 0.095)
    objs.extend(_build_credenza_cabinet("Arch_SlatWallCredenza", wall_y, cred_z, slat_mat, collection))

    # Scandinavian organic ceramics & linen book styling on credenza with generous space around frame
    prop_y = wall_y - 0.155
    objs.extend(build_cc0_prop("ceramic_vessel_tall", "ceramic_vase_01", 0.165, collection, (-0.205, prop_y, cred_z), yaw_deg=18.0))
    objs.extend(build_cc0_prop("wooden_bowl", "wooden_bowl_01", 0.040, collection, (-0.105, prop_y + 0.040, cred_z), yaw_deg=20.0))
    objs.extend(build_arch_book(collection, (0.170, prop_y + 0.015, cred_z), yaw_deg=6.0, scale=0.82))
    objs.extend(build_cc0_prop("ceramic_vessel_low", "ceramic_vase_02", 0.105, collection, (0.220, prop_y - 0.010, cred_z), yaw_deg=-18.0))
    return objs
