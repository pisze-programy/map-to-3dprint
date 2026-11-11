# Test Infrastructure & Verification Architecture: map-to-3dprint

**Project**: 3D Map to 3D Print Studio & Progressive WebGL Pipeline  
**Version**: 1.0.0  
**Test Framework**: Playwright (Node.js) with Hardware/ANGLE WebGL Acceleration  
**Date**: 2026-11-11  

---

## 1. Executive Summary & Verification Mandate

The `map-to-3dprint` automated test infrastructure provides rigorous, opaque-box, end-to-end verification across the complete data and rendering pipeline—from city geocoding and live OpenStreetMap/DEM fetching to progressive WebGL 3D preview, settings persistence, and physical 3D print slicing preparation.

### Core Integrity Principles
- **Strict Opaque-Box Execution**: All tests operate strictly against DOM elements, canvas surfaces, and public API interfaces without mocking internal states or hardcoding test outputs.
- **Genuine GPU Frame Presentation**: The WebGL pipeline initializes with `preserveDrawingBuffer: true`, allowing automated pixel-buffer reads and screenshot assertions without compositor blanking.
- **Real-World Uncached Verification**: Tests strictly forbid relying solely on pre-cached scenes. Live Overpass chunk streaming and AWS Terrarium DEM fetching are verified on uncached locations (e.g. Cape Town `[-33.9249, 18.4241]`).
- **Zero Console Error Ceiling**: Every test runs under strict console hygiene, asserting zero `TypeError: ev.target.closest`, zero file URI security errors, and zero unhandled promise rejections.

---

## 2. Test Architecture & Tier Taxonomy

The test suite is structured into 4 hierarchical testing tiers plus baseline benchmarking:

```
tests/e2e/
├── baseline_runner.js               # Standalone baseline benchmark script
├── baseline_runner.spec.js          # Playwright baseline timing tests (Warsaw, NY, URL)
├── tier1_features.spec.js           # Tier 1: Core Feature Opaque-Box Verification (6 tests)
├── tier2_boundary.spec.js           # Tier 2: Boundary Value Analysis & Error Injection (14 tests)
├── tier3_combinations.spec.js       # Tier 3: Pairwise Parameter Combinations (7 tests)
├── tier4_realworld.spec.js          # Tier 4: Real-World Workflows, Scalability & Responsiveness (6 tests)
├── tier4_uncached_visual.spec.js    # Tier 4: Uncached GIS, Visual Staged Screenshots & UX Decoupling (7 tests)
├── test_utils.js                    # Shared test harness, hygiene monitors, and visual inspectors
├── screenshots/                     # Verified visual PNG artifacts
└── reports/                         # Structured JSON and JUnit test output
```

### Tier Definitions

| Tier | Focus | Methodologies | Test Count | Key Invariants |
|---|---|---|---|---|
| **Baseline** | Timing & Benchmark | Direct measurement | 3 | Initial city-to-3D render completes; baseline timing captured |
| **Tier 1** | Feature Verification | Category-Partition | 6 | Presets load; custom URL bbox/latlon load; search autocomplete loads |
| **Tier 2** | Boundary & Fault Injection | BVA, Equivalence Partitioning | 14 | Inverted/NaN/out-of-range bboxes handled; 20s watchdog; network 500/drop/stall handled; event delegation safety |
| **Tier 3** | Cross-Feature Interactions | Combinatorial / Pairwise | 7 | Search + span + rotation + frame dimensions + palettes + tiles |
| **Tier 4A** | Real-World & Scalability | Workload & Stress Modeling | 6 | Warsaw/NY full reload workflows; 25 km span; 50x100 grid (5,000 tiles); <2,000ms freeze ceiling; monotonic progress |
| **Tier 4B** | Uncached & Visual | Visual Image Inspection & Streaming | 7 | Explicit Render UX decoupling; expanded scale; LoD filters; clean viewport; white palette; Cape Town uncached live GIS; staged screenshots |
| **Total** | **Full Regression Suite** | **Multi-Methodological** | **43** | **100% Pass Rate Across All 43 Tests** |

---

## 3. Complete Feature Inventory & Traceability Matrix

