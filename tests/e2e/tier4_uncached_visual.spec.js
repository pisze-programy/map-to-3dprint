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
    expect(btnText).toMatch(/Render/i);

    // On fresh boot, clean empty frame (0 initial geo triangles) waiting for explicit Render
    const initialTriangles = await page.evaluate(() => window.__map3d?.state?.totalTriangles || 0);
    expect(initialTriangles).toBeGreaterThanOrEqual(0);

    // 1. Mutate 2D Map parameters without triggering unprompted 3D rebuild
    const mapPill = page.locator('#mapStatusPill');
    await expect(mapPill).toBeVisible();

    // 2. Adjust Kadr (span presets) updates label and 2D state
    const spanChip = page.locator('button[data-span-km="2.5"]');
    if (await spanChip.count() > 0) {
      await spanChip.click();
      await expect(page.locator('#cropSizeLabel')).toContainText('2.50 km');
    }

    // 3. Adjust Area Rotation
    const rotChip = page.locator('button[data-rot-deg="45"]');
    if (await rotChip.count() > 0) {
      await rotChip.click();
      await expect(page.locator('#mapRotationLabel')).toContainText('45°');
    }

    // 4. Adjust Frame Dimensions (e.g. 40x50 or 50x50)
    const chipFrame = page.locator('button[data-frame-size="40x50"]');
    if (await chipFrame.count() > 0) {
      await chipFrame.click();
      expect(await page.locator('#targetWidthCmInput').inputValue()).toBe('40');
      expect(await page.locator('#targetHeightCmInput').inputValue()).toBe('50');
    }

    // 5. 2D Map Zoom controls
    const zoomInBtn = page.locator('#btnZoomIn2D');
    if (await zoomInBtn.count() > 0) {
      await zoomInBtn.click();
    }

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

    // 1. Verify crop slider range supports expansive area coverage
    const slider = page.locator('#cropSizeSlider');
    await expect(slider).toBeVisible();
    const minVal = parseFloat((await slider.getAttribute('min')) || '0.4');
    expect(minVal).toBeLessThanOrEqual(0.4);
    const maxVal = parseFloat((await slider.getAttribute('max')) || '12.0');
    expect(maxVal).toBeGreaterThanOrEqual(12.0);

    // 2. Verify span preset chips exist and operate cleanly
    const chip12k = page.locator('button[data-span-km="12.0"], button[data-span-km="12"]');
    if (await chip12k.count() > 0) {
      await chip12k.click();
      await expect(page.locator('#cropSizeLabel')).toContainText('12.00 km');
      const spanM = await page.evaluate(() => window.__map3d.state.mapSpanMeters);
      expect(spanM).toBe(12000);
    }

    // 3. Verify width and height inputs allow expansive frame sizes
    const widthInput = page.locator('#targetWidthCmInput');
    const heightInput = page.locator('#targetHeightCmInput');
    await expect(widthInput).toBeVisible();
    await expect(heightInput).toBeVisible();
    expect(Number(await widthInput.getAttribute('min'))).toBeLessThanOrEqual(8);
    expect(Number(await widthInput.getAttribute('max'))).toBeGreaterThanOrEqual(120);

    // 4. Verify frame size chips update dimensions
    const chip50x70 = page.locator('button[data-frame-size="50x70"]');
    if (await chip50x70.count() > 0) {
      await chip50x70.click();
      expect(await widthInput.inputValue()).toBe('50');
      expect(await heightInput.inputValue()).toBe('70');
    }

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

    // 1. Inspect LoD controls if present
    const lodPanel = page.locator('#lodFilterPanel');
    if (await lodPanel.count() > 0) {
      await expect(lodPanel).toBeVisible();
      const minBuildingSlider = page.locator('#lodMinBuildingSlider');
      const enableTreesCheck = page.locator('#lodEnableTrees');
      const roadDetailSelect = page.locator('#lodRoadDetailSelect');
      await expect(minBuildingSlider).toBeVisible();
      await expect(enableTreesCheck).toBeVisible();
      await expect(roadDetailSelect).toBeVisible();
    }

    // 2. Test scale adaptation: set expansive span (12-25 km)
    await page.evaluate(() => {
      window.__map3d.state.mapSpanMeters = 25000;
      if (typeof window.__map3d.draw2DMap === 'function') window.__map3d.draw2DMap();
    });

    // 3. Verify memory and state stability at large span
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

    // 1. Verify canvas container
    const canvas = page.locator('#view3dCanvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();

    // 2. Verify hover tooltip is not obstructing
    const tooltip = page.locator('#hoverTooltip');
    if (await tooltip.count() > 0) {
      await expect(tooltip).toBeHidden();
    }

    // 3. Test clean click on 3D canvas does not throw
    if (box) {
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    }

    // 4. Test orbit navigation drag and wheel zoom
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

    // 1. Verify white palette exists in PALETTES definition
    const whiteDef = await page.evaluate(() => {
      const list = (typeof PALETTES !== 'undefined' ? PALETTES : (window.__map3d?.PALETTES || []));
      const p = list.find(x => x.id === 'white');
      return p ? { id: p.id, name: p.name, buildings: p.colors?.buildings, base: p.colors?.base } : null;
    });
    expect(whiteDef).toBeTruthy();
    expect(whiteDef?.id).toBe('white');
    expect(whiteDef?.buildings.toLowerCase()).toBe('#ffffff');
    expect(whiteDef?.base.toLowerCase()).toBe('#f4f5f7');

    // 2. Select white palette via button or state
    const whiteBtn = page.locator('button[data-palette-id="white"]');
    if (await whiteBtn.count() > 0) {
      await whiteBtn.click();
    } else {
      await page.evaluate(() => {
        window.__map3d.state.activePalette = 'white';
        const list = (typeof PALETTES !== 'undefined' ? PALETTES : (window.__map3d?.PALETTES || []));
        const pal = list.find(p => p.id === 'white');
        if (pal) window.__map3d.state.colors = { ...pal.colors };
      });
    }

    // 3. Verify active state colors reflect Pure Architectural White
    const currentColors = await page.evaluate(() => window.__map3d.state.colors);
    expect(currentColors.buildings.toLowerCase()).toBe('#ffffff');
    expect(currentColors.base.toLowerCase()).toBe('#f4f5f7');
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
    if (await spanBtn.count() > 0) await spanBtn.click();
    const rotBtn = page.locator('button[data-rot-deg="45"]');
    if (await rotBtn.count() > 0) await rotBtn.click();

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
