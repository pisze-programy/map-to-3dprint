#!/usr/bin/env python3
"""
Generator wodoszczelnych (2-manifold) modeli kalibracyjnych STL (Etap 1)
dla drukarki Anycubic Photon Mono 4 (10K, 153.4 x 87.0 x 165.0 mm)
oraz żywicy Anycubic Standard Resin Clear pod projekt map-to-3dprint.

Generuje dwa pliki binarne STL:
  1. calibration/etap1_pelny_test_poziomu_i_ekspozycji.stl (132 x 72 x 4.2 mm)
     - Centralna Matryca Miejska (52 x 38 x 4.2 mm)
     - 4 narożne czujniki poziomowania stołu (FL=1, FR=2, BL=3, BR=4 wypustki)
  2. calibration/etap1_tylko_matryca_srodek.stl (52 x 38 x 4.2 mm)
     - Sama centralna matryca do szybkiej korekty ekspozycji
"""

import math
import os
import struct
from collections import defaultdict


def merge_intervals(intervals, eps=1e-6):
    if not intervals:
        return []
    valid = [(a, b) for a, b in intervals if b - a > eps]
    if not valid:
        return []
    valid.sort(key=lambda x: (x[0], x[1]))
    merged = [valid[0]]
    for a, b in valid[1:]:
        la, lb = merged[-1]
        if a <= lb + eps:
            merged[-1] = (la, max(lb, b))
        else:
            merged.append((a, b))
    return merged


def subtract_intervals(src, cut, eps=1e-6):
    """Return intervals in `src` minus intervals in `cut`."""
    res = list(src)
    for ca, cb in cut:
        nxt = []
        for a, b in res:
            if cb <= a + eps or ca >= b - eps:
                nxt.append((a, b))
            else:
                if a < ca - eps:
                    nxt.append((a, ca))
                if b > cb + eps:
                    nxt.append((cb, b))
        res = nxt
    return res


