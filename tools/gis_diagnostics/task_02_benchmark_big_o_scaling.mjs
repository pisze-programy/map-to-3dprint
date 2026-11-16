#!/usr/bin/env node
// ============================================================================
// tools/gis_diagnostics/task_02_benchmark_big_o_scaling.mjs
// Task 02: Empirical Big-O Complexity Profiler (4x Input Growth -> O(N) Verification)
// ============================================================================

import assert from 'node:assert/strict';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

export async function runBigOBenchmark({ quiet = false } = {}) {
  const log = (...args) => { if (!quiet) console.log(...args); };
  log('=== TASK 02: Empirical Big-O Complexity Scaling Benchmark ===');

  require(path.join(ROOT, 'src/vendor/vendor_bundle.js'));
  Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/print_physics_config.js')));
  Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/sla_print_laws.js')));
  Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/polygon_2d.js')));
  Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/obb_medial_2d.js')));
  Object.assign(globalThis, require(path.join(ROOT, 'src/export/export_io_utils.js')));

  const gisFetch = require(path.join(ROOT, 'src/gis_fetch/index.js'));
  const waterRing = require(path.join(ROOT, 'src/Water/water_ring_geometry.js'));
  const s3dbMod = require(path.join(ROOT, 'src/gis_client/s3db_client_matcher.js'));
  const bridgesExt = require(path.join(ROOT, 'src/gis_client/osm_bridges_piers_extract.js'));
  const m3fMod = require(path.join(ROOT, 'src/export/export_3mf.js'));

  const metrics = {};

  // 1. Cross-chunk OSM element deduplication (N = 25k -> 100k -> 400k)
  {
    const runMerge = (nEls) => {
      const chunks = [[], [], [], []];
      for (let i = 0; i < nEls; i++) {
        chunks[i & 3].push({ type: 'node', id: i % Math.floor(nEls * 0.8), lat: 52.0 + i * 1e-6, lon: 21.0 + i * 1e-6 });
      }
      const t0 = performance.now();
      const out = gisFetch.mergeAndDeduplicateElements(chunks, 8000);
      return { ms: performance.now() - t0, count: out.length };
    };
    runMerge(5000); // warmup
    const a = runMerge(50000);
    const b = runMerge(200000);
    const ratio = b.ms / Math.max(0.2, a.ms);
    metrics.elementMerge = { ms50k: +a.ms.toFixed(2), ms200k: +b.ms.toFixed(2), ratio4x: +ratio.toFixed(2) };
    assert.ok(ratio < 7.0, `mergeAndDeduplicateElements Big-O regression: ratio=${ratio.toFixed(2)}x`);
    log(`  [PASS] mergeAndDeduplicateElements (50k -> 200k): ${a.ms.toFixed(1)}ms -> ${b.ms.toFixed(1)}ms (ratio=${ratio.toFixed(2)}x, O(N))`);
  }

  // 2. Exact Separable 2D EDT DEM Void Fill (G = 96 -> 192 -> 384, 4x pixels per step)
  {
    const runEdt = (G) => {
      const raw = new Float64Array(G * G);
      const mask = new Uint8Array(G * G);
      for (let y = 0; y < G; y++) {
        for (let x = 0; x < G; x++) {
          if ((x + y) % 3 === 0) {
            raw[y * G + x] = 100 + (x % 20);
            mask[y * G + x] = 1;
          }
        }
      }
      const t0 = performance.now();
      const filled = gisFetch.fillDemVoidsNearestO_G2(raw, mask, G, 100);
      return { ms: performance.now() - t0, sample: filled[1] };
    };
    runEdt(48); // warmup
    const a = runEdt(96);
    const b = runEdt(192);
    const c = runEdt(384);
    const ratio = c.ms / Math.max(0.2, b.ms);
    metrics.demVoidFillEdt = { msG96: +a.ms.toFixed(2), msG192: +b.ms.toFixed(2), msG384: +c.ms.toFixed(2), ratio4xPixels: +ratio.toFixed(2) };
    assert.ok(ratio < 7.0, `fillDemVoidsNearestO_G2 Big-O regression: ratio=${ratio.toFixed(2)}x`);
    log(`  [PASS] fillDemVoidsNearestO_G2 (192x192 -> 384x384): ${b.ms.toFixed(2)}ms -> ${c.ms.toFixed(2)}ms (ratio=${ratio.toFixed(2)}x, O(G^2))`);
  }

  // 3. Way-Ring Endpoint Hash Stitcher (M = 1000 -> 4000 segments)
  {
    const runStitch = (M) => {
      const segs = [];
      for (let i = 0; i < M; i++) {
        const a = i * 3, b = i * 3 + 1, c = i * 3 + 2, d = ((i + 1) % M) * 3;
        segs.push((i % 2 === 0) ? [a, b, c, d] : [d, c, b, a]);
      }
      for (let i = segs.length - 1; i > 0; i--) {
        const j = (i * 7919) % (i + 1);
        const tmp = segs[i]; segs[i] = segs[j]; segs[j] = tmp;
      }
      const t0 = performance.now();
      const rings = waterRing.stitchWayRingsJS(segs);
      return { ms: performance.now() - t0, rings: rings.length };
    };
    runStitch(250);
    const a = runStitch(1000);
    const b = runStitch(4000);
    const ratio = b.ms / Math.max(0.2, a.ms);
    assert.equal(b.rings, 1);
    metrics.stitchWayRings = { ms1k: +a.ms.toFixed(2), ms4k: +b.ms.toFixed(2), ratio4x: +ratio.toFixed(2) };
    assert.ok(ratio < 7.0, `stitchWayRingsJS Big-O regression: ratio=${ratio.toFixed(2)}x`);
    log(`  [PASS] stitchWayRingsJS (1k -> 4k segs): ${a.ms.toFixed(2)}ms -> ${b.ms.toFixed(2)}ms (ratio=${ratio.toFixed(2)}x, O(M))`);
  }

  // 4. S3DB Spatial Grid Part-to-Parent Matcher (10k -> 40k parents)
  {
    const runS3db = (N, P) => {
      const col = s3dbMod.createS3DBClientCollector(84.6, 84.6, 0.014);
      const cols = Math.ceil(Math.sqrt(N));
      for (let i = 0; i < N; i++) {
        const r = Math.floor(i / cols), c = i % cols;
        const cx = -80 + (c / cols) * 160, cy = -80 + (r / cols) * 160;
        col.registerCandidate(100000 + i, { building: 'yes', 'building:levels': '6' }, [[cx - 0.15, cy - 0.15], [cx + 0.15, cy - 0.15], [cx + 0.15, cy + 0.15], [cx - 0.15, cy + 0.15]], [], false, null, false);
      }
      for (let j = 0; j < P; j++) {
        const idx = Math.floor((j / P) * N);
        const r = Math.floor(idx / cols), c = idx % cols;
        const cx = -80 + (c / cols) * 160, cy = -80 + (r / cols) * 160;
        col.registerCandidate(500000 + j, { 'building:part': 'yes', 'building:levels': '12' }, [[cx - 0.08, cy - 0.08], [cx + 0.08, cy - 0.08], [cx + 0.08, cy + 0.08], [cx - 0.08, cy + 0.08]], [], true, null, false);
      }
      const t0 = performance.now();
      const out = col.resolveAndEmitS3DBBuildings();
      return { ms: performance.now() - t0, count: out.length };
    };
    runS3db(1000, 150);
    const a = runS3db(10000, 1600);
    const b = runS3db(40000, 6400);
    const ratio = b.ms / Math.max(1.0, a.ms);
    metrics.s3dbSpatialMatcher = { ms10k: +a.ms.toFixed(2), ms40k: +b.ms.toFixed(2), ratio4x: +ratio.toFixed(2) };
    assert.ok(ratio < 6.5, `S3DB matcher Big-O regression: ratio=${ratio.toFixed(2)}x`);
    log(`  [PASS] S3DB Part-Parent Matcher (10k -> 40k): ${a.ms.toFixed(1)}ms -> ${b.ms.toFixed(1)}ms (ratio=${ratio.toFixed(2)}x, O(N+P))`);
  }

  // 5. Bridge-Road-Water Spatial Grid Linker (8k -> 32k roads)
  {
    const runBr = (R, B, W) => {
      const roads = Array.from({ length: R }, (_, i) => {
        const x = -80 + ((i * 37) % 1000) * 0.16, y = -80 + ((i * 91) % 1000) * 0.16;
        const isBr = (i % 20 === 0);
        return { osmId: 1000 + i, pts: [[x, y], [x + 0.8, y + 0.2], [x + 1.6, y]], isBridge: isBr, bridge: isBr, layer: isBr ? 1 : 0, hasExplicitLayer: isBr, tags: isBr ? { highway: 'primary', bridge: 'yes', layer: '1' } : { highway: 'residential' } };
      });
      const bridgePolys = Array.from({ length: B }, (_, j) => {
        const x = -75 + ((j * 53) % 500) * 0.30, y = -75 + ((j * 71) % 500) * 0.30;
        return { osmId: 900000 + j, outer: [[x - 0.6, y - 0.3], [x + 0.6, y - 0.3], [x + 0.6, y + 0.3], [x - 0.6, y + 0.3]], holes: [], layer: 1, hasExplicitLayer: true, tags: { man_made: 'bridge', layer: '1' } };
      });
      const waterPolys = Array.from({ length: W }, (_, k) => {
        const x = -75 + ((k * 106) % 500) * 0.30, y = -75 + ((k * 142) % 500) * 0.30;
        return { outer: [[x - 1.2, y - 1.2], [x + 1.2, y - 1.2], [x + 1.2, y + 1.2], [x - 1.2, y + 1.2]], holes: [] };
      });
      const ctx = { roads, bridgePolys, waterPolys, waterLines: [], bridgeRelMeta: [], pierPolys: [], pierLines: [], bridgeSupports: [] };
      const t0 = performance.now();
      bridgesExt.finalizeOsmBridgesLayerJS(ctx);
      return { ms: performance.now() - t0 };
    };
    runBr(1000, 15, 8);
    const a = runBr(8000, 120, 60);
    const b = runBr(32000, 480, 240);
    const ratio = b.ms / Math.max(0.5, a.ms);
    metrics.bridgeSpatialLink = { ms8k: +a.ms.toFixed(2), ms32k: +b.ms.toFixed(2), ratio4x: +ratio.toFixed(2) };
    assert.ok(ratio < 6.5, `Bridge spatial link Big-O regression: ratio=${ratio.toFixed(2)}x`);
    log(`  [PASS] Bridge-Road-Water Spatial Linker (8k -> 32k): ${a.ms.toFixed(2)}ms -> ${b.ms.toFixed(2)}ms (ratio=${ratio.toFixed(2)}x, O(R+B+W))`);
  }

  // 6. Multi-Tile .3MF Streaming Exporter (150k -> 600k tris)
  {
    const run3mf = (nTri) => {
      const nVerts = Math.ceil(nTri / 2) + 3;
      const verts = Array.from({ length: nVerts }, (_, v) => [-80 + (v % 400) * 0.4, -80 + (Math.floor(v / 400) % 400) * 0.4, (v % 15) * 0.5]);
      const tris = Array.from({ length: nTri }, (_, i) => {
        const v0 = i % (nVerts - 2);
        return { v0: verts[v0], v1: verts[v0 + 1], v2: verts[v0 + 2], n: [0, 0, 1], layerId: 4, buildingId: 1, tileId: i & 3, shellId: 1, mBatch: 7, vi0: v0, vi1: v0 + 1, vi2: v0 + 2 };
      });
      let bytes = 0;
      globalThis.downloadBlobHook = (u8) => { bytes = u8.byteLength; };
      const t0 = performance.now();
      m3fMod.exportMultiColor3MF({
        targetWidthCm: 15, targetHeightCm: 15, bedSizeMm: 150, totalHeightMm: 150,
        tileCols: 2, tileRows: 2, plaqueText: 'BIGO_3MF',
        layerMeshes: { water: [], base: [], greenery: [], roads: [], buildings: tris, highlighted: [] },
      });
      const ms = performance.now() - t0;
      delete globalThis.downloadBlobHook;
      return { ms, bytes };
    };
    run3mf(20000);
    const a = run3mf(150000);
    const b = run3mf(600000);
    const ratio = b.ms / Math.max(1.0, a.ms);
    metrics.export3mfStreaming = { ms150k: +a.ms.toFixed(1), ms600k: +b.ms.toFixed(1), ratio4x: +ratio.toFixed(2) };
    assert.ok(ratio < 6.5, `exportMultiColor3MF Big-O regression: ratio=${ratio.toFixed(2)}x`);
    log(`  [PASS] exportMultiColor3MF Streaming (150k -> 600k tris): ${a.ms.toFixed(1)}ms -> ${b.ms.toFixed(1)}ms (ratio=${ratio.toFixed(2)}x, O(T))`);
  }

  return metrics;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBigOBenchmark().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
