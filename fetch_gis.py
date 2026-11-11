#!/usr/bin/env python3
"""
fetch_gis.py — Thin compatibility entrypoint re-exporting gis.overpass_dem.
"""
from gis.overpass_dem import (
    CACHE_DIR,
    OVERPASS_ENDPOINTS,
    decode_png_rgb,
    deg2tile_float,
    fetch_terrarium_dem_grid,
    validate_overpass_payload,
    fetch_osm_overpass,
)

if __name__ == "__main__":
    south, west, north, east = 48.1280, 11.5769, 48.1396, 11.5941
    dem = fetch_terrarium_dem_grid(south, west, north, east, grid_size=64, zoom=14)
    osm = fetch_osm_overpass(south, west, north, east)
    print(f"DEM {dem['minElev']}..{dem['maxElev']}m, OSM elements: {len(osm.get('elements', []))}")
