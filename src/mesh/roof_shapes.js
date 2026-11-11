// ============================================================================
// src/mesh/roof_shapes.js
// Analytic Watertight Architectural Roof Primitives:
// - Planar 2-Slope Gabled Roofs with Vertical Gable End-Walls
// - Planar 4-Slope Hipped Roofs
// - Central Pyramidal, Conical, Hemispherical Dome & Onion Church Caps
// - Direction / Lean-Target Skillion Evaluators
// ============================================================================

if (typeof triangulateCutLoopExact === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
  Object.assign(global, require('../geometry/obb_medial_2d.js'));
  Object.assign(global, require('./mesh_primitives.js'));
  Object.assign(global, require('./mesh_clipper_3d.js'));
}

// Razor-sharp 2-plane architectural Gabled roof with vertical gable end-walls
function tryEmitPlanarGabledBuilding(outerClean, zBase, zEaves, zRidge, roofShape, opts, layerId, bId, outTris, tileId) {
  const obb = computeMinAreaOBB2D(outerClean);
  if (!obb || obb.rectRatio < 0.78 || obb.halfW < 0.04) return false;

  let ux = obb.ux, uy = obb.uy, vx = obb.vx, vy = obb.vy;
  if (opts && opts.roofOrient === 'across') {
    ux = obb.vx; uy = obb.vy; vx = -obb.ux; vy = -obb.uy;
  } else if (opts && typeof opts.roofDir === 'number') {
    const rad = (opts.roofDir * Math.PI) / 180.0;
    const downX = Math.sin(rad), downY = Math.cos(rad);
    if (Math.abs(downX * obb.ux + downY * obb.uy) > Math.abs(downX * obb.vx + downY * obb.vy)) {
      ux = obb.vx; uy = obb.vy; vx = -obb.ux; vy = -obb.uy;
    }
  }

  const cx = obb.cx, cy = obb.cy;
  const vCoord = p => (p[0] - cx) * vx + (p[1] - cy) * vy;

  let maxAbsV = 0;
  for (let i = 0; i < outerClean.length; i++) {
    const av = Math.abs(vCoord(outerClean[i]));
    if (av > maxAbsV) maxAbsV = av;
  }
  if (maxAbsV < 0.04) return false;

  const gableRing = [];
  const ridgeIndices = [];
  const epsV = 1e-5;
  const n = outerClean.length;

  for (let i = 0; i < n; i++) {
    const a = outerClean[i], b = outerClean[(i + 1) % n];
    const va = vCoord(a), vb = vCoord(b);
    if (Math.abs(va) <= epsV) ridgeIndices.push(gableRing.length);
    gableRing.push([a[0], a[1]]);

    if ((va > epsV && vb < -epsV) || (va < -epsV && vb > epsV)) {
      const t = va / (va - vb);
      ridgeIndices.push(gableRing.length);
      gableRing.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }

  if (ridgeIndices.length !== 2) return false;
  const r0 = ridgeIndices[0], r1 = ridgeIndices[1];
  if (r1 - r0 < 1 || gableRing.length - (r1 - r0) < 1) return false;

  const P0 = gableRing[r0], P1 = gableRing[r1];
  if (Math.hypot(P1[0] - P0[0], P1[1] - P0[1]) < 0.04) return false;

  const midR = [(P0[0] + P1[0]) * 0.5, (P0[1] + P1[1]) * 0.5];
  if (!pointInPoly2D(midR[0], midR[1], gableRing)) return false;
  for (let i = 0, m = gableRing.length; i < m; i++) {
    if (i === r0 || (i + 1) % m === r0 || i === r1 || (i + 1) % m === r1) continue;
    if (segmentsIntersectProper(P0, P1, gableRing[i], gableRing[(i + 1) % m])) return false;
  }

  const half1 = gableRing.slice(r0, r1 + 1);
  const half2 = gableRing.slice(r1).concat(gableRing.slice(0, r0 + 1));
  if (half1.length < 3 || half2.length < 3) return false;

  const tris1 = triangulateCutLoopExact(half1);
  const tris2 = triangulateCutLoopExact(half2);
  const floorTris = triangulateCutLoopExact(gableRing);
  if (tris1.length === 0 || tris2.length === 0 || floorTris.length === 0) return false;

  const effRoofH = Math.min(zRidge - zEaves, maxAbsV * 0.92);
  const effRidge = zEaves + effRoofH;
  const zGable = (p) => {
    const tv = Math.min(1.0, Math.abs(vCoord(p)) / maxAbsV);
    return tv < 1e-5 ? effRidge : (zEaves + effRoofH * (1.0 - tv));
  };

  for (let i = 0, m = gableRing.length; i < m; i++) {
    const p1 = gableRing[i], p2 = gableRing[(i + 1) % m];
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    pushQuad(
      outTris,
      [p1[0], p1[1], zBase], [p2[0], p2[1], zBase],
      [p2[0], p2[1], zGable(p2)], [p1[0], p1[1], zGable(p1)],
      [dy / len, -dx / len, 0], layerId, bId, tileId
    );
  }

  for (let i = 0; i < floorTris.length; i++) {
    const [a, b, c] = floorTris[i];
    pushTri(outTris, [a[0], a[1], zBase], [c[0], c[1], zBase], [b[0], b[1], zBase], [0, 0, -1], layerId, bId, tileId);
  }

  for (const halfTris of [tris1, tris2]) {
    for (let i = 0; i < halfTris.length; i++) {
      const [a, b, c] = halfTris[i];
      const A = [a[0], a[1], zGable(a)], B = [b[0], b[1], zGable(b)], C = [c[0], c[1], zGable(c)];
      if (!isDegenerateTri3D(A, B, C)) {
        pushTri(outTris, A, B, C, computeFaceNormal(A, B, C), layerId, bId, tileId);
      }
    }
  }
  return true;
}

// Crisp 4-plane architectural Hipped roof cap for near-rectangular footprints
function tryEmitPlanarHippedCap(outerClean, zEaves, zRidge, opts, layerId, bId, outTris, tileId) {
  const obb = computeMinAreaOBB2D(outerClean);
  if (!obb || obb.rectRatio < 0.83 || obb.halfW < 0.04) return false;

  let ux = obb.ux, uy = obb.uy, vx = obb.vx, vy = obb.vy;
  let halfL = obb.halfL, halfW = obb.halfW;
  if (opts && opts.roofOrient === 'across') {
    ux = obb.vx; uy = obb.vy; vx = -obb.ux; vy = -obb.uy;
    halfL = obb.halfW; halfW = obb.halfL;
  }
  const cx = obb.cx, cy = obb.cy;
  const effRidge = zEaves + Math.min(zRidge - zEaves, Math.min(halfL, halfW) * 0.92);
  const ridgeHalfL = Math.max(0, halfL - halfW * 0.92);

  if (ridgeHalfL < halfW * 0.14) {
    if (!isStarShapedFromCentroid(outerClean)) return false;
    const apex = [cx, cy, effRidge];
    for (let i = 0, n = outerClean.length; i < n; i++) {
      const A = [outerClean[i][0], outerClean[i][1], zEaves];
      const B = [outerClean[(i + 1) % n][0], outerClean[(i + 1) % n][1], zEaves];
      pushTri(outTris, A, B, apex, computeFaceNormal(A, B, apex), layerId, bId, tileId);
    }
    return true;
  }

  const r0_2d = [cx - ux * ridgeHalfL, cy - uy * ridgeHalfL];
  const r1_2d = [cx + ux * ridgeHalfL, cy + uy * ridgeHalfL];
  const targets = [
    [cx - ux * halfL - vx * halfW, cy - uy * halfL - vy * halfW],
    [cx + ux * halfL - vx * halfW, cy + uy * halfL - vy * halfW],
    [cx + ux * halfL + vx * halfW, cy + uy * halfL + vy * halfW],
    [cx - ux * halfL + vx * halfW, cy - uy * halfL + vy * halfW]
  ];

  const n = outerClean.length;
  if (n < 4) return false;
  const corners = targets.map(([tx, ty]) => {
    let bestIdx = 0, bestDSq = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (outerClean[i][0] - tx) ** 2 + (outerClean[i][1] - ty) ** 2;
      if (d < bestDSq) { bestDSq = d; bestIdx = i; }
    }
    return bestIdx;
  });

  const [kMM, kPM, kPP, kMP] = corners;
  const cycDist = (a, b) => ((b - a) % n + n) % n;
  const d1 = cycDist(kMM, kPM), d2 = cycDist(kPM, kPP), d3 = cycDist(kPP, kMP), d4 = cycDist(kMP, kMM);
  if (d1 === 0 || d2 === 0 || d3 === 0 || d4 === 0 || d1 + d2 + d3 + d4 !== n) return false;

  const cross2D = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const candTris2D = [];

  candTris2D.push({ a: outerClean[kMM], b: r1_2d, c: r0_2d, za: zEaves, zb: effRidge, zc: effRidge });
  for (let s = 0; s < d1; s++) {
    const i = (kMM + s) % n, j = (i + 1) % n;
    candTris2D.push({ a: outerClean[i], b: outerClean[j], c: r1_2d, za: zEaves, zb: zEaves, zc: effRidge });
  }
  for (let s = 0; s < d2; s++) {
    const i = (kPM + s) % n, j = (i + 1) % n;
    candTris2D.push({ a: outerClean[i], b: outerClean[j], c: r1_2d, za: zEaves, zb: zEaves, zc: effRidge });
  }
  candTris2D.push({ a: outerClean[kPP], b: r0_2d, c: r1_2d, za: zEaves, zb: effRidge, zc: effRidge });
  for (let s = 0; s < d3; s++) {
    const i = (kPP + s) % n, j = (i + 1) % n;
    candTris2D.push({ a: outerClean[i], b: outerClean[j], c: r0_2d, za: zEaves, zb: zEaves, zc: effRidge });
  }
  for (let s = 0; s < d4; s++) {
    const i = (kMP + s) % n, j = (i + 1) % n;
    candTris2D.push({ a: outerClean[i], b: outerClean[j], c: r0_2d, za: zEaves, zb: zEaves, zc: effRidge });
  }

  for (let i = 0; i < candTris2D.length; i++) {
    const t = candTris2D[i];
    if (cross2D(t.a, t.b, t.c) <= 1e-6) return false;
  }

  for (let i = 0; i < candTris2D.length; i++) {
    const t = candTris2D[i];
    const A = [t.a[0], t.a[1], t.za], B = [t.b[0], t.b[1], t.zb], C = [t.c[0], t.c[1], t.zc];
    pushTri(outTris, A, B, C, computeFaceNormal(A, B, C), layerId, bId, tileId);
  }
  return true;
}

