// tests/adversarial_m6_chal1_r2.js
// EMPIRICAL CHALLENGER 1 — MILESTONE 6 ROUND 2
// Deep Stress Harness: Edge Containment, Watertight Manifold Topology & Dual-Pack Boundaries

const fs = require('fs');
const path = require('path');

// Load modules in canonical browser sequence
const filesToLoad = [
  'src/geometry/polygon_2d.js',
  'src/geometry/obb_medial_2d.js',
  'src/geometry/marching_squares_2d.js',
  'src/mesh/mesh_primitives.js',
  'src/mesh/mesh_clipper_3d.js',
  'src/mesh/roof_shapes.js',
  'src/mesh/roof_architectural.js',
  'src/mesh/terrain_dem_grid.js',
  'src/mesh/mesh_tile_append.js',
  'src/mesh/water_masks.js',
  'src/mesh/features_greenery.js',
  'src/mesh/features_roads.js',
  'src/mesh/features_trees.js',
  'src/mesh/terrain_masks.js',
  'src/mesh/features_water.js',
  'src/mesh/terrain_base_water.js',
  'src/mesh/features_roads_parks.js',
  'src/mesh/features_bridges.js',
  'src/mesh/buildings_prepare.js',
  'src/mesh/buildings_s3db.js',
  'src/mesh/mesh_topology.js',
  'src/mesh/mesh_builder.js',
  'src/ui/ui_config.js'
];

for (const relPath of filesToLoad) {
  const absPath = path.resolve(__dirname, '..', relPath);
  const code = fs.readFileSync(absPath, 'utf8');
  eval(code);
}

console.log('================================================================');
console.log('  CHALLENGER 1 ROUND 2: DEEP ADVERSARIAL STRESS TEST');
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

// Helper to audit a generated mesh for 2-manifold watertightness
function auditExtrusion(name, outer, holes = [], opts = {}, roofShape = 'flat', zBase = 2.35, zEaves = 20.0, zRidge = 20.0) {
  const bShell = [];
  const shellId = 200 + totalTests;
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

  console.log(`  Audit [${name}]:`);
  console.log(`    Triangles: ${bMetrics.triangles} | Vol: ${bMetrics.volumeMl.toFixed(4)} ml`);
  console.log(`    OpenEdges: ${bMetrics.openEdges} | NonManifold: ${bMetrics.nonManifoldEdges} | UnpairedDir: ${bMetrics.unpairedDirEdges}`);

  assert(bShell.length > 0, `${name}: generated non-empty triangle mesh (got ${bShell.length})`);
  assert(bMetrics.openEdges === 0, `${name}: STRICT MANIFOLD openEdges === 0 (got ${bMetrics.openEdges})`);
  assert(bMetrics.nonManifoldEdges === 0, `${name}: STRICT MANIFOLD nonManifoldEdges === 0 (got ${bMetrics.nonManifoldEdges})`);
  assert(bMetrics.sameDirDupEdges === 0, `${name}: STRICT MANIFOLD sameDirDupEdges === 0 (got ${bMetrics.sameDirDupEdges})`);
  assert(bMetrics.unpairedDirEdges === 0, `${name}: STRICT MANIFOLD unpairedDirEdges === 0 (got ${bMetrics.unpairedDirEdges})`);
  assert(bMetrics.degenerateTris === 0, `${name}: STRICT MANIFOLD degenerateTris === 0 (got ${bMetrics.degenerateTris})`);
  assert(bMetrics.volumeMl > 0, `${name}: enclosed volume strictly positive (got ${bMetrics.volumeMl.toFixed(4)} ml)`);

  const isWatertightManifold = (bMetrics.openEdges === 0 && bMetrics.nonManifoldEdges === 0 &&
                                bMetrics.sameDirDupEdges === 0 && bMetrics.unpairedDirEdges === 0);
  assert(isWatertightManifold === true, `${name}: isWatertightManifold is true`);

  return { bMetrics, isWatertightManifold };
}

