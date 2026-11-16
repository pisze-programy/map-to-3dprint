// ============================================================================
// src/mesh/bridge_axis_helper.js
// 2D Polyline, Curved Bridge Axis Extraction & Linear Chain Stitching Helpers
// ============================================================================

function _normalizeBridgeStructJS(raw, covered, tags) {
  const s = String(raw || '').trim().toLowerCase();
  const cov = String(covered || (tags && tags.covered) || '').trim().toLowerCase();
  if (/cable[-_ ]?stayed|harp|fan/.test(s)) return 'cable-stayed';
  if (/suspension/.test(s)) return 'suspension';
  if (/through[-_ ]?arch|tied[-_ ]?arch|bowstring|arch|humpback/.test(s)) return 'arch';
  if (/truss|warren|pratt|bailey/.test(s) || cov === 'yes') return 'truss';
  if (/floating|pontoon/.test(s) || (tags && tags.floating === 'yes')) return 'floating';
  return 'beam';
}

function _structRankJS(st) { return { 'cable-stayed': 5, 'suspension': 5, 'arch': 4, 'truss': 3, 'floating': 2, 'beam': 1 }[st] || 1; }
function _polyLenJS(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; }
function _dedupPtsJS(pts, minD = 0.02) {
  const out = [];
  for (const p of (pts || [])) if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) >= minD) out.push([p[0], p[1]]);
  return out.length >= 2 ? out : (pts || []).slice(0, 2);
}

