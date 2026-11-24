"""Architectural slabs, cycloramas, window walls, twilight bokeh, gobos, and locked dark stage."""

from __future__ import annotations

import math
from typing import Any, List, Tuple

import bmesh
from mathutils import Matrix, Vector

from .. import materials
from ..materials_core import get_or_create_material
from .common import (
    add_bevel,
    aim_object_at,
    create_mesh_object,
    make_box_bm,
    spherical_offset,
)


def _box_mat(sx: float, sy: float, sz: float, center: Tuple[float, float, float]) -> Any:
    return Matrix.Translation(Vector(center)) @ Matrix.Diagonal((sx, sy, sz, 1.0))


def build_desk_slab(
    name: str,
    desk_z: float,
    width_x: float,
    depth_y: float,
    center_y: float,
    material: Any,
    collection: Any,
    thickness: float = 0.032,
) -> Any:
    """Build beveled real-world architectural tabletop, console, or plinth slab at exact desk_z."""
    bm = make_box_bm(width_x, depth_y, thickness, (0.0, center_y, desk_z - thickness * 0.5))
    obj = create_mesh_object(name, bm, collection, material=material, smooth=False)
    add_bevel(obj, width=0.0020, segments=3)
    return obj


def build_seamless_cyclorama(
    name: str,
    desk_z: float,
    width_x: float,
    back_y: float,
    rise_z: float,
    material: Any,
    collection: Any,
    front_y: float = -0.65,
) -> Any:
    """Build smooth curved studio infinity sweep grounded at exact desk_z."""
    bm = bmesh.new()
    hw = width_x * 0.5
    radius = min(0.32, rise_z * 0.45)
    flat_end_y = back_y - radius

    pts = [(front_y, desk_z), (flat_end_y, desk_z)]
    n_arc = 20
    for i in range(1, n_arc + 1):
        ang = -math.pi * 0.5 + (i / float(n_arc)) * (math.pi * 0.5)
        pts.append((flat_end_y + radius * math.cos(ang), desk_z + radius + radius * math.sin(ang)))
    pts.append((back_y, desk_z + rise_z))

    cols = [(bm.verts.new((-hw, py, pz)), bm.verts.new((hw, py, pz))) for py, pz in pts]
    for i in range(len(cols) - 1):
        bm.faces.new((cols[i][0], cols[i][1], cols[i + 1][1], cols[i + 1][0]))
    return create_mesh_object(name, bm, collection, material=material, smooth=True)


def _make_emission_mat(name: str, rgba: Tuple[float, float, float, float], strength: float) -> Any:
    mat, nt, _, out = get_or_create_material(name)
    em = nt.nodes.new("ShaderNodeEmission")
    em.location = (200, 0)
    em.inputs["Color"].default_value = rgba
    em.inputs["Strength"].default_value = float(strength)
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return mat


