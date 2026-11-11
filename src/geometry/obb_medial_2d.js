// ============================================================================
// src/geometry/obb_medial_2d.js
// Convex/Star-Shaped Tests, Minimum-Area OBB, Boundary Distance & Medial Helpers,
// Closed-Ring Douglas-Peucker Eaves Reference & Gauss-Bonnet Wing Half-Width
// ============================================================================

if (typeof signedArea2D === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./polygon_2d.js'));
}

function isConvexPoly(poly) {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n];
    const b = poly[i];
    const c = poly[(i + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cross <= -1e-4) return false;
  }
  return true;
}

function isStarShapedFromCentroid(poly) {
  if (!poly || poly.length < 3) return false;
  let cx = 0, cy = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    cx += poly[i][0];
    cy += poly[i][1];
  }
  cx /= n;
  cy /= n;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const cross = (a[0] - cx) * (b[1] - cy) - (a[1] - cy) * (b[0] - cx);
    if (cross <= 1e-6) return false;
  }
  return true;
}

function computeMinAreaOBB2D(poly) {
  if (!poly || poly.length < 3) return null;
  const n = poly.length;
  let bestArea = Infinity;
  let bestOBB = null;

  const testAxis = (ux, uy) => {
    const vx = -uy, vy = ux;
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const px = poly[i][0], py = poly[i][1];
      const u = px * ux + py * uy;
      const v = px * vx + py * vy;
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    const spanU = uMax - uMin;
    const spanV = vMax - vMin;
    const area = spanU * spanV;
    if (area < bestArea) {
      bestArea = area;
      const cu = (uMin + uMax) * 0.5;
      const cv = (vMin + vMax) * 0.5;
      const cx = cu * ux + cv * vx;
      const cy = cu * uy + cv * vy;
      if (spanU >= spanV) {
        bestOBB = { cx, cy, ux, uy, vx, vy, halfL: spanU * 0.5, halfW: spanV * 0.5, obbArea: area };
      } else {
        bestOBB = { cx, cy, ux: vx, uy: vy, vx: -ux, vy: -uy, halfL: spanV * 0.5, halfW: spanU * 0.5, obbArea: area };
      }
    }
  };

  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len > 1e-5) testAxis(dx / len, dy / len);
  }
  if (!bestOBB) testAxis(1, 0);
  const polyArea = Math.abs(signedArea2D(poly));
  bestOBB.polyArea = polyArea;
  bestOBB.rectRatio = bestOBB.obbArea > 1e-6 ? (polyArea / bestOBB.obbArea) : 0;
  return bestOBB;
}

function refinePolygonRingMaxEdge2D(ring, maxEdgeLen = 0.72) {
  if (!ring || ring.length < 3 || maxEdgeLen <= 0) return ring;
  const out = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    out.push([a[0], a[1]]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > maxEdgeLen * 1.05) {
      const segs = Math.min(24, Math.ceil(len / maxEdgeLen));
      for (let s = 1; s < segs; s++) {
        const t = s / segs;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  return out;
}

function simplifyClosedRingDP2D(ring, tol = 0.11) {
  if (!ring || ring.length <= 4) return ring ? ring.slice() : [];
  const n = ring.length;
  let iA = 0, iB = Math.floor(n / 2), maxD = -1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = (ring[i][0] - ring[j][0]) ** 2 + (ring[i][1] - ring[j][1]) ** 2;
      if (d > maxD) { maxD = d; iA = i; iB = j; }
    }
  }
  const tolSq = tol * tol;
  function dpOpen(pts) {
    if (pts.length <= 2) return pts.slice();
    const A = pts[0], B = pts[pts.length - 1];
    let bestIdx = -1, bestDistSq = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const dSq = pointToSegmentDistSq2D(pts[i], A, B);
      if (dSq > bestDistSq) { bestDistSq = dSq; bestIdx = i; }
    }
    if (bestDistSq > tolSq && bestIdx > 0) {
      const left = dpOpen(pts.slice(0, bestIdx + 1));
      const right = dpOpen(pts.slice(bestIdx));
      return left.slice(0, -1).concat(right);
    }
    return [A, B];
  }
  const chain1 = [];
  for (let k = iA; ; k = (k + 1) % n) { chain1.push(ring[k]); if (k === iB) break; }
  const chain2 = [];
  for (let k = iB; ; k = (k + 1) % n) { chain2.push(ring[k]); if (k === iA) break; }
  const s1 = dpOpen(chain1);
  const s2 = dpOpen(chain2);
  const res = s1.slice(0, -1).concat(s2.slice(0, -1));
  return res.length >= 3 ? res : ring.slice();
}

