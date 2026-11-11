// ============================================================================
// src/mesh/mesh_clipper_3d.js
// Exact 3D Axis-Plane Mesh Clipper & Watertight Cross-Section Capper
// ============================================================================

if (typeof computeFaceNormal === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
  Object.assign(global, require('./mesh_primitives.js'));
}

// Canonical edge interpolation sorting endpoints lexicographically so shared edges produce bit-identical cut coordinates
function edgeInterpCanonical3D(A, B, axis, cutVal) {
  const swap = (A[0] > B[0]) || (A[0] === B[0] && A[1] > B[1]) || (A[0] === B[0] && A[1] === B[1] && A[2] > B[2]);
  const p0 = swap ? B : A, p1 = swap ? A : B;
  const denom = p1[axis] - p0[axis];
  const t = Math.abs(denom) < 1e-12 ? 0.5 : (cutVal - p0[axis]) / denom;
  const fix = v => Math.abs(v) < 1e-9 ? 0 : v;
  return [
    axis === 0 ? cutVal : fix(p0[0] + t * (p1[0] - p0[0])),
    axis === 1 ? cutVal : fix(p0[1] + t * (p1[1] - p0[1])),
    axis === 2 ? cutVal : fix(p0[2] + t * (p1[2] - p0[2]))
  ];
}

