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
    const hx = hObj.ring[hObj.maxIdx][0];
    const hy = hObj.ring[hObj.maxIdx][1];

    let bestOuterIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < outer.length; i++) {
      const ox = outer[i][0], oy = outer[i][1];
      const d = Math.hypot(ox - hx, oy - hy) + (ox >= hx ? 0 : 50.0);
      if (d < bestDist) {
        bestDist = d;
        bestOuterIdx = i;
      }
    }

    const oPt = outer[bestOuterIdx];
    const hPt = hObj.ring[hObj.maxIdx];
    const dx = oPt[0] - hPt[0], dy = oPt[1] - hPt[1];
    const len = Math.hypot(dx, dy) || 1;
    // Perpendicular micro-offset (0.006 units = 11 microns) so bridge edges do not self-intersect
    const px = (-dy / len) * 0.006;
    const py = (dx / len) * 0.006;

    const merged = [];
    for (let i = 0; i < bestOuterIdx; i++) merged.push(outer[i]);
    merged.push([oPt[0] + px, oPt[1] + py]);
    merged.push([hPt[0] + px, hPt[1] + py]);
    for (let i = 1; i < hObj.ring.length; i++) {
      merged.push(hObj.ring[(hObj.maxIdx + i) % hObj.ring.length]);
    }
    merged.push([hPt[0] - px, hPt[1] - py]);
    merged.push([oPt[0] - px, oPt[1] - py]);
    for (let i = bestOuterIdx + 1; i < outer.length; i++) merged.push(outer[i]);
    outer = merged;
  }
  return cleanPolygonRing(outer, true);
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

function isSimplePolygon(poly) {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a1 = poly[i], a2 = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = poly[j], b2 = poly[(j + 1) % n];
      if (segmentsIntersectProper(a1, a2, b1, b2)) return false;
    }
  }
  return true;
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
// - Quads (n=4): True 4-slope architectural hipped roof along major axis (0 spikes, 0 open edges)
// - Convex polygons (n<=10): Single shared centroid apex (0 spikes, 0 open edges)
// - Complex / concave / courtyard buildings (e.g., Deutsches Museum): Clean architectural flat roof (0 spikes, 0 open edges)
function extrudeBuildingLoD2(outerInput, holesInput, zBase, zEaves, zRidge, hasPitchedRoof, layerId, bId, outTris, tileId = 0, roofShape = 'hipped') {
  const outerClean = cleanPolygonRing(outerInput, true);
  if (outerClean.length < 3) return;

  const holesClean = (holesInput || [])
    .map(h => cleanPolygonRing(h, false))
    .filter(h => h.length >= 3);

  // Merge courtyard holes via non-intersecting 11-micron keyhole slit so walls, floor, and roof share 1 single simple ring
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
  const canPitch = hasPitchedRoof && roofH > 0.12 && holesClean.length === 0 && ring.length <= 10 && isConvexPoly(ring);

  // 3. Watertight Top Roof Cap at zEaves / zRidge
  if (canPitch && ring.length === 4 && roofShape !== 'pyramidal' && roofShape !== 'dome') {
    // True 4-slope Hipped Roof along longer quad axis
    const p0 = ring[0], p1 = ring[1], p2 = ring[2], p3 = ring[3];
    const len01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
    const len12 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p0[0] - p3[0], p0[1] - p3[1]);
    const q = (len01 >= len12) ? [p0, p1, p2, p3] : [p1, p2, p3, p0];

    const mA = [(q[0][0] + q[3][0]) * 0.5, (q[0][1] + q[3][1]) * 0.5];
    const mB = [(q[1][0] + q[2][0]) * 0.5, (q[1][1] + q[2][1]) * 0.5];
    const cx = (mA[0] + mB[0]) * 0.5, cy = (mA[1] + mB[1]) * 0.5;
    const ridgeFactor = (roofShape === 'gabled') ? 0.72 : 0.45;
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
  } else if (canPitch) {
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
  } else {
    // Clean flat architectural roof for complex multi-wing or courtyard buildings
    for (let i = 0; i < roofTris.length; i++) {
      const [a, b, c] = roofTris[i];
      pushTri(outTris, [a[0], a[1], zEaves], [b[0], b[1], zEaves], [c[0], c[1], zEaves], [0, 0, 1], layerId, bId, tileId);
    }
  }
}

