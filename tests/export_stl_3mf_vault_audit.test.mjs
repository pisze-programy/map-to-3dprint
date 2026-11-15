import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const fflate = require(path.join(ROOT, 'src/vendor/vendor_bundle.js')).__FFLATE__ || globalThis.__FFLATE__;

Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/print_physics_config.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/sla_print_laws.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/export/export_io_utils.js')));
const { buildComplete3DModel } = require(path.join(ROOT, 'src/mesh/mesh_builder.js'));
const vaultMod = require(path.join(ROOT, 'src/mesh/tile_sla_vault_solver.js'));
const stlMod = require(path.join(ROOT, 'src/export/stl_writer.js'));
const zipMod = require(path.join(ROOT, 'src/export/zip_packager.js'));
const m3fMod = require(path.join(ROOT, 'src/export/export_3mf.js'));
Object.assign(globalThis, stlMod, zipMod, m3fMod);

function parseAndAuditRawStlBytes(bytes) {
  assert.ok(bytes instanceof Uint8Array && bytes.byteLength >= 84, 'STL shorter than 84B');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nTris = view.getUint32(80, true);
  assert.equal(bytes.byteLength, 84 + nTris * 50, 'STL byteLength mismatch');

  const vKeyToIdx = new Map();
  const edgeMap = new Map();
  const adj = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let vol6 = 0, degen = 0;
  const f32Key = (off) => `${view.getUint32(off, true)}_${view.getUint32(off + 4, true)}_${view.getUint32(off + 8, true)}`;
  const regV = (off) => {
    const x = view.getFloat32(off, true), y = view.getFloat32(off + 4, true), z = view.getFloat32(off + 8, true);
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), 'Non-finite STL vertex');
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    const k = f32Key(off);
    let idx = vKeyToIdx.get(k);
    if (idx === undefined) { idx = adj.length; vKeyToIdx.set(k, idx); adj.push([]); }
    return { idx, p: [x, y, z] };
  };

  for (let i = 0; i < nTris; i++) {
    const base = 84 + i * 50;
    const v0 = regV(base + 12), v1 = regV(base + 24), v2 = regV(base + 36);
    if (v0.idx === v1.idx || v1.idx === v2.idx || v2.idx === v0.idx) { degen++; continue; }
    const [a, b, c] = [v0.p, v1.p, v2.p];
    vol6 += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    for (const [u, w] of [[v0.idx, v1.idx], [v1.idx, v2.idx], [v2.idx, v0.idx]]) {
      adj[u].push(w); adj[w].push(u);
      const ek = u < w ? `${u}>${w}` : `${w}>${u}`;
      let r = edgeMap.get(ek);
      if (!r) { r = { fwd: 0, rev: 0 }; edgeMap.set(ek, r); }
      if (u < w) r.fwd++; else r.rev++;
    }
  }

  let openEdges = 0, nonManifoldEdges = 0, sameDirDupEdges = 0;
  for (const r of edgeMap.values()) {
    if (r.fwd === 1 && r.rev === 1) continue;
    if (r.fwd + r.rev === 1) openEdges++;
    else { nonManifoldEdges++; if (r.fwd > 1 || r.rev > 1) sameDirDupEdges++; }
  }

  const seen = new Uint8Array(adj.length);
  let components = 0;
  for (let i = 0; i < adj.length; i++) {
    if (seen[i] || adj[i].length === 0) continue;
    components++;
    const stack = [i]; seen[i] = 1;
    while (stack.length) {
      const cur = stack.pop();
      for (const nxt of adj[cur]) if (!seen[nxt]) { seen[nxt] = 1; stack.push(nxt); }
    }
  }
  return {
    nTris, degenerateTris: degen, openEdges, nonManifoldEdges, sameDirDupEdges, components,
    volumeMm3: vol6 / 6.0, spanX: maxX - minX, spanY: maxY - minY, minZ, maxZ,
  };
}

