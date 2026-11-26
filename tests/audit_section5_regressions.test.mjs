import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

require(path.join(ROOT, 'src/vendor/vendor_bundle.js'));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/print_physics_config.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/sla_print_laws.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/export/export_io_utils.js')));
const parser = require(path.join(ROOT, 'src/gis_client/s3db_unit_parser.js'));
const relHelper = require(path.join(ROOT, 'src/gis_client/s3db_relation_helper.js'));
const matcherMod = require(path.join(ROOT, 'src/gis_client/s3db_client_matcher.js'));
Object.assign(globalThis, parser, relHelper, matcherMod);
const { finalizeOsmBuildingsLayerJS } = require(path.join(ROOT, 'src/gis_client/osm_buildings_extract.js'));
const { buildComplete3DModel } = require(path.join(ROOT, 'src/mesh/mesh_builder.js'));
const { buildFrameSegmentsCSG } = require(path.join(ROOT, 'src/mesh/frame_csg_solver.js'));
const core = require(path.join(ROOT, 'src/geometry/manifold_core.js'));

let passed = 0;
let failed = 0;

function check(cond, label, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS: ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function rectRing(cx, cy, hx, hy, deg = 0) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => [
    cx + x * c - y * s,
    cy + x * s + y * c,
  ]);
}

function makeState(overrides = {}) {
  return {
    targetWidthCm: 24, targetHeightCm: 24, bedSizeMm: 240, totalHeightMm: 165, baseHeightMm: 2.5,
    zScale: 1.0, terrainScale: 1.0, waterCutout: false, hollowBase: false, hollowWallMm: 1.8,
    showFrame: false, exportFrame: false, cropRatio: 1.0, cropCenterX: 0.0, cropCenterY: 0.0,
    tileCols: 1, tileRows: 1, isResin: true, xyPixelMm: 0.017, layerHeightMm: 0.05,
    supportlessMode: false, mapRotationDeg: 0,
    layerVisible: { water: true, base: true, greenery: true, trees: true, roads: true, buildings: true },
    ...overrides,
  };
}

console.log('================================================================');
console.log('   SECTION 5 + BONUS AUDIT REGRESSIONS VERIFICATION SUITE');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// 1. S3DB Elevated Arch / Skybridge Micro-Gap & Standalone Portal End-Piers
// ---------------------------------------------------------------------------
console.log('[1/9] S3DB Elevated Skybridge Micro-Gap & Standalone Arch Portal');
{
  const mToU = 169.2 / 400;
  const scene = {
    spanMeters: 400, metersToUnits: mToU, halfW: 84.6, halfH: 84.6,
    dem: { gridSize: 4, minElev: 2, maxElev: 2, grid: Array.from({ length: 4 }, () => Array(4).fill(2)) },
    waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [],
    buildings: [
      // Skybridge between two towers with a 0.08u (~0.19m) OSM gap between bridge ends and towers
      { id: 101, groupId: 10, part: true, outer: rectRing(-22, 16, 4.5, 4.5), holes: [], h: 42, minH: 0, roof: 'flat' },
      { id: 102, groupId: 10, part: true, outer: rectRing(22, 16, 4.5, 4.5), holes: [], h: 42, minH: 0, roof: 'flat' },
      { id: 103, groupId: 10, part: true, outer: rectRing(0, 16, 17.42, 2.0), holes: [], h: 28, minH: 20, roof: 'flat' },
      // Standalone triumphal arch / gate (min_height > 0, NO sibling pier records)
      { id: 201, groupId: 20, part: true, outer: rectRing(0, -18, 8.0, 2.5), holes: [], h: 24, minH: 13, roof: 'flat' },
    ],
  };
  const built = buildComplete3DModel(scene, makeState());
  const pm = built.printMetrics;
  check(pm.isWatertightManifold && pm.floatingBuildingsCount === 0,
    'Micro-gap skybridge + standalone arch are 100% anchored & 2-manifold', `float=${pm.floatingBuildingsCount}, open=${pm.openEdgesCount}`);

  const zTerrainTop = 2.5 / (240 / 169.2) + 0.5;
  const zSkyUnderMax = zTerrainTop + 16 * mToU;
  const brickedSkyTris = built.meshes.buildings.filter(t => {
    const cx = (t.v0[0] + t.v1[0] + t.v2[0]) / 3;
    const cy = (t.v0[1] + t.v1[1] + t.v2[1]) / 3;
    const minZ = Math.min(t.v0[2], t.v1[2], t.v2[2]);
    return Math.abs(cx) < 10 && Math.abs(cy - 16) < 4 && minZ < zSkyUnderMax;
  });
  check(brickedSkyTris.length === 0, 'Skybridge underpass stays completely open (not bricked up)', `brickedTris=${brickedSkyTris.length}`);

  const zGateUnderMax = zTerrainTop + 10 * mToU;
  const brickedGateCenterTris = built.meshes.buildings.filter(t => {
    const cx = (t.v0[0] + t.v1[0] + t.v2[0]) / 3;
    const cy = (t.v0[1] + t.v1[1] + t.v2[1]) / 3;
    const minZ = Math.min(t.v0[2], t.v1[2], t.v2[2]);
    return Math.abs(cx) < 2.2 && Math.abs(cy + 18) < 4 && minZ < zGateUnderMax;
  });
  check(brickedGateCenterTris.length === 0, 'Standalone gate central archway stays open between end piers', `centerTris=${brickedGateCenterTris.length}`);
}

