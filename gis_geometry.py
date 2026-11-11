#!/usr/bin/env python3
"""
gis_geometry.py — Thin compatibility entrypoint re-exporting gis.geometry.
"""
from gis.geometry import (
    stitch_way_rings,
    parse_float_tag,
    simplify_ring,
    point_in_poly,
    poly_area_signed,
    build_sea_polygons_from_coastlines,
    validate_processed_scene,
)

__all__ = [
    "stitch_way_rings",
    "parse_float_tag",
    "simplify_ring",
    "point_in_poly",
    "poly_area_signed",
    "build_sea_polygons_from_coastlines",
    "validate_processed_scene",
]
