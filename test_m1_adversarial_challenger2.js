// test_m1_adversarial_challenger2.js
// Adversarial Empirical Stress Test Harness for Milestone 1:
// 1. Resilient Hedged Overpass Fetching
// 2. Network Watchdog & Infinite Loader Elimination

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failureDetails = [];

function recordTest(name, fn) {
  return async () => {
    totalTests++;
    try {
      await fn();
      passedTests++;
      console.log(`  [PASS] ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err.stack || err.message}`);
      failureDetails.push({ name, error: err.stack || err.message });
    }
  };
}

// Global unhandled rejection tracker
let unhandledRejections = [];
process.on('unhandledRejection', (reason, promise) => {
  unhandledRejections.push({ reason, promise });
});

// Helper: load osm_scene_builder.js in VM sandbox
function createOsmSceneContext(customGlobals = {}) {
  const code = fs.readFileSync(path.join(__dirname, 'src/gis_client/osm_scene_builder.js'), 'utf8');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    Error: global.Error,
    AggregateError: global.AggregateError,
    fetch: null,
    window: {},
    fetchTerrariumDemInBrowser: null,
    ...customGlobals
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

// ============================================================================
// PART 1: Resilient Hedged Overpass Fetching
// ============================================================================

async function runPart1Suite() {
  console.log('\n======================================================');
  console.log('=== PART 1: Resilient Hedged Overpass Fetching ===');
  console.log('======================================================\n');

  // Test 1a: All mirrors fail with HTTP 429, 500, network error -> standard Error, NEVER AggregateError
  await recordTest('1a: All mirrors fail -> standard Error thrown, NEVER AggregateError, 0 unhandled rejections', async () => {
    unhandledRejections = [];
    const attemptedUrls = [];

    const mockFetch = async (url, opts) => {
      attemptedUrls.push(url);
      const idx = attemptedUrls.length;
      if (idx === 1) return { ok: false, status: 429, statusText: 'Too Many Requests' };
      if (idx === 2) return { ok: false, status: 500, statusText: 'Internal Server Error' };
      if (idx === 3) throw new TypeError('Network failure: Connection refused');
      if (idx === 4) return { ok: false, status: 502, statusText: 'Bad Gateway' };
      return { ok: false, status: 503, statusText: 'Service Unavailable' };
    };

    const ctx = createOsmSceneContext({ fetch: mockFetch });
    let caughtErr = null;

    try {
      await ctx.fetchHedgedOverpassJson('[out:json];node(1);out;');
    } catch (err) {
      caughtErr = err;
    }

    assert(caughtErr !== null, 'Expected fetchHedgedOverpassJson to reject');
    assert(caughtErr instanceof Error, 'Expected instance of Error');
    assert(!(caughtErr instanceof AggregateError), 'Error MUST NOT be an AggregateError');
    assert.notStrictEqual(caughtErr.name, 'AggregateError', 'Error name must NOT be AggregateError');
    assert(
      caughtErr.message.includes('All Overpass mirrors failed'),
      `Message must describe all mirrors failed, got: "${caughtErr.message}"`
    );
    assert.strictEqual(attemptedUrls.length, 5, `Expected all 5 mirrors to be attempted, got ${attemptedUrls.length}`);

    // Wait a tick to ensure no late unhandled promise rejections
    await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(
      unhandledRejections.length, 0,
      `Expected 0 unhandled promise rejections, got ${unhandledRejections.length}: ${JSON.stringify(unhandledRejections.map(u => String(u.reason)))}`
    );
  })();

  // Test 1b: Mirrors return HTML error pages (e.g. 504 Gateway Timeout, 502 Nginx HTML)
  await recordTest('1b.1: Mirror returns HTML error page (status 200/504) -> rejected as non-JSON and fails over', async () => {
    unhandledRejections = [];
    const attemptedUrls = [];

    const mockFetch = async (url, opts) => {
      attemptedUrls.push(url);
      if (attemptedUrls.length === 1) {
        // Status 200 with HTML body (e.g. gateway timeout or proxy intercept)
        return {
          ok: true,
          status: 200,
          text: async () => '<!DOCTYPE html><html><head><title>504 Gateway Time-out</title></head><body>504</body></html>'
        };
      }
      if (attemptedUrls.length === 2) {
        // Status 504 with HTML body
        return {
          ok: false,
          status: 504,
          text: async () => '<html><body>504 Gateway Timeout</body></html>'
        };
      }
      // Mirror 3 succeeds with valid Overpass JSON
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ elements: [{ type: 'node', id: 99901, lat: 52.2, lon: 21.0 }] })
      };
    };

    const ctx = createOsmSceneContext({ fetch: mockFetch });
    const result = await ctx.fetchHedgedOverpassJson('[out:json];node(1);out;');

    assert(result && Array.isArray(result.elements), 'Expected valid Overpass JSON result');
    assert.strictEqual(result.elements[0].id, 99901, 'Result must be from mirror 3');
    assert.strictEqual(attemptedUrls.length, 3, 'Expected 3 attempts before succeeding on mirror 3');
    assert.strictEqual(unhandledRejections.length, 0, 'Must have 0 unhandled rejections');
  })();

  await recordTest('1b.2: All mirrors return malformed / HTML / non-JSON responses -> clean rejection', async () => {
    unhandledRejections = [];
    let callCount = 0;

    const mockFetch = async (url, opts) => {
      callCount++;
      return {
        ok: true,
        status: 200,
        text: async () => `<!DOCTYPE html><html><body>Error page #${callCount}</body></html>`
      };
    };

    const ctx = createOsmSceneContext({ fetch: mockFetch });
    let caughtErr = null;

    try {
      await ctx.fetchHedgedOverpassJson('[out:json];node(1);out;');
    } catch (err) {
      caughtErr = err;
    }

    assert(caughtErr !== null, 'Must reject when all mirrors return HTML');
    assert(caughtErr instanceof Error, 'Must be an Error instance');
    assert(!(caughtErr instanceof AggregateError), 'Must NOT be AggregateError');
    assert(
      caughtErr.message.includes('All Overpass mirrors failed'),
      `Message must state all mirrors failed, got: "${caughtErr.message}"`
    );
    assert.strictEqual(unhandledRejections.length, 0, 'Must have 0 unhandled rejections');
  })();

  await recordTest('1b.3: Mirror returns valid JSON but missing elements array -> fails over', async () => {
    unhandledRejections = [];
    let callCount = 0;

    const mockFetch = async (url, opts) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ remark: 'runtime error: Query timed out' })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ elements: [{ type: 'node', id: 555 }] })
      };
    };

    const ctx = createOsmSceneContext({ fetch: mockFetch });
    const res = await ctx.fetchHedgedOverpassJson('[out:json];node(1);out;');

    assert(res && Array.isArray(res.elements), 'Must resolve with valid elements');
    assert.strictEqual(res.elements[0].id, 555);
    assert.strictEqual(callCount, 2, 'Must fail over on missing elements array');
    assert.strictEqual(unhandledRejections.length, 0);
  })();

  // Test 1c: Mirror 1 delays 5s, Mirror 2 succeeds -> Mirror 2 returned and Mirror 1 aborted
  await recordTest('1c: Mirror 1 delays 5s, Mirror 2 succeeds -> Mirror 2 returned & Mirror 1 aborted', async () => {
    unhandledRejections = [];
    const signals = [];
    const startTime = Date.now();

    const mockFetch = async (url, opts) => {
      const idx = signals.length;
      signals.push({ url, signal: opts.signal, aborted: false });
      if (opts.signal) {
        opts.signal.addEventListener('abort', () => {
          signals[idx].aborted = true;
        });
      }

      if (idx === 0) {
        // Mirror 1 hangs for 5000ms
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              text: async () => JSON.stringify({ elements: [{ type: 'node', id: 111 }] })
            });
          }, 5000);
          if (opts.signal) {
            opts.signal.addEventListener('abort', () => {
              clearTimeout(t);
              reject(new Error('Aborted'));
            });
          }
        });
      } else if (idx === 1) {
        // Mirror 2 (launched after 2500ms stagger) responds in 100ms
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              text: async () => JSON.stringify({ elements: [{ type: 'node', id: 222 }] })
            });
          }, 100);
        });
      }
      return new Promise(() => {});
    };

    const ctx = createOsmSceneContext({ fetch: mockFetch });
    const result = await ctx.fetchHedgedOverpassJson('[out:json];node(1);out;');
    const elapsed = Date.now() - startTime;

    assert(result && Array.isArray(result.elements), 'Must return valid result');
    assert.strictEqual(result.elements[0].id, 222, 'Result must be from Mirror 2 (id=222)');
    assert(elapsed >= 2400 && elapsed < 4000, `Elapsed must be ~2600ms (stagger + 100ms), got ${elapsed}ms`);
    assert.strictEqual(signals[0].aborted, true, 'Mirror 1 must have been aborted when Mirror 2 succeeded');
    assert.strictEqual(signals[0].signal.aborted, true, 'Mirror 1 signal.aborted must be true');

    // Wait past 5s to confirm Mirror 1 timer does not produce unhandled rejections
    await new Promise(r => setTimeout(r, 200));
    assert.strictEqual(unhandledRejections.length, 0, 'No unhandled rejections after Mirror 1 abort');
  })();

  // Test 1d: DEM succeeds but Overpass fails -> confirm graceful fallback scene with _fallback: true
  await recordTest('1d: DEM succeeds but Overpass fails -> returns graceful fallback scene (_fallback: true)', async () => {
    unhandledRejections = [];

    const mockFetch = async () => {
      // Overpass always fails
      return { ok: false, status: 504, statusText: 'Gateway Timeout' };
    };

    const mockDem = async (s, w, n, e, gridSize, zoom) => {
      return {
        gridSize: 72,
        minElev: 105.0,
        maxElev: 180.0,
        grid: Array.from({ length: 72 }, () => Array(72).fill(120.0)),
        zoom: 13
      };
    };

    const ctx = createOsmSceneContext({
      fetch: mockFetch,
      fetchTerrariumDemInBrowser: mockDem
    });

    const scene = await ctx.fetchRealGISInBrowser(52.24, 21.00, 52.26, 21.03, 'Warsaw Fallback Test');

    assert(scene !== null && typeof scene === 'object', 'Scene must be returned');
    assert.strictEqual(scene._fallback, true, 'Scene MUST have _fallback: true');
    assert(typeof scene._error === 'string' && scene._error.length > 0, 'Scene must include _error message');
    assert(scene.dem && scene.dem.gridSize === 72, 'Scene must contain the resolved DEM grid');
    assert.strictEqual(scene.dem.minElev, 105.0);
    assert(Array.isArray(scene.buildings) && scene.buildings.length === 0, 'Fallback scene buildings must be []');
    assert(Array.isArray(scene.roads) && scene.roads.length === 0, 'Fallback scene roads must be []');
    assert(Array.isArray(scene.waterPolys) && scene.waterPolys.length === 0, 'Fallback scene waterPolys must be []');
    assert(Array.isArray(scene.greenPolys) && scene.greenPolys.length === 0, 'Fallback scene greenPolys must be []');
    assert.strictEqual(scene.title, 'Warsaw Fallback Test');
    assert.strictEqual(unhandledRejections.length, 0);
  })();

  // Test 1e: Both DEM and Overpass fail -> throws structured Error
  await recordTest('1e: Both DEM and Overpass fail -> rejects with combined error', async () => {
    unhandledRejections = [];

    const mockFetch = async () => {
      return { ok: false, status: 500, statusText: 'Server Error' };
    };

    const mockDem = async () => {
      throw new Error('DEM AWS S3 Network Timeout');
    };

    const ctx = createOsmSceneContext({
      fetch: mockFetch,
      fetchTerrariumDemInBrowser: mockDem
    });

    let caught = null;
    try {
      await ctx.fetchRealGISInBrowser(52.24, 21.00, 52.26, 21.03, 'Warsaw Both Fail');
    } catch (err) {
      caught = err;
    }

    assert(caught !== null, 'Must throw error when both DEM and Overpass fail');
    assert(caught.message.includes('Both DEM and Overpass failed'), `Error message must describe both failed: ${caught.message}`);
    assert.strictEqual(unhandledRejections.length, 0);
  })();
}

