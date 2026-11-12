// ============================================================================
// src/gis_client/osm_water_extract.js
// OSM Water Layer Extractor (Water Polygons, Rivers/Canals/Streams, Islands & Coastlines)
// ============================================================================

if (typeof simplifyRingJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./overpass_dem_fetch.js'));
}
if (typeof parseFloatTagJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./s3db_client_matcher.js'));
}

function collectOsmWaterSampleCandidateJS(w, wt, wn, isBrWay, isTunWay, nodes, fetchHalfW, fetchHalfH, allWaterCandidates) {
  if ((wt.waterway === 'river' || wt.waterway === 'canal') && !isTunWay) {
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

function isOsmWaterMultipolygonJS(tags) {
  return Boolean(
    tags.natural === 'water' ||
    ['riverbank', 'dock', 'canal'].includes(tags.waterway) ||
    Boolean(tags.water) ||
    ['reservoir', 'basin'].includes(tags.landuse) ||
    tags.leisure === 'marina'
  );
}

function processOsmWaterMultipolygonJS(rel, tags, raw, ctx, extraFlags = null) {
  if (!isOsmWaterMultipolygonJS(tags)) return false;
  const relName = String(tags.name || tags['name:en'] || '').trim().toLowerCase();
  const clipped = (typeof stitchClippedMultipolygonRingsJS === 'function')
    ? stitchClippedMultipolygonRingsJS(raw.outerWays, raw.innerWays, ctx.nodesToPts, ctx.fetchHalfW, ctx.fetchHalfH, {
        isWater: true,
        isGreen: Boolean(extraFlags && extraFlags.isGreen),
        isPlaza: Boolean(extraFlags && extraFlags.isPlaza),
        relName,
        waterSamplePts: ctx.waterSamplePts,
        buildingSamplePts: ctx.buildingSamplePts,
        roadSamplePts: ctx.roadSamplePts,
        tol: 0.018
      })
    : null;
  const stFallback = ctx.stitchedRelPolys.get(rel.id) || { outerPolys: [], innerPolys: [] };
  const entries = clipped
    ? clipped.outerEntries
    : stFallback.outerPolys.map(op => ({
        outer: op,
        holes: stFallback.innerPolys
      }));
  if (entries.length === 0) return true;
  for (const wid of raw.memberWayIds) ctx.usedWays.add(wid);
  for (const e of entries) {
    ctx.waterPolys.push({ outer: e.outer, holes: e.holes, name: tags.name || 'Woda' });
  }
  return true;
}

function processOsmCoastlineWayJS(wid, w, tags, nids, isClosed, ctx) {
  if (tags.natural === 'coastline') {
    const pts = nids.map(id => ctx.nodes.get(id)).filter(Boolean);
    if (pts.length >= 2) ctx.coastWays.push(pts);
    return true;
  }
  return false;
}

function processOsmWaterWayJS(wid, w, tags, nids, isClosed, ctx) {
  if ((tags.natural === 'water' || ['riverbank', 'dock'].includes(tags.waterway) || Boolean(tags.water) || ['reservoir', 'basin'].includes(tags.landuse) || tags.leisure === 'marina') && isClosed) {
    if (!ctx.usedWays.has(wid)) {
      const pts = ctx.nodesToPts(nids, 0.03);
      if (pts.length >= 3) ctx.waterPolys.push({ outer: pts, holes: [], name: tags.name || 'Woda' });
    }
    return true;
  }

  if (tags.waterway && ['river', 'canal', 'stream', 'dock'].includes(tags.waterway) && !['yes', 'culvert'].includes(tags.tunnel)) {
    const pts = ctx.nodesToPts(nids, 0.04);
    if (pts.length >= 2) {
      const wm = parseFloatTagJS(tags.width, null) || (tags.waterway === 'river' ? 16 : tags.waterway === 'canal' ? 8 : 3);
      ctx.waterLines.push({ pts, width: Math.round(Math.max(0.35, wm * ctx.metersToUnits) * 100) / 100, name: tags.name || tags.waterway });
    }
    return true;
  }

  return false;
}

function finalizeOsmWaterLayerJS(ctx) {
  stitchCoastlineSeaPolysJS(ctx.coastWays, ctx.fetchHalfW, ctx.fetchHalfH, ctx.waterPolys);
}

if (typeof window !== 'undefined') {
  window.collectOsmWaterSampleCandidateJS = collectOsmWaterSampleCandidateJS;
  window.isOsmWaterMultipolygonJS = isOsmWaterMultipolygonJS;
  window.processOsmWaterMultipolygonJS = processOsmWaterMultipolygonJS;
  window.processOsmCoastlineWayJS = processOsmCoastlineWayJS;
  window.processOsmWaterWayJS = processOsmWaterWayJS;
  window.finalizeOsmWaterLayerJS = finalizeOsmWaterLayerJS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    collectOsmWaterSampleCandidateJS,
    isOsmWaterMultipolygonJS,
    processOsmWaterMultipolygonJS,
    processOsmCoastlineWayJS,
    processOsmWaterWayJS,
    finalizeOsmWaterLayerJS
  };
}
