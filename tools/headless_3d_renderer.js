'use strict';

/**
 * Headless Pure-Node Software 3D Studio Renderer (CommonJS)
 *
 * Implements the visual shading, orthographic PCF shadow mapping, floor drop
 * shadow, water cutout backing board, camera math, SSAA, and depth-crevice
 * SSAO of `src/render/webgl_studio.js` & `src/render/webgl_shaders.js`.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const {
  mat4Perspective,
  mat4LookAt,
  mat4Multiply,
  hexToRgbNorm,
  computeCameraClipPlanes,
  computeShadowFrustum,
} = require('../src/render/webgl_math.js');
const { PALETTES } = require('../src/ui/ui_config.js');

// ============================================================================
// Pure-Node PNG Encoder (CRC32 + zlib.deflateSync)
// ============================================================================

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const len = data ? data.length : 0;
  const out = Buffer.allocUnsafe(12 + len);
  out.writeUInt32BE(len, 0);
  out.write(type, 4, 4, 'ascii');
  if (len > 0) data.copy(out, 8);
  const crc = crc32(out.subarray(4, 8 + len));
  out.writeUInt32BE(crc, 8 + len);
  return out;
}

/**
 * Encodes an RGBA pixel buffer (`Uint8Array | Uint8ClampedArray`) into a PNG Buffer.
 */
function encodePngRgba(width, height, rgba) {
  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  const rowBytes = w * 4;
  const raw = Buffer.allocUnsafe((rowBytes + 1) * h);

  // Filter type 1 (Sub) compresses architectural renders cleanly & fast
  for (let y = 0; y < h; y++) {
    const srcOff = y * rowBytes;
    const dstOff = y * (rowBytes + 1);
    raw[dstOff] = 1;
    raw[dstOff + 1] = rgba[srcOff];
    raw[dstOff + 2] = rgba[srcOff + 1];
    raw[dstOff + 3] = rgba[srcOff + 2];
    raw[dstOff + 4] = rgba[srcOff + 3];
    for (let x = 4; x < rowBytes; x++) {
      raw[dstOff + 1 + x] = (rgba[srcOff + x] - rgba[srcOff + x - 4]) & 0xff;
    }
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    PNG_SIG,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', null),
  ]);
}

// ============================================================================
// Camera & 4x4 Matrix Math
// ============================================================================

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function invertMat4(m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-18) return null;
  det = 1.0 / det;

  return new Float64Array([
    (a11 * b11 - a12 * b10 + a13 * b09) * det,
    (a02 * b10 - a01 * b11 - a03 * b09) * det,
    (a31 * b05 - a32 * b04 + a33 * b03) * det,
    (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det,
    (a00 * b11 - a02 * b08 + a03 * b07) * det,
    (a32 * b02 - a30 * b05 - a33 * b01) * det,
    (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det,
    (a01 * b08 - a00 * b10 - a03 * b06) * det,
    (a30 * b04 - a31 * b02 + a33 * b00) * det,
    (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det,
    (a00 * b09 - a01 * b07 + a02 * b06) * det,
    (a31 * b01 - a30 * b03 - a32 * b00) * det,
    (a20 * b03 - a21 * b01 + a22 * b00) * det,
  ]);
}

function computeCameraEye(camera) {
  const yaw = Number(camera.yaw ?? -0.48);
  const pitch = clamp(Number(camera.pitch ?? 0.50), -1.545, 1.545);
  const distance = Math.max(2.5, Number(camera.distance ?? 274));
  const target = Array.isArray(camera.target) ? camera.target : [2, 5, 3.2];
  const cp = Math.cos(pitch);
  return [
    target[0] + distance * cp * Math.sin(yaw),
    target[1] - distance * cp * Math.cos(yaw),
    target[2] + distance * Math.sin(pitch),
  ];
}

/**
 * Computes preset studio camera parameters scaled cleanly to plate dimensions.
 */
function computePresetCamera(presetName = 'overview', { halfW = 84.6, halfH = 84.6, zMax = 18 } = {}) {
  const scale = Math.max(halfW || 84.6, halfH || 84.6) / 84.6;
  const tz = clamp(zMax * 0.22, 2.0, 10.0);
  const key = String(presetName || 'overview').toLowerCase();

  switch (key) {
    case 'top':
      return { yaw: 0.0, pitch: 1.535, distance: Math.round(305 * scale), target: [0, 0, 2.0], fovDeg: 34 };
    case 'skyline':
      return { yaw: -0.62, pitch: 0.24, distance: Math.round(215 * scale), target: [0, 0, Math.min(12, zMax * 0.35)], fovDeg: 34 };
    case 'south':
      return { yaw: 0.0, pitch: 0.48, distance: Math.round(265 * scale), target: [0, 0, tz], fovDeg: 34 };
    case 'north':
      return { yaw: Math.PI, pitch: 0.48, distance: Math.round(265 * scale), target: [0, 0, tz], fovDeg: 34 };
    case 'east':
      return { yaw: Math.PI * 0.5, pitch: 0.48, distance: Math.round(265 * scale), target: [0, 0, tz], fovDeg: 34 };
    case 'west':
      return { yaw: -Math.PI * 0.5, pitch: 0.48, distance: Math.round(265 * scale), target: [0, 0, tz], fovDeg: 34 };
    case 'overview':
    default:
      return { yaw: -0.48, pitch: 0.50, distance: Math.round(274 * scale), target: [2 * scale, 5 * scale, 3.2], fovDeg: 34 };
  }
}

/**
 * Computes a framing camera centered on `target` so a region of `radiusScene`
 * fits inside both vertical and horizontal FOV with clean margin.
 */
function computeFocusCamera({
  target = [0, 0, 4],
  radiusScene = 20,
  yawDeg = -35,
  pitchDeg = 35,
  fovDeg = 34,
  aspect = 4 / 3,
} = {}) {
  const halfV = ((Number(fovDeg) || 34) * 0.5 * Math.PI) / 180;
  const halfH = Math.atan(Math.tan(halfV) * Math.max(0.25, Number(aspect) || 1.333));
  const minHalf = Math.min(halfV, halfH);
  const r = Math.max(1.5, Number(radiusScene) || 15);
  const distance = Math.max(r * 1.45, (r * 1.25) / Math.sin(minHalf));
  return {
    yaw: (Number(yawDeg) * Math.PI) / 180,
    pitch: clamp((Number(pitchDeg) * Math.PI) / 180, -1.545, 1.545),
    distance,
    target: [Number(target[0]) || 0, Number(target[1]) || 0, Number(target[2]) || 0],
    fovDeg: Number(fovDeg) || 34,
  };
}

// ============================================================================
// Triangle Packing & Exact Board XY Clipping (for lid < 6)
// ============================================================================

function clipPolyPlaneXY(poly, axis, bound, keepLe) {
  if (poly.length === 0) return poly;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = keepLe ? (bound - a[axis]) : (a[axis] - bound);
    const db = keepLe ? (bound - b[axis]) : (b[axis] - bound);
    const inA = da >= -1e-7;
    const inB = db >= -1e-7;
    if (inA && inB) {
      out.push(b);
    } else if (inA && !inB) {
      const t = da / (da - db);
      out.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ]);
    } else if (!inA && inB) {
      const t = da / (da - db);
      out.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ]);
      out.push(b);
    }
  }
  return out;
}

