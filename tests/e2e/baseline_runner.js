#!/usr/bin/env node
// @ts-check
/**
 * Standalone Baseline Benchmark CLI Runner for Milestone 1 (R1).
 * Executes automated E2E browser benchmarks for Warsaw and New York,
 * measures high-resolution execution time from city selection to complete 3D preview,
 * verifies WebGL context and zero-error integrity, logs summary tables,
 * and writes structured results to tests/e2e/reports/baseline_timing.json.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8765';
const REPORT_DIR = path.resolve(__dirname, 'reports');
const REPORT_PATH = path.join(REPORT_DIR, 'baseline_timing.json');

const isMac = process.platform === 'darwin';
const glFlags = isMac
  ? ['--use-gl=angle', '--use-angle=metal']
  : ['--use-gl=angle', '--use-angle=swiftshader'];

const CITIES = [
  {
    id: 'warsaw_1_2km',
    city: 'WARSZAWA',
    displayName: 'Warsaw (Old Town)',
    bbox: [52.2415, 21.0050, 52.2525, 21.0220],
    spanKm: 1.2,
    titleMatch: 'WARSZAWA',
    titleArg: 'WARSZAWA',
  },
  {
    id: 'new_york_1_2km',
    city: 'NEW YORK',
    displayName: 'New York (Central Park)',
    bbox: [40.7606, -73.9839, 40.7722, -73.9729],
    spanKm: 1.2,
    titleMatch: 'CENTRAL PARK',
    titleArg: 'NYC CENTRAL PARK',
  },
];

async function runBenchmark() {
  console.log('='.repeat(72));
  console.log(' MAP-TO-3DPRINT: MILESTONE 1 BASELINE BENCHMARK RUNNER');
  console.log('='.repeat(72));
  console.log(`Target URL:      ${BASE_URL}`);
  console.log(`Platform:        ${process.platform} (${process.arch})`);
  console.log(`Node.js:         ${process.version}`);
  console.log(`Report Output:   ${REPORT_PATH}`);
  console.log('-'.repeat(72));

  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const epochStartMs = Date.now();
  const benchmarkResults = {};

  const browser = await chromium.launch({
    channel: 'chromium',
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

  const browserVersion = browser.version();
  console.log(`Chromium Version: ${browserVersion}`);

  const page = await browser.newPage();
  const globalPageErrors = [];
  const globalConsoleErrors = [];
  const globalConsoleWarnings = [];

  page.on('pageerror', err => {
    globalPageErrors.push(err.message || String(err));
  });
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') globalConsoleErrors.push(text);
    else if (msg.type() === 'warning') globalConsoleWarnings.push(text);
  });

  // Step 1: Initial navigation & WebGL detection
  console.log('\n[1/3] Navigating to studio & warming WebGL engine...');
  const navStart = performance.now();
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });

  await page.waitForFunction(() => {
    const m = window.__map3d;
    return m && m.state && typeof m.state.totalTriangles === 'number' && m.state.totalTriangles > 0;
  }, { timeout: 45000 });

  const navElapsed = performance.now() - navStart;
  console.log(`      Studio bootstrapped in ${navElapsed.toFixed(2)} ms.`);

  const webglMeta = await page.evaluate(() => {
    const canvas = document.getElementById('view3dCanvas');
    if (!canvas) return { supported: false, error: 'canvas_view3dCanvas_not_found' };
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return { supported: false, error: 'no_webgl_context' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      supported: true,
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    };
  });

  console.log(`      WebGL Vendor:   ${webglMeta.vendor || 'N/A'}`);
  console.log(`      WebGL Renderer: ${webglMeta.renderer || 'N/A'}`);
  if (!webglMeta.supported) {
    throw new Error('WebGL is not supported in headless browser: ' + webglMeta.error);
  }

  // Step 2: Run benchmarks for each city
  console.log('\n[2/3] Running City Selection Baseline Benchmarks...');

  for (const city of CITIES) {
    console.log(`\n  >> Benchmarking ${city.displayName} [${city.bbox.join(', ')}]...`);
    const runStartEpoch = Date.now();
    const runStartMonotonic = performance.now();

    const perCityPageErrors = [];
    const perCityConsoleErrors = [];
    const errorListener = err => perCityPageErrors.push(err.message || String(err));
    const consoleListener = msg => {
      if (msg.type() === 'error') perCityConsoleErrors.push(msg.text());
    };
    page.on('pageerror', errorListener);
    page.on('console', consoleListener);

    // Trigger city fetch with high-res timestamp
    const triggerEpochMs = Date.now();
    const triggerMonotonicMs = performance.now();

    await page.evaluate(({ bbox, title }) => {
      window.performance.mark('benchmark:trigger-start');
      window.__map3d.fetchRealGISAndRender(bbox, title);
    }, { bbox: city.bbox, title: city.titleArg });

    // Wait for completion: loadingOverlay3D hidden, btnRender3D enabled, triangles > 0, title matches
    await page.waitForFunction((expectedSubstring) => {
      const overlay = document.getElementById('loadingOverlay3D');
      const banner = document.getElementById('gisErrorBanner');
      const btn = document.getElementById('btnRender3D');
      const badge = document.getElementById('meshStatsBadge')?.textContent || '';
      const st = window.__map3d && window.__map3d.state;
      const currentTitle = st?.sceneData?.title || '';

      const overlayHidden = overlay && (
        overlay.classList.contains('hidden') ||
        window.getComputedStyle(overlay).display === 'none'
      );
      const bannerHidden = !banner || (
        banner.classList.contains('hidden') ||
        window.getComputedStyle(banner).display === 'none'
      );
      const btnEnabled = btn && !btn.disabled;
      const badgeValid = badge.includes('trójkątów') && !badge.includes('ERR:');
      const trianglesValid = st && typeof st.totalTriangles === 'number' && st.totalTriangles > 0;
      const titleMatches = currentTitle.includes(expectedSubstring);

      return overlayHidden && bannerHidden && btnEnabled && badgeValid && trianglesValid && titleMatches;
    }, city.titleMatch, { timeout: 45000 });

    // Wait 2 requestAnimationFrame cycles for GPU presentation
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const completeEpochMs = Date.now();
    const completeMonotonicMs = performance.now();
    const harnessElapsedMs = completeMonotonicMs - triggerMonotonicMs;

    const inPageElapsedMs = await page.evaluate(() => {
      window.performance.mark('benchmark:render-end');
      try {
        window.performance.measure('benchmark:city-to-render', 'benchmark:trigger-start', 'benchmark:render-end');
        const entries = performance.getEntriesByName('benchmark:city-to-render');
        return entries.length > 0 ? entries[entries.length - 1].duration : null;
      } catch (_) {
        return null;
      }
    });

    const sceneMetrics = await page.evaluate(() => {
      const st = window.__map3d?.state;
      const scene = st?.sceneData || {};
      return {
        totalTriangles: st?.totalTriangles || 0,
        buildingCount: Array.isArray(scene.buildings) ? scene.buildings.length : 0,
        waterPolys: Array.isArray(scene.water) ? scene.water.length : 0,
        roadCount: Array.isArray(scene.roads) ? scene.roads.length : 0,
        greeneryCount: Array.isArray(scene.greenery) ? scene.greenery.length : 0,
        spanMeters: scene.spanMeters || 1200,
        title: scene.title || '',
      };
    });

    const badgeText = await page.locator('#meshStatsBadge').textContent();

    page.off('pageerror', errorListener);
    page.off('console', consoleListener);

    const closestErrors = perCityPageErrors.filter(e => /closest is not a function/i.test(e));
    const fileUriErrors = [...perCityPageErrors, ...perCityConsoleErrors].filter(e => /file:\/\/|CORS policy/i.test(e));
    const isHealthy = perCityPageErrors.length === 0 && closestErrors.length === 0 && fileUriErrors.length === 0;

    console.log(`     Harness E2E Duration:     ${harnessElapsedMs.toFixed(2)} ms`);
    console.log(`     Browser In-Page Duration: ${inPageElapsedMs !== null ? inPageElapsedMs.toFixed(2) + ' ms' : 'N/A'}`);
    console.log(`     Total Triangles:          ${sceneMetrics.totalTriangles.toLocaleString('en-US')}`);
    console.log(`     Building Count:           ${sceneMetrics.buildingCount}`);
    console.log(`     Mesh Stats Badge:         ${badgeText}`);
    console.log(`     Health Status:            ${isHealthy ? 'PASS (0 errors)' : 'FAIL (' + perCityPageErrors.length + ' errors)'}`);

    benchmarkResults[city.id] = {
      id: city.id,
      city: city.city,
      displayName: city.displayName,
      bbox: city.bbox,
      spanKm: city.spanKm,
      cacheHit: true,
      iterations: [
        {
          run: 1,
          timings: {
            startEpochMs: runStartEpoch,
            triggerEpochMs,
            renderCompleteEpochMs: completeEpochMs,
            harnessElapsedMs: Number(harnessElapsedMs.toFixed(2)),
            browserInternalMs: inPageElapsedMs !== null ? Number(inPageElapsedMs.toFixed(2)) : null,
          },
          sceneMetrics,
        },
      ],
      stats: {
        runsCount: 1,
        meanHarnessElapsedMs: Number(harnessElapsedMs.toFixed(2)),
        meanBrowserInternalMs: inPageElapsedMs !== null ? Number(inPageElapsedMs.toFixed(2)) : null,
        minElapsedMs: Number(harnessElapsedMs.toFixed(2)),
        maxElapsedMs: Number(harnessElapsedMs.toFixed(2)),
      },
      health: {
        status: isHealthy ? 'PASS' : 'FAIL',
        pageErrorsCount: perCityPageErrors.length,
        consoleErrorsCount: perCityConsoleErrors.length,
        closestErrorsDetected: closestErrors.length > 0,
        fileUriErrorsDetected: fileUriErrors.length > 0,
      },
    };
  }

  await browser.close();

  // Step 3: Write report file
  console.log('\n[3/3] Saving Structured Baseline Report...');

  const reportData = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    meta: {
      milestone: 'M1_BASELINE',
      timestamp: new Date().toISOString(),
      epochStartMs,
      epochEndMs: Date.now(),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      browser: `Chromium ${browserVersion}`,
      webgl: webglMeta,
    },
    benchmarks: benchmarkResults,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(reportData, null, 2), 'utf8');
  console.log(`      Wrote ${REPORT_PATH}`);

  // Summary Table
  console.log('\n' + '='.repeat(72));
  console.log(' BASELINE PERFORMANCE SUMMARY');
  console.log('='.repeat(72));
  console.log(
    'City'.padEnd(26) +
    'Triangles'.padStart(12) +
    'Buildings'.padStart(12) +
    'E2E Time (ms)'.padStart(16) +
    'Status'.padStart(6)
  );
  console.log('-'.repeat(72));

  for (const [id, res] of Object.entries(benchmarkResults)) {
    const iter = res.iterations[0];
    console.log(
      res.displayName.padEnd(26) +
      iter.sceneMetrics.totalTriangles.toLocaleString('en-US').padStart(12) +
      iter.sceneMetrics.buildingCount.toLocaleString('en-US').padStart(12) +
      iter.timings.harnessElapsedMs.toFixed(2).padStart(16) +
      res.health.status.padStart(6)
    );
  }
  console.log('='.repeat(72));

  // Assert all benchmarks passed
  const allPassed = Object.values(benchmarkResults).every(r => r.health.status === 'PASS');
  if (!allPassed) {
    console.error('\nBenchmark FAILED: health check detected errors during execution.');
    process.exit(1);
  }

  console.log('\nBaseline benchmark execution completed successfully with exit code 0.\n');
}

if (require.main === module) {
  runBenchmark().catch(err => {
    console.error('\nFatal error in baseline runner:', err);
    process.exit(1);
  });
}

module.exports = { runBenchmark };
