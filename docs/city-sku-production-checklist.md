# City SKU Production Checklist (Canonical Runbook)

Follow this runbook in order for every city relief product request.
Do not guess parameters, skip validation, or approve uninspected renders.

## Step 0: City Lookup, `--span` Math, and Format Table

Check existing pre-tuned city presets before inventing coordinates:
1. Check `config/city_catalog.json` first (`--city <slug>` works directly for all 10 catalog cities).
2. Check `WORLD_LOCATIONS` in `src/geometry/print_profiles.js` next for 37 pre-selected city and mountain centers.
3. For any uncataloged city, look up landmark coordinates via `search_web` or OpenStreetMap.

Understand how `--span <m>` maps ground meters onto the frame window (`computeBBoxFromParams`):
- `--span <m>` (`spanMeters`) sets the ground span of the **longest plate axis** (`max(window_w, window_h)`).
- The shorter axis scales proportionally: `span_short = span_m * min(window_w, window_h) / max(window_w, window_h)`.
- For `single_a4_1x3` (`120 x 170 mm`) at `--span 780`, height covers `780.0 m` and width covers `550.6 m`.
- Verify exact ground dimensions (`meterWidth x meterHeight`) quickly using `--mode scout` in Step 1.

Map the user request to one canonical `format_id` from `config/format_catalog.json`.
Every strip fits the Anycubic Photon Mono 4 safe bed (`145.45 x 79.05 x 163.0 mm` at `4.0 mm` margin).

| Shorthand (`--format`) | Canonical `format_id` | Relief Window (`mm`) | Frame Spec (`mm`) | Tile Grid (`cols x rows`) | Strip Size (`mm`) | Mono 4 Fit | Recommended `span_m` |
| :--- | :--- | :---: | :--- | :---: | :---: | :---: | :---: |
| `single` | `single_a4_1x3` | `120.0 x 170.0` | `1x` A4 (`210 x 297`) | `1 x 3` (`3` tiles) | `120.0 x 56.67` | Yes (`56.67 <= 79.05`) | `780-2100` |
| `landscape` | `single_a4_landscape_3x1` | `170.0 x 120.0` | `1x` A4 (`297 x 210`) | `3 x 1` (`3` tiles) | `56.67 x 120.0` | Yes (`90 deg` rot) | `1000-2100` |
| `triptych` | `triptych_a4_3x1` | `360.0 x 170.0` | `3x` A4 (`210 x 297`) | `3 x 3` (`9` tiles) | `120.0 x 56.67` | Yes (`56.67 <= 79.05`) | `1800-3800` |
| `quartet` | `quartet_a4_2x2` | `240.0 x 340.0` | `4x` A4 (`210 x 297`) | `2 x 6` (`12` tiles) | `120.0 x 56.67` | Yes (`56.67 <= 79.05`) | `1800-3600` |
| `square` | `square_150_2x2` | `150.0 x 150.0` | `1x` Square (`240 x 240`) | `2 x 2` (`4` tiles) | `75.0 x 75.0` | Yes (`75.0 <= 79.05`) | `900-1800` |
| `square240` | `square_240_2x4` | `240.0 x 240.0` | `1x` Square (`340 x 340`) | `2 x 4` (`8` tiles) | `120.0 x 60.0` | Yes (`60.0 <= 79.05`) | `1500-2800` |
| `50x70` | `flagship_50x70_3x9` | `360.0 x 510.0` | `1x` Poster (`500 x 700`) | `3 x 9` (`27` tiles) | `120.0 x 56.67` | Yes (`56.67 <= 79.05`) | `2600-5400` |
| `custom` | `custom_grid` | Custom (`500 x 500` def.) | Custom / `single_thick` | Auto (`4 x 7` def.) | `125.0 x 71.43` | Auto-tiled safe | `1000` per `120 mm` |

When you override an A4 catalog city with `--format`, `export_city_sku.mjs` scales `span_m` automatically by `max(window_w, window_h) / 170.0`.
For custom dimensions, pass `--format custom --width-cm <W> --height-cm <H>` and omit `--tile-cols` / `--tile-rows` for Mono 4 auto-tiling.

## Step 1: Fast Software Scout (`--mode scout`) and Preview (`--mode preview`)

Select `(lat, lon)`, `--rot`, and `--span` to highlight a landmark tower, mountain silhouette, harbor, or dense urban core.
Keep flagship towers and bridges away from outer frame borders and away from tile seam lines.
Keep `--z-scale` inside `1.0` to `1.4` (`1.0` to `1.25` for tall spires and bridges).

Always run `--mode scout` first on new crops before spending minutes on full STL export and Cycles rendering:

```bash
node tools/produce_sku_bundle.mjs \
  --slug <slug> --title <TITLE> --lat <deg> --lon <deg> --span <m> \
  --rot <deg> --z-scale <n> --dem-mode <flat|terrarium> --format <alias_or_id> --mode scout
```

