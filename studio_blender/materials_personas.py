"""CC0 PBR surfaces and bespoke Cycles shaders for Customer Persona environments (12-17)."""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from .assets_cc0 import build_cc0_pbr_material
from .materials_core import (
    Rgba,
    add_map_range,
    add_mix_color,
    add_tex_coord_mapping,
    get_input,
    get_or_create_material,
    set_input,
)

# Extra CC0 2K PBR surface presets merged cleanly into materials_studio.SURFACE_CATALOG
PERSONA_SURFACE_CATALOG: Dict[str, Dict[str, Any]] = {
    "oiled_mahogany": {
        "asset_id": "dark_wood",
        "tile_scale_m": 0.78,
        "tint_rgb": (0.26, 0.105, 0.052),
        "tint_factor": 0.88,
        "roughness_range": (0.24, 0.38),
        "normal_strength": 0.30,
        "specular_level": 0.34,
        "fallback_rgb": (0.11, 0.045, 0.022),
    },
    "dark_rosewood": {
        "asset_id": "rosewood_veneer_02",
        "tile_scale_m": 0.80,
        "tint_rgb": (0.24, 0.12, 0.068),
        "tint_factor": 0.86,
        "roughness_range": (0.34, 0.50),
        "normal_strength": 0.34,
        "specular_level": 0.28,
        "fallback_rgb": (0.10, 0.052, 0.028),
    },
    "smoked_executive_walnut": {
        "asset_id": "smoked_walnut_veneer",
        "tile_scale_m": 0.76,
        "tint_rgb": (0.072, 0.058, 0.050),
        "tint_factor": 0.95,
        "roughness_range": (0.24, 0.38),
        "normal_strength": 0.32,
        "specular_level": 0.32,
        "fallback_rgb": (0.07, 0.06, 0.052),
    },
    "basswood_ply": {
        "asset_id": "white_maple_veneer",
        "tile_scale_m": 0.36,
        "tint_rgb": (0.94, 0.86, 0.72),
        "tint_factor": 0.36,
        "roughness_range": (0.58, 0.76),
        "normal_strength": 0.24,
        "specular_level": 0.20,
        "fallback_rgb": (0.72, 0.62, 0.48),
    },
    "honed_concrete_pot": {
        "asset_id": "brushed_concrete_03",
        "tile_scale_m": 0.26,
        "tint_rgb": (0.24, 0.23, 0.22),
        "tint_factor": 0.80,
        "blend_mode": "MIX",
        "desaturate": True,
        "roughness_range": (0.72, 0.88),
        "normal_strength": 0.55,
        "specular_level": 0.16,
        "fallback_rgb": (0.28, 0.27, 0.26),
    },
    "stitched_espresso_leather": {
        "asset_id": "fabric_leather_02",
        "tile_scale_m": 0.22,
        "tint_rgb": (0.058, 0.032, 0.020),
        "tint_factor": 0.95,
        "blend_mode": "MULTIPLY",
        "desaturate": True,
        "roughness_range": (0.34, 0.50),
        "normal_strength": 0.48,
        "specular_level": 0.28,
        "fallback_rgb": (0.045, 0.024, 0.015),
    },
}


