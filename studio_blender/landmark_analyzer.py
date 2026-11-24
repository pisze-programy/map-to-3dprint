"""Universal architectural landmark, waterfront, and street-canyon analyzer.

Inspects Blender mesh vertices directly in world meters to compute city-agnostic
landmarks (hero_peak, hero_tower_xy, skyline_centroid, water_side, water_centroid,
canyon_portal, recommended_yaw_deg) with zero hardcoded city coordinates.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None  # type: ignore

try:
    from mathutils import Matrix
except ImportError:  # pragma: no cover
    Matrix = None  # type: ignore


def get_mesh_coords_array(obj: Any) -> Any:
    """Return mesh vertex coordinates in world space as an (N, 3) numpy float64 array."""
    mesh = obj.data
    n_verts = len(mesh.vertices)
    if n_verts == 0:
        raise ValueError(f"Mesh '{obj.name}' has 0 vertices.")

    if np is not None:
        coords = np.empty(n_verts * 3, dtype=np.float64)
        mesh.vertices.foreach_get("co", coords)
        pts = coords.reshape((n_verts, 3))
        mat = obj.matrix_world
        if mat != Matrix.Identity(4):
            m_np = np.array(mat, dtype=np.float64)
            pts = pts @ m_np[:3, :3].T + m_np[:3, 3]
        return pts

    mat = obj.matrix_world
    return [tuple(mat @ v.co) for v in mesh.vertices]


def _find_canyon_portal(
    grid_z: Any,
    x_edges: Any,
    y_edges: Any,
    hero_peak: Tuple[float, float, float],
    skyline_centroid: Tuple[float, float, float],
    water_side: Optional[str],
    frame_w: float,
    frame_h: float,
    max_z: float,
) -> Dict[str, Any]:
    """Score pairs of tall towers with a clear street-canyon gap pointing toward hero_peak."""
    nx, ny = grid_z.shape
    cx_centers = 0.5 * (x_edges[:-1] + x_edges[1:])
    cy_centers = 0.5 * (y_edges[:-1] + y_edges[1:])

    min_tower_z = max(0.24 * max_z, 0.004)
    peaks: List[Tuple[int, int, float, float, float]] = []
    for ix in range(1, nx - 1):
        for iy in range(1, ny - 1):
            z = float(grid_z[ix, iy])
            if z < min_tower_z:
                continue
            patch = grid_z[ix - 1 : ix + 2, iy - 1 : iy + 2]
            if z >= float(patch.max()) - 1e-6:
                peaks.append((ix, iy, float(cx_centers[ix]), float(cy_centers[iy]), z))

    peaks.sort(key=lambda item: item[4], reverse=True)
    peaks = peaks[:28]

    hx, hy, hz = hero_peak
    sx, sy, _ = skyline_centroid
    best: Optional[Dict[str, Any]] = None
    best_score = -1e9

    min_sep = max(0.008, min(frame_w, frame_h) * 0.08)
    max_sep = max(0.036, min(frame_w, frame_h) * 0.45)

    for i in range(len(peaks)):
        _, _, x1, y1, z1 = peaks[i]
        for j in range(i + 1, len(peaks)):
            _, _, x2, y2, z2 = peaks[j]
            dx = x2 - x1
            dy = y2 - y1
            sep = math.hypot(dx, dy)
            if sep < min_sep or sep > max_sep:
                continue

            mx = 0.5 * (x1 + x2)
            my = 0.5 * (y1 + y2)

            valley_samples: List[float] = []
            for frac in (0.35, 0.50, 0.65):
                px = x1 + frac * dx
                py = y1 + frac * dy
                gix = min(nx - 1, max(0, int((px - x_edges[0]) / (x_edges[-1] - x_edges[0]) * nx)))
                giy = min(ny - 1, max(0, int((py - y_edges[0]) / (y_edges[-1] - y_edges[0]) * ny)))
                valley_samples.append(float(grid_z[gix, giy]))
            valley_z = sum(valley_samples) / len(valley_samples)
            shorter_tower = min(z1, z2)
            gap_ratio = 1.0 - (valley_z / max(shorter_tower, 1e-5))
            if gap_ratio < 0.25:
                continue

            ux, uy = -dy / sep, dx / sep
            for sign in (1.0, -1.0):
                dir_x = ux * sign
                dir_y = uy * sign

                to_hero_x = hx - mx
                to_hero_y = hy - my
                to_hero_dist = math.hypot(to_hero_x, to_hero_y)
                if to_hero_dist < 0.004:
                    to_hero_x = sx - mx
                    to_hero_y = sy - my
                    to_hero_dist = math.hypot(to_hero_x, to_hero_y)
                if to_hero_dist < 1e-4:
                    continue

                align_hero = (dir_x * to_hero_x + dir_y * to_hero_y) / to_hero_dist
                if align_hero < 0.35:
                    continue

                front_bonus = 0.35 * max(0.0, dir_y)
                water_bonus = 0.0
                if water_side == "-X" and dir_x > 0.2:
                    water_bonus = 0.25 * dir_x
                elif water_side == "+X" and dir_x < -0.2:
                    water_bonus = 0.25 * (-dir_x)
                elif water_side == "-Y" and dir_y > 0.2:
                    water_bonus = 0.25 * dir_y

                entry_dist = max(0.018, sep * 0.9)
                ex = mx - dir_x * entry_dist
                ey = my - dir_y * entry_dist
                openness = 1.0
                if x_edges[0] <= ex <= x_edges[-1] and y_edges[0] <= ey <= y_edges[-1]:
                    eix = min(nx - 1, max(0, int((ex - x_edges[0]) / (x_edges[-1] - x_edges[0]) * nx)))
                    eiy = min(ny - 1, max(0, int((ey - y_edges[0]) / (y_edges[-1] - y_edges[0]) * ny)))
                    openness = max(0.2, 1.0 - float(grid_z[eix, eiy]) / max(max_z, 1e-5))

                height_factor = (z1 + z2) / (2.0 * max(max_z, 1e-5))
                score = (
                    2.0 * align_hero
                    + 1.4 * gap_ratio
                    + 1.0 * height_factor
                    + 0.7 * openness
                    + front_bonus
                    + water_bonus
                )
                if score > best_score:
                    best_score = score
                    entry_z_m = max(valley_z + 0.008, 0.22 * shorter_tower, 0.006)
                    best = {
                        "entry": [round(ex, 5), round(ey, 5), round(entry_z_m, 5)],
                        "portal_mid": [round(mx, 5), round(my, 5), round(max(valley_z, 0.004), 5)],
                        "target": [round(hx, 5), round(hy, 5), round(min(hz * 0.55, max_z * 0.65), 5)],
                        "tower_a": [round(x1, 5), round(y1, 5), round(z1, 5)],
                        "tower_b": [round(x2, 5), round(y2, 5), round(z2, 5)],
                        "direction": [round(dir_x, 4), round(dir_y, 4)],
                        "score": round(score, 4),
                    }

    if best is not None:
        return best

    if water_side == "-X":
        dir_x, dir_y = 0.65, 0.76
    elif water_side == "+X":
        dir_x, dir_y = -0.65, 0.76
    else:
        dir_x, dir_y = 0.25, 0.97
    norm = math.hypot(dir_x, dir_y)
    dir_x /= norm
    dir_y /= norm
    ex = hx - dir_x * (0.35 * max(frame_w, frame_h))
    ey = hy - dir_y * (0.35 * max(frame_w, frame_h))
    return {
        "entry": [round(ex, 5), round(ey, 5), round(max(0.25 * max_z, 0.008), 5)],
        "portal_mid": [round(0.5 * (ex + hx), 5), round(0.5 * (ey + hy), 5), round(max(0.2 * max_z, 0.006), 5)],
        "target": [round(hx, 5), round(hy, 5), round(0.45 * max_z, 5)],
        "tower_a": [round(hx, 5), round(hy, 5), round(hz, 5)],
        "tower_b": [round(sx, 5), round(sy, 5), round(skyline_centroid[2], 5)],
        "direction": [round(dir_x, 4), round(dir_y, 4)],
        "score": 0.0,
    }


def analyze_city_mesh(
    obj: Any,
    frame_width_m: Optional[float] = None,
    frame_height_m: Optional[float] = None,
) -> Dict[str, Any]:
    """Inspect a Blender mesh object (or list of objects) to auto-detect landmarks."""
    objs = list(obj) if isinstance(obj, (list, tuple)) else [obj]
    if not objs:
        raise ValueError("analyze_city_mesh requires at least one mesh object.")

    if np is not None:
        arrays = [get_mesh_coords_array(o) for o in objs]
        pts = np.vstack(arrays) if len(arrays) > 1 else arrays[0]
        xs, ys, zs = pts[:, 0], pts[:, 1], pts[:, 2]

        min_x, max_x = float(xs.min()), float(xs.max())
        min_y, max_y = float(ys.min()), float(ys.max())
        min_z, max_z = float(zs.min()), float(zs.max())
        n_verts = int(pts.shape[0])

        peak_idx = int(np.argmax(zs))
        hx, hy, hz = float(xs[peak_idx]), float(ys[peak_idx]), float(zs[peak_idx])

        dist2 = (xs - hx) ** 2 + (ys - hy) ** 2
        shaft_mask = (dist2 <= 0.005 ** 2) & (zs >= max(0.35 * hz, min_z + 0.002))
        tx = float(xs[shaft_mask].mean()) if np.any(shaft_mask) else hx
        ty = float(ys[shaft_mask].mean()) if np.any(shaft_mask) else hy

        z95 = float(np.percentile(zs, 95))
        top_thresh = max(z95, min_z + 0.20 * (max_z - min_z))
        top_mask = zs >= top_thresh
        if not np.any(top_mask):
            top_mask = zs >= z95
        weights = np.maximum(zs[top_mask] - min_z, 1e-6)
        w_sum = float(weights.sum())
        cx = float((xs[top_mask] * weights).sum() / w_sum)
        cy = float((ys[top_mask] * weights).sum() / w_sum)
        cz = float((zs[top_mask] * weights).sum() / w_sum)
    else:  # pragma: no cover
        pts_list: List[Tuple[float, float, float]] = []
        for o in objs:
            pts_list.extend(get_mesh_coords_array(o))
        n_verts = len(pts_list)
        xs_l = [p[0] for p in pts_list]
        ys_l = [p[1] for p in pts_list]
        zs_l = [p[2] for p in pts_list]
        min_x, max_x = min(xs_l), max(xs_l)
        min_y, max_y = min(ys_l), max(ys_l)
        min_z, max_z = min(zs_l), max(zs_l)
        hx, hy, hz = max(pts_list, key=lambda p: p[2])
        tx, ty = hx, hy
        z95 = sorted(zs_l)[int(0.95 * (n_verts - 1))]
        top = [p for p in pts_list if p[2] >= z95]
        w_sum = sum(max(p[2] - min_z, 1e-6) for p in top)
        cx = sum(p[0] * max(p[2] - min_z, 1e-6) for p in top) / w_sum
        cy = sum(p[1] * max(p[2] - min_z, 1e-6) for p in top) / w_sum
        cz = sum(p[2] * max(p[2] - min_z, 1e-6) for p in top) / w_sum

    size_x, size_y, size_z = max_x - min_x, max_y - min_y, max_z - min_z
    fw = frame_width_m if frame_width_m and frame_width_m > 0 else max(size_x, 0.01)
    fh = frame_height_m if frame_height_m and frame_height_m > 0 else max(size_y, 0.01)

    nx = 32
    ny = max(16, int(round(nx * (fh / max(fw, 1e-4)))))
    x_min_f, x_max_f = -0.5 * fw, 0.5 * fw
    y_min_f, y_max_f = -0.5 * fh, 0.5 * fh

    if np is not None:
        grid_z = np.zeros((nx, ny), dtype=np.float64)
        ix_arr = np.clip(((xs - x_min_f) / fw * nx).astype(np.int32), 0, nx - 1)
        iy_arr = np.clip(((ys - y_min_f) / fh * ny).astype(np.int32), 0, ny - 1)
        np.maximum.at(grid_z, (ix_arr, iy_arr), zs)

        x_edges = np.linspace(x_min_f, x_max_f, nx + 1)
        y_edges = np.linspace(y_min_f, y_max_f, ny + 1)
        empty_mask = grid_z < 0.00025

        sx_strip = max(2, int(round(nx * 0.28)))
        sy_strip = max(2, int(round(ny * 0.28)))
        water_scores = {
            "-X": float(empty_mask[:sx_strip, :].mean()) * 0.65 + max(0.0, (min_x - x_min_f) / fw) * 1.4,
            "+X": float(empty_mask[nx - sx_strip :, :].mean()) * 0.65 + max(0.0, (x_max_f - max_x) / fw) * 1.4,
            "-Y": float(empty_mask[:, :sy_strip].mean()) * 0.65 + max(0.0, (min_y - y_min_f) / fh) * 1.4,
            "+Y": float(empty_mask[:, ny - sy_strip :].mean()) * 0.65 + max(0.0, (y_max_f - max_y) / fh) * 1.4,
        }
        best_water_edge = max(water_scores, key=lambda k: water_scores[k])
        water_side: Optional[str] = best_water_edge if water_scores[best_water_edge] >= 0.08 else None

        if np.any(empty_mask):
            e_ix, e_iy = np.where(empty_mask)
            wx = float((0.5 * (x_edges[e_ix] + x_edges[e_ix + 1])).mean())
            wy = float((0.5 * (y_edges[e_iy] + y_edges[e_iy + 1])).mean())
        else:
            wx, wy = -0.35 * fw, -0.25 * fh

        canyon_portal = _find_canyon_portal(
            grid_z, x_edges, y_edges, (hx, hy, hz), (cx, cy, cz), water_side, fw, fh, max_z
        )
    else:  # pragma: no cover
        water_scores = {"-X": 0.0, "+X": 0.0, "-Y": 0.0, "+Y": 0.0}
        water_side = None
        wx, wy = -0.35 * fw, -0.25 * fh
        canyon_portal = {
            "entry": [round(hx, 5), round(hy - 0.35 * fh, 5), round(max(0.25 * max_z, 0.008), 5)],
            "portal_mid": [round(hx, 5), round(hy - 0.15 * fh, 5), round(max(0.2 * max_z, 0.006), 5)],
            "target": [round(hx, 5), round(hy, 5), round(0.45 * max_z, 5)],
            "tower_a": [round(hx, 5), round(hy, 5), round(hz, 5)],
            "tower_b": [round(cx, 5), round(cy, 5), round(cz, 5)],
            "direction": [0.0, 1.0],
            "score": 0.0,
        }

    if water_side == "-X":
        recommended_yaw_deg = -26.0
    elif water_side == "+X":
        recommended_yaw_deg = 26.0
    else:
        recommended_yaw_deg = -24.0 if (cx - hx) >= 0.0 else 24.0

    return {
        "bbox_min": [round(min_x, 5), round(min_y, 5), round(min_z, 5)],
        "bbox_max": [round(max_x, 5), round(max_y, 5), round(max_z, 5)],
        "size": [round(size_x, 5), round(size_y, 5), round(size_z, 5)],
        "frame_width_m": round(fw, 5),
        "frame_height_m": round(fh, 5),
        "max_z": round(max_z, 5),
        "hero_peak": [round(hx, 5), round(hy, 5), round(hz, 5)],
        "hero_tower_xy": [round(tx, 5), round(ty, 5)],
        "skyline_centroid": [round(cx, 5), round(cy, 5), round(cz, 5)],
        "water_side": water_side,
        "water_scores": {k: round(v, 4) for k, v in water_scores.items()},
        "water_centroid": [round(wx, 5), round(wy, 5), 0.0],
        "canyon_portal": canyon_portal,
        "recommended_yaw_deg": recommended_yaw_deg,
        "vertex_count": n_verts,
    }


def _rot_x_pos90(pt: List[float], offset_y: float) -> List[float]:
    """Map local flat (x, y, z) -> wall-mounted world (x, -z + offset_y, +y)."""
    return [round(pt[0], 5), round(-pt[2] + offset_y, 5), round(pt[1], 5)]


def transform_analysis_to_wall_mount(
    analysis: Dict[str, Any],
    assembly_offset_y: float = 0.0,
) -> Dict[str, Any]:
    """Transform local flat landmark analysis into upright +90 deg X wall-mount world space.

    Under R_x(+90 deg):
    - Local +X (east) -> World +X (right along wall)
    - Local +Y (north/top) -> World +Z (up along wall)
    - Local +Z (building height) -> World -Y (protruding outward toward camera)
    """
    out = dict(analysis)
    out["mount"] = "wall_mount"
    out["hero_peak_local"] = list(analysis["hero_peak"])
    out["hero_peak"] = _rot_x_pos90(analysis["hero_peak"], assembly_offset_y)
    htx, hty = analysis.get("hero_tower_xy", [analysis["hero_peak"][0], analysis["hero_peak"][1]])
    out["hero_tower_xz"] = [round(htx, 5), round(hty, 5)]
    out["skyline_centroid"] = _rot_x_pos90(analysis["skyline_centroid"], assembly_offset_y)
    out["water_centroid"] = _rot_x_pos90(analysis["water_centroid"], assembly_offset_y)

    bmin = analysis["bbox_min"]
    bmax = analysis["bbox_max"]
    out["bbox_min"] = [round(bmin[0], 5), round(-bmax[2] + assembly_offset_y, 5), round(bmin[1], 5)]
    out["bbox_max"] = [round(bmax[0], 5), round(-bmin[2] + assembly_offset_y, 5), round(bmax[1], 5)]

    portal = dict(analysis.get("canyon_portal", {}))
    for key in ("entry", "portal_mid", "target", "tower_a", "tower_b"):
        if key in portal and len(portal[key]) == 3:
            portal[key] = _rot_x_pos90(portal[key], assembly_offset_y)
    out["canyon_portal"] = portal
    return out