class PackedTriangleSoup {
  constructor(initialCap = 8192) {
    this.cap = initialCap;
    this.count = 0;
    this.v = new Float32Array(initialCap * 9);  // x0,y0,z0, x1,y1,z1, x2,y2,z2
    this.n = new Float32Array(initialCap * 3);  // nx,ny,nz
    this.lid = new Int16Array(initialCap);
    this.bId = new Int32Array(initialCap);
    this.tileId = new Int32Array(initialCap);
  }

  _grow(needed) {
    if (needed <= this.cap) return;
    let next = this.cap;
    while (next < needed) next = next * 2;
    const nv = new Float32Array(next * 9); nv.set(this.v); this.v = nv;
    const nn = new Float32Array(next * 3); nn.set(this.n); this.n = nn;
    const nl = new Int16Array(next); nl.set(this.lid); this.lid = nl;
    const nb = new Int32Array(next); nb.set(this.bId); this.bId = nb;
    const nt = new Int32Array(next); nt.set(this.tileId); this.tileId = nt;
    this.cap = next;
  }

  pushTri(x0, y0, z0, x1, y1, z1, x2, y2, z2, nx, ny, nz, lid, bId, tileId) {
    const i = this.count;
    if (i >= this.cap) this._grow(i + 1);
    const vOff = i * 9;
    this.v[vOff] = x0; this.v[vOff + 1] = y0; this.v[vOff + 2] = z0;
    this.v[vOff + 3] = x1; this.v[vOff + 4] = y1; this.v[vOff + 5] = z1;
    this.v[vOff + 6] = x2; this.v[vOff + 7] = y2; this.v[vOff + 8] = z2;
    const nOff = i * 3;
    this.n[nOff] = nx; this.n[nOff + 1] = ny; this.n[nOff + 2] = nz;
    this.lid[i] = lid;
    this.bId[i] = bId;
    this.tileId[i] = tileId;
    this.count = i + 1;
  }
}

function resolveRenderState(meshes, rawState = {}, highlightIds = null) {
  const pal = PALETTES[rawState.palette || 'white'] || PALETTES.white;
  const dimW = rawState.bedSizeMm || (rawState.targetWidthCm ? rawState.targetWidthCm * 10 : 500);
  const dimH = rawState.totalHeightMm || (rawState.targetHeightCm ? rawState.targetHeightCm * 10 : dimW);
  const maxDim = Math.max(dimW, dimH) || 500;
  const halfW = (meshes && meshes._halfW) ? Number(meshes._halfW) : (84.6 * (dimW / maxDim));
  const halfH = (meshes && meshes._halfH) ? Number(meshes._halfH) : (84.6 * (dimH / maxDim));

  const colors = {
    water: (rawState.colors && rawState.colors.water) || pal.water,
    base: (rawState.colors && rawState.colors.base) || pal.base,
    greenery: (rawState.colors && rawState.colors.greenery) || pal.greenery,
    trees: (rawState.colors && rawState.colors.trees) || pal.trees || pal.greenery,
    roads: (rawState.colors && rawState.colors.roads) || pal.roads,
    buildings: (rawState.colors && rawState.colors.buildings) || pal.buildings,
    highlighted: (rawState.colors && rawState.colors.highlighted) || pal.highlighted || '#e65100',
  };

  const frameStyle = rawState.frameStyle || 'black';
  const frameCol =
    frameStyle === 'black' ? [0.13, 0.14, 0.16] :
    frameStyle === 'oak' ? [0.74, 0.56, 0.37] :
    frameStyle === 'walnut' ? [0.36, 0.24, 0.16] : [0.95, 0.95, 0.96];
  const boardCol =
    frameStyle === 'oak' ? [0.62, 0.45, 0.28] :
    frameStyle === 'walnut' ? [0.26, 0.17, 0.11] : [0.10, 0.11, 0.13];

  const hiSet = new Set();
  if (highlightIds) {
    for (const id of highlightIds) {
      const n = Number(id);
      if (Number.isFinite(n)) hiSet.add(n);
    }
  }
  const selSet = new Set();
  for (const id of (rawState.selectedIds || [])) {
    const n = Number(id);
    if (Number.isFinite(n)) selSet.add(n);
  }

  return {
    halfW,
    halfH,
    sunAngleDeg: Number(rawState.sunAngleDeg ?? 315),
    explodeFactor: Number(rawState.explodeFactor ?? 0),
    tileCols: Math.max(1, Number(rawState.tileCols ?? 1)),
    tileRows: Math.max(1, Number(rawState.tileRows ?? 1)),
    tileExplode: Number(rawState.tileExplode ?? 0),
    exportTileFilter: rawState.exportTileFilter ?? 'all',
    showFrame: rawState.showFrame !== false,
    waterCutout: Boolean(rawState.waterCutout),
    studioBg: rawState.studioBg !== false,
    showLayerLines: Boolean(rawState.showLayerLines),
    frameStyle,
    frameCol,
    boardCol,
    layerVisible: {
      water: true,
      base: true,
      greenery: true,
      roads: true,
      buildings: true,
      highlighted: true,
      frame: rawState.showFrame !== false,
      ...(rawState.layerVisible || {}),
    },
    rgb: {
      water: hexToRgbNorm(colors.water),
      base: hexToRgbNorm(colors.base),
      greenery: hexToRgbNorm(colors.greenery),
      trees: hexToRgbNorm(colors.trees),
      roads: hexToRgbNorm(colors.roads),
      buildings: hexToRgbNorm(colors.buildings),
      highlighted: hexToRgbNorm(colors.highlighted),
    },
    hiSet,
    selSet,
    hoveredId: Number(rawState.hoveredBuildingId ?? -999),
    clickedId: Number(rawState.userClickedBuilding ?? -999),
  };
}

