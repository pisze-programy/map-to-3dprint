"""Chalk-plaster architectural 3D-print shader for 18_detail_chalk_gallery macro detail views."""

from __future__ import annotations

import math
from typing import Any

from .materials_core import (
    add_map_range,
    add_mix_color,
    add_tex_coord_mapping,
    get_input,
    get_or_create_material,
    set_input,
)


def make_chalk_plaster_material(name: str = "PlasterChalkDetail") -> Any:
    """Dry chalky matte architectural 3D-print plaster (#F0EEE9, Roughness 0.85..0.93).

    Combines fine powdery gypsum micro-grain, subtle 0.1 mm vertical-wall MSLA print-kiss
    micro-tooth (physically masked off flat roofs via Normal.Z), and crisp street-canyon
    local Ambient Occlusion so close-up architectural stills read as physical tactile chalk
    models rather than smooth plastic.
    """
    mat, nt, bsdf, _ = get_or_create_material(name)
    _, mp = add_tex_coord_mapping(nt, scale=(1.0, 1.0, 1.0), loc=(-1280, -80))

    # 1. Fine dry chalk powder micro-grain (~0.15 mm)
    n_chalk = nt.nodes.new("ShaderNodeTexNoise")
    n_chalk.location = (-960, -260)
    n_chalk.inputs["Scale"].default_value = 3800.0
    n_chalk.inputs["Detail"].default_value = 9.0
    n_chalk.inputs["Roughness"].default_value = 0.74
    nt.links.new(mp.outputs["Vector"], n_chalk.inputs["Vector"])

    # 2. Medium matte mineral tooth (~2.0 mm)
    n_tooth = nt.nodes.new("ShaderNodeTexNoise")
    n_tooth.location = (-960, -20)
    n_tooth.inputs["Scale"].default_value = 420.0
    n_tooth.inputs["Detail"].default_value = 5.0
    n_tooth.inputs["Roughness"].default_value = 0.58
    nt.links.new(mp.outputs["Vector"], n_tooth.inputs["Vector"])

    # 3. Broad subtle architectural gypsum tonal warmth (~18 mm)
    n_broad = nt.nodes.new("ShaderNodeTexNoise")
    n_broad.location = (-960, 220)
    n_broad.inputs["Scale"].default_value = 55.0
    n_broad.inputs["Detail"].default_value = 3.0
    n_broad.inputs["Roughness"].default_value = 0.50
    nt.links.new(mp.outputs["Vector"], n_broad.inputs["Vector"])

    # Pure dry chalk white (#F0EEE9 sRGB -> linear ~0.885, 0.878, 0.854)
    _, fac_t, col_a, col_b, tone_out = add_mix_color(nt, "MIX", loc=(-600, 260))
    col_a.default_value = (0.888, 0.880, 0.856, 1.0)
    col_b.default_value = (0.836, 0.828, 0.804, 1.0)
    mr_tone = add_map_range(nt, 0.28, 0.72, 0.0, 1.0, clamp=True, loc=(-760, 260))
    nt.links.new(n_broad.outputs["Fac"], mr_tone.inputs["Value"])
    nt.links.new(mr_tone.outputs["Result"], fac_t)

    # Crisp architectural crevice Ambient Occlusion for razor-defined street canyons & podiums
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao.location = (-720, 460)
    ao.samples = 6
    ao.only_local = True
    ao.inputs["Distance"].default_value = 0.0070
    nt.links.new(tone_out, ao.inputs["Color"])

    mr_ao = add_map_range(nt, 0.0, 1.0, 0.56, 1.0, clamp=True, loc=(-500, 460))
    nt.links.new(ao.outputs["AO"], mr_ao.inputs["Value"])

    comb_ao = nt.nodes.new("ShaderNodeCombineColor")
    comb_ao.location = (-340, 460)
    nt.links.new(mr_ao.outputs["Result"], comb_ao.inputs["Red"])
    nt.links.new(mr_ao.outputs["Result"], comb_ao.inputs["Green"])
    nt.links.new(mr_ao.outputs["Result"], comb_ao.inputs["Blue"])

    _, fac_ao, ao_a, ao_b, final_col = add_mix_color(nt, "MULTIPLY", loc=(-160, 320))
    fac_ao.default_value = 1.0
    nt.links.new(tone_out, ao_a)
    nt.links.new(comb_ao.outputs["Color"], ao_b)
    nt.links.new(final_col, get_input(bsdf, "Base Color"))

    # Ultra-dry powdery chalk roughness (0.85 .. 0.93) with zero plastic glare
    mr_rough = add_map_range(nt, 0.22, 0.78, 0.85, 0.93, clamp=True, loc=(-320, 20))
    nt.links.new(n_chalk.outputs["Fac"], mr_rough.inputs["Value"])
    nt.links.new(mr_rough.outputs["Result"], get_input(bsdf, "Roughness"))

    # Ultra-fine 0.1 mm horizontal MSLA print-kiss micro-tooth masked strictly to vertical walls
    sep_pos = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep_pos.location = (-1040, -520)
    nt.links.new(mp.outputs["Vector"], sep_pos.inputs["Vector"])

    # Phase = Z * (2*pi / 0.0001 m) + subtle noise jitter to prevent CGI moire
    z_freq = nt.nodes.new("ShaderNodeMath")
    z_freq.operation = "MULTIPLY"
    z_freq.location = (-860, -500)
    z_freq.inputs[1].default_value = 2.0 * math.pi / 0.0001
    nt.links.new(sep_pos.outputs["Z"], z_freq.inputs[0])

    z_jitter = nt.nodes.new("ShaderNodeMath")
    z_jitter.operation = "MULTIPLY_ADD"
    z_jitter.location = (-680, -500)
    z_jitter.inputs[1].default_value = 0.55
    nt.links.new(n_tooth.outputs["Fac"], z_jitter.inputs[0])
    nt.links.new(z_freq.outputs["Value"], z_jitter.inputs[2])

    z_sin = nt.nodes.new("ShaderNodeMath")
    z_sin.operation = "SINE"
    z_sin.location = (-520, -500)
    nt.links.new(z_jitter.outputs["Value"], z_sin.inputs[0])

    mr_layer = add_map_range(nt, -1.0, 1.0, 0.0, 1.0, clamp=True, loc=(-380, -500))
    nt.links.new(z_sin.outputs["Value"], mr_layer.inputs["Value"])

    # Vertical-wall mask = 1 - abs(Normal.Z) so flat roofs keep isotropic chalk tooth
    geom = nt.nodes.new("ShaderNodeNewGeometry")
    geom.location = (-1040, -700)
    sep_n = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep_n.location = (-860, -700)
    nt.links.new(geom.outputs["Normal"], sep_n.inputs["Vector"])

    abs_nz = nt.nodes.new("ShaderNodeMath")
    abs_nz.operation = "ABSOLUTE"
    abs_nz.location = (-700, -700)
    nt.links.new(sep_n.outputs["Z"], abs_nz.inputs[0])

    wall_mask = nt.nodes.new("ShaderNodeMath")
    wall_mask.operation = "SUBTRACT"
    wall_mask.location = (-540, -700)
    wall_mask.inputs[0].default_value = 1.0
    nt.links.new(abs_nz.outputs["Value"], wall_mask.inputs[1])

    layer_masked = nt.nodes.new("ShaderNodeMath")
    layer_masked.operation = "MULTIPLY"
    layer_masked.location = (-220, -540)
    nt.links.new(mr_layer.outputs["Result"], layer_masked.inputs[0])
    nt.links.new(wall_mask.outputs["Value"], layer_masked.inputs[1])

    # Combine fine chalk powder (dominant) + medium tooth + gentle 0.1 mm wall print-kiss
    mix_grain = nt.nodes.new("ShaderNodeMath")
    mix_grain.operation = "MULTIPLY_ADD"
    mix_grain.location = (-540, -240)
    mix_grain.inputs[1].default_value = 0.30
    nt.links.new(n_tooth.outputs["Fac"], mix_grain.inputs[0])
    nt.links.new(n_chalk.outputs["Fac"], mix_grain.inputs[2])

    mix_all = nt.nodes.new("ShaderNodeMath")
    mix_all.operation = "MULTIPLY_ADD"
    mix_all.location = (-220, -260)
    mix_all.inputs[1].default_value = 0.14
    nt.links.new(layer_masked.outputs["Value"], mix_all.inputs[0])
    nt.links.new(mix_grain.outputs["Value"], mix_all.inputs[2])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-40, -260)
    bump.inputs["Strength"].default_value = 0.135
    bump.inputs["Distance"].default_value = 0.00022
    nt.links.new(mix_all.outputs["Value"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], get_input(bsdf, "Normal"))

    set_input(bsdf, "Metallic", 0.0)
    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.08)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.0)
    set_input(bsdf, ("Sheen Weight", "Sheen"), 0.14)
    set_input(bsdf, "Sheen Roughness", 0.80)
    set_input(bsdf, ("Subsurface Weight", "Subsurface"), 0.012)
    set_input(bsdf, "Subsurface Scale", 0.00030)
    set_input(bsdf, "Subsurface Radius", (1.0, 0.97, 0.92))
    return mat


def make_detail_bounce_floor_material(name: str = "DetailChalkBounceFloor") -> Any:
    """Restrained neutral indirect studio bounce plane (invisible to camera rays)."""
    mat, _, bsdf, _ = get_or_create_material(name)
    set_input(bsdf, "Base Color", (0.52, 0.53, 0.55, 1.0))
    set_input(bsdf, "Roughness", 0.96)
    set_input(bsdf, ("Specular IOR Level", "Specular"), 0.0)
    return mat


__all__ = [
    "make_chalk_plaster_material",
    "make_detail_bounce_floor_material",
]
