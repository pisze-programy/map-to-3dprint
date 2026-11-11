/**
 * tests/e2e/test_challenger_m2_r2_slices.js
 * Adversarial Continuous Execution Slice & Yielding Profiler
 * For Milestone 2 (Iteration 2)
 *
 * Verifies:
 * 1. Continuous execution slices during Stage 2 and across all stages.
 * 2. Stage 2 NO LONGER blocks for 15.1s.
 * 3. NO single execution slice exceeds 2,000ms (Requirement R2).
 * 4. Typical slices stay under 500ms (targeting <50ms per time budget).
 * 5. Tested across Warsaw Old Town, Munich Marienplatz, and New York Central Park in Node.js.
 */

const fs = require('fs');
const path = require('path');
const { rebuildModel3DProgressive } = require('../../src/mesh/mesh_builder.js');

const PRESETS = [
  {
    name: 'Warsaw Old Town',
    file: 'cache/scene_v5_52.2415_21.0050_52.2525_21.0220.json',
    options: { bedSizeMm: 320, zScale: 1.0 }
  },
  {
    name: 'Munich Marienplatz',
    file: 'cache/scene_v5_48.1280_11.5769_48.1396_11.5941.json',
    options: { bedSizeMm: 320, zScale: 1.0 }
  },
  {
    name: 'New York Central Park',
    file: 'cache/scene_v5_40.7606_-73.9839_40.7722_-73.9729.json',
    options: { bedSizeMm: 320, zScale: 1.0 }
  }
];

