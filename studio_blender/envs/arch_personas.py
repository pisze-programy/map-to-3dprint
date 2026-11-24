"""Full-3D multi-angle-safe room architectures for Customer Persona environments (12-17)."""

from __future__ import annotations

from typing import Any, Callable, Dict, List

import bmesh

from .. import materials
from ..materials_personas import make_calacatta_marble_material
from ..props.cc0_props import build_room_furniture
from ..props.spine_text import add_spine_label
from .arch_personas_helpers import (
    box_mat,
    build_library_bookcase,
    build_metropolitan_skyline_backdrop,
    build_window_mullions,
)
from .architecture import build_desk_slab
from .common import add_bevel, create_area_light, create_mesh_object, make_box_bm


def build_persona_architect_room(desk_z: float, surface_key: str, wall_key: str, col: Any) -> List[Any]:
    """12_persona_architect: Sunlit studio workbench + unique tall slender-mullion atelier loft window."""
    desk_mat = materials.make_surface_material(surface_key, name=f"Desk_{surface_key}")
    wall_mat = materials.make_surface_material(wall_key, name=f"Wall_{wall_key}")
    sill_mat = materials.make_surface_material("architect_oiled_oak", name="ArchAtelierWindowSill")
    objs: List[Any] = [build_desk_slab(f"Env_ArchDesk_{surface_key}", desk_z, 2.30, 1.35, 0.18, desk_mat, col, thickness=0.036)]
    win_y = 0.88
    objs.append(create_mesh_object("Arch_StudioWallLeft", make_box_bm(1.60, 0.12, 2.50, (-1.62, win_y, desk_z + 0.90)), col, wall_mat))
    objs.append(create_mesh_object("Arch_StudioWallSill", make_box_bm(3.60, 0.16, 0.48, (0.85, win_y, desk_z - 0.21)), col, wall_mat))
    sill_cap = create_mesh_object("Arch_StudioOakSillCap", make_box_bm(3.60, 0.18, 0.022, (0.85, win_y - 0.01, desk_z + 0.04)), col, sill_mat)
    add_bevel(sill_cap, width=0.002, segments=2)
    objs.append(sill_cap)
    objs.append(create_mesh_object("Arch_StudioWallHeader", make_box_bm(3.60, 0.12, 0.45, (0.85, win_y, desk_z + 1.84)), col, wall_mat))
    # Unique tall slender-mullion industrial atelier grid (tight 32 cm vertical steel muntins)
    objs.extend(
        build_window_mullions(
            "ArchAtelierWin", win_y + 0.02,
            (-0.82, -0.50, -0.18, 0.14, 0.46, 0.78, 1.10, 1.42, 1.74, 2.06),
            (desk_z + 0.05, desk_z + 0.62, desk_z + 1.18, desk_z + 1.62), col,
            m_thick=0.013, m_depth=0.034,
        )
    )
    objs.extend(build_metropolitan_skyline_backdrop(desk_z, col, golden_hour=False, prefix="ArchAtelier"))
    return objs


def build_persona_traveler_room(desk_z: float, surface_key: str, wall_key: str, col: Any) -> List[Any]:
    """13_persona_traveler: Golden-hour walnut study desk, afternoon window skyline, indoor greenery."""
    desk_mat = materials.make_surface_material(surface_key, name=f"Desk_{surface_key}")
    wall_mat = materials.make_surface_material(wall_key, name=f"Wall_{wall_key}")
    objs: List[Any] = [build_desk_slab(f"Env_TravelDesk_{surface_key}", desk_z, 2.30, 1.35, 0.18, desk_mat, col, thickness=0.038)]
    win_y = 0.92
    objs.append(create_mesh_object("Arch_TravelWallLeft", make_box_bm(1.90, 0.10, 2.50, (-1.45, win_y, desk_z + 0.90)), col, wall_mat))
    objs.append(create_mesh_object("Arch_TravelWallRight", make_box_bm(1.20, 0.10, 2.50, (2.25, win_y, desk_z + 0.90)), col, wall_mat))
    objs.append(create_mesh_object("Arch_TravelWallSill", make_box_bm(2.35, 0.14, 0.45, (0.60, win_y, desk_z - 0.22)), col, wall_mat))
    objs.append(create_mesh_object("Arch_TravelWallHeader", make_box_bm(2.35, 0.10, 0.45, (0.60, win_y, desk_z + 1.72)), col, wall_mat))
    objs.extend(
        build_window_mullions(
            "TravelWin", win_y + 0.02,
            (-0.50, 0.02, 0.56, 1.12, 1.66),
            (desk_z + 0.00, desk_z + 0.52, desk_z + 1.04, desk_z + 1.52), col,
        )
    )
    objs.extend(build_metropolitan_skyline_backdrop(desk_z, col, golden_hour=True, prefix="TravelGold"))
    objs.extend(
        build_room_furniture(
            asset_id="potted_plant_01", collection=col, location=(-0.32, 0.84, desk_z - 0.56),
            yaw_deg=24.0, target_height_m=0.94, name_prefix="Room_TravelerGreeneryLeft",
        )
    )
    return objs


