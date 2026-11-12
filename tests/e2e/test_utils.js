// @ts-check
const { expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function normalizeTitle(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/**
 * Common test locations matching precomputed cache catalog.
 */
const TEST_LOCATIONS = {
  WARSAW: {
    name: 'Warsaw (Old Town)',
    title: 'WARSZAWA',
    titleMatch: 'WARSZAWA',
    bbox: [52.2415, 21.0050, 52.2525, 21.0220],
    center: [52.2470, 21.0135],
    region: 'Europa • Warszawa (Skarpa & Wisła)',
  },
  NEW_YORK: {
    name: 'New York (Central Park)',
    title: 'NYC CENTRAL PARK',
    titleMatch: 'CENTRAL PARK',
    bbox: [40.7606, -73.9839, 40.7722, -73.9729],
    center: [40.7664, -73.9784],
    region: 'USA • Manhattan (Central Park South)',
  },
  MUNICH: {
    name: 'Munich (Marienplatz / Isar)',
    title: 'MÜNCHEN',
    titleMatch: 'MUNCHEN',
    bbox: [48.1280, 11.5769, 48.1396, 11.5941],
    center: [48.1338, 11.5855],
    region: 'Europa • Monachium (Isar)',
  },
  KRAKOW: {
    name: 'Kraków (Wawel)',
    title: 'KRAKÓW',
    titleMatch: 'KRAKOW',
    bbox: [50.0488, 19.9280, 50.0598, 19.9450],
    center: [50.0543, 19.9365],
    region: 'Europa • Kraków (Wawel & Wisła)',
  },
};

/**
 * Sets up resilient Overpass proxy with genuine User-Agent and fallback.
 * @param {import('@playwright/test').Page} page
 */
async function setupOverpassProxy(page) {
  try {
    await page.route('**/*interpreter*', async (route) => {
      try {
        const resp = await route.fetch({
          headers: {
            ...route.request().headers(),
            'User-Agent': 'Map3DStudio/2.0 (OpenStreetMap 3D Print Studio)'
          },
          timeout: 15000
        });
        if (resp && resp.status() < 400) {
          await route.fulfill({ response: resp });
          return;
        }
      } catch (_) {}
      try {
        const url = route.request().url();
        const postData = route.request().postData() || '';
        const decoded = decodeURIComponent(postData);
        const cacheDir = path.resolve(__dirname, '../../cache');
        if (fs.existsSync(cacheDir)) {
          const files = fs.readdirSync(cacheDir).filter(f => f.startsWith('osm_') && f.endsWith('.json'));
          let bestFile = null;

          // Check if requested bounding box overlaps with any locally cached scene
          const m = decoded.match(/\[bbox:([0-9.-]+),([0-9.-]+),([0-9.-]+),([0-9.-]+)\]/) ||
                    decoded.match(/\(([0-9.-]+),([0-9.-]+),([0-9.-]+),([0-9.-]+)\)/) ||
                    url.match(/bbox=([0-9.-]+),([0-9.-]+),([0-9.-]+),([0-9.-]+)/);
          if (m) {
            const qS = parseFloat(m[1]), qW = parseFloat(m[2]), qN = parseFloat(m[3]), qE = parseFloat(m[4]);
            for (const f of files) {
              const parts = f.replace('osm_', '').replace('.json', '').split('_').map(Number);
              if (parts.length === 4) {
                const fMidLat = (parts[0] + parts[2]) * 0.5;
                const fMidLon = (parts[1] + parts[3]) * 0.5;
                if (fMidLat >= qS && fMidLat <= qN && fMidLon >= qW && fMidLon <= qE) {
                  bestFile = f;
                  break;
                }
              }
            }
          }

          if (bestFile) {
            const data = fs.readFileSync(path.join(cacheDir, bestFile), 'utf-8');
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: data
            });
            return;
          }
        }
      } catch (_) {}
      await route.continue().catch(() => {});
    });
  } catch (_) {}
}

/**
 * Attaches listeners to track console errors, warnings, and pageerrors.
 * Provides an assertClean() method ensuring zero forbidden error patterns.
 * @param {import('@playwright/test').Page} page
 * @param {{ liveNetwork?: boolean }} [setupOptions]
 */
