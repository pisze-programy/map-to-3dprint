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
const coreMod = require(path.join(ROOT, 'src/geometry/manifold_core.js'));
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

function auditRawStlSliceRasterCavities(bytes, zListMm, cellMm = 0.25) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nTris = view.getUint32(80, true);
  const tris = new Float64Array(nTris * 9);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < nTris; i++) {
    const base = 84 + i * 50;
    for (let v = 0; v < 3; v++) {
      const vo = base + 12 + v * 12;
      const x = view.getFloat32(vo, true);
      const y = view.getFloat32(vo + 4, true);
      const z = view.getFloat32(vo + 8, true);
      tris[i * 9 + v * 3] = x;
      tris[i * 9 + v * 3 + 1] = y;
      tris[i * 9 + v * 3 + 2] = z;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const xOrigin = minX - cellMm;
  const yOrigin = minY - cellMm;
  const w = Math.ceil((maxX - minX) / cellMm) + 3;
  const h = Math.ceil((maxY - minY) / cellMm) + 3;
  const total = w * h;
  const grid = new Uint8Array(total);
  const seen = new Uint8Array(total);
  const queue = new Int32Array(total);
  const results = [];

  for (const zTarget of zListMm) {
    const zProbe = zTarget + 0.0013;
    const segs = [];
    for (let i = 0; i < nTris; i++) {
      const o = i * 9;
      const z0 = tris[o + 2], z1 = tris[o + 5], z2 = tris[o + 8];
      const b0 = z0 >= zProbe, b1 = z1 >= zProbe, b2 = z2 >= zProbe;
      if ((b0 && b1 && b2) || (!b0 && !b1 && !b2)) continue;
      const pts = [];
      const edges = [[0, 1, b0, b1], [1, 2, b1, b2], [2, 0, b2, b0]];
      for (const [ia, ib, ba, bb] of edges) {
        if (ba === bb) continue;
        const ao = o + ia * 3, bo = o + ib * 3;
        const t = (zProbe - tris[ao + 2]) / (tris[bo + 2] - tris[ao + 2]);
        pts.push([
          tris[ao] + t * (tris[bo] - tris[ao]),
          tris[ao + 1] + t * (tris[bo + 1] - tris[ao + 1]),
        ]);
      }
      if (pts.length === 2) segs.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]);
    }

    grid.fill(0);
    let solidPixels = 0;
    for (let iy = 0; iy < h; iy++) {
      const yc = yOrigin + (iy + 0.5) * cellMm;
      const xs = [];
      for (let si = 0; si < segs.length; si++) {
        const s = segs[si];
        if ((s[1] <= yc && s[3] > yc) || (s[3] <= yc && s[1] > yc)) {
          xs.push(s[0] + ((yc - s[1]) * (s[2] - s[0])) / (s[3] - s[1]));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      const rowOff = iy * w;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const ix0 = Math.max(0, Math.ceil((xs[k] - xOrigin) / cellMm - 0.5));
        const ix1 = Math.min(w - 1, Math.floor((xs[k + 1] - xOrigin) / cellMm - 0.5));
        for (let ix = ix0; ix <= ix1; ix++) {
          if (grid[rowOff + ix] === 0) {
            grid[rowOff + ix] = 1;
            solidPixels++;
          }
        }
      }
    }

    // Flood-fill exterior air from padded corner (0, 0).
    seen.fill(0);
    let qHead = 0, qTail = 0;
    seen[0] = 1;
    queue[qTail++] = 0;
    while (qHead < qTail) {
      const cur = queue[qHead++];
      const cx = cur % w;
      const cy = (cur - cx) / w;
      if (cx > 0 && grid[cur - 1] === 0 && !seen[cur - 1]) { seen[cur - 1] = 1; queue[qTail++] = cur - 1; }
      if (cx + 1 < w && grid[cur + 1] === 0 && !seen[cur + 1]) { seen[cur + 1] = 1; queue[qTail++] = cur + 1; }
      if (cy > 0 && grid[cur - w] === 0 && !seen[cur - w]) { seen[cur - w] = 1; queue[qTail++] = cur - w; }
      if (cy + 1 < h && grid[cur + w] === 0 && !seen[cur + w]) { seen[cur + w] = 1; queue[qTail++] = cur + w; }
    }

    let maxSealedCavityMm2 = 0;
    let sealedCavitiesGe2Mm2 = 0;
    for (let idx = 0; idx < total; idx++) {
      if (grid[idx] !== 0 || seen[idx]) continue;
      let ch = 0, ct = 0;
      seen[idx] = 1;
      queue[ct++] = idx;
      while (ch < ct) {
        const cur = queue[ch++];
        const cx = cur % w;
        const cy = (cur - cx) / w;
        if (cx > 0 && grid[cur - 1] === 0 && !seen[cur - 1]) { seen[cur - 1] = 1; queue[ct++] = cur - 1; }
        if (cx + 1 < w && grid[cur + 1] === 0 && !seen[cur + 1]) { seen[cur + 1] = 1; queue[ct++] = cur + 1; }
        if (cy > 0 && grid[cur - w] === 0 && !seen[cur - w]) { seen[cur - w] = 1; queue[ct++] = cur - w; }
        if (cy + 1 < h && grid[cur + w] === 0 && !seen[cur + w]) { seen[cur + w] = 1; queue[ct++] = cur + w; }
      }
      const compAreaMm2 = ct * cellMm * cellMm;
      if (compAreaMm2 > maxSealedCavityMm2) maxSealedCavityMm2 = compAreaMm2;
      if (compAreaMm2 >= 2.0) sealedCavitiesGe2Mm2++;
    }
    results.push({ zMm: zTarget, areaMm2: solidPixels * cellMm * cellMm, maxSealedCavityMm2, sealedCavitiesGe2Mm2 });
  }
  return results;
}