// ============================================================================
// TEST GROUP 1: Direct Unit Verification of isPolygonStrictlyInside
// ============================================================================
console.log('\n--- GROUP 1: Direct Unit Verification of isPolygonStrictlyInside ---');

const outerSquare = [[0, 0], [20, 0], [20, 20], [0, 20]];

// 1.1 Strictly inside concentric square
const innerStrictSquare = [[5, 5], [15, 5], [15, 15], [5, 15]];
assert(isPolygonStrictlyInside(innerStrictSquare, outerSquare) === true,
  'Concentric inner square is strictly inside outer square');

// 1.2 Inner square protruding across right edge
const innerProtruding = [[5, 5], [25, 5], [25, 15], [5, 15]];
assert(isPolygonStrictlyInside(innerProtruding, outerSquare) === false,
  'Inner square protruding across boundary returns false');

// 1.3 Inner square completely exterior
const innerExterior = [[30, 30], [40, 30], [40, 40], [30, 40]];
assert(isPolygonStrictlyInside(innerExterior, outerSquare) === false,
  'Completely exterior polygon returns false');

// 1.4 Reflex Bridge Bug Scenario: Non-convex outer with V-cut; inner segment bridges across exterior notch!
const vCutOuter = [[0, 0], [20, 0], [20, 20], [10, 2], [0, 20]];
const bridgeCandidate = [[2, 10], [18, 10], [18, 15], [2, 15]];
assert(pointInPoly2D(10, 10, vCutOuter) === false, 'Midpoint (10, 10) is confirmed exterior');
assert(isPolygonStrictlyInside(bridgeCandidate, vCutOuter) === false,
  'Reflex bridge candidate is REJECTED by isPolygonStrictlyInside (midpoint / edge intersection test)');

// 1.5 Self-intersecting bowtie polygon
const bowtiePoly = [[2, 2], [10, 10], [2, 10], [10, 2]];
assert(isPolygonStrictlyInside(bowtiePoly, outerSquare) === false,
  'Self-intersecting bowtie polygon is rejected by isPolygonStrictlyInside');

// 1.6 Degenerate / collinear / tiny inner
assert(isPolygonStrictlyInside([[0, 0], [0, 0], [0, 0]], outerSquare) === false,
  'Degenerate zero-area triangle is rejected');
assert(isPolygonStrictlyInside(null, outerSquare) === false, 'null inner is rejected');
assert(isPolygonStrictlyInside(innerStrictSquare, null) === false, 'null outer is rejected');

// ============================================================================
// TEST GROUP 2: Narrow Bottleneck Dumbbell Footprints with Parameter Sweep
// ============================================================================
console.log('\n--- GROUP 2: Narrow Bottleneck Dumbbells (Waist Parameter Sweep) ---');

// Two 18x18 lobes connected by a bottleneck corridor of varying waist width
const waistWidths = [0.4, 0.8, 1.2, 1.8, 2.5, 3.2, 3.8, 4.2, 5.0, 8.0];

for (const waist of waistWidths) {
  const yBottom = (18 - waist) / 2;
  const yTop = yBottom + waist;
  const dumbbell = [
    [0, 0], [18, 0], [18, yBottom], [28, yBottom], [28, 0], [46, 0],
    [46, 18], [28, 18], [28, yTop], [18, yTop], [18, 18], [0, 18]
  ];

  console.log(`\nTesting Dumbbell waist = ${waist.toFixed(2)} mm`);
  const outerClean = cleanPolygonRing(dumbbell, true);
  const chim = computeReliefChimneyPolygon(outerClean, [], 2.0);

  if (chim) {
    console.log(`  chimney returned: ${chim.length} vertices, area=${signedArea2D(chim).toFixed(2)}`);
    assert(isPolygonStrictlyInside(chim, outerClean) === true,
      `Waist ${waist.toFixed(2)}mm: chimney MUST be strictly inside outer`);
    assert(signedArea2D(chim) < 0,
      `Waist ${waist.toFixed(2)}mm: chimney winding MUST be CW (negative signed area)`);
  } else {
    console.log(`  chimney returned null (clean fallback to solid cap)`);
  }

  // Full extrusion and 2-manifold audit
  auditExtrusion(`Dumbbell_waist_${waist.toFixed(1)}mm`, dumbbell, []);
}

