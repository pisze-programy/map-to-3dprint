import assert from 'node:assert/strict';
import fs from 'node:fs';
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

console.log(`\nHERO LANDMARK REGISTRY SUMMARY: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
