import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

const {
  stitchClippedMultipolygonRingsJS,
  stitchCoastlineSeaPolysJS,
  polyAreaSignedJS,
  pointInPolyLocal,
} = require(path.join(ROOT, 'src/gis_client/overpass_dem_fetch.js'));

const {
  createPipelineRuntime,
  LocalOverpassEvaluator,
} = require(path.join(ROOT, 'tools/headless_scene_harness.js'));

const PORTO_CHUNK_IDS = [
  '90ddf45f3079dd14',
  'ca8f9db2945bb5ba',
  'cf412234f12ac0fb',
  '35160af0d4f25e1a',
];

function resolveOverpassV2Dir() {
  const candidates = [path.join(ROOT, 'cache/overpass_v2')];
  try {
    const commonGitDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    if (commonGitDir) {
      const mainRepoRoot = path.resolve(ROOT, commonGitDir, '..');
      candidates.push(path.join(mainRepoRoot, 'cache/overpass_v2'));
    }
  } catch (_) {}

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, `${PORTO_CHUNK_IDS[0]}.json.gz`))) {
      return dir;
    }
  }
  throw new Error(`Could not locate Porto cached Overpass chunks (${PORTO_CHUNK_IDS[0]}.json.gz) in ${candidates.join(' or ')}`);
}

function loadMergedOverpassChunks(chunkIds) {
  const dir = resolveOverpassV2Dir();
  const elMap = new Map();
  for (const id of chunkIds) {
    const gzPath = path.join(dir, `${id}.json.gz`);
    const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(gzPath)).toString('utf8'));
    for (const el of (raw.elements || [])) {
      const key = `${el.type}/${el.id}`;
      const prev = elMap.get(key);
      if (
        !prev ||
        (el.tags && !prev.tags) ||
        ((el.nodes || []).length > (prev.nodes || []).length) ||
        ((el.members || []).length > (prev.members || []).length)
      ) {
        elMap.set(key, el);
      }
    }
  }
  return elMap;
}

function extractBuildingProbeLatLons(elMap) {
  const out = [];
  for (const el of elMap.values()) {
    if (el.type === 'way' && el.tags && el.tags.building && Array.isArray(el.nodes) && el.nodes.length >= 3) {
      const n0 = elMap.get(`node/${el.nodes[0]}`);
      if (n0) out.push([n0.lat, n0.lon]);
    }
  }
  return out;
}