// ============================================================================
// TEST GROUP 3: Acute Reflex V-Cut Footprints with Parameter Sweep
// ============================================================================
console.log('\n--- GROUP 3: Acute Reflex V-Cut Footprints (Depth & Angle Sweep) ---');

// Outer rectangle [0,0] to [40,24], with a V-cut at x=20 plunging down to y = notchY
const notchYs = [1.0, 2.0, 4.0, 6.0, 10.0, 15.0, 20.0];

for (const notchY of notchYs) {
  const vCutFootprint = [
    [0, 0], [40, 0], [40, 24], [20, notchY], [0, 24]
  ];

  console.log(`\nTesting Acute V-Cut notchY = ${notchY.toFixed(1)} mm (depth = ${(24 - notchY).toFixed(1)} mm)`);
  const outerClean = cleanPolygonRing(vCutFootprint, true);
  const chim = computeReliefChimneyPolygon(outerClean, [], 2.0);

  if (chim) {
    console.log(`  chimney returned: ${chim.length} vertices, area=${signedArea2D(chim).toFixed(2)}`);
    assert(isPolygonStrictlyInside(chim, outerClean) === true,
      `V-Cut notchY ${notchY.toFixed(1)}mm: chimney MUST be strictly inside outerClean`);
    assert(signedArea2D(chim) < 0,
      `V-Cut notchY ${notchY.toFixed(1)}mm: chimney winding MUST be CW`);
  } else {
    console.log(`  chimney returned null (clean fallback to solid cap)`);
  }

  auditExtrusion(`VCut_notchY_${notchY.toFixed(1)}mm`, vCutFootprint, []);
}

// ============================================================================
// TEST GROUP 4: Multi-Ray Star Polygons & Acute Concave Monuments
// ============================================================================
console.log('\n--- GROUP 4: Multi-Ray Star Polygons & Acute Concave Monuments ---');

const starConfigs = [
  { rays: 5, rOuter: 22, rInner: 7, name: '5-Pointed Star (Deep Notches)' },
  { rays: 6, rOuter: 20, rInner: 10, name: '6-Pointed Star of David' },
  { rays: 8, rOuter: 24, rInner: 9, name: '8-Pointed Star Monument' },
  { rays: 12, rOuter: 25, rInner: 14, name: '12-Pointed Cog/Star' },
  { rays: 16, rOuter: 26, rInner: 12, name: '16-Pointed Needle Star' }
];

for (const sc of starConfigs) {
  console.log(`\nTesting Star: ${sc.name}`);
  const pts = [];
  const numPts = sc.rays * 2;
  for (let i = 0; i < numPts; i++) {
    const ang = (i / numPts) * Math.PI * 2;
    const r = (i % 2 === 0) ? sc.rOuter : sc.rInner;
    pts.push([30 + Math.cos(ang) * r, 30 + Math.sin(ang) * r]);
  }

  const outerClean = cleanPolygonRing(pts, true);
  const chim = computeReliefChimneyPolygon(outerClean, [], 2.0);
  if (chim) {
    console.log(`  chimney returned: ${chim.length} vertices`);
    assert(isPolygonStrictlyInside(chim, outerClean) === true,
      `${sc.name}: chimney MUST be strictly inside outerClean`);
    assert(signedArea2D(chim) < 0, `${sc.name}: chimney winding MUST be CW`);
  } else {
    console.log(`  chimney returned null (clean solid fallback)`);
  }

  auditExtrusion(sc.name, pts, [], {}, 'pyramidal', 2.35, 20.0, 28.0);
}

