#!/usr/bin/env python3
"""
gis_geometry.py
2D Ring Stitching, Polygon Simplification, Coastline Sea Builder & Scene Validation
"""
import math
import re

def stitch_way_rings(way_node_lists):
    """Stitches a list of node-ID lists into closed rings."""
    rings = []
    open_segs = [list(w) for w in way_node_lists if len(w) >= 2]
    while open_segs:
        curr = open_segs.pop(0)
        if curr[0] == curr[-1]:
            if len(curr) >= 4:
                rings.append(curr)
            continue
        changed = True
        while changed and curr[0] != curr[-1]:
            changed = False
            for i, seg in enumerate(open_segs):
                if seg[0] == curr[-1]:
                    curr.extend(seg[1:])
                    open_segs.pop(i)
                    changed = True
                    break
                elif seg[-1] == curr[-1]:
                    curr.extend(reversed(seg[:-1]))
                    open_segs.pop(i)
                    changed = True
                    break
                elif seg[-1] == curr[0]:
                    curr = seg[:-1] + curr
                    open_segs.pop(i)
                    changed = True
                    break
                elif seg[0] == curr[0]:
                    curr = list(reversed(seg[1:])) + curr
                    open_segs.pop(i)
                    changed = True
                    break
        if len(curr) >= 4:
            if curr[0] != curr[-1]:
                curr.append(curr[0])
            rings.append(curr)
    return rings


def parse_float_tag(val, default=None):
    if not val:
        return default
    m = re.search(r"[-+]?\d*\.?\d+", str(val).replace(",", "."))
    if m:
        try:
            return float(m.group(0))
        except ValueError:
            return default
    return default


def simplify_ring(pts, tol=0.14):
    """Light vertex deduplication in model space [-85, +85]."""
    if len(pts) < 4:
        return pts
    out = [pts[0]]
    tol_sq = tol * tol
    for p in pts[1:]:
        dx = p[0] - out[-1][0]
        dy = p[1] - out[-1][1]
        if dx * dx + dy * dy >= tol_sq:
            out.append(p)
    if len(out) >= 3 and out[0] == out[-1]:
        out.pop()
    return out


def point_in_poly(x, y, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def poly_area_signed(poly):
    a = 0.0
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return a * 0.5


def _ray_box_intersect(p_from, p_to, R=92.0):
    dx = p_to[0] - p_from[0]
    dy = p_to[1] - p_from[1]
    if abs(dx) < 1e-6 and abs(dy) < 1e-6:
        return [round(max(-R, min(R, p_to[0])), 2), round(max(-R, min(R, p_to[1])), 2)]
    best_t = None
    best_pt = None
    for edge_x in (-R, R):
        if abs(dx) > 1e-6:
            t = (edge_x - p_from[0]) / dx
            y = p_from[1] + t * dy
            if t > 0 and -R - 1e-3 <= y <= R + 1e-3:
                if best_t is None or t < best_t:
                    best_t = t
                    best_pt = [round(edge_x, 2), round(max(-R, min(R, y)), 2)]
    for edge_y in (-R, R):
        if abs(dy) > 1e-6:
            t = (edge_y - p_from[1]) / dy
            x = p_from[0] + t * dx
            if t > 0 and -R - 1e-3 <= x <= R + 1e-3:
                if best_t is None or t < best_t:
                    best_t = t
                    best_pt = [round(max(-R, min(R, x)), 2), round(edge_y, 2)]
    return best_pt or [round(max(-R, min(R, p_to[0])), 2), round(max(-R, min(R, p_to[1])), 2)]


def _cw_box_param(pt, R=92.0):
    x, y = pt[0], pt[1]
    if abs(y - R) < 0.05:
        return x + R
    if abs(x - R) < 0.05:
        return 2.0 * R + (R - y)
    if abs(y + R) < 0.05:
        return 4.0 * R + (R - x)
    return 6.0 * R + (y + R)


def build_sea_polygons_from_coastlines(coast_ways_pts, R=92.0):
    """
    Converts directed OSM natural=coastline ways (land on left, sea on right)
    into closed sea water polygons clipped/extended to [-R, R]^2.
    """
    if not coast_ways_pts:
        return []

    # 1. Stitch directed segments where end of A matches start of B
    chains = [list(seg) for seg in coast_ways_pts if len(seg) >= 2]
    merged = True
    while merged:
        merged = False
        for i in range(len(chains)):
            for j in range(len(chains)):
                if i == j:
                    continue
                end_i = chains[i][-1]
                start_j = chains[j][0]
                if math.hypot(end_i[0] - start_j[0], end_i[1] - start_j[1]) < 0.8:
                    chains[i] = chains[i] + chains[j][1:]
                    chains.pop(j)
                    merged = True
                    break
            if merged:
                break

    sea_polys = []
    island_holes = []
    corners = [
        (2.0 * R, [R, R]),
        (4.0 * R, [R, -R]),
        (6.0 * R, [-R, -R]),
        (8.0 * R, [-R, R]),
    ]

    for ch in chains:
        if len(ch) < 2:
            continue
        if len(ch) >= 4 and math.hypot(ch[0][0] - ch[-1][0], ch[0][1] - ch[-1][1]) < 1.0:
            # Closed loop: CCW (>0) is an island (land inside), CW (<0) is water inside
            if poly_area_signed(ch) > 0:
                island_holes.append(ch)
            else:
                sea_polys.append({"outer": ch, "holes": [], "name": "Morze / Ocean"})
            continue

        p_start = _ray_box_intersect(ch[1], ch[0], R)
        p_end = _ray_box_intersect(ch[-2], ch[-1], R)
        s_end = _cw_box_param(p_end, R)
        s_start = _cw_box_param(p_start, R)
        span = (s_start - s_end) % (8.0 * R)

        cw_corners = []
        for cs, cpt in sorted(corners, key=lambda c: (c[0] - s_end) % (8.0 * R)):
            dist = (cs - s_end) % (8.0 * R)
            if 0.05 < dist < span - 0.05:
                cw_corners.append(cpt)

        poly_pts = [p_start] + ch + [p_end] + cw_corners
        sea_polys.append({"outer": poly_pts, "holes": [], "name": "Morze / Zatoka"})

    if sea_polys and island_holes:
        sea_polys[0]["holes"].extend(island_holes)
    return sea_polys


def validate_processed_scene(scene):
    """
    Fix B05, B12, B13: Rejects truncated or incomplete processed scenes
    (e.g. partial Overpass responses missing roads, greenery, or trees).
    """
    if not isinstance(scene, dict):
        return False
    buildings = scene.get("buildings") or []
    roads = scene.get("roads") or []
    green_polys = scene.get("greenPolys") or []
    trees = scene.get("trees") or []
    if len(buildings) < 50 or len(roads) < 15:
        return False
    if len(green_polys) == 0 and len(trees) == 0:
        return False
    return True