function stitchRel3688750ForBBox(elMap, bldLatLons, south, west, north, east, effectiveSpanM) {
  const cLat = (south + north) * 0.5;
  const cLon = (west + east) * 0.5;
  const cosLat = Math.cos((cLat * Math.PI) / 180.0);
  const spanNsM = Math.abs(north - south) * 111320.0;
  const spanEwM = Math.abs(east - west) * 111320.0 * cosLat;
  const spanM = effectiveSpanM || Math.max(spanNsM, spanEwM);
  const mToU = 169.2 / spanM;
  const fetchHalfW = Math.round(0.5 * spanEwM * mToU * 100) / 100;
  const fetchHalfH = Math.round(0.5 * spanNsM * mToU * 100) / 100;

  const rel = elMap.get('relation/3688750');
  assert.ok(rel, 'Expected rel/3688750 (Rio Douro) in Porto cached chunks');

  const outerWays = [];
  const innerWays = [];
  for (const m of rel.members) {
    if (m.type !== 'way') continue;
    const w = elMap.get(`way/${m.ref}`);
    if (!w || !Array.isArray(w.nodes) || w.nodes.length < 2) continue;
    if (m.role === 'inner') innerWays.push(w.nodes);
    else outerWays.push(w.nodes);
  }

  const nodesToPts = (nids, tol = 0.018) => {
    const pts = [];
    for (const nid of nids) {
      const n = elMap.get(`node/${nid}`);
      if (!n) continue;
      pts.push([
        (n.lon - cLon) * 111320.0 * cosLat * mToU,
        (n.lat - cLat) * 111320.0 * mToU,
      ]);
    }
    if (pts.length < 2) return pts;
    const simp = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const prev = simp[simp.length - 1];
      if (Math.hypot(pts[i][0] - prev[0], pts[i][1] - prev[1]) >= tol) {
        simp.push(pts[i]);
      }
    }
    return simp;
  };

  const bldPts = [];
  for (let i = 0; i < bldLatLons.length; i += 3) {
    const [la, lo] = bldLatLons[i];
    const x = (lo - cLon) * 111320.0 * cosLat * mToU;
    const y = (la - cLat) * 111320.0 * mToU;
    if (Math.abs(x) <= fetchHalfW && Math.abs(y) <= fetchHalfH) {
      bldPts.push([x, y]);
    }
  }

  const res = stitchClippedMultipolygonRingsJS(
    outerWays,
    innerWays,
    nodesToPts,
    fetchHalfW,
    fetchHalfH,
    {
      isWater: true,
      relName: 'rio douro',
      buildingSamplePts: bldPts,
      tol: 0.018,
    }
  );

  const polyAreas = res.outerPolys.map(p => Math.abs(polyAreaSignedJS(p)));
  const totalWaterArea = polyAreas.reduce((a, b) => a + b, 0);
  const rectArea = 4 * fetchHalfW * fetchHalfH;
  return {
    outerEntries: res.outerEntries,
    outerPolys: res.outerPolys,
    polyAreas,
    totalWaterArea,
    waterAreaPct: (100.0 * totalWaterArea) / rectArea,
    fetchHalfW,
    fetchHalfH,
  };
}

const portoMap4 = loadMergedOverpassChunks(PORTO_CHUNK_IDS);
const portoBlds4 = extractBuildingProbeLatLons(portoMap4);

test('FM0: Exact Porto Dom Luis I bbox [41.13161, -8.62241, 41.14879, -8.59960] across spans 1200m..1650m produces full Rio Douro (>12% area, 0 micro-sliver aborts)', async () => {
  const south = 41.13161, west = -8.62241, north = 41.14879, east = -8.59960;

  for (let span = 1200; span <= 1650; span += 25) {
    const r = stitchRel3688750ForBBox(portoMap4, portoBlds4, south, west, north, east, span);
    assert.equal(
      r.outerPolys.length,
      1,
      `Expected clean single Rio Douro polygon (0 micro-slivers / 0 aborts) at span=${span}m, got ${r.outerPolys.length}`
    );
    assert.ok(
      r.waterAreaPct > 12.0,
      `Expected >12% Rio Douro water area at span=${span}m, got ${r.waterAreaPct.toFixed(2)}% (area=${r.totalWaterArea.toFixed(1)})`
    );
  }

  // Also verify full chunked browser GIS scene pipeline at the previously-aborting 1300m span
  const els4 = [...portoMap4.values()];
  const rt = createPipelineRuntime({ offlineOnly: true, offlineFallbackDem: true, silent: true });
  rt.setOverpassEvaluator(new LocalOverpassEvaluator(els4));
  rt.sandbox.clearOverpassChunkCache();

  const cLat = (south + north) * 0.5;
  const cLon = (west + east) * 0.5;
  const cosLat = Math.cos((cLat * Math.PI) / 180.0);
  const dLat1300 = (1300 * 1.44 * 0.5) / 111320.0;
  const dLon1300 = (1300 * 1.44 * 0.5) / (111320.0 * cosLat);
  const scene1300 = await rt.sandbox.fetchChunkedGISInBrowser(
    cLat - dLat1300,
    cLon - dLon1300,
    cLat + dLat1300,
    cLon + dLon1300,
    'PORTO_DOM_LUIS_1300',
    { targetSpanMeters: 1300 }
  );

  const douroPolys = scene1300.waterPolys.filter(w => String(w.name || '').toLowerCase().includes('douro'));
  const fetchRectArea = 4 * scene1300._fetchHalfW * scene1300._fetchHalfH;
  const totalWaterArea = scene1300.waterPolys.reduce(
    (acc, w) => acc + Math.abs(polyAreaSignedJS(w.outer)),
    0
  );
  const pct1300 = (100.0 * totalWaterArea) / fetchRectArea;

  assert.ok(douroPolys.length >= 1, 'Expected Rio Douro water polygon in full scene at span=1300m');
  assert.ok(pct1300 > 12.0, `Expected >12% scene water area at span=1300m, got ${pct1300.toFixed(2)}%`);
});

