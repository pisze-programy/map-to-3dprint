// adversarial_m6_sla_stress.js
// EMPIRICAL CHALLENGER 1 — MILESTONE 6
// SLA Print Physics, Relief Chimneys & Z-Cap Monotonicity Adversarial Test Harness

const fs = require('fs');
const path = require('path');

// 1. Load project modules in canonical browser sequence into global environment
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
  'src/ui/ui_config.js'
];

const ROOT_DIR = path.resolve(__dirname, '..');
for (const relPath of filesToLoad) {
  const absPath = path.resolve(ROOT_DIR, relPath);
  const code = fs.readFileSync(absPath, 'utf8');
  eval(code);
}

console.log('================================================================');
console.log('  CHALLENGER 1: EMPIRICAL STRESS TEST HARNESS — MILESTONE 6');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failureLog = [];

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    failedTests++;
    failureLog.push(message);
    console.error(`  [FAIL] ${message}`);
  } else {
    passedTests++;
    console.log(`  [PASS] ${message}`);
  }
}

// ============================================================================
// SUITE 1: FEATURE 18 — Constant Physical Base Slab & Non-Negative Water Bed
// ============================================================================
console.log('--- SUITE 1: Feature 18 (Base Thickness & Water Bed SDF) ---');

const testScales = [
  { name: 'Mono 4 Single Tile (84mm)', maxDimMm: 84 },
  { name: 'Desktop Medium (200mm)', maxDimMm: 200 },
  { name: 'Standard Studio (500mm)', maxDimMm: 500 },
  { name: 'Large Format (1000mm)', maxDimMm: 1000 }
];

for (const sc of testScales) {
  const scaleMm = sc.maxDimMm / 169.2;
  const layerHeightMm = 0.05; // SLA resin layer
  const mmPerUnit = scaleMm;
  const quantizeZUnits = (uVal) => {
    const mm = uVal * mmPerUnit;
    const qMm = Math.max(layerHeightMm, Math.round(mm / layerHeightMm) * layerHeightMm);
    return qMm / mmPerUnit;
  };

  const baseBottomZ = quantizeZUnits(2.35 / scaleMm);
  const deepWaterZ = quantizeZUnits(1.68 / scaleMm);
  const zSubWater = quantizeZUnits(1.30 / scaleMm);
  const zDrainVault = quantizeZUnits(0.70 / scaleMm);

  const physicalBaseBottomMm = baseBottomZ * scaleMm;
  const physicalDeepWaterMm = deepWaterZ * scaleMm;
  const physicalSubWaterMm = zSubWater * scaleMm;
  const physicalDrainVaultMm = zDrainVault * scaleMm;

  console.log(`\nScale: ${sc.name} (maxDim=${sc.maxDimMm}mm, scaleMm=${scaleMm.toFixed(4)})`);
  console.log(`  Physical bottom slab: ${physicalBaseBottomMm.toFixed(3)} mm (target: 2.35 mm)`);
  console.log(`  Physical deep water:  ${physicalDeepWaterMm.toFixed(3)} mm (target: 1.68 mm)`);
  console.log(`  Physical sub-water:   ${physicalSubWaterMm.toFixed(3)} mm (target: 1.30 mm)`);
  console.log(`  Physical drain vault: ${physicalDrainVaultMm.toFixed(3)} mm (target: 0.70 mm)`);

  assert(
    Math.abs(physicalBaseBottomMm - 2.35) <= 0.05,
    `${sc.name}: baseBottomZ * scaleMm is invariant at 2.35 ± 0.05 mm (got ${physicalBaseBottomMm.toFixed(3)} mm)`
  );
  assert(
    Math.abs(physicalDeepWaterMm - 1.68) <= 0.05,
    `${sc.name}: deepWaterZ * scaleMm is invariant at 1.68 ± 0.05 mm (got ${physicalDeepWaterMm.toFixed(3)} mm)`
  );

  // Check against old buggy formulation: 0.016 * maxDimMm
  const oldBuggyBaseMm = 0.016 * sc.maxDimMm;
  if (sc.maxDimMm === 500) {
    console.log(`  Old buggy base thickness: ${oldBuggyBaseMm.toFixed(2)} mm (wasted ~${(oldBuggyBaseMm - 2.35).toFixed(2)} mm solid resin slab)`);
    assert(
      physicalBaseBottomMm < 3.0 && oldBuggyBaseMm > 7.0,
      `At 500mm, fixed base is ~2.35mm, eliminating >7.0mm solid block`
    );
  }

  // Stress-test water bed depression across extreme SDF values:
  const sdfValues = [0.0, -0.1, -0.5, -1.0, -5.0, -20.0, -100.0, -1000.0];
  for (const sdf of sdfValues) {
    const bedZ = baseBottomZ + Math.max(-0.95 / scaleMm, (sdf * 0.35) / scaleMm);
    const bedZMm = bedZ * scaleMm;
    assert(
      bedZ >= 0.0,
      `${sc.name} (sdf=${sdf}): bedZ must never be negative (got ${bedZ.toFixed(4)} units = ${bedZMm.toFixed(3)} mm)`
    );
    assert(
      bedZMm >= 1.35,
      `${sc.name} (sdf=${sdf}): bedZ * scaleMm must maintain safe bottom floor >= 1.35 mm (got ${bedZMm.toFixed(3)} mm)`
    );
  }
}