Scout mode finishes in seconds without STL CSG and writes:
- `<out_dir>/renders/scout/scout_top_down.png` and `scout_overview.png` (inspect both via `read_file`).
- `<out_dir>/renders/scout/scout_report.json` with exact `meterWidth x meterHeight`, `manifoldSummary`, and `floatingBuildingIds` (when `floatingBuildingsCount > 0`).
- `<out_dir>/renders/scout/audit_scene.json` for GIS and landmark diagnostics.

Once the scout framing, landmark margins, and `floatingBuildingsCount` look clean, run `--mode preview`:

```bash
# Catalog city preview
node tools/produce_sku_bundle.mjs --city <slug> --format <alias_or_id> --mode preview

# Custom city preview
node tools/produce_sku_bundle.mjs \
  --slug <slug> --title <TITLE> --lat <deg> --lon <deg> --span <m> \
  --rot <deg> --z-scale <n> --dem-mode <flat|terrarium> --format <alias_or_id> --mode preview
```

Preview mode validates STLs, renders two packshots (`packshot_iso`, `top_down`), and renders the `3x3` chalk detail mosaic.
Inspect `<out_dir>/renders/packshots/*packshot_iso.png`, `*top_down.png`, and `<out_dir>/renders/details_3x3/details_3x3_grid.png` with `read_file`.

### Diagnosing `--mode preview` or `--mode full` Validation Aborts

If export aborts with `VAL-01..14` non-zero exit before rendering PNGs, diagnose immediately without guessing:
1. Open `<out_dir>/validation_report.json` and read `failures` plus per-tile `VAL-05` / `VAL-09` entries.
2. Open any generated `<out_dir>/_qa/seam_*_diff.png` images via `read_file` to locate seam mismatches.
3. On `VAL-05` (`CRUMB_SHELL` / `SECONDARY_BELOW_LANDMASS_FLOOR`) or `VAL-09` seam failures along piers or islets, adjust `lat`, `lon`, `span`, or `rot`.
4. Re-verify the adjusted crop quickly with `--mode scout` before re-running `--mode preview` or `--mode full`.

## Step 2: Full Print Export and Deterministic Validation (`VAL-01..14`)

Run the full production bundle once the preview crop looks balanced:

```bash
node tools/produce_sku_bundle.mjs --city <slug> --format <alias_or_id> --mode full
```

When `<out_dir>/assembly_manifest.json` already exists and passes validation, skip re-export cleanly without repeating coordinate flags:

```bash
node tools/produce_sku_bundle.mjs --out-dir <out_dir> --skip-export --mode full
```

Standalone `--skip-export --out-dir` reads `city_slug`, `source_params.title`, and `format_id` directly from `assembly_manifest.json`.
Confirm these automated gates in `<out_dir>/validation_report.json` and `<out_dir>/production_bundle_report.json`:

- Require `FINAL ASSEMBLY VERDICT: PASS` with `0` blocking failures.
- Require `VAL-01..08` watertight `2-manifold` topology (`0` open edges, `0` non-manifold edges, `0` unvented base cavities).
- Require `VAL-09` seam match (`true_diff <= 0.15 mm2`, `max_step <= 0.20 mm`, `gap <= 0.05 mm`, `flatness <= 0.005 mm`).
- Require `VAL-10` footprint tolerance (`<= 0.08 mm`), `VAL-11` volume match (`<= 0.5%`), and zero `VAL-12` floating crumbs.
- Require `VAL-13` `DFM-06` bottom chamfer (`>= 0.20 mm`) and `VAL-14` Mono 4 safe bed fit (`145.45 x 79.05 x 163.0 mm`).

## Step 3: Mandatory Agent Visual Inspection (Zero Blind Trust)

Never approve an exported assembly from `PASS` metrics alone.
Open and inspect every rendered image below using `read_file`:

1. **Seam QA (`<out_dir>/renders/qa/`)**:
   - Inspect `*qa_seam_raking.png` for seam steps, seam gaps, and alternating tile continuity.
   - Inspect `*qa_top_down_grid.png` for tile grid alignment, street continuity, and border cuts.
   - Inspect `*qa_underside.png` for continuous `45 deg` gabled relief grooves, `8.0 mm` skirt, and `DFM-06` chamfer.
2. **Packshots (`<out_dir>/renders/packshots/`)**:
   - Inspect `*packshot_iso.png`, `*top_down.png`, `*profile_low.png`, and `*macro_skyline.png`.
   - Confirm frame geometry matches `format_id` (`--frame auto`) with `0.0 mm` passe-partout gaps and natural skyline scale.
3. **3x3 Chalk Detail Mosaic (`<out_dir>/renders/details_3x3/`)**:
   - Inspect `details_3x3_grid.png` (`9` cells at `f/56.0` minimal blur covering NW to SE sectors).
   - Open individual `*detail_grid_01.png` through `*detail_grid_09.png` files for any suspect building, bridge, or roof.

Reject the export immediately if you see any Paris-class defect:

