// tests/adversarial_verify_m5_independent.js
// ============================================================================
// INDEPENDENT CHALLENGER VERIFICATION HARNESS — MILESTONE 5 REMEDIATION
// Independent empirical verification of Gaps 1-4 & Secondary Edge-Case Probing
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

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, desc) {
  totalTests++;
  if (!condition) {
    failedTests++;
    failures.push(desc);
    console.error(`  [FAIL] ${desc}`);
  } else {
    passedTests++;
  }
}

let shellCounter = 2000;
function auditTriangles(tris, label = 'mesh') {
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
    bm: res.layerMetrics.buildings
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

console.log('================================================================');
console.log('  CHALLENGER INDEPENDENT VERIFICATION & REGRESSION PROBE');
console.log('================================================================\n');

// ============================================================================
// SECTION 1: VERIFICATION OF THE 4 PREVIOUSLY IDENTIFIED REMEDIATED DEFECTS
// ============================================================================

// --- GAP 1: Zero-Height & Inverted-Height Extrusion Clamping ---
console.log('--- SECTION 1.1: Gap 1 Verification (Zero/Inverted Height Clamping) ---');
{
  // 1.1: Exact zero-height on simple rectangle
  const tris1 = [];
  extrudeBuildingLoD2([[0,0],[20,0],[20,20],[0,20]], [], 2.35, 2.35, 2.35, false, 4, 1, tris1, 0, 'flat');
  const a1 = auditTriangles(tris1, 'zero-height simple');
  assert(a1.bm.degenerateTris === 0, 'Gap 1.1: degenerateTris === 0 for exact zero-height');
  assert(a1.bm.openEdges === 0, 'Gap 1.1: openEdges === 0 for exact zero-height');
  assert(a1.bm.nonManifoldEdges === 0, 'Gap 1.1: nonManifoldEdges === 0 for exact zero-height');
  assert(a1.isWatertightManifold === true, 'Gap 1.1: isWatertightManifold === true');
  assert(a1.bm.volumeMl > 0, `Gap 1.1: volumeMl > 0 (got ${a1.bm.volumeMl.toFixed(4)} ml)`);

  // 1.2: Inverted-height (zEaves < zBase)
  const tris2 = [];
  extrudeBuildingLoD2([[0,0],[20,0],[20,20],[0,20]], [], 5.0, 1.0, 1.0, false, 4, 1, tris2, 0, 'flat');
  const a2 = auditTriangles(tris2, 'inverted-height');
  assert(a2.bm.degenerateTris === 0, 'Gap 1.2: degenerateTris === 0 for inverted zEaves < zBase');
  assert(a2.bm.openEdges === 0, 'Gap 1.2: openEdges === 0 for inverted zEaves < zBase');
  assert(a2.bm.nonManifoldEdges === 0, 'Gap 1.2: nonManifoldEdges === 0 for inverted zEaves < zBase');
  assert(a2.isWatertightManifold === true, 'Gap 1.2: isWatertightManifold === true');

  // 1.3: Inverted ridge (zRidge < zEaves)
  const tris3 = [];
  extrudeBuildingLoD2([[0,0],[30,0],[30,20],[0,20]], [], 2.0, 10.0, 5.0, true, 4, 1, tris3, 0, 'gabled');
  const a3 = auditTriangles(tris3, 'inverted ridge');
  assert(a3.bm.degenerateTris === 0, 'Gap 1.3: degenerateTris === 0 for inverted zRidge < zEaves');
  assert(a3.bm.openEdges === 0, 'Gap 1.3: openEdges === 0 for inverted zRidge < zEaves');
  assert(a3.isWatertightManifold === true, 'Gap 1.3: isWatertightManifold === true');

  // 1.4: Concave L-shaped zero height
  const lShape = [[0,0],[30,0],[30,10],[10,10],[10,30],[0,30]];
  const tris4 = [];
  extrudeBuildingLoD2(lShape, [], 2.35, 2.35, 2.35, false, 4, 1, tris4, 0, 'flat');
  const a4 = auditTriangles(tris4, 'concave zero-height');
  assert(a4.bm.degenerateTris === 0, 'Gap 1.4: degenerateTris === 0 for concave zero-height');
  assert(a4.bm.openEdges === 0, 'Gap 1.4: openEdges === 0 for concave zero-height');
  assert(a4.isWatertightManifold === true, 'Gap 1.4: isWatertightManifold === true');

  // 1.5: Courtyard hole zero height
  const outer = [[0,0],[40,0],[40,40],[0,40]];
  const holes = [[[10,10],[30,10],[30,30],[10,30]]];
  const tris5 = [];
  extrudeBuildingLoD2(outer, holes, 2.35, 2.35, 2.35, false, 4, 1, tris5, 0, 'flat');
  const a5 = auditTriangles(tris5, 'courtyard zero-height');
  assert(a5.bm.degenerateTris === 0, 'Gap 1.5: degenerateTris === 0 for courtyard zero-height');
  assert(a5.bm.openEdges === 0, 'Gap 1.5: openEdges === 0 for courtyard zero-height');
  assert(a5.isWatertightManifold === true, 'Gap 1.5: isWatertightManifold === true');
}

// --- GAP 2: Defensive Relief Chimney Validation & CW Normal Enforcement ---
console.log('--- SECTION 1.2: Gap 2 Verification (Relief Chimney Validation) ---');
{
  // 2.1: CCW Polygon provided externally
  const tris1 = [];
  extrudeBuildingLoD2([[0,0],[50,0],[50,50],[0,50]], [], 2.35, 20.0, 20.0, false, 4, 1, tris1, 0, 'flat', {
    reliefChimney: {
      chimneyPoly: [[10, 10], [40, 10], [40, 40], [10, 40]], // CCW
      zVaultBase: 12.0, zVaultApex: 16.0
    }
  });
  const a1 = auditTriangles(tris1, 'CCW chimney');
  assert(a1.bm.sameDirDupEdges === 0, 'Gap 2.1: sameDirDupEdges === 0 for CCW input');
  assert(a1.bm.unpairedDirEdges === 0, 'Gap 2.1: unpairedDirEdges === 0 for CCW input');
  assert(a1.bm.openEdges === 0, 'Gap 2.1: openEdges === 0 for CCW input');
  assert(a1.bm.nonManifoldEdges === 0, 'Gap 2.1: nonManifoldEdges === 0 for CCW input');
  assert(a1.isWatertightManifold === true, 'Gap 2.1: isWatertightManifold === true');

  // 2.2: CW Polygon provided externally
  const tris2 = [];
  extrudeBuildingLoD2([[0,0],[50,0],[50,50],[0,50]], [], 2.35, 20.0, 20.0, false, 4, 1, tris2, 0, 'flat', {
    reliefChimney: {
      chimneyPoly: [[10, 10], [10, 40], [40, 40], [40, 10]], // CW
      zVaultBase: 12.0, zVaultApex: 16.0
    }
  });
  const a2 = auditTriangles(tris2, 'CW chimney');
  assert(a2.bm.sameDirDupEdges === 0, 'Gap 2.2: sameDirDupEdges === 0 for CW input');
  assert(a2.bm.openEdges === 0, 'Gap 2.2: openEdges === 0 for CW input');
  assert(a2.bm.nonManifoldEdges === 0, 'Gap 2.2: nonManifoldEdges === 0 for CW input');
  assert(a2.isWatertightManifold === true, 'Gap 2.2: isWatertightManifold === true');

  // 2.3: Sub-3 vertex chimney polygon (2 vertices, 1 vertex, empty)
  const tris3 = [];
  extrudeBuildingLoD2([[0,0],[50,0],[50,50],[0,50]], [], 2.35, 20.0, 20.0, false, 4, 1, tris3, 0, 'flat', {
    reliefChimney: { chimneyPoly: [[10, 10], [40, 40]], zVaultBase: 12.0, zVaultApex: 16.0 }
  });
  const a3 = auditTriangles(tris3, '2-vertex chimney');
  assert(a3.bm.openEdges === 0, 'Gap 2.3a: 2-vertex chimney falls back to solid flat bottom cap without open edges');
  assert(a3.isWatertightManifold === true, 'Gap 2.3a: isWatertightManifold === true');

  const tris4 = [];
  extrudeBuildingLoD2([[0,0],[50,0],[50,50],[0,50]], [], 2.35, 20.0, 20.0, false, 4, 1, tris4, 0, 'flat', {
    reliefChimney: { chimneyPoly: [[10, 10]], zVaultBase: 12.0, zVaultApex: 16.0 }
  });
  const a4 = auditTriangles(tris4, '1-vertex chimney');
  assert(a4.isWatertightManifold === true, 'Gap 2.3b: 1-vertex chimney falls back cleanly');

  const tris5 = [];
  extrudeBuildingLoD2([[0,0],[50,0],[50,50],[0,50]], [], 2.35, 20.0, 20.0, false, 4, 1, tris5, 0, 'flat', {
    reliefChimney: { chimneyPoly: [], zVaultBase: 12.0, zVaultApex: 16.0 }
  });
  const a5 = auditTriangles(tris5, 'empty chimney');
  assert(a5.isWatertightManifold === true, 'Gap 2.3c: empty chimney falls back cleanly');

  // 2.4: Inverted vault heights (zVaultApex <= zVaultBase) and zVaultBase < zBase
  const tris6 = [];
  extrudeBuildingLoD2([[0,0],[50,0],[50,50],[0,50]], [], 2.35, 20.0, 20.0, false, 4, 1, tris6, 0, 'flat', {
    reliefChimney: { chimneyPoly: [[10, 10], [40, 10], [40, 40], [10, 40]], zVaultBase: 15.0, zVaultApex: 12.0 }
  });
  const a6 = auditTriangles(tris6, 'inverted vault heights');
  assert(a6.isWatertightManifold === true, 'Gap 2.4a: inverted vault heights handled safely');

  const tris7 = [];
  extrudeBuildingLoD2([[0,0],[50,0],[50,50],[0,50]], [], 2.35, 20.0, 20.0, false, 4, 1, tris7, 0, 'flat', {
    reliefChimney: { chimneyPoly: [[10, 10], [40, 10], [40, 40], [10, 40]], zVaultBase: 1.0, zVaultApex: 16.0 }
  });
  const a7 = auditTriangles(tris7, 'zVaultBase below zBase');
  assert(a7.isWatertightManifold === true, 'Gap 2.4b: zVaultBase below zBase handled safely');
}

// --- GAP 3: UI_CONFIG Numeric Positivity & Boundary Validation ---
console.log('--- SECTION 1.3: Gap 3 Verification (checkTileFitsMono4 & ui_config) ---');
{
  assert(checkTileFitsMono4(-10, -10) === false, 'Gap 3.1a: checkTileFitsMono4(-10, -10) === false');
  assert(checkTileFitsMono4(0, 0) === false, 'Gap 3.1b: checkTileFitsMono4(0, 0) === false');
  assert(checkTileFitsMono4(-0.001, 84) === false, 'Gap 3.1c: checkTileFitsMono4(-0.001, 84) === false');
  assert(checkTileFitsMono4(75, 0) === false, 'Gap 3.1d: checkTileFitsMono4(75, 0) === false');
  assert(checkTileFitsMono4(75, 84, -0.01) === false, 'Gap 3.1e: checkTileFitsMono4(75, 84, -0.01) === false');
  assert(checkTileFitsMono4(75, 84, 0) === false, 'Gap 3.1f: checkTileFitsMono4(75, 84, 0) === false');
  assert(checkTileFitsMono4('foo', 84) === false, 'Gap 3.2a: string rejected');
  assert(checkTileFitsMono4(NaN, 84) === false, 'Gap 3.2b: NaN rejected');
  assert(checkTileFitsMono4(null, 84) === false, 'Gap 3.2c: null rejected');
  assert(checkTileFitsMono4(undefined, 84) === false, 'Gap 3.2d: undefined rejected');
  assert(checkTileFitsMono4(Infinity, 84) === false, 'Gap 3.2e: Infinity rejected');
  assert(checkTileFitsMono4({}, 84) === false, 'Gap 3.2f: object rejected');
  assert(checkTileFitsMono4([], 84) === false, 'Gap 3.2g: empty array rejected');
  assert(checkTileFitsMono4(153.45, 87.05, 165.0) === true, 'Gap 3.3a: max dimensions accepted');
  assert(checkTileFitsMono4(87.05, 153.45, 165.0) === true, 'Gap 3.3b: rotated max dimensions accepted');
  assert(checkTileFitsMono4(153.46, 87.05, 165.0) === false, 'Gap 3.3c: width + 0.01 rejected');
  assert(checkTileFitsMono4(153.45, 87.06, 165.0) === false, 'Gap 3.3d: height + 0.01 rejected');
  assert(checkTileFitsMono4(153.45, 87.05, 165.01) === false, 'Gap 3.3e: Z + 0.01 rejected');
  assert(checkTileDualPackableMono4(75, 84) === true, 'Gap 3.4a: standard 75x84 is dual packable');
  assert(checkTileDualPackableMono4(84, 75) === true, 'Gap 3.4b: rotated 84x75 is dual packable');
  assert(checkTileDualPackableMono4(75.45, 87.05) === true, 'Gap 3.4c: max boundary dual packable');
  assert(checkTileDualPackableMono4(75.46, 87.05) === false, 'Gap 3.4d: width > 75.45 not dual packable');
  assert(checkTileDualPackableMono4(-75, 84) === false, 'Gap 3.4e: negative width not dual packable');
  assert(checkTileDualPackableMono4(0, 84) === false, 'Gap 3.4f: zero width not dual packable');
  assert(checkTileDualPackableMono4(NaN, 84) === false, 'Gap 3.4g: NaN not dual packable');
}

// --- GAP 4: CSG 2-Plane Diagonal Cut Loop Repair ---
console.log('--- SECTION 1.4: Gap 4 Verification (2-Plane Diagonal Cut Watertightness) ---');
{
  const box = generateClosedBox(-20, -20, 0, 20, 20, 15, 4, 904);
  let cur = clipClosedMeshByAxisPlane(box, 0, -10, true);
  cur = clipClosedMeshByAxisPlane(cur, 0, 10, false);
  const a = auditTriangles(cur, 'diagonal box clip x=[-10, 10]');
  assert(a.bm.openEdges === 0, 'Gap 4.1: openEdges === 0 on 2-plane diagonal cut');
  assert(a.bm.nonManifoldEdges === 0, 'Gap 4.1: nonManifoldEdges === 0 on 2-plane diagonal cut');
  assert(a.bm.degenerateTris === 0, 'Gap 4.1: degenerateTris === 0 on 2-plane diagonal cut');
  assert(a.isWatertightManifold === true, 'Gap 4.1: isWatertightManifold === true');
  assert(a.bm.volumeMl > 0, `Gap 4.1: volumeMl > 0 (got ${a.bm.volumeMl.toFixed(4)} ml)`);

  // Direct triangulateCutLoopExact verification on collinear points
  const loopWithCollinear = [[0, 0], [5, 0], [10, 0], [15, 0], [20, 0], [20, 20], [0, 20]];
  const capTris = triangulateCutLoopExact(loopWithCollinear);
  assert(capTris.length > 0, 'Gap 4.2a: triangulateCutLoopExact produces triangles for loop with collinear vertices');
  const key2 = p => p[0].toFixed(5) + '_' + p[1].toFixed(5);
  const usedPts = new Set();
  let totalArea = 0;
  for (const tri of capTris) {
    usedPts.add(key2(tri[0]));
    usedPts.add(key2(tri[1]));
    usedPts.add(key2(tri[2]));
    const ax = tri[1][0] - tri[0][0], ay = tri[1][1] - tri[0][1];
    const bx = tri[2][0] - tri[0][0], by = tri[2][1] - tri[0][1];
    totalArea += 0.5 * (ax * by - ay * bx);
  }
  for (const p of loopWithCollinear) {
    assert(usedPts.has(key2(p)), `Gap 4.2b: boundary vertex (${p[0]}, ${p[1]}) is present in triangulation`);
  }
  assert(Math.abs(totalArea - 400.0) < 1e-4, `Gap 4.2c: totalArea === 400.0 (got ${totalArea.toFixed(4)})`);
}

// ============================================================================
// SECTION 2: ADVERSARIAL PROBING FOR SECONDARY EDGE CASES & REMAINING GAPS
// ============================================================================
console.log('\n--- SECTION 2: Adversarial Probing & Secondary Edge Cases ---');

// Probe 2.1: 4-Plane Bounding Box Clipping on Non-Aligned Asymmetric Cut Bounds
{
  const box = generateClosedBox(0, 0, 0, 100, 100, 20, 4, 905);
  const clipped = clipMeshToBox3D(box, 10, 90, 20, 80);
  const a = auditTriangles(clipped, 'asymmetric box clip');
  assert(a.bm.openEdges === 0, 'Probe 2.1a: openEdges === 0 on asymmetric 4-plane clip');
  assert(a.bm.nonManifoldEdges === 0, 'Probe 2.1b: nonManifoldEdges === 0 on asymmetric 4-plane clip');
  assert(a.bm.degenerateTris === 0, 'Probe 2.1c: degenerateTris === 0 on asymmetric 4-plane clip');
  assert(a.isWatertightManifold === true, 'Probe 2.1d: isWatertightManifold === true');
}

// Probe 2.2: 4-Plane Clipping on Cylindrical 12-gon Mesh
{
  const N = 12, R = 15;
  const cylinderPts = [];
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * 2 * Math.PI;
    cylinderPts.push([R * Math.cos(angle), R * Math.sin(angle)]);
  }
  const cylTris = [];
  extrudeBuildingLoD2(cylinderPts, [], 0, 20, 20, false, 4, 1, cylTris, 0, 'flat');
  const clippedCyl = clipMeshToBox3D(cylTris, -8, 8, -8, 8);
  const a = auditTriangles(clippedCyl, 'cylinder 4-plane clip');
  assert(a.bm.openEdges === 0, 'Probe 2.2a: openEdges === 0 on cylinder 4-plane clip');
  assert(a.bm.nonManifoldEdges === 0, 'Probe 2.2b: nonManifoldEdges === 0 on cylinder 4-plane clip');
  assert(a.isWatertightManifold === true, 'Probe 2.2c: isWatertightManifold === true on cylinder 4-plane clip');
}

