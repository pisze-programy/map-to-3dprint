"""Luxury hard-surface, tableware, monograph, and architectural prop PBR materials."""

from __future__ import annotations

from typing import Any

from .materials_core import (
    Rgba,
    add_map_range,
    add_mix_color,
    add_tex_coord_mapping,
    apply_shadow_transparency_bypass,
    get_input,
    get_or_create_material,
    set_input,
)


def make_anodized_aluminum_material(
    name: str = "AnodizedAluminum",
    tint: Rgba = (0.70, 0.71, 0.73, 1.0),
) -> Any:
    """Bead-blasted matte anodized silver aluminum (laptop unibody, machined ruler)."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-800, 0))
    n_blast = nt.nodes.new("ShaderNodeTexNoise")
    n_blast.location = (-540, 0)
    n_blast.inputs["Scale"].default_value = 3200.0
    n_blast.inputs["Detail"].default_value = 6.0
    nt.links.new(mp.outputs["Vector"], n_blast.inputs["Vector"])

    set_input(bsdf, "Base Color", tint)
    set_input(bsdf, "Metallic", 0.95)
    mr_r = add_map_range(nt, 0.25, 0.75, 0.24, 0.32, loc=(-240, 40))
    nt.links.new(n_blast.outputs["Fac"], mr_r.inputs["Value"])
    nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-80, -160)
    bump.inputs["Strength"].default_value = 0.025
    bump.inputs["Distance"].default_value = 0.00008
    nt.links.new(n_blast.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))
    return mat


def make_brushed_metal_material(
    name: str = "BrushedSteelMetal",
    tint: Rgba = (0.74, 0.75, 0.77, 1.0),
) -> Any:
    """Directional brushed stainless steel (architectural scale ruler, pen clip)."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(2.0, 220.0, 220.0), loc=(-800, 0))
    n_brush = nt.nodes.new("ShaderNodeTexNoise")
    n_brush.location = (-540, 0)
    n_brush.inputs["Scale"].default_value = 30.0
    n_brush.inputs["Detail"].default_value = 8.0
    nt.links.new(mp.outputs["Vector"], n_brush.inputs["Vector"])

    set_input(bsdf, "Base Color", tint)
    set_input(bsdf, "Metallic", 0.95)
    mr_r = add_map_range(nt, 0.25, 0.75, 0.22, 0.34, loc=(-240, 40))
    nt.links.new(n_brush.outputs["Fac"], mr_r.inputs["Value"])
    nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-80, -160)
    bump.inputs["Strength"].default_value = 0.03
    bump.inputs["Distance"].default_value = 0.0001
    nt.links.new(n_brush.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))
    return mat


def make_matte_black_tech_material(name: str = "MatteBlackTech") -> Any:
    """Matte anodized black aluminum / composite for smartphone body, pen barrel, window mullions."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-760, 0))
    n_grain = nt.nodes.new("ShaderNodeTexNoise")
    n_grain.location = (-500, 0)
    n_grain.inputs["Scale"].default_value = 1800.0
    n_grain.inputs["Detail"].default_value = 5.0
    nt.links.new(mp.outputs["Vector"], n_grain.inputs["Vector"])

    set_input(bsdf, "Base Color", (0.010, 0.010, 0.012, 1.0))
    set_input(bsdf, "Metallic", 0.25)
    set_input(bsdf, "Roughness", 0.44)
    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.30)

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-100, -140)
    bump.inputs["Strength"].default_value = 0.03
    bump.inputs["Distance"].default_value = 0.0001
    nt.links.new(n_grain.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))
    return mat


def make_dark_screen_glass_material(name: str = "DarkScreenGlass") -> Any:
    """Anti-reflective dark glass face for matte-black smartphone and laptop display."""
    mat, _, bsdf, _ = get_or_create_material(name)
    set_input(bsdf, "Base Color", (0.0025, 0.0030, 0.0040, 1.0))
    set_input(bsdf, "Roughness", 0.12)
    set_input(bsdf, "IOR", 1.46)
    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.22)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.14)
    set_input(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.06)
    return mat


def make_porcelain_material(
    name: str = "WarmStonewarePorcelain",
    color: Rgba = (0.78, 0.75, 0.70, 1.0),
    roughness: float = 0.22,
) -> Any:
    """Refined satin-glazed ceramic / porcelain for espresso cup, saucer, and coffee mug."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-780, 0))
    n_glaze = nt.nodes.new("ShaderNodeTexNoise")
    n_glaze.location = (-520, 0)
    n_glaze.inputs["Scale"].default_value = 420.0
    n_glaze.inputs["Detail"].default_value = 4.0
    nt.links.new(mp.outputs["Vector"], n_glaze.inputs["Vector"])

    set_input(bsdf, "Base Color", color)
    mr_r = add_map_range(nt, 0.25, 0.75, max(0.08, roughness - 0.06), min(0.85, roughness + 0.08), loc=(-240, 20))
    nt.links.new(n_glaze.outputs["Fac"], mr_r.inputs["Value"])
    nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.28 if roughness < 0.35 else 0.05)
    set_input(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.14)
    set_input(bsdf, ("Subsurface Weight", "Subsurface"), 0.04)
    set_input(bsdf, "Subsurface Scale", 0.001)
    return mat


