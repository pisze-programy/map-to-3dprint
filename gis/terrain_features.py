#!/usr/bin/env python3
"""
gis/terrain_features.py
Extracts authentic OSM water polygons/lines, parks/forests, pedestrian plazas (roadPolys),
2D architectural bridge outlines (bridgePolys), street/footpath centrelines, and Halton-sampled trees.
"""
import math

from .geometry import parse_float_tag, simplify_ring, point_in_poly, poly_area_signed
from .s3db_models import add_building_record


def process_multipolygon_terrain_feature(
    tags,
    outer_polys,
    inner_polys,
    mw_ids,
    used_way_ids_in_rel,
    water_polys,
    green_polys,
    bridge_polys,
    road_polys,
):
    """Classifies non-building OSM multipolygons into water, greenery, bridge decks, or plazas."""
    is_water = (
        tags.get("natural") == "water"
        or tags.get("waterway") in ("riverbank", "dock", "canal")
        or "water" in tags
        or tags.get("landuse") in ("reservoir", "basin")
    )
    is_green = (
        tags.get("leisure") in ("park", "garden", "nature_reserve", "pitch", "playground", "common", "golf_course", "recreation_ground")
        or tags.get("landuse") in ("forest", "grass", "meadow", "village_green", "recreation_ground", "cemetery", "allotments", "farmland", "orchard", "vineyard")
        or tags.get("natural") in ("wood", "scrub", "grassland", "heath")
    )
    is_bridge_area = tags.get("man_made") == "bridge"
    is_plaza = (
        (tags.get("highway") in ("pedestrian", "footway", "living_street") and tags.get("area") != "no")
        or tags.get("place") == "square"
    )

    if is_water:
        for wid in mw_ids:
            used_way_ids_in_rel.add(wid)
        for op in outer_polys:
            water_polys.append({"outer": op, "holes": inner_polys, "name": tags.get("name", "Woda")})
    elif is_green:
        for wid in mw_ids:
            used_way_ids_in_rel.add(wid)
        for op in outer_polys:
            green_polys.append({
                "outer": op,
                "holes": inner_polys,
                "type": tags.get("leisure") or tags.get("landuse") or tags.get("natural", "park"),
            })
    elif is_bridge_area:
        for wid in mw_ids:
            used_way_ids_in_rel.add(wid)
        layer_val = max(1, int(parse_float_tag(tags.get("layer"), 1) or 1))
        for op in outer_polys:
            bridge_polys.append({
                "outer": op,
                "holes": inner_polys,
                "layer": layer_val,
                "name": tags.get("name", ""),
            })
    elif is_plaza:
        for wid in mw_ids:
            used_way_ids_in_rel.add(wid)
        is_br = tags.get("bridge") not in (None, "", "no", "false", "0", "none")
        if not is_br:
            for op in outer_polys:
                road_polys.append({"outer": op, "holes": inner_polys, "name": tags.get("name", "")})


