// tests/adversarial_reviewer_m5_r2.js
// ============================================================================
// ADVERSARIAL STRESS TEST & EDGE-CASE MINING FOR M5 R2 REVIEW
// Probes clipMeshToBox3D, triangulateCutLoopExact, and clipClosedMeshByAxisPlane
// ============================================================================

const fs = require('fs');
const path = require('path');

// Shims
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
  'src/ui/ui_config.js'
];

for (const f of filesToLoad) {
  const abs = path.resolve(__dirname, '..', f);
  eval(fs.readFileSync(abs, 'utf8'));
}

let shellCounter = 5000;
function audit(tris, label = '') {
  const currentShellId = ++shellCounter;
  for (let i = 0; i < tris.length; i++) {
    tris[i].shellId = currentShellId;
    tris[i].tileId = 0;
  }
  const meshes = {
    buildings: tris,
    base: [],
    water: [],
    roads: [],
    greenery: []
  };
  const auditState = { bedSizeMm: 169.2, totalHeightMm: 169.2, bedZ: 165.0 };
  const auditCtx = { scaleMm: 1.0, tileCols: 1, tileRows: 1, numTiles: 1 };
  const res = auditMeshTopologyNumeric(meshes, [], auditState, auditCtx);
  return {
    ...res,
    bm: res.layerMetrics.buildings,
    label
  };
}

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

let assertions = 0;
let passed = 0;
let failed = 0;

