// ============================================================================
// src/mesh/bridge_axis_helper.js
// 2D Polyline, Bed-Clipped Curved Bridge Axis & Metric-Safe Corridor Helpers
// ============================================================================

function _normalizeBridgeStructJS(raw, covered, tags) {
  const s = String(raw || '').trim().toLowerCase();
  const cov = String(covered || (tags && tags.covered) || '').trim().toLowerCase();
  const isMovable = Boolean(tags && (tags['bridge:movable'] || String(tags.bridge || '').trim().toLowerCase() === 'movable'));
  if (/cable[-_ ]?stayed|extradosed|harp|fan/.test(s)) return 'cable-stayed';
  if (/suspension/.test(s)) return 'suspension';
  if (isMovable && !/truss|warren|pratt|bailey|cantilever|lattice/.test(s)) return 'beam';
  if (/through[-_ ]?arch|tied[-_ ]?arch|bowstring|arch|humpback/.test(s)) return 'arch';
  if (/truss|warren|pratt|bailey|cantilever|lattice/.test(s) || cov === 'yes') return 'truss';
  if (/floating|pontoon/.test(s) || (tags && tags.floating === 'yes')) return 'floating';
  return 'beam';
}

function _structRankJS(st) { return { 'cable-stayed': 5, 'suspension': 5, 'arch': 4, 'truss': 3, 'floating': 2, 'beam': 1 }[st] || 1; }
function _polyLenJS(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; }

function _dedupPtsJS(pts, minD = 0.02) {
  const out = [];
  for (const p of (pts || [])) {
    if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) >= minD) out.push([p[0], p[1]]);
  }
  if (pts && pts.length >= 2 && out.length === 1) out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out.length >= 2 ? out : (pts || []).slice(0, 2);
}

function _resamplePolyJS(pts, nOut) {
  const clean = _dedupPtsJS(pts, 0.004);
  if (clean.length < 2 || nOut < 2) return clean;
  const cum = [0], out = [];
  for (let i = 1; i < clean.length; i++) cum.push(cum[i - 1] + Math.hypot(clean[i][0] - clean[i - 1][0], clean[i][1] - clean[i - 1][1]));
  const total = cum[cum.length - 1] || 1e-6;
  let i = 0;
  for (let k = 0; k < nOut; k++) {
    const s = (k / (nOut - 1)) * total;
    while (i < cum.length - 2 && cum[i + 1] < s) i++;
    const t = Math.max(0, Math.min(1, (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1e-6)));
    out.push([clean[i][0] + (clean[i + 1][0] - clean[i][0]) * t, clean[i][1] + (clean[i + 1][1] - clean[i][1]) * t]);
  }
  return out;
}

function _bbox2DJS(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  return [minX, minY, maxX, maxY];
}

function _ptInRingJS(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
  }
  return inside;
}

function _ptToPolyDist2DJS(px, py, pts) {
  if (!pts || !pts.length) return Infinity;
  if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
    const d = Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
    if (d < best) best = d;
  }
  return best;
}

function _trimTerminalHairpinSpikesJS(pts, maxStubU = 0.25) {
  if (!pts || pts.length < 3) return pts || [];
  const out = pts.slice();
  while (out.length >= 3) {
    const d0x = out[1][0] - out[0][0], d0y = out[1][1] - out[0][1], l0 = Math.hypot(d0x, d0y);
    const d1x = out[2][0] - out[1][0], d1y = out[2][1] - out[1][1], l1 = Math.hypot(d1x, d1y);
    if (l0 <= maxStubU && l0 > 1e-8 && l1 > 1e-8 && ((d0x / l0) * (d1x / l1) + (d0y / l0) * (d1y / l1)) < -0.5) {
      out.shift(); continue;
    }
    const n = out.length;
    const e1x = out[n - 1][0] - out[n - 2][0], e1y = out[n - 1][1] - out[n - 2][1], le1 = Math.hypot(e1x, e1y);
    const e0x = out[n - 2][0] - out[n - 3][0], e0y = out[n - 2][1] - out[n - 3][1], le0 = Math.hypot(e0x, e0y);
    if (le1 <= maxStubU && le1 > 1e-8 && le0 > 1e-8 && ((e0x / le0) * (e1x / le1) + (e0y / le0) * (e1y / le1)) < -0.5) {
      out.pop(); continue;
    }
    break;
  }
  return out;
}

