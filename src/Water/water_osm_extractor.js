// ============================================================================
// src/Water/water_osm_extractor.js
// OSM Water Multipolygon, Coastline, Waterway & Island/Shingle Layer Extractor
// ============================================================================

(function (root) {
  function _getDeps() {
    const geom = (typeof _waterRingAbsAreaJS === 'function' && typeof stitchWayRingsJS === 'function')
      ? {
          stitchWayRingsJS, _waterPointInPolyJS, _waterRingAbsAreaJS,
          _waterRingProbePtJS, _waterRingsMatchSameLoopJS, _waterRingStrictlyInsideOuterJS
        }
      : require('./water_ring_geometry.js');
    const mp = (typeof stitchClippedMultipolygonRingsJS === 'function')
      ? { stitchClippedMultipolygonRingsJS }
      : require('./water_multipolygon_stitcher.js');
    const coast = (typeof stitchCoastlineSeaPolysJS === 'function')
      ? { stitchCoastlineSeaPolysJS }
      : require('./water_coastline_stitcher.js');
    const tagsMod = (typeof isOsmWaterMultipolygonJS === 'function' && typeof isOsmShingleOrShoalTagsJS === 'function')
      ? {
          isNonSurfaceWaterTagsJS, isOsmShingleOrShoalTagsJS, isOsmStandaloneIslandTagsJS,
          defaultWaterwayWidthMetersJS, isOsmArealRelationTypeJS, isOsmWaterMultipolygonJS
        }
      : require('./water_osm_tags.js');
    let parseWidth = typeof parseFloatTagJS === 'function' ? parseFloatTagJS : null;
    if (!parseWidth && typeof require === 'function') {
      try {
        const matcher = require('../gis_client/s3db_client_matcher.js');
        if (matcher && typeof matcher.parseFloatTagJS === 'function') parseWidth = matcher.parseFloatTagJS;
      } catch (_) {}
    }
    if (!parseWidth) {
      parseWidth = (val, fallback = null) => {
        if (val === undefined || val === null || val === '') return fallback;
        const m = String(val).trim().replace(',', '.').match(/^[-+]?\d*\.?\d+/);
        const n = m ? parseFloat(m[0]) : NaN;
        return Number.isFinite(n) ? n : fallback;
      };
    }
    return { geom, mp, coast, tagsMod, parseWidth };
  }

  function collectOsmWaterSampleCandidateJS(w, wt, wn, isBrWay, isTunWay, nodes, fetchHalfW, fetchHalfH, allWaterCandidates) {
    const { tagsMod } = _getDeps();
    if ((wt.waterway === 'river' || wt.waterway === 'canal') && !isTunWay && !tagsMod.isNonSurfaceWaterTagsJS(wt)) {
      const weight = wt.waterway === 'river' ? 3 : 2;
      const wName = String(wt.name || wt['name:en'] || '').trim().toLowerCase();
      const stride = Math.max(1, Math.floor(wn.length / 6));
      for (let i = 0; i < wn.length; i += stride) {
        const pt = nodes.get(wn[i]);
        if (pt && Math.abs(pt[0]) <= fetchHalfW && Math.abs(pt[1]) <= fetchHalfH) {
          allWaterCandidates.push([pt[0], pt[1], weight, wName]);
        }
      }
      return true;
    }
    return false;
  }

  function processOsmWaterMultipolygonJS(rel, tags, raw, ctx, extraFlags = null) {
    const { geom, mp, tagsMod } = _getDeps();
    if (!ctx._standaloneIslands) ctx._standaloneIslands = [];
    if (!ctx._shinglePolys) ctx._shinglePolys = [];
    if (!tagsMod.isOsmArealRelationTypeJS(tags)) return false;

    if (tagsMod.isOsmWaterMultipolygonJS(tags)) {
      if (tagsMod.isNonSurfaceWaterTagsJS(tags)) {
        for (const wid of raw.memberWayIds) ctx.usedWays.add(wid);
        return true;
      }
      const relName = String(tags.name || tags['name:en'] || '').trim().toLowerCase();
      const clipped = mp.stitchClippedMultipolygonRingsJS(
        raw.outerWays, raw.innerWays, ctx.nodesToPts, ctx.fetchHalfW, ctx.fetchHalfH,
        {
          isWater: true,
          isGreen: Boolean(extraFlags && extraFlags.isGreen),
          isPlaza: Boolean(extraFlags && extraFlags.isPlaza),
          relName,
          waterSamplePts: ctx.waterSamplePts,
          buildingSamplePts: ctx.buildingSamplePts,
          roadSamplePts: ctx.roadSamplePts,
          tol: 0.018
        }
      );
      const stFallback = ctx.stitchedRelPolys.get(rel.id) || { outerPolys: [], innerPolys: [] };
      const entries = clipped
        ? clipped.outerEntries
        : stFallback.outerPolys.map(op => ({ outer: op, holes: stFallback.innerPolys }));
      if (entries.length === 0) return true;

      // Identify inner member ways tagged as shingle/shoal/mud gravel bars
      const shingleInnerPolys = [];
      if (ctx.ways && Array.isArray(rel.members)) {
        const shingleWayNodeLists = [];
        for (const m of rel.members) {
          if (m.type === 'way' && m.role === 'inner' && ctx.ways.has(m.ref)) {
            const mw = ctx.ways.get(m.ref);
            if (mw && tagsMod.isOsmShingleOrShoalTagsJS(mw.tags)) shingleWayNodeLists.push(mw.nodes || []);
          }
        }
        if (shingleWayNodeLists.length > 0) {
          const stitchedShingle = geom.stitchWayRingsJS(shingleWayNodeLists)
            .map(r => ctx.nodesToPts(r, 0.018))
            .filter(p => p.length >= 3);
          for (const sp of stitchedShingle) shingleInnerPolys.push(sp);
        }
      }

      for (const wid of raw.memberWayIds) ctx.usedWays.add(wid);
      for (const e of entries) {
        const holes = Array.isArray(e.holes) ? e.holes.slice() : [];
        const shingleHoleIndices = [];
        if (shingleInnerPolys.length > 0 && holes.length > 0) {
          for (let hi = 0; hi < holes.length; hi++) {
            if (shingleInnerPolys.some(sp => geom._waterRingsMatchSameLoopJS(holes[hi], sp))) {
              shingleHoleIndices.push(hi);
            }
          }
        }
        const wpEntry = { outer: e.outer, holes, name: tags.name || 'Woda' };
        if (shingleHoleIndices.length > 0) wpEntry.shingleHoleIndices = shingleHoleIndices;
        ctx.waterPolys.push(wpEntry);
      }
      return true;
    }

    // Multipolygon shingle / shoal / tidalflat gravel bars (non-water riverbed shoals)
    if (tagsMod.isOsmShingleOrShoalTagsJS(tags)) {
      const clipped = mp.stitchClippedMultipolygonRingsJS(
        raw.outerWays, raw.innerWays, ctx.nodesToPts, ctx.fetchHalfW, ctx.fetchHalfH,
        {
          isWater: false, isGreen: false, isPlaza: false,
          buildingSamplePts: ctx.buildingSamplePts, roadSamplePts: ctx.roadSamplePts, tol: 0.018
        }
      );
      for (const e of (clipped ? clipped.outerEntries : [])) {
        if (e.outer && e.outer.length >= 3) ctx._shinglePolys.push(e.outer);
      }
      if (!extraFlags || (!extraFlags.isGreen && !extraFlags.isPlaza)) {
        for (const wid of raw.memberWayIds) ctx.usedWays.add(wid);
        return true;
      }
      return false;
    }

    // Standalone place=island / place=islet multipolygons: record land ring without marking
    // memberWayIds as usedWays so coastline ways still participate in sea-basin stitching.
    if (tagsMod.isOsmStandaloneIslandTagsJS(tags)) {
      const clipped = mp.stitchClippedMultipolygonRingsJS(
        raw.outerWays, raw.innerWays, ctx.nodesToPts, ctx.fetchHalfW, ctx.fetchHalfH,
        {
          isWater: false,
          isIsland: true,
          isGreen: Boolean(extraFlags && extraFlags.isGreen),
          isPlaza: Boolean(extraFlags && extraFlags.isPlaza),
          waterSamplePts: ctx.waterSamplePts,
          buildingSamplePts: ctx.buildingSamplePts,
          roadSamplePts: ctx.roadSamplePts,
          tol: 0.018
        }
      );
      for (const e of (clipped ? clipped.outerEntries : [])) {
        if (e.outer && e.outer.length >= 3) ctx._standaloneIslands.push(e.outer);
      }
      return Boolean(!extraFlags || (!extraFlags.isGreen && !extraFlags.isPlaza));
    }

    return false;
  }

  function processOsmCoastlineWayJS(wid, w, tags, nids, isClosed, ctx) {
    const { tagsMod } = _getDeps();
    if (tags.natural === 'coastline') {
      const pts = nids.map(id => ctx.nodes.get(id)).filter(Boolean);
      if (pts.length >= 2) ctx.coastWays.push(pts);
      if (isClosed && tagsMod.isOsmStandaloneIslandTagsJS(tags)) {
        if (!ctx._standaloneIslands) ctx._standaloneIslands = [];
        const islPts = ctx.nodesToPts(nids, 0.018);
        if (islPts.length >= 3) ctx._standaloneIslands.push(islPts);
      }
      return true;
    }
    return false;
  }

  function processOsmWaterWayJS(wid, w, tags, nids, isClosed, ctx) {
    const { tagsMod, parseWidth } = _getDeps();
    if (!ctx._standaloneIslands) ctx._standaloneIslands = [];
    if (!ctx._shinglePolys) ctx._shinglePolys = [];

    const allowMicroWater = !ctx || !ctx.effectiveSpanM || ctx.effectiveSpanM <= 5500;
    const isArealWater = (
      tags.natural === 'water' ||
      ['riverbank', 'dock'].includes(tags.waterway) ||
      Boolean(tags.water) ||
      ['reservoir', 'basin'].includes(tags.landuse) ||
      tags.leisure === 'marina' ||
      (allowMicroWater && (
        tags.amenity === 'fountain' ||
        (tags.leisure === 'swimming_pool' && tags.location !== 'indoor' && tags.indoor !== 'yes')
      ))
    );

    if (isArealWater && isClosed) {
      if (tagsMod.isNonSurfaceWaterTagsJS(tags)) return true;
      if (!ctx.usedWays.has(wid)) {
        const pts = ctx.nodesToPts(nids, 0.025);
        if (pts.length >= 3) ctx.waterPolys.push({ outer: pts, holes: [], name: tags.name || 'Woda' });
      }
      return true;
    }

    if (isClosed && tagsMod.isOsmShingleOrShoalTagsJS(tags)) {
      const pts = ctx.nodesToPts(nids, 0.02);
      if (pts.length >= 3) ctx._shinglePolys.push(pts);
      return true;
    }

    if (isClosed && tagsMod.isOsmStandaloneIslandTagsJS(tags) && !isArealWater) {
      const pts = ctx.nodesToPts(nids, 0.02);
      if (pts.length >= 3) ctx._standaloneIslands.push(pts);
      return false;
    }

    if (tags.waterway && ['river', 'canal', 'stream', 'dock', 'drain', 'ditch'].includes(tags.waterway)) {
      if (tagsMod.isNonSurfaceWaterTagsJS(tags)) return true;
      const ww = String(tags.waterway).trim().toLowerCase();
      const explicitW = parseWidth(tags.width, null);
      if ((ww === 'drain' || ww === 'ditch') && !(explicitW >= 2.5) && (ctx.effectiveSpanM || 1200) > 2600) {
        return true;
      }
      const pts = ctx.nodesToPts(nids, 0.035);
      if (pts.length >= 2) {
        const wm = (explicitW !== null && explicitW > 0) ? explicitW : tagsMod.defaultWaterwayWidthMetersJS(ww);
        const defaultMToU = (typeof SCENE_CANONICAL_SPAN_UNITS !== 'undefined') ? (SCENE_CANONICAL_SPAN_UNITS / 1200) : 0.141;
        const widthUnits = Math.round(Math.max(0.08, wm * (ctx.metersToUnits || defaultMToU)) * 1000) / 1000;
        ctx.waterLines.push({ pts, width: widthUnits, waterway: ww, name: tags.name || tags.waterway });
      }
      return true;
    }

    return false;
  }

  function finalizeOsmWaterLayerJS(ctx) {
    const { geom, coast } = _getDeps();
    const coastMeta = {};
    coast.stitchCoastlineSeaPolysJS(ctx.coastWays, ctx.fetchHalfW, ctx.fetchHalfH, ctx.waterPolys, coastMeta);
    if (coastMeta.openSeaIslands && coastMeta.openSeaIslands.length > 0) {
      ctx._openSeaIslands = coastMeta.openSeaIslands;
      ctx._openSeaRect = coastMeta.seaRect;
    }

    const waterPolys = ctx.waterPolys || [];
    if (waterPolys.length === 0) {
      if (ctx._hasMarineTags && Array.isArray(ctx._standaloneIslands) && ctx._standaloneIslands.length > 0) {
        const existingOpen = Array.isArray(ctx._openSeaIslands) ? ctx._openSeaIslands : [];
        for (const isl of ctx._standaloneIslands) {
          if (geom._waterRingAbsAreaJS(isl) > 1e-4 && !existingOpen.some(o => geom._waterRingsMatchSameLoopJS(o, isl))) {
            existingOpen.push(isl);
          }
        }
        if (existingOpen.length > 0) ctx._openSeaIslands = existingOpen;
      }
      return;
    }

    const allIslandEntries = [];
    for (let wi = 0; wi < waterPolys.length; wi++) {
      const wp = waterPolys[wi];
      const shingleSet = new Set(wp.shingleHoleIndices || []);
      const holes = wp.holes || [];
      for (let hi = 0; hi < holes.length; hi++) {
        const h = holes[hi], area = geom._waterRingAbsAreaJS(h);
        if (area > 1e-4) {
          allIslandEntries.push({ ring: h, area, isShingle: shingleSet.has(hi), fromWaterHole: true, fromStandalone: false });
        }
      }
    }

    for (const isl of (ctx._standaloneIslands || [])) {
      const area = geom._waterRingAbsAreaJS(isl);
      if (area > 1e-4 && !allIslandEntries.some(e => geom._waterRingsMatchSameLoopJS(e.ring, isl))) {
        allIslandEntries.push({ ring: isl, area, isShingle: false, fromWaterHole: false, fromStandalone: true });
      }
    }

    const extraShingleRings = [];
    for (const sh of (ctx._shinglePolys || [])) {
      const area = geom._waterRingAbsAreaJS(sh);
      if (area <= 1e-4) continue;
      const existing = allIslandEntries.find(e => geom._waterRingsMatchSameLoopJS(e.ring, sh));
      if (existing) existing.isShingle = true;
      else {
        allIslandEntries.push({ ring: sh, area, isShingle: true, fromWaterHole: false, fromStandalone: false });
        extraShingleRings.push(sh);
      }
    }

    const outerAreas = waterPolys.map(wp => geom._waterRingAbsAreaJS(wp.outer));
    const maxStandaloneArea = (4 * (ctx.fetchHalfW || 88.8) * (ctx.fetchHalfH || 88.8)) * 0.35;
    const extraLandRings = [];

    for (const entry of allIslandEntries) {
      let attachedStrict = false;
      for (let wi = 0; wi < waterPolys.length; wi++) {
        const wp = waterPolys[wi];
        if (outerAreas[wi] <= entry.area * 1.08 || !geom._waterRingStrictlyInsideOuterJS(entry.ring, wp.outer)) continue;
        attachedStrict = true;
        if (!wp.holes) wp.holes = [];
        let matchIdx = -1;
        for (let hi = 0; hi < wp.holes.length; hi++) {
          if (geom._waterRingsMatchSameLoopJS(wp.holes[hi], entry.ring)) { matchIdx = hi; break; }
        }
        if (matchIdx === -1) { matchIdx = wp.holes.length; wp.holes.push(entry.ring); }
        if (entry.isShingle) {
          if (!wp.shingleHoleIndices) wp.shingleHoleIndices = [];
          if (!wp.shingleHoleIndices.includes(matchIdx)) wp.shingleHoleIndices.push(matchIdx);
        }
      }
      if (!attachedStrict && !entry.isShingle && entry.fromStandalone && entry.area <= maxStandaloneArea) {
        const largerIdxs = [];
        for (let wi = 0; wi < waterPolys.length; wi++) if (outerAreas[wi] > entry.area * 1.05) largerIdxs.push(wi);
        if (largerIdxs.length > 0 && entry.ring.length >= 3) {
          const probe = geom._waterRingProbePtJS(entry.ring);
          const anyInLarger = largerIdxs.some(wi => geom._waterPointInPolyJS(probe[0], probe[1], waterPolys[wi].outer)) ||
            entry.ring.some(pt => largerIdxs.some(wi => geom._waterPointInPolyJS(pt[0], pt[1], waterPolys[wi].outer)));
          if (anyInLarger) extraLandRings.push(entry.ring);
        }
      }
    }

    if (extraLandRings.length > 0) waterPolys[0]._unrotatedLandRings = extraLandRings;
    if (extraShingleRings.length > 0) waterPolys[0]._unrotatedShingleRings = extraShingleRings;
  }

  const exportsObj = {
    collectOsmWaterSampleCandidateJS,
    processOsmWaterMultipolygonJS,
    processOsmCoastlineWayJS,
    processOsmWaterWayJS,
    finalizeOsmWaterLayerJS
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