def process_way_terrain_feature(
    wid,
    tags,
    nids,
    is_closed,
    nodes,
    nodes_to_pts,
    used_way_ids_in_rel,
    meters_to_units,
    half_w,
    half_h,
    coastline_ways,
    bridge_polys,
    buildings,
    water_polys,
    water_lines,
    green_polys,
    tree_nodes,
    road_polys,
    roads,
):
    """Processes standalone OSM ways for coastlines, bridges, piers, water, greenery, plazas, and streets."""
    if tags.get("natural") == "coastline":
        pts = [nodes[nid] for nid in nids if nid in nodes]
        if len(pts) >= 2:
            coastline_ways.append(pts)
        return

    if tags.get("man_made") == "bridge" and is_closed:
        if wid not in used_way_ids_in_rel:
            pts = nodes_to_pts(nids, tol=0.025)
            if len(pts) >= 3:
                layer_val = max(1, int(parse_float_tag(tags.get("layer"), 1) or 1))
                bridge_polys.append({"outer": pts, "holes": [], "layer": layer_val, "name": tags.get("name", "")})
        return

    if tags.get("man_made") in ("pier", "breakwater", "groyne") and is_closed:
        pts = nodes_to_pts(nids, tol=0.05)
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
                meters_to_units=meters_to_units, half_w=half_w, half_h=half_h,
            )
        return

    if tags.get("natural") == "water" or tags.get("waterway") in ("riverbank", "dock") or tags.get("landuse") in ("reservoir", "basin"):
        if wid not in used_way_ids_in_rel and is_closed:
            pts = nodes_to_pts(nids, tol=0.04)
            if len(pts) >= 3:
                water_polys.append({"outer": pts, "holes": [], "name": tags.get("name", "Woda")})
        return

    if "waterway" in tags and tags["waterway"] in ("river", "canal", "stream", "dock"):
        if tags.get("tunnel") in ("yes", "culvert"):
            return
        pts = simplify_ring([nodes[nid] for nid in nids if nid in nodes], tol=0.06)
        if len(pts) >= 2:
            w_m = parse_float_tag(tags.get("width"), None)
            if not w_m:
                w_m = 16.0 if tags["waterway"] == "river" else 8.0 if tags["waterway"] == "canal" else 3.0
            water_lines.append({
                "pts": pts,
                "width": round(max(0.35, w_m * meters_to_units), 2),
                "name": tags.get("name", tags["waterway"]),
            })
        return

    if (
        tags.get("leisure") in ("park", "garden", "nature_reserve", "pitch", "playground", "common", "golf_course", "recreation_ground")
        or tags.get("landuse") in ("forest", "grass", "meadow", "village_green", "recreation_ground", "cemetery", "allotments", "farmland", "orchard", "vineyard")
        or tags.get("natural") in ("wood", "scrub", "grassland", "heath")
    ) and is_closed:
        if wid not in used_way_ids_in_rel:
            pts = nodes_to_pts(nids, tol=0.05)
            if len(pts) >= 3:
                green_polys.append({
                    "outer": pts,
                    "holes": [],
                    "type": tags.get("leisure") or tags.get("landuse") or tags.get("natural", "park"),
                })
        return

    if tags.get("natural") == "tree_row":
        pts = [nodes[nid] for nid in nids if nid in nodes]
        for i in range(len(pts) - 1):
            p0, p1 = pts[i], pts[i + 1]
            dist = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
            steps = max(1, int(dist / 1.2))
            for s in range(steps + 1):
                t = s / steps
                tx = p0[0] + (p1[0] - p0[0]) * t
                ty = p0[1] + (p1[1] - p0[1]) * t
                if -half_w - 0.5 <= tx <= half_w + 0.5 and -half_h - 0.5 <= ty <= half_h + 0.5:
                    tree_nodes.append([round(tx, 2), round(ty, 2), 9.0])
        return

    if is_closed and wid not in used_way_ids_in_rel and (
        tags.get("place") == "square"
        or (tags.get("highway") in ("pedestrian", "footway", "living_street", "service") and tags.get("area") == "yes")
    ):
        if tags.get("tunnel") not in ("yes", "building_passage") and (parse_float_tag(tags.get("layer"), 0) or 0) >= 0:
            pts = nodes_to_pts(nids, tol=0.05)
            if len(pts) >= 3:
                road_polys.append({"outer": pts, "holes": [], "name": tags.get("name", "")})
            return

    if "highway" in tags or "railway" in tags or tags.get("man_made") in ("bridge", "pier", "breakwater", "groyne"):
        if tags.get("tunnel") in ("yes", "building_passage", "culvert") or tags.get("covered") == "yes" or tags.get("indoor") == "yes":
            return
        layer_val = int(parse_float_tag(tags.get("layer"), 0) or 0)
        if layer_val < 0:
            return

        hwy = tags.get("highway") or tags.get("railway") or tags.get("man_made") or "bridge"
        if hwy in ("proposed", "construction", "platform", "bus_stop", "elevator", "rest_area"):
            return

        bridge_tag = tags.get("bridge")
        is_bridge = (
            (bridge_tag not in (None, "", "no", "false", "0", "none"))
            or tags.get("man_made") in ("bridge", "pier", "breakwater", "groyne")
        )

        is_path = hwy in ("footway", "path", "cycleway", "steps", "bridleway", "track", "corridor", "pedestrian")
        if is_path:
            if not is_bridge and tags.get("footway") in ("sidewalk", "crossing", "access_aisle", "island"):
                return
            if not is_bridge and tags.get("cycleway") in ("sidewalk", "crossing"):
                return
            road_w_m = 3.2 if hwy == "pedestrian" else 2.2
        elif hwy in ("motorway", "trunk"):
            road_w_m = 12.5
        elif hwy == "primary":
            road_w_m = 10.5
        elif hwy in ("secondary", "motorway_link", "trunk_link"):
            road_w_m = 8.5
        elif hwy in ("tertiary", "primary_link", "secondary_link"):
            road_w_m = 7.2
        elif hwy in ("rail", "light_rail", "tram", "narrow_gauge"):
            if hwy in ("subway", "monorail") and not is_bridge:
                return
            road_w_m = 4.2
        elif hwy == "service":
            road_w_m = 3.6 if (not is_bridge and tags.get("service") in ("parking_aisle", "driveway", "alley")) else 4.8
        else:
            road_w_m = 6.2

        explicit_w = parse_float_tag(tags.get("width"), None)
        if explicit_w is not None and 1.2 <= explicit_w <= 28.0:
            road_w_m = explicit_w

        pts = simplify_ring([nodes[nid] for nid in nids if nid in nodes], tol=0.05)
        if len(pts) >= 2:
            roads.append({
                "pts": pts,
                "width": round(max(0.24, road_w_m * meters_to_units), 3),
                "hwy": hwy,
                "isPath": bool(is_path and hwy != "pedestrian"),
                "bridge": bool(is_bridge),
                "layer": layer_val,
                "name": tags.get("name", ""),
            })