def make_calacatta_marble_material(name: str = "CalacattaShowroomMarble") -> Any:
    """Seamless honed Italian Calacatta Gold veined marble slab (zero grout seams)."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), rotation=(0.0, 0.0, 0.48), loc=(-1260, 0))

    # Multi-octave organic tectonic warp for authentic Calacatta veining
    n_warp = nt.nodes.new("ShaderNodeTexNoise")
    n_warp.location = (-1000, 180)
    n_warp.inputs["Scale"].default_value = 2.4
    n_warp.inputs["Detail"].default_value = 9.0
    n_warp.inputs["Roughness"].default_value = 0.62
    nt.links.new(mp.outputs["Vector"], n_warp.inputs["Vector"])

    # Primary smoky-taupe marble veins
    wave_main = nt.nodes.new("ShaderNodeTexWave")
    wave_main.location = (-740, 260)
    wave_main.wave_type = "BANDS"
    wave_main.bands_direction = "DIAGONAL"
    wave_main.wave_profile = "SIN"
    wave_main.inputs["Scale"].default_value = 1.65
    wave_main.inputs["Distortion"].default_value = 11.5
    wave_main.inputs["Detail"].default_value = 8.0
    wave_main.inputs["Detail Scale"].default_value = 2.2
    wave_main.inputs["Detail Roughness"].default_value = 0.64
    nt.links.new(mp.outputs["Vector"], wave_main.inputs["Vector"])

    mr_vein = add_map_range(nt, 0.72, 0.96, 0.0, 1.0, clamp=True, loc=(-500, 260))
    nt.links.new(wave_main.outputs["Fac"], mr_vein.inputs["Value"])

    # Secondary warm champagne-gold fine mineral filaments
    wave_gold = nt.nodes.new("ShaderNodeTexWave")
    wave_gold.location = (-740, -10)
    wave_gold.wave_type = "BANDS"
    wave_gold.bands_direction = "X"
    wave_gold.inputs["Scale"].default_value = 2.6
    wave_gold.inputs["Distortion"].default_value = 15.0
    wave_gold.inputs["Detail"].default_value = 7.0
    nt.links.new(mp.outputs["Vector"], wave_gold.inputs["Vector"])

    mr_gold = add_map_range(nt, 0.84, 0.98, 0.0, 0.55, clamp=True, loc=(-500, -10))
    nt.links.new(wave_gold.outputs["Fac"], mr_gold.inputs["Value"])

    # Base cream-ivory marble modulated softly by subtle clouding noise
    _, fac_cloud, ca_c, cb_c, out_cloud = add_mix_color(nt, "MIX", loc=(-500, 480))
    ca_c.default_value = (0.76, 0.73, 0.68, 1.0)
    cb_c.default_value = (0.88, 0.85, 0.80, 1.0)
    nt.links.new(n_warp.outputs["Fac"], fac_cloud)

    # Blend smoky greige-taupe primary veins
    _, fac_v1, ca_v1, cb_v1, out_v1 = add_mix_color(nt, "MIX", loc=(-260, 280))
    cb_v1.default_value = (0.36, 0.33, 0.29, 1.0)
    nt.links.new(mr_vein.outputs["Result"], fac_v1)
    nt.links.new(out_cloud, ca_v1)

    # Blend warm champagne-gold secondary mineral veins
    _, fac_v2, ca_v2, cb_v2, out_v2 = add_mix_color(nt, "MIX", loc=(-60, 260))
    cb_v2.default_value = (0.58, 0.49, 0.37, 1.0)
    nt.links.new(mr_gold.outputs["Result"], fac_v2)
    nt.links.new(out_v1, ca_v2)
    nt.links.new(out_v2, get_input(bsdf, "Base Color"))

    # Honed-satin showroom marble roughness (veins slightly rougher than calcite crystal)
    mr_r = add_map_range(nt, 0.0, 1.0, 0.18, 0.31, clamp=True, loc=(-240, -100))
    nt.links.new(mr_vein.outputs["Result"], mr_r.inputs["Value"])
    nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))

    # Micro mineral polish bump
    n_micro = nt.nodes.new("ShaderNodeTexNoise")
    n_micro.location = (-500, -260)
    n_micro.inputs["Scale"].default_value = 95.0
    n_micro.inputs["Detail"].default_value = 6.0
    nt.links.new(mp.outputs["Vector"], n_micro.inputs["Vector"])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-100, -260)
    bump.inputs["Strength"].default_value = 0.032
    bump.inputs["Distance"].default_value = 0.00025
    nt.links.new(n_micro.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))

    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.42)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.24)
    set_input(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.14)
    return mat


def make_vellum_grid_material(name: str = "ArchitecturalVellumGrid") -> Any:
    """Heavy matte cream architectural drafting vellum with fine pure CAD grid (zero text)."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-1080, 0))

    # Fine 12 mm orthogonal CAD drafting grid along X and Y (zero garbled labels!)
    wx = nt.nodes.new("ShaderNodeTexWave")
    wx.location = (-800, 220)
    wx.wave_type = "BANDS"
    wx.bands_direction = "X"
    wx.wave_profile = "SAW"
    wx.inputs["Scale"].default_value = 54.0
    nt.links.new(mp.outputs["Vector"], wx.inputs["Vector"])

    wy = nt.nodes.new("ShaderNodeTexWave")
    wy.location = (-800, 0)
    wy.wave_type = "BANDS"
    wy.bands_direction = "Y"
    wy.wave_profile = "SAW"
    wy.inputs["Scale"].default_value = 54.0
    nt.links.new(mp.outputs["Vector"], wy.inputs["Vector"])

    mrx = add_map_range(nt, 0.92, 0.96, 0.0, 1.0, clamp=True, loc=(-580, 220))
    mry = add_map_range(nt, 0.92, 0.96, 0.0, 1.0, clamp=True, loc=(-580, 0))
    nt.links.new(wx.outputs["Fac"], mrx.inputs["Value"])
    nt.links.new(wy.outputs["Fac"], mry.inputs["Value"])

    grid_max = nt.nodes.new("ShaderNodeMath")
    grid_max.operation = "MAXIMUM"
    grid_max.location = (-380, 120)
    nt.links.new(mrx.outputs["Result"], grid_max.inputs[0])
    nt.links.new(mry.outputs["Result"], grid_max.inputs[1])

    _, fac_c, ca, cb, col_out = add_mix_color(nt, "MIX", loc=(-160, 140))
    ca.default_value = (0.86, 0.83, 0.77, 1.0)  # heavy archival drafting vellum cream
    cb.default_value = (0.42, 0.44, 0.46, 1.0)  # delicate slate drafting ink line
    nt.links.new(grid_max.outputs["Value"], fac_c)
    nt.links.new(col_out, get_input(bsdf, "Base Color"))

    # Paper fiber micro-texture
    n_fib = nt.nodes.new("ShaderNodeTexNoise")
    n_fib.location = (-580, -220)
    n_fib.inputs["Scale"].default_value = 460.0
    n_fib.inputs["Detail"].default_value = 6.0
    nt.links.new(mp.outputs["Vector"], n_fib.inputs["Vector"])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-120, -220)
    bump.inputs["Strength"].default_value = 0.06
    bump.inputs["Distance"].default_value = 0.00018
    nt.links.new(n_fib.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))

    set_input(bsdf, "Roughness", 0.78)
    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.16)
    return mat


