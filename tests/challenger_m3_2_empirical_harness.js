// @ts-check
// tests/challenger_m3_2_empirical_harness.js
// Adversarial Empirical Challenge Suite for Milestone 3 (Large Area Scalability & UX Controls)
// Focus Areas:
// 1. Inactivity Watchdog & Unhandled Promise Rejection Prevention
// 2. Uncached Streaming & DEM Fallback
// 3. DOM Prototype Safety & safeClosest
// 4. Forensic Investigation of Production State & Global Defects

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

function makeMockOsmJson(chunkId, nodeStart = 1000) {
  const n1 = nodeStart;
  const n2 = nodeStart + 1;
  const n3 = nodeStart + 2;
  const n4 = nodeStart + 3;
  const w1 = nodeStart + 10;
  return {
    version: 0.6,
    generator: `ChallengerMock_Chunk_${chunkId}`,
    elements: [
      { type: 'node', id: n1, lat: 52.2450 + (chunkId * 0.001), lon: 21.0100 + (chunkId * 0.001) },
      { type: 'node', id: n2, lat: 52.2455 + (chunkId * 0.001), lon: 21.0100 + (chunkId * 0.001) },
      { type: 'node', id: n3, lat: 52.2455 + (chunkId * 0.001), lon: 21.0108 + (chunkId * 0.001) },
      { type: 'node', id: n4, lat: 52.2450 + (chunkId * 0.001), lon: 21.0108 + (chunkId * 0.001) },
      {
        type: 'way',
        id: w1,
        nodes: [n1, n2, n3, n4, n1],
        tags: {
          building: 'yes',
          'building:levels': '3',
          name: `MockBuilding_${chunkId}`
        }
      }
    ]
  };
}

const MOCK_DEM_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
);

