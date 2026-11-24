"""CC0 PBR surfaces and bespoke cinema Cycles shaders for Customer Personas (12-17)."""

from __future__ import annotations

from typing import Any, Dict, Tuple

from .artwork_gen import ensure_architect_blueprint_texture, ensure_earth_globe_textures
from .assets_cc0 import build_cc0_pbr_material, load_image_cached
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
    "architect_oiled_oak": {
        "asset_id": "oak_veneer_01",
        "tile_scale_m": 0.68,
        "tint_rgb": (0.42, 0.29, 0.19),
        "tint_factor": 0.68,
        "roughness_range": (0.20, 0.56),
        "normal_strength": 0.68,
        "specular_level": 0.34,
        "fallback_rgb": (0.26, 0.18, 0.12),
    },
    "persona_oiled_walnut": {
        "asset_id": "american_walnut_veneer",
        "tile_scale_m": 0.68,
        "tint_rgb": (0.19, 0.098, 0.048),
        "tint_factor": 0.94,
        "roughness_range": (0.18, 0.52),
        "normal_strength": 0.62,
        "specular_level": 0.34,
        "fallback_rgb": (0.10, 0.052, 0.026),
    },
    "oiled_mahogany": {
        "asset_id": "dark_wood",
        "tile_scale_m": 0.72,
        "tint_rgb": (0.20, 0.078, 0.036),
        "tint_factor": 0.90,
        "roughness_range": (0.16, 0.44),
        "normal_strength": 0.54,
        "specular_level": 0.38,
        "fallback_rgb": (0.09, 0.036, 0.018),
    },
    "dark_rosewood": {
        "asset_id": "rosewood_veneer_02",
        "tile_scale_m": 0.76,
        "tint_rgb": (0.18, 0.088, 0.048),
        "tint_factor": 0.88,
        "roughness_range": (0.26, 0.54),
        "normal_strength": 0.52,
        "specular_level": 0.30,
        "fallback_rgb": (0.08, 0.040, 0.022),
    },
    "smoked_executive_walnut": {
        "asset_id": "black_walnut_veneer_01",
        "tile_scale_m": 0.48,
        "tint_rgb": (0.22, 0.135, 0.082),
        "tint_factor": 0.92,
        "roughness_range": (0.24, 0.46),
        "normal_strength": 0.58,
        "specular_level": 0.34,
        "fallback_rgb": (0.085, 0.055, 0.036),
    },
    "basswood_ply": {
        "asset_id": "white_maple_veneer",
        "tile_scale_m": 0.34,
        "tint_rgb": (0.84, 0.72, 0.56),
        "tint_factor": 0.44,
        "roughness_range": (0.48, 0.74),
        "normal_strength": 0.42,
        "specular_level": 0.22,
        "fallback_rgb": (0.64, 0.54, 0.42),
    },
    "honed_concrete_pot": {
        "asset_id": "brushed_concrete_03",
        "tile_scale_m": 0.24,
        "tint_rgb": (0.20, 0.195, 0.185),
        "tint_factor": 0.80,
        "blend_mode": "MIX",
        "desaturate": True,
        "roughness_range": (0.62, 0.90),
        "normal_strength": 0.72,
        "specular_level": 0.20,
        "fallback_rgb": (0.24, 0.23, 0.22),
    },
    "stitched_espresso_leather": {
        "asset_id": "fabric_leather_02",
        "tile_scale_m": 0.20,
        "tint_rgb": (0.052, 0.028, 0.018),
        "tint_factor": 0.95,
        "blend_mode": "MULTIPLY",
        "desaturate": True,
        "roughness_range": (0.26, 0.54),
        "normal_strength": 0.68,
        "specular_level": 0.32,
        "fallback_rgb": (0.042, 0.022, 0.014),
    },
}


