import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

require(path.join(ROOT, 'src/vendor/vendor_bundle.js'));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/print_physics_config.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/sla_print_laws.js')));
const core = require(path.join(ROOT, 'src/geometry/manifold_core.js'));
const { buildLayer1TerrainAndWater } = require(path.join(ROOT, 'src/mesh/layer1_terrain_water.js'));
const { buildDelatinTerrainManifold, buildLayer1WaterAndCarve } = require(path.join(ROOT, 'src/mesh/terrain_delatin_water.js'));
const { buildComplete3DModel } = require(path.join(ROOT, 'src/mesh/mesh_builder.js'));

await core.ensureManifoldLibAsync();

function rectRing(cx, cy, hx, hy) {
  return [
    [cx - hx, cy - hy],
    [cx + hx, cy - hy],
    [cx + hx, cy + hy],
    [cx - hx, cy + hy],
  ];
}

function makeState(overrides = {}) {
  return {
    targetWidthCm: 28,
    targetHeightCm: 28,
    bedSizeMm: 280,
    totalHeightMm: 280,
    bedZ: 165,
    tileCols: 1,
    tileRows: 1,
    kerfMm: 0.08,
    isResin: true,
    xyPixelMm: 0.017,
    layerHeightMm: 0.05,
    hollowBase: false,
    waterCutout: false,
    showFrame: false,
    supportlessMode: false,
    cropRatio: 1.0,
    zScale: 1.0,
    terrainScale: 1.0,
    lodSettings: { enableTrees: false, treeMaxSpanKm: 5, minBuildingFootprintM: 0, roadDetail: 'all' },
    layerVisible: { water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true },
    elementVisible: { water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true },
    colors: { water: '#1e6e8c', base: '#f1efe8', greenery: '#5a944a', trees: '#3d7033', roads: '#7c7b77', buildings: '#fafaf6', highlighted: '#e65100' },
    ...overrides,
  };
}

