// ============================================================================
// src/mesh/features_bridges.js
// Bank-Anchored 3D Bridges (OSM man_made=bridge Polygons + Chained Linear Spans,
// Flush Bank Abutments & Water Piers — Each Clipped as an Independent 2-Manifold Shell)
// ============================================================================

if (typeof appendShellClippedToTiles === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
  Object.assign(global, require('../geometry/obb_medial_2d.js'));
  Object.assign(global, require('./mesh_primitives.js'));
  Object.assign(global, require('./mesh_clipper_3d.js'));
  Object.assign(global, require('./features_roads_parks.js'));
}

function buildBankAnchoredBridges(scene, ctx, baseInfo, state, meshes, allocShellId) {
  const roadsVisible = !state.layerVisible || state.layerVisible.roads !== false;
  if (!roadsVisible) return;

  const greenVisible = !state.layerVisible || state.layerVisible.greenery !== false;
  const {
    scaleMm, halfW, halfH, scaleToBed,
    toBed, sampleMaskIdx, sampleBilinearMask,
    waterSDF, greenMask,
    baseBottomZ, gHeight, rHeight, brHeight,
    quantizeZUnits, sampleRawTerrainGridZ
  } = ctx;
  const { waterSurfZ, getActualPrintedSurfaceMinZ } = baseInfo;

  const pierSpacingUnits = Math.max(1.85, 4.6 / scaleMm);
  const emittedBridgePolys = [];

  const isPrintedDryPoint = (bx, by) => {
    if (Math.abs(bx) > halfW - 0.26 || Math.abs(by) > halfH - 0.26) return false;
    return getActualPrintedSurfaceMinZ(bx, by) >= baseBottomZ - 1e-4 &&
           getActualPrintedSurfaceMinZ(bx - 0.16, by) >= baseBottomZ - 1e-4 &&
           getActualPrintedSurfaceMinZ(bx + 0.16, by) >= baseBottomZ - 1e-4 &&
           getActualPrintedSurfaceMinZ(bx, by - 0.16) >= baseBottomZ - 1e-4 &&
           getActualPrintedSurfaceMinZ(bx, by + 0.16) >= baseBottomZ - 1e-4;
  };

  const isSpanEndAnchored = (cx, cy, latVx, latVy, latHalfW) => {
    if (!isPrintedDryPoint(cx, cy)) return false;
    const r = Math.min(latHalfW * 0.88, 2.2);
    return isPrintedDryPoint(cx - latVx * r, cy - latVy * r) &&
           isPrintedDryPoint(cx + latVx * r, cy + latVy * r);
  };

  const evalBankSurfaceZ = (bx, by) => {
    const baseZ = Math.max(baseBottomZ, getActualPrintedSurfaceMinZ(bx, by));
    if (greenVisible && greenMask[sampleMaskIdx(bx, by)] === 1) return baseZ + gHeight;
    return baseZ;
  };

  // Emits each water pier (or twin piers on wide boulevards) as independent watertight 2-manifold shells!
  const emitPiersAlongSpan = (ax, ay, bx, by, deckWidth, zDeckBot, containPoly = null) => {
    const spanLen = Math.hypot(bx - ax, by - ay);
    if (spanLen < pierSpacingUnits * 0.65 || zDeckBot - waterSurfZ <= 0.12) return;
    const tx = (bx - ax) / spanLen, ty = (by - ay) / spanLen;
    const nx = -ty, ny = tx;
    const numPiers = Math.max(1, Math.ceil(spanLen / pierSpacingUnits) - 1);
    const twinCols = (deckWidth * scaleMm > 7.5);
    const latOffsets = twinCols ? [-deckWidth * 0.26, deckWidth * 0.26] : [0.0];
    const pW = twinCols
      ? Math.max(0.48, deckWidth * 0.28)
      : Math.min(deckWidth * 0.72, Math.max(0.55, deckWidth * 0.62));
    const pT = Math.max(0.45, 0.95 / scaleMm);

    for (let p = 1; p <= numPiers; p++) {
      const frac = p / (numPiers + 1);
      const baseMx = ax + (bx - ax) * frac;
      const baseMy = ay + (by - ay) * frac;
      for (let li = 0; li < latOffsets.length; li++) {
        const mx = baseMx + nx * latOffsets[li];
        const my = baseMy + ny * latOffsets[li];
        if (containPoly && !pointInPoly2D(mx, my, containPoly)) continue;
        const corners = [
          [mx - nx * (pW * 0.5) - tx * (pT * 0.5), my - ny * (pW * 0.5) - ty * (pT * 0.5)],
          [mx + nx * (pW * 0.5) - tx * (pT * 0.5), my + ny * (pW * 0.5) - ty * (pT * 0.5)],
          [mx + nx * (pW * 0.5) + tx * (pT * 0.5), my + ny * (pW * 0.5) + ty * (pT * 0.5)],
          [mx - nx * (pW * 0.5) + tx * (pT * 0.5), my - ny * (pW * 0.5) + ty * (pT * 0.5)]
        ];
        const allInWater = getActualPrintedSurfaceMinZ(mx, my) < baseBottomZ - 1e-4 &&
                           corners.every(c => getActualPrintedSurfaceMinZ(c[0], c[1]) < baseBottomZ - 1e-4);
        if (allInWater) {
          const pierShell = [];
          emitClosedPrism(corners, waterSurfZ, zDeckBot, 3, pierShell, 0, allocShellId());
          appendShellClippedToTiles(pierShell, ctx, meshes.roads);
        }
      }
    }
  };

  const computeDeckZBounds = (polyPts) => {
    let zLandMin = Infinity, zLandMax = baseBottomZ;
    for (let i = 0; i < polyPts.length; i++) {
      const p0 = polyPts[i], p1 = polyPts[(i + 1) % polyPts.length];
      for (const q of [p0, [(p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5]]) {
        const sz = getActualPrintedSurfaceMinZ(q[0], q[1]);
        if (sz >= baseBottomZ - 1e-4) {
          if (sz < zLandMin) zLandMin = sz;
          const ez = evalBankSurfaceZ(q[0], q[1]);
          if (ez > zLandMax) zLandMax = ez;
        }
      }
    }
    if (!Number.isFinite(zLandMin)) zLandMin = baseBottomZ;
    return { zLandMin, zLandMax };
  };

  // 1. Exact OSM man_made=bridge Polygons (Wehrsteg, Ludwigsbrücke, Maximiliansbrücke, etc.)
  (scene.bridgePolys || []).forEach((bp, bpIdx) => {
    if (!bp || !bp.outer || bp.outer.length < 3) return;
    let poly = cleanPolygonRing(clipPolyToBox(bp.outer.map(toBed), -halfW + 0.25, -halfH + 0.25, halfW - 0.25, halfH - 0.25), true);
    if (poly.length < 3 || Math.abs(signedArea2D(poly)) < 0.04) return;

    const obb = computeMinAreaOBB2D(poly);
    if (!obb || obb.halfW < 0.08) return;

    const scoreAxis = (ux, uy, halfLen) => {
      const sNeg = sampleBilinearMask(waterSDF, obb.cx - ux * (halfLen + 0.9), obb.cy - uy * (halfLen + 0.9));
      const sPos = sampleBilinearMask(waterSDF, obb.cx + ux * (halfLen + 0.9), obb.cy + uy * (halfLen + 0.9));
      const sMid = sampleBilinearMask(waterSDF, obb.cx, obb.cy);
      return (sNeg + sPos) - 2.0 * sMid;
    };
    const useU = scoreAxis(obb.ux, obb.uy, obb.halfL) >= scoreAxis(obb.vx, obb.vy, obb.halfW);
    const sUx = useU ? obb.ux : obb.vx;
    const sUy = useU ? obb.uy : obb.vy;
    const cVx = useU ? obb.vx : -obb.ux;
    const cVy = useU ? obb.vy : -obb.uy;
    const sHalfL = useU ? obb.halfL : obb.halfW;
    const cHalfW = useU ? obb.halfW : obb.halfL;

    let touchesWater = false;
    for (let t = -0.9; t <= 0.91 && !touchesWater; t += 0.18) {
      const sx = obb.cx + sUx * (sHalfL * t), sy = obb.cy + sUy * (sHalfL * t);
      if (getActualPrintedSurfaceMinZ(sx, sy) < baseBottomZ - 1e-4 || sampleBilinearMask(waterSDF, sx, sy) < 0.06) {
        touchesWater = true;
      }
    }
    if (!touchesWater) {
      touchesWater = poly.some(pt => getActualPrintedSurfaceMinZ(pt[0], pt[1]) < baseBottomZ - 1e-4);
    }
    if (!touchesWater) return;

    // Extend axial bridge ends up to 6.5 units until BOTH lateral corners rest firmly on printed dry land!
    const findLandExt = (dirSign) => {
      const baseX = obb.cx + sUx * (dirSign * sHalfL);
      const baseY = obb.cy + sUy * (dirSign * sHalfL);
      if (isSpanEndAnchored(baseX, baseY, cVx, cVy, cHalfW)) return 0.30;
      let centerHitD = -1.0;
      for (let d = 0.25; d <= 6.50; d += 0.25) {
        const tx = baseX + sUx * (dirSign * d);
        const ty = baseY + sUy * (dirSign * d);
        if (Math.abs(tx) > halfW - 0.3 || Math.abs(ty) > halfH - 0.3) {
          return centerHitD >= 0 ? centerHitD + 0.25 : -1.0;
        }
        if (centerHitD < 0 && isPrintedDryPoint(tx, ty)) centerHitD = d;
        if (isSpanEndAnchored(tx, ty, cVx, cVy, cHalfW)) return d + 0.35;
      }
      return centerHitD >= 0 ? centerHitD + 0.45 : -1.0;
    };
    const extNeg = findLandExt(-1);
    const extPos = findLandExt(+1);
    if (extNeg < 0 || extPos < 0) return;

    const effNeg = Math.max(0, extNeg);
    const effPos = Math.max(0, extPos);
    const extendedPoly = poly.map(pt => {
      const s = (pt[0] - obb.cx) * sUx + (pt[1] - obb.cy) * sUy;
      if (s < -sHalfL * 0.35 && effNeg > 0) {
        const w = Math.min(1.0, (-s - sHalfL * 0.35) / Math.max(0.15, sHalfL * 0.65));
        return [
          Math.max(-halfW + 0.25, Math.min(halfW - 0.25, pt[0] - sUx * effNeg * w)),
          Math.max(-halfH + 0.25, Math.min(halfH - 0.25, pt[1] - sUy * effNeg * w))
        ];
      }
      if (s > sHalfL * 0.35 && effPos > 0) {
        const w = Math.min(1.0, (s - sHalfL * 0.35) / Math.max(0.15, sHalfL * 0.65));
        return [
          Math.max(-halfW + 0.25, Math.min(halfW - 0.25, pt[0] + sUx * effPos * w)),
          Math.max(-halfH + 0.25, Math.min(halfH - 0.25, pt[1] + sUy * effPos * w))
        ];
      }
      return pt;
    });
    const finalPoly = cleanPolygonRing(extendedPoly, true);
    if (finalPoly.length >= 3 && isSimplePolygon(finalPoly)) poly = finalPoly;

    const endNegPt = [obb.cx - sUx * (sHalfL + effNeg * 0.85), obb.cy - sUy * (sHalfL + effNeg * 0.85)];
    const endPosPt = [obb.cx + sUx * (sHalfL + effPos * 0.85), obb.cy + sUy * (sHalfL + effPos * 0.85)];
    const { zLandMin, zLandMax } = computeDeckZBounds(poly);

    const zDeckBot = zLandMin;
    const microZ = ((bpIdx % 4) + 1) * 0.004;
    const zDeckTop = quantizeZUnits(Math.max(zDeckBot + brHeight, zLandMax + rHeight * 0.60)) + microZ;

    const holes = (bp.holes || [])
      .map(h => clipPolyToBox(h.map(toBed), -halfW + 0.3, -halfH + 0.3, halfW - 0.3, halfH - 0.3))
      .filter(h => h.length >= 3);

    const deckShell = [];
    emitPolygonWithHolesSlab3D(poly, holes, zDeckBot, zDeckTop, 3, deckShell, 0, allocShellId());
    appendShellClippedToTiles(deckShell, ctx, meshes.roads);

    emitPiersAlongSpan(endNegPt[0], endNegPt[1], endPosPt[0], endPosPt[1], cHalfW * 2.0, zDeckBot, poly);
    emittedBridgePolys.push(poly);
  });

  // 2. Chain connected linear bridge=yes ways in scene.roads so mid-river OSM splits form single spans
  const rawBridgeWays = [];
  const otherRoads = [];
  (scene.roads || []).forEach(rd => {
    if (!rd.pts || rd.pts.length < 2) return;
    if (rd.bridge === true || (rd.layer && rd.layer >= 1)) {
      rawBridgeWays.push({ rd, pts: rd.pts.map(toBed), used: false });
    } else {
      otherRoads.push({ rd, pts: rd.pts.map(toBed) });
    }
  });

  const chainedCandidates = [];
  for (let i = 0; i < rawBridgeWays.length; i++) {
    if (rawBridgeWays[i].used) continue;
    rawBridgeWays[i].used = true;
    let chain = rawBridgeWays[i].pts.slice();
    const baseRd = rawBridgeWays[i].rd;
    let merged = true;
    while (merged) {
      merged = false;
      for (let j = 0; j < rawBridgeWays.length; j++) {
        const cand = rawBridgeWays[j];
        if (cand.used) continue;
        if (Math.abs((cand.rd.width || 1.2) - (baseRd.width || 1.2)) > 0.9) continue;
        const cStart = chain[0], cEnd = chain[chain.length - 1];
        const oStart = cand.pts[0], oEnd = cand.pts[cand.pts.length - 1];
        if (Math.hypot(cEnd[0] - oStart[0], cEnd[1] - oStart[1]) < 0.10) {
          chain = chain.concat(cand.pts.slice(1)); cand.used = true; merged = true;
        } else if (Math.hypot(cEnd[0] - oEnd[0], cEnd[1] - oEnd[1]) < 0.10) {
          chain = chain.concat(cand.pts.slice(0, -1).reverse()); cand.used = true; merged = true;
        } else if (Math.hypot(cStart[0] - oEnd[0], cStart[1] - oEnd[1]) < 0.10) {
          chain = cand.pts.slice(0, -1).concat(chain); cand.used = true; merged = true;
        } else if (Math.hypot(cStart[0] - oStart[0], cStart[1] - oStart[1]) < 0.10) {
          chain = cand.pts.slice(1).reverse().concat(chain); cand.used = true; merged = true;
        }
      }
    }
    chainedCandidates.push({ rd: baseRd, pts: chain, isExplicit: true });
  }
  // Only explicit bridges (bridge=yes / man_made=bridge / layer >= 1) may cross water on piers;
  // ground streets (otherRoads) must NEVER be turned into floating bridges over coastal/bay water.

  let linSpanIdx = 0;
  chainedCandidates.forEach(({ rd, pts, isExplicit }) => {
    const dense = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const pA = pts[i], pB = pts[i + 1];
      const segLen = Math.hypot(pB[0] - pA[0], pB[1] - pA[1]);
      const steps = Math.max(1, Math.ceil(segLen / 0.24));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        dense.push([pA[0] + (pB[0] - pA[0]) * t, pA[1] + (pB[1] - pA[1]) * t]);
      }
    }
    dense.push(pts[pts.length - 1]);
    if (dense.length < 2) return;

    const isWet = p => getActualPrintedSurfaceMinZ(p[0], p[1]) < baseBottomZ - 1e-4 || sampleBilinearMask(waterSDF, p[0], p[1]) < 0.04;
    let idx = 0;
    while (idx < dense.length) {
      if (!isWet(dense[idx])) { idx++; continue; }
      const iW0 = idx;
      while (idx < dense.length && isWet(dense[idx])) idx++;
      const iW1 = idx - 1;

      const rawWaterLen = Math.hypot(dense[iW1][0] - dense[iW0][0], dense[iW1][1] - dense[iW0][1]);
      if (!isExplicit && rawWaterLen < 1.5) continue;

      const brWidth = Math.max((rd.width || 1.1) * 0.95 * scaleToBed, 0.52 / scaleMm);
      const brHalfW = brWidth * 0.5;

      let s0 = iW0, landDist0 = 0;
      while (s0 > 0 && (!isPrintedDryPoint(dense[s0][0], dense[s0][1]) || landDist0 < 0.55) && landDist0 < 2.6) {
        landDist0 += Math.hypot(dense[s0][0] - dense[s0 - 1][0], dense[s0][1] - dense[s0 - 1][1]);
        s0--;
      }
      let s1 = iW1, landDist1 = 0;
      while (s1 < dense.length - 1 && (!isPrintedDryPoint(dense[s1][0], dense[s1][1]) || landDist1 < 0.55) && landDist1 < 2.6) {
        landDist1 += Math.hypot(dense[s1 + 1][0] - dense[s1][0], dense[s1 + 1][1] - dense[s1][1]);
        s1++;
      }

      const sub = dense.slice(s0, s1 + 1);
      if (sub.length >= 2 && !isPrintedDryPoint(sub[0][0], sub[0][1])) {
        const dx = sub[0][0] - sub[1][0], dy = sub[0][1] - sub[1][1], l = Math.hypot(dx, dy) || 1;
        for (let d = 0.30; d <= 5.2; d += 0.30) {
          const cand = [sub[0][0] + (dx / l) * d, sub[0][1] + (dy / l) * d];
          if (Math.abs(cand[0]) > halfW - 0.3 || Math.abs(cand[1]) > halfH - 0.3) break;
          if (isSpanEndAnchored(cand[0], cand[1], -dy / l, dx / l, brHalfW)) { sub.unshift(cand); break; }
        }
      }
      if (sub.length >= 2 && !isPrintedDryPoint(sub[sub.length - 1][0], sub[sub.length - 1][1])) {
        const nS = sub.length;
        const dx = sub[nS - 1][0] - sub[nS - 2][0], dy = sub[nS - 1][1] - sub[nS - 2][1], l = Math.hypot(dx, dy) || 1;
        for (let d = 0.30; d <= 5.2; d += 0.30) {
          const cand = [sub[nS - 1][0] + (dx / l) * d, sub[nS - 1][1] + (dy / l) * d];
          if (Math.abs(cand[0]) > halfW - 0.3 || Math.abs(cand[1]) > halfH - 0.3) break;
          if (isSpanEndAnchored(cand[0], cand[1], -dy / l, dx / l, brHalfW)) { sub.push(cand); break; }
        }
      }

      if (emittedBridgePolys.length > 0) {
        let covered = 0;
        for (let k = 0; k < sub.length; k++) {
          const p = sub[k];
          if (emittedBridgePolys.some(bpPoly => pointInPolyOrNear2D(p[0], p[1], bpPoly, 0.45))) covered++;
        }
        if (covered >= sub.length * 0.42) continue;
      }

      if (!isPrintedDryPoint(sub[0][0], sub[0][1]) || !isPrintedDryPoint(sub[sub.length - 1][0], sub[sub.length - 1][1])) {
        continue;
      }

      const spanPts = [sub[0]];
      for (let k = 1; k < sub.length - 1; k++) {
        if (Math.hypot(sub[k][0] - spanPts[spanPts.length - 1][0], sub[k][1] - spanPts[spanPts.length - 1][1]) >= 0.85) {
          spanPts.push(sub[k]);
        }
      }
      spanPts.push(sub[sub.length - 1]);
      if (spanPts.length < 2 || Math.hypot(spanPts[spanPts.length - 1][0] - spanPts[0][0], spanPts[spanPts.length - 1][1] - spanPts[0][1]) < 0.7) {
        continue;
      }

      const N = spanPts.length;
      const leftPts = [], rightPts = [];
      for (let i = 0; i < N; i++) {
        let nx, ny;
        if (i === 0) {
          const dx = spanPts[1][0] - spanPts[0][0], dy = spanPts[1][1] - spanPts[0][1], l = Math.hypot(dx, dy) || 1;
          nx = -dy / l; ny = dx / l;
        } else if (i === N - 1) {
          const dx = spanPts[N - 1][0] - spanPts[N - 2][0], dy = spanPts[N - 1][1] - spanPts[N - 2][1], l = Math.hypot(dx, dy) || 1;
          nx = -dy / l; ny = dx / l;
        } else {
          const d1x = spanPts[i][0] - spanPts[i - 1][0], d1y = spanPts[i][1] - spanPts[i - 1][1], l1 = Math.hypot(d1x, d1y) || 1;
          const d2x = spanPts[i + 1][0] - spanPts[i][0], d2y = spanPts[i + 1][1] - spanPts[i][1], l2 = Math.hypot(d2x, d2y) || 1;
          const tx = d1x / l1 + d2x / l2, ty = d1y / l1 + d2y / l2, tl = Math.hypot(tx, ty) || 1;
          const mnx = -ty / tl, mny = tx / tl;
          const dot = mnx * (-d1y / l1) + mny * (d1x / l1);
          const miter = Math.min(1.8, 1.0 / Math.max(0.55, dot));
          nx = mnx * miter; ny = mny * miter;
        }
        leftPts.push([spanPts[i][0] + nx * brHalfW, spanPts[i][1] + ny * brHalfW]);
        rightPts.push([spanPts[i][0] - nx * brHalfW, spanPts[i][1] - ny * brHalfW]);
      }
      const ribbonPoly = leftPts.concat(rightPts.slice().reverse());

      const { zLandMin, zLandMax } = computeDeckZBounds(ribbonPoly);
      const zDeckBot = zLandMin;
      const microZ = (((linSpanIdx++) % 5) + 1) * 0.004;
      const zDeckTop = quantizeZUnits(Math.max(zDeckBot + brHeight, zLandMax + rHeight * 0.60)) + microZ;

      const deckShell = [];
      emitClosedPrism(ribbonPoly, zDeckBot, zDeckTop, 3, deckShell, 0, allocShellId());
      appendShellClippedToTiles(deckShell, ctx, meshes.roads);

      emitPiersAlongSpan(spanPts[0][0], spanPts[0][1], spanPts[N - 1][0], spanPts[N - 1][1], brWidth, zDeckBot, ribbonPoly);
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildBankAnchoredBridges };
}
