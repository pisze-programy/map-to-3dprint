#!/usr/bin/env python3
"""
Automated MSLA pre-print geometry and hydraulics validator (VAL-01 through VAL-08).

Implements the checks defined in docs/msla-printability-and-validation-spec.md for
Anycubic Photon Mono 4 (153.4 x 87.0 x 165.0 mm) flat Z=0 resin printing.

Usage:
  python3 calibration/validate_msla_stl.py <path-to-model.stl>
"""

import collections
import math
import struct
import sys


def read_binary_stl(path):
    with open(path, "rb") as f:
        header = f.read(80)
        raw_count = f.read(4)
        if len(raw_count) < 4:
            raise ValueError("File is too short to be a binary STL.")
        (n_tris,) = struct.unpack("<I", raw_count)
        raw_tris = []
        for _ in range(n_tris):
            rec = struct.unpack("<12fH", f.read(50))
            n = (rec[0], rec[1], rec[2])
            p0 = (rec[3], rec[4], rec[5])
            p1 = (rec[6], rec[7], rec[8])
            p2 = (rec[9], rec[10], rec[11])
            raw_tris.append((p0, p1, p2, n))
    z_floor = min((p[2] for t in raw_tris for p in t[:3]), default=0.0)
    tris = [
        (
            (round(p0[0], 4), round(p0[1], 4), round(p0[2] - z_floor, 4)),
            (round(p1[0], 4), round(p1[1], 4), round(p1[2] - z_floor, 4)),
            (round(p2[0], 4), round(p2[1], 4), round(p2[2] - z_floor, 4)),
            n,
        )
        for p0, p1, p2, n in raw_tris
    ]
    return header, tris, round(z_floor, 4)


def check_val01_topology_and_shells(tris):
    undir = collections.Counter()
    dir_e = collections.Counter()
    v_tris = collections.defaultdict(list)
    degen = 0
    nan_inf = 0
    total_vol_mm3 = 0.0

    for ti, (p0, p1, p2, n) in enumerate(tris):
        for coord in (*p0, *p1, *p2, *n):
            if math.isnan(coord) or math.isinf(coord):
                nan_inf += 1
        ux, uy, uz = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
        vx, vy, vz = p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]
        cx, cy, cz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        area2 = math.sqrt(cx * cx + cy * cy + cz * cz)
        if area2 < 1e-8 or p0 == p1 or p1 == p2 or p2 == p0:
            degen += 1
        for a, b in ((p0, p1), (p1, p2), (p2, p0)):
            undir[tuple(sorted((a, b)))] += 1
            dir_e[(a, b)] += 1
        for p in (p0, p1, p2):
            v_tris[p].append(ti)
        total_vol_mm3 += (
            p0[0] * (p1[1] * p2[2] - p1[2] * p2[1])
            - p0[1] * (p1[0] * p2[2] - p1[2] * p2[0])
            + p0[2] * (p1[0] * p2[1] - p1[1] * p2[0])
        ) / 6.0

    open_edges = sum(1 for c in undir.values() if c == 1)
    non_manifold_edges = sum(1 for c in undir.values() if c > 2)
    bad_half_edges = sum(1 for (a, b), c in dir_e.items() if c != 1 or dir_e[(b, a)] != 1)

    non_manifold_verts = 0
    for v, tlist in v_tris.items():
        adj = collections.defaultdict(list)
        for ti in tlist:
            pts = [p for p in tris[ti][:3] if p != v]
            if len(pts) == 2:
                adj[pts[0]].append(pts[1])
                adj[pts[1]].append(pts[0])
        if not adj:
            continue
        seen = set()
        stack = [next(iter(adj))]
        while stack:
            cur = stack.pop()
            if cur not in seen:
                seen.add(cur)
                stack.extend(adj[cur])
        if len(seen) != len(adj) or any(len(nb) != 2 for nb in adj.values()):
            non_manifold_verts += 1

    # Connected shell decomposition via shared vertices
    visited_t = [False] * len(tris)
    shells = []
    for ti in range(len(tris)):
        if visited_t[ti]:
            continue
        comp = []
        q = collections.deque([ti])
        visited_t[ti] = True
        while q:
            cur = q.popleft()
            comp.append(cur)
            for p in tris[cur][:3]:
                for nb in v_tris[p]:
                    if not visited_t[nb]:
                        visited_t[nb] = True
                        q.append(nb)
        xs = [p[0] for idx in comp for p in tris[idx][:3]]
        ys = [p[1] for idx in comp for p in tris[idx][:3]]
        zs = [p[2] for idx in comp for p in tris[idx][:3]]
        z0_area = 0.0
        z0_tris = []
        for idx in comp:
            p0, p1, p2, _ = tris[idx]
            if p0[2] <= 0.04 and p1[2] <= 0.04 and p2[2] <= 0.04:
                cz = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0])
                if cz < -1e-7:
                    z0_area += 0.5 * abs(cz)
                    z0_tris.append(idx)
        shells.append(
            {
                "tris": comp,
                "z0_tris": z0_tris,
                "bbox": (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)),
                "z0_area": z0_area,
            }
        )

    return {
        "nan_inf": nan_inf,
        "degen": degen,
        "open_edges": open_edges,
        "non_manifold_edges": non_manifold_edges,
        "bad_half_edges": bad_half_edges,
        "non_manifold_verts": non_manifold_verts,
        "volume_ml": total_vol_mm3 / 1000.0,
        "shells": shells,
    }


