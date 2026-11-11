// tests/auditor_m2_forensic_suite.js
// Independent Forensic Integrity Test Suite for Milestone 2
// Tests: Arbitrary input reactivity, geometric soundness, cancellation & yielding, zero mocking

const assert = require('assert');
const fs = require('fs');
const mb = require('../src/mesh/mesh_builder.js');
const poly = require('../src/geometry/polygon_2d.js');
const clipper = require('../src/mesh/mesh_clipper_3d.js');
const topo = require('../src/mesh/mesh_topology.js');

async function runForensics() {
  console.log('=== AUDITOR FORENSIC SUITE START ===');

  // TEST 1: Tree Placement Reactivity (Anti-Hardcoding & Parity)
  console.log('\n--- 1. Tree Placement Reactivity & Parity ---');
  {
    const baseScene = JSON.parse(fs.readFileSync('cache/scene_v5_52.2415_21.0050_52.2525_21.0220.json'));
    
    // Scene A: 50 trees
    const scA = JSON.parse(JSON.stringify(baseScene));
    scA.trees = baseScene.trees.slice(0, 50);

    // Scene B: 300 trees
    const scB = JSON.parse(JSON.stringify(baseScene));
    scB.trees = baseScene.trees.slice(0, 300);

    // Run Sync and Progressive for Scene A
    const syncA = mb.buildComplete3DModel(scA, { bedSizeMm: 320 });
    const progA = await mb.rebuildModel3DProgressive(scA, { bedSizeMm: 320 });
    assert.strictEqual(syncA.meshes.greenery.length, progA.meshes.greenery.length, 'Scene A greenery parity fail');
    assert.strictEqual(syncA.meshes.greenery.length - progA.meshes.greenery.length, 0);

    // Run Sync and Progressive for Scene B
    const syncB = mb.buildComplete3DModel(scB, { bedSizeMm: 320 });
    const progB = await mb.rebuildModel3DProgressive(scB, { bedSizeMm: 320 });
    assert.strictEqual(syncB.meshes.greenery.length, progB.meshes.greenery.length, 'Scene B greenery parity fail');
    assert.strictEqual(syncB.meshes.greenery.length - progB.meshes.greenery.length, 0);

    // Verify Scene A and Scene B have different tree counts, proving dynamic placement
    assert.notStrictEqual(syncA.meshes.greenery.length, syncB.meshes.greenery.length, 'Tree placement must react dynamically to inputs');
    console.log(`[PASS] Dynamic Tree Placement: Scene A (50 trees) = ${syncA.meshes.greenery.length} tris, Scene B (300 trees) = ${syncB.meshes.greenery.length} tris (Parity Diff: 0)`);
  }

  // TEST 2: Ear-Clipper Mathematical Area Conservation & Collinear Invariance
  console.log('\n--- 2. Ear-Clipper Mathematical Rigor on Synthetic Inputs ---');
  {
    // Generate arbitrary star with N points
    const makeStar = (nPoints, rInner, rOuter) => {
      const pts = [];
      for (let i = 0; i < nPoints * 2; i++) {
        const r = (i % 2 === 0) ? rOuter : rInner;
        const angle = (i / (nPoints * 2)) * Math.PI * 2;
        pts.push([Math.cos(angle) * r, Math.sin(angle) * r]);
      }
      return pts;
    };

    for (const n of [7, 23, 77, 251]) {
      const star = makeStar(n, 15.3, 48.7);
      const expectedArea = Math.abs(poly.signedArea2D(star));

      const trisClipper = clipper.triangulateCutLoopExact(star);
      const trisPoly = poly.triangulateSimplePoly(star);

      assert.strictEqual(trisClipper.length, star.length - 2, `Clipper tri count mismatch for N=${n}`);
      assert.strictEqual(trisPoly.length, star.length - 2, `Poly tri count mismatch for N=${n}`);

      let areaClipper = 0, areaPoly = 0;
      for (const t of trisClipper) {
        areaClipper += Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0])) * 0.5;
      }
      for (const t of trisPoly) {
        areaPoly += Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0])) * 0.5;
      }

      assert(Math.abs(areaClipper - expectedArea) < 1e-7, `Clipper area mismatch for N=${n}`);
      assert(Math.abs(areaPoly - expectedArea) < 1e-7, `Poly area mismatch for N=${n}`);
      console.log(`[PASS] Star N=${n} points (${star.length} verts): Area=${areaClipper.toFixed(4)}, expected=${expectedArea.toFixed(4)}, relDiff=${Math.abs(areaClipper - expectedArea) / expectedArea}`);
    }

    // Collinear points along edge
    const collinearPoly = [
      [0, 0], [10, 0], [20, 0], [30, 0], [40, 0],
      [40, 10], [40, 20], [40, 30],
      [30, 30], [20, 30], [10, 30], [0, 30],
      [0, 20], [0, 10]
    ];
    const expectedBoxArea = 40 * 30; // 1200
    const trisCollinear = poly.triangulateSimplePoly(collinearPoly);
    let areaBox = 0;
    for (const t of trisCollinear) {
      const a = (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0]);
      assert(Math.abs(a) > 1e-8, 'Degenerate zero-area triangle emitted for collinear polygon!');
      areaBox += Math.abs(a) * 0.5;
    }
    assert(Math.abs(areaBox - expectedBoxArea) < 1e-7, 'Collinear box area mismatch');
    console.log(`[PASS] Collinear rectangle (14 verts): Area=${areaBox.toFixed(2)}, zero degenerate triangles.`);
  }

  // TEST 3: Topology Audit Hash Soundness & Scaling
  console.log('\n--- 3. Topology Audit Hash Soundness & Scaling ---');
  {
    // Build a synthetic manifold closed box of dimensions L x W x H
    function makeBoxMesh(L, W, H, ox = 0, oy = 0, oz = 0) {
      const p = [
        [ox, oy, oz], [ox + L, oy, oz], [ox + L, oy + W, oz], [ox, oy + W, oz],
        [ox, oy, oz + H], [ox + L, oy, oz + H], [ox + L, oy + W, oz + H], [ox, oy + W, oz + H]
      ];
      // 12 triangles CCW
      const f = [
        [0, 2, 1], [0, 3, 2], // bottom
        [4, 5, 6], [4, 6, 7], // top
        [0, 1, 5], [0, 5, 4], // front
        [2, 3, 7], [2, 7, 6], // back
        [3, 0, 4], [3, 4, 7], // left
        [1, 2, 6], [1, 6, 5]  // right
      ];
      return f.map(idx => ({
        v0: p[idx[0]], v1: p[idx[1]], v2: p[idx[2]],
        n: [0, 0, 1], layerId: 1, tileId: 0
      }));
    }

    const boxTris = makeBoxMesh(50, 40, 30, -25, -20, 0);
    const meshes = { base: boxTris };
    const fast = topo.computeFastVolumeAndExtents(meshes, [], { bedSizeMm: 169.2 }, {});
    const audit = topo.auditMeshTopologyNumeric(meshes, [], { bedSizeMm: 169.2 }, {}, fast);

    assert.strictEqual(audit.openEdgesCount, 0, 'Closed box must have 0 open edges');
    assert.strictEqual(audit.nonManifoldEdgesCount, 0, 'Closed box must have 0 non-manifold edges');
    assert.strictEqual(audit.degenerateTrisCount, 0, 'Closed box must have 0 degenerate tris');
    assert.strictEqual(audit.isWatertightManifold, true, 'Closed box must be watertight');

    // Expected volume in ml: 50 * 40 * 30 mm^3 = 60,000 mm^3 = 60.0 ml (at 1:1 scale where scaleMm = 1.0)
    assert(Math.abs(fast.totalVolumeMl - 60.0) < 1e-4, `Volume expected 60.0, got ${fast.totalVolumeMl}`);
    console.log(`[PASS] Synthetic Box Topology: Watertight=${audit.isWatertightManifold}, OpenEdges=${audit.openEdgesCount}, Volume=${fast.totalVolumeMl.toFixed(4)} ml`);

    // Invalidate 1 triangle to verify audit detects defect
    const brokenMeshes = { base: boxTris.slice(1) }; // remove 1 triangle
    const fastBroken = topo.computeFastVolumeAndExtents(brokenMeshes, [], { bedSizeMm: 169.2 }, {});
    const auditBroken = topo.auditMeshTopologyNumeric(brokenMeshes, [], { bedSizeMm: 169.2 }, {}, fastBroken);
    assert.strictEqual(auditBroken.openEdgesCount, 3, 'Missing 1 triangle must produce exactly 3 open edges');
    assert.strictEqual(auditBroken.isWatertightManifold, false, 'Incomplete mesh must fail watertight test');
    console.log(`[PASS] Defect Detection: Removing 1 tri correctly yields openEdges=${auditBroken.openEdgesCount}, isWatertight=${auditBroken.isWatertightManifold}`);
  }

  // TEST 4: Cooperative Yielding & Abort Cancellation
  console.log('\n--- 4. Cooperative Yielding & Abort Cancellation ---');
  {
    const scene = JSON.parse(fs.readFileSync('cache/scene_v5_52.2415_21.0050_52.2525_21.0220.json'));
    const abortCtrl = new AbortController();

    // Abort after 5ms
    setTimeout(() => {
      abortCtrl.abort();
    }, 5);

    let caughtAbort = false;
    try {
      await mb.rebuildModel3DProgressive(scene, { bedSizeMm: 320 }, {
        signal: abortCtrl.signal,
        timeBudgetMs: 2
      });
    } catch (e) {
      if (e.name === 'AbortError' || e.message === 'Pipeline aborted') {
        caughtAbort = true;
      } else {
        throw e;
      }
    }
    assert.strictEqual(caughtAbort, true, 'rebuildModel3DProgressive must abort immediately upon signal');
    console.log('[PASS] Cooperative time-slice correctly caught AbortController cancellation during progressive build.');
  }

  // TEST 5: Monotonic Progress Reporting
  console.log('\n--- 5. Monotonic Progress Reporting ---');
  {
    const scene = JSON.parse(fs.readFileSync('cache/scene_v5_48.1280_11.5769_48.1396_11.5941.json'));
    const progressLog = [];
    await mb.rebuildModel3DProgressive(scene, { bedSizeMm: 320 }, {
      onProgress: (pct, stage) => {
        progressLog.push({ pct, stage });
      }
    });

    assert(progressLog.length > 5, 'Progress callbacks must be received');
    for (let i = 1; i < progressLog.length; i++) {
      assert(progressLog[i].pct >= progressLog[i - 1].pct, `Progress decreased: ${progressLog[i - 1].pct} -> ${progressLog[i].pct}`);
    }
    assert.strictEqual(progressLog[progressLog.length - 1].pct, 100, 'Final progress must reach 100%');
    console.log(`[PASS] Monotonic progress verified across ${progressLog.length} progress events without regressing.`);
  }

  console.log('\n=== ALL AUDITOR FORENSIC SUITE TESTS PASSED ===\n');
}

runForensics().catch(err => {
  console.error('\n[FAIL] FORENSIC SUITE FAILED:', err);
  process.exit(1);
});