def make_vintage_globe_material(name: str = "VintageCartographyGlobe") -> Any:
    """Antique parchment-and-slate cartographic globe sphere with fine graticule (zero text)."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-1120, 0))

    # Organic fractal continents vs aged slate-teal vintage ocean
    n_land = nt.nodes.new("ShaderNodeTexNoise")
    n_land.location = (-840, 220)
    n_land.inputs["Scale"].default_value = 2.6
    n_land.inputs["Detail"].default_value = 8.0
    n_land.inputs["Roughness"].default_value = 0.58
    n_land.inputs["Distortion"].default_value = 0.45
    nt.links.new(mp.outputs["Vector"], n_land.inputs["Vector"])

    mr_land = add_map_range(nt, 0.46, 0.53, 0.0, 1.0, clamp=True, loc=(-600, 220))
    nt.links.new(n_land.outputs["Fac"], mr_land.inputs["Value"])

    _, fac_l, ca_l, cb_l, out_l = add_mix_color(nt, "MIX", loc=(-380, 220))
    ca_l.default_value = (0.14, 0.21, 0.25, 1.0)  # deep antique ocean slate-teal
    cb_l.default_value = (0.58, 0.45, 0.28, 1.0)  # rich aged warm parchment landmass
    nt.links.new(mr_land.outputs["Result"], fac_l)

    # Fine latitude rings (graticule lines)
    w_lat = nt.nodes.new("ShaderNodeTexWave")
    w_lat.location = (-840, -60)
    w_lat.wave_type = "BANDS"
    w_lat.bands_direction = "Z"
    w_lat.wave_profile = "SAW"
    w_lat.inputs["Scale"].default_value = 7.5
    nt.links.new(mp.outputs["Vector"], w_lat.inputs["Vector"])

    mr_lat = add_map_range(nt, 0.93, 0.97, 0.0, 0.45, clamp=True, loc=(-600, -60))
    nt.links.new(w_lat.outputs["Fac"], mr_lat.inputs["Value"])

    _, fac_g, ca_g, cb_g, out_g = add_mix_color(nt, "MIX", loc=(-140, 180))
    cb_g.default_value = (0.22, 0.16, 0.10, 1.0)
    nt.links.new(mr_lat.outputs["Result"], fac_g)
    nt.links.new(out_l, ca_g)
    nt.links.new(out_g, get_input(bsdf, "Base Color"))

    set_input(bsdf, "Roughness", 0.34)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.32)
    set_input(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.18)
    return mat


def make_leather_spine_material(
    name: str,
    tint_rgb: Tuple[float, float, float] = (0.14, 0.08, 0.05),
) -> Any:
    """Tactile CC0 leather book cover & spine material (100% zero text)."""
    cc0 = build_cc0_pbr_material(
        name=name,
        asset_id="brown_leather",
        tile_scale_m=0.26,
        tint_rgb=tint_rgb,
        tint_factor=0.95,
        roughness_range=(0.34, 0.50),
        normal_strength=0.44,
        specular_level=0.28,
        blend_mode="MULTIPLY",
        desaturate=True,
    )
    if cc0 is not None:
        return cc0
    mat, _, bsdf, _ = get_or_create_material(name)
    set_input(bsdf, "Base Color", (tint_rgb[0], tint_rgb[1], tint_rgb[2], 1.0))
    set_input(bsdf, "Roughness", 0.46)
    return mat


def make_polished_gold_material(name: str = "ExecutiveSatinGold") -> Any:
    """Warm 18k satin-polished architectural gold for fountain pen nib, rings, and book bands."""
    mat, _, bsdf, _ = get_or_create_material(name)
    set_input(bsdf, "Base Color", (0.86, 0.66, 0.28, 1.0))
    set_input(bsdf, "Metallic", 0.98)
    set_input(bsdf, "Roughness", 0.18)
    return mat


def make_matte_jet_ceramic_material(name: str = "UnbrandedJetBlackMug") -> Any:
    """Clean unbranded matte jet-black stoneware ceramic mug finish (zero logos)."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-780, 0))
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.location = (-520, 0)
    n.inputs["Scale"].default_value = 820.0
    n.inputs["Detail"].default_value = 5.0
    nt.links.new(mp.outputs["Vector"], n.inputs["Vector"])

    set_input(bsdf, "Base Color", (0.016, 0.016, 0.018, 1.0))
    mr_r = add_map_range(nt, 0.25, 0.75, 0.48, 0.62, loc=(-240, 20))
    nt.links.new(n.outputs["Fac"], mr_r.inputs["Value"])
    nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))
    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.28)

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-80, -140)
    bump.inputs["Strength"].default_value = 0.05
    bump.inputs["Distance"].default_value = 0.00018
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))
    return mat


