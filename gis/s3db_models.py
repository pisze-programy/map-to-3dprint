#!/usr/bin/env python3
"""
gis/s3db_models.py
Simple 3D Buildings (S3DB) Tag Normalization, Parent Coverage Accumulation & Building Record Factory.
"""
from .geometry import parse_float_tag, point_in_poly, poly_area_signed

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
    "lean_to": "skillion",
    "dome": "dome",
    "round": "dome",
    "onion": "onion",
    "cone": "cone",
    "conical": "cone",
    "mansard": "mansard",
    "gambrel": "gambrel",
}

CARDINAL_DEG = {
    "N": 0.0, "NNE": 22.5, "NE": 45.0, "ENE": 67.5,
    "E": 90.0, "ESE": 112.5, "SE": 135.0, "SSE": 157.5,
    "S": 180.0, "SSW": 202.5, "SW": 225.0, "WSW": 247.5,
    "W": 270.0, "WNW": 292.5, "NW": 315.0, "NNW": 337.5,
}

SKIP_BUILDING_VALS = {
    "no", "none", "construction", "proposed", "demolished", "razed", "ruins", "abandoned", "underground"
}


def parse_roof_direction(tags):
    raw = str(tags.get("roof:direction") or tags.get("roof:slope:direction") or "").strip().upper()
    if not raw:
        return None
    if raw in CARDINAL_DEG:
        return CARDINAL_DEG[raw]
    val = parse_float_tag(raw, None)
    if val is not None:
        return round(val % 360.0, 1)
    return None


def is_underground_or_skipped_building(tags):
    if not tags:
        return True
    if tags.get("location") in ("underground", "underwater"):
        return True
    if tags.get("tunnel") in ("yes", "building_passage", "culvert"):
        return True
    if tags.get("indoor") in ("room", "corridor", "area", "level"):
        return True
    b_val = str(tags.get("building", "")).lower().strip()
    bp_val = str(tags.get("building:part", "")).lower().strip()
    if b_val in SKIP_BUILDING_VALS and (not bp_val or bp_val in SKIP_BUILDING_VALS):
        return True
    if not b_val and bp_val in SKIP_BUILDING_VALS:
        return True
    if b_val == "bridge" and "min_height" not in tags and "building:min_level" not in tags:
        return True
    layer_val = parse_float_tag(tags.get("layer"), 0.0) or 0.0
    if layer_val < -0.5 and "height" not in tags and "building:levels" not in tags:
        return True
    return False


def extract_display_name(tags):
    name = tags.get("name") or tags.get("name:en") or tags.get("name:pl") or tags.get("addr:housename") or ""
    if any(ord(c) > 0x500 for c in name) and tags.get("name:en"):
        name = tags.get("name:en")
    if not name:
        street = tags.get("addr:street", "")
        housenum = tags.get("addr:housenumber", "")
        if street:
            name = f"{street} {housenum}".strip()
    return name