def _make_twilight_gradient_mat(desk_z: float, name: str = "WindowManhattanTwilightGrad") -> Any:
    """Deep velvety midnight charcoal-navy to subtle warm horizon twilight sky gradient."""
    mat, nt, _, out = get_or_create_material(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (-760, 0)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-540, 0)
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])

    # Object Z spans ~[-1.1, +1.1] on the sky pane; map lower horizon -> deep midnight top
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.clamp = True
    mr.location = (-340, 0)
    mr.inputs["From Min"].default_value = -0.75
    mr.inputs["From Max"].default_value = 0.25
    mr.inputs["To Min"].default_value = 0.0
    mr.inputs["To Max"].default_value = 1.0
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])

    mix_c = nt.nodes.new("ShaderNodeMix")
    mix_c.data_type = "RGBA"
    mix_c.location = (-120, 40)
    rgba_in = [s for s in mix_c.inputs if s.type == "RGBA"]
    rgba_out = [s for s in mix_c.outputs if s.type == "RGBA"]
    rgba_in[0].default_value = (0.022, 0.017, 0.022, 1.0)  # subtle warm twilight horizon haze
    rgba_in[1].default_value = (0.004, 0.007, 0.018, 1.0)  # deep velvety midnight charcoal-navy
    nt.links.new(mr.outputs["Result"], mix_c.inputs[0])

    em = nt.nodes.new("ShaderNodeEmission")
    em.location = (140, 40)
    em.inputs["Strength"].default_value = 0.72
    nt.links.new(rgba_out[0], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    _ = desk_z
    return mat


def _build_city_bokeh_lights(desk_z: float, collection: Any) -> List[Any]:
    """Create sparse pinpoint warm-amber Manhattan skyline lights far behind the penthouse window."""
    # Small distant pinpoints (r=2.2..5.5 mm at Y=1.95..2.95 m) in organic sparse warm 2200-2900K clusters
    mat_amber_hi = _make_emission_mat("CitySparkAmberHi", (1.0, 0.56, 0.16, 1.0), 19.0)
    mat_gold_mid = _make_emission_mat("CitySparkGoldMid", (1.0, 0.70, 0.28, 1.0), 11.5)
    mat_warm_dim = _make_emission_mat("CitySparkWarmDim", (1.0, 0.62, 0.24, 1.0), 4.5)
    mat_ember_lo = _make_emission_mat("CitySparkEmberLo", (1.0, 0.42, 0.10, 1.0), 7.0)
    palette = (mat_amber_hi, mat_gold_mid, mat_warm_dim, mat_ember_lo)

    orb_specs = (
        # Left distant tower cluster (sparse organic vertical rhythm)
        (-0.12, 2.35, -0.02, 0.0038, 2),
        (-0.08, 2.55, 0.04, 0.0048, 1),
        (-0.04, 2.15, -0.07, 0.0030, 3),
        (0.03, 2.68, 0.09, 0.0042, 2),
        # Center-left Manhattan cluster
        (0.11, 2.12, -0.05, 0.0036, 0),
        (0.15, 2.42, 0.02, 0.0052, 1),
        (0.18, 2.80, -0.09, 0.0028, 2),
        (0.24, 2.25, 0.07, 0.0040, 3),
        (0.29, 2.58, -0.03, 0.0034, 1),
        # Center-right skyline horizon scatter
        (0.37, 2.08, -0.06, 0.0046, 0),
        (0.41, 2.48, 0.01, 0.0032, 2),
        (0.46, 2.74, -0.10, 0.0026, 3),
        (0.51, 2.22, 0.05, 0.0050, 1),
        (0.55, 2.62, -0.04, 0.0030, 2),
        # Right distant high-rise glints above cut-crystal glass
        (0.64, 2.18, -0.01, 0.0044, 0),
        (0.69, 2.52, -0.08, 0.0032, 3),
        (0.74, 2.86, 0.06, 0.0048, 1),
        (0.79, 2.32, -0.03, 0.0028, 2),
        (0.86, 2.65, 0.02, 0.0038, 1),
    )

    objs: List[Any] = []
    for idx, (ox, oy, oz, rad, midx) in enumerate(orb_specs):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=rad)
        orb = create_mesh_object(
            f"Arch_CityBokehOrb_{idx:02d}",
            bm,
            collection,
            material=palette[midx],
            smooth=True,
            location=(ox, oy, desk_z + oz),
        )
        for attr in ("visible_diffuse", "visible_shadow", "visible_glossy"):
            if hasattr(orb, attr):
                setattr(orb, attr, False)
        objs.append(orb)
    return objs


