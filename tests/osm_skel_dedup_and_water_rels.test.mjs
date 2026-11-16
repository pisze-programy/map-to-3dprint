import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/print_physics_config.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/gis_client/overpass_dem_fetch.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/gis_client/s3db_unit_parser.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/gis_client/s3db_relation_helper.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/gis_client/s3db_client_matcher.js')));
const waterExtract = require(path.join(ROOT, 'src/gis_client/osm_water_extract.js'));
Object.assign(globalThis, waterExtract);
Object.assign(globalThis, require(path.join(ROOT, 'src/gis_client/osm_pier_geometry_helper.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/gis_client/osm_bridges_piers_extract.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/gis_client/osm_greenery_extract.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/gis_client/osm_roads_extract.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/gis_client/osm_trees_extract.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/gis_client/osm_buildings_extract.js')));
const sceneBuilder = require(path.join(ROOT, 'src/gis_client/osm_scene_builder.js'));

const { isOsmWaterMultipolygonJS } = waterExtract;
const { fetchRealGISInBrowser, mergeOsmElementJS } = sceneBuilder;

function resolveCacheFile(filename) {
  const candidates = [path.join(ROOT, 'cache', filename)];
  try {
    const commonGit = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    if (commonGit) {
      candidates.push(path.resolve(ROOT, commonGit, '..', 'cache', filename));
    }
  } catch (_) {}
  candidates.push(path.join('/Users/krystianblaszczyk/nodes/piszeprogramy/map-to-3dprint/cache', filename));
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function makeFlatDem(gridSize = 72, elevM = 5) {
  return {
    gridSize,
    minElev: elevM,
    maxElev: elevM,
    grid: Array.from({ length: gridSize }, () => Array(gridSize).fill(elevM)),
    zoom: 14,
  };
}

async function runSceneBuilderWithPayload(south, west, north, east, title, osmPayload, options = {}) {
  const prevFetch = globalThis.fetch;
  const prevDem = globalThis.fetchTerrariumDemInBrowser;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(osmPayload),
    json: async () => osmPayload,
  });
  globalThis.fetchTerrariumDemInBrowser = async () => makeFlatDem();
  try {
    return await fetchRealGISInBrowser(south, west, north, east, title, options);
  } finally {
    globalThis.fetch = prevFetch;
    globalThis.fetchTerrariumDemInBrowser = prevDem;
  }
}