function _splitPolylineOutsideRingsJS(pts, rings, overlapU = 0.30, minSubLenU = 0.15) {
  if (!pts || pts.length < 2) return [];
  const validRings = (rings || []).filter(r => r && r.length >= 3);
  if (!validRings.length) return [{ pts: pts.slice(), lenOut: _polyLenJS(pts), entersRingAtStart: false, entersRingAtEnd: false }];
  const inAny = (px, py) => validRings.some(r => _ptInRingJS(px, py, r));
  const stepMax = Math.max(0.08, Math.min(0.35, overlapU * 0.45));
  const rawSamples = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], segL = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.min(96, Math.ceil(segL / stepMax)));
    for (let k = (i === 0 ? 0 : 1); k <= steps; k++) {
      const t = k / steps;
      rawSamples.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  if (rawSamples.length < 2) return [];

  const sPts = [rawSamples[0]], sIn = [inAny(rawSamples[0][0], rawSamples[0][1])], isCross = [false];
  for (let i = 1; i < rawSamples.length; i++) {
    const prevP = rawSamples[i - 1], curP = rawSamples[i];
    const prevIn = sIn[sIn.length - 1], curIn = inAny(curP[0], curP[1]);
    if (prevIn !== curIn) {
      let t0 = 0, t1 = 1;
      for (let b = 0; b < 8; b++) {
        const tm = 0.5 * (t0 + t1);
        if (inAny(prevP[0] + (curP[0] - prevP[0]) * tm, prevP[1] + (curP[1] - prevP[1]) * tm) === prevIn) t0 = tm; else t1 = tm;
      }
      const tc = 0.5 * (t0 + t1);
      sPts.push([prevP[0] + (curP[0] - prevP[0]) * tc, prevP[1] + (curP[1] - prevP[1]) * tc]);
      sIn.push(curIn);
      isCross.push(true);
    }
    sPts.push(curP);
    sIn.push(curIn);
    isCross.push(false);
  }

  const cumS = [0];
  for (let i = 1; i < sPts.length; i++) cumS.push(cumS[i - 1] + Math.hypot(sPts[i][0] - sPts[i - 1][0], sPts[i][1] - sPts[i - 1][1]));
  const sampleAtS = (targetS) => {
    if (targetS <= 0) return sPts[0];
    const n = sPts.length;
    if (targetS >= cumS[n - 1]) return sPts[n - 1];
    let lo = 0;
    while (lo < n - 2 && cumS[lo + 1] < targetS) lo++;
    const f = (targetS - cumS[lo]) / Math.max(1e-8, cumS[lo + 1] - cumS[lo]);
    return [sPts[lo][0] + (sPts[lo + 1][0] - sPts[lo][0]) * f, sPts[lo][1] + (sPts[lo + 1][1] - sPts[lo][1]) * f];
  };

  // Build outside intervals between inside states
  const isOutsideSeg = [];
  for (let i = 0; i < sPts.length - 1; i++) {
    const mx = 0.5 * (sPts[i][0] + sPts[i + 1][0]), my = 0.5 * (sPts[i][1] + sPts[i + 1][1]);
    isOutsideSeg.push(!inAny(mx, my));
  }

  const pieces = [];
  let i = 0;
  while (i < isOutsideSeg.length) {
    if (!isOutsideSeg[i]) { i++; continue; }
    const startIdx = i;
    while (i + 1 < isOutsideSeg.length && isOutsideSeg[i + 1]) i++;
    const endIdx = i + 1;
    i++;
    const lenOut = cumS[endIdx] - cumS[startIdx];
    if (lenOut < minSubLenU) continue;
    const entersRingAtStart = startIdx > 0;
    const entersRingAtEnd = endIdx < sPts.length - 1;
    const subPts = [];
    if (entersRingAtStart && overlapU > 1e-4) {
      const sTarget = Math.max(0, cumS[startIdx] - overlapU);
      subPts.push(sampleAtS(sTarget));
      for (let k = 0; k < startIdx; k++) if (cumS[k] > sTarget + 1e-4) subPts.push(sPts[k]);
    }
    for (let k = startIdx; k <= endIdx; k++) subPts.push(sPts[k]);
    if (entersRingAtEnd && overlapU > 1e-4) {
      const sTarget = Math.min(cumS[sPts.length - 1], cumS[endIdx] + overlapU);
      for (let k = endIdx + 1; k < sPts.length; k++) if (cumS[k] < sTarget - 1e-4) subPts.push(sPts[k]);
      subPts.push(sampleAtS(sTarget));
    }
    const clean = _dedupPtsJS(subPts, 0.004);
    if (clean.length >= 2) pieces.push({ pts: clean, lenOut, entersRingAtStart, entersRingAtEnd });
  }
  return pieces;
}

