#!/usr/bin/env node
// ============================================================================
// tools/gis_diagnostics/task_03_probe_live_regions.mjs
// Task 03: Live Multi-Region GIS Fetcher & Diagnostic Session Inspector
// ============================================================================

import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const DEFAULT_REGIONS = [
  {
    id: 'warsaw_vistula',
    title: 'WARSZAWA STARE MIASTO & WISLA',
    lat: 52.2455,
    lon: 21.0215,
    spanMeters: 2600,
    targetWidthMm: 150,
    targetHeightMm: 150,
    minBuildings: 350,
    expectWater: true,
  },
  {
    id: 'zakopane_tatras',
    title: 'ZAKOPANE & TATRY WYSOKIE',
    lat: 49.2620,
    lon: 19.9810,
    spanMeters: 8500,
    targetWidthMm: 180,
    targetHeightMm: 140,
    minBuildings: 800,
    minReliefMeters: 450,
  },
  {
    id: 'venice_canals',
    title: 'VENEZIA CANAL GRANDE',
    lat: 45.4380,
    lon: 12.3358,
    spanMeters: 1500,
    targetWidthMm: 150,
    targetHeightMm: 150,
    minBuildings: 900,
    expectWater: true,
  },
];

function parseCliArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2)
      .filter((a) => a.startsWith('--') && a.includes('='))
      .map((a) => {
        const idx = a.indexOf('=');
        return [a.slice(2, idx), a.slice(idx + 1)];
      })
  );
  const regions = (args.lat && args.lon)
    ? [{
        id: 'custom_cli',
        title: args.title || 'CUSTOM_REGION',
        lat: Number(args.lat),
        lon: Number(args.lon),
        spanMeters: Number(args.span || 2500),
        targetWidthMm: Number(args.widthMm || 150),
        targetHeightMm: Number(args.heightMm || 150),
        minBuildings: 0,
      }]
    : null;
  return {
    proxyOrigin: args.proxy || null,
    regions,
  };
}

export async function runLiveRegionsProbe({ proxyOrigin = null, regions = null } = {}) {
  const { createPipelineRuntime } = require(path.join(ROOT, 'tools/headless_scene_harness.js'));
  const parsed = parseCliArgs();
  const effProxy = proxyOrigin ?? parsed.proxyOrigin;
  const targetRegions = regions || parsed.regions || DEFAULT_REGIONS;
  const summaries = [];

  console.log(`=== TASK 03: Live Multi-Region GIS Fetcher Probe (mode=${effProxy || 'direct-overpass'}) ===`);

  for (const reg of targetRegions) {
    const vmRuntime = createPipelineRuntime({ offlineOnly: false, silent: true });
    await vmRuntime.sandbox.__ensureManifoldReady();
    if (effProxy) {
      vmRuntime.sandbox.window.location.protocol = 'http:';
      vmRuntime.sandbox.window.location.origin = effProxy;
    }

    // Fetch direct Overpass endpoints (or optional --proxy origin when specified)
    const origFetch = globalThis.fetch;
    vmRuntime.sandbox._overpassCustomFetch = async (ep, init) => {
      const url = (ep.startsWith('/') && effProxy) ? `${effProxy}${ep}` : ep;
      return origFetch(url, init);
    };

    const aspect = reg.targetWidthMm / reg.targetHeightMm;
    const spanEwM = aspect >= 1 ? reg.spanMeters : reg.spanMeters * aspect;
    const spanNsM = aspect >= 1 ? reg.spanMeters / aspect : reg.spanMeters;
    const cosLat = Math.max(0.2, Math.cos((reg.lat * Math.PI) / 180));
    const halfDLat = (spanNsM * 0.5 * 1.06) / 111320.0;
    const halfDLon = (spanEwM * 0.5 * 1.06) / (111320.0 * cosLat);

    const t0 = performance.now();
    const scene = await vmRuntime.sandbox.fetchChunkedGISInBrowser(
      reg.lat - halfDLat,
      reg.lon - halfDLon,
      reg.lat + halfDLat,
      reg.lon + halfDLon,
      reg.title,
      {
        targetSpanMeters: reg.spanMeters,
        targetWidthMm: reg.targetWidthMm,
        targetHeightMm: reg.targetHeightMm,
      }
    );
    const fetchMs = Math.round(performance.now() - t0);
    const diag = vmRuntime.sandbox.__map3dFetchDiagnostics.getFetchDiagnosticsReport().latestSession;
    const reliefM = Math.round(((scene.dem?.maxElev ?? 0) - (scene.dem?.minElev ?? 0)) * 10) / 10;

    const row = {
      id: reg.id,
      title: reg.title,
      spanMeters: reg.spanMeters,
      plateMm: `${reg.targetWidthMm}x${reg.targetHeightMm}`,
      grid: `${scene._chunkStats.rows}x${scene._chunkStats.cols}`,
      loadedChunks: `${scene._chunkStats.loadedChunks}/${scene._chunkStats.totalChunks}`,
      failedChunks: scene._chunkStats.failedChunks,
      subSplits: diag ? diag.counters.subSplits : 0,
      fetchMs,
      buildings: scene.buildings.length,
      roads: scene.roads.length,
      waterPolys: scene.waterPolys.length,
      greenPolys: scene.greenPolys.length,
      trees: scene.trees.length,
      demZoom: scene.dem?.zoom,
      reliefM,
      scene,
    };
    console.log(
      `  [${row.id}] ${row.grid} (${row.loadedChunks}, splits=${row.subSplits}) in ${(fetchMs / 1000).toFixed(1)}s | ` +
      `bld=${row.buildings}, roads=${row.roads}, water=${row.waterPolys}, green=${row.greenPolys}, trees=${row.trees}, DEM Z=${row.demZoom} (dH=${row.reliefM}m)`
    );
    summaries.push(row);
  }

  return summaries;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLiveRegionsProbe().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
