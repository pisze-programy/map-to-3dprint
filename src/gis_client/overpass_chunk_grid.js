// ============================================================================
// src/gis_client/overpass_chunk_grid.js
// Scale-Adaptive Overpass QL Builder, Spatial Chunk Grid, Hedged Multi-Mirror
// Fetcher & Recursive 2x2 Sub-Chunk Fallback
// ============================================================================

const _overpassChunkCache = new Map();
const _origWindowFetch = (typeof window !== 'undefined' && window.fetch) ? window.fetch.bind(window) : fetch;

const OVERPASS_MIRRORS = [
  '/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];

let _mirrorRoundRobinIdx = 0;

function selectLodTier(spanMeters) {
  const s = Number(spanMeters) || 1200;
  if (s <= 1650) return 'detail';
  if (s <= 3800) return 'urban';
  if (s <= 7200) return 'regional';
  return 'mountain';
}

const _BUILD_QL_LAYER2_WAY = 'way.bw["bridge:support"];way.bw["power"="generator"];way.bw["man_made"~"^(bridge|pier|pontoon|breakwater|groyne|jetty|quay|tower|mast|communications_tower|lighthouse|chimney|cooling_tower|storage_tank|silo|crane|wind_turbine)$"];';
const _BUILD_QL_LAYER2_NODE = 'node["bridge:support"];node["man_made"~"^(wind_turbine|tower|mast|communications_tower|lighthouse|chimney|crane)$"];node["power"="generator"]["generator:source"="wind"];';
const _BUILD_QL_REL_BRIDGE_BLD = '(rel(bw.bw)["type"~"^(building|bridge)$"];rel(bw.bw)["building"];rel(bw.bw)["building:part"];rel(bw.bw)["bridge:support"];rel(bw.bw)["man_made"="bridge"];rel(bw.bw)["attraction"~"^(big_wheel|observation_wheel|ferris_wheel)$"];)->.br;(way(r.br);rel(r.br)->.brs;way(r.brs);)->.brw;';
const _MP_EXCL_CONTINENTAL = '[!"building"][!"building:part"][!"route"][!"boundary"][!"restriction"][natural!~"^(bay|strait|peninsula|cape|mountain_range|massif|desert|valley|sea|ridge)$"][place!~"^(sea|ocean|peninsula|archipelago|continent|country|state|region)$"]';
const _MP_STD_CLAUSES =
  `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["natural"~"^(water|wood|scrub|grassland|heath|wetland|beach|shingle|shoal|mud|bare_rock)$"];` +
  `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["waterway"];` +
  `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["water"];` +
  `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["landuse"~"^(reservoir|basin|forest|grass|meadow|park|recreation_ground|cemetery|village_green|allotments|farmland|orchard|vineyard)$"];` +
  `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["leisure"~"^(park|garden|nature_reserve|pitch|playground|common|golf_course|recreation_ground|dog_park|marina|swimming_pool)$"];` +
  `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["highway"="pedestrian"];` +
  `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["area:highway"];` +
  `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["man_made"~"^(quay|pier|pontoon|breakwater|groyne|jetty)$"];` +
  `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["railway"="platform"];` +
  `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["public_transport"="platform"];`;
const _MP_MTN_CLAUSES =
  `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["natural"~"^(water|wood|scrub|shingle|shoal)$"];` +
  `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["waterway"];` +
  `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["water"];` +
  `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["landuse"~"^(reservoir|basin|forest)$"];` +
  `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["leisure"~"^(park|nature_reserve|marina)$"];`;

function _assembleSpatialQL(bbox, timeoutSec, mpClauses, wayClauses, nodeClauses, includeNodesInBr = true) {
  const relNodeOut = includeNodesInBr ? 'node(r.br);' : '';
  const brsOut = includeNodesInBr ? 'rel.brs;' : '';
  return `[out:json][timeout:${timeoutSec}][bbox:${bbox}];` +
    `way->.bw;` +
    _BUILD_QL_REL_BRIDGE_BLD +
    `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["place"~"^(island|islet|square)$"]->.isl;` +
    `way(r.isl)->.islw;` +
    `(${mpClauses})->.mp;` +
    `way(r.mp)(${bbox})->.mpw;` +
    `(${wayClauses}.brw;.islw;.mpw;)->.wbox;` +
    `(rel.br;${brsOut}.isl;.mp;.wbox;${nodeClauses}${relNodeOut});out body qt;` +
    `node(w.wbox);out skel qt;`;
}

function buildAdaptiveOverpassQL(south, west, north, east, lodTier = 'detail', timeoutSec = 20, lodOptions = null) {
  const bbox = `${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)}`;
  const wantTrees = (lodOptions && typeof lodOptions.wantTrees === 'boolean')
    ? lodOptions.wantTrees
    : (lodTier === 'detail' || lodTier === 'urban');
  const minBldM = (lodOptions && typeof lodOptions.minBuildingFootprintM === 'number')
    ? lodOptions.minBuildingFootprintM
    : 0;
  const roadDetail = (lodOptions && lodOptions.roadDetail) || 'all';
  const nodeClause = wantTrees ? `node["natural"="tree"];${_BUILD_QL_LAYER2_NODE}` : _BUILD_QL_LAYER2_NODE;
  const wheelFilter = 'way.bw["attraction"~"^(big_wheel|observation_wheel|ferris_wheel)$"];';
  const bridgeValRegex = '^(yes|viaduct|aqueduct|boardwalk|cantilever|covered|movable|suspension|trestle)$';
  const majorHwyFilter = 'way.bw["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"];';
  const elevatedTransitFilter = `way.bw["railway"~"^(monorail|subway)$"]["bridge"~"${bridgeValRegex}"];`;

  if (lodTier === 'detail') {
    const hwyFilter = roadDetail === 'major' ? majorHwyFilter : 'way.bw["highway"];';
    const extraBridge = roadDetail === 'major'
      ? `way.bw["highway"]["bridge"~"${bridgeValRegex}"];`
      : '';
    const ways =
      'way.bw["building"];way.bw["building:part"];' +
      'way.bw["natural"~"^(water|coastline|wood|scrub|grassland|heath|tree_row|beach|wetland|shingle|shoal|mud|bare_rock)$"];' +
      'way.bw["waterway"];way.bw["water"];way.bw["landuse"];way.bw["leisure"];way.bw["area:highway"];way.bw["railway"];' +
      'way.bw["amenity"="fountain"];' +
      wheelFilter + hwyFilter + extraBridge +
      'way.bw["place"~"^(square|island|islet)$"];way.bw["public_transport"="platform"];' +
      _BUILD_QL_LAYER2_WAY;
    return _assembleSpatialQL(bbox, timeoutSec, _MP_STD_CLAUSES, ways, nodeClause);
  }
  if (lodTier === 'urban') {
    const bldWay = minBldM <= 0
      ? 'way.bw["building"];way.bw["building:part"];'
      : 'way.bw["building"][building!~"^(shed|garage|garages|hut|cabin|kiosk|roof|allotment_house|sty|greenhouse|static_caravan|ger)$"];way.bw["building:part"];';
    const hwyFilter = roadDetail === 'major'
      ? majorHwyFilter
      : 'way.bw["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|service|cycleway|footway|path|steps|track|bridleway|corridor)$"];';
    const extraBridge = roadDetail === 'major'
      ? `way.bw["highway"]["bridge"~"${bridgeValRegex}"];`
      : '';
    const ways =
      bldWay + wheelFilter + hwyFilter + extraBridge +
      'way.bw["natural"~"^(water|coastline|wood|scrub|grassland|heath|tree_row|beach|wetland|shingle|shoal|mud|bare_rock)$"];' +
      'way.bw["waterway"];way.bw["water"];way.bw["area:highway"];' +
      'way.bw["landuse"~"^(reservoir|basin|forest|grass|meadow|park|recreation_ground|cemetery|village_green|allotments|farmland|orchard|vineyard)$"];' +
      'way.bw["leisure"~"^(park|garden|nature_reserve|pitch|playground|common|golf_course|recreation_ground|dog_park|marina|swimming_pool)$"];' +
      'way.bw["place"~"^(square|island|islet)$"];way.bw["railway"~"^(rail|light_rail|tram|narrow_gauge|funicular|platform)$"];' +
      elevatedTransitFilter + 'way.bw["public_transport"="platform"];' +
      _BUILD_QL_LAYER2_WAY;
    return _assembleSpatialQL(bbox, timeoutSec, _MP_STD_CLAUSES, ways, nodeClause);
  }
  if (lodTier === 'regional') {
    const regNodes = (lodOptions && lodOptions.wantTrees === true) ? `node["natural"="tree"];${_BUILD_QL_LAYER2_NODE}` : _BUILD_QL_LAYER2_NODE;
    const natRegex = (lodOptions && lodOptions.wantTrees === true)
      ? '^(water|coastline|wood|scrub|grassland|heath|beach|shingle|shoal|mud|tree_row)$'
      : '^(water|coastline|wood|scrub|grassland|heath|beach|shingle|shoal|mud)$';
    const exclBld = minBldM <= 0
      ? '^(shed|garage|garages|hut|cabin|kiosk|roof|allotment_house|sty|greenhouse|static_caravan|ger)$'
      : '^(shed|garage|garages|hut|cabin|kiosk|roof|allotment_house|greenhouse|house|detached|terrace|semidetached_house|bungalow|farm_auxiliary|barn)$';
    const regHwyFilter = roadDetail === 'major'
      ? majorHwyFilter
      : 'way.bw["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|service|path|cycleway|steps|track)$"];' +
        'way.bw["highway"="footway"][footway!~"^(sidewalk|crossing|access_aisle|island)$"];';
    const ways =
      `way.bw["building"][building!~"${exclBld}"];way.bw["building"]["height"];way.bw["building"]["building:levels"~"^([3-9]|[1-9][0-9])"];way.bw["building"]["name"];way.bw["building:part"];` +
      wheelFilter +
      `way.bw["natural"~"${natRegex}"];way.bw["waterway"~"^(river|riverbank|canal|stream|dock)$"];way.bw["water"];way.bw["area:highway"];way.bw["place"~"^(square|island|islet)$"];` +
      'way.bw["landuse"~"^(reservoir|basin|forest|meadow|grass|park|recreation_ground|cemetery|village_green)$"];' +
      'way.bw["leisure"~"^(park|nature_reserve|garden|golf_course|pitch|common|recreation_ground|marina)$"];' +
      regHwyFilter +
      `way.bw["highway"]["bridge"~"${bridgeValRegex}"];way.bw["railway"~"^(rail|light_rail|tram|narrow_gauge|platform)$"];` +
      elevatedTransitFilter + 'way.bw["public_transport"="platform"];' +
      _BUILD_QL_LAYER2_WAY;
    return _assembleSpatialQL(bbox, timeoutSec, _MP_STD_CLAUSES, ways, regNodes);
  }
  const midLatRad = ((south + north) * 0.5) * Math.PI / 180;
  const chunkSpanM = Math.max(
    Math.abs(north - south) * 111320,
    Math.abs(east - west) * 111320 * Math.max(0.2, Math.cos(midLatRad))
  );
  const isWideMetropolisScale = (lodOptions && Number(lodOptions.fetchSpanMeters) > 15500) || chunkSpanM > 5200;
  if (isWideMetropolisScale) {
    return `[out:json][timeout:${timeoutSec}][bbox:${bbox}];` +
      `way->.bw;` +
      `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["place"~"^(island|islet)$"]->.isl;` +
      `way(r.isl)->.islw;` +
      `(${_MP_MTN_CLAUSES})->.mp;` +
      `way(r.mp)(${bbox})->.mpw;` +
      `(way.bw["building:levels"~"^(1[2-9]|[2-9][0-9])"]["building"];way.bw["building"~"^(church|cathedral|chapel|castle|palace|tower|stadium)$"];way.bw["natural"~"^(water|coastline)$"];way.bw["waterway"~"^(river|riverbank|canal)$"];way.bw["water"];way.bw["place"~"^(island|islet)$"];way.bw["landuse"~"^(reservoir|basin)$"];way.bw["leisure"="park"];way.bw["highway"~"^(motorway|trunk|primary|motorway_link|trunk_link)$"];.islw;.mpw;)->.wbox;` +
      `(.isl;.mp;.wbox;);out body qt;` +
      `node(w.wbox);out skel qt;`;
  }
  const mtnWays =
    'way.bw["building"]["height"];way.bw["building"]["building:levels"~"^([5-9]|[1-9][0-9])"];way.bw["building"]["name"];' +
    'way.bw["building"~"^(church|cathedral|chapel|castle|palace|public|civic|commercial|industrial|apartments|hotel|hospital|university|train_station|tower|stadium)$"];' +
    'way.bw["natural"~"^(water|coastline|wood|scrub)$"];way.bw["waterway"~"^(river|riverbank|canal|dock)$"];way.bw["water"];way.bw["place"~"^(island|islet)$"];' +
    'way.bw["landuse"~"^(reservoir|basin|forest)$"];way.bw["leisure"~"^(park|nature_reserve|marina)$"];' +
    'way.bw["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link)$"];' +
    'way.bw["highway"]["bridge"~"^(yes|viaduct|suspension)$"];way.bw["railway"="rail"];' +
    _BUILD_QL_LAYER2_WAY;
  return _assembleSpatialQL(bbox, timeoutSec, _MP_MTN_CLAUSES, mtnWays, 'node["bridge:support"];', true);
}

function buildSpatialChunkGrid(south, west, north, east, spanMeters, lodOptions = null) {
  const s = Number(spanMeters) || 1200;
  const fetchSpan = (lodOptions && Number(lodOptions.fetchSpanMeters) > 0) ? Number(lodOptions.fetchSpanMeters) : s;
  const lodTier = selectLodTier(s);
  let rows = 1, cols = 1;
  if (fetchSpan > 6800) { rows = 3; cols = 3; }
  else if (fetchSpan > 1650) { rows = 2; cols = 2; }
  const dLat = (north - south) / rows;
  const dLon = (east - west) / cols;
  const padLat = rows > 1 ? dLat * 0.015 : 0;
  const padLon = cols > 1 ? dLon * 0.015 : 0;

  const centerLat = (south + north) * 0.5;
  const centerLon = (west + east) * 0.5;
  const chunks = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cSouth = Math.max(south, south + r * dLat - padLat);
      const cNorth = Math.min(north, south + (r + 1) * dLat + padLat);
      const cWest = Math.max(west, west + c * dLon - padLon);
      const cEast = Math.min(east, west + (c + 1) * dLon + padLon);
      const midLat = (cSouth + cNorth) * 0.5;
      const midLon = (cWest + cEast) * 0.5;
      chunks.push({
        id: `R${r + 1}C${c + 1}`,
        south: cSouth, west: cWest, north: cNorth, east: cEast,
        lodTier,
        lodOptions: lodOptions || null,
        totalChunks: rows * cols,
        distCenter: Math.hypot(midLat - centerLat, midLon - centerLon),
        depth: 0
      });
    }
  }
  chunks.sort((a, b) => a.distCenter - b.distCenter);
  return { rows, cols, lodTier, chunks };
}

