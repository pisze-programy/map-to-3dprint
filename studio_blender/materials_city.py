"""Hero product Cycles PBR materials: gallery plaster city, matte black Variant C frame & backing."""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from .materials_core import (
    add_map_range,
    add_mix_color,
    add_tex_coord_mapping,
    apply_shadow_transparency_bypass,
    get_input,
    get_or_create_material,
    set_input,
)

# Museum cotton-rag passe-partout linear RGB swatches (sRGB -> linear):
# white #F2F0EB, ivory #EAE4D7, charcoal #18191C, greige #CFC8BC
PASSEPARTOUT_SWATCHES: Dict[str, Tuple[Tuple[float, float, float], Tuple[float, float, float], float]] = {
    "white": ((0.888, 0.871, 0.831), (0.842, 0.824, 0.785), 0.015),
    "ivory": ((0.823, 0.776, 0.680), (0.776, 0.728, 0.634), 0.015),
    "charcoal": ((0.0091, 0.0097, 0.0116), (0.0074, 0.0079, 0.0096), 0.0),
    "greige": ((0.624, 0.578, 0.503), (0.584, 0.538, 0.466), 0.010),
}


def make_plaster_cement_material(name: str = "PlasterCement") -> Any:
    """Gallery-white tactile matte 3D-printed resin / fine architectural plaster (#F2F0EB)."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-1000, -100))

    # Ultra-fine mineral resin/plaster tooth (~0.2 mm real-world grain for 90mm macro)
    n_fine = nt.nodes.new("ShaderNodeTexNoise")
    n_fine.location = (-740, -280)
    n_fine.inputs["Scale"].default_value = 2800.0
    n_fine.inputs["Detail"].default_value = 8.0
    n_fine.inputs["Roughness"].default_value = 0.68
    nt.links.new(mp.outputs["Vector"], n_fine.inputs["Vector"])

    # Subtle medium architectural plaster mottle (~2.5 mm)
    n_med = nt.nodes.new("ShaderNodeTexNoise")
    n_med.location = (-740, -40)
    n_med.inputs["Scale"].default_value = 340.0
    n_med.inputs["Detail"].default_value = 5.0
    n_med.inputs["Roughness"].default_value = 0.55
    nt.links.new(mp.outputs["Vector"], n_med.inputs["Vector"])

    # Broad gallery-plaster tonal warmth (~15 mm)
    n_broad = nt.nodes.new("ShaderNodeTexNoise")
    n_broad.location = (-740, 200)
    n_broad.inputs["Scale"].default_value = 65.0
    n_broad.inputs["Detail"].default_value = 3.0
    n_broad.inputs["Roughness"].default_value = 0.50
    nt.links.new(mp.outputs["Vector"], n_broad.inputs["Vector"])

    _, fac_t, col_a, col_b, tone_out = add_mix_color(nt, "MIX", loc=(-420, 240))
    col_a.default_value = (0.815, 0.800, 0.770, 1.0)
    col_b.default_value = (0.745, 0.730, 0.700, 1.0)
    mr_tone = add_map_range(nt, 0.30, 0.70, 0.0, 1.0, loc=(-560, 240))
    nt.links.new(n_broad.outputs["Fac"], mr_tone.inputs["Value"])
    nt.links.new(mr_tone.outputs["Result"], fac_t)

    # Local Ambient Occlusion darkening deep street canyons & courtyards (samples=4 for fast Metal)
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao.location = (-560, 440)
    ao.samples = 4
    ao.only_local = True
    ao.inputs["Distance"].default_value = 0.0095
    nt.links.new(tone_out, ao.inputs["Color"])

    mr_ao = add_map_range(nt, 0.0, 1.0, 0.68, 1.0, clamp=True, loc=(-360, 440))
    nt.links.new(ao.outputs["AO"], mr_ao.inputs["Value"])

    _, fac_ao, ao_a, ao_b, final_col = add_mix_color(nt, "MULTIPLY", loc=(-120, 320))
    fac_ao.default_value = 1.0
    nt.links.new(tone_out, ao_a)

    comb = nt.nodes.new("ShaderNodeCombineColor")
    comb.location = (-240, 440)
    nt.links.new(mr_ao.outputs["Result"], comb.inputs["Red"])
    nt.links.new(mr_ao.outputs["Result"], comb.inputs["Green"])
    nt.links.new(mr_ao.outputs["Result"], comb.inputs["Blue"])
    nt.links.new(comb.outputs["Color"], ao_b)

    nt.links.new(final_col, get_input(bsdf, "Base Color"))

    mr_rough = add_map_range(nt, 0.25, 0.75, 0.54, 0.72, clamp=True, loc=(-240, -20))
    nt.links.new(n_med.outputs["Fac"], mr_rough.inputs["Value"])
    nt.links.new(mr_rough.outputs["Result"], get_input(bsdf, "Roughness"))

    math_mix = nt.nodes.new("ShaderNodeMath")
    math_mix.operation = "MULTIPLY_ADD"
    math_mix.location = (-460, -240)
    math_mix.inputs[1].default_value = 0.35
    nt.links.new(n_med.outputs["Fac"], math_mix.inputs[0])
    nt.links.new(n_fine.outputs["Fac"], math_mix.inputs[2])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-80, -240)
    bump.inputs["Strength"].default_value = 0.145
    bump.inputs["Distance"].default_value = 0.0004
    nt.links.new(math_mix.outputs["Value"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))

    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.22)
    set_input(bsdf, ("Subsurface Weight", "Subsurface"), 0.042)
    set_input(bsdf, "Subsurface Scale", 0.0007)
    set_input(bsdf, "Subsurface Radius", (1.0, 0.93, 0.84))
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.0)
    return mat


def make_matte_black_frame_material(name: str = "MatteBlackFrame") -> Any:
    """True neutral jet-black matte Variant C frame (#0A0A0C, Roughness 0.80, zero mirror glare)."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-860, 0))

    # Fine powder-coat / bead-blasted anodized matte micro-grain (neutral, zero wood grain/brown)
    n_micro = nt.nodes.new("ShaderNodeTexNoise")
    n_micro.location = (-600, -140)
    n_micro.inputs["Scale"].default_value = 2200.0
    n_micro.inputs["Detail"].default_value = 6.0
    n_micro.inputs["Roughness"].default_value = 0.65
    nt.links.new(mp.outputs["Vector"], n_micro.inputs["Vector"])

    # Strictly neutral jet-black linear albedo (~#0A0A0C sRGB), zero warm/brown tint
    set_input(bsdf, "Base Color", (0.0022, 0.0022, 0.0026, 1.0))
    set_input(bsdf, "Metallic", 0.06)
    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.14)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.0)

    mr_r = add_map_range(nt, 0.25, 0.75, 0.76, 0.84, clamp=True, loc=(-280, 40))
    nt.links.new(n_micro.outputs["Fac"], mr_r.inputs["Value"])
    nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-80, -160)
    bump.inputs["Strength"].default_value = 0.045
    bump.inputs["Distance"].default_value = 0.00015
    nt.links.new(n_micro.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))
    return mat


