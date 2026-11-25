#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname || process.cwd(), '..');

const catalogMod = require(path.join(ROOT, 'src/geometry/format_catalog.js'));
const uiConfig = require(path.join(ROOT, 'src/ui/ui_config.js'));
const { handleExportMap3DStl } = await import(path.join(ROOT, 'tools/mcp_map3d_inspector.mjs'));
const { loadCachedParisOsmElements } = await import(path.join(ROOT, 'calibration/generate_seam_coupon_stl.mjs'));

function sha256FileHex(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function makeRectRing(cx, cy, hx, hy) {
  return [[cx - hx, cy - hy], [cx + hx, cy - hy], [cx + hx, cy + hy], [cx - hx, cy + hy]];
}

function runValidateAssembly(manifestPath) {
  const proc = spawnSync('python3', [path.join(ROOT, 'calibration/validate_assembly.py'), manifestPath, '--quiet'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const repPath = path.join(path.dirname(manifestPath), 'validation_report.json');
  const report = fs.existsSync(repPath) ? JSON.parse(fs.readFileSync(repPath, 'utf8')) : null;
  return { status: proc.status, stdout: proc.stdout, stderr: proc.stderr, report };
}

console.log('=== HEADLESS SUITE: Seam Continuity, Multi-Format & Uncheatable Assembly Validator ===');

// 1. Canonical Format Catalog Sync & Safe Bed Checks
console.log('[1/4] Canonical Format Catalog & Mono 4 Safe Bed Integrity');
const diskCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/format_catalog.json'), 'utf8'));
assert.deepEqual(catalogMod.EMBEDDED_FORMAT_CATALOG, diskCatalog, 'EMBEDDED_FORMAT_CATALOG must match config/format_catalog.json');
for (const staleId of ['mono4_150x168_2x2', 'mono4_150_1x2', 'mono4_296_2x4']) {
  assert.equal(Object.prototype.hasOwnProperty.call(uiConfig.PRINT_PROFILES, staleId), false, `Removed unsafe preset ${staleId} must not exist`);
}
for (const fmtId of [
  'single_a4_1x3', 'single_a4_landscape_3x1', 'triptych_a4_3x1',
  'quartet_a4_2x2', 'square_150_2x2', 'square_240_2x4', 'flagship_50x70_3x9', 'custom_grid',
]) {
  const f = diskCatalog.formats[fmtId];
  assert.ok(f, `Missing format ${fmtId}`);
  assert.equal(f.inter_frame_gap_mm, 0.0, `${fmtId} default inter_frame_gap_mm must be 0.0`);
  if (!f.is_custom) {
    const tw = f.window_mm[0] / f.tile_cols;
    const th = f.window_mm[1] / f.tile_rows;
    const fits = (tw <= 145.45 && th <= 79.05) || (th <= 145.45 && tw <= 79.05);
    assert.ok(fits, `${fmtId} tile ${tw.toFixed(2)}x${th.toFixed(2)} must fit 145.45x79.05 mm`);
  }
}
const qLayout = catalogMod.computeFormatFrameAndTileLayout({ formatId: 'quartet_a4_2x2' });
assert.equal(qLayout.frames.length, 4, 'quartet_a4_2x2 must have 4 Heavy A4 frames');
assert.equal(qLayout.tileMetaById.length, 12, 'quartet_a4_2x2 must have 12 strips');
console.log('  PASS: 8 catalog formats, quartet 4x(1x3)=12 strips, and stale preset removal verified');

// 2. Negative-Control Test on Broken Git 9845292 Paris STLs
console.log('[2/4] Negative Control: Git 9845292 Broken Paris 1x3 STLs Must FAIL VAL-09 & Block Render');
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'map3d_seam_test_'));
try {
  const negDir = path.join(tmpBase, 'neg_9845292');
  fs.mkdirSync(negDir, { recursive: true });
  const tileDefs = [
    { file: 'Map3D_PARIS_A4_Top_120x57mm.stl', tile_id: 'R1C1', row: 2, north_row: 1, y0: 28.333333, y1: 85.0, n: null, s: 'R2C1' },
    { file: 'Map3D_PARIS_A4_Middle_120x57mm.stl', tile_id: 'R2C1', row: 1, north_row: 2, y0: -28.333333, y1: 28.333333, n: 'R1C1', s: 'R3C1' },
    { file: 'Map3D_PARIS_A4_Bottom_120x57mm.stl', tile_id: 'R3C1', row: 0, north_row: 3, y0: -85.0, y1: -28.333333, n: 'R2C1', s: null },
  ];
  const manifestTiles = [];
  for (let i = 0; i < tileDefs.length; i++) {
    const td = tileDefs[i];
    const gitObj = `9845292:exports/paris_true_scale_a4_120x170_1x3/${td.file}`;
    const bytes = execFileSync('git', ['show', gitObj], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    const outF = path.join(negDir, td.file);
    fs.writeFileSync(outF, bytes);
    manifestTiles.push({
      tile_idx: td.row,
      tile_id: td.tile_id,
      frame_id: 'F1',
      row: td.row,
      north_row: td.north_row,
      col: 0,
      file: td.file,
      sha256: sha256FileHex(outF),
      stl_rotation_deg: 0,
      nominal_rect_mm: { x_min: -60.0, x_max: 60.0, y_min: td.y0, y_max: td.y1 },
      neighbors: { north: td.n, south: td.s, west: null, east: null },
      allow_landmasses: [],
    });
  }
  const negManifestPath = path.join(negDir, 'assembly_manifest.json');
  fs.writeFileSync(negManifestPath, JSON.stringify({
    schema_version: 1,
    sku_id: 'single_a4_1x3',
    format_id: 'single_a4_1x3',
    city_slug: 'paris_9845292_broken',
    source_params: {
      title: 'PARIS_BROKEN',
      window_mm: [120.0, 170.0],
      grid: [1, 3],
      inter_frame_gap_mm: 0.0,
      water_cutout: true,
      solid_base_no_tunnels: true,
      base_height_mm: 4.0,
      bed_safe_margin_mm: 4.0,
      dfm06_chamfer_inset_mm: 0.25,
      underside_relief_enabled: true,
    },
    master_volume_mm3: 70000.0,
    frames: [{ frame_id: 'F1', window_mm: [120.0, 170.0] }],
    tiles: manifestTiles,
    validation: { status: 'PENDING', verdict: null },
  }, null, 2));

  const negVal = runValidateAssembly(negManifestPath);
  assert.notEqual(negVal.status, 0, 'Negative control 9845292 must exit non-zero');
  assert.ok(negVal.report && negVal.report.verdict === 'FAIL', 'Negative control verdict must be FAIL');
  assert.ok(
    negVal.report.failures.some(msg => msg.includes('VAL-09')),
    `Expected VAL-09 failure on broken 9845292 Paris STLs, got: ${JSON.stringify(negVal.report.failures.slice(0, 5))}`
  );
  // Confirm studio_blender hard-blocks rendering failed assembly without --draft-unvalidated
  const blockRender = spawnSync('python3', [
    path.join(ROOT, 'studio_blender/render_studio.py'),
    '--manifest', negManifestPath,
    '--env', '11_packshot_white',
    '--out', path.join(negDir, 'blocked_render'),
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(blockRender.status, 0, 'render_studio.py must refuse unvalidated/FAIL manifest without --draft-unvalidated');
  console.log(`  PASS: Negative control 9845292 caught ${negVal.report.failures.length} defects including VAL-09, and blocked render_studio.py`);

  // 3. Synthetic Adversarial Multi-Format Seam Suite
  console.log('[3/4] Synthetic Adversarial Seams Across 1x3, Landscape 3x1 (rot90), Square 2x2, Triptych & Quartet');
  const advScene = {
    spanMeters: 800,
    dem: {
      grid: [[0.2, 0.2, 0.2, 0.2], [0.2, 0.2, 0.2, 0.2], [0.2, 0.2, 0.2, 0.2], [0.2, 0.2, 0.2, 0.2]],
      minElev: 0.2,
      maxElev: 0.2,
    },
    waterPolys: [
      // Diagonal canal across all tile boundaries
      { outer: [[-45, -18], [45, 8], [45, 16], [-45, -10]], holes: [], waterTag: 'canal' },
      // Enclosed inland lake on land
      { outer: makeRectRing(20, -24, 3.0, 3.0), holes: [], waterTag: 'lake' },
    ],
    waterLines: [],
    greenPolys: [],
    trees: [
      { lat: 0, lon: 0, pt: [0.0, 0.0], h: 8 },
      { lat: 0, lon: 0, pt: [-12.0, 14.0], h: 9 },
      { lat: 0, lon: 0, pt: [15.0, -14.0], h: 7 },
    ],
    roads: [
      // Sloped bridge crossing canal & tile seams
      { pts: [[-10, -24], [10, 24]], width: 4.0, isBridge: true, isPath: true, layer: 2, bridgeStructure: 'beam', clearanceM: 7.5 },
    ],
    bridgePolys: [],
    buildings: [
      // Grounded L-tower straddling X=0 and Y=0 (tests 4-way '+' corners and R/C seams)
      { id: 9001, outer: makeRectRing(0, 0, 7.0, 7.0), holes: [], h: 42, roof: 'flat', roofH: 0 },
      // Grounded podium + cantilevered min_height wing extending across the +28.33 mm Y seam
      { id: 90020, outer: makeRectRing(0, 11, 5.0, 3.5), holes: [], h: 28, roof: 'flat', roofH: 0 },
      { id: 9002, outer: makeRectRing(0, 15.5, 4.5, 4.0), holes: [], h: 28, minH: 9.0, roof: 'flat', roofH: 0 },
      // Enclosed courtyard spanning seam
      { id: 9003, outer: makeRectRing(-20, 20, 8.0, 8.0), holes: [makeRectRing(-20, 20, 5.2, 5.2)], h: 35, roof: 'flat', roofH: 0 },
    ],
  };

  for (const fmtId of ['single_a4_1x3', 'single_a4_landscape_3x1', 'square_150_2x2', 'triptych_a4_3x1', 'quartet_a4_2x2']) {
    const outFmtDir = path.join(tmpBase, `adv_${fmtId}`);
    await handleExportMap3DStl({
      scene: advScene,
      formatId: fmtId,
      waterCutout: true,
      title: `ADV_${fmtId}`,
      filePrefix: `ADV_${fmtId}`,
      outputDir: outFmtDir,
    }, { silent: true });
    const manifestPath = path.join(outFmtDir, 'assembly_manifest.json');
    const val = runValidateAssembly(manifestPath);
    assert.equal(
      val.status, 0,
      `Adversarial ${fmtId} validate_assembly failed: ${JSON.stringify(val.report?.failures)}`
    );
    const maxDiff = Math.max(0, ...val.report.seams.map(s => s.true_diff_mm2));
    const maxStep = Math.max(0, ...val.report.seams.map(s => s.max_step_mm));
    console.log(
      `  PASS: ${fmtId} (${val.report.summary.tiles_checked} tiles, ${val.report.summary.seam_pairs_checked} seams, ` +
      `${val.report.summary.corners_4way_checked} 4-way corners): max_diff=${maxDiff.toFixed(4)}mm2, max_step=${maxStep.toFixed(4)}mm`
    );
  }

  // 4. Real Cached Paris OSM Scene (single_a4_1x3)
  console.log('[4/4] Real Cached Paris OSM Scene (single_a4_1x3)');
  const parisDir = path.join(tmpBase, 'paris_a4_test');
  const parisOsm = loadCachedParisOsmElements();
  await handleExportMap3DStl({
    osmElements: parisOsm,
    lat: 48.8586,
    lon: 2.2942,
    spanMeters: 780,
    rotationDeg: -46,
    zScale: 1.05,
    terrainScale: 1.0,
    waterCutout: true,
    formatId: 'single_a4_1x3',
    title: 'PARIS_TEST',
    filePrefix: 'PARIS_TEST',
    outputDir: parisDir,
    offlineOnly: true,
  }, { silent: true });
  const pVal = runValidateAssembly(path.join(parisDir, 'assembly_manifest.json'));
  assert.equal(pVal.status, 0, `Paris 1x3 validate_assembly failed: ${JSON.stringify(pVal.report?.failures)}`);
  console.log(
    `  PASS: Real cached Paris 1x3 PASS (${pVal.report.summary.seam_pairs_checked} seams, ` +
    `vol_diff=${pVal.report.summary.volume_diff_pct}%)`
  );

  // 5. VAL-10 negative control (overlapping nominal_rect_mm) + buildUnifiedTileTrianglesForStlCSG wiring check
  const overlapManifest = JSON.parse(fs.readFileSync(path.join(parisDir, 'assembly_manifest.json'), 'utf8'));
  overlapManifest.tiles[0].nominal_rect_mm.y_max += 1.0;
  const overlapManifestPath = path.join(parisDir, 'overlap_manifest.json');
  fs.writeFileSync(overlapManifestPath, JSON.stringify(overlapManifest, null, 2));
  const ovVal = runValidateAssembly(overlapManifestPath);
  assert.notEqual(ovVal.status, 0, 'Overlapping nominal_rect_mm must fail VAL-10');
  assert.ok(ovVal.report && ovVal.report.failures.some(m => m.includes('VAL-10')), 'Expected VAL-10 failure on overlap');

  const vaultMod = require(path.join(ROOT, 'src/mesh/tile_sla_vault_solver.js'));
  const { buildComplete3DModel } = require(path.join(ROOT, 'src/mesh/mesh_builder.js'));
  const builtAdv = buildComplete3DModel(advScene, {
    plaqueText: 'WIRE_CHECK',
    bedSizeMm: 120,
    totalHeightMm: 170,
    tileCols: 1,
    tileRows: 3,
    solidBaseNoTunnels: true,
    baseHeightMm: 4.0,
    waterCutout: true,
    kerfMm: 0.0,
  });
  const wiredTris0 = vaultMod.buildUnifiedTileTrianglesForStlCSG({
    layerMeshes: builtAdv.meshes,
    bedSizeMm: 120,
    totalHeightMm: 170,
    tileCols: 1,
    tileRows: 3,
    solidBaseNoTunnels: true,
    baseHeightMm: 4.0,
    waterCutout: true,
    kerfMm: 0.0,
  }, 'all', 0);
  assert.ok(Array.isArray(wiredTris0) && wiredTris0.length > 0, 'buildUnifiedTileTrianglesForStlCSG must delegate to master cutter');
  console.log('  PASS: VAL-10 overlap negative control & buildUnifiedTileTrianglesForStlCSG wiring verified');
} finally {
  fs.rmSync(tmpBase, { recursive: true, force: true });
}

console.log('ALL SEAM & MULTI-FORMAT TESTS PASSED.');
