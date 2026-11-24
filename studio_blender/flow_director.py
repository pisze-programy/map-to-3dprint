"""4-shot commercial video choreography and easing curves for desk_flat and wall_mount.

Kept modular from camera_rig.py and flow_prompts.py so each module stays concise and
single-responsibility. Public symbols are also re-exported by camera_rig.py.
"""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from studio_blender import camera_rig
from studio_blender.flow_prompts import build_flow_prompts
from studio_blender.studio_presets import resolve_env_name


COMMERCIAL_SHOT_SPECS: Tuple[Dict[str, Any], ...] = (
    {
        "index": 1,
        "id": "shot01_hero_crash_zoom",
        "title": "Hero Establish -> Speed-Ramp Crash-Zoom",
        "start_sec": 0.0,
        "end_sec": 2.0,
        "duration_sec": 2.0,
        "easing": "speed_ramp_crash_zoom",
    },
    {
        "index": 2,
        "id": "shot02_crane_rise_raking_light",
        "title": "Low-Angle Crane Rise-Up + Raking Sunlight Sweep",
        "start_sec": 2.0,
        "end_sec": 4.0,
        "duration_sec": 2.0,
        "easing": "ease_in_out_cubic",
    },
    {
        "index": 3,
        "id": "shot03_overhead_canyon_swoop",
        "title": "Overhead-to-Eye-Level Arc Swoop into Street Canyon",
        "start_sec": 4.0,
        "end_sec": 6.5,
        "duration_sec": 2.5,
        "easing": "ease_in_out_quint",
    },
    {
        "index": 4,
        "id": "shot04_pullout_environment_reveal",
        "title": "Pull-Out Crane Reveal in Full Environment",
        "start_sec": 6.5,
        "end_sec": 9.0,
        "duration_sec": 2.5,
        "easing": "ease_out_decel",
    },
)


def clamp01(t: float) -> float:
    return 0.0 if t <= 0.0 else (1.0 if t >= 1.0 else t)


def ease_in_out_cubic(t: float) -> float:
    t = clamp01(t)
    return 4.0 * t * t * t if t < 0.5 else 1.0 - ((-2.0 * t + 2.0) ** 3) * 0.5


def ease_in_out_quint(t: float) -> float:
    t = clamp01(t)
    return 16.0 * (t ** 5) if t < 0.5 else 1.0 - ((-2.0 * t + 2.0) ** 5) * 0.5


def ease_out_decel(t: float) -> float:
    t = clamp01(t)
    return 0.45 * ease_in_out_cubic(t) + 0.55 * (1.0 - ((1.0 - t) ** 3))


def speed_ramp_crash_zoom(t: float) -> float:
    """Zero-freeze hook: gentle establish drift -> exponential rush -> smooth land."""
    t = clamp01(t)
    k, t0 = 8.5, 0.56
    s0 = 1.0 / (1.0 + math.exp(k * t0))
    s1 = 1.0 / (1.0 + math.exp(-k * (1.0 - t0)))
    sig = (1.0 / (1.0 + math.exp(-k * (t - t0))) - s0) / (s1 - s0)
    return clamp01(0.12 * t + 0.88 * sig)


def eval_easing(name: str, t: float) -> float:
    if name == "speed_ramp_crash_zoom":
        return speed_ramp_crash_zoom(t)
    if name == "ease_in_out_quint":
        return ease_in_out_quint(t)
    if name == "ease_out_decel":
        return ease_out_decel(t)
    return ease_in_out_cubic(t)


def _lerp(a: float, b: float, u: float) -> float:
    return a + (b - a) * u


def _lerp_vec(a: Sequence[float], b: Sequence[float], u: float) -> Tuple[float, float, float]:
    return (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u)


def _canyon_approach_yaw(analysis: Dict[str, Any]) -> float:
    portal = analysis.get("canyon_portal", {})
    dx, dy = portal.get("direction", [0.0, 1.0])
    return max(-56.0, min(56.0, math.degrees(math.atan2(-dx, max(dy, 0.15)))))