// ============================================================================
// TEST GROUP 5: Complex Courtyard Buildings (Single, Multi, and Near-Edge)
// ============================================================================
console.log('\n--- GROUP 5: Complex Courtyard Buildings ---');

// 5.1 Single central courtyard
const courtyardSingle = {
  outer: [[0, 0], [40, 0], [40, 40], [0, 40]],
  holes: [[[12, 12], [12, 28], [28, 28], [28, 12]]] // CW 16x16 courtyard
};
auditExtrusion('Courtyard_Single_Central', courtyardSingle.outer, courtyardSingle.holes);

// 5.2 Double courtyards (Two distinct interior lightwells)
const courtyardDouble = {
  outer: [[0, 0], [60, 0], [60, 40], [0, 40]],
  holes: [
    [[5, 10], [5, 30], [25, 30], [25, 10]],
    [[35, 10], [35, 30], [55, 30], [55, 10]]
  ]
};
auditExtrusion('Courtyard_Double_Lightwells', courtyardDouble.outer, courtyardDouble.holes);

// 5.3 Triple courtyards (Three interior lightwells)
const courtyardTriple = {
  outer: [[0, 0], [90, 0], [90, 40], [0, 40]],
  holes: [
    [[5, 10], [5, 30], [25, 30], [25, 10]],
    [[35, 10], [35, 30], [55, 30], [55, 10]],
    [[65, 10], [65, 30], [85, 30], [85, 10]]
  ]
};
auditExtrusion('Courtyard_Triple_Lightwells', courtyardTriple.outer, courtyardTriple.holes);

// 5.4 Courtyard very close to outer edge (1.5 mm solid wall)
const courtyardNearEdge = {
  outer: [[0, 0], [35, 0], [35, 35], [0, 35]],
  holes: [[[1.5, 1.5], [1.5, 28], [28, 28], [28, 1.5]]]
};
auditExtrusion('Courtyard_Near_Edge_1.5mm', courtyardNearEdge.outer, courtyardNearEdge.holes);

// 5.5 Courtyard Hole Collision Test: chimney must NEVER penetrate or touch courtyard holes
console.log('\nTesting Chimney Courtyard Hole Rejection & Containment:');
const cyOuter = [[0, 0], [50, 0], [50, 50], [0, 50]];
const cyHoles = [
  [[10, 10], [10, 20], [20, 20], [20, 10]],
  [[30, 30], [30, 40], [40, 40], [40, 30]]
];
const cyCleanOuter = cleanPolygonRing(cyOuter, true);
const cyCleanHoles = cyHoles.map(h => cleanPolygonRing(h, false));
const cyChim = computeReliefChimneyPolygon(cyCleanOuter, cyCleanHoles, 2.0);
if (cyChim) {
  for (const h of cyCleanHoles) {
    const penetrates = cyChim.some(p => pointInPoly2D(p[0], p[1], h));
    assert(!penetrates, 'Chimney does not penetrate courtyard holes');
  }
} else {
  assert(true, 'Chimney cleanly returned null due to courtyard safety margin');
}
auditExtrusion('Courtyard_Two_Holes_With_Chimney_Check', cyOuter, cyHoles);

// ============================================================================
// TEST GROUP 6: Concave Architectural Footprints (L, U, H, Cross, Plus)
// ============================================================================
console.log('\n--- GROUP 6: Concave Architectural Footprints ---');

// 6.1 Greek Cross / Plus Monument
const plusMonument = [
  [10, 0], [20, 0], [20, 10], [30, 10], [30, 20], [20, 20],
  [20, 30], [10, 30], [10, 20], [0, 20], [0, 10], [10, 10]
];
auditExtrusion('Plus_Monument', plusMonument, []);

// 6.2 L-Shaped Building
const lBuilding = [
  [0, 0], [30, 0], [30, 12], [12, 12], [12, 30], [0, 30]
];
auditExtrusion('L_Shaped_Building', lBuilding, []);

