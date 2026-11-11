// @ts-check
const { test, expect } = require('@playwright/test');
const {
  TEST_LOCATIONS,
  setupConsoleHygiene,
  waitForAppReady,
  waitForRenderComplete,
  mockPhotonPlaceSearch,
} = require('./test_utils');

test.describe('Tier 3: Cross-Feature Combinations (Opaque-Box E2E Tests)', () => {
  /** @type {ReturnType<typeof setupConsoleHygiene>} */
  let hygiene;

  test.beforeEach(async ({ page }) => {
    hygiene = setupConsoleHygiene(page);
  });

  test.afterEach(async () => {
    hygiene.assertClean();
  });

  // --------------------------------------------------------------------------
  // Test 3.1: City Selection + Span Slider Adjustment + 3D Render
  // --------------------------------------------------------------------------
  test('3.1 City Selection (Warsaw) + Span Slider Adjustment (2.5 km) + 3D Render', async ({ page }) => {
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

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // 1. Select Warsaw via search
    const placeInput = page.locator('#placeSearchInput');
    await placeInput.fill('Warszawa');
    await placeInput.dispatchEvent('input');

    const dropdown = page.locator('#searchSuggestionsDropdown');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await dropdown.locator('button').first().click();
    await expect(dropdown).toBeHidden();

    // Trigger 3D render explicitly under decoupled UX
    await page.locator('#btnRender3D').click();
    await waitForRenderComplete(page, 'WARSZAWA');

    // 2. Adjust span to 2.5 km using preset button
    const spanBtn = page.locator('button[data-span-km="2.5"]');
    await spanBtn.click();

    // Verify span label and internal state
    await expect(page.locator('#cropSizeLabel')).toContainText('2.50 km');
    const spanMeters = await page.evaluate(() => window.__map3d.state.mapSpanMeters);
    expect(spanMeters).toBe(2500);

    // 3. Trigger 3D render with updated span
    await page.click('#btnRender3D');

    // 4. Await render completion
    const state = await waitForRenderComplete(page, 'WARSZAWA');

    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    await expect(page.locator('#gisErrorBanner')).toBeHidden();
    await expect(page.locator('#btnRender3D')).toBeEnabled();

    expect(state.totalTriangles).toBeGreaterThan(50000);
    expect(state.buildingCount).toBeGreaterThan(200);

    // 5. Verify persistence in localStorage and URL
    const savedConfig = await page.evaluate(() => JSON.parse(localStorage.getItem('map3d_active_config') || '{}'));
    expect(savedConfig.spanKm).toBe(2.5);
    expect(page.url()).toContain('span=2.50');
  });

  // --------------------------------------------------------------------------
  // Test 3.2: City Selection + Frame Dimensions Change + 3D Render
  // --------------------------------------------------------------------------
  test('3.2 City Selection (New York) + Frame Dimensions Change (30x40 cm) + 3D Render', async ({ page }) => {
    test.setTimeout(120000);
    const ny = TEST_LOCATIONS.NEW_YORK;

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // Set plaque title to New York so subsequent #btnRender3D uses New York
    await page.locator('#plaqueTextInput').fill(ny.title);
    await page.locator('#plaqueTextInput').dispatchEvent('change');

    // 1. Load New York preset
    await page.evaluate(({ bbox, title }) => {
      window.__map3d.fetchRealGISAndRender(bbox, title);
    }, { bbox: ny.bbox, title: ny.title });
    await waitForRenderComplete(page, ny.titleMatch);

    // 2. Change frame dimensions to 30x40 cm via preset chip
    const frameBtn = page.locator('button[data-frame-size="30x40"]');
    await frameBtn.click();

    // 3. Adjust kerf margin input
    const kerfInput = page.locator('#kerfMmInput');
    await kerfInput.fill('0.12');
    await kerfInput.dispatchEvent('change');

    // 4. Verify inputs and badges
    expect(await page.locator('#targetWidthCmInput').inputValue()).toBe('30');
    expect(await page.locator('#targetHeightCmInput').inputValue()).toBe('40');
    await expect(page.locator('#bboxScaleBadge')).toContainText(/30(\.0)?×40(\.0)? cm/);

    // 5. Trigger render & await completion
    await page.click('#btnRender3D');
    const state = await waitForRenderComplete(page, ny.titleMatch);

    expect(state.totalTriangles).toBeGreaterThan(30000);

    const dims = await page.evaluate(() => ({
      w: window.__map3d.state.targetWidthCm,
      h: window.__map3d.state.targetHeightCm,
      kerf: window.__map3d.state.kerfMm,
    }));
    expect(dims.w).toBe(30);
    expect(dims.h).toBe(40);
    expect(dims.kerf).toBe(0.12);

    expect(page.url()).toContain('frame=30x40');
  });

  // --------------------------------------------------------------------------
  // Test 3.3: City Selection + Grid Tile Rows/Columns Change + 3D Render
  // --------------------------------------------------------------------------
  test('3.3 City Selection (Munich) + Grid Tile Rows/Columns Change (2x2) + 3D Render', async ({ page }) => {
    const munich = TEST_LOCATIONS.MUNICH;

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // Munich is loaded by default or explicit fetch
    await page.evaluate(({ bbox, title }) => {
      window.__map3d.fetchRealGISAndRender(bbox, title);
    }, { bbox: munich.bbox, title: munich.title });
    await waitForRenderComplete(page, munich.titleMatch);

    // 1. Change tile grid to 2x2
    const gridSelect = page.locator('#tileGridSelect');
    await gridSelect.selectOption('2x2');

    // 2. Test tile explode slider
    const tileExplode = page.locator('#tileExplodeSlider');
    await tileExplode.fill('40');
    await tileExplode.dispatchEvent('input');
    await expect(page.locator('#tileExplodeValueLabel')).toHaveText('40%');

    // Reset explode
    await tileExplode.fill('0');
    await tileExplode.dispatchEvent('input');

    // 3. Trigger 3D render
    await page.click('#btnRender3D');
    const state = await waitForRenderComplete(page, munich.titleMatch);

    expect(state.totalTriangles).toBeGreaterThan(50000);

    const grid = await page.evaluate(() => ({
      cols: window.__map3d.state.tileCols,
      rows: window.__map3d.state.tileRows,
    }));
    expect(grid.cols).toBe(2);
    expect(grid.rows).toBe(2);

    // 4. Verify export tile select options contains at least 4 tiles
    const exportOptions = await page.locator('#exportTileSelect option').allTextContents();
    expect(exportOptions.length).toBeGreaterThanOrEqual(4);

    expect(page.url()).toContain('grid=2x2');
  });

  // --------------------------------------------------------------------------
  // Test 3.4: Custom Coordinates + Span Distance + 3D Render
  // --------------------------------------------------------------------------
  test('3.4 Custom Coordinates (Kraków) + Span Distance (1.5 km) + 3D Render', async ({ page }) => {
    const krakow = TEST_LOCATIONS.KRAKOW;

    // Navigate with custom lat, lon, span, and title
    await page.goto(`/?lat=${krakow.center[0]}&lon=${krakow.center[1]}&span=1.5&title=${encodeURIComponent(krakow.title)}`, {
      waitUntil: 'domcontentloaded',
    });

    const state = await waitForRenderComplete(page, krakow.titleMatch);

    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    await expect(page.locator('#gisErrorBanner')).toBeHidden();
    await expect(page.locator('#btnRender3D')).toBeEnabled();

    expect(state.totalTriangles).toBeGreaterThan(30000);
    expect(state.lat).toBeCloseTo(krakow.center[0], 2);
    expect(state.lon).toBeCloseTo(krakow.center[1], 2);

    await expect(page.locator('#cropSizeLabel')).toContainText('1.50 km');
    await expect(page.locator('#mapStatusPill')).toHaveText(/N 50\./i);
  });

  // --------------------------------------------------------------------------
  // Test 3.5: City Selection + Settings Change + Reset/Default Recovery
  // --------------------------------------------------------------------------
  test('3.5 City Selection + Settings Mutation + Reset / Default Recovery', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // 1. Mutate settings: span 5.0 km, frame 20x20, rotation 45 deg, tileGrid 2x2
    await page.locator('button[data-span-km="5.0"]').click();
    await page.locator('button[data-frame-size="20x20"]').click();
    await page.locator('button[data-rot-deg="45"]').click();
    await page.locator('#tileGridSelect').selectOption('2x2');

    // Click Classic White & Gold palette
    const goldPaletteBtn = page.locator('#paletteButtonsContainer button', { hasText: 'Classic White & Gold' });
    await goldPaletteBtn.click();

    // Verify mutated state
    await expect(page.locator('#cropSizeLabel')).toContainText('5.00 km');
    expect(await page.locator('#targetWidthCmInput').inputValue()).toBe('20');
    await expect(page.locator('#mapRotationLabel')).toContainText('45°');

    // 2. Perform Default Recovery: clear stored config and reload cleanly
    await page.evaluate(() => localStorage.removeItem('map3d_active_config'));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    await page.locator('#btnRender3D').click();
    const recoveredState = await waitForRenderComplete(page);

    // 3. Assert default values restored
    await expect(page.locator('#cropSizeLabel')).toContainText('1.20 km');
    expect(await page.locator('#targetWidthCmInput').inputValue()).toBe('50');
    expect(await page.locator('#targetHeightCmInput').inputValue()).toBe('50');
    await expect(page.locator('#mapRotationLabel')).toContainText('0°');

    const stateProps = await page.evaluate(() => ({
      span: window.__map3d.state.mapSpanMeters,
      rot: window.__map3d.state.mapRotationDeg,
      w: window.__map3d.state.targetWidthCm,
      palette: window.__map3d.state.activePalette,
    }));
    expect(stateProps.span).toBe(1200);
    expect(stateProps.rot).toBe(0);
    expect(stateProps.w).toBe(50);
    expect(['white', 'studio']).toContain(stateProps.palette);
    expect(recoveredState.totalTriangles).toBeGreaterThan(50000);
  });

  // --------------------------------------------------------------------------
  // Test 3.6: City Selection + Map Rotation + 3D Render
  // --------------------------------------------------------------------------
  test('3.6 City Selection (Warsaw) + Map Rotation (90 deg) + 3D Render', async ({ page }) => {
    test.setTimeout(120000);
    const warsaw = TEST_LOCATIONS.WARSAW;

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    await page.locator('#plaqueTextInput').fill(warsaw.title);
    await page.locator('#plaqueTextInput').dispatchEvent('change');

    await page.evaluate(({ bbox, title }) => {
      window.__map3d.fetchRealGISAndRender(bbox, title);
    }, { bbox: warsaw.bbox, title: warsaw.title });
    await waitForRenderComplete(page, warsaw.titleMatch);

    // Rotate 90 degrees East
    const rotBtn = page.locator('button[data-rot-deg="90"]');
    await rotBtn.click();

    await expect(page.locator('#mapRotationLabel')).toContainText('90°');

    await page.click('#btnRender3D');
    const state = await waitForRenderComplete(page, warsaw.titleMatch);

    expect(state.totalTriangles).toBeGreaterThan(50000);

    const rotDeg = await page.evaluate(() => window.__map3d.state.mapRotationDeg);
    expect(rotDeg).toBe(90);
    expect(page.url()).toContain('rot=90');
  });

  // --------------------------------------------------------------------------
  // Test 3.7: City Selection + Color Palette & Layer Visibility Toggles
  // --------------------------------------------------------------------------
  test('3.7 City Selection + Palette Switch + Layer Visibility Toggles', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // Switch to Nordic Slate palette
    const nordicBtn = page.locator('#paletteButtonsContainer button', { hasText: 'Nordic' });
    await nordicBtn.click();

    const activePal = await page.evaluate(() => window.__map3d.state.activePalette);
    expect(activePal).toBe('nordic_dark');

    // Toggle off greenery layer
    const greeneryChk = page.locator('input[data-layer-vis="greenery"]');
    await greeneryChk.uncheck();

    const greenVis = await page.evaluate(() => window.__map3d.state.layerVisible.greenery);
    expect(greenVis).toBe(false);

    // Re-enable all layers via button
    await page.click('#btnShowAllLayers');

    const allVis = await page.evaluate(() => window.__map3d.state.layerVisible.greenery);
    expect(allVis).toBe(true);

    await page.locator('#btnRender3D').click();
    const state = await waitForRenderComplete(page);
    expect(state.totalTriangles).toBeGreaterThan(50000);
  });
});
