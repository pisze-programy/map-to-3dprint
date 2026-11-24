"""Sunlit chalk-plaster architectural detail gallery stage and razor-sharp Sun lighting."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

import bpy
from mathutils import Vector

from ..materials_detail import make_detail_bounce_floor_material
from .common import aim_object_at, create_mesh_object, make_box_bm, spherical_offset
from .lighting import kelvin_to_rgb

# Default physical solar disc & cross-raking side sun for sculptural architectural shadows
DEFAULT_SUN_AZIMUTH_DEG = 96.0
DEFAULT_SUN_ELEVATION_DEG = 25.0
DEFAULT_SUN_ANGLE_DEG = 0.50
DEFAULT_SUN_ENERGY = 9.6
DEFAULT_SUN_COLOR = (1.0, 0.988, 0.968)
DEFAULT_SKY_BOUNCE_STRENGTH = 0.20


def _build_detail_gallery_world(bounce_strength: float = DEFAULT_SKY_BOUNCE_STRENGTH) -> Any:
    """Create dual-ray Cycles World: pure #FFFFFF camera horizon + low cool architectural bounce.

    Camera rays see luminous gallery white (#FFFFFF) so low-angle horizons vanish seamlessly;
    diffuse and glossy bounce rays receive subtle cool-neutral architectural sky fill so
    sunlit chalk facades pop sharply against deep, crisp diagonal shadows.
    """
    scene = bpy.context.scene
    world = scene.world
    if world is None:
        world = bpy.data.worlds.new("DetailChalkWorld")
        scene.world = world
    if world.node_tree is None and hasattr(world, "use_nodes"):
        world.use_nodes = True

    nt = world.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputWorld")
    out.location = (560, 0)

    # Subtle vertical cool-sky -> crisp-horizon gradient for diffuse shadow bounce
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (-740, 120)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-540, 120)
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])

    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-320, 120)
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.94, 0.95, 0.97, 1.0)
    ramp.color_ramp.elements[1].position = 0.65
    ramp.color_ramp.elements[1].color = (0.80, 0.87, 0.99, 1.0)
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])

    bg_bounce = nt.nodes.new("ShaderNodeBackground")
    bg_bounce.location = (40, 120)
    bg_bounce.inputs["Strength"].default_value = float(bounce_strength)
    nt.links.new(ramp.outputs["Color"], bg_bounce.inputs["Color"])

    # Camera-ray pure luminous gallery #FFFFFF sky/horizon (guaranteed white under AgX)
    bg_cam = nt.nodes.new("ShaderNodeBackground")
    bg_cam.location = (40, -100)
    bg_cam.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bg_cam.inputs["Strength"].default_value = 16.0

    lp = nt.nodes.new("ShaderNodeLightPath")
    lp.location = (40, 290)

    mix_sh = nt.nodes.new("ShaderNodeMixShader")
    mix_sh.location = (320, 40)
    nt.links.new(lp.outputs["Is Camera Ray"], mix_sh.inputs["Fac"])
    nt.links.new(bg_bounce.outputs["Background"], mix_sh.inputs[1])
    nt.links.new(bg_cam.outputs["Background"], mix_sh.inputs[2])
    nt.links.new(mix_sh.outputs["Shader"], out.inputs["Surface"])
    return world


def _create_architectural_sun(
    target_pt: Vector,
    collection: Any,
    azimuth_deg: float,
    elevation_deg: float,
    energy: float = DEFAULT_SUN_ENERGY,
    angle_deg: float = DEFAULT_SUN_ANGLE_DEG,
    color: tuple[float, float, float] = DEFAULT_SUN_COLOR,
) -> Any:
    """Create a razor-sharp physical Sun lamp casting crisp parallel architectural shadows."""
    sun_data = bpy.data.lights.new(name="Light_18_detail_chalk_gallery_Sun", type="SUN")
    sun_data.energy = float(energy)
    sun_data.color = color
    sun_data.angle = math.radians(max(0.25, float(angle_deg)))

    sun_obj = bpy.data.objects.new(name="Light_18_detail_chalk_gallery_Sun", object_data=sun_data)
    collection.objects.link(sun_obj)
    sun_obj.location = target_pt + spherical_offset(azimuth_deg, elevation_deg, 2.0)
    aim_object_at(sun_obj, target_pt)
    return sun_obj


def build_detail_chalk_stage(
    desk_z: float,
    target_pt: Vector,
    collection: Any,
    sun_azimuth_deg: Optional[float] = None,
    sun_elevation_deg: Optional[float] = None,
    light_temp: Optional[float] = None,
) -> Dict[str, Any]:
    """Build pure sunlit architectural detail stage + hard 0.55 deg raking sunlight rig.

    Returns the standard lighting/stage dictionary expected by studio_blender/envs/builder.py:
    {"objects", "key_light", "key_rig_meta", "fill_lights", "world"}.
    """
    az = DEFAULT_SUN_AZIMUTH_DEG if sun_azimuth_deg is None else float(sun_azimuth_deg)
    el = DEFAULT_SUN_ELEVATION_DEG if sun_elevation_deg is None else float(sun_elevation_deg)
    sun_col = kelvin_to_rgb(light_temp) if light_temp is not None else DEFAULT_SUN_COLOR

    # Camera-invisible indirect chalk-white floor bounce keeps exterior horizon 100% pure #FFFFFF
    # (zero distracting grey horizon line or shadow tail) while subtly bouncing upward light into
    # deep architectural street canyons.
    bounce_mat = make_detail_bounce_floor_material()
    bounce_floor = create_mesh_object(
        "Env_DetailChalkBounceFloor",
        make_box_bm(3.60, 3.60, 0.004, (0.0, 0.0, float(desk_z) - 0.003)),
        collection,
        material=bounce_mat,
        smooth=False,
    )
    if hasattr(bounce_floor, "visible_camera"):
        bounce_floor.visible_camera = False
    if hasattr(bounce_floor, "visible_glossy"):
        bounce_floor.visible_glossy = False
    if hasattr(bounce_floor, "visible_shadow"):
        bounce_floor.visible_shadow = False

    sun_obj = _create_architectural_sun(
        target_pt=target_pt,
        collection=collection,
        azimuth_deg=az,
        elevation_deg=el,
        energy=DEFAULT_SUN_ENERGY,
        angle_deg=DEFAULT_SUN_ANGLE_DEG,
        color=sun_col,
    )
    world = _build_detail_gallery_world(bounce_strength=DEFAULT_SKY_BOUNCE_STRENGTH)

    objects: List[Any] = [bounce_floor]
    return {
        "objects": objects,
        "key_light": sun_obj,
        "key_rig_meta": {
            "target": tuple(target_pt),
            "distance": 2.0,
            "azimuth_deg": az,
            "elevation_deg": el,
            "mount": "desk_flat",
        },
        "fill_lights": [],
        "world": world,
    }


__all__ = [
    "DEFAULT_SKY_BOUNCE_STRENGTH",
    "DEFAULT_SUN_ANGLE_DEG",
    "DEFAULT_SUN_AZIMUTH_DEG",
    "DEFAULT_SUN_COLOR",
    "DEFAULT_SUN_ELEVATION_DEG",
    "DEFAULT_SUN_ENERGY",
    "build_detail_chalk_stage",
]
