// ============================================================================
// src/mesh/roof_architectural.js
// Medial-Bisector Snapped, Sliver-Free Multi-Wing & Courtyard Roof Solver
// & Watertight 2-Manifold LoD2 Building Extruder
// ============================================================================

if (typeof tryEmitPlanarGabledBuilding === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
  Object.assign(global, require('../geometry/obb_medial_2d.js'));
  Object.assign(global, require('./mesh_primitives.js'));
  Object.assign(global, require('./mesh_clipper_3d.js'));
  Object.assign(global, require('./roof_shapes.js'));
}

// Minimum 2D altitude of triangle (A, B, C): 2 * area / longestEdge
function minTriAltitude2D(a, b, c) {
  const area2 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (area2 <= 1e-9) return 0.0;
  const l0 = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const l1 = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const l2 = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const maxL = Math.max(l0, l1, l2);
  return maxL > 1e-8 ? (area2 / maxL) : 0.0;
}

// Subdivides interior roof edges (NEVER boundary edges -> 0 open edges!), snapping split points
// directly onto medial ridge / hip / valley creases so ridges stay razor-straight!
function subdivideInteriorRoofEdges(tris, outerClean, holesClean, minSplitLen = 0.30, evalRoofDist = null) {
  const ptKey = p => p[0].toFixed(4) + '_' + p[1].toFixed(4);
  const edgeKey = (a, b) => {
    const ka = ptKey(a), kb = ptKey(b);
    return ka < kb ? ka + '|' + kb : kb + '|' + ka;
  };

  const boundaryEdges = new Set();
  const markRing = (r) => {
    if (!r || r.length < 2) return;
    for (let i = 0, n = r.length; i < n; i++) boundaryEdges.add(edgeKey(r[i], r[(i + 1) % n]));
  };
  markRing(outerClean);
  if (holesClean) {
    for (let h = 0; h < holesClean.length; h++) markRing(holesClean[h]);
  }

  const edgeCounts = new Map();
  for (let i = 0; i < tris.length; i++) {
    const tri = tris[i];
    for (let e = 0; e < 3; e++) {
      const ek = edgeKey(tri[e], tri[(e + 1) % 3]);
      edgeCounts.set(ek, (edgeCounts.get(ek) || 0) + 1);
    }
  }

  const getDist = evalRoofDist || ((x, y) => distToPolygonBoundary2D(x, y, outerClean, holesClean));
  const sampleTs = [0.34, 0.42, 0.50, 0.58, 0.66];

  const edgeMap = new Map();
  for (let i = 0; i < tris.length; i++) {
    const tri = tris[i];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const ek = edgeKey(a, b);
      if (!edgeMap.has(ek)) {
        const isSharedInterior = !boundaryEdges.has(ek) && edgeCounts.get(ek) === 2;
        const swap = ptKey(a) > ptKey(b);
        const p0 = swap ? b : a, p1 = swap ? a : b;
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        let shouldSplit = false;
        let splitPt = null;

        if (isSharedInterior && len > minSplitLen) {
          const d0 = getDist(p0[0], p0[1]);
          const d1 = getDist(p1[0], p1[1]);
          let bestT = 0.5;
          let maxCrease = -1.0;
          for (let s = 0; s < sampleTs.length; s++) {
            const t = sampleTs[s];
            const px = p0[0] + (p1[0] - p0[0]) * t;
            const py = p0[1] + (p1[1] - p0[1]) * t;
            const dt = getDist(px, py);
            const lin = d0 + (d1 - d0) * t;
            const crease = Math.abs(dt - lin);
            if (crease > maxCrease) {
              maxCrease = crease;
              bestT = t;
            }
          }
          const useT = maxCrease > 0.012 ? bestT : 0.5;
          const cand = [p0[0] + (p1[0] - p0[0]) * useT, p0[1] + (p1[1] - p0[1]) * useT];
          if (distToPolygonBoundary2D(cand[0], cand[1], outerClean, holesClean) > 4e-3) {
            shouldSplit = true;
            splitPt = cand;
          }
        }
        edgeMap.set(ek, { shouldSplit, mid: splitPt });
      }
    }
  }

  const nextTris = [];
  for (let i = 0; i < tris.length; i++) {
    const [v0, v1, v2] = tris[i];
    const e0 = edgeMap.get(edgeKey(v0, v1));
    const e1 = edgeMap.get(edgeKey(v1, v2));
    const e2 = edgeMap.get(edgeKey(v2, v0));

    const s0 = e0 && e0.shouldSplit, s1 = e1 && e1.shouldSplit, s2 = e2 && e2.shouldSplit;
    const m0 = s0 ? e0.mid : null, m1 = s1 ? e1.mid : null, m2 = s2 ? e2.mid : null;
    const count = (s0 ? 1 : 0) + (s1 ? 1 : 0) + (s2 ? 1 : 0);

    if (count === 0) {
      nextTris.push([v0, v1, v2]);
    } else if (count === 1) {
      if (s0) nextTris.push([v0, m0, v2], [m0, v1, v2]);
      else if (s1) nextTris.push([v1, m1, v0], [m1, v2, v0]);
      else nextTris.push([v2, m2, v1], [m2, v0, v1]);
    } else if (count === 2) {
      if (!s0) nextTris.push([v1, m1, v0], [m1, m2, v0], [m1, v2, m2]);
      else if (!s1) nextTris.push([v2, m2, v1], [m2, m0, v1], [m2, v0, m0]);
      else nextTris.push([v0, m0, v2], [m0, m1, v2], [m0, v1, m1]);
    } else {
      nextTris.push([v0, m0, m2], [m0, v1, m1], [m1, v2, m2], [m0, m1, m2]);
    }
  }
  return nextTris;
}