class RectilinearManifoldBuilder:
    """
    Exact 2-manifold multi-interval rectilinear column mesh builder.
    Eliminates all T-junctions on vertical edges and verifies watertight topology.
    """

    def __init__(self, x_coords, y_coords):
        self.xs = sorted({round(float(x), 4) for x in x_coords})
        self.ys = sorted({round(float(y), 4) for y in y_coords})
        self.nx = len(self.xs) - 1
        self.ny = len(self.ys) - 1
        self.grid = [[[] for _ in range(self.ny)] for _ in range(self.nx)]

    def add_box(self, x0, x1, y0, y1, z0, z1):
        x0, x1 = round(float(x0), 4), round(float(x1), 4)
        y0, y1 = round(float(y0), 4), round(float(y1), 4)
        z0, z1 = round(float(z0), 4), round(float(z1), 4)
        if x1 <= x0 or y1 <= y0 or z1 <= z0:
            return
        for i in range(self.nx):
            cx = 0.5 * (self.xs[i] + self.xs[i + 1])
            if x0 < cx < x1:
                for j in range(self.ny):
                    cy = 0.5 * (self.ys[j] + self.ys[j + 1])
                    if y0 < cy < y1:
                        self.grid[i][j].append((z0, z1))

    def cut_box(self, x0, x1, y0, y1, z0, z1):
        x0, x1 = round(float(x0), 4), round(float(x1), 4)
        y0, y1 = round(float(y0), 4), round(float(y1), 4)
        z0, z1 = round(float(z0), 4), round(float(z1), 4)
        if x1 <= x0 or y1 <= y0 or z1 <= z0:
            return
        for i in range(self.nx):
            cx = 0.5 * (self.xs[i] + self.xs[i + 1])
            if x0 < cx < x1:
                for j in range(self.ny):
                    cy = 0.5 * (self.ys[j] + self.ys[j + 1])
                    if y0 < cy < y1 and self.grid[i][j]:
                        merged = merge_intervals(self.grid[i][j])
                        self.grid[i][j] = subtract_intervals(merged, [(z0, z1)])

    def build_triangles(self):
        # 1. Normalize intervals per cell
        for i in range(self.nx):
            for j in range(self.ny):
                self.grid[i][j] = merge_intervals(self.grid[i][j])

        # 2. Collect all Z breakpoints at every grid vertex (vi, vj) to prevent T-junctions
        z_at_vert = [[set() for _ in range(self.ny + 1)] for _ in range(self.nx + 1)]
        for i in range(self.nx):
            for j in range(self.ny):
                for za, zb in self.grid[i][j]:
                    for di in (0, 1):
                        for dj in (0, 1):
                            z_at_vert[i + di][j + dj].add(za)
                            z_at_vert[i + di][j + dj].add(zb)

        z_sorted = [
            [sorted(z_at_vert[vi][vj]) for vj in range(self.ny + 1)]
            for vi in range(self.nx + 1)
        ]

        tris = []

        def emit_quad_planar(p0, p1, p2, p3):
            tris.append((p0, p1, p2))
            tris.append((p0, p2, p3))

        def sub_z(vi, vj, za, zb):
            pts = [z for z in z_sorted[vi][vj] if za - 1e-6 <= z <= zb + 1e-6]
            if not pts or abs(pts[0] - za) > 1e-6:
                pts.insert(0, za)
            if abs(pts[-1] - zb) > 1e-6:
                pts.append(zb)
            return pts

        def emit_vertical_wall(vi0, vj0, vi1, vj1, za, zb):
            """
            Emit vertical wall from bottom-left (vi0, vj0, za) to bottom-right (vi1, vj1, za)
            up to zb, viewed from outside (CCW winding: (vi0,vj0,za)->(vi1,vj1,za)->(vi1,vj1,zb)->(vi0,vj0,zb)).
            Subdivides left and right vertical edges at all vertex Z-breakpoints so zero T-junctions exist.
            """
            x0, y0 = self.xs[vi0], self.ys[vj0]
            x1, y1 = self.xs[vi1], self.ys[vj1]
            zl = sub_z(vi0, vj0, za, zb)
            zr = sub_z(vi1, vj1, za, zb)
            # Merge common Z slices across left/right or fan cleanly
            all_z = sorted(set(zl) | set(zr))
            # Even simpler: only subdivide along whichever side actually has the Z-vertex!
            # Use two-pointer zipper triangulation between left chain L[0..m] and right chain R[0..n]:
            L = [(x0, y0, z) for z in zl]
            R = [(x1, y1, z) for z in zr]
            li, ri = 0, 0
            while li < len(L) - 1 or ri < len(R) - 1:
                if li == len(L) - 1:
                    tris.append((L[li], R[ri], R[ri + 1]))
                    ri += 1
                elif ri == len(R) - 1:
                    tris.append((L[li], R[ri], L[li + 1]))
                    li += 1
                elif zl[li + 1] <= zr[ri + 1]:
                    tris.append((L[li], R[ri], L[li + 1]))
                    li += 1
                else:
                    tris.append((L[li], R[ri], R[ri + 1]))
                    ri += 1

        # 3. Horizontal faces (+Z top, -Z bottom)
        for i in range(self.nx):
            x0, x1 = self.xs[i], self.xs[i + 1]
            for j in range(self.ny):
                y0, y1 = self.ys[j], self.ys[j + 1]
                for za, zb in self.grid[i][j]:
                    # Top face (+Z): CCW from above
                    emit_quad_planar(
                        (x0, y0, zb), (x1, y0, zb), (x1, y1, zb), (x0, y1, zb)
                    )
                    # Bottom face (-Z): CW from above
                    emit_quad_planar(
                        (x0, y0, za), (x0, y1, za), (x1, y1, za), (x1, y0, za)
                    )

        # 4. Vertical X-walls (constant x = xs[vi], for vi = 0..nx)
        for vi in range(self.nx + 1):
            for j in range(self.ny):
                left_iv = self.grid[vi - 1][j] if vi > 0 else []
                right_iv = self.grid[vi][j] if vi < self.nx else []
                # Outward +X wall (solid on left, air on right): viewed from +X, left is y0, right is y1
                for za, zb in subtract_intervals(left_iv, right_iv):
                    emit_vertical_wall(vi, j, vi, j + 1, za, zb)
                # Outward -X wall (solid on right, air on left): viewed from -X, left is y1, right is y0
                for za, zb in subtract_intervals(right_iv, left_iv):
                    emit_vertical_wall(vi, j + 1, vi, j, za, zb)

        # 5. Vertical Y-walls (constant y = ys[vj], for vj = 0..ny)
        for vj in range(self.ny + 1):
            for i in range(self.nx):
                front_iv = self.grid[i][vj - 1] if vj > 0 else []
                back_iv = self.grid[i][vj] if vj < self.ny else []
                # Outward +Y wall (solid on front j-1, air on back j): viewed from +Y, left is x1, right is x0
                for za, zb in subtract_intervals(front_iv, back_iv):
                    emit_vertical_wall(i + 1, vj, i, vj, za, zb)
                # Outward -Y wall (solid on back j, air on front j-1): viewed from -Y, left is x0, right is x1
                for za, zb in subtract_intervals(back_iv, front_iv):
                    emit_vertical_wall(i, vj, i + 1, vj, za, zb)

        return tris