function setupConsoleHygiene(page, setupOptions = {}) {
  /** @type {string[]} */
  const pageErrors = [];
  /** @type {string[]} */
  const consoleErrors = [];
  /** @type {string[]} */
  const consoleWarnings = [];

  const onPageError = err => {
    pageErrors.push(err.message || String(err));
  };
  const onConsole = msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      consoleErrors.push(text);
    } else if (msg.type() === 'warning') {
      consoleWarnings.push(text);
    }
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsole);

  // Only attach Overpass cache-fallback proxy on deterministic cached tests, NEVER when liveNetwork=true
  if (!setupOptions.liveNetwork) {
    setupOverpassProxy(page);
  }

  return {
    pageErrors,
    consoleErrors,
    consoleWarnings,

    /**
     * Asserts console hygiene according to R3 & M4 requirements.
     * @param {{ allowUnhandled?: boolean }} [options]
     */
    assertClean(options = {}) {
      // 1. Zero ev.target.closest TypeErrors
      const closestErrors = pageErrors.filter(err =>
        /closest is not a function/i.test(err) || /ev\.target\.closest/i.test(err)
      );
      expect(closestErrors, 'Must have zero TypeError: ev.target.closest is not a function').toEqual([]);

      // 2. Zero file URI security errors and CORS errors
      const fileUriAndCors = [...pageErrors, ...consoleErrors, ...consoleWarnings].filter(msg =>
        /file:\/\/|CORS policy|Cross-Origin Request Blocked|Not allowed to load local resource|SecurityError/i.test(msg)
      );
      expect(fileUriAndCors, 'Must have zero File URI or CORS security warnings').toEqual([]);

      // 3. Zero unhandled page errors unless test explicitly tests uncaught behavior
      if (!options.allowUnhandled) {
        expect(pageErrors, 'Must have zero unhandled page errors').toEqual([]);
      }
    },

    detach() {
      page.off('pageerror', onPageError);
      page.off('console', onConsole);
    },
  };
}

/**
 * Waits for app bootstrap and WebGL initialization.
 * @param {import('@playwright/test').Page} page
 * @param {number} [timeout=45000]
 */
async function waitForAppReady(page, timeout = 45000) {
  await page.waitForFunction(() => {
    const m = /** @type {any} */ (window).__map3d;
    const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('view3dCanvas'));
    const gl = canvas && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    return m && m.state && typeof m.state.totalTriangles === 'number' && !!gl;
  }, { timeout });

  // Verify WebGL context on #view3dCanvas
  const webglStatus = await page.evaluate(() => {
    const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('view3dCanvas'));
    if (!canvas) return { ok: false, reason: 'missing_canvas' };
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return { ok: false, reason: 'missing_gl' };
    return { ok: true };
  });

  expect(webglStatus.ok, 'WebGL context must be initialized on #view3dCanvas').toBe(true);
}

/**
 * Waits for 3D model render to complete.
 * Strictly verifies #loadingOverlay3D hidden, #gisErrorBanner strictly hidden
 * (NEVER accepting 0-building DEM fallback 'Załadowano model terenu DEM'),
 * state.sceneData._fallback falsy, #btnRender3D enabled, #meshStatsBadge updated,
 * totalTriangles > 0, and optional title match.
 * @param {import('@playwright/test').Page} page
 * @param {string} [expectedTitleSubstring='']
 * @param {number} [timeout=45000]
 */