// ---------------------------------------------------------------------------
// 2. Rotated 45° OBB vs AABB in s3db_relation_helper.js & osm_buildings_extract.js
// ---------------------------------------------------------------------------
console.log('\n[2/9] computeMinAreaOBB2D 0° vs 45° Rotation Invariance');
{
  const mToU = 169.2 / 420;
  const ring0 = rectRing(0, 0, 36 * mToU, 4.5 * mToU, 0);
  const ring45 = rectRing(0, 0, 36 * mToU, 4.5 * mToU, 45);
  const m0 = relHelper.computeRecordMetricsM(ring0, mToU);
  const m45 = relHelper.computeRecordMetricsM(ring45, mToU);
  check(Math.abs(m0.rawMinSpanM - 9.0) < 0.15 && Math.abs(m45.rawMinSpanM - 9.0) < 0.15,
    'computeRecordMetricsM rawMinSpanM is invariant at 45° (9m, not 57m AABB)', `m0=${m0.rawMinSpanM.toFixed(2)}m, m45=${m45.rawMinSpanM.toFixed(2)}m`);

  const col = matcherMod.createS3DBClientCollector(84.6, 84.6, mToU);
  col.registerCandidate(1, { building: 'tower', 'roof:shape': 'pyramidal' }, rectRing(-25, 0, 34 * mToU, 4.2 * mToU, 0), [], false, 1, false);
  col.registerCandidate(2, { building: 'tower', 'roof:shape': 'pyramidal' }, rectRing(25, 0, 34 * mToU, 4.2 * mToU, 45), [], false, 2, false);
  const emitted = col.resolveAndEmitS3DBBuildings();
  check(emitted.length === 2 && Math.abs(emitted[0].h - emitted[1].h) < 0.25,
    'S3DB estimated heights match between 0° and 45° rotated buildings', `h0=${emitted[0].h}m vs h45=${emitted[1].h}m`);

  const shedBlds = [
    { id: 1, outer: rectRing(0, 0, 2.0 * mToU, 1.0 * mToU, 0), holes: [], h: 10 },
    { id: 2, outer: rectRing(10, 0, 2.0 * mToU, 1.0 * mToU, 45), holes: [], h: 10 },
  ];
  const filtered = finalizeOsmBuildingsLayerJS({
    s3db: { resolveAndEmitS3DBBuildings: () => shedBlds },
    metersToUnits: mToU,
    minBldFootprintM: 4.5,
  });
  check(filtered.length === 0, 'minBldFootprintM filters small 4.0m sheds identically at 0° and 45°', `kept=${filtered.length}`);
}