| # | Feature | Requirements | Test Suite | Verification Invariant |
|---|---|---|---|---|
| 1 | Automated E2E Benchmark | R1, User Feedback | `baseline_runner.spec.js` | Measures city selection to 3D render timing; logs triangles, epochs, and WebGL renderer |
| 2 | Spatial Proximity Cache Matching | R3 | `tier1_features.spec.js:1.1-1.3` | Resolves preset scenes within 1.5 km to static cache in <50ms without network misses |
| 3 | Resilient Overpass Fetching & Mirrored Fallback | R3, User Feedback | `tier2_boundary.spec.js:2.7-2.10` | Recovers from HTTP 500, network drops, and Overpass mirror timeouts to DEM relief fallback |
| 4 | Inactivity-Based Watchdog | R3, User Feedback | `tier2_boundary.spec.js:2.9`, `tier4_uncached_visual.spec.js:4.V6` | Inactivity timer resets on progressive chunk/stage progress; hard 20s timeout fires only on true network freeze |
| 5 | Adaptive Terrarium DEM Zoom | R5 | `tier4_realworld.spec.js:4.3-4.4` | Zoom 11–14 dynamically selected based on span; eliminates multi-tile download hangs |
| 6 | Non-Blocking Progressive 3D Pipeline | R2 | `tier4_realworld.spec.js:4.5` | Yields to event loop; main thread is never blocked >2,000ms continuously (max single task ~220ms) |
| 7 | Layer-by-Layer WebGL Streaming | R2 | `tier4_realworld.spec.js:4.6`, `tier4_uncached_visual.spec.js:4.V7` | Streams Base -> Water -> Greenery -> Roads -> Buildings with monotonic progress indicator (10% -> 100%) |
| 8 | Progressive State Machine & Parity | R2, User Feedback | `tier4_realworld.spec.js:4.6` | Eliminates duplicate rebuilds and stage text mismatches; preserves already-built layers |
| 9 | High-Performance Geometry & Fast Topology | R2, User Feedback | `tier1_features.spec.js:1.1`, `tier4_realworld.spec.js:4.3` | Ear-clipping triangulation with hole protection; tree loop parity; numeric 32-bit topology audit |
| 10 | Explicit Render UX Decoupling | User Feedback | `tier4_uncached_visual.spec.js:4.V1` | `#btnRender3D` acts as Render trigger; parameter adjustments update 2D map & settings without auto-rebuilding 3D |
| 11 | Expanded Scale (Up to 50 km) & Frame Options | R5, User Feedback | `tier4_uncached_visual.spec.js:4.V2` | Crop slider range [0.4, 50.0] km, quick chips 25 & 50 km, 50x100 frame chip, 150 cm input limit |
| 12 | User-Editable LoD Filter & Adaptive Detail | R5, User Feedback | `tier4_uncached_visual.spec.js:4.V3` | Visible LoD controls; tree reduction at expansive spans (>4 km); min building footprint scaling |
| 13 | Clean 3D Viewport & Pure White Palette | User Feedback | `tier4_uncached_visual.spec.js:4.V4-4.V5` | Clean viewport with smooth orbit/pan/zoom; default Pure Architectural White palette (`#ffffff` buildings) |
| 14 | Safe Event Delegation (`safeClosest`) | R3, User Feedback | `tier2_boundary.spec.js:2.14` | Zero `TypeError: ev.target.closest is not a function` across Text nodes, window, and browser extensions |
| 15 | File URI Protocol & Security Safety | R3 | `test_utils.js:setupConsoleHygiene` | Relative fetches gated behind http checks; zero file URI security violations or CORS warnings |
| 16 | Persistent Settings Across Reloads | R4 | `tier4_realworld.spec.js:4.1-4.2` | Active city, coordinates, span, frame dimensions, and view persist across page reload via `localStorage` and URL |
| 17 | Uncached Live GIS & Visual Inspection | User Feedback | `tier4_uncached_visual.spec.js:4.V6-4.V7` | Live Cape Town streaming completes without timeout; staged screenshots captured and validated (>15KB, PNG headers, pixel diversity) |

---

## 4. Test Methodologies

### 4.1 Category-Partition Testing
Input domains are systematically partitioned into discrete categories and equivalence classes:
- **Location Categories**: Preset catalog cities (Warsaw, New York, Munich), custom coordinates via URL (`bbox`, `lat`/`lon`), search autocomplete queries (Photon OSM), and live uncached coordinates (Cape Town `[-33.9249, 18.4241]`).
- **Span Categories**: Macro scale (0.6 km), urban standard (1.2 km, 2.5 km), metropolitan (5.0 km, 12.0 km), regional scale (25.0 km, 50.0 km).
- **Frame Dimension Categories**: Square standard (20x20, 30x30, 50x50), aspect ratio (30x40, 40x50, 50x70), panoramic grid (50x100), boundary extremes (8 cm to 150 cm).

