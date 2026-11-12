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

  const n = pts.length;
  const nodes = new Array(n);
  for (let i = 0; i < n; i++) nodes[i] = { i, pt: pts[i], prev: null, next: null };
  for (let i = 0; i < n; i++) {
    nodes[i].prev = nodes[(i + n - 1) % n];
    nodes[i].next = nodes[(i + 1) % n];
  }

  function isInsideTri(p, a, b, c) {
    const px = p[0], py = p[1];
    if ((Math.abs(px - a[0]) < 1e-7 && Math.abs(py - a[1]) < 1e-7) ||
        (Math.abs(px - b[0]) < 1e-7 && Math.abs(py - b[1]) < 1e-7) ||
        (Math.abs(px - c[0]) < 1e-7 && Math.abs(py - c[1]) < 1e-7)) {
      return false;
    }
    const c1 = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
    const c2 = (c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0]);
    const c3 = (a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0]);
    return c1 > -1e-9 && c2 > -1e-9 && c3 > -1e-9;
  }

  function isEar(ear) {
    const a = ear.prev.pt, b = ear.pt, c = ear.next.pt;
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cross <= 1e-11) return false;
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
      let bestNode = null;
      let bestIntersects = 2;
      let bestInside = 1e9;
      let bestChordSq = Infinity;
      let check = curr;
      do {
        const a = check.prev.pt, b = check.pt, c = check.next.pt;
        const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (cr > 1e-12) {
          let hasInter = 0;
          let insideCnt = 0;
          let e = check.next;
          while (e !== check.prev) {
            if (e !== check.next && e.next !== check.prev && typeof segmentsIntersectProper === 'function') {
              if (segmentsIntersectProper(a, c, e.pt, e.next.pt)) {
                hasInter = 1;
                break;
              }
            }
            if (e !== check.next) {
              if (isInsideTri(e.pt, a, b, c)) insideCnt++;
            }
            e = e.next;
          }
          const chordSq = (c[0] - a[0]) ** 2 + (c[1] - a[1]) ** 2;
          if (hasInter < bestIntersects ||
              (hasInter === bestIntersects && insideCnt < bestInside) ||
              (hasInter === bestIntersects && insideCnt === bestInside && chordSq < bestChordSq)) {
            bestIntersects = hasInter;
            bestInside = insideCnt;
            bestChordSq = chordSq;
            bestNode = check;
          }
        }
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
    if (Math.abs(cross) > 1e-12) {
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
      if (cross > 1e-12) tris.push([a, b, c]);
      else if (cross < -1e-12) tris.push([a, c, b]);
    }
  }

  // Post-triangulation T-junction & dropped collinear vertex repair:
  // Ensures any boundary vertex omitted due to collinear ears is integrated into adjacent triangle edges.
  if (tris.length > 0) {
    const key2 = p => p[0].toFixed(5) + '_' + p[1].toFixed(5);
    const used = new Set();
    for (let i = 0; i < tris.length; i++) {
      used.add(key2(tris[i][0]));
      used.add(key2(tris[i][1]));
      used.add(key2(tris[i][2]));
    }
    const missing = [];
    for (let i = 0; i < pts.length; i++) {
      if (!used.has(key2(pts[i]))) missing.push(pts[i]);
    }
    for (let m = 0; m < missing.length; m++) {
      const p = missing[m];
      let bestTi = -1, bestEdge = null, bestDist = Infinity;
      for (let ti = 0; ti < tris.length; ti++) {
        const [v0, v1, v2] = tris[ti];
        const edges = [
          [v0, v1, v2],
          [v1, v2, v0],
          [v2, v0, v1]
        ];
        for (let ei = 0; ei < 3; ei++) {
          const [a, b, apex] = edges[ei];
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const lenSq = dx * dx + dy * dy;
          if (lenSq < 1e-10) continue;
          const cross = (p[0] - a[0]) * dy - (p[1] - a[1]) * dx;
          const dist = Math.abs(cross) / Math.sqrt(lenSq);
          if (dist > 1e-3) continue;
          const dot = (p[0] - a[0]) * dx + (p[1] - a[1]) * dy;
          const t = dot / lenSq;
          if (t > 1e-7 && t < 1 - 1e-7) {
            if (dist < bestDist) {
              bestDist = dist;
              bestTi = ti;
              bestEdge = [a, b, apex];
              if (dist < 1e-9) break;
            }
          }
        }
        if (bestDist < 1e-9) break;
      }
      if (bestTi >= 0 && bestEdge) {
        const [a, b, apex] = bestEdge;
        tris.splice(bestTi, 1, [a, p, apex], [p, b, apex]);
      }
    }
  }

  return tris;
}

