import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

require(path.join(ROOT, 'src/vendor/vendor_bundle.js'));
require(path.join(ROOT, 'src/vendor/manifold_vendor.js'));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/print_physics_config.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/sla_print_laws.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/export/export_io_utils.js')));
const registry = require(path.join(ROOT, 'src/landmarks/landmark_registry.js'));
Object.assign(globalThis, registry);
const stlLoader = require(path.join(ROOT, 'src/landmarks/stl_landmark_loader.js'));
Object.assign(globalThis, stlLoader);

// Auto-load every curated landmark module present in src/landmarks/
const landmarksDir = path.join(ROOT, 'src/landmarks');
const landmarkFiles = fs.readdirSync(landmarksDir)
  .filter(f => f.startsWith('landmark_') && f !== 'landmark_registry.js' && f.endsWith('.js'))
  .sort();
for (const lf of landmarkFiles) {
  require(path.join(landmarksDir, lf));
}

const { buildComplete3DModel } = require(path.join(ROOT, 'src/mesh/mesh_builder.js'));
const stlMod = require(path.join(ROOT, 'src/export/stl_writer.js'));

let passed = 0;
let failed = 0;

function check(cond, label, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS: ${label}${detail ? ` -- ${detail}` : ''}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

function makeState(overrides = {}) {
  return {
    targetWidthCm: 12.0, targetHeightCm: 17.0, bedSizeMm: 120.0, totalHeightMm: 170.0,
    baseHeightMm: 4.0, solidBaseNoTunnels: true, kerfMm: 0.0, bedSafeMarginMm: 4.0,
    zScale: 1.05, terrainScale: 1.0, waterCutout: false, hollowBase: true, hollowWallMm: 2.0,
    showFrame: false, exportFrame: false, cropRatio: 1.0, cropCenterX: 0.0, cropCenterY: 0.0,
    tileCols: 1, tileRows: 1, isResin: true, xyPixelMm: 0.017, layerHeightMm: 0.05,
    supportlessMode: false, mapRotationDeg: 0, ...overrides,
  };
}

function makeRect(cx, cy, hx, hy) {
  return [[cx - hx, cy - hy], [cx + hx, cy - hy], [cx + hx, cy + hy], [cx - hx, cy + hy]];
}

function makeBinaryStlFromManifold(man) {
  const mesh = man.getMesh();
  const triCount = Math.floor(mesh.triVerts.length / 3);
  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);
  const hdr = 'Unit Test Binary STL';
  const hdrBytes = new Uint8Array(buf, 0, 80);
  for (let i = 0; i < hdr.length; i++) hdrBytes[i] = hdr.charCodeAt(i);
  view.setUint32(80, triCount, true);
  const stride = mesh.numProp || 3;
  const vp = mesh.vertProperties;
  let off = 84;
  for (let t = 0; t < triCount; t++) {
    view.setFloat32(off, 0, true);
    view.setFloat32(off + 4, 0, true);
    view.setFloat32(off + 8, 1, true);
    for (let v = 0; v < 3; v++) {
      const vi = mesh.triVerts[t * 3 + v] * stride;
      view.setFloat32(off + 12 + v * 12, vp[vi], true);
      view.setFloat32(off + 16 + v * 12, vp[vi + 1], true);
      view.setFloat32(off + 20 + v * 12, vp[vi + 2], true);
    }
    view.setUint16(off + 48, 0, true);
    off += 50;
  }
  return new Uint8Array(buf);
}

function countRoadTrisInYBand(tris, yMin, yMax) {
  let cnt = 0;
  for (const t of tris || []) {
    const cy = (t.v0[1] + t.v1[1] + t.v2[1]) / 3.0;
    if (cy >= yMin && cy <= yMax) cnt++;
  }
  return cnt;
}