def add_building_record(
    buildings_list,
    osm_id,
    tags,
    outer_pts,
    inner_holes,
    group_id=None,
    is_part=False,
    parent_height_hint=None,
    meters_to_units=0.13,
    half_w=84.6,
    half_h=84.6,
):
    xs = [p[0] for p in outer_pts]
    ys = [p[1] for p in outer_pts]
    cx = sum(xs) / len(xs)
    cy = sum(ys) / len(ys)
    if abs(cx) > half_w + 4.0 or abs(cy) > half_h + 4.0:
        return

    span_x_m = (max(xs) - min(xs)) / max(1e-4, meters_to_units)
    span_y_m = (max(ys) - min(ys)) / max(1e-4, meters_to_units)
    min_span_m = max(1.5, min(span_x_m, span_y_m))
    area_u = abs(poly_area_signed(outer_pts))

    btype = tags.get("building") or tags.get("building:part") or "yes"
    name = extract_display_name(tags)

    levels = parse_float_tag(tags.get("building:levels"), None)
    explicit_height_m = parse_float_tag(tags.get("height"), None)
    height_m = explicit_height_m
    min_height_m = parse_float_tag(tags.get("min_height"), 0.0) or 0.0
    min_level = parse_float_tag(tags.get("building:min_level"), 0.0) or 0.0
    if min_height_m == 0.0 and min_level > 0:
        min_height_m = min_level * 3.3

    is_church = (
        btype in ("church", "cathedral", "chapel")
        or tags.get("amenity") == "place_of_worship"
        or (not is_part and any(w in (name or "").lower() for w in ("kirche", "kościół", "bazylika", "katedra", "church", "cathedral")))
    )
    is_tower = (
        btype in ("tower", "bell_tower", "water_tower")
        or tags.get("man_made") in ("tower", "chimney", "lighthouse")
        or "tower:type" in tags
    )

    raw_roof = str(tags.get("roof:shape", "")).lower().strip()
    if raw_roof:
        roof_shape = ROOF_SHAPES_NORM.get(raw_roof, "flat")
    elif is_church and not is_part and area_u > 6.0:
        roof_shape = "gabled"
    else:
        roof_shape = "flat"

    roof_orient_raw = str(tags.get("roof:orientation", "")).lower().strip()
    roof_orient = "across" if roof_orient_raw == "across" else "along"
    roof_dir = parse_roof_direction(tags)

    if roof_shape == "flat":
        roof_height_m = 0.0
    else:
        roof_h_tag = parse_float_tag(tags.get("roof:height"), None)
        roof_lvl_tag = parse_float_tag(tags.get("roof:levels"), None)
        if roof_h_tag is not None:
            roof_height_m = roof_h_tag
        elif roof_lvl_tag is not None:
            roof_height_m = roof_lvl_tag * 3.1
        else:
            roof_height_m = min(min_span_m * 0.42, 10.0)

    if height_m is None:
        if levels is not None:
            height_m = levels * 3.55 + roof_height_m
        elif is_part:
            base_est = min(18.0, max(5.5, min_span_m * 1.45))
            if parent_height_hint is not None:
                base_est = min(base_est, parent_height_hint * 0.65)
            height_m = base_est + roof_height_m
        elif is_church:
            height_m = 26.0 + roof_height_m
        elif is_tower:
            height_m = 44.0 + roof_height_m
        elif btype in ("public", "civic", "museum", "university", "palace", "government", "train_station", "hotel"):
            height_m = (14.5 if (btype == "museum" and area_u > 250.0) else 21.0) + roof_height_m
        elif btype in ("house", "detached", "semidetached_house", "terrace", "bungalow"):
            height_m = 8.5 + roof_height_m
        elif btype in ("apartments", "residential", "commercial", "office", "retail"):
            height_m = (18.5 if area_u > 7.5 else 14.5) + roof_height_m
        elif btype in ("garage", "shed", "hut", "kiosk", "roof", "service", "toilets", "boathouse", "allotment_house", "transformer_tower"):
            height_m = 4.0 + roof_height_m
        else:
            height_m = (16.5 if area_u > 5.5 else 12.0) + roof_height_m

    if min_height_m >= height_m - 0.5:
        min_height_m = max(0.0, height_m - 2.0) if explicit_height_m and height_m > 12.0 else 0.0

    if roof_shape != "flat":
        avail_h = max(0.0, height_m - min_height_m - 0.8)
        if roof_shape in ("dome", "onion", "cone", "pyramidal"):
            roof_height_m = min(roof_height_m, avail_h, max(min_span_m * 1.15, 3.0))
        else:
            roof_height_m = min(roof_height_m, avail_h, height_m * 0.45, min_span_m * 0.55)

    if levels is None:
        levels = max(1, int(round(max(3.0, height_m - roof_height_m) / 3.5)))

    rec = {
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
        "roofOrient": roof_orient,
        "part": bool(is_part),
        "isOutline": False,
        "church": bool(is_church),
        "tower": bool(is_tower),
        "landmark": bool(tags.get("name") or is_church or is_tower or tags.get("heritage") or tags.get("wikidata")),
    }
    if roof_dir is not None:
        rec["roofDir"] = roof_dir
    buildings_list.append(rec)


