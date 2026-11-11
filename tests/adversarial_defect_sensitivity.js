// @ts-check
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function runEmpiricalHarness() {
  const isMac = process.platform === 'darwin';
  const glFlags = isMac
    ? ['--use-gl=angle', '--use-angle=metal']
    : ['--use-gl=angle', '--use-angle=swiftshader'];

  console.log('=== STARTING EMPIRICAL DEFECT SENSITIVITY TEST HARNESS ===');
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

  const results = {
    test1_auto_rebuild_sensitivity: {},
    test2_visual_blank_canvas_sensitivity: {},
    test3_controls_absence_sensitivity: {},
    test4_lingering_dom_sensitivity: {},
  };

  try {
    // =========================================================================
    // ITEM 1: Test 4.V1 Defect Sensitivity to Auto-Rebuilding on Parameter Change
    // =========================================================================
    console.log('\n--- [ITEM 1] Testing Test 4.V1 sensitivity when parameter changes auto-trigger 3D rebuild ---');
    {
      const context = await browser.newContext({ baseURL: 'http://127.0.0.1:8765' });
      const page = await context.newPage();

      // Setup Overpass mock/proxy
      await page.route('**/*interpreter*', async route => {
        const cacheDir = path.resolve(__dirname, '../cache');
        const file = path.join(cacheDir, 'osm_52.2415_21.0050_52.2525_21.0220.json');
        if (fs.existsSync(file)) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(file, 'utf8') });
        } else {
          await route.continue();
        }
      });

      // INJECT DEFECT:
      // In a buggy version of the application, clicking a span preset chip auto-triggers 3D rebuild!
      await page.addInitScript(() => {
        window.addEventListener('DOMContentLoaded', () => {
          const originalSetMapSpan = window.setMapSpanKm;
          // When span is clicked, auto-trigger 3D rebuild defect!
          document.querySelectorAll('[data-span-km]').forEach(btn => {
            btn.addEventListener('click', () => {
              console.warn('[DEFECT ACTIVE]: Auto-triggering 3D rebuild on span change!');
              if (window.__map3d && typeof window.__map3d.fetchRealGISAndRender === 'function') {
                window.__map3d.fetchRealGISAndRender([52.2415, 21.0050, 52.2525, 21.0220], 'AUTO_REBUILT_WARSAW');
              }
            });
          });
        });
      });

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__map3d && window.__map3d.state);

      // Now execute the EXACT code of Test 4.V1:
      let test1Passed = false;
      let test1Error = null;
      let autoRebuildTriggeredBeforeRenderClick = false;

      try {
        const renderBtn = page.locator('#btnRender3D');
        const btnText = ((await renderBtn.textContent()) || '').trim();
        if (!/Render/i.test(btnText)) throw new Error('Render button missing text');

        const initialTriangles = await page.evaluate(() => window.__map3d?.state?.totalTriangles || 0);

        const mapPill = page.locator('#mapStatusPill');

        // Click span chip
        const spanChip = page.locator('button[data-span-km="2.5"]');
        if (await spanChip.count() > 0) {
          await spanChip.click();
          // Wait 500ms to let the defect fire
          await page.waitForTimeout(500);
          autoRebuildTriggeredBeforeRenderClick = await page.evaluate(() => {
            const overlay = document.getElementById('loadingOverlay3D');
            const isVisible = overlay && !overlay.classList.contains('hidden') && window.getComputedStyle(overlay).display !== 'none';
            const tr = window.__map3d?.state?.totalTriangles || 0;
            return isVisible || tr > 0;
          });
        }

        const rotChip = page.locator('button[data-rot-deg="45"]');
        if (await rotChip.count() > 0) {
          await rotChip.click();
        }

        const chipFrame = page.locator('button[data-frame-size="40x50"]');
        if (await chipFrame.count() > 0) {
          await chipFrame.click();
        }

        const zoomInBtn = page.locator('#btnZoomIn2D');
        if (await zoomInBtn.count() > 0) {
          await zoomInBtn.click();
        }

        // Test 4.V1 then clicks #btnRender3D
        await renderBtn.click();

        // And waits for render complete
        await page.waitForFunction(() => {
          const overlay = document.getElementById('loadingOverlay3D');
          const isHidden = overlay && (overlay.classList.contains('hidden') || window.getComputedStyle(overlay).display === 'none');
          const tr = window.__map3d?.state?.totalTriangles || 0;
          return isHidden && tr > 0;
        }, { timeout: 30000 });

        const finalTriangles = await page.evaluate(() => window.__map3d?.state?.totalTriangles || 0);
        if (finalTriangles > 0) {
          test1Passed = true;
        }
      } catch (err) {
        test1Passed = false;
        test1Error = err.message;
      }

      results.test1_auto_rebuild_sensitivity = {
        defectInjected: 'Auto-rebuild on data-span-km button click prior to #btnRender3D click',
        autoRebuildTriggeredBeforeRenderClick,
        test4V1PassedDespiteDefect: test1Passed,
        test4V1Error: test1Error,
        verdict: test1Passed
          ? 'DEFECT SENSITIVITY FAILED: Test 4.V1 passed despite auto-rebuild defect! Oracle lacks assertion before #btnRender3D click.'
          : 'DEFECT SENSITIVITY CONFIRMED: Test 4.V1 detected the defect and failed.',
      };
      console.log('Result 1:', JSON.stringify(results.test1_auto_rebuild_sensitivity, null, 2));
      await context.close();
    }

    // =========================================================================
    // ITEM 2: Test 4.V7 Defect Sensitivity to Blank / Black / Missing Pixels
    // =========================================================================
    console.log('\n--- [ITEM 2] Testing Test 4.V7 sensitivity to blank/black frame or missing pixels ---');
    {
      const context = await browser.newContext({ baseURL: 'http://127.0.0.1:8765' });
      const page = await context.newPage();

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__map3d && window.__map3d.state);

      const { assertWebGLCanvasNotBlank, captureAndInspectScreenshot } = require('./e2e/test_utils');

      // Test Case 2A: Solid pure black canvas (gl.clearColor(0,0,0,1))
      console.log('Testing Scenario 2A: WebGL canvas renders pure black...');
      await page.evaluate(() => {
        const canvas = document.getElementById('view3dCanvas');
        if (canvas) {
          const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
          if (gl) {
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          }
        }
      });

      let scenario2AFailed = false;
      let scenario2AError = null;
      try {
        await assertWebGLCanvasNotBlank(page);
      } catch (err) {
        scenario2AFailed = true;
        scenario2AError = err.message;
      }

      // Test Case 2B: Solid uniform gray canvas (pixel diversity = 1 unique color)
      console.log('Testing Scenario 2B: Canvas renders uniform single color (zero diversity)...');
      await page.evaluate(() => {
        const canvas = document.getElementById('view3dCanvas');
        if (canvas) {
          const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
          if (gl) {
            gl.clearColor(0.5, 0.5, 0.5, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          }
        }
      });

      let scenario2BFailed = false;
      let scenario2BError = null;
      try {
        await assertWebGLCanvasNotBlank(page);
      } catch (err) {
        scenario2BFailed = true;
        scenario2BError = err.message;
      }

      results.test2_visual_blank_canvas_sensitivity = {
        scenario2A_pure_black: {
          detectedAndFailed: scenario2AFailed,
          error: scenario2AError,
        },
        scenario2B_uniform_single_color: {
          detectedAndFailed: scenario2BFailed,
          error: scenario2BError,
        },
        verdict: (scenario2AFailed && scenario2BFailed)
          ? 'DEFECT SENSITIVITY CONFIRMED: assertWebGLCanvasNotBlank detects both pure black and lack of pixel diversity.'
          : 'DEFECT SENSITIVITY FAILED: Oracle allowed blank or single-color canvas to pass.',
      };
      console.log('Result 2:', JSON.stringify(results.test2_visual_blank_canvas_sensitivity, null, 2));
      await context.close();
    }

    // =========================================================================
    // ITEM 3: 50km Span Chip and 50x100 Frame Chip Tests Defect Sensitivity
    // =========================================================================
    console.log('\n--- [ITEM 3] Testing whether existing tests fail if 50km span chip and 50x100 frame chip are absent ---');
    {
      const context = await browser.newContext({ baseURL: 'http://127.0.0.1:8765' });
      const page = await context.newPage();

      // INJECT DEFECT: Remove 50km span chip and 50x100 frame chip from the DOM
      await page.addInitScript(() => {
        window.addEventListener('DOMContentLoaded', () => {
          const chip50km = document.querySelector('button[data-span-km="50.0"], button[data-span-km="50"]');
          if (chip50km) chip50km.remove();
          const chip50x100 = document.querySelector('button[data-frame-size="50x100"]');
          if (chip50x100) chip50x100.remove();
          console.warn('[DEFECT ACTIVE]: Removed 50km span chip and 50x100 frame chip from DOM');
        });
      });

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__map3d && window.__map3d.state);

      // Verify that controls are indeed absent:
      const count50km = await page.locator('button[data-span-km="50.0"], button[data-span-km="50"]').count();
      const count50x100 = await page.locator('button[data-frame-size="50x100"]').count();

      // Now run Test 4.V2 logic:
      let test4V2Passed = false;
      let test4V2Error = null;
      try {
        const slider = page.locator('#cropSizeSlider');
        const minVal = parseFloat((await slider.getAttribute('min')) || '0.4');
        const maxVal = parseFloat((await slider.getAttribute('max')) || '12.0');
        if (minVal > 0.4 || maxVal < 12.0) throw new Error('Slider range check failed');

        const chip12k = page.locator('button[data-span-km="12.0"], button[data-span-km="12"]');
        if (await chip12k.count() > 0) {
          await chip12k.click();
          const spanM = await page.evaluate(() => window.__map3d.state.mapSpanMeters);
          if (spanM !== 12000) throw new Error('Span meters mismatch');
        }

        const widthInput = page.locator('#targetWidthCmInput');
        const heightInput = page.locator('#targetHeightCmInput');

        const chip50x70 = page.locator('button[data-frame-size="50x70"]');
        if (await chip50x70.count() > 0) {
          await chip50x70.click();
          if ((await widthInput.inputValue()) !== '50' || (await heightInput.inputValue()) !== '70') {
            throw new Error('Frame inputs mismatch');
          }
        }

        const badge = page.locator('#mono4GridBadge');
        if (!badge) throw new Error('Missing badge');

        test4V2Passed = true;
      } catch (err) {
        test4V2Passed = false;
        test4V2Error = err.message;
      }

      results.test3_controls_absence_sensitivity = {
        chip50kmPresentInDom: count50km > 0,
        chip50x100PresentInDom: count50x100 > 0,
        test4V2PassedWhenControlsAbsent: test4V2Passed,
        test4V2Error: test4V2Error,
        verdict: test4V2Passed
          ? 'DEFECT SENSITIVITY FAILED: Test 4.V2 passed even when 50km span chip and 50x100 frame chip are completely absent from DOM! Test 4.V2 only checks 12km span chip and 50x70 frame chip.'
          : 'DEFECT SENSITIVITY CONFIRMED: Test 4.V2 failed when controls are absent.',
      };
      console.log('Result 3:', JSON.stringify(results.test3_controls_absence_sensitivity, null, 2));
      await context.close();
    }

    // =========================================================================
    // ITEM 4: Inspektor Budynku / Tooltips Lingering in DOM Defect Sensitivity
    // =========================================================================
    console.log('\n--- [ITEM 4] Testing whether tests fail if Inspektor Budynku / tooltips linger in DOM ---');
    {
      const context = await browser.newContext({ baseURL: 'http://127.0.0.1:8765' });
      const page = await context.newPage();

      // Scenario 4A: Inject visible #hoverTooltip
      console.log('Testing Scenario 4A: Visible #hoverTooltip lingering in DOM...');
      await page.addInitScript(() => {
        window.addEventListener('DOMContentLoaded', () => {
          let tt = document.getElementById('hoverTooltip');
          if (!tt) {
            tt = document.createElement('div');
            tt.id = 'hoverTooltip';
            document.body.appendChild(tt);
          }
          tt.className = 'visible-lingering-tooltip';
          tt.style.display = 'block';
          tt.textContent = 'Lingering Tooltip';
        });
      });

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__map3d && window.__map3d.state);

      let scenario4AFailed = false;
      let scenario4AError = null;
      try {
        const tooltip = page.locator('#hoverTooltip');
        if (await tooltip.count() > 0) {
          // Playwright expect to be hidden
          const isHidden = await tooltip.isHidden();
          if (!isHidden) throw new Error('expect(received).toBeHidden() received: visible');
        }
      } catch (err) {
        scenario4AFailed = true;
        scenario4AError = err.message;
      }

      await context.close();

      // Scenario 4B: Lingering Inspektor Budynku panel (#buildingInspectorCard or .building-inspector)
      console.log('Testing Scenario 4B: Inspektor Budynku panel lingering in DOM...');
      const context2 = await browser.newContext({ baseURL: 'http://127.0.0.1:8765' });
      const page2 = await context2.newPage();

      await page2.addInitScript(() => {
        window.addEventListener('DOMContentLoaded', () => {
          const inspector = document.createElement('div');
          inspector.id = 'buildingInspectorCard';
          inspector.className = 'p-4 bg-gray-900 border border-blue-500 text-white';
          inspector.innerHTML = '<h3>Inspektor Budynku (LoD2)</h3><p>Wysokość: 25m</p>';
          document.body.appendChild(inspector);
        });
      });

      await page2.goto('/', { waitUntil: 'domcontentloaded' });
      await page2.waitForFunction(() => window.__map3d && window.__map3d.state);

      // Execute Test 4.V4 logic:
      let test4V4PassedUnderLingeringInspector = false;
      let test4V4Error = null;
      try {
        const canvas = page2.locator('#view3dCanvas');
        if (!(await canvas.isVisible())) throw new Error('Canvas not visible');
        const box = await canvas.boundingBox();
        if (!box) throw new Error('Bounding box null');

        const tooltip = page2.locator('#hoverTooltip');
        if (await tooltip.count() > 0) {
          if (!(await tooltip.isHidden())) throw new Error('Tooltip not hidden');
        }

        test4V4PassedUnderLingeringInspector = true;
      } catch (err) {
        test4V4PassedUnderLingeringInspector = false;
        test4V4Error = err.message;
      }

      results.test4_lingering_dom_sensitivity = {
        scenario4A_visible_hover_tooltip: {
          detectedAndFailed: scenario4AFailed,
          error: scenario4AError,
          status: scenario4AFailed ? 'PASS (Visible tooltip detected)' : 'FAIL',
        },
        scenario4B_lingering_building_inspector: {
          detectedAndFailed: !test4V4PassedUnderLingeringInspector,
          error: test4V4Error,
          test4V4PassedDespiteLingeringInspector: test4V4PassedUnderLingeringInspector,
          status: test4V4PassedUnderLingeringInspector
            ? 'DEFECT SENSITIVITY FAILED: Test 4.V4 does NOT assert the absence of Inspektor Budynku panel elements (only checks #hoverTooltip).'
            : 'PASS',
        },
        verdict: scenario4AFailed && test4V4PassedUnderLingeringInspector
          ? 'PARTIALLY SENSITIVE: Sensitive to visible #hoverTooltip, but BLIND to lingering Inspektor Budynku DOM panels/cards.'
          : 'UNKNOWN',
      };
      console.log('Result 4:', JSON.stringify(results.test4_lingering_dom_sensitivity, null, 2));
      await context2.close();
    }
  } finally {
    await browser.close();
  }

  // Write results JSON to state folder or console
  console.log('\n=== COMPLETE RESULTS ===');
  console.log(JSON.stringify(results, null, 2));

  return results;
}

runEmpiricalHarness().catch(err => {
  console.error('Harness error:', err);
  process.exit(1);
});
