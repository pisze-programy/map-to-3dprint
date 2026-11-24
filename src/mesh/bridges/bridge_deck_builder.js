// ============================================================================
// src/mesh/bridges/bridge_deck_builder.js
// Watertight Curved Z(s) Bridge Decks, Flush Abutments & >= 35° Corbels
// ============================================================================

if (typeof manifoldFromRawSoup === 'undefined' && typeof require !== 'undefined') {
  Object.assign(globalThis, require('../../geometry/manifold_core.js'));
}

function _stationTangentsJS(pts) {
  const n = pts.length, tans = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    tans.push([dx / l, dy / l]);
  }
  return tans;
}

function _buildClosedStationTubeJS(pts, halfW, zBotArr, zTopArr, mf, minThickU = 0.03) {
  const n = pts.length;
  if (n < 2) return null;
  const tans = _stationTangentsJS(pts);
  const verts = [], tris = [];
  let prevL = null, prevR = null;
  for (let i = 0; i < n; i++) {
    const [tx, ty] = tans[i];
    let miter = 1.0;
    if (i > 0 && i < n - 1) {
      const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
      const l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1, l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
      const d = ((p1[0] - p0[0]) / l1) * ((p2[0] - p1[0]) / l2) + ((p1[1] - p0[1]) / l1) * ((p2[1] - p1[1]) / l2);
      if (d < 0.28) return null;
      miter = Math.min(1.32, 1.0 / Math.max(0.68, Math.sqrt(0.5 * (1 + d))));
    }
    const rx = ty * halfW * miter, ry = -tx * halfW * miter;
    const lp = [pts[i][0] - rx, pts[i][1] - ry], rp = [pts[i][0] + rx, pts[i][1] + ry];
    if (prevL && (((lp[0] - prevL[0]) * tx + (lp[1] - prevL[1]) * ty) <= 0.002 || ((rp[0] - prevR[0]) * tx + (rp[1] - prevR[1]) * ty) <= 0.002)) {
      return null;
    }
    prevL = lp; prevR = rp;
    const zb = zBotArr[i], zt = Math.max(zb + minThickU, zTopArr[i]);
    verts.push(lp[0], lp[1], zb, rp[0], rp[1], zb, rp[0], rp[1], zt, lp[0], lp[1], zt);
  }
  tris.push(0, 1, 2, 0, 2, 3);
  const e = 4 * (n - 1);
  tris.push(e, e + 2, e + 1, e, e + 3, e + 2);
  for (let k = 0; k < n - 1; k++) {
    const b = 4 * k, c = 4 * (k + 1);
    tris.push(b, c, c + 1, b, c + 1, b + 1);
    tris.push(b + 1, c + 1, c + 2, b + 1, c + 2, b + 2);
    tris.push(b + 2, c + 2, c + 3, b + 2, c + 3, b + 3);
    tris.push(b + 3, c + 3, c, b + 3, c, b);
  }
  return manifoldFromRawSoup(mf, verts, tris);
}

function _buildSegmentUnionTubeJS(pts, halfW, zBotArr, zTopArr, mf, minThickU = 0.03) {
  const parts = [], n = pts.length;
  const cornerSharp = new Array(n).fill(false);
  for (let i = 1; i < n - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    const l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1, l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
    const dot = ((p1[0] - p0[0]) / l1) * ((p2[0] - p1[0]) / l2) + ((p1[1] - p0[1]) / l1) * ((p2[1] - p1[1]) / l2);
    if (dot < 0.55) cornerSharp[i] = true;
    if (dot < 0.992) {
      const zb = Math.max(zBotArr[i - 1], zBotArr[i], zBotArr[i + 1]);
      const ztLow = Math.min(zTopArr[i - 1], zTopArr[i], zTopArr[i + 1]);
      const zt = Math.max(zb + minThickU, ztLow);
      const jc = mf.Manifold.cylinder(zt - zb, halfW * 0.998, halfW * 0.998, 20, false).translate([p1[0], p1[1], zb]);
      parts.push(jc);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 0.005) continue;
    const tx = dx / len, ty = dy / len;
    const extA = (i === 0 || cornerSharp[i]) ? 0 : Math.min(halfW * 0.28, len * 0.25);
    const extB = (i === n - 2 || cornerSharp[i + 1]) ? 0 : Math.min(halfW * 0.28, len * 0.25);
    const segPts = [[a[0] - tx * extA, a[1] - ty * extA], [b[0] + tx * extB, b[1] + ty * extB]];
    const m = _buildClosedStationTubeJS(segPts, halfW, [zBotArr[i], zBotArr[i + 1]], [zTopArr[i], zTopArr[i + 1]], mf, minThickU);
    if (m) parts.push(m);
  }
  return parts.length ? batchUnionManifolds(mf, parts) : null;
}

