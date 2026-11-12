// ============================================================================
// src/geometry/polygon_2d.js
// Core 2D Polygon Predicates, Cleaning, Ear-Clipping, Keyhole Courtyard Merging,
// Sutherland-Hodgman Box/Convex Clipping & Centroid/Min-Span Dilation
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
  return (u >= -1e-6) && (v >= -1e-6) && (u + v <= 1 + 1e-6);
}

function dxSq(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function pointToSegmentDistSq2D(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const l2 = vx * vx + vy * vy;
  if (l2 < 1e-12) return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2));
  const projX = a[0] + t * vx, projY = a[1] + t * vy;
  return (p[0] - projX) ** 2 + (p[1] - projY) ** 2;
}

function segmentsIntersectProper(a, b, c, d) {
  const ccw = (p1, p2, p3) => (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);
  const d1 = ccw(a, b, c), d2 = ccw(a, b, d);
  const d3 = ccw(c, d, a), d4 = ccw(c, d, b);
  return ((d1 > 1e-6 && d2 < -1e-6) || (d1 < -1e-6 && d2 > 1e-6)) &&
         ((d3 > 1e-6 && d4 < -1e-6) || (d3 < -1e-6 && d4 > 1e-6));
}

function cleanPolygonRing(ptsInput, wantCCW = true) {
  if (!ptsInput || ptsInput.length < 3) return [];
  let pts = [];
  for (let i = 0; i < ptsInput.length; i++) {
    const p = ptsInput[i];
    if (pts.length === 0 || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 0.008) {
      pts.push([p[0], p[1]]);
    }
  }
  if (pts.length >= 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 0.008) {
    pts.pop();
  }
  if (pts.length < 3) return [];
  const area = signedArea2D(pts);
  if (Math.abs(area) < 1e-4) return [];
  if (wantCCW ? (area < 0) : (area > 0)) pts.reverse();

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
      if (l1 < 0.008 || Math.hypot(c[0] - a[0], c[1] - a[1]) < 0.008) {
        changed = true;
        continue;
      }
      const sinTheta = Math.abs(ux * vy - uy * vx) / ((l1 * l2) || 1e-9);
      if (sinTheta < 0.006) {
        changed = true;
        continue;
      }
      next.push(b);
    }
    pts = next;
  }
  if (pts.length < 3 || Math.abs(signedArea2D(pts)) < 1e-4) return [];

  const seen = new Map();
  for (let i = 0; i < pts.length; i++) {
    const k = pts[i][0].toFixed(3) + '_' + pts[i][1].toFixed(3);
    if (seen.has(k)) {
      const ang = (i * 1.6180339) * Math.PI * 2;
      pts[i] = [pts[i][0] + Math.cos(ang) * 0.004, pts[i][1] + Math.sin(ang) * 0.004];
    }
    seen.set(k, i);
  }
  return pts;
}

