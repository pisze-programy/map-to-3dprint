// ============================================================================
// src/mesh/bridges/bridge_spine_stitch.js
// Curved Bridge Spine Extraction, Chain Endpoint Stitching & Corridor Merging
// ============================================================================

if (typeof _polyLenJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(globalThis, require('./bridge_geom_2d.js'));
}

function _stitchEndpointsJS(chains, minDot, maxSnapU, canPairFn, onPairFn) {
  while (true) {
    let bestScore = -Infinity, bestI = -1, bestJ = -1, bestMode = -1;
    for (let i = 0; i < chains.length; i++) {
      const a = chains[i];
      for (let j = i + 1; j < chains.length; j++) {
        const b = chains[j];
        if (canPairFn && !canPairFn(a, b)) continue;
        const modes = [
          [a.pts[a.pts.length - 1], b.pts[0], 0],
          [a.pts[a.pts.length - 1], b.pts[b.pts.length - 1], 1],
          [a.pts[0], b.pts[0], 2],
          [a.pts[0], b.pts[b.pts.length - 1], 3]
        ];
        for (const [pa, pb, mode] of modes) {
          const aAtStart = mode >= 2, bAtStart = (mode === 0 || mode === 2);
          if ((aAtStart ? (a.joinPolyStart || a.clippedStart) : (a.joinPolyEnd || a.clippedEnd)) ||
              (bAtStart ? (b.joinPolyStart || b.clippedStart) : (b.joinPolyEnd || b.clippedEnd))) {
            continue;
          }
          const dist = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
          if (dist > maxSnapU) continue;
          const tA = _outTan2DJS(a.pts, aAtStart), tB = _outTan2DJS(b.pts, bAtStart);
          const alignDot = -(tA[0] * tB[0] + tA[1] * tB[1]);
          if (alignDot < minDot) continue;
          const wRatio = (a.width > 0 && b.width > 0) ? (Math.min(a.width, b.width) / Math.max(a.width, b.width)) : 1.0;
          const score = alignDot * (0.45 + 0.55 * wRatio) - (dist / Math.max(1e-4, maxSnapU)) * 0.08;
          if (score > bestScore) { bestScore = score; bestI = i; bestJ = j; bestMode = mode; }
        }
      }
    }
    if (bestI < 0) break;
    const a = chains[bestI], b = chains[bestJ], mode = bestMode;
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
    chains.splice(bestJ, 1);
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
    const uk = minU + (0.002 + 0.996 * (k / (nSlices - 1))) * spanU;
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
      let mergedClipS = true, mergedClipE = true, mergedJoinS = false, mergedJoinE = false;
      const r0 = avgPts[0], r1 = avgPts[avgPts.length - 1];
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
        const g0 = g.pts[0], g1 = g.pts[g.pts.length - 1];
        const isRev = (Math.hypot(g1[0] - r0[0], g1[1] - r0[1]) + Math.hypot(g0[0] - r1[0], g0[1] - r1[1])) + 1e-6 <
          (Math.hypot(g0[0] - r0[0], g0[1] - r0[1]) + Math.hypot(g1[0] - r1[0], g1[1] - r1[1]));
        mergedClipS = Boolean(mergedClipS && (isRev ? g.clippedEnd : g.clippedStart));
        mergedClipE = Boolean(mergedClipE && (isRev ? g.clippedStart : g.clippedEnd));
        mergedJoinS = Boolean(mergedJoinS || (isRev ? g.joinPolyEnd : g.joinPolyStart));
        mergedJoinE = Boolean(mergedJoinE || (isRev ? g.joinPolyStart : g.joinPolyEnd));
        base.isPath = Boolean(base.isPath && g.isPath);
        if (!base.level && g.level) base.level = g.level;
      }
      base.clippedStart = mergedClipS;
      base.clippedEnd = mergedClipE;
      base.joinPolyStart = mergedJoinS;
      base.joinPolyEnd = mergedJoinE;
    }
    out.push(base);
  }
  return out;
}

const _BRIDGE_SPINE_STITCH_EXPORTS = {
  _stitchEndpointsJS, _alignPtsToRefJS, _averageAlignedChainsJS,
  _ribbonWidthFromRingJS, _extractClippedAxisFromRoadsJS,
  _extractCurvedSpineFromPolyJS, _estimatePolyRibbonWidthJS, _stitchAndMergeLinearBridgesJS
};
if (typeof globalThis !== 'undefined') Object.assign(globalThis, _BRIDGE_SPINE_STITCH_EXPORTS);
if (typeof window !== 'undefined') Object.assign(window, _BRIDGE_SPINE_STITCH_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _BRIDGE_SPINE_STITCH_EXPORTS;