console.log('================================================================');
console.log('   HERO LANDMARK REGISTRY, SUPPRESSION & MANIFOLD AUDIT TEST');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// 1. Registry Discovery & Synthetic/Distant Scene Isolation
// ---------------------------------------------------------------------------
console.log('[1/4] Registry Discovery & Non-Georeferenced / Distant Isolation');
{
  const list = registry.listHeroLandmarks();
  check(list.length >= 1, 'At least one curated landmark module registered', `count=${list.length} (${list.map(x => x.id).join(', ')})`);
  check(list.some(x => x.id === 'paris_eiffel_summit'), 'paris_eiffel_summit is registered');

  const noCenterPlan = registry.findActiveLandmarksAndSuppression(
    { buildings: [] },
    { halfW: 60, halfH: 85, mToU: 0.2, scaleToBed: 1, zScale: 1, rotDeg: 0, toBed: p => p }
  );
  check(noCenterPlan.active.length === 0, 'Synthetic scene without scene.center triggers 0 landmarks');

  const distantPlan = registry.findActiveLandmarksAndSuppression(
    { center: [35.6762, 139.6503], buildings: [] },
    { halfW: 60, halfH: 85, mToU: 0.2, scaleToBed: 1, zScale: 1, rotDeg: 0, toBed: p => p }
  );
  check(distantPlan.active.length === 0, 'Distant scene (> 5 km from registered landmarks) triggers 0 landmarks');
}

// ---------------------------------------------------------------------------
// 2. replaceOsmIds Suppression (Layer 1 + Layer 2) & Paris Eiffel Summit Build
// ---------------------------------------------------------------------------
console.log('\n[2/4] Eiffel Summit Geo-Anchor, Layer 1+2 Suppression & Watertight Build');
{
  // Place a realistic Eiffel shaft (0..276.13m) + suppressed OSM dome (308021389) + suppressed L2 cylinder (1462597762)
  const parisScene = {
    center: [48.8582713, 2.2945061],
    spanMeters: 780,
    metersToUnits: 169.2 / 780,
    dem: { grid: [[2, 2], [2, 2]], minElev: 2, maxElev: 2 },
    waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [],
    buildings: [
      { id: 1, osmId: 308687745, groupId: 5013364, part: true, outer: makeRect(0, 0, 1.8, 1.8), holes: [], h: 276.13, minH: 0, roof: 'flat', tags: { 'building:part': 'yes', height: '276.13' } },
      { id: 2, osmId: 308021389, groupId: 5013364, part: true, outer: makeRect(0, 0, 1.85, 1.85), holes: [], h: 300, minH: 276.13, roof: 'dome', roofH: 10, tags: { 'building:part': 'yes', height: '300', min_height: '276.13', 'roof:shape': 'dome' } },
      { id: 3, osmId: 1462597762, groupId: 5013364, part: true, outer: makeRect(0, 0, 0.35, 0.35), holes: [], h: 330, minH: 300, roof: 'flat', towerConstruction: 'lattice', tags: { 'building:part': 'yes', 'tower:construction': 'lattice', height: '330', min_height: '300' } },
    ],
  };
  const res = buildComplete3DModel(parisScene, makeState({ mapRotationDeg: -46 }));
  const pm = res.printMetrics;
  check(
    pm.openEdgesCount === 0 && pm.nonManifoldEdgesCount === 0 && pm.degenerateTrisCount === 0 && pm.floatingBuildingsCount === 0,
    'Paris Eiffel Summit unioned with shaft is strictly watertight 2-manifold (0 open/nm/degen/float)',
    `tris=${pm.totalTriangles}, open=${pm.openEdgesCount}, nm=${pm.nonManifoldEdgesCount}, float=${pm.floatingBuildingsCount}`
  );
  const suppressedDome = res.audit.preparedList.find(p => p.osmId === 308021389);
  const suppressedAnt = res.audit.preparedList.find(p => p.osmId === 1462597762);
  const emittedLm = res.buildingBounds.find(b => b.id === 'landmark:paris_eiffel_summit');
  check(Boolean(suppressedDome && suppressedDome.skip && suppressedDome.skipReason === 'hero_landmark_override'),
    'OSM dome way/308021389 suppressed with skipReason=hero_landmark_override');
  check(Boolean(suppressedAnt && suppressedAnt.skip && suppressedAnt.skipReason === 'hero_landmark_override'),
    'OSM Layer-2 antenna way/1462597762 suppressed cleanly');
  check(Boolean(emittedLm), 'Emitted curated landmark:paris_eiffel_summit manifold');

  // Verify cantilevered 3rd-floor gallery deck is wider than shaft and reaches >= 70 mm height
  const spanMm = emittedLm ? Math.min(emittedLm.maxX - emittedLm.minX, emittedLm.maxY - emittedLm.minY) : 0;
  check(spanMm >= 4.1 && spanMm <= 5.2, 'Cantilevered 3rd-floor observation gallery deck has authentic width', `spanU=${spanMm.toFixed(2)}`);
  check(pm.maxZMm >= 72.0 && pm.maxZMm <= 80.0, 'Summit mast reaches expected Eiffel height under Mono 4 laws', `maxZMm=${pm.maxZMm.toFixed(2)}`);

  // Export binary STL and verify zero open/non-manifold edges
  const stlBytes = stlMod.buildBinarySTLBytes({ ...makeState({ mapRotationDeg: -46 }), layerMeshes: res.meshes }, 'all', 0);
  check(stlBytes.byteLength > 84, 'Binary STL exported cleanly for Eiffel Summit tile', `bytes=${stlBytes.byteLength}`);
}