function _buildSlopedWedgeCorbelJS(pA, pB, halfW, zBotA, zBotB, zTopA, zTopB, mf, minThickU = 0.03) {
  const dx = pB[0] - pA[0], dy = pB[1] - pA[1], l = Math.hypot(dx, dy);
  if (l < 0.015) return null;
  return _buildClosedStationTubeJS([pA, pB], halfW, [zBotA, zBotB], [zTopA, zTopB], mf, minThickU);
}

function _distPtToPolyDeckJS(px, py, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
    const d = Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
    if (d < best) best = d;
  }
  return best;
}

function buildSlopedBridgeDeck(spec, mf) {
  const scaleMm = spec.scaleMm || 1.89;
  const minThickU = Math.min(0.05, 0.08 / scaleMm);
  const flatTolU = Math.min(0.08, 0.12 / scaleMm);
  const zTopMin = Math.min(...spec.zTopArr), zTopMax = Math.max(...spec.zTopArr);
  const zBotMin = Math.min(...spec.zBotArr), zBotMax = Math.max(...spec.zBotArr);
  const isFlat = (zTopMax - zTopMin) <= flatTolU && (zBotMax - zBotMin) <= flatTolU;

  if (spec.isAreaPoly && spec.outer && spec.outer.length >= 3) {
    if (isFlat) {
      return extrudeRingSolid(mf, spec.outer, spec.holes || [], zBotMin, zTopMax);
    }
    const col = extrudeRingSolid(mf, spec.outer, spec.holes || [], zBotMin - 0.5, zTopMax + 0.5);
    if (!col) return null;
    const pts = spec.pts, n = pts.length;
    const t0x = pts[1][0] - pts[0][0], t0y = pts[1][1] - pts[0][1], l0 = Math.hypot(t0x, t0y) || 1;
    const t1x = pts[n - 1][0] - pts[n - 2][0], t1y = pts[n - 1][1] - pts[n - 2][1], l1 = Math.hypot(t1x, t1y) || 1;
    const extDist = Math.max(0.4 / scaleMm, Math.min(3.0, (spec.spanU || 4.0) * 0.18));
    const extPts = [[pts[0][0] - (t0x / l0) * extDist, pts[0][1] - (t0y / l0) * extDist]].concat(
      pts,
      [[pts[n - 1][0] + (t1x / l1) * extDist, pts[n - 1][1] + (t1y / l1) * extDist]]
    );
    const ezB = [spec.zBotArr[0]].concat(spec.zBotArr, [spec.zBotArr[n - 1]]);
    const ezT = [spec.zTopArr[0]].concat(spec.zTopArr, [spec.zTopArr[n - 1]]);
    let trueMaxLat = spec.width * 0.55;
    for (const p of spec.outer) trueMaxLat = Math.max(trueMaxLat, _distPtToPolyDeckJS(p[0], p[1], extPts));
    const envHalfW = Math.max(spec.width * 0.60, Math.min(trueMaxLat + Math.min(0.35, spec.width * 0.25), spec.width * 4.0 + 4.0));
    const env = _buildClosedStationTubeJS(extPts, envHalfW, ezB, ezT, mf, minThickU) || _buildSegmentUnionTubeJS(extPts, envHalfW, ezB, ezT, mf, minThickU);
    if (!env) { col.delete(); return extrudeRingSolid(mf, spec.outer, spec.holes || [], zBotMin, zTopMax); }
    try { const out = col.intersect(env); col.delete(); env.delete(); return out; } catch (_) { env.delete(); return col; }
  }

  return _buildClosedStationTubeJS(spec.pts, spec.width * 0.5, spec.zBotArr, spec.zTopArr, mf, minThickU) ||
         _buildSegmentUnionTubeJS(spec.pts, spec.width * 0.5, spec.zBotArr, spec.zTopArr, mf, minThickU);
}

