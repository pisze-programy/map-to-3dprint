# Anycubic Photon Mono 4 Slicer Profile (`0.100 mm` ABS White)

Use this Photon Workshop profile for Photon Mono 4 (`10K`, `17 um` XY) with classic FEP and Flex Plate.
Do not change any setting without a single-parameter A/B print test.

## 1. Baseline Production Parameters

Use Anycubic ABS-Like Resin Pro 2 White and place every tile flat at `Z = 0.00 mm` with zero supports.

| Slicer Parameter | Baseline Value | Solid-Base A4 (`4.0 mm`) Value | Purpose |
| :--- | :---: | :---: | :--- |
| `Layer Thickness` | `0.100 mm` | `0.100 mm` | Halves print time while keeping `17 um` XY sharpness |
| `Normal Exposure Time` | `4.100 s` | `4.100 s` | Cures bridges, spires, and micro-walls cleanly |
| `Normal Off Time` | `2.000 s` | **`2.500-3.000 s`** | Lets hydraulic resin settle across solid `0..4.0 mm` layers |
| `Normal Z Lift Distance` | `3.000 + 4.000 mm` | **`3.500 + 4.000` or `4.500 mm`** | Adds classic FEP peel margin on `120 x 56.7 mm` solid strips |
| `Normal Z Lift Speed` | `1.500 + 4.500 mm/s` | `1.200-1.500 + 4.500 mm/s` | Slow Step 0 peel protects thin spires and arches |
| `Normal Z Retract Speed` | `2.000 + 4.500 mm/s` | `2.000 + 4.500 mm/s` | Limits squeeze-out pressure near the FEP |
| `Bottom Layers` | `5` (`0.50 mm`) | `5` (`0.50 mm`) | Anchors wide tiles onto Flex Plate |
| `Bottom Exposure Time` | `35.000 s` | `35.000 s` | Flex Plate setting (`30-31 s` on bare aluminum) |
| `Bottom Off Time` | `10.000 s` | `10.000 s` | Prevents Z-arm deflection on wide bottom layers |
| `Transition Layer Count` | `6` (`Z <= 1.10 mm`) | `6` (`Z <= 1.10 mm`) | Smooths cure transition above bottom layers |
| `Bottom Z Lift Distance` | `3.500 + 4.500 mm` | `3.500 + 4.500 mm` | Clears bottom FEP tenting across `8.0 mm` lift |
| `Bottom Z Lift / Retract Speed` | `1.500 + 4.000 mm/s` | `1.500 + 4.000 mm/s` | Stops corner tear-off during initial base peel |
| `Anti-alias` (`Advanced`) | **`Off (1)`** | **`Off (1)`** | Prevents `TiO2` UV scatter in courtyards and lattices |

## 2. Mandatory Rules for `4.0 mm` Solid-Base A4 Strips (`3x 120 x 56.7 mm`, `1x3`)

- **Use `1x3` horizontal strips**: Print `Top`, `Middle`, and `Bottom` (`120x56.7 mm`) inside the `4.0 mm` safe bed margin.
- **Never enable slicer hollowing or infill**: Closed cavities without bottom drains create fatal `VAL-02` suction cups and weaken flat corners.
- **Print `100%` solid**: Solid `4.0 mm` bases keep vertical side walls smooth and prevent corner curl.
- **Keep VAT topped up**: Solid `1x3` strips use about `30-60 ml` per plate (`-33%` peel area vs legacy `1x2`).
- **Cure both sides evenly**: After IPA wash and drying, UV-cure top and underside faces flat for `~2 min` each.
- **Run validator first**: Check every STL with `python3 calibration/validate_msla_stl.py <file.stl>` before slicing.

## 3. Related References

- Read `docs/calibration-history-mono4.md` for verified Dubai, NYC, and Paris print milestones.
- Read `docs/msla-printability-and-validation-spec.md` for `DFM-01`..`DFM-11` and `VAL-01`..`VAL-08` geometry rules.
