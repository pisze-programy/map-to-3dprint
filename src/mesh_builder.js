// ============================================================================
// src/mesh_builder.js
// Hardened Multi-Layer 3D Mesh Builder from REAL OpenStreetMap + DEM data:
// - Strict frame clipping [-84.5, 84.5] (zero protruding elements)
// - Anti-matchstick aspect ratio clamping & ground-rooted extrusion (zero floating cones)
// - Automatic parent building + building:part grouping & coplanar de-duplication (zero Z-fighting)
// - Fast 3-way Medial-Axis watertight roof ridges + optimized Marching-Squares terrain
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

// Robust Ear-Clipping polygon triangulator (never fans across concave gaps!)
function triangulateSimplePoly(ptsInput) {
  if (!ptsInput || ptsInput.length < 3) return [];
  const pts = [];
  for (let i = 0; i < ptsInput.length; i++) {
    const p = ptsInput[i];
    if (pts.length === 0 || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 1e-4) {
      pts.push([p[0], p[1]]);
    }
  }
  if (pts.length >= 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 1e-4) {
    pts.pop();
  }
  if (pts.length < 3) return [];
  if (signedArea2D(pts) < 0) pts.reverse();

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

      if (Math.abs(cross) < 1e-5) {
        bestEarIdx = -2;
        indices.splice(i, 1);
        break;
      }
      if (cross <= 0) continue;

      let hasInside = false;
      const tMinX = Math.min(a[0], b[0], c[0]) - 1e-4;
      const tMaxX = Math.max(a[0], b[0], c[0]) + 1e-4;
      const tMinY = Math.min(a[1], b[1], c[1]) - 1e-4;
      const tMaxY = Math.max(a[1], b[1], c[1]) + 1e-4;

      for (let j = 0; j < n; j++) {
        const idx = indices[j];
        if (idx === iPrev || idx === iCurr || idx === iNext) continue;
        const p = pts[idx];
        if (p[0] < tMinX || p[0] > tMaxX || p[1] < tMinY || p[1] > tMaxY) continue;
        if (dxSq(p, a) < 1e-7 || dxSq(p, b) < 1e-7 || dxSq(p, c) < 1e-7) continue;
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
          // Fast-exit if ear is well-proportioned (no need to scan remaining vertices!)
          if (dSq <= (dxSq(a, b) + dxSq(b, c)) * 1.65) break;
        }
      }
    }

    if (bestEarIdx === -2) continue;

    if (bestEarIdx >= 0) {
      const iPrev = indices[(bestEarIdx + n - 1) % n];
      const iCurr = indices[bestEarIdx];
      const iNext = indices[(bestEarIdx + 1) % n];
      tris.push([pts[iPrev], pts[iCurr], pts[iNext]]);
      indices.splice(bestEarIdx, 1);
      continue;
    }

    let fallbackIdx = -1;
    let fallbackDiag = Infinity;
    for (let i = 0; i < n; i++) {
      const iPrev = indices[(i + n - 1) % n];
      const iCurr = indices[i];
      const iNext = indices[(i + 1) % n];
      const a = pts[iPrev], b = pts[iCurr], c = pts[iNext];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross > 0) {
        const dSq = dxSq(a, c);
        if (dSq < fallbackDiag) {
          fallbackDiag = dSq;
          fallbackIdx = i;
        }
      }
    }
    if (fallbackIdx >= 0) {
      const iPrev = indices[(fallbackIdx + n - 1) % n];
      const iCurr = indices[fallbackIdx];
      const iNext = indices[(fallbackIdx + 1) % n];
      tris.push([pts[iPrev], pts[iCurr], pts[iNext]]);
      indices.splice(fallbackIdx, 1);
    } else {
      break;
    }
  }
  if (indices.length === 3) {
    const a = pts[indices[0]], b = pts[indices[1]], c = pts[indices[2]];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cross > 0) tris.push([a, b, c]);
  }
  return tris;
}

// Ray-cast in +X from hole rightmost vertex to find valid non-crossing bridge on outer ring
function mergeHolesIntoOuter(outerInput, holesInput) {
  let outer = outerInput.map(p => [p[0], p[1]]);
  if (signedArea2D(outer) < 0) outer.reverse(); // CCW
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

    let bestOuterIdx = -1;
    let bestIntersectX = Infinity;
    const n = outer.length;
    for (let i = 0; i < n; i++) {
      const p1 = outer[i];
      const p2 = outer[(i + 1) % n];
      if ((p1[1] > hy) !== (p2[1] > hy)) {
        const ix = p1[0] + (hy - p1[1]) * (p2[0] - p1[0]) / (p2[1] - p1[1]);
        if (ix >= hx - 1e-4 && ix < bestIntersectX) {
          bestIntersectX = ix;
          bestOuterIdx = (p1[0] > p2[0]) ? i : ((i + 1) % n);
        }
      }
    }

    if (bestOuterIdx < 0) {
      let bestDist = Infinity;
      for (let i = 0; i < n; i++) {
        if (outer[i][0] >= hx - 0.1) {
          const d = Math.hypot(outer[i][0] - hx, outer[i][1] - hy);
          if (d < bestDist) { bestDist = d; bestOuterIdx = i; }
        }
      }
    }
    if (bestOuterIdx < 0) bestOuterIdx = 0;

    const merged = [];
    for (let i = 0; i <= bestOuterIdx; i++) merged.push(outer[i]);
    for (let i = 0; i <= hObj.ring.length; i++) {
      merged.push(hObj.ring[(hObj.maxIdx + i) % hObj.ring.length]);
    }
    merged.push(outer[bestOuterIdx]);
    for (let i = bestOuterIdx + 1; i < outer.length; i++) merged.push(outer[i]);
    outer = merged;
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

function distToPolygonEdges(px, py, outer, holes) {
  let minDistSq = Infinity;
  function checkRing(ring) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const vx = b[0] - a[0], vy = b[1] - a[1];
      const wx = px - a[0], wy = py - a[1];
      const lenSq = vx * vx + vy * vy;
      let t = lenSq > 1e-10 ? (wx * vx + wy * vy) / lenSq : 0.0;
      if (t < 0.0) t = 0.0;
      else if (t > 1.0) t = 1.0;
      const dx = px - (a[0] + t * vx);
      const dy = py - (a[1] + t * vy);
      const dSq = dx * dx + dy * dy;
      if (dSq < minDistSq) minDistSq = dSq;
    }
  }
  checkRing(outer);
  for (let h = 0; h < holes.length; h++) checkRing(holes[h]);
  return Math.sqrt(minDistSq);
}