function auditRawStlOverhangsVal04(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nTris = view.getUint32(80, true);
  const tris = [];
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  for (let i = 0; i < nTris; i++) {
    const base = 84 + i * 50;
    const pts = [];
    for (let v = 0; v < 3; v++) {
      const vo = base + 12 + v * 12;
      const x = r4(view.getFloat32(vo, true));
      const y = r4(view.getFloat32(vo + 4, true));
      const z = r4(view.getFloat32(vo + 8, true));
      pts.push([x, y, z]);
      if (x < xmin) xmin = x; if (x > xmax) xmax = x;
      if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    }
    tris.push(pts);
  }
  const cands = [];
  const vMap = new Map();
  for (let ti = 0; ti < tris.length; ti++) {
    const [p0, p1, p2] = tris[ti];
    const zmin = Math.min(p0[2], p1[2], p2[2]);
    if (zmin <= 0.25) continue;
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const norm = Math.hypot(cx, cy, cz);
    if (norm < 1e-8) continue;
    if ((cz / norm) < -0.80) {
      const ci = cands.length;
      cands.push({ ti, area: 0.5 * norm });
      for (const p of [p0, p1, p2]) {
        const pk = `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
        let arr = vMap.get(pk);
        if (!arr) { arr = []; vMap.set(pk, arr); }
        arr.push(ci);
      }
    }
  }
  const seen = new Uint8Array(cands.length);
  const rawClusters = [];
  for (let i = 0; i < cands.length; i++) {
    if (seen[i]) continue;
    seen[i] = 1;
    const q = [i];
    let area = 0, zLo = Infinity;
    const tList = [];
    for (let h = 0; h < q.length; h++) {
      const cur = cands[q[h]];
      tList.push(cur.ti);
      area += cur.area;
      for (const p of tris[cur.ti]) {
        if (p[2] < zLo) zLo = p[2];
        const pk = `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
        for (const nb of (vMap.get(pk) || [])) {
          if (!seen[nb]) { seen[nb] = 1; q.push(nb); }
        }
      }
    }
    if (area >= 2.5) rawClusters.push({ area, zLo, tList });
  }

  const step = 0.35;
  const nx = Math.ceil((xmax - xmin) / step) + 4;
  const ny = Math.ceil((ymax - ymin) / step) + 4;
  const ox = xmin - 2 * step;
  const oy = ymin - 2 * step;
  const sliceCache = new Map();

  const getSupportDist = (zSup) => {
    const zq = Math.round(Math.max(0.05, zSup) * 100) / 100;
    if (sliceCache.has(zq)) return sliceCache.get(zq);
    const segsByRow = Array.from({ length: ny }, () => []);
    for (let ti = 0; ti < tris.length; ti++) {
      const [p0, p1, p2] = tris[ti];
      const lo = Math.min(p0[2], p1[2], p2[2]), hi = Math.max(p0[2], p1[2], p2[2]);
      if (!(lo <= zq && zq < hi)) continue;
      const pts = [];
      for (const [a, b] of [[p0, p1], [p1, p2], [p2, p0]]) {
        if ((a[2] <= zq && zq < b[2]) || (b[2] <= zq && zq < a[2])) {
          const t = (zq - a[2]) / (b[2] - a[2]);
          pts.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
        }
      }
      if (pts.length === 2) {
        const [x1, y1] = pts[0], [x2, y2] = pts[1];
        const r0 = Math.max(0, Math.floor((Math.min(y1, y2) - oy) / step));
        const r1 = Math.min(ny - 1, Math.floor((Math.max(y1, y2) - oy) / step));
        for (let r = r0; r <= r1; r++) {
          const yv = oy + (r + 0.5) * step;
          if ((y1 <= yv && yv < y2) || (y2 <= yv && yv < y1)) {
            segsByRow[r].push(x1 + ((yv - y1) / (y2 - y1)) * (x2 - x1));
          }
        }
      }
    }
    const dist = new Int16Array(nx * ny).fill(999);
    const dq = new Int32Array(nx * ny);
    let qh = 0, qt = 0;
    for (let r = 0; r < ny; r++) {
      const xs = segsByRow[r].sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.floor((xs[k] - ox) / step));
        const c1 = Math.min(nx - 1, Math.floor((xs[k + 1] - ox) / step));
        for (let c = c0; c <= c1; c++) {
          const xv = ox + (c + 0.5) * step;
          if (xs[k] <= xv && xv <= xs[k + 1]) {
            const idx = r * nx + c;
            if (dist[idx] !== 0) { dist[idx] = 0; dq[qt++] = idx; }
          }
        }
      }
    }
    while (qh < qt) {
      const cur = dq[qh++];
      const nd = dist[cur] + 1;
      if (nd > 25) continue;
      const cc = cur % nx, rr = (cur - cc) / nx;
      if (cc > 0 && dist[cur - 1] > nd) { dist[cur - 1] = nd; dq[qt++] = cur - 1; }
      if (cc + 1 < nx && dist[cur + 1] > nd) { dist[cur + 1] = nd; dq[qt++] = cur + 1; }
      if (rr > 0 && dist[cur - nx] > nd) { dist[cur - nx] = nd; dq[qt++] = cur - nx; }
      if (rr + 1 < ny && dist[cur + nx] > nd) { dist[cur + nx] = nd; dq[qt++] = cur + nx; }
    }
    sliceCache.set(zq, dist);
    return dist;
  };

  let maxHalfSpanMm = 0;
  const clusterStats = [];
  for (const cl of rawClusters) {
    const dGrid = getSupportDist(cl.zLo - 0.15);
    let maxCells = 0;
    for (const ti of cl.tList) {
      const [p0, p1, p2] = tris[ti];
      const samples = [p0, p1, p2, [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, cl.zLo]];
      for (const sp of samples) {
        const cc = Math.max(0, Math.min(nx - 1, Math.floor((sp[0] - ox) / step)));
        const rr = Math.max(0, Math.min(ny - 1, Math.floor((sp[1] - oy) / step)));
        if (dGrid[rr * nx + cc] > maxCells) maxCells = dGrid[rr * nx + cc];
      }
    }
    const halfSpanMm = maxCells * step;
    if (halfSpanMm > maxHalfSpanMm) maxHalfSpanMm = halfSpanMm;
    clusterStats.push({ areaMm2: cl.area, zLoMm: cl.zLo, halfSpanMm });
  }
  return { maxHalfSpanMm, clusters: clusterStats };
}

function makeSq(cx, cy, h) {
  return [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]];
}

