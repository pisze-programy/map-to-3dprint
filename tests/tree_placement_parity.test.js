// ============================================================================
// tests/tree_placement_parity.test.js
// EMPIRICAL VERIFICATION OF TREE PLACEMENT PARITY: SYNC VS PROGRESSIVE
// ============================================================================

const fs = require('fs');
const mb = require('../src/mesh/mesh_builder.js');

const presets = [
  { file: 'cache/scene_v5_52.2415_21.0050_52.2525_21.0220.json', title: 'WARSZAWA' },
  { file: 'cache/scene_v5_48.1280_11.5769_48.1396_11.5941.json', title: 'MÜNCHEN' },
  { file: 'cache/scene_v5_40.7606_-73.9839_40.7722_-73.9729.json', title: 'NEW YORK' },
  { file: 'cache/scene_v5_40.7069_-74.0137_40.7185_-73.9984.json', title: 'NEW YORK DOWNTOWN' },
  { file: 'cache/scene_v5_25.1865_55.2660_25.1981_55.2788.json', title: 'DUBAI' },
  { file: 'cache/scene_v5_50.0488_19.9280_50.0598_19.9450.json', title: 'KRAKÓW' },
  { file: 'cache/scene_v5_46.9421_7.4429_46.9539_7.4601.json', title: 'BERN' },
  { file: 'cache/scene_v5_47.2627_11.3847_47.2743_11.4019.json', title: 'INNSBRUCK' },
  { file: 'cache/scene_v5_54.4381_18.5575_54.4511_18.5797.json', title: 'SOPOT' },
  { file: 'cache/scene_v5_35.7060_139.7929_35.7176_139.8101.json', title: 'TOKYO' },
  { file: 'cache/scene_v5_1.2810_103.8487_1.2926_103.8603.json', title: 'SINGAPORE' },
  { file: 'cache/scene_v5_51.1702_-115.5803_51.1818_-115.5617.json', title: 'BANFF' },
  { file: 'cache/scene_v5_42.6352_18.1006_42.6468_18.1164.json', title: 'DUBROVNIK' }
];

async function verifyAllPresets() {
  console.log('================================================================');
  console.log('   EMPIRICAL AUDIT: TREE PLACEMENT PARITY (SYNC VS PROGRESSIVE)');
  console.log('================================================================\n');

  let totalTested = 0;
  let totalPassed = 0;
  const failureDetails = [];

  for (const preset of presets) {
    if (!fs.existsSync(preset.file)) {
      console.log(`[SKIP] ${preset.title}: File not found (${preset.file})`);
      continue;
    }

    totalTested++;
    const sc = JSON.parse(fs.readFileSync(preset.file));
    const state = { bedSizeMm: 320 };

    const tSync0 = performance.now();
    const syncModel = mb.buildComplete3DModel(sc, state);
    const syncDuration = performance.now() - tSync0;

    const tProg0 = performance.now();
    const progModel = await mb.rebuildModel3DProgressive(sc, state);
    const progDuration = performance.now() - tProg0;

    const syncTris = (syncModel.meshes.greenery || []).length;
    const progTris = (progModel.meshes.greenery || []).length;
    const diff = syncTris - progTris;

    const passed = diff === 0;
    if (passed) {
      totalPassed++;
      console.log(`  [PASS] ${preset.title.padEnd(20)} | Sync: ${String(syncTris).padStart(6)} tris (${syncDuration.toFixed(0)}ms) | Prog: ${String(progTris).padStart(6)} tris (${progDuration.toFixed(0)}ms) | Diff: ${diff}`);
    } else {
      failureDetails.push({ preset: preset.title, file: preset.file, syncTris, progTris, diff });
      console.log(`  [FAIL] ${preset.title.padEnd(20)} | Sync: ${String(syncTris).padStart(6)} tris | Prog: ${String(progTris).padStart(6)} tris | Diff: ${diff}`);
    }
  }

  console.log('\n================================================================');
  console.log(`RESULTS: ${totalPassed} / ${totalTested} presets passed tree placement parity.`);
  console.log('================================================================\n');

  if (failureDetails.length > 0) {
    console.error('Tree placement parity failures detected:');
    for (const f of failureDetails) {
      console.error(`  - ${f.preset}: Sync=${f.syncTris}, Prog=${f.progTris}, Diff=${f.diff}`);
    }
    process.exit(1);
  } else {
    console.log('ALL PRESETS VERIFIED: 100% TREE PLACEMENT TRIANGLE PARITY (DIFF: 0)');
  }
}

verifyAllPresets().catch(err => {
  console.error('Fatal error during tree parity verification:', err);
  process.exit(1);
});
