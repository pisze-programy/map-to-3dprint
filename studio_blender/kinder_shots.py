"""True 5-angle Kinder-style whip-match-cut cinema choreography for any city STL.

Builds 5 contrasting camera angles bridged by C2-smooth directional whip-in and
whip-out speed-ramps (real Cycles shutter=0.68 optical motion blur + 2-frame
velocity-matched xfade match-cuts):
  Shot 1 (0.0-1.8s): Low Hero Push-In (38mm f/4.0) -> rightward whip
  Shot 2 (1.8-3.8s): Worm's-Eye Street-Canyon Macro (92mm f/1.8) -> upward whip
  Shot 3 (3.8-5.8s): 82 deg God's-Eye Blueprint Overhead Spin (48mm f/3.2) -> down-left whip
  Shot 4 (5.8-8.0s): Reverse Opposite-Side Low Backlit Profile (74mm f/2.0) -> backward pull-out
  Shot 5 (8.0-10.5s): Hero Grand Pull-Out Reveal (42mm f/3.5) -> pixel-locked packshot dissolve
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from studio_blender import camera_rig
from studio_blender.kinder_camera_curves import project_point_ndc


@dataclass(frozen=True)
class WhipDelta:
    """Directional whip-in or whip-out offset applied at shot boundary (C2 cubic)."""

    yaw_deg: float = 0.0
    elev_deg: float = 0.0
    log_dist: float = 0.0
    lens_mm: float = 0.0
    target_shift: Tuple[float, float, float] = (0.0, 0.0, 0.0)


@dataclass(frozen=True)
class KinderShotSpec:
    """Single bold angle shot with silky slow-mo glide and C2 whip-in/whip-out ramps."""

    index: int
    shot_id: str
    title: str
    duration_sec: float
    start_yaw: float
    end_yaw: float
    start_elev: float
    end_elev: float
    start_dist: float
    end_dist: float
    start_target: Tuple[float, float, float]
    end_target: Tuple[float, float, float]
    start_focus: Tuple[float, float, float]
    end_focus: Tuple[float, float, float]
    start_lens: float
    end_lens: float
    start_fstop: float
    end_fstop: float
    start_shift_y: float
    end_shift_y: float
    start_sun_az: float
    end_sun_az: float
    start_sun_el: float
    end_sun_el: float
    whip_in: Optional[WhipDelta] = None
    whip_out: Optional[WhipDelta] = None
    whip_in_sec: float = 0.28
    whip_out_sec: float = 0.28
    check_full_fit_end: bool = False
    check_full_fit_start: bool = False


def _lerp(a: float, b: float, u: float) -> float:
    return a + (b - a) * u


def _lerp3(a: Sequence[float], b: Sequence[float], u: float) -> Tuple[float, float, float]:
    return (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u)


def _smooth_glide(u: float) -> float:
    """Monotonic velvety cinema drift (never stalls: slope >= 0.70 everywhere)."""
    if u <= 0.0:
        return 0.70 * u
    if u >= 1.0:
        return 1.0 + 0.70 * (u - 1.0)
    return 0.70 * u + 0.30 * (3.0 * u * u - 2.0 * u * u * u)


def _whip_in_weight(u: float, w: float) -> float:
    """C2-smooth cubic whip-in decay (1 at u=0 with peak slope -3/w; 0 for u>=w)."""
    if w <= 1e-5:
        return 0.0
    if u <= 0.0:
        return 1.0 - (3.0 / w) * u
    if u >= w:
        return 0.0
    r = 1.0 - u / w
    return r * r * r


def _whip_out_weight(u: float, w: float) -> float:
    """C2-smooth cubic whip-out launch (0 for u<=1-w; 1 at u=1 with peak slope +3/w)."""
    if w <= 1e-5:
        return 0.0
    u0 = 1.0 - w
    if u <= u0:
        return 0.0
    if u >= 1.0:
        return 1.0 + (3.0 / w) * (u - 1.0)
    r = (u - u0) / w
    return r * r * r


def evaluate_kinder_shot(
    shot: KinderShotSpec,
    raw_u: float,
    desk_z: float = -0.005,
    room_safe: bool = True,
) -> Dict[str, Any]:
    """Evaluate exact camera pose and key-light angles at normalized time raw_u."""
    g = _smooth_glide(raw_u)
    w_in = min(0.32, shot.whip_in_sec / max(shot.duration_sec, 0.25)) if shot.whip_in else 0.0
    w_out = min(0.32, shot.whip_out_sec / max(shot.duration_sec, 0.25)) if shot.whip_out else 0.0
    k_in = _whip_in_weight(raw_u, w_in)
    k_out = _whip_out_weight(raw_u, w_out)

    yaw = _lerp(shot.start_yaw, shot.end_yaw, g)
    elev = _lerp(shot.start_elev, shot.end_elev, g)
    log_d = _lerp(math.log(max(shot.start_dist, 0.05)), math.log(max(shot.end_dist, 0.05)), g)
    lens = _lerp(shot.start_lens, shot.end_lens, g)
    tx, ty, tz = _lerp3(shot.start_target, shot.end_target, g)

    if shot.whip_in is not None and abs(k_in) > 1e-9:
        yaw += shot.whip_in.yaw_deg * k_in
        elev += shot.whip_in.elev_deg * k_in
        log_d += shot.whip_in.log_dist * k_in
        lens += shot.whip_in.lens_mm * k_in
        tx += shot.whip_in.target_shift[0] * k_in
        ty += shot.whip_in.target_shift[1] * k_in
        tz += shot.whip_in.target_shift[2] * k_in
    if shot.whip_out is not None and abs(k_out) > 1e-9:
        yaw += shot.whip_out.yaw_deg * k_out
        elev += shot.whip_out.elev_deg * k_out
        log_d += shot.whip_out.log_dist * k_out
        lens += shot.whip_out.lens_mm * k_out
        tx += shot.whip_out.target_shift[0] * k_out
        ty += shot.whip_out.target_shift[1] * k_out
        tz += shot.whip_out.target_shift[2] * k_out

    elev = max(8.0 if room_safe else 6.5, min(86.5, elev))
    dist = max(0.11, min(0.95, math.exp(log_d)))
    lens = max(26.0, min(115.0, lens))
    fstop = max(1.6, min(11.0, math.exp(_lerp(math.log(shot.start_fstop), math.log(shot.end_fstop), g))))
    shift_y = _lerp(shot.start_shift_y, shot.end_shift_y, g)
    focus = _lerp3(shot.start_focus, shot.end_focus, g)
    sun_az = _lerp(shot.start_sun_az, shot.end_sun_az, g)
    sun_el = max(16.0, min(68.0, _lerp(shot.start_sun_el, shot.end_sun_el, g)))

    off = camera_rig.spherical_offset(yaw, elev, dist)
    min_z = desk_z + (0.036 if room_safe else 0.016)
    eye = (tx + off[0], ty + off[1], max(min_z, tz + off[2]))
    return {
        "eye": eye, "target": (tx, ty, tz), "focus_point": focus,
        "lens_mm": lens, "fstop": fstop, "shift_x": 0.0, "shift_y": shift_y,
        "yaw_deg": yaw, "elev_deg": elev, "distance_m": dist,
        "sun_az": sun_az, "sun_el": sun_el,
    }


def compute_multishot_frame_budget(
    shots: Sequence[KinderShotSpec],
    fps: int = 24,
    whip_overlap_frames: int = 2,
) -> List[int]:
    """Compute per-shot rendered frame counts so stitched total equals target duration."""
    n_shots = len(shots)
    total_sec = sum(s.duration_sec for s in shots)
    target_total = max(n_shots * 8, int(round(total_sec * fps)))
    raw_sum = target_total + whip_overlap_frames * max(0, n_shots - 1)
    weights = [s.duration_sec / max(total_sec, 1e-6) for s in shots]
    counts = [max(10, int(round(w * raw_sum))) for w in weights]
    counts[-1] += raw_sum - sum(counts)
    return counts


def build_kinder_multishot_plan(
    analysis: Dict[str, Any],
    model_bounds: Dict[str, Any],
    aspect: float = 9.0 / 16.0,
    base_sun_az: float = 52.0,
    duration_sec: float = 10.5,
    room_safe: bool = True,
) -> List[KinderShotSpec]:
    """Build 5 bold contrasting Kinder angles adapted to any city height & room."""
    sc = duration_sec / 10.5
    rec_yaw = float(analysis.get("recommended_yaw_deg", -24.0))
    side = -1.0 if rec_yaw <= 0.0 else 1.0  # NYC: -1 (front-left); Dubai: +1 (front-right)
    base_yaw = max(-24.0, min(24.0, rec_yaw)) if room_safe else rec_yaw

    hx, hy, hz = (float(v) for v in analysis["hero_peak"])
    htx, hty = (float(v) for v in analysis.get("hero_tower_xy", [hx, hy]))
    sx, sy, _ = (float(v) for v in analysis["skyline_centroid"])
    fw = float(analysis["frame_width_m"])
    fh = float(analysis["frame_height_m"])
    max_z = max(float(analysis["max_z"]), 0.008)
    tall_city = max_z >= 0.045

    full_c = camera_rig.compute_full_model_corners(model_bounds, analysis, mount="desk_flat")
    _, cluster_c = camera_rig.compute_hero_cluster_corners(analysis, mount="desk_flat")
    tr = max(0.017, 0.18 * min(fw, fh), 0.22 * hz)
    spire_c = camera_rig.bbox_corners(
        htx - tr, htx + tr, hty - tr, hty + tr, 0.04 * max_z, max_z * 1.12
    )

    def _fit(
        yaw: float, el: float, tgt: Tuple[float, float, float],
        crn: Sequence[Tuple[float, float, float]], lens: float,
        fx: float, fy: float, sy_off: float = 0.0, max_d: float = 0.72,
    ) -> float:
        d = camera_rig.compute_fit_distance(yaw, el, tgt, crn, lens, aspect, fx, fy, sy_off)
        return min(d, max_d) if room_safe else d

    hero_tgt = (0.0, 0.0, 0.26 * max_z)
    hero_foc = (0.52 * htx + 0.48 * sx, 0.52 * hty + 0.48 * sy, 0.42 * max_z)
    macro_tgt0 = (0.78 * htx + 0.22 * sx, 0.78 * hty + 0.22 * sy, (0.44 if tall_city else 0.36) * max_z)
    macro_tgt1 = (0.86 * htx + 0.14 * sx, 0.86 * hty + 0.14 * sy, (0.58 if tall_city else 0.48) * max_z)
    macro_foc = (htx, hty, 0.54 * hz)
    over_tgt = (0.10 * sx, 0.10 * sy, 0.18 * max_z)
    rev_tgt = (0.55 * htx + 0.45 * sx, 0.55 * hty + 0.45 * sy, (0.42 if tall_city else 0.32) * max_z)

    # Shot 1 (0.0-1.8s): Low Hero Push-In (38mm f/4.0) -> fast rightward whip
    s1_y0, s1_y1 = base_yaw + side * 4.0, base_yaw - side * 4.0
    s1_fx, s1_fy, s1_sy = (0.76, 0.64, 0.025) if room_safe else (0.86, 0.74, 0.010)
    s1_d0 = _fit(s1_y0, 23.0, hero_tgt, full_c, 38.0, s1_fx, s1_fy, s1_sy)
    s1_d1 = _fit(s1_y1, 19.0, hero_tgt, full_c, 44.0, s1_fx + 0.05, s1_fy + 0.04, s1_sy * 0.7)

    # Shot 2 (1.8-3.8s): Worm's-Eye Street-Canyon Macro (92mm f/1.8) -> upward whip
    # Enters mid-rightward-whip (+yaw), glides low between flanking towers, whips UP
    s2_y0, s2_y1 = -8.0 if side < 0 else -16.0, 12.0 if side < 0 else 6.0
    s2_el0, s2_el1 = (11.5, 15.0) if tall_city else (12.5, 16.5)
    s2_d0 = max(0.15, _fit(s2_y0, s2_el0, macro_tgt0, spire_c, 92.0, 0.88, 0.82))
    s2_d1 = max(0.15, _fit(s2_y1, s2_el1, macro_tgt1, spire_c, 88.0, 0.86, 0.80))

    # Shot 3 (3.8-5.8s): 82 deg God's-Eye Blueprint Overhead Spin (48mm f/3.2) -> down-left whip
    s3_y0, s3_y1 = -32.0, 22.0
    s3_d0 = _fit(s3_y0, 81.0, over_tgt, full_c, 48.0, 0.82, 0.74, max_d=0.76)
    s3_d1 = _fit(s3_y1, 82.5, over_tgt, full_c, 50.0, 0.84, 0.76, max_d=0.76)

    # Shot 4 (5.8-8.0s): Reverse Opposite-Side Low Backlit Profile (74mm f/2.0) -> rapid pull-out
    # Opposite side of city (~125-135 deg from Shot 1); elev>=18 deg in rooms avoids front desk edge!
    rev_base = -side * (96.0 if room_safe else 118.0)
    s4_y0, s4_y1 = rev_base + side * 8.0, rev_base - side * 12.0
    s4_el0, s4_el1 = (19.5, 17.5) if room_safe else (13.5, 11.5)
    s4_d0 = max(0.16, _fit(s4_y0, s4_el0, rev_tgt, cluster_c, 74.0, 0.88, 0.78, max_d=0.44))
    s4_d1 = max(0.16, _fit(s4_y1, s4_el1, rev_tgt, cluster_c, 72.0, 0.86, 0.76, max_d=0.44))

    # Shot 5 (8.0-10.5s): Hero Grand Pull-Out Reveal (42->48mm) -> Pixel-Locked Packshot Morph
    s5_y0, s5_y1 = base_yaw + side * 2.0, base_yaw - side * 5.0
    s5_d0 = _fit(s5_y0, 25.5, hero_tgt, full_c, 44.0, 0.82 if room_safe else 0.88, 0.70, -0.008)
    s5_d1 = _fit(s5_y1, 27.5, hero_tgt, full_c, 49.0, 0.82 if room_safe else 0.86, 0.70, -0.012)

    return [
        KinderShotSpec(
            index=1, shot_id="shot01_hero_push_in", title="Low Hero Push-In -> Rightward Whip",
            duration_sec=1.80 * sc,
            start_yaw=s1_y0, end_yaw=s1_y1, start_elev=23.0, end_elev=19.0,
            start_dist=s1_d0, end_dist=s1_d1, start_target=hero_tgt, end_target=hero_tgt,
            start_focus=hero_foc, end_focus=macro_foc, start_lens=38.0, end_lens=44.0,
            start_fstop=4.0, end_fstop=3.2, start_shift_y=s1_sy, end_shift_y=s1_sy * 0.7,
            start_sun_az=base_sun_az - 10.0, end_sun_az=base_sun_az + 4.0,
            start_sun_el=31.0, end_sun_el=28.0,
            whip_in=None,
            whip_out=WhipDelta(yaw_deg=30.0, elev_deg=-4.0, log_dist=-0.16, lens_mm=8.0, target_shift=(0.014, 0.0, 0.0)),
            whip_out_sec=0.26 * sc, check_full_fit_start=True,
        ),
        KinderShotSpec(
            index=2, shot_id="shot02_wormseye_canyon_macro", title="Worm's-Eye Canyon Macro -> Upward Whip",
            duration_sec=2.00 * sc,
            start_yaw=s2_y0, end_yaw=s2_y1, start_elev=s2_el0, end_elev=s2_el1,
            start_dist=s2_d0, end_dist=s2_d1, start_target=macro_tgt0, end_target=macro_tgt1,
            start_focus=macro_foc, end_focus=(htx, hty, 0.64 * hz), start_lens=92.0, end_lens=88.0,
            start_fstop=1.8, end_fstop=1.9, start_shift_y=0.0, end_shift_y=0.0,
            start_sun_az=base_sun_az - 18.0, end_sun_az=base_sun_az + 24.0,
            start_sun_el=22.0, end_sun_el=27.0,
            whip_in=WhipDelta(yaw_deg=-28.0, elev_deg=2.0, log_dist=0.14, lens_mm=-8.0, target_shift=(-0.012, 0.0, 0.0)),
            whip_out=WhipDelta(yaw_deg=6.0, elev_deg=28.0, log_dist=0.16, lens_mm=-16.0, target_shift=(0.0, 0.0, 0.018)),
            whip_in_sec=0.26 * sc, whip_out_sec=0.26 * sc,
        ),
        KinderShotSpec(
            index=3, shot_id="shot03_godseye_blueprint_spin", title="82 deg God's-Eye Blueprint Spin -> Down-Left Whip",
            duration_sec=2.00 * sc,
            start_yaw=s3_y0, end_yaw=s3_y1, start_elev=81.0, end_elev=82.5,
            start_dist=s3_d0, end_dist=s3_d1, start_target=over_tgt, end_target=over_tgt,
            start_focus=hero_foc, end_focus=hero_foc, start_lens=48.0, end_lens=50.0,
            start_fstop=3.2, end_fstop=3.4, start_shift_y=0.0, end_shift_y=0.0,
            start_sun_az=base_sun_az + 16.0, end_sun_az=base_sun_az - 18.0,
            start_sun_el=36.0, end_sun_el=32.0,
            whip_in=WhipDelta(yaw_deg=-10.0, elev_deg=-26.0, log_dist=-0.10, lens_mm=8.0),
            whip_out=WhipDelta(yaw_deg=-30.0, elev_deg=-28.0, log_dist=-0.12, lens_mm=8.0),
            whip_in_sec=0.26 * sc, whip_out_sec=0.26 * sc,
        ),
        KinderShotSpec(
            index=4, shot_id="shot04_reverse_backlit_profile", title="Reverse Opposite-Side Backlit Profile -> Rapid Pull-Out",
            duration_sec=2.20 * sc,
            start_yaw=s4_y0, end_yaw=s4_y1, start_elev=s4_el0, end_elev=s4_el1,
            start_dist=s4_d0, end_dist=s4_d1, start_target=rev_tgt, end_target=rev_tgt,
            start_focus=macro_foc, end_focus=hero_foc, start_lens=74.0, end_lens=72.0,
            start_fstop=2.0, end_fstop=2.2, start_shift_y=0.0, end_shift_y=0.0,
            start_sun_az=base_sun_az - 26.0, end_sun_az=base_sun_az + 22.0,
            start_sun_el=23.0, end_sun_el=28.0,
            whip_in=WhipDelta(yaw_deg=26.0, elev_deg=24.0, log_dist=0.14, lens_mm=-10.0),
            whip_out=WhipDelta(yaw_deg=0.0, elev_deg=6.0, log_dist=0.42, lens_mm=-22.0),
            whip_in_sec=0.26 * sc, whip_out_sec=0.28 * sc,
        ),
        KinderShotSpec(
            index=5, shot_id="shot05_hero_pullout_packshot", title="Hero Grand Pull-Out Reveal -> White Packshot Morph",
            duration_sec=2.50 * sc,
            start_yaw=s5_y0, end_yaw=s5_y1, start_elev=25.5, end_elev=27.5,
            start_dist=s5_d0, end_dist=s5_d1, start_target=hero_tgt, end_target=hero_tgt,
            start_focus=hero_foc, end_focus=hero_foc, start_lens=44.0, end_lens=49.0,
            start_fstop=3.5, end_fstop=5.8, start_shift_y=-0.008, end_shift_y=-0.012,
            start_sun_az=base_sun_az - 8.0, end_sun_az=base_sun_az + 4.0,
            start_sun_el=31.0, end_sun_el=34.0,
            whip_in=WhipDelta(yaw_deg=side * 8.0, elev_deg=-6.0, log_dist=-0.38, lens_mm=18.0),
            whip_out=None,
            whip_in_sec=0.30 * sc, check_full_fit_end=True,
        ),
    ]


def validate_multishot_plan(
    shots: Sequence[KinderShotSpec],
    analysis: Dict[str, Any],
    model_bounds: Dict[str, Any],
    aspect: float = 9.0 / 16.0,
    fps: int = 24,
    room_safe: bool = True,
) -> Dict[str, Any]:
    """Verify clearance, spire headroom, non-zero motion, and whip contrast on all 5 shots."""
    desk_z = float(model_bounds.get("desk_z", model_bounds.get("desk_z_m", -0.005)))
    full_c = camera_rig.compute_full_model_corners(model_bounds, analysis, mount="desk_flat")
    hp = tuple(float(v) for v in analysis["hero_peak"])
    spire_tip = (hp[0], hp[1], float(analysis["max_z"]) * 1.02)
    counts = compute_multishot_frame_budget(shots, fps=fps)

    min_floor, min_spire, max_hook, max_pack, max_sp_y = 1e9, 1e9, 0.0, 0.0, -1e9
    shot_reports: List[Dict[str, Any]] = []
    dt = 1.0 / float(fps)

    for shot, nf in zip(shots, counts):
        s_min_spd, s_max_spd = 1e9, 0.0
        prev_eye: Optional[Tuple[float, float, float]] = None
        for f in range(1, nf + 1):
            u = (f - 1) / float(nf - 1)
            st = evaluate_kinder_shot(shot, u, desk_z=desk_z, room_safe=room_safe)
            eye = st["eye"]
            min_floor = min(min_floor, eye[2] - desk_z)
            min_spire = min(min_spire, math.dist(eye, spire_tip))
            if prev_eye is not None:
                spd = math.dist(eye, prev_eye) / dt
                s_min_spd = min(s_min_spd, spd)
                s_max_spd = max(s_max_spd, spd)
            prev_eye = eye
            if shot.check_full_fit_start and u <= 0.45:
                for c in full_c:
                    nx, ny, _ = project_point_ndc(c, st, aspect)
                    max_hook = max(max_hook, abs(nx), abs(ny))
            if shot.check_full_fit_end and u >= 0.45:
                for c in full_c:
                    nx, ny, _ = project_point_ndc(c, st, aspect)
                    max_pack = max(max_pack, abs(nx), abs(ny))
            if 0.22 <= u <= 0.78:
                _, sy, sdepth = project_point_ndc(spire_tip, st, aspect)
                if sdepth > 0.0:
                    max_sp_y = max(max_sp_y, sy)
        shot_reports.append({
            "shot_id": shot.shot_id, "frames": nf,
            "min_speed_mps": round(s_min_spd, 4), "max_speed_mps": round(s_max_spd, 4),
            "whip_ratio": round(s_max_spd / max(s_min_spd, 1e-6), 2),
        })

    all_moving = all(r["min_speed_mps"] >= 0.008 for r in shot_reports)
    return {
        "shot_count": len(shots), "rendered_frames_sum": sum(counts),
        "stitched_frames": sum(counts) - 2 * max(0, len(shots) - 1),
        "room_safe": room_safe, "min_floor_clearance_m": round(min_floor, 5),
        "min_spire_clearance_m": round(min_spire, 5), "max_hook_ndc": round(max_hook, 4),
        "max_packshot_ndc": round(max_pack, 4), "max_spire_ndc_y": round(max_sp_y, 4),
        "shots": shot_reports,
        "ok": (
            min_floor >= 0.030 and min_spire >= 0.08
            and max_hook <= 0.96 and max_pack <= 0.96
            and max_sp_y <= 0.92 and all_moving
        ),
    }


__all__ = [
    "KinderShotSpec", "WhipDelta", "build_kinder_multishot_plan",
    "compute_multishot_frame_budget", "evaluate_kinder_shot", "validate_multishot_plan",
]