// ---------------------------------------------------------------------------
// 3. C1-Continuous Height Compression above zKneeMm (Skyscraper Hierarchy)
// ---------------------------------------------------------------------------
console.log('\n[3/9] C1-Continuous Soft-Knee Height Compression above zKneeMm');
{
  const mToU = 169.2 / 480;
  const scene = {
    spanMeters: 480, metersToUnits: mToU, halfW: 84.6, halfH: 84.6,
    dem: { gridSize: 4, minElev: 4, maxElev: 4, grid: Array.from({ length: 4 }, () => Array(4).fill(4)) },
    waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [],
    buildings: [
      { id: 1, groupId: 1, part: true, outer: rectRing(-30, 0, 8, 8), holes: [], h: 160, minH: 0, roof: 'flat' },
      { id: 2, groupId: 2, part: true, outer: rectRing(0, 0, 8, 8), holes: [], h: 290, minH: 0, roof: 'flat' },
      { id: 3, groupId: 3, part: true, outer: rectRing(30, 0, 9, 9), holes: [], h: 350, minH: 0, roof: 'flat' },
      { id: 4, groupId: 3, part: true, outer: rectRing(30, 0, 5.5, 5.5), holes: [], h: 460, minH: 345, roof: 'pyramidal', roofH: 25 },
    ],
  };
  const built = buildComplete3DModel(scene, makeState({ bedSizeMm: 220, totalHeightMm: 90, zScale: 1.2 }));
  const z1 = built.buildingBounds.find(b => b.id === 1).maxZ;
  const z2 = built.buildingBounds.find(b => b.id === 2).maxZ;
  const z3Base = built.buildingBounds.find(b => b.id === 3).maxZ;
  const z3Top = built.buildingBounds.find(b => b.id === 4).maxZ;
  check(z1 < z2 - 0.5 && z2 < z3Base - 0.5 && z3Base < z3Top - 0.5,
    'Tall skyscrapers preserve strict height hierarchy & upper setback steps', `z=[${[z1, z2, z3Base, z3Top].map(v => v.toFixed(2)).join(' < ')}]`);
  check(built.printMetrics.zCapApplied === true && built.printMetrics.maxZMm <= built.printMetrics.zCapLimitMm + 0.05 && built.printMetrics.isWatertightManifold,
    'Compressed skyscrapers stay within zCapLimitMm and remain strictly 2-manifold', `maxZ=${built.printMetrics.maxZMm}mm <= cap=${built.printMetrics.zCapLimitMm}mm`);
}

// ---------------------------------------------------------------------------
// 4. Layer-2 Open OSM Polylines Rejected vs Closed Ways & Linear Cranes
// ---------------------------------------------------------------------------
console.log('\n[4/9] Layer-2 Open Polylines vs Closed Polygons & Cranes');
{
  const cLat = 52.0, cLon = 21.0, cosLat = Math.cos((cLat * Math.PI) / 180);
  const mkNode = (id, xm, ym) => ({ type: 'node', id, lat: cLat + ym / 111320, lon: cLon + xm / (111320 * cosLat) });
  const osmElements = [
    mkNode(10, -40, -20), mkNode(11, -20, -20), mkNode(12, -20, 0), mkNode(13, -40, 0),
    // Open 4-node way (10 !== 13) -> MUST NOT become a closed storage_tank!
    { type: 'way', id: 901, nodes: [10, 11, 12, 13], tags: { man_made: 'storage_tank', height: '20' } },
    mkNode(20, 20, -20), mkNode(21, 35, -20), mkNode(22, 35, -5), mkNode(23, 20, -5),
    // Closed way (20 === 20) -> MUST become 1 storage_tank
    { type: 'way', id: 902, nodes: [20, 21, 22, 23, 20], tags: { man_made: 'storage_tank', height: '18' } },
    mkNode(30, 0, 25), mkNode(31, 25, 25),
    // Open 2-node gantry crane way -> buffered cleanly as 1 crane
    { type: 'way', id: 903, nodes: [30, 31], tags: { man_made: 'crane', height: '32' } },
  ];
  const scene = {
    center: [cLat, cLon], spanMeters: 300, metersToUnits: 169.2 / 300, halfW: 84.6, halfH: 84.6,
    dem: { gridSize: 4, minElev: 3, maxElev: 3, grid: Array.from({ length: 4 }, () => Array(4).fill(3)) },
    waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [], buildings: [], osmElements,
  };
  const built = buildComplete3DModel(scene, makeState());
  const ac = built.printMetrics.archetypeCounts;
  check(ac.tanksAndSilos === 1 && ac.cranes === 1 && built.printMetrics.isWatertightManifold,
    'Open storage_tank way rejected, closed tank & open linear crane built cleanly', JSON.stringify(ac));
}