async function profilePresetInNode(preset) {
  console.log(`\n======================================================================`);
  console.log(`Profiling Node.js Slices: ${preset.name}`);
  console.log(`File: ${preset.file}`);
  console.log(`======================================================================`);

  if (!fs.existsSync(preset.file)) {
    throw new Error(`Scene cache file not found: ${preset.file}`);
  }

  const rawJson = fs.readFileSync(preset.file, 'utf8');
  const scene = JSON.parse(rawJson);

  // Stage tracking
  const stageMetrics = {};
  let currentStage = 'Init';
  let stageStart = performance.now();

  function recordStageTransition(nextStage) {
    const now = performance.now();
    const duration = now - stageStart;
    if (!stageMetrics[currentStage]) {
      stageMetrics[currentStage] = { totalDurationMs: 0, yieldsCount: 0, maxLagMs: 0, slices: [] };
    }
    stageMetrics[currentStage].totalDurationMs += duration;
    currentStage = nextStage;
    stageStart = now;
  }

  // Independent Event Loop Lag Sampler (every 2ms)
  let maxLoopLag = 0;
  const loopLags = [];
  let lastSample = performance.now();
  let sampling = true;

  const timer = setInterval(() => {
    if (!sampling) return;
    const now = performance.now();
    const lag = now - lastSample; // Target interval is 2ms; lag > 5ms indicates main thread execution slice
    if (lag > maxLoopLag) maxLoopLag = lag;
    if (lag > 10) {
      loopLags.push({ time: now, stage: currentStage, lagMs: lag });
      if (!stageMetrics[currentStage]) {
        stageMetrics[currentStage] = { totalDurationMs: 0, yieldsCount: 0, maxLagMs: 0, slices: [] };
      }
      if (lag > stageMetrics[currentStage].maxLagMs) {
        stageMetrics[currentStage].maxLagMs = lag;
      }
      stageMetrics[currentStage].slices.push(lag);
    }
    lastSample = now;
  }, 2);

  const overallStart = performance.now();

  const result = await rebuildModel3DProgressive(
    scene,
    preset.options,
    {
      timeBudgetMs: 16,
      onProgress: (pct, label, sub) => {
        recordStageTransition(`${pct}%: ${label}`);
      },
      onStageReady: (layer, data, meta) => {
        // layer ready callback
      }
    }
  );

  recordStageTransition('Done');
  sampling = false;
  clearInterval(timer);

  const overallDuration = performance.now() - overallStart;

  console.log(`Model Built: ${result.totalTriangles.toLocaleString()} triangles in ${overallDuration.toFixed(1)}ms`);
  console.log(`Max Continuous Event Loop Lag: ${maxLoopLag.toFixed(1)}ms`);

  console.log('\nBreakdown by Stage:');
  let worstSliceAcrossStages = 0;
  let worstStage = '';

  for (const [sName, m] of Object.entries(stageMetrics)) {
    const maxSlice = m.maxLagMs || 0;
    const sliceCount = m.slices.length;
    const avgSlice = sliceCount > 0 ? (m.slices.reduce((a, b) => a + b, 0) / sliceCount) : 0;
    console.log(`  [${sName}]`);
    console.log(`    Total time: ${m.totalDurationMs.toFixed(1)}ms`);
    console.log(`    Max slice/lag: ${maxSlice.toFixed(1)}ms | Measured blocking slices: ${sliceCount} | Avg slice: ${avgSlice.toFixed(1)}ms`);

    if (maxSlice > worstSliceAcrossStages) {
      worstSliceAcrossStages = maxSlice;
      worstStage = sName;
    }
  }

  // Identify Stage 2 specific metrics
  let stage2Total = 0;
  let stage2MaxSlice = 0;
  for (const [sName, m] of Object.entries(stageMetrics)) {
    if (sName.includes('Etap 2') || sName.includes('parków') || sName.includes('zieleń') || sName.includes('drzew')) {
      stage2Total += m.totalDurationMs;
      if (m.maxLagMs > stage2MaxSlice) stage2MaxSlice = m.maxLagMs;
    }
  }

  console.log(`\nStage 2 Summary for ${preset.name}:`);
  console.log(`  Stage 2 Total Duration: ${stage2Total.toFixed(1)}ms (Baseline was 5,800ms - 13,300ms)`);
  console.log(`  Stage 2 Max Continuous Slice: ${stage2MaxSlice.toFixed(1)}ms (Requirement R2 Limit: 2,000ms)`);

  const passR2 = worstSliceAcrossStages < 2000.0;
  const passTypical = worstSliceAcrossStages < 500.0;
  const passStage2 = stage2MaxSlice < 2000.0;

  console.log(`\nCriteria Check for ${preset.name}:`);
  console.log(`  - Stage 2 does NOT block for 15.1s: ${stage2Total < 15000 ? 'PASS' : 'FAIL'} (${stage2Total.toFixed(1)}ms)`);
  console.log(`  - Stage 2 max slice < 2,000ms: ${passStage2 ? 'PASS' : 'FAIL'} (${stage2MaxSlice.toFixed(1)}ms)`);
  console.log(`  - Pipeline worst slice < 2,000ms (Req R2): ${passR2 ? 'PASS' : 'FAIL'} (${worstSliceAcrossStages.toFixed(1)}ms)`);
  console.log(`  - Pipeline worst slice < 500ms (Typical): ${passTypical ? 'PASS' : 'FAIL'} (${worstSliceAcrossStages.toFixed(1)}ms)`);

  return {
    preset: preset.name,
    overallDurationMs: overallDuration,
    totalTriangles: result.totalTriangles,
    worstSliceAcrossStages,
    worstStage,
    stage2TotalMs: stage2Total,
    stage2MaxSliceMs: stage2MaxSlice,
    passR2,
    passTypical,
    passStage2,
    stageMetrics
  };
}

async function runAllNodeProfiles() {
  const results = [];
  for (const p of PRESETS) {
    const res = await profilePresetInNode(p);
    results.push(res);
  }

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY OF ALL NODE.JS PRESET PROFILES:');
  console.log('='.repeat(70));
  let allPass = true;
  for (const r of results) {
    console.log(`${r.preset}:`);
    console.log(`  - Triangles: ${r.totalTriangles.toLocaleString()}`);
    console.log(`  - Overall Time: ${r.overallDurationMs.toFixed(1)}ms`);
    console.log(`  - Stage 2 Duration: ${r.stage2TotalMs.toFixed(1)}ms`);
    console.log(`  - Stage 2 Max Slice: ${r.stage2MaxSliceMs.toFixed(1)}ms`);
    console.log(`  - Worst Pipeline Slice: ${r.worstSliceAcrossStages.toFixed(1)}ms in "${r.worstStage}"`);
    console.log(`  - Verdict: ${r.passR2 && r.passStage2 ? 'PASS' : 'FAIL'}`);
    if (!r.passR2 || !r.passStage2) allPass = false;
  }

  return { allPass, results };
}

if (require.main === module) {
  runAllNodeProfiles()
    .then(out => {
      process.exit(out.allPass ? 0 : 1);
    })
    .catch(err => {
      console.error('Fatal error during profiling:', err);
      process.exit(1);
    });
}

module.exports = { runAllNodeProfiles, profilePresetInNode };
