// ============================================================================
// src/geometry_2d.js
// 2D Polygon Geometry, Keyhole Courtyard Merging, Convex/Box Clipping,
// Ear-Clipping Triangulation & Simple-Polygon Validators
// ============================================================================

function signedArea2D(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p1 = poly[i], p2 = poly[(i + 1) % n];
    a += (p1[0] * p2[1] - p2[0] * p1[1]);
  }
  return a * 0.5;
}

function pointInPoly2D(px, py, poly) {
  let inside = false;
  for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInTri2D(px, py, ax, ay, bx, by, cx, cy) {
  const v0x = cx - ax, v0y = cy - ay;
  const v1x = bx - ax, v1y = by - ay;
  const v2x = px - ax, v2y = py - ay;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-10) return false;
  const inv = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  return (u > -1e-5) && (v > -1e-5) && (u + v < 1 + 1e-5);
}

function dxSq(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function segmentsIntersectProper(a, b, c, d) {
  const ccw = (p1, p2, p3) => (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);
  const d1 = ccw(a, b, c), d2 = ccw(a, b, d);
  const d3 = ccw(c, d, a), d4 = ccw(c, d, b);
  return ((d1 > 1e-6 && d2 < -1e-6) || (d1 < -1e-6 && d2 > 1e-6)) &&
         ((d3 > 1e-6 && d4 < -1e-6) || (d3 < -1e-6 && d4 > 1e-6));
}

// Removes duplicate and collinear vertices so wall loops and cap triangulations share identical vertices
function cleanPolygonRing(ptsInput, wantCCW = true) {
  if (!ptsInput || ptsInput.length < 3) return [];
  let pts = [];
  for (let i = 0; i < ptsInput.length; i++) {
    const p = ptsInput[i];
    if (pts.length === 0 || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 0.03) {
      pts.push([p[0], p[1]]);
    }
  }
  if (pts.length >= 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 0.03) {
    pts.pop();
  }
  if (pts.length < 3) return [];
  const area = signedArea2D(pts);
  if (Math.abs(area) < 1e-4) return [];
  if (wantCCW ? (area < 0) : (area > 0)) pts.reverse();

  // Iteratively strip collinear vertices and zero-area spikes
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    const next = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[(i + n - 1) % n];
      const b = pts[i];
      const c = pts[(i + 1) % n];
      const ux = b[0] - a[0], uy = b[1] - a[1];
      const vx = c[0] - b[0], vy = c[1] - b[1];
      const l1 = Math.hypot(ux, uy), l2 = Math.hypot(vx, vy);
      if (l1 < 0.02 || Math.hypot(c[0] - a[0], c[1] - a[1]) < 0.02) {
        changed = true;
        continue;
      }
      const sinTheta = Math.abs(ux * vy - uy * vx) / ((l1 * l2) || 1e-9);
      if (sinTheta < 1e-3) {
        changed = true;
        continue;
      }
      next.push(b);
    }
    pts = next;
  }
  if (pts.length < 3 || Math.abs(signedArea2D(pts)) < 1e-4) return [];

  // Deduplicate any self-pinching vertex (where non-adjacent vertices share identical coordinates)
  const seen = new Map();
  for (let i = 0; i < pts.length; i++) {
    const k = pts[i][0].toFixed(2) + '_' + pts[i][1].toFixed(2);
    if (seen.has(k)) {
      const ang = (i * 1.6180339) * Math.PI * 2;
      pts[i] = [pts[i][0] + Math.cos(ang) * 0.008, pts[i][1] + Math.sin(ang) * 0.008];
    }
    seen.set(k, i);
  }
  return pts;
}