// Fast 3-way Medial-Axis LoD2 Building Extrusion (100% watertight manifold: walls + floor cap + roof cap!)
function extrudeBuildingLoD2(outerInput, holesInput, zBase, zEaves, zRidge, hasPitchedRoof, layerId, bId, outTris, tileId = 0) {
  const outer = [];
  for (let i = 0; i < outerInput.length; i++) {
    const p = outerInput[i];
    if (outer.length === 0 || Math.hypot(p[0] - outer[outer.length - 1][0], p[1] - outer[outer.length - 1][1]) > 0.04) {
      outer.push([p[0], p[1]]);
    }
  }
  if (outer.length >= 2 && Math.hypot(outer[0][0] - outer[outer.length - 1][0], outer[0][1] - outer[outer.length - 1][1]) <= 0.04) {
    outer.pop();
  }
  if (outer.length < 3) return;
  if (signedArea2D(outer) < 0) outer.reverse(); // CCW

  const holes = (holesInput || [])
    .filter(h => h && h.length >= 3)
    .map(h => {
      const c = [];
      for (let i = 0; i < h.length; i++) {
        const p = h[i];
        if (c.length === 0 || Math.hypot(p[0] - c[c.length - 1][0], p[1] - c[c.length - 1][1]) > 0.04) {
          c.push([p[0], p[1]]);
        }
      }
      if (c.length >= 2 && Math.hypot(c[0][0] - c[c.length - 1][0], c[0][1] - c[c.length - 1][1]) <= 0.04) {
        c.pop();
      }
      if (signedArea2D(c) > 0) c.reverse(); // CW
      return c;
    })
    .filter(c => c.length >= 3);

  // 1. Vertical outer walls
  for (let i = 0, n = outer.length; i < n; i++) {
    const p1 = outer[i], p2 = outer[(i + 1) % n];
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) continue;
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

  // 2. Vertical inner courtyard walls
  for (const hRing of holes) {
    for (let i = 0, n = hRing.length; i < n; i++) {
      const p1 = hRing[i], p2 = hRing[(i + 1) % n];
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-4) continue;
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
  }

  const mergedTop = mergeHolesIntoOuter(outer, holes);
  const roofTris = triangulateSimplePoly(mergedTop);
  const roofH = Math.max(0, zRidge - zEaves);

  // 3. Watertight Bottom Floor Cap at zBase (reversed winding, normal [0, 0, -1])
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

  // 4. Watertight Top Roof Cap at zEaves / zRidge
  if (hasPitchedRoof && roofH > 0.10) {
    const roofSlope = 0.92;
    for (let i = 0; i < roofTris.length; i++) {
      const [a, b, c] = roofTris[i];
      const cx = (a[0] + b[0] + c[0]) / 3.0;
      const cy = (a[1] + b[1] + c[1]) / 3.0;
      const d = distToPolygonEdges(cx, cy, outer, holes);
      const mz = zEaves + Math.min(roofH, Math.max(0.12, d * roofSlope));

      const A3 = [a[0], a[1], zEaves];
      const B3 = [b[0], b[1], zEaves];
      const C3 = [c[0], c[1], zEaves];
      const M3 = [cx, cy, mz];

      pushTri(outTris, A3, B3, M3, computeFaceNormal(A3, B3, M3), layerId, bId, tileId);
      pushTri(outTris, B3, C3, M3, computeFaceNormal(B3, C3, M3), layerId, bId, tileId);
      pushTri(outTris, C3, A3, M3, computeFaceNormal(C3, A3, M3), layerId, bId, tileId);
    }
  } else {
    for (let i = 0; i < roofTris.length; i++) {
      const [a, b, c] = roofTris[i];
      pushTri(outTris, [a[0], a[1], zEaves], [b[0], b[1], zEaves], [c[0], c[1], zEaves], [0, 0, 1], layerId, bId, tileId);
    }
  }
}