function triangulateSimplePoly(loopPts) {
  if (!loopPts || loopPts.length < 3) return [];

  const pts = [];
  for (let i = 0; i < loopPts.length; i++) {
    const p = loopPts[i];
    if (pts.length === 0 || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 1e-8) {
      pts.push([p[0], p[1]]);
    }
  }
  if (pts.length >= 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 1e-8) {
    pts.pop();
  }
  if (pts.length < 3) return [];

  let a2d = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n];
    a2d += (p1[0] * p2[1] - p2[0] * p1[1]);
  }
  if (a2d < 0) pts.reverse();

  const n = pts.length;
  const nodes = new Array(n);
  for (let i = 0; i < n; i++) nodes[i] = { i, pt: pts[i], prev: null, next: null };
  for (let i = 0; i < n; i++) {
    nodes[i].prev = nodes[(i + n - 1) % n];
    nodes[i].next = nodes[(i + 1) % n];
  }

  function isInsideTri(p, a, b, c) {
    const v0x = c[0] - a[0], v0y = c[1] - a[1];
    const v1x = b[0] - a[0], v1y = b[1] - a[1];
    const v2x = p[0] - a[0], v2y = p[1] - a[1];
    const dot00 = v0x * v0x + v0y * v0y;
    const dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y;
    const dot11 = v1x * v1x + v1y * v1y;
    const dot12 = v1x * v2x + v1y * v2y;
    const denom = dot00 * dot11 - dot01 * dot01;
    if (Math.abs(denom) < 1e-11) return false;
    const inv = 1 / denom;
    const u = (dot11 * dot02 - dot01 * dot12) * inv;
    const v = (dot00 * dot12 - dot01 * dot02) * inv;
    return (u > 1e-6) && (v > 1e-6) && (u + v < 1 - 1e-6);
  }

  function isEar(ear) {
    const a = ear.prev.pt, b = ear.pt, c = ear.next.pt;
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cross <= 1e-8) return false;
    let p = ear.next.next;
    const minX = Math.min(a[0], b[0], c[0]) - 1e-5;
    const maxX = Math.max(a[0], b[0], c[0]) + 1e-5;
    const minY = Math.min(a[1], b[1], c[1]) - 1e-5;
    const maxY = Math.max(a[1], b[1], c[1]) + 1e-5;
    while (p !== ear.prev) {
      const pt = p.pt;
      if (pt[0] >= minX && pt[0] <= maxX && pt[1] >= minY && pt[1] <= maxY) {
        if (isInsideTri(pt, a, b, c)) return false;
      }
      p = p.next;
    }
    return true;
  }

  const tris = [];
  let curr = nodes[0];
  let rem = n;
  let stop = curr;
  let guard = 0;

  while (rem > 3 && guard <= rem * 2) {
    const prev = curr.prev;
    const next = curr.next;
    if (isEar(curr)) {
      tris.push([prev.pt, curr.pt, next.pt]);
      prev.next = next;
      next.prev = prev;
      curr = next;
      stop = next;
      rem--;
      guard = 0;
      continue;
    }
    guard++;
    curr = next;
    if (curr === stop) {
      let bestCross = 1e-8, bestNode = null;
      let check = curr;
      do {
        const a = check.prev.pt, b = check.pt, c = check.next.pt;
        const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (cr > bestCross) { bestCross = cr; bestNode = check; }
        check = check.next;
      } while (check !== curr);
      if (bestNode) {
        tris.push([bestNode.prev.pt, bestNode.pt, bestNode.next.pt]);
        bestNode.prev.next = bestNode.next;
        bestNode.next.prev = bestNode.prev;
        curr = bestNode.next;
        stop = curr;
        rem--;
        guard = 0;
      } else {
        break;
      }
    }
  }
  if (rem === 3) {
    const a = curr.prev.pt, b = curr.pt, c = curr.next.pt;
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) > 1e-9) {
      tris.push([a, b, c]);
    }
  } else if (rem > 3) {
    const remPts = [];
    let p = curr;
    for (let i = 0; i < rem; i++) {
      remPts.push(p.pt);
      p = p.next;
    }
    for (let k = 1; k < remPts.length - 1; k++) {
      const a = remPts[0], b = remPts[k], c = remPts[k + 1];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross > 1e-9) tris.push([a, b, c]);
    }
  }
  return tris;
}

function earcutPolygon2D(ring) {
  return triangulateSimplePoly(ring);
}

