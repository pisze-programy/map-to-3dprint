#!/usr/bin/env python3
"""
adversarial_test_m1.py
Empirical stress-testing harness for Milestone 1:
1. Spatial Proximity Cache Matching (boundary tests, multi-region, benchmark, zero-network).
2. Adaptive Terrarium DEM Zoom (span boundaries, extreme inputs, tile count bounds).
3. Live build defect verification (NameError on cache write).
"""
import math
import os
import sys
import time
import unittest.mock as mock

import gis.scene_pipeline as sp
import gis.overpass_dem as dem

R = 6371000.0

def run_test(name, fn):
    try:
        fn()
        print(f"  [PASS] {name}")
        return True
    except Exception as e:
        print(f"  [FAIL] {name}: {type(e).__name__}: {e}")
        return False

print("=== SUITE 1: Spatial Proximity Cache Matching ===")

def test_exact_boundaries():
    # Warsaw center: lat=52.2470, lon=21.0135
    # Bbox: 52.2415, 21.0050, 52.2525, 21.0220
    c_lat = 52.2470
    c_lon = 21.0135
    dlat = (52.2525 - 52.2415) * 0.5
    dlon = (21.0220 - 21.0050) * 0.5

    boundary_cases = [
        (0.0, True, "0m exact hit"),
        (500.0, True, "500m interior hit"),
        (1499.0, True, "1499m near-boundary hit"),
        (1500.0, True, "1500.0m exact cutoff hit"),
        (1500.5, False, "1500.5m just-outside miss"),
        (1501.0, False, "1501.0m outside miss"),
        (5000.0, False, "5000m far-outside miss"),
    ]

    for target_dist, should_hit, desc in boundary_cases:
        delta_lat = math.degrees(target_dist / R)
        test_lat = c_lat + delta_lat
        s = test_lat - dlat
        n = test_lat + dlat
        w = c_lon - dlon
        e = c_lon + dlon

        file_path, dist = sp.find_proximity_cache_scene(s, w, n, e, max_dist_m=1500.0)
        is_hit = file_path is not None
        assert is_hit == should_hit, f"{desc}: expected hit={should_hit}, got hit={is_hit} (dist={dist:.3f}m)"
        assert abs(dist - target_dist) < 0.05, f"{desc}: distance mismatch {dist:.3f}m vs {target_dist:.3f}m"

run_test("Exact Distance Boundaries (0m, 500m, 1499m, 1500m, 1500.5m, 1501m, 5000m)", test_exact_boundaries)


def test_multi_region_coordinates():
    # Warsaw, Munich, New York, Tokyo
    regions = [
        ("Warsaw", 52.2470, 21.0135, "scene_v5_52.2415_21.0050_52.2525_21.0220.json"),
        ("Munich", 48.1338, 11.5855, "scene_v5_48.1280_11.5769_48.1396_11.5941.json"),
        ("New York", 40.7664, -73.9784, "scene_v5_40.7606_-73.9839_40.7722_-73.9729.json"),
        ("Tokyo", 35.7118, 139.8015, "scene_v5_35.7060_139.7929_35.7176_139.8101.json"),
    ]

    for name, lat, lon, expected_file in regions:
        # At 300m offset
        dlat = math.degrees(300.0 / R)
        f, d = sp.find_proximity_cache_scene(lat + dlat - 0.005, lon - 0.005, lat + dlat + 0.005, lon + 0.005, 1500.0)
        assert f is not None, f"{name} failed to match within 1500m (d={d}m)"
        assert expected_file in f, f"{name} matched wrong file: {f}"

        # At 2500m offset (should miss)
        dlat_miss = math.degrees(2500.0 / R)
        f_miss, d_miss = sp.find_proximity_cache_scene(lat + dlat_miss - 0.005, lon - 0.005, lat + dlat_miss + 0.005, lon + 0.005, 1500.0)
        assert f_miss is None, f"{name} falsely matched at 2500m: {f_miss}"
        assert d_miss > 1500.0, f"{name} distance calculation error: {d_miss}m"

run_test("Multi-Region Precomputed Match (Warsaw, Munich, NY, Tokyo)", test_multi_region_coordinates)