def audit_topology_and_volume(tris):
    """Verify exact 2-manifold edge counts and compute signed volume in mm^3 / ml."""
    directed_edges = defaultdict(int)
    undirected_edges = defaultdict(int)
    vol6 = 0.0
    min_pt = [float("inf")] * 3
    max_pt = [float("-inf")] * 3

    def qv(p):
        return (round(p[0], 4), round(p[1], 4), round(p[2], 4))

    for p0, p1, p2 in tris:
        v0, v1, v2 = qv(p0), qv(p1), qv(p2)
        for v in (v0, v1, v2):
            for k in range(3):
                min_pt[k] = min(min_pt[k], v[k])
                max_pt[k] = max(max_pt[k], v[k])

        for a, b in ((v0, v1), (v1, v2), (v2, v0)):
            directed_edges[(a, b)] += 1
            undirected_edges[(min(a, b), max(a, b))] += 1

        vol6 += (
            v0[0] * (v1[1] * v2[2] - v1[2] * v2[1])
            - v0[1] * (v1[0] * v2[2] - v1[2] * v2[0])
            + v0[2] * (v1[0] * v2[1] - v1[1] * v2[0])
        )

    open_edges = 0
    non_manifold_edges = 0
    for (a, b), cnt in undirected_edges.items():
        if cnt == 1:
            open_edges += 1
        elif cnt != 2 or directed_edges[(a, b)] != 1 or directed_edges[(b, a)] != 1:
            non_manifold_edges += 1

    vol_mm3 = vol6 / 6.0
    return {
        "triangles": len(tris),
        "open_edges": open_edges,
        "non_manifold_edges": non_manifold_edges,
        "volume_mm3": vol_mm3,
        "volume_ml": vol_mm3 / 1000.0,
        "bbox_min": tuple(min_pt),
        "bbox_max": tuple(max_pt),
    }


def write_binary_stl(path, tris, header_text="map-to-3dprint Photon Mono 4 Calibration"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    hdr = header_text.encode("ascii", errors="ignore")[:80].ljust(80, b"\x00")
    with open(path, "wb") as f:
        f.write(hdr)
        f.write(struct.pack("<I", len(tris)))
        for p0, p1, p2 in tris:
            ux, uy, uz = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
            vx, vy, vz = p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]
            nx = uy * vz - uz * vy
            ny = uz * vx - ux * vz
            nz = ux * vy - uy * vx
            ln = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            nx, ny, nz = nx / ln, ny / ln, nz / ln
            f.write(
                struct.pack(
                    "<12fH",
                    nx, ny, nz,
                    p0[0], p0[1], p0[2],
                    p1[0], p1[1], p1[2],
                    p2[0], p2[1], p2[2],
                    0,
                )
            )


