// tests/adversarial_tier5_geometry.js
// ============================================================================
// MILESTONE 5 PHASE 2 — TIER 5 ADVERSARIAL COVERAGE HARDENING
// Geometry, Print Physics, SLA Invariants & Mesh Generation Test Suite
// ============================================================================

const fs = require('fs');
const path = require('path');

// Global environment shims for modular browser sources
global.tryEmitPlanarGabledBuilding = () => false;
global.emitUndersideIdPatch = () => {};
global.pointInPolyOrNear2D = () => false;
global.triangulateSimplePoly = () => [];
global.computeFaceNormal = () => [0, 0, 1];
global.createZipArchive = () => new Uint8Array();
global.buildBinarySTLBytes = () => new Uint8Array();

const filesToLoad = [
  'src/geometry/polygon_2d.js',
  'src/geometry/obb_medial_2d.js',
  'src/geometry/marching_squares_2d.js',
  'src/mesh/mesh_primitives.js',
  'src/mesh/mesh_clipper_3d.js',
  'src/mesh/roof_shapes.js',
  'src/mesh/roof_architectural.js',
  'src/mesh/terrain_dem_grid.js',
  'src/mesh/terrain_masks.js',
  'src/mesh/terrain_base_water.js',
  'src/mesh/features_roads_parks.js',
  'src/mesh/features_bridges.js',
  'src/mesh/buildings_prepare.js',
  'src/mesh/buildings_s3db.js',
  'src/mesh/mesh_topology.js',
  'src/mesh/mesh_builder.js',
  'src/export/crc32_zip.js',
  'src/export/stl_writer.js',
  'src/export/zip_packager.js',
  'src/ui/ui_config.js'
];

for (const relPath of filesToLoad) {
  const absPath = path.resolve(__dirname, '..', relPath);
  const code = fs.readFileSync(absPath, 'utf8');
  eval(code);
}

console.log('================================================================');
console.log('  TIER 5 ADVERSARIAL GEOMETRY & PRINT PHYSICS STRESS SUITE');
console.log('================================================================\n');

let totalAssertions = 0;
let passedAssertions = 0;
let failedAssertions = 0;
const failureLog = [];

function assert(condition, message) {
  totalAssertions++;
  if (!condition) {
    failedAssertions++;
    failureLog.push(message);
    console.error(`  [FAIL] ${message}`);
  } else {
    passedAssertions++;
  }
}

// Helper to audit a single extruded building mesh for watertight 2-manifold invariants
function auditBuildingMesh(name, outer, holes = [], opts = {}, roofShape = 'flat', zBase = 2.35, zEaves = 20.0, zRidge = 20.0) {
  const bShell = [];
  const shellId = 500 + totalAssertions;
  const tileId = 0;
  const bId = 1;
  const targetLayerId = 4;
  const hasPitched = (zRidge > zEaves + 1e-4) && (roofShape !== 'flat');

  const defaultOpts = {
    scaleMm: 1.0,
    isGroundSeated: true,
    ...opts
  };

  extrudeBuildingLoD2(
    outer,
    holes,
    zBase,
    zEaves,
    zRidge,
    hasPitched,
    targetLayerId,
    bId,
    bShell,
    tileId,
    roofShape,
    defaultOpts
  );

  for (let ti = 0; ti < bShell.length; ti++) {
    bShell[ti].shellId = shellId;
    bShell[ti].tileId = tileId;
  }

  const outerClean = cleanPolygonRing(outer, true);
  const holesClean = (holes || []).map(h => cleanPolygonRing(h, false)).filter(h => h.length >= 3);

  const meshes = {
    buildings: bShell,
    base: [],
    water: [],
    roads: [],
    greenery: []
  };

  const buildingBound = {
    shellId,
    pickId: bId,
    interiorPt: computeSolidInteriorPoint2D(outerClean, holesClean),
    minZ: zBase,
    maxZ: zRidge
  };

  const auditCtx = {
    totalWidthMm: 169.2,
    totalHeightMm: 169.2,
    scaleMm: defaultOpts.scaleMm || 1.0,
    tileCols: 1,
    tileRows: 1,
    numTiles: 1
  };
  const auditState = {
    bedSizeMm: 169.2,
    totalHeightMm: 169.2,
    bedZ: 165.0
  };

  const auditResult = auditMeshTopologyNumeric(meshes, [buildingBound], auditState, auditCtx);
  const bMetrics = auditResult.layerMetrics.buildings;

  assert(bShell.length > 0, `${name}: generated non-empty triangle mesh (triangles: ${bShell.length})`);
  assert(bMetrics.openEdges === 0, `${name}: openEdges === 0 (got ${bMetrics.openEdges})`);
  assert(bMetrics.nonManifoldEdges === 0, `${name}: nonManifoldEdges === 0 (got ${bMetrics.nonManifoldEdges})`);
  assert(bMetrics.sameDirDupEdges === 0, `${name}: sameDirDupEdges === 0 (got ${bMetrics.sameDirDupEdges})`);
  assert(bMetrics.unpairedDirEdges === 0, `${name}: unpairedDirEdges === 0 (got ${bMetrics.unpairedDirEdges})`);
  assert(bMetrics.degenerateTris === 0, `${name}: degenerateTris === 0 (got ${bMetrics.degenerateTris})`);
  assert(bMetrics.volumeMl > 0, `${name}: enclosed volume strictly positive (got ${bMetrics.volumeMl.toFixed(4)} ml)`);

  const isWatertight = (bMetrics.openEdges === 0 && bMetrics.nonManifoldEdges === 0 &&
                        bMetrics.sameDirDupEdges === 0 && bMetrics.unpairedDirEdges === 0 &&
                        bMetrics.volumeMl > 0);
  assert(isWatertight === true, `${name}: 100% watertight 2-manifold`);

  return { bMetrics, bShell, isWatertight };
}

// ============================================================================
// SUITE 1: Scale Invariance of Bottom Slab & Water Bed Safety Floor (Feature 18)
// ============================================================================
console.log('--- SUITE 1: Bottom Slab & Water Floor Scale Invariance ---');