function _lerpArrAtSJS(sArr, valArr, s) {
  if (s <= sArr[0]) return valArr[0];
  const n = sArr.length;
  if (s >= sArr[n - 1]) return valArr[n - 1];
  let i = 0;
  while (i < n - 2 && sArr[i + 1] < s) i++;
  const seg = (sArr[i + 1] - sArr[i]) || 1e-6;
  return valArr[i] + (valArr[i + 1] - valArr[i]) * ((s - sArr[i]) / seg);
}

function _samplePtAtSJS(spec, s) {
  const sArr = spec.sArr, pts = spec.pts, n = pts.length;
  if (s <= sArr[0]) return { pt: pts[0], tx: (pts[1][0] - pts[0][0]) / (sArr[1] || 1), ty: (pts[1][1] - pts[0][1]) / (sArr[1] || 1) };
  if (s >= sArr[n - 1]) {
    const d = Math.hypot(pts[n - 1][0] - pts[n - 2][0], pts[n - 1][1] - pts[n - 2][1]) || 1;
    return { pt: pts[n - 1], tx: (pts[n - 1][0] - pts[n - 2][0]) / d, ty: (pts[n - 1][1] - pts[n - 2][1]) / d };
  }
  let i = 0;
  while (i < n - 2 && sArr[i + 1] < s) i++;
  const seg = (sArr[i + 1] - sArr[i]) || 1e-6, t = (s - sArr[i]) / seg;
  const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], dl = Math.hypot(dx, dy) || 1;
  return { pt: [pts[i][0] + dx * t, pts[i][1] + dy * t], tx: dx / dl, ty: dy / dl };
}

function _safeSubDeckCapZJS(spec, sPos, radiusU, scaleMm = 1.89) {
  const s0 = Math.max(0, sPos - radiusU), s1 = Math.min(spec.spanU || 0, sPos + radiusU);
  const zbMin = Math.min(
    _lerpArrAtSJS(spec.sArr, spec.zBotArr, sPos),
    _lerpArrAtSJS(spec.sArr, spec.zBotArr, s0),
    _lerpArrAtSJS(spec.sArr, spec.zBotArr, s1)
  );
  const ztMin = Math.min(
    _lerpArrAtSJS(spec.sArr, spec.zTopArr, sPos),
    _lerpArrAtSJS(spec.sArr, spec.zTopArr, s0),
    _lerpArrAtSJS(spec.sArr, spec.zTopArr, s1)
  );
  const marginTop = Math.max(0.06 / scaleMm, spec.deckThick * 0.24);
  const embedUp = Math.min(spec.deckThick * 0.45, 0.18 / scaleMm);
  return Math.min(ztMin - marginTop, zbMin + embedUp);
}

/**
 * Probes outward from a bridge endpoint along (ox, oy) to locate dry riverbank terrain
 * while staying within the active print-bed bounds.
 * @param {number[]} pt
 * @param {number} ox
 * @param {number} oy
 * @param {number} widthU
 * @param {object} terrainWater
 * @param {object} ctx
 * @param {number} maxProbeU
 * @param {number} scaleMm
 * @returns {{ dFirstDry: number|null, dFullDry: number|null, maxInBedU: number }}
 */
function _probeOutwardDryBankJS(pt, ox, oy, widthU, terrainWater, ctx, maxProbeU, scaleMm) {
  let maxInBedU = maxProbeU;
  if (Number.isFinite(ctx.halfW) && Number.isFinite(ctx.halfH)) {
    const margin = 0.05;
    const limX = Math.max(0.1, ctx.halfW - margin);
    const limY = Math.max(0.1, ctx.halfH - margin);
    if (Math.abs(ox) > 1e-6) {
      const txLim = ox > 0 ? (limX - pt[0]) / ox : (-limX - pt[0]) / ox;
      maxInBedU = Math.min(maxInBedU, Math.max(0, txLim));
    }
    if (Math.abs(oy) > 1e-6) {
      const tyLim = oy > 0 ? (limY - pt[1]) / oy : (-limY - pt[1]) / oy;
      maxInBedU = Math.min(maxInBedU, Math.max(0, tyLim));
    }
  }
  const stepU = Math.max(0.08 / scaleMm, 0.20 / scaleMm);
  const latOff = Math.max(0.12 / scaleMm, widthU * 0.42);
  const nx = -oy, ny = ox;
  let dFirstDry = null;
  let dFullDry = null;
  for (let d = 0; d <= maxInBedU + 1e-6; d += stepU) {
    const dc = Math.min(d, maxInBedU);
    const cx = pt[0] + ox * dc, cy = pt[1] + oy * dc;
    const cDry = !terrainWater.isPointInWater(cx, cy);
    if (cDry && dFirstDry === null) dFirstDry = dc;
    if (cDry && dFullDry === null) {
      const lDry = !terrainWater.isPointInWater(cx + nx * latOff, cy + ny * latOff);
      const rDry = !terrainWater.isPointInWater(cx - nx * latOff, cy - ny * latOff);
      if (lDry && rDry) {
        dFullDry = dc;
        break;
      }
    }
  }
  return { dFirstDry, dFullDry, maxInBedU };
}

