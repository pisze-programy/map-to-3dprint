// ============================================================================
// src/gis_client/osm_scene_builder.js
// Live In-Browser OSM + DEM -> 3D Scene Builder (Emitting bridgePolys,
// roadPolys, Footpath Classification, Water/Parks/Trees & S3DB Buildings)
// ============================================================================

const OVERPASS_ENDPOINTS_BUILDER = [
  '/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter'
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

    for (let i = 1; i < mirrors.length; i++) {
      const t = setTimeout(() => {
        if (!settled) launchMirror(i);
      }, staggerDelays[i] || (i * 2500));
      timers.push(t);
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

  const bbox = `${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)}`;
  const query = (typeof buildAdaptiveOverpassQL === 'function' && typeof selectLodTier === 'function')
    ? buildAdaptiveOverpassQL(south, west, north, east, selectLodTier(maxSpanM), 14)
    : `[out:json][timeout:14][bbox:${bbox}];` +
      `(relation["building"];relation["type"="building"];relation["building:part"];relation["man_made"="bridge"];)->.brels;` +
      `(.brels;>;)->.ball;` +
      `(relation["type"="multipolygon"]["natural"~"^(water|wood|scrub|grassland|heath)$"];relation["type"="multipolygon"]["waterway"~"^(riverbank|dock|canal)$"];relation["type"="multipolygon"]["water"];relation["type"="multipolygon"]["landuse"];relation["type"="multipolygon"]["leisure"];relation["type"="multipolygon"]["highway"="pedestrian"];)->.grels;` +
      `way(r.grels)(${bbox})->.gways;` +
      `(way["building"];way["building:part"];way["natural"];way["waterway"];way["water"];way["landuse"];way["leisure"];way["highway"];way["place"="square"];way["railway"];way["man_made"~"^(bridge|pier|breakwater|groyne)$"];.gways;)->.wbox;` +
      `(relation.ball;.grels;.wbox;way.ball;node["natural"="tree"];);out body qt;` +
      `(node(w.wbox);node.ball;);out skel qt;`;

  const metersToUnits = 169.2 / maxSpanM;
  const halfW = Math.round((84.6 * spanEwM / maxSpanM) * 100) / 100;
  const halfH = Math.round((84.6 * spanNsM / maxSpanM) * 100) / 100;

  const halfM = maxSpanM * 0.5;
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
      center: [Math.round(centerLat * 100000) / 100000, Math.round(centerLon * 100000) / 100000],
      spanMeters: Math.round(maxSpanM),
      metersToUnits,
      halfW,
      halfH,
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
      if (el.tags && el.tags.natural === 'tree' && Math.abs(pt[0]) <= halfW + 0.5 && Math.abs(pt[1]) <= halfH + 0.5) {
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

  const s3db = createS3DBClientCollector(halfW, halfH, metersToUnits);
  const relById = new Map(relations.map(r => [r.id, r]));
  const rawRelWays = new Map();
  const stitchedRelPolys = new Map();

  // Sample river/canal centerlines and standalone building centroids to disambiguate
  // inside vs. outside faces when bounded geographic multipolygons clip against bbox.
  const waterSamplePts = [];
  const buildingSamplePts = [];
  const bldStep = Math.max(1, Math.floor(ways.size / 180));
  let wayIterIdx = 0;
  for (const w of ways.values()) {
    wayIterIdx++;
    const wt = w.tags || {};
    const wn = w.nodes || [];
    if (wn.length < 2) continue;
    if ((wt.waterway === 'river' || wt.waterway === 'canal') && !['yes', 'culvert'].includes(wt.tunnel)) {
      const weight = wt.waterway === 'river' ? 3 : 2;
      const stride = Math.max(1, Math.floor(wn.length / 8));
      for (let i = 0; i < wn.length && waterSamplePts.length < 180; i += stride) {
        const pt = nodes.get(wn[i]);
        if (pt && Math.abs(pt[0]) <= halfW && Math.abs(pt[1]) <= halfH) {
          waterSamplePts.push([pt[0], pt[1], weight]);
        }
      }
    } else if (wt.building && wn.length >= 4 && wn[0] === wn[wn.length - 1] && (wayIterIdx % bldStep === 0) && buildingSamplePts.length < 150) {
      const pt = nodes.get(wn[0]);
      if (pt && Math.abs(pt[0]) <= halfW && Math.abs(pt[1]) <= halfH) {
        buildingSamplePts.push([pt[0], pt[1]]);
      }
    }
  }

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

    const isWater = tags.natural === 'water' || ['riverbank', 'dock', 'canal'].includes(tags.waterway) || Boolean(tags.water) || ['reservoir', 'basin'].includes(tags.landuse);
    const isGreen = ['park', 'garden', 'nature_reserve', 'pitch', 'playground', 'common', 'golf_course', 'recreation_ground'].includes(tags.leisure) ||
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
      const clipped = (typeof stitchClippedMultipolygonRingsJS === 'function')
        ? stitchClippedMultipolygonRingsJS(raw.outerWays, raw.innerWays, nodesToPts, halfW, halfH, {
            isWater,
            waterSamplePts,
            buildingSamplePts,
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

    if ((tags.natural === 'water' || ['riverbank', 'dock'].includes(tags.waterway) || ['reservoir', 'basin'].includes(tags.landuse)) && isClosed) {
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
      ['park', 'garden', 'nature_reserve', 'pitch', 'playground', 'common', 'golf_course', 'recreation_ground'].includes(tags.leisure) ||
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
      const pts = nids.map(id => nodes.get(id)).filter(Boolean);
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const steps = Math.max(1, Math.floor(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 1.2));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const tx = p0[0] + (p1[0] - p0[0]) * t, ty = p0[1] + (p1[1] - p0[1]) * t;
          if (Math.abs(tx) <= halfW + 0.5 && Math.abs(ty) <= halfH + 0.5) {
            treeNodes.push([Math.round(tx * 100) / 100, Math.round(ty * 100) / 100, 9.0]);
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

  const buildings = s3db.resolveAndEmitS3DBBuildings();
  stitchCoastlineSeaPolysJS(coastWays, halfW, halfH, waterPolys);

  // Deduplicate tree nodes & add natural grove trees
  const trees = [];
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

  for (const [tx, ty, th] of treeNodes) {
    if (canPlaceTree(tx, ty, 0.42, 0.95)) trees.push([tx, ty, th]);
  }
  for (const gp of greenPolys) {
    if (['grass', 'meadow', 'pitch', 'playground', 'farmland', 'allotments', 'golf_course', 'village_green'].includes(gp.type)) continue;
    const area = Math.abs(polyAreaSignedJS(gp.outer));
    if (area < 4) continue;
    const isWood = ['forest', 'wood', 'scrub', 'nature_reserve'].includes(gp.type);
    const targetCount = Math.min(isWood ? 75 : 28, Math.max(2, Math.floor(area * (isWood ? 0.24 : 0.06))));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of gp.outer) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    minX = Math.max(-halfW + 0.6, minX); maxX = Math.min(halfW - 0.6, maxX);
    minY = Math.max(-halfH + 0.6, minY); maxY = Math.min(halfH - 0.6, maxY);
    if (minX >= maxX || minY >= maxY) continue;
    let added = 0;
    for (let k = 1; k <= targetCount * 5 && added < targetCount && trees.length < 1600; k++) {
      const px = minX + ((k * 0.6180339887) % 1) * (maxX - minX);
      const py = minY + ((k * 0.3819660113) % 1) * (maxY - minY);
      if (!pointInPolyLocal(px, py, gp.outer)) continue;
      if ((gp.holes || []).some(h => pointInPolyLocal(px, py, h))) continue;
      if (!canPlaceTree(px, py, 0.85, 0.95)) continue;
      trees.push([Math.round(px * 100) / 100, Math.round(py * 100) / 100, Math.round((7.5 + (k % 5) * 1.1) * 10) / 10]);
      added++;
    }
  }

  return {
    bbox: [south, west, north, east],
    center: [Math.round(centerLat * 100000) / 100000, Math.round(centerLon * 100000) / 100000],
    spanMeters: Math.round(maxSpanM),
    metersToUnits,
    halfW,
    halfH,
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
}
