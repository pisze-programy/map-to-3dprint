"""CC0 PBR seamless architectural surface, wall, backdrop, and volumetric haze materials."""

from __future__ import annotations

from typing import Any, Dict, Tuple

import bpy

from .assets_cc0 import build_cc0_pbr_material
from .materials_personas import PERSONA_SURFACE_CATALOG, make_calacatta_marble_material
from .materials_core import (
    add_map_range,
    add_mix_color,
    add_tex_coord_mapping,
    get_input,
    get_or_create_material,
    set_input,
)

# Registry mapping surface keys -> seamless Poly Haven CC0 2K texture parameters
# NOTE: basalt_plinth, editorial_sweep, packshot_white are LOCKED for 09/10/11!
SURFACE_CATALOG: Dict[str, Dict[str, Any]] = {
    "pale_ash_oak": {
        "asset_id": "ash_veneer",
        "tile_scale_m": 0.72,
        "tint_rgb": (0.94, 0.90, 0.84),
        "tint_factor": 0.25,
        "roughness_range": (0.44, 0.62),
        "normal_strength": 0.34,
        "specular_level": 0.24,
        "fallback_rgb": (0.56, 0.45, 0.34),
    },
    "honed_sandstone": {
        "asset_id": "plaster_grey_04",
        "tile_scale_m": 0.92,
        "tint_rgb": (0.90, 0.85, 0.77),
        "tint_factor": 0.78,
        "roughness_range": (0.48, 0.68),
        "normal_strength": 0.14,
        "specular_level": 0.24,
        "fallback_rgb": (0.64, 0.58, 0.50),
    },
    "oiled_walnut": {
        "asset_id": "american_walnut_veneer",
        "tile_scale_m": 0.72,
        "tint_rgb": (0.24, 0.125, 0.062),
        "tint_factor": 0.94,
        "roughness_range": (0.34, 0.50),
        "normal_strength": 0.36,
        "specular_level": 0.28,
        "fallback_rgb": (0.12, 0.065, 0.035),
    },
    "brushed_oak": {
        "asset_id": "oak_veneer_01",
        "tile_scale_m": 0.68,
        "tint_rgb": (0.92, 0.85, 0.76),
        "tint_factor": 0.28,
        "roughness_range": (0.44, 0.62),
        "normal_strength": 0.38,
        "specular_level": 0.24,
        "fallback_rgb": (0.42, 0.30, 0.18),
    },
    "warm_ivory_plaster": {
        "asset_id": "plaster_grey_04",
        "tile_scale_m": 1.45,
        "tint_rgb": (0.88, 0.85, 0.79),
        "tint_factor": 0.82,
        "blend_mode": "MIX",
        "desaturate": True,
        "roughness_range": (0.84, 0.92),
        "normal_strength": 0.035,
        "specular_level": 0.14,
        "fallback_rgb": (0.84, 0.81, 0.75),
    },
    "warm_greige_stone": {
        "asset_id": "plaster_grey_04",
        "tile_scale_m": 1.35,
        "tint_rgb": (0.58, 0.54, 0.49),
        "tint_factor": 0.80,
        "blend_mode": "MIX",
        "desaturate": True,
        "roughness_range": (0.78, 0.88),
        "normal_strength": 0.04,
        "specular_level": 0.15,
        "fallback_rgb": (0.52, 0.48, 0.43),
    },
    "pale_terrazzo": {
        "asset_id": "plaster_grey_04",
        "tile_scale_m": 0.88,
        "tint_rgb": (0.82, 0.79, 0.74),
        "tint_factor": 0.72,
        "blend_mode": "MIX",
        "desaturate": True,
        "roughness_range": (0.44, 0.62),
        "normal_strength": 0.09,
        "specular_level": 0.26,
        "fallback_rgb": (0.72, 0.69, 0.64),
    },
    "dark_wool_felt": {
        "asset_id": "rough_linen",
        "tile_scale_m": 0.18,
        "tint_rgb": (0.035, 0.038, 0.042),
        "tint_factor": 0.94,
        "blend_mode": "MIX",
        "desaturate": True,
        "roughness_range": (0.88, 0.96),
        "normal_strength": 0.35,
        "specular_level": 0.08,
        "fallback_rgb": (0.030, 0.032, 0.036),
    },
    "cream_boucle": {
        "asset_id": "rough_linen",
        "tile_scale_m": 0.36,
        "tint_rgb": (0.82, 0.78, 0.71),
        "tint_factor": 0.88,
        "blend_mode": "MIX",
        "desaturate": True,
        "roughness_range": (0.86, 0.95),
        "normal_strength": 0.42,
        "specular_level": 0.10,
        "fallback_rgb": (0.80, 0.76, 0.70),
    },
    "travertine": {
        "asset_id": "plaster_grey_04",
        "tile_scale_m": 1.05,
        "tint_rgb": (0.88, 0.83, 0.74),
        "tint_factor": 0.76,
        "roughness_range": (0.48, 0.68),
        "normal_strength": 0.15,
        "specular_level": 0.24,
        "fallback_rgb": (0.60, 0.54, 0.45),
    },
    "limestone": {
        "asset_id": "plaster_grey_04",
        "tile_scale_m": 0.95,
        "tint_rgb": (0.90, 0.86, 0.79),
        "tint_factor": 0.74,
        "roughness_range": (0.50, 0.70),
        "normal_strength": 0.14,
        "specular_level": 0.22,
        "fallback_rgb": (0.64, 0.59, 0.52),
    },
    "dark_walnut": {
        "asset_id": "american_walnut_veneer",
        "tile_scale_m": 0.72,
        "tint_rgb": (0.46, 0.34, 0.24),
        "tint_factor": 0.55,
        "roughness_range": (0.36, 0.54),
        "normal_strength": 0.38,
        "specular_level": 0.26,
        "fallback_rgb": (0.14, 0.085, 0.050),
    },
    "limewash_wall": {
        "asset_id": "plaster_grey_04",
        "tile_scale_m": 1.35,
        "tint_rgb": (0.95, 0.92, 0.87),
        "tint_factor": 0.62,
        "roughness_range": (0.82, 0.92),
        "normal_strength": 0.07,
        "specular_level": 0.14,
        "fallback_rgb": (0.78, 0.75, 0.70),
    },
    "charcoal_plaster": {
        "asset_id": "plaster_grey_04",
        "tile_scale_m": 1.10,
        "tint_rgb": (0.14, 0.145, 0.155),
        "tint_factor": 0.94,
        "roughness_range": (0.80, 0.90),
        "normal_strength": 0.10,
        "specular_level": 0.14,
        "fallback_rgb": (0.07, 0.072, 0.078),
    },
    "charcoal_microcement": {
        "asset_id": "plaster_grey_04",
        "tile_scale_m": 0.85,
        "tint_rgb": (0.16, 0.165, 0.178),
        "tint_factor": 0.92,
        "roughness_range": (0.56, 0.74),
        "normal_strength": 0.16,
        "specular_level": 0.18,
        "fallback_rgb": (0.09, 0.092, 0.10),
    },
    "poured_concrete": {
        "asset_id": "plaster_grey_04",
        "tile_scale_m": 0.92,
        "tint_rgb": (0.82, 0.81, 0.78),
        "tint_factor": 0.65,
        "roughness_range": (0.52, 0.70),
        "normal_strength": 0.15,
        "specular_level": 0.22,
        "fallback_rgb": (0.62, 0.60, 0.57),
    },
    "basalt_plinth": {
        "asset_id": "slate_floor",
        "tile_scale_m": 0.72,
        "tint_rgb": (0.14, 0.145, 0.16),
        "tint_factor": 0.88,
        "roughness_range": (0.58, 0.84),
        "normal_strength": 0.60,
        "specular_level": 0.22,
        "fallback_rgb": (0.015, 0.017, 0.020),
    },
}