def make_espresso_crema_material(name: str = "EspressoCrema") -> Any:
    """Rich roasted dark espresso surface with warm hazelnut tiger-stripe crema."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-800, 0))
    n_crema = nt.nodes.new("ShaderNodeTexNoise")
    n_crema.location = (-540, 80)
    n_crema.inputs["Scale"].default_value = 120.0
    n_crema.inputs["Detail"].default_value = 6.0
    n_crema.inputs["Distortion"].default_value = 1.4
    nt.links.new(mp.outputs["Vector"], n_crema.inputs["Vector"])

    _, fac_c, col_a, col_b, col_out = add_mix_color(nt, "MIX", loc=(-260, 120))
    col_a.default_value = (0.032, 0.012, 0.004, 1.0)
    col_b.default_value = (0.220, 0.098, 0.032, 1.0)
    mr_c = add_map_range(nt, 0.35, 0.70, 0.0, 1.0, loc=(-400, 120))
    nt.links.new(n_crema.outputs["Fac"], mr_c.inputs["Value"])
    nt.links.new(mr_c.outputs["Result"], fac_c)
    nt.links.new(col_out, get_input(bsdf, "Base Color"))

    set_input(bsdf, "Roughness", 0.14)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.35)
    set_input(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.08)
    return mat


def make_clear_glass_material(name: str = "ClearGlass") -> Any:
    """Thin-walled optical tumbler glass (IOR 1.51) with shadow/diffuse caustic bypass."""
    mat, nt, bsdf, out = get_or_create_material(name)
    set_input(bsdf, "Base Color", (0.992, 0.998, 1.0, 1.0))
    set_input(bsdf, "Roughness", 0.008)
    set_input(bsdf, "IOR", 1.51)
    set_input(bsdf, ("Transmission Weight", "Transmission"), 0.99)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.14)
    set_input(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.008)

    apply_shadow_transparency_bypass(nt, bsdf.outputs["BSDF"], out, shadow_tint=(0.97, 0.99, 0.99, 1.0))
    return mat


def make_water_liquid_material(name: str = "ClearWaterLiquid") -> Any:
    """Crystal-clear refractive drinking water (IOR 1.333, zero dusk milky haze)."""
    mat, nt, bsdf, out = get_or_create_material(name)
    set_input(bsdf, "Base Color", (0.992, 0.998, 1.0, 1.0))
    set_input(bsdf, "Roughness", 0.004)
    set_input(bsdf, "IOR", 1.333)
    set_input(bsdf, ("Transmission Weight", "Transmission"), 0.995)

    # Bypass both Shadow and Diffuse rays so low-light dusk water stays crystal-clear, never milky
    lp = nt.nodes.new("ShaderNodeLightPath")
    lp.location = (120, 340)
    math_or = nt.nodes.new("ShaderNodeMath")
    math_or.operation = "MAXIMUM"
    math_or.location = (320, 340)
    nt.links.new(lp.outputs["Is Shadow Ray"], math_or.inputs[0])
    nt.links.new(lp.outputs["Is Diffuse Ray"], math_or.inputs[1])

    transp = nt.nodes.new("ShaderNodeBsdfTransparent")
    transp.location = (320, 160)
    transp.inputs["Color"].default_value = (0.96, 0.985, 1.0, 1.0)
    mix_sh = nt.nodes.new("ShaderNodeMixShader")
    mix_sh.location = (540, 60)
    nt.links.new(math_or.outputs["Value"], mix_sh.inputs["Fac"])
    nt.links.new(bsdf.outputs["BSDF"], mix_sh.inputs[1])
    nt.links.new(transp.outputs["BSDF"], mix_sh.inputs[2])
    nt.links.new(mix_sh.outputs["Shader"], out.inputs["Surface"])
    return mat


def make_book_cover_material(
    name: str = "LinenMonographCover",
    color: Rgba = (0.58, 0.54, 0.48, 1.0),
) -> Any:
    """Tactile CC0 woven linen cloth cover for Phaidon/Taschen architectural monographs."""
    from .assets_cc0 import build_cc0_pbr_material

    cc0 = build_cc0_pbr_material(
        name=name,
        asset_id="rough_linen",
        tile_scale_m=0.22,
        tint_rgb=(color[0], color[1], color[2]),
        tint_factor=0.92,
        roughness_range=(0.82, 0.94),
        normal_strength=0.42,
        specular_level=0.14,
        blend_mode="MIX",
        desaturate=True,
    )
    if cc0 is not None:
        return cc0

    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-880, 0))
    w_x = nt.nodes.new("ShaderNodeTexWave")
    w_x.location = (-600, 120)
    w_x.wave_type = "BANDS"
    w_x.bands_direction = "X"
    w_x.inputs["Scale"].default_value = 320.0
    nt.links.new(mp.outputs["Vector"], w_x.inputs["Vector"])
    set_input(bsdf, "Base Color", color)
    set_input(bsdf, "Roughness", 0.86)
    set_input(bsdf, ("Sheen Weight", "Sheen"), 0.28)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-100, -140)
    bump.inputs["Strength"].default_value = 0.14
    bump.inputs["Distance"].default_value = 0.0003
    nt.links.new(w_x.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))
    return mat


def make_leather_notebook_material(name: str = "DarkLeatherNotebook") -> Any:
    """Rich dark espresso stitched leather cover using CC0 brown_leather 2K PBR."""
    from .assets_cc0 import build_cc0_pbr_material

    cc0 = build_cc0_pbr_material(
        name=name,
        asset_id="brown_leather",
        tile_scale_m=0.26,
        tint_rgb=(0.18, 0.11, 0.075),
        tint_factor=0.86,
        roughness_range=(0.38, 0.56),
        normal_strength=0.45,
        specular_level=0.26,
    )
    if cc0 is not None:
        return cc0
    mat, _, bsdf, _ = get_or_create_material(name)
    set_input(bsdf, "Base Color", (0.055, 0.028, 0.016, 1.0))
    set_input(bsdf, "Roughness", 0.48)
    return mat


def make_amber_drink_material(name: str = "WarmAmberCrystalLiquid") -> Any:
    """Warm golden-amber crystal refraction for evening penthouse glass."""
    mat, nt, bsdf, out = get_or_create_material(name)
    set_input(bsdf, "Base Color", (0.94, 0.66, 0.28, 1.0))
    set_input(bsdf, "Roughness", 0.006)
    set_input(bsdf, "IOR", 1.35)
    set_input(bsdf, ("Transmission Weight", "Transmission"), 0.98)

    lp = nt.nodes.new("ShaderNodeLightPath")
    lp.location = (120, 340)
    math_or = nt.nodes.new("ShaderNodeMath")
    math_or.operation = "MAXIMUM"
    math_or.location = (320, 340)
    nt.links.new(lp.outputs["Is Shadow Ray"], math_or.inputs[0])
    nt.links.new(lp.outputs["Is Diffuse Ray"], math_or.inputs[1])

    transp = nt.nodes.new("ShaderNodeBsdfTransparent")
    transp.location = (320, 160)
    transp.inputs["Color"].default_value = (0.96, 0.78, 0.45, 1.0)
    mix_sh = nt.nodes.new("ShaderNodeMixShader")
    mix_sh.location = (540, 60)
    nt.links.new(math_or.outputs["Value"], mix_sh.inputs["Fac"])
    nt.links.new(bsdf.outputs["BSDF"], mix_sh.inputs[1])
    nt.links.new(transp.outputs["BSDF"], mix_sh.inputs[2])
    nt.links.new(mix_sh.outputs["Shader"], out.inputs["Surface"])
    return mat


def make_book_pages_material(name: str = "StackedBookPages") -> Any:
    """Warm cream architectural paper stack with fine horizontal page lines."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-820, 0))

    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.location = (-560, 0)
    wave.wave_type = "BANDS"
    wave.bands_direction = "Z"
    wave.inputs["Scale"].default_value = 260.0
    wave.inputs["Distortion"].default_value = 0.25
    wave.inputs["Detail"].default_value = 4.0
    nt.links.new(mp.outputs["Vector"], wave.inputs["Vector"])

    _, fac_c, col_a, col_b, col_out = add_mix_color(nt, "MIX", loc=(-260, 140))
    col_a.default_value = (0.58, 0.55, 0.50, 1.0)
    col_b.default_value = (0.84, 0.81, 0.75, 1.0)
    nt.links.new(wave.outputs["Fac"], fac_c)
    nt.links.new(col_out, get_input(bsdf, "Base Color"))

    set_input(bsdf, "Roughness", 0.84)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-80, -160)
    bump.inputs["Strength"].default_value = 0.16
    bump.inputs["Distance"].default_value = 0.00025
    nt.links.new(wave.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))
    return mat


