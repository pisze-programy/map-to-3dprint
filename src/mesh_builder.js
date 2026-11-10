// ============================================================================
// src/mesh_builder.js
// Hardened Multi-Layer 3D Mesh Builder from REAL OpenStreetMap + DEM data:
// - Strict frame & per-tile clipping [-84.6, 84.6] (zero protruding elements)
// - Multi-point footprint ground rooting (zero floating buildings on slopes)
// - Architectural LoD2 roofs (4-slope hipped/gabled on quads, pyramidal on convex, flat on complex wings)
// - Simulation-of-Simplicity Marching-Squares terrain + 1D boundary staircase closure (0 open edges)
// - Continuous vertex-based SLA Hollow Shell with 4 perimeter resin drain/vent channels
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

function pushTri(out, v0, v1, v2, n, layerId, buildingId = -1, tileId = 0) {
  out.push({ v0, v1, v2, n, layerId, buildingId, tileId });
}

function pushQuad(out, p0, p1, p2, p3, n, layerId, buildingId = -1, tileId = 0) {
  out.push({ v0: p0, v1: p1, v2: p2, n, layerId, buildingId, tileId });
  out.push({ v0: p0, v1: p2, v2: p3, n, layerId, buildingId, tileId });
}

function computeFaceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

// Watertight 2-Manifold LoD2 Building Extrusion:
// - Quads (n=4): True 4-slope architectural hipped/gabled roof along major axis (0 spikes, 0 open edges)
// - Convex polygons (n<=10): Single shared centroid apex (0 spikes, 0 open edges)
// - Arbitrary non-convex / multi-wing / L- / U-shaped buildings: Chordal-Axis Spine Pitched Roof (100% 2-manifold, 0 open edges)
function extrudeBuildingLoD2(outerInput, holesInput, zBase, zEaves, zRidge, hasPitchedRoof, layerId, bId, outTris, tileId = 0, roofShape = 'hipped') {
  const outerClean = cleanPolygonRing(outerInput, true);
  if (outerClean.length < 3) return;

  const holesClean = (holesInput || [])
    .map(h => cleanPolygonRing(h, false))
    .filter(h => h.length >= 3);

  // Merge courtyard holes via non-intersecting keyhole slit so walls, floor, and roof share 1 single simple ring
  let ring = holesClean.length > 0 ? mergeHolesIntoOuterKeyhole(outerClean, holesClean) : outerClean;
  if (ring.length < 3) return;
  if (!isSimplePolygon(ring)) {
    ring = outerClean;
    if (!isSimplePolygon(ring)) return;
  }

  const roofTris = triangulateSimplePoly(ring);
  if (roofTris.length === 0) return;

  // 1. Vertical walls along ring (exact 1-to-1 match with floor and roof boundary edges!)
  for (let i = 0, n = ring.length; i < n; i++) {
    const p1 = ring[i], p2 = ring[(i + 1) % n];
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-5) continue;
    const nx = dy / len, ny = -dx / len;
    pushQuad(
      outTris,
      [p1[0], p1[1], zBase],
      [p2[0], p2[1], zBase],
      [p2[0], p2[1], zEaves],
      [p1[0], p1[1], zEaves],
      [nx, ny, 0],
      layerId,
      bId,
      tileId
    );
  }

  // 2. Watertight Bottom Floor Cap at zBase (reversed winding, normal [0, 0, -1])
  for (let i = 0; i < roofTris.length; i++) {
    const [a, b, c] = roofTris[i];
    pushTri(
      outTris,
      [a[0], a[1], zBase],
      [c[0], c[1], zBase],
      [b[0], b[1], zBase],
      [0, 0, -1],
      layerId,
      bId,
      tileId
    );
  }

  const roofH = Math.max(0, zRidge - zEaves);
  const canPitch = hasPitchedRoof && roofH > 0.12 && ring.length >= 3;

  // 3. Watertight Top Roof Cap at zEaves / zRidge
  if (canPitch && holesClean.length === 0 && ring.length === 4 && isConvexPoly(ring) && roofShape !== 'pyramidal' && roofShape !== 'dome') {
    // True 4-slope Hipped / Gabled Roof along longer quad axis
    const p0 = ring[0], p1 = ring[1], p2 = ring[2], p3 = ring[3];
    const len01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
    const len12 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p0[0] - p3[0], p0[1] - p3[1]);
    const q = (len01 >= len12) ? [p0, p1, p2, p3] : [p1, p2, p3, p0];

    const mA = [(q[0][0] + q[3][0]) * 0.5, (q[0][1] + q[3][1]) * 0.5];
    const mB = [(q[1][0] + q[2][0]) * 0.5, (q[1][1] + q[2][1]) * 0.5];
    const cx = (mA[0] + mB[0]) * 0.5, cy = (mA[1] + mB[1]) * 0.5;
    const ridgeFactor = (roofShape === 'gabled') ? 0.78 : 0.45;
    const R0 = [cx + (mA[0] - cx) * ridgeFactor, cy + (mA[1] - cy) * ridgeFactor, zRidge];
    const R1 = [cx + (mB[0] - cx) * ridgeFactor, cy + (mB[1] - cy) * ridgeFactor, zRidge];

    const Q0 = [q[0][0], q[0][1], zEaves];
    const Q1 = [q[1][0], q[1][1], zEaves];
    const Q2 = [q[2][0], q[2][1], zEaves];
    const Q3 = [q[3][0], q[3][1], zEaves];

    pushTri(outTris, Q3, Q0, R0, computeFaceNormal(Q3, Q0, R0), layerId, bId, tileId);
    pushQuad(outTris, Q0, Q1, R1, R0, computeFaceNormal(Q0, Q1, R1), layerId, bId, tileId);
    pushTri(outTris, Q1, Q2, R1, computeFaceNormal(Q1, Q2, R1), layerId, bId, tileId);
    pushQuad(outTris, Q2, Q3, R0, R1, computeFaceNormal(Q2, Q3, R0), layerId, bId, tileId);
  } else if (canPitch && holesClean.length === 0 && ring.length <= 10 && isConvexPoly(ring)) {
    // Clean single-apex hipped/pyramidal cap for convex footprint (3..10 sides)
    let cx = 0, cy = 0;
    for (let i = 0; i < ring.length; i++) {
      cx += ring[i][0];
      cy += ring[i][1];
    }
    cx /= ring.length;
    cy /= ring.length;
    const apex = [cx, cy, zRidge];
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = [ring[i][0], ring[i][1], zEaves];
      const b = [ring[(i + 1) % n][0], ring[(i + 1) % n][1], zEaves];
      pushTri(outTris, a, b, apex, computeFaceNormal(a, b, apex), layerId, bId, tileId);
    }
  } else if (canPitch) {
    // Chordal-Axis Spine Pitched Roof for L/U/T/multi-wing and courtyard buildings (100% 2-manifold, 0 open edges)
    const ptKey = (p) => p[0].toFixed(4) + '_' + p[1].toFixed(4);
    const boundaryEdges = new Set();
    for (let i = 0, n = ring.length; i < n; i++) {
      const kA = ptKey(ring[i]), kB = ptKey(ring[(i + 1) % n]);
      boundaryEdges.add(kA + '|' + kB);
      boundaryEdges.add(kB + '|' + kA);
    }
    for (let i = 0; i < roofTris.length; i++) {
      const [a, b, c] = roofTris[i];
      const C = [(a[0] + b[0] + c[0]) / 3.0, (a[1] + b[1] + c[1]) / 3.0, zRidge];
      const edges = [[a, b], [b, c], [c, a]];
      for (let e = 0; e < 3; e++) {
        const u = edges[e][0], v = edges[e][1];
        const U = [u[0], u[1], zEaves];
        const V = [v[0], v[1], zEaves];
        if (boundaryEdges.has(ptKey(u) + '|' + ptKey(v))) {
          pushTri(outTris, U, V, C, computeFaceNormal(U, V, C), layerId, bId, tileId);
        } else {
          const swap = (u[0] > v[0]) || (u[0] === v[0] && u[1] > v[1]);
          const u0 = swap ? v : u, u1 = swap ? u : v;
          const M = [(u0[0] + u1[0]) * 0.5, (u0[1] + u1[1]) * 0.5, zRidge];
          pushTri(outTris, U, M, C, computeFaceNormal(U, M, C), layerId, bId, tileId);
          pushTri(outTris, M, V, C, computeFaceNormal(M, V, C), layerId, bId, tileId);
        }
      }
    }
  } else {
    // Clean flat architectural roof for explicitly flat-roofed buildings
    for (let i = 0; i < roofTris.length; i++) {
      const [a, b, c] = roofTris[i];
      pushTri(outTris, [a[0], a[1], zEaves], [b[0], b[1], zEaves], [c[0], c[1], zEaves], [0, 0, 1], layerId, bId, tileId);
    }
  }
}

// Closed watertight 5-sided sculpted tree crown anchored flush at zGround (0 overhanging base, 0 floating gap)
function addTreeCrown3D(tx, ty, zGround, radius, height, layerId, outTris, tileId = 0) {
  const sides = 5;
  const rMid = radius * 0.94;
  const z0 = zGround;
  const z1 = zGround + height * 0.48;
  const apex = [tx, ty, zGround + height];
  const basePts = [];

  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);

    const b0 = [tx + c0 * rMid, ty + s0 * rMid, z0];
    const b1 = [tx + c1 * rMid, ty + s1 * rMid, z0];
    const m0 = [tx + c0 * rMid * 0.88, ty + s0 * rMid * 0.88, z1];
    const m1 = [tx + c1 * rMid * 0.88, ty + s1 * rMid * 0.88, z1];
    basePts.push(b0);

    pushQuad(outTris, b0, b1, m1, m0, computeFaceNormal(b0, b1, m1), layerId, -1, tileId);
    pushTri(outTris, m0, m1, apex, computeFaceNormal(m0, m1, apex), layerId, -1, tileId);
  }

  // Watertight bottom pentagon cap at z0
  pushTri(outTris, basePts[0], basePts[2], basePts[1], [0, 0, -1], layerId, -1, tileId);
  pushTri(outTris, basePts[0], basePts[3], basePts[2], [0, 0, -1], layerId, -1, tileId);
  pushTri(outTris, basePts[0], basePts[4], basePts[3], [0, 0, -1], layerId, -1, tileId);
}

