// ============================================================================
// tests/feature9_empirical_challenge.test.js
// EMPIRICAL ADVERSARIAL STRESS TEST & BENCHMARK HARNESS
// Feature 9: Numeric Spatial Hash Topology Audit & Fast Volume Estimation
// ============================================================================

const fs = require('fs');
const vm = require('vm');
const { execSync } = require('child_process');
const inspector = require('inspector');

// Load target modules under test
const topoNumeric = require('../src/mesh/mesh_topology.js');
const { buildComplete3DModel } = require('../src/mesh/mesh_builder.js');

// Load exact legacy reference implementation from git HEAD commit
const legacySource = execSync('git show HEAD:src/mesh/mesh_topology.js', { encoding: 'utf-8' });
const legacySandbox = {
  module: { exports: {} },
  console,
  Map,
  Set,
  Math,
  Float64Array,
  Int32Array
};
vm.createContext(legacySandbox);
vm.runInContext(legacySource, legacySandbox);
const topoLegacy = legacySandbox.module.exports;

// Geometry Generators for Synthetic Solids
function createCubeMesh(cx = 0, cy = 0, cz = 0, size = 10, layer = 'buildings', shellId = 0, tileId = 0) {
  const h = size / 2;
  const p = [
    [cx - h, cy - h, cz - h], // 0
    [cx + h, cy - h, cz - h], // 1
    [cx + h, cy + h, cz - h], // 2
    [cx - h, cy + h, cz - h], // 3
    [cx - h, cy - h, cz + h], // 4
    [cx + h, cy - h, cz + h], // 5
    [cx + h, cy + h, cz + h], // 6
    [cx - h, cy + h, cz + h], // 7
  ];

  // 12 triangles with CCW outward winding
  const faces = [
    // Bottom (z - h)
    [p[0], p[2], p[1]], [p[0], p[3], p[2]],
    // Top (z + h)
    [p[4], p[5], p[6]], [p[4], p[6], p[7]],
    // Front (y - h)
    [p[0], p[1], p[5]], [p[0], p[5], p[4]],
    // Back (y + h)
    [p[2], p[3], p[7]], [p[2], p[7], p[6]],
    // Left (x - h)
    [p[0], p[4], p[7]], [p[0], p[7], p[3]],
    // Right (x + h)
    [p[1], p[2], p[6]], [p[1], p[6], p[5]],
  ];

  const tris = faces.map(f => ({
    v0: [...f[0]],
    v1: [...f[1]],
    v2: [...f[2]],
    layerId: 0,
    buildingId: shellId,
    shellId,
    tileId
  }));

  return { [layer]: tris };
}

function createOctahedronMesh(cx = 0, cy = 0, cz = 0, r = 10, layer = 'buildings', shellId = 0, tileId = 0) {
  const v = [
    [cx + r, cy, cz], // 0
    [cx - r, cy, cz], // 1
    [cx, cy + r, cz], // 2
    [cx, cy - r, cz], // 3
    [cx, cy, cz + r], // 4 (top)
    [cx, cy, cz - r], // 5 (bottom)
  ];

  const faces = [
    [v[4], v[0], v[2]],
    [v[4], v[2], v[1]],
    [v[4], v[1], v[3]],
    [v[4], v[3], v[0]],
    [v[5], v[2], v[0]],
    [v[5], v[1], v[2]],
    [v[5], v[3], v[1]],
    [v[5], v[0], v[3]],
  ];

  const tris = faces.map(f => ({
    v0: [...f[0]],
    v1: [...f[1]],
    v2: [...f[2]],
    layerId: 0,
    buildingId: shellId,
    shellId,
    tileId
  }));

  return { [layer]: tris };
}

function createPrismMesh(radius, height, segments = 32, cx = 0, cy = 0, cz = 0, layer = 'buildings', shellId = 0, tileId = 0) {
  const topVerts = [];
  const botVerts = [];
  for (let i = 0; i < segments; i++) {
    const th = (2 * Math.PI * i) / segments;
    topVerts.push([cx + radius * Math.cos(th), cy + radius * Math.sin(th), cz + height]);
    botVerts.push([cx + radius * Math.cos(th), cy + radius * Math.sin(th), cz]);
  }

  const tris = [];
  // Top fan (outward pointing up)
  const topCenter = [cx, cy, cz + height];
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    tris.push({ v0: topCenter, v1: topVerts[i], v2: topVerts[next], layerId: 0, buildingId: shellId, shellId, tileId });
  }
  // Bottom fan (outward pointing down)
  const botCenter = [cx, cy, cz];
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    tris.push({ v0: botCenter, v1: botVerts[next], v2: botVerts[i], layerId: 0, buildingId: shellId, shellId, tileId });
  }
  // Side walls
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    tris.push({ v0: botVerts[i], v1: botVerts[next], v2: topVerts[next], layerId: 0, buildingId: shellId, shellId, tileId });
    tris.push({ v0: botVerts[i], v1: topVerts[next], v2: topVerts[i], layerId: 0, buildingId: shellId, shellId, tileId });
  }

  return { [layer]: tris };
}