function triNormal(t) {
  const ux = t.v1[0] - t.v0[0], uy = t.v1[1] - t.v0[1], uz = t.v1[2] - t.v0[2];
  const vx = t.v2[0] - t.v0[0], vy = t.v2[1] - t.v0[1], vz = t.v2[2] - t.v0[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function triCentroid(t) {
  return [
    (t.v0[0] + t.v1[0] + t.v2[0]) / 3,
    (t.v0[1] + t.v1[1] + t.v2[1]) / 3,
    (t.v0[2] + t.v1[2] + t.v2[2]) / 3,
  ];
}

function assertCleanManifold(pm, label) {
  assert.ok(pm, `${label}: printMetrics present`);
  assert.equal(pm.isWatertightManifold, true, `${label}: isWatertightManifold must be true`);
  assert.equal(pm.openEdgesCount, 0, `${label}: openEdgesCount must be 0`);
  assert.equal(pm.nonManifoldEdgesCount, 0, `${label}: nonManifoldEdgesCount must be 0`);
  assert.equal(pm.sameDirDupEdgesCount, 0, `${label}: sameDirDupEdgesCount must be 0`);
}

// ============================================================================
// 1. FM4 — Porto Foz do Douro / Ribeira da Granja L-Shaped Seam Regression
// ============================================================================
test('FM4: Porto Foz do Douro / Ribeira da Granja estuary + axial river + 90-deg tributary seam regression', () => {
  // Grid 33x33 over [-60.4..60.4]:
  // - Wide Estuário do Rio Douro spans y in [-24, +14], x in [-60, +35] (DEM = 0m inside estuary)
  // - Upstream East gorge (x > 35) rises up to 110m; South bank (y < -24) rises up to 65m (Foz / Ribeira da Granja hillside)
  const N = 33;
  const grid = Array.from({ length: N }, (_, r) => {
    const wy = -60.4 + (r / (N - 1)) * 120.8;
    return Array.from({ length: N }, (__, c) => {
      const wx = -60.4 + (c / (N - 1)) * 120.8;
      if (wx <= 35 && wy >= -24 && wy <= 14) return 0.0; // Hydro-flattened Douro estuary
      if (wx > 35 && wy >= -12 && wy <= 12) {
        return ((wx - 35) / 25.4) * 95.0; // Upstream gorge rising East
      }
      if (wy < -24) {
        return Math.min(65.0, ((-24 - wy) / 36.4) * 65.0); // South hillside (Ribeira da Granja)
      }
      return Math.min(75.0, ((wy - 14) / 46.4) * 75.0); // North Porto hillside
    });
  });

  // Estuary areal polygon covers [-62..35] x [-24..14]
  const estuaryOuter = rectRing(-13.5, -5.0, 48.5, 19.0);

  const scene = {
    center: [41.14537, -8.65129],
    bounds: { widthM: 800, heightM: 800 },
    halfW: 60,
    halfH: 60,
    metersToUnits: 60 / 400,
    dem: { minElev: 0, maxElev: 95, gridSize: N, grid },
    waterPolys: [{ outer: estuaryOuter, holes: [], name: 'Estuário do Rio Douro' }],
    waterLines: [
      // Axial Rio Douro way starting upstream in steep gorge (x=58, DEM ~86m) and terminating mid-estuary at (-15, -5)
      {
        pts: [[58, -2], [44, -3], [35, -4], [15, -5], [-15, -5]],
        width: 5.0,
        waterway: 'river',
        name: 'Rio Douro',
      },
      // Ribeira da Granja: descends down South hillside (y=-56 -> y=-24) and then shoots 90° across 215m of open estuary to (-15, -5)!
      {
        pts: [[5, -56], [5, -40], [5, -24], [5, -5], [-15, -5]],
        width: 2.2,
        waterway: 'stream',
        name: 'Ribeira da Granja',
      },
    ],
    greenery: [],
    roads: [],
    buildings: [],
    treePoints: [],
    treeRows: [],
    bridgePolys: [],
  };

  const state = makeState({ waterCutout: false });
  const ctx = core.createBuildContext(scene, state);
  const built = buildComplete3DModel(scene, state);
  assertCleanManifold(built.printMetrics, 'Porto Foz do Douro scene');

  const waterTris = built.meshes.water;
  assert.ok(waterTris.length > 0, 'Water mesh emitted');

  // Inspect all water triangles strictly inside the open estuary interior (away from outer bank walls: x in [-56, 31], y in [-21, 11])
  let trisAboveWaterTop = 0;
  let internalStepWallTris = 0;
  let nonFlatTopNormals = 0;
  let estuaryTopTriCount = 0;

  for (const t of waterTris) {
    const [cx, cy, cz] = triCentroid(t);
    const inEstuaryInterior = cx >= -56 && cx <= 31 && cy >= -21 && cy <= 11;
    if (!inEstuaryInterior) continue;

    const maxVZ = Math.max(t.v0[2], t.v1[2], t.v2[2]);
    const minVZ = Math.min(t.v0[2], t.v1[2], t.v2[2]);
    if (maxVZ > ctx.zWaterTop + 1e-4) {
      trisAboveWaterTop++;
    }
    const n = triNormal(t);
    // Any internal vertical/sloped wall inside the estuary (not bottom face nz ~ -1 and not top face nz ~ +1)
    if (Math.abs(n[2]) < 0.999) {
      internalStepWallTris++;
    }
    if (cz > (ctx.zWaterTop + ctx.zWaterCarveFloor) * 0.5 && minVZ > ctx.zWaterCarveFloor + 1e-4) {
      estuaryTopTriCount++;
      if (Math.abs(n[0]) > 1e-4 || Math.abs(n[1]) > 1e-4 || n[2] < 0.9999) {
        nonFlatTopNormals++;
      }
    }
  }

  assert.ok(estuaryTopTriCount >= 2, `Expected top water triangles in estuary, got ${estuaryTopTriCount}`);
  assert.equal(trisAboveWaterTop, 0, `Estuary interior must have ZERO triangles above zWaterTop (${ctx.zWaterTop.toFixed(4)}), got ${trisAboveWaterTop}`);
  assert.equal(internalStepWallTris, 0, `Estuary interior must have ZERO internal vertical/sloped step walls, got ${internalStepWallTris}`);
  assert.equal(nonFlatTopNormals, 0, `Estuary top surface must have 100% smooth [0, 0, 1] normals, got ${nonFlatTopNormals} non-flat`);

  // Also verify that the genuine upland tributary on the South hillside (at exact point (5, -48)) IS preserved and recessed below bankZ!
  let uplandStreamZAt48 = -Infinity;
  for (const t of waterTris) {
    const [a, b, c] = [t.v0, t.v1, t.v2];
    const denom = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denom) < 1e-10) continue;
    const w1 = ((b[1] - c[1]) * (5 - c[0]) + (c[0] - b[0]) * (-48 - c[1])) / denom;
    const w2 = ((c[1] - a[1]) * (5 - c[0]) + (a[0] - c[0]) * (-48 - c[1])) / denom;
    const w3 = 1 - w1 - w2;
    if (w1 >= -1e-4 && w2 >= -1e-4 && w3 >= -1e-4) {
      uplandStreamZAt48 = Math.max(uplandStreamZAt48, w1 * a[2] + w2 * b[2] + w3 * c[2]);
    }
  }
  const hillsideBankZ = ctx.getTerrainZ(5, -48);
  assert.ok(
    uplandStreamZAt48 > ctx.zWaterTop + 0.5 && uplandStreamZAt48 <= hillsideBankZ - 0.22 / ctx.scaleMm + 1e-3,
    `Upland tributary at (5, -48) slopes naturally below terrain bank (streamZ=${uplandStreamZAt48.toFixed(3)}, bankZ=${hillsideBankZ.toFixed(3)}, waterTop=${ctx.zWaterTop.toFixed(3)})`
  );

  // Verify shoreline mouth (x = 5, y in [-25.5, -23.5]) transitions smoothly down to zWaterTop without a +0.42..+1.1mm cliff
  let mouthMaxZ = -Infinity;
  for (const t of waterTris) {
    const [cx, cy] = triCentroid(t);
    if (Math.abs(cx - 5) < 1.5 && cy >= -25.0 && cy <= -23.5) {
      mouthMaxZ = Math.max(mouthMaxZ, t.v0[2], t.v1[2], t.v2[2]);
    }
  }
  assert.ok(
    mouthMaxZ <= ctx.zWaterTop + 1e-3,
    `Tributary mouth at estuary shoreline anchors smoothly to zWaterTop (mouthMaxZ=${mouthMaxZ.toFixed(4)} vs zWaterTop=${ctx.zWaterTop.toFixed(4)})`
  );
});