test('FM0: Multi-step longitude/span sweep across Rio Douro (125 shifted bboxes) achieves 100% pass', () => {
  const baseLat = 41.1402;
  const cosLat = Math.cos((baseLat * Math.PI) / 180.0);
  const spans = [1200, 1300, 1400, 1500, 1625];
  let total = 0;
  let passed = 0;

  // Sweep 25 longitudes from Miragaia/Virtudes (-8.6155) across Dom Luis I (-8.6095) to Fontainhas (-8.6035)
  for (let i = 0; i < 25; i++) {
    const lon = -8.6155 + i * 0.0005;
    for (const span of spans) {
      const dLat = (span * 1.44 * 0.5) / 111320.0;
      const dLon = (span * 1.44 * 0.5) / (111320.0 * cosLat);
      const r = stitchRel3688750ForBBox(
        portoMap4,
        portoBlds4,
        baseLat - dLat,
        lon - dLon,
        baseLat + dLat,
        lon + dLon,
        span
      );
      total++;
      if (r.outerPolys.length >= 1 && r.waterAreaPct > 9.5 && r.polyAreas.every(a => a > 0.05)) {
        passed++;
      }
    }
  }

  assert.ok(total >= 100, `Expected >= 100 sweep bboxes, ran ${total}`);
  assert.equal(passed, total, `Expected 100% pass across ${total} shifted Rio Douro bboxes, got ${passed}/${total}`);
});