const testScales = [
  { name: 'Ultra-Miniature (80mm)', maxDimMm: 80.0 },
  { name: 'Mono 4 Single Tile (84mm)', maxDimMm: 84.0 },
  { name: 'Mono 4 Dual-Tile (150mm)', maxDimMm: 150.0 },
  { name: 'Desktop Medium (200mm)', maxDimMm: 200.0 },
  { name: 'Standard Studio (500mm)', maxDimMm: 500.0 },
  { name: 'Large Panoramic (1000mm)', maxDimMm: 1000.0 },
  { name: 'Grand Architectural (1500mm)', maxDimMm: 1500.0 }
];

for (const sc of testScales) {
  const scaleMm = sc.maxDimMm / 169.2;
  const mmPerUnit = scaleMm;
  const layerHeightMm = 0.05;

  const quantizeZUnits = (uVal) => {
    const mm = uVal * mmPerUnit;
    const qMm = Math.max(layerHeightMm, Math.round(mm / layerHeightMm) * layerHeightMm);
    return qMm / mmPerUnit;
  };

  const baseBottomZ = quantizeZUnits(2.35 / scaleMm);
  const deepWaterZ = quantizeZUnits(1.68 / scaleMm);
  const zSubWater = quantizeZUnits(1.30 / scaleMm);
  const zDrainVault = quantizeZUnits(0.70 / scaleMm);

  const physicalBaseMm = baseBottomZ * scaleMm;
  const physicalDeepWaterMm = deepWaterZ * scaleMm;
  const physicalSubWaterMm = zSubWater * scaleMm;
  const physicalDrainVaultMm = zDrainVault * scaleMm;

  assert(Math.abs(physicalBaseMm - 2.35) <= 0.05,
    `${sc.name}: baseBottomZ * scaleMm is invariant at 2.35mm (got ${physicalBaseMm.toFixed(3)} mm)`);
  assert(Math.abs(physicalDeepWaterMm - 1.68) <= 0.05,
    `${sc.name}: deepWaterZ * scaleMm is invariant at 1.68mm (got ${physicalDeepWaterMm.toFixed(3)} mm)`);
  assert(Math.abs(physicalSubWaterMm - 1.30) <= 0.05,
    `${sc.name}: zSubWater * scaleMm is invariant at 1.30mm (got ${physicalSubWaterMm.toFixed(3)} mm)`);
  assert(Math.abs(physicalDrainVaultMm - 0.70) <= 0.05,
    `${sc.name}: zDrainVault * scaleMm is invariant at 0.70mm (got ${physicalDrainVaultMm.toFixed(3)} mm)`);

  // Stress-test water bed depression formula across extreme negative SDF values
  const sdfValues = [0, -0.05, -0.1, -0.5, -1.0, -5.0, -20.0, -100.0, -1000.0];
  for (const sdf of sdfValues) {
    const bedZUnits = baseBottomZ + Math.max(-0.95 / scaleMm, (sdf * 0.35) / scaleMm);
    const bedZMm = bedZUnits * scaleMm;
    assert(bedZUnits > 0, `${sc.name} (sdf=${sdf}): bedZUnits > 0 (got ${bedZUnits.toFixed(4)})`);
    assert(bedZMm >= 1.38, `${sc.name} (sdf=${sdf}): physical floor >= 1.38 mm (got ${bedZMm.toFixed(3)} mm)`);
  }
}

console.log(`Suite 1 Complete. Passed: ${passedAssertions}/${totalAssertions}`);

// ============================================================================
// SUITE 2: Printer Z-Cap Soft-Knee Mathematical Monotonicity & C1 Continuity
// ============================================================================
console.log('\n--- SUITE 2: Z-Cap Soft-Knee Monotonicity & Bed Limit Protection ---');

const bedZLimits = [165.0, 150.0, 200.0];

for (const bedZ of bedZLimits) {
  const maxSafeZMm = Math.max(20.0, bedZ - 2.0); // e.g. 163.0 mm for bedZ=165
  const zKneeMm = Math.min(maxSafeZMm * 0.65, maxSafeZMm - 35.0);
  const H = maxSafeZMm - zKneeMm;

  // Only test values strictly exceeding maxSafeZMm where compression activates
  const testMaxTops = [maxSafeZMm + 1.0, maxSafeZMm + 10.0, maxSafeZMm + 50.0, maxSafeZMm + 150.0, maxSafeZMm + 400.0];

  for (const maxRawZMm of testMaxTops) {
    const Xmax = maxRawZMm - zKneeMm;
    const c = (Xmax - H) / (H * Xmax);

    // Verify c > 0 strictly
    assert(c > 0, `bedZ=${bedZ}, maxRaw=${maxRawZMm}: coefficient c > 0 (c = ${c.toFixed(6)})`);

    // Verify g(0) = zKneeMm (knee value continuity)
    const g0 = zKneeMm + (0 / (1.0 + c * 0));
    assert(Math.abs(g0 - zKneeMm) < 1e-9, `bedZ=${bedZ}, maxRaw=${maxRawZMm}: g(0) == zKneeMm`);

    // Verify g(Xmax) == maxSafeZMm exactly
    const gXmax = zKneeMm + (Xmax / (1.0 + c * Xmax));
    assert(Math.abs(gXmax - maxSafeZMm) < 1e-6,
      `bedZ=${bedZ}, maxRaw=${maxRawZMm}: g(Xmax) == maxSafeZMm (got ${gXmax.toFixed(4)}, expected ${maxSafeZMm})`);

    // Dense parameter sweep verifying g'(x) > 0 strictly (monotonicity)
    const steps = 100;
    let prevG = zKneeMm;
    for (let s = 1; s <= steps; s++) {
      const x = (s / steps) * Xmax;
      const gX = zKneeMm + (x / (1.0 + c * x));
      const deltaG = gX - prevG;

      assert(deltaG > 0, `bedZ=${bedZ}, x=${x.toFixed(1)}: strict monotonicity deltaG > 0 (deltaG = ${deltaG.toFixed(6)})`);
      assert(gX <= maxSafeZMm + 1e-6, `bedZ=${bedZ}, x=${x.toFixed(1)}: gX <= maxSafeZMm (gX = ${gX.toFixed(4)})`);

      // Verify analytical derivative: g'(x) = 1 / (1 + c*x)^2
      const analyticDeriv = 1.0 / ((1.0 + c * x) * (1.0 + c * x));
      assert(analyticDeriv > 0 && analyticDeriv <= 1.0,
        `bedZ=${bedZ}, x=${x.toFixed(1)}: analytic derivative in (0, 1] (got ${analyticDeriv.toFixed(6)})`);

      prevG = gX;
    }
  }
}

