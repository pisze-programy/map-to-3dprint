// @ts-check
const { test, expect } = require('@playwright/test');
const {
  TEST_LOCATIONS,
  setupConsoleHygiene,
  waitForAppReady,
  waitForRenderComplete,
  mockPhotonPlaceSearch,
} = require('./test_utils');

test.describe('Tier 1: Feature Coverage (Opaque-Box E2E Tests)', () => {
  /** @type {ReturnType<typeof setupConsoleHygiene>} */
  let hygiene;

  test.beforeEach(async ({ page }) => {
    hygiene = setupConsoleHygiene(page);
  });

  test.afterEach(async () => {
    hygiene.assertClean();
  });

  // --------------------------------------------------------------------------
  // Test 1.1: Preset Warsaw (Old Town)
  // --------------------------------------------------------------------------
  test('1.1 Preset Warsaw (Old Town) loads 3D model with valid mesh stats', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const warsaw = TEST_LOCATIONS.WARSAW;

    // Trigger Warsaw fetch and render via global API
    await page.evaluate(({ bbox, title }) => {
      window.__map3d.fetchRealGISAndRender(bbox, title);
    }, { bbox: warsaw.bbox, title: warsaw.title });

    // Wait for render completion
    const state = await waitForRenderComplete(page, warsaw.titleMatch);

    // Verify DOM element states
    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    await expect(page.locator('#gisErrorBanner')).toBeHidden();
    await expect(page.locator('#btnRender3D')).toBeEnabled();

    // Verify mesh badge contents
    const badgeText = await page.locator('#meshStatsBadge').textContent();
    expect(badgeText).toContain('trójkątów');
    expect(badgeText).not.toContain('ERR:');
    expect(badgeText).not.toContain('Ładowanie siatki');

    // Verify triangles and buildings
    expect(state.totalTriangles).toBeGreaterThan(100000);
    expect(state.buildingCount).toBeGreaterThan(500);

    const sceneTitle = await page.evaluate(() => window.__map3d.state.sceneData?.title);
    expect(sceneTitle?.toUpperCase()).toContain(warsaw.titleMatch.toUpperCase());

    // Verify 3D canvas is visible with positive dimensions
    const canvas3d = page.locator('#view3dCanvas');
    await expect(canvas3d).toBeVisible();
    const box = await canvas3d.boundingBox();
    expect(box?.width).toBeGreaterThan(100);
    expect(box?.height).toBeGreaterThan(100);
  });

  // --------------------------------------------------------------------------
  // Test 1.2: Preset New York (Central Park South)
  // --------------------------------------------------------------------------
  test('1.2 Preset New York (Central Park) loads 3D model with valid mesh stats', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const ny = TEST_LOCATIONS.NEW_YORK;

    // Trigger New York fetch and render
    await page.evaluate(({ bbox, title }) => {
      window.__map3d.fetchRealGISAndRender(bbox, title);
    }, { bbox: ny.bbox, title: ny.title });

    const state = await waitForRenderComplete(page, ny.titleMatch);

    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    await expect(page.locator('#gisErrorBanner')).toBeHidden();
    await expect(page.locator('#btnRender3D')).toBeEnabled();

    const badgeText = await page.locator('#meshStatsBadge').textContent();
    expect(badgeText).toContain('trójkątów');
    expect(badgeText).not.toContain('ERR:');

    expect(state.totalTriangles).toBeGreaterThan(50000);
    expect(state.buildingCount).toBeGreaterThan(200);

    const sceneTitle = await page.evaluate(() => window.__map3d.state.sceneData?.title);
    expect(sceneTitle?.toUpperCase()).toContain(ny.titleMatch.toUpperCase());
  });

  // --------------------------------------------------------------------------
  // Test 1.3: Preset Munich (Marienplatz / Isar)
  // --------------------------------------------------------------------------
  test('1.3 Preset Munich (Marienplatz / Isar) loads 3D model with valid mesh stats', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const munich = TEST_LOCATIONS.MUNICH;

    // Explicitly fetch and render Munich preset
    await page.evaluate(({ bbox, title }) => {
      window.__map3d.fetchRealGISAndRender(bbox, title);
    }, { bbox: munich.bbox, title: munich.title });

    const state = await waitForRenderComplete(page, munich.titleMatch);

    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    await expect(page.locator('#gisErrorBanner')).toBeHidden();
    await expect(page.locator('#btnRender3D')).toBeEnabled();

    const badgeText = await page.locator('#meshStatsBadge').textContent();
    expect(badgeText).toContain('trójkątów');
    expect(badgeText).not.toContain('ERR:');

    expect(state.totalTriangles).toBeGreaterThan(100000);
    expect(state.buildingCount).toBeGreaterThan(500);

    const sceneTitle = await page.evaluate(() => window.__map3d.state.sceneData?.title);
    const normTitle = (sceneTitle || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    expect(normTitle).toContain('MUNCHEN');
  });

  // --------------------------------------------------------------------------
  // Test 1.4: Custom coordinate entry via URL bbox query param
  // --------------------------------------------------------------------------
  test('1.4 Custom coordinate entry via URL bbox query param loads Warsaw', async ({ page }) => {
    const warsaw = TEST_LOCATIONS.WARSAW;

    await page.goto(`/?bbox=${warsaw.bbox.join(',')}&title=${encodeURIComponent(warsaw.title)}`, {
      waitUntil: 'domcontentloaded',
    });

    const state = await waitForRenderComplete(page, warsaw.titleMatch);

    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    await expect(page.locator('#gisErrorBanner')).toBeHidden();
    await expect(page.locator('#btnRender3D')).toBeEnabled();

    const badgeText = await page.locator('#meshStatsBadge').textContent();
    expect(badgeText).toContain('trójkątów');
    expect(badgeText).not.toContain('ERR:');

    expect(state.totalTriangles).toBeGreaterThan(100000);

    const plaqueInput = await page.locator('#plaqueTextInput').inputValue();
    expect(plaqueInput.toUpperCase()).toBe(warsaw.title.toUpperCase());
  });

  // --------------------------------------------------------------------------
  // Test 1.5: Custom coordinate entry via URL lat/lon and span
  // --------------------------------------------------------------------------
  test('1.5 Custom coordinate entry via URL lat/lon and span loads Kraków', async ({ page }) => {
    const krakow = TEST_LOCATIONS.KRAKOW;

    await page.goto(`/?lat=${krakow.center[0]}&lon=${krakow.center[1]}&span=1.2&title=${encodeURIComponent(krakow.title)}`, {
      waitUntil: 'domcontentloaded',
    });

    const state = await waitForRenderComplete(page, krakow.titleMatch);

    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    await expect(page.locator('#gisErrorBanner')).toBeHidden();
    await expect(page.locator('#btnRender3D')).toBeEnabled();

    const badgeText = await page.locator('#meshStatsBadge').textContent();
    expect(badgeText).toContain('trójkątów');

    expect(state.totalTriangles).toBeGreaterThan(50000);
    expect(state.lat).toBeCloseTo(krakow.center[0], 2);
    expect(state.lon).toBeCloseTo(krakow.center[1], 2);

    // Verify #mapStatusPill displays coordinates
    const statusPill = page.locator('#mapStatusPill');
    await expect(statusPill).toBeVisible();
    await expect(statusPill).toHaveText(/N 50\./i);
  });

  // --------------------------------------------------------------------------
  // Test 1.6: Search bar autocomplete and selection
  // --------------------------------------------------------------------------
  test('1.6 Search bar autocomplete populates coordinates and initiates 3D render', async ({ page }) => {
    const warsaw = TEST_LOCATIONS.WARSAW;

    // Mock photon endpoint to guarantee deterministic fast response
    await mockPhotonPlaceSearch(page, 'Warszawa', [
      {
        name: 'Warszawa',
        city: 'Warszawa',
        state: 'województwo mazowieckie',
        country: 'Polska',
        lat: warsaw.center[0],
        lon: warsaw.center[1],
      },
    ]);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const placeInput = page.locator('#placeSearchInput');
    await placeInput.fill('Warszawa');
    await placeInput.dispatchEvent('input');

    // Wait for dropdown to show suggestion
    const suggestionsDropdown = page.locator('#searchSuggestionsDropdown');
    await expect(suggestionsDropdown).toBeVisible({ timeout: 5000 });

    const firstSuggestion = suggestionsDropdown.locator('button').first();
    await expect(firstSuggestion).toBeVisible();
    await expect(firstSuggestion).toContainText('Warszawa');

    // Click suggestion to initiate jump and render
    await firstSuggestion.click();

    // Verify dropdown hides immediately
    await expect(suggestionsDropdown).toBeHidden();

    // Trigger explicit 3D build per decoupled UX
    await page.locator('#btnRender3D').click();

    // Wait for render to complete for Warszawa
    const state = await waitForRenderComplete(page, 'WARSZAWA');

    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    await expect(page.locator('#gisErrorBanner')).toBeHidden();
    await expect(page.locator('#btnRender3D')).toBeEnabled();

    expect(state.totalTriangles).toBeGreaterThan(100000);

    // Verify region badge updated
    const regionBadge = page.locator('#currentRegionBadge');
    await expect(regionBadge).toContainText('Warszawa');
  });
});