test('FM2: Simulated missing Miragaia 8m+2m micro-ways (way/1528553770 & way/1528553771) inside rel/3688750 bridges North Bank cleanly', async () => {
  // Build complete vs gapped Miragaia North Bank on top of real cached rel/3688750:
  // In rel/3688750, way/220479196 starts at [41.1456022, -8.6303254] (east side of Miragaia step),
  // way/1528553771 (2m) + way/1528553770 (8m) connect to [41.1455213, -8.6304197],
  // way/1553446057 continues west along North Bank to [41.1483531, -8.6391831],
  // and way/1553446058 closes the western mouth to way/321938362[0] ([41.1464773, -8.6393177]).
  const w220 = portoMap4.get('way/220479196');
  const w321 = portoMap4.get('way/321938362');
  assert.ok(w220 && w220.nodes.length > 10, 'Expected way/220479196 in Porto chunks');
  assert.ok(w321 && w321.nodes.length > 10, 'Expected way/321938362 in Porto chunks');
  const eastMiragaiaNid = w220.nodes[0];
  const southMouthNid = w321.nodes[0];
  const eastMiragaiaNode = portoMap4.get(`node/${eastMiragaiaNid}`);
  assert.ok(eastMiragaiaNode, 'Expected starting node of way/220479196');

  const buildMiragaiaMap = (includeMicroWays) => {
    const m = new Map(portoMap4);
    const nMidId = 990000001;
    const nWestGapId = 990000002;
    const nWestFar1 = 990000003;
    const nWestFar2 = 990000004;

    // Intermediate node 2m SW of eastMiragaiaNode, and west gap node ~10m further SW ([41.1455213, -8.6304197])
    m.set(`node/${nMidId}`, { type: 'node', id: nMidId, lat: 41.1455880, lon: -8.6303420 });
    m.set(`node/${nWestGapId}`, { type: 'node', id: nWestGapId, lat: 41.1455213, lon: -8.6304197 });
    m.set(`node/${nWestFar1}`, { type: 'node', id: nWestFar1, lat: 41.1468500, lon: -8.6348000 });
    m.set(`node/${nWestFar2}`, { type: 'node', id: nWestFar2, lat: 41.1483531, lon: -8.6391831 });

    // Western North Bank continuation way/1553446057 & mouth closure way/1553446058 (members of rel/3688750)
    m.set('way/1553446057', {
      type: 'way',
      id: 1553446057,
      nodes: [nWestFar2, nWestFar1, nWestGapId],
    });
    m.set('way/1553446058', {
      type: 'way',
      id: 1553446058,
      nodes: [nWestFar2, southMouthNid],
    });

    if (includeMicroWays) {
      m.set('way/1528553770', {
        type: 'way',
        id: 1528553770,
        nodes: [nWestGapId, nMidId],
      });
      m.set('way/1528553771', {
        type: 'way',
        id: 1528553771,
        nodes: [nMidId, eastMiragaiaNid],
      });
    } else {
      m.delete('way/1528553770');
      m.delete('way/1528553771');
    }
    return m;
  };

  const fullMap = buildMiragaiaMap(true);
  const gappedMap = buildMiragaiaMap(false);

  const mLat = 41.1445, mLon = -8.6285;
  const cosLat = Math.cos((mLat * Math.PI) / 180.0);

  for (const span of [1200, 1350, 1500]) {
    const dLat = (span * 1.44 * 0.5) / 111320.0;
    const dLon = (span * 1.44 * 0.5) / (111320.0 * cosLat);
    const fullRes = stitchRel3688750ForBBox(
      fullMap, portoBlds4, mLat - dLat, mLon - dLon, mLat + dLat, mLon + dLon, span
    );
    const gapRes = stitchRel3688750ForBBox(
      gappedMap, portoBlds4, mLat - dLat, mLon - dLon, mLat + dLat, mLon + dLon, span
    );

    assert.equal(gapRes.outerPolys.length, 1, `Expected 1 bridged Rio Douro polygon at Miragaia span=${span}m`);
    assert.ok(
      gapRes.waterAreaPct > 11.5,
      `Expected >11.5% water area after bridging Miragaia gap at span=${span}m, got ${gapRes.waterAreaPct.toFixed(2)}%`
    );
    const areaRatio = gapRes.totalWaterArea / fullRes.totalWaterArea;
    assert.ok(
      areaRatio > 0.99 && areaRatio < 1.01,
      `Bridged Miragaia river area should match complete river within 1% (ratio=${areaRatio.toFixed(4)})`
    );
  }

  // Also guard against false bridging across an obstacle / inner island chain
  const cityBlds = [];
  for (let x = -70; x <= 70; x += 10) {
    cityBlds.push([x, 50]);
    cityBlds.push([x, -50]);
  }
  const nodes = new Map([
    [1, [-90, 20]], [2, [-1.8, 20]],
    [3, [1.8, 20]], [4, [90, 20]],
    [5, [-90, -20]], [6, [90, -20]],
    // Inner obstacle wall directly bisecting (-1.8, 20) -> (1.8, 20)
    [10, [-0.4, 15]], [11, [-0.4, 25]], [12, [0.4, 25]], [13, [0.4, 15]],
  ]);
  const unblockedRes = stitchClippedMultipolygonRingsJS(
    [[1, 2], [3, 4], [5, 6]],
    [],
    (ids) => ids.map(id => nodes.get(id)).filter(Boolean),
    80,
    80,
    { isWater: true, buildingSamplePts: cityBlds }
  );
  assert.equal(unblockedRes.outerPolys.length, 1, 'Unobstructed 3.6-unit bank gap bridges cleanly');

  const blockedRes = stitchClippedMultipolygonRingsJS(
    [[1, 2], [3, 4], [5, 6]],
    [[10, 11, 12, 13, 10]],
    (ids) => ids.map(id => nodes.get(id)).filter(Boolean),
    80,
    80,
    { isWater: true, buildingSamplePts: cityBlds }
  );
  // Because the inner loop blocks the (-1.8,20)->(1.8,20) bridge, the broken north bank is NOT bridged across the inner loop
  assert.equal(blockedRes.outerPolys.length, 0, 'Bridge segment intersecting an inner island loop must be rejected');
});