async function waitForRenderComplete(page, expectedTitleSubstring = '', timeout = 45000) {
  await page.waitForFunction((expectedSubstring) => {
    const overlay = document.getElementById('loadingOverlay3D');
    const banner = document.getElementById('gisErrorBanner');
    const btn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btnRender3D'));
    const badge = document.getElementById('meshStatsBadge')?.textContent || '';
    const st = /** @type {any} */ (window).__map3d && /** @type {any} */ (window).__map3d.state;
    const currentTitle = st?.sceneData?.title || st?.plaqueText || '';

    const overlayHidden = overlay && (
      overlay.classList.contains('hidden') ||
      window.getComputedStyle(overlay).display === 'none'
    );
    const bannerVisible = Boolean(
      banner &&
      !banner.classList.contains('hidden') &&
      window.getComputedStyle(banner).display !== 'none'
    );
    const isFallback = Boolean(st?.sceneData?._fallback);
    const btnEnabled = btn && !btn.disabled;

    // Wake immediately on terminal GIS error or 0-building DEM fallback so the test fails fast with diagnostics
    if (overlayHidden && btnEnabled && (bannerVisible || isFallback)) {
      return true;
    }

    const badgeValid = badge.includes('trójkątów') && !badge.includes('ERR:') && !badge.includes('Ładowanie siatki');
    const trianglesValid = st && typeof st.totalTriangles === 'number' && st.totalTriangles > 0;
    const titleMatches = expectedSubstring
      ? (currentTitle.toUpperCase().includes(expectedSubstring.toUpperCase()) ||
         (currentTitle.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase())
           .includes(expectedSubstring.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()))
      : true;

    return overlayHidden && !bannerVisible && !isFallback && btnEnabled && badgeValid && trianglesValid && titleMatches;
  }, expectedTitleSubstring, { timeout });

  const renderDiag = await page.evaluate(() => {
    const banner = document.getElementById('gisErrorBanner');
    const errText = document.getElementById('gisErrorText');
    const st = /** @type {any} */ (window).__map3d?.state;
    const bannerVisible = Boolean(
      banner &&
      !banner.classList.contains('hidden') &&
      window.getComputedStyle(banner).display !== 'none'
    );
    return {
      bannerVisible,
      bannerText: (errText?.textContent || banner?.textContent || '').trim(),
      isFallback: Boolean(st?.sceneData?._fallback),
    };
  });

  expect(
    renderDiag.bannerVisible,
    `#gisErrorBanner must remain hidden on render completion, got: "${renderDiag.bannerText}"`
  ).toBe(false);
  expect(
    renderDiag.isFallback,
    `Scene must NOT be a 0-building DEM fallback (state.sceneData._fallback=true; banner="${renderDiag.bannerText}")`
  ).toBe(false);
  await expect(page.locator('#gisErrorBanner')).toBeHidden();

  // Two requestAnimationFrame cycles for GPU frame presentation
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  return await page.evaluate(() => {
    const s = /** @type {any} */ (window).__map3d?.state;
    return {
      totalTriangles: s?.totalTriangles || 0,
      buildingCount: s?.sceneData?.buildings?.length || 0,
      isFallback: Boolean(s?.sceneData?._fallback),
      title: s?.plaqueText || s?.sceneData?.title || '',
      center: s?.sceneData?.center || null,
      spanMeters: s?.sceneData?.spanMeters || s?.mapSpanMeters || 0,
      lat: s?.mapCenterLat,
      lon: s?.mapCenterLon,
    };
  });
}

/**
 * Waits for GIS error banner to become visible and verifies overlay dismissal.
 * @param {import('@playwright/test').Page} page
 * @param {number} [timeout=30000]
 */
async function waitForGisError(page, timeout = 30000) {
  await page.waitForFunction(() => {
    const overlay = document.getElementById('loadingOverlay3D');
    const banner = document.getElementById('gisErrorBanner');
    const btn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btnRender3D'));

    const overlayHidden = overlay && (
      overlay.classList.contains('hidden') ||
      window.getComputedStyle(overlay).display === 'none'
    );
    const bannerVisible = banner && (
      !banner.classList.contains('hidden') &&
      window.getComputedStyle(banner).display !== 'none'
    );
    const btnEnabled = btn && !btn.disabled;

    return overlayHidden && bannerVisible && btnEnabled;
  }, null, { timeout });

  const errorText = await page.locator('#gisErrorText').textContent();
  return {
    errorText: (errorText || '').trim(),
    retryButtonVisible: await page.locator('#btnRetryGis').isVisible(),
  };
}

