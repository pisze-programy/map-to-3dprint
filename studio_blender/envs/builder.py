"""Orchestrator assembling any of the 11 cohesive studio environments + composable props."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

import bpy
from mathutils import Vector

from .. import materials
from ..props.registry import place_props, resolve_prop_placements
from .arch_interiors import (
    build_acoustic_slat_wall_stage,
    build_boiserie_console_wall,
    build_gallery_wall_mount_stage,
    build_living_room_backdrop,
    build_loft_shelving_wall,
)
from .arch_personas import PERSONA_ARCH_BUILDERS
from .architecture import (
    build_dark_cinematic_stage,
    build_desk_slab,
    build_seamless_cyclorama,
    build_window_gobo,
    build_window_studio_wall,
)
from .common import (
    create_mesh_object,
    get_or_create_collection,
    make_box_bm,
    parse_model_bounds,
)
from .compositor import setup_photographic_compositor
from .lighting import build_lighting_rig, build_negative_fill_flags
from .spec import get_environment_spec


def _build_desk_architecture(
    style: str,
    desk_z: float,
    surface_key: str,
    wall_key: str,
    col: Any,
) -> List[Any]:
    """Assemble tabletop slab and authentic interior room backdrop for lifestyle desk scenes."""
    persona_fn = PERSONA_ARCH_BUILDERS.get(style)
    if persona_fn is not None:
        return persona_fn(desk_z, surface_key, wall_key, col)

    objs: List[Any] = []
    desk_mat = materials.make_surface_material(surface_key, name=f"Desk_{surface_key}")
    wall_mat = materials.make_surface_material(wall_key, name=f"BackWall_{wall_key}")

    if style == "living_room":
        objs.append(build_desk_slab(f"Env_CoffeeTable_{surface_key}", desk_z, 1.40, 0.68, 0.08, desk_mat, col, thickness=0.036))
        objs.extend(build_living_room_backdrop(desk_z, wall_mat, col))
    elif style == "boiserie_console":
        objs.append(build_desk_slab(f"Env_Console_{surface_key}", desk_z, 1.75, 0.62, 0.13, desk_mat, col, thickness=0.034))
        objs.extend(build_boiserie_console_wall(desk_z, wall_mat, col))
    elif style == "loft_wall":
        objs.append(build_desk_slab(f"Env_LoftDesk_{surface_key}", desk_z, 1.95, 1.15, 0.16, desk_mat, col))
        oak_mat = materials.make_surface_material("brushed_oak", name="LoftShelfOak")
        objs.extend(build_loft_shelving_wall(desk_z, wall_mat, oak_mat, col))
    elif style in ("window_studio", "evening_window"):
        objs.append(build_desk_slab(f"Env_Desk_{surface_key}", desk_z, 1.95, 1.15, 0.16, desk_mat, col))
        objs.extend(
            build_window_studio_wall(
                desk_z=desk_z,
                wall_mat=wall_mat,
                collection=col,
                back_y=0.72,
                evening=(style == "evening_window"),
            )
        )
    else:
        objs.append(build_desk_slab(f"Env_Desk_{surface_key}", desk_z, 1.95, 1.15, 0.16, desk_mat, col))
        objs.append(create_mesh_object("Env_BackWall", make_box_bm(3.00, 0.06, 1.90, (0.0, 0.76, desk_z + 0.85)), col, wall_mat))
    return objs


def build_environment(
    env_name: str,
    model_bounds: Optional[Dict[str, Any]],
    mount: str = "auto",
    sun_azimuth_deg: Optional[float] = None,
    sun_elevation_deg: Optional[float] = None,
    surface_override: Optional[str] = None,
    window_gobo_override: Optional[str] = None,
    hdri_override: Optional[str] = None,
    light_temp: Optional[float] = None,
    add_props: Optional[Sequence[Any]] = None,
    remove_props: Optional[Sequence[str]] = None,
    clear_props: bool = False,
    is_video: bool = False,
) -> Dict[str, Any]:
    """Build one of 11 cohesive studio environments with optional surface/lighting/prop overrides."""
    spec = get_environment_spec(env_name)
    mb = parse_model_bounds(model_bounds)

    eff_mount = spec.mount if (not mount or mount.lower() == "auto") else mount.lower()
    desk_z = mb["desk_z"]
    wall_y = mb["wall_y"]
    max_z = mb["max_z"]
    outer_w = mb["outer_width_m"]
    outer_h = mb["outer_height_m"]

    target_pt = Vector((0.0, -max_z * 0.34, 0.0)) if eff_mount == "wall_mount" else Vector((0.0, 0.0, max_z * 0.34))

    col = get_or_create_collection(f"StudioEnv_{spec.env_id}")
    objects: List[Any] = []

    surface_key = (surface_override or spec.surface).lower()
    wall_key = spec.wall_material
    gobo_style = (window_gobo_override or spec.window_gobo).lower()

    # 1. Architectural room / desk / wall / stage geometry
    if eff_mount == "wall_mount":
        wall_mat = materials.make_surface_material(wall_key, name=f"Wall_{wall_key}")
        surf_mat = materials.make_surface_material(surface_key, name=f"Credenza_{surface_key}")
        if spec.architecture_style == "slat_wall":
            objects.extend(build_acoustic_slat_wall_stage(wall_y, outer_w, outer_h, surf_mat, wall_mat, col))
        else:
            objects.extend(build_gallery_wall_mount_stage(wall_y, outer_h, wall_mat, surf_mat, col))
    elif spec.architecture_style == "packshot_white":
        mat_white = materials.make_cyclorama_white_material()
        floor = create_mesh_object("Env_WhiteShadowCatcher", make_box_bm(3.20, 3.20, 0.004, (0.0, 0.0, desk_z - 0.002)), col, mat_white)
        if hasattr(floor, "is_shadow_catcher"):
            floor.is_shadow_catcher = True
        objects.append(floor)
    elif spec.architecture_style == "editorial_sweep":
        mat_ed = materials.make_editorial_backdrop_material(dark=False)
        objects.append(build_seamless_cyclorama("Env_EditorialBackdrop", desk_z, 2.40, 0.82, 1.10, mat_ed, col))
    elif spec.architecture_style == "dark_stage":
        plinth_mat = materials.make_surface_material(surface_key, name=f"Plinth_{surface_key}")
        objects.extend(build_dark_cinematic_stage(desk_z, outer_h, plinth_mat, col))
    else:
        objects.extend(_build_desk_architecture(spec.architecture_style, desk_z, surface_key, wall_key, col))

    # 2. Calibrated Cycles 3-point + CC0 HDRI World lighting
    light_refs = build_lighting_rig(
        spec=spec,
        mount=eff_mount,
        target_pt=target_pt,
        collection=col,
        sun_azimuth_deg=sun_azimuth_deg,
        sun_elevation_deg=sun_elevation_deg,
        light_temp=light_temp,
        hdri_override=hdri_override,
    )

    # 3. Architectural window mullions / blinds / dappled foliage gobo shadow caster
    if gobo_style != "none":
        meta = light_refs["key_rig_meta"]
        objects.extend(
            build_window_gobo(
                gobo_style=gobo_style,
                target_pt=target_pt,
                key_az_deg=float(meta["azimuth_deg"]),
                key_el_deg=float(meta["elevation_deg"]),
                key_dist=float(meta["distance"]),
                collection=col,
            )
        )

    # 3b. Camera-invisible matte-black negative-fill flags on persona rooms (12-17) for cinema contrast
    is_persona = spec.env_id.startswith(("12_persona_", "13_persona_", "14_persona_", "15_persona_", "16_persona_", "17_persona_"))
    if is_persona and eff_mount == "desk_flat":
        meta = light_refs["key_rig_meta"]
        objects.extend(build_negative_fill_flags(target_pt, float(meta["azimuth_deg"]), col))

    # 4. Composable real-scale props (desk_flat environments only)
    placed_props: List[Dict[str, Any]] = []
    if eff_mount == "desk_flat":
        resolved_props = resolve_prop_placements(
            default_props=spec.default_props,
            add_props=add_props,
            remove_props=remove_props,
            clear_props=clear_props,
        )
        if resolved_props:
            prop_objs, placed_props = place_props(
                placements=resolved_props,
                collection=col,
                outer_width_m=outer_w,
                outer_height_m=outer_h,
                surface_z=desk_z,
            )
            objects.extend(prop_objs)

    # 5. Blender 5.3.0 DSLR / cinema photographic compositor finishing (strictly OFF for 09/10/11)
    if spec.env_id == "07_evening_warm_desk":
        setup_photographic_compositor(
            bpy.context.scene,
            spec.env_id,
            bloom_strength=0.15,
            vignette_strength=0.075,
            grain_strength=0.011,
            warm_gain=(1.022, 1.005, 0.980),
            is_video=is_video,
        )
    elif is_persona:
        warm_study = spec.env_id in ("13_persona_traveler", "14_persona_lawyer", "17_persona_executive_study")
        setup_photographic_compositor(
            bpy.context.scene,
            spec.env_id,
            bloom_strength=0.11 if warm_study else 0.08,
            vignette_strength=0.090 if warm_study else 0.078,
            grain_strength=0.006,
            warm_gain=(1.040, 1.008, 0.960) if warm_study else (1.030, 1.006, 0.972),
            cinema_grade=True,
            cool_lift=(0.972, 0.990, 1.024) if not warm_study else (0.976, 0.990, 1.016),
            mid_gamma=(0.990, 0.995, 1.000),
            is_video=is_video,
        )
    else:
        setup_photographic_compositor(
            bpy.context.scene,
            spec.env_id,
            bloom_strength=0.055,
            vignette_strength=0.055,
            grain_strength=0.009,
            warm_gain=(1.015, 1.004, 0.986),
            is_video=is_video,
        )

    return {
        "env_name": spec.env_id,
        "mount": eff_mount,
        "spec": spec,
        "collection": col,
        "objects": objects,
        "key_light": light_refs["key_light"],
        "key_rig_meta": light_refs["key_rig_meta"],
        "fill_lights": light_refs["fill_lights"],
        "world": light_refs["world"],
        "desk_z": desk_z,
        "wall_y": wall_y,
        "placed_props": placed_props,
    }