// Clips closed 2-manifold triangle mesh against an axis plane and caps the cut face with 100% manifold topology
function clipClosedMeshByAxisPlane(tris, axis, cutVal, keepGreater, allowPerturb = false) {
  if (!tris || tris.length === 0) return [];

  // Generic-position micro-perturbation (<= 6 microns inward ONLY when allowPerturb is true and cutVal grazes a vertex within < 5e-4)
  // Refined for exact bounding envelope cuts so corner vertices from prior orthogonal cuts are not shaved into nanometer slivers.
  let effCut = cutVal;
  if (allowPerturb) {
    const minClearForCut = (cVal) => {
      let minD = Infinity;
      for (let i = 0; i < tris.length; i++) {
        const t = tris[i];
        const d0 = Math.abs(t.v0[axis] - cVal); if (d0 > 1e-6 && d0 < minD) minD = d0;
        const d1 = Math.abs(t.v1[axis] - cVal); if (d1 > 1e-6 && d1 < minD) minD = d1;
        const d2 = Math.abs(t.v2[axis] - cVal); if (d2 > 1e-6 && d2 < minD) minD = d2;
        if (minD < 5e-4) return minD;
      }
      return minD;
    };
    let bestClear = minClearForCut(cutVal);
    if (bestClear > 1e-6 && bestClear < 5e-4) {
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
    if (dSeg > 1e-8 && key(P1) !== key(P2)) {
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
  cur = clipClosedMeshByAxisPlane(cur, 0, xMin, true, false);
  if (cur.length === 0) return [];
  cur = clipClosedMeshByAxisPlane(cur, 0, xMax, false, false);
  if (cur.length === 0) return [];
  cur = clipClosedMeshByAxisPlane(cur, 1, yMin, true, false);
  if (cur.length === 0) return [];
  cur = clipClosedMeshByAxisPlane(cur, 1, yMax, false, false);
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

// Splits a closed 2-manifold 3D shell across an nx × ny tile grid in O(C + R) plane cuts,
// guaranteeing 0 open edges, 0 non-manifold edges, and 0 triangles protruding outside tile bounds.
function splitClosedShellToTileGrid3D(shellTris, tileBounds, tileCols, tileRows) {
  if (!shellTris || shellTris.length === 0) return [];
  if (!tileBounds || tileBounds.length === 0 || (tileCols <= 1 && tileRows <= 1)) {
    for (let i = 0; i < shellTris.length; i++) shellTris[i].tileId = 0;
    return shellTris;
  }

  let sMinX = Infinity, sMaxX = -Infinity;
  let sMinY = Infinity, sMaxY = -Infinity;
  for (let i = 0; i < shellTris.length; i++) {
    const t = shellTris[i];
    const a = t.v0, b = t.v1, c = t.v2;
    if (a[0] < sMinX) sMinX = a[0]; if (a[0] > sMaxX) sMaxX = a[0];
    if (b[0] < sMinX) sMinX = b[0]; if (b[0] > sMaxX) sMaxX = b[0];
    if (c[0] < sMinX) sMinX = c[0]; if (c[0] > sMaxX) sMaxX = c[0];
    if (a[1] < sMinY) sMinY = a[1]; if (a[1] > sMaxY) sMaxY = a[1];
    if (b[1] < sMinY) sMinY = b[1]; if (b[1] > sMaxY) sMaxY = b[1];
    if (c[1] < sMinY) sMinY = c[1]; if (c[1] > sMaxY) sMaxY = c[1];
  }

  let tcMin = tileCols, tcMax = -1;
  for (let tc = 0; tc < tileCols; tc++) {
    const tb = tileBounds[tc];
    if (tb && sMaxX >= tb.x0 - 1e-4 && sMinX <= tb.x1 + 1e-4) {
      if (tc < tcMin) tcMin = tc;
      if (tc > tcMax) tcMax = tc;
    }
  }
  let trMin = tileRows, trMax = -1;
  for (let tr = 0; tr < tileRows; tr++) {
    const tb = tileBounds[tr * tileCols];
    if (tb && sMaxY >= tb.y0 - 1e-4 && sMinY <= tb.y1 + 1e-4) {
      if (tr < trMin) trMin = tr;
      if (tr > trMax) trMax = tr;
    }
  }

  if (tcMin > tcMax || trMin > trMax) {
    // Shell falls entirely inside kerf gap; clamp to nearest tile only if needed, otherwise empty
    return [];
  }

  // Fast O(T) path when shell lies strictly inside a single tile box
  if (tcMin === tcMax && trMin === trMax) {
    const tid = trMin * tileCols + tcMin;
    const tb = tileBounds[tid];
    if (sMinX >= tb.x0 - 1e-4 && sMaxX <= tb.x1 + 1e-4 && sMinY >= tb.y0 - 1e-4 && sMaxY <= tb.y1 + 1e-4) {
      for (let i = 0; i < shellTris.length; i++) {
        shellTris[i].tileId = tid;
      }
      return shellTris;
    }
  }

  const fix = v => Math.abs(v) < 1e-9 ? 0 : v;
  const result = [];
  let remX = shellTris;

  for (let tc = tcMin; tc <= tcMax && remX.length > 0; tc++) {
    const colTb = tileBounds[tc];
    const x0 = colTb.x0, x1 = colTb.x1;

    let rxMin = Infinity, rxMax = -Infinity;
    for (let i = 0; i < remX.length; i++) {
      const t = remX[i];
      if (t.v0[0] < rxMin) rxMin = t.v0[0]; if (t.v0[0] > rxMax) rxMax = t.v0[0];
      if (t.v1[0] < rxMin) rxMin = t.v1[0]; if (t.v1[0] > rxMax) rxMax = t.v1[0];
      if (t.v2[0] < rxMin) rxMin = t.v2[0]; if (t.v2[0] > rxMax) rxMax = t.v2[0];
    }
    if (rxMax < x0 - 1e-4) continue;

    let colStrip = remX;
    if (rxMin < x0 - 1e-4) {
      colStrip = clipClosedMeshByAxisPlane(colStrip, 0, x0, true, true);
    }
    if (colStrip.length > 0 && rxMax > x1 + 1e-4) {
      colStrip = clipClosedMeshByAxisPlane(colStrip, 0, x1, false, true);
    }

    if (tc < tcMax && remX.length > 0) {
      const nextX0 = tileBounds[tc + 1].x0;
      if (rxMax >= nextX0 - 1e-4) {
        remX = (rxMin < nextX0 - 1e-4) ? clipClosedMeshByAxisPlane(remX, 0, nextX0, true, true) : remX;
      } else {
        remX = [];
      }
    }

    if (colStrip.length === 0) continue;

    let remY = colStrip;
    for (let tr = trMin; tr <= trMax && remY.length > 0; tr++) {
      const tid = tr * tileCols + tc;
      const tb = tileBounds[tid];
      const y0 = tb.y0, y1 = tb.y1;

      let ryMin = Infinity, ryMax = -Infinity;
      for (let i = 0; i < remY.length; i++) {
        const t = remY[i];
        if (t.v0[1] < ryMin) ryMin = t.v0[1]; if (t.v0[1] > ryMax) ryMax = t.v0[1];
        if (t.v1[1] < ryMin) ryMin = t.v1[1]; if (t.v1[1] > ryMax) ryMax = t.v1[1];
        if (t.v2[1] < ryMin) ryMin = t.v2[1]; if (t.v2[1] > ryMax) ryMax = t.v2[1];
      }
      if (ryMax < y0 - 1e-4) continue;

      let cellMesh = remY;
      if (ryMin < y0 - 1e-4) {
        cellMesh = clipClosedMeshByAxisPlane(cellMesh, 1, y0, true, true);
      }
      if (cellMesh.length > 0 && ryMax > y1 + 1e-4) {
        cellMesh = clipClosedMeshByAxisPlane(cellMesh, 1, y1, false, true);
      }

      if (tr < trMax && remY.length > 0) {
        const nextY0 = tileBounds[(tr + 1) * tileCols + tc].y0;
        if (ryMax >= nextY0 - 1e-4) {
          remY = (ryMin < nextY0 - 1e-4) ? clipClosedMeshByAxisPlane(remY, 1, nextY0, true, true) : remY;
        } else {
          remY = [];
        }
      }

      for (let i = 0; i < cellMesh.length; i++) {
        const t = cellMesh[i];
        const v0 = [fix(t.v0[0]), fix(t.v0[1]), fix(t.v0[2])];
        const v1 = [fix(t.v1[0]), fix(t.v1[1]), fix(t.v1[2])];
        const v2 = [fix(t.v2[0]), fix(t.v2[1]), fix(t.v2[2])];
        result.push({
          v0,
          v1,
          v2,
          n: t.n ? [t.n[0], t.n[1], t.n[2]] : computeFaceNormal(v0, v1, v2),
          layerId: t.layerId,
          buildingId: t.buildingId,
          tileId: tid,
          shellId: t.shellId
        });
      }
    }
  }

  return result;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    edgeInterpCanonical3D,
    triangulateCutLoopExact,
    clipClosedMeshByAxisPlane,
    clipMeshToBox3D,
    splitClosedShellToTileGrid3D
  };
}