def _build_wall_commercial_plan(
    analysis: Dict[str, Any],
    model_bounds: Dict[str, Any],
    aspect: float,
    base_sun_az: float,
) -> List[Dict[str, Any]]:
    """Build 4 gallery wall-mount commercial shots framing the protruding 3D relief cleanly."""
    rec_yaw = float(analysis.get("recommended_yaw_deg", -26.0))
    side = -1.0 if rec_yaw <= 0.0 else 1.0
    hx, hy, hz = analysis["hero_peak"]
    sx, sy, sz = analysis["skyline_centroid"]
    max_z = float(analysis["max_z"])
    full_corners = camera_rig.compute_full_model_corners(model_bounds, analysis, mount="wall_mount")
    cluster_target, cluster_corners = camera_rig.compute_hero_cluster_corners(analysis, mount="wall_mount")

    est_target = (0.0, -0.22 * max_z, 0.0)
    est_dist = camera_rig.compute_fit_distance(side * 24.0, -4.0, est_target, full_corners, 50.0, aspect, 0.68, 0.62, -0.02)
    close_dist = max(0.13, camera_rig.compute_fit_distance(side * 38.0, -6.0, cluster_target, cluster_corners, 82.0, aspect, 0.86, 0.74))
    rise_dist = max(0.14, camera_rig.compute_fit_distance(side * 46.0, -4.0, (hx, hy * 0.5, hz), cluster_corners, 85.0, aspect, 0.84, 0.74))
    reveal_dist = camera_rig.compute_fit_distance(side * 28.0, -5.0, est_target, full_corners, 56.0, aspect, 0.66, 0.62, -0.025)

    return [
        {
            **COMMERCIAL_SHOT_SPECS[0], "mount": "wall_mount",
            "start": {"yaw": side * 24.0, "elev": -4.0, "dist": est_dist, "target": est_target, "focus": (0.5 * hx + 0.5 * sx, 0.5 * hy + 0.5 * sy, 0.5 * hz + 0.5 * sz), "lens": 50.0, "fstop": 3.5, "shift_y": -0.02, "sun_az": base_sun_az - 10.0, "sun_el": 28.0},
            "end": {"yaw": side * 38.0, "elev": -6.0, "dist": close_dist, "target": cluster_target, "focus": (hx, hy * 0.6, hz), "lens": 82.0, "fstop": 2.0, "shift_y": 0.0, "sun_az": base_sun_az + 12.0, "sun_el": 24.0},
        },
        {
            **COMMERCIAL_SHOT_SPECS[1], "mount": "wall_mount",
            "start": {"yaw": side * 52.0, "elev": -10.0, "dist": rise_dist * 1.05, "target": (hx, hy * 0.45, hz - 0.015), "focus": (hx, hy * 0.5, hz), "lens": 85.0, "fstop": 2.0, "shift_y": 0.0, "sun_az": base_sun_az - 24.0, "sun_el": 20.0},
            "end": {"yaw": side * 34.0, "elev": 4.0, "dist": rise_dist * 0.96, "target": (hx, hy * 0.65, hz + 0.012), "focus": (hx, hy * 0.65, hz), "lens": 85.0, "fstop": 2.0, "shift_y": 0.0, "sun_az": base_sun_az + 28.0, "sun_el": 30.0},
        },
        {
            **COMMERCIAL_SHOT_SPECS[2], "mount": "wall_mount",
            "start": {"yaw": -side * 16.0, "elev": 20.0, "dist": est_dist * 0.92, "target": (0.0, -0.25 * max_z, 0.01), "focus": (0.5 * hx + 0.5 * sx, 0.5 * hy + 0.5 * sy, 0.5 * hz + 0.5 * sz), "lens": 48.0, "fstop": 2.8, "shift_y": 0.0, "sun_az": base_sun_az + 16.0, "sun_el": 34.0},
            "end": {"yaw": side * 42.0, "elev": -8.0, "dist": close_dist * 1.02, "target": cluster_target, "focus": (hx, hy * 0.55, hz), "lens": 70.0, "fstop": 2.0, "shift_y": 0.0, "sun_az": base_sun_az - 14.0, "sun_el": 22.0},
        },
        {
            **COMMERCIAL_SHOT_SPECS[3], "mount": "wall_mount",
            "start": {"yaw": side * 36.0, "elev": -6.0, "dist": close_dist * 1.08, "target": cluster_target, "focus": (hx, hy * 0.55, hz), "lens": 74.0, "fstop": 2.2, "shift_y": 0.0, "sun_az": base_sun_az - 10.0, "sun_el": 24.0},
            "end": {"yaw": side * 28.0, "elev": -5.0, "dist": reveal_dist, "target": est_target, "focus": (0.5 * hx + 0.5 * sx, 0.5 * hy + 0.5 * sy, 0.5 * hz + 0.5 * sz), "lens": 56.0, "fstop": 3.5, "shift_y": -0.025, "sun_az": base_sun_az + 8.0, "sun_el": 28.0},
        },
    ]


