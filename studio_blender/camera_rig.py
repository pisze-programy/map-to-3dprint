"""Physical camera optics, exact 3D bounding-box NDC framing, and still shot presets.

Supports both `desk_flat` and `wall_mount` orientations across all 11 cohesive studio
environments and any exported city STL. Commercial 4-shot choreography lives in
`flow_director.py` and is re-exported here for a unified camera_rig API.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

try:
    import bpy
    from mathutils import Matrix, Vector
except ImportError:  # pragma: no cover
    bpy = None  # type: ignore
    Matrix = None  # type: ignore
    Vector = None  # type: ignore

from studio_blender.studio_presets import PERSONA_HERO_PROFILES, resolve_env_name


STILL_PRESETS: Tuple[str, ...] = (
    "hero_desk", "hero_wall", "macro_skyline", "macro_waterfront",
    "profile_low", "top_down", "packshot_iso",
    "detail_spire", "detail_canyon", "detail_oblique_grid", "detail_edge_horizon",
)

DEFAULT_STILL_BY_ENV: Dict[str, str] = {
    "01_architect_window_desk": "hero_desk", "02_creative_office_desk": "hero_desk",
    "03_morning_coffee_table": "hero_desk", "04_minimal_home_console": "hero_desk",
    "05_gallery_wall_sunlight": "hero_wall", "06_architect_slat_wall": "hero_wall",
    "07_evening_warm_desk": "hero_desk", "08_loft_concrete_studio": "hero_desk",
    "09_dark_cinematic": "hero_desk", "10_macro_editorial": "macro_skyline",
    "11_packshot_white": "packshot_iso", "18_detail_chalk_gallery": "detail_spire",
}

_DESK_HERO_PROFILES: Dict[str, Tuple[float, float, float, Optional[float], float, float, float]] = {
    # env_id: (lens_mm, fstop, elev_deg, fixed_yaw_or_None, shift_y, fill_x, fill_y)
    "01_architect_window_desk": (52.0, 3.2, 21.0, -16.0, 0.035, 0.72, 0.66),
    "02_creative_office_desk": (46.0, 3.0, 26.0, -18.0, 0.025, 0.66, 0.64),
    "03_morning_coffee_table": (52.0, 3.0, 25.0, -20.0, 0.030, 0.74, 0.68),
    "04_minimal_home_console": (54.0, 3.2, 18.0, -15.0, 0.045, 0.72, 0.64),
    "07_evening_warm_desk": (52.0, 2.6, 22.0, -18.0, 0.035, 0.74, 0.66),
    "08_loft_concrete_studio": (52.0, 3.2, 26.0, -20.0, 0.030, 0.74, 0.68),
    "09_dark_cinematic": (62.0, 2.6, 19.0, None, 0.015, 0.84, 0.76),
    **PERSONA_HERO_PROFILES,
}


def spherical_offset(yaw_deg: float, elev_deg: float, distance: float) -> Tuple[float, float, float]:
    """Offset vector from target to camera (yaw=0 -> -Y looking +Y; yaw<0 -> front-left)."""
    yaw = math.radians(yaw_deg)
    elev = math.radians(elev_deg)
    ce = math.cos(elev)
    return (math.sin(yaw) * ce * distance, -math.cos(yaw) * ce * distance, math.sin(elev) * distance)


def camera_basis(
    eye: Tuple[float, float, float],
    target: Tuple[float, float, float],
) -> Tuple[Tuple[float, float, float], Tuple[float, float, float], Tuple[float, float, float]]:
    """Compute orthonormal (right, up, forward) vectors for a camera looking eye -> target."""
    fx, fy, fz = target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]
    fl = math.sqrt(fx * fx + fy * fy + fz * fz)
    if fl < 1e-9:
        return ((1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, 1.0, 0.0))
    fwd = (fx / fl, fy / fl, fz / fl)
    wup = (0.0, 1.0, 0.0) if abs(fwd[2]) > 0.985 else (0.0, 0.0, 1.0)
    rx = fwd[1] * wup[2] - fwd[2] * wup[1]
    ry = fwd[2] * wup[0] - fwd[0] * wup[2]
    rz = fwd[0] * wup[1] - fwd[1] * wup[0]
    rl = math.sqrt(rx * rx + ry * ry + rz * rz)
    right = (rx / rl, ry / rl, rz / rl)
    up = (
        right[1] * fwd[2] - right[2] * fwd[1],
        right[2] * fwd[0] - right[0] * fwd[2],
        right[0] * fwd[1] - right[1] * fwd[0],
    )
    return (right, up, fwd)


def sensor_half_tangents(lens_mm: float, aspect: float, sensor_width_mm: float = 36.0) -> Tuple[float, float]:
    """Exact Blender camera half-FOV tangents for sensor_fit='AUTO'."""
    if aspect < 1.0:
        tan_v = (0.5 * sensor_width_mm) / lens_mm
        return (tan_v * aspect, tan_v)
    tan_h = (0.5 * sensor_width_mm) / lens_mm
    return (tan_h, tan_h / aspect)


def bbox_corners(
    x_min: float, x_max: float, y_min: float, y_max: float, z_min: float, z_max: float
) -> List[Tuple[float, float, float]]:
    return [(x, y, z) for x in (x_min, x_max) for y in (y_min, y_max) for z in (z_min, z_max)]


def compute_fit_distance(
    yaw_deg: float,
    elev_deg: float,
    target: Tuple[float, float, float],
    corners: Sequence[Tuple[float, float, float]],
    lens_mm: float,
    aspect: float,
    fill_x: float = 0.80,
    fill_y: float = 0.74,
    shift_y: float = 0.0,
    sensor_width_mm: float = 36.0,
) -> float:
    """Compute exact minimum camera distance so all 3D corners fit inside frame margins."""
    dir_to_cam = spherical_offset(yaw_deg, elev_deg, 1.0)
    probe_eye = (target[0] + dir_to_cam[0], target[1] + dir_to_cam[1], target[2] + dir_to_cam[2])
    right, up, _ = camera_basis(probe_eye, target)
    tan_h, tan_v = sensor_half_tangents(lens_mm, aspect, sensor_width_mm)
    shift_ndc_y = 2.0 * shift_y if aspect <= 1.0 else 2.0 * shift_y * aspect

    max_dist = 0.08
    for c in corners:
        rx, ry, rz = c[0] - target[0], c[1] - target[1], c[2] - target[2]
        proj_r = rx * right[0] + ry * right[1] + rz * right[2]
        proj_u = rx * up[0] + ry * up[1] + rz * up[2]
        proj_cam = rx * dir_to_cam[0] + ry * dir_to_cam[1] + rz * dir_to_cam[2]
        d_x = proj_cam + abs(proj_r) / max(tan_h * fill_x, 1e-5)
        top_allow = max(0.22, fill_y + shift_ndc_y)
        bot_allow = max(0.22, fill_y - shift_ndc_y)
        d_y = proj_cam + (proj_u / max(tan_v * top_allow, 1e-5) if proj_u >= 0.0 else (-proj_u) / max(tan_v * bot_allow, 1e-5))
        max_dist = max(max_dist, d_x, d_y)
    return max_dist


def compute_full_model_corners(
    model_bounds: Dict[str, Any],
    analysis: Dict[str, Any],
    mount: str = "desk_flat",
) -> List[Tuple[float, float, float]]:
    """Return 8 world-space bounding corners of the framed product in desk_flat or wall_mount."""
    outer_w = float(model_bounds.get("outer_width_m", analysis["frame_width_m"] + 0.008))
    outer_h = float(model_bounds.get("outer_height_m", analysis["frame_height_m"] + 0.008))
    max_z = max(
        float(analysis["max_z"]),
        float(model_bounds.get("cover_top_z", 0.0) or 0.0),
        float(model_bounds.get("frame_top_z", 0.004)),
    )
    if mount == "wall_mount":
        wall_y = float(model_bounds.get("wall_y", 0.006))
        return bbox_corners(-0.5 * outer_w, 0.5 * outer_w, -max_z, wall_y, -0.5 * outer_h, 0.5 * outer_h)
    desk_z = float(model_bounds.get("desk_z", model_bounds.get("desk_z_m", -0.006)))
    return bbox_corners(-0.5 * outer_w, 0.5 * outer_w, -0.5 * outer_h, 0.5 * outer_h, desk_z, max_z)


def compute_hero_cluster_corners(
    analysis: Dict[str, Any],
    mount: str = "desk_flat",
) -> Tuple[Tuple[float, float, float], List[Tuple[float, float, float]]]:
    """Build a tight 3D framing box around the hero skyscraper and adjacent skyline cluster."""
    hx, hy, hz = analysis["hero_peak"]
    sx, sy, sz = analysis["skyline_centroid"]
    fw = float(analysis["frame_width_m"])
    fh = float(analysis["frame_height_m"])
    max_z = float(analysis["max_z"])
    r_span = min(0.42 * fw, max(min(0.24 * fw, 0.034), min(0.38 * fh, 0.028), 0.28 * max_z))

    if mount == "wall_mount":
        # World Y is building protrusion (-max_z .. 0), World Z is vertical wall height
        tx = 0.62 * hx + 0.38 * sx
        ty = min(-0.006, 0.42 * hy + 0.28 * sy)
        tz = 0.62 * hz + 0.38 * sz
        corners = bbox_corners(
            min(tx - r_span, hx - 0.008), max(tx + r_span, hx + 0.008),
            -max_z * 1.05, 0.004,
            min(tz - r_span * 0.85, hz - 0.010), max(tz + r_span * 0.85, hz + 0.010),
        )
        return ((tx, ty, tz), corners)

    tx = 0.62 * hx + 0.38 * sx
    ty = 0.62 * hy + 0.38 * sy
    tz = max(0.42 * hz, 0.38 * max_z, 0.006)
    corners = bbox_corners(
        min(tx - r_span, hx - 0.008), max(tx + r_span, hx + 0.008),
        min(ty - r_span * 0.75, hy - 0.008), max(ty + r_span * 0.75, hy + 0.008),
        max(0.0, 0.06 * max_z), max_z * 1.05,
    )
    return ((tx, ty, tz), corners)


def look_at_matrix(eye: Tuple[float, float, float], target: Tuple[float, float, float]) -> Any:
    """Build exact Blender camera world matrix (looking down -Z, +Y up, zero roll)."""
    right, up, fwd = camera_basis(eye, target)
    return Matrix((
        (right[0], up[0], -fwd[0], eye[0]),
        (right[1], up[1], -fwd[1], eye[1]),
        (right[2], up[2], -fwd[2], eye[2]),
        (0.0, 0.0, 0.0, 1.0),
    ))


def ensure_studio_camera(scene: Any, name: str = "StudioCamera") -> Tuple[Any, Any]:
    """Create or retrieve the studio camera and its tracked DoF focus Empty."""
    if bpy is None:
        raise RuntimeError("ensure_studio_camera must be run inside Blender.")
    cam_obj = bpy.data.objects.get(name)
    if cam_obj is None or cam_obj.type != "CAMERA":
        cam_data = bpy.data.cameras.new(name)
        cam_obj = bpy.data.objects.new(name, cam_data)
        scene.collection.objects.link(cam_obj)
    else:
        cam_data = cam_obj.data

    cam_data.sensor_width, cam_data.sensor_fit = 36.0, "AUTO"
    cam_data.clip_start, cam_data.clip_end = 0.002, 50.0
    cam_data.dof.use_dof, cam_data.dof.aperture_blades = True, 0

    focus_name = f"{name}_FocusTarget"
    focus_obj = bpy.data.objects.get(focus_name)
    if focus_obj is None:
        focus_obj = bpy.data.objects.new(focus_name, None)
        focus_obj.empty_display_type, focus_obj.empty_display_size = "PLAIN_AXES", 0.008
        scene.collection.objects.link(focus_obj)

    cam_data.dof.focus_object = focus_obj
    scene.camera = cam_obj
    return cam_obj, focus_obj


def apply_camera_pose(
    cam_obj: Any,
    focus_obj: Any,
    eye: Tuple[float, float, float],
    target: Tuple[float, float, float],
    focus_point: Tuple[float, float, float],
    lens_mm: float,
    fstop: float,
    shift_x: float = 0.0,
    shift_y: float = 0.0,
    frame: Optional[int] = None,
) -> None:
    """Place camera + focus empty at exact pose; optionally keyframe at `frame`."""
    loc, rot_quat, _ = look_at_matrix(eye, target).decompose()
    cam_obj.rotation_mode = "QUATERNION"
    cam_obj.location = loc
    cam_obj.rotation_quaternion = rot_quat
    cam_obj.data.lens = float(lens_mm)
    cam_obj.data.shift_x = float(shift_x)
    cam_obj.data.shift_y = float(shift_y)
    cam_obj.data.dof.use_dof = True
    cam_obj.data.dof.aperture_fstop = float(fstop)
    focus_obj.location = Vector(focus_point)

    if frame is not None:
        cam_obj.keyframe_insert(data_path="location", frame=frame)
        cam_obj.keyframe_insert(data_path="rotation_quaternion", frame=frame)
        cam_obj.data.keyframe_insert(data_path="lens", frame=frame)
        cam_obj.data.keyframe_insert(data_path="shift_x", frame=frame)
        cam_obj.data.keyframe_insert(data_path="shift_y", frame=frame)
        cam_obj.data.dof.keyframe_insert(data_path="aperture_fstop", frame=frame)
        focus_obj.keyframe_insert(data_path="location", frame=frame)


def _compute_wall_still_pose(
    preset_name: str,
    analysis: Dict[str, Any],
    model_bounds: Dict[str, Any],
    aspect: float,
    env_name: str = "05_gallery_wall_sunlight",
) -> Dict[str, Any]:
    """Compute Architectural Digest wall-mount camera pose for upright portrait/gallery frames."""
    canonical_env = resolve_env_name(env_name)
    rec_yaw = float(analysis.get("recommended_yaw_deg", -26.0))
    hx, hy, hz = analysis["hero_peak"]  # hy is negative (-max_z) protrusion toward camera
    sx, sy, sz = analysis["skyline_centroid"]
    max_z = float(analysis["max_z"])
    full_corners = compute_full_model_corners(model_bounds, analysis, mount="wall_mount")

    if preset_name == "macro_skyline":
        lens, fstop, elev = 85.0, 2.0, -7.0
        yaw = -46.0 if rec_yaw <= 0.0 else 46.0
        shift_y = 0.0
        target, cluster_corners = compute_hero_cluster_corners(analysis, mount="wall_mount")
        dist = max(0.13, compute_fit_distance(yaw, elev, target, cluster_corners, lens, aspect, 0.86, 0.78))
        focus_pt = (hx, hy * 0.55, hz)
    elif preset_name == "profile_low":
        lens, fstop, elev = 85.0, 3.2, -3.0
        yaw = -56.0 if rec_yaw <= 0.0 else 56.0
        shift_y = 0.0
        target = (0.0, -0.35 * max_z, 0.0)
        dist = compute_fit_distance(yaw, elev, target, full_corners, lens, aspect, 0.80, 0.74)
        focus_pt = (hx, hy * 0.6, hz)
    elif preset_name == "top_down":
        lens, fstop, elev, yaw, shift_y = 75.0, 6.3, 0.0, 0.0, 0.0
        target = (0.0, -0.25 * max_z, 0.0)
        dist = compute_fit_distance(yaw, elev, target, full_corners, lens, aspect, 0.76, 0.72)
        focus_pt = (0.0, -0.30 * max_z, 0.0)
    else:  # hero_wall / hero_desk / packshot_iso / macro_waterfront
        lens, fstop, elev = 48.0, 3.2, -4.0
        yaw, shift_y = (-24.0 if rec_yaw <= 0.0 else 24.0), -0.04
        fill_x, fill_y = 0.46, 0.45
        target = (0.0, -0.26 * max_z, -0.032)
        dist = compute_fit_distance(yaw, elev, target, full_corners, lens, aspect, fill_x, fill_y, shift_y=shift_y)
        focus_pt = (0.55 * hx + 0.45 * sx, 0.55 * hy + 0.45 * sy, 0.55 * hz + 0.45 * sz)

    off = spherical_offset(yaw, elev, dist)
    eye = (target[0] + off[0], target[1] + off[1], target[2] + off[2])
    return {
        "preset": preset_name, "mount": "wall_mount",
        "eye": eye, "target": target, "focus_point": focus_pt,
        "lens_mm": lens, "fstop": fstop, "shift_x": 0.0, "shift_y": shift_y,
        "yaw_deg": yaw, "elev_deg": elev, "distance_m": dist,
    }


def compute_still_pose(
    preset_name: str,
    analysis: Dict[str, Any],
    model_bounds: Dict[str, Any],
    env_name: str = "01_architect_window_desk",
    aspect: float = 0.8,
    mount: str = "desk_flat",
) -> Dict[str, Any]:
    """Compute physical camera pose dict for any still preset, mount mode, and city STL."""
    if preset_name not in STILL_PRESETS:
        raise ValueError(f"Unknown still preset '{preset_name}'. Choose from {STILL_PRESETS}.")
    if preset_name.startswith("detail_"):
        from studio_blender.camera_detail import compute_detail_still_pose
        return compute_detail_still_pose(preset_name, analysis, model_bounds, aspect=aspect)
    if mount == "wall_mount" or preset_name == "hero_wall":
        return _compute_wall_still_pose(preset_name, analysis, model_bounds, aspect, env_name=env_name)

    canonical_env = resolve_env_name(env_name)
    rec_yaw = float(analysis.get("recommended_yaw_deg", -24.0))
    hx, hy, hz = analysis["hero_peak"]
    htx, hty = analysis.get("hero_tower_xy", [hx, hy])
    sx, sy, _ = analysis["skyline_centroid"]
    wx, wy, _ = analysis["water_centroid"]
    max_z = float(analysis["max_z"])
    desk_z = float(model_bounds.get("desk_z", model_bounds.get("desk_z_m", -0.006)))
    full_corners = compute_full_model_corners(model_bounds, analysis, mount="desk_flat")

    if preset_name == "hero_desk":
        prof = _DESK_HERO_PROFILES.get(canonical_env, _DESK_HERO_PROFILES["01_architect_window_desk"])
        lens, fstop, elev, fixed_yaw, shift_y, fill_x, fill_y = prof
        yaw = fixed_yaw if fixed_yaw is not None else rec_yaw
        target = (0.0, 0.0, 0.36 * max_z)
        focus_pt = (0.52 * htx + 0.48 * sx, 0.52 * hty + 0.48 * sy, 0.42 * max_z)
        dist = compute_fit_distance(yaw, elev, target, full_corners, lens, aspect, fill_x, fill_y, shift_y=shift_y)
        off = spherical_offset(yaw, elev, dist)
        eye = (target[0] + off[0], target[1] + off[1], max(desk_z + 0.015, target[2] + off[2]))
    elif preset_name == "macro_skyline":
        lens, fstop, elev, yaw, shift_y = 90.0, 2.0, 17.5, rec_yaw * 0.85, 0.02
        target, cluster_corners = compute_hero_cluster_corners(analysis, mount="desk_flat")
        dist = max(0.115, compute_fit_distance(yaw, elev, target, cluster_corners, lens, aspect, 0.88, 0.76, shift_y))
        off = spherical_offset(yaw, elev, dist)
        eye = (target[0] + off[0], target[1] + off[1], max(0.012, target[2] + off[2]))
        cam_dir = spherical_offset(yaw, elev, 1.0)
        focus_pt = (htx + cam_dir[0] * 0.003, hty + cam_dir[1] * 0.003, max(0.42 * hz, 0.008))
    elif preset_name == "macro_waterfront":
        lens, fstop, elev, shift_y = 75.0, 2.2, 32.0, 0.0
        water_side = analysis.get("water_side")
        yaw = -34.0 if water_side == "-X" else (34.0 if water_side == "+X" else rec_yaw * 1.15)
        target = (0.40 * hx + 0.35 * sx + 0.25 * wx, 0.40 * hy + 0.35 * sy + 0.25 * wy, 0.30 * max_z)
        _, cluster_corners = compute_hero_cluster_corners(analysis, mount="desk_flat")
        dist = max(0.12, compute_fit_distance(yaw, elev, target, list(cluster_corners) + [(wx, wy, 0.0)], lens, aspect, 0.86, 0.78))
        off = spherical_offset(yaw, elev, dist)
        eye = (target[0] + off[0], target[1] + off[1], max(0.025, target[2] + off[2]))
        focus_pt = (0.55 * hx + 0.45 * sx, 0.55 * hy + 0.45 * sy, 0.35 * max_z)
    elif preset_name == "profile_low":
        lens, fstop, elev, yaw, shift_y = 85.0, (6.3 if canonical_env == "11_packshot_white" else 3.5), 8.5, rec_yaw * 0.32, 0.01
        target = (0.0, 0.0, 0.44 * max_z)
        dist = compute_fit_distance(yaw, elev, target, full_corners, lens, aspect, 0.84, 0.72, shift_y)
        off = spherical_offset(yaw, elev, dist)
        eye = (target[0] + off[0], target[1] + off[1], max(desk_z + 0.012, target[2] + off[2]))
        focus_pt = (htx, hty, 0.45 * hz)
    elif preset_name == "top_down":
        lens, fstop, elev, yaw, shift_y = 85.0, 8.0, 89.6, 0.0, 0.0
        target = (0.0, 0.0, 0.18 * max_z)
        dist = compute_fit_distance(yaw, elev, target, full_corners, lens, aspect, 0.82, 0.82)
        off = spherical_offset(yaw, elev, dist)
        eye = (target[0] + off[0], target[1] + off[1], target[2] + off[2])
        focus_pt = (0.0, 0.0, 0.25 * max_z)
    else:  # packshot_iso
        lens, fstop, elev, yaw, shift_y = 68.0, 7.1, 28.0, rec_yaw, -0.02
        target = (0.0, 0.0, 0.22 * max_z + 0.25 * desk_z)
        dist = compute_fit_distance(yaw, elev, target, full_corners, lens, aspect, 0.90, 0.85, shift_y=shift_y)
        off = spherical_offset(yaw, elev, dist)
        eye = (target[0] + off[0], target[1] + off[1], target[2] + off[2])
        focus_pt = (0.5 * htx + 0.5 * sx, 0.5 * hty + 0.5 * sy, 0.34 * max_z)

    return {
        "preset": preset_name, "mount": "desk_flat",
        "eye": eye, "target": target, "focus_point": focus_pt,
        "lens_mm": lens, "fstop": fstop, "shift_x": 0.0, "shift_y": shift_y,
        "yaw_deg": yaw, "elev_deg": elev, "distance_m": dist,
    }


def setup_still_camera(
    scene: Any,
    preset_name: str,
    analysis: Dict[str, Any],
    model_bounds: Dict[str, Any],
    env_name: str = "01_architect_window_desk",
    aspect: float = 0.8,
    mount: str = "desk_flat",
) -> Dict[str, Any]:
    """Configure the active Blender camera for a still shot preset."""
    cam_obj, focus_obj = ensure_studio_camera(scene)
    pose = compute_still_pose(preset_name, analysis, model_bounds, env_name=env_name, aspect=aspect, mount=mount)
    apply_camera_pose(
        cam_obj, focus_obj, pose["eye"], pose["target"], pose["focus_point"],
        pose["lens_mm"], pose["fstop"], pose["shift_x"], pose["shift_y"], frame=None,
    )
    return {"camera": cam_obj, "focus_empty": focus_obj, "pose": pose}


from studio_blender.flow_director import (  # noqa: E402, F401
    COMMERCIAL_SHOT_SPECS, build_commercial_shot_plan, build_flow_prompts,
    ease_in_out_cubic, ease_in_out_quint, ease_out_decel, eval_easing,
    evaluate_shot_state, setup_commercial_sequence, speed_ramp_crash_zoom,
)