function buildPackedSoup(meshes, rs, eye) {
  const drawOrder = ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted', 'frame'];
  const layerFallbackId = { water: 0, base: 1, greenery: 2, roads: 3, buildings: 4, highlighted: 5, frame: 6 };

  let estCount = 16;
  for (const key of drawOrder) {
    const m = meshes[key];
    if (!m) continue;
    if (m instanceof Float32Array) estCount += Math.floor(m.length / 27);
    else if (Array.isArray(m)) estCount += m.length;
  }

  const soup = new PackedTriangleSoup(Math.max(256, estCount));
  const explode = rs.explodeFactor;
  const tCols = rs.tileCols;
  const tRows = rs.tileRows;
  const tExplode = rs.tileExplode;
  const activeTile = (rs.exportTileFilter !== 'all') ? Number(rs.exportTileFilter) : -1;
  const limX = rs.halfW + 0.25;
  const limY = rs.halfH + 0.25;

  const pushAdjusted = (rawX0, rawY0, rawZ0, rawX1, rawY1, rawZ1, rawX2, rawY2, rawZ2, nx, ny, nz, lid, bId, tileId) => {
    if (activeTile >= 0 && tileId >= 0 && Math.abs(tileId - activeTile) > 0.1) return;

    let shiftX = 0, shiftY = 0;
    if (tileId >= 0 && (tCols > 1 || tRows > 1) && tExplode > 0.001) {
      const tc = tileId % tCols;
      const tr = Math.floor(tileId / tCols);
      shiftX = (tc - (tCols - 1) * 0.5) * tExplode * 15.0;
      shiftY = (tr - (tRows - 1) * 0.5) * tExplode * 15.0;
    }
    const lift = (lid >= 0 && lid <= 5) ? (lid * explode * 14.0) : 0.0;

    if (lid >= 0 && lid < 6) {
      const minX = Math.min(rawX0, rawX1, rawX2);
      const maxX = Math.max(rawX0, rawX1, rawX2);
      const minY = Math.min(rawY0, rawY1, rawY2);
      const maxY = Math.max(rawY0, rawY1, rawY2);
      if (maxX < -limX || minX > limX || maxY < -limY || minY > limY) return;
      if (minX < -limX || maxX > limX || minY < -limY || maxY > limY) {
        let poly = [
          [rawX0, rawY0, rawZ0],
          [rawX1, rawY1, rawZ1],
          [rawX2, rawY2, rawZ2],
        ];
        poly = clipPolyPlaneXY(poly, 0, -limX, false);
        poly = clipPolyPlaneXY(poly, 0, limX, true);
        poly = clipPolyPlaneXY(poly, 1, -limY, false);
        poly = clipPolyPlaneXY(poly, 1, limY, true);
        if (poly.length < 3) return;
        const p0 = poly[0];
        for (let k = 1; k + 1 < poly.length; k++) {
          const p1 = poly[k];
          const p2 = poly[k + 1];
          soup.pushTri(
            p0[0] + shiftX, p0[1] + shiftY, p0[2] + lift,
            p1[0] + shiftX, p1[1] + shiftY, p1[2] + lift,
            p2[0] + shiftX, p2[1] + shiftY, p2[2] + lift,
            nx, ny, nz, lid, bId, tileId
          );
        }
        return;
      }
    }

    soup.pushTri(
      rawX0 + shiftX, rawY0 + shiftY, rawZ0 + lift,
      rawX1 + shiftX, rawY1 + shiftY, rawZ1 + lift,
      rawX2 + shiftX, rawY2 + shiftY, rawZ2 + lift,
      nx, ny, nz, lid, bId, tileId
    );
  };

  for (const key of drawOrder) {
    if (key === 'frame') {
      if (!rs.showFrame || explode > 0.08 || tExplode > 0.03) continue;
    } else if (!rs.layerVisible[key]) {
      continue;
    } else if (key === 'water' && rs.waterCutout) {
      continue;
    }

    const layerData = meshes[key];
    if (!layerData) continue;
    const defLid = layerFallbackId[key];

    if (layerData instanceof Float32Array) {
      for (let off = 0; off + 26 < layerData.length; off += 27) {
        const nx = layerData[off + 3], ny = layerData[off + 4], nz = layerData[off + 5];
        const lid = Math.round(layerData[off + 6]);
        const bId = Math.round(layerData[off + 7]);
        const tileId = Math.round(layerData[off + 8]);
        pushAdjusted(
          layerData[off], layerData[off + 1], layerData[off + 2],
          layerData[off + 9], layerData[off + 10], layerData[off + 11],
          layerData[off + 18], layerData[off + 19], layerData[off + 20],
          nx, ny, nz, lid, bId, tileId
        );
      }
    } else if (Array.isArray(layerData)) {
      for (let i = 0; i < layerData.length; i++) {
        const t = layerData[i];
        if (!t || !t.v0 || !t.v1 || !t.v2) continue;
        const n = t.n || [0, 0, 1];
        const lid = (t.layerId !== undefined) ? t.layerId : defLid;
        const bId = t.buildingId ?? t.bId ?? -1;
        const tileId = (t.tileId !== undefined) ? t.tileId : -1;
        pushAdjusted(
          t.v0[0], t.v0[1], t.v0[2],
          t.v1[0], t.v1[1], t.v1[2],
          t.v2[0], t.v2[1], t.v2[2],
          n[0], n[1], n[2],
          lid, bId, tileId
        );
      }
    }
  }

  // Water cutout backing board (lid = 8, Z = -0.025)
  if (rs.waterCutout && explode < 0.08 && tExplode <= 0.03 && eye[2] >= 0.0) {
    const Z = -0.025;
    soup.pushTri(-limX, -limY, Z, limX, -limY, Z, limX, limY, Z, 0, 0, 1, 8, -1, -1);
    soup.pushTri(-limX, -limY, Z, limX, limY, Z, -limX, limY, Z, 0, 0, 1, 8, -1, -1);
  }

  // Studio floor plane (lid = 7, Z = -1.62)
  if (explode < 0.05 && clamp(Number(rs._pitch ?? 0.5), -1.545, 1.545) > 0.05) {
    const R = 360, Z = -1.62;
    soup.pushTri(-R, -R, Z, R, -R, Z, R, R, Z, 0, 0, 1, 7, -1, -1);
    soup.pushTri(-R, -R, Z, R, R, Z, -R, R, Z, 0, 0, 1, 7, -1, -1);
  }

  return soup;
}

// ============================================================================
// Pass 1: Shadow Depth Map Rasterizer
// ============================================================================

function rasterizeShadowTri(buf, res, x0, y0, z0, x1, y1, z1, x2, y2, z2) {
  let det = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  if (Math.abs(det) < 1e-6) return;
  if (det < 0) {
    let tmp = x1; x1 = x2; x2 = tmp;
    tmp = y1; y1 = y2; y2 = tmp;
    tmp = z1; z1 = z2; z2 = tmp;
    det = -det;
  }

  const minX = Math.min(x0, x1, x2), maxX = Math.max(x0, x1, x2);
  const minY = Math.min(y0, y1, y2), maxY = Math.max(y0, y1, y2);
  const ix0 = Math.max(0, Math.ceil(minX - 0.5));
  const ix1 = Math.min(res - 1, Math.floor(maxX - 0.5));
  const iy0 = Math.max(0, Math.ceil(minY - 0.5));
  const iy1 = Math.min(res - 1, Math.floor(maxY - 0.5));
  if (ix1 < ix0 || iy1 < iy0) return;

  const invDet = 1.0 / det;
  const dx12 = x2 - x1, dy12 = y2 - y1;
  const dx20 = x0 - x2, dy20 = y0 - y2;
  const stepE0x = -dy12, stepE0y = dx12;
  const stepE1x = -dy20, stepE1y = dx20;
  const dzdx = (dy12 * invDet) * z0 + (dy20 * invDet) * z1 + (-(dy12 + dy20) * invDet) * z2;

  const startCx = ix0 + 0.5;
  let rowY = iy0 + 0.5;
  let rowE0 = dx12 * (rowY - y1) - dy12 * (startCx - x1);
  let rowE1 = dx20 * (rowY - y2) - dy20 * (startCx - x2);
  const eps = -1e-6 * det;

  for (let py = iy0; py <= iy1; py++) {
    let e0 = rowE0;
    let e1 = rowE1;
    let rowBase = py * res;
    for (let px = ix0; px <= ix1; px++) {
      const e2 = det - e0 - e1;
      if (e0 >= eps && e1 >= eps && e2 >= eps) {
        const w0 = e0 * invDet;
        const w1 = e1 * invDet;
        const w2 = 1.0 - w0 - w1;
        const z = w0 * z0 + w1 * z1 + w2 * z2;
        const idx = rowBase + px;
        if (z >= 0.0 && z <= 1.0 && z < buf[idx]) {
          buf[idx] = z;
        }
      }
      e0 += stepE0x;
      e1 += stepE1x;
    }
    rowE0 += stepE0y;
    rowE1 += stepE1y;
  }
}

