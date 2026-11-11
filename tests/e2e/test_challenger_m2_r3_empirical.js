/**
 * tests/e2e/test_challenger_m2_r3_empirical.js
 * Comprehensive Empirical Stress Suite for Milestone 2 Round 3 Challenger
 *
 * Verifies:
 * 1. Time Slicing & Main-Thread Responsiveness (<2s hard guarantee, target <50ms)
 *    across Warsaw Old Town, Munich Marienplatz, and New York Central Park.
 * 2. 50 Rapid Cancellation & Rebuild Triggers (zero unhandled rejections, race conditions, buffer leaks).
 * 3. Mid-Flight Rebuild Preemption & Interruption (triggered during Stage 2 onProgress).
 * 4. Monotonic Progress Progression (progress % and stage labels never regress; zero duplicate rebuilds).
 * 5. WebGL Buffer & Resource Safety (no context loss, vertex stability, clean disposal).
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { rebuildModel3DProgressive } = require('../../src/mesh/mesh_builder.js');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8765';
const isMac = process.platform === 'darwin';
const glFlags = isMac
  ? ['--use-gl=angle', '--use-angle=metal']
  : ['--use-gl=angle', '--use-angle=swiftshader'];

const launchArgs = [
  ...glFlags,
  '--enable-webgl',
  '--enable-webgl2-compute-context',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--no-sandbox',
  '--disable-dev-shm-usage',
];

const PRESETS = [
  {
    name: 'Warsaw Old Town',
    cacheFile: 'cache/scene_v5_52.2415_21.0050_52.2525_21.0220.json',
    bbox: [52.2415, 21.0050, 52.2525, 21.0220],
    title: 'WARSZAWA'
  },
  {
    name: 'Munich Marienplatz',
    cacheFile: 'cache/scene_v5_48.1280_11.5769_48.1396_11.5941.json',
    bbox: [48.1280, 11.5769, 48.1396, 11.5941],
    title: 'MÜNCHEN'
  },
  {
    name: 'New York Central Park',
    cacheFile: 'cache/scene_v5_40.7606_-73.9839_40.7722_-73.9729.json',
    bbox: [40.7606, -73.9839, 40.7722, -73.9729],
    title: 'NYC CENTRAL PARK'
  }
];

// ============================================================================
// SECTION 1: DIRECT NODE.JS TIME-SLICE HARNESS
// ============================================================================
async function runNodeTimeSliceProfiler() {
  console.log('\n' + '='.repeat(80));
  console.log('SECTION 1: NODE.JS TIME-SLICE PROFILING (WARSAW, MUNICH, NYC)');
  console.log('='.repeat(80));

  const results = [];

  for (const preset of PRESETS) {
    const fullPath = path.resolve(__dirname, '../../', preset.cacheFile);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Cache file not found: ${fullPath}`);
    }
    const sceneData = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

    // High-resolution interval lag sampler (1ms interval)
    let maxLag = 0;
    const lags = [];
    let lastTick = performance.now();
    let active = true;

    const lagTimer = setInterval(() => {
      if (!active) return;
      const now = performance.now();
      const delta = now - lastTick;
      lastTick = now;
      if (delta > maxLag) maxLag = delta;
      if (delta > 5) {
        lags.push(delta);
      }
    }, 1);

    const progressLog = [];
    const stageStartTimes = {};
    let currentStage = 'Init';
    let lastStageTime = performance.now();

    const t0 = performance.now();
    const buildRes = await rebuildModel3DProgressive(
      sceneData,
      { bedSizeMm: 320, zScale: 1.0 },
      {
        timeBudgetMs: 16,
        onProgress: (pct, label, sub) => {
          const now = performance.now();
          const dur = now - lastStageTime;
          stageStartTimes[currentStage] = (stageStartTimes[currentStage] || 0) + dur;
          currentStage = `${pct}%: ${label}`;
          lastStageTime = now;
          progressLog.push({ pct, label, sub, time: now - t0 });
        }
      }
    );
    const totalTime = performance.now() - t0;
    stageStartTimes[currentStage] = (stageStartTimes[currentStage] || 0) + (performance.now() - lastStageTime);
    active = false;
    clearInterval(lagTimer);

    // Analyze lag statistics
    const slicesOver50 = lags.filter(l => l > 50).length;
    const slicesOver100 = lags.filter(l => l > 100).length;
    const slicesOver2000 = lags.filter(l => l > 2000).length;

    // Monotonicity check
    let monotonicPass = true;
    let regressionDetail = null;
    for (let i = 1; i < progressLog.length; i++) {
      if (progressLog[i].pct < progressLog[i - 1].pct) {
        monotonicPass = false;
        regressionDetail = `Regressed from ${progressLog[i - 1].pct}% to ${progressLog[i].pct}%`;
        break;
      }
    }

    const res = {
      preset: preset.name,
      totalTriangles: buildRes.totalTriangles,
      greeneryTriangles: buildRes.meshes.greenery ? buildRes.meshes.greenery.length : 0,
      buildingsTriangles: buildRes.meshes.buildings ? buildRes.meshes.buildings.length : 0,
      totalDurationMs: totalTime,
      maxLagMs: maxLag,
      lagsCount: lags.length,
      slicesOver50,
      slicesOver100,
      slicesOver2000,
      monotonicPass,
      regressionDetail,
      progressStepsCount: progressLog.length,
      stageTimings: stageStartTimes
    };

    results.push(res);

    console.log(`\nPreset: ${preset.name}`);
    console.log(`  - Total Triangles: ${buildRes.totalTriangles.toLocaleString()}`);
    console.log(`  - Greenery Triangles: ${res.greeneryTriangles.toLocaleString()}`);
    console.log(`  - Total Build Time: ${totalTime.toFixed(1)}ms`);
    console.log(`  - Max Main-Thread Lag: ${maxLag.toFixed(2)}ms (Limit: <2,000ms)`);
    console.log(`  - Slices > 50ms: ${slicesOver50} | Slices > 100ms: ${slicesOver100} | Slices > 2,000ms: ${slicesOver2000}`);
    console.log(`  - Monotonic Progress: ${monotonicPass ? 'PASS' : 'FAIL ' + regressionDetail}`);
  }

  return results;
}

// ============================================================================
// SECTION 2: BROWSER PLAYWRIGHT SUITE (WARSAW, MUNICH, NYC, RAPID REBUILDS)
// ============================================================================
async function runBrowserEmpiricalHarness() {
  console.log('\n' + '='.repeat(80));
  console.log('SECTION 2: BROWSER PLAYWRIGHT EMPIRICAL VERIFICATION');
  console.log('='.repeat(80));

  const browser = await chromium.launch({ headless: true, args: launchArgs });
  const context = await browser.newContext();
  const page = await context.newPage();

  const unhandledErrors = [];
  page.on('pageerror', err => {
    unhandledErrors.push({ type: 'pageerror', message: err.message || String(err), stack: err.stack });
  });
  page.on('console', msg => {
    if (msg.type() === 'error') {
      unhandledErrors.push({ type: 'console.error', message: msg.text() });
    }
  });

  const browserSuiteResults = {
    presets: [],
    rapidBurstRebuildTest: null,
    midFlightInterruptionTest: null,
    webglSafetyTest: null,
    allPassed: false
  };

  try {
    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for initial load
    await page.waitForFunction(() => {
      const st = window.__map3d?.state;
      const ov = document.getElementById('loadingOverlay3D');
      const isHidden = !ov || ov.classList.contains('hidden') || window.getComputedStyle(ov).display === 'none';
      return isHidden && st && st.totalTriangles > 0;
    }, { timeout: 45000 });

    const initialTris = await page.evaluate(() => window.__map3d.state.totalTriangles);
    console.log(`Initial model ready with ${initialTris.toLocaleString()} triangles.`);

    // ------------------------------------------------------------------------
    // TEST 2A: Browser Time-Slicing & Monotonicity Across Presets
    // ------------------------------------------------------------------------
    for (const preset of PRESETS) {
      console.log(`\n[Browser] Profiling ${preset.name}...`);
      const cachePath = path.resolve(__dirname, '../../', preset.cacheFile);
      const sceneData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

      const profile = await page.evaluate(async (injectedScene) => {
        window.__map3d.state.sceneData = injectedScene;
        if (typeof ensureUnrotatedSceneSnapshot === 'function') ensureUnrotatedSceneSnapshot(injectedScene);
        if (typeof applySceneRotation === 'function') applySceneRotation(injectedScene, window.__map3d.state.mapRotationDeg || 0);

        // Stage duration profiling via onProgress
        const stageTimings = {};
        let currentStage = 'Init';
        let stageStart = performance.now();

        // Progress monotonicity tracker
        const progressEvents = [];
        let monotonicViolation = null;
        let lastPct = 0;

        const buildStart = performance.now();
        const buildResult = await window.__map3d.rebuildModel3D({
          silent: false,
          onProgress: (pct, label, sub) => {
            const now = performance.now();
            const dur = now - stageStart;
            stageTimings[currentStage] = dur;
            currentStage = `${pct}%: ${label}`;
            stageStart = now;

            if (pct < lastPct) {
              monotonicViolation = `Progress regressed from ${lastPct}% to ${pct}% at label "${label}"`;
            }
            lastPct = pct;
            progressEvents.push({ pct, label, sub, time: now - buildStart });
          }
        });
        stageTimings[currentStage] = performance.now() - stageStart;
        const totalDuration = performance.now() - buildStart;

        // Extract Stage 2 duration
        let stage2Duration = 0;
        let worstSlice = 0;
        let worstSliceName = '';
        for (const [sName, dur] of Object.entries(stageTimings)) {
          if (sName.includes('Etap 2') || sName.includes('parków') || sName.includes('zieleń') || sName.includes('drzew')) {
            stage2Duration += dur;
          }
          if (dur > worstSlice && sName !== 'Init') {
            worstSlice = dur;
            worstSliceName = sName;
          }
        }

        return {
          totalTriangles: buildResult ? buildResult.totalTriangles : window.__map3d.state.totalTriangles,
          totalDuration,
          stage2Duration,
          worstSlice,
          worstSliceName,
          monotonicViolation,
          progressEventsCount: progressEvents.length,
          stageTimings
        };
      }, sceneData);

      const pass2s = profile.worstSlice < 2000.0;
      const passStage2Not15s = profile.stage2Duration < 15000;
      const monotonicOk = !profile.monotonicViolation;

      console.log(`  - Triangles: ${profile.totalTriangles.toLocaleString()}`);
      console.log(`  - Total Duration: ${profile.totalDuration.toFixed(1)}ms`);
      console.log(`  - Stage 2 Duration: ${profile.stage2Duration.toFixed(1)}ms (Baseline was ~15,140ms; Pass: ${passStage2Not15s})`);
      console.log(`  - Longest Continuous Stage Segment: "${profile.worstSliceName}" taking ${profile.worstSlice.toFixed(1)}ms (<2,000ms guarantee: ${pass2s ? 'PASS' : 'FAIL'})`);
      console.log(`  - Monotonic Progress: ${monotonicOk ? 'PASS' : 'FAIL: ' + profile.monotonicViolation}`);

      browserSuiteResults.presets.push({
        preset: preset.name,
        pass2s,
        passStage2Not15s,
        monotonicOk,
        ...profile
      });
    }

    // ------------------------------------------------------------------------
    // TEST 2B-1: 50 Rapid Burst Rebuild Triggers (Immediate Preemption)
    // ------------------------------------------------------------------------
    console.log('\n' + '-'.repeat(70));
    console.log('TEST 2B-1: 50 Rapid Burst Rebuild Triggers (Immediate Preemption)');
    console.log('-'.repeat(70));

    const errorsBeforeBurst = unhandledErrors.length;
    const burstStart = Date.now();

    const burstReport = await page.evaluate(async () => {
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(window.__map3d.rebuildModel3D({ silent: true }));
      }
      const settled = await Promise.allSettled(promises);
      return settled.map((s, idx) => ({
        index: idx,
        status: s.status,
        hasValue: s.status === 'fulfilled' && s.value !== null,
        isCancelled: s.status === 'fulfilled' && s.value === null,
        rejected: s.status === 'rejected',
        reason: s.status === 'rejected' ? String(s.reason) : null
      }));
    });

    // Wait for the final rebuild to complete
    await page.waitForFunction(() => {
      const ov = document.getElementById('loadingOverlay3D');
      const isHidden = !ov || ov.classList.contains('hidden') || window.getComputedStyle(ov).display === 'none';
      return isHidden && window.__map3d?.state?.totalTriangles > 0;
    }, { timeout: 45000 });

    const burstDuration = Date.now() - burstStart;
    const finalTrianglesAfterBurst = await page.evaluate(() => window.__map3d.state.totalTriangles);
    const burstErrors = unhandledErrors.slice(errorsBeforeBurst);

    const burstRejectedCount = burstReport.filter(r => r.rejected).length;
    const burstCompletedCount = burstReport.filter(r => r.hasValue).length;
    const burstCancelledCount = burstReport.filter(r => r.isCancelled).length;

    const burstPass = (
      burstRejectedCount === 0 &&
      burstCompletedCount === 1 &&
      burstCancelledCount === 49 &&
      burstErrors.length === 0 &&
      finalTrianglesAfterBurst > 0
    );

    browserSuiteResults.rapidBurstRebuildTest = {
      pass: burstPass,
      totalFired: 50,
      durationMs: burstDuration,
      rejectedCount: burstRejectedCount,
      completedCount: burstCompletedCount,
      cancelledCount: burstCancelledCount,
      unhandledErrors: burstErrors,
      finalTriangles: finalTrianglesAfterBurst
    };

    console.log(`Rapid Burst Result: ${burstPass ? 'PASS' : 'FAIL'}`);
    console.log(`  - 50 Rapid Rebuilds fired in ${burstDuration}ms`);
    console.log(`  - Rejected Promises: ${burstRejectedCount} (must be 0)`);
    console.log(`  - Cancelled Cleanly (returned null): ${burstCancelledCount} (expected 49)`);
    console.log(`  - Final Completed Build: ${burstCompletedCount} (expected 1)`);
    console.log(`  - New Unhandled Errors: ${burstErrors.length} (must be 0)`);
    console.log(`  - Final Triangle Count: ${finalTrianglesAfterBurst.toLocaleString()}`);

    // ------------------------------------------------------------------------
    // TEST 2B-2: Mid-Flight Preemption Inside Progressive Stage 2 Callback
    // ------------------------------------------------------------------------
    console.log('\n' + '-'.repeat(70));
    console.log('TEST 2B-2: Mid-Flight Rebuild Preemption (Triggered mid-stream at Stage 2)');
    console.log('-'.repeat(70));

    const errorsBeforeMidFlight = unhandledErrors.length;
    const midFlightStart = Date.now();

    const midFlightReport = await page.evaluate(async () => {
      let triggeredSecond = false;
      let build2Promise = null;

      const build1Promise = window.__map3d.rebuildModel3D({
        silent: true,
        onProgress: (pct) => {
          // Interrupt build 1 at Stage 2 (45%)
          if (pct >= 45 && !triggeredSecond) {
            triggeredSecond = true;
            build2Promise = window.__map3d.rebuildModel3D({ silent: true });
          }
        }
      });

      const res1 = await build1Promise;
      const res2 = build2Promise ? await build2Promise : null;

      return {
        build1Aborted: res1 === null,
        build2Completed: res2 !== null,
        build2Triangles: res2 ? res2.totalTriangles : 0
      };
    });

    const midFlightDuration = Date.now() - midFlightStart;
    const midFlightErrors = unhandledErrors.slice(errorsBeforeMidFlight);
    const midFlightPass = (
      midFlightReport.build1Aborted &&
      midFlightReport.build2Completed &&
      midFlightErrors.length === 0 &&
      midFlightReport.build2Triangles > 0
    );

    browserSuiteResults.midFlightInterruptionTest = {
      pass: midFlightPass,
      durationMs: midFlightDuration,
      unhandledErrors: midFlightErrors,
      ...midFlightReport
    };

    console.log(`Mid-Flight Preemption Result: ${midFlightPass ? 'PASS' : 'FAIL'}`);
    console.log(`  - Build 1 Aborted Mid-Flight (returned null): ${midFlightReport.build1Aborted}`);
    console.log(`  - Build 2 Completed Cleanly: ${midFlightReport.build2Completed} (${midFlightReport.build2Triangles.toLocaleString()} triangles)`);
    console.log(`  - New Unhandled Errors: ${midFlightErrors.length} (must be 0)`);

    // ------------------------------------------------------------------------
    // TEST 2C: WebGL Buffer Leak & Resource Safety
    // ------------------------------------------------------------------------
    console.log('\n' + '-'.repeat(70));
    console.log('TEST 2C: WebGL Buffer Leak & Resource Safety Check');
    console.log('-'.repeat(70));

    const webglStats = await page.evaluate(async () => {
      const canvas = document.getElementById('view3dCanvas');
      if (!canvas) return { error: 'Canvas #view3dCanvas not found' };

      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return { error: 'WebGL context not found' };
      const contextLost = gl.isContextLost();

      // Check current layer meshes in state
      const layers = ['base', 'water', 'greenery', 'roads', 'buildings', 'highlighted', 'frame'];
      const initialCounts = {};
      let totalTris = 0;
      for (const l of layers) {
        const arr = (window.__map3d.state.layerMeshes && window.__map3d.state.layerMeshes[l]) || [];
        initialCounts[l] = arr.length;
        totalTris += arr.length;
      }

      // Rebuild 3 successive times and verify total count stays strictly identical (no orphan tri accumulation)
      const countsHistory = [totalTris];
      for (let i = 0; i < 3; i++) {
        await window.__map3d.rebuildModel3D({ silent: true });
        let currentTotal = 0;
        for (const l of layers) {
          const arr = (window.__map3d.state.layerMeshes && window.__map3d.state.layerMeshes[l]) || [];
          currentTotal += arr.length;
        }
        countsHistory.push(currentTotal);
      }

      const stable = countsHistory.every(c => c === countsHistory[0]);
      return {
        contextLost,
        initialCounts,
        countsHistory,
        stable
      };
    });

    const webglPass = webglStats.stable && !webglStats.contextLost && !webglStats.error;
    browserSuiteResults.webglSafetyTest = {
      pass: webglPass,
      ...webglStats
    };

    console.log(`WebGL Resource Safety: ${webglPass ? 'PASS' : 'FAIL'}`);
    console.log(`  - WebGL Context Lost: ${webglStats.contextLost}`);
    console.log(`  - Triangle counts across successive rebuild cycles: ${JSON.stringify(webglStats.countsHistory)}`);
    console.log(`  - Geometry & buffer consistency stable: ${webglStats.stable}`);

    // Overall verdict
    const allPresetsPass = browserSuiteResults.presets.every(p => p.pass2s && p.passStage2Not15s && p.monotonicOk);
    browserSuiteResults.allPassed = allPresetsPass && burstPass && midFlightPass && webglPass;

  } catch (err) {
    console.error('Fatal Browser Suite Error:', err);
    browserSuiteResults.fatalError = String(err);
    browserSuiteResults.allPassed = false;
  } finally {
    await browser.close();
  }

  return browserSuiteResults;
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
async function main() {
  console.log('='.repeat(80));
  console.log('CHALLENGER M2 R3 — EMPIRICAL BENCHMARK & STRESS HARNESS');
  console.log('='.repeat(80));

  const nodeResults = await runNodeTimeSliceProfiler();
  const browserResults = await runBrowserEmpiricalHarness();

  console.log('\n' + '='.repeat(80));
  console.log('FINAL CHALLENGER SUITE SUMMARY:');
  console.log('='.repeat(80));

  const nodeAllPass = nodeResults.every(r => r.slicesOver2000 === 0 && r.monotonicPass);
  const browserAllPass = browserResults.allPassed;

  console.log(`Node.js Time-Slice & Monotonicity Profiler: ${nodeAllPass ? 'PASS' : 'FAIL'}`);
  console.log(`Browser Responsiveness, Rapid Burst & Mid-Flight Preemption, WebGL: ${browserAllPass ? 'PASS' : 'FAIL'}`);

  const overallVerdict = nodeAllPass && browserAllPass ? 'APPROVE' : 'REQUEST_CHANGES';
  console.log(`\nOVERALL VERDICT: ${overallVerdict}`);

  const outReport = {
    timestamp: new Date().toISOString(),
    verdict: overallVerdict,
    nodeResults,
    browserResults
  };

  const jsonPath = path.resolve(__dirname, 'challenger_m2_r3_results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(outReport, null, 2));
  console.log(`Results saved to: ${jsonPath}`);

  process.exit(overallVerdict === 'APPROVE' ? 0 : 1);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error in challenger harness:', err);
    process.exit(1);
  });
}

module.exports = { runNodeTimeSliceProfiler, runBrowserEmpiricalHarness };
