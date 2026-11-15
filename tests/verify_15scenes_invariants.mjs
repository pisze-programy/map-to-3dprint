import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

const vendor = require(path.join(ROOT, 'src/vendor/vendor_bundle.js'));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/print_physics_config.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/export/export_io_utils.js')));
const { exportMultiColor3MF } = require(path.join(ROOT, 'src/export/export_3mf.js'));
const { loadSceneAndBuildModel } = require(path.join(ROOT, 'tools/headless_scene_harness.js'));
const { encodePngRgba } = require(path.join(ROOT, 'tools/headless_3d_renderer.js'));

const SCRATCH_BASE = '/Users/krystianblaszczyk/.gemini/antigravity/brain/acf68bd7-959f-4001-b031-f431964aa593/scratch';
const SCENES_DIRS = [
  path.join(SCRATCH_BASE, 'scenes_5'),
  path.join(SCRATCH_BASE, 'scenes_10'),
];
const DEM_CACHE_DIR = path.join(SCRATCH_BASE, 'scenes_15_dem_cache');

function lon2tileF(lon, z) {
  return ((lon + 180.0) / 360.0) * Math.pow(2, z);
}
function lat2tileF(lat, z) {
  const rad = (lat * Math.PI) / 180.0;
  return ((1.0 - Math.log(Math.tan(rad) + 1.0 / Math.cos(rad)) / Math.PI) / 2.0) * Math.pow(2, z);
}

function encodeTerrariumTileRgba(floatArr, w = 256, h = 256) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(65535.99609375, floatArr[i] + 32768.0));
    const r = Math.floor(v / 256.0);
    const g = Math.floor(v - r * 256.0);
    const b = Math.min(255, Math.floor((v - Math.floor(v)) * 256.0));
    const o = i * 4;
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = 255;
  }
  return rgba;
}

function loadAllSceneFiles() {
  const files = [];
  for (const dir of SCENES_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith('.json')) continue;
      files.push(path.join(dir, name));
    }
  }
  return files;
}

function ensureOfflineDemCache15(sceneRecords) {
  fs.mkdirSync(DEM_CACHE_DIR, { recursive: true });
  const z14Map = new Map();
  let written14 = 0;

  for (const { json } of sceneRecords) {
    for (const t of Object.values((json.dem && json.dem.tiles) || {})) {
      const k = `${t.x},${t.y}`;
      if (!z14Map.has(k)) {
        const raw = Buffer.from(t.elevationsFloat32Base64, 'base64');
        const arr = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
        z14Map.set(k, arr);
      }
      const p14 = path.join(DEM_CACHE_DIR, `14_${t.x}_${t.y}.png`);
      if (!fs.existsSync(p14)) {
        fs.writeFileSync(p14, encodePngRgba(256, 256, encodeTerrariumTileRgba(z14Map.get(k), 256, 256)));
        written14++;
      }
    }
  }

  const sampleZ14Float = (fx14, fy14) => {
    const ix = Math.floor(fx14);
    const iy = Math.floor(fy14);
    const px = (fx14 - ix) * 256;
    const py = (fy14 - iy) * 256;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const ux = px - x0;
    const uy = py - y0;

    const getPx = (gx, gy) => {
      let tx = ix, ty = iy, lx = gx, ly = gy;
      if (lx < 0) { lx += 256; tx--; } else if (lx >= 256) { lx -= 256; tx++; }
      if (ly < 0) { ly += 256; ty--; } else if (ly >= 256) { ly -= 256; ty++; }
      const tile = z14Map.get(`${tx},${ty}`) || z14Map.get(`${ix},${iy}`);
      if (!tile) return 0;
      const cx = Math.max(0, Math.min(255, lx));
      const cy = Math.max(0, Math.min(255, ly));
      return tile[cy * 256 + cx];
    };

    const e00 = getPx(x0, y0);
    const e10 = getPx(x0 + 1, y0);
    const e01 = getPx(x0, y0 + 1);
    const e11 = getPx(x0 + 1, y0 + 1);
    return (e00 * (1 - ux) + e10 * ux) * (1 - uy) + (e01 * (1 - ux) + e11 * ux) * uy;
  };

  let written15 = 0;
  for (const { json } of sceneRecords) {
    const [west, south, east, north] = json.bbox;
    const padLon = (east - west) * 0.15;
    const padLat = (north - south) * 0.15;
    const tx0 = Math.floor(lon2tileF(west - padLon, 15));
    const tx1 = Math.floor(lon2tileF(east + padLon, 15));
    const ty0 = Math.floor(lat2tileF(north + padLat, 15));
    const ty1 = Math.floor(lat2tileF(south - padLat, 15));

    for (let tx15 = tx0; tx15 <= tx1; tx15++) {
      for (let ty15 = ty0; ty15 <= ty1; ty15++) {
        const outPath = path.join(DEM_CACHE_DIR, `15_${tx15}_${ty15}.png`);
        if (fs.existsSync(outPath)) continue;
        const parentTx = Math.floor(tx15 / 2);
        const parentTy = Math.floor(ty15 / 2);
        if (!z14Map.has(`${parentTx},${parentTy}`)) continue;
        const arr15 = new Float32Array(256 * 256);
        for (let py = 0; py < 256; py++) {
          const fy14 = (ty15 + (py + 0.5) / 256) * 0.5;
          for (let px = 0; px < 256; px++) {
            const fx14 = (tx15 + (px + 0.5) / 256) * 0.5;
            arr15[py * 256 + px] = sampleZ14Float(fx14, fy14);
          }
        }
        fs.writeFileSync(outPath, encodePngRgba(256, 256, encodeTerrariumTileRgba(arr15, 256, 256)));
        written15++;
      }
    }
  }
  return { z14Tiles: z14Map.size, written14, written15 };
}

