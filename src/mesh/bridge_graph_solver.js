// ============================================================================
// src/mesh/bridge_graph_solver.js
// Unified OSM Bridge Graph, Bed-Safe Coordinates, Local Grade Z(s) & Supports
// ============================================================================

if (typeof _normalizeBridgeStructJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./bridge_axis_helper.js'));
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
    if (f !== 0.0 && terrainWater.isPointInWater(sx, sy)) continue;
    if (f === 0.0 && terrainWater.isPointInWater(sx, sy)) continue;
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

function _bridgeCorridorPlateausJS(baseZArr, needArr, sArr, maxGapU) {
  const pos = [];
  for (let k = 0; k < needArr.length; k++) if (needArr[k] > 1e-4) pos.push(k);
  if (pos.length < 2) return;
  let cStart = 0;
  while (cStart < pos.length) {
    let cEnd = cStart;
    while (cEnd + 1 < pos.length && (sArr[pos[cEnd + 1]] - sArr[pos[cEnd]]) <= maxGapU) cEnd++;
    if (cEnd > cStart) {
      const i0 = pos[cStart], i1 = pos[cEnd], len = i1 - i0 + 1;
      const req = new Array(len);
      for (let m = cStart; m <= cEnd; m++) {
        const idx = pos[m];
        req[idx - i0] = baseZArr[idx] + needArr[idx];
        if (m < cEnd) {
          const nxt = pos[m + 1], rA = baseZArr[idx] + needArr[idx], rB = baseZArr[nxt] + needArr[nxt];
          const ds = Math.max(1e-6, sArr[nxt] - sArr[idx]);
          for (let q = idx + 1; q < nxt; q++) {
            req[q - i0] = rA + (rB - rA) * ((sArr[q] - sArr[idx]) / ds);
          }
        }
      }
      const lMax = new Array(len), rMax = new Array(len);
      lMax[0] = req[0];
      for (let m = 1; m < len; m++) lMax[m] = Math.max(lMax[m - 1], req[m]);
      rMax[len - 1] = req[len - 1];
      for (let m = len - 2; m >= 0; m--) rMax[m] = Math.max(rMax[m + 1], req[m]);
      for (let m = 0; m < len; m++) {
        const k = i0 + m, platZ = Math.max(req[m], Math.min(lMax[m], rMax[m]));
        if (platZ > baseZArr[k] + needArr[k]) needArr[k] = platZ - baseZArr[k];
      }
    }
    cStart = cEnd + 1;
  }
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

function _segClosestPair2DJS(a0, a1, b0, b1) {
  const ux = a1[0] - a0[0], uy = a1[1] - a0[1], vx = b1[0] - b0[0], vy = b1[1] - b0[1];
  const wx = a0[0] - b0[0], wy = a0[1] - b0[1];
  const a = ux * ux + uy * uy, b = ux * vx + uy * vy, c = vx * vx + vy * vy;
  const d = ux * wx + uy * wy, e = vx * wx + vy * wy, denom = a * c - b * b;
  let sc, sN, sD = denom, tc, tN, tD = denom;
  if (denom < 1e-10) { sN = 0.0; sD = 1.0; tN = e; tD = c; }
  else {
    sN = (b * e - c * d); tN = (a * e - b * d);
    if (sN < 0) { sN = 0; tN = e; tD = c; } else if (sN > sD) { sN = sD; tN = e + b; tD = c; }
  }
  if (tN < 0) {
    tN = 0;
    if (-d < 0) sN = 0; else if (-d > a) sN = sD; else { sN = -d; sD = a; }
  } else if (tN > tD) {
    tN = tD;
    if ((-d + b) < 0) sN = 0; else if ((-d + b) > a) sN = sD; else { sN = (-d + b); sD = a; }
  }
  sc = Math.abs(sN) < 1e-10 ? 0 : sN / sD;
  tc = Math.abs(tN) < 1e-10 ? 0 : tN / tD;
  const qa = [a0[0] + ux * sc, a0[1] + uy * sc], qb = [b0[0] + vx * tc, b0[1] + vy * tc];
  return { dist: Math.hypot(qa[0] - qb[0], qa[1] - qb[1]), sA: sc, tB: tc, qa, qb };
}

function _applyLocalSmoothLiftJS(zTopArr, zBotArr, sArr, spanU, needArr, baseRampU, pinStart, pinEnd) {
  const n = zTopArr.length, zRef = zTopArr.slice();
  for (let k = 0; k < n; k++) {
    if ((k === 0 && pinStart) || (k === n - 1 && pinEnd)) continue;
    const sk = sArr[k];
    const startTaper = pinStart ? Math.min(1.0, sk / Math.max(0.75, Math.min(spanU * 0.16, 2.2))) : 1.0;
    const endTaper = pinEnd ? Math.min(1.0, (spanU - sk) / Math.max(0.75, Math.min(spanU * 0.16, 2.2))) : 1.0;
    const pinEnv = Math.min(startTaper, endTaper);
    let lift = needArr[k] * pinEnv;
    for (let m = 0; m < n; m++) {
      const nm = needArr[m];
      if (nm <= 0) continue;
      const effNeed = Math.min(nm, Math.max(0, (zRef[m] + nm) - zRef[k]));
      if (effNeed * pinEnv <= lift) continue;
      const ramp = Math.max(baseRampU, Math.min(18.0, nm * 8.5));
      const ds = Math.abs(sk - sArr[m]);
      if (ds >= ramp) continue;
      const u = 1.0 - ds / ramp;
      const env = u * u * (3.0 - 2.0 * u) * pinEnv;
      if (effNeed * env > lift) lift = effNeed * env;
    }
    if (lift > 0) { zTopArr[k] += lift; zBotArr[k] += lift; }
  }
}

function solveBridgeGraph(scene, terrainWater, ctx) {
  const s2b = ctx.scaleToBed || 1.0;
  const toBed = typeof ctx.toBed === 'function' ? ctx.toBed : (p => [p[0] * s2b, p[1] * s2b]);
  const mToBedXY = ctx.mToU * s2b, mToBedZ = ctx.mToU * ctx.zScale * s2b;
  const minDeckU = (ctx.cfg ? ctx.cfg.bridgeDeckMinMm : 0.719) / ctx.scaleMm;
  const clipPad = 2.0, cMinX = -ctx.halfW - clipPad, cMaxX = ctx.halfW + clipPad, cMinY = -ctx.halfH - clipPad, cMaxY = ctx.halfH + clipPad;

  const rawPolys = (scene.bridgePolys || []).filter(bp => bp && !bp.isPier && bp.outer && bp.outer.length >= 3);
  const rawRoads = (scene.roads || []).filter(rd => rd && (rd.isBridge || rd.bridge) && rd.pts && rd.pts.length >= 2);
  const rawSupports = (scene.bridgeSupports || []).map(sp => ({
    ...sp, pt: sp.pt ? toBed(sp.pt) : null,
    outer: sp.outer ? sp.outer.map(toBed) : null,
    pts: sp.pts ? sp.pts.map(toBed) : null
  }));

  const groundRoads = [];
  for (const rd of (scene.roads || [])) {
    if (!rd || rd.isBridge || rd.bridge || !rd.pts || rd.pts.length < 2) continue;
    const hw = Math.max(0.18, ((rd.width || 0.7) * 0.5) * s2b);
    const lyr = rd.hasExplicitLayer ? (rd.layer ?? 0) : 0;
    for (const pc of _clipPolylineToRectJS(rd.pts.map(toBed), cMinX, cMinY, cMaxX, cMaxY)) {
      const bb = _bbox2DJS(pc.pts);
      groundRoads.push({
        pts: pc.pts, halfW: hw, layer: lyr, isPath: Boolean(rd.isPath),
        osmId: rd.osmId ?? null, name: rd.name || '',
        bbox: [bb[0] - hw, bb[1] - hw, bb[2] + hw, bb[3] + hw]
      });
    }
  }

  const allSceneRoadByOsmId = new Map();
  for (const rd of (scene.roads || [])) if (rd && rd.osmId != null) allSceneRoadByOsmId.set(rd.osmId, rd);

  const polyOuterByOsmId = new Map(), polyObjByOsmId = new Map(), roadLinkedPolyList = new Map();
  const specs = [];
  for (const bp of rawPolys) {
    const outer = bp.outer.map(toBed), pbb = _bbox2DJS(outer);
    if (pbb[2] < cMinX || pbb[0] > cMaxX || pbb[3] < cMinY || pbb[1] > cMaxY) continue;
    if (bp.osmId != null) { polyOuterByOsmId.set(bp.osmId, outer); polyObjByOsmId.set(bp.osmId, bp); }
    const holes = (bp.holes || []).map(h => h.map(toBed));
    const linked = rawRoads.filter(rd =>
      rd._bridgePolyOsmId === bp.osmId ||
      (Array.isArray(rd._bridgePolyOsmIds) && rd._bridgePolyOsmIds.includes(bp.osmId)) ||
      (bp.acrossRoadIds && bp.acrossRoadIds.includes(rd.osmId))
    );
    for (const rd of linked) {
      if (!roadLinkedPolyList.has(rd)) roadLinkedPolyList.set(rd, []);
      roadLinkedPolyList.get(rd).push({ bp, outer });
    }
    const surfaceAcross = (bp.acrossRoadIds || [])
      .map(id => allSceneRoadByOsmId.get(id))
      .filter(rd => rd && !(rd.isBridge || rd.bridge) && rd.pts && rd.pts.length >= 2);
    const axisCandidates = linked.length > 0 ? linked : surfaceAcross;
    const axisRaw = _extractClippedAxisFromRoadsJS(outer, axisCandidates.map(r => r.pts.map(toBed)), mToBedXY) || _extractCurvedSpineFromPolyJS(outer);
    const spanU = Math.max(0.4, _polyLenJS(axisRaw));
    const obb = typeof computeMinAreaOBB2D === 'function' ? computeMinAreaOBB2D(outer) : null;
    const estW = typeof _estimatePolyRibbonWidthJS === 'function' ? _estimatePolyRibbonWidthJS(outer, axisRaw, obb) : 1.5;
    const widthU = Math.max(minDeckU * 1.3, Number.isFinite(estW) ? estW : 1.5);
    const rawBpStruct = bp.bridgeStructure || (bp.tags && bp.tags['bridge:structure']);
    const rawBpTrim = String(rawBpStruct || '').trim().toLowerCase();
    const hasExplicitBpStruct = Boolean(rawBpTrim && !['yes', 'viaduct', 'bridge', 'movable'].includes(rawBpTrim));
    let structNorm = _normalizeBridgeStructJS(rawBpStruct, bp.covered, bp.tags);
    let expThrough = /through[-_ ]?arch|tied[-_ ]?arch|bowstring/i.test(String(rawBpStruct || ''));
    let isHumpback = /humpback/i.test(String(rawBpStruct || ''));
    let heightM = bp.heightM, clearanceM = bp.clearanceM;
    for (const rd of linked) {
      const rs = _normalizeBridgeStructJS(rd.bridgeStructure, rd.covered, rd.tags);
      if (!hasExplicitBpStruct && _structRankJS(rs) > _structRankJS(structNorm)) structNorm = rs;
      if (!hasExplicitBpStruct && /through[-_ ]?arch|tied[-_ ]?arch|bowstring/i.test(String(rd.bridgeStructure || ''))) expThrough = true;
      if (!hasExplicitBpStruct && /humpback/i.test(String(rd.bridgeStructure || ''))) isHumpback = true;
      if (heightM == null && rd.heightM != null) heightM = rd.heightM;
      if (clearanceM == null && rd.clearanceM != null) clearanceM = rd.clearanceM;
    }
    const allAcross = linked.concat(surfaceAcross);
    const carriedVerts = [];
    const acrossOsmIdSet = new Set(bp.acrossRoadIds || []);
    for (const cr of allAcross) {
      if (cr && cr.osmId != null) acrossOsmIdSet.add(cr.osmId);
      for (const p of (cr && cr.pts) || []) carriedVerts.push(toBed(p));
    }
    const hasExplicitBpLayer = Boolean((bp.tags && bp.tags.layer !== undefined) || bp.hasExplicitLayer);
    const inferredPolyLayer = (!hasExplicitBpLayer && linked.length > 0)
      ? Math.max(bp.layer ?? 1, ...linked.map(r => r.layer ?? 1))
      : (bp.layer ?? 1);
    const nSt = Math.max(7, Math.min(160, Math.ceil(spanU / 0.80) + 1));
    specs.push({
      isAreaPoly: true, outer, holes, pts: _resamplePolyJS(axisRaw, nSt),
      width: widthU, deckThick: Math.max(minDeckU, Math.min(widthU * 0.35, minDeckU * (structNorm === 'beam' ? 1.15 : 1.22))),
      deckLayer: inferredPolyLayer, name: bp.name || 'Most', structNorm, explicitThroughArch: expThrough, isHumpback,
      isRail: allAcross.length > 0 && allAcross.every(rd => rd.tags && rd.tags.railway),
      isPath: false, isBoardwalk: false, level: bp.level || '',
      clippedStart: false, clippedEnd: false, joinPolyStart: false, joinPolyEnd: false,
      acrossOsmIdSet, carriedVerts, linkedPolyOsmIds: [],
      heightM, minHeightM: bp.minHeightM, clearanceM, covered: bp.covered, supportIds: bp.supportIds || [], osmId: bp.osmId
    });
  }

  const polyOverlapU = Math.max(0.25, 0.6 * mToBedXY);
  const minOutsideSubU = Math.max(0.10, 0.8 * mToBedXY);
  const freeRoadPieces = [];
  for (const rd of rawRoads) {
    const linkedEntries = roadLinkedPolyList.get(rd) || [];
    const linkedPolyOsmIds = linkedEntries.map(e => e.bp && e.bp.osmId).filter(id => id != null);
    const rawSt = rd.bridgeStructure || rd.structure || (rd.tags && (rd.tags['bridge:structure'] || rd.tags.bridge));
    const cov = rd.covered || (rd.tags && rd.tags.covered);
    const isRail = Boolean((rd.tags && rd.tags.railway) || ['rail', 'light_rail', 'tram', 'monorail', 'subway', 'narrow_gauge', 'funicular'].includes(rd.hwy));
    const isBoardwalk = String((rd.tags && rd.tags.bridge) || rawSt || '').trim().toLowerCase() === 'boardwalk';
    let sourcePolylines;
    if (linkedEntries.length > 0) {
      const rings = linkedEntries.map(e => e.outer);
      const subs = typeof _splitPolylineOutsideRingsJS === 'function'
        ? _splitPolylineOutsideRingsJS(rd.pts.map(toBed), rings, polyOverlapU, minOutsideSubU)
        : [];
      if (!subs.length) continue;
      sourcePolylines = subs.filter(sub => !isBoardwalk || _stationWaterFlagsJS(sub.pts, terrainWater).some(Boolean));
      if (!sourcePolylines.length) continue;
    } else {
      sourcePolylines = [{ pts: rd.pts.map(toBed), entersRingAtStart: false, entersRingAtEnd: false }];
    }

    const effLayer = rd.hasExplicitLayer !== undefined
      ? (rd.hasExplicitLayer ? rd.layer : (linkedEntries.length > 0 ? (linkedEntries[0].bp.layer ?? 1) : 1))
      : (rd.layer ?? 1);
    for (const sub of sourcePolylines) {
      for (const pc of _clipPolylineToRectJS(sub.pts, cMinX, cMinY, cMaxX, cMaxY)) {
        freeRoadPieces.push({
          pts: pc.pts,
          clippedStart: pc.clippedStart,
          clippedEnd: pc.clippedEnd,
          joinPolyStart: Boolean(sub.entersRingAtStart && !pc.clippedStart),
          joinPolyEnd: Boolean(sub.entersRingAtEnd && !pc.clippedEnd),
          linkedPolyOsmIds,
          width: Math.max(isRail || rd.isPath ? 0.20 : 0.28, (rd.width || 0.8) * s2b),
          layer: effLayer,
          parentBridgeRelId: rd.parentBridgeRelId, name: rd.name || '',
          isRail, isPath: Boolean(rd.isPath), isBoardwalk, level: rd.level || (rd.tags && rd.tags.level) || '',
          structNorm: _normalizeBridgeStructJS(rawSt, cov, rd.tags),
          explicitThroughArch: /through[-_ ]?arch|tied[-_ ]?arch|bowstring/i.test(String(rawSt || '')),
          isHumpback: /humpback/i.test(String(rawSt || '')),
          heightM: rd.heightM, minHeightM: rd.minHeightM, clearanceM: rd.clearanceM, covered: cov, osmId: rd.osmId
        });
      }
    }
  }

  for (const r of _stitchAndMergeLinearBridgesJS(freeRoadPieces, { mToBedXY, scaleMm: ctx.scaleMm })) {
    const spanU = Math.max(0.4, _polyLenJS(r.pts));
    const spanMetersLinear = spanU / Math.max(1e-5, mToBedXY);
    const isShortPolyStub = Boolean((r.joinPolyStart || r.joinPolyEnd) && spanMetersLinear < 25.0);
    const effStruct = (isShortPolyStub || (spanMetersLinear < 14.0 && !r.explicitThroughArch && r.structNorm === 'arch'))
      ? 'beam'
      : r.structNorm;
    const slender = Boolean(r.isRail || r.isPath);
    const minW = slender ? Math.max(0.54 / ctx.scaleMm, minDeckU * 0.78) : minDeckU * 1.12;
    const widthU = Math.max(minW, r.width);
    const deckThick = Math.max(slender ? Math.max(0.56 / ctx.scaleMm, minDeckU * 0.82) : minDeckU, Math.min(widthU * 0.40, minDeckU * 1.15));
    const nSt = Math.max(7, Math.min(160, Math.ceil(spanU / 0.80) + 1));
    const resampledPts = _resamplePolyJS(r.pts, nSt);
    specs.push({
      isAreaPoly: false, outer: null, holes: [], pts: resampledPts,
      width: widthU, deckThick, deckLayer: r.layer ?? 1, name: r.name, structNorm: effStruct,
      explicitThroughArch: Boolean(!isShortPolyStub && r.explicitThroughArch),
      isHumpback: Boolean(!isShortPolyStub && r.isHumpback),
      isRail: Boolean(r.isRail),
      isPath: Boolean(r.isPath), isBoardwalk: Boolean(r.isBoardwalk), level: r.level || '',
      clippedStart: Boolean(r.clippedStart), clippedEnd: Boolean(r.clippedEnd),
      joinPolyStart: Boolean(r.joinPolyStart), joinPolyEnd: Boolean(r.joinPolyEnd),
      acrossOsmIdSet: null, carriedVerts: [resampledPts[0], resampledPts[resampledPts.length - 1]],
      linkedPolyOsmIds: r.linkedPolyOsmIds || [],
      heightM: r.heightM, minHeightM: r.minHeightM, clearanceM: r.clearanceM, covered: r.covered, supportIds: [], osmId: r.osmId
    });
  }

  const tinSampler = _buildTinSurfaceSamplerJS(terrainWater, ctx);
  const minDryReliefU = Math.max(terrainWater.hRoadU || 0.19, 0.45 / ctx.scaleMm, 0.18);
  const airClearWater = Math.max(0.32, 0.48 / ctx.scaleMm, minDeckU * 0.55);
  const baseLandClearU = Math.max(0.30, 0.48 / ctx.scaleMm, Math.min(1.15, 4.8 * mToBedZ));

  for (const sp of specs) {
    const pts = sp.pts, n = pts.length, L = Math.max(0.2, _polyLenJS(pts));
    sp.spanU = L;
    const t0x = pts[1][0] - pts[0][0], t0y = pts[1][1] - pts[0][1], l0 = Math.hypot(t0x, t0y) || 1;
    const t1x = pts[n - 1][0] - pts[n - 2][0], t1y = pts[n - 1][1] - pts[n - 2][1], l1 = Math.hypot(t1x, t1y) || 1;
    const abA = _sampleAbutmentZJS(pts[0], -t0x / l0, -t0y / l0, sp.outer, terrainWater, ctx, tinSampler, minDryReliefU);
    const abB = _sampleAbutmentZJS(pts[n - 1], t1x / l1, t1y / l1, sp.outer, terrainWater, ctx, tinSampler, minDryReliefU);
    sp.zAbutmentA = abA.z; sp.zAbutmentB = abB.z;
    const inW = _stationWaterFlagsJS(pts, terrainWater);
    sp.inWater = inW; sp.crossesWater = inW.some(Boolean);
    sp.isElevatedViaduct = Boolean((sp.isRail && sp.deckLayer >= 2) || (sp.deckLayer >= 2 && sp.clippedStart && sp.clippedEnd));

    const cumS = [0];
    for (let i = 1; i < n; i++) cumS.push(cumS[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    sp.sArr = cumS;

    const baseStart = abA.inWater ? Math.max(abA.z, ctx.zWaterTop + sp.deckThick + airClearWater) : abA.z;
    const baseEnd = abB.inWater ? Math.max(abB.z, ctx.zWaterTop + sp.deckThick + airClearWater) : abB.z;
    const waterFrac = inW.filter(Boolean).length / Math.max(1, n);

    // Long multi-km viaducts (>900m, mostly dry) also clear mid-route hills without ever dipping into gorges
    const chordTop = cumS.map(s => baseStart + (baseEnd - baseStart) * (s / L));
    const spanMetersEst = L / Math.max(1e-5, mToBedXY);
    let baseTop;
    if (spanMetersEst > 900.0 && waterFrac < 0.45) {
      const rawDry = pts.map((p, i) => i === 0 ? baseStart : i === n - 1 ? baseEnd : (inW[i] ? null : tinSampler.getTrueSurfaceZ(p[0], p[1])));
      if (rawDry[0] == null) rawDry[0] = baseStart;
      if (rawDry[n - 1] == null) rawDry[n - 1] = baseEnd;
      let prevIdx = 0;
      for (let i = 1; i < n; i++) {
        if (rawDry[i] != null) {
          for (let m = prevIdx + 1; m < i; m++) {
            const f = (cumS[m] - cumS[prevIdx]) / Math.max(1e-5, cumS[i] - cumS[prevIdx]);
            rawDry[m] = rawDry[prevIdx] + (rawDry[i] - rawDry[prevIdx]) * f;
          }
          prevIdx = i;
        }
      }
      baseTop = rawDry.map((z, i) => {
        if (i === 0 || i === n - 1) return z;
        const sm = (rawDry[i - 1] + 2 * z + rawDry[i + 1]) * 0.25;
        return sp.isElevatedViaduct ? sm : Math.max(chordTop[i], sm);
      });
    } else {
      baseTop = chordTop;
    }

    const zTopArr = baseTop.slice();

    // Local water-span camber per contiguous water crossing (eliminates 5.55x ski-jump over dry land)
    let wi = 0;
    while (wi < n) {
      if (!inW[wi]) { wi++; continue; }
      let w0 = wi;
      while (wi + 1 < n && inW[wi + 1]) wi++;
      const w1 = wi++;
      const bL = Math.max(0, w0 - 1), bR = Math.min(n - 1, w1 + 1);
      const spanW = Math.max(0.5, cumS[bR] - cumS[bL]);
      const clearNeedU = (sp.clearanceM != null && sp.clearanceM > 0)
        ? Math.min(spanW * 0.24, Math.max(airClearWater, sp.clearanceM * mToBedZ)) : airClearWater;
      const reqW = ctx.zWaterTop + sp.deckThick + clearNeedU;
      let maxDef = 0;
      for (let k = w0; k <= w1; k++) if (reqW > baseTop[k]) maxDef = Math.max(maxDef, reqW - baseTop[k]);
      if (maxDef > 0) {
        const rampU = Math.min(L * 0.38, Math.max(3.0, maxDef * 6.0));
        const s0 = w0 === 0 ? 0 : Math.max(0, cumS[w0] - rampU);
        const s1 = w1 === n - 1 ? L : Math.min(L, cumS[w1] + rampU);
        for (let k = 0; k < n; k++) {
          if ((k === 0 && !abA.inWater && !sp.clippedStart && !sp.joinPolyStart) || (k === n - 1 && !abB.inWater && !sp.clippedEnd && !sp.joinPolyEnd)) continue;
          const sk = cumS[k];
          if (sk < s0 || sk > s1) continue;
          let lift = 0;
          if (k >= w0 && k <= w1) {
            const uW = Math.max(0, Math.min(1, (sk - cumS[bL]) / spanW));
            lift = Math.max(reqW - baseTop[k], maxDef * (1.0 + 0.08 * Math.sin(Math.PI * uW)));
          } else if (sk < cumS[w0]) {
            const u = (sk - s0) / Math.max(1e-5, cumS[w0] - s0);
            lift = maxDef * u * u * (3 - 2 * u);
          } else {
            const u = (s1 - sk) / Math.max(1e-5, s1 - cumS[w1]);
            lift = maxDef * u * u * (3 - 2 * u);
          }
          if (baseTop[k] + lift > zTopArr[k]) zTopArr[k] = baseTop[k] + lift;
        }
      }
      for (let k = w0; k <= w1; k++) {
        if ((k === 0 && !abA.inWater) || (k === n - 1 && !abB.inWater)) continue;
        zTopArr[k] = Math.max(zTopArr[k], ctx.zWaterTop + sp.deckThick + airClearWater);
      }
    }

    const zBotArr = zTopArr.map(zt => zt - sp.deckThick);
    sp.bbox = _bbox2DJS(sp.isAreaPoly ? sp.outer : pts);
    if (!sp.isAreaPoly) { sp.bbox[0] -= sp.width * 0.6; sp.bbox[1] -= sp.width * 0.6; sp.bbox[2] += sp.width * 0.6; sp.bbox[3] += sp.width * 0.6; }

    // Detect elevated skybridge terminals (e.g. level>=1 concourse or footbridge dead-end without ground path connection)
    const endSnapU = Math.max(0.55, sp.width * 0.70 + 0.25);
    const hasPosLvl = _hasPositiveOsmLevelJS(sp.level);
    let touchesGroundStart = false, touchesGroundEnd = false;
    for (const gr of groundRoads) {
      if (gr.layer > 0) continue;
      const g0 = gr.pts[0], g1 = gr.pts[gr.pts.length - 1];
      if (!touchesGroundStart && (Math.hypot(g0[0] - pts[0][0], g0[1] - pts[0][1]) <= endSnapU || Math.hypot(g1[0] - pts[0][0], g1[1] - pts[0][1]) <= endSnapU)) touchesGroundStart = true;
      if (!touchesGroundEnd && (Math.hypot(g0[0] - pts[n - 1][0], g0[1] - pts[n - 1][1]) <= endSnapU || Math.hypot(g1[0] - pts[n - 1][0], g1[1] - pts[n - 1][1]) <= endSnapU)) touchesGroundEnd = true;
      if (touchesGroundStart && touchesGroundEnd) break;
    }
    const isSkyFootway = Boolean(sp.isPath && sp.deckLayer >= 1 && !sp.isBoardwalk && (hasPosLvl || !sp.crossesWater));
    sp.elevatedDeadEndStart = Boolean(isSkyFootway && !sp.clippedStart && !sp.joinPolyStart && !abA.inWater && (hasPosLvl || !touchesGroundStart));
    sp.elevatedDeadEndEnd = Boolean(isSkyFootway && !sp.clippedEnd && !sp.joinPolyEnd && !abB.inWater && (hasPosLvl || !touchesGroundEnd));

    const pinA = !sp.isElevatedViaduct && !sp.clippedStart && !sp.joinPolyStart && !sp.elevatedDeadEndStart && !abA.inWater;
    const pinB = !sp.isElevatedViaduct && !sp.clippedEnd && !sp.joinPolyEnd && !sp.elevatedDeadEndEnd && !abB.inWater;
    const endZoneU = Math.min(L * 0.20, Math.max(0.95, sp.width * 1.25));
    const natSlope = Math.abs(baseEnd - baseStart) / Math.max(1.0, L);
    const gradeLim = Math.max(natSlope + 0.035, (sp.isRail ? 0.055 : (sp.isPath ? 0.13 : 0.095)) * (ctx.zScale || 1.0));
    const zAnchorA = zTopArr[0], zAnchorB = zTopArr[n - 1];
    const maxGradeTopAt = (sk) => Math.min(
      pinA ? zAnchorA + gradeLim * sk : Infinity,
      pinB ? zAnchorB + gradeLim * Math.max(0, L - sk) : Infinity
    );

    // 1. Dry-land layer>=1 bridge span envelope over flat terrain (preserves natural valley/gorge bridges)
    if (!sp.crossesWater && sp.deckLayer >= 1 && !sp.isBoardwalk && !sp.isElevatedViaduct && n >= 3) {
      let maxNatClear = -Infinity;
      for (let k = 1; k < n - 1; k++) {
        maxNatClear = Math.max(maxNatClear, (chordTop[k] - sp.deckThick) - tinSampler.getTrueSurfaceZ(pts[k][0], pts[k][1]));
      }
      if (maxNatClear < baseLandClearU * 0.90) {
        const freeStart = sp.clippedStart || sp.joinPolyStart || sp.elevatedDeadEndStart;
        const freeEnd = sp.clippedEnd || sp.joinPolyEnd || sp.elevatedDeadEndEnd;
        const ramp = Math.min(L * 0.20, Math.max(1.2, baseLandClearU * 4.2));
        for (let k = 0; k < n; k++) {
          if ((k === 0 && !freeStart) || (k === n - 1 && !freeEnd)) continue;
          const sk = cumS[k];
          const wA = freeStart ? 1.0 : Math.min(1.0, sk / Math.max(1e-4, ramp));
          const wB = freeEnd ? 1.0 : Math.min(1.0, (L - sk) / Math.max(1e-4, ramp));
          const env = Math.min(wA * wA * (3 - 2 * wA), wB * wB * (3 - 2 * wB));
          const rawReq = tinSampler.getTrueSurfaceZ(pts[k][0], pts[k][1]) + baseLandClearU * env + sp.deckThick;
          const reqTop = Math.min(rawReq, maxGradeTopAt(sk));
          if (reqTop > zTopArr[k]) { zTopArr[k] = reqTop; zBotArr[k] = reqTop - sp.deckThick; }
        }
      }
    }

    // 2. Explicit clearance over lower-layer ground streets (layer=0 / cut roads) & elevated viaducts
    const landNeed = new Array(n).fill(0);
    if (sp.isElevatedViaduct) {
      const viadClearU = baseLandClearU + Math.min(0.42, 3.0 * mToBedZ) * Math.max(0, Math.min(2, sp.deckLayer - 1));
      for (let k = 0; k < n; k++) {
        if (inW[k]) continue;
        const reqTop = tinSampler.getTrueSurfaceZ(pts[k][0], pts[k][1]) + viadClearU + sp.deckThick;
        if (reqTop > zTopArr[k]) landNeed[k] = Math.max(landNeed[k], reqTop - zTopArr[k]);
      }
    }

    const pedLandClearU = Math.max(0.24, 0.36 / ctx.scaleMm, Math.min(0.62, 2.5 * mToBedZ));
    const juncSnapU = Math.max(0.25, 2.2 * mToBedXY);
    const cvList = sp.carriedVerts || [];

    if (!sp.isBoardwalk || sp.deckLayer >= 2) {
      for (const gr of groundRoads) {
        if (gr.layer >= sp.deckLayer) continue;
        if (sp.deckLayer >= 0 && gr.layer < 0) continue;
        if (sp.acrossOsmIdSet && gr.osmId != null && sp.acrossOsmIdSet.has(gr.osmId)) continue;
        if (sp.name && gr.name && sp.name === gr.name) continue;
        if (sp.bbox[2] < gr.bbox[0] || sp.bbox[0] > gr.bbox[2] || sp.bbox[3] < gr.bbox[1] || sp.bbox[1] > gr.bbox[3]) continue;
        const g0 = gr.pts[0], g1 = gr.pts[gr.pts.length - 1];
        if (cvList.length > 0 && cvList.some(cv => Math.hypot(g0[0] - cv[0], g0[1] - cv[1]) <= juncSnapU || Math.hypot(g1[0] - cv[0], g1[1] - cv[1]) <= juncSnapU)) {
          continue;
        }
        const touchesStartAbutment = pinA && (Math.hypot(g0[0] - pts[0][0], g0[1] - pts[0][1]) <= endSnapU || Math.hypot(g1[0] - pts[0][0], g1[1] - pts[0][1]) <= endSnapU);
        const touchesEndAbutment = pinB && (Math.hypot(g0[0] - pts[n - 1][0], g0[1] - pts[n - 1][1]) <= endSnapU || Math.hypot(g1[0] - pts[n - 1][0], g1[1] - pts[n - 1][1]) <= endSnapU);
        const rad = sp.width * 0.5 + gr.halfW + 0.08;
        const clearU = gr.isPath ? pedLandClearU : baseLandClearU;
        for (let k = 0; k < n - 1; k++) {
          const bdx = pts[k + 1][0] - pts[k][0], bdy = pts[k + 1][1] - pts[k][1], bl = Math.hypot(bdx, bdy) || 1;
          for (let q = 0; q < gr.pts.length - 1; q++) {
            const cp = _segClosestPair2DJS(pts[k], pts[k + 1], gr.pts[q], gr.pts[q + 1]);
            if (cp.dist > rad) continue;
            const sHit = cumS[k] + (cumS[k + 1] - cumS[k]) * cp.sA;
            const gdx = gr.pts[q + 1][0] - gr.pts[q][0], gdy = gr.pts[q + 1][1] - gr.pts[q][1], gl = Math.hypot(gdx, gdy) || 1;
            const absDot = Math.abs((bdx / bl) * (gdx / gl) + (bdy / bl) * (gdy / gl));
            if (absDot >= 0.72) continue;
            if (pinA && sHit <= endZoneU * 1.35 && (touchesStartAbutment || absDot >= 0.52)) continue;
            if (pinB && (L - sHit) <= endZoneU * 1.35 && (touchesEndAbutment || absDot >= 0.52)) continue;
            if (terrainWater.isPointInWater(cp.qb[0], cp.qb[1])) continue;
            const zGr = Math.max(tinSampler.getTrueSurfaceZ(cp.qb[0], cp.qb[1]), tinSampler.getTinZ(cp.qb[0], cp.qb[1]) + (terrainWater.hRoadU || 0));
            const rawReqTop = zGr + clearU + sp.deckThick;
            const reqTop = sp.isElevatedViaduct ? rawReqTop : Math.min(rawReqTop, maxGradeTopAt(sHit));
            const zCur = zTopArr[k] + (zTopArr[k + 1] - zTopArr[k]) * cp.sA;
            if (reqTop > zCur) {
              const def = reqTop - zCur;
              if (!(k === 0 && pinA)) landNeed[k] = Math.max(landNeed[k], Math.min(def, Math.max(0, maxGradeTopAt(cumS[k]) - zTopArr[k])));
              if (!(k + 1 === n - 1 && pinB)) landNeed[k + 1] = Math.max(landNeed[k + 1], Math.min(def, Math.max(0, maxGradeTopAt(cumS[k + 1]) - zTopArr[k + 1])));
            }
          }
        }
      }
    }

    if (landNeed.some(v => v > 0)) {
      _bridgeCorridorPlateausJS(zTopArr, landNeed, cumS, Math.max(2.5 / ctx.scaleMm, 55.0 * mToBedXY));
      if (!sp.isElevatedViaduct) {
        for (let k = 0; k < n; k++) {
          const cap = Math.max(0, maxGradeTopAt(cumS[k]) - zTopArr[k]);
          if (landNeed[k] > cap) landNeed[k] = cap;
        }
      }
      _applyLocalSmoothLiftJS(zTopArr, zBotArr, cumS, L, landNeed, 3.8, pinA, pinB);
    }

    // 3. Strict Delatin TIN cross-section floor across every dry-land station (prevents TIN triangle bleed-through)
    for (let k = 0; k < n; k++) {
      if (inW[k]) continue;
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], dl = Math.hypot(dx, dy) || 1;
      const minDryTop = _sampleDryCrossSectionMinTopJS(
        pts[k][0], pts[k][1], -dy / dl, dx / dl, sp.width, sp.outer, terrainWater, tinSampler, minDryReliefU, ctx
      );
      if (minDryTop > zTopArr[k]) {
        zTopArr[k] = minDryTop;
        zBotArr[k] = minDryTop - sp.deckThick;
      }
    }

    // 4. Eliminate concave mid-water sags between lifted shore approaches (guarantees smooth convex/chord span over water)
    if (sp.crossesWater && n >= 3) {
      const shoreBandU = Math.min(L * 0.36, Math.max(3.5, 65.0 * mToBedXY));
      let sw = 0;
      while (sw < n) {
        if (!inW[sw]) { sw++; continue; }
        const w0 = sw;
        while (sw + 1 < n && inW[sw + 1]) sw++;
        const w1 = sw++;
        let iPeakL = Math.max(0, w0 - 1), zPeakL = zTopArr[iPeakL];
        for (let k = iPeakL; k >= 0 && (cumS[w0] - cumS[k]) <= shoreBandU; k--) {
          if (inW[k] && k < w0) break;
          if (zTopArr[k] >= zPeakL) { zPeakL = zTopArr[k]; iPeakL = k; }
        }
        let iPeakR = Math.min(n - 1, w1 + 1), zPeakR = zTopArr[iPeakR];
        for (let k = iPeakR; k < n && (cumS[k] - cumS[w1]) <= shoreBandU; k++) {
          if (inW[k] && k > w1) break;
          if (zTopArr[k] >= zPeakR) { zPeakR = zTopArr[k]; iPeakR = k; }
        }
        if (iPeakR > iPeakL + 1) {
          const spanBridge = Math.max(1e-4, cumS[iPeakR] - cumS[iPeakL]);
          const camberAmp = Math.min(0.30 / ctx.scaleMm, spanBridge * (sp.isHumpback ? 0.022 : 0.008));
          for (let k = iPeakL; k <= iPeakR; k++) {
            const u = (cumS[k] - cumS[iPeakL]) / spanBridge;
            const zNoSag = zPeakL + (zPeakR - zPeakL) * u + camberAmp * Math.sin(Math.PI * u);
            if (zNoSag > zTopArr[k]) {
              zTopArr[k] = zNoSag;
              zBotArr[k] = zNoSag - sp.deckThick;
            }
          }
        }
      }
    }
    if (!inW[0] && !abA.inWater && !sp.elevatedDeadEndStart && !sp.isElevatedViaduct && !sp.joinPolyStart) sp.zAbutmentA = zTopArr[0];
    if (!inW[n - 1] && !abB.inWater && !sp.elevatedDeadEndEnd && !sp.isElevatedViaduct && !sp.joinPolyEnd) sp.zAbutmentB = zTopArr[n - 1];

    sp.zTopArr = zTopArr;
    sp.zBotArr = zBotArr;
  }

  // Smoothly weld split approach extensions into their linked man_made=bridge area decks
  const areaSpecs = specs.filter(s => s.isAreaPoly && s.outer && s.outer.length >= 3);
  if (areaSpecs.length > 0) {
    for (const sp of specs) {
      if (sp.isAreaPoly || (!sp.joinPolyStart && !sp.joinPolyEnd)) continue;
      for (const [atStart, idx] of [[true, 0], [false, sp.pts.length - 1]]) {
        if (atStart ? !sp.joinPolyStart : !sp.joinPolyEnd) continue;
        const ep = sp.pts[idx];
        const targetArea = areaSpecs.find(as => _ptInRingJS(ep[0], ep[1], as.outer)) ||
          areaSpecs.find(as => typeof _ptToPolyDist2DJS === 'function' && _ptToPolyDist2DJS(ep[0], ep[1], as.outer) <= 0.8);
        if (!targetArea) continue;
        let nearZ = targetArea.zTopArr[0], nearD = Infinity;
        for (let q = 0; q < targetArea.pts.length; q++) {
          const d = Math.hypot(ep[0] - targetArea.pts[q][0], ep[1] - targetArea.pts[q][1]);
          if (d < nearD) { nearD = d; nearZ = targetArea.zTopArr[q]; }
        }
        const dz = nearZ - sp.zTopArr[idx];
        if (Math.abs(dz) > 0.005 && Math.abs(dz) < 3.5) {
          const rU = Math.min(sp.spanU * 0.45, Math.max(1.8, Math.abs(dz) * 6.0));
          for (let m = 0; m < sp.pts.length; m++) {
            const ds = atStart ? sp.sArr[m] : (sp.spanU - sp.sArr[m]);
            if (ds < rU) { const u = 1 - ds / rU, w = dz * u * u * (3 - 2 * u); sp.zTopArr[m] += w; sp.zBotArr[m] += w; }
          }
        }
      }
    }
  }

  // Multi-deck bridge-over-bridge clearance using local lower-deck Z and local longitudinal ramp
  specs.sort((a, b) => a.deckLayer - b.deckLayer);
  const gapU = Math.max(0.30, 0.48 / ctx.scaleMm, minDeckU * 0.48);

  const findButtJoints = (lo, hi, hitRad) => {
    const out = [];
    if (Boolean(hi.isRail) !== Boolean(lo.isRail) || hi.deckLayer - lo.deckLayer !== 1) return out;
    const hiMid = hi.pts[hi.pts.length >> 1];
    let minMidDist = Infinity;
    for (let q = 0; q < lo.pts.length; q++) minMidDist = Math.min(minMidDist, Math.hypot(hiMid[0] - lo.pts[q][0], hiMid[1] - lo.pts[q][1]));
    if (minMidDist <= hitRad * 1.6) return out;
    const joinSnap = Math.max(1.1, (hi.width + lo.width) * 0.65);
    for (const [hiAtStart, hiIdx] of [[true, 0], [false, hi.pts.length - 1]]) {
      const tHi = _outTan2DJS(hi.pts, hiAtStart), pHi = hi.pts[hiIdx];
      for (const [loAtStart, loIdx] of [[true, 0], [false, lo.pts.length - 1]]) {
        const tLo = _outTan2DJS(lo.pts, loAtStart), pLo = lo.pts[loIdx];
        if (Math.hypot(pHi[0] - pLo[0], pHi[1] - pLo[1]) <= joinSnap && -(tHi[0] * tLo[0] + tHi[1] * tLo[1]) >= 0.68) {
          out.push({ hiAtStart, loAtStart, hiIdx, loIdx });
        }
      }
    }
    return out;
  };

  // Pre-align collinear layer -> layer+1 butt-joints before multi-deck separation so no bridge is ever pulled down afterward
  for (let i = 0; i < specs.length; i++) {
    const hi = specs[i];
    for (let j = 0; j < i; j++) {
      const lo = specs[j];
      const hitRad = Math.max(0.82, (hi.width + lo.width) * 0.54);
      for (const bj of findButtJoints(lo, hi, hitRad)) {
        const zJoin = Math.max(hi.zTopArr[bj.hiIdx], lo.zTopArr[bj.loIdx]);
        const dHi = zJoin - hi.zTopArr[bj.hiIdx], dLo = zJoin - lo.zTopArr[bj.loIdx];
        if (dHi > 0.01 && dHi < 2.5) {
          const rU = Math.min(hi.spanU * 0.32, Math.max(2.2, dHi * 6.0));
          for (let m = 0; m < hi.pts.length; m++) {
            const ds = bj.hiAtStart ? hi.sArr[m] : (hi.spanU - hi.sArr[m]);
            if (ds < rU) { const u = 1 - ds / rU, w = dHi * u * u * (3 - 2 * u); hi.zTopArr[m] += w; hi.zBotArr[m] += w; }
          }
        }
        if (dLo > 0.01 && dLo < 2.5) {
          const rU = Math.min(lo.spanU * 0.32, Math.max(2.2, dLo * 6.0));
          for (let m = 0; m < lo.pts.length; m++) {
            const ds = bj.loAtStart ? lo.sArr[m] : (lo.spanU - lo.sArr[m]);
            if (ds < rU) { const u = 1 - ds / rU, w = dLo * u * u * (3 - 2 * u); lo.zTopArr[m] += w; lo.zBotArr[m] += w; }
          }
        }
      }
    }
  }

  for (let i = 0; i < specs.length; i++) {
    const hi = specs[i];
    const combinedNeed = new Array(hi.pts.length).fill(0);
    for (let j = 0; j < i; j++) {
      const lo = specs[j];
      if (lo.deckLayer >= hi.deckLayer || hi.bbox[2] + 0.9 < lo.bbox[0] || hi.bbox[0] - 0.9 > lo.bbox[2] || hi.bbox[3] + 0.9 < lo.bbox[1] || hi.bbox[1] - 0.9 > lo.bbox[3]) continue;
      if ((lo.isAreaPoly && lo.osmId != null && hi.linkedPolyOsmIds && hi.linkedPolyOsmIds.includes(lo.osmId)) ||
          (hi.isAreaPoly && hi.osmId != null && lo.linkedPolyOsmIds && lo.linkedPolyOsmIds.includes(hi.osmId))) {
        continue;
      }
      const hitRad = Math.max(0.82, (hi.width + lo.width) * 0.54);
      const segRad = (hi.width + lo.width) * 0.54;
      const buttJoints = findButtJoints(lo, hi, hitRad);
      const jointZoneU = Math.max(2.4, (hi.width + lo.width) * 1.15);
      const isNearButtJoint = (sHi, sLo) => buttJoints.some(bj =>
        (bj.hiAtStart ? sHi : hi.spanU - sHi) <= jointZoneU &&
        (bj.loAtStart ? sLo : lo.spanU - sLo) <= jointZoneU
      );

      for (let k = 0; k < hi.pts.length; k++) {
        const hp = hi.pts[k], sHiK = hi.sArr[k];
        let reqBot = -Infinity;
        if (lo.isAreaPoly && _ptInRingJS(hp[0], hp[1], lo.outer)) {
          let nearZ = lo.zTopArr[0], nearD = Infinity, nearS = 0;
          for (let q = 0; q < lo.pts.length; q++) {
            const d = Math.hypot(hp[0] - lo.pts[q][0], hp[1] - lo.pts[q][1]);
            if (d < nearD) { nearD = d; nearZ = lo.zTopArr[q]; nearS = lo.sArr[q]; }
          }
          if (!isNearButtJoint(sHiK, nearS)) reqBot = Math.max(reqBot, nearZ + gapU);
        }
        for (let q = 0; q < lo.pts.length; q++) {
          if (!isNearButtJoint(sHiK, lo.sArr[q]) && Math.hypot(hp[0] - lo.pts[q][0], hp[1] - lo.pts[q][1]) <= hitRad) {
            reqBot = Math.max(reqBot, lo.zTopArr[q] + gapU);
          }
        }
        for (let q = 0; q < lo.pts.length - 1; q++) {
          const a = lo.pts[q], b = lo.pts[q + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
          const t = Math.max(0, Math.min(1, ((hp[0] - a[0]) * dx + (hp[1] - a[1]) * dy) / l2));
          const sLoT = lo.sArr[q] + Math.sqrt(l2) * t;
          if (!isNearButtJoint(sHiK, sLoT) && Math.hypot(hp[0] - (a[0] + dx * t), hp[1] - (a[1] + dy * t)) <= hitRad) {
            reqBot = Math.max(reqBot, lo.zTopArr[q] + (lo.zTopArr[q + 1] - lo.zTopArr[q]) * t + gapU);
          }
          if (k < hi.pts.length - 1) {
            const cp = _segClosestPair2DJS(hp, hi.pts[k + 1], a, b);
            const sHiCp = sHiK + (hi.sArr[k + 1] - sHiK) * cp.sA;
            const sLoCp = lo.sArr[q] + (lo.sArr[q + 1] - lo.sArr[q]) * cp.tB;
            if (!isNearButtJoint(sHiCp, sLoCp) && cp.dist <= segRad) {
              const loZ = lo.zTopArr[q] + (lo.zTopArr[q + 1] - lo.zTopArr[q]) * cp.tB + gapU;
              const hiBotAtS = hi.zBotArr[k] + (hi.zBotArr[k + 1] - hi.zBotArr[k]) * cp.sA;
              if (loZ > hiBotAtS) {
                combinedNeed[k] = Math.max(combinedNeed[k], loZ - hiBotAtS);
                combinedNeed[k + 1] = Math.max(combinedNeed[k + 1], loZ - hiBotAtS);
              }
            }
          }
        }
        if (reqBot > hi.zBotArr[k]) combinedNeed[k] = Math.max(combinedNeed[k], reqBot - hi.zBotArr[k]);
      }
    }
    if (combinedNeed.some(v => v > 0)) {
      _bridgeCorridorPlateausJS(hi.zBotArr, combinedNeed, hi.sArr, Math.max(2.0 / ctx.scaleMm, 45.0 * mToBedXY));
      _applyLocalSmoothLiftJS(hi.zTopArr, hi.zBotArr, hi.sArr, hi.spanU, combinedNeed, 4.5, false, false);
    }
  }

  for (const sp of specs) {
    sp.explicitSupports = [];
    const maxDist = Math.max(sp.width * 0.85, Math.min(2.2, 12.0 * mToBedXY + 0.6));
    for (const sup of rawSupports) {
      if (!sup.pt) continue;
      const byId = sup.osmId != null && sp.supportIds.includes(sup.osmId);
      const inside = sp.isAreaPoly && _ptInRingJS(sup.pt[0], sup.pt[1], sp.outer);
      let bestS = 0, bestD = Infinity;
      for (let i = 0; i < sp.pts.length - 1; i++) {
        const a = sp.pts[i], b = sp.pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, ((sup.pt[0] - a[0]) * dx + (sup.pt[1] - a[1]) * dy) / l2));
        const d = Math.hypot(sup.pt[0] - (a[0] + dx * t), sup.pt[1] - (a[1] + dy * t));
        if (d < bestD) { bestD = d; bestS = sp.sArr[i] + Math.sqrt(l2) * t; }
      }
      if (byId || inside || bestD <= maxDist) sp.explicitSupports.push({ ...sup, sProj: bestS, distToAxis: bestD });
    }
    sp.explicitSupports.sort((a, b) => a.sProj - b.sProj);
  }
  return specs;
}

const _GRAPH_SOLVER_EXPORTS = { solveBridgeGraph };
if (typeof window !== 'undefined') Object.assign(window, _GRAPH_SOLVER_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _GRAPH_SOLVER_EXPORTS;