/**
 * Extends a water-terminating bridge endpoint flush into the nearby dry riverbank with
 * both a deck continuation and solid masonry abutment block (zero embankment air gap).
 * @returns {boolean} True when dry bank was located and anchored
 */
function _buildExtendedWaterEndAbutmentJS(spec, idx, isStart, pt, tx, ty, wHalf, sinkU, minThickU, terrainWater, ctx, parts) {
  const mf = ctx.mf;
  const scaleMm = ctx.scaleMm || spec.scaleMm || 1.89;
  const outSign = isStart ? -1 : 1;
  const ox = outSign * tx, oy = outSign * ty;
  const probe = _probeOutwardDryBankJS(pt, ox, oy, spec.width, terrainWater, ctx, 5.0 / scaleMm, scaleMm);
  if (probe.dFirstDry === null || probe.dFirstDry > 4.8 / scaleMm) return false;

  const dFull = probe.dFullDry !== null ? probe.dFullDry : probe.dFirstDry;
  const embedDryU = Math.min(1.15 / scaleMm, Math.max(0.85 / scaleMm, spec.width * 0.55));
  let dReach = Math.min(probe.maxInBedU, dFull + embedDryU);
  const backStepU = 0.15 / scaleMm;
  while (dReach > probe.dFirstDry + backStepU) {
    const ex = pt[0] + ox * dReach, ey = pt[1] + oy * dReach;
    if (!terrainWater.isPointInWater(ex, ey)) break;
    dReach -= backStepU;
  }
  if (dReach <= probe.dFirstDry + 0.12 / scaleMm) return false;

  const inOverlap = Math.min(0.45 / scaleMm, Math.max(0.18 / scaleMm, spec.spanU * 0.10));
  const pIn = [pt[0] - ox * inOverlap, pt[1] - oy * inOverlap];
  const pOut = [pt[0] + ox * dReach, pt[1] + oy * dReach];
  const deckA = isStart ? pOut : pIn;
  const deckB = isStart ? pIn : pOut;
  const zBotEnd = spec.zBotArr[idx];
  const zTopEnd = spec.zTopArr[idx];
  const deckHalfW = Math.max(wHalf, spec.width * 0.50);
  const deckExt = _buildSlopedWedgeCorbelJS(deckA, deckB, deckHalfW, zBotEnd, zBotEnd, zTopEnd, zTopEnd, mf, minThickU);
  if (deckExt) parts.push(deckExt);

  const drySurfZ = terrainWater.getSurfaceZ(pOut[0], pOut[1]);
  const dryFloorZ = Math.max(0.0, Math.min(drySurfZ, zBotEnd) - sinkU);
  const waterFloorZ = ctx.waterCutout ? 0.0 : dryFloorZ;
  const meetZEnd = Math.min(zTopEnd - 0.04 / scaleMm, zBotEnd + Math.min(spec.deckThick * 0.45, 0.14 / scaleMm));
  const abutHalfW = Math.max(wHalf, spec.width * 0.48);

  if (meetZEnd > waterFloorZ + minThickU) {
    if (probe.dFirstDry <= 2.4 / scaleMm) {
      // Seal quay margin solidly into dry bank so arch/beam springings anchor flush with 0 mm gap.
      const abut = _buildSlopedWedgeCorbelJS(deckA, deckB, abutHalfW, waterFloorZ, waterFloorZ, meetZEnd, meetZEnd, mf, minThickU);
      if (abut) parts.push(abut);
    } else {
      // Wide margin (> 2.4 mm): place sleek bank-edge pier at pt, dry embankment block, and angled haunch.
      const pierHalfL = Math.max(0.32 / scaleMm, Math.min(0.42 / scaleMm, spec.width * 0.35));
      const pPierA = [pt[0] - ox * pierHalfL, pt[1] - oy * pierHalfL];
      const pPierB = [pt[0] + ox * pierHalfL, pt[1] + oy * pierHalfL];
      const pier = _buildSlopedWedgeCorbelJS(
        isStart ? pPierB : pPierA, isStart ? pPierA : pPierB, abutHalfW, waterFloorZ, waterFloorZ, meetZEnd, meetZEnd, mf, minThickU
      );
      if (pier) parts.push(pier);
      const dBankStart = Math.max(0, probe.dFirstDry - 0.22 / scaleMm);
      const pBankIn = [pt[0] + ox * dBankStart, pt[1] + oy * dBankStart];
      const bankAbut = _buildSlopedWedgeCorbelJS(
        isStart ? pOut : pBankIn, isStart ? pBankIn : pOut, abutHalfW, dryFloorZ, dryFloorZ, meetZEnd, meetZEnd, mf, minThickU
      );
      if (bankAbut) parts.push(bankAbut);
      const zHaunchLow = Math.max(waterFloorZ + 0.40 / scaleMm, meetZEnd - Math.min(2.2 / scaleMm, (dBankStart - pierHalfL) * 0.95));
      if (dBankStart > pierHalfL + 0.20 / scaleMm && meetZEnd > zHaunchLow + minThickU) {
        const pMid = [(pPierB[0] + pBankIn[0]) * 0.5, (pPierB[1] + pBankIn[1]) * 0.5];
        const h1 = _buildSlopedWedgeCorbelJS(pPierB, pMid, abutHalfW * 0.92, zHaunchLow, zBotEnd - 0.12 / scaleMm, meetZEnd, meetZEnd, mf, minThickU);
        const h2 = _buildSlopedWedgeCorbelJS(pMid, pBankIn, abutHalfW * 0.92, zBotEnd - 0.12 / scaleMm, zHaunchLow, meetZEnd, meetZEnd, mf, minThickU);
        if (h1) parts.push(h1);
        if (h2) parts.push(h2);
      }
    }
  }
  return true;
}