// ============================================================================
// 2. FM4 — Singapore Marina Bay / Bridge DSM Spike Regression
// ============================================================================
test('FM4: Singapore Marina Bay areal water crossed by waterway=river over +15m bridge DSM bump stays 100% flat', () => {
  const N = 33;
  // Flat city (3m land, 0m bay) EXCEPT a +15m bridge DSM ridge across x in [-4, +4], y in [-35, +35]
  const grid = Array.from({ length: N }, (_, r) => {
    const wy = -60.4 + (r / (N - 1)) * 120.8;
    return Array.from({ length: N }, (__, c) => {
      const wx = -60.4 + (c / (N - 1)) * 120.8;
      if (Math.abs(wx) <= 5.0 && Math.abs(wy) <= 30.0) return 15.0; // Bridge DSM bump over Marina Bay!
      if (Math.abs(wx) <= 42.0 && Math.abs(wy) <= 28.0) return 0.0; // Marina Bay water pixels
      return 3.5; // Surrounding Marina promenade
    });
  });

  const bayOuter = rectRing(0, 0, 42, 28);
  const scene = {
    center: [1.286, 103.854],
    bounds: { widthM: 640, heightM: 640 },
    halfW: 60,
    halfH: 60,
    metersToUnits: 60 / 320,
    dem: { minElev: 0, maxElev: 15, gridSize: N, grid },
    waterPolys: [{ outer: bayOuter, holes: [], name: 'Marina Bay' }],
    waterLines: [
      // Axial river starting slightly upstream outside the bay (-54, 0), entering the bay, and crossing the +15m bridge DSM spike!
      {
        pts: [[-54, 0], [-42, 0], [-20, 0], [0, 0], [20, 0], [38, 0]],
        width: 4.0,
        waterway: 'river',
        name: 'Singapore River',
      },
      // Standalone lowland canal (outside bay, y = 44) also crossing a narrow +15m bridge DSM spike at x = 0!
      {
        pts: [[-48, 44], [-24, 44], [0, 44], [24, 44], [48, 44]],
        width: 3.0,
        waterway: 'canal',
        name: 'Rochor Canal',
      },
    ],
    greenery: [],
    roads: [],
    buildings: [],
    treePoints: [],
    treeRows: [],
    bridgePolys: [],
  };
  // Put a +15m DSM bridge bump across Rochor Canal at (0, 44) too
  for (let r = 0; r < N; r++) {
    const wy = -60.4 + (r / (N - 1)) * 120.8;
    if (Math.abs(wy - 44) <= 4.5) {
      for (let c = 0; c < N; c++) {
        const wx = -60.4 + (c / (N - 1)) * 120.8;
        if (Math.abs(wx) <= 4.5) grid[r][c] = 15.0;
      }
    }
  }

  const state = makeState({ waterCutout: false });
  const ctx = core.createBuildContext(scene, state);
  const built = buildComplete3DModel(scene, state);
  assertCleanManifold(built.printMetrics, 'Singapore Marina Bay + Bridge DSM scene');

  // Check Marina Bay interior: 100% flat at zWaterTop
  let bayMaxZ = -Infinity;
  let bayStepWalls = 0;
  for (const t of built.meshes.water) {
    const [cx, cy] = triCentroid(t);
    if (Math.abs(cx) <= 39 && Math.abs(cy) <= 25) {
      bayMaxZ = Math.max(bayMaxZ, t.v0[2], t.v1[2], t.v2[2]);
      const n = triNormal(t);
      if (Math.abs(n[2]) < 0.999) bayStepWalls++;
    }
  }
  assert.ok(
    Math.abs(bayMaxZ - ctx.zWaterTop) <= 1e-4,
    `Marina Bay water maxZ must equal zWaterTop (${ctx.zWaterTop.toFixed(4)}), got ${bayMaxZ.toFixed(4)}`
  );
  assert.equal(bayStepWalls, 0, `Zero internal step walls inside Marina Bay, got ${bayStepWalls}`);

  // Also verify standalone Rochor Canal at (0, 44) did NOT spike up to +15m over the bridge DSM bump!
  let canalBridgeMaxZ = -Infinity;
  const spike15mZ = ctx.elevToZ(15.0) - 0.25 / ctx.scaleMm;
  for (const t of built.meshes.water) {
    const [cx, cy] = triCentroid(t);
    if (Math.abs(cx) <= 8 && Math.abs(cy - 44) <= 4) {
      canalBridgeMaxZ = Math.max(canalBridgeMaxZ, t.v0[2], t.v1[2], t.v2[2]);
    }
  }
  assert.ok(
    canalBridgeMaxZ < spike15mZ - 1.5,
    `Standalone canal crossing +15m bridge DSM bump suppressed DSM spike (canalMaxZ=${canalBridgeMaxZ.toFixed(3)} << spikeZ=${spike15mZ.toFixed(3)})`
  );
});