def build_commercial_shot_plan(
    analysis: Dict[str, Any],
    model_bounds: Dict[str, Any],
    env_name: str = "01_architect_window_desk",
    aspect: float = 9.0 / 16.0,
    base_sun_azimuth_deg: float = 38.0,
    mount: str = "desk_flat",
) -> List[Dict[str, Any]]:
    """Build parameterized start/end/evaluator specs for all 4 commercial shots."""
    if mount == "wall_mount":
        return _build_wall_commercial_plan(analysis, model_bounds, aspect, base_sun_azimuth_deg)

    canonical = resolve_env_name(env_name)
    rec_yaw = float(analysis.get("recommended_yaw_deg", -25.0))
    portal_yaw = _canyon_approach_yaw(analysis)
    hx, hy, hz = analysis["hero_peak"]
    sx, sy, _ = analysis["skyline_centroid"]
    fw = float(analysis["frame_width_m"])
    max_z = float(analysis["max_z"])

    full_corners = camera_rig.compute_full_model_corners(model_bounds, analysis, mount="desk_flat")
    cluster_target, cluster_corners = camera_rig.compute_hero_cluster_corners(analysis, mount="desk_flat")

    est_elev = 28.0 if canonical in ("02_creative_office_desk", "08_loft_concrete_studio") else 22.0
    est_target = (0.0, 0.0, 0.38 * max_z)
    est_shift_y = 0.035 if canonical not in ("09_dark_cinematic", "11_packshot_white") else 0.015
    est_dist = camera_rig.compute_fit_distance(rec_yaw, est_elev, est_target, full_corners, 48.0, aspect, 0.76, 0.62, est_shift_y)

    close_yaw = rec_yaw * 0.55
    close_dist = max(0.115, camera_rig.compute_fit_distance(close_yaw, 15.0, cluster_target, cluster_corners, 78.0, aspect, 0.90, 0.72))

    tower_box_r = max(0.016, 0.18 * fw, 0.25 * hz)
    tower_corners = camera_rig.bbox_corners(hx - tower_box_r, hx + tower_box_r, hy - tower_box_r, hy + tower_box_r, 0.0, hz * 1.08)
    rise_dist = max(0.110, camera_rig.compute_fit_distance(rec_yaw - 4.0, 14.0, (hx, hy, 0.48 * hz), tower_corners, 85.0, aspect, 0.86, 0.76))

    p_target = analysis.get("canyon_portal", {}).get("target", [hx, hy, 0.48 * max_z])
    canyon_hi = (0.35 * p_target[0], 0.35 * p_target[1], 0.30 * max_z)
    canyon_lo = (0.65 * hx + 0.35 * sx, 0.65 * hy + 0.35 * sy, 0.42 * max_z)
    swoop_hi_dist = camera_rig.compute_fit_distance(portal_yaw - 18.0, 58.0, canyon_hi, full_corners, 45.0, aspect, 0.84, 0.72)
    swoop_lo_dist = max(0.115, camera_rig.compute_fit_distance(portal_yaw, 13.5, canyon_lo, cluster_corners, 64.0, aspect, 0.88, 0.74))

    reveal_elev = 26.0 if canonical in ("02_creative_office_desk", "08_loft_concrete_studio") else 21.0
    reveal_dist = camera_rig.compute_fit_distance(rec_yaw, reveal_elev, est_target, full_corners, 54.0, aspect, 0.76, 0.62, est_shift_y)

    return [
        {
            **COMMERCIAL_SHOT_SPECS[0], "mount": "desk_flat",
            "start": {"yaw": rec_yaw, "elev": est_elev, "dist": est_dist, "target": est_target, "focus": (0.5 * hx + 0.5 * sx, 0.5 * hy + 0.5 * sy, 0.42 * max_z), "lens": 48.0, "fstop": 3.2, "shift_y": est_shift_y, "sun_az": base_sun_azimuth_deg - 10.0, "sun_el": 34.0},
            "end": {"yaw": close_yaw, "elev": 15.0, "dist": close_dist, "target": cluster_target, "focus": (hx, hy, 0.55 * hz), "lens": 78.0, "fstop": 2.0, "shift_y": 0.015, "sun_az": base_sun_azimuth_deg + 10.0, "sun_el": 30.0},
        },
        {
            **COMMERCIAL_SHOT_SPECS[1], "mount": "desk_flat",
            "start": {"yaw": rec_yaw - 12.0, "elev": 9.5, "dist": rise_dist * 1.04, "target": (hx, hy, max(0.24 * hz, 0.005)), "focus": (hx, hy, max(0.32 * hz, 0.006)), "lens": 85.0, "fstop": 2.0, "shift_y": 0.0, "sun_az": base_sun_azimuth_deg - 28.0, "sun_el": 24.0},
            "end": {"yaw": rec_yaw + 8.0, "elev": 22.0, "dist": rise_dist * 0.96, "target": (hx, hy, max(0.68 * hz, 0.010)), "focus": (hx, hy, max(0.68 * hz, 0.010)), "lens": 85.0, "fstop": 2.0, "shift_y": 0.01, "sun_az": base_sun_azimuth_deg + 32.0, "sun_el": 34.0},
        },
        {
            **COMMERCIAL_SHOT_SPECS[2], "mount": "desk_flat",
            "start": {"yaw": portal_yaw - 20.0, "elev": 58.0, "dist": swoop_hi_dist, "target": canyon_hi, "focus": (0.5 * hx + 0.5 * sx, 0.5 * hy + 0.5 * sy, 0.35 * max_z), "lens": 45.0, "fstop": 2.8, "shift_y": 0.0, "sun_az": base_sun_azimuth_deg + 18.0, "sun_el": 40.0},
            "end": {"yaw": portal_yaw, "elev": 13.5, "dist": swoop_lo_dist, "target": canyon_lo, "focus": (hx, hy, 0.52 * hz), "lens": 64.0, "fstop": 2.0, "shift_y": 0.01, "sun_az": base_sun_azimuth_deg - 14.0, "sun_el": 26.0},
        },
        {
            **COMMERCIAL_SHOT_SPECS[3], "mount": "desk_flat",
            "start": {"yaw": rec_yaw * 0.60, "elev": 16.5, "dist": max(close_dist * 1.08, 0.125), "target": cluster_target, "focus": (hx, hy, 0.52 * hz), "lens": 72.0, "fstop": 2.2, "shift_y": 0.015, "sun_az": base_sun_azimuth_deg - 12.0, "sun_el": 28.0},
            "end": {"yaw": rec_yaw, "elev": reveal_elev, "dist": reveal_dist, "target": est_target, "focus": (0.5 * hx + 0.5 * sx, 0.5 * hy + 0.5 * sy, 0.40 * max_z), "lens": 54.0, "fstop": 3.2, "shift_y": est_shift_y, "sun_az": base_sun_azimuth_deg + 8.0, "sun_el": 34.0},
        },
    ]


