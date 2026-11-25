"""Unforgiving Seam-Truth & Underside QA camera/lighting presets for Blender Cycles."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

try:
    import bpy
    from mathutils import Vector
except ImportError:  # pragma: no cover
    bpy = None  # type: ignore
    Vector = None  # type: ignore

QA_PRESETS: Tuple[str, ...] = ("qa_seam_raking", "qa_top_down_grid", "qa_underside")


def _hex_to_linear(hex_str: str) -> Tuple[float, float, float, float]:
    s = hex_str.lstrip("#")
    r, g, b = int(s[0:2], 16) / 255.0, int(s[2:4], 16) / 255.0, int(s[4:6], 16) / 255.0
    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b), 1.0)


def make_qa_tile_material(name: str, hex_color: str) -> Any:
    """Create crisp matte architectural resin QA material with zero specular glare."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = _hex_to_linear(hex_color)
    bsdf.inputs["Roughness"].default_value = 0.72
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.18
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def apply_qa_alternating_tile_tints(tile_objects: List[Any]) -> None:
    """Assign alternating subtle ivory (#F5F2EC) / cool white (#E6ECF2) tints per tile."""
    mat_even = make_qa_tile_material("QA_Ivory_F5F2EC", "#F5F2EC")
    mat_odd = make_qa_tile_material("QA_CoolWhite_E6ECF2", "#E6ECF2")
    for idx, obj in enumerate(tile_objects):
        mat = mat_even if (idx % 2 == 0) else mat_odd
        if len(obj.data.materials) == 0:
            obj.data.materials.append(mat)
        else:
            obj.data.materials[0] = mat


def configure_qa_lighting(scene: Any, preset_name: str, analysis: Dict[str, Any]) -> List[Any]:
    """Replace lights with a deterministic low-angle raking Sun rig exposing seam/chamfer truth."""
    created: List[Any] = []
    # Dim existing lights cleanly so raking shadow contrast is unambiguous
    for obj in list(bpy.data.objects):
        if obj.type == "LIGHT":
            obj.data.energy = 0.0

    # Neutral sky ambient so shadowed sides stay legible without hiding steps
    if scene.world is None:
        scene.world = bpy.data.worlds.new("QAWorld")
    scene.world.use_nodes = True
    wnt = scene.world.node_tree
    wnt.nodes.clear()
    wout = wnt.nodes.new("ShaderNodeOutputWorld")
    wbg = wnt.nodes.new("ShaderNodeBackground")
    wbg.inputs["Color"].default_value = (0.28, 0.30, 0.34, 1.0)
    wbg.inputs["Strength"].default_value = 0.45
    wnt.links.new(wbg.outputs["Background"], wout.inputs["Surface"])

    sun_data = bpy.data.lights.new(name=f"QA_RakingSun_{preset_name}", type="SUN")
    sun_obj = bpy.data.objects.new(name=f"QA_RakingSun_{preset_name}", object_data=sun_data)
    scene.collection.objects.link(sun_obj)
    created.append(sun_obj)

    if preset_name == "qa_seam_raking":
        # Ultra-low 12 deg elevation raking side-light -> any 0.05 mm step casts a clear shadow!
        sun_data.energy = 4.6
        sun_data.angle = math.radians(0.6)
        sun_data.color = (1.0, 0.96, 0.90)
        elev = math.radians(12.0)
        az = math.radians(18.0)
    elif preset_name == "qa_top_down_grid":
        sun_data.energy = 3.8
        sun_data.angle = math.radians(1.2)
        sun_data.color = (1.0, 0.98, 0.95)
        elev = math.radians(24.0)
        az = math.radians(-38.0)
    else:
        # qa_underside: illuminate from BELOW (-Z -> +Z at 18 deg raking angle)
        sun_data.energy = 4.2
        sun_data.angle = math.radians(1.0)
        sun_data.color = (0.98, 0.97, 0.95)
        elev = math.radians(-18.0)
        az = math.radians(28.0)

    # Point sun from (cos(elev)*cos(az), cos(elev)*sin(az), sin(elev)) toward origin
    dx = -math.cos(elev) * math.cos(az)
    dy = -math.cos(elev) * math.sin(az)
    dz = -math.sin(elev)
    sun_obj.rotation_euler = Vector((dx, dy, dz)).to_track_quat("-Z", "Y").to_euler()

    # Soft low fill from opposite side so grooves and chamfers remain readable
    fill_data = bpy.data.lights.new(name=f"QA_FillArea_{preset_name}", type="AREA")
    fill_data.energy = 1.8
    fill_data.size = 0.60
    fill_obj = bpy.data.objects.new(name=f"QA_FillArea_{preset_name}", object_data=fill_data)
    scene.collection.objects.link(fill_obj)
    created.append(fill_obj)
    fz = -0.35 if preset_name == "qa_underside" else 0.35
    fill_obj.location = (-0.28, -0.22, fz)
    fill_obj.rotation_euler = Vector((0.28, 0.22, -fz)).to_track_quat("-Z", "Y").to_euler()
    return created


