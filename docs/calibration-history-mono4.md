# Anycubic Photon Mono 4 Calibration History

This log records verified hardware limits, slicer settings, and physical print milestones.
For full geometry and validator rules, read `docs/msla-printability-and-validation-spec.md`.

## 1. Reference Hardware Setup

- **Printer**: Anycubic Photon Mono 4 (`10K`, `9024 x 5120 px`, `17 um` XY pixel pitch).
- **Build volume**: `153.45 x 87.05 x 165.0 mm` (`163.0 mm` safe Z ceiling).
- **Default bed safe area**: `4.0 mm` margin per side, giving `145.45 x 79.05 mm` usable footprint.
- **Single source of truth**: `resolveMono4SafeArea(state)` in `src/geometry/print_physics_config.js`.
- **Hardware upgrades**: Magnetic spring steel Flex Plate (`+2.7 mm`), printed Z-axis spacer, and Mono 4 dripper v2.
- **Release film**: Leak-free VAT with classic FEP film and fresh screen protector.
- **Orientation**: Place every map tile flat at `Z = 0.00 mm` with `0 deg` tilt and zero supports.

## 2. Production Slicer Profile (`0.100 mm`)

Use Anycubic ABS-Like Resin Pro 2 White with these verified settings.
Do not change any setting without a single-parameter A/B print test.

| Setting | Value | Purpose |
| :--- | :--- | :--- |
| Layer thickness | `0.100 mm` | Halves print time while keeping `17 um` XY detail |
| Normal exposure | `4.100 s` | Cures `4.2 mm` vent bridges cleanly |
| Bottom layers / exposure | `5` layers / `35.0 s` | Anchors wide tiles on Flex Plate (`30-31 s` bare aluminum) |
| Transition layers | `6` (`Z <= 1.10 mm`) | Smooths cure transition above bottom layers |
| Off time (normal / bottom) | `2.0 s` / `10.0 s` | Prevents Z-arm deflection and refills resin |
| Z lift (normal / bottom) | `3.0 + 4.0 mm` / `3.5 + 4.5 mm` | Clears classic FEP peel stretch |
| Anti-alias | `1` (Off) | Prevents `TiO2` UV scatter in narrow slots |

## 3. Early Calibration Milestones

- **ABS Stage 1**: Exposed unvented suction cups (`F-03`), thin-feature loss (`F-04`), and low vent closure (`F-05`).
- **ABS Stage 2 (Krakow tile)**: Achieved `10/10` city detail and confirmed Z-arm gauge fit (`51.0 x 14.0 mm`).
- **Flex Plate Bed Calibration (`145 x 79 x 4 mm`)**: All 9 zones printed cleanly with zero delamination.
- **Mono 4 Dripper v2**: Printed cleanly and mounts on the build plate bracket.

## 4. Dubai Business Bay Milestone (Commit `1e56f08`)

- **Tile**: `exports/dubai_business_bay_145x79_1x1/Map3D_DUBAI_Business_Bay_145x79mm.stl` (`145 x 79 mm`).
- **Systemic core fixes**:
  1. Added shallow anti-peel underside relief grooves in `src/mesh/tile_sla_vault_solver.js`.
  2. Added vented `R1C1^` tile ID engraving in `src/mesh/tile_id_emboss.js`.
  3. Added capillary and narrow courtyard guards in `src/mesh/tile_sla_vault_solver.js`.
  4. Added grounded overhang and bridge piers in `src/mesh/bridges/bridge_supports_solver.js`.
  5. Enforced zero-degenerate Float32 watertight STL export in `src/geometry/manifold_core.js`.
- **Verification**: Passed `calibration/validate_msla_stl.py` with `0` blocking errors.
- **Physical result**: Printed cleanly on Mono 4 using about `40 g` of resin.

## 5. New York One WTC 3-Part Triptych Calibrator

- **Tiles** (under `exports/nyc_wtc_145x79_1x1/`):
  - `P0 Tribeca`: `Map3D_NYC_Triptych_01_Top_Tribeca_145x79mm.stl`
  - `P1 One WTC`: `Map3D_NYC_WTC_145x79mm.stl` (`8.26 cm` spire)
  - `P2 Battery Park / Diamond Reef`: `Map3D_NYC_Triptych_03_Bottom_BatteryPark_145x79mm.stl`
- **Scene setup**: `span=1.58 km`, `rot=+15 deg`, `zScale=1.6x`.
- **Verification**: All 3 tiles passed `calibration/validate_msla_stl.py` (`shells=1`, `0` blocking errors).
- **Physical result**: All 3 elements printed with 100% success, sharp `8.26 cm` spire, crisp skyscrapers, and zero defects.

## 6. A4 `12x17 cm` (`1x3`) Solid-Base No-Tunnel Mode

- **Production preset (`1x3`)**: Splits `120x170 mm` into three `120x56.7 mm` strips (`Top`, `Middle`, `Bottom`). Fits inside `4.0 mm` safe bed margin.
- **Unbroken center band**: Seams sit at `Y = +/-28.3 mm`. The `56.7 mm` center hero zone stays intact (`docs/a4-tile-grid-audit.md`).
- **Solid base (`4.0 mm`)**: Keep an unbroken `>= 8.0 mm` outer skirt with zero side tunnels (`solidBaseNoTunnels`).
- **Underside relief (`F-12`, `VAL-13`)**: Carve `Z=0..1.50 mm` gabled grooves (`8.80 mm` pitch) for `<=4,500 mm2` `Z=0` contact. Add a `0.25 mm` `DFM-06` bottom chamfer (`Z=0..0.50 mm`).
- **Solid-base slicer tweaks**:
  - Set `Normal Off Time` to `2.5-3.0 s`. Set `Normal Z Lift` to `3.5+4.0 mm` (or `3.5+4.5 mm`).
  - Keep `Anti-alias = Off (1)` and print `100%` solid with zero slicer hollowing.
  - Cure top and bottom faces evenly under UV light to prevent bow warp.
- **Early `1x2` (`120 x 85 mm`) calibrator pairs** (superseded by `1x3` for safe `Y` bed margins):
  - NYC WTC (`exports/nyc_wtc_a4_120x170_2x1/`): `0` blocking errors, `0.0 mm` frame edge gaps.
  - Paris Tour Eiffel (`exports/paris_eiffel_a4_120x170_2x1/`): `lat=48.8576, lon=2.2956, span=1.78 km, rot=-46 deg, zScale=1.7`, `PASS`, `shells=1`.
  - Singapore Marina Bay & NYC Central Park (`exports/singapore_marina_bay_a4_120x170_2x1/`, `exports/nyc_central_park_a4_120x170_2x1/`): all 4 tiles `PASS`, `shells=1`.

## 7. Production Readiness Status

- The Mono 4 hardware, slicer profile, and export pipeline pass all production gates.
- Run `calibration/validate_assembly.py` (`VAL-01..14 PASS`) on every exported assembly before slicing.
- Start printing verified target cities across single (`1`), triptych (`3`), and quartet (`4`) formats.
