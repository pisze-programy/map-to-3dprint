# MSLA Printability Rules and Pre-Print Validation Specification

## 1. Scope and Purpose

This specification defines mandatory Design-for-MSLA (DFM) geometry rules and automated pre-export validation checks (`VAL-01` through `VAL-08`) for `map-to-3dprint`.

City scenes from OpenStreetMap contain arbitrary building footprints, narrow courtyards, thin walls, cantilevered passages (`building:min_height`), river bridges, spires, and dense tree canopies. Manual per-model fixes do not scale to arbitrary cities. Therefore, `map-to-3dprint` must enforce printability in two stages:

1. **Constructive Enforcement (`DFM-01` through `DFM-10`)**: The 3D mesh generator (`src/mesh/`) and STL exporter (`src/export/`) must produce self-supporting, vented, watertight `2-manifold` geometry by construction when Resin Mode is active.
2. **Automated Pre-Print Gate (`VAL-01` through `VAL-08`)**: Every generated STL file must pass an automated geometric and hydraulic audit before the user starts a print.

---

## 2. Reference Hardware and Calibrated Process Profiles

- **Target Printer**: Anycubic Photon Mono 4 (`10K`, `9024 x 5120 px`, `0.017 x 0.017 mm` XY pixel pitch).
- **Build Volume**: `153.4 x 87.0 x 165.0 mm` (`163.0 mm` safe Z ceiling).
- **Orientation Policy**: Flat on the build plate (`Z = 0.00 mm`, `0 deg` tilt, zero external slicer supports).
- **Release Film Baseline**: Classic FEP film (higher peel stretch than NFEP/ACF; requires larger Z lift distance).
- **Current Hardware State (2026-11-21)**: Magnetic spring steel Flex Plate (magnet sheet + steel sheet, approx. `2.7 mm`), printed Z-axis endstop spacer, new leak-free VAT with classic FEP film, screen protector replaced after a resin leak under the VAT.
- **Production Profile Status**: The `0.100 mm` column below printed the Stage 2 Krakow tile (city detail `10/10`), the full-bed Flex Plate calibration plate (all details, no delamination, clean release) and the Mono 4 dripper v2. Do not change it without a single-parameter A/B test.

### Calibrated Slicer Profiles (Anycubic ABS-Like Resin Pro 2 White + Classic FEP)

| Parameter | Fine Profile (`0.050 mm`) | Production Profile (`0.100 mm`) | Engineering Purpose |
| :--- | :---: | :---: | :--- |
| `Layer Thickness` | `0.050 mm` | `0.100 mm` | `0.100 mm` halves print time with `0.017 mm` XY sharpness |
| `Normal Exposure Time` | `2.600 s` | `4.100 s` | Full polymer cross-linking on `4.2 mm` vent bridges |
| `Off Time` | `2.000 s` | `2.000 s` | Resin meniscus refill and Z-arm stabilization |
| `Wait Before / After Lift` | `0.000 / 0.000 s` | `0.000 / 0.000 s` | Controlled via `Off Time` in Photon Workshop |
| `Bottom Layers` | `4` (`0.20 mm`) | `5` (`0.50 mm`) | Base anchoring on anodized aluminum or Flex Plate |
| `Bottom Exposure Time` | `24.000 s` | `30.000 - 35.000 s` | `30-31 s` on bare aluminum; `35 s` on Flex Plate |
| `Bottom Off Time` | `10.000 s` | `10.000 s` | Eliminates hydraulic Z-arm deflection on wide bases |
| `Transition Layer Count` | `8` (`Z <= 0.60 mm`) | `6` (`Z <= 1.10 mm`) | Smooth shrinkage gradient from bottom to normal cure |
| `Normal Z Lift Distance` | `3.000 / 4.000 mm` | `3.000 / 4.000 mm` | `7.0 mm` total clears classic FEP tenting (Stage 2 print verified) |
| `Normal Z Lift Speed` | `1.500 / 4.500 mm/s` | `1.500 / 4.500 mm/s` | Slow initial peel (`1.5 mm/s`) protects thin features |
| `Normal Z Retract Speed` | `2.000 / 4.500 mm/s` | `2.000 / 4.500 mm/s` | Limits Poiseuille squeeze-out pressure near `Z = 0` |
| `Bottom Z Lift Distance` | `3.500 / 4.500 mm` | `3.500 / 4.500 mm` | `8.0 mm` total gives full base detachment (Stage 2 print verified) |
| `Bottom Z Lift Speed` | `1.500 / 4.000 mm/s` | `1.500 / 4.000 mm/s` | Prevents corner tear-off during high-adhesion bottom peel |
| `Bottom Z Retract Speed` | `1.500 / 4.000 mm/s` | `1.500 / 4.000 mm/s` | Minimizes trapped air and Z-arm compression at `Z = 0` |
| `Anti-alias` | `1` (Off) | `1` (Off) | Prevents `TiO2` UV scatter halo and slot bridging |

