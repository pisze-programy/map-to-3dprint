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

  const effZEaves = Math.max(zBase + 0.20, zEaves);
  const effZRidge = Math.max(effZEaves, zRidge);
  zEaves = effZEaves;
  zRidge = effZRidge;

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
  const scaleMm = (opts && typeof opts.scaleMm === 'number') ? opts.scaleMm : 1.0;
  const canPitch = hasPitchedRoof && (roofH * scaleMm >= 0.15) && outerClean.length >= 3;

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

  // 2. Bottom Cap: Annular with Relief Chimney (Feature 20 / M6.3) or Flat Solid
  let activeChimney = null;
  const effScaleMm = (opts && typeof opts.scaleMm === 'number')
    ? opts.scaleMm
    : ((typeof state !== 'undefined' && state && state.bedSizeMm) ? (Math.max(state.bedSizeMm, state.totalHeightMm || state.bedSizeMm) / 169.2) : 1.0);

  if (opts && opts.reliefChimney) {
    const chim = opts.reliefChimney;
    if (chim && chim.chimneyPoly && Array.isArray(chim.chimneyPoly) && chim.chimneyPoly.length >= 3) {
      let chimCW = chim.chimneyPoly.map(p => [p[0], p[1]]);
      if (typeof signedArea2D === 'function' && signedArea2D(chimCW) > 0) chimCW.reverse();
      const zVaultApex = (typeof chim.zVaultApex === 'number') ? chim.zVaultApex : (effZEaves - 2.0 / effScaleMm);
      const zVaultBase = (typeof chim.zVaultBase === 'number') ? chim.zVaultBase : Math.max(zBase + 0.1, zVaultApex - 2.0);
      if (zVaultApex > zVaultBase && zVaultBase >= zBase) {
        activeChimney = { chimneyPoly: chimCW, zVaultBase, zVaultApex };
      }
    }
  } else {
    const isGround = (opts && opts.isGroundSeated !== undefined)
      ? opts.isGroundSeated
      : (opts && opts.supportRef ? false : true);

    let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
    for (let i = 0; i < outerClean.length; i++) {
      const p = outerClean[i];
      if (p[0] < bMinX) bMinX = p[0]; if (p[0] > bMaxX) bMaxX = p[0];
      if (p[1] < bMinY) bMinY = p[1]; if (p[1] > bMaxY) bMaxY = p[1];
    }
    const bMinSpan = Math.min(bMaxX - bMinX, bMaxY - bMinY);
    const bArea = Math.abs(signedArea2D(outerClean));
    const bHeight = Math.max(0, effZEaves - zBase);

    if (isGround && (bMinSpan * effScaleMm >= 6.5) && (bArea * effScaleMm * effScaleMm >= 35.0) && (bHeight * effScaleMm >= 5.5)) {
      const insetD = 2.0 / effScaleMm;
      if (typeof computeReliefChimneyPolygon === 'function') {
        const chimCW = computeReliefChimneyPolygon(outerClean, actualHoles, insetD);
        if (chimCW && chimCW.length >= 3) {
          const zVaultApex = effZEaves - 2.0 / effScaleMm;
          const chimOBB = typeof computeMinAreaOBB2D === 'function' ? computeMinAreaOBB2D(chimCW) : null;
          const inRadius = chimOBB ? chimOBB.halfW : (bMinSpan * 0.25);
          let hVault = Math.max(0.4 / effScaleMm, inRadius);
          if (hVault > (zVaultApex - zBase) * 0.65) hVault = (zVaultApex - zBase) * 0.5;
          const zVaultBase = zVaultApex - hVault;
          if (zVaultBase >= zBase + 0.5 / effScaleMm) {
            activeChimney = { chimneyPoly: chimCW, zVaultBase, zVaultApex };
          }
        }
      }
    }
  }

  let validChimney = null;
  if (activeChimney && activeChimney.chimneyPoly && Array.isArray(activeChimney.chimneyPoly) && activeChimney.chimneyPoly.length >= 3) {
    let chimCW = cleanPolygonRing(activeChimney.chimneyPoly, false);
    const zVBase = activeChimney.zVaultBase;
    const zVApex = activeChimney.zVaultApex;
    if (chimCW.length >= 3 &&
        typeof zVBase === 'number' && typeof zVApex === 'number' &&
        zVBase > zBase + 1e-3 && zVApex > zVBase + 1e-3 && zVApex < zEaves - 1e-3 &&
        Math.abs(signedArea2D(chimCW)) >= 1e-3 &&
        isSimplePolygon(chimCW)) {
      const minClearance = 0.02;
      let clearanceOk = true;
      for (let i = 0; i < chimCW.length && clearanceOk; i++) {
        const p1 = chimCW[i], p2 = chimCW[(i + 1) % chimCW.length];
        const mx = 0.5 * (p1[0] + p2[0]), my = 0.5 * (p1[1] + p2[1]);
        if (!pointInPoly2D(p1[0], p1[1], outerClean) || !pointInPoly2D(mx, my, outerClean) ||
            distToPolygonBoundary2D(p1[0], p1[1], outerClean, actualHoles) < minClearance ||
            distToPolygonBoundary2D(mx, my, outerClean, actualHoles) < minClearance) {
          clearanceOk = false;
          break;
        }
        for (let h = 0; h < actualHoles.length; h++) {
          if (pointInPolyOrNear2D(p1[0], p1[1], actualHoles[h], minClearance) ||
              pointInPolyOrNear2D(mx, my, actualHoles[h], minClearance)) {
            clearanceOk = false;
            break;
          }
        }
      }
      if (clearanceOk) {
        const checkRingClearOfChimney = (ringPts) => {
          for (let i = 0; i < ringPts.length; i++) {
            const v = ringPts[i];
            if (pointInPolyOrNear2D(v[0], v[1], chimCW, minClearance) ||
                distToPolygonBoundary2D(v[0], v[1], chimCW, []) < minClearance) {
              return false;
            }
          }
          for (let i = 0; i < ringPts.length; i++) {
            const a = ringPts[i], b = ringPts[(i + 1) % ringPts.length];
            for (let j = 0; j < chimCW.length; j++) {
              if (segmentsIntersectProper(a, b, chimCW[j], chimCW[(j + 1) % chimCW.length])) return false;
            }
          }
          return true;
        };
        if (!checkRingClearOfChimney(outerClean)) clearanceOk = false;
        for (let h = 0; h < actualHoles.length && clearanceOk; h++) {
          if (!checkRingClearOfChimney(actualHoles[h])) clearanceOk = false;
        }
      }
      let ccx = 0, ccy = 0;
      if (clearanceOk) {
        for (let i = 0; i < chimCW.length; i++) { ccx += chimCW[i][0]; ccy += chimCW[i][1]; }
        ccx /= chimCW.length; ccy /= chimCW.length;
        for (let i = 0; i < chimCW.length; i++) {
          const p1 = chimCW[i], p2 = chimCW[(i + 1) % chimCW.length];
          if ((p2[0] - p1[0]) * (ccy - p1[1]) - (p2[1] - p1[1]) * (ccx - p1[0]) >= -1e-5) {
            clearanceOk = false;
            break;
          }
        }
      }
      if (clearanceOk) {
        const botHoles = [...actualHoles, chimCW];
        const mergedBotHoles = [];
        const botRing = mergeHolesIntoOuterKeyhole(outerClean, botHoles, mergedBotHoles);
        if (mergedBotHoles.length === botHoles.length && botRing.length >= 3 && isSimplePolygon(botRing)) {
          const botTris = (typeof triangulateCutLoopExact === 'function')
            ? triangulateCutLoopExact(botRing)
            : triangulateSimplePoly(botRing);
          if (botTris && botTris.length >= 3) {
            // Verify exact 5000-grid & mm-weld 2-manifold edge pairing at zBase before committing chimney
            const q5k = (pt) => (Math.round(pt[0] * 5000) + 2097152) * 4194304 + (Math.round(pt[1] * 5000) + 2097152);
            const q5Apex = q5k([ccx, ccy]);
            const chimQ5Set = new Set();
            let topoOk = true;
            for (let i = 0; i < chimCW.length; i++) {
              const qv = q5k(chimCW[i]);
              if (chimQ5Set.has(qv) || qv === q5Apex) { topoOk = false; break; }
              chimQ5Set.add(qv);
            }
            const heMap = new Map();
            const addHe = (u, v) => {
              if (u === v) return false;
              const k = u + '_' + v;
              if (heMap.has(k)) return false;
              heMap.set(k, [u, v]);
              return true;
            };
            const addLoopWallHe = (loopPts) => {
              for (let i = 0, n = loopPts.length; i < n; i++) {
                const p1 = loopPts[i], p2 = loopPts[(i + 1) % n];
                if (Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) < 1e-6) continue;
                if (!addHe(q5k(p1), q5k(p2))) return false;
              }
              return true;
            };
            if (topoOk && (!addLoopWallHe(outerClean) || !addLoopWallHe(chimCW))) topoOk = false;
            for (let h = 0; h < actualHoles.length && topoOk; h++) {
              if (!addLoopWallHe(actualHoles[h])) topoOk = false;
            }
            for (let i = 0; i < botTris.length && topoOk; i++) {
              const [a, b, c] = botTris[i];
              const qa = q5k(a), qb = q5k(b), qc = q5k(c);
              if (qa === qb || qb === qc || qa === qc ||
                  !addHe(qa, qc) || !addHe(qc, qb) || !addHe(qb, qa)) {
                topoOk = false;
                break;
              }
            }
            if (topoOk) {
              for (const [, [u, v]] of heMap) {
                if (!heMap.has(v + '_' + u)) { topoOk = false; break; }
              }
            }
            if (topoOk) {
              validChimney = { chimCW, zVBase, zVApex, ccx, ccy, botTris };
            }
          }
        }
      }
    }
  }

  if (validChimney) {
    const { chimCW, zVBase, zVApex, ccx, ccy, botTris } = validChimney;
    for (let i = 0; i < botTris.length; i++) {
      const [a, b, c] = botTris[i];
      pushTri(outTris, [a[0], a[1], zBase], [c[0], c[1], zBase], [b[0], b[1], zBase], [0, 0, -1], layerId, bId, tileId);
    }

    for (let i = 0; i < chimCW.length; i++) {
      const p1 = chimCW[i], p2 = chimCW[(i + 1) % chimCW.length];
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1], len = Math.hypot(dx, dy) || 1e-6;
      pushQuad(outTris, [p1[0], p1[1], zBase], [p2[0], p2[1], zBase], [p2[0], p2[1], zVBase], [p1[0], p1[1], zVBase], [dy / len, -dx / len, 0], layerId, bId, tileId);
    }

    const apex = [ccx, ccy, zVApex];
    for (let i = 0; i < chimCW.length; i++) {
      const p1 = chimCW[i], p2 = chimCW[(i + 1) % chimCW.length];
      const A = [p1[0], p1[1], zVBase], B = [p2[0], p2[1], zVBase];
      pushTri(outTris, A, B, apex, computeFaceNormal(A, B, apex), layerId, bId, tileId);
    }
  } else {
    for (let i = 0; i < roofTris.length; i++) {
      const [a, b, c] = roofTris[i];
      pushTri(outTris, [a[0], a[1], zBase], [c[0], c[1], zBase], [b[0], b[1], zBase], [0, 0, -1], layerId, bId, tileId);
    }
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

/**
 * Emits a strictly watertight, positive-volume closed convex hexahedron given 8 vertices:
 * bottom loop [b00, b10, b11, b01], top loop [t00, t10, t11, t01].
 * Automatically ensures right-handed outward normals.
 */
function emitOrientedHexahedron3D(verts8, layerId, bId, shellId, tileId, outTris) {
  let [b00, b10, b11, b01, t00, t10, t11, t01] = verts8;
  const rx = b10[0] - b00[0], ry = b10[1] - b00[1], rz = b10[2] - b00[2];
  const sx = b01[0] - b00[0], sy = b01[1] - b00[1], sz = b01[2] - b00[2];
  const tx = t00[0] - b00[0], ty = t00[1] - b00[1], tz = t00[2] - b00[2];
  const det = rx * (sy * tz - sz * ty) - ry * (sx * tz - sz * tx) + rz * (sx * ty - sy * tx);
  if (Math.abs(det) < 1e-10) return;
  if (det < 0) {
    [b10, b01] = [b01, b10];
    [t10, t01] = [t01, t10];
  }
  const emitFace = (p0, p1, p2, p3) => {
    const n = computeFaceNormal(p0, p1, p2);
    pushQuad(outTris, p0, p1, p2, p3, n, layerId, bId, tileId);
    const len = outTris.length;
    outTris[len - 2].shellId = shellId;
    outTris[len - 1].shellId = shellId;
  };
  emitFace(b00, b01, b11, b10); // bottom (-t)
  emitFace(t00, t10, t11, t01); // top (+t)
  emitFace(b00, b10, t10, t00); // front (-s)
  emitFace(b10, b11, t11, t10); // right (+r)
  emitFace(b11, b01, t01, t11); // back (+s)
  emitFace(b01, b00, t00, t01); // left (-r)
}

/**
 * Procedurally constructs a watertight 2-manifold 3D Ferris / Observation Wheel
 * (Ain Dubai, London Eye, Singapore Flyer, Wiener Riesenrad) oriented along the
 * footprint's major OBB axis and seated flush on the terrain bed.
 * Returns an array of independent sub-shells `[{ shellId, tris }]` so multi-tile
 * clipping keeps every component strictly manifold.
 */
function emitFerrisWheel3D(item, ctx, targetLayerId, allocShellId) {
  const poly = item.clippedOuter;
  const obb = (typeof computeMinAreaOBB2D === 'function' ? computeMinAreaOBB2D(poly) : null) || {
    cx: item.cx, cy: item.cy, ux: 1, uy: 0, vx: 0, vy: 1,
    halfL: Math.max(1.0, (item.maxX - item.minX) * 0.5),
    halfW: Math.max(0.5, (item.maxY - item.minY) * 0.5)
  };
  let { cx, cy, ux, uy, vx, vy, halfL } = obb;
  if (ux * vy - uy * vx < 0) {
    vx = -vx;
    vy = -vy;
  }

  const scaleMm = Math.max(0.35, (ctx && ctx.scaleMm) || 1.0);
  const mmToU = mm => mm / scaleMm;
  const zScale = Math.max(0.6, (ctx && ctx.zScale) || 1.0);
  const zBase = item.effBaseZ;
  const rawTotalH = Math.max(mmToU(8.0), item.zTop - zBase);
  const unscaledTotalH = rawTotalH / zScale;

  // Decouple rim proportions from OBB halfW and compute circular radius fit inside both halfL and scene height
  const rEst = Math.max(mmToU(3.5), Math.min(halfL * 0.96, unscaledTotalH * 0.46, (rawTotalH - mmToU(1.2)) * 0.46));
  const clearance = Math.max(mmToU(0.65), rEst * 0.09);
  const rCapPodRaw = Math.min(rEst * 0.032, Math.max(mmToU(0.28), rEst * 0.025));
  const R = Math.max(
    mmToU(3.5),
    Math.min(halfL * 0.96, unscaledTotalH * 0.46, (rawTotalH - clearance - rCapPodRaw * 1.4) * 0.5)
  );
  const zHub = zBase + clearance + R;

  // Sleek architectural rim, hub, spokes, A-frame legs, flush capsules & compact base pad
  const tRim = Math.min(R * 0.10, Math.max(mmToU(0.65), R * 0.050));
  const wRim = Math.min(R * 0.11, Math.max(mmToU(0.70), R * 0.056));
  const rCapPod = Math.min(R * 0.032, Math.max(mmToU(0.28), tRim * 0.45));
  const capHalfAx = Math.min(wRim * 0.46, Math.max(mmToU(0.28), wRim * 0.44));

  const legThick = Math.min(R * 0.052, Math.max(mmToU(0.56), R * 0.040));
  const legVOffset = wRim * 0.5 + legThick * 0.62;
  const legSpreadV = Math.max(wRim * 0.85, legVOffset + legThick * 0.58);
  const legSpreadU = Math.min(halfL * 0.52, R * 0.34);

  const plinthH = Math.min(R * 0.036, Math.max(mmToU(0.45), R * 0.024));
  const plinthU = Math.min(Math.max(legSpreadU + legThick * 0.9, mmToU(1.4)), R * 0.46);
  const plinthV = Math.min(Math.max(legSpreadV + legThick * 0.4, mmToU(1.2)), R * 0.20);

  const layerId = targetLayerId;
  const bId = item.pickId;
  const fix = n => (Math.abs(n) < 1e-8 ? 0 : n);
  const toWorld = (u, v, z) => [fix(cx + ux * u + vx * v), fix(cy + uy * u + vy * v), fix(z)];
  const subShells = [];
  const nextShell = () => (typeof allocShellId === 'function' ? allocShellId() : -1);

  const emitBoxUVZ = (u0, u1, v0, v1, z0, z1) => {
    const sid = nextShell();
    const tris = [];
    emitOrientedHexahedron3D([
      toWorld(u0, v0, z0), toWorld(u1, v0, z0), toWorld(u1, v1, z0), toWorld(u0, v1, z0),
      toWorld(u0, v0, z1), toWorld(u1, v0, z1), toWorld(u1, v1, z1), toWorld(u0, v1, z1)
    ], layerId, bId, sid, 0, tris);
    if (tris.length > 0) subShells.push({ shellId: sid, tris });
  };

  // Watertight capped cylinder oriented along axle direction v in right-handed (u, v, z) space
  const emitCylinderAlongV = (uCtr, zCtr, radius, v0, v1, segs) => {
    const sid = nextShell();
    const tris = [];
    const ring0 = [];
    const ring1 = [];
    for (let i = 0; i < segs; i++) {
      const th = (2 * Math.PI * i) / segs;
      const du = radius * Math.cos(th);
      const dz = radius * Math.sin(th);
      ring0.push(toWorld(uCtr + du, v0, zCtr + dz));
      ring1.push(toWorld(uCtr + du, v1, zCtr + dz));
    }
    const c0 = toWorld(uCtr, v0, zCtr);
    const c1 = toWorld(uCtr, v1, zCtr);
    const stampLast = count => {
      for (let k = tris.length - count; k < tris.length; k++) tris[k].shellId = sid;
    };
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      const nSide = computeFaceNormal(ring1[i], ring1[j], ring0[j]);
      pushQuad(tris, ring1[i], ring1[j], ring0[j], ring0[i], nSide, layerId, bId, 0);
      stampLast(2);
      const nCap0 = computeFaceNormal(c0, ring0[i], ring0[j]);
      pushTri(tris, c0, ring0[i], ring0[j], nCap0, layerId, bId, 0);
      stampLast(1);
      const nCap1 = computeFaceNormal(c1, ring1[j], ring1[i]);
      pushTri(tris, c1, ring1[j], ring1[i], nCap1, layerId, bId, 0);
      stampLast(1);
    }
    if (tris.length > 0) subShells.push({ shellId: sid, tris });
  };

  // 1. Compact Grounded Base Pad (low-profile anchor on terrain)
  emitBoxUVZ(-plinthU, plinthU, -plinthV, plinthV, zBase, zBase + plinthH);

  // 2. Cylindrical Horizontal Central Axle Hub
  const rHub = Math.min(R * 0.088, Math.max(mmToU(0.52), tRim * 0.92));
  const wAxle = Math.max(legVOffset + legThick * 0.62, wRim * 0.72);
  emitCylinderAlongV(0, zHub, rHub, -wAxle, wAxle, 16);

  // 3. Four Sleek Inclined A-Frame Support Legs (embedded into base pad and hub)
  const legZ0 = zBase + plinthH * 0.35;
  const legZ1 = zHub + rHub * 0.42;
  for (const sV of [-1, 1]) {
    for (const sU of [-1, 1]) {
      const sid = nextShell();
      const tris = [];
      const uBot = sU * legSpreadU;
      const vCtr = sV * legVOffset;
      const halfLU = legThick * 0.56;
      const halfLV = legThick * 0.50;
      emitOrientedHexahedron3D([
        toWorld(uBot - halfLU, vCtr - halfLV, legZ0),
        toWorld(uBot + halfLU, vCtr - halfLV, legZ0),
        toWorld(uBot + halfLU, vCtr + halfLV, legZ0),
        toWorld(uBot - halfLU, vCtr + halfLV, legZ0),
        toWorld(-halfLU * 0.80, vCtr - halfLV, legZ1),
        toWorld(halfLU * 0.80, vCtr - halfLV, legZ1),
        toWorld(halfLU * 0.80, vCtr + halfLV, legZ1),
        toWorld(-halfLU * 0.80, vCtr + halfLV, legZ1)
      ], layerId, bId, sid, 0, tris);
      if (tris.length > 0) subShells.push({ shellId: sid, tris });
    }
  }

  // 4. Hollow 48-Segment Genus-1 Tubular Rim Ring
  {
    const rimSid = nextShell();
    const rimTris = [];
    const N = 48;
    const Ri = R - tRim;
    const hw = wRim * 0.5;
    const outNeg = [], outPos = [], inNeg = [], inPos = [];
    for (let i = 0; i < N; i++) {
      const th = (2 * Math.PI * i) / N;
      const ct = Math.cos(th), st = Math.sin(th);
      outNeg.push(toWorld(R * ct, -hw, zHub + R * st));
      outPos.push(toWorld(R * ct, hw, zHub + R * st));
      inNeg.push(toWorld(Ri * ct, -hw, zHub + Ri * st));
      inPos.push(toWorld(Ri * ct, hw, zHub + Ri * st));
    }
    const pushRimQ = (a, b, c, d) => {
      const n = computeFaceNormal(a, b, c);
      pushQuad(rimTris, a, b, c, d, n, layerId, bId, 0);
      const len = rimTris.length;
      rimTris[len - 2].shellId = rimSid;
      rimTris[len - 1].shellId = rimSid;
    };
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      pushRimQ(outPos[i], outPos[j], outNeg[j], outNeg[i]); // Outer cylinder (+radial)
      pushRimQ(inNeg[i], inNeg[j], inPos[j], inPos[i]);     // Inner bore (-radial)
      pushRimQ(inPos[i], inPos[j], outPos[j], outPos[i]);  // +v annular ring
      pushRimQ(outNeg[i], outNeg[j], inNeg[j], inNeg[i]);  // -v annular ring
    }
    if (rimTris.length > 0) subShells.push({ shellId: rimSid, tris: rimTris });
  }

  // 5. Slender Radial Spokes from Cylindrical Hub to Inner Rim
  const nSpokes = R >= mmToU(5.5) ? 16 : 12;
  const spHalfW = Math.min(R * 0.016, Math.max(mmToU(0.24), R * 0.011));
  const spHalfV = Math.min(wRim * 0.32, Math.max(mmToU(0.24), wRim * 0.24));
  const rSp0 = rHub * 0.55;
  const rSp1 = R - tRim * 0.45;
  for (let k = 0; k < nSpokes; k++) {
    const th = (2 * Math.PI * k) / nSpokes;
    const ct = Math.cos(th), st = Math.sin(th);
    const tu = -st * spHalfW, tz = ct * spHalfW;
    const sid = nextShell();
    const tris = [];
    const u0 = rSp0 * ct, z0 = zHub + rSp0 * st;
    const u1 = rSp1 * ct, z1 = zHub + rSp1 * st;
    emitOrientedHexahedron3D([
      toWorld(u0 - tu, -spHalfV, z0 - tz),
      toWorld(u1 - tu, -spHalfV, z1 - tz),
      toWorld(u1 + tu, -spHalfV, z1 + tz),
      toWorld(u0 + tu, -spHalfV, z0 + tz),
      toWorld(u0 - tu, spHalfV, z0 - tz),
      toWorld(u1 - tu, spHalfV, z1 - tz),
      toWorld(u1 + tu, spHalfV, z1 + tz),
      toWorld(u0 + tu, spHalfV, z0 + tz)
    ], layerId, bId, sid, 0, tris);
    if (tris.length > 0) subShells.push({ shellId: sid, tris });
  }

  // 6. Flush Cylindrical Observation Capsules Around the Outer Rim
  const nCaps = R >= mmToU(5.5) ? 24 : 16;
  const rCapCenter = R + rCapPod * 0.35;
  for (let c = 0; c < nCaps; c++) {
    const th = (2 * Math.PI * c) / nCaps + (Math.PI / nCaps);
    const uCap = rCapCenter * Math.cos(th);
    const zCap = zHub + rCapCenter * Math.sin(th);
    emitCylinderAlongV(uCap, zCap, rCapPod, -capHalfAx, capHalfAx, 8);
  }

  return subShells;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    minTriAltitude2D,
    subdivideInteriorRoofEdges,
    optimizeRoofTrisRidgeAligned,
    extrudeBuildingLoD2,
    emitOrientedHexahedron3D,
    emitFerrisWheel3D
  };
}