// Flips interior quad diagonals to align with straight-skeleton ridges, 45° hips, and valleys,
// while strictly forbidding steep cliff facets (newMinNz >= 0.70) and needle slivers!
function optimizeRoofTrisRidgeAligned(tris, outerClean, holesClean, getRoofZ, passes = 5) {
  const ptKey = p => p[0].toFixed(4) + '_' + p[1].toFixed(4);
  const edgeKey = (a, b) => {
    const ka = ptKey(a), kb = ptKey(b);
    return ka < kb ? ka + '|' + kb : kb + '|' + ka;
  };
  const boundaryEdges = new Set();
  const markRing = (r) => {
    if (!r || r.length < 2) return;
    for (let i = 0, n = r.length; i < n; i++) boundaryEdges.add(edgeKey(r[i], r[(i + 1) % n]));
  };
  markRing(outerClean);
  if (holesClean) {
    for (let h = 0; h < holesClean.length; h++) markRing(holesClean[h]);
  }

  const diagCost = (A, B) => {
    const zA = getRoofZ(A), zB = getRoofZ(B);
    let err = 0;
    for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      const mx = A[0] + (B[0] - A[0]) * t;
      const my = A[1] + (B[1] - A[1]) * t;
      const zLin = zA + (zB - zA) * t;
      err += Math.abs(zLin - getRoofZ([mx, my]));
    }
    return err + 0.0045 * Math.hypot(B[0] - A[0], B[1] - A[1]);
  };

  const minNzPair = (tA, tB) => {
    const nA = computeFaceNormal([tA[0][0], tA[0][1], getRoofZ(tA[0])], [tA[1][0], tA[1][1], getRoofZ(tA[1])], [tA[2][0], tA[2][1], getRoofZ(tA[2])]);
    const nB = computeFaceNormal([tB[0][0], tB[0][1], getRoofZ(tB[0])], [tB[1][0], tB[1][1], getRoofZ(tB[1])], [tB[2][0], tB[2][1], getRoofZ(tB[2])]);
    return Math.min(nA[2], nB[2]);
  };

  let cur = tris.slice();
  for (let pass = 0; pass < passes; pass++) {
    const edgeToTris = new Map();
    for (let ti = 0; ti < cur.length; ti++) {
      const t = cur[ti];
      for (let e = 0; e < 3; e++) {
        const ek = edgeKey(t[e], t[(e + 1) % 3]);
        if (boundaryEdges.has(ek)) continue;
        let list = edgeToTris.get(ek);
        if (!list) edgeToTris.set(ek, list = []);
        list.push({ ti, e });
      }
    }

    const locked = new Uint8Array(cur.length);
    let flippedCount = 0;

    for (const [, adj] of edgeToTris.entries()) {
      if (adj.length !== 2) continue;
      const { ti: i1, e: e1 } = adj[0];
      const { ti: i2, e: e2 } = adj[1];
      if (locked[i1] || locked[i2]) continue;

      const t1 = cur[i1], t2 = cur[i2];
      const P = t1[e1], Q = t1[(e1 + 1) % 3], R = t1[(e1 + 2) % 3];
      const P2 = t2[e2], Q2 = t2[(e2 + 1) % 3], S = t2[(e2 + 2) % 3];
      if (ptKey(P) !== ptKey(Q2) || ptKey(Q) !== ptKey(P2)) continue;

      const curMinAlt = Math.min(minTriAltitude2D(P, Q, R), minTriAltitude2D(Q, P, S));
      const newMinAlt = Math.min(minTriAltitude2D(R, P, S), minTriAltitude2D(S, Q, R));
      if (newMinAlt <= 1e-4) continue;

      const curMinNz = minNzPair([P, Q, R], [Q, P, S]);
      const newMinNz = minNzPair([R, P, S], [S, Q, R]);

      if (curMinNz < 0.68 && newMinNz > curMinNz + 0.04) {
        cur[i1] = [R, P, S];
        cur[i2] = [S, Q, R];
        locked[i1] = 1; locked[i2] = 1; flippedCount++;
        continue;
      }
      if (newMinNz < 0.70 || (newMinAlt < 0.042 && newMinAlt <= curMinAlt)) continue;

      const rescueSliver = (curMinAlt < 0.040 && newMinAlt > curMinAlt * 1.35);
      if (rescueSliver || diagCost(R, S) + 1e-5 < diagCost(P, Q)) {
        cur[i1] = [R, P, S];
        cur[i2] = [S, Q, R];
        locked[i1] = 1;
        locked[i2] = 1;
        flippedCount++;
      }
    }
    if (flippedCount === 0) break;
  }
  return cur;
}

