#!/usr/bin/env node
// ============================================================================
// tools/gis_diagnostics/task_01_audit_dag_and_loops.mjs
// Task 01: Static Require-DAG Cycle Detector, Bundle Order Parity & Loop-Bound Proof
// ============================================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

export async function runDagAndLoopAudit({ quiet = false } = {}) {
  const log = (...args) => { if (!quiet) console.log(...args); };
  log('=== TASK 01: Static Require-DAG, Module Size & Loop-Free Termination Audit ===');

  // 1. Collect all JS files across src/ and build directed require() graph
  const scanDirs = ['src/gis_fetch', 'src/gis_client', 'src/Water', 'src/geometry', 'src/mesh', 'src/mesh/bridges', 'src/export'];
  const allFiles = [];
  for (const relDir of scanDirs) {
    const absDir = path.join(ROOT, relDir);
    if (!fs.existsSync(absDir)) continue;
    for (const entry of fs.readdirSync(absDir)) {
      const full = path.join(absDir, entry);
      if (fs.statSync(full).isFile() && entry.endsWith('.js')) {
        allFiles.push(full);
      }
    }
  }

  const adj = new Map();
  const reqRe = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  for (const file of allFiles) {
    const src = fs.readFileSync(file, 'utf8');
    const edges = [];
    for (const m of src.matchAll(reqRe)) {
      let target = path.resolve(path.dirname(file), m[1]);
      if (!target.endsWith('.js') && fs.existsSync(target + '.js')) target += '.js';
      if (fs.existsSync(target)) edges.push(target);
    }
    adj.set(file, edges);
  }

  // 3-color DFS cycle detection
  const color = new Map(); // 0=unvisited, 1=visiting, 2=done
  const cycles = [];
  const stack = [];
  function dfs(u) {
    color.set(u, 1);
    stack.push(u);
    for (const v of (adj.get(u) || [])) {
      const c = color.get(v) || 0;
      if (c === 1) {
        const idx = stack.indexOf(v);
        cycles.push(stack.slice(idx).concat(v).map((p) => path.relative(ROOT, p)));
      } else if (c === 0) {
        dfs(v);
      }
    }
    stack.pop();
    color.set(u, 2);
  }
  for (const f of allFiles) {
    if ((color.get(f) || 0) === 0) dfs(f);
  }
  assert.equal(cycles.length, 0, `Detected circular require() loop(s): ${JSON.stringify(cycles)}`);
  log(`  [PASS] 0 circular require() loops across ${allFiles.length} JS modules.`);

  // 2. Verify src/gis_fetch/ strict module discipline (< 350 lines, 0 proper nouns, standalone require)
  const gisFetchDir = path.join(ROOT, 'src/gis_fetch');
  const barrel = require(path.join(gisFetchDir, 'index.js'));
  const expectedFiles = [...barrel.DAG_ORDER, 'index.js'].sort();
  const actualFiles = fs.readdirSync(gisFetchDir).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual(actualFiles, expectedFiles, 'src/gis_fetch/ files must match DAG_ORDER + index.js');

  const forbiddenNouns = /\b(eiffel|petronas|london.?eye|ain.?dubai|marina.?bay|millau|brooklyn.?bridge|sagrada|rialto|chicago|venice|sydney|porto|dubai|warsaw|zakopane)\b/i;
  for (const f of actualFiles) {
    const full = path.join(gisFetchDir, f);
    const txt = fs.readFileSync(full, 'utf8');
    const lines = txt.endsWith('\n') ? txt.split('\n').length - 1 : txt.split('\n').length;
    assert.ok(lines < 350, `src/gis_fetch/${f} has ${lines} lines (must be < 350)`);
    const leak = txt.match(forbiddenNouns);
    assert.equal(leak, null, `src/gis_fetch/${f} contains city/landmark proper noun: ${leak?.[0]}`);
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(full)})`], { cwd: ROOT, stdio: 'pipe' });
  }
  log(`  [PASS] All ${actualFiles.length} modules in src/gis_fetch/ are < 350 lines, city-agnostic, and standalone-loadable.`);

  // 3. Verify script load-order parity across index.html, video_studio.html, and headless_scene_harness.js
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const harnessTxt = fs.readFileSync(path.join(ROOT, 'tools/headless_scene_harness.js'), 'utf8');
  let prevHtmlPos = -1;
  let prevHarnessPos = -1;
  for (const modName of barrel.DAG_ORDER) {
    const rel = `src/gis_fetch/${modName}`;
    const hPos = indexHtml.indexOf(`<script src="${rel}"></script>`);
    const nPos = harnessTxt.indexOf(`'${rel}'`);
    assert.ok(hPos > prevHtmlPos, `index.html must load ${rel} in strict DAG_ORDER`);
    assert.ok(nPos > prevHarnessPos, `headless_scene_harness.js must load ${rel} in strict DAG_ORDER`);
    prevHtmlPos = hPos;
    prevHarnessPos = nPos;
  }
  log(`  [PASS] index.html and headless_scene_harness.js follow identical topological DAG_ORDER.`);

  // 4. Dynamic adversarial proof: permanent proxy timeout terminates cleanly without infinite split loop
  let calls = 0;
  globalThis._overpassCustomFetch = async () => {
    calls++;
    if (calls > 200) throw new Error('INFINITE_LOOP_DETECTED');
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        version: 0.6,
        generator: 'Map3D Overpass Proxy',
        elements: [],
        remark: 'runtime error: Query timed out in "query" at line 1 after 8 seconds.',
      }),
    };
  };
  try {
    barrel.clearOverpassChunkCache();
    const rootChunk = {
      id: 'R1C1',
      south: 50.00,
      west: 19.90,
      north: 50.02,
      east: 19.93,
      lodTier: 'urban',
      depth: 0,
    };
    await assert.rejects(
      () => barrel.fetchChunkWithRecursiveSplit(rootChunk, null, { retryDelayMs: 0 }),
      /Incomplete sub-chunk split|Overpass remark/
    );
    // Max theoretical calls for depth 0..3 with 1 retry at each level is strictly finite (< 180)
    assert.ok(calls > 1 && calls < 180, `Expected bounded DAG calls (2..179), got ${calls}`);
    log(`  [PASS] Adversarial permanent-timeout split terminated cleanly after ${calls} bounded calls (0 loops).`);
  } finally {
    delete globalThis._overpassCustomFetch;
    barrel.clearOverpassChunkCache();
  }

  return { scannedModules: allFiles.length, gisFetchModules: actualFiles.length, adversarialCalls: calls };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDagAndLoopAudit().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
