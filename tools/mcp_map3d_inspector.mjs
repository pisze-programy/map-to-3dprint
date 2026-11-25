#!/usr/bin/env node
/**
 * Universal MCP Studio Server & CLI Inspector for Map-to-3DPrint
 *
 * Dual-mode ES module:
 *  - `mcp`: stdio JSON-RPC 2.0 server supporting both `Content-Length` framing
 *           and newline-delimited JSON-RPC framing (zero stdout pollution).
 *  - `render` / `inspect-landmark` / `audit-scene`: headless CLI commands.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __inspectorFile = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__inspectorFile), '..');

const require = createRequire(import.meta.url);
const harness = require('./headless_scene_harness.js');
const renderer = require('./headless_3d_renderer.js');

const {
  loadSceneAndBuildModel,
  computeBBoxFromParams,
  latLonToSceneXY,
  sceneXYToLatLon,
  listCachedScenes,
} = harness;

const {
  computePresetCamera,
  computeFocusCamera,
  renderSceneToPngFile,
  renderContactSheet,
  countLayerTriangles,
} = renderer;

// ============================================================================
// Geometry & Audit Analysis Helpers
// ============================================================================

function computeRingCentroidAndBBox(ring) {
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let sx = 0, sy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const x = p[0], y = p[1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    sx += x;
    sy += y;
  }
  return {
    cx: sx / ring.length,
    cy: sy / ring.length,
    minX, maxX, minY, maxY,
    spanX: maxX - minX,
    spanY: maxY - minY,
  };
}

function computePolygonSignedArea(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p0 = ring[i], p1 = ring[(i + 1) % n];
    a += p0[0] * p1[1] - p1[0] * p0[1];
  }
  return a * 0.5;
}

/**
 * Estimates minimum-area bounding box aspect ratio by projecting onto every edge axis.
 */
function computePolyAspectRatio(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 1.0;
  let bestArea = Infinity;
  let bestAspect = 1.0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-7) continue;
    const ux = dx / len, uy = dy / len;
    const vx = -uy, vy = ux;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let j = 0; j < n; j++) {
      const px = ring[j][0], py = ring[j][1];
      const pu = px * ux + py * uy;
      const pv = px * vx + py * vy;
      if (pu < minU) minU = pu; if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv; if (pv > maxV) maxV = pv;
    }
    const w = Math.max(1e-6, maxU - minU);
    const h = Math.max(1e-6, maxV - minV);
    const area = w * h;
    if (area < bestArea) {
      bestArea = area;
      bestAspect = Math.max(w, h) / Math.min(w, h);
    }
  }
  return bestAspect;
}

function computeConvexHullArea(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const pts = ring.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return Math.abs(computePolygonSignedArea(lower.concat(upper)));
}

function pointInRing2D(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-18) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolyWithHoles2D(px, py, outer, holes) {
  if (!pointInRing2D(px, py, outer)) return false;
  for (const h of (holes || [])) {
    if (h && h.length >= 3 && pointInRing2D(px, py, h)) return false;
  }
  return true;
}