def build_window_studio_wall(
    desk_z: float,
    wall_mat: Any,
    collection: Any,
    back_y: float = 0.72,
    evening: bool = False,
) -> List[Any]:
    """Build bright Scandinavian studio window bay or twilight Manhattan penthouse window."""
    objs: List[Any] = []
    mat_steel = materials.make_matte_black_tech_material(name="WindowMullionSteel")

    if evening:
        # Sweeping penthouse corner window framing deep twilight sky + golden bokeh orbs
        win_cx, win_w = 0.22, 1.24
        win_bot, win_top = desk_z + 0.04, desk_z + 1.32
        objs.append(create_mesh_object("Arch_WallLeft", make_box_bm(1.15, 0.08, 1.90, (-0.98, back_y, desk_z + 0.80)), collection, wall_mat))
        objs.append(create_mesh_object("Arch_WallRight", make_box_bm(1.10, 0.08, 1.90, (1.39, back_y, desk_z + 0.80)), collection, wall_mat))
        objs.append(create_mesh_object("Arch_WallSill", make_box_bm(1.30, 0.12, 0.28, (win_cx, back_y, desk_z - 0.10)), collection, wall_mat))
        objs.append(create_mesh_object("Arch_WallHeader", make_box_bm(1.30, 0.08, 0.35, (win_cx, back_y, desk_z + 1.48)), collection, wall_mat))
        v_mullions = (win_cx - win_w * 0.5, win_cx - 0.18, win_cx + 0.26, win_cx + win_w * 0.5)
        h_mullions = (win_bot, win_bot + 0.44, win_bot + 0.90, win_top)
    else:
        win_cx, win_w = 0.24, 1.02
        win_bot, win_top = desk_z + 0.09, desk_z + 1.26
        objs.append(create_mesh_object("Arch_WallLeft", make_box_bm(1.25, 0.08, 1.85, (-0.89, back_y, desk_z + 0.80)), collection, wall_mat))
        objs.append(create_mesh_object("Arch_WallRight", make_box_bm(1.15, 0.08, 1.85, (1.32, back_y, desk_z + 0.80)), collection, wall_mat))
        objs.append(create_mesh_object("Arch_WallSill", make_box_bm(1.12, 0.12, 0.28, (win_cx, back_y, desk_z - 0.05)), collection, wall_mat))
        objs.append(create_mesh_object("Arch_WallHeader", make_box_bm(1.12, 0.08, 0.35, (win_cx, back_y, desk_z + 1.42)), collection, wall_mat))
        v_mullions = (win_cx - win_w * 0.5, win_cx - 0.15, win_cx + 0.18, win_cx + win_w * 0.5)
        h_mullions = (win_bot, win_bot + 0.38, win_bot + 0.78, win_top)

    win_y = back_y + 0.03
    win_h = win_top - win_bot
    m_thick = 0.017

    for idx, mx in enumerate(v_mullions):
        objs.append(create_mesh_object(f"Arch_WinMullionV_{idx}", make_box_bm(m_thick, 0.032, win_h, (mx, win_y, win_bot + win_h * 0.5)), collection, mat_steel))
    for idx, mz in enumerate(h_mullions):
        objs.append(create_mesh_object(f"Arch_WinMullionH_{idx}", make_box_bm(win_w + m_thick, 0.032, m_thick, (win_cx, win_y, mz)), collection, mat_steel))

    if evening:
        sky_mat = _make_twilight_gradient_mat(desk_z)
        pane_y = 3.15
        pane_w = 3.40
        pane_h = 2.40
    else:
        sky_mat = _make_emission_mat("WindowBrightDaylight", (1.0, 0.99, 0.96, 1.0), 2.35)
        pane_y = win_y + 0.06
        pane_w = win_w + 0.12
        pane_h = win_h + 0.12

    pane = create_mesh_object(
        "Arch_WindowSkyPane",
        make_box_bm(pane_w, 0.008, pane_h, (win_cx, pane_y, win_bot + win_h * 0.5)),
        collection,
        sky_mat,
    )
    if hasattr(pane, "visible_diffuse"):
        pane.visible_diffuse = False
    if hasattr(pane, "visible_shadow"):
        pane.visible_shadow = False
    objs.append(pane)

    if evening:
        objs.extend(_build_city_bokeh_lights(desk_z, collection))
    return objs


