"""Full-3D multi-angle-safe room architectures for Customer Persona environments (12-17)."""

from __future__ import annotations

from typing import Any, Callable, Dict, List

import bmesh

from .. import materials
from ..materials_personas import make_calacatta_marble_material
from ..props.cc0_props import build_room_furniture
from ..props.persona_props import build_basswood_maquette
from .arch_personas_helpers import (
    box_mat,
    build_library_bookcase,
    build_metropolitan_skyline_backdrop,
    build_window_mullions,
)
from .architecture import build_desk_slab
from .common import add_bevel, create_area_light, create_mesh_object, make_box_bm


def build_persona_architect_room(desk_z: float, surface_key: str, wall_key: str, col: Any) -> List[Any]:
    """12_persona_architect: Sunlit architectural studio workbench, tall window, skyline bokeh."""
    desk_mat = materials.make_surface_material(surface_key, name=f"Desk_{surface_key}")
    wall_mat = materials.make_surface_material(wall_key, name=f"Wall_{wall_key}")
    objs: List[Any] = [build_desk_slab(f"Env_ArchDesk_{surface_key}", desk_z, 2.30, 1.35, 0.18, desk_mat, col, thickness=0.036)]
    win_y = 0.86
    objs.append(create_mesh_object("Arch_StudioWallLeft", make_box_bm(1.65, 0.10, 2.50, (-1.85, win_y, desk_z + 0.90)), col, wall_mat))
    objs.append(create_mesh_object("Arch_StudioWallSill", make_box_bm(3.60, 0.14, 0.45, (0.75, win_y, desk_z - 0.24)), col, wall_mat))
    objs.append(create_mesh_object("Arch_StudioWallHeader", make_box_bm(3.60, 0.10, 0.45, (0.75, win_y, desk_z + 1.82)), col, wall_mat))
    objs.extend(
        build_window_mullions(
            "ArchStudioWin", win_y + 0.02,
            (-1.02, -0.42, 0.18, 0.78, 1.38, 1.98, 2.55),
            (desk_z - 0.02, desk_z + 0.56, desk_z + 1.12, desk_z + 1.62), col,
        )
    )
    objs.extend(build_metropolitan_skyline_backdrop(desk_z, col, golden_hour=False, prefix="ArchMetro"))
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
    """15_persona_corporate: Sleek smoked-walnut desk, floor-to-ceiling high-rise curtain wall, chair."""
    desk_mat = materials.make_surface_material(surface_key, name=f"Desk_{surface_key}")
    wall_mat = materials.make_surface_material(wall_key, name=f"Column_{wall_key}")
    objs: List[Any] = [build_desk_slab(f"Env_CorpDesk_{surface_key}", desk_z, 2.35, 1.35, 0.18, desk_mat, col, thickness=0.036)]
    win_y = 0.96
    objs.append(create_mesh_object("Arch_CorpLeftPier", make_box_bm(1.10, 0.22, 2.80, (-2.25, win_y - 0.04, desk_z + 0.95)), col, wall_mat))
    objs.extend(
        build_window_mullions(
            "CorpCurtainWall", win_y,
            (-1.70, -1.08, -0.46, 0.16, 0.78, 1.40, 2.02, 2.64),
            (desk_z - 0.45, desk_z + 0.36, desk_z + 1.08, desk_z + 1.72), col,
            m_thick=0.024, m_depth=0.050,
        )
    )
    objs.extend(build_metropolitan_skyline_backdrop(desk_z, col, golden_hour=False, prefix="CorpHighrise"))
    chair_objs = build_room_furniture(
        asset_id="modern_arm_chair_01", collection=col, location=(-0.08, 0.72, desk_z - 0.62),
        yaw_deg=14.0, target_height_m=0.98, name_prefix="Room_CorpExecChair",
    )
    mat_frame = materials.make_matte_black_tech_material("CorpChairCharcoalFrame")
    for obj in chair_objs:
        if obj.type == "MESH" and obj.data is not None:
            for idx, m in enumerate(obj.data.materials):
                if m is not None and "leg" in m.name.lower():
                    obj.data.materials[idx] = mat_frame
    objs.extend(chair_objs)
    return objs


def build_persona_realestate_room(desk_z: float, surface_key: str, wall_key: str, col: Any) -> List[Any]:
    """16_persona_realestate: Honed Calacatta marble showroom table, tall windows, distant maquette."""
    desk_mat = (
        make_calacatta_marble_material("Desk_CalacattaShowroomMarble")
        if surface_key == "calacatta_marble"
        else materials.make_surface_material(surface_key, name=f"Desk_{surface_key}")
    )
    wall_mat = materials.make_surface_material(wall_key, name=f"Wall_{wall_key}")
    console_mat = materials.make_surface_material("charcoal_microcement", name="ShowroomDistantConsole")
    objs: List[Any] = [build_desk_slab("Env_ShowroomMarbleTable", desk_z, 2.30, 1.35, 0.18, desk_mat, col, thickness=0.040)]
    win_y = 1.05
    objs.append(create_mesh_object("Arch_ShowroomWallLeft", make_box_bm(2.35, 0.12, 2.70, (-1.15, win_y, desk_z + 0.95)), col, wall_mat))
    objs.append(create_mesh_object("Arch_ShowroomHeader", make_box_bm(2.80, 0.12, 0.45, (1.40, win_y, desk_z + 1.85)), col, wall_mat))
    objs.extend(
        build_window_mullions(
            "ShowroomWin", win_y + 0.02,
            (0.02, 0.64, 1.26, 1.88, 2.50),
            (desk_z - 0.45, desk_z + 0.08, desk_z + 0.88, desk_z + 1.66), col,
            m_thick=0.024, m_depth=0.050,
        )
    )
    objs.extend(build_metropolitan_skyline_backdrop(desk_z, col, golden_hour=False, prefix="ShowroomMetro"))
    cons_z = desk_z + 0.04
    cons = create_mesh_object("Arch_ShowroomConsole", make_box_bm(0.62, 0.34, 0.65, (0.58, 0.92, cons_z - 0.325)), col, console_mat)
    add_bevel(cons, width=0.003, segments=2)
    objs.append(cons)
    objs.extend(build_basswood_maquette(col, (0.56, 0.90, cons_z), yaw_deg=-24.0, scale=1.55))
    return objs


def build_persona_executive_study_room(desk_z: float, surface_key: str, wall_key: str, col: Any) -> List[Any]:
    """17_persona_executive_study: Warm dark walnut desk in front of warm-lit library bookcase."""
    desk_mat = materials.make_surface_material(surface_key, name=f"Desk_{surface_key}")
    wood_mat = materials.make_surface_material(wall_key, name=f"Bookcase_{wall_key}")
    objs: List[Any] = [build_desk_slab(f"Env_ExecStudyDesk_{surface_key}", desk_z, 2.35, 1.35, 0.18, desk_mat, col, thickness=0.040)]
    back_y = 0.82
    objs.extend(build_library_bookcase("Arch_ExecBookcase", desk_z, back_y, -2.00, 2.00, wood_mat, col, bays=5, gold_bands=True))
    for idx, lx in enumerate((-0.78, 0.12, 0.98)):
        objs.append(
            create_area_light(
                name=f"Light_ExecBookcaseGlow_{idx}", collection=col,
                location=(lx, back_y - 0.26, desk_z + 0.86), target=(lx, back_y - 0.04, desk_z + 0.22),
                energy=8.5, color=(1.0, 0.78, 0.48), size_x=0.68, size_y=0.14, spread_deg=85.0, visible_camera=False,
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
