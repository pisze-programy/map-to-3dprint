"""CC0 photogrammetry and external custom 3D prop loaders for studio_blender."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from mathutils import Euler, Vector

from .. import assets_cc0, materials
from ..envs.common import (
    create_mesh_object,
    make_lathe_bm,
    parent_objects_to_empty,
)
from ..materials_core import get_or_create_material


_VESSEL_GLAZE_COLORS: Dict[str, Tuple[str, Tuple[float, float, float, float]]] = {
    "ceramic_vessel": ("CC0StonewareOatmeal", (0.42, 0.36, 0.29, 1.0)),
    "ceramic_vessel_low": ("CC0BisqueSandVessel", (0.64, 0.58, 0.50, 1.0)),
    "ceramic_vessel_tall": ("CC0StonewareTaupe", (0.22, 0.18, 0.15, 1.0)),
}


def _make_warm_bulb_material(name: str = "DeskLampWarmBulb") -> Any:
    """Warm 2600K incandescent bulb emitter tucked inside the desk lamp dome."""
    mat, nt, _, out = get_or_create_material(name)
    em = nt.nodes.new("ShaderNodeEmission")
    em.location = (180, 0)
    em.inputs["Color"].default_value = (1.0, 0.72, 0.40, 1.0)
    em.inputs["Strength"].default_value = 14.0
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return mat


def _build_ceramic_vessel_fallback(
    name: str,
    collection: Any,
    location: Tuple[float, float, float],
    yaw_deg: float,
    scale: float,
    color: Tuple[float, float, float, float] = (0.58, 0.51, 0.43, 1.0),
) -> List[Any]:
    """Sculptural matte stoneware vessel fallback if Poly Haven glTF is offline."""
    profile = [
        (0.028, 0.000),
        (0.031, 0.004),
        (0.044, 0.028),
        (0.048, 0.062),
        (0.042, 0.098),
        (0.028, 0.128),
        (0.024, 0.146),
        (0.026, 0.156),
        (0.023, 0.158),
        (0.021, 0.154),
        (0.022, 0.132),
    ]
    mat = materials.make_ceramic_vessel_material(name=f"{name}_FallbackStone", color=color)
    bm = make_lathe_bm(profile, segments=64, cap_bottom=True, cap_top=True)
    vase = create_mesh_object(f"{name}_Vessel", bm, collection, material=mat, smooth=True)
    root = parent_objects_to_empty(f"{name}_Root", [vase], collection, location=location, rotation_z_deg=yaw_deg, scale=scale)
    return [root, vase]


def _build_desk_lamp_fallback(
    name: str,
    collection: Any,
    location: Tuple[float, float, float],
    yaw_deg: float,
    scale: float,
) -> List[Any]:
    """Minimalist Dieter-Rams-inspired matte-black and brass architectural desk lamp."""
    mat_blk = materials.make_matte_black_tech_material(name="DeskLampMatteBlack")
    mat_brass = materials.make_brass_metal_material(name="DeskLampBrass")
    mat_bulb = _make_warm_bulb_material()

    base_bm = make_lathe_bm([(0.056, 0.0), (0.056, 0.010), (0.053, 0.013), (0.012, 0.015)], segments=48, cap_bottom=True, cap_top=True)
    base = create_mesh_object(f"{name}_Base", base_bm, collection, material=mat_blk, smooth=True)

    stem_bm = make_lathe_bm([(0.0055, 0.013), (0.0050, 0.245)], segments=24, cap_bottom=True, cap_top=True)
    stem = create_mesh_object(f"{name}_Stem", stem_bm, collection, material=mat_blk, smooth=True, rotation=(0.0, math.radians(-14.0), 0.0))

    shade_bm = make_lathe_bm(
        [(0.010, 0.0), (0.046, -0.022), (0.060, -0.056), (0.058, -0.058), (0.043, -0.024), (0.008, -0.002)],
        segments=48,
        cap_bottom=False,
        cap_top=True,
    )
    shade = create_mesh_object(
        f"{name}_Shade",
        shade_bm,
        collection,
        material=mat_blk,
        smooth=True,
        location=(0.072, 0.0, 0.232),
        rotation=(0.0, math.radians(-26.0), 0.0),
    )

    bulb_bm = make_lathe_bm(
        [(0.001, -0.006), (0.014, -0.012), (0.018, -0.024), (0.012, -0.036), (0.001, -0.040)],
        segments=24,
        cap_bottom=True,
        cap_top=True,
    )
    bulb = create_mesh_object(
        f"{name}_WarmBulb",
        bulb_bm,
        collection,
        material=mat_bulb,
        smooth=True,
        location=(0.072, 0.0, 0.232),
        rotation=(0.0, math.radians(-26.0), 0.0),
    )

    joint_bm = make_lathe_bm([(0.0075, -0.009), (0.0075, 0.009)], segments=24, cap_bottom=True, cap_top=True)
    joint = create_mesh_object(
        f"{name}_Joint",
        joint_bm,
        collection,
        material=mat_brass,
        smooth=True,
        location=(0.064, 0.0, 0.236),
        rotation=(math.pi * 0.5, 0.0, 0.0),
    )

    objs = [base, stem, shade, bulb, joint]
    root = parent_objects_to_empty(f"{name}_Root", objs, collection, location=location, rotation_z_deg=yaw_deg, scale=scale)
    return [root] + objs


def build_cc0_prop(
    prop_id: str,
    asset_id: str,
    target_height_m: float,
    collection: Any,
    location: Tuple[float, float, float],
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Import a cached CC0 Poly Haven glTF prop grounded at location with cohesive styling."""
    name = f"Prop_{prop_id}"
    if prop_id == "desk_lamp_edge":
        return _build_desk_lamp_fallback(name, collection, location, yaw_deg, scale)

    gltf_path = assets_cc0.ensure_gltf_model(asset_id, resolution="1k")
    if gltf_path is not None:
        root, meshes = assets_cc0.import_external_prop(
            filepath=gltf_path,
            collection=collection,
            name_prefix=name,
            target_height_m=target_height_m,
            scale_factor=scale,
        )
        if root is not None:
            root.location = Vector(location)
            root.rotation_euler = Euler((0.0, 0.0, math.radians(yaw_deg)), "XYZ")
            glaze = _VESSEL_GLAZE_COLORS.get(prop_id)
            if glaze is not None:
                mat_stone = materials.make_ceramic_vessel_material(name=glaze[0], color=glaze[1])
                for mobj in meshes:
                    mobj.data.materials.clear()
                    mobj.data.materials.append(mat_stone)
            return [root] + meshes

    glaze = _VESSEL_GLAZE_COLORS.get(prop_id)
    fallback_col = glaze[1] if glaze is not None else (0.58, 0.51, 0.43, 1.0)
    return _build_ceramic_vessel_fallback(name, collection, location, yaw_deg, scale, color=fallback_col)