function _clipPolylineToRectJS(pts, minX, minY, maxX, maxY) {
  if (!pts || pts.length < 2) return [];
  const clipSeg = (p0, p1) => {
    let t0 = 0, t1 = 1;
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    for (const [p, q] of [[-dx, p0[0] - minX], [dx, maxX - p0[0]], [-dy, p0[1] - minY], [dy, maxY - p0[1]]]) {
      if (Math.abs(p) < 1e-12) { if (q < 0) return null; }
      else {
        const r = q / p;
        if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
        else { if (r < t0) return null; if (r < t1) t1 = r; }
      }
    }
    if (t0 > t1) return null;
    return { a: [p0[0] + dx * t0, p0[1] + dy * t0], b: [p0[0] + dx * t1, p0[1] + dy * t1], c0: t0 > 1e-5, c1: t1 < 1 - 1e-5 };
  };
  const pieces = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const s = clipSeg(pts[i], pts[i + 1]);
    if (!s) { if (cur && cur.pts.length >= 2) pieces.push(cur); cur = null; continue; }
    if (!cur || s.c0) {
      if (cur && cur.pts.length >= 2) pieces.push(cur);
      cur = { pts: [s.a, s.b], clippedStart: s.c0 || (i > 0), clippedEnd: s.c1 };
    } else {
      const last = cur.pts[cur.pts.length - 1];
      if (Math.hypot(s.b[0] - last[0], s.b[1] - last[1]) > 1e-4) cur.pts.push(s.b);
      cur.clippedEnd = s.c1;
    }
    if (s.c1) {
      cur.clippedEnd = true;
      if (cur.pts.length >= 2) pieces.push(cur);
      cur = null;
    } else if (cur && i < pts.length - 2) {
      const nxt = pts[i + 2];
      if (nxt[0] < minX || nxt[0] > maxX || nxt[1] < minY || nxt[1] > maxY) cur.clippedEnd = true;
    }
  }
  if (cur && cur.pts.length >= 2) pieces.push(cur);
  return pieces;
}