// Probe 2.3: Empirical Detection of Remaining Gap 4b:
// 4-Plane Box Clipping When Orthogonal Cut Planes Pass Through Coincident Diagonal Corner Vertices
console.log('\n--- PROBE 2.3: Empirical Detection of Remaining Gap 4b ---');
{
  const box = generateClosedBox(-20, -20, 0, 20, 20, 15, 4, 905);
  const clipped = clipMeshToBox3D(box, -10, 10, -10, 10);
  const a = auditTriangles(clipped, 'symmetric 4-plane box clip');
  console.log(`  [GAP 4b PROBE RESULT] clipMeshToBox3D on symmetric diagonal box:`);
  console.log(`    openEdges:          ${a.bm.openEdges}`);
  console.log(`    nonManifoldEdges:   ${a.bm.nonManifoldEdges}`);
  console.log(`    degenerateTris:     ${a.bm.degenerateTris}`);
  console.log(`    isWatertight:       ${a.isWatertightManifold}`);
  if (!a.isWatertightManifold) {
    console.log(`  >>> CONFIRMED REMAINING GAP 4b: 4-plane box clipping produces non-watertight geometry (${a.bm.openEdges} open edges, ${a.bm.nonManifoldEdges} non-manifold edges) <<<`);
  }
}

// ============================================================================
// SUMMARY
// ============================================================================
console.log('\n================================================================');
console.log(`  INDEPENDENT VERIFICATION SUMMARY:`);
console.log(`  Total Core Invariant Assertions: ${totalTests}`);
console.log(`  Passed:                         ${passedTests}`);
console.log(`  Failed:                         ${failedTests}`);
console.log('================================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('>>> ALL CORE REPAIR INVARIANTS EMPIRICALLY CONFIRMED (GAPS 1, 2, 3, 4a VERIFIED) <<<');
  process.exit(0);
}