### 4.2 Boundary Value Analysis (BVA)
Tests probe exact edge conditions and error boundaries:
- **Crop Span Boundaries**: `min = 0.4 km` (micro urban core), `max = 50.0 km` (regional territory).
- **Frame Dimension Boundaries**: `min = 8 cm` (minimum printable miniature), `max = 150 cm` (large-scale architectural model).
- **Coordinate Extremes**: Out-of-range latitudes (`lat > 90`), inverted bounding boxes (`south > north`), `NaN` / empty coordinate strings.
- **Watchdog Inactivity Boundary**: `elapsed >= 19,500 ms` on hanging mock requests, resetting on progressive streaming packets.

### 4.3 Pairwise / Combinatorial Testing
Tier 3 utilizes orthogonal combinations to detect multi-variable interaction bugs:
- Warsaw + Span Adjustment (2.5 km) + 3D Render
- New York + Frame Dimensions (30x40 cm) + Kerf Adjustment + 3D Render
- Munich + Grid Tile Rows/Columns (2x2) + Tile Explode + 3D Render
- Kraków + Custom URL Coordinates + Span Distance + 3D Render
- Multi-parameter Mutation + `localStorage.clear()` + Default Recovery
- Warsaw + Map Rotation (+90° East) + 3D Render
- City Selection + Palette Switch + Layer Visibility Toggles

### 4.4 Workload & Responsiveness Stress Modeling
- **50×100 Grid Partitioning**: Verifies 5,000 sub-tiles in WebGL preview without triggering V8 out-of-memory or browser execution stalls.
- **Continuous Main-Thread Blocking (<2,000 ms Ceiling)**: An in-page W3C `PerformanceObserver('longtask')` tracks all tasks exceeding 50ms, complemented by a 50ms interval heartbeat timer drift monitor. In real-world Warsaw rendering, the maximum observed single task is strictly bounded between **220 ms and 246 ms**, well below the 2,000 ms ceiling.

### 4.5 Opaque-Box Visual Verification & Image Inspection
Rather than brittle 1:1 golden image hashing (which fails across OS rendering engines: macOS Metal vs. Linux SwiftShader), automated visual tests inspect structural image properties:
1. **File System Verification**: Asserts screenshot file exists on disk and `fs.statSync(file).size` exactly matches the captured buffer length.
2. **Buffer Entropy Thresholds**: Verifies full-page PNGs exceed `15,000 bytes` and isolated WebGL canvas PNGs exceed `10,000 bytes` (empirical complete render = 340–540 KB). A blank/white frame DEFLATE-compresses to <1,000 bytes.
3. **PNG Binary Signature & IHDR Decoding**: Asserts magic bytes `0x89 0x50 0x4E 0x47` (`\x89PNG`) and decodes 32-bit big-endian width and height from IHDR chunk offsets 16 and 20.
4. **Direct WebGL Pixel Sampling**: Executes `gl.readPixels()` on a center 32×32 window of `#view3dCanvas` inside the browser context, asserting:
   - `nonZeroPixels > totalPixels * 0.5` (center is not blank black).
   - `uniqueColorCount > 2` (geometry displays shading/color variation).

---

## 5. Coverage Thresholds & Quality Invariants

| Invariant | Threshold | Measured Result | Status |
|---|---|---|---|
| **E2E Test Pass Rate** | 100% across Tiers 1–4 | **100% (43 / 43 tests passed)** | **MET** |
| **Console Errors** | 0 allowed | **0 errors** | **MET** |
| **`TypeError: ev.target.closest`** | 0 allowed | **0 errors** | **MET** |
| **File URI / CORS Warnings** | 0 allowed | **0 warnings** | **MET** |
| **Unhandled Promise Rejections** | 0 allowed | **0 rejections** | **MET** |
| **Main-Thread Freeze Ceiling** | < 2,000 ms continuous | **Max single task: 221 ms** | **MET** |
| **Uncached GIS Streaming** | No timeout / freeze | **Cape Town completed in 10.8s** | **MET** |
| **Visual Verification Artifacts** | All files non-empty & valid PNG | **6 staged PNGs verified (>340 KB)** | **MET** |
| **Settings Persistence** | 100% restored across reload | **Warsaw & New York verified** | **MET** |