function stripNumericOsmId(idVal) {
  if (idVal === null || idVal === undefined) return null;
  const m = String(idVal).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function buildRawOsmLookup(osmElements) {
  const nodesById = new Map();
  const waysById = new Map();
  const relsById = new Map();
  const byAnyId = new Map();

  for (const el of (osmElements || [])) {
    if (!el) continue;
    if (el.type === 'node') nodesById.set(el.id, el);
    else if (el.type === 'way') {
      waysById.set(el.id, el);
      byAnyId.set(el.id, el);
      byAnyId.set(String(el.id), el);
      byAnyId.set(`way/${el.id}`, el);
      byAnyId.set(`w${el.id}`, el);
    } else if (el.type === 'relation') {
      relsById.set(el.id, el);
      byAnyId.set(el.id, el);
      byAnyId.set(String(el.id), el);
      byAnyId.set(`relation/${el.id}`, el);
      byAnyId.set(`rel/${el.id}`, el);
      byAnyId.set(`r${el.id}`, el);
    }
  }

  function getElementCentroidLatLon(el) {
    if (!el) return null;
    if (el.type === 'node') return [el.lat, el.lon];
    let sLat = 0, sLon = 0, cnt = 0;
    if (el.type === 'way') {
      for (const nid of (el.nodes || [])) {
        const nd = nodesById.get(nid);
        if (nd) { sLat += nd.lat; sLon += nd.lon; cnt++; }
      }
    } else if (el.type === 'relation') {
      for (const mem of (el.members || [])) {
        if (mem.type === 'node') {
          const nd = nodesById.get(mem.ref);
          if (nd) { sLat += nd.lat; sLon += nd.lon; cnt++; }
        } else if (mem.type === 'way') {
          const w = waysById.get(mem.ref);
          if (w) {
            for (const nid of (w.nodes || [])) {
              const nd = nodesById.get(nid);
              if (nd) { sLat += nd.lat; sLon += nd.lon; cnt++; }
            }
          }
        }
      }
    }
    return cnt > 0 ? [sLat / cnt, sLon / cnt] : null;
  }

  return { nodesById, waysById, relsById, byAnyId, getElementCentroidLatLon };
}

function summarizeEmittedByBuildingId(meshes) {
  const byBId = new Map();
  const byShellId = new Map();
  const layers = [meshes?.buildings, meshes?.highlighted];
  for (const layer of layers) {
    if (!layer) continue;
    if (layer instanceof Float32Array) {
      for (let off = 0; off + 26 < layer.length; off += 27) {
        const bid = Math.round(layer[off + 7]);
        if (bid <= 0) continue;
        let rec = byBId.get(bid);
        if (!rec) {
          rec = {
            bId: bid,
            triCount: 0,
            minX: Infinity, maxX: -Infinity,
            minY: Infinity, maxY: -Infinity,
            zMin: Infinity, zMax: -Infinity,
            zLevels: new Set(),
            downwardTopTris: 0,
          };
          byBId.set(bid, rec);
        }
        rec.triCount++;
        const x0 = layer[off], y0 = layer[off + 1], z0 = layer[off + 2];
        const x1 = layer[off + 9], y1 = layer[off + 10], z1 = layer[off + 11];
        const x2 = layer[off + 18], y2 = layer[off + 19], z2 = layer[off + 20];
        const nz = layer[off + 5];
        rec.minX = Math.min(rec.minX, x0, x1, x2);
        rec.maxX = Math.max(rec.maxX, x0, x1, x2);
        rec.minY = Math.min(rec.minY, y0, y1, y2);
        rec.maxY = Math.max(rec.maxY, y0, y1, y2);
        rec.zMin = Math.min(rec.zMin, z0, z1, z2);
        rec.zMax = Math.max(rec.zMax, z0, z1, z2);
        if (nz > 0.05) {
          rec.zLevels.add(Math.round(z0 * 100) / 100);
          rec.zLevels.add(Math.round(z1 * 100) / 100);
          rec.zLevels.add(Math.round(z2 * 100) / 100);
        }
        if (nz < -0.2 && Math.min(z0, z1, z2) > rec.zMin + 0.5) {
          rec.downwardTopTris++;
        }
      }
    } else if (Array.isArray(layer)) {
      for (let i = 0; i < layer.length; i++) {
        const t = layer[i];
        if (!t) continue;
        const bid = Math.round(t.buildingId ?? t.bId ?? -1);
        const v0 = t.v0, v1 = t.v1, v2 = t.v2;
        const nz = (t.n && t.n[2]) || 0;
        const triMinZ = Math.min(v0[2], v1[2], v2[2]);
        const triMaxZ = Math.max(v0[2], v1[2], v2[2]);

        if (bid > 0) {
          let rec = byBId.get(bid);
          if (!rec) {
            rec = {
              bId: bid,
              triCount: 0,
              minX: Infinity, maxX: -Infinity,
              minY: Infinity, maxY: -Infinity,
              zMin: Infinity, zMax: -Infinity,
              zLevels: new Set(),
              downwardTopTris: 0,
            };
            byBId.set(bid, rec);
          }
          rec.triCount++;
          rec.minX = Math.min(rec.minX, v0[0], v1[0], v2[0]);
          rec.maxX = Math.max(rec.maxX, v0[0], v1[0], v2[0]);
          rec.minY = Math.min(rec.minY, v0[1], v1[1], v2[1]);
          rec.maxY = Math.max(rec.maxY, v0[1], v1[1], v2[1]);
          if (triMinZ < rec.zMin) rec.zMin = triMinZ;
          if (triMaxZ > rec.zMax) rec.zMax = triMaxZ;
          if (nz > 0.05) {
            rec.zLevels.add(Math.round(v0[2] * 100) / 100);
            rec.zLevels.add(Math.round(v1[2] * 100) / 100);
            rec.zLevels.add(Math.round(v2[2] * 100) / 100);
          }
          if (nz < -0.2 && triMinZ > rec.zMin + 0.5) {
            rec.downwardTopTris++;
          }
        }

        const sid = (t.shellId !== undefined && t.shellId !== null && t.shellId !== 0) ? t.shellId : null;
        if (sid !== null) {
          let sh = byShellId.get(sid);
          if (!sh) {
            sh = {
              shellId: sid,
              triCount: 0,
              zMin: Infinity,
              zMax: -Infinity,
              zLevels: new Set(),
              invertedRoofTris: 0,
              cliffRoofTris: 0,
              _tris: [],
            };
            byShellId.set(sid, sh);
          }
          sh.triCount++;
          if (triMinZ < sh.zMin) sh.zMin = triMinZ;
          if (triMaxZ > sh.zMax) sh.zMax = triMaxZ;
          if (nz > 0.05) {
            sh.zLevels.add(Math.round(v0[2] * 100) / 100);
            sh.zLevels.add(Math.round(v1[2] * 100) / 100);
            sh.zLevels.add(Math.round(v2[2] * 100) / 100);
          }
          if (Math.abs(nz) >= 1e-3) {
            sh._tris.push({ nz, minZ: triMinZ, maxZ: triMaxZ });
          }
        }
      }
    }
  }

  for (const sh of byShellId.values()) {
    for (let ti = 0; ti < sh._tris.length; ti++) {
      const tri = sh._tris[ti];
      const zSpan = tri.maxZ - tri.minZ;
      // Ignore flat bottom caps (ground nz = -1 and elevated tagElevatedBottom nz = -0.49)
      if (zSpan < 1e-4 && tri.nz < -0.4) continue;
      // Ignore interior relief-chimney cones recessed well below roof peak and above base
      if (tri.nz < -0.02 && tri.maxZ < sh.zMax - 0.12 && tri.minZ > sh.zMin + 0.04) continue;
      if (tri.nz < -0.05) {
        sh.invertedRoofTris++;
      } else if (tri.nz > 0.02 && tri.nz < 0.14 && zSpan > 0.35) {
        sh.cliffRoofTris++;
      }
    }
    delete sh._tris;
  }

  byBId.byShellId = byShellId;
  return byBId;
}

// ============================================================================
// Core Tool Handlers (Shared by MCP and CLI)
// ============================================================================

function resolveCameraFromSpec(camSpec = {}, { meta, zMax = 18, aspect = 4 / 3, scaleToBed = 1.0 }) {
  if (camSpec && camSpec.focusLatLon && Number.isFinite(camSpec.focusLatLon.lat) && Number.isFinite(camSpec.focusLatLon.lon)) {
    const [tx, ty] = latLonToSceneXY(camSpec.focusLatLon.lat, camSpec.focusLatLon.lon, meta);
    const radiusM = Number(camSpec.focusLatLon.radiusM ?? 150);
    const radiusScene = radiusM * (meta.metersToUnits || (169.2 / (meta.spanMeters || 1200))) * scaleToBed;
    const baseCam = computeFocusCamera({
      target: camSpec.target || [tx, ty, Math.min(10, Math.max(3, zMax * 0.28))],
      radiusScene,
      yawDeg: camSpec.yawDeg ?? -35,
      pitchDeg: camSpec.pitchDeg ?? 35,
      fovDeg: camSpec.fovDeg ?? 34,
      aspect,
    });
    if (Number.isFinite(camSpec.distance)) baseCam.distance = Number(camSpec.distance);
    return baseCam;
  }

  const preset = camSpec?.preset || 'overview';
  const cam = computePresetCamera(preset, {
    halfW: meta.halfW || 84.6,
    halfH: meta.halfH || 84.6,
    zMax,
  });
  if (Number.isFinite(camSpec?.yawDeg)) cam.yaw = (Number(camSpec.yawDeg) * Math.PI) / 180;
  if (Number.isFinite(camSpec?.pitchDeg)) cam.pitch = (Number(camSpec.pitchDeg) * Math.PI) / 180;
  if (Number.isFinite(camSpec?.yaw)) cam.yaw = Number(camSpec.yaw);
  if (Number.isFinite(camSpec?.pitch)) cam.pitch = Number(camSpec.pitch);
  if (Number.isFinite(camSpec?.distance)) cam.distance = Number(camSpec.distance);
  if (Array.isArray(camSpec?.target) && camSpec.target.length >= 3) cam.target = camSpec.target.map(Number);
  if (Number.isFinite(camSpec?.fovDeg)) cam.fovDeg = Number(camSpec.fovDeg);
  return cam;
}

function getEffectiveScaleToBed(meta) {
  const baseCrop = Number(meta._fetchedCropRatio) || 1.0;
  const reqCrop = meta.cropRatio !== undefined ? Number(meta.cropRatio) : baseCrop;
  const effectiveCrop = Math.min(1.0, Math.max(0.35, (reqCrop || 0.88) / baseCrop));
  return 1.0 / effectiveCrop;
}

/**
 * Applies optional framePreset defaults (e.g. 'a4_12x17') without overriding explicit args.
 * @param {object} args
 * @returns {object}
 */
function resolveFramePresetArgs(args = {}) {
  const fp = String(args.formatId || args.framePreset || '').trim();
  const fpLow = fp.toLowerCase();
  let fmtSpec = null;
  try {
    const cat = require('../src/geometry/format_catalog.js');
    if (cat && typeof cat.resolveFormatSpec === 'function') {
      fmtSpec = cat.resolveFormatSpec(fp) || cat.resolveFormatSpec(fpLow);
    }
  } catch (_) {}

  if (!fmtSpec && (
    fpLow === 'a4_12x17' ||
    fpLow === 'a4-12x17' ||
    fpLow === 'mono4_a4_passepartout_12x17_1x3' ||
    fpLow === 'mono4_a4_passepartout_12x17_2x1'
  )) {
    fmtSpec = {
      format_id: 'single_a4_1x3',
      window_mm: [120, 170],
      frame_cols: 1,
      frame_rows: 1,
      tile_cols: 1,
      tile_rows: 3,
      solid_base_no_tunnels: true,
      base_height_mm: 4.0,
      bed_safe_margin_mm: 4.0,
      inter_frame_gap_mm: 0.0,
      is_custom: false,
    };
  }
  if (!fmtSpec || fmtSpec.is_custom) return args;

  const merged = {
    formatId: fmtSpec.format_id,
    frameCols: fmtSpec.frame_cols,
    frameRows: fmtSpec.frame_rows,
    targetWidthCm: fmtSpec.window_mm[0] / 10,
    targetHeightCm: fmtSpec.window_mm[1] / 10,
    tileCols: fmtSpec.tile_cols,
    tileRows: fmtSpec.tile_rows,
    solidBaseNoTunnels: Boolean(fmtSpec.solid_base_no_tunnels),
    baseHeightMm: Number(fmtSpec.base_height_mm ?? 4.0),
    bedSafeMarginMm: Number(fmtSpec.bed_safe_margin_mm ?? 4.0),
    interFrameGapMm: Number(fmtSpec.inter_frame_gap_mm ?? 0.0),
    kerfMm: 0.0,
    hollowBase: true,
    showFrame: false,
  };
  for (const [k, v] of Object.entries(args)) {
    if (v !== undefined) merged[k] = v;
  }
  return merged;
}

function buildLoadOptions(rawArgs = {}, silent = true) {
  const args = resolveFramePresetArgs(rawArgs);
  return {
    snapshotPath: args.snapshotPath,
    saveSnapshotPath: args.saveSnapshotPath,
    scenePath: args.scenePath,
    cachedCity: args.cachedCity,
    scene: args.scene,
    osmElements: args.osmElements,
    title: args.title,
    framePreset: args.framePreset,
    formatId: args.formatId,
    frameCols: args.frameCols,
    frameRows: args.frameRows,
    interFrameGapMm: args.interFrameGapMm,
    lat: args.lat,
    lon: args.lon,
    spanMeters: args.spanMeters,
    rotationDeg: args.rotationDeg ?? 0,
    targetWidthCm: args.targetWidthCm ?? 50,
    targetHeightCm: args.targetHeightCm ?? args.targetWidthCm ?? 50,
    tileCols: args.tileCols ?? 1,
    tileRows: args.tileRows ?? 1,
    kerfMm: args.kerfMm,
    bedSafeMarginMm: args.bedSafeMarginMm,
    palette: args.palette ?? 'white',
    frameStyle: args.frameStyle ?? 'black',
    waterCutout: Boolean(args.waterCutout),
    hollowBase: Boolean(args.hollowBase),
    solidBaseNoTunnels: Boolean(args.solidBaseNoTunnels),
    baseHeightMm: args.baseHeightMm,
    supportlessMode: Boolean(args.supportlessMode),
    isResin: true,
    showFrame: args.showFrame !== false,
    zScale: args.zScale ?? 1.0,
    terrainScale: args.terrainScale ?? 1.0,
    cropRatio: args.cropRatio,
    cropCenterX: args.cropCenterX,
    cropCenterY: args.cropCenterY,
    layerVisible: args.layerVisible,
    sunAngleDeg: args.sunAngleDeg,
    demMode: args.demMode,
    demCacheDir: args.demCacheDir,
    extraDemCacheDirs: args.extraDemCacheDirs,
    offlineFallbackDem: args.offlineFallbackDem !== false,
    offlineOnly: Boolean(args.offlineOnly),
    fast: Boolean(args.fast),
    skipTopologyAudit: Boolean(args.skipTopologyAudit),
    silent,
  };
}

/**
 * Computes exact STL vertex bounds and triangle count from binary STL bytes.
 * @param {Uint8Array} bytes
 * @returns {{triangles:number, minMm:number[], maxMm:number[], spanMm:number[]}}
 */
function measureBinaryStlBytes(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = bytes.byteLength >= 84 ? view.getUint32(80, true) : 0;
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < triangles; i++) {
    const base = 84 + i * 50;
    for (let v = 0; v < 3; v++) {
      const off = base + 12 + v * 12;
      const x = view.getFloat32(off, true);
      const y = view.getFloat32(off + 4, true);
      const z = view.getFloat32(off + 8, true);
      if (x < mn[0]) mn[0] = x;
      if (x > mx[0]) mx[0] = x;
      if (y < mn[1]) mn[1] = y;
      if (y > mx[1]) mx[1] = y;
      if (z < mn[2]) mn[2] = z;
      if (z > mx[2]) mx[2] = z;
    }
  }
  const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0);
  const minMm = mn.map(r3);
  const maxMm = mx.map(r3);
  return {
    triangles,
    minMm,
    maxMm,
    spanMm: [r3(maxMm[0] - minMm[0]), r3(maxMm[1] - minMm[1]), r3(maxMm[2] - minMm[2])],
  };
}

/**
 * Headlessly builds a 3D map model and exports watertight per-tile binary STL files.
 * Supports solidBaseNoTunnels, configurable baseHeightMm, and the a4_12x17 (1x3) preset.
 * @param {object} rawArgs
 * @param {{silent?: boolean}} [opts]
 * @returns {Promise<object>}
 */