// ============================================================================
// 3. FM6 — Warsaw Vistula / Munich Isar Island & Gravel Shoal Preservation
// ============================================================================
test('FM6: Sloped waterway=river centerline crossing river island hole & gravel shoal leaves islands 100% uncarved', () => {
  // Sloped river valley: South (y=-60) at 45m descending to North (y=+60) at 0m
  const N = 25;
  const grid = Array.from({ length: N }, (_, r) => {
    const t = 1 - r / (N - 1); // South=1 -> North=0
    const valleyElev = t * 45.0;
    return Array.from({ length: N }, (__, c) => {
      const wx = -60.4 + (c / (N - 1)) * 120.8;
      // Inside river channel |wx| <= 22, river is hydro-flattened at 0m EXCEPT on the island (|wx|<=10, |wy|<=14) at 8m
      const wy = -60.4 + (r / (N - 1)) * 120.8;
      if (Math.abs(wx) <= 10 && Math.abs(wy) <= 14) return 8.0; // Museumsinsel / Vistula island dry ground
      if (Math.abs(wx) <= 22 && wy > -35) return 0.0; // Areal river reach
      return Math.max(6.0, valleyElev);
    });
  });

  const mainIslandHole = rectRing(0, 0, 10, 14); // Multipolygon inner island (e.g. Museumsinsel / Warsaw island)
  const shingleShoal = rectRing(0, 26, 6, 5);    // natural=shingle gravel bar shoal

  const scene = {
    center: [48.131, 11.585],
    bounds: { widthM: 640, heightM: 640 },
    halfW: 60,
    halfH: 60,
    metersToUnits: 60 / 320,
    dem: { minElev: 0, maxElev: 45, gridSize: N, grid },
    waterPolys: [
      {
        outer: rectRing(0, 12, 22, 46), // Covers y in [-34, +58]
        holes: [mainIslandHole],
        _unrotatedShingleRings: [shingleShoal],
        name: 'Isar / Wisła',
      },
    ],
    waterLines: [
      // Sloped river centerline starts upstream in narrow mountain gorge (y=-58, 45m) and runs STRAIGHT through both islands!
      {
        pts: [[0, -58], [0, -44], [0, -34], [0, -14], [0, 0], [0, 14], [0, 26], [0, 56]],
        width: 6.0,
        waterway: 'river',
        name: 'Isar',
      },
    ],
    greenery: [],
    roads: [],
    buildings: [
      { id: 1, osmId: 7701, outer: rectRing(0, 0, 4.5, 6.0), holes: [], h: 16, minH: 0, roof: 'flat' },
    ],
    treePoints: [],
    treeRows: [],
    bridgePolys: [],
  };

  const state = makeState({ waterCutout: false });
  const ctx = core.createBuildContext(scene, state);
  const tw = buildLayer1TerrainAndWater(ctx, scene);

  // 1) Neither the main island nor the shingle shoal may be classified as water in 2D mask
  assert.equal(tw.isPointInWater(0, 0), false, 'Main island center (0, 0) must be dry land');
  assert.equal(tw.isPointInWater(0, -10), false, 'Main island south (0, -10) must be dry land');
  assert.equal(tw.isPointInWater(0, 10), false, 'Main island north (0, 10) must be dry land');
  assert.equal(tw.isPointInWater(0, 26), false, 'Shingle shoal center (0, 26) must be dry land');

  // 2) Full 3D model build must keep 0 water triangles inside both island interiors and 0 floating buildings
  const built = buildComplete3DModel(scene, state);
  assertCleanManifold(built.printMetrics, 'Warsaw/Munich island preservation scene');
  assert.equal(built.printMetrics.floatingBuildingsCount, 0, 'Building on island is solidly grounded');

  let waterTrisInMainIsland = 0;
  let waterTrisInShingle = 0;
  for (const t of built.meshes.water) {
    const [cx, cy] = triCentroid(t);
    if (Math.abs(cx) < 9.5 && Math.abs(cy) < 13.5) waterTrisInMainIsland++;
    if (Math.abs(cx) < 5.5 && Math.abs(cy - 26) < 4.5) waterTrisInShingle++;
  }
  assert.equal(waterTrisInMainIsland, 0, `Zero water triangles inside main island hole, got ${waterTrisInMainIsland}`);
  assert.equal(waterTrisInShingle, 0, `Zero water triangles inside shingle shoal, got ${waterTrisInShingle}`);

  // Verify terrain on main island was NOT carved down to water floor (stays above zLandDatum)
  let maxIslandTerrainZ = -Infinity;
  for (const t of built.meshes.base) {
    const [cx, cy] = triCentroid(t);
    if (Math.abs(cx) < 8.0 && Math.abs(cy) < 11.0) {
      maxIslandTerrainZ = Math.max(maxIslandTerrainZ, t.v0[2], t.v1[2], t.v2[2]);
    }
  }
  assert.ok(
    maxIslandTerrainZ > ctx.zLandDatum + 0.5,
    `Island terrain remains uncarved at dry elevation (maxIslandTerrainZ=${maxIslandTerrainZ.toFixed(3)} > zLandDatum=${ctx.zLandDatum.toFixed(3)})`
  );
});