test('FM2: stitchCoastlineSeaPolysJS recovers ocean polygon across ~15m directed interior gap while keeping CCW islands intact', () => {
  const halfW = 84.6, halfH = 84.6;
  // At 1200m span, 169.2 units = 1200m -> 15m ~= 2.115 scene units (< 3.5 threshold).
  // Mainland coastline runs North -> South (y: +90 -> -90): land on LEFT (+x East), water on RIGHT (-x West)!
  const unbrokenMainland = [
    [[0, 90], [2, 45], [0, 1.06], [0, -1.06], [-2, -45], [0, -90]],
  ];
  const gappedMainland = [
    [[0, 90], [2, 45], [0, 1.06]],
    [[0, -1.06], [-2, -45], [0, -90]],
  ];

  // Closed CCW island inside the western sea (x in [-55, -35], y in [-15, 15]):
  // CCW in (+x East, +y North) has signed area > 0 -> dry land island!
  const ccwClosedIsland = [
    [-55, -15], [-35, -15], [-35, 15], [-55, 15], [-55, -15],
  ];

  // Multi-way Logo-Island-style CCW island missing one short segment in the sea (x in [-50, -38], y in [35, 47]):
  const ccwIncompleteIsland = [
    [-50, 35], [-38, 35], [-38, 47], [-50, 47],
  ];

  const refWater = [];
  stitchCoastlineSeaPolysJS([...unbrokenMainland, ccwClosedIsland, ccwIncompleteIsland], halfW, halfH, refWater);
  assert.equal(refWater.length, 1, 'Reference unbroken coastline should emit 1 sea polygon');

  const gappedWater = [];
  stitchCoastlineSeaPolysJS([...gappedMainland, ccwClosedIsland, ccwIncompleteIsland], halfW, halfH, gappedWater);
  assert.equal(gappedWater.length, 1, 'Coastline with ~15m directed interior gap should recover 1 sea polygon');

  const refArea = Math.abs(polyAreaSignedJS(refWater[0].outer));
  const recArea = Math.abs(polyAreaSignedJS(gappedWater[0].outer));
  assert.ok(
    Math.abs(recArea - refArea) / refArea < 0.005,
    `Recovered ocean area (${recArea.toFixed(1)}) should match unbroken ocean area (${refArea.toFixed(1)})`
  );
  assert.equal(
    gappedWater[0].holes.length,
    2,
    `Both closed CCW island and Logo-Island-style CCW island must remain dry holes in sea polygon (got ${gappedWater[0].holes.length})`
  );
  assert.ok(
    pointInPolyLocal(-45, 0, gappedWater[0].holes[0]) || pointInPolyLocal(-45, 0, gappedWater[0].holes[1]),
    'Primary CCW island interior (-45, 0) must remain inside a dry island hole'
  );
  assert.ok(
    pointInPolyLocal(-44, 41, gappedWater[0].holes[0]) || pointInPolyLocal(-44, 41, gappedWater[0].holes[1]),
    'Secondary CCW island interior (-44, 41) must remain inside a dry island hole'
  );

  // Verify opposing direction (exit facing exit, violating OSM land-on-left) is NEVER bridged
  const opposingWater = [];
  const opposingCoast = [
    [[0, 90], [2, 45], [0, 1.06]],
    [[0, -90], [-2, -45], [0, -1.06]], // Reversed! Both end at (0, +-1.06)
  ];
  stitchCoastlineSeaPolysJS(opposingCoast, halfW, halfH, opposingWater);
  assert.equal(opposingWater.length, 0, 'Opposing coastline exits must never be bridged backwards');
});