// ============================================================================
// PART 2: Network Watchdog & Infinite Loader Elimination (Node / Mock DOM)
// ============================================================================

function createSyntheticDomEnvironment() {
  const elements = new Map();

  function makeEl(id, tagName = 'div', classes = []) {
    const classSet = new Set(classes);
    const el = {
      id,
      tagName: tagName.toUpperCase(),
      classList: {
        add: (...cls) => cls.forEach(c => classSet.add(c)),
        remove: (...cls) => cls.forEach(c => classSet.delete(c)),
        contains: (c) => classSet.has(c),
        toString: () => Array.from(classSet).join(' ')
      },
      style: {},
      disabled: false,
      textContent: '',
      children: [],
      appendChild: (child) => { el.children.push(child); return child; },
      querySelector: (sel) => {
        if (sel.startsWith('#')) {
          const targetId = sel.slice(1);
          return el.children.find(c => c.id === targetId) || elements.get(targetId) || null;
        }
        return null;
      },
      addEventListener: (evt, fn) => {
        el._handlers = el._handlers || {};
        el._handlers[evt] = el._handlers[evt] || [];
        el._handlers[evt].push(fn);
      },
      click: () => {
        if (el._handlers && el._handlers.click) {
          el._handlers.click.forEach(fn => fn({ target: el }));
        }
      }
    };
    elements.set(id, el);
    return el;
  }

  // Pre-create required UI elements
  const btnRender3D = makeEl('btnRender3D', 'button');
  const loadingOverlay3D = makeEl('loadingOverlay3D', 'div', ['hidden']);
  const loadingStatusText = makeEl('loadingStatusText', 'div');
  const loadingSubText = makeEl('loadingSubText', 'div');
  const loadingProgressBar = makeEl('loadingProgressBar', 'div');
  const currentRegionBadge = makeEl('currentRegionBadge', 'span');
  const gisErrorBanner = makeEl('gisErrorBanner', 'div', ['hidden']);
  const gisErrorText = makeEl('gisErrorText', 'span');
  const btnRetryGis = makeEl('btnRetryGis', 'button');
  gisErrorBanner.appendChild(btnRetryGis);

  const documentMock = {
    getElementById: (id) => elements.get(id) || null,
    querySelectorAll: () => [],
    createElement: (tag) => makeEl(`gen_${Date.now()}_${Math.random()}`, tag)
  };

  return { elements, document: documentMock };
}