def build_window_gobo(
    gobo_style: str,
    target_pt: Vector,
    key_az_deg: float,
    key_el_deg: float,
    key_dist: float,
    collection: Any,
) -> List[Any]:
    """Build physical camera-invisible architectural window mullions, blinds, or dappled leaf gobo."""
    style = (gobo_style or "none").lower()
    if style == "none":
        return []

    mat_blk = materials.make_rubber_foot_material(name="GoboBlockerMat")
    gobo_dist = key_dist * 0.52
    base_loc = target_pt + spherical_offset(key_az_deg, key_el_deg, gobo_dist)

    bm = bmesh.new()
    if style == "mullions":
        bar_specs = (
            (-0.26, 0.0, 0.0, 0.036, 0.92),
            (0.28, 0.0, 0.0, 0.036, 0.92),
            (0.0, 0.24, 0.0, 0.78, 0.032),
            (0.0, -0.28, 0.0, 0.78, 0.032),
        )
        for bx, by, bz, sx, sy in bar_specs:
            bmesh.ops.create_cube(bm, size=1.0, matrix=_box_mat(sx, sy, 0.004, (bx, by, bz)))
    elif style == "blinds":
        for idx in range(-4, 5):
            if idx in (-1, 0, 1):
                continue  # keep generous sunlit band across hero skyline & desk center
            by = idx * 0.078
            bmesh.ops.create_cube(bm, size=1.0, matrix=_box_mat(0.90, 0.018, 0.004, (0.0, by, 0.0)))
    elif style == "dappled":
        # Organic botanical branch & leaf canopy silhouette around the perimeter (leaves hero skyline sunlit!)
        leaf_specs = (
            (-0.32, 0.24, 0.08, 0.032, 22.0),
            (-0.24, 0.30, 0.09, 0.036, -18.0),
            (-0.15, 0.27, 0.07, 0.028, 35.0),
            (-0.28, 0.14, 0.08, 0.030, -32.0),
            (0.26, 0.25, 0.09, 0.034, -24.0),
            (0.34, 0.18, 0.08, 0.032, 18.0),
            (0.22, 0.32, 0.07, 0.028, 42.0),
            (0.30, -0.22, 0.09, 0.034, -28.0),
            (0.20, -0.28, 0.08, 0.030, 26.0),
            (-0.26, -0.25, 0.09, 0.034, -15.0),
            (-0.34, -0.16, 0.07, 0.028, 30.0),
            (0.02, 0.31, 0.08, 0.026, 12.0),
        )
        for lx, ly, sx, sy, ang_deg in leaf_specs:
            rot = Matrix.Rotation(math.radians(ang_deg), 4, "Z")
            mat_l = Matrix.Translation(Vector((lx, ly, 0.0))) @ rot @ Matrix.Diagonal((sx, sy, 0.004, 1.0))
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.5, matrix=mat_l)
    else:
        bm.free()
        return []

    gobo = create_mesh_object(f"Env_Gobo_{style}", bm, collection, material=mat_blk, location=tuple(base_loc))
    aim_object_at(gobo, target_pt)
    for attr in ("visible_camera", "visible_glossy", "visible_diffuse", "visible_transmission"):
        if hasattr(gobo, attr):
            setattr(gobo, attr, False)
    return [gobo]


def build_dark_cinematic_stage(
    desk_z: float,
    outer_h_m: float,
    plinth_mat: Any,
    collection: Any,
) -> List[Any]:
    """Honed volcanic basalt plinth + deep charcoal sweep + subtle atmospheric haze (LOCKED 09)."""
    objs: List[Any] = []
    objs.append(build_desk_slab("Env_BasaltPlinth", desk_z, 1.90, 1.35, 0.18, plinth_mat, collection))

    mat_bg = materials.make_editorial_backdrop_material(name="DarkCinematicSweep", dark=True)
    objs.append(build_seamless_cyclorama("Env_DarkCinematicSweep", desk_z - 0.002, 3.20, 0.98, 1.45, mat_bg, collection, front_y=-0.75))

    mat_haze = materials.make_volumetric_haze_material(density=0.015)
    haze_y0 = max(0.11, outer_h_m * 0.5 + 0.045)
    haze_y1 = 0.94
    haze_z0 = desk_z + 0.002
    haze_z1 = desk_z + 0.62
    bm_haze = make_box_bm(1.50, haze_y1 - haze_y0, haze_z1 - haze_z0, (0.0, 0.5 * (haze_y0 + haze_y1), 0.5 * (haze_z0 + haze_z1)))
    haze_box = create_mesh_object("Env_VolumetricHazeBox", bm_haze, collection, material=mat_haze)
    if hasattr(haze_box, "visible_shadow"):
        haze_box.visible_shadow = False
    objs.append(haze_box)
    return objs