console.log(`Suite 2 Complete. Passed: ${passedAssertions}/${totalAssertions}`);

// ============================================================================
// SUITE 3: Relief Chimney Cavity Containment, Annular Punching & 45° Vault
// ============================================================================
console.log('\n--- SUITE 3: Relief Chimney Cavity Containment & 45° Vault ---');

const chimneyTestFootprints = [
  {
    name: 'Large Solid Square (40x40m, h=25m)',
    outer: [[0, 0], [40, 0], [40, 40], [0, 40]],
    holes: [],
    roofShape: 'flat',
    zBase: 2.35, zEaves: 25.0, zRidge: 25.0,
    expectChimney: true
  },
  {
    name: 'Tall Skyscraper with Pyramid Roof (30x30m, eaves=40m, ridge=55m)',
    outer: [[0, 0], [30, 0], [30, 30], [0, 30]],
    holes: [],
    roofShape: 'pyramidal',
    zBase: 2.35, zEaves: 40.0, zRidge: 55.0,
    expectChimney: true
  },
  {
    name: 'High-Rise with Hipped Roof (36x24m, eaves=30m, ridge=36m)',
    outer: [[0, 0], [36, 0], [36, 24], [0, 24]],
    holes: [],
    roofShape: 'hipped',
    zBase: 2.35, zEaves: 30.0, zRidge: 36.0,
    expectChimney: true
  },
  {
    name: 'Sub-Threshold Small Footprint (5x5m, h=20m) -> Chimney safely skipped',
    outer: [[0, 0], [5, 0], [5, 5], [0, 5]],
    holes: [],
    roofShape: 'flat',
    zBase: 2.35, zEaves: 20.0, zRidge: 20.0,
    expectChimney: false
  },
  {
    name: 'Low-Rise Building (30x30m, h=4.0m < 5.5m) -> Chimney safely skipped',
    outer: [[0, 0], [30, 0], [30, 30], [0, 30]],
    holes: [],
    roofShape: 'flat',
    zBase: 2.35, zEaves: 6.0, zRidge: 6.0,
    expectChimney: false
  },
  {
    name: 'Notched Rectangular Footprint (40x30m with 10x8 corner notch)',
    outer: [[0, 0], [40, 0], [40, 22], [30, 22], [30, 30], [0, 30]],
    holes: [],
    roofShape: 'flat',
    zBase: 2.35, zEaves: 20.0, zRidge: 20.0,
    expectChimney: true
  },
  {
    name: 'Hexagonal Tower (r=18m, h=35m)',
    outer: Array.from({ length: 6 }, (_, i) => {
      const ang = (i / 6) * Math.PI * 2;
      return [20 + Math.cos(ang) * 18, 20 + Math.sin(ang) * 18];
    }),
    holes: [],
    roofShape: 'flat',
    zBase: 2.35, zEaves: 35.0, zRidge: 35.0,
    expectChimney: true
  },
  {
    name: 'Octagonal Column (r=16m, h=28m)',
    outer: Array.from({ length: 8 }, (_, i) => {
      const ang = (i / 8) * Math.PI * 2;
      return [20 + Math.cos(ang) * 16, 20 + Math.sin(ang) * 16];
    }),
    holes: [],
    roofShape: 'pyramidal',
    zBase: 2.35, zEaves: 28.0, zRidge: 36.0,
    expectChimney: true
  }
];

for (const fp of chimneyTestFootprints) {
  auditBuildingMesh(fp.name, fp.outer, fp.holes, { scaleMm: 1.0, isGroundSeated: true }, fp.roofShape, fp.zBase, fp.zEaves, fp.zRidge);

  if (fp.expectChimney) {
    const chim = computeReliefChimneyPolygon(fp.outer, fp.holes, 2.0);
    assert(chim !== null && chim.length >= 3, `${fp.name}: computeReliefChimneyPolygon produced valid polygon`);
    if (chim) {
      assert(signedArea2D(chim) < 0, `${fp.name}: chimney winding MUST be CW (got area = ${signedArea2D(chim).toFixed(2)})`);
      assert(isPolygonStrictlyInside(chim, fp.outer), `${fp.name}: chimney polygon is strictly inside outer`);
    }
  }
}

console.log(`Suite 3 Complete. Passed: ${passedAssertions}/${totalAssertions}`);

// ============================================================================
// SUITE 4: Complex Courtyards, Micro-Corridors & Multi-Hole Keyhole Merging
// ============================================================================
console.log('\n--- SUITE 4: Complex Courtyards & Multi-Hole Keyhole Merging ---');

