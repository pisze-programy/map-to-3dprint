// ============================================================================
// src/mesh/bridges/bridge_specs_extract.js
// OSM Area-Bridge, Linear-Bridge & Pier-Gangway Spec Extraction & Supports
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

function _collectPierAnchorsForBridgesJS(scene, terrainWater, ctx, toBed, s2b) {
  const scaleMm = ctx.scaleMm || 1.89;
  const laws = ctx.slaLaws || (typeof SLA_PRINT_LAWS !== 'undefined' ? SLA_PRINT_LAWS : null);
  const deckThickMm = laws && typeof laws.minWallThicknessMm === 'function' ? Math.max(0.50, laws.minWallThicknessMm(0.55)) : 0.50;
  const deckThickU = deckThickMm / scaleMm;
  const anchors = [];
  const seen = new Set();

  const resolveHeights = (rec, pierKind, cx, cy) => {
    const isSolidStone = pierKind === 'breakwater' || pierKind === 'groyne';
    const inWater = terrainWater && terrainWater.isPointInWater(cx, cy);
    const waterTop = inWater
      ? ((terrainWater && typeof terrainWater.getNominalWaterTopZ === 'function')
          ? terrainWater.getNominalWaterTopZ(cx, cy)
          : ((!ctx.waterCutout && terrainWater && typeof terrainWater.getWaterTopZ === 'function')
              ? terrainWater.getWaterTopZ(cx, cy)
              : ctx.zWaterTop))
      : ctx.zWaterTop;
    const pileFloorZ = ctx.waterCutout
      ? 0.0
      : Math.max(0.0, (terrainWater && terrainWater.getWaterFloorZ ? terrainWater.getWaterFloorZ(cx, cy) : ctx.zWaterCarveFloor) - 0.15 / scaleMm);
    if (typeof computePierDeckHeights === 'function') {
      return computePierDeckHeights(ctx, laws, rec, pierKind, waterTop, pileFloorZ);
    }
    const isFloating = Boolean(rec.floating || (rec.tags && (rec.tags.floating === 'yes' || rec.tags.platform === 'floating')) || pierKind === 'pontoon');
    const rawGapMm = isSolidStone ? 0 : ((ctx.supportlessMode || isFloating) ? 0.08 : 0.48);
    const resolvedGapMm = rawGapMm < 0.24 ? 0 : Math.max(0.48, rawGapMm);
    const needsPiles = !isSolidStone && resolvedGapMm >= 0.48;
    const zDeckBot = needsPiles ? (waterTop + resolvedGapMm / scaleMm) : pileFloorZ;
    const zDeckTop = needsPiles
      ? (zDeckBot + deckThickU)
      : (isSolidStone
          ? Math.max(ctx.zLandDatum + 0.16 / scaleMm, waterTop + deckThickU, zDeckBot + deckThickU + 0.15 / scaleMm)
          : Math.max(waterTop + deckThickU + (isFloating ? 0.08 / scaleMm : 0), zDeckBot + deckThickU + 0.15 / scaleMm));
    return { isFloating, zDeckBot, zDeckTop };
  };

  const pushArea = (rec) => {
    if (!rec || !rec.outer || rec.outer.length < 3) return;
    const k = rec.osmId != null ? `A:${rec.osmId}` : null;
    if (k && seen.has(k)) return;
    if (k) seen.add(k);
    const outer = rec.outer.map(toBed);
    const bb = _bbox2DJS(outer);
    const pierKind = rec.pierKind || (rec.tags && rec.tags.man_made) || 'pier';
    const h = resolveHeights(rec, pierKind, (bb[0] + bb[2]) * 0.5, (bb[1] + bb[3]) * 0.5);
    anchors.push({ isArea: true, outer, pts: null, halfW: 0, bb, zPierTop: h.zDeckTop, zPierBot: h.zDeckBot, isFloating: Boolean(h.isFloating) });
  };

  const pushLine = (rec) => {
    if (!rec || !rec.pts || rec.pts.length < 2) return;
    const k = rec.osmId != null ? `L:${rec.osmId}` : null;
    if (k && seen.has(k)) return;
    if (k) seen.add(k);
    const pts = rec.pts.map(toBed);
    const halfW = Math.max((ctx.minPrintU || 0.1) * 0.7, ((rec.width || 0.8) * 0.5) * s2b);
    const bb = _bbox2DJS(pts);
    const pierKind = rec.pierKind || (rec.tags && rec.tags.man_made) || rec.man_made || 'pier';
    const mid = pts[pts.length >> 1];
    const h = resolveHeights(rec, pierKind, mid[0], mid[1]);
    anchors.push({
      isArea: false, outer: null, pts, halfW,
      bb: [bb[0] - halfW, bb[1] - halfW, bb[2] + halfW, bb[3] + halfW],
      zPierTop: h.zDeckTop, zPierBot: h.zDeckBot, isFloating: Boolean(h.isFloating)
    });
  };

  const lineOsmIds = new Set(((scene && scene.pierLines) || []).map(pl => pl && pl.osmId).filter(id => id != null));
  for (const bp of (scene && scene.bridgePolys) || []) {
    if (!bp || !bp.isPier) continue;
    if (bp.isPierLine && bp.osmId != null && lineOsmIds.has(bp.osmId)) continue;
    pushArea(bp);
  }
  for (const pp of (scene && scene.pierPolys) || []) if (pp && !pp._inBridgePolys) pushArea(pp);
  for (const pl of (scene && scene.pierLines) || []) pushLine(pl);
  return anchors;
}