function getPrioritizedOverpassMirrors() {
  const isHttpOrigin = typeof window === 'undefined' || !window.location || /^https?:$/i.test(window.location.protocol);
  const primary = [];
  if (isHttpOrigin) primary.push('/api/interpreter');
  const secondaryPool = OVERPASS_MIRRORS.filter(m => !primary.includes(m));
  const rot = (_mirrorRoundRobinIdx++) % Math.max(1, secondaryPool.length);
  const rotatedSecondary = secondaryPool.map((_, i) => secondaryPool[(rot + i) % secondaryPool.length]);
  return primary.concat(rotatedSecondary);
}

async function fetchSingleOverpassQuery(query, timeoutMs = 12500, abortSignal = null) {
  const orderedMirrors = getPrioritizedOverpassMirrors();
  const activeControllers = new Set();

  const abortAllActive = () => {
    for (const c of activeControllers) {
      try { c.abort(); } catch (_) {}
    }
    activeControllers.clear();
  };

  const attemptMirror = async (ep, perMirrorTimeoutMs) => {
    const ctrl = new AbortController();
    activeControllers.add(ctrl);
    let timedOutLocal = false;
    const timer = setTimeout(() => {
      timedOutLocal = true;
      try { ctrl.abort(); } catch (_) {}
    }, perMirrorTimeoutMs);
    const onParentAbort = () => { try { ctrl.abort(); } catch (_) {} };
    if (abortSignal) {
      if (abortSignal.aborted) {
        clearTimeout(timer);
        activeControllers.delete(ctrl);
        throw new Error('Aborted');
      }
      abortSignal.addEventListener('abort', onParentAbort, { once: true });
    }
    try {
      const r = await _origWindowFetch(ep, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        signal: ctrl.signal
      });
      if (!r.ok) {
        const httpErr = new Error(`HTTP ${r.status}`);
        httpErr.status = r.status;
        throw httpErr;
      }
      const text = await r.text();
      const trimmed = text ? text.trim() : '';
      if (!trimmed || trimmed.startsWith('<') || trimmed.startsWith('#')) {
        throw new Error('Overpass XML/HTML rate-limit');
      }
      const j = JSON.parse(trimmed);
      if (!j || !Array.isArray(j.elements)) throw new Error('Invalid Overpass JSON');
      if (j.remark && String(j.remark).trim().length > 0) {
        const rem = String(j.remark).trim();
        const isProxy = typeof j.generator === 'string' && /proxy/i.test(j.generator);
        const remErr = new Error(`Overpass remark: ${rem}`);
        if (isProxy) {
          remErr.isProxyTimeout = true;
          remErr.isTimeout = true;
        } else if (/timed out|out of memory|runtime error/i.test(rem)) {
          remErr.isQueryTooHeavy = true;
        }
        throw remErr;
      }
      return j.elements;
    } catch (err) {
      if (timedOutLocal && !(abortSignal && abortSignal.aborted)) {
        const tErr = new Error(`Mirror timeout (${perMirrorTimeoutMs}ms)`);
        tErr.isTimeout = true;
        throw tErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      activeControllers.delete(ctrl);
      if (abortSignal) abortSignal.removeEventListener('abort', onParentAbort);
    }
  };

  return new Promise((resolve, reject) => {
    let settled = false, pending = 0, nextMirrorIdx = 0, stopLaunchingMore = false;
    const errors = [], rawErrors = [], hedgeTimers = [];
    const clearHedges = () => { while (hedgeTimers.length) clearTimeout(hedgeTimers.pop()); };

    const finishReject = () => {
      if (settled) return;
      settled = true;
      clearHedges();
      abortAllActive();
      const combined = new Error(`Mirrors failed: ${errors.join(', ')}`);
      combined.allFatalNetwork = rawErrors.length > 0 && rawErrors.every(e => {
        const m = String(e && e.message ? e.message : e);
        return (
          !e.isTimeout &&
          !e.isQueryTooHeavy &&
          (m.includes('Failed to fetch') || m.includes('NetworkError') || m.includes('HTTP 500') || m.includes('HTTP 502') || m.includes('HTTP 503') || m.includes('ECONNREFUSED') || m.includes('Load failed'))
        );
      });
      reject(combined);
    };

    const launchNext = () => {
      if (settled || stopLaunchingMore || nextMirrorIdx >= orderedMirrors.length) return;
      if (abortSignal && abortSignal.aborted) {
        settled = true;
        clearHedges();
        abortAllActive();
        reject(new Error('Aborted'));
        return;
      }
      const ep = orderedMirrors[nextMirrorIdx++];
      pending++;
      const attemptMs = ep === '/api/interpreter' ? Math.max(timeoutMs, 35000) : timeoutMs;
      attemptMirror(ep, attemptMs)
        .then((elements) => {
          if (settled) return;
          settled = true;
          clearHedges();
          abortAllActive();
          resolve(elements);
        })
        .catch((err) => {
          if (abortSignal && abortSignal.aborted) {
            if (!settled) {
              settled = true;
              clearHedges();
              abortAllActive();
              reject(new Error('Aborted'));
            }
            return;
          }
          rawErrors.push(err);
          errors.push(err && err.message ? err.message : String(err));
          pending--;
          if (settled) return;
          if (err && err.isQueryTooHeavy) {
            stopLaunchingMore = true;
            clearHedges();
            abortAllActive();
            finishReject();
            return;
          }
          if (!stopLaunchingMore && nextMirrorIdx < orderedMirrors.length) {
            launchNext();
            if (ep === '/api/interpreter' && !(err && err.isProxyTimeout)) {
              hedgeTimers.push(setTimeout(() => { if (!settled && !stopLaunchingMore && nextMirrorIdx < orderedMirrors.length) launchNext(); }, 2200));
              hedgeTimers.push(setTimeout(() => { if (!settled && !stopLaunchingMore && nextMirrorIdx < orderedMirrors.length) launchNext(); }, 4500));
            }
          } else if (pending === 0) {
            finishReject();
          }
        });
    };

    const startsWithLocalProxy = orderedMirrors[0] === '/api/interpreter';
    launchNext();
    if (!startsWithLocalProxy) {
      hedgeTimers.push(setTimeout(() => { if (!settled && !stopLaunchingMore && nextMirrorIdx < orderedMirrors.length) launchNext(); }, 2200));
      hedgeTimers.push(setTimeout(() => { if (!settled && !stopLaunchingMore && nextMirrorIdx < orderedMirrors.length) launchNext(); }, 4500));
      hedgeTimers.push(setTimeout(() => { if (!settled && !stopLaunchingMore && nextMirrorIdx < orderedMirrors.length) launchNext(); }, 7500));
    }
  });
}