---

## 3. Empirical Failure Log from Physical Test Prints

Every rule in Section 4 traces directly to a physical failure observed during calibration:

| ID | Campaign & Stage | Observed Physical Defect | Root Cause | Resulting Rule |
| :--- | :--- | :--- | :--- | :--- |
| **F-01** | Clear Stage 2 | Flooded and collapsed underside in closed `Hollow Vault` | Trapped liquid resin + UV print-through across `25 mm` unribbed span | `DFM-03`, `DFM-04`, `VAL-02` |
| **F-02** | Clear Stage 3 | Corner delamination under solid `11 x 10 x 5.6 mm` corner block | `5%` cure shrinkage torque + `Bottom Off Time = 2 s` + unhollowed mass | `DFM-05`, `DFM-06`, `VAL-07` |
| **F-03** | ABS White Stage 1 | Collar gauge `E2` (`54.2 x 17.2 mm`) tore off leveled plate | Unvented `714 mm2` internal cavity acted as a hydraulic suction cup | `DFM-03`, `VAL-02` |
| **F-04** | ABS White Stage 1 | Walls `< 0.45 mm` missing; columns `< 0.50 mm` snapped; slots `< 0.22 mm` fused | `TiO2` lateral UV scatter (`0.22 mm` floor) + classic FEP peel shear | `DFM-01`, `DFM-02`, `VAL-05` |
| **F-05** | ABS White Stage 1 & 2 Audit | Bottom drain grooves (`0.60 - 0.85 mm` high) partially closed / flattened | Vent ceilings placed inside Transition Zone (`Z <= 1.10 mm`) suffered `~0.30 mm` Z-bleed | `DFM-03`, `VAL-03` |
| **F-06** | ABS White Stage 2 Slicer | Anycubic Photon Workshop raised `Repair Model(s)` error | Multi-layer export (`stl_writer.js`) concatenated overlapping shells (`12,120` non-manifold edges) | `DFM-08`, `VAL-01` |
| **F-07** | ABS White Stage 2 Print | Partial base defect at `M1` `NE` corner and `H1` `NW` foot + deformed `H1` top | Coupled classic FEP tenting across `5 - 8 mm` part gap + corner cut by two vents + split `6.8 mm` narrow foot + `2.5x` peel area jump above horizontal arch | `DFM-06`, `DFM-07`, `DFM-09`, `VAL-04`, `VAL-06`, `VAL-07`, `VAL-08` |
| **F-08** | Codebase Audit (`M6`) | `baseBottomZ` grew to `7.24 mm` on `50 cm` maps; `NYC` reached `170.0 mm` Z | `baseBottomZ` defined in scene units instead of physical millimeters; missing Z cap | `DFM-10`, `VAL-08` |
| **F-09** | ABS White Dripper v1 | Socket mouth corner lifted off the Flex Plate | A vent notch `13 mm` from the corner left a `3 mm` L-shaped strip that carried the corner | `DFM-06` |
| **F-10** | ABS White Dripper v1 | Build plate bracket did not go onto the socket (about `5 mm` too wide) | The socket is a MALE part, but its outer profile was enlarged like a FEMALE opening. Rule: classify every mating feature as male or female first. Enlarge female openings, reduce male outer profiles | Design review |
| **F-11** | ABS White Dripper v2 | Slight side peel at the socket end; print complete and usable | Large solid `Z = 0` pad on the socket side with no base drain channel, while the sleeve side has an open slot at the base | `DFM-03` (keep base drain channels on both sides of large pads) |
| **F-12** | Paris `1x3` Solid A4 Print | Bow-warp curling across `120 x 56.7 mm` strip, bottom seam lip collision, and `~1 mm` building step across tile cut | Ungrooved `6,800 mm2` `Z=0` contact warped thin Flex Plate; missing `DFM-06` `0.25 mm` bottom chamfer; per-tile CSG cut buildings before final union and shifted seams | Compose-first/cut-last `tile_seam_cutter.js`, `Z = 0..1.50 mm` underside relief, `DFM-06` `0.25 mm` chamfer, `VAL-09..14` |