- Hero landmark tower or bridge silhouette deviates from real-world reference photos.
- Uneven seam steps, gaps, or double walls appear between adjacent tiles.
- Half-cut buildings, half-cut trees, or thin facade slivers sit on outer borders or seams.
- Collapsed walls, floating stubs, or vertical support pipes block open bridge and tower arches.

## Step 4: Remediation Decision Tree (No Guessing)

Pick the single matching remediation path for each defect found in Step 3:

1. **Half-cut buildings, trees, or slivers on border or seam**:
   - Adjust `--lat`, `--lon`, `--rot`, or `--span` to shift the cut line along streets or open water.
   - Re-verify fast with `--mode scout`, then re-run `--mode preview` or `--mode full`.
2. **Generic urban geometry defect (roofs, courtyards, street walls, water cutouts)**:
   - Fix the defect systemically in city-agnostic core modules under `src/`.
   - Run `npm test` (`16/16` suites `PASS`), then re-run `node tools/produce_sku_bundle.mjs`.
3. **Hero tower or bridge deviates from real-world architecture**:
   - Inspect the structure first with:
     `node tools/mcp_map3d_inspector.mjs inspect-landmark --query "<name>" --kind <building|bridge> ...`
   - Replace the monument in `src/landmarks/` using one of two sanctioned paths:
     - **Option A (Watertight STL Asset)**: Place a watertight binary `.stl` in `src/landmarks/assets/`. Register it in `src/landmarks/assets/landmarks.json` with `lat`, `lon`, `headingDeg`, `scaleM`, `zOffsetM`, `replaceOsmIds`, and `replacePolygonM`.
     - **Option B (Procedural JS Landmark)**: Add `src/landmarks/landmark_<id>.js` and call `registerHeroLandmark` with `replaceOsmIds` or `replacePolygonM`.
   - Both `replaceOsmIds` and `replacePolygonM` suppress OSM buildings, OSM bridges, and marine piers automatically.
   - Run `npm test` (`16/16` suites `PASS`), then re-run `node tools/produce_sku_bundle.mjs`.

## Step 5: Mandatory Output Report and Visual PASS-List

Return this exact report structure with every city SKU deliverable.
Fill every row from `production_bundle_report.json` and your direct `read_file` image inspection.

```markdown
### SKU Delivery Summary: <TITLE> (`<format_id>`)
- **Validation Verdict**: `FINAL ASSEMBLY VERDICT: <PASS|FAIL>` (`blocking_failures: <n>`, `VAL-09` max diff `<mm2>`, max step `<mm>`, max gap `<mm>`, `VAL-11` volume diff `<pct>%`)
- **Tiles**: `<active_tiles>/<total_tiles>` active (`<skipped>` empty-water skipped)

| Tile ID | Frame | Span (`mm`) | `Zmax` (`mm`) | Volume (`ml`) | Triangles | Watertight | Status |
| :--- | :---: | :---: | ---: | ---: | ---: | :---: | :---: |
| `<tile_id>` | `<frame_id>` | `WxH` | `<z>` | `<ml>` | `<tris>` | `Yes/No` | `Active/Skipped` |

### Mandatory Visual QA PASS-List
| Check ID | Visual QA Requirement | Verdict | Direct Image Observation |
| :--- | :--- | :---: | :--- |
| `QA-01` | Hero landmark fidelity vs real-world silhouette and spire profile | `PASS/FAIL` | `<concrete observation>` |
| `QA-02` | Seam continuity across tiles (zero step, offset, or double-wall) | `PASS/FAIL` | `<concrete observation>` |
| `QA-03` | Outer perimeter and seam borders (zero half-cut walls, trees, or slivers) | `PASS/FAIL` | `<concrete observation>` |
| `QA-04` | Water cutouts, shorelines, islands, and bridge arch clearance | `PASS/FAIL` | `<concrete observation>` |
| `QA-05` | Frame and backing presentation matches `<format_id>` | `PASS/FAIL` | `<concrete observation>` |
| `QA-06` | Underside `DFM-06` chamfer, `8 mm` skirt, and `45 deg` relief grooves | `PASS/FAIL` | `<concrete observation>` |
| `QA-07` | `3x3` chalk detail cells `01..09` framing (zero border or slab intrusion) | `PASS/FAIL` | `<concrete observation>` |
| `QA-08` | Roofs, courtyards, and stepped towers free of collapsed walls or stubs | `PASS/FAIL` | `<concrete observation>` |
| `QA-09` | Packshot lighting, framing, and commercial contrast | `PASS/FAIL` | `<concrete observation>` |

### Deliverable Paths
- **STLs**: `<clickable links to all active .stl files>`
- **Manifest & Reports**: `[assembly_manifest.json](file://...)`, `[validation_report.json](file://...)`, `[production_bundle_report.json](file://...)`
- **Packshots**: `<clickable links to packshot PNGs>`
- **3x3 Chalk Detail Grid**: `[details_3x3_grid.png](file://...)`
- **Seam QA Renders**: `<clickable links to qa_*.png>`
```
