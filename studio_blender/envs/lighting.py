"""CC0 HDRI World loader, Kelvin color converter, and Cycles 3-point lighting controller."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

import bpy
from mathutils import Vector

from .. import assets_cc0
from ..materials_core import get_or_create_material, set_input
from .common import aim_object_at, create_area_light, create_mesh_object, make_box_bm, spherical_offset
from .spec import EnvironmentSpec


def kelvin_to_rgb(temp_k: float) -> Tuple[float, float, float]:
    """Convert color temperature in Kelvin (2200..9000K) to linear-ish warm/cool RGB tint."""
    t = max(2000.0, min(10000.0, float(temp_k))) / 100.0
    if t <= 66.0:
        r = 1.0
        g = max(0.0, min(1.0, (99.4708 * math.log(t) - 161.1196) / 255.0))
        b = 0.0 if t <= 19.0 else max(0.0, min(1.0, (138.5177 * math.log(t - 10.0) - 305.0448) / 255.0))
    else:
        r = max(0.0, min(1.0, (329.6987 * ((t - 60.0) ** -0.1332)) / 255.0))
        g = max(0.0, min(1.0, (288.1222 * ((t - 60.0) ** -0.0755)) / 255.0))
        b = 1.0
    # Convert approximate sRGB to linear light tint
    return (r ** 2.2, g ** 2.2, b ** 2.2)


def setup_world_lighting(
    hdri_id_or_path: Optional[str],
    strength: float,
    rotation_deg: float = 0.0,
    fallback_color: Tuple[float, float, float] = (0.75, 0.78, 0.82),
    camera_pure_white: bool = False,
) -> Any:
    """Configure Cycles World with cached CC0 HDRI (or clean solid fallback) and optional pure-white camera rays."""
    scene = bpy.context.scene
    world = scene.world
    if world is None:
        world = bpy.data.worlds.new("StudioWorld")
        scene.world = world
    if world.node_tree is None and hasattr(world, "use_nodes"):
        world.use_nodes = True

    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    out.location = (520, 0)

    bg = nt.nodes.new("ShaderNodeBackground")
    bg.location = (60, 80)
    bg.inputs["Strength"].default_value = float(strength)

    hdri_path = assets_cc0.ensure_hdri(hdri_id_or_path, resolution="1k") if hdri_id_or_path else None
    if hdri_path is not None:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        tc.location = (-720, 80)
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.location = (-500, 80)
        mp.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(rotation_deg))
        env_tex = nt.nodes.new("ShaderNodeTexEnvironment")
        env_tex.location = (-240, 80)
        env_tex.image = assets_cc0.load_image_cached(hdri_path, colorspace="Linear Rec.709")
        nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
        nt.links.new(mp.outputs["Vector"], env_tex.inputs["Vector"])
        nt.links.new(env_tex.outputs["Color"], bg.inputs["Color"])
    else:
        bg.inputs["Color"].default_value = (fallback_color[0], fallback_color[1], fallback_color[2], 1.0)

    if camera_pure_white:
        lp = nt.nodes.new("ShaderNodeLightPath")
        lp.location = (60, 260)
        bg_cam = nt.nodes.new("ShaderNodeBackground")
        bg_cam.location = (60, -100)
        bg_cam.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        bg_cam.inputs["Strength"].default_value = 16.0
        mix_sh = nt.nodes.new("ShaderNodeMixShader")
        mix_sh.location = (320, 40)
        nt.links.new(lp.outputs["Is Camera Ray"], mix_sh.inputs["Fac"])
        nt.links.new(bg.outputs["Background"], mix_sh.inputs[1])
        nt.links.new(bg_cam.outputs["Background"], mix_sh.inputs[2])
        nt.links.new(mix_sh.outputs["Shader"], out.inputs["Surface"])
    else:
        nt.links.new(bg.outputs["Background"], out.inputs["Surface"])

    return world


def build_lighting_rig(
    spec: EnvironmentSpec,
    mount: str,
    target_pt: Vector,
    collection: Any,
    sun_azimuth_deg: Optional[float] = None,
    sun_elevation_deg: Optional[float] = None,
    light_temp: Optional[float] = None,
    hdri_override: Optional[str] = None,
) -> Dict[str, Any]:
    """Build physics-calibrated Cycles key, fill, rim, and CC0 HDRI world lighting."""
    az = spec.key_azimuth_deg if sun_azimuth_deg is None else float(sun_azimuth_deg)
    el = spec.key_elevation_deg if sun_elevation_deg is None else float(sun_elevation_deg)
    if mount == "wall_mount":
        # Keep key light strictly on the camera/front (-Y) side of the wall so it rakes across buildings
        az = max(-78.0, min(78.0, az))
        el = max(8.0, min(72.0, el))

    dist = 1.42
    key_col = kelvin_to_rgb(light_temp) if light_temp is not None else spec.key_color

    key_light = create_area_light(
        name=f"Light_{spec.env_id}_Key",
        collection=collection,
        location=target_pt + spherical_offset(az, el, dist),
        target=target_pt,
        energy=spec.key_energy,
        color=key_col,
        size_x=spec.key_size[0],
        size_y=spec.key_size[1],
        spread_deg=spec.key_spread_deg,
        visible_camera=False,
    )
    key_rig_meta: Dict[str, Any] = {
        "target": tuple(target_pt),
        "distance": dist,
        "azimuth_deg": az,
        "elevation_deg": el,
        "mount": mount,
    }

    fill_lights: List[Any] = []
    if spec.fill_energy > 0.01:
        fill_az = -62.0 if az >= 0.0 else 62.0
        fill_el = 30.0 if mount == "desk_flat" else 16.0
        fill_l = create_area_light(
            name=f"Light_{spec.env_id}_Fill",
            collection=collection,
            location=target_pt + spherical_offset(fill_az, fill_el, 1.52),
            target=target_pt,
            energy=spec.fill_energy,
            color=spec.fill_color,
            size_x=1.15,
            size_y=0.82,
            spread_deg=105.0,
            visible_camera=False,
        )
        fill_lights.append(fill_l)

    if spec.rim_energy > 0.01 and mount == "desk_flat":
        rim_az = -128.0 if spec.env_id == "09_dark_cinematic" else (142.0 if az >= 0.0 else -142.0)
        rim_el = 56.0 if spec.env_id == "11_packshot_white" else 30.0
        rim_spread = 42.0 if spec.env_id == "09_dark_cinematic" else 70.0
        rim_l = create_area_light(
            name=f"Light_{spec.env_id}_Rim",
            collection=collection,
            location=target_pt + spherical_offset(rim_az, rim_el, 1.18),
            target=target_pt,
            energy=spec.rim_energy,
            color=spec.rim_color,
            size_x=0.65,
            size_y=0.35,
            spread_deg=rim_spread,
            visible_camera=False,
            visible_glossy=(spec.env_id != "11_packshot_white"),
        )
        fill_lights.append(rim_l)

    hdri_choice = hdri_override if hdri_override is not None else spec.hdri_id
    world = setup_world_lighting(
        hdri_id_or_path=hdri_choice,
        strength=spec.hdri_strength,
        rotation_deg=spec.hdri_rot_deg,
        camera_pure_white=(spec.architecture_style == "packshot_white"),
    )

    return {
        "key_light": key_light,
        "key_rig_meta": key_rig_meta,
        "fill_lights": fill_lights,
        "world": world,
    }


def update_key_light_azimuth(
    env_refs: Optional[Dict[str, Any]],
    azimuth_deg: float,
    elevation_deg: Optional[float] = None,
) -> Optional[Any]:
    """Smoothly orbit and aim the environment's key light around the city skyline."""
    if not env_refs:
        return None
    key_light = env_refs.get("key_light")
    meta = env_refs.get("key_rig_meta")
    if key_light is None or meta is None:
        return None

    el = float(meta["elevation_deg"]) if elevation_deg is None else float(elevation_deg)
    az = float(azimuth_deg)
    if meta.get("mount") == "wall_mount":
        az = max(-78.0, min(78.0, az))
    target = Vector(meta["target"])
    dist = float(meta["distance"])

    key_light.location = target + spherical_offset(az, el, dist)
    aim_object_at(key_light, target)
    meta["azimuth_deg"] = az
    meta["elevation_deg"] = el
    return key_light


