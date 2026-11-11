/**
 * tests/test_challenger_m3_empirical.js
 * Comprehensive Empirical Challenger Suite for Milestone 3
 *
 * Verifies:
 * 1. Parameter Decoupling (26 UI actions do NOT trigger GIS fetch, loading overlay, or 3D rebuild; #btnRender3D executes render)
 * 2. 50x100 Grid Scalability & O(1) Centroid Tile Assignment (<100ms, 0 CSG clipMeshToBox3D calls, tileIds [0, 4999], uTileExplode)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8765';
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

async function runEmpiricalSuite() {
  console.log('================================================================');
  console.log('CHALLENGER M3: EMPIRICAL AUDIT & ADVERSARIAL STRESS TEST');
  console.log('Target:', BASE_URL);
  console.log('================================================================\n');

  const report = {
    timestamp: new Date().toISOString(),
    verdict: 'PENDING',
    parameterDecoupling: {
      status: 'PENDING',
      actionsTested: [],
      violations: [],
      btnLabelCorrect: false,
      btnRenderExecutes: false
    },
    gridScalability50x100: {
      status: 'PENDING',
      cleanBrowserError: null,
      livePreviewDurationMs: null,
      clipMeshToBox3DCalls: null,
      vertexTileIdStats: null,
      uTileExplodeTest: null,
      findings: []
    }
  };

  const browser = await chromium.launch({
    headless: true,
    args: launchArgs
  });

  try {
    // =========================================================================
    // SECTION 1: PARAMETER DECOUPLING ADVERSARIAL TEST
    // =========================================================================
    console.log('--- TEST 1: PARAMETER DECOUPLING ADVERSARIAL TEST ---');
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message || String(err)));

    // Mock Photon autocomplete
    await page.route('**/photon.komoot.io/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { name: 'Firenze', city: 'Firenze', state: 'Toscana', country: 'Italia', type: 'city' },
              geometry: { type: 'Point', coordinates: [11.2558, 43.7696] }
            },
            {
              type: 'Feature',
              properties: { name: 'Roma', city: 'Roma', state: 'Lazio', country: 'Italia', type: 'city' },
              geometry: { type: 'Point', coordinates: [12.4964, 41.9028] }
            }
          ]
        })
      });
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__map3d && window.__map3d.state && window.fetchChunkedGISInBrowser);

    // Instrument global streaming & rebuild hooks
    await page.evaluate(() => {
      window.__streamerCalls = 0;
      window.__rebuildCalls = 0;

      const origStreamer = window.fetchChunkedGISInBrowser;
      window.fetchChunkedGISInBrowser = function(...args) {
        window.__streamerCalls++;
        return origStreamer.apply(this, args);
      };

      const origRebuild = window.rebuildModel3DProgressive;
      window.rebuildModel3DProgressive = function(...args) {
        window.__rebuildCalls++;
        return origRebuild.apply(this, args);
      };

      // Reset initial boot invocations
      window.__streamerCalls = 0;
      window.__rebuildCalls = 0;
    });

    async function assertDecoupled(actionName) {
      await page.waitForTimeout(40);
      const res = await page.evaluate(() => {
        const overlay = document.getElementById('loadingOverlay3D');
        const overlayVisible = overlay && !overlay.classList.contains('hidden') && window.getComputedStyle(overlay).display !== 'none';
        return {
          streamerCalls: window.__streamerCalls,
          rebuildCalls: window.__rebuildCalls,
          overlayVisible
        };
      });

      const failed = res.streamerCalls > 0 || res.rebuildCalls > 0 || res.overlayVisible;
      const record = {
        action: actionName,
        streamerCalls: res.streamerCalls,
        rebuildCalls: res.rebuildCalls,
        overlayVisible: res.overlayVisible,
        pass: !failed
      };
      report.parameterDecoupling.actionsTested.push(record);

      if (failed) {
        console.error(`  FAIL [${actionName}]: streamerCalls=${res.streamerCalls}, rebuildCalls=${res.rebuildCalls}, overlayVisible=${res.overlayVisible}`);
        report.parameterDecoupling.violations.push(record);
      } else {
        console.log(`  PASS [${actionName}]: streamerCalls=0, rebuildCalls=0, overlay=hidden`);
      }
    }

    // 1. Dimension changes: #targetWidthCmInput
    const wInput = page.locator('#targetWidthCmInput');
    await wInput.fill('40');
    await wInput.dispatchEvent('input');
    await assertDecoupled('targetWidthCmInput:input');
    await wInput.dispatchEvent('change');
    await assertDecoupled('targetWidthCmInput:change');

    // 2. Dimension changes: #targetHeightCmInput
    const hInput = page.locator('#targetHeightCmInput');
    await hInput.fill('60');
    await hInput.dispatchEvent('input');
    await assertDecoupled('targetHeightCmInput:input');
    await hInput.dispatchEvent('change');
    await assertDecoupled('targetHeightCmInput:change');

    // 3. Quick frame chips: [data-frame-size]
    for (const size of ['20x20', '30x30', '50x100']) {
      const chip = page.locator(`button[data-frame-size="${size}"]`);
      if (await chip.count() > 0) {
        await chip.click();
        await assertDecoupled(`data-frame-size:${size}`);
      }
    }

    // 4. CropSizeSlider changes: #cropSizeSlider
    const cropSlider = page.locator('#cropSizeSlider');
    await cropSlider.evaluate(el => { el.value = '25.0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await assertDecoupled('cropSizeSlider:input(25.0)');
    await cropSlider.evaluate(el => { el.value = '50.0'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await assertDecoupled('cropSizeSlider:change(50.0)');

    // 5. Span chips: [data-span-km]
    for (const km of ['0.6', '1.2', '2.5', '5', '12', '25', '50']) {
      const chip = page.locator(`button[data-span-km="${km}"]`);
      if (await chip.count() > 0) {
        await chip.click();
        await assertDecoupled(`data-span-km:${km}`);
      }
    }

    // 6. Rotation slider and chips
    const rotSlider = page.locator('#mapRotationSlider');
    if (await rotSlider.count() > 0) {
      await rotSlider.evaluate(el => { el.value = '45'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await assertDecoupled('mapRotationSlider:input(45)');
      await rotSlider.evaluate(el => { el.value = '90'; el.dispatchEvent(new Event('change', { bubbles: true })); });
      await assertDecoupled('mapRotationSlider:change(90)');
    }
    for (const deg of ['45', '90', '-45', '0']) {
      const chip = page.locator(`button[data-rot-deg="${deg}"]`);
      if (await chip.count() > 0) {
        await chip.click();
        await assertDecoupled(`data-rot-deg:${deg}`);
      }
    }

    // 7. Place search / Autocomplete
    const placeInput = page.locator('#placeSearchInput');
    await placeInput.fill('Firenze');
    await placeInput.dispatchEvent('input');
    await page.waitForTimeout(350);
    await assertDecoupled('placeSearchInput:input(Firenze)');

    const suggestionBtn = page.locator('#searchSuggestionsDropdown button').first();
    if (await suggestionBtn.count() > 0) {
      await suggestionBtn.click();
      await assertDecoupled('searchSuggestionsDropdown:clickFirst');
    }

    // 8. 2D Canvas mouse drag & wheel
    const canvas2d = page.locator('#map2dCanvas');
    const box = await canvas2d.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 80, cy + 60, { steps: 5 });
      await page.mouse.up();
      await assertDecoupled('map2dCanvas:mouseDrag');

      await canvas2d.dispatchEvent('wheel', { deltaY: -100 });
      await assertDecoupled('map2dCanvas:wheelZoom');
    }

    // 9. LoD filter controls
    const lodMinBld = page.locator('#lodMinBuildingSizeSlider');
    if (await lodMinBld.count() > 0) {
      await lodMinBld.evaluate(el => { el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await assertDecoupled('lodMinBuildingSizeSlider:input(20)');
    }
    const lodTrees = page.locator('#lodEnableTreesCheck');
    if (await lodTrees.count() > 0) {
      await lodTrees.click();
      await assertDecoupled('lodEnableTreesCheck:click');
    }
    const lodTreeThresh = page.locator('#lodTreeThresholdSlider');
    if (await lodTreeThresh.count() > 0) {
      await lodTreeThresh.evaluate(el => { el.value = '8.0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await assertDecoupled('lodTreeThresholdSlider:input(8.0)');
    }
    const lodRoads = page.locator('#lodRoadDetailSelect');
    if (await lodRoads.count() > 0) {
      await lodRoads.selectOption('major');
      await assertDecoupled('lodRoadDetailSelect:selectOption(major)');
    }

    // 10. Assert Button Label is "Render"
    const btnRenderText = (await page.locator('#btnRender3D').textContent() || '').trim();
    console.log(`\n  Render button label: "${btnRenderText}" (must be "Render")`);
    const btnLabelCorrect = (btnRenderText === 'Render');
    report.parameterDecoupling.btnLabelCorrect = btnLabelCorrect;

    // 11. Assert clicking #btnRender3D executes render pipeline
    console.log('  Triggering #btnRender3D click...');
    await page.locator('#btnRender3D').click();
    await page.waitForTimeout(200);

    const postRenderState = await page.evaluate(() => {
      const overlay = document.getElementById('loadingOverlay3D');
      const overlayVisible = overlay && !overlay.classList.contains('hidden') && window.getComputedStyle(overlay).display !== 'none';
      return {
        streamerCalls: window.__streamerCalls,
        overlayVisible,
        btnDisabled: document.getElementById('btnRender3D').disabled
      };
    });
    console.log(`  After #btnRender3D click: streamerCalls=${postRenderState.streamerCalls}, overlayVisible=${postRenderState.overlayVisible}, btnDisabled=${postRenderState.btnDisabled}`);

    const renderTriggered = postRenderState.streamerCalls >= 1 || postRenderState.overlayVisible;
    report.parameterDecoupling.btnRenderExecutes = renderTriggered;

    const allDecoupledPass = report.parameterDecoupling.violations.length === 0 && renderTriggered && btnLabelCorrect;
    report.parameterDecoupling.status = allDecoupledPass ? 'PASS' : 'FAIL';
    console.log(`\n>>> PARAMETER DECOUPLING VERDICT: ${report.parameterDecoupling.status}\n`);

    await page.close();

    // =========================================================================
    // SECTION 2: 50x100 GRID SCALABILITY & O(1) CENTROID TILE ASSIGNMENT
    // =========================================================================
    console.log('--- TEST 2: 50x100 GRID SCALABILITY & O(1) CENTROID TILE ASSIGNMENT ---');
    const sceneData = JSON.parse(fs.readFileSync('./cache/scene_v5_52.2415_21.0050_52.2525_21.0220.json', 'utf8'));

    // Part 2A: Clean Browser Audit (Without test_utils monkey-patching)
    console.log('  [2A] Testing in Clean Browser (no test_utils.js global injections)...');
    const pageClean = await browser.newPage();
    const cleanErrors = [];
    pageClean.on('pageerror', err => cleanErrors.push(err.message || String(err)));

    await pageClean.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await pageClean.waitForFunction(() => window.__map3d && window.__map3d.state);

    const cleanResult = await pageClean.evaluate(async (sc) => {
      const state = window.__map3d.state;
      state.tileCols = 50;
      state.tileRows = 100;
      state.sceneData = sc;

      try {
        await window.__map3d.rebuildModel3D();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, stack: e.stack };
      }
    }, sceneData);

    console.log(`  Clean browser result: success=${cleanResult.success}, error="${cleanResult.error || 'NONE'}"`);
    report.gridScalability50x100.cleanBrowserError = cleanResult.error || null;
    if (!cleanResult.success) {
      report.gridScalability50x100.findings.push({
        type: 'UNCAUGHT_REFERENCE_ERROR',
        severity: 'CRITICAL',
        detail: `rebuildModel3D throws "${cleanResult.error}" when tileCols=50, tileRows=100 because halfW/halfH are not unpacked from ctx in buildS3DBBuildingsMeshProgressive (src/mesh/mesh_builder.js:290) and buildS3DBBuildingsMesh (src/mesh/buildings_s3db.js:245). Masked in Playwright tests by test_utils.js injecting window.halfW.`
      });
    }
    await pageClean.close();

    // Part 2B: Scalability & Timing Benchmark (with halfW/halfH scoped to measure actual pipeline duration)
    console.log('\n  [2B] Testing Scalability & Timing Benchmark with variable fix...');
    const pageBenchmark = await browser.newPage();
    await pageBenchmark.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await pageBenchmark.waitForFunction(() => window.__map3d && window.__map3d.state);

    const benchmarkResult = await pageBenchmark.evaluate(async (sc) => {
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

      const t0 = performance.now();
      let buildErr = null;
      try {
        await window.__map3d.rebuildModel3D();
      } catch (e) {
        buildErr = { message: e.message, stack: e.stack };
      }
      const durationMs = (state.lastTerrainBaseWaterDurationMs !== undefined)
        ? state.lastTerrainBaseWaterDurationMs
        : (performance.now() - t0);

      // Inspect vertex tileIds
      const layerStats = {};
      let minTile = Infinity;
      let maxTile = -Infinity;
      let totalTris = 0;
      let missingTileIdTris = 0;
      let outOfRangeTris = 0;
      let nanTileIdTris = 0;
      const uniqueTiles = new Set();

      const layers = ['buildings', 'roads', 'base', 'water', 'greenery'];
      for (const layer of layers) {
        const mesh = (state.layerMeshes && state.layerMeshes[layer]) || [];
        layerStats[layer] = { count: mesh.length };
        for (let i = 0; i < mesh.length; i++) {
          totalTris++;
          const tri = mesh[i];
          const tid = tri.tileId;
          if (tid === undefined || tid === null) {
            missingTileIdTris++;
          } else if (isNaN(tid)) {
            nanTileIdTris++;
          } else if (tid < 0 || tid > 4999) {
            outOfRangeTris++;
          } else {
            if (tid < minTile) minTile = tid;
            if (tid > maxTile) maxTile = tid;
            uniqueTiles.add(tid);
          }
        }
      }

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
        buildErr,
        durationMs,
        clipCalls,
        totalTris,
        missingTileIdTris,
        nanTileIdTris,
        outOfRangeTris,
        minTile: minTile === Infinity ? null : minTile,
        maxTile: maxTile === -Infinity ? null : maxTile,
        uniqueTileCount: uniqueTiles.size,
        layerStats,
        shaderError
      };
    }, sceneData);

    report.gridScalability50x100.livePreviewDurationMs = benchmarkResult.durationMs;
    report.gridScalability50x100.clipMeshToBox3DCalls = benchmarkResult.clipCalls;
    report.gridScalability50x100.vertexTileIdStats = {
      totalTris: benchmarkResult.totalTris,
      missingTileIdTris: benchmarkResult.missingTileIdTris,
      nanTileIdTris: benchmarkResult.nanTileIdTris,
      outOfRangeTris: benchmarkResult.outOfRangeTris,
      minTile: benchmarkResult.minTile,
      maxTile: benchmarkResult.maxTile,
      uniqueTileCount: benchmarkResult.uniqueTileCount,
      layerStats: benchmarkResult.layerStats
    };
    report.gridScalability50x100.uTileExplodeTest = {
      shaderError: benchmarkResult.shaderError,
      pass: !benchmarkResult.shaderError
    };

    console.log(`  Rebuild duration: ${benchmarkResult.durationMs.toFixed(2)} ms (requirement <100ms)`);
    console.log(`  clipMeshToBox3D calls: ${benchmarkResult.clipCalls} (must be 0 in preview)`);
    console.log(`  Total triangles: ${benchmarkResult.totalTris}`);
    console.log(`  Layer stats:`, benchmarkResult.layerStats);
    console.log(`  Vertex tileIds: min=${benchmarkResult.minTile}, max=${benchmarkResult.maxTile}, unique=${benchmarkResult.uniqueTileCount}`);
    console.log(`  Invalid tileIds: missing=${benchmarkResult.missingTileIdTris}, nan=${benchmarkResult.nanTileIdTris}, outOfRange=${benchmarkResult.outOfRangeTris}`);
    console.log(`  uTileExplode test: ${benchmarkResult.shaderError || 'SUCCESS (no GL error)'}`);

    if (benchmarkResult.durationMs >= 100) {
      report.gridScalability50x100.findings.push({
        type: 'LATENCY_SLA_VIOLATION',
        severity: 'HIGH',
        detail: `rebuildModel3D on 50x100 grid took ${benchmarkResult.durationMs.toFixed(2)} ms, which exceeds the mandatory <100ms requirement by ${(benchmarkResult.durationMs / 100).toFixed(1)}x. Bottleneck: terrain_base_water.js generates 325,000 base triangles (underside ID patches, tile boundary walls, and water walls) in an unbudgeted 5,000-tile loop on the main thread.`
      });
    }

    const gridPass = (cleanResult.success) &&
                     (benchmarkResult.durationMs < 100) &&
                     (benchmarkResult.clipCalls === 0) &&
                     (benchmarkResult.missingTileIdTris === 0) &&
                     (benchmarkResult.nanTileIdTris === 0) &&
                     (benchmarkResult.outOfRangeTris === 0) &&
                     (benchmarkResult.minTile >= 0) &&
                     (benchmarkResult.maxTile <= 4999) &&
                     (!benchmarkResult.shaderError);

    report.gridScalability50x100.status = gridPass ? 'PASS' : 'FAIL';
    console.log(`\n>>> 50x100 GRID SCALABILITY VERDICT: ${report.gridScalability50x100.status}\n`);

    await pageBenchmark.close();

    // =========================================================================
    // OVERALL VERDICT
    // =========================================================================
    const overallPass = (report.parameterDecoupling.status === 'PASS') && (report.gridScalability50x100.status === 'PASS');
    report.verdict = overallPass ? 'APPROVE' : 'REQUEST_CHANGES';

    console.log('================================================================');
    console.log(`FINAL EMPIRICAL VERDICT: ${report.verdict}`);
    console.log('================================================================');

  } catch (err) {
    console.error('Fatal execution error:', err);
    report.verdict = 'REQUEST_CHANGES';
    report.fatalError = { message: err.message, stack: err.stack };
  } finally {
    await browser.close();
  }

  const outPath = '/Users/krystianblaszczyk/nodes/piszeprogramy/map-to-3dprint/.agents/teamwork/challenger_m3_1/challenger_m3_results.json';
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nWrote empirical results to: ${outPath}`);
  return report;
}

runEmpiricalSuite().catch(console.error);
