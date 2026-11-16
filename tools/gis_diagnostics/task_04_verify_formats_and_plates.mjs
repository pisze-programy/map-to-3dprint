#!/usr/bin/env node
// ============================================================================
// tools/gis_diagnostics/task_04_verify_formats_and_plates.mjs
// Task 04: Multi-Format (.STL, .3MF, .ZIP) & Multi-Plate Aspect/Cutout/Hollow Verifier
// ============================================================================

import assert from 'node:assert/strict';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function auditBinaryStlTopology(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const nTris = view.getUint32(80, true);
  assert.equal(u8.byteLength, 84 + nTris * 50, 'Binary STL byte length must equal 84 + 50 * nTris');

  const vMap = new Map();
  const edgeMap = new Map();
  let nextVid = 0;
  let degen = 0;

  const getVid = (off) => {
    const x = view.getFloat32(off, true);
    const y = view.getFloat32(off + 4, true);
    const z = view.getFloat32(off + 8, true);
    const k = `${Math.round(x * 1e4)}_${Math.round(y * 1e4)}_${Math.round(z * 1e4)}`;
    let id = vMap.get(k);
    if (id === undefined) { id = nextVid++; vMap.set(k, id); }
    return id;
  };

  let off = 84;
  for (let i = 0; i < nTris; i++, off += 50) {
    const a = getVid(off + 12), b = getVid(off + 24), c = getVid(off + 36);
    if (a === b || b === c || c === a) { degen++; continue; }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const ek = u < v ? `${u}:${v}` : `${v}:${u}`;
      let rec = edgeMap.get(ek);
      if (!rec) { rec = [0, 0]; edgeMap.set(ek, rec); }
      if (u < v) rec[0]++; else rec[1]++;
    }
  }

  let openEdges = 0, nonManifoldEdges = 0;
  for (const [f, b] of edgeMap.values()) {
    if (f === 1 && b === 1) continue;
    if (f + b === 1) openEdges++; else nonManifoldEdges++;
  }
  return { nTris, degen, openEdges, nonManifoldEdges, byteLength: u8.byteLength };
}

function audit3mfArchive(zipBytes, fflate) {
  const files = fflate.unzipSync(zipBytes);
  assert.ok(files['[Content_Types].xml'], '3MF missing [Content_Types].xml');
  assert.ok(files['_rels/.rels'], '3MF missing _rels/.rels');
  assert.ok(files['3D/3dmodel.model'], '3MF missing 3D/3dmodel.model');
  const xml = new TextDecoder().decode(files['3D/3dmodel.model']);
  const meshes = [...xml.matchAll(/<mesh>([\s\S]*?)<\/mesh>/g)].map((m) => m[1]);
  assert.ok(meshes.length >= 2, `Expected >=2 3MF mesh objects, got ${meshes.length}`);

  let openEdges = 0, nonManifoldEdges = 0, totalTris = 0;
  for (const blk of meshes) {
    const tris = [...blk.matchAll(/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g)];
    totalTris += tris.length;
    const edgeMap = new Map();
    for (const m of tris) {
      const i0 = +m[1], i1 = +m[2], i2 = +m[3];
      for (const [u, v] of [[i0, i1], [i1, i2], [i2, i0]]) {
        const k = u < v ? `${u}:${v}` : `${v}:${u}`;
        let r = edgeMap.get(k);
        if (!r) { r = [0, 0]; edgeMap.set(k, r); }
        if (u < v) r[0]++; else r[1]++;
      }
    }
    for (const [f, b] of edgeMap.values()) {
      if (f === 1 && b === 1) continue;
      if (f + b === 1) openEdges++; else nonManifoldEdges++;
    }
  }
  return { meshObjects: meshes.length, totalTris, openEdges, nonManifoldEdges, byteLength: zipBytes.byteLength };
}

