// @ts-check
const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  normalizeTitle,
  setupConsoleHygiene,
  waitForAppReady,
  waitForRenderComplete,
  setupLivePhotonWithFallback,
  captureAndInspectScreenshot,
  assertWebGLCanvasNotBlank,
  assertWebGL3DShadingDiversity,
} = require('./test_utils');

const CACHE_DIR = path.resolve(__dirname, '../../cache');

/**
 * Diverse pool of dense, uncached real-world cities (never Munich/Warsaw/NYC/Kraków/CapeTown defaults).
 */
const UNCACHED_CITY_POOL = [
  {
    id: 'wroclaw',
    query: 'Wrocław',
    name: 'Wrocław',
    city: 'Wrocław',
    state: 'województwo dolnośląskie',
    country: 'Polska',
    lat: 51.1095,
    lon: 17.0325,
  },
  {
    id: 'porto',
    query: 'Porto',
    name: 'Porto',
    city: 'Porto',
    state: 'Porto',
    country: 'Portugal',
    lat: 41.1496,
    lon: -8.6110,
  },
  {
    id: 'graz',
    query: 'Graz',
    name: 'Graz',
    city: 'Graz',
    state: 'Steiermark',
    country: 'Österreich',
    lat: 47.0707,
    lon: 15.4395,
  },
  {
    id: 'zurich',
    query: 'Zürich',
    name: 'Zürich',
    city: 'Zürich',
    state: 'Zürich',
    country: 'Schweiz',
    lat: 47.3769,
    lon: 8.5417,
  },
];

/**
 * Picks two distinct uncached cities randomly (or via MAP3D_CITY1 / MAP3D_CITY2 env vars).
 */
function pickTwoUncachedCities() {
  const env1 = (process.env.MAP3D_CITY1 || '').trim().toLowerCase();
  const env2 = (process.env.MAP3D_CITY2 || '').trim().toLowerCase();

  if (env1 && env2) {
    const c1 = UNCACHED_CITY_POOL.find(c => c.id === env1 || normalizeTitle(c.name).toLowerCase() === env1);
    const c2 = UNCACHED_CITY_POOL.find(c => c.id === env2 || normalizeTitle(c.name).toLowerCase() === env2);
    if (c1 && c2 && c1.id !== c2.id) {
      return [c1, c2];
    }
  }

  const pool = UNCACHED_CITY_POOL.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return [pool[0], pool[1]];
}

/**
 * Verifies on disk that cache/ has zero pre-cached osm_*.json or scene_*.json files near (lat, lon).
 * @param {number} lat
 * @param {number} lon
 * @param {string} cityLabel
 */
function assertCityUncachedOnDisk(lat, lon, cityLabel) {
  if (!fs.existsSync(CACHE_DIR)) return;
  const files = fs.readdirSync(CACHE_DIR).filter(f =>
    (f.startsWith('osm_') || f.startsWith('scene_')) && f.endsWith('.json')
  );

  const overlapping = [];
  for (const f of files) {
    const clean = f
      .replace(/^osm_/, '')
      .replace(/^scene_v\d+_/, '')
      .replace(/\.json$/, '');
    const parts = clean.split('_').map(Number);
    if (parts.length === 4 && parts.every(n => Number.isFinite(n))) {
      const midLat = (parts[0] + parts[2]) * 0.5;
      const midLon = (parts[1] + parts[3]) * 0.5;
      if (Math.abs(midLat - lat) < 0.25 && Math.abs(midLon - lon) < 0.25) {
        overlapping.push(f);
      }
    }
  }

  expect(
    overlapping,
    `City ${cityLabel} (${lat}, ${lon}) must NOT exist in precomputed cache/, found: ${overlapping.join(', ')}`
  ).toEqual([]);
}

/**
 * Types a city query into #placeSearchInput like a human user and clicks the matching
 * suggestion button inside #searchSuggestionsDropdown.
 * @param {import('@playwright/test').Page} page
 * @param {typeof UNCACHED_CITY_POOL[number]} city
 */
