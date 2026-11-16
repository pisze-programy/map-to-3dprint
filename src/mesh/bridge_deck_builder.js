// ============================================================================
// src/mesh/bridge_deck_builder.js
// Watertight Curved Z(s) Bridge Decks, Abutments & Supportless >= 35° Corbels
// ============================================================================

function _stationTangentsJS(pts) {
  const n = pts.length, tans = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    tans.push([dx / l, dy / l]);
  }
  return tans;
}

function _buildClosedStationTubeJS(pts, halfW, zBotArr, zTopArr, mf) {
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
    if (prevL && (((lp[0] - prevL[0]) * tx + (lp[1] - prevL[1]) * ty) <= 0.005 || ((rp[0] - prevR[0]) * tx + (rp[1] - prevR[1]) * ty) <= 0.005)) {
      return null;
    }
    prevL = lp; prevR = rp;
    const zb = zBotArr[i], zt = Math.max(zb + 0.05, zTopArr[i]);
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

function _buildSegmentUnionTubeJS(pts, halfW, zBotArr, zTopArr, mf) {
  const parts = [], n = pts.length;
  const cornerSharp = new Array(n).fill(false);
  for (let i = 1; i < n - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    const l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1, l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
    const dot = ((p1[0] - p0[0]) / l1) * ((p2[0] - p1[0]) / l2) + ((p1[1] - p0[1]) / l1) * ((p2[1] - p1[1]) / l2);
    if (dot < 0.55) cornerSharp[i] = true;
    if (dot < 0.992) {
      const zb = zBotArr[i], zt = Math.max(zb + 0.05, zTopArr[i]);
      const jc = mf.Manifold.cylinder(zt - zb, halfW * 1.005, halfW * 1.005, 20, false).translate([p1[0], p1[1], zb]);
      parts.push(jc);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 0.01) continue;
    const tx = dx / len, ty = dy / len;
    const extA = (i === 0 || cornerSharp[i]) ? 0 : Math.min(halfW * 0.28, len * 0.25);
    const extB = (i === n - 2 || cornerSharp[i + 1]) ? 0 : Math.min(halfW * 0.28, len * 0.25);
    const segPts = [[a[0] - tx * extA, a[1] - ty * extA], [b[0] + tx * extB, b[1] + ty * extB]];
    const m = _buildClosedStationTubeJS(segPts, halfW, [zBotArr[i], zBotArr[i + 1]], [zTopArr[i], zTopArr[i + 1]], mf);
    if (m) parts.push(m);
  }
  return parts.length ? batchUnionManifolds(mf, parts) : null;
}

function _buildSlopedWedgeCorbelJS(pA, pB, halfW, zBotA, zBotB, zTopA, zTopB, mf) {
  const dx = pB[0] - pA[0], dy = pB[1] - pA[1], l = Math.hypot(dx, dy);
  if (l < 0.03) return null;
  return _buildClosedStationTubeJS([pA, pB], halfW, [zBotA, zBotB], [zTopA, zTopB], mf);
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
  const zTopMin = Math.min(...spec.zTopArr), zTopMax = Math.max(...spec.zTopArr);
  const zBotMin = Math.min(...spec.zBotArr), zBotMax = Math.max(...spec.zBotArr);
  const isFlat = (zTopMax - zTopMin) <= 0.08 && (zBotMax - zBotMin) <= 0.08;

  if (spec.isAreaPoly && spec.outer && spec.outer.length >= 3) {
    if (isFlat) {
      return extrudeRingSolid(mf, spec.outer, spec.holes || [], zBotMin, zTopMax);
    }
    const col = extrudeRingSolid(mf, spec.outer, spec.holes || [], zBotMin - 0.5, zTopMax + 0.5);
    if (!col) return null;
    const pts = spec.pts, n = pts.length;
    const t0x = pts[1][0] - pts[0][0], t0y = pts[1][1] - pts[0][1], l0 = Math.hypot(t0x, t0y) || 1;
    const t1x = pts[n - 1][0] - pts[n - 2][0], t1y = pts[n - 1][1] - pts[n - 2][1], l1 = Math.hypot(t1x, t1y) || 1;
    const extDist = Math.max(0.6, Math.min(3.0, (spec.spanU || 4.0) * 0.18));
    const extPts = [[pts[0][0] - (t0x / l0) * extDist, pts[0][1] - (t0y / l0) * extDist]].concat(
      pts,
      [[pts[n - 1][0] + (t1x / l1) * extDist, pts[n - 1][1] + (t1y / l1) * extDist]]
    );
    const ezB = [spec.zBotArr[0]].concat(spec.zBotArr, [spec.zBotArr[n - 1]]);
    const ezT = [spec.zTopArr[0]].concat(spec.zTopArr, [spec.zTopArr[n - 1]]);
    let trueMaxLat = spec.width * 0.55;
    for (const p of spec.outer) trueMaxLat = Math.max(trueMaxLat, _distPtToPolyDeckJS(p[0], p[1], extPts));
    const envHalfW = Math.max(spec.width * 0.60, Math.min(trueMaxLat + Math.min(0.35, spec.width * 0.25), spec.width * 4.0 + 4.0));
    const env = _buildClosedStationTubeJS(extPts, envHalfW, ezB, ezT, mf) || _buildSegmentUnionTubeJS(extPts, envHalfW, ezB, ezT, mf);
    if (!env) { col.delete(); return extrudeRingSolid(mf, spec.outer, spec.holes || [], zBotMin, zTopMax); }
    try { const out = col.intersect(env); col.delete(); env.delete(); return out; } catch (_) { env.delete(); return col; }
  }

  return _buildClosedStationTubeJS(spec.pts, spec.width * 0.5, spec.zBotArr, spec.zTopArr, mf) ||
         _buildSegmentUnionTubeJS(spec.pts, spec.width * 0.5, spec.zBotArr, spec.zTopArr, mf);
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

function buildBankAbutments(spec, terrainWater, ctx) {
  const mf = ctx.mf, parts = [];
  const wHalf = Math.max(0.25, spec.width * 0.46), padL = Math.max(0.35, Math.min(1.1, spec.spanU * 0.08));
  for (const idx of [0, spec.pts.length - 1]) {
    const isStart = idx === 0;
    if ((isStart && (spec.clippedStart || spec.joinPolyStart)) || (!isStart && (spec.clippedEnd || spec.joinPolyEnd))) continue;
    const sPos = isStart ? 0 : spec.spanU;
    const { pt, tx, ty } = _samplePtAtSJS(spec, sPos);
    if (Math.abs(pt[0]) > ctx.halfW + 0.05 || Math.abs(pt[1]) > ctx.halfH + 0.05) continue;
    const surfZ = terrainWater.getSurfaceZ(pt[0], pt[1]);
    const floorZ = ctx.waterCutout && terrainWater.isPointInWater(pt[0], pt[1]) ? 0.0 : Math.max(0.0, Math.min(surfZ, spec.zBotArr[idx]) - 0.55);
    const meetZ = Math.min(spec.zTopArr[idx] - 0.05, spec.zBotArr[idx] + 0.14);
    if (meetZ <= floorZ + 0.05) continue;
    const isSkyDeadEnd = Boolean(spec.isPath && ((isStart ? spec.elevatedDeadEndStart : spec.elevatedDeadEndEnd) || (spec.deckLayer >= 1 && spec.zBotArr[idx] > surfZ + 0.10)));
    if (spec.isElevatedViaduct || isSkyDeadEnd) {
      const colR = Math.max(0.24 / ctx.scaleMm, Math.min(spec.width * 0.38, 0.55 / ctx.scaleMm));
      const inset = Math.min(spec.width * 0.40, colR * 1.15, spec.spanU * 0.16);
      const px = pt[0] + (isStart ? 1 : -1) * tx * inset;
      const py = pt[1] + (isStart ? 1 : -1) * ty * inset;
      const col = beamManifoldBetween(mf, [px, py, floorZ], [px, py, meetZ], colR);
      if (col) parts.push(col);
      continue;
    }
    const pA = isStart ? [pt[0] - tx * padL * 0.3, pt[1] - ty * padL * 0.3] : [pt[0] - tx * padL, pt[1] - ty * padL];
    const pB = isStart ? [pt[0] + tx * padL, pt[1] + ty * padL] : [pt[0] + tx * padL * 0.3, pt[1] + ty * padL * 0.3];
    let blk = _buildSlopedWedgeCorbelJS(pA, pB, wHalf, floorZ, floorZ, meetZ, meetZ, mf);
    if (blk && spec.isAreaPoly && spec.outer && spec.outer.length >= 3) {
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
  return parts;
}

function buildSupportlessUndersideCorbels(spec, supportStationsS, terrainWater, ctx) {
  if (!ctx.supportlessMode) return [];
  const mf = ctx.mf, parts = [], tanMin = Math.tan(42 * Math.PI / 180);
  const stops = [0, ...supportStationsS.filter(s => s > 0.25 && s < spec.spanU - 0.25), spec.spanU].sort((a, b) => a - b);
  const corbelHalfW = Math.max(0.22, spec.width * 0.42);
  const deckJoinUp = Math.max(0.08, spec.deckThick * 0.25);

  for (let i = 0; i < stops.length - 1; i++) {
    const sA = stops[i], sB = stops[i + 1], subSpanU = sB - sA;
    if (subSpanU * ctx.scaleMm <= 1.8) continue;
    const zBotA = _lerpArrAtSJS(spec.sArr, spec.zBotArr, sA), zBotB = _lerpArrAtSJS(spec.sArr, spec.zBotArr, sB);
    const zMinWaterGuard = spec.inWater.some(Boolean) ? ctx.zWaterTop + 0.14 : 0.05;
    const availL = Math.max(0.22, (zBotA - zMinWaterGuard) * 0.85);
    const availR = Math.max(0.22, (zBotB - zMinWaterGuard) * 0.85);
    const dropL = Math.min(availL, subSpanU * 0.48 * tanMin);
    const dropR = Math.min(availR, subSpanU * 0.48 * tanMin);
    const sLend = Math.min(sB, sA + Math.max(0.2, dropL / tanMin));
    const sRend = Math.max(sA, sB - Math.max(0.2, dropR / tanMin));
    const pA = _samplePtAtSJS(spec, sA), pL = _samplePtAtSJS(spec, sLend);
    const pR = _samplePtAtSJS(spec, sRend), pB = _samplePtAtSJS(spec, sB);
    const zBotL = _lerpArrAtSJS(spec.sArr, spec.zBotArr, sLend), zBotR = _lerpArrAtSJS(spec.sArr, spec.zBotArr, sRend);
    const cL = _buildSlopedWedgeCorbelJS(pA.pt, pL.pt, corbelHalfW, Math.max(0.05, zBotA - dropL), zBotL - 0.02, zBotA + deckJoinUp, zBotL + deckJoinUp, mf);
    const cR = _buildSlopedWedgeCorbelJS(pR.pt, pB.pt, corbelHalfW, zBotR - 0.02, Math.max(0.05, zBotB - dropR), zBotR + deckJoinUp, zBotB + deckJoinUp, mf);
    if (cL) parts.push(cL);
    if (cR) parts.push(cR);
    // Longitudinal 42-deg keel rib reducing unsupported flat span laterally and along midspan
    const mPts = [], mzB = [], mzT = [], steps = 5;
    for (let k = 0; k <= steps; k++) {
      const sk = sA + (k / steps) * subSpanU, pk = _samplePtAtSJS(spec, sk).pt;
      const zb = _lerpArrAtSJS(spec.sArr, spec.zBotArr, sk);
      const u = Math.sin(Math.PI * (k / steps));
      const keelDrop = Math.min(Math.max(0.24, corbelHalfW * tanMin), Math.max(0.18, (zb - zMinWaterGuard) * 0.48));
      mPts.push(pk); mzT.push(zb + deckJoinUp); mzB.push(Math.max(zMinWaterGuard, zb - keelDrop * (1 - 0.32 * u)));
    }
    const keelW = Math.max(0.18 / ctx.scaleMm, corbelHalfW * 0.45);
    const keel = _buildClosedStationTubeJS(mPts, keelW, mzB, mzT, mf) || _buildSegmentUnionTubeJS(mPts, keelW, mzB, mzT, mf);
    if (keel) parts.push(keel);
  }
  return parts;
}

const _DECK_BUILDER_EXPORTS = { buildSlopedBridgeDeck, buildBankAbutments, buildSupportlessUndersideCorbels, _lerpArrAtSJS, _samplePtAtSJS };
if (typeof window !== 'undefined') Object.assign(window, _DECK_BUILDER_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _DECK_BUILDER_EXPORTS;
