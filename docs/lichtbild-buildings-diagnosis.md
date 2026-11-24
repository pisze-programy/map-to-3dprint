# Burj Khalifa Spire Diagnosis: Lichtbild vs. `map-to-3dprint`

Date: `2026-11-11` (historical snapshot at commit `b307cd6`).
This diagnosis compares our code at `b307cd6` against the public Lichtbild bundle, public API, and generated render.

## 1. Evidence Scope and Limits

Lichtbild does not run geometry generation in the browser.
Their 31 client JS chunks contain only the configurator, cart, and image fetchers (`POST /api/createCity` -> stream -> `GET /api/image?id=...`).
Their mesh generator runs on private servers.

Three public sources prove how their building geometry works:

1. Their `26 cm` Burj Khalifa render from their public MCP connector.
2. Shared OpenStreetMap (OSM) vectors from our Dubai cache.
3. Our full source code at commit `b307cd6`.

## 2. What the Lichtbild Render Shows (`26 cm`, `1333 x 1333 m`)

- The tower shows clean stepped setbacks and a thin top spire.
- Neighboring skyscrapers use clean footprint extrusions with flat roofs.
- Adjacent volumes show zero clipping or overlap artifacts. Each building forms one unified solid.
- Roads, water, greenery, and trees meet cleanly with zero gaps.

## 3. Source of the Spire in OSM Data

OSM represents Burj Khalifa as one relation plus dozens of `building:part` elements.
Our Dubai cache contains 17 parts taller than `400 m`:

| Height | `min_height` | Min Footprint Width | OSM Type |
| :--- | :--- | ---: | :--- |
| `828 m` | none | `~1.1 m` | `building:part` (spire) |
| `760 m` | none | `~3.9 m` | `building:part` |
| `740 m` | none | `~4.0 m` | `building:part` |
| `720 m` | none | `~3.8 m` | `building:part` |
| `710 m` | none | `~15.0 m` | `building:part` |
| `700 m` | none | `~9.1 m` | `building:part` |
| `680 m` | none | `~10.4 m` | `building:part` |
| `660 m` | none | `~7.7 m` | `building:part` |
| `645 m` | none | `~13.7 m` | `building:part` |
| `625 m` | none | `~10.1 m` | `building:part` |
| `605 m` | none | `~13.1 m` | `building:part` |
| `591 m` | none | `~148.5 m` | `building` (relation outline) |
| `580..405 m` | none | `12-20 m` | `building:part` |

These Burj Khalifa parts contain zero `min_height` tags.
Each nested footprint extrudes from ground level to its own height.
The union of all nested slices creates the tapered tower and `1.1 m` spire.
You need part union and zero narrow-part deletion to build the spire.

## 4. Five Root Causes in Our Code (`b307cd6`)

### 4.1 Relation Outline Extrudes Alongside Parts

`gis_pipeline.py:138-163` builds a building record from every `building` relation outline without checking for `building:part` members.
`gis_pipeline.py:186-190` adds every `building:part` separately.
Burj Khalifa therefore outputs a `148 m` wide, `591 m` tall base prism plus all parts.
Simple 3D Buildings (S3DB) rules state: skip the relation outline when `building:part` members exist.

### 4.2 Missing Per-Building Union

`mesh_builder.js:1000` mentions `building` / `building:part` deduplication in a comment, but code never reads `part`.
The geometry code at `b307cd6` contains zero boolean union calls.
Every slice stays a separate overlapping prism with internal walls, `epsZ` workarounds (`:1079`), and slicer overlaps.

### 4.3 Sliver Filter Deletes the Spire and Top Three Slices

`mesh_builder.js:950-952` skips every footprint with `minSpan < 0.55 || area < 0.45`.
At our `1.2 km` frame (`1 unit = 7.06 m`), that drops parts under `3.9 m` or `22 m2`.

| Slice | Width | Area | Filter Result |
| :--- | ---: | ---: | :--- |
| `828 m` (spire) | `1.1 m` | `0.9 m2` | Dropped |
| `760 m` | `3.9 m` | `12.0 m2` | Dropped |
| `740 m` | `4.0 m` | `12.5 m2` | Dropped |
| `720 m` | `3.8 m` | `12.0 m2` | Dropped |

The filter removes the entire `720-828 m` crown and spire.