// ---------------------------------------------------------------------------
// 5. Courtyard Holes (b.holes), waterCutout Shore Margin, >1200 Cap & layerVisible
// ---------------------------------------------------------------------------
console.log('\n[5/9] Courtyard Hole Trees, waterCutout Shore Clearance, >1200 Cap & layerVisible');
{
  const outerBld = rectRing(-30, 0, 24, 24);
  const courtyardHole = rectRing(-30, 0, 15, 15);
  const trees = [];
  for (const [dx, dy] of [[-7, -7], [0, -7], [7, -7], [-7, 0], [0, 0], [7, 0], [-7, 7], [0, 7], [7, 7]]) {
    trees.push([-30 + dx, dy, 9.0]); // 9 courtyard trees inside b.holes!
  }
  // Cliff-edge trees 0.3u from waterCutout x = 25 + near-duplicate cluster
  trees.push([24.7, 0, 11.0], [24.65, 0.15, 10.5]);

  const scene = {
    spanMeters: 380, metersToUnits: 169.2 / 380, halfW: 84.6, halfH: 84.6,
    dem: { gridSize: 4, minElev: 4, maxElev: 4, grid: Array.from({ length: 4 }, () => Array(4).fill(4)) },
    waterPolys: [{ outer: [[25, -86], [86, -86], [86, 86], [25, 86]], holes: [] }],
    waterLines: [],
    greenPolys: [{ outer: courtyardHole, holes: [] }],
    trees, roads: [], bridgePolys: [],
    buildings: [{ id: 1, outer: outerBld, holes: [courtyardHole], h: 18, minH: 0, roof: 'hipped', roofH: 4 }],
  };
  const built = buildComplete3DModel(scene, makeState({ waterCutout: true }));
  const courtyardTreeTris = built.meshes.greenery.filter(t => {
    const cx = (t.v0[0] + t.v1[0] + t.v2[0]) / 3;
    const maxZ = Math.max(t.v0[2], t.v1[2], t.v2[2]);
    return cx < -15 && cx > -45 && maxZ > 3.2;
  });
  const overWaterTreeVerts = built.meshes.greenery.filter(t =>
    Math.max(t.v0[0], t.v1[0], t.v2[0]) > 25.05
  );
  check(built.printMetrics.archetypeCounts.trees >= 9 && courtyardTreeTris.length > 0,
    'Courtyard trees inside b.holes are preserved', `trees=${built.printMetrics.archetypeCounts.trees}, courtTris=${courtyardTreeTris.length}`);
  check(overWaterTreeVerts.length === 0,
    'Zero tree crown vertices overhang cut-out water (x > 25)', `overhangTris=${overWaterTreeVerts.length}`);

  // Verify layerVisible.trees = false keeps greenery turf while suppressing 3D trees
  const noTreesBuilt = buildComplete3DModel(scene, makeState({
    waterCutout: true,
    layerVisible: { water: true, base: true, greenery: true, trees: false, roads: true, buildings: true },
  }));
  check(noTreesBuilt.printMetrics.archetypeCounts.trees === 0 && noTreesBuilt.meshes.greenery.length > 0,
    'layerVisible.trees=false suppresses 3D trees while preserving park turf', `trees=${noTreesBuilt.printMetrics.archetypeCounts.trees}, turfTris=${noTreesBuilt.meshes.greenery.length}`);

  // Verify > 1200 trees cap lifted
  const denseTrees = [];
  for (let gx = -80; gx <= 80; gx += 2.8) {
    for (let gy = -80; gy <= 80; gy += 2.8) denseTrees.push([gx, gy, 7.0]);
  }
  const forestBuilt = buildComplete3DModel({
    spanMeters: 1500, metersToUnits: 169.2 / 1500, halfW: 84.6, halfH: 84.6,
    dem: { gridSize: 4, minElev: 3, maxElev: 3, grid: Array.from({ length: 4 }, () => Array(4).fill(3)) },
    waterPolys: [], waterLines: [], greenPolys: [], trees: denseTrees, roads: [], bridgePolys: [], buildings: [],
  }, makeState({ bedSizeMm: 300 }));
  check(forestBuilt.printMetrics.archetypeCounts.trees > 1800,
    'Hard maxTrees=1200 cap removed (dense forest emits > 1800 trees)', `trees=${forestBuilt.printMetrics.archetypeCounts.trees}`);
}