def setup_qa_camera(
    scene: Any,
    preset_name: str,
    load_result: Dict[str, Any],
    aspect: float = 0.8,
) -> Dict[str, Any]:
    """Configure camera pose & hide backing slab/frame obstructions for QA truth renders."""
    from studio_blender import camera_rig

    cam_obj, focus_obj = camera_rig.ensure_studio_camera(scene)
    fw = max(0.04, float(load_result.get("total_width_m", 0.12)))
    fh = max(0.04, float(load_result.get("total_height_m", 0.17)))
    max_z = max(0.008, float(load_result.get("max_z_m", 0.02)))

    # Hide matte black paper backing / studio floor during qa_underside so underside grooves are unobstructed
    if preset_name == "qa_underside":
        for obj in bpy.data.objects:
            if obj.type == "MESH" and not obj.name.startswith("CityTile_"):
                obj.hide_render = True
                obj.hide_viewport = True

    if preset_name == "qa_seam_raking":
        # Aim across seam & relief with full vertical spire headroom (no summit clipping)
        target = (0.0, 0.0, max_z * 0.34)
        yaw_deg = 22.0
        elev_deg = 22.0
        lens_mm, fstop = 68.0, 16.0
        corners = camera_rig.bbox_corners(-0.5 * fw, 0.5 * fw, -0.5 * fh, 0.5 * fh, 0.0, max_z * 1.04)
        dist = max(0.24, camera_rig.compute_fit_distance(yaw_deg, elev_deg, target, corners, lens_mm, aspect, 0.92, 0.88))
        off = camera_rig.spherical_offset(yaw_deg, elev_deg, dist)
        eye = (target[0] + off[0], target[1] + off[1], target[2] + off[2])
        cam_obj.data.type = "PERSP"
    elif preset_name == "qa_top_down_grid":
        target = (0.0, 0.0, max_z * 0.25)
        eye = (0.0, -0.001, max(0.35, max(fw, fh) * 2.1))
        lens_mm, fstop = 95.0, 16.0
        cam_obj.data.type = "ORTHO"
        cam_obj.data.ortho_scale = max(fw, fh * aspect) * 1.12
    else:
        # qa_underside: look upward at Z=0 relief grid & DFM-06 chamfer from (-X, -Y, -Z)
        target = (0.0, 0.0, 0.0)
        dist = max(0.24, max(fw, fh) * 1.65)
        yaw_deg = -32.0
        elev_deg = -34.0
        off = camera_rig.spherical_offset(yaw_deg, elev_deg, dist)
        eye = (target[0] + off[0], target[1] + off[1], target[2] + off[2])
        lens_mm, fstop = 70.0, 16.0
        cam_obj.data.type = "PERSP"

    camera_rig.apply_camera_pose(
        cam_obj, focus_obj, eye, target, target,
        lens_mm=lens_mm, fstop=fstop, shift_x=0.0, shift_y=0.0, frame=None,
    )
    # Diagnostic QA cameras must be pin-sharp across the entire seam plane and spires (no DoF blur)
    cam_obj.data.dof.use_dof = False
    return {
        "preset": preset_name,
        "pose": {"eye": eye, "target": target, "lens_mm": lens_mm, "fstop": fstop},
    }