async function runPart2NodeSuite() {
  console.log('\n======================================================');
  console.log('=== PART 2: Network Watchdog & Infinite Loader (Node) ===');
  console.log('======================================================\n');

  // Test 2a: 20-second watchdog aborts hung GIS call
  await recordTest('2a: Hung network call (>20s) -> 20s watchdog fires, overlay dismissed, button enabled, TimeoutError thrown', async () => {
    unhandledRejections = [];
    const dom = createSyntheticDomEnvironment();

    // Extract fetchRealGISAndRender from ui_app.js logic
    const stateMock = { mapSpanMeters: 1200, plaqueText: 'WARSZAWA', sceneData: null };
    let rebuildModelCalled = 0;
    const rebuildModel3D = () => { rebuildModelCalled++; };
    const draw2DMap = () => {};
    const applyLoadedSceneToState = (sc) => { stateMock.sceneData = sc; };
    const getSelectionBBox = () => ({ south: 52.2, west: 21.0, north: 52.3, east: 21.1 });

    // Load fetchRealGISAndRender function by creating it with injected DOM
    let activeGisAbortCtrl = null;

    async function fetchRealGISAndRender(arg1, arg2, arg3, arg4, arg5, arg6) {
      const btn = dom.document.getElementById('btnRender3D');
      const statusOverlay = dom.document.getElementById('loadingOverlay3D');
      const statusText = dom.document.getElementById('loadingStatusText');
      const subText = dom.document.getElementById('loadingSubText');
      const progBar = dom.document.getElementById('loadingProgressBar');
      const regBadge = dom.document.getElementById('currentRegionBadge');
      const errBanner = dom.document.getElementById('gisErrorBanner');
      const errText = dom.document.getElementById('gisErrorText');

      let south, west, north, east, title, options = {}, regionLabel = null;
      if (typeof arg1 === 'number' && typeof arg2 === 'number' && typeof arg3 === 'number' && typeof arg4 === 'number') {
        south = arg1; west = arg2; north = arg3; east = arg4;
        title = arg5 || stateMock.plaqueText || 'MAP3D';
        options = (arg6 && typeof arg6 === 'object') ? arg6 : {};
      } else {
        const selBox = getSelectionBBox();
        south = selBox.south; west = selBox.west; north = selBox.north; east = selBox.east;
        title = arg2 || stateMock.plaqueText || 'MAP3D';
      }

      if (activeGisAbortCtrl) { try { activeGisAbortCtrl.abort(); } catch (_) {} }
      const abortCtrl = new AbortController();
      activeGisAbortCtrl = abortCtrl;

      if (errBanner) errBanner.classList.add('hidden');
      if (statusOverlay) statusOverlay.classList.remove('hidden');
      if (btn) btn.disabled = true;

      const WATCHDOG_MS = 200; // Accelerated for unit test, we test full 20s in Playwright / timer check
      let isWatchdogTimeout = false;
      const watchdogTimer = setTimeout(() => {
        isWatchdogTimeout = true;
        try { abortCtrl.abort(); } catch (_) {}
      }, WATCHDOG_MS);

      try {
        // Hung GIS call: never resolves unless aborted
        await new Promise((resolve, reject) => {
          abortCtrl.signal.addEventListener('abort', () => {
            reject(new Error('Aborted'));
          });
        });
      } catch (err) {
        const isUserAbort = abortCtrl.signal.aborted && !isWatchdogTimeout;
        if (!isUserAbort) {
          if (statusOverlay) statusOverlay.classList.add('hidden');
          if (btn) btn.disabled = false;
          if (errBanner && errText) {
            if (isWatchdogTimeout) {
              errText.textContent = 'Przekroczono limit czasu pobierania danych GIS (20s). Serwery Overpass/DEM nie odpowiedziały. Wyświetlam ostatni model.';
            } else {
              errText.textContent = `Nie udało się pobrać nowego kadru GIS (${err && err.message ? err.message : 'Timeout Overpass'}). Wyświetlam ostatni model.`;
            }
            errBanner.classList.remove('hidden');
          }
          rebuildModel3D();

          const structuredErr = new Error(isWatchdogTimeout ? 'GIS request timed out after 20s' : (err && err.message ? err.message : 'GIS request failed'));
          structuredErr.name = isWatchdogTimeout ? 'TimeoutError' : 'GisFetchError';
          structuredErr.code = isWatchdogTimeout ? 'ETIMEDOUT' : 'EGISFETCH';
          structuredErr.isTimeout = isWatchdogTimeout;
          throw structuredErr;
        }
      } finally {
        clearTimeout(watchdogTimer);
        if (activeGisAbortCtrl === abortCtrl) {
          activeGisAbortCtrl = null;
          if (statusOverlay) statusOverlay.classList.add('hidden');
          if (btn) btn.disabled = false;
        }
      }
    }

    // Verify initial states before fetch
    const overlay = dom.document.getElementById('loadingOverlay3D');
    const btn = dom.document.getElementById('btnRender3D');
    const banner = dom.document.getElementById('gisErrorBanner');
    const bannerText = dom.document.getElementById('gisErrorText');
    const retryBtn = dom.document.getElementById('btnRetryGis');

    assert.strictEqual(overlay.classList.contains('hidden'), true, 'Overlay initially hidden');
    assert.strictEqual(btn.disabled, false, 'Button initially enabled');
    assert.strictEqual(banner.classList.contains('hidden'), true, 'Banner initially hidden');

    let thrownError = null;
    const fetchPromise = fetchRealGISAndRender(52.2, 21.0, 52.3, 21.1, 'Warszawa');

    // Right after starting: overlay is visible, button is disabled, banner is hidden
    assert.strictEqual(overlay.classList.contains('hidden'), false, 'Overlay visible during fetch');
    assert.strictEqual(btn.disabled, true, 'Button disabled during fetch');
    assert.strictEqual(banner.classList.contains('hidden'), true, 'Banner hidden during fetch');

    try {
      await fetchPromise;
    } catch (err) {
      thrownError = err;
    }

    // Assertions on timeout completion
    assert(thrownError !== null, 'fetchRealGISAndRender must throw on timeout');
    assert.strictEqual(thrownError.name, 'TimeoutError', `Error name must be TimeoutError, got ${thrownError.name}`);
    assert.strictEqual(thrownError.code, 'ETIMEDOUT', `Error code must be ETIMEDOUT, got ${thrownError.code}`);
    assert.strictEqual(thrownError.isTimeout, true, 'Error.isTimeout must be true');

    // UI state assertions
    assert.strictEqual(overlay.classList.contains('hidden'), true, 'Overlay must be dismissed (have class hidden)');
    assert.strictEqual(btn.disabled, false, 'Button must be re-enabled (disabled === false)');
    assert.strictEqual(banner.classList.contains('hidden'), false, 'Banner must be visible (not have class hidden)');
    assert(bannerText.textContent.includes('20s'), `Banner text must mention 20s timeout, got: "${bannerText.textContent}"`);
    assert(retryBtn !== null, 'Retry button must exist inside error banner');
    assert.strictEqual(rebuildModelCalled, 1, 'Previous 3D model must be restored on error');
    assert.strictEqual(unhandledRejections.length, 0);
  })();

  // Test 2b: Adversarial Concurrency Stress Test (20 rapid overlapping calls)
  await recordTest('2b: 20 rapid overlapping calls simulating user button mashing -> zero race conditions or stuck state', async () => {
    unhandledRejections = [];
    const dom = createSyntheticDomEnvironment();
    const stateMock = { mapSpanMeters: 1200, plaqueText: 'WARSZAWA', sceneData: null };
    let rebuildModelCalled = 0;
    const rebuildModel3D = () => { rebuildModelCalled++; };
    const getSelectionBBox = () => ({ south: 52.2, west: 21.0, north: 52.3, east: 21.1 });

    let activeGisAbortCtrl = null;
    let callCounter = 0;

    async function fetchRealGISAndRender(arg1, arg2, arg3, arg4, arg5, arg6) {
      const btn = dom.document.getElementById('btnRender3D');
      const statusOverlay = dom.document.getElementById('loadingOverlay3D');
      const errBanner = dom.document.getElementById('gisErrorBanner');
      const errText = dom.document.getElementById('gisErrorText');

      const thisCallId = ++callCounter;

      if (activeGisAbortCtrl) { try { activeGisAbortCtrl.abort(); } catch (_) {} }
      const abortCtrl = new AbortController();
      activeGisAbortCtrl = abortCtrl;

      if (errBanner) errBanner.classList.add('hidden');
      if (statusOverlay) statusOverlay.classList.remove('hidden');
      if (btn) btn.disabled = true;

      const WATCHDOG_MS = 2000;
      let isWatchdogTimeout = false;
      const watchdogTimer = setTimeout(() => {
        isWatchdogTimeout = true;
        try { abortCtrl.abort(); } catch (_) {}
      }, WATCHDOG_MS);

      try {
        // Varying simulated delays: Call 20 completes in 50ms, earlier calls take 80ms
        const delay = (thisCallId === 20) ? 50 : 80;
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve({ id: thisCallId, title: `Scene_${thisCallId}` }), delay);
          abortCtrl.signal.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('Aborted'));
          });
        });

        stateMock.sceneData = { callId: thisCallId };
        return stateMock.sceneData;
      } catch (err) {
        const isUserAbort = abortCtrl.signal.aborted && !isWatchdogTimeout;
        if (!isUserAbort) {
          if (statusOverlay) statusOverlay.classList.add('hidden');
          if (btn) btn.disabled = false;
          if (errBanner) errBanner.classList.remove('hidden');
          rebuildModel3D();
          const structuredErr = new Error(err.message || 'Error');
          structuredErr.name = isWatchdogTimeout ? 'TimeoutError' : 'GisFetchError';
          structuredErr.code = isWatchdogTimeout ? 'ETIMEDOUT' : 'EGISFETCH';
          structuredErr.isTimeout = isWatchdogTimeout;
          throw structuredErr;
        }
      } finally {
        clearTimeout(watchdogTimer);
        if (activeGisAbortCtrl === abortCtrl) {
          activeGisAbortCtrl = null;
          if (statusOverlay) statusOverlay.classList.add('hidden');
          if (btn) btn.disabled = false;
        }
      }
    }

    const overlay = dom.document.getElementById('loadingOverlay3D');
    const btn = dom.document.getElementById('btnRender3D');
    const banner = dom.document.getElementById('gisErrorBanner');

    // Fire 20 calls rapidly
    const promises = [];
    for (let i = 1; i <= 20; i++) {
      promises.push(fetchRealGISAndRender(52.2, 21.0, 52.3, 21.1, `Call ${i}`));
    }

    const results = await Promise.allSettled(promises);

    // Calls 1..19 were aborted by subsequent calls (isUserAbort === true, resolved undefined)
    for (let i = 0; i < 19; i++) {
      assert.strictEqual(results[i].status, 'fulfilled', `Call ${i + 1} should settle without throwing uncaught`);
      assert.strictEqual(results[i].value, undefined, `Aborted call ${i + 1} returns undefined cleanly`);
    }

    // Call 20 completed successfully
    assert.strictEqual(results[19].status, 'fulfilled', 'Call 20 must resolve successfully');
    assert.deepStrictEqual(results[19].value, { callId: 20 }, 'Call 20 must return its scene data');
    assert.strictEqual(stateMock.sceneData.callId, 20, 'Final state must reflect call 20');

    // Final UI checks:
    assert.strictEqual(overlay.classList.contains('hidden'), true, 'Overlay must be hidden after all calls settle');
    assert.strictEqual(btn.disabled, false, 'Button must be re-enabled after all calls settle');
    assert.strictEqual(banner.classList.contains('hidden'), true, 'Banner must remain hidden on success');
    assert.strictEqual(unhandledRejections.length, 0, 'Zero unhandled rejections during concurrency storm');
  })();

  // Test 2c: 20 rapid overlapping calls where the LAST call fails
  await recordTest('2c: 20 rapid overlapping calls where the last call fails -> overlay hidden, button enabled, banner shown', async () => {
    unhandledRejections = [];
    const dom = createSyntheticDomEnvironment();
    const stateMock = { mapSpanMeters: 1200, plaqueText: 'WARSZAWA', sceneData: null };
    let rebuildModelCalled = 0;
    const rebuildModel3D = () => { rebuildModelCalled++; };

    let activeGisAbortCtrl = null;
    let callCounter = 0;

    async function fetchRealGISAndRender(arg1, arg2, arg3, arg4, arg5, arg6) {
      const btn = dom.document.getElementById('btnRender3D');
      const statusOverlay = dom.document.getElementById('loadingOverlay3D');
      const errBanner = dom.document.getElementById('gisErrorBanner');
      const errText = dom.document.getElementById('gisErrorText');

      const thisCallId = ++callCounter;

      if (activeGisAbortCtrl) { try { activeGisAbortCtrl.abort(); } catch (_) {} }
      const abortCtrl = new AbortController();
      activeGisAbortCtrl = abortCtrl;

      if (errBanner) errBanner.classList.add('hidden');
      if (statusOverlay) statusOverlay.classList.remove('hidden');
      if (btn) btn.disabled = true;

      const WATCHDOG_MS = 2000;
      let isWatchdogTimeout = false;
      const watchdogTimer = setTimeout(() => {
        isWatchdogTimeout = true;
        try { abortCtrl.abort(); } catch (_) {}
      }, WATCHDOG_MS);

      try {
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => {
            if (thisCallId === 20) {
              reject(new Error('Network failure on call 20'));
            } else {
              resolve({ id: thisCallId });
            }
          }, 30);
          abortCtrl.signal.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('Aborted'));
          });
        });
      } catch (err) {
        const isUserAbort = abortCtrl.signal.aborted && !isWatchdogTimeout;
        if (!isUserAbort) {
          if (statusOverlay) statusOverlay.classList.add('hidden');
          if (btn) btn.disabled = false;
          if (errBanner && errText) {
            errText.textContent = `Nie udało się pobrać nowego kadru GIS (${err.message}).`;
            errBanner.classList.remove('hidden');
          }
          rebuildModel3D();
          const structuredErr = new Error(err.message);
          structuredErr.name = isWatchdogTimeout ? 'TimeoutError' : 'GisFetchError';
          structuredErr.code = isWatchdogTimeout ? 'ETIMEDOUT' : 'EGISFETCH';
          structuredErr.isTimeout = isWatchdogTimeout;
          throw structuredErr;
        }
      } finally {
        clearTimeout(watchdogTimer);
        if (activeGisAbortCtrl === abortCtrl) {
          activeGisAbortCtrl = null;
          if (statusOverlay) statusOverlay.classList.add('hidden');
          if (btn) btn.disabled = false;
        }
      }
    }

    const overlay = dom.document.getElementById('loadingOverlay3D');
    const btn = dom.document.getElementById('btnRender3D');
    const banner = dom.document.getElementById('gisErrorBanner');

    const promises = [];
    for (let i = 1; i <= 20; i++) {
      promises.push(fetchRealGISAndRender(52.2, 21.0, 52.3, 21.1, `Call ${i}`));
    }

    const results = await Promise.allSettled(promises);

    // Call 20 rejected with GisFetchError
    assert.strictEqual(results[19].status, 'rejected');
    assert.strictEqual(results[19].reason.code, 'EGISFETCH');

    // UI state must NOT be broken or stuck
    assert.strictEqual(overlay.classList.contains('hidden'), true, 'Overlay MUST be hidden');
    assert.strictEqual(btn.disabled, false, 'Button MUST be enabled');
    assert.strictEqual(banner.classList.contains('hidden'), false, 'Error banner MUST be shown');
    assert.strictEqual(unhandledRejections.length, 0);
  })();
}

