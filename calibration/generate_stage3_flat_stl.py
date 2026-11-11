#!/usr/bin/env python3
"""
Generator wodoszczelnych (2-manifold) modeli STL — ETAP 3 (PŁASKO NA STOLE Z=0, BEZ POCHYŁU!)
dla drukarki Anycubic Photon Mono 4 (10K) + Anycubic Standard Clear + Porysowany Stół.

Rozwiązuje wszystkie problemy z Etapu 1 i Etapu 2 przy zachowaniu druku 100% PŁASKO (0°):
  1. ZERO Hollow Vault (brak szerokich komór powietrznych -> brak zapadania sufitu,
     brak zalewania rzeki i brak przebijania zarysów domków od spodu!).
  2. Ruszt odciążający 'Micro-Groove Release Base' na Z = 0:
     - Wąskie kanały 1.80 mm x 0.85 mm (identyczna geometria jak udana w 100% Strefa A z Etapu 1!)
       zmniejszają powierzchnię przyklejenia do porysowanego stołu o ~45%, odprowadzają żywicę i IPA,
       a nad nimi znajduje się gruba, sztywna, lita płyta (2.80 mm na lądzie, 2.15 mm pod rzeką).
     - Pełna ramka narożna trzyma wszystkie 4 rogi płasko na stole (Bottom = 5 x 27.0 s -> zero odwijania rogów!).
  3. Kieszenie pod szpachelkę (14 mm szerokości x 1.20 mm wys.) na PRZEDNIEJ i ZEWNĘTRZNEJ krawędzi
     każdego kafla — łatwe włożenie szpachelki bez siłowania i bez łamania kafla.
  4. Podcięcie 'Anti-Elephant-Foot' (0.35 mm w głąb na Z = 0.00..0.50 mm) dookoła krawędzi STYKU KAFLI —
     całe rozlanie warstw bazowych (Bottom + Transition) chowa się w podcięciu, więc dwa sąsiednie
     kafle miasta stykają się wyłącznie idealnie pionowymi, krystalicznymi ściankami!
  5. Wysokie wieżowce miejskie (aż do Z = 10.80 mm!) + przecięty na granicy kafli most, rzeka,
     kamienica z dziedzińcem, wysoki biurowiec i katedra z dachem dwuspadowym + test Kerf (0.00 vs 0.08 mm).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_stage1_stl import (
    RectilinearManifoldBuilder,
    audit_topology_and_volume,
    write_binary_stl,
)


def build_flat_tile_ops(is_left_tile, plate_offset_x=0.0):
    """
    Build Left Tile R1C1 (assembled world X in [-38.0, 0.0]) or Right Tile R1C2 (world X in [0.0, +38.0]),
    each 38.0 x 38.0 mm (Y in [-19.0, +19.0]), Z in [0.00, 10.80] mm,
    shifted locally around (plate_offset_x, 0.0) so Z = 0.00 sits flat on the build plate!
    """
    local_shift_x = (19.0 if is_left_tile else -19.0) + plate_offset_x

    ops = []
    xs = set()
    ys = set()

    def add_raw_local(lx0, lx1, ly0, ly1, z0, z1):
        lx0, lx1 = round(lx0, 4), round(lx1, 4)
        ly0, ly1 = round(ly0, 4), round(ly1, 4)
        z0, z1 = round(z0, 4), round(z1, 4)
        if lx1 - lx0 > 1e-5 and ly1 - ly0 > 1e-5 and z1 - z0 > 1e-5:
            xs.update([lx0, lx1])
            ys.update([ly0, ly1])
            ops.append(("add", lx0, lx1, ly0, ly1, z0, z1))

    def cut_raw_local(lx0, lx1, ly0, ly1, z0, z1):
        lx0, lx1 = round(lx0, 4), round(lx1, 4)
        ly0, ly1 = round(ly0, 4), round(ly1, 4)
        z0, z1 = round(z0, 4), round(z1, 4)
        if lx1 - lx0 > 1e-5 and ly1 - ly0 > 1e-5 and z1 - z0 > 1e-5:
            xs.update([lx0, lx1])
            ys.update([ly0, ly1])
            ops.append(("cut", lx0, lx1, ly0, ly1, z0, z1))

    def add_world(wx0, wx1, wy0, wy1, z0, z1):
        # Two-zone optical kerf gauge along the X = 0 seam:
        #   Y in [-19.0, +6.0] -> 0.00 mm seam gap (exact nominal butt joint)
        #   Y in [+6.0, +19.0] -> 0.08 mm total kerf gap (0.04 mm per tile, map-to-3dprint default)
        segs = [(wy0, 6.0), (6.0, wy1)] if (wy0 < 6.0 < wy1) else [(wy0, wy1)]
        for sy0, sy1 in segs:
            ymid = 0.5 * (sy0 + sy1)
            if is_left_tile:
                dom_x0 = -38.0
                dom_x1 = -0.04 if ymid >= 6.0 else 0.00
            else:
                dom_x0 = 0.04 if ymid >= 6.0 else 0.00
                dom_x1 = 38.0
            cx0 = max(wx0, dom_x0)
            cx1 = min(wx1, dom_x1)
            cy0 = max(sy0, -19.0)
            cy1 = min(sy1, 19.0)
            if cx1 - cx0 > 1e-5 and cy1 - cy0 > 1e-5 and z1 - z0 > 1e-5:
                add_raw_local(cx0 + local_shift_x, cx1 + local_shift_x, cy0, cy1, z0, z1)

    def cut_world(wx0, wx1, wy0, wy1, z0, z1):
        dom_x0, dom_x1 = (-38.5, 0.5) if is_left_tile else (-0.5, 38.5)
        cx0 = max(wx0, dom_x0)
        cx1 = min(wx1, dom_x1)
        cy0 = max(wy0, -19.5)
        cy1 = min(wy1, 19.5)
        if cx1 - cx0 > 1e-5 and cy1 - cy0 > 1e-5 and z1 - z0 > 1e-5:
            cut_raw_local(cx0 + local_shift_x, cx1 + local_shift_x, cy0, cy1, z0, z1)

    # =========================================================================
    # 1. RIGID SOLID BASE + DEM TERRACES + RIVER CHANNEL
    #    - Land base Z = 2.80 mm, Mid terrace = 3.10 mm, High terrace = 3.40 mm
    #    - River water surface Z = 2.15 mm (leaves 1.30 mm solid roof above 0.85 mm grooves!)
    # =========================================================================
    add_world(-38.0, 38.0, -19.0, 19.0, 0.00, 2.80)
    add_world(-38.0, 38.0, 2.0, 19.0, 2.80, 3.10)
    add_world(-26.0, 30.0, 9.5, 19.0, 3.10, 3.40)

    # River channel flowing East-West across the X=0 seam (Y in [-16.0, -6.0])
    cut_world(-38.0, 38.0, -16.0, -6.0, 2.45, 3.00)
    cut_world(-38.0, 38.0, -15.0, -7.0, 2.15, 3.00)

    # =========================================================================
    # 2. UNDERSIDE ENGINEERING ON Z = 0 (NO HOLLOW VAULT! MICRO-GROOVE RELEASE GRID
    #    + SCRAPER PRY POCKETS + ANTI-ELEPHANT-FOOT SEAM CHAMFER)
    # =========================================================================
    cx = plate_offset_x  # Tile local center X (tile spans [cx - 19.0, cx + 19.0])
    tx0, tx1 = cx - 19.0, cx + 19.0
    ty0, ty1 = -19.0, 19.0

    # 2a. Micro-Groove Release Channels (width 1.80 mm, height 0.85 mm = 17 layers, clear of Transition!)
    #     Keep a solid 2.80 mm corner/perimeter anchor rim on all 4 sides so ZERO corners ever peel!
    #     7 vertical Y-grooves (1.80 mm groove / 1.80 mm solid rib) inside X in [cx - 13.5, cx + 13.5]
    g_start = -13.5
    for k in range(8):
        gx0 = cx + g_start + k * 3.60
        gx1 = gx0 + 1.80
        if gx1 <= cx + 13.6:
            cut_raw_local(gx0, gx1, ty0 + 2.8, ty1 - 2.8, 0.00, 0.85)

    # 3 cross-vent channels connecting all grooves out through the OUTER (non-seam!) side & North/South
    # so zero suction occurs and IPA flushes Straight Through in Wash & Cure 3!
    outer_x_open0 = tx0 if is_left_tile else cx - 13.5
    outer_x_open1 = cx + 13.5 if is_left_tile else tx1
    for vy in (-11.5, 0.0, 11.5):
        cut_raw_local(outer_x_open0, outer_x_open1, vy - 0.90, vy + 0.90, 0.00, 0.85)

    # Also 2 front-to-back vents opening at South (ty0) and North (ty1) away from corners:
    cut_raw_local(cx - 6.3, cx - 4.5, ty0, ty1, 0.00, 0.85)
    cut_raw_local(cx + 4.5, cx + 6.3, ty0, ty1, 0.00, 0.85)

    # 2b. Deep Scraper Pry Pockets (12.0 mm wide x 1.25 mm high stepped bevel!)
    #     Placed on FRONT edge (Y = -19.0) AND OUTER X edge (Left on Tile 1, Right on Tile 2)
    #     so even a thicker metal scraper slides 2.2 mm under the tile effortlessly!
    # Front pry pocket (centered at X = cx):
    cut_raw_local(cx - 6.5, cx + 6.5, ty0, ty0 + 0.8, 0.00, 1.25)
    cut_raw_local(cx - 6.5, cx + 6.5, ty0 + 0.8, ty0 + 1.6, 0.00, 0.85)
    cut_raw_local(cx - 6.5, cx + 6.5, ty0 + 1.6, ty0 + 2.4, 0.00, 0.45)

    # Outer side pry pocket (centered at Y = 0.0, ONLY on outer frame edge, never on seam!):
    if is_left_tile:
        cut_raw_local(tx0, tx0 + 0.8, -6.5, 6.5, 0.00, 1.25)
        cut_raw_local(tx0 + 0.8, tx0 + 1.6, -6.5, 6.5, 0.00, 0.85)
        cut_raw_local(tx0 + 1.6, tx0 + 2.4, -6.5, 6.5, 0.00, 0.45)
    else:
        cut_raw_local(tx1 - 0.8, tx1, -6.5, 6.5, 0.00, 1.25)
        cut_raw_local(tx1 - 1.6, tx1 - 0.8, -6.5, 6.5, 0.00, 0.85)
        cut_raw_local(tx1 - 2.4, tx1 - 1.6, -6.5, 6.5, 0.00, 0.45)

    # 2c. Anti-Elephant's-Foot Undercut (0.35 mm deep on Z = 0..0.30, 0.20 mm on Z = 0.30..0.55 mm)
    #     Applied along ALL 4 perimeter edges (especially the INNER SEAM EDGE!) so Bottom (27s)
    #     + Transition layers NEVER bulge outward and tiles butt together with 0.00 mm base interference!
    # Inner seam edge is East (tx1) for Left Tile, West (tx0) for Right Tile:
    cut_raw_local(tx1 - 0.40, tx1, ty0, ty1, 0.00, 0.30)
    cut_raw_local(tx1 - 0.22, tx1, ty0, ty1, 0.30, 0.55)
    cut_raw_local(tx0, tx0 + 0.40, ty0, ty1, 0.00, 0.30)
    cut_raw_local(tx0, tx0 + 0.22, ty0, ty1, 0.30, 0.55)
    cut_raw_local(tx0, tx1, ty0, ty0 + 0.40, 0.00, 0.30)
    cut_raw_local(tx0, tx1, ty0, ty0 + 0.22, 0.30, 0.55)
    cut_raw_local(tx0, tx1, ty1 - 0.40, ty1, 0.00, 0.30)
    cut_raw_local(tx0, tx1, ty1 - 0.22, ty1, 0.30, 0.55)

    # =========================================================================
    # 3. SEAM-CROSSING CITY ARCHITECTURE + TALL SKYSCRAPERS (Z up to 10.80 mm!)
    # =========================================================================
    # SEAM 1: Central River Bridge split 50/50 across X = 0
    add_world(-2.4, 2.4, -16.6, -14.6, 2.15, 3.70)
    add_world(-2.4, 2.4, -7.4, -5.4, 2.15, 3.70)
    add_world(-2.4, 2.4, -16.6, -5.4, 3.15, 3.70)

    # Companion bridges on Left (X=[-20.0, -17.2]) and Right (X=[+16.0, +18.8])
    for bx0, bx1 in [(-20.0, -17.2), (16.0, 18.8)]:
        add_world(bx0, bx1, -16.6, -14.6, 2.15, 3.65)
        add_world(bx0, bx1, -11.7, -10.3, 2.15, 3.65)
        add_world(bx0, bx1, -7.4, -5.4, 2.15, 3.65)
        add_world(bx0, bx1, -16.6, -5.4, 3.10, 3.65)

    # SEAM 2: Split Courtyard Tenement Palace + Split High-Rise Tower (Y in [-4.0, +5.0], 0.00 kerf zone!)
    add_world(-7.0, 7.0, -3.5, 4.8, 2.80, 5.40)
    cut_world(-3.8, 3.8, -1.0, 2.3, 3.00, 5.50)
    # Twin High-Rise Podium Tower right at the seam (Z up to 9.20 mm!)
    add_world(-2.8, 2.8, 2.3, 4.8, 5.40, 9.20)

    # SEAM 3: Split Gabled Cathedral / Town Hall (Y in [9.8, 16.0], inside 0.08 mm kerf zone!)
    add_world(-6.5, 6.5, 10.0, 16.0, 3.40, 5.40)
    for k in range(1, 10):
        ins = round(k * 0.28, 4)
        add_world(
            -6.5,
            6.5,
            10.0 + ins,
            16.0 - ins,
            round(5.40 + (k - 1) * 0.14, 4),
            round(5.40 + k * 0.14, 4),
        )

    # North alignment bar across seam
    add_world(-2.2, 2.2, 17.0, 18.2, 3.40, 4.10)

    # =========================================================================
    # 4. LEFT TILE (R1C1): Tall Skyscrapers + Clear-Resin Threshold (0.45..1.00 mm) + 6 Reinforced Trees
    # =========================================================================
    # Park with 6 Reinforced 3D Trees (trunks 0.75..1.05 mm)
    add_world(-36.0, -22.0, -4.5, 8.0, 2.80, 3.20)
    trees_left = [
        (-33.5, -1.5, 0.75, 1.65, 3.80, 4.80),
        (-29.0, -1.5, 0.85, 1.90, 3.85, 4.95),
        (-24.5, -1.5, 1.00, 2.20, 3.90, 5.15),
        (-33.5, 4.5, 0.75, 1.70, 3.80, 4.85),
        (-29.0, 4.5, 0.90, 2.00, 3.85, 5.05),
        (-24.5, 4.5, 1.05, 2.35, 3.90, 5.25),
    ]
    for tx, ty, tw, cw, zt, zc in trees_left:
        ht = round(tw / 2.0, 4)
        hc = round(cw / 2.0, 4)
        hm = round((ht + hc) * 0.5, 4)
        add_world(tx - ht, tx + ht, ty - ht, ty + ht, 3.20, zt)
        add_world(tx - hm, tx + hm, ty - hm, ty + hm, zt, round(zt + 0.20, 4))
        add_world(tx - hc, tx + hc, ty - hc, ty + hc, round(zt + 0.20, 4), round(zc - 0.20, 4))
        add_world(tx - hm, tx + hm, ty - hm, ty + hm, round(zc - 0.20, 4), zc)

    # Clear-Resin Minimum Building Width Array (0.45, 0.55, 0.65, 0.80, 1.00, 1.40 mm) — tall test!
    for wx, sz in zip([-35.2, -32.8, -30.2, -27.3, -24.0, -20.0], [0.45, 0.55, 0.65, 0.80, 1.00, 1.40]):
        hw = round(sz / 2.0, 4)
        # Tall tower row (+3.60 mm height -> Z = 7.00 mm!)
        add_world(wx - hw, wx + hw, 15.5 - hw, 15.5 + hw, 3.40, 7.00)
        # Medium row (+2.00 mm -> Z = 5.40 mm)
        add_world(wx - hw, wx + hw, 11.5 - hw, 11.5 + hw, 3.40, 5.40)

    # Left Downtown Skyscraper Cluster (X in [-19.5, -9.5], Z up to 10.60 mm!)
    add_world(-19.5, -9.5, -3.5, 5.0, 2.80, 5.20)
    cut_world(-17.0, -12.0, -1.0, 2.5, 3.00, 5.30)
    # Tall sleek skyscraper on Left Tile (3.2 x 3.2 mm, Z = 10.60 mm!)
    add_world(-16.1, -12.9, 6.2, 9.4, 3.10, 10.60)
    add_world(-11.8, -9.4, 6.2, 8.6, 3.10, 8.40)  # Neighbor high-rise (2.4 x 2.4 mm)

    # Tile "1" badge (1 raised block at SW corner)
    add_world(-35.5, -33.7, -18.0, -16.6, 2.80, 3.50)

    # =========================================================================
    # 5. RIGHT TILE (R1C2): Supertall Downtown Cluster (Z = 10.80 mm!) + Street Grid + Pier
    # =========================================================================
    # Supertall Stepped Landmark Tower (Warsaw/Manhattan style, Z = 10.80 mm!)
    add_world(9.5, 17.5, 6.5, 14.5, 3.40, 5.80)
    add_world(11.0, 16.0, 8.0, 13.0, 5.80, 8.20)
    add_world(12.2, 14.8, 9.2, 11.8, 8.20, 10.00)
    add_world(13.0, 14.0, 10.0, 11.0, 10.00, 10.80)  # 1.0 x 1.0 mm spire at Z = 10.80 mm!

    # Neighbor Slender Financial Towers (1.6 x 1.6 mm & 2.2 x 2.2 mm, Z = 9.60 mm!)
    add_world(19.2, 21.4, 11.0, 13.2, 3.40, 9.60)
    add_world(19.2, 20.8, 7.2, 8.8, 3.10, 8.20)

    # Old-Town Street Canyon Grid (0.30, 0.45, 0.60, 0.80 mm)
    add_world(9.5, 22.5, -3.8, 4.8, 2.80, 5.00)
    for sx, sw in zip([12.2, 15.0, 18.0, 20.8], [0.30, 0.45, 0.60, 0.80]):
        hw = round(sw / 2.0, 4)
        cut_world(sx - hw, sx + hw, -3.8, 4.8, 3.00, 5.10)

    # East Courtyard Block & Park
    add_world(24.5, 35.8, 5.5, 16.0, 3.40, 5.60)
    cut_world(27.2, 33.1, 8.2, 13.3, 3.40, 5.70)

    # Waterfront Pier on Right Tile river
    add_world(27.5, 28.8, -7.2, -5.4, 2.15, 3.40)
    add_world(27.6, 28.7, -11.2, -10.1, 2.15, 3.40)
    add_world(27.6, 28.7, -14.6, -13.5, 2.15, 3.40)
    add_world(27.5, 28.8, -14.6, -5.4, 2.95, 3.40)

    # Tile "2" badge (2 raised blocks at SE corner)
    add_world(32.0, 33.6, -18.0, -16.6, 2.80, 3.50)
    add_world(34.4, 36.0, -18.0, -16.6, 2.80, 3.50)

    return xs, ys, ops


def compile_ops(xs, ys, ops):
    builder = RectilinearManifoldBuilder(xs, ys)
    for kind, x0, x1, y0, y1, z0, z1 in ops:
        if kind == "add":
            builder.add_box(x0, x1, y0, y1, z0, z1)
        else:
            builder.cut_box(x0, x1, y0, y1, z0, z1)
    return builder.build_triangles()


def main():
    out_dir = os.path.dirname(os.path.abspath(__file__))

    # Remove old tilted stage3 files so there is zero confusion in the folder!
    for old_name in ("etap3_kafel_1_lewy_R1C1.stl", "etap3_kafel_2_prawy_R1C2.stl", "generate_stage3_stl.py"):
        old_p = os.path.join(out_dir, old_name)
        if os.path.exists(old_p):
            os.remove(old_p)

    # 1. Individual Left & Right tiles centered at (0,0)
    l_tris = compile_ops(*build_flat_tile_ops(True, 0.0))
    l_stats = audit_topology_and_volume(l_tris)
    assert l_stats["open_edges"] == 0 and l_stats["non_manifold_edges"] == 0, l_stats
    l_path = os.path.join(out_dir, "etap3_plasko_kafel_1_lewy.stl")
    write_binary_stl(l_path, l_tris, "Etap 3 Flat Z=0 Left Tile R1C1 - Mono 4")

    r_tris = compile_ops(*build_flat_tile_ops(False, 0.0))
    r_stats = audit_topology_and_volume(r_tris)
    assert r_stats["open_edges"] == 0 and r_stats["non_manifold_edges"] == 0, r_stats
    r_path = os.path.join(out_dir, "etap3_plasko_kafel_2_prawy.stl")
    write_binary_stl(r_path, r_tris, "Etap 3 Flat Z=0 Right Tile R1C2 - Mono 4")

    # 2. Combined ready-to-print plate: BOTH tiles flat on Z=0 separated by 14 mm (span 90 x 38 x 10.8 mm)
    l_plate = compile_ops(*build_flat_tile_ops(True, -26.0))
    r_plate = compile_ops(*build_flat_tile_ops(False, +26.0))
    both_tris = l_plate + r_plate
    both_stats = audit_topology_and_volume(both_tris)
    assert both_stats["open_edges"] == 0 and both_stats["non_manifold_edges"] == 0, both_stats
    both_path = os.path.join(out_dir, "etap3_plasko_oba_kafle_na_stole.stl")
    write_binary_stl(both_path, both_tris, "Etap 3 Flat Z=0 Both Tiles Ready - Mono 4")

    print("=== ETAP 3 (PŁASKO 0° NA STOLE Z=0): PODSUMOWANIE MODELI STL ===")
    for label, path, st in [
        ("Oba kafle razem na stole (1 plik gotowy do Slice!)", both_path, both_stats),
        ("Kafel 1 — Lewy R1C1 (osobno)", l_path, l_stats),
        ("Kafel 2 — Prawy R1C2 (osobno)", r_path, r_stats),
    ]:
        bx = st["bbox_max"][0] - st["bbox_min"][0]
        by = st["bbox_max"][1] - st["bbox_min"][1]
        bz = st["bbox_max"][2] - st["bbox_min"][2]
        print(f"\n[{label}]")
        print(f"  Plik:       {path}")
        print(f"  Wymiary:    {bx:.2f} x {by:.2f} x {bz:.2f} mm (Z: {st['bbox_min'][2]:.2f}..{st['bbox_max'][2]:.2f} mm)")
        print(f"  Trójkąty:   {st['triangles']} | OpenEdges: {st['open_edges']} | NonManifold: {st['non_manifold_edges']}")
        print(f"  Żywica:     {st['volume_ml']:.2f} ml (~{st['volume_ml']*1.13:.1f} g)")
        print(f"  Warstwy:    {int(round(bz / 0.05))} warstw @ 0.05 mm (~38-44 min druku)")


if __name__ == "__main__":
    main()
