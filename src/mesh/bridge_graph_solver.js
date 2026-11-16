// ============================================================================
// src/mesh/bridge_graph_solver.js
// Unified OSM Bridge Graph, Bed-Safe Coordinates, Local Grade Z(s) & Supports
// ============================================================================

if (typeof _normalizeBridgeStructJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./bridge_axis_helper.js'));
}

function _sampleAbutmentZJS(pt, outDirX, outDirY, outerRing, terrainWater, ctx) {
  let sx0 = pt[0], sy0 = pt[1];
  if (outerRing) {
    for (let k = 0; k < 5 && _ptInRingJS(sx0, sy0, outerRing); k++) { sx0 += outDirX * 0.45; sy0 += outDirY * 0.45; }
  }
  for (const d of [0.0, 0.35, 0.85, 1.6]) {
    const sx = sx0 + outDirX * d, sy = sy0 + outDirY * d;
    if (Math.abs(sx) <= ctx.halfW + 0.5 && Math.abs(sy) <= ctx.halfH + 0.5 && !terrainWater.isPointInWater(sx, sy)) {
      return { z: terrainWater.getSurfaceZ(sx, sy), inWater: false };
    }
  }
  return { z: terrainWater.getSurfaceZ(pt[0], pt[1]), inWater: terrainWater.isPointInWater(pt[0], pt[1]) };
}

function _stationWaterFlagsJS(pts, terrainWater) {
  const n = pts.length, flags = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (terrainWater.isPointInWater(pts[i][0], pts[i][1])) { flags[i] = true; continue; }
    if (i > 0) {
      const mx = (pts[i - 1][0] + pts[i][0]) * 0.5, my = (pts[i - 1][1] + pts[i][1]) * 0.5;
      if (terrainWater.isPointInWater(mx, my)) { flags[i] = true; flags[i - 1] = true; }
    }
  }
  return flags;
}

function _segClosestPair2DJS(a0, a1, b0, b1) {
  const ux = a1[0] - a0[0], uy = a1[1] - a0[1], vx = b1[0] - b0[0], vy = b1[1] - b0[1];
  const wx = a0[0] - b0[0], wy = a0[1] - b0[1];
  const a = ux * ux + uy * uy, b = ux * vx + uy * vy, c = vx * vx + vy * vy;
  const d = ux * wx + uy * wy, e = vx * wx + vy * wy, denom = a * c - b * b;
  let sc, sN, sD = denom, tc, tN, tD = denom;
  if (denom < 1e-10) { sN = 0.0; sD = 1.0; tN = e; tD = c; }
  else {
    sN = (b * e - c * d); tN = (a * e - b * d);
    if (sN < 0) { sN = 0; tN = e; tD = c; } else if (sN > sD) { sN = sD; tN = e + b; tD = c; }
  }
  if (tN < 0) {
    tN = 0;
    if (-d < 0) sN = 0; else if (-d > a) sN = sD; else { sN = -d; sD = a; }
  } else if (tN > tD) {
    tN = tD;
    if ((-d + b) < 0) sN = 0; else if ((-d + b) > a) sN = sD; else { sN = (-d + b); sD = a; }
  }
  sc = Math.abs(sN) < 1e-10 ? 0 : sN / sD;
  tc = Math.abs(tN) < 1e-10 ? 0 : tN / tD;
  const qa = [a0[0] + ux * sc, a0[1] + uy * sc], qb = [b0[0] + vx * tc, b0[1] + vy * tc];
  return { dist: Math.hypot(qa[0] - qb[0], qa[1] - qb[1]), sA: sc, tB: tc, qa, qb };
}