/**
 * Mocks Photon search responses to ensure fast, deterministic place autocomplete.
 * @param {import('@playwright/test').Page} page
 * @param {string} query
 * @param {Array<{ name: string, city?: string, state?: string, country?: string, lat: number, lon: number, type?: string, osm_value?: string }>} featureList
 */
async function mockPhotonPlaceSearch(page, query, featureList) {
  await page.route('**/photon.komoot.io/**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'FeatureCollection',
        features: featureList.map(item => ({
          type: 'Feature',
          properties: {
            name: item.name,
            city: item.city || item.name,
            state: item.state || '',
            country: item.country || '',
            type: item.type || 'city',
            osm_value: item.osm_value || 'city',
          },
          geometry: {
            type: 'Point',
            coordinates: [item.lon, item.lat],
          },
        })),
      }),
    });
  });
}

/**
 * Mocks GIS network endpoints to fail with specified status.
 * @param {import('@playwright/test').Page} page
 * @param {number} [status=500]
 * @param {string} [errorMessage='Simulated GIS failure']
 */
async function mockGisFailure(page, status = 500, errorMessage = 'Simulated GIS failure') {
  await page.route('**/api/gis**', async route => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ error: errorMessage }),
    });
  });
  await page.route('**/api/interpreter**', async route => {
    await route.fulfill({
      status,
      contentType: 'text/plain',
      body: errorMessage,
    });
  });
  await page.route('**/*overpass*/**', async route => {
    await route.fulfill({
      status,
      contentType: 'text/plain',
      body: errorMessage,
    });
  });
  await page.route('**/*terrarium*/**', async route => {
    await route.fulfill({
      status,
      contentType: 'text/plain',
      body: errorMessage,
    });
  });
  await page.route('**/*elevation*/**', async route => {
    await route.fulfill({
      status,
      contentType: 'text/plain',
      body: errorMessage,
    });
  });
  await page.route('**/*elevation-tiles-prod*/**', async route => {
    await route.fulfill({
      status,
      contentType: 'text/plain',
      body: errorMessage,
    });
  });
  await page.route('**/cache/scene_v5_*.json', async route => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ error: errorMessage }),
    });
  });
}

/**
 * Mocks GIS network endpoints to hang indefinitely (to test watchdog).
 * @param {import('@playwright/test').Page} page
 */
async function mockGisHang(page) {
  await page.route('**/api/gis**', () => {});
  await page.route('**/api/interpreter**', () => {});
  await page.route('**/*overpass*/**', () => {});
  await page.route('**/*elevation-tiles-prod*/**', () => {});
  await page.route('**/cache/scene_v5_*.json', () => {});
}

/**
 * Restores normal GIS routing after mockGisFailure or route interception.
 * @param {import('@playwright/test').Page} page
 */
async function unmockGis(page) {
  await page.unroute('**/api/gis**').catch(() => {});
  await page.unroute('**/api/interpreter**').catch(() => {});
  await page.unroute('**/*overpass*/**').catch(() => {});
  await page.unroute('**/*interpreter*').catch(() => {});
  await page.unroute('**/*terrarium*/**').catch(() => {});
  await page.unroute('**/*elevation*/**').catch(() => {});
  await page.unroute('**/*elevation-tiles-prod*/**').catch(() => {});
  await page.unroute('**/cache/scene_v5_*.json').catch(() => {});
  await setupOverpassProxy(page);
}

/**
 * Attaches a main-thread responsiveness monitor utilizing PerformanceObserver
 * for 'longtask' entries and a high-frequency interval drift heartbeat.
 * Verifies R2 requirement: no single continuous task blocks the main thread for >2,000 ms.
 *
 * @param {import('@playwright/test').Page} page
 */
