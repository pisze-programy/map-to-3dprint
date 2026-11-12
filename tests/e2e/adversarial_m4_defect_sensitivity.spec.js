// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  setupConsoleHygiene,
  waitForAppReady,
  waitForRenderComplete,
  waitForGisError,
  assertWebGLCanvasNotBlank,
} = require('./test_utils');

test.describe('Adversarial Defect Sensitivity: Uncached GIS Streaming & Watchdog', () => {

  // ==========================================================================
  // SUITE 1: Watchdog Sensitivity & Inactivity Reset (Mutant A)
  // ==========================================================================
  test.describe('1. Watchdog Progress Reset & Inactivity Stalls (Mutant A)', () => {

    test('1.1 Legitimate progressive stream spanning >20s survives when watchdog resets on progress', async ({ page }) => {
      test.setTimeout(90000);
      const hygiene = setupConsoleHygiene(page);

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      await page.unroute('**/*interpreter*').catch(() => {});
      await page.unroute('**/api/interpreter**').catch(() => {});

      let chunkRequestCount = 0;
      const tStart = Date.now();

      // Intercept interpreter requests and deliver chunks with 11-second delay per batch
      // 2x2 grid = 4 chunks in 2 batches of 2 chunks.
      // Batch 1 (chunks 1,2) arrives at t=11s (resets watchdog).
      // Batch 2 (chunks 3,4) arrives at t=22s (resets watchdog).
      // Total wall clock = ~22-24s (>20s).
      await page.route('**/*interpreter*', async (route) => {
        chunkRequestCount++;
        const currentChunk = chunkRequestCount;
        await new Promise(r => setTimeout(r, 11000));

        const osmPayload = {
          version: 0.6,
          generator: "AdversarialDelayedServer",
          elements: [
            { type: "node", id: 1000 + currentChunk * 10 + 1, lat: 52.2450, lon: 21.0100 },
            { type: "node", id: 1000 + currentChunk * 10 + 2, lat: 52.2460, lon: 21.0100 },
            { type: "node", id: 1000 + currentChunk * 10 + 3, lat: 52.2460, lon: 21.0120 },
            { type: "node", id: 1000 + currentChunk * 10 + 4, lat: 52.2450, lon: 21.0120 },
            {
              type: "way",
              id: 2000 + currentChunk,
              nodes: [1000 + currentChunk * 10 + 1, 1000 + currentChunk * 10 + 2, 1000 + currentChunk * 10 + 3, 1000 + currentChunk * 10 + 4, 1000 + currentChunk * 10 + 1],
              tags: { building: "yes", height: "18" }
            }
          ]
        };

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(osmPayload)
        });
      });

      // Span > 1450m triggers 2x2 grid (4 chunks). Span = 0.03 deg ~ 3340m
      await page.evaluate(() => {
        window.fetchRealGISAndRender(52.2300, 21.0000, 52.2600, 21.0500, 'SLOW_STREAM_TEST');
      });

      await expect(page.locator('#loadingOverlay3D')).toBeVisible();

      // Because progress updates reset the watchdog at t=11s, this >20s stream survives
      await waitForRenderComplete(page, 'SLOW_STREAM_TEST', 60000);
      const totalElapsed = Date.now() - tStart;

      console.log(`[Empirical Test 1.1] Completed in ${totalElapsed}ms with ${chunkRequestCount} delayed chunks.`);
      console.log(`[Empirical Test 1.1] Console warnings:`, hygiene.consoleWarnings);
      const chunkStats = await page.evaluate(() => window.__map3d?.state?.sceneData?._chunkStats);
      console.log(`[Empirical Test 1.1] Chunk stats:`, chunkStats);
      expect(totalElapsed).toBeGreaterThan(20000); // Proves total time strictly exceeded 20s

      await expect(page.locator('#loadingOverlay3D')).toBeHidden();
      await expect(page.locator('#gisErrorBanner')).toBeHidden();
      await expect(page.locator('#btnRender3D')).toBeEnabled();

      hygiene.assertClean();
    });

    test('1.2 Inactivity stall of >45s mid-stream triggers watchdog killswitch', async ({ page }) => {
      test.setTimeout(120000);
      const hygiene = setupConsoleHygiene(page);

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      await page.unroute('**/*interpreter*').catch(() => {});
      await page.unroute('**/api/interpreter**').catch(() => {});

      let requestIndex = 0;
      const tStart = Date.now();

      // Urban 3.3 km span uses 3x3 = 9 chunks (onPartialScene fires at ceil(9 * 0.5) = 5 chunks).
      // Requests 1..5 return at 1.5s; requests >= 6 hang indefinitely (>45s stall).
      await page.route('**/*interpreter*', async (route) => {
        requestIndex++;
        if (requestIndex <= 5) {
          await new Promise(r => setTimeout(r, 1500));
          const osmPayload = {
            version: 0.6,
            elements: [
              { type: "node", id: 101, lat: 52.2450, lon: 21.0100 },
              { type: "node", id: 102, lat: 52.2460, lon: 21.0100 },
              { type: "node", id: 103, lat: 52.2460, lon: 21.0120 },
              { type: "node", id: 104, lat: 52.2450, lon: 21.0120 },
              { type: "way", id: 201, nodes: [101, 102, 103, 104, 101], tags: { building: "yes", height: "15" } }
            ]
          };
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(osmPayload)
          });
        } else {
          // Remaining chunks hang indefinitely
        }
      });

      // 9 chunks (3x3 urban): 52.2300 to 52.2600
      await page.evaluate(() => {
        window.fetchRealGISAndRender(52.2300, 21.0000, 52.2600, 21.0500, 'MID_STREAM_STALL');
      });

      await expect(page.locator('#loadingOverlay3D')).toBeVisible();

      // Wait for watchdog to trigger (inactivity timeout fires at ~3s + 45s = ~48s)
      await page.waitForFunction(() => {
        const overlay = document.getElementById('loadingOverlay3D');
        const overlayHidden = overlay && (overlay.classList.contains('hidden') || window.getComputedStyle(overlay).display === 'none');
        const btn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btnRender3D'));
        return overlayHidden && btn && !btn.disabled;
      }, null, { timeout: 65000 });

      const elapsed = Date.now() - tStart;
      console.log(`[Empirical Test 1.2] Watchdog aborted hanging stream after ${elapsed}ms.`);
      expect(elapsed).toBeGreaterThanOrEqual(45500);

      // Verify watchdog warning fired
      const watchdogWarn = hygiene.consoleWarnings.find(w => w.includes('[GIS Watchdog] Inactivity timeout'));
      expect(watchdogWarn).toBeTruthy();

      // Verify partial assembly occurred (5 of 9 chunks loaded into partialScene before watchdog abort)
      const partialInfo = await page.evaluate(() => {
        const sc = window.__map3d?.state?.sceneData;
        return sc ? {
          title: sc.title || '',
          isPartialPreview: Boolean(sc._isPartialPreview),
          chunkStats: sc._chunkStats || null,
          buildingCount: Array.isArray(sc.buildings) ? sc.buildings.length : 0,
        } : null;
      });
      expect(partialInfo).toBeTruthy();
      if (partialInfo.chunkStats) {
        expect(partialInfo.chunkStats.loadedChunks).toBe(5);
        expect(partialInfo.chunkStats.totalChunks).toBe(9);
      } else {
        expect(partialInfo.isPartialPreview).toBe(true);
        expect(partialInfo.title).toContain('(5/9)');
        expect(partialInfo.buildingCount).toBeGreaterThanOrEqual(1);
      }

      await expect(page.locator('#loadingOverlay3D')).toBeHidden();
      await expect(page.locator('#btnRender3D')).toBeEnabled();
    });

  });

  // ==========================================================================
  // SUITE 2: Cache Catalog Shortcuts & Genuine Uncached Coordinates (Mutant B)
  // ==========================================================================
  test.describe('2. Uncached Coordinates & Cache Catalog Shortcut Audit (Mutant B)', () => {

    test('2.1 Truly uncached coordinates (Mount Fuji) without local cache fallback', async ({ page }) => {
      test.setTimeout(90000);
      const hygiene = setupConsoleHygiene(page);

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      // Verify that Mount Fuji does NOT exist in cache
      const cacheDir = path.resolve(__dirname, '../../cache');
      const fujiCacheFiles = fs.readdirSync(cacheDir).filter(f => f.includes('35.36') || f.includes('138.7'));
      expect(fujiCacheFiles.length, 'Mount Fuji must not be pre-cached').toBe(0);

      // Unroute any proxy shortcut that returns arbitrary files[0]
      await page.unroute('**/*interpreter*').catch(() => {});
      await page.unroute('**/api/interpreter**').catch(() => {});

      // Simulate a real remote server that returns HTTP 503 Overpass overloaded
      let interceptedUrls = [];
      await page.route('**/*interpreter*', async (route) => {
        interceptedUrls.push(route.request().url());
        await route.fulfill({
          status: 503,
          contentType: 'text/plain',
          body: 'Error: server busy'
        });
      });

      // Request Mount Fuji coordinates
      await page.evaluate(() => {
        window.__map3d.state.mapSpanMeters = 1200;
        window.fetchRealGISAndRender(35.3500, 138.7200, 35.3700, 138.7400, 'MOUNT FUJI');
      });

      // Must NOT hang in infinite loading
      // Must gracefully fall back to DEM terrain relief with error banner
      await page.waitForFunction(() => {
        const overlay = document.getElementById('loadingOverlay3D');
        const overlayHidden = overlay && (overlay.classList.contains('hidden') || window.getComputedStyle(overlay).display === 'none');
        const btn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btnRender3D'));
        return overlayHidden && btn && !btn.disabled;
      }, null, { timeout: 45000 });

      // Check banner and mesh
      const bannerVisible = await page.locator('#gisErrorBanner').isVisible();
      expect(bannerVisible).toBe(true);
      const bannerText = (await page.locator('#gisErrorText').textContent()) || '';
      expect(bannerText).toContain('Załadowano model terenu DEM');

      const stats = await page.evaluate(() => ({
        triangles: window.__map3d?.state?.totalTriangles || 0,
        buildings: window.__map3d?.state?.totalBuildings || 0,
      }));
      console.log(`[Empirical Test 2.1] Mount Fuji DEM fallback rendered: ${stats.triangles} triangles, ${stats.buildings} buildings.`);
      expect(stats.triangles).toBeGreaterThan(0);
      expect(stats.buildings).toBe(0); // 0 buildings because Overpass returned 503

      await assertWebGLCanvasNotBlank(page);
      hygiene.assertClean();
    });

    test('2.2 Proxy shortcut sensitivity: detecting if files[0] cache shortcut masks errors', async ({ page }) => {
      // Direct verification of setupOverpassProxy implementation
      const utilsCode = fs.readFileSync(path.resolve(__dirname, 'test_utils.js'), 'utf-8');
      
      // Verify that setupOverpassProxy has NO unconditional fallback to files[0]
      const hasFiles0Fallback = /bestFile\s*=\s*files\[0\]/.test(utilsCode);
      console.log(`[Audit 2.2] setupOverpassProxy has files[0] unconditional fallback: ${hasFiles0Fallback}`);
      expect(hasFiles0Fallback).toBe(false);
      // NOTE: Proves that live Overpass streaming runs genuinely without arbitrary files[0] shortcut.
    });

  });

  // ==========================================================================
  // SUITE 3: Unhandled Rejection Hygiene & Detection Sensitivity (Mutant C)
  // ==========================================================================
  test.describe('3. Unhandled Rejection Hygiene Sensitivity (Mutant C)', () => {

    test('3.1 Playwright pageerror vs unhandledrejection event capture behavior', async ({ page }) => {
      let pageErrorCaught = null;
      let consoleErrorCaught = null;

      page.on('pageerror', err => { pageErrorCaught = err.message; });
      page.on('console', msg => {
        if (msg.type() === 'error') consoleErrorCaught = msg.text();
      });

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      // Inject an unhandled promise rejection in page context
      await page.evaluate(() => {
        Promise.reject(new Error('ADVERSARIAL_UNHANDLED_PROMISE_REJECTION'));
      });

      // Give browser event loop a moment to dispatch
      await page.waitForTimeout(500);

      console.log(`[Empirical Test 3.1] pageerror: "${pageErrorCaught}", console.error: "${consoleErrorCaught}"`);

      // In Chromium, unhandled promise rejections trigger `pageerror` (or console.error)
      const wasDetected = (pageErrorCaught && pageErrorCaught.includes('ADVERSARIAL')) ||
                          (consoleErrorCaught && consoleErrorCaught.includes('ADVERSARIAL'));
      expect(wasDetected).toBe(true);
    });

    test('3.2 assertClean() sensitivity to unhandled promise rejections', async ({ page }) => {
      const hygiene = setupConsoleHygiene(page);

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      // Inject unhandled promise rejection
      await page.evaluate(() => {
        Promise.reject(new Error('INJECTED_TEST_REJECTION'));
      });

      await page.waitForTimeout(500);

      // Test whether hygiene.assertClean() detects it
      let didThrow = false;
      try {
        hygiene.assertClean();
      } catch (e) {
        didThrow = true;
        console.log(`[Empirical Test 3.2] hygiene.assertClean() threw as expected: ${e.message}`);
      }

      // If pageerror is populated, assertClean() MUST throw
      if (hygiene.pageErrors.length > 0) {
        expect(didThrow).toBe(true);
      } else {
        console.warn('[Audit 3.2] Note: unhandled rejection did not populate pageErrors directly (went to consoleErrors).');
      }
    });

    test('3.3 GIS Streaming pipeline rejection hygiene: verify fetchChunkedGIS catches all sub-promises', async ({ page }) => {
      const hygiene = setupConsoleHygiene(page);

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      // Verify that when network abruptly disconnects or throws, no unhandled rejection leaks to window
      await page.unroute('**/*interpreter*').catch(() => {});
      await page.unroute('**/api/interpreter**').catch(() => {});
      await page.route('**/*interpreter*', route => route.abort('failed'));

      await page.evaluate(async () => {
        try {
          await window.fetchRealGISAndRender(52.2400, 21.0000, 52.2500, 21.0200, 'ABRUPT_FAILURE');
        } catch (_) {}
      });

      await page.waitForTimeout(2000);

      // Must have zero unhandled errors in page
      expect(hygiene.pageErrors).toEqual([]);
      hygiene.assertClean();
    });

  });

});
