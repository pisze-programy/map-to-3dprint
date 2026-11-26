# City Model, Per-Tile, and Packshot QA Checklist

Read and execute all four gates before you approve any city STL, tile, or packshot render.
For end-to-end orchestration, run `node tools/produce_sku_bundle.mjs` and follow `docs/city-sku-production-checklist.md`.

## Gate 1: Scale, Crop, and `zScale` Proportions

- Pick `spanMeters` first so hero landmarks keep natural width-to-height proportions.
- Keep `zScale` inside `1.0x..1.4x`. Prefer `1.0x..1.25x` for spires, arches, cantilevers, and supertalls.
- Never raise `zScale` above `1.5x` to fix a wide `span`. High `zScale` distorts towers into thin needles.
- Use `config/format_catalog.json` formats (`single_a4_1x3` is `120x170 mm`, `3x 120x56.67 mm`, `4.0 mm` solid base).
- Keep outer borders and seams (`Y = +/-28.33 mm` on `1x3`) clear of fragile landmarks, buildings, and trees.

## Gate 2: Whole-Project Assembly Validation (`calibration/validate_assembly.py`)

- Export SKUs via `node tools/produce_sku_bundle.mjs` or `node tools/export_city_sku.mjs --city <slug>`.
- Skip empty `100%`-water coastal tiles automatically in `assembly_manifest.json` (`skipped_empty_water: true`) with zero empty STLs.
- Run `python3 calibration/validate_assembly.py <export_dir>/assembly_manifest.json` on every exported assembly.
- Require `FINAL ASSEMBLY VERDICT: PASS` across `VAL-01` through `VAL-14` (`0` blocking failures).
- Check single plates with `python3 calibration/validate_msla_stl.py <tile.stl>` when debugging.
- Require zero `VAL-09` seam defects (`true_diff<=0.15 mm2`, `max_step<=0.20 mm`, `gap<=0.05 mm`, `flatness<=0.005 mm`).
- Inspect `_qa/seam_<tileA>_<tileB>_diff.png` for every mating seam before you approve any multi-tile SKU.
- Verify `VAL-10` global footprint (`<= 0.08 mm`, bounded `nudged_seams`), `VAL-11` volume (`<= 0.5%`), and zero `VAL-12` crumbs.
- Verify `VAL-13` `DFM-06` bottom chamfer (`>= 0.20 mm` at `Z=0.10 mm`) and `Z=0` contact `<= 4,500 mm2`.
- Verify `VAL-14` Mono 4 safe bed fit (`145.45 x 79.05 x 163.0 mm`).
- Run `npm run test:headless` (`16/16` suites) after any source edit.

## Gate 3: Direct-STL Seam-Truth and Monument Inspection

- Never approve a city STL from validator metrics alone.
- Render seam-truth QA views using `--manifest assembly_manifest.json` (`qa_seam_raking`, `qa_top_down_grid`, `qa_underside`).
- `render_studio.py` hides gallery frames and `FramelessBackingSlab` automatically during `qa_*` shots and restores visibility afterward.
- Inspect `qa_seam_raking` under `12 deg` side light with alternating tile tints for flush seam mating.
- Inspect `qa_underside` to verify `45 deg` gabled relief channels, `>= 8.0 mm` outer skirt, and `DFM-06` bottom chamfers.
- Inspect `details_3x3_grid.png` (`detail_grid_3x3`) and individual `detail_grid_01..09.png` cells for local mesh defects:
  - **Hero monument likeness**: Compare each flagship monument against real reference photos before you ship a SKU.
  - **Eye-level arch and cavity clearance**: Inspect through-arch and under-bridge openings; reject overhang pipes blocking open spans.
  - **Summit-crown macro**: Verify `roof:shape=dome` caps stay inscribed inside parapets with crisp balcony cornices.
  - **Bridges and piers**: Verify `0.00 mm` bank seals on both shores, aligned piers, and zero floating stubs.
  - **Outer perimeter sliver check**: Inspect all frame borders and seams; reject razor-sliced walls or half-cut trees.
  - **Waterfronts and streets**: Verify zero floating vessels in `waterCutout`, zero mast spikes, and zero collapsed walls.
- Fix generic urban defects in core `src/`. Put bespoke monuments in `src/landmarks/` using `replaceOsmIds` or `replacePolygonM`.
- Use `src/landmarks/assets/landmarks.json` (`stl_landmark_loader.js`) or `src/landmarks/landmark_<id>.js`; both suppress buildings, bridges, and piers.
- Pass `npm run test:headless` (`100%`), re-export STLs, and re-run Gates 2 and 3.

## Gate 4: Honest Manifest-Driven Packshot and Detail Render QA

- Pass `--manifest <export_dir>/assembly_manifest.json` (`manifest_path` in `studio-blender` MCP) for all production renders.
- Use `--frame auto` so `render_studio.py` resolves framing automatically from `manifest.format_id`.
- Require `validation.verdict == "PASS"` with matching tile `sha256` digests before production rendering starts.
- Raw `--stl` / `stl_paths` calls fail by default unless you pass `--draft-unvalidated` (`DRAFT_UNVALIDATED_` prefix).
- Render manifest-locked packshots (`11_packshot_white --manifest ... --frame auto`, `--preset packshot_iso`, `top_down`, `profile_low`, `macro_skyline`).
- Verify natural landmark silhouettes on `profile_low` with zero needle stretching or spire clipping.
- Verify flush passe-partout seating with `0.0 mm` N/S/E gaps and zero exposed outer base grooves.
- Verify sealed riverbanks and intact bridge spans on `top_down`.
- On `18_detail_chalk_gallery --frame none --preset detail_grid_3x3`, verify `f/56.0` minimal blur and zero border intrusion in `details_3x3_grid.png`.
