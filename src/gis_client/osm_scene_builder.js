// ============================================================================
// src/gis_client/osm_scene_builder.js
// Live In-Browser OSM + DEM -> 3D Scene Builder (Emitting bridgePolys,
// roadPolys, Footpath Classification, Water/Parks/Trees & S3DB Buildings)
// ============================================================================

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
      if (wantTrees && el.tags && el.tags.natural === 'tree' && Math.abs(pt[0]) <= fetchHalfW + 0.5 && Math.abs(pt[1]) <= fetchHalfH + 0.5) {
        const hM = parseFloatTagJS(el.tags.height, 9.5);
        treeNodes.push([Math.round(pt[0] * 100) / 100, Math.round(pt[1] * 100) / 100, Math.round(Math.min(18.0, Math.max(5.0, hM)) * 10) / 10]);
      }
    } else if (el.type === 'way') {
      ways.set(el.id, el);
    } else if (el.type === 'relation') {
      relations.push(el);
    }
  }

  const nodesToPts = (nids, tol = 0.015) => simplifyRingJS((nids || []).map(id => nodes.get(id)).filter(Boolean), tol);
  const waterPolys = [], waterLines = [], greenPolys = [], roads = [], roadPolys = [], bridgePolys = [];
  const usedWays = new Set();
  const consumedRels = new Set();

  const s3db = createS3DBClientCollector(fetchHalfW, fetchHalfH, metersToUnits);
  const relById = new Map(relations.map(r => [r.id, r]));
  const rawRelWays = new Map();
  const stitchedRelPolys = new Map();

  // Sample dry-land building interiors, ground streets, and named river/canal centerlines
  // to classify minimal planar faces when multipolygons clip against the bbox.
  const allWaterCandidates = [];
  const allBldCandidates = [];
  const allRoadCandidates = [];
  const MOTOR_ROAD_VALS = new Set([
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
    'residential', 'living_street', 'service',
    'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'
  ]);
  for (const w of ways.values()) {
    const wt = w.tags || {};
    const wn = w.nodes || [];
    if (wn.length < 2) continue;
    const isBrWay = Boolean(wt.bridge && !['no', 'false', '0', 'none'].includes(String(wt.bridge).toLowerCase()));
    const isTunWay = Boolean(wt.tunnel && !['no', 'false', '0', 'none'].includes(String(wt.tunnel).toLowerCase()));

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
    } else if (wt.building && wn.length >= 4 && wn[0] === wn[wn.length - 1] && !isBrWay && !isTunWay) {
      const bVal = String(wt.building).toLowerCase();
      const mmVal = String(wt.man_made || '').toLowerCase();
      const locVal = String(wt.location || '').toLowerCase();
      const histVal = String(wt.historic || '').toLowerCase();
      if (
        !['pier', 'bridge', 'boathouse', 'houseboat', 'floating_home', 'roof', 'digester', 'ship', 'boat', 'vessel', 'barge'].includes(bVal) &&
        !['pier', 'bridge', 'breakwater', 'groyne', 'quay', 'jetty', 'wharf', 'dolphin'].includes(mmVal) &&
        !['underground', 'underwater', 'overwater'].includes(locVal) &&
        !['ship', 'wreck', 'aircraft'].includes(histVal) &&
        !wt['seamark:type'] &&
        wt.floating !== 'yes'
      ) {
        const p0 = nodes.get(wn[0]);
        const pMid = nodes.get(wn[wn.length >> 1]) || p0;
        if (p0 && pMid) {
          const mx = (p0[0] + pMid[0]) * 0.5;
          const my = (p0[1] + pMid[1]) * 0.5;
          if (Math.abs(mx) <= fetchHalfW && Math.abs(my) <= fetchHalfH) {
            allBldCandidates.push([mx, my]);
          }
        }
      }
    } else if (wt.highway && !isBrWay && !isTunWay && !wt.ford && wt.route !== 'ferry') {
      const hwVal = String(wt.highway).toLowerCase();
      const mmVal = String(wt.man_made || '').toLowerCase();
      if (!['pier', 'bridge', 'breakwater', 'groyne', 'quay', 'jetty', 'wharf', 'dolphin', 'boardwalk'].includes(mmVal) && hwVal !== 'proposed' && hwVal !== 'construction') {
        const pMid = nodes.get(wn[wn.length >> 1]);
        if (pMid && Math.abs(pMid[0]) <= fetchHalfW && Math.abs(pMid[1]) <= fetchHalfH) {
          allRoadCandidates.push([pMid[0], pMid[1], MOTOR_ROAD_VALS.has(hwVal) ? 2 : 1]);
        }
      }
    }
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

  // Pass 1B: Explicit S3DB type=building relations
  for (const rel of relations) {
    const tags = rel.tags || {};
    const members = rel.members || [];
    const hasPartOrOutline = members.some(m => m.role === 'part' || m.role === 'outline');
    if (tags.type === 'building' || hasPartOrOutline) {
      if (isUndergroundOrSkippedBuildingJS(tags)) {
        consumedRels.add(rel.id);
        for (const m of members) {
          if (m.type === 'way') usedWays.add(m.ref);
          else if (m.type === 'relation') consumedRels.add(m.ref);
        }
        continue;
      }
      const partWays = [], partRels = [], outlineWays = [], outlineRels = [];
      for (const m of members) {
        const role = m.role || '';
        if (role === 'part') {
          if (m.type === 'way' && ways.has(m.ref)) partWays.push(m.ref);
          else if (m.type === 'relation' && relById.has(m.ref)) partRels.push(m.ref);
        } else if (role === 'outline' || role === 'outer' || role === '') {
          if (m.type === 'way' && ways.has(m.ref)) outlineWays.push(m.ref);
          else if (m.type === 'relation' && relById.has(m.ref)) outlineRels.push(m.ref);
        }
      }

      if (partWays.length > 0 || partRels.length > 0) {
        consumedRels.add(rel.id);
        let parentName = tags.name || tags['name:en'] || tags['name:pl'] || '';
        for (const oWid of outlineWays) {
          usedWays.add(oWid);
          const wObj = ways.get(oWid);
          const wTags = { ...tags, ...(wObj.tags || {}) };
          const wNids = wObj.nodes || [];
          if (wNids.length >= 4 && wNids[0] === wNids[wNids.length - 1]) {
            const pts = nodesToPts(wNids, 0.015);
            if (pts.length >= 3) {
              if (!parentName) parentName = wTags.name || wTags['name:en'] || '';
              s3db.registerCandidate(oWid, wTags, pts, [], false, rel.id, true);
            }
          }
        }
        for (const oRid of outlineRels) {
          consumedRels.add(oRid);
          const oRel = relById.get(oRid);
          const oTags = { ...tags, ...(oRel.tags || {}) };
          if (!parentName) parentName = oTags.name || oTags['name:en'] || '';
          const st = stitchedRelPolys.get(oRid);
          if (st) {
            for (const wid of st.memberWayIds) usedWays.add(wid);
            for (const op of st.outerPolys) s3db.registerCandidate(oRid, oTags, op, st.innerPolys, false, rel.id, true);
          }
        }
        for (const pWid of partWays) {
          usedWays.add(pWid);
          const wObj = ways.get(pWid);
          const wTags = { ...(wObj.tags || {}) };
          if (!wTags.name && parentName) wTags.name = parentName;
          const wNids = wObj.nodes || [];
          if (wNids.length >= 4 && wNids[0] === wNids[wNids.length - 1]) {
            const pts = nodesToPts(wNids, 0.015);
            if (pts.length >= 3) s3db.registerCandidate(pWid, wTags, pts, [], true, rel.id, true);
          }
        }
        for (const pRid of partRels) {
          consumedRels.add(pRid);
          const pRel = relById.get(pRid);
          const pTags = { ...(pRel.tags || {}) };
          if (!pTags.name && parentName) pTags.name = parentName;
          const st = stitchedRelPolys.get(pRid);
          if (st) {
            for (const wid of st.memberWayIds) usedWays.add(wid);
            for (const op of st.outerPolys) s3db.registerCandidate(pRid, pTags, op, st.innerPolys, true, rel.id, true);
          }
        }
      }
    }
  }

  // Pass 1C: Remaining Multipolygon Relations
  for (const rel of relations) {
    if (consumedRels.has(rel.id)) continue;
    const tags = rel.tags || {};
    const raw = rawRelWays.get(rel.id);
    if (!raw) continue;

    const hasBld = tags.building && !SKIP_BUILDING_VALS_JS.has(String(tags.building).toLowerCase());
    const hasPart = tags['building:part'] && !SKIP_BUILDING_VALS_JS.has(String(tags['building:part']).toLowerCase());
    if (hasBld || hasPart) {
      const st = stitchedRelPolys.get(rel.id);
      if (!st) continue;
      for (const wid of st.memberWayIds) usedWays.add(wid);
      const isPart = Boolean(hasPart && !hasBld);
      for (const op of st.outerPolys) s3db.registerCandidate(rel.id, tags, op, st.innerPolys, isPart, null, false);
      continue;
    }

    const isWater = tags.natural === 'water' || ['riverbank', 'dock', 'canal'].includes(tags.waterway) || Boolean(tags.water) || ['reservoir', 'basin'].includes(tags.landuse) || tags.leisure === 'marina';
    const isGreen = ['park', 'garden', 'nature_reserve', 'pitch', 'playground', 'common', 'golf_course', 'recreation_ground', 'dog_park'].includes(tags.leisure) ||
                    ['forest', 'grass', 'meadow', 'village_green', 'recreation_ground', 'cemetery', 'allotments', 'farmland', 'orchard', 'vineyard'].includes(tags.landuse) ||
                    ['wood', 'scrub', 'grassland', 'heath'].includes(tags.natural);
    const isBr = tags.man_made === 'bridge' || (tags.bridge && !['no', 'false', '0', 'none'].includes(tags.bridge));
    const isPlaza = (['pedestrian', 'footway', 'living_street'].includes(tags.highway) && tags.area !== 'no') || tags.place === 'square';

    if (isBr) {
      const st = stitchedRelPolys.get(rel.id);
      if (!st) continue;
      for (const wid of st.memberWayIds) usedWays.add(wid);
      const layerVal = Math.max(1, Math.trunc(parseFloatTagJS(tags.layer, 1) || 1));
      for (const op of st.outerPolys) bridgePolys.push({ outer: op, holes: st.innerPolys, name: tags.name || 'Most', layer: layerVal });
      continue;
    }

    if (isWater || isGreen || isPlaza) {
      const relName = String(tags.name || tags['name:en'] || '').trim().toLowerCase();
      const clipped = (typeof stitchClippedMultipolygonRingsJS === 'function')
        ? stitchClippedMultipolygonRingsJS(raw.outerWays, raw.innerWays, nodesToPts, fetchHalfW, fetchHalfH, {
            isWater,
            isGreen,
            isPlaza,
            relName,
            waterSamplePts,
            buildingSamplePts,
            roadSamplePts,
            tol: 0.018
          })
        : null;
      const entries = clipped
        ? clipped.outerEntries
        : ((stitchedRelPolys.get(rel.id) || { outerPolys: [], innerPolys: [] }).outerPolys.map(op => ({
            outer: op,
            holes: (stitchedRelPolys.get(rel.id) || { innerPolys: [] }).innerPolys
          })));
      if (entries.length === 0) continue;
      for (const wid of raw.memberWayIds) usedWays.add(wid);
      if (isWater) {
        for (const e of entries) waterPolys.push({ outer: e.outer, holes: e.holes, name: tags.name || 'Woda' });
      } else if (isGreen) {
        for (const e of entries) greenPolys.push({ outer: e.outer, holes: e.holes, type: tags.leisure || tags.landuse || tags.natural || 'park' });
      } else if (isPlaza) {
        for (const e of entries) roadPolys.push({ outer: e.outer, holes: e.holes, name: tags.name || '' });
      }
    }
  }

  // Pass 2: Standalone Ways
  const coastWays = [];
  for (const [wid, w] of ways.entries()) {
    const tags = w.tags || {};
    const nids = w.nodes || [];
    if (nids.length < 2) continue;
    const isClosed = nids[0] === nids[nids.length - 1] && nids.length >= 4;

    const hasBld = tags.building && !SKIP_BUILDING_VALS_JS.has(String(tags.building).toLowerCase());
    const hasPart = tags['building:part'] && !SKIP_BUILDING_VALS_JS.has(String(tags['building:part']).toLowerCase());
    if ((hasBld || hasPart) && isClosed) {
      if (usedWays.has(wid)) continue;
      const pts = nodesToPts(nids, 0.015);
      if (pts.length >= 3) s3db.registerCandidate(wid, tags, pts, [], Boolean(hasPart && !hasBld), null, false);
      continue;
    }

    if (tags.natural === 'coastline') {
      const pts = nids.map(id => nodes.get(id)).filter(Boolean);
      if (pts.length >= 2) coastWays.push(pts);
      continue;
    }

    if (tags.man_made === 'bridge' && isClosed && !usedWays.has(wid)) {
      const pts = nodesToPts(nids, 0.02);
      if (pts.length >= 3) {
        const layerVal = Math.max(1, Math.trunc(parseFloatTagJS(tags.layer, 1) || 1));
        bridgePolys.push({ outer: pts, holes: [], name: tags.name || 'Most', layer: layerVal });
      }
      continue;
    }

    if (['pier', 'breakwater', 'groyne'].includes(tags.man_made) && isClosed) {
      const pts = nodesToPts(nids, 0.025);
      if (pts.length >= 3) {
        s3db.addBuildingRecord(wid, { ...tags, building: 'pier', height: '3.5', 'roof:shape': 'flat', name: tags.name || `Molo #${wid}` }, pts, [], wid, false);
      }
      continue;
    }

    if ((tags.natural === 'water' || ['riverbank', 'dock'].includes(tags.waterway) || Boolean(tags.water) || ['reservoir', 'basin'].includes(tags.landuse) || tags.leisure === 'marina') && isClosed) {
      if (!usedWays.has(wid)) {
        const pts = nodesToPts(nids, 0.03);
        if (pts.length >= 3) waterPolys.push({ outer: pts, holes: [], name: tags.name || 'Woda' });
      }
      continue;
    }

    if (tags.waterway && ['river', 'canal', 'stream', 'dock'].includes(tags.waterway) && !['yes', 'culvert'].includes(tags.tunnel)) {
      const pts = nodesToPts(nids, 0.04);
      if (pts.length >= 2) {
        const wm = parseFloatTagJS(tags.width, null) || (tags.waterway === 'river' ? 16 : tags.waterway === 'canal' ? 8 : 3);
        waterLines.push({ pts, width: Math.round(Math.max(0.35, wm * metersToUnits) * 100) / 100, name: tags.name || tags.waterway });
      }
      continue;
    }

    if ((
      ['park', 'garden', 'nature_reserve', 'pitch', 'playground', 'common', 'golf_course', 'recreation_ground', 'dog_park'].includes(tags.leisure) ||
      ['forest', 'grass', 'meadow', 'village_green', 'recreation_ground', 'cemetery', 'allotments', 'farmland', 'orchard', 'vineyard'].includes(tags.landuse) ||
      ['wood', 'scrub', 'grassland', 'heath'].includes(tags.natural)
    ) && isClosed) {
      if (!usedWays.has(wid)) {
        const pts = nodesToPts(nids, 0.035);
        if (pts.length >= 3) greenPolys.push({ outer: pts, holes: [], type: tags.leisure || tags.landuse || tags.natural || 'park' });
      }
      continue;
    }

    if (tags.natural === 'tree_row') {
      if (wantTrees) {
        const pts = nids.map(id => nodes.get(id)).filter(Boolean);
        const rowStepU = Math.max(0.45, 7.5 * metersToUnits);
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[i], p1 = pts[i + 1];
          const steps = Math.max(1, Math.floor(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / rowStepU));
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const tx = p0[0] + (p1[0] - p0[0]) * t, ty = p0[1] + (p1[1] - p0[1]) * t;
            if (Math.abs(tx) <= fetchHalfW + 0.5 && Math.abs(ty) <= fetchHalfH + 0.5) {
              treeNodes.push([Math.round(tx * 100) / 100, Math.round(ty * 100) / 100, 9.0]);
            }
          }
        }
      }
      continue;
    }

    if (isClosed && !usedWays.has(wid) && (tags.place === 'square' || (['pedestrian', 'footway', 'living_street', 'service'].includes(tags.highway) && tags.area === 'yes'))) {
      const layerVal = parseFloatTagJS(tags.layer, 0) || 0;
      if (!['yes', 'building_passage'].includes(tags.tunnel) && layerVal >= 0) {
        const pts = nodesToPts(nids, 0.03);
        if (pts.length >= 3) roadPolys.push({ outer: pts, holes: [], name: tags.name || '' });
        continue;
      }
    }

    if (tags.highway || tags.railway || ['bridge', 'pier', 'breakwater', 'groyne'].includes(tags.man_made)) {
      if (['yes', 'building_passage', 'culvert'].includes(tags.tunnel) || tags.covered === 'yes' || tags.indoor === 'yes') continue;
      const layerVal = Math.trunc(parseFloatTagJS(tags.layer, 0) || 0);
      if (layerVal < 0 || (tags.man_made === 'bridge' && isClosed)) continue;

      const hwy = tags.highway || tags.railway || tags.man_made || 'bridge';
      if (['proposed', 'construction', 'platform', 'bus_stop', 'elevator', 'rest_area'].includes(hwy)) continue;

      const bridgeTag = tags.bridge;
      const isBridge = (bridgeTag && !['no', 'false', '0', 'none'].includes(bridgeTag)) || ['bridge', 'pier', 'breakwater', 'groyne'].includes(tags.man_made);
      const isPath = ['footway', 'path', 'cycleway', 'steps', 'bridleway', 'track', 'corridor', 'pedestrian'].includes(hwy);

      let rwm = 6.2;
      if (isPath) {
        if (!isBridge && ['sidewalk', 'crossing', 'access_aisle', 'island'].includes(tags.footway)) continue;
        if (!isBridge && ['sidewalk', 'crossing'].includes(tags.cycleway)) continue;
        rwm = hwy === 'pedestrian' ? 3.2 : 2.2;
      } else if (['motorway', 'trunk'].includes(hwy)) rwm = 12.5;
      else if (hwy === 'primary') rwm = 10.5;
      else if (['secondary', 'motorway_link', 'trunk_link'].includes(hwy)) rwm = 8.5;
      else if (['tertiary', 'primary_link', 'secondary_link'].includes(hwy)) rwm = 7.2;
      else if (['rail', 'light_rail', 'tram', 'narrow_gauge'].includes(hwy)) {
        if (['subway', 'monorail'].includes(hwy) && !isBridge) continue;
        rwm = 4.2;
      } else if (hwy === 'service') {
        rwm = (!isBridge && ['parking_aisle', 'driveway', 'alley'].includes(tags.service)) ? 3.6 : 4.8;
      }

      const explicitW = parseFloatTagJS(tags.width, null);
      if (explicitW !== null && explicitW >= 1.2 && explicitW <= 28.0) rwm = explicitW;

      const pts = nodesToPts(nids, 0.035);
      if (pts.length >= 2) {
        roads.push({
          pts,
          width: Math.round(Math.max(0.24, rwm * metersToUnits) * 1000) / 1000,
          hwy,
          isPath: Boolean(isPath && hwy !== 'pedestrian'),
          bridge: Boolean(isBridge),
          layer: layerVal,
          name: tags.name || ''
        });
      }
    }
  }

  let buildings = s3db.resolveAndEmitS3DBBuildings();
  if (minBldFootprintM > 0 && buildings.length > 0) {
    const minFootU = minBldFootprintM * metersToUnits;
    buildings = buildings.filter(b => {
      if (b.landmark || b.church || b.tower || b.part) return true;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of (b.outer || [])) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      }
      return Math.max(maxX - minX, maxY - minY) >= minFootU;
    });
    for (let i = 0; i < buildings.length; i++) buildings[i].id = i + 1;
  }

  stitchCoastlineSeaPolysJS(coastWays, fetchHalfW, fetchHalfH, waterPolys);

  // Deduplicate tree nodes & add natural grove/park trees (when enabled in LoD)
  const trees = [];
  if (wantTrees) {
    const treeBuckets = new Map();
    const canPlaceTree = (tx, ty, minDistSq, cellSz) => {
      const bx = Math.floor(tx / cellSz), by = Math.floor(ty / cellSz);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const list = treeBuckets.get(`${bx + dx}_${by + dy}`);
          if (!list) continue;
          for (const [ox, oy] of list) {
            if ((tx - ox) * (tx - ox) + (ty - oy) * (ty - oy) < minDistSq) return false;
          }
        }
      }
      const key = `${bx}_${by}`;
      if (!treeBuckets.has(key)) treeBuckets.set(key, []);
      treeBuckets.get(key).push([tx, ty]);
      return true;
    };

    const nodeMinDistU = Math.max(0.24, 4.2 * metersToUnits);
    const nodeMinDistSq = nodeMinDistU * nodeMinDistU;
    const nodeCellSz = Math.max(0.45, nodeMinDistU * 1.4);
    for (const [tx, ty, th] of treeNodes) {
      if (trees.length >= 2600) break;
      if (canPlaceTree(tx, ty, nodeMinDistSq, nodeCellSz)) trees.push([tx, ty, th]);
    }

    const parkMinDistU = Math.max(0.42, 7.5 * metersToUnits);
    const parkMinDistSq = parkMinDistU * parkMinDistU;
    const parkCellSz = Math.max(0.65, parkMinDistU * 1.3);
    const minParkAreaU = Math.max(0.6, 800.0 * metersToUnits * metersToUnits);
    for (const gp of greenPolys) {
      if (['grass', 'meadow', 'pitch', 'playground', 'farmland', 'allotments', 'golf_course', 'village_green'].includes(gp.type)) continue;
      const area = Math.abs(polyAreaSignedJS(gp.outer));
      if (area < minParkAreaU) continue;
      const areaM2 = area / Math.max(1e-6, metersToUnits * metersToUnits);
      const isWood = ['forest', 'wood', 'scrub', 'nature_reserve'].includes(gp.type);
      const targetCount = Math.min(isWood ? 85 : 32, Math.max(2, Math.floor(areaM2 / (isWood ? 360.0 : 950.0))));
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of gp.outer) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      }
      minX = Math.max(-fetchHalfW + 0.5, minX); maxX = Math.min(fetchHalfW - 0.5, maxX);
      minY = Math.max(-fetchHalfH + 0.5, minY); maxY = Math.min(fetchHalfH - 0.5, maxY);
      if (minX >= maxX || minY >= maxY) continue;
      let added = 0;
      for (let k = 1; k <= targetCount * 5 && added < targetCount && trees.length < 2600; k++) {
        const px = minX + ((k * 0.6180339887) % 1) * (maxX - minX);
        const py = minY + ((k * 0.3819660113) % 1) * (maxY - minY);
        if (!pointInPolyLocal(px, py, gp.outer)) continue;
        if ((gp.holes || []).some(h => pointInPolyLocal(px, py, h))) continue;
        if (!canPlaceTree(px, py, parkMinDistSq, parkCellSz)) continue;
        trees.push([Math.round(px * 100) / 100, Math.round(py * 100) / 100, Math.round((7.5 + (k % 5) * 1.1) * 10) / 10]);
        added++;
      }
    }
  }

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