### 4.4 Anti-Matchstick Clamp Trims Each Slice Independently

`mesh_builder.js:1066-1070` clamps `totalHMm` to `max(1.8, item.minSpan * 2.85)` whenever `item.minSpan < 2.6` (`~18.3 m`).

| Slice | Width | Height After Clamp |
| :--- | ---: | ---: |
| `710 m` | `15.0 m` | `43 m` |
| `700 m` | `9.1 m` | `26 m` |
| `680 m` | `10.4 m` | `30 m` |
| `660 m` | `7.7 m` | `22 m` |
| `645 m` | `13.7 m` | `39 m` |
| `625 m` | `10.1 m` | `29 m` |
| `605 m` | `13.1 m` | `37 m` |
| `580 m` | `14.8 m` | `42 m` |
| `560 m` | `17.5 m` | `50 m` |
| `520 m` | `16.3 m` | `46 m` |
| `460 m` | `19.7 m` | `56 m` |
| `591 m` (outline) | `148.5 m` | `591 m` (unchanged) |

Only the `148 m` base prism keeps full height (`591 m`), surrounded by short `22-56 m` stubs.

### 4.5 Default Synthetic Roofs Add Top Triangles

`ui_gis_client.js:164-165` defaults missing `roof:shape` tags to `'hipped'` with `roofH` between `2.6 m` and `6.5 m`.
`gis_pipeline.py:476-489` applies the same `'hipped'` default up to `7 m`.
The Burj outline lacks `roof:shape`, so it gains a `7 m` hipped roof atop `591 m`.
`mesh_extrude.js:110-160` adds facets along complex outlines, creating visible triangle artifacts.
Lichtbild renders flat roofs whenever OSM omits `roof:shape`.

### 4.6 Ignored `min_height` Field

`gis_pipeline.py:438-441` parses `min_height` and writes `minH` at line `499`.
Neither `mesh_builder.js` nor `mesh_extrude.js` reads `minH` at `b307cd6`.
`ui_gis_client.js:162` also hardcodes `minH: 0`.
Elevated overhangs therefore always extrude from ground level instead of `min_height`.

## 5. Rules Required to Match the Lichtbild Output

Six data and geometry rules explain their clean result:

1. **Parts replace outline**: Skip the base relation outline whenever `building:part` members exist.
2. **Slice elevation range**: Extrude each part from `[min_height ?? 0, height]`.
3. **Per-building union**: Union all slices sharing an `osmId` or relation into one watertight solid.
4. **OSM-only roofs**: Generate sloped roofs only when OSM provides `roof:shape`. Otherwise use flat roofs.
5. **Building-level height scaling**: Scale heights per unified building, never per thin slice.
6. **Stable building IDs**: Keep one object per building to support `markedBuildings`, `editedBuildings`, and `deletedBuildings` (`mod 49391`).

## 6. Failure Chain Diagram (`b307cd6`)

```text
OSM: relation outline + N building:part slices
  -> pipeline emits outline (591 m) + all parts separately
  -> sliver filter (minSpan < 0.55) drops 720-828 m spire
  -> clamp (2.85 * minSpan) shrinks 460-710 m slices to 22-56 m
  -> zBase ignores minH and starts every slice at terrain
  -> missing roof:shape defaults to hipped roof triangles
Result: 591 m base prism + short stubs + triangular cap
```

## 7. Bridges and Roads Note

Lichtbild bridges combine deck, piers, and ramps into one closed solid joined to roads.
At `b307cd6`, our roads use open ribbons (`pushQuad` top plus two sides, zero bottom, zero end caps).
Bridge decks (`mesh_builder.js:968,998`) do not union with terrain, leaving visible seam gaps.
Our code also omits road lane markings.

## 8. Summary and Caveats

Lichtbild wins through its building data contract, not a better renderer.
Treat each building as one union of `building:part` slices, skip outlines when parts exist, and apply filters per building.

- The Lichtbild Burj render came from their public MCP (`26 cm`, Dubai) into local `$TMPDIR/lbq/burj_crop.png`.
- Section 5 states rules deduced from OSM data and visual output, not private server code.
- Line numbers apply to commit `b307cd6`. Earlier notes live in `docs/lichtbild-vs-map3d-analysis.md`.