function mergeHolesIntoOuterKeyhole(outerInput, holesInput, mergedOut = null) {
  if (!outerInput || outerInput.length < 3) return [];
  let outer = outerInput.map(p => [p[0], p[1]]);
  if (signedArea2D(outer) < 0) outer.reverse();
  if (!holesInput || holesInput.length === 0) return outer;

  const validHoles = holesInput
    .filter(h => h && h.length >= 3)
    .map(h => {
      const copy = h.map(p => [p[0], p[1]]);
      if (signedArea2D(copy) > 0) copy.reverse();
      let maxX = -Infinity, maxIdx = 0;
      for (let i = 0; i < copy.length; i++) {
        if (copy[i][0] > maxX || (copy[i][0] === maxX && copy[i][1] > copy[maxIdx][1])) {
          maxX = copy[i][0];
          maxIdx = i;
        }
      }
      return { orig: h, ring: copy, maxX, maxIdx };
    })
    .sort((a, b) => b.maxX - a.maxX);

  const usedBridgeKeys = new Set();
  const ptKey = p => p[0].toFixed(5) + '_' + p[1].toFixed(5);

  for (let hIdx = 0; hIdx < validHoles.length; hIdx++) {
    const hObj = validHoles[hIdx];
    const hRing = hObj.ring;
    const hi = hObj.maxIdx;
    const H = hRing[hi];

    const candidates = [];
    for (let oi = 0; oi < outer.length; oi++) {
      const ox = outer[oi][0], oy = outer[oi][1];
      const reusePenalty = usedBridgeKeys.has(ptKey(outer[oi])) ? 200.0 : 0.0;
      const d = Math.hypot(ox - H[0], oy - H[1]) + (ox >= H[0] ? 0 : 50.0) + reusePenalty;
      candidates.push({ oi, d });
    }
    candidates.sort((a, b) => a.d - b.d);

    let bestOi = -1;
    for (let ci = 0; ci < candidates.length; ci++) {
      const oi = candidates[ci].oi;
      const V = outer[oi];
      if (dxSq(H, V) < 1e-8) continue;
      const mid = [(H[0] + V[0]) * 0.5, (H[1] + V[1]) * 0.5];

      let intersects = false;
      const nOut = outer.length;
      for (let i = 0; i < nOut; i++) {
        const p1 = outer[i], p2 = outer[(i + 1) % nOut];
        if (dxSq(p1, V) < 1e-10 || dxSq(p2, V) < 1e-10) continue;
        if (segmentsIntersectProper(H, V, p1, p2) || pointToSegmentDistSq2D(p1, H, V) < 1e-7) {
          intersects = true; break;
        }
      }
      if (intersects) continue;

      const nHole = hRing.length;
      for (let i = 0; i < nHole; i++) {
        if (i === hi || (i + 1) % nHole === hi) continue;
        if (segmentsIntersectProper(H, V, hRing[i], hRing[(i + 1) % nHole]) || pointToSegmentDistSq2D(hRing[i], H, V) < 1e-7) {
          intersects = true; break;
        }
      }
      if (intersects) continue;

      for (let oIdx = hIdx + 1; oIdx < validHoles.length && !intersects; oIdx++) {
        const oRing = validHoles[oIdx].ring;
        if (pointInPoly2D(mid[0], mid[1], oRing)) { intersects = true; break; }
        for (let i = 0, m = oRing.length; i < m; i++) {
          if (segmentsIntersectProper(H, V, oRing[i], oRing[(i + 1) % m]) || pointToSegmentDistSq2D(oRing[i], H, V) < 1e-7) {
            intersects = true; break;
          }
        }
      }
      if (intersects || !pointInPoly2D(mid[0], mid[1], outer) || pointInPoly2D(mid[0], mid[1], hRing)) continue;

      bestOi = oi;
      break;
    }

    if (bestOi >= 0) {
      const V = outer[bestOi];
      usedBridgeKeys.add(ptKey(V));
      usedBridgeKeys.add(ptKey(H));
      const spliced = [];
      for (let i = 0; i <= bestOi; i++) spliced.push(outer[i]);
      for (let i = 0; i < hRing.length; i++) spliced.push(hRing[(hi + i) % hRing.length]);
      spliced.push([hRing[hi][0], hRing[hi][1]]);
      spliced.push([V[0], V[1]]);
      for (let i = bestOi + 1; i < outer.length; i++) spliced.push(outer[i]);
      outer = spliced;
      if (mergedOut) mergedOut.push(hObj.orig);
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
  for (let i = 0; i < poly.length; i++) { cx += poly[i][0]; cy += poly[i][1]; }
  cx /= poly.length; cy /= poly.length;
  return poly.map(p => {
    const dx = p[0] - cx, dy = p[1] - cy;
    const len = Math.hypot(dx, dy);
    if (len <= insetDist * 2) return [p[0], p[1]];
    const scale = (len - insetDist) / len;
    return [cx + dx * scale, cy + dy * scale];
  });
}

function dilatePolygonMinSpan2D(ring, minSpanUnits) {
  if (!ring || ring.length < 3) return ring;
  let cx = 0, cy = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const x = ring[i][0], y = ring[i][1];
    cx += x; cy += y;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  cx /= ring.length; cy /= ring.length;
  const minSpan = Math.min(maxX - minX, maxY - minY);
  if (minSpan >= minSpanUnits) {
    const copy = ring.map(p => [p[0], p[1]]);
    if (signedArea2D(copy) < 0) copy.reverse();
    return copy;
  }
  const scale = minSpan > 1e-5 ? (minSpanUnits / minSpan) : 1.0;
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const dx = ring[i][0] - cx, dy = ring[i][1] - cy;
    if (minSpan > 1e-5) out.push([cx + dx * scale, cy + dy * scale]);
    else {
      const ang = (i / ring.length) * Math.PI * 2;
      const r = minSpanUnits * 0.5;
      out.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
    }
  }
  if (signedArea2D(out) < 0) out.reverse();
  return out;
}

function isPolygonStrictlyInside(inner, outer) {
  if (!inner || inner.length < 3 || !outer || outer.length < 3) return false;
  if (Math.abs(signedArea2D(inner)) < 1e-4) return false;
  // 1. All vertices of inner must be strictly inside outer
  for (let i = 0; i < inner.length; i++) {
    if (!pointInPoly2D(inner[i][0], inner[i][1], outer)) return false;
  }
  // 2. All edge midpoints must be inside outer (guards against reflex bridges)
  for (let i = 0; i < inner.length; i++) {
    const p1 = inner[i], p2 = inner[(i + 1) % inner.length];
    const mx = (p1[0] + p2[0]) * 0.5, my = (p1[1] + p2[1]) * 0.5;
    if (!pointInPoly2D(mx, my, outer)) return false;
  }
  // 3. No edge of inner can intersect any edge of outer
  for (let i = 0; i < inner.length; i++) {
    const p1 = inner[i], p2 = inner[(i + 1) % inner.length];
    for (let j = 0; j < outer.length; j++) {
      const o1 = outer[j], o2 = outer[(j + 1) % outer.length];
      if (segmentsIntersectProper(p1, p2, o1, o2)) return false;
    }
  }
  // 4. Ensure inner does not self-intersect
  for (let i = 0; i < inner.length; i++) {
    const a1 = inner[i], a2 = inner[(i + 1) % inner.length];
    for (let j = i + 2; j < inner.length; j++) {
      if (i === 0 && j === inner.length - 1) continue;
      const b1 = inner[j], b2 = inner[(j + 1) % inner.length];
      if (segmentsIntersectProper(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

function computeReliefChimneyPolygon(outerRing, holeRings = [], insetDist = 2.0) {
  if (!outerRing || outerRing.length < 3) return null;
  const outerClean = cleanPolygonRing(outerRing, true);
  if (outerClean.length < 3 || Math.abs(signedArea2D(outerClean)) < 1e-4) return null;
  if (signedArea2D(outerClean) < 0) outerClean.reverse();

  // 1. Primary: Parallel line-intersection inward offset
  const n = outerClean.length;
  const offsetLines = [];
  for (let i = 0; i < n; i++) {
    const p1 = outerClean[i], p2 = outerClean[(i + 1) % n];
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-5) continue;
    const nx = -dy / len, ny = dx / len;
    const c = nx * p1[0] + ny * p1[1] + insetDist;
    offsetLines.push({ nx, ny, c, p1, p2 });
  }

  const offsetPts = [];
  const m = offsetLines.length;
  if (m >= 3) {
    for (let i = 0; i < m; i++) {
      const L1 = offsetLines[(i + m - 1) % m];
      const L2 = offsetLines[i];
      const det = L1.nx * L2.ny - L1.ny * L2.nx;
      if (Math.abs(det) < 1e-4) {
        offsetPts.push([L2.p1[0] + L2.nx * insetDist, L2.p1[1] + L2.ny * insetDist]);
      } else {
        const ix = (L1.c * L2.ny - L1.ny * L2.c) / det;
        const iy = (L1.nx * L2.c - L1.c * L2.nx) / det;
        offsetPts.push([ix, iy]);
      }
    }
  }

  let candPoly = (offsetPts.length >= 3 && signedArea2D(offsetPts) > 1e-4) ? cleanPolygonRing(offsetPts, true) : null;
  const isCandValid = candPoly && candPoly.length >= 3 &&
    signedArea2D(candPoly) > 1e-4 &&
    isPolygonStrictlyInside(candPoly, outerClean);

  let chimCW = null;
  if (isCandValid) {
    chimCW = candPoly.map(p => [p[0], p[1]]);
  } else {
    // 2. Fallback: Concentric OBB Inset
    const obb = (typeof computeMinAreaOBB2D === 'function')
      ? computeMinAreaOBB2D(outerClean)
      : null;
    if (obb && obb.halfL > insetDist * 1.35 && obb.halfW > insetDist * 1.35) {
      const hL = obb.halfL - insetDist;
      const hW = obb.halfW - insetDist;
      const obbCorners = [
        [obb.cx + obb.ux * hL + obb.vx * hW, obb.cy + obb.uy * hL + obb.vy * hW],
        [obb.cx - obb.ux * hL + obb.vx * hW, obb.cy - obb.uy * hL + obb.vy * hW],
        [obb.cx - obb.ux * hL - obb.vx * hW, obb.cy - obb.uy * hL - obb.vy * hW],
        [obb.cx + obb.ux * hL - obb.vx * hW, obb.cy + obb.uy * hL - obb.vy * hW]
      ];
      if (isPolygonStrictlyInside(obbCorners, outerClean)) {
        chimCW = obbCorners;
      }
    }
    // 3. Fallback: Centroid Inset
    if (!chimCW && typeof insetPolygonCentroid === 'function') {
      const centInset = insetPolygonCentroid(outerClean, insetDist);
      if (centInset && centInset.length >= 3 && signedArea2D(centInset) > 1e-4 &&
          isPolygonStrictlyInside(centInset, outerClean)) {
        chimCW = centInset;
      }
    }
  }

  if (!chimCW || chimCW.length < 3) return null;

  // Courtyard hole collision and containment check
  if (holeRings && holeRings.length > 0) {
    for (let h = 0; h < holeRings.length; h++) {
      const hr = holeRings[h];
      for (let i = 0; i < chimCW.length; i++) {
        if (pointInPoly2D(chimCW[i][0], chimCW[i][1], hr)) return null;
      }
      for (let i = 0; i < hr.length; i++) {
        if (pointInPoly2D(hr[i][0], hr[i][1], chimCW)) return null;
      }
      for (let i = 0; i < chimCW.length; i++) {
        const p1 = chimCW[i], p2 = chimCW[(i + 1) % chimCW.length];
        const mx = (p1[0] + p2[0]) * 0.5, my = (p1[1] + p2[1]) * 0.5;
        if (pointInPoly2D(mx, my, hr)) return null;
        for (let j = 0; j < hr.length; j++) {
          const o1 = hr[j], o2 = hr[(j + 1) % hr.length];
          if (segmentsIntersectProper(p1, p2, o1, o2)) return null;
        }
      }
    }
  }

  // Ensure CW orientation for interior hole
  if (signedArea2D(chimCW) > 0) chimCW.reverse();
  return chimCW;
}

if (typeof window !== 'undefined') {
  window.isPolygonStrictlyInside = isPolygonStrictlyInside;
  window.computeReliefChimneyPolygon = computeReliefChimneyPolygon;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    signedArea2D, pointInPoly2D, pointInTri2D, dxSq, pointToSegmentDistSq2D, segmentsIntersectProper,
    cleanPolygonRing, triangulateSimplePoly, earcutPolygon2D, mergeHolesIntoOuterKeyhole,
    clipPolyToBox, clipPolyByConvex, insetPolygonCentroid, dilatePolygonMinSpan2D,
    isPolygonStrictlyInside,
    computeReliefChimneyPolygon
  };
}
