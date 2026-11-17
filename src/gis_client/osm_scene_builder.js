// ============================================================================
// src/gis_client/osm_scene_builder.js
// Live In-Browser OSM + DEM -> 3D Scene Builder Orchestrator
// (Delegates per-layer extraction cleanly to osm_*_extract.js modules)
// ============================================================================

if (typeof createS3DBClientCollector === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./overpass_dem_fetch.js'));
  Object.assign(global, require('./s3db_client_matcher.js'));
}
if (typeof fetchHedgedOverpassJson === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../gis_fetch/osm_element_merger.js'));
  Object.assign(global, require('../gis_fetch/overpass_mirror_router.js'));
}
if (typeof processOsmWaterWayJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./osm_water_extract.js'));
}
if (typeof processOsmBridgeOrPierWayJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./osm_bridges_piers_extract.js'));
}
if (typeof processOsmGreeneryWayJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./osm_greenery_extract.js'));
}
if (typeof processOsmRoadOrPlazaWayJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./osm_roads_extract.js'));
}
if (typeof finalizeOsmTreesLayerJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./osm_trees_extract.js'));
}
if (typeof finalizeOsmBuildingsLayerJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./osm_buildings_extract.js'));
}

if (typeof window !== 'undefined') {
  if (typeof fetchHedgedOverpassJson === 'function') window.fetchHedgedOverpassJson = fetchHedgedOverpassJson;
  if (typeof mergeOsmElementJS === 'function') window.mergeOsmElementJS = mergeOsmElementJS;
}