async function fetchChunkWithRecursiveSplit(chunk, abortSignal = null, callbacks = null) {
  const onSubSplit = typeof callbacks === 'function'
    ? callbacks
    : (callbacks && typeof callbacks.onSubSplit === 'function' ? callbacks.onSubSplit : null);
  const onSubChunkDone = (callbacks && typeof callbacks === 'object' && typeof callbacks.onSubChunkDone === 'function')
    ? callbacks.onSubChunkDone
    : null;

  const lo = chunk.lodOptions || null;
  const lodKey = lo
    ? `t${lo.wantTrees === false ? 0 : 1}_b${Math.round(lo.minBuildingFootprintM || 0)}_r${lo.roadDetail || 'all'}`
    : 'def';
  const cacheKey = `v12_${chunk.lodTier}_${lodKey}_${chunk.south.toFixed(4)}_${chunk.west.toFixed(4)}_${chunk.north.toFixed(4)}_${chunk.east.toFixed(4)}`;
  if (_overpassChunkCache.has(cacheKey)) return _overpassChunkCache.get(cacheKey);

  const timeoutSec = chunk.depth === 0 ? 20 : 16;
  const perAttemptMs = chunk.depth === 0 ? 25000 : 22000;
  const query = buildAdaptiveOverpassQL(chunk.south, chunk.west, chunk.north, chunk.east, chunk.lodTier, timeoutSec, lo);

  try {
    const elements = await fetchSingleOverpassQuery(query, perAttemptMs, abortSignal);
    _overpassChunkCache.set(cacheKey, elements);
    if (_overpassChunkCache.size > 120) _overpassChunkCache.delete(_overpassChunkCache.keys().next().value);
    return elements;
  } catch (err) {
    if (abortSignal && abortSignal.aborted) throw err;
    const isFatalNetwork = Boolean(err && err.allFatalNetwork);
    const midLat = (chunk.south + chunk.north) * 0.5;
    const midLon = (chunk.west + chunk.east) * 0.5;
    const chunkSpanM = Math.max(
      Math.abs(chunk.north - chunk.south) * 111320,
      Math.abs(chunk.east - chunk.west) * 111320 * Math.max(0.2, Math.cos(midLat * Math.PI / 180))
    );
    const curDepth = Number(chunk.depth) || 0;
    if (curDepth < 2 && !isFatalNetwork && chunkSpanM > 450) {
      if (onSubSplit) onSubSplit(chunk);
      const fallbackTier = chunk.lodTier;
      const parentTotalChunks = chunk.totalChunks || 1;
      const subPadLat = (chunk.north - chunk.south) * 0.008;
      const subPadLon = (chunk.east - chunk.west) * 0.008;
      const subChunks = [
        { id: `${chunk.id}.1`, south: chunk.south, west: chunk.west, north: Math.min(chunk.north, midLat + subPadLat), east: Math.min(chunk.east, midLon + subPadLon), lodTier: fallbackTier, lodOptions: lo, totalChunks: parentTotalChunks, depth: curDepth + 1 },
        { id: `${chunk.id}.2`, south: chunk.south, west: Math.max(chunk.west, midLon - subPadLon), north: Math.min(chunk.north, midLat + subPadLat), east: chunk.east, lodTier: fallbackTier, lodOptions: lo, totalChunks: parentTotalChunks, depth: curDepth + 1 },
        { id: `${chunk.id}.3`, south: Math.max(chunk.south, midLat - subPadLat), west: chunk.west, north: chunk.north, east: Math.min(chunk.east, midLon + subPadLon), lodTier: fallbackTier, lodOptions: lo, totalChunks: parentTotalChunks, depth: curDepth + 1 },
        { id: `${chunk.id}.4`, south: Math.max(chunk.south, midLat - subPadLat), west: Math.max(chunk.west, midLon - subPadLon), north: chunk.north, east: chunk.east, lodTier: fallbackTier, lodOptions: lo, totalChunks: parentTotalChunks, depth: curDepth + 1 }
      ];
      const mergedSub = [];
      const failedSubs = [];
      let subCursor = 0;
      let subDoneCount = 0;
      const subWorker = async () => {
        while (subCursor < subChunks.length) {
          if (abortSignal && abortSignal.aborted) break;
          const sc = subChunks[subCursor++];
          try {
            const subEls = await fetchChunkWithRecursiveSplit(sc, abortSignal, null);
            if (Array.isArray(subEls)) {
              for (let k = 0; k < subEls.length; k++) mergedSub.push(subEls[k]);
              subDoneCount++;
              if (onSubChunkDone) onSubChunkDone(sc, subEls.length, subDoneCount, subChunks.length);
            } else {
              failedSubs.push(sc);
            }
          } catch (subErr) {
            if (subErr && Array.isArray(subErr.partialElements)) {
              for (let k = 0; k < subErr.partialElements.length; k++) mergedSub.push(subErr.partialElements[k]);
            }
            failedSubs.push(sc);
          }
        }
      };
      const subConc = (chunk.totalChunks && chunk.totalChunks > 1) ? 1 : 2;
      await Promise.all(Array.from({ length: subConc }, () => subWorker()));

      // Second-chance sequential backoff retry for any failed sub-sectors (recovers transient HTTP 429 / timeouts)
      if (failedSubs.length > 0 && !(abortSignal && abortSignal.aborted)) {
        const stillFailed = [];
        for (const sc of failedSubs) {
          if (abortSignal && abortSignal.aborted) break;
          await new Promise(r => setTimeout(r, 1600));
          if (abortSignal && abortSignal.aborted) break;
          try {
            const subEls = await fetchChunkWithRecursiveSplit(sc, abortSignal, null);
            if (Array.isArray(subEls)) {
              for (let k = 0; k < subEls.length; k++) mergedSub.push(subEls[k]);
              subDoneCount++;
              if (onSubChunkDone) onSubChunkDone(sc, subEls.length, subDoneCount, subChunks.length);
            } else {
              stillFailed.push(sc);
            }
          } catch (retryErr) {
            if (retryErr && Array.isArray(retryErr.partialElements)) {
              for (let k = 0; k < retryErr.partialElements.length; k++) mergedSub.push(retryErr.partialElements[k]);
            }
            stillFailed.push(sc);
          }
        }
        if (stillFailed.length === 0) {
          _overpassChunkCache.set(cacheKey, mergedSub);
          if (_overpassChunkCache.size > 120) _overpassChunkCache.delete(_overpassChunkCache.keys().next().value);
          return mergedSub;
        }
        // NEVER poison _overpassChunkCache under parent cacheKey when any sub-sector is missing!
        const partialErr = new Error(`Incomplete sub-chunk split (${stillFailed.length}/${subChunks.length} failed)`);
        partialErr.partialElements = mergedSub;
        partialErr.failedSubChunkIds = stillFailed.map(s => s.id);
        throw partialErr;
      }

      if (subDoneCount === subChunks.length) {
        _overpassChunkCache.set(cacheKey, mergedSub);
        if (_overpassChunkCache.size > 120) _overpassChunkCache.delete(_overpassChunkCache.keys().next().value);
        return mergedSub;
      }
    }
    throw err;
  }
}

