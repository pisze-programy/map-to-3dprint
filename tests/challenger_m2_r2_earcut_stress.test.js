// ============================================================================
// tests/challenger_m2_r2_earcut_stress.test.js
// EMPIRICAL ADVERSARIAL STRESS TEST & ORACLE HARNESS
// Challenger 2 (Milestone 2, Iteration 2)
// Testing: triangulateCutLoopExact and triangulateSimplePoly
// ============================================================================

const assert = require('assert');
const clipper = require('../src/mesh/mesh_clipper_3d.js');
const poly2d = require('../src/geometry/polygon_2d.js');

const { triangulateCutLoopExact } = clipper;
const { triangulateSimplePoly, mergeHolesIntoOuterKeyhole, signedArea2D, pointInTri2D } = poly2d;

// Precision formatting for topology keys
const ptKey = p => (Math.abs(p[0]) < 1e-9 ? 0 : p[0]).toFixed(7) + ',' + (Math.abs(p[1]) < 1e-9 ? 0 : p[1]).toFixed(7);

// Shoelace formula for exact signed polygon area
function computePolygonSignedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n];
    a += (p1[0] * p2[1] - p2[0] * p1[1]);
  }
  return a * 0.5;
}

// Compute sum of signed areas of all triangles in triangulation
function computeTrianglesTotalArea(tris) {
  let totalArea = 0;
  for (let i = 0; i < tris.length; i++) {
    const [a, b, c] = tris[i];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    totalArea += cross * 0.5;
  }
  return totalArea;
}

// Comprehensive 2-Manifold Planar & Area Verification Oracle
function verifyTriangulationTopologyAndArea(engineName, caseName, polyPts, tris, expectedArea = null, options = {}) {
  const allowDegenerate = options.allowDegenerate || false;
  const isKeyhole = options.isKeyhole || false;

  const polyArea = expectedArea !== null ? expectedArea : Math.abs(computePolygonSignedArea(polyPts));
  if (polyArea > 1e-7 && tris.length === 0) {
    throw new Error(`[${engineName}] ${caseName}: Triangulation returned 0 triangles for polygon with area ${polyArea}!`);
  }

  // 2. Area Conservation Check
  const trisArea = computeTrianglesTotalArea(tris);
  const areaDiff = Math.abs(trisArea - polyArea);
  const relDiff = polyArea > 1e-8 ? areaDiff / polyArea : areaDiff;

  const areaTolerance = options.tolerance || 1e-9;
  let areaFailed = false;
  let areaFailMsg = '';
  if (areaDiff > areaTolerance && relDiff > 1e-9) {
    areaFailed = true;
    areaFailMsg = `Area conservation failed: Expected ${polyArea.toFixed(6)}, got ${trisArea.toFixed(6)}, diff=${areaDiff.toExponential(4)}, relDiff=${relDiff.toExponential(4)}`;
  }

  // 3. 2-Manifold Orientation & Non-Inversion Check
  let invertedCount = 0;
  let degenerateCount = 0;
  const directedEdges = new Map();
  const undirectedEdges = new Map();

  for (let i = 0; i < tris.length; i++) {
    const [a, b, c] = tris[i];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

    if (cross < -1e-9) {
      invertedCount++;
    } else if (Math.abs(cross) <= 1e-9) {
      degenerateCount++;
    }

    const verts = [a, b, c];
    for (let e = 0; e < 3; e++) {
      const u = ptKey(verts[e]);
      const v = ptKey(verts[(e + 1) % 3]);
      if (u === v) continue;

      const dirKey = u + '->' + v;
      directedEdges.set(dirKey, (directedEdges.get(dirKey) || 0) + 1);

      const undirKey = u < v ? u + '--' + v : v + '--' + u;
      undirectedEdges.set(undirKey, (undirectedEdges.get(undirKey) || 0) + 1);
    }
  }

  let sameDirDuplicateCount = 0;
  let nonManifoldEdgeCount = 0;

  for (const [dirKey, count] of directedEdges.entries()) {
    if (count > 1) sameDirDuplicateCount++;
  }

  for (const [undirKey, count] of undirectedEdges.entries()) {
    if (count > 2 && !isKeyhole) nonManifoldEdgeCount++;
  }

  const failures = [];
  if (areaFailed) failures.push(areaFailMsg);
  if (invertedCount > 0) failures.push(`Inverted triangles: ${invertedCount}`);
  if (!allowDegenerate && degenerateCount > 0) failures.push(`Degenerate triangles: ${degenerateCount}`);
  if (sameDirDuplicateCount > 0) failures.push(`Duplicate same-dir edges: ${sameDirDuplicateCount}`);
  if (nonManifoldEdgeCount > 0) failures.push(`Non-manifold edges (>2 tris): ${nonManifoldEdgeCount}`);

  if (options.cavityTestPoints) {
    for (const cp of options.cavityTestPoints) {
      for (const t of tris) {
        if (pointInTri2D(cp[0], cp[1], t[0][0], t[0][1], t[1][0], t[1][1], t[2][0], t[2][1])) {
          failures.push(`Triangle covers forbidden cavity point [${cp[0]}, ${cp[1]}]!`);
          break;
        }
      }
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    triCount: tris.length,
    polyArea,
    trisArea,
    areaDiff,
    relDiff,
    degenerateCount,
    invertedCount,
    nonManifoldEdgeCount,
    sameDirDuplicateCount
  };
}

// ============================================================================
// ADVERSARIAL POLYGON GENERATORS
// ============================================================================

function generateStarburstPolygon(numPoints, rInner = 20, rOuter = 50, cx = 0, cy = 0) {
  const pts = [];
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    const r = (i % 2 === 0) ? rOuter : rInner;
    pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  return pts;
}

function generateWavyEllipse(numPoints, rx = 100, ry = 50, waves = 12, waveAmp = 4) {
  const pts = [];
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    const rMod = 1.0 + (waveAmp / rx) * Math.sin(waves * angle);
    pts.push([rx * rMod * Math.cos(angle), ry * rMod * Math.sin(angle)]);
  }
  return pts;
}

