# Technical Benchmark: Lichtbild vs. `map-to-3dprint`

Date: `2026-11-10` (historical pre-refactor snapshot).
This benchmark compares architecture, GIS data, geometry, colors, export, rendering, and product gaps.

## Notation

- `[my] file:line`: Reference to our repository source code at the `2026-11-10` baseline.
- `[them] mod N`: Public client webpack module from the Lichtbild Next.js bundle (client code only).
- `[them/API]`: Public Lichtbild HTTP endpoint response.

## 1. Method and Evidence Limits

We inspected these sources directly:

- 31 Lichtbild client JS chunks (`~1.84 MB`), including 10 lazy chunks from webpack runtime maps.
- Public endpoints: `/api/data-licenses`, `/api/geocode-v3`, `/api/exchange-rates`, `/api/createCity`, `/api/image`, `/api/mcp/*`, `/.well-known/*`.
- Two live previews from their public MCP (`design_3d_city_model` + `render_model_preview`): Stuttgart `20 cm` and Zugspitze `20 cm`.
- Our baseline files: `mesh_builder.js`, `exporters.js`, `webgl_studio.js`, `ui_app.js`, `gis_pipeline.py`, `fetch_gis.py`, `server.py`, `template.html`.

Three Lichtbild details remain private:

- Their production STL or 3MF mesh format (they expose zero public mesh downloads).
- Their server-side render engine (WebP previews strip metadata).
- Whether their print file uses Z-banding or single-solid material regions.

## 2. Architecture Comparison

| Layer | `map-to-3dprint` (`2026-11-10`) | Lichtbild |
| :--- | :--- | :--- |
| Frontend | Static `index.html` via `build_app.py`, zero deps | Next.js Pages Router on Vercel, 14 languages |
| Client 3D render | Custom WebGL 1.0 (`webgl_studio.js:289`, 2048 shadow map, PCF 9-tap) | None (zero WebGL/three.js in 31 chunks) |
| 2D map | Custom canvas tiles (`OSM FR` / `Esri`, `ui_app.js:238,241`) | Leaflet + Stadia Alidade Satellite (`mod 13769, 37275, 38041, 80942`) |
| Geocoding | Photon proxy (`server.py:62`) | `/api/geocode-v3` (`mod 24984`), OpenCage schema |
| GIS data | AWS Terrarium DEM z14 + Overpass (`fetch_gis.py:118,162`) | OSM + GeoNames + national lidar (`3DEP`, `ALKIS/ATKIS`, `OSNI`, `NRCan`, `Mapterhorn`) |
| Mesh generation | Browser (`buildComplete3DModel`) | Server (`POST /api/createCity` progress stream) |
| Preview | Interactive WebGL orbit, zoom, building pick | Two static `1400 x 1400` WebP views (table, wall) |
| Checkout | None | Shopify variants (`mod 70931`), `/api/checkout` |
| Pricing | None | Bundle table (`mod 69382`) |
| AI connector | None | MCP `https://mcp.lichtbild.com` + OAuth metadata |
| Data licenses | None | `/api/data-licenses` (`648 KB`, per model, `mod 51509`) |

## 3. Input Data Sources

### 3.1 Elevation

- **`map-to-3dprint`**: Uses AWS Terrarium tiles at `zoom=14` (`fetch_gis.py:118`) on a `64-72 px` grid (`~30-90 m/px`).
- **Lichtbild**: Picks the highest-resolution national source per country (`USGS 3DEP`, `Mapterhorn`, `ATKIS-DGM1`, `OSNI`, `NRCan`, `Queensland`).
- **Impact**: Their relief reaches `1 m` precision in Germany, USA, and Australia, while global Terrarium stays near `30 m`.

### 3.2 Vectors and Geocoding

- **`map-to-3dprint`**: Queries Overpass QL (`fetch_gis.py:162`) for buildings, parts, water, parks, trees, roads, and bridges. Uses Photon (`limit=6`, `server.py:62-80`).
- **Lichtbild**: Combines OSM (ODbL) with local cadastral datasets (`ALKIS`, `Berliner Gebaeude Atlas`, `Ipswich Cadastral`). Uses `/api/geocode-v3` with OpenCage annotations (`DMS`, `MGRS`, `NUTS`) and `country_hint`.
- **Map tiles**: We draw `tile.openstreetmap.fr/hot` and `Esri World_Topo_Map` on canvas. They use Leaflet with retina `@2x` Stadia Alidade Satellite (`maxZoom` 16-20).