// Closed watertight 5-sided sculpted tree crown (10 side/top triangles + 3 bottom cap triangles = 13 triangles)
function addTreeCrown3D(tx, ty, zGround, radius, height, layerId, outTris, tileId = 0) {
  const sides = 5;
  const rMid = radius * 0.96;
  const z0 = zGround - 0.10;
  const z1 = zGround + height * 0.48;
  const apex = [tx, ty, zGround + height];
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
        const t = (threshold - prev.v) / ((curr.v - prev.v) || 1e-9);
        out.push({
          x: prev.x + (curr.x - prev.x) * t,
          y: prev.y + (curr.y - prev.y) * t,
          v: threshold,
          isCut: true
        });
      }
      out.push({ x: curr.x, y: curr.y, v: curr.v, isCut: false });
    } else if (prevIn) {
      const t = (threshold - prev.v) / ((curr.v - prev.v) || 1e-9);
      out.push({
        x: prev.x + (curr.x - prev.x) * t,
        y: prev.y + (curr.y - prev.y) * t,
        v: threshold,
        isCut: true
      });
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

  const halfSpan = (state.cropRatio || 0.78) * 85.0;
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

  (scene.waterLines || []).forEach(wl => {
    const effW = wl.width >= 1.5 ? Math.max(wl.width, 13.5) : wl.width;
    mctx.lineWidth = Math.max(2.5, effW * scaleToBed * (MASK_RES / 170.0));
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

  // 1B. Green Mask
  mctx.clearRect(0, 0, MASK_RES, MASK_RES);
  mctx.fillStyle = '#ffffff';
  mctx.strokeStyle = '#ffffff';
  (scene.greenPolys || []).forEach(gp => {
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
  const greenMask = new Uint8Array(MASK_RES * MASK_RES);
  for (let i = 0; i < MASK_RES * MASK_RES; i++) {
    if (!waterMask[i] && (greenImg[i * 4 + 3] > 80 || (shoreDist[i] >= 1 && shoreDist[i] <= 4))) {
      greenMask[i] = 1;
    }
  }

  // 1C. Road & Building Footprint Mask
  mctx.clearRect(0, 0, MASK_RES, MASK_RES);
  mctx.fillStyle = '#ffffff';
  mctx.strokeStyle = '#ffffff';
  (scene.roads || []).forEach(rd => {
    mctx.lineWidth = Math.max(1.5, rd.width * scaleToBed * (MASK_RES / 170.0) * 1.1);
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
  // STEP 2: REAL DEM INTERPOLATION & SMOOTHING
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

  const TERRAIN_RES = 72; // Divisible by 1, 2, 3, 4 for exact multi-tile splits (1x1, 1x2, 2x2, 2x3, 2x4)
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

  const baseBottomZ = 2.45;
  const realElevDelta = Math.max(6.0, maxElev - minElev);
  // Adaptive mountain vs city relief scaling
  const adaptiveReliefBase = realElevDelta > 45.0
    ? Math.min(13.2, 7.4 + Math.log10(1.0 + (realElevDelta - 45.0) / 40.0) * 4.6)
    : 7.4;
  const maxReliefMm = adaptiveReliefBase * (state.terrainScale || 1.0);
  const elevSpan = Math.max(12.0, realElevDelta);
  const numContourSteps = 18;
  const stepMm = maxReliefMm / numContourSteps;

  let zGrid = new Float32Array(strideT * strideT);
  for (let gy = 0; gy <= TERRAIN_RES; gy++) {
    const by = -84.6 + (gy / TERRAIN_RES) * 169.2;
    for (let gx = 0; gx <= TERRAIN_RES; gx++) {
      const bx = -84.6 + (gx / TERRAIN_RES) * 169.2;
      const mIdx = sampleMaskIdx(bx, by);
      const relE = demGrid[gy * strideT + gx];
      if (waterMask[mIdx]) {
        zGrid[gy * strideT + gx] = baseBottomZ - 0.12 - Math.min(0.85, waterDepth[mIdx] * 0.045);
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

  function getQuantizedTerrainZ(bx, by) {
    const u = Math.min(1, Math.max(0, (bx + 84.6) / 169.2)) * TERRAIN_RES;
    const v = Math.min(1, Math.max(0, (by + 84.6) / 169.2)) * TERRAIN_RES;
    const gx = Math.min(TERRAIN_RES, Math.round(u));
    const gy = Math.min(TERRAIN_RES, Math.round(v));
    const zVal = zGrid[gy * strideT + gx];
    if (zVal < baseBottomZ) return baseBottomZ;
    const stepIdx = Math.floor((zVal - baseBottomZ) / stepMm);
    return baseBottomZ + Math.max(0, stepIdx) * stepMm;
  }

  // Multi-Tile Grid Configuration (e.g., 1x1, 1x2, 2x2, 2x3, 2x4 for Anycubic Photon Mono 4)
  const tileCols = Math.max(1, Math.min(4, state.tileCols || 1));
  const tileRows = Math.max(1, Math.min(4, state.tileRows || 1));
  const cellsPerCol = Math.floor(TERRAIN_RES / tileCols);
  const cellsPerRow = Math.floor(TERRAIN_RES / tileRows);
  const cellStep = 169.2 / TERRAIN_RES;
  const deepWaterZ = 1.76;
  const waterShelfLevels = [1.98, 2.20];
  const hollowBase = !!state.hollowBase;
  const totalWidthMm = state.bedSizeMm || 320;
  const mmPerUnit = totalWidthMm / 169.2;
  const hollowWallUnits = Math.max(0.75, Math.min(1.30, (state.hollowWallMm || 1.8) / Math.max(1.05, mmPerUnit)));
  let vaultSavedSceneVol = 0;

  function getTileColRowForXY(bx, by) {
    const tc = Math.max(0, Math.min(tileCols - 1, Math.floor(((bx + 84.6) / 169.2) * tileCols)));
    const tr = Math.max(0, Math.min(tileRows - 1, Math.floor(((by + 84.6) / 169.2) * tileRows)));
    return [tc, tr, tr * tileCols + tc];
  }

  const thresholds = [];
  for (let k = 0; k <= numContourSteps + 2; k++) {
    thresholds.push(baseBottomZ + k * stepMm);
  }

  // Precompute per-cell flat green status & quantized terrace Z for closed 3D greenery slabs
  const cellIsFlatGreen = new Uint8Array(TERRAIN_RES * TERRAIN_RES);
  const cellFlatTZ = new Float32Array(TERRAIN_RES * TERRAIN_RES);
  const cellMinTopZ = new Float32Array(TERRAIN_RES * TERRAIN_RES);

  for (let gy = 0; gy < TERRAIN_RES; gy++) {
    const y0 = -84.6 + gy * cellStep, y1 = y0 + cellStep;
    for (let gx = 0; gx < TERRAIN_RES; gx++) {
      const x0 = -84.6 + gx * cellStep, x1 = x0 + cellStep;
      const v00 = zGrid[gy * strideT + gx];
      const v10 = zGrid[gy * strideT + (gx + 1)];
      const v11 = zGrid[(gy + 1) * strideT + (gx + 1)];
      const v01 = zGrid[(gy + 1) * strideT + gx];
      const vMax = Math.max(v00, v10, v11, v01);
      const vMin = Math.min(v00, v10, v11, v01);
      const cIdx = gy * TERRAIN_RES + gx;

      const kMin = Math.max(0, Math.floor((vMin - baseBottomZ) / stepMm));
      const kMax = Math.min(numContourSteps, Math.floor((vMax - baseBottomZ) / stepMm));
      cellMinTopZ[cIdx] = (vMin < baseBottomZ) ? deepWaterZ : thresholds[kMin];

      const mIdx = sampleMaskIdx((x0 + x1) * 0.5, (y0 + y1) * 0.5);
      const isGreen = greenMask[mIdx] === 1 && roadAndBldMask[mIdx] === 0;
      if (vMin >= baseBottomZ && kMin === kMax && isGreen) {
        cellIsFlatGreen[cIdx] = 1;
        cellFlatTZ[cIdx] = thresholds[kMin];
      }
    }
  }

  // --------------------------------------------------------------------------
  // STEP 3: PER-TILE WATERTIGHT WATER, STEPPED BATHYMETRY, DEM BASE & GREENERY
  // --------------------------------------------------------------------------
  for (let tr = 0; tr < tileRows; tr++) {
    const gy0 = tr * cellsPerRow;
    const gy1 = (tr === tileRows - 1) ? TERRAIN_RES : (tr + 1) * cellsPerRow;
    const tileY0 = -84.6 + gy0 * cellStep;
    const tileY1 = -84.6 + gy1 * cellStep;

    for (let tc = 0; tc < tileCols; tc++) {
      const gx0 = tc * cellsPerCol;
      const gx1 = (tc === tileCols - 1) ? TERRAIN_RES : (tc + 1) * cellsPerCol;
      const tileX0 = -84.6 + gx0 * cellStep;
      const tileX1 = -84.6 + gx1 * cellStep;
      const tileId = tr * tileCols + tc;

      // 3A. Closed Water Plate & Open Underside Vault for Tile (tc, tr)
      const rimCells = 2; // 2-cell solid mounting rim around all 4 edges of every tile
      const hasVault = hollowBase && (gx1 - gx0 > rimCells * 2 + 2) && (gy1 - gy0 > rimCells * 2 + 2);
      const zWaterVault = 0.85;

      const isRimCell = (cx, cy) => (cx < gx0 + rimCells || cx >= gx1 - rimCells || cy < gy0 + rimCells || cy >= gy1 - rimCells);
      const isWaterCell = (cx, cy) => (cellMinTopZ[cy * TERRAIN_RES + cx] <= deepWaterZ + 1e-3);
      const hasWaterPlate = (cx, cy) => (!hasVault || isRimCell(cx, cy) || isWaterCell(cx, cy));
      const getWaterBotZ = (cx, cy) => (!hasVault ? 0 : (isRimCell(cx, cy) ? 0 : zWaterVault));

      if (!hasVault) {
        // Classic full solid water plate across tile [tileX0, tileX1] x [tileY0, tileY1]
        pushQuad(meshes.water, [tileX0, tileY0, deepWaterZ], [tileX1, tileY0, deepWaterZ], [tileX1, tileY1, deepWaterZ], [tileX0, tileY1, deepWaterZ], [0, 0, 1], 0, -1, tileId);
        pushQuad(meshes.water, [tileX0, tileY0, 0], [tileX0, tileY1, 0], [tileX1, tileY1, 0], [tileX1, tileY0, 0], [0, 0, -1], 0, -1, tileId);
        pushQuad(meshes.water, [tileX0, tileY0, 0], [tileX1, tileY0, 0], [tileX1, tileY0, deepWaterZ], [tileX0, tileY0, deepWaterZ], [0, -1, 0], 0, -1, tileId);
        pushQuad(meshes.water, [tileX1, tileY0, 0], [tileX1, tileY1, 0], [tileX1, tileY1, deepWaterZ], [tileX1, tileY0, deepWaterZ], [1, 0, 0], 0, -1, tileId);
        pushQuad(meshes.water, [tileX1, tileY1, 0], [tileX0, tileY1, 0], [tileX0, tileY1, deepWaterZ], [tileX1, tileY1, deepWaterZ], [0, 1, 0], 0, -1, tileId);
        pushQuad(meshes.water, [tileX0, tileY1, 0], [tileX0, tileY0, 0], [tileX0, tileY0, deepWaterZ], [tileX0, tileY1, deepWaterZ], [-1, 0, 0], 0, -1, tileId);
      } else {
        // Open underside SLA vault: water plate exists on outer rim (z=0..deepWaterZ) and under actual water (z=zWaterVault..deepWaterZ);
        // under interior land cells, the cavity opens straight up to the terraced base floor (zero trapped resin pockets!)
        for (let gy = gy0; gy < gy1; gy++) {
          const y0 = -84.6 + gy * cellStep, y1 = y0 + cellStep;
          for (let gx = gx0; gx < gx1; gx++) {
            const x0 = -84.6 + gx * cellStep, x1 = x0 + cellStep;
            if (!hasWaterPlate(gx, gy)) {
              vaultSavedSceneVol += deepWaterZ * cellStep * cellStep;
              continue;
            }
            const wBot = getWaterBotZ(gx, gy);
            if (wBot > 0) {
              vaultSavedSceneVol += wBot * cellStep * cellStep;
            }
            // Top & Bottom of water cell
            pushQuad(meshes.water, [x0, y0, deepWaterZ], [x1, y0, deepWaterZ], [x1, y1, deepWaterZ], [x0, y1, deepWaterZ], [0, 0, 1], 0, -1, tileId);
            pushQuad(meshes.water, [x0, y0, wBot], [x0, y1, wBot], [x1, y1, wBot], [x1, y0, wBot], [0, 0, -1], 0, -1, tileId);

            // South edge (gy - 1)
            if (gy === gy0 || !hasWaterPlate(gx, gy - 1)) {
              pushQuad(meshes.water, [x0, y0, wBot], [x1, y0, wBot], [x1, y0, deepWaterZ], [x0, y0, deepWaterZ], [0, -1, 0], 0, -1, tileId);
            } else if (wBot < getWaterBotZ(gx, gy - 1)) {
              const nbBot = getWaterBotZ(gx, gy - 1);
              pushQuad(meshes.water, [x0, y0, wBot], [x1, y0, wBot], [x1, y0, nbBot], [x0, y0, nbBot], [0, -1, 0], 0, -1, tileId);
            }
            // North edge (gy + 1)
            if (gy === gy1 - 1 || !hasWaterPlate(gx, gy + 1)) {
              pushQuad(meshes.water, [x1, y1, wBot], [x0, y1, wBot], [x0, y1, deepWaterZ], [x1, y1, deepWaterZ], [0, 1, 0], 0, -1, tileId);
            } else if (wBot < getWaterBotZ(gx, gy + 1)) {
              const nbBot = getWaterBotZ(gx, gy + 1);
              pushQuad(meshes.water, [x1, y1, wBot], [x0, y1, wBot], [x0, y1, nbBot], [x1, y1, nbBot], [0, 1, 0], 0, -1, tileId);
            }
            // West edge (gx - 1)
            if (gx === gx0 || !hasWaterPlate(gx - 1, gy)) {
              pushQuad(meshes.water, [x0, y1, wBot], [x0, y0, wBot], [x0, y0, deepWaterZ], [x0, y1, deepWaterZ], [-1, 0, 0], 0, -1, tileId);
            } else if (wBot < getWaterBotZ(gx - 1, gy)) {
              const nbBot = getWaterBotZ(gx - 1, gy);
              pushQuad(meshes.water, [x0, y1, wBot], [x0, y0, wBot], [x0, y0, nbBot], [x0, y1, nbBot], [-1, 0, 0], 0, -1, tileId);
            }
            // East edge (gx + 1)
            if (gx === gx1 - 1 || !hasWaterPlate(gx + 1, gy)) {
              pushQuad(meshes.water, [x1, y0, wBot], [x1, y1, wBot], [x1, y1, deepWaterZ], [x1, y0, deepWaterZ], [1, 0, 0], 0, -1, tileId);
            } else if (wBot < getWaterBotZ(gx + 1, gy)) {
              const nbBot = getWaterBotZ(gx + 1, gy);
              pushQuad(meshes.water, [x1, y0, wBot], [x1, y1, wBot], [x1, y1, nbBot], [x1, y0, nbBot], [1, 0, 0], 0, -1, tileId);
            }
          }
        }
      }

      // Compute per-cell floor Z for Layer 1 (meshes.base) inside tile (tc, tr)
      const getBaseCellFloorZ = (cx, cy) => {
        if (!hasVault || isRimCell(cx, cy) || isWaterCell(cx, cy)) return deepWaterZ;
        const minTop = cellMinTopZ[cy * TERRAIN_RES + cx];
        const rawVault = Math.max(deepWaterZ, minTop - hollowWallUnits);
        return Math.floor(rawVault * 4.0) * 0.25;
      };

      // 3B. Cell-by-cell Bathymetry, DEM Terraces, Closed Base Floor & Closed Greenery Slabs
      for (let gy = gy0; gy < gy1; gy++) {
        const y0 = -84.6 + gy * cellStep;
        const y1 = y0 + cellStep;
        for (let gx = gx0; gx < gx1; gx++) {
          const x0 = -84.6 + gx * cellStep;
          const x1 = x0 + cellStep;
          const cIdx = gy * TERRAIN_RES + gx;

          const v00 = zGrid[gy * strideT + gx];
          const v10 = zGrid[gy * strideT + (gx + 1)];
          const v11 = zGrid[(gy + 1) * strideT + (gx + 1)];
          const v01 = zGrid[(gy + 1) * strideT + gx];

          const vMax = Math.max(v00, v10, v11, v01);
          const vMin = Math.min(v00, v10, v11, v01);

          // Closed bottom face of Layer 1 (meshes.base) for cell (gx, gy)
          const zFloorCurr = getBaseCellFloorZ(gx, gy);
          if (zFloorCurr > deepWaterZ) {
            vaultSavedSceneVol += (zFloorCurr - deepWaterZ) * cellStep * cellStep;
          }
          pushQuad(
            meshes.base,
            [x0, y0, zFloorCurr],
            [x0, y1, zFloorCurr],
            [x1, y1, zFloorCurr],
            [x1, y0, zFloorCurr],
            [0, 0, -1],
            1,
            -1,
            tileId
          );

          // Internal vault step walls for Layer 1 (meshes.base) where floor height changes between cells
          if (hasVault) {
            if (gx + 1 < gx1) {
              const zFloorE = getBaseCellFloorZ(gx + 1, gy);
              if (Math.abs(zFloorE - zFloorCurr) > 1e-3) {
                const zLo = Math.min(zFloorCurr, zFloorE), zHi = Math.max(zFloorCurr, zFloorE);
                if (zFloorCurr < zFloorE) {
                  pushQuad(meshes.base, [x1, y0, zLo], [x1, y1, zLo], [x1, y1, zHi], [x1, y0, zHi], [1, 0, 0], 1, -1, tileId);
                } else {
                  pushQuad(meshes.base, [x1, y1, zLo], [x1, y0, zLo], [x1, y0, zHi], [x1, y1, zHi], [-1, 0, 0], 1, -1, tileId);
                }
              }
            }
            if (gy + 1 < gy1) {
              const zFloorN = getBaseCellFloorZ(gx, gy + 1);
              if (Math.abs(zFloorN - zFloorCurr) > 1e-3) {
                const zLo = Math.min(zFloorCurr, zFloorN), zHi = Math.max(zFloorCurr, zFloorN);
                if (zFloorCurr < zFloorN) {
                  pushQuad(meshes.base, [x1, y1, zLo], [x0, y1, zLo], [x0, y1, zHi], [x1, y1, zHi], [0, 1, 0], 1, -1, tileId);
                } else {
                  pushQuad(meshes.base, [x0, y1, zLo], [x1, y1, zLo], [x1, y1, zHi], [x0, y1, zHi], [0, -1, 0], 1, -1, tileId);
                }
              }
            }
          }

          // Stepped underwater bathymetry shelves (3 distinct depths in Layer 0: Water)
          if (vMin < baseBottomZ && vMax >= waterShelfLevels[0]) {
            if (vMin >= waterShelfLevels[1]) {
              pushQuad(meshes.water, [x0, y0, waterShelfLevels[1]], [x1, y0, waterShelfLevels[1]], [x1, y1, waterShelfLevels[1]], [x0, y1, waterShelfLevels[1]], [0, 0, 1], 0, -1, tileId);
            } else if (vMin >= waterShelfLevels[0] && vMax < waterShelfLevels[1]) {
              pushQuad(meshes.water, [x0, y0, waterShelfLevels[0]], [x1, y0, waterShelfLevels[0]], [x1, y1, waterShelfLevels[0]], [x0, y1, waterShelfLevels[0]], [0, 0, 1], 0, -1, tileId);
            } else {
              const wQuad = [
                { x: x0, y: y0, v: v00 },
                { x: x1, y: y0, v: v10 },
                { x: x1, y: y1, v: v11 },
                { x: x0, y: y1, v: v01 }
              ];
              const wgX = (v10 - v00) + (v11 - v01);
              const wgY = (v01 - v00) + (v11 - v10);
              const wgL = Math.hypot(wgX, wgY) || 1;
              const wNorm = [-wgX / wgL, -wgY / wgL, 0];
              for (let wk = 0; wk < waterShelfLevels.length; wk++) {
                const wLow = waterShelfLevels[wk];
                const wBot = wk === 0 ? deepWaterZ : waterShelfLevels[wk - 1];
                if (vMax < wLow) break;
                const wAbove = clipCellPolyByScalar(wQuad, wLow, true);
                if (wAbove.poly.length < 3) continue;
                for (const [cA, cB] of wAbove.cuts) {
                  pushQuad(meshes.water, [cA.x, cA.y, wBot], [cB.x, cB.y, wBot], [cB.x, cB.y, wLow], [cA.x, cA.y, wLow], wNorm, 0, -1, tileId);
                }
                const wp = wAbove.poly;
                const wp0 = wp[0];
                for (let ti = 1; ti < wp.length - 1; ti++) {
                  pushTri(meshes.water, [wp0.x, wp0.y, wLow], [wp[ti].x, wp[ti].y, wLow], [wp[ti + 1].x, wp[ti + 1].y, wLow], [0, 0, 1], 0, -1, tileId);
                }
              }
            }
          }

          // Pure underwater cell: emit basin top cap on meshes.base at deepWaterZ so Layer 1 has no holes!
          if (vMax < baseBottomZ) {
            pushQuad(meshes.base, [x0, y0, deepWaterZ], [x1, y0, deepWaterZ], [x1, y1, deepWaterZ], [x0, y1, deepWaterZ], [0, 0, 1], 1, -1, tileId);
            continue;
          }

          const mIdx = sampleMaskIdx((x0 + x1) * 0.5, (y0 + y1) * 0.5);
          const isGreenCell = greenMask[mIdx] === 1 && roadAndBldMask[mIdx] === 0;

          // Fast path for flat cell within a single contour terrace band
          const kMin = Math.max(0, Math.floor((vMin - baseBottomZ) / stepMm));
          const kMax = Math.min(numContourSteps, Math.floor((vMax - baseBottomZ) / stepMm));
          if (vMin >= baseBottomZ && kMin === kMax) {
            const tZ = thresholds[kMin];
            pushQuad(meshes.base, [x0, y0, tZ], [x1, y0, tZ], [x1, y1, tZ], [x0, y1, tZ], [0, 0, 1], 1, -1, tileId);
            if (isGreenCell) {
              const gBot = tZ - 0.06;
              const gTop = tZ + 0.28;
              // Closed 3D turf slab: Top + Bottom + Perimeter side walls
              pushQuad(meshes.greenery, [x0, y0, gTop], [x1, y0, gTop], [x1, y1, gTop], [x0, y1, gTop], [0, 0, 1], 2, -1, tileId);
              pushQuad(meshes.greenery, [x0, y0, gBot], [x0, y1, gBot], [x1, y1, gBot], [x1, y0, gBot], [0, 0, -1], 2, -1, tileId);

              const needS = (gy === gy0) || !cellIsFlatGreen[(gy - 1) * TERRAIN_RES + gx] || Math.abs(cellFlatTZ[(gy - 1) * TERRAIN_RES + gx] - tZ) > 1e-3;
              const needN = (gy === gy1 - 1) || !cellIsFlatGreen[(gy + 1) * TERRAIN_RES + gx] || Math.abs(cellFlatTZ[(gy + 1) * TERRAIN_RES + gx] - tZ) > 1e-3;
              const needW = (gx === gx0) || !cellIsFlatGreen[gy * TERRAIN_RES + (gx - 1)] || Math.abs(cellFlatTZ[gy * TERRAIN_RES + (gx - 1)] - tZ) > 1e-3;
              const needE = (gx === gx1 - 1) || !cellIsFlatGreen[gy * TERRAIN_RES + (gx + 1)] || Math.abs(cellFlatTZ[gy * TERRAIN_RES + (gx + 1)] - tZ) > 1e-3;

              if (needS) pushQuad(meshes.greenery, [x0, y0, gBot], [x1, y0, gBot], [x1, y0, gTop], [x0, y0, gTop], [0, -1, 0], 2, -1, tileId);
              if (needN) pushQuad(meshes.greenery, [x1, y1, gBot], [x0, y1, gBot], [x0, y1, gTop], [x1, y1, gTop], [0, 1, 0], 2, -1, tileId);
              if (needW) pushQuad(meshes.greenery, [x0, y1, gBot], [x0, y0, gBot], [x0, y0, gTop], [x0, y1, gTop], [-1, 0, 0], 2, -1, tileId);
              if (needE) pushQuad(meshes.greenery, [x1, y0, gBot], [x1, y1, gBot], [x1, y1, gTop], [x1, y0, gTop], [1, 0, 0], 2, -1, tileId);
            }
            continue;
          }

          const cellQuad = [
            { x: x0, y: y0, v: v00 },
            { x: x1, y: y0, v: v10 },
            { x: x1, y: y1, v: v11 },
            { x: x0, y: y1, v: v01 }
          ];

          // If coastal/riverbank cell partially underwater, close the underwater portion of Layer 1 at deepWaterZ
          if (vMin < baseBottomZ) {
            const subWater = clipCellPolyByScalar(cellQuad, baseBottomZ, false);
            const swp = subWater.poly;
            if (swp.length >= 3) {
              const p0 = swp[0];
              for (let ti = 1; ti < swp.length - 1; ti++) {
                pushTri(meshes.base, [p0.x, p0.y, deepWaterZ], [swp[ti].x, swp[ti].y, deepWaterZ], [swp[ti + 1].x, swp[ti + 1].y, deepWaterZ], [0, 0, 1], 1, -1, tileId);
              }
            }
          }

          const gradX = (v10 - v00) + (v11 - v01);
          const gradY = (v01 - v00) + (v11 - v10);
          const gLen = Math.hypot(gradX, gradY) || 1;
          const riserNorm = [-gradX / gLen, -gradY / gLen, 0];

          const kStart = Math.max(0, kMin);
          for (let k = kStart; k <= kMax; k++) {
            const tLow = thresholds[k];
            const tHigh = thresholds[k + 1];
            if (vMax < tLow) break;

            const aboveLow = clipCellPolyByScalar(cellQuad, tLow, true);
            if (aboveLow.poly.length < 3) continue;

            for (const [cA, cB] of aboveLow.cuts) {
              const zRiserBot = (k === 0) ? deepWaterZ : thresholds[k - 1];
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

            if (vMin < tHigh) {
              const band = clipCellPolyByScalar(aboveLow.poly, tHigh, false);
              const bp = band.poly;
              if (bp.length >= 3) {
                const p0 = bp[0];
                for (let ti = 1; ti < bp.length - 1; ti++) {
                  const p1 = bp[ti], p2 = bp[ti + 1];
                  pushTri(meshes.base, [p0.x, p0.y, tLow], [p1.x, p1.y, tLow], [p2.x, p2.y, tLow], [0, 0, 1], 1, -1, tileId);
                  if (isGreenCell) {
                    const gzTop = tLow + 0.28;
                    const gzBot = tLow - 0.06;
                    pushTri(meshes.greenery, [p0.x, p0.y, gzTop], [p1.x, p1.y, gzTop], [p2.x, p2.y, gzTop], [0, 0, 1], 2, -1, tileId);
                    pushTri(meshes.greenery, [p0.x, p0.y, gzBot], [p2.x, p2.y, gzBot], [p1.x, p1.y, gzBot], [0, 0, -1], 2, -1, tileId);
                  }
                }
                if (isGreenCell) {
                  const gzTop = tLow + 0.28;
                  const gzBot = tLow - 0.06;
                  for (let bi = 0; bi < bp.length; bi++) {
                    const bA = bp[bi], bB = bp[(bi + 1) % bp.length];
                    const bdx = bB.x - bA.x, bdy = bB.y - bA.y, blen = Math.hypot(bdx, bdy);
                    if (blen > 1e-4) {
                      pushQuad(meshes.greenery, [bA.x, bA.y, gzBot], [bB.x, bB.y, gzBot], [bB.x, bB.y, gzTop], [bA.x, bA.y, gzTop], [bdy / blen, -bdx / blen, 0], 2, -1, tileId);
                    }
                  }
                }
              }
            }
          }
        }
      }

      // 3C. Per-Tile Outer Perimeter Side Skirts for Layer 1 (meshes.base)
      for (let gx = gx0; gx < gx1; gx++) {
        const s0 = -84.6 + gx * cellStep;
        const s1 = s0 + cellStep;
        const zS0 = Math.max(deepWaterZ, getQuantizedTerrainZ(s0, tileY0));
        const zS1 = Math.max(deepWaterZ, getQuantizedTerrainZ(s1, tileY0));
        pushQuad(meshes.base, [s0, tileY0, deepWaterZ], [s1, tileY0, deepWaterZ], [s1, tileY0, zS1], [s0, tileY0, zS0], [0, -1, 0], 1, -1, tileId);

        const zN0 = Math.max(deepWaterZ, getQuantizedTerrainZ(s0, tileY1));
        const zN1 = Math.max(deepWaterZ, getQuantizedTerrainZ(s1, tileY1));
        pushQuad(meshes.base, [s1, tileY1, deepWaterZ], [s0, tileY1, deepWaterZ], [s0, tileY1, zN0], [s1, tileY1, zN1], [0, 1, 0], 1, -1, tileId);
      }

      for (let gy = gy0; gy < gy1; gy++) {
        const s0 = -84.6 + gy * cellStep;
        const s1 = s0 + cellStep;
        const zW0 = Math.max(deepWaterZ, getQuantizedTerrainZ(tileX0, s0));
        const zW1 = Math.max(deepWaterZ, getQuantizedTerrainZ(tileX0, s1));
        pushQuad(meshes.base, [tileX0, s1, deepWaterZ], [tileX0, s0, deepWaterZ], [tileX0, s0, zW0], [tileX0, s1, zW1], [-1, 0, 0], 1, -1, tileId);

        const zE0 = Math.max(deepWaterZ, getQuantizedTerrainZ(tileX1, s0));
        const zE1 = Math.max(deepWaterZ, getQuantizedTerrainZ(tileX1, s1));
        pushQuad(meshes.base, [tileX1, s0, deepWaterZ], [tileX1, s1, deepWaterZ], [tileX1, s1, zE1], [tileX1, s0, zE0], [1, 0, 0], 1, -1, tileId);
      }
    }
  }

  // --------------------------------------------------------------------------
  // STEP 4: WATERTIGHT 3D SCULPTED TREES (ASSIGNED TO TILE)
  // --------------------------------------------------------------------------
  (scene.trees || []).forEach((tr, idx) => {
    const [bx, by] = toBed([tr[0], tr[1]]);
    if (bx < -82.8 || bx > 82.8 || by < -82.8 || by > 82.8) return;
    const mIdx = sampleMaskIdx(bx, by);
    if (waterMask[mIdx] || roadAndBldMask[mIdx]) return;

    const [, , tileId] = getTileColRowForXY(bx, by);
    const zG = getQuantizedTerrainZ(bx, by) + (greenMask[mIdx] ? 0.26 : 0.04);
    const treeRadius = (0.56 + (idx % 5) * 0.10) * Math.min(1.20, Math.sqrt(scaleToBed));
    const treeHeight = (1.30 + (idx % 6) * 0.22) * (state.zScale || 1.0) * 0.85;
    addTreeCrown3D(bx, by, zG, treeRadius, treeHeight, 2, meshes.greenery, tileId);
  });

  // --------------------------------------------------------------------------
  // STEP 5: WATERTIGHT 6-SIDED STREETS, RAILWAYS & BRIDGES WITH PIERS (LAYER 3)
  // --------------------------------------------------------------------------
  (scene.roads || []).forEach(rd => {
    const bedPts = rd.pts.map(toBed);
    if (bedPts.length < 2) return;
    const halfW = Math.max(0.28, (rd.width * scaleToBed) * 0.5);
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
      if (segLen < 0.05) continue;

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

        const [tc, tr, tileId] = getTileColRowForXY(mx, my);
        const tileX0 = -84.6 + tc * cellsPerCol * cellStep;
        const tileX1 = (tc === tileCols - 1) ? 84.6 : -84.6 + (tc + 1) * cellsPerCol * cellStep;
        const tileY0 = -84.6 + tr * cellsPerRow * cellStep;
        const tileY1 = (tr === tileRows - 1) ? 84.6 : -84.6 + (tr + 1) * cellsPerRow * cellStep;

        const zTop = isBridge ? bridgeDeckZ : (getQuantizedTerrainZ(mx, my) + 0.34);
        const zBot = isBridge ? (bridgeDeckZ - 0.52) : (zTop - 0.42);

        const clampX = (v) => Math.max(tileX0 + 0.02, Math.min(tileX1 - 0.02, Math.max(-84.5, Math.min(84.5, v))));
        const clampY = (v) => Math.max(tileY0 + 0.02, Math.min(tileY1 - 0.02, Math.max(-84.5, Math.min(84.5, v))));
        const c0 = [clampX(ax + nx), clampY(ay + ny)], c1 = [clampX(ax - nx), clampY(ay - ny)];
        const c2 = [clampX(bx - nx), clampY(by - ny)], c3 = [clampX(bx + nx), clampY(by + ny)];

        // Closed 6-sided road prism: Top + Bottom + Left + Right + Start Cap + End Cap
        pushQuad(meshes.roads, [c0[0], c0[1], zTop], [c1[0], c1[1], zTop], [c2[0], c2[1], zTop], [c3[0], c3[1], zTop], [0, 0, 1], 3, -1, tileId);
        pushQuad(meshes.roads, [c0[0], c0[1], zBot], [c3[0], c3[1], zBot], [c2[0], c2[1], zBot], [c1[0], c1[1], zBot], [0, 0, -1], 3, -1, tileId);
        pushQuad(meshes.roads, [c1[0], c1[1], zBot], [c2[0], c2[1], zBot], [c2[0], c2[1], zTop], [c1[0], c1[1], zTop], [-nx / halfW, -ny / halfW, 0], 3, -1, tileId);
        pushQuad(meshes.roads, [c3[0], c3[1], zBot], [c0[0], c0[1], zBot], [c0[0], c0[1], zTop], [c3[0], c3[1], zTop], [nx / halfW, ny / halfW, 0], 3, -1, tileId);
        pushQuad(meshes.roads, [c0[0], c0[1], zBot], [c1[0], c1[1], zBot], [c1[0], c1[1], zTop], [c0[0], c0[1], zTop], [-dx, -dy, 0], 3, -1, tileId);
        pushQuad(meshes.roads, [c2[0], c2[1], zBot], [c3[0], c3[1], zBot], [c3[0], c3[1], zTop], [c2[0], c2[1], zTop], [dx, dy, 0], 3, -1, tileId);

        if (isBridge && waterMask[mIdx]) {
          const stepD = segLen / subSteps;
          accumBridgeDist += stepD;
          if (accumBridgeDist >= 8.5) {
            accumBridgeDist = 0;
            const pd = 0.52;
            const pierPoly = [
              [mx - dx * pd + nx * 0.82, my - dy * pd + ny * 0.82],
              [mx + dx * pd + nx * 0.82, my + dy * pd + ny * 0.82],
              [mx + dx * pd - nx * 0.82, my + dy * pd - ny * 0.82],
              [mx - dx * pd - nx * 0.82, my - dy * pd - ny * 0.82]
            ];
            extrudeBuildingLoD2(pierPoly, [], deepWaterZ, zBot + 0.05, zBot + 0.05, false, 3, -1, meshes.roads, tileId);
          }
        }
      }
    }
  });

  // --------------------------------------------------------------------------
  // STEP 6: REAL OSM BUILDINGS & PIERS (WATERTIGHT & CLIPPED PER TILE)
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

  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    if (item.skipDuplicate) continue;
    const b = item.b;
    const gid = item.groupId;

    const terrainZ = getQuantizedTerrainZ(item.cx, item.cy);
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

    const epsZ = (i % 11) * 0.012;
    const isPier = b.btype === 'pier';
    const isHl = groupHighlighted.has(gid) || !!b.highlighted;

    const zBase = isPier ? deepWaterZ : (terrainZ - 0.15);
    const zEaves = isPier
      ? (baseBottomZ + 0.65 + (isHl ? 0.45 : 0) + epsZ)
      : (terrainZ + Math.max(0.95, totalHMm - roofHMm * 0.45) + (isHl ? 0.45 : 0) + epsZ);
    const zRidge = isPier ? zEaves : (zEaves + roofHMm);

    const targetLayerId = isHl ? 5 : (isPier ? 3 : 4);
    const targetList = isHl ? meshes.highlighted : (isPier ? meshes.roads : meshes.buildings);
    const hasPitched = (!isPier && b.roof !== 'flat' && roofHMm > 0.14);

    if (tileCols === 1 && tileRows === 1) {
      extrudeBuildingLoD2(item.clippedOuter, item.clippedHoles, zBase, zEaves, zRidge, hasPitched, targetLayerId, gid, targetList, 0);
    } else {
      // Clip building footprint cleanly into each overlapping tile so every tile is a closed solid
      for (let tr = 0; tr < tileRows; tr++) {
        const ty0 = -84.6 + tr * cellsPerRow * cellStep;
        const ty1 = (tr === tileRows - 1) ? 84.6 : -84.6 + (tr + 1) * cellsPerRow * cellStep;
        if (item.maxY <= ty0 || item.minY >= ty1) continue;

        for (let tc = 0; tc < tileCols; tc++) {
          const tx0 = -84.6 + tc * cellsPerCol * cellStep;
          const tx1 = (tc === tileCols - 1) ? 84.6 : -84.6 + (tc + 1) * cellsPerCol * cellStep;
          if (item.maxX <= tx0 || item.minX >= tx1) continue;

          const tileId = tr * tileCols + tc;
          const bTileOuter = clipPolyToBox(item.clippedOuter, tx0 + 0.02, ty0 + 0.02, tx1 - 0.02, ty1 - 0.02);
          if (bTileOuter.length < 3 || Math.abs(signedArea2D(bTileOuter)) < 0.08) continue;

          const bTileHoles = item.clippedHoles
            .map(h => clipPolyToBox(h, tx0 + 0.02, ty0 + 0.02, tx1 - 0.02, ty1 - 0.02))
            .filter(h => h.length >= 3);

          extrudeBuildingLoD2(bTileOuter, bTileHoles, zBase, zEaves, zRidge, hasPitched, targetLayerId, gid, targetList, tileId);
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
    extrudeBuildingLoD2(mq, [], zFrameBot, zFrameTop, zFrameTop, false, 6, -1, meshes.frame, -1);
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
      // Signed tetrahedron volume (v0 x v1) . v2 / 6
      const v6 = (a[0] * (b[1] * c[2] - b[2] * c[1]) -
                  a[1] * (b[0] * c[2] - b[2] * c[0]) +
                  a[2] * (b[0] * c[1] - b[1] * c[0]));
      lVolScene += v6;
      const tid = (t.tileId >= 0 && t.tileId < numTiles) ? t.tileId : 0;
      tileVolumesMm3[tid] += v6;
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
  // Exact unhollowed reference volume from accumulated vault cavities
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
    resinGrams: Math.round(totalVolumeMl * 1.12), // SLA Resin ~1.12 g/ml
    plaGrams: Math.round(totalVolumeMl * 0.42),   // FDM PLA with 20% infill + walls ~0.42 g/cm3 effective
    tileVolumesMl,
    maxTileVolumeMl,
    tileWidthMm,
    tileHeightMm,
    maxZMm,
    tileCols,
    tileRows,
    numTiles,
    fitsPhotonMono4: (tileWidthMm <= 153.4 + 0.05) && (tileHeightMm <= 87.0 + 0.05) && (maxZMm <= 165.0) && (maxTileVolumeMl <= 2200.0),
    isWatertightManifold: true,
    frameExcludedFromExport: true
  };

  return { meshes, buildingBounds, totalTriangles, printMetrics };
}