def evaluate_shot_state(shot: Dict[str, Any], raw_t: float, desk_z: float = -0.006) -> Dict[str, Any]:
    """Evaluate camera pose and key-light angles at normalized time raw_t (supports pre/post-roll)."""
    if raw_t < 0.0:
        u0, u1 = eval_easing(shot["easing"], 0.0), eval_easing(shot["easing"], 0.02)
        u = u0 + (u1 - u0) / 0.02 * raw_t
    elif raw_t > 1.0:
        u0, u1 = eval_easing(shot["easing"], 0.98), eval_easing(shot["easing"], 1.0)
        u = u1 + (u1 - u0) / 0.02 * (raw_t - 1.0)
    else:
        u = eval_easing(shot["easing"], raw_t)

    st, en = shot["start"], shot["end"]
    yaw, elev = _lerp(st["yaw"], en["yaw"], u), _lerp(st["elev"], en["elev"], u)
    d0, d1 = max(st["dist"], 0.04), max(en["dist"], 0.04)
    dist = max(0.075, d0 * ((d1 / d0) ** u))
    target, focus = _lerp_vec(st["target"], en["target"], u), _lerp_vec(st["focus"], en["focus"], u)
    lens, fstop = max(24.0, _lerp(st["lens"], en["lens"], u)), max(1.4, _lerp(st["fstop"], en["fstop"], u))
    shift_y = _lerp(st["shift_y"], en["shift_y"], u)
    sun_az, sun_el = _lerp(st["sun_az"], en["sun_az"], u), _lerp(st["sun_el"], en["sun_el"], u)

    off = camera_rig.spherical_offset(yaw, elev, dist)
    is_wall = shot.get("mount") == "wall_mount"
    eye_z = target[2] + off[2] if is_wall else max(desk_z + 0.012, target[2] + off[2])
    return {
        "eye": (target[0] + off[0], target[1] + off[1], eye_z),
        "target": target, "focus_point": focus, "lens_mm": lens, "fstop": fstop,
        "shift_x": 0.0, "shift_y": shift_y, "sun_az": sun_az, "sun_el": sun_el, "u": u,
    }


