// ============================================================================
// src/gis_client/overpass_chunk_grid.js
// Scale-Adaptive Overpass QL Builder, Spatial Chunk Grid, Hedged Multi-Mirror
// Fetcher & Recursive 2x2 Sub-Chunk Fallback
// ============================================================================

const _overpassChunkCache = new Map();
const _origWindowFetch = (typeof window !== 'undefined' && window.fetch) ? window.fetch.bind(window) : fetch;

const OVERPASS_MIRRORS = [
  '/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
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

function buildAdaptiveOverpassQL(south, west, north, east, lodTier = 'detail', timeoutSec = 22) {
  const bbox = `${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)}`;
  if (lodTier === 'detail') {
    return `[out:json][timeout:${timeoutSec}][bbox:${bbox}];(way["building"];relation["building"];relation["type"="building"];way["building:part"];relation["building:part"];way["natural"];relation["natural"];way["waterway"];relation["waterway"];way["water"];relation["water"];way["landuse"];relation["landuse"];way["leisure"];relation["leisure"];node["natural"="tree"];way["highway"];relation["highway"="pedestrian"];way["place"="square"];way["railway"];way["man_made"="bridge"];relation["man_made"="bridge"];way["man_made"="pier"];way["man_made"="breakwater"];way["man_made"="groyne"];);out body qt;>;out skel qt;`;
  }
  if (lodTier === 'urban') {
    return `[out:json][timeout:${timeoutSec}][bbox:${bbox}];(way["building"][building!~"^(shed|garage|garages|hut|cabin|kiosk|roof|allotment_house|sty|greenhouse|static_caravan|ger)$"];relation["building"];relation["type"="building"];way["building:part"];relation["building:part"];way["natural"~"^(water|coastline|wood|scrub|grassland|heath)$"];relation["natural"~"^(water|wood|scrub|grassland|heath)$"];way["waterway"];relation["waterway"];way["water"];relation["water"];way["landuse"~"^(reservoir|basin|forest|grass|meadow|park|recreation_ground|cemetery|village_green)$"];relation["landuse"~"^(reservoir|basin|forest|grass|meadow|park|recreation_ground|cemetery)$"];way["leisure"~"^(park|garden|nature_reserve|pitch|common|golf_course|recreation_ground)$"];relation["leisure"~"^(park|garden|nature_reserve|common|golf_course)$"];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|motorway_link|trunk_link|primary_link|secondary_link|service|cycleway)$"];way["highway"]["bridge"~"^(yes|viaduct|aqueduct|boardwalk|cantilever|covered|movable|suspension|trestle)$"];way["place"="square"];way["railway"~"^(rail|light_rail|tram|narrow_gauge)$"];way["man_made"~"^(bridge|pier|breakwater|groyne|tower|lighthouse)$"];relation["man_made"="bridge"];);out body qt;>;out skel qt;`;
  }
  if (lodTier === 'regional') {
    return `[out:json][timeout:${timeoutSec}][bbox:${bbox}];(way["building"][building!~"^(shed|garage|garages|hut|cabin|kiosk|roof|allotment_house|greenhouse|house|detached|terrace|semidetached_house|bungalow|farm_auxiliary|barn)$"];way["building"]["height"];way["building"]["building:levels"];way["building"]["name"];relation["building"];relation["type"="building"];way["building:part"];way["natural"~"^(water|coastline|wood|scrub|grassland)$"];relation["natural"~"^(water|wood|scrub)$"];way["waterway"~"^(river|riverbank|canal|stream|dock)$"];relation["waterway"];way["water"];relation["water"];way["landuse"~"^(reservoir|basin|forest|meadow|grass)$"];relation["landuse"~"^(reservoir|basin|forest|meadow)$"];way["leisure"~"^(park|nature_reserve|garden|golf_course)$"];relation["leisure"~"^(park|nature_reserve)$"];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link)$"];way["highway"]["bridge"~"^(yes|viaduct|suspension)$"];way["railway"~"^(rail|light_rail)$"];way["man_made"~"^(bridge|pier|breakwater|tower|lighthouse)$"];relation["man_made"="bridge"];);out body qt;>;out skel qt;`;
  }
  return `[out:json][timeout:${timeoutSec}][bbox:${bbox}];(way["building"]["height"];way["building"]["building:levels"];way["building"]["name"];way["building"~"^(church|cathedral|chapel|castle|palace|public|civic|commercial|industrial|apartments|hotel|hospital|university|train_station|tower)$"];relation["building"];relation["type"="building"];way["natural"~"^(water|coastline|wood|scrub)$"];relation["natural"~"^(water|wood)$"];way["waterway"~"^(river|riverbank|canal|dock)$"];relation["waterway"];way["water"];relation["water"];way["landuse"~"^(reservoir|basin|forest)$"];relation["landuse"~"^(reservoir|basin|forest)$"];way["leisure"~"^(park|nature_reserve)$"];relation["leisure"~"^(park|nature_reserve)$"];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|motorway_link|trunk_link)$"];way["highway"]["bridge"~"^(yes|viaduct|suspension)$"];way["railway"="rail"];way["man_made"~"^(bridge|pier|tower|lighthouse)$"];relation["man_made"="bridge"];);out body qt;>;out skel qt;`;
}

function buildSpatialChunkGrid(south, west, north, east, spanMeters) {
  const s = Number(spanMeters) || 1200;
  let rows = 1, cols = 1;
  if (s > 1450 && s <= 7500) { rows = 2; cols = 2; }
  else if (s > 7500) { rows = 3; cols = 3; }

  const lodTier = selectLodTier(s);
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
        distCenter: Math.hypot(midLat - centerLat, midLon - centerLon),
        depth: 0
      });
    }
  }
  chunks.sort((a, b) => a.distCenter - b.distCenter);
  return { rows, cols, lodTier, chunks };
}