def make_black_frame_material(style: str = "matte_black", name: Optional[str] = None) -> Any:
    """Backwards-compatible frame material entry point defaulting to neutral MatteBlackFrame."""
    mat_name = name or "MatteBlackFrame"
    if (style or "matte_black").lower() == "satin_metal":
        mat, nt, bsdf, _ = get_or_create_material(name or "BlackFrameSatinMetal")
        _, mp = add_tex_coord_mapping(nt, scale=(4.0, 120.0, 120.0), loc=(-800, 0))
        n_brush = nt.nodes.new("ShaderNodeTexNoise")
        n_brush.location = (-540, 0)
        n_brush.inputs["Scale"].default_value = 25.0
        n_brush.inputs["Detail"].default_value = 6.0
        nt.links.new(mp.outputs["Vector"], n_brush.inputs["Vector"])

        set_input(bsdf, "Base Color", (0.004, 0.004, 0.005, 1.0))
        set_input(bsdf, "Metallic", 0.82)
        set_input(bsdf, ("Specular IOR Level", "Specular"), 0.20)
        set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.0)
        mr_r = add_map_range(nt, 0.25, 0.75, 0.52, 0.64, loc=(-240, 40))
        nt.links.new(n_brush.outputs["Fac"], mr_r.inputs["Value"])
        nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))
        return mat
    return make_matte_black_frame_material(name=mat_name)


def make_matte_black_backing_material(
    finish: str = "matte_black",
    name: Optional[str] = None,
) -> Any:
    """Deep matte or satin archival black backing board under water cutouts (zero mirror reflection)."""
    finish_key = (finish or "matte_black").lower()
    mat_name = name or ("MatteBlackBacking" if finish_key == "matte_black" else "SatinBlackBacking")
    mat, nt, bsdf, _ = get_or_create_material(mat_name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-820, -120))

    n_board = nt.nodes.new("ShaderNodeTexNoise")
    n_board.location = (-560, -120)
    n_board.inputs["Scale"].default_value = 1400.0
    n_board.inputs["Detail"].default_value = 5.0
    n_board.inputs["Roughness"].default_value = 0.60
    nt.links.new(mp.outputs["Vector"], n_board.inputs["Vector"])

    # Deep archival black (#060608) with zero coat and low specular -> zero inverted skyscraper mirror
    set_input(bsdf, "Base Color", (0.0009, 0.0009, 0.0012, 1.0))
    set_input(bsdf, "Metallic", 0.0)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.0)

    if finish_key == "satin_black":
        set_input(bsdf, ("Specular IOR Level", "Specular"), 0.16)
        r_min, r_max = 0.38, 0.48
    else:
        set_input(bsdf, ("Specular IOR Level", "Specular"), 0.12)
        r_min, r_max = 0.58, 0.68

    mr_r = add_map_range(nt, 0.25, 0.75, r_min, r_max, clamp=True, loc=(-260, -40))
    nt.links.new(n_board.outputs["Fac"], mr_r.inputs["Value"])
    nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-80, -200)
    bump.inputs["Strength"].default_value = 0.03
    bump.inputs["Distance"].default_value = 0.00012
    nt.links.new(n_board.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))
    return mat