async function runEmpiricalChallenger() {
  console.log('================================================================');
  console.log('=== STARTING CHALLENGER M3_2 EMPIRICAL ADVERSARIAL HARNESS ===');
  console.log('================================================================\n');

  const isMac = process.platform === 'darwin';
  const glFlags = isMac
    ? ['--use-gl=angle', '--use-angle=metal']
    : ['--use-gl=angle', '--use-angle=swiftshader'];

  const browser = await chromium.launch({
    headless: true,
    args: [
      ...glFlags,
      '--enable-webgl',
      '--enable-webgl2-compute-context',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const BASE_URL = 'http://127.0.0.1:8765';
  const empiricalResults = {
    timestamp: new Date().toISOString(),
    tests: {},
    forensic_defects: [],
    summary: { passed: 0, failed: 0 }
  };

  try {
    // =========================================================================
    // DEFECT 1: Forensic Verification of state.selectedBuildingIds Defect
    // =========================================================================
    console.log('\n--- [DEFECT 1] Forensic Detection: Production Boot & Render Crash ---');
    console.log('Scenario: Fresh boot of index.html in real browser without test-runner monkey-patches.');
    console.log('Target: Check state.selectedBuildingIds and verify if Render triggers TypeError in applyLoadedSceneToState.');
    {
      const context = await browser.newContext({ baseURL: BASE_URL });
      const page = await context.newPage();

      const consoleWarnings = [];
      page.on('console', msg => {
        if (msg.type() === 'warning' || msg.type() === 'error') consoleWarnings.push(msg.text());
      });

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#view3dCanvas', { state: 'attached' });

      const stateInspection = await page.evaluate(() => {
        const s = window.__map3d?.state;
        return {
          hasProperty: s ? ('selectedBuildingIds' in s) : false,
          valueType: s ? typeof s.selectedBuildingIds : 'missing',
          isProtoPoisoned: 'selectedBuildingIds' in Object.prototype
        };
      });

      console.log('  State inspection on boot:', stateInspection);

      console.log('  Clicking #btnRender3D in unpatched browser environment...');
      await page.click('#btnRender3D');

      await page.waitForFunction(() => {
        const overlay = document.getElementById('loadingOverlay3D');
        return overlay && overlay.classList.contains('hidden');
      }, null, { timeout: 30000 });

      const renderOutcome = await page.evaluate(() => {
        const errBanner = document.getElementById('gisErrorBanner');
        const errText = document.getElementById('gisErrorText');
        const s = window.__map3d?.state;
        return {
          bannerVisible: errBanner && !errBanner.classList.contains('hidden'),
          bannerText: errText ? errText.textContent.trim() : '',
          triangles: s?.totalTriangles || 0
        };
      });

      console.log('  Render outcome in unpatched environment:', renderOutcome);
      const isDefectPresent = renderOutcome.bannerText.includes("Cannot read properties of undefined (reading 'clear')");

      if (isDefectPresent) {
        console.error('  [CRITICAL DEFECT 1 CONFIRMED] Production code crashes with TypeError: Cannot read properties of undefined (reading \'clear\')!');
        console.error('  Location: src/ui/ui_app.js:287 (applyLoadedSceneToState)');
        empiricalResults.forensic_defects.push({
          id: "DEFECT_1_MISSING_STATE_SELECTED_BUILDING_IDS",
          location: "src/ui/ui_app.js:287",
          message: "state.selectedBuildingIds was deleted from the state object in commit 93d5cf4, but applyLoadedSceneToState unconditionally executes state.selectedBuildingIds.clear(). This causes every GIS render to fail with TypeError in production.",
          reproduced: true
        });
      }

      empiricalResults.tests.defect1_missing_selected_building_ids = {
        defectPresent: isDefectPresent,
        stateInspection,
        renderOutcome,
        consoleWarnings: consoleWarnings.filter(w => !w.includes('GPU stall'))
      };

      await context.close();
    }

    // =========================================================================
    // DEFECT 2: Forensic Verification of halfW / halfH Undeclared Globals Defect
    // =========================================================================
    console.log('\n--- [DEFECT 2] Forensic Detection: Multi-Tile Grid halfW Crash ---');
    console.log('Scenario: Multi-tile grid preview (tileCols > 1 || tileRows > 1) with buildings in unpatched browser.');
    console.log('Target: Check if getTileIdForCentroid throws ReferenceError: halfW is not defined in mesh_builder.js / buildings_s3db.js.');
    {
      const context = await browser.newContext({ baseURL: BASE_URL });
      const page = await context.newPage();

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#view3dCanvas', { state: 'attached' });

      const sceneJson = fs.readFileSync(path.resolve(__dirname, '../cache/scene_v5_48.1280_11.5769_48.1396_11.5941.json'), 'utf8');

      const defect2Outcome = await page.evaluate(async (jsonStr) => {
        try {
          const s = window.__map3d.state;
          s.selectedBuildingIds = new Set();
          s.tileCols = 2;
          s.tileRows = 2;
          s.sceneData = JSON.parse(jsonStr);
          await window.__map3d.rebuildModel3D();
          return { success: true, triangles: s.totalTriangles };
        } catch (err) {
          return { success: false, error: err.stack || err.message };
        }
      }, sceneJson);

      console.log('  Defect 2 Test Outcome:', defect2Outcome);

      const isDefect2Present = !defect2Outcome.success && String(defect2Outcome.error).includes('halfW is not defined');
      if (isDefect2Present) {
        console.error('  [CRITICAL DEFECT 2 CONFIRMED] Multi-tile building geometry crashes with ReferenceError: halfW is not defined!');
        console.error('  Locations: src/mesh/mesh_builder.js:290 and src/mesh/buildings_s3db.js:245');
        empiricalResults.forensic_defects.push({
          id: "DEFECT_2_UNDECLARED_HALFW_IN_BUILDINGS",
          locations: ["src/mesh/mesh_builder.js:290", "src/mesh/buildings_s3db.js:245"],
          message: "getTileIdForCentroid(cx, cy, halfW, halfH, tileCols, tileRows) references halfW and halfH which were never destructured from ctx in buildS3DBBuildingsMeshProgressive or buildS3DBBuildingsMesh.",
          reproduced: true
        });
      }

      empiricalResults.tests.defect2_undeclared_halfw = {
        defectPresent: isDefect2Present,
        defect2Outcome
      };

      await context.close();
    }

    // =========================================================================
    // FOCUS 1 - TEST 1.1: Slow Progressive Streaming (>25s Total Duration)
    // =========================================================================
    console.log('\n--- [FOCUS 1 - TEST 1.1] Inactivity Watchdog Reset on Slow Progressive Streaming (>25s) ---');
    console.log('Scenario: 4 chunks arriving sequentially at 14.0s intervals (t = 14s, 28s).');
    console.log('Target: Inactivity watchdog must reset on every progress event and NOT abort at 20s.');
    {
      const context = await browser.newContext({ baseURL: BASE_URL });
      const page = await context.newPage();

      await page.addInitScript(() => {
        window.addEventListener('DOMContentLoaded', () => {
          if (window.__map3d?.state && !window.__map3d.state.selectedBuildingIds) {
            window.__map3d.state.selectedBuildingIds = new Set();
          }
        });
        window.halfW = 84.6;
        window.halfH = 84.6;
      });

      const pageErrors = [];
      page.on('pageerror', err => pageErrors.push(err.message || String(err)));

      let chunkSeq = 0;
      await page.route('**/*interpreter*', async route => {
        const thisSeq = ++chunkSeq;
        console.log(`  -> Overpass chunk #${thisSeq} requested, delaying response by 14,000ms...`);
        await new Promise(r => setTimeout(r, 14000));
        console.log(`  <- Overpass chunk #${thisSeq} delivered after 14.0s delay`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(makeMockOsmJson(thisSeq, 4000 + thisSeq * 100))
        });
      });

      await page.route('**/*elevation-tiles-prod*/**', async route => {
        await route.fulfill({ status: 200, contentType: 'image/png', body: MOCK_DEM_PNG });
      });

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#view3dCanvas', { state: 'attached' });

      await page.evaluate(() => {
        if (window.__map3d?.state) {
          window.__map3d.state.selectedBuildingIds = new Set();
          window.__map3d.state.mapSpanMeters = 2500;
        }
      });

      const tStart = Date.now();
      console.log('  Triggering 4-chunk progressive streaming fetch with 14s chunk delays...');
      await page.evaluate(() => {
        window.fetchRealGISAndRender(52.2400, 21.0000, 52.2600, 21.0200, 'SLOW_STREAM_TEST').catch(console.error);
      });

      await page.waitForFunction(() => {
        const overlay = document.getElementById('loadingOverlay3D');
        const btn = document.getElementById('btnRender3D');
        const overlayHidden = overlay && (overlay.classList.contains('hidden') || window.getComputedStyle(overlay).display === 'none');
        const btnReady = btn && !btn.disabled;
        const tris = window.__map3d?.state?.totalTriangles || 0;
        return overlayHidden && btnReady && tris > 0;
      }, null, { timeout: 70000 });

      const totalElapsedMs = Date.now() - tStart;
      const totalElapsedSec = (totalElapsedMs / 1000).toFixed(2);
      console.log(`  Progressive streaming completed in ${totalElapsedSec}s (Target: > 25.0s)!`);

      const finalState = await page.evaluate(() => {
        const errBanner = document.getElementById('gisErrorBanner');
        return {
          triangles: window.__map3d?.state?.totalTriangles || 0,
          buildings: window.__map3d?.state?.sceneData?.buildings?.length || 0,
          bannerVisible: errBanner && !errBanner.classList.contains('hidden')
        };
      });

      console.log('  Final State:', finalState);
      const passSlowStream = totalElapsedMs > 25000 &&
                             !finalState.bannerVisible &&
                             finalState.triangles > 0 &&
                             pageErrors.length === 0;

      empiricalResults.tests.focus1_slow_progressive_streaming = {
        pass: passSlowStream,
        totalElapsedMs,
        totalElapsedSec: Number(totalElapsedSec),
        chunksDelivered: chunkSeq,
        triangles: finalState.triangles,
        buildings: finalState.buildings,
        bannerVisible: finalState.bannerVisible,
        pageErrors
      };

      if (passSlowStream) {
        empiricalResults.summary.passed++;
        console.log(`  [PASS] Focus 1.1: Slow progressive stream successfully lasted ${totalElapsedSec}s (>25s) without 20s watchdog abort!`);
      } else {
        empiricalResults.summary.failed++;
        console.error('  [FAIL] Focus 1.1: Slow progressive stream failed!');
      }

      await context.close();
    }

    // =========================================================================
    // FOCUS 1 - TEST 1.2: Dead Network Watchdog (Hard 20s Inactivity Abort)
    // =========================================================================
    console.log('\n--- [FOCUS 1 - TEST 1.2] Dead Network Watchdog (Hard 20s Inactivity Abort) ---');
    console.log('Scenario: Network completely hangs (0 chunks returned, 0 progress).');
    console.log('Target: Must abort at ~20s, surface #gisErrorBanner mentioning 20s, 0 uncaught rejections.');
    {
      const context = await browser.newContext({ baseURL: BASE_URL });
      const page = await context.newPage();

      const pageErrors = [];
      const consoleErrors = [];

      page.on('pageerror', err => pageErrors.push(err.message || String(err)));
      page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      await page.addInitScript(() => {
        window.__unhandledRejections = [];
        window.addEventListener('unhandledrejection', ev => {
          window.__unhandledRejections.push(String(ev.reason && ev.reason.stack ? ev.reason.stack : ev.reason));
        });
      });

      await page.route('**/*interpreter*', () => {});
      await page.route('**/*elevation-tiles-prod*/**', () => {});

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#view3dCanvas', { state: 'attached' });

      const tStart = Date.now();
      console.log('  Triggering fetch with hanging network...');
      await page.evaluate(() => {
        window.fetchRealGISAndRender(60.1000, 24.9000, 60.1100, 24.9100, 'DEAD_NET_TEST').catch(err => {
          console.error('Caller caught:', err);
        });
      });

      await page.waitForFunction(() => {
        const overlay = document.getElementById('loadingOverlay3D');
        const banner = document.getElementById('gisErrorBanner');
        const btn = document.getElementById('btnRender3D');

        const overlayHidden = overlay && (overlay.classList.contains('hidden') || window.getComputedStyle(overlay).display === 'none');
        const bannerVisible = banner && (!banner.classList.contains('hidden') && window.getComputedStyle(banner).display !== 'none');
        const btnEnabled = btn && !btn.disabled;

        return overlayHidden && bannerVisible && btnEnabled;
      }, null, { timeout: 35000 });

      const elapsedMs = Date.now() - tStart;
      const elapsedSec = (elapsedMs / 1000).toFixed(2);
      console.log(`  Watchdog aborted and surfaced banner after ${elapsedSec}s!`);

      const bannerText = await page.locator('#gisErrorText').textContent();
      const inPageRejections = await page.evaluate(() => window.__unhandledRejections || []);

      console.log(`  Banner Text: "${bannerText?.trim()}"`);
      console.log(`  Page errors: ${pageErrors.length}, Unhandled rejections: ${inPageRejections.length}`);

      const mentions20s = bannerText ? bannerText.includes('20s') : false;
      const timeInRange = elapsedMs >= 19500 && elapsedMs <= 25000;
      const zeroUncaught = pageErrors.length === 0 &&
                           inPageRejections.length === 0 &&
                           !consoleErrors.some(c => c.includes('Uncaught (in promise) TimeoutError'));

      const passDeadNet = mentions20s && timeInRange && zeroUncaught;

      empiricalResults.tests.focus1_dead_network_watchdog = {
        pass: passDeadNet,
        elapsedMs,
        elapsedSec: Number(elapsedSec),
        mentions20s,
        timeInRange,
        bannerText: bannerText?.trim(),
        zeroUncaught,
        inPageRejections,
        pageErrors,
        consoleErrors
      };

      if (passDeadNet) {
        empiricalResults.summary.passed++;
        console.log(`  [PASS] Focus 1.2: Dead network cleanly aborted after ${elapsedSec}s, banner contains '20s', zero unhandled rejections!`);
      } else {
        empiricalResults.summary.failed++;
        console.error('  [FAIL] Focus 1.2: Dead network verification failed!');
      }

      await context.close();
    }

    // =========================================================================
    // FOCUS 2 - TEST 2.1: Uncached Location Streaming (Cape Town)
    // =========================================================================
    console.log('\n--- [FOCUS 2 - TEST 2.1] Uncached Location Streaming (Cape Town) ---');
    console.log('Scenario: Fresh coordinates for Cape Town (-33.9249, 18.4241), cache purged.');
    console.log('Target: Must query real chunked streaming pipeline without static catalog.');
    {
      const context = await browser.newContext({ baseURL: BASE_URL });
      const page = await context.newPage();

      await page.addInitScript(() => {
        window.addEventListener('DOMContentLoaded', () => {
          if (window.__map3d?.state && !window.__map3d.state.selectedBuildingIds) {
            window.__map3d.state.selectedBuildingIds = new Set();
          }
        });
        window.halfW = 84.6;
        window.halfH = 84.6;
      });

      let overpassCalls = 0;
      await page.route('**/*interpreter*', async route => {
        overpassCalls++;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(makeMockOsmJson(overpassCalls, 5000 + overpassCalls * 50))
        });
      });

      await page.route('**/*elevation-tiles-prod*/**', async route => {
        await route.fulfill({ status: 200, contentType: 'image/png', body: MOCK_DEM_PNG });
      });

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#view3dCanvas', { state: 'attached' });

      const catalogExists = await page.evaluate(() => {
        return typeof window.PRECOMPUTED_CACHE_CATALOG !== 'undefined' ||
               typeof window._gisSceneMemoryCache !== 'undefined';
      });

      await page.evaluate(() => {
        if (window.__map3d?.state) {
          window.__map3d.state.selectedBuildingIds = new Set();
          window.__map3d.state.mapSpanMeters = 1200;
        }
        window.fetchRealGISAndRender(-33.9300, 18.4180, -33.9200, 18.4300, 'CAPE TOWN').catch(console.error);
      });

      await page.waitForFunction(() => {
        const overlay = document.getElementById('loadingOverlay3D');
        const tris = window.__map3d?.state?.totalTriangles || 0;
        const hidden = overlay && (overlay.classList.contains('hidden') || window.getComputedStyle(overlay).display === 'none');
        return hidden && tris > 0;
      }, null, { timeout: 30000 });

      const capeTownResult = await page.evaluate(() => {
        const s = window.__map3d.state;
        return {
          triangles: s.totalTriangles || 0,
          buildings: s.sceneData?.buildings?.length || 0,
          title: s.sceneData?.title,
          isFallback: Boolean(s.sceneData?._fallback)
        };
      });

      console.log('  Cape Town Result:', capeTownResult);
      const passCapeTown = !catalogExists && overpassCalls >= 1 && capeTownResult.triangles > 0;

      empiricalResults.tests.focus2_uncached_location = {
        pass: passCapeTown,
        catalogExists,
        overpassCalls,
        triangles: capeTownResult.triangles,
        buildings: capeTownResult.buildings
      };

      if (passCapeTown) {
        empiricalResults.summary.passed++;
        console.log('  [PASS] Focus 2.1: Uncached Cape Town location streamed dynamically without static cache catalog!');
      } else {
        empiricalResults.summary.failed++;
        console.error('  [FAIL] Focus 2.1: Uncached location streaming failed!');
      }

      await context.close();
    }

    // =========================================================================
    // FOCUS 2 - TEST 2.2: Graceful DEM Terrain Fallback on Overpass Outage
    // =========================================================================
    console.log('\n--- [FOCUS 2 - TEST 2.2] Graceful DEM Terrain Fallback on Overpass Outage ---');
    console.log('Scenario: Overpass returns HTTP 504 Gateway Timeout, DEM succeeds.');
    console.log('Target: Builds DEM terrain-only fallback scene, banner notifies user, no infinite spinner.');
    {
      const context = await browser.newContext({ baseURL: BASE_URL });
      const page = await context.newPage();

      await page.addInitScript(() => {
        window.addEventListener('DOMContentLoaded', () => {
          if (window.__map3d?.state && !window.__map3d.state.selectedBuildingIds) {
            window.__map3d.state.selectedBuildingIds = new Set();
          }
        });
        window.halfW = 84.6;
        window.halfH = 84.6;
      });

      await page.route('**/*interpreter*', async route => {
        await route.fulfill({
          status: 504,
          contentType: 'text/html',
          body: '<html><body>Overpass Gateway Timeout</body></html>'
        });
      });

      await page.route('**/*elevation-tiles-prod*/**', async route => {
        await route.fulfill({ status: 200, contentType: 'image/png', body: MOCK_DEM_PNG });
      });

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#view3dCanvas', { state: 'attached' });

      await page.evaluate(() => {
        if (window.__map3d?.state) {
          window.__map3d.state.selectedBuildingIds = new Set();
        }
        window.fetchRealGISAndRender(45.8000, 15.9500, 45.8150, 15.9700, 'ZAGREB_DEM_TEST').catch(console.error);
      });

      await page.waitForFunction(() => {
        const overlay = document.getElementById('loadingOverlay3D');
        const banner = document.getElementById('gisErrorBanner');
        const btn = document.getElementById('btnRender3D');

        const overlayHidden = overlay && (overlay.classList.contains('hidden') || window.getComputedStyle(overlay).display === 'none');
        const bannerVisible = banner && (!banner.classList.contains('hidden') && window.getComputedStyle(banner).display !== 'none');
        const btnReady = btn && !btn.disabled;

        return overlayHidden && bannerVisible && btnReady;
      }, null, { timeout: 30000 });

      const bannerText = await page.locator('#gisErrorText').textContent();
      const fallbackState = await page.evaluate(() => {
        const s = window.__map3d.state;
        return {
          triangles: s.totalTriangles || 0,
          buildings: s.sceneData?.buildings?.length || 0,
          isFallback: Boolean(s.sceneData?._fallback),
          hasDem: Boolean(s.sceneData?.dem),
          title: s.sceneData?.title
        };
      });

      console.log('  DEM Fallback State:', fallbackState);
      console.log(`  Banner Text: "${bannerText?.trim()}"`);

      const mentionsOverpass = bannerText ? bannerText.toLowerCase().includes('overpass') : false;
      const mentionsDem = bannerText ? bannerText.toLowerCase().includes('dem') : false;
      const passDemFallback = fallbackState.isFallback === true &&
                              fallbackState.hasDem === true &&
                              fallbackState.buildings === 0 &&
                              fallbackState.triangles > 0 &&
                              mentionsOverpass &&
                              mentionsDem;

      empiricalResults.tests.focus2_dem_fallback = {
        pass: passDemFallback,
        fallbackState,
        bannerText: bannerText?.trim(),
        mentionsOverpass,
        mentionsDem
      };

      if (passDemFallback) {
        empiricalResults.summary.passed++;
        console.log('  [PASS] Focus 2.2: Graceful DEM fallback built seamlessly when Overpass failed, banner informed user!');
      } else {
        empiricalResults.summary.failed++;
        console.error('  [FAIL] Focus 2.2: DEM fallback verification failed!');
      }

      await context.close();
    }

    // =========================================================================
    // FOCUS 3: DOM Prototype Safety & safeClosest Adversarial Stress
    // =========================================================================
    console.log('\n--- [FOCUS 3] DOM Prototype Safety & safeClosest Adversarial Stress ---');
    console.log('Scenario: Dispatching events with Text, Document, Window, and exotic non-Element targets.');
    console.log('Target: No TypeError: ev.target.closest is not a function thrown under any circumstance.');
    {
      const context = await browser.newContext({ baseURL: BASE_URL });
      const page = await context.newPage();

      const pageErrors = [];
      const closestErrors = [];
      page.on('pageerror', err => {
        const msg = err.message || String(err);
        pageErrors.push(msg);
        if (msg.includes('closest') || msg.includes('not a function')) {
          closestErrors.push(msg);
        }
      });

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#view3dCanvas', { state: 'attached' });

      const protoResults = await page.evaluate(() => {
        const checks = [];
        function check(name, condition, extra = '') {
          checks.push({ name, pass: Boolean(condition), extra });
        }

        check('window.safeClosest is function', typeof window.safeClosest === 'function');
        check('Window.prototype.closest is function', typeof Window.prototype.closest === 'function');
        check('Document.prototype.closest is function', typeof Document.prototype.closest === 'function');
        check('Text.prototype.closest is function', typeof Text.prototype.closest === 'function');

        try { check('window.closest("div") returns null', window.closest('div') === null); }
        catch (e) { check('window.closest("div")', false, e.message); }

        try { check('document.closest("div") returns null', document.closest('div') === null); }
        catch (e) { check('document.closest("div")', false, e.message); }

        const spanChip = document.querySelector('button[data-span-km="1.2"]') || document.querySelector('button');
        const textNodeInBtn = spanChip ? spanChip.firstChild : null;
        if (textNodeInBtn && textNodeInBtn.nodeType === 3) {
          try {
            const foundBtn = textNodeInBtn.closest('button');
            check('textNode.closest("button") resolves parent button', foundBtn === spanChip);
          } catch (e) {
            check('textNode.closest("button")', false, e.message);
          }
        }

        const orphaned = document.createTextNode('orphaned');
        try { check('orphaned.closest("button") returns null', orphaned.closest('button') === null); }
        catch (e) { check('orphaned.closest("button")', false, e.message); }

        check('safeClosest(window, "button") === null', window.safeClosest(window, 'button') === null);
        check('safeClosest(document, "button") === null', window.safeClosest(document, 'button') === null);
        check('safeClosest(null, "button") === null', window.safeClosest(null, 'button') === null);
        check('safeClosest(undefined, "button") === null', window.safeClosest(undefined, 'button') === null);
        check('safeClosest({}, "button") === null', window.safeClosest({}, 'button') === null);
        check('safeClosest(42, "button") === null', window.safeClosest(42, 'button') === null);
        check('safeClosest("test", "button") === null', window.safeClosest('test', 'button') === null);
        check('safeClosest(spanChip, "[broken:syntax") === null', window.safeClosest(spanChip, '[broken:syntax') === null);

        const targetsToTest = [
          window,
          document,
          orphaned,
          document.createComment('comment node'),
          textNodeInBtn,
          spanChip
        ];

        const eventTypes = ['click', 'mousedown', 'mouseup', 'pointerdown'];
        let dispatchedCount = 0;

        for (const t of targetsToTest) {
          if (!t) continue;
          for (const evType of eventTypes) {
            try {
              const ev = new MouseEvent(evType, { bubbles: true, cancelable: true });
              Object.defineProperty(ev, 'target', { value: t, configurable: true });
              document.dispatchEvent(ev);
              dispatchedCount++;
            } catch (err) {
              check(`Event dispatch ${evType} on target`, false, err.message);
            }
          }
        }

        check(`Dispatched ${dispatchedCount} synthetic events with exotic targets without error`, dispatchedCount > 0);
        return { checks, totalChecks: checks.length, passedChecks: checks.filter(c => c.pass).length };
      });

      console.log(`  Browser Checks: ${protoResults.passedChecks}/${protoResults.totalChecks} passed.`);
      const passDomSafety = protoResults.passedChecks === protoResults.totalChecks &&
                            closestErrors.length === 0 &&
                            pageErrors.length === 0;

      empiricalResults.tests.focus3_dom_prototype_safety = {
        pass: passDomSafety,
        passedChecks: protoResults.passedChecks,
        totalChecks: protoResults.totalChecks,
        closestErrors,
        pageErrors
      };

      if (passDomSafety) {
        empiricalResults.summary.passed++;
        console.log('  [PASS] Focus 3: DOM prototype safety nets and safeClosest verified with 0 closest/TypeError exceptions!');
      } else {
        empiricalResults.summary.failed++;
        console.error('  [FAIL] Focus 3: DOM prototype safety test encountered errors!');
      }

      await context.close();
    }

  } finally {
    await browser.close();
  }

  // Save empirical results
  const reportPath = path.resolve(__dirname, '../.agents/teamwork/challenger_m3_2/empirical_results.json');
  fs.writeFileSync(reportPath, JSON.stringify(empiricalResults, null, 2), 'utf8');
  console.log(`\nEmpirical results saved to: ${reportPath}`);

  const hasCriticalDefects = empiricalResults.forensic_defects.length > 0;
  const verdict = hasCriticalDefects ? 'REQUEST_CHANGES' : 'APPROVE';

  console.log('\n================================================================');
  console.log(`=== CHALLENGER M3_2 FINAL VERDICT: ${verdict} ===`);
  console.log(`=== Functional Focus Tests Passed: ${empiricalResults.summary.passed}/5 ===`);
  console.log(`=== Forensic Production Defects Found: ${empiricalResults.forensic_defects.length} ===`);
  console.log('================================================================\n');

  return empiricalResults;
}

if (require.main === module) {
  runEmpiricalChallenger()
    .then(results => {
      // Exit with 1 if forensic defects were found (REQUEST_CHANGES), 0 if clean (APPROVE)
      process.exit(results.forensic_defects.length === 0 ? 0 : 1);
    })
    .catch(err => {
      console.error('Fatal harness error:', err);
      process.exit(1);
    });
}

module.exports = { runEmpiricalChallenger };