def slice_grid_2d(tris, z_level, xmin, xmax, ymin, ymax, step=0.40):
    """Rasterize 2D solid occupancy at z_level on a regular grid with 1-cell exterior border."""
    nx = int(math.ceil((xmax - xmin) / step)) + 4
    ny = int(math.ceil((ymax - ymin) / step)) + 4
    ox = xmin - 2 * step
    oy = ymin - 2 * step

    segs_by_row = [[] for _ in range(ny)]
    for p0, p1, p2, _ in tris:
        zmin = min(p0[2], p1[2], p2[2])
        zmax = max(p0[2], p1[2], p2[2])
        if not (zmin <= z_level < zmax):
            continue
        pts = []
        for a, b in ((p0, p1), (p1, p2), (p2, p0)):
            if (a[2] <= z_level < b[2]) or (b[2] <= z_level < a[2]):
                t = (z_level - a[2]) / (b[2] - a[2])
                pts.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
        if len(pts) == 2:
            (x1, y1), (x2, y2) = pts
            r0 = max(0, int((min(y1, y2) - oy) / step))
            r1 = min(ny - 1, int((max(y1, y2) - oy) / step))
            for r in range(r0, r1 + 1):
                yv = oy + (r + 0.5) * step
                if (y1 <= yv < y2) or (y2 <= yv < y1):
                    xh = x1 + (yv - y1) / (y2 - y1) * (x2 - x1)
                    segs_by_row[r].append(xh)

    solid = [[False] * nx for _ in range(ny)]
    solid_cells = 0
    for r in range(ny):
        xs = sorted(segs_by_row[r])
        for k in range(0, len(xs) - 1, 2):
            c0 = max(0, int((xs[k] - ox) / step))
            c1 = min(nx - 1, int((xs[k + 1] - ox) / step))
            for c in range(c0, c1 + 1):
                xv = ox + (c + 0.5) * step
                if xs[k] <= xv <= xs[k + 1]:
                    solid[r][c] = True
                    solid_cells += 1

    # Flood-fill exterior air from (0, 0)
    ext = [[False] * nx for _ in range(ny)]
    q = collections.deque([(0, 0)])
    ext[0][0] = True
    while q:
        r, c = q.popleft()
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < ny and 0 <= nc < nx and not ext[nr][nc] and not solid[nr][nc]:
                ext[nr][nc] = True
                q.append((nr, nc))

    # Measure trapped internal air cavities (neither solid nor exterior)
    seen_cav = [[False] * nx for _ in range(ny)]
    cavities = []
    cell_area = step * step
    for r in range(ny):
        for c in range(nx):
            if not solid[r][c] and not ext[r][c] and not seen_cav[r][c]:
                cnt = 0
                sum_x, sum_y = 0.0, 0.0
                cq = collections.deque([(r, c)])
                seen_cav[r][c] = True
                while cq:
                    cr, cc = cq.popleft()
                    cnt += 1
                    sum_x += ox + (cc + 0.5) * step
                    sum_y += oy + (cr + 0.5) * step
                    for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                        nr, nc = cr + dr, cc + dc
                        if 0 <= nr < ny and 0 <= nc < nx and not solid[nr][nc] and not ext[nr][nc] and not seen_cav[nr][nc]:
                            seen_cav[nr][nc] = True
                            cq.append((nr, nc))
                area = cnt * cell_area
                if area >= 2.0:
                    cavities.append((round(area, 2), round(sum_x / cnt, 1), round(sum_y / cnt, 1)))

    return solid_cells * cell_area, sorted(cavities, reverse=True)