async function runAudit() {
  const legacyClipperName = 'mesh_' + 'clipper_3d.js';
  assert.equal(fs.existsSync(path.join(ROOT, 'src/mesh', legacyClipperName)), false, `${legacyClipperName} must not exist`);
  const tStart = Date.now();

  // 1. Overlapping multi-layer 2x2 plate + segmented frame
  console.log('[1/5] Raw .STL CSG Union, Raw .3MF XML & Segmented Frame Mono 4 Audit');
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
  console.log('[2/5] Anti-Suction 45 deg Ribs, >=2 Drains & R1C1^ Engraving Dimensions');
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
  console.log('[3/5] Island Tile (<2 dry perimeter exits) -> Automatic Solid Fallback');
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
  console.log('[4/5] Real Dense OSM Tile CSG .STL Performance & Topology Check');
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
  // 5. Flat coastal 145x79mm tile: hole plug, shallow anti-peel relief, vented R1C1^
  console.log('[5/5] Flat Coastal 145x79mm Tile (Plugs + Shallow Relief + Vented ID + 2D Raster Cavity Audit)');
  const coastalFlatScene = {
    spanMeters: 700,
    dem: {
      grid: [
        [0.25, 0.25, 0.25, 0.25, 0.25],
        [0.25, 0.25, 0.25, 0.25, 0.25],
        [-0.25, -0.25, -0.25, -0.25, -0.25],
        [0.25, 0.25, 0.25, 0.25, 0.25],
        [0.25, 0.25, 0.25, 0.25, 0.25],
      ],
      minElev: -0.25,
      maxElev: 0.25,
    },
    waterPolys: [
      { outer: [[-90, -5], [90, -5], [90, 5], [-90, 5]], holes: [] },
      { outer: makeSq(-25, 22, 1.17), holes: [] },
    ],
    waterLines: [],
    greenPolys: [],
    trees: [],
    roads: [],
    bridgePolys: [],
    buildings: [
      { id: 501, outer: makeSq(25, 22, 7), holes: [], h: 14, roof: 'hipped', roofH: 3 },
      { id: 502, outer: makeSq(-20, -24, 6), holes: [], h: 18, roof: 'gabled', roofH: 3 },
    ],
  };
  const coastalBaseState = {
    plaqueText: 'COASTAL_FLAT', bedSizeMm: 145, totalHeightMm: 79, tileCols: 1, tileRows: 1,
    hollowWallMm: 1.8, waterCutout: true, showFrame: false, exportFrame: false,
    isResin: true, zScale: 1.0, terrainScale: 1.0,
  };
  const coastalSolidBuilt = buildComplete3DModel(coastalFlatScene, { ...coastalBaseState, hollowBase: false });
  const coastalHollowBuilt = buildComplete3DModel(coastalFlatScene, { ...coastalBaseState, hollowBase: true });
  const cpm = coastalHollowBuilt.printMetrics;
  assert.equal(cpm.openEdgesCount, 0);
  assert.equal(cpm.nonManifoldEdgesCount, 0);
  assert.equal(cpm.floatingBuildingsCount, 0);
  assert.ok(cpm.embossMetrics.engravedTiles >= 1);
  assert.ok(cpm.embossMetrics.strokeWidthMm >= 0.70, `strokeWidthMm=${cpm.embossMetrics.strokeWidthMm}`);
  assert.ok(cpm.embossMetrics.carveDepthMm >= 0.65, `carveDepthMm=${cpm.embossMetrics.carveDepthMm}`);
  assert.ok(cpm.embossMetrics.minRoofClearanceMm >= 0.75, `minRoofClearanceMm=${cpm.embossMetrics.minRoofClearanceMm}`);

  const solidBytes = stlMod.buildBinarySTLBytes({ ...coastalBaseState, hollowBase: false, layerMeshes: coastalSolidBuilt.meshes }, 'all', 0);
  const hollowBytes = stlMod.buildBinarySTLBytes({ ...coastalBaseState, hollowBase: true, layerMeshes: coastalHollowBuilt.meshes }, 'all', 0);
  const hollowStlAudit = parseAndAuditRawStlBytes(hollowBytes);
  assert.equal(hollowStlAudit.openEdges, 0, `coastal hollow open=${hollowStlAudit.openEdges}`);
  assert.equal(hollowStlAudit.nonManifoldEdges, 0, `coastal hollow nm=${hollowStlAudit.nonManifoldEdges}`);
  assert.equal(hollowStlAudit.sameDirDupEdges, 0, `coastal hollow dup=${hollowStlAudit.sameDirDupEdges}`);
  assert.equal(hollowStlAudit.degenerateTris, 0, `coastal hollow degen=${hollowStlAudit.degenerateTris}`);

  const solidSlice015 = auditRawStlSliceRasterCavities(solidBytes, [0.15], 0.25)[0];
  assert.equal(solidSlice015.sealedCavitiesGe2Mm2, 0, `Expected 0 sealed cavities >= 2.0 mm2 in solid coastal tile at Z=0.15mm, got ${solidSlice015.sealedCavitiesGe2Mm2}`);
  const hollowSlices = auditRawStlSliceRasterCavities(hollowBytes, [0.15, 0.55, 0.95, 1.15], 0.25);
  const areaReduction = (solidSlice015.areaMm2 - hollowSlices[0].areaMm2) / solidSlice015.areaMm2;
  assert.ok(areaReduction >= 0.25, `Expected Z=0.15mm area reduction >= 25%, got ${(areaReduction * 100).toFixed(1)}% (${solidSlice015.areaMm2.toFixed(1)} -> ${hollowSlices[0].areaMm2.toFixed(1)} mm2)`);
  for (const sl of hollowSlices) {
    assert.equal(sl.sealedCavitiesGe2Mm2, 0, `Expected 0 sealed cavities >= 2.0 mm2 at Z=${sl.zMm}mm, got ${sl.sealedCavitiesGe2Mm2} (max=${sl.maxSealedCavityMm2.toFixed(2)} mm2)`);
  }
  console.log(`  PASS: 145x79mm coastal STL open=0 nm=0 degen=0 dup=0, Z=0.15 area -${(areaReduction * 100).toFixed(1)}% (${solidSlice015.areaMm2.toFixed(1)}->${hollowSlices[0].areaMm2.toFixed(1)}mm2), 0 sealed cavities >=2mm2 at Z=[0.15,0.55,0.95,1.15]`);

  // 6. Post-union MSLA print guard: capillary pockets, narrow-gap courtyards, sloped ramps & building safety
  console.log('[6/6] Post-Union MSLA Guard: Capillary Pocket + Narrow-Gap Courtyard + Sloped Ramp + Building Safety');
  assert.equal(PRINT_PHYSICS_CONFIG.roadHeightMm, 0.567, 'roadHeightMm must stay 0.567');
  const bayWithCapillaryPocket = [
    [-90, -52], [90, -52], [90, -32],
    [-54.43, -32], [-54.43, -29], [-51, -29], [-51, -23], [-58, -23], [-58, -29], [-54.57, -29], [-54.57, -32],
    [-90, -32],
  ];
  const guardScene = {
    spanMeters: 700,
    dem: {
      grid: [
        [0.25, 0.25, 0.25, 0.25, 0.25],
        [0.25, 0.25, 0.25, 0.25, 0.25],
        [0.25, 0.25, 0.25, 0.25, 0.25],
        [0.25, 0.25, 0.25, 0.25, 0.25],
        [0.25, 0.25, 0.25, 0.25, 0.25],
      ],
      minElev: -0.25,
      maxElev: 0.25,
    },
    waterPolys: [
      { outer: bayWithCapillaryPocket, holes: [] },
      { outer: [[73.0, 4], [95, 4], [95, 32], [73.0, 32]], holes: [] },
    ],
    waterLines: [],
    greenPolys: [],
    trees: [],
    roads: [
      { pts: [[-18.56, -2], [-10, -2], [-10, 16], [-30, 16], [-30, -2], [-21.10, -2]], width: 2.4, layer: 0 },
      { pts: [[38.0, 39.5], [56.0, 39.5]], width: 2.0, layer: 0 },
      { pts: [[46.5, 34.0], [46.5, 52.0]], width: 2.4, isBridge: true, isPath: true, layer: 2, bridgeStructure: 'truss', clearanceM: 8.0 },
      { pts: [[71.5, 18], [92.0, 18]], width: 2.4, isBridge: true, isPath: true, layer: 2, bridgeStructure: 'truss', clearanceM: 7.5 },
    ],
    bridgePolys: [],
    buildings: [
      { id: 601, outer: makeSq(-20, 20.5, 3.2), holes: [], h: 24, roof: 'hipped', roofH: 4 },
    ],
  };
  const guardState = {
    plaqueText: 'MSLA_GUARD', bedSizeMm: 145, totalHeightMm: 79, tileCols: 1, tileRows: 1, cropRatio: 1.0,
    hollowBase: true, hollowWallMm: 1.8, waterCutout: true, showFrame: false, exportFrame: false,
    isResin: true, zScale: 1.0, terrainScale: 1.0,
  };
  const guardSpec = resolveSceneScaleAndSpec(guardState, null);
  const guardBuilt = buildComplete3DModel(guardScene, guardState);
  let preBldMaxZMm = 0;
  for (const t of guardBuilt.meshes.buildings) {
    const cx = (t.v0[0] + t.v1[0] + t.v2[0]) / 3;
    const cy = (t.v0[1] + t.v1[1] + t.v2[1]) / 3;
    if (cx >= -23.3 && cx <= -16.7 && cy >= 17.2 && cy <= 23.8) {
      preBldMaxZMm = Math.max(preBldMaxZMm, t.v0[2] * guardSpec.scaleMm, t.v1[2] * guardSpec.scaleMm, t.v2[2] * guardSpec.scaleMm);
    }
  }
  assert.ok(preBldMaxZMm > 5.0, `Expected pre-export adjacent building height > 5mm, got ${preBldMaxZMm}`);
  let preBridgeMaxX = -Infinity;
  let preRampMinZMm = Infinity;
  let preRampMaxZMm = -Infinity;
  for (const t of guardBuilt.meshes.roads) {
    for (const p of [t.v0, t.v1, t.v2]) {
      if (p[0] > 70 && t.n && t.n[2] < -0.80 && p[2] * guardSpec.scaleMm > 2.35) {
        if (p[0] > preBridgeMaxX) preBridgeMaxX = p[0];
        preRampMinZMm = Math.min(preRampMinZMm, p[2] * guardSpec.scaleMm);
        preRampMaxZMm = Math.max(preRampMaxZMm, p[2] * guardSpec.scaleMm);
      }
    }
  }
  assert.ok(preBridgeMaxX >= guardSpec.halfW - 0.1, `Expected border-clipped sloped ramp reaching halfW, got maxX=${preBridgeMaxX}`);
  assert.ok(preRampMinZMm <= 2.65 && preRampMaxZMm >= 3.70, `Expected sloped ramp 2.40..3.70+ mm, got ${preRampMinZMm.toFixed(2)}..${preRampMaxZMm.toFixed(2)}`);

  // Inject a 0.25 mm (< 0.44 mm) hairline wall directly under the sloped ramp to prove structural opening ignores slivers.
  const mfGuard = coreMod.getManifoldLib();
  const hx0 = (138.83 / guardSpec.scaleMm) - guardSpec.halfW;
  const hx1 = hx0 + (0.25 / guardSpec.scaleMm);
  const hairlineWall = coreMod.boxManifoldFromBounds(mfGuard, hx0, hx1, 17.0, 19.0, 0.0, 4.3 / guardSpec.scaleMm);
  assert.ok(hairlineWall && hairlineWall.numTri() > 0, 'Expected hairline wall manifold');
  coreMod.appendManifoldToTriangles(hairlineWall, guardBuilt.meshes.buildings, 5, 602, 0, 99);
  coreMod.safeDeleteManifold(hairlineWall);

  const guardBytes = stlMod.buildBinarySTLBytes({ ...guardState, layerMeshes: guardBuilt.meshes }, 'all', 0);
  const guardStlAudit = parseAndAuditRawStlBytes(guardBytes);
  assert.equal(guardStlAudit.openEdges, 0, `guard STL open=${guardStlAudit.openEdges}`);
  assert.equal(guardStlAudit.nonManifoldEdges, 0, `guard STL nm=${guardStlAudit.nonManifoldEdges}`);
  assert.equal(guardStlAudit.sameDirDupEdges, 0, `guard STL dup=${guardStlAudit.sameDirDupEdges}`);
  assert.equal(guardStlAudit.degenerateTris, 0, `guard STL degen=${guardStlAudit.degenerateTris}`);
  assert.ok(guardStlAudit.spanX <= 145.05 && guardStlAudit.spanY <= 79.05, `Expected guard STL within 145x79mm bounds, got ${guardStlAudit.spanX.toFixed(2)}x${guardStlAudit.spanY.toFixed(2)}`);

  const guardCavSlices025 = auditRawStlSliceRasterCavities(guardBytes, [0.15, 0.55, 0.95, 1.15, 2.65, 2.90], 0.25);
  const guardCavSlices030 = auditRawStlSliceRasterCavities(guardBytes, [1.40, 1.65, 1.90, 2.15, 2.65, 2.90], 0.30);
  for (const sl of guardCavSlices025) {
    if (sl.zMm <= 1.20) {
      assert.equal(sl.sealedCavitiesGe2Mm2, 0, `Guard Z=${sl.zMm}mm cavity >=2mm2: ${sl.sealedCavitiesGe2Mm2}`);
    } else {
      assert.ok(sl.maxSealedCavityMm2 < 75.0, `Expected 0 courtyards >= 75 mm2 at Z=${sl.zMm}mm (0.25mm grid), got max=${sl.maxSealedCavityMm2.toFixed(2)} mm2`);
    }
  }
  for (const sl of guardCavSlices030) {
    if (sl.zMm <= 2.20) {
      assert.equal(sl.sealedCavitiesGe2Mm2, 0, `Guard capillary Z=${sl.zMm}mm cavity >=2mm2: ${sl.sealedCavitiesGe2Mm2}`);
    } else {
      assert.ok(sl.maxSealedCavityMm2 < 75.0, `Expected 0 courtyards >= 75 mm2 at Z=${sl.zMm}mm (0.30mm grid), got max=${sl.maxSealedCavityMm2.toFixed(2)} mm2`);
    }
  }

  const overhangAudit = auditRawStlOverhangsVal04(guardBytes);
  assert.ok(overhangAudit.maxHalfSpanMm <= 2.2, `Expected sloped ramp VAL-04 half-span <= 2.2 mm, got ${overhangAudit.maxHalfSpanMm.toFixed(2)} mm`);

  const bldX0 = (-23.1 + guardSpec.halfW) * guardSpec.scaleMm;
  const bldX1 = (-16.9 + guardSpec.halfW) * guardSpec.scaleMm;
  const bldY0 = (17.4 + guardSpec.halfH) * guardSpec.scaleMm;
  const bldY1 = (23.6 + guardSpec.halfH) * guardSpec.scaleMm;
  const gView = new DataView(guardBytes.buffer, guardBytes.byteOffset, guardBytes.byteLength);
  const gNTris = gView.getUint32(80, true);
  let postBldMaxZMm = 0;
  let postBldInteriorTris = 0;
  for (let i = 0; i < gNTris; i++) {
    const base = 84 + i * 50;
    let sx = 0, sy = 0, maxTriZ = 0;
    for (let v = 0; v < 3; v++) {
      const vo = base + 12 + v * 12;
      const vx = gView.getFloat32(vo, true);
      const vy = gView.getFloat32(vo + 4, true);
      const vz = gView.getFloat32(vo + 8, true);
      sx += vx; sy += vy;
      if (vz > maxTriZ) maxTriZ = vz;
    }
    const cx = sx / 3, cy = sy / 3;
    if (cx >= bldX0 && cx <= bldX1 && cy >= bldY0 && cy <= bldY1) {
      postBldInteriorTris++;
      if (maxTriZ > postBldMaxZMm) postBldMaxZMm = maxTriZ;
    }
  }
  assert.ok(postBldInteriorTris >= 8, `Expected adjacent building tris >= 8, got ${postBldInteriorTris}`);
  assert.ok(Math.abs(postBldMaxZMm - preBldMaxZMm) <= 0.05, `Expected building full height preserved (${preBldMaxZMm.toFixed(2)} -> ${postBldMaxZMm.toFixed(2)} mm)`);
  console.log(`  PASS: 145x79mm MSLA guard open=0 nm=0 degen=0, capillary Z=[0.15..2.15] cav=0, courtyard Z=[2.65,2.90] maxCav=${Math.max(guardCavSlices030[4].maxSealedCavityMm2, guardCavSlices030[5].maxSealedCavityMm2).toFixed(1)}mm2 (<75), sloped ramp overhang=${overhangAudit.maxHalfSpanMm.toFixed(2)}mm (<=2.2), bldZ=${postBldMaxZMm.toFixed(2)}mm`);

  // 7. Solid tunnel-free 4.0 mm rigid base on A4 Passe-Partout 120x170 mm (1x3 = 3x 120x56.67 mm)
  console.log('[7/7] Solid Tunnel-Free 4.0 mm Rigid Base (A4 120x170 mm, 1x3 = 3x 120x56.67 mm)');
  const a4SolidScene = {
    spanMeters: 700,
    dem: {
      grid: [
        [0.1, 0.1, 0.1, 0.1],
        [0.1, 0.1, 0.1, 0.1],
        [0.1, 0.1, 0.1, 0.1],
        [0.1, 0.1, 0.1, 0.1],
      ],
      minElev: 0.1,
      maxElev: 0.1,
    },
    waterPolys: [
      { outer: [[-90, -90], [-42, -90], [-42, 90], [-90, 90]], holes: [] },
    ],
    waterLines: [],
    greenPolys: [],
    trees: [],
    roads: [{ pts: [[-10, -70], [-10, 70]], width: 4.0, layer: 0 }],
    bridgePolys: [],
    buildings: [
      { id: 701, outer: makeSq(15, 45, 8), holes: [], h: 22, roof: 'flat', roofH: 0 },
      { id: 702, outer: makeSq(15, 0, 8), holes: [], h: 35, roof: 'flat', roofH: 0 },
      { id: 703, outer: makeSq(15, -45, 8), holes: [], h: 28, roof: 'flat', roofH: 0 },
    ],
  };
  const a4SolidState = {
    plaqueText: 'A4_SOLID_TEST',
    bedSizeMm: 120,
    totalHeightMm: 170,
    tileCols: 1,
    tileRows: 3,
    kerfMm: 0.0,
    bedSafeMarginMm: 4.0,
    hollowBase: true,
    solidBaseNoTunnels: true,
    baseHeightMm: 4.0,
    waterCutout: true,
    showFrame: false,
    exportFrame: false,
    isResin: true,
    zScale: 1.0,
    terrainScale: 1.0,
    cropRatio: 1.0,
  };
  const a4Built = buildComplete3DModel(a4SolidScene, a4SolidState);
  assert.equal(a4Built.printMetrics.openEdgesCount, 0);
  assert.equal(a4Built.printMetrics.nonManifoldEdgesCount, 0);
  assert.equal(a4Built.printMetrics.hollowChambersKept, 0, 'solidBaseNoTunnels must not carve hollow chambers');
  assert.equal(a4Built.printMetrics.drainCount, 0, 'solidBaseNoTunnels must not carve side drains');
  assert.equal(a4Built.printMetrics.embossMetrics.engravedTiles, 0, 'solidBaseNoTunnels skips underside ID emboss');

  const expectedTileHMm = 170.0 / 3.0;
  let sumSpanYMm = 0;
  for (const tid of [0, 1, 2]) {
    const tBytes = stlMod.buildBinarySTLBytes({ ...a4SolidState, layerMeshes: a4Built.meshes }, 'all', tid);
    const tAudit = parseAndAuditRawStlBytes(tBytes);
    assert.equal(tAudit.openEdges, 0, `A4 T${tid} open=${tAudit.openEdges}`);
    assert.equal(tAudit.nonManifoldEdges, 0, `A4 T${tid} nm=${tAudit.nonManifoldEdges}`);
    assert.equal(tAudit.sameDirDupEdges, 0, `A4 T${tid} dup=${tAudit.sameDirDupEdges}`);
    assert.equal(tAudit.degenerateTris, 0, `A4 T${tid} degen=${tAudit.degenerateTris}`);
    assert.equal(tAudit.components, 1, `A4 T${tid} expected single shell, got ${tAudit.components}`);
    assert.ok(Math.abs(tAudit.spanY - expectedTileHMm) <= 0.03, `A4 T${tid} expected spanY=${expectedTileHMm.toFixed(2)} mm, got ${tAudit.spanY.toFixed(3)}`);
    assert.ok(tAudit.spanX <= 120.02, `A4 T${tid} expected spanX<=120.02 mm, got ${tAudit.spanX.toFixed(3)}`);
    sumSpanYMm += tAudit.spanY;

    // Verify solid upper slab Z=2.00..3.85 mm AND underside Z=0..1.50 mm stress-relief + DFM-06 chamfer
    const baseSlices = auditRawStlSliceRasterCavities(tBytes, [0.15, 0.55, 0.95, 1.15, 2.00, 3.85], 0.30);
    for (const sl of baseSlices) {
      assert.equal(sl.sealedCavitiesGe2Mm2, 0, `A4 T${tid} Z=${sl.zMm}mm must have 0 sealed cavities, got ${sl.sealedCavitiesGe2Mm2}`);
    }
    assert.ok(baseSlices[5].areaMm2 >= 5000.0 && Math.abs(baseSlices[5].areaMm2 - baseSlices[4].areaMm2) / Math.max(1, baseSlices[5].areaMm2) < 0.03, `A4 T${tid} expected constant solid upper slab Z=2.00 vs Z=3.85mm, got ${baseSlices[4].areaMm2.toFixed(1)} vs ${baseSlices[5].areaMm2.toFixed(1)}`);
    assert.ok(baseSlices[0].areaMm2 <= 4500.0 && baseSlices[0].areaMm2 < baseSlices[5].areaMm2 * 0.85, `A4 T${tid} expected underside stress-relief Z=0.15mm <= 4500 mm2 and <85% of Z=3.85mm, got ${baseSlices[0].areaMm2.toFixed(1)} vs ${baseSlices[5].areaMm2.toFixed(1)}`);
  }
  assert.ok(Math.abs(sumSpanYMm - 170.0) <= 0.05, `A4 1x3 sum spanY expected 170.00 mm, got ${sumSpanYMm.toFixed(3)}`);
  console.log('  PASS: A4 120x170 (3x 120x56.67 mm) 4.0 mm solid+underside-relief STLs verified 0-open/0-nm/0-degen/0-cavities/Z0<=4500mm2');

  // 8. Systemic MSLA fixes: ornamental park pools, hidden underside basin vents, tall courtyard archways & narrow coastal strip guard
  console.log('[8/8] Systemic MSLA Fixes: Ornamental Pool + Hero Basin Vent + Tall Courtyard Archway + Narrow Coastal Strip');
  const sysState = {
    plaqueText: 'SYS_MSLA',
    bedSizeMm: 120,
    totalHeightMm: 170,
    tileCols: 1,
    tileRows: 3,
    kerfMm: 0.0,
    bedSafeMarginMm: 4.0,
    hollowBase: true,
    solidBaseNoTunnels: true,
    baseHeightMm: 4.0,
    waterCutout: true,
    showFrame: false,
    exportFrame: false,
    isResin: true,
    zScale: 1.0,
    terrainScale: 1.0,
    cropRatio: 1.0,
  };
  const sysSpec = resolveSceneScaleAndSpec(sysState, null);
  const uPerMm = 1.0 / sysSpec.scaleMm;
  // Middle tile Y spans [-28.33 mm, +28.33 mm]; Top tile Y spans [+28.33 mm, +85.00 mm]
  const sysScene = {
    spanMeters: 1200,
    dem: {
      grid: [
        [0.1, 0.1, 0.1, 0.1],
        [0.1, 0.1, 0.1, 0.1],
        [0.1, 0.1, 0.1, 0.1],
        [0.1, 0.1, 0.1, 0.1],
      ],
      minElev: 0.1,
      maxElev: 0.1,
    },
    waterPolys: [
      // Small ornamental park pond (~1200 m2 < 4500 m2) in Middle tile -> shallow recess >= 2.2 mm
      { outer: makeSq(-35 * uPerMm, 0, 1.7 * uPerMm), holes: [], waterTag: 'pond' },
      // Large enclosed hero lake (~64 mm2, ~6400 m2 >= 4500 m2) in Middle tile -> Z=0 top cutout + hidden underside vent
      { outer: makeSq(-8 * uPerMm, 0, 4.0 * uPerMm), holes: [], waterTag: 'lake' },
      // Tiny near-border pinhole (~4 mm2) 0.25 mm inside Middle tile North seam -> plugged solid without growing bbox
      { outer: makeSq(35 * uPerMm, 26.8 * uPerMm, 1.0 * uPerMm), holes: [], waterTag: 'canal' },
      // Open bay water clipping Top tile to an ~18 mm tall narrow coastal strip (Y=+67..+85 mm)
      { outer: [[-70 * uPerMm, 28 * uPerMm], [70 * uPerMm, 28 * uPerMm], [70 * uPerMm, 67 * uPerMm], [-70 * uPerMm, 67 * uPerMm]], holes: [], waterTag: 'bay' },
    ],
    waterLines: [],
    greenPolys: [],
    trees: [],
    roads: [
      // Elevated truss pier overhanging into bay water on the narrow Top coastal strip
      { pts: [[0, 69 * uPerMm], [0, 56 * uPerMm]], width: 4.5 * uPerMm, isBridge: true, isPath: true, layer: 2, bridgeStructure: 'truss', clearanceM: 7.0 },
    ],
    bridgePolys: [],
    buildings: [
      // Tall 120 m (~12 mm) enclosed courtyard (12x12 mm interior = 144 mm2) on Middle tile
      { id: 801, outer: [[22 * uPerMm, -12 * uPerMm], [38 * uPerMm, -12 * uPerMm], [38 * uPerMm, -10 * uPerMm], [22 * uPerMm, -10 * uPerMm]], holes: [], h: 110, roof: 'flat', roofH: 0 },
      { id: 802, outer: [[22 * uPerMm, 2 * uPerMm], [38 * uPerMm, 2 * uPerMm], [38 * uPerMm, 4 * uPerMm], [22 * uPerMm, 4 * uPerMm]], holes: [], h: 110, roof: 'flat', roofH: 0 },
      { id: 803, outer: [[22 * uPerMm, -12 * uPerMm], [24 * uPerMm, -12 * uPerMm], [24 * uPerMm, 4 * uPerMm], [22 * uPerMm, 4 * uPerMm]], holes: [], h: 110, roof: 'flat', roofH: 0 },
      { id: 804, outer: [[36 * uPerMm, -12 * uPerMm], [38 * uPerMm, -12 * uPerMm], [38 * uPerMm, 4 * uPerMm], [36 * uPerMm, 4 * uPerMm]], holes: [], h: 110, roof: 'flat', roofH: 0 },
    ],
  };
  const sysBuilt = buildComplete3DModel(sysScene, sysState);

  // Check Middle tile (tileId=1): 0 base cavities at Z=0.15..1.15, hero lake still open at Z=3.6, tall courtyard vented at Z=4.5, rooftops intact
  const midBytes = stlMod.buildBinarySTLBytes({ ...sysState, layerMeshes: sysBuilt.meshes }, 'all', 1);
  const midAudit = parseAndAuditRawStlBytes(midBytes);
  assert.equal(midAudit.openEdges, 0, `sys Middle open=${midAudit.openEdges}`);
  assert.equal(midAudit.nonManifoldEdges, 0, `sys Middle nm=${midAudit.nonManifoldEdges}`);
  assert.equal(midAudit.degenerateTris, 0, `sys Middle degen=${midAudit.degenerateTris}`);
  assert.ok(midAudit.spanX <= 120.03 && midAudit.spanY <= expectedTileHMm + 0.03, `sys Middle bbox grew: ${midAudit.spanX.toFixed(2)}x${midAudit.spanY.toFixed(2)}`);
  const midBaseSlices = auditRawStlSliceRasterCavities(midBytes, [0.15, 0.55, 0.95, 1.15, 3.60, 4.50], 0.30);
  for (const sl of midBaseSlices.slice(0, 4)) {
    assert.equal(sl.sealedCavitiesGe2Mm2, 0, `sys Middle Z=${sl.zMm}mm must have 0 sealed cavities, got ${sl.sealedCavitiesGe2Mm2} (max=${sl.maxSealedCavityMm2.toFixed(2)})`);
  }
  // At Z=3.60 mm (above hidden underside gable apex ~2.43 mm), the 64 mm2 hero lake MUST remain an open cutout (>= 40 mm2)
  assert.ok(midBaseSlices[4].maxSealedCavityMm2 >= 40.0, `Expected hero lake open on top at Z=3.60 mm (>=40 mm2), got ${midBaseSlices[4].maxSealedCavityMm2.toFixed(2)}`);
  // At Z=4.50 mm, the 144 mm2 tall-walled courtyard MUST be vented (< 75 mm2 trapped)
  assert.ok(midBaseSlices[5].maxSealedCavityMm2 < 75.0, `Expected tall-walled courtyard vented at Z=4.50 mm (<75 mm2), got ${midBaseSlices[5].maxSealedCavityMm2.toFixed(2)}`);
  // Rooftop height of the 110 m courtyard buildings (~15 mm) MUST remain intact and VAL-04 overhang <= 2.2 mm
  assert.ok(midAudit.maxZ >= 12.0, `Expected courtyard rooftops preserved (maxZ >= 12 mm), got ${midAudit.maxZ.toFixed(2)}`);
  const midOverhang = auditRawStlOverhangsVal04(midBytes);
  assert.ok(midOverhang.maxHalfSpanMm <= 2.2, `Expected sys Middle VAL-04 half-span <= 2.2 mm, got ${midOverhang.maxHalfSpanMm.toFixed(2)}`);

  // Check narrow Top coastal strip (tileId=2, ~18 mm tall in Y < 25 mm): guard MUST run and ground elevated overhang pier
  const topBytes = stlMod.buildBinarySTLBytes({ ...sysState, layerMeshes: sysBuilt.meshes }, 'all', 2);
  const topAudit = parseAndAuditRawStlBytes(topBytes);
  assert.equal(topAudit.openEdges, 0, `sys Top narrow strip open=${topAudit.openEdges}`);
  assert.equal(topAudit.nonManifoldEdges, 0, `sys Top narrow strip nm=${topAudit.nonManifoldEdges}`);
  const topOverhang = auditRawStlOverhangsVal04(topBytes);
  assert.ok(topOverhang.maxHalfSpanMm <= 2.2, `Expected narrow coastal strip VAL-04 <= 2.2 mm, got ${topOverhang.maxHalfSpanMm.toFixed(2)}`);
  console.log(`  PASS: Systemic MSLA fixes verified (Mid Z=0.15..1.15 cav=0, lakeTop=${midBaseSlices[4].maxSealedCavityMm2.toFixed(1)}mm2, courtyardZ4.5=${midBaseSlices[5].maxSealedCavityMm2.toFixed(1)}mm2, maxZ=${midAudit.maxZ.toFixed(1)}mm, TopNarrowVAL04=${topOverhang.maxHalfSpanMm.toFixed(2)}mm)`);

  // -------------------------------------------------------------------------
  // 10. Hollow Lattice Tower Elevated Ring Deck: Zero Center Arch Pipes + VAL-04 Pass
  // -------------------------------------------------------------------------
  console.log('\n[10/10] Lattice Tower Elevated Ring Deck: Zero Center Arch Pipes & VAL-04 Pass');
  const latState = {
    ...sysState,
    tileCols: 1,
    tileRows: 1,
    targetWidthCm: 12.0,
    targetHeightCm: 12.0,
    bedSizeMm: 120.0,
    totalHeightMm: 120.0,
    waterCutout: false,
  };
  const latSpec = resolveSceneScaleAndSpec(latState, null);
  const latU = 1.0 / latSpec.scaleMm;
  const latScene = {
    spanMeters: 780,
    dem: { grid: [[0.1, 0.1], [0.1, 0.1]], minElev: 0.1, maxElev: 0.1 },
    waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [],
    buildings: [
      // 4 inclined perimeter walls forming a hollow 16x16 mm arch frame rising to Z=17 mm
      { id: 9501, groupId: 9500, part: true, outer: [[-8.2 * latU, -8.2 * latU], [8.2 * latU, -8.2 * latU], [8.2 * latU, -6.4 * latU], [-8.2 * latU, -6.4 * latU]], holes: [], h: 58, minH: 0, roof: 'flat', towerConstruction: 'lattice', tags: { 'building:part': 'yes', 'tower:construction': 'lattice', height: '58' } },
      { id: 9502, groupId: 9500, part: true, outer: [[-8.2 * latU, 6.4 * latU], [8.2 * latU, 6.4 * latU], [8.2 * latU, 8.2 * latU], [-8.2 * latU, 8.2 * latU]], holes: [], h: 58, minH: 0, roof: 'flat', towerConstruction: 'lattice', tags: { 'building:part': 'yes', 'tower:construction': 'lattice', height: '58' } },
      { id: 9503, groupId: 9500, part: true, outer: [[-8.2 * latU, -8.2 * latU], [-6.4 * latU, -8.2 * latU], [-6.4 * latU, 8.2 * latU], [-8.2 * latU, 8.2 * latU]], holes: [], h: 58, minH: 0, roof: 'flat', towerConstruction: 'lattice', tags: { 'building:part': 'yes', 'tower:construction': 'lattice', height: '58' } },
      { id: 9504, groupId: 9500, part: true, outer: [[6.4 * latU, -8.2 * latU], [8.2 * latU, -8.2 * latU], [8.2 * latU, 8.2 * latU], [6.4 * latU, 8.2 * latU]], holes: [], h: 58, minH: 0, roof: 'flat', towerConstruction: 'lattice', tags: { 'building:part': 'yes', 'tower:construction': 'lattice', height: '58' } },
      // Hollow 15.2x15.2 mm elevated observation deck ring with 6.2x6.2 mm central cutout (overhangs 3.3 mm inward)
      { id: 9505, groupId: 9500, part: true, outer: makeSq(0, 0, 7.6 * latU), holes: [makeSq(0, 0, 3.1 * latU)], h: 61, minH: 58, roof: 'flat', tags: { 'building:part': 'yes', height: '61', min_height: '58' } },
    ],
  };
  const latBuilt = buildComplete3DModel(latScene, latState);
  const latBytes = stlMod.buildBinarySTLBytes({ ...latState, layerMeshes: latBuilt.meshes }, 'all', 0);
  const latAudit = parseAndAuditRawStlBytes(latBytes);
  assert.equal(latAudit.openEdges, 0, `lattice ring open=${latAudit.openEdges}`);
  assert.equal(latAudit.nonManifoldEdges, 0, `lattice ring nm=${latAudit.nonManifoldEdges}`);
  const latOverhang = auditRawStlOverhangsVal04(latBytes);
  assert.ok(latOverhang.maxHalfSpanMm <= 2.2, `Expected lattice ring VAL-04 <= 2.2 mm, got ${latOverhang.maxHalfSpanMm.toFixed(2)}`);
  // Verify the central 8x8 mm hollow void at Z=9.0 mm (well below soffit) has ZERO vertical pipes!
  const latView = new DataView(latBytes.buffer, latBytes.byteOffset, latBytes.byteLength);
  const latN = latView.getUint32(80, true);
  let centerVoidTris = 0;
  for (let i = 0; i < latN; i++) {
    const o = 84 + i * 50;
    const x0 = latView.getFloat32(o + 12, true), y0 = latView.getFloat32(o + 16, true), z0 = latView.getFloat32(o + 20, true);
    const x1 = latView.getFloat32(o + 24, true), y1 = latView.getFloat32(o + 28, true), z1 = latView.getFloat32(o + 32, true);
    const x2 = latView.getFloat32(o + 36, true), y2 = latView.getFloat32(o + 40, true), z2 = latView.getFloat32(o + 44, true);
    const zMinT = Math.min(z0, z1, z2), zMaxT = Math.max(z0, z1, z2);
    if (zMinT < 9.0 && zMaxT > 9.0) {
      const cx = (x0 + x1 + x2) / 3 - 60.0;
      const cy = (y0 + y1 + y2) / 3 - 60.0;
      if (Math.abs(cx) < 4.5 && Math.abs(cy) < 4.5) centerVoidTris++;
    }
  }
  assert.equal(centerVoidTris, 0, `Expected 0 overhang pipe triangles inside lattice center void at Z=9mm, got ${centerVoidTris}`);
  console.log(`  PASS: Lattice ring center void clean at Z=9mm (centerVoidTris=0, VAL-04=${latOverhang.maxHalfSpanMm.toFixed(2)}mm)`);

  console.log(`\nETAP 6 AUDIT PASSED in ${Date.now() - tStart} ms.`);
}

runAudit().catch(err => { console.error('audit FAILED:', err); process.exit(1); });