async function fetchRealGISInBrowser(south, west, north, east, title, options = {}) {
  const centerLat = (south + north) * 0.5;
  const centerLon = (west + east) * 0.5;
  const cosLat = Math.max(0.2, Math.cos(centerLat * Math.PI / 180.0));
  const spanNsM = Math.abs(north - south) * 111320.0;
  const spanEwM = Math.abs(east - west) * 111320.0 * cosLat;
  const maxSpanM = Math.max(spanEwM, spanNsM, 1);
  const effectiveSpanM = (options && Number(options.targetSpanMeters) > 0)
    ? Number(options.targetSpanMeters)
    : maxSpanM;

  const lodSettings = (options && options.lodSettings) || null;
  const spanKm = effectiveSpanM / 1000.0;
  const wantTrees = lodSettings
    ? (lodSettings.enableTrees !== false && spanKm <= (lodSettings.treeMaxSpanKm ?? 4.0))
    : (spanKm <= 4.0);
  const minBldFootprintM = (lodSettings && typeof lodSettings.minBuildingFootprintM === 'number')
    ? lodSettings.minBuildingFootprintM
    : 0;
  const roadDetail = (lodSettings && lodSettings.roadDetail) || 'all';
  const lodQueryOpts = { wantTrees, minBuildingFootprintM: minBldFootprintM, roadDetail };

  const bbox = `${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)}`;
  const query = (typeof buildAdaptiveOverpassQL === 'function' && typeof selectLodTier === 'function')
    ? buildAdaptiveOverpassQL(south, west, north, east, selectLodTier(effectiveSpanM), 20, lodQueryOpts)
    : `[out:json][timeout:20][bbox:${bbox}];` +
      `way->.bw;` +
      `(rel(bw.bw)["type"~"^(building|bridge)$"];rel(bw.bw)["building"];rel(bw.bw)["building:part"];rel(bw.bw)["bridge:support"];rel(bw.bw)["man_made"="bridge"];rel(bw.bw)["attraction"~"^(big_wheel|observation_wheel|ferris_wheel)$"];)->.br;` +
      `(way(r.br);rel(r.br)->.brs;way(r.brs);)->.brw;` +
      `rel(bw.bw)["type"="multipolygon"][!"building"][!"building:part"][!"route"][!"boundary"][!"restriction"][place!~"^(sea|ocean|peninsula|archipelago|continent|country|state|region)$"]["place"~"^(island|islet|square)$"]->.isl;` +
      `way(r.isl)->.islw;` +
      `rel(bw.bw)["type"="multipolygon"][!"building"][!"building:part"][!"route"][!"boundary"][!"restriction"][natural!~"^(bay|strait|peninsula|cape|mountain_range|massif|desert|valley|sea|ridge)$"][place!~"^(sea|ocean|peninsula|archipelago|continent|country|state|region)$"][~"^(natural|waterway|water|landuse|leisure|highway|area:highway|man_made|railway|public_transport)$"~"."]->.mp;` +
      `way(r.mp)(${bbox})->.mpw;` +
      `(way.bw[~"^(building|building:part|natural|waterway|water|landuse|leisure|highway|area:highway|railway|bridge:support)$"~"."];way.bw["attraction"~"^(big_wheel|observation_wheel|ferris_wheel)$"];way.bw["place"~"^(square|island|islet)$"];way.bw["public_transport"="platform"];way.bw["power"="generator"];way.bw["man_made"~"^(bridge|pier|pontoon|breakwater|groyne|jetty|quay|tower|mast|communications_tower|lighthouse|chimney|cooling_tower|storage_tank|silo|crane|wind_turbine)$"];.brw;.islw;.mpw;)->.wbox;` +
      `(rel.br;rel.brs;.isl;.mp;.wbox;node["natural"="tree"];node["bridge:support"];node["man_made"~"^(wind_turbine|tower|mast|communications_tower|lighthouse|chimney|crane)$"];node["power"="generator"]["generator:source"="wind"];node(r.br););out body qt;` +
      `node(w.wbox);out skel qt;`;

  const spanU = (typeof SCENE_CANONICAL_SPAN_UNITS !== 'undefined') ? SCENE_CANONICAL_SPAN_UNITS : 169.2;
  const halfU = (typeof SCENE_CANONICAL_HALF_UNITS !== 'undefined') ? SCENE_CANONICAL_HALF_UNITS : 84.6;
  const metersToUnits = spanU / Math.max(1, effectiveSpanM);
  const fetchHalfW = Math.round((0.5 * spanEwM * metersToUnits) * 100) / 100;
  const fetchHalfH = Math.round((0.5 * spanNsM * metersToUnits) * 100) / 100;

  let halfW, halfH;
  if (options && Number(options.targetWidthMm) > 0 && Number(options.targetHeightMm) > 0) {
    const tW = Number(options.targetWidthMm);
    const tH = Number(options.targetHeightMm);
    const tMax = Math.max(tW, tH);
    halfW = Math.round((halfU * tW / tMax) * 100) / 100;
    halfH = Math.round((halfU * tH / tMax) * 100) / 100;
  } else {
    halfW = Math.round((halfU * spanEwM / maxSpanM) * 100) / 100;
    halfH = Math.round((halfU * spanNsM / maxSpanM) * 100) / 100;
  }

  const halfM = maxSpanM * 0.5;
  const demHalfUnits = Math.round((halfM * metersToUnits) * 100) / 100;
  const sqDLat = halfM / 111320.0;
  const sqDLon = halfM / (111320.0 * cosLat);
  const hasPreloadedOsm = Boolean(options && Array.isArray(options._preloadedOsmElements));
  const hasPreloadedDem = Boolean(options && options._preloadedDem && Array.isArray(options._preloadedDem.grid));

  const demPromise = hasPreloadedDem
    ? Promise.resolve(options._preloadedDem)
    : fetchTerrariumDemInBrowser(centerLat - sqDLat, centerLon - sqDLon, centerLat + sqDLat, centerLon + sqDLon, 72, null);

  let osmRaw = null;
  let overpassError = null;

  if (hasPreloadedOsm) {
    osmRaw = { elements: options._preloadedOsmElements };
  } else {
    try {
      osmRaw = await fetchHedgedOverpassJson(query, {
        signal: options && options.signal,
        timeoutMs: (options && options.timeoutMs) || 18000
      });
    } catch (err) {
      overpassError = err;
      if (options && options.throwOnError) {
        throw err;
      }
    }
  }

  let dem = null;
  try {
    dem = await demPromise;
  } catch (demErr) {
    if (overpassError) {
      throw new Error(`Both DEM and Overpass failed: DEM (${demErr && demErr.message}), OSM (${overpassError && overpassError.message})`);
    }
    dem = { gridSize: 72, minElev: 0, maxElev: 15, grid: Array.from({ length: 72 }, () => Array(72).fill(0)), zoom: 14 };
  }

  if (!osmRaw || !Array.isArray(osmRaw.elements)) {
    return {
      bbox: [south, west, north, east],
      center: [Math.round(centerLat * 1000000) / 1000000, Math.round(centerLon * 1000000) / 1000000],
      spanMeters: Math.round(effectiveSpanM),
      metersToUnits,
      halfW,
      halfH,
      _fetchHalfW: fetchHalfW,
      _fetchHalfH: fetchHalfH,
      _demHalfUnits: demHalfUnits,
      title: title || 'MAP3D',
      dem,
      waterPolys: [],
      waterLines: [],
      greenPolys: [],
      trees: [],
      roads: [],
      roadPolys: [],
      bridgePolys: [],
      pierPolys: [],
      pierLines: [],
      bridgeSupports: [],
      buildings: [],
      _fallback: true,
      _error: overpassError ? overpassError.message : 'Overpass unreachable'
    };
  }

  const project = (lon, lat) => [
    Math.round((lon - centerLon) * 111320.0 * cosLat * metersToUnits * 10000) / 10000,
    Math.round((lat - centerLat) * 111320.0 * metersToUnits * 10000) / 10000
  ];

  const nodeEls = new Map();
  const ways = new Map();
  const relById = new Map();
  const nodes = new Map();
  const treeNodes = [];
  const bridgeSupports = [];
  let hasMarineTags = false;
  const skipRedundantDedup = Boolean(options && options._alreadyDeduplicated);

  if (skipRedundantDedup) {
    for (let i = 0, list = osmRaw.elements, len = list.length; i < len; i++) {
      const el = list[i];
      if (!el || el.id === undefined || el.id === null) continue;
      if (el.type === 'node') nodeEls.set(el.id, el);
      else if (el.type === 'way') ways.set(el.id, el);
      else if (el.type === 'relation') relById.set(el.id, el);
    }
  } else {
    for (const el of (osmRaw.elements || [])) {
      if (!el || el.id === undefined || el.id === null) continue;
      if (el.type === 'node') {
        const prev = nodeEls.get(el.id);
        nodeEls.set(el.id, prev ? mergeOsmElementJS(prev, el) : el);
      } else if (el.type === 'way') {
        const prev = ways.get(el.id);
        ways.set(el.id, prev ? mergeOsmElementJS(prev, el) : el);
      } else if (el.type === 'relation') {
        const prev = relById.get(el.id);
        relById.set(el.id, prev ? mergeOsmElementJS(prev, el) : el);
      }
    }
  }

  const checkMarineTags = (et) => {
    if (et && (
      et.place === 'sea' ||
      et.place === 'ocean' ||
      /^(coastline|bay|strait|reef|shoal)$/.test(et.natural || '') ||
      Boolean(et['seamark:type'])
    )) {
      hasMarineTags = true;
    }
  };

  for (const el of nodeEls.values()) {
    checkMarineTags(el.tags);
    if (!Number.isFinite(el.lon) || !Number.isFinite(el.lat)) continue;
    const pt = project(el.lon, el.lat);
    nodes.set(el.id, pt);
    collectOsmTreeNodeJS(el, pt, wantTrees, fetchHalfW, fetchHalfH, treeNodes);
    if (typeof collectOsmBridgeSupportNodeJS === 'function') {
      collectOsmBridgeSupportNodeJS(el, pt, bridgeSupports);
    }
  }
  for (const w of ways.values()) {
    checkMarineTags(w.tags);
  }
  const relations = Array.from(relById.values());
  for (const rel of relations) {
    checkMarineTags(rel.tags);
  }

  const maxMetricSimpU = Math.max(0.0015, 0.20 * metersToUnits);
  const nodesToPts = (nids, tol = 0.015) => simplifyRingJS(
    (nids || []).map(id => nodes.get(id)).filter(Boolean),
    Math.min(tol, maxMetricSimpU)
  );
  const waterPolys = [], waterLines = [], greenPolys = [], roads = [], roadPolys = [], bridgePolys = [], coastWays = [];
  const usedWays = new Set();
  const consumedRels = new Set();

  const s3db = createS3DBClientCollector(fetchHalfW, fetchHalfH, metersToUnits);
  const rawRelWays = new Map();
  const stitchedRelPolys = new Map();

  // Sample dry-land building interiors, ground streets, and named river/canal centerlines
  const allWaterCandidates = [];
  const allBldCandidates = [];
  const allRoadCandidates = [];
  for (const w of ways.values()) {
    const wt = w.tags || {};
    const wn = w.nodes || [];
    if (wn.length < 2) continue;
    const isBrWay = Boolean(wt.bridge && !['no', 'false', '0', 'none'].includes(String(wt.bridge).toLowerCase()));
    const isTunWay = Boolean(wt.tunnel && !['no', 'false', '0', 'none'].includes(String(wt.tunnel).toLowerCase()));

    if (collectOsmWaterSampleCandidateJS(w, wt, wn, isBrWay, isTunWay, nodes, fetchHalfW, fetchHalfH, allWaterCandidates)) continue;
    if (collectOsmBuildingSampleCandidateJS(w, wt, wn, isBrWay, isTunWay, nodes, fetchHalfW, fetchHalfH, allBldCandidates)) continue;
    collectOsmRoadSampleCandidateJS(w, wt, wn, isBrWay, isTunWay, nodes, fetchHalfW, fetchHalfH, allRoadCandidates);
  }
  const downsampleUniform = (arr, maxLen) => {
    if (arr.length <= maxLen) return arr;
    const out = [];
    const step = arr.length / maxLen;
    for (let i = 0; i < maxLen; i++) out.push(arr[Math.floor(i * step)]);
    return out;
  };
  const waterSamplePts = downsampleUniform(allWaterCandidates, 2400);
  const buildingSamplePts = downsampleUniform(allBldCandidates, 5000);
  const roadSamplePts = downsampleUniform(allRoadCandidates, 3500);

  const bridgeRelMeta = [];
  for (const rel of relations) {
    const relTags = rel.tags || {};
    const isBridgeRel = Boolean(relTags.type === 'bridge' || relTags.man_made === 'bridge');
    const outerWays = [], innerWays = [], memberWayIds = [];
    const acrossWayIds = [], supportWayIds = [], supportNodeIds = [], outlineWayIds = [], outlineRelIds = [];
    for (const m of (rel.members || [])) {
      const role = m.role ?? 'outer';
      if (m.type === 'way' && ways.has(m.ref)) {
        if (role === 'part') continue;
        const mw = ways.get(m.ref);
        const mwt = (mw && mw.tags) || {};
        const isSupWay = Boolean(
          mwt['bridge:support'] &&
          !['no', 'false', '0', 'none'].includes(String(mwt['bridge:support']).trim().toLowerCase()) &&
          mwt.man_made !== 'bridge'
        );
        if (isBridgeRel) {
          if (role === 'under') continue;
          if (role === 'across' || role === 'forward' || role === 'backward') { acrossWayIds.push(m.ref); continue; }
          if (isSupWay || role === 'support' || role === 'pier' || role === 'pylon') { supportWayIds.push(m.ref); continue; }
        } else if (role === 'inner' && isSupWay && typeof isOsmWaterMultipolygonJS === 'function' && isOsmWaterMultipolygonJS(relTags)) {
          // Do not cut dry-land dirt islands in rivers for concrete bridge:support=pier footprints
          continue;
        }
        const wNodes = mw.nodes || [];
        if (role === 'inner') {
          innerWays.push(wNodes);
          memberWayIds.push(m.ref);
        } else if (role === 'outer' || role === 'outline' || role === '') {
          outerWays.push(wNodes);
          memberWayIds.push(m.ref);
          if (isBridgeRel) outlineWayIds.push(m.ref);
        }
      } else if (isBridgeRel && m.type === 'relation' && (role === 'outline' || role === 'outer' || role === '')) {
        outlineRelIds.push(m.ref);
      } else if (isBridgeRel && m.type === 'node' && (role === 'support' || role === 'pier' || role === 'pylon')) {
        supportNodeIds.push(m.ref);
      }
    }
    if (isBridgeRel) {
      bridgeRelMeta.push({ relId: rel.id, tags: relTags, acrossWayIds, supportWayIds, supportNodeIds, outlineWayIds, outlineRelIds });
    }
    if (outerWays.length > 0) {
      rawRelWays.set(rel.id, { outerWays, innerWays, memberWayIds });
      const relSimpTol = effectiveSpanM <= 3500 ? 0.006 : 0.018;
      const outerPolys = stitchWayRingsJS(outerWays).map(r => nodesToPts(r, relSimpTol)).filter(p => p.length >= 3);
      const innerPolys = stitchWayRingsJS(innerWays).map(r => nodesToPts(r, relSimpTol)).filter(p => p.length >= 3);
      if (outerPolys.length > 0) stitchedRelPolys.set(rel.id, { outerPolys, innerPolys, memberWayIds });
    }
  }
  for (const meta of bridgeRelMeta) {
    if (!stitchedRelPolys.has(meta.relId) && meta.outlineRelIds.length > 0) {
      for (const orid of meta.outlineRelIds) {
        const subSt = stitchedRelPolys.get(orid);
        if (subSt) {
          stitchedRelPolys.set(meta.relId, subSt);
          rawRelWays.set(meta.relId, rawRelWays.get(orid) || { outerWays: [], innerWays: [], memberWayIds: subSt.memberWayIds || [] });
          consumedRels.add(orid);
          break;
        }
      }
    }
  }

  const osmExtractCtx = {
    osmRaw, nodes, ways, relations, relById, rawRelWays, stitchedRelPolys, bridgeRelMeta,
    usedWays, consumedRels, s3db,
    nodesToPts, project,
    fetchHalfW, fetchHalfH, halfW, halfH, metersToUnits, effectiveSpanM,
    wantTrees, minBldFootprintM, roadDetail, lodSettings,
    isResin: true,
    waterSamplePts, buildingSamplePts, roadSamplePts,
    coastWays, treeNodes,
    waterPolys, waterLines, greenPolys, roads, roadPolys, bridgePolys, bridgeSupports
  };

  // Pass 1B: Explicit S3DB type=building relations
  processOsmS3DBRelationsPass1BJS(osmExtractCtx);

  // Pass 1C: Remaining Multipolygon Relations
  for (const rel of relations) {
    if (consumedRels.has(rel.id)) continue;
    const tags = rel.tags || {};
    const raw = rawRelWays.get(rel.id);
    if (!raw) continue;

    if (processOsmBuildingMultipolygonJS(rel, tags, raw, osmExtractCtx)) continue;
    if (processOsmBridgeMultipolygonJS(rel, tags, raw, osmExtractCtx)) continue;

    const relTypeNorm = tags.type ? String(tags.type).trim().toLowerCase() : '';
    if (relTypeNorm && relTypeNorm !== 'multipolygon' && relTypeNorm !== 'boundary') continue;

    const extraFlags = {
      isGreen: isOsmGreeneryMultipolygonJS(tags),
      isPlaza: isOsmPlazaMultipolygonJS(tags)
    };
    if (processOsmWaterMultipolygonJS(rel, tags, raw, osmExtractCtx, extraFlags)) continue;
    if (processOsmGreeneryMultipolygonJS(rel, tags, raw, osmExtractCtx, extraFlags)) continue;
    processOsmPlazaMultipolygonJS(rel, tags, raw, osmExtractCtx);
  }

  // Pass 2: Standalone Ways
  for (const [wid, w] of ways.entries()) {
    const tags = w.tags || {};
    const nids = w.nodes || [];
    if (nids.length < 2) continue;
    const isClosed = nids[0] === nids[nids.length - 1] && nids.length >= 4;

    if (processOsmBuildingWayJS(wid, w, tags, nids, isClosed, osmExtractCtx)) continue;
    if (processOsmCoastlineWayJS(wid, w, tags, nids, isClosed, osmExtractCtx)) continue;
    if (processOsmBridgeOrPierWayJS(wid, w, tags, nids, isClosed, osmExtractCtx)) continue;
    if (processOsmWaterWayJS(wid, w, tags, nids, isClosed, osmExtractCtx)) continue;
    if (processOsmGreeneryWayJS(wid, w, tags, nids, isClosed, osmExtractCtx)) continue;
    if (processOsmTreeRowWayJS(wid, w, tags, nids, isClosed, osmExtractCtx)) continue;
    processOsmRoadOrPlazaWayJS(wid, w, tags, nids, isClosed, osmExtractCtx);
  }

  const buildings = finalizeOsmBuildingsLayerJS(osmExtractCtx);
  finalizeOsmWaterLayerJS(osmExtractCtx);
  finalizeOsmBridgesLayerJS(osmExtractCtx);
  finalizeOsmGreeneryLayerJS(osmExtractCtx);
  finalizeOsmRoadsLayerJS(osmExtractCtx);
  const trees = finalizeOsmTreesLayerJS(osmExtractCtx);

  const outScene = {
    bbox: [south, west, north, east],
    center: [Math.round(centerLat * 1000000) / 1000000, Math.round(centerLon * 1000000) / 1000000],
    spanMeters: Math.round(effectiveSpanM),
    metersToUnits,
    halfW,
    halfH,
    _fetchHalfW: fetchHalfW,
    _fetchHalfH: fetchHalfH,
    _demHalfUnits: demHalfUnits,
    title: title || 'MAP3D',
    dem,
    waterPolys,
    waterLines,
    greenPolys,
    trees,
    roads,
    roadPolys,
    bridgePolys,
    pierPolys: osmExtractCtx.pierPolys || [],
    pierLines: osmExtractCtx.pierLines || [],
    bridgeSupports,
    buildings,
    osmElements: osmRaw.elements
  };
  if (hasMarineTags) outScene._hasMarineTags = true;
  if (osmExtractCtx._openSeaIslands && osmExtractCtx._openSeaIslands.length > 0) {
    outScene._openSeaIslands = osmExtractCtx._openSeaIslands;
    outScene._openSeaRect = osmExtractCtx._openSeaRect;
  }

  if (options && typeof options.rotationDeg === 'number' && Number.isFinite(options.rotationDeg)) {
    const rRad = (options.rotationDeg * Math.PI) / 180.0;
    const cR = Math.cos(rRad), sR = Math.sin(rRad);
    const limW = halfW + 2.5, limH = halfH + 2.5;
    outScene._priorityBedCheck = (wx, wy) => {
      const bx = wx * cR - wy * sR;
      const by = wx * sR + wy * cR;
      return Math.abs(bx) <= limW && Math.abs(by) <= limH;
    };
  }

  return outScene;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fetchHedgedOverpassJson,
    fetchRealGISInBrowser,
    mergeOsmElementJS
  };
}