def make_calacatta_marble_material(name: str = "CalacattaShowroomMarble") -> Any:
    """Photorealistic Poly Haven 2K honed travertine-marble slab (seamless single-slab crop)."""
    from .assets_cc0 import ensure_pbr_texture_set

    maps = ensure_pbr_texture_set("marble_01", resolution="2k")
    mat, nt, bsdf, _ = get_or_create_material(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (-1180, 0)
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.location = (-940, 0)
    # Map the 2.3x1.35 m showroom tabletop cleanly onto one monolithic grout-free slab of marble_01
    mp.inputs["Location"].default_value = (0.26, 0.65, 0.0)
    mp.inputs["Scale"].default_value = (0.135, 0.135, 0.135)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])

    if "diffuse" in maps:
        tex_d = nt.nodes.new("ShaderNodeTexImage")
        tex_d.location = (-660, 220)
        tex_d.extension = "EXTEND"
        tex_d.image = load_image_cached(maps["diffuse"], colorspace="sRGB")
        nt.links.new(mp.outputs["Vector"], tex_d.inputs["Vector"])

        hsv = nt.nodes.new("ShaderNodeHueSaturation")
        hsv.location = (-360, 220)
        hsv.inputs["Saturation"].default_value = 0.42
        hsv.inputs["Value"].default_value = 0.72
        nt.links.new(tex_d.outputs["Color"], hsv.inputs["Color"])
        nt.links.new(hsv.outputs["Color"], get_input(bsdf, "Base Color"))
    else:
        set_input(bsdf, "Base Color", (0.58, 0.55, 0.50, 1.0))

    if "rough" in maps:
        tex_r = nt.nodes.new("ShaderNodeTexImage")
        tex_r.location = (-660, -20)
        tex_r.extension = "EXTEND"
        tex_r.image = load_image_cached(maps["rough"], colorspace="Non-Color")
        nt.links.new(mp.outputs["Vector"], tex_r.inputs["Vector"])

        mr_r = add_map_range(nt, 0.0, 1.0, 0.22, 0.44, clamp=True, loc=(-340, -20))
        nt.links.new(tex_r.outputs["Color"], mr_r.inputs["Value"])
        nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))
    else:
        set_input(bsdf, "Roughness", 0.30)

    if "normal" in maps:
        tex_n = nt.nodes.new("ShaderNodeTexImage")
        tex_n.location = (-660, -280)
        tex_n.extension = "EXTEND"
        tex_n.image = load_image_cached(maps["normal"], colorspace="Non-Color")
        nt.links.new(mp.outputs["Vector"], tex_n.inputs["Vector"])

        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.location = (-340, -280)
        nmap.inputs["Strength"].default_value = 0.34
        nt.links.new(tex_n.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], get_input(bsdf, "Normal"))

    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.34)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.14)
    set_input(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.18)
    return mat


def make_vellum_grid_material(name: str = "ArchitecturalVellumBlueprint") -> Any:
    """High-res 2K CAD architectural blueprint & elevation sketch on warm archival vellum."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (-1040, 0)

    bp_path = ensure_architect_blueprint_texture()
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.location = (-680, 200)
    tex.image = load_image_cached(bp_path, colorspace="sRGB")
    nt.links.new(tc.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], get_input(bsdf, "Base Color"))

    # Subtle tactile archival vellum paper fiber roughness & micro-bump
    n_fib = nt.nodes.new("ShaderNodeTexNoise")
    n_fib.location = (-680, -140)
    n_fib.inputs["Scale"].default_value = 520.0
    n_fib.inputs["Detail"].default_value = 7.0
    n_fib.inputs["Roughness"].default_value = 0.65
    nt.links.new(tc.outputs["Object"], n_fib.inputs["Vector"])

    mr_r = add_map_range(nt, 0.25, 0.75, 0.72, 0.88, clamp=True, loc=(-320, -60))
    nt.links.new(n_fib.outputs["Fac"], mr_r.inputs["Value"])
    nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-120, -220)
    bump.inputs["Strength"].default_value = 0.14
    bump.inputs["Distance"].default_value = 0.00025
    nt.links.new(n_fib.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))
    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.18)
    return mat


def make_vintage_globe_material(name: str = "VintageRealEarthGlobe") -> Any:
    """Real Natural Earth 2K antique cartography globe with relief bump & varnished lacquer."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (-1060, 0)

    diff_path, bump_path = ensure_earth_globe_textures()
    # Equirectangular Environment Texture on Object coords gives seam-free real Earth projection
    tex_diff = nt.nodes.new("ShaderNodeTexEnvironment")
    tex_diff.location = (-680, 240)
    tex_diff.projection = "EQUIRECTANGULAR"
    tex_diff.image = load_image_cached(diff_path, colorspace="sRGB")
    nt.links.new(tc.outputs["Object"], tex_diff.inputs["Vector"])
    nt.links.new(tex_diff.outputs["Color"], get_input(bsdf, "Base Color"))

    tex_bump = nt.nodes.new("ShaderNodeTexEnvironment")
    tex_bump.location = (-680, -120)
    tex_bump.projection = "EQUIRECTANGULAR"
    tex_bump.image = load_image_cached(bump_path, colorspace="Non-Color")
    nt.links.new(tc.outputs["Object"], tex_bump.inputs["Vector"])

    # Varnished antique oceans shinier (~0.18) than matte parchment continents (~0.42)
    mr_r = add_map_range(nt, 0.35, 0.75, 0.18, 0.42, clamp=True, loc=(-300, -40))
    nt.links.new(tex_bump.outputs["Color"], mr_r.inputs["Value"])
    nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-100, -240)
    bump.inputs["Strength"].default_value = 0.28
    bump.inputs["Distance"].default_value = 0.0006
    nt.links.new(tex_bump.outputs["Color"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))

    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.40)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.38)
    set_input(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.14)
    return mat


