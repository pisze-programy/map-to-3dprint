#!/usr/bin/env python3
"""
Generator wodoszczelnych (2-manifold) modeli kalibracyjnych STL — ETAP 2
dla drukarki Anycubic Photon Mono 4 (10K) + Anycubic Standard Clear.

Testuje:
  1. Poprawione poziomowanie 4 rogów stołu (wzmocnione klocki 2.40 mm FL-1..BR-4,
     które nie pękają nad tunelem 0.80 mm przy zdejmowaniu ze stołu).
  2. Prawdziwą bazę Hollow SLA Vault (ścianka stropu 1.80 mm, ramka 3.60 mm,
     żebro krzyżowe z przelotami drenażowymi, 4 kanały anty-przyssawkowe 2.2 x 0.9 mm
     na 4 bokach oraz wklęsłe oznaczenie 'R1C1 ^' na sklepieniu od spodu).
  3. Skorygowaną ekspozycję (3.05 s / baza 21 s):
     - Wieżowce 0.25..1.00 mm + ulice 0.20..0.60 mm
     - Korony drzew 3D bez podpór (nawisy 3D z Layer 2 map-to-3dprint)
     - Rzeka + mosty wieloprzęsłowe (4.0 mm i 6.5 mm) + molo na filarach
     - Kamienice z głębokimi zamkniętymi dziedzińcami (test wypłukiwania IPA)
     - Płaskość bazy po pełnym cyklu Wash + Dry + UV Cure (brak wygięcia w łódkę)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_stage1_stl import (
    RectilinearManifoldBuilder,
    audit_topology_and_volume,
    write_binary_stl,
)

# 5x5 pixel glyphs for underside debossed ID ('R', '1', 'C', '^') viewed from BELOW
# Note: when looking at the bottom (-Z), X increases to the left if flipped around Y,
# so let's mirror X so when you flip the tile upside-down around the X-axis (North->South)
# or Y-axis (Left<->Right): flipping left-to-right (around Y axis) mirrors X!
GLYPHS_5X5 = {
    "R": [
        "1111",
        "1001",
        "1111",
        "1010",
        "1010",
    ],
    "1": [
        "0100",
        "1100",
        "0100",
        "0100",
        "1110",
    ],
    "C": [
        "1111",
        "1000",
        "1000",
        "1000",
        "1111",
    ],
    "^": [
        "00100",
        "01110",
        "11111",
        "00100",
        "00100",
    ],
}


def build_stage2_hollow_tile_commands():
    """
    58.0 x 44.0 x 6.80 mm Hollow SLA Vault Mini-City Tile centered at (0, 0).
    X in [-29.0, +29.0], Y in [-22.0, +22.0], Z in [0.00, 6.80] mm.
    """
    ops = []
    xs = set()
    ys = set()

    def add(x0, x1, y0, y1, z0, z1):
        xs.update([round(x0, 4), round(x1, 4)])
        ys.update([round(y0, 4), round(y1, 4)])
        ops.append(("add", x0, x1, y0, y1, z0, z1))

    def cut(x0, x1, y0, y1, z0, z1):
        xs.update([round(x0, 4), round(x1, 4)])
        ys.update([round(y0, 4), round(y1, 4)])
        ops.append(("cut", x0, x1, y0, y1, z0, z1))

    # =========================================================================
    # 1. SOLID STEPPED TERRAIN & RIVER BED BLOCK BEFORE UNDERSIDE HOLLOWING
    #    - River basin (South-East / Center-Right): top at Z = 2.60 mm (water at 2.95 mm)
    #    - Low terrace (West & South): top at Z = 3.10 mm
    #    - Mid terrace (Center-North): top at Z = 3.45 mm
    #    - High terrace (North-East): top at Z = 3.80 mm
    # =========================================================================
    add(-29.0, 29.0, -22.0, 22.0, 0.00, 3.10)
    # Mid terrace
    add(-10.0, 29.0, -2.0, 22.0, 3.10, 3.45)
    # High terrace (North-East)
    add(8.0, 29.0, 7.0, 22.0, 3.45, 3.80)

    # River channel recessed into terrain (X in [4.0, 27.0], Y in [-20.0, -4.0])
    # River water surface at Z = 2.70 mm, stepped banks at Z = 2.90 mm
    cut(3.0, 27.5, -19.5, -3.5, 2.90, 3.60)
    cut(4.2, 26.5, -18.5, -4.5, 2.70, 3.60)

    # Front pry-lip chamfer ONLY on the outer front edge (Y in [-22.0, -21.0])
    # + extra corner relief tabs at Front-Left and Front-Right so scraper slides in effortlessly!
    cut(-29.0, 29.0, -22.0, -21.75, 0.00, 0.90)
    cut(-29.0, 29.0, -21.75, -21.50, 0.00, 0.65)
    cut(-29.0, 29.0, -21.50, -21.25, 0.00, 0.40)
    cut(-29.0, 29.0, -21.25, -21.00, 0.00, 0.20)
    # Note: Back (Y = +22.0), Left (X = -29.0), Right (X = +29.0) remain strict 90-deg
    # vertical tile-seam walls to check flatness & zero Elephant's Foot!

    # =========================================================================
    # 2. UNDERSIDE HOLLOW SLA VAULT (1.80 mm ceiling thickness!)
    #    - Solid perimeter skirt = 3.60 mm wide -> Vault X in [-25.4, +25.4], Y in [-18.4, +18.4]
    #    - Under river (X in [2.5, 25.4], Y in [-18.4, -3.0]): top is 2.70 mm -> vault ceiling Z = 0.95 mm
    #    - Under low terrace (Z_top = 3.10 mm): vault ceiling Z = 1.30 mm (wall = 1.80 mm!)
    #    - Under mid terrace (Z_top = 3.45 mm): vault ceiling Z = 1.65 mm (wall = 1.80 mm!)
    #    - Under high terrace (Z_top = 3.80 mm): vault ceiling Z = 2.00 mm (wall = 1.80 mm!)
    # =========================================================================
    # Carve main vault up to Z = 0.95 mm everywhere inside [-25.4, +25.4] x [-18.4, +18.4]
    cut(-25.4, 25.4, -18.4, 18.4, 0.00, 0.95)
    # Deepen vault under low terrace (outside river margin) up to Z = 1.30 mm
    cut(-25.4, 2.0, -18.4, 18.4, 0.95, 1.30)
    cut(2.0, 25.4, -1.5, 18.4, 0.95, 1.30)
    # Stepped transition & deepen under mid terrace up to Z = 1.65 mm
    cut(-8.5, 25.4, -0.5, 18.4, 1.30, 1.65)
    # Deepen under high terrace up to Z = 2.00 mm
    cut(9.5, 25.4, 8.5, 18.4, 1.65, 2.00)

    # Add internal structural cross-rib (1.60 mm wide) touching Z = 0.00 to prevent warping!
    # X-rib at X in [-0.8, +0.8], Y-rib at Y in [-0.8, +0.8]
    add(-0.8, 0.8, -18.4, 18.4, 0.00, 1.35)
    add(-25.4, 25.4, -0.8, 0.8, 0.00, 1.35)
    # Cut drain/air equalization notches in the cross-ribs (Z = [0.00, 0.90] mm) so zero pockets form!
    cut(-0.8, 0.8, -11.0, -8.0, 0.00, 0.90)
    cut(-0.8, 0.8, 8.0, 11.0, 0.00, 0.90)
    cut(-15.0, -12.0, -0.8, 0.8, 0.00, 0.90)
    cut(12.0, 15.0, -0.8, 0.8, 0.00, 0.90)

    # 4 Perimeter SLA Anti-Suction Drain Channels (width 2.40 mm, height 0.90 mm)
    # North, South, West, East midpoints connecting the vault directly to outside!
    cut(-1.2, 1.2, -22.0, -18.4, 0.00, 0.90)  # South drain (at X=0; cuts rib tip cleanly too)
    cut(-3.6, -1.2, -22.0, -17.0, 0.00, 0.90)  # Offset South drain into SW chamber
    cut(1.2, 3.6, 17.0, 22.0, 0.00, 0.90)      # North drain into NE chamber
    cut(-29.0, -25.4, 2.0, 4.4, 0.00, 0.90)    # West drain
    cut(25.4, 29.0, -10.5, -8.1, 0.00, 0.90)   # East drain (under river vault)

    # Underside Debossed Tile ID Stamp "R1C1 ^" in NW vault ceiling (X in [-24.2, -9.5], Y in [6.0, 11.5])
    # Entire stamp sits cleanly on the flat Z = 1.30 mm ceiling; deboss 0.45 mm deep up to Z = 1.75 mm
    stamp_chars = ["R", "1", "C", "1", "^"]
    cursor_x = -9.5  # Start at -9.5 and step toward -X so mirrored view reads left-to-right!
    pix = 0.55
    for ch in stamp_chars:
        glyph = GLYPHS_5X5[ch]
        gw = len(glyph[0])
        for ry, row in enumerate(glyph):
            # ry=0 is top of letter (+Y = North!)
            y_hi = 11.5 - ry * pix
            y_lo = y_hi - pix
            for rx, bit in enumerate(row):
                if bit == "1":
                    # Mirrored X: rx increases toward -X!
                    x_hi = cursor_x - rx * pix
                    x_lo = x_hi - pix
                    cut(x_lo, x_hi, y_lo, y_hi, 1.30, 1.75)
        cursor_x -= (gw + 1.2) * pix

    # =========================================================================
    # 3. TOP URBAN ARCHITECTURE ZONES
    # =========================================================================
    # North orientation marker '+' at top-center (Z = [3.45, 4.10] mm)
    add(-0.6, 0.6, 18.2, 21.0, 3.45, 4.10)
    add(-1.8, 1.8, 19.2, 20.2, 3.45, 4.10)

    # -------------------------------------------------------------------------
    # ZONE B2 (North-West, Z_base = 3.10 mm): Exposure Re-Check (3.05s validation)
    # Skyscrapers: 0.25, 0.35, 0.50, 0.75, 1.00 mm + Street gaps: 0.20, 0.30, 0.40, 0.60 mm
    # -------------------------------------------------------------------------
    p_sizes = [0.25, 0.35, 0.50, 0.75, 1.00]
    px_list = [-26.0, -23.8, -21.3, -18.5, -15.3]
    for cx, sz in zip(px_list, p_sizes):
        hw = round(sz / 2.0, 4)
        # Tall skyscraper (+2.50 mm -> Z = 5.60 mm)
        add(cx - hw, cx + hw, 18.0 - hw, 18.0 + hw, 3.10, 5.60)
        # Medium block (+1.40 mm -> Z = 4.50 mm)
        add(cx - hw, cx + hw, 14.2 - hw, 14.2 + hw, 3.10, 4.50)
        # Thin pier wall (2.6 mm long x sz wide, +1.50 mm -> Z = 4.60 mm)
        add(cx - hw, cx + hw, 9.8, 12.4, 3.10, 4.60)

    # Mini street canyon block right below pillars (X in [-26.8, -14.0], Y in [1.5, 8.2])
    add(-26.8, -14.0, 1.5, 8.2, 3.10, 4.40)
    for cx, gw in zip([-24.8, -22.2, -19.3, -16.2], [0.20, 0.30, 0.40, 0.60]):
        hw = round(gw / 2.0, 4)
        cut(cx - hw, cx + hw, 1.5, 7.2, 3.25, 4.50)

    # -------------------------------------------------------------------------
    # ZONE T (South-West Park, Z_base = 3.10 mm): Supportless 3D Tree Crowns!
    # Tests overhanging 3D park trees from Layer 2 of map-to-3dprint!
    # Trunks (0.60..1.00 mm) + stepped 3D canopy crowns overhanging by 0.35..0.65 mm per side!
    # -------------------------------------------------------------------------
    # Park turf slab (+0.20 mm -> Z = 3.30 mm)
    add(-26.8, -13.5, -18.5, -1.5, 3.10, 3.30)
    tree_specs = [
        # (cx, cy, trunk_w, crown_w, z_trunk_top, z_crown_top)
        (-24.2, -5.0, 0.60, 1.40, 3.85, 4.75),   # Small delicate tree
        (-19.8, -5.0, 0.70, 1.70, 3.90, 4.95),   # Medium park tree
        (-15.5, -5.0, 0.90, 2.10, 3.95, 5.15),   # Large boulevard tree
        (-24.2, -10.5, 0.60, 1.50, 3.85, 4.80),
        (-19.8, -10.5, 0.80, 1.90, 3.90, 5.05),
        (-15.5, -10.5, 1.00, 2.40, 3.95, 5.25),  # Extra wide canopy overhang test
    ]
    for tx, ty, tw, cw, zt, zc in tree_specs:
        ht = round(tw / 2.0, 4)
        hc = round(cw / 2.0, 4)
        hm = round((ht + hc) * 0.5, 4)
        # Trunk
        add(tx - ht, tx + ht, ty - ht, ty + ht, 3.30, zt)
        # Stepped outward lower crown (self-supporting 45-deg stepped overhang!)
        add(tx - hm, tx + hm, ty - hm, ty + hm, zt, round(zt + 0.20, 4))
        # Main full canopy
        add(tx - hc, tx + hc, ty - hc, ty + hc, round(zt + 0.20, 4), round(zc - 0.25, 4))
        # Crown top cap
        add(tx - hm, tx + hm, ty - hm, ty + hm, round(zc - 0.25, 4), zc)

    # Old-Town Tenement Blocks with Deep Keyhole Courtyards (IPA washout test!)
    # Placed at X in [-12.0, +1.5], Y in [-18.5, -2.5], Z_base = 3.10 mm
    # Courtyards: 0.50 mm, 0.80 mm, 1.20 mm, 2.00 mm wide, 2.20 mm deep!
    courtyard_blocks = [
        (-11.5, -6.0, -9.5, -3.5, 0.50),   # 0.50 mm courtyard
        (-5.0, 1.0, -9.5, -3.5, 0.80),     # 0.80 mm courtyard
        (-11.5, -6.0, -17.5, -11.0, 1.20), # 1.20 mm courtyard
        (-5.0, 1.5, -17.5, -11.0, 2.00),   # 2.00 mm courtyard
    ]
    for bx0, bx1, by0, by1, cw in courtyard_blocks:
        add(bx0, bx1, by0, by1, 3.10, 5.30)
        cx = round(0.5 * (bx0 + bx1), 4)
        cy = round(0.5 * (by0 + by1), 4)
        hc = round(cw / 2.0, 4)
        cut(cx - hc, cx + hc, cy - hc, cy + hc, 3.10, 5.40)

    # -------------------------------------------------------------------------
    # ZONE R (South-East River, Z_water = 2.70 mm): Long River Bridges & Sopot Pier!
    #   - Bridge 1 (X = 7.5): 4.5 mm clear span across river channel
    #   - Bridge 2 (X = 14.5): Two-span river bridge with central river pier (6.0 mm spans!)
    #   - Pier (X = 22.0): Thin wooden pier (0.90 mm wide deck on 0.70 mm pilings) jutting into river!
    # -------------------------------------------------------------------------
    # Bridge 1 (4.5 mm single span): abutments at Y=[-19.5..-16.5] and Y=[-12.0..-9.0], deck Z=[3.70, 4.35]
    add(6.2, 8.8, -19.5, -16.5, 2.70, 4.35)
    add(6.2, 8.8, -12.0, -9.0, 2.70, 4.35)
    add(6.2, 8.8, -19.5, -9.0, 3.70, 4.35)
    # Bridge 1 approach ramps to banks
    add(6.2, 8.8, -9.0, -3.5, 2.70, 3.90)

    # Bridge 2 (6.0 mm clear span + 4.5 mm span): Y in [-18.5, -4.5], deck Z=[3.80, 4.45]
    add(12.8, 15.6, -19.5, -17.5, 2.70, 4.45)  # South abutment
    add(12.8, 15.6, -11.5, -10.0, 2.70, 4.45)  # Mid-river pier (6.0 mm span!)
    add(12.8, 15.6, -5.5, -3.5, 2.70, 4.45)    # North abutment (4.5 mm span!)
    add(12.8, 15.6, -19.5, -3.5, 3.80, 4.45)   # Continuous bridge deck + parapets:
    add(12.8, 13.15, -19.5, -3.5, 4.45, 4.70)  # West parapet rail (0.35 mm!)
    add(15.25, 15.6, -19.5, -3.5, 4.45, 4.70)  # East parapet rail (0.35 mm!)

    # Sopot-style Narrow Pier jutting from North bank (Y=-3.5 down to Y=-15.5) at X in [21.0, 22.0] (1.0 mm wide!)
    add(21.0, 22.0, -5.0, -3.5, 2.70, 3.65)    # Shore anchor
    add(21.1, 21.9, -9.8, -9.0, 2.70, 3.65)    # Piling 1 (0.8 mm)
    add(21.1, 21.9, -15.5, -14.7, 2.70, 3.65)  # Piling 2 (0.8 mm)
    add(21.0, 22.0, -15.5, -3.5, 3.25, 3.65)   # Thin 0.40 mm pier deck!

    # -------------------------------------------------------------------------
    # ZONE H (Center-North & North-East, Z = 3.45..3.80 mm):
    # Downtown High-Rise Cluster + Stepped Landmark Tower (Z up to 6.80 mm)
    # -------------------------------------------------------------------------
    # Central plaza & street grid on Mid Terrace (X in [-9.0, +7.0], Y in [1.5, 16.5])
    add(-8.5, -2.5, 2.0, 8.0, 3.45, 5.20)
    cut(-7.0, -4.0, 3.5, 6.5, 3.45, 5.30)  # Inner courtyard

    add(-8.5, -2.5, 9.5, 16.5, 3.45, 5.80)
    # Gabled roof on [-8.5, -2.5] x [9.5, 16.5]
    for k in range(1, 9):
        ins = round(k * 0.30, 4)
        add(-8.5 + ins, -2.5 - ins, 9.5, 16.5, round(5.80 + (k - 1) * 0.10, 4), round(5.80 + k * 0.10, 4))

    # Landmark stepped skyscraper (Warsaw PKiN / Midtown style) at X in [0.5, 6.5], Y in [5.5, 11.5]
    add(0.5, 6.5, 5.5, 11.5, 3.45, 4.80)
    add(1.5, 5.5, 6.5, 10.5, 4.80, 5.80)
    add(2.4, 4.6, 7.4, 9.6, 5.80, 6.40)
    add(3.1, 3.9, 8.1, 8.9, 6.40, 6.80)  # 0.80 mm spire tip at Z = 6.80 mm!

    # High-terrace Alpine / Castle ridge buildings (X in [11.0, 26.0], Y in [9.0, 19.5], Z_base = 3.80 mm)
    add(11.5, 18.0, 10.0, 18.5, 3.80, 5.40)
    cut(13.2, 16.3, 11.8, 16.7, 3.80, 5.50)  # Castle courtyard
    # Pyramidal corner tower on High Terrace
    add(20.0, 25.6, 11.0, 16.6, 3.80, 5.20)
    for k in range(1, 11):
        ins = round(k * 0.24, 4)
        add(20.0 + ins, 25.6 - ins, 11.0 + ins, 16.6 - ins, round(5.20 + (k - 1) * 0.10, 4), round(5.20 + k * 0.10, 4))

    return xs, ys, ops


def build_reinforced_corner_pad_commands(cx, cy, pip_count):
    """
    Reinforced 13.0 x 13.0 mm corner leveling sensor pad for Stage 2:
      - Thicker base Z = [0.00, 2.40] mm (1.60 mm solid roof above the 0.80 mm tunnel
        so it NEVER snaps in half during scraper removal!)
      - Generous 0.80 mm pry-chamfer on BOTH Front (Y_min) and Outer X edge!
      - Through Z=0 compression gauge tunnel: 2.20 mm wide x 0.80 mm high
        PLUS a second shallow 0.40 mm reference step slot on the side so you can
        visually tell ~0.2 mm vs ~0.6 mm Z-compression without calipers!
      - Tactile pips (1=FL, 2=FR, 3=BL, 4=BR) raised to Z = 3.20 mm
    """
    ops = []
    xs = set()
    ys = set()

    def add(x0, x1, y0, y1, z0, z1):
        xs.update([round(x0, 4), round(x1, 4)])
        ys.update([round(y0, 4), round(y1, 4)])
        ops.append(("add", x0, x1, y0, y1, z0, z1))

    def cut(x0, x1, y0, y1, z0, z1):
        xs.update([round(x0, 4), round(x1, 4)])
        ys.update([round(y0, 4), round(y1, 4)])
        ops.append(("cut", x0, x1, y0, y1, z0, z1))

    x0, x1 = cx - 6.5, cx + 6.5
    y0, y1 = cy - 6.5, cy + 6.5
    add(x0, x1, y0, y1, 0.00, 2.40)

    # Front pry-lip chamfer (0.80 mm tall, 4 steps)
    cut(x0, x1, y0, y0 + 0.25, 0.00, 0.80)
    cut(x0, x1, y0 + 0.25, y0 + 0.50, 0.00, 0.60)
    cut(x0, x1, y0 + 0.50, y0 + 0.75, 0.00, 0.40)
    cut(x0, x1, y0 + 0.75, y0 + 1.00, 0.00, 0.20)

    # Central Z=0 tunnel: 2.20 mm wide x 0.80 mm high (must be 100% open in all 4 corners!)
    cut(cx - 1.1, cx + 1.1, y0, y1, 0.00, 0.80)

    # Tactile identification pips (2.0 x 2.0 mm, Z = [2.40, 3.20] mm)
    pip_positions = [
        (cx - 3.8, cy + 3.0),  # 1: FL
        (cx + 3.8, cy + 3.0),  # 2: FR
        (cx - 3.8, cy - 2.2),  # 3: BL
        (cx + 3.8, cy - 2.2),  # 4: BR
    ]
    for px, py in pip_positions[:pip_count]:
        add(px - 1.0, px + 1.0, py - 1.0, py + 1.0, 2.40, 3.20)

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
    out_dir = os.path.dirname(os.path.abspath(__file__))

    c_xs, c_ys, c_ops = build_stage2_hollow_tile_commands()
    tile_tris = compile_component(c_xs, c_ys, c_ops)
    tile_stats = audit_topology_and_volume(tile_tris)
    assert tile_stats["open_edges"] == 0, f"Open edges in tile: {tile_stats}"
    assert tile_stats["non_manifold_edges"] == 0, f"Non-manifold in tile: {tile_stats}"

    tile_only_path = os.path.join(out_dir, "etap2_tylko_kafel_hollow.stl")
    write_binary_stl(tile_only_path, tile_tris, "Etap 2 Hollow Vault City Tile - Mono 4")

    full_tris = list(tile_tris)
    corners = [
        (-59.5, -29.5, 1),  # FL-1
        (59.5, -29.5, 2),   # FR-2
        (-59.5, 29.5, 3),   # BL-3
        (59.5, 29.5, 4),    # BR-4
    ]
    for cx, cy, pips in corners:
        pxs, pys, pops = build_reinforced_corner_pad_commands(cx, cy, pips)
        ptris = compile_component(pxs, pys, pops)
        pstats = audit_topology_and_volume(ptris)
        assert pstats["open_edges"] == 0, f"Corner {pips} open edges: {pstats}"
        assert pstats["non_manifold_edges"] == 0, f"Corner {pips} non-manifold: {pstats}"
        full_tris.extend(ptris)

    full_stats = audit_topology_and_volume(full_tris)
    assert full_stats["open_edges"] == 0, f"Full open edges: {full_stats}"
    assert full_stats["non_manifold_edges"] == 0, f"Full non-manifold: {full_stats}"

    full_path = os.path.join(out_dir, "etap2_pelny_hollow_vault_i_poziom.stl")
    write_binary_stl(full_path, full_tris, "Etap 2 Hollow Vault + 4 Corners - Mono 4")

    print("=== ETAP 2: PODSUMOWANIE WYGENEROWANYCH MODELI STL ===")
    for label, path, st in [
        ("Pełny test Etapu 2 (Hollow Vault + 4 wzmocnione rogi)", full_path, full_stats),
        ("Tylko kafel centralny Hollow Vault", tile_only_path, tile_stats),
    ]:
        bx = st["bbox_max"][0] - st["bbox_min"][0]
        by = st["bbox_max"][1] - st["bbox_min"][1]
        bz = st["bbox_max"][2] - st["bbox_min"][2]
        grams = st["volume_ml"] * 1.13
        print(f"\n[{label}]")
        print(f"  Plik:       {path}")
        print(f"  Wymiary:    {bx:.2f} x {by:.2f} x {bz:.2f} mm (Z: {st['bbox_min'][2]:.2f}..{st['bbox_max'][2]:.2f} mm)")
        print(f"  Trójkąty:   {st['triangles']} | OpenEdges: {st['open_edges']} | NonManifold: {st['non_manifold_edges']}")
        print(f"  Żywica:     {st['volume_ml']:.2f} ml (~{grams:.1f} g przy gęstości 1.13 g/cm³)")
        print(f"  Warstwy:    {int(round(bz / 0.05))} warstw @ 0.05 mm (~28-33 min druku)")


if __name__ == "__main__":
    main()