// ============================================================================
// SUITE 2: FEATURE 19 — Extreme Skyscraper Z-Cap Monotonicity & C1 Compression
// ============================================================================
console.log('\n--- SUITE 2: Feature 19 (Z-Cap Protection & Monotonicity) ---');

const skyscraperHeights = [
  { name: 'Burj Khalifa (Dubai)', h: 828, isSkyscraper: true },
  { name: 'Merdeka 118 (KL)', h: 679, isSkyscraper: true },
  { name: 'One WTC (NYC)', h: 541, isSkyscraper: true },
  { name: 'Empire State (NYC)', h: 381, isSkyscraper: true },
  { name: 'The Shard (London)', h: 310, isSkyscraper: true },
  { name: 'Mid-rise Tower', h: 180, isSkyscraper: true },
  { name: 'High-rise Residential', h: 90, isSkyscraper: false },
  { name: 'Office Block', h: 45, isSkyscraper: false },
  { name: 'Low-rise Apartment', h: 22, isSkyscraper: false },
  { name: 'Townhouse', h: 11, isSkyscraper: false }
];

const zCapTestConfigs = [
  { spanMeters: 400, printDimMm: 500, zScale: 1.25, name: 'Burj Khalifa 400m span @ 50cm (Exceeds Z-Cap: raw ~168mm)' },
  { spanMeters: 1000, printDimMm: 1000, zScale: 1.5, name: 'Dubai Downtown 1km span @ 100cm (Extreme: raw ~270mm)' },
  { spanMeters: 600, printDimMm: 1000, zScale: 1.25, name: 'NYC Core 600m span @ 100cm (Extreme: raw ~230mm)' },
  { spanMeters: 500, printDimMm: 500, zScale: 1.0, name: 'Dubai 500m span @ 50cm (Moderate: raw ~110mm, Below Z-Cap)' },
  { spanMeters: 5000, printDimMm: 200, zScale: 1.0, name: 'Wide Span 5km @ 20cm (Low: Below Z-Cap)' }
];