function buildShadowMap(soup, lightMatrix, shadowRes) {
  const shadowBuf = new Float32Array(shadowRes * shadowRes);
  shadowBuf.fill(1.0);
  if (shadowRes <= 0) return shadowBuf;

  const m0 = lightMatrix[0], m1 = lightMatrix[1], m2 = lightMatrix[2];
  const m4 = lightMatrix[4], m5 = lightMatrix[5], m6 = lightMatrix[6];
  const m8 = lightMatrix[8], m9 = lightMatrix[9], m10 = lightMatrix[10];
  const m12 = lightMatrix[12], m13 = lightMatrix[13], m14 = lightMatrix[14];
  const halfRes = shadowRes * 0.5;

  const v = soup.v;
  const lids = soup.lid;
  const count = soup.count;

  for (let i = 0; i < count; i++) {
    const lid = lids[i];
    if (lid === 7 || lid === 8) continue;

    const o = i * 9;
    const ax = v[o], ay = v[o + 1], az = v[o + 2];
    const bx = v[o + 3], by = v[o + 4], bz = v[o + 5];
    const cx = v[o + 6], cy = v[o + 7], cz = v[o + 8];

    const lx0 = m0 * ax + m4 * ay + m8 * az + m12;
    const ly0 = m1 * ax + m5 * ay + m9 * az + m13;
    const lz0 = m2 * ax + m6 * ay + m10 * az + m14;

    const lx1 = m0 * bx + m4 * by + m8 * bz + m12;
    const ly1 = m1 * bx + m5 * by + m9 * bz + m13;
    const lz1 = m2 * bx + m6 * by + m10 * bz + m14;

    const lx2 = m0 * cx + m4 * cy + m8 * cz + m12;
    const ly2 = m1 * cx + m5 * cy + m9 * cz + m13;
    const lz2 = m2 * cx + m6 * cy + m10 * cz + m14;

    if ((lx0 < -1 && lx1 < -1 && lx2 < -1) || (lx0 > 1 && lx1 > 1 && lx2 > 1) ||
        (ly0 < -1 && ly1 < -1 && ly2 < -1) || (ly0 > 1 && ly1 > 1 && ly2 > 1) ||
        (lz0 < -1 && lz1 < -1 && lz2 < -1) || (lz0 > 1 && lz1 > 1 && lz2 > 1)) {
      continue;
    }

    rasterizeShadowTri(
      shadowBuf, shadowRes,
      (lx0 * 0.5 + 0.5) * shadowRes, (ly0 * 0.5 + 0.5) * shadowRes, lz0 * 0.5 + 0.5,
      (lx1 * 0.5 + 0.5) * shadowRes, (ly1 * 0.5 + 0.5) * shadowRes, lz1 * 0.5 + 0.5,
      (lx2 * 0.5 + 0.5) * shadowRes, (ly2 * 0.5 + 0.5) * shadowRes, lz2 * 0.5 + 0.5
    );
  }
  return shadowBuf;
}

// ============================================================================
// Pass 2: Main Camera G-Buffer Rasterizer (with Clip-Space Near Plane Clipping)
// ============================================================================

function clipPolygonNear4D(verts4) {
  if (verts4.length === 0) return verts4;
  const out = [];
  for (let i = 0; i < verts4.length; i++) {
    const a = verts4[i];
    const b = verts4[(i + 1) % verts4.length];
    const da = a[2] + a[3]; // cz + cw >= 0 <=> z >= -w
    const db = b[2] + b[3];
    const inA = da >= 0;
    const inB = db >= 0;
    if (inA && inB) {
      out.push(b);
    } else if (inA && !inB) {
      const t = da / (da - db);
      out.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
      ]);
    } else if (!inA && inB) {
      const t = da / (da - db);
      out.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
      ]);
      out.push(b);
    }
  }
  return out;
}

function rasterizeCameraTri(depthBuf, triIdxBuf, W, H, ti, px0, py0, z0, px1, py1, z1, px2, py2, z2) {
  let det = (px1 - px0) * (py2 - py0) - (py1 - py0) * (px2 - px0);
  if (Math.abs(det) < 1e-6) return;
  if (det < 0) {
    let tmp = px1; px1 = px2; px2 = tmp;
    tmp = py1; py1 = py2; py2 = tmp;
    tmp = z1; z1 = z2; z2 = tmp;
    det = -det;
  }

  const minX = Math.min(px0, px1, px2), maxX = Math.max(px0, px1, px2);
  const minY = Math.min(py0, py1, py2), maxY = Math.max(py0, py1, py2);
  const ix0 = Math.max(0, Math.ceil(minX - 0.5));
  const ix1 = Math.min(W - 1, Math.floor(maxX - 0.5));
  const iy0 = Math.max(0, Math.ceil(minY - 0.5));
  const iy1 = Math.min(H - 1, Math.floor(maxY - 0.5));
  if (ix1 < ix0 || iy1 < iy0) return;

  const invDet = 1.0 / det;
  const dx12 = px2 - px1, dy12 = py2 - py1;
  const dx20 = px0 - px2, dy20 = py0 - py2;
  const stepE0x = -dy12, stepE0y = dx12;
  const stepE1x = -dy20, stepE1y = dx20;

  const startCx = ix0 + 0.5;
  let rowY = iy0 + 0.5;
  let rowE0 = dx12 * (rowY - py1) - dy12 * (startCx - px1);
  let rowE1 = dx20 * (rowY - py2) - dy20 * (startCx - px2);
  const eps = -1e-6 * det;

  for (let py = iy0; py <= iy1; py++) {
    let e0 = rowE0;
    let e1 = rowE1;
    const rowBase = py * W;
    for (let px = ix0; px <= ix1; px++) {
      const e2 = det - e0 - e1;
      if (e0 >= eps && e1 >= eps && e2 >= eps) {
        const w0 = e0 * invDet;
        const w1 = e1 * invDet;
        const w2 = 1.0 - w0 - w1;
        const z = w0 * z0 + w1 * z1 + w2 * z2;
        const idx = rowBase + px;
        if (z >= 0.0 && z <= 1.0 && z < depthBuf[idx]) {
          depthBuf[idx] = z;
          triIdxBuf[idx] = ti;
        }
      }
      e0 += stepE0x;
      e1 += stepE1x;
    }
    rowE0 += stepE0y;
    rowE1 += stepE1y;
  }
}