## 4. Geometry Comparison (Layer by Layer)

### 4.1 Coordinates and Terrain

- **`map-to-3dprint`**: Uses a `169 x 169` cube (`+/-84.5`), `320^2` masks (`:503`), and a `68 x 68` grid (`:675`). Sets `baseBottomZ = 2.45`, `maxReliefMm = 7.4`, and `18` contour steps (`:710`).
- **Terrain normalization**: Our baseline normalizes every area to `7.4` relief units (`:724`), flattening tall mountains by `10-30x`.
- **Lichtbild**: Runs two coverage modes (cities `~1 km2`, mountains `225-1750 km2`) with stepped slopes and meadow/rock/snow bands.

### 4.2 Water, Greenery, Roads, Buildings, and Frame

- **Water**: We build closed 3-level bathymetry (`deepWaterZ = 1.76`, shelves `1.98/2.20`, `:765-830`). Lichtbild renders a flat tinted polygon (`#A3D8E1`).
- **Greenery and trees**: Our baseline uses a zero-thickness single quad (`:846`) and open 5-sided cones (`:410-431`). Lichtbild places dense closed low-poly tree clusters.
- **Roads**: Our baseline builds open ribbons (top + 2 sides, zero bottom, `:1004-1006`) without lane markings. Lichtbild models flat roads with white dashed lane markings.
- **Buildings**: We extrude LoD2 roofs (`extrudeBuildingLoD2`, `:298-408`) recessed `0.15` into terrain without bottoms. Lichtbild uses flat roofs with rooftop HVAC details and per-building edit lists (`mod 49391`).
- **Frame**: We render a mitered frame (`:1186-1200`) in WebGL but omit it from exports (`exporters.js:121-128`). Lichtbild includes frame, acrylic cover, and engraved plaque.

### 4.3 Baseline Topology Audit (`2026-11-10`)

| Layer | Baseline Topology | Closed? | Slicer Impact |
| :--- | :--- | :--- | :--- |
| Water | Bottom `z=0`, shelves, walls (`:765-830`) | Yes | Clean |
| Terrain/base | Heightfield + skirt to `z=0`, open bottom (`:918-936`) | No | Open bottom on bed |
| Greenery | Single floating quad (`:846`) | No (`0` thick) | Missing or 1-layer artifact |
| Trees | Open cone without base (`:410-431`) | No | Floating first layer |
| Roads | Top + 2 sides (`:1004-1006`) | No | Open underside and ends |
| Buildings | Walls + roof dipped `0.15` into terrain (`:1163`) | No | Overlapping extrusion zone |
| Frame | Four miters (`:1186-1200`) | Yes | Not exported |

Baseline `README.md` also overstated implementation (claimed 6 manifold volumes, 12 terraces instead of 18, and nonexistent SSAO).

## 5. Colors, Materials, and Pricing

- **`map-to-3dprint`**: Defines 4 preview palettes in `ui_app.js:10-57` with no filament hex mapping.
- **Lichtbild**: Defines `ColorSchemeType` (`granite`, `pastell`, `water_only`, `white`) in `mod 49432` with separate `ams` filament and `render` preview hex values.
- **Discounts**: `mod 21250` hardcodes `calculateDiscount(qty) { return 0 }` despite `1/2/3+` UI hints.

### Lichtbild Pricing Table (`mod 69382`)

