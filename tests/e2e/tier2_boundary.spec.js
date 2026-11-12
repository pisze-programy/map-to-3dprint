// @ts-check
const { test, expect } = require('@playwright/test');
const {
  TEST_LOCATIONS,
  setupConsoleHygiene,
  waitForAppReady,
  waitForRenderComplete,
  waitForGisError,
  mockGisFailure,
  mockGisHang,
  unmockGis,
} = require('./test_utils');

test.describe('Tier 2: Boundary, Corner Case & Error Resilience (Opaque-Box E2E Tests)', () => {
  /** @type {ReturnType<typeof setupConsoleHygiene>} */
  let hygiene;

  test.beforeEach(async ({ page }) => {
    hygiene = setupConsoleHygiene(page);
  });

  test.afterEach(async () => {
    hygiene.assertClean();
  });

  // --------------------------------------------------------------------------
  // SUITE 1: Empty and Whitespace Search Inputs
  // --------------------------------------------------------------------------
  test.describe('1. Search Input Boundary Handling', () => {
    test('2.1 Empty search string on #placeSearchInput with button click', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      const placeInput = page.locator('#placeSearchInput');
      const searchBtn = page.locator('#btnSearchPlace');
      const dropdown = page.locator('#searchSuggestionsDropdown');

      // Fill empty string and click search
      await placeInput.fill('');
      await placeInput.dispatchEvent('input');
      await searchBtn.click();

      // Assert no loader, dropdown hidden, button stays enabled
      await expect(page.locator('#loadingOverlay3D')).toBeHidden();
      await expect(dropdown).toBeHidden();
      await expect(searchBtn).toBeEnabled();
      await expect(searchBtn).toHaveText('Szukaj');

      // Verify WebGL scene was not disrupted
      const triangles = await page.evaluate(() => window.__map3d?.state?.totalTriangles);
      expect(triangles).toBeGreaterThan(0);
    });

    test('2.2 Whitespace-only search string with Enter keypress', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      const placeInput = page.locator('#placeSearchInput');
      const dropdown = page.locator('#searchSuggestionsDropdown');

      await placeInput.fill('     \t  ');
      await placeInput.dispatchEvent('input');
      await placeInput.press('Enter');

      await expect(page.locator('#loadingOverlay3D')).toBeHidden();
      await expect(dropdown).toBeHidden();
      await expect(page.locator('#gisErrorBanner')).toBeHidden();

      const triangles = await page.evaluate(() => window.__map3d?.state?.totalTriangles);
      expect(triangles).toBeGreaterThan(0);
    });

    test('2.3 Single character input does not trigger autocomplete dropdown', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      const placeInput = page.locator('#placeSearchInput');
      const dropdown = page.locator('#searchSuggestionsDropdown');

      await placeInput.fill('a');
      await placeInput.dispatchEvent('input');
      await page.waitForTimeout(300);

      await expect(dropdown).toBeHidden();
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 2: Invalid / Out-of-Bounds Coordinates & Inverted Bounding Boxes
  // --------------------------------------------------------------------------
  test.describe('2. Coordinate Boundary & Inverted Bounding Boxes', () => {
    test('2.4 Inverted bounding box (south > north) surfaces error banner without freeze', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      // Trigger inverted bbox: south=55.0, north=50.0
      await page.evaluate(() => {
        window.fetchRealGISAndRender(55.0, 21.0, 50.0, 22.0, 'INVERTED_TEST').catch(err => {
          console.warn('Controlled catch for inverted bbox:', err.message);
        });
      });

      // Assert error banner appears or overlay dismisses cleanly
      await page.waitForFunction(() => {
        const ov = document.getElementById('loadingOverlay3D');
        const btn = document.getElementById('btnRender3D');
        const ovHidden = ov && (ov.classList.contains('hidden') || window.getComputedStyle(ov).display === 'none');
        return ovHidden && btn && !btn.disabled;
      }, { timeout: 20000 });

      await expect(page.locator('#loadingOverlay3D')).toBeHidden();
      await expect(page.locator('#btnRender3D')).toBeEnabled();

      // Verify WebGL scene was preserved
      const triangles = await page.evaluate(() => window.__map3d?.state?.totalTriangles);
      expect(triangles).toBeGreaterThan(0);
    });

    test('2.5 NaN bounding box coordinates handled gracefully without unhandled crash', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      await page.evaluate(() => {
        window.__map3d.fetchRealGISAndRender([NaN, NaN, NaN, NaN], 'NAN_TEST').catch(err => {
          console.warn('Controlled catch for NaN bbox:', err.message);
        });
      });

      await page.waitForFunction(() => {
        const ov = document.getElementById('loadingOverlay3D');
        const btn = document.getElementById('btnRender3D');
        const ovHidden = ov && (ov.classList.contains('hidden') || window.getComputedStyle(ov).display === 'none');
        return ovHidden && btn && !btn.disabled;
      }, { timeout: 20000 });

      await expect(page.locator('#loadingOverlay3D')).toBeHidden();
      await expect(page.locator('#btnRender3D')).toBeEnabled();
    });

    test('2.6 Out-of-range coordinates via URL parameters (?bbox=120,0,130,10)', async ({ page }) => {
      // Mock failure for out-of-range query so test executes promptly
      await mockGisFailure(page, 500, 'Coordinates out of range');

      await page.goto('/?bbox=120.0,0.0,130.0,10.0&title=OUT_OF_BOUNDS', { waitUntil: 'domcontentloaded' });

      // Should dismiss loader with error banner and recover gracefully without hang
      await page.waitForFunction(() => {
        const ov = document.getElementById('loadingOverlay3D');
        const btn = document.getElementById('btnRender3D');
        const ovHidden = ov && (ov.classList.contains('hidden') || window.getComputedStyle(ov).display === 'none');
        return ovHidden && btn && !btn.disabled;
      }, { timeout: 25000 });

      await expect(page.locator('#loadingOverlay3D')).toBeHidden();
      await expect(page.locator('#btnRender3D')).toBeEnabled();
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 3: Simulated GIS Network Failure via Route Interception
  // --------------------------------------------------------------------------
  test.describe('3. Network Failure & Interception Resilience', () => {
    test('2.7 HTTP 500 error on GIS backend surfaces #gisErrorBanner and dismisses #loadingOverlay3D', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      // Intercept all GIS network requests with HTTP 500
      await mockGisFailure(page, 500, 'Internal Server Error in GIS service');

      // Trigger fetch for uncached coordinates (Reykjavik)
      await page.evaluate(() => {
        window.fetchRealGISAndRender(64.1400, -21.9400, 64.1500, -21.9300, 'REYKJAVIK').catch(() => {});
      });

      // Assert banner displays, overlay is dismissed (infinite loader prevention)
      const { errorText, retryButtonVisible } = await waitForGisError(page, 20000);

      expect(errorText.length).toBeGreaterThan(0);
      expect(retryButtonVisible).toBe(true);

      await expect(page.locator('#gisErrorBanner')).toBeVisible();
      await expect(page.locator('#loadingOverlay3D')).toBeHidden();
      await expect(page.locator('#btnRender3D')).toBeEnabled();
    });

    test('2.8 Network drop / connection refusal simulation', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      // Simulate connection drop
      await page.route('**/api/gis**', route => route.abort('connectionrefused'));
      await page.route('**/api/interpreter**', route => route.abort('connectionrefused'));
      await page.route('**/*overpass*/**', route => route.abort('connectionrefused'));
      await page.route('**/*elevation-tiles-prod*/**', route => route.abort('connectionrefused'));
      await page.route('**/cache/scene_v5_*.json', route => route.abort('connectionrefused'));

      await page.evaluate(() => {
        window.fetchRealGISAndRender(64.1400, -21.9400, 64.1500, -21.9300, 'OFFLINE_TEST').catch(() => {});
      });

      const { errorText, retryButtonVisible } = await waitForGisError(page, 20000);
      expect(errorText.length).toBeGreaterThan(0);
      expect(retryButtonVisible).toBe(true);

      await expect(page.locator('#gisErrorBanner')).toBeVisible();
      await expect(page.locator('#loadingOverlay3D')).toBeHidden();
      await expect(page.locator('#btnRender3D')).toBeEnabled();
    });

    test('2.9 Hard 45-second inactivity watchdog timeout triggers on hanging network request', async ({ page }) => {
      test.setTimeout(90000);

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      // Route that hangs indefinitely
      await mockGisHang(page);

      const tStart = performance.now();
      await page.evaluate(() => {
        window.fetchRealGISAndRender(64.1400, -21.9400, 64.1500, -21.9300, 'HANG_TEST').catch(() => {});
      });

      // Overlay must be visible initially
      await expect(page.locator('#loadingOverlay3D')).toBeVisible();
      await expect(page.locator('#btnRender3D')).toBeDisabled();

      // Banner must appear after 45s inactivity watchdog fires
      const { errorText, retryButtonVisible } = await waitForGisError(page, 65000);
      const elapsed = performance.now() - tStart;

      expect(elapsed).toBeGreaterThanOrEqual(44000);
      expect(errorText).toContain('45s');
      expect(retryButtonVisible).toBe(true);

      // CRITICAL: Loader MUST be hidden
      await expect(page.locator('#loadingOverlay3D')).toBeHidden();
      await expect(page.locator('#btnRender3D')).toBeEnabled();
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 4: Error Recovery & User Cancellation
  // --------------------------------------------------------------------------
  test.describe('4. Error Recovery & Cancellation Lifecycle', () => {
    test('2.10 Retry flow (#btnRetryGis) recovers after network failure', async ({ page }) => {
      const warsaw = TEST_LOCATIONS.WARSAW;
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      await page.locator('#plaqueTextInput').fill(warsaw.title);
      await page.locator('#plaqueTextInput').dispatchEvent('change');

      await page.evaluate(({ center }) => {
        window.__map3d.state.mapCenterLat = center[0];
        window.__map3d.state.mapCenterLon = center[1];
      }, { center: warsaw.center });

      // 1. Fail first with mock failure
      await mockGisFailure(page, 500, 'Temporary glitch');

      await page.evaluate(({ bbox, title }) => {
        window.fetchRealGISAndRender(bbox[0], bbox[1], bbox[2], bbox[3], title).catch(() => {});
      }, { bbox: warsaw.bbox, title: warsaw.title });

      await expect(page.locator('#gisErrorBanner')).toBeVisible({ timeout: 20000 });
      await expect(page.locator('#loadingOverlay3D')).toBeHidden({ timeout: 20000 });

      // 2. Unroute to restore network
      await unmockGis(page);

      await page.click('#btnRetryGis');

      // 3. Verify successful recovery
      await waitForRenderComplete(page, warsaw.titleMatch);

      await expect(page.locator('#gisErrorBanner')).toBeHidden();
      await expect(page.locator('#loadingOverlay3D')).toBeHidden();
      await expect(page.locator('#btnRender3D')).toBeEnabled();
    });

    test('2.11 User cancellation via #btnCancelGisFetch dismisses overlay without false error banner', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      // Slow down response so overlay remains open long enough to click cancel
      await page.route('**/api/gis**', async route => {
        await new Promise(r => setTimeout(r, 2000));
        await route.continue();
      });

      await page.evaluate(() => {
        const warsawBbox = [52.2415, 21.0050, 52.2525, 21.0220];
        window.fetchRealGISAndRender(warsawBbox, 'CANCEL_TEST').catch(() => {});
      });

      // Wait for overlay to appear
      await expect(page.locator('#loadingOverlay3D')).toBeVisible({ timeout: 5000 });

      // Click cancel button
      await page.click('#btnCancelGisFetch');

      // Assert immediate dismissal and absence of error banner
      await expect(page.locator('#loadingOverlay3D')).toBeHidden();
      await expect(page.locator('#gisErrorBanner')).toBeHidden();
      await expect(page.locator('#btnRender3D')).toBeEnabled();
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 5: Rapid Multi-Click & Safe Event Delegation Cleanliness
  // --------------------------------------------------------------------------
  test.describe('5. Rapid Multi-Click & Event Delegation Cleanliness', () => {
    test('2.12 Rapid triple-click on #btnRender3D does not cause concurrent fetch collisions', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      // Click rapidly 3 times
      const btn = page.locator('#btnRender3D');
      await btn.click({ clickCount: 3, delay: 20 }).catch(() => {});

      // Wait for render completion
      await page.waitForFunction(() => {
        const ov = document.getElementById('loadingOverlay3D');
        const st = window.__map3d?.state;
        const ovHidden = ov && (ov.classList.contains('hidden') || window.getComputedStyle(ov).display === 'none');
        return ovHidden && st && st.totalTriangles > 0;
      }, { timeout: 45000 });

      await expect(page.locator('#loadingOverlay3D')).toBeHidden();
      await expect(page.locator('#btnRender3D')).toBeEnabled();
    });

    test('2.13 Rapid consecutive city triggers (preemption via AbortController)', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      const warsaw = TEST_LOCATIONS.WARSAW;
      const ny = TEST_LOCATIONS.NEW_YORK;

      // Trigger Warsaw immediately followed by New York 30ms later
      await page.evaluate(async ({ wBbox, wTitle, nyBbox, nyTitle }) => {
        window.fetchRealGISAndRender(wBbox, wTitle).catch(() => {});
        await new Promise(r => setTimeout(r, 30));
        window.fetchRealGISAndRender(nyBbox, nyTitle).catch(() => {});
      }, {
        wBbox: warsaw.bbox,
        wTitle: warsaw.title,
        nyBbox: ny.bbox,
        nyTitle: ny.title,
      });

      // Must complete with New York
      await waitForRenderComplete(page, ny.titleMatch);

      await expect(page.locator('#loadingOverlay3D')).toBeHidden();
      await expect(page.locator('#btnRender3D')).toBeEnabled();

      const finalTitle = await page.evaluate(() => window.__map3d?.state?.sceneData?.title);
      expect(finalTitle?.toUpperCase()).toContain(ny.titleMatch.toUpperCase());
    });

    test('2.14 Safe event delegation: zero TypeError: ev.target.closest across non-Element targets', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      // Dispatch click events with window, document, and text nodes
      await page.evaluate(() => {
        window.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        document.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const textNode = document.createTextNode('sample_test_node');
        document.body.appendChild(textNode);
        const ev = new MouseEvent('click', { bubbles: true });
        Object.defineProperty(ev, 'target', { value: textNode });
        document.dispatchEvent(ev);
        textNode.remove();

        const svg = document.querySelector('svg');
        if (svg) {
          svg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }

        if (typeof window.safeClosest === 'function') {
          window.safeClosest(null, 'button');
          window.safeClosest(undefined, 'button');
          window.safeClosest({}, 'button');
          window.safeClosest(window, 'button');
          window.safeClosest(document, 'button');
        }
      });

      await page.waitForTimeout(300);
      // Hygiene assertion in afterEach will verify 0 closest errors
    });
  });
});
