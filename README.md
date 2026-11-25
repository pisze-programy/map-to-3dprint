# map-to-3dprint

Convert live OpenStreetMap vectors and AWS Terrarium DEM elevation into watertight `10K` MSLA resin city reliefs.

**Photon Mono 4 (`17 um` XY, `0.100 mm` ABS White) | A4 White Passe-Partout (`120x170 mm`, `1x3` Strips) | Zero Supports**

![A4 Resin City Relief Packshot](docs/screenshots/hero-packshot-a4.jpg)

## 10K Resin Detail

![2x2 MSLA Resin Macro Details](docs/screenshots/details-2x2.jpg)

## Top 10 A4 Cities

![Top 10 A4 Single Cities Catalog](docs/screenshots/top10-a4-catalog.jpg)

## Close-Up Detail: Every City

| | |
| :---: | :---: |
| ![Paris True Scale](docs/screenshots/detail-01-paris.jpg)<br>**#1 Paris** (`76.75 mm` Z, `85.41 ml`) | ![Dubai Downtown](docs/screenshots/detail-02-dubai.jpg)<br>**#2 Dubai** (`99.93 mm` Z, `122.47 ml`) |
| ![London Tower Bridge](docs/screenshots/detail-03-london.jpg)<br>**#3 London** (`39.53 mm` Z, `114.63 ml`) | ![Chicago Loop](docs/screenshots/detail-04-chicago.jpg)<br>**#4 Chicago** (`62.36 mm` Z, `157.70 ml`) |
| ![Sydney Harbour](docs/screenshots/detail-05-sydney.jpg)<br>**#5 Sydney** (`40.63 mm` Z, `105.97 ml`) | ![Hong Kong Central](docs/screenshots/detail-06-hong-kong.jpg)<br>**#6 Hong Kong** (`54.56 mm` Z, `152.10 ml`) |
| ![Venice Grand Canal](docs/screenshots/detail-07-venice.jpg)<br>**#7 Venice** (`14.30 mm` Z, `91.49 ml`) | ![Amsterdam Canals](docs/screenshots/detail-08-amsterdam.jpg)<br>**#8 Amsterdam** (`10.30 mm` Z, `103.12 ml`) |
| ![San Francisco Bay](docs/screenshots/detail-09-san-francisco.jpg)<br>**#9 San Francisco** (`41.12 mm` Z, `114.85 ml`) | ![Warsaw City Center](docs/screenshots/detail-10-warsaw.jpg)<br>**#10 Warsaw** (`51.97 mm` Z, `128.12 ml`) |

## MSLA Resin Spec

- **Printer**: Anycubic Photon Mono 4 (`10K`, `17 um` XY pixel pitch, `153.45 x 87.05 x 165.0 mm` bed).
- **Resin profile**: Anycubic ABS-Like Pro 2 White at `0.100 mm` layer height (`Anti-alias Off`).
- **Build orientation**: Print every strip flat at `Z = 0.00 mm` on Flex Plate with zero slicer supports.
- **A4 `1x3` tiling**: Three flush `120 x 56.67 mm` horizontal strips (`Top`, `Middle`, `Bottom`) inside `4.0 mm` safe margins.
- **Verified print gate**: `4.0 mm` solid tunnel-free base (`waterCutout=true`) passing `validate_msla_stl.py` (`30/30` tiles `PASS`).

## Quick Start

```bash
npm install
python3 build_app.py
npm run test:headless
python3 calibration/validate_msla_stl.py <file.stl>
```

## Docs

- [Top 10 Single A4 Catalog and Explorations](docs/single-a4-top10-catalog.md)
- [Photon Mono 4 Slicer Profile (`0.100 mm` ABS White)](docs/mono4-slicer-profile.md)
- [MSLA Printability and Validation Specification](docs/msla-printability-and-validation-spec.md)
- [A4 `1x3` Tile Grid Audit](docs/a4-tile-grid-audit.md)
- [Frameless Chalk-Plaster Detail Gallery Mode](docs/detail-chalk-gallery-mode.md)
- [Blender Cycles Studio and MCP Workflow](docs/blender-studio-workflow.md)