async function setupResponsivenessMonitor(page) {
  const initFn = () => {
    if (window.__responsivenessMonitor) {
      window.__responsivenessMonitor.active = true;
      return;
    }
    window.__responsivenessMonitor = {
      tasks: [],
      maxDrift: 0,
      active: true,
      lastTick: performance.now(),
      observer: null,
      timerId: null,
    };

    if (typeof PerformanceObserver !== 'undefined') {
      try {
        const obs = new PerformanceObserver((list) => {
          if (!window.__responsivenessMonitor || !window.__responsivenessMonitor.active) return;
          for (const entry of list.getEntries()) {
            window.__responsivenessMonitor.tasks.push({
              duration: Math.round(entry.duration),
              startTime: Math.round(entry.startTime),
              name: entry.name,
            });
          }
        });
        obs.observe({ entryTypes: ['longtask'] });
        window.__responsivenessMonitor.observer = obs;
      } catch (e) {
        console.warn('Longtask observer init failed:', e);
      }
    }

    window.__responsivenessMonitor.timerId = setInterval(() => {
      if (!window.__responsivenessMonitor || !window.__responsivenessMonitor.active) return;
      const now = performance.now();
      const delta = now - window.__responsivenessMonitor.lastTick;
      window.__responsivenessMonitor.lastTick = now;
      const drift = Math.max(0, delta - 50);
      if (drift > window.__responsivenessMonitor.maxDrift) {
        window.__responsivenessMonitor.maxDrift = Math.round(drift);
      }
    }, 50);
  };

  await page.addInitScript(initFn);
  try {
    await page.evaluate(initFn);
  } catch {
    // Document not yet ready
  }

  return {
    /**
     * Resets task accumulation to measure a specific operation window
     * (e.g. right before city fetch and 3D rendering).
     */
    async reset() {
      await page.evaluate(() => {
        if (window.__responsivenessMonitor) {
          window.__responsivenessMonitor.tasks = [];
          window.__responsivenessMonitor.maxDrift = 0;
          window.__responsivenessMonitor.lastTick = performance.now();
          window.__responsivenessMonitor.active = true;
        }
      });
    },

    /**
     * Retrieves aggregated performance stats and tasks.
     */
    async getReport() {
      await page.evaluate(() => new Promise(r => setTimeout(r, 60)));
      return await page.evaluate(() => {
        const m = window.__responsivenessMonitor || { tasks: [], maxDrift: 0 };
        const tasks = m.tasks || [];
        const maxTaskDuration = tasks.length > 0 ? Math.max(...tasks.map(t => t.duration)) : 0;
        const tasksOver2s = tasks.filter(t => t.duration > 2000);
        const tasksOver500ms = tasks.filter(t => t.duration > 500);
        const totalBlockedMs = tasks.reduce((sum, t) => sum + t.duration, 0);

        return {
          totalLongTasks: tasks.length,
          maxTaskDurationMs: maxTaskDuration,
          maxDriftMs: m.maxDrift,
          totalBlockedMs,
          tasksOver2s,
          tasksOver500ms,
          tasks,
        };
      });
    },

    /**
     * Asserts that no continuous main-thread block exceeded the threshold (default: 2,000 ms).
     * @param {number} [maxAllowedTaskMs=2000]
     */
    async assertResponsive(maxAllowedTaskMs = 2000) {
      const report = await this.getReport();
      expect(
        report.tasksOver2s,
        `Main thread blocked for >2000ms: ${JSON.stringify(report.tasksOver2s)}`
      ).toEqual([]);
      expect(
        report.maxTaskDurationMs,
        `Max single task duration (${report.maxTaskDurationMs}ms) must not exceed ${maxAllowedTaskMs}ms`
      ).toBeLessThanOrEqual(maxAllowedTaskMs);
    },

    async detach() {
      await page.evaluate(() => {
        if (window.__responsivenessMonitor) {
          window.__responsivenessMonitor.active = false;
          if (window.__responsivenessMonitor.timerId) clearInterval(window.__responsivenessMonitor.timerId);
          if (window.__responsivenessMonitor.observer) window.__responsivenessMonitor.observer.disconnect();
        }
      });
    },
  };
}

/**
 * Asserts that active settings were correctly persisted to localStorage.
 * @param {import('@playwright/test').Page} page
 * @param {object} expected
 */
