# Product Format and Paid Ads Decisions

This document records finalized product formats, pricing tiers, and social video ad rules.
All geometry parameters match `config/format_catalog.json`.

## 1. Locked Single Format (`249 PLN`, Heavy A4 Gallery)

A `3:0` blind paid-ads audit (`Argon`, `Carbon`, `Neon`) retired thin `13 x 18 cm`.
The audit locked **Heavy A4 `21 x 29.7 x 3.0 cm`** white passe-partout as the canonical Single format (`single_a4_1x3`).
Customers place the frame flat on a desk or hang it flush on a wall.
Never use stands or easels (podstawki) in product design or marketing renders.

| Format | Audit Verdict | Key Findings |
| :--- | :--- | :--- |
| Thick `13 x 18 cm` with passe-partout | Rejected (`0:4`) | Triggers `19 PLN` IKEA frame anchor; shrinks city area. |
| Round `15 cm` (`2` Mono 4 semicircles) | Retired | Strong thumb-stop; weak home-use clarity without a stand. |
| Thin `13 x 18 cm` without passe-partout | Retired (`0:3` vs A4) | Clean desk piece; lower gift impact than gallery A4. |
| **Heavy A4 `21 x 29.7 x 3.0 cm` white passe-partout** | **Locked (`3:0`, `249 PLN`)** | Gallery wall and desk authority on three `1x3` Mono 4 strips. |

## 2. Heavy A4 Gallery Spec and Commercial Guardrails

- **Outer frame**: `210 x 297 x 30 mm` matte jet-black box (`15 mm` rim, `7 mm` inner step).
- **Passe-partout**: Classic white-only `2 mm` matboard with a `45 deg` beveled `120 x 170 mm` window (`single_a4_landscape_3x1` uses `170 x 120 mm`).
- **Backing and open air**: Use matte black archival paper backing with zero glass, zero nameplate, and zero stands.
- **Tile geometry**: Print three flush `120.0 x 56.67 mm` (`1x3`) strips with a `4.0 mm` solid tunnel-free base (`docs/a4-tile-grid-audit.md`).
- **Seam finishing**: Keep seams at `Y = +/-28.33 mm`, fill joints with white resin, UV-cure, and apply matte clear coat.
- **Guardrail 1 (Lighting)**: Shoot all ads with raking side light so crisp shadows prove real 3D relief.
- **Guardrail 2 (Angles)**: Lead ads and product cards with `30-45 deg` 3D angles, never `90 deg` flatlays.
- **Guardrail 3 (Shipping and care)**: Ship in a recessed Paczkomat insert and publish a concise compressed-air dusting FAQ.

## 3. Wall Set and Multi-Format Catalog (`config/format_catalog.json`)

Scale single-city buyers into larger wall compositions using verified Mono 4 formats:

- **Warsaw format split**: Sell **Warsaw Centrum** (`single_a4_1x3`, `120 x 170 mm`) as Single A4 (`249 PLN`). Reserve **Warsaw West-East Panorama** (`Centrum -> Powisle -> Wisla + Bridges -> PGE Narodowy`) for **Triptych**.
- **Triptych (`triptych_a4_3x1`, `599-649 PLN`)**: Mount `3` separate Heavy A4 frames (`3 x 210 x 297 mm`, `360 x 170 mm` relief, `3x3` = `9` strips of `120.0 x 56.67 mm`). Separate A4 frames reuse existing packaging and eliminate vertical resin seams across the skyline.
- **Quartet (`quartet_a4_2x2`, `749-799 PLN`)**: Mount `4` separate Heavy A4 frames in `2x2` (`240 x 340 mm` portrait relief, `2x6` = `12` strips of `120.0 x 56.67 mm`). Never market `4x(1x3)` as a square.
- **Small Square (`square_150_2x2`)**: `150 x 150 mm` relief inside one `240 x 240 mm` frame (`2x2` = `4` tiles of `75.0 x 75.0 mm`).
- **True `1:1` Square (`square_240_2x4`, `499-549 PLN`)**: `240 x 240 mm` relief inside one `340 x 340 mm` frame (`2x4` = `8` strips of `120.0 x 60.0 mm`).
- **Flagship `50x70 cm` (`flagship_50x70_3x9`, `1,499-1,799 PLN`)**: `360 x 510 mm` relief inside one `500 x 700 mm` frame (`3x9` = `27` strips of `120.0 x 56.67 mm`, MTO Courier).

## 4. Meta and TikTok Ad Creative Grammar (`15 s`, `9:16`)

Design every `9:16` Reels, Meta, and TikTok ad with this exact pacing:

1. **Hook (`0-2 s`)**: Show the full recognizable framed city at once. Give instant category clarity and visual curiosity (Kinder ad pacing).
2. **Kinetic sequence (`2-11 s`)**: Keep the camera moving with zero dead freezes. Combine four dynamic moves:
   - Speed-ramp crash-zoom into the tallest skyline peak.
   - Low-angle crane rise-up with sweeping raking side light.
   - Overhead-to-canyon swoop between tall towers.
   - Smooth crane pull-out back to the complete framed object.
3. **Scale reveal (`11-15 s`)**: Include a human hand scale reveal so viewers feel physical size and `10K` detail.

## 5. Production Visual Standard

- Render all product stills and ad footage in photorealistic Blender Cycles environments.
- Pass `--manifest <export_dir>/assembly_manifest.json` (`VAL-01..14 PASS`) and `--frame auto` for every production render.
- Never publish flat untextured viewport captures or `--draft-unvalidated` outputs as paid ad creative.
- Export `9:16` `Start -> End` keyframes for Google Flow (Veo) or render direct Cycles MP4 clips.
- Read `docs/blender-studio-workflow.md` for exact CLI commands and MCP tools.
