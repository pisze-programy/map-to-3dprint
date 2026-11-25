#!/usr/bin/env python3
"""
Uncheatable Whole-Project MSLA Assembly Validator (VAL-01 through VAL-14).

Reads assembly_manifest.json, verifies every tile SHA-256, un-rotates rotated
plate tiles back into assembly coordinates, runs VAL-01..08 per tile, verifies
100% seam cross-section continuity (VAL-09), global geometry & 4-way corners
(VAL-10), volume conservation (VAL-11), zero crumbs (VAL-12), DFM-06 bottom
chamfer & Z=0 relief balance (VAL-13), and Mono 4 safe bed margin (VAL-14).
Writes validation_report.json, _qa/seam_<A>_<B>_diff.png, and stamps manifest.
"""

import argparse
import datetime
import hashlib
import json
import math
import os
import struct
import sys
import zlib
from typing import Any, Dict, List, Optional, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import validate_msla_stl as vmsla  # noqa: E402

Vec3 = Tuple[float, float, float]
Triangle = Tuple[Vec3, Vec3, Vec3, Vec3]


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def write_rgb_png(path: str, width: int, height: int, rgb_rows: List[bytes]) -> None:
    """Minimal pure-Python RGB PNG writer (zero third-party deps)."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    raw = bytearray()
    for row in rgb_rows:
        raw.append(0)
        raw.extend(row)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png_bytes = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), level=6))
        + chunk(b"IEND", b"")
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png_bytes)


def unrotate_and_place_tris(
    raw_tris: List[Triangle],
    nominal_rect: Dict[str, float],
    stl_rotation_deg: int,
) -> List[Triangle]:
    """Transforms tile STL vertices into continuous assembly coordinates (mm)."""
    x_min = float(nominal_rect["x_min"])
    y_min = float(nominal_rect["y_min"])
    h_mm = float(nominal_rect["y_max"]) - y_min
    rot90 = (int(stl_rotation_deg) % 360) == 90

    out: List[Triangle] = []
    for p0, p1, p2, n in raw_tris:
        pts_out: List[Vec3] = []
        for p in (p0, p1, p2):
            if rot90:
                lx = p[1]
                ly = h_mm - p[0]
            else:
                lx = p[0]
                ly = p[1]
            pts_out.append((lx + x_min, ly + y_min, p[2]))
        if rot90:
            n_out: Vec3 = (n[1], -n[0], n[2])
        else:
            n_out = n
        out.append((pts_out[0], pts_out[1], pts_out[2], n_out))
    return out


def slice_plane_segments(
    tris: List[Triangle],
    axis: str,
    plane_coord: float,
) -> List[Tuple[float, float, float, float]]:
    """
    Intersects mesh triangles with plane (axis='x' -> X=plane_coord, 'y' -> Y=plane_coord).
    Returns segments [(u0, z0, u1, z1), ...] where u is the orthogonal XY axis.
    """
    a_idx = 0 if axis == "x" else 1
    u_idx = 1 if axis == "x" else 0
    segs: List[Tuple[float, float, float, float]] = []
    eps = 1e-7

    for p0, p1, p2, _ in tris:
        d0 = p0[a_idx] - plane_coord
        d1 = p1[a_idx] - plane_coord
        d2 = p2[a_idx] - plane_coord
        # Strictly straddling or grazing from one side: avoid double-counting coplanar faces
        if (d0 >= 0 and d1 >= 0 and d2 >= 0) or (d0 <= 0 and d1 <= 0 and d2 <= 0):
            continue
        pts: List[Tuple[float, float]] = []
        for pa, da, pb, db in ((p0, d0, p1, d1), (p1, d1, p2, d2), (p2, d2, p0, d0)):
            if (da <= 0 < db) or (db <= 0 < da):
                t = -da / (db - da)
                u_val = pa[u_idx] + t * (pb[u_idx] - pa[u_idx])
                z_val = pa[2] + t * (pb[2] - pa[2])
                pts.append((u_val, z_val))
        if len(pts) == 2 and (abs(pts[0][0] - pts[1][0]) > eps or abs(pts[0][1] - pts[1][1]) > eps):
            segs.append((pts[0][0], pts[0][1], pts[1][0], pts[1][1]))
    return segs


def _scanline_intervals_at_z(
    segs: List[Tuple[float, float, float, float]],
    z_val: float,
) -> List[Tuple[float, float]]:
    xs: List[float] = []
    for u0, z0, u1, z1 in segs:
        if (z0 <= z_val < z1) or (z1 <= z_val < z0):
            t = (z_val - z0) / (z1 - z0)
            xs.append(u0 + t * (u1 - u0))
    xs.sort()
    intervals: List[Tuple[float, float]] = []
    for i in range(0, len(xs) - 1, 2):
        if xs[i + 1] - xs[i] > 1e-5:
            intervals.append((xs[i], xs[i + 1]))
    return intervals


def _merge_intervals(intervals: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    if not intervals:
        return []
    iv = sorted(intervals)
    out = [iv[0]]
    for s, e in iv[1:]:
        if s <= out[-1][1] + 1e-6:
            out[-1] = (out[-1][0], max(out[-1][1], e))
        else:
            out.append((s, e))
    return out


def _interval_length(intervals: List[Tuple[float, float]]) -> float:
    return sum(e - s for s, e in intervals)


def _interval_xor_and_max_step(
    iv_a: List[Tuple[float, float]],
    iv_b: List[Tuple[float, float]],
) -> Tuple[float, float]:
    """Computes symmetric difference length and max unmatched edge overhang along 1D line."""
    events: List[Tuple[float, int, int]] = []
    for s, e in iv_a:
        events.append((s, 0, 1))
        events.append((e, 0, -1))
    for s, e in iv_b:
        events.append((s, 1, 1))
        events.append((e, 1, -1))
    if not events:
        return 0.0, 0.0
    events.sort()
    in_a = 0
    in_b = 0
    prev_x = events[0][0]
    xor_len = 0.0
    max_step = 0.0
    xor_run = 0.0
    idx = 0
    n = len(events)
    while idx < n:
        x = events[idx][0]
        dx = x - prev_x
        if dx > 1e-7:
            a_on = in_a > 0
            b_on = in_b > 0
            if a_on != b_on:
                xor_len += dx
                xor_run += dx
                if xor_run > max_step:
                    max_step = xor_run
            else:
                xor_run = 0.0
        while idx < n and abs(events[idx][0] - x) <= 1e-8:
            _, who, delta = events[idx]
            if who == 0:
                in_a += delta
            else:
                in_b += delta
            idx += 1
        prev_x = x
    return xor_len, max_step


def _extract_cap_segments(
    tris: List[Triangle],
    axis: str,
    seam_coord: float,
    out_sign: float,
) -> Tuple[List[Tuple[float, float, float, float]], float]:
    """
    Extracts exact edges from cut-cap triangles lying on the mating seam plane
    (normal aligned with seam outward normal, centroid within 0.008 mm of seam).
    Returns (segments_2d_u_z, max_flatness_dev_mm).
    """
    a_idx = 0 if axis == "x" else 1
    u_idx = 1 if axis == "x" else 0
    segs: List[Tuple[float, float, float, float]] = []
    max_flatness_dev = 0.0
    eps = 1e-7

    for p0, p1, p2, n in tris:
        if n[a_idx] * out_sign <= 0.9998:
            continue
        centroid_a = (p0[a_idx] + p1[a_idx] + p2[a_idx]) / 3.0
        if abs(centroid_a - seam_coord) >= 0.0025:
            continue
        for p in (p0, p1, p2):
            if p[2] >= 0.50:
                d = abs(p[a_idx] - seam_coord)
                if d > max_flatness_dev:
                    max_flatness_dev = d
        for pa, pb in ((p0, p1), (p1, p2), (p2, p0)):
            u0, z0 = pa[u_idx], pa[2]
            u1, z1 = pb[u_idx], pb[2]
            if abs(u1 - u0) > eps or abs(z1 - z0) > eps:
                segs.append((u0, z0, u1, z1))
    return segs, max_flatness_dev


def audit_seam_pair(
    tile_a: Dict[str, Any],
    tile_b: Dict[str, Any],
    tris_a: List[Triangle],
    tris_b: List[Triangle],
    axis: str,
    seam_coord: float,
    a_is_low_side: bool,
    qa_dir: str,
) -> Dict[str, Any]:
    """
    Runs VAL-09 cross-section continuity & cut-plane flatness for two mating tiles.
    Verifies exact mating cut-cap cross-sections (plus non-zero gap/kerf check) and
    falls back to inward cross-section plane intersection (seam +/- 0.010 mm) if needed.
    """
    a_idx = 0 if axis == "x" else 1
    out_sign_a = 1.0 if a_is_low_side else -1.0
    out_sign_b = -out_sign_a

    # 1. Extract exact cut-cap faces and cut-plane flatness (Z >= 0.50 mm, <= 0.005 mm)
    cap_segs_a, flat_a = _extract_cap_segments(tris_a, axis, seam_coord, out_sign_a)
    cap_segs_b, flat_b = _extract_cap_segments(tris_b, axis, seam_coord, out_sign_b)
    max_flatness_dev = max(flat_a, flat_b)

    # Check if tiles actually reach seam_coord at Z >= 0.50 mm (rejects recessed kerf gaps!)
    max_edge_a = max((p[a_idx] for t in tris_a for p in t[:3] if p[2] >= 0.50), default=seam_coord) if a_is_low_side else min((p[a_idx] for t in tris_a for p in t[:3] if p[2] >= 0.50), default=seam_coord)
    min_edge_b = min((p[a_idx] for t in tris_b for p in t[:3] if p[2] >= 0.50), default=seam_coord) if a_is_low_side else max((p[a_idx] for t in tris_b for p in t[:3] if p[2] >= 0.50), default=seam_coord)
    edge_recess_gap = abs(max_edge_a - seam_coord) + abs(min_edge_b - seam_coord)

    # Use exact cut-cap polygons when present; fallback to inward slice (+/- 0.010 mm)
    if cap_segs_a or cap_segs_b:
        segs_a, segs_b = cap_segs_a, cap_segs_b
    else:
        inward = 0.010
        plane_a = seam_coord - inward if a_is_low_side else seam_coord + inward
        plane_b = seam_coord + inward if a_is_low_side else seam_coord - inward
        segs_a = slice_plane_segments(tris_a, axis, plane_a)
        segs_b = slice_plane_segments(tris_b, axis, plane_b)

    all_z = [z for s in segs_a for z in (s[1], s[3])] + [z for s in segs_b for z in (s[1], s[3])]
    all_u = [u for s in segs_a for u in (s[0], s[2])] + [u for s in segs_b for u in (s[0], s[2])]

    if not all_z or not all_u:
        return {
            "pair": [tile_a["tile_id"], tile_b["tile_id"]],
            "axis": axis,
            "seam_coord_mm": round(seam_coord, 4),
            "area_a_mm2": 0.0,
            "area_b_mm2": 0.0,
            "area_delta_mm2": 0.0,
            "true_diff_mm2": 0.0,
            "max_step_mm": round(edge_recess_gap, 4),
            "max_flatness_dev_mm": round(max_flatness_dev, 5),
            "passed": max_flatness_dev <= 0.005 and edge_recess_gap <= 0.03,
        }

    z_min = max(0.0, min(all_z))
    z_max = max(all_z)
    u_min = min(all_u)
    u_max = max(all_u)
    dz = 0.05

    area_a = 0.0
    area_b = 0.0
    true_diff = 0.0
    max_step = edge_recess_gap if edge_recess_gap > 0.03 else 0.0

    z = z_min + 0.02513
    z_rows: List[Tuple[float, List[Tuple[float, float]], List[Tuple[float, float]]]] = []
    while z <= z_max:
        iv_a = _merge_intervals(_scanline_intervals_at_z(segs_a, z))
        iv_b = _merge_intervals(_scanline_intervals_at_z(segs_b, z))
        area_a += _interval_length(iv_a) * dz
        area_b += _interval_length(iv_b) * dz
        xor_len, step_len = _interval_xor_and_max_step(iv_a, iv_b)
        true_diff += xor_len * dz
        if step_len > max_step:
            max_step = step_len
        z_rows.append((z, iv_a, iv_b))
        z += dz

    # Also measure vertical Z-step mismatch along u columns (step = 0.10 mm),
    # checking closest Z within +-1 adjacent column (0.10 mm) to avoid cliff-quantization spikes.
    u_span = max(1e-3, u_max - u_min)
    du_col = 0.10
    n_cols = min(2400, max(10, int(math.ceil(u_span / du_col))))
    max_z_a = [-1.0] * n_cols
    max_z_b = [-1.0] * n_cols
    for z_val, iv_a, iv_b in z_rows:
        for s, e in iv_a:
            c0 = max(0, int((s - u_min) / du_col))
            c1 = min(n_cols - 1, int((e - u_min) / du_col))
            for c in range(c0, c1 + 1):
                if z_val > max_z_a[c]:
                    max_z_a[c] = z_val
        for s, e in iv_b:
            c0 = max(0, int((s - u_min) / du_col))
            c1 = min(n_cols - 1, int((e - u_min) / du_col))
            for c in range(c0, c1 + 1):
                if z_val > max_z_b[c]:
                    max_z_b[c] = z_val
    for c in range(n_cols):
        za = max_z_a[c]
        zb = max_z_b[c]
        if za >= 0 and zb >= 0:
            near_b = [max_z_b[nb] for nb in range(max(0, c - 1), min(n_cols, c + 2)) if max_z_b[nb] >= 0]
            dz_col = min((abs(za - v) for v in near_b), default=abs(za - zb))
            if dz_col > max_step:
                max_step = dz_col
        elif za >= 0 and max((max_z_b[nb] for nb in range(max(0, c - 1), min(n_cols, c + 2))), default=-1.0) < 0:
            if za > max_step:
                max_step = za
        elif zb >= 0 and max((max_z_a[nb] for nb in range(max(0, c - 1), min(n_cols, c + 2))), default=-1.0) < 0:
            if zb > max_step:
                max_step = zb

    # Render visual cross-section diff proof PNG
    img_w = min(1400, max(320, int(math.ceil(u_span / 0.10))))
    img_h = min(600, max(160, len(z_rows) * 2))
    du_px = u_span / img_w
    rows_rgb: List[bytes] = []
    n_zr = max(1, len(z_rows))
    for py in range(img_h):
        # Top of PNG = z_max, bottom = z_min
        zr_idx = min(n_zr - 1, max(0, int((1.0 - (py + 0.5) / img_h) * n_zr)))
        _, iv_a, iv_b = z_rows[zr_idx]
        row_buf = bytearray(img_w * 3)
        # Background light slate
        for px in range(img_w):
            row_buf[px * 3] = 24
            row_buf[px * 3 + 1] = 28
            row_buf[px * 3 + 2] = 36
        # Paint A (cool cyan-blue)
        a_mask = bytearray(img_w)
        for s, e in iv_a:
            x0 = max(0, int((s - u_min) / du_px))
            x1 = min(img_w - 1, int((e - u_min) / du_px))
            for px in range(x0, x1 + 1):
                a_mask[px] = 1
        b_mask = bytearray(img_w)
        for s, e in iv_b:
            x0 = max(0, int((s - u_min) / du_px))
            x1 = min(img_w - 1, int((e - u_min) / du_px))
            for px in range(x0, x1 + 1):
                b_mask[px] = 1
        for px in range(img_w):
            in_a = a_mask[px] == 1
            in_b = b_mask[px] == 1
            if in_a and in_b:
                # Perfect match = crisp warm white
                row_buf[px * 3] = 235
                row_buf[px * 3 + 1] = 238
                row_buf[px * 3 + 2] = 242
            elif in_a != in_b:
                # Mismatch = bright alarm red!
                row_buf[px * 3] = 245
                row_buf[px * 3 + 1] = 45
                row_buf[px * 3 + 2] = 45
        rows_rgb.append(bytes(row_buf))

    diff_png = os.path.join(qa_dir, f"seam_{tile_a['tile_id']}_{tile_b['tile_id']}_diff.png")
    write_rgb_png(diff_png, img_w, img_h, rows_rgb)

    passed = (
        true_diff <= 0.15
        and max_step <= 0.20
        and abs(area_a - area_b) <= 0.25
        and max_flatness_dev <= 0.005
    )
    return {
        "pair": [tile_a["tile_id"], tile_b["tile_id"]],
        "axis": axis,
        "seam_coord_mm": round(seam_coord, 4),
        "area_a_mm2": round(area_a, 3),
        "area_b_mm2": round(area_b, 3),
        "area_delta_mm2": round(abs(area_a - area_b), 3),
        "true_diff_mm2": round(true_diff, 4),
        "max_step_mm": round(max_step, 4),
        "max_flatness_dev_mm": round(max_flatness_dev, 5),
        "diff_png": os.path.relpath(diff_png, os.path.dirname(qa_dir)),
        "passed": passed,
    }


def _scan_z_level_bounds(tris: List[Triangle], z_level: float) -> Optional[Tuple[float, float, float, float]]:
    """Returns (xmin, xmax, ymin, ymax) of cross-section at z_level."""
    xmin, xmax = float("inf"), float("-inf")
    ymin, ymax = float("inf"), float("-inf")
    found = False
    for p0, p1, p2, _ in tris:
        z0, z1, z2 = p0[2], p1[2], p2[2]
        if not (min(z0, z1, z2) <= z_level <= max(z0, z1, z2)):
            continue
        for pa, pb in ((p0, p1), (p1, p2), (p2, p0)):
            if (pa[2] <= z_level <= pb[2]) or (pb[2] <= z_level <= pa[2]):
                dz = pb[2] - pa[2]
                t = 0.0 if abs(dz) < 1e-9 else (z_level - pa[2]) / dz
                x = pa[0] + t * (pb[0] - pa[0])
                y = pa[1] + t * (pb[1] - pa[1])
                if x < xmin: xmin = x
                if x > xmax: xmax = x
                if y < ymin: ymin = y
                if y > ymax: ymax = y
                found = True
    return (xmin, xmax, ymin, ymax) if found else None


def _subtract_intervals(
    base_ivs: List[Tuple[float, float]],
    sub_ivs: List[Tuple[float, float]],
) -> List[Tuple[float, float]]:
    """Returns intervals in base_ivs not covered by sub_ivs."""
    if not base_ivs:
        return []
    if not sub_ivs:
        return list(base_ivs)
    out: List[Tuple[float, float]] = []
    for bs, be in base_ivs:
        cur = bs
        for ss, se in sub_ivs:
            if se <= cur:
                continue
            if ss >= be:
                break
            if ss > cur:
                out.append((cur, min(be, ss)))
            cur = max(cur, se)
            if cur >= be:
                break
        if cur < be - 1e-6:
            out.append((cur, be))
    return out


def _audit_seam_dfm01_slivers(
    tris_a: List[Triangle],
    tris_b: List[Triangle],
    axis: str,
    seam_coord: float,
    a_is_low_side: bool,
    tile_a_id: str,
    tile_b_id: str,
) -> List[str]:
    """
    DFM-01 seam sliver guard: fails grounded < 0.40 mm facade slivers along a cut plane
    that persist vertically for >= 0.75 mm (3 consecutive 0.25 mm Z slices).
    """
    sliver_failures: List[str] = []
    sides = (
        (tile_a_id, tris_a, -1.0 if a_is_low_side else 1.0),
        (tile_b_id, tris_b, 1.0 if a_is_low_side else -1.0),
    )
    for side_id, tris_s, inward_sign in sides:
        s_near = slice_plane_segments(tris_s, axis, seam_coord + inward_sign * 0.02)
        if not s_near:
            continue
        s_deep = slice_plane_segments(tris_s, axis, seam_coord + inward_sign * 0.40)
        z_max = max((max(seg[1], seg[3]) for seg in s_near), default=0.0)
        if z_max < 1.30:
            continue

        # Track runs above the Z=0..1.50 mm underside-relief zone: (u0, u1, run_len, z_start)
        prev_runs: List[Tuple[float, float, int, float]] = []
        reported = False
        z = 1.65
        while z <= z_max and not reported:
            iv_n = _merge_intervals(_scanline_intervals_at_z(s_near, z))
            iv_d = _merge_intervals(_scanline_intervals_at_z(s_deep, z))
            dilated_d = _merge_intervals([(s - 1.50, e + 1.50) for s, e in iv_d])
            strict_d = _merge_intervals([(s - 0.15, e + 0.15) for s, e in iv_d])

            unbacked: List[Tuple[float, float]] = []
            for u0, u1 in _subtract_intervals(iv_n, dilated_d):
                if u1 - u0 >= 2.50:
                    unbacked.append((u0, u1))
            for u0, u1 in iv_n:
                if u1 - u0 >= 2.50 and not any(min(u1, v1) - max(u0, v0) > 0.0 for v0, v1 in strict_d):
                    unbacked.append((u0, u1))
            unbacked = _merge_intervals(unbacked)

            cur_runs: List[Tuple[float, float, int, float]] = []
            for u0, u1 in unbacked:
                best_len = 1
                best_z0 = z
                for pu0, pu1, prun, pz0 in prev_runs:
                    if min(u1, pu1) - max(u0, pu0) > 1.50 and prun + 1 > best_len:
                        best_len = prun + 1
                        best_z0 = pz0
                cur_runs.append((u0, u1, best_len, best_z0))
                if best_len >= 6:
                    # Verify groundedness below z_start
                    z_chk = max(0.30, best_z0 - 0.30)
                    iv_below_n = _merge_intervals(_scanline_intervals_at_z(s_near, z_chk))
                    iv_below_d = _merge_intervals(_scanline_intervals_at_z(s_deep, z_chk))
                    grounded = any(
                        min(u1 + 0.20, v1) - max(u0 - 0.20, v0) > 0.0
                        for v0, v1 in (iv_below_n + iv_below_d)
                    )
                    if grounded:
                        sliver_failures.append(
                            f"DFM-01: Tile {side_id} has grounded <0.40 mm facade sliver along "
                            f"{axis}={seam_coord:.3f} mm at u=[{u0:.2f}..{u1:.2f}] mm, "
                            f"Z=[{best_z0:.2f}..{z:.2f}] mm."
                        )
                        reported = True
                        break
            prev_runs = cur_runs
            z += 0.25
    return sliver_failures


def _sample_seam_z_bins(
    tris: List[Triangle],
    axis: str,
    seam_coord: float,
    is_low_side: bool,
    z_level: float,
    max_dist: float = 0.80,
) -> Dict[int, float]:
    """Returns {u_bin_1mm: min_inset_mm} for edges at Z=z_level near seam_coord."""
    a_idx = 0 if axis == "x" else 1
    u_idx = 1 if axis == "x" else 0
    bin_min: Dict[int, float] = {}
    for p0, p1, p2, _ in tris:
        z0, z1, z2 = p0[2], p1[2], p2[2]
        if not (min(z0, z1, z2) <= z_level < max(z0, z1, z2)):
            continue
        pts: List[Tuple[float, float]] = []
        for pa, pb in ((p0, p1), (p1, p2), (p2, p0)):
            if (pa[2] <= z_level < pb[2]) or (pb[2] <= z_level < pa[2]):
                tt = (z_level - pa[2]) / (pb[2] - pa[2])
                av = pa[a_idx] + tt * (pb[a_idx] - pa[a_idx])
                uv = pa[u_idx] + tt * (pb[u_idx] - pa[u_idx])
                pts.append((av, uv))
        if len(pts) != 2:
            continue
        ins0 = (seam_coord - pts[0][0]) if is_low_side else (pts[0][0] - seam_coord)
        ins1 = (seam_coord - pts[1][0]) if is_low_side else (pts[1][0] - seam_coord)
        if max(ins0, ins1) < -0.05 or min(ins0, ins1) > max_dist:
            continue
        u0, u1 = pts[0][1], pts[1][1]
        if u1 < u0:
            u0, u1 = u1, u0
            ins0, ins1 = ins1, ins0
        b0 = int(math.floor(u0 + 1e-6))
        b1 = int(math.floor(u1 - 1e-6))
        if b1 < b0:
            b1 = b0
        du = u1 - u0
        for b in range(b0, b1 + 1):
            if du <= 1e-7:
                ins_b = min(ins0, ins1)
            else:
                uc = 0.5 * (max(float(b), u0) + min(float(b + 1), u1))
                ins_b = ins0 + ((uc - u0) / du) * (ins1 - ins0)
            if -0.05 <= ins_b <= max_dist:
                if b not in bin_min or ins_b < bin_min[b]:
                    bin_min[b] = ins_b
    return bin_min


def _audit_seam_chamfer_symmetry(
    tris_a: List[Triangle],
    tris_b: List[Triangle],
    axis: str,
    seam_coord: float,
    a_is_low_side: bool,
    tile_a_id: str,
    tile_b_id: str,
) -> Optional[str]:
    """
    Verifies DFM-06 bottom chamfer inset (>= 0.18 mm) and symmetry (|d_A - d_B| <= 0.08 mm)
    at Z = 0.15 mm across solid mating seams (checked at Z = 0.60 mm).
    """
    bins_mating_a = _sample_seam_z_bins(tris_a, axis, seam_coord, a_is_low_side, 0.60, max_dist=0.06)
    bins_mating_b = _sample_seam_z_bins(tris_b, axis, seam_coord, not a_is_low_side, 0.60, max_dist=0.06)
    shared_mating_bins = set(bins_mating_a.keys()) & set(bins_mating_b.keys())
    if not shared_mating_bins:
        return None

    min_bin_a = _sample_seam_z_bins(tris_a, axis, seam_coord, a_is_low_side, 0.15, max_dist=0.60)
    min_bin_b = _sample_seam_z_bins(tris_b, axis, seam_coord, not a_is_low_side, 0.15, max_dist=0.60)
    paired_bins = sorted(shared_mating_bins & set(min_bin_a.keys()) & set(min_bin_b.keys()))
    if not paired_bins:
        return (
            f"DFM-06: Seam {tile_a_id}<->{tile_b_id} ({axis}={seam_coord:.3f} mm) missing chamfered "
            f"Z=0.15 mm edges across solid mating bins."
        )

    min_a = min(min_bin_a[b] for b in paired_bins)
    min_b = min(min_bin_b[b] for b in paired_bins)
    max_asym = max(abs(min_bin_a[b] - min_bin_b[b]) for b in paired_bins)
    if min_a < 0.18 or min_b < 0.18 or max_asym > 0.08:
        return (
            f"DFM-06: Seam {tile_a_id}<->{tile_b_id} ({axis}={seam_coord:.3f} mm) asymmetric or missing "
            f"Z=0.15 mm chamfer (min_A={min_a:.3f} mm, min_B={min_b:.3f} mm, max_asym={max_asym:.3f} mm)."
        )
    return None


def validate_assembly(
    manifest_path: str,
    qa_dir: Optional[str] = None,
    stamp_manifest: bool = True,
    quiet: bool = False,
) -> Dict[str, Any]:
    manifest_abs = os.path.abspath(manifest_path)
    base_dir = os.path.dirname(manifest_abs)
    out_qa_dir = os.path.abspath(qa_dir) if qa_dir else os.path.join(base_dir, "_qa")
    os.makedirs(out_qa_dir, exist_ok=True)

    with open(manifest_abs, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    def log(msg: str) -> None:
        if not quiet:
            print(msg)

    failures: List[str] = []
    warnings: List[str] = []
    tile_entries = manifest.get("tiles", [])
    src_params = manifest.get("source_params", {})
    inter_frame_gap = float(src_params.get("inter_frame_gap_mm", 0.0))
    water_cutout = bool(src_params.get("water_cutout", False))
    solid_base = bool(src_params.get("solid_base_no_tunnels", False))
    chamfer_inset_cfg = float(src_params.get("dfm06_chamfer_inset_mm", 0.0))
    relief_enabled = bool(src_params.get("underside_relief_enabled", False))
    safe_margin_mm = float(src_params.get("bed_safe_margin_mm", 4.0))
    safe_bed_x = 153.45 - 2.0 * safe_margin_mm
    safe_bed_y = 87.05 - 2.0 * safe_margin_mm
    safe_bed_z = 163.0

    grid_raw = src_params.get("grid")
    if isinstance(grid_raw, list) and len(grid_raw) == 2:
        tile_cols = max(1, int(grid_raw[0]))
        tile_rows = max(1, int(grid_raw[1]))
    else:
        tile_cols = max((int(t.get("col", 0)) for t in tile_entries), default=0) + 1
        tile_rows = max((int(t.get("row", 0)) for t in tile_entries), default=0) + 1
        if len(tile_entries) > 1:
            failures.append("VAL-10: source_params.grid missing or invalid on multi-tile assembly.")

    is_multi_tile = (tile_cols * tile_rows > 1) or (len(tile_entries) > 1)
    fmt_id_l = str(manifest.get("format_id") or "").lower()
    sku_id_l = str(manifest.get("sku_id") or "").lower()
    is_a4_sku = ("a4" in fmt_id_l) or ("a4" in sku_id_l)
    require_dfm06_chamfer = solid_base or is_a4_sku or is_multi_tile
    require_underside_relief = solid_base or is_a4_sku

    if require_dfm06_chamfer and chamfer_inset_cfg < 0.20:
        failures.append(
            f"VAL-13: Tampered or missing dfm06_chamfer_inset_mm={chamfer_inset_cfg:.3f} mm "
            f"(< 0.20 mm required for solid_base_no_tunnels / A4 / multi-tile SKU)."
        )
    if require_underside_relief and not relief_enabled:
        failures.append(
            f"VAL-13: underside_relief_enabled=False is forbidden on solid_base_no_tunnels or A4 catalog SKU "
            f"({manifest.get('format_id')})."
        )
    if is_multi_tile and len(tile_entries) != tile_cols * tile_rows:
        failures.append(
            f"VAL-10: Tile count {len(tile_entries)} does not match grid {tile_cols}x{tile_rows}."
        )

    # Load and validate every tile
    tile_reports: Dict[str, Dict[str, Any]] = {}
    placed_tris: Dict[str, List[Triangle]] = {}
    tile_by_id: Dict[str, Dict[str, Any]] = {}
    sum_tile_vol_mm3 = 0.0

    for t in tile_entries:
        tid = t["tile_id"]
        tile_by_id[tid] = t
        if t.get("skipped_empty_water"):
            continue
        rel_file = t.get("file")
        if not rel_file:
            failures.append(f"VAL-01: Tile {tid} missing STL file reference.")
            continue
        stl_path = os.path.join(base_dir, rel_file)
        if not os.path.exists(stl_path):
            failures.append(f"VAL-01: Tile {tid} STL file missing: {stl_path}")
            continue
        actual_sha = sha256_file(stl_path)
        expected_sha = t.get("sha256")
        if not expected_sha or actual_sha != expected_sha:
            failures.append(f"VAL-01: Tile {tid} SHA-256 mismatch (expected={expected_sha}, actual={actual_sha}).")

        allow_lms = t.get("allow_landmasses", []) if water_cutout else []
        if not water_cutout and t.get("allow_landmasses"):
            failures.append(f"VAL-12: Tile {tid} specifies allow_landmasses while water_cutout=False.")

        rep = vmsla.validate_stl_file(stl_path, allow_elevated=False, allow_landmasses=allow_lms, quiet=True)
        tile_reports[tid] = rep
        sum_tile_vol_mm3 += float(rep["volume_mm3"])
        if rep["verdict"] != "PASS":
            for fm in rep["failures"]:
                failures.append(f"[{tid}] {fm}")
        for wm in rep["warnings"]:
            warnings.append(f"[{tid}] {wm}")

        # VAL-14: Mono 4 safe bed margin check
        sx, sy, sz = rep["span_mm"]
        if sx > safe_bed_x + 0.05 or sy > safe_bed_y + 0.05 or sz > safe_bed_z + 0.05:
            failures.append(
                f"VAL-14: Tile {tid} span {sx:.2f}x{sy:.2f}x{sz:.2f} mm exceeds Mono 4 safe bed "
                f"{safe_bed_x:.2f}x{safe_bed_y:.2f}x{safe_bed_z:.2f} mm."
            )

        # VAL-12: Zero crumbs check (stricter explicit assembly audit)
        for sh in rep["shells"]:
            if sh["bbox"][4] > 0.04:
                failures.append(f"VAL-12: Tile {tid} shell #{sh['shell_index']} floats at minZ={sh['bbox'][4]:.3f} mm.")
            if sh["z0_area_mm2"] < 35.0 or sh["min_width_mm"] < 4.0:
                failures.append(
                    f"VAL-12: Tile {tid} shell #{sh['shell_index']} crumb "
                    f"(z0_area={sh['z0_area_mm2']:.2f} mm2, min_width={sh['min_width_mm']:.2f} mm)."
                )

        # VAL-13: DFM-06 bottom chamfer + Z=0 contact balance
        _, raw_tris, _ = vmsla.read_binary_stl(stl_path, allow_elevated=False)
        if require_dfm06_chamfer or chamfer_inset_cfg >= 0.15:
            b010 = _scan_z_level_bounds(raw_tris, 0.10)
            b070 = _scan_z_level_bounds(raw_tris, 0.70)
            if b010 and b070:
                nr_t = t["nominal_rect_mm"]
                nom_w = float(nr_t["x_max"]) - float(nr_t["x_min"])
                nom_h = float(nr_t["y_max"]) - float(nr_t["y_min"])
                rot90_t = (int(t.get("stl_rotation_deg", 0)) % 360) == 90
                stl_nom_x = nom_h if rot90_t else nom_w
                stl_nom_y = nom_w if rot90_t else nom_h
                inset_x = min(b010[0] - b070[0], b070[1] - b010[1])
                inset_y = min(b010[2] - b070[2], b070[3] - b010[3])
                # Only require chamfer inset on edges where geometry reaches the flush nominal tile perimeter at Z=0.70
                eff_insets: List[float] = []
                if abs(b070[0] - 0.0) < 0.05:
                    eff_insets.append(b010[0] - b070[0])
                if abs(b070[1] - stl_nom_x) < 0.05:
                    eff_insets.append(b070[1] - b010[1])
                if abs(b070[2] - 0.0) < 0.05:
                    eff_insets.append(b010[2] - b070[2])
                if abs(b070[3] - stl_nom_y) < 0.05:
                    eff_insets.append(b070[3] - b010[3])
                if eff_insets:
                    min_edge_inset = min(eff_insets)
                    if min_edge_inset < 0.20:
                        failures.append(
                            f"VAL-13: Tile {tid} DFM-06 bottom chamfer inset={min_edge_inset:.3f} mm (< 0.20 mm at Z=0.10 vs Z=0.70)."
                        )
                elif not water_cutout and min(inset_x, inset_y) < 0.20:
                    failures.append(
                        f"VAL-13: Tile {tid} DFM-06 bottom chamfer inset={min(inset_x, inset_y):.3f} mm (< 0.20 mm at Z=0.10 vs Z=0.70)."
                    )
        if (require_underside_relief or relief_enabled) and rep["z0_area_mm2"] > 4500.0:
            failures.append(
                f"VAL-13: Tile {tid} Z=0 contact area={rep['z0_area_mm2']:.1f} mm2 exceeds 4500.0 mm2 underside relief cap."
            )

        placed_tris[tid] = unrotate_and_place_tris(
            raw_tris, t["nominal_rect_mm"], int(t.get("stl_rotation_deg", 0))
        )

    # Mandatory multi-tile neighbor topology verification (closes empty/missing neighbors bypass)
    if is_multi_tile:
        rc_map: Dict[Tuple[int, int], str] = {}
        for t in tile_entries:
            tid = t["tile_id"]
            nb = t.get("neighbors")
            if not isinstance(nb, dict) or not any(nb.get(d) for d in ("north", "south", "east", "west")):
                failures.append(
                    f"VAL-09: Tile {tid} has missing or empty neighbors on multi-tile assembly ({tile_cols}x{tile_rows})."
                )
            tr_val = t.get("row")
            tc_val = t.get("col")
            if not isinstance(tr_val, int) or not isinstance(tc_val, int):
                failures.append(f"VAL-10: Tile {tid} missing integer row/col on multi-tile assembly.")
            elif not (0 <= tr_val < tile_rows and 0 <= tc_val < tile_cols):
                failures.append(f"VAL-10: Tile {tid} row={tr_val}, col={tc_val} out of bounds for {tile_cols}x{tile_rows}.")
            else:
                rc_map[(tr_val, tc_val)] = tid
        for (tr_val, tc_val), tid in rc_map.items():
            nb = tile_by_id[tid].get("neighbors")
            if not isinstance(nb, dict):
                continue
            expected_nb = {
                "north": rc_map.get((tr_val + 1, tc_val)),
                "south": rc_map.get((tr_val - 1, tc_val)),
                "east": rc_map.get((tr_val, tc_val + 1)),
                "west": rc_map.get((tr_val, tc_val - 1)),
            }
            for d_key, exp_oid in expected_nb.items():
                if exp_oid and nb.get(d_key) != exp_oid:
                    failures.append(
                        f"VAL-09: Tile {tid} neighbors.{d_key}={nb.get(d_key)!r} does not match expected {exp_oid!r}."
                    )

    # VAL-09: All mating seam pairs (north/south, east/west)
    seam_audits: List[Dict[str, Any]] = []
    seen_pairs = set()
    for tid, t in tile_by_id.items():
        if tid not in placed_tris:
            continue
        nb = t.get("neighbors")
        if not isinstance(nb, dict):
            continue
        rect_a = t["nominal_rect_mm"]
        for dir_key, axis, a_is_low in (
            ("north", "y", True),
            ("south", "y", False),
            ("east", "x", True),
            ("west", "x", False),
        ):
            other_id = nb.get(dir_key)
            if not other_id or other_id not in placed_tris:
                continue
            pair_key = tuple(sorted((tid, other_id))) + (axis,)
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)
            tb = tile_by_id[other_id]
            rect_b = tb["nominal_rect_mm"]
            if axis == "y":
                c_a = float(rect_a["y_max"] if a_is_low else rect_a["y_min"])
                c_b = float(rect_b["y_min"] if a_is_low else rect_b["y_max"])
            else:
                c_a = float(rect_a["x_max"] if a_is_low else rect_a["x_min"])
                c_b = float(rect_b["x_min"] if a_is_low else rect_b["x_max"])
            gap = abs(c_b - c_a)
            is_inter_frame = (
                t.get("frame_id") is not None
                and tb.get("frame_id") is not None
                and t.get("frame_id") != tb.get("frame_id")
            )
            if is_inter_frame and inter_frame_gap > 0.0:
                if abs(gap - inter_frame_gap) > 0.05:
                    failures.append(
                        f"VAL-09: Inter-frame seam {tid}<->{other_id} ({axis}) gap={gap:.4f} mm "
                        f"deviates from inter_frame_gap_mm={inter_frame_gap:.3f} mm."
                    )
                continue
            if gap > 0.05:
                failures.append(
                    f"VAL-09: Flush-mating seam {tid}<->{other_id} ({axis}) has gap={gap:.4f} mm "
                    f"(> 0.05 mm; inter_frame_gap_mm={inter_frame_gap:.3f} mm)."
                )
                continue
            seam_coord = 0.5 * (c_a + c_b)
            sa = audit_seam_pair(
                t, tb, placed_tris[tid], placed_tris[other_id],
                axis, seam_coord, a_is_low, out_qa_dir,
            )
            seam_audits.append(sa)
            if not sa["passed"]:
                failures.append(
                    f"VAL-09: Seam {sa['pair'][0]}<->{sa['pair'][1]} ({axis}={sa['seam_coord_mm']}mm) FAILED: "
                    f"true_diff={sa['true_diff_mm2']:.4f}mm2 (<=0.15), max_step={sa['max_step_mm']:.4f}mm (<=0.20), "
                    f"area_delta={sa['area_delta_mm2']:.4f}mm2 (<=0.25), flatness={sa['max_flatness_dev_mm']:.5f}mm (<=0.005)."
                )
            sliver_errs = _audit_seam_dfm01_slivers(
                placed_tris[tid], placed_tris[other_id], axis, seam_coord, a_is_low, tid, other_id
            )
            failures.extend(sliver_errs)
            if require_dfm06_chamfer or chamfer_inset_cfg >= 0.15:
                cham_err = _audit_seam_chamfer_symmetry(
                    placed_tris[tid], placed_tris[other_id], axis, seam_coord, a_is_low, tid, other_id
                )
                if cham_err:
                    failures.append(cham_err)

    # VAL-10: Global footprint, zero overlap, uniform Z_base, 4-way + corners, multi-frame datum
    g_xmin, g_xmax = float("inf"), float("-inf")
    g_ymin, g_ymax = float("inf"), float("-inf")
    z_bases: List[float] = []
    placed_bboxes: Dict[str, Tuple[float, float, float, float]] = {}
    for tid, tris in placed_tris.items():
        xs = [p[0] for tr in tris for p in tr[:3]]
        ys = [p[1] for tr in tris for p in tr[:3]]
        zs = [p[2] for tr in tris for p in tr[:3]]
        if xs and ys and zs:
            tx0, tx1, ty0, ty1 = min(xs), max(xs), min(ys), max(ys)
            placed_bboxes[tid] = (tx0, tx1, ty0, ty1)
            g_xmin = min(g_xmin, tx0)
            g_xmax = max(g_xmax, tx1)
            g_ymin = min(g_ymin, ty0)
            g_ymax = max(g_ymax, ty1)
            z_bases.append(min(zs))
            nr = tile_by_id[tid]["nominal_rect_mm"]
            if (
                tx0 < float(nr["x_min"]) - 0.05
                or tx1 > float(nr["x_max"]) + 0.05
                or ty0 < float(nr["y_min"]) - 0.05
                or ty1 > float(nr["y_max"]) + 0.05
            ):
                failures.append(
                    f"VAL-10: Tile {tid} placed XY bbox [{tx0:.2f}..{tx1:.2f}, {ty0:.2f}..{ty1:.2f}] "
                    f"protrudes beyond nominal_rect_mm [{nr['x_min']:.2f}..{nr['x_max']:.2f}, "
                    f"{nr['y_min']:.2f}..{nr['y_max']:.2f}] (>0.05 mm)."
                )

    # Pairwise zero-overlap audit across all active tiles
    active_ids = list(placed_tris.keys())
    for i in range(len(active_ids)):
        ta = tile_by_id[active_ids[i]]["nominal_rect_mm"]
        for j in range(i + 1, len(active_ids)):
            tb = tile_by_id[active_ids[j]]["nominal_rect_mm"]
            ov_x = min(float(ta["x_max"]), float(tb["x_max"])) - max(float(ta["x_min"]), float(tb["x_min"]))
            ov_y = min(float(ta["y_max"]), float(tb["y_max"])) - max(float(ta["y_min"]), float(tb["y_min"]))
            if ov_x > 0.02 and ov_y > 0.02:
                failures.append(
                    f"VAL-10: Tiles {active_ids[i]} and {active_ids[j]} overlap in XY by {ov_x:.3f}x{ov_y:.3f} mm."
                )

    if z_bases and (max(z_bases) - min(z_bases) > 0.05 or max(abs(z) for z in z_bases) > 0.02):
        failures.append(f"VAL-10: Non-uniform Z_base across tiles: {[round(z, 4) for z in z_bases]}.")

    win_mm = src_params.get("window_mm")
    frames = manifest.get("frames", [])
    n_fc = max((int(f.get("frame_col", 0)) for f in frames), default=0) + 1
    n_fr = max((int(f.get("frame_row", 0)) for f in frames), default=0) + 1

    # Equal-split + bounded nudged_seams check (VAL-10)
    nudged_raw = manifest.get("nudged_seams", [])
    nudge_map: Dict[Tuple[str, int], float] = {}
    if not isinstance(nudged_raw, list):
        failures.append("VAL-10: nudged_seams must be a list.")
    else:
        use_fg_x = n_fc > 1 and tile_cols % n_fc == 0
        use_fg_y = n_fr > 1 and tile_rows % n_fr == 0
        tpf_c = (tile_cols // n_fc) if use_fg_x else tile_cols
        tpf_r = (tile_rows // n_fr) if use_fg_y else tile_rows
        for item in nudged_raw:
            if not isinstance(item, dict):
                failures.append(f"VAL-10: Invalid nudged_seams entry: {item!r}.")
                continue
            ax = item.get("axis")
            idx = item.get("index")
            delta_raw = item.get("delta_mm")
            if ax not in ("x", "y") or not isinstance(idx, int) or isinstance(idx, bool):
                failures.append(f"VAL-10: Invalid nudged_seams axis/index: {item!r}.")
                continue
            max_idx = (tile_cols - 1) if ax == "x" else (tile_rows - 1)
            if not (0 <= idx < max_idx):
                failures.append(f"VAL-10: nudged_seams index out of bounds: {item!r}.")
                continue
            try:
                delta_val = float(delta_raw)
            except (TypeError, ValueError):
                failures.append(f"VAL-10: nudged_seams non-numeric delta_mm: {item!r}.")
                continue
            if abs(delta_val) > 5.0 + 1e-6:
                failures.append(f"VAL-10: nudged_seams {ax}[{idx}] delta_mm={delta_val:.3f} exceeds +/-5.0 mm bound.")
                continue
            is_inter_seam = (
                (ax == "x" and use_fg_x and (idx + 1) % tpf_c == 0)
                or (ax == "y" and use_fg_y and (idx + 1) % tpf_r == 0)
            )
            if is_inter_seam:
                failures.append(f"VAL-10: nudged_seams {ax}[{idx}] illegally nudges an inter-frame seam.")
                continue
            if (ax, idx) in nudge_map:
                failures.append(f"VAL-10: Duplicate nudged_seams entry for {ax}[{idx}].")
                continue
            nudge_map[(ax, idx)] = delta_val

    if win_mm and len(win_mm) == 2 and is_multi_tile:
        total_w = float(win_mm[0])
        total_h = float(win_mm[1])
        use_fg_x = n_fc > 1 and tile_cols % n_fc == 0
        use_fg_y = n_fr > 1 and tile_rows % n_fr == 0
        eff_fc = n_fc if use_fg_x else 1
        eff_fr = n_fr if use_fg_y else 1
        tpf_c = tile_cols // eff_fc
        tpf_r = tile_rows // eff_fr
        tile_w = total_w / float(tile_cols)
        tile_h = total_h / float(tile_rows)
        for t in tile_entries:
            tr_val = t.get("row")
            tc_val = t.get("col")
            if not isinstance(tr_val, int) or not isinstance(tc_val, int):
                continue
            fc = tc_val // tpf_c
            fr = tr_val // tpf_r
            base_x0 = -total_w / 2.0 + tc_val * tile_w + fc * inter_frame_gap - ((eff_fc - 1) * inter_frame_gap) / 2.0
            base_x1 = base_x0 + tile_w
            base_y0 = -total_h / 2.0 + tr_val * tile_h + fr * inter_frame_gap - ((eff_fr - 1) * inter_frame_gap) / 2.0
            base_y1 = base_y0 + tile_h
            exp_x0 = base_x0 + (nudge_map.get(("x", tc_val - 1), 0.0) if tc_val > 0 else 0.0)
            exp_x1 = base_x1 + (nudge_map.get(("x", tc_val), 0.0) if tc_val < tile_cols - 1 else 0.0)
            exp_y0 = base_y0 + (nudge_map.get(("y", tr_val - 1), 0.0) if tr_val > 0 else 0.0)
            exp_y1 = base_y1 + (nudge_map.get(("y", tr_val), 0.0) if tr_val < tile_rows - 1 else 0.0)
            nr = t["nominal_rect_mm"]
            if (
                abs(float(nr["x_min"]) - exp_x0) > 0.05
                or abs(float(nr["x_max"]) - exp_x1) > 0.05
                or abs(float(nr["y_min"]) - exp_y0) > 0.05
                or abs(float(nr["y_max"]) - exp_y1) > 0.05
            ):
                failures.append(
                    f"VAL-10: Tile {t['tile_id']} nominal_rect_mm [{nr['x_min']:.2f}..{nr['x_max']:.2f}, "
                    f"{nr['y_min']:.2f}..{nr['y_max']:.2f}] deviates from equal-split + bounded nudged_seams "
                    f"[{exp_x0:.2f}..{exp_x1:.2f}, {exp_y0:.2f}..{exp_y1:.2f}]."
                )

    if win_mm and len(win_mm) == 2 and placed_tris:
        # Compute expected span including inter-frame gaps if any
        exp_w = float(win_mm[0]) + max(0, n_fc - 1) * inter_frame_gap
        exp_h = float(win_mm[1]) + max(0, n_fr - 1) * inter_frame_gap
        act_w = g_xmax - g_xmin
        act_h = g_ymax - g_ymin
        if water_cutout:
            # Coastal water cutouts may trim open ocean at outer borders; assert nominal union == exp and zero protrusion
            nom_w_span = max(float(t["nominal_rect_mm"]["x_max"]) for t in tile_entries) - min(
                float(t["nominal_rect_mm"]["x_min"]) for t in tile_entries
            )
            nom_h_span = max(float(t["nominal_rect_mm"]["y_max"]) for t in tile_entries) - min(
                float(t["nominal_rect_mm"]["y_min"]) for t in tile_entries
            )
            if abs(nom_w_span - exp_w) > 0.08 or abs(nom_h_span - exp_h) > 0.08:
                failures.append(
                    f"VAL-10: Nominal tile footprint {nom_w_span:.2f}x{nom_h_span:.2f} mm deviates from expected "
                    f"{exp_w:.2f}x{exp_h:.2f} mm (>0.08 mm)."
                )
            if act_w > exp_w + 0.08 or act_h > exp_h + 0.08:
                failures.append(
                    f"VAL-10: Placed mesh footprint {act_w:.2f}x{act_h:.2f} mm exceeds expected "
                    f"{exp_w:.2f}x{exp_h:.2f} mm (>0.08 mm)."
                )
        elif abs(act_w - exp_w) > 0.08 or abs(act_h - exp_h) > 0.08:
            failures.append(
                f"VAL-10: Global footprint {act_w:.2f}x{act_h:.2f} mm deviates from expected {exp_w:.2f}x{exp_h:.2f} mm (>0.08 mm)."
            )

    # Multi-frame datum match: each frame's nominal origin/window matches its constituent tiles
    for fr in frames:
        fid = fr.get("frame_id")
        f_win = fr.get("window_mm")
        f_orig = fr.get("nominal_origin_mm")
        if not (fid and f_win and f_orig and len(f_win) == 2 and len(f_orig) == 2):
            continue
        f_tiles = [t for t in tile_entries if t.get("frame_id") == fid and not t.get("skipped_empty_water")]
        if not f_tiles:
            continue
        fx0 = min(float(t["nominal_rect_mm"]["x_min"]) for t in f_tiles)
        fx1 = max(float(t["nominal_rect_mm"]["x_max"]) for t in f_tiles)
        fy0 = min(float(t["nominal_rect_mm"]["y_min"]) for t in f_tiles)
        fy1 = max(float(t["nominal_rect_mm"]["y_max"]) for t in f_tiles)
        if (
            abs(fx0 - float(f_orig[0])) > 0.05
            or abs(fy0 - float(f_orig[1])) > 0.05
            or abs((fx1 - fx0) - float(f_win[0])) > 0.05
            or abs((fy1 - fy0) - float(f_win[1])) > 0.05
        ):
            failures.append(
                f"VAL-10: Multi-frame datum mismatch on {fid}: tiles span [{fx0:.2f}..{fx1:.2f}, {fy0:.2f}..{fy1:.2f}] "
                f"vs frame origin {f_orig} window {f_win}."
            )

    # Check 4-way '+' corner intersections
    corners_checked = 0
    for t in tile_entries:
        nb = t.get("neighbors", {})
        tid_sw = t["tile_id"]
        tid_se = nb.get("east")
        tid_nw = nb.get("north")
        if not (tid_se and tid_nw):
            continue
        tid_ne = tile_by_id.get(tid_se, {}).get("neighbors", {}).get("north")
        if not tid_ne:
            continue
        if not all(k in placed_tris for k in (tid_sw, tid_se, tid_nw, tid_ne)):
            continue
        corners_checked += 1
        cx = t["nominal_rect_mm"]["x_max"]
        cy = t["nominal_rect_mm"]["y_max"]
        corner_max_zs: List[float] = []
        for cid in (tid_sw, tid_se, tid_nw, tid_ne):
            pts_near = [
                p[2]
                for tr in placed_tris[cid]
                for p in tr[:3]
                if math.hypot(p[0] - cx, p[1] - cy) <= 0.05
            ]
            corner_max_zs.append(max(pts_near) if pts_near else 0.0)
        if max(corner_max_zs) - min(corner_max_zs) > 0.20:
            failures.append(
                f"VAL-10: 4-way '+' corner ({tid_sw},{tid_se},{tid_nw},{tid_ne}) at ({cx:.2f},{cy:.2f}) "
                f"Z discontinuity={[round(z, 3) for z in corner_max_zs]} (>0.20 mm)."
            )

    # VAL-11: Master-vs-Tiles volume conservation (<= 0.5%)
    master_vol = manifest.get("master_volume_mm3")
    vol_ratio_diff = None
    if master_vol is None or float(master_vol) <= 0.0:
        failures.append("VAL-11: master_volume_mm3 missing or zero in assembly_manifest.json.")
    else:
        mv = float(master_vol)
        vol_ratio_diff = abs(sum_tile_vol_mm3 - mv) / mv
        if vol_ratio_diff > 0.005:
            failures.append(
                f"VAL-11: Volume mismatch sum_tiles={sum_tile_vol_mm3:.1f} mm3 vs master={mv:.1f} mm3 "
                f"(diff={vol_ratio_diff * 100:.3f}% > 0.500%)."
            )

    verdict = "FAIL" if failures else "PASS"
    report = {
        "schema_version": 1,
        "manifest": os.path.basename(manifest_abs),
        "sku_id": manifest.get("sku_id"),
        "format_id": manifest.get("format_id"),
        "city_slug": manifest.get("city_slug"),
        "validated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "verdict": verdict,
        "summary": {
            "tiles_checked": len(tile_reports),
            "seam_pairs_checked": len(seam_audits),
            "corners_4way_checked": corners_checked,
            "master_volume_mm3": master_vol,
            "sum_tile_volume_mm3": round(sum_tile_vol_mm3, 3),
            "volume_diff_pct": round(vol_ratio_diff * 100.0, 4) if vol_ratio_diff is not None else None,
            "blocking_failures": len(failures),
            "warnings": len(warnings),
        },
        "failures": failures,
        "warnings": warnings,
        "seams": seam_audits,
        "tiles": tile_reports,
    }

    report_path = os.path.join(base_dir, "validation_report.json")
    with open(report_path, "w", encoding="utf-8") as rf:
        json.dump(report, rf, indent=2)

    if stamp_manifest:
        manifest["validation"] = {
            "status": verdict,
            "verdict": verdict,
            "validated_at": report["validated_at"],
            "validator": "calibration/validate_assembly.py",
            "report_file": "validation_report.json",
            "report_sha256": sha256_file(report_path),
        }
        with open(manifest_abs, "w", encoding="utf-8") as mf_out:
            json.dump(manifest, mf_out, indent=2)

    log(f"=== ASSEMBLY VALIDATION REPORT ({manifest.get('city_slug')} / {manifest.get('format_id')}) ===")
    log(f"Tiles: {len(tile_reports)} | Seams checked: {len(seam_audits)} | 4-way corners: {corners_checked}")
    for sa in seam_audits:
        log(
            f"  [VAL-09] {sa['pair'][0]}<->{sa['pair'][1]} ({sa['axis']}={sa['seam_coord_mm']}mm): "
            f"diff={sa['true_diff_mm2']:.4f}mm2, step={sa['max_step_mm']:.4f}mm, "
            f"flat={sa['max_flatness_dev_mm']:.5f}mm -> {'PASS' if sa['passed'] else 'FAIL'}"
        )
    if vol_ratio_diff is not None:
        log(f"  [VAL-11] Volume: master={float(master_vol):.1f} mm3 vs sum_tiles={sum_tile_vol_mm3:.1f} mm3 (diff={vol_ratio_diff * 100:.3f}%)")
    for fm in failures:
        log(f"  FAIL: {fm}")
    log(f"FINAL ASSEMBLY VERDICT: {verdict} ({len(failures)} failures, {len(warnings)} warnings)")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Whole-Project Assembly Validator (VAL-01..VAL-14)")
    parser.add_argument("manifest", help="Path to assembly_manifest.json")
    parser.add_argument("--qa-dir", help="Output directory for seam diff PNGs (default: <manifest_dir>/_qa)")
    parser.add_argument("--no-stamp", action="store_true", help="Do not update validation block inside assembly_manifest.json")
    parser.add_argument("--quiet", action="store_true", help="Suppress stdout summary")
    args = parser.parse_args()

    rep = validate_assembly(
        args.manifest,
        qa_dir=args.qa_dir,
        stamp_manifest=not args.no_stamp,
        quiet=args.quiet,
    )
    if rep["verdict"] != "PASS":
        sys.exit(1)


if __name__ == "__main__":
    main()
