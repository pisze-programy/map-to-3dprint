// ============================================================================
// src/gis_client/osm_bridges_piers_extract.js
// OSM Bridges & Piers Extractor (man_made=bridge Polygons, Linear Bridge Tags & Piers)
// ============================================================================

if (typeof parseFloatTagJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./s3db_client_matcher.js'));
}

function isOsmBridgeMultipolygonJS(tags) {
  return Boolean(
    tags.man_made === 'bridge' ||
    (tags.bridge && !['no', 'false', '0', 'none'].includes(tags.bridge))
  );
}

function processOsmBridgeMultipolygonJS(rel, tags, raw, ctx) {
  if (!isOsmBridgeMultipolygonJS(tags)) return false;
  const st = ctx.stitchedRelPolys.get(rel.id);
  if (!st) return true;
  for (const wid of st.memberWayIds) ctx.usedWays.add(wid);
  const layerVal = Math.max(1, Math.trunc(parseFloatTagJS(tags.layer, 1) || 1));
  for (const op of st.outerPolys) {
    ctx.bridgePolys.push({ outer: op, holes: st.innerPolys, name: tags.name || 'Most', layer: layerVal });
  }
  return true;
}

function processOsmBridgeOrPierWayJS(wid, w, tags, nids, isClosed, ctx) {
  if (tags.man_made === 'bridge' && isClosed && !ctx.usedWays.has(wid)) {
    const pts = ctx.nodesToPts(nids, 0.02);
    if (pts.length >= 3) {
      const layerVal = Math.max(1, Math.trunc(parseFloatTagJS(tags.layer, 1) || 1));
      ctx.bridgePolys.push({ outer: pts, holes: [], name: tags.name || 'Most', layer: layerVal });
    }
    return true;
  }

  if (['pier', 'breakwater', 'groyne'].includes(tags.man_made) && isClosed) {
    const pts = ctx.nodesToPts(nids, 0.025);
    if (pts.length >= 3) {
      ctx.s3db.addBuildingRecord(
        wid,
        { ...tags, building: 'pier', height: '3.5', 'roof:shape': 'flat', name: tags.name || `Molo #${wid}` },
        pts,
        [],
        wid,
        false
      );
    }
    return true;
  }

  return false;
}

function isOsmLinearBridgeOrPierWayJS(tags) {
  const bridgeTag = tags.bridge;
  return Boolean(
    (bridgeTag && !['no', 'false', '0', 'none'].includes(bridgeTag)) ||
    ['bridge', 'pier', 'breakwater', 'groyne'].includes(tags.man_made)
  );
}

function finalizeOsmBridgesLayerJS(_ctx) {
  // Post-processing hook reserved for bridge/pier layer refinements
}

if (typeof window !== 'undefined') {
  window.isOsmBridgeMultipolygonJS = isOsmBridgeMultipolygonJS;
  window.processOsmBridgeMultipolygonJS = processOsmBridgeMultipolygonJS;
  window.processOsmBridgeOrPierWayJS = processOsmBridgeOrPierWayJS;
  window.isOsmLinearBridgeOrPierWayJS = isOsmLinearBridgeOrPierWayJS;
  window.finalizeOsmBridgesLayerJS = finalizeOsmBridgesLayerJS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isOsmBridgeMultipolygonJS,
    processOsmBridgeMultipolygonJS,
    processOsmBridgeOrPierWayJS,
    isOsmLinearBridgeOrPierWayJS,
    finalizeOsmBridgesLayerJS
  };
}