function auditRaw3mfXml(zipBytes) {
  const unzip = fflate.unzipSync(zipBytes);
  const xml = new TextDecoder().decode(unzip['3D/3dmodel.model']);
  const meshBlocks = [...xml.matchAll(/<mesh>([\s\S]*?)<\/mesh>/g)].map(m => m[1]);
  assert.ok(meshBlocks.length >= 2, `Expected multi-color 3MF >=2 mesh blocks, got ${meshBlocks.length}`);
  let openEdges = 0, nonManifoldEdges = 0, totalTris = 0;
  for (const blk of meshBlocks) {
    const verts = [...blk.matchAll(/<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g)];
    assert.ok(verts.length >= 4);
    const tris = [...blk.matchAll(/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g)];
    totalTris += tris.length;
    const edgeMap = new Map();
    for (const tm of tris) {
      const i1 = +tm[1], i2 = +tm[2], i3 = +tm[3];
      for (const [u, w] of [[i1, i2], [i2, i3], [i3, i1]]) {
        const k = u < w ? `${u}>${w}` : `${w}>${u}`;
        let r = edgeMap.get(k); if (!r) { r = { f: 0, b: 0 }; edgeMap.set(k, r); }
        if (u < w) r.f++; else r.b++;
      }
    }
    for (const r of edgeMap.values()) {
      if (r.f === 1 && r.b === 1) continue;
      if (r.f + r.b === 1) openEdges++; else nonManifoldEdges++;
    }
  }
  return { objects: meshBlocks.length, totalTris, openEdges, nonManifoldEdges };
}

function makeSq(cx, cy, h) {
  return [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]];
}