// ============================================================================
// 4. FM5 — Canyon/Harbour `isEl` Stability & `queryWaterZAt` Sync
// ============================================================================
test('FM5: Canyon river & walled harbour basins stay at zWaterTop (isEl=false) while hilltop reservoir elevates & syncs queryWaterZAt', () => {
  // Part A: Steep 80m canyon river + adjacent walled dock basin (Hamburg / Porto / Bern archetype)
  {
    const N = 33;
    const canyonGrid = Array.from({ length: N }, (_, r) => {
      const wy = -60.4 + (r / (N - 1)) * 120.8;
      return Array.from({ length: N }, (__, c) => {
        const wx = -60.4 + (c / (N - 1)) * 120.8;
        // Narrow hydro-flattened canyon interior |wy| <= 6 at 0m, while polygon banks at |wy| = 12 sit on steep 80m canyon cliffs!
        if (Math.abs(wy) <= 6.0) return 0.0;
        // Adjacent walled dock basin centered at (25, 30), interior |wx-25|<=8, |wy-30|<=6 at 0m, quay walls at 12m
        if (Math.abs(wx - 25) <= 8.0 && Math.abs(wy - 30) <= 6.0) return 0.0;
        if (Math.abs(wx - 25) <= 13.0 && Math.abs(wy - 30) <= 11.0) return 12.0;
        return 80.0; // Steep 80m gorge cliffs on both banks
      });
    });

    // Note: canyon river outer has y = ±12 (so ALL longitudinal boundary vertices sit on 80m cliff pixels!)
    // and walled dock outer has |x-25|<=12, |y-30|<=10 (so ALL perimeter vertices sit on 12m quay wall pixels!)
    const canyonScene = {
      center: [41.14, -8.61],
      bounds: { widthM: 640, heightM: 640 },
      halfW: 60,
      halfH: 60,
      metersToUnits: 60 / 320,
      dem: { minElev: 0, maxElev: 80, gridSize: N, grid: canyonGrid },
      waterPolys: [
        { outer: rectRing(0, 0, 62, 12), holes: [], name: 'Douro / Aare Canyon River' },
        { outer: rectRing(25, 30, 12, 10), holes: [], name: 'HafenCity Walled Dock' },
      ],
      waterLines: [],
      greenery: [],
      roads: [],
      buildings: [],
      treePoints: [],
      treeRows: [],
      bridgePolys: [],
    };

    const state = makeState({ waterCutout: false });
    const ctx = core.createBuildContext(canyonScene, state);
    const built = buildComplete3DModel(canyonScene, state);
    assertCleanManifold(built.printMetrics, 'Canyon river + walled dock scene');

    let canyonWaterMaxZ = -Infinity;
    let dockWaterMaxZ = -Infinity;
    for (const t of built.meshes.water) {
      const [cx, cy] = triCentroid(t);
      if (Math.abs(cy) <= 11) canyonWaterMaxZ = Math.max(canyonWaterMaxZ, t.v0[2], t.v1[2], t.v2[2]);
      if (Math.abs(cx - 25) <= 11 && Math.abs(cy - 30) <= 9) dockWaterMaxZ = Math.max(dockWaterMaxZ, t.v0[2], t.v1[2], t.v2[2]);
    }
    assert.ok(
      Math.abs(canyonWaterMaxZ - ctx.zWaterTop) <= 1e-4,
      `Canyon river with 80m side cliffs and 0m interior DEM stays at zWaterTop (${ctx.zWaterTop.toFixed(4)}), got ${canyonWaterMaxZ.toFixed(4)}`
    );
    assert.ok(
      Math.abs(dockWaterMaxZ - ctx.zWaterTop) <= 1e-4,
      `Walled harbour dock with 12m quay walls and 0m interior DEM stays at zWaterTop (${ctx.zWaterTop.toFixed(4)}), got ${dockWaterMaxZ.toFixed(4)}`
    );
  }

  // Part B: Genuine hilltop reservoir (+40m DEM both inside and on perimeter) vs lowland sea (0m)
  {
    const N = 33;
    const hillGrid = Array.from({ length: N }, (_, r) => {
      const wy = -60.4 + (r / (N - 1)) * 120.8;
      return Array.from({ length: N }, (__, c) => {
        const wx = -60.4 + (c / (N - 1)) * 120.8;
        if (wy < -15) return 0.0; // Lowland sea / harbour in South
        // Hilltop plateau centered at (0, 28) at +40m DEM (both inside reservoir and on surrounding rim!)
        const dHill = Math.hypot(wx - 0, wy - 28);
        if (dHill <= 22) return 40.0;
        return Math.max(0.0, 40.0 * Math.max(0, 1 - (dHill - 22) / 25));
      });
    });

    const reservoirOuter = rectRing(0, 28, 12, 9);
    const seaOuter = rectRing(0, -38, 55, 18);

    const hillScene = {
      center: [-33.935, 18.415], // Cape Town Molteno Reservoir / Monaco hilltop pond archetype
      bounds: { widthM: 640, heightM: 640 },
      halfW: 60,
      halfH: 60,
      metersToUnits: 60 / 320,
      dem: { minElev: 0, maxElev: 40, gridSize: N, grid: hillGrid },
      waterPolys: [
        { outer: seaOuter, holes: [], name: 'Table Bay' },
        { outer: reservoirOuter, holes: [], name: 'Molteno Hilltop Reservoir' },
      ],
      waterLines: [],
      greenery: [],
      roads: [],
      buildings: [],
      treePoints: [],
      treeRows: [],
      bridgePolys: [],
      pierPolys: [
        // Floating pontoon inside the hilltop reservoir to verify waterfront solver receives exact elevated water Z!
        { outer: rectRing(0, 28, 3.5, 2.0), holes: [], isPier: true, pierKind: 'pontoon', floating: true, osmId: 8801 },
      ],
      pierLines: [],
    };

    const state = makeState({ waterCutout: false });
    const ctx = core.createBuildContext(hillScene, state);
    const padU = 0.25;
    const plateClipPoly = [[[-ctx.halfW - padU, -ctx.halfH - padU], [ctx.halfW + padU, -ctx.halfH - padU], [ctx.halfW + padU, ctx.halfH + padU], [-ctx.halfW - padU, ctx.halfH + padU]]];
    const rawTerrain = buildDelatinTerrainManifold(ctx, -ctx.halfW - padU, ctx.halfW + padU, -ctx.halfH - padU, ctx.halfH + padU);
    const directRes = buildLayer1WaterAndCarve(core, ctx.mf, ctx, hillScene, rawTerrain, plateClipPoly, [], () => true);

    const expectedReservoirTopZ = ctx.elevToZ(40.0) - 0.25 / ctx.scaleMm;
    const expectedReservoirFlrZ = expectedReservoirTopZ - 0.45 / ctx.scaleMm;

    // Measure actual emitted 3D mesh topZ over reservoir (0, 28) vs lowland sea (0, -38)
    const built = buildComplete3DModel(hillScene, state);
    assertCleanManifold(built.printMetrics, 'Hilltop reservoir + lowland sea scene');

    let meshReservoirTopZ = -Infinity;
    let meshSeaTopZ = -Infinity;
    for (const t of built.meshes.water) {
      const [cx, cy] = triCentroid(t);
      if (Math.abs(cx) <= 11 && Math.abs(cy - 28) <= 8) {
        meshReservoirTopZ = Math.max(meshReservoirTopZ, t.v0[2], t.v1[2], t.v2[2]);
      }
      if (Math.abs(cx) <= 40 && Math.abs(cy + 38) <= 15) {
        meshSeaTopZ = Math.max(meshSeaTopZ, t.v0[2], t.v1[2], t.v2[2]);
      }
    }

    assert.ok(
      meshReservoirTopZ > ctx.zWaterTop + 5.0 && Math.abs(meshReservoirTopZ - expectedReservoirTopZ) <= 1e-3,
      `Hilltop reservoir elevates cleanly to ${expectedReservoirTopZ.toFixed(4)} (got ${meshReservoirTopZ.toFixed(4)})`
    );
    assert.ok(
      Math.abs(meshSeaTopZ - ctx.zWaterTop) <= 1e-4,
      `Lowland sea in same scene stays at zWaterTop (${ctx.zWaterTop.toFixed(4)}), got ${meshSeaTopZ.toFixed(4)}`
    );

    // Verify queryWaterZAt(cx, cy) matches exact mesh topZ and flrZ!
    const qTopReservoir = directRes.queryWaterZAt(0, 28, false);
    const qFlrReservoir = directRes.queryWaterZAt(0, 28, true);
    const qTopSea = directRes.queryWaterZAt(0, -38, false);
    assert.ok(
      Math.abs(qTopReservoir - meshReservoirTopZ) <= 1e-5,
      `queryWaterZAt(0, 28, false) must equal exact meshReservoirTopZ (${meshReservoirTopZ.toFixed(5)}), got ${qTopReservoir.toFixed(5)}`
    );
    assert.ok(
      Math.abs(qFlrReservoir - expectedReservoirFlrZ) <= 1e-5,
      `queryWaterZAt(0, 28, true) must equal exact reservoir flrZ (${expectedReservoirFlrZ.toFixed(5)}), got ${qFlrReservoir.toFixed(5)}`
    );
    assert.ok(
      Math.abs(qTopSea - ctx.zWaterTop) <= 1e-5,
      `queryWaterZAt(0, -38, false) over lowland sea must equal zWaterTop (${ctx.zWaterTop.toFixed(5)}), got ${qTopSea.toFixed(5)}`
    );

    // Verify pontoon inside hilltop reservoir sits ON the elevated reservoir surface (not 30mm underwater at zWaterTop!)
    const pontoonAudit = (built.audit.pierAudits || []).find(a => a.osmId === 8801);
    assert.ok(
      pontoonAudit && Math.abs(pontoonAudit.waterTopZ - meshReservoirTopZ) <= 1e-3 && pontoonAudit.deckTopZ > meshReservoirTopZ,
      `Pontoon on hilltop reservoir resolves elevated waterTopZ (${pontoonAudit ? pontoonAudit.waterTopZ.toFixed(3) : 'none'} vs ${meshReservoirTopZ.toFixed(3)})`
    );

    core.safeDeleteManifold(directRes.terrainManifold);
    core.safeDeleteManifold(directRes.waterManifold);
  }
});