function mergeAndDeduplicateElements(elementArrays, maxSpanM = 1200, lodOptions = null) {
  const nodes = [], ways = [], relations = [];
  const nodeMap = new Map(), wayMap = new Map(), relMap = new Map();
  for (const arr of elementArrays) {
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const el = arr[i];
      if (!el) continue;
      if (el.type === 'node') {
        const prev = nodeMap.get(el.id);
        if (!prev) {
          nodeMap.set(el.id, el);
          nodes.push(el);
        } else if (el.tags && !prev.tags) {
          prev.tags = el.tags;
        }
      } else if (el.type === 'way') {
        const prev = wayMap.get(el.id);
        if (!prev) {
          wayMap.set(el.id, el);
          ways.push(el);
        } else {
          if (el.tags && !prev.tags) prev.tags = el.tags;
          if (el.nodes && (!prev.nodes || el.nodes.length > prev.nodes.length)) prev.nodes = el.nodes;
        }
      } else if (el.type === 'relation') {
        const prev = relMap.get(el.id);
        if (!prev) {
          relMap.set(el.id, el);
          relations.push(el);
        } else if (el.tags && !prev.tags) {
          prev.tags = el.tags;
        }
      }
    }
  }

  let filteredWays = ways;
  const minBldM = (lodOptions && typeof lodOptions.minBuildingFootprintM === 'number')
    ? lodOptions.minBuildingFootprintM
    : -1;
  if (maxSpanM > 3900 && minBldM !== 0 && ways.length > 4800) {
    const skipMinorTypes = new Set(['shed', 'garage', 'garages', 'hut', 'cabin', 'kiosk', 'roof', 'allotment_house', 'greenhouse', 'farm_auxiliary']);
    filteredWays = ways.filter(w => {
      const t = w.tags;
      if (!t || !t.building || t.name || t.height || t['building:levels']) return true;
      return !skipMinorTypes.has(String(t.building).toLowerCase());
    });
  }
  return nodes.concat(filteredWays, relations);
}

