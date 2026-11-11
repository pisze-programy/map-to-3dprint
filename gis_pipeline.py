#!/usr/bin/env python3
"""
gis_pipeline.py — Thin compatibility entrypoint re-exporting gis.scene_pipeline & gis.s3db_models.
"""
from gis.geometry import validate_processed_scene
from gis.scene_pipeline import build_scene_from_bbox
from gis.s3db_models import add_building_record, parse_roof_direction, is_underground_or_skipped_building

if __name__ == "__main__":
    s = build_scene_from_bbox(48.1280, 11.5769, 48.1396, 11.5941, "MÜNCHEN", force_rebuild=True)
    print(
        f"Scene v5 ready: {len(s['waterPolys'])} water polys, {len(s['greenPolys'])} green polys, "
        f"{len(s['roads'])} roads, {len(s['roadPolys'])} plazas, {len(s['bridgePolys'])} bridgePolys, "
        f"{len(s['buildings'])} buildings/parts"
    )