def make_obsidian_water_material(name: str = "MatteBlackBacking") -> Any:
    """Backwards-compatible alias mapped to non-mirror MatteBlackBacking."""
    return make_matte_black_backing_material(finish="matte_black", name=name)


def make_acrylic_cover_material(name: str = "AcrylicCover") -> Any:
    """Crystal-clear beveled museum acrylic display cover (IOR 1.49)."""
    mat, nt, bsdf, out = get_or_create_material(name)
    set_input(bsdf, "Base Color", (0.985, 0.992, 0.996, 1.0))
    set_input(bsdf, "Roughness", 0.012)
    set_input(bsdf, "IOR", 1.49)
    set_input(bsdf, ("Transmission Weight", "Transmission"), 0.98)
    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.50)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.25)
    set_input(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.01)

    apply_shadow_transparency_bypass(nt, bsdf.outputs["BSDF"], out, shadow_tint=(0.985, 0.99, 0.995, 1.0))
    return mat


def make_rubber_foot_material(name: str = "RubberFoot") -> Any:
    """Matte dark felt/rubber pads underneath the frame."""
    mat, _, bsdf, _ = get_or_create_material(name)
    set_input(bsdf, "Base Color", (0.008, 0.008, 0.009, 1.0))
    set_input(bsdf, "Roughness", 0.92)
    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.10)
    return mat


