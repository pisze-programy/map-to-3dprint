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
const manifoldCore = require(path.join(ROOT, 'src/geometry/manifold_core.js'));
const seamCutter = require(path.join(ROOT, 'src/mesh/tile_seam_cutter.js'));
const stlWriter = require(path.join(ROOT, 'src/export/stl_writer.js'));
const { handleExportMap3DStl } = await import(path.join(ROOT, 'tools/mcp_map3d_inspector.mjs'));
const { loadCachedParisOsmElements } = await import(path.join(ROOT, 'calibration/generate_seam_coupon_stl.mjs'));

const TOP10_A4_CITY_DIRS = [
  'amsterdam_canals_a4_120x170_1x3',
  'chicago_loop_a4_120x170_1x3',
  'dubai_downtown_a4_120x170_1x3',
  'hong_kong_central_a4_120x170_1x3',
  'london_tower_bridge_a4_120x170_1x3',
  'paris_true_scale_a4_120x170_1x3',
  'san_francisco_bay_a4_120x170_1x3',
  'sydney_harbour_a4_120x170_1x3',
  'venice_grand_canal_a4_120x170_1x3',
  'warsaw_city_center_a4_120x170_1x3',
];

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

function runBlenderManifestCheck(manifestPath) {
  return spawnSync('python3', [
    '-c',
    'import sys; from studio_blender.stl_loader import verify_manifest_for_render; verify_manifest_for_render(sys.argv[1], allow_draft=False)',
    manifestPath,
  ], { cwd: ROOT, encoding: 'utf8' });
}

function runMcpStudioToolCall(toolName, args) {
  const initReq = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' },
  });
  const callReq = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  });
  const proc = spawnSync('python3', [path.join(ROOT, 'studio_blender/mcp_server.py')], {
    cwd: ROOT,
    input: `${initReq}\n${callReq}\n`,
    encoding: 'utf8',
  });
  const lines = String(proc.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  const callResp = lines.map(l => JSON.parse(l)).find(m => m.id === 2);
  return { status: proc.status, stderr: proc.stderr, response: callResp };
}

function cloneManifestWithMutation(srcManifestPath, outDir, mutatorFn) {
  fs.mkdirSync(outDir, { recursive: true });
  const srcDir = path.dirname(srcManifestPath);
  const m = JSON.parse(fs.readFileSync(srcManifestPath, 'utf8'));
  for (const t of (m.tiles || [])) {
    if (t.file && fs.existsSync(path.join(srcDir, t.file))) {
      fs.copyFileSync(path.join(srcDir, t.file), path.join(outDir, t.file));
    }
  }
  const repFile = (m.validation && m.validation.report_file) || 'validation_report.json';
  if (fs.existsSync(path.join(srcDir, repFile))) {
    fs.copyFileSync(path.join(srcDir, repFile), path.join(outDir, repFile));
  }
  mutatorFn(m, outDir);
  const outManifestPath = path.join(outDir, 'assembly_manifest.json');
  fs.writeFileSync(outManifestPath, JSON.stringify(m, null, 2));
  return outManifestPath;
}