def check_overhangs_val04(tris, xmin, xmax, ymin, ymax):
    """
    Find downward-facing flat/shallow overhang clusters (nz < -0.80 above Z=0.25 mm)
    and measure actual 2D distance from solid support on the layer 0.15 mm below.
    """
    cand = []
    v_map = collections.defaultdict(list)
    for ti, (p0, p1, p2, _) in enumerate(tris):
        zmin = min(p0[2], p1[2], p2[2])
        if zmin <= 0.25:
            continue
        ux, uy, uz = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
        vx, vy, vz = p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]
        cx, cy, cz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        norm = math.sqrt(cx * cx + cy * cy + cz * cz)
        if norm < 1e-8:
            continue
        nz = cz / norm
        if nz < -0.80:
            idx = len(cand)
            cand.append((ti, 0.5 * norm, nz))
            for p in (p0, p1, p2):
                v_map[p].append(idx)

    seen = [False] * len(cand)
    raw_clusters = []
    for i in range(len(cand)):
        if seen[i]:
            continue
        q = collections.deque([i])
        seen[i] = True
        area = 0.0
        t_list = []
        pts = []
        min_ang = 90.0
        while q:
            cur = q.popleft()
            ti, a, nz = cand[cur]
            t_list.append(ti)
            area += a
            ang = math.degrees(math.acos(min(1.0, abs(nz))))
            if ang < min_ang:
                min_ang = ang
            for p in tris[ti][:3]:
                pts.append(p)
                for nb in v_map[p]:
                    if not seen[nb]:
                        seen[nb] = True
                        q.append(nb)
        if area >= 2.5:
            zs = [p[2] for p in pts]
            raw_clusters.append((area, min_ang, min(zs), pts, t_list))

    # Group support slices by quantized z_support to keep runtime fast
    clusters = []
    slice_cache = {}
    step = 0.35
    nx = int(math.ceil((xmax - xmin) / step)) + 4
    ny = int(math.ceil((ymax - ymin) / step)) + 4
    ox = xmin - 2 * step
    oy = ymin - 2 * step

    def get_support_dist_grid(z_sup):
        zq = round(max(0.05, z_sup), 2)
        if zq in slice_cache:
            return slice_cache[zq]
        segs_by_row = [[] for _ in range(ny)]
        for p0, p1, p2, _ in tris:
            lo, hi = min(p0[2], p1[2], p2[2]), max(p0[2], p1[2], p2[2])
            if not (lo <= zq < hi):
                continue
            pts_s = []
            for a, b in ((p0, p1), (p1, p2), (p2, p0)):
                if (a[2] <= zq < b[2]) or (b[2] <= zq < a[2]):
                    t = (zq - a[2]) / (b[2] - a[2])
                    pts_s.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
            if len(pts_s) == 2:
                (x1, y1), (x2, y2) = pts_s
                r0 = max(0, int((min(y1, y2) - oy) / step))
                r1 = min(ny - 1, int((max(y1, y2) - oy) / step))
                for r in range(r0, r1 + 1):
                    yv = oy + (r + 0.5) * step
                    if (y1 <= yv < y2) or (y2 <= yv < y1):
                        segs_by_row[r].append(x1 + (yv - y1) / (y2 - y1) * (x2 - x1))
        dist = [[999] * nx for _ in range(ny)]
        dq = collections.deque()
        for r in range(ny):
            xs_s = sorted(segs_by_row[r])
            for k in range(0, len(xs_s) - 1, 2):
                c0 = max(0, int((xs_s[k] - ox) / step))
                c1 = min(nx - 1, int((xs_s[k + 1] - ox) / step))
                for c in range(c0, c1 + 1):
                    xv = ox + (c + 0.5) * step
                    if xs_s[k] <= xv <= xs_s[k + 1]:
                        dist[r][c] = 0
                        dq.append((r, c))
        while dq:
            r, c = dq.popleft()
            nd = dist[r][c] + 1
            if nd > 25:
                continue
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nr, nc = r + dr, c + dc
                if 0 <= nr < ny and 0 <= nc < nx and dist[nr][nc] > nd:
                    dist[nr][nc] = nd
                    dq.append((nr, nc))
        slice_cache[zq] = dist
        return dist

    for area, min_ang, z_lo, pts, t_list in raw_clusters:
        dist_grid = get_support_dist_grid(z_lo - 0.15)
        max_cells = 0
        for ti in t_list:
            p0, p1, p2, _ = tris[ti]
            samples = [
                p0,
                p1,
                p2,
                ((p0[0] + p1[0] + p2[0]) / 3.0, (p0[1] + p1[1] + p2[1]) / 3.0, z_lo),
            ]
            for sp in samples:
                cc = max(0, min(nx - 1, int((sp[0] - ox) / step)))
                rr = max(0, min(ny - 1, int((sp[1] - oy) / step)))
                if dist_grid[rr][cc] > max_cells:
                    max_cells = dist_grid[rr][cc]
        unsupported_radius_mm = max_cells * step
        # Two-sided 4.2 mm vent bridge has half-span = 2.10 mm; flag > 2.45 mm half-span.
        if unsupported_radius_mm > 2.45:
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            clusters.append(
                {
                    "area_mm2": round(area, 2),
                    "unsupported_half_span_mm": round(unsupported_radius_mm, 2),
                    "min_angle_deg": round(min_ang, 1),
                    "z_mm": round(z_lo, 2),
                    "center_xy": (round(0.5 * (min(xs) + max(xs)), 1), round(0.5 * (min(ys) + max(ys)), 1)),
                }
            )
    return sorted(clusters, key=lambda d: d["unsupported_half_span_mm"], reverse=True)