function filterPrintableBuildingsForScale(scene, maxBuildings = Infinity) {
  if (!scene || !Array.isArray(scene.buildings) || !Number.isFinite(maxBuildings) || scene.buildings.length <= maxBuildings) return scene;
  const inBedFn = typeof scene._priorityBedCheck === 'function' ? scene._priorityBedCheck : null;
  const mustKeep = [], candidates = [];
  const mustKeepGroups = new Set();
  for (const b of scene.buildings) {
    if (b.landmark || b.church || b.tower || (b.h && b.h >= 22)) {
      mustKeep.push(b);
      if (b.groupId) mustKeepGroups.add(b.groupId);
    } else {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [x, y] of (b.outer || b.poly || [])) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      const approxArea = Math.max(0.01, (maxX - minX) * (maxY - minY));
      const inBedBoost = (inBedFn && inBedFn(b.cx || 0, b.cy || 0)) ? 6.0 : 1.0;
      candidates.push({ b, approxArea, inBedBoost });
    }
  }
  const scored = candidates.map(c => {
    const partMult = c.b.part
      ? (c.b.groupId && mustKeepGroups.has(c.b.groupId) ? 1.8 : 0.75)
      : 1.0;
    return {
      b: c.b,
      score: c.approxArea * (1 + (c.b.h || 10) * 0.04) * c.inBedBoost * partMult
    };
  });
  scored.sort((a, b) => b.score - a.score);
  const remainSlots = Math.max(0, maxBuildings - mustKeep.length);
  const kept = mustKeep.concat(scored.slice(0, remainSlots).map(c => c.b));
  for (let i = 0; i < kept.length; i++) kept[i].id = i + 1;
  scene.buildings = kept;
  return scene;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    selectLodTier,
    buildAdaptiveOverpassQL,
    buildSpatialChunkGrid,
    fetchChunkWithRecursiveSplit,
    mergeAndDeduplicateElements,
    filterPrintableBuildingsForScale
  };
}