def make_skyline_glass_material(
    name: str = "DistantTowerGlass",
    tint: Rgba = (0.36, 0.44, 0.54, 1.0),
    emit_strength: float = 0.0,
) -> Any:
    """Photorealistic distant high-rise glass curtain-wall shader for soft window bokeh."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-960, 0))

    # Subtle floorplate bands along Z + vertical mullion rhythm for authentic blurred high-rise texture
    w_fl = nt.nodes.new("ShaderNodeTexWave")
    w_fl.location = (-680, 140)
    w_fl.wave_type = "BANDS"
    w_fl.bands_direction = "Z"
    w_fl.inputs["Scale"].default_value = 14.0
    nt.links.new(mp.outputs["Vector"], w_fl.inputs["Vector"])

    _, fac_c, ca, cb, col_out = add_mix_color(nt, "MIX", loc=(-320, 140))
    ca.default_value = (tint[0] * 0.58, tint[1] * 0.60, tint[2] * 0.64, 1.0)
    cb.default_value = (min(1.0, tint[0] * 1.35), min(1.0, tint[1] * 1.32), min(1.0, tint[2] * 1.28), 1.0)
    nt.links.new(w_fl.outputs["Fac"], fac_c)
    nt.links.new(col_out, get_input(bsdf, "Base Color"))

    set_input(bsdf, "Metallic", 0.35)
    set_input(bsdf, "Roughness", 0.16)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.55)
    if emit_strength > 1e-4:
        set_input(bsdf, "Emission Color", (tint[0], tint[1], tint[2], 1.0))
        set_input(bsdf, "Emission Strength", float(emit_strength))
    return mat


def make_sky_gradient_material(
    name: str,
    horizon_rgb: Tuple[float, float, float],
    zenith_rgb: Tuple[float, float, float],
    strength: float = 1.9,
) -> Any:
    """Luminous daylight or golden-hour sky gradient backdrop visible through studio windows."""
    mat, nt, _, out = get_or_create_material(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (-740, 0)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-520, 0)
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])

    mr = add_map_range(nt, -0.85, 0.95, 0.0, 1.0, clamp=True, loc=(-320, 0))
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])

    _, fac_c, ca, cb, col_out = add_mix_color(nt, "MIX", loc=(-100, 40))
    ca.default_value = (horizon_rgb[0], horizon_rgb[1], horizon_rgb[2], 1.0)
    cb.default_value = (zenith_rgb[0], zenith_rgb[1], zenith_rgb[2], 1.0)
    nt.links.new(mr.outputs["Result"], fac_c)

    em = nt.nodes.new("ShaderNodeEmission")
    em.location = (160, 40)
    em.inputs["Strength"].default_value = float(strength)
    nt.links.new(col_out, em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return mat