// Watertight 2-Manifold LoD2 Building Extrusion supporting both legacy & canonical call signatures
function extrudeBuildingLoD2(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9, arg10, arg11) {
  let outerInput, holesInput, zBase, zEaves, zRidge, hasPitchedRoof, layerId, bId, outTris, tileId, roofShape, opts;

  if (Array.isArray(arg0) && Array.isArray(arg1) && typeof arg3 === 'number' && typeof arg4 === 'number' && typeof arg5 === 'number') {
    outTris = arg0; outerInput = arg1; holesInput = arg2;
    zBase = arg3; zEaves = arg4; zRidge = arg5;
    roofShape = typeof arg6 === 'string' ? arg6 : 'hipped';
    hasPitchedRoof = (zRidge > zEaves + 1e-4) && (roofShape !== 'flat');
    layerId = 4; tileId = typeof arg8 === 'number' ? arg8 : 0;
    bId = typeof arg9 === 'number' ? arg9 : -1; opts = arg10 || null;
  } else {
    outerInput = arg0; holesInput = arg1;
    zBase = arg2; zEaves = arg3; zRidge = arg4;
    hasPitchedRoof = arg5; layerId = arg6; bId = arg7;
    outTris = arg8; tileId = arg9 ?? 0;
    roofShape = arg10 ?? 'hipped'; opts = arg11 || null;
  }

  let outerClean = cleanPolygonRing(outerInput, true);
  if (outerClean.length < 3) return;

  let holesClean = (holesInput || [])
    .map(h => cleanPolygonRing(h, false))
    .filter(h => h.length >= 3);

  for (let h = 0; h < holesClean.length; h++) {
    const hole = holesClean[h];
    if (!hole.every(p => pointInPolyOrNear2D(p[0], p[1], outerClean, 1e-4))) {
      for (const amount of [0.015, 0.025, 0.04, 0.08]) {
        const hTry = insetPolygonCentroid(hole, amount);
        if (hTry.length >= 3 && hTry.every(p => pointInPoly2D(p[0], p[1], outerClean))) {
          holesClean[h] = hTry;
          break;
        }
      }
    }
  }

  const roofH = Math.max(0, zRidge - zEaves);
  const canPitch = hasPitchedRoof && roofH > 0.04 && outerClean.length >= 3;

  if (canPitch && holesClean.length === 0 && (roofShape === 'gabled' || roofShape === 'gambrel')) {
    if (tryEmitPlanarGabledBuilding(outerClean, zBase, zEaves, zRidge, roofShape, opts, layerId, bId, outTris, tileId)) {
      return;
    }
  }

  const rawOuterForSmooth = outerClean;
  const rawHolesForSmooth = holesClean;
  const isStar = holesClean.length === 0 && isStarShapedFromCentroid(outerClean);
  const isAnalyticCap = !canPitch ||
    roofShape === 'skillion' ||
    (isStar && (roofShape === 'pyramidal' || roofShape === 'cone' || roofShape === 'dome' || roofShape === 'onion')) ||
    (holesClean.length === 0 && roofShape === 'hipped' && (computeMinAreaOBB2D(outerClean)?.rectRatio ?? 0) >= 0.83);

  if (!isAnalyticCap) {
    outerClean = refinePolygonRingMaxEdge2D(outerClean, 0.46);
    holesClean = holesClean.map(h => refinePolygonRingMaxEdge2D(h, 0.46));
  }

  let ring = holesClean.length > 0 ? mergeHolesIntoOuterKeyhole(outerClean, holesClean) : outerClean;
  if (ring.length < 3) return;
  if (!isSimplePolygon(ring)) {
    ring = outerClean;
    if (!isSimplePolygon(ring)) return;
  }

  const actualHoles = (ring === outerClean) ? [] : holesClean;
  const roofTris = isAnalyticCap ? triangulateSimplePoly(ring) : triangulateCutLoopExact(ring);
  if (roofTris.length === 0) return;

  const zRoofSkillion = (canPitch && roofShape === 'skillion')
    ? computeSkillionRoofEvaluator(outerClean, actualHoles, zEaves, roofH, opts)
    : null;

  const emitWalls = (loopPts) => {
    for (let i = 0, n = loopPts.length; i < n; i++) {
      const p1 = loopPts[i], p2 = loopPts[(i + 1) % n];
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const z1 = zRoofSkillion ? zRoofSkillion(p1[0], p1[1]) : zEaves;
      const z2 = zRoofSkillion ? zRoofSkillion(p2[0], p2[1]) : zEaves;
      pushQuad(outTris, [p1[0], p1[1], zBase], [p2[0], p2[1], zBase], [p2[0], p2[1], z2], [p1[0], p1[1], z1], [dy / len, -dx / len, 0], layerId, bId, tileId);
    }
  };
  emitWalls(outerClean);
  for (let h = 0; h < actualHoles.length; h++) emitWalls(actualHoles[h]);

  for (let i = 0; i < roofTris.length; i++) {
    const [a, b, c] = roofTris[i];
    pushTri(outTris, [a[0], a[1], zBase], [c[0], c[1], zBase], [b[0], b[1], zBase], [0, 0, -1], layerId, bId, tileId);
  }

  // 3. Watertight Top Roof Cap at zEaves / zRidge
  if (zRoofSkillion) {
    for (let i = 0; i < roofTris.length; i++) {
      const [a, b, c] = roofTris[i];
      const A = [a[0], a[1], zRoofSkillion(a[0], a[1])];
      const B = [b[0], b[1], zRoofSkillion(b[0], b[1])];
      const C = [c[0], c[1], zRoofSkillion(c[0], c[1])];
      pushTri(outTris, A, B, C, computeFaceNormal(A, B, C), layerId, bId, tileId);
    }
    return;
  }

  if (canPitch && actualHoles.length === 0 && isStar &&
      (roofShape === 'pyramidal' || roofShape === 'cone' || roofShape === 'dome' || roofShape === 'onion')) {
    emitStarDomeOrConeCap(outerClean, zEaves, zRidge, roofShape, layerId, bId, outTris, tileId);
    return;
  }

  if (canPitch && actualHoles.length === 0 && roofShape !== 'mansard') {
    if (tryEmitPlanarHippedCap(outerClean, zEaves, zRidge, opts, layerId, bId, outTris, tileId)) {
      return;
    }
  }

  if (canPitch) {
    const evalEffDist = (x, y) => distToPolygonBoundary2D(x, y, outerClean, actualHoles);
    const wWing = computeCharacteristicWingHalfWidth2D(rawOuterForSmooth, actualHoles.length > 0 ? rawHolesForSmooth : []);

    const prelimZ = (pt) => zEaves + Math.min(1.0, evalEffDist(pt[0], pt[1]) / Math.max(0.1, wWing)) * Math.min(roofH, wWing * 0.85);
    let subTris = optimizeRoofTrisRidgeAligned(roofTris, outerClean, actualHoles, prelimZ, 4);
    subTris = subdivideInteriorRoofEdges(subTris, outerClean, actualHoles, 0.44, evalEffDist);
    subTris = optimizeRoofTrisRidgeAligned(subTris, outerClean, actualHoles, prelimZ, 3);
    subTris = subdivideInteriorRoofEdges(subTris, outerClean, actualHoles, 0.27, evalEffDist);

    let maxDist = 0;
    for (let i = 0; i < subTris.length; i++) {
      for (let j = 0; j < 3; j++) {
        const d = evalEffDist(subTris[i][j][0], subTris[i][j][1]);
        if (d > maxDist) maxDist = d;
      }
    }

    const wRidge = Math.max(0.06, Math.min(maxDist, wWing * 1.02));
    const effRoofH = Math.min(roofH, wRidge * 0.86);

    const getRoofZ = (pt) => {
      const d = evalEffDist(pt[0], pt[1]);
      if (d < 1e-4 || wRidge < 1e-4) return zEaves;
      if (roofShape === 'mansard') {
        const tMansard = Math.min(1.0, d / (wRidge * 0.58));
        return zEaves + tMansard * Math.min(effRoofH, wRidge * 0.62);
      }
      return zEaves + Math.min(1.0, d / wRidge) * effRoofH;
    };

    subTris = optimizeRoofTrisRidgeAligned(subTris, outerClean, actualHoles, getRoofZ, 6);

    for (let i = 0; i < subTris.length; i++) {
      const [a, b, c] = subTris[i];
      const A = [a[0], a[1], getRoofZ(a)], B = [b[0], b[1], getRoofZ(b)], C = [c[0], c[1], getRoofZ(c)];
      const n = computeFaceNormal(A, B, C);
      if (n[2] < 0) pushTri(outTris, A, C, B, [-n[0], -n[1], -n[2]], layerId, bId, tileId);
      else pushTri(outTris, A, B, C, n, layerId, bId, tileId);
    }
    return;
  }

  for (let i = 0; i < roofTris.length; i++) {
    const [a, b, c] = roofTris[i];
    pushTri(outTris, [a[0], a[1], zEaves], [b[0], b[1], zEaves], [c[0], c[1], zEaves], [0, 0, 1], layerId, bId, tileId);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    minTriAltitude2D,
    subdivideInteriorRoofEdges,
    optimizeRoofTrisRidgeAligned,
    extrudeBuildingLoD2
  };
}
