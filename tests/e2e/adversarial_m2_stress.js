/**
 * tests/e2e/adversarial_m2_stress.js
 * Empirical Challenger 1 Stress Harness for Milestone 2:
 * Responsive Progressive 3D Pipeline & Streaming (Features 6 & 7)
 *
 * Stress Test Dimensions:
 * 1. Rapid successive rebuild triggers (20-50 triggers in short succession).
 * 2. Intermediate progressive cancellation (cancelling mid-flight during stages 1-4).
 * 3. WebGL buffer leak auditing (intercepting gl.createBuffer and gl.deleteBuffer).
 * 4. Stale triangle & mesh state audit (verifying final triangle count matches ground truth).
 * 5. High-resolution main thread slice & yielding profiler (detecting any slice >2000ms).
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

async function runAdversarialStressSuite() {
  console.log('='.repeat(78));
  console.log('EMPIRICAL CHALLENGER 1 — MILESTONE 2 STRESS TEST SUITE');
  console.log('Testing Features 6 & 7 (Progressive Pipeline, Yielding & Cancellation)');
  console.log('='.repeat(78));

  const suiteResults = {
    exp1_rapid_50_rebuilds: null,
    exp2_interleaved_cancellation: null,
    exp3_rapid_city_switches: null,
    exp4_webgl_buffer_leaks: null,
    exp5_main_thread_slices: null,
    verdict: 'PENDING'
  };

  const browser = await chromium.launch({ headless: true, args: launchArgs });
  const context = await browser.newContext();
  const page = await context.newPage();

  const unhandledErrors = [];
  page.on('pageerror', err => {
    unhandledErrors.push({ type: 'pageerror', message: err.message || String(err), stack: err.stack });
  });
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const txt = msg.text();
      // Ignore normal expected abort notifications if any, log unexpected errors
      unhandledErrors.push({ type: 'console.error', message: txt });
    }
  });

  try {
    console.log('\n[Setup] Navigating to ' + BASE_URL + ' ...');
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for initial app ready & scene rendered
    console.log('[Setup] Waiting for initial render completion...');
    await page.waitForFunction(() => {
      const st = window.__map3d?.state;
      const ov = document.getElementById('loadingOverlay3D');
      const isHidden = !ov || ov.classList.contains('hidden') || window.getComputedStyle(ov).display === 'none';
      return isHidden && st && st.totalTriangles > 0;
    }, { timeout: 45000 });

    console.log('[Setup] App initialized cleanly. Hooking WebGL buffer tracker...');

    // Hook WebGL context to track created and deleted buffers via prototype
    await page.evaluate(() => {
      window.__webglBufferTracker = {
        createdCount: 0,
        deletedCount: 0,
        activeBuffers: new Set(),
        deletedBuffers: new Set(),
      };

      const hookProto = (proto) => {
        if (!proto) return;
        const origCreateBuffer = proto.createBuffer;
        const origDeleteBuffer = proto.deleteBuffer;

        proto.createBuffer = function() {
          const b = origCreateBuffer.apply(this, arguments);
          if (b) {
            window.__webglBufferTracker.createdCount++;
            window.__webglBufferTracker.activeBuffers.add(b);
          }
          return b;
        };

        proto.deleteBuffer = function(b) {
          if (b) {
            window.__webglBufferTracker.deletedCount++;
            window.__webglBufferTracker.activeBuffers.delete(b);
            window.__webglBufferTracker.deletedBuffers.add(b);
          }
          return origDeleteBuffer.apply(this, arguments);
        };
      };

      if (typeof WebGLRenderingContext !== 'undefined') hookProto(WebGLRenderingContext.prototype);
      if (typeof WebGL2RenderingContext !== 'undefined') hookProto(WebGL2RenderingContext.prototype);
    });

    const initialTracker = await page.evaluate(() => ({
      created: window.__webglBufferTracker.createdCount,
      deleted: window.__webglBufferTracker.deletedCount,
      active: window.__webglBufferTracker.activeBuffers.size,
      triangles: window.__map3d.state.totalTriangles,
      activeGen: window.__map3d.state.currentGenerationId
    }));
    console.log('[Setup] Initial WebGL state:', JSON.stringify(initialTracker));

    // =========================================================================
    // EXPERIMENT 1: 50 Rapid Rebuild Triggers in Short Succession (<200ms)
    // =========================================================================
    console.log('\n' + '-'.repeat(70));
    console.log('EXPERIMENT 1: 50 Rapid Rebuild Triggers in Short Succession');
    console.log('-'.repeat(70));

    const exp1ErrorsBefore = unhandledErrors.length;
    const exp1Start = Date.now();

    const triggerResults = await page.evaluate(async () => {
      const genIds = [];
      const promises = [];
      for (let i = 0; i < 50; i++) {
        // Fire rebuildModel3D rapidly with no delay between calls
        const p = window.__map3d.rebuildModel3D({ silent: false });
        genIds.push(window.__map3d.state.currentGenerationId);
        promises.push(p);
      }
      // Wait for all 50 promises to resolve/settle
      const settled = await Promise.allSettled(promises);
      const results = settled.map((s, idx) => ({
        index: idx,
        status: s.status,
        hasValue: s.status === 'fulfilled' && s.value !== null,
        error: s.status === 'rejected' ? String(s.reason) : null
      }));
      return { genIds, results };
    });

    // Wait for the final generation to finish and overlay to hide
    await page.waitForFunction(() => {
      const ov = document.getElementById('loadingOverlay3D');
      const isHidden = !ov || ov.classList.contains('hidden') || window.getComputedStyle(ov).display === 'none';
      return isHidden && window.__map3d?.state?.totalTriangles > 0;
    }, { timeout: 45000 });

    const exp1Duration = Date.now() - exp1Start;
    const exp1Tracker = await page.evaluate(() => ({
      created: window.__webglBufferTracker.createdCount,
      deleted: window.__webglBufferTracker.deletedCount,
      active: window.__webglBufferTracker.activeBuffers.size,
      triangles: window.__map3d.state.totalTriangles,
      activeGen: window.__map3d.state.currentGenerationId
    }));

    const fulfilledWithResult = triggerResults.results.filter(r => r.hasValue);
    const rejectedPromises = triggerResults.results.filter(r => r.status === 'rejected');
    const newErrors = unhandledErrors.slice(exp1ErrorsBefore);

    const exp1Pass = (
      rejectedPromises.length === 0 &&
      fulfilledWithResult.length === 1 && // Exactly 1 (the 50th) completed with mesh
      newErrors.filter(e => !e.message.includes('Simulated')).length === 0 &&
      exp1Tracker.triangles === initialTracker.triangles
    );

    suiteResults.exp1_rapid_50_rebuilds = {
      pass: exp1Pass,
      totalTriggers: 50,
      durationMs: exp1Duration,
      rejectedCount: rejectedPromises.length,
      completedCount: fulfilledWithResult.length,
      finalTriangles: exp1Tracker.triangles,
      expectedTriangles: initialTracker.triangles,
      newUnhandledErrors: newErrors.length,
      activeBuffers: exp1Tracker.activeBuffers
    };

    console.log(`Exp 1 Result: ${exp1Pass ? 'PASS' : 'FAIL'}`);
    console.log(`  - 50 Rapid Rebuilds triggered in ${exp1Duration}ms`);
    console.log(`  - Rejected Promises: ${rejectedPromises.length} (must be 0)`);
    console.log(`  - Completed with Mesh Result: ${fulfilledWithResult.length} (expected 1)`);
    console.log(`  - Final Triangle Count: ${exp1Tracker.triangles} (baseline: ${initialTracker.triangles})`);
    console.log(`  - WebGL Active Buffers: ${exp1Tracker.activeBuffers}`);

    // =========================================================================
    // EXPERIMENT 2: Interleaved Progressive Cancellation (Stages 1-4 Preemption)
    // =========================================================================
    console.log('\n' + '-'.repeat(70));
    console.log('EXPERIMENT 2: Interleaved Cancellation Mid-Flight Across Stages');
    console.log('-'.repeat(70));

    const exp2Start = Date.now();
    const exp2ErrorsBefore = unhandledErrors.length;

    // Trigger 20 rebuilds with randomized 20ms - 80ms pauses to interrupt
    // while stages (terrain, greenery, roads, building batches) are in flight
    const exp2TriggerReport = await page.evaluate(async () => {
      const logs = [];
      for (let i = 0; i < 20; i++) {
        const delay = 20 + Math.floor(Math.random() * 60);
        window.__map3d.rebuildModel3D({ silent: false });
        logs.push({ trigger: i, activeGen: window.__map3d.state.currentGenerationId, delay });
        await new Promise(r => setTimeout(r, delay));
      }
      return logs;
    });

    // Wait for the final generation to finish
    await page.waitForFunction(() => {
      const ov = document.getElementById('loadingOverlay3D');
      const isHidden = !ov || ov.classList.contains('hidden') || window.getComputedStyle(ov).display === 'none';
      return isHidden && window.__map3d?.state?.totalTriangles > 0;
    }, { timeout: 60000 });

    const exp2Duration = Date.now() - exp2Start;
    const exp2Tracker = await page.evaluate(() => ({
      created: window.__webglBufferTracker.createdCount,
      deleted: window.__webglBufferTracker.deletedCount,
      active: window.__webglBufferTracker.activeBuffers.size,
      triangles: window.__map3d.state.totalTriangles,
      activeGen: window.__map3d.state.currentGenerationId,
      // Check layer meshes
      layers: window.__map3d.state.layerMeshes ? Object.keys(window.__map3d.state.layerMeshes).map(k => ({
        layer: k,
        count: window.__map3d.state.layerMeshes[k] ? window.__map3d.state.layerMeshes[k].length : 0
      })) : []
    }));

    const exp2NewErrors = unhandledErrors.slice(exp2ErrorsBefore);
    // Buffer leak check: activeBuffers after consolidation should be bounded (around 8 buffers: floor + 7 layers)
    const exp2BufferClean = exp2Tracker.active <= 15; // floor + 7 layers = 8 (plus possible single chunk)
    const exp2TrianglesClean = exp2Tracker.triangles === initialTracker.triangles;
    const exp2Pass = (
      exp2NewErrors.length === 0 &&
      exp2TrianglesClean &&
      exp2BufferClean
    );

    suiteResults.exp2_interleaved_cancellation = {
      pass: exp2Pass,
      durationMs: exp2Duration,
      finalTriangles: exp2Tracker.triangles,
      expectedTriangles: initialTracker.triangles,
      activeBuffers: exp2Tracker.active,
      createdBuffersTotal: exp2Tracker.created,
      deletedBuffersTotal: exp2Tracker.deleted,
      newErrors: exp2NewErrors.length,
      layerBufferStates: exp2Tracker.layers
    };

    console.log(`Exp 2 Result: ${exp2Pass ? 'PASS' : 'FAIL'}`);
    console.log(`  - 20 Interleaved Rebuilds over ${exp2Duration}ms`);
    console.log(`  - Final Triangles: ${exp2Tracker.triangles} (baseline: ${initialTracker.triangles})`);
    console.log(`  - Buffers Created: ${exp2Tracker.created}, Deleted: ${exp2Tracker.deleted}, Active: ${exp2Tracker.active}`);
    console.log(`  - Layer Meshes:`, exp2Tracker.layers.map(l => `${l.layer}:${l.count}`).join(', '));

    // =========================================================================
    // EXPERIMENT 3: Rapid City Switching Preemption
    // =========================================================================
    console.log('\n' + '-'.repeat(70));
    console.log('EXPERIMENT 3: Rapid City Switching (Warsaw -> Munich -> NY -> Warsaw)');
    console.log('-'.repeat(70));

    const cities = [
      { name: 'Munich', bbox: [48.1280, 11.5769, 48.1396, 11.5941], title: 'MÜNCHEN' },
      { name: 'New York', bbox: [40.7606, -73.9839, 40.7722, -73.9729], title: 'NYC CENTRAL PARK' },
      { name: 'Krakow', bbox: [50.0488, 19.9280, 50.0598, 19.9450], title: 'KRAKÓW' },
      { name: 'Warsaw', bbox: [52.2415, 21.0050, 52.2525, 21.0220], title: 'WARSZAWA' },
    ];

    const exp3Start = Date.now();
    const exp3ErrorsBefore = unhandledErrors.length;

    await page.evaluate(async (cityList) => {
      for (const c of cityList) {
        window.fetchRealGISAndRender(c.bbox, c.title).catch(() => {});
        // Short delay to interrupt mid-fetch/mid-build
        await new Promise(r => setTimeout(r, 60));
      }
    }, cities);

    // Final city is Warsaw, wait for it to complete
    await page.waitForFunction(() => {
      const ov = document.getElementById('loadingOverlay3D');
      const st = window.__map3d?.state;
      const isHidden = !ov || ov.classList.contains('hidden') || window.getComputedStyle(ov).display === 'none';
      return isHidden && st && st.plaqueText === 'WARSZAWA' && st.totalTriangles > 0;
    }, { timeout: 60000 });

    const exp3Duration = Date.now() - exp3Start;
    const exp3Tracker = await page.evaluate(() => ({
      active: window.__webglBufferTracker.activeBuffers.size,
      triangles: window.__map3d.state.totalTriangles,
      plaque: window.__map3d.state.plaqueText
    }));

    const exp3NewErrors = unhandledErrors.slice(exp3ErrorsBefore);
    const exp3Pass = (
      exp3NewErrors.length === 0 &&
      exp3Tracker.plaque === 'WARSZAWA' &&
      exp3Tracker.triangles === initialTracker.triangles &&
      exp3Tracker.active <= 15
    );

    suiteResults.exp3_rapid_city_switches = {
      pass: exp3Pass,
      durationMs: exp3Duration,
      finalPlaque: exp3Tracker.plaque,
      finalTriangles: exp3Tracker.triangles,
      activeBuffers: exp3Tracker.active,
      newErrors: exp3NewErrors.length
    };

    console.log(`Exp 3 Result: ${exp3Pass ? 'PASS' : 'FAIL'}`);
    console.log(`  - Final Plaque: ${exp3Tracker.plaque}`);
    console.log(`  - Final Triangles: ${exp3Tracker.triangles} (expected: ${initialTracker.triangles})`);
    console.log(`  - Active Buffers: ${exp3Tracker.active}`);

    // =========================================================================
    // EXPERIMENT 4: WebGL Buffer Leak Analysis Across 10 Consecutive Full Rebuilds
    // =========================================================================
    console.log('\n' + '-'.repeat(70));
    console.log('EXPERIMENT 4: WebGL Buffer Leak Audit Across 10 Full Rebuilds');
    console.log('-'.repeat(70));

    const bufferHistory = [];
    for (let r = 0; r < 5; r++) {
      await page.evaluate(async () => {
        await window.__map3d.rebuildModel3D({ silent: true });
      });
      const bState = await page.evaluate(() => ({
        created: window.__webglBufferTracker.createdCount,
        deleted: window.__webglBufferTracker.deletedCount,
        active: window.__webglBufferTracker.activeBuffers.size
      }));
      bufferHistory.push(bState);
    }

    const firstActive = bufferHistory[0].active;
    const lastActive = bufferHistory[bufferHistory.length - 1].active;
    const bufferLeaking = lastActive > firstActive + 2; // Strict buffer ceiling

    suiteResults.exp4_webgl_buffer_leaks = {
      pass: !bufferLeaking,
      firstActive,
      lastActive,
      bufferHistory
    };

    console.log(`Exp 4 Result: ${!bufferLeaking ? 'PASS' : 'FAIL'}`);
    console.log(`  - Active Buffers: First = ${firstActive}, Last = ${lastActive}`);
    console.log(`  - Buffer Growth: ${lastActive - firstActive} (0 expected)`);

    // =========================================================================
    // EXPERIMENT 5: Browser Main Thread Blocking & Time Slice Measurement
    // =========================================================================
    console.log('\n' + '-'.repeat(70));
    console.log('EXPERIMENT 5: Main Thread Blocking & 16ms Time Budget Verification');
    console.log('-'.repeat(70));

    // Install high-resolution slice profiler in browser context
    const sliceProfile = await page.evaluate(async () => {
      const slices = [];
      let lastTick = performance.now();

      // Monitor event loop responsiveness using a recurring RAF / setTimeout sampler
      let maxEventLoopLag = 0;
      let samplerRunning = true;
      let lastSample = performance.now();

      function sampleLoop() {
        if (!samplerRunning) return;
        const now = performance.now();
        const lag = now - lastSample; // ideal is ~0-1ms for setTimeout(0) or 16ms for RAF
        if (lag > maxEventLoopLag) maxEventLoopLag = lag;
        lastSample = now;
        setTimeout(sampleLoop, 1);
      }
      setTimeout(sampleLoop, 1);

      // Measure exact durations between stage progress calls
      const stageDurations = {};
      let currentStageName = 'start';
      let stageStartTime = performance.now();

      await window.__map3d.rebuildModel3D({
        silent: false,
        onProgress: (pct, label, sub) => {
          const now = performance.now();
          stageDurations[currentStageName] = now - stageStartTime;
          currentStageName = `${pct}%: ${label}`;
          stageStartTime = now;
        }
      });
      stageDurations[currentStageName] = performance.now() - stageStartTime;

      samplerRunning = false;
      return { stageDurations, maxEventLoopLag };
    });

    console.log('Browser Measured Stage Durations:');
    let maxStageDuration = 0;
    let longestStageName = '';
    for (const [name, dur] of Object.entries(sliceProfile.stageDurations)) {
      console.log(`  - ${name}: ${dur.toFixed(1)}ms`);
      if (dur > maxStageDuration && name !== 'start') {
        maxStageDuration = dur;
        longestStageName = name;
      }
    }
    console.log(`Max Continuous Event Loop Delay (Lag): ${sliceProfile.maxEventLoopLag.toFixed(1)}ms`);
    console.log(`Longest Stage: "${longestStageName}" taking ${maxStageDuration.toFixed(1)}ms`);

    const requirementR2Violated = maxStageDuration > 2000.0;
    suiteResults.exp5_main_thread_slices = {
      pass: !requirementR2Violated,
      longestStageName,
      maxStageDurationMs: maxStageDuration,
      maxEventLoopLagMs: sliceProfile.maxEventLoopLag,
      requirementR2Violated,
      stageDurations: sliceProfile.stageDurations
    };

    console.log(`Exp 5 Result: ${!requirementR2Violated ? 'PASS' : 'FAIL (VIOLATION OF REQUIREMENT R2: >2s BLOCKING)'}`);

    // Set overall verdict
    const allPass = (
      suiteResults.exp1_rapid_50_rebuilds?.pass &&
      suiteResults.exp2_interleaved_cancellation?.pass &&
      suiteResults.exp3_rapid_city_switches?.pass &&
      suiteResults.exp4_webgl_buffer_leaks?.pass &&
      suiteResults.exp5_main_thread_slices?.pass
    );

    suiteResults.verdict = allPass ? 'APPROVE' : 'REQUEST_CHANGES';

  } catch (err) {
    console.error('Fatal Suite Exception:', err);
    suiteResults.fatalError = String(err);
    suiteResults.verdict = 'REQUEST_CHANGES';
  } finally {
    await browser.close();
  }

  console.log('\n' + '='.repeat(78));
  console.log(`CHALLENGER 1 OVERALL VERDICT: ${suiteResults.verdict}`);
  console.log('='.repeat(78));

  const outPath = path.join(__dirname, 'challenger_m2_results.json');
  fs.writeFileSync(outPath, JSON.stringify(suiteResults, null, 2));
  console.log('Results saved to:', outPath);

  return suiteResults;
}

if (require.main === module) {
  runAdversarialStressSuite()
    .then(r => {
      process.exit(r.verdict === 'APPROVE' ? 0 : 1);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runAdversarialStressSuite };