async function assertLocalStorageConfig(page, expected) {
  const raw = await page.evaluate(() => window.localStorage.getItem('map3d_active_config'));
  expect(raw, 'localStorage[map3d_active_config] must exist').toBeTruthy();
  const cfg = JSON.parse(raw);

  if (expected.city) {
    expect(cfg.city?.toUpperCase()).toContain(expected.city.toUpperCase());
  }
  if (expected.lat !== undefined) {
    expect(cfg.lat).toBeCloseTo(expected.lat, 2);
  }
  if (expected.lon !== undefined) {
    expect(cfg.lon).toBeCloseTo(expected.lon, 2);
  }
  if (expected.spanKm !== undefined) {
    expect(cfg.spanKm).toBeCloseTo(expected.spanKm, 1);
  }
  if (expected.targetW !== undefined) {
    expect(cfg.targetW).toBe(expected.targetW);
  }
  if (expected.targetH !== undefined) {
    expect(cfg.targetH).toBe(expected.targetH);
  }
  return cfg;
}

const SCREENSHOTS_DIR = path.resolve(__dirname, 'screenshots');

/**
 * Captures and inspects a screenshot of the page or a specific locator.
 * Verifies file existence, non-zero file size, PNG magic header, and minimum entropy.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator | null} targetLocator - Locator to screenshot, or null for full page
 * @param {string} filename - Filename inside tests/e2e/screenshots/
 * @param {object} [options]
 * @param {number} [options.minBytes=15000] - Minimum acceptable PNG file size
 * @param {number} [options.minWidth=500] - Expected minimum width
 * @param {number} [options.minHeight=300] - Expected minimum height
 * @returns {Promise<{ buffer: Buffer, filePath: string, width: number, height: number, size: number }>}
 */
async function captureAndInspectScreenshot(page, targetLocator, filename, options = {}) {
  const minBytes = options.minBytes || 15000;
  const minWidth = options.minWidth || 500;
  const minHeight = options.minHeight || 300;
  const filePath = path.join(SCREENSHOTS_DIR, filename);

  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  // Ensure GPU presentation has completed two animation frames
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

  /** @type {Buffer} */
  let buffer;
  if (targetLocator) {
    buffer = await targetLocator.screenshot({ path: filePath });
  } else {
    buffer = await page.screenshot({ path: filePath });
  }

  expect(fs.existsSync(filePath), `Screenshot file ${filename} must exist on disk`).toBe(true);
  const stat = fs.statSync(filePath);
  expect(stat.size, `File size of ${filename} must match buffer length`).toBe(buffer.length);
  expect(stat.size, `Screenshot ${filename} (${stat.size} bytes) must exceed minimum threshold (${minBytes} bytes)`).toBeGreaterThan(minBytes);

  // Inspect PNG Magic Bytes (0x89, 'P', 'N', 'G')
  expect(buffer[0], 'First byte must be 0x89').toBe(0x89);
  expect(buffer.toString('ascii', 1, 4), 'Bytes 1-3 must be PNG').toBe('PNG');

  // Inspect PNG IHDR dimensions (offset 16: width, offset 20: height)
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  expect(width, `Image width (${width}px) must be >= ${minWidth}px`).toBeGreaterThanOrEqual(minWidth);
  expect(height, `Image height (${height}px) must be >= ${minHeight}px`).toBeGreaterThanOrEqual(minHeight);

  return { buffer, filePath, width, height, size: stat.size };
}

/**
 * Reads a center sample of WebGL pixels from #view3dCanvas to verify non-blank rendering.
 * @param {import('@playwright/test').Page} page
 */
async function assertWebGLCanvasNotBlank(page) {
  const sample = await page.evaluate(() => {
    const canvas = document.getElementById('view3dCanvas');
    if (!canvas) return { ok: false, reason: 'missing_canvas' };
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return { ok: false, reason: 'missing_gl' };

    const w = 32, h = 32;
    const x = Math.max(0, Math.floor(canvas.width / 2 - w / 2));
    const y = Math.max(0, Math.floor(canvas.height / 2 - h / 2));
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let nonZeroRgb = 0;
    const uniqueColors = new Set();
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      if (r > 10 || g > 10 || b > 10) nonZeroRgb++;
      uniqueColors.add((r << 16) | (g << 8) | b);
    }
    return {
      ok: true,
      totalPixels: w * h,
      nonZeroPixels: nonZeroRgb,
      uniqueColorCount: uniqueColors.size
    };
  });

  expect(sample.ok, 'WebGL context must be readable via gl.readPixels').toBe(true);
  expect(sample.nonZeroPixels, 'Center pixels must not be pure black').toBeGreaterThan(sample.totalPixels * 0.5);
  expect(sample.uniqueColorCount, 'Scene must display color variation across geometry').toBeGreaterThan(2);
}