async function handleExportMap3DStl(rawArgs = {}, { silent = true } = {}) {
  const args = resolveFramePresetArgs(rawArgs);
  if (!args.outputDir) throw new Error('export_map3d_stl requires outputDir');
  const tStart = Date.now();
  const built = await loadSceneAndBuildModel(buildLoadOptions({
    ...args,
    showFrame: args.showFrame !== undefined ? args.showFrame : false,
  }, silent));
  const { state, meshes, runtime, printMetrics } = built;
  const sb = runtime && runtime.sandbox;
  if (!sb || typeof sb.buildBinarySTLBytes !== 'function') {
    throw new Error('buildBinarySTLBytes is not loaded in headless runtime');
  }

  const exportState = { ...state, layerMeshes: meshes, printMetrics };
  const cols = Math.max(1, state.tileCols | 0);
  const rows = Math.max(1, state.tileRows | 0);
  const tileW = Math.round(state.bedSizeMm / cols);
  const tileH = Math.round(state.totalHeightMm / rows);
  const prefix = String(args.filePrefix || args.title || 'Map3D').replace(/[^A-Za-z0-9_-]+/g, '_');
  const outDir = path.resolve(args.outputDir);
  fs.mkdirSync(outDir, { recursive: true });

  const exportedTiles = [];
  const manifestRecords = [];
  for (let tr = rows - 1; tr >= 0; tr--) {
    const northRow = rows - tr;
    for (let tc = 0; tc < cols; tc++) {
      const tid = tr * cols + tc;
      const bytes = sb.buildBinarySTLBytes(exportState, 'all', tid);
      const posLabel = (cols === 1 && rows === 2)
        ? (tr === 1 ? 'Top' : 'Bottom')
        : (cols === 1 && rows === 3)
          ? (tr === 2 ? 'Top' : (tr === 1 ? 'Middle' : 'Bottom'))
          : `R${northRow}C${tc + 1}`;
      const fileName = `${prefix}_${posLabel}_${tileW}x${tileH}mm.stl`;
      const outPath = path.join(outDir, fileName);
      fs.writeFileSync(outPath, bytes);
      manifestRecords.push({ tileId: tid, fileName, bytes, skippedEmptyWater: false });
      const stats = measureBinaryStlBytes(bytes);
      exportedTiles.push({
        tileId: tid,
        label: `R${northRow}C${tc + 1}`,
        position: posLabel,
        path: outPath,
        bytes: bytes.byteLength,
        ...stats,
      });
    }
  }

  let manifestPath = null;
  if (typeof sb.buildAssemblyManifest === 'function') {
    const manifestObj = sb.buildAssemblyManifest(exportState, manifestRecords, {
      sku_id: args.formatId || exportState.formatId,
      city_slug: args.citySlug || args.title || exportState.plaqueText || prefix,
      dem_mode: exportState.demMode || args.demMode || 'flat',
    });
    manifestPath = path.join(outDir, 'assembly_manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2));
  } else {
    throw new Error('buildAssemblyManifest is not loaded in headless runtime; refusing unvalidated STL export');
  }

  // Zero-bypass automatic VAL-01..14 whole-assembly verification gate
  const validatorScript = path.join(REPO_ROOT, 'calibration', 'validate_assembly.py');
  const valArgs = [validatorScript, manifestPath];
  if (silent) valArgs.push('--quiet');
  const valProc = spawnSync('python3', valArgs, { cwd: REPO_ROOT, encoding: 'utf8' });
  const reportPath = path.join(outDir, 'validation_report.json');
  let valReport = null;
  if (fs.existsSync(reportPath)) {
    try { valReport = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch (_) {}
  }
  if (valProc.status !== 0 || !valReport || valReport.verdict !== 'PASS') {
    const fails = (valReport && Array.isArray(valReport.failures) && valReport.failures.length > 0)
      ? valReport.failures.join(' | ')
      : ((valProc.stderr || valProc.stdout || `exit code ${valProc.status}`).trim());
    throw new Error(`Assembly validation FAILED (VAL-01..14) for ${outDir}: ${fails}`);
  }

  return {
    outputDir: outDir,
    manifestPath,
    reportPath,
    validation: {
      verdict: valReport.verdict,
      blockingFailures: valReport.summary ? valReport.summary.blocking_failures : 0,
      warnings: valReport.summary ? valReport.summary.warnings : 0,
      seamPairsChecked: valReport.summary ? valReport.summary.seam_pairs_checked : 0,
      volumeDiffPct: valReport.summary ? valReport.summary.volume_diff_pct : null,
    },
    frameMm: [state.bedSizeMm, state.totalHeightMm],
    grid: [cols, rows],
    demMode: exportState.demMode || 'flat',
    solidBaseNoTunnels: Boolean(state.solidBaseNoTunnels),
    baseHeightMm: state.baseHeightMm,
    kerfMm: state.kerfMm,
    waterCutout: Boolean(state.waterCutout),
    printMetrics: printMetrics ? {
      isWatertightManifold: printMetrics.isWatertightManifold,
      openEdgesCount: printMetrics.openEdgesCount,
      nonManifoldEdgesCount: printMetrics.nonManifoldEdgesCount,
      floatingBuildingsCount: printMetrics.floatingBuildingsCount,
      maxZMm: printMetrics.maxZMm,
      totalVolumeMl: printMetrics.totalVolumeMl,
    } : null,
    tiles: exportedTiles,
    elapsedMs: Date.now() - tStart,
  };
}

async function handleRenderMap3DView(args = {}, { silent = true } = {}) {
  if (!args.outputPath) throw new Error('render_map3d_view requires outputPath');
  const built = await loadSceneAndBuildModel(buildLoadOptions({ skipTopologyAudit: true, ...args }, silent));
  const width = Math.max(32, Number(args.width ?? 1200) | 0);
  const height = Math.max(32, Number(args.height ?? 900) | 0);
  const ssaa = [1, 2, 4].includes(Number(args.ssaa)) ? Number(args.ssaa) : 2;
  const shadowRes = Number(args.shadowRes ?? 1024);
  const ssaoStrength = Number(args.ssaoStrength ?? 0.30);

  let zMax = 18;
  for (const it of (built.audit.preparedList || [])) {
    if (!it.skip && it.zTop > zMax) zMax = it.zTop;
  }

  const camera = resolveCameraFromSpec(args.camera || {}, {
    meta: built.meta,
    zMax,
    aspect: width / height,
    scaleToBed: getEffectiveScaleToBed(built.meta),
  });

  const out = renderSceneToPngFile({
    meshes: built.meshes,
    state: built.state,
    camera,
    width,
    height,
    ssaa,
    shadowRes,
    ssaoStrength,
    highlightIds: args.highlightIds || null,
    markers: args.markers || null,
    outputPath: args.outputPath,
  });

  return {
    outputPath: out.outputPath,
    width: out.width,
    height: out.height,
    ssaa,
    camera: out.camera,
    triangleCounts: out.triangleCounts,
    renderedTriangles: out.renderedTriangles,
    elevRange: built.meta.elevRange,
    meta: {
      bbox: built.meta.bbox,
      center: built.meta.center,
      spanMeters: built.meta.spanMeters,
      halfW: built.meta.halfW,
      halfH: built.meta.halfH,
      rotationDeg: built.meta.sceneAppliedRotationDeg,
    },
    elapsedMs: out.elapsedMs,
  };
}

async function handleInspectLandmark3D(args = {}, { silent = true } = {}) {
  const tStart = Date.now();
  const focus = args.focus || {};
  const built = await loadSceneAndBuildModel(buildLoadOptions({ skipTopologyAudit: true, ...args }, silent));
  const { scene, meta, audit, meshes, state } = built;

  const osmLookup = buildRawOsmLookup(audit.osmElements);
  const emittedMap = summarizeEmittedByBuildingId(meshes);
  const scaleToBed = getEffectiveScaleToBed(meta);
  const mToU = meta.metersToUnits || (169.2 / Math.max(1, meta.spanMeters || 1200));

  const queryStr = focus.query ? String(focus.query).trim().toLowerCase() : null;
  const focusOsmNum = stripNumericOsmId(focus.osmId);
  const radiusM = Number(focus.radiusM ?? 150);
  const radiusScene = radiusM * mToU * scaleToBed;

  const projectLatLonToBed = (lat, lon) => latLonToSceneXY(lat, lon, meta);

  let fx = null, fy = null;
  if (Number.isFinite(focus.lat) && Number.isFinite(focus.lon)) {
    [fx, fy] = projectLatLonToBed(Number(focus.lat), Number(focus.lon));
  }

  // Fallback focus resolution via query or osmId (preferring building/landmark ways & rels over transit nodes)
  if (fx === null && (queryStr || focusOsmNum !== null)) {
    let bestCand = null;
    let bestScore = -1;
    for (const el of (audit.osmElements || [])) {
      if (!el || !el.tags) continue;
      const matchId = focusOsmNum !== null && el.id === focusOsmNum;
      const matchQ = queryStr && [
        el.tags.name, el.tags.alt_name, el.tags['addr:housename'],
        el.tags.historic, el.tags.amenity, el.tags.building,
      ].some(v => v && String(v).toLowerCase().includes(queryStr));
      if (matchId || matchQ) {
        const ll = osmLookup.getElementCentroidLatLon(el);
        if (!ll) continue;
        let score = el.type === 'node' ? 1 : 10;
        if (el.tags.building || el.tags.type === 'building' || el.tags['building:part']) score += 20;
        if (el.tags.historic || el.tags.amenity === 'place_of_worship') score += 5;
        if (matchId) score += 100;
        if (score > bestScore) {
          bestScore = score;
          bestCand = ll;
        }
      }
    }
    if (bestCand) [fx, fy] = projectLatLonToBed(bestCand[0], bestCand[1]);
  }
  if (fx === null) {
    fx = 0; fy = 0;
  }

  const inRadiusXY = (x, y) => Math.hypot(x - fx, y - fy) <= radiusScene;

  // 1. Match raw OSM elements
  const matchedOsmElements = [];
  const directQueryOsmIds = new Set();
  for (const el of (audit.osmElements || [])) {
    if (!el || !el.tags) continue;
    if (el.type === 'node' && !el.tags.name && !el.tags.historic && !el.tags.amenity) continue;
    const matchId = focusOsmNum !== null && el.id === focusOsmNum;
    const matchQ = queryStr && Object.values(el.tags).some(v => String(v).toLowerCase().includes(queryStr));
    if (matchId || matchQ) {
      directQueryOsmIds.add(el.id);
      if (el.type === 'relation' && Array.isArray(el.members)) {
        for (const mem of el.members) {
          if (mem && (mem.type === 'way' || mem.type === 'relation')) directQueryOsmIds.add(mem.ref);
        }
      }
    }
    let ll = null;
    let scenePt = null;
    if (matchId || matchQ || Number.isFinite(focus.lat)) {
      ll = osmLookup.getElementCentroidLatLon(el);
      if (ll) scenePt = projectLatLonToBed(ll[0], ll[1]);
    }
    const matchDist = scenePt && inRadiusXY(scenePt[0], scenePt[1]);
    if (matchId || matchQ || matchDist) {
      matchedOsmElements.push({
        type: el.type,
        id: el.id,
        tags: el.tags,
        centroidLatLon: ll,
        sceneXY: scenePt,
        distScene: scenePt ? Math.round(Math.hypot(scenePt[0] - fx, scenePt[1] - fy) * 100) / 100 : null,
      });
    }
  }

  // 2. Match scene.buildings (taking scene rotation + toBed into account)
  const halfW = meta.halfW || 84.6;
  const halfH = meta.halfH || 84.6;
  const baseCrop = Number(meta._fetchedCropRatio) || 1.0;
  const reqCrop = state.cropRatio || baseCrop;
  const effCrop = Math.min(1.0, Math.max(0.35, reqCrop / baseCrop));
  const sToBed = 1.0 / effCrop;
  const cropCX = (state.cropCenterX || 0) * halfW;
  const cropCY = (state.cropCenterY || 0) * halfH;
  const ptToBed = (p) => [(p[0] - cropCX) * sToBed, (p[1] - cropCY) * sToBed];

  const matchedSceneBuildings = [];
  const matchedOsmIds = new Set(matchedOsmElements.map(e => e.id));
  const directHighlightIds = new Set();
  const directHighlightGroupIds = new Set();
  for (const b of (scene.buildings || [])) {
    if (!b || !b.outer || b.outer.length < 3) continue;
    const bedOuter = b.outer.map(ptToBed);
    const info = computeRingCentroidAndBBox(bedOuter);
    const numId = stripNumericOsmId(b.osmId ?? b.id);
    const numGrp = stripNumericOsmId(b.groupId);
    const nameStr = String(b.name || '').toLowerCase();
    const matchId = focusOsmNum !== null && (numId === focusOsmNum || numGrp === focusOsmNum);
    const matchQ = queryStr && nameStr.includes(queryStr);
    const matchDirectOsm = (numId !== null && directQueryOsmIds.has(numId)) || (numGrp !== null && directQueryOsmIds.has(numGrp));
    const matchOsmSet = (numId !== null && matchedOsmIds.has(numId)) || (numGrp !== null && matchedOsmIds.has(numGrp));
    const matchDist = inRadiusXY(info.cx, info.cy);

    if (matchId || matchQ || matchDirectOsm) {
      if (b.id !== undefined) directHighlightIds.add(b.id);
      if (b.osmId !== undefined) directHighlightIds.add(String(b.osmId));
      if (b.groupId !== undefined && b.groupId !== null) directHighlightGroupIds.add(b.groupId);
    }

    if (matchId || matchQ || matchOsmSet || matchDist) {
      const src = audit.buildingSourceById.get(b.osmId) || audit.buildingSourceById.get(String(b.osmId));
      matchedSceneBuildings.push({
        id: b.id,
        osmId: b.osmId,
        groupId: b.groupId,
        name: b.name,
        isPart: Boolean(b.isPart),
        h: b.h,
        roofH: b.roofH,
        roof: b.roof,
        roofDir: b.roofDir,
        minH: b.minH,
        heightSource: b.heightSource || null,
        rawTags: src ? src.tags : (numId ? osmLookup.byAnyId.get(numId)?.tags : null) || null,
        bedCentroid: [Math.round(info.cx * 100) / 100, Math.round(info.cy * 100) / 100],
      });
    }
  }

  // 3. Match prepared items + emitted mesh stats
  const matchedIds = new Set(matchedSceneBuildings.map(b => b.id).filter(x => x !== undefined));
  const matchedOsmStrs = new Set(matchedSceneBuildings.map(b => String(b.osmId)));
  const matchedGroupIds = new Set(matchedSceneBuildings.map(b => b.groupId).filter(x => x != null));
  const hasExplicitFilter = Boolean(queryStr || focusOsmNum !== null);
  const matchedPrepared = [];
  const emittedByBuildingId = {};
  const zTops = [];
  const highlightIds = [];

  for (const p of (audit.preparedList || [])) {
    const keyBId = p.pickId ?? p.id;
    const match = matchedIds.has(p.id) || matchedOsmStrs.has(String(p.osmId)) ||
      (p.groupId != null && matchedGroupIds.has(p.groupId));
    if (!match) {
      if (hasExplicitFilter) continue;
      const em = emittedMap.get(keyBId);
      if (em) {
        const cx = (em.minX + em.maxX) * 0.5, cy = (em.minY + em.maxY) * 0.5;
        if (!inRadiusXY(cx, cy)) continue;
      } else {
        continue;
      }
    }
    matchedPrepared.push(p);
    if (!p.skip && Number.isFinite(p.zTop)) zTops.push(p.zTop);
    const em = emittedMap.get(keyBId);
    if (em) {
      const pNumId = stripNumericOsmId(p.osmId ?? p.id);
      const pNumGrp = stripNumericOsmId(p.groupId);
      const isDirect = !hasExplicitFilter ||
        directHighlightIds.has(p.id) ||
        directHighlightIds.has(String(p.osmId)) ||
        (p.groupId != null && directHighlightGroupIds.has(p.groupId)) ||
        (pNumId !== null && directQueryOsmIds.has(pNumId)) ||
        (pNumGrp !== null && directQueryOsmIds.has(pNumGrp));
      if (isDirect) highlightIds.push(keyBId);
      const outKey = String(p.osmId ?? p.id ?? keyBId);
      emittedByBuildingId[outKey] = {
        osmId: p.osmId ?? null,
        pickId: keyBId,
        triCount: em.triCount,
        zMin: Math.round(em.zMin * 1000) / 1000,
        zMax: Math.round(em.zMax * 1000) / 1000,
        bboxXY: [
          Math.round(em.minX * 100) / 100,
          Math.round(em.minY * 100) / 100,
          Math.round(em.maxX * 100) / 100,
          Math.round(em.maxY * 100) / 100,
        ],
      };
    }
  }

  // Pick smart Z target from matched buildings
  zTops.sort((a, b) => a - b);
  const medianTop = zTops.length > 0 ? zTops[Math.floor(zTops.length * 0.65)] : 8.0;
  const tz = Math.max(2.0, Math.min(20.0, medianTop * 0.45));

  let sheetResult = null;
  if (args.outputSheetPath) {
    const width = Math.max(64, Number(args.width ?? 1200) | 0);
    const height = Math.max(64, Number(args.height ?? 900) | 0);
    const ssaa = [1, 2, 4].includes(Number(args.ssaa)) ? Number(args.ssaa) : 2;
    const cellAspect = (width / 2) / (height / 2);
    const target = [fx, fy, tz];
    const focusR = Math.max(4.0, radiusScene);

    const views = [
      { label: 'SE -40deg', camera: computeFocusCamera({ target, radiusScene: focusR, yawDeg: -40, pitchDeg: 32, aspect: cellAspect }) },
      { label: 'SW +40deg', camera: computeFocusCamera({ target, radiusScene: focusR, yawDeg: 40, pitchDeg: 32, aspect: cellAspect }) },
      { label: 'NE +140deg', camera: computeFocusCamera({ target, radiusScene: focusR, yawDeg: 140, pitchDeg: 32, aspect: cellAspect }) },
      { label: 'High Oblique', camera: computeFocusCamera({ target, radiusScene: focusR * 1.1, yawDeg: -35, pitchDeg: 58, aspect: cellAspect }) },
    ];

    sheetResult = renderContactSheet({
      meshes,
      state,
      views,
      width,
      height,
      cols: 2,
      rows: 2,
      ssaa,
      shadowRes: Number(args.shadowRes ?? 1024),
      ssaoStrength: Number(args.ssaoStrength ?? 0.30),
      highlightIds: args.highlightMatched ? highlightIds : null,
      outputPath: args.outputSheetPath,
    });
  }

  return {
    focus: {
      ...focus,
      resolvedSceneXY: [Math.round(fx * 1000) / 1000, Math.round(fy * 1000) / 1000],
      resolvedLatLon: sceneXYToLatLon(fx, fy, meta),
      radiusScene: Math.round(radiusScene * 100) / 100,
    },
    counts: {
      matchedOsmElements: matchedOsmElements.length,
      matchedSceneBuildings: matchedSceneBuildings.length,
      matchedPrepared: matchedPrepared.length,
      emittedBuildingIds: Object.keys(emittedByBuildingId).length,
    },
    matchedOsmElements: matchedOsmElements.slice(0, 60),
    matchedSceneBuildings: matchedSceneBuildings.slice(0, 60),
    matchedPrepared: matchedPrepared.slice(0, 80),
    emittedByBuildingId,
    outputSheetPath: args.outputSheetPath || null,
    sheetElapsedMs: sheetResult ? sheetResult.elapsedMs : 0,
    totalElapsedMs: Date.now() - tStart,
  };
}

const SUPPORTED_ANALYTIC_ROOFS = new Set([
  'flat', 'gabled', 'gable', 'saltbox', 'basilical',
  'hipped', 'hip', 'half-hipped', 'side_hipped',
  'pyramidal', 'pyramid',
  'skillion', 'shed', 'lean_to',
  'round', 'round_gabled', 'barrel',
  'dome', 'onion', 'cone', 'conical',
  'gambrel', 'double_saltbox',
  'mansard', 'quadruple_saltbox',
]);

async function handleAuditSceneFidelity(args = {}, { silent = true } = {}) {
  const tStart = Date.now();
  const maxExamples = Math.max(1, Number(args.maxExamples ?? 25) | 0);
  const built = await loadSceneAndBuildModel(buildLoadOptions(args, silent));
  const { scene, state, meta, audit, meshes, printMetrics } = built;

  const osmLookup = buildRawOsmLookup(audit.osmElements);
  const emittedMap = summarizeEmittedByBuildingId(meshes);

  const halfW = meta.halfW || 84.6;
  const halfH = meta.halfH || 84.6;
  const mToU = meta.metersToUnits || (169.2 / Math.max(1, meta.spanMeters || 1200));
  const baseCrop = Number(meta._fetchedCropRatio) || 1.0;
  const effCrop = Math.min(1.0, Math.max(0.35, (state.cropRatio || baseCrop) / baseCrop));
  const sToBed = 1.0 / effCrop;
  const effMToU = mToU * sToBed;
  const cropCX = (state.cropCenterX || 0) * halfW;
  const cropCY = (state.cropCenterY || 0) * halfH;
  const ptToBed = (p) => [(p[0] - cropCX) * sToBed, (p[1] - cropCY) * sToBed];

  const getTagsForBuilding = (b, prep = null) => {
    const osmId = (b && b.osmId !== undefined) ? b.osmId : (prep && prep.osmId);
    const src = audit.buildingSourceById.get(osmId) || audit.buildingSourceById.get(String(osmId));
    if (src && src.tags) return src.tags;
    const numId = stripNumericOsmId(osmId);
    const raw = (numId !== null && osmLookup.byAnyId.get(numId)) || osmLookup.byAnyId.get(String(osmId));
    return (raw && raw.tags) || {};
  };

  const pushExample = (bucket, ex) => {
    bucket.count++;
    if (bucket.examples.length < maxExamples) bucket.examples.push(ex);
  };

  const roundToDomeTents = { count: 0, examples: [] };
  const flattenedDomesUnderSuperstructure = { count: 0, examples: [] };
  const swallowedInteriorParts = { count: 0, examples: [] };
  const leakedUndergroundOrIndoor = { count: 0, examples: [] };
  const untagged44mTowerSpikes = { count: 0, examples: [] };
  const untaggedHistoricFlatBlocks = { count: 0, examples: [] };
  const crumpledConcaveLod2Roofs = { count: 0, examples: [] };
  const droppedRailwayPlatforms = { count: 0, examples: [] };
  const unsuppressedComplexShells = { count: 0, examples: [] };
  const unsupportedRoofShapesHistogram = {
    totalWithRoofShapeTag: 0,
    rawCounts: {},
    remappedCounts: {},
    unsupportedValues: {},
  };

  const sceneBById = new Map();
  for (const b of (scene.buildings || [])) {
    if (!b) continue;
    if (b.id !== undefined) sceneBById.set(b.id, b);
    if (b.osmId !== undefined) sceneBById.set(String(b.osmId), b);
  }

  const hasAllNegLevel = (lvlStr) => {
    if (lvlStr === undefined || lvlStr === null || lvlStr === '') return false;
    const toks = String(lvlStr).split(';').map(s => parseFloat(s.trim())).filter(Number.isFinite);
    return toks.length > 0 && toks.every(v => v < 0);
  };

  // Inspect prepared items + scene buildings
  const inspectedPrepared = new Set();
  for (const prep of (audit.preparedList || [])) {
    inspectedPrepared.add(prep.id);
    const b = sceneBById.get(prep.id) || sceneBById.get(String(prep.osmId));
    const tags = getTagsForBuilding(b, prep);
    const rawRoof = tags['roof:shape'] ? String(tags['roof:shape']).toLowerCase() : null;
    const outer = b && b.outer ? b.outer.map(ptToBed) : null;
    const name = tags.name || (b && b.name) || `#${prep.osmId ?? prep.id}`;

    // 1. roundToDomeTents
    if (rawRoof === 'round' && (prep.roofShape === 'dome' || prep.preRoofShape === 'dome' || (b && b.roof === 'dome')) && outer) {
      const aspect = computePolyAspectRatio(outer);
      if (aspect > 1.35) {
        pushExample(roundToDomeTents, {
          id: prep.id,
          osmId: prep.osmId,
          name,
          aspect: Math.round(aspect * 100) / 100,
          rawRoofShape: rawRoof,
          mappedRoof: b ? b.roof : null,
          preparedRoofShape: prep.roofShape,
        });
      }
    }

    // 2. flattenedDomesUnderSuperstructure
    const spireSet = new Set(['dome', 'onion', 'cone', 'pyramidal']);
    if (((rawRoof && spireSet.has(rawRoof)) || (b && spireSet.has(b.roof)) || spireSet.has(prep.preRoofShape)) &&
        prep.roofShape === 'flat') {
      pushExample(flattenedDomesUnderSuperstructure, {
        id: prep.id,
        osmId: prep.osmId,
        name,
        rawRoofShape: rawRoof || (b && b.roof) || prep.preRoofShape,
        preRoofShape: prep.preRoofShape,
        finalRoofShape: prep.roofShape,
        flattenedUnderSuperstructure: Boolean(prep.flattenedUnderSuperstructure),
        zTop: prep.zTop,
      });
    }

    // 3. swallowedInteriorParts
    if ((prep.isPart || tags['building:part']) && prep.skip) {
      pushExample(swallowedInteriorParts, {
        id: prep.id,
        osmId: prep.osmId,
        groupId: prep.groupId,
        name,
        skipReason: prep.skipReason || 'cluster_suppressed',
        zBase: prep.zBase,
        zTop: prep.zTop,
        area: Math.round((prep.area || 0) * 100) / 100,
        clusterIds: prep.clusterIds,
      });
    }

    // 4. leakedUndergroundOrIndoor (only active non-skipped buildings/parts!)
    if (!prep.skip) {
      const layerNum = tags.layer !== undefined ? parseFloat(tags.layer) : NaN;
      const bLevelsNum = tags['building:levels'] !== undefined ? parseFloat(tags['building:levels']) : NaN;
      const isIndoor = Boolean(tags.indoor && tags.indoor !== 'no');
      const isNegLevel = hasAllNegLevel(tags.level);
      const isUndergroundLoc = tags.location === 'underground' || tags.building === 'underground' || tags['building:part'] === 'underground';
      const isNegLayerTunnel = Number.isFinite(layerNum) && layerNum < 0 && (isUndergroundLoc || (tags.tunnel && tags.tunnel !== 'no'));
      const isUndergroundElev = tags['building:part'] === 'elevator' && (isNegLevel || (Number.isFinite(layerNum) && layerNum < 0) || isUndergroundLoc);
      const isZeroLevels = Number.isFinite(bLevelsNum) && bLevelsNum === 0;

      if (isIndoor || isNegLevel || isUndergroundLoc || isNegLayerTunnel || isUndergroundElev || isZeroLevels) {
        pushExample(leakedUndergroundOrIndoor, {
          id: prep.id,
          osmId: prep.osmId,
          name,
          tags: {
            building: tags.building,
            'building:part': tags['building:part'],
            indoor: tags.indoor,
            level: tags.level,
            layer: tags.layer,
            location: tags.location,
            tunnel: tags.tunnel,
            'building:levels': tags['building:levels'],
          },
        });
      }
    }

    // 5. untagged44mTowerSpikes
    if (!prep.skip) {
      const isTowerTag = tags.man_made === 'tower' || tags['tower:type'] !== undefined || tags.building === 'tower' || (b && b.tower);
      const hasExplicitH = Boolean(tags.height || tags['building:height'] || tags['building:levels'] || tags['est_height']);
      const hMeters = b ? Number(b.h || 0) : 0;
      const isEstimatedDefault = !hasExplicitH && ((b && b.heightSource === 'estimated_default') || !hasExplicitH);
      if (isTowerTag && isEstimatedDefault && hMeters >= 40 && hMeters <= 46) {
        pushExample(untagged44mTowerSpikes, {
          id: prep.id,
          osmId: prep.osmId,
          name,
          hMeters: Math.round(hMeters * 100) / 100,
          roofH: b ? b.roofH : null,
          heightSource: (b && b.heightSource) || 'estimated_default_inferred',
          man_made: tags.man_made || null,
          towerType: tags['tower:type'] || null,
        });
      }
    }

    // 6. untaggedHistoricFlatBlocks
    if (!prep.skip && !rawRoof && prep.roofShape === 'flat' && !prep.flattenedUnderSuperstructure) {
      const startMatch = tags.start_date ? String(tags.start_date).match(/\b(1[0-9]{3})\b/) : null;
      const startYear = startMatch ? parseInt(startMatch[1], 10) : NaN;
      const histTag = String(tags.historic || '').toLowerCase().trim();
      const hasExplicitHistoric = Boolean(histTag && !['memorial', 'monument', 'archaeological_site', 'ruins'].includes(histTag)) ||
        (Number.isFinite(startYear) && startYear > 0 && startYear < 1945) ||
        tags['building:material'] === 'timber_framing' ||
        /(gothic|baroque|renaissance|romanesque|classicis|medieval|tudor|victorian|wilhelmin|jugendstil|art_nouveau|timber)/i.test(String(tags['building:architecture'] || ''));
      const bVal = String(tags.building || '').toLowerCase().trim();
      const uncondHistoricBld = new Set(['townhall', 'cathedral', 'church', 'chapel', 'castle', 'palace', 'monastery']);
      const ambigCivicBld = new Set(['government', 'civic', 'public']);
      const polyAreaM2 = outer ? Math.abs(computePolygonSignedArea(outer)) / (effMToU * effMToU) : ((prep.area || 0) / (effMToU * effMToU));
      const levelsNum = parseFloat(tags['building:levels']);
      const heightNum = parseFloat(tags.height || tags['building:height']);
      const minHNum = (b && Number.isFinite(b.minH)) ? b.minH : (parseFloat(tags.min_height || tags['building:min_height']) || 0);
      const isModernCivicComplex = ambigCivicBld.has(bVal) && !hasExplicitHistoric &&
        (polyAreaM2 > 1800 || (Number.isFinite(levelsNum) && levelsNum > 7) || (Number.isFinite(heightNum) && heightNum > 32));
      const isElevatedPart = Boolean(prep.isPart || tags['building:part']) && minHNum > 0.5 && !uncondHistoricBld.has(bVal);
      const isHistoric = !isElevatedPart && (
        hasExplicitHistoric ||
        uncondHistoricBld.has(bVal) ||
        (ambigCivicBld.has(bVal) && !isModernCivicComplex) ||
        tags.amenity === 'townhall' ||
        tags.amenity === 'place_of_worship'
      );
      if (isHistoric) {
        pushExample(untaggedHistoricFlatBlocks, {
          id: prep.id,
          osmId: prep.osmId,
          name,
          building: tags.building || null,
          historic: tags.historic || null,
          start_date: tags.start_date || null,
          amenity: tags.amenity || null,
          finalRoofShape: prep.roofShape,
        });
      }
    }

    // 7. crumpledConcaveLod2Roofs
    if (!prep.skip && prep.roofShape && prep.roofShape !== 'flat' && outer) {
      const polyArea = Math.abs(computePolygonSignedArea(outer));
      const hullArea = computeConvexHullArea(outer);
      const convexity = hullArea > 1e-6 ? polyArea / hullArea : 1.0;
      const hasHoles = Boolean(b && b.holes && b.holes.length > 0);
      if (convexity < 0.90 || hasHoles) {
        const sh = (prep.shellId !== undefined && emittedMap.byShellId) ? emittedMap.byShellId.get(prep.shellId) : null;
        const curvedOrSpire = new Set(['dome', 'onion', 'cone', 'pyramidal', 'round', 'gambrel', 'mansard']).has(prep.roofShape);
        if (sh) {
          const spike = Number.isFinite(prep.zTop) ? (sh.zMax - prep.zTop) : 0;
          if (spike > 0.85 || sh.invertedRoofTris > 0 || (!curvedOrSpire && sh.cliffRoofTris > 2)) {
            pushExample(crumpledConcaveLod2Roofs, {
              id: prep.id,
              osmId: prep.osmId,
              shellId: prep.shellId,
              name,
              roofShape: prep.roofShape,
              convexity: Math.round(convexity * 1000) / 1000,
              hasHoles,
              zLevels: sh.zLevels.size,
              zSpike: Math.round(spike * 100) / 100,
              downwardTopTris: sh.invertedRoofTris,
              cliffRoofTris: sh.cliffRoofTris,
            });
          }
        } else {
          const em = emittedMap.get(prep.pickId ?? prep.id);
          const zLevelCount = em ? em.zLevels.size : 0;
          const spike = em && Number.isFinite(prep.zTop) ? (em.zMax - prep.zTop) : 0;
          if (zLevelCount > 25 || spike > 1.2 || (em && em.downwardTopTris > 4)) {
            pushExample(crumpledConcaveLod2Roofs, {
              id: prep.id,
              osmId: prep.osmId,
              name,
              roofShape: prep.roofShape,
              convexity: Math.round(convexity * 1000) / 1000,
              hasHoles,
              zLevels: zLevelCount,
              zSpike: Math.round(spike * 100) / 100,
              downwardTopTris: em ? em.downwardTopTris : 0,
            });
          }
        }
      }
    }
  }

  // Fallback scan over rawBuildingRecords for underground/indoor records skipped earlier if any
  for (const b of (scene.buildings || [])) {
    if (!b || inspectedPrepared.has(b.id)) continue;
    const tags = getTagsForBuilding(b, null);
    const layerNum = tags.layer !== undefined ? parseFloat(tags.layer) : NaN;
    const bLevelsNum = tags['building:levels'] !== undefined ? parseFloat(tags['building:levels']) : NaN;
    const isIndoor = Boolean(tags.indoor && tags.indoor !== 'no');
    const isUnderground = tags.location === 'underground' || tags.building === 'underground' || tags['building:part'] === 'underground';
    if (isIndoor || hasAllNegLevel(tags.level) || isUnderground ||
        (Number.isFinite(layerNum) && layerNum < 0 && (tags.tunnel && tags.tunnel !== 'no')) ||
        (Number.isFinite(bLevelsNum) && bLevelsNum === 0)) {
      pushExample(leakedUndergroundOrIndoor, {
        id: b.id,
        osmId: b.osmId,
        name: b.name || tags.name,
        tags,
      });
    }
  }

  // 8. droppedRailwayPlatforms
  const bboxArr = meta.bbox; // [south, west, north, east]
  const inSceneBBox = (lat, lon) => {
    if (!Array.isArray(bboxArr) || bboxArr.length < 4) return true;
    return lat >= bboxArr[0] && lat <= bboxArr[2] && lon >= bboxArr[1] && lon <= bboxArr[3];
  };
  const extractedRoadCentroids = [];
  for (const rp of (scene.roadPolys || [])) {
    if (!rp || !rp.outer) continue;
    const inf = computeRingCentroidAndBBox(rp.outer.map(ptToBed));
    if (inf) extractedRoadCentroids.push(inf);
  }
  for (const r of (scene.roads || [])) {
    const pts = r && (r.pts || r);
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const inf = computeRingCentroidAndBBox(pts.map(ptToBed));
    if (inf) extractedRoadCentroids.push(inf);
  }
  const activeBuildingCentroids = [];
  for (const b of (scene.buildings || [])) {
    if (!b || !b.outer) continue;
    const inf = computeRingCentroidAndBBox(b.outer.map(ptToBed));
    if (inf) activeBuildingCentroids.push({ ...inf, outer: b.outer.map(ptToBed), holes: (b.holes || []).map(h => h.map(ptToBed)), isPart: Boolean(b.isPart), id: b.id, osmId: b.osmId, name: b.name, groupId: b.groupId });
  }

  for (const el of (audit.osmElements || [])) {
    if (!el || !el.tags || (el.type !== 'way' && el.type !== 'relation')) continue;
    const t = el.tags;
    if (t.railway !== 'platform' && t.public_transport !== 'platform') continue;
    if (t.building || t['building:part']) continue; // covered as building structure
    const pLayer = t.layer !== undefined ? parseFloat(t.layer) : NaN;
    if (t.location === 'underground' || (t.indoor && t.indoor !== 'no') || hasAllNegLevel(t.level) ||
        (Number.isFinite(pLayer) && pLayer < 0) || (t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage')) {
      continue;
    }
    const ll = osmLookup.getElementCentroidLatLon(el);
    if (!ll || !inSceneBBox(ll[0], ll[1])) continue;
    const [bx, by] = latLonToSceneXY(ll[0], ll[1], meta);
    if (Math.abs(bx) > halfW || Math.abs(by) > halfH) continue;

    // Platform is kept only if covered by an extracted roadPoly, bridgePoly, or building
    const nearTol = 3.0 * (meta.metersToUnits || 0.14);
    const matchedRoad = extractedRoadCentroids.some(rc =>
      bx >= rc.minX - nearTol && bx <= rc.maxX + nearTol &&
      by >= rc.minY - nearTol && by <= rc.maxY + nearTol
    );
    const matchedBridge = (scene.bridgePolys || []).some(bp => {
      const inf = bp && bp.outer ? computeRingCentroidAndBBox(bp.outer.map(ptToBed)) : null;
      return inf && bx >= inf.minX - nearTol && bx <= inf.maxX + nearTol && by >= inf.minY - nearTol && by <= inf.maxY + nearTol;
    });
    const matchedBld = osmLookup.byAnyId.has(el.id) && sceneBById.has(String(el.id));
    if (!matchedRoad && !matchedBridge && !matchedBld) {
      pushExample(droppedRailwayPlatforms, {
        type: el.type,
        id: el.id,
        name: t.name || t.ref || `${el.type}/${el.id}`,
        railway: t.railway || null,
        public_transport: t.public_transport || null,
        sceneXY: [Math.round(bx * 100) / 100, Math.round(by * 100) / 100],
      });
    }
  }

  // 9. unsuppressedComplexShells
  const activePreparedIds = new Set((audit.preparedList || []).filter(p => !p.skip).map(p => p.id));
  const activeParts = activeBuildingCentroids.filter(b => b.isPart && activePreparedIds.has(b.id));
  const activeParents = activeBuildingCentroids.filter(b => !b.isPart && activePreparedIds.has(b.id));

  for (const par of activeParents) {
    const overlappingParts = [];
    for (const part of activeParts) {
      if (part.maxX < par.minX || part.minX > par.maxX || part.maxY < par.minY || part.minY > par.maxY) continue;
      if (pointInPolyWithHoles2D(part.cx, part.cy, par.outer, par.holes)) {
        overlappingParts.push(part);
      }
    }
    if (overlappingParts.length > 0) {
      const parArea = Math.abs(computePolygonSignedArea(par.outer));
      let partsAreaSum = 0;
      for (const p of overlappingParts) partsAreaSum += Math.abs(computePolygonSignedArea(p.outer));
      const ratio = parArea > 1e-6 ? (partsAreaSum / parArea) : 0;
      const tags = getTagsForBuilding({ osmId: par.osmId }, null);
      pushExample(unsuppressedComplexShells, {
        id: par.id,
        osmId: par.osmId,
        name: tags.name || par.name,
        overlappingPartsCount: overlappingParts.length,
        childCoverageRatio: Math.round(ratio * 1000) / 1000,
      });
    }
  }

  // 10. unsupportedRoofShapesHistogram
  const rawByOsmId = new Map();
  for (const prep of (audit.preparedList || [])) {
    const nId = stripNumericOsmId(prep.osmId);
    if (nId !== null) rawByOsmId.set(nId, prep);
  }
  for (const el of (audit.osmElements || [])) {
    if (!el || !el.tags || !el.tags['roof:shape']) continue;
    if (el.type !== 'way' && el.type !== 'relation') continue;
    const rawShape = String(el.tags['roof:shape']).trim().toLowerCase();
    unsupportedRoofShapesHistogram.totalWithRoofShapeTag++;
    unsupportedRoofShapesHistogram.rawCounts[rawShape] = (unsupportedRoofShapesHistogram.rawCounts[rawShape] || 0) + 1;

    const prep = rawByOsmId.get(el.id);
    if (prep) {
      const finalShape = prep.roofShape || 'flat';
      if (finalShape !== rawShape) {
        const mapKey = `${rawShape} -> ${finalShape}`;
        unsupportedRoofShapesHistogram.remappedCounts[mapKey] = (unsupportedRoofShapesHistogram.remappedCounts[mapKey] || 0) + 1;
      }
    }
    if (!SUPPORTED_ANALYTIC_ROOFS.has(rawShape)) {
      unsupportedRoofShapesHistogram.unsupportedValues[rawShape] = (unsupportedRoofShapesHistogram.unsupportedValues[rawShape] || 0) + 1;
    }
  }

  const layerTriangleCounts = countLayerTriangles(meshes);
  const pm = printMetrics || {};
  const waterCutoutMetrics = {
    enabled: Boolean(state.waterCutout),
    waterPolyCount: (scene.waterPolys || []).length,
    waterLineCount: (scene.waterLines || []).length,
    waterLayerTris: layerTriangleCounts.water,
    baseLayerTris: layerTriangleCounts.base,
    backingBoardActive: Boolean(state.waterCutout),
    cutoutWindowActive: Boolean(state.waterCutout) && layerTriangleCounts.water === 0,
  };

  const manifoldSummary = {
    isWatertightManifold: Boolean(pm.isWatertightManifold),
    openEdgesCount: pm.openEdgesCount ?? null,
    nonManifoldEdgesCount: pm.nonManifoldEdgesCount ?? null,
    sameDirDupEdgesCount: pm.sameDirDupEdgesCount ?? null,
    unpairedDirEdgesCount: pm.unpairedDirEdgesCount ?? null,
    degenerateTrisCount: pm.degenerateTrisCount ?? null,
    negativeWindingCount: pm.negativeWindingCount ?? null,
    floatingBuildingsCount: pm.floatingBuildingsCount ?? null,
    outOfTileTrisCount: pm.outOfTileTrisCount ?? null,
    totalVolumeMl: pm.totalVolumeMl ?? null,
    totalTriangles: layerTriangleCounts.total,
  };

  const report = {
    meta: {
      bbox: meta.bbox,
      center: meta.center,
      spanMeters: meta.spanMeters,
      rotationDeg: meta.sceneAppliedRotationDeg,
      elevRange: meta.elevRange,
      extractedBuildings: (scene.buildings || []).length,
      preparedItems: (audit.preparedList || []).length,
      elapsedMs: Date.now() - tStart,
    },
    roundToDomeTents,
    flattenedDomesUnderSuperstructure,
    swallowedInteriorParts,
    leakedUndergroundOrIndoor,
    untagged44mTowerSpikes,
    untaggedHistoricFlatBlocks,
    crumpledConcaveLod2Roofs,
    droppedRailwayPlatforms,
    unsuppressedComplexShells,
    unsupportedRoofShapesHistogram,
    waterCutoutMetrics,
    layerTriangleCounts,
    manifoldSummary,
  };

  if (args.outputJsonPath) {
    fs.mkdirSync(path.dirname(path.resolve(args.outputJsonPath)), { recursive: true });
    fs.writeFileSync(args.outputJsonPath, JSON.stringify(report, null, 2));
  }
  return report;
}

// ============================================================================
// MCP Stdio JSON-RPC 2.0 Server (Content-Length + NDJSON Dual Framing)
// ============================================================================

const MCP_TOOLS = [
  {
    name: 'render_map3d_view',
    description: 'Headlessly build and render a 3D map print view to a PNG file matching the WebGL studio shaders, shadows, palette, and frame.',
    inputSchema: {
      type: 'object',
      properties: {
        snapshotPath: { type: 'string' },
        cachedCity: { type: 'string' },
        scenePath: { type: 'string' },
        lat: { type: 'number' },
        lon: { type: 'number' },
        spanMeters: { type: 'number' },
        rotationDeg: { type: 'number' },
        targetWidthCm: { type: 'number' },
        targetHeightCm: { type: 'number' },
        framePreset: { type: 'string' },
        tileCols: { type: 'number' },
        tileRows: { type: 'number' },
        kerfMm: { type: 'number' },
        bedSafeMarginMm: { type: 'number' },
        palette: { type: 'string' },
        frameStyle: { type: 'string' },
        waterCutout: { type: 'boolean' },
        hollowBase: { type: 'boolean' },
        solidBaseNoTunnels: { type: 'boolean' },
        baseHeightMm: { type: 'number' },
        supportlessMode: { type: 'boolean' },
        isResin: { type: 'boolean' },
        showFrame: { type: 'boolean' },
        zScale: { type: 'number' },
        terrainScale: { type: 'number' },
        cropRatio: { type: 'number' },
        layerVisible: { type: 'object' },
        demCacheDir: { type: 'string' },
        offlineFallbackDem: { type: 'boolean' },
        camera: {
          type: 'object',
          properties: {
            preset: { type: 'string' },
            focusLatLon: {
              type: 'object',
              properties: { lat: { type: 'number' }, lon: { type: 'number' }, radiusM: { type: 'number' } },
            },
            yawDeg: { type: 'number' },
            pitchDeg: { type: 'number' },
            distance: { type: 'number' },
            target: { type: 'array', items: { type: 'number' } },
            fovDeg: { type: 'number' },
          },
        },
        width: { type: 'number' },
        height: { type: 'number' },
        ssaa: { type: 'number' },
        shadowRes: { type: 'number' },
        ssaoStrength: { type: 'number' },
        outputPath: { type: 'string' },
      },
      required: ['outputPath'],
    },
  },
  {
    name: 'inspect_landmark_3d',
    description: 'Inspect raw OSM elements, prepared S3DB heights/roofs, and emitted 3D triangles around a landmark, optionally rendering a 4-angle contact sheet.',
    inputSchema: {
      type: 'object',
      properties: {
        snapshotPath: { type: 'string' },
        cachedCity: { type: 'string' },
        scenePath: { type: 'string' },
        lat: { type: 'number' },
        lon: { type: 'number' },
        spanMeters: { type: 'number' },
        rotationDeg: { type: 'number' },
        targetWidthCm: { type: 'number' },
        targetHeightCm: { type: 'number' },
        palette: { type: 'string' },
        frameStyle: { type: 'string' },
        waterCutout: { type: 'boolean' },
        supportlessMode: { type: 'boolean' },
        isResin: { type: 'boolean' },
        zScale: { type: 'number' },
        terrainScale: { type: 'number' },
        demCacheDir: { type: 'string' },
        focus: {
          type: 'object',
          properties: {
            lat: { type: 'number' },
            lon: { type: 'number' },
            radiusM: { type: 'number' },
            query: { type: 'string' },
            osmId: { type: ['string', 'number'] },
          },
        },
        outputSheetPath: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
        ssaa: { type: 'number' },
      },
      required: ['focus'],
    },
  },
  {
    name: 'audit_scene_fidelity',
    description: 'Run systematic architectural, S3DB, GIS, and 2-manifold topology detectors over a scene and return structured issue examples and metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        snapshotPath: { type: 'string' },
        cachedCity: { type: 'string' },
        scenePath: { type: 'string' },
        lat: { type: 'number' },
        lon: { type: 'number' },
        spanMeters: { type: 'number' },
        rotationDeg: { type: 'number' },
        targetWidthCm: { type: 'number' },
        targetHeightCm: { type: 'number' },
        waterCutout: { type: 'boolean' },
        hollowBase: { type: 'boolean' },
        supportlessMode: { type: 'boolean' },
        isResin: { type: 'boolean' },
        zScale: { type: 'number' },
        terrainScale: { type: 'number' },
        demCacheDir: { type: 'string' },
        outputJsonPath: { type: 'string' },
        maxExamples: { type: 'number' },
      },
    },
  },
  {
    name: 'export_map3d_stl',
    description: 'Headlessly build a 3D map model and export watertight binary per-tile .stl files (supports a4_12x17 preset and solidBaseNoTunnels rigid base).',
    inputSchema: {
      type: 'object',
      properties: {
        snapshotPath: { type: 'string' },
        cachedCity: { type: 'string' },
        scenePath: { type: 'string' },
        title: { type: 'string' },
        filePrefix: { type: 'string' },
        outputDir: { type: 'string' },
        framePreset: { type: 'string' },
        lat: { type: 'number' },
        lon: { type: 'number' },
        spanMeters: { type: 'number' },
        rotationDeg: { type: 'number' },
        targetWidthCm: { type: 'number' },
        targetHeightCm: { type: 'number' },
        tileCols: { type: 'number' },
        tileRows: { type: 'number' },
        kerfMm: { type: 'number' },
        bedSafeMarginMm: { type: 'number' },
        waterCutout: { type: 'boolean' },
        hollowBase: { type: 'boolean' },
        solidBaseNoTunnels: { type: 'boolean' },
        baseHeightMm: { type: 'number' },
        supportlessMode: { type: 'boolean' },
        zScale: { type: 'number' },
        terrainScale: { type: 'number' },
        cropRatio: { type: 'number' },
        demCacheDir: { type: 'string' },
        offlineOnly: { type: 'boolean' },
      },
      required: ['outputDir'],
    },
  },
];

function startMcpStdioServer() {
  let detectedFraming = null;
  let rxBuf = Buffer.alloc(0);
  let workQueue = Promise.resolve();
  let stdinEnded = false;

  const sendFrame = (payload, framing = detectedFraming || 'ndjson') => {
    const json = JSON.stringify(payload);
    if (framing === 'lsp') {
      const len = Buffer.byteLength(json, 'utf8');
      process.stdout.write(`Content-Length: ${len}\r\n\r\n${json}`);
    } else {
      process.stdout.write(`${json}\n`);
    }
  };

  const dispatchMessage = async (msg, framing) => {
    if (!msg || typeof msg !== 'object') return;
    const { id, method, params } = msg;
    const isNotification = (id === undefined || id === null);

    try {
      if (method === 'initialize') {
        if (!isNotification) {
          sendFrame({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'map-to-3dprint-inspector', version: '1.0.0' },
            },
          }, framing);
        }
        return;
      }

      if (method === 'notifications/initialized' || method === 'initialized') {
        return;
      }

      if (method === 'ping') {
        if (!isNotification) sendFrame({ jsonrpc: '2.0', id, result: {} }, framing);
        return;
      }

      if (method === 'tools/list') {
        if (!isNotification) sendFrame({ jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } }, framing);
        return;
      }

      if (method === 'tools/call') {
        const name = params && params.name;
        const toolArgs = (params && params.arguments) || {};
        let result;
        if (name === 'render_map3d_view') {
          result = await handleRenderMap3DView(toolArgs, { silent: true });
        } else if (name === 'inspect_landmark_3d') {
          result = await handleInspectLandmark3D(toolArgs, { silent: true });
        } else if (name === 'audit_scene_fidelity') {
          result = await handleAuditSceneFidelity(toolArgs, { silent: true });
        } else if (name === 'export_map3d_stl') {
          result = await handleExportMap3DStl(toolArgs, { silent: true });
        } else {
          throw new Error(`Unknown MCP tool: ${name}`);
        }
        if (!isNotification) {
          sendFrame({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
              isError: false,
            },
          }, framing);
        }
        return;
      }

      if (!isNotification) {
        sendFrame({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        }, framing);
      }
    } catch (err) {
      if (!isNotification) {
        if (method === 'tools/call') {
          sendFrame({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: String(err && err.stack ? err.stack : err) }],
              isError: true,
            },
          }, framing);
        } else {
          sendFrame({
            jsonrpc: '2.0',
            id,
            error: { code: -32000, message: String(err && err.message ? err.message : err) },
          }, framing);
        }
      }
    }
  };

  const enqueueRawMessage = (jsonStr, framing) => {
    let msg;
    try {
      msg = JSON.parse(jsonStr);
    } catch (e) {
      process.stderr.write(`[mcp] JSON parse error: ${e.message}\n`);
      return;
    }
    workQueue = workQueue.then(() => dispatchMessage(msg, framing));
  };

  const drainBuffer = (flushEnd = false) => {
    while (rxBuf.length > 0) {
      // Skip leading CR/LF/whitespace before checking message framing
      let lead = 0;
      while (lead < rxBuf.length && (rxBuf[lead] === 0x0d || rxBuf[lead] === 0x0a || rxBuf[lead] === 0x20 || rxBuf[lead] === 0x09)) {
        lead++;
      }
      if (lead > 0) rxBuf = rxBuf.subarray(lead);
      if (rxBuf.length === 0) break;

      const peek = rxBuf.toString('utf8', 0, Math.min(rxBuf.length, 64));
      if (/^Content-Length:\s*\d+/i.test(peek)) {
        let sepIdx = rxBuf.indexOf('\r\n\r\n');
        let sepLen = 4;
        if (sepIdx < 0) {
          sepIdx = rxBuf.indexOf('\n\n');
          sepLen = 2;
        }
        if (sepIdx < 0) break; // Wait for full headers

        const headerStr = rxBuf.toString('utf8', 0, sepIdx);
        const lenMatch = headerStr.match(/Content-Length:\s*(\d+)/i);
        if (!lenMatch) break;
        const contentLen = parseInt(lenMatch[1], 10);
        const bodyStart = sepIdx + sepLen;
        if (rxBuf.length < bodyStart + contentLen) break; // Wait for full body bytes

        const jsonStr = rxBuf.toString('utf8', bodyStart, bodyStart + contentLen);
        rxBuf = rxBuf.subarray(bodyStart + contentLen);
        if (!detectedFraming) detectedFraming = 'lsp';
        enqueueRawMessage(jsonStr, 'lsp');
      } else {
        const nlIdx = rxBuf.indexOf(0x0a);
        if (nlIdx < 0) {
          if (flushEnd) {
            const line = rxBuf.toString('utf8').trim();
            rxBuf = Buffer.alloc(0);
            if (line) {
              if (!detectedFraming) detectedFraming = 'ndjson';
              enqueueRawMessage(line, 'ndjson');
            }
          }
          break;
        }
        const line = rxBuf.toString('utf8', 0, nlIdx).trim();
        rxBuf = rxBuf.subarray(nlIdx + 1);
        if (line) {
          if (!detectedFraming) detectedFraming = 'ndjson';
          enqueueRawMessage(line, 'ndjson');
        }
      }
    }
  };

  process.stdin.on('data', (chunk) => {
    rxBuf = Buffer.concat([rxBuf, chunk]);
    drainBuffer(false);
  });

  process.stdin.on('end', () => {
    stdinEnded = true;
    drainBuffer(true);
    workQueue.finally(() => {
      if (stdinEnded) process.exit(0);
    });
  });

  process.stdin.resume();
}

