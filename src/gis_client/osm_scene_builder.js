// ============================================================================
// src/gis_client/osm_scene_builder.js
// Live In-Browser OSM + DEM -> 3D Scene Builder Orchestrator
// (Delegates per-layer extraction cleanly to osm_*_extract.js modules)
// ============================================================================

if (typeof createS3DBClientCollector === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./overpass_dem_fetch.js'));
  Object.assign(global, require('./s3db_client_matcher.js'));
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

const OVERPASS_ENDPOINTS_BUILDER = [
  '/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter'
];

let _overpassMirrorRoundRobin = 0;

function _getOrderedBuilderMirrors() {
  const isHttp = typeof window === 'undefined' || !window.location || /^https?:$/i.test(window.location.protocol);
  const primary = [];
  if (isHttp) primary.push('/api/interpreter');
  const rest = OVERPASS_ENDPOINTS_BUILDER.filter(m => !primary.includes(m));
  const startIdx = (_overpassMirrorRoundRobin++) % Math.max(1, rest.length);
  const rotatedRest = rest.map((_, i) => rest[(startIdx + i) % rest.length]);
  return primary.concat(rotatedRest);
}

function fetchHedgedOverpassJson(query, options = {}) {
  const signal = options.signal || null;
  const timeoutMs = options.timeoutMs || 15000;
  const mirrors = _getOrderedBuilderMirrors();
  const staggerDelays = mirrors[0] === '/api/interpreter'
    ? [0, 6000, 8500, 11000, 13000]
    : [0, 2200, 4500, 7200, 9800];

  return new Promise((resolve, reject) => {
    let settled = false;
    let completedCount = 0;
    const errors = [];
    const abortControllers = [];
    const timers = [];
    const launched = new Set();

    function cleanup() {
      for (const t of timers) clearTimeout(t);
      for (const c of abortControllers) {
        try { c.abort(); } catch (_) {}
      }
    }

    if (signal) {
      if (signal.aborted) {
        return reject(new Error('Aborted'));
      }
      signal.addEventListener('abort', () => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error('Aborted'));
        }
      }, { once: true });
    }

    const overallTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`Overpass fetch timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    timers.push(overallTimer);

    function launchMirror(slotIdx) {
      if (settled || slotIdx >= mirrors.length || launched.has(slotIdx)) return;
      launched.add(slotIdx);
      const ep = mirrors[slotIdx];
      const ctrl = new AbortController();
      abortControllers.push(ctrl);

      (async () => {
        const r = await fetch(ep, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          signal: ctrl.signal
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        const trimmed = text ? text.trim() : '';
        if (!trimmed || trimmed.startsWith('<') || trimmed.startsWith('#')) {
          throw new Error('Invalid non-JSON response');
        }
        const j = JSON.parse(trimmed);
        if (!j || !Array.isArray(j.elements)) {
          throw new Error('No elements array in Overpass JSON');
        }
        if (j.remark && String(j.remark).trim().length > 0) {
          throw new Error(`Overpass remark: ${String(j.remark).trim()}`);
        }
        return j;
      })().then(result => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(result);
        }
      }).catch(err => {
        if (settled) return;
        errors.push(`${ep}: ${err && err.message ? err.message : String(err)}`);
        completedCount++;
        if (slotIdx + 1 < mirrors.length) {
          launchMirror(slotIdx + 1);
        }
        if (completedCount >= mirrors.length) {
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error(`All Overpass mirrors failed: ${errors.join('; ')}`));
          }
        }
      });
    }

    launchMirror(0);

    if (mirrors[0] !== '/api/interpreter') {
      for (let i = 1; i < mirrors.length; i++) {
        const t = setTimeout(() => {
          if (!settled) launchMirror(i);
        }, staggerDelays[i] || (i * 2500));
        timers.push(t);
      }
    }
  });
}

if (typeof window !== 'undefined') {
  window.fetchHedgedOverpassJson = fetchHedgedOverpassJson;
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
    ? buildAdaptiveOverpassQL(south, west, north, east, selectLodTier(effectiveSpanM), 14, lodQueryOpts)
    : `[out:json][timeout:14][bbox:${bbox}];` +
      `(relation["building"];relation["type"="building"];relation["building:part"];relation["man_made"="bridge"];)->.brels;` +
      `(.brels;>;)->.ball;` +
      `(relation["type"="multipolygon"]["natural"~"^(water|wood|scrub|grassland|heath)$"];relation["type"="multipolygon"]["waterway"~"^(riverbank|dock|canal)$"];relation["type"="multipolygon"]["water"];relation["type"="multipolygon"]["landuse"];relation["type"="multipolygon"]["leisure"];relation["type"="multipolygon"]["highway"="pedestrian"];)->.grels;` +
      `way(r.grels)(${bbox})->.gways;` +
      `(way["building"];way["building:part"];way["natural"];way["waterway"];way["water"];way["landuse"];way["leisure"];way["highway"];way["place"="square"];way["railway"];way["man_made"~"^(bridge|pier|breakwater|groyne)$"];.gways;)->.wbox;` +
      `(relation.ball;.grels;.wbox;way.ball;node["natural"="tree"];);out body qt;` +
      `(node(w.wbox);node.ball;);out skel qt;`;

  const metersToUnits = 169.2 / Math.max(1, effectiveSpanM);
  const fetchHalfW = Math.round((0.5 * spanEwM * metersToUnits) * 100) / 100;
  const fetchHalfH = Math.round((0.5 * spanNsM * metersToUnits) * 100) / 100;

  let halfW, halfH;
  if (options && Number(options.targetWidthMm) > 0 && Number(options.targetHeightMm) > 0) {
    const tW = Number(options.targetWidthMm);
    const tH = Number(options.targetHeightMm);
    const tMax = Math.max(tW, tH);
    halfW = Math.round((84.6 * tW / tMax) * 100) / 100;
    halfH = Math.round((84.6 * tH / tMax) * 100) / 100;
  } else {
    halfW = Math.round((84.6 * spanEwM / maxSpanM) * 100) / 100;
    halfH = Math.round((84.6 * spanNsM / maxSpanM) * 100) / 100;
  }

  const halfM = maxSpanM * 0.5;
  const demHalfUnits = Math.round((halfM * metersToUnits) * 100) / 100;
  const sqDLat = halfM / 111320.0;
  const sqDLon = halfM / (111320.0 * cosLat);
  const demPromise = fetchTerrariumDemInBrowser(centerLat - sqDLat, centerLon - sqDLon, centerLat + sqDLat, centerLon + sqDLon, 72, null);

  let osmRaw = null;
  let overpassError = null;

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
      buildings: [],
      _fallback: true,
      _error: overpassError ? overpassError.message : 'Overpass unreachable'
    };
  }

  const project = (lon, lat) => [
    Math.round((lon - centerLon) * 111320.0 * cosLat * metersToUnits * 1000) / 1000,
    Math.round((lat - centerLat) * 111320.0 * metersToUnits * 1000) / 1000
  ];

  const nodes = new Map();
  const ways = new Map();
  const relations = [];
  const treeNodes = [];

  for (const el of (osmRaw.elements || [])) {
    if (el.type === 'node') {
      const pt = project(el.lon, el.lat);
      nodes.set(el.id, pt);
      collectOsmTreeNodeJS(el, pt, wantTrees, fetchHalfW, fetchHalfH, treeNodes);
    } else if (el.type === 'way') {
      ways.set(el.id, el);
    } else if (el.type === 'relation') {
      relations.push(el);
    }
  }

  const nodesToPts = (nids, tol = 0.015) => simplifyRingJS((nids || []).map(id => nodes.get(id)).filter(Boolean), tol);
  const waterPolys = [], waterLines = [], greenPolys = [], roads = [], roadPolys = [], bridgePolys = [], coastWays = [];
  const usedWays = new Set();
  const consumedRels = new Set();

  const s3db = createS3DBClientCollector(fetchHalfW, fetchHalfH, metersToUnits);
  const relById = new Map(relations.map(r => [r.id, r]));
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
  const waterSamplePts = downsampleUniform(allWaterCandidates, 240);
  const buildingSamplePts = downsampleUniform(allBldCandidates, 650);
  const roadSamplePts = downsampleUniform(allRoadCandidates, 450);

  for (const rel of relations) {
    const outerWays = [], innerWays = [], memberWayIds = [];
    for (const m of (rel.members || [])) {
      if (m.type === 'way' && ways.has(m.ref)) {
        const role = m.role ?? 'outer';
        if (role === 'part') continue;
        const wNodes = ways.get(m.ref).nodes || [];
        if (role === 'inner') {
          innerWays.push(wNodes);
          memberWayIds.push(m.ref);
        } else if (role === 'outer' || role === 'outline' || role === '') {
          outerWays.push(wNodes);
          memberWayIds.push(m.ref);
        }
      }
    }
    if (outerWays.length > 0) {
      rawRelWays.set(rel.id, { outerWays, innerWays, memberWayIds });
      const outerPolys = stitchWayRingsJS(outerWays).map(r => nodesToPts(r, 0.018)).filter(p => p.length >= 3);
      const innerPolys = stitchWayRingsJS(innerWays).map(r => nodesToPts(r, 0.018)).filter(p => p.length >= 3);
      if (outerPolys.length > 0) stitchedRelPolys.set(rel.id, { outerPolys, innerPolys, memberWayIds });
    }
  }

  const osmExtractCtx = {
    osmRaw, nodes, ways, relations, relById, rawRelWays, stitchedRelPolys,
    usedWays, consumedRels, s3db,
    nodesToPts, project,
    fetchHalfW, fetchHalfH, halfW, halfH, metersToUnits, effectiveSpanM,
    wantTrees, minBldFootprintM, roadDetail, lodSettings,
    waterSamplePts, buildingSamplePts, roadSamplePts,
    coastWays, treeNodes,
    waterPolys, waterLines, greenPolys, roads, roadPolys, bridgePolys
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
    buildings
  };

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
    fetchRealGISInBrowser
  };
}