function _applyLocalSmoothLiftJS(zTopArr, zBotArr, sArr, spanU, needArr, baseRampU, pinStart, pinEnd) {
  const n = zTopArr.length;
  for (let k = 0; k < n; k++) {
    if ((k === 0 && pinStart && needArr[0] <= 0) || (k === n - 1 && pinEnd && needArr[n - 1] <= 0)) continue;
    let lift = needArr[k];
    const sk = sArr[k];
    for (let m = 0; m < n; m++) {
      const nm = needArr[m];
      if (nm <= lift) continue;
      const ramp = Math.max(baseRampU, Math.min(18.0, nm * 8.5));
      const ds = Math.abs(sk - sArr[m]);
      if (ds >= ramp) continue;
      const u = 1.0 - ds / ramp;
      let env = u * u * (3.0 - 2.0 * u);
      if (pinStart && needArr[0] <= 0 && sk < ramp) env *= Math.min(1.0, sk / Math.max(0.8, Math.min(sArr[m], ramp * 0.55)));
      if (pinEnd && needArr[n - 1] <= 0 && (spanU - sk) < ramp) env *= Math.min(1.0, (spanU - sk) / Math.max(0.8, Math.min(spanU - sArr[m], ramp * 0.55)));
      if (nm * env > lift) lift = nm * env;
    }
    if (lift > 0) { zTopArr[k] += lift; zBotArr[k] += lift; }
  }
}

