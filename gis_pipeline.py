#!/usr/bin/env python3
"""
Complete GIS Processing Pipeline for Map3D Studio:
1. Fetches real AWS Terrarium DEM elevation tiles (zoom 14/15)
2. Fetches real OpenStreetMap Overpass vector data (relations, ways, nodes)
3. Stitches multipolygon relations (outer + inner rings for rivers, islands, parks, courtyard buildings)
4. S3DB building outline suppression & grouping (relations & standalone spatial containment)
5. Projects coordinates into metric print-bed space [-halfW, +halfW] x [-halfH, +halfH] mm (isotropic)
6. Extracts:
   - Water polygons (with island holes) & linear waterways
   - Green polygons (parks, forests, grass, gardens, meadows)
   - Real OSM trees (natural=tree, tree_row) + canopy trees inside parks/woods/riverbanks
   - Roads, pedestrian plazas, railways, and bridges (with layer and bridge flags)
   - Buildings & building:part with clean S3DB grouping, realistic heights, and verified roof shapes
"""
import json
import math
import os
import re
from fetch_gis import fetch_terrarium_dem_grid, fetch_osm_overpass, CACHE_DIR

from gis_geometry import (
    stitch_way_rings,
    parse_float_tag,
    simplify_ring,
    point_in_poly,
    poly_area_signed,
    build_sea_polygons_from_coastlines,
    validate_processed_scene,
)

ROOF_SHAPES_NORM = {
    "flat": "flat",
    "gabled": "gabled",
    "gable": "gabled",
    "hipped": "hipped",
    "hip": "hipped",
    "half-hipped": "hipped",
    "pyramidal": "pyramidal",
    "pyramid": "pyramidal",
    "skillion": "skillion",
    "shed": "skillion",
    "dome": "dome",
    "round": "dome",
    "onion": "onion",
    "cone": "cone",
    "conical": "cone",
    "mansard": "mansard",
    "gambrel": "gambrel",
}