function audit3mfXmlTopology(modelXml) {
  const objectMatches = [...modelXml.matchAll(/<object\s+id="(\d+)"[^>]*type="model"[^>]*>([\s\S]*?)<\/object>/g)];
  let meshObjects = 0;
  let totalXmlTris = 0;
  let totalXmlVerts = 0;
  let openEdges = 0;
  let nonManifoldEdges = 0;
  let sameDirDupEdges = 0;
  let badPrecisionVerts = 0;

  for (const om of objectMatches) {
    const body = om[2];
    const vertsMatch = body.match(/<vertices>([\s\S]*?)<\/vertices>/);
    const trisMatch = body.match(/<triangles>([\s\S]*?)<\/triangles>/);
    if (!vertsMatch || !trisMatch) continue;
    meshObjects++;

    const vCoords = [...vertsMatch[1].matchAll(/<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"\s*\/>/g)];
    totalXmlVerts += vCoords.length;
    for (const vc of vCoords) {
      if (!/^-?\d+\.\d{5}$/.test(vc[1]) || !/^-?\d+\.\d{5}$/.test(vc[2]) || !/^-?\d+\.\d{5}$/.test(vc[3])) {
        badPrecisionVerts++;
      }
    }

    const edgeMap = new Map();
    const tMatches = [...trisMatch[1].matchAll(/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g)];
    for (const tm of tMatches) {
      const i0 = Number(tm[1]), i1 = Number(tm[2]), i2 = Number(tm[3]);
      assert.ok(i0 < vCoords.length && i1 < vCoords.length && i2 < vCoords.length, '3MF vertex index out of bounds');
      assert.ok(i0 !== i1 && i1 !== i2 && i2 !== i0, '3MF degenerate triangle index');
      totalXmlTris++;
      for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        let rec = edgeMap.get(key);
        if (!rec) { rec = { fwd: 0, rev: 0 }; edgeMap.set(key, rec); }
        if (a < b) rec.fwd++;
        else rec.rev++;
      }
    }
    for (const rec of edgeMap.values()) {
      if (rec.fwd === 1 && rec.rev === 1) continue;
      if (rec.fwd + rec.rev === 1) openEdges++;
      else {
        nonManifoldEdges++;
        if (rec.fwd > 1 || rec.rev > 1) sameDirDupEdges++;
      }
    }
  }
  return { meshObjects, totalXmlVerts, totalXmlTris, openEdges, nonManifoldEdges, sameDirDupEdges, badPrecisionVerts };
}

async function run() {
  const scenePaths = loadAllSceneFiles();
  assert.equal(scenePaths.length, 15, `Expected 15 scene JSON files, found ${scenePaths.length}`);

  const sceneRecords = scenePaths.map(p => ({
    path: p,
    json: JSON.parse(fs.readFileSync(p, 'utf8')),
  }));
  const cacheStats = ensureOfflineDemCache15(sceneRecords);
  console.log(`DEM cache ready (${DEM_CACHE_DIR}): z14Tiles=${cacheStats.z14Tiles}, new14=${cacheStats.written14}, new15=${cacheStats.written15}`);

  const results = [];
  const threeMfCheckSlugs = new Set(['porto', 'frankfurt', 'singapore', 'millau_viaduct', 'eiffel_seine']);
  let failures = 0;

  for (const { json } of sceneRecords) {
    const slug = json.slug;
    const [west, south, east, north] = json.bbox;
    const cosLat = Math.max(0.2, Math.cos((json.center.lat * Math.PI) / 180.0));
    const widthM = (east - west) * 111320.0 * cosLat;
    const heightM = (north - south) * 111320.0;
    const maxSpanM = Math.max(widthM, heightM);

    const t0 = Date.now();
    const built = await loadSceneAndBuildModel({
      title: slug.toUpperCase(),
      osmElements: json.osmElements,
      demCacheDir: DEM_CACHE_DIR,
      offlineOnly: true,
      offlineFallbackDem: true,
      lat: json.center.lat,
      lon: json.center.lon,
      spanMeters: maxSpanM / 1.045,
      rotationDeg: 0,
      targetWidthCm: 32.0 * (widthM / maxSpanM),
      targetHeightCm: 32.0 * (heightM / maxSpanM),
      cropRatio: 1.0,
      waterCutout: false,
      hollowBase: false,
      showFrame: false,
      wantTrees: true,
      isResin: false,
      zScale: 1.0,
      terrainScale: 1.0,
      skipTopologyAudit: false,
      silent: true,
    });
    const buildMs = Date.now() - t0;
    const pm = built.printMetrics;

    const okTopo = pm.openEdgesCount === 0 && pm.nonManifoldEdgesCount === 0 && pm.sameDirDupEdgesCount === 0 && pm.degenerateTrisCount === 0;
    if (!okTopo) failures++;

    let threeMfAudit = null;
    if (threeMfCheckSlugs.has(slug)) {
      const captured = [];
      globalThis.downloadBlobHook = (bytes, name, mime) => captured.push({ bytes, name, mime });
      const st = {
        ...built.state,
        plaqueText: slug.toUpperCase(),
        layerMeshes: built.meshes,
        printMetrics: pm,
        totalTriangles: built.model.totalTriangles,
        exportTileFilter: 'all',
      };
      const ok3mf = exportMultiColor3MF(st);
      delete globalThis.downloadBlobHook;
      assert.equal(ok3mf, true, `${slug} exportMultiColor3MF failed`);
      assert.equal(captured.length, 1, `${slug} did not emit 3MF blob`);
      const unzipped = vendor.fflate.unzipSync(captured[0].bytes);
      assert.ok(unzipped['[Content_Types].xml'] && unzipped['_rels/.rels'] && unzipped['3D/3dmodel.model'], `${slug} 3MF missing archive entries`);
      const xmlStr = new TextDecoder().decode(unzipped['3D/3dmodel.model']);
      threeMfAudit = audit3mfXmlTopology(xmlStr);
      assert.equal(threeMfAudit.badPrecisionVerts, 0, `${slug} 3MF vertices not formatted to 5 decimals`);
      assert.equal(threeMfAudit.openEdges, 0, `${slug} 3MF XML openEdges=${threeMfAudit.openEdges}`);
      assert.equal(threeMfAudit.nonManifoldEdges, 0, `${slug} 3MF XML nonManifoldEdges=${threeMfAudit.nonManifoldEdges}`);
      assert.equal(threeMfAudit.sameDirDupEdges, 0, `${slug} 3MF XML sameDirDupEdges=${threeMfAudit.sameDirDupEdges}`);
      assert.ok(threeMfAudit.totalXmlTris > 0, `${slug} 3MF XML has 0 triangles`);
    }

    const row = {
      slug,
      buildMs,
      totalTriangles: pm.totalTriangles,
      openEdges: pm.openEdgesCount,
      nonManifoldEdges: pm.nonManifoldEdgesCount,
      sameDirDupEdges: pm.sameDirDupEdgesCount,
      degenerateTris: pm.degenerateTrisCount,
      floatingBuildings: pm.floatingBuildingsCount,
      outOfTileTris: pm.outOfTileTrisCount,
      bridgeCount: pm.bridgeCount,
      drainCount: pm.drainCount,
      hasDrainChannels: pm.hasDrainChannels,
      archetypeCounts: pm.archetypeCounts,
      threeMfAudit,
    };
    results.push(row);
    console.log(
      `[${okTopo ? 'PASS' : 'FAIL'}] ${slug.padEnd(22)} | ${String(buildMs).padStart(5)}ms | tris=${String(pm.totalTriangles).padStart(7)} | open=${pm.openEdgesCount} nm=${pm.nonManifoldEdgesCount} dup=${pm.sameDirDupEdgesCount} | bridges=${pm.bridgeCount} | arch=${JSON.stringify(pm.archetypeCounts)}${threeMfAudit ? ` | 3MF(tris=${threeMfAudit.totalXmlTris}, open=${threeMfAudit.openEdges}, nm=${threeMfAudit.nonManifoldEdges})` : ''}`
    );
  }

  // Also test hollowBase telemetry on Porto (2x2 tiles)
  const portoJson = sceneRecords.find(r => r.json.slug === 'porto').json;
  const [pw, ps, pe, pn] = portoJson.bbox;
  const pCos = Math.max(0.2, Math.cos((portoJson.center.lat * Math.PI) / 180.0));
  const pW = (pe - pw) * 111320.0 * pCos;
  const pH = (pn - ps) * 111320.0;
  const pMax = Math.max(pW, pH);
  const hollowBuilt = await loadSceneAndBuildModel({
    title: 'PORTO_HOLLOW',
    osmElements: portoJson.osmElements,
    demCacheDir: DEM_CACHE_DIR,
    offlineOnly: true,
    offlineFallbackDem: true,
    lat: portoJson.center.lat,
    lon: portoJson.center.lon,
    spanMeters: pMax / 1.045,
    rotationDeg: 0,
    targetWidthCm: 32.0 * (pW / pMax),
    targetHeightCm: 32.0 * (pH / pMax),
    tileCols: 2,
    tileRows: 2,
    cropRatio: 1.0,
    waterCutout: false,
    hollowBase: true,
    showFrame: false,
    wantTrees: true,
    isResin: true,
    zScale: 1.0,
    terrainScale: 1.0,
    skipTopologyAudit: false,
    silent: true,
  });
  const hpm = hollowBuilt.printMetrics;
  console.log(`\n[HOLLOW 2x2] porto | tris=${hpm.totalTriangles} | open=${hpm.openEdgesCount} nm=${hpm.nonManifoldEdgesCount} dup=${hpm.sameDirDupEdgesCount} | drainCount=${hpm.drainCount} hasDrainChannels=${hpm.hasDrainChannels} savings=${hpm.hollowSavingsPct}%`);
  assert.equal(hpm.openEdgesCount, 0, 'Porto hollow 2x2 openEdges');
  assert.equal(hpm.nonManifoldEdgesCount, 0, 'Porto hollow 2x2 nonManifoldEdges');
  assert.equal(hpm.sameDirDupEdgesCount, 0, 'Porto hollow 2x2 sameDirDupEdges');
  assert.ok(hpm.drainCount >= 2 && hpm.hasDrainChannels === true, `Expected real drainCount >= 2, got ${hpm.drainCount}`);

  if (process.env.OUT_JSON) {
    fs.writeFileSync(process.env.OUT_JSON, JSON.stringify({ results, portoHollow2x2: {
      totalTriangles: hpm.totalTriangles,
      openEdges: hpm.openEdgesCount,
      nonManifoldEdges: hpm.nonManifoldEdgesCount,
      sameDirDupEdges: hpm.sameDirDupEdgesCount,
      drainCount: hpm.drainCount,
      hasDrainChannels: hpm.hasDrainChannels,
      hollowSavingsPct: hpm.hollowSavingsPct,
    } }, null, 2));
  }

  assert.equal(failures, 0, `${failures}/15 scenes failed 2-manifold invariants`);
  console.log('\nALL 15 SCENES PASSED 0 open / 0 non-manifold / 0 dup invariants!');
}

run().catch(err => {
  console.error('verify_15scenes_invariants FAILED:', err);
  process.exit(1);
});
