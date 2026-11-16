// ============================================================================
// src/buildings/s3db_containment_2d.js
// Hole-Aware S3DB 2D Polygon Containment, Solid Interior Probe & OBB Metrics
// ============================================================================

(function (root) {
  let _obbFn = typeof root.computeMinAreaOBB2D === 'function' ? root.computeMinAreaOBB2D : null;
  if (!_obbFn && typeof require === 'function') {
    try {
      const obbMod = require('../geometry/obb_medial_2d.js');
      if (obbMod && typeof obbMod.computeMinAreaOBB2D === 'function') _obbFn = obbMod.computeMinAreaOBB2D;
    } catch (_) {}
  }

  function _polyAreaSignedS3DB(pts) {
    if (!pts || pts.length < 3) return 0;
    if (typeof root.polyAreaSignedJS === 'function') return root.polyAreaSignedJS(pts);
    let area = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      area += a[0] * b[1] - b[0] * a[1];
    }
    return area * 0.5;
  }

  function _pointInPolyS3DB(px, py, poly) {
    if (!poly || poly.length < 3) return false;
    if (typeof root.pointInPolyLocal === 'function') return root.pointInPolyLocal(px, py, poly);
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }

  function _pointInAnyHoleS3DB(px, py, holes) {
    if (!holes || !holes.length) return false;
    for (let h = 0; h < holes.length; h++) {
      if (holes[h] && holes[h].length >= 3 && _pointInPolyS3DB(px, py, holes[h])) return true;
    }
    return false;
  }

  function _minBoundaryDistSqS3DB(px, py, outerPts, holesPts) {
    let minDSq = Infinity;
    const checkRing = (ring) => {
      for (let i = 0, n = ring.length; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
        const dSq = (px - (a[0] + t * dx)) ** 2 + (py - (a[1] + t * dy)) ** 2;
        if (dSq < minDSq) minDSq = dSq;
      }
    };
    checkRing(outerPts);
    for (const h of (holesPts || [])) if (h && h.length >= 3) checkRing(h);
    return minDSq;
  }

  function computeSolidInteriorPtJS(outerPts, holesPts) {
    if (!outerPts || outerPts.length === 0) return [0, 0];
    let sx = 0, sy = 0, minY = Infinity, maxY = -Infinity;
    for (const p of outerPts) {
      sx += p[0]; sy += p[1];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const cx = sx / outerPts.length, cy = sy / outerPts.length;
    const holes = (holesPts || []).filter(h => h && h.length >= 3);
    if (_pointInPolyS3DB(cx, cy, outerPts) && !_pointInAnyHoleS3DB(cx, cy, holes) && _minBoundaryDistSqS3DB(cx, cy, outerPts, holes) > 1e-6) {
      return [cx, cy];
    }
    const ys = [];
    for (const p of outerPts) ys.push(p[1]);
    for (const h of holes) for (const p of h) ys.push(p[1]);
    ys.sort((a, b) => a - b);
    const yMids = [];
    for (let i = 0; i < ys.length - 1; i++) if (ys[i + 1] - ys[i] > 1e-5) yMids.push((ys[i] + ys[i + 1]) * 0.5);
    if (maxY - minY > 1e-5) for (let k = 1; k <= 7; k++) yMids.push(minY + (maxY - minY) * (k / 8));
    const scanYs = yMids.length <= 28 ? yMids : Array.from({ length: 28 }, (_, idx) => yMids[Math.floor((idx * yMids.length) / 28)]);

    let bestPt = null, bestScore = -1;
    const collectHits = (ring, yScan, xs) => {
      for (let i = 0, n = ring.length; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        if ((a[1] > yScan) !== (b[1] > yScan)) xs.push(a[0] + (yScan - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
    };
    for (const yScan of scanYs) {
      const xs = [];
      collectHits(outerPts, yScan, xs);
      for (const h of holes) collectHits(h, yScan, xs);
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k < xs.length - 1; k++) {
        const w = xs[k + 1] - xs[k];
        if (w <= 1e-5) continue;
        const xm = (xs[k] + xs[k + 1]) * 0.5;
        if (_pointInPolyS3DB(xm, yScan, outerPts) && !_pointInAnyHoleS3DB(xm, yScan, holes)) {
          const score = Math.min(w * 0.5, Math.sqrt(_minBoundaryDistSqS3DB(xm, yScan, outerPts, holes)));
          if (score > bestScore) { bestScore = score; bestPt = [xm, yScan]; }
        }
      }
    }
    if (bestPt) return bestPt;
    const sign = _polyAreaSignedS3DB(outerPts) >= 0 ? 1 : -1;
    for (let i = 0, n = outerPts.length; i < n; i++) {
      const a = outerPts[i], b = outerPts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len > 1e-5) {
        const step = Math.min(1e-3, len * 0.05);
        const px = (a[0] + b[0]) * 0.5 + (-dy / len) * sign * step;
        const py = (a[1] + b[1]) * 0.5 + (dx / len) * sign * step;
        if (_pointInPolyS3DB(px, py, outerPts) && !_pointInAnyHoleS3DB(px, py, holes)) return [px, py];
      }
    }
    return [outerPts[0][0], outerPts[0][1]];
  }

  function computeRecordMetricsM(pts, mToU) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    const effMToU = Math.max(1e-4, mToU);
    let rawMinSpanM = Math.min(maxX - minX, maxY - minY) / effMToU;
    let rawMaxSpanM = Math.max(maxX - minX, maxY - minY) / effMToU;
    const obbCompute = typeof root.computeMinAreaOBB2D === 'function' ? root.computeMinAreaOBB2D : _obbFn;
    if (typeof obbCompute === 'function' && pts.length >= 3) {
      const obb = obbCompute(pts);
      if (obb && obb.halfL > 0) {
        rawMinSpanM = (obb.halfW * 2) / effMToU;
        rawMaxSpanM = (obb.halfL * 2) / effMToU;
      }
    }
    const areaU = Math.abs(_polyAreaSignedS3DB(pts));
    return { minX, maxX, minY, maxY, rawMinSpanM, rawMaxSpanM, areaU, areaM2: areaU / (effMToU * effMToU) };
  }

  function isPartEnclosedByParentS3DB(part, parent) {
    if (!part || !parent || !part.pts || !parent.pts) return false;
    const [pix, piy] = part.interiorPt || computeSolidInteriorPtJS(part.pts, part.holes);
    if (_pointInAnyHoleS3DB(pix, piy, parent.holes)) return false;
    if (_pointInPolyS3DB(pix, piy, parent.pts)) return true;
    let inCnt = 0, totalSamples = 0;
    const pts = part.pts, nPts = pts.length;
    for (let k = 0; k < nPts; k++) {
      const a = pts[k], b = pts[(k + 1) % nPts];
      const samples = [
        [a[0] + (pix - a[0]) * 1e-3, a[1] + (piy - a[1]) * 1e-3],
        [(a[0] + b[0]) * 0.5 + (pix - (a[0] + b[0]) * 0.5) * 1e-3, (a[1] + b[1]) * 0.5 + (piy - (a[1] + b[1]) * 0.5) * 1e-3],
      ];
      for (const [sx, sy] of samples) {
        totalSamples++;
        if (_pointInPolyS3DB(sx, sy, parent.pts) && !_pointInAnyHoleS3DB(sx, sy, parent.holes)) inCnt++;
      }
    }
    return totalSamples > 0 && inCnt >= totalSamples * 0.55;
  }

  const exportsObj = {
    _polyAreaSignedS3DB,
    _pointInPolyS3DB,
    _pointInAnyHoleS3DB,
    _minBoundaryDistSqS3DB,
    computeSolidInteriorPtJS,
    computeRecordMetricsM,
    isPartEnclosedByParentS3DB,
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
