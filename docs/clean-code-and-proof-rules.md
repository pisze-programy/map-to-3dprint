# Clean Code, Proof Policy, and Agent Rules

Follow these engineering rules on every change in `map-to-3dprint`.

## 1. Clean Code and Modular Files

- Keep every module focused on one clear responsibility.
- Split large monolithic files before you add new features to them.
- Keep functions short, flat, and easy to test in isolation.
- Name files, functions, and variables after their domain role.
- Remove dead code, scratch scripts, and unused helpers before you finish.
- Keep zero non-ASCII bytes in `src/`, `tests/`, and `studio_blender/`.

## 2. Strict Typing

- Add full JSDoc `@param` and `@returns` types (or TypeScript types) to new JS code.
- Add full Python type annotations to every new or changed Python function.
- Define explicit data structures instead of passing untyped mystery dicts.
- Keep return types consistent across normal paths and fallback paths.

## 3. Proof Policy (No Unit-Test-Only Claims)

Unit tests catch logic regressions, but unit tests alone do not prove correctness.
Collect real end-to-end proof for the exact layer you changed:

- **Mesh or STL export edits**: Run `npm run test:headless`, run `calibration/validate_msla_stl.py`, and pass landmark visual QA.
- **Browser UI or GIS edits**: Rebuild with `python3 build_app.py`, run Playwright E2E on uncached cities, and inspect screenshots.
- **Blender studio edits**: Run real Cycles renders and inspect output images and video frames directly.
- **Documentation edits**: Check every CLI flag, preset name, and file path against real source files.

### Architectural Likeness and Landmark Visual QA Gate

- Never report a city STL as print-ready from `calibration/validate_msla_stl.py` alone.
- Inspect the hero landmark and top nearby landmarks from four close-up angles before sign-off.
- Use `inspect-landmark`, `audit-scene` (`tools/mcp_map3d_inspector.mjs`), and macro Cycles renders to check real-world form.
- Reject overlapping archetype and S3DB parts, deformed towers, blocked arches, or wrong roofs before export approval.
- Fix every geometry defect at the systemic builder level, never with city or landmark hacks.

## 4. Mandatory Defect-Prevention Guards

- Keep `SLA_PRINT_LAWS` (`src/geometry/sla_print_laws.js`) active in Resin Mode across all builders.
- Keep `DFM-01` through `DFM-11` constraints intact during any geometry refactor.
- Preserve `roadHeightMm` (`0.567` in `src/geometry/print_physics_config.js`) so roads stay crisp above terrain.
- Never add hardcoded city hacks, coordinate special cases, or landmark name overrides.
- Solve geometry or print defects at the systemic algorithm level so every city benefits.
- Always run `python3 build_app.py` after `src/` edits so `index.html` stays in sync.

## 5. Agent Delegation and History Verification

- Split complex multi-part tasks across subagents or a swarm.
- Give each agent strict file ownership so two agents never edit the same file.
- Use an independent verifier agent to audit builds, STLs, or visual outputs.
- Check past decisions against Antigravity transcripts (`transcript.jsonl`) and real disk artifacts.
- Never rely on memory or unverified summaries when the original file or transcript exists.

## 6. Documentation Standard

- Write all new docs in ASD-STE100 Simplified Technical English.
- Use short active-voice sentences with at most 20 words per sentence.
- Put one instruction or one fact in each sentence.
- Keep each guide small and focused. Link every guide from `AGENTS.md`.

## 7. Milestone Git Commits

- Commit every verified milestone locally before you start the next workstream.
- Write clean, atomic Conventional Commit messages scoped to one logical change.
- Never leave verified multi-step code, tests, or docs uncommitted in the working tree.
- Delete stray scratch outputs and verify `git status` before you stage files.
- Never push to a remote repository unless the user asks you to push.