function buildBankAbutments(spec, terrainWater, ctx) {
  const mf = ctx.mf, parts = [];
  const scaleMm = ctx.scaleMm || spec.scaleMm || 1.89;
  const minThickU = Math.min(0.05, 0.08 / scaleMm);
  const wHalf = Math.max(0.16 / scaleMm, spec.width * 0.46);
  const basePadL = Math.min(spec.spanU * 0.12, Math.max(0.28 / scaleMm, Math.min(1.0 / scaleMm, spec.width * 0.55)));
  const sinkU = Math.min(0.55, 0.85 / scaleMm);

  for (const idx of [0, spec.pts.length - 1]) {
    const isStart = idx === 0;
    if (isStart && (spec.clippedStart || spec.joinPolyStart || spec.joinBridgeStart || spec.joinPierStart)) continue;
    if (!isStart && (spec.clippedEnd || spec.joinPolyEnd || spec.joinBridgeEnd || spec.joinPierEnd)) continue;

    const sPos = isStart ? 0 : spec.spanU;
    const { pt, tx, ty } = _samplePtAtSJS(spec, sPos);
    if (Math.abs(pt[0]) > ctx.halfW + 0.05 || Math.abs(pt[1]) > ctx.halfH + 0.05) continue;

    const ptInWater = terrainWater.isPointInWater(pt[0], pt[1]);
    const surfZ = terrainWater.getSurfaceZ(pt[0], pt[1]);
    const floorZ = ctx.waterCutout && ptInWater ? 0.0 : Math.max(0.0, Math.min(surfZ, spec.zBotArr[idx]) - sinkU);
    const isSkyDeadEnd = Boolean(
      spec.isPath &&
      ((isStart ? spec.elevatedDeadEndStart : spec.elevatedDeadEndEnd) ||
       (!ptInWater && spec.deckLayer >= 1 && spec.zBotArr[idx] > surfZ + 0.35 / scaleMm))
    );

    if (spec.isElevatedViaduct || isSkyDeadEnd) {
      const colR = Math.max(0.24 / scaleMm, Math.min(spec.width * 0.36, 0.50 / scaleMm));
      const inset = Math.min(spec.width * 0.40, colR * 1.15, spec.spanU * 0.16);
      const sCol = isStart ? inset : Math.max(0, spec.spanU - inset);
      const meetColZ = _safeSubDeckCapZJS(spec, sCol, colR, scaleMm);
      if (meetColZ > floorZ + minThickU) {
        const px = pt[0] + (isStart ? 1 : -1) * tx * inset;
        const py = pt[1] + (isStart ? 1 : -1) * ty * inset;
        const col = beamManifoldBetween(mf, [px, py, floorZ], [px, py, meetColZ], colR);
        if (col) parts.push(col);
      }
      continue;
    }

    if (spec.crossesWater && ptInWater) {
      if (_buildExtendedWaterEndAbutmentJS(spec, idx, isStart, pt, tx, ty, wHalf, sinkU, minThickU, terrainWater, ctx, parts)) {
        continue;
      }
    }

    const inSign = isStart ? 1 : -1;
    let padIn = basePadL;
    if (!ptInWater) {
      for (const f of [0.25, 0.5, 0.75, 1.0]) {
        const sx = pt[0] + inSign * tx * (basePadL * f);
        const sy = pt[1] + inSign * ty * (basePadL * f);
        if (terrainWater.isPointInWater(sx, sy)) {
          padIn = basePadL * Math.max(0.12, f - 0.22);
          break;
        }
      }
    }

    const isPolyDeck = Boolean(spec.isAreaPoly && spec.outer && spec.outer.length >= 3);
    const effPadIn = isPolyDeck ? Math.max(padIn, Math.min(spec.spanU * 0.16, 1.4 / scaleMm)) : padIn;
    const meetZ = _safeSubDeckCapZJS(spec, isStart ? effPadIn * 0.5 : (spec.spanU - effPadIn * 0.5), effPadIn * 0.5, scaleMm);
    if (meetZ > floorZ + minThickU) {
      const backPad = isPolyDeck
        ? Math.max(0.45 / scaleMm, Math.min(2.0, spec.spanU * 0.06))
        : Math.min(0.08 / scaleMm, padIn * 0.18);
      const pA = isStart
        ? [pt[0] - tx * backPad, pt[1] - ty * backPad]
        : [pt[0] - tx * effPadIn, pt[1] - ty * effPadIn];
      const pB = isStart
        ? [pt[0] + tx * effPadIn, pt[1] + ty * effPadIn]
        : [pt[0] + tx * backPad, pt[1] + ty * backPad];
      let blkHalfW = Math.min(wHalf, spec.width * 0.46);
      if (isPolyDeck) {
        for (const op of spec.outer) {
          const lat = Math.abs(-ty * (op[0] - pt[0]) + tx * (op[1] - pt[1]));
          if (lat < spec.width * 3.0 + 2.0 && lat + 0.15 > blkHalfW) blkHalfW = lat + 0.15;
        }
      }
      let blk = _buildSlopedWedgeCorbelJS(pA, pB, blkHalfW, floorZ, floorZ, meetZ, meetZ, mf, minThickU);
      if (blk && isPolyDeck) {
        const mask = extrudeRingSolid(mf, spec.outer, spec.holes || [], floorZ - 0.1, meetZ + 0.1);
        if (mask) {
          try {
            const clipped = blk.intersect(mask);
            mask.delete();
            if (clipped && clipped.numTri() > 0) { blk.delete(); blk = clipped; }
            else if (clipped) clipped.delete();
          } catch (_) { mask.delete(); }
        }
      }
      if (blk) parts.push(blk);
    }

    // Smooth outward dry-land approach transition (or flush bank embed) so abutments seat deeply on dry embankments.
    const dzAboveGround = spec.zTopArr[idx] - surfZ;
    const outSign = isStart ? -1 : 1;
    if (!ptInWater && dzAboveGround > 0.10 / scaleMm && dzAboveGround < 3.2 / scaleMm) {
      const maxRampOut = Math.min(2.6 / scaleMm, Math.max(spec.crossesWater ? 0.90 / scaleMm : 0.45 / scaleMm, dzAboveGround * 3.2));
      let rampOut = maxRampOut;
      for (const f of [0.25, 0.5, 0.75, 1.0]) {
        const rx = pt[0] + outSign * tx * (maxRampOut * f);
        const ry = pt[1] + outSign * ty * (maxRampOut * f);
        if (Math.abs(rx) > ctx.halfW - 0.05 || Math.abs(ry) > ctx.halfH - 0.05 || terrainWater.isPointInWater(rx, ry)) {
          rampOut = maxRampOut * Math.max(0, f - 0.25);
          break;
        }
      }
      if (rampOut >= 0.22 / scaleMm) {
        const endPt = [pt[0] + outSign * tx * rampOut, pt[1] + outSign * ty * rampOut];
        const endSurfZ = terrainWater.getSurfaceZ(endPt[0], endPt[1]);
        const endFloorZ = Math.max(0.0, Math.min(floorZ, endSurfZ - 0.25 / scaleMm));
        const inOverlap = isPolyDeck ? Math.min(0.28 / scaleMm, spec.spanU * 0.08) : Math.min(0.12 / scaleMm, spec.spanU * 0.05);
        const overlapPt = [pt[0] - outSign * tx * inOverlap, pt[1] - outSign * ty * inOverlap];
        const rampA = isStart ? endPt : overlapPt;
        const rampB = isStart ? overlapPt : endPt;
        const zTopA = isStart ? endSurfZ : spec.zTopArr[idx];
        const zTopB = isStart ? spec.zTopArr[idx] : endSurfZ;
        const zBotA = isStart ? endFloorZ : floorZ;
        const zBotB = isStart ? floorZ : endFloorZ;
        const rampWedge = _buildSlopedWedgeCorbelJS(rampA, rampB, spec.width * 0.48, zBotA, zBotB, zTopA, zTopB, mf, minThickU);
        if (rampWedge) parts.push(rampWedge);
      }
    } else if (!ptInWater && spec.crossesWater && dzAboveGround <= 0.10 / scaleMm) {
      const targetOut = 0.85 / scaleMm;
      let dryOut = targetOut;
      for (const f of [0.25, 0.5, 0.75, 1.0]) {
        const rx = pt[0] + outSign * tx * (targetOut * f);
        const ry = pt[1] + outSign * ty * (targetOut * f);
        if (Math.abs(rx) > ctx.halfW - 0.05 || Math.abs(ry) > ctx.halfH - 0.05 || terrainWater.isPointInWater(rx, ry)) {
          dryOut = targetOut * Math.max(0, f - 0.25);
          break;
        }
      }
      if (dryOut >= 0.22 / scaleMm && meetZ > floorZ + minThickU) {
        const endPt = [pt[0] + outSign * tx * dryOut, pt[1] + outSign * ty * dryOut];
        const inOverlap = Math.min(0.28 / scaleMm, spec.spanU * 0.08);
        const overlapPt = [pt[0] - outSign * tx * inOverlap, pt[1] - outSign * ty * inOverlap];
        const anc = _buildSlopedWedgeCorbelJS(
          isStart ? endPt : overlapPt, isStart ? overlapPt : endPt,
          spec.width * 0.48, floorZ, floorZ, Math.max(meetZ, spec.zTopArr[idx] - 0.02 / scaleMm), Math.max(meetZ, spec.zTopArr[idx] - 0.02 / scaleMm),
          mf, minThickU
        );
        if (anc) parts.push(anc);
      }
    }
  }
  return parts;
}