function _outTan2DJS(pts, atStart) {
  const a = atStart ? pts[0] : pts[pts.length - 1], b = atStart ? pts[1] : pts[pts.length - 2];
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

function _stitchEndpointsJS(chains, minDot, maxSnapU, canPairFn, onPairFn) {
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < chains.length && !merged; i++) for (let j = i + 1; j < chains.length && !merged; j++) {
      const a = chains[i], b = chains[j];
      if (canPairFn && !canPairFn(a, b)) continue;
      const modes = [
        [a.pts[a.pts.length - 1], b.pts[0], 0],
        [a.pts[a.pts.length - 1], b.pts[b.pts.length - 1], 1],
        [a.pts[0], b.pts[0], 2],
        [a.pts[0], b.pts[b.pts.length - 1], 3]
      ];
      for (const [pa, pb, mode] of modes) {
        if (Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) > maxSnapU) continue;
        const tA = _outTan2DJS(a.pts, mode >= 2), tB = _outTan2DJS(b.pts, mode === 0 || mode === 2);
        if (-(tA[0] * tB[0] + tA[1] * tB[1]) < minDot) continue;
        const newPts = mode === 0 ? a.pts.concat(b.pts.slice(1))
          : mode === 1 ? a.pts.concat(b.pts.slice(0, -1).reverse())
          : mode === 2 ? b.pts.slice().reverse().concat(a.pts.slice(1))
          : b.pts.concat(a.pts.slice(1));
        a.joinPolyStart = mode === 0 || mode === 1 ? Boolean(a.joinPolyStart) : (mode === 2 ? Boolean(b.joinPolyEnd) : Boolean(b.joinPolyStart));
        a.joinPolyEnd = mode === 0 ? Boolean(b.joinPolyEnd) : mode === 1 ? Boolean(b.joinPolyStart) : Boolean(a.joinPolyEnd);
        a.clippedStart = mode === 0 || mode === 1 ? Boolean(a.clippedStart) : (mode === 2 ? Boolean(b.clippedEnd) : Boolean(b.clippedStart));
        a.clippedEnd = mode === 0 ? Boolean(b.clippedEnd) : mode === 1 ? Boolean(b.clippedStart) : Boolean(a.clippedEnd);
        a.pts = _dedupPtsJS(newPts, 0.01);
        if (onPairFn) onPairFn(a, b);
        chains.splice(j, 1); merged = true; break;
      }
    }
  }
  return chains;
}

function _alignPtsToRefJS(pts, refPts) {
  const a0 = pts[0], a1 = pts[pts.length - 1], r0 = refPts[0], r1 = refPts[refPts.length - 1];
  const dSame = Math.hypot(a0[0] - r0[0], a0[1] - r0[1]) + Math.hypot(a1[0] - r1[0], a1[1] - r1[1]);
  const dFlip = Math.hypot(a1[0] - r0[0], a1[1] - r0[1]) + Math.hypot(a0[0] - r1[0], a0[1] - r1[1]);
  return dFlip + 1e-6 < dSame ? pts.slice().reverse() : pts;
}

function _averageAlignedChainsJS(chains, refPts, nStations = 0) {
  const ref = Array.isArray(refPts[0]) ? refPts : (chains[0].pts || chains[0]);
  const maxLen = Math.max(...chains.map(ch => _polyLenJS(ch.pts || ch)));
  const nSt = nStations >= 3 ? nStations : Math.max(13, Math.min(160, Math.ceil(maxLen / 0.85) + 1));
  const accum = Array.from({ length: nSt }, () => [0, 0]);
  for (const ch of chains) {
    const rs = _resamplePolyJS(_alignPtsToRefJS(ch.pts || ch, ref), nSt);
    for (let k = 0; k < nSt; k++) { accum[k][0] += rs[k][0]; accum[k][1] += rs[k][1]; }
  }
  return accum.map(a => [a[0] / chains.length, a[1] / chains.length]);
}

function _bisectRingCrossingJS(pA, pB, outer, aIsIn) {
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 5; k++) {
    const tm = 0.5 * (t0 + t1);
    if (_ptInRingJS(pA[0] + (pB[0] - pA[0]) * tm, pA[1] + (pB[1] - pA[1]) * tm, outer) === aIsIn) t0 = tm; else t1 = tm;
  }
  const t = aIsIn ? t0 : t1;
  return [pA[0] + (pB[0] - pA[0]) * t, pA[1] + (pB[1] - pA[1]) * t];
}

function _clipChainToRingJS(rc, outer) {
  const dense = _resamplePolyJS(rc, Math.max(24, Math.min(180, Math.ceil(_polyLenJS(rc) / 0.7) + 1)));
  const inR = dense.map(p => _ptInRingJS(p[0], p[1], outer));
  let best = [], cur = [];
  for (let i = 0; i < dense.length; i++) {
    if (inR[i]) {
      if (!cur.length && i > 0) cur.push(_bisectRingCrossingJS(dense[i - 1], dense[i], outer, false));
      cur.push(dense[i]);
    } else if (cur.length) {
      cur.push(_bisectRingCrossingJS(dense[i - 1], dense[i], outer, true));
      if (_polyLenJS(cur) > _polyLenJS(best)) best = cur;
      cur = [];
    }
  }
  if (cur.length && _polyLenJS(cur) > _polyLenJS(best)) best = cur;
  return best.length >= 2 ? best : null;
}

