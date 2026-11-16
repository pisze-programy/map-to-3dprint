// ============================================================================
// src/mesh/bridges/bridge_geom_2d.js
// Pure 2D Polyline, Clipping, Distance & Structure Tag Normalization Helpers
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

  const sPts = [rawSamples[0]], sIn = [inAny(rawSamples[0][0], rawSamples[0][1])];
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
    }
    sPts.push(curP);
    sIn.push(curIn);
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

const _BRIDGE_GEOM_2D_EXPORTS = {
  _normalizeBridgeStructJS, _structRankJS, _polyLenJS, _dedupPtsJS,
  _resamplePolyJS, _bbox2DJS, _ptInRingJS, _ptToPolyDist2DJS,
  _trimTerminalHairpinSpikesJS, _splitPolylineOutsideRingsJS,
  _clipPolylineToRectJS, _outTan2DJS, _segClosestPair2DJS
};
if (typeof globalThis !== 'undefined') Object.assign(globalThis, _BRIDGE_GEOM_2D_EXPORTS);
if (typeof window !== 'undefined') Object.assign(window, _BRIDGE_GEOM_2D_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _BRIDGE_GEOM_2D_EXPORTS;
