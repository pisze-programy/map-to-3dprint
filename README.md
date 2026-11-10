# map-to-3dprint

`map-to-3dprint` generates multi-color, watertight 3D-printable terrain and city models (`.3mf` and `.stl`) from live geographic data.

The system downloads elevation tiles from AWS Terrarium DEM and vector geometry from OpenStreetMap (Overpass API). It builds six separate manifold volumes for multi-extruder FDM 3D printers (such as Prusa XL, Bambu Lab AMS, and Voron ERCF).

![Top View — Krakow](docs/screenshots/krakow-top-view.png)

---

## 1. System Description

The application operates in two modes:

1. **Local GIS Server + WebGL Studio (`server.py`)**: A Python HTTP server fetches, processes, and caches DEM and OpenStreetMap data on disk.
2. **Standalone Browser Mode (`index.html`)**: The browser fetches AWS Terrarium DEM tiles and Overpass QL data directly if the local Python server is offline.

### Data Sources

| Data Layer | Source | Format | Usage |
| :--- | :--- | :--- | :--- |
| Elevation (DEM) | AWS Terrain Tiles (`terrarium`) | 24-bit PNG (`z = 14`) | Stepped terrain contour layers and sea-level bathymetry |
| Vector Geometry | OpenStreetMap (Overpass API) | JSON | Buildings (`building`, `building:part`), water, parks, trees, roads, bridges |
| Geocoding | Photon Komoot (`photon.komoot.io`) | GeoJSON | Live place search and coordinate lookup |
| 2D Slippy Map | OpenStreetMap France (`hot`) / ArcGIS | Raster PNG | Interactive 2D bounding-box selection |

---

## 2. 3D Print Layer Architecture

The mesh builder clips all geometry to the internal frame boundary (`[-84.5, 84.5]` scene units) and roots all buildings into the terrain layer (`zBase = terrainZ - 0.15 mm`). This prevents floating parts and non-manifold edges.

| Layer ID | Layer Name | Default Extruder | Z-Axis Structure |
| :--- | :--- | :--- | :--- |
| `0` | Water and Stepped Bathymetry | Extruder 1 (Blue) | Base plate + 3 stepped depth contours (`0.0 - 2.3 mm`) |
| `1` | DEM Terrain Contours | Extruder 2 (Sand) | 12 quantized elevation terraces from DEM (`2.4 - 9.8 mm`) |
| `2` | Parks, Forests, and 3D Trees | Extruder 3 (Green) | Turf emboss (`+0.42 mm`) + low-poly 3D tree crowns |
| `3` | Streets, Plazas, Railways, Bridges | Extruder 4 (Ivory/White) | Road deck (`+0.50 mm`) + elevated bridge decks with support pillars |
| `4` | LoD2 Buildings and Courtyards | Extruder 4 (White) | Extruded walls, inner courtyards, and pitched roofs (`hipped`, `gabled`, `pyramidal`, `dome`) |
| `5` | Highlighted Buildings (Accent) | Extruder 5 (Gold/Accent) | User-selected buildings exported as a separate volume |
| `6` | Frame and Title Plaque | Frame Body | Beveled outer frame with 3D vector typography |

![Exploded Layer View — Krakow](docs/screenshots/krakow-exploded-layers.png)

---

## 3. Requirements

- **Operating System**: macOS, Linux, or Windows
- **Python**: Version 3.9 or newer (standard library only; no `pip` packages required)
- **Command-Line Tool**: `curl` (installed by default on macOS, Linux, and Windows 10/11)
- **Web Browser**: Chrome, Firefox, Safari, or Edge with WebGL 1.0 (`OES_standard_derivatives` and `WEBGL_depth_texture`)

---

## 4. Installation and Startup

Follow these steps to run the application locally:

1. Clone the repository:
   ```bash
   git clone https://github.com/pisze-programy/map-to-3dprint.git
   ```
2. Change to the project directory:
   ```bash
   cd map-to-3dprint
   ```
3. Start the local GIS server:
   ```bash
   python3 server.py
   ```
4. Open `http://127.0.0.1:8765` in your web browser.

> [!NOTE]
> You can also open `index.html` directly in a web browser without `server.py`. When `server.py` runs, it caches downloaded OSM and DEM files in the `cache/` directory for faster reloads.

---

## 5. Operating Procedure

### 5.1 Select a Geographic Area