function _matchPierAnchorAtPtJS(px, py, pierAnchors, snapTolU) {
  let best = null, bestD = Infinity;
  for (let i = 0; i < pierAnchors.length; i++) {
    const pa = pierAnchors[i];
    if (px < pa.bb[0] - snapTolU || px > pa.bb[2] + snapTolU || py < pa.bb[1] - snapTolU || py > pa.bb[3] + snapTolU) continue;
    if (pa.isArea) {
      if (_ptInRingJS(px, py, pa.outer)) return pa;
      const d = _ptToPolyDist2DJS(px, py, pa.outer.concat([pa.outer[0]]));
      if (d <= snapTolU && d < bestD) { bestD = d; best = pa; }
    } else {
      const d = Math.max(0, _ptToPolyDist2DJS(px, py, pa.pts) - pa.halfW);
      if (d <= snapTolU && d < bestD) { bestD = d; best = pa; }
    }
  }
  return best;
}

function _extractBridgeSpecsFromSceneJS(scene, terrainWater, ctx) {
  const s2b = ctx.scaleToBed || 1.0;
  const scaleMm = ctx.scaleMm || 1.89;
  const toBed = typeof ctx.toBed === 'function' ? ctx.toBed : (p => [p[0] * s2b, p[1] * s2b]);
  const mToBedXY = ctx.mToU * s2b;
  const minDeckU = (ctx.cfg ? ctx.cfg.bridgeDeckMinMm : 0.719) / scaleMm;
  const clipPad = 2.0, cMinX = -ctx.halfW - clipPad, cMaxX = ctx.halfW + clipPad, cMinY = -ctx.halfH - clipPad, cMaxY = ctx.halfH + clipPad;

  const rawPolys = (scene.bridgePolys || []).filter(bp => bp && !bp.isPier && bp.outer && bp.outer.length >= 3);
  const rawRoads = (scene.roads || []).filter(rd => rd && (rd.isBridge || rd.bridge) && rd.pts && rd.pts.length >= 2);
  const rawSupports = (scene.bridgeSupports || []).map(sp => ({
    ...sp, pt: sp.pt ? toBed(sp.pt) : null,
    outer: sp.outer ? sp.outer.map(toBed) : null,
    pts: sp.pts ? sp.pts.map(toBed) : null
  }));
  const pierAnchors = _collectPierAnchorsForBridgesJS(scene, terrainWater, ctx, toBed, s2b);

  const groundRoads = [];
  for (const rd of (scene.roads || [])) {
    if (!rd || rd.isBridge || rd.bridge || !rd.pts || rd.pts.length < 2) continue;
    const hw = Math.max(0.24 / scaleMm, ((rd.width || 0.7) * 0.5) * s2b);
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

  const stepStationU = Math.max(0.06, Math.min(0.80, 1.25 / scaleMm));
  const roadLinkedPolyList = new Map();
  const specs = [];

  const polyEntries = [];
  for (const bp of rawPolys) {
    const outer = bp.outer.map(toBed), pbb = _bbox2DJS(outer);
    if (pbb[2] < cMinX || pbb[0] > cMaxX || pbb[3] < cMinY || pbb[1] > cMaxY) continue;
    const linked = rawRoads.filter(rd =>
      rd._bridgePolyOsmId === bp.osmId ||
      (Array.isArray(rd._bridgePolyOsmIds) && rd._bridgePolyOsmIds.includes(bp.osmId)) ||
      (bp.acrossRoadIds && bp.acrossRoadIds.includes(rd.osmId))
    );
    const spine = _extractCurvedSpineFromPolyJS(outer);
    const spineLen = Math.max(0.15, _polyLenJS(spine));
    polyEntries.push({ bp, outer, pbb, linked, spine, spineLen });
  }

  const suppressedEnvelopeOsmIds = new Set();
  for (let peIdx = 0; peIdx < polyEntries.length; peIdx++) {
    const { bp, outer, linked, spine, spineLen } = polyEntries[peIdx];
    if (linked.length > 0) {
      let coextUpper = null;
      const proxTol = Math.max(1.5 * mToBedXY, 0.35 / scaleMm);
      for (let hiIdx = 0; hiIdx < polyEntries.length; hiIdx++) {
        if (hiIdx === peIdx) continue;
        const cand = polyEntries[hiIdx];
        if ((cand.bp.layer ?? 1) <= (bp.layer ?? 1)) continue;
        const ratio = spineLen / Math.max(1e-5, cand.spineLen);
        if (ratio < 0.78 || ratio > 1.28) continue;
        let insideCnt = 0;
        for (let q = 0; q < spine.length; q++) {
          if (_ptInRingJS(spine[q][0], spine[q][1], cand.outer) || _ptToPolyDist2DJS(spine[q][0], spine[q][1], cand.spine) <= proxTol) insideCnt++;
        }
        if (insideCnt >= Math.ceil(spine.length * 0.65)) { coextUpper = cand; break; }
      }
      if (coextUpper) {
        let maxInsideRoadSpan = 0;
        for (const rd of linked) {
          const rPts = rd.pts.map(toBed);
          const rDense = _resamplePolyJS(rPts, Math.max(13, Math.min(80, Math.ceil(_polyLenJS(rPts) / 0.6) + 1)));
          let inLen = 0;
          for (let q = 0; q < rDense.length - 1; q++) {
            const mx = 0.5 * (rDense[q][0] + rDense[q + 1][0]), my = 0.5 * (rDense[q][1] + rDense[q + 1][1]);
            if (_ptInRingJS(mx, my, outer)) inLen += Math.hypot(rDense[q + 1][0] - rDense[q][0], rDense[q + 1][1] - rDense[q][1]);
          }
          if (inLen > maxInsideRoadSpan) maxInsideRoadSpan = inLen;
        }
        if (maxInsideRoadSpan >= 0.18 * spineLen && maxInsideRoadSpan < 0.72 * spineLen) {
          if (bp.osmId != null) suppressedEnvelopeOsmIds.add(bp.osmId);
          if (Array.isArray(bp.supportIds) && bp.supportIds.length > 0) {
            coextUpper.bp.supportIds = coextUpper.bp.supportIds || [];
            for (const sid of bp.supportIds) if (!coextUpper.bp.supportIds.includes(sid)) coextUpper.bp.supportIds.push(sid);
          }
          continue;
        }
      }
    }

    const holes = (bp.holes || []).map(h => h.map(toBed));
    for (const rd of linked) {
      if (!roadLinkedPolyList.has(rd)) roadLinkedPolyList.set(rd, []);
      roadLinkedPolyList.get(rd).push({ bp, outer });
    }
    const surfaceAcross = (bp.acrossRoadIds || [])
      .map(id => allSceneRoadByOsmId.get(id))
      .filter(rd => rd && !(rd.isBridge || rd.bridge) && rd.pts && rd.pts.length >= 2);
    const axisCandidates = linked.length > 0 ? linked : surfaceAcross;
    const axisRaw = _extractClippedAxisFromRoadsJS(outer, axisCandidates.map(r => r.pts.map(toBed)), mToBedXY) || _extractCurvedSpineFromPolyJS(outer);
    const spanU = Math.max(0.15, _polyLenJS(axisRaw));
    const spanMetersPoly = spanU / Math.max(1e-5, mToBedXY);
    const obb = typeof computeMinAreaOBB2D === 'function' ? computeMinAreaOBB2D(outer) : null;
    const estW = typeof _estimatePolyRibbonWidthJS === 'function' ? _estimatePolyRibbonWidthJS(outer, axisRaw, obb) : 1.5;
    const widthU = Math.max(minDeckU * 1.15, Number.isFinite(estW) ? estW : 1.5);
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
    const nSt = Math.max(13, Math.min(200, Math.ceil(spanU / stepStationU) + 1));
    const resampledPolyPts = _resamplePolyJS(axisRaw, nSt);
    const pierSnapU = Math.max(widthU * 0.55, Math.min(0.55 / scaleMm, 3.5 * mToBedXY));
    const joinPierStart = pierAnchors.length ? _matchPierAnchorAtPtJS(resampledPolyPts[0][0], resampledPolyPts[0][1], pierAnchors, pierSnapU) : null;
    const joinPierEnd = pierAnchors.length ? _matchPierAnchorAtPtJS(resampledPolyPts[nSt - 1][0], resampledPolyPts[nSt - 1][1], pierAnchors, pierSnapU) : null;
    const isPierGangway = Boolean((joinPierStart || joinPierEnd) && spanMetersPoly < 75.0);
    if (isPierGangway) { structNorm = 'beam'; expThrough = false; isHumpback = false; }

    specs.push({
      isAreaPoly: true, outer, holes, pts: resampledPolyPts, scaleMm,
      width: widthU, deckThick: Math.max(minDeckU, Math.min(widthU * 0.35, minDeckU * (structNorm === 'beam' ? 1.15 : 1.22))),
      deckLayer: inferredPolyLayer, name: bp.name || 'Most', structNorm, explicitThroughArch: expThrough, isHumpback,
      bridgeSupport: bp.bridgeSupport || String((bp.tags && bp.tags['bridge:support']) || '').trim().toLowerCase(),
      isRail: allAcross.length > 0 && allAcross.every(rd => rd.tags && rd.tags.railway),
      isPath: false, isBoardwalk: false, level: bp.level || '',
      clippedStart: false, clippedEnd: false, joinPolyStart: false, joinPolyEnd: false,
      joinPierStart, joinPierEnd, isPierGangway, joinBridgeStart: null, joinBridgeEnd: null,
      acrossOsmIdSet, carriedVerts, linkedPolyOsmIds: [],
      heightM, minHeightM: bp.minHeightM, clearanceM, covered: bp.covered, supportIds: bp.supportIds || [], osmId: bp.osmId
    });
  }

  const polyOverlapU = Math.min(0.22 / scaleMm, Math.max(0.06 / scaleMm, 0.8 * mToBedXY));
  const minOutsideSubU = Math.max(0.08 / scaleMm, 0.8 * mToBedXY);
  const freeRoadPieces = [];
  for (const rd of rawRoads) {
    const linkedEntries = roadLinkedPolyList.get(rd) || [];
    const linkedPolyOsmIds = linkedEntries.map(e => e.bp && e.bp.osmId).filter(id => id != null);
    const fromSuppressedEnvelope = Boolean(
      (rd._bridgePolyOsmId != null && suppressedEnvelopeOsmIds.has(rd._bridgePolyOsmId)) ||
      (Array.isArray(rd._bridgePolyOsmIds) && rd._bridgePolyOsmIds.some(id => suppressedEnvelopeOsmIds.has(id)))
    );
    const hasOwnRoadStructTag = Boolean(
      rd.tags && (rd.tags['bridge:structure'] || (rd.tags.bridge && !['yes', 'viaduct'].includes(String(rd.tags.bridge).trim().toLowerCase())))
    );
    const rawSt = (fromSuppressedEnvelope && !hasOwnRoadStructTag)
      ? 'beam'
      : (rd.bridgeStructure || rd.structure || (rd.tags && (rd.tags['bridge:structure'] || rd.tags.bridge)));
    const cov = rd.covered || (rd.tags && rd.tags.covered);
    const isRail = Boolean((rd.tags && rd.tags.railway) || ['rail', 'light_rail', 'tram', 'monorail', 'subway', 'narrow_gauge', 'funicular'].includes(rd.hwy));
    const isBoardwalk = String((rd.tags && rd.tags.bridge) || rawSt || '').trim().toLowerCase() === 'boardwalk';
    const keepNonGrazeSub = (sub) => {
      if (isBoardwalk && !_stationWaterFlagsJS(sub.pts, terrainWater).some(Boolean)) return false;
      const subLen = _polyLenJS(sub.pts);
      // Drop tiny carriageway/footpath edge-graze fragments that dip briefly out of their own bridge polygon
      if (sub.entersRingAtStart && sub.entersRingAtEnd && subLen < Math.max(1.8 / scaleMm, 16 * mToBedXY)) return false;
      if ((Boolean(sub.entersRingAtStart) !== Boolean(sub.entersRingAtEnd)) && subLen < Math.max(0.95 / scaleMm, 8 * mToBedXY)) return false;
      return true;
    };
    let sourcePolylines;
    if (linkedEntries.length > 0) {
      const rings = linkedEntries.map(e => e.outer);
      const subs = typeof _splitPolylineOutsideRingsJS === 'function'
        ? _splitPolylineOutsideRingsJS(rd.pts.map(toBed), rings, polyOverlapU, minOutsideSubU)
        : [];
      if (!subs.length) continue;
      sourcePolylines = subs.filter(keepNonGrazeSub);
      if (!sourcePolylines.length) continue;
    } else {
      const bedPts = rd.pts.map(toBed);
      // Absorb collinear non-rail road/footway ways running inside a man_made=bridge polygon
      // tagged within +/- 1 layer (e.g. layer=1 bridge carrying layer=2 road, or layer=2 viaduct carrying layer=1 road).
      const collinRings = [];
      if (!isRail && polyEntries.length > 0 && bedPts.length >= 2) {
        const rLayer = rd.hasExplicitLayer !== undefined ? (rd.hasExplicitLayer ? rd.layer : 1) : (rd.layer ?? 1);
        const rLen = _polyLenJS(bedPts);
        if (rLen > 0.05) {
          const rdx = bedPts[bedPts.length - 1][0] - bedPts[0][0];
          const rdy = bedPts[bedPts.length - 1][1] - bedPts[0][1];
          const rl = Math.hypot(rdx, rdy) || 1;
          const rDense = _resamplePolyJS(bedPts, Math.max(7, Math.min(48, Math.ceil(rLen / 0.8) + 1)));
          const rbb = _bbox2DJS(bedPts);
          for (const pe of polyEntries) {
            if (pe.bp.osmId != null && suppressedEnvelopeOsmIds.has(pe.bp.osmId)) continue;
            const bpLyr = pe.bp.layer ?? 1;
            if (Math.abs(rLayer - bpLyr) > 1) continue;
            if (rbb[2] < pe.pbb[0] || rbb[0] > pe.pbb[2] || rbb[3] < pe.pbb[1] || rbb[1] > pe.pbb[3]) continue;
            const sp = pe.spine;
            const sdx = sp[sp.length - 1][0] - sp[0][0];
            const sdy = sp[sp.length - 1][1] - sp[0][1];
            const sl = Math.hypot(sdx, sdy) || 1;
            const absDot = Math.abs((rdx / rl) * (sdx / sl) + (rdy / rl) * (sdy / sl));
            if (absDot < 0.68 && rLen > pe.spineLen * 0.35) continue;
            let inCnt = 0;
            for (let q = 0; q < rDense.length; q++) {
              if (_ptInRingJS(rDense[q][0], rDense[q][1], pe.outer)) inCnt++;
            }
            if (inCnt >= Math.ceil(rDense.length * 0.65)) collinRings.push(pe.outer);
          }
        }
      }
      if (collinRings.length > 0 && typeof _splitPolylineOutsideRingsJS === 'function') {
        const subs = _splitPolylineOutsideRingsJS(bedPts, collinRings, polyOverlapU, minOutsideSubU);
        if (!subs.length) continue;
        sourcePolylines = subs.filter(keepNonGrazeSub);
        if (!sourcePolylines.length) continue;
      } else {
        sourcePolylines = [{ pts: bedPts, entersRingAtStart: false, entersRingAtEnd: false }];
      }
    }

    const effLayer = rd.hasExplicitLayer !== undefined
      ? (rd.hasExplicitLayer ? rd.layer : (linkedEntries.length > 0 ? (linkedEntries[0].bp.layer ?? 1) : 1))
      : (rd.layer ?? 1);
    const minPieceW = (isRail || rd.isPath)
      ? Math.max(0.45 / scaleMm, (ctx.minPrintU || 0) * 0.65)
      : Math.max(ctx.minPrintU || 0, 0.62 / scaleMm);
    for (const sub of sourcePolylines) {
      for (const pc of _clipPolylineToRectJS(sub.pts, cMinX, cMinY, cMaxX, cMaxY)) {
        freeRoadPieces.push({
          pts: pc.pts,
          clippedStart: pc.clippedStart,
          clippedEnd: pc.clippedEnd,
          joinPolyStart: Boolean(sub.entersRingAtStart && !pc.clippedStart),
          joinPolyEnd: Boolean(sub.entersRingAtEnd && !pc.clippedEnd),
          linkedPolyOsmIds,
          width: Math.max(minPieceW, (rd.width || 0.8) * s2b),
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

  for (const r of _stitchAndMergeLinearBridgesJS(freeRoadPieces, { mToBedXY, scaleMm })) {
    const rawSpanU = Math.max(0.12, _polyLenJS(r.pts));
    const spanMetersLinear = rawSpanU / Math.max(1e-5, mToBedXY);
    if ((Boolean(r.joinPolyStart) !== Boolean(r.joinPolyEnd)) && spanMetersLinear < 9.0 && !_stationWaterFlagsJS(r.pts, terrainWater).some(Boolean)) {
      continue;
    }
    const slender = Boolean(r.isRail || r.isPath);
    const minW = slender ? Math.max(0.50 / scaleMm, minDeckU * 0.72) : Math.max(0.68 / scaleMm, minDeckU * 0.95);
    const widthU = Math.max(minW, r.width);

    const pierSnapU = Math.max(widthU * 0.75, Math.min(0.55 / scaleMm, 3.5 * mToBedXY));
    const joinPierStart = (!r.clippedStart && !r.joinPolyStart && pierAnchors.length)
      ? _matchPierAnchorAtPtJS(r.pts[0][0], r.pts[0][1], pierAnchors, pierSnapU) : null;
    const joinPierEnd = (!r.clippedEnd && !r.joinPolyEnd && pierAnchors.length)
      ? _matchPierAnchorAtPtJS(r.pts[r.pts.length - 1][0], r.pts[r.pts.length - 1][1], pierAnchors, pierSnapU) : null;
    const isPierGangway = Boolean((joinPierStart || joinPierEnd) && spanMetersLinear < 75.0);

    let ptsUse = r.pts;
    if (isPierGangway && ptsUse.length >= 2) {
      ptsUse = ptsUse.map(p => [p[0], p[1]]);
      const extU = Math.min(0.20 / scaleMm, rawSpanU * 0.16);
      if (joinPierStart) {
        const dx = ptsUse[0][0] - ptsUse[1][0], dy = ptsUse[0][1] - ptsUse[1][1], dl = Math.hypot(dx, dy) || 1;
        ptsUse[0] = [ptsUse[0][0] + (dx / dl) * extU, ptsUse[0][1] + (dy / dl) * extU];
      }
      if (joinPierEnd) {
        const last = ptsUse.length - 1;
        const dx = ptsUse[last][0] - ptsUse[last - 1][0], dy = ptsUse[last][1] - ptsUse[last - 1][1], dl = Math.hypot(dx, dy) || 1;
        ptsUse[last] = [ptsUse[last][0] + (dx / dl) * extU, ptsUse[last][1] + (dy / dl) * extU];
      }
    }

    const spanU = Math.max(0.12, _polyLenJS(ptsUse));
    const isShortPolyStub = Boolean((r.joinPolyStart || r.joinPolyEnd) && spanMetersLinear < 25.0);
    const effStruct = (isPierGangway || isShortPolyStub || (spanMetersLinear < 14.0 && !r.explicitThroughArch && r.structNorm === 'arch'))
      ? 'beam'
      : r.structNorm;
    const deckThick = isPierGangway
      ? Math.max(0.46 / scaleMm, minDeckU * 0.72)
      : Math.max(slender ? Math.max(0.56 / scaleMm, minDeckU * 0.82) : minDeckU, Math.min(widthU * 0.40, minDeckU * 1.15));
    const nSt = Math.max(13, Math.min(200, Math.ceil(spanU / stepStationU) + 1));
    const resampledPts = _resamplePolyJS(ptsUse, nSt);
    specs.push({
      isAreaPoly: false, outer: null, holes: [], pts: resampledPts, scaleMm,
      width: widthU, deckThick, deckLayer: r.layer ?? 1, name: r.name, structNorm: effStruct,
      explicitThroughArch: Boolean(!isPierGangway && !isShortPolyStub && r.explicitThroughArch),
      isHumpback: Boolean(!isPierGangway && !isShortPolyStub && r.isHumpback),
      isRail: Boolean(r.isRail),
      isPath: Boolean(r.isPath), isBoardwalk: Boolean(r.isBoardwalk), level: r.level || '',
      clippedStart: Boolean(r.clippedStart), clippedEnd: Boolean(r.clippedEnd),
      joinPolyStart: Boolean(r.joinPolyStart), joinPolyEnd: Boolean(r.joinPolyEnd),
      joinPierStart, joinPierEnd, isPierGangway, joinBridgeStart: null, joinBridgeEnd: null,
      acrossOsmIdSet: null, carriedVerts: [resampledPts[0], resampledPts[resampledPts.length - 1]],
      linkedPolyOsmIds: r.linkedPolyOsmIds || [],
      heightM: r.heightM, minHeightM: r.minHeightM, clearanceM: r.clearanceM, covered: r.covered, supportIds: [], osmId: r.osmId
    });
  }

  return { specs, groundRoads, rawSupports, mToBedXY, minDeckU };
}

function _attachExplicitSupportsToSpecsJS(specs, rawSupports, mToBedXY, scaleMm = 1.89) {
  for (const sp of specs) sp.explicitSupports = [];
  for (const sup of rawSupports) {
    if (!sup.pt) continue;
    let attachedExplicit = false;
    const proxMatches = [];
    for (const sp of specs) {
      if (sp.isPierGangway) continue;
      const byId = sup.osmId != null && sp.supportIds.includes(sup.osmId);
      const inside = sp.isAreaPoly && _ptInRingJS(sup.pt[0], sup.pt[1], sp.outer);
      const maxDist = Math.max(sp.width * 0.75, Math.min(1.6 / scaleMm, 10.0 * mToBedXY + 0.30 / scaleMm));
      let bestS = 0, bestD = Infinity;
      for (let i = 0; i < sp.pts.length - 1; i++) {
        const a = sp.pts[i], b = sp.pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, ((sup.pt[0] - a[0]) * dx + (sup.pt[1] - a[1]) * dy) / l2));
        const d = Math.hypot(sup.pt[0] - (a[0] + dx * t), sup.pt[1] - (a[1] + dy * t));
        if (d < bestD) { bestD = d; bestS = sp.sArr[i] + Math.sqrt(l2) * t; }
      }
      if (byId || inside) {
        sp.explicitSupports.push({ ...sup, sProj: bestS, distToAxis: bestD });
        attachedExplicit = true;
      } else if (bestD <= maxDist) {
        proxMatches.push({ sp, bestS, bestD });
      }
    }
    if (!attachedExplicit && proxMatches.length > 0) {
      proxMatches.sort((a, b) => (a.bestD - b.bestD) || (a.sp.deckLayer - b.sp.deckLayer));
      const win = proxMatches[0];
      win.sp.explicitSupports.push({ ...sup, sProj: win.bestS, distToAxis: win.bestD });
    }
  }
  for (const sp of specs) sp.explicitSupports.sort((a, b) => a.sProj - b.sProj);
}

const _BRIDGE_SPECS_EXTRACT_EXPORTS = { _extractBridgeSpecsFromSceneJS, _attachExplicitSupportsToSpecsJS };
if (typeof globalThis !== 'undefined') Object.assign(globalThis, _BRIDGE_SPECS_EXTRACT_EXPORTS);
if (typeof window !== 'undefined') Object.assign(window, _BRIDGE_SPECS_EXTRACT_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _BRIDGE_SPECS_EXTRACT_EXPORTS;