function buildSupportlessUndersideCorbels(spec, supportStationsS, terrainWater, ctx) {
  if (!ctx.supportlessMode || spec.isPierGangway) return [];
  const scaleMm = ctx.scaleMm || spec.scaleMm || 1.89;
  const minThickU = Math.min(0.05, 0.08 / scaleMm);
  const mf = ctx.mf, parts = [], tanMin = Math.tan(42 * Math.PI / 180);
  const endPad = Math.min(0.25, 0.45 / scaleMm);
  const stops = [0, ...supportStationsS.filter(s => s > endPad && s < spec.spanU - endPad), spec.spanU].sort((a, b) => a - b);
  const corbelHalfW = Math.max(0.18 / scaleMm, spec.width * 0.42);
  const deckJoinUp = Math.min(spec.deckThick * 0.35, 0.14 / scaleMm);

  for (let i = 0; i < stops.length - 1; i++) {
    const sA = stops[i], sB = stops[i + 1], subSpanU = sB - sA;
    if (subSpanU * scaleMm <= 1.8) continue;
    const zBotA = _lerpArrAtSJS(spec.sArr, spec.zBotArr, sA), zBotB = _lerpArrAtSJS(spec.sArr, spec.zBotArr, sB);
    const zMinWaterGuard = spec.inWater.some(Boolean) ? ctx.zWaterTop + 0.24 / scaleMm : 0.05 / scaleMm;
    const availL = Math.max(0.20 / scaleMm, (zBotA - zMinWaterGuard) * 0.85);
    const availR = Math.max(0.20 / scaleMm, (zBotB - zMinWaterGuard) * 0.85);
    const dropL = Math.min(availL, subSpanU * 0.48 * tanMin);
    const dropR = Math.min(availR, subSpanU * 0.48 * tanMin);
    const sLend = Math.min(sB, sA + Math.max(0.18 / scaleMm, dropL / tanMin));
    const sRend = Math.max(sA, sB - Math.max(0.18 / scaleMm, dropR / tanMin));
    const pA = _samplePtAtSJS(spec, sA), pL = _samplePtAtSJS(spec, sLend);
    const pR = _samplePtAtSJS(spec, sRend), pB = _samplePtAtSJS(spec, sB);
    const zBotL = _lerpArrAtSJS(spec.sArr, spec.zBotArr, sLend), zBotR = _lerpArrAtSJS(spec.sArr, spec.zBotArr, sRend);
    const topAL = Math.min(_lerpArrAtSJS(spec.sArr, spec.zTopArr, sA) - 0.05 / scaleMm, zBotA + deckJoinUp);
    const topLL = Math.min(_lerpArrAtSJS(spec.sArr, spec.zTopArr, sLend) - 0.05 / scaleMm, zBotL + deckJoinUp);
    const topRR = Math.min(_lerpArrAtSJS(spec.sArr, spec.zTopArr, sRend) - 0.05 / scaleMm, zBotR + deckJoinUp);
    const topBR = Math.min(_lerpArrAtSJS(spec.sArr, spec.zTopArr, sB) - 0.05 / scaleMm, zBotB + deckJoinUp);
    const cL = _buildSlopedWedgeCorbelJS(pA.pt, pL.pt, corbelHalfW, Math.max(0.04 / scaleMm, zBotA - dropL), zBotL - 0.02 / scaleMm, topAL, topLL, mf, minThickU);
    const cR = _buildSlopedWedgeCorbelJS(pR.pt, pB.pt, corbelHalfW, zBotR - 0.02 / scaleMm, Math.max(0.04 / scaleMm, zBotB - dropR), topRR, topBR, mf, minThickU);
    if (cL) parts.push(cL);
    if (cR) parts.push(cR);
    const mPts = [], mzB = [], mzT = [], steps = 5;
    for (let k = 0; k <= steps; k++) {
      const sk = sA + (k / steps) * subSpanU, pk = _samplePtAtSJS(spec, sk).pt;
      const zb = _lerpArrAtSJS(spec.sArr, spec.zBotArr, sk);
      const zt = _lerpArrAtSJS(spec.sArr, spec.zTopArr, sk);
      const u = Math.sin(Math.PI * (k / steps));
      const keelDrop = Math.min(Math.max(0.24 / scaleMm, corbelHalfW * tanMin), Math.max(0.18 / scaleMm, (zb - zMinWaterGuard) * 0.48));
      mPts.push(pk);
      mzT.push(Math.min(zt - 0.05 / scaleMm, zb + deckJoinUp));
      mzB.push(Math.max(zMinWaterGuard, zb - keelDrop * (1 - 0.32 * u)));
    }
    const keelW = Math.max(0.18 / scaleMm, corbelHalfW * 0.45);
    const keel = _buildClosedStationTubeJS(mPts, keelW, mzB, mzT, mf, minThickU) || _buildSegmentUnionTubeJS(mPts, keelW, mzB, mzT, mf, minThickU);
    if (keel) parts.push(keel);
  }
  return parts;
}

const _DECK_BUILDER_EXPORTS = {
  buildSlopedBridgeDeck, buildBankAbutments, buildSupportlessUndersideCorbels,
  _lerpArrAtSJS, _samplePtAtSJS, _safeSubDeckCapZJS, _buildSlopedWedgeCorbelJS
};
if (typeof globalThis !== 'undefined') Object.assign(globalThis, _DECK_BUILDER_EXPORTS);
if (typeof window !== 'undefined') Object.assign(window, _DECK_BUILDER_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _DECK_BUILDER_EXPORTS;