1. Type a city, mountain, island, or address into the search box in panel **1. Interaktywna Mapa**.
2. Click a location from the live autocomplete dropdown list, or click **Szukaj**.
3. Alternatively, click one of the world randomizer buttons (`🎲 Losuj Świat`, `⛰️ Góry`, `🏖️ Kurorty`, `🏯 Azja`, `🌍 Wschód/Zachód`) to load a test region.
4. Drag the 2D map with the left mouse button to position the blue print frame.
5. Scroll the mouse wheel on the 2D map (or click `+` and `-`) to change the map zoom level.
6. Adjust the **Kadr** slider to set the physical ground width (`0.60 km` to `1.35 km`).
7. Click **POBIERZ PRAWDZIWE DANE Z MAPY I RENDERUJ 3D** to download the GIS data and generate the 3D mesh.

### 5.2 Inspect and Select Buildings

![Low-Angle View and Multi-Selection — Krakow](docs/screenshots/krakow-low-multiselect.png)

1. Left-click and drag in the 3D viewport to rotate the camera.
2. Right-click and drag (or middle-click and drag) in the 3D viewport to pan the camera.
3. Scroll the mouse wheel in the 3D viewport to zoom in or out.
4. Left-click any building in the 3D viewport to select that building group (`building` + all associated `building:part` elements).
5. Hold `Shift` and left-click additional buildings to select multiple buildings at the same time.
6. In the **Inspektor Budynku (OSM)** panel, click **★ Wyróżnij (Kolor Akcentu)** to move the selected buildings to the accent extruder layer (Layer 5).
7. Adjust the **Skala wys.** slider to change the height multiplier (`50%` to `250%`) of the selected buildings.
8. Click **Ukryj / Przywróć** to exclude or restore the selected buildings from the 3D print mesh.

### 5.3 Customize Layers, Elevation, and Colors

1. In panel **3. Paleta Kolorów Filamentu**, click a color preset (`Lichtbild Studio`, `Classic White & Gold`, `Nordic Slate & Amber`, `Alpejski Relief Terakota`).
2. In panel **4. Warstwy i Nierówności**, use the color pickers to set custom filament colors for each layer.
3. Use the checkboxes in panel **4** to show or hide individual layers.
4. Adjust the **Skala wysokości budynków i drzew** slider (`0.50x` to `2.50x`) to scale vertical structures.
5. Adjust the **Przewyższenie warstwic terenu DEM** slider (`0.30x` to `2.50x`) to scale terrain relief.
6. Drag the **Rozbicie na warstwy (Exploded View)** slider (or click **Rozbij / Złóż**) to separate the six volumes along the Z-axis for visual inspection.

### 5.4 Export for 3D Printing

1. Select your target printer bed size (`330x330 mm`, `256x256 mm`, `350x350 mm`, or `520x520 mm`) in the top bar.
2. Click **Eksportuj .3MF (Warstwy do Slicera)** to download a multi-object `.3mf` archive.
   - Open the `.3mf` file in PrusaSlicer, Bambu Studio, or OrcaSlicer.
   - Each layer (`0` through `6`) loads as a separate named object pre-aligned in 3D space.
   - Assign each object to the corresponding extruder or AMS slot.
3. To export binary `.stl` files instead:
   - Click **Pobierz .STL** in the top bar to download the combined model.
   - Or select a single layer in the bottom-right dropdown list and click **.STL Warstwy** to download only that volume.

---

## 6. Verification Examples

### Alpine Relief (Innsbruck, Austria — DEM Range: `568 m` to `718 m`)

![Innsbruck Alpine DEM Relief](docs/screenshots/innsbruck-alpine-dem.png)

### Dense Urban Grid and River Bridges (Tokyo, Japan — `6,858` Buildings in `163,877` Triangles)

![Tokyo Dense Urban Grid](docs/screenshots/tokyo-dense-urban.png)

---

## 7. Rebuilding the Single-File Bundle

If you modify files inside `src/`, rebuild the `index.html` bundle:

```bash
python3 build_app.py
```

### Repository Structure

| Path | Description |
| :--- | :--- |
| `server.py` | Local HTTP server (`/api/gis`, `/api/geocode`, static file serving) |
| `fetch_gis.py` | Downloader for AWS Terrarium DEM PNG tiles and Overpass QL vectors |
| `gis_pipeline.py` | Coordinate projection, polygon ring stitching, simplification, and tree distribution |
| `build_app.py` | Compiler that bundles `src/*` and initial scene data into `index.html` |
| `src/template.html` | HTML5 layout and CSS variables |
| `src/mesh_builder.js` | Clipping, Marching-Squares DEM contouring, LoD2 roof extrusion, and manifold generation |
| `src/webgl_studio.js` | Custom WebGL 1.0 renderer with 2048x2048 shadow mapping, SSAO, and Möller-Trumbore raycasting |
| `src/exporters.js` | Client-side generators for `.3mf` (XML + ZIP store) and binary `.stl` |
| `src/ui_app.js` | State management, 2D slippy map, Photon autocomplete, and event handlers |
| `docs/screenshots/` | Verification screenshots across camera angles and regions |