function assert(cond, msg) {
  assertions++;
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  [FAIL] ${msg}`);
  }
}

console.log('================================================================');
console.log('  REVIEWER & ADVERSARIAL CRITIC DEEP STRESS SUITE (M5 R2)');
console.log('================================================================\n');

// ----------------------------------------------------------------------------
// TEST 1: Exact Boundary & Coincident Planes
// ----------------------------------------------------------------------------
console.log('--- TEST 1: Exact Boundary & Coincident Planes ---');
{
  const box = generateClosedBox(-10, -10, 0, 10, 10, 20);
  
  // 1.1 Coincident boundary cuts: [-10, 10] x [-10, 10]
  const clip1 = clipMeshToBox3D(box, -10, 10, -10, 10);
  const a1 = audit(clip1, 'coincident boundary');
  assert(a1.bm.openEdges === 0, '1.1: coincident bounds openEdges === 0');
  assert(a1.bm.nonManifoldEdges === 0, '1.1: coincident bounds nonManifoldEdges === 0');
  assert(a1.bm.degenerateTris === 0, '1.1: coincident bounds degenerateTris === 0');
  assert(a1.isWatertightManifold === true, '1.1: coincident bounds isWatertight === true');
  assert(Math.abs(a1.bm.volumeMl - 8.0) < 1e-3, `1.1: volumeMl === 8.0 (got ${a1.bm.volumeMl})`);

  // 1.2 Plane slicing through center vertex/edge: [0, 10] x [0, 10]
  const clip2 = clipMeshToBox3D(box, 0, 10, 0, 10);
  const a2 = audit(clip2, 'quarter box');
  assert(a2.bm.openEdges === 0, '1.2: quarter box openEdges === 0');
  assert(a2.bm.nonManifoldEdges === 0, '1.2: quarter box nonManifoldEdges === 0');
  assert(a2.bm.degenerateTris === 0, '1.2: quarter box degenerateTris === 0');
  assert(a2.isWatertightManifold === true, '1.2: quarter box isWatertight === true');
  assert(Math.abs(a2.bm.volumeMl - 2.0) < 1e-3, `1.2: volumeMl === 2.0 (got ${a2.bm.volumeMl})`);

  // 1.3 Box completely outside: [20, 30] x [20, 30]
  const clip3 = clipMeshToBox3D(box, 20, 30, 20, 30);
  assert(clip3.length === 0, '1.3: completely outside box returns empty array');

  // 1.4 Box completely inside: [-20, 20] x [-20, 20]
  const clip4 = clipMeshToBox3D(box, -20, 20, -20, 20);
  const a4 = audit(clip4, 'completely inside');
  assert(a4.bm.openEdges === 0, '1.4: completely inside openEdges === 0');
  assert(a4.bm.nonManifoldEdges === 0, '1.4: completely inside nonManifoldEdges === 0');
  assert(a4.isWatertightManifold === true, '1.4: completely inside isWatertight === true');
  assert(clip4.length === box.length, '1.4: completely inside retains 100% of original triangles');
}

// ----------------------------------------------------------------------------
// TEST 2: Rotated Diamond Box (45-degree angle slicing through vertices)
// ----------------------------------------------------------------------------
console.log('--- TEST 2: Rotated Diamond Box (45° Slicing) ---');
{
  const diamond = [
    [0, 20], [20, 0], [0, -20], [-20, 0]
  ];
  const tris = [];
  extrudeBuildingLoD2(diamond, [], 0, 10, 10, false, 4, 1, tris, 0, 'flat');
  const a0 = audit(tris, 'unclipped diamond');
  assert(a0.isWatertightManifold === true, '2.0: original diamond is watertight');

  // Clip with box passing through diamond vertices at (-10, 10, -10, 10)
  const clipped = clipMeshToBox3D(tris, -10, 10, -10, 10);
  const a1 = audit(clipped, 'clipped diamond');
  assert(a1.bm.openEdges === 0, '2.1: rotated diamond openEdges === 0');
  assert(a1.bm.nonManifoldEdges === 0, '2.1: rotated diamond nonManifoldEdges === 0');
  assert(a1.bm.degenerateTris === 0, '2.1: rotated diamond degenerateTris === 0');
  assert(a1.isWatertightManifold === true, '2.1: rotated diamond isWatertight === true');
  assert(a1.bm.volumeMl > 0, `2.1: volumeMl > 0 (got ${a1.bm.volumeMl.toFixed(4)})`);
}

// ----------------------------------------------------------------------------
// TEST 3: Complex Multi-Hole Courtyard Building Clipped
// ----------------------------------------------------------------------------
console.log('--- TEST 3: Multi-Hole Courtyard Building Clipped ---');
{
  const outer = [[-50, -50], [50, -50], [50, 50], [-50, 50]];
  // Hole 1: centered square [-15, 15] x [-15, 15]
  const h1 = [[-15, -15], [15, -15], [15, 15], [-15, 15]];
  // Hole 2: off-center rectangle [25, 25] to [40, 40]
  const h2 = [[25, 25], [40, 25], [40, 40], [25, 40]];
  // Hole 3: off-center rectangle [-40, -40] to [-25, -25]
  const h3 = [[-40, -40], [-25, -40], [-25, -25], [-40, -25]];

  const tris = [];
  extrudeBuildingLoD2(outer, [h1, h2, h3], 0, 15, 15, false, 4, 1, tris, 0, 'flat');
  const a0 = audit(tris, 'uncut multi-hole');
  assert(a0.isWatertightManifold === true, '3.0: uncut multi-hole is watertight');

  // Clip through all holes: [-30, 30] x [-30, 30]
  const clipped = clipMeshToBox3D(tris, -30, 30, -30, 30);
  const a1 = audit(clipped, 'clipped multi-hole');
  assert(a1.bm.openEdges === 0, '3.1: clipped multi-hole openEdges === 0');
  assert(a1.bm.nonManifoldEdges === 0, '3.1: clipped multi-hole nonManifoldEdges === 0');
  assert(a1.bm.degenerateTris === 0, '3.1: clipped multi-hole degenerateTris === 0');
  assert(a1.isWatertightManifold === true, '3.1: clipped multi-hole isWatertight === true');
  assert(a1.bm.volumeMl > 0, `3.1: volumeMl > 0 (got ${a1.bm.volumeMl.toFixed(4)})`);
}

// ----------------------------------------------------------------------------
// TEST 4: Pitched Roof Building (Gabled Roof Sliced Along Ridge & Eaves)
// ----------------------------------------------------------------------------
console.log('--- TEST 4: Pitched Roof Building Sliced Along Ridge & Eaves ---');
{
  const rect = [[-20, -10], [20, -10], [20, 10], [-20, 10]];
  const tris = [];
  // Gabled roof with ridge along X axis
  extrudeBuildingLoD2(rect, [], 0, 10, 18, true, 4, 1, tris, 0, 'gabled');
  const a0 = audit(tris, 'uncut gabled');
  assert(a0.isWatertightManifold === true, '4.0: uncut gabled building is watertight');

  // Clip cutting off half the roof lengthwise (x in [-15, 15], y in [-5, 8])
  const clipped = clipMeshToBox3D(tris, -15, 15, -5, 8);
  const a1 = audit(clipped, 'clipped gabled');
  assert(a1.bm.openEdges === 0, '4.1: clipped gabled openEdges === 0');
  assert(a1.bm.nonManifoldEdges === 0, '4.1: clipped gabled nonManifoldEdges === 0');
  assert(a1.bm.degenerateTris === 0, '4.1: clipped gabled degenerateTris === 0');
  assert(a1.isWatertightManifold === true, '4.1: clipped gabled isWatertight === true');
  assert(a1.bm.volumeMl > 0, `4.1: volumeMl > 0 (got ${a1.bm.volumeMl.toFixed(4)})`);
}

// ----------------------------------------------------------------------------
// TEST 5: Concave Star Polygon (Produces Disconnected Cut Loops)
// ----------------------------------------------------------------------------
console.log('--- TEST 5: Concave Star Polygon (Multi-Component Loops) ---');
{
  const pts = [];
  const spikes = 8, rOuter = 30, rInner = 10;
  for (let i = 0; i < spikes * 2; i++) {
    const r = (i % 2 === 0) ? rOuter : rInner;
    const a = (i / (spikes * 2)) * 2 * Math.PI;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  const tris = [];
  extrudeBuildingLoD2(pts, [], 0, 12, 12, false, 4, 1, tris, 0, 'flat');
  const a0 = audit(tris, 'uncut star');
  assert(a0.isWatertightManifold === true, '5.0: uncut star building is watertight');

  // Clip star with tight box slicing through multiple spikes: [-12, 12] x [-12, 12]
  const clipped = clipMeshToBox3D(tris, -12, 12, -12, 12);
  const a1 = audit(clipped, 'clipped star');
  assert(a1.bm.openEdges === 0, '5.1: clipped star openEdges === 0');
  assert(a1.bm.nonManifoldEdges === 0, '5.1: clipped star nonManifoldEdges === 0');
  assert(a1.bm.degenerateTris === 0, '5.1: clipped star degenerateTris === 0');
  assert(a1.isWatertightManifold === true, '5.1: clipped star isWatertight === true');
  assert(a1.bm.volumeMl > 0, `5.1: volumeMl > 0 (got ${a1.bm.volumeMl.toFixed(4)})`);
}

// ----------------------------------------------------------------------------
// TEST 6: Sub-Micron Slivers & Extreme Asymmetry
// ----------------------------------------------------------------------------
console.log('--- TEST 6: Sub-Micron Slivers & Extreme Asymmetry ---');
{
  const box = generateClosedBox(0, 0, 0, 100, 100, 10);
  
  // Cut plane very close to boundary (0.005mm margin)
  const clipped1 = clipMeshToBox3D(box, 0.005, 99.995, 0.005, 99.995);
  const a1 = audit(clipped1, 'sub-micron margin clip');
  assert(a1.bm.openEdges === 0, '6.1: sliver margin openEdges === 0');
  assert(a1.bm.nonManifoldEdges === 0, '6.1: sliver margin nonManifoldEdges === 0');
  assert(a1.bm.degenerateTris === 0, '6.1: sliver margin degenerateTris === 0');
  assert(a1.isWatertightManifold === true, '6.1: sliver margin isWatertight === true');

  // Extreme aspect ratio box: 500 x 1 x 20 mm
  const thinBox = generateClosedBox(0, 0, 0, 500, 1, 20);
  const clippedThin = clipMeshToBox3D(thinBox, 50, 450, 0.2, 0.8);
  const a2 = audit(clippedThin, 'high aspect ratio clip');
  assert(a2.bm.openEdges === 0, '6.2: high aspect ratio openEdges === 0');
  assert(a2.bm.nonManifoldEdges === 0, '6.2: high aspect ratio nonManifoldEdges === 0');
  assert(a2.isWatertightManifold === true, '6.2: high aspect ratio isWatertight === true');
}

// ----------------------------------------------------------------------------
// TEST 7: Random Monte-Carlo Rotated Boxes (50 Trials)
// ----------------------------------------------------------------------------
console.log('--- TEST 7: Monte-Carlo Rotated & Translated Boxes (50 Trials) ---');
{
  let mcPassed = 0;
  for (let trial = 0; trial < 50; trial++) {
    // Generate rotated box
    const theta = (trial / 50) * Math.PI;
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    const halfW = 15 + (trial % 10), halfH = 10 + ((trial * 3) % 15);
    const basePts = [
      [-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]
    ].map(([x, y]) => [x * cosT - y * sinT, x * sinT + y * cosT]);

    const tris = [];
    extrudeBuildingLoD2(basePts, [], 0, 12, 12, false, 4, 1, tris, 0, 'flat');

    // Random clipping box
    const xMin = -8 - (trial % 5), xMax = 8 + ((trial * 2) % 7);
    const yMin = -7 - ((trial * 3) % 4), yMax = 9 + (trial % 6);

    const clipped = clipMeshToBox3D(tris, xMin, xMax, yMin, yMax);
    if (clipped.length > 0) {
      const a = audit(clipped, `MC trial ${trial}`);
      if (a.bm.openEdges === 0 && a.bm.nonManifoldEdges === 0 && a.bm.degenerateTris === 0 && a.isWatertightManifold) {
        mcPassed++;
      } else {
        console.error(`  [FAIL] MC trial ${trial} failed: open=${a.bm.openEdges}, nonManifold=${a.bm.nonManifoldEdges}, degen=${a.bm.degenerateTris}`);
      }
    } else {
      mcPassed++;
    }
  }
  assert(mcPassed === 50, `7.1: 50/50 Monte-Carlo rotated box trials produced 100% watertight 2-manifold (got ${mcPassed}/50)`);
}

console.log('\n================================================================');
console.log(`  ADVERSARIAL STRESS SUITE RESULTS:`);
console.log(`  Total Assertions: ${assertions}`);
console.log(`  Passed:           ${passed}`);
console.log(`  Failed:           ${failed}`);
console.log('================================================================\n');

if (failed > 0) process.exit(1);
console.log('>>> ALL ADVERSARIAL STRESS TESTS PASSED WITH 100% WATERTIGHT 2-MANIFOLD GEOMETRY <<<\n');
process.exit(0);