// ============================================================================
// 5. FM5 — Narrow S-Bend Gorge River (Bern Aare Archetype) Scanline Stability
// ============================================================================
test('FM5: Narrow curved S-bend canyon river (Bern Aare) with +55m bank cliffs & 0m channel stays flat at zWaterTop', () => {
  const N = 41;
  // Centerline x_center(y) = 22 * sin(y / 18), channel half-width = 6u; DEM is 0m within 3u of centerline, +55m beyond 5.5u
  const xCenter = (wy) => 22.0 * Math.sin(wy / 18.0);
  const grid = Array.from({ length: N }, (_, r) => {
    const wy = -60.4 + (r / (N - 1)) * 120.8;
    const xc = xCenter(wy);
    return Array.from({ length: N }, (__, c) => {
      const wx = -60.4 + (c / (N - 1)) * 120.8;
      const d = Math.abs(wx - xc);
      if (d <= 3.0) return 0.0;
      if (d >= 5.5) return 55.0;
      return ((d - 3.0) / 2.5) * 55.0;
    });
  });

  // Build curved river polygon outer ring of half-width 6.2u (so left/right banks sit right on the +55m gorge cliffs!)
  const leftBank = [], rightBank = [];
  for (let s = 0; s <= 32; s++) {
    const wy = -56 + (s / 32) * 112;
    const xc = xCenter(wy);
    leftBank.push([xc - 6.2, wy]);
    rightBank.push([xc + 6.2, wy]);
  }
  const sBendOuter = [...rightBank, ...leftBank.reverse()];

  const scene = {
    center: [46.948, 7.452],
    bounds: { widthM: 640, heightM: 640 },
    halfW: 60,
    halfH: 60,
    metersToUnits: 60 / 320,
    dem: { minElev: 0, maxElev: 55, gridSize: N, grid },
    waterPolys: [{ outer: sBendOuter, holes: [], name: 'Aare' }],
    waterLines: [
      { pts: Array.from({ length: 17 }, (_, i) => { const wy = -56 + (i / 16) * 112; return [xCenter(wy), wy]; }), width: 4.0, waterway: 'river' },
    ],
    greenery: [], roads: [], buildings: [], treePoints: [], treeRows: [], bridgePolys: [],
  };

  const state = makeState({ waterCutout: false });
  const ctx = core.createBuildContext(scene, state);
  const built = buildComplete3DModel(scene, state);
  assertCleanManifold(built.printMetrics, 'Bern Aare S-bend canyon scene');

  let maxWaterZ = -Infinity;
  for (const t of built.meshes.water) {
    maxWaterZ = Math.max(maxWaterZ, t.v0[2], t.v1[2], t.v2[2]);
  }
  assert.ok(
    Math.abs(maxWaterZ - ctx.zWaterTop) <= 1e-4,
    `Bern Aare S-bend gorge water stays flat at zWaterTop (${ctx.zWaterTop.toFixed(4)}), got ${maxWaterZ.toFixed(4)}`
  );
});