// ---------------------------------------------------------------------------
// 6. Layer-3 Auditor Detects Unanchored Loose Z=0 Objects in waterCutout Sea
// ---------------------------------------------------------------------------
console.log('\n[6/9] Layer-3 Auditor Detects Loose Z=0 Objects in waterCutout Sea');
{
  const seaScene = {
    spanMeters: 400, metersToUnits: 169.2 / 400, halfW: 84.6, halfH: 84.6,
    dem: { gridSize: 4, minElev: 3, maxElev: 3, grid: Array.from({ length: 4 }, () => Array(4).fill(3)) },
    waterPolys: [{ outer: [[-86, -86], [0, -86], [0, 86], [-86, 86]], holes: [] }],
    waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [],
    buildings: [
      { id: 1, outer: rectRing(-45, 0, 6, 6), holes: [], h: 18, minH: 0, roof: 'flat' }, // loose in cut-out sea!
      { id: 2, outer: rectRing(45, 0, 6, 6), holes: [], h: 18, minH: 0, roof: 'flat' },  // anchored on dry land
    ],
  };
  const cutRes = buildComplete3DModel(seaScene, makeState({ waterCutout: true }));
  check(cutRes.printMetrics.floatingBuildingsCount === 1 && cutRes.printMetrics.isWatertightManifold === false,
    'Auditor flags loose Z=0 building in cut-out sea as floatingBuildingsCount=1', `floating=${cutRes.printMetrics.floatingBuildingsCount}`);
}

// ---------------------------------------------------------------------------
// 7. Narrow Frame CSG Split (frameWidthMm = 4.0 mm on 320 mm Plate)
// ---------------------------------------------------------------------------
console.log('\n[7/9] Narrow Frame CSG Split without 0.48 Multiplier');
{
  const scene = {
    spanMeters: 500, metersToUnits: 169.2 / 500, halfW: 84.6, halfH: 84.6,
    dem: { gridSize: 4, minElev: 4, maxElev: 4, grid: Array.from({ length: 4 }, () => Array(4).fill(4)) },
    waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [], buildings: [],
  };
  const st = makeState({ bedSizeMm: 320, totalHeightMm: 320, showFrame: true, exportFrame: true, frameWidthMm: 4.0 });
  const built = buildComplete3DModel(scene, st);
  const segs = buildFrameSegmentsCSG(st, built.meshes.frame);
  const maxMinorMm = Math.max(...segs.map(s => Math.min(s.segW, s.segH)));
  const allFitMono4 = segs.every(s => {
    const lo = Math.min(s.segW, s.segH), hi = Math.max(s.segW, s.segH);
    return lo <= 87.05 && hi <= 153.45;
  });
  check(segs.length === 12 && maxMinorMm < 4.2 && allFitMono4,
    'Narrow 4.0mm frame at 320mm plate splits into 12 clean rectangular bars (0 L-corner spurs)', `segs=${segs.length}, maxBarThick=${maxMinorMm.toFixed(2)}mm`);
}