async function runAudit() {
  assert.equal(fs.existsSync(path.join(ROOT, 'src/mesh/mesh_clipper_3d.js')), false, 'mesh_clipper_3d.js must not exist');
  const tStart = Date.now();

  // 1. Overlapping multi-layer 2x2 plate + segmented frame
  console.log('[1/4] Raw .STL CSG Union, Raw .3MF XML & Segmented Frame Mono 4 Audit');
  const scene1 = {
    spanMeters: 700,
    dem: { grid: [[28, 32, 28], [24, 24, 24], [28, 32, 28]], minElev: 2, maxElev: 32 },
    waterPolys: [{ outer: [[-80, -80], [-52, -80], [-52, -52], [-80, -52]], holes: [] }],
    waterLines: [],
    greenPolys: [{ outer: [[10, 10], [65, 10], [65, 65], [10, 65]], holes: [] }],
    trees: [{ x: 35, y: 35, height: 11, crownRadius: 4 }],
    roads: [{ pts: [[-70, 0], [70, 0]], width: 5, layer: 0 }],
    bridgePolys: [],
    buildings: [
      { id: 101, outer: makeSq(40, 40, 8), holes: [], h: 22, roof: 'hipped', roofH: 4, highlighted: true },
      { id: 102, outer: makeSq(-40, 40, 7), holes: [], h: 16, roof: 'gabled', roofH: 3 },
    ],
  };
  const state1 = {
    plaqueText: 'AUDIT_TEST', bedSizeMm: 160, totalHeightMm: 160, tileCols: 2, tileRows: 2,
    hollowBase: true, hollowWallMm: 2.0, waterCutout: false, showFrame: true, exportFrame: true,
    frameWidthMm: 12, isResin: true, zScale: 1.0, terrainScale: 1.0, wantTrees: true,
  };
  const built1 = buildComplete3DModel(scene1, state1);
  assert.equal(built1.printMetrics.openEdgesCount, 0);
  assert.equal(built1.printMetrics.nonManifoldEdgesCount, 0);
  state1.layerMeshes = built1.meshes;
  state1.printMetrics = built1.printMetrics;

  const downloads = [];
  globalThis.downloadBlobHook = (bytes, name, mime) => downloads.push({ bytes, name, mime });
  zipMod.exportAllTilesZipSTL(state1, 'all');
  m3fMod.exportMultiColor3MF(state1);
  stlMod.exportFrameSTL(state1);
  delete globalThis.downloadBlobHook;
  assert.equal(downloads.length, 3);

  const zipFiles = fflate.unzipSync(downloads[0].bytes);
  const kafelNames = Object.keys(zipFiles).filter(n => n.startsWith('Kafel_') && n.endsWith('.stl'));
  const ramaZipNames = Object.keys(zipFiles).filter(n => n.startsWith('Rama_') && n.endsWith('.stl'));
  assert.equal(kafelNames.length, 4);
  assert.ok(ramaZipNames.length >= 4, `Expected segmented frame >=4 parts, got ${ramaZipNames.length}`);

  let sumStlVolMm3 = 0;
  for (const kn of kafelNames) {
    const a = parseAndAuditRawStlBytes(zipFiles[kn]);
    assert.equal(a.openEdges, 0, `${kn} open=${a.openEdges}`);
    assert.equal(a.nonManifoldEdges, 0, `${kn} nm=${a.nonManifoldEdges}`);
    assert.equal(a.sameDirDupEdges, 0, `${kn} dup=${a.sameDirDupEdges}`);
    assert.equal(a.degenerateTris, 0, `${kn} degen=${a.degenerateTris}`);
    assert.ok(a.volumeMm3 > 100 && a.spanX <= 153.5 && a.spanY <= 87.1, `${kn} bed fit: ${a.spanX.toFixed(1)}x${a.spanY.toFixed(1)}`);
    sumStlVolMm3 += a.volumeMm3;
  }

  // Raw layer sum exceeds CSG union because ground roads & buildings embed slightly into terrain
  const rawLayerVolMl = Object.values(built1.printMetrics.layerMetrics).reduce((s, m) => s + (m.volumeMl || 0), 0);
  const stlTotalMl = sumStlVolMm3 / 1000.0;
  assert.ok(stlTotalMl <= rawLayerVolMl + 0.05 && stlTotalMl > rawLayerVolMl * 0.65,
    `CSG union STL vol=${stlTotalMl.toFixed(2)}ml vs rawSum=${rawLayerVolMl.toFixed(2)}ml`);

  const threeMf = auditRaw3mfXml(downloads[1].bytes);
  assert.equal(threeMf.openEdges, 0);
  assert.equal(threeMf.nonManifoldEdges, 0);

  const frameZip = fflate.unzipSync(downloads[2].bytes);
  const frameSegNames = Object.keys(frameZip).filter(n => n.endsWith('.stl'));
  assert.equal(frameSegNames.length, ramaZipNames.length);
  for (const fn of frameSegNames) {
    const fa = parseAndAuditRawStlBytes(frameZip[fn]);
    assert.equal(fa.openEdges, 0, `${fn} open`);
    assert.equal(fa.nonManifoldEdges, 0, `${fn} nm`);
    assert.ok(fa.spanX <= 153.50 && fa.spanY <= 87.10, `Frame segment ${fn} exceeds Mono 4: ${fa.spanX.toFixed(1)}x${fa.spanY.toFixed(1)}`);
  }
  console.log(`  PASS: 4 tiles & ${frameSegNames.length} frame CSG segments verified 0-open/0-nm, Mono4 bed OK, STL=${stlTotalMl.toFixed(1)}ml <= raw=${rawLayerVolMl.toFixed(1)}ml`);

  // 2. Hollow vault: 45 deg diagonal ribs (pitch <= 12mm), >=2 drains/chamber & legible R1C1^
  console.log('[2/4] Anti-Suction 45 deg Ribs, >=2 Drains & R1C1^ Engraving Dimensions');
  const hillScene = {
    spanMeters: 500,
    dem: { grid: [[5, 35, 35, 5], [35, 48, 48, 35], [35, 48, 48, 35], [5, 35, 35, 5]], minElev: 5, maxElev: 48 },
    waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [], buildings: [],
  };
  const hillState = {
    plaqueText: 'HOLLOW_SINGLE', bedSizeMm: 130, totalHeightMm: 78, tileCols: 1, tileRows: 1,
    hollowBase: true, hollowWallMm: 2.0, waterCutout: false, showFrame: false, exportFrame: false,
    isResin: true, zScale: 1.0, terrainScale: 1.0,
  };
  const hillBuilt = buildComplete3DModel(hillScene, hillState);
  const hpm = hillBuilt.printMetrics;
  assert.ok(hpm.hollowChambersKept >= 1, `Expected kept chambers >= 1, got ${hpm.hollowChambersKept}`);
  assert.ok(hpm.drainCount >= 2 && hpm.hasDrainChannels === true);
  assert.ok(hpm.embossMetrics.ribPitchMm <= 12.0, `ribPitchMm=${hpm.embossMetrics.ribPitchMm}`);
  assert.ok(hpm.embossMetrics.strokeWidthMm >= 0.70, `strokeWidthMm=${hpm.embossMetrics.strokeWidthMm}`);
  assert.ok(hpm.embossMetrics.carveDepthMm >= 0.65, `carveDepthMm=${hpm.embossMetrics.carveDepthMm}`);
  assert.ok(hpm.embossMetrics.minRoofClearanceMm >= 0.75, `minRoofClearanceMm=${hpm.embossMetrics.minRoofClearanceMm}`);

  // Verify 45-degree rib normals and unmirrored R1C1^ stroke orientation
  const { scaleMm } = resolveSceneScaleAndSpec(hillState, null);
  const diagRibTris = hillBuilt.meshes.base.filter(t => t.n && Math.abs(t.n[2]) < 0.05 && Math.abs(Math.abs(t.n[0]) - Math.SQRT1_2) < 0.08 && Math.abs(Math.abs(t.n[1]) - Math.SQRT1_2) < 0.08);
  assert.ok(diagRibTris.length >= 16, `Expected 45-degree rib walls inside vault, got ${diagRibTris.length}`);
  const hillStl = parseAndAuditRawStlBytes(stlMod.buildBinarySTLBytes({ ...hillState, layerMeshes: hillBuilt.meshes }, 'all', 0));
  assert.equal(hillStl.openEdges, 0);
  assert.equal(hillStl.components, 1, `Expected single solid connected shell (no floating ribs), got ${hillStl.components}`);
  const labelStrokes = vaultMod.buildTileIdLabelPolys('R1C1^', 0, 0, 5 / scaleMm, scaleMm);
  assert.ok(labelStrokes[0].pts[0][0] > labelStrokes[labelStrokes.length - 1].pts[0][0], 'Expected R on +X (viewer left) and ^ on -X (viewer right)');
  console.log(`  PASS: pitch=${hpm.embossMetrics.ribPitchMm}mm, diagTris=${diagRibTris.length}, drains=${hpm.drainCount}, R1C1^ stroke=${hpm.embossMetrics.strokeWidthMm}mm depth=${hpm.embossMetrics.carveDepthMm}mm roof=${hpm.embossMetrics.minRoofClearanceMm}mm`);

  // 3. Water-locked island tile fallback -> auto fills solid (0 suction cups)
  console.log('[3/4] Island Tile (<2 dry perimeter exits) -> Automatic Solid Fallback');
  const ringPtsOuter = makeSq(0, 0, 84);
  const islandHole = [[42, -34], [-42, -34], [-42, 34], [42, 34]]; // CW hole = dry central island!
  const islandScene = {
    spanMeters: 500,
    dem: { grid: [[2,2,2,2,2],[2,45,55,45,2],[2,55,60,55,2],[2,45,55,45,2],[2,2,2,2,2]], minElev: 2, maxElev: 60 },
    waterPolys: [{ outer: ringPtsOuter, holes: [islandHole] }],
    waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [], buildings: [],
  };
  const islandBuilt = buildComplete3DModel(islandScene, { ...hillState, plaqueText: 'ISLAND', waterCutout: true });
  const ipm = islandBuilt.printMetrics;
  assert.equal(ipm.openEdgesCount, 0);
  assert.equal(ipm.nonManifoldEdgesCount, 0);
  assert.equal(ipm.hollowChambersKept, 0, 'Water-locked island must NOT create suction cup');
  assert.equal(ipm.hasDrainChannels, false);
  assert.ok(ipm.hollowChambersFilledSolid >= 1, `Expected filledSolid >= 1, got ${ipm.hollowChambersFilledSolid}`);
  console.log(`  PASS: Island filled solid (kept=${ipm.hollowChambersKept}, filledSolid=${ipm.hollowChambersFilledSolid}, drains=${ipm.drainCount})`);

  // 4. Real dense OSM STL CSG performance & watertightness check (Porto & Millau Viaduct)
  console.log('[4/4] Real Dense OSM Tile CSG .STL Performance & Topology Check');
  const SCRATCH = '/Users/krystianblaszczyk/.gemini/antigravity/brain/acf68bd7-959f-4001-b031-f431964aa593/scratch';
  const DEM_DIR = path.join(SCRATCH, 'scenes_15_dem_cache');
  const targets = [
    { slug: 'porto', file: path.join(SCRATCH, 'scenes_5/porto.json'), cols: 2, rows: 2, hollow: true },
    { slug: 'millau_viaduct', file: path.join(SCRATCH, 'scenes_10/millau_viaduct.json'), cols: 2, rows: 2, hollow: false },
  ];
  const { loadSceneAndBuildModel } = require(path.join(ROOT, 'tools/headless_scene_harness.js'));
  for (const tgt of targets) {
    if (!fs.existsSync(tgt.file)) { console.log(`  SKIP ${tgt.slug} (cache missing)`); continue; }
    const sc = JSON.parse(fs.readFileSync(tgt.file, 'utf8'));
    const [w, s, e, n] = sc.bbox;
    const cosLat = Math.max(0.2, Math.cos((sc.center.lat * Math.PI) / 180));
    const widthM = (e - w) * 111320 * cosLat, heightM = (n - s) * 111320, maxM = Math.max(widthM, heightM);
    const built = await loadSceneAndBuildModel({
      title: tgt.slug.toUpperCase(), osmElements: sc.osmElements, demCacheDir: DEM_DIR,
      offlineOnly: true, offlineFallbackDem: true, lat: sc.center.lat, lon: sc.center.lon,
      spanMeters: maxM / 1.045, rotationDeg: 0, targetWidthCm: 32 * (widthM / maxM), targetHeightCm: 32 * (heightM / maxM),
      tileCols: tgt.cols, tileRows: tgt.rows, cropRatio: 1.0, waterCutout: false, hollowBase: tgt.hollow,
      showFrame: false, wantTrees: true, isResin: true, zScale: 1.0, terrainScale: 1.0, skipTopologyAudit: false, silent: true,
    });
    const st = {
      plaqueText: tgt.slug, targetWidthCm: 32 * (widthM / maxM), targetHeightCm: 32 * (heightM / maxM),
      tileCols: tgt.cols, tileRows: tgt.rows, waterCutout: false, hollowBase: tgt.hollow,
      layerMeshes: built.meshes, printMetrics: built.printMetrics,
    };
    for (let tid = 0; tid < tgt.cols * tgt.rows; tid++) {
      const t0 = Date.now();
      const bytes = stlMod.buildBinarySTLBytes(st, 'all', tid);
      const dt = Date.now() - t0;
      const a = parseAndAuditRawStlBytes(bytes);
      assert.equal(a.openEdges, 0, `${tgt.slug} T${tid} STL open`);
      assert.equal(a.nonManifoldEdges, 0, `${tgt.slug} T${tid} STL nm`);
      assert.equal(a.sameDirDupEdges, 0, `${tgt.slug} T${tid} STL dup`);
      assert.equal(a.degenerateTris, 0, `${tgt.slug} T${tid} STL degen`);
      assert.ok(dt < 10000, `${tgt.slug} T${tid} CSG union too slow: ${dt} ms`);
      console.log(`  PASS ${tgt.slug} T${tid}: CSG STL=${dt}ms tris=${a.nTris} open=0 nm=0 dup=0 degen=0 comps=${a.components}`);
    }
  }
  console.log(`\nETAP 6 AUDIT PASSED in ${Date.now() - tStart} ms.`);
}

runAudit().catch(err => { console.error('audit FAILED:', err); process.exit(1); });