def test_hemisphere_and_meridian_geodesics():
    # Southern hemisphere geodesic
    sydney_lat, sydney_lon = -33.8688, 151.2093
    dlat_1000 = math.degrees(1000.0 / R)
    dist_sh = sp.haversine_m(sydney_lat, sydney_lon, sydney_lat + dlat_1000, sydney_lon)
    assert abs(dist_sh - 1000.0) < 0.1, f"Southern hemisphere haversine error: {dist_sh}m"

    # Prime meridian crossing (Greenwich)
    dist_pm = sp.haversine_m(51.4769, -0.0010, 51.4769, 0.0010)
    expected_pm = R * math.cos(math.radians(51.4769)) * math.radians(0.0020)
    assert abs(dist_pm - expected_pm) < 0.5, f"Prime meridian haversine error: {dist_pm}m vs {expected_pm}m"

    # 180 antimeridian crossing
    dist_am = sp.haversine_m(0.0, 179.9990, 0.0, -179.9990)
    expected_am = R * math.radians(0.0020)
    assert abs(dist_am - expected_am) < 0.5, f"180-meridian haversine error: {dist_am}m vs {expected_am}m"

run_test("Hemisphere & Meridian Geodesics (Southern, Greenwich 0°, Antimeridian 180°)", test_hemisphere_and_meridian_geodesics)


def test_lookup_performance_5000():
    N = 5000
    # Exact lookup benchmark
    t0 = time.perf_counter()
    for _ in range(N):
        sp.find_proximity_cache_scene(52.2415, 21.0050, 52.2525, 21.0220, 1500.0)
    dur_exact = time.perf_counter() - t0

    # Proximity hit benchmark (requires glob & dist calc)
    t0 = time.perf_counter()
    for _ in range(N):
        sp.find_proximity_cache_scene(52.2460, 21.0095, 52.2570, 21.0265, 1500.0)
    dur_hit = time.perf_counter() - t0

    # Proximity miss benchmark (scans all files)
    t0 = time.perf_counter()
    for _ in range(N):
        sp.find_proximity_cache_scene(0.0, 0.0, 0.01, 0.01, 1500.0)
    dur_miss = time.perf_counter() - t0

    print(f"    Exact: {dur_exact:.4f}s ({dur_exact/N*1000:.3f}ms/op, {N/dur_exact:.0f} ops/s)")
    print(f"    Proximity Hit: {dur_hit:.4f}s ({dur_hit/N*1000:.3f}ms/op, {N/dur_hit:.0f} ops/s)")
    print(f"    Proximity Miss: {dur_miss:.4f}s ({dur_miss/N*1000:.3f}ms/op, {N/dur_miss:.0f} ops/s)")

    assert dur_exact < 1.0, f"Exact lookups too slow: {dur_exact:.3f}s"
    assert dur_hit < 5.0, f"Proximity hits too slow: {dur_hit:.3f}s"
    assert dur_miss < 10.0, f"Proximity misses too slow: {dur_miss:.3f}s"

run_test("High-Throughput Benchmark (5,000 lookups)", test_lookup_performance_5000)


def test_zero_network_calls_on_cache_hit():
    def net_bomb(*args, **kwargs):
        raise AssertionError("ILLEGAL NETWORK CALL TRIGGERED DURING CACHE HIT!")

    with mock.patch("gis.scene_pipeline.fetch_terrarium_dem_grid", side_effect=net_bomb):
        with mock.patch("gis.scene_pipeline.fetch_osm_overpass", side_effect=net_bomb):
            with mock.patch("subprocess.run", side_effect=net_bomb):
                # Warsaw exact
                scene = sp.build_scene_from_bbox(52.2415, 21.0050, 52.2525, 21.0220, "WARSAW")
                assert scene is not None
                assert len(scene["buildings"]) > 50

                # Warsaw 700m offset
                dlat_700 = math.degrees(700.0 / R)
                scene700 = sp.build_scene_from_bbox(52.2415 + dlat_700, 21.0050, 52.2525 + dlat_700, 21.0220, "WARSAW_700M")
                assert scene700 is not None
                assert len(scene700["buildings"]) > 50

