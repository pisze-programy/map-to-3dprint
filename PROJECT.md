# Project: map-to-3dprint Optimization

## Architecture
- **2D/UI Layer** (`src/ui/`, `src/template.html`):
  - Manages 2D slippy map, dimensions, place autocomplete, progress bar (`#loadingProgressBar`), error banners, settings persistence (`localStorage`), and event delegation.
  - **Explicit Render UX**: Renamed to `#btnRender3D` (`Render`). Parameter adjustments (dimensions, search/autocomplete, span/`Kadr`, rotation, or 2D map panning) **only** update the 2D map frame and persist settings **without** auto-fetching GIS or auto-rebuilding 3D. 3D model rebuild occurs **only** when user clicks `Render` or on initial boot.
  - **Expanded Frame & Span Controls**: `#cropSizeSlider` (`min="0.4" max="50.0"`), quick span chips (`0.6, 1.2, 2.5, 5, 12, 25, 50 km`), `50×100` cm frame size quick chip, and `max="150"` cm dimension limits.
  - **User-Editable LoD Filter Panel**: Exposes visible "Filtr szczegółów (LoD)" controls in UI (min building size in meters, enable/disable trees threshold, road detail level) with scale-adaptive presets (auto-disabling trees above 3.5–5 km).
  - **Clean 3D Viewport**: "Inspektor Budynku" panel and building click/hover highlighting (`highlighted` layer #5) completely removed. Rotate/pan/zoom navigation only.
  - **Default Palette**: Default color palette initialized to `Pure Architectural White` (`white`).
- **GIS Data Layer** (`src/gis_client/`, `gis/`, `server.py`):
  - Spatial proximity cache matching (`cache/scene_v5_*.json`) for instant loads of cached areas.
  - **Inactivity-Based Watchdog**: Replaces rigid 20s wall-clock kill-switch with progress-based watchdog (timer resets whenever any chunk or stage makes progress), preventing timeouts on large/uncached cities like Cape Town.
  - Hedged Overpass queries with staggered scheduling, query optimization for uncached locations, and graceful DEM fallback.
  - Adaptive Terrarium DEM tile fetching (zoom 11–14).
  - Full unhandled promise rejection prevention in `ui_app.js` and `ui_url_hooks.js`.
- **3D Geometry & Progressive Rendering Engine** (`src/mesh/`, `src/render/`, `src/geometry/`):
  - Custom WebGL 1.0 forward pipeline.
  - Non-blocking progressive staged generation yielding to event loop (`yieldToEventLoop`), keeping main-thread blocking strictly <50ms.
  - **Progressive State Machine**: Eliminates duplicate rebuilds and stage progress text mismatches; prevents tearing down or re-executing already-built stages on streaming chunk updates.
  - **Robust Polygon Triangulation**: Fast $O(N \log N)$ circular doubly-linked list ear-clipping in `mesh_clipper_3d.js` and `polygon_2d.js` with hole/cavity protection and collinearity handling.
  - **Greenery Loop Parity**: Replaces rogue `return;` with `continue;` in progressive tree placement, ensuring 100% parity with synchronous model (0 lost trees).
  - O(1) centroid `tileId` assignment in live WebGL preview (`floor((cx + halfW) / tileStepX)`), completely bypassing CSG tile clipping for 50x100 tiles during rendering and reserving watertight clipping with AABB cell-indexing for STL export.
  - High-performance numeric topology audit (32-bit spatial hash keys, zero string allocations, fast O(N) volume estimation).
- **E2E Performance & Integration Testing** (`tests/e2e/`, `package.json`):
  - Playwright test runner with WebGL ANGLE flags.
  - **Strict Uncached Testing Rule**: Forbid testing only on cached locations. Automated tests MUST verify diverse uncached real-world locations (including Cape Town and fresh coordinates) with cache bypass.
  - **Visual Verification**: Automated test suites capture and inspect screenshots across progressive stages and completion.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Automated E2E Browser Benchmark & Verification | Playwright suite measuring timing from city selection to 3D render; tests uncached cities (Cape Town) and captures progressive screenshots | E2E Testing Track | R1, User Feedback |
| 2 | Spatial Proximity Cache Matching | Match preset and nearby queries within 1.5 km to disk cache without false network misses | M1 | R3 |
| 3 | Resilient Overpass Fetching & Error Fallbacks | Eliminate unhandled Promise.any errors; optimize Overpass queries for uncached cities | M1 | R3, User Feedback |
| 4 | Inactivity-Based Watchdog & Error Elimination | Replace rigid 20s kill-switch with inactivity watchdog; eliminate unhandled rejections | M1 | R3, User Feedback |
| 5 | Adaptive Terrarium DEM Zoom | Select adaptive DEM zoom (11–14) based on area span, eliminating multi-tile download stalls | M1 | R5 |
| 6 | Non-blocking Progressive 3D Pipeline & Yielding | Asynchronous staged mesh generation yielding to event loop; main thread never blocked >50ms | M2 | R2 |
| 7 | Layer-by-Layer WebGL Streaming & Progress Display | Progressively stream Terrain -> Water -> Greenery -> Roads -> Buildings into WebGL with accurate progress UI | M2 | R2 |
| 8 | Progressive State Machine & Zero-Duplicate Rebuilds | Eliminate duplicate rebuilding and stage mismatch bug; preserve already-built layers | M2 | User Feedback |
| 9 | High-Performance Geometry & Fast Topology Audit | Fast O(N log N) ear-clipper with hole protection; tree loop parity; 32-bit numeric topology audit | M2 | R2, User Feedback |
| 10 | Explicit Render UX & Parameter Decoupling | Rename #btnRender3D to "Render"; parameters update 2D map/settings only; rebuild occurs ONLY on click | M3 | User Feedback |
| 11 | Large Area Span (up to 50 km) & Frame Options | Expand span slider to 50 km (0.6, 1.2, 2.5, 5, 12, 25, 50 km chips); add 50x100 cm frame chip | M3 | R5, User Feedback |
| 12 | User-Editable LoD Filter & Adaptive Detail | Expose "Filtr szczegółów (LoD)" UI controls; auto-disable trees at >3.5-5 km; scale building min-area | M3 | R5, User Feedback |
| 13 | Clean 3D Viewport & Default White Palette | Remove Inspektor Budynku and building click/hover highlighting; default palette = Pure Architectural White | M3 | User Feedback |
| 14 | Safe Event Delegation (`safeClosest`) | Guard event handlers against non-Element targets (document, window, text nodes, browser extensions) | M4 | R3, User Feedback |
| 15 | File URI Protocol & CORS Safety | Gate relative fetches behind http checks and handle canvas tainting gracefully | M4 | R3 |
| 16 | Persistent Settings Across Reloads | Persist active city, coordinates, span, frame dimensions, LoD settings, and view in localStorage & URL | M4 | R4 |
| 17 | Final Acceptance Verification & Adversarial Hardening | 100% E2E test pass across Tiers 1-4 with uncached Cape Town & screenshots, plus Tier 5 hardening | M5 | R1, R2, R3, R4, R5 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Harness, Tiers 1–4 opaque-box tests, uncached Cape Town verification, screenshot capture, `TEST_READY.md` | none | IN_PROGRESS |
| M1 | Resilient GIS Data Fetching & Watchdog | Features 2, 3, 4, 5 (proximity cache, Overpass resilience, inactivity watchdog, adaptive DEM) | none | DONE |
| M2 | Progressive 3D Pipeline & Streaming | Features 6, 7, 8, 9 (async yielding, layer streaming, duplicate rebuild elimination, geometry & tree loop fix) | M1 | DONE |
| M3 | Large Area Scalability & UX Controls | Features 10, 11, 12, 13 (explicit Render button, 50km span, 50x100 grid, LoD filter UI, remove Inspektor, white palette) | M2 | IN_PROGRESS |
| M4 | Event Safety & Settings Persistence | Features 14, 15, 16 (`safeClosest`, file URI safety, `localStorage` & URL persistence) | none | DONE |
| M5 | Final Acceptance & Adversarial Hardening | Feature 17 (100% E2E test pass with uncached Cape Town + screenshots, Tier 5 adversarial stress testing) | E2E, M1, M2, M3, M4 | PLANNED |

## Interface Contracts

### M1 ↔ M2: Scene Data Streaming & Inactivity Watchdog Contract
- `fetchRealGISAndRender(south, west, north, east, title, options)`
  - Input: Bounding box coordinates (floats), title (string), options: `{ onProgress: (pct, stageName) => void, abortSignal: AbortSignal }`
  - Inactivity Watchdog: Resets 30-second watchdog on any chunk/progress signal; throws clean `AbortError` or user-facing notification on total inactivity without unhandled rejections.
  - Live Overpass: Uses staggered mirrors and fallback to DEM relief on total failure.

### M2 ↔ Viewport: Progressive Upload & State Machine Contract
- `rebuildModel3DProgressive(sceneData, state, onProgress)`
  - Progress: Stages 1 (Terrain), 2 (Greenery/Water), 3 (Roads), 4 (Buildings), 5 (Topology).
  - State Machine: Progressive rendering executes monotonically; no jumping backwards or re-running completed layers.
  - Tree Placement: Iterates candidate trees with `continue;` on skip, guaranteeing exact parity with synchronous model.
- `studio.uploadLayerMesh(layerName, meshData)`: Uploads individual layers incrementally.

### M3 ↔ UI & Viewport: User Controls & Viewport Cleanliness Contract
- Explicit Render: UI input events modify 2D map overlay and state only; `#btnRender3D` (labeled `Render`) triggers 3D rebuild.
- LoD Filter: `state.lodSettings = { minBuildingMeters, enableTrees, treeThresholdKm, roadDetail }`; controls bound to UI panel.
- Palette: Initialized to `'white'`.
- Viewport: No raycasting or layer 5 highlighting on click/hover; standard trackball/orbit controls.

## Code Layout
- `src/ui/`: UI controller (`ui_app.js`), URL hooks (`ui_url_hooks.js`), 2D map (`ui_map2d.js`), search autocomplete (`ui_viewport_search.js`).
- `src/gis_client/`: Browser-side GIS chunk streamer (`gis_chunk_streamer.js`), DEM fetcher (`overpass_dem_fetch.js`), Overpass query builder (`osm_scene_builder.js`).
- `src/mesh/`: 3D procedural geometry builders (`mesh_builder.js`, `features_roads_parks.js`, `mesh_clipper_3d.js`, `mesh_topology.js`).
- `src/render/`: WebGL studio renderer (`webgl_studio.js`).
- `src/template.html`: Application markup.
- `gis/`: Python GIS backend modules (`scene_pipeline.py`, `overpass_dem.py`).
- `build_app.py`: Bundler compiling modular sources into `index.html`.
- `tests/e2e/`: Automated Playwright E2E benchmark and integration test suite.
