# City Model, Per-Tile, and Packshot QA Checklist

Read and execute all four gates before you approve any city STL, tile, or packshot render.

## Gate 1: Scale, Crop, and `zScale` Proportions

- Pick `spanMeters` first so hero landmarks keep natural width-to-height proportions.
- Keep `zScale` inside `1.0x..1.4x`. Prefer `1.0x..1.25x` for spires, arches, cantilevers, and supertalls.
- Never raise `zScale` above `1.5x` to fix a wide `span`. High `zScale` distorts towers into thin needles.
- Use the A4 `120x170 mm` `1x3` grid (`3x 120x56.7 mm`, `4.0 mm` solid base, `4.0 mm` safe margin).
- Keep the `Y = +/-28.3 mm` seams clear of fragile landmarks so the `56.7 mm` center band stays unbroken.

## Gate 2: Whole-Project Assembly Validation (`calibration/validate_assembly.py`)

- Export every catalog SKU via `node tools/export_city_sku.mjs --city <slug>` (reads `config/city_catalog.json` and writes `assembly_manifest.json`).
- Run `python3 calibration/validate_assembly.py <export_dir>/assembly_manifest.json` on every exported assembly.
- Require `FINAL ASSEMBLY VERDICT: PASS` across `VAL-01` through `VAL-14`.
- Check single plates with `python3 calibration/validate_msla_stl.py <tile.stl>` when debugging.
- Require zero `VAL-09` seam defects (`true_diff<=0.15 mm2`, `max_step<=0.20 mm`, `gap<=0.05 mm`, `flatness<=0.005 mm`).
- Inspect `_qa/seam_<tileA>_<tileB>_diff.png` for every mating seam before you approve any multi-tile SKU.
- Verify `VAL-10` global footprint (`<= 0.08 mm`, bounded `nudged_seams`), `VAL-11` volume (`<= 0.5%`), and zero `VAL-12` crumbs.
- Verify `VAL-13` `DFM-06` bottom chamfer (`>= 0.20 mm` at `Z=0.10 mm`) and `Z=0` contact `<= 4,500 mm2` (with anti-tamper guard).
- Verify `VAL-14` Mono 4 safe bed fit (`145.45 x 79.05 x 163.0 mm`).
- Run `npm run test:headless` (`16/16` suites) to enforce the 10-city repo manifest and `VAL-01..14` gate.

## Gate 3: Direct-STL Four-Angle and Seam-Truth Inspection

- Never approve a city STL from validator metrics alone.
- Render seam-truth QA views using `--manifest assembly_manifest.json` (`qa_seam_raking`, `qa_top_down_grid`, `qa_underside`).
- Inspect `qa_seam_raking` under `12 deg` side light with alternating tile tints for flush seam mating.
- Inspect `qa_underside` to verify `45 deg` gabled relief channels, `>= 8.0 mm` outer perimeter skirt, and `DFM-06` bottom chamfers.
- Inspect every landmark and strip individually inside `/swarm` with zero unreviewed elements.
- Render and inspect exported `.stl` files from four close-up angles on every critical zone:
  - **Hero monument likeness**: Compare each flagship monument against real reference photos before you ship a SKU.
  - **Eye-level arch and cavity clearance**: Inspect through-arch and under-bridge openings at eye level. Reject overhang support pipes blocking open spans.
  - **Summit-crown macro**: Verify `roof:shape=dome` caps stay inscribed inside parapets with crisp balcony cornices.
  - **Bridges and overpasses**: Verify `0.00 mm` bank seals on both shores. Check aligned arch piers and zero floating stubs.
  - **Outer perimeter sliver check**: Inspect all frame borders. Reject razor-sliced perimeter walls or orphaned sidewalk annexes.
  - **Waterfronts and streets**: Verify zero floating vessels in `waterCutout`, zero streetlamp mast spikes, and zero collapsed walls.
- Fix procedural defects systemically in core `src/`. Put curated flagship monuments in `src/landmarks/` with `replaceOsmIds` suppression.
- Pass `npm run test:headless` (`100%`), re-export STLs, and re-run Gates 2 and 3.

## Gate 4: Honest Manifest-Driven Packshot and Detail Render QA

- Pass `--manifest <export_dir>/assembly_manifest.json` (`manifest_path` in `studio-blender` MCP) for all production renders.
- Require `validation.verdict == "PASS"` with matching tile `sha256` digests before production rendering starts.
- Raw `--stl` / `stl_paths` calls fail by default unless you pass `--draft-unvalidated` (`draft_unvalidated: true`). Draft outputs use a `DRAFT_UNVALIDATED_` prefix.
- Render A4 white passe-partout packshots (`11_packshot_white --manifest ... --frame a4_passepartout`, `64 spp`).
- Use real Heavy A4 passe-partout gallery frames on `triptych_a4_3x1` and `quartet_a4_2x2`, never `single_thin`.
- Verify natural landmark silhouettes on `profile_low` with zero needle stretching or spire clipping.
- Verify flush passe-partout seating with `0.0 mm` N/S/E gaps and zero exposed outer base grooves.
- Verify sealed riverbanks and intact bridge spans on `top_down`.
- On `18_detail_chalk_gallery --frame none`, verify `f/56.0` minimal blur, zero outer black borders, and zero empty white corners.