| Size | Base | + Pastell / Granite | + Polar | Building Marker | Mountain GPX |
| :--- | ---: | ---: | ---: | ---: | ---: |
| `14 cm` (`SMALL`) | `59 EUR` | `+10 EUR` | `+5 EUR` | `+10 EUR` | `+10 EUR` |
| `20 cm` (`MEDIUM`) | `69 EUR` | `+19 EUR` | `+10 EUR` | `+10 EUR` | `+15 EUR` |
| `26 cm` (`BIG`) | `99 EUR` | `+29 EUR` | `+15 EUR` | `+10 EUR` | `+19 EUR` |
| `33 cm` (`SIZE_33`) | `159 EUR` | `+39 EUR` | `+19 EUR` | `+10 EUR` (`0` mountain) | `+29 EUR` |
| `52 cm` (`XL`) | `299 EUR` | `+69 EUR` | `+39 EUR` | `+39 EUR` | `0 EUR` |
| `24 cm` (`TILE`) | `79 EUR` | `+19 EUR` | `+10 EUR` | `+10 EUR` | `+19 EUR` |

## 6. Scale, Sizes, and Tile Splitting

- **`map-to-3dprint` baseline**: Maps `170` scene units to `100%` of `bedSizeMm` (`exporters.js:107-108`) with zero bed margin. The `520 mm` option scales up without splitting tiles.
- **Lichtbild**: Defines 6 sizes (`14`, `20`, `24`, `26`, `33`, `52 cm`) in `mod 52373`. Routes `33 cm` to `A2L` printers and others to `A1`. Splits `52 cm` into `2 x 2` framed plates (`TILE 24 cm`).

## 7. Export Audit (`exporters.js` Baseline)

- **`.3mf` (`:106-196`)**: Uses millimeter units and `basematerials`, but duplicates 3 vertices per triangle (`:142-152`) with uncompressed ZIP store (`0`, `:44`). Tokyo (`163,877` triangles) exceeds `30 MB`.
- **`.stl` (`:198-238`)**: Merges all layers into one single-color binary file (`50 B/tri`) with unused `layerId` attribute bytes.
- **Missing features at baseline**: Tile joints (`0.15-0.2 mm` tolerance), frame/plaque export, printer profiles, preflight manifold validator, and CLI/server batch export.

## 8. Preview Rendering and Storefront

- **`map-to-3dprint`**: Interactive WebGL 1.0 gives instant picking and edits, but looks game-like rather than photorealistic.
- **Lichtbild**: `POST /api/createCity` streams `PROGRESS <n>` and returns two `1400 x 1400` WebP images (`80-110 KB`) in `40-65 s`. Corner PSNR (`47-52 dB`) confirms a fixed studio background plate with composited model shadows.
- **Storefront**: Uses Shopify checkout, dynamic lead-time dates, public account-free MCP (`https://mcp.lichtbild.com`), and per-model license attribution (`/api/data-licenses`).

## 9. Historical Gap Roadmap (`2026-11-10`)

- **P0 (Printability)**: Close greenery slabs, road bottoms, tree bases, and terrain bottom; add preflight manifold validator; add bed margin.
- **P1 (Product)**: Add `2 x 2` tile split with joints, exportable frames, and printer profiles. Add deflated `.3mf`, dual hex colors, and road markings.
- **P2 (Store)**: Add static photorealistic table/wall studio renders, tiered pricing, license attribution, dual city/mountain coverage modes, and accurate `README` specs.

## 10. What to Adopt vs. Skip

**Adopt:**

1. Separate city (`~1 km2`) and mountain (`~15 km`) coverage modes.
2. Separate `ams` filament hex and `render` preview hex per layer.
3. True multi-tile splitting with modular frames and printer size classes.
4. Watertight unified solids instead of open overlapping shells.
5. Photorealistic fixed-studio renders for product pages, paired with interactive WebGL editing.
6. Modeled road markings and per-model license attribution.

**Skip:**

- Flat-only building roofs (keep LoD2 roof shapes when OSM defines them).
- Static-only preview without interactive 3D editing.
- Flat single-color water (keep 3-level bathymetry or exposed black cutout backing).
- Fake zero-value quantity discount logic.

## 11. Risks and Historical Note

- Lichtbild never exposes production STL/3MF files, so mesh-internal conclusions rely on renders and product descriptions.
- Later milestones resolved most P0/P1/P2 gaps via Manifold CSG export, `validate_msla_stl.py`, Mono 4 tiling, and Cycles studio.
- Read `docs/msla-printability-and-validation-spec.md` and `docs/blender-studio-workflow.md` for current production specs.