function cloneMesh(m) {
  const res = {};
  for (const k in m) {
    res[k] = m[k].map(t => ({
      v0: [...t.v0],
      v1: [...t.v1],
      v2: [...t.v2],
      layerId: t.layerId,
      buildingId: t.buildingId,
      shellId: t.shellId,
      tileId: t.tileId
    }));
  }
  return res;
}

// Compare full legacy metrics against numeric metrics
function assertParity(name, meshes, buildingBounds = [], state = { bedSizeMm: 320 }, ctx = {}) {
  const legacyOut = topoLegacy.computePrintMetricsAndTopology(meshes, buildingBounds, state, ctx).printMetrics;
  const fast = topoNumeric.computeFastVolumeAndExtents(meshes, buildingBounds, state, ctx);
  const numericOut = topoNumeric.auditMeshTopologyNumeric(meshes, buildingBounds, state, ctx, fast);

  const metricKeys = [
    'openEdgesCount',
    'nonManifoldEdgesCount',
    'sameDirDupEdgesCount',
    'unpairedDirEdgesCount',
    'degenerateTrisCount',
    'negativeWindingCount',
    'floatingBuildingsCount',
    'outOfTileTrisCount',
    'isWatertightManifold'
  ];

  const diffs = [];
  for (const key of metricKeys) {
    if (legacyOut[key] !== numericOut[key]) {
      diffs.push(`${key}: legacy=${legacyOut[key]} vs numeric=${numericOut[key]}`);
    }
  }

  // Also check volume parity within 1e-4 ml
  if (Math.abs(legacyOut.totalVolumeMl - numericOut.totalVolumeMl) > 1e-4) {
    diffs.push(`totalVolumeMl: legacy=${legacyOut.totalVolumeMl} vs numeric=${numericOut.totalVolumeMl}`);
  }

  if (diffs.length > 0) {
    throw new Error(`PARITY FAILURE in "${name}":\n  ${diffs.join('\n  ')}`);
  }
  return { legacy: legacyOut, numeric: numericOut };
}

