"""Dedicated frameless chalk-plaster architectural detail gallery camera presets.

Implements 4 universal full-bleed telephoto macro presets calibrated for minimal-blur
architectural sharpness (f/22-f/28 so 80-90% of the miniature stays tack-sharp) with
strict interior frustum clamping so zero outer tile borders or backing edges enter:
  - `detail_spire`: Low 135mm f/22.0 eye-level spire soaring into pure #FFFFFF sky.
  - `detail_canyon`: Low 120mm f/24.0 avenue/park canyon receding into #FFFFFF horizon.
  - `detail_oblique_grid`: Full-bleed 130mm f/28.0 44-deg oblique urban grid wall-to-wall.
  - `detail_waterfront`: Tight 125mm f/24.0 30-deg interior waterfront/canyon tier macro.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

from studio_blender import camera_rig


DETAIL_STILL_PRESETS: Tuple[str, ...] = (
    "detail_spire",
    "detail_canyon",
    "detail_oblique_grid",
    "detail_waterfront",
)


def _clamp(val: float, lo: float, hi: float) -> float:
    return lo if val < lo else (hi if val > hi else val)


def _portal_yaw_deg(analysis: Dict[str, Any], fallback_yaw: float, limit_deg: float = 14.0) -> float:
    portal = analysis.get("canyon_portal", {})
    dx, dy = portal.get("direction", [0.0, 1.0])
    if abs(dx) < 1e-4 and abs(dy) < 1e-4:
        return _clamp(fallback_yaw, -limit_deg, limit_deg)
    raw = math.degrees(math.atan2(-dx, max(dy, 0.18)))
    return _clamp(raw, -limit_deg, limit_deg)


def _safe_xy_bounds(
    analysis: Dict[str, Any],
    inset_x: float,
    inset_y: float,
    coastal_extra_frac: float = 0.14,
) -> Tuple[float, float, float, float]:
    """Return interior (x0, x1, y0, y1) bounds keeping clear of outer borders and coastal water."""
    fw = float(analysis["frame_width_m"])
    fh = float(analysis["frame_height_m"])
    bmin = analysis.get("bbox_min", [-0.5 * fw, -0.5 * fh, 0.0])
    bmax = analysis.get("bbox_max", [0.5 * fw, 0.5 * fh, float(analysis["max_z"])])
    x0 = float(bmin[0]) + inset_x
    x1 = float(bmax[0]) - inset_x
    y0 = float(bmin[1]) + inset_y
    y1 = float(bmax[1]) - inset_y
    water_side = analysis.get("water_side")
    if water_side == "-X":
        x0 += coastal_extra_frac * fw
    elif water_side == "+X":
        x1 -= coastal_extra_frac * fw
    if x0 > x1:
        mid_x = 0.5 * (float(bmin[0]) + float(bmax[0]))
        x0, x1 = mid_x, mid_x
    if y0 > y1:
        mid_y = 0.5 * (float(bmin[1]) + float(bmax[1]))
        y0, y1 = mid_y, mid_y
    return x0, x1, y0, y1


def _max_safe_interior_distance(
    yaw_deg: float,
    elev_deg: float,
    target: Tuple[float, float, float],
    lens_mm: float,
    aspect: float,
    shift_y: float,
    x0: float,
    x1: float,
    y0: float,
    y1: float,
    z_plane: float,
    check_top: bool,
) -> Optional[float]:
    """Compute exact max camera distance where boundary rays stay inside [x0, x1] x [y0, y1]."""
    u = camera_rig.spherical_offset(yaw_deg, elev_deg, 1.0)
    right, up, fwd = camera_rig.camera_basis(u, (0.0, 0.0, 0.0))
    tan_h, tan_v = camera_rig.sensor_half_tangents(lens_mm, aspect)
    sy_off = 2.0 * shift_y

    samples: List[Tuple[float, float]] = [
        (-1.0, -1.0), (0.0, -1.0), (1.0, -1.0),
        (-1.0, -0.35), (1.0, -0.35),
    ]
    if check_top:
        samples.extend([
            (-1.0, 1.0), (0.0, 1.0), (1.0, 1.0),
            (-1.0, 0.35), (1.0, 0.35),
        ])

    d_cap: Optional[float] = None
    dz_plane = z_plane - target[2]
    for sx, sy in samples:
        rx = fwd[0] + sx * tan_h * right[0] + (sy + sy_off) * tan_v * up[0]
        ry = fwd[1] + sx * tan_h * right[1] + (sy + sy_off) * tan_v * up[1]
        rz = fwd[2] + sx * tan_h * right[2] + (sy + sy_off) * tan_v * up[2]
        if rz >= -0.025:
            continue
        inv_rz = 1.0 / rz
        xb = target[0] + dz_plane * rx * inv_rz
        kx = u[0] - u[2] * rx * inv_rz
        yb = target[1] + dz_plane * ry * inv_rz
        ky = u[1] - u[2] * ry * inv_rz

        for base, slope, lo, hi in ((xb, kx, x0, x1), (yb, ky, y0, y1)):
            if abs(slope) < 1e-6:
                continue
            d_hi = (hi - base) / slope if slope > 0.0 else (lo - base) / slope
            if d_hi > 0.0:
                d_cap = d_hi if d_cap is None else min(d_cap, d_hi)
    return d_cap


def _recenter_oblique_target(
    yaw_deg: float,
    elev_deg: float,
    tx: float,
    ty: float,
    tz: float,
    desired_dist: float,
    lens_mm: float,
    aspect: float,
    x0: float,
    x1: float,
    y0: float,
    y1: float,
) -> Tuple[float, float, float]:
    """Shift oblique target so all 4 ground corners stay inside [x0..y1] at generous macro distance."""
    u = camera_rig.spherical_offset(yaw_deg, elev_deg, 1.0)
    right, up, fwd = camera_rig.camera_basis(u, (0.0, 0.0, 0.0))
    tan_h, tan_v = camera_rig.sensor_half_tangents(lens_mm, aspect)
    eye = (tx + u[0] * desired_dist, ty + u[1] * desired_dist, tz + u[2] * desired_dist)
    xs: List[float] = []
    ys: List[float] = []
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            rx = fwd[0] + sx * tan_h * right[0] + sy * tan_v * up[0]
            ry = fwd[1] + sx * tan_h * right[1] + sy * tan_v * up[1]
            rz = fwd[2] + sx * tan_h * right[2] + sy * tan_v * up[2]
            if rz < -0.02:
                t = (0.0 - eye[2]) / rz
                xs.append(eye[0] + t * rx)
                ys.append(eye[1] + t * ry)
    if xs and ys:
        span_x, avail_x = max(xs) - min(xs), x1 - x0
        span_y, avail_y = max(ys) - min(ys), y1 - y0
        if span_x >= avail_x * 0.92:
            dx = 0.5 * (x0 + x1) - 0.5 * (min(xs) + max(xs))
        else:
            dx = (x0 - min(xs)) if min(xs) < x0 else ((x1 - max(xs)) if max(xs) > x1 else 0.0)
        if span_y >= avail_y * 0.92:
            dy = 0.5 * (y0 + y1) - 0.5 * (min(ys) + max(ys))
        else:
            dy = (y0 - min(ys)) if min(ys) < y0 else ((y1 - max(ys)) if max(ys) > y1 else 0.0)
        tx = _clamp(tx + dx, x0 + 0.012, x1 - 0.012)
        ty = _clamp(ty + dy, y0 + 0.012, y1 - 0.012)
    d_cap = _max_safe_interior_distance(
        yaw_deg, elev_deg, (tx, ty, tz), lens_mm, aspect, 0.0,
        x0, x1, y0, y1, z_plane=0.0, check_top=True,
    )
    dist = desired_dist if d_cap is None else min(desired_dist, max(0.085, d_cap * 0.96))
    return tx, ty, dist


def compute_detail_still_pose(
    preset_name: str,
    analysis: Dict[str, Any],
    model_bounds: Dict[str, Any],
    aspect: float = 1.0,
) -> Dict[str, Any]:
    """Compute physical full-bleed telephoto macro pose for the 4 detail gallery presets."""
    canonical = "detail_waterfront" if preset_name == "detail_edge_horizon" else preset_name
    rec_yaw = float(analysis.get("recommended_yaw_deg", -24.0))
    water_side = analysis.get("water_side")
    hx, hy, hz = analysis["hero_peak"]
    htx, hty = analysis.get("hero_tower_xy", [hx, hy])
    sx, sy, _ = analysis["skyline_centroid"]
    wx, wy, _ = analysis.get("water_centroid", [sx, sy, 0.0])
    fw = float(analysis["frame_width_m"])
    fh = float(analysis["frame_height_m"])
    max_z = float(analysis["max_z"])
    desk_z = float(model_bounds.get("desk_z", model_bounds.get("desk_z_m", -0.00315)))

    # Strict perimeter safety box (4 mm inside tile walls + coastal water clearance)
    px0, px1, py0, py1 = _safe_xy_bounds(analysis, inset_x=0.004, inset_y=0.004, coastal_extra_frac=0.14)
    # Interior target anchor box (at least 26% inside outer borders)
    ix0, ix1, iy0, iy1 = _safe_xy_bounds(analysis, inset_x=0.26 * fw, inset_y=0.26 * fh, coastal_extra_frac=0.10)

    if canonical == "detail_spire":
        # Low eye-level telephoto: dense buildings fill bottom/sides, hero spire into #FFFFFF sky
        lens, fstop, elev, shift_y = 135.0, 22.0, 10.0, -0.05
        tan_h, tan_v = camera_rig.sensor_half_tangents(lens, aspect)
        if water_side == "-X":
            yaw = -8.0
        elif water_side == "+X":
            yaw = 8.0
        else:
            yaw = _clamp(rec_yaw * 0.40, -12.0, 12.0)
        # Keep hero spire cleanly framed while nudging slightly inland away from coastal water
        inland_bias = 0.34 if water_side in ("-X", "+X") else 0.16
        tx = _clamp((1.0 - inland_bias) * htx + inland_bias * sx, ix0, ix1)
        ty = _clamp(0.84 * hty + 0.16 * sy, iy0, iy1)
        # Bound distance so horizontal FOV stays strictly inside the dry city width
        safe_half_w = min(tx - px0, px1 - tx)
        max_w_d = max(0.18, 0.88 * safe_half_w / max(tan_h, 0.05))
        r_xy = min(0.13 * fw, max(0.013, 0.14 * max_z))
        probe_tz = max(0.50 * hz, 0.42 * max_z, 0.010)
        corners = camera_rig.bbox_corners(
            tx - r_xy, tx + r_xy, ty - r_xy * 0.65, ty + r_xy * 0.65,
            0.14 * max_z, max_z * 1.05,
        )
        raw_d = camera_rig.compute_fit_distance(yaw, elev, (tx, ty, probe_tz), corners, lens, aspect, 0.92, 0.82, shift_y)
        dist = max(0.18, min(raw_d * 0.90, max_w_d))
        # Raise tz dynamically for ultra-tall spires so peak always lands cleanly at ndc_y ~ +0.72
        top_headroom_m = (0.72 + 2.0 * shift_y) * dist * tan_v
        tz = max(0.46 * hz, hz - top_headroom_m)
        cam_dir = camera_rig.spherical_offset(yaw, elev, 1.0)
        focus_pt = (htx + cam_dir[0] * 0.004, hty + cam_dir[1] * 0.004, max(0.44 * hz, 0.008))

    elif canonical == "detail_canyon":
        # Low telephoto looking down a major avenue/park canyon into #FFFFFF horizon
        lens, fstop, elev, shift_y = 120.0, 24.0, 14.0, -0.02
        base_yaw = _portal_yaw_deg(analysis, rec_yaw * 0.40, limit_deg=12.0)
        if water_side == "-X":
            yaw = _clamp(base_yaw, -8.0, -2.0)
        elif water_side == "+X":
            yaw = _clamp(base_yaw, 2.0, 8.0)
        else:
            yaw = base_yaw
        portal = analysis.get("canyon_portal", {})
        pmid = portal.get("portal_mid", [sx, sy, 0.16 * max_z])
        cx0, cx1, cy0, cy1 = _safe_xy_bounds(analysis, inset_x=0.34 * fw, inset_y=0.26 * fh, coastal_extra_frac=0.10)
        tx = _clamp(0.40 * float(pmid[0]) + 0.30 * sx + 0.30 * htx, cx0, cx1)
        ty = _clamp(0.40 * float(pmid[1]) + 0.35 * sy + 0.25 * hty, cy0, cy1)
        tz = max(0.28 * max_z, 0.007)
        r_xy = min(0.13 * fw, max(0.013, 0.14 * fh))
        corners = camera_rig.bbox_corners(tx - r_xy, tx + r_xy, ty - r_xy, ty + r_xy, 0.08 * max_z, 0.78 * max_z)
        raw_d = camera_rig.compute_fit_distance(yaw, elev, (tx, ty, tz), corners, lens, aspect, 0.94, 0.82, shift_y)
        dist = max(0.15, raw_d * 0.84)
        d_cap = _max_safe_interior_distance(
            yaw, elev, (tx, ty, tz), lens, aspect, shift_y,
            px0, px1, py0, py1, z_plane=max(0.002, 0.05 * max_z), check_top=False,
        )
        if d_cap is not None:
            dist = min(dist, max(0.14, d_cap * 0.92))
        focus_pt = (tx, ty, max(0.24 * max_z, 0.006))

    elif canonical == "detail_waterfront":
        # Tight 30-deg interior macro highlighting waterfront bridges or dense downtown canyon tiers
        lens, fstop, elev, shift_y = 125.0, 24.0, 30.0, 0.0
        if water_side == "-X":
            yaw = -20.0
        elif water_side == "+X":
            yaw = 20.0
        else:
            yaw = 28.0 if rec_yaw <= 0.0 else -28.0
        in_interior_water = (water_side is None) and (ix0 <= wx <= ix1) and (iy0 <= wy <= iy1)
        if in_interior_water:
            tx = _clamp(0.42 * htx + 0.33 * sx + 0.25 * wx, ix0, ix1)
            ty = _clamp(0.42 * hty + 0.33 * sy + 0.25 * wy, iy0, iy1)
        else:
            tx = _clamp(0.45 * htx + 0.55 * sx, ix0, ix1)
            ty = _clamp(0.45 * hty + 0.55 * sy, iy0, iy1)
        tz = max(0.14 * max_z, 0.005)
        r_xy = min(0.13 * fw, 0.14 * fh)
        corners = camera_rig.bbox_corners(tx - r_xy, tx + r_xy, ty - r_xy, ty + r_xy, 0.0, 0.42 * max_z)
        desired_d = max(0.13, camera_rig.compute_fit_distance(yaw, elev, (tx, ty, tz), corners, lens, aspect, 0.96, 0.92) * 0.88)
        tx, ty, dist = _recenter_oblique_target(yaw, elev, tx, ty, tz, desired_d, lens, aspect, px0, px1, py0, py1)
        focus_pt = (tx, ty, max(0.18 * max_z, 0.006))

    else:  # detail_oblique_grid
        # Full-bleed 44-deg oblique architectural grid wall-to-wall across all 4 corners
        lens, fstop, elev, shift_y = 130.0, 28.0, 44.0, 0.0
        yaw = -36.0 if rec_yaw <= 0.0 else 36.0
        tx = _clamp(0.58 * sx + 0.42 * htx, ix0, ix1)
        ty = _clamp(0.58 * sy + 0.42 * hty, iy0, iy1)
        tz = max(0.14 * max_z, 0.005)
        r_xy = min(0.14 * fw, 0.15 * fh)
        corners = camera_rig.bbox_corners(tx - r_xy, tx + r_xy, ty - r_xy, ty + r_xy, 0.0, 0.40 * max_z)
        desired_d = max(0.13, camera_rig.compute_fit_distance(yaw, elev, (tx, ty, tz), corners, lens, aspect, 0.98, 0.96) * 0.90)
        tx, ty, dist = _recenter_oblique_target(yaw, elev, tx, ty, tz, desired_d, lens, aspect, px0, px1, py0, py1)
        focus_pt = (tx, ty, max(0.20 * max_z, 0.006))

    target = (tx, ty, tz)
    off = camera_rig.spherical_offset(yaw, elev, dist)
    eye = (target[0] + off[0], target[1] + off[1], max(desk_z + 0.012, target[2] + off[2]))
    return {
        "preset": canonical,
        "mount": "desk_flat",
        "eye": eye,
        "target": target,
        "focus_point": focus_pt,
        "lens_mm": lens,
        "fstop": fstop,
        "shift_x": 0.0,
        "shift_y": shift_y,
        "yaw_deg": yaw,
        "elev_deg": elev,
        "distance_m": dist,
    }