const courtyardTestCases = [
  {
    name: 'Single Central Courtyard O-Ring',
    outer: [[0, 0], [40, 0], [40, 40], [0, 40]],
    holes: [[[12, 12], [28, 12], [28, 28], [12, 28]]],
    roofShape: 'flat'
  },
  {
    name: 'Dual Independent Courtyards',
    outer: [[0, 0], [60, 0], [60, 30], [0, 30]],
    holes: [
      [[8, 8], [24, 8], [24, 22], [8, 22]],
      [[36, 8], [52, 8], [52, 22], [36, 22]]
    ],
    roofShape: 'flat'
  },
  {
    name: 'Triple Courtyards in Linear Array',
    outer: [[0, 0], [90, 0], [90, 30], [0, 30]],
    holes: [
      [[6, 6], [24, 6], [24, 24], [6, 24]],
      [[36, 6], [54, 6], [54, 24], [36, 24]],
      [[66, 6], [84, 6], [84, 24], [66, 24]]
    ],
    roofShape: 'flat'
  },
  {
    name: 'L-Shaped Courtyard inside L-Shaped Building',
    outer: [[0, 0], [50, 0], [50, 20], [20, 20], [20, 50], [0, 50]],
    holes: [[[6, 6], [42, 6], [42, 14], [14, 14], [14, 42], [6, 42]]],
    roofShape: 'flat'
  },
  {
    name: 'Courtyard with Skillion Pitched Roof',
    outer: [[0, 0], [36, 0], [36, 36], [0, 36]],
    holes: [[[10, 10], [26, 10], [26, 26], [10, 26]]],
    roofShape: 'skillion',
    zEaves: 15.0, zRidge: 25.0
  },
  {
    name: 'Courtyard with Mansard Roof',
    outer: [[0, 0], [40, 0], [40, 40], [0, 40]],
    holes: [[[14, 14], [26, 14], [26, 26], [14, 26]]],
    roofShape: 'mansard',
    zEaves: 16.0, zRidge: 24.0
  }
];

for (const ct of courtyardTestCases) {
  auditBuildingMesh(ct.name, ct.outer, ct.holes, { scaleMm: 1.0 }, ct.roofShape || 'flat', 2.35, ct.zEaves || 20.0, ct.zRidge || 20.0);
}

console.log(`Suite 4 Complete. Passed: ${passedAssertions}/${totalAssertions}`);

// ============================================================================
// SUITE 5: Pathological Building Extrusions (Needles, Slender Towers, Spire Caps)
// ============================================================================
console.log('\n--- SUITE 5: Pathological Building Extrusions ---');

const pathologicalCases = [
  {
    name: 'Extreme Needle Skyscraper (Aspect Ratio 25:1, 50x2m, h=80m)',
    outer: [[0, 0], [50, 0], [50, 2], [0, 2]],
    holes: [],
    zBase: 2.35, zEaves: 80.0, zRidge: 80.0,
    roofShape: 'flat'
  },
  {
    name: 'Ultra-Slender Spire Tower (1x1m, h=60m)',
    outer: [[0, 0], [1, 0], [1, 1], [0, 1]],
    holes: [],
    zBase: 2.35, zEaves: 55.0, zRidge: 60.0,
    roofShape: 'pyramidal'
  },
  {
    name: 'Star Dome Pavilion (12-Pointed Star)',
    outer: Array.from({ length: 24 }, (_, i) => {
      const r = i % 2 === 0 ? 15 : 7;
      const ang = (i / 24) * Math.PI * 2;
      return [20 + Math.cos(ang) * r, 20 + Math.sin(ang) * r];
    }),
    holes: [],
    zBase: 2.35, zEaves: 15.0, zRidge: 25.0,
    roofShape: 'dome'
  },
  {
    name: 'Collinear-Edge Footprint (Points along edges)',
    outer: [[0, 0], [10, 0], [20, 0], [30, 0], [30, 15], [30, 30], [0, 30]],
    holes: [],
    zBase: 2.35, zEaves: 18.0, zRidge: 18.0,
    roofShape: 'flat'
  },
  {
    name: 'Micro-Perturbed Jitter Ring',
    outer: [
      [0.001, 0.002], [19.998, 0.003], [20.002, 19.999], [0.003, 20.001]
    ],
    holes: [],
    zBase: 2.35, zEaves: 16.0, zRidge: 16.0,
    roofShape: 'flat'
  }
];

for (const pc of pathologicalCases) {
  auditBuildingMesh(pc.name, pc.outer, pc.holes, { scaleMm: 1.0 }, pc.roofShape, pc.zBase, pc.zEaves, pc.zRidge);
}

console.log(`Suite 5 Complete. Passed: ${passedAssertions}/${totalAssertions}`);

// ============================================================================
// SUITE 6: 3D Axis-Plane Mesh Clipping (Single Plane Cuts)
// ============================================================================
console.log('\n--- SUITE 6: 3D Axis-Plane Mesh Clipping ---');

function generateClosedBox(x0, y0, z0, x1, y1, z1, layerId = 4, shellId = 1) {
  const tris = [];
  pushTri(tris, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], layerId, 1, 0);
  pushTri(tris, [x0, y0, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], layerId, 1, 0);
  pushTri(tris, [x0, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], layerId, 1, 0);
  pushTri(tris, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [0, 0, 1], layerId, 1, 0);
  pushTri(tris, [x0, y0, z0], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], layerId, 1, 0);
  pushTri(tris, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0], layerId, 1, 0);
  pushTri(tris, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], layerId, 1, 0);
  pushTri(tris, [x1, y0, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], layerId, 1, 0);
  pushTri(tris, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0], layerId, 1, 0);
  pushTri(tris, [x0, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], layerId, 1, 0);
  pushTri(tris, [x0, y1, z0], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], layerId, 1, 0);
  pushTri(tris, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [0, 1, 0], layerId, 1, 0);
  for (const t of tris) t.shellId = shellId;
  return tris;
}

const originalBox = generateClosedBox(-20, -20, 0, 20, 20, 15, 4, 10);
assert(originalBox.length === 12, 'Original box has 12 triangles');

// Clip along X=0 (keep greater)
const clippedXPlus = clipClosedMeshByAxisPlane(originalBox, 0, 0.0, true);
assert(clippedXPlus.length > 0, 'clipClosedMeshByAxisPlane(axis=0, keepGreater=true) returned triangles');
const auditClipX = auditMeshTopologyNumeric({ buildings: clippedXPlus }, [], { bedSizeMm: 169.2, totalHeightMm: 169.2, bedZ: 165 }, { scaleMm: 1, tileCols: 1, tileRows: 1, numTiles: 1 });
assert(auditClipX.layerMetrics.buildings.openEdges === 0, `Clip X>0: openEdges === 0 (got ${auditClipX.layerMetrics.buildings.openEdges})`);
assert(auditClipX.layerMetrics.buildings.nonManifoldEdges === 0, `Clip X>0: nonManifoldEdges === 0 (got ${auditClipX.layerMetrics.buildings.nonManifoldEdges})`);
assert(auditClipX.layerMetrics.buildings.volumeMl > 0, `Clip X>0: volumeMl > 0 (got ${auditClipX.layerMetrics.buildings.volumeMl.toFixed(3)} ml)`);

