// ============================================================================
// src/mesh/bridges/bridge_tin_sampler.js
// Delatin TIN Surface Grid Sampler, Bank Abutment Probing & Water Flags
// ============================================================================

if (typeof _ptInRingJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(globalThis, require('./bridge_geom_2d.js'));
}

function _buildTinSurfaceSamplerJS(terrainWater, ctx) {
  const fallbackTinZ = (x, y) => ctx.getTerrainZ(x, y);
  const fallbackSurfZ = (x, y) => terrainWater.getSurfaceZ(x, y);
  const tm = terrainWater && terrainWater.terrainManifold;
  if (!tm || typeof tm.getMesh !== 'function' || (ctx.elevReliefM !== undefined && ctx.elevReliefM <= 0.35)) {
    return { getTinZ: fallbackTinZ, getTrueSurfaceZ: fallbackSurfZ };
  }
  let mesh = null;
  try { mesh = tm.getMesh(); } catch (_) { mesh = null; }
  if (!mesh || !mesh.vertProperties || !mesh.triVerts || mesh.triVerts.length < 3) {
    return { getTinZ: fallbackTinZ, getTrueSurfaceZ: fallbackSurfZ };
  }
  const vp = mesh.vertProperties, tv = mesh.triVerts, stride = mesh.numProp || 3;
  const gMinX = -ctx.halfW - 1.0, gMaxX = ctx.halfW + 1.0, gMinY = -ctx.halfH - 1.0, gMaxY = ctx.halfH + 1.0;
  const nGrid = 32, invW = nGrid / Math.max(1e-6, gMaxX - gMinX), invH = nGrid / Math.max(1e-6, gMaxY - gMinY);
  const cells = Array.from({ length: nGrid * nGrid }, () => []);
  const topTris = [];

  for (let t = 0; t < tv.length; t += 3) {
    const i0 = tv[t] * stride, i1 = tv[t + 1] * stride, i2 = tv[t + 2] * stride;
    const ax = vp[i0], ay = vp[i0 + 1], az = vp[i0 + 2];
    const bx = vp[i1], by = vp[i1 + 1], bz = vp[i1 + 2];
    const cx = vp[i2], cy = vp[i2 + 1], cz = vp[i2 + 2];
    if (Math.max(az, bz, cz) <= 0.02) continue;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (det <= 1e-8) continue;
    const idx = topTris.length;
    topTris.push([ax, ay, az, bx, by, bz, cx, cy, cz, 1.0 / det]);
    const x0 = Math.max(0, Math.min(nGrid - 1, Math.floor((Math.min(ax, bx, cx) - gMinX) * invW)));
    const x1 = Math.max(0, Math.min(nGrid - 1, Math.floor((Math.max(ax, bx, cx) - gMinX) * invW)));
    const y0 = Math.max(0, Math.min(nGrid - 1, Math.floor((Math.min(ay, by, cy) - gMinY) * invH)));
    const y1 = Math.max(0, Math.min(nGrid - 1, Math.floor((Math.max(ay, by, cy) - gMinY) * invH)));
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) cells[gy * nGrid + gx].push(idx);
  }
  if (!topTris.length) return { getTinZ: fallbackTinZ, getTrueSurfaceZ: fallbackSurfZ };

  const getTinZ = (x, y) => {
    let best = ctx.getTerrainZ(x, y);
    const gx = Math.floor((x - gMinX) * invW), gy = Math.floor((y - gMinY) * invH);
    if (gx < 0 || gx >= nGrid || gy < 0 || gy >= nGrid) return best;
    const bucket = cells[gy * nGrid + gx];
    for (let k = 0; k < bucket.length; k++) {
      const tr = topTris[bucket[k]];
      const u = ((tr[4] - tr[7]) * (x - tr[6]) + (tr[6] - tr[3]) * (y - tr[7])) * tr[9];
      if (u < -1e-5 || u > 1.00001) continue;
      const v = ((tr[7] - tr[1]) * (x - tr[6]) + (tr[0] - tr[6]) * (y - tr[7])) * tr[9];
      if (v < -1e-5 || u + v > 1.00001) continue;
      const z = u * tr[2] + v * tr[5] + (1.0 - u - v) * tr[8];
      if (z > best) best = z;
    }
    return best;
  };
  const getTrueSurfaceZ = (x, y) => {
    if (terrainWater.isPointInWater(x, y)) return terrainWater.getSurfaceZ(x, y);
    const surf = terrainWater.getSurfaceZ(x, y);
    const relief = Math.max(0, surf - ctx.getTerrainZ(x, y));
    return Math.max(surf, getTinZ(x, y) + relief);
  };
  return { getTinZ, getTrueSurfaceZ };
}