def make_leather_spine_material(
    name: str,
    tint_rgb: Tuple[float, float, float] = (0.14, 0.08, 0.05),
) -> Any:
    """Tactile CC0 pebbled leather book cover & spine material."""
    cc0 = build_cc0_pbr_material(
        name=name,
        asset_id="brown_leather",
        tile_scale_m=0.22,
        tint_rgb=tint_rgb,
        tint_factor=0.95,
        roughness_range=(0.26, 0.50),
        normal_strength=0.64,
        specular_level=0.32,
        blend_mode="MULTIPLY",
        desaturate=True,
    )
    if cc0 is not None:
        return cc0
    mat, _, bsdf, _ = get_or_create_material(name)
    set_input(bsdf, "Base Color", (tint_rgb[0], tint_rgb[1], tint_rgb[2], 1.0))
    set_input(bsdf, "Roughness", 0.40)
    return mat


def make_polished_gold_material(name: str = "ExecutiveSatinGold") -> Any:
    """Warm 18k brushed-satin architectural gold for nibs, book foil titles, and bands."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(4.0, 180.0, 180.0), loc=(-760, 0))
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.location = (-500, 0)
    n.inputs["Scale"].default_value = 32.0
    n.inputs["Detail"].default_value = 6.0
    nt.links.new(mp.outputs["Vector"], n.inputs["Vector"])

    set_input(bsdf, "Base Color", (0.88, 0.66, 0.26, 1.0))
    set_input(bsdf, "Metallic", 0.98)
    mr_r = add_map_range(nt, 0.25, 0.75, 0.14, 0.26, clamp=True, loc=(-240, 20))
    nt.links.new(n.outputs["Fac"], mr_r.inputs["Value"])
    nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))
    return mat


def make_matte_jet_ceramic_material(name: str = "UnbrandedJetBlackMug") -> Any:
    """Tactile unbranded matte jet-black stoneware ceramic mug finish (zero logos)."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-780, 0))
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.location = (-520, 0)
    n.inputs["Scale"].default_value = 740.0
    n.inputs["Detail"].default_value = 6.0
    nt.links.new(mp.outputs["Vector"], n.inputs["Vector"])

    set_input(bsdf, "Base Color", (0.014, 0.014, 0.016, 1.0))
    mr_r = add_map_range(nt, 0.25, 0.75, 0.42, 0.64, clamp=True, loc=(-240, 20))
    nt.links.new(n.outputs["Fac"], mr_r.inputs["Value"])
    nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))
    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.34)

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-80, -140)
    bump.inputs["Strength"].default_value = 0.11
    bump.inputs["Distance"].default_value = 0.00025
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

    w_fl = nt.nodes.new("ShaderNodeTexWave")
    w_fl.location = (-680, 140)
    w_fl.wave_type = "BANDS"
    w_fl.bands_direction = "Z"
    w_fl.inputs["Scale"].default_value = 14.0
    nt.links.new(mp.outputs["Vector"], w_fl.inputs["Vector"])

    _, fac_c, ca, cb, col_out = add_mix_color(nt, "MIX", loc=(-320, 140))
    ca.default_value = (tint[0] * 0.52, tint[1] * 0.55, tint[2] * 0.62, 1.0)
    cb.default_value = (min(1.0, tint[0] * 1.35), min(1.0, tint[1] * 1.32), min(1.0, tint[2] * 1.28), 1.0)
    nt.links.new(w_fl.outputs["Fac"], fac_c)
    nt.links.new(col_out, get_input(bsdf, "Base Color"))

    set_input(bsdf, "Metallic", 0.38)
    set_input(bsdf, "Roughness", 0.15)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.55)
    if emit_strength > 1e-4:
        set_input(bsdf, "Emission Color", (tint[0], tint[1], tint[2], 1.0))
        set_input(bsdf, "Emission Strength", float(emit_strength))
    return mat


def make_sky_gradient_material(
    name: str,
    horizon_rgb: Tuple[float, float, float],
    zenith_rgb: Tuple[float, float, float],
    strength: float = 1.6,
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