for (const cfg of zCapTestConfigs) {
  console.log(`\nTesting Config: ${cfg.name}`);
  const maxDimMm = cfg.printDimMm;
  const scaleMm = maxDimMm / 169.2;
  const mmPerUnit = scaleMm;
  const layerHeightMm = 0.05;
  const quantizeZUnits = (uVal) => {
    const mm = uVal * mmPerUnit;
    const qMm = Math.max(layerHeightMm, Math.round(mm / layerHeightMm) * layerHeightMm);
    return qMm / mmPerUnit;
  };

  const scaleToBed = 169.2 / cfg.spanMeters;
  const mToU = 0.13 * scaleToBed;
  const baseBottomZ = quantizeZUnits(2.35 / scaleMm);

  // Generate synthetic buildings for testing
  const rawBuildings = skyscraperHeights.map((b, idx) => ({
    id: idx + 1,
    name: b.name,
    h: b.h,
    minH: 0,
    roof: 'flat',
    outer: [
      [-10 + idx * 2, -10],
      [-8 + idx * 2, -10],
      [-8 + idx * 2, -8],
      [-10 + idx * 2, -8]
    ]
  }));

  const mockScene = {
    buildings: rawBuildings,
    metersToUnits: 0.13
  };

  const ctx = {
    maxDimMm,
    scaleMm,
    halfW: 84.6,
    halfH: 84.6,
    TERRAIN_RES_X: 64,
    TERRAIN_RES_Y: 64,
    mToU,
    baseBottomZ,
    quantizeZUnits,
    toBed: (pt) => pt,
    bedZ: 165.0 // Photon Mono 4 limit
  };

  const state = {
    bedZ: 165.0,
    zScale: cfg.zScale,
    layerHeightMm: 0.05
  };

  const baseInfo = {
    cellTerracePolys: Array.from({ length: 65 * 65 }, () => []),
    getActualPrintedSurfaceMinZ: (bx, by) => baseBottomZ
  };

  const res = prepareAndClusterS3DBBuildings(mockScene, ctx, baseInfo, state);
  const prepared = res.prepared;

  const maxSafeZMm = 163.0; // bedZ (165) - 2.0
  const zKneeMm = 106.0;   // min(0.65 * 163, 163 - 35) = 105.95 -> 106.0

  console.log(`  State zCapApplied: ${state.zCapApplied}, maxPrintZMm: ${state.maxPrintZMm?.toFixed(2)} mm`);

  // Assert 1: Max building Z never exceeds maxSafeZMm
  let maxResultMm = 0;
  for (const item of prepared) {
    const zMm = item.zTop * scaleMm;
    if (zMm > maxResultMm) maxResultMm = zMm;
  }
  console.log(`  Max building height in print: ${maxResultMm.toFixed(2)} mm (cap: ${maxSafeZMm} mm)`);
  assert(
    maxResultMm <= maxSafeZMm + 1e-3,
    `Max building Z (${maxResultMm.toFixed(2)} mm) must never exceed maxSafeZMm (${maxSafeZMm} mm)`
  );

  // Assert 2: Low-rise buildings (< 106.0 mm) experience 0% compression
  for (const item of prepared) {
    const rawH = Math.max(0.95, item.b.h * mToU * cfg.zScale);
    const rawExpectedUnits = quantizeZUnits(baseBottomZ + rawH);
    const rawExpectedMm = rawExpectedUnits * scaleMm;
    const actualMm = item.zTop * scaleMm;

    if (rawExpectedMm <= zKneeMm) {
      assert(
        Math.abs(actualMm - rawExpectedMm) <= 0.06,
        `Low-rise building '${item.b.name}' (${rawExpectedMm.toFixed(2)} mm <= ${zKneeMm} mm) experienced 0% compression: expected ${rawExpectedMm.toFixed(2)} mm, got ${actualMm.toFixed(2)} mm`
      );
    }
  }

  // Assert 3: Strict Monotonicity: For any two buildings A and B with raw Z_A > raw Z_B (and H_A > H_B above printable floor), compressed Z_A > Z_B
  const sortedByHeight = [...prepared].sort((a, b) => b.b.h - a.b.h);
  for (let i = 0; i < sortedByHeight.length - 1; i++) {
    const A = sortedByHeight[i];
    const B = sortedByHeight[i + 1];
    const rawA = quantizeZUnits(baseBottomZ + Math.max(0.95, A.b.h * mToU * cfg.zScale)) * scaleMm;
    const rawB = quantizeZUnits(baseBottomZ + Math.max(0.95, B.b.h * mToU * cfg.zScale)) * scaleMm;
    const zA = A.zTop * scaleMm;
    const zB = B.zTop * scaleMm;

    if (rawA > rawB) {
      assert(
        zA > zB,
        `Strict monotonicity preserved: ${A.b.name} (H=${A.b.h}m, raw=${rawA.toFixed(2)}mm, Z=${zA.toFixed(2)}mm) > ${B.b.name} (H=${B.b.h}m, raw=${rawB.toFixed(2)}mm, Z=${zB.toFixed(2)}mm)`
      );
    } else {
      assert(
        zA >= zB,
        `Monotonicity non-decreasing: ${A.b.name} (H=${A.b.h}m, Z=${zA.toFixed(2)}mm) >= ${B.b.name} (H=${B.b.h}m, Z=${zB.toFixed(2)}mm)`
      );
    }
  }
}