// Evaluates planar single-slope Skillion z(x,y), respecting S3DB roof:direction and adjacent core leanTargetPt
function computeSkillionRoofEvaluator(outerClean, actualHoles, zEaves, roofH, opts) {
  let upX = 0, upY = 1;
  if (opts && typeof opts.roofDir === 'number') {
    const rad = (opts.roofDir * Math.PI) / 180.0;
    upX = -Math.sin(rad); upY = -Math.cos(rad);
  } else {
    const obb = computeMinAreaOBB2D(outerClean);
    let maxEdgeLen = 0, bestEdge = [1, 0];
    for (let i = 0; i < outerClean.length; i++) {
      const p1 = outerClean[i], p2 = outerClean[(i + 1) % outerClean.length];
      const elen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (elen > maxEdgeLen) { maxEdgeLen = elen; bestEdge = [(p2[0] - p1[0]) / elen, (p2[1] - p1[1]) / elen]; }
    }
    upX = -bestEdge[1]; upY = bestEdge[0];
    if (opts && Array.isArray(opts.leanTargetPt) && obb) {
      const toX = opts.leanTargetPt[0] - obb.cx, toY = opts.leanTargetPt[1] - obb.cy;
      if (Math.hypot(toX, toY) > 1e-4) {
        let bestDot = -Infinity;
        for (const [cxA, cyA] of [[obb.vx, obb.vy], [-obb.vx, -obb.vy], [obb.ux, obb.uy], [-obb.ux, -obb.uy]]) {
          const d = cxA * toX + cyA * toY;
          if (d > bestDot) { bestDot = d; upX = cxA; upY = cyA; }
        }
      }
    }
  }
  let vMin = Infinity, vMax = -Infinity;
  for (const r of [outerClean, ...actualHoles]) {
    for (let i = 0; i < r.length; i++) {
      const vVal = r[i][0] * upX + r[i][1] * upY;
      if (vVal < vMin) vMin = vVal;
      if (vVal > vMax) vMax = vVal;
    }
  }
  const vSpan = vMax - vMin;
  const effSkillionH = Math.min(roofH, Math.max(0.12, vSpan * 0.65));
  return (x, y) => vSpan < 1e-4
    ? zEaves
    : (zEaves + Math.max(0, Math.min(1, ((x * upX + y * upY) - vMin) / vSpan)) * effSkillionH);
}

