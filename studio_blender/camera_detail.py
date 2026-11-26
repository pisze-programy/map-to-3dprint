"""Dedicated frameless chalk-plaster architectural detail gallery camera presets.

Implements 4 universal full-bleed telephoto macro presets plus 9 deterministic 3x3 grid
presets (`detail_grid_01`..`detail_grid_09`) calibrated for minimal-blur architectural
sharpness (f/56.0 default so full miniature depth stays tack-sharp) with strict interior
frustum clamping so zero outer tile borders or backing edges enter:
  - `detail_spire`: Low 135mm f/56.0 eye-level spire soaring into pure #FFFFFF sky.
  - `detail_canyon`: Low 120mm f/56.0 avenue/park canyon receding into #FFFFFF horizon.
  - `detail_oblique_grid`: Full-bleed 130mm f/56.0 44-deg oblique urban grid wall-to-wall.
  - `detail_waterfront`: Tight 125mm f/56.0 30-deg interior waterfront/canyon tier macro.
  - `detail_grid_01`..`detail_grid_09`: Deterministic 3x3 NW..SE interior macro mosaic.
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None  # type: ignore

from studio_blender import camera_rig


DETAIL_GRID_PRESETS: Tuple[str, ...] = tuple(f"detail_grid_{i:02d}" for i in range(1, 10))

DETAIL_STILL_PRESETS: Tuple[str, ...] = (
    "detail_spire",
    "detail_canyon",
    "detail_oblique_grid",
    "detail_waterfront",
) + DETAIL_GRID_PRESETS

# Ordered top-row L->R (01,02,03 = NW,N,NE), mid (04,05,06 = W,Center/Hero,E), bot (07,08,09 = SW,S,SE)
# Tuple: (col_idx in {-1,0,1}, row_idx in {-1,0,1}, yaw_deg, elev_deg, lens_mm)
_DETAIL_GRID_SPECS: Dict[str, Tuple[int, int, float, float, float]] = {
    "detail_grid_01": (-1, 1, -28.0, 34.0, 130.0),
    "detail_grid_02": (0, 1, 14.0, 30.0, 135.0),
    "detail_grid_03": (1, 1, 28.0, 36.0, 128.0),
    "detail_grid_04": (-1, 0, -34.0, 38.0, 125.0),
    "detail_grid_05": (0, 0, -20.0, 26.0, 135.0),
    "detail_grid_06": (1, 0, 34.0, 40.0, 125.0),
    "detail_grid_07": (-1, -1, -24.0, 35.0, 130.0),
    "detail_grid_08": (0, -1, -16.0, 28.0, 135.0),
    "detail_grid_09": (1, -1, 26.0, 42.0, 128.0),
}

_DIGIT_FONT_5X7: Dict[str, Tuple[int, ...]] = {
    "1": (0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110),
    "2": (0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111),
    "3": (0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110),
    "4": (0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010),
    "5": (0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110),
    "6": (0b01110, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110),
    "7": (0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000),
    "8": (0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110),
    "9": (0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110),
}


def parse_focus_xy(focus_xy: Optional[Union[str, Sequence[float]]]) -> Optional[Tuple[float, float]]:
    """Parse optional focus XY override in millimeters ('x_mm,y_mm' or (x_mm, y_mm))."""
    if focus_xy is None:
        return None
    if isinstance(focus_xy, str):
        raw = focus_xy.strip()
        if not raw:
            return None
        parts = [p.strip() for p in raw.replace(";", ",").split(",") if p.strip()]
        if len(parts) != 2:
            raise ValueError(f"Invalid --focus-xy '{focus_xy}'. Expected 'x_mm,y_mm'.")
        return (float(parts[0]), float(parts[1]))
    vals = list(focus_xy)
    if len(vals) != 2:
        raise ValueError(f"Invalid focus_xy '{focus_xy}'. Expected 2 numeric coordinates in mm.")
    return (float(vals[0]), float(vals[1]))


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
    fstop: Optional[float] = None,
    focus_xy: Optional[Union[str, Sequence[float]]] = None,
) -> Dict[str, Any]:
    """Compute physical full-bleed telephoto macro pose for detail gallery and 3x3 grid presets."""
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

    if canonical in _DETAIL_GRID_SPECS:
        col_idx, row_idx, yaw_spec, elev, lens = _DETAIL_GRID_SPECS[canonical]
        fstop_default, shift_y = 56.0, 0.0
        gx0, gx1, gy0, gy1 = _safe_xy_bounds(analysis, inset_x=0.005, inset_y=0.005, coastal_extra_frac=0.12)
        span_x, span_y = max(0.01, gx1 - gx0), max(0.01, gy1 - gy0)
        ax0, ax1 = gx0 + 0.14 * span_x, gx1 - 0.14 * span_x
        ay0, ay1 = gy0 + 0.14 * span_y, gy1 - 0.14 * span_y
        cx_mid, cy_mid = 0.5 * (ax0 + ax1), 0.5 * (ay0 + ay1)
        if col_idx == 0 and row_idx == 0:
            yaw = -abs(yaw_spec) if rec_yaw <= 0.0 else abs(yaw_spec)
            tx = _clamp(0.40 * htx + 0.60 * cx_mid, cx_mid - 0.16 * span_x, cx_mid + 0.16 * span_x)
            ty = _clamp(0.40 * hty + 0.60 * cy_mid, cy_mid - 0.16 * span_y, cy_mid + 0.16 * span_y)
        else:
            yaw = yaw_spec
            tx = cx_mid + float(col_idx) * 0.5 * max(0.0, ax1 - ax0) * 0.85
            ty = cy_mid + float(row_idx) * 0.5 * max(0.0, ay1 - ay0) * 0.85
        tz = max(0.14 * max_z, 0.004)
        r_xy = min(0.135 * fw, 0.135 * fh)
        corners = camera_rig.bbox_corners(tx - r_xy, tx + r_xy, ty - r_xy, ty + r_xy, 0.0, 0.38 * max_z)
        desired_d = max(0.115, camera_rig.compute_fit_distance(yaw, elev, (tx, ty, tz), corners, lens, aspect, 0.95, 0.92) * 0.90)
        tx, ty, dist = _recenter_oblique_target(yaw, elev, tx, ty, tz, desired_d, lens, aspect, gx0, gx1, gy0, gy1)
        focus_pt = (tx, ty, max(0.18 * max_z, 0.006))

    elif canonical == "detail_spire":
        # Low eye-level telephoto: dense buildings fill bottom/sides, hero spire into #FFFFFF sky
        lens, fstop_default, elev, shift_y = 135.0, 56.0, 10.0, -0.05
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
        lens, fstop_default, elev, shift_y = 120.0, 56.0, 14.0, -0.02
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
        lens, fstop_default, elev, shift_y = 125.0, 56.0, 30.0, 0.0
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
        lens, fstop_default, elev, shift_y = 130.0, 56.0, 44.0, 0.0
        yaw = -36.0 if rec_yaw <= 0.0 else 36.0
        tx = _clamp(0.58 * sx + 0.42 * htx, ix0, ix1)
        ty = _clamp(0.58 * sy + 0.42 * hty, iy0, iy1)
        tz = max(0.14 * max_z, 0.005)
        r_xy = min(0.14 * fw, 0.15 * fh)
        corners = camera_rig.bbox_corners(tx - r_xy, tx + r_xy, ty - r_xy, ty + r_xy, 0.0, 0.40 * max_z)
        desired_d = max(0.13, camera_rig.compute_fit_distance(yaw, elev, (tx, ty, tz), corners, lens, aspect, 0.98, 0.96) * 0.90)
        tx, ty, dist = _recenter_oblique_target(yaw, elev, tx, ty, tz, desired_d, lens, aspect, px0, px1, py0, py1)
        focus_pt = (tx, ty, max(0.20 * max_z, 0.006))

    eff_fstop = float(fstop) if fstop is not None else fstop_default
    parsed_focus = parse_focus_xy(focus_xy)
    if parsed_focus is not None:
        focus_pt = (parsed_focus[0] * 0.001, parsed_focus[1] * 0.001, focus_pt[2])

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
        "fstop": eff_fstop,
        "shift_x": 0.0,
        "shift_y": shift_y,
        "yaw_deg": yaw,
        "elev_deg": elev,
        "distance_m": dist,
    }


def _decode_png_rgb(path: Path) -> Tuple[int, int, Any]:
    """Decode an 8-bit non-interlaced RGB/RGBA PNG into an (H, W, 3) uint8 numpy array or nested bytes."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Not a PNG file: {path}")
    pos = 8
    width = height = bit_depth = color_type = 0
    idat_chunks: List[bytes] = []
    while pos + 8 <= len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        ctype = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, bit_depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", chunk)
            if bit_depth != 8 or color_type not in (2, 6) or interlace != 0:
                raise ValueError(f"Unsupported PNG format ({bit_depth}b, type={color_type}, interlace={interlace}): {path}")
        elif ctype == b"IDAT":
            idat_chunks.append(chunk)
        elif ctype == b"IEND":
            break

    bpp = 3 if color_type == 2 else 4
    stride = width * bpp
    raw = zlib.decompress(b"".join(idat_chunks))
    if len(raw) < height * (stride + 1):
        raise ValueError(f"Corrupt PNG data length in {path}")

    if np is not None:
        arr = np.frombuffer(raw, dtype=np.uint8, count=height * (stride + 1)).reshape((height, stride + 1))
        out = np.zeros((height, stride), dtype=np.uint8)
        prev = np.zeros(stride, dtype=np.int16)
        for y in range(height):
            ft = int(arr[y, 0])
            row = arr[y, 1:].astype(np.int16)
            if ft == 0:
                recon = row
            elif ft == 1:
                recon = row.copy()
                for x in range(bpp, stride):
                    recon[x] = (recon[x] + recon[x - bpp]) & 0xFF
            elif ft == 2:
                recon = (row + prev) & 0xFF
            elif ft == 3:
                recon = row.copy()
                for x in range(stride):
                    a = int(recon[x - bpp]) if x >= bpp else 0
                    recon[x] = (recon[x] + ((a + int(prev[x])) >> 1)) & 0xFF
            elif ft == 4:
                recon = row.copy()
                for x in range(stride):
                    a = int(recon[x - bpp]) if x >= bpp else 0
                    b = int(prev[x])
                    c = int(prev[x - bpp]) if x >= bpp else 0
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                    recon[x] = (recon[x] + pr) & 0xFF
            else:
                raise ValueError(f"Unsupported PNG filter {ft} in {path}")
            prev = recon
            out[y] = recon.astype(np.uint8)
        img = out.reshape((height, width, bpp))
        if bpp == 4:
            alpha = img[:, :, 3:4].astype(np.float32) / 255.0
            rgb = (img[:, :, :3].astype(np.float32) * alpha + 255.0 * (1.0 - alpha)).clip(0, 255).astype(np.uint8)
            return width, height, rgb
        return width, height, img

    rows: List[bytearray] = []
    prev_row = bytearray(stride)
    for y in range(height):
        base = y * (stride + 1)
        ft = raw[base]
        row = raw[base + 1 : base + 1 + stride]
        recon = bytearray(stride)
        if ft == 0:
            recon[:] = row
        elif ft == 1:
            for x in range(stride):
                a = recon[x - bpp] if x >= bpp else 0
                recon[x] = (row[x] + a) & 0xFF
        elif ft == 2:
            for x in range(stride):
                recon[x] = (row[x] + prev_row[x]) & 0xFF
        elif ft == 3:
            for x in range(stride):
                a = recon[x - bpp] if x >= bpp else 0
                recon[x] = (row[x] + ((a + prev_row[x]) >> 1)) & 0xFF
        elif ft == 4:
            for x in range(stride):
                a = recon[x - bpp] if x >= bpp else 0
                b = prev_row[x]
                c = prev_row[x - bpp] if x >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                recon[x] = (row[x] + pr) & 0xFF
        else:
            raise ValueError(f"Unsupported PNG filter {ft} in {path}")
        prev_row = recon
        if bpp == 4:
            rgb_row = bytearray(width * 3)
            for x in range(width):
                r, g, b, al = recon[4 * x], recon[4 * x + 1], recon[4 * x + 2], recon[4 * x + 3]
                inv = 255 - al
                rgb_row[3 * x] = (r * al + 255 * inv) // 255
                rgb_row[3 * x + 1] = (g * al + 255 * inv) // 255
                rgb_row[3 * x + 2] = (b * al + 255 * inv) // 255
            rows.append(rgb_row)
        else:
            rows.append(recon)
    return width, height, rows