def build_central_matrix_commands():
    """
    Returns (xs, ys, ops) for the 52.0 x 38.0 x 4.20 mm Urban Calibration Matrix
    centered at (0, 0) with Z in [0.00, 4.20] mm.
    """
    ops = []
    xs = set()
    ys = set()

    def add(x0, x1, y0, y1, z0, z1):
        xs.update([x0, x1])
        ys.update([y0, y1])
        ops.append(("add", x0, x1, y0, y1, z0, z1))

    def cut(x0, x1, y0, y1, z0, z1):
        xs.update([x0, x1])
        ys.update([y0, y1])
        ops.append(("cut", x0, x1, y0, y1, z0, z1))

    # -------------------------------------------------------------------------
    # 1. Base Plate: [-26.0, +26.0] x [-19.0, +19.0], Z = [0.00, 1.40] mm
    #    - Front edge (Y = -19.0) has a 4-step 45-deg scraper pry-bevel (0.80 mm)
    #    - Back (Y = +19.0) & Right (X = +26.0) edges are strict 90-deg Z=0 walls
    #      to inspect Elephant's Foot on tile seams!
    # -------------------------------------------------------------------------
    add(-26.0, 26.0, -19.0, 19.0, 0.00, 1.40)
    # Front pry-lip chamfer steps along Y in [-19.0, -18.2]
    cut(-26.0, 26.0, -19.0, -18.8, 0.00, 0.80)
    cut(-26.0, 26.0, -18.8, -18.6, 0.00, 0.60)
    cut(-26.0, 26.0, -18.6, -18.4, 0.00, 0.40)
    cut(-26.0, 26.0, -18.4, -18.2, 0.00, 0.20)

    # North orientation notch / arrow pointer at top-center (Y in [16.5, 18.0])
    add(-0.6, 0.6, 15.0, 18.0, 1.40, 2.00)
    add(-1.8, 1.8, 16.2, 17.2, 1.40, 2.00)

    # -------------------------------------------------------------------------
    # ZONE A (Front-Left): SLA Z=0 Drain Channels (suction-cup & bottom-bleed test)
    # Three tunnels passing from front edge Y=-19.0 to an open vent basin Y=-11.0
    # Widths: 1.50 mm, 2.00 mm, 2.50 mm; Tunnel roof at Z = 0.80 mm (base boosted to 2.00 mm)
    # -------------------------------------------------------------------------
    add(-24.5, -9.5, -18.2, -10.0, 1.40, 2.10)
    # Open inspection window / basin behind tunnels so IPA flows right through!
    cut(-23.5, -10.5, -13.0, -10.8, 0.00, 2.20)
    drain_specs = [
        (-22.5, 1.50),  # 1.50 mm wide
        (-18.5, 2.00),  # 2.00 mm wide (matches map-to-3dprint SLA drain)
        (-14.0, 2.50),  # 2.50 mm wide
    ]
    for cx, w in drain_specs:
        cut(cx - w / 2.0, cx + w / 2.0, -19.0, -13.0, 0.00, 0.80)

    # -------------------------------------------------------------------------
    # ZONE B (Back-Left): Positive Skyscraper Pillars (map-to-3dprint PSE test)
    # Sizes: 0.25, 0.35 (PSE threshold), 0.50, 0.75, 1.00, 1.50 mm
    # Two rows: tall skyscrapers (height +2.80 mm -> Z=4.20 mm) & medium (+1.60 mm -> Z=3.00 mm)
    # -------------------------------------------------------------------------
    pillar_sizes = [0.25, 0.35, 0.50, 0.75, 1.00, 1.50]
    px_centers = [-23.5, -21.2, -18.7, -15.9, -12.8, -9.2]
    # Pedestal pad for clean reference
    add(-25.0, -7.2, 2.5, 17.5, 1.40, 1.80)
    for cx, sz in zip(px_centers, pillar_sizes):
        hw = round(sz / 2.0, 4)
        # Tall row (Y = 14.0, height 2.40 mm above pedestal = Z 4.20 mm)
        add(cx - hw, cx + hw, 14.0 - hw, 14.0 + hw, 1.80, 4.20)
        # Short urban block row (Y = 9.5, height 1.20 mm above pedestal = Z 3.00 mm)
        add(cx - hw, cx + hw, 9.5 - hw, 9.5 + hw, 1.80, 3.00)
        # Thin wall / pier fin row (Y in [4.0, 7.0], thickness = sz, height 1.40 mm -> Z 3.20 mm)
        add(cx - hw, cx + hw, 4.0, 7.0, 1.80, 3.20)

    # -------------------------------------------------------------------------
    # ZONE C (Center): Negative Street Canyons & Inner Courtyards (Clear UV Bleed Test)
    # Block Z = [1.40, 2.80] mm; street & courtyard cuts down to Z = 1.60 mm (depth 1.20 mm)
    # Widths: 0.20, 0.30, 0.40, 0.60, 0.80, 1.00 mm
    # -------------------------------------------------------------------------
    add(-5.5, 8.5, -9.0, 14.0, 1.40, 2.80)
    gap_sizes = [0.20, 0.30, 0.40, 0.60, 0.80, 1.00]
    gx_centers = [-4.0, -2.2, -0.2, 2.0, 4.4, 7.0]
    for cx, gw in zip(gx_centers, gap_sizes):
        hw = round(gw / 2.0, 4)
        # Open street canyon (runs Y in [-9.0, +2.0], open at front Y=-9.0 so IPA drains easily)
        cut(cx - hw, cx + hw, -9.0, 2.0, 1.60, 2.90)
        # Enclosed square courtyard (centered at Y = 6.5, matching keyhole courtyards)
        sq = max(hw, 0.25)
        cut(cx - hw, cx + hw, 6.5 - sq, 6.5 + sq, 1.60, 2.90)
        # Through-hole drain courtyard (centered at Y = 11.2, goes all the way through? No, Z=1.40 blind well)
        cut(cx - hw, cx + hw, 11.2 - hw, 11.2 + hw, 1.40, 2.90)

    # -------------------------------------------------------------------------
    # ZONE D (Back-Right): Stepped DEM Terraces (0.15 & 0.25 mm) + LoD2 Pitched Roofs
    # -------------------------------------------------------------------------
    # 5 DEM contour steps along Y in [3.0, 15.5], X in [10.5, 17.5]
    dem_steps = [
        (3.0, 15.5, 1.40, 1.55),   # +0.15 mm (3 layers @ 0.05 mm)
        (5.5, 15.5, 1.55, 1.70),   # +0.15 mm
        (8.0, 15.5, 1.70, 1.95),   # +0.25 mm (5 layers @ 0.05 mm)
        (10.5, 15.5, 1.95, 2.20),  # +0.25 mm
        (13.0, 15.5, 2.20, 2.70),  # +0.50 mm (10 layers @ 0.05 mm)
    ]
    for y0, y1, z0, z1 in dem_steps:
        add(10.5, 17.5, y0, y1, z0, z1)

    # LoD2 Pyramidal & Gabled Roofs (X in [18.8, 24.8], quantized at 0.10 mm steps)
    # Building 1: Pyramidal roof tower (X in [19.0, 24.6], Y in [10.0, 15.6])
    add(19.0, 24.6, 10.0, 15.6, 1.40, 2.60)
    for k in range(1, 13):
        inset = round(k * 0.20, 4)
        add(
            19.0 + inset,
            24.6 - inset,
            10.0 + inset,
            15.6 - inset,
            round(2.60 + (k - 1) * 0.10, 4),
            round(2.60 + k * 0.10, 4),
        )

    # Building 2: Gabled roof block with courtyard (X in [19.0, 24.6], Y in [3.0, 8.6])
    add(19.0, 24.6, 3.0, 8.6, 1.40, 2.50)
    for k in range(1, 11):
        inset = round(k * 0.22, 4)
        add(
            19.0 + inset,
            24.6 - inset,
            3.0,
            8.6,
            round(2.50 + (k - 1) * 0.10, 4),
            round(2.50 + k * 0.10, 4),
        )

    # -------------------------------------------------------------------------
    # ZONE E (Front-Right): Unsupported Bridge Spans & Hollow Vault Ceiling Test
    # Spans: 1.50 mm, 3.00 mm, 4.50 mm clear gap, clearance Z in [1.40, 2.60] (1.20 mm),
    # deck thickness 0.80 mm (Z in [2.60, 3.40] mm)
    # -------------------------------------------------------------------------
    # Bridge 1 (span 1.50 mm): piers at X=[9.8, 11.0] and [12.5, 13.7]
    add(9.8, 11.0, -17.0, -11.5, 1.40, 3.40)
    add(12.5, 13.7, -17.0, -11.5, 1.40, 3.40)
    add(9.8, 13.7, -17.0, -11.5, 2.60, 3.40)

    # Bridge 2 (span 3.00 mm): piers at X=[15.0, 16.2] and [19.2, 20.4]
    add(15.0, 16.2, -17.0, -11.5, 1.40, 3.40)
    add(19.2, 20.4, -17.0, -11.5, 1.40, 3.40)
    add(15.0, 20.4, -17.0, -11.5, 2.60, 3.40)

    # Bridge 3 (span 4.50 mm — mimics Hollow Vault rib spacing!): piers at [10.5, 12.0] & [16.5, 18.0], Y in [-9.5, -4.5]
    add(10.5, 12.0, -9.5, -4.5, 1.40, 3.60)
    add(16.5, 18.0, -9.5, -4.5, 1.40, 3.60)
    add(10.5, 18.0, -9.5, -4.5, 2.60, 3.60)

    # -------------------------------------------------------------------------
    # ZONE F (Front-Center & Mid-Right): Dimensional & Kerf Gauge
    # Exact 10.00 x 6.00 mm outer calibration boss (X in [-7.5, +2.5], Y in [-17.0, -11.0])
    # with an exact 5.00 x 3.00 mm inner pocket -> tests XY shrinkage & Clear UV bleed
    # Plus an exact 6.00 x 6.00 mm reference cube at X in [19.0, 25.0], Y in [-9.5, -3.5]
    # -------------------------------------------------------------------------
    add(-7.5, 2.5, -17.0, -11.0, 1.40, 3.00)
    cut(-5.0, 0.0, -15.5, -12.5, 1.80, 3.10)

    # Exact 6.00 x 6.00 mm dimensional reference cube (height 4.00 mm total from Z=0!)
    add(19.0, 25.0, -9.5, -3.5, 1.40, 4.00)

    return xs, ys, ops