// 6.3 U-Shaped Building with Deep Courtyard Bay
const uBuilding = [
  [0, 0], [32, 0], [32, 32], [22, 32], [22, 10], [10, 10], [10, 32], [0, 32]
];
auditExtrusion('U_Shaped_Building', uBuilding, []);

// 6.4 H-Shaped Building
const hBuilding = [
  [0, 0], [10, 0], [10, 8], [22, 8], [22, 0], [32, 0],
  [32, 28], [22, 28], [22, 20], [10, 20], [10, 28], [0, 28]
];
auditExtrusion('H_Shaped_Building', hBuilding, []);

// 6.5 C-Shaped Pavilion
const cPavilion = [
  [0, 0], [28, 0], [28, 8], [8, 8], [8, 20], [28, 20], [28, 28], [0, 28]
];
auditExtrusion('C_Shaped_Pavilion', cPavilion, []);

// ============================================================================
// TEST GROUP 7: Dual-Pack Mono 4 Boundary Unit Tests (checkTileDualPackableMono4)
// ============================================================================
console.log('\n--- GROUP 7: checkTileDualPackableMono4 Boundary Assertions ---');

const dualPackCases = [
  { w: 75, h: 84, exp: true, desc: '75x84 standard dual-pack' },
  { w: 84, h: 75, exp: true, desc: '84x75 standard rotated' },
  { w: 75.45, h: 87.05, exp: true, desc: '75.45x87.05 exact bed boundary' },
  { w: 87.05, h: 75.45, exp: true, desc: '87.05x75.45 exact bed boundary rotated' },
  { w: 75.46, h: 87.05, exp: false, desc: '75.46x87.05 width boundary exceeded' },
  { w: 75.45, h: 87.06, exp: false, desc: '75.45x87.06 height boundary exceeded' },
  { w: 75, h: 87, exp: true, desc: '75x87 within bed bounds' },
  { w: 76, h: 84, exp: false, desc: '76x84 dual width exceeded (76*2+2.4 = 154.4 > 153.4)' },
  { w: 84, h: 84, exp: false, desc: '84x84 dual width exceeded (84*2 = 168 > 153.4)' },
  { w: 0, h: 0, exp: false, desc: '0x0 zero dimension' },
  { w: -75, h: 84, exp: false, desc: 'negative width' },
  { w: 75, h: -84, exp: false, desc: 'negative height' },
  { w: null, h: 84, exp: false, desc: 'null width' },
  { w: NaN, h: 84, exp: false, desc: 'NaN width' },
  { w: undefined, h: 84, exp: false, desc: 'undefined width' },
  { w: Infinity, h: 84, exp: false, desc: 'Infinity width' },
  { w: '', h: 84, exp: false, desc: 'empty string width' }
];

for (const dpc of dualPackCases) {
  const actual = checkTileDualPackableMono4(dpc.w, dpc.h);
  assert(actual === dpc.exp, `checkTileDualPackableMono4(${dpc.w}, ${dpc.h}) === ${dpc.exp} [${dpc.desc}]`);
}

// ============================================================================
// FINAL SUMMARY
// ============================================================================
console.log('\n================================================================');
console.log(`  CHALLENGER 1 ROUND 2 DEEP STRESS SUITE COMPLETE`);
console.log(`  Total Assertions: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
if (failedTests > 0) {
  console.log(`\n  FAILURES SUMMARY (${failedTests} failures):`);
  failureLog.forEach((f, idx) => console.log(`    ${idx + 1}. ${f}`));
  console.log('\n>>> VERDICT: REQUEST_CHANGES <<<');
  process.exit(1);
} else {
  console.log('\n>>> VERDICT: APPROVE (100% Watertight 2-Manifold across all Adversarial Cases) <<<');
  process.exit(0);
}
console.log('================================================================\n');