function solveBridgeGraph(scene, terrainWater, ctx) {
  const s2b = ctx.scaleToBed || 1.0;
  const toBed = typeof ctx.toBed === 'function' ? ctx.toBed : (p => [p[0] * s2b, p[1] * s2b]);
  const mToBedXY = ctx.mToU * s2b, mToBedZ = ctx.mToU * ctx.zScale * s2b;
  const minDeckU = (ctx.cfg ? ctx.cfg.bridgeDeckMinMm : 0.719) / ctx.scaleMm;
  const clipPad = 2.0, cMinX = -ctx.halfW - clipPad, cMaxX = ctx.halfW + clipPad, cMinY = -ctx.halfH - clipPad, cMaxY = ctx.halfH + clipPad;

  const rawPolys = (scene.bridgePolys || []).filter(bp => bp && !bp.isPier && bp.outer && bp.outer.length >= 3);
  const rawRoads = (scene.roads || []).filter(rd => rd && (rd.isBridge || rd.bridge) && rd.pts && rd.pts.length >= 2);
  const rawSupports = (scene.bridgeSupports || []).map(sp => ({
    ...sp, pt: sp.pt ? toBed(sp.pt) : null,
    outer: sp.outer ? sp.outer.map(toBed) : null,
    pts: sp.pts ? sp.pts.map(toBed) : null
  }));

  const groundRoads = [];
  for (const rd of (scene.roads || [])) {
    if (!rd || rd.isBridge || rd.bridge || !rd.pts || rd.pts.length < 2) continue;
    const hw = Math.max(0.18, ((rd.width || 0.7) * 0.5) * s2b);
    const lyr = rd.hasExplicitLayer ? (rd.layer ?? 0) : 0;
    for (const pc of _clipPolylineToRectJS(rd.pts.map(toBed), cMinX, cMinY, cMaxX, cMaxY)) {
      const bb = _bbox2DJS(pc.pts);
      groundRoads.push({ pts: pc.pts, halfW: hw, layer: lyr, isPath: Boolean(rd.isPath), bbox: [bb[0] - hw, bb[1] - hw, bb[2] + hw, bb[3] + hw] });
    }
  }

  const consumedRoadOsmIds = new Set(), specs = [];
  for (const bp of rawPolys) {
    const outer = bp.outer.map(toBed), pbb = _bbox2DJS(outer);
    if (pbb[2] < cMinX || pbb[0] > cMaxX || pbb[3] < cMinY || pbb[1] > cMaxY) continue;
    const holes = (bp.holes || []).map(h => h.map(toBed));
    const linked = rawRoads.filter(rd => rd._bridgePolyOsmId === bp.osmId || (bp.acrossRoadIds && bp.acrossRoadIds.includes(rd.osmId)));
    linked.forEach(rd => { if (rd.osmId != null) consumedRoadOsmIds.add(rd.osmId); });
    const axisRaw = _extractClippedAxisFromRoadsJS(outer, linked.map(r => r.pts.map(toBed)), mToBedXY) || _extractCurvedSpineFromPolyJS(outer);
    const spanU = Math.max(0.4, _polyLenJS(axisRaw));
    const obb = typeof computeMinAreaOBB2D === 'function' ? computeMinAreaOBB2D(outer) : null;
    const estW = typeof _estimatePolyRibbonWidthJS === 'function' ? _estimatePolyRibbonWidthJS(outer, axisRaw, obb) : 1.5;
    const widthU = Math.max(minDeckU * 1.3, Number.isFinite(estW) ? estW : 1.5);
    let structNorm = _normalizeBridgeStructJS(bp.bridgeStructure || (bp.tags && bp.tags['bridge:structure']), bp.covered, bp.tags);
    let expThrough = /through[-_ ]?arch|tied[-_ ]?arch|bowstring/i.test(String(bp.bridgeStructure || ''));
    let heightM = bp.heightM, clearanceM = bp.clearanceM;
    for (const rd of linked) {
      const rs = _normalizeBridgeStructJS(rd.bridgeStructure, rd.covered, rd.tags);
      if (_structRankJS(rs) > _structRankJS(structNorm)) structNorm = rs;
      if (/through[-_ ]?arch|tied[-_ ]?arch|bowstring/i.test(String(rd.bridgeStructure || ''))) expThrough = true;
      if (heightM == null && rd.heightM != null) heightM = rd.heightM;
      if (clearanceM == null && rd.clearanceM != null) clearanceM = rd.clearanceM;
    }
    const nSt = Math.max(7, Math.min(160, Math.ceil(spanU / 0.80) + 1));
    specs.push({
      isAreaPoly: true, outer, holes, pts: _resamplePolyJS(axisRaw, nSt),
      width: widthU, deckThick: Math.max(minDeckU, Math.min(widthU * 0.38, minDeckU * (structNorm === 'beam' ? 1.15 : 1.25))),
      deckLayer: bp.layer ?? 1, name: bp.name || 'Most', structNorm, explicitThroughArch: expThrough,
      isRail: linked.length > 0 && linked.every(rd => rd.tags && rd.tags.railway), isBoardwalk: false,
      clippedStart: false, clippedEnd: false,
      heightM, minHeightM: bp.minHeightM, clearanceM, covered: bp.covered, supportIds: bp.supportIds || [], osmId: bp.osmId
    });
  }

  const freeRoadPieces = [];
  for (const rd of rawRoads) {
    if (rd.osmId != null && consumedRoadOsmIds.has(rd.osmId)) continue;
    const rawSt = rd.bridgeStructure || rd.structure || (rd.tags && (rd.tags['bridge:structure'] || rd.tags.bridge));
    const cov = rd.covered || (rd.tags && rd.tags.covered);
    const isRail = Boolean((rd.tags && rd.tags.railway) || ['rail', 'light_rail', 'tram', 'monorail', 'subway', 'narrow_gauge', 'funicular'].includes(rd.hwy));
    const isBoardwalk = String((rd.tags && rd.tags.bridge) || rawSt || '').toLowerCase() === 'boardwalk';
    for (const pc of _clipPolylineToRectJS(rd.pts.map(toBed), cMinX, cMinY, cMaxX, cMaxY)) {
      freeRoadPieces.push({
        pts: pc.pts, clippedStart: pc.clippedStart, clippedEnd: pc.clippedEnd,
        width: Math.max(isRail || rd.isPath ? 0.20 : 0.28, (rd.width || 0.8) * s2b),
        layer: rd.hasExplicitLayer !== undefined ? (rd.hasExplicitLayer ? rd.layer : 1) : (rd.layer ?? 1),
        parentBridgeRelId: rd.parentBridgeRelId, name: rd.name || '',
        isRail, isPath: Boolean(rd.isPath), isBoardwalk,
        structNorm: _normalizeBridgeStructJS(rawSt, cov, rd.tags),
        explicitThroughArch: /through[-_ ]?arch|tied[-_ ]?arch|bowstring/i.test(String(rawSt || '')),
        heightM: rd.heightM, minHeightM: rd.minHeightM, clearanceM: rd.clearanceM, covered: cov, osmId: rd.osmId
      });
    }
  }

  for (const r of _stitchAndMergeLinearBridgesJS(freeRoadPieces, { mToBedXY, scaleMm: ctx.scaleMm })) {
    const spanU = Math.max(0.4, _polyLenJS(r.pts));
    const slender = Boolean(r.isRail || r.isPath);
    const minW = slender ? Math.max(0.54 / ctx.scaleMm, minDeckU * 0.78) : minDeckU * 1.12;
    const widthU = Math.max(minW, r.width);
    const deckThick = Math.max(slender ? Math.max(0.56 / ctx.scaleMm, minDeckU * 0.82) : minDeckU, Math.min(widthU * 0.40, minDeckU * 1.15));
    const nSt = Math.max(7, Math.min(160, Math.ceil(spanU / 0.80) + 1));
    specs.push({
      isAreaPoly: false, outer: null, holes: [], pts: _resamplePolyJS(r.pts, nSt),
      width: widthU, deckThick, deckLayer: r.layer ?? 1, name: r.name, structNorm: r.structNorm,
      explicitThroughArch: r.explicitThroughArch, isRail: Boolean(r.isRail), isBoardwalk: Boolean(r.isBoardwalk),
      clippedStart: Boolean(r.clippedStart), clippedEnd: Boolean(r.clippedEnd),
      heightM: r.heightM, minHeightM: r.minHeightM, clearanceM: r.clearanceM, covered: r.covered, supportIds: [], osmId: r.osmId
    });
  }

  const airClearWater = Math.max(0.32, 0.48 / ctx.scaleMm, minDeckU * 0.55);
  const baseLandClearU = Math.max(0.30, 0.48 / ctx.scaleMm, Math.min(1.15, 4.8 * mToBedZ));

  for (const sp of specs) {
    const pts = sp.pts, n = pts.length, L = Math.max(0.2, _polyLenJS(pts));
    sp.spanU = L;
    const t0x = pts[1][0] - pts[0][0], t0y = pts[1][1] - pts[0][1], l0 = Math.hypot(t0x, t0y) || 1;
    const t1x = pts[n - 1][0] - pts[n - 2][0], t1y = pts[n - 1][1] - pts[n - 2][1], l1 = Math.hypot(t1x, t1y) || 1;
    const abA = _sampleAbutmentZJS(pts[0], -t0x / l0, -t0y / l0, sp.outer, terrainWater, ctx);
    const abB = _sampleAbutmentZJS(pts[n - 1], t1x / l1, t1y / l1, sp.outer, terrainWater, ctx);
    sp.zAbutmentA = abA.z; sp.zAbutmentB = abB.z;
    const inW = _stationWaterFlagsJS(pts, terrainWater);
    sp.inWater = inW; sp.crossesWater = inW.some(Boolean);
    sp.isElevatedViaduct = Boolean((sp.isRail && sp.deckLayer >= 2) || (sp.deckLayer >= 2 && sp.clippedStart && sp.clippedEnd));

    const cumS = [0];
    for (let i = 1; i < n; i++) cumS.push(cumS[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    sp.sArr = cumS;

    const baseStart = abA.inWater ? Math.max(abA.z, ctx.zWaterTop + sp.deckThick + airClearWater) : abA.z;
    const baseEnd = abB.inWater ? Math.max(abB.z, ctx.zWaterTop + sp.deckThick + airClearWater) : abB.z;
    const waterFrac = inW.filter(Boolean).length / Math.max(1, n);

    // Long multi-km viaducts (>900m, mostly dry) also clear mid-route hills without ever dipping into gorges
    const chordTop = cumS.map(s => baseStart + (baseEnd - baseStart) * (s / L));
    const spanMetersEst = L / Math.max(1e-5, mToBedXY);
    let baseTop;
    if (spanMetersEst > 900.0 && waterFrac < 0.45) {
      const rawDry = pts.map((p, i) => i === 0 ? baseStart : i === n - 1 ? baseEnd : (inW[i] ? null : terrainWater.getSurfaceZ(p[0], p[1])));
      if (rawDry[0] == null) rawDry[0] = baseStart;
      if (rawDry[n - 1] == null) rawDry[n - 1] = baseEnd;
      let prevIdx = 0;
      for (let i = 1; i < n; i++) {
        if (rawDry[i] != null) {
          for (let m = prevIdx + 1; m < i; m++) {
            const f = (cumS[m] - cumS[prevIdx]) / Math.max(1e-5, cumS[i] - cumS[prevIdx]);
            rawDry[m] = rawDry[prevIdx] + (rawDry[i] - rawDry[prevIdx]) * f;
          }
          prevIdx = i;
        }
      }
      baseTop = rawDry.map((z, i) => {
        if (i === 0 || i === n - 1) return z;
        const sm = (rawDry[i - 1] + 2 * z + rawDry[i + 1]) * 0.25;
        return sp.isElevatedViaduct ? sm : Math.max(chordTop[i], sm);
      });
    } else {
      baseTop = chordTop;
    }

    const zTopArr = baseTop.slice();

    // Local water-span camber per contiguous water crossing (eliminates 5.55x ski-jump over dry land)
    let wi = 0;
    while (wi < n) {
      if (!inW[wi]) { wi++; continue; }
      let w0 = wi;
      while (wi + 1 < n && inW[wi + 1]) wi++;
      const w1 = wi++;
      const bL = Math.max(0, w0 - 1), bR = Math.min(n - 1, w1 + 1);
      const spanW = Math.max(0.5, cumS[bR] - cumS[bL]);
      const clearNeedU = (sp.clearanceM != null && sp.clearanceM > 0)
        ? Math.min(spanW * 0.24, Math.max(airClearWater, sp.clearanceM * mToBedZ)) : airClearWater;
      const reqW = ctx.zWaterTop + sp.deckThick + clearNeedU;
      let maxDef = 0;
      for (let k = w0; k <= w1; k++) if (reqW > baseTop[k]) maxDef = Math.max(maxDef, reqW - baseTop[k]);
      if (maxDef > 0) {
        const rampU = Math.min(L * 0.38, Math.max(3.0, maxDef * 6.0));
        const s0 = w0 === 0 ? 0 : Math.max(0, cumS[w0] - rampU);
        const s1 = w1 === n - 1 ? L : Math.min(L, cumS[w1] + rampU);
        for (let k = 0; k < n; k++) {
          if ((k === 0 && !abA.inWater && !sp.clippedStart) || (k === n - 1 && !abB.inWater && !sp.clippedEnd)) continue;
          const sk = cumS[k];
          if (sk < s0 || sk > s1) continue;
          let lift = 0;
          if (k >= w0 && k <= w1) {
            const uW = Math.max(0, Math.min(1, (sk - cumS[bL]) / spanW));
            lift = Math.max(reqW - baseTop[k], maxDef * (1.0 + 0.08 * Math.sin(Math.PI * uW)));
          } else if (sk < cumS[w0]) {
            const u = (sk - s0) / Math.max(1e-5, cumS[w0] - s0);
            lift = maxDef * u * u * (3 - 2 * u);
          } else {
            const u = (s1 - sk) / Math.max(1e-5, s1 - cumS[w1]);
            lift = maxDef * u * u * (3 - 2 * u);
          }
          if (baseTop[k] + lift > zTopArr[k]) zTopArr[k] = baseTop[k] + lift;
        }
      }
      for (let k = w0; k <= w1; k++) {
        if ((k === 0 && !abA.inWater) || (k === n - 1 && !abB.inWater)) continue;
        zTopArr[k] = Math.max(zTopArr[k], ctx.zWaterTop + sp.deckThick + airClearWater);
      }
    }

    const zBotArr = zTopArr.map(zt => zt - sp.deckThick);
    sp.bbox = _bbox2DJS(sp.isAreaPoly ? sp.outer : pts);
    if (!sp.isAreaPoly) { sp.bbox[0] -= sp.width * 0.6; sp.bbox[1] -= sp.width * 0.6; sp.bbox[2] += sp.width * 0.6; sp.bbox[3] += sp.width * 0.6; }

    // 1. Dry-land layer>=1 bridge span envelope over flat terrain (preserves natural valley/gorge bridges)
    if (!sp.crossesWater && sp.deckLayer >= 1 && !sp.isBoardwalk && !sp.isElevatedViaduct && n >= 3) {
      let maxNatClear = -Infinity;
      for (let k = 1; k < n - 1; k++) {
        maxNatClear = Math.max(maxNatClear, (chordTop[k] - sp.deckThick) - terrainWater.getSurfaceZ(pts[k][0], pts[k][1]));
      }
      if (maxNatClear < baseLandClearU * 0.90) {
        const ramp = Math.min(L * 0.20, Math.max(1.2, baseLandClearU * 4.2));
        for (let k = 0; k < n; k++) {
          if ((k === 0 && !sp.clippedStart) || (k === n - 1 && !sp.clippedEnd)) continue;
          const sk = cumS[k];
          const wA = sp.clippedStart ? 1.0 : Math.min(1.0, sk / Math.max(1e-4, ramp));
          const wB = sp.clippedEnd ? 1.0 : Math.min(1.0, (L - sk) / Math.max(1e-4, ramp));
          const env = Math.min(wA * wA * (3 - 2 * wA), wB * wB * (3 - 2 * wB));
          const reqTop = terrainWater.getSurfaceZ(pts[k][0], pts[k][1]) + baseLandClearU * env + sp.deckThick;
          if (reqTop > zTopArr[k]) { zTopArr[k] = reqTop; zBotArr[k] = reqTop - sp.deckThick; }
        }
      }
    }

    // 2. Explicit clearance over lower-layer ground streets (layer=0 / cut roads) & elevated viaducts
    const landNeed = new Array(n).fill(0);
    if (sp.isElevatedViaduct) {
      const viadClearU = baseLandClearU + Math.min(0.42, 3.0 * mToBedZ) * Math.max(0, Math.min(2, sp.deckLayer - 1));
      for (let k = 0; k < n; k++) {
        if (inW[k]) continue;
        const reqTop = terrainWater.getSurfaceZ(pts[k][0], pts[k][1]) + viadClearU + sp.deckThick;
        if (reqTop > zTopArr[k]) landNeed[k] = Math.max(landNeed[k], reqTop - zTopArr[k]);
      }
    }

    if (!sp.isBoardwalk || sp.deckLayer >= 2) {
      for (const gr of groundRoads) {
        if (gr.layer >= sp.deckLayer) continue;
        if (sp.bbox[2] < gr.bbox[0] || sp.bbox[0] > gr.bbox[2] || sp.bbox[3] < gr.bbox[1] || sp.bbox[1] > gr.bbox[3]) continue;
        const rad = sp.width * 0.5 + gr.halfW + 0.08;
        for (let k = 0; k < n - 1; k++) {
          for (let q = 0; q < gr.pts.length - 1; q++) {
            const cp = _segClosestPair2DJS(pts[k], pts[k + 1], gr.pts[q], gr.pts[q + 1]);
            if (cp.dist > rad) continue;
            const zGr = Math.max(terrainWater.getSurfaceZ(cp.qb[0], cp.qb[1]), ctx.getTerrainZ(cp.qb[0], cp.qb[1]) + (terrainWater.hRoadU || 0));
            const reqTop = zGr + baseLandClearU + sp.deckThick;
            const zCur = zTopArr[k] + (zTopArr[k + 1] - zTopArr[k]) * cp.sA;
            if (reqTop > zCur) {
              const def = reqTop - zCur;
              landNeed[k] = Math.max(landNeed[k], def);
              landNeed[k + 1] = Math.max(landNeed[k + 1], def);
            }
          }
        }
      }
    }

    if (landNeed.some(v => v > 0)) {
      const pinA = !sp.isElevatedViaduct && !sp.clippedStart && !abA.inWater;
      const pinB = !sp.isElevatedViaduct && !sp.clippedEnd && !abB.inWater;
      _applyLocalSmoothLiftJS(zTopArr, zBotArr, cumS, L, landNeed, 3.8, pinA, pinB);
    }

    sp.zTopArr = zTopArr;
    sp.zBotArr = zBotArr;
  }

  // Multi-deck bridge-over-bridge clearance using local lower-deck Z and local longitudinal ramp
  specs.sort((a, b) => a.deckLayer - b.deckLayer);
  const gapU = Math.max(0.30, 0.48 / ctx.scaleMm, minDeckU * 0.48);
  for (let i = 0; i < specs.length; i++) {
    const hi = specs[i];
    for (let j = 0; j < i; j++) {
      const lo = specs[j];
      if (lo.deckLayer >= hi.deckLayer || hi.bbox[2] + 0.9 < lo.bbox[0] || hi.bbox[0] - 0.9 > lo.bbox[2] || hi.bbox[3] + 0.9 < lo.bbox[1] || hi.bbox[1] - 0.9 > lo.bbox[3]) continue;
      const need = new Array(hi.pts.length).fill(0);
      const hitRad = Math.max(0.82, (hi.width + lo.width) * 0.54);
      const segRad = (hi.width + lo.width) * 0.54;

      for (let k = 0; k < hi.pts.length; k++) {
        const hp = hi.pts[k];
        let reqBot = -Infinity;
        if (lo.isAreaPoly && _ptInRingJS(hp[0], hp[1], lo.outer)) {
          let nearZ = lo.zTopArr[0], nearD = Infinity;
          for (let q = 0; q < lo.pts.length; q++) {
            const d = Math.hypot(hp[0] - lo.pts[q][0], hp[1] - lo.pts[q][1]);
            if (d < nearD) { nearD = d; nearZ = lo.zTopArr[q]; }
          }
          reqBot = Math.max(reqBot, nearZ + gapU);
        }
        for (let q = 0; q < lo.pts.length; q++) {
          if (Math.hypot(hp[0] - lo.pts[q][0], hp[1] - lo.pts[q][1]) <= hitRad) {
            reqBot = Math.max(reqBot, lo.zTopArr[q] + gapU);
          }
        }
        for (let q = 0; q < lo.pts.length - 1; q++) {
          const a = lo.pts[q], b = lo.pts[q + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
          const t = Math.max(0, Math.min(1, ((hp[0] - a[0]) * dx + (hp[1] - a[1]) * dy) / l2));
          if (Math.hypot(hp[0] - (a[0] + dx * t), hp[1] - (a[1] + dy * t)) <= hitRad) {
            reqBot = Math.max(reqBot, lo.zTopArr[q] + (lo.zTopArr[q + 1] - lo.zTopArr[q]) * t + gapU);
          }
          if (k < hi.pts.length - 1) {
            const cp = _segClosestPair2DJS(hp, hi.pts[k + 1], a, b);
            if (cp.dist <= segRad) {
              const loZ = lo.zTopArr[q] + (lo.zTopArr[q + 1] - lo.zTopArr[q]) * cp.tB + gapU;
              const hiBotAtS = hi.zBotArr[k] + (hi.zBotArr[k + 1] - hi.zBotArr[k]) * cp.sA;
              if (loZ > hiBotAtS) {
                need[k] = Math.max(need[k], loZ - hiBotAtS);
                need[k + 1] = Math.max(need[k + 1], loZ - hiBotAtS);
              }
            }
          }
        }
        if (reqBot > hi.zBotArr[k]) need[k] = Math.max(need[k], reqBot - hi.zBotArr[k]);
      }

      if (need.some(v => v > 0)) {
        _applyLocalSmoothLiftJS(hi.zTopArr, hi.zBotArr, hi.sArr, hi.spanU, need, 4.5, false, false);
      }
    }
  }

  for (const sp of specs) {
    sp.explicitSupports = [];
    const maxDist = Math.max(sp.width * 0.85, Math.min(2.2, 12.0 * mToBedXY + 0.6));
    for (const sup of rawSupports) {
      if (!sup.pt) continue;
      const byId = sup.osmId != null && sp.supportIds.includes(sup.osmId);
      const inside = sp.isAreaPoly && _ptInRingJS(sup.pt[0], sup.pt[1], sp.outer);
      let bestS = 0, bestD = Infinity;
      for (let i = 0; i < sp.pts.length - 1; i++) {
        const a = sp.pts[i], b = sp.pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, ((sup.pt[0] - a[0]) * dx + (sup.pt[1] - a[1]) * dy) / l2));
        const d = Math.hypot(sup.pt[0] - (a[0] + dx * t), sup.pt[1] - (a[1] + dy * t));
        if (d < bestD) { bestD = d; bestS = sp.sArr[i] + Math.sqrt(l2) * t; }
      }
      if (byId || inside || bestD <= maxDist) sp.explicitSupports.push({ ...sup, sProj: bestS, distToAxis: bestD });
    }
    sp.explicitSupports.sort((a, b) => a.sProj - b.sProj);
  }
  return specs;
}

const _GRAPH_SOLVER_EXPORTS = { solveBridgeGraph };
if (typeof window !== 'undefined') Object.assign(window, _GRAPH_SOLVER_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _GRAPH_SOLVER_EXPORTS;
