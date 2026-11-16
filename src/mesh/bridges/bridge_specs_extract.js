// ============================================================================
// src/mesh/bridges/bridge_specs_extract.js
// OSM Area-Bridge & Linear-Bridge Graph Spec Extraction & Support Association
// ============================================================================

if (typeof _normalizeBridgeStructJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(globalThis, require('./bridge_geom_2d.js'));
}
if (typeof _stitchAndMergeLinearBridgesJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(globalThis, require('./bridge_spine_stitch.js'));
}
if (typeof _stationWaterFlagsJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(globalThis, require('./bridge_tin_sampler.js'));
}

function _extractBridgeSpecsFromSceneJS(scene, terrainWater, ctx) {
  const s2b = ctx.scaleToBed || 1.0;
  const toBed = typeof ctx.toBed === 'function' ? ctx.toBed : (p => [p[0] * s2b, p[1] * s2b]);
  const mToBedXY = ctx.mToU * s2b;
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
      groundRoads.push({
        pts: pc.pts, halfW: hw, layer: lyr, isPath: Boolean(rd.isPath),
        osmId: rd.osmId ?? null, name: rd.name || '',
        bbox: [bb[0] - hw, bb[1] - hw, bb[2] + hw, bb[3] + hw]
      });
    }
  }

  const allSceneRoadByOsmId = new Map();
  for (const rd of (scene.roads || [])) if (rd && rd.osmId != null) allSceneRoadByOsmId.set(rd.osmId, rd);

  const roadLinkedPolyList = new Map();
  const specs = [];
  for (const bp of rawPolys) {
    const outer = bp.outer.map(toBed), pbb = _bbox2DJS(outer);
    if (pbb[2] < cMinX || pbb[0] > cMaxX || pbb[3] < cMinY || pbb[1] > cMaxY) continue;
    const holes = (bp.holes || []).map(h => h.map(toBed));
    const linked = rawRoads.filter(rd =>
      rd._bridgePolyOsmId === bp.osmId ||
      (Array.isArray(rd._bridgePolyOsmIds) && rd._bridgePolyOsmIds.includes(bp.osmId)) ||
      (bp.acrossRoadIds && bp.acrossRoadIds.includes(rd.osmId))
    );
    for (const rd of linked) {
      if (!roadLinkedPolyList.has(rd)) roadLinkedPolyList.set(rd, []);
      roadLinkedPolyList.get(rd).push({ bp, outer });
    }
    const surfaceAcross = (bp.acrossRoadIds || [])
      .map(id => allSceneRoadByOsmId.get(id))
      .filter(rd => rd && !(rd.isBridge || rd.bridge) && rd.pts && rd.pts.length >= 2);
    const axisCandidates = linked.length > 0 ? linked : surfaceAcross;
    const axisRaw = _extractClippedAxisFromRoadsJS(outer, axisCandidates.map(r => r.pts.map(toBed)), mToBedXY) || _extractCurvedSpineFromPolyJS(outer);
    const spanU = Math.max(0.4, _polyLenJS(axisRaw));
    const obb = typeof computeMinAreaOBB2D === 'function' ? computeMinAreaOBB2D(outer) : null;
    const estW = typeof _estimatePolyRibbonWidthJS === 'function' ? _estimatePolyRibbonWidthJS(outer, axisRaw, obb) : 1.5;
    const widthU = Math.max(minDeckU * 1.3, Number.isFinite(estW) ? estW : 1.5);
    const rawBpStruct = bp.bridgeStructure || (bp.tags && bp.tags['bridge:structure']);
    const rawBpTrim = String(rawBpStruct || '').trim().toLowerCase();
    const hasExplicitBpStruct = Boolean(rawBpTrim && !['yes', 'viaduct', 'bridge', 'movable'].includes(rawBpTrim));
    let structNorm = _normalizeBridgeStructJS(rawBpStruct, bp.covered, bp.tags);
    let expThrough = /through[-_ ]?arch|tied[-_ ]?arch|bowstring/i.test(String(rawBpStruct || ''));
    let isHumpback = /humpback/i.test(String(rawBpStruct || ''));
    let heightM = bp.heightM, clearanceM = bp.clearanceM;
    for (const rd of linked) {
      const rs = _normalizeBridgeStructJS(rd.bridgeStructure, rd.covered, rd.tags);
      if (!hasExplicitBpStruct && _structRankJS(rs) > _structRankJS(structNorm)) structNorm = rs;
      if (!hasExplicitBpStruct && /through[-_ ]?arch|tied[-_ ]?arch|bowstring/i.test(String(rd.bridgeStructure || ''))) expThrough = true;
      if (!hasExplicitBpStruct && /humpback/i.test(String(rd.bridgeStructure || ''))) isHumpback = true;
      if (heightM == null && rd.heightM != null) heightM = rd.heightM;
      if (clearanceM == null && rd.clearanceM != null) clearanceM = rd.clearanceM;
    }
    const allAcross = linked.concat(surfaceAcross);
    const carriedVerts = [];
    const acrossOsmIdSet = new Set(bp.acrossRoadIds || []);
    for (const cr of allAcross) {
      if (cr && cr.osmId != null) acrossOsmIdSet.add(cr.osmId);
      for (const p of (cr && cr.pts) || []) carriedVerts.push(toBed(p));
    }
    const hasExplicitBpLayer = Boolean((bp.tags && bp.tags.layer !== undefined) || bp.hasExplicitLayer);
    const inferredPolyLayer = (!hasExplicitBpLayer && linked.length > 0)
      ? Math.max(bp.layer ?? 1, ...linked.map(r => r.layer ?? 1))
      : (bp.layer ?? 1);
    const nSt = Math.max(7, Math.min(160, Math.ceil(spanU / 0.80) + 1));
    specs.push({
      isAreaPoly: true, outer, holes, pts: _resamplePolyJS(axisRaw, nSt),
      width: widthU, deckThick: Math.max(minDeckU, Math.min(widthU * 0.35, minDeckU * (structNorm === 'beam' ? 1.15 : 1.22))),
      deckLayer: inferredPolyLayer, name: bp.name || 'Most', structNorm, explicitThroughArch: expThrough, isHumpback,
      isRail: allAcross.length > 0 && allAcross.every(rd => rd.tags && rd.tags.railway),
      isPath: false, isBoardwalk: false, level: bp.level || '',
      clippedStart: false, clippedEnd: false, joinPolyStart: false, joinPolyEnd: false,
      acrossOsmIdSet, carriedVerts, linkedPolyOsmIds: [],
      heightM, minHeightM: bp.minHeightM, clearanceM, covered: bp.covered, supportIds: bp.supportIds || [], osmId: bp.osmId
    });
  }

  const polyOverlapU = Math.max(0.25, 0.6 * mToBedXY);
  const minOutsideSubU = Math.max(0.10, 0.8 * mToBedXY);
  const freeRoadPieces = [];
  for (const rd of rawRoads) {
    const linkedEntries = roadLinkedPolyList.get(rd) || [];
    const linkedPolyOsmIds = linkedEntries.map(e => e.bp && e.bp.osmId).filter(id => id != null);
    const rawSt = rd.bridgeStructure || rd.structure || (rd.tags && (rd.tags['bridge:structure'] || rd.tags.bridge));
    const cov = rd.covered || (rd.tags && rd.tags.covered);
    const isRail = Boolean((rd.tags && rd.tags.railway) || ['rail', 'light_rail', 'tram', 'monorail', 'subway', 'narrow_gauge', 'funicular'].includes(rd.hwy));
    const isBoardwalk = String((rd.tags && rd.tags.bridge) || rawSt || '').trim().toLowerCase() === 'boardwalk';
    let sourcePolylines;
    if (linkedEntries.length > 0) {
      const rings = linkedEntries.map(e => e.outer);
      const subs = typeof _splitPolylineOutsideRingsJS === 'function'
        ? _splitPolylineOutsideRingsJS(rd.pts.map(toBed), rings, polyOverlapU, minOutsideSubU)
        : [];
      if (!subs.length) continue;
      sourcePolylines = subs.filter(sub => !isBoardwalk || _stationWaterFlagsJS(sub.pts, terrainWater).some(Boolean));
      if (!sourcePolylines.length) continue;
    } else {
      sourcePolylines = [{ pts: rd.pts.map(toBed), entersRingAtStart: false, entersRingAtEnd: false }];
    }

    const effLayer = rd.hasExplicitLayer !== undefined
      ? (rd.hasExplicitLayer ? rd.layer : (linkedEntries.length > 0 ? (linkedEntries[0].bp.layer ?? 1) : 1))
      : (rd.layer ?? 1);
    for (const sub of sourcePolylines) {
      for (const pc of _clipPolylineToRectJS(sub.pts, cMinX, cMinY, cMaxX, cMaxY)) {
        freeRoadPieces.push({
          pts: pc.pts,
          clippedStart: pc.clippedStart,
          clippedEnd: pc.clippedEnd,
          joinPolyStart: Boolean(sub.entersRingAtStart && !pc.clippedStart),
          joinPolyEnd: Boolean(sub.entersRingAtEnd && !pc.clippedEnd),
          linkedPolyOsmIds,
          width: Math.max(isRail || rd.isPath ? 0.20 : 0.28, (rd.width || 0.8) * s2b),
          layer: effLayer,
          parentBridgeRelId: rd.parentBridgeRelId, name: rd.name || '',
          isRail, isPath: Boolean(rd.isPath), isBoardwalk, level: rd.level || (rd.tags && rd.tags.level) || '',
          structNorm: _normalizeBridgeStructJS(rawSt, cov, rd.tags),
          explicitThroughArch: /through[-_ ]?arch|tied[-_ ]?arch|bowstring/i.test(String(rawSt || '')),
          isHumpback: /humpback/i.test(String(rawSt || '')),
          heightM: rd.heightM, minHeightM: rd.minHeightM, clearanceM: rd.clearanceM, covered: cov, osmId: rd.osmId
        });
      }
    }
  }

  for (const r of _stitchAndMergeLinearBridgesJS(freeRoadPieces, { mToBedXY, scaleMm: ctx.scaleMm })) {
    const spanU = Math.max(0.4, _polyLenJS(r.pts));
    const spanMetersLinear = spanU / Math.max(1e-5, mToBedXY);
    const isShortPolyStub = Boolean((r.joinPolyStart || r.joinPolyEnd) && spanMetersLinear < 25.0);
    const effStruct = (isShortPolyStub || (spanMetersLinear < 14.0 && !r.explicitThroughArch && r.structNorm === 'arch'))
      ? 'beam'
      : r.structNorm;
    const slender = Boolean(r.isRail || r.isPath);
    const minW = slender ? Math.max(0.54 / ctx.scaleMm, minDeckU * 0.78) : minDeckU * 1.12;
    const widthU = Math.max(minW, r.width);
    const deckThick = Math.max(slender ? Math.max(0.56 / ctx.scaleMm, minDeckU * 0.82) : minDeckU, Math.min(widthU * 0.40, minDeckU * 1.15));
    const nSt = Math.max(7, Math.min(160, Math.ceil(spanU / 0.80) + 1));
    const resampledPts = _resamplePolyJS(r.pts, nSt);
    specs.push({
      isAreaPoly: false, outer: null, holes: [], pts: resampledPts,
      width: widthU, deckThick, deckLayer: r.layer ?? 1, name: r.name, structNorm: effStruct,
      explicitThroughArch: Boolean(!isShortPolyStub && r.explicitThroughArch),
      isHumpback: Boolean(!isShortPolyStub && r.isHumpback),
      isRail: Boolean(r.isRail),
      isPath: Boolean(r.isPath), isBoardwalk: Boolean(r.isBoardwalk), level: r.level || '',
      clippedStart: Boolean(r.clippedStart), clippedEnd: Boolean(r.clippedEnd),
      joinPolyStart: Boolean(r.joinPolyStart), joinPolyEnd: Boolean(r.joinPolyEnd),
      acrossOsmIdSet: null, carriedVerts: [resampledPts[0], resampledPts[resampledPts.length - 1]],
      linkedPolyOsmIds: r.linkedPolyOsmIds || [],
      heightM: r.heightM, minHeightM: r.minHeightM, clearanceM: r.clearanceM, covered: r.covered, supportIds: [], osmId: r.osmId
    });
  }

  return { specs, groundRoads, rawSupports, mToBedXY, minDeckU };
}

function _attachExplicitSupportsToSpecsJS(specs, rawSupports, mToBedXY) {
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
}

const _BRIDGE_SPECS_EXTRACT_EXPORTS = { _extractBridgeSpecsFromSceneJS, _attachExplicitSupportsToSpecsJS };
if (typeof globalThis !== 'undefined') Object.assign(globalThis, _BRIDGE_SPECS_EXTRACT_EXPORTS);
if (typeof window !== 'undefined') Object.assign(window, _BRIDGE_SPECS_EXTRACT_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _BRIDGE_SPECS_EXTRACT_EXPORTS;