async function fetchSingleOverpassQuery(query, timeoutMs = 19000, abortSignal = null) {
  const startIdx = (_mirrorRoundRobinIdx++) % OVERPASS_MIRRORS.length;
  const orderedMirrors = OVERPASS_MIRRORS.map((_, i) => OVERPASS_MIRRORS[(startIdx + i) % OVERPASS_MIRRORS.length]);

  const attemptMirror = async (ep, perMirrorTimeoutMs) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), perMirrorTimeoutMs);
    const onParentAbort = () => ctrl.abort();
    if (abortSignal) {
      if (abortSignal.aborted) { clearTimeout(timer); throw new Error('Aborted'); }
      abortSignal.addEventListener('abort', onParentAbort, { once: true });
    }
    try {
      const r = await _origWindowFetch(ep, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        signal: ctrl.signal
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      if (!text || text.trim().startsWith('<')) throw new Error('Overpass XML/HTML rate-limit');
      const j = JSON.parse(text);
      if (!j || !Array.isArray(j.elements)) throw new Error('Invalid Overpass JSON');
      return j.elements;
    } finally {
      clearTimeout(timer);
      if (abortSignal) abortSignal.removeEventListener('abort', onParentAbort);
    }
  };

  return new Promise((resolve, reject) => {
    let settled = false, pending = 0, nextMirrorIdx = 0;
    const errors = [], hedgeTimers = [];
    const clearHedges = () => { while (hedgeTimers.length) clearTimeout(hedgeTimers.pop()); };

    const launchNext = () => {
      if (settled || nextMirrorIdx >= orderedMirrors.length) return;
      if (abortSignal && abortSignal.aborted) {
        settled = true; clearHedges(); reject(new Error('Aborted')); return;
      }
      const ep = orderedMirrors[nextMirrorIdx++];
      pending++;
      attemptMirror(ep, timeoutMs)
        .then((elements) => {
          if (settled) return;
          settled = true; clearHedges(); resolve(elements);
        })
        .catch((err) => {
          errors.push(err.message || String(err));
          pending--;
          if (settled) return;
          if (nextMirrorIdx < orderedMirrors.length) launchNext();
          else if (pending === 0) {
            settled = true; clearHedges(); reject(new Error(`Mirrors failed: ${errors.join(', ')}`));
          }
        });
    };

    launchNext();
    hedgeTimers.push(setTimeout(() => { if (!settled && nextMirrorIdx < orderedMirrors.length) launchNext(); }, 3200));
    hedgeTimers.push(setTimeout(() => { if (!settled && nextMirrorIdx < orderedMirrors.length) launchNext(); }, 7000));
  });
}