// Canonical edge interpolation so adjacent cells and multi-step band clips compute bit-identical intersection coordinates
function interpCellEdgeCanonical(a, b, threshold) {
  const eA = a.isCut ? a.edgeA : (b.isCut ? b.edgeA : a);
  const eB = a.isCut ? a.edgeB : (b.isCut ? b.edgeB : b);
  const ax = eA.x, ay = eA.y, av = eA.v;
  const bx = eB.x, by = eB.y, bv = eB.v;

  const swap = (ax > bx) || (ax === bx && ay > by);
  const x0 = swap ? bx : ax, y0 = swap ? by : ay, v0 = swap ? bv : av;
  const x1 = swap ? ax : bx, y1 = swap ? ay : by, v1 = swap ? av : bv;
  const t = (threshold - v0) / ((v1 - v0) || 1e-9);
  return {
    x: x0 + (x1 - x0) * t,
    y: y0 + (y1 - y0) * t,
    v: threshold,
    edgeA: eA,
    edgeB: eB,
    isCut: true
  };
}

function clipCellPolyByScalar(poly, threshold, keepGreater) {
  const out = [];
  const cutSegments = [];
  const n = poly.length;
  if (n < 3) return { poly: out, cuts: cutSegments };

  for (let i = 0; i < n; i++) {
    const curr = poly[i];
    const prev = poly[(i + n - 1) % n];
    const currIn = keepGreater ? (curr.v >= threshold) : (curr.v <= threshold);
    const prevIn = keepGreater ? (prev.v >= threshold) : (prev.v <= threshold);

    if (currIn) {
      if (!prevIn) {
        out.push(interpCellEdgeCanonical(prev, curr, threshold));
      }
      out.push(curr);
    } else if (prevIn) {
      out.push(interpCellEdgeCanonical(prev, curr, threshold));
    }
  }

  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    const b = out[(i + 1) % out.length];
    if (a.isCut && b.isCut) {
      cutSegments.push([a, b]);
    }
  }
  return { poly: out, cuts: cutSegments };
}