function _extractClippedAxisFromRoadsJS(outer, roadChains, mToBedXY = 0.14) {
  const polySpine = _extractCurvedSpineFromPolyJS(outer), spineLen = _polyLenJS(polySpine);
  if (!roadChains || !roadChains.length) return polySpine;
  const raw = roadChains.map(rc => ({ pts: _dedupPtsJS(rc, 0.01) }))
    .filter(c => c.pts.length >= 2 && _polyLenJS(c.pts) >= 0.12)
    .sort((a, b) => _polyLenJS(b.pts) - _polyLenJS(a.pts));
  if (!raw.length) return polySpine;
  const snapU = Math.min(0.35, Math.max(0.04, 3.0 * mToBedXY));
  const longClipped = [];
  for (const ch of _stitchEndpointsJS(raw, 0.25, snapU)) {
    const keep = _clipChainToRingJS(ch.pts, outer);
    if (keep && _polyLenJS(keep) >= 0.72 * spineLen) longClipped.push(keep);
  }
  if (!longClipped.length) return polySpine;
  longClipped.sort((a, b) => _polyLenJS(b) - _polyLenJS(a));
  return _averageAlignedChainsJS(longClipped, longClipped[0]);
}

function _extractCurvedSpineFromPolyJS(outer) {
  if (typeof computeMinAreaOBB2D !== 'function' || !outer || outer.length < 3) return outer ? outer.slice(0, 2) : [[0, 0], [1, 0]];
  const obb = computeMinAreaOBB2D(outer);
  if (!obb || !Number.isFinite(obb.ux)) return [outer[0], outer[outer.length >> 1]];
  const ux = obb.ux, uy = obb.uy, vx = obb.vx, vy = obb.vy;
  let minU = Infinity, maxU = -Infinity;
  const uv = outer.map(p => { const u = p[0] * ux + p[1] * uy, v = p[0] * vx + p[1] * vy; if (u < minU) minU = u; if (u > maxU) maxU = u; return [u, v]; });
  const spanU = Math.max(1e-4, maxU - minU), nSlices = Math.max(13, Math.min(65, Math.ceil(spanU / 1.0) + 1));
  const spine = [];
  for (let k = 0; k < nSlices; k++) {
    const uk = minU + (0.015 + 0.97 * (k / (nSlices - 1))) * spanU;
    let minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < uv.length; i++) {
      const a = uv[i], b = uv[(i + 1) % uv.length], du = b[0] - a[0];
      if ((a[0] <= uk && b[0] >= uk) || (b[0] <= uk && a[0] >= uk)) {
        const t = Math.abs(du) < 1e-8 ? 0.5 : (uk - a[0]) / du;
        if (t >= 0 && t <= 1) { const vi = a[1] + (b[1] - a[1]) * t; if (vi < minV) minV = vi; if (vi > maxV) maxV = vi; }
      }
    }
    if (minV <= maxV) { const mv = (minV + maxV) * 0.5; spine.push([uk * ux + mv * vx, uk * uy + mv * vy]); }
  }
  const hL = Number.isFinite(obb.halfL) ? obb.halfL : 1;
  return spine.length >= 2 ? spine : [[obb.cx - ux * hL, obb.cy - uy * hL], [obb.cx + ux * hL, obb.cy + uy * hL]];
}