---

## 4. Mandatory Constructive Geometry Rules (`src/mesh/` and `src/export/`)

When Resin Mode (`state.isResin` or `printerPreset === 'photon_mono_4'`) is active, the mesh generator must enforce the following rules in physical print millimeters (`mm_print = units_scene * scaleMm`):

- **`DFM-01` (Minimum Solid Feature Width)**:
  - Minimum freestanding wall, bridge parapet, or pier thickness: **`>= 0.50 mm`**.
  - Minimum freestanding column, spire, or tree trunk diameter: **`>= 0.55 mm`** (features below `0.40 mm` must be thickened to `0.55 mm` or omitted).
- **`DFM-02` (Minimum Slot and Street Canyon Width)**:
  - Minimum open gap between adjacent building walls or courtyard faces: **`>= 0.25 mm`**.
  - Gaps narrower than `0.22 mm` must be merged into a single solid volume so they do not trap uncured `TiO2` resin.
- **`DFM-03` (Mandatory Perimeter and Cavity Venting Above Transition Zone)**:
  - Every hollow tile, collar, or base cavity must vent to the outer atmosphere at `Z = 0.00 mm`, including single-tile exports (`numTiles === 1`).
  - Vent ceiling height must be **`>= 1.25 mm`** (strictly above the `Z = 1.10 mm` transition-layer zone at `0.100 mm` layer thickness) and width **`>= 3.50 mm`**.
- **`DFM-04` (Self-Supporting Underside Rib Pitch)**:
  - Replace the legacy `25.0 mm` underside rib spacing in `terrain_base_water.js` with a **`<= 6.00 mm` rib grid** (`>= 1.40 mm` rib width, `<= 4.60 mm` pocket span) connected by `>= 1.25 mm` air notches and `<= 45-deg` vault slopes (`|dz/ds| <= 1.0`).
- **`DFM-05` (Open-Bottom `45-deg` Building Relief Vaults)**:
  - Any solid building or structural block with inscribed horizontal width **`>= 5.50 mm`** and height **`>= 5.00 mm`** must be cored from `Z = 0.00 mm` upward using a `<= 45-deg` self-supporting vault while preserving **`>= 1.85 mm`** minimum wall/roof thickness.
- **`DFM-06` (Corner Anchor Integrity, Underside Relief, and Anti-Elephant-Foot Chamfer)**:
  - Perimeter vents must stay **`>= 15.0 mm` away from all `90-deg` tile corners** so corners retain uninterrupted `Z = 0` L-shaped anchor pads.
  - Keep an unbroken `>= 8.0 mm` outer perimeter skirt on multi-tile `4.0 mm` solid frames, and carve `Z = 0..1.50 mm` seam-aligned `45 deg` gabled underside stress-relief channels (`2.6 mm` wide) so `Z = 0` contact stays `<= 4,500 mm2`.
  - Apply a `0.25 mm` `45 deg` bottom chamfer (`Z = 0.00..0.50 mm`) along tile cut and perimeter edges (`0.00 mm` upper flush kerf at `Z >= 0.50 mm`).
  - Do not split small footprints (`< 20 mm` width) at `Z = 0` with through-slots that leave narrow island strips (`< 7.5 mm` wide).
- **`DFM-07` (Self-Supporting Bridges, Archways, and Horizontal Holes)**:
  - Flat horizontal downward-facing ceilings (`angle_from_horizontal < 35 deg`) are forbidden when unsupported horizontal distance to the nearest solid support (half-span) exceeds **`2.25 mm`** (i.e., **`<= 4.50 mm`** full two-sided bridge span or **`<= 2.25 mm`** one-sided cantilever).
  - River bridges (`features_bridges.js`) and `building:min_height` passages whose unsupported half-span exceeds **`2.25 mm`** (full span **`> 4.50 mm`**) must automatically generate `<= 45-deg` abutment haunches or intermediate support piers down to the water/terrain floor.
  - Horizontal circular holes with diameter **`>= 5.00 mm`** must convert the top `45-deg` arc into a `45-deg` pointed teardrop crown to prevent flat-crown collapse.