SURFACE_CATALOG.update(PERSONA_SURFACE_CATALOG)

AVAILABLE_SURFACES: Tuple[str, ...] = tuple(SURFACE_CATALOG.keys()) + ("calacatta_marble",)


def _make_procedural_surface_fallback(
    name: str,
    rgb: Tuple[float, float, float],
    rough_range: Tuple[float, float],
    spec: float,
) -> Any:
    """Graceful offline procedural stone/plaster/wood fallback if CC0 maps are unavailable."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-880, 0))
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.location = (-620, 60)
    n.inputs["Scale"].default_value = 14.0
    n.inputs["Detail"].default_value = 7.0
    n.inputs["Roughness"].default_value = 0.60
    nt.links.new(mp.outputs["Vector"], n.inputs["Vector"])

    _, fac_c, col_a, col_b, col_out = add_mix_color(nt, "MIX", loc=(-260, 180))
    col_a.default_value = (rgb[0] * 0.88, rgb[1] * 0.88, rgb[2] * 0.88, 1.0)
    col_b.default_value = (min(1.0, rgb[0] * 1.08), min(1.0, rgb[1] * 1.08), min(1.0, rgb[2] * 1.08), 1.0)
    mr_c = add_map_range(nt, 0.30, 0.70, 0.0, 1.0, loc=(-420, 180))
    nt.links.new(n.outputs["Fac"], mr_c.inputs["Value"])
    nt.links.new(mr_c.outputs["Result"], fac_c)
    nt.links.new(col_out, get_input(bsdf, "Base Color"))

    mr_r = add_map_range(nt, 0.25, 0.75, rough_range[0], rough_range[1], loc=(-240, -20))
    nt.links.new(n.outputs["Fac"], mr_r.inputs["Value"])
    nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-80, -180)
    bump.inputs["Strength"].default_value = 0.07
    bump.inputs["Distance"].default_value = 0.0005
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))
    set_input(bsdf, ("Specular IOR Level", "Specular"), spec)
    return mat


def make_surface_material(surface_key: str, name: str | None = None, rotation_z_rad: float = 0.0) -> Any:
    """Build a CC0 2K PBR architectural surface material with automatic procedural fallback."""
    key = (surface_key or "pale_ash_oak").lower()
    if key == "editorial_sweep":
        return make_editorial_backdrop_material(name=name or "EditorialBackdrop", dark=False)
    if key == "packshot_white":
        return make_cyclorama_white_material(name=name or "PackshotWhiteCyclorama")
    if key == "calacatta_marble":
        return make_calacatta_marble_material(name=name or "CalacattaShowroomMarble")

    spec = SURFACE_CATALOG.get(key, SURFACE_CATALOG["pale_ash_oak"])
    mat_name = name or f"Surface_{key}"
    cc0_mat = build_cc0_pbr_material(
        name=mat_name,
        asset_id=str(spec["asset_id"]),
        tile_scale_m=float(spec["tile_scale_m"]),
        tint_rgb=spec["tint_rgb"],
        tint_factor=float(spec["tint_factor"]),
        roughness_range=spec["roughness_range"],
        normal_strength=float(spec["normal_strength"]),
        specular_level=float(spec["specular_level"]),
        rotation_z_rad=rotation_z_rad,
        blend_mode=str(spec.get("blend_mode", "MULTIPLY")),
        desaturate=bool(spec.get("desaturate", False)),
    )
    if cc0_mat is not None:
        return cc0_mat
    return _make_procedural_surface_fallback(
        name=mat_name,
        rgb=spec["fallback_rgb"],
        rough_range=spec["roughness_range"],
        spec=float(spec["specular_level"]),
    )


def make_slate_stone_material(name: str = "DarkHonedSlate") -> Any:
    """Dark honed volcanic basalt/slate tabletop (09_dark_cinematic)."""
    return make_surface_material("basalt_plinth", name=name)


def make_plaster_wall_material(name: str = "SunlitPlasterWall") -> Any:
    """Smooth warm Milanese ivory Venetian plaster wall."""
    return make_surface_material("warm_ivory_plaster", name=name)


def make_oak_wood_material(name: str = "BrushedMatteOak", warm_tone: bool = False) -> Any:
    """Brushed honey oak or oiled American walnut surface."""
    return make_surface_material("oiled_walnut" if warm_tone else "brushed_oak", name=name)


def make_walnut_wood_material(name: str = "OiledAmericanWalnut") -> Any:
    """Warm oiled American dark walnut surface."""
    return make_surface_material("oiled_walnut", name=name)


def make_editorial_backdrop_material(name: str = "EditorialBackdrop", dark: bool = False) -> Any:
    """Matte dark-to-mid neutral charcoal architectural editorial studio sweep (LOCKED 09/10)."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-760, 0))

    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-540, 140)
    nt.links.new(mp.outputs["Vector"], sep.inputs["Vector"])

    mr = add_map_range(nt, -0.02, 0.55, 0.0, 1.0, clamp=True, loc=(-360, 140))
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])

    _, fac_c, col_a, col_b, col_out = add_mix_color(nt, "MIX", loc=(-160, 140))
    if dark:
        col_a.default_value = (0.007, 0.008, 0.010, 1.0)
        col_b.default_value = (0.016, 0.018, 0.022, 1.0)
    else:
        col_a.default_value = (0.016, 0.017, 0.019, 1.0)
        col_b.default_value = (0.048, 0.050, 0.054, 1.0)
    nt.links.new(mr.outputs["Result"], fac_c)
    nt.links.new(col_out, get_input(bsdf, "Base Color"))

    set_input(bsdf, "Roughness", 0.90)
    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.14)
    return mat


def make_cyclorama_white_material(
    name: str = "PackshotWhiteCyclorama",
    shadow_radius_m: float = 0.45,
) -> Any:
    """Pure seamless studio white e-commerce cyclorama for shadow-catcher floor (LOCKED 11)."""
    mat, _, bsdf, _ = get_or_create_material(name)
    _ = shadow_radius_m
    set_input(bsdf, "Base Color", (0.98, 0.98, 0.98, 1.0))
    set_input(bsdf, "Roughness", 0.92)
    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.10)
    return mat


def make_volumetric_haze_material(name: str = "DarkCinematicHaze", density: float = 0.016) -> Any:
    """Bounded low-density Cycles Volumetric Scatter mist for 09_dark_cinematic (LOCKED)."""
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name=name)
    if mat.node_tree is None and hasattr(mat, "use_nodes"):
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    vol = nt.nodes.new("ShaderNodeVolumeScatter")
    vol.location = (120, 0)
    vol.inputs["Color"].default_value = (0.86, 0.89, 0.95, 1.0)
    vol.inputs["Density"].default_value = density
    vol.inputs["Anisotropy"].default_value = 0.56
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    return mat