def build_persona_lawyer_room(desk_z: float, surface_key: str, wall_key: str, col: Any) -> List[Any]:
    """14_persona_lawyer: Deep oiled mahogany desk, dark wood paneling, law books, tufted leather chair."""
    desk_mat = materials.make_surface_material(surface_key, name=f"Desk_{surface_key}")
    wood_mat = materials.make_surface_material(wall_key, name=f"Panel_{wall_key}")
    objs: List[Any] = [build_desk_slab(f"Env_LawyerDesk_{surface_key}", desk_z, 2.35, 1.35, 0.18, desk_mat, col, thickness=0.042)]
    back_y = 1.06
    objs.append(create_mesh_object("Arch_LawBackWall", make_box_bm(4.60, 0.08, 2.60, (0.0, back_y + 0.04, desk_z + 0.85)), col, wood_mat))
    bm_pan = bmesh.new()
    for px in (-1.25, -0.42, 0.42, 1.25):
        bmesh.ops.create_cube(bm_pan, size=1.0, matrix=box_mat(0.68, 0.022, 1.35, (px, back_y - 0.011, desk_z + 0.62)))
    panels = create_mesh_object("Arch_LawWallWainscot", bm_pan, col, wood_mat)
    add_bevel(panels, width=0.004, segments=2)
    objs.append(panels)

    objs.extend(build_library_bookcase("Arch_LawShelf", desk_z, back_y - 0.04, -1.95, 0.20, wood_mat, col, bays=3, gold_bands=True))
    objs.extend(
        build_room_furniture(
            asset_id="dining_chair_02", collection=col, location=(0.34, 0.66, desk_z - 0.50),
            yaw_deg=-24.0, target_height_m=1.02, name_prefix="Room_LawyerTuftedChair",
        )
    )
    objs.append(
        create_area_light(
            name="Light_LawyerStudyWarmWash", collection=col, location=(0.85, 0.42, desk_z + 0.92),
            target=(0.12, 0.88, desk_z + 0.24), energy=16.5, color=(1.0, 0.76, 0.46),
            size_x=0.62, size_y=0.52, spread_deg=78.0, visible_camera=False,
        )
    )
    return objs


def build_persona_corporate_room(desk_z: float, surface_key: str, wall_key: str, col: Any) -> List[Any]:
    """15_persona_corporate: Smoked-walnut executive desk + wide panoramic curtain wall w/ louvers."""
    desk_mat = materials.make_surface_material(surface_key, name=f"Desk_{surface_key}")
    wall_mat = materials.make_surface_material(wall_key, name=f"Column_{wall_key}")
    louver_mat = materials.make_anodized_aluminum_material("CorpPanoramicLouverAlu")
    objs: List[Any] = [build_desk_slab(f"Env_CorpDesk_{surface_key}", desk_z, 2.35, 1.35, 0.18, desk_mat, col, thickness=0.036)]
    win_y = 0.98
    objs.append(create_mesh_object("Arch_CorpLeftColumn", make_box_bm(0.95, 0.24, 2.80, (-1.92, win_y - 0.05, desk_z + 0.95)), col, wall_mat))
    # Wide unobstructed horizontal panoramic transom (only distant wide structural columns)
    objs.extend(
        build_window_mullions(
            "CorpPanoramicWall", win_y,
            (-1.42, 0.98, 2.42),
            (desk_z + 0.08, desk_z + 1.18), col,
            m_thick=0.032, m_depth=0.060,
        )
    )
    # Architectural upper panoramic aluminum venetian louver slats in soft bokeh
    bm_louv = bmesh.new()
    for idx in range(7):
        lz = desk_z + 0.34 + idx * 0.048
        bmesh.ops.create_cube(bm_louv, size=1.0, matrix=box_mat(3.80, 0.022, 0.005, (0.45, win_y - 0.03, lz)))
    objs.append(create_mesh_object("Arch_CorpPanoramicLouvers", bm_louv, col, louver_mat, False))
    objs.extend(build_metropolitan_skyline_backdrop(desk_z, col, golden_hour=False, prefix="CorpPanoramic"))
    return objs