- **`DFM-08` (True Global `2-Manifold` Export)**:
  - Exported STL meshes must contain **`0` open edges, `0` non-manifold edges, `0` non-manifold vertices, and `0` coplanar inter-shell overlaps** when audited globally in quantized `float32` space (without per-shell hash isolation).
- **`DFM-09` (Multi-Part Classic FEP Tenting Clearance)**:
  - When placing multiple disjoint parts on one build plate, maintain **`>= 14.0 mm` XY separation** between adjacent high-area bases (or limit paired tile footprints to `<= 72 x 84 mm` with `>= 8.0 mm` gap and `>= 8.5 mm` Z lift).
- **`DFM-10` (Constant Physical Base Thickness and Z-Height Envelope)**:
  - Lock physical base thickness `baseBottomZ * scaleMm` to **`2.40 - 2.60 mm`** across all map frame sizes (`10 cm` to `150 cm`) and clamp total Z height to **`<= 163.0 mm`** (or detach supertall spires above `35 mm` as plug-in pins).
- **`DFM-11` (Bed Safe Area)**:
  - Every tile must fit inside the bed safe area: `153.45 x 87.05 mm` minus `state.bedSafeMarginMm` on every side (default **`4.0 mm`** -> **`145.45 x 79.05 mm`**; UI options `2.5 / 3.0 / 4.0 / 5.0 mm`).
  - Implementation: `resolveMono4SafeArea(state)` in `src/geometry/print_physics_config.js` is the single source. The tile grid (`computeOptimalMono4GridForState`), fixed-size presets (`resolveMono4ProfileGrid`), the fit warning, STL auto-rotation, the ZIP report and frame segment splitting use it.
  - Two tiles on one plate need the safe area plus a **`>= 8.0 mm`** gap between them (`DFM-09`), which gives `68.7 x 79.05 mm` per tile at the default margin.

---

## 5. Automated Pre-Print Validation Gate (`calibration/validate_msla_stl.py`)

Every STL candidate must run through `calibration/validate_msla_stl.py` before slicing:

| Check ID | Validation Algorithm | Pass Criterion | Severity |
| :--- | :--- | :--- | :---: |
| **`VAL-01`** | Global `float32` edge/vertex topology audit (merges coincident vertices across all shells) | `degen == 0`, `open_edges == 0`, `non_manifold_edges == 0`, `bad_half_edges == 0`, `non_manifold_verts == 0` | `FAIL` |
| **`VAL-02`** | 2D Z-slice flood-fill from exterior boundary at `Z = 0.15, 0.55, 0.95, 1.15 mm` (`0.25 mm` grid, strict in-slice), then every `0.25 - 0.50 mm` up to `Z_max` (`0.30 mm` grid) with upward 3D column venting seeded at `Z = 1.15 mm` | Base and transition zone: `0` enclosed cavities `> 2.0 mm2`. Upper stories: `FAIL` at `>= 100 mm2`, `WARN` at `2 - 100 mm2` (evidence: courtyards up to `75.7 mm2` printed clean in ABS Stage 2; `714 mm2` cavity failed in ABS Stage 1) | `FAIL` / `WARN` |
| **`VAL-03`** | Transition-zone vent ceiling height check (`Z <= 1.10 mm` at `0.100 mm` profile) | Every cavity open at `Z = 0.15 mm` remains vented to exterior at `Z = 1.15 mm` | `FAIL` |
| **`VAL-04`** | Downward-facing overhang scanner (`nz < -0.80`, i.e., `< 36.8 deg` from horizontal, at `Z > 0.25 mm`) | Unsupported 2D distance to solid support at `Z - 0.15 mm` (half-span) `<= 2.45 mm` (`<= 4.50 mm` two-sided bridge span) | `FAIL` / `WARN` |
| **`VAL-05`** | Disjoint shell `Z = 0` grounding and narrow base-pad aspect check | Every shell touches `Z = 0.00 mm`; `Z = 0` contact pads have min width `>= 4.0 mm` and `Z_height / min_pad_width <= 3.5` | `WARN` / `FAIL` |
| **`VAL-06`** | Multi-shell XY gap check vs classic FEP tenting radius | Gap between two shells with `Z = 0` area `> 180 mm2` is `>= 12.0 mm` | `WARN` |
| **`VAL-07`** | Layer-by-layer cross-section area (`A(z)`) and peel-spike (`A(z+dz) / A(z)`) scanner | Max slice area `<= 2600 mm2`; step increase `<= 150 mm2` when `A(z) > 100 mm2` | `WARN` |
| **`VAL-08`** | Build-volume envelope and VAT resin depletion check | `X <= 153.4 mm`, `Y <= 87.0 mm`, `Z <= 163.0 mm`; warns when `volume > 30 ml` to verify VAT fill level | `FAIL` / `INFO` |
| **`VAL-09`** | Inward seam cross-section continuity (`seam +/- 0.010 mm`) and cut-plane flatness (`Z >= 0.50 mm`) | `true_diff <= 0.15 mm2`, `max_step <= 0.20 mm`, `|area_A - area_B| <= 0.25 mm2`, flatness `<= 0.005 mm` | `FAIL` |
| **`VAL-10`** | Global assembly footprint, gap/overlap, uniform `Z_base`, 4-way `+` corners, multi-frame datum | Footprint `<= 0.08 mm`, zero overlap, `dZ_base <= 0.05 mm`, `+` corner Z step `<= 0.20 mm` | `FAIL` |
| **`VAL-11`** | Uncut master solid vs summed exported tiles volume conservation | `|sum_tiles - master| / master <= 0.5%` | `FAIL` |
| **`VAL-12`** | Zero unapproved shell crumbs or floating components across assembly | No `minZ > 0.04 mm`, no `z0_area < 35.0 mm2`, no `min_width < 4.0 mm`; secondary shells `>= 60 mm2` & `>= 5.0 mm` allowlisted | `FAIL` |
| **`VAL-13`** | `DFM-06` bottom chamfer inset (`Z = 0.10` vs `Z = 0.70 mm`) and `Z = 0` contact relief balance | Edge inset `>= 0.20 mm`; `z0_area <= 4,500 mm2` when underside relief is active | `FAIL` |
| **`VAL-14`** | Photon Mono 4 safe bed fit (`4.0 mm` margin) and `VAL-01..08` zero failures | All tiles fit `145.45 x 79.05 x 163.0 mm` with `0` blocking issues | `FAIL` |