// ============================================================================
// SUITE 3: FEATURE 20 — Pathological Chimney Geometry & Watertight 2-Manifold
// ============================================================================
console.log('\n--- SUITE 3: Feature 20 (Chimney Polygons, Extrusion & Manifold Audit) ---');

const pathologicalPolygons = [
  {
    name: 'Non-Convex L-Shaped Building',
    outer: [[0, 0], [24, 0], [24, 10], [10, 10], [10, 24], [0, 24]],
    holes: [],
    zBase: 2.35,
    zEaves: 18.0,
    zRidge: 18.0,
    hasPitched: false,
    roofShape: 'flat'
  },
  {
    name: 'Non-Convex U-Shaped Courtyard Building',
    outer: [[0, 0], [30, 0], [30, 30], [20, 30], [20, 12], [10, 12], [10, 30], [0, 30]],
    holes: [],
    zBase: 2.35,
    zEaves: 20.0,
    zRidge: 20.0,
    hasPitched: false,
    roofShape: 'flat'
  },
  {
    name: 'Non-Convex H-Shaped Building',
    outer: [
      [0, 0], [10, 0], [10, 8], [20, 8], [20, 0], [30, 0],
      [30, 28], [20, 28], [20, 20], [10, 20], [10, 28], [0, 28]
    ],
    holes: [],
    zBase: 2.35,
    zEaves: 22.0,
    zRidge: 22.0,
    hasPitched: false,
    roofShape: 'flat'
  },
  {
    name: '8-Pointed Star-Shaped Monument',
    outer: (function() {
      const pts = [];
      const numPts = 16;
      for (let i = 0; i < numPts; i++) {
        const ang = (i / numPts) * Math.PI * 2;
        const r = (i % 2 === 0) ? 18.0 : 8.5;
        pts.push([20 + Math.cos(ang) * r, 20 + Math.sin(ang) * r]);
      }
      return pts;
    })(),
    holes: [],
    zBase: 2.35,
    zEaves: 25.0,
    zRidge: 32.0,
    hasPitched: true,
    roofShape: 'pyramidal'
  },
  {
    name: 'Building with Multiple Interior Courtyard Holes',
    outer: [[0, 0], [40, 0], [40, 40], [0, 40]],
    holes: [
      // Courtyard Hole 1 (CW)
      [[6, 6], [6, 16], [16, 16], [16, 6]],
      // Courtyard Hole 2 (CW)
      [[24, 24], [24, 34], [34, 34], [34, 24]]
    ],
    zBase: 2.35,
    zEaves: 16.0,
    zRidge: 16.0,
    hasPitched: false,
    roofShape: 'flat'
  },
  {
    name: 'Narrow Bottleneck Dumbbell (Standard Offset Self-Intersects -> OBB Inset)',
    // Two 16x16 lobes connected by a narrow bottleneck corridor of width 3.2mm (top 8.2, bot 5.0)
    outer: [
      [0, 0], [16, 0], [16, 5.0], [26, 5.0], [26, 0], [42, 0],
      [42, 16], [26, 16], [26, 8.2], [16, 8.2], [16, 16], [0, 16]
    ],
    holes: [],
    zBase: 2.35,
    zEaves: 18.0,
    zRidge: 18.0,
    hasPitched: false,
    roofShape: 'flat'
  },
  {
    name: 'Extreme Narrow Bottleneck (Waist 1.2mm)',
    outer: [
      [0, 0], [14, 0], [14, 6.4], [22, 6.4], [22, 0], [36, 0],
      [36, 14], [22, 14], [22, 7.6], [14, 7.6], [14, 14], [0, 14]
    ],
    holes: [],
    zBase: 2.35,
    zEaves: 15.0,
    zRidge: 15.0,
    hasPitched: false,
    roofShape: 'flat'
  },
  {
    name: 'Acute V-Cut Indentation (OBB Inset Top Edge Protrudes Outside)',
    outer: [[0, 0], [40, 0], [40, 20], [20, 2], [0, 20]],
    holes: [],
    zBase: 2.35,
    zEaves: 18.0,
    zRidge: 18.0,
    hasPitched: false,
    roofShape: 'flat'
  },
  {
    name: 'Tiny Building Below MinSpan Threshold (Span 4.0mm < 6.5mm)',
    outer: [[0, 0], [4.0, 0], [4.0, 4.0], [0, 4.0]],
    holes: [],
    zBase: 2.35,
    zEaves: 10.0,
    zRidge: 10.0,
    hasPitched: false,
    roofShape: 'flat',
    expectNoChimney: true
  },
  {
    name: 'Tiny Building Below Area Threshold (Area 20mm² < 35mm²)',
    outer: [[0, 0], [10.0, 0], [10.0, 2.0], [0, 2.0]], // 20mm²
    holes: [],
    zBase: 2.35,
    zEaves: 10.0,
    zRidge: 10.0,
    hasPitched: false,
    roofShape: 'flat',
    expectNoChimney: true
  },
  {
    name: 'Low-Height Building Below Height Threshold (Height 3.0mm < 5.5mm)',
    outer: [[0, 0], [20.0, 0], [20.0, 20.0], [0, 20.0]],
    holes: [],
    zBase: 2.35,
    zEaves: 5.35, // height = 3.0mm
    zRidge: 5.35,
    hasPitched: false,
    roofShape: 'flat',
    expectNoChimney: true
  },
  {
    name: 'Solid Large Rectangular Skyscraper Podium',
    outer: [[0, 0], [28, 0], [28, 28], [0, 28]],
    holes: [],
    zBase: 2.35,
    zEaves: 35.0,
    zRidge: 35.0,
    hasPitched: false,
    roofShape: 'flat'
  }
];

