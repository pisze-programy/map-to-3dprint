/**
 * tests/e2e/test_challenger_m2_r2_browser.js
 * Comprehensive Empirical Browser Slice Profiler & Adversarial Stress Tester
 * Challenger 1 (Milestone 2 - Iteration 2)
 *
 * Requirements to verify:
 * 1. Measure continuous execution slices during Stage 2 and across all stages.
 * 2. Confirm that Stage 2 NO LONGER blocks for 15.1s.
 * 3. Assert that NO execution slice exceeds 2,000ms (strictly testing Requirement R2).
 * 4. Assert that typical slices stay under 500ms (targeting <50ms per time budget).
 * 5. Re-verify rapid successive rebuild triggers (30-50 triggers) and cancellation.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

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

async function runBrowserEmpiricalChallenge() {
  console.log('='.repeat(80));
  console.log('EMPIRICAL CHALLENGER 1 (ITERATION 2) — BROWSER SLICE & YIELD PROFILER');
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

  const suiteResults = {
    rapidRebuildStress: null,
    browserProfiles: [],
    allPassed: false
  };

  try {
    console.log(`\n[Browser Setup] Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log('[Browser Setup] Waiting for initial render completion...');
    await page.waitForFunction(() => {
      const st = window.__map3d?.state;
      const ov = document.getElementById('loadingOverlay3D');
      const isHidden = !ov || ov.classList.contains('hidden') || window.getComputedStyle(ov).display === 'none';
      return isHidden && st && st.totalTriangles > 0;
    }, { timeout: 45000 });

    const initialTriangles = await page.evaluate(() => window.__map3d.state.totalTriangles);
    console.log(`[Browser Setup] Initial scene rendered cleanly with ${initialTriangles.toLocaleString()} triangles.`);

    // =========================================================================
    // PART 1: 50 RAPID SUCCESSIVE REBUILD TRIGGERS & CANCELLATION AUDIT
    // =========================================================================
    console.log('\n' + '-'.repeat(70));
    console.log('PART 1: 50 Rapid Successive Rebuild Triggers & Cancellation Audit');
    console.log('-'.repeat(70));

    const errorsBeforeTriggers = unhandledErrors.length;
    const triggerStart = Date.now();

    const triggerResults = await page.evaluate(async () => {
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(window.__map3d.rebuildModel3D({ silent: true }));
      }
      const settled = await Promise.allSettled(promises);
      return settled.map((s, idx) => ({
        index: idx,
        status: s.status,
        hasValue: s.status === 'fulfilled' && s.value !== null,
        error: s.status === 'rejected' ? String(s.reason) : null
      }));
    });

    // Wait for the final rebuild to complete
    await page.waitForFunction(() => {
      const ov = document.getElementById('loadingOverlay3D');
      const isHidden = !ov || ov.classList.contains('hidden') || window.getComputedStyle(ov).display === 'none';
      return isHidden && window.__map3d?.state?.totalTriangles > 0;
    }, { timeout: 45000 });

    const triggerDuration = Date.now() - triggerStart;
    const finalTrianglesAfterRapid = await page.evaluate(() => window.__map3d.state.totalTriangles);
    const rejectedCount = triggerResults.filter(r => r.status === 'rejected').length;
    const completedCount = triggerResults.filter(r => r.hasValue).length;
    const newErrors = unhandledErrors.slice(errorsBeforeTriggers);

    const rapidPass = (
      rejectedCount === 0 &&
      completedCount === 1 &&
      newErrors.length === 0 &&
      finalTrianglesAfterRapid === initialTriangles
    );

    suiteResults.rapidRebuildStress = {
      pass: rapidPass,
      totalTriggers: 50,
      durationMs: triggerDuration,
      rejectedCount,
      completedCount,
      finalTriangles: finalTrianglesAfterRapid,
      initialTriangles,
      unhandledErrorsCount: newErrors.length
    };

    console.log(`Part 1 Result: ${rapidPass ? 'PASS' : 'FAIL'}`);
    console.log(`  - 50 Rapid Rebuilds fired in ${triggerDuration}ms`);
    console.log(`  - Rejected Promises: ${rejectedCount} (must be 0)`);
    console.log(`  - Completed with Mesh Result: ${completedCount} (must be 1)`);
    console.log(`  - Final Triangles: ${finalTrianglesAfterRapid.toLocaleString()} (matches initial: ${finalTrianglesAfterRapid === initialTriangles})`);
    console.log(`  - New Unhandled Errors: ${newErrors.length} (must be 0)`);

    // =========================================================================
    // PART 2: CONTINUOUS EXECUTION SLICE PROFILER ACROSS WARSAW, MUNICH, NEW YORK
    // =========================================================================
    console.log('\n' + '-'.repeat(70));
    console.log('PART 2: Browser Continuous Execution Slices & Lag across Presets');
    console.log('-'.repeat(70));

    for (const preset of PRESETS) {
      console.log(`\nTesting Preset: ${preset.name}...`);

      // Read precomputed scene cache to test exact realistic geometry
      const cachePath = path.resolve(__dirname, '../../', preset.cacheFile);
      if (!fs.existsSync(cachePath)) {
        throw new Error(`Preset cache file not found: ${cachePath}`);
      }
      const sceneData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

      // Inject sceneData and run instrumented rebuildModel3D
      const profile = await page.evaluate(async (injectedScene) => {
        window.__map3d.state.sceneData = injectedScene;
        if (typeof ensureUnrotatedSceneSnapshot === 'function') ensureUnrotatedSceneSnapshot(injectedScene);
        if (typeof applySceneRotation === 'function') applySceneRotation(injectedScene, window.__map3d.state.mapRotationDeg || 0);

        // Continuous Event Loop Lag Sampler (every 1ms)
        let maxLag = 0;
        let lastSample = performance.now();
        let running = true;
        const recordedLags = [];

        function sample() {
          if (!running) return;
          const now = performance.now();
          const lag = now - lastSample;
          if (lag > maxLag) maxLag = lag;
          if (lag > 10) {
            recordedLags.push(lag);
          }
          lastSample = now;
          setTimeout(sample, 1);
        }
        setTimeout(sample, 1);

        // Stage duration profiling via onProgress
        const stageTimings = {};
        let currentStage = 'Init';
        let stageStart = performance.now();

        const buildResult = await window.__map3d.rebuildModel3D({
          silent: false,
          onProgress: (pct, label, sub) => {
            const now = performance.now();
            const dur = now - stageStart;
            stageTimings[currentStage] = dur;
            currentStage = `${pct}%: ${label}`;
            stageStart = now;
          }
        });
        stageTimings[currentStage] = performance.now() - stageStart;
        running = false;

        return {
          totalTriangles: buildResult ? buildResult.totalTriangles : window.__map3d.state.totalTriangles,
          maxLag,
          recordedLags,
          stageTimings
        };
      }, sceneData);

      // Analyze stage durations
      let stage2Duration = 0;
      let worstStageDuration = 0;
      let worstStageName = '';

      for (const [stName, dur] of Object.entries(profile.stageTimings)) {
        if (stName.includes('Etap 2') || stName.includes('parków') || stName.includes('zieleń') || stName.includes('drzew')) {
          stage2Duration += dur;
        }
        if (dur > worstStageDuration && stName !== 'Init') {
          worstStageDuration = dur;
          worstStageName = stName;
        }
      }

      const passStage2Not15s = stage2Duration < 15000;
      const passReqR2 = profile.maxLag < 2000.0 && worstStageDuration < 2000.0;
      const passTypical = profile.maxLag < 500.0;

      const presetResult = {
        name: preset.name,
        totalTriangles: profile.totalTriangles,
        stage2TotalMs: stage2Duration,
        maxEventLoopLagMs: profile.maxLag,
        worstStageName,
        worstStageDurationMs: worstStageDuration,
        passStage2Not15s,
        passReqR2,
        passTypical,
        stageTimings: profile.stageTimings
      };

      suiteResults.browserProfiles.push(presetResult);

      console.log(`Results for ${preset.name}:`);
      console.log(`  - Triangles: ${profile.totalTriangles.toLocaleString()}`);
      console.log(`  - Stage 2 Total Duration: ${stage2Duration.toFixed(1)}ms (Baseline was 15,141.5ms)`);
      console.log(`  - Max Event Loop Delay (Continuous Blocking Slice): ${profile.maxLag.toFixed(1)}ms`);
      console.log(`  - Longest Stage Segment: "${worstStageName}" taking ${worstStageDuration.toFixed(1)}ms`);
      console.log(`  - Stage 2 NO LONGER blocks for 15.1s: ${passStage2Not15s ? 'PASS' : 'FAIL'}`);
      console.log(`  - No slice > 2,000ms (Requirement R2): ${passReqR2 ? 'PASS' : 'FAIL'}`);
      console.log(`  - Typical slice < 500ms: ${passTypical ? 'PASS' : 'FAIL'}`);

      console.log('  - Key Stage Timings:');
      for (const [k, v] of Object.entries(profile.stageTimings)) {
        if (v > 50 || k.includes('Etap 2') || k.includes('Etap 4') || k.includes('Etap 5')) {
          console.log(`      * ${k}: ${v.toFixed(1)}ms`);
        }
      }
    }

    const allProfilesPass = suiteResults.browserProfiles.every(p => p.passReqR2 && p.passStage2Not15s);
    suiteResults.allPassed = suiteResults.rapidRebuildStress?.pass && allProfilesPass;

  } catch (err) {
    console.error('Fatal Browser Suite Exception:', err);
    suiteResults.fatalError = String(err);
    suiteResults.allPassed = false;
  } finally {
    await browser.close();
  }

  console.log('\n' + '='.repeat(80));
  console.log(`BROWSER SUITE FINAL RESULT: ${suiteResults.allPassed ? 'ALL PASS (APPROVE)' : 'FAIL (REQUEST_CHANGES)'}`);
  console.log('='.repeat(80));

  const outPath = path.resolve(__dirname, 'challenger_m2_r2_browser_results.json');
  fs.writeFileSync(outPath, JSON.stringify(suiteResults, null, 2));
  console.log('Browser results written to:', outPath);

  return suiteResults;
}

if (require.main === module) {
  runBrowserEmpiricalChallenge()
    .then(res => {
      process.exit(res.allPassed ? 0 : 1);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runBrowserEmpiricalChallenge };
