#!/usr/bin/env node
'use strict';

/**
 * Generates the 2-tile physical MSLA calibration coupon (exports/paris_seam_coupon_80x50_1x2/):
 * two mating 80 x 25 mm Paris Pont de l'Alma / Quai d'Orsay / Cours Albert Ier riverbank &
 * Haussmann block strips fitting ONE Photon Mono 4 plate (>= 8.0 mm gap) with Zmax <= 16.0 mm,
 * < 15.0 ml resin, intact dual-shore arch bridge, DFM-06 bottom chamfer, and 1.5 mm
 * underside stress-relief channels.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname || process.cwd(), '..');
const { handleExportMap3DStl } = await import(path.join(ROOT, 'tools/mcp_map3d_inspector.mjs'));

const PARIS_CHUNKS = [
  '127455963d034fd7.json.gz',
  '1a54a15923f4b01d.json.gz',
  '41eb039a8191f797.json.gz',
  '7653a3ccf1b4627b.json.gz',
  '7b9a6d3903984040.json.gz',
  '84a4d4333462ddd9.json.gz',
  'c3e87a0c59bc34ac.json.gz',
  'eccec42dfbdd2515.json.gz',
];

/**
 * Loads and deduplicates cached Paris Overpass OSM elements from cache/overpass_v2/.
 * @returns {Array<object>} Merged array of OSM node, way, and relation elements.
 */
export function loadCachedParisOsmElements() {
  const seen = new Set();
  const merged = [];
  for (const fname of PARIS_CHUNKS) {
    const fpath = path.join(ROOT, 'cache/overpass_v2', fname);
    if (!fs.existsSync(fpath)) continue;
    const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(fpath)).toString('utf8'));
    for (const el of (raw.elements || [])) {
      if (!el || !el.type || el.id === undefined) continue;
      const key = `${el.type}_${el.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(el);
    }
  }
  if (merged.length === 0) {
    throw new Error('No cached Paris Overpass chunks found in cache/overpass_v2/');
  }
  return merged;
}

/**
 * Exports the 2-tile Paris MSLA seam calibration coupon and writes its assembly manifest.
 * @returns {Promise<void>}
 */
async function main() {
  const osmElements = loadCachedParisOsmElements();
  const outDir = path.join(ROOT, 'exports/paris_seam_coupon_80x50_1x2');
  const res = await handleExportMap3DStl({
    osmElements,
    lat: 48.8619,
    lon: 2.2995,
    spanMeters: 500,
    rotationDeg: 65,
    targetWidthCm: 8.0,
    targetHeightCm: 5.0,
    tileCols: 1,
    tileRows: 2,
    solidBaseNoTunnels: true,
    baseHeightMm: 4.0,
    waterCutout: true,
    kerfMm: 0.0,
    bedSafeMarginMm: 4.0,
    zScale: 1.05,
    terrainScale: 1.0,
    showFrame: false,
    title: 'PARIS_COUPON',
    filePrefix: 'Map3D_PARIS_COUPON',
    outputDir: outDir,
    offlineOnly: true,
  }, { silent: false });
  process.stdout.write(JSON.stringify(res, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    process.stderr.write(`[coupon:error] ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}