function buildSyntheticSliverAndChamferManifest(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const mf = manifoldCore.getManifoldLib();
  const tileAManifold = seamCutter.buildChamferedTileClipBox(mf, -20, 0, -20, 20, 0, 4, 1.0, 0.25, 0.50);
  const baseB = manifoldCore.boxManifoldFromBounds(mf, 0, 20, -20, 20, 0, 4);
  const sliverB = manifoldCore.boxManifoldFromBounds(mf, 0, 0.25, -5, 5, 3.8, 8.0);
  const tileBManifold = baseB.add(sliverB);
  manifoldCore.safeDeleteManifold(baseB);
  manifoldCore.safeDeleteManifold(sliverB);

  const trisA = manifoldCore.extractDePinchedStlTriangles(mf, tileAManifold, 0, 1.0, {});
  const trisB = manifoldCore.extractDePinchedStlTriangles(mf, tileBManifold, 1, 1.0, {});
  const volA = tileAManifold.volume();
  const volB = tileBManifold.volume();
  manifoldCore.safeDeleteManifold(tileAManifold);
  manifoldCore.safeDeleteManifold(tileBManifold);

  const bytesA = stlWriter.buildSTLBytesFromTriangles(trisA, 20, 20, 1.0, 20, 40, {}, false, 0);
  const bytesB = stlWriter.buildSTLBytesFromTriangles(trisB, 0, 20, 1.0, 20, 40, {}, false, 0);
  const pathA = path.join(outDir, 'tile_a.stl');
  const pathB = path.join(outDir, 'tile_b.stl');
  fs.writeFileSync(pathA, bytesA);
  fs.writeFileSync(pathB, bytesB);

  const mPath = path.join(outDir, 'assembly_manifest.json');
  fs.writeFileSync(mPath, JSON.stringify({
    schema_version: 1,
    sku_id: 'custom_grid',
    format_id: 'custom_grid',
    city_slug: 'synthetic_sliver_test',
    source_params: {
      title: 'SYNTH_SLIVER',
      window_mm: [40.0, 40.0],
      grid: [2, 1],
      inter_frame_gap_mm: 0.0,
      water_cutout: false,
      solid_base_no_tunnels: true,
      base_height_mm: 4.0,
      bed_safe_margin_mm: 4.0,
      dfm06_chamfer_inset_mm: 0.25,
      underside_relief_enabled: true,
    },
    master_volume_mm3: Number((volA + volB).toFixed(4)),
    nudged_seams: [],
    frames: [{ frame_id: 'F1', frame_col: 0, frame_row: 0, window_mm: [40.0, 40.0], nominal_origin_mm: [-20.0, -20.0] }],
    tiles: [
      {
        tile_idx: 0, tile_id: 'R1C1', frame_id: 'F1', row: 0, north_row: 1, col: 0,
        file: 'tile_a.stl', skipped_empty_water: false, sha256: sha256FileHex(pathA), stl_rotation_deg: 0,
        nominal_rect_mm: { x_min: -20.0, x_max: 0.0, y_min: -20.0, y_max: 20.0 },
        neighbors: { north: null, south: null, west: null, east: 'R1C2' },
        allow_landmasses: [],
      },
      {
        tile_idx: 1, tile_id: 'R1C2', frame_id: 'F1', row: 0, north_row: 1, col: 1,
        file: 'tile_b.stl', skipped_empty_water: false, sha256: sha256FileHex(pathB), stl_rotation_deg: 0,
        nominal_rect_mm: { x_min: 0.0, x_max: 20.0, y_min: -20.0, y_max: 20.0 },
        neighbors: { north: null, south: null, west: 'R1C1', east: null },
        allow_landmasses: [],
      },
    ],
  }, null, 2));
  return mPath;
}

console.log('=== HEADLESS SUITE: Seam Continuity, Multi-Format & Uncheatable Assembly Validator ===');