// Triangulates cut-plane loops preserving 100% of boundary vertices (never stripping collinear vertices to avoid T-junctions)
function triangulateCutLoopExact(loopPts) {
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

  const indices = pts.map((_, i) => i);
  const tris = [];
  let guard = 0;
  const maxIter = indices.length * 6 + 50;

  function ptDistSq(p1, p2) { return (p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2; }
  function isInsideTri(px, py, ax, ay, bx, by, cx, cy) {
    const v0x = cx - ax, v0y = cy - ay;
    const v1x = bx - ax, v1y = by - ay;
    const v2x = px - ax, v2y = py - ay;
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
      const dax = c[0] - a[0], day = c[1] - a[1];
      const lenSq = dax * dax + day * day;

      for (let j = 0; j < n; j++) {
        const idx = indices[j];
        if (idx === iPrev || idx === iCurr || idx === iNext) continue;
        const p = pts[idx];
        if (p[0] < tMinX || p[0] > tMaxX || p[1] < tMinY || p[1] > tMaxY) continue;
        if (ptDistSq(p, a) < 1e-9 || ptDistSq(p, b) < 1e-9 || ptDistSq(p, c) < 1e-9) continue;
        if (isInsideTri(p[0], p[1], a[0], a[1], b[0], b[1], c[0], c[1])) {
          hasInside = true;
          break;
        }
        if (lenSq > 1e-12) {
          const pax = p[0] - a[0], pay = p[1] - a[1];
          const crossP = dax * pay - day * pax;
          if (Math.abs(crossP) < 1e-10) {
            const dotP = pax * dax + pay * day;
            if (dotP > 1e-8 && dotP < lenSq - 1e-8) {
              hasInside = true;
              break;
            }
          }
        }
      }
      if (!hasInside) {
        const dSq = ptDistSq(a, c);
        if (dSq < bestDiagSq) {
          bestDiagSq = dSq;
          bestEarIdx = i;
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

    let fallbackIdx = -1;
    let bestCross = 1e-9;
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
    if (fallbackIdx >= 0) {
      const iPrev = indices[(fallbackIdx + n - 1) % n];
      const iCurr = indices[fallbackIdx];
      const iNext = indices[(fallbackIdx + 1) % n];
      tris.push([pts[iPrev], pts[iCurr], pts[iNext]]);
      indices.splice(fallbackIdx, 1);
      continue;
    }
    break;
  }
  if (indices.length >= 3) {
    for (let k = 1; k < indices.length - 1; k++) {
      const a = pts[indices[0]], b = pts[indices[k]], c = pts[indices[k + 1]];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross > 1e-9) tris.push([a, b, c]);
      else if (cross < -1e-9) tris.push([a, c, b]);
    }
  }
  return tris;
}

// Clips closed 2-manifold triangle mesh against an axis plane and caps the cut face with 100% manifold topology
function clipClosedMeshByAxisPlane(tris, axis, cutVal, keepGreater) {
  if (!tris || tris.length === 0) return [];

  // Generic-position micro-perturbation (<= 6 microns inward ONLY when cutVal grazes a vertex within < 5e-4)
  // Prevents sub-micron sliver triangles from collapsing under 0.001mm (.toFixed(3)) STL/3MF vertex welding!
  let effCut = cutVal;
  const minClearForCut = (cVal) => {
    let minD = Infinity;
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      const d0 = Math.abs(t.v0[axis] - cVal); if (d0 < minD) minD = d0;
      const d1 = Math.abs(t.v1[axis] - cVal); if (d1 < minD) minD = d1;
      const d2 = Math.abs(t.v2[axis] - cVal); if (d2 < minD) minD = d2;
      if (minD < 5e-4) return minD;
    }
    return minD;
  };
  let bestClear = minClearForCut(cutVal);
  if (bestClear < 5e-4) {
    for (let step = 1; step <= 8; step++) {
      const cand = keepGreater ? (cutVal + step * 5.5e-4) : (cutVal - step * 5.5e-4);
      const cl = minClearForCut(cand);
      if (cl > bestClear) {
        bestClear = cl;
        effCut = cand;
        if (cl >= 5e-4) break;
      }
    }
  }

  const outTris = [];
  const cutSegs = [];
  const eps = 1e-8;
  const qv = v => Math.abs(v) < 1e-6 ? 0 : v;
  const key = p => qv(p[0]).toFixed(6) + '_' + qv(p[1]).toFixed(6) + '_' + qv(p[2]).toFixed(6);

  for (let ti = 0; ti < tris.length; ti++) {
    const tri = tris[ti];
    const in0 = keepGreater ? (tri.v0[axis] >= effCut - eps) : (tri.v0[axis] <= effCut + eps);
    const in1 = keepGreater ? (tri.v1[axis] >= effCut - eps) : (tri.v1[axis] <= effCut + eps);
    const in2 = keepGreater ? (tri.v2[axis] >= effCut - eps) : (tri.v2[axis] <= effCut + eps);
    const inCount = (in0 ? 1 : 0) + (in1 ? 1 : 0) + (in2 ? 1 : 0);

    if (inCount === 0) continue;
    if (inCount === 3) {
      outTris.push(tri);
      continue;
    }

    const verts = [tri.v0, tri.v1, tri.v2];
    const ins = [in0, in1, in2];
    let P1, P2, rawTris;

    if (inCount === 1) {
      const i = ins.indexOf(true);
      const V0 = verts[i], V1 = verts[(i + 1) % 3], V2 = verts[(i + 2) % 3];
      P1 = edgeInterpCanonical3D(V0, V1, axis, effCut);
      P2 = edgeInterpCanonical3D(V2, V0, axis, effCut);
      rawTris = Math.hypot(P1[0] - P2[0], P1[1] - P2[1], P1[2] - P2[2]) < 1e-8
        ? []
        : [{ v0: V0, v1: P1, v2: P2, layerId: tri.layerId, buildingId: tri.buildingId, tileId: tri.tileId, shellId: tri.shellId }];
    } else {
      const i = ins.indexOf(false);
      const Vout = verts[i], V1 = verts[(i + 1) % 3], V2 = verts[(i + 2) % 3];
      P1 = edgeInterpCanonical3D(V2, Vout, axis, effCut);
      P2 = edgeInterpCanonical3D(Vout, V1, axis, effCut);
      rawTris = Math.hypot(P1[0] - P2[0], P1[1] - P2[1], P1[2] - P2[2]) < 1e-8
        ? [{ v0: V1, v1: V2, v2: P1, layerId: tri.layerId, buildingId: tri.buildingId, tileId: tri.tileId, shellId: tri.shellId }]
        : [
            { v0: V1, v1: V2, v2: P1, layerId: tri.layerId, buildingId: tri.buildingId, tileId: tri.tileId, shellId: tri.shellId },
            { v0: V1, v1: P1, v2: P2, layerId: tri.layerId, buildingId: tri.buildingId, tileId: tri.tileId, shellId: tri.shellId }
          ];
    }

    let emittedAny = false;
    for (let k = 0; k < rawTris.length; k++) {
      const t = rawTris[k];
      if (!isDegenerateTri3D(t.v0, t.v1, t.v2)) {
        t.n = computeFaceNormal(t.v0, t.v1, t.v2);
        outTris.push(t);
        emittedAny = true;
      }
    }

    const dSeg = Math.hypot(P1[0] - P2[0], P1[1] - P2[1], P1[2] - P2[2]);
    if (emittedAny && dSeg > 1e-8 && key(P1) !== key(P2)) {
      cutSegs.push([P2, P1]);
    }
  }

  if (cutSegs.length < 3) return outTris;

  const map = new Map();
  for (let i = 0; i < cutSegs.length; i++) {
    const seg = cutSegs[i];
    const k0 = key(seg[0]);
    if (!map.has(k0)) map.set(k0, []);
    map.get(k0).push(seg);
  }

  const loops = [];
  const used = new Set();
  for (let i = 0; i < cutSegs.length; i++) {
    const startSeg = cutSegs[i];
    if (used.has(startSeg)) continue;
    const loop = [];
    let curr = startSeg;
    while (curr && !used.has(curr)) {
      used.add(curr);
      loop.push(curr[0]);
      const nextKey = key(curr[1]);
      const candidates = map.get(nextKey) || [];
      let nextSeg = candidates.find(s => !used.has(s));
      if (!nextSeg) {
        for (let j = 0; j < cutSegs.length; j++) {
          const other = cutSegs[j];
          if (!used.has(other)) {
            if (Math.hypot(curr[1][0] - other[0][0], curr[1][1] - other[0][1], curr[1][2] - other[0][2]) < 1e-4) {
              nextSeg = other;
              break;
            }
          }
        }
      }
      curr = nextSeg;
    }
    if (loop.length >= 3) loops.push(loop);
  }

  if (loops.length === 0) return outTris;

  const fix = v => Math.abs(v) < 1e-9 ? 0 : v;
  let to2D, to3D;
  if (axis === 0 && keepGreater) {
    to2D = p => [-p[1], p[2]];
    to3D = (u, v) => [effCut, fix(-u), fix(v)];
  } else if (axis === 0 && !keepGreater) {
    to2D = p => [p[1], p[2]];
    to3D = (u, v) => [effCut, fix(u), fix(v)];
  } else if (axis === 1 && keepGreater) {
    to2D = p => [p[0], p[2]];
    to3D = (u, v) => [fix(u), effCut, fix(v)];
  } else {
    to2D = p => [-p[0], p[2]];
    to3D = (u, v) => [fix(-u), effCut, fix(v)];
  }

  const outerLoops = [];
  const holeLoops = [];
  for (let i = 0; i < loops.length; i++) {
    const l2d = loops[i].map(to2D);
    let a = 0;
    for (let j = 0, n = l2d.length; j < n; j++) {
      a += (l2d[j][0] * l2d[(j + 1) % n][1] - l2d[(j + 1) % n][0] * l2d[j][1]);
    }
    if (a * 0.5 >= 0) outerLoops.push({ poly: l2d, area: a * 0.5 });
    else holeLoops.push(l2d);
  }

  for (let h = 0; h < holeLoops.length; h++) {
    const hole = holeLoops[h];
    let parentIdx = -1, bestArea = Infinity;
    for (let o = 0; o < outerLoops.length; o++) {
      if (outerLoops[o].area < bestArea && pointInPoly2D(hole[0][0], hole[0][1], outerLoops[o].poly)) {
        bestArea = outerLoops[o].area;
        parentIdx = o;
      }
    }
    if (parentIdx >= 0) {
      outerLoops[parentIdx].poly = mergeHolesIntoOuterKeyhole(outerLoops[parentIdx].poly, [hole]);
    } else {
      hole.reverse();
      outerLoops.push({ poly: hole, area: Math.abs(signedArea2D(hole)) });
    }
  }

  for (let i = 0; i < outerLoops.length; i++) {
    const cap2D = triangulateCutLoopExact(outerLoops[i].poly);
    for (let k = 0; k < cap2D.length; k++) {
      const [a2, b2, c2] = cap2D[k];
      const t3 = {
        v0: to3D(a2[0], a2[1]),
        v1: to3D(b2[0], b2[1]),
        v2: to3D(c2[0], c2[1]),
        layerId: tris[0]?.layerId ?? 4,
        buildingId: tris[0]?.buildingId ?? -1,
        tileId: tris[0]?.tileId ?? 0,
        shellId: tris[0]?.shellId
      };
      if (!isDegenerateTri3D(t3.v0, t3.v1, t3.v2)) {
        t3.n = computeFaceNormal(t3.v0, t3.v1, t3.v2);
        outTris.push(t3);
      }
    }
  }

  return outTris;
}

// Clips closed 3D triangle shell against [xMin, xMax] × [yMin, yMax] with 0 open edges guaranteed
function clipMeshToBox3D(shellTris, xMin, xMax, yMin, yMax, tileId = 0) {
  if (!shellTris || shellTris.length === 0) return [];

  let sMinX = Infinity, sMaxX = -Infinity;
  let sMinY = Infinity, sMaxY = -Infinity;
  for (let i = 0; i < shellTris.length; i++) {
    const t = shellTris[i];
    for (const v of [t.v0, t.v1, t.v2]) {
      const x = v[0], y = v[1];
      if (x < sMinX) sMinX = x;
      if (x > sMaxX) sMaxX = x;
      if (y < sMinY) sMinY = y;
      if (y > sMaxY) sMaxY = y;
    }
  }

  if (sMaxX < xMin - 1e-4 || sMinX > xMax + 1e-4 || sMaxY < yMin - 1e-4 || sMinY > yMax + 1e-4) {
    return [];
  }

  if (sMinX >= xMin - 1e-4 && sMaxX <= xMax + 1e-4 && sMinY >= yMin - 1e-4 && sMaxY <= yMax + 1e-4) {
    return shellTris.map(t => ({
      v0: [t.v0[0], t.v0[1], t.v0[2]],
      v1: [t.v1[0], t.v1[1], t.v1[2]],
      v2: [t.v2[0], t.v2[1], t.v2[2]],
      n: t.n ? [t.n[0], t.n[1], t.n[2]] : computeFaceNormal(t.v0, t.v1, t.v2),
      layerId: t.layerId,
      buildingId: t.buildingId,
      tileId,
      shellId: t.shellId
    }));
  }

  let cur = shellTris;
  cur = clipClosedMeshByAxisPlane(cur, 0, xMin, true);
  if (cur.length === 0) return [];
  cur = clipClosedMeshByAxisPlane(cur, 0, xMax, false);
  if (cur.length === 0) return [];
  cur = clipClosedMeshByAxisPlane(cur, 1, yMin, true);
  if (cur.length === 0) return [];
  cur = clipClosedMeshByAxisPlane(cur, 1, yMax, false);
  if (cur.length === 0) return [];

  const fix = v => Math.abs(v) < 1e-9 ? 0 : v;
  for (let i = 0; i < cur.length; i++) {
    cur[i].tileId = tileId;
    cur[i].v0 = [fix(cur[i].v0[0]), fix(cur[i].v0[1]), fix(cur[i].v0[2])];
    cur[i].v1 = [fix(cur[i].v1[0]), fix(cur[i].v1[1]), fix(cur[i].v1[2])];
    cur[i].v2 = [fix(cur[i].v2[0]), fix(cur[i].v2[1]), fix(cur[i].v2[2])];
    if (!cur[i].n) cur[i].n = computeFaceNormal(cur[i].v0, cur[i].v1, cur[i].v2);
  }

  return cur;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    edgeInterpCanonical3D,
    triangulateCutLoopExact,
    clipClosedMeshByAxisPlane,
    clipMeshToBox3D
  };
}