// ============================================================================
// CLI Flag Parser & Dispatcher
// ============================================================================

function parseCliArgs(argv) {
  const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : (argv.includes('--help') || argv.includes('-h') ? '--help' : null);
  const rest = cmd && !cmd.startsWith('-') ? argv.slice(1) : argv.slice();
  const flags = {};

  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (!tok.startsWith('--')) continue;
    const eqIdx = tok.indexOf('=');
    let key, val;
    if (eqIdx >= 0) {
      key = tok.slice(2, eqIdx);
      val = tok.slice(eqIdx + 1);
    } else {
      key = tok.slice(2);
      if (key.startsWith('no-')) {
        flags[key.slice(3)] = false;
        continue;
      }
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        val = next;
        i++;
      } else {
        val = true;
      }
    }
    flags[key] = val;
  }
  return { cmd, flags };
}

function mapCommonCliFlags(flags) {
  const num = (k) => (flags[k] !== undefined && flags[k] !== true && flags[k] !== false) ? Number(flags[k]) : undefined;
  const boolOpt = (k) => (flags[k] === undefined ? undefined : (flags[k] === true || flags[k] === 'true'));
  const extraDirs = flags['extra-dem-cache-dir']
    ? String(flags['extra-dem-cache-dir']).split(',').map(s => s.trim()).filter(Boolean)
    : undefined;

  return {
    snapshotPath: flags.snapshot,
    cachedCity: flags['cached-city'],
    scenePath: flags.scene,
    lat: num('lat'),
    lon: num('lon'),
    spanMeters: num('span'),
    rotationDeg: num('rot'),
    framePreset: flags['frame-preset'],
    formatId: flags['format'] || flags['frame-preset'],
    interFrameGapMm: num('inter-frame-gap-mm'),
    targetWidthCm: num('width-cm'),
    targetHeightCm: num('height-cm'),
    tileCols: num('tile-cols'),
    tileRows: num('tile-rows'),
    kerfMm: num('kerf-mm'),
    bedSafeMarginMm: num('bed-margin-mm'),
    title: flags.title,
    palette: flags.palette,
    frameStyle: flags['frame-style'],
    waterCutout: boolOpt('water-cutout'),
    hollowBase: boolOpt('hollow-base'),
    solidBaseNoTunnels: boolOpt('solid-base'),
    baseHeightMm: num('base-height-mm'),
    supportlessMode: boolOpt('supportless'),
    isResin: true,
    showFrame: flags.frame === undefined ? undefined : (flags.frame !== false),
    zScale: num('z-scale'),
    terrainScale: num('terrain-scale'),
    cropRatio: num('crop-ratio'),
    demMode: flags['dem-mode'],
    demCacheDir: flags['dem-cache-dir'],
    extraDemCacheDirs: extraDirs,
    offlineOnly: Boolean(flags.offline),
    fast: Boolean(flags.fast),
  };
}

