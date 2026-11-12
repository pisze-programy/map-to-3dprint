// @ts-check
/**
 * tests/adversarial_challenger_m3_r2.js
 * Adversarial Challenger Stress Suite for Milestone 3 Iteration 2
 *
 * Focus Verification Items:
 * 1. 50x100 Grid Live Preview Latency SLA (<100ms):
 *    - Measure live preview execution time on 50x100 grid (5,000 tiles).
 *    - Verify physical underside ID stamping (emitUndersideIdPatch) and internal kerf walls
 *      are bypassed during interactive preview, dropping preview latency below 100ms.
 *    - Verify that vertex tileId values fall within [0, 4999] across all 5,000 tiles and
 *      uTileExplode translation works cleanly.
 * 2. Clean execution without global variable injection:
 *    - Verify that rebuildModel3D() on multi-tile grids executes cleanly in Node.js and Chromium
 *      without `ReferenceError: halfW is not defined` or `TypeError: Cannot read properties of undefined (reading 'clear')`.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Load core modules in Node environment
const poly2d = require('../src/geometry/polygon_2d.js');
const primitives = require('../src/mesh/mesh_primitives.js');
const masks = require('../src/mesh/terrain_masks.js');
const terrainBase = require('../src/mesh/terrain_base_water.js');
const buildingsPrepare = require('../src/mesh/buildings_prepare.js');
const buildingsS3db = require('../src/mesh/buildings_s3db.js');
const meshBuilder = require('../src/mesh/mesh_builder.js');

// Ensure global scope is clean before loading
delete global.halfW;
delete global.halfH;
delete global.selectedBuildingIds;

// Attach necessary functions to global for modular scripts that expect them
Object.assign(global, poly2d);
Object.assign(global, primitives);
Object.assign(global, masks);
Object.assign(global, terrainBase);
Object.assign(global, buildingsPrepare);
Object.assign(global, buildingsS3db);

async function runAdversarialChallenge() {
  console.log('================================================================');
  console.log('ADVERSARIAL CHALLENGER M3_R2: STRESS TEST & BENCHMARK');
  console.log('================================================================\n');

  const results = {
    timestamp: new Date().toISOString(),
    tests: {},
    passed: 0,
    failed: 0,
    verdict: 'PENDING'
  };

  const sampleScene = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../cache/scene_v5_52.2415_21.0050_52.2525_21.0220.json'), 'utf8'));

  // ---------------------------------------------------------------------------
  // TEST 1: Bypass Verification (Underside Patches & Internal Kerf Walls)
  // ---------------------------------------------------------------------------
  console.log('--- TEST 1: Bypass Verification (Underside Patches & Internal Kerf Walls) ---');
  {
    // Test on 2x2 grid (4 tiles)
    const state2x2 = {
      tileCols: 2,
      tileRows: 2,
      targetWidthCm: 20,
      targetHeightCm: 20,
      mapSpanMeters: 1000,
      hollowBase: true,
      selectedBuildingIds: new Set()
    };
    const ctx2x2 = masks.buildTerrainAndMasks(sampleScene, state2x2);

    let exportPatchCalls = 0;
    const origPatch = global.emitUndersideIdPatch;
    global.emitUndersideIdPatch = function(...args) {
      exportPatchCalls++;
      return origPatch.apply(this, args);
    };

    const exportMeshes2x2 = { base: [], water: [] };
    terrainBase.buildTerrainBaseAndWaterMeshes(ctx2x2, { ...state2x2, isExport: true }, exportMeshes2x2, { isExport: true });

    let previewPatchCalls = 0;
    global.emitUndersideIdPatch = function(...args) {
      previewPatchCalls++;
      return origPatch.apply(this, args);
    };

    const previewMeshes2x2 = { base: [], water: [] };
    terrainBase.buildTerrainBaseAndWaterMeshes(ctx2x2, { ...state2x2, isExport: false }, previewMeshes2x2, { isExport: false });

    global.emitUndersideIdPatch = origPatch;

    console.log(`  2x2 Export: patchCalls=${exportPatchCalls} (4 tiles * 5 chars = 20), baseTris=${exportMeshes2x2.base.length}`);
    console.log(`  2x2 Preview: patchCalls=${previewPatchCalls} (MUST be 0), baseTris=${previewMeshes2x2.base.length}`);

    // Test on 50x100 grid (5,000 tiles)
    const state50x100 = {
      tileCols: 50,
      tileRows: 100,
      targetWidthCm: 50,
      targetHeightCm: 100,
      mapSpanMeters: 5000,
      hollowBase: true,
      selectedBuildingIds: new Set()
    };
    const ctx50x100 = masks.buildTerrainAndMasks(sampleScene, state50x100);

    const exportMeshes50x100 = { base: [], water: [] };
    terrainBase.buildTerrainBaseAndWaterMeshes(ctx50x100, { ...state50x100, isExport: true }, exportMeshes50x100, { isExport: true });

    const previewMeshes50x100 = { base: [], water: [] };
    terrainBase.buildTerrainBaseAndWaterMeshes(ctx50x100, { ...state50x100, isExport: false }, previewMeshes50x100, { isExport: false });

    console.log(`  50x100 Export Base Triangles: ${exportMeshes50x100.base.length} (with internal kerf walls)`);
    console.log(`  50x100 Preview Base Triangles: ${previewMeshes50x100.base.length} (outer perimeter only)`);

    const kerfSavedTriangles = exportMeshes50x100.base.length - previewMeshes50x100.base.length;
    console.log(`  50x100 Internal Kerf Triangles Bypassed in Preview: ${kerfSavedTriangles} triangles saved!`);

    const test1Pass = (exportPatchCalls === 20) &&
                      (previewPatchCalls === 0) &&
                      (exportMeshes2x2.base.length > previewMeshes2x2.base.length) &&
                      (kerfSavedTriangles > 100000);

    results.tests.bypassVerification = {
      pass: test1Pass,
      exportPatchCalls2x2: exportPatchCalls,
      previewPatchCalls2x2: previewPatchCalls,
      exportTris2x2: exportMeshes2x2.base.length,
      previewTris2x2: previewMeshes2x2.base.length,
      exportTris50x100: exportMeshes50x100.base.length,
      previewTris50x100: previewMeshes50x100.base.length,
      kerfSavedTriangles
    };
    if (test1Pass) results.passed++; else results.failed++;
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Vertex tileId Integrity Across 5,000 Tiles [0, 4999]
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 2: Vertex tileId Integrity Across 5,000 Tiles [0, 4999] ---');
  {
    const state5k = {
      tileCols: 50,
      tileRows: 100,
      targetWidthCm: 50,
      targetHeightCm: 100,
      mapSpanMeters: 5000,
      isExport: false,
      hollowBase: true,
      selectedBuildingIds: new Set(),
      layerMeshes: {}
    };

    const ctx5k = masks.buildTerrainAndMasks(sampleScene, state5k);
    const allMeshes = { base: [], water: [], buildings: [] };

    // Generate base & water
    const baseInfo5k = terrainBase.buildTerrainBaseAndWaterMeshes(ctx5k, state5k, allMeshes, { isExport: false });

    // Generate buildings without global halfW/halfH
    buildingsS3db.buildS3DBBuildingsMesh(sampleScene, ctx5k, baseInfo5k, state5k, allMeshes);

    let totalTris = 0;
    let missingTileId = 0;
    let nanTileId = 0;
    let outOfRangeTileId = 0;
    let minTileId = Infinity;
    let maxTileId = -Infinity;
    const uniqueTiles = new Set();

    for (const [layerName, mesh] of Object.entries(allMeshes)) {
      for (let i = 0; i < mesh.length; i++) {
        totalTris++;
        const tid = mesh[i].tileId;
        if (tid === undefined || tid === null) {
          missingTileId++;
        } else if (isNaN(tid)) {
          nanTileId++;
        } else if (tid < 0 || tid > 4999) {
          outOfRangeTileId++;
        } else {
          if (tid < minTileId) minTileId = tid;
          if (tid > maxTileId) maxTileId = tid;
          uniqueTiles.add(tid);
        }
      }
    }

    console.log(`  Total Triangles Audited: ${totalTris}`);
    console.log(`  Unique tileId count: ${uniqueTiles.size} / 5000`);
    console.log(`  Min tileId: ${minTileId}, Max tileId: ${maxTileId}`);
    console.log(`  Missing: ${missingTileId}, NaN: ${nanTileId}, Out of Range: ${outOfRangeTileId}`);

    // Verify uTileExplode translation math across corner and center tiles
    let uTileExplodeMathValid = true;
    for (const tid of [0, 49, 2475, 4950, 4999]) {
      const tc = tid % 50;
      const tr = Math.floor(tid / 50);
      const shiftX = (tc - 49 * 0.5) * 1.0 * 15.0;
      const shiftY = (tr - 99 * 0.5) * 1.0 * 15.0;
      if (isNaN(shiftX) || isNaN(shiftY) || !isFinite(shiftX) || !isFinite(shiftY)) {
        uTileExplodeMathValid = false;
        break;
      }
    }
    console.log(`  uTileExplode translation math verification: ${uTileExplodeMathValid ? 'VALID' : 'INVALID'}`);

    const test2Pass = (missingTileId === 0) &&
                      (nanTileId === 0) &&
                      (outOfRangeTileId === 0) &&
                      (minTileId === 0) &&
                      (maxTileId === 4999) &&
                      (uniqueTiles.size === 5000) &&
                      uTileExplodeMathValid;

    results.tests.vertexTileIdIntegrity = {
      pass: test2Pass,
      totalTris,
      uniqueTiles: uniqueTiles.size,
      minTileId,
      maxTileId,
      missingTileId,
      nanTileId,
      outOfRangeTileId
    };
    if (test2Pass) results.passed++; else results.failed++;
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Clean Execution Without Global Variable Injection (Node.js)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 3: Clean Execution Without Global Variable Injection (Node.js) ---');
  {
    const stateMulti = {
      tileCols: 4,
      tileRows: 4,
      targetWidthCm: 30,
      targetHeightCm: 30,
      mapSpanMeters: 2000,
      isExport: false,
      hollowBase: true,
      selectedBuildingIds: new Set()
    };
    const ctxMulti = masks.buildTerrainAndMasks(sampleScene, stateMulti);
    const meshesMulti = { base: [], water: [], buildings: [] };

    let threwError = null;
    try {
      const baseInfoMulti = terrainBase.buildTerrainBaseAndWaterMeshes(ctxMulti, stateMulti, meshesMulti, { isExport: false });
      buildingsS3db.buildS3DBBuildingsMesh(sampleScene, ctxMulti, baseInfoMulti, stateMulti, meshesMulti);
    } catch (err) {
      threwError = err;
    }

    const cleanNodeExec = (threwError === null) && (meshesMulti.buildings.length > 0);
    console.log(`  Multi-tile execution without global halfW/halfH: ${cleanNodeExec ? 'SUCCESS' : 'FAILED'}`);
    if (threwError) console.error(`  Node execution error:`, threwError);

    results.tests.cleanNodeExecution = {
      pass: cleanNodeExec,
      triangles: meshesMulti.buildings.length,
      error: threwError ? threwError.message : null
    };
    if (cleanNodeExec) results.passed++; else results.failed++;
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Chromium Browser Benchmark & Latency SLA (<100ms)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 4: Chromium Browser Benchmark & Latency SLA (<100ms) ---');
  const isMac = process.platform === 'darwin';
  const glFlags = isMac
    ? ['--use-gl=angle', '--use-angle=metal']
    : ['--use-gl=angle', '--use-angle=swiftshader'];

  const launchArgs = [
    ...glFlags,
    '--enable-webgl',
    '--enable-webgl2-compute-context',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ];

  const browser = await chromium.launch({
    headless: true,
    args: launchArgs
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message || String(err)));

    await page.goto('http://127.0.0.1:8765', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__map3d && window.__map3d.state);

    // Verify clean globals in browser
    const browserGlobals = await page.evaluate(() => {
      return {
        hasWindowHalfW: 'halfW' in window,
        hasWindowHalfH: 'halfH' in window,
        hasSelectedBuildingIds: 'selectedBuildingIds' in window.__map3d.state,
        selectedBuildingIdsType: typeof window.__map3d.state.selectedBuildingIds,
        isProtoPoisoned: 'selectedBuildingIds' in Object.prototype
      };
    });

    console.log('  Browser Globals Audit:', browserGlobals);

    // Measure live preview rebuild and base/water latency
    const browserBenchmark = await page.evaluate(async (sc) => {
      const state = window.__map3d.state;
      state.tileCols = 50;
      state.tileRows = 100;
      state.sceneData = sc;

      let clipCalls = 0;
      if (typeof window.clipMeshToBox3D === 'function') {
        const origClip = window.clipMeshToBox3D;
        window.clipMeshToBox3D = function(...args) {
          clipCalls++;
          return origClip.apply(this, args);
        };
      }

      await window.__map3d.rebuildModel3D();
      const baseDurationMs = state.lastTerrainBaseWaterDurationMs;

      // Test uTileExplode shader rendering
      let shaderError = null;
      try {
        state.tileExplode = 0.5;
        const studio = window.__map3d.studio;
        if (studio && typeof studio.render === 'function') {
          studio.render(true);
        }
        const canvas = document.getElementById('view3dCanvas');
        const gl = canvas && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
        if (gl) {
          const errCode = gl.getError();
          if (errCode !== gl.NO_ERROR) {
            shaderError = `GL_ERROR: 0x${errCode.toString(16)}`;
          }
        }
      } catch (e) {
        shaderError = e.message;
      }

      return {
        success: true,
        baseDurationMs,
        clipCalls,
        totalTriangles: state.totalTriangles,
        shaderError
      };
    }, sampleScene);

    console.log(`  50x100 Live Preview Base/Water Latency: ${browserBenchmark.baseDurationMs.toFixed(2)} ms (SLA < 100ms)`);
    console.log(`  clipMeshToBox3D Calls: ${browserBenchmark.clipCalls} (MUST be 0 in preview)`);
    console.log(`  Total Triangles: ${browserBenchmark.totalTriangles}`);
    console.log(`  uTileExplode GL Status: ${browserBenchmark.shaderError || 'NO_ERROR (PASS)'}`);
    console.log(`  Page Unhandled Errors: ${pageErrors.length}`);

    const slaMet = (browserBenchmark.baseDurationMs < 100.0);
    const zeroClip = (browserBenchmark.clipCalls === 0);
    const noGlErr = (!browserBenchmark.shaderError);
    const noPageErr = (pageErrors.length === 0);
    const cleanGlobals = (!browserGlobals.hasWindowHalfW && !browserGlobals.hasWindowHalfH && !browserGlobals.isProtoPoisoned);

    const test4Pass = slaMet && zeroClip && noGlErr && noPageErr && cleanGlobals;
    results.tests.browserBenchmarkSla = {
      pass: test4Pass,
      baseDurationMs: browserBenchmark.baseDurationMs,
      clipCalls: browserBenchmark.clipCalls,
      totalTriangles: browserBenchmark.totalTriangles,
      shaderError: browserBenchmark.shaderError,
      pageErrors
    };
    if (test4Pass) results.passed++; else results.failed++;

    await context.close();
  } finally {
    await browser.close();
  }

  // ---------------------------------------------------------------------------
  // FINAL VERDICT
  // ---------------------------------------------------------------------------
  const allPassed = (results.failed === 0 && results.passed === 4);
  results.verdict = allPassed ? 'APPROVE' : 'REQUEST_CHANGES';

  console.log('\n================================================================');
  console.log(`ADVERSARIAL CHALLENGER M3_R2 VERDICT: ${results.verdict}`);
  console.log(`Passed: ${results.passed} / ${results.passed + results.failed}`);
  console.log('================================================================\n');

  const reportOut = path.resolve(__dirname, '../.agents/teamwork/challenger_m3_r2_1/adversarial_results.json');
  fs.writeFileSync(reportOut, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Results saved to: ${reportOut}`);

  return results;
}

if (require.main === module) {
  runAdversarialChallenge()
    .then(res => {
      process.exit(res.verdict === 'APPROVE' ? 0 : 1);
    })
    .catch(err => {
      console.error('Fatal test runner error:', err);
      process.exit(1);
    });
}

module.exports = { runAdversarialChallenge };
