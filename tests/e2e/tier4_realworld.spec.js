// @ts-check
const { test, expect } = require('@playwright/test');
const {
  TEST_LOCATIONS,
  setupConsoleHygiene,
  waitForAppReady,
  waitForRenderComplete,
  mockPhotonPlaceSearch,
  setupResponsivenessMonitor,
  assertLocalStorageConfig,
} = require('./test_utils');

test.describe('Tier 4: Real-World Scenarios, Scalability & Responsiveness (Opaque-Box E2E Tests)', () => {
  /** @type {ReturnType<typeof setupConsoleHygiene>} */
  let hygiene;

  test.beforeEach(async ({ page }) => {
    hygiene = setupConsoleHygiene(page);
  });

  test.afterEach(async ({ page }) => {
    try {
      await page.evaluate(() => window.localStorage.clear());
    } catch {}
    hygiene.assertClean();
  });

  // --------------------------------------------------------------------------
  // Test 4.1: Warsaw Full Workflow & Reload Persistence
  // --------------------------------------------------------------------------
  test('4.1 Warsaw full user workflow retains settings and restores 3D preview across page reload', async ({ page }) => {
    test.setTimeout(120000);
    const warsaw = TEST_LOCATIONS.WARSAW;

    await mockPhotonPlaceSearch(page, 'Warszawa', [
      {
        name: 'Warszawa',
        city: 'Warszawa',
        state: 'woj. mazowieckie',
        country: 'Polska',
        lat: warsaw.center[0],
        lon: warsaw.center[1],
      },
    ]);

    // 1. Navigate to root application
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // 2. Select Warsaw via Autocomplete Search
    const searchInput = page.locator('#placeSearchInput');
    await searchInput.fill('Warszawa');
    await searchInput.dispatchEvent('input');

    const dropdown = page.locator('#searchSuggestionsDropdown');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await dropdown.locator('button').first().click();
    await expect(dropdown).toBeHidden();

    // Trigger 3D render explicitly under decoupled UX
    await page.locator('#btnRender3D').click();
    await waitForRenderComplete(page, warsaw.titleMatch);

    // 3. Adjust Area Span to 2.5 km using preset chip
    const spanBtn = page.locator('button[data-span-km="2.5"]');
    await spanBtn.click();

    // 4. Adjust Frame Dimensions to 40x50 cm using preset chip
    const frameBtn = page.locator('button[data-frame-size="40x50"]');
    await frameBtn.click();

    // 5. Render 3D Preview
    await page.locator('#btnRender3D').click();
    const preReloadState = await waitForRenderComplete(page, warsaw.titleMatch);
    expect(preReloadState.totalTriangles).toBeGreaterThan(50000);

    // 6. Verify pre-reload persistence in localStorage and URL
    await assertLocalStorageConfig(page, {
      city: 'WARSZAWA',
      lat: warsaw.center[0],
      lon: warsaw.center[1],
      spanKm: 2.5,
      targetW: 40,
      targetH: 50,
    });
    expect(page.url()).toContain('title=WARSZAWA');
    expect(page.url()).toContain('frame=40x50');

    // 7. Perform Full Page Reload
    await page.reload({ waitUntil: 'domcontentloaded' });

    // 8. Wait for Automatic Restoration & 3D Render Completion
    const postReloadState = await waitForRenderComplete(page, warsaw.titleMatch);

    // 9. Assert DOM Inputs Retained
    expect(await page.locator('#plaqueTextInput').inputValue()).toBe('WARSZAWA');
    expect(await page.locator('#targetWidthCmInput').inputValue()).toBe('40');
    expect(await page.locator('#targetHeightCmInput').inputValue()).toBe('50');
    expect(Number(await page.locator('#cropSizeSlider').inputValue())).toBeCloseTo(2.5, 1);

    // 10. Assert 3D Mesh & WebGL Canvas Visible
    expect(postReloadState.totalTriangles).toBeGreaterThan(50000);
    await expect(page.locator('#view3dCanvas')).toBeVisible();
    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    await expect(page.locator('#gisErrorBanner')).toBeHidden();
  });

  // --------------------------------------------------------------------------
  // Test 4.2: New York Full Workflow & Reload Persistence
  // --------------------------------------------------------------------------
  test('4.2 New York full user workflow retains custom settings and restores 3D preview across reload', async ({ page }) => {
    test.setTimeout(120000);
    const ny = TEST_LOCATIONS.NEW_YORK;

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // 1. Select New York via program
    await page.evaluate(({ bbox, title }) => {
      window.__map3d.fetchRealGISAndRender(bbox, title);
    }, { bbox: ny.bbox, title: ny.title });
    await waitForRenderComplete(page, ny.titleMatch);

    // Sync plaque text input to New York title
    const plaqueInput = page.locator('#plaqueTextInput');
    await plaqueInput.fill(ny.title);
    await plaqueInput.dispatchEvent('input');

    // 2. Customize Frame Dimensions to 30x30 cm
    const frameBtn = page.locator('button[data-frame-size="30x30"]');
    await frameBtn.click();

    // 3. Customize Span to 1.2 km
    const spanBtn = page.locator('button[data-span-km="1.2"]');
    await spanBtn.click();

    // 4. Trigger 3D Render
    await page.locator('#btnRender3D').click();
    const preState = await waitForRenderComplete(page, ny.titleMatch);
    expect(preState.totalTriangles).toBeGreaterThan(30000);

    // 5. Verify localStorage
    await assertLocalStorageConfig(page, {
      city: ny.title,
      targetW: 30,
      targetH: 30,
      spanKm: 1.2,
    });

    // 6. Reload page
    await page.reload({ waitUntil: 'domcontentloaded' });

    // 7. Await restored render
    const postState = await waitForRenderComplete(page, ny.titleMatch);

    // 8. Assert DOM elements retained
    expect(await page.locator('#targetWidthCmInput').inputValue()).toBe('30');
    expect(await page.locator('#targetHeightCmInput').inputValue()).toBe('30');
    expect(Number(await page.locator('#cropSizeSlider').inputValue())).toBeCloseTo(1.2, 1);
    expect(postState.totalTriangles).toBeGreaterThan(30000);
    await expect(page.locator('#view3dCanvas')).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Test 4.3: Large Area Scalability (25 km Span)
  // --------------------------------------------------------------------------
  test('4.3 Large area scalability: 25 km span renders without memory explosion or browser crash', async ({ page }) => {
    test.setTimeout(180000);
    const warsaw = TEST_LOCATIONS.WARSAW;
    const halfLat = (25.0 / 111.2) * 0.5;
    const cosLat = Math.cos((warsaw.center[0] * Math.PI) / 180);
    const halfLon = (25.0 / (111.2 * cosLat)) * 0.5;
    const bbox25k = [
      warsaw.center[0] - halfLat,
      warsaw.center[1] - halfLon,
      warsaw.center[0] + halfLat,
      warsaw.center[1] + halfLon,
    ];

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // Trigger 25 km render
    await page.evaluate(({ bbox, title }) => {
      window.__map3d.fetchRealGISAndRender(bbox, title);
    }, { bbox: bbox25k, title: 'WARSZAWA 25KM' });

    // Wait for completion (with 150s timeout for 3x3 + recursive sub-chunk live splits on 25 km metropolis)
    const state = await waitForRenderComplete(page, 'WARSZAWA', 150000);

    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    await expect(page.locator('#gisErrorBanner')).toBeHidden();
    expect(state.totalTriangles).toBeGreaterThan(0);
    // Verify 25 km spanMeters was preserved (not clobbered back to 1200 detail mode) and LoD bounded triangle count
    expect(state.spanMeters).toBeGreaterThanOrEqual(24000);
    expect(state.totalTriangles).toBeLessThan(400000);

    // Allow temporary raw chunk arrays to become collectable, then verify JS heap stays bounded
    await page.waitForTimeout(100);
    const heapUsed = await page.evaluate(() => {
      const perf = /** @type {any} */ (window.performance);
      return perf && perf.memory ? perf.memory.usedJSHeapSize : 0;
    });
    if (heapUsed > 0) {
      expect(heapUsed).toBeLessThan(550 * 1024 * 1024);
    }
  });

  // --------------------------------------------------------------------------
  // Test 4.4: Large Area & 50x100 Grid Scalability (Up to 50 km)
  // --------------------------------------------------------------------------
  test('4.4 Large grid scalability: 50x100 grid (5,000 tiles) processes without freeze warnings or crash', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/?grid=50x100', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const grid = await page.evaluate(() => ({
      cols: window.__map3d.state.tileCols,
      rows: window.__map3d.state.tileRows,
    }));
    expect(grid.cols).toBe(50);
    expect(grid.rows).toBe(100);
    expect(grid.cols * grid.rows).toBe(5000);

    // Trigger render under decoupled UX for 50x100 grid partitioning and 3D rebuild
    await page.locator('#btnRender3D').click();
    const state = await waitForRenderComplete(page, '', 75000);

    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    await expect(page.locator('#gisErrorBanner')).toBeHidden();
    expect(state.totalTriangles).toBeGreaterThan(0);
    await expect(page.locator('#view3dCanvas')).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Test 4.5: Main-Thread Responsiveness Audit (< 2,000 ms Freeze)
  // --------------------------------------------------------------------------
  test('4.5 UI responsiveness audit: main thread is never blocked for >2,000ms during GIS loading and rendering', async ({ page }) => {
    test.setTimeout(120000);
    const monitor = await setupResponsivenessMonitor(page);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // Configure 15x15 cm frame and 0.6 km area span for responsiveness audit
    const widthInp = page.locator('#targetWidthCmInput');
    await widthInp.fill('15');
    await widthInp.dispatchEvent('change');
    const heightInp = page.locator('#targetHeightCmInput');
    await heightInp.fill('15');
    await heightInp.dispatchEvent('change');
    const spanBtn = page.locator('button[data-span-km="0.6"]');
    await spanBtn.click();

    // Reset monitor window right before GIS fetch and 3D progressive build
    await monitor.reset();

    const warsaw = TEST_LOCATIONS.WARSAW;
    await page.evaluate(({ bbox, title }) => {
      window.__map3d.fetchRealGISAndRender(bbox, title);
    }, { bbox: warsaw.bbox, title: warsaw.title });

    // Wait for 3D render to complete
    await waitForRenderComplete(page, warsaw.titleMatch);

    // Retrieve report and assert R2 requirement: no single continuous task > 2,000ms
    const report = await monitor.getReport();
    console.log(`[R2 Audit] Warsaw render: max single task = ${report.maxTaskDurationMs}ms, max timer drift = ${report.maxDriftMs}ms, total blocked = ${report.totalBlockedMs}ms across ${report.totalLongTasks} tasks`);

    await monitor.assertResponsive(2000);
    await monitor.detach();
  });

  // --------------------------------------------------------------------------
  // Test 4.6: Progressive UI & Progress Indicator Fidelity
  // --------------------------------------------------------------------------
  test('4.6 Progressive UI: progress indicator displays active phases and advances monotonically', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const munich = TEST_LOCATIONS.MUNICH;
    await page.evaluate(({ bbox, title }) => {
      window.__map3d.fetchRealGISAndRender(bbox, title);
    }, { bbox: munich.bbox, title: munich.title });
    await waitForRenderComplete(page, munich.titleMatch);

    // Install in-page mutation observer on #loadingProgressBar and #loadingStatusText
    await page.evaluate(() => {
      window.__progressSnapshots = [];
      const progBar = document.getElementById('loadingProgressBar');
      const stEl = document.getElementById('loadingStatusText');
      const overlay = document.getElementById('loadingOverlay3D');

      function record() {
        const widthStr = progBar ? progBar.style.width : '0%';
        const widthNum = parseFloat(widthStr) || 0;
        const text = stEl ? (stEl.textContent || '') : '';
        const isHidden = !overlay || overlay.classList.contains('hidden') || window.getComputedStyle(overlay).display === 'none';
        window.__progressSnapshots.push({
          width: widthNum,
          text,
          hidden: isHidden,
          t: performance.now(),
        });
      }

      if (progBar && stEl) {
        const obs = new MutationObserver(() => record());
        obs.observe(progBar, { attributes: true, attributeFilter: ['style'] });
        obs.observe(stEl, { characterData: true, childList: true, subtree: true });
        if (overlay) {
          obs.observe(overlay, { attributes: true, attributeFilter: ['class', 'style'] });
        }
        window.__progressObserver = obs;
      }
    });

    // Trigger rebuild to observe progressive phase emissions (do not return giant mesh object across CDP)
    await page.evaluate(() => {
      window.__map3d.rebuildModel3D();
    });

    // Wait for render to complete
    await waitForRenderComplete(page);

    // Retrieve recorded snapshots
    /** @type {Array<{ width: number, text: string, hidden: boolean, t: number }>} */
    const snapshots = await page.evaluate(() => window.__progressSnapshots || []);

    // Verify multiple stages were captured
    expect(snapshots.length).toBeGreaterThanOrEqual(5);

    // Verify distinct phases were captured: Stage 1, Stage 2, Stage 3, Stage 4, Stage 5, Complete
    const stage1 = snapshots.find(s => s.text.includes('Etap 1/5'));
    const stage2 = snapshots.find(s => s.text.includes('Etap 2/5'));
    const stage3 = snapshots.find(s => s.text.includes('Etap 3/5'));
    const stage4 = snapshots.find(s => s.text.includes('Etap 4/5'));
    const stage5 = snapshots.find(s => s.text.includes('Etap 5/5'));
    const complete = snapshots.find(s => s.text.includes('Model 3D gotowy'));

    expect(stage1, 'Must emit Etap 1').toBeTruthy();
    expect(stage2, 'Must emit Etap 2').toBeTruthy();
    expect(stage3, 'Must emit Etap 3').toBeTruthy();
    expect(stage4, 'Must emit Etap 4').toBeTruthy();
    expect(stage5, 'Must emit Etap 5').toBeTruthy();
    expect(complete, 'Must emit completion').toBeTruthy();

    // Verify stage milestone widths are strictly monotonically advancing
    expect(stage1.width).toBeLessThan(stage2.width);
    expect(stage2.width).toBeLessThan(stage3.width);
    expect(stage3.width).toBeLessThan(stage4.width);
    expect(stage4.width).toBeLessThan(stage5.width);
    expect(stage5.width).toBeLessThanOrEqual(complete.width);
    expect(complete.width).toBe(100);

    // Verify stage text contains Polish stage indicators
    const hasStageText = snapshots.some(s =>
      /Etap|terenu|wód|park|drog|budynk|gotowy/i.test(s.text)
    );
    expect(hasStageText, 'Progress indicator must display Polish stage descriptions').toBe(true);

    // Verify loading overlay is hidden upon completion
    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
  });
});