---

## 6. Calibration and Utility Artifacts (`calibration/`)

Each artifact passed `calibration/validate_msla_stl.py` and the independent reviewer before print. The table records the physical result.

| Artifact | Generator | Purpose | Physical Result |
| :--- | :--- | :--- | :--- |
| `abs_stage1_calibration_and_gauge.stl` | `generate_abs_stage1_stl.py` | First ABS White calibration and Z-arm gauge | Failed parts (`F-03`, `F-04`, `F-05`); validator now reports `FAIL` on this file as expected |
| `abs_stage2_krakow_and_gauge_010mm.stl` | `generate_abs_stage2_stl.py` | Krakow `60 x 60 mm` tile, P1 Z-arm gauge, M8 block | City detail `10/10`; P1 (`51.00 x 14.00 mm`) fits the Z-arm; defects caused by a resin leak under the VAT (`F-07`) |
| `abs_flexplate_bed_calibration_010mm.stl` | `generate_abs_flexplate_bed_calibration_stl.py` | Full-bed calibration after Flex Plate, spacer and new VAT (`145 x 79 x 4 mm`, 9 zones) | All details complete, no delamination, clean release from the Flex Plate |
| `abs_dripper_mono4_v2_010mm.stl` | `generate_abs_dripper_mono4_stl.mjs` (Node, `manifold-3d`) | Build plate dripper: female sleeve `52.5 x 15.5 mm`, male socket `44.0 x 14.0 mm` with `R 2.0 mm` corners | Usable; slight side peel at the socket end (`F-11`). v1 (deleted) failed fit (`F-10`) and lifted a corner (`F-09`) |

Third-party source files `calibration/Photon_mono4_drip.stl` (dripper) and `calibration/mono-4-z-axis-spacer.stl` (Printables Z-axis spacer) are local reference copies. They are not part of the repository because their license is not confirmed.

### Validator Notes (`VAL-02`)

- Upper-story cavities use upward 3D column venting seeded at `Z = 1.15 mm`. A seed cell is blocked when any non-vertical triangle crosses the vertical ray at the cell center between two scan slices, so a thin solid floor between slices cannot vent the cavity above it.
- Upper-story thresholds come from physical prints: closed courtyards up to `75.7 mm2` printed clean (Stage 2), a `714 mm2` unvented cavity failed (Stage 1).