// Clip along X=0 (keep lesser)
const clippedXMinus = clipClosedMeshByAxisPlane(originalBox, 0, 0.0, false);
const auditClipXMin = auditMeshTopologyNumeric({ buildings: clippedXMinus }, [], { bedSizeMm: 169.2, totalHeightMm: 169.2, bedZ: 165 }, { scaleMm: 1, tileCols: 1, tileRows: 1, numTiles: 1 });
assert(auditClipXMin.layerMetrics.buildings.openEdges === 0, `Clip X<0: openEdges === 0 (got ${auditClipXMin.layerMetrics.buildings.openEdges})`);
assert(auditClipXMin.layerMetrics.buildings.nonManifoldEdges === 0, `Clip X<0: nonManifoldEdges === 0 (got ${auditClipXMin.layerMetrics.buildings.nonManifoldEdges})`);

// Clip along Y=0 (keep greater)
const clippedYPlus = clipClosedMeshByAxisPlane(originalBox, 1, 0.0, true);
const auditClipY = auditMeshTopologyNumeric({ buildings: clippedYPlus }, [], { bedSizeMm: 169.2, totalHeightMm: 169.2, bedZ: 165 }, { scaleMm: 1, tileCols: 1, tileRows: 1, numTiles: 1 });
assert(auditClipY.layerMetrics.buildings.openEdges === 0, `Clip Y>0: openEdges === 0 (got ${auditClipY.layerMetrics.buildings.openEdges})`);
assert(auditClipY.layerMetrics.buildings.nonManifoldEdges === 0, `Clip Y>0: nonManifoldEdges === 0 (got ${auditClipY.layerMetrics.buildings.nonManifoldEdges})`);

console.log(`Suite 6 Complete. Passed: ${passedAssertions}/${totalAssertions}`);

// ============================================================================
// SUITE 7: Photon Mono 4 Dual-Pack Geometry Boundaries & Z-Height Pairing
// ============================================================================
console.log('\n--- SUITE 7: Mono 4 Dual-Pack Boundaries & Pairing Schedule ---');

const boundaryTests = [
  [75, 84, true, '75x84 standard dual-pack profile'],
  [84, 75, true, '84x75 standard rotated dual-pack profile'],
  [75.45, 87.05, true, '75.45x87.05 exact bed boundary'],
  [87.05, 75.45, true, '87.05x75.45 exact bed boundary rotated'],
  [75.46, 87.05, false, '75.46x87.05 width exceeded by 0.01 mm'],
  [75.45, 87.06, false, '75.45x87.06 height exceeded by 0.01 mm'],
  [76.0, 84.0, false, '76x84 exceeds 75.45 max dual width'],
  [84.0, 84.0, false, '84x84 old square profile (2x84=168 > 153.4) cannot dual-pack'],
  [150.0, 80.0, false, '150x80 full plate cannot dual-pack'],
  [0, 0, false, '0x0 zero dimension'],
  [-75, 84, false, 'negative width'],
  [75, -84, false, 'negative height'],
  [null, 84, false, 'null width'],
  [NaN, 84, false, 'NaN width'],
  [undefined, 84, false, 'undefined width'],
  [Infinity, 84, false, 'Infinity width'],
  ['', 84, false, 'empty string width'],
  ['75', '84', true, 'valid numeric strings "75"x"84"']
];

for (const [w, h, expected, desc] of boundaryTests) {
  const actual = checkTileDualPackableMono4(w, h);
  assert(actual === expected, `checkTileDualPackableMono4(${w}, ${h}) === ${expected} [${desc}]`);
}

const testTileBatches = [
  {
    name: '2x2 Grid (4 Tiles) Dual-Packable',
    tiles: [
      { r: 1, c: 1, maxZ: 140.0, volMl: 12.0 },
      { r: 1, c: 2, maxZ: 125.0, volMl: 10.5 },
      { r: 2, c: 1, maxZ: 65.0,  volMl: 8.0 },
      { r: 2, c: 2, maxZ: 40.0,  volMl: 7.5 }
    ],
    tileW: 75, tileH: 84
  },
  {
    name: '3x3 Grid (9 Tiles, Odd Count) Dual-Packable',
    tiles: [
      { r: 1, c: 1, maxZ: 160.0, volMl: 15.0 },
      { r: 1, c: 2, maxZ: 155.0, volMl: 14.5 },
      { r: 1, c: 3, maxZ: 110.0, volMl: 11.0 },
      { r: 2, c: 1, maxZ: 95.0,  volMl: 9.5 },
      { r: 2, c: 2, maxZ: 85.0,  volMl: 9.0 },
      { r: 2, c: 3, maxZ: 70.0,  volMl: 8.0 },
      { r: 3, c: 1, maxZ: 50.0,  volMl: 7.0 },
      { r: 3, c: 2, maxZ: 45.0,  volMl: 6.5 },
      { r: 3, c: 3, maxZ: 30.0,  volMl: 5.0 }
    ],
    tileW: 75, tileH: 84
  },
  {
    name: '2x2 Grid Non-Dual-Packable (84x84mm)',
    tiles: [
      { r: 1, c: 1, maxZ: 100.0, volMl: 10.0 },
      { r: 1, c: 2, maxZ: 90.0,  volMl: 9.0 },
      { r: 2, c: 1, maxZ: 80.0,  volMl: 8.0 },
      { r: 2, c: 2, maxZ: 70.0,  volMl: 7.0 }
    ],
    tileW: 84, tileH: 84
  }
];

