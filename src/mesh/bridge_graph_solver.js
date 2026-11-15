// ============================================================================
// src/mesh/bridge_graph_solver.js
// Unified OSM Bridge Graph, Multi-Carriageway Merge, Grade Z(s) & Supports
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

function solveBridgeGraph(scene, terrainWater, ctx) {
  const s2b = ctx.scaleToBed || 1.0, mToBedZ = ctx.mToU * ctx.zScale, minDeckU = (ctx.cfg ? ctx.cfg.bridgeDeckMinMm : 0.719) / ctx.scaleMm;
  const rawPolys = (scene.bridgePolys || []).filter(bp => bp && !bp.isPier && bp.outer && bp.outer.length >= 3);
  const rawRoads = (scene.roads || []).filter(rd => rd && (rd.isBridge || rd.bridge) && rd.pts && rd.pts.length >= 2);
  const rawSupports = (scene.bridgeSupports || []).map(sp => ({
    ...sp, pt: sp.pt ? [sp.pt[0] * s2b, sp.pt[1] * s2b] : null,
    outer: sp.outer ? sp.outer.map(p => [p[0] * s2b, p[1] * s2b]) : null,
    pts: sp.pts ? sp.pts.map(p => [p[0] * s2b, p[1] * s2b]) : null
  }));
  const consumedRoadOsmIds = new Set(), specs = [];

  for (const bp of rawPolys) {
    const outer = bp.outer.map(p => [p[0] * s2b, p[1] * s2b]);
    const holes = (bp.holes || []).map(h => h.map(p => [p[0] * s2b, p[1] * s2b]));
    const linked = rawRoads.filter(rd => rd._bridgePolyOsmId === bp.osmId || (bp.acrossRoadIds && bp.acrossRoadIds.includes(rd.osmId)));
    linked.forEach(rd => { if (rd.osmId != null) consumedRoadOsmIds.add(rd.osmId); });
    const axisRaw = _extractClippedAxisFromRoadsJS(outer, linked.map(r => r.pts.map(p => [p[0] * s2b, p[1] * s2b]))) || _extractCurvedSpineFromPolyJS(outer);
    const spanU = Math.max(0.4, _polyLenJS(axisRaw));
    const obb = typeof computeMinAreaOBB2D === 'function' ? computeMinAreaOBB2D(outer) : null;
    const estW = typeof _estimatePolyRibbonWidthJS === 'function' ? _estimatePolyRibbonWidthJS(outer, axisRaw, obb) : (obb && Number.isFinite(obb.halfW) ? obb.halfW * 2 : 1.5);
    const widthU = Math.max(minDeckU * 1.4, Number.isFinite(estW) ? estW : 1.5);
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
    specs.push({
      isAreaPoly: true, outer, holes, pts: _resamplePolyJS(axisRaw, Math.max(5, Math.min(21, Math.ceil(spanU / 1.5) + 1))),
      width: widthU, deckThick: Math.max(minDeckU, Math.min(widthU * 0.38, minDeckU * (structNorm === 'beam' ? 1.15 : 1.25))),
      deckLayer: bp.layer ?? 1, name: bp.name || 'Most', structNorm, explicitThroughArch: expThrough,
      heightM, minHeightM: bp.minHeightM, clearanceM, covered: bp.covered, supportIds: bp.supportIds || [], osmId: bp.osmId
    });
  }

  const freeRoads = rawRoads.filter(rd => rd.osmId == null || !consumedRoadOsmIds.has(rd.osmId)).map(rd => {
    const rawSt = rd.bridgeStructure || rd.structure || (rd.tags && (rd.tags['bridge:structure'] || rd.tags.bridge));
    const cov = rd.covered || (rd.tags && rd.tags.covered);
    return {
      pts: rd.pts.map(p => [p[0] * s2b, p[1] * s2b]), width: Math.max(0.28, (rd.width || 0.8) * s2b),
      layer: rd.hasExplicitLayer !== undefined ? (rd.hasExplicitLayer ? rd.layer : 1) : (rd.layer ?? 1),
      parentBridgeRelId: rd.parentBridgeRelId, name: rd.name || '',
      structNorm: _normalizeBridgeStructJS(rawSt, cov, rd.tags),
      explicitThroughArch: /through[-_ ]?arch|tied[-_ ]?arch|bowstring/i.test(String(rawSt || '')),
      heightM: rd.heightM, minHeightM: rd.minHeightM, clearanceM: rd.clearanceM, covered: cov, osmId: rd.osmId
    };
  });
  for (const r of _stitchAndMergeLinearBridgesJS(freeRoads)) {
    const spanU = Math.max(0.4, _polyLenJS(r.pts));
    specs.push({
      isAreaPoly: false, outer: null, holes: [], pts: _resamplePolyJS(r.pts, Math.max(5, Math.min(21, Math.ceil(spanU / 1.5) + 1))),
      width: Math.max(minDeckU * 1.15, r.width), deckThick: Math.max(minDeckU, Math.min(r.width * 0.38, minDeckU * 1.15)),
      deckLayer: r.layer ?? 1, name: r.name, structNorm: r.structNorm, explicitThroughArch: r.explicitThroughArch,
      heightM: r.heightM, minHeightM: r.minHeightM, clearanceM: r.clearanceM, covered: r.covered, supportIds: [], osmId: r.osmId
    });
  }

  const airClearWater = Math.max(0.32, minDeckU * 0.55);
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
    const clearNeedU = (sp.crossesWater && sp.clearanceM != null && sp.clearanceM > 0)
      ? Math.min(L * 0.24, Math.max(airClearWater, sp.clearanceM * mToBedZ)) : airClearWater;
    const baseStart = abA.inWater ? Math.max(abA.z, ctx.zWaterTop + sp.deckThick + airClearWater) : abA.z;
    const baseEnd = abB.inWater ? Math.max(abB.z, ctx.zWaterTop + sp.deckThick + airClearWater) : abB.z;
    const cumS = [0];
    for (let i = 1; i < n; i++) cumS.push(cumS[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const baseTop = cumS.map(s => baseStart + (baseEnd - baseStart) * (s / L));
    let midBoost = 0;
    for (let i = 1; i < n - 1; i++) {
      if (!inW[i]) continue;
      const u = cumS[i] / L, shape = Math.max(0.18, Math.pow(Math.sin(Math.PI * Math.max(0.05, Math.min(0.95, u))), 0.72));
      const req = ctx.zWaterTop + sp.deckThick + clearNeedU;
      if (req > baseTop[i]) midBoost = Math.max(midBoost, (req - baseTop[i]) / shape);
    }
    sp.sArr = cumS;
    sp.zTopArr = cumS.map((s, i) => {
      const z = baseTop[i] + ((i === 0 || i === n - 1) ? 0 : midBoost * Math.pow(Math.sin(Math.PI * (s / L)), 0.72));
      return inW[i] ? Math.max(z, ctx.zWaterTop + sp.deckThick + airClearWater) : z;
    });
    sp.zBotArr = sp.zTopArr.map(zt => zt - sp.deckThick);
    sp.bbox = _bbox2DJS(sp.isAreaPoly ? sp.outer : pts);
    if (!sp.isAreaPoly) { sp.bbox[0] -= sp.width * 0.6; sp.bbox[1] -= sp.width * 0.6; sp.bbox[2] += sp.width * 0.6; sp.bbox[3] += sp.width * 0.6; }
  }

  specs.sort((a, b) => a.deckLayer - b.deckLayer);
  const gapU = Math.max(0.28, minDeckU * 0.45);
  for (let i = 0; i < specs.length; i++) {
    const hi = specs[i];
    for (let j = 0; j < i; j++) {
      const lo = specs[j];
      if (lo.deckLayer >= hi.deckLayer || hi.bbox[2] + 0.9 < lo.bbox[0] || hi.bbox[0] - 0.9 > lo.bbox[2] || hi.bbox[3] + 0.9 < lo.bbox[1] || hi.bbox[1] - 0.9 > lo.bbox[3]) continue;
      const loMaxTop = Math.max(...lo.zTopArr), need = hi.pts.map(() => 0);
      let maxNeed = 0;
      const hitRad = Math.max(0.85, (hi.width + lo.width) * 0.65);
      for (let k = 0; k < hi.pts.length; k++) {
        const hp = hi.pts[k];
        let hit = lo.isAreaPoly && _ptInRingJS(hp[0], hp[1], lo.outer);
        if (!hit) {
          for (let q = 0; q < lo.pts.length - 1; q++) {
            const a = lo.pts[q], b = lo.pts[q + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
            const t = Math.max(0, Math.min(1, ((hp[0] - a[0]) * dx + (hp[1] - a[1]) * dy) / l2));
            if (Math.hypot(hp[0] - (a[0] + dx * t), hp[1] - (a[1] + dy * t)) <= hitRad) { hit = true; break; }
          }
        }
        if (hit && hi.zBotArr[k] <= loMaxTop + gapU) { need[k] = loMaxTop + gapU - hi.zBotArr[k]; maxNeed = Math.max(maxNeed, need[k]); }
      }
      if (maxNeed > 0) {
        const hitEnds = need[0] > 0 || need[need.length - 1] > 0;
        for (let k = 0; k < hi.pts.length; k++) {
          let lift = hitEnds ? maxNeed : 0;
          if (!hitEnds) {
            const uk = hi.sArr[k] / hi.spanU;
            for (let m = 0; m < need.length; m++) if (need[m] > 0) {
              const um = hi.sArr[m] / hi.spanU;
              lift = Math.max(lift, need[m] * (uk <= um ? uk / Math.max(0.04, um) : (1 - uk) / Math.max(0.04, 1 - um)));
            }
          }
          hi.zTopArr[k] += lift; hi.zBotArr[k] += lift;
        }
      }
    }
  }

  for (const sp of specs) {
    sp.explicitSupports = [];
    const maxDist = Math.max(sp.width * 0.85, 2.2);
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
