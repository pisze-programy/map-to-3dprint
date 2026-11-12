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
  setupLivePhotonWithFallback,
  captureAndInspectScreenshot,
  assertWebGLCanvasNotBlank,
  assertWebGL3DShadingDiversity,
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
    test.setTimeout(120000);

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

    // Await completion of explicit render (strictly rejects #gisErrorBanner & DEM fallback)
    const renderResult = await waitForRenderComplete(page, '', 90000);
    expect(renderResult.totalTriangles).toBeGreaterThan(3000);
    expect(renderResult.isFallback).toBe(false);
    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    await expect(page.locator('#gisErrorBanner')).toBeHidden();
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
  // Test 4.V5: Color Palette Verification & Fast Zero-Rebuild Recolor (Round 2)
  // --------------------------------------------------------------------------
  test('4.V5 Palette System: Pure Architectural White achromatic water, 5 swatches, and zero-rebuild fast recolor', async ({ page }) => {
    test.setTimeout(90000);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // 1. Unconditionally assert initial boot defaults without any state mutations or button clicks
    const bootPalette = await page.evaluate(() => window.__map3d?.state?.activePalette);
    expect(bootPalette).toBe('white');

    const bootColors = await page.evaluate(() => window.__map3d?.state?.colors);
    expect(bootColors.water.toLowerCase()).toBe('#f6f6f6');
    expect(bootColors.base.toLowerCase()).toBe('#f4f5f7');
    expect(bootColors.greenery.toLowerCase()).toBe('#f2f2f2');
    expect(bootColors.roads.toLowerCase()).toBe('#fafafa');
    expect(bootColors.buildings.toLowerCase()).toBe('#ffffff');
    expect('highlighted' in bootColors).toBe(false);

    // 2. Verify white palette exists in PALETTES definition with 5 keys (no legacy blue water or highlighted swatch)
    const whiteDef = await page.evaluate(() => {
      const list = (typeof PALETTES !== 'undefined' ? PALETTES : (window.__map3d?.PALETTES || []));
      const p = list.find(x => x.id === 'white');
      return p ? { id: p.id, name: p.name, colors: p.colors } : null;
    });
    expect(whiteDef).toBeTruthy();
    expect(whiteDef?.id).toBe('white');
    expect(whiteDef?.colors?.water.toLowerCase()).toBe('#f6f6f6');
    expect(whiteDef?.colors?.buildings.toLowerCase()).toBe('#ffffff');
    expect(whiteDef?.colors?.base.toLowerCase()).toBe('#f4f5f7');
    expect('highlighted' in (whiteDef?.colors || {})).toBe(false);

    // 3. Verify every palette button in paletteButtonsContainer renders exactly 5 swatches (no 6th highlighted swatch)
    const paletteButtons = page.locator('#paletteButtonsContainer button');
    await expect(paletteButtons.first()).toBeVisible();
    await expect(paletteButtons.first()).toContainText('Pure Architectural White');
    const swatchCounts = await paletteButtons.evaluateAll(btns =>
      btns.map(b => b.querySelectorAll('span').length)
    );
    expect(swatchCounts.length).toBeGreaterThanOrEqual(5);
    for (const c of swatchCounts) {
      expect(c).toBe(5);
    }

    // 4. Render cached scene under Pure Architectural White & verify WebGL pixels have zero blue water tint
    await page.locator('#btnRender3D').click();
    await waitForRenderComplete(page);

    const achromaticCheck = await page.evaluate(() => {
      const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('view3dCanvas'));
      const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'));
      if (!canvas || !gl) return { ok: false, maxBlueExcess: 999, avgAbsRB: 999 };
      if (window.__map3d?.studio?.render) window.__map3d.studio.render(true);
      const w = 160, h = 160;
      const x0 = Math.max(0, Math.floor((canvas.width - w) / 2));
      const y0 = Math.max(0, Math.floor((canvas.height - h) / 2));
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let sumAbsRB = 0;
      let blueTintedPixels = 0;
      const total = w * h;
      for (let i = 0; i < buf.length; i += 4) {
        const r = buf[i], b = buf[i + 2];
        sumAbsRB += Math.abs(r - b);
        if (b - r > 12) blueTintedPixels++;
      }
      return {
        ok: true,
        avgAbsRB: Number((sumAbsRB / total).toFixed(2)),
        blueTintedRatio: blueTintedPixels / total,
      };
    });
    expect(achromaticCheck.ok).toBe(true);
    expect(achromaticCheck.avgAbsRB).toBeLessThan(4.0);
    expect(achromaticCheck.blueTintedRatio).toBeLessThan(0.01);

    // 5. Rapid color picker scrub + palette switch must recolor via uniforms WITHOUT calling rebuildModel3D
    const recolorPerf = await page.evaluate(async () => {
      const state = window.__map3d.state;
      const prevLayerMeshes = state.layerMeshes;
      const overlay = document.getElementById('loadingOverlay3D');
      let overlayBecameVisible = false;

      const t0 = performance.now();
      const waterInp = /** @type {HTMLInputElement | null} */ (document.querySelector('input[data-layer-col="water"]'));
      const bldInp = /** @type {HTMLInputElement | null} */ (document.querySelector('input[data-layer-col="buildings"]'));
      if (!waterInp || !bldInp) throw new Error('Missing layer color inputs');

      for (let i = 0; i < 25; i++) {
        const hex = '#' + (0x20 + i * 4).toString(16).padStart(2, '0') + '77cc';
        waterInp.value = hex;
        waterInp.dispatchEvent(new Event('input', { bubbles: true }));
        bldInp.value = '#' + (0xd0 + (i % 20)).toString(16).padStart(2, '0') + 'e0f0';
        bldInp.dispatchEvent(new Event('input', { bubbles: true }));
        if (overlay && !overlay.classList.contains('hidden')) overlayBecameVisible = true;
      }

      // Switch to nordic_dark and back to white via real palette buttons
      const nordicBtn = /** @type {HTMLButtonElement | null} */ (document.querySelector('#paletteButtonsContainer button[data-palette-id="nordic_dark"]'));
      const whiteBtn = /** @type {HTMLButtonElement | null} */ (document.querySelector('#paletteButtonsContainer button[data-palette-id="white"]'));
      if (nordicBtn) nordicBtn.click();
      if (whiteBtn) whiteBtn.click();

      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const elapsedMs = performance.now() - t0;
      return {
        sameMeshIdentity: state.layerMeshes === prevLayerMeshes,
        overlayBecameVisible,
        elapsedMs,
        finalWaterColor: state.colors.water,
      };
    });

    expect(recolorPerf.sameMeshIdentity, 'Color scrubbing & palette switching must NOT rebuild geometry').toBe(true);
    expect(recolorPerf.overlayBecameVisible).toBe(false);
    expect(recolorPerf.elapsedMs).toBeLessThan(1500);
    expect(recolorPerf.finalWaterColor.toLowerCase()).toBe('#f6f6f6');
  });

  // --------------------------------------------------------------------------
  // Test 4.V6: Uncached Live GIS via Real UI (2.5 km + Render, Zero Fallback Loophole)
  // --------------------------------------------------------------------------
  test('4.V6 Uncached Live GIS: Cape Town 2.5 km UI render completes with real 3D buildings and zero DEM fallback banner', async ({ page }) => {
    test.setTimeout(150000);

    // Disable local cache/osm_*.json proxy route so this test runs 100% live against Overpass
    await page.unroute('**/*interpreter*').catch(() => {});

    await setupLivePhotonWithFallback(page, [
      {
        query: 'Cape Town',
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

    // Drive 100% via real UI controls (no window.__map3d.fetchRealGISAndRender shortcut!)
    const searchInput = page.locator('#placeSearchInput');
    await searchInput.click();
    await searchInput.fill('');
    await searchInput.pressSequentially('Cape Town', { delay: 30 });

    const dropdown = page.locator('#searchSuggestionsDropdown');
    await expect(dropdown).toBeVisible({ timeout: 8000 });

    const suggestionButtons = dropdown.locator('button');
    const count = await suggestionButtons.count();
    expect(count).toBeGreaterThan(0);

    let clicked = false;
    for (let i = 0; i < count; i++) {
      const txt = (await suggestionButtons.nth(i).textContent()) || '';
      if (txt.includes('-33.') || /South Africa|Cape Town/i.test(txt)) {
        await suggestionButtons.nth(i).click();
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      await suggestionButtons.first().click();
    }
    await expect(dropdown).toBeHidden();

    // Select 2.5 km span chip in UI
    const span25Btn = page.locator('button[data-span-km="2.5"]');
    await expect(span25Btn).toBeVisible();
    await span25Btn.click();
    await expect(page.locator('#cropSizeLabel')).toContainText('2.50 km');

    // Click Render (#btnRender3D) like a real user
    const renderBtn = page.locator('#btnRender3D');
    await expect(renderBtn).toBeEnabled();
    await renderBtn.click();

    // Capture progressive streaming screenshot while loading overlay is active
    await expect(page.locator('#loadingOverlay3D')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(300);
    const ctProg = await captureAndInspectScreenshot(page, null, '05_capetown_progressive.png', { minBytes: 15000 });
    expect(ctProg.size).toBeGreaterThan(15000);

    // Await render completion — strictly rejects #gisErrorBanner AND 0-building DEM fallback!
    const result = await waitForRenderComplete(page, 'CAPE TOWN', 120000);

    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    await expect(page.locator('#gisErrorBanner')).toBeHidden();
    await expect(renderBtn).toBeEnabled();

    expect(result.isFallback).toBe(false);
    expect(result.buildingCount).toBeGreaterThanOrEqual(30);
    expect(result.totalTriangles).toBeGreaterThan(3000);

    // Capture final completion screenshot
    const ctComplete = await captureAndInspectScreenshot(page, null, '05_capetown_complete.png', { minBytes: 15000 });
    expect(ctComplete.size).toBeGreaterThan(15000);

    // Verify WebGL Canvas pixel & 3D shading diversity via gl.readPixels
    await assertWebGLCanvasNotBlank(page);
    await assertWebGL3DShadingDiversity(page);
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

  // --------------------------------------------------------------------------
  // Test 4.V8: Round 2 Tile Explode (Rozsuń) & Rotated Frame 1:1 Scale Parity
  // --------------------------------------------------------------------------
  test('4.V8 Round 2 Geometry Parity: 2x2 Tile Explode (Rozsuń) & +45° rotated frame preserve manifold & 1:1 scale', async ({ page }) => {
    test.setTimeout(90000);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // Select 2x2 tile grid & +45° rotation via UI controls, then click Render
    await page.locator('#tileGridSelect').selectOption('2x2');
    await page.locator('button[data-rot-deg="45"]').click();
    await expect(page.locator('#mapRotationLabel')).toContainText('45°');

    await page.locator('#btnRender3D').click();
    const res = await waitForRenderComplete(page);
    expect(res.totalTriangles).toBeGreaterThan(30000);

    // Verify 1:1 physical envelope regardless of 45° rotation (no 1.25x shrinkage) AND 0 overhanging triangles across 2x2 tile split planes
    const scaleCheck = await page.evaluate(() => {
      const st = window.__map3d.state;
      const baseMesh = st.layerMeshes?.base || [];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      if (Array.isArray(baseMesh)) {
        for (let i = 0; i < baseMesh.length; i++) {
          const tri = baseMesh[i];
          const pts = [tri.v0, tri.v1, tri.v2];
          for (let j = 0; j < 3; j++) {
            const p = pts[j];
            if (!p) continue;
            if (p[0] < minX) minX = p[0];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[1] > maxY) maxY = p[1];
          }
        }
      }

      // Check every printable layer triangle against 2x2 split planes (x = 0, y = 0)
      let overhangingTris = 0;
      const printableKeys = ['water', 'base', 'greenery', 'roads', 'buildings'];
      for (const k of printableKeys) {
        const arr = st.layerMeshes?.[k] || [];
        for (let i = 0; i < arr.length; i++) {
          const t = arr[i];
          if (!t || !t.v0 || !t.v1 || !t.v2) continue;
          const txMin = Math.min(t.v0[0], t.v1[0], t.v2[0]);
          const txMax = Math.max(t.v0[0], t.v1[0], t.v2[0]);
          const tyMin = Math.min(t.v0[1], t.v1[1], t.v2[1]);
          const tyMax = Math.max(t.v0[1], t.v1[1], t.v2[1]);
          if ((txMin < -0.05 && txMax > 0.05) || (tyMin < -0.05 && tyMax > 0.05)) {
            overhangingTris++;
          }
        }
      }

      const sc = st.sceneData || {};
      const mToU = sc.metersToUnits || 0;
      const expectedMToU = sc.spanMeters ? (169.2 / sc.spanMeters) : mToU;
      return {
        spanX: Number((maxX - minX).toFixed(2)),
        spanY: Number((maxY - minY).toFixed(2)),
        overhangingTris,
        mToUDiff: Math.abs(mToU - expectedMToU),
        preflightText: document.getElementById('preflightStatusBadge')?.textContent || '',
      };
    });
    // Full unexploded 1:1 model envelope is ~169.2 world units on both axes even at +45°
    expect(scaleCheck.spanX).toBeGreaterThan(165);
    expect(scaleCheck.spanX).toBeLessThan(174);
    expect(scaleCheck.spanY).toBeGreaterThan(165);
    expect(scaleCheck.spanY).toBeLessThan(174);
    expect(scaleCheck.mToUDiff).toBeLessThan(1e-4);
    expect(scaleCheck.overhangingTris, '2x2 tile grid must have 0 triangles straddling x=0 or y=0 tile split planes').toBe(0);
    expect(scaleCheck.preflightText).toContain('Manifold ✓ (0/0)');

    // Scrub #tileExplodeSlider (Rozsuń) to 65% and capture exploded 2x2 screenshot
    const explodeSlider = page.locator('#tileExplodeSlider');
    await explodeSlider.fill('65');
    await explodeSlider.dispatchEvent('input');
    await expect(page.locator('#tileExplodeValueLabel')).toHaveText('65%');
    await page.locator('#view3dCanvas').scrollIntoViewIfNeeded();

    const sExplode = await captureAndInspectScreenshot(page, null, '06_tile_explode_2x2.png', { minBytes: 20000 });
    expect(sExplode.size).toBeGreaterThan(20000);

    await assertWebGLCanvasNotBlank(page);
    await assertWebGL3DShadingDiversity(page);
  });

  // --------------------------------------------------------------------------
  // Test 4.V9: Immediate Palette Reload Persistence & URL Param Ordering
  // --------------------------------------------------------------------------
  test('4.V9 Reload & URL Hook Hygiene: immediate reload after palette click preserves preset & URL params apply before fetch', async ({ page }) => {
    test.setTimeout(90000);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // 1. Scrub custom water color so activePalette becomes 'custom', save, then click Pure Architectural White and IMMEDIATELY reload (<50ms)
    const waterInp = page.locator('input[data-layer-col="water"]');
    await waterInp.fill('#1155aa');
    await waterInp.dispatchEvent('input');
    await page.waitForTimeout(260); // allow debounced custom color save to persist

    const whiteBtn = page.locator('#paletteButtonsContainer button[data-palette-id="white"]');
    await whiteBtn.click();
    // Immediate reload without waiting 200ms — catches debounced palette save bug!
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const palAfterReload = await page.evaluate(() => window.__map3d?.state?.activePalette);
    expect(palAfterReload).toBe('white');

    // 2. Shared URL with rot=41 & palette=nordic_dark must apply synchronous state BEFORE fetchRealGISAndRender
    const krakow = TEST_LOCATIONS.KRAKOW;
    await page.goto(
      `/?lat=${krakow.center[0]}&lon=${krakow.center[1]}&span=1.2&rot=41&palette=nordic_dark&title=${encodeURIComponent(krakow.title)}`,
      { waitUntil: 'domcontentloaded' }
    );
    await waitForRenderComplete(page, krakow.titleMatch);

    const urlHydrated = await page.evaluate(() => ({
      rot: window.__map3d?.state?.mapRotationDeg,
      palette: window.__map3d?.state?.activePalette,
    }));
    expect(urlHydrated.rot).toBe(41);
    expect(urlHydrated.palette).toBe('nordic_dark');
  });
});
