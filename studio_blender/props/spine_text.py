"""Real macOS system-font 3D embossed/foil book spine typography for Blender Cycles."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Optional, Tuple

import bpy
from mathutils import Euler, Vector

from ..materials_personas import make_polished_gold_material
from ..materials_props import make_etched_ink_material

_FONT_CACHE: dict[str, Any] = {}

_SERIF_CANDIDATES: Tuple[str, ...] = (
    "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
    "/System/Library/Fonts/Supplemental/Didot.ttc",
)

_SANS_CANDIDATES: Tuple[str, ...] = (
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Supplemental/Futura.ttc",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
)


def _load_system_font(style: str = "serif") -> Optional[Any]:
    """Load and cache a crisp macOS system typeface into bpy.data.fonts."""
    key = style.lower()
    if key in _FONT_CACHE:
        cached = _FONT_CACHE[key]
        try:
            _ = cached.name
            return cached
        except ReferenceError:
            _FONT_CACHE.pop(key, None)

    cands = _SANS_CANDIDATES if key == "sans" else _SERIF_CANDIDATES
    for fp in cands:
        if Path(fp).is_file():
            try:
                fnt = bpy.data.fonts.load(fp, check_existing=True)
                _FONT_CACHE[key] = fnt
                return fnt
            except Exception:
                continue
    return None


def add_spine_label(
    name: str,
    text: str,
    collection: Any,
    location: Tuple[float, float, float],
    facing: str = "-Y",
    font_size_m: float = 0.0085,
    font_style: str = "serif",
    foil: str = "gold",
    letter_spacing: float = 1.12,
    extra_yaw_rad: float = 0.0,
) -> Any:
    """Create thin beveled 3D metallic-foil or ink spine text facing '-Y' or '-X'."""
    curve = bpy.data.curves.new(name=f"{name}_Curve", type="FONT")
    curve.body = text
    curve.size = float(font_size_m)
    curve.space_character = float(letter_spacing)
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.extrude = 0.00045
    curve.bevel_depth = 0.00008
    curve.bevel_resolution = 1
    curve.resolution_u = 8

    fnt = _load_system_font(font_style)
    if fnt is not None:
        curve.font = fnt

    if foil == "dark":
        mat = make_etched_ink_material("BookSpineDarkInkFoil")
    elif foil == "ivory":
        mat = bpy.data.materials.get("BookSpineIvoryFoil")
        if mat is None:
            from ..materials_core import get_or_create_material, set_input

            mat, _, bsdf, _ = get_or_create_material("BookSpineIvoryFoil")
            set_input(bsdf, "Base Color", (0.86, 0.82, 0.74, 1.0))
            set_input(bsdf, "Roughness", 0.35)
    else:
        mat = make_polished_gold_material("BookSpineSatinGoldFoil")

    curve.materials.append(mat)

    obj = bpy.data.objects.new(name, curve)
    obj.location = Vector(location)
    if facing == "-X":
        # Local +Z -> -X (outward), local +Y -> +Z (upright), local +X -> -Y (L->R)
        obj.rotation_euler = Euler((math.pi * 0.5, 0.0, -math.pi * 0.5 + extra_yaw_rad), "XYZ")
    else:
        # Default facing '-Y': local +Z -> -Y (outward), local +Y -> +Z (upright), local +X -> +X
        obj.rotation_euler = Euler((math.pi * 0.5, 0.0, extra_yaw_rad), "XYZ")

    collection.objects.link(obj)
    return obj
