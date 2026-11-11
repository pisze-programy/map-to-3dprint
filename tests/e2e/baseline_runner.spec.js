// @ts-check
const { test, expect } = require('@playwright/test');
const { setupConsoleHygiene, waitForAppReady } = require('./test_utils');

/**
 * Baseline E2E benchmark and integration test suite.
 * Measures end-to-end execution time from city selection to complete 3D preview
 * and verifies WebGL rendering, DOM lifecycle, and error freedom.
 */

const TEST_CITIES = [
  {
    id: 'warsaw',
    name: 'Warsaw (Old Town)',
    title: 'WARSZAWA',
    titleMatch: 'WARSZAWA',
    bbox: [52.2415, 21.0050, 52.2525, 21.0220],
  },
  {
    id: 'new_york',
    name: 'New York (Central Park)',
    title: 'NYC CENTRAL PARK',
    titleMatch: 'CENTRAL PARK',
    bbox: [40.7606, -73.9839, 40.7722, -73.9729],
  },
];

test.describe('Milestone 1 — Baseline Runner & Test Harness', () => {
  for (const city of TEST_CITIES) {
    test(`Baseline city selection to 3D preview: ${city.name}`, async ({ page }) => {
      const pageErrors = [];
      const consoleWarnings = [];
      const consoleErrors = [];

      page.on('pageerror', err => {
        pageErrors.push(err.message || String(err));
      });
      page.on('console', msg => {
        const text = msg.text();
        if (msg.type() === 'error') {
          consoleErrors.push(text);
        } else if (msg.type() === 'warning') {
          consoleWarnings.push(text);
        }
      });

      // 1. Record test start timestamp
      const startEpochMs = Date.now();
      const startMonotonicMs = performance.now();

      // 2. Navigate to application root
      setupConsoleHygiene(page);
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      // 3. Wait for initial app bootstrap (clean empty print bed / frame)
      await waitForAppReady(page);

      // 4. Assert WebGL context is initialized and active
      const webglStatus = await page.evaluate(() => {
        const canvas = document.getElementById('view3dCanvas');
        if (!canvas) return { ok: false, reason: 'canvas_view3dCanvas_missing' };
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return { ok: false, reason: 'no_webgl_context' };
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return {
          ok: true,
          renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        };
      });

      expect(webglStatus.ok, 'WebGL context must be initialized on #view3dCanvas').toBe(true);

      // 5. High-resolution timing: Record city selection timestamp & trigger fetch
      const triggerEpochMs = Date.now();
      const triggerMonotonicMs = performance.now();

      await page.evaluate(({ bbox, title }) => {
        window.performance.mark('benchmark:city-trigger');
        window.__map3d.fetchRealGISAndRender(bbox, title);
      }, { bbox: city.bbox, title: city.title });

      // 6. Wait for 3D preview completion signals
      await page.waitForFunction((expectedSubstring) => {
        const overlay = document.getElementById('loadingOverlay3D');
        const banner = document.getElementById('gisErrorBanner');
        const btn = document.getElementById('btnRender3D');
        const badge = document.getElementById('meshStatsBadge')?.textContent || '';
        const st = window.__map3d && window.__map3d.state;
        const currentTitle = st?.sceneData?.title || st?.plaqueText || '';

        const overlayHidden = overlay && (
          overlay.classList.contains('hidden') ||
          window.getComputedStyle(overlay).display === 'none'
        );
        const bannerText = banner ? (banner.textContent || '') : '';
        const bannerHidden = !banner || (
          banner.classList.contains('hidden') ||
          window.getComputedStyle(banner).display === 'none' ||
          bannerText.includes('Załadowano model terenu DEM')
        );
        const btnEnabled = btn && !btn.disabled;
        const badgeValid = badge.includes('trójkątów') && !badge.includes('ERR:');
        const trianglesValid = st && typeof st.totalTriangles === 'number' && st.totalTriangles > 0;
        const titleMatches = currentTitle.toUpperCase().includes(expectedSubstring.toUpperCase());

        return overlayHidden && bannerHidden && btnEnabled && badgeValid && trianglesValid && titleMatches;
      }, city.titleMatch, { timeout: 45000 });

      // Ensure GPU presentation (wait 2 requestAnimationFrame cycles)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

      // 7. High-resolution timing: Record completion timestamp & elapsed ms
      const completeEpochMs = Date.now();
      const completeMonotonicMs = performance.now();
      const harnessElapsedMs = completeMonotonicMs - triggerMonotonicMs;

      const inPageElapsedMs = await page.evaluate(() => {
        window.performance.mark('benchmark:render-complete');
        try {
          window.performance.measure('benchmark:city-to-render', 'benchmark:city-trigger', 'benchmark:render-complete');
          const entries = performance.getEntriesByName('benchmark:city-to-render');
          return entries.length > 0 ? entries[entries.length - 1].duration : null;
        } catch (_) {
          return null;
        }
      });

      // 8. Assertions on UI DOM state
      await expect(page.locator('#loadingOverlay3D')).toBeHidden();
      await expect(page.locator('#gisErrorBanner')).toBeHidden();
      await expect(page.locator('#btnRender3D')).toBeEnabled();

      const meshBadgeText = await page.locator('#meshStatsBadge').textContent();
      expect(meshBadgeText).toContain('trójkątów');
      expect(meshBadgeText).not.toContain('ERR:');

      const totalTriangles = await page.evaluate(() => window.__map3d.state.totalTriangles);
      expect(totalTriangles).toBeGreaterThan(0);

      // 9. Error and console monitoring assertions
      const closestErrors = pageErrors.filter(err => /closest is not a function/i.test(err));
      expect(closestErrors, 'Zero TypeError: ev.target.closest is not a function').toEqual([]);

      const corsAndFileErrors = [...consoleErrors, ...consoleWarnings].filter(msg =>
        /file:\/\/|CORS policy|Cross-Origin Request Blocked/i.test(msg)
      );
      expect(corsAndFileErrors, 'Zero File URI or CORS security warnings').toEqual([]);

      expect(pageErrors, 'Zero unhandled page errors').toEqual([]);

      // 10. Log timing report to stdout
      console.log(`[BASELINE SPEC] ${city.name}:`);
      console.log(`  - Start Epoch:          ${new Date(startEpochMs).toISOString()} (${startEpochMs} ms)`);
      console.log(`  - City Selection Epoch: ${new Date(triggerEpochMs).toISOString()} (${triggerEpochMs} ms)`);
      console.log(`  - Render Complete Epoch:${new Date(completeEpochMs).toISOString()} (${completeEpochMs} ms)`);
      console.log(`  - Harness Elapsed:      ${harnessElapsedMs.toFixed(2)} ms`);
      console.log(`  - In-Page Elapsed:      ${inPageElapsedMs !== null ? inPageElapsedMs.toFixed(2) + ' ms' : 'N/A'}`);
      console.log(`  - Total Triangles:      ${totalTriangles.toLocaleString('en-US')}`);
      console.log(`  - WebGL Renderer:       ${webglStatus.renderer}`);
    });
  }

  test('Baseline city selection via URL parameters: Warsaw', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message || String(err)));

    const tStart = performance.now();
    setupConsoleHygiene(page);
    await page.goto('/?bbox=52.2415,21.0050,52.2525,21.0220&title=WARSZAWA', { waitUntil: 'domcontentloaded' });

    // Wait for URL readiness promise and 3D preview completion
    await page.waitForFunction(() => {
      const ov = document.getElementById('loadingOverlay3D');
      const badge = document.getElementById('meshStatsBadge')?.textContent || '';
      const st = window.__map3d?.state;
      return ov && ov.classList.contains('hidden') && badge.includes('trójkątów') && !badge.includes('ERR:') && st?.totalTriangles > 0;
    }, { timeout: 45000 });

    const tElapsed = performance.now() - tStart;
    const triangles = await page.evaluate(() => window.__map3d.state.totalTriangles);
    const badge = await page.locator('#meshStatsBadge').textContent();

    expect(triangles).toBeGreaterThan(0);
    expect(badge).toContain('trójkątów');
    expect(pageErrors).toEqual([]);
    console.log(`[BASELINE SPEC] Warsaw via URL params: ${tElapsed.toFixed(2)} ms | Triangles: ${triangles}`);
  });
});
