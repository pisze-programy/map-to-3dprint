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
| `Normal Z Lift Distance` | `3.000 / 4.000 mm` | `3.500 / 4.500 mm` | `8.0 mm` total clears coupled classic FEP tenting |
| `Normal Z Lift Speed` | `1.500 / 4.500 mm/s` | `1.500 / 4.500 mm/s` | Slow initial peel (`1.5 mm/s`) protects thin features |
| `Normal Z Retract Speed` | `2.000 / 4.500 mm/s` | `2.000 / 4.500 mm/s` | Limits Poiseuille squeeze-out pressure near `Z = 0` |
| `Bottom Z Lift Distance` | `3.500 / 4.500 mm` | `4.000 / 5.000 mm` | `9.0 mm` total guarantees full detachment on wide spans |
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
- **`DFM-06` (Corner Anchor Integrity and Anti-Elephant-Foot Chamfer)**:
  - Perimeter vents must stay **`>= 15.0 mm` away from all `90-deg` tile corners** so corners retain uninterrupted `Z = 0` L-shaped anchor pads.
  - Apply a `0.30 - 0.38 mm` horizontal inset step on `Z = 0.00 .. 0.40 mm` along outer perimeters to compensate bottom-layer UV bloom.
  - Do not split small footprints (`< 20 mm` width) at `Z = 0` with through-slots that leave narrow island strips (`< 7.5 mm` wide).
- **`DFM-07` (Self-Supporting Bridges, Archways, and Horizontal Holes)**:
  - Flat horizontal downward-facing ceilings (`angle_from_horizontal < 35 deg`) are forbidden when unsupported span exceeds **`2.20 mm`**.
  - River bridges (`features_bridges.js`) and `building:min_height` passages with span **`> 2.20 mm`** must automatically generate `<= 45-deg` abutment haunches or intermediate support piers down to the water/terrain floor.
  - Horizontal circular holes with diameter **`>= 5.00 mm`** must convert the top `45-deg` arc into a `45-deg` pointed teardrop crown to prevent flat-crown collapse.
- **`DFM-08` (True Global `2-Manifold` Export)**:
  - Exported STL meshes must contain **`0` open edges, `0` non-manifold edges, `0` non-manifold vertices, and `0` coplanar inter-shell overlaps** when audited globally in quantized `float32` space (without per-shell hash isolation).
- **`DFM-09` (Multi-Part Classic FEP Tenting Clearance)**:
  - When placing multiple disjoint parts on one build plate, maintain **`>= 14.0 mm` XY separation** between adjacent high-area bases (or limit paired tile footprints to `<= 72 x 84 mm` with `>= 8.0 mm` gap and `>= 8.5 mm` Z lift).
- **`DFM-10` (Constant Physical Base Thickness and Z-Height Envelope)**:
  - Lock physical base thickness `baseBottomZ * scaleMm` to **`2.40 - 2.60 mm`** across all map frame sizes (`10 cm` to `150 cm`) and clamp total Z height to **`<= 163.0 mm`** (or detach supertall spires above `35 mm` as plug-in pins).

---

## 5. Automated Pre-Print Validation Gate (`calibration/validate_msla_stl.py`)

Every STL candidate must run through `calibration/validate_msla_stl.py` before slicing:

| Check ID | Validation Algorithm | Pass Criterion | Severity |
| :--- | :--- | :--- | :---: |
| **`VAL-01`** | Global `float32` edge/vertex topology audit (merges coincident vertices across all shells) | `degen == 0`, `open_edges == 0`, `non_manifold_edges == 0`, `bad_half_edges == 0`, `non_manifold_verts == 0` | `FAIL` |
| **`VAL-02`** | 2D Z-slice flood-fill from exterior boundary at `Z = 0.15, 0.55, 0.95, 1.15 mm` (`0.25 mm` grid) | `0` enclosed internal air/resin cavities (`> 2.0 mm2`) isolated from outer exterior | `FAIL` |
| **`VAL-03`** | Transition-zone vent ceiling height check (`Z <= 1.10 mm` at `0.100 mm` profile) | Every cavity open at `Z = 0.15 mm` remains vented to exterior at `Z = 1.15 mm` | `FAIL` |
| **`VAL-04`** | Downward-facing overhang scanner (`nz < -0.80`, i.e., `< 36.8 deg` from horizontal, at `Z > 0.25 mm`) | Single connected flat ceiling area `<= 12.0 mm2` and minor-axis span `<= 2.50 mm` | `FAIL` / `WARN` |
| **`VAL-05`** | Disjoint shell `Z = 0` grounding and narrow base-pad aspect check | Every shell touches `Z = 0.00 mm`; `Z = 0` contact pads have min width `>= 4.0 mm` and `Z_height / min_pad_width <= 3.5` | `WARN` / `FAIL` |
| **`VAL-06`** | Multi-shell XY gap check vs classic FEP tenting radius | Gap between two shells with `Z = 0` area `> 180 mm2` is `>= 12.0 mm` | `WARN` |
| **`VAL-07`** | Layer-by-layer cross-section area (`A(z)`) and peel-spike (`A(z+dz) / A(z)`) scanner | Max slice area `<= 2600 mm2`; step increase `<= 150 mm2` when `A(z) > 100 mm2` | `WARN` |
| **`VAL-08`** | Build-volume envelope and VAT resin depletion check | `X <= 153.4 mm`, `Y <= 87.0 mm`, `Z <= 163.0 mm`; warns when `volume > 30 ml` to verify VAT fill level | `FAIL` / `INFO` |