def _iter_action_fcurves(action: Any) -> List[Any]:
    if hasattr(action, "fcurves"):
        try:
            return list(action.fcurves)
        except Exception:
            pass
    curves: List[Any] = []
    if hasattr(action, "layers"):
        for layer in action.layers:
            for strip in getattr(layer, "strips", ()):
                for bag in getattr(strip, "channelbags", ()):
                    curves.extend(getattr(bag, "fcurves", ()))
    return curves


def setup_commercial_sequence(
    scene: Any,
    shot: Dict[str, Any],
    fps: int = 24,
    desk_z: float = -0.006,
    env_refs: Optional[Dict[str, Any]] = None,
    update_light_fn: Optional[Callable[..., Any]] = None,
) -> Dict[str, Any]:
    """Keyframe one continuous commercial shot onto frames 1..N with pre/post-roll for motion blur."""
    cam_obj, focus_obj = camera_rig.ensure_studio_camera(scene)
    for datablock in (cam_obj, cam_obj.data, focus_obj):
        if datablock.animation_data is not None:
            datablock.animation_data_clear()
    key_light = env_refs.get("key_light") if env_refs else None
    if key_light is not None and key_light.animation_data is not None:
        key_light.animation_data_clear()

    n_frames = max(2, int(round(shot["duration_sec"] * fps)))
    scene.render.fps = fps
    scene.frame_start = 1
    scene.frame_end = n_frames

    for f in range(0, n_frames + 2):
        raw_t = (f - 1) / float(n_frames - 1)
        state = evaluate_shot_state(shot, raw_t, desk_z=desk_z)
        camera_rig.apply_camera_pose(
            cam_obj, focus_obj, state["eye"], state["target"], state["focus_point"],
            state["lens_mm"], state["fstop"], state["shift_x"], state["shift_y"], frame=f,
        )
        if env_refs is not None and update_light_fn is not None:
            update_light_fn(env_refs, state["sun_az"], elevation_deg=state["sun_el"])
            if key_light is not None:
                key_light.keyframe_insert(data_path="location", frame=f)
                key_light.keyframe_insert(data_path="rotation_euler", frame=f)

    for datablock in (cam_obj, cam_obj.data, focus_obj, key_light):
        if datablock is None or datablock.animation_data is None:
            continue
        action = datablock.animation_data.action
        if action is None:
            continue
        for fc in _iter_action_fcurves(action):
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"

    return {"camera": cam_obj, "focus_empty": focus_obj, "frame_start": 1, "frame_end": n_frames, "frame_count": n_frames}


__all__ = [
    "COMMERCIAL_SHOT_SPECS",
    "build_commercial_shot_plan",
    "build_flow_prompts",
    "clamp01",
    "ease_in_out_cubic",
    "ease_in_out_quint",
    "ease_out_decel",
    "eval_easing",
    "evaluate_shot_state",
    "setup_commercial_sequence",
    "speed_ramp_crash_zoom",
]
