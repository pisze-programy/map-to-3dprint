# City Model, Per-Tile, and Packshot QA Checklist

Read and execute all four gates before you approve any city STL, tile, or packshot render.

## Gate 1: Scale, Crop, and `zScale` Proportions

- Pick `spanMeters` first so hero landmarks keep natural width-to-height proportions.
- Keep `zScale` inside `1.0x..1.4x`. Prefer `1.0x..1.25x` for spires, arches, cantilevers, and supertalls.
- Never raise `zScale` above `1.5x` to fix a wide `span`. High `zScale` distorts towers into thin needles.
- Place the A4 `120x170 mm` (`2x 120x85 mm`, `4.0 mm` solid base) `Y=0` seam clear of fragile landmarks. Keep cantilevers intact.

## Gate 2: Per-Tile MSLA Validation (`calibration/validate_msla_stl.py`)

- Run `python3 calibration/validate_msla_stl.py <tile.stl>` on every exported tile (`Top` and `Bottom`).
- Require `FINAL VERDICT: PASS`, `0` blocking issues, `open_edges=0`, and `non_manifold_edges=0`.
- Require `VAL-04=[]`, zero `VAL-02` sealed cavities `>= 100 mm2`, and `Mono 4 normal=True`.
- Inspect every extra shell whenever `shells > 1`. Verify it sits grounded at `Z = 0.00` as a real island or quay.
- Reject floating boats, barges, or clipped border stubs immediately.

## Gate 3: Direct-STL Four-Angle Critical Element Inspection

- Never approve a city STL from validator metrics or browser preview alone.
- Render and inspect the exported `.stl` files from four close-up angles on every critical zone:
  - **Hero and unusual landmarks**: Inspect cantilevers, skybridges, curved shells, domes, wheels, lattice towers, and thin supertalls.
  - **Bridges and overpasses**: Verify `0.00 mm` bank abutment seals on both shores, aligned arch piers, and zero floating stubs.
  - **Waterfronts and streets**: Verify zero floating vessels in `waterCutout`, zero streetlamp mast spikes, and zero collapsed walls.
- Fix every geometry failure systemically in `src/` with zero city hacks.
- Rebuild `python3 build_app.py`, pass `npm run test:headless` (`100%`), re-export STLs, and re-run Gates 2 and 3.

## Gate 4: Packshot and Detail Render QA

- Render A4 white passe-partout packshots (`11_packshot_white --frame a4_passepartout`, `64 spp`) across `packshot_iso`, `profile_low`, `top_down`, and `macro_skyline`.
- Verify natural landmark silhouettes on `profile_low` with zero needle stretching or spire clipping.
- Verify flush `120x170 mm` white passe-partout seating with `0.0 mm` N/S/E gaps and zero exposed base grooves.
- Verify sealed riverbanks and intact bridge spans on `top_down`.
- On `18_detail_chalk_gallery --frame none`, verify zero outer black card borders and zero empty white bottom corners.