function pointInRing2D(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInWaterPolys(px, py, waterPolys) {
  for (const wp of (waterPolys || [])) {
    if (!wp || !Array.isArray(wp.outer) || wp.outer.length < 3) continue;
    if (!pointInRing2D(px, py, wp.outer)) continue;
    const inHole = (wp.holes || []).some(h => Array.isArray(h) && h.length >= 3 && pointInRing2D(px, py, h));
    if (!inHole) return true;
  }
  return false;
}

function estimateWaterCoverageRatio(scene, steps = 120) {
  const hw = scene.halfW;
  const hh = scene.halfH;
  let inside = 0;
  const total = steps * steps;
  for (let iy = 0; iy < steps; iy++) {
    const py = -hh + ((iy + 0.5) / steps) * (2 * hh);
    for (let ix = 0; ix < steps; ix++) {
      const px = -hw + ((ix + 0.5) / steps) * (2 * hw);
      if (pointInWaterPolys(px, py, scene.waterPolys)) inside++;
    }
  }
  return inside / total;
}

test('FM1: Sopot cached payload preserves natural=coastline on skel duplicates and restores Baltic Sea (>20% water)', async () => {
  const sopotPath = resolveCacheFile('osm_54.4381_18.5575_54.4511_18.5797.json');
  assert.ok(sopotPath, 'Expected cached Sopot OSM payload osm_54.4381_18.5575_54.4511_18.5797.json');

  const rawPayload = JSON.parse(fs.readFileSync(sopotPath, 'utf8'));
  assert.ok(Array.isArray(rawPayload.elements) && rawPayload.elements.length > 1000);

  // Confirm raw Sopot payload actually contains the exact bug trigger:
  // ways 4342914 and 4342915 appear first with natural=coastline and later as tagless skel ways.
  for (const targetWid of [4342914, 4342915]) {
    const occurrences = rawPayload.elements.filter(el => el.type === 'way' && el.id === targetWid);
    assert.equal(occurrences.length, 2, `Expected way ${targetWid} to appear twice in raw Sopot payload`);
    assert.equal(occurrences[0].tags?.natural, 'coastline', `First occurrence of way ${targetWid} has natural=coastline`);
    assert.equal(occurrences[1].tags, undefined, `Second occurrence of way ${targetWid} is tagless skel`);

    const merged = occurrences.reduce((acc, cur) => mergeOsmElementJS(acc, cur), null);
    assert.equal(merged.tags?.natural, 'coastline', `Merged way ${targetWid} must retain natural=coastline`);
    assert.ok(Array.isArray(merged.nodes) && merged.nodes.length >= 2, `Merged way ${targetWid} retains nodes`);
  }

  const scene = await runSceneBuilderWithPayload(54.4381, 18.5575, 54.4511, 18.5797, 'Sopot', rawPayload);
  const coverage = estimateWaterCoverageRatio(scene, 140);
  console.log(`  [Sopot] waterPolys=${scene.waterPolys.length}, coverage=${(coverage * 100).toFixed(2)}%, buildings=${scene.buildings.length}`);

  assert.equal(scene._hasMarineTags, true, 'Sopot scene must retain _hasMarineTags');
  assert.ok(
    coverage > 0.20,
    `Expected Sopot Baltic Sea coverage > 20% after skel dedup fix, got ${(coverage * 100).toFixed(2)}%`
  );
});

test('FM1: Synthetic + cached Warsaw & NYC skel duplicate ways, nodes, and relations suffer zero tag loss', async () => {
  // 1. Unit + end-to-end synthetic skel duplicate checks (both [body, skel] and [skel, body] orders)
  const cLat = 52.2320, cLon = 21.0060;
  const d = 0.00025;
  const syntheticPayload = {
    version: 0.6,
    elements: [
      // Building square nodes
      { type: 'node', id: 1, lat: cLat - d, lon: cLon - d },
      { type: 'node', id: 2, lat: cLat - d, lon: cLon + d },
      { type: 'node', id: 3, lat: cLat + d, lon: cLon + d },
      { type: 'node', id: 4, lat: cLat + d, lon: cLon - d },
      // River centerline nodes
      { type: 'node', id: 10, lat: cLat - 2 * d, lon: cLon - 2 * d },
      { type: 'node', id: 11, lat: cLat + 2 * d, lon: cLon - 2 * d },
      // Tagged tree node followed by tagless skel + corrupt NaN coord duplicate
      { type: 'node', id: 20, lat: cLat, lon: cLon + 2 * d, tags: { natural: 'tree', height: '14' } },
      { type: 'node', id: 20, lat: cLat, lon: cLon + 2 * d },
      { type: 'node', id: 20 },
      // Reverse order tree node: skel first, tagged second
      { type: 'node', id: 21, lat: cLat + d, lon: cLon + 2 * d },
      { type: 'node', id: 21, lat: cLat + d, lon: cLon + 2 * d, tags: { natural: 'tree', height: '11' } },

      // Building 101: body first, skel second (classic >; out skel qt; overwrite!)
      { type: 'way', id: 101, nodes: [1, 2, 3, 4, 1], tags: { building: 'apartments', 'building:levels': '8', name: 'Kamienica A' } },
      { type: 'way', id: 101, nodes: [1, 2, 3, 4, 1] },

      // River 202: body first, skel second
      { type: 'way', id: 202, nodes: [10, 11], tags: { waterway: 'river', width: '18', name: 'Wisla Test' } },
      { type: 'way', id: 202, nodes: [10, 11] },

      // Water pond 303 via multipolygon relation: relation appears twice (body + skel) and member way appears twice
      { type: 'node', id: 31, lat: cLat - d, lon: cLon - 4 * d },
      { type: 'node', id: 32, lat: cLat - d, lon: cLon - 3 * d },
      { type: 'node', id: 33, lat: cLat + d, lon: cLon - 3 * d },
      { type: 'node', id: 34, lat: cLat + d, lon: cLon - 4 * d },
      { type: 'way', id: 303, nodes: [31, 32, 33, 34, 31] },
      {
        type: 'relation',
        id: 900,
        members: [{ type: 'way', ref: 303, role: 'outer' }],
        tags: { type: 'multipolygon', natural: 'water', name: 'Jeziorko' },
      },
      {
        type: 'relation',
        id: 900,
        members: [{ type: 'way', ref: 303, role: 'outer' }],
      },
    ],
  };

  const synScene = await runSceneBuilderWithPayload(
    cLat - 0.004, cLon - 0.005, cLat + 0.004, cLon + 0.005,
    'SyntheticDedup',
    syntheticPayload,
    { lodSettings: { enableTrees: true, treeMaxSpanKm: 5, minBuildingFootprintM: 0, roadDetail: 'all' } }
  );

  assert.equal(synScene.buildings.length, 1, 'Tagged building must survive trailing skel duplicate');
  assert.equal(synScene.waterLines.length, 1, 'Tagged river way must survive trailing skel duplicate');
  assert.equal(synScene.waterLines[0].name, 'Wisla Test');
  assert.equal(synScene.waterPolys.length, 1, 'Tagged water multipolygon relation must survive trailing skel duplicate');
  assert.equal(synScene.waterPolys[0].name, 'Jeziorko');
  assert.ok(synScene.trees.length >= 2, 'Both tree nodes (body+skel and skel+body) must survive with finite coords');

  // 2. Real cached Warsaw & NYC payloads: verify 100% tag survival across hundreds of duplicate skel ways
  const cityChecks = [
    {
      label: 'Warsaw',
      file: 'osm_52.2262_20.9973_52.2378_21.0162.json',
      bbox: [52.2262, 20.9973, 52.2378, 21.0162],
      minDupTaggedWays: 50,
    },
    {
      label: 'NYC Lower Manhattan',
      file: 'osm_40.7069_-74.0137_40.7185_-73.9984.json',
      bbox: [40.7069, -74.0137, 40.7185, -73.9984],
      minDupTaggedWays: 10,
      expectMarineWater: true,
    },
    {
      label: 'NYC Midtown',
      file: 'osm_40.7563_-73.9919_40.7703_-73.9750.json',
      bbox: [40.7563, -73.9919, 40.7703, -73.9750],
      minDupTaggedWays: 20,
    },
  ];

  for (const city of cityChecks) {
    const filePath = resolveCacheFile(city.file);
    assert.ok(filePath, `Expected cached ${city.label} payload ${city.file}`);
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const naiveWays = new Map();
    const mergedWays = new Map();
    for (const el of payload.elements) {
      if (el.type !== 'way') continue;
      naiveWays.set(el.id, el);
      const prev = mergedWays.get(el.id);
      mergedWays.set(el.id, prev ? mergeOsmElementJS(prev, el) : el);
    }

    let wipedByNaive = 0;
    let lostInMerged = 0;
    for (const [wid, mw] of mergedWays.entries()) {
      const hasMergedTags = Boolean(mw.tags && Object.keys(mw.tags).length > 0);
      const nw = naiveWays.get(wid);
      const hasNaiveTags = Boolean(nw && nw.tags && Object.keys(nw.tags).length > 0);
      if (hasMergedTags && !hasNaiveTags) wipedByNaive++;
    }
    for (const el of payload.elements) {
      if (el.type === 'way' && el.tags && Object.keys(el.tags).length > 0) {
        const mw = mergedWays.get(el.id);
        if (!mw || !mw.tags || Object.keys(mw.tags).length === 0) lostInMerged++;
      }
    }

    console.log(`  [${city.label}] ways wiped without fix=${wipedByNaive}, lost with mergeOsmElementJS=${lostInMerged}`);
    assert.ok(wipedByNaive >= city.minDupTaggedWays, `Expected >= ${city.minDupTaggedWays} skel-overwritten ways in ${city.label}`);
    assert.equal(lostInMerged, 0, `Expected 0 tag loss across all ways in ${city.label}`);

    const [s, w, n, e] = city.bbox;
    const scene = await runSceneBuilderWithPayload(s, w, n, e, city.label, payload);
    assert.ok(scene.buildings.length > 100, `Expected >100 extracted buildings in ${city.label}`);
    if (city.expectMarineWater) {
      const nycWaterCov = estimateWaterCoverageRatio(scene, 100);
      console.log(`  [${city.label}] waterPolys=${scene.waterPolys.length}, waterCoverage=${(nycWaterCov * 100).toFixed(2)}%, buildings=${scene.buildings.length}`);
      assert.equal(scene._hasMarineTags, true, 'NYC Lower Manhattan must retain _hasMarineTags from coastline ways');
      assert.ok(scene.waterPolys.length >= 10 && nycWaterCov > 0.01, 'NYC Lower Manhattan coastline & river water must be preserved');
    }
  }
});

test('FM7: Linear type=waterway / route relations are rejected as water multipolygons while areal multipolygons extract normally', async () => {
  // Direct tag classifier checks
  assert.equal(isOsmWaterMultipolygonJS({ type: 'waterway', waterway: 'canal', name: 'Canal Test' }), false);
  assert.equal(isOsmWaterMultipolygonJS({ type: 'waterway', natural: 'water' }), false);
  assert.equal(isOsmWaterMultipolygonJS({ type: 'route', waterway: 'canal' }), false);
  assert.equal(isOsmWaterMultipolygonJS({ type: 'waterway_section', waterway: 'riverbank' }), false);
  assert.equal(isOsmWaterMultipolygonJS({ type: 'network', water: 'canal' }), false);
  assert.equal(isOsmWaterMultipolygonJS({ type: 'collection', natural: 'water' }), false);
  assert.equal(isOsmWaterMultipolygonJS({ type: 'site', leisure: 'marina' }), false);

  // Valid areal multipolygons (and untyped tag dicts) remain accepted
  assert.equal(isOsmWaterMultipolygonJS({ type: 'multipolygon', waterway: 'canal' }), true);
  assert.equal(isOsmWaterMultipolygonJS({ type: 'multipolygon', natural: 'water' }), true);
  assert.equal(isOsmWaterMultipolygonJS({ type: 'boundary', natural: 'water' }), true);
  assert.equal(isOsmWaterMultipolygonJS({ waterway: 'canal' }), true);
  assert.equal(isOsmWaterMultipolygonJS({ natural: 'water' }), true);

  // End-to-end scene test:
  // 1) Linear relation { type: 'waterway', waterway: 'canal', name: 'Canal Test' } with 2 canal ways (even forming a closed loop or bend)
  //    MUST NOT stitch into waterPolys and MUST extract its member ways as linear waterLines!
  // 2) Areal { type: 'multipolygon', waterway: 'canal' } and { type: 'multipolygon', natural: 'water' }
  //    MUST extract as areal waterPolys!
  const cLat = 48.8700, cLon = 2.3650;
  const d = 0.0004;
  const payload = {
    version: 0.6,
    elements: [
      // Linear canal centerline nodes (even if closed / L-shaped so stitchWayRingsJS could form a polygon if unguarded!)
      { type: 'node', id: 1, lat: cLat - d, lon: cLon - d },
      { type: 'node', id: 2, lat: cLat, lon: cLon - d * 0.4 },
      { type: 'node', id: 3, lat: cLat + d, lon: cLon - d },
      { type: 'way', id: 1001, nodes: [1, 2], tags: { waterway: 'canal', width: '12', name: 'Canal Test' } },
      { type: 'way', id: 1002, nodes: [2, 3, 1], tags: { waterway: 'canal', width: '12', name: 'Canal Test' } },
      {
        type: 'relation',
        id: 5001,
        members: [
          { type: 'way', ref: 1001, role: '' },
          { type: 'way', ref: 1002, role: '' },
        ],
        tags: { type: 'waterway', waterway: 'canal', name: 'Canal Test' },
      },

      // Genuine areal multipolygon with waterway=canal
      { type: 'node', id: 11, lat: cLat - d, lon: cLon + d * 0.5 },
      { type: 'node', id: 12, lat: cLat - d, lon: cLon + d * 1.5 },
      { type: 'node', id: 13, lat: cLat, lon: cLon + d * 1.5 },
      { type: 'node', id: 14, lat: cLat, lon: cLon + d * 0.5 },
      { type: 'way', id: 2001, nodes: [11, 12, 13, 14, 11] },
      {
        type: 'relation',
        id: 5002,
        members: [{ type: 'way', ref: 2001, role: 'outer' }],
        tags: { type: 'multipolygon', waterway: 'canal', name: 'Areal Canal Basin' },
      },

      // Genuine areal multipolygon with natural=water
      { type: 'node', id: 21, lat: cLat + d * 0.3, lon: cLon + d * 0.5 },
      { type: 'node', id: 22, lat: cLat + d * 0.3, lon: cLon + d * 1.5 },
      { type: 'node', id: 23, lat: cLat + d * 1.3, lon: cLon + d * 1.5 },
      { type: 'node', id: 24, lat: cLat + d * 1.3, lon: cLon + d * 0.5 },
      { type: 'way', id: 2002, nodes: [21, 22, 23, 24, 21] },
      {
        type: 'relation',
        id: 5003,
        members: [{ type: 'way', ref: 2002, role: 'outer' }],
        tags: { type: 'multipolygon', natural: 'water', name: 'Lake Multipolygon' },
      },
    ],
  };

  const scene = await runSceneBuilderWithPayload(
    cLat - 0.004, cLon - 0.004, cLat + 0.004, cLon + 0.004,
    'WaterRelGuards',
    payload
  );

  const polyNames = scene.waterPolys.map(p => p.name);
  assert.ok(!polyNames.includes('Canal Test'), 'Linear type=waterway relation MUST NOT become a waterPoly');
  assert.ok(polyNames.includes('Areal Canal Basin'), 'type=multipolygon + waterway=canal MUST extract as waterPoly');
  assert.ok(polyNames.includes('Lake Multipolygon'), 'type=multipolygon + natural=water MUST extract as waterPoly');
  assert.equal(scene.waterPolys.length, 2, 'Exactly the 2 genuine multipolygons should be in waterPolys');
  assert.equal(scene.waterLines.length, 2, 'Both member ways of type=waterway relation must extract as linear waterLines');
});

test('Python pipeline & server.py: py_compile, FM1 skel dedup, FM7 relation guards, and FM2 water/island priority', () => {
  // 1. Bytecode syntax compile check (-B avoids writing __pycache__)
  execFileSync(
    'python3',
    ['-B', '-m', 'py_compile', 'server.py', 'gis/scene_pipeline.py', 'gis/terrain_features.py'],
    { cwd: ROOT, encoding: 'utf8' }
  );

  const sopotPath = resolveCacheFile('osm_54.4381_18.5575_54.4511_18.5797.json');
  assert.ok(sopotPath, 'Expected cached Sopot OSM payload');

  // 2. Python functional verification of gis/scene_pipeline.py, gis/terrain_features.py, and server.py
  const pyScript = `
import json
import os
import sys
import tempfile
from unittest import mock

import gis.scene_pipeline as sp
import gis.terrain_features as tf
import server

sopot_path = sys.argv[1]

# --- A. gis.scene_pipeline.merge_osm_element ---
w_tagged = {"type": "way", "id": 4342914, "nodes": [1, 2, 3], "tags": {"natural": "coastline"}}
w_skel = {"type": "way", "id": 4342914, "nodes": [1, 2, 3, 4]}
m1 = sp.merge_osm_element(w_tagged, w_skel)
assert m1["tags"] == {"natural": "coastline"}, f"lost tags: {m1}"
assert m1["nodes"] == [1, 2, 3, 4], f"did not keep longer nodes: {m1}"

m2 = sp.merge_osm_element(w_skel, w_tagged)
assert m2["tags"] == {"natural": "coastline"}, f"lost tags in reverse order: {m2}"
assert m2["nodes"] == [1, 2, 3, 4]

n_tagged = {"type": "node", "id": 77, "lat": 54.44, "lon": 18.56, "tags": {"natural": "tree", "height": "12"}}
n_skel = {"type": "node", "id": 77}
mn = sp.merge_osm_element(n_tagged, n_skel)
assert mn["lat"] == 54.44 and mn["lon"] == 18.56 and mn["tags"]["natural"] == "tree"

# --- B. gis.terrain_features FM7 guard ---
water_polys, green_polys, bridge_polys, road_polys = [], [], [], []
used_ways = set()
ring = [[-5.0, -5.0], [5.0, -5.0], [5.0, 5.0], [-5.0, 5.0]]

for bad_type in ("waterway", "route", "waterway_section", "network", "collection", "site"):
    tf.process_multipolygon_terrain_feature(
        {"type": bad_type, "waterway": "canal", "name": "LinearBad"},
        [ring], [], [901, 902], used_ways,
        water_polys, green_polys, bridge_polys, road_polys,
    )
assert len(water_polys) == 0, f"Non-areal relation leaked into water_polys: {water_polys}"
assert len(used_ways) == 0, f"Non-areal relation marked ways as used: {used_ways}"

tf.process_multipolygon_terrain_feature(
    {"type": "multipolygon", "waterway": "canal", "name": "GoodMP"},
    [ring], [], [903], used_ways,
    water_polys, green_polys, bridge_polys, road_polys,
)
assert len(water_polys) == 1 and water_polys[0]["name"] == "GoodMP"
assert 903 in used_ways

# --- C. End-to-end gis.scene_pipeline.build_scene_from_bbox on synthetic + real Sopot ---
c_lat, c_lon = 52.23, 21.01
d = 0.0004
fake_osm = {
    "elements": [
        {"type": "node", "id": 1, "lat": c_lat - d, "lon": c_lon - d},
        {"type": "node", "id": 2, "lat": c_lat - d, "lon": c_lon + d},
        {"type": "node", "id": 3, "lat": c_lat + d, "lon": c_lon + d},
        {"type": "node", "id": 4, "lat": c_lat + d, "lon": c_lon - d},
        {"type": "way", "id": 50, "nodes": [1, 2, 3, 4, 1], "tags": {"building": "yes", "height": "22"}},
        {"type": "way", "id": 50, "nodes": [1, 2, 3, 4, 1]},  # trailing skel duplicate!
        {"type": "way", "id": 60, "nodes": [1, 2], "tags": {"highway": "primary", "name": "Main St"}},
        {"type": "way", "id": 60, "nodes": [1, 2]},  # trailing skel duplicate!
        {"type": "way", "id": 70, "nodes": [2, 3, 1], "tags": {"waterway": "canal", "name": "Linear Canal"}},
        {"type": "way", "id": 70, "nodes": [2, 3, 1]},  # trailing skel duplicate!
        {
            "type": "relation",
            "id": 700,
            "members": [{"type": "way", "ref": 70, "role": ""}],
            "tags": {"type": "waterway", "waterway": "canal", "name": "Linear Canal"},
        },
    ]
}
fake_dem = {"gridSize": 8, "minElev": 0.0, "maxElev": 2.0, "grid": [[1.0] * 8 for _ in range(8)]}
with tempfile.TemporaryDirectory() as tmpdir:
    with mock.patch.object(sp, "CACHE_DIR", tmpdir), \\
         mock.patch.object(sp, "fetch_terrarium_dem_grid", return_value=fake_dem), \\
         mock.patch.object(sp, "fetch_osm_overpass", return_value=fake_osm), \\
         mock.patch.object(sp, "validate_processed_scene", return_value=True):
        sc = sp.build_scene_from_bbox(c_lat - 0.003, c_lon - 0.003, c_lat + 0.003, c_lon + 0.003, "PyDedup", force_rebuild=True)
        assert len(sc["buildings"]) == 1, f"Expected 1 building, got {len(sc['buildings'])}"
        assert len(sc["roads"]) == 1, f"Expected 1 road, got {len(sc['roads'])}"
        assert len(sc["waterPolys"]) == 0, f"Expected 0 bogus waterPolys, got {sc['waterPolys']}"
        assert len(sc["waterLines"]) == 1, f"Expected 1 canal waterLine, got {sc['waterLines']}"

    with open(sopot_path, "r", encoding="utf-8") as fh:
        sopot_osm = json.load(fh)
    with mock.patch.object(sp, "CACHE_DIR", tmpdir), \\
         mock.patch.object(sp, "fetch_terrarium_dem_grid", return_value=fake_dem), \\
         mock.patch.object(sp, "fetch_osm_overpass", return_value=sopot_osm):
        sopot_sc = sp.build_scene_from_bbox(54.4381, 18.5575, 54.4511, 18.5797, "SopotPy", force_rebuild=True)
        sea_polys = [wp for wp in sopot_sc["waterPolys"] if "Morze" in wp.get("name", "")]
        assert len(sea_polys) >= 1, f"Expected Python Sopot pipeline to recover Baltic Sea polygon, got {[w.get('name') for w in sopot_sc['waterPolys']]}"
        assert len(sopot_sc["buildings"]) > 1000

# --- D. server.py FM2 prioritization + <=450 member water/island cap + FM1 dedup ---
raw_els = [{"type": "way", "id": 1, "nodes": [10, 11], "tags": {"natural": "coastline"}}]
# Add 80 incomplete building relations (priority=1) BEFORE water & island relations!
for i in range(80):
    raw_els.append({
        "type": "relation",
        "id": 1000 + i,
        "members": [{"type": "way", "ref": 9000 + i, "role": "outer"}] * 5,
        "tags": {"type": "building", "building": "yes"},
    })
# Large 147-member Nieuwe Maas river multipolygon (100 < 147 <= 450 -> MUST be kept at priority 0!)
raw_els.append({
    "type": "relation",
    "id": 2001,
    "members": [{"type": "way", "ref": 50000 + k, "role": "outer"} for k in range(147)],
    "tags": {"type": "multipolygon", "natural": "water", "water": "river", "name": "Nieuwe Maas"},
})
# 210-member island multipolygon (100 < 210 <= 450 -> MUST be kept at priority 0!)
raw_els.append({
    "type": "relation",
    "id": 2002,
    "members": [{"type": "way", "ref": 60000 + k, "role": "outer"} for k in range(210)],
    "tags": {"type": "multipolygon", "place": "island", "name": "IJsselmonde"},
})
# Canal multipolygon & reservoir multipolygon (priority 0!)
raw_els.append({
    "type": "relation",
    "id": 2003,
    "members": [{"type": "way", "ref": 70001, "role": "outer"}],
    "tags": {"type": "multipolygon", "waterway": "riverbank"},
})
raw_els.append({
    "type": "relation",
    "id": 2004,
    "members": [{"type": "way", "ref": 70002, "role": "outer"}],
    "tags": {"type": "multipolygon", "landuse": "reservoir"},
})
# >450 member continental water relation -> MUST be skipped
raw_els.append({
    "type": "relation",
    "id": 2999,
    "members": [{"type": "way", "ref": 80000 + k, "role": "outer"} for k in range(451)],
    "tags": {"type": "multipolygon", "natural": "water"},
})
# >100 member building relation -> MUST be skipped
raw_els.append({
    "type": "relation",
    "id": 3999,
    "members": [{"type": "way", "ref": 85000 + k, "role": "part"} for k in range(101)],
    "tags": {"type": "building", "building": "yes"},
})
# Linear type=waterway relation -> MUST be skipped
raw_els.append({
    "type": "relation",
    "id": 4999,
    "members": [{"type": "way", "ref": 89000, "role": ""}],
    "tags": {"type": "waterway", "waterway": "canal"},
})

selected = server._select_osm_v06_relations_to_complete(raw_els)
assert len(selected) == 24, f"Expected cap of 24 relations, got {len(selected)}"
top4_ids = [rid for _, _, rid in selected[:4]]
assert set(top4_ids) == {2001, 2002, 2003, 2004}, f"Water & island rels must beat all 80 buildings! Got top4={selected[:4]}"
all_selected_ids = {rid for _, _, rid in selected}
assert 2999 not in all_selected_ids, ">450 member water relation should be excluded"
assert 3999 not in all_selected_ids, ">100 member building relation should be excluded"
assert 4999 not in all_selected_ids, "type=waterway relation should be excluded"

# Verify server._merge_osm_v06_elements preserves tags when extra_rel_elements has skel or vice-versa
merged_map = server._merge_osm_v06_elements(
    [
        {"type": "way", "id": 10, "nodes": [1, 2, 3], "tags": {"natural": "coastline"}},
        {"type": "way", "id": 11, "nodes": [4, 5]},
    ],
    [
        {"type": "way", "id": 10, "nodes": [1, 2, 3, 4]},
        {"type": "way", "id": 11, "nodes": [4, 5], "tags": {"building": "yes"}},
    ],
)
assert merged_map[("way", 10)]["tags"] == {"natural": "coastline"}
assert merged_map[("way", 10)]["nodes"] == [1, 2, 3, 4]
assert merged_map[("way", 11)]["tags"] == {"building": "yes"}
print("PYTHON_CHECKS_OK")
`;

  const out = execFileSync('python3', ['-B', '-c', pyScript, sopotPath], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.ok(out.includes('PYTHON_CHECKS_OK'), `Expected PYTHON_CHECKS_OK, got: ${out}`);
});