function generateSpiralCorridor(numTurns = 4, pointsPerTurn = 180, corridorWidth = 4) {
  const outer = [];
  const inner = [];
  const totalPoints = numTurns * pointsPerTurn;
  const rStart = 10;
  const rStep = 10 / pointsPerTurn;

  for (let i = 0; i <= totalPoints; i++) {
    const angle = (i / pointsPerTurn) * Math.PI * 2;
    const rOut = rStart + i * rStep;
    const rIn = rOut - corridorWidth;
    outer.push([rOut * Math.cos(angle), rOut * Math.sin(angle)]);
    inner.push([rIn * Math.cos(angle), rIn * Math.sin(angle)]);
  }

  inner.reverse();
  return outer.concat(inner);
}

function generateSawtoothPolygon(numTeeth = 300, width = 1000, height = 50, toothHeight = 40) {
  const pts = [[0, 0]];
  const dx = width / numTeeth;
  for (let i = 0; i < numTeeth; i++) {
    const x0 = i * dx;
    const x1 = x0 + dx * 0.5;
    const x2 = (i + 1) * dx;
    pts.push([x0, height]);
    pts.push([x1, height + toothHeight]);
    pts.push([x2, height]);
  }
  pts.push([width, 0]);
  return pts;
}

function generateCollinearSubdividedBox(w = 100, h = 100, ptsPerSide = 50) {
  const pts = [];
  for (let i = 0; i < ptsPerSide; i++) pts.push([(i / ptsPerSide) * w, 0]);
  for (let i = 0; i < ptsPerSide; i++) pts.push([w, (i / ptsPerSide) * h]);
  for (let i = 0; i < ptsPerSide; i++) pts.push([w - (i / ptsPerSide) * w, h]);
  for (let i = 0; i < ptsPerSide; i++) pts.push([0, h - (i / ptsPerSide) * h]);
  return pts;
}

// ============================================================================
// TEST RUNNER
// ============================================================================