/**
 * Samples a central 192x192 region of #view3dCanvas via gl.readPixels and verifies
 * genuine 3D shading diversity (unique RGB colors, luminance variance, and spatial
 * edge contrast from building walls, roofs, streets, and directional cast shadows).
 * @param {import('@playwright/test').Page} page
 * @param {{ minUniqueColors?: number, minLumStdDev?: number, minEdgeTransitions?: number }} [options]
 */
async function assertWebGL3DShadingDiversity(page, options = {}) {
  const minUniqueColors = options.minUniqueColors ?? 20;
  const minLumStdDev = options.minLumStdDev ?? 2.0;
  const minEdgeTransitions = options.minEdgeTransitions ?? 80;

  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

  const metrics = await page.evaluate(() => {
    const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('view3dCanvas'));
    if (!canvas) return { ok: false, reason: 'missing_canvas' };
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return { ok: false, reason: 'missing_gl' };

    const studio = /** @type {any} */ (window).__map3d?.studio;
    if (studio && typeof studio.render === 'function') {
      studio.render(true);
    }

    const w = Math.min(192, Math.max(32, Math.floor(canvas.width * 0.35)));
    const h = Math.min(192, Math.max(32, Math.floor(canvas.height * 0.35)));
    const x = Math.max(0, Math.floor(canvas.width / 2 - w / 2));
    const y = Math.max(0, Math.floor(canvas.height / 2 - h / 2));
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const n = w * h;
    const lums = new Float32Array(n);
    const uniqueColors = new Set();
    let nonZeroRgb = 0;
    let lumSum = 0;

    for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      if (r > 10 || g > 10 || b > 10) nonZeroRgb++;
      uniqueColors.add((r << 16) | (g << 8) | b);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      lums[p] = lum;
      lumSum += lum;
    }

    const lumMean = lumSum / n;
    let varSum = 0;
    for (let p = 0; p < n; p++) {
      const d = lums[p] - lumMean;
      varSum += d * d;
    }
    const lumStdDev = Math.sqrt(varSum / n);

    let edgeTransitions = 0;
    const quadrantSums = [0, 0, 0, 0];
    const quadrantCounts = [0, 0, 0, 0];
    const halfW = w >> 1;
    const halfH = h >> 1;

    for (let py = 0; py < h; py++) {
      const rowOff = py * w;
      for (let px = 0; px < w; px++) {
        const cur = lums[rowOff + px];
        if (px + 1 < w && Math.abs(lums[rowOff + px + 1] - cur) >= 5.0) {
          edgeTransitions++;
        }
        if (py + 1 < h && Math.abs(lums[rowOff + w + px] - cur) >= 5.0) {
          edgeTransitions++;
        }
        const qIdx = (py >= halfH ? 2 : 0) + (px >= halfW ? 1 : 0);
        quadrantSums[qIdx] += cur;
        quadrantCounts[qIdx]++;
      }
    }

    const quadrantMeans = quadrantSums.map((s, idx) =>
      Math.round((s / Math.max(1, quadrantCounts[idx])) * 100) / 100
    );

    return {
      ok: true,
      sampleWidth: w,
      sampleHeight: h,
      totalPixels: n,
      nonZeroPixels: nonZeroRgb,
      uniqueColorCount: uniqueColors.size,
      lumMean: Math.round(lumMean * 100) / 100,
      lumStdDev: Math.round(lumStdDev * 100) / 100,
      edgeTransitions,
      quadrantMeans,
    };
  });

  expect(metrics.ok, 'WebGL context must be readable via gl.readPixels').toBe(true);
  expect(metrics.nonZeroPixels, 'WebGL sample must not be pure black').toBeGreaterThan(metrics.totalPixels * 0.6);
  expect(
    metrics.uniqueColorCount,
    `WebGL 3D scene must exhibit shading diversity (>= ${minUniqueColors} unique RGB colors, got ${metrics.uniqueColorCount})`
  ).toBeGreaterThanOrEqual(minUniqueColors);
  expect(
    metrics.lumStdDev,
    `WebGL 3D scene must have non-flat luminance variance (>= ${minLumStdDev}, got ${metrics.lumStdDev})`
  ).toBeGreaterThanOrEqual(minLumStdDev);
  expect(
    metrics.edgeTransitions,
    `WebGL 3D scene must contain spatial 3D building/shadow edges (>= ${minEdgeTransitions}, got ${metrics.edgeTransitions})`
  ).toBeGreaterThanOrEqual(minEdgeTransitions);

  return metrics;
}