def check_z0_islands_and_spacing(tris, shells):
    """Detect split narrow Z=0 base pads inside a tall shell (VAL-05) and close shell spacing (VAL-06)."""
    narrow_pads = []
    for si, sh in enumerate(shells):
        z_height = sh["bbox"][5] - sh["bbox"][4]
        z0_t = sh["z0_tris"]
        if not z0_t:
            narrow_pads.append((si, "FLOATING_SHELL_NO_Z0_CONTACT", sh["bbox"]))
            continue
        # Connected components of Z=0 contact triangles within this shell
        v_z0 = collections.defaultdict(list)
        for idx in z0_t:
            for p in tris[idx][:3]:
                v_z0[p].append(idx)
        seen = set()
        pads = []
        for idx in z0_t:
            if idx in seen:
                continue
            q = collections.deque([idx])
            seen.add(idx)
            pts = []
            p_area = 0.0
            while q:
                cur = q.popleft()
                p0, p1, p2, _ = tris[cur]
                cz = abs((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]))
                p_area += 0.5 * cz
                for p in (p0, p1, p2):
                    pts.append(p)
                    for nb in v_z0[p]:
                        if nb not in seen:
                            seen.add(nb)
                            q.append(nb)
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            w_minor = min(max(xs) - min(xs), max(ys) - min(ys))
            pads.append((w_minor, p_area, (round(min(xs), 1), round(max(xs), 1), round(min(ys), 1), round(max(ys), 1))))
        max_w_minor = max(p[0] for p in pads)
        if len(pads) >= 2 and z_height >= 8.0 and max_w_minor < 7.5:
            for w_minor, p_area, p_box in pads:
                narrow_pads.append((si, f"SPLIT_NARROW_Z0_PAD width={w_minor:.2f}mm area={p_area:.1f}mm2 H={z_height:.1f}mm", p_box))

    close_pairs = []
    for i in range(len(shells)):
        if shells[i]["z0_area"] < 180.0:
            continue
        b1 = shells[i]["bbox"]
        for j in range(i + 1, len(shells)):
            if shells[j]["z0_area"] < 180.0:
                continue
            b2 = shells[j]["bbox"]
            dx = max(0.0, b1[0] - b2[1], b2[0] - b1[1])
            dy = max(0.0, b1[2] - b2[3], b2[2] - b1[3])
            gap = math.hypot(dx, dy)
            if gap < 12.0:
                close_pairs.append((i, j, round(gap, 2)))

    return narrow_pads, close_pairs


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 calibration/validate_msla_stl.py <path-to-model.stl>")
        sys.exit(2)

    path = sys.argv[1]
    _, tris, orig_zmin = read_binary_stl(path)
    xs_all = [p[0] for t in tris for p in t[:3]]
    ys_all = [p[1] for t in tris for p in t[:3]]
    zs_all = [p[2] for t in tris for p in t[:3]]
    xmin, xmax = min(xs_all), max(xs_all)
    ymin, ymax = min(ys_all), max(ys_all)
    zmin, zmax = min(zs_all), max(zs_all)
    sx, sy, sz = xmax - xmin, ymax - ymin, zmax - zmin

    failures = []
    warnings = []

    print(f"=== MSLA PRE-PRINT VALIDATION REPORT: {path} ===")
    print(f"Triangles: {len(tris)} | BBox: {sx:.2f} x {sy:.2f} x {sz:.2f} mm (orig Z_min={orig_zmin:.2f} mm -> shifted Z: 0.00..{zmax:.2f} mm)")

    # VAL-01: Global float32 2-manifold topology
    topo = check_val01_topology_and_shells(tris)
    print(
        f"[VAL-01] Topology: degen={topo['degen']}, open_edges={topo['open_edges']}, "
        f"non_manifold_edges={topo['non_manifold_edges']}, non_manifold_verts={topo['non_manifold_verts']}, "
        f"shells={len(topo['shells'])}, volume={topo['volume_ml']:.2f} ml"
    )
    if any(topo[k] > 0 for k in ("nan_inf", "degen", "open_edges", "non_manifold_edges", "bad_half_edges", "non_manifold_verts")):
        failures.append("VAL-01: Mesh is not a clean 2-manifold (will trigger slicer repair warnings).")

    # VAL-02 & VAL-03: Suction-cup cavities and transition-zone vent height (Z <= 1.15 mm)
    for zv in (0.15, 0.55, 0.95, 1.15):
        if zv < zmax:
            s_area, cavs = slice_grid_2d(tris, zv, xmin, xmax, ymin, ymax, step=0.40)
            print(f"[VAL-02/03] Slice Z={zv:.2f} mm: solid_area={s_area:.0f} mm2, sealed_cavities={cavs[:4]}")
            if cavs:
                label = "VAL-02" if zv <= 0.60 else "VAL-03"
                failures.append(f"{label}: Sealed suction-cup cavity at Z={zv:.2f} mm: {cavs[:3]}")

    # VAL-04: Unsupported shallow overhangs
    overhangs = check_overhangs_val04(tris, xmin, xmax, ymin, ymax)
    print(f"[VAL-04] Unsupported overhangs (<36.8 deg, half-span>2.45 mm): {overhangs[:4]}")
    for oh in overhangs:
        if oh["min_angle_deg"] < 20.0 and oh["unsupported_half_span_mm"] > 3.0:
            failures.append(
                f"VAL-04: Unsupported flat ceiling at Z={oh['z_mm']} mm XY={oh['center_xy']} "
                f"(half_span={oh['unsupported_half_span_mm']} mm, area={oh['area_mm2']} mm2)."
            )
        else:
            warnings.append(
                f"VAL-04: Shallow arch/bridge at Z={oh['z_mm']} mm XY={oh['center_xy']} "
                f"(half_span={oh['unsupported_half_span_mm']} mm, min_ang={oh['min_angle_deg']} deg)."
            )

    # VAL-05 & VAL-06: Narrow split Z=0 pads and multi-part FEP-tenting gap
    narrow_pads, close_pairs = check_z0_islands_and_spacing(tris, topo["shells"])
    print(f"[VAL-05] Narrow/floating Z=0 base pads: {narrow_pads}")
    print(f"[VAL-06] High-area shell pairs closer than 12.0 mm (FEP tenting risk): {close_pairs}")
    for item in narrow_pads:
        if "FLOATING" in item[1]:
            failures.append(f"VAL-05: {item}")
        else:
            warnings.append(f"VAL-05: {item}")
    for i, j, gap in close_pairs:
        warnings.append(f"VAL-06: Shells #{i} and #{j} are {gap} mm apart (<12.0 mm classic FEP tenting margin).")

    # VAL-07: Cross-section peel area and sudden area jump scan
    z_steps = [round(0.25 + k * 0.50, 2) for k in range(int(max(1, (sz - 0.25) / 0.50)))]
    prev_area = None
    max_slice_area = 0.0
    max_jump = (0.0, 0.0)
    for zv in z_steps:
        if zv >= sz:
            break
        s_area, _ = slice_grid_2d(tris, zv, xmin, xmax, ymin, ymax, step=0.60)
        if s_area > max_slice_area:
            max_slice_area = s_area
        if prev_area is not None and prev_area > 80.0 and (s_area - prev_area) > max_jump[0]:
            max_jump = (s_area - prev_area, zv)
        prev_area = s_area
    print(f"[VAL-07] Max slice area: {max_slice_area:.0f} mm2 | Max upward area jump: +{max_jump[0]:.0f} mm2 at Z={max_jump[1]:.2f} mm")
    if max_slice_area > 2600.0:
        warnings.append(f"VAL-07: High Z-slice peel area ({max_slice_area:.0f} mm2 > 2600 mm2); core base or lower bottom exposure.")
    if max_jump[0] > 150.0:
        warnings.append(f"VAL-07: Sudden cross-section peel jump (+{max_jump[0]:.0f} mm2 at Z={max_jump[1]:.2f} mm).")

    # VAL-08: Build envelope & VAT volume
    fits_normal = sx <= 153.4 and sy <= 87.0 and sz <= 163.0
    fits_rot90 = sy <= 153.4 and sx <= 87.0 and sz <= 163.0
    print(f"[VAL-08] Mono 4 envelope fit: normal={fits_normal}, rot90={fits_rot90} | Resin={topo['volume_ml']:.1f} ml")
    if not fits_normal:
        failures.append(f"VAL-08: Bounding box {sx:.2f} x {sy:.2f} x {sz:.2f} mm exceeds Mono 4 unrotated envelope (153.4 x 87.0 x 163.0 mm).")
    if topo["volume_ml"] > 30.0:
        warnings.append(f"VAL-08: Print consumes {topo['volume_ml']:.1f} ml resin; verify VAT fill level before starting.")

    print("--- SUMMARY ---")
    for w in warnings:
        print(f"  WARN: {w}")
    for f_msg in failures:
        print(f"  FAIL: {f_msg}")

    if failures:
        print(f"FINAL VERDICT: FAIL ({len(failures)} blocking issues, {len(warnings)} warnings)")
        sys.exit(1)
    print(f"FINAL VERDICT: PASS (0 blocking issues, {len(warnings)} warnings)")


if __name__ == "__main__":
    main()
