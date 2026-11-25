# Blind Architecture Audit: Hybrid Hero Landmark Strategy

Date: `2026-11-25`.
Three independent auditors (`rev-argon`, `rev-carbon`, `rev-neon`) evaluated three geometry strategies for `249 PLN` A4 through `50x70 cm` SKUs.

## 1. Three-Model Scoreboard (`3:0` Unanimous Winner: Option C)

| Strategy Option | `rev-argon` (`/40`) | `rev-carbon` (`/40`) | `rev-neon` (`/40`) | Verdict |
| :--- | :---: | :---: | :---: | :--- |
| **Option A**: Pure procedural OSM (`zero city hacks`) | `25.5` | `25.5` | `28.0` | **Rejected** |
| **Option B**: Fully hand-sculpted city SKUs | `17.5` | `16.0` | `18.0` | **Rejected** |
| **Option C**: Hybrid procedural fabric + geo-anchored hero library | **`38.6`** | **`36.5`** | **`36.0`** | **Winner (`3:0`)** |

## 2. Real-SKU Visual Triggers Inspected

Procedural OSM builds roughly `98%` of urban streets, blocks, bridges, and black-water cutouts cleanly.
Close-up `10K` MSLA macro inspections exposed clear OSM LoD2 limits on flagship monuments:

- **Paris Tour Eiffel**: Raw OSM LoD2 tags caused a bulbous summit dome cap and arch slab overhangs with vertical pipes.
- **Warsaw `PKiN`**: Crowd-tagged parts lose crisp spire proportions and stepped Stalinist tier fidelity.
- **Warsaw `Zlote Tarasy`**: OSM turns the undulating glass wave canopy into simplified egg-shaped bulbs.
- **Warsaw `Most Poniatowskiego`**: OSM omits the iconic ornamental bridgehead viaduct turrets.
- **Warsaw `PGE Narodowy`**: Raw OSM cannot capture the tensioned suspended stadium roof accurately.

## 3. Why Option C Scales to 200 Cities and All Formats

- **Luxury unboxing trust (`249 PLN`+)**: Buyers inspect the `1-2` focal monuments up close in open glassless frames.
- **Zero-rework cross-format reuse**: One metric-anchored landmark re-crops and re-scales across `12x17`, Triptych, Square, and `50x70 cm`.
- **High engineering leverage**: Roughly `25-150` reusable monument assets cover a `200`-city curated catalog while core solvers stay `100%` generic.
- **Strict technical contract**:
  - Anchor every landmark by real-world `(lat, lon, heading_deg, metric scale)` with explicit `replaceOsmIds` footprint suppression.
  - Require a watertight `2-manifold` solid ground skirt and enforce `SLA_PRINT_LAWS` strut minimums per scale.
  - Validate every merged tile with `calibration/validate_msla_stl.py` (`VAL-01..08`) after Manifold CSG union.

## 4. Recommended Rule Change (Pending User Sign-Off)

Do not alter `AGENTS.md` Core Rules until the user approves Option C.
If approved, replace the current `zero city hacks` clause with these two rules:

- Keep `SLA_PRINT_LAWS`, `roadHeightMm`, and pure ASCII in `src/` and `tests/`; keep core procedural builders `100%` city-agnostic.
- Place bespoke hero monuments only in a geo-anchored landmark library with `replaceOsmIds` suppression, reference-photo QA, and `VAL-01..08` proof.
