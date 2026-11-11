"""
Modular GIS processing package for Map3D Print Studio.
"""
from .geometry import (
    stitch_way_rings,
    parse_float_tag,
    simplify_ring,
    point_in_poly,
    poly_area_signed,
    build_sea_polygons_from_coastlines,
    validate_processed_scene,
)
from .overpass_dem import (
    CACHE_DIR,
    fetch_terrarium_dem_grid,
    fetch_osm_overpass,
    validate_overpass_payload,
)
from .scene_pipeline import build_scene_from_bbox
from .s3db_models import add_building_record

__all__ = [
    "CACHE_DIR",
    "stitch_way_rings",
    "parse_float_tag",
    "simplify_ring",
    "point_in_poly",
    "poly_area_signed",
    "build_sea_polygons_from_coastlines",
    "validate_processed_scene",
    "fetch_terrarium_dem_grid",
    "fetch_osm_overpass",
    "validate_overpass_payload",
    "build_scene_from_bbox",
    "add_building_record",
]