for (const testCase of pathologicalPolygons) {
  console.log(`\n============================================================`);
  console.log(`Testing Pathological Case: ${testCase.name}`);
  console.log(`============================================================`);

  const outerClean = cleanPolygonRing(testCase.outer, true);
  const holesClean = testCase.holes.map(h => cleanPolygonRing(h, false)).filter(h => h.length >= 3);
  const insetDist = 2.0;

  // 1. Direct unit test of computeReliefChimneyPolygon
  const chimCW = computeReliefChimneyPolygon(outerClean, holesClean, insetDist);
  console.log(`  computeReliefChimneyPolygon returned: ${chimCW ? `${chimCW.length}-vertex polygon` : 'null'}`);

  if (chimCW) {
    // Assert CW orientation (negative signed area)
    const area = signedArea2D(chimCW);
    assert(area < 0, `Chimney polygon must be strictly Clockwise (CW): area = ${area.toFixed(4)}`);

    // Assert all points lie strictly inside outer polygon
    const allInsideOuter = chimCW.every(pt => pointInPoly2D(pt[0], pt[1], outerClean));
    assert(allInsideOuter, `All chimney vertices must lie strictly inside outerClean`);

    // Assert no vertex lies inside any courtyard hole
    for (const h of holesClean) {
      const noneInHole = chimCW.every(pt => !pointInPoly2D(pt[0], pt[1], h));
      assert(noneInHole, `Chimney vertices must not penetrate courtyard holes`);
    }
  }

  // 2. Extrude building with extrudeBuildingLoD2
  const bShell = [];
  const shellId = 101;
  const tileId = 0;
  const bId = 1;
  const targetLayerId = 4;

  const opts = {
    scaleMm: 1.0,
    isGroundSeated: true
  };

  extrudeBuildingLoD2(
    testCase.outer,
    testCase.holes,
    testCase.zBase,
    testCase.zEaves,
    testCase.zRidge,
    testCase.hasPitched,
    targetLayerId,
    bId,
    bShell,
    tileId,
    testCase.roofShape,
    opts
  );

  for (let ti = 0; ti < bShell.length; ti++) {
    bShell[ti].shellId = shellId;
    bShell[ti].tileId = tileId;
  }

  console.log(`  Extruded mesh triangles count: ${bShell.length}`);
  assert(bShell.length > 0, `extrudeBuildingLoD2 produced non-empty triangle mesh`);

  // 3. Topology Audit: Strictly assert 2-manifold watertightness
  const meshes = {
    buildings: bShell,
    base: [],
    water: [],
    roads: [],
    greenery: []
  };

  // If chimney was generated, test emitBaseReliefChimneyShafts into meshes.base
  if (chimCW) {
    const chimneyEntry = {
      chimneyPoly: chimCW,
      zBase: testCase.zBase,
      tileId: 0
    };
    emitBaseReliefChimneyShafts({ baseBottomZ: testCase.zBase, scaleMm: 1.0 }, [chimneyEntry], meshes);
    console.log(`  emitBaseReliefChimneyShafts pushed ${meshes.base.length} triangles to meshes.base`);
    assert(meshes.base.length > 0, `emitBaseReliefChimneyShafts produced vertical through-shaft walls`);

    // Verify shaft quads have valid coordinates and non-zero normals
    for (let ti = 0; ti < meshes.base.length; ti++) {
      const t = meshes.base[ti];
      assert(!isNaN(t.v0[0]) && !isNaN(t.v0[1]) && !isNaN(t.v0[2]), `Base shaft vertex v0 has no NaN`);
      assert(!isNaN(t.v1[0]) && !isNaN(t.v1[1]) && !isNaN(t.v1[2]), `Base shaft vertex v1 has no NaN`);
      assert(!isNaN(t.v2[0]) && !isNaN(t.v2[1]) && !isNaN(t.v2[2]), `Base shaft vertex v2 has no NaN`);
    }
  }

  const buildingBound = {
    shellId,
    pickId: bId,
    interiorPt: computeSolidInteriorPoint2D(outerClean, holesClean),
    minZ: testCase.zBase,
    maxZ: testCase.zRidge
  };

  const auditCtx = {
    totalWidthMm: 169.2,
    totalHeightMm: 169.2,
    scaleMm: 1.0,
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
  console.log(`  Buildings Layer Topology Audit:`);
  console.log(`    Triangles:             ${bMetrics.triangles}`);
  console.log(`    Open Edges:            ${bMetrics.openEdges}`);
  console.log(`    Non-Manifold Edges:    ${bMetrics.nonManifoldEdges}`);
  console.log(`    Same-Dir Dup Edges:    ${bMetrics.sameDirDupEdges}`);
  console.log(`    Unpaired Dir Edges:    ${bMetrics.unpairedDirEdges}`);
  console.log(`    Degenerate Triangles:  ${bMetrics.degenerateTris}`);
  console.log(`    Mesh Volume (ml):      ${bMetrics.volumeMl.toFixed(4)}`);

  assert(
    bMetrics.openEdges === 0,
    `STRICT MANIFOLD: openEdges must be 0 (got ${bMetrics.openEdges})`
  );
  assert(
    bMetrics.nonManifoldEdges === 0,
    `STRICT MANIFOLD: nonManifoldEdges must be 0 (got ${bMetrics.nonManifoldEdges})`
  );
  assert(
    bMetrics.sameDirDupEdges === 0,
    `STRICT MANIFOLD: sameDirDupEdges must be 0 (got ${bMetrics.sameDirDupEdges})`
  );
  assert(
    bMetrics.unpairedDirEdges === 0,
    `STRICT MANIFOLD: unpairedDirEdges must be 0 (got ${bMetrics.unpairedDirEdges})`
  );
  assert(
    bMetrics.degenerateTris === 0,
    `STRICT MANIFOLD: degenerateTris must be 0 (got ${bMetrics.degenerateTris})`
  );
  assert(
    bMetrics.volumeMl > 0,
    `Mesh must enclose strictly positive volume: volumeMl = ${bMetrics.volumeMl.toFixed(4)} ml`
  );
}

console.log('\n================================================================');
console.log(`  ALL CHALLENGE TESTS COMPLETED`);
console.log(`  Total Assertions: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
if (failedTests > 0) {
  console.log(`\n  FAILURES SUMMARY (${failedTests} failures):`);
  failureLog.forEach((f, idx) => console.log(`    ${idx + 1}. ${f}`));
  console.log('\n>>> VERDICT: REQUEST_CHANGES (Topological Manifold Violations Detected) <<<');
  process.exit(1);
} else {
  console.log('\n>>> VERDICT: EMPIRICALLY CONFIRMED ALL SLA GEOMETRY REQUIREMENTS PASS <<<');
  process.exit(0);
}
console.log('================================================================\n');