function rasterizeSceneGBuffer(soup, viewProj, W, H, rs) {
  const N = W * H;
  const depthBuf = new Float32Array(N);
  depthBuf.fill(1.0);
  const triIdxBuf = new Int32Array(N);
  triIdxBuf.fill(-1);

  const m0 = viewProj[0], m1 = viewProj[1], m2 = viewProj[2], m3 = viewProj[3];
  const m4 = viewProj[4], m5 = viewProj[5], m6 = viewProj[6], m7 = viewProj[7];
  const m8 = viewProj[8], m9 = viewProj[9], m10 = viewProj[10], m11 = viewProj[11];
  const m12 = viewProj[12], m13 = viewProj[13], m14 = viewProj[14], m15 = viewProj[15];

  const halfWpx = W * 0.5;
  const halfHpx = H * 0.5;
  const v = soup.v;
  const lids = soup.lid;
  const bIds = soup.bId;
  const count = soup.count;

  for (let i = 0; i < count; i++) {
    const o = i * 9;
    const ax = v[o], ay = v[o + 1], az = v[o + 2];
    const bx = v[o + 3], by = v[o + 4], bz = v[o + 5];
    const gx = v[o + 6], gy = v[o + 7], gz = v[o + 8];

    const cx0 = m0 * ax + m4 * ay + m8 * az + m12;
    const cy0 = m1 * ax + m5 * ay + m9 * az + m13;
    let cz0 = m2 * ax + m6 * ay + m10 * az + m14;
    const cw0 = m3 * ax + m7 * ay + m11 * az + m15;

    const cx1 = m0 * bx + m4 * by + m8 * bz + m12;
    const cy1 = m1 * bx + m5 * by + m9 * bz + m13;
    let cz1 = m2 * bx + m6 * by + m10 * bz + m14;
    const cw1 = m3 * bx + m7 * by + m11 * bz + m15;

    const cx2 = m0 * gx + m4 * gy + m8 * gz + m12;
    const cy2 = m1 * gx + m5 * gy + m9 * gz + m13;
    let cz2 = m2 * gx + m6 * gy + m10 * gz + m14;
    const cw2 = m3 * gx + m7 * gy + m11 * gz + m15;

    // Layer depth offsets matching WEBGL_MAIN_VS
    const lid = lids[i];
    const bid = bIds[i];
    let zOff = 0.0;
    if (bid > 0 && (rs.selSet.has(bid) || rs.hiSet.has(bid))) zOff = -0.00035;
    else if (bid > 0 && (bid === rs.hoveredId || bid === rs.clickedId)) zOff = -0.00025;
    else if (lid === 5) zOff = -0.00020;
    else if (lid === 3) zOff = -0.00004;
    else if (lid === 0) zOff = -0.00002;
    if (zOff !== 0.0) {
      cz0 += zOff * cw0;
      cz1 += zOff * cw1;
      cz2 += zOff * cw2;
    }

    // Reject completely behind near plane or completely beyond far plane
    if ((cz0 + cw0 < 0 && cz1 + cw1 < 0 && cz2 + cw2 < 0) ||
        (cz0 > cw0 && cz1 > cw1 && cz2 > cw2)) {
      continue;
    }

    if (cz0 + cw0 >= 0 && cz1 + cw1 >= 0 && cz2 + cw2 >= 0 && cw0 > 1e-6 && cw1 > 1e-6 && cw2 > 1e-6) {
      const iw0 = 1.0 / cw0, iw1 = 1.0 / cw1, iw2 = 1.0 / cw2;
      const nx0 = cx0 * iw0, ny0 = cy0 * iw0, nz0 = cz0 * iw0;
      const nx1 = cx1 * iw1, ny1 = cy1 * iw1, nz1 = cz1 * iw1;
      const nx2 = cx2 * iw2, ny2 = cy2 * iw2, nz2 = cz2 * iw2;

      if ((nx0 < -1 && nx1 < -1 && nx2 < -1) || (nx0 > 1 && nx1 > 1 && nx2 > 1) ||
          (ny0 < -1 && ny1 < -1 && ny2 < -1) || (ny0 > 1 && ny1 > 1 && ny2 > 1)) {
        continue;
      }

      rasterizeCameraTri(
        depthBuf, triIdxBuf, W, H, i,
        (nx0 * 0.5 + 0.5) * W, (0.5 - ny0 * 0.5) * H, nz0 * 0.5 + 0.5,
        (nx1 * 0.5 + 0.5) * W, (0.5 - ny1 * 0.5) * H, nz1 * 0.5 + 0.5,
        (nx2 * 0.5 + 0.5) * W, (0.5 - ny2 * 0.5) * H, nz2 * 0.5 + 0.5
      );
    } else {
      const clipped = clipPolygonNear4D([
        [cx0, cy0, cz0, cw0],
        [cx1, cy1, cz1, cw1],
        [cx2, cy2, cz2, cw2],
      ]);
      if (clipped.length < 3) continue;
      const p = clipped.map(c => {
        const iw = 1.0 / Math.max(1e-6, c[3]);
        return [(c[0] * iw * 0.5 + 0.5) * W, (0.5 - c[1] * iw * 0.5) * H, (c[2] * iw) * 0.5 + 0.5];
      });
      for (let k = 1; k + 1 < p.length; k++) {
        rasterizeCameraTri(
          depthBuf, triIdxBuf, W, H, i,
          p[0][0], p[0][1], p[0][2],
          p[k][0], p[k][1], p[k][2],
          p[k + 1][0], p[k + 1][1], p[k + 1][2]
        );
      }
    }
  }

  return { depthBuf, triIdxBuf };
}

// ============================================================================
// Pass 3: Deferred Lighting + Shadow PCF + Crevice SSAO + SSAA Downsample
// ============================================================================

function computePixelCreviceAo(depthBuf, triIdxBuf, W, H, px, py, d0, p10, p14, ssaa, ssaoStrength) {
  if (ssaoStrength <= 0.001) return 1.0;
  const ndcZ0 = d0 * 2.0 - 1.0;
  const denom0 = ndcZ0 + p10;
  if (Math.abs(denom0) < 1e-8) return 1.0;
  const dist0 = p14 / denom0;
  if (dist0 <= 0) return 1.0;

  // Scale crevice distance threshold gently with viewing distance
  const maxRange = Math.max(0.4, dist0 * 0.032);
  const r1 = 2 * ssaa;
  const r2 = 4 * ssaa;
  const offsets = [
    [-r1, 0], [r1, 0], [0, -r1], [0, r1],
    [-r2, -r2], [r2, -r2], [-r2, r2], [r2, r2],
  ];

  let occ = 0.0;
  for (let k = 0; k < 8; k++) {
    const nx = clamp(px + offsets[k][0], 0, W - 1);
    const ny = clamp(py + offsets[k][1], 0, H - 1);
    const nIdx = ny * W + nx;
    if (triIdxBuf[nIdx] < 0) continue;
    const nd = depthBuf[nIdx];
    const ndDenom = (nd * 2.0 - 1.0) + p10;
    if (Math.abs(ndDenom) < 1e-8) continue;
    const distN = p14 / ndDenom;
    const diff = dist0 - distN;
    if (diff > 0.02) {
      const rangeFade = 1.0 - smoothstep(maxRange * 0.35, maxRange, diff);
      const contrib = clamp(diff / (maxRange * 0.45), 0, 1) * rangeFade;
      occ += contrib;
    }
  }
  return clamp(1.0 - (occ / 8.0) * ssaoStrength, 0.55, 1.0);
}