def build_corner_pad_commands(cx, cy, pip_count):
    """
    12.0 x 12.0 mm corner leveling sensor pad centered at (cx, cy):
      - Base Z = [0.00, 1.60] mm
      - Front pry chamfer on Y = cy - 6.0
      - Through Z=0 drain channel (width 2.00 mm, height 0.80 mm) running Y-axis
        so you can check Z=0 compression in all 4 corners of the build plate!
      - Tactile pip count (1=FL, 2=FR, 3=BL, 4=BR) raised to Z = 2.40 mm
    """
    ops = []
    xs = set()
    ys = set()

    def add(x0, x1, y0, y1, z0, z1):
        xs.update([x0, x1])
        ys.update([y0, y1])
        ops.append(("add", x0, x1, y0, y1, z0, z1))

    def cut(x0, x1, y0, y1, z0, z1):
        xs.update([x0, x1])
        ys.update([y0, y1])
        ops.append(("cut", x0, x1, y0, y1, z0, z1))

    x0, x1 = cx - 6.0, cx + 6.0
    y0, y1 = cy - 6.0, cy + 6.0
    add(x0, x1, y0, y1, 0.00, 1.60)

    # Front pry-lip chamfer (0.60 mm)
    cut(x0, x1, y0, y0 + 0.2, 0.00, 0.60)
    cut(x0, x1, y0 + 0.2, y0 + 0.4, 0.00, 0.40)
    cut(x0, x1, y0 + 0.4, y0 + 0.6, 0.00, 0.20)

    # Z=0 compression gauge tunnel (2.00 mm wide x 0.80 mm high right through the middle)
    cut(cx - 1.0, cx + 1.0, y0, y1, 0.00, 0.80)

    # Tactile identification pips (1.8 x 1.8 mm, Z = [1.60, 2.40] mm) placed on left/right wings
    pip_positions = [
        (cx - 3.5, cy + 2.5),  # 1: Front-Left (FL)
        (cx + 3.5, cy + 2.5),  # 2: Front-Right (FR)
        (cx - 3.5, cy - 2.2),  # 3: Back-Left (BL)
        (cx + 3.5, cy - 2.2),  # 4: Back-Right (BR)
    ]
    for px, py in pip_positions[:pip_count]:
        add(px - 0.9, px + 0.9, py - 0.9, py + 0.9, 1.60, 2.40)

    return xs, ys, ops