// ---------------------------------------------------------------------------
// 8. Hollow Vault Honors 1.8 mm UI Default & Explicit < 2.0 mm Wall
// ---------------------------------------------------------------------------
console.log('\n[8/9] Hollow Vault Honors < 2.0 mm Wall Thickness');
{
  const hillScene = {
    spanMeters: 400, metersToUnits: 169.2 / 400, halfW: 84.6, halfH: 84.6,
    dem: {
      gridSize: 5, minElev: 0, maxElev: 55,
      grid: [
        [0, 12, 28, 12, 0],
        [12, 36, 52, 36, 12],
        [28, 52, 55, 52, 28],
        [12, 36, 52, 36, 12],
        [0, 12, 28, 12, 0],
      ],
    },
    waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [], buildings: [],
  };
  const b12 = buildComplete3DModel(hillScene, makeState({ bedSizeMm: 140, baseHeightMm: 6.0, hollowBase: true, hollowWallMm: 1.2 }));
  const b18 = buildComplete3DModel(hillScene, makeState({ bedSizeMm: 140, baseHeightMm: 6.0, hollowBase: true, hollowWallMm: 1.8 }));
  const b24 = buildComplete3DModel(hillScene, makeState({ bedSizeMm: 140, baseHeightMm: 6.0, hollowBase: true, hollowWallMm: 2.4 }));
  check(b12.printMetrics.hollowChambersKept >= 1 && b12.printMetrics.totalVolumeMl < b18.printMetrics.totalVolumeMl && b18.printMetrics.totalVolumeMl < b24.printMetrics.totalVolumeMl,
    'Hollow resin volume scales monotonically across 1.2mm < 1.8mm < 2.4mm walls',
    `1.2mm=${b12.printMetrics.totalVolumeMl}ml < 1.8mm=${b18.printMetrics.totalVolumeMl}ml < 2.4mm=${b24.printMetrics.totalVolumeMl}ml`);
}

// ---------------------------------------------------------------------------
// 9. Bonus Fixes: 3D _pickId Metadata & Welded Lattice Truss Nodes
// ---------------------------------------------------------------------------
console.log('\n[9/9] Bonus: 3D _pickId Metadata & Welded Lattice Truss Nodes');
{
  const scene = {
    spanMeters: 360, metersToUnits: 169.2 / 360, halfW: 84.6, halfH: 84.6,
    dem: { gridSize: 4, minElev: 3, maxElev: 3, grid: Array.from({ length: 4 }, () => Array(4).fill(3)) },
    waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [],
    buildings: [
      { id: 1, outer: rectRing(-20, 0, 8, 8), holes: [], h: 24, minH: 0, roof: 'hipped', roofH: 5 },
      { id: 2, outer: [[15, -6], [27, -6], [21, 7]], holes: [], h: 65, minH: 0, roof: 'flat', tower: true, towerConstruction: 'lattice', tags: { man_made: 'tower', 'tower:construction': 'lattice', height: '65' } },
    ],
  };
  const st = makeState({ sceneData: scene });
  const built = buildComplete3DModel(scene, st);
  check(built.printMetrics.isWatertightManifold && built.printMetrics.floatingBuildingsCount === 0,
    'Standalone lattice truss tower has 0 floating pinnacle/node slivers', `float=${built.printMetrics.floatingBuildingsCount}`);
  check(built.buildingBounds.length === 2 && built.buildingBounds.every(bb => bb.pickId > 0),
    'S3DB and Layer-2 lattice buildings carry valid pickId metadata',
    `count=${built.buildingBounds.length}`);
}

console.log(`\nSECTION 5 + BONUS AUDIT SUMMARY: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