function shadeAndDownsample({
  depthBuf,
  triIdxBuf,
  shadowBuf,
  shadowRes,
  soup,
  invViewProj,
  lightMatrix,
  proj,
  eye,
  sunDir,
  rs,
  width,
  height,
  ssaa,
  ssaoStrength,
}) {
  const ssW = width * ssaa;
  const ssH = height * ssaa;
  const ssRgb = new Float32Array(ssW * ssH * 3);

  const bgR = rs.studioBg ? 0.985 : 0.075;
  const bgG = rs.studioBg ? 0.986 : 0.105;
  const bgB = rs.studioBg ? 0.990 : 0.165;

  // Normalized sun vector L
  const lLen = Math.hypot(sunDir[0], sunDir[1], sunDir[2]) || 1;
  const Lx = sunDir[0] / lLen, Ly = sunDir[1] / lLen, Lz = sunDir[2] / lLen;

  const im0 = invViewProj[0], im1 = invViewProj[1], im2 = invViewProj[2], im3 = invViewProj[3];
  const im4 = invViewProj[4], im5 = invViewProj[5], im6 = invViewProj[6], im7 = invViewProj[7];
  const im8 = invViewProj[8], im9 = invViewProj[9], im10 = invViewProj[10], im11 = invViewProj[11];
  const im12 = invViewProj[12], im13 = invViewProj[13], im14 = invViewProj[14], im15 = invViewProj[15];

  const lm0 = lightMatrix[0], lm1 = lightMatrix[1], lm2 = lightMatrix[2], lm3 = lightMatrix[3];
  const lm4 = lightMatrix[4], lm5 = lightMatrix[5], lm6 = lightMatrix[6], lm7 = lightMatrix[7];
  const lm8 = lightMatrix[8], lm9 = lightMatrix[9], lm10 = lightMatrix[10], lm11 = lightMatrix[11];
  const lm12 = lightMatrix[12], lm13 = lightMatrix[13], lm14 = lightMatrix[14], lm15 = lightMatrix[15];

  const p10 = proj[10], p14 = proj[14];
  const hasShadow = shadowRes > 0 && shadowBuf;
  const texel = shadowRes > 0 ? (1.0 / shadowRes) * 1.35 : 0;

  const norms = soup.n;
  const lids = soup.lid;
  const bIds = soup.bId;
  const explode = rs.explodeFactor;

  for (let py = 0; py < ssH; py++) {
    const ndcY = 1.0 - ((py + 0.5) / ssH) * 2.0;
    const rowBase = py * ssW;
    for (let px = 0; px < ssW; px++) {
      const idx = rowBase + px;
      const outIdx = idx * 3;
      const ti = triIdxBuf[idx];
      if (ti < 0) {
        ssRgb[outIdx] = bgR;
        ssRgb[outIdx + 1] = bgG;
        ssRgb[outIdx + 2] = bgB;
        continue;
      }

      const d0 = depthBuf[idx];
      const ndcX = ((px + 0.5) / ssW) * 2.0 - 1.0;
      const ndcZ = d0 * 2.0 - 1.0;

      const rw = im3 * ndcX + im7 * ndcY + im11 * ndcZ + im15;
      const invRw = 1.0 / (rw || 1.0);
      const wx = (im0 * ndcX + im4 * ndcY + im8 * ndcZ + im12) * invRw;
      const wy = (im1 * ndcX + im5 * ndcY + im9 * ndcZ + im13) * invRw;
      const wz = (im2 * ndcX + im6 * ndcY + im10 * ndcZ + im14) * invRw;

      const lid = lids[ti];

      // Floor plane (lid == 7)
      if (lid === 7) {
        const dx = Math.abs(wx - (-3.0)) - (rs.halfW + 9.2);
        const dy = Math.abs(wy - (-4.0)) - (rs.halfH + 9.2);
        const mdx = Math.max(dx, 0), mdy = Math.max(dy, 0);
        const boxDist = Math.hypot(mdx, mdy) + Math.min(Math.max(dx, dy), 0);
        const dropShadow = smoothstep(-4.0, 22.0, boxDist);
        const darkness = rs.studioBg ? (0.76 + 0.24 * dropShadow) : (0.55 + 0.45 * dropShadow);
        ssRgb[outIdx] = bgR * darkness;
        ssRgb[outIdx + 1] = bgG * darkness;
        ssRgb[outIdx + 2] = bgB * darkness;
        continue;
      }

      const nOff = ti * 3;
      const nxRaw = norms[nOff], nyRaw = norms[nOff + 1], nzRaw = norms[nOff + 2];
      const nLen = Math.hypot(nxRaw, nyRaw, nzRaw) || 1;
      const nx = nxRaw / nLen, ny = nyRaw / nLen, nz = nzRaw / nLen;

      let baseR = rs.rgb.buildings[0], baseG = rs.rgb.buildings[1], baseB = rs.rgb.buildings[2];
      if (lid === 0) {
        baseR = rs.rgb.water[0]; baseG = rs.rgb.water[1]; baseB = rs.rgb.water[2];
      } else if (lid === 1) {
        baseR = rs.rgb.base[0]; baseG = rs.rgb.base[1]; baseB = rs.rgb.base[2];
        if (Math.abs(nz) < 0.45) {
          baseR *= 0.82; baseG *= 0.82; baseB *= 0.82;
        }
      } else if (lid === 2) {
        if (nz > 0.04 && nz < 0.98) {
          baseR = rs.rgb.trees[0] * 0.92;
          baseG = rs.rgb.trees[1] * 0.92;
          baseB = rs.rgb.trees[2] * 0.92;
        } else {
          baseR = rs.rgb.greenery[0]; baseG = rs.rgb.greenery[1]; baseB = rs.rgb.greenery[2];
          if (nz < 0.88 && nz > -0.1) {
            baseR *= 0.88; baseG *= 0.88; baseB *= 0.88;
          }
        }
      } else if (lid === 3) {
        baseR = rs.rgb.roads[0]; baseG = rs.rgb.roads[1]; baseB = rs.rgb.roads[2];
      } else if (lid === 5) {
        baseR = rs.rgb.highlighted[0]; baseG = rs.rgb.highlighted[1]; baseB = rs.rgb.highlighted[2];
      } else if (lid === 6) {
        baseR = rs.frameCol[0]; baseG = rs.frameCol[1]; baseB = rs.frameCol[2];
        if (Math.abs(Math.abs(wx) - Math.abs(wy)) < 0.40) {
          baseR *= 0.68; baseG *= 0.68; baseB *= 0.68;
        }
      } else if (lid === 8) {
        baseR = rs.boardCol[0]; baseG = rs.boardCol[1]; baseB = rs.boardCol[2];
      }

      const bid = bIds[ti];
      if (bid > 0) {
        if (rs.hiSet.has(bid)) {
          baseR = rs.rgb.highlighted[0]; baseG = rs.rgb.highlighted[1]; baseB = rs.rgb.highlighted[2];
        } else if (rs.selSet.has(bid)) {
          baseR = baseR * 0.22 + 0.98 * 0.78;
          baseG = baseG * 0.22 + 0.62 * 0.78;
          baseB = baseB * 0.22 + 0.04 * 0.78;
        } else if (bid === rs.hoveredId || bid === rs.clickedId) {
          baseR = baseR * 0.38 + 0.18 * 0.62;
          baseG = baseG * 0.38 + 0.62 * 0.62;
          baseB = baseB * 0.38 + 1.00 * 0.62;
        }
      }

      const vx0 = eye[0] - wx, vy0 = eye[1] - wy, vz0 = eye[2] - wz;
      const vLen = Math.hypot(vx0, vy0, vz0) || 1;
      const vx = vx0 / vLen, vy = vy0 / vLen, vz = vz0 / vLen;

      const hx0 = Lx + vx, hy0 = Ly + vy, hz0 = Lz + vz;
      const hLen = Math.hypot(hx0, hy0, hz0) || 1;
      const hx = hx0 / hLen, hy = hy0 / hLen, hz = hz0 / hLen;

      const rawDiff = nx * Lx + ny * Ly + nz * Lz;
      let diff = Math.max(rawDiff, 0.0);
      if (nz < -0.1 && eye[2] < 0.0) {
        diff = Math.max(-rawDiff, 0.35);
        const lift = (lid >= 0 && lid <= 5) ? (lid * explode * 14.0) : 0.0;
        const rawZ = wz - lift;
        if (rawZ > 0.08) {
          baseR = baseR * 0.72 * 0.55 + 0.88 * 0.45;
          baseG = baseG * 0.72 * 0.55 + 0.72 * 0.45;
          baseB = baseB * 0.72 * 0.55 + 0.52 * 0.45;
        } else {
          baseR *= 0.88; baseG *= 0.88; baseB *= 0.88;
        }
      }

      let shadow = 1.0;
      if (nz < -0.1) {
        shadow = 0.88;
      } else if (hasShadow) {
        const lsw = lm3 * wx + lm7 * wy + lm11 * wz + lm15 || 1.0;
        const pxProj = ((lm0 * wx + lm4 * wy + lm8 * wz + lm12) / lsw) * 0.5 + 0.5;
        const pyProj = ((lm1 * wx + lm5 * wy + lm9 * wz + lm13) / lsw) * 0.5 + 0.5;
        const pzProj = ((lm2 * wx + lm6 * wy + lm10 * wz + lm14) / lsw) * 0.5 + 0.5;
        if (pxProj >= 0.01 && pxProj <= 0.99 && pyProj >= 0.01 && pyProj <= 0.99 && pzProj <= 0.995) {
          const bias = Math.max(0.0024 * (1.0 - diff), 0.0010);
          const curZ = pzProj - bias;
          let sAcc = 0.0;
          for (let ox = -1; ox <= 1; ox++) {
            const sx = clamp(Math.floor((pxProj + ox * texel) * shadowRes), 0, shadowRes - 1);
            for (let oy = -1; oy <= 1; oy++) {
              const sy = clamp(Math.floor((pyProj + oy * texel) * shadowRes), 0, shadowRes - 1);
              if (curZ <= shadowBuf[sy * shadowRes + sx]) sAcc += 1.0;
            }
          }
          shadow = sAcc / 9.0;
        }
      }

      const sky = 0.5 + 0.5 * Math.abs(nz);
      const bounce = 0.5 + 0.5 * clamp(nx * (-Lx) + ny * (-Ly), -1, 1);

      let heightAo = clamp(0.92 + 0.08 * ((wz - 2.0) / 14.0), 0.88, 1.03);
      if (Math.abs(nz) < 0.4 && lid >= 4) {
        heightAo *= clamp(0.90 + 0.10 * ((wz - 2.5) / 8.0), 0.88, 1.0);
      }
      if (lid !== 6 && lid !== 8) {
        heightAo *= computePixelCreviceAo(depthBuf, triIdxBuf, ssW, ssH, px, py, d0, p10, p14, ssaa, ssaoStrength);
      }

      const specDot = Math.max(nx * hx + ny * hy + nz * hz, 0.0);
      const spec = Math.pow(specDot, 28.0) * (lid === 0 ? 0.16 : 0.05) * shadow;

      let studioIllum = (0.66 + 0.18 * sky + 0.05 * bounce) + (0.30 * diff * (0.35 + 0.65 * shadow));
      studioIllum *= (0.86 + 0.14 * shadow);

      let cR = clamp(baseR * studioIllum * heightAo + spec, 0, 1);
      let cG = clamp(baseG * studioIllum * heightAo + spec, 0, 1);
      let cB = clamp(baseB * studioIllum * heightAo + spec, 0, 1);

      if (rs.showLayerLines && lid !== 6 && lid !== 8) {
        const layerF = Math.abs((wz * 6.0) % 1.0 - 0.5);
        if (layerF < 0.08) {
          cR *= 0.88; cG *= 0.88; cB *= 0.88;
        }
      }

      ssRgb[outIdx] = cR;
      ssRgb[outIdx + 1] = cG;
      ssRgb[outIdx + 2] = cB;
    }
  }

  // Downsample ssaa x ssaa -> width x height RGBA8
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (ssaa === 1) {
    for (let i = 0, p = 0; i < width * height; i++, p += 3) {
      const dst = i * 4;
      rgba[dst] = Math.round(ssRgb[p] * 255);
      rgba[dst + 1] = Math.round(ssRgb[p + 1] * 255);
      rgba[dst + 2] = Math.round(ssRgb[p + 2] * 255);
      rgba[dst + 3] = 255;
    }
    return rgba;
  }

  const invSamples = 1.0 / (ssaa * ssaa);
  for (let y = 0; y < height; y++) {
    const syBase = y * ssaa;
    for (let x = 0; x < width; x++) {
      const sxBase = x * ssaa;
      let ar = 0, ag = 0, ab = 0;
      for (let oy = 0; oy < ssaa; oy++) {
        const rowOff = (syBase + oy) * ssW;
        for (let ox = 0; ox < ssaa; ox++) {
          const p = (rowOff + sxBase + ox) * 3;
          ar += ssRgb[p];
          ag += ssRgb[p + 1];
          ab += ssRgb[p + 2];
        }
      }
      const dst = (y * width + x) * 4;
      rgba[dst] = Math.round(ar * invSamples * 255);
      rgba[dst + 1] = Math.round(ag * invSamples * 255);
      rgba[dst + 2] = Math.round(ab * invSamples * 255);
      rgba[dst + 3] = 255;
    }
  }
  return rgba;
}