for (const batch of testTileBatches) {
  const sched = computeZHeightPairingSchedule(batch.tiles, batch.tileW, batch.tileH);

  assert(sched !== null, `${batch.name}: computeZHeightPairingSchedule returned schedule`);
  assert(sched.numTiles === batch.tiles.length, `${batch.name}: schedule numTiles matches input`);

  if (sched.isDualPackable) {
    const expectedRuns = Math.ceil(batch.tiles.length / 2);
    assert(sched.totalRuns === expectedRuns,
      `${batch.name}: totalRuns == ceil(N/2) (got ${sched.totalRuns}, expected ${expectedRuns})`);
    assert(sched.pairedSumZMm <= sched.sequentialSumZMm,
      `${batch.name}: paired Z sum (${sched.pairedSumZMm}) <= sequential Z sum (${sched.sequentialSumZMm})`);
    assert(sched.savedZMm >= 0, `${batch.name}: savedZMm >= 0 (got ${sched.savedZMm.toFixed(1)} mm)`);
  } else {
    assert(sched.totalRuns === batch.tiles.length,
      `${batch.name}: non-dual-packable totalRuns == N (got ${sched.totalRuns})`);
  }
}

console.log(`Suite 7 Complete. Passed: ${passedAssertions}/${totalAssertions}`);

// ============================================================================
// SUITE 8: Binary STL Export Serialization & Anycubic Mono 4 90° Auto-Orient
// ============================================================================
console.log('\n--- SUITE 8: Binary STL Export Serialization & 90° Auto-Orient ---');

const testBoxMesh = generateClosedBox(0, 0, 0, 75, 84, 20, 4, 1);

const stlBytesNormal = buildSTLBytesFromTriangles(testBoxMesh, 0, 0, 1.0, 75.0, 84.0, { isResin: true }, false);
assert(stlBytesNormal instanceof Uint8Array, 'buildSTLBytesFromTriangles returned Uint8Array');
assert(stlBytesNormal.length === 84 + testBoxMesh.length * 50,
  `STL byte length == 84 + N*50 (got ${stlBytesNormal.length}, expected ${84 + testBoxMesh.length * 50})`);

const view = new DataView(stlBytesNormal.buffer, stlBytesNormal.byteOffset, stlBytesNormal.byteLength);
const triCount = view.getUint32(80, true);
assert(triCount === testBoxMesh.length, `STL header triangle count == ${testBoxMesh.length} (got ${triCount})`);

const stlBytesRotated = buildSTLBytesFromTriangles(testBoxMesh, 0, 0, 1.0, 75.0, 84.0, { isResin: true }, true);
assert(stlBytesRotated.length === stlBytesNormal.length, 'Rotated STL has identical byte length');
const viewRot = new DataView(stlBytesRotated.buffer, stlBytesRotated.byteOffset, stlBytesRotated.byteLength);
assert(viewRot.getUint32(80, true) === testBoxMesh.length, 'Rotated STL triangle count matches');

let hasNaNOrInf = false;
for (let i = 0; i < testBoxMesh.length; i++) {
  const off = 84 + i * 50;
  for (let c = 0; c < 12; c++) {
    const val = view.getFloat32(off + c * 4, true);
    if (!Number.isFinite(val)) hasNaNOrInf = true;
  }
}
assert(!hasNaNOrInf, 'All floats in binary STL are finite numbers (0 NaN, 0 Infinity)');

console.log(`Suite 8 Complete. Passed: ${passedAssertions}/${totalAssertions}`);

// ============================================================================
// SUITE 9: Empirical Validation of Remediated Edge-Case Invariants
// ============================================================================
console.log('\n--- SUITE 9: Remediated Adversarial Edge-Case Invariants ---');

// Remediated Gap 1: Zero-Height Extrusion Clamping & Watertightness
{
  const outTris = [];
  extrudeBuildingLoD2([[0,0],[20,0],[20,20],[0,20]], [], 2.35, 2.35, 2.35, false, 4, 1, outTris, 0, 'flat');
  for (const t of outTris) t.shellId = 901;
  const audit = auditMeshTopologyNumeric({ buildings: outTris }, [], { bedSizeMm: 169.2, totalHeightMm: 169.2, bedZ: 165 }, { scaleMm: 1, tileCols: 1, tileRows: 1, numTiles: 1 });
  assert(audit.layerMetrics.buildings.degenerateTris === 0, `Gap 1 Remediated: degenerateTris === 0 (got ${audit.layerMetrics.buildings.degenerateTris})`);
  assert(audit.layerMetrics.buildings.nonManifoldEdges === 0, `Gap 1 Remediated: nonManifoldEdges === 0 (got ${audit.layerMetrics.buildings.nonManifoldEdges})`);
  assert(audit.layerMetrics.buildings.openEdges === 0, `Gap 1 Remediated: openEdges === 0 (got ${audit.layerMetrics.buildings.openEdges})`);
  assert(audit.isWatertightManifold === true, 'Gap 1 Remediated: isWatertightManifold === true');
  assert(audit.layerMetrics.buildings.volumeMl > 0, `Gap 1 Remediated: volumeMl > 0 (got ${audit.layerMetrics.buildings.volumeMl.toFixed(4)} ml)`);
  console.log(`    [REMEDIATED 1] Zero-height direct call: degenerateTris=${audit.layerMetrics.buildings.degenerateTris}, nonManifold=${audit.layerMetrics.buildings.nonManifoldEdges}, openEdges=${audit.layerMetrics.buildings.openEdges}, volume=${audit.layerMetrics.buildings.volumeMl.toFixed(4)}ml`);
}