/**
 * Installs a pass-through Photon Komoot autocomplete handler that uses live
 * https://photon.komoot.io/api/ first and falls back to accurate city coordinates
 * ONLY if live Photon rate-limits (HTTP 429/5xx) or times out.
 * Never touches GIS/Overpass/DEM endpoints.
 * @param {import('@playwright/test').Page} page
 * @param {Array<{ query: string, name: string, city?: string, state?: string, country?: string, lat: number, lon: number }>} fallbackCities
 */
async function setupLivePhotonWithFallback(page, fallbackCities) {
  /** @type {Array<{ query: string, source: 'live' | 'fallback', status?: number }>} */
  const events = [];

  await page.route('**/photon.komoot.io/**', async (route) => {
    const reqUrl = route.request().url();
    let qParam = '';
    try {
      qParam = new URL(reqUrl).searchParams.get('q') || '';
    } catch (_) {}

    const normQ = normalizeTitle(qParam);
    const matchedCity = fallbackCities.find(c =>
      normQ.includes(normalizeTitle(c.query)) ||
      normalizeTitle(c.query).includes(normQ) ||
      normQ.includes(normalizeTitle(c.name))
    ) || fallbackCities[0];

    try {
      const resp = await route.fetch({
        headers: {
          ...route.request().headers(),
          'User-Agent': 'Map3DStudio-LiveUserJourney/2.0',
        },
        timeout: 5000,
      });
      if (resp.ok()) {
        const data = await resp.json();
        const features = Array.isArray(data?.features) ? data.features : [];
        const hasNearMatch = matchedCity
          ? features.some(f => {
              const coords = f?.geometry?.coordinates;
              return Array.isArray(coords) &&
                Math.abs(coords[1] - matchedCity.lat) < 0.6 &&
                Math.abs(coords[0] - matchedCity.lon) < 0.6;
            })
          : features.length > 0;

        if (features.length > 0 && hasNearMatch) {
          events.push({ query: qParam, source: 'live', status: resp.status() });
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(data),
          });
          return;
        }
      }
    } catch (_) {
      // Live Photon timed out or errored; supply fallback suggestion below
    }

    events.push({ query: qParam, source: 'fallback' });
    const list = matchedCity ? [matchedCity] : fallbackCities;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'FeatureCollection',
        features: list.map(item => ({
          type: 'Feature',
          properties: {
            name: item.name,
            city: item.city || item.name,
            state: item.state || '',
            country: item.country || '',
            type: 'city',
            osm_value: 'city',
          },
          geometry: {
            type: 'Point',
            coordinates: [item.lon, item.lat],
          },
        })),
      }),
    });
  });

  return events;
}

module.exports = {
  TEST_LOCATIONS,
  normalizeTitle,
  setupConsoleHygiene,
  waitForAppReady,
  waitForRenderComplete,
  waitForGisError,
  mockPhotonPlaceSearch,
  setupLivePhotonWithFallback,
  mockGisFailure,
  mockGisHang,
  unmockGis,
  setupOverpassProxy,
  setupResponsivenessMonitor,
  assertLocalStorageConfig,
  captureAndInspectScreenshot,
  assertWebGLCanvasNotBlank,
  assertWebGL3DShadingDiversity,
};
