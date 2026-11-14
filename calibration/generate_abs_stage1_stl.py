#!/usr/bin/env python3
"""
Generate the Stage 1 watertight STL model for Anycubic Photon Mono 4 (10K) and ABS-Like White resin.

Output file:
  calibration/abs_stage1_calibration_and_gauge.stl (101.50 x 38.00 x 6.00 mm)

Components on the build plate:
  1. City calibration tile (38.00 x 38.00 x 6.00 mm):
     - Base slab (2.50 mm) with bottom release channels and perimeter chamfers.
     - Zone A (SW): Street slots (0.15, 0.20, 0.25, 0.35, 0.50 mm).
     - Zone B (NW): Square columns (0.35 to 1.00 mm), thin walls (0.25 to 0.80 mm), and 3 test trees.
     - Zone C (NE): Corner block (10.00 x 10.00 x 6.00 mm) with a Z=0 vertical relief shaft and 45-deg vault.
     - Zone D (SE): Reference 8.00 mm socket for tile-seam clearance keys.
  2. Three clearance keys (1 dot = 0.06 mm, 2 dots = 0.10 mm, 3 dots = 0.14 mm).
  3. Z-arm collar gauge (51.00 x 14.00 mm inner bore, 1.60 mm wall).
  4. Two Z-endstop clip spacers (2.70 mm offset, 1.30 mm and 1.65 mm slot widths).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_stage1_stl import (
    RectilinearManifoldBuilder,
    audit_topology_and_volume,
    write_binary_stl,
)


def make_ops_accumulator():
    ops = []
    xs = set()
    ys = set()

    def add(x0, x1, y0, y1, z0, z1):
        x0, x1 = round(float(x0), 4), round(float(x1), 4)
        y0, y1 = round(float(y0), 4), round(float(y1), 4)
        z0, z1 = round(float(z0), 4), round(float(z1), 4)
        if x1 - x0 > 1e-5 and y1 - y0 > 1e-5 and z1 - z0 > 1e-5:
            xs.update([x0, x1])
            ys.update([y0, y1])
            ops.append(("add", x0, x1, y0, y1, z0, z1))

    def cut(x0, x1, y0, y1, z0, z1):
        x0, x1 = round(float(x0), 4), round(float(x1), 4)
        y0, y1 = round(float(y0), 4), round(float(y1), 4)
        z0, z1 = round(float(z0), 4), round(float(z1), 4)
        if x1 - x0 > 1e-5 and y1 - y0 > 1e-5 and z1 - z0 > 1e-5:
            xs.update([x0, x1])
            ys.update([y0, y1])
            ops.append(("cut", x0, x1, y0, y1, z0, z1))

    def anti_elephant_perimeter(x0, x1, y0, y1):
        """Cut a 0.38 mm step on Z=0.00..0.28 mm and a 0.20 mm step on Z=0.28..0.52 mm."""
        cut(x0, x0 + 0.38, y0, y1, 0.00, 0.28)
        cut(x0, x0 + 0.20, y0, y1, 0.28, 0.52)
        cut(x1 - 0.38, x1, y0, y1, 0.00, 0.28)
        cut(x1 - 0.20, x1, y0, y1, 0.28, 0.52)
        cut(x0, x1, y0, y0 + 0.38, 0.00, 0.28)
        cut(x0, x1, y0, y0 + 0.20, 0.28, 0.52)
        cut(x0, x1, y1 - 0.38, y1, 0.00, 0.28)
        cut(x0, x1, y1 - 0.20, y1, 0.28, 0.52)

    return xs, ys, ops, add, cut, anti_elephant_perimeter


def append_city_calibration_tile(add, cut, anti_elephant_perimeter, cx=-32.0, cy=0.0):
    """Build the 38.00 x 38.00 x 6.00 mm city calibration tile centered at (cx, cy)."""
    tx0, tx1 = cx - 19.0, cx + 19.0
    ty0, ty1 = cy - 19.0, cy + 19.0
    z_base = 2.50

    # Add the 2.50 mm base slab.
    add(tx0, tx1, ty0, ty1, 0.00, z_base)

    # Cut bottom release channels (1.80 mm wide x 0.85 mm high).
    for k in range(8):
        gx0 = tx0 + 3.70 + k * 3.80
        gx1 = gx0 + 1.80
        if gx1 <= tx1 - 3.50:
            cut(gx0, gx1, ty0 + 2.80, ty1 - 2.80, 0.00, 0.85)

    # Cut cross-vent channels to the West, North, and South edges.
    for vy in (cy - 10.5, cy, cy + 10.5):
        cut(tx0, tx1 - 2.80, vy - 0.90, vy + 0.90, 0.00, 0.85)
    cut(cx - 6.60, cx - 4.80, ty0, ty1, 0.00, 0.85)
    cut(cx + 4.80, cx + 6.60, ty0 + 7.50, ty1, 0.00, 0.85)

    # Cut stepped release recesses on the West and South edges.
    cut(tx0, tx0 + 0.80, cy - 5.5, cy + 5.5, 0.00, 1.20)
    cut(tx0 + 0.80, tx0 + 1.60, cy - 5.5, cy + 5.5, 0.00, 0.80)
    cut(cx - 11.5, cx - 1.5, ty0, ty0 + 0.80, 0.00, 1.20)
    cut(cx - 11.5, cx - 1.5, ty0 + 0.80, ty0 + 1.60, 0.00, 0.80)

    # Apply perimeter bottom chamfers.
    anti_elephant_perimeter(tx0, tx1, ty0, ty1)

    # Zone A (SW): Street slots (0.15, 0.20, 0.25, 0.35, 0.50 mm).
    ax0, ax1 = tx0 + 1.80, cx - 1.20
    ay0, ay1 = ty0 + 2.40, cy - 1.50
    add(ax0, ax1, ay0, ay1, z_base, 4.60)

    street_widths = [0.15, 0.20, 0.25, 0.35, 0.50]
    street_centers = [ax0 + 2.30 + i * 2.85 for i in range(5)]
    for idx, (sx, sw) in enumerate(zip(street_centers, street_widths)):
        hw = round(sw * 0.5, 4)
        cut(sx - hw, sx + hw, ay0, ay1 - 2.00, z_base, 4.70)
        add(sx - 0.35, sx + 0.35, ay1 - 1.40, ay1 - 0.40, 4.60, 5.05)

    # Zone B (NW): Columns (0.35 to 1.00 mm), thin walls (0.25 to 0.80 mm), and 3 test trees.
    bx0 = tx0 + 2.40
    pillar_sizes = [0.35, 0.45, 0.55, 0.70, 1.00]
    for i, psz in enumerate(pillar_sizes):
        px = bx0 + i * 3.40
        hp = round(psz * 0.5, 4)
        add(px - hp, px + hp, ty1 - 3.60 - hp, ty1 - 3.60 + hp, z_base, 5.10)
        add(px - hp, px + hp, ty1 - 7.00 - hp, ty1 - 7.00 + hp, z_base, 4.10)

    wall_thicknesses = [0.25, 0.35, 0.45, 0.60, 0.80]
    for i, wt in enumerate(wall_thicknesses):
        wx = bx0 + i * 3.40
        hw = round(wt * 0.5, 4)
        add(wx - hw, wx + hw, cy + 5.60, cy + 9.80, z_base, 4.60)

    add(bx0 - 0.80, bx0 + 14.20, cy + 0.60, cy + 4.40, z_base, 2.85)
    for i, (tw, cw, zc) in enumerate([(0.65, 1.55, 4.45), (0.80, 1.85, 4.65), (0.95, 2.15, 4.85)]):
        trx = bx0 + 1.80 + i * 4.80
        try_ = cy + 2.50
        ht = round(tw * 0.5, 4)
        hc = round(cw * 0.5, 4)
        hm = round((ht + hc) * 0.5, 4)
        add(trx - ht, trx + ht, try_ - ht, try_ + ht, 2.85, 3.55)
        add(trx - hm, trx + hm, try_ - hm, try_ + hm, 3.55, 3.75)
        add(trx - hc, trx + hc, try_ - hc, try_ + hc, 3.75, round(zc - 0.20, 4))
        add(trx - hm, trx + hm, try_ - hm, try_ + hm, round(zc - 0.20, 4), zc)

    # Zone C (NE): 10.00 x 10.00 x 6.00 mm block with a Z=0 relief shaft and 45-deg stepped vault.
    cx0, cx1 = tx1 - 11.20, tx1 - 1.20
    cy0, cy1 = ty1 - 11.20, ty1 - 1.20
    add(cx0, cx1, cy0, cy1, z_base, 6.00)

    sh_x0, sh_x1 = cx0 + 2.00, cx1 - 2.00
    sh_y0, sh_y1 = cy0 + 2.00, cy1 - 2.00
    cut(sh_x0, sh_x1, sh_y0, sh_y1, 0.00, 1.90)
    cut(cx0 - 1.50, sh_x0, 0.5 * (sh_y0 + sh_y1) - 0.90, 0.5 * (sh_y0 + sh_y1) + 0.90, 0.00, 0.85)
    cut(0.5 * (sh_x0 + sh_x1) - 0.90, 0.5 * (sh_x0 + sh_x1) + 0.90, cy0 - 1.50, sh_y0, 0.00, 0.85)

    for step in range(1, 20):
        ins = round(step * 0.15, 4)
        vx0, vx1 = round(sh_x0 + ins, 4), round(sh_x1 - ins, 4)
        vy0, vy1 = round(sh_y0 + ins, 4), round(sh_y1 - ins, 4)
        vz0 = round(1.90 + (step - 1) * 0.15, 4)
        vz1 = round(1.90 + step * 0.15, 4)
        if vx1 - vx0 >= 0.25 and vy1 - vy0 >= 0.25:
            cut(vx0, vx1, vy0, vy1, vz0, vz1)
    cut(cx0 + 1.20, cx1 - 1.20, cy0 + 1.20, cy1 - 1.20, 5.65, 6.05)

    # Zone D (SE): Reference 8.00 mm socket for tile-seam clearance keys.
    dx0, dx1 = cx + 0.80, tx1 - 1.20
    dy0, dy1 = ty0 + 1.80, cy + 4.20
    add(dx0, dx1, dy0, dy1, z_base, 4.80)

    slot_y0 = round(dy0 + 6.70, 4)
    slot_y1 = round(slot_y0 + 8.00, 4)
    slot_x0 = round(tx1 - 8.20, 4)
    cut(slot_x0, tx1 + 0.10, slot_y0, slot_y1, 1.35, 4.90)


def append_kerf_keys(add, cut, anti_elephant_perimeter):
    """
    Build 3 clearance test keys (1 dot = 0.06 mm, 2 dots = 0.10 mm, 3 dots = 0.14 mm)
    for the 8.00 mm reference socket in Zone D.
    """
    specs = [
        (1, 0.06, -6.0),
        (2, 0.10, 6.8),
        (3, 0.14, 19.6),
    ]
    for dots, kerf, x_left in specs:
        tongue_w = round(8.00 - kerf, 4)
        xc = round(x_left + 5.20, 4)
        hx0, hx1 = round(xc - 5.20, 4), round(xc + 5.20, 4)
        hy0, hy1 = -19.00, -11.50
        tx0, tx1 = round(xc - tongue_w * 0.5, 4), round(xc + tongue_w * 0.5, 4)
        ty0, ty1 = -11.50, -4.50

        add(hx0, hx1, hy0, hy1, 0.00, 3.20)
        add(tx0, tx1, ty0, ty1, 0.00, 3.20)
        add(hx0 + 1.40, hx1 - 1.40, hy0 + 1.20, hy0 + 3.40, 3.20, 4.50)

        cut(hx0, hx0 + 0.38, hy0, hy1, 0.00, 0.52)
        cut(hx1 - 0.38, hx1, hy0, hy1, 0.00, 0.52)
        cut(hx0, hx1, hy0, hy0 + 0.38, 0.00, 0.52)
        cut(tx0, tx0 + 0.38, ty0, ty1, 0.00, 0.52)
        cut(tx1 - 0.38, tx1, ty0, ty1, 0.00, 0.52)
        cut(tx0, tx1, ty1 - 0.38, ty1, 0.00, 0.52)
        cut(xc - 0.90, xc + 0.90, hy0 + 1.80, ty1 - 1.50, 0.00, 0.80)

        start_dx = xc - (dots - 1) * 1.30
        for d in range(dots):
            dx = round(start_dx + d * 2.60, 4)
            add(dx - 0.65, dx + 0.65, -14.30, -13.00, 3.20, 4.00)


def append_drain_bracket_arm_gauge(add, cut):
    """
    Build a 1:1 collar gauge for the Photon Mono 4 Z-arm socket (51.00 x 14.00 mm inner bore,
    54.20 x 17.20 mm outer dimensions, 4.80 mm height).
    """
    gx0, gx1 = -6.00, 48.20
    gy0, gy1 = 1.80, 19.00
    ix0, ix1 = -4.40, 46.60
    iy0, iy1 = 3.40, 17.40

    add(gx0, gx1, gy0, gy1, 0.00, 4.80)
    cut(ix0, ix1, iy0, iy1, 0.00, 4.90)

    # Add a grip tab on the East end.
    add(gx1, gx1 + 2.30, gy0 + 4.60, gy1 - 4.60, 0.85, 4.80)

    # Cut bottom edge chamfers on inner and outer walls.
    cut(gx0, gx0 + 0.30, gy0, gy1, 0.00, 0.30)
    cut(gx1 - 0.30, gx1, gy0, gy1, 0.00, 0.30)
    cut(gx0, gx1, gy0, gy0 + 0.30, 0.00, 0.30)
    cut(gx0, gx1, gy1 - 0.30, gy1, 0.00, 0.30)

    cut(ix0 - 0.30, ix0, iy0 - 0.30, iy1 + 0.30, 0.00, 0.30)
    cut(ix1, ix1 + 0.30, iy0 - 0.30, iy1 + 0.30, 0.00, 0.30)
    cut(ix0 - 0.30, ix1 + 0.30, iy0 - 0.30, iy0, 0.00, 0.30)
    cut(ix0 - 0.30, ix1 + 0.30, iy1, iy1 + 0.30, 0.00, 0.30)

    cut(ix0 - 0.15, ix0, iy0 - 0.15, iy1 + 0.15, 0.30, 0.55)
    cut(ix1, ix1 + 0.15, iy0 - 0.15, iy1 + 0.15, 0.30, 0.55)
    cut(ix0 - 0.15, ix1 + 0.15, iy0 - 0.15, iy0, 0.30, 0.55)
    cut(ix0 - 0.15, ix1 + 0.15, iy1, iy1 + 0.15, 0.30, 0.55)


def append_koyofei_z_spacers(add, cut):
    """
    Build two clip-on Z-endstop spacers (2.70 mm offset along Y, 0.017 mm XY pixel resolution).
    Clip 1 (1 dot) has a 1.30 mm slot width. Clip 2 (2 dots) has a 1.65 mm slot width.
    """
    clips = [
        (1, 1.30, 33.20, -19.00),
        (2, 1.65, 42.60, -19.00),
    ]
    for dots, slot_w, x0, y0 in clips:
        wall = 1.60
        total_w = round(2 * wall + slot_w, 4)
        x1 = round(x0 + total_w, 4)
        y_ext = round(y0 + 2.70, 4)
        y1 = round(y0 + 12.00, 4)

        add(x0, x1, y0, y1, 0.00, 5.40)
        sx0 = round(x0 + wall, 4)
        sx1 = round(sx0 + slot_w, 4)
        cut(sx0, sx1, y_ext, y1 + 0.10, 0.00, 5.50)

        cut(sx0 - 0.22, sx0, y_ext, y1 + 0.10, 0.00, 0.45)
        cut(sx1, sx1 + 0.22, y_ext, y1 + 0.10, 0.00, 0.45)
        cut(x0, x1, y0, y0 + 0.25, 0.00, 0.35)

        # Add dot markers to identify the 1.30 mm (1 dot) and 1.65 mm (2 dots) slots.
        xc = 0.5 * (x0 + x1)
        start_d = xc - (dots - 1) * 0.90
        for d in range(dots):
            dx = round(start_d + d * 1.80, 4)
            add(dx - 0.45, dx + 0.45, y0 + 0.80, y0 + 1.80, 5.40, 5.95)


def compile_mesh(xs, ys, ops):
    builder = RectilinearManifoldBuilder(xs, ys)
    for kind, x0, x1, y0, y1, z0, z1 in ops:
        if kind == "add":
            builder.add_box(x0, x1, y0, y1, z0, z1)
        else:
            builder.cut_box(x0, x1, y0, y1, z0, z1)
    return builder.build_triangles()


def build_part(fn, *args):
    xs, ys, ops, add, cut, aef = make_ops_accumulator()
    fn(add, cut, aef, *args)
    return compile_mesh(xs, ys, ops)


def main():
    out_dir = os.path.dirname(os.path.abspath(__file__))

    # Compile each disjoint part on its own coordinate grid to minimize triangle count.
    tile_tris = build_part(append_city_calibration_tile, -32.0, 0.0)
    keys_tris = build_part(append_kerf_keys)
    gauge_tris = build_part(lambda add, cut, _aef: append_drain_bracket_arm_gauge(add, cut))
    spacer_tris = build_part(lambda add, cut, _aef: append_koyofei_z_spacers(add, cut))

    full_tris = tile_tris + keys_tris + gauge_tris + spacer_tris
    stats = audit_topology_and_volume(full_tris)
    full_path = os.path.join(out_dir, "abs_stage1_calibration_and_gauge.stl")
    write_binary_stl(
        full_path,
        full_tris,
        header_text="ABS-Like White Stage 1: City + Kerf + Mono4 51x14 Gauge + Z-Spacer 2.7mm",
    )

    span_x = stats["bbox_max"][0] - stats["bbox_min"][0]
    span_y = stats["bbox_max"][1] - stats["bbox_min"][1]
    span_z = stats["bbox_max"][2] - stats["bbox_min"][2]

    print("=== STAGE 1 (ABS-LIKE WHITE) TOPOLOGY AND DIMENSION REPORT ===")
    print(f"File: {full_path}")
    print(f"Triangles: {stats['triangles']}")
    print(
        f"Bounding box: {span_x:.2f} x {span_y:.2f} x {span_z:.2f} mm "
        f"(Z: {stats['bbox_min'][2]:.2f}..{stats['bbox_max'][2]:.2f} mm | Mono 4 limit: 153.4 x 87.0 x 165.0 mm)"
    )
    print(f"Resin volume: {stats['volume_ml']:.2f} ml (~{stats['volume_ml']*1.12:.1f} g)")
    print(
        f"OpenEdges: {stats['open_edges']} | NonManifoldEdges: {stats['non_manifold_edges']}"
    )
    assert stats["open_edges"] == 0, f"ERROR: open_edges={stats['open_edges']}"
    assert stats["non_manifold_edges"] == 0, f"ERROR: non_manifold_edges={stats['non_manifold_edges']}"
    assert span_x <= 150.0 and span_y <= 84.0, "ERROR: Build volume limit exceeded."
    print("STATUS: 2-MANIFOLD VERIFIED. READY FOR SLICING.")


if __name__ == "__main__":
    main()