// Emits 5-band hemispherical dome / onion or central pyramidal / conical spire cap
function emitStarDomeOrConeCap(outerClean, zEaves, zRidge, roofShape, layerId, bId, outTris, tileId) {
  let cx = 0, cy = 0;
  const n = outerClean.length;
  for (let i = 0; i < n; i++) { cx += outerClean[i][0]; cy += outerClean[i][1]; }
  cx /= n; cy /= n;

  if (roofShape === 'pyramidal' || roofShape === 'cone') {
    const apex = [cx, cy, zRidge];
    for (let i = 0; i < n; i++) {
      const a = [outerClean[i][0], outerClean[i][1], zEaves];
      const b = [outerClean[(i + 1) % n][0], outerClean[(i + 1) % n][1], zEaves];
      pushTri(outTris, a, b, apex, computeFaceNormal(a, b, apex), layerId, bId, tileId);
    }
    return;
  }

  const roofH = Math.max(0, zRidge - zEaves);
  const profilePairs = (roofShape === 'onion')
    ? [[1.0, 0.0], [0.96, 0.24], [0.80, 0.50], [0.48, 0.74], [0.18, 0.90]]
    : [
        [1.0, 0.0],
        [Math.cos(Math.PI * 0.10), Math.sin(Math.PI * 0.10)],
        [Math.cos(Math.PI * 0.20), Math.sin(Math.PI * 0.20)],
        [Math.cos(Math.PI * 0.30), Math.sin(Math.PI * 0.30)],
        [Math.cos(Math.PI * 0.40), Math.sin(Math.PI * 0.40)]
      ];

  const bands = profilePairs.map(([rScale, hScale], idx) =>
    idx === 0
      ? outerClean.map(p => [p[0], p[1], zEaves])
      : outerClean.map(p => [cx + (p[0] - cx) * rScale, cy + (p[1] - cy) * rScale, zEaves + roofH * hScale])
  );
  const apex = [cx, cy, zRidge];

  for (let b = 0; b < bands.length - 1; b++) {
    const bLo = bands[b], bHi = bands[b + 1];
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      pushQuad(outTris, bLo[i], bLo[next], bHi[next], bHi[i], computeFaceNormal(bLo[i], bLo[next], bHi[next]), layerId, bId, tileId);
    }
  }
  const topBand = bands[bands.length - 1];
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    pushTri(outTris, topBand[i], topBand[next], apex, computeFaceNormal(topBand[i], topBand[next], apex), layerId, bId, tileId);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    tryEmitPlanarGabledBuilding,
    tryEmitPlanarHippedCap,
    computeSkillionRoofEvaluator,
    emitStarDomeOrConeCap
  };
}