export async function runFormatsAndPlatesAudit({ scenes = null, quiet = false, includeMeshes = false } = {}) {
  const log = (...args) => { if (!quiet) console.log(...args); };
  log('=== TASK 04: Multi-Format (.STL / .3MF / .ZIP) & Multi-Plate Configuration Audit ===');

  require(path.join(ROOT, 'src/vendor/vendor_bundle.js'));
  const fflate = globalThis.__FFLATE__;
  Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/print_physics_config.js')));
  Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/sla_print_laws.js')));
  Object.assign(globalThis, require(path.join(ROOT, 'src/export/export_io_utils.js')));
  const core = require(path.join(ROOT, 'src/geometry/manifold_core.js'));
  await core.ensureManifoldLibAsync();

  const { buildComplete3DModel } = require(path.join(ROOT, 'src/mesh/mesh_builder.js'));
  const stlMod = require(path.join(ROOT, 'src/export/stl_writer.js'));
  const m3fMod = require(path.join(ROOT, 'src/export/export_3mf.js'));
  const zipMod = require(path.join(ROOT, 'src/export/zip_packager.js'));
  Object.assign(globalThis, stlMod, m3fMod, zipMod);

  // Default rich synthetic multi-feature scene if no live scenes supplied
  const defaultScene = () => {
    const G = 40;
    const grid = Array.from({ length: G }, (_, r) =>
      Array.from({ length: G }, (__, c) => {
        const wx = -84.6 + (c / (G - 1)) * 169.2;
        const wy = -84.6 + (r / (G - 1)) * 169.2;
        if (Math.abs(wx) < 14) return 2.0; // river valley
        return 12.0 + Math.max(0, (Math.abs(wx) - 14) * 0.45) + Math.sin(wy * 0.08) * 4.0;
      })
    );
    return {
      title: 'MULTI_FORMAT_RIVER_CITY',
      center: [52.24, 21.02],
      spanMeters: 2200,
      metersToUnits: 169.2 / 2200,
      halfW: 84.6,
      halfH: 84.6,
      dem: { gridSize: G, minElev: 2, maxElev: 45, zoom: 14, grid },
      waterPolys: [{ outer: [[-13, -84], [13, -84], [13, 84], [-13, 84]], holes: [[[-4, -18], [4, -18], [4, 18], [-4, 18]]] }],
      waterLines: [],
      greenPolys: [{ outer: [[22, -45], [52, -45], [52, -15], [22, -15]], holes: [], type: 'park' }],
      trees: [[30, -30, 10], [38, -25, 11], [44, -35, 9.5]],
      roads: [
        { pts: [[-70, 0], [-14, 0]], width: 0.8, hwy: 'primary', bridge: false },
        { pts: [[-14, 0], [14, 0]], width: 0.9, hwy: 'primary', bridge: true, isBridge: true, layer: 1, bridgeStructure: 'arch' },
        { pts: [[14, 0], [70, 0]], width: 0.8, hwy: 'primary', bridge: false },
      ],
      roadPolys: [{ outer: [[-45, 15], [-25, 15], [-25, 35], [-45, 35]], holes: [], isSquare: true }],
      bridgePolys: [],
      pierPolys: [],
      pierLines: [],
      bridgeSupports: [],
      buildings: [
        { id: 1, osmId: 101, groupId: 101, name: 'Old Town Hall', btype: 'civic', cx: -35, cy: -20, outer: [[-42, -26], [-28, -26], [-28, -14], [-42, -14]], holes: [], h: 28, minH: 0, roof: 'gabled', roofH: 6, levels: 7, landmark: true },
        { id: 2, osmId: 102, groupId: 102, name: 'Sky Tower', btype: 'commercial', cx: 35, cy: 25, outer: [[28, 18], [42, 18], [42, 32], [28, 32]], holes: [], h: 65, minH: 0, roof: 'pyramidal', roofH: 10, levels: 18, tower: true, landmark: true },
        { id: 3, osmId: 103, groupId: 103, name: 'Island Chapel', btype: 'church', cx: 0, cy: 0, outer: [[-2.5, -5], [2.5, -5], [2.5, 5], [-2.5, 5]], holes: [], h: 18, minH: 0, roof: 'dome', roofH: 5, levels: 4, church: true, landmark: true },
      ],
    };
  };

  const testMatrix = scenes || [
    {
      label: 'Compact 12x8cm Single-Tile Solid + Frame (.STL + .3MF + Frame STL)',
      scene: defaultScene(),
      state: { targetWidthCm: 12, targetHeightCm: 8, bedSizeMm: 120, totalHeightMm: 80, tileCols: 1, tileRows: 1, hollowBase: false, waterCutout: false, showFrame: true, exportFrame: true, frameWidthMm: 10, plaqueText: 'COMPACT_12x8' },
    },
    {
      label: 'Panoramic 24x12cm 2x2 Multi-Tile SLA Hollow Vault + Segmented Frame (.ZIP + .3MF)',
      scene: defaultScene(),
      state: { targetWidthCm: 24, targetHeightCm: 12, bedSizeMm: 240, totalHeightMm: 120, tileCols: 2, tileRows: 2, hollowBase: true, hollowWallMm: 1.8, waterCutout: false, showFrame: true, exportFrame: true, frameWidthMm: 12, plaqueText: 'PANO_24x12_HOLLOW' },
    },
    {
      label: 'Portrait 10x16cm Rotated 37deg + Water Cutout (.STL + .3MF)',
      scene: defaultScene(),
      state: { targetWidthCm: 10, targetHeightCm: 16, bedSizeMm: 100, totalHeightMm: 160, tileCols: 1, tileRows: 2, rotationDeg: 37, hollowBase: false, waterCutout: true, showFrame: false, plaqueText: 'PORTRAIT_CUTOUT_37DEG' },
    },
  ];

  const report = [];
  for (const cfg of testMatrix) {
    const t0 = performance.now();
    const st = {
      isResin: true, xyPixelMm: 0.017, layerHeightMm: 0.05, kerfMm: 0.08, bedZ: 165,
      zScale: 1.0, terrainScale: 1.0, cropRatio: 1.0,
      ...cfg.state,
    };
    // Adjust scene halfW/halfH to match target plate aspect ratio
    const maxCm = Math.max(st.targetWidthCm, st.targetHeightCm);
    const sc = {
      ...cfg.scene,
      halfW: Math.round((84.6 * (st.targetWidthCm / maxCm)) * 100) / 100,
      halfH: Math.round((84.6 * (st.targetHeightCm / maxCm)) * 100) / 100,
    };

    const built = buildComplete3DModel(sc, st);
    const pm = built.printMetrics;
    assert.equal(pm.openEdgesCount, 0, `${cfg.label}: openEdgesCount=${pm.openEdgesCount}`);
    assert.equal(pm.nonManifoldEdgesCount, 0, `${cfg.label}: nonManifoldEdgesCount=${pm.nonManifoldEdgesCount}`);
    assert.equal(pm.isWatertightManifold, true, `${cfg.label}: not watertight`);

    st.layerMeshes = built.meshes;
    st.meshes = built.meshes;
    st.printMetrics = pm;

    const downloads = [];
    globalThis.downloadBlobHook = (u8, name, mime) => downloads.push({ bytes: u8, name, mime });

    // 1) Export 3MF
    st.exportTileFilter = 'all';
    const ok3mf = m3fMod.exportMultiColor3MF(st);
    assert.equal(ok3mf, true, `${cfg.label}: 3MF export returned false`);
    const dl3mf = downloads.pop();
    const audit3mf = audit3mfArchive(dl3mf.bytes, fflate);
    assert.equal(audit3mf.openEdges, 0, `${cfg.label}: 3MF openEdges=${audit3mf.openEdges}`);
    assert.equal(audit3mf.nonManifoldEdges, 0, `${cfg.label}: 3MF nonManifold=${audit3mf.nonManifoldEdges}`);

    // 2) Export single-tile STL (tile 0) & full/ZIP
    st.exportTileFilter = '0';
    const okTile0Stl = stlMod.exportBinarySTL(st, 'all');
    assert.equal(okTile0Stl, true, `${cfg.label}: Tile 0 STL export failed`);
    const dlStl0 = downloads.pop();
    const auditStl0 = auditBinaryStlTopology(dlStl0.bytes);
    assert.equal(auditStl0.openEdges, 0, `${cfg.label}: Binary STL openEdges=${auditStl0.openEdges}`);
    assert.equal(auditStl0.nonManifoldEdges, 0, `${cfg.label}: Binary STL nonManifold=${auditStl0.nonManifoldEdges}`);
    assert.equal(auditStl0.degen, 0, `${cfg.label}: Binary STL degenerateTris=${auditStl0.degen}`);

    let zipEntriesCount = 0;
    if ((st.tileCols || 1) * (st.tileRows || 1) > 1) {
      st.exportTileFilter = 'all';
      const okZip = zipMod.exportAllTilesZipSTL(st, 'all');
      assert.equal(okZip, true, `${cfg.label}: Multi-tile ZIP export failed`);
      const dlZip = downloads.pop();
      const unzipped = fflate.unzipSync(dlZip.bytes);
      const entryNames = Object.keys(unzipped);
      zipEntriesCount = entryNames.length;
      assert.ok(entryNames.includes('INSTRUKCJA_DRUKU_PHOTON_MONO_4.txt'), 'ZIP missing Polish Mono 4 guide');
      for (const fn of entryNames.filter((k) => k.endsWith('.stl'))) {
        const tileAudit = auditBinaryStlTopology(unzipped[fn]);
        assert.equal(tileAudit.openEdges, 0, `${cfg.label} -> ${fn}: openEdges=${tileAudit.openEdges}`);
        assert.equal(tileAudit.nonManifoldEdges, 0, `${cfg.label} -> ${fn}: nonManifold=${tileAudit.nonManifoldEdges}`);
      }
    }

    delete globalThis.downloadBlobHook;
    const elapsedMs = Math.round(performance.now() - t0);
    const entry = {
      label: cfg.label,
      totalTriangles: pm.totalTriangles,
      stlTile0Tris: auditStl0.nTris,
      m3fTris: audit3mf.totalTris,
      zipEntriesCount,
      hollowChambersKept: pm.hollowChambersKept || 0,
      drainCount: pm.drainCount || 0,
      elapsedMs,
      ...(includeMeshes ? { meshes: built.meshes, state: st, pngName: cfg.pngName } : {}),
    };
    report.push(entry);
    log(
      `  [PASS] ${cfg.label} (${elapsedMs}ms): meshTris=${entry.totalTriangles}, ` +
      `STL(open=0,nm=0,tris=${entry.stlTile0Tris}), 3MF(open=0,nm=0,tris=${entry.m3fTris})` +
      (zipEntriesCount ? `, ZIP(${zipEntriesCount} files)` : '')
    );
  }

  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runFormatsAndPlatesAudit().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
