#!/usr/bin/env python3
"""
Generate the Full-Bed Flex Plate and VAT Calibration STL (0.100 mm layer profile)
for Anycubic Photon Mono 4 (10K, 153.4 x 87.0 x 165.0 mm).

Output file:
  calibration/abs_flexplate_bed_calibration_010mm.stl

Outer envelope:
  145.00 x 79.00 x 4.00 mm (centered at XY = 0, 0).
  Safety margins to the 153.4 x 87.0 mm LCD boundary:
    - Left / Right (-X / +X): 4.20 mm (0.42 cm)
    - Front / Back (-Y / +Y): 4.00 mm (0.40 cm)

Layout (9 independent 2-manifold modules, minimum XY separation 20.50 mm):
  1. NW corner (-72.5..-56.5, +27.5..+39.5): 1 pip, 2.00 mm Z flat, Z-step staircase (1..4 mm).
  2. NE corner (+56.5..+72.5, +27.5..+39.5): 2 pips, 2.00 mm Z flat, positive walls (0.40..1.40 mm).
  3. SW corner (-72.5..-56.5, -39.5..-27.5): 3 pips, 2.00 mm Z flat, negative slots (0.25..0.70 mm).
  4. SE corner (+56.5..+72.5, -39.5..-27.5): 4 pips, 2.00 mm Z flat, freestanding spires (0.60..1.80 mm).
  5. W edge    (-72.5..-56.5,  -6.0..+6.0):  16.00 x 12.00 mm XY caliper block + 6.00 mm open U-slot.
  6. E edge    (+56.5..+72.5,  -6.0..+6.0):  vented open-channel mini-waffle (1.30 mm vent ceiling).
  7. N edge    (-13.0..+13.0, +27.5..+39.5): back marker + 2.0/3.0/4.0 mm drain-channel bridges (Z=1.80 mm).
  8. S edge    (-12.0..+12.0, -39.5..-27.5): front marker + 45-deg layer-matched overhang ramp + 2.00 mm flat.
  9. C center  (-22.0..+22.0,  -7.0..+7.0):  40.00 mm caliper bar, 0.50..4.00 mm Z-zero steps, vented mini city block.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_stage1_stl import (
    RectilinearManifoldBuilder,
    audit_topology_and_volume,
    write_binary_stl,
)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def build_module(ops):
    """Build one clean 2-manifold rectilinear shell from ('add'|'cut', x0, x1, y0, y1, z0, z1) ops."""
    xs = []
    ys = []
    for _, x0, x1, y0, y1, _, _ in ops:
        xs.extend((x0, x1))
        ys.extend((y0, y1))
    b = RectilinearManifoldBuilder(xs, ys)
    for kind, x0, x1, y0, y1, z0, z1 in ops:
        if kind == "add":
            b.add_box(x0, x1, y0, y1, z0, z1)
        elif kind == "cut":
            b.cut_box(x0, x1, y0, y1, z0, z1)
        else:
            raise ValueError(f"Unknown op kind: {kind}")
    return b.build_triangles()


def add_corner_pips(ops, x_start, y_top, count):
    """Add 1 to 4 raised identification pips (1.8 x 1.8 mm) along X so corners stay identifiable."""
    for idx in range(count):
        px0 = x_start + idx * 2.8
        ops.append(("add", px0, px0 + 1.8, y_top - 2.6, y_top - 0.8, 2.0, 3.4))


def build_nw_corner():
    """NW corner (1 pip): 2.00 mm leveling flat + 1.00/2.00/3.00/4.00 mm Z-compression staircase."""
    x0, x1 = -72.5, -56.5
    y0, y1 = 27.5, 39.5
    ops = [
        ("add", x0, x1, y0, y1, 0.0, 2.0),
        # Outer NW corner pointer L-rim at Z=2.0..2.8
        ("add", x0, x0 + 3.5, y1 - 1.2, y1, 2.0, 2.8),
        ("add", x0, x0 + 1.2, y1 - 3.5, y1, 2.0, 2.8),
        # Cut 1.00 mm step open to the -Y edge (easy caliper access, zero closed pocket)
        ("cut", x0 + 1.5, x0 + 4.7, y0, y0 + 5.5, 1.0, 2.0),
        # 2.00 mm step sits at x0+4.7..x0+7.9 (already Z=2.0)
        # 3.00 mm step
        ("add", x0 + 7.9, x0 + 11.1, y0 + 1.0, y0 + 5.5, 2.0, 3.0),
        # 4.00 mm step
        ("add", x0 + 11.1, x0 + 14.5, y0 + 1.0, y0 + 5.5, 2.0, 4.0),
    ]
    add_corner_pips(ops, x0 + 4.5, y1, 1)
    return build_module(ops)


def build_ne_corner():
    """NE corner (2 pips): 2.00 mm leveling flat + positive thin walls (0.40..1.40 mm)."""
    x0, x1 = 56.5, 72.5
    y0, y1 = 27.5, 39.5
    ops = [
        ("add", x0, x1, y0, y1, 0.0, 2.0),
        # Outer NE corner pointer L-rim
        ("add", x1 - 3.5, x1, y1 - 1.2, y1, 2.0, 2.8),
        ("add", x1 - 1.2, x1, y1 - 3.5, y1, 2.0, 2.8),
    ]
    add_corner_pips(ops, x0 + 1.2, y1, 2)
    # 5 positive thin walls along X at Y = y0+1.0..y0+6.0, Z = 2.0..4.0
    widths = [0.40, 0.60, 0.80, 1.00, 1.40]
    cx = x0 + 1.4
    for w in widths:
        ops.append(("add", cx, round(cx + w, 4), y0 + 1.0, y0 + 6.0, 2.0, 4.0))
        cx = round(cx + w + 1.8, 4)
    return build_module(ops)


def build_sw_corner():
    """SW corner (3 pips): 2.00 mm leveling flat + negative slit array (0.25..0.70 mm)."""
    x0, x1 = -72.5, -56.5
    y0, y1 = -39.5, -27.5
    ops = [
        ("add", x0, x1, y0, y1, 0.0, 2.0),
        # Outer SW corner pointer L-rim
        ("add", x0, x0 + 3.5, y0, y0 + 1.2, 2.0, 2.8),
        ("add", x0, x0 + 1.2, y0, y0 + 3.5, 2.0, 2.8),
        # Solid slit carrier block on upper half (Z=2.0..4.0)
        ("add", x0 + 1.5, x1 - 1.5, y1 - 5.2, y1 - 0.8, 2.0, 4.0),
    ]
    # 4 calibrated negative slits cut down to Z=2.00 mm
    slits = [0.25, 0.35, 0.50, 0.70]
    cx = x0 + 3.1
    for sw in slits:
        ops.append(("cut", cx, round(cx + sw, 4), y1 - 5.2, y1 - 0.8, 2.0, 4.0))
        cx = round(cx + sw + 2.1, 4)
    add_corner_pips(ops, x0 + 4.5, y0 + 3.4, 3)
    return build_module(ops)


def build_se_corner():
    """SE corner (4 pips): 2.00 mm leveling flat + freestanding spires (0.60..1.80 mm)."""
    x0, x1 = 56.5, 72.5
    y0, y1 = -39.5, -27.5
    ops = [
        ("add", x0, x1, y0, y1, 0.0, 2.0),
        # Outer SE corner pointer L-rim
        ("add", x1 - 3.5, x1, y0, y0 + 1.2, 2.0, 2.8),
        ("add", x1 - 1.2, x1, y0, y0 + 3.5, 2.0, 2.8),
    ]
    add_corner_pips(ops, x0 + 1.0, y0 + 3.4, 4)
    # 5 freestanding square spires along upper strip (Z=2.0..4.0)
    sizes = [0.60, 0.80, 1.00, 1.40, 1.80]
    cx = x0 + 1.2
    yc = y1 - 3.0
    for s in sizes:
        ops.append(("add", cx, round(cx + s, 4), round(yc - 0.5 * s, 4), round(yc + 0.5 * s, 4), 2.0, 4.0))
        cx = round(cx + s + 1.6, 4)
    return build_module(ops)


def build_west_edge():
    """W edge: precision 16.00 x 12.00 mm XY caliper block + open 6.00 x 6.00 mm U-slot."""
    x0, x1 = -72.5, -56.5
    y0, y1 = -6.0, 6.0
    ops = [
        # Full 16.00 x 12.00 mm base up to Z=3.00 mm for caliper measurement at Z=0 and Z=2.5
        ("add", x0, x1, y0, y1, 0.0, 3.0),
        # Open-ended 6.00 x 6.00 mm U-slot facing +X (zero suction cup, tests internal caliper width)
        ("cut", x1 - 6.0, x1, -3.0, 3.0, 0.0, 3.0),
        # Single left-edge orientation rib (Z=3.0..3.8)
        ("add", x0 + 1.2, x0 + 2.8, -4.0, 4.0, 3.0, 3.8),
    ]
    return build_module(ops)


def build_east_edge():
    """E edge: vented open-channel mini-waffle (1.30 mm air vents above 1.10 mm transition zone)."""
    x0, x1 = 56.5, 72.5
    y0, y1 = -6.0, 6.0
    ops = [
        # Solid deck Z=0.0..3.0
        ("add", x0, x1, y0, y1, 0.0, 3.0),
        # Unified perimeter ribs on -X and +X (2.2 mm wide); two 3.6 mm wide internal pockets
        # connected by a 3.6 mm wide cross-vent open to both +Y and -Y edges
        ("cut", x0 + 2.2, x1 - 2.2, -3.6, -1.0, 0.0, 1.3),
        ("cut", x0 + 2.2, x1 - 2.2, 1.0, 3.6, 0.0, 1.3),
        ("cut", x0 + 6.2, x0 + 9.8, y0, y1, 0.0, 1.3),
        # Double right-edge orientation ribs on top deck (Z=3.0..3.8)
        ("add", x1 - 2.6, x1 - 1.2, -4.0, 4.0, 3.0, 3.8),
        ("add", x1 - 4.8, x1 - 3.4, -4.0, 4.0, 3.0, 3.8),
    ]
    return build_module(ops)


def build_north_edge():
    """N edge (back): 3 vented drain-channel bridges (2.0, 3.0, 4.0 mm wide, Z=1.80 mm ceiling)."""
    x0, x1 = -13.0, 13.0
    y0, y1 = 27.5, 39.5
    ops = [
        # Main bridge body Z=0.0..3.20 (outer Z=0 piers are 4.50 mm wide, inner piers 4.00 mm wide)
        ("add", x0, x1, y0, y1, 0.0, 3.2),
        # Tunnel 1: 2.00 mm wide (X = -8.5..-6.5)
        ("cut", -8.5, -6.5, y0, y1, 0.0, 1.8),
        # Tunnel 2: 3.00 mm wide (X = -2.5..+0.5)
        ("cut", -2.5, 0.5, y0, y1, 0.0, 1.8),
        # Tunnel 3: 4.00 mm wide (X = +4.5..+8.5)
        ("cut", 4.5, 8.5, y0, y1, 0.0, 1.8),
        # Back-edge orientation bar along Y=39.5 (Z=3.2..4.0)
        ("add", -4.0, 4.0, y1 - 1.6, y1, 3.2, 4.0),
    ]
    return build_module(ops)


def build_south_edge():
    """S edge (front): front orientation lip + layer-matched 45-deg overhang ramp + 2.00 mm flat."""
    x0, x1 = -12.0, 12.0
    y0, y1 = -39.5, -27.5
    ops = [
        # Base 2.00 mm flat across entire module
        ("add", x0, x1, y0, y1, 0.0, 2.0),
        # Wide FRONT marker bar along Y=-39.5 (Z=2.0..2.8)
        ("add", -10.0, 10.0, y0, y0 + 1.5, 2.0, 2.8),
        # Anchor tower for 45-deg ascending ramp overhang (X = -10.0..-4.0)
        ("add", -10.0, -4.0, y0 + 3.0, y1 - 1.2, 2.0, 4.0),
    ]
    # 20 layer-matched 45-deg overhang steps (+0.10 mm in +X per +0.10 mm in +Z at 0.100 mm layer thickness)
    for k in range(1, 21):
        z_lo = round(2.0 + (k - 1) * 0.10, 4)
        x_hi = round(-4.0 + k * 0.10, 4)
        ops.append(("add", -4.0, x_hi, y0 + 3.0, y1 - 1.2, z_lo, 4.0))
    # Right half (X = +1.0..+10.5) remains a clean 2.00 mm caliper leveling pad
    return build_module(ops)


def build_center_master():
    """
    C center master gauge (44.00 x 14.00 x 4.00 mm):
      - Exact 40.00 mm outer caliper reference stops at Z=2.0..3.6 (immune to Z=0 elephant foot).
      - Center 2.00 mm caliper leveling flat (compare directly against NW, NE, SW, SE).
      - Z-zero staircase: 0.50 / 1.00 / 1.50 / 2.00 / 3.00 / 4.00 mm (0.50 mm = 5 bottom layers).
      - Mini architectural city block (0.50 / 0.80 mm walls, 0.25 / 0.40 mm street alleys).
    """
    x0, x1 = -22.0, 22.0
    y0, y1 = -7.0, 7.0
    ops = [
        ("add", x0, x1, y0, y1, 0.0, 2.0),
        # Precision 40.00 mm X-caliper reference stops along front strip (X = -20.00..+20.00)
        ("add", -20.0, -18.0, y0 + 0.8, y0 + 3.8, 2.0, 3.6),
        ("add", 18.0, 20.0, y0 + 0.8, y0 + 3.8, 2.0, 3.6),
        # Z-zero compression staircase open to +Y edge for direct caliper access and zero pockets
        # 0.50 mm step (cut down from 2.00 to 0.50)
        ("cut", -19.5, -16.9, 0.5, y1, 0.5, 2.0),
        # 1.00 mm step
        ("cut", -16.9, -14.3, 0.5, y1, 1.0, 2.0),
        # 1.50 mm step
        ("cut", -14.3, -11.7, 0.5, y1, 1.5, 2.0),
        # 2.00 mm step sits at -11.7..-9.1
        # 3.00 mm step
        ("add", -9.1, -6.3, 0.5, y1, 2.0, 3.0),
        # 4.00 mm step
        ("add", -6.3, -3.5, 0.5, y1, 2.0, 4.0),
        # Center caliper leveling flat occupies X = -3.0..+6.5, Y = -2.5..+6.0 (pure Z = 2.00 mm)
        # Mini city architectural cluster occupies X = +7.5..+19.5, Y = -1.5..+6.0
        # Rowhouse 1 (0.50 mm wall)
        ("add", 7.5, 8.0, -1.5, 5.5, 2.0, 3.6),
        # 0.25 mm street alley -> Rowhouse 2 (0.80 mm wall)
        ("add", 8.25, 9.05, -1.5, 5.5, 2.0, 3.8),
        # 0.40 mm street alley -> Vented courtyard block (outer 4.2 x 5.2 mm, 1.8 x 2.4 mm court, 0.80 mm south gate)
        ("add", 9.45, 13.65, -0.5, 4.7, 2.0, 3.4),
        ("cut", 10.65, 12.45, 0.9, 3.3, 2.0, 3.4),
        ("cut", 11.15, 11.95, -0.5, 0.9, 2.0, 3.4),
        # Stepped landmark tower (Z = 4.00 mm)
        ("add", 14.4, 18.8, -0.5, 4.7, 2.0, 3.2),
        ("add", 15.4, 17.8, 0.5, 3.7, 3.2, 4.0),
    ]
    return build_module(ops)


def main():
    modules = [
        ("NW", build_nw_corner()),
        ("NE", build_ne_corner()),
        ("SW", build_sw_corner()),
        ("SE", build_se_corner()),
        ("W", build_west_edge()),
        ("E", build_east_edge()),
        ("N", build_north_edge()),
        ("S", build_south_edge()),
        ("C", build_center_master()),
    ]
    all_tris = []
    for name, tris in modules:
        all_tris.extend(tris)
        print(f"Module {name:2s}: {len(tris):5d} triangles")

    out_path = os.path.join(REPO_ROOT, "calibration", "abs_flexplate_bed_calibration_010mm.stl")
    write_binary_stl(
        out_path,
        all_tris,
        "Anycubic Photon Mono 4 Full-Bed Flex Plate Calibration 145x79x4mm 2-Manifold",
    )
    audit = audit_topology_and_volume(all_tris)
    print(f"Written: {out_path}")
    print(f"Audit: {audit}")


if __name__ == "__main__":
    main()
