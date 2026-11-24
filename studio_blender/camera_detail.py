"""Dedicated frameless chalk-plaster architectural detail gallery camera presets.

Implements 4 universal telephoto macro presets calibrated for real 1:3-1:2 macro DoF
(f/5.6-f/7.1 so hero towers and street facades stay tack-sharp while foreground rooftops
and far horizon dissolve into smooth circular bokeh):
  - `detail_spire`: Hero spire soaring into bright #FFFFFF sunlit horizon, full-bleed base.
  - `detail_canyon`: Diagonal street/avenue canyon slashed by crisp raking shadows.
  - `detail_oblique_grid`: Full-bleed 46-deg oblique urban grid wall-to-wall with zero corners.
  - `detail_edge_horizon`: Iconic diagonal matte-black slab edge slicing cleanly over #FFFFFF.
"""

from __future__ import annotations

import math
from typing import Any, Dict, Tuple

from studio_blender import camera_rig


DETAIL_STILL_PRESETS: Tuple[str, ...] = (
    "detail_spire",
    "detail_canyon",
    "detail_oblique_grid",
    "detail_edge_horizon",
)


def _portal_yaw_deg(analysis: Dict[str, Any], fallback_yaw: float) -> float:
    portal = analysis.get("canyon_portal", {})
    dx, dy = portal.get("direction", [0.0, 1.0])
    if abs(dx) < 1e-4 and abs(dy) < 1e-4:
        return fallback_yaw
    raw = math.degrees(math.atan2(-dx, max(dy, 0.18)))
    return max(-48.0, min(48.0, raw))


def compute_detail_still_pose(
    preset_name: str,
    analysis: Dict[str, Any],
    model_bounds: Dict[str, Any],
    aspect: float = 1.0,
) -> Dict[str, Any]:
    """Compute physical telephoto macro pose for any of the 4 detail gallery presets."""
    rec_yaw = float(analysis.get("recommended_yaw_deg", -24.0))
    hx, hy, hz = analysis["hero_peak"]
    htx, hty = analysis.get("hero_tower_xy", [hx, hy])
    sx, sy, _ = analysis["skyline_centroid"]
    fw = float(analysis["frame_width_m"])
    fh = float(analysis["frame_height_m"])
    max_z = float(analysis["max_z"])
    desk_z = float(model_bounds.get("desk_z", model_bounds.get("desk_z_m", -0.0028)))

    if preset_name == "detail_spire":
        # Full-bleed lower skyline with hero spire soaring into luminous #FFFFFF horizon
        lens, fstop, elev, shift_y = 110.0, 5.6, 17.0, -0.045
        yaw = rec_yaw * 0.52
        tx = 0.80 * htx + 0.20 * sx
        ty = 0.80 * hty + 0.20 * sy
        tz = max(0.45 * hz, 0.36 * max_z, 0.008)
        r_xy = min(0.20 * fw, max(0.018, 0.22 * max_z))
        corners = camera_rig.bbox_corners(
            min(tx - r_xy, htx - 0.006), max(tx + r_xy, htx + 0.006),
            min(ty - r_xy * 0.7, hty - 0.006), max(ty + r_xy * 0.7, hty + 0.006),
            0.06 * max_z, max_z * 1.06,
        )
        raw_d = camera_rig.compute_fit_distance(yaw, elev, (tx, ty, tz), corners, lens, aspect, 0.94, 0.84, shift_y)
        dist = max(0.16, raw_d * 0.82)
        cam_dir = camera_rig.spherical_offset(yaw, elev, 1.0)
        focus_pt = (htx + cam_dir[0] * 0.004, hty + cam_dir[1] * 0.004, max(0.36 * hz, 0.008))

    elif preset_name == "detail_canyon":
        # Crisp diagonal architectural avenue/canyon with raking hard sunlight shadows
        lens, fstop, elev, shift_y = 95.0, 5.6, 34.0, 0.0
        yaw = _portal_yaw_deg(analysis, rec_yaw * 1.05)
        portal = analysis.get("canyon_portal", {})
        pmid = portal.get("portal_mid", [sx, sy, 0.16 * max_z])
        tx = 0.45 * float(pmid[0]) + 0.35 * sx + 0.20 * htx
        ty = 0.45 * float(pmid[1]) + 0.35 * sy + 0.20 * hty
        tz = max(0.16 * max_z, 0.005)
        r_xy = min(0.22 * fw, max(0.018, 0.22 * fh))
        corners = camera_rig.bbox_corners(tx - r_xy, tx + r_xy, ty - r_xy, ty + r_xy, 0.0, 0.48 * max_z)
        raw_d = camera_rig.compute_fit_distance(yaw, elev, (tx, ty, tz), corners, lens, aspect, 0.96, 0.90)
        dist = max(0.15, raw_d * 0.88)
        focus_pt = (tx, ty, max(0.20 * max_z, 0.006))

    elif preset_name == "detail_edge_horizon":
        # Bold diagonal matte-black frameless slab edge slicing cleanly over pure #FFFFFF
        lens, fstop, elev, shift_y = 100.0, 5.6, 24.0, -0.02
        yaw = -24.0 if rec_yaw <= 0.0 else 24.0
        tx = 0.24 * sx
        ty = -0.32 * fh
        tz = max(0.20 * max_z, 0.006)
        r_x = 0.22 * fw
        corners = camera_rig.bbox_corners(
            tx - r_x, tx + r_x,
            -0.52 * fh, -0.10 * fh,
            desk_z - 0.003, 0.56 * max_z,
        )
        raw_d = camera_rig.compute_fit_distance(yaw, elev, (tx, ty, tz), corners, lens, aspect, 0.94, 0.84, shift_y)
        dist = max(0.15, raw_d * 0.84)
        focus_pt = (tx, -0.38 * fh, max(0.22 * max_z, 0.006))

    else:  # detail_oblique_grid
        # Full-bleed 46-deg oblique architectural grid wall-to-wall with zero empty corners
        lens, fstop, elev, shift_y = 115.0, 7.1, 46.0, 0.0
        yaw = -34.0 if rec_yaw <= 0.0 else 34.0
        tx = 0.62 * sx + 0.38 * htx
        ty = 0.62 * sy + 0.38 * hty
        tz = max(0.16 * max_z, 0.005)
        r_xy = min(0.18 * fw, 0.19 * fh)
        corners = camera_rig.bbox_corners(tx - r_xy, tx + r_xy, ty - r_xy, ty + r_xy, 0.0, 0.42 * max_z)
        raw_d = camera_rig.compute_fit_distance(yaw, elev, (tx, ty, tz), corners, lens, aspect, 0.98, 0.96)
        dist = max(0.15, raw_d * 0.90)
        focus_pt = (tx, ty, max(0.22 * max_z, 0.006))

    target = (tx, ty, tz)
    off = camera_rig.spherical_offset(yaw, elev, dist)
    eye = (target[0] + off[0], target[1] + off[1], max(desk_z + 0.012, target[2] + off[2]))
    return {
        "preset": preset_name,
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