def build_scene_from_bbox(south, west, north, east, title_hint="", force_rebuild=False):
    """Fetches and processes real DEM + real OSM data for [south, west, north, east]."""
    key_str = f"{south:.4f}_{west:.4f}_{north:.4f}_{east:.4f}"
    v5_cache = os.path.join(CACHE_DIR, f"scene_v5_{key_str}.json")
    v4_cache = os.path.join(CACHE_DIR, f"scene_v4_{key_str}.json")

    if not force_rebuild:
        for pc in (v5_cache, v4_cache):
            if os.path.exists(pc):
                try:
                    with open(pc, "r", encoding="utf-8") as f:
                        cached = json.load(f)
                    if validate_processed_scene(cached):
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

    # Sample DEM over the exact metric square enclosing [-halfW, +halfW] x [-halfH, +halfH]
    half_m = max_span_m * 0.5
    sq_dlat = half_m / 111320.0
    sq_dlon = half_m / (111320.0 * cos_lat)
    dem_data = fetch_terrarium_dem_grid(
        center_lat - sq_dlat,
        center_lon - sq_dlon,
        center_lat + sq_dlat,
        center_lon + sq_dlon,
        grid_size=72,
        zoom=14
    )

    # Fetch real OpenStreetMap vectors
    osm_raw = fetch_osm_overpass(south, west, north, east)
    elements = osm_raw.get("elements", [])

    def project(lon, lat):
        mx = (lon - center_lon) * 111320.0 * cos_lat * meters_to_units
        my = (lat - center_lat) * 111320.0 * meters_to_units
        return [round(mx, 2), round(my, 2)]

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
                    h_m = parse_float_tag(tags.get("height"), 12.0)
                    tree_nodes.append([round(pt[0], 2), round(pt[1], 2), round(h_m, 1)])
        elif etype == "way":
            ways[el["id"]] = el
        elif etype == "relation":
            relations.append(el)

    def nodes_to_pts(nid_list, tol=0.14):
        pts = [nodes[nid] for nid in nid_list if nid in nodes]
        return simplify_ring(pts, tol=tol)

    water_polys = []
    water_lines = []
    coastline_ways = []
    green_polys = []
    roads = []
    buildings = []
    used_way_ids_in_rel = set()

    # 1. Process Multipolygon & Building Relations
    for rel in relations:
        tags = rel.get("tags", {})
        members = rel.get("members", [])
        rel_type = tags.get("type", "")

        is_water = (
            tags.get("natural") == "water" or
            tags.get("waterway") == "riverbank" or
            "water" in tags or
            tags.get("landuse") in ("reservoir", "basin")
        )
        is_green = (
            tags.get("leisure") in ("park", "garden", "nature_reserve", "pitch", "playground", "common") or
            tags.get("landuse") in ("forest", "grass", "meadow", "village_green", "recreation_ground", "cemetery", "allotments", "farmland") or
            tags.get("natural") in ("wood", "scrub", "grassland", "heath")
        )
        is_building = (
            rel_type == "building" or
            "building" in tags or
            "building:part" in tags or
            any(m.get("role") in ("part", "outline") for m in members)
        )

        if is_building:
            part_member_refs = []
            outline_member_refs = []
            inner_member_refs = []
            outer_member_refs = []

            for m in members:
                if m.get("type") == "way" and m.get("ref") in ways:
                    role = m.get("role", "outer")
                    ref = m["ref"]
                    if role == "part":
                        part_member_refs.append(ref)
                    elif role == "outline":
                        outline_member_refs.append(ref)
                    elif role == "inner":
                        inner_member_refs.append(ref)
                    else:
                        outer_member_refs.append(ref)

            if part_member_refs:
                # S3DB building relation with parts: suppress outline, emit parts with shared groupId
                parent_name = tags.get("name") or tags.get("name:en") or tags.get("name:pl") or ""
                # Suppress outline ways from standalone extrusion
                for ref in outline_member_refs + outer_member_refs:
                    used_way_ids_in_rel.add(ref)

                for ref in part_member_refs:
                    used_way_ids_in_rel.add(ref)
                    w_obj = ways[ref]
                    w_tags = dict(w_obj.get("tags", {}))
                    w_nids = w_obj.get("nodes", [])
                    if len(w_nids) >= 4 and w_nids[0] == w_nids[-1]:
                        pts = nodes_to_pts(w_nids, tol=0.10)
                        if len(pts) >= 3:
                            if not w_tags.get("name") and parent_name:
                                w_tags["name"] = parent_name
                            add_building_record(
                                buildings, ref, w_tags, pts, [],
                                group_id=rel["id"], is_part=True,
                                meters_to_units=meters_to_units,
                                half_w=half_w, half_h=half_h
                            )
                continue

            # Standard building multipolygon (courtyards)
            outer_ways = [ways[ref].get("nodes", []) for ref in (outer_member_refs or outline_member_refs) if ref in ways]
            inner_ways = [ways[ref].get("nodes", []) for ref in inner_member_refs if ref in ways]
            for ref in outer_member_refs + outline_member_refs + inner_member_refs:
                used_way_ids_in_rel.add(ref)

            if outer_ways:
                outer_rings = stitch_way_rings(outer_ways)
                inner_rings = stitch_way_rings(inner_ways)
                outer_polys = [nodes_to_pts(r, tol=0.14) for r in outer_rings]
                outer_polys = [p for p in outer_polys if len(p) >= 3]
                inner_polys = [nodes_to_pts(r, tol=0.14) for r in inner_rings]
                inner_polys = [p for p in inner_polys if len(p) >= 3]
                for op in outer_polys:
                    add_building_record(
                        buildings, rel["id"], tags, op, inner_polys,
                        group_id=rel["id"], is_part=False,
                        meters_to_units=meters_to_units,
                        half_w=half_w, half_h=half_h
                    )
            continue

        # Water or Green multipolygons
        outer_ways = []
        inner_ways = []
        for m in members:
            if m.get("type") == "way" and m.get("ref") in ways:
                role = m.get("role", "outer")
                w_nodes = ways[m["ref"]].get("nodes", [])
                if role == "inner":
                    inner_ways.append(w_nodes)
                else:
                    outer_ways.append(w_nodes)
                    used_way_ids_in_rel.add(m["ref"])

        if not outer_ways:
            continue

        outer_rings = stitch_way_rings(outer_ways)
        inner_rings = stitch_way_rings(inner_ways)
        outer_polys = [nodes_to_pts(r, tol=0.14) for r in outer_rings]
        outer_polys = [p for p in outer_polys if len(p) >= 3]
        inner_polys = [nodes_to_pts(r, tol=0.14) for r in inner_rings]
        inner_polys = [p for p in inner_polys if len(p) >= 3]

        if not outer_polys:
            continue

        if is_water:
            for op in outer_polys:
                water_polys.append({
                    "outer": op,
                    "holes": inner_polys,
                    "name": tags.get("name", "Woda")
                })
        elif is_green:
            for op in outer_polys:
                green_polys.append({
                    "outer": op,
                    "holes": inner_polys,
                    "type": tags.get("leisure") or tags.get("landuse") or tags.get("natural", "park")
                })

    # 2. Process Standalone Ways (Candidate Parents & Candidate Parts)
    candidate_parents = []
    candidate_parts = []

    for wid, w in ways.items():
        tags = w.get("tags", {})
        if not tags:
            continue
        nids = w.get("nodes", [])
        if len(nids) < 2:
            continue
        is_closed = (nids[0] == nids[-1] and len(nids) >= 4)

        # Buildings & building:part
        if ("building" in tags or "building:part" in tags) and is_closed:
            if wid in used_way_ids_in_rel:
                continue
            pts = nodes_to_pts(nids, tol=0.10)
            if len(pts) >= 3:
                xs = [p[0] for p in pts]
                ys = [p[1] for p in pts]
                cx = sum(xs) / len(xs)
                cy = sum(ys) / len(ys)
                if abs(cx) <= half_w + 3.0 and abs(cy) <= half_h + 3.0:
                    bbox = (min(xs), min(ys), max(xs), max(ys))
                    area = abs(poly_area_signed(pts))
                    is_part = ("building:part" in tags)
                    rec = {
                        "wid": wid,
                        "tags": dict(tags),
                        "pts": pts,
                        "cx": cx,
                        "cy": cy,
                        "bbox": bbox,
                        "area": area,
                        "hasParts": False,
                        "groupId": None,
                        "isPart": is_part,
                    }
                    if is_part:
                        candidate_parts.append(rec)
                    else:
                        candidate_parents.append(rec)
            continue

        # Coastline ways (land on left, sea/ocean on right)
        if tags.get("natural") == "coastline":
            pts = [nodes[nid] for nid in nids if nid in nodes]
            if len(pts) >= 2:
                coastline_ways.append(pts)
            continue

        # Closed piers / breakwaters / bridge decks
        if tags.get("man_made") in ("pier", "breakwater", "groyne", "bridge") and is_closed:
            pts = nodes_to_pts(nids, tol=0.10)
            if len(pts) >= 3:
                pier_tags = dict(tags)
                pier_tags["building"] = "pier"
                pier_tags["height"] = "3.5"
                pier_tags["roof:shape"] = "flat"
                pier_tags["roof:height"] = "0.0"
                if not pier_tags.get("name"):
                    pier_tags["name"] = f"Molo / Pomost #{wid}"
                add_building_record(
                    buildings, wid, pier_tags, pts, [],
                    group_id=wid, is_part=False,
                    meters_to_units=meters_to_units,
                    half_w=half_w, half_h=half_h
                )
            continue

        # Water polygons & linear waterways
        if tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or tags.get("landuse") in ("reservoir", "basin"):
            if wid not in used_way_ids_in_rel and is_closed:
                pts = nodes_to_pts(nids, tol=0.14)
                if len(pts) >= 3:
                    water_polys.append({"outer": pts, "holes": [], "name": tags.get("name", "Woda")})
            continue

        if "waterway" in tags and tags["waterway"] in ("river", "canal", "stream", "dock"):
            if tags.get("tunnel") == "yes":
                continue
            pts = simplify_ring([nodes[nid] for nid in nids if nid in nodes], tol=0.18)
            if len(pts) >= 2:
                w_m = parse_float_tag(tags.get("width"), None)
                if not w_m:
                    w_m = 18.0 if tags["waterway"] == "river" else 8.0 if tags["waterway"] == "canal" else 3.5
                water_lines.append({
                    "pts": pts,
                    "width": round(max(0.6, w_m * meters_to_units), 2),
                    "name": tags.get("name", tags["waterway"])
                })
            continue

        # Green areas
        if (
            tags.get("leisure") in ("park", "garden", "nature_reserve", "pitch", "playground", "common") or
            tags.get("landuse") in ("forest", "grass", "meadow", "village_green", "recreation_ground", "cemetery", "allotments", "farmland") or
            tags.get("natural") in ("wood", "scrub", "grassland", "heath")
        ) and is_closed:
            if wid not in used_way_ids_in_rel:
                pts = nodes_to_pts(nids, tol=0.16)
                if len(pts) >= 3:
                    green_polys.append({
                        "outer": pts,
                        "holes": [],
                        "type": tags.get("leisure") or tags.get("landuse") or tags.get("natural", "park")
                    })
            continue

        # Tree rows
        if tags.get("natural") == "tree_row":
            pts = [nodes[nid] for nid in nids if nid in nodes]
            for i in range(len(pts) - 1):
                p0, p1 = pts[i], pts[i + 1]
                dist = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
                steps = max(1, int(dist / 1.4))
                for s in range(steps + 1):
                    t = s / steps
                    tx = p0[0] + (p1[0] - p0[0]) * t
                    ty = p0[1] + (p1[1] - p0[1]) * t
                    if -half_w - 0.5 <= tx <= half_w + 0.5 and -half_h - 0.5 <= ty <= half_h + 0.5:
                        tree_nodes.append([round(tx, 2), round(ty, 2), 12.0])
            continue

        # Highways, Railways, Bridges & Linear Piers
        if "highway" in tags or "railway" in tags or tags.get("man_made") in ("bridge", "pier", "breakwater", "groyne"):
            if tags.get("tunnel") in ("yes", "building_passage", "culvert") or tags.get("covered") == "yes":
                continue
            layer_val = int(parse_float_tag(tags.get("layer"), 0) or 0)
            if layer_val < 0:
                continue

            hwy = tags.get("highway") or tags.get("railway") or tags.get("man_made") or "bridge"
            bridge_tag = tags.get("bridge")
            is_bridge = (
                (bridge_tag not in (None, "", "no", "false", "0", "none")) or
                tags.get("man_made") in ("bridge", "pier", "breakwater", "groyne")
            )

            if hwy in ("footway", "path", "cycleway", "steps", "bridleway", "track", "corridor", "pedestrian"):
                if not is_bridge and tags.get("footway") in ("sidewalk", "crossing"):
                    continue
                road_w_m = 2.2
            elif hwy in ("motorway", "trunk", "primary"):
                road_w_m = 11.5
            elif hwy in ("secondary", "tertiary", "motorway_link", "trunk_link", "primary_link"):
                road_w_m = 8.8
            elif hwy in ("rail", "light_rail", "tram"):
                road_w_m = 5.0
            else:
                road_w_m = 6.2

            pts = simplify_ring([nodes[nid] for nid in nids if nid in nodes], tol=0.16)
            if len(pts) >= 2:
                roads.append({
                    "pts": pts,
                    "width": round(max(0.4, road_w_m * meters_to_units), 2),
                    "hwy": hwy,
                    "bridge": bool(is_bridge),
                    "layer": layer_val,
                    "name": tags.get("name", "")
                })

    # 3. Simple 3D Buildings (S3DB) Spatial Matching & Outline Suppression
    for part in candidate_parts:
        best_parent = None
        best_area = float("inf")
        p_bbox = part["bbox"]
        p_cx, p_cy = part["cx"], part["cy"]
        p_pts = part["pts"]
        p_len = len(p_pts)

        for parent in candidate_parents:
            par_bbox = parent["bbox"]
            if (p_bbox[0] > par_bbox[2] + 0.1 or p_bbox[2] < par_bbox[0] - 0.1 or
                p_bbox[1] > par_bbox[3] + 0.1 or p_bbox[3] < par_bbox[1] - 0.1):
                continue
            if point_in_poly(p_cx, p_cy, parent["pts"]):
                if parent["area"] < best_area:
                    best_area = parent["area"]
                    best_parent = parent
                continue
            in_cnt = sum(1 for pt in p_pts if point_in_poly(pt[0], pt[1], parent["pts"]))
            if in_cnt >= p_len * 0.5:
                if parent["area"] < best_area:
                    best_area = parent["area"]
                    best_parent = parent

        if best_parent:
            best_parent["hasParts"] = True
            part["groupId"] = best_parent["wid"]
            if not part["tags"].get("name"):
                par_name = best_parent["tags"].get("name") or best_parent["tags"].get("name:en") or best_parent["tags"].get("name:pl")
                if par_name:
                    part["tags"]["name"] = par_name
        else:
            part["groupId"] = part["wid"]

    # Emit surviving parts
    for part in candidate_parts:
        add_building_record(
            buildings, part["wid"], part["tags"], part["pts"], [],
            group_id=part["groupId"], is_part=True,
            meters_to_units=meters_to_units,
            half_w=half_w, half_h=half_h
        )

    # Emit surviving parents (suppress any parent outline that contains >= 1 part)
    for parent in candidate_parents:
        if not parent["hasParts"]:
            add_building_record(
                buildings, parent["wid"], parent["tags"], parent["pts"], [],
                group_id=parent["wid"], is_part=False,
                meters_to_units=meters_to_units,
                half_w=half_w, half_h=half_h
            )

    # Re-index building IDs sequentially
    for idx, b in enumerate(buildings, start=1):
        b["id"] = idx

    # Convert any natural=coastline chains into closed sea/ocean water polygons
    if coastline_ways:
        sea_polys = build_sea_polygons_from_coastlines(coastline_ways, R=max(half_w, half_h) + 7.4)
        water_polys.extend(sea_polys)

    # Deduplicate tree nodes
    filtered_trees = []
    grid_buckets = {}
    for tx, ty, th in tree_nodes:
        bx, by = int(tx // 0.85), int(ty // 0.85)
        too_close = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for ox, oy in grid_buckets.get((bx + dx, by + dy), []):
                    if (tx - ox) ** 2 + (ty - oy) ** 2 < 0.65:
                        too_close = True
                        break
                if too_close:
                    break
            if too_close:
                break
        if not too_close:
            grid_buckets.setdefault((bx, by), []).append((tx, ty))
            filtered_trees.append([tx, ty, th])

    # Supplement forest/wood/park/scrub polygons with dense canopy trees
    for gp in green_polys:
        gtype = gp["type"]
        outer = gp["outer"]
        area = abs(poly_area_signed(outer))
        if area < 3.0:
            continue
        density = 0.28 if gtype in ("forest", "wood", "scrub", "nature_reserve") else 0.14
        target_count = min(90, max(3, int(area * density)))
        xs = [p[0] for p in outer]
        ys = [p[1] for p in outer]
        min_x, max_x = max(-half_w + 0.6, min(xs)), min(half_w - 0.6, max(xs))
        min_y, max_y = max(-half_h + 0.6, min(ys)), min(half_h - 0.6, max(ys))
        if min_x >= max_x or min_y >= max_y:
            continue

        added = 0
        for idx in range(1, target_count * 4 + 1):
            if added >= target_count:
                break
            u, f2, i2 = 0.0, 0.5, idx
            while i2 > 0:
                u += f2 * (i2 % 2)
                i2 //= 2
                f2 *= 0.5
            v, f3, i3 = 0.0, 1.0 / 3.0, idx
            while i3 > 0:
                v += f3 * (i3 % 3)
                i3 //= 3
                f3 /= 3.0

            px = min_x + u * (max_x - min_x)
            py = min_y + v * (max_y - min_y)
            if not point_in_poly(px, py, outer):
                continue
            if any(point_in_poly(px, py, h) for h in gp.get("holes", [])):
                continue
            bx, by = int(px // 1.15), int(py // 1.15)
            too_close = False
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for ox, oy in grid_buckets.get((bx + dx, by + dy), []):
                        if (px - ox) ** 2 + (py - oy) ** 2 < 1.2:
                            too_close = True
                            break
                    if too_close:
                        break
                if too_close:
                    break
            if too_close:
                continue
            grid_buckets.setdefault((bx, by), []).append((px, py))
            filtered_trees.append([round(px, 2), round(py, 2), round(10.0 + (idx % 6) * 1.5, 1)])
            added += 1

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
        "trees": filtered_trees[:1800],
        "roads": roads,
        "buildings": buildings
    }

    if not validate_processed_scene(scene):
        raise RuntimeError(
            f"Incomplete GIS scene for [{south}, {west}, {north}, {east}]: "
            f"{len(buildings)} buildings, {len(roads)} roads, {len(green_polys)} greenPolys, {len(filtered_trees)} trees"
        )

    with open(v5_cache, "w", encoding="utf-8") as f:
        json.dump(scene, f, separators=(",", ":"))
    with open(v4_cache, "w", encoding="utf-8") as f:
        json.dump(scene, f, separators=(",", ":"))

    legacy_cache = os.path.join(CACHE_DIR, f"scene_v3_{key_str}.json")
    if os.path.exists(legacy_cache):
        with open(legacy_cache, "w", encoding="utf-8") as f:
            json.dump(scene, f, separators=(",", ":"))

    return scene


def add_building_record(
    buildings_list,
    osm_id,
    tags,
    outer_pts,
    inner_holes,
    group_id=None,
    is_part=False,
    meters_to_units=0.13,
    half_w=84.6,
    half_h=84.6
):
    xs = [p[0] for p in outer_pts]
    ys = [p[1] for p in outer_pts]
    cx = sum(xs) / len(xs)
    cy = sum(ys) / len(ys)
    if abs(cx) > half_w + 4.0 or abs(cy) > half_h + 4.0:
        return

    btype = tags.get("building") or tags.get("building:part") or "yes"
    name = tags.get("name") or tags.get("name:en") or tags.get("name:pl") or tags.get("addr:housename") or ""
    # If name is Arabic / non-Latin and name:en is available, prefer English name
    if any(ord(c) > 0x500 for c in name) and tags.get("name:en"):
        name = tags.get("name:en")
    street = tags.get("addr:street", "")
    housenum = tags.get("addr:housenumber", "")
    if not name and street:
        name = f"{street} {housenum}".strip()

    levels = parse_float_tag(tags.get("building:levels"), None)
    height_m = parse_float_tag(tags.get("height"), None)
    min_height_m = parse_float_tag(tags.get("min_height"), 0.0) or 0.0
    min_level = parse_float_tag(tags.get("building:min_level"), 0.0) or 0.0
    if min_height_m == 0.0 and min_level > 0:
        min_height_m = min_level * 3.3

    is_church = (
        btype in ("church", "cathedral", "chapel") or
        tags.get("amenity") == "place_of_worship" or
        any(w in (name or "").lower() for w in ("kirche", "kościół", "bazylika", "katedra", "church", "cathedral"))
    )
    is_tower = (
        btype in ("tower", "bell_tower", "water_tower") or
        tags.get("man_made") in ("tower", "chimney", "lighthouse") or
        "tower:type" in tags
    )

    if height_m is None:
        if levels is not None:
            height_m = levels * 3.6 + (3.8 if not is_part else 0.0)
        elif is_church:
            height_m = 32.0
        elif is_tower:
            height_m = 52.0
        elif btype in ("public", "civic", "museum", "university", "palace", "government", "train_station", "hotel"):
            area = abs(poly_area_signed(outer_pts))
            height_m = 14.5 if (btype == "museum" and area > 250.0) else 22.0
        elif btype in ("apartments", "residential", "commercial", "office", "retail"):
            area = abs(poly_area_signed(outer_pts))
            height_m = 20.0 if area > 7.5 else 16.0
        elif btype in ("garage", "shed", "hut", "kiosk", "roof"):
            height_m = 4.5
        else:
            area = abs(poly_area_signed(outer_pts))
            height_m = 18.5 if area > 5.5 else 14.0

    if min_height_m >= height_m - 0.5:
        min_height_m = 0.0

    if levels is None:
        levels = max(1, int(round(height_m / 3.5)))

    # Roof Shape & Height: never invent fake hipped roofs!
    raw_roof = str(tags.get("roof:shape", "")).lower().strip()
    if raw_roof:
        roof_shape = ROOF_SHAPES_NORM.get(raw_roof, "flat")
    elif is_church:
        roof_shape = "gabled"
    else:
        roof_shape = "flat"

    if roof_shape == "flat":
        roof_height_m = 0.0
    else:
        roof_h_tag = parse_float_tag(tags.get("roof:height"), None)
        roof_lvl_tag = parse_float_tag(tags.get("roof:levels"), None)
        if roof_h_tag is not None:
            roof_height_m = roof_h_tag
        elif roof_lvl_tag is not None:
            roof_height_m = roof_lvl_tag * 3.0
        else:
            span_x_m = (max(xs) - min(xs)) / max(1e-4, meters_to_units)
            span_y_m = (max(ys) - min(ys)) / max(1e-4, meters_to_units)
            min_span_m = max(2.0, min(span_x_m, span_y_m))
            roof_height_m = min(height_m * 0.35, min_span_m * 0.45, 12.0)

        # Clamp so roofH never exceeds h - minH or creates giant spikes
        avail_h = max(0.0, height_m - min_height_m - 0.5)
        roof_height_m = min(roof_height_m, avail_h)

    buildings_list.append({
        "id": len(buildings_list) + 1,
        "osmId": osm_id,
        "groupId": group_id if group_id is not None else osm_id,
        "name": name or (f"Kościół #{osm_id}" if is_church else (f"Część #{osm_id}" if is_part else f"Budynek OSM #{osm_id}")),
        "btype": btype,
        "cx": round(cx, 2),
        "cy": round(cy, 2),
        "outer": outer_pts,
        "holes": inner_holes,
        "h": round(height_m, 1),
        "minH": round(min_height_m, 1),
        "levels": int(levels),
        "roof": roof_shape,
        "roofH": round(roof_height_m, 1),
        "part": bool(is_part),
        "isOutline": False,
        "church": bool(is_church),
        "tower": bool(is_tower),
        "landmark": bool(tags.get("name") or is_church or is_tower or tags.get("heritage") or tags.get("wikidata"))
    })


if __name__ == "__main__":
    # Test on Munich
    s = build_scene_from_bbox(48.1280, 11.5769, 48.1396, 11.5941, "MÜNCHEN")
    print(
        f"Scene v5 ready: {len(s['waterPolys'])} water polys, {len(s['waterLines'])} water lines, "
        f"{len(s['greenPolys'])} green polys, {len(s['trees'])} trees, "
        f"{len(s['roads'])} roads, {len(s['buildings'])} buildings/parts"
    )