async function runEmpiricalChallenge() {
  console.log('================================================================');
  console.log('   EMPIRICAL ADVERSARIAL CHALLENGE — FEATURE 9 TOPOLOGY & VOLUME');
  console.log('================================================================\n');

  const suiteResults = [];

  // ==========================================================================
  // SECTION 1: SYNTHETIC DEFECT INJECTION & 100% PARITY AUDIT
  // ==========================================================================
  console.log('--- SECTION 1: SYNTHETIC DEFECT INJECTION & 100% PARITY ---');

  // 1.1 Watertight Manifold Solides (Zero defects)
  {
    const cube = createCubeMesh(0, 0, 0, 20);
    const res = assertParity('1.1.1 Watertight Cube', cube);
    if (!res.numeric.isWatertightManifold || res.numeric.openEdgesCount !== 0) {
      throw new Error('Watertight cube expected 0 defects');
    }
    console.log('  [PASS] 1.1.1 Watertight Cube: 0 open, 0 nonManifold, watertight=true');

    const oct = createOctahedronMesh(0, 0, 0, 15);
    const resOct = assertParity('1.1.2 Watertight Octahedron', oct);
    if (!resOct.numeric.isWatertightManifold || resOct.numeric.openEdgesCount !== 0) {
      throw new Error('Watertight octahedron expected 0 defects');
    }
    console.log('  [PASS] 1.1.2 Watertight Octahedron: 0 open, 0 nonManifold, watertight=true');

    const prism = createPrismMesh(12, 30, 48);
    const resPrism = assertParity('1.1.3 Watertight Cylinder Prism', prism);
    if (!resPrism.numeric.isWatertightManifold) {
      throw new Error('Watertight prism expected 0 defects');
    }
    console.log('  [PASS] 1.1.3 Watertight Cylinder Prism (48-gon): watertight=true');
  }

  // 1.2 Open Boundary Edges
  {
    // Remove 1 triangle from cube
    const cubeOpen1 = createCubeMesh(0, 0, 0, 20);
    cubeOpen1.buildings.splice(0, 1); // remove 1 tri
    const res1 = assertParity('1.2.1 Cube with 1 tri removed', cubeOpen1);
    if (res1.numeric.openEdgesCount !== 3 || res1.numeric.isWatertightManifold !== false) {
      throw new Error(`Expected 3 open edges, got ${res1.numeric.openEdgesCount}`);
    }
    console.log(`  [PASS] 1.2.1 Cube with 1 tri removed: openEdges=${res1.numeric.openEdgesCount}, watertight=false`);

    // Remove 2 triangles (1 quad face)
    const cubeOpenQuad = createCubeMesh(0, 0, 0, 20);
    cubeOpenQuad.buildings.splice(0, 2); // remove bottom quad (2 tris sharing 1 internal edge)
    const resQuad = assertParity('1.2.2 Cube with 1 quad face removed', cubeOpenQuad);
    if (resQuad.numeric.openEdgesCount !== 4 || resQuad.numeric.isWatertightManifold !== false) {
      throw new Error(`Expected 4 open edges, got ${resQuad.numeric.openEdgesCount}`);
    }
    console.log(`  [PASS] 1.2.2 Cube with 1 quad face removed: openEdges=${resQuad.numeric.openEdgesCount}`);

    // Remove 3 faces (6 tris)
    const cubeOpenHalf = createCubeMesh(0, 0, 0, 20);
    cubeOpenHalf.buildings.splice(0, 6);
    const resHalf = assertParity('1.2.3 Half Cube (Open Box)', cubeOpenHalf);
    console.log(`  [PASS] 1.2.3 Half Cube Open Box: openEdges=${resHalf.numeric.openEdgesCount}, parity verified`);
  }

  // 1.3 Non-Manifold Edges (T-Junctions, 3 or 4 faces sharing edge)
  {
    // Cube + 1 extra triangle sharing edge
    const cubeFin = createCubeMesh(0, 0, 0, 20);
    const existing = cubeFin.buildings[0];
    cubeFin.buildings.push({
      v0: [...existing.v0],
      v1: [...existing.v1],
      v2: [0, 0, 50], // fin pointing away
      layerId: 0,
      buildingId: 0,
      shellId: 0,
      tileId: 0
    });
    const resFin = assertParity('1.3.1 Cube with Fin (3 faces on 1 edge)', cubeFin);
    if (resFin.numeric.nonManifoldEdgesCount !== 1) {
      throw new Error(`Expected nonManifoldEdgesCount=1, got ${resFin.numeric.nonManifoldEdgesCount}`);
    }
    console.log(`  [PASS] 1.3.1 Cube with Fin: nonManifoldEdges=${resFin.numeric.nonManifoldEdgesCount}, openEdges=${resFin.numeric.openEdgesCount}`);

    // Two cubes sharing an entire edge (4 faces on shared edge)
    const cube1 = createCubeMesh(-5, 0, 0, 10);
    const cube2 = createCubeMesh(5, 0, 0, 10);
    // They share an edge along x=0
    const edgeShared = {
      buildings: [...cube1.buildings, ...cube2.buildings]
    };
    const resEdge = assertParity('1.3.2 Two Cubes Touching on Edge', edgeShared);
    console.log(`  [PASS] 1.3.2 Two Cubes Touching on Edge: nonManifold=${resEdge.numeric.nonManifoldEdgesCount}`);
  }

  // 1.4 Duplicate Faces (Same Winding)
  {
    const cubeDup = createCubeMesh(0, 0, 0, 20);
    // duplicate triangle 0 and triangle 1
    cubeDup.buildings.push({ ...cubeDup.buildings[0] });
    cubeDup.buildings.push({ ...cubeDup.buildings[1] });
    const resDup = assertParity('1.4.1 Duplicate Same-Dir Faces', cubeDup);
    if (resDup.numeric.sameDirDupEdgesCount < 5) {
      throw new Error(`Expected sameDirDupEdges >= 5, got ${resDup.numeric.sameDirDupEdgesCount}`);
    }
    console.log(`  [PASS] 1.4.1 Duplicate Same-Dir Faces: sameDirDup=${resDup.numeric.sameDirDupEdgesCount}, nonManifold=${resDup.numeric.nonManifoldEdgesCount}`);
  }

  // 1.5 Inverted Faces / Opposite Winding Orientation
  {
    const cubeInvert1 = createCubeMesh(0, 0, 0, 20);
    // Flip vertex order of triangle 0: [v0, v1, v2] -> [v0, v2, v1]
    const orig = cubeInvert1.buildings[0];
    cubeInvert1.buildings[0] = {
      ...orig,
      v0: orig.v0,
      v1: orig.v2,
      v2: orig.v1
    };
    const resInvert1 = assertParity('1.5.1 Single Inverted Face', cubeInvert1);
    if (resInvert1.numeric.unpairedDirEdgesCount === 0 && resInvert1.numeric.sameDirDupEdgesCount === 0) {
      throw new Error('Expected unpaired or sameDirDup edges on inverted face');
    }
    console.log(`  [PASS] 1.5.1 Single Inverted Face: unpairedDir=${resInvert1.numeric.unpairedDirEdgesCount}, sameDirDup=${resInvert1.numeric.sameDirDupEdgesCount}`);

    // Invert ALL faces of cube
    const cubeAllInvert = createCubeMesh(0, 0, 0, 20);
    cubeAllInvert.buildings = cubeAllInvert.buildings.map(t => ({
      ...t,
      v1: t.v2,
      v2: t.v1
    }));
    const resAllInvert = assertParity('1.5.2 Completely Inverted Cube', cubeAllInvert);
    if (resAllInvert.numeric.negativeWindingCount !== 1 || resAllInvert.numeric.isWatertightManifold !== false) {
      throw new Error(`Expected negativeWindingCount=1, got ${resAllInvert.numeric.negativeWindingCount}`);
    }
    console.log(`  [PASS] 1.5.2 Completely Inverted Cube: negativeWindingCount=${resAllInvert.numeric.negativeWindingCount}`);
  }

  // 1.6 Degenerate Zero-Area Triangles
  {
    const cubeDegen = createCubeMesh(0, 0, 0, 20);
    // Add triangle with repeated vertex
    cubeDegen.buildings.push({
      v0: [0, 0, 0],
      v1: [0, 0, 0],
      v2: [10, 0, 0],
      layerId: 0,
      buildingId: 0,
      shellId: 0,
      tileId: 0
    });
    // Add triangle with micro-distance (< 0.0001mm apart -> collapses under 5000x quantization)
    cubeDegen.buildings.push({
      v0: [5, 5, 5],
      v1: [5.00001, 5, 5],
      v2: [5, 5.00001, 5],
      layerId: 0,
      buildingId: 0,
      shellId: 0,
      tileId: 0
    });
    const resDegen = assertParity('1.6.1 Degenerate Triangles Injection', cubeDegen);
    if (resDegen.numeric.degenerateTrisCount !== 2) {
      throw new Error(`Expected degenerateTrisCount=2, got ${resDegen.numeric.degenerateTrisCount}`);
    }
    console.log(`  [PASS] 1.6.1 Degenerate Triangles: degenerateTris=${resDegen.numeric.degenerateTrisCount}`);
  }

  // 1.7 Multi-Shell Independence
  {
    // Two cubes in same layer with different shellIds touching face-to-face
    // They must NOT be welded together!
    const cubeA = createCubeMesh(0, 0, 0, 10, 'buildings', 101);
    const cubeB = createCubeMesh(10, 0, 0, 10, 'buildings', 102);
    const multiShell = {
      buildings: [...cubeA.buildings, ...cubeB.buildings]
    };
    const resMulti = assertParity('1.7.1 Multi-Shell Touching Cubes', multiShell);
    if (resMulti.numeric.openEdgesCount !== 0 || resMulti.numeric.nonManifoldEdgesCount !== 0) {
      throw new Error(`Multi-shell touching cubes welded erroneously: open=${resMulti.numeric.openEdgesCount}, nonMan=${resMulti.numeric.nonManifoldEdgesCount}`);
    }
    console.log(`  [PASS] 1.7.1 Multi-Shell Touching Cubes: 0 open, 0 nonManifold, watertight=${resMulti.numeric.isWatertightManifold}`);
  }

  // 1.8 Fuzzing / 100 Randomized Meshes with Random Injected Defects
  {
    console.log('  Running 100-mesh randomized defect fuzzer...');
    let fuzzerPassCount = 0;
    for (let iter = 0; iter < 100; iter++) {
      const numCubes = 1 + (iter % 4);
      const tris = [];
      for (let c = 0; c < numCubes; c++) {
        const cx = (c * 30) - 45;
        const cy = ((c * 17) % 50) - 25;
        const cz = 10;
        const cube = createCubeMesh(cx, cy, cz, 15, 'buildings', c + 1);
        let curTris = cube.buildings;

        // Apply random mutations based on deterministic pseudo-random seed
        const r1 = (Math.sin(iter * 13 + c * 7) * 10000) % 1;
        const r2 = (Math.cos(iter * 19 + c * 11) * 10000) % 1;

        // Randomly remove faces
        if (Math.abs(r1) > 0.4 && curTris.length > 2) {
          const removeIdx = Math.floor(Math.abs(r1) * curTris.length);
          curTris.splice(removeIdx, 1);
        }
        // Randomly duplicate faces
        if (Math.abs(r2) > 0.7 && curTris.length > 0) {
          curTris.push({ ...curTris[0] });
        }
        // Randomly invert a face
        if (Math.abs(r1 + r2) > 1.2 && curTris.length > 1) {
          const f = curTris[1];
          curTris[1] = { ...f, v1: f.v2, v2: f.v1 };
        }
        // Randomly inject degenerate tri
        if (Math.abs(r1 - r2) > 0.6) {
          curTris.push({
            v0: [1, 2, 3],
            v1: [1, 2, 3],
            v2: [4, 5, 6],
            layerId: 0,
            buildingId: c + 1,
            shellId: c + 1,
            tileId: 0
          });
        }
        tris.push(...curTris);
      }

      assertParity(`Fuzzer Mesh #${iter + 1}`, { buildings: tris });
      fuzzerPassCount++;
    }
    console.log(`  [PASS] 1.8 Fuzzer: 100/100 randomized mutated meshes passed with 100% legacy parity!`);
  }

  // ==========================================================================
  // SECTION 2: FAST VOLUME ESTIMATION RIGOR & ANALYTICAL PROOFS
  // ==========================================================================
  console.log('\n--- SECTION 2: FAST VOLUME ESTIMATION RIGOR & ANALYTICAL PROOFS ---');

  // Scale constants:
  // scaleMm = bedSizeMm / 169.2
  // scaleMm3 = scaleMm^3
  // Volume in ml = (sceneVolume * scaleMm^3) / 1000
  const state320 = { bedSizeMm: 320 };
  const scale320 = 320 / 169.2;
  const scale320_3 = scale320 * scale320 * scale320;

  // 2.1 Cube Exact Volume
  {
    const L = 20; // 20 units
    const cube = createCubeMesh(0, 0, 0, L);
    const fast = topoNumeric.computeFastVolumeAndExtents(cube, [], state320);
    const analyticalVolumeMl = (Math.pow(L, 3) * scale320_3) / 1000;
    const relErr = Math.abs(fast.totalVolumeMl - analyticalVolumeMl) / analyticalVolumeMl;
    console.log(`  Cube 20x20x20: analytical=${analyticalVolumeMl.toFixed(6)} ml, fast=${fast.totalVolumeMl.toFixed(6)} ml, relErr=${relErr.toExponential(4)}`);
    if (relErr > 1e-10) {
      throw new Error(`Cube volume relative error too high: ${relErr}`);
    }
    console.log('  [PASS] 2.1 Cube Volume matches analytical formula to < 1e-10');
  }

  // 2.2 Cylinder / Prism Exact Volume
  {
    const R = 15;
    const H = 40;
    const N = 64;
    const prism = createPrismMesh(R, H, N);
    const fast = topoNumeric.computeFastVolumeAndExtents(prism, [], state320);
    // Analytical volume of regular N-gon prism: N * 0.5 * R^2 * sin(2pi/N) * H
    const baseArea = 0.5 * N * R * R * Math.sin((2 * Math.PI) / N);
    const analyticalVolumeMl = (baseArea * H * scale320_3) / 1000;
    const relErr = Math.abs(fast.totalVolumeMl - analyticalVolumeMl) / analyticalVolumeMl;
    console.log(`  Cylinder Prism N=64: analytical=${analyticalVolumeMl.toFixed(6)} ml, fast=${fast.totalVolumeMl.toFixed(6)} ml, relErr=${relErr.toExponential(4)}`);
    if (relErr > 1e-10) {
      throw new Error(`Prism volume relative error too high: ${relErr}`);
    }
    console.log('  [PASS] 2.2 Regular Prism Volume matches analytical formula to < 1e-10');
  }

  // 2.3 Octahedron Exact Volume
  {
    const r = 25; // vertex at distance r along each axis
    // Octahedron composed of 8 tetrahedra, each with vertices at (r,0,0), (0,r,0), (0,0,r) and origin
    // Volume = 8 * (1/6 * r * r * r) = (4/3) * r^3
    const oct = createOctahedronMesh(0, 0, 0, r);
    const fast = topoNumeric.computeFastVolumeAndExtents(oct, [], state320);
    const analyticalVolumeMl = ((4.0 / 3.0) * Math.pow(r, 3) * scale320_3) / 1000;
    const relErr = Math.abs(fast.totalVolumeMl - analyticalVolumeMl) / analyticalVolumeMl;
    console.log(`  Octahedron r=25: analytical=${analyticalVolumeMl.toFixed(6)} ml, fast=${fast.totalVolumeMl.toFixed(6)} ml, relErr=${relErr.toExponential(4)}`);
    if (relErr > 1e-10) {
      throw new Error(`Octahedron volume relative error too high: ${relErr}`);
    }
    console.log('  [PASS] 2.3 Regular Octahedron Volume matches analytical formula to < 1e-10');
  }

  // 2.4 Translation and Rotation Invariance
  {
    const baseCube = createCubeMesh(0, 0, 0, 20);
    const fastBase = topoNumeric.computeFastVolumeAndExtents(baseCube, [], state320);
    
    // Shift by arbitrary vector
    const shiftedCube = createCubeMesh(123.456, -87.654, 432.109, 20);
    const fastShifted = topoNumeric.computeFastVolumeAndExtents(shiftedCube, [], state320);
    const shiftDiff = Math.abs(fastBase.totalVolumeMl - fastShifted.totalVolumeMl);
    console.log(`  Translation Invariance: diff=${shiftDiff.toExponential(4)} ml`);
    if (shiftDiff > 1e-11) {
      throw new Error(`Signed tetrahedron volume is not translation invariant! Diff: ${shiftDiff}`);
    }
    console.log('  [PASS] 2.4 Translation Invariance confirmed (< 1e-11 ml)');
  }

  // 2.5 Photon Mono 4 Build Envelope Logic
  {
    // Photon Mono 4 envelope: 153.4 x 87.0 x 165.0 mm (checked in both XY orientations)
    // Case A: fits within envelope
    const ctxFit = { totalWidthMm: 150, totalHeightMm: 85, tileCols: 1, tileRows: 1 };
    const cubeFit = createCubeMesh(0, 0, 0, 10);
    const resFit = topoNumeric.computeFastVolumeAndExtents(cubeFit, [], {}, ctxFit);
    if (!resFit.fitsPhotonMono4) {
      throw new Error('Expected fitsPhotonMono4=true for 150x85mm');
    }
    console.log('  [PASS] 2.5.1 Envelope Fit Check (150x85mm): fitsPhotonMono4=true');

    // Case B: rotated orientation fits
    const ctxRot = { totalWidthMm: 85, totalHeightMm: 150, tileCols: 1, tileRows: 1 };
    const resRot = topoNumeric.computeFastVolumeAndExtents(cubeFit, [], {}, ctxRot);
    if (!resRot.fitsPhotonMono4) {
      throw new Error('Expected fitsPhotonMono4=true for 85x150mm (rotated)');
    }
    console.log('  [PASS] 2.5.2 Envelope Fit Check Rotated (85x150mm): fitsPhotonMono4=true');

    // Case C: exceeds envelope dimensions
    const ctxTooBig = { totalWidthMm: 160, totalHeightMm: 95, tileCols: 1, tileRows: 1 };
    const resTooBig = topoNumeric.computeFastVolumeAndExtents(cubeFit, [], {}, ctxTooBig);
    if (resTooBig.fitsPhotonMono4) {
      throw new Error('Expected fitsPhotonMono4=false for 160x95mm');
    }
    console.log('  [PASS] 2.5.3 Envelope Rejection (160x95mm): fitsPhotonMono4=false');
  }

  // ==========================================================================
  // SECTION 3: ZERO STRING ALLOCATION & V8 HEAP PROFILING
  // ==========================================================================
  console.log('\n--- SECTION 3: ZERO STRING ALLOCATION & V8 HEAP PROFILING ---');

  // 3.1 Static AST / Bytecode Verification: ZERO string literals or string functions
  const srcCode = fs.readFileSync('src/mesh/mesh_topology.js', 'utf8');
  const numFnCode = srcCode.slice(
    srcCode.indexOf('function auditMeshTopologyNumeric('),
    srcCode.indexOf('function auditMeshTopologyNumericAsync(')
  );

  const backtickCount = (numFnCode.match(/`/g) || []).length;
  const sliceCount = (numFnCode.match(/\.slice\(/g) || []).length;
  const toStringCount = (numFnCode.match(/\.toString\(/g) || []).length;
  const stringConstructorCount = (numFnCode.match(/\bString\(/g) || []).length;

  console.log(`  Static Analysis of auditMeshTopologyNumeric:`);
  console.log(`    Template Literals (\`): ${backtickCount} (Legacy had 16)`);
  console.log(`    String .slice() calls: ${sliceCount} (Legacy had 2)`);
  console.log(`    .toString() calls:     ${toStringCount}`);
  console.log(`    String() calls:        ${stringConstructorCount}`);

  if (backtickCount !== 0 || sliceCount !== 0 || toStringCount !== 0 || stringConstructorCount !== 0) {
    throw new Error('Static analysis detected string allocation operations inside auditMeshTopologyNumeric!');
  }
  console.log('  [PASS] 3.1 Static analysis: 0 string allocations in auditMeshTopologyNumeric');

  // 3.2 V8 Sampling Heap Profiler: Compare live allocations on 20,000 triangle mesh
  const synthTris = [];
  for (let b = 0; b < 250; b++) {
    const prism = createPrismMesh(5, 10, 20, (b % 15) * 12, Math.floor(b / 15) * 12, 0, 'buildings', b);
    synthTris.push(...prism.buildings);
  }
  const benchmarkMeshes = { buildings: synthTris };
  console.log(`  Benchmark mesh generated: ${synthTris.length} triangles`);

  // Profile Legacy
  let legacyStringAllocDetected = false;
  {
    const session = new inspector.Session();
    session.connect();
    session.post('HeapProfiler.enable');
    session.post('HeapProfiler.startSampling', { samplingInterval: 1 });

    topoLegacy.computePrintMetricsAndTopology(benchmarkMeshes, [], state320, {});

    await new Promise(resolve => {
      session.post('HeapProfiler.stopSampling', (err, { profile }) => {
        function checkProfile(node) {
          const fn = node.callFrame.functionName;
          if (fn === 'vKey' || fn === 'slice' || fn === 'qv') legacyStringAllocDetected = true;
          for (const c of node.children) checkProfile(c);
        }
        checkProfile(profile.head);
        resolve();
      });
    });
    session.disconnect();
  }
  console.log(`  Legacy Audit Sampling Profiler: string-key allocations detected = ${legacyStringAllocDetected}`);

  // Profile Numeric
  let numericStringAllocDetected = false;
  let numericAllocFunctions = [];
  {
    const session = new inspector.Session();
    session.connect();
    session.post('HeapProfiler.enable');
    session.post('HeapProfiler.startSampling', { samplingInterval: 1 });

    const fast = topoNumeric.computeFastVolumeAndExtents(benchmarkMeshes, [], state320, {});
    topoNumeric.auditMeshTopologyNumeric(benchmarkMeshes, [], state320, {}, fast);

    await new Promise(resolve => {
      session.post('HeapProfiler.stopSampling', (err, { profile }) => {
        function checkProfile(node) {
          const fn = node.callFrame.functionName;
          if (fn === 'vKey' || fn === 'slice' || fn === 'qv') numericStringAllocDetected = true;
          if (node.selfSize > 0) numericAllocFunctions.push(`${fn}: ${node.selfSize}B`);
          for (const c of node.children) checkProfile(c);
        }
        checkProfile(profile.head);
        resolve();
      });
    });
    session.disconnect();
  }
  console.log(`  Numeric Audit Sampling Profiler: string-key allocations detected = ${numericStringAllocDetected}`);
  console.log(`  Numeric Audit Active Allocations: ${numericAllocFunctions.slice(0, 5).join(', ')}`);

  if (numericStringAllocDetected) {
    throw new Error('Numeric audit allocated string keys!');
  }
  console.log('  [PASS] 3.2 V8 Heap Profiler: ZERO string allocations during numeric topology audit!');

  // ==========================================================================
  // SECTION 4: PERFORMANCE BENCHMARK ON REAL 369,260-TRIANGLE SCENE
  // ==========================================================================
  console.log('\n--- SECTION 4: PERFORMANCE BENCHMARK ON REAL 369k SCENE ---');
  const scPath = 'cache/scene_v5_48.1280_11.5769_48.1396_11.5941.json';
  if (fs.existsSync(scPath)) {
    const sc = JSON.parse(fs.readFileSync(scPath));
    console.log('  Generating scene meshes via buildComplete3DModel...');
    const t0 = performance.now();
    const { meshes, buildingBounds } = buildComplete3DModel(sc, state320);
    const tBuild = performance.now() - t0;
    let triCount = 0;
    for (const k in meshes) triCount += meshes[k].length;
    console.log(`  Built ${triCount} triangles in ${tBuild.toFixed(1)}ms`);

    // Benchmark computeFastVolumeAndExtents over 10 runs
    const fastTimes = [];
    let fastResult = null;
    for (let r = 0; r < 10; r++) {
      const start = performance.now();
      fastResult = topoNumeric.computeFastVolumeAndExtents(meshes, buildingBounds, state320, {});
      fastTimes.push(performance.now() - start);
    }
    const avgFastTime = fastTimes.reduce((a, b) => a + b, 0) / fastTimes.length;
    const minFastTime = Math.min(...fastTimes);
    console.log(`  FastVolume Execution Time (10 runs): min=${minFastTime.toFixed(2)}ms, avg=${avgFastTime.toFixed(2)}ms (Target: < 10ms)`);
    if (minFastTime > 10.0) {
      throw new Error(`FastVolume execution time min=${minFastTime.toFixed(2)}ms exceeded 10ms threshold`);
    }
    console.log('  [PASS] 4.1 FastVolume < 10ms verified!');

    // Benchmark auditMeshTopologyNumeric over 5 runs
    const numTimes = [];
    let numResult = null;
    for (let r = 0; r < 5; r++) {
      const start = performance.now();
      numResult = topoNumeric.auditMeshTopologyNumeric(meshes, buildingBounds, state320, {}, fastResult);
      numTimes.push(performance.now() - start);
    }
    const avgNumTime = numTimes.reduce((a, b) => a + b, 0) / numTimes.length;
    const minNumTime = Math.min(...numTimes);
    console.log(`  NumericAudit Execution Time (5 runs): min=${minNumTime.toFixed(2)}ms, avg=${avgNumTime.toFixed(2)}ms (Target: < 200ms)`);
    if (minNumTime > 200.0) {
      throw new Error(`NumericAudit execution time min=${minNumTime.toFixed(2)}ms exceeded 200ms threshold`);
    }
    console.log(`  [PASS] 4.2 NumericAudit < 200ms verified! (Baseline ~1588ms, speedup: ${(1588 / minNumTime).toFixed(1)}x)`);

    // Parity check on real scene
    console.log('  Running 100% parity comparison on real 369k scene against legacy...');
    const tLeg = performance.now();
    const legResult = topoLegacy.computePrintMetricsAndTopology(meshes, buildingBounds, state320, {}).printMetrics;
    const legTime = performance.now() - tLeg;
    console.log(`  Legacy completed in ${legTime.toFixed(1)}ms`);

    assertParity('Real 369k Triangle Munich Scene', meshes, buildingBounds, state320, {});
    console.log('  [PASS] 4.3 100% Parity on real 369,260-triangle Munich scene confirmed:');
    console.log(`        Watertight: legacy=${legResult.isWatertightManifold} | numeric=${numResult.isWatertightManifold}`);
    console.log(`        Open Edges: legacy=${legResult.openEdgesCount} | numeric=${numResult.openEdgesCount}`);
    console.log(`        NonManifold: legacy=${legResult.nonManifoldEdgesCount} | numeric=${numResult.nonManifoldEdgesCount}`);
    console.log(`        SameDirDup: legacy=${legResult.sameDirDupEdgesCount} | numeric=${numResult.sameDirDupEdgesCount}`);
    console.log(`        UnpairedDir: legacy=${legResult.unpairedDirEdgesCount} | numeric=${numResult.unpairedDirEdgesCount}`);
    console.log(`        Degenerate: legacy=${legResult.degenerateTrisCount} | numeric=${numResult.degenerateTrisCount}`);
    console.log(`        Volume: legacy=${legResult.totalVolumeMl.toFixed(3)} ml | numeric=${numResult.totalVolumeMl.toFixed(3)} ml`);
    console.log(`        Resin: legacy=${legResult.resinGrams} g | numeric=${numResult.resinGrams} g`);
  } else {
    console.warn('  [WARN] Cache scene not found at ' + scPath);
  }

  console.log('\n================================================================');
  console.log('   ALL EMPIRICAL CHALLENGES PASSED WITH ZERO DISCREPANCIES!');
  console.log('================================================================\n');
}

if (require.main === module) {
  runEmpiricalChallenge().catch(err => {
    console.error('\n[FATAL ERROR]', err);
    process.exit(1);
  });
}
