# Agent Routing Map (`map-to-3dprint`)

Read this map first. Open only the focused guide that matches your task.

## Mandatory Core Rules

- Write clean, modular code with single-responsibility functions.
- Split large monolithic files into small focused modules.
- Add strict types: JSDoc or TypeScript types in JS, full type hints in Python.
- Never treat unit tests alone as proof. Collect real headless CLI, validator, or Blender visual proof.
- Never launch a browser or Playwright. Run all model generation, validation, and rendering via headless CLI scripts and Blender Cycles.
- Run `docs/city-model-and-packshot-qa-checklist.md` and `calibration/validate_assembly.py` (`VAL-01..14`) before you approve any exported STL assembly.
- Pass `--manifest <export_dir>/assembly_manifest.json` (`VAL-01..14 PASS`) for all production renders; never bypass with raw STLs.
- Keep `SLA_PRINT_LAWS`, `roadHeightMm`, and pure ASCII in `src/` and `tests/`.
- Keep core procedural builders in `src/Water/`, `src/mesh/`, and `src/buildings/` city-agnostic.
- Put curated flagship monument geometry in `src/landmarks/` using geo-anchored footprints, `replaceOsmIds` suppression, and `VAL-01..08` proof.
- Delegate multi-part tasks to subagents or a swarm with clear file ownership.
- Check claims against Antigravity transcripts and real artifacts on disk before you act.
- Commit every verified milestone locally with atomic Conventional Commits. Never push unless the user asks.
- Write all documentation in ASD-STE100 Simplified Technical English (active voice, max 20 words per sentence, pure ASCII).

## Documentation Routing Table

| Read this file | When you work on this task |
| :--- | :--- |
| [clean-code-and-proof-rules.md](docs/clean-code-and-proof-rules.md) | Code edits, typing, proof gates, defect guards, or agent delegation. |
| [city-model-and-packshot-qa-checklist.md](docs/city-model-and-packshot-qa-checklist.md) | Generating city STLs, checking tiles, verifying bridges/landmarks, or rendering packshots. |
| [msla-printability-and-validation-spec.md](docs/msla-printability-and-validation-spec.md) | Mesh generation, STL export, `DFM-01`..`DFM-11`, or `VAL-01`..`VAL-14` rules. |
| [calibration-history-mono4.md](docs/calibration-history-mono4.md) | Photon Mono 4 hardware setup, slicer settings, or verified print milestones. |
| [mono4-slicer-profile.md](docs/mono4-slicer-profile.md) | Photon Workshop `0.100 mm` ABS White profile and `4.0 mm` solid-base tweaks. |
| [blender-studio-workflow.md](docs/blender-studio-workflow.md) | Photorealistic Cycles stills, Google Flow keyframes, videos, or studio MCP. |
| [studio-art-direction-and-scenes.md](docs/studio-art-direction-and-scenes.md) | Studio art direction, 18 render environments, prop swaps, or first ad sequence. |
| [detail-chalk-gallery-mode.md](docs/detail-chalk-gallery-mode.md) | Frameless chalk-plaster detail gallery (`18_detail_chalk_gallery`, `--frame none`). |
| [product-and-ads-decisions.md](docs/product-and-ads-decisions.md) | Frame formats, pricing, set layouts, seam finish, or 15 s social ads. |
| [a4-vs-13x18-ads-audit.md](docs/a4-vs-13x18-ads-audit.md) | Blind 3-model CRO and paid-ads audit locking heavy A4 over `13 x 18 cm`. |
| [a4-tile-grid-audit.md](docs/a4-tile-grid-audit.md) | Blind 3-model Mono 4 tile grid audit locking `1x3` (`120 x 56.67 mm`) over `1x2` and `2x2`. |
| [multi-format-tiling-analysis.md](docs/multi-format-tiling-analysis.md) | Blind 3-model Mono 4 tiling and pricing matrix for Single, Triptych, Square, and `50x70`. |
| [single-a4-top10-catalog.md](docs/single-a4-top10-catalog.md) | Verified Top 10 Single A4 `1x3` city STL catalog, 4 Continents, and 3 Wildcard reliefs. |
| [hero-landmark-strategy-audit.md](docs/hero-landmark-strategy-audit.md) | Blind 3-model audit backing Option C hybrid geo-anchored hero landmark library. |
| [lichtbild-vs-map3d-analysis.md](docs/lichtbild-vs-map3d-analysis.md) | Architecture, data, or render comparison against the Lichtbild benchmark. |
| [lichtbild-buildings-diagnosis.md](docs/lichtbild-buildings-diagnosis.md) | Tall spire geometry or OSM building-part extrusion debugging. |

## Core Commands

- Run headless invariant and 10-city repo gate (`16/16`): `npm test` (or `npm run test:headless`)
- Export a catalog SKU with automatic `VAL-01..14` check: `node tools/export_city_sku.mjs --city <slug>`
- Validate an exported single STL: `python3 calibration/validate_msla_stl.py <file.stl>`
- Validate a whole exported tile assembly (`VAL-01..VAL-14`): `python3 calibration/validate_assembly.py <export_dir>/assembly_manifest.json`
