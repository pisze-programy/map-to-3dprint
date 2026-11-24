# Blind Audit: A4 `120 x 170 mm` Tile Grid on Photon Mono 4

Date: `2026-11-24`.
Three independent auditors (`rev-argon`, `rev-neon`, `rev-carbon`) compared three A4 tile splits on Anycubic Photon Mono 4.

## 1. Hardware Constraints

- **Raw LCD area**: `153.45 x 87.05 mm` (`165.0 mm` Z ceiling).
- **Calibrated safe floor**: `4.0 mm` margin per side (`145.45 x 79.05 mm`, proven on Flex Plate).
- **A4 target opening**: `120.0 x 170.0 mm` flush inside the white beveled passe-partout.

## 2. Three-Model Scoreboard (`3:0` Unanimous Winner: Option C)

| Grid Option | Tile Size & Rotation | X / Y Margin | Peel Area | Seams & Plates | Argon / Neon / Carbon | Verdict |
| :--- | :--- | :---: | :---: | :--- | :---: | :--- |
| **A (`1x2`)** | `120 x 85 mm` (`0 deg`) | `16.7 / 1.025 mm` | `102.0 cm2` | `1` center `Y=0`, `2` plates | `19.0 / 19.0 / 17.0` | **Rejected** |
| **B (`2x2`)** | `60 x 85 mm` (`90 deg`) | `34.2 / 13.5 mm` | `51.0 cm2` | `+` center cross, `4` plates | `17.0 / 17.0 / 17.0` | **Rejected** |
| **C (`1x3`)** | `120 x 56.67 mm` (`0 deg`) | `16.7 / 15.2 mm` | `68.0 cm2` | `2` at `Y=+/-28.3 mm`, `3` plates | `26.2 / 25.0 / 26.0` | **Winner (`3:0`)** |

## 3. Why Option C (`1x3`) Wins

- **Safe Mono 4 margins**: `16.7 mm` X and `15.2 mm` Y margins exceed the `4.0 mm` calibrated floor by `3.8x`.
- **Lower hydraulic peel force**: Peel area drops by `33%` (`68.0 cm2`) and squeeze suction drops by `70.4%` versus Option A.
- **Unbroken center hero band**: Seams sit at `Y = +/-28.33 mm`. This leaves a `56.7 mm` seamless center strip.
- **Clean visual finish**: Option C has zero vertical seam and avoids Option B's dead-center `+` intersection.
- **Fast 1D assembly**: Three horizontal strips align cleanly along one straight edge inside the A4 frame.

## 4. Export Naming and Assembly Order (`1x3`)

| Tile Slot | Row ID | Dimensions | Y Span (`mm`) | Filename Suffix |
| :--- | :---: | :---: | :---: | :--- |
| **Top** (North) | `R1C1` | `120.0 x 56.67 mm` | `+28.33 .. +85.00` | `_Top_120x57mm.stl` |
| **Middle** (Center Hero) | `R2C1` | `120.0 x 56.67 mm` | `-28.33 .. +28.33` | `_Middle_120x57mm.stl` |
| **Bottom** (South) | `R3C1` | `120.0 x 56.67 mm` | `-85.00 .. -28.33` | `_Bottom_120x57mm.stl` |

Assemble `Top`, `Middle`, and `Bottom` North to South against a straight edge on matte-black archival backing.
Read `docs/mono4-slicer-profile.md` for `4.0 mm` solid-base slicer settings.