def build_room_furniture(
    asset_id: str,
    collection: Any,
    location: Tuple[float, float, float],
    yaw_deg: float = 0.0,
    scale: float = 1.0,
    target_height_m: Optional[float] = None,
    name_prefix: Optional[str] = None,
    override_material: Any = None,
) -> List[Any]:
    """Import a full-scale CC0 furniture or greenery model for background room depth."""
    gltf_path = assets_cc0.ensure_gltf_model(asset_id, resolution="1k")
    if gltf_path is None:
        return []
    prefix = name_prefix or f"Room_{asset_id}"
    root, meshes = assets_cc0.import_external_prop(
        filepath=gltf_path,
        collection=collection,
        name_prefix=prefix,
        target_height_m=target_height_m,
        scale_factor=scale,
    )
    if root is None:
        return []
    root.location = Vector(location)
    root.rotation_euler = Euler((0.0, 0.0, math.radians(yaw_deg)), "XYZ")
    if override_material is not None:
        for mobj in meshes:
            mobj.data.materials.clear()
            mobj.data.materials.append(override_material)
    return [root] + meshes


def build_custom_prop(
    filepath: str,
    collection: Any,
    location: Tuple[float, float, float],
    yaw_deg: float = 0.0,
    scale: float = 1.0,
    target_height_m: Optional[float] = None,
) -> List[Any]:
    """Import any external user 3D prop (.glb/.gltf/.obj/.stl/.blend) cleanly onto desk_z."""
    p = Path(filepath).expanduser()
    stem = p.stem[:24] if p.stem else "CustomProp"
    root, meshes = assets_cc0.import_external_prop(
        filepath=p,
        collection=collection,
        name_prefix=f"Custom_{stem}",
        target_height_m=target_height_m,
        scale_factor=scale,
    )
    if root is None:
        return []
    root.location = Vector(location)
    root.rotation_euler = Euler((0.0, 0.0, math.radians(yaw_deg)), "XYZ")
    return [root] + meshes