def make_ceramic_vessel_material(
    name: str = "StonewareVessel",
    color: Rgba = (0.50, 0.44, 0.37, 1.0),
) -> Any:
    """Matte warm speckled stoneware ceramic for vessels and architect coffee mug."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-880, 0))

    n_clay = nt.nodes.new("ShaderNodeTexNoise")
    n_clay.location = (-600, 120)
    n_clay.inputs["Scale"].default_value = 95.0
    n_clay.inputs["Detail"].default_value = 7.0
    nt.links.new(mp.outputs["Vector"], n_clay.inputs["Vector"])

    n_speck = nt.nodes.new("ShaderNodeTexNoise")
    n_speck.location = (-600, -160)
    n_speck.inputs["Scale"].default_value = 920.0
    n_speck.inputs["Detail"].default_value = 5.0
    nt.links.new(mp.outputs["Vector"], n_speck.inputs["Vector"])

    _, fac_c, col_a, col_b, col_out = add_mix_color(nt, "MIX", loc=(-260, 160))
    col_a.default_value = (color[0] * 0.72, color[1] * 0.70, color[2] * 0.68, 1.0)
    col_b.default_value = (min(1.0, color[0] * 1.12), min(1.0, color[1] * 1.12), min(1.0, color[2] * 1.12), 1.0)
    mr_c = add_map_range(nt, 0.32, 0.68, 0.0, 1.0, loc=(-420, 160))
    nt.links.new(n_speck.outputs["Fac"], mr_c.inputs["Value"])
    nt.links.new(mr_c.outputs["Result"], fac_c)
    nt.links.new(col_out, get_input(bsdf, "Base Color"))

    mr_r = add_map_range(nt, 0.25, 0.75, 0.60, 0.78, loc=(-240, -20))
    nt.links.new(n_clay.outputs["Fac"], mr_r.inputs["Value"])
    nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-80, -180)
    bump.inputs["Strength"].default_value = 0.12
    bump.inputs["Distance"].default_value = 0.0004
    nt.links.new(n_speck.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))

    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.26)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.04)
    return mat


def make_ruler_metal_material(name: str = "ArchRulerGunmetal") -> Any:
    """Brushed satin gunmetal stainless steel with dark engraved millimeter scale ticks."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-920, 0))

    # Fine engraved millimeter hash lines along ruler X axis (scale ~500 bands/m = 2 mm rhythm)
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.location = (-640, 160)
    wave.wave_type = "BANDS"
    wave.bands_direction = "X"
    wave.wave_profile = "SAW"
    wave.inputs["Scale"].default_value = 95.0
    wave.inputs["Distortion"].default_value = 0.0
    nt.links.new(mp.outputs["Vector"], wave.inputs["Vector"])

    mr_tick = add_map_range(nt, 0.80, 0.90, 0.0, 1.0, clamp=True, loc=(-440, 160))
    nt.links.new(wave.outputs["Fac"], mr_tick.inputs["Value"])

    _, fac_c, col_a, col_b, col_out = add_mix_color(nt, "MIX", loc=(-220, 160))
    col_a.default_value = (0.28, 0.29, 0.31, 1.0)  # brushed gunmetal steel
    col_b.default_value = (0.03, 0.03, 0.035, 1.0)  # dark etched scale graduations
    nt.links.new(mr_tick.outputs["Result"], fac_c)
    nt.links.new(col_out, get_input(bsdf, "Base Color"))

    set_input(bsdf, "Metallic", 0.90)
    set_input(bsdf, "Roughness", 0.34)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-80, -140)
    bump.inputs["Strength"].default_value = 0.06
    bump.inputs["Distance"].default_value = 0.00015
    nt.links.new(mr_tick.outputs["Result"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))
    return mat


def make_etched_ink_material(name: str = "NameplateEtchedInk") -> Any:
    """Crisp dark etched lettering (optional opt-in nameplate only)."""
    mat, _, bsdf, _ = get_or_create_material(name)
    set_input(bsdf, "Base Color", (0.012, 0.012, 0.014, 1.0))
    set_input(bsdf, "Roughness", 0.65)
    return mat


def make_brass_metal_material(name: str = "BrushedBrass") -> Any:
    """Warm satin architectural brass accent."""
    return make_brushed_metal_material(name=name, tint=(0.74, 0.54, 0.24, 1.0))
