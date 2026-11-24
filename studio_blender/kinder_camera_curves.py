"""C2-smooth continuous cinema camera rig for Kinder-style 9:16 city commercials.

Computes city-agnostic choreography waypoints from landmark analysis and model
bounds, adapts cleanly to both tall skylines (NYC 82.6 mm) and low-relief
tiles (Dubai 20.6 mm), supports prop-safe room envelopes for lifestyle/persona
interiors, and validates NDC framing, spire headroom, and clearance per frame.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from studio_blender import camera_rig

RAW_STUDIO_ENVS = frozenset({"09_dark_cinematic", "10_macro_editorial", "11_packshot_white"})


@dataclass(frozen=True)
class CameraKnot:
    """Single timed choreography waypoint along the continuous commercial timeline."""

    t: float
    yaw_deg: float
    elev_deg: float
    log_dist: float
    target: Tuple[float, float, float]
    focus: Tuple[float, float, float]
    lens_mm: float
    log_fstop: float
    shift_y: float
    sun_az: float
    sun_el: float


def _pchip_slopes(xs: Sequence[float], ys: Sequence[float]) -> List[float]:
    """Compute Fritsch-Carlson monotone cubic Hermite slopes (zero overshoot)."""
    n = len(xs)
    if n < 2:
        return [0.0] * n
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / max(h[i], 1e-9) for i in range(n - 1)]
    m = [0.0] * n
    for i in range(1, n - 1):
        if d[i - 1] * d[i] > 0.0:
            w1, w2 = 2.0 * h[i] + h[i - 1], h[i] + 2.0 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    if n == 2:
        return [d[0], d[0]]
    m0 = ((2.0 * h[0] + h[1]) * d[0] - h[0] * d[1]) / max(h[0] + h[1], 1e-9)
    m[0] = 0.0 if m0 * d[0] <= 0.0 else (3.0 * d[0] if abs(m0) > 3.0 * abs(d[0]) else m0)
    mn = ((2.0 * h[-1] + h[-2]) * d[-1] - h[-1] * d[-2]) / max(h[-1] + h[-2], 1e-9)
    m[-1] = 0.0 if mn * d[-1] <= 0.0 else (3.0 * d[-1] if abs(mn) > 3.0 * abs(d[-1]) else mn)
    return m


def _eval_pchip(xs: Sequence[float], ys: Sequence[float], ms: Sequence[float], t: float) -> float:
    """Evaluate monotone cubic Hermite spline with linear tangent extrapolation."""
    if t <= xs[0]:
        return ys[0] + ms[0] * (t - xs[0])
    if t >= xs[-1]:
        return ys[-1] + ms[-1] * (t - xs[-1])
    lo, hi = 0, len(xs) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if xs[mid] <= t:
            lo = mid
        else:
            hi = mid
    h = max(xs[hi] - xs[lo], 1e-9)
    s = (t - xs[lo]) / h
    s2 = s * s
    s3 = s2 * s
    return (
        (2.0 * s3 - 3.0 * s2 + 1.0) * ys[lo]
        + (s3 - 2.0 * s2 + s) * h * ms[lo]
        + (-2.0 * s3 + 3.0 * s2) * ys[hi]
        + (s3 - s2) * h * ms[hi]
    )


def _gaussian_smooth_1d(values: Sequence[float], dt: float, sigma_sec: float) -> List[float]:
    """Convolve dense 1D samples with normalized Gaussian (C-infinity smooth)."""
    if sigma_sec <= 1e-5 or len(values) < 5:
        return list(values)
    radius = max(1, int(math.ceil(3.2 * sigma_sec / max(dt, 1e-6))))
    raw_w = [math.exp(-0.5 * ((k * dt) / sigma_sec) ** 2) for k in range(-radius, radius + 1)]
    w_sum = sum(raw_w)
    weights = [w / w_sum for w in raw_w]
    n = len(values)
    s_left = values[1] - values[0]
    s_right = values[-1] - values[-2]
    out: List[float] = []
    for i in range(n):
        acc = 0.0
        for k, w in enumerate(weights):
            idx = i + k - radius
            val = (
                values[0] + s_left * idx
                if idx < 0
                else (values[-1] + s_right * (idx - (n - 1)) if idx >= n else values[idx])
            )
            acc += w * val
        out.append(acc)
    return out


class SmoothChannelSpline:
    """Dense 240 Hz C2-smooth channel evaluator built from PCHIP + Gaussian smoothing."""

    def __init__(
        self,
        xs: Sequence[float],
        ys: Sequence[float],
        t_min: float,
        t_max: float,
        sample_hz: int = 240,
        sigma_sec: float = 0.14,
    ) -> None:
        self.t_min = float(t_min)
        self.dt = 1.0 / float(sample_hz)
        n_steps = max(4, int(round((t_max - t_min) * sample_hz))) + 1
        ms = _pchip_slopes(xs, ys)
        raw = [_eval_pchip(xs, ys, ms, self.t_min + i * self.dt) for i in range(n_steps)]
        self.samples = _gaussian_smooth_1d(raw, self.dt, sigma_sec)

    def eval(self, t: float) -> float:
        pos = (t - self.t_min) / self.dt
        n = len(self.samples)
        if pos <= 0.0:
            return self.samples[0] + (self.samples[1] - self.samples[0]) * pos
        if pos >= n - 1:
            return self.samples[-1] + (self.samples[-1] - self.samples[-2]) * (pos - (n - 1))
        i0 = int(math.floor(pos))
        frac = pos - i0
        return self.samples[i0] * (1.0 - frac) + self.samples[i0 + 1] * frac


def _canyon_yaw(analysis: Dict[str, Any], rec_yaw: float, max_abs: float) -> float:
    """Compute a front-side canyon approach yaw strictly within [-max_abs, +max_abs] deg."""
    portal = analysis.get("canyon_portal", {})
    dx, dy = portal.get("direction", [0.0, 1.0])
    raw = math.degrees(math.atan2(-dx, max(dy, 0.22)))
    if abs(raw - rec_yaw) < 20.0:
        raw = -rec_yaw * 0.90
    return max(-max_abs, min(max_abs, raw))


def build_kinder_knots(
    analysis: Dict[str, Any],
    model_bounds: Dict[str, Any],
    aspect: float = 9.0 / 16.0,
    base_sun_az: float = 54.0,
    duration_sec: float = 11.0,
    room_safe: bool = False,
) -> List[CameraKnot]:
    """Build city-agnostic choreography knots for any city STL and studio/persona room.

    When room_safe=True (interiors 01-08 & 12-17), keeps yaw within a prop-free
    front corridor ([-30, +26] deg), raises minimum elevation cleanly above desk
    props, and frames Hook/Reveal slightly wider so persona props & windows read.
    """
    sc = duration_sec / 11.0
    rec_yaw = float(analysis.get("recommended_yaw_deg", -24.0))
    side = -1.0 if rec_yaw <= 0.0 else 1.0
    yaw_lim = 30.0 if room_safe else 42.0
    base_yaw = max(-22.0, min(22.0, rec_yaw)) if room_safe else rec_yaw
    arc_yaw = _canyon_yaw(analysis, base_yaw, max_abs=24.0 if room_safe else 42.0)

    hx, hy, hz = (float(v) for v in analysis["hero_peak"])
    htx, hty = (float(v) for v in analysis.get("hero_tower_xy", [hx, hy]))
    sx, sy, _ = (float(v) for v in analysis["skyline_centroid"])
    fw = float(analysis["frame_width_m"])
    fh = float(analysis["frame_height_m"])
    max_z = max(float(analysis["max_z"]), 0.008)

    full_c = camera_rig.compute_full_model_corners(model_bounds, analysis, mount="desk_flat")
    _, cluster_c = camera_rig.compute_hero_cluster_corners(analysis, mount="desk_flat")
    tower_r = max(0.018, 0.19 * min(fw, fh), 0.23 * hz)
    spire_c = camera_rig.bbox_corners(
        htx - tower_r, htx + tower_r, hty - tower_r, hty + tower_r, 0.05 * max_z, max_z * 1.12
    )

    hero_tgt = (0.0, 0.0, 0.28 * max_z)
    hero_foc = (0.52 * htx + 0.48 * sx, 0.52 * hty + 0.48 * sy, 0.42 * max_z)
    sp_lo_tgt = (0.76 * htx + 0.24 * sx, 0.76 * hty + 0.24 * sy, 0.48 * max_z)
    sp_hi_tgt = (0.84 * htx + 0.16 * sx, 0.84 * hty + 0.16 * sy, 0.58 * max_z)
    sp_lo_foc = (htx, hty, 0.50 * hz)
    sp_hi_foc = (htx, hty, 0.66 * hz)
    over_tgt = (0.18 * sx, 0.18 * sy, 0.24 * max_z)
    cany_tgt = (0.62 * htx + 0.38 * sx, 0.62 * hty + 0.38 * sy, 0.42 * max_z)

    def _fit(
        yaw: float, el: float, tgt: Tuple[float, float, float],
        crn: Sequence[Tuple[float, float, float]], lens: float,
        fx: float, fy: float, sy_off: float = 0.0,
    ) -> float:
        d = camera_rig.compute_fit_distance(yaw, el, tgt, crn, lens, aspect, fx, fy, sy_off)
        return min(d, 0.72) if room_safe else d

    def _clamp_yaw(y: float) -> float:
        return max(-yaw_lim, min(yaw_lim, y))

    # Room-safe profiles frame persona props/windows on Hook while staying crisp on Packshot
    h_fx, h_fy, h_sy = (0.76, 0.64, 0.024) if room_safe else (0.88, 0.74, 0.008)
    h0_lens, h1_lens = (42.0, 46.0) if room_safe else (45.0, 49.0)
    z_el = 14.0 if room_safe else 10.5
    ov_el = 50.0 if room_safe else 58.0
    cn_el = 16.5 if room_safe else 14.5

    h0_yaw = _clamp_yaw(base_yaw + side * (8.0 if room_safe else 12.0))
    h1_yaw = _clamp_yaw(base_yaw + side * 0.5)
    z0_yaw = _clamp_yaw(base_yaw * 0.72)
    z1_yaw = _clamp_yaw(base_yaw * 0.50)
    r0_yaw = _clamp_yaw(base_yaw * 0.05)
    r1_yaw = _clamp_yaw(-side * (15.0 if room_safe else 16.0))
    ov_yaw = _clamp_yaw(-side * 24.0 if room_safe else arc_yaw)
    cn_yaw = _clamp_yaw(-side * 10.0 if room_safe else arc_yaw * 0.45)
    rv_yaw = _clamp_yaw(base_yaw + side * 2.5)
    pm_yaw = _clamp_yaw(base_yaw - side * 2.5)
    pe_yaw = _clamp_yaw(base_yaw - side * 7.5)

    h0_d = _fit(h0_yaw, 25.5, hero_tgt, full_c, h0_lens, h_fx, h_fy, h_sy)
    h1_d = _fit(h1_yaw, 22.0, hero_tgt, full_c, h1_lens, h_fx + 0.02, h_fy + 0.02, h_sy * 0.8)
    z1_d = max(0.15, _fit(z1_yaw, z_el, sp_lo_tgt, spire_c, 82.0, 0.88, 0.82))
    z0_d = math.sqrt(h1_d * z1_d)
    r0_d = max(0.15, _fit(r0_yaw, z_el + 4.5, sp_hi_tgt, spire_c, 80.0, 0.86, 0.80))
    r1_d = max(0.16, _fit(r1_yaw, 22.5, sp_hi_tgt, spire_c, 72.0, 0.84, 0.76))
    ov_d = _fit(ov_yaw, ov_el, over_tgt, full_c, 45.0, 0.82 if room_safe else 0.86, 0.72)
    cn_d = max(0.16, _fit(cn_yaw, cn_el, cany_tgt, cluster_c, 60.0, 0.86, 0.76))
    rv_d = _fit(rv_yaw, 25.5, hero_tgt, full_c, 50.0, 0.84 if room_safe else 0.90, 0.72, -0.008)
    pm_d = _fit(pm_yaw, 27.0, hero_tgt, full_c, 52.0, 0.84 if room_safe else 0.89, 0.72, -0.012)
    pe_d = _fit(pe_yaw, 28.5, hero_tgt, full_c, 54.0, 0.82 if room_safe else 0.86, 0.70, -0.012)

    return [
        CameraKnot(0.00 * sc, h0_yaw, 25.0, math.log(h0_d), hero_tgt, hero_foc, h0_lens, math.log(4.5 if room_safe else 5.6), h_sy, base_sun_az - 14.0, 32.0),
        CameraKnot(1.85 * sc, h1_yaw, 22.5, math.log(h1_d * 0.94), hero_tgt, hero_foc, h1_lens, math.log(4.0 if room_safe else 4.8), h_sy * 0.8, base_sun_az - 16.0, 30.0),
        CameraKnot(2.65 * sc, z0_yaw, 17.5 if room_safe else 15.5, math.log(z0_d), sp_lo_tgt, sp_lo_foc, 66.0, math.log(2.4), 0.004, base_sun_az - 17.0, 26.0),
        CameraKnot(3.35 * sc, z1_yaw, z_el, math.log(z1_d), sp_lo_tgt, sp_lo_foc, 82.0, math.log(1.8), 0.000, base_sun_az - 16.0, 23.0),
        CameraKnot(4.60 * sc, r0_yaw, z_el + 4.5, math.log(r0_d), sp_hi_tgt, sp_hi_foc, 80.0, math.log(1.9), 0.000, base_sun_az + 14.0, 27.0),
        CameraKnot(5.80 * sc, r1_yaw, 22.5, math.log(r1_d), sp_hi_tgt, sp_hi_foc, 72.0, math.log(2.2), 0.000, base_sun_az + 44.0, 32.0),
        CameraKnot(7.00 * sc, ov_yaw, ov_el, math.log(ov_d), over_tgt, hero_foc, 45.0, math.log(3.5), 0.000, base_sun_az + 24.0, 38.0),
        CameraKnot(8.15 * sc, cn_yaw, cn_el, math.log(cn_d), cany_tgt, sp_lo_foc, 60.0, math.log(2.2), 0.004, base_sun_az + 6.0, 27.0),
        CameraKnot(9.65 * sc, rv_yaw, 25.5, math.log(rv_d), hero_tgt, hero_foc, 50.0, math.log(4.2), -0.008, base_sun_az - 4.0, 31.0),
        CameraKnot(10.30 * sc, pm_yaw, 27.0, math.log(pm_d), hero_tgt, hero_foc, 52.0, math.log(5.2), -0.012, base_sun_az - 2.0, 33.0),
        CameraKnot(11.00 * sc, pe_yaw, 28.5, math.log(pe_d), hero_tgt, hero_foc, 54.0, math.log(6.3), -0.012, base_sun_az + 2.0, 35.0),
    ]


class KinderCameraRig:
    """Continuous C2-smooth camera + key-light evaluator for any city & environment."""

    def __init__(
        self,
        analysis: Dict[str, Any],
        model_bounds: Dict[str, Any],
        aspect: float = 9.0 / 16.0,
        base_sun_az: float = 54.0,
        duration_sec: float = 11.0,
        smooth_sigma_sec: float = 0.14,
        room_safe: bool = False,
    ) -> None:
        self.analysis = analysis
        self.model_bounds = model_bounds
        self.aspect = float(aspect)
        self.duration_sec = float(duration_sec)
        self.room_safe = bool(room_safe)
        self.desk_z = float(model_bounds.get("desk_z", model_bounds.get("desk_z_m", -0.005)))
        self.knots = build_kinder_knots(
            analysis, model_bounds, aspect, base_sun_az, duration_sec, room_safe=room_safe
        )
        ts = [k.t for k in self.knots]
        t0, t1 = -0.35, duration_sec + 0.35

        def _mk(vals: Sequence[float], sigma: float = smooth_sigma_sec) -> SmoothChannelSpline:
            return SmoothChannelSpline(ts, vals, t0, t1, sample_hz=240, sigma_sec=sigma)

        self._yaw = _mk([k.yaw_deg for k in self.knots])
        self._elev = _mk([k.elev_deg for k in self.knots])
        self._log_dist = _mk([k.log_dist for k in self.knots])
        self._tx = _mk([k.target[0] for k in self.knots])
        self._ty = _mk([k.target[1] for k in self.knots])
        self._tz = _mk([k.target[2] for k in self.knots])
        self._fx = _mk([k.focus[0] for k in self.knots])
        self._fy = _mk([k.focus[1] for k in self.knots])
        self._fz = _mk([k.focus[2] for k in self.knots])
        self._lens = _mk([k.lens_mm for k in self.knots])
        self._log_fstop = _mk([k.log_fstop for k in self.knots])
        self._shift_y = _mk([k.shift_y for k in self.knots])
        self._sun_az = _mk([k.sun_az for k in self.knots], sigma=smooth_sigma_sec * 1.2)
        self._sun_el = _mk([k.sun_el for k in self.knots], sigma=smooth_sigma_sec * 1.2)

    def evaluate(self, t_sec: float) -> Dict[str, Any]:
        """Evaluate exact camera pose and key-light angles at continuous time t_sec."""
        yaw = self._yaw.eval(t_sec)
        elev = max(9.0 if self.room_safe else 7.0, min(80.0, self._elev.eval(t_sec)))
        dist = max(0.11, math.exp(self._log_dist.eval(t_sec)))
        target = (self._tx.eval(t_sec), self._ty.eval(t_sec), self._tz.eval(t_sec))
        focus = (self._fx.eval(t_sec), self._fy.eval(t_sec), self._fz.eval(t_sec))
        lens_mm = max(28.0, min(110.0, self._lens.eval(t_sec)))
        fstop = max(1.6, min(11.0, math.exp(self._log_fstop.eval(t_sec))))
        shift_y = self._shift_y.eval(t_sec)
        sun_az = self._sun_az.eval(t_sec)
        sun_el = max(16.0, min(68.0, self._sun_el.eval(t_sec)))

        off = camera_rig.spherical_offset(yaw, elev, dist)
        min_z = self.desk_z + (0.042 if self.room_safe else 0.016)
        eye = (target[0] + off[0], target[1] + off[1], max(min_z, target[2] + off[2]))
        return {
            "t_sec": round(t_sec, 5), "eye": eye, "target": target, "focus_point": focus,
            "lens_mm": lens_mm, "fstop": fstop, "shift_x": 0.0, "shift_y": shift_y,
            "yaw_deg": yaw, "elev_deg": elev, "distance_m": dist,
            "sun_az": sun_az, "sun_el": sun_el,
        }


def project_point_ndc(
    pt: Tuple[float, float, float], state: Dict[str, Any], aspect: float
) -> Tuple[float, float, float]:
    """Project a 3D world point to camera NDC (-1..+1, -1..+1) and depth."""
    eye, target = state["eye"], state["target"]
    right, up, fwd = camera_rig.camera_basis(eye, target)
    rx, ry, rz = pt[0] - eye[0], pt[1] - eye[1], pt[2] - eye[2]
    depth = rx * fwd[0] + ry * fwd[1] + rz * fwd[2]
    if depth <= 1e-6:
        return (99.0, 99.0, depth)
    tan_h, tan_v = camera_rig.sensor_half_tangents(state["lens_mm"], aspect)
    shift_ndc_y = 2.0 * state["shift_y"] if aspect <= 1.0 else 2.0 * state["shift_y"] * aspect
    ndc_x = (rx * right[0] + ry * right[1] + rz * right[2]) / (depth * tan_h)
    ndc_y = (rx * up[0] + ry * up[1] + rz * up[2]) / (depth * tan_v) - shift_ndc_y
    return (ndc_x, ndc_y, depth)


def validate_kinder_trajectory(rig: KinderCameraRig, fps: int = 24) -> Dict[str, Any]:
    """Verify clearance, zero spire clipping, zero dead pauses, and speed-ramp contrast."""
    n_frames = max(2, int(round(rig.duration_sec * fps)))
    full_c = camera_rig.compute_full_model_corners(rig.model_bounds, rig.analysis, mount="desk_flat")
    hp = tuple(float(v) for v in rig.analysis["hero_peak"])
    spire_tip = (hp[0], hp[1], float(rig.analysis["max_z"]) * 1.02)

    min_floor, min_spire, max_hook, max_pack, max_sp_y = 1e9, 1e9, 0.0, 0.0, -1e9
    min_spd, max_spd = 1e9, 0.0
    prev_eye: Optional[Tuple[float, float, float]] = None
    dt = 1.0 / float(fps)

    for f in range(1, n_frames + 1):
        t = (f - 1) / float(n_frames - 1) * rig.duration_sec
        st = rig.evaluate(t)
        eye = st["eye"]
        min_floor = min(min_floor, eye[2] - rig.desk_z)
        min_spire = min(min_spire, math.dist(eye, spire_tip))
        if prev_eye is not None:
            spd = math.dist(eye, prev_eye) / dt
            min_spd = min(min_spd, spd)
            max_spd = max(max_spd, spd)
        prev_eye = eye
        if t <= rig.duration_sec * 0.15:
            for c in full_c:
                nx, ny, _ = project_point_ndc(c, st, rig.aspect)
                max_hook = max(max_hook, abs(nx), abs(ny))
        if t >= rig.duration_sec * 0.88:
            for c in full_c:
                nx, ny, _ = project_point_ndc(c, st, rig.aspect)
                max_pack = max(max_pack, abs(nx), abs(ny))
        _, sy, sdepth = project_point_ndc(spire_tip, st, rig.aspect)
        if sdepth > 0.0:
            max_sp_y = max(max_sp_y, sy)

    return {
        "frame_count": n_frames, "duration_sec": rig.duration_sec, "room_safe": rig.room_safe,
        "min_floor_clearance_m": round(min_floor, 5), "min_spire_clearance_m": round(min_spire, 5),
        "max_hook_ndc": round(max_hook, 4), "max_packshot_ndc": round(max_pack, 4),
        "max_spire_ndc_y": round(max_sp_y, 4),
        "min_eye_speed_mps": round(min_spd, 5), "max_eye_speed_mps": round(max_spd, 5),
        "speed_ramp_ratio": round(max_spd / max(min_spd, 1e-6), 2),
        "ok": (
            min_floor >= 0.014 and min_spire >= 0.08
            and max_hook <= 0.96 and max_pack <= 0.96
            and max_sp_y <= 0.92 and min_spd >= 0.003
        ),
    }


__all__ = [
    "CameraKnot", "KinderCameraRig", "RAW_STUDIO_ENVS", "SmoothChannelSpline",
    "build_kinder_knots", "project_point_ndc", "validate_kinder_trajectory",
]