function _resamplePolyJS(pts, nOut) {
  const clean = _dedupPtsJS(pts, 0.005);
  if (clean.length < 2 || nOut < 2) return clean;
  const cum = [0], out = [];
  for (let i = 1; i < clean.length; i++) cum.push(cum[i - 1] + Math.hypot(clean[i][0] - clean[i - 1][0], clean[i][1] - clean[i - 1][1]));
  const total = cum[cum.length - 1] || 1e-6;
  for (let k = 0; k < nOut; k++) {
    const s = (k / (nOut - 1)) * total;
    let i = 0;
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

function _outTan2DJS(pts, atStart) {
  const a = atStart ? pts[0] : pts[pts.length - 1], b = atStart ? pts[1] : pts[pts.length - 2];
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

function _stitchEndpointsJS(chains, minDot, canPairFn, onPairFn) {
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < chains.length && !merged; i++) for (let j = i + 1; j < chains.length && !merged; j++) {
      const a = chains[i], b = chains[j];
      if (canPairFn && !canPairFn(a, b)) continue;
      for (const [pa, pb, mode] of [[a.pts[a.pts.length - 1], b.pts[0], 0], [a.pts[a.pts.length - 1], b.pts[b.pts.length - 1], 1], [a.pts[0], b.pts[0], 2], [a.pts[0], b.pts[b.pts.length - 1], 3]]) {
        if (Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) > 0.45) continue;
        const tA = _outTan2DJS(a.pts, mode >= 2), tB = _outTan2DJS(b.pts, mode === 0 || mode === 2);
        if (-(tA[0] * tB[0] + tA[1] * tB[1]) < minDot) continue;
        const newPts = mode === 0 ? a.pts.concat(b.pts.slice(1)) : mode === 1 ? a.pts.concat(b.pts.slice(0, -1).reverse()) : mode === 2 ? b.pts.slice().reverse().concat(a.pts.slice(1)) : b.pts.concat(a.pts.slice(1));
        a.pts = _dedupPtsJS(newPts);
        if (onPairFn) onPairFn(a, b);
        chains.splice(j, 1); merged = true; break;
      }
    }
  }
  return chains;
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
  const dense = _resamplePolyJS(rc, Math.max(24, Math.min(160, Math.ceil(_polyLenJS(rc) / 0.8) + 1)));
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

function _averageAlignedChainsJS(chains, refVec) {
  const nStations = 13, accum = Array.from({ length: nStations }, () => [0, 0]);
  for (const ch of chains) {
    const pts = ch.pts || ch, dx = pts[pts.length - 1][0] - pts[0][0], dy = pts[pts.length - 1][1] - pts[0][1];
    const rs = _resamplePolyJS((dx * refVec[0] + dy * refVec[1] < 0) ? pts.slice().reverse() : pts, nStations);
    for (let k = 0; k < nStations; k++) { accum[k][0] += rs[k][0]; accum[k][1] += rs[k][1]; }
  }
  return accum.map(a => [a[0] / chains.length, a[1] / chains.length]);
}

function _extractClippedAxisFromRoadsJS(outer, roadChains) {
  const polySpine = _extractCurvedSpineFromPolyJS(outer), spineLen = _polyLenJS(polySpine);
  if (!roadChains || !roadChains.length) return polySpine;
  const raw = roadChains.map(rc => ({ pts: _dedupPtsJS(rc, 0.01) }))
    .filter(c => c.pts.length >= 2 && _polyLenJS(c.pts) >= 0.12)
    .sort((a, b) => _polyLenJS(b.pts) - _polyLenJS(a.pts));
  if (!raw.length) return polySpine;
  const longClipped = [];
  for (const ch of _stitchEndpointsJS(raw, 0.15)) {
    const keep = _clipChainToRingJS(ch.pts, outer);
    if (keep && _polyLenJS(keep) >= 0.75 * spineLen) longClipped.push(keep);
  }
  if (!longClipped.length) return polySpine;
  longClipped.sort((a, b) => _polyLenJS(b) - _polyLenJS(a));
  const ref = longClipped[0];
  return _averageAlignedChainsJS(longClipped, [ref[ref.length - 1][0] - ref[0][0], ref[ref.length - 1][1] - ref[0][1]]);
}

function _extractCurvedSpineFromPolyJS(outer) {
  if (typeof computeMinAreaOBB2D !== 'function' || !outer || outer.length < 3) return outer ? outer.slice(0, 2) : [[0, 0], [1, 0]];
  const obb = computeMinAreaOBB2D(outer);
  if (!obb || !Number.isFinite(obb.ux)) return [outer[0], outer[outer.length >> 1]];
  const ux = obb.ux, uy = obb.uy, vx = obb.vx, vy = obb.vy;
  let minU = Infinity, maxU = -Infinity;
  const uv = outer.map(p => { const u = p[0] * ux + p[1] * uy, v = p[0] * vx + p[1] * vy; if (u < minU) minU = u; if (u > maxU) maxU = u; return [u, v]; });
  const spine = [], nSlices = 13, spanU = Math.max(1e-4, maxU - minU);
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

function _estimatePolyRibbonWidthJS(outer, axisPts, obb) {
  const obbW = obb && Number.isFinite(obb.halfW) ? obb.halfW * 2 : 1.5;
  if (!outer || outer.length < 3 || !axisPts || axisPts.length < 2) return obbW;
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
    if (Number.isFinite(negMax) && Number.isFinite(posMin) && posMin - negMax > 0.25) widths.push(posMin - negMax);
  }
  if (!widths.length) return obbW;
  widths.sort((a, b) => a - b);
  return Math.min(obbW * 1.15, widths[widths.length >> 1]);
}

function _stitchAndMergeLinearBridgesJS(roadBridges) {
  const chains = roadBridges.map(r => ({ ...r, pts: _dedupPtsJS(r.pts) })).filter(r => r.pts.length >= 2 && _polyLenJS(r.pts) >= 0.12);
  _stitchEndpointsJS(
    chains, -0.2,
    (a, b) => (a.layer ?? 1) === (b.layer ?? 1) && (a.parentBridgeRelId || null) === (b.parentBridgeRelId || null) && (a.structNorm === b.structNorm || a.structNorm === 'beam' || b.structNorm === 'beam'),
    (a, b) => {
      a.width = Math.max(a.width, b.width);
      if (_structRankJS(b.structNorm) > _structRankJS(a.structNorm)) { a.structNorm = b.structNorm; a.explicitThroughArch = a.explicitThroughArch || b.explicitThroughArch; }
      if (a.heightM == null) a.heightM = b.heightM;
    }
  );
  const out = [], used = new Set();
  for (let i = 0; i < chains.length; i++) {
    if (used.has(i)) continue;
    const base = chains[i], group = [base], [bax0, bay0] = base.pts[0], [bax1, bay1] = base.pts[base.pts.length - 1];
    const blen = Math.hypot(bax1 - bax0, bay1 - bay0) || 1, btx = (bax1 - bax0) / blen, bty = (bay1 - bay0) / blen;
    for (let j = i + 1; j < chains.length; j++) {
      if (used.has(j)) continue;
      const c = chains[j];
      if ((base.layer ?? 1) !== (c.layer ?? 1)) continue;
      const [cx0, cy0] = c.pts[0], [cx1, cy1] = c.pts[c.pts.length - 1], clen = Math.hypot(cx1 - cx0, cy1 - cy0) || 1;
      const dot = Math.abs(btx * ((cx1 - cx0) / clen) + bty * ((cy1 - cy0) / clen));
      if (dot < 0.85 || Math.min(blen, clen) / Math.max(blen, clen) < 0.55) continue;
      const mx = (cx0 + cx1) * 0.5 - (bax0 + bax1) * 0.5, my = (cy0 + cy1) * 0.5 - (bay0 + bay1) * 0.5;
      if (Math.abs(-bty * mx + btx * my) <= Math.max(base.width + c.width + 2.2, 4.5) && Math.abs(btx * mx + bty * my) <= Math.max(blen, clen) * 0.35) { used.add(j); group.push(c); }
    }
    if (group.length > 1) {
      base.pts = _averageAlignedChainsJS(group, [btx, bty]);
      let minP = Infinity, maxP = -Infinity;
      for (const g of group) for (const p of g.pts) { const pr = -bty * (p[0] - bax0) + btx * (p[1] - bay0); minP = Math.min(minP, pr - g.width * 0.5); maxP = Math.max(maxP, pr + g.width * 0.5); }
      base.width = Math.max(base.width, maxP - minP);
      for (const g of group) { if (_structRankJS(g.structNorm) > _structRankJS(base.structNorm)) base.structNorm = g.structNorm; if (base.heightM == null) base.heightM = g.heightM; }
    }
    out.push(base);
  }
  return out;
}

const _AXIS_HELPER_EXPORTS = {
  _normalizeBridgeStructJS, _structRankJS, _polyLenJS, _dedupPtsJS,
  _resamplePolyJS, _bbox2DJS, _ptInRingJS, _extractClippedAxisFromRoadsJS,
  _extractCurvedSpineFromPolyJS, _estimatePolyRibbonWidthJS, _stitchAndMergeLinearBridgesJS
};
if (typeof window !== 'undefined') Object.assign(window, _AXIS_HELPER_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _AXIS_HELPER_EXPORTS;