function printHelp() {
  const help = `
Map-to-3DPrint Headless 3D Renderer & MCP / CLI Scene Inspector

Usage:
  node tools/mcp_map3d_inspector.mjs <command> [options]

Commands:
  render             Render a headless PNG studio preview
  inspect-landmark   Inspect OSM/S3DB/mesh hierarchy + render 4-angle contact sheet
  audit-scene        Run architectural & GIS fidelity + manifold topology audit
  export-stl         Export watertight binary per-tile .stl files (supports --frame-preset a4_12x17)
  mcp                Run MCP JSON-RPC 2.0 server over stdio
  list-cache         List cached scene_v4 / osm JSON files in cache/

Common Scene Options:
  --snapshot <path>       OSM Snapshot JSON ({ bbox?, elements })
  --cached-city <name>    Cached scene or city name (matches cache/)
  --scene <path>          Prebuilt scene_v4 JSON
  --lat <deg> --lon <deg> Center coordinate (optional when snapshot defines bbox)
  --span <meters>         Map span in meters (default: 1200)
  --rot <deg>             Map rotation in degrees (default: 0)
  --width-cm <cm>         Print bed width in cm (default: 50)
  --height-cm <cm>        Print bed height in cm (default: width-cm)
  --frame-preset <id>     Preset geometry contract (a4_12x17: 12x17 cm, 1x3: 3x 120x56.7 mm, 4.0 mm solid base)
  --tile-cols <n>         Tile columns (default: 1)
  --tile-rows <n>         Tile rows (default: 1)
  --kerf-mm <mm>          Inter-tile kerf in mm (default: 0.08; 0.0 for a4_12x17)
  --bed-margin-mm <mm>    Mono 4 bed safe margin per side in mm (default: 4.0)
  --solid-base            Rigid solid tunnel-free base (skips grooves and underside ID)
  --base-height-mm <mm>   Physical solid base thickness in mm (default: 2.35; 4.0 for solid-base)
  --crop-ratio <r>        Crop ratio override (default: 0.88)
  --palette <name>        PALETTES key (white, nordic, pastel, ocean, ...)
  --frame-style <name>    black | white | oak | walnut
  --water-cutout          Enable water cutout backing board
  --hollow-base           Enable hollow base shell
  --resin                 Use SLA resin detail / building retention profile
  --no-frame              Disable frame
  --z-scale <mult>        Building Z scale multiplier
  --terrain-scale <mult>  Terrain Z scale multiplier
  --dem-cache-dir <dir>   Local Terrarium DEM PNG tile cache directory
  --offline               Disallow remote OpenStreetMap/Terrarium network fetches

Render Options:
  --out <path>            Output PNG path
  --width <px>            Image width (default: 1200)
  --height <px>           Image height (default: 900)
  --ssaa <1|2|4>          Supersampling factor (default: 2)
  --shadow-res <px>       Shadow map resolution (default: 1024)
  --ssao <0..1>           Screen-space crevice AO strength (default: 0.30)
  --preset <name>         overview | top | skyline | south | north | east | west
  --focus-lat <deg>       Focus camera latitude
  --focus-lon <deg>       Focus camera longitude
  --radius-m <meters>     Focus camera radius in meters (default: 150)
  --yaw-deg <deg>         Camera yaw degrees
  --pitch-deg <deg>       Camera pitch degrees
  --distance <units>      Camera distance in scene units
  --fov <deg>             Camera FOV degrees (default: 34)

Inspect Landmark Options:
  --focus-lat <deg> --focus-lon <deg> --radius-m <m>
  --query <text>          Filter OSM names/tags (e.g. "Paulskirche")
  --osm-id <id>           Filter specific OSM way/relation id
  --highlight             Highlight matched building triangles in PNG sheet
  --out <path>            Optional 2x2 contact sheet output PNG path

Audit Scene Options:
  --out <path>            Optional JSON report output path
  --max-examples <n>      Max examples per detector (default: 25)

Export STL Options:
  --out-dir <dir>         Output directory for per-tile binary .stl files
  --prefix <name>         Output filename prefix (default: Map3D)
  --frame-preset a4_12x17 Shortcut for 12x17 cm, 1x3 (3x 120x56.7 mm), 4.0 mm solid tunnel-free base
`.trimStart();
  process.stdout.write(help);
}

