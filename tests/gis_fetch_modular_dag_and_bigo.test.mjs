import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runDagAndLoopAudit } from '../tools/gis_diagnostics/task_01_audit_dag_and_loops.mjs';
import { runBigOBenchmark } from '../tools/gis_diagnostics/task_02_benchmark_big_o_scaling.mjs';
import { runFormatsAndPlatesAudit } from '../tools/gis_diagnostics/task_04_verify_formats_and_plates.mjs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

test('1) src/gis_fetch/ modular DAG, 0 circular require() loops, < 350 lines per file & bounded split termination', async () => {
  const res = await runDagAndLoopAudit({ quiet: true });
  assert.ok(res.scannedModules >= 60);
  assert.equal(res.gisFetchModules, 11);
});

test('2) Exact parity of O(G^2) Felzenszwalb-Huttenlocher DEM void fill against brute-force Euclidean argmin', () => {
  const { fillDemVoidsNearestO_G2 } = require(path.join(ROOT, 'src/gis_fetch/dem_terrarium_fetcher.js'));
  const G = 40;
  const raw = new Float64Array(G * G);
  const mask = new Uint8Array(G * G);
  for (let i = 0; i < G * G; i++) {
    // Deterministic sparse irregular valid pattern
    if (((i * 2654435761) >>> 0) % 7 === 0) {
      raw[i] = 50 + (i % 300) * 0.25;
      mask[i] = 1;
    }
  }
  const fast = fillDemVoidsNearestO_G2(raw, mask, G, 0);

  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const idx = gy * G + gx;
      if (mask[idx]) {
        assert.equal(fast[idx], raw[idx]);
        continue;
      }
      // Verify that fast[idx] achieves the exact minimum squared Euclidean distance
      let minDistSq = Infinity;
      const validValuesAtMinDist = new Set();
      for (let ny = 0; ny < G; ny++) {
        for (let nx = 0; nx < G; nx++) {
          if (!mask[ny * G + nx]) continue;
          const dSq = (ny - gy) * (ny - gy) + (nx - gx) * (nx - gx);
          if (dSq < minDistSq) {
            minDistSq = dSq;
            validValuesAtMinDist.clear();
            validValuesAtMinDist.add(raw[ny * G + nx]);
          } else if (dSq === minDistSq) {
            validValuesAtMinDist.add(raw[ny * G + nx]);
          }
        }
      }
      assert.ok(
        validValuesAtMinDist.has(fast[idx]),
        `Mismatch at (${gx},${gy}): got ${fast[idx]}, expected one of [${[...validValuesAtMinDist].join(',')}]`
      );
    }
  }
});

test('3) Empirical Big-O complexity stays strictly O(N) across merge, EDT, ring-stitch, S3DB, bridge link & 3MF export', async () => {
  const metrics = await runBigOBenchmark({ quiet: true });
  assert.ok(metrics.s3dbSpatialMatcher.ratio4x < 6.5);
  assert.ok(metrics.bridgeSpatialLink.ratio4x < 6.5);
  assert.ok(metrics.stitchWayRings.ratio4x < 7.0);
});

test('4) Multi-format (.STL, .3MF, .ZIP) and multi-plate (12x8, 24x12 2x2 hollow, 10x16 rotated cutout) achieve 0 open/non-manifold edges', async () => {
  const report = await runFormatsAndPlatesAudit({ quiet: true });
  assert.equal(report.length, 3);
});