def compile_component(xs, ys, ops):
    builder = RectilinearManifoldBuilder(xs, ys)
    for kind, x0, x1, y0, y1, z0, z1 in ops:
        if kind == "add":
            builder.add_box(x0, x1, y0, y1, z0, z1)
        else:
            builder.cut_box(x0, x1, y0, y1, z0, z1)
    return builder.build_triangles()


def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)))

    # 1. Central Matrix Only
    c_xs, c_ys, c_ops = build_central_matrix_commands()
    center_tris = compile_component(c_xs, c_ys, c_ops)
    center_stats = audit_topology_and_volume(center_tris)
    assert center_stats["open_edges"] == 0, f"Open edges: {center_stats}"
    assert center_stats["non_manifold_edges"] == 0, f"Non-manifold edges: {center_stats}"

    center_path = os.path.join(out_dir, "etap1_tylko_matryca_srodek.stl")
    write_binary_stl(center_path, center_tris, "Etap 1 Center Matrix - Photon Mono 4 Clear")

    # 2. Full 5-Point Build Plate Test (Center Matrix + 4 Disjoint Corner Leveling Pads)
    # Outer span: X in [-66, +66] = 132.0 mm (<= 153.4 mm), Y in [-36, +36] = 72.0 mm (<= 87.0 mm)
    full_tris = list(center_tris)
    corners = [
        (-60.0, -30.0, 1),  # FL: 1 pip
        (60.0, -30.0, 2),   # FR: 2 pips
        (-60.0, 30.0, 3),   # BL: 3 pips
        (60.0, 30.0, 4),    # BR: 4 pips
    ]
    for cx, cy, pips in corners:
        pxs, pys, pops = build_corner_pad_commands(cx, cy, pips)
        ptris = compile_component(pxs, pys, pops)
        pstats = audit_topology_and_volume(ptris)
        assert pstats["open_edges"] == 0, f"Corner {pips} open edges: {pstats}"
        assert pstats["non_manifold_edges"] == 0, f"Corner {pips} non-manifold: {pstats}"
        full_tris.extend(ptris)

    full_stats = audit_topology_and_volume(full_tris)
    assert full_stats["open_edges"] == 0, f"Full open edges: {full_stats}"
    assert full_stats["non_manifold_edges"] == 0, f"Full non-manifold: {full_stats}"

    full_path = os.path.join(out_dir, "etap1_pelny_test_poziomu_i_ekspozycji.stl")
    write_binary_stl(full_path, full_tris, "Etap 1 Full 5-Point + Matrix - Photon Mono 4")

    print("=== ETAP 1: PODSUMOWANIE WYGENEROWANYCH MODELI STL ===")
    for label, path, st in [
        ("Pełny test 5-punktowy (Poziom + Ekspozycja)", full_path, full_stats),
        ("Tylko matryca centralna (Korekta ekspozycji)", center_path, center_stats),
    ]:
        bx = st["bbox_max"][0] - st["bbox_min"][0]
        by = st["bbox_max"][1] - st["bbox_min"][1]
        bz = st["bbox_max"][2] - st["bbox_min"][2]
        grams = st["volume_ml"] * 1.13  # Anycubic Standard Clear density = 1.13 g/cm3
        print(f"\n[{label}]")
        print(f"  Plik:       {path}")
        print(f"  Wymiary:    {bx:.2f} x {by:.2f} x {bz:.2f} mm (Z: {st['bbox_min'][2]:.2f}..{st['bbox_max'][2]:.2f} mm)")
        print(f"  Trójkąty:   {st['triangles']} | OpenEdges: {st['open_edges']} | NonManifold: {st['non_manifold_edges']}")
        print(f"  Żywica:     {st['volume_ml']:.2f} ml (~{grams:.1f} g przy gęstości 1.13 g/cm³)")
        print(f"  Warstwy:    {int(round(bz / 0.05))} warstw @ 0.05 mm (~18-22 min druku)")


if __name__ == "__main__":
    main()