async function runCli() {
  process.stdout.on('error', (err) => {
    if (err && err.code === 'EPIPE') process.exit(0);
  });
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const { cmd, flags } = parseCliArgs(argv);

  if (cmd === 'mcp') {
    startMcpStdioServer();
    return;
  }

  if (cmd === 'list-cache') {
    const entries = listCachedScenes();
    process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
    return;
  }

  const baseOpts = mapCommonCliFlags(flags);

  if (cmd === 'render') {
    const num = (k) => (flags[k] !== undefined && flags[k] !== true && flags[k] !== false) ? Number(flags[k]) : undefined;
    const camera = {
      preset: flags.preset,
      yawDeg: num('yaw-deg'),
      pitchDeg: num('pitch-deg'),
      distance: num('distance'),
      fovDeg: num('fov'),
    };
    if (num('focus-lat') !== undefined && num('focus-lon') !== undefined) {
      camera.focusLatLon = {
        lat: num('focus-lat'),
        lon: num('focus-lon'),
        radiusM: num('radius-m') ?? 150,
      };
    }

    const res = await handleRenderMap3DView({
      ...baseOpts,
      camera,
      width: num('width') ?? 1200,
      height: num('height') ?? 900,
      ssaa: num('ssaa') ?? 2,
      shadowRes: num('shadow-res') ?? 1024,
      ssaoStrength: num('ssao') ?? 0.30,
      outputPath: flags.out || path.resolve('render_3d.png'),
    }, { silent: false });
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return;
  }

  if (cmd === 'inspect-landmark') {
    const num = (k) => (flags[k] !== undefined && flags[k] !== true && flags[k] !== false) ? Number(flags[k]) : undefined;
    const res = await handleInspectLandmark3D({
      ...baseOpts,
      focus: {
        lat: num('focus-lat'),
        lon: num('focus-lon'),
        radiusM: num('radius-m') ?? 150,
        query: flags.query,
        osmId: flags['osm-id'],
      },
      highlightMatched: Boolean(flags.highlight),
      width: num('width') ?? 1200,
      height: num('height') ?? 900,
      ssaa: num('ssaa') ?? 2,
      outputSheetPath: flags.out || null,
    }, { silent: false });
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return;
  }

  if (cmd === 'audit-scene') {
    const num = (k) => (flags[k] !== undefined && flags[k] !== true && flags[k] !== false) ? Number(flags[k]) : undefined;
    const res = await handleAuditSceneFidelity({
      ...baseOpts,
      maxExamples: num('max-examples') ?? 25,
      outputJsonPath: flags.out || null,
    }, { silent: false });
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return;
  }

  if (cmd === 'export-stl') {
    const res = await handleExportMap3DStl({
      ...baseOpts,
      outputDir: flags['out-dir'] || flags.out || path.resolve('exports/cli_stl'),
      filePrefix: flags.prefix || flags.title || 'Map3D',
    }, { silent: false });
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return;
  }

  process.stderr.write(`Unknown command: ${cmd || '(none)'}\n`);
  printHelp();
  process.exit(1);
}

export {
  handleRenderMap3DView,
  handleInspectLandmark3D,
  handleAuditSceneFidelity,
  handleExportMap3DStl,
  MCP_TOOLS,
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((err) => {
    process.stderr.write(`[inspector:error] ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}