def build_persona_realestate_room(desk_z: float, surface_key: str, wall_key: str, col: Any) -> List[Any]:
    """16_persona_realestate: Honed natural stone table + full-width architectural concrete wall."""
    desk_mat = (
        make_calacatta_marble_material("Desk_CalacattaShowroomMarble")
        if surface_key == "calacatta_marble"
        else materials.make_surface_material(surface_key, name=f"Desk_{surface_key}")
    )
    wall_mat = materials.make_surface_material(wall_key, name=f"Wall_{wall_key}")
    reveal_mat = materials.make_surface_material("charcoal_plaster", name="ShowroomConcreteReveal")
    objs: List[Any] = [build_desk_slab("Env_ShowroomMarbleTable", desk_z, 2.30, 1.35, 0.18, desk_mat, col, thickness=0.040)]

    back_y = 1.08
    # Continuous full-width architectural concrete back wall (5.60 m centered at X=0, ZERO mid-frame cutoff!)
    objs.append(
        create_mesh_object(
            "Arch_ShowroomConcreteBacking",
            make_box_bm(5.60, 0.14, 2.80, (0.0, back_y + 0.08, desk_z + 0.95)),
            col,
            reveal_mat,
        )
    )
    # Bevel-grooved cast architectural concrete formwork panels (4 mm recessed shadow joints)
    bm_panels = bmesh.new()
    panel_w = 0.92
    gap = 0.006
    for row_z, row_h in ((desk_z + 0.16, 0.72), (desk_z + 0.88 + gap, 0.72), (desk_z + 1.60 + 2.0 * gap, 0.72)):
        for ix in range(-3, 4):
            px = ix * (panel_w + gap)
            bmesh.ops.create_cube(
                bm_panels,
                size=1.0,
                matrix=box_mat(panel_w, 0.018, row_h, (px, back_y + 0.002, row_z)),
            )
    panels = create_mesh_object("Arch_ShowroomConcretePanels", bm_panels, col, wall_mat)
    add_bevel(panels, width=0.0022, segments=2)
    objs.append(panels)

    # Grazing side-daylight wall wash revealing troweled 2K concrete grain & formwork panel joints
    objs.append(
        create_area_light(
            name="Light_ShowroomConcreteGraze",
            collection=col,
            location=(1.65, 0.74, desk_z + 0.88),
            target=(-0.18, back_y, desk_z + 0.34),
            energy=15.0,
            color=(1.0, 0.96, 0.90),
            size_x=0.45,
            size_y=0.90,
            spread_deg=52.0,
            visible_camera=False,
        )
    )
    return objs


def build_persona_executive_study_room(desk_z: float, surface_key: str, wall_key: str, col: Any) -> List[Any]:
    """17_persona_executive_study: Warm dark walnut desk in front of warm-lit library bookcase."""
    desk_mat = materials.make_surface_material(surface_key, name=f"Desk_{surface_key}")
    wood_mat = materials.make_surface_material(wall_key, name=f"Bookcase_{wall_key}")
    objs: List[Any] = [build_desk_slab(f"Env_ExecStudyDesk_{surface_key}", desk_z, 2.35, 1.35, 0.18, desk_mat, col, thickness=0.040)]
    back_y = 0.82
    objs.extend(build_library_bookcase("Arch_ExecBookcase", desk_z, back_y, -2.00, 2.00, wood_mat, col, bays=5, gold_bands=True))
    # Subtle gold-foil architectural monograph titles on focal eye-level bookcase spines
    for idx, (lx, title) in enumerate(((-0.22, "METROPOLIS"), (-0.08, "URBAN\nFORM"), (0.04, "ARCHI-\nTECTURE"))):
        objs.append(
            add_spine_label(
                f"Arch_ExecBookTitle_{idx}", title, col,
                location=(lx, back_y - 0.195, desk_z + 0.135),
                facing="-Y", font_size_m=0.0062, font_style="sans", foil="gold", letter_spacing=1.08,
            )
        )
    for idx, lx in enumerate((-0.78, 0.12, 0.98)):
        objs.append(
            create_area_light(
                name=f"Light_ExecBookcaseGlow_{idx}", collection=col,
                location=(lx, back_y - 0.26, desk_z + 0.86), target=(lx, back_y - 0.04, desk_z + 0.22),
                energy=6.2, color=(1.0, 0.76, 0.44), size_x=0.68, size_y=0.14, spread_deg=80.0, visible_camera=False,
            )
        )
    return objs


PERSONA_ARCH_BUILDERS: Dict[str, Callable[[float, str, str, Any], List[Any]]] = {
    "persona_architect_studio": build_persona_architect_room,
    "persona_traveler_window": build_persona_traveler_room,
    "persona_lawyer_study": build_persona_lawyer_room,
    "persona_corporate_highrise": build_persona_corporate_room,
    "persona_realestate_showroom": build_persona_realestate_room,
    "persona_executive_bookcase": build_persona_executive_study_room,
}
