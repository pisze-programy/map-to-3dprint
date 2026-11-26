// ============================================================================
// src/Water/water_piers_solver.js
// Waterfront Piers, Areal Platforms, Pontoons, Breakwaters & Anti-Capillary Piles
// ============================================================================

(function (root) {
  const PIER_KINDS = new Set(['pier', 'pontoon', 'breakwater', 'groyne', 'jetty']);

  function computeFootprintOBB(outer) {
    let cx = 0, cy = 0;
    const n = outer.length || 1;
    for (let i = 0; i < n; i++) { cx += outer[i][0]; cy += outer[i][1]; }
    cx /= n; cy /= n;
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      const dx = outer[i][0] - cx, dy = outer[i][1] - cy;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ux = Math.cos(theta), uy = Math.sin(theta), vx = -uy, vy = ux;
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const dx = outer[i][0] - cx, dy = outer[i][1] - cy;
      const u = dx * ux + dy * uy, v = dx * vx + dy * vy;
      if (u < uMin) uMin = u; if (u > uMax) uMax = u;
      if (v < vMin) vMin = v; if (v > vMax) vMax = v;
    }
    return { cx, cy, ux, uy, vx, vy, spanU: Math.max(0.2, uMax - uMin), spanV: Math.max(0.2, vMax - vMin), uMin, uMax, vMin, vMax };
  }

  function resolveGroundZ(ctx, terrainWater, x, y, extraSinkMm = 0.15) {
    const sinkU = extraSinkMm / ctx.scaleMm;
    if (terrainWater && terrainWater.isPointInWater(x, y)) {
      if (ctx.waterCutout) return 0.0;
      const wf = typeof terrainWater.getWaterFloorZ === 'function' ? terrainWater.getWaterFloorZ(x, y) : ctx.zWaterCarveFloor;
      return Math.max(0.0, wf - sinkU);
    }
    const surf = (terrainWater && typeof terrainWater.getSurfaceZ === 'function')
      ? terrainWater.getSurfaceZ(x, y)
      : ctx.getTerrainZ(x, y);
    return Math.max(0.05 / ctx.scaleMm, surf - sinkU);
  }

  function _getLaws(ctx) {
    if (ctx && ctx.slaLaws) return ctx.slaLaws;
    if (typeof SLA_PRINT_LAWS !== 'undefined') return SLA_PRINT_LAWS;
    try { return require('../geometry/sla_print_laws.js'); } catch (_) { return null; }
  }

  function _resolvePierClearance(ctx, laws, rec, pierKind, isSolidStone) {
    if (isSolidStone) return { rawGapMm: 0, resolvedGapMm: 0, isFloating: false };
    const { mToU, zScale, scaleToBed, scaleMm, supportlessMode } = ctx;
    const isFloating = Boolean(rec.floating || (rec.tags && (rec.tags.floating === 'yes' || rec.tags.platform === 'floating')) || pierKind === 'pontoon');
    let rawGapMm;
    if (rec.gapMm !== undefined && rec.gapMm !== null && Number.isFinite(Number(rec.gapMm))) {
      rawGapMm = Math.max(0, Number(rec.gapMm));
    } else if (supportlessMode || isFloating) {
      rawGapMm = 0.08;
    } else if (rec.minHeightM !== undefined && rec.minHeightM !== null && Number(rec.minHeightM) > 0) {
      rawGapMm = Math.max(0.26, Number(rec.minHeightM) * mToU * zScale * scaleToBed * scaleMm);
    } else if (Number(rec.layer) >= 1) {
      rawGapMm = Math.max(0.26, 1.6 * mToU * zScale * scaleToBed * scaleMm);
    } else {
      const clrM = Number(rec.clearanceM || rec.heightM || 0);
      rawGapMm = Math.max(0.26, (clrM > 0.35 ? clrM * 0.55 : 1.2) * mToU * zScale * scaleToBed * scaleMm);
    }
    const resolvedGapMm = laws && typeof laws.resolveAntiCapillaryGapMm === 'function'
      ? laws.resolveAntiCapillaryGapMm(rawGapMm, 0.48)
      : (rawGapMm < 0.24 ? 0 : Math.max(0.48, rawGapMm));
    return { rawGapMm, resolvedGapMm, isFloating };
  }

  function computePierDeckHeights(ctx, laws, rec, pierKind, waterTop, pileFloorZ) {
    const scaleMm = ctx.scaleMm || 1.89;
    const isSolidStone = pierKind === 'breakwater' || pierKind === 'groyne';
    const deckThickMm = laws && typeof laws.minWallThicknessMm === 'function' ? Math.max(0.50, laws.minWallThicknessMm(0.55)) : 0.50;
    const deckThickU = deckThickMm / scaleMm;
    const { rawGapMm, resolvedGapMm, isFloating } = _resolvePierClearance(ctx, laws, rec, pierKind, isSolidStone);
    const needsPiles = !isSolidStone && resolvedGapMm >= 0.48;
    const zDeckBot = needsPiles ? (waterTop + resolvedGapMm / scaleMm) : pileFloorZ;
    const zDeckTop = needsPiles
      ? (zDeckBot + deckThickU)
      : (isSolidStone
          ? Math.max(ctx.zLandDatum + 0.16 / scaleMm, waterTop + deckThickU, zDeckBot + deckThickU + 0.15 / scaleMm)
          : Math.max(waterTop + deckThickU + (isFloating ? 0.08 / scaleMm : 0), zDeckBot + deckThickU + 0.15 / scaleMm));
    return { rawGapMm, resolvedGapMm, isFloating, needsPiles, deckThickU, zDeckBot, zDeckTop };
  }

  function _getLandmarkSuppressHelpers() {
    if (typeof root.isBridgeOrPierSuppressedByLandmarks !== 'function' && typeof require !== 'undefined') {
      try { Object.assign(root, require('../landmarks/landmark_registry.js')); } catch (_) {}
    }
    return {
      isSuppressed: typeof root.isBridgeOrPierSuppressedByLandmarks === 'function'
        ? root.isBridgeOrPierSuppressedByLandmarks
        : (typeof isBridgeOrPierSuppressedByLandmarks === 'function' ? isBridgeOrPierSuppressedByLandmarks : null),
      findPlan: typeof root.findActiveLandmarksAndSuppression === 'function'
        ? root.findActiveLandmarksAndSuppression
        : (typeof findActiveLandmarksAndSuppression === 'function' ? findActiveLandmarksAndSuppression : null),
    };
  }

  function _collectPierItems(scene, ctx) {
    const { toBed, scaleToBed, minPrintU } = ctx;
    const { isSuppressed, findPlan } = _getLandmarkSuppressHelpers();
    const landmarkPlan = (ctx && ctx._landmarkPlan) || (findPlan ? findPlan(scene, ctx) : null);
    const items = [], seenOsm = new Set();
    const lineOsmIds = new Set(((scene && scene.pierLines) || []).map(pl => pl && pl.osmId).filter(id => id != null));
    const pushItem = (rec, isArea, ptsOrRing, holesBed, widthU) => {
      const pierIds = (rec && Array.isArray(rec.wayIds))
        ? [rec.osmId, ...rec.wayIds]
        : (rec ? rec.osmId : null);
      if (isSuppressed && landmarkPlan && isSuppressed(landmarkPlan, pierIds, ptsOrRing)) return;
      const kId = rec.osmId != null ? `${isArea ? 'A' : 'L'}:${rec.osmId}` : null;
      if (kId && seenOsm.has(kId)) return;
      if (kId) seenOsm.add(kId);
      const pierKind = rec.pierKind || (rec.tags && rec.tags.man_made) || rec.man_made || 'pier';
      items.push({ rec, pierKind, isArea, ptsOrRing, holesBed: holesBed || [], widthU });
    };

    for (const bp of (scene && scene.bridgePolys) || []) {
      if (!bp || !bp.isPier || !bp.outer || bp.outer.length < 3) continue;
      if (bp.isPierLine && bp.osmId != null && lineOsmIds.has(bp.osmId)) continue;
      pushItem(bp, !bp.isPierLine, bp.outer.map(toBed), (bp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed)), bp.width || 0.8);
    }
    for (const pp of (scene && scene.pierPolys) || []) {
      if (!pp || pp._inBridgePolys || !pp.outer || pp.outer.length < 3) continue;
      pushItem(pp, true, pp.outer.map(toBed), (pp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed)), pp.width || 0.8);
    }
    for (const rd of (scene && scene.roads) || []) {
      if (!rd || !rd.pts || rd.pts.length < 2) continue;
      const k = rd.man_made || (rd.tags && rd.tags.man_made) || (rd.isPier ? (rd.pierKind || 'pier') : '');
      if (!PIER_KINDS.has(k)) continue;
      pushItem(rd, false, rd.pts.map(toBed), [], Math.max(minPrintU * 0.7, ((rd.width || 0.8) * 0.5) * scaleToBed));
    }
    for (const pl of (scene && scene.pierLines) || []) {
      if (!pl || !pl.pts || pl.pts.length < 2) continue;
      pushItem(pl, false, pl.pts.map(toBed), [], Math.max(minPrintU * 0.7, ((pl.width || 0.8) * 0.5) * scaleToBed));
    }
    return items;
  }

  function buildMarinePiersAndBreakwaters(core, mf, ctx, scene, terrainWater) {
    const { scaleMm, waterCutout, minPrintU, toBed } = ctx;
    const laws = _getLaws(ctx);
    const items = _collectPierItems(scene, ctx);
    if (items.length === 0) return { solids: [], pierCount: 0 };

    const minStrutMm = laws && typeof laws.minStrutDiameterMm === 'function' ? laws.minStrutDiameterMm(4.0) : 0.52;
    const minPileR = Math.max(minPrintU * 0.55, (minStrutMm * 0.5) / scaleMm, 0.27 / scaleMm);
    const pierR = Math.max(minPrintU * 0.75, minPileR, 0.35 / scaleMm);
    const deckThickMm = laws && typeof laws.minWallThicknessMm === 'function' ? Math.max(0.50, laws.minWallThicknessMm(0.55)) : 0.50;
    const deckThickU = deckThickMm / scaleMm;
    const solids = [], placedPilePts = [];
    if (!ctx.audit.pierAudits) ctx.audit.pierAudits = [];

    const addSinglePile = (px, py, floorZ, topZ, customR = pierR, forceAnchor = false) => {
      const pileH = topZ - floorZ, rUse = Math.max(minPileR, customR || pierR);
      if (pileH <= 1e-4 || !Number.isFinite(px) || !Number.isFinite(py)) return false;
      if (!forceAnchor) {
        if (terrainWater && typeof terrainWater.isPointInWater === 'function' && !terrainWater.isPointInWater(px, py)) return false;
        const minSep = Math.max(rUse, pierR * 0.85) * 1.65;
        for (let i = 0; i < placedPilePts.length; i++) {
          if (Math.hypot(placedPilePts[i][0] - px, placedPilePts[i][1] - py) < minSep) return false;
        }
      }
      placedPilePts.push([px, py]);
      const rawCyl = mf.Manifold.cylinder(pileH, rUse, rUse, 8, false);
      const rotCyl = rawCyl.rotate([0, 0, 22.5]);
      rawCyl.delete();
      const cyl = rotCyl.translate([px, py, floorZ]);
      rotCyl.delete();
      solids.push(cyl);
      return true;
    };

    const addPilesAlongPts = (pts, halfW, floorZ, topZ) => {
      if (!pts || pts.length < 2 || topZ - floorZ <= 1e-4) return 0;
      let total = 0, added = 0;
      for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      const rLine = Math.max(minPileR, Math.min(pierR, halfW * 0.88));
      const endInset = Math.min(rLine * 0.95, total * 0.22), effLen = Math.max(0, total - 2 * endInset);
      const step = Math.max(minPrintU * 3.5, Math.min(halfW * 4.5, 4.5 / scaleMm));
      const nPiles = effLen <= 1e-5 ? 1 : Math.max(2, Math.min(18, Math.round(effLen / step) + 1));
      for (let k = 0; k < nPiles; k++) {
        const target = nPiles === 1 ? (total * 0.5) : (endInset + (k / (nPiles - 1)) * effLen);
        let acc = 0, px = pts[0][0], py = pts[0][1];
        for (let i = 0; i < pts.length - 1; i++) {
          const s = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
          if (acc + s >= target || i === pts.length - 2) {
            const f = s > 1e-6 ? Math.max(0, Math.min(1, (target - acc) / s)) : 0;
            px = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f;
            py = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
            break;
          }
          acc += s;
        }
        if (addSinglePile(px, py, floorZ, topZ, rLine)) added++;
      }
      return added;
    };

    const addAreaMedialPiles = (outerRing, holeRings, obb, floorZ, topZ) => {
      if (!outerRing || outerRing.length < 3 || topZ - floorZ <= 1e-4) return 0;
      const uvRings = [outerRing, ...(holeRings || [])]
        .filter(r => r && r.length >= 3)
        .map(r => r.map(p => [
          (p[0] - obb.cx) * obb.ux + (p[1] - obb.cy) * obb.uy,
          (p[0] - obb.cx) * obb.vx + (p[1] - obb.cy) * obb.vy,
        ]));
      const toWorld = (u, v) => [obb.cx + obb.ux * u + obb.vx * v, obb.cy + obb.uy * u + obb.vy * v];
      const step = Math.max(minPrintU * 3.8, 4.2 / scaleMm);
      let added = 0, fallbackPt = null;

      const scanAxis = (axisIdx, lo, hi) => {
        const otherIdx = 1 - axisIdx, pad = Math.min(pierR * 0.95, (hi - lo) * 0.22);
        const a0 = lo + pad, a1 = hi - pad, span = Math.max(0, a1 - a0);
        const nS = span <= 1e-5 ? 1 : Math.max(2, Math.min(22, Math.round(span / step) + 1));
        for (let s = 0; s < nS; s++) {
          const pos = nS === 1 ? (lo + hi) * 0.5 : (a0 + (s / (nS - 1)) * span);
          const hits = [];
          for (const r of uvRings) {
            for (let i = 0, n = r.length; i < n; i++) {
              const pA = r[i], pB = r[(i + 1) % n];
              if ((pA[axisIdx] <= pos && pB[axisIdx] > pos) || (pB[axisIdx] <= pos && pA[axisIdx] > pos)) {
                hits.push(pA[otherIdx] + ((pos - pA[axisIdx]) / (pB[axisIdx] - pA[axisIdx])) * (pB[otherIdx] - pA[otherIdx]));
              }
            }
          }
          hits.sort((a, b) => a - b);
          for (let m = 0; m + 1 < hits.length; m += 2) {
            const segLo = hits[m], segHi = hits[m + 1], segW = segHi - segLo;
            if (segW <= minPileR * 0.35) continue;
            const rLocal = Math.max(minPileR, Math.min(pierR, segW * 0.43));
            const margin = Math.min(rLocal * 0.95, segW * 0.45);
            const nAcross = segW > step * 1.85 ? Math.min(6, Math.floor((segW - 2 * margin) / step) + 1) : 1;
            for (let j = 0; j < nAcross; j++) {
              const tVal = nAcross === 1 ? (segLo + segHi) * 0.5 : (segLo + margin + (j / (nAcross - 1)) * (segW - 2 * margin));
              const [wx, wy] = axisIdx === 0 ? toWorld(pos, tVal) : toWorld(tVal, pos);
              if (!fallbackPt) fallbackPt = [wx, wy, rLocal];
              if (addSinglePile(wx, wy, floorZ, topZ, rLocal)) added++;
            }
          }
        }
      };

      scanAxis(0, obb.uMin, obb.uMax);
      if (obb.spanV > minPileR * 2.4) scanAxis(1, obb.vMin, obb.vMax);
      if (added === 0 && fallbackPt) {
        if (addSinglePile(fallbackPt[0], fallbackPt[1], floorZ, topZ, fallbackPt[2], true)) added++;
      }
      return added;
    };

    /**
     * Returns true when a floating areal pontoon has zero physical contact/overlap with dry bank,
     * fixed piers, or bridges under waterCutout (so printing it would leave a detached loose shell).
     * @returns {boolean}
     */
    const isDetachedOpenWaterFloatingPontoon = (ring, curItem) => {
      if (!waterCutout || !ring || ring.length < 3) return false;
      if (!terrainWater || typeof terrainWater.isPointInWater !== 'function') return false;
      const shoreReachU = 0.18 / scaleMm;
      const sampleStepU = Math.max(0.25, 0.40 / scaleMm);
      const samplePts = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const nSub = Math.max(1, Math.min(24, Math.ceil(segLen / sampleStepU)));
        for (let s = 0; s < nSub; s++) {
          const t = s / nSub;
          samplePts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
      }
      for (const p of samplePts) {
        if (!terrainWater.isPointInWater(p[0], p[1])) return false;
        for (let k = 0; k < 8; k++) {
          const ang = (k * Math.PI) / 4;
          if (!terrainWater.isPointInWater(p[0] + Math.cos(ang) * shoreReachU, p[1] + Math.sin(ang) * shoreReachU)) return false;
        }
      }
      const ptToSegDist = (px, py, ax, ay, bx, by) => {
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      };
      const ptInRing = (px, py, poly) => {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
          if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
        }
        return inside;
      };
      const linkTolU = 0.18 / scaleMm;
      for (const other of items) {
        if (other === curItem) continue;
        const oSolid = other.pierKind === 'breakwater' || other.pierKind === 'groyne';
        const oClear = _resolvePierClearance(ctx, laws, other.rec, other.pierKind, oSolid);
        if (oClear.isFloating) continue;
        const oPts = other.ptsOrRing || [];
        if (oPts.length < 2) continue;
        const segCount = other.isArea ? oPts.length : (oPts.length - 1);
        const effTol = other.isArea ? linkTolU : (linkTolU + (other.widthU || 0));
        for (const p of samplePts) {
          if (other.isArea && oPts.length >= 3 && ptInRing(p[0], p[1], oPts)) return false;
          for (let j = 0; j < segCount; j++) {
            const a = oPts[j], b = oPts[(j + 1) % oPts.length];
            if (ptToSegDist(p[0], p[1], a[0], a[1], b[0], b[1]) <= effTol) return false;
          }
        }
      }
      if (typeof toBed === 'function') {
        for (const rd of ((scene && scene.roads) || [])) {
          if (!rd || !(rd.isBridge || rd.bridge) || !rd.pts || rd.pts.length < 2) continue;
          const bPts = rd.pts.map(toBed);
          const halfW = Math.max(0.25 / scaleMm, ((rd.width || 0.8) * 0.5) * (ctx.scaleToBed || 1));
          for (let j = 0; j < bPts.length - 1; j++) {
            const a = bPts[j], b = bPts[j + 1];
            for (const p of samplePts) {
              if (ptToSegDist(p[0], p[1], a[0], a[1], b[0], b[1]) <= linkTolU + halfW) return false;
            }
          }
        }
      }
      return true;
    };

    for (const item of items) {
      const { rec, pierKind, isArea, ptsOrRing, holesBed, widthU } = item;
      const isSolidStone = pierKind === 'breakwater' || pierKind === 'groyne';
      const { rawGapMm, resolvedGapMm, isFloating } = _resolvePierClearance(ctx, laws, rec, pierKind, isSolidStone);
      if (isArea && isFloating && isDetachedOpenWaterFloatingPontoon(ptsOrRing, item)) continue;
      const obb = computeFootprintOBB(ptsOrRing);
      const inWater = terrainWater && terrainWater.isPointInWater(obb.cx, obb.cy);
      const waterTop = inWater
        ? ((terrainWater && typeof terrainWater.getNominalWaterTopZ === 'function')
            ? terrainWater.getNominalWaterTopZ(obb.cx, obb.cy)
            : ((!waterCutout && terrainWater && typeof terrainWater.getWaterTopZ === 'function')
                ? terrainWater.getWaterTopZ(obb.cx, obb.cy)
                : ctx.zWaterTop))
        : ctx.zWaterTop;
      const pileFloorZ = waterCutout
        ? 0.0
        : Math.max(0.0, (terrainWater && terrainWater.getWaterFloorZ ? terrainWater.getWaterFloorZ(obb.cx, obb.cy) : ctx.zWaterCarveFloor) - 0.15 / scaleMm);

      const needsPiles = !isSolidStone && resolvedGapMm >= 0.48;
      const zDeckBot = needsPiles ? (waterTop + resolvedGapMm / scaleMm) : pileFloorZ;
      const zDeckTop = needsPiles
        ? (zDeckBot + deckThickU)
        : (isSolidStone
            ? Math.max(ctx.zLandDatum + 0.16 / scaleMm, waterTop + deckThickU, zDeckBot + deckThickU + 0.15 / scaleMm)
            : Math.max(waterTop + deckThickU + (isFloating ? 0.08 / scaleMm : 0), zDeckBot + deckThickU + 0.15 / scaleMm));
      const zPileTop = zDeckBot + 0.08 / scaleMm;

      if (isArea) {
        const deckM = core.extrudeRingSolid(mf, ptsOrRing, holesBed, zDeckBot, zDeckTop);
        if (deckM) solids.push(deckM);
        if (needsPiles) addAreaMedialPiles(ptsOrRing, holesBed, obb, pileFloorZ, zPileTop);
      } else {
        const startDry = terrainWater && typeof terrainWater.isPointInWater === 'function' && !terrainWater.isPointInWater(ptsOrRing[0][0], ptsOrRing[0][1]);
        const endDry = terrainWater && typeof terrainWater.isPointInWater === 'function' && !terrainWater.isPointInWater(ptsOrRing[ptsOrRing.length - 1][0], ptsOrRing[ptsOrRing.length - 1][1]);
        const useSqEnd = !(startDry || endDry);
        const rings = core.clipperBufferOpenPaths([{ pts: ptsOrRing, halfW: widthU, squareEnd: useSqEnd }], 'Miter', 1e-5);
        for (const r of rings) {
          const m = core.extrudeRingSolid(mf, r, [], zDeckBot, zDeckTop);
          if (m) solids.push(m);
        }
        if (needsPiles) {
          const itemPiles = addPilesAlongPts(ptsOrRing, widthU, pileFloorZ, zPileTop);
          if (itemPiles === 0 && ptsOrRing.length > 0) {
            const midPt = ptsOrRing[ptsOrRing.length >> 1];
            addSinglePile(midPt[0], midPt[1], pileFloorZ, zPileTop, Math.max(minPileR, Math.min(pierR, widthU * 0.88)), true);
          }
        }
      }

      ctx.audit.pierAudits.push({
        name: rec.name || 'Molo', osmId: rec.osmId || null, isArea, pierKind, isFloating: Boolean(isFloating),
        rawGapMm: Math.round(rawGapMm * 1000) / 1000, resolvedGapMm: Math.round(resolvedGapMm * 1000) / 1000,
        hasPiles: needsPiles, pileDiameterMm: Math.round(pierR * 2 * scaleMm * 1000) / 1000,
        waterTopZ: waterTop, deckBotZ: zDeckBot, deckTopZ: zDeckTop
      });
    }

    if (solids.length === 0) return { solids: [], pierCount: 0 };
    return { solids: [core.batchUnionManifolds(mf, solids)].filter(Boolean), pierCount: items.length };
  }

  const exportsObj = { computeFootprintOBB, resolveGroundZ, computePierDeckHeights, buildMarinePiersAndBreakwaters };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