def _encode_png_rgb(out_path: Path, width: int, height: int, rgb_data: Any) -> None:
    """Write an 8-bit RGB PNG file using pure Python zlib and struct."""
    def _chunk(tag: bytes, payload: bytes) -> bytes:
        crc = zlib.crc32(tag + payload) & 0xFFFFFFFF
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", crc)

    if np is not None and hasattr(rgb_data, "shape"):
        raw_buf = np.empty((height, width * 3 + 1), dtype=np.uint8)
        raw_buf[:, 0] = 0
        raw_buf[:, 1:] = rgb_data.reshape((height, width * 3))
        raw_bytes = raw_buf.tobytes()
    else:
        raw_bytes = b"".join(b"\x00" + bytes(r) for r in rgb_data)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png_bytes = b"".join([
        b"\x89PNG\r\n\x1a\n",
        _chunk(b"IHDR", ihdr),
        _chunk(b"IDAT", zlib.compress(raw_bytes, level=6)),
        _chunk(b"IEND", b""),
    ])
    out_path.write_bytes(png_bytes)


def _draw_cell_label(canvas: Any, x0: int, y0: int, cell_w: int, label: str) -> None:
    """Stamp a crisp subtle 5x7 cell number badge in the top-left corner of a mosaic cell."""
    glyph = _DIGIT_FONT_5X7.get(label)
    if glyph is None:
        return
    scale = 3 if cell_w >= 480 else 2
    pad = max(6, scale * 3)
    bx0, by0 = x0 + pad, y0 + pad
    bw, bh = 5 * scale + 2 * scale * 2, 7 * scale + 2 * scale * 2
    if np is not None and hasattr(canvas, "shape"):
        canvas[by0 : by0 + bh, bx0 : bx0 + bw] = (248, 248, 248)
        gx0, gy0 = bx0 + scale * 2, by0 + scale * 2
        for ry, bits in enumerate(glyph):
            for rx in range(5):
                if (bits >> (4 - rx)) & 1:
                    canvas[gy0 + ry * scale : gy0 + (ry + 1) * scale, gx0 + rx * scale : gx0 + (rx + 1) * scale] = (64, 64, 68)
        return
    for yy in range(by0, by0 + bh):
        row = canvas[yy]
        for xx in range(bx0, bx0 + bw):
            row[3 * xx : 3 * xx + 3] = b"\xf8\xf8\xf8"
    gx0, gy0 = bx0 + scale * 2, by0 + scale * 2
    for ry, bits in enumerate(glyph):
        for rx in range(5):
            if (bits >> (4 - rx)) & 1:
                for yy in range(gy0 + ry * scale, gy0 + (ry + 1) * scale):
                    row = canvas[yy]
                    for xx in range(gx0 + rx * scale, gx0 + (rx + 1) * scale):
                        row[3 * xx : 3 * xx + 3] = b"\x40\x40\x44"