async function fetchChunkWithRecursiveSplit(chunk, abortSignal = null, onSubSplit = null) {
  const cacheKey = `v5_${chunk.lodTier}_${chunk.south.toFixed(4)}_${chunk.west.toFixed(4)}_${chunk.north.toFixed(4)}_${chunk.east.toFixed(4)}`;
  if (_overpassChunkCache.has(cacheKey)) return _overpassChunkCache.get(cacheKey);

  const timeoutSec = chunk.depth === 0 ? 18 : 14;
  const query = buildAdaptiveOverpassQL(chunk.south, chunk.west, chunk.north, chunk.east, chunk.lodTier, timeoutSec);

  try {
    const elements = await fetchSingleOverpassQuery(query, (timeoutSec + 2) * 1000, abortSignal);
    _overpassChunkCache.set(cacheKey, elements);
    if (_overpassChunkCache.size > 80) _overpassChunkCache.delete(_overpassChunkCache.keys().next().value);
    return elements;
  } catch (err) {
    if (abortSignal && abortSignal.aborted) throw err;
    const msg = String(err && err.message ? err.message : err);
    const isFatalNetwork = msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('HTTP 500') || msg.includes('ECONNREFUSED');
    if (chunk.depth < 1 && !isFatalNetwork) {
      if (typeof onSubSplit === 'function') onSubSplit(chunk);
      const midLat = (chunk.south + chunk.north) * 0.5;
      const midLon = (chunk.west + chunk.east) * 0.5;
      const fallbackTier = chunk.lodTier === 'detail' ? 'urban' : (chunk.lodTier === 'urban' ? 'regional' : chunk.lodTier);
      const subChunks = [
        { id: `${chunk.id}.1`, south: chunk.south, west: chunk.west, north: midLat, east: midLon, lodTier: fallbackTier, depth: 1 },
        { id: `${chunk.id}.2`, south: chunk.south, west: midLon, north: midLat, east: chunk.east, lodTier: fallbackTier, depth: 1 },
        { id: `${chunk.id}.3`, south: midLat, west: chunk.west, north: chunk.north, east: midLon, lodTier: fallbackTier, depth: 1 },
        { id: `${chunk.id}.4`, south: midLat, west: midLon, north: chunk.north, east: chunk.east, lodTier: fallbackTier, depth: 1 }
      ];
      const mergedSub = [];
      for (let i = 0; i < subChunks.length; i += 2) {
        const results = await Promise.allSettled(subChunks.slice(i, i + 2).map(sc => fetchChunkWithRecursiveSplit(sc, abortSignal, null)));
        for (const res of results) {
          if (res.status === 'fulfilled' && Array.isArray(res.value)) mergedSub.push(...res.value);
        }
      }
      if (mergedSub.length > 0) {
        _overpassChunkCache.set(cacheKey, mergedSub);
        return mergedSub;
      }
    }
    throw err;
  }
}

function mergeAndDeduplicateElements(elementArrays, maxSpanM = 1200) {
  const nodes = [], ways = [], relations = [];
  const seenNodes = new Set(), seenWays = new Set(), seenRels = new Set();
  for (const arr of elementArrays) {
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const el = arr[i];
      if (!el) continue;
      if (el.type === 'node' && !seenNodes.has(el.id)) { seenNodes.add(el.id); nodes.push(el); }
      else if (el.type === 'way' && !seenWays.has(el.id)) { seenWays.add(el.id); ways.push(el); }
      else if (el.type === 'relation' && !seenRels.has(el.id)) { seenRels.add(el.id); relations.push(el); }
    }
  }

  let filteredWays = ways;
  if (maxSpanM > 1800 && ways.length > 4200) {
    const skipMinorTypes = new Set(['shed', 'garage', 'garages', 'hut', 'cabin', 'kiosk', 'roof', 'allotment_house', 'greenhouse', 'farm_auxiliary']);
    filteredWays = ways.filter(w => {
      const t = w.tags;
      if (!t || !t.building || t.name || t.height || t['building:levels']) return true;
      return !skipMinorTypes.has(String(t.building).toLowerCase());
    });
  }
  return nodes.concat(filteredWays, relations);
}

function filterPrintableBuildingsForScale(scene, maxBuildings = 1850) {
  if (!scene || !Array.isArray(scene.buildings) || scene.buildings.length <= maxBuildings) return scene;
  const mustKeep = [], candidates = [];
  for (const b of scene.buildings) {
    if (b.landmark || b.church || b.tower || b.part || (b.h && b.h >= 22)) {
      mustKeep.push(b);
    } else {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [x, y] of (b.outer || [])) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      const approxArea = Math.max(0.01, (maxX - minX) * (maxY - minY));
      candidates.push({ b, score: approxArea * (1 + (b.h || 10) * 0.04) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const kept = mustKeep.concat(candidates.slice(0, Math.max(250, maxBuildings - mustKeep.length)).map(c => c.b));
  for (let i = 0; i < kept.length; i++) kept[i].id = i + 1;
  scene.buildings = kept;
  return scene;
}