function _sampleDryCrossSectionMinTopJS(px, py, nx, ny, widthU, outerRing, terrainWater, tinSampler, minDryReliefU, ctx) {
  let halfSpan = Math.max(0.12, widthU * 0.48);
  if (outerRing && outerRing.length >= 3) {
    let maxPolyLat = halfSpan;
    const ux = ny, uy = -nx;
    for (let i = 0, n = outerRing.length; i < n; i++) {
      const a = outerRing[i], b = outerRing[(i + 1) % n];
      const ua = (a[0] - px) * ux + (a[1] - py) * uy, ub = (b[0] - px) * ux + (b[1] - py) * uy;
      if ((ua <= 0 && ub >= 0) || (ub <= 0 && ua >= 0)) {
        const t = Math.abs(ub - ua) < 1e-8 ? 0.5 : -ua / (ub - ua);
        if (t >= 0 && t <= 1) {
          const lat = Math.abs((a[0] + (b[0] - a[0]) * t - px) * nx + (a[1] + (b[1] - a[1]) * t - py) * ny);
          if (lat < widthU * 1.35 && lat > maxPolyLat) maxPolyLat = lat * 0.94;
        }
      }
    }
    halfSpan = maxPolyLat;
  }
  let maxTinZ = -Infinity, maxSurfZ = -Infinity;
  for (const f of [-1.0, -0.5, 0.0, 0.5, 1.0]) {
    const sx = px + nx * (halfSpan * f), sy = py + ny * (halfSpan * f);
    if (Math.abs(sx) > ctx.halfW + 0.5 || Math.abs(sy) > ctx.halfH + 0.5) continue;
    if (terrainWater.isPointInWater(sx, sy)) continue;
    const tz = tinSampler.getTinZ(sx, sy), sz = tinSampler.getTrueSurfaceZ(sx, sy);
    if (tz > maxTinZ) maxTinZ = tz;
    if (sz > maxSurfZ) maxSurfZ = sz;
  }
  if (!Number.isFinite(maxTinZ)) {
    maxTinZ = tinSampler.getTinZ(px, py);
    maxSurfZ = tinSampler.getTrueSurfaceZ(px, py);
  }
  return Math.max(maxSurfZ, maxTinZ + minDryReliefU);
}

function _sampleAbutmentZJS(pt, outDirX, outDirY, outerRing, terrainWater, ctx, tinSampler, minDryReliefU) {
  let sx0 = pt[0], sy0 = pt[1];
  if (outerRing) {
    for (let k = 0; k < 5 && _ptInRingJS(sx0, sy0, outerRing); k++) { sx0 += outDirX * 0.45; sy0 += outDirY * 0.45; }
  }
  for (const d of [0.0, 0.35, 0.85, 1.6]) {
    const sx = sx0 + outDirX * d, sy = sy0 + outDirY * d;
    if (Math.abs(sx) <= ctx.halfW + 0.5 && Math.abs(sy) <= ctx.halfH + 0.5 && !terrainWater.isPointInWater(sx, sy)) {
      const zSurf = tinSampler ? tinSampler.getTrueSurfaceZ(sx, sy) : terrainWater.getSurfaceZ(sx, sy);
      const zFloor = tinSampler ? (tinSampler.getTinZ(sx, sy) + (minDryReliefU || 0)) : zSurf;
      return { z: Math.max(zSurf, zFloor), inWater: false };
    }
  }
  return { z: terrainWater.getSurfaceZ(pt[0], pt[1]), inWater: terrainWater.isPointInWater(pt[0], pt[1]) };
}

function _hasPositiveOsmLevelJS(rawLevel) {
  if (rawLevel === undefined || rawLevel === null || rawLevel === '') return false;
  const nums = String(rawLevel).split(/[;,]/).map(s => parseFloat(s.trim().replace(',', '.'))).filter(Number.isFinite);
  return nums.length > 0 && nums.every(v => v >= 1);
}

function _stationWaterFlagsJS(pts, terrainWater) {
  const n = pts.length, flags = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (terrainWater.isPointInWater(pts[i][0], pts[i][1])) { flags[i] = true; continue; }
    if (i > 0) {
      const mx = (pts[i - 1][0] + pts[i][0]) * 0.5, my = (pts[i - 1][1] + pts[i][1]) * 0.5;
      if (terrainWater.isPointInWater(mx, my)) { flags[i] = true; flags[i - 1] = true; }
    }
  }
  return flags;
}

const _BRIDGE_TIN_SAMPLER_EXPORTS = {
  _buildTinSurfaceSamplerJS, _sampleDryCrossSectionMinTopJS,
  _sampleAbutmentZJS, _hasPositiveOsmLevelJS, _stationWaterFlagsJS
};
if (typeof globalThis !== 'undefined') Object.assign(globalThis, _BRIDGE_TIN_SAMPLER_EXPORTS);
if (typeof window !== 'undefined') Object.assign(window, _BRIDGE_TIN_SAMPLER_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _BRIDGE_TIN_SAMPLER_EXPORTS;