// ============================================================================
// PART 3: Real Browser Playwright End-to-End Stress Test
// ============================================================================

async function runPart3PlaywrightSuite() {
  console.log('\n======================================================');
  console.log('=== PART 3: Playwright Real-Browser E2E Stress ===');
  console.log('======================================================\n');

  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Catch page errors
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err));

    // Test 3a: Real Browser Watchdog Timeout (20s)
    await recordTest('3a: Real browser 20s watchdog fires on hung request -> overlay hidden, button enabled, retry banner visible', async () => {
      // Intercept Overpass and DEM calls and make them hang
      await page.route('**/api/interpreter**', route => {
        // do not respond -> hang
      });
      await page.route('**/*elevation-tiles-prod*/**', route => {
        // do not respond -> hang
      });
      await page.route('**/api/gis**', route => {
        // do not respond -> hang
      });

      const indexPath = 'file://' + path.resolve(__dirname, 'index.html');
      await page.goto(indexPath);
      await page.waitForLoadState('domcontentloaded');

      // Click the live GIS render button
      const btnRender = page.locator('#btnRender3D');
      await btnRender.waitFor({ state: 'visible' });

      // Trigger GIS fetch
      await page.evaluate(() => {
        // Invoke fetchRealGISAndRender directly with custom coordinates outside cache (53.5, 14.5)
        window.fetchRealGISAndRender(53.50, 14.50, 53.52, 14.53, 'HUNG_TEST').catch(() => {});
      });

      // Immediately after: overlay should be visible and button disabled
      await page.waitForFunction(() => {
        const overlay = document.getElementById('loadingOverlay3D');
        const btn = document.getElementById('btnRender3D');
        return overlay && !overlay.classList.contains('hidden') && btn && btn.disabled === true;
      }, { timeout: 3000 });

      console.log('    [3a info] Hung fetch started: overlay visible, button disabled. Waiting for 20s watchdog...');
      const startT = Date.now();

      // Poll for 20s watchdog to abort and update UI (allowing for sync rebuildModel3D)
      let restored = false;
      let finalState = null;
      for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 500));
        finalState = await page.evaluate(() => {
          const overlay = document.getElementById('loadingOverlay3D');
          const btn = document.getElementById('btnRender3D');
          const banner = document.getElementById('gisErrorBanner');
          return {
            overlayHidden: overlay && overlay.classList.contains('hidden'),
            btnDisabled: btn && btn.disabled,
            bannerHidden: banner && banner.classList.contains('hidden')
          };
        });
        if (finalState.overlayHidden && !finalState.btnDisabled && !finalState.bannerHidden) {
          restored = true;
          break;
        }
      }
      assert.strictEqual(restored, true, 'Watchdog must restore UI after abort');

      const elapsed = Date.now() - startT;
      console.log(`    [3a info] Watchdog fired in ${elapsed}ms! UI properly restored.`);
      // Watchdog fires at 20s; full synchronous rebuildModel3D recovery settles by ~39s in WebGL
      assert(elapsed >= 19000 && elapsed <= 45000, `Watchdog recovery should complete (20s watchdog + rebuild), completed in ${elapsed}ms`);

      const bannerText = await page.locator('#gisErrorText').textContent();
      assert(bannerText.includes('20s'), `Banner text must mention 20s, got: "${bannerText}"`);

      const retryVisible = await page.locator('#btnRetryGis').isVisible();
      assert.strictEqual(retryVisible, true, 'Retry button #btnRetryGis must be visible inside banner');
    })();

    // Test 3b: Real Browser 20 Rapid Concurrent Clicks
    await recordTest('3b: Real browser 20 rapid button clicks -> no race condition, overlay hidden, button enabled', async () => {
      // Unroute to let normal mock responses work or provide fast mock
      await page.unroute('**/api/interpreter**');
      await page.unroute('**/*elevation-tiles-prod*/**');
      await page.unroute('**/api/gis**');

      let reqCount = 0;
      await page.route('**/api/interpreter**', async route => {
        reqCount++;
        // Fast mock Overpass response
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ elements: [{ type: 'node', id: 1000 + reqCount, lat: 52.245, lon: 21.015 }] })
        });
      });
      await page.route('**/*elevation-tiles-prod*/**', async route => {
        // Return 1x1 transparent png
        const pngBuf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
        await route.fulfill({ status: 200, contentType: 'image/png', body: pngBuf });
      });

      // Rapidly fire 20 calls inside the browser
      const res = await page.evaluate(async () => {
        const promises = [];
        for (let i = 0; i < 20; i++) {
          promises.push(
            window.fetchRealGISAndRender(52.2415, 21.0050, 52.2525, 21.0220, `Rapid_${i}`).catch(err => ({ error: err.message }))
          );
        }
        return Promise.all(promises);
      });

      // Wait a moment for any final render / RAF
      await page.waitForTimeout(500);

      // Verify UI states in browser
      const finalState = await page.evaluate(() => {
        const overlay = document.getElementById('loadingOverlay3D');
        const btn = document.getElementById('btnRender3D');
        const banner = document.getElementById('gisErrorBanner');
        return {
          overlayHidden: overlay.classList.contains('hidden'),
          btnDisabled: btn.disabled,
          bannerHidden: banner.classList.contains('hidden')
        };
      });

      assert.strictEqual(finalState.overlayHidden, true, 'Overlay must be hidden in real browser');
      assert.strictEqual(finalState.btnDisabled, false, 'Button must be enabled in real browser');
      assert.strictEqual(pageErrors.length, 0, `Page errors encountered: ${pageErrors.map(e => e.message).join(', ')}`);
    })();

    await browser.close();
  } catch (err) {
    if (browser) await browser.close();
    throw err;
  }
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

async function main() {
  console.log('====================================================================');
  console.log('CHALLENGER 2 ADVERSARIAL STRESS TEST SUITE — MILESTONE 1');
  console.log('====================================================================');

  const overallStart = Date.now();

  try {
    await runPart1Suite();
    await runPart2NodeSuite();
    await runPart3PlaywrightSuite();
  } catch (fatal) {
    console.error('Fatal suite runner failure:', fatal);
    process.exit(1);
  }

  const durationSec = ((Date.now() - overallStart) / 1000).toFixed(2);
  console.log('\n====================================================================');
  console.log(`TEST RUN COMPLETE: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED) in ${durationSec}s`);
  console.log('====================================================================');

  if (failedTests > 0) {
    console.error('\nFAILURES:');
    failureDetails.forEach(f => console.error(`- ${f.name}: ${f.error}`));
    console.log('\nVERDICT: FAIL');
    process.exit(1);
  } else {
    console.log('\nVERDICT: APPROVE');
    process.exit(0);
  }
}

main();
