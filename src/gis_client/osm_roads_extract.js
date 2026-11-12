// ============================================================================
// src/gis_client/osm_roads_extract.js
// OSM Roads & Plazas Extractor (Highways, Railways, Pedestrian Squares, Widths & Tunnels)
// ============================================================================

if (typeof simplifyRingJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./overpass_dem_fetch.js'));
}
if (typeof parseFloatTagJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./s3db_client_matcher.js'));
}
if (typeof isOsmLinearBridgeOrPierWayJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./osm_bridges_piers_extract.js'));
}

const MOTOR_ROAD_VALS_JS = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
  'residential', 'living_street', 'service',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'
]);

function collectOsmRoadSampleCandidateJS(w, wt, wn, isBrWay, isTunWay, nodes, fetchHalfW, fetchHalfH, allRoadCandidates) {
  if (wt.highway && !isBrWay && !isTunWay && !wt.ford && wt.route !== 'ferry') {
    const hwVal = String(wt.highway).toLowerCase();
    const mmVal = String(wt.man_made || '').toLowerCase();
    if (!['pier', 'bridge', 'breakwater', 'groyne', 'quay', 'jetty', 'wharf', 'dolphin', 'boardwalk'].includes(mmVal) && hwVal !== 'proposed' && hwVal !== 'construction') {
      const pMid = nodes.get(wn[wn.length >> 1]);
      if (pMid && Math.abs(pMid[0]) <= fetchHalfW && Math.abs(pMid[1]) <= fetchHalfH) {
        allRoadCandidates.push([pMid[0], pMid[1], MOTOR_ROAD_VALS_JS.has(hwVal) ? 2 : 1]);
      }
    }
    return true;
  }
  return false;
}

function isOsmPlazaMultipolygonJS(tags) {
  return Boolean(
    (['pedestrian', 'footway', 'living_street'].includes(tags.highway) && tags.area !== 'no') ||
    tags.place === 'square'
  );
}

function processOsmPlazaMultipolygonJS(rel, tags, raw, ctx) {
  if (!isOsmPlazaMultipolygonJS(tags)) return false;
  const relName = String(tags.name || tags['name:en'] || '').trim().toLowerCase();
  const clipped = (typeof stitchClippedMultipolygonRingsJS === 'function')
    ? stitchClippedMultipolygonRingsJS(raw.outerWays, raw.innerWays, ctx.nodesToPts, ctx.fetchHalfW, ctx.fetchHalfH, {
        isWater: false,
        isGreen: false,
        isPlaza: true,
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
    ctx.roadPolys.push({ outer: e.outer, holes: e.holes, name: tags.name || '' });
  }
  return true;
}

function processOsmRoadOrPlazaWayJS(wid, w, tags, nids, isClosed, ctx) {
  if (isClosed && !ctx.usedWays.has(wid) && (tags.place === 'square' || (['pedestrian', 'footway', 'living_street', 'service'].includes(tags.highway) && tags.area === 'yes'))) {
    const layerVal = parseFloatTagJS(tags.layer, 0) || 0;
    if (!['yes', 'building_passage'].includes(tags.tunnel) && layerVal >= 0) {
      const pts = ctx.nodesToPts(nids, 0.03);
      if (pts.length >= 3) {
        ctx.roadPolys.push({ outer: pts, holes: [], name: tags.name || '' });
        return true;
      }
    }
  }

  if (tags.highway || tags.railway || ['bridge', 'pier', 'breakwater', 'groyne'].includes(tags.man_made)) {
    if (['yes', 'building_passage', 'culvert'].includes(tags.tunnel) || tags.covered === 'yes' || tags.indoor === 'yes') return true;
    const layerVal = Math.trunc(parseFloatTagJS(tags.layer, 0) || 0);
    if (layerVal < 0 || (tags.man_made === 'bridge' && isClosed)) return true;

    const hwy = tags.highway || tags.railway || tags.man_made || 'bridge';
    if (['proposed', 'construction', 'platform', 'bus_stop', 'elevator', 'rest_area'].includes(hwy)) return true;

    const isBridge = (typeof isOsmLinearBridgeOrPierWayJS === 'function')
      ? isOsmLinearBridgeOrPierWayJS(tags)
      : Boolean((tags.bridge && !['no', 'false', '0', 'none'].includes(tags.bridge)) || ['bridge', 'pier', 'breakwater', 'groyne'].includes(tags.man_made));
    const isPath = ['footway', 'path', 'cycleway', 'steps', 'bridleway', 'track', 'corridor', 'pedestrian'].includes(hwy);

    let rwm = 6.2;
    if (isPath) {
      if (!isBridge && ['sidewalk', 'crossing', 'access_aisle', 'island'].includes(tags.footway)) return true;
      if (!isBridge && ['sidewalk', 'crossing'].includes(tags.cycleway)) return true;
      rwm = hwy === 'pedestrian' ? 3.2 : 2.2;
    } else if (['motorway', 'trunk'].includes(hwy)) rwm = 12.5;
    else if (hwy === 'primary') rwm = 10.5;
    else if (['secondary', 'motorway_link', 'trunk_link'].includes(hwy)) rwm = 8.5;
    else if (['tertiary', 'primary_link', 'secondary_link'].includes(hwy)) rwm = 7.2;
    else if (['rail', 'light_rail', 'tram', 'narrow_gauge'].includes(hwy)) {
      if (['subway', 'monorail'].includes(hwy) && !isBridge) return true;
      rwm = 4.2;
    } else if (hwy === 'service') {
      rwm = (!isBridge && ['parking_aisle', 'driveway', 'alley'].includes(tags.service)) ? 3.6 : 4.8;
    }

    const explicitW = parseFloatTagJS(tags.width, null);
    if (explicitW !== null && explicitW >= 1.2 && explicitW <= 28.0) rwm = explicitW;

    const pts = ctx.nodesToPts(nids, 0.035);
    if (pts.length >= 2) {
      ctx.roads.push({
        pts,
        width: Math.round(Math.max(0.24, rwm * ctx.metersToUnits) * 1000) / 1000,
        hwy,
        isPath: Boolean(isPath && hwy !== 'pedestrian'),
        bridge: Boolean(isBridge),
        layer: layerVal,
        name: tags.name || ''
      });
    }
    return true;
  }

  return false;
}

function finalizeOsmRoadsLayerJS(_ctx) {
  // Post-processing hook reserved for road/plaza layer refinements
}

if (typeof window !== 'undefined') {
  window.collectOsmRoadSampleCandidateJS = collectOsmRoadSampleCandidateJS;
  window.isOsmPlazaMultipolygonJS = isOsmPlazaMultipolygonJS;
  window.processOsmPlazaMultipolygonJS = processOsmPlazaMultipolygonJS;
  window.processOsmRoadOrPlazaWayJS = processOsmRoadOrPlazaWayJS;
  window.finalizeOsmRoadsLayerJS = finalizeOsmRoadsLayerJS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MOTOR_ROAD_VALS_JS,
    collectOsmRoadSampleCandidateJS,
    isOsmPlazaMultipolygonJS,
    processOsmPlazaMultipolygonJS,
    processOsmRoadOrPlazaWayJS,
    finalizeOsmRoadsLayerJS
  };
}
