// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  TEST_LOCATIONS,
  setupConsoleHygiene,
  waitForAppReady,
  waitForRenderComplete,
  mockPhotonPlaceSearch,
  captureAndInspectScreenshot,
  assertWebGLCanvasNotBlank,
} = require('./test_utils');

const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

test.describe('Tier 4: Uncached Live Locations, Visual Verification & Explicit Render UX', () => {
  /** @type {ReturnType<typeof setupConsoleHygiene>} */
  let hygiene;

  test.beforeAll(() => {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
  });

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
  // Test 4.V1: Explicit Render UX Decoupling
  // --------------------------------------------------------------------------
  test('4.V1 Explicit Render UX: parameter mutations update 2D map & UI without auto-rebuilding 3D until Render clicked', async ({ page }) => {
    test.setTimeout(90000);

    // Mock photon autocomplete for Cape Town
    await mockPhotonPlaceSearch(page, 'Cape Town', [
      {
        name: 'Cape Town',
        city: 'Cape Town',
        state: 'Western Cape',
        country: 'South Africa',
        lat: -33.9249,
        lon: 18.4241,
      },
    ]);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // Verify #btnRender3D is visible and functions as the Render trigger
    const renderBtn = page.locator('#btnRender3D');
    await expect(renderBtn).toBeVisible();
    const btnText = ((await renderBtn.textContent()) || '').trim();
    expect(btnText).toBe('Render');

    // On fresh boot, clean empty frame (<=12 initial bed slab triangles) waiting for explicit Render
    const initialTriangles = await page.evaluate(() => window.__map3d?.state?.totalTriangles || 0);
    expect(initialTriangles).toBeLessThanOrEqual(12);

    // 1. Mutate 2D Map parameters without triggering unprompted 3D rebuild
    const mapPill = page.locator('#mapStatusPill');
    await expect(mapPill).toBeVisible();

    // 2. Adjust Kadr (span presets) updates label and 2D state
    const spanChip = page.locator('button[data-span-km="2.5"]');
    await expect(spanChip).toBeVisible();
    await spanChip.click();
    await expect(page.locator('#cropSizeLabel')).toContainText('2.50 km');

    // 3. Adjust Area Rotation
    const rotChip = page.locator('button[data-rot-deg="45"]');
    await expect(rotChip).toBeVisible();
    await rotChip.click();
    await expect(page.locator('#mapRotationLabel')).toContainText('45°');

    // 4. Adjust Frame Dimensions (e.g. 40x50 or 50x50)
    const chipFrame = page.locator('button[data-frame-size="40x50"]');
    await expect(chipFrame).toBeVisible();
    await chipFrame.click();
    expect(await page.locator('#targetWidthCmInput').inputValue()).toBe('40');
    expect(await page.locator('#targetHeightCmInput').inputValue()).toBe('50');

    // 5. 2D Map Zoom controls
    const zoomInBtn = page.locator('#btnZoomIn2D');
    await expect(zoomInBtn).toBeVisible();
    await zoomInBtn.click();

    // Verify explicit decoupling: parameter adjustments did NOT trigger 3D rebuild
    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    expect(await page.locator('#loadingOverlay3D').isVisible()).toBe(false);
    const preRenderTriangles = await page.evaluate(() => window.__map3d?.state?.totalTriangles || 0);
    expect(preRenderTriangles).toBe(initialTriangles);
    expect(preRenderTriangles).toBeLessThanOrEqual(12);

    // 6. Explicitly clicking #btnRender3D initiates the 3D build
    await renderBtn.click();

    // Await completion of explicit render
    await waitForRenderComplete(page);
    const finalTriangles = await page.evaluate(() => window.__map3d?.state?.totalTriangles || 0);
    expect(finalTriangles).toBeGreaterThan(0);
    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
  });

  // --------------------------------------------------------------------------
  // Test 4.V2: Expanded Scale & Dimensions
  // --------------------------------------------------------------------------
  test('4.V2 Expanded Scale: crop slider range, quick span chips, frame dimension limits, and grid calculation', async ({ page }) => {
    test.setTimeout(60000);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // 1. Verify crop slider range supports expansive area coverage up to 50 km
    const slider = page.locator('#cropSizeSlider');
    await expect(slider).toBeVisible();
    const minVal = parseFloat((await slider.getAttribute('min')) || '0.4');
    expect(minVal).toBeLessThanOrEqual(0.4);
    const maxVal = parseFloat((await slider.getAttribute('max')) || '12.0');
    expect(maxVal).toBeGreaterThanOrEqual(50.0);

    // 2. Verify span preset chips exist and operate cleanly (including 25km and 50km chips)
    const chip50k = page.locator('button[data-span-km="50.0"], button[data-span-km="50"]');
    await expect(chip50k).toBeVisible();
    await chip50k.click();
    await expect(page.locator('#cropSizeLabel')).toContainText('50.00 km');
    const span50M = await page.evaluate(() => window.__map3d.state.mapSpanMeters);
    expect(span50M).toBe(50000);

    const chip25k = page.locator('button[data-span-km="25.0"], button[data-span-km="25"]');
    await expect(chip25k).toBeVisible();
    await chip25k.click();
    await expect(page.locator('#cropSizeLabel')).toContainText('25.00 km');
    const span25M = await page.evaluate(() => window.__map3d.state.mapSpanMeters);
    expect(span25M).toBe(25000);

    const chip12k = page.locator('button[data-span-km="12.0"], button[data-span-km="12"]');
    await expect(chip12k).toBeVisible();
    await chip12k.click();
    await expect(page.locator('#cropSizeLabel')).toContainText('12.00 km');
    const span12M = await page.evaluate(() => window.__map3d.state.mapSpanMeters);
    expect(span12M).toBe(12000);

    // 3. Verify width and height inputs allow expansive frame sizes (up to 150 cm)
    const widthInput = page.locator('#targetWidthCmInput');
    const heightInput = page.locator('#targetHeightCmInput');
    await expect(widthInput).toBeVisible();
    await expect(heightInput).toBeVisible();
    expect(Number(await widthInput.getAttribute('min'))).toBeLessThanOrEqual(8);
    expect(Number(await widthInput.getAttribute('max'))).toBeGreaterThanOrEqual(150);
    expect(Number(await heightInput.getAttribute('max'))).toBeGreaterThanOrEqual(150);

    // 4. Verify frame size chips update dimensions (including 50x100 panoramic chip)
    const chip50x100 = page.locator('button[data-frame-size="50x100"]');
    await expect(chip50x100).toBeVisible();
    await chip50x100.click();
    expect(await widthInput.inputValue()).toBe('50');
    expect(await heightInput.inputValue()).toBe('100');

    const chip50x70 = page.locator('button[data-frame-size="50x70"]');
    await expect(chip50x70).toBeVisible();
    await chip50x70.click();
    expect(await widthInput.inputValue()).toBe('50');
    expect(await heightInput.inputValue()).toBe('70');

    // 5. Verify Photon Mono 4 auto-grid calculation badge updates
    const badge = page.locator('#mono4GridBadge');
    await expect(badge).toBeVisible();
    expect(await badge.textContent()).toContain('Mono 4:');
  });

  // --------------------------------------------------------------------------
  // Test 4.V3: Detail Controls & Scale Adaptation
  // --------------------------------------------------------------------------
  test('4.V3 LoD Detail Controls: detail filtering and scale-adaptive geometry stability at large spans', async ({ page }) => {
    test.setTimeout(90000);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // 1. Unconditionally assert visible LoD detail controls in the DOM
    const lodPanel = page.locator('#lodFilterPanel');
    await expect(lodPanel).toBeVisible();
    const minBuildingSlider = page.locator('#lodMinBuildingSizeSlider');
    const enableTreesCheck = page.locator('#lodEnableTreesCheck');
    const treeThresholdSlider = page.locator('#lodTreeThresholdSlider');
    const roadDetailSelect = page.locator('#lodRoadDetailSelect');
    const lodStatusBadge = page.locator('#lodStatusBadge');

    await expect(minBuildingSlider).toBeVisible();
    await expect(enableTreesCheck).toBeVisible();
    await expect(treeThresholdSlider).toBeVisible();
    await expect(roadDetailSelect).toBeVisible();
    await expect(lodStatusBadge).toBeVisible();

    // 2. Test user overrides and persistence in state
    await minBuildingSlider.fill('20');
    await minBuildingSlider.dispatchEvent('input');
    await expect(page.locator('#lodMinBuildingSizeLabel')).toHaveText('20 m');
    const stateMinFootprint = await page.evaluate(() => window.__map3d.state.lodSettings?.minBuildingFootprintM);
    const stateMinMeters = await page.evaluate(() => window.__map3d.state.lodSettings?.minBuildingMeters);
    expect(stateMinFootprint).toBe(20);
    expect(stateMinMeters).toBe(20);

    await enableTreesCheck.uncheck();
    const stateTrees = await page.evaluate(() => window.__map3d.state.lodSettings?.enableTrees);
    expect(stateTrees).toBe(false);
    await expect(page.locator('#lodTreesStateBadge')).toHaveText('Wyłączone');

    // Re-enable trees
    await enableTreesCheck.check();
    const stateTreesReenabled = await page.evaluate(() => window.__map3d.state.lodSettings?.enableTrees);
    expect(stateTreesReenabled).toBe(true);

    await roadDetailSelect.selectOption('major');
    const stateRoads = await page.evaluate(() => window.__map3d.state.lodSettings?.roadDetail);
    expect(stateRoads).toBe('major');

    // 3. Test scale adaptation: set expansive span (25 km)
    await page.evaluate(() => {
      window.__map3d.state.mapSpanMeters = 25000;
      if (typeof window.__map3d.draw2DMap === 'function') window.__map3d.draw2DMap();
      if (typeof window.updateLodTreeBadge === 'function') window.updateLodTreeBadge();
    });

    // 4. Verify memory and state stability at large span
    const spanM = await page.evaluate(() => window.__map3d.state.mapSpanMeters);
    expect(spanM).toBe(25000);

    // Verify heap remains bounded under 450 MB if exposed
    const heapUsed = await page.evaluate(() => {
      const perf = /** @type {any} */ (window.performance);
      return perf && perf.memory ? perf.memory.usedJSHeapSize : 0;
    });
    if (heapUsed > 0) {
      expect(heapUsed).toBeLessThan(450 * 1024 * 1024);
    }
  });

  // --------------------------------------------------------------------------
  // Test 4.V4: Clean 3D Viewport Interaction
  // --------------------------------------------------------------------------
  test('4.V4 Clean Viewport: orbit navigation operates smoothly without obstructive tooltips or interaction errors', async ({ page }) => {
    test.setTimeout(60000);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await waitForRenderComplete(page);

    // 1. Explicit negative assertions: clean viewport must have NO inspector card or lingering elements
    expect(await page.locator('#buildingInspectorCard').count()).toBe(0);
    expect(await page.locator('#buildingInspectorEmpty').count()).toBe(0);
    expect(await page.locator('#buildingInspectorContent').count()).toBe(0);
    expect(await page.locator('#buildingInspectorPanel').count()).toBe(0);
    expect(await page.locator('#highlightedCountBadge').count()).toBe(0);
    expect(await page.locator('text=Inspektor Budynku').count()).toBe(0);
    expect(await page.textContent('body')).not.toContain('Inspektor Budynku');

    // 2. Verify canvas container
    const canvas = page.locator('#view3dCanvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();

    // 3. Verify hover tooltip is not obstructing
    const tooltip = page.locator('#hoverTooltip');
    if (await tooltip.count() > 0) {
      await expect(tooltip).toBeHidden();
    }

    // 4. Test clean click on 3D canvas does not throw
    if (box) {
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    }

    // 5. Test orbit navigation drag and wheel zoom
    const startYaw = await page.evaluate(() => window.__map3d?.studio?.camera?.yaw || 0);
    const startDist = await page.evaluate(() => window.__map3d?.studio?.camera?.distance || 0);

    // Test mouse wheel zoom
    await canvas.dispatchEvent('wheel', { deltaY: 50 });
    const midDist = await page.evaluate(() => window.__map3d?.studio?.camera?.distance || 0);
    expect(midDist).not.toBe(startDist);

    // Test orbit rotation via mouse events
    await canvas.dispatchEvent('mousedown', { clientX: 300, clientY: 300, button: 0 });
    await page.evaluate(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 360, clientY: 280 }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 360, clientY: 280 }));
    });
    const endYaw = await page.evaluate(() => window.__map3d?.studio?.camera?.yaw || 0);
    expect(endYaw).not.toBe(startYaw);
  });

  // --------------------------------------------------------------------------
  // Test 4.V5: Color Palette Verification
  // --------------------------------------------------------------------------
  test('4.V5 Palette System: Pure Architectural White palette configuration and layer colors', async ({ page }) => {
    test.setTimeout(60000);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // 1. Unconditionally assert initial boot defaults without any state mutations or button clicks
    const bootPalette = await page.evaluate(() => window.__map3d?.state?.activePalette);
    expect(bootPalette).toBe('white');

    const bootColors = await page.evaluate(() => window.__map3d?.state?.colors);
    expect(bootColors.buildings.toLowerCase()).toBe('#ffffff');
    expect(bootColors.base.toLowerCase()).toBe('#f4f5f7');

    // 2. Verify white palette exists in PALETTES definition
    const whiteDef = await page.evaluate(() => {
      const list = (typeof PALETTES !== 'undefined' ? PALETTES : (window.__map3d?.PALETTES || []));
      const p = list.find(x => x.id === 'white');
      return p ? { id: p.id, name: p.name, buildings: p.colors?.buildings, base: p.colors?.base } : null;
    });
    expect(whiteDef).toBeTruthy();
    expect(whiteDef?.id).toBe('white');
    expect(whiteDef?.buildings.toLowerCase()).toBe('#ffffff');
    expect(whiteDef?.base.toLowerCase()).toBe('#f4f5f7');

    // 3. Verify palette UI rendered in paletteButtonsContainer with Pure Architectural White
    const paletteButtons = page.locator('#paletteButtonsContainer button');
    await expect(paletteButtons.first()).toBeVisible();
    await expect(paletteButtons.first()).toContainText('Pure Architectural White');
  });

  // --------------------------------------------------------------------------
  // Test 4.V6: Uncached Live GIS (Cape Town)
  // --------------------------------------------------------------------------
  test('4.V6 Uncached Live GIS: Cape Town progressive streaming completes without 20s timeout or freeze', async ({ page }) => {
    test.setTimeout(120000);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // Cape Town uncached coordinates (bypass 1.5km proximity cache)
    const ctBbox = [-33.930, 18.415, -33.920, 18.435];
    const ctCenter = [-33.9249, 18.4241];

    // Trigger Cape Town fetch
    await page.evaluate(({ bbox, center }) => {
      window.__map3d.state.mapCenterLat = center[0];
      window.__map3d.state.mapCenterLon = center[1];
      window.__map3d.state.plaqueText = 'CAPE TOWN';
      window.__map3d.fetchRealGISAndRender(bbox, 'CAPE TOWN');
    }, { bbox: ctBbox, center: ctCenter });

    // Capture progressive streaming screenshot while loading overlay is active
    await page.waitForTimeout(400);
    const ctProg = await captureAndInspectScreenshot(page, null, '05_capetown_progressive.png', { minBytes: 15000 });
    expect(ctProg.size).toBeGreaterThan(15000);

    // Await render completion (ensuring watchdog resets on progress without 20s killswitch)
    const result = await waitForRenderComplete(page, 'CAPE TOWN', 90000);
    expect(result.totalTriangles).toBeGreaterThan(0);

    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    const bannerVisible = await page.locator('#gisErrorBanner').isVisible();
    if (bannerVisible) {
      const bannerText = (await page.locator('#gisErrorText').textContent()) || '';
      expect(bannerText).toContain('Załadowano model terenu DEM');
    }
    await expect(page.locator('#btnRender3D')).toBeEnabled();

    // Capture final completion screenshot
    const ctComplete = await captureAndInspectScreenshot(page, null, '05_capetown_complete.png', { minBytes: 15000 });
    expect(ctComplete.size).toBeGreaterThan(15000);

    // Verify WebGL Canvas pixel diversity via gl.readPixels
    await assertWebGLCanvasNotBlank(page);
  });

  // --------------------------------------------------------------------------
  // Test 4.V7: Visual Verification & Staged Screenshot Capture
  // --------------------------------------------------------------------------
  test('4.V7 Visual Verification: progressive screenshots captured to tests/e2e/screenshots/ and validated', async ({ page }) => {
    test.setTimeout(90000);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // Stage 1: Initial bootstrap screenshot
    const s1Page = await captureAndInspectScreenshot(page, null, '01_bootstrap_initial.png', { minBytes: 15000 });
    const s1Canvas = await captureAndInspectScreenshot(page, page.locator('#view3dCanvas'), '01_bootstrap_canvas.png', { minBytes: 10000 });
    expect(s1Page.size).toBeGreaterThan(15000);
    expect(s1Canvas.size).toBeGreaterThan(10000);

    // Stage 2: Parameter adjustment visual state
    const spanBtn = page.locator('button[data-span-km="2.5"]');
    await expect(spanBtn).toBeVisible();
    await spanBtn.click();
    const rotBtn = page.locator('button[data-rot-deg="45"]');
    await expect(rotBtn).toBeVisible();
    await rotBtn.click();

    const s2Page = await captureAndInspectScreenshot(page, null, '02_parameters_decoupled.png', { minBytes: 15000 });
    expect(s2Page.size).toBeGreaterThan(15000);

    // Stage 3: Progressive streaming during render
    const warsaw = TEST_LOCATIONS.WARSAW;
    await page.evaluate(({ bbox, title }) => {
      window.__map3d.fetchRealGISAndRender(bbox, title);
    }, { bbox: warsaw.bbox, title: warsaw.title });

    // Capture progressive state while overlay is active
    await page.waitForTimeout(300);
    const s3Progressive = await captureAndInspectScreenshot(page, null, '03_progressive_streaming.png', { minBytes: 15000 });
    expect(s3Progressive.size).toBeGreaterThan(15000);

    // Stage 4: Render complete
    await waitForRenderComplete(page, warsaw.titleMatch);

    const s4Canvas = await captureAndInspectScreenshot(page, page.locator('#view3dCanvas'), '04_render_canvas.png', { minBytes: 10000 });
    const s4Complete = await captureAndInspectScreenshot(page, null, '04_render_complete.png', { minBytes: 15000 });

    expect(s4Canvas.size).toBeGreaterThan(10000);
    expect(s4Complete.size).toBeGreaterThan(15000);

    // Verify WebGL Canvas pixel diversity via gl.readPixels
    await assertWebGLCanvasNotBlank(page);
  });
});
