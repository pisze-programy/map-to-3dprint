# Agent Routing Map (`map-to-3dprint`)

Read this map first. Open only the focused guide that matches your task.

## Mandatory Core Rules

- Write clean, modular code with single-responsibility functions.
- Split large monolithic files into small focused modules.
- Add strict types: JSDoc or TypeScript types in JS, full type hints in Python.
- Never treat unit tests alone as proof. Collect real E2E, visual, or validator proof.
- Keep `SLA_PRINT_LAWS`, `roadHeightMm`, pure ASCII in `src/` and `tests/`, and zero city hacks.
- Delegate multi-part tasks to subagents or a swarm with clear file ownership.
- Check claims against Antigravity transcripts and real artifacts on disk before you act.
- Commit every verified milestone locally with atomic Conventional Commits. Never push unless the user asks.
- Write all documentation in ASD-STE100 Simplified Technical English (active voice, max 20 words per sentence, pure ASCII).

## Documentation Routing Table

| Read this file | When you work on this task |
| :--- | :--- |
| [clean-code-and-proof-rules.md](docs/clean-code-and-proof-rules.md) | Code edits, typing, proof gates, defect guards, or agent delegation. |
| [msla-printability-and-validation-spec.md](docs/msla-printability-and-validation-spec.md) | Mesh generation, STL export, `DFM-01`..`DFM-11`, or `VAL-01`..`VAL-08` rules. |
| [calibration-history-mono4.md](docs/calibration-history-mono4.md) | Photon Mono 4 hardware setup, slicer settings, or verified print milestones. |
| [blender-studio-workflow.md](docs/blender-studio-workflow.md) | Photorealistic Cycles stills, Google Flow keyframes, videos, or studio MCP. |
| [studio-art-direction-and-scenes.md](docs/studio-art-direction-and-scenes.md) | Studio art direction, 11 render environments, prop swaps, or first ad sequence. |
| [product-and-ads-decisions.md](docs/product-and-ads-decisions.md) | Frame formats, pricing, set layouts, seam finish, or 15 s social ads. |
| [lichtbild-vs-map3d-analysis.md](docs/lichtbild-vs-map3d-analysis.md) | Architecture, data, or render comparison against the Lichtbild benchmark. |
| [lichtbild-buildings-diagnosis.md](docs/lichtbild-buildings-diagnosis.md) | Tall spire geometry or OSM building-part extrusion debugging. |

## Core Commands

- Rebuild browser bundle after `src/` edits: `python3 build_app.py`
- Run headless invariant suite: `npm run test:headless`
- Validate an exported STL for MSLA printability: `python3 calibration/validate_msla_stl.py <file.stl>`
- Run Playwright E2E suite: `npm run test:e2e`
