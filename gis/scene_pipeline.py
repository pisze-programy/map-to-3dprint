#!/usr/bin/env python3
"""
gis/scene_pipeline.py
End-to-end OSM + AWS Terrarium DEM scene builder with two-pass multipolygon/S3DB relation resolution,
architectural man_made=bridge polygons (bridgePolys), pedestrian plazas (roadPolys), and coverage-aware S3DB.
"""
import glob
import json
import math
import os
import re

from .geometry import (
    stitch_way_rings,
    parse_float_tag,
    simplify_ring,
    poly_area_signed,
    build_sea_polygons_from_coastlines,
    validate_processed_scene,
)
from .overpass_dem import CACHE_DIR, fetch_terrarium_dem_grid, fetch_osm_overpass, choose_adaptive_dem_zoom
from .s3db_models import (
    SKIP_BUILDING_VALS,
    is_underground_or_skipped_building,
    extract_display_name,
    match_and_emit_s3db,
)
from .terrain_features import (
    process_multipolygon_terrain_feature,
    process_way_terrain_feature,
    populate_park_trees,
)


def haversine_m(lat1, lon1, lat2, lon2):
    """Calculates ground distance in meters between two lat/lon points."""
    R = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * (math.sin(dlambda / 2.0) ** 2)
    return R * 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))


def find_proximity_cache_scene(south, west, north, east, max_dist_m=1500.0):
    """Finds the nearest precomputed scene_v5 / scene_v4 within max_dist_m (1.5 km)."""
    exact_key = f"{south:.4f}_{west:.4f}_{north:.4f}_{east:.4f}"
    exact_v5 = os.path.join(CACHE_DIR, f"scene_v5_{exact_key}.json")
    if os.path.exists(exact_v5):
        return exact_v5, 0.0

    exact_v4 = os.path.join(CACHE_DIR, f"scene_v4_{exact_key}.json")
    if os.path.exists(exact_v4):
        return exact_v4, 0.0

    req_lat = (south + north) * 0.5
    req_lon = (west + east) * 0.5

    best_file = None
    best_dist = float("inf")

    # Check scene_v5 first, then scene_v4
    for pattern in ("scene_v5_*.json", "scene_v4_*.json"):
        for path in glob.glob(os.path.join(CACHE_DIR, pattern)):
            basename = os.path.basename(path)
            m = re.match(r"scene_v[45]_([-\d.]+)_([-\d.]+)_([-\d.]+)_([-\d.]+)\.json", basename)
            if not m:
                continue
            try:
                s, w, n, e = map(float, m.groups())
            except ValueError:
                continue
            c_lat = (s + n) * 0.5
            c_lon = (w + e) * 0.5
            dist = haversine_m(req_lat, req_lon, c_lat, c_lon)
            if dist < best_dist:
                best_dist = dist
                best_file = path
        if best_dist <= max_dist_m:
            break

    if best_dist <= max_dist_m:
        return best_file, best_dist
    return None, best_dist