// Robust Ear-Clipping polygon triangulator that NEVER drops boundary vertices without emitting a triangle
function triangulateSimplePoly(pts) {
  if (!pts || pts.length < 3) return [];
  const indices = pts.map((_, i) => i);
  const tris = [];
  let guard = 0;
  const maxIter = indices.length * 4 + 50;

  while (indices.length > 3 && guard++ < maxIter) {
    const n = indices.length;
    let bestEarIdx = -1;
    let bestDiagSq = Infinity;

    for (let i = 0; i < n; i++) {
      const iPrev = indices[(i + n - 1) % n];
      const iCurr = indices[i];
      const iNext = indices[(i + 1) % n];
      const a = pts[iPrev], b = pts[iCurr], c = pts[iNext];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 1e-7) continue;

      let hasInside = false;
      const tMinX = Math.min(a[0], b[0], c[0]) - 1e-5;
      const tMaxX = Math.max(a[0], b[0], c[0]) + 1e-5;
      const tMinY = Math.min(a[1], b[1], c[1]) - 1e-5;
      const tMaxY = Math.max(a[1], b[1], c[1]) + 1e-5;

      for (let j = 0; j < n; j++) {
        const idx = indices[j];
        if (idx === iPrev || idx === iCurr || idx === iNext) continue;
        const p = pts[idx];
        if (p[0] < tMinX || p[0] > tMaxX || p[1] < tMinY || p[1] > tMaxY) continue;
        if (dxSq(p, a) < 1e-9 || dxSq(p, b) < 1e-9 || dxSq(p, c) < 1e-9) continue;
        if (pointInTri2D(p[0], p[1], a[0], a[1], b[0], b[1], c[0], c[1])) {
          hasInside = true;
          break;
        }
      }
      if (!hasInside) {
        const dSq = dxSq(a, c);
        if (dSq < bestDiagSq) {
          bestDiagSq = dSq;
          bestEarIdx = i;
          if (dSq <= (dxSq(a, b) + dxSq(b, c)) * 1.65) break;
        }
      }
    }

    if (bestEarIdx >= 0) {
      const iPrev = indices[(bestEarIdx + n - 1) % n];
      const iCurr = indices[bestEarIdx];
      const iNext = indices[(bestEarIdx + 1) % n];
      tris.push([pts[iPrev], pts[iCurr], pts[iNext]]);
      indices.splice(bestEarIdx, 1);
      continue;
    }

    // Fallback: pick valid positive-area ear or least-negative ear so every vertex is consumed into a triangle
    let fallbackIdx = 0;
    let bestCross = -Infinity;
    for (let i = 0; i < n; i++) {
      const iPrev = indices[(i + n - 1) % n];
      const iCurr = indices[i];
      const iNext = indices[(i + 1) % n];
      const a = pts[iPrev], b = pts[iCurr], c = pts[iNext];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross > bestCross) {
        bestCross = cross;
        fallbackIdx = i;
      }
    }
    const iPrev = indices[(fallbackIdx + n - 1) % n];
    const iCurr = indices[fallbackIdx];
    const iNext = indices[(fallbackIdx + 1) % n];
    tris.push([pts[iPrev], pts[iCurr], pts[iNext]]);
    indices.splice(fallbackIdx, 1);
  }
  if (indices.length === 3) {
    tris.push([pts[indices[0]], pts[indices[1]], pts[indices[2]]]);
  }
  return tris;
}

// Connects inner courtyard hole rings into outer ring via narrow 0.008-unit keyhole slit so the polygon is strictly simple
function mergeHolesIntoOuterKeyhole(outerInput, holesInput) {
  let outer = outerInput.map(p => [p[0], p[1]]);
  if (!holesInput || holesInput.length === 0) return outer;

  const holes = holesInput
    .filter(h => h && h.length >= 3)
    .map(h => {
      const copy = h.map(p => [p[0], p[1]]);
      if (signedArea2D(copy) > 0) copy.reverse(); // CW for holes
      let maxX = -Infinity, maxIdx = 0;
      for (let i = 0; i < copy.length; i++) {
        if (copy[i][0] > maxX) { maxX = copy[i][0]; maxIdx = i; }
      }
      return { ring: copy, maxX, maxIdx };
    })
    .sort((a, b) => b.maxX - a.maxX);

  for (const hObj of holes) {
    const hRing = hObj.ring;
    const candidates = [];
    for (let hi = 0; hi < hRing.length; hi++) {
      const hx = hRing[hi][0], hy = hRing[hi][1];
      for (let oi = 0; oi < outer.length; oi++) {
        const ox = outer[oi][0], oy = outer[oi][1];
        const d = Math.hypot(ox - hx, oy - hy) + (ox >= hx ? 0 : 35.0);
        candidates.push({ hi, oi, d });
      }
    }
    candidates.sort((a, b) => a.d - b.d);

    let mergedSuccess = null;
    const maxTries = Math.min(candidates.length, 48);
    for (let t = 0; t < maxTries && !mergedSuccess; t++) {
      const { hi, oi } = candidates[t];
      const oPt = outer[oi];
      const hPt = hRing[hi];
      const dx = oPt[0] - hPt[0], dy = oPt[1] - hPt[1];
      const len = Math.hypot(dx, dy) || 1;

      for (const sign of [-1, 1]) {
        const px = (-dy / len) * 0.004 * sign;
        const py = (dx / len) * 0.004 * sign;
        const cand = [];
        for (let i = 0; i < oi; i++) cand.push(outer[i]);
        cand.push([oPt[0] + px, oPt[1] + py]);
        cand.push([hPt[0] + px, hPt[1] + py]);
        for (let i = 1; i < hRing.length; i++) {
          cand.push(hRing[(hi + i) % hRing.length]);
        }
        cand.push([hPt[0] - px, hPt[1] - py]);
        cand.push([oPt[0] - px, oPt[1] - py]);
        for (let i = oi + 1; i < outer.length; i++) cand.push(outer[i]);

        if (isSimplePolygon(cand)) {
          mergedSuccess = cand;
          break;
        }
      }
    }

    if (mergedSuccess) {
      outer = mergedSuccess;
    }
  }
  return outer;
}