async function selectCityViaHumanSearchUI(page, city) {
  const searchInput = page.locator('#placeSearchInput');
  const dropdown = page.locator('#searchSuggestionsDropdown');

  await expect(searchInput).toBeVisible();
  await searchInput.click();
  await searchInput.fill('');
  await searchInput.dispatchEvent('input');
  await searchInput.pressSequentially(city.query, { delay: 35 });

  await expect(dropdown).toBeVisible({ timeout: 8000 });
  const buttons = dropdown.locator('button');
  await expect(buttons.first()).toBeVisible({ timeout: 5000 });

  const btnCount = await buttons.count();
  expect(btnCount, `Autocomplete dropdown must show suggestions for ${city.query}`).toBeGreaterThan(0);

  // Pick the suggestion whose coordinate badge matches our target city (avoiding homonyms on other continents)
  let targetIdx = 0;
  for (let i = 0; i < btnCount; i++) {
    const rowText = (await buttons.nth(i).textContent()) || '';
    const coordMatch = rowText.match(/(-?\d+\.\d+)°,\s*(-?\d+\.\d+)°/);
    if (coordMatch) {
      const rowLat = parseFloat(coordMatch[1]);
      const rowLon = parseFloat(coordMatch[2]);
      if (Math.abs(rowLat - city.lat) < 0.6 && Math.abs(rowLon - city.lon) < 0.6) {
        targetIdx = i;
        break;
      }
    }
  }

  const chosenText = ((await buttons.nth(targetIdx).textContent()) || '').replace(/\s+/g, ' ').trim();
  await buttons.nth(targetIdx).click();
  await expect(dropdown).toBeHidden();

  const mapCoords = await page.evaluate(() => ({
    lat: window.__map3d?.state?.mapCenterLat,
    lon: window.__map3d?.state?.mapCenterLon,
    plaqueText: window.__map3d?.state?.plaqueText || '',
  }));

  expect(Math.abs(mapCoords.lat - city.lat), `2D map lat should jump near ${city.name}`).toBeLessThan(0.35);
  expect(Math.abs(mapCoords.lon - city.lon), `2D map lon should jump near ${city.name}`).toBeLessThan(0.35);

  return { chosenText, selectedLat: mapCoords.lat, selectedLon: mapCoords.lon, plaqueText: mapCoords.plaqueText };
}