// ============================================================================
// Optional Diagnostic 2D Marker Overlays
// ============================================================================

function drawDiagnosticMarkers(rgba, width, height, markers, viewProj) {
  if (!Array.isArray(markers) || markers.length === 0) return;

  const setPx = (x, y, r, g, b, a = 1) => {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix < 0 || ix >= width || iy < 0 || iy >= height) return;
    const off = (iy * width + ix) * 4;
    rgba[off] = Math.round(rgba[off] * (1 - a) + r * a);
    rgba[off + 1] = Math.round(rgba[off + 1] * (1 - a) + g * a);
    rgba[off + 2] = Math.round(rgba[off + 2] * (1 - a) + b * a);
  };

  for (const m of markers) {
    const wx = Array.isArray(m) ? m[0] : (m.x ?? m.pos?.[0] ?? 0);
    const wy = Array.isArray(m) ? m[1] : (m.y ?? m.pos?.[1] ?? 0);
    const wz = Array.isArray(m) ? (m[2] ?? 0) : (m.z ?? m.pos?.[2] ?? 0);
    const cx = viewProj[0] * wx + viewProj[4] * wy + viewProj[8] * wz + viewProj[12];
    const cy = viewProj[1] * wx + viewProj[5] * wy + viewProj[9] * wz + viewProj[13];
    const cw = viewProj[3] * wx + viewProj[7] * wy + viewProj[11] * wz + viewProj[15];
    if (cw <= 1e-5) continue;

    const px = ((cx / cw) * 0.5 + 0.5) * width;
    const py = (0.5 - (cy / cw) * 0.5) * height;
    const colNorm = hexToRgbNorm((m && m.color) || '#ff3b30');
    const cr = Math.round(colNorm[0] * 255);
    const cg = Math.round(colNorm[1] * 255);
    const cb = Math.round(colNorm[2] * 255);
    const rad = Math.max(5, Number((m && m.radiusPx) ?? 12));

    const steps = Math.max(36, Math.round(rad * 6));
    for (let k = 0; k < steps; k++) {
      const ang = (k * Math.PI * 2) / steps;
      const rx = px + Math.cos(ang) * rad;
      const ry = py + Math.sin(ang) * rad;
      setPx(rx, ry, cr, cg, cb, 0.95);
      setPx(rx + 0.5, ry, cr, cg, cb, 0.75);
      setPx(rx, ry + 0.5, cr, cg, cb, 0.75);
    }
    const arm = Math.max(4, Math.round(rad * 0.55));
    for (let d = -arm; d <= arm; d++) {
      if (Math.abs(d) >= 2) {
        setPx(px + d, py, cr, cg, cb, 0.95);
        setPx(px, py + d, cr, cg, cb, 0.95);
      }
    }
  }
}

// ============================================================================
// Public Render API
// ============================================================================

function countLayerTriangles(meshes) {
  const counts = {};
  let total = 0;
  for (const key of ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted', 'frame']) {
    const m = meshes && meshes[key];
    let n = 0;
    if (m instanceof Float32Array) n = Math.floor(m.length / 27);
    else if (Array.isArray(m)) n = m.length;
    counts[key] = n;
    total += n;
  }
  counts.total = total;
  return counts;
}

/**
 * Renders `meshes` from `camera` into an RGBA Uint8ClampedArray + encoded PNG Buffer.
 */
