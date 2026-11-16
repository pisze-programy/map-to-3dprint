// ============================================================================
// src/mesh/waterfront_piers_solver.js
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

  function _collectPierItems(scene, ctx) {
    const { toBed, scaleToBed, minPrintU } = ctx;
    const items = [];
    const seenOsm = new Set();

    const lineOsmIds = new Set(((scene && scene.pierLines) || []).map(pl => pl && pl.osmId).filter(id => id != null));
    const pushItem = (rec, isArea, ptsOrRing, holesBed, widthU) => {
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
      const halfW = Math.max(minPrintU * 0.7, ((rd.width || 0.8) * 0.5) * scaleToBed);
      pushItem(rd, false, rd.pts.map(toBed), [], halfW);
    }
    for (const pl of (scene && scene.pierLines) || []) {
      if (!pl || !pl.pts || pl.pts.length < 2) continue;
      const halfW = Math.max(minPrintU * 0.7, ((pl.width || 0.8) * 0.5) * scaleToBed);
      pushItem(pl, false, pl.pts.map(toBed), [], halfW);
    }
    return items;
  }

  function buildMarinePiersAndBreakwaters(core, mf, ctx, scene, terrainWater) {
    const { scaleMm, waterCutout, minPrintU, totalWidthMm } = ctx;
    const laws = _getLaws(ctx);
    const items = _collectPierItems(scene, ctx);
    if (items.length === 0) return { solids: [], pierCount: 0 };

    const minStrutMm = laws && typeof laws.minStrutDiameterMm === 'function' ? laws.minStrutDiameterMm(4.0) : 0.52;
    const pierR = Math.max(minPrintU * 0.75, (minStrutMm * 0.5) / scaleMm, 0.35 / scaleMm);
    const deckThickMm = laws && typeof laws.minWallThicknessMm === 'function' ? Math.max(0.50, laws.minWallThicknessMm(0.55)) : 0.50;
    const deckThickU = deckThickMm / scaleMm;
    const solids = [];
    const placedPilePts = [];
    if (!ctx.audit.pierAudits) ctx.audit.pierAudits = [];

    const addSinglePile = (px, py, floorZ, topZ, forceAnchor = false) => {
      const pileH = topZ - floorZ;
      if (pileH <= 1e-4 || !Number.isFinite(px) || !Number.isFinite(py)) return false;
      if (!forceAnchor) {
        for (let i = 0; i < placedPilePts.length; i++) {
          if (Math.hypot(placedPilePts[i][0] - px, placedPilePts[i][1] - py) < pierR * 1.5) return false;
        }
      }
      placedPilePts.push([px, py]);
      const rawCyl = mf.Manifold.cylinder(pileH, pierR, pierR, 8, false);
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
      const step = Math.max(minPrintU * 3.5, Math.min(halfW * 4.5, 4.5 / scaleMm));
      const nPiles = Math.max(2, Math.min(18, Math.round(total / step) + 1));
      for (let k = 0; k < nPiles; k++) {
        const target = (k / Math.max(1, nPiles - 1)) * total;
        let acc = 0, px = pts[0][0], py = pts[0][1];
        for (let i = 0; i < pts.length - 1; i++) {
          const s = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
          if (acc + s >= target || i === pts.length - 2) {
            const f = s > 1e-6 ? (target - acc) / s : 0;
            px = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f;
            py = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
            break;
          }
          acc += s;
        }
        if (addSinglePile(px, py, floorZ, topZ)) added++;
      }
      return added;
    };

    for (const item of items) {
      const { rec, pierKind, isArea, ptsOrRing, holesBed, widthU } = item;
      const isSolidStone = pierKind === 'breakwater' || pierKind === 'groyne';
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

      const { rawGapMm, resolvedGapMm, isFloating } = _resolvePierClearance(ctx, laws, rec, pierKind, isSolidStone);
      const needsPiles = !isSolidStone && resolvedGapMm >= 0.48;
      const zDeckBot = needsPiles ? (waterTop + resolvedGapMm / scaleMm) : pileFloorZ;
      const zDeckTop = needsPiles
        ? (zDeckBot + deckThickU)
        : (isSolidStone
            ? Math.max(ctx.zLandDatum + 0.16 / scaleMm, waterTop + deckThickU, zDeckBot + deckThickU + 0.15 / scaleMm)
            : Math.max(waterTop + deckThickU, zDeckBot + deckThickU + 0.15 / scaleMm));
      const zPileTop = zDeckBot + 0.08 / scaleMm;

      if (isArea) {
        const deckM = core.extrudeRingSolid(mf, ptsOrRing, holesBed, zDeckBot, zDeckTop);
        if (deckM) solids.push(deckM);
        if (needsPiles) {
          let itemPiles = addPilesAlongPts(
            [[obb.cx + obb.ux * obb.uMin * 0.85, obb.cy + obb.uy * obb.uMin * 0.85],
             [obb.cx + obb.ux * obb.uMax * 0.85, obb.cy + obb.uy * obb.uMax * 0.85]],
            obb.spanV * 0.4, pileFloorZ, zPileTop
          );
          const stride = Math.max(1, Math.floor(ptsOrRing.length / 12));
          for (let vi = 0; vi < ptsOrRing.length; vi += stride) {
            if (addSinglePile(ptsOrRing[vi][0], ptsOrRing[vi][1], pileFloorZ, zPileTop)) itemPiles++;
          }
          if (itemPiles === 0 && ptsOrRing.length > 0) addSinglePile(ptsOrRing[0][0], ptsOrRing[0][1], pileFloorZ, zPileTop, true);
        }
      } else {
        const rings = core.clipperBufferOpenPaths([{ pts: ptsOrRing, halfW: widthU, squareEnd: true }], 'Miter', 1e-5);
        for (const r of rings) {
          const m = core.extrudeRingSolid(mf, r, [], zDeckBot, zDeckTop);
          if (m) solids.push(m);
        }
        if (needsPiles) {
          const itemPiles = addPilesAlongPts(ptsOrRing, widthU, pileFloorZ, zPileTop);
          if (itemPiles === 0 && ptsOrRing.length > 0) {
            const midPt = ptsOrRing[ptsOrRing.length >> 1];
            addSinglePile(midPt[0], midPt[1], pileFloorZ, zPileTop, true);
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

  const exportsObj = { computeFootprintOBB, resolveGroundZ, buildMarinePiersAndBreakwaters };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