def build_scene_from_bbox(south, west, north, east, title_hint="", force_rebuild=False):
    """Fetches and processes real DEM + real OSM data for [south, west, north, east]."""
    key_str = f"{south:.4f}_{west:.4f}_{north:.4f}_{east:.4f}"
    v5_cache = os.path.join(CACHE_DIR, f"scene_v5_{key_str}.json")
    v4_cache = os.path.join(CACHE_DIR, f"scene_v4_{key_str}.json")

    if not force_rebuild:
        cache_path, dist = find_proximity_cache_scene(south, west, north, east, max_dist_m=1500.0)
        if cache_path and os.path.exists(cache_path):
            try:
                with open(cache_path, "r", encoding="utf-8") as f:
                    cached = json.load(f)
                cached.setdefault("bridgePolys", [])
                cached.setdefault("roadPolys", [])
                if validate_processed_scene(cached):
                    if title_hint:
                        cached["title"] = title_hint
                    return cached
            except Exception:
                pass

    center_lat = (south + north) * 0.5
    center_lon = (west + east) * 0.5
    cos_lat = max(0.2, math.cos(math.radians(center_lat)))

    span_ns_m = (north - south) * 111320.0
    span_ew_m = (east - west) * 111320.0 * cos_lat
    max_span_m = max(span_ew_m, span_ns_m)
    meters_to_units = 169.2 / max_span_m
    half_w = round(84.6 * span_ew_m / max_span_m, 2)
    half_h = round(84.6 * span_ns_m / max_span_m, 2)

    half_m = max_span_m * 0.5
    sq_dlat = half_m / 111320.0
    sq_dlon = half_m / (111320.0 * cos_lat)
    dem_data = fetch_terrarium_dem_grid(
        center_lat - sq_dlat,
        center_lon - sq_dlon,
        center_lat + sq_dlat,
        center_lon + sq_dlon,
        grid_size=72,
        zoom=None,
    )

    try:
        osm_raw = fetch_osm_overpass(south, west, north, east)
    except Exception:
        fallback_path, _ = find_proximity_cache_scene(south, west, north, east, max_dist_m=25000.0)
        if fallback_path and os.path.exists(fallback_path):
            try:
                with open(fallback_path, "r", encoding="utf-8") as f:
                    cached = json.load(f)
                cached.setdefault("bridgePolys", [])
                cached.setdefault("roadPolys", [])
                if validate_processed_scene(cached):
                    if title_hint:
                        cached["title"] = title_hint
                    return cached
            except Exception:
                pass
        raise
    elements = osm_raw.get("elements", [])

    def project(lon, lat):
        mx = (lon - center_lon) * 111320.0 * cos_lat * meters_to_units
        my = (lat - center_lat) * 111320.0 * meters_to_units
        return [round(mx, 3), round(my, 3)]

    nodes = {}
    ways = {}
    relations = []
    tree_nodes = []

    for el in elements:
        etype = el.get("type")
        if etype == "node":
            nid = el["id"]
            pt = project(el["lon"], el["lat"])
            nodes[nid] = pt
            tags = el.get("tags")
            if tags and tags.get("natural") == "tree":
                if -half_w - 0.5 <= pt[0] <= half_w + 0.5 and -half_h - 0.5 <= pt[1] <= half_h + 0.5:
                    h_m = parse_float_tag(tags.get("height"), 9.5)
                    tree_nodes.append([round(pt[0], 2), round(pt[1], 2), round(min(18.0, max(5.0, h_m)), 1)])
        elif etype == "way":
            ways[el["id"]] = el
        elif etype == "relation":
            relations.append(el)

    def nodes_to_pts(nid_list, tol=0.015):
        pts = [nodes[nid] for nid in nid_list if nid in nodes]
        return simplify_ring(pts, tol=tol)

    water_polys, water_lines, coastline_ways = [], [], []
    green_polys, roads, road_polys, bridge_polys, buildings = [], [], [], [], []
    used_way_ids_in_rel, consumed_rel_ids = set(), set()

    # Pass 1A: Pre-stitch all multipolygon geometries
    rel_by_id = {r["id"]: r for r in relations}
    stitched_rel_polys = {}

    for rel in relations:
        members = rel.get("members", [])
        outer_ways, inner_ways, member_way_ids = [], [], []
        for m in members:
            if m.get("type") == "way" and m.get("ref") in ways:
                role = m.get("role", "outer")
                if role in ("part",):
                    continue
                w_nodes = ways[m["ref"]].get("nodes", [])
                if role == "inner":
                    inner_ways.append(w_nodes)
                    member_way_ids.append(m["ref"])
                elif role in ("outer", "outline", ""):
                    outer_ways.append(w_nodes)
                    member_way_ids.append(m["ref"])
        if outer_ways:
            outer_rings = stitch_way_rings(outer_ways)
            inner_rings = stitch_way_rings(inner_ways)
            outer_polys = [p for p in (nodes_to_pts(r, tol=0.018) for r in outer_rings) if len(p) >= 3]
            inner_polys = [p for p in (nodes_to_pts(r, tol=0.018) for r in inner_rings) if len(p) >= 3]
            if outer_polys:
                stitched_rel_polys[rel["id"]] = (outer_polys, inner_polys, member_way_ids)

    candidate_parents, candidate_parts = [], []

    def register_candidate(osm_id, tags, outer_pts, holes_pts, is_part, group_id=None, from_bld_rel=False):
        if len(outer_pts) < 3 or is_underground_or_skipped_building(tags):
            return
        xs = [p[0] for p in outer_pts]
        ys = [p[1] for p in outer_pts]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        if abs(cx) > half_w + 4.0 or abs(cy) > half_h + 4.0:
            return
        outer_area = abs(poly_area_signed(outer_pts))
        holes_area = sum(abs(poly_area_signed(h)) for h in (holes_pts or []) if len(h) >= 3)
        min_h = parse_float_tag(tags.get("min_height"), 0.0) or 0.0
        min_lvl = parse_float_tag(tags.get("building:min_level"), 0.0) or 0.0
        if min_h == 0.0 and min_lvl > 0:
            min_h = min_lvl * 3.3

        rec = {
            "wid": osm_id,
            "tags": dict(tags),
            "pts": outer_pts,
            "holes": holes_pts or [],
            "cx": cx,
            "cy": cy,
            "bbox": (min(xs), min(ys), max(xs), max(ys)),
            "area": outer_area,
            "netArea": max(1e-4, outer_area - holes_area),
            "minH": min_h,
            "hasParts": False,
            "partCount": 0,
            "partsAreaSum": 0.0,
            "groundPartsAreaSum": 0.0,
            "fromBuildingRel": from_bld_rel,
            "groupId": group_id,
            "parentHeightHint": None,
            "isPart": bool(is_part),
        }
        (candidate_parts if is_part else candidate_parents).append(rec)

    # Pass 1B: Process explicit S3DB type=building relations
    for rel in relations:
        tags = rel.get("tags", {})
        members = rel.get("members", [])
        rel_type = tags.get("type", "")
        has_part_or_outline = any(m.get("role") in ("part", "outline") for m in members)

        if rel_type == "building" or has_part_or_outline:
            if is_underground_or_skipped_building(tags):
                consumed_rel_ids.add(rel["id"])
                for m in members:
                    if m.get("type") == "way":
                        used_way_ids_in_rel.add(m["ref"])
                    elif m.get("type") == "relation":
                        consumed_rel_ids.add(m["ref"])
                continue

            part_ways, part_rels, outline_ways, outline_rels = [], [], [], []
            for m in members:
                role, mtype, ref = m.get("role", ""), m.get("type"), m.get("ref")
                if role == "part":
                    if mtype == "way" and ref in ways:
                        part_ways.append(ref)
                    elif mtype == "relation" and ref in rel_by_id:
                        part_rels.append(ref)
                elif role in ("outline", "outer", ""):
                    if mtype == "way" and ref in ways:
                        outline_ways.append(ref)
                    elif mtype == "relation" and ref in rel_by_id:
                        outline_rels.append(ref)

            if part_ways or part_rels:
                consumed_rel_ids.add(rel["id"])
                parent_name = extract_display_name(tags)

                for o_wid in outline_ways:
                    used_way_ids_in_rel.add(o_wid)
                    w_obj = ways[o_wid]
                    w_tags = {**tags, **(w_obj.get("tags") or {})}
                    w_nids = w_obj.get("nodes", [])
                    if len(w_nids) >= 4 and w_nids[0] == w_nids[-1]:
                        pts = nodes_to_pts(w_nids, tol=0.015)
                        if len(pts) >= 3:
                            if not parent_name:
                                parent_name = extract_display_name(w_tags)
                            register_candidate(o_wid, w_tags, pts, [], is_part=False, group_id=rel["id"], from_bld_rel=True)

                for o_rid in outline_rels:
                    consumed_rel_ids.add(o_rid)
                    o_rel = rel_by_id[o_rid]
                    o_tags = {**tags, **(o_rel.get("tags") or {})}
                    if not parent_name:
                        parent_name = extract_display_name(o_tags)
                    if o_rid in stitched_rel_polys:
                        o_polys, i_polys, mw_ids = stitched_rel_polys[o_rid]
                        for wid in mw_ids:
                            used_way_ids_in_rel.add(wid)
                        for op in o_polys:
                            register_candidate(o_rid, o_tags, op, i_polys, is_part=False, group_id=rel["id"], from_bld_rel=True)

                for p_wid in part_ways:
                    used_way_ids_in_rel.add(p_wid)
                    w_obj = ways[p_wid]
                    w_tags = dict(w_obj.get("tags") or {})
                    if not extract_display_name(w_tags) and parent_name:
                        w_tags["name"] = parent_name
                    w_nids = w_obj.get("nodes", [])
                    if len(w_nids) >= 4 and w_nids[0] == w_nids[-1]:
                        pts = nodes_to_pts(w_nids, tol=0.015)
                        if len(pts) >= 3:
                            register_candidate(p_wid, w_tags, pts, [], is_part=True, group_id=rel["id"], from_bld_rel=True)

                for p_rid in part_rels:
                    consumed_rel_ids.add(p_rid)
                    p_rel = rel_by_id[p_rid]
                    p_tags = dict(p_rel.get("tags") or {})
                    if not extract_display_name(p_tags) and parent_name:
                        p_tags["name"] = parent_name
                    if p_rid in stitched_rel_polys:
                        o_polys, i_polys, mw_ids = stitched_rel_polys[p_rid]
                        for wid in mw_ids:
                            used_way_ids_in_rel.add(wid)
                        for op in o_polys:
                            register_candidate(p_rid, p_tags, op, i_polys, is_part=True, group_id=rel["id"], from_bld_rel=True)

    # Pass 1C: Process remaining Multipolygon Relations
    for rel in relations:
        if rel["id"] in consumed_rel_ids:
            continue
        tags = rel.get("tags", {})
        if not tags:
            continue

        has_bld = "building" in tags and str(tags.get("building")).lower() not in SKIP_BUILDING_VALS
        has_part = "building:part" in tags and str(tags.get("building:part")).lower() not in SKIP_BUILDING_VALS
        if has_bld or has_part:
            if rel["id"] in stitched_rel_polys:
                o_polys, i_polys, mw_ids = stitched_rel_polys[rel["id"]]
                for wid in mw_ids:
                    used_way_ids_in_rel.add(wid)
                is_part = has_part and not has_bld
                for op in o_polys:
                    register_candidate(rel["id"], tags, op, i_polys, is_part=is_part, group_id=None, from_bld_rel=False)
            continue

        if rel["id"] in stitched_rel_polys:
            outer_polys, inner_polys, mw_ids = stitched_rel_polys[rel["id"]]
            process_multipolygon_terrain_feature(
                tags, outer_polys, inner_polys, mw_ids,
                used_way_ids_in_rel, water_polys, green_polys, bridge_polys, road_polys,
            )

    # Pass 2: Process Standalone Ways
    for wid, w in ways.items():
        tags = w.get("tags", {})
        if not tags:
            continue
        nids = w.get("nodes", [])
        if len(nids) < 2:
            continue
        is_closed = nids[0] == nids[-1] and len(nids) >= 4

        has_bld = "building" in tags and str(tags.get("building")).lower() not in SKIP_BUILDING_VALS
        has_part = "building:part" in tags and str(tags.get("building:part")).lower() not in SKIP_BUILDING_VALS
        if (has_bld or has_part) and is_closed:
            if wid not in used_way_ids_in_rel:
                pts = nodes_to_pts(nids, tol=0.015)
                if len(pts) >= 3:
                    register_candidate(wid, tags, pts, [], is_part=(has_part and not has_bld))
            continue

        process_way_terrain_feature(
            wid, tags, nids, is_closed, nodes, nodes_to_pts, used_way_ids_in_rel,
            meters_to_units, half_w, half_h, coastline_ways, bridge_polys, buildings,
            water_polys, water_lines, green_polys, tree_nodes, road_polys, roads,
        )

    match_and_emit_s3db(buildings, candidate_parents, candidate_parts, meters_to_units, half_w, half_h)

    for idx, b in enumerate(buildings, start=1):
        b["id"] = idx

    if coastline_ways:
        water_polys.extend(build_sea_polygons_from_coastlines(coastline_ways, R=max(half_w, half_h) + 7.4))

    filtered_trees = populate_park_trees(tree_nodes, green_polys, half_w, half_h)

    scene = {
        "bbox": [south, west, north, east],
        "center": [round(center_lat, 5), round(center_lon, 5)],
        "spanMeters": round(max_span_m, 1),
        "metersToUnits": round(meters_to_units, 5),
        "halfW": half_w,
        "halfH": half_h,
        "_fetchedCropRatio": 0.88,
        "title": title_hint or f"N {center_lat:.3f}° E {center_lon:.3f}°",
        "dem": dem_data,
        "waterPolys": water_polys,
        "waterLines": water_lines,
        "greenPolys": green_polys,
        "trees": filtered_trees,
        "roads": roads,
        "roadPolys": road_polys,
        "bridgePolys": bridge_polys,
        "buildings": buildings,
    }

    if not validate_processed_scene(scene):
        raise RuntimeError(f"Incomplete GIS scene for [{south}, {west}, {north}, {east}]")

    for target_cache in (v5_cache, v4_cache):
        with open(target_cache, "w", encoding="utf-8") as f:
            json.dump(scene, f, separators=(",", ":"))

    legacy_cache = os.path.join(CACHE_DIR, f"scene_v3_{key_str}.json")
    if os.path.exists(legacy_cache):
        with open(legacy_cache, "w", encoding="utf-8") as f:
            json.dump(scene, f, separators=(",", ":"))

    return scene