function renderSceneToRgba({
  meshes,
  state = {},
  camera = null,
  width = 1200,
  height = 900,
  ssaa = 2,
  shadowRes = 1024,
  ssaoStrength = 0.30,
  highlightIds = null,
  markers = null,
}) {
  const tStart = Date.now();
  const w = Math.max(16, width | 0);
  const h = Math.max(16, height | 0);
  const ss = (ssaa === 1 || ssaa === 2 || ssaa === 4) ? ssaa : 2;
  const sRes = Math.max(0, shadowRes | 0);

  const rs = resolveRenderState(meshes, state, highlightIds);
  const cam = camera || computePresetCamera('overview', { halfW: rs.halfW, halfH: rs.halfH });
  rs._pitch = cam.pitch;
  const eye = computeCameraEye(cam);

  const soup = buildPackedSoup(meshes, rs, eye);

  const explodeSpan = rs.explodeFactor * 14.0 * 3.0;
  const sunShadow = computeShadowFrustum(
    cam,
    rs.sunAngleDeg,
    rs.halfW,
    rs.halfH,
    rs.explodeFactor,
    explodeSpan,
    Math.max(512, sRes || 1024)
  );

  const shadowBuf = (sRes > 0) ? buildShadowMap(soup, sunShadow.lightMatrix, sRes) : null;

  const { zNear, zFar } = computeCameraClipPlanes(cam.distance || 274, explodeSpan);
  const fovRad = ((Number(cam.fovDeg) || 34) * Math.PI) / 180;
  const proj = mat4Perspective(fovRad, w / h, zNear, zFar);
  const view = mat4LookAt(eye, cam.target || [0, 0, 3], [0, 0, 1]);
  const viewProj = mat4Multiply(proj, view);
  const invViewProj = invertMat4(viewProj);
  if (!invViewProj) throw new Error('Singular camera viewProjection matrix');

  const gbuf = rasterizeSceneGBuffer(soup, viewProj, w * ss, h * ss, rs);
  const rgba = shadeAndDownsample({
    depthBuf: gbuf.depthBuf,
    triIdxBuf: gbuf.triIdxBuf,
    shadowBuf,
    shadowRes: sRes,
    soup,
    invViewProj,
    lightMatrix: sunShadow.lightMatrix,
    proj,
    eye,
    sunDir: sunShadow.sunDir,
    rs,
    width: w,
    height: h,
    ssaa: ss,
    ssaoStrength: Number(ssaoStrength ?? 0.30),
  });

  if (markers && markers.length > 0) {
    drawDiagnosticMarkers(rgba, w, h, markers, viewProj);
  }

  return {
    rgba,
    width: w,
    height: h,
    camera: { ...cam, eye },
    triangleCounts: countLayerTriangles(meshes),
    renderedTriangles: soup.count,
    elapsedMs: Date.now() - tStart,
  };
}

function renderSceneToPngBuffer(opts) {
  const rendered = renderSceneToRgba(opts);
  const pngBuffer = encodePngRgba(rendered.width, rendered.height, rendered.rgba);
  return { ...rendered, pngBuffer };
}

function renderSceneToPngFile(opts) {
  if (!opts || !opts.outputPath) throw new Error('renderSceneToPngFile requires outputPath');
  const out = renderSceneToPngBuffer(opts);
  fs.mkdirSync(path.dirname(path.resolve(opts.outputPath)), { recursive: true });
  fs.writeFileSync(opts.outputPath, out.pngBuffer);
  return {
    outputPath: opts.outputPath,
    width: out.width,
    height: out.height,
    camera: out.camera,
    triangleCounts: out.triangleCounts,
    renderedTriangles: out.renderedTriangles,
    elapsedMs: out.elapsedMs,
    pngBuffer: out.pngBuffer,
  };
}

/**
 * Renders a `cols x rows` contact sheet (default 2x2) across multiple camera views
 * with crisp 2px subtle dividers.
 */
function renderContactSheet({
  meshes,
  state = {},
  views,
  width = 1200,
  height = 900,
  cols = 2,
  rows = 2,
  ssaa = 2,
  shadowRes = 1024,
  ssaoStrength = 0.30,
  highlightIds = null,
  markers = null,
  outputPath = null,
}) {
  const tStart = Date.now();
  const cCount = Math.max(1, cols | 0);
  const rCount = Math.max(1, rows | 0);
  const totalW = Math.max(32, width | 0);
  const totalH = Math.max(32, height | 0);
  const cellW = Math.floor(totalW / cCount);
  const cellH = Math.floor(totalH / rCount);

  const rs = resolveRenderState(meshes, state, highlightIds);
  const viewList = (Array.isArray(views) && views.length > 0)
    ? views
    : [
        computePresetCamera('overview', rs),
        computePresetCamera('skyline', rs),
        computePresetCamera('east', rs),
        computePresetCamera('top', rs),
      ];

  const outRgba = new Uint8ClampedArray(totalW * totalH * 4);
  for (let i = 0; i < outRgba.length; i += 4) {
    outRgba[i] = 24; outRgba[i + 1] = 28; outRgba[i + 2] = 34; outRgba[i + 3] = 255;
  }

  const maxCells = Math.min(viewList.length, cCount * rCount);
  for (let idx = 0; idx < maxCells; idx++) {
    const vSpec = viewList[idx];
    const cam = vSpec.camera || vSpec;
    const col = idx % cCount;
    const row = Math.floor(idx / cCount);
    const tile = renderSceneToRgba({
      meshes,
      state,
      camera: cam,
      width: cellW,
      height: cellH,
      ssaa,
      shadowRes,
      ssaoStrength,
      highlightIds,
      markers,
    });

    const dstX0 = col * cellW;
    const dstY0 = row * cellH;
    for (let y = 0; y < cellH; y++) {
      const sOff = y * cellW * 4;
      const dOff = ((dstY0 + y) * totalW + dstX0) * 4;
      outRgba.set(tile.rgba.subarray(sOff, sOff + cellW * 4), dOff);
    }
  }

  // Subtle 2px grid dividers
  const div = [84, 92, 104];
  for (let c = 1; c < cCount; c++) {
    const xLine = c * cellW;
    for (let y = 0; y < totalH; y++) {
      for (let dx = -1; dx <= 0; dx++) {
        const px = clamp(xLine + dx, 0, totalW - 1);
        const off = (y * totalW + px) * 4;
        outRgba[off] = div[0]; outRgba[off + 1] = div[1]; outRgba[off + 2] = div[2];
      }
    }
  }
  for (let r = 1; r < rCount; r++) {
    const yLine = r * cellH;
    for (let dy = -1; dy <= 0; dy++) {
      const py = clamp(yLine + dy, 0, totalH - 1);
      for (let x = 0; x < totalW; x++) {
        const off = (py * totalW + x) * 4;
        outRgba[off] = div[0]; outRgba[off + 1] = div[1]; outRgba[off + 2] = div[2];
      }
    }
  }

  const pngBuffer = encodePngRgba(totalW, totalH, outRgba);
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(outputPath, pngBuffer);
  }

  return {
    outputPath,
    pngBuffer,
    width: totalW,
    height: totalH,
    views: viewList.slice(0, maxCells),
    triangleCounts: countLayerTriangles(meshes),
    elapsedMs: Date.now() - tStart,
  };
}

module.exports = {
  encodePngRgba,
  computePresetCamera,
  computeFocusCamera,
  renderSceneToRgba,
  renderSceneToPngBuffer,
  renderSceneToPngFile,
  renderContactSheet,
  countLayerTriangles,
};