def stitch_detail_grid_3x3(
    image_paths: Sequence[Union[str, Path]],
    out_path: Union[str, Path],
    gutter_px: int = 6,
    add_labels: bool = True,
) -> str:
    """Stitch 9 square detail PNGs into a 3x3 white-gutter mosaic using pure zlib/struct (with numpy fast path)."""
    if len(image_paths) != 9:
        raise ValueError(f"Expected 9 images for 3x3 mosaic, got {len(image_paths)}.")
    paths = [Path(p) for p in image_paths]
    decoded = [_decode_png_rgb(p) for p in paths]
    src_w, src_h, _ = decoded[0]
    for w, h, _ in decoded:
        if w != src_w or h != src_h:
            raise ValueError(f"All 3x3 mosaic cells must share dimensions, got {w}x{h} vs {src_w}x{src_h}.")

    # Box-downsample 2x when source tiles are high-res (>800px) so mosaic stays fast & crisp
    step = 2 if (src_w >= 1000 and src_h >= 1000 and src_w % 2 == 0 and src_h % 2 == 0) else 1
    cell_w, cell_h = src_w // step, src_h // step
    g = max(0, int(gutter_px))
    mosaic_w = 3 * cell_w + 4 * g
    mosaic_h = 3 * cell_h + 4 * g

    if np is not None:
        canvas = np.full((mosaic_h, mosaic_w, 3), 255, dtype=np.uint8)
        for idx, (_, _, rgb) in enumerate(decoded):
            r, c = divmod(idx, 3)
            cell = (
                ((rgb[0::2, 0::2].astype(np.uint16) + rgb[0::2, 1::2] + rgb[1::2, 0::2] + rgb[1::2, 1::2]) // 4).astype(np.uint8)
                if step == 2
                else rgb
            )
            x0 = g + c * (cell_w + g)
            y0 = g + r * (cell_h + g)
            canvas[y0 : y0 + cell_h, x0 : x0 + cell_w] = cell
            if add_labels:
                _draw_cell_label(canvas, x0, y0, cell_w, str(idx + 1))
    else:
        canvas = [bytearray(b"\xff" * (mosaic_w * 3)) for _ in range(mosaic_h)]
        for idx, (_, _, rows) in enumerate(decoded):
            r, c = divmod(idx, 3)
            x0 = g + c * (cell_w + g)
            y0 = g + r * (cell_h + g)
            for cy in range(cell_h):
                src_row = rows[cy * step]
                dst_row = canvas[y0 + cy]
                if step == 1:
                    dst_row[3 * x0 : 3 * (x0 + cell_w)] = src_row
                else:
                    for cx in range(cell_w):
                        si = 3 * cx * step
                        di = 3 * (x0 + cx)
                        dst_row[di : di + 3] = src_row[si : si + 3]
            if add_labels:
                _draw_cell_label(canvas, x0, y0, cell_w, str(idx + 1))

    dst = Path(out_path)
    dst.parent.mkdir(parents=True, exist_ok=True)
    _encode_png_rgb(dst, mosaic_w, mosaic_h, canvas)
    return str(dst)