function isSimplePolygon(poly) {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a1 = poly[i], a2 = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = poly[j], b2 = poly[(j + 1) % n];
      const isReverseBridge = (Math.hypot(a1[0] - b2[0], a1[1] - b2[1]) < 1e-5 && Math.hypot(a2[0] - b1[0], a2[1] - b1[1]) < 1e-5);
      const isForwardBridge = (Math.hypot(a1[0] - b1[0], a1[1] - b1[1]) < 1e-5 && Math.hypot(a2[0] - b2[0], a2[1] - b2[1]) < 1e-5);
      if (isReverseBridge || isForwardBridge) continue;
      if (segmentsIntersectProper(a1, a2, b1, b2)) return false;

      const endTouchA1 = Math.hypot(a1[0] - b1[0], a1[1] - b1[1]) < 1e-5 || Math.hypot(a1[0] - b2[0], a1[1] - b2[1]) < 1e-5;
      const endTouchA2 = Math.hypot(a2[0] - b1[0], a2[1] - b1[1]) < 1e-5 || Math.hypot(a2[0] - b2[0], a2[1] - b2[1]) < 1e-5;
      if (!endTouchA1 && pointToSegmentDistSq2D(a1, b1, b2) < 1e-7) return false;
      if (!endTouchA2 && pointToSegmentDistSq2D(a2, b1, b2) < 1e-7) return false;
    }
  }
  return true;
}

function hasSelfTouchingEdge2D(poly, tolSq = 1e-4) {
  const n = poly.length;
  if (n < 3) return true;
  for (let i = 0; i < n; i++) {
    const a1 = poly[i], a2 = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = poly[j], b2 = poly[(j + 1) % n];
      if (segmentsIntersectProper(a1, a2, b1, b2)) return true;
      if (pointToSegmentDistSq2D(a1, b1, b2) < tolSq) return true;
      if (pointToSegmentDistSq2D(a2, b1, b2) < tolSq) return true;
      if (pointToSegmentDistSq2D(b1, a1, a2) < tolSq) return true;
      if (pointToSegmentDistSq2D(b2, a1, a2) < tolSq) return true;
    }
  }
  return false;
}

function pointInPolyOrNear2D(px, py, ring, tol = 0.15) {
  if (!ring || ring.length < 3) return false;
  if (pointInPoly2D(px, py, ring)) return true;
  const tolSq = tol * tol;
  const p = [px, py];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    if (pointToSegmentDistSq2D(p, ring[i], ring[(i + 1) % n]) <= tolSq) return true;
  }
  return false;
}

function distToPolygonBoundary2D(px, py, outerRing, holeRings) {
  let minDSq = Infinity;
  const p = [px, py];
  if (outerRing && outerRing.length >= 2) {
    const n = outerRing.length;
    for (let i = 0; i < n; i++) {
      const d = pointToSegmentDistSq2D(p, outerRing[i], outerRing[(i + 1) % n]);
      if (d < minDSq) minDSq = d;
    }
  }
  if (holeRings && holeRings.length > 0) {
    for (let h = 0; h < holeRings.length; h++) {
      const ring = holeRings[h];
      if (!ring || ring.length < 2) continue;
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const d = pointToSegmentDistSq2D(p, ring[i], ring[(i + 1) % n]);
        if (d < minDSq) minDSq = d;
      }
    }
  }
  return minDSq === Infinity ? 0 : Math.sqrt(minDSq);
}

// Gauss-Bonnet characteristic wing half-width for orthogonal multi-wing & courtyard footprints
function computeCharacteristicWingHalfWidth2D(outerClean, holesClean) {
  let perim = 0;
  for (let i = 0, n = outerClean.length; i < n; i++) {
    const a = outerClean[i], b = outerClean[(i + 1) % n];
    perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  let netArea = Math.abs(signedArea2D(outerClean));
  const numHoles = holesClean ? holesClean.length : 0;
  for (let h = 0; h < numHoles; h++) {
    const hole = holesClean[h];
    netArea -= Math.abs(signedArea2D(hole));
    for (let i = 0, n = hole.length; i < n; i++) {
      const a = hole[i], b = hole[(i + 1) % n];
      perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
  }
  netArea = Math.max(1e-4, netArea);
  if (perim < 1e-4) return 1.0;

  if (numHoles === 0) {
    const disc = perim * perim - 16.0 * netArea;
    if (disc >= 0) {
      return Math.max(0.08, (perim - Math.sqrt(disc)) / 8.0);
    }
  }
  const chi = 1 - numHoles;
  if (chi < 0) {
    const cCoeff = -4.0 * chi;
    return Math.max(0.08, (-perim + Math.sqrt(perim * perim + 4.0 * cCoeff * netArea)) / (2.0 * cCoeff));
  }
  return Math.max(0.08, netArea / perim);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isConvexPoly,
    isStarShapedFromCentroid,
    computeMinAreaOBB2D,
    refinePolygonRingMaxEdge2D,
    simplifyClosedRingDP2D,
    isSimplePolygon,
    hasSelfTouchingEdge2D,
    pointInPolyOrNear2D,
    distToPolygonBoundary2D,
    computeCharacteristicWingHalfWidth2D
  };
}