run_test("Zero Network Calls on Cache Hit (Mock Exploder)", test_zero_network_calls_on_cache_hit)


print("\n=== SUITE 2: Adaptive Terrarium DEM Zoom ===")

def test_zoom_span_boundaries():
    zoom_expectations = [
        (0, 14),
        (-500, 14),
        (1200, 14),
        (2199, 14),
        (2200, 14),
        (2201, 13),
        (5499, 13),
        (5500, 13),
        (5501, 12),
        (11499, 12),
        (11500, 12),
        (11501, 11),
        (25000, 11),
        (50000, 11),
        (100000, 11),
        ("5500", 13),
        ("12000", 11),
        (None, 14),
    ]

    for val, expected in zoom_expectations:
        actual = dem.choose_adaptive_dem_zoom(val)
        assert actual == expected, f"Span {val}: expected {expected}, got {actual}"

run_test("Adaptive DEM Zoom Boundaries & Extreme Spans", test_zoom_span_boundaries)


def test_tile_counts_large_areas():
    locations = [
        ("Equator", 0.0, 0.0),
        ("Warsaw", 52.23, 21.01),
        ("Munich", 48.14, 11.58),
        ("New York", 40.71, -74.01),
        ("HighLat_60", 60.0, 10.0),
    ]

    for name, lat, lon in locations:
        cos_lat = math.cos(math.radians(lat))
        for span_km in [25.0, 50.0]:
            span_m = span_km * 1000.0
            half_m = span_m * 0.5
            dlat = half_m / 111320.0
            dlon = half_m / (111320.0 * cos_lat)
            south, north = lat - dlat, lat + dlat
            west, east = lon - dlon, lon + dlon

            zoom = dem.choose_adaptive_dem_zoom(span_m)
            assert zoom == 11, f"At {span_km}km, zoom must be 11, got {zoom}"

            x_min_f, y_min_f = dem.deg2tile_float(north, west, zoom)
            x_max_f, y_max_f = dem.deg2tile_float(south, east, zoom)
            tx0, tx1 = int(math.floor(x_min_f)), int(math.floor(x_max_f))
            ty0, ty1 = int(math.floor(y_min_f)), int(math.floor(y_max_f))
            tile_count = (tx1 - tx0 + 1) * (ty1 - ty0 + 1)

            # At zoom 11, tile count must be bounded:
            # For 25km: between 4 and 16 tiles
            # For 50km: between 16 and 36 tiles
            if span_km == 25.0:
                assert tile_count <= 16, f"{name} 25km tile count too high: {tile_count}"
            else:
                assert tile_count <= 36, f"{name} 50km tile count too high: {tile_count}"

            # Calculate zoom 14 comparison
            x_min14, y_min14 = dem.deg2tile_float(north, west, 14)
            x_max14, y_max14 = dem.deg2tile_float(south, east, 14)
            t14 = (int(math.floor(x_max14)) - int(math.floor(x_min14)) + 1) * (int(math.floor(y_max14)) - int(math.floor(y_min14)) + 1)
            reduction_factor = t14 / tile_count
            assert reduction_factor >= 15.0, f"Insufficient tile reduction: {reduction_factor:.1f}x"

run_test("Tile Count Bounds (25km & 50km <= 36 tiles, >15x reduction)", test_tile_counts_large_areas)


print("\n=== SUITE 3: Pipeline Failure Modes & Code Defect Stress-Testing ===")

def test_reproduce_name_error_in_scene_pipeline():
    # Test if build_scene_from_bbox with force_rebuild=True crashes with NameError: name 'v5_cache' is not defined
    try:
        sp.build_scene_from_bbox(48.1280, 11.5769, 48.1396, 11.5941, "MÜNCHEN", force_rebuild=True)
        print("    Live build unexpectedly succeeded without NameError!")
        return False
    except NameError as ne:
        print(f"    CONFIRMED CRITICAL BUG: NameError caught verbatim: {ne}")
        assert "v5_cache" in str(ne) or "key_str" in str(ne), f"Unexpected NameError: {ne}"
        return True

run_test("Live Fetch / Cache Write Defect (NameError: v5_cache)", test_reproduce_name_error_in_scene_pipeline)