test.describe('Live Real-User Journey: Uncached Multi-City 2.5 km -> 5.0 km UI Flow (Zero Shortcuts)', () => {
  test('Drives http://127.0.0.1:8765/ 100% via DOM UI across 2 uncached cities (2.5 km -> 5.0 km) with staged screenshots & strict 3D checks', async ({ page }) => {
    test.setTimeout(240000);

    const [city1, city2] = pickTwoUncachedCities();
    console.log(
      `[Live User Journey] Selected uncached pair: City 1 = ${city1.name} (${city1.lat}, ${city1.lon}) @ 2.5 km -> City 2 = ${city2.name} (${city2.lat}, ${city2.lon}) @ 5.0 km`
    );

    // 0. Prove on disk that neither city exists in cache/
    assertCityUncachedOnDisk(city1.lat, city1.lon, city1.name);
    assertCityUncachedOnDisk(city2.lat, city2.lon, city2.name);

    // Attach console/page error hygiene with liveNetwork: true (ZERO Overpass route proxy!)
    const hygiene = setupConsoleHygiene(page, { liveNetwork: true });
    const photonEvents = await setupLivePhotonWithFallback(page, [city1, city2]);

    // Track unhandled promise rejections inside page context as well
    await page.addInitScript(() => {
      window.__unhandledRejections = [];
      window.addEventListener('unhandledrejection', (ev) => {
        // Record any unhandled rejection that was not explicitly suppressed by app abort handling
        if (!ev.defaultPrevented) {
          window.__unhandledRejections.push(String(ev.reason && ev.reason.message ? ev.reason.message : ev.reason));
        }
      });
    });

    // ------------------------------------------------------------------------
    // STEP 1: Fresh Boot on http://127.0.0.1:8765/
    // ------------------------------------------------------------------------
    await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const bootState = await page.evaluate(() => ({
      hasScene: window.__map3d?.state?.sceneData !== null,
      totalTriangles: window.__map3d?.state?.totalTriangles || 0,
    }));
    expect(bootState.hasScene, 'Fresh boot must start with INITIAL_REAL_SCENE === null').toBe(false);
    expect(bootState.totalTriangles, 'Fresh boot must only render clean empty print bed (<= 12 triangles)').toBeLessThanOrEqual(12);
    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    await expect(page.locator('#gisErrorBanner')).toBeHidden();

    // ------------------------------------------------------------------------
    // STEP 2: Search City 1 via #placeSearchInput, Click Suggestion, Click 2.5 km
    // ------------------------------------------------------------------------
    const sel1 = await selectCityViaHumanSearchUI(page, city1);
    console.log(`[Live User Journey] City 1 selected from dropdown: "${sel1.chosenText}" -> (${sel1.selectedLat.toFixed(4)}, ${sel1.selectedLon.toFixed(4)})`);

    const span25Btn = page.locator('button[data-span-km="2.5"]');
    await expect(span25Btn).toBeVisible();
    await span25Btn.click();
    await expect(page.locator('#cropSizeLabel')).toContainText('2.50 km');

    const preRenderCheck = await page.evaluate(() => ({
      spanMeters: window.__map3d?.state?.mapSpanMeters,
      sceneIsNull: window.__map3d?.state?.sceneData === null,
      totalTriangles: window.__map3d?.state?.totalTriangles || 0,
    }));
    expect(preRenderCheck.spanMeters).toBe(2500);
    expect(preRenderCheck.sceneIsNull, 'Changing city & span must NOT auto-render 3D before clicking Render').toBe(true);
    expect(preRenderCheck.totalTriangles).toBeLessThanOrEqual(12);
    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    await expect(page.locator('#gisErrorBanner')).toBeHidden();

    // Capture Staged Screenshot 1: before_render.png
    const shotBefore = await captureAndInspectScreenshot(page, null, 'before_render.png', { minBytes: 20000 });
    console.log(`[Live User Journey] Saved screenshot: ${shotBefore.filePath} (${shotBefore.size} bytes, ${shotBefore.width}x${shotBefore.height})`);

    // ------------------------------------------------------------------------
    // STEP 3: Click #btnRender3D (Render) for City 1 @ 2.5 km & Capture Progress
    // ------------------------------------------------------------------------
    const renderBtn = page.locator('#btnRender3D');
    await expect(renderBtn).toBeVisible();
    await expect(renderBtn).toBeEnabled();

    const tCity1Start = Date.now();
    await renderBtn.click();

    // Verify loading overlay appears and capture during_progress.png while actively streaming
    await expect(page.locator('#loadingOverlay3D')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(250);
    const shotProgress = await captureAndInspectScreenshot(page, null, 'during_progress.png', { minBytes: 20000 });
    console.log(`[Live User Journey] Saved screenshot: ${shotProgress.filePath} (${shotProgress.size} bytes, ${shotProgress.width}x${shotProgress.height})`);

    // Wait for full 3D render completion (strictly fails if #gisErrorBanner or DEM _fallback occurs)
    const city1Result = await waitForRenderComplete(page, '', 120000);
    const city1ElapsedSec = ((Date.now() - tCity1Start) / 1000).toFixed(2);
    console.log(
      `[Live User Journey] City 1 (${city1.name} @ 2.5 km) rendered in ${city1ElapsedSec}s: ${city1Result.buildingCount} buildings, ${city1Result.totalTriangles} triangles, center=${JSON.stringify(city1Result.center)}`
    );

    // Strict assertions for City 1 (2.5 km)
    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    await expect(page.locator('#gisErrorBanner')).toBeHidden();
    await expect(renderBtn).toBeEnabled();

    expect(city1Result.isFallback, 'City 1 sceneData._fallback must be falsy').toBe(false);
    expect(city1Result.buildingCount, `City 1 (${city1.name}) must render >= 30 real buildings`).toBeGreaterThanOrEqual(30);
    expect(city1Result.totalTriangles, `City 1 (${city1.name}) must render > 3000 triangles`).toBeGreaterThan(3000);
    expect(Array.isArray(city1Result.center) && city1Result.center.length === 2, 'City 1 sceneData.center must exist').toBe(true);
    expect(Math.abs(city1Result.center[0] - sel1.selectedLat)).toBeLessThan(0.06);
    expect(Math.abs(city1Result.center[1] - sel1.selectedLon)).toBeLessThan(0.06);

    await assertWebGLCanvasNotBlank(page);
    const shading1 = await assertWebGL3DShadingDiversity(page, {
      minUniqueColors: 20,
      minLumStdDev: 2.0,
      minEdgeTransitions: 80,
    });
    console.log(
      `[Live User Journey] City 1 WebGL shading metrics: uniqueColors=${shading1.uniqueColorCount}, lumStdDev=${shading1.lumStdDev}, edgeTransitions=${shading1.edgeTransitions}`
    );

    // Capture Staged Screenshot 3: after_render_city1_2_5km.png
    const shotCity1 = await captureAndInspectScreenshot(page, null, 'after_render_city1_2_5km.png', { minBytes: 25000 });
    console.log(`[Live User Journey] Saved screenshot: ${shotCity1.filePath} (${shotCity1.size} bytes, ${shotCity1.width}x${shotCity1.height})`);

    // ------------------------------------------------------------------------
    // STEP 4: Switch to City 2 @ 5.0 km in the SAME Tab (Catches lastFetchBbox Bug!)
    // ------------------------------------------------------------------------
    const sel2 = await selectCityViaHumanSearchUI(page, city2);
    console.log(`[Live User Journey] City 2 selected from dropdown: "${sel2.chosenText}" -> (${sel2.selectedLat.toFixed(4)}, ${sel2.selectedLon.toFixed(4)})`);

    const span50Btn = page.locator('button[data-span-km="5.0"]');
    await expect(span50Btn).toBeVisible();
    await span50Btn.click();
    await expect(page.locator('#cropSizeLabel')).toContainText('5.00 km');

    // Verify decoupled UX: before clicking Render, 3D sceneData.center still reflects City 1 while 2D map reflects City 2
    const beforeSwitchRender = await page.evaluate(() => ({
      spanMeters: window.__map3d?.state?.mapSpanMeters,
      sceneCenterBeforeClick: window.__map3d?.state?.sceneData?.center || null,
    }));
    expect(beforeSwitchRender.spanMeters).toBe(5000);
    expect(beforeSwitchRender.sceneCenterBeforeClick).toEqual(city1Result.center);

    const tCity2Start = Date.now();
    await renderBtn.click();
    await expect(page.locator('#loadingOverlay3D')).toBeVisible({ timeout: 5000 });

    const city2Result = await waitForRenderComplete(page, '', 120000);
    const city2ElapsedSec = ((Date.now() - tCity2Start) / 1000).toFixed(2);
    console.log(
      `[Live User Journey] City 2 (${city2.name} @ 5.0 km) rendered in ${city2ElapsedSec}s: ${city2Result.buildingCount} buildings, ${city2Result.totalTriangles} triangles, center=${JSON.stringify(city2Result.center)}`
    );

    // Strict assertions for City 2 (5.0 km) & anti-lastFetchBbox verification
    await expect(page.locator('#loadingOverlay3D')).toBeHidden();
    await expect(page.locator('#gisErrorBanner')).toBeHidden();
    await expect(renderBtn).toBeEnabled();

    expect(city2Result.isFallback, 'City 2 sceneData._fallback must be falsy').toBe(false);
    expect(city2Result.buildingCount, `City 2 (${city2.name} @ 5.0 km) must render >= 30 real buildings`).toBeGreaterThanOrEqual(30);
    expect(city2Result.totalTriangles, `City 2 (${city2.name} @ 5.0 km) must render > 3000 triangles`).toBeGreaterThan(3000);
    expect(Array.isArray(city2Result.center) && city2Result.center.length === 2, 'City 2 sceneData.center must exist').toBe(true);

    const centerShiftDeg = Math.hypot(
      city2Result.center[0] - city1Result.center[0],
      city2Result.center[1] - city1Result.center[1]
    );
    expect(
      centerShiftDeg,
      `Switching from ${city1.name} to ${city2.name} MUST update state.sceneData.center (stale lastFetchBbox bug check!)`
    ).toBeGreaterThan(1.0);
    expect(
      Math.abs(city2Result.center[0] - sel2.selectedLat),
      `City 2 sceneData.center[0] (${city2Result.center[0]}) must match ${city2.name} lat (${sel2.selectedLat})`
    ).toBeLessThan(0.08);
    expect(
      Math.abs(city2Result.center[1] - sel2.selectedLon),
      `City 2 sceneData.center[1] (${city2Result.center[1]}) must match ${city2.name} lon (${sel2.selectedLon})`
    ).toBeLessThan(0.08);
    expect(city2Result.spanMeters).toBeGreaterThanOrEqual(4500);

    await assertWebGLCanvasNotBlank(page);
    const shading2 = await assertWebGL3DShadingDiversity(page, {
      minUniqueColors: 20,
      minLumStdDev: 2.0,
      minEdgeTransitions: 80,
    });
    console.log(
      `[Live User Journey] City 2 WebGL shading metrics: uniqueColors=${shading2.uniqueColorCount}, lumStdDev=${shading2.lumStdDev}, edgeTransitions=${shading2.edgeTransitions}`
    );

    // Capture Staged Screenshot 4: after_render_city2_5km_switched.png
    const shotCity2 = await captureAndInspectScreenshot(page, null, 'after_render_city2_5km_switched.png', { minBytes: 25000 });
    console.log(`[Live User Journey] Saved screenshot: ${shotCity2.filePath} (${shotCity2.size} bytes, ${shotCity2.width}x${shotCity2.height})`);

    // ------------------------------------------------------------------------
    // STEP 5: Strict Console, PageError & Unhandled Rejection Hygiene (=== 0)
    // ------------------------------------------------------------------------
    const unhandledRejections = await page.evaluate(() => /** @type {any} */ (window).__unhandledRejections || []);
    console.log(`[Live User Journey] Photon resolution log: ${JSON.stringify(photonEvents)}`);
    expect(unhandledRejections, 'Must have 0 unhandled promise rejections').toEqual([]);
    expect(hygiene.pageErrors, 'Must have 0 page errors').toEqual([]);
    expect(hygiene.consoleErrors, 'Must have 0 console errors').toEqual([]);
    hygiene.assertClean();
    hygiene.detach();
  });
});