def build_negative_fill_flags(
    target_pt: Vector,
    key_az_deg: float,
    collection: Any,
) -> List[Any]:
    """Place camera-invisible matte-black cinema flags on the shadow side for rich chiaroscuro."""
    mat, _, bsdf, _ = get_or_create_material("CinemaNegativeFillBlack")
    set_input(bsdf, "Base Color", (0.002, 0.002, 0.002, 1.0))
    set_input(bsdf, "Roughness", 1.0)
    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.0)

    opp_az = key_az_deg - 138.0 if key_az_deg >= 0.0 else key_az_deg + 138.0
    flag_specs = (
        ("Env_NegFill_Side", opp_az, 24.0, 0.92, 1.45, 0.95),
        ("Env_NegFill_Overhead", opp_az + (22.0 if key_az_deg >= 0.0 else -22.0), 62.0, 1.15, 1.35, 1.05),
    )
    flags: List[Any] = []
    for fname, az, el, dist, sx, sy in flag_specs:
        loc = target_pt + spherical_offset(az, el, dist)
        flag = create_mesh_object(fname, make_box_bm(sx, sy, 0.004), collection, material=mat, location=tuple(loc))
        aim_object_at(flag, target_pt)
        if hasattr(flag, "visible_camera"):
            flag.visible_camera = False
        if hasattr(flag, "visible_glossy"):
            flag.visible_glossy = False
        flags.append(flag)
    return flags