def populate_park_trees(tree_nodes, green_polys, half_w, half_h):
    """Deduplicates explicit OSM trees and adds Halton-distributed canopy trees inside wooded parks."""
    filtered_trees = []
    grid_buckets = {}
    for tx, ty, th in tree_nodes:
        bx, by = int(tx // 0.65), int(ty // 0.65)
        too_close = any(
            (tx - ox) ** 2 + (ty - oy) ** 2 < 0.42
            for dx in (-1, 0, 1)
            for dy in (-1, 0, 1)
            for ox, oy in grid_buckets.get((bx + dx, by + dy), [])
        )
        if not too_close:
            grid_buckets.setdefault((bx, by), []).append((tx, ty))
            filtered_trees.append([tx, ty, th])

    for gp in green_polys:
        gtype = gp["type"]
        if gtype in ("grass", "meadow", "pitch", "playground", "farmland", "allotments", "golf_course", "village_green"):
            continue
        outer = gp["outer"]
        area = abs(poly_area_signed(outer))
        if area < 4.0:
            continue
        is_wood = gtype in ("forest", "wood", "scrub", "nature_reserve")
        density = 0.24 if is_wood else 0.06
        target_count = min(75 if is_wood else 28, max(2, int(area * density)))
        xs = [p[0] for p in outer]
        ys = [p[1] for p in outer]
        min_x, max_x = max(-half_w + 0.6, min(xs)), min(half_w - 0.6, max(xs))
        min_y, max_y = max(-half_h + 0.6, min(ys)), min(half_h - 0.6, max(ys))
        if min_x >= max_x or min_y >= max_y:
            continue

        added = 0
        for idx in range(1, target_count * 5 + 1):
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
            if not point_in_poly(px, py, outer) or any(point_in_poly(px, py, h) for h in gp.get("holes", [])):
                continue
            bx, by = int(px // 0.95), int(py // 0.95)
            too_close = any(
                (px - ox) ** 2 + (py - oy) ** 2 < 0.85
                for dx in (-1, 0, 1)
                for dy in (-1, 0, 1)
                for ox, oy in grid_buckets.get((bx + dx, by + dy), [])
            )
            if too_close:
                continue
            grid_buckets.setdefault((bx, by), []).append((px, py))
            filtered_trees.append([round(px, 2), round(py, 2), round(7.5 + (idx % 5) * 1.1, 1)])
            added += 1

    return filtered_trees[:1600]
