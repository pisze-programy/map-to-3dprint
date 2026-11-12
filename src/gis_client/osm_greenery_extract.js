// ============================================================================
// src/gis_client/osm_greenery_extract.js
// OSM Greenery Layer Extractor (Parks, Forests, Grass, Gardens & Meadows)
// ============================================================================

if (typeof simplifyRingJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./overpass_dem_fetch.js'));
}
if (typeof parseFloatTagJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./s3db_client_matcher.js'));
}

function isOsmGreeneryMultipolygonJS(tags) {
  return Boolean(
    ['park', 'garden', 'nature_reserve', 'pitch', 'playground', 'common', 'golf_course', 'recreation_ground', 'dog_park'].includes(tags.leisure) ||
    ['forest', 'grass', 'meadow', 'village_green', 'recreation_ground', 'cemetery', 'allotments', 'farmland', 'orchard', 'vineyard'].includes(tags.landuse) ||
    ['wood', 'scrub', 'grassland', 'heath'].includes(tags.natural)
  );
}

function processOsmGreeneryMultipolygonJS(rel, tags, raw, ctx, extraFlags = null) {
  if (!isOsmGreeneryMultipolygonJS(tags)) return false;
  const relName = String(tags.name || tags['name:en'] || '').trim().toLowerCase();
  const clipped = (typeof stitchClippedMultipolygonRingsJS === 'function')
    ? stitchClippedMultipolygonRingsJS(raw.outerWays, raw.innerWays, ctx.nodesToPts, ctx.fetchHalfW, ctx.fetchHalfH, {
        isWater: false,
        isGreen: true,
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
  const gType = tags.leisure || tags.landuse || tags.natural || 'park';
  for (const e of entries) {
    ctx.greenPolys.push({ outer: e.outer, holes: e.holes, type: gType });
  }
  return true;
}

function processOsmGreeneryWayJS(wid, w, tags, nids, isClosed, ctx) {
  if (isOsmGreeneryMultipolygonJS(tags) && isClosed) {
    if (!ctx.usedWays.has(wid)) {
      const pts = ctx.nodesToPts(nids, 0.035);
      if (pts.length >= 3) {
        ctx.greenPolys.push({ outer: pts, holes: [], type: tags.leisure || tags.landuse || tags.natural || 'park' });
      }
    }
    return true;
  }
  return false;
}

function finalizeOsmGreeneryLayerJS(_ctx) {
  // Post-processing hook reserved for greenery layer refinements
}

if (typeof window !== 'undefined') {
  window.isOsmGreeneryMultipolygonJS = isOsmGreeneryMultipolygonJS;
  window.processOsmGreeneryMultipolygonJS = processOsmGreeneryMultipolygonJS;
  window.processOsmGreeneryWayJS = processOsmGreeneryWayJS;
  window.finalizeOsmGreeneryLayerJS = finalizeOsmGreeneryLayerJS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isOsmGreeneryMultipolygonJS,
    processOsmGreeneryMultipolygonJS,
    processOsmGreeneryWayJS,
    finalizeOsmGreeneryLayerJS
  };
}
