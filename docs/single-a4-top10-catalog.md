# Top 10 Single A4 Commercial Catalog and Orbital Explorations

This catalog records verified STL exports across two separate product tracks.
Export every commercial city SKU via `node tools/export_city_sku.mjs` from `config/city_catalog.json`.
All measurements come directly from exported binary STL files and `calibration/validate_assembly.py` (`VAL-01..14`).

## Track 1: Top 10 Commercial Single A4 Cities (`1x3` Strips)

Each city exports three flush `120 x 56.67 mm` strips (`Top`, `Middle`, `Bottom`) for Anycubic Photon Mono 4.
Every tile uses a `4.0 mm` solid perimeter skirt with `Z=0..1.50 mm` underside relief and a `0.25 mm` `DFM-06` chamfer.
Assemble all three strips North to South inside the `21 x 29.7 cm` white beveled passe-partout frame.

| Rank | City Slug (`exports/<slug>_a4_120x170_1x3/`) | DEM | Coordinates (`lat, lon`) | `span` / `rot` / `zScale` | `Zmax` (`mm`) | Resin (`ml`) | Total Tris | Assembly Gate |
| :---: | :--- | :---: | :--- | :--- | ---: | ---: | ---: | :--- |
| `#1` | `paris_true_scale` | `flat` | `48.8586, 2.2942` | `780 m` / `-46` / `1.05` | `77.54` | `81.23` | `186,930` | `VAL-01..14 PASS` |
| `#2` | `dubai_downtown` | `flat` | `25.1979, 55.2756` | `1480 m` / `0` / `1.05` | `99.93` | `103.50` | `168,148` | `VAL-01..14 PASS` |
| `#3` | `london_tower_bridge` | `flat` | `51.5092, -0.0784` | `1880 m` / `-8` / `1.25` | `39.04` | `87.11` | `391,558` | `VAL-01..14 PASS` |
| `#4` | `chicago_loop` | `flat` | `41.8834, -87.6320` | `1780 m` / `0` / `1.15` | `61.88` | `139.47` | `347,578` | `VAL-01..14 PASS` |
| `#5` | `sydney_harbour` | `terrarium` | `-33.8585, 151.2115` | `1720 m` / `+15` / `1.25` | `40.63` | `100.97` | `319,642` | `VAL-01..14 PASS` |
| `#6` | `hong_kong_central` | `terrarium` | `22.2838, 114.1592` | `1620 m` / `0` / `1.15` | `54.56` | `145.09` | `475,928` | `VAL-01..14 PASS` |
| `#7` | `venice_grand_canal` | `flat` | `45.4362, 12.3352` | `1680 m` / `-18` / `1.35` | `13.11` | `76.64` | `572,762` | `VAL-01..14 PASS` |
| `#8` | `amsterdam_canals` | `flat` | `52.3704, 4.8938` | `2100 m` / `-12` / `1.35` | `9.46` | `82.96` | `521,030` | `VAL-01..14 PASS` |
| `#9` | `san_francisco_bay` | `terrarium` | `37.7932, -122.3960` | `1820 m` / `-15` / `1.20` | `41.12` | `106.40` | `220,238` | `VAL-01..14 PASS` |
| `#10` | `warsaw_city_center` | `flat` | `52.2324, 21.0045` | `1380 m` / `+10` / `1.25` | `51.73` | `102.65` | `426,128` | `VAL-01..14 PASS` |

### Draft Screening and Verification Summary (`12 -> 10`)

- These 10 cities join existing flagship presets (`nyc_wtc`, `nyc_central_park`, and `singapore_marina_bay`).
- Visual screening dropped `barcelona_eixample` (`194.1 ml`, low vertical contrast) and `krakow` from the initial Top 10 launch wave.
- All `10/10` cities (`30/30` tiles) pass `calibration/validate_assembly.py` (`VAL-01..14 PASS`) and direct-STL seam-truth QA (`21/21` `_qa/seam_*_diff.png`).
- Use the `80x50 mm` (`1x2`) Paris seam coupon (`exports/paris_seam_coupon_80x50_1x2/`) for fast print checks (`9.88 mm` Z, `14.68 ml`, `29,852` tris).

## Track 2: Separate Explorations (Four Continents and Wildcards)

Keep orbital topographic reliefs separate from the commercial city catalog.
Generate all terrain plates from live AWS Terrarium DEM tiles using `tools/continent_relief_builder.py`.

### Four Continents ("4 Strony Swiata", `exports/explorations_continents/`)

Build `240 x 170 mm` dark-frame showcase plates with `--zoom 4 --max-relief-mm 15.0 --base-mm 3.5 --z-gamma 0.68 --ocean-cutout`:

| STL File | Bounds (`lat`, `lon`) | Measured BBox (`mm`) | Resin (`ml`) | Tris | Shells |
| :--- | :--- | :--- | ---: | ---: | :---: |
| `continent_west_americas.stl` | `13.5..52.5`, `-128..-62` | `240.00 x 169.10 x 18.50` | `176.00` | `295,888` | `8` |
| `continent_north_europe.stl` | `34..64`, `-13..39` | `183.91 x 170.00 x 18.50` | `128.73` | `410,748` | `21` |
| `continent_east_asia.stl` | `6.5..55.5`, `69..149` | `227.00 x 170.00 x 18.50` | `189.50` | `333,860` | `13` |
| `continent_south_africa_arabia.stl` | `-36..37`, `-24..64` | `188.99 x 167.14 x 18.50` | `132.84` | `309,112` | `6` |

### Three Non-City Exploratory Wildcards (`exports/explorations_wildcards/`)

Build `120 x 170 mm` A4 terrain test plates at `--zoom 12 --base-mm 4.0`:

| STL File | Bounds (`lat`, `lon`) & Mode | Measured BBox (`mm`) | Resin (`ml`) | Tris | Shells |
| :--- | :--- | :--- | ---: | ---: | :---: |
| `wildcard_santorini_caldera_120x170mm.stl` | `36.32..36.50`, `25.33..25.49` (`ocean-cutout`) | `117.89 x 137.87 x 26.00` | `60.63` | `145,236` | `5` |
| `wildcard_matterhorn_zermatt_120x170mm.stl` | `45.90..46.06`, `7.59..7.75` (`solid`, `36 mm`) | `120.00 x 170.00 x 40.00` | `447.24` | `451,196` | `1` |
| `wildcard_grand_canyon_120x170mm.stl` | `36.02..36.17`, `-112.18..-112.04` (`solid`, `28 mm`) | `120.00 x 170.00 x 32.00` | `405.78` | `451,196` | `1` |

- `Santorini Caldera` scored highest (`10/10`) in visual QA thanks to sharp white cliffs against matte-black Aegean water.
- All 7 exploration STLs passed strict `2-manifold` topology checks (`degen=0`, `open_edges=0`, `non_manifold_edges=0`, `VAL-04=[]`).