// ============================================================================
// 6. FM4 + FM5 + FM6 — Alpine Tributary Entering Elevated Lake & Nested Island Pond
// ============================================================================
test('FM4+FM5+FM6: Mountain stream smoothly anchors to elevated alpine tarn & nested island pond survives sloped river', () => {
  const N = 33;
  // Scene minElev = 0m in South-West corner, alpine tarn at (0, 5) at +35m, headwater ridge in North (y=55) rising to +85m
  const grid = Array.from({ length: N }, (_, r) => {
    const wy = -60.4 + (r / (N - 1)) * 120.8;
    return Array.from({ length: N }, (__, c) => {
      const wx = -60.4 + (c / (N - 1)) * 120.8;
      if (wx < -35 && wy < -35) return 0.0; // Low valley corner setting scene effMinElev = 0m
      if (wy <= 22) return 35.0;            // Alpine tarn plateau at +35m
      return 35.0 + ((wy - 22) / 38.4) * 50.0; // Headwater slope rising from 35m (y=22) to 85m (y=60.4)
    });
  });

  const tarnOuter = rectRing(0, 0, 26, 20);
  const tarnIsland = rectRing(0, 0, 12, 10);
  const nestedIslandPond = rectRing(0, 0, 4, 3); // Strictly inside tarnIsland!

  const scene = {
    center: [49.20, 20.07],
    bounds: { widthM: 640, heightM: 640 },
    halfW: 60,
    halfH: 60,
    metersToUnits: 60 / 320,
    dem: { minElev: 0, maxElev: 85, gridSize: N, grid },
    waterPolys: [
      { outer: tarnOuter, holes: [tarnIsland], name: 'Alpine Tarn' },
      { outer: nestedIslandPond, holes: [], name: 'Nested Island Pond' },
    ],
    waterLines: [
      // Feeder stream descending from +85m North ridge into the +35m alpine tarn and crossing the island
      { pts: [[0, 56], [0, 38], [0, 20], [0, 0], [0, -18]], width: 3.2, waterway: 'stream' },
    ],
    greenery: [], roads: [], buildings: [], treePoints: [], treeRows: [], bridgePolys: [],
  };

  const state = makeState({ waterCutout: false });
  const ctx = core.createBuildContext(scene, state);
  const tw = buildLayer1TerrainAndWater(ctx, scene);
  const built = buildComplete3DModel(scene, state);
  assertCleanManifold(built.printMetrics, 'Alpine tarn + feeder stream + nested island pond scene');

  // Island ring around nested pond (e.g. at (0, 7)) stays dry, while nested pond center (0, 0) stays water!
  assert.equal(tw.isPointInWater(0, 7), false, 'Island land at (0, 7) stays dry despite sloped stream centerline');
  assert.equal(tw.isPointInWater(0, -7), false, 'Island land at (0, -7) stays dry despite sloped stream centerline');
  assert.equal(tw.isPointInWater(0, 0), true, 'Nested pond strictly inside island at (0, 0) is preserved as water');

  const expectedTarnTopZ = ctx.elevToZ(35.0) - 0.25 / ctx.scaleMm;
  // Inside the alpine tarn water ring (e.g. x=18, y=0), water sits at expectedTarnTopZ with 0 step walls
  let tarnWaterMaxZ = -Infinity;
  let tarnStepWalls = 0;
  for (const t of built.meshes.water) {
    const [cx, cy] = triCentroid(t);
    if (cx > 14 && cx < 24 && Math.abs(cy) < 16) {
      tarnWaterMaxZ = Math.max(tarnWaterMaxZ, t.v0[2], t.v1[2], t.v2[2]);
      if (Math.abs(triNormal(t)[2]) < 0.999) tarnStepWalls++;
    }
  }
  assert.ok(
    Math.abs(tarnWaterMaxZ - expectedTarnTopZ) <= 1e-3 && tarnStepWalls === 0,
    `Alpine tarn sits flat at elevated ${expectedTarnTopZ.toFixed(3)} (got ${tarnWaterMaxZ.toFixed(3)}, stepWalls=${tarnStepWalls})`
  );
  assert.ok(
    Math.abs(tw.getWaterTopZ(18, 0) - expectedTarnTopZ) <= 1e-4,
    `getWaterTopZ(18, 0) matches elevated alpine tarn topZ`
  );
});