async function runEarClippingStressTests() {
  console.log('================================================================');
  console.log('   EMPIRICAL ADVERSARIAL STRESS TEST — EAR-CLIPPING PARITY');
  console.log('================================================================\n');

  const engines = [
    { name: 'triangulateCutLoopExact', fn: triangulateCutLoopExact },
    { name: 'triangulateSimplePoly', fn: triangulateSimplePoly }
  ];

  const results = [];

  function runCase(section, caseName, pts, options = {}) {
    console.log(`\n--- [${section}] ${caseName} (${pts.length} vertices) ---`);

    for (const engine of engines) {
      const t0 = process.hrtime.bigint();
      const tris = engine.fn(pts);
      const t1 = process.hrtime.bigint();
      const elapsedMs = Number(t1 - t0) / 1e6;

      const res = verifyTriangulationTopologyAndArea(engine.name, caseName, pts, tris, options.expectedArea, options);
      if (res.passed) {
        console.log(`  [PASS] ${engine.name}: ${res.triCount} tris in ${elapsedMs.toFixed(2)}ms | Area: ${res.trisArea.toFixed(6)} | Diff: ${res.areaDiff.toExponential(4)}`);
      } else {
        console.log(`  [FAIL] ${engine.name}: ${res.triCount} tris in ${elapsedMs.toFixed(2)}ms | Area: ${res.trisArea.toFixed(6)} vs Exp: ${res.polyArea.toFixed(6)}`);
        for (const f of res.failures) {
          console.log(`         -> ${f}`);
        }
      }
      results.push({ section, caseName, engine: engine.name, elapsedMs, ...res });
    }
  }

  // --------------------------------------------------------------------------
  // SECTION 1: MASSIVE POLYGONS (> 1,000 VERTICES)
  // --------------------------------------------------------------------------
  const star1500 = generateStarburstPolygon(1500, 30, 80);
  runCase('SEC 1', '1.1 Starburst 1,500 vertices', star1500);

  const ellipse2400 = generateWavyEllipse(2400, 120, 60, 16, 5);
  runCase('SEC 1', '1.2 Wavy Ellipse 2,400 vertices', ellipse2400);

  const spiral1442 = generateSpiralCorridor(4, 180, 4);
  runCase('SEC 1', '1.3 Serpentine Spiral 1,442 vertices', spiral1442);

  const sawtooth1202 = generateSawtoothPolygon(400, 2000, 100, 50);
  runCase('SEC 1', '1.4 Sawtooth Comb 1,202 vertices', sawtooth1202);

  const outerBox = generateWavyEllipse(600, 200, 200, 8, 2);
  const holes = [];
  for (let h = 0; h < 8; h++) {
    const angle = (h / 8) * Math.PI * 2;
    const hx = 100 * Math.cos(angle);
    const hy = 100 * Math.sin(angle);
    holes.push(generateStarburstPolygon(60, 6, 12, hx, hy));
  }
  const mergedKeyholePoly = mergeHolesIntoOuterKeyhole(outerBox, holes);
  const outerArea = Math.abs(computePolygonSignedArea(outerBox));
  const holesAreaSum = holes.reduce((sum, h) => sum + Math.abs(computePolygonSignedArea(h)), 0);
  const netHoleArea = outerArea - holesAreaSum;
  runCase('SEC 1', '1.5 Outer Polygon with 8 Holes (1,080 vertices)', mergedKeyholePoly, {
    expectedArea: netHoleArea,
    isKeyhole: true,
    tolerance: 1e-4
  });

  const spiral3602 = generateSpiralCorridor(10, 180, 2);
  runCase('SEC 1', '1.6 Massive Serpentine Spiral 3,602 vertices (10 turns)', spiral3602, {
    tolerance: 1e-8
  });

  const holes16 = [];
  for (let h = 0; h < 16; h++) {
    const angle = (h / 16) * Math.PI * 2;
    const hx = 110 * Math.cos(angle);
    const hy = 110 * Math.sin(angle);
    holes16.push(generateStarburstPolygon(60, 4, 8, hx, hy));
  }
  const mergedKeyhole16 = mergeHolesIntoOuterKeyhole(outerBox, holes16);
  const holes16AreaSum = holes16.reduce((sum, h) => sum + Math.abs(computePolygonSignedArea(h)), 0);
  const netHole16Area = outerArea - holes16AreaSum;
  runCase('SEC 1', '1.7 Keyhole Polygon with 16 Starburst Holes (1,560 vertices)', mergedKeyhole16, {
    expectedArea: netHole16Area,
    isKeyhole: true,
    tolerance: 1e-4
  });

  // --------------------------------------------------------------------------
  // SECTION 2: COLLINEAR VERTICES STRESS TEST
  // --------------------------------------------------------------------------
  const colPoly200 = generateCollinearSubdividedBox(100, 100, 50);
  runCase('SEC 2', '2.1 Box with 200 collinear boundary vertices', colPoly200, {
    expectedArea: 10000.0,
    tolerance: 1e-9
  });

  const lCollinear = [
    [0, 0], [10, 0], [20, 0], [30, 0], [40, 0], [50, 0],
    [50, 10], [50, 20],
    [20, 20], [20, 30], [20, 40], [20, 50],
    [10, 50], [0, 50],
    [0, 40], [0, 30], [0, 20], [0, 10]
  ];
  runCase('SEC 2', '2.2 L-shape with collinear vertices', lCollinear, {
    expectedArea: 1600.0,
    tolerance: 1e-9
  });

  const perturbedCollinear = [
    [0, 0], [25, 1e-11], [50, -1e-11], [75, 1e-12], [100, 0],
    [100, 50], [100, 100],
    [50, 100], [0, 100]
  ];
  runCase('SEC 2', '2.3 Perturbed collinear vertices (1e-11)', perturbedCollinear, {
    expectedArea: 10000.0,
    tolerance: 1e-8
  });

  const perturbed1e13 = [
    [0, 0], [25, 1e-13], [50, -1e-13], [75, 1e-14], [100, 0],
    [100, 50], [100, 100],
    [50, 100], [0, 100]
  ];
  runCase('SEC 2', '2.4 Ultra-fine perturbed collinear vertices (1e-13)', perturbed1e13, {
    expectedArea: 10000.0,
    tolerance: 1e-8
  });

  const zigzag = [];
  for (let i = 0; i <= 50; i++) {
    const y = (i % 2 === 0) ? 1e-12 : -1e-12;
    zigzag.push([i * 2, y]);
  }
  zigzag.push([100, 50], [100, 100], [0, 100]);
  runCase('SEC 2', '2.5 Alternating zig-zag micro-perturbed collinear boundary (±1e-12)', zigzag, {
    expectedArea: 10000.0,
    tolerance: 1e-8
  });

  // --------------------------------------------------------------------------
  // SECTION 3: DUPLICATE VERTICES & CLOSED LOOPS
  // --------------------------------------------------------------------------
  const consecutiveDups = [
    [0, 0], [0, 0], [50, 0], [50, 0], [50, 0], [100, 0],
    [100, 100], [100, 100],
    [0, 100], [0, 100]
  ];
  runCase('SEC 3', '3.1 Consecutive duplicate vertices', consecutiveDups, {
    expectedArea: 10000.0,
    tolerance: 1e-9
  });

  const closedLoop = [
    [0, 0], [100, 0], [100, 50], [0, 50], [0, 0]
  ];
  runCase('SEC 3', '3.2 Closed loop with identical endpoints', closedLoop, {
    expectedArea: 5000.0,
    tolerance: 1e-9
  });

  // --------------------------------------------------------------------------
  // SECTION 4: NARROW SLIVERS & EXTREME ASPECT RATIOS
  // --------------------------------------------------------------------------
  const sliverRect = [
    [0, 0], [10000, 0], [10000, 0.001], [0, 0.001]
  ];
  runCase('SEC 4', '4.1 Extreme Sliver Rectangle (10,000,000:1)', sliverRect, {
    expectedArea: 10.0,
    tolerance: 1e-9
  });

  const needlePoly = [
    [0, 0], [0.001, 0], [0.0005, 1000]
  ];
  runCase('SEC 4', '4.2 Acute needle triangle (angle ~ 0.00005 deg)', needlePoly, {
    expectedArea: 0.5,
    tolerance: 1e-9
  });

  const microPoly = [
    [0.001, 0.001], [0.004, 0.001], [0.005, 0.003], [0.003, 0.005], [0.001, 0.004]
  ];
  const microArea = Math.abs(computePolygonSignedArea(microPoly));
  runCase('SEC 4', '4.3 Micro-scale polygon (< 0.005mm)', microPoly, {
    expectedArea: microArea,
    tolerance: 1e-12
  });

  const sliverExtreme = [
    [0, 0], [10000, 0], [10000, 0.0001], [0, 0.0001]
  ];
  runCase('SEC 4', '4.4 Extreme Sliver Rectangle (100,000,000:1, width 1e-4mm)', sliverExtreme, {
    expectedArea: 1.0,
    tolerance: 1e-9
  });

  const lobesPinch = [
    [0, 0], [10, 0], [10, 10], [0, 0], [-10, 0], [-10, -10]
  ];
  runCase('SEC 4', '4.5 Non-self-intersecting pinch point (two lobes touching at origin)', lobesPinch, {
    expectedArea: 100.0,
    tolerance: 1e-9,
    isKeyhole: true
  });

  // --------------------------------------------------------------------------
  // SECTION 5: INVERTED ORIENTATION (CLOCKWISE INPUT)
  // --------------------------------------------------------------------------
  const cwSquare = [
    [0, 0], [0, 100], [100, 100], [100, 0]
  ];
  runCase('SEC 5', '5.1 Clockwise Square', cwSquare, {
    expectedArea: 10000.0,
    tolerance: 1e-9
  });

  const cwStarburst = generateStarburstPolygon(1200, 20, 60).reverse();
  runCase('SEC 5', '5.2 Clockwise Starburst 1,200 vertices', cwStarburst, {
    tolerance: 1e-9
  });

  // --------------------------------------------------------------------------
  // SECTION 6: KEYHOLE HOLE CAVITY EXCLUSION & ISOLATION
  // --------------------------------------------------------------------------
  const sqOuter = [[-100, -100], [100, -100], [100, 100], [-100, 100]];
  const sqHole = [[-50, -50], [-50, 50], [50, 50], [50, -50]];
  const sqKeyhole = mergeHolesIntoOuterKeyhole(sqOuter, [sqHole]);
  runCase('SEC 6', '6.1 Keyhole Cavity Single Hole (100x100 outer, 50x50 hole)', sqKeyhole, {
    expectedArea: 30000.0,
    isKeyhole: true,
    tolerance: 1e-4,
    cavityTestPoints: [[0, 0], [10, -10], [-25, 25]]
  });

  const rectOuter = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const rectHole1 = [[10, 10], [10, 40], [40, 40], [40, 10]];
  const rectHole2 = [[60, 60], [60, 90], [90, 90], [90, 60]];
  const rectKeyhole2 = mergeHolesIntoOuterKeyhole(rectOuter, [rectHole1, rectHole2]);
  runCase('SEC 6', '6.2 Keyhole with 2 Isolated Holes (area 10000 - 900 - 900)', rectKeyhole2, {
    expectedArea: 8200.0,
    isKeyhole: true,
    tolerance: 1e-4,
    cavityTestPoints: [[25, 25], [75, 75]]
  });

  // --------------------------------------------------------------------------
  // SUMMARY TABLE & DEFECT ANALYSIS
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('   EMPIRICAL ADVERSARIAL STRESS TEST SUMMARY');
  console.log('================================================================');

  let passed = 0, failed = 0;
  for (const r of results) {
    if (r.passed) passed++;
    else failed++;
  }
  console.log(`Total test assertions: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    console.log('\n--- DETECTED DEFECTS ---');
    for (const r of results) {
      if (!r.passed) {
        console.log(`❌ [${r.section}] ${r.caseName} (${r.engine}):`);
        for (const f of r.failures) {
          console.log(`     ${f}`);
        }
      }
    }
  }

  return { total: results.length, passed, failed, results };
}

runEarClippingStressTests().then(summary => {
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}).catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