// ---------------------------------------------------------------------------
// 3. Custom Test Landmark: replacePolygonM Suppression & Plate Boundary Clip
// ---------------------------------------------------------------------------
console.log('\n[3/4] replacePolygonM Suppression & Outer-Frame Plate Clipping');
{
  const testId = '__unit_test_clip_landmark';
  registry.registerHeroLandmark({
    id: testId,
    name: 'Unit Test Clipped Landmark',
    lat: 10.0,
    lon: 20.0,
    headingDeg: 0,
    footprintRadiusM: 40,
    maxHeightM: 45,
    replacePolygonM: [[-20, -20], [20, -20], [20, 20], [-20, 20]],
    buildManifold(core, mf, ctx, anchor) {
      const ring = [
        anchor.toBedXY(-18, -12),
        anchor.toBedXY(18, -12),
        anchor.toBedXY(18, 12),
        anchor.toBedXY(-18, 12),
      ];
      return core.extrudeRingSolid(mf, ring, [], anchor.toBedZ(-0.5), anchor.toBedZ(45));
    },
  });
  try {
    const sc = {
      center: [10.0, 20.0],
      spanMeters: 780,
      dem: { grid: [[2, 2], [2, 2]], minElev: 2, maxElev: 2 },
      waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [],
      buildings: [
        { id: 101, osmId: 999001, outer: makeRect(0, 0, 1.5, 1.5), holes: [], h: 15, minH: 0, roof: 'flat', tags: { building: 'yes', height: '15' } },
        { id: 102, osmId: 999002, outer: makeRect(25, 0, 2.0, 2.0), holes: [], h: 15, minH: 0, roof: 'flat', tags: { building: 'yes', height: '15' } },
      ],
    };
    const rClip = buildComplete3DModel(sc, makeState());
    const suppressedPoly = rClip.audit.preparedList.find(p => p.osmId === 999001);
    const keptOutside = rClip.buildingBounds.find(b => b.id === 102);
    const emittedTest = rClip.buildingBounds.find(b => b.id === `landmark:${testId}`);
    check(Boolean(suppressedPoly && suppressedPoly.skip && suppressedPoly.skipReason === 'hero_landmark_override'),
      'replacePolygonM suppresses OSM footprint inside polygon');
    check(Boolean(keptOutside), 'OSM building outside replacePolygonM remains intact');
    check(Boolean(emittedTest), 'Custom registered landmark emitted cleanly');
    check(rClip.printMetrics.openEdgesCount === 0 && rClip.printMetrics.nonManifoldEdgesCount === 0,
      'Custom landmark scene is strictly watertight 2-manifold');
  } finally {
    registry.unregisterHeroLandmark(testId);
  }
}