function clipPolyToBox(poly, minX, minY, maxX, maxY) {
  if (!poly || poly.length < 3) return [];
  function clipEdge(pts, insideFn, intersectFn) {
    const out = [];
    for (let i = 0, n = pts.length; i < n; i++) {
      const curr = pts[i];
      const prev = pts[(i + n - 1) % n];
      const currIn = insideFn(curr);
      const prevIn = insideFn(prev);
      if (currIn) {
        if (!prevIn) out.push(intersectFn(prev, curr));
        out.push(curr);
      } else if (prevIn) {
        out.push(intersectFn(prev, curr));
      }
    }
    return out;
  }
  let p = poly;
  p = clipEdge(p, pt => pt[0] >= minX, (a, b) => [minX, a[1] + (b[1] - a[1]) * (minX - a[0]) / ((b[0] - a[0]) || 1e-9)]);
  if (p.length < 3) return [];
  p = clipEdge(p, pt => pt[0] <= maxX, (a, b) => [maxX, a[1] + (b[1] - a[1]) * (maxX - a[0]) / ((b[0] - a[0]) || 1e-9)]);
  if (p.length < 3) return [];
  p = clipEdge(p, pt => pt[1] >= minY, (a, b) => [a[0] + (b[0] - a[0]) * (minY - a[1]) / ((b[1] - a[1]) || 1e-9), minY]);
  if (p.length < 3) return [];
  p = clipEdge(p, pt => pt[1] <= maxY, (a, b) => [a[0] + (b[0] - a[0]) * (maxY - a[1]) / ((b[1] - a[1]) || 1e-9), maxY]);
  return p.length >= 3 ? p : [];
}

function clipPolyByConvex(subjectPoly, convexClipPoly, edgeMargin = 0.0) {
  if (!subjectPoly || subjectPoly.length < 3 || !convexClipPoly || convexClipPoly.length < 3) return [];
  let out = subjectPoly.map(p => [p[0], p[1]]);
  const m = convexClipPoly.length;
  for (let k = 0; k < m; k++) {
    const cA = convexClipPoly[k];
    const cB = convexClipPoly[(k + 1) % m];
    const ex = cB[0] - cA[0], ey = cB[1] - cA[1];
    const eLen = Math.hypot(ex, ey);
    if (eLen < 1e-8) continue;
    const minCross = edgeMargin * eLen;
    const input = out;
    out = [];
    const n = input.length;
    if (n < 3) return [];
    for (let i = 0; i < n; i++) {
      const curr = input[i];
      const prev = input[(i + n - 1) % n];
      const dCurr = (ex * (curr[1] - cA[1]) - ey * (curr[0] - cA[0])) - minCross;
      const dPrev = (ex * (prev[1] - cA[1]) - ey * (prev[0] - cA[0])) - minCross;
      const currIn = dCurr >= -1e-9;
      const prevIn = dPrev >= -1e-9;
      if (currIn) {
        if (!prevIn) {
          const t = dPrev / ((dPrev - dCurr) || 1e-12);
          out.push([prev[0] + (curr[0] - prev[0]) * t, prev[1] + (curr[1] - prev[1]) * t]);
        }
        out.push(curr);
      } else if (prevIn) {
        const t = dPrev / ((dPrev - dCurr) || 1e-12);
        out.push([prev[0] + (curr[0] - prev[0]) * t, prev[1] + (curr[1] - prev[1]) * t]);
      }
    }
  }
  return out.length >= 3 ? out : [];
}

function insetPolygonCentroid(poly, insetDist) {
  if (!poly || poly.length < 3 || insetDist <= 0) return poly;
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    cx += poly[i][0];
    cy += poly[i][1];
  }
  cx /= poly.length;
  cy /= poly.length;
  return poly.map(p => {
    const dx = p[0] - cx, dy = p[1] - cy;
    const len = Math.hypot(dx, dy);
    if (len <= insetDist * 2) return [p[0], p[1]];
    const scale = (len - insetDist) / len;
    return [cx + dx * scale, cy + dy * scale];
  });
}

function isConvexPoly(poly) {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n];
    const b = poly[i];
    const c = poly[(i + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cross <= 1e-5) return false;
  }
  return true;
}

function pointToSegmentDistSq2D(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const l2 = vx * vx + vy * vy;
  if (l2 < 1e-12) return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2));
  const projX = a[0] + t * vx, projY = a[1] + t * vy;
  return (p[0] - projX) ** 2 + (p[1] - projY) ** 2;
}

function isSimplePolygon(poly) {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a1 = poly[i], a2 = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = poly[j], b2 = poly[(j + 1) % n];
      if (segmentsIntersectProper(a1, a2, b1, b2)) return false;
      if (pointToSegmentDistSq2D(a1, b1, b2) < 1e-7) return false;
      if (pointToSegmentDistSq2D(b1, a1, a2) < 1e-7) return false;
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
