// ============================================================================
// src/Water/water_pier_osm_helper.js
// 2D Ring, Containment & Polyline Buffering Helpers for OSM Marine Piers
// ============================================================================

(function (root) {
  function _pointInRingExtract2D(px, py, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function _ringInsideOuterExtract2D(innerRing, outerRing) {
    if (!innerRing || innerRing.length < 3 || !outerRing || outerRing.length < 3) return false;
    if (_pointInRingExtract2D(innerRing[0][0], innerRing[0][1], outerRing)) return true;
    let cx = 0, cy = 0;
    for (let i = 0; i < innerRing.length; i++) {
      cx += innerRing[i][0];
      cy += innerRing[i][1];
    }
    cx /= innerRing.length;
    cy /= innerRing.length;
    if (_pointInRingExtract2D(cx, cy, outerRing)) return true;
    for (let i = 0; i < innerRing.length; i++) {
      const p0 = innerRing[i], p1 = innerRing[(i + 1) % innerRing.length];
      if (_pointInRingExtract2D((p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5, outerRing)) return true;
    }
    return false;
  }

  function _signedRingAreaExtract2D(ring) {
    let s = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return 0.5 * s;
  }

  function _ringCentroidExtract2D(ring) {
    if (!ring || !ring.length) return [0, 0];
    let sx = 0, sy = 0;
    for (let i = 0; i < ring.length; i++) {
      sx += ring[i][0];
      sy += ring[i][1];
    }
    return [sx / ring.length, sy / ring.length];
  }

  function _segsCrossExtract2D(a, b, c, d) {
    const orient = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const o1 = orient(a, b, c), o2 = orient(a, b, d);
    const o3 = orient(c, d, a), o4 = orient(c, d, b);
    return ((o1 > 1e-9 && o2 < -1e-9) || (o1 < -1e-9 && o2 > 1e-9)) &&
           ((o3 > 1e-9 && o4 < -1e-9) || (o3 < -1e-9 && o4 > 1e-9));
  }

  function _isSimpleRingExtract2D(ring) {
    if (!ring || ring.length < 3 || Math.abs(_signedRingAreaExtract2D(ring)) < 1e-5) return false;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a1 = ring[i], a2 = ring[(i + 1) % n];
      if (Math.hypot(a2[0] - a1[0], a2[1] - a1[1]) < 1e-5) return false;
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (_segsCrossExtract2D(a1, a2, ring[j], ring[(j + 1) % n])) return false;
      }
    }
    return true;
  }

  function _polylineCrossesRingExtract2D(pts, ring) {
    if (!pts || !pts.length || !ring || ring.length < 3) return false;
    for (let i = 0; i < pts.length; i++) {
      if (_pointInRingExtract2D(pts[i][0], pts[i][1], ring)) return true;
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) * 0.5;
      const my = (pts[i][1] + pts[i + 1][1]) * 0.5;
      if (_pointInRingExtract2D(mx, my, ring)) return true;
      for (let j = 0; j < ring.length; j++) {
        if (_segsCrossExtract2D(pts[i], pts[i + 1], ring[j], ring[(j + 1) % ring.length])) return true;
      }
    }
    return false;
  }

  function _bufferPierPolylineToPolys2D(rawPts, widthUnits) {
    if (!rawPts || rawPts.length < 2) return [];
    const pts = [rawPts[0]];
    for (let i = 1; i < rawPts.length; i++) {
      const prev = pts[pts.length - 1];
      if (Math.hypot(rawPts[i][0] - prev[0], rawPts[i][1] - prev[1]) >= 0.018) {
        pts.push(rawPts[i]);
      }
    }
    if (pts.length < 2) return [];

    const halfW = Math.max(0.14, widthUnits * 0.5);
    const isClosedLoop = pts.length >= 4 &&
      Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.03;

    if (!isClosedLoop) {
      const leftPts = [], rightPts = [], n = pts.length;
      for (let i = 0; i < n; i++) {
        if (i === 0 || i === n - 1) {
          const pA = i === 0 ? pts[0] : pts[n - 2], pB = i === 0 ? pts[1] : pts[n - 1];
          const dx = pB[0] - pA[0], dy = pB[1] - pA[1], l = Math.hypot(dx, dy) || 1;
          const nx = -dy / l, ny = dx / l;
          leftPts.push([pts[i][0] + nx * halfW, pts[i][1] + ny * halfW]);
          rightPts.push([pts[i][0] - nx * halfW, pts[i][1] - ny * halfW]);
        } else {
          const d1x = pts[i][0] - pts[i - 1][0], d1y = pts[i][1] - pts[i - 1][1], l1 = Math.hypot(d1x, d1y) || 1;
          const t1x = d1x / l1, t1y = d1y / l1;
          const d2x = pts[i + 1][0] - pts[i][0], d2y = pts[i + 1][1] - pts[i][1], l2 = Math.hypot(d2x, d2y) || 1;
          const t2x = d2x / l2, t2y = d2y / l2;
          const n1x = -t1y, n1y = t1x, n2x = -t2y, n2y = t2x;
          const turnDot = t1x * t2x + t1y * t2y, cross = t1x * t2y - t1y * t2x;
          if (turnDot < -0.15) {
            const bx = n1x + n2x, by = n1y + n2y, bl = Math.hypot(bx, by) || 1;
            if (cross > 0) {
              rightPts.push([pts[i][0] - n1x * halfW, pts[i][1] - n1y * halfW]);
              rightPts.push([pts[i][0] - n2x * halfW, pts[i][1] - n2y * halfW]);
              leftPts.push([pts[i][0] + (bx / bl) * halfW, pts[i][1] + (by / bl) * halfW]);
            } else {
              leftPts.push([pts[i][0] + n1x * halfW, pts[i][1] + n1y * halfW]);
              leftPts.push([pts[i][0] + n2x * halfW, pts[i][1] + n2y * halfW]);
              rightPts.push([pts[i][0] - (bx / bl) * halfW, pts[i][1] - (by / bl) * halfW]);
            }
          } else {
            const tx = t1x + t2x, ty = t1y + t2y, tl = Math.hypot(tx, ty) || 1;
            const mnx = -ty / tl, mny = tx / tl;
            const miter = Math.min(1.45, 1.0 / Math.max(0.68, mnx * n1x + mny * n1y));
            leftPts.push([pts[i][0] + mnx * halfW * miter, pts[i][1] + mny * halfW * miter]);
            rightPts.push([pts[i][0] - mnx * halfW * miter, pts[i][1] - mny * halfW * miter]);
          }
        }
      }
      const ribbon = rightPts.concat(leftPts.slice().reverse());
      if (_isSimpleRingExtract2D(ribbon)) {
        if (_signedRingAreaExtract2D(ribbon) < 0) ribbon.reverse();
        return [ribbon];
      }
    }

    const segPolys = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const pA = pts[i], pB = pts[i + 1];
      const dx = pB[0] - pA[0], dy = pB[1] - pA[1], len = Math.hypot(dx, dy);
      if (len < 0.02) continue;
      const tx = dx / len, ty = dy / len, nx = -ty, ny = tx;
      const extA = (i > 0 || isClosedLoop) ? Math.min(halfW * 0.45, len * 0.35) : 0;
      const extB = (i < pts.length - 2 || isClosedLoop) ? Math.min(halfW * 0.45, len * 0.35) : 0;
      const ax = pA[0] - tx * extA, ay = pA[1] - ty * extA;
      const bx = pB[0] + tx * extB, by = pB[1] + ty * extB;
      segPolys.push([
        [ax - nx * halfW, ay - ny * halfW],
        [bx - nx * halfW, by - ny * halfW],
        [bx + nx * halfW, by + ny * halfW],
        [ax + nx * halfW, ay + ny * halfW]
      ]);
    }
    return segPolys;
  }

  const exportsObj = {
    _pointInRingExtract2D,
    _ringInsideOuterExtract2D,
    _signedRingAreaExtract2D,
    _ringCentroidExtract2D,
    _segsCrossExtract2D,
    _isSimpleRingExtract2D,
    _polylineCrossesRingExtract2D,
    _bufferPierPolylineToPolys2D
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
