#!/usr/bin/env python3
"""
Complete GIS Processing Pipeline for Map3D Studio:
1. Fetches real AWS Terrarium DEM elevation tiles (zoom 14/15)
2. Fetches real OpenStreetMap Overpass vector data (relations, ways, nodes)
3. Stitches multipolygon relations (outer + inner rings for rivers, islands, parks, courtyard buildings)
4. Projects coordinates into metric print-bed space [-85, +85] mm (scaled to 330x330mm on export)
5. Extracts:
   - Water polygons (with island holes) & linear waterways
   - Green polygons (parks, forests, grass, gardens, meadows)
   - Real OSM trees (natural=tree, tree_row) + canopy trees inside parks/woods/riverbanks
   - Roads, pedestrian plazas, railways, and bridges (with bridge pier positions)
   - Buildings & building:part with heights, roof shapes, spires, and inner courtyard holes
"""
import json
import math
import os
import re
from fetch_gis import fetch_terrarium_dem_grid, fetch_osm_overpass, CACHE_DIR


def stitch_way_rings(way_node_lists):
    """Stitches a list of node-ID lists into closed rings."""
    rings = []
    open_segs = [list(w) for w in way_node_lists if len(w) >= 2]
    while open_segs:
        curr = open_segs.pop(0)
        if curr[0] == curr[-1]:
            if len(curr) >= 4:
                rings.append(curr)
            continue
        changed = True
        while changed and curr[0] != curr[-1]:
            changed = False
            for i, seg in enumerate(open_segs):
                if seg[0] == curr[-1]:
                    curr.extend(seg[1:])
                    open_segs.pop(i)
                    changed = True
                    break
                elif seg[-1] == curr[-1]:
                    curr.extend(reversed(seg[:-1]))
                    open_segs.pop(i)
                    changed = True
                    break
                elif seg[-1] == curr[0]:
                    curr = seg[:-1] + curr
                    open_segs.pop(i)
                    changed = True
                    break
                elif seg[0] == curr[0]:
                    curr = list(reversed(seg[1:])) + curr
                    open_segs.pop(i)
                    changed = True
                    break
        if len(curr) >= 4:
            if curr[0] != curr[-1]:
                curr.append(curr[0])
            rings.append(curr)
    return rings


def parse_float_tag(val, default=None):
    if not val:
        return default
    m = re.search(r"[-+]?\d*\.?\d+", str(val).replace(",", "."))
    if m:
        try:
            return float(m.group(0))
        except ValueError:
            return default
    return default


def simplify_ring(pts, tol=0.14):
    """Light vertex deduplication in model space [-85, +85]."""
    if len(pts) < 4:
        return pts
    out = [pts[0]]
    tol_sq = tol * tol
    for p in pts[1:]:
        dx = p[0] - out[-1][0]
        dy = p[1] - out[-1][1]
        if dx * dx + dy * dy >= tol_sq:
            out.append(p)
    if len(out) >= 3 and out[0] == out[-1]:
        out.pop()
    return out