def make_a4_gallery_frame_material(name: str = "MatteBlackGalleryFrameA4") -> Any:
    """Heavy 30mm A4 gallery jet-black matte frame (Roughness 0.74, zero mirror glare/brown tint)."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-880, 0))

    n_micro = nt.nodes.new("ShaderNodeTexNoise")
    n_micro.location = (-620, -140)
    n_micro.inputs["Scale"].default_value = 2400.0
    n_micro.inputs["Detail"].default_value = 6.0
    n_micro.inputs["Roughness"].default_value = 0.65
    nt.links.new(mp.outputs["Vector"], n_micro.inputs["Vector"])

    # Strictly neutral jet-black matte architectural lacquer (~#0A0A0C sRGB), zero brown tint
    set_input(bsdf, "Base Color", (0.0024, 0.0024, 0.0028, 1.0))
    set_input(bsdf, "Metallic", 0.04)
    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.16)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.0)

    mr_r = add_map_range(nt, 0.25, 0.75, 0.70, 0.78, clamp=True, loc=(-280, 40))
    nt.links.new(n_micro.outputs["Fac"], mr_r.inputs["Value"])
    nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-80, -160)
    bump.inputs["Strength"].default_value = 0.04
    bump.inputs["Distance"].default_value = 0.00014
    nt.links.new(n_micro.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))
    return mat


def make_passepartout_material(
    color_name: str = "white",
    is_bevel_core: bool = False,
    name: Optional[str] = None,
) -> Any:
    """Cotton-rag museum matboard (top face in white/ivory/charcoal/greige, or bright white bevel core)."""
    color_key = (color_name or "white").strip().lower()
    if color_key not in PASSEPARTOUT_SWATCHES:
        color_key = "white"

    if is_bevel_core:
        mat_name = name or "PassePartoutBevelCore"
        # Bright museum-white cut cotton-rag paper core (#F5F3EE sRGB -> linear)
        col_hi = (0.913, 0.896, 0.855)
        col_lo = (0.878, 0.860, 0.818)
        r_min, r_max = 0.85, 0.91
        sss_w = 0.02
        bump_str = 0.070
        fine_scale = 3400.0
    else:
        mat_name = name or f"PassePartout_{color_key}"
        col_hi, col_lo, sss_w = PASSEPARTOUT_SWATCHES[color_key]
        r_min, r_max = 0.82, 0.90
        bump_str = 0.055
        fine_scale = 2400.0

    mat, nt, bsdf, _ = get_or_create_material(mat_name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-960, -80))

    n_fiber = nt.nodes.new("ShaderNodeTexNoise")
    n_fiber.location = (-680, -240)
    n_fiber.inputs["Scale"].default_value = fine_scale
    n_fiber.inputs["Detail"].default_value = 8.0
    n_fiber.inputs["Roughness"].default_value = 0.72
    nt.links.new(mp.outputs["Vector"], n_fiber.inputs["Vector"])

    n_rag = nt.nodes.new("ShaderNodeTexNoise")
    n_rag.location = (-680, 40)
    n_rag.inputs["Scale"].default_value = 260.0
    n_rag.inputs["Detail"].default_value = 4.0
    n_rag.inputs["Roughness"].default_value = 0.55
    nt.links.new(mp.outputs["Vector"], n_rag.inputs["Vector"])

    _, fac_c, col_a, col_b, col_out = add_mix_color(nt, "MIX", loc=(-360, 160))
    col_a.default_value = (*col_hi, 1.0)
    col_b.default_value = (*col_lo, 1.0)
    mr_c = add_map_range(nt, 0.30, 0.70, 0.0, 1.0, clamp=True, loc=(-500, 160))
    nt.links.new(n_rag.outputs["Fac"], mr_c.inputs["Value"])
    nt.links.new(mr_c.outputs["Result"], fac_c)
    nt.links.new(col_out, get_input(bsdf, "Base Color"))

    mr_r = add_map_range(nt, 0.25, 0.75, r_min, r_max, clamp=True, loc=(-280, -20))
    nt.links.new(n_fiber.outputs["Fac"], mr_r.inputs["Value"])
    nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))

    math_mix = nt.nodes.new("ShaderNodeMath")
    math_mix.operation = "MULTIPLY_ADD"
    math_mix.location = (-440, -220)
    math_mix.inputs[1].default_value = 0.35
    nt.links.new(n_rag.outputs["Fac"], math_mix.inputs[0])
    nt.links.new(n_fiber.outputs["Fac"], math_mix.inputs[2])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-80, -220)
    bump.inputs["Strength"].default_value = bump_str
    bump.inputs["Distance"].default_value = 0.00018
    nt.links.new(math_mix.outputs["Value"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))

    set_input(bsdf, "Metallic", 0.0)
    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.16)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.0)
    set_input(bsdf, ("Sheen Weight", "Sheen"), 0.12)
    set_input(bsdf, ("Subsurface Weight", "Subsurface"), sss_w)
    if sss_w > 0.0:
        set_input(bsdf, "Subsurface Scale", 0.0005)
    return mat


def make_matte_black_paper_material(name: str = "MatteBlackArchivalPaper") -> Any:
    """Thick matte-black archival paper backing (#070709, Roughness 0.74, cotton fiber micro-bump, zero glare)."""
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-880, -100))

    n_fiber = nt.nodes.new("ShaderNodeTexNoise")
    n_fiber.location = (-620, -200)
    n_fiber.inputs["Scale"].default_value = 2600.0
    n_fiber.inputs["Detail"].default_value = 7.0
    n_fiber.inputs["Roughness"].default_value = 0.68
    nt.links.new(mp.outputs["Vector"], n_fiber.inputs["Vector"])

    n_tooth = nt.nodes.new("ShaderNodeTexNoise")
    n_tooth.location = (-620, 40)
    n_tooth.inputs["Scale"].default_value = 360.0
    n_tooth.inputs["Detail"].default_value = 4.0
    n_tooth.inputs["Roughness"].default_value = 0.55
    nt.links.new(mp.outputs["Vector"], n_tooth.inputs["Vector"])

    # Deep thick matte black archival paper (#070709 sRGB -> linear ~0.0021, 0.0021, 0.0027)
    set_input(bsdf, "Base Color", (0.0021, 0.0021, 0.0027, 1.0))
    set_input(bsdf, "Metallic", 0.0)
    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.11)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.0)
    set_input(bsdf, ("Sheen Weight", "Sheen"), 0.08)

    mr_r = add_map_range(nt, 0.25, 0.75, 0.70, 0.78, clamp=True, loc=(-280, -20))
    nt.links.new(n_fiber.outputs["Fac"], mr_r.inputs["Value"])
    nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))

    math_mix = nt.nodes.new("ShaderNodeMath")
    math_mix.operation = "MULTIPLY_ADD"
    math_mix.location = (-400, -180)
    math_mix.inputs[1].default_value = 0.30
    nt.links.new(n_tooth.outputs["Fac"], math_mix.inputs[0])
    nt.links.new(n_fiber.outputs["Fac"], math_mix.inputs[2])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-80, -180)
    bump.inputs["Strength"].default_value = 0.055
    bump.inputs["Distance"].default_value = 0.00014
    nt.links.new(math_mix.outputs["Value"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))
    return mat
