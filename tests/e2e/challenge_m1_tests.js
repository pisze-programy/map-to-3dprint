/**
 * Empirical Challenge Harness for Milestone 1
 * Challenger 2 (Empirical Reviewer)
 */

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8765';
const isMac = process.platform === 'darwin';
const glFlags = isMac
  ? ['--use-gl=angle', '--use-angle=metal']
  : ['--use-gl=angle', '--use-angle=swiftshader'];

const standardLaunchArgs = [
  ...glFlags,
  '--enable-webgl',
  '--enable-webgl2-compute-context',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--no-sandbox',
  '--disable-dev-shm-usage',
];

async function runAllChallenges() {
  const results = [];

  console.log('='.repeat(70));
  console.log('STARTING EMPIRICAL CHALLENGE SUITE FOR MILESTONE 1');
  console.log('='.repeat(70));

  // --------------------------------------------------------------------------
  // EXPERIMENT 1: Error Catching Rigor
  // --------------------------------------------------------------------------
  console.log('\n--- EXPERIMENT 1: Error Catching Rigor ---');

  // Test 1A: Page uncaught error detection
  {
    const browser = await chromium.launch({ headless: true, args: standardLaunchArgs });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message || String(err)));

    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__map3d?.state?.totalTriangles > 0, { timeout: 45000 });

    // Inject an uncaught error
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('Simulated uncaught exception in page');
      }, 50);
    });
    await page.waitForTimeout(300);

    const caught = pageErrors.some(e => e.includes('Simulated uncaught exception'));
    results.push({
      test: '1A_uncaught_error_detection',
      pass: caught,
      details: caught ? 'PASS: Uncaught exception caught by pageerror' : 'FAIL: Uncaught exception missed'
    });
    console.log(`1A: Uncaught Exception Detected: ${caught ? 'YES' : 'NO'}`);
    await browser.close();
  }

  // Test 1B: ev.target.closest TypeError detection
  {
    const browser = await chromium.launch({ headless: true, args: standardLaunchArgs });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message || String(err)));

    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__map3d?.state?.totalTriangles > 0, { timeout: 45000 });

    // Trigger ev.target.closest error
    await page.evaluate(() => {
      setTimeout(() => {
        const dummyTarget = {};
        try {
          dummyTarget.closest('.btn');
        } catch (e) {
          // If unhandled:
          throw e;
        }
      }, 50);
    });
    await page.waitForTimeout(300);

    const closestCaught = pageErrors.some(e => /closest is not a function/i.test(e));
    results.push({
      test: '1B_closest_typeerror_detection',
      pass: closestCaught,
      details: closestCaught ? 'PASS: ev.target.closest TypeError caught' : 'FAIL: ev.target.closest error missed'
    });
    console.log(`1B: closest TypeError Detected: ${closestCaught ? 'YES' : 'NO'}`);
    await browser.close();
  }

  // Test 1C: Unhandled Promise Rejection detection
  {
    const browser = await chromium.launch({ headless: true, args: standardLaunchArgs });
    const page = await browser.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message || String(err)));
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__map3d?.state?.totalTriangles > 0, { timeout: 45000 });

    // Inject unhandled promise rejection
    await page.evaluate(() => {
      Promise.reject(new Error('Simulated GIS AggregateError / Promise.any failure'));
    });
    await page.waitForTimeout(500);

    const caughtInPageError = pageErrors.some(e => e.includes('Simulated GIS AggregateError'));
    const caughtInConsoleError = consoleErrors.some(e => e.includes('Simulated GIS AggregateError'));

    console.log(`1C: Unhandled Promise Rejection -> in pageerror: ${caughtInPageError}, in console.error: ${caughtInConsoleError}`);
    results.push({
      test: '1C_unhandled_promise_rejection',
      caughtInPageError,
      caughtInConsoleError,
      pass: caughtInPageError || caughtInConsoleError,
      details: `pageerror=${caughtInPageError}, console.error=${caughtInConsoleError}`
    });
    await browser.close();
  }

  // Test 1D: Console.error assert rigor in baseline_runner.spec.js
  {
    const browser = await chromium.launch({ headless: true, args: standardLaunchArgs });
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__map3d?.state?.totalTriangles > 0, { timeout: 45000 });

    // Inject console.error
    await page.evaluate(() => {
      console.error('Critical GIS pipeline breakdown simulation');
    });
    await page.waitForTimeout(200);

    const detected = consoleErrors.some(e => e.includes('Critical GIS pipeline breakdown'));
    console.log(`1D: console.error captured by console listener: ${detected ? 'YES' : 'NO'}`);
    results.push({
      test: '1D_console_error_capture',
      pass: detected,
      details: `Console listener captured: ${detected}`
    });
    await browser.close();
  }

  // --------------------------------------------------------------------------
  // EXPERIMENT 2: Infinite Loader & Timeout Rigor
  // --------------------------------------------------------------------------
  console.log('\n--- EXPERIMENT 2: Infinite Loader & Timeout Handling ---');

  // Test 2A: Infinite loader timeout detection
  {
    const browser = await chromium.launch({ headless: true, args: standardLaunchArgs });
    const page = await browser.newPage();

    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__map3d?.state?.totalTriangles > 0, { timeout: 45000 });

    // Lock loadingOverlay3D so it never hides
    await page.evaluate(() => {
      const overlay = document.getElementById('loadingOverlay3D');
      overlay.classList.remove('hidden');
      overlay.style.display = 'flex';
      // Override remove to never remove hidden
      const origRemove = overlay.classList.remove.bind(overlay.classList);
      overlay.classList.remove = (...args) => {
        const filtered = args.filter(a => a !== 'hidden');
        if (filtered.length) origRemove(...filtered);
      };
    });

    const tStart = performance.now();
    let timeoutCaught = false;
    let elapsedMs = 0;

    try {
      // Test with short timeout 3000ms to see if waitForFunction properly throws
      await page.waitForFunction(() => {
        const overlay = document.getElementById('loadingOverlay3D');
        const overlayHidden = overlay && (
          overlay.classList.contains('hidden') ||
          window.getComputedStyle(overlay).display === 'none'
        );
        return overlayHidden;
      }, null, { timeout: 3000 });
    } catch (e) {
      timeoutCaught = true;
      elapsedMs = performance.now() - tStart;
      console.log(`2A: Infinite loader correctly timed out after ${elapsedMs.toFixed(2)} ms with: ${e.message.split('\n')[0]}`);
    }

    results.push({
      test: '2A_infinite_loader_timeout',
      pass: timeoutCaught && elapsedMs >= 2900 && elapsedMs <= 4000,
      details: `Timeout caught: ${timeoutCaught}, duration: ${elapsedMs.toFixed(2)} ms`
    });
    await browser.close();
  }

  // Test 2B: Visible GIS Error Banner behavior during waitForFunction
  {
    const browser = await chromium.launch({ headless: true, args: standardLaunchArgs });
    const page = await browser.newPage();

    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__map3d?.state?.totalTriangles > 0, { timeout: 45000 });

    // Simulate GIS error banner showing
    await page.evaluate(() => {
      const banner = document.getElementById('gisErrorBanner');
      banner.classList.remove('hidden');
      banner.style.display = 'block';
      const text = document.getElementById('gisErrorText');
      if (text) text.textContent = 'Network timeout contacting Overpass API';
    });

    let bannerTimeoutCaught = false;
    const tStart = performance.now();
    try {
      await page.waitForFunction(() => {
        const banner = document.getElementById('gisErrorBanner');
        const bannerHidden = !banner || (
          banner.classList.contains('hidden') ||
          window.getComputedStyle(banner).display === 'none'
        );
        return bannerHidden;
      }, null, { timeout: 2000 });
    } catch (e) {
      bannerTimeoutCaught = true;
    }

    const elapsed = performance.now() - tStart;
    console.log(`2B: Error banner prevented pass and timed out as expected: ${bannerTimeoutCaught} in ${elapsed.toFixed(2)} ms`);
    results.push({
      test: '2B_error_banner_prevents_pass',
      pass: bannerTimeoutCaught,
      details: `Banner presence correctly prevents pass: ${bannerTimeoutCaught}`
    });
    await browser.close();
  }

  // --------------------------------------------------------------------------
  // EXPERIMENT 3: WebGL Failure & Ordering
  // --------------------------------------------------------------------------
  console.log('\n--- EXPERIMENT 3: WebGL Failure Handling ---');

  // Test 3A: Browser without WebGL
  {
    let webglDisabledBrowser;
    let errorCaught = false;
    let errorMessage = '';
    const tStart = performance.now();

    try {
      webglDisabledBrowser = await chromium.launch({
        headless: true,
        args: ['--disable-webgl', '--disable-3d-apis', '--no-sandbox']
      });
      const page = await webglDisabledBrowser.newPage();
      const pageErrors = [];
      page.on('pageerror', err => pageErrors.push(err.message || String(err)));

      await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });

      // Check if page threw WebGL not supported
      await page.waitForTimeout(1000);

      const webglSupported = await page.evaluate(() => {
        const canvas = document.getElementById('view3dCanvas');
        if (!canvas) return false;
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        return !!gl;
      });

      console.log(`3A: WebGL enabled when --disable-webgl passed: ${webglSupported}`);
      console.log(`3A: Page errors caught: ${JSON.stringify(pageErrors)}`);

      const hasWebGLError = pageErrors.some(e => /webgl not supported/i.test(e));
      results.push({
        test: '3A_disabled_webgl_behavior',
        webglSupported,
        hasWebGLError,
        pass: !webglSupported && hasWebGLError,
        details: `WebGL supported: ${webglSupported}, WebGL error caught: ${hasWebGLError}`
      });
    } catch (e) {
      console.log(`3A: Error during disabled WebGL test: ${e.message}`);
    } finally {
      if (webglDisabledBrowser) await webglDisabledBrowser.close();
    }
  }

  // Test 3B: Evaluation of WebGL check assertion before vs after bootstrap
  {
    console.log('3B: Analyzing ordering of WebGL check in baseline_runner.js and baseline_runner.spec.js');
    // In baseline_runner.js:
    // Line 96: waits for window.__map3d.state.totalTriangles > 0
    // Line 104: checks webglMeta
    // If WebGL fails, totalTriangles will never be > 0.
    // The harness will wait the full 45s timeout instead of failing immediately at step 1!
  }

  // --------------------------------------------------------------------------
  // EXPERIMENT 4: Stress Resilience & Rapid Triggers
  // --------------------------------------------------------------------------
  console.log('\n--- EXPERIMENT 4: Rapid Consecutive Triggers & Stress Resilience ---');

  // Test 4A: Rapid consecutive city switching
  {
    const browser = await chromium.launch({ headless: true, args: standardLaunchArgs });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message || String(err)));

    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__map3d?.state?.totalTriangles > 0, { timeout: 45000 });

    console.log('4A: Firing Warsaw immediately followed by New York (rapid consecutive trigger)...');

    const warsawBbox = [52.2415, 21.0050, 52.2525, 21.0220];
    const nyBbox = [40.7606, -73.9839, 40.7722, -73.9729];

    const rapidTriggerResult = await page.evaluate(async ({ wBbox, nyBbox }) => {
      // Fire Warsaw
      window.__map3d.fetchRealGISAndRender(wBbox, 'WARSZAWA');
      // 50ms later, fire New York before Warsaw completes
      await new Promise(r => setTimeout(r, 50));
      window.__map3d.fetchRealGISAndRender(nyBbox, 'NYC CENTRAL PARK');
      return true;
    }, { wBbox: warsawBbox, nyBbox: nyBbox });

    // Now wait for completion
    let success = false;
    let finalTitle = '';
    let finalTriangles = 0;
    try {
      await page.waitForFunction(() => {
        const ov = document.getElementById('loadingOverlay3D');
        const st = window.__map3d?.state;
        const ovHidden = ov && (ov.classList.contains('hidden') || window.getComputedStyle(ov).display === 'none');
        return ovHidden && st && st.totalTriangles > 0;
      }, null, { timeout: 45000 });

      finalTitle = await page.evaluate(() => window.__map3d?.state?.sceneData?.title || '');
      finalTriangles = await page.evaluate(() => window.__map3d?.state?.totalTriangles || 0);
      success = true;
    } catch (e) {
      success = false;
      console.log(`4A: Failed waiting for completion after rapid trigger: ${e.message}`);
    }

    console.log(`4A: Rapid trigger outcome: success=${success}, finalTitle="${finalTitle}", triangles=${finalTriangles}, pageErrors=${pageErrors.length}`);
    results.push({
      test: '4A_rapid_consecutive_triggers',
      pass: success && pageErrors.length === 0,
      details: `Success: ${success}, title: "${finalTitle}", triangles: ${finalTriangles}, errors: ${pageErrors.length}`
    });
    await browser.close();
  }

  // Test 4B: Invalid BBox Handling
  {
    const browser = await chromium.launch({ headless: true, args: standardLaunchArgs });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message || String(err)));

    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__map3d?.state?.totalTriangles > 0, { timeout: 45000 });

    console.log('4B: Testing invalid BBox [NaN, NaN, NaN, NaN] handling...');

    await page.evaluate(() => {
      try {
        window.__map3d.fetchRealGISAndRender([NaN, NaN, NaN, NaN], 'INVALID_TEST');
      } catch (e) {
        console.error('Synchronous error on invalid bbox:', e);
      }
    });

    // Check if error banner appears or if page throws
    await page.waitForTimeout(2000);
    const bannerVisible = await page.evaluate(() => {
      const b = document.getElementById('gisErrorBanner');
      return b && !b.classList.contains('hidden') && window.getComputedStyle(b).display !== 'none';
    });

    console.log(`4B: Error banner surfaced or handled: bannerVisible=${bannerVisible}, pageErrors=${pageErrors.length}`);
    results.push({
      test: '4B_invalid_bbox_resilience',
      bannerVisible,
      pageErrorsCount: pageErrors.length,
      pass: true, // We observe how the system handles it
      details: `Banner visible: ${bannerVisible}, Page errors: ${pageErrors.length}`
    });
    await browser.close();
  }

  console.log('\n' + '='.repeat(70));
  console.log('CHALLENGE RESULTS SUMMARY');
  console.log('='.repeat(70));
  for (const r of results) {
    console.log(`${r.test.padEnd(35)} : ${r.pass ? 'PASS' : 'FAIL'} (${r.details})`);
  }
  console.log('='.repeat(70));

  return results;
}

runAllChallenges().catch(err => {
  console.error('Fatal error in challenge suite:', err);
  process.exit(1);
});