def point_in_poly(x, y, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def poly_area_signed(poly):
    a = 0.0
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return a * 0.5


def _ray_box_intersect(p_from, p_to, R=92.0):
    dx = p_to[0] - p_from[0]
    dy = p_to[1] - p_from[1]
    if abs(dx) < 1e-6 and abs(dy) < 1e-6:
        return [round(max(-R, min(R, p_to[0])), 2), round(max(-R, min(R, p_to[1])), 2)]
    best_t = None
    best_pt = None
    for edge_x in (-R, R):
        if abs(dx) > 1e-6:
            t = (edge_x - p_from[0]) / dx
            y = p_from[1] + t * dy
            if t > 0 and -R - 1e-3 <= y <= R + 1e-3:
                if best_t is None or t < best_t:
                    best_t = t
                    best_pt = [round(edge_x, 2), round(max(-R, min(R, y)), 2)]
    for edge_y in (-R, R):
        if abs(dy) > 1e-6:
            t = (edge_y - p_from[1]) / dy
            x = p_from[0] + t * dx
            if t > 0 and -R - 1e-3 <= x <= R + 1e-3:
                if best_t is None or t < best_t:
                    best_t = t
                    best_pt = [round(max(-R, min(R, x)), 2), round(edge_y, 2)]
    return best_pt or [round(max(-R, min(R, p_to[0])), 2), round(max(-R, min(R, p_to[1])), 2)]


def _cw_box_param(pt, R=92.0):
    x, y = pt[0], pt[1]
    if abs(y - R) < 0.05:
        return x + R
    if abs(x - R) < 0.05:
        return 2.0 * R + (R - y)
    if abs(y + R) < 0.05:
        return 4.0 * R + (R - x)
    return 6.0 * R + (y + R)


def build_sea_polygons_from_coastlines(coast_ways_pts, R=92.0):
    """
    Converts directed OSM natural=coastline ways (land on left, sea on right)
    into closed sea water polygons clipped/extended to [-R, R]^2.
    """
    if not coast_ways_pts:
        return []

    # 1. Stitch directed segments where end of A matches start of B
    chains = [list(seg) for seg in coast_ways_pts if len(seg) >= 2]
    merged = True
    while merged:
        merged = False
        for i in range(len(chains)):
            for j in range(len(chains)):
                if i == j:
                    continue
                end_i = chains[i][-1]
                start_j = chains[j][0]
                if math.hypot(end_i[0] - start_j[0], end_i[1] - start_j[1]) < 0.8:
                    chains[i] = chains[i] + chains[j][1:]
                    chains.pop(j)
                    merged = True
                    break
            if merged:
                break

    sea_polys = []
    island_holes = []
    corners = [
        (2.0 * R, [R, R]),
        (4.0 * R, [R, -R]),
        (6.0 * R, [-R, -R]),
        (8.0 * R, [-R, R]),
    ]

    for ch in chains:
        if len(ch) < 2:
            continue
        if len(ch) >= 4 and math.hypot(ch[0][0] - ch[-1][0], ch[0][1] - ch[-1][1]) < 1.0:
            # Closed loop: CCW (>0) is an island (land inside), CW (<0) is water inside
            if poly_area_signed(ch) > 0:
                island_holes.append(ch)
            else:
                sea_polys.append({"outer": ch, "holes": [], "name": "Morze / Ocean"})
            continue

        p_start = _ray_box_intersect(ch[1], ch[0], R)
        p_end = _ray_box_intersect(ch[-2], ch[-1], R)
        s_end = _cw_box_param(p_end, R)
        s_start = _cw_box_param(p_start, R)
        span = (s_start - s_end) % (8.0 * R)

        cw_corners = []
        for cs, cpt in sorted(corners, key=lambda c: (c[0] - s_end) % (8.0 * R)):
            dist = (cs - s_end) % (8.0 * R)
            if 0.05 < dist < span - 0.05:
                cw_corners.append(cpt)

        poly_pts = [p_start] + ch + [p_end] + cw_corners
        sea_polys.append({"outer": poly_pts, "holes": [], "name": "Morze / Zatoka"})

    if sea_polys and island_holes:
        sea_polys[0]["holes"].extend(island_holes)
    return sea_polys


def validate_processed_scene(scene):
    """
    Fix B05, B12, B13: Rejects truncated or incomplete processed scenes
    (e.g. partial Overpass responses missing roads, greenery, or trees).
    """
    if not isinstance(scene, dict):
        return False
    buildings = scene.get("buildings") or []
    roads = scene.get("roads") or []
    green_polys = scene.get("greenPolys") or []
    trees = scene.get("trees") or []
    if len(buildings) < 50 or len(roads) < 15:
        return False
    if len(green_polys) == 0 and len(trees) == 0:
        return False
    return True


def build_scene_from_bbox(south, west, north, east, title_hint=""):
    """Fetches and processes real DEM + real OSM data for [south, west, north, east]."""
    key_str = f"{south:.4f}_{west:.4f}_{north:.4f}_{east:.4f}"
    processed_cache = os.path.join(CACHE_DIR, f"scene_v4_{key_str}.json")
    if os.path.exists(processed_cache):
        try:
            with open(processed_cache, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if validate_processed_scene(cached):
                return cached
        except Exception:
            pass
        try:
            os.remove(processed_cache)
        except OSError:
            pass

    center_lat = (south + north) * 0.5
    center_lon = (west + east) * 0.5
    cos_lat = max(0.2, math.cos(math.radians(center_lat)))

    span_lat_m = (north - south) * 111320.0
    span_lon_m = (east - west) * 111320.0 * cos_lat
    span_m = max(span_lat_m, span_lon_m)
    meters_to_units = 170.0 / span_m

    # Fix B08: Sample DEM over the exact metric square [-85, +85] matching vector projection
    half_m = span_m * 0.5
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

    # 2. Fetch real OpenStreetMap vectors (validated for node completeness and multipolygon relations)
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
                if -85 <= pt[0] <= 85 and -85 <= pt[1] <= 85:
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

    # 3. Process Multipolygon Relations first
    for rel in relations:
        tags = rel.get("tags", {})
        members = rel.get("members", [])
        outer_ways = []
        inner_ways = []
        for m in members:
            if m.get("type") == "way" and m.get("ref") in ways:
                w_obj = ways[m["ref"]]
                w_nodes = w_obj.get("nodes", [])
                role = m.get("role", "outer")
                if role == "inner":
                    inner_ways.append(w_nodes)
                else:
                    outer_ways.append(w_nodes)
                    used_way_ids_in_rel.add(m["ref"])

        if not outer_ways:
            continue

        outer_rings_nids = stitch_way_rings(outer_ways)
        inner_rings_nids = stitch_way_rings(inner_ways)

        outer_polys = [nodes_to_pts(r, tol=0.14) for r in outer_rings_nids]
        outer_polys = [p for p in outer_polys if len(p) >= 3]
        inner_polys = [nodes_to_pts(r, tol=0.14) for r in inner_rings_nids]
        inner_polys = [p for p in inner_polys if len(p) >= 3]

        if not outer_polys:
            continue

        is_water = (
            tags.get("natural") == "water" or
            tags.get("waterway") == "riverbank" or
            "water" in tags or
            tags.get("landuse") in ("reservoir", "basin")
        )
        is_building = ("building" in tags or "building:part" in tags)
        is_green = (
            tags.get("leisure") in ("park", "garden", "nature_reserve", "pitch", "playground", "common") or
            tags.get("landuse") in ("forest", "grass", "meadow", "village_green", "recreation_ground", "cemetery", "allotments", "farmland") or
            tags.get("natural") in ("wood", "scrub", "grassland", "heath")
        )

        if is_water:
            for op in outer_polys:
                water_polys.append({
                    "outer": op,
                    "holes": inner_polys,
                    "name": tags.get("name", "Woda")
                })
        elif is_building:
            for op in outer_polys:
                add_building_record(buildings, rel["id"], tags, op, inner_polys)
        elif is_green:
            for op in outer_polys:
                green_polys.append({
                    "outer": op,
                    "holes": inner_polys,
                    "type": tags.get("leisure") or tags.get("landuse") or tags.get("natural", "park")
                })

    # 4. Process Standalone Ways
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
            if wid in used_way_ids_in_rel and "building:part" not in tags:
                continue
            pts = nodes_to_pts(nids, tol=0.10)
            if len(pts) >= 3:
                add_building_record(buildings, wid, tags, pts, [])
            continue

        # Coastline ways (land on left, sea/ocean on right)
        if tags.get("natural") == "coastline":
            pts = [nodes[nid] for nid in nids if nid in nodes]
            if len(pts) >= 2:
                coastline_ways.append(pts)
            continue

        # Closed piers / breakwaters (e.g. Molo w Sopocie, marina piers)
        if tags.get("man_made") in ("pier", "breakwater", "groyne") and is_closed:
            pts = nodes_to_pts(nids, tol=0.10)
            if len(pts) >= 3:
                pier_tags = dict(tags)
                pier_tags["building"] = "pier"
                pier_tags["height"] = "3.5"
                pier_tags["roof:shape"] = "flat"
                pier_tags["roof:height"] = "0.0"
                if not pier_tags.get("name"):
                    pier_tags["name"] = f"Molo / Pomost #{wid}"
                add_building_record(buildings, wid, pier_tags, pts, [])
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
                    "width": round(max(0.8, w_m * meters_to_units), 2),
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
                    if -85 <= tx <= 85 and -85 <= ty <= 85:
                        tree_nodes.append([round(tx, 2), round(ty, 2), 12.0])
            continue

        # Highways, Railways, Bridges & Linear Piers
        if "highway" in tags or "railway" in tags or tags.get("man_made") in ("bridge", "pier", "breakwater", "groyne"):
            if tags.get("tunnel") in ("yes", "building_passage", "culvert") or tags.get("covered") == "yes":
                continue
            layer_val = parse_float_tag(tags.get("layer"), 0)
            if layer_val is not None and layer_val < 0:
                continue

            hwy = tags.get("highway") or tags.get("railway") or tags.get("man_made") or "bridge"
            is_bridge = (
                tags.get("bridge") in ("yes", "viaduct", "cantilever") or
                tags.get("man_made") in ("bridge", "pier", "breakwater", "groyne")
            )

            if hwy in ("footway", "path", "cycleway", "steps", "bridleway", "track", "corridor") and not is_bridge:
                if tags.get("footway") in ("sidewalk", "crossing"):
                    continue
                road_w_m = 2.5
            elif hwy in ("motorway", "trunk", "primary"):
                road_w_m = 11.5
            elif hwy in ("secondary", "tertiary", "motorway_link", "trunk_link", "primary_link"):
                road_w_m = 8.8
            elif hwy in ("rail", "light_rail", "tram"):
                road_w_m = 5.0
            else:
                road_w_m = 6.5

            pts = simplify_ring([nodes[nid] for nid in nids if nid in nodes], tol=0.16)
            if len(pts) >= 2:
                roads.append({
                    "pts": pts,
                    "width": round(max(0.55, road_w_m * meters_to_units), 2),
                    "hwy": hwy,
                    "bridge": is_bridge,
                    "name": tags.get("name", "")
                })

    # Convert any natural=coastline chains into closed sea/ocean water polygons
    if coastline_ways:
        sea_polys = build_sea_polygons_from_coastlines(coastline_ways, R=92.0)
        water_polys.extend(sea_polys)

    # Deduplicate tree nodes that are too close (< 0.75 units apart)
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
        min_x, max_x = max(-84, min(xs)), min(84, max(xs))
        min_y, max_y = max(-84, min(ys)), min(84, max(ys))
        if min_x >= max_x or min_y >= max_y:
            continue

        added = 0
        for idx in range(1, target_count * 4 + 1):
            if added >= target_count:
                break
            # Halton base 2 and base 3 for natural organic distribution
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
        "spanMeters": round(span_m, 1),
        "metersToUnits": round(meters_to_units, 5),
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

    with open(processed_cache, "w", encoding="utf-8") as f:
        json.dump(scene, f, separators=(",", ":"))

    legacy_cache = os.path.join(CACHE_DIR, f"scene_v3_{key_str}.json")
    if os.path.exists(legacy_cache):
        with open(legacy_cache, "w", encoding="utf-8") as f:
            json.dump(scene, f, separators=(",", ":"))

    return scene


def add_building_record(buildings_list, osm_id, tags, outer_pts, inner_holes):
    xs = [p[0] for p in outer_pts]
    ys = [p[1] for p in outer_pts]
    cx = sum(xs) / len(xs)
    cy = sum(ys) / len(ys)
    if cx < -88 or cx > 88 or cy < -88 or cy > 88:
        return

    btype = tags.get("building") or tags.get("building:part") or "yes"
    is_part = ("building:part" in tags and "building" not in tags)
    name = tags.get("name") or tags.get("addr:housename") or ""
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
        any(w in name.lower() for w in ("kirche", "kościół", "bazylika", "katedra", "church", "cathedral"))
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

    if levels is None:
        levels = max(1, int(round(height_m / 3.5)))

    roof_shape = tags.get("roof:shape", "")
    roof_height_m = parse_float_tag(tags.get("roof:height"), None)
    if not roof_shape:
        if is_church or is_tower:
            roof_shape = "gabled"
        elif btype in ("office", "industrial", "commercial") and height_m > 34:
            roof_shape = "flat"
        else:
            roof_shape = "hipped"

    if roof_height_m is None:
        roof_height_m = 0.0 if roof_shape == "flat" else min(7.0, max(2.8, height_m * 0.24))

    buildings_list.append({
        "id": len(buildings_list) + 1,
        "osmId": osm_id,
        "name": name or (f"Kościół #{osm_id}" if is_church else f"Budynek OSM #{osm_id}"),
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
        "part": is_part,
        "church": is_church,
        "tower": is_tower,
        "landmark": bool(tags.get("name") or is_church or is_tower or tags.get("heritage") or tags.get("wikidata"))
    })


if __name__ == "__main__":
    # Centered on Munich Isar / St. Lukas / Museumsinsel / Maximilianeum (exact lichtbild_ref.jpg scene)
    s = build_scene_from_bbox(48.1280, 11.5769, 48.1396, 11.5941, "MÜNCHEN")
    print(
        f"Scene v3 ready: {len(s['waterPolys'])} water polys, {len(s['waterLines'])} water lines, "
        f"{len(s['greenPolys'])} green polys, {len(s['trees'])} trees, "
        f"{len(s['roads'])} roads, {len(s['buildings'])} buildings/parts"
    )