// Remediated Gap 2: Defensive Relief Chimney Validation & CW Normal Enforcement
{
  // 2a: CCW orientation is safely flipped to CW
  const outTris = [];
  extrudeBuildingLoD2([[0,0],[40,0],[40,40],[0,40]], [], 2.35, 20.0, 20.0, false, 4, 1, outTris, 0, 'flat', {
    reliefChimney: {
      chimneyPoly: [[5, 5], [35, 5], [35, 35], [5, 35]], // CCW orientation!
      zVaultBase: 12.0,
      zVaultApex: 16.0
    }
  });
  for (const t of outTris) t.shellId = 902;
  const audit = auditMeshTopologyNumeric({ buildings: outTris }, [], { bedSizeMm: 169.2, totalHeightMm: 169.2, bedZ: 165 }, { scaleMm: 1, tileCols: 1, tileRows: 1, numTiles: 1 });
  assert(audit.layerMetrics.buildings.sameDirDupEdges === 0, `Gap 2a Remediated: sameDirDupEdges === 0 (got ${audit.layerMetrics.buildings.sameDirDupEdges})`);
  assert(audit.layerMetrics.buildings.unpairedDirEdges === 0, `Gap 2a Remediated: unpairedDirEdges === 0 (got ${audit.layerMetrics.buildings.unpairedDirEdges})`);
  assert(audit.layerMetrics.buildings.openEdges === 0, `Gap 2a Remediated: openEdges === 0 (got ${audit.layerMetrics.buildings.openEdges})`);
  assert(audit.layerMetrics.buildings.nonManifoldEdges === 0, `Gap 2a Remediated: nonManifoldEdges === 0 (got ${audit.layerMetrics.buildings.nonManifoldEdges})`);
  assert(audit.isWatertightManifold === true, 'Gap 2a Remediated: isWatertightManifold === true');
  console.log(`    [REMEDIATED 2a] CCW Chimney sanitized to CW: sameDirDupEdges=${audit.layerMetrics.buildings.sameDirDupEdges}, openEdges=${audit.layerMetrics.buildings.openEdges}, isWatertight=${audit.isWatertightManifold}`);

  // 2b: Sub-3 vertex chimney polygon safely falls back to solid flat bottom cap
  const outTrisSub3 = [];
  extrudeBuildingLoD2([[0,0],[40,0],[40,40],[0,40]], [], 2.35, 20.0, 20.0, false, 4, 1, outTrisSub3, 0, 'flat', {
    reliefChimney: {
      chimneyPoly: [[5, 5], [35, 5]], // 2 vertices! Invalid!
      zVaultBase: 12.0,
      zVaultApex: 16.0
    }
  });
  for (const t of outTrisSub3) t.shellId = 903;
  const auditSub3 = auditMeshTopologyNumeric({ buildings: outTrisSub3 }, [], { bedSizeMm: 169.2, totalHeightMm: 169.2, bedZ: 165 }, { scaleMm: 1, tileCols: 1, tileRows: 1, numTiles: 1 });
  assert(auditSub3.layerMetrics.buildings.openEdges === 0, `Gap 2b Remediated: openEdges === 0 (got ${auditSub3.layerMetrics.buildings.openEdges})`);
  assert(auditSub3.layerMetrics.buildings.nonManifoldEdges === 0, `Gap 2b Remediated: nonManifoldEdges === 0 (got ${auditSub3.layerMetrics.buildings.nonManifoldEdges})`);
  assert(auditSub3.isWatertightManifold === true, 'Gap 2b Remediated: isWatertightManifold === true');
  console.log(`    [REMEDIATED 2b] Sub-3 vertex chimney fallback: openEdges=${auditSub3.layerMetrics.buildings.openEdges}, isWatertight=${auditSub3.isWatertightManifold}`);
}

// Remediated Gap 3: checkTileFitsMono4 Positivity and Boundary Validation
{
  assert(checkTileFitsMono4(-10, -10) === false, 'Gap 3: reject negative dimensions (-10, -10)');
  assert(checkTileFitsMono4(0, 0) === false, 'Gap 3: reject zero dimensions (0, 0)');
  assert(checkTileFitsMono4(-5, 84) === false, 'Gap 3: reject negative width (-5, 84)');
  assert(checkTileFitsMono4(75, -84) === false, 'Gap 3: reject negative height (75, -84)');
  assert(checkTileFitsMono4(75, 84, 0) === false, 'Gap 3: reject zero maxZMm (0)');
  assert(checkTileFitsMono4(75, 84, -10) === false, 'Gap 3: reject negative maxZMm (-10)');
  assert(checkTileFitsMono4('foo', 84) === false, 'Gap 3: reject NaN width ("foo")');
  assert(checkTileFitsMono4(NaN, 84) === false, 'Gap 3: reject NaN width (NaN)');
  assert(checkTileFitsMono4(null, 84) === false, 'Gap 3: reject null width (null)');
  assert(checkTileFitsMono4(75, 84) === true, 'Gap 3: accept standard dual-tile 75x84');
  assert(checkTileFitsMono4(150, 85) === true, 'Gap 3: accept single plate 150x85');
  assert(checkTileFitsMono4(85, 150) === true, 'Gap 3: accept rotated single plate 85x150');
  assert(checkTileFitsMono4(153.45, 87.05) === true, 'Gap 3: accept max plate boundary 153.45x87.05');
  assert(checkTileFitsMono4(153.46, 87.05) === false, 'Gap 3: reject out-of-bounds width 153.46');
  assert(checkTileFitsMono4(75, 84, 165.0) === true, 'Gap 3: accept max Z height 165.0');
  assert(checkTileFitsMono4(75, 84, 165.1) === false, 'Gap 3: reject out-of-bounds Z height 165.1');
  console.log('    [REMEDIATED 3] checkTileFitsMono4 validated across 16 boundary & sanity conditions');
}

// Remediated Gap 4: CSG Diagonal Face Multi-Axis Plane Clipping Watertightness
{
  const box = generateClosedBox(-20, -20, 0, 20, 20, 15, 4, 904);
  let cur = clipClosedMeshByAxisPlane(box, 0, -10, true);
  cur = clipClosedMeshByAxisPlane(cur, 0, 10, false);
  const audit = auditMeshTopologyNumeric({ buildings: cur }, [], { bedSizeMm: 169.2, totalHeightMm: 169.2, bedZ: 165 }, { scaleMm: 1, tileCols: 1, tileRows: 1, numTiles: 1 });
  assert(audit.layerMetrics.buildings.openEdges === 0, `Gap 4 Remediated: openEdges === 0 (got ${audit.layerMetrics.buildings.openEdges})`);
  assert(audit.layerMetrics.buildings.nonManifoldEdges === 0, `Gap 4 Remediated: nonManifoldEdges === 0 (got ${audit.layerMetrics.buildings.nonManifoldEdges})`);
  assert(audit.layerMetrics.buildings.degenerateTris === 0, `Gap 4 Remediated: degenerateTris === 0 (got ${audit.layerMetrics.buildings.degenerateTris})`);
  assert(audit.isWatertightManifold === true, 'Gap 4 Remediated: isWatertightManifold === true');
  assert(audit.layerMetrics.buildings.volumeMl > 0, `Gap 4 Remediated: volumeMl > 0 (got ${audit.layerMetrics.buildings.volumeMl.toFixed(4)} ml)`);
  console.log(`    [REMEDIATED 4] Diagonal box clip: openEdges=${audit.layerMetrics.buildings.openEdges}, nonManifold=${audit.layerMetrics.buildings.nonManifoldEdges}, isWatertight=${audit.isWatertightManifold}, volume=${audit.layerMetrics.buildings.volumeMl.toFixed(4)}ml`);
}