// Curvature-invariant closed ribbon width W from exact area A = L*W and perimeter P = 2(L+W)
function _ribbonWidthFromRingJS(outer) {
  if (!outer || outer.length < 3) return 0;
  let s = 0, perim = 0;
  for (let i = 0, n = outer.length; i < n; i++) {
    const a = outer[i], b = outer[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
    perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const area = Math.abs(s) * 0.5, halfP = perim * 0.5;
  if (area <= 1e-6 || halfP <= 1e-5) return 0;
  const disc = halfP * halfP - 4.0 * area;
  return disc >= 0 ? 0.5 * (halfP - Math.sqrt(disc)) : 0.25 * perim;
}

function _estimatePolyRibbonWidthJS(outer, axisPts, obb) {
  const obbW = obb && Number.isFinite(obb.halfW) ? obb.halfW * 2 : 1.5;
  const ribW = _ribbonWidthFromRingJS(outer);
  const safeCapW = ribW > 0.04 ? Math.min(obbW, ribW * 1.30) : obbW;
  if (!outer || outer.length < 3 || !axisPts || axisPts.length < 2) return safeCapW;
  const widths = [], n = outer.length;
  for (let k = 0; k < axisPts.length; k++) {
    const p = axisPts[k], p0 = axisPts[Math.max(0, k - 1)], p1 = axisPts[Math.min(axisPts.length - 1, k + 1)];
    const tx = p1[0] - p0[0], ty = p1[1] - p0[1], tl = Math.hypot(tx, ty);
    if (tl < 1e-6) continue;
    const nx = -ty / tl, ny = tx / tl, ux = tx / tl, uy = ty / tl;
    let negMax = -Infinity, posMin = Infinity;
    for (let i = 0; i < n; i++) {
      const a = outer[i], b = outer[(i + 1) % n], ua = (a[0] - p[0]) * ux + (a[1] - p[1]) * uy, ub = (b[0] - p[0]) * ux + (b[1] - p[1]) * uy;
      if ((ua <= 0 && ub >= 0) || (ub <= 0 && ua >= 0)) {
        const du = ub - ua, t = Math.abs(du) < 1e-8 ? 0.5 : -ua / du;
        if (t >= 0 && t <= 1) {
          const d = (a[0] + (b[0] - a[0]) * t - p[0]) * nx + (a[1] + (b[1] - a[1]) * t - p[1]) * ny;
          if (d <= 0.05 && d > negMax) negMax = d;
          if (d >= -0.05 && d < posMin) posMin = d;
        }
      }
    }
    if (Number.isFinite(negMax) && Number.isFinite(posMin) && posMin - negMax > 0.12) widths.push(posMin - negMax);
  }
  if (!widths.length) return safeCapW;
  widths.sort((a, b) => a - b);
  return Math.min(safeCapW * 1.15, widths[widths.length >> 1]);
}

function _stitchAndMergeLinearBridgesJS(roadBridges, opts = {}) {
  const mToBedXY = Number(opts.mToBedXY) > 0 ? Number(opts.mToBedXY) : 0.141;
  const scaleMm = Number(opts.scaleMm) > 0 ? Number(opts.scaleMm) : 1.65;
  const snapU = Math.min(0.32, Math.max(0.03, 2.5 * mToBedXY));
  const minChainLenU = Math.max(0.08, Math.min(0.18, 1.5 * mToBedXY));

  const stubMaxU = Math.max(0.12, 0.65 * mToBedXY);
  const chains = roadBridges
    .map(r => ({ ...r, pts: _trimTerminalHairpinSpikesJS(_dedupPtsJS(r.pts, 0.008), stubMaxU) }))
    .filter(r => r.pts.length >= 2 && _polyLenJS(r.pts) >= minChainLenU);

  _stitchEndpointsJS(
    chains, 0.35, snapU,
    (a, b) => (a.layer ?? 1) === (b.layer ?? 1) &&
      Boolean(a.isRail) === Boolean(b.isRail) &&
      (a.parentBridgeRelId || null) === (b.parentBridgeRelId || null) &&
      (a.structNorm === b.structNorm || a.structNorm === 'beam' || b.structNorm === 'beam'),
    (a, b) => {
      a.width = Math.max(a.width, b.width);
      if (!a.name && b.name) a.name = b.name;
      if (_structRankJS(b.structNorm) > _structRankJS(a.structNorm)) {
        a.structNorm = b.structNorm;
        a.explicitThroughArch = a.explicitThroughArch || b.explicitThroughArch;
        a.isHumpback = Boolean(a.isHumpback || b.isHumpback);
      } else if (b.isHumpback) {
        a.isHumpback = true;
      }
      if (Array.isArray(b.linkedPolyOsmIds) && b.linkedPolyOsmIds.length) {
        const set = new Set([...(a.linkedPolyOsmIds || []), ...b.linkedPolyOsmIds]);
        a.linkedPolyOsmIds = [...set];
      }
      if (a.heightM == null) a.heightM = b.heightM;
      if (a.minHeightM == null) a.minHeightM = b.minHeightM;
      if (a.clearanceM == null) a.clearanceM = b.clearanceM;
      if (!a.level && b.level) a.level = b.level;
      a.isPath = Boolean(a.isPath && b.isPath);
      a.isBoardwalk = Boolean(a.isBoardwalk && b.isBoardwalk);
    }
  );
  for (const ch of chains) ch.pts = _trimTerminalHairpinSpikesJS(ch.pts, stubMaxU);

  // Metric + MSLA anti-capillary multi-track / twin-carriageway corridor merge (local cross-sections only)
  const maxEdgeGapU = Math.min(Math.max(0.42 / scaleMm, 5.5 * mToBedXY), 12.0 * mToBedXY + 0.25 / scaleMm);
  const maxCorridorSpanU = Math.max(26.0 * mToBedXY + 0.5 / scaleMm, 1.4 / scaleMm);
  const out = [], used = new Set();
  for (let i = 0; i < chains.length; i++) {
    if (used.has(i)) continue;
    const base = chains[i], group = [base], lenA = _polyLenJS(base.pts);
    let grew = true;
    while (grew && group.length < 6) {
      grew = false;
      for (let j = i + 1; j < chains.length && group.length < 6; j++) {
        if (used.has(j)) continue;
        const c = chains[j];
        if ((base.layer ?? 1) !== (c.layer ?? 1)) continue;
        if ((base.parentBridgeRelId || null) !== (c.parentBridgeRelId || null)) continue;
        if (!base.parentBridgeRelId && Boolean(base.isRail) !== Boolean(c.isRail)) continue;
        const lenB = _polyLenJS(c.pts);
        if (Math.min(lenA, lenB) / Math.max(lenA, lenB, 1e-6) < 0.72) continue;

        const nCheck = Math.max(13, Math.min(96, Math.ceil(Math.max(lenA, lenB) / 1.1) + 1));
        const rsBase = _resamplePolyJS(base.pts, nCheck);
        const rsC = _resamplePolyJS(_alignPtsToRefJS(c.pts, base.pts), nCheck);
        let maxBaseDist = 0;
        for (let k = 0; k < nCheck; k++) {
          const d0 = Math.hypot(rsBase[k][0] - rsC[k][0], rsBase[k][1] - rsC[k][1]);
          if (d0 > maxBaseDist) maxBaseDist = d0;
        }
        if (maxBaseDist > Math.max(base.width * 3.2, maxCorridorSpanU)) continue;

        let matchedMember = false;
        for (const refM of group) {
          const rsA = refM === base ? rsBase : _resamplePolyJS(_alignPtsToRefJS(refM.pts, base.pts), nCheck);
          const maxCenterDistU = (refM.width + c.width) * 0.5 + maxEdgeGapU;
          let ok = true;
          const dists = [];
          for (let k = 0; k < nCheck; k++) {
            const d = Math.hypot(rsA[k][0] - rsC[k][0], rsA[k][1] - rsC[k][1]);
            if (d > maxCenterDistU * 1.35) { ok = false; break; }
            dists.push(d);
            if (k > 0) {
              const ax = rsA[k][0] - rsA[k - 1][0], ay = rsA[k][1] - rsA[k - 1][1], al = Math.hypot(ax, ay) || 1;
              const bx = rsC[k][0] - rsC[k - 1][0], by = rsC[k][1] - rsC[k - 1][1], bl = Math.hypot(bx, by) || 1;
              if ((ax / al) * (bx / bl) + (ay / al) * (by / bl) < 0.74) { ok = false; break; }
            }
          }
          if (!ok) continue;
          dists.sort((u, v) => u - v);
          if (dists[dists.length >> 1] <= maxCenterDistU && dists[0] <= maxCenterDistU * 1.45) {
            matchedMember = true;
            break;
          }
        }
        if (matchedMember) {
          used.add(j);
          group.push(c);
          grew = true;
        }
      }
    }

    if (group.length > 1) {
      const nSt = Math.max(13, Math.min(160, Math.ceil(lenA / 0.85) + 1));
      const avgPts = _averageAlignedChainsJS(group, base.pts, nSt);
      const rsGroup = group.map(g => _resamplePolyJS(_alignPtsToRefJS(g.pts, avgPts), nSt));
      const localSpans = [];
      for (let k = 0; k < nSt; k++) {
        const p0 = avgPts[Math.max(0, k - 1)], p1 = avgPts[Math.min(nSt - 1, k + 1)];
        const tx = p1[0] - p0[0], ty = p1[1] - p0[1], tl = Math.hypot(tx, ty) || 1;
        const nx = -ty / tl, ny = tx / tl;
        let minLat = Infinity, maxLat = -Infinity;
        for (let gi = 0; gi < group.length; gi++) {
          const gp = rsGroup[gi][k], hw = group[gi].width * 0.5;
          const lat = (gp[0] - avgPts[k][0]) * nx + (gp[1] - avgPts[k][1]) * ny;
          if (lat - hw < minLat) minLat = lat - hw;
          if (lat + hw > maxLat) maxLat = lat + hw;
        }
        if (maxLat > minLat) localSpans.push(maxLat - minLat);
      }
      localSpans.sort((u, v) => u - v);
      const medSpan = localSpans.length ? localSpans[localSpans.length >> 1] : base.width;
      base.pts = avgPts;
      base.width = Math.max(base.width, medSpan);
      for (const g of group) {
        if (!base.name && g.name) base.name = g.name;
        if (_structRankJS(g.structNorm) > _structRankJS(base.structNorm)) {
          base.structNorm = g.structNorm;
          base.explicitThroughArch = base.explicitThroughArch || g.explicitThroughArch;
          base.isHumpback = Boolean(base.isHumpback || g.isHumpback);
        } else if (g.isHumpback) {
          base.isHumpback = true;
        }
        if (Array.isArray(g.linkedPolyOsmIds) && g.linkedPolyOsmIds.length) {
          const set = new Set([...(base.linkedPolyOsmIds || []), ...g.linkedPolyOsmIds]);
          base.linkedPolyOsmIds = [...set];
        }
        if (base.heightM == null) base.heightM = g.heightM;
        if (base.minHeightM == null) base.minHeightM = g.minHeightM;
        if (base.clearanceM == null) base.clearanceM = g.clearanceM;
        base.clippedStart = Boolean(base.clippedStart && g.clippedStart);
        base.clippedEnd = Boolean(base.clippedEnd && g.clippedEnd);
        base.joinPolyStart = Boolean(base.joinPolyStart || g.joinPolyStart);
        base.joinPolyEnd = Boolean(base.joinPolyEnd || g.joinPolyEnd);
        base.isPath = Boolean(base.isPath && g.isPath);
        if (!base.level && g.level) base.level = g.level;
      }
    }
    out.push(base);
  }
  return out;
}

const _AXIS_HELPER_EXPORTS = {
  _normalizeBridgeStructJS, _structRankJS, _polyLenJS, _dedupPtsJS,
  _resamplePolyJS, _bbox2DJS, _ptInRingJS, _ptToPolyDist2DJS,
  _trimTerminalHairpinSpikesJS, _splitPolylineOutsideRingsJS,
  _clipPolylineToRectJS, _outTan2DJS,
  _ribbonWidthFromRingJS, _extractClippedAxisFromRoadsJS,
  _extractCurvedSpineFromPolyJS, _estimatePolyRibbonWidthJS, _stitchAndMergeLinearBridgesJS
};
if (typeof window !== 'undefined') Object.assign(window, _AXIS_HELPER_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _AXIS_HELPER_EXPORTS;