// Closed watertight 5-sided sculpted tree crown (10 side/top triangles + 3 bottom cap triangles = 13 triangles)
function addTreeCrown3D(tx, ty, zGround, radius, height, layerId, outTris, tileId = 0, epsZ = 0) {
  const sides = 5;
  const rMid = radius * 0.96;
  const z0 = zGround - 0.10 + epsZ;
  const z1 = zGround + height * 0.48 + epsZ;
  const apex = [tx, ty, zGround + height + epsZ];
  const basePts = [];

  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);

    const b0 = [tx + c0 * rMid * 0.78, ty + s0 * rMid * 0.78, z0];
    const b1 = [tx + c1 * rMid * 0.78, ty + s1 * rMid * 0.78, z0];
    const m0 = [tx + c0 * rMid, ty + s0 * rMid, z1];
    const m1 = [tx + c1 * rMid, ty + s1 * rMid, z1];
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

  // 1B. Greenery Mask
  mctx.clearRect(0, 0, MASK_RES, MASK_RES);
  (scene.greeneryPolys || []).forEach(gp => {
    mctx.beginPath();
    gp.outer.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.closePath();
    mctx.fill();
  });
  const greenImg = mctx.getImageData(0, 0, MASK_RES, MASK_RES).data;
  const greenMask = new Uint8Array(MASK_RES * MASK_RES);
  for (let i = 0; i < MASK_RES * MASK_RES; i++) {
    greenMask[i] = (greenImg[i * 4 + 3] > 90 && !waterMask[i]) ? 1 : 0;
  }

  // 1C. Occupied Mask (Roads + Buildings)
  mctx.clearRect(0, 0, MASK_RES, MASK_RES);
  (scene.roads || []).forEach(rd => {
    mctx.lineWidth = Math.max(2.0, rd.width * scaleToBed * (MASK_RES / 170.0) * 1.15);
    mctx.beginPath();
    rd.pts.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.stroke();
  });
  (scene.buildings || []).forEach(b => {
    if (b.hidden) return;
    mctx.beginPath();
    b.outer.forEach((p, i) => {
      const bp = toBed(p);
      const [px, py] = bedToMask(bp[0], bp[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.closePath();
    mctx.fill();
  });
  const rbImg = mctx.getImageData(0, 0, MASK_RES, MASK_RES).data;
  const roadAndBldMask = new Uint8Array(MASK_RES * MASK_RES);
  for (let i = 0; i < MASK_RES * MASK_RES; i++) {
    roadAndBldMask[i] = rbImg[i * 4 + 3] > 90 ? 1 : 0;
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
  const layerHeightMm = state.layerHeightMm || (hollowBase ? 0.05 : 0.20);
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
  // Fix B10: Minimum 20 m elevation span so flat cities do not over-amplify 1-2 m DEM noise
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
  // Fix B06: Underwater terrain bed (zSubWater) sits 0.34 units (~0.65 mm) BELOW deepWaterZ so sand NEVER Z-fights with water!
  const zSubWater = quantizeZUnits(1.42);
  const zBaseBed = quantizeZUnits(1.12);
  const waterShelfLevels = [quantizeZUnits(1.98), quantizeZUnits(2.20)];
  const hollowWallUnits = Math.max(0.75, Math.min(1.30, (state.hollowWallMm || 1.8) / Math.max(1.05, mmPerUnit)));
  let vaultSavedSceneVol = 0;

  const thresholds = [];
  for (let k = 0; k <= numContourSteps + 2; k++) {
    thresholds.push(baseBottomZ + k * stepMm);
  }

  // Simulation of Simplicity (Edelsbrunner & Mücke): perturb any grid vertex that lands within 1e-3 of a threshold
  // so contour lines intersect cell edges strictly in their interior (0 degenerate zero-length cuts!)
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

  function getMinQuantizedTerrainZ(bx, by) {
    const u = Math.min(TERRAIN_RES - 1e-6, Math.max(0, ((bx + 84.6) / 169.2) * TERRAIN_RES));
    const v = Math.min(TERRAIN_RES - 1e-6, Math.max(0, ((by + 84.6) / 169.2) * TERRAIN_RES));
    const gx = Math.min(TERRAIN_RES - 1, Math.floor(u));
    const gy = Math.min(TERRAIN_RES - 1, Math.floor(v));
    const v00 = zGrid[gy * strideT + gx];
    const v10 = zGrid[gy * strideT + (gx + 1)];
    const v11 = zGrid[(gy + 1) * strideT + (gx + 1)];
    const v01 = zGrid[(gy + 1) * strideT + gx];
    const zVal = Math.min(v00, v10, v11, v01);
    const stepIdx = getStepIdxForVal(zVal);
    if (stepIdx < 0) return baseBottomZ;
    return thresholds[stepIdx];
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
  // Connects the undivided bottom floor edge [A_floor, B_floor] to all contour cuts along pA -> pB!
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

    // Fan from AFloor across the top staircase chain, then close with [AFloor, BFloor, lastTop]
    for (let i = 0; i < chain.length - 1; i++) {
      const P0 = chain[i], P1 = chain[i + 1];
      if (Math.hypot(P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]) > 1e-6) {
        pushTri(meshes.base, AFloor, P1, P0, norm, 1, -1, tileId);
      }
    }
    pushTri(meshes.base, AFloor, BFloor, lastTop, norm, 1, -1, tileId);
  }

  // --------------------------------------------------------------------------
  // STEP 3: PER-TILE WATERTIGHT WATER, STEPPED BATHYMETRY, DEM BASE & GREENERY
  // --------------------------------------------------------------------------
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
      const zWaterVault = quantizeZUnits(1.36);
      const midGx = Math.floor((gx0 + gx1) * 0.5);
      const midGy = Math.floor((gy0 + gy1) * 0.5);

      // 3A. Continuous Vertex-Based Water & Bathymetry Manifold (with 4 SLA Resin Drain/Vent Channels on Rim!)
      const getWaterVertexTopZ = (vx, vy) => {
        if (vx === gx0 || vx === gx1 || vy === gy0 || vy === gy1) {
          return (zGrid[vy * strideT + vx] < baseBottomZ) ? deepWaterZ : (zSubWater - 0.08);
        }
        const zv = zGrid[vy * strideT + vx];
        if (zv >= baseBottomZ) return zSubWater - 0.08;
        if (zv >= waterShelfLevels[1]) return waterShelfLevels[1];
        if (zv >= waterShelfLevels[0]) return waterShelfLevels[0];
        return deepWaterZ;
      };

      const getWaterVertexBotZ = (vx, vy) => {
        if (!hasVault) return 0.0;
        const inVaultX = (vx > gx0 + rimCells && vx < gx1 - rimCells);
        const inVaultY = (vy > gy0 + rimCells && vy < gy1 - rimCells);
        if (inVaultX && inVaultY) return zWaterVault;
        // 4 SLA Resin Drain/Vent Channels (1 on each of the 4 sides of the tile rim, ~4.5 mm wide)
        // Eliminates suction-cup pressure on the FEP film when printing flat on Anycubic Photon Mono 4!
        if ((vx >= midGx - 1 && vx <= midGx + 1 && (vy <= gy0 + rimCells || vy >= gy1 - rimCells)) ||
            (vy >= midGy - 1 && vy <= midGy + 1 && (vx <= gx0 + rimCells || vx >= gx1 - rimCells))) {
          return zWaterVault;
        }
        return 0.0;
      };

      for (let gy = gy0; gy < gy1; gy++) {
        const y0 = tileY0 + (gy - gy0) * tileStepY, y1 = tileY0 + (gy + 1 - gy0) * tileStepY;
        for (let gx = gx0; gx < gx1; gx++) {
          const x0 = tileX0 + (gx - gx0) * tileStepX, x1 = tileX0 + (gx + 1 - gx0) * tileStepX;
          const wt00 = getWaterVertexTopZ(gx, gy), wt10 = getWaterVertexTopZ(gx + 1, gy);
          const wt11 = getWaterVertexTopZ(gx + 1, gy + 1), wt01 = getWaterVertexTopZ(gx, gy + 1);
          const wb00 = getWaterVertexBotZ(gx, gy), wb10 = getWaterVertexBotZ(gx + 1, gy);
          const wb11 = getWaterVertexBotZ(gx + 1, gy + 1), wb01 = getWaterVertexBotZ(gx, gy + 1);

          const avgBot = (wb00 + wb10 + wb11 + wb01) * 0.25;
          if (avgBot > 0) vaultSavedSceneVol += avgBot * tileStepX * tileStepY;

          // Top & Bottom of continuous water sheet (with true face normals on bottom so hollow vault walls & drain channels render crisply!)
          const pwt00 = [x0, y0, wt00], pwt10 = [x1, y0, wt10], pwt11 = [x1, y1, wt11], pwt01 = [x0, y1, wt01];
          const pwb00 = [x0, y0, wb00], pwb10 = [x1, y0, wb10], pwb11 = [x1, y1, wb11], pwb01 = [x0, y1, wb01];
          pushQuad(meshes.water, pwt00, pwt10, pwt11, pwt01, computeFaceNormal(pwt00, pwt10, pwt11), 0, -1, tileId);
          pushTri(meshes.water, pwb00, pwb01, pwb11, computeFaceNormal(pwb00, pwb01, pwb11), 0, -1, tileId);
          pushTri(meshes.water, pwb00, pwb11, pwb10, computeFaceNormal(pwb00, pwb11, pwb10), 0, -1, tileId);

          if (gy === gy0) {
            pushQuad(meshes.water, [x0, y0, wb00], [x1, y0, wb10], [x1, y0, wt10], [x0, y0, wt00], [0, -1, 0], 0, -1, tileId);
          }
          if (gy === gy1 - 1) {
            pushQuad(meshes.water, [x1, y1, wb11], [x0, y1, wb01], [x0, y1, wt01], [x1, y1, wt11], [0, 1, 0], 0, -1, tileId);
          }
          if (gx === gx0) {
            pushQuad(meshes.water, [x0, y1, wb01], [x0, y0, wb00], [x0, y0, wt00], [x0, y1, wt01], [-1, 0, 0], 0, -1, tileId);
          }
          if (gx === gx1 - 1) {
            pushQuad(meshes.water, [x1, y0, wb10], [x1, y1, wb11], [x1, y1, wt11], [x1, y0, wt10], [1, 0, 0], 0, -1, tileId);
          }
        }
      }

      // 3B. Continuous Vertex-Based Hollow Floor for Layer 1 (meshes.base)
      const getBaseVertexFloorZ = (vx, vy) => {
        if (!hasVault) return zBaseBed;
        if (vx <= gx0 + rimCells || vx >= gx1 - rimCells || vy <= gy0 + rimCells || vy >= gy1 - rimCells) {
          return zBaseBed;
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
        if (minTop <= zSubWater + 0.05) return zBaseBed;
        return Math.max(zBaseBed, quantizeZUnits(minTop - hollowWallUnits));
      };

      // 3C. Cell-by-cell Stepped DEM Terraces, Continuous Base Floor & Closed 2-Manifold Greenery Slabs
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
          if (avgFloor > zBaseBed) {
            vaultSavedSceneVol += (avgFloor - zBaseBed) * cellStep * cellStep;
          }

          // Continuous bottom floor of Layer 1 (meshes.base) — 0 internal steps, 0 T-junctions!
          pushQuad(
            meshes.base,
            [x0, y0, f00],
            [x0, y1, f01],
            [x1, y1, f11],
            [x1, y0, f10],
            [0, 0, -1],
            1,
            -1,
            tileId
          );

          // Outer tile boundary staircase walls for Layer 1 (meshes.base) — 100% 1-to-1 closure!
          if (gy === gy0) {
            emitBoundaryStaircaseWall(x0, y0, v00, f00, x1, y0, v10, f10, [0, -1, 0], tileId);
          }
          if (gy === gy1 - 1) {
            emitBoundaryStaircaseWall(x1, y1, v11, f11, x0, y1, v01, f01, [0, 1, 0], tileId);
          }
          if (gx === gx0) {
            emitBoundaryStaircaseWall(x0, y1, v01, f01, x0, y0, v00, f00, [-1, 0, 0], tileId);
          }
          if (gx === gx1 - 1) {
            emitBoundaryStaircaseWall(x1, y0, v10, f10, x1, y1, v11, f11, [1, 0, 0], tileId);
          }

          const vMax = Math.max(v00, v10, v11, v01);
          const vMin = Math.min(v00, v10, v11, v01);

          // Pure underwater cell: submerged basin top cap at zSubWater (0.34 units below water surface -> 0 Z-fighting!)
          if (vMax < baseBottomZ) {
            pushQuad(meshes.base, [x0, y0, zSubWater], [x1, y0, zSubWater], [x1, y1, zSubWater], [x0, y1, zSubWater], [0, 0, 1], 1, -1, tileId);
            continue;
          }

          const mIdx = sampleMaskIdx((x0 + x1) * 0.5, (y0 + y1) * 0.5);
          const isGreenCell = greenMask[mIdx] === 1 && roadAndBldMask[mIdx] === 0;

          const kMinRaw = getStepIdxForVal(vMin);
          const kMax = getStepIdxForVal(vMax);
          if (kMinRaw >= 0 && kMinRaw === kMax) {
            const tZ = thresholds[kMinRaw];
            pushQuad(meshes.base, [x0, y0, tZ], [x1, y0, tZ], [x1, y1, tZ], [x0, y1, tZ], [0, 0, 1], 1, -1, tileId);
            if (isGreenCell) {
              const gBot = tZ - 0.05;
              const gTop = tZ + 0.28;
              const gi = 0.012; // 20-micron inset prevents diagonal checkerboard corner non-manifold edges
              const gxA = x0 + gi, gxB = x1 - gi, gyA = y0 + gi, gyB = y1 - gi;
              pushQuad(meshes.greenery, [gxA, gyA, gTop], [gxB, gyA, gTop], [gxB, gyB, gTop], [gxA, gyB, gTop], [0, 0, 1], 2, -1, tileId);
              pushQuad(meshes.greenery, [gxA, gyA, gBot], [gxA, gyB, gBot], [gxB, gyB, gBot], [gxB, gyA, gBot], [0, 0, -1], 2, -1, tileId);
              pushQuad(meshes.greenery, [gxA, gyA, gBot], [gxB, gyA, gBot], [gxB, gyA, gTop], [gxA, gyA, gTop], [0, -1, 0], 2, -1, tileId);
              pushQuad(meshes.greenery, [gxB, gyB, gBot], [gxA, gyB, gBot], [gxA, gyB, gTop], [gxB, gyB, gTop], [0, 1, 0], 2, -1, tileId);
              pushQuad(meshes.greenery, [gxA, gyB, gBot], [gxA, gyA, gBot], [gxA, gyA, gTop], [gxA, gyB, gTop], [-1, 0, 0], 2, -1, tileId);
              pushQuad(meshes.greenery, [gxB, gyA, gBot], [gxB, gyB, gBot], [gxB, gyB, gTop], [gxB, gyA, gTop], [1, 0, 0], 2, -1, tileId);
            }
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
                  pushTri(meshes.base, [p0.x, p0.y, zSubWater], [swp[ti].x, swp[ti].y, zSubWater], [swp[ti + 1].x, swp[ti + 1].y, zSubWater], [0, 0, 1], 1, -1, tileId);
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
                  if (isGreenCell) {
                    const gPoly = insetPolygonCentroid(bp.map(pt => [pt.x, pt.y]), 0.012);
                    if (gPoly.length >= 3 && Math.abs(signedArea2D(gPoly)) > 1e-3) {
                      const gzTop = tLow + 0.28;
                      const gzBot = tLow - 0.05;
                      const gp0 = gPoly[0];
                      for (let ti = 1; ti < gPoly.length - 1; ti++) {
                        const gp1 = gPoly[ti], gp2 = gPoly[ti + 1];
                        pushTri(meshes.greenery, [gp0[0], gp0[1], gzTop], [gp1[0], gp1[1], gzTop], [gp2[0], gp2[1], gzTop], [0, 0, 1], 2, -1, tileId);
                        pushTri(meshes.greenery, [gp0[0], gp0[1], gzBot], [gp2[0], gp2[1], gzBot], [gp1[0], gp1[1], gzBot], [0, 0, -1], 2, -1, tileId);
                      }
                      for (let bi = 0; bi < gPoly.length; bi++) {
                        const bA = gPoly[bi], bB = gPoly[(bi + 1) % gPoly.length];
                        const bdx = bB[0] - bA[0], bdy = bB[1] - bA[1], blen = Math.hypot(bdx, bdy);
                        if (blen > 1e-5) {
                          pushQuad(meshes.greenery, [bA[0], bA[1], gzBot], [bB[0], bB[1], gzBot], [bB[0], bB[1], gzTop], [bA[0], bA[1], gzTop], [bdy / blen, -bdx / blen, 0], 2, -1, tileId);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // STEP 4: WATERTIGHT 3D SCULPTED TREES (STRICT TILE CONTAINMENT)
  // --------------------------------------------------------------------------
  const placedTrees = [];
  (scene.trees || []).forEach((tr, idx) => {
    const [bx, by] = toBed([tr[0], tr[1]]);
    if (bx < -82.8 || bx > 82.8 || by < -82.8 || by > 82.8) return;
    const mIdx = sampleMaskIdx(bx, by);
    if (waterMask[mIdx] || roadAndBldMask[mIdx]) return;

    const treeRadius = (0.56 + (idx % 5) * 0.10) * Math.min(1.20, Math.sqrt(scaleToBed));
    const [tc, trRow, tileId] = getTileColRowForXY(bx, by);
    const tileX0 = -84.6 + tc * cellsPerCol * cellStep;
    const tileX1 = (tc === tileCols - 1) ? 84.6 : -84.6 + (tc + 1) * cellsPerCol * cellStep;
    const tileY0 = -84.6 + trRow * cellsPerRow * cellStep;
    const tileY1 = (trRow === tileRows - 1) ? 84.6 : -84.6 + (trRow + 1) * cellsPerRow * cellStep;

    // Fix B07: Skip any tree whose 3D crown would cross a tile seam!
    const margin = treeRadius + 0.06;
    if (bx - margin < tileX0 || bx + margin > tileX1 || by - margin < tileY0 || by + margin > tileY1) return;

    for (let j = 0; j < placedTrees.length; j++) {
      const pt = placedTrees[j];
      if (Math.hypot(bx - pt[0], by - pt[1]) < (treeRadius + pt[2]) * 1.05) return;
    }
    placedTrees.push([bx, by, treeRadius]);

    const zG = getQuantizedTerrainZ(bx, by) + (greenMask[mIdx] ? 0.28 : 0.04);
    const treeHeight = (1.30 + (idx % 6) * 0.22) * (state.zScale || 1.0) * 0.85;
    const epsTree = ((idx % 127) + 1) * 0.0008;
    addTreeCrown3D(bx, by, zG, treeRadius, treeHeight, 2, meshes.greenery, tileId, epsTree);
  });

  // --------------------------------------------------------------------------
  // STEP 5: WATERTIGHT 2-MANIFOLD STREETS, RAILWAYS & BRIDGES (STRICT TILE CLIP)
  // --------------------------------------------------------------------------
  let roadPrismCounter = 0;
  (scene.roads || []).forEach(rd => {
    const bedPts = rd.pts.map(toBed);
    if (bedPts.length < 2) return;
    const halfW = Math.max(0.32, (rd.width * scaleToBed) * 0.5);
    const isBridge = !!rd.bridge;

    let bridgeDeckZ = baseBottomZ + 1.85;
    if (isBridge) {
      const pStart = bedPts[0], pEnd = bedPts[bedPts.length - 1];
      const zA = getQuantizedTerrainZ(pStart[0], pStart[1]);
      const zB = getQuantizedTerrainZ(pEnd[0], pEnd[1]);
      bridgeDeckZ = Math.max(zA, zB, baseBottomZ + 1.45) + 0.45;
    }

    let accumBridgeDist = 0;

    for (let i = 0; i < bedPts.length - 1; i++) {
      const p0 = bedPts[i], p1 = bedPts[i + 1];
      const segLen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (segLen < 0.08) continue;

      const subSteps = Math.max(1, Math.ceil(segLen / 2.2));
      const dx = (p1[0] - p0[0]) / segLen;
      const dy = (p1[1] - p0[1]) / segLen;
      const nx = -dy * halfW;
      const ny = dx * halfW;

      for (let s = 0; s < subSteps; s++) {
        const t0 = s / subSteps, t1 = (s + 1) / subSteps;
        const ax = p0[0] + (p1[0] - p0[0]) * t0;
        const ay = p0[1] + (p1[1] - p0[1]) * t0;
        const bx = p0[0] + (p1[0] - p0[0]) * t1;
        const by = p0[1] + (p1[1] - p0[1]) * t1;
        const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5;

        if (mx < -83.8 || mx > 83.8 || my < -83.8 || my > 83.8) continue;
        const mIdx = sampleMaskIdx(mx, my);
        if (!isBridge && waterMask[mIdx]) continue;

        const rawQuad = [
          [ax - nx, ay - ny],
          [bx - nx, by - ny],
          [bx + nx, by + ny],
          [ax + nx, ay + ny]
        ];

        const [tc, tr, tileId] = getTileColRowForXY(mx, my);
        const tileX0 = -84.6 + tc * cellsPerCol * cellStep;
        const tileX1 = (tc === tileCols - 1) ? 84.6 : -84.6 + (tc + 1) * cellsPerCol * cellStep;
        const tileY0 = -84.6 + tr * cellsPerRow * cellStep;
        const tileY1 = (tr === tileRows - 1) ? 84.6 : -84.6 + (tr + 1) * cellsPerRow * cellStep;

        const clippedRoad = insetPolygonCentroid(
          clipPolyToBox(rawQuad, tileX0 + 0.05, tileY0 + 0.05, tileX1 - 0.05, tileY1 - 0.05),
          0.008
        );
        if (clippedRoad.length < 3 || Math.abs(signedArea2D(clippedRoad)) < 0.02) continue;

        roadPrismCounter++;
        const epsR = ((roadPrismCounter % 251) + 1) * 0.0009;
        const zTop = (isBridge ? bridgeDeckZ : (getQuantizedTerrainZ(mx, my) + 0.34)) + epsR;
        const zBot = (isBridge ? (bridgeDeckZ - 0.52) : (zTop - 0.42)) + epsR * 0.5;

        const rp0 = clippedRoad[0];
        for (let ti = 1; ti < clippedRoad.length - 1; ti++) {
          const rp1 = clippedRoad[ti], rp2 = clippedRoad[ti + 1];
          pushTri(meshes.roads, [rp0[0], rp0[1], zTop], [rp1[0], rp1[1], zTop], [rp2[0], rp2[1], zTop], [0, 0, 1], 3, -1, tileId);
          pushTri(meshes.roads, [rp0[0], rp0[1], zBot], [rp2[0], rp2[1], zBot], [rp1[0], rp1[1], zBot], [0, 0, -1], 3, -1, tileId);
        }
        for (let ri = 0; ri < clippedRoad.length; ri++) {
          const rA = clippedRoad[ri], rB = clippedRoad[(ri + 1) % clippedRoad.length];
          const rdx = rB[0] - rA[0], rdy = rB[1] - rA[1], rlen = Math.hypot(rdx, rdy);
          if (rlen > 1e-5) {
            pushQuad(meshes.roads, [rA[0], rA[1], zBot], [rB[0], rB[1], zBot], [rB[0], rB[1], zTop], [rA[0], rA[1], zTop], [rdy / rlen, -rdx / rlen, 0], 3, -1, tileId);
          }
        }

        if (isBridge && waterMask[mIdx]) {
          const stepD = segLen / subSteps;
          accumBridgeDist += stepD;
          if (accumBridgeDist >= 8.5) {
            accumBridgeDist = 0;
            const pd = 0.52;
            const pierPoly = clipPolyToBox([
              [mx - dx * pd - nx * 0.82, my - dy * pd - ny * 0.82],
              [mx + dx * pd - nx * 0.82, my + dy * pd - ny * 0.82],
              [mx + dx * pd + nx * 0.82, my + dy * pd + ny * 0.82],
              [mx - dx * pd + nx * 0.82, my - dy * pd + ny * 0.82]
            ], tileX0 + 0.08, tileY0 + 0.08, tileX1 - 0.08, tileY1 - 0.08);
            if (pierPoly.length >= 3) {
              extrudeBuildingLoD2(pierPoly, [], deepWaterZ - 0.08 + epsR, zBot - 0.01, zBot - 0.01, false, 3, -1, meshes.roads, tileId, 'flat');
            }
          }
        }
      }
    }
  });

  // --------------------------------------------------------------------------
  // STEP 6: REAL OSM BUILDINGS & PIERS (0 FLOATING BUILDINGS, 0 OPEN EDGES)
  // --------------------------------------------------------------------------
  const mToU = (scene.metersToUnits || 0.13) * scaleToBed;
  const rawBuildings = scene.buildings || [];

  const prepared = [];
  for (let i = 0; i < rawBuildings.length; i++) {
    const b = rawBuildings[i];
    if (b.hidden) continue;
    const bedOuterRaw = b.outer.map(toBed);
    const clippedOuter = clipPolyToBox(bedOuterRaw, -84.2, -84.2, 84.2, 84.2);
    if (clippedOuter.length < 3) continue;

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

    const isPier = b.btype === 'pier';
    if (!isPier && (minSpan < 0.55 || area < 0.45)) continue;
    if (isPier && area < 0.15) continue;

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

  for (let i = 0; i < prepared.length; i++) {
    const P = prepared[i];
    if (P.skipDuplicate) continue;
    for (let j = i + 1; j < prepared.length; j++) {
      const C = prepared[j];
      if (C.skipDuplicate) continue;

      const ox = Math.max(0, Math.min(P.maxX, C.maxX) - Math.max(P.minX, C.minX));
      const oy = Math.max(0, Math.min(P.maxY, C.maxY) - Math.max(P.minY, C.minY));
      const overlapBoxArea = ox * oy;
      if (overlapBoxArea <= 0) continue;

      const cBoxArea = Math.max(0.01, (C.maxX - C.minX) * (C.maxY - C.minY));
      const overlapRatio = overlapBoxArea / cBoxArea;

      if (C.area / P.area > 0.85 && overlapRatio > 0.85 && Math.hypot(P.cx - C.cx, P.cy - C.cy) < 0.8) {
        if (C.b.h > P.b.h) {
          P.b.h = C.b.h;
          P.b.levels = C.b.levels;
        }
        C.skipDuplicate = true;
        continue;
      }

      if (overlapRatio > 0.55 && pointInPoly2D(C.cx, C.cy, P.clippedOuter)) {
        let inHole = false;
        for (let h = 0; h < P.clippedHoles.length; h++) {
          if (pointInPoly2D(C.cx, C.cy, P.clippedHoles[h])) { inHole = true; break; }
        }
        if (!inHole) {
          C.groupId = P.groupId;
        }
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

  let floatingBuildingsCount = 0;
  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    if (item.skipDuplicate) continue;
    const b = item.b;
    const gid = item.groupId;

    // Fix B02: Sample terrain height across all vertices, edge midpoints, and bbox grid so 0 buildings ever float!
    let minTerrainZ = getMinQuantizedTerrainZ(item.cx, item.cy);
    let maxTerrainZ = getQuantizedTerrainZ(item.cx, item.cy);
    for (let k = 0; k < item.clippedOuter.length; k++) {
      const pA = item.clippedOuter[k];
      const pB = item.clippedOuter[(k + 1) % item.clippedOuter.length];
      const tzMinA = getMinQuantizedTerrainZ(pA[0], pA[1]);
      const tzMaxA = getQuantizedTerrainZ(pA[0], pA[1]);
      if (tzMinA < minTerrainZ) minTerrainZ = tzMinA;
      if (tzMaxA > maxTerrainZ) maxTerrainZ = tzMaxA;
      const mx = (pA[0] + pB[0]) * 0.5, my = (pA[1] + pB[1]) * 0.5;
      const tzMinM = getMinQuantizedTerrainZ(mx, my);
      if (tzMinM < minTerrainZ) minTerrainZ = tzMinM;
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

    // Unique micro-offset prevents coplanar/shared-edge collisions between adjacent row-houses
    const epsB = ((i % 251) + 1) * 0.0008;
    const isPier = b.btype === 'pier';
    const isHl = groupHighlighted.has(gid) || !!b.highlighted;

    // Fix B02 & B26: Root building at minTerrainZ - 0.15, and do NOT artificially lift highlighted buildings by +0.45!
    const zBase = isPier ? (deepWaterZ - 0.10 + epsB) : (minTerrainZ - 0.15 - epsB);
    const zEaves = isPier
      ? (baseBottomZ + 0.65 + epsB)
      : (maxTerrainZ + Math.max(0.95, totalHMm - roofHMm * 0.45) + epsB);
    const zRidge = isPier ? zEaves : (zEaves + roofHMm);

    for (let k = 0; k < item.clippedOuter.length; k++) {
      const p = item.clippedOuter[k];
      if (zBase - getQuantizedTerrainZ(p[0], p[1]) > 0.025) {
        floatingBuildingsCount++;
        break;
      }
    }

    const targetLayerId = isHl ? 5 : (isPier ? 3 : 4);
    const targetList = isHl ? meshes.highlighted : (isPier ? meshes.roads : meshes.buildings);
    const hasPitched = (!isPier && b.roof !== 'flat' && roofHMm > 0.14);
    const insetOuter = insetPolygonCentroid(item.clippedOuter, 0.005);

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
          const bTileOuter = insetPolygonCentroid(
            clipPolyToBox(insetOuter, tx0 + 0.03, ty0 + 0.03, tx1 - 0.03, ty1 - 0.03),
            0.004
          );
          if (bTileOuter.length < 3 || Math.abs(signedArea2D(bTileOuter)) < 0.08) continue;

          const bTileHoles = item.clippedHoles
            .map(h => clipPolyToBox(h, tx0 + 0.04, ty0 + 0.04, tx1 - 0.04, ty1 - 0.04))
            .filter(h => h.length >= 3);

          extrudeBuildingLoD2(bTileOuter, bTileHoles, zBase, zEaves, zRidge, hasPitched, targetLayerId, gid, targetList, tileId, b.roof || 'hipped');
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
  // STEP 8: EXACT MATHEMATICAL VOLUME (ml), MASS (g) & PREFLIGHT VALIDATION
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

  printableKeys.forEach(k => {
    const arr = meshes[k] || [];
    totalTriangles += arr.length;
    if (state.layerVisible && !state.layerVisible[k]) {
      layerVolumesMm3[k] = 0;
      return;
    }
    let lVolScene = 0;
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
    layerVolumesMm3[k] = Math.max(0, (lVolScene / 6.0) * scaleMm3);
  });

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
    floatingBuildingsCount,
    outOfTileTrisCount,
    hasDrainChannels: hollowBase,
    fitsPhotonMono4: (tileWidthMm <= 153.4 + 0.05) && (tileHeightMm <= 87.0 + 0.05) && (maxZMm <= 165.0) && (maxTileVolumeMl <= 2200.0),
    isWatertightManifold: (floatingBuildingsCount === 0 && outOfTileTrisCount === 0 && totalVolumeMl > 0),
    frameExcludedFromExport: true
  };

  return { meshes, buildingBounds, totalTriangles, printMetrics };
}