function buildComplete3DModel(scene, state) {
  const meshes = {
    water: [],
    base: [],
    greenery: [],
    roads: [],
    buildings: [],
    highlighted: [],
    frame: []
  };
  const buildingBounds = [];

  if (!scene) return { meshes, buildingBounds, totalTriangles: 0 };

  // Fix U1/B04: If the scene was already fetched for a given cropRatio, only apply relative sub-cropping
  const baseCrop = scene._fetchedCropRatio || 1.0;
  const effectiveCrop = Math.min(1.0, Math.max(0.35, (state.cropRatio || 0.88) / baseCrop));
  const halfSpan = effectiveCrop * 85.0;
  const cropCX = (state.cropCenterX || 0) * 85.0;
  const cropCY = (state.cropCenterY || 0) * 85.0;
  const scaleToBed = 85.0 / halfSpan;

  function toBed(pt) {
    return [(pt[0] - cropCX) * scaleToBed, (pt[1] - cropCY) * scaleToBed];
  }

  // --------------------------------------------------------------------------
  // STEP 1: HIGH-RES 320x320 RASTER MASKS (WATER, GREEN, OCCUPIED)
  // --------------------------------------------------------------------------
  const MASK_RES = 320;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = MASK_RES;
  maskCanvas.height = MASK_RES;
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });

  function bedToMask(bx, by) {
    return [((bx + 85.0) / 170.0) * MASK_RES, ((85.0 - by) / 170.0) * MASK_RES];
  }
  function sampleMaskIdx(bx, by) {
    const mx = Math.min(MASK_RES - 1, Math.max(0, Math.floor(((bx + 85.0) / 170.0) * MASK_RES)));
    const my = Math.min(MASK_RES - 1, Math.max(0, Math.floor(((85.0 - by) / 170.0) * MASK_RES)));
    return my * MASK_RES + mx;
  }

  // 1A. Water Mask
  mctx.clearRect(0, 0, MASK_RES, MASK_RES);
  mctx.fillStyle = '#ffffff';
  mctx.strokeStyle = '#ffffff';
  mctx.lineCap = 'round';
  mctx.lineJoin = 'round';

  (scene.waterPolys || []).forEach(wp => {
    mctx.beginPath();
    wp.outer.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.closePath();
    (wp.holes || []).forEach(h => {
      h.forEach((p, i) => {
        const b = toBed(p);
        const [px, py] = bedToMask(b[0], b[1]);
        if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
      });
      mctx.closePath();
    });
    mctx.fill('evenodd');
  });

  // Fix B11: Realistic waterway width (no artificial 100 m widening)
  (scene.waterLines || []).forEach(wl => {
    const effW = Math.min(5.2, Math.max(1.1, wl.width || 2.0));
    mctx.lineWidth = Math.max(1.8, effW * scaleToBed * (MASK_RES / 170.0));
    mctx.beginPath();
    wl.pts.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.stroke();
  });

  const waterImg = mctx.getImageData(0, 0, MASK_RES, MASK_RES).data;
  const waterMask = new Uint8Array(MASK_RES * MASK_RES);
  for (let i = 0; i < MASK_RES * MASK_RES; i++) {
    waterMask[i] = waterImg[i * 4 + 3] > 90 ? 1 : 0;
  }

  const waterDepth = new Float32Array(MASK_RES * MASK_RES);
  const shoreDist = new Float32Array(MASK_RES * MASK_RES);
  for (let i = 0; i < MASK_RES * MASK_RES; i++) {
    waterDepth[i] = waterMask[i] ? 9999 : 0;
    shoreDist[i] = waterMask[i] ? 0 : 9999;
  }
  for (let y = 1; y < MASK_RES - 1; y++) {
    for (let x = 1; x < MASK_RES - 1; x++) {
      const idx = y * MASK_RES + x;
      if (waterDepth[idx] > 0) {
        waterDepth[idx] = Math.min(waterDepth[idx], waterDepth[idx - 1] + 1, waterDepth[idx - MASK_RES] + 1);
      }
      if (shoreDist[idx] > 0) {
        shoreDist[idx] = Math.min(shoreDist[idx], shoreDist[idx - 1] + 1, shoreDist[idx - MASK_RES] + 1);
      }
    }
  }
  for (let y = MASK_RES - 2; y >= 1; y--) {
    for (let x = MASK_RES - 2; x >= 1; x--) {
      const idx = y * MASK_RES + x;
      if (waterDepth[idx] > 0) {
        waterDepth[idx] = Math.min(waterDepth[idx], waterDepth[idx + 1] + 1, waterDepth[idx + MASK_RES] + 1);
      }
      if (shoreDist[idx] > 0) {
        shoreDist[idx] = Math.min(shoreDist[idx], shoreDist[idx + 1] + 1, shoreDist[idx + MASK_RES] + 1);
      }
    }
  }

  // 1B. Greenery Mask (Fix R1: read greenPolys || greeneryPolys, fill('evenodd') for holes, + riparian bank belt)
  mctx.clearRect(0, 0, MASK_RES, MASK_RES);
  (scene.greenPolys || scene.greeneryPolys || []).forEach(gp => {
    mctx.beginPath();
    gp.outer.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.closePath();
    (gp.holes || []).forEach(h => {
      h.forEach((p, i) => {
        const b = toBed(p);
        const [px, py] = bedToMask(b[0], b[1]);
        if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
      });
      mctx.closePath();
    });
    mctx.fill('evenodd');
  });
  const greenImg = mctx.getImageData(0, 0, MASK_RES, MASK_RES).data;

  // 1C. Separate Road Mask, Bridge/Pier Mask & Building Mask
  mctx.clearRect(0, 0, MASK_RES, MASK_RES);
  (scene.roads || []).forEach(rd => {
    if (rd.bridge) return;
    mctx.lineWidth = Math.max(2.2, rd.width * scaleToBed * (MASK_RES / 170.0) * 1.12);
    mctx.beginPath();
    rd.pts.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.stroke();
  });
  const roadImg = mctx.getImageData(0, 0, MASK_RES, MASK_RES).data;
  const roadMask = new Uint8Array(MASK_RES * MASK_RES);
  for (let i = 0; i < MASK_RES * MASK_RES; i++) {
    roadMask[i] = (roadImg[i * 4 + 3] > 90 && !waterMask[i]) ? 1 : 0;
  }

  mctx.clearRect(0, 0, MASK_RES, MASK_RES);
  (scene.roads || []).forEach(rd => {
    if (!rd.bridge) return;
    mctx.lineWidth = Math.max(2.4, rd.width * scaleToBed * (MASK_RES / 170.0) * 1.18);
    mctx.beginPath();
    rd.pts.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.stroke();
  });
  (scene.buildings || []).forEach(b => {
    if (b.hidden || b.btype !== 'pier') return;
    mctx.beginPath();
    b.outer.forEach((p, i) => {
      const bp = toBed(p);
      const [px, py] = bedToMask(bp[0], bp[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.closePath();
    mctx.fill();
  });
  const bridgeImg = mctx.getImageData(0, 0, MASK_RES, MASK_RES).data;
  const bridgeMask = new Uint8Array(MASK_RES * MASK_RES);
  for (let i = 0; i < MASK_RES * MASK_RES; i++) {
    bridgeMask[i] = bridgeImg[i * 4 + 3] > 90 ? 1 : 0;
  }

  mctx.clearRect(0, 0, MASK_RES, MASK_RES);
  mctx.lineWidth = 4.2;
  (scene.buildings || []).forEach(b => {
    if (b.hidden || b.btype === 'pier') return;
    mctx.beginPath();
    b.outer.forEach((p, i) => {
      const bp = toBed(p);
      const [px, py] = bedToMask(bp[0], bp[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.closePath();
    mctx.fill();
    mctx.stroke();
  });
  const bldImg = mctx.getImageData(0, 0, MASK_RES, MASK_RES).data;
  const bldMask = new Uint8Array(MASK_RES * MASK_RES);
  const roadAndBldMask = new Uint8Array(MASK_RES * MASK_RES);
  const greenMask = new Uint8Array(MASK_RES * MASK_RES);
  for (let i = 0; i < MASK_RES * MASK_RES; i++) {
    bldMask[i] = bldImg[i * 4 + 3] > 60 ? 1 : 0;
    if (bldMask[i]) {
      roadMask[i] = 0;
      bridgeMask[i] = 0;
    }
    roadAndBldMask[i] = (roadMask[i] || bridgeMask[i] || bldMask[i]) ? 1 : 0;
    const isRiparian = (!waterMask[i] && shoreDist[i] > 0 && shoreDist[i] <= 10.5 && !roadAndBldMask[i]);
    greenMask[i] = ((greenImg[i * 4 + 3] > 90 || isRiparian) && !waterMask[i] && !roadMask[i] && !bridgeMask[i] && !bldMask[i]) ? 1 : 0;
  }

  // --------------------------------------------------------------------------
  // STEP 2: REAL DEM INTERPOLATION, DENOISING & LAYER QUANTIZATION
  // --------------------------------------------------------------------------
  const demObj = scene.dem || { gridSize: 2, minElev: 0, maxElev: 10, grid: [[0, 0], [0, 0]] };
  const demN = demObj.gridSize;
  const demRaw = demObj.grid;
  const minElev = demObj.minElev;
  const maxElev = Math.max(minElev + 6.0, demObj.maxElev);

  function sampleRawDemMeters(bx, by) {
    const ox = bx / scaleToBed + cropCX;
    const oy = by / scaleToBed + cropCY;
    const u = Math.min(1, Math.max(0, (ox + 85.0) / 170.0)) * (demN - 1);
    const v = Math.min(1, Math.max(0, (oy + 85.0) / 170.0)) * (demN - 1);
    const i0 = Math.floor(u), i1 = Math.min(demN - 1, i0 + 1);
    const j0 = Math.floor(v), j1 = Math.min(demN - 1, j0 + 1);
    const fu = u - i0, fv = v - j0;
    const z00 = demRaw[j0][i0], z10 = demRaw[j0][i1];
    const z01 = demRaw[j1][i0], z11 = demRaw[j1][i1];
    return (z00 * (1 - fu) + z10 * fu) * (1 - fv) + (z01 * (1 - fu) + z11 * fu) * fv;
  }

  const TERRAIN_RES = 72; // Divisible by 1, 2, 3, 4 for exact multi-tile splits
  const strideT = TERRAIN_RES + 1;
  let demGrid = new Float32Array(strideT * strideT);

  for (let gy = 0; gy <= TERRAIN_RES; gy++) {
    const by = -84.6 + (gy / TERRAIN_RES) * 169.2;
    for (let gx = 0; gx <= TERRAIN_RES; gx++) {
      const bx = -84.6 + (gx / TERRAIN_RES) * 169.2;
      demGrid[gy * strideT + gx] = Math.max(0, sampleRawDemMeters(bx, by) - minElev);
    }
  }

  for (let pass = 0; pass < 3; pass++) {
    const next = new Float32Array(strideT * strideT);
    for (let gy = 0; gy <= TERRAIN_RES; gy++) {
      for (let gx = 0; gx <= TERRAIN_RES; gx++) {
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = Math.min(TERRAIN_RES, Math.max(0, gy + dy));
            const nx = Math.min(TERRAIN_RES, Math.max(0, gx + dx));
            const w = (dx === 0 && dy === 0) ? 4 : (dx === 0 || dy === 0) ? 2 : 1;
            sum += demGrid[ny * strideT + nx] * w;
            cnt += w;
          }
        }
        next[gy * strideT + gx] = sum / cnt;
      }
    }
    demGrid = next;
  }

  const totalWidthMm = state.bedSizeMm || 320;
  const mmPerUnit = totalWidthMm / 169.2;
  const hollowBase = !!state.hollowBase;
  // Fix R11: layerHeightMm comes strictly from printer profile (0.05 mm SLA, 0.20 mm FDM), not hollowBase!
  const layerHeightMm = state.layerHeightMm || (state.isResin ? 0.05 : 0.20);
  const quantizeZUnits = (uVal) => {
    const mm = uVal * mmPerUnit;
    const qMm = Math.max(layerHeightMm, Math.round(mm / layerHeightMm) * layerHeightMm);
    return qMm / mmPerUnit;
  };

  const baseBottomZ = quantizeZUnits(2.45);
  const realElevDelta = Math.max(6.0, maxElev - minElev);
  const adaptiveReliefBase = realElevDelta > 45.0
    ? Math.min(13.2, 7.4 + Math.log10(1.0 + (realElevDelta - 45.0) / 40.0) * 4.6)
    : 7.4;
  const maxReliefMm = adaptiveReliefBase * (state.terrainScale || 1.0);
  const elevSpan = Math.max(20.0, realElevDelta);
  const numContourSteps = 18;
  const stepMm = quantizeZUnits(maxReliefMm / numContourSteps);

  let zGrid = new Float32Array(strideT * strideT);
  for (let gy = 0; gy <= TERRAIN_RES; gy++) {
    const by = -84.6 + (gy / TERRAIN_RES) * 169.2;
    for (let gx = 0; gx <= TERRAIN_RES; gx++) {
      const bx = -84.6 + (gx / TERRAIN_RES) * 169.2;
      const mIdx = sampleMaskIdx(bx, by);
      const relE = demGrid[gy * strideT + gx];
      if (waterMask[mIdx]) {
        zGrid[gy * strideT + gx] = baseBottomZ - 0.14 - Math.min(0.85, waterDepth[mIdx] * 0.045);
      } else {
        const bankBlend = Math.min(1.0, shoreDist[mIdx] / 6.0);
        const hMm = (relE / elevSpan) * maxReliefMm * bankBlend;
        zGrid[gy * strideT + gx] = baseBottomZ + 0.20 + hMm;
      }
    }
  }

  {
    const nextZ = new Float32Array(zGrid.length);
    for (let gy = 0; gy <= TERRAIN_RES; gy++) {
      for (let gx = 0; gx <= TERRAIN_RES; gx++) {
        let sum = zGrid[gy * strideT + gx] * 4.0, w = 4.0;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dx, dy] of dirs) {
          const nx = gx + dx, ny = gy + dy;
          if (nx >= 0 && nx <= TERRAIN_RES && ny >= 0 && ny <= TERRAIN_RES) {
            sum += zGrid[ny * strideT + nx];
            w += 1.0;
          }
        }
        nextZ[gy * strideT + gx] = sum / w;
      }
    }
    zGrid = nextZ;
  }

  // Multi-Tile Grid Configuration (e.g., 1x1, 1x2, 2x2, 2x3, 2x4 for Anycubic Photon Mono 4)
  const tileCols = Math.max(1, Math.min(4, state.tileCols || 1));
  const tileRows = Math.max(1, Math.min(4, state.tileRows || 1));
  const cellsPerCol = Math.floor(TERRAIN_RES / tileCols);
  const cellsPerRow = Math.floor(TERRAIN_RES / tileRows);
  const cellStep = 169.2 / TERRAIN_RES;
  const deepWaterZ = quantizeZUnits(1.76);
  const zSubWater = quantizeZUnits(1.36);
  const zDrainVault = quantizeZUnits(0.72);
  const gHeight = Math.max(layerHeightMm / mmPerUnit, quantizeZUnits(0.28));
  const rHeight = Math.max(layerHeightMm / mmPerUnit, quantizeZUnits(0.36));
  const brHeight = Math.max(layerHeightMm / mmPerUnit, quantizeZUnits(0.56));
  const hollowWallUnits = Math.max(0.55, Math.min(1.15, (state.hollowWallMm || 1.8) / Math.max(1.05, mmPerUnit)));
  let vaultSavedSceneVol = 0;

  const thresholds = [];
  for (let k = 0; k <= numContourSteps + 2; k++) {
    thresholds.push(baseBottomZ + k * stepMm);
  }
  const epsSep = 6e-5;
  const zWaterBot = zSubWater + epsSep;

  // Ensure buildings with courtyards sit on a uniform flat land terrace so 100% of courtyard buildings remain single intact extrusions
  for (let pass = 0; pass < 2; pass++) {
    (scene.buildings || []).forEach(b => {
      if (b.hidden || b.btype === 'pier' || !b.holes || b.holes.length === 0) return;
      const clipped = clipPolyToBox(b.outer.map(toBed), -84.2, -84.2, 84.2, 84.2);
      if (clipped.length < 3) return;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < clipped.length; i++) {
        const p = clipped[i];
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      }
      const gxMin = Math.max(0, Math.floor(((minX + 84.6) / 169.2) * TERRAIN_RES));
      const gxMax = Math.min(TERRAIN_RES - 1, Math.floor(((maxX + 84.6) / 169.2) * TERRAIN_RES));
      const gyMin = Math.max(0, Math.floor(((minY + 84.6) / 169.2) * TERRAIN_RES));
      const gyMax = Math.min(TERRAIN_RES - 1, Math.floor(((maxY + 84.6) / 169.2) * TERRAIN_RES));
      let maxZVal = baseBottomZ + 0.25;
      for (let gy = gyMin; gy <= gyMax + 1; gy++) {
        for (let gx = gxMin; gx <= gxMax + 1; gx++) {
          const v = zGrid[gy * strideT + gx];
          if (v > maxZVal) maxZVal = v;
        }
      }
      for (let gy = gyMin; gy <= gyMax + 1; gy++) {
        for (let gx = gxMin; gx <= gxMax + 1; gx++) {
          zGrid[gy * strideT + gx] = maxZVal;
        }
      }
    });
  }

  // Simulation of Simplicity (Edelsbrunner & Mücke): perturb any grid vertex that lands within 1e-3 of a threshold
  for (let i = 0; i < zGrid.length; i++) {
    for (let k = 0; k <= numContourSteps + 2; k++) {
      if (Math.abs(zGrid[i] - thresholds[k]) < 1e-3) {
        zGrid[i] += 1.2e-3;
      }
    }
  }

  function getStepIdxForVal(zVal) {
    if (zVal < thresholds[0]) return -1;
    for (let k = numContourSteps; k >= 0; k--) {
      if (zVal >= thresholds[k]) return k;
    }
    return 0;
  }

  function getQuantizedTerrainZ(bx, by) {
    const u = Math.min(TERRAIN_RES - 1e-6, Math.max(0, ((bx + 84.6) / 169.2) * TERRAIN_RES));
    const v = Math.min(TERRAIN_RES - 1e-6, Math.max(0, ((by + 84.6) / 169.2) * TERRAIN_RES));
    const gx = Math.min(TERRAIN_RES - 1, Math.floor(u));
    const gy = Math.min(TERRAIN_RES - 1, Math.floor(v));
    const v00 = zGrid[gy * strideT + gx];
    const v10 = zGrid[gy * strideT + (gx + 1)];
    const v11 = zGrid[(gy + 1) * strideT + (gx + 1)];
    const v01 = zGrid[(gy + 1) * strideT + gx];
    const zVal = Math.max(v00, v10, v11, v01);
    const stepIdx = getStepIdxForVal(zVal);
    if (stepIdx < 0) return baseBottomZ;
    return thresholds[stepIdx];
  }

  // Fix R3 & R8: Returns the true minimum printed surface height in cell (gx, gy), including deepWaterZ over water!
  function getActualPrintedSurfaceMinZAtCell(gx, gy) {
    const cx = Math.min(TERRAIN_RES - 1, Math.max(0, gx));
    const cy = Math.min(TERRAIN_RES - 1, Math.max(0, gy));
    const v00 = zGrid[cy * strideT + cx];
    const v10 = zGrid[cy * strideT + (cx + 1)];
    const v11 = zGrid[(cy + 1) * strideT + (cx + 1)];
    const v01 = zGrid[(cy + 1) * strideT + cx];
    const vMin = Math.min(v00, v10, v11, v01);
    const stepIdx = getStepIdxForVal(vMin);
    if (stepIdx < 0) {
      return (state.layerVisible && state.layerVisible.water === false) ? zSubWater : deepWaterZ;
    }
    return thresholds[stepIdx];
  }

  function getActualPrintedSurfaceMinZ(bx, by) {
    const u = Math.min(TERRAIN_RES - 1e-6, Math.max(0, ((bx + 84.6) / 169.2) * TERRAIN_RES));
    const v = Math.min(TERRAIN_RES - 1e-6, Math.max(0, ((by + 84.6) / 169.2) * TERRAIN_RES));
    const gx = Math.min(TERRAIN_RES - 1, Math.floor(u));
    const gy = Math.min(TERRAIN_RES - 1, Math.floor(v));
    let minZ = getActualPrintedSurfaceMinZAtCell(gx, gy);
    if (waterMask[sampleMaskIdx(bx, by)]) {
      const wZ = (state.layerVisible && state.layerVisible.water === false) ? zSubWater : deepWaterZ;
      if (wZ < minZ) minZ = wZ;
    }
    return minZ;
  }

  function getTileColRowForXY(bx, by) {
    const tc = Math.max(0, Math.min(tileCols - 1, Math.floor(((bx + 84.6) / 169.2) * tileCols)));
    const tr = Math.max(0, Math.min(tileRows - 1, Math.floor(((by + 84.6) / 169.2) * tileRows)));
    return [tc, tr, tr * tileCols + tc];
  }

  const cellMinTopZ = new Float32Array(TERRAIN_RES * TERRAIN_RES);
  for (let gy = 0; gy < TERRAIN_RES; gy++) {
    for (let gx = 0; gx < TERRAIN_RES; gx++) {
      const v00 = zGrid[gy * strideT + gx];
      const v10 = zGrid[gy * strideT + (gx + 1)];
      const v11 = zGrid[(gy + 1) * strideT + (gx + 1)];
      const v01 = zGrid[(gy + 1) * strideT + gx];
      const vMin = Math.min(v00, v10, v11, v01);
      const kMin = getStepIdxForVal(vMin);
      cellMinTopZ[gy * TERRAIN_RES + gx] = (kMin < 0) ? zSubWater : thresholds[kMin];
    }
  }

  // Helper to emit a 100% watertight 1D staircase wall along an outer tile boundary cell edge (pA -> pB)
  function emitBoundaryStaircaseWall(ax, ay, vA, fA, bx, by, vB, fB, norm, tileId) {
    const getBandTopZ = (val) => {
      const k = getStepIdxForVal(val);
      return (k < 0) ? zSubWater : thresholds[k];
    };

    const cuts = [];
    const vLo = Math.min(vA, vB), vHi = Math.max(vA, vB);
    for (let k = 0; k <= numContourSteps; k++) {
      const thr = thresholds[k];
      if (thr > vLo && thr < vHi) {
        const pt = interpCellEdgeCanonical({ x: ax, y: ay, v: vA }, { x: bx, y: by, v: vB }, thr);
        const s = Math.hypot(pt.x - ax, pt.y - ay) / (Math.hypot(bx - ax, by - ay) || 1e-9);
        cuts.push({ x: pt.x, y: pt.y, thr, k, s });
      }
    }
    cuts.sort((a, b) => a.s - b.s);

    const chain = [];
    let currZ = getBandTopZ(vA);
    chain.push([ax, ay, currZ]);
    for (let i = 0; i < cuts.length; i++) {
      const c = cuts[i];
      chain.push([c.x, c.y, currZ]);
      const nextZ = (vB > vA)
        ? c.thr
        : (c.k === 0 ? zSubWater : thresholds[c.k - 1]);
      chain.push([c.x, c.y, nextZ]);
      currZ = nextZ;
    }
    chain.push([bx, by, currZ]);

    const AFloor = [ax, ay, fA];
    const BFloor = [bx, by, fB];
    const lastTop = chain[chain.length - 1];

    for (let i = 0; i < chain.length - 1; i++) {
      const P0 = chain[i], P1 = chain[i + 1];
      if (Math.hypot(P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]) > 1e-6) {
        pushTri(meshes.base, AFloor, P1, P0, norm, 1, -1, tileId);
      }
    }
    pushTri(meshes.base, AFloor, BFloor, lastTop, norm, 1, -1, tileId);
  }

  // Helper to emit outer tile boundary wall for the water basin (v <= baseBottomZ)
  function emitWaterBoundaryWall(ax, ay, vA, bx, by, vB, norm, tileId) {
    if (vA >= baseBottomZ && vB >= baseBottomZ) return;
    const pA = { x: ax, y: ay, v: vA };
    const pB = { x: bx, y: by, v: vB };
    if (vA < baseBottomZ && vB < baseBottomZ) {
      pushQuad(meshes.water, [ax, ay, zWaterBot], [bx, by, zWaterBot], [bx, by, deepWaterZ], [ax, ay, deepWaterZ], norm, 0, -1, tileId);
    } else if (vA < baseBottomZ) {
      const cut = interpCellEdgeCanonical(pA, pB, baseBottomZ);
      pushQuad(meshes.water, [ax, ay, zWaterBot], [cut.x, cut.y, zWaterBot], [cut.x, cut.y, deepWaterZ], [ax, ay, deepWaterZ], norm, 0, -1, tileId);
    } else {
      const cut = interpCellEdgeCanonical(pA, pB, baseBottomZ);
      pushQuad(meshes.water, [cut.x, cut.y, zWaterBot], [bx, by, zWaterBot], [bx, by, deepWaterZ], [cut.x, cut.y, deepWaterZ], norm, 0, -1, tileId);
    }
  }

  // Helper to emit a closed prism slab (for greenery turf or road/bridge segments) sitting flush at zBot -> zTop
  function emitClosedSlab2D(poly2d, zBot, zTop, layerId, outTris, tileId) {
    const inset = insetPolygonCentroid(poly2d, 0.008);
    if (inset.length < 3 || Math.abs(signedArea2D(inset)) < 1e-3) return;
    if (signedArea2D(inset) < 0) inset.reverse();
    const p0 = inset[0];
    for (let ti = 1; ti < inset.length - 1; ti++) {
      const p1 = inset[ti], p2 = inset[ti + 1];
      pushTri(outTris, [p0[0], p0[1], zTop], [p1[0], p1[1], zTop], [p2[0], p2[1], zTop], [0, 0, 1], layerId, -1, tileId);
      pushTri(outTris, [p0[0], p0[1], zBot], [p2[0], p2[1], zBot], [p1[0], p1[1], zBot], [0, 0, -1], layerId, -1, tileId);
    }
    for (let i = 0; i < inset.length; i++) {
      const a = inset[i], b = inset[(i + 1) % inset.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len > 1e-5) {
        pushQuad(outTris, [a[0], a[1], zBot], [b[0], b[1], zBot], [b[0], b[1], zTop], [a[0], a[1], zTop], [dy / len, -dx / len, 0], layerId, -1, tileId);
      }
    }
  }

  function getCellSubTypes(x0, y0, x1, y1) {
    const mx = (x0 + x1) * 0.5, my = (y0 + y1) * 0.5;
    const subBoxes = [
      [x0, y0, mx, my],
      [mx, y0, x1, my],
      [x0, my, mx, y1],
      [mx, my, x1, y1]
    ];
    const subTypes = [0, 0, 0, 0]; // 0 = empty, 1 = road, 2 = green
    let rdCount = 0, grCount = 0;
    for (let s = 0; s < 4; s++) {
      const [sx0, sy0, sx1, sy1] = subBoxes[s];
      const mIdx = sampleMaskIdx((sx0 + sx1) * 0.5, (sy0 + sy1) * 0.5);
      const hasBld =
        bldMask[mIdx] === 1 ||
        bldMask[sampleMaskIdx(sx0, sy0)] === 1 ||
        bldMask[sampleMaskIdx(sx1, sy0)] === 1 ||
        bldMask[sampleMaskIdx(sx0, sy1)] === 1 ||
        bldMask[sampleMaskIdx(sx1, sy1)] === 1;
      const isRd = !hasBld && (roadMask[mIdx] === 1 || bridgeMask[mIdx] === 1);
      const isGr = !hasBld && !isRd && greenMask[mIdx] === 1;
      if (isRd) { subTypes[s] = 1; rdCount++; }
      else if (isGr) { subTypes[s] = 2; grCount++; }
    }
    return { subBoxes, subTypes, rdCount, grCount };
  }

  function emitCellFeatureSlabs(polyXY, x0, y0, x1, y1, tZ, tileId) {
    const { subBoxes, subTypes, rdCount, grCount } = getCellSubTypes(x0, y0, x1, y1);
    const zBot = tZ + epsSep;
    if (rdCount === 4) {
      const fullPoly = polyXY || [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      emitClosedSlab2D(fullPoly, zBot, tZ + rHeight, 3, meshes.roads, tileId);
      return;
    }
    if (grCount === 4) {
      const fullPoly = polyXY || [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      emitClosedSlab2D(fullPoly, zBot, tZ + gHeight, 2, meshes.greenery, tileId);
      return;
    }
    for (let s = 0; s < 4; s++) {
      if (subTypes[s] === 0) continue;
      const [sx0, sy0, sx1, sy1] = subBoxes[s];
      const clipped = polyXY ? clipPolyToBox(polyXY, sx0, sy0, sx1, sy1) : [[sx0, sy0], [sx1, sy0], [sx1, sy1], [sx0, sy1]];
      if (clipped.length < 3) continue;
      if (subTypes[s] === 1) {
        emitClosedSlab2D(clipped, zBot, tZ + rHeight, 3, meshes.roads, tileId);
      } else {
        emitClosedSlab2D(clipped, zBot, tZ + gHeight, 2, meshes.greenery, tileId);
      }
    }
  }

  // --------------------------------------------------------------------------
  // STEP 3: PER-TILE WATERTIGHT WATER, STEPPED DEM BASE, GREENERY & ROADS
  // --------------------------------------------------------------------------
  const cellTerracePolys = Array.from({ length: TERRAIN_RES * TERRAIN_RES }, () => []);
  const waterSurfZ = (state.layerVisible && state.layerVisible.water === false) ? zSubWater : deepWaterZ;
  for (let tr = 0; tr < tileRows; tr++) {
    const gy0 = tr * cellsPerRow;
    const gy1 = (tr === tileRows - 1) ? TERRAIN_RES : (tr + 1) * cellsPerRow;
    const tileY0 = -84.6 + gy0 * cellStep + (tr > 0 ? 0.002 : 0);
    const tileY1 = -84.6 + gy1 * cellStep - (tr < tileRows - 1 ? 0.002 : 0);
    const tileStepY = (tileY1 - tileY0) / (gy1 - gy0);

    for (let tc = 0; tc < tileCols; tc++) {
      const gx0 = tc * cellsPerCol;
      const gx1 = (tc === tileCols - 1) ? TERRAIN_RES : (tc + 1) * cellsPerCol;
      const tileX0 = -84.6 + gx0 * cellStep + (tc > 0 ? 0.002 : 0);
      const tileX1 = -84.6 + gx1 * cellStep - (tc < tileCols - 1 ? 0.002 : 0);
      const tileStepX = (tileX1 - tileX0) / (gx1 - gx0);
      const tileId = tr * tileCols + tc;

      const rimCells = 3;
      const hasVault = hollowBase && (gx1 - gx0 > rimCells * 2 + 2) && (gy1 - gy0 > rimCells * 2 + 2);
      const midGx = Math.floor((gx0 + gx1) * 0.5);
      const midGy = Math.floor((gy0 + gy1) * 0.5);

      // Fix R2: Continuous Vertex-Based Hollow Floor for Layer 1 (meshes.base) with 4 SLA Resin Drain Channels on the Rim!
      // Floor is ALWAYS strictly below cellMinTopZ (even under rivers, zDrainVault = 0.72 < zSubWater = 1.36), so 0 negative winding & 0 cavities!
      const getBaseVertexFloorZ = (vx, vy) => {
        if (!hasVault) return 0.0;
        const inVaultX = (vx > gx0 + rimCells && vx < gx1 - rimCells);
        const inVaultY = (vy > gy0 + rimCells && vy < gy1 - rimCells);
        const isDrainChannel =
          (vx >= midGx - 1 && vx <= midGx + 1 && (vy <= gy0 + rimCells || vy >= gy1 - rimCells)) ||
          (vy >= midGy - 1 && vy <= midGy + 1 && (vx <= gx0 + rimCells || vx >= gx1 - rimCells));
        if (!inVaultX || !inVaultY) {
          return isDrainChannel ? zDrainVault : 0.0;
        }
        let minTop = Infinity;
        for (let dy = -1; dy <= 0; dy++) {
          for (let dx = -1; dx <= 0; dx++) {
            const cx = Math.min(gx1 - 1, Math.max(gx0, vx + dx));
            const cy = Math.min(gy1 - 1, Math.max(gy0, vy + dy));
            const ct = cellMinTopZ[cy * TERRAIN_RES + cx];
            if (ct < minTop) minTop = ct;
          }
        }
        return Math.max(zDrainVault, quantizeZUnits(minTop - hollowWallUnits));
      };

      for (let gy = gy0; gy < gy1; gy++) {
        const y0 = tileY0 + (gy - gy0) * tileStepY;
        const y1 = tileY0 + (gy + 1 - gy0) * tileStepY;
        for (let gx = gx0; gx < gx1; gx++) {
          const x0 = tileX0 + (gx - gx0) * tileStepX;
          const x1 = tileX0 + (gx + 1 - gx0) * tileStepX;

          const v00 = zGrid[gy * strideT + gx];
          const v10 = zGrid[gy * strideT + (gx + 1)];
          const v11 = zGrid[(gy + 1) * strideT + (gx + 1)];
          const v01 = zGrid[(gy + 1) * strideT + gx];

          const f00 = getBaseVertexFloorZ(gx, gy);
          const f10 = getBaseVertexFloorZ(gx + 1, gy);
          const f11 = getBaseVertexFloorZ(gx + 1, gy + 1);
          const f01 = getBaseVertexFloorZ(gx, gy + 1);

          const avgFloor = (f00 + f10 + f11 + f01) * 0.25;
          if (avgFloor > 0) {
            vaultSavedSceneVol += avgFloor * tileStepX * tileStepY;
          }

          // Continuous bottom floor of Layer 1 (meshes.base) with true face normals so vault & drain channels render crisply from below!
          const pf00 = [x0, y0, f00], pf10 = [x1, y0, f10], pf11 = [x1, y1, f11], pf01 = [x0, y1, f01];
          pushTri(meshes.base, pf00, pf01, pf11, computeFaceNormal(pf00, pf01, pf11), 1, -1, tileId);
          pushTri(meshes.base, pf00, pf11, pf10, computeFaceNormal(pf00, pf11, pf10), 1, -1, tileId);

          // Outer tile boundary staircase walls for Layer 1 (meshes.base) & Layer 0 (meshes.water)
          if (gy === gy0) {
            emitBoundaryStaircaseWall(x0, y0, v00, f00, x1, y0, v10, f10, [0, -1, 0], tileId);
            emitWaterBoundaryWall(x0, y0, v00, x1, y0, v10, [0, -1, 0], tileId);
          }
          if (gy === gy1 - 1) {
            emitBoundaryStaircaseWall(x1, y1, v11, f11, x0, y1, v01, f01, [0, 1, 0], tileId);
            emitWaterBoundaryWall(x1, y1, v11, x0, y1, v01, [0, 1, 0], tileId);
          }
          if (gx === gx0) {
            emitBoundaryStaircaseWall(x0, y1, v01, f01, x0, y0, v00, f00, [-1, 0, 0], tileId);
            emitWaterBoundaryWall(x0, y1, v01, x0, y0, v00, [-1, 0, 0], tileId);
          }
          if (gx === gx1 - 1) {
            emitBoundaryStaircaseWall(x1, y0, v10, f10, x1, y1, v11, f11, [1, 0, 0], tileId);
            emitWaterBoundaryWall(x1, y0, v10, x1, y1, v11, [1, 0, 0], tileId);
          }

          const vMax = Math.max(v00, v10, v11, v01);
          const vMin = Math.min(v00, v10, v11, v01);

          // Pure underwater cell: base top at zSubWater, water slab from zWaterBot -> deepWaterZ (0 overlap, 0 cavities, 0 negative winding!)
          if (vMax < baseBottomZ) {
            pushQuad(meshes.base, [x0, y0, zSubWater], [x1, y0, zSubWater], [x1, y1, zSubWater], [x0, y1, zSubWater], [0, 0, 1], 1, -1, tileId);
            pushQuad(meshes.water, [x0, y0, deepWaterZ], [x1, y0, deepWaterZ], [x1, y1, deepWaterZ], [x0, y1, deepWaterZ], [0, 0, 1], 0, -1, tileId);
            pushQuad(meshes.water, [x0, y0, zWaterBot], [x0, y1, zWaterBot], [x1, y1, zWaterBot], [x1, y0, zWaterBot], [0, 0, -1], 0, -1, tileId);
            cellTerracePolys[gy * TERRAIN_RES + gx].push({
              poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
              zSurf: waterSurfZ,
              tileId
            });
            // Bridges / piers over pure water cell sit flush on deepWaterZ + epsSep
            const mx = (x0 + x1) * 0.5, my = (y0 + y1) * 0.5;
            const subBoxes = [
              [x0, y0, mx, my],
              [mx, y0, x1, my],
              [x0, my, mx, y1],
              [mx, my, x1, y1]
            ];
            for (let s = 0; s < 4; s++) {
              const [sx0, sy0, sx1, sy1] = subBoxes[s];
              const mIdx = sampleMaskIdx((sx0 + sx1) * 0.5, (sy0 + sy1) * 0.5);
              const hasBld =
                bldMask[mIdx] === 1 ||
                bldMask[sampleMaskIdx(sx0, sy0)] === 1 ||
                bldMask[sampleMaskIdx(sx1, sy0)] === 1 ||
                bldMask[sampleMaskIdx(sx0, sy1)] === 1 ||
                bldMask[sampleMaskIdx(sx1, sy1)] === 1;
              if (!hasBld && bridgeMask[mIdx] === 1) {
                emitClosedSlab2D([[sx0, sy0], [sx1, sy0], [sx1, sy1], [sx0, sy1]], deepWaterZ + epsSep, deepWaterZ + brHeight, 3, meshes.roads, tileId);
              }
            }
            continue;
          }

          const kMinRaw = getStepIdxForVal(vMin);
          const kMax = getStepIdxForVal(vMax);
          if (kMinRaw >= 0 && kMinRaw === kMax) {
            const tZ = thresholds[kMinRaw];
            pushQuad(meshes.base, [x0, y0, tZ], [x1, y0, tZ], [x1, y1, tZ], [x0, y1, tZ], [0, 0, 1], 1, -1, tileId);
            cellTerracePolys[gy * TERRAIN_RES + gx].push({
              poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
              zSurf: tZ,
              tileId
            });
            emitCellFeatureSlabs(null, x0, y0, x1, y1, tZ, tileId);
            continue;
          }

          const c00 = { x: x0, y: y0, v: v00, isCut: false };
          const c10 = { x: x1, y: y0, v: v10, isCut: false };
          const c11 = { x: x1, y: y1, v: v11, isCut: false };
          const c01 = { x: x0, y: y1, v: v01, isCut: false };
          const cellTris = [
            [c00, c10, c11],
            [c00, c11, c01]
          ];

          const gradX = (v10 - v00) + (v11 - v01);
          const gradY = (v01 - v00) + (v11 - v10);
          const gLen = Math.hypot(gradX, gradY) || 1;
          const riserNorm = [-gradX / gLen, -gradY / gLen, 0];

          for (let ct = 0; ct < 2; ct++) {
            const cellTri = cellTris[ct];
            const tvMin = Math.min(cellTri[0].v, cellTri[1].v, cellTri[2].v);
            const tvMax = Math.max(cellTri[0].v, cellTri[1].v, cellTri[2].v);

            if (tvMin < baseBottomZ) {
              const subWater = clipCellPolyByScalar(cellTri, baseBottomZ, false);
              const swp = subWater.poly;
              if (swp.length >= 3) {
                const p0 = swp[0];
                for (let ti = 1; ti < swp.length - 1; ti++) {
                  const p1 = swp[ti], p2 = swp[ti + 1];
                  pushTri(meshes.base, [p0.x, p0.y, zSubWater], [p1.x, p1.y, zSubWater], [p2.x, p2.y, zSubWater], [0, 0, 1], 1, -1, tileId);
                  pushTri(meshes.water, [p0.x, p0.y, deepWaterZ], [p1.x, p1.y, deepWaterZ], [p2.x, p2.y, deepWaterZ], [0, 0, 1], 0, -1, tileId);
                  pushTri(meshes.water, [p0.x, p0.y, zWaterBot], [p2.x, p2.y, zWaterBot], [p1.x, p1.y, zWaterBot], [0, 0, -1], 0, -1, tileId);
                }
                cellTerracePolys[gy * TERRAIN_RES + gx].push({
                  poly: swp.map(pt => [pt.x, pt.y]),
                  zSurf: waterSurfZ,
                  tileId
                });
                for (const [cA, cB] of subWater.cuts) {
                  pushQuad(
                    meshes.water,
                    [cB.x, cB.y, zWaterBot],
                    [cA.x, cA.y, zWaterBot],
                    [cA.x, cA.y, deepWaterZ],
                    [cB.x, cB.y, deepWaterZ],
                    [-riserNorm[0], -riserNorm[1], 0],
                    0,
                    -1,
                    tileId
                  );
                }
              }
            }

            if (tvMax < baseBottomZ) continue;

            const tkMinRaw = getStepIdxForVal(tvMin);
            const tkMax = getStepIdxForVal(tvMax);
            const tkStart = Math.max(0, tkMinRaw);

            for (let k = tkStart; k <= tkMax; k++) {
              const tLow = thresholds[k];
              const tHigh = (k === numContourSteps) ? Infinity : thresholds[k + 1];
              if (tvMax < tLow) break;

              const aboveLow = clipCellPolyByScalar(cellTri, tLow, true);
              if (aboveLow.poly.length < 3) continue;

              for (const [cA, cB] of aboveLow.cuts) {
                const zRiserBot = (k === 0) ? zSubWater : thresholds[k - 1];
                const zRiserTop = tLow;
                pushQuad(
                  meshes.base,
                  [cA.x, cA.y, zRiserBot],
                  [cB.x, cB.y, zRiserBot],
                  [cB.x, cB.y, zRiserTop],
                  [cA.x, cA.y, zRiserTop],
                  riserNorm,
                  1,
                  -1,
                  tileId
                );
              }

              if (tvMin < tHigh) {
                const band = clipCellPolyByScalar(aboveLow.poly, tHigh, false);
                const bp = band.poly;
                if (bp.length >= 3) {
                  const p0 = bp[0];
                  for (let ti = 1; ti < bp.length - 1; ti++) {
                    const p1 = bp[ti], p2 = bp[ti + 1];
                    pushTri(meshes.base, [p0.x, p0.y, tLow], [p1.x, p1.y, tLow], [p2.x, p2.y, tLow], [0, 0, 1], 1, -1, tileId);
                  }
                  const bpXY = bp.map(pt => [pt.x, pt.y]);
                  cellTerracePolys[gy * TERRAIN_RES + gx].push({
                    poly: bpXY,
                    zSurf: tLow,
                    tileId
                  });
                  emitCellFeatureSlabs(bpXY, x0, y0, x1, y1, tLow, tileId);
                }
              }
            }
          }
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // STEP 4: WATERTIGHT 3D SCULPTED TREES (FLUSH ON FLAT TERRACE / TURF, 0 FLOATING)
  // --------------------------------------------------------------------------
  const placedTrees = [];
  (scene.trees || []).forEach((tr, idx) => {
    const [bx, by] = toBed([tr[0], tr[1]]);
    if (bx < -82.8 || bx > 82.8 || by < -82.8 || by > 82.8) return;
    const mIdx = sampleMaskIdx(bx, by);
    if (waterMask[mIdx] || roadAndBldMask[mIdx]) return;

    const treeRadius = (0.54 + (idx % 5) * 0.09) * Math.min(1.15, Math.sqrt(scaleToBed));
    const u = ((bx + 84.6) / 169.2) * TERRAIN_RES;
    const v = ((by + 84.6) / 169.2) * TERRAIN_RES;
    const gx = Math.min(TERRAIN_RES - 1, Math.max(0, Math.floor(u)));
    const gy = Math.min(TERRAIN_RES - 1, Math.max(0, Math.floor(v)));

    // Ensure the entire tree crown base sits within a single flat terrain cell (0 step overhang!)
    const cellX0 = -84.6 + gx * cellStep;
    const cellX1 = cellX0 + cellStep;
    const cellY0 = -84.6 + gy * cellStep;
    const cellY1 = cellY0 + cellStep;
    const cx = Math.min(cellX1 - treeRadius - 0.05, Math.max(cellX0 + treeRadius + 0.05, bx));
    const cy = Math.min(cellY1 - treeRadius - 0.05, Math.max(cellY0 + treeRadius + 0.05, by));

    const v00 = zGrid[gy * strideT + gx];
    const v10 = zGrid[gy * strideT + (gx + 1)];
    const v11 = zGrid[(gy + 1) * strideT + (gx + 1)];
    const v01 = zGrid[(gy + 1) * strideT + gx];
    const kMinRaw = getStepIdxForVal(Math.min(v00, v10, v11, v01));
    const kMax = getStepIdxForVal(Math.max(v00, v10, v11, v01));
    if (kMinRaw < 0 || kMinRaw !== kMax) return;

    // Use exact same getCellSubTypes as emitCellFeatureSlabs so tree base height matches cell turf/bare state 1:1
    const { rdCount, grCount } = getCellSubTypes(cellX0, cellY0, cellX1, cellY1);
    if (rdCount > 0 || (grCount !== 0 && grCount !== 4)) return;

    // Check 8 points on tree perimeter so tree crown never touches buildings, roads, or water
    let crownBlocked = false;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const pIdx = sampleMaskIdx(cx + Math.cos(ang) * (treeRadius + 0.12), cy + Math.sin(ang) * (treeRadius + 0.12));
      if (bldMask[pIdx] || roadMask[pIdx] || bridgeMask[pIdx] || waterMask[pIdx]) {
        crownBlocked = true;
        break;
      }
    }
    if (crownBlocked) return;

    const [tc, trRow, tileId] = getTileColRowForXY(cx, cy);
    const tileX0 = -84.6 + tc * cellsPerCol * cellStep;
    const tileX1 = (tc === tileCols - 1) ? 84.6 : -84.6 + (tc + 1) * cellsPerCol * cellStep;
    const tileY0 = -84.6 + trRow * cellsPerRow * cellStep;
    const tileY1 = (trRow === tileRows - 1) ? 84.6 : -84.6 + (trRow + 1) * cellsPerRow * cellStep;

    const margin = treeRadius + 0.06;
    if (cx - margin < tileX0 || cx + margin > tileX1 || cy - margin < tileY0 || cy + margin > tileY1) return;

    for (let j = 0; j < placedTrees.length; j++) {
      const pt = placedTrees[j];
      if (Math.hypot(cx - pt[0], cy - pt[1]) < (treeRadius + pt[2]) * 1.08) return;
    }
    placedTrees.push([cx, cy, treeRadius]);

    // Anchor tree base at tZ + gHeight + epsSep on green turf or tZ + epsSep on bare terrain
    const tZ = thresholds[kMinRaw];
    const zG = (grCount === 4) ? (tZ + gHeight + epsSep) : (tZ + epsSep);
    const treeHeight = (1.30 + (idx % 6) * 0.22) * (state.zScale || 1.0) * 0.85;
    addTreeCrown3D(cx, cy, zG, treeRadius, treeHeight, 2, meshes.greenery, tileId);
  });

  // --------------------------------------------------------------------------
  // STEP 6: REAL OSM BUILDINGS (0 FLOATING, 0 INTER-LAYER OVERLAP, 0 OPEN EDGES)
  // --------------------------------------------------------------------------
  const mToU = (scene.metersToUnits || 0.13) * scaleToBed;
  const rawBuildings = scene.buildings || [];

  const prepared = [];
  for (let i = 0; i < rawBuildings.length; i++) {
    const b = rawBuildings[i];
    if (b.hidden || b.btype === 'pier') continue;
    const bedOuterRaw = b.outer.map(toBed);
    const clippedOuter = cleanPolygonRing(clipPolyToBox(bedOuterRaw, -84.2, -84.2, 84.2, 84.2), true);
    if (clippedOuter.length < 3 || hasSelfTouchingEdge2D(clippedOuter, 1e-4)) continue;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < clippedOuter.length; k++) {
      const p = clippedOuter[k];
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const minSpan = Math.min(spanX, spanY);
    const area = Math.abs(signedArea2D(clippedOuter));
    if (minSpan < 0.55 || area < 0.45) continue;

    const clippedHoles = (b.holes || [])
      .map(h => clipPolyToBox(h.map(toBed), -84.2, -84.2, 84.2, 84.2))
      .filter(h => h.length >= 3);

    prepared.push({
      b,
      clippedOuter,
      clippedHoles,
      minX, maxX, minY, maxY,
      minSpan,
      area,
      cx: (minX + maxX) * 0.5,
      cy: (minY + maxY) * 0.5,
      groupId: b.id,
      skipDuplicate: false
    });
  }

  prepared.sort((a, b) => b.area - a.area);

  function polygonsOverlap2D(A, B) {
    if (A.maxX <= B.minX + 0.015 || A.minX >= B.maxX - 0.015 || A.maxY <= B.minY + 0.015 || A.minY >= B.maxY - 0.015) {
      return false;
    }
    const inAHole = (px, py) => A.clippedHoles.some(h => pointInPoly2D(px, py, h));
    const inBHole = (px, py) => B.clippedHoles.some(h => pointInPoly2D(px, py, h));
    if (pointInPoly2D(B.cx, B.cy, A.clippedOuter) && !inAHole(B.cx, B.cy)) return true;
    if (pointInPoly2D(A.cx, A.cy, B.clippedOuter) && !inBHole(A.cx, A.cy)) return true;
    for (let i = 0; i < B.clippedOuter.length; i++) {
      const p = B.clippedOuter[i];
      if (pointInPoly2D(p[0], p[1], A.clippedOuter) && !inAHole(p[0], p[1])) return true;
    }
    for (let i = 0; i < A.clippedOuter.length; i++) {
      const p = A.clippedOuter[i];
      if (pointInPoly2D(p[0], p[1], B.clippedOuter) && !inBHole(p[0], p[1])) return true;
    }
    for (let i = 0; i < A.clippedOuter.length; i++) {
      const a1 = A.clippedOuter[i], a2 = A.clippedOuter[(i + 1) % A.clippedOuter.length];
      for (let j = 0; j < B.clippedOuter.length; j++) {
        const b1 = B.clippedOuter[j], b2 = B.clippedOuter[(j + 1) % B.clippedOuter.length];
        if (segmentsIntersectProper(a1, a2, b1, b2)) return true;
      }
    }
    return false;
  }

  // Deduplicate overlapping building / building:part footprints so 0 buildings self-overlap in 3D
  for (let i = 0; i < prepared.length; i++) {
    const P = prepared[i];
    if (P.skipDuplicate) continue;
    for (let j = i + 1; j < prepared.length; j++) {
      const C = prepared[j];
      if (C.skipDuplicate) continue;
      if (polygonsOverlap2D(P, C)) {
        if (C.b.h > P.b.h) {
          P.b.h = C.b.h;
          P.b.levels = C.b.levels;
        }
        if (C.b.highlighted) P.b.highlighted = true;
        C.skipDuplicate = true;
      }
    }
  }

  const groupHighlighted = new Set();
  const groupHeightMult = new Map();
  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    if (item.b.highlighted) groupHighlighted.add(item.groupId);
    if (item.b.heightMult && item.b.heightMult !== 1.0) {
      groupHeightMult.set(item.groupId, item.b.heightMult);
    }
  }

  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    if (item.skipDuplicate) continue;
    const b = item.b;
    const gid = item.groupId;

    const gxMin = Math.max(0, Math.floor(((item.minX + 84.6) / 169.2) * TERRAIN_RES));
    const gxMax = Math.min(TERRAIN_RES - 1, Math.floor(((item.maxX + 84.6) / 169.2) * TERRAIN_RES));
    const gyMin = Math.max(0, Math.floor(((item.minY + 84.6) / 169.2) * TERRAIN_RES));
    const gyMax = Math.min(TERRAIN_RES - 1, Math.floor(((item.maxY + 84.6) / 169.2) * TERRAIN_RES));

    const insetOuter = insetPolygonCentroid(item.clippedOuter, 0.012);
    const intersectingTerraces = [];
    const uniqueSurfs = new Set();
    let minTerrainZ = Infinity;
    let maxTerrainZ = -Infinity;

    for (let gy = gyMin; gy <= gyMax; gy++) {
      for (let gx = gxMin; gx <= gxMax; gx++) {
        const tList = cellTerracePolys[gy * TERRAIN_RES + gx];
        for (let t = 0; t < tList.length; t++) {
          const tp = tList[t];
          intersectingTerraces.push(tp);
          uniqueSurfs.add(tp.zSurf.toFixed(4));
          if (tp.zSurf < minTerrainZ) minTerrainZ = tp.zSurf;
          if (tp.zSurf > maxTerrainZ) maxTerrainZ = tp.zSurf;
        }
      }
    }
    if (!Number.isFinite(minTerrainZ)) {
      minTerrainZ = getActualPrintedSurfaceMinZ(item.cx, item.cy);
      maxTerrainZ = getQuantizedTerrainZ(item.cx, item.cy);
      uniqueSurfs.add(minTerrainZ.toFixed(4));
    }

    const hMult = (groupHeightMult.get(gid) || b.heightMult || 1.0) * (state.zScale || 1.0);
    let totalHMm = Math.max(1.25, b.h * mToU * hMult);

    if (item.minSpan < 2.6) {
      const maxPrintableH = Math.max(1.8, item.minSpan * 2.85);
      if (totalHMm > maxPrintableH) {
        totalHMm = maxPrintableH;
      }
    }

    let roofHMm = (b.roof !== 'flat') ? Math.max(0.45, (b.roofH || 3.2) * mToU * hMult) : 0;
    roofHMm = Math.min(roofHMm, item.minSpan * 0.45, totalHMm * 0.34);

    const isHl = groupHighlighted.has(gid) || !!b.highlighted;
    const zBase = minTerrainZ + epsSep;
    const zEaves = quantizeZUnits(maxTerrainZ + Math.max(0.95, totalHMm - roofHMm * 0.35));
    const zRidge = (b.roof !== 'flat' && roofHMm > 0.14)
      ? Math.max(zEaves + 0.16, quantizeZUnits(zEaves + roofHMm))
      : zEaves;

    const targetLayerId = isHl ? 5 : 4;
    const targetList = isHl ? meshes.highlighted : meshes.buildings;
    const hasPitched = (b.roof !== 'flat' && roofHMm > 0.14);

    if (uniqueSurfs.size <= 1) {
      // Uniform flat terrace underneath entire building bounding box: extrude intact!
      if (tileCols === 1 && tileRows === 1) {
        extrudeBuildingLoD2(insetOuter, item.clippedHoles, zBase, zEaves, zRidge, hasPitched, targetLayerId, gid, targetList, 0, b.roof || 'hipped');
      } else {
        for (let tr = 0; tr < tileRows; tr++) {
          const ty0 = -84.6 + tr * cellsPerRow * cellStep;
          const ty1 = (tr === tileRows - 1) ? 84.6 : -84.6 + (tr + 1) * cellsPerRow * cellStep;
          if (item.maxY <= ty0 || item.minY >= ty1) continue;

          for (let tc = 0; tc < tileCols; tc++) {
            const tx0 = -84.6 + tc * cellsPerCol * cellStep;
            const tx1 = (tc === tileCols - 1) ? 84.6 : -84.6 + (tc + 1) * cellsPerCol * cellStep;
            if (item.maxX <= tx0 || item.minX >= tx1) continue;

            const tileId = tr * tileCols + tc;
            if (item.minX >= tx0 + 0.03 && item.maxX <= tx1 - 0.03 && item.minY >= ty0 + 0.03 && item.maxY <= ty1 - 0.03) {
              extrudeBuildingLoD2(insetOuter, item.clippedHoles, zBase, zEaves, zRidge, hasPitched, targetLayerId, gid, targetList, tileId, b.roof || 'hipped');
              continue;
            }

            const tileBox = [[tx0, ty0], [tx1, ty0], [tx1, ty1], [tx0, ty1]];
            const outerClean = cleanPolygonRing(insetOuter, true);
            if (isConvexPoly(outerClean) && item.clippedHoles.length === 0) {
              const bTileOuter = cleanPolygonRing(clipPolyByConvex(outerClean, tileBox, 0.03), true);
              if (bTileOuter.length >= 3 && signedArea2D(bTileOuter) >= 0.06 && isSimplePolygon(bTileOuter)) {
                extrudeBuildingLoD2(bTileOuter, [], zBase, zEaves, zRidge, hasPitched, targetLayerId, gid, targetList, tileId, b.roof || 'hipped');
              }
            } else {
              const holesClean = (item.clippedHoles || []).map(h => cleanPolygonRing(h, false)).filter(h => h.length >= 3);
              let baseRing = holesClean.length > 0 ? mergeHolesIntoOuterKeyhole(outerClean, holesClean) : outerClean;
              if (!isSimplePolygon(baseRing)) baseRing = outerClean;
              const baseTris = triangulateSimplePoly(baseRing);
              for (let ti = 0; ti < baseTris.length; ti++) {
                const tri = baseTris[ti];
                if (signedArea2D(tri) <= 1e-4) continue;
                const triInset = clipPolyByConvex(tri, tri, 0.008);
                if (triInset.length < 3) continue;
                const clippedTri = cleanPolygonRing(clipPolyByConvex(triInset, tileBox, 0.03), true);
                if (clippedTri.length >= 3 && signedArea2D(clippedTri) >= 0.035 && isSimplePolygon(clippedTri)) {
                  extrudeBuildingLoD2(clippedTri, [], zBase, zEaves, zRidge, hasPitched, targetLayerId, gid, targetList, tileId, b.roof || 'hipped');
                }
              }
            }
          }
        }
      }
    } else {
      // Building straddles a contour riser or shoreline: clip convex pieces against each convex terrace polygon with 0.015 perpendicular margin!
      const outerClean = cleanPolygonRing(insetOuter, true);
      const holesClean = (item.clippedHoles || []).map(h => cleanPolygonRing(h, false)).filter(h => h.length >= 3);
      let baseRing = holesClean.length > 0 ? mergeHolesIntoOuterKeyhole(outerClean, holesClean) : outerClean;
      if (!isSimplePolygon(baseRing)) baseRing = outerClean;
      const isBaseConvex = (holesClean.length === 0 && isConvexPoly(baseRing));
      const baseTris = isBaseConvex ? [baseRing] : triangulateSimplePoly(baseRing);

      for (let t = 0; t < intersectingTerraces.length; t++) {
        const tp = intersectingTerraces[t];
        const zPieceBase = tp.zSurf + epsSep;
        for (let ti = 0; ti < baseTris.length; ti++) {
          const subjectRaw = baseTris[ti];
          if (signedArea2D(subjectRaw) <= 1e-4) continue;
          const subject = isBaseConvex ? subjectRaw : clipPolyByConvex(subjectRaw, subjectRaw, 0.008);
          if (subject.length < 3) continue;
          const piece = cleanPolygonRing(clipPolyByConvex(subject, tp.poly, 0.015), true);
          if (piece.length >= 3 && signedArea2D(piece) >= 0.035 && isSimplePolygon(piece)) {
            extrudeBuildingLoD2(piece, [], zPieceBase, zEaves, zRidge, hasPitched, targetLayerId, gid, targetList, tp.tileId, b.roof || 'hipped');
          }
        }
      }
    }

    buildingBounds.push({
      building: b,
      groupId: gid,
      minX: item.minX, maxX: item.maxX,
      minY: item.minY, maxY: item.maxY,
      minZ: zBase, maxZ: hasPitched ? zRidge : zEaves,
      layerId: targetLayerId
    });
  }

  // --------------------------------------------------------------------------
  // STEP 7: MITERED STUDIO FRAME (LAYER 6 — STUDIO DISPLAY ONLY, NOT EXPORTED!)
  // --------------------------------------------------------------------------
  const innerR = 84.85;
  const outerR = 94.5;
  const zFrameBot = -1.6;
  const zFrameTop = 3.55;
  const miterQuads = [
    [[-outerR, -outerR], [outerR, -outerR], [innerR, -innerR], [-innerR, -innerR]],
    [[outerR, -outerR], [outerR, outerR], [innerR, innerR], [innerR, -innerR]],
    [[outerR, outerR], [-outerR, outerR], [-innerR, innerR], [innerR, innerR]],
    [[-outerR, outerR], [-outerR, -outerR], [-innerR, -innerR], [-innerR, innerR]]
  ];
  miterQuads.forEach(mq => {
    extrudeBuildingLoD2(mq, [], zFrameBot, zFrameTop, zFrameTop, false, 6, -1, meshes.frame, -1, 'flat');
  });

  // --------------------------------------------------------------------------
  // STEP 8: EXACT MATHEMATICAL VOLUME (ml), MASS (g) & REAL TOPOLOGY PREFLIGHT (Fix R9)
  // --------------------------------------------------------------------------
  let totalTriangles = 0;
  const printableKeys = ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted'];
  const scaleMm = totalWidthMm / 169.2;
  const scaleMm3 = scaleMm * scaleMm * scaleMm;

  const numTiles = tileCols * tileRows;
  const tileVolumesMm3 = new Float64Array(numTiles);
  const layerVolumesMm3 = {};
  let maxSceneZ = 3.0;
  let outOfTileTrisCount = 0;
  let openEdgesCount = 0;
  let nonManifoldEdgesCount = 0;
  let negativeWindingCount = 0;
  let floatingBuildingsCount = 0;

  // Measure real welded topology (toFixed(3) mm) across all printable layers
  printableKeys.forEach(k => {
    const arr = meshes[k] || [];
    totalTriangles += arr.length;
    if (state.layerVisible && !state.layerVisible[k]) {
      layerVolumesMm3[k] = 0;
      return;
    }
    let lVolScene = 0;
    const vMap = new Map();
    const edgeCounts = new Map();
    let nextVid = 0;
    const getVid = (pt) => {
      const key = `${((pt[0] + 84.6) * scaleMm).toFixed(3)}_${((pt[1] + 84.6) * scaleMm).toFixed(3)}_${Math.max(0, pt[2] * scaleMm).toFixed(3)}`;
      let id = vMap.get(key);
      if (id === undefined) {
        id = nextVid++;
        vMap.set(key, id);
      }
      return id;
    };

    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      const a = t.v0, b = t.v1, c = t.v2;
      if (a[2] > maxSceneZ) maxSceneZ = a[2];
      if (b[2] > maxSceneZ) maxSceneZ = b[2];
      if (c[2] > maxSceneZ) maxSceneZ = c[2];
      const v6 = (a[0] * (b[1] * c[2] - b[2] * c[1]) -
                  a[1] * (b[0] * c[2] - b[2] * c[0]) +
                  a[2] * (b[0] * c[1] - b[1] * c[0]));
      lVolScene += v6;
      const tid = (t.tileId >= 0 && t.tileId < numTiles) ? t.tileId : 0;
      tileVolumesMm3[tid] += v6;

      const i0 = getVid(a), i1 = getVid(b), i2 = getVid(c);
      if (i0 !== i1 && i1 !== i2 && i2 !== i0) {
        const pairs = [[i0, i1], [i1, i2], [i2, i0]];
        for (let e = 0; e < 3; e++) {
          const u = pairs[e][0], v = pairs[e][1];
          const ek = u < v ? `${u}_${v}` : `${v}_${u}`;
          edgeCounts.set(ek, (edgeCounts.get(ek) || 0) + 1);
        }
      }

      if (numTiles > 1) {
        const tcIdx = tid % tileCols, trIdx = Math.floor(tid / tileCols);
        const tx0 = -84.6 + tcIdx * cellsPerCol * cellStep - 0.01;
        const tx1 = (tcIdx === tileCols - 1 ? 84.6 : -84.6 + (tcIdx + 1) * cellsPerCol * cellStep) + 0.01;
        const ty0 = -84.6 + trIdx * cellsPerRow * cellStep - 0.01;
        const ty1 = (trIdx === tileRows - 1 ? 84.6 : -84.6 + (trIdx + 1) * cellsPerRow * cellStep) + 0.01;
        for (const v of [a, b, c]) {
          if (v[0] < tx0 || v[0] > tx1 || v[1] < ty0 || v[1] > ty1) {
            outOfTileTrisCount++;
            break;
          }
        }
      }
    }

    for (const c of edgeCounts.values()) {
      if (c === 1) openEdgesCount++;
      else if (c > 2) nonManifoldEdgesCount++;
    }
    if (arr.length > 0 && lVolScene < -1e-3) {
      negativeWindingCount++;
    }
    layerVolumesMm3[k] = Math.max(0, (lVolScene / 6.0) * scaleMm3);
  });

  // Measure real building ground clearance against actual printed surface
  for (let i = 0; i < buildingBounds.length; i++) {
    const bb = buildingBounds[i];
    const cx = (bb.minX + bb.maxX) * 0.5, cy = (bb.minY + bb.maxY) * 0.5;
    const surfZ = getActualPrintedSurfaceMinZ(cx, cy);
    if ((bb.minZ - surfZ) * scaleMm > 0.05) {
      floatingBuildingsCount++;
    }
  }

  let totalVolumeMm3 = 0;
  const tileVolumesMl = [];
  for (let tid = 0; tid < numTiles; tid++) {
    const vMm3 = Math.max(0, (tileVolumesMm3[tid] / 6.0) * scaleMm3);
    totalVolumeMm3 += vMm3;
    tileVolumesMl.push(vMm3 / 1000.0);
  }

  const totalVolumeMl = totalVolumeMm3 / 1000.0;
  const solidReferenceMl = totalVolumeMl + (vaultSavedSceneVol * scaleMm3) / 1000.0;
  const hollowSavingsPct = hollowBase && solidReferenceMl > 0
    ? Math.round(((solidReferenceMl - totalVolumeMl) / solidReferenceMl) * 100)
    : 0;

  const maxZMm = Math.max(6.0, maxSceneZ * scaleMm);
  const tileWidthMm = totalWidthMm / tileCols;
  const tileHeightMm = (state.totalHeightMm || totalWidthMm) / tileRows;
  const maxTileVolumeMl = tileVolumesMl.length ? Math.max(...tileVolumesMl) : totalVolumeMl;

  // Fix R9: Remove artificial 2200.0 ml check from fitsPhotonMono4; compute isWatertightManifold from real welded topology!
  const printMetrics = {
    totalVolumeMl,
    solidReferenceMl,
    hollowSavingsPct,
    resinGrams: Math.round(totalVolumeMl * 1.12),
    plaGrams: Math.round(totalVolumeMl * 0.42),
    tileVolumesMl,
    maxTileVolumeMl,
    tileWidthMm,
    tileHeightMm,
    maxZMm,
    tileCols,
    tileRows,
    numTiles,
    openEdgesCount,
    nonManifoldEdgesCount,
    negativeWindingCount,
    floatingBuildingsCount,
    outOfTileTrisCount,
    hasDrainChannels: hollowBase,
    fitsPhotonMono4: (tileWidthMm <= 153.4 + 0.05) && (tileHeightMm <= 87.0 + 0.05) && (maxZMm <= 165.0),
    isWatertightManifold: (
      openEdgesCount === 0 &&
      nonManifoldEdgesCount === 0 &&
      negativeWindingCount === 0 &&
      floatingBuildingsCount === 0 &&
      outOfTileTrisCount === 0 &&
      totalVolumeMl > 0
    ),
    frameExcludedFromExport: true
  };

  return { meshes, buildingBounds, totalTriangles, printMetrics };
}