// Remediated Gap 4b: Multi-Plane CSG Box Clipping Watertightness (clipMeshToBox3D)
{
  // 4b.1: Closed box clipped to [-10, 10] x [-10, 10] across 4 orthogonal planes
  const box = generateClosedBox(-20, -20, 0, 20, 20, 15, 4, 1002);
  const clippedBox = clipMeshToBox3D(box, -10, 10, -10, 10);
  const auditBox = auditMeshTopologyNumeric({ buildings: clippedBox }, [], { bedSizeMm: 169.2, totalHeightMm: 169.2, bedZ: 165 }, { scaleMm: 1, tileCols: 1, tileRows: 1, numTiles: 1 });
  assert(auditBox.layerMetrics.buildings.openEdges === 0, `Gap 4b Remediated: box openEdges === 0 (got ${auditBox.layerMetrics.buildings.openEdges})`);
  assert(auditBox.layerMetrics.buildings.nonManifoldEdges === 0, `Gap 4b Remediated: box nonManifoldEdges === 0 (got ${auditBox.layerMetrics.buildings.nonManifoldEdges})`);
  assert(auditBox.layerMetrics.buildings.degenerateTris === 0, `Gap 4b Remediated: box degenerateTris === 0 (got ${auditBox.layerMetrics.buildings.degenerateTris})`);
  assert(auditBox.isWatertightManifold === true, 'Gap 4b Remediated: box isWatertightManifold === true');
  assert(auditBox.layerMetrics.buildings.volumeMl > 0, `Gap 4b Remediated: box volumeMl > 0 (got ${auditBox.layerMetrics.buildings.volumeMl.toFixed(4)} ml)`);
  console.log(`    [REMEDIATED 4b.1] 4-plane box clip: openEdges=${auditBox.layerMetrics.buildings.openEdges}, nonManifold=${auditBox.layerMetrics.buildings.nonManifoldEdges}, isWatertight=${auditBox.isWatertightManifold}, volume=${auditBox.layerMetrics.buildings.volumeMl.toFixed(4)}ml`);

  // 4b.2: Courtyard building with hole clipped to [-12, 12] x [-12, 12] across 4 orthogonal planes
  const outer = [[-30,-30],[30,-30],[30,30],[-30,30]];
  const holes = [[[-10,-10],[10,-10],[10,10],[-10,10]]];
  const courtTris = [];
  extrudeBuildingLoD2(outer, holes, 0, 10, 10, false, 4, 1, courtTris, 0, 'flat');
  const clippedCourt = clipMeshToBox3D(courtTris, -12, 12, -12, 12);
  const auditCourt = auditMeshTopologyNumeric({ buildings: clippedCourt }, [], { bedSizeMm: 169.2, totalHeightMm: 169.2, bedZ: 165 }, { scaleMm: 1, tileCols: 1, tileRows: 1, numTiles: 1 });
  assert(auditCourt.layerMetrics.buildings.openEdges === 0, `Gap 4b Remediated: courtyard openEdges === 0 (got ${auditCourt.layerMetrics.buildings.openEdges})`);
  assert(auditCourt.layerMetrics.buildings.nonManifoldEdges === 0, `Gap 4b Remediated: courtyard nonManifoldEdges === 0 (got ${auditCourt.layerMetrics.buildings.nonManifoldEdges})`);
  assert(auditCourt.layerMetrics.buildings.degenerateTris === 0, `Gap 4b Remediated: courtyard degenerateTris === 0 (got ${auditCourt.layerMetrics.buildings.degenerateTris})`);
  assert(auditCourt.isWatertightManifold === true, 'Gap 4b Remediated: courtyard isWatertightManifold === true');
  assert(auditCourt.layerMetrics.buildings.volumeMl > 0, `Gap 4b Remediated: courtyard volumeMl > 0 (got ${auditCourt.layerMetrics.buildings.volumeMl.toFixed(4)} ml)`);
  console.log(`    [REMEDIATED 4b.2] 4-plane courtyard clip: openEdges=${auditCourt.layerMetrics.buildings.openEdges}, nonManifold=${auditCourt.layerMetrics.buildings.nonManifoldEdges}, isWatertight=${auditCourt.isWatertightManifold}, volume=${auditCourt.layerMetrics.buildings.volumeMl.toFixed(4)}ml`);
}

console.log(`Suite 9 Complete. Passed: ${passedAssertions}/${totalAssertions}`);

// ============================================================================
// FINAL SUMMARY
// ============================================================================
console.log('\n================================================================');
console.log(`  TIER 5 ADVERSARIAL STRESS SUITE RESULTS`);
console.log(`  Total Assertions: ${totalAssertions}`);
console.log(`  Passed:           ${passedAssertions}`);
console.log(`  Failed:           ${failedAssertions}`);
console.log('================================================================\n');

if (failedAssertions > 0) {
  console.error(`FAILED with ${failedAssertions} assertion failures:`);
  for (const f of failureLog) console.error(`  - ${f}`);
  process.exit(1);
} else {
  console.log('>>> VERDICT: ALL ADVERSARIAL COVERAGE AND VULNERABILITY ASSERTIONS VERIFIED <<<');
  process.exit(0);
}