// ---------------------------------------------------------------------------
// 4. Standalone Watertight Audit of Every Curated Landmark in src/landmarks/
// ---------------------------------------------------------------------------
console.log('\n[4/4] All Registered Curated Landmarks Watertight Smoke Audit');
{
  for (const spec of registry.listHeroLandmarks()) {
    const sc = {
      center: [spec.lat, spec.lon],
      spanMeters: 1200,
      dem: { grid: [[2, 2], [2, 2]], minElev: 2, maxElev: 2 },
      waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [],
      buildings: [],
    };
    // Skip elevated-only summit parts unless seated on a base tower
    const isSummitOnly = spec.id === 'paris_eiffel_summit';
    if (isSummitOnly) {
      sc.buildings.push({
        id: 1, osmId: 308687745, groupId: 5013364, part: true,
        outer: makeRect(0, 0, 1.3, 1.3), holes: [], h: 276.13, minH: 0, roof: 'flat',
        tags: { 'building:part': 'yes', height: '276.13' },
      });
    }
    const res = buildComplete3DModel(sc, makeState());
    const pm = res.printMetrics;
    const found = res.buildingBounds.some(b => b.id === `landmark:${spec.id}`);
    check(
      found && pm.openEdgesCount === 0 && pm.nonManifoldEdgesCount === 0 && pm.degenerateTrisCount === 0,
      `Landmark ${spec.id} builds strictly watertight 2-manifold`,
      `tris=${pm.totalTriangles}, open=${pm.openEdgesCount}, nm=${pm.nonManifoldEdgesCount}, maxZ=${pm.maxZMm.toFixed(1)}mm`
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Bridge & Pier Suppression via replaceOsmIds & replacePolygonM
// ---------------------------------------------------------------------------
console.log('\n[5/7] Bridge & Pier Suppression (replaceOsmIds + replacePolygonM)');
{
  const mToU = 169.2 / 780.0;
  const polyYM = 10.0 / mToU;
  const baseBridgeScene = () => ({
    center: [12.0, 22.0],
    spanMeters: 780,
    metersToUnits: mToU,
    dem: { grid: [[4, 4, 4], [4, 2, 4], [4, 4, 4]], minElev: 2, maxElev: 4 },
    waterPolys: [{ outer: [[-20, -60], [20, -60], [20, 60], [-20, 60]], holes: [] }],
    waterLines: [], greenPolys: [], trees: [], bridgeSupports: [], bridgePolys: [], buildings: [],
    roads: [
      {
        osmId: 777001, pts: [[-28, -10], [28, -10]], width: 4.5,
        isBridge: true, layer: 1, structure: 'beam',
        tags: { bridge: 'yes', 'bridge:structure': 'beam' },
      },
      {
        osmId: 777002, pts: [[-28, 10], [28, 10]], width: 4.5,
        isBridge: true, layer: 1, structure: 'beam',
        tags: { bridge: 'yes', 'bridge:structure': 'beam' },
      },
      {
        osmId: 777003, pts: [[-28, 45], [28, 45]], width: 4.5,
        isBridge: true, layer: 1, structure: 'beam',
        tags: { bridge: 'yes', 'bridge:structure': 'beam' },
      },
    ],
    pierLines: [
      { osmId: 888001, pts: [[-10, -25], [10, -25]], width: 2.0, pierKind: 'pier' },
      { osmId: 888002, pts: [[-8, 12], [8, 12]], width: 2.0, pierKind: 'pier' },
      { osmId: 888003, pts: [[-10, -45], [10, -45]], width: 2.0, pierKind: 'pier' },
    ],
  });

  const baselineRes = buildComplete3DModel(baseBridgeScene(), makeState());
  check(
    (baselineRes.audit.bridgeAudits || []).length === 3 && (baselineRes.audit.pierAudits || []).length === 3,
    'Baseline bridge+pier scene emits all 3 bridges and 3 piers before suppression',
    `bridges=${(baselineRes.audit.bridgeAudits || []).length}, piers=${(baselineRes.audit.pierAudits || []).length}`
  );
  const baselineBandTris = countRoadTrisInYBand(baselineRes.meshes.roads, -28, 22);
  check(baselineBandTris > 0, 'Baseline scene emits bridge/pier triangles in suppression band', `tris=${baselineBandTris}`);

  const lmId = '__unit_test_bridge_pier_lm';
  registry.registerHeroLandmark({
    id: lmId,
    name: 'Unit Test Custom Bridge Landmark',
    lat: 12.0,
    lon: 22.0,
    headingDeg: 0,
    footprintRadiusM: 120,
    maxHeightM: 24,
    replaceOsmIds: [777001, 888001],
    replacePolygonM: [[-150, polyYM - 25], [150, polyYM - 25], [150, polyYM + 25], [-150, polyYM + 25]],
    buildManifold(core, mf, _ctx, anchor) {
      const ring = [
        anchor.toBedXY(-12, -4),
        anchor.toBedXY(12, -4),
        anchor.toBedXY(12, 4),
        anchor.toBedXY(-12, 4),
      ];
      return core.extrudeRingSolid(mf, ring, [], anchor.toBedZ(0), anchor.toBedZ(20));
    },
  });

  try {
    const supRes = buildComplete3DModel(baseBridgeScene(), makeState());
    const brAudits = supRes.audit.bridgeAudits || [];
    const prAudits = supRes.audit.pierAudits || [];
    const suppressedBandTris = countRoadTrisInYBand(supRes.meshes.roads, -28, 22);
    const controlBridge = brAudits.find(a => a.osmId === 777003);
    const controlPier = prAudits.find(a => a.osmId === 888003);

    check(
      brAudits.length === 1 && !brAudits.some(a => a.osmId === 777001 || a.osmId === 777002),
      'Both replaceOsmIds and replacePolygonM bridges are suppressed from bridgeAudits',
      `remaining=${brAudits.map(a => a.osmId).join(',')}`
    );
    check(
      Boolean(controlBridge && Array.isArray(controlBridge.wayIds) && controlBridge.wayIds.includes(777003)),
      'bridgeAudits attaches osmId and wayIds diagnostics on retained bridge'
    );
    check(
      prAudits.length === 1 && !prAudits.some(a => a.osmId === 888001 || a.osmId === 888002) && Boolean(controlPier),
      'Both replaceOsmIds and replacePolygonM piers are suppressed from pierAudits',
      `remaining=${prAudits.map(a => a.osmId).join(',')}`
    );
    check(
      suppressedBandTris === 0,
      'Zero bridge/pier road triangles emitted inside suppressed OSM zones',
      `bandTris=${suppressedBandTris}`
    );
    check(
      supRes.buildingBounds.some(b => b.id === `landmark:${lmId}`) &&
        supRes.printMetrics.openEdgesCount === 0 &&
        supRes.printMetrics.nonManifoldEdgesCount === 0 &&
        supRes.printMetrics.degenerateTrisCount === 0,
      'Custom landmark replacement after bridge/pier suppression is watertight 2-manifold'
    );

    const directPlan = registry.findActiveLandmarksAndSuppression(
      baseBridgeScene(),
      { halfW: 60, halfH: 85, mToU, scaleToBed: 1, zScale: 1, rotDeg: 0, toBed: p => p }
    );
    check(
      registry.isBridgeOrPierSuppressedByLandmarks(directPlan, 777001, null) === true &&
        registry.isBridgeOrPierSuppressedByLandmarks(directPlan, [999, 888001], null) === true &&
        registry.isBridgeOrPierSuppressedByLandmarks(directPlan, 777002, [[-28, 10], [28, 10]]) === true &&
        registry.isBridgeOrPierSuppressedByLandmarks(directPlan, 777003, [[-28, 45], [28, 45]]) === false,
      'isBridgeOrPierSuppressedByLandmarks handles single ids, arrays, and replacePolygonM centroids'
    );
  } finally {
    registry.unregisterHeroLandmark(lmId);
  }
}

// ---------------------------------------------------------------------------
// 6. Binary STL Landmark Loader & Manifest Registration
// ---------------------------------------------------------------------------
console.log('\n[6/7] Binary STL Landmark Loader, Geo-Anchor & Manifest Discovery');
{
  const mf = globalThis.__getManifoldSync();
  const baseCube = mf.Manifold.cube([20, 16, 40], false).translate([-10, -8, 0]);
  const spireCube = mf.Manifold.cube([6, 6, 30], false).translate([-3, -3, 40]);
  const towerMeters = baseCube.add(spireCube);
  baseCube.delete();
  spireCube.delete();
  const stlBytes = makeBinaryStlFromManifold(towerMeters);
  towerMeters.delete();

  const standaloneMan = stlLoader.loadBinaryStlToManifold(mf, stlBytes, {
    transform: { uPerM: 0.25, zPerM: 0.25, cxBed: 4.0, cyBed: -6.0, zGround: 2.0 },
    headingDeg: 90,
  });
  const sbb = standaloneMan.boundingBox();
  const st = standaloneMan.status();
  check(
    (st === 'NoError' || st === 0) &&
      Math.abs(sbb.min[2] - 2.0) < 1e-4 &&
      Math.abs(sbb.max[2] - 19.5) < 1e-4 &&
      Math.abs((sbb.max[0] - sbb.min[0]) - 4.0) < 1e-4 &&
      Math.abs((sbb.max[1] - sbb.min[1]) - 5.0) < 1e-4,
    'loadBinaryStlToManifold parses binary STL, welds, rotates, scales, and seats Z=0 at zGround',
    `status=${st}, bboxX=${(sbb.max[0] - sbb.min[0]).toFixed(2)}, bboxY=${(sbb.max[1] - sbb.min[1]).toFixed(2)}, z=[${sbb.min[2].toFixed(2)},${sbb.max[2].toFixed(2)}]`
  );
  standaloneMan.delete();

  const stlLmId = '__unit_test_stl_lm';
  registry.registerHeroLandmark({
    id: stlLmId,
    name: 'Unit Test Binary STL Landmark',
    lat: 15.0,
    lon: 25.0,
    headingDeg: 0,
    footprintRadiusM: 40,
    maxHeightM: 70,
    replaceOsmIds: [555001, 555002],
    buildManifold(_core, mfArg, ctxArg, anchor) {
      return stlLoader.loadBinaryStlToManifold(mfArg, stlBytes, { transform: anchor, ctx: ctxArg });
    },
  });

  try {
    const sc = {
      center: [15.0, 25.0],
      spanMeters: 780,
      dem: { grid: [[2, 2], [2, 2]], minElev: 2, maxElev: 2 },
      waterPolys: [{ outer: [[-40, -40], [-14, -40], [-14, 40], [-40, 40]], holes: [] }],
      waterLines: [], greenPolys: [], trees: [], bridgeSupports: [], bridgePolys: [],
      roads: [
        {
          osmId: 555002, pts: [[-45, 0], [-10, 0]], width: 4.0,
          isBridge: true, layer: 1, structure: 'beam',
          tags: { bridge: 'yes', 'bridge:structure': 'beam' },
        },
      ],
      buildings: [
        { id: 501, osmId: 555001, outer: makeRect(0, 0, 2.0, 2.0), holes: [], h: 25, minH: 0, roof: 'flat', tags: { building: 'yes', height: '25' } },
      ],
    };
    const res = buildComplete3DModel(sc, makeState({ mapRotationDeg: 30 }));
    const pm = res.printMetrics;
    const supBld = res.audit.preparedList.find(p => p.osmId === 555001);
    const emittedStl = res.buildingBounds.find(b => b.id === `landmark:${stlLmId}`);
    check(
      Boolean(supBld && supBld.skip && supBld.skipReason === 'hero_landmark_override') &&
        (res.audit.bridgeAudits || []).length === 0 &&
        Boolean(emittedStl),
      'Binary STL landmark suppresses target OSM building and bridge and emits geo-anchored solid'
    );
    check(
      pm.openEdgesCount === 0 && pm.nonManifoldEdgesCount === 0 && pm.degenerateTrisCount === 0 && pm.floatingBuildingsCount === 0,
      'Binary STL landmark scene is strictly watertight 2-manifold (0 open/nm/degen/float)',
      `tris=${pm.totalTriangles}, open=${pm.openEdgesCount}, nm=${pm.nonManifoldEdgesCount}, degen=${pm.degenerateTrisCount}`
    );
  } finally {
    registry.unregisterHeroLandmark(stlLmId);
  }

  // Test declarative JSON manifest loader in an isolated temp dir
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stl-lm-manifest-'));
  const manifestId = '__unit_test_manifest_stl';
  try {
    const stlPath = path.join(tmpDir, 'tower.stl');
    const manifestPath = path.join(tmpDir, 'landmarks.json');
    fs.writeFileSync(stlPath, Buffer.from(stlBytes));
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        landmarks: [
          {
            id: manifestId,
            name: 'Manifest Test Tower',
            stlFile: 'tower.stl',
            lat: 16.0,
            lon: 26.0,
            headingDeg: 15,
            footprintRadiusM: 35,
            scaleM: 1.0,
            zOffsetM: 0.0,
            replaceOsmIds: [666001],
            replacePolygonM: [[-20, -20], [20, -20], [20, 20], [-20, 20]],
          },
        ],
      }),
      'utf8'
    );
    const regSpecs = stlLoader.registerStlLandmarksFromManifest(manifestPath);
    const scManifest = {
      center: [16.0, 26.0],
      spanMeters: 780,
      dem: { grid: [[2, 2], [2, 2]], minElev: 2, maxElev: 2 },
      waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [],
      buildings: [
        { id: 601, osmId: 666001, outer: makeRect(0, 0, 1.5, 1.5), holes: [], h: 20, minH: 0, roof: 'flat', tags: { building: 'yes', height: '20' } },
      ],
    };
    const resM = buildComplete3DModel(scManifest, makeState());
    check(
      regSpecs.length === 1 &&
        resM.buildingBounds.some(b => b.id === `landmark:${manifestId}`) &&
        resM.printMetrics.openEdgesCount === 0 &&
        resM.printMetrics.nonManifoldEdgesCount === 0,
      'registerStlLandmarksFromManifest loads JSON + relative .stl and builds watertight solid'
    );
  } finally {
    registry.unregisterHeroLandmark(manifestId);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 7. Wide-Span Landmark Activation (spanMeters: 12000, distance 6.5 km)
// ---------------------------------------------------------------------------
console.log('\n[7/7] Wide-Span Landmark Activation (spanMeters: 12000 at 6.5 km)');
{
  const centerLat = 52.23;
  const centerLon = 21.0;
  const cosLat = Math.cos((centerLat * Math.PI) / 180.0);
  const offsetM = 4600.0; // hypot(4600, 4600) = 6505 m (~6.5 km)
  const lmLat = centerLat + offsetM / 111320.0;
  const lmLon = centerLon + offsetM / (111320.0 * cosLat);
  const wideId = '__unit_test_wide_span_lm';

  registry.registerHeroLandmark({
    id: wideId,
    name: 'Wide Span 6.5km Landmark',
    lat: lmLat,
    lon: lmLon,
    headingDeg: 0,
    footprintRadiusM: 80,
    maxHeightM: 50,
    buildManifold(core, mf, _ctx, anchor) {
      const ring = [
        anchor.toBedXY(-20, -20),
        anchor.toBedXY(20, -20),
        anchor.toBedXY(20, 20),
        anchor.toBedXY(-20, 20),
      ];
      return core.extrudeRingSolid(mf, ring, [], anchor.toBedZ(0), anchor.toBedZ(50));
    },
  });

  try {
    const wideState = makeState({ targetWidthCm: 28, targetHeightCm: 28, bedSizeMm: 280, totalHeightMm: 280 });
    const wideSpec = resolveSceneScaleAndSpec(wideState, { spanMeters: 12000 });
    const mToU = (wideSpec.halfW * 2) / 12000.0;
    const wideScene = {
      center: [centerLat, centerLon],
      spanMeters: 12000,
      metersToUnits: mToU,
      dem: { grid: [[2, 2], [2, 2]], minElev: 2, maxElev: 2 },
      waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [], buildings: [],
    };
    const widePlan = registry.findActiveLandmarksAndSuppression(
      wideScene,
      { halfW: wideSpec.halfW, halfH: wideSpec.halfH, mToU, scaleToBed: 1, zScale: 1, rotDeg: 0, toBed: p => p }
    );
    const activeEntry = widePlan.active.find(a => a.spec.id === wideId);
    const narrowPlan = registry.findActiveLandmarksAndSuppression(
      { center: [centerLat, centerLon], spanMeters: 2000, buildings: [] },
      { halfW: wideSpec.halfW, halfH: wideSpec.halfH, mToU: (wideSpec.halfW * 2) / 2000.0, scaleToBed: 1, zScale: 1, rotDeg: 0, toBed: p => p }
    );
    const wideRes = buildComplete3DModel(wideScene, wideState);
    check(
      Boolean(activeEntry) && activeEntry.baseXf.distM > 6400 && activeEntry.baseXf.distM < 6600,
      'Landmark at 6.5 km activates cleanly when spanMeters is 12000',
      `distM=${activeEntry ? activeEntry.baseXf.distM.toFixed(1) : 'none'}`
    );
    check(
      !narrowPlan.active.some(a => a.spec.id === wideId),
      'Same 6.5 km landmark stays inactive when spanMeters is 2000'
    );
    check(
      wideRes.buildingBounds.some(b => b.id === `landmark:${wideId}`) &&
        wideRes.printMetrics.openEdgesCount === 0 &&
        wideRes.printMetrics.nonManifoldEdgesCount === 0,
      'Wide-span 6.5 km landmark builds into watertight 2-manifold model'
    );
  } finally {
    registry.unregisterHeroLandmark(wideId);
  }
}

console.log(`\nHERO LANDMARK REGISTRY SUMMARY: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