// 1. Canonical Format Catalog Sync & Safe Bed Checks
console.log('[1/7] Canonical Format Catalog & Mono 4 Safe Bed Integrity');
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
console.log('[2/7] Negative Control: Git 9845292 Broken Paris 1x3 STLs Must FAIL VAL-09 & Block Render');
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
  console.log('[3/7] Synthetic Adversarial Seams Across 1x3, Landscape 3x1 (rot90), Square 2x2, Triptych & Quartet');
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
  console.log('[4/7] Real Cached Paris OSM Scene (single_a4_1x3)');
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
  const parisManifestPath = path.join(parisDir, 'assembly_manifest.json');
  const pVal = runValidateAssembly(parisManifestPath);
  assert.equal(pVal.status, 0, `Paris 1x3 validate_assembly failed: ${JSON.stringify(pVal.report?.failures)}`);
  console.log(
    `  PASS: Real cached Paris 1x3 PASS (${pVal.report.summary.seam_pairs_checked} seams, ` +
    `vol_diff=${pVal.report.summary.volume_diff_pct}%)`
  );

  // 5. Negative Bypass Tests (Validator + Blender/MCP Gate)
  console.log('[5/7] Negative Bypass Tests (Forged Manifests, 0.06mm Gap, Empty Neighbors, DFM-01/06, Raw STL & MCP)');
  const overlapManifestPath = cloneManifestWithMutation(parisManifestPath, path.join(tmpBase, 'neg_overlap'), (m) => {
    m.tiles[0].nominal_rect_mm.y_max += 1.0;
  });
  const ovVal = runValidateAssembly(overlapManifestPath);
  assert.notEqual(ovVal.status, 0, 'Overlapping nominal_rect_mm must fail VAL-10');
  assert.ok(ovVal.report && ovVal.report.failures.some(msg => msg.includes('VAL-10')), 'Expected VAL-10 failure on overlap');

  const emptyNbPath = cloneManifestWithMutation(parisManifestPath, path.join(tmpBase, 'neg_empty_nb'), (m) => {
    for (const t of m.tiles) t.neighbors = {};
  });
  const emptyNbVal = runValidateAssembly(emptyNbPath);
  assert.notEqual(emptyNbVal.status, 0, 'Empty neighbors on multi-tile assembly must FAIL');
  assert.ok(emptyNbVal.report && emptyNbVal.report.failures.some(msg => msg.includes('VAL-09')), 'Expected VAL-09 failure on empty neighbors');

  const gap006Path = cloneManifestWithMutation(parisManifestPath, path.join(tmpBase, 'neg_gap006'), (m) => {
    m.tiles[0].nominal_rect_mm.y_max -= 0.06;
  });
  const gap006Val = runValidateAssembly(gap006Path);
  assert.notEqual(gap006Val.status, 0, '0.06 mm flush-mating seam gap must FAIL VAL-09');
  assert.ok(gap006Val.report && gap006Val.report.failures.some(msg => msg.includes('VAL-09')), 'Expected VAL-09 failure on 0.06 mm gap');

  const unequalSplitPath = cloneManifestWithMutation(parisManifestPath, path.join(tmpBase, 'neg_unequal'), (m) => {
    m.tiles[0].nominal_rect_mm.y_max += 2.0;
    m.tiles[1].nominal_rect_mm.y_min += 2.0;
    m.nudged_seams = [];
  });
  const unequalVal = runValidateAssembly(unequalSplitPath);
  assert.notEqual(unequalVal.status, 0, 'Undeclared unequal split must FAIL VAL-10');
  assert.ok(unequalVal.report && unequalVal.report.failures.some(msg => msg.includes('VAL-10')), 'Expected VAL-10 failure on undeclared unequal split');

  const badNudgePath = cloneManifestWithMutation(parisManifestPath, path.join(tmpBase, 'neg_bad_nudge'), (m) => {
    m.tiles[0].nominal_rect_mm.y_max += 6.0;
    m.tiles[1].nominal_rect_mm.y_min += 6.0;
    m.nudged_seams = [{ axis: 'y', index: 0, delta_mm: 6.0 }];
  });
  const badNudgeVal = runValidateAssembly(badNudgePath);
  assert.notEqual(badNudgeVal.status, 0, 'Out-of-bounds |delta_mm| > 5.0 nudge must FAIL VAL-10');
  assert.ok(badNudgeVal.report && badNudgeVal.report.failures.some(msg => msg.includes('VAL-10')), 'Expected VAL-10 failure on out-of-bounds nudge');

  const interFrameNudgePath = cloneManifestWithMutation(parisManifestPath, path.join(tmpBase, 'neg_interframe_nudge'), (m) => {
    m.frames = [
      { frame_id: 'F_R3C1', frame_col: 0, frame_row: 0, window_mm: [120, 56.6667], nominal_origin_mm: [-60, -85] },
      { frame_id: 'F_R2C1', frame_col: 0, frame_row: 1, window_mm: [120, 56.6667], nominal_origin_mm: [-60, -28.3333] },
      { frame_id: 'F_R1C1', frame_col: 0, frame_row: 2, window_mm: [120, 56.6667], nominal_origin_mm: [-60, 28.3333] },
    ];
    m.tiles[0].frame_id = 'F_R3C1';
    m.tiles[1].frame_id = 'F_R2C1';
    m.tiles[2].frame_id = 'F_R1C1';
    m.nudged_seams = [{ axis: 'y', index: 0, delta_mm: 2.0 }];
  });
  const interFrameNudgeVal = runValidateAssembly(interFrameNudgePath);
  assert.notEqual(interFrameNudgeVal.status, 0, 'Inter-frame nudged_seams must FAIL VAL-10');
  assert.ok(interFrameNudgeVal.report && interFrameNudgeVal.report.failures.some(msg => msg.includes('VAL-10')), 'Expected VAL-10 failure on inter-frame nudge');

  const tamperVal13Path = cloneManifestWithMutation(parisManifestPath, path.join(tmpBase, 'neg_tamper_val13'), (m) => {
    m.source_params.underside_relief_enabled = false;
    m.source_params.dfm06_chamfer_inset_mm = 0.0;
  });
  const tamperVal13 = runValidateAssembly(tamperVal13Path);
  assert.notEqual(tamperVal13.status, 0, 'VAL-13 manifest tampering must FAIL');
  assert.ok(tamperVal13.report && tamperVal13.report.failures.some(msg => msg.includes('VAL-13')), 'Expected VAL-13 failure on manifest tampering');

  const synthSliverManifest = buildSyntheticSliverAndChamferManifest(path.join(tmpBase, 'neg_sliver_chamfer'));
  const synthSliverVal = runValidateAssembly(synthSliverManifest);
  assert.notEqual(synthSliverVal.status, 0, 'Synthetic <0.40 mm seam sliver and asymmetric Z=0.15 chamfer must FAIL');
  assert.ok(synthSliverVal.report && synthSliverVal.report.failures.some(msg => msg.includes('DFM-01')), 'Expected DFM-01 failure on synthetic sliver');
  assert.ok(synthSliverVal.report && synthSliverVal.report.failures.some(msg => msg.includes('DFM-06')), 'Expected DFM-06 failure on asymmetric chamfer');

  // Forged Blender manifests: empty report_sha256, and matching report_sha256 pointing to FAIL report
  const forgedEmptyShaPath = cloneManifestWithMutation(parisManifestPath, path.join(tmpBase, 'neg_forged_empty_sha'), (m) => {
    m.validation = {
      status: 'PASS',
      verdict: 'PASS',
      validated_at: new Date().toISOString(),
      validator: 'forged',
      report_file: 'validation_report.json',
      report_sha256: '',
    };
  });
  assert.notEqual(runBlenderManifestCheck(forgedEmptyShaPath).status, 0, 'Forged manifest with empty report_sha256 must FAIL Blender check');

  const forgedFailReportPath = cloneManifestWithMutation(parisManifestPath, path.join(tmpBase, 'neg_forged_fail_rep'), (m, dir) => {
    const repPath = path.join(dir, 'validation_report.json');
    const repObj = JSON.parse(fs.readFileSync(repPath, 'utf8'));
    repObj.verdict = 'FAIL';
    repObj.failures = ['VAL-09: Forged report failure'];
    fs.writeFileSync(repPath, JSON.stringify(repObj, null, 2));
    m.validation = {
      status: 'PASS',
      verdict: 'PASS',
      validated_at: new Date().toISOString(),
      validator: 'forged',
      report_file: 'validation_report.json',
      report_sha256: sha256FileHex(repPath),
    };
  });
  assert.notEqual(runBlenderManifestCheck(forgedFailReportPath).status, 0, 'Forged manifest pointing to FAIL validation_report.json must FAIL Blender check');

  // Raw --stl render_studio.py without --draft-unvalidated must FAIL
  const firstParisStl = path.join(parisDir, JSON.parse(fs.readFileSync(parisManifestPath, 'utf8')).tiles[0].file);
  const rawStlCli = spawnSync('python3', [
    path.join(ROOT, 'studio_blender/render_studio.py'),
    '--stl', firstParisStl,
    '--env', '11_packshot_white',
    '--out', path.join(tmpBase, 'blocked_raw_stl'),
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(rawStlCli.status, 0, 'render_studio.py --stl without --draft-unvalidated must FAIL');

  // studio_blender/mcp_server.py without valid manifest must return isError=true
  for (const toolName of ['render_city_stills', 'render_flow_keyframes', 'render_commercial_video']) {
    const mcpRawRes = runMcpStudioToolCall(toolName, {
      stl_paths: [firstParisStl],
      out_dir: path.join(tmpBase, `blocked_mcp_${toolName}`),
    });
    assert.equal(mcpRawRes.status, 0, `mcp_server.py process exited cleanly for ${toolName}`);
    assert.ok(mcpRawRes.response && mcpRawRes.response.result && mcpRawRes.response.result.isError === true,
      `mcp_server.py ${toolName} without manifest or draft_unvalidated must return isError=true`);
  }
  const mcpForgedRes = runMcpStudioToolCall('render_city_stills', {
    manifest_path: forgedFailReportPath,
    out_dir: path.join(tmpBase, 'blocked_mcp_forged'),
  });
  assert.ok(mcpForgedRes.response && mcpForgedRes.response.result && mcpForgedRes.response.result.isError === true,
    'mcp_server.py with forged FAIL manifest must return isError=true');

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
  console.log('  PASS: All 11 validator, Blender CLI, and MCP bypass negative controls rejected cleanly');

  // 6. Paris Edge-Case Regressions (HEAD Bug #1 & HEAD Bug #2)
  console.log('[6/7] Paris Edge-Case Regressions (48.8623,2.2993 rot 65 VAL-01 degen=0; 48.8606,2.2962 rot 65 VAL-09 <= 0.15 mm2)');
  const bug1Dir = path.join(tmpBase, 'reg_bug1_degen');
  await handleExportMap3DStl({
    osmElements: parisOsm,
    lat: 48.8623,
    lon: 2.2993,
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
    title: 'PARIS_BUG1_REG',
    filePrefix: 'PARIS_BUG1_REG',
    outputDir: bug1Dir,
    offlineOnly: true,
  }, { silent: true });
  const bug1Val = runValidateAssembly(path.join(bug1Dir, 'assembly_manifest.json'));
  assert.equal(bug1Val.status, 0, `Paris Bug #1 (48.8623, 2.2993, rot 65) failed: ${JSON.stringify(bug1Val.report?.failures)}`);
  for (const [tid, trep] of Object.entries(bug1Val.report.tiles)) {
    assert.equal(trep.topo.degen, 0, `Paris Bug #1 tile ${tid} must have degen=0, got ${trep.topo.degen}`);
  }

  const bug2Dir = path.join(tmpBase, 'reg_bug2_nudged_seam');
  await handleExportMap3DStl({
    osmElements: parisOsm,
    lat: 48.8606,
    lon: 2.2962,
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
    title: 'PARIS_BUG2_REG',
    filePrefix: 'PARIS_BUG2_REG',
    outputDir: bug2Dir,
    offlineOnly: true,
  }, { silent: true });
  const bug2Val = runValidateAssembly(path.join(bug2Dir, 'assembly_manifest.json'));
  assert.equal(bug2Val.status, 0, `Paris Bug #2 (48.8606, 2.2962, rot 65) failed: ${JSON.stringify(bug2Val.report?.failures)}`);
  for (const seam of bug2Val.report.seams) {
    assert.ok(seam.passed && seam.true_diff_mm2 <= 0.15, `Paris Bug #2 seam ${seam.pair.join('<->')} failed: ${JSON.stringify(seam)}`);
  }
  console.log('  PASS: Both Paris edge-case regressions (degen=0 and nudged-seam diff<=0.15 mm2) verified PASS');

  // 7. Live 10-City Repo Audit Gate
  console.log('[7/7] Live 10-City Repo Gate (exports/*_a4_120x170_1x3/ Manifest + Report + SHA-256 + PASS)');
  for (const cityDirName of TOP10_A4_CITY_DIRS) {
    const cityDir = path.join(ROOT, 'exports', cityDirName);
    const mPath = path.join(cityDir, 'assembly_manifest.json');
    const rPath = path.join(cityDir, 'validation_report.json');
    assert.ok(fs.existsSync(mPath), `Missing assembly_manifest.json in ${cityDirName}`);
    assert.ok(fs.existsSync(rPath), `Missing validation_report.json in ${cityDirName}`);

    const manifest = JSON.parse(fs.readFileSync(mPath, 'utf8'));
    const report = JSON.parse(fs.readFileSync(rPath, 'utf8'));
    assert.ok(manifest.validation && manifest.validation.verdict === 'PASS', `${cityDirName} manifest.validation.verdict must be PASS`);
    assert.ok(manifest.validation.report_sha256 && manifest.validation.report_sha256 === sha256FileHex(rPath),
      `${cityDirName} manifest.validation.report_sha256 must match validation_report.json`);
    assert.equal(report.verdict, 'PASS', `${cityDirName} validation_report.json verdict must be PASS`);
    assert.equal(report.summary.blocking_failures, 0, `${cityDirName} must have 0 blocking failures`);
    assert.ok(report.summary.seam_pairs_checked >= 2, `${cityDirName} must check >= 2 seams`);
    for (const seam of (report.seams || [])) {
      assert.equal(seam.passed, true, `${cityDirName} seam ${seam.pair.join('<->')} must PASS`);
      assert.ok(seam.diff_png && fs.existsSync(path.join(cityDir, seam.diff_png)),
        `${cityDirName} missing seam diff PNG ${seam.diff_png}`);
    }
    const activeTiles = (manifest.tiles || []).filter(t => !t.skipped_empty_water);
    assert.equal(activeTiles.length, 3, `${cityDirName} must have 3 active A4 1x3 tiles`);
    for (const tile of activeTiles) {
      const stlPath = path.join(cityDir, tile.file);
      assert.ok(fs.existsSync(stlPath), `${cityDirName} missing STL ${tile.file}`);
      assert.equal(sha256FileHex(stlPath), tile.sha256, `${cityDirName} STL sha256 mismatch for ${tile.file}`);
    }
  }
  console.log(`  PASS: All ${TOP10_A4_CITY_DIRS.length}/10 committed A4 1x3 city assemblies verified PASS with matching SHA-256 digests`);
} finally {
  fs.rmSync(tmpBase, { recursive: true, force: true });
}

console.log('ALL SEAM & MULTI-FORMAT TESTS PASSED.');