def match_and_emit_s3db(buildings, candidate_parents, candidate_parts, meters_to_units, half_w, half_h):
    """Matches building:part candidates to enclosing parent outlines and suppresses decomposed parents."""
    parent_by_group = {}
    for parent in candidate_parents:
        if parent["groupId"] is not None:
            parent_by_group.setdefault(parent["groupId"], []).append(parent)

    for part in candidate_parts:
        best_parent = None
        if part["groupId"] is not None and part["groupId"] in parent_by_group:
            cands = parent_by_group[part["groupId"]]
            best_parent = min(cands, key=lambda p: abs(p["cx"] - part["cx"]) + abs(p["cy"] - part["cy"]))

        enclosing_parents = []
        if part["groupId"] is not None and part["groupId"] in parent_by_group:
            enclosing_parents.extend(parent_by_group[part["groupId"]])

        best_area = float("inf")
        p_bbox = part["bbox"]
        p_cx, p_cy = part["cx"], part["cy"]
        p_pts = part["pts"]
        p_len = len(p_pts)

        for parent in candidate_parents:
            par_bbox = parent["bbox"]
            if (p_bbox[0] > par_bbox[2] + 0.12 or p_bbox[2] < par_bbox[0] - 0.12 or
                p_bbox[1] > par_bbox[3] + 0.12 or p_bbox[3] < par_bbox[1] - 0.12):
                continue
            in_hole = any(point_in_poly(p_cx, p_cy, h) for h in parent["holes"])
            enclosed = False
            if not in_hole and point_in_poly(p_cx, p_cy, parent["pts"]):
                enclosed = True
            else:
                in_cnt = sum(
                    1 for pt in p_pts
                    if point_in_poly(pt[0], pt[1], parent["pts"]) and not any(point_in_poly(pt[0], pt[1], h) for h in parent["holes"])
                )
                if in_cnt >= p_len * 0.55:
                    enclosed = True
            if enclosed:
                if parent not in enclosing_parents:
                    enclosing_parents.append(parent)
                if best_parent is None or (part["groupId"] is None and parent["area"] < best_area):
                    best_area = parent["area"]
                    best_parent = parent

        for ep in enclosing_parents:
            ep["hasParts"] = True
            ep["partCount"] += 1
            ep["partsAreaSum"] += part["netArea"]
            if part["minH"] <= 3.5:
                ep["groundPartsAreaSum"] += part["netArea"]

        if best_parent is not None:
            # Prefer outermost enclosing parent's groupId so nested podium+tower complexes share ONE groupId!
            outermost_ep = max(enclosing_parents, key=lambda x: x["area"]) if enclosing_parents else best_parent
            shared_gid = part["groupId"] or outermost_ep["groupId"] or outermost_ep["wid"]
            part["groupId"] = shared_gid
            for ep in enclosing_parents:
                if ep["groupId"] is None:
                    ep["groupId"] = shared_gid
            if not extract_display_name(part["tags"]):
                for ep in sorted(enclosing_parents, key=lambda x: x["area"], reverse=True):
                    par_name = extract_display_name(ep["tags"])
                    if par_name:
                        part["tags"]["name"] = par_name
                        break
            par_h = parse_float_tag(best_parent["tags"].get("height"), None)
            if par_h is None:
                par_lvls = parse_float_tag(best_parent["tags"].get("building:levels"), None)
                if par_lvls is not None:
                    par_h = par_lvls * 3.55
            part["parentHeightHint"] = par_h
        else:
            if part["groupId"] is None:
                part["groupId"] = part["wid"]

    for part in candidate_parts:
        add_building_record(
            buildings, part["wid"], part["tags"], part["pts"], part["holes"],
            group_id=part["groupId"], is_part=True,
            parent_height_hint=part["parentHeightHint"],
            meters_to_units=meters_to_units,
            half_w=half_w, half_h=half_h,
        )

    for parent in candidate_parents:
        suppress = False
        if parent["hasParts"]:
            ground_cov = parent["groundPartsAreaSum"] / max(1e-4, parent["netArea"])
            total_cov = parent["partsAreaSum"] / max(1e-4, parent["netArea"])
            if (ground_cov >= 0.42 or total_cov >= 0.52 or
                (parent["fromBuildingRel"] and total_cov >= 0.30) or
                (parent["partCount"] >= 4 and total_cov >= 0.32)):
                suppress = True
        if not suppress:
            add_building_record(
                buildings, parent["wid"], parent["tags"], parent["pts"], parent["holes"],
                group_id=parent["groupId"] or parent["wid"], is_part=False,
                meters_to_units=meters_to_units,
                half_w=half_w, half_h=half_h,
            )
