// ============================================================================
// src/ui_gis_client.js
// Direct In-Browser GIS Pipeline (AWS Terrarium DEM + Overpass QL Multipolygons)
// ============================================================================

const ROOF_SHAPES_NORM = {
  flat: 'flat', gabled: 'gabled', gable: 'gabled', hipped: 'hipped', hip: 'hipped',
  'half-hipped': 'hipped', pyramidal: 'pyramidal', pyramid: 'pyramidal',
  skillion: 'skillion', shed: 'skillion', dome: 'dome', round: 'dome',
  onion: 'onion', cone: 'cone', conical: 'cone', mansard: 'mansard', gambrel: 'gambrel'
};

function stitchWayRingsJS(wayNodeLists) {
  const rings = [];
  const openSegs = (wayNodeLists || []).filter(w => w && w.length >= 2).map(w => w.slice());
  while (openSegs.length > 0) {
    let curr = openSegs.shift();
    if (curr[0] === curr[curr.length - 1]) {
      if (curr.length >= 4) rings.push(curr);
      continue;
    }
    let changed = true;
    while (changed && curr[0] !== curr[curr.length - 1]) {
      changed = false;
      for (let i = 0; i < openSegs.length; i++) {
        const seg = openSegs[i];
        if (seg[0] === curr[curr.length - 1]) {
          curr = curr.concat(seg.slice(1));
          openSegs.splice(i, 1);
          changed = true;
          break;
        } else if (seg[seg.length - 1] === curr[curr.length - 1]) {
          curr = curr.concat(seg.slice(0, -1).reverse());
          openSegs.splice(i, 1);
          changed = true;
          break;
        } else if (seg[seg.length - 1] === curr[0]) {
          curr = seg.slice(0, -1).concat(curr);
          openSegs.splice(i, 1);
          changed = true;
          break;
        } else if (seg[0] === curr[0]) {
          curr = seg.slice(1).reverse().concat(curr);
          openSegs.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    if (curr.length >= 4) {
      if (curr[0] !== curr[curr.length - 1]) curr.push(curr[0]);
      rings.push(curr);
    }
  }
  return rings;
}

function polyAreaSignedJS(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
    a += p1[0] * p2[1] - p2[0] * p1[1];
  }
  return a * 0.5;
}

function pointInPolyLocal(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

async function fetchTerrariumDemInBrowser(south, west, north, east, gridSize = 64, zoom = 14) {
  const xMinF = lon2tileF(west, zoom);
  const xMaxF = lon2tileF(east, zoom);
  const yMinF = lat2tileF(north, zoom);
  const yMaxF = lat2tileF(south, zoom);
  const tx0 = Math.floor(xMinF), tx1 = Math.floor(xMaxF);
  const ty0 = Math.floor(yMinF), ty1 = Math.floor(yMaxF);

  const tilePixels = {};
  const offCanvas = document.createElement('canvas');
  offCanvas.width = 256;
  offCanvas.height = 256;
  const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

  const promises = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      promises.push(new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          offCtx.clearRect(0, 0, 256, 256);
          offCtx.drawImage(img, 0, 0, 256, 256);
          tilePixels[`${tx}_${ty}`] = offCtx.getImageData(0, 0, 256, 256).data;
          resolve();
        };
        img.onerror = () => resolve();
        img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`;
      }));
    }
  }
  await Promise.all(promises);

  const grid = [];
  let minElev = Infinity, maxElev = -Infinity;
  for (let gy = 0; gy < gridSize; gy++) {
    const lat = south + (gy / (gridSize - 1)) * (north - south);
    const row = [];
    for (let gx = 0; gx < gridSize; gx++) {
      const lon = west + (gx / (gridSize - 1)) * (east - west);
      const xf = lon2tileF(lon, zoom), yf = lat2tileF(lat, zoom);
      const tx = Math.floor(xf), ty = Math.floor(yf);
      const px = Math.min(255, Math.max(0, Math.floor((xf - tx) * 256)));
      const py = Math.min(255, Math.max(0, Math.floor((yf - ty) * 256)));
      const data = tilePixels[`${tx}_${ty}`];
      let elev = 0;
      if (data) {
        const idx = (py * 256 + px) * 4;
        elev = (data[idx] * 256.0 + data[idx + 1] + data[idx + 2] / 256.0) - 32768.0;
      }
      row.push(Math.round(elev * 100) / 100);
      if (elev < minElev) minElev = elev;
      if (elev > maxElev) maxElev = elev;
    }
    grid.push(row);
  }
  if (!isFinite(minElev)) { minElev = 0; maxElev = 15; }
  return { gridSize, minElev, maxElev, grid };
}

async function fetchRealGISInBrowser(south, west, north, east, title) {
  const bbox = `${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)}`;
  const query = `[out:json][timeout:30][bbox:${bbox}];(way["building"];relation["building"];way["building:part"];relation["building:part"];way["natural"];relation["natural"="water"];way["waterway"];relation["waterway"="riverbank"];way["landuse"];way["leisure"];relation["leisure"="park"];node["natural"="tree"];way["highway"];way["railway"];way["man_made"="bridge"];way["man_made"="pier"];way["man_made"="breakwater"];way["man_made"="groyne"];);out body qt;>;out skel qt;`;

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];

  // Rectangular isotropic projection
  const centerLat = (south + north) * 0.5;
  const centerLon = (west + east) * 0.5;
  const cosLat = Math.max(0.2, Math.cos(centerLat * Math.PI / 180.0));
  const spanNsM = (north - south) * 111320.0;
  const spanEwM = (east - west) * 111320.0 * cosLat;
  const maxSpanM = Math.max(spanEwM, spanNsM);
  const metersToUnits = 169.2 / maxSpanM;
  const halfW = Math.round((84.6 * spanEwM / maxSpanM) * 100) / 100;
  const halfH = Math.round((84.6 * spanNsM / maxSpanM) * 100) / 100;

  const halfM = maxSpanM * 0.5;
  const sqDLat = halfM / 111320.0;
  const sqDLon = halfM / (111320.0 * cosLat);
  const demPromise = fetchTerrariumDemInBrowser(centerLat - sqDLat, centerLon - sqDLon, centerLat + sqDLat, centerLon + sqDLon, 64, 14);

  const osmPromise = Promise.any(endpoints.map(async (ep) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 36000);
    try {
      const r = await fetch(ep, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        signal: ctrl.signal
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j.elements) throw new Error('No elements');
      return j;
    } finally {
      clearTimeout(timer);
    }
  }));

  const [dem, osmRaw] = await Promise.all([demPromise, osmPromise]);

  const project = (lon, lat) => [
    Math.round((lon - centerLon) * 111320.0 * cosLat * metersToUnits * 100) / 100,
    Math.round((lat - centerLat) * 111320.0 * metersToUnits * 100) / 100
  ];

  const nodes = new Map();
  const ways = new Map();
  const relations = [];
  const trees = [];

  for (const el of (osmRaw.elements || [])) {
    if (el.type === 'node') {
      const pt = project(el.lon, el.lat);
      nodes.set(el.id, pt);
      if (el.tags && el.tags.natural === 'tree' && Math.abs(pt[0]) <= halfW + 0.5 && Math.abs(pt[1]) <= halfH + 0.5) {
        trees.push([pt[0], pt[1], 12.0]);
      }
    } else if (el.type === 'way') {
      ways.set(el.id, el);
    } else if (el.type === 'relation') {
      relations.push(el);
    }
  }

  const nodesToPts = (nids) => (nids || []).map(id => nodes.get(id)).filter(Boolean);
  const waterPolys = [], waterLines = [], greenPolys = [], roads = [], buildings = [];
  const usedWays = new Set();

  function pushBuilding(osmId, tags, outer, holes, groupId = null, isPart = false) {
    if (outer.length < 3) return;
    let sx = 0, sy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    outer.forEach(p => {
      sx += p[0]; sy += p[1];
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    });
    const cx = sx / outer.length, cy = sy / outer.length;
    if (Math.abs(cx) > halfW + 4.0 || Math.abs(cy) > halfH + 4.0) return;

    const btype = tags.building || tags['building:part'] || 'yes';
    let name = tags.name || tags['name:en'] || tags['name:pl'] || '';
    if (/[\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF]/.test(name) && tags['name:en']) {
      name = tags['name:en'];
    }
    if (!name && tags['addr:street']) {
      name = `${tags['addr:street']} ${tags['addr:housenumber'] || ''}`.trim();
    }

    const levels = parseFloat(tags['building:levels']) || null;
    let h = parseFloat(tags.height) || null;
    let minH = parseFloat(tags.min_height) || 0.0;
    const minLevel = parseFloat(tags['building:min_level']) || 0.0;
    if (minH === 0.0 && minLevel > 0) minH = minLevel * 3.3;

    const isChurch = btype === 'church' || btype === 'cathedral' || btype === 'chapel' ||
      tags.amenity === 'place_of_worship' ||
      /(kirche|kościół|bazylika|katedra|church|cathedral)/i.test(name);
    const isTower = btype === 'tower' || btype === 'bell_tower' || btype === 'water_tower' ||
      ['tower', 'chimney', 'lighthouse'].includes(tags.man_made) || Boolean(tags['tower:type']);

    if (h === null) {
      if (levels !== null) {
        h = levels * 3.6 + (isPart ? 0.0 : 3.8);
      } else if (isChurch) {
        h = 32.0;
      } else if (isTower) {
        h = 52.0;
      } else if (['public', 'civic', 'museum', 'university', 'palace', 'government', 'train_station', 'hotel'].includes(btype)) {
        h = 18.0;
      } else if (['apartments', 'residential', 'commercial', 'office', 'retail'].includes(btype)) {
        h = 18.0;
      } else if (['garage', 'shed', 'hut', 'kiosk', 'roof'].includes(btype)) {
        h = 4.5;
      } else {
        h = 16.0;
      }
    }

    if (minH >= h - 0.5) minH = 0.0;

    // Roof Shape & Height: never invent fake hipped roofs!
    const rawRoof = String(tags['roof:shape'] || '').toLowerCase().trim();
    let roof = 'flat';
    if (rawRoof) {
      roof = ROOF_SHAPES_NORM[rawRoof] || 'flat';
    } else if (isChurch) {
      roof = 'gabled';
    }

    let roofH = 0.0;
    if (roof !== 'flat') {
      const roofHTag = parseFloat(tags['roof:height']);
      const roofLvlTag = parseFloat(tags['roof:levels']);
      if (!isNaN(roofHTag)) {
        roofH = roofHTag;
      } else if (!isNaN(roofLvlTag)) {
        roofH = roofLvlTag * 3.0;
      } else {
        const spanXM = (maxX - minX) / Math.max(1e-4, metersToUnits);
        const spanYM = (maxY - minY) / Math.max(1e-4, metersToUnits);
        const minSpanM = Math.max(2.0, Math.min(spanXM, spanYM));
        roofH = Math.min(h * 0.35, minSpanM * 0.45, 12.0);
      }
      const availH = Math.max(0.0, h - minH - 0.5);
      roofH = Math.min(roofH, availH);
    }

    buildings.push({
      id: buildings.length + 1,
      osmId,
      groupId: groupId !== null ? groupId : osmId,
      name: name || (isChurch ? `Kościół #${osmId}` : (isPart ? `Część #${osmId}` : `Budynek OSM #${osmId}`)),
      btype,
      cx: Math.round(cx * 100) / 100,
      cy: Math.round(cy * 100) / 100,
      outer,
      holes,
      h: Math.round(h * 10) / 10,
      minH: Math.round(minH * 10) / 10,
      levels: Math.max(1, Math.round(h / 3.5)),
      roof,
      roofH: Math.round(roofH * 10) / 10,
      part: Boolean(isPart),
      isOutline: false,
      church: isChurch,
      tower: isTower,
      landmark: Boolean(tags.name || tags.wikidata || tags.heritage || isChurch || isTower)
    });
  }

  // 1. Multipolygon & Building Relations
  for (const rel of relations) {
    const tags = rel.tags || {};
    const members = rel.members || [];
    const relType = tags.type || '';
    const isWater = tags.natural === 'water' || tags.waterway === 'riverbank' || tags.water || ['reservoir', 'basin'].includes(tags.landuse);
    const isGreen = ['park', 'garden', 'nature_reserve', 'pitch', 'playground', 'common'].includes(tags.leisure) ||
                    ['forest', 'grass', 'meadow', 'village_green', 'recreation_ground', 'cemetery', 'allotments', 'farmland'].includes(tags.landuse) ||
                    ['wood', 'scrub', 'grassland', 'heath'].includes(tags.natural);
    const isBuilding = relType === 'building' || tags.building || tags['building:part'] ||
                       members.some(m => m.role === 'part' || m.role === 'outline');

    if (isBuilding) {
      const partRefs = [], outlineRefs = [], innerRefs = [], outerRefs = [];
      for (const m of members) {
        if (m.type === 'way' && ways.has(m.ref)) {
          const r = m.role || 'outer';
          if (r === 'part') partRefs.push(m.ref);
          else if (r === 'outline') outlineRefs.push(m.ref);
          else if (r === 'inner') innerRefs.push(m.ref);
          else outerRefs.push(m.ref);
        }
      }

      if (partRefs.length > 0) {
        // S3DB relation with parts: suppress outline from extrusion, emit parts with shared groupId
        const parentName = tags.name || tags['name:en'] || tags['name:pl'] || '';
        for (const ref of [...outlineRefs, ...outerRefs]) usedWays.add(ref);
        for (const ref of partRefs) {
          usedWays.add(ref);
          const wObj = ways.get(ref);
          const wTags = { ...wObj.tags };
          const wNids = wObj.nodes || [];
          if (wNids.length >= 4 && wNids[0] === wNids[wNids.length - 1]) {
            const pts = nodesToPts(wNids);
            if (pts.length >= 3) {
              if (!wTags.name && parentName) wTags.name = parentName;
              pushBuilding(ref, wTags, pts, [], rel.id, true);
            }
          }
        }
        continue;
      }

      // Standard multipolygon building
      const outerWays = (outerRefs.length ? outerRefs : outlineRefs).map(ref => ways.get(ref).nodes);
      const innerWays = innerRefs.map(ref => ways.get(ref).nodes);
      for (const ref of [...outerRefs, ...outlineRefs, ...innerRefs]) usedWays.add(ref);

      const outerRings = stitchWayRingsJS(outerWays);
      const innerRings = stitchWayRingsJS(innerWays);
      const outerPolys = outerRings.map(r => nodesToPts(r)).filter(p => p.length >= 3);
      const innerPolys = innerRings.map(r => nodesToPts(r)).filter(p => p.length >= 3);
      for (const op of outerPolys) {
        pushBuilding(rel.id, tags, op, innerPolys, rel.id, false);
      }
      continue;
    }

    if (isWater || isGreen) {
      const outerWays = [], innerWays = [];
      for (const m of members) {
        if (m.type === 'way' && ways.has(m.ref)) {
          if (m.role === 'inner') innerWays.push(ways.get(m.ref).nodes);
          else { outerWays.push(ways.get(m.ref).nodes); usedWays.add(m.ref); }
        }
      }
      const outerRings = stitchWayRingsJS(outerWays);
      const innerRings = stitchWayRingsJS(innerWays);
      const outerPolys = outerRings.map(r => nodesToPts(r)).filter(p => p.length >= 3);
      const innerPolys = innerRings.map(r => nodesToPts(r)).filter(p => p.length >= 3);
      if (isWater) {
        outerPolys.forEach(op => waterPolys.push({ outer: op, holes: innerPolys, name: tags.name || 'Woda' }));
      } else if (isGreen) {
        outerPolys.forEach(op => greenPolys.push({ outer: op, holes: innerPolys, type: tags.leisure || tags.landuse || 'park' }));
      }
    }
  }

  // 2. Standalone Ways (Candidate Parents & Candidate Parts)
  const candidateParents = [], candidateParts = [];
  const coastWays = [];

  for (const [wid, w] of ways.entries()) {
    const tags = w.tags || {};
    const nids = w.nodes || [];
    if (nids.length < 2) continue;
    const isClosed = nids[0] === nids[nids.length - 1] && nids.length >= 4;
    const pts = nodesToPts(nids);
    if (pts.length < 2) continue;

    if (tags.natural === 'coastline') {
      coastWays.push(pts);
      continue;
    }
    if (['pier', 'breakwater', 'groyne', 'bridge'].includes(tags.man_made) && isClosed && pts.length >= 3) {
      pushBuilding(wid, { ...tags, building: 'pier', height: '3.5', 'roof:shape': 'flat', name: tags.name || `Molo #${wid}` }, pts, [], wid, false);
      continue;
    }
    if ((tags.building || tags['building:part']) && isClosed && pts.length >= 3) {
      if (usedWays.has(wid)) continue;
      let sx = 0, sy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        sx += p[0]; sy += p[1];
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      }
      const cx = sx / pts.length, cy = sy / pts.length;
      if (Math.abs(cx) <= halfW + 3.0 && Math.abs(cy) <= halfH + 3.0) {
        const area = Math.abs(polyAreaSignedJS(pts));
        const isPart = Boolean(tags['building:part']);
        const rec = { wid, tags: { ...tags }, pts, cx, cy, bbox: [minX, minY, maxX, maxY], area, hasParts: false, groupId: null, isPart };
        if (isPart) candidateParts.push(rec);
        else candidateParents.push(rec);
      }
      continue;
    }
    if ((tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'reservoir' || tags.landuse === 'basin') && isClosed) {
      if (!usedWays.has(wid)) waterPolys.push({ outer: pts, holes: [], name: tags.name || 'Woda' });
      continue;
    }
    if (tags.waterway && ['river', 'canal', 'stream', 'dock'].includes(tags.waterway) && tags.tunnel !== 'yes') {
      const wm = parseFloat(tags.width) || (tags.waterway === 'river' ? 18 : 8);
      waterLines.push({ pts, width: Math.max(0.6, wm * metersToUnits), name: tags.name || tags.waterway });
      continue;
    }
    if ((tags.leisure || tags.landuse || ['wood', 'scrub', 'grassland'].includes(tags.natural)) && isClosed) {
      if (!usedWays.has(wid) && !['residential', 'industrial', 'commercial', 'retail'].includes(tags.landuse)) {
        greenPolys.push({ outer: pts, holes: [], type: tags.leisure || tags.landuse || tags.natural });
      }
      continue;
    }
    if (tags.highway || tags.railway || ['bridge', 'pier', 'breakwater', 'groyne'].includes(tags.man_made)) {
      const layerVal = parseInt(tags.layer, 10) || 0;
      if (layerVal < 0 || tags.tunnel === 'yes' || ['building_passage', 'culvert'].includes(tags.tunnel) || tags.covered === 'yes') continue;
      const hwy = tags.highway || tags.railway || tags.man_made || 'bridge';
      const bridgeTag = tags.bridge;
      const isBridge = (bridgeTag && !['no', 'false', '0', 'none'].includes(bridgeTag)) ||
                       ['bridge', 'pier', 'breakwater', 'groyne'].includes(tags.man_made);

      let rwm = 6.2;
      if (['footway', 'path', 'cycleway', 'steps', 'bridleway', 'track', 'corridor', 'pedestrian'].includes(hwy)) {
        if (!isBridge && (tags.footway === 'sidewalk' || tags.footway === 'crossing')) continue;
        rwm = 2.2;
      } else if (['motorway', 'trunk', 'primary'].includes(hwy)) {
        rwm = 11.5;
      } else if (['secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link'].includes(hwy)) {
        rwm = 8.8;
      } else if (['rail', 'light_rail', 'tram'].includes(hwy)) {
        rwm = 5.0;
      }

      roads.push({
        pts,
        width: Math.round(Math.max(0.4, rwm * metersToUnits) * 100) / 100,
        hwy,
        bridge: Boolean(isBridge),
        layer: layerVal,
        name: tags.name || ''
      });
    }
  }

  // 3. Simple 3D Buildings (S3DB) Spatial Matching & Outline Suppression
  for (const part of candidateParts) {
    let bestParent = null;
    let bestArea = Infinity;
    const [pMinX, pMinY, pMaxX, pMaxY] = part.bbox;
    for (const parent of candidateParents) {
      const [parMinX, parMinY, parMaxX, parMaxY] = parent.bbox;
      if (pMinX > parMaxX + 0.1 || pMaxX < parMinX - 0.1 || pMinY > parMaxY + 0.1 || pMaxY < parMinY - 0.1) continue;
      if (pointInPolyLocal(part.cx, part.cy, parent.pts)) {
        if (parent.area < bestArea) { bestArea = parent.area; bestParent = parent; }
        continue;
      }
      let inCnt = 0;
      for (const pt of part.pts) {
        if (pointInPolyLocal(pt[0], pt[1], parent.pts)) inCnt++;
      }
      if (inCnt >= part.pts.length * 0.5) {
        if (parent.area < bestArea) { bestArea = parent.area; bestParent = parent; }
      }
    }
    if (bestParent) {
      bestParent.hasParts = true;
      part.groupId = bestParent.wid;
      if (!part.tags.name) {
        part.tags.name = bestParent.tags.name || bestParent.tags['name:en'] || bestParent.tags['name:pl'] || '';
      }
    } else {
      part.groupId = part.wid;
    }
  }

  // Emit surviving parts
  for (const part of candidateParts) {
    pushBuilding(part.wid, part.tags, part.pts, [], part.groupId, true);
  }
  // Emit surviving parents (suppress parent outlines that contain parts)
  for (const parent of candidateParents) {
    if (!parent.hasParts) {
      pushBuilding(parent.wid, parent.tags, parent.pts, [], parent.wid, false);
    }
  }

  // Re-index building IDs
  for (let i = 0; i < buildings.length; i++) {
    buildings[i].id = i + 1;
  }

  // Stitch any natural=coastline ways into closed sea polygons
  if (coastWays.length > 0) {
    const chains = coastWays.map(c => c.slice());
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < chains.length && !merged; i++) {
        for (let j = 0; j < chains.length; j++) {
          if (i === j) continue;
          const endI = chains[i][chains[i].length - 1];
          const startJ = chains[j][0];
          if (Math.hypot(endI[0] - startJ[0], endI[1] - startJ[1]) < 0.8) {
            chains[i] = chains[i].concat(chains[j].slice(1));
            chains.splice(j, 1);
            merged = true;
            break;
          }
        }
      }
    }
    const R = Math.max(halfW, halfH) + 7.4;
    const rayBox = (pFrom, pTo) => {
      const dx = pTo[0] - pFrom[0], dy = pTo[1] - pFrom[1];
      let bestT = Infinity, bestPt = [Math.max(-R, Math.min(R, pTo[0])), Math.max(-R, Math.min(R, pTo[1]))];
      for (const ex of [-R, R]) {
        if (Math.abs(dx) > 1e-6) {
          const t = (ex - pFrom[0]) / dx, y = pFrom[1] + t * dy;
          if (t > 0 && y >= -R - 1e-2 && y <= R + 1e-2 && t < bestT) { bestT = t; bestPt = [ex, Math.max(-R, Math.min(R, y))]; }
        }
      }
      for (const ey of [-R, R]) {
        if (Math.abs(dy) > 1e-6) {
          const t = (ey - pFrom[1]) / dy, x = pFrom[0] + t * dx;
          if (t > 0 && x >= -R - 1e-2 && x <= R + 1e-2 && t < bestT) { bestT = t; bestPt = [Math.max(-R, Math.min(R, x)), ey]; }
        }
      }
      return bestPt;
    };
    const cwParam = (pt) => {
      const [x, y] = pt;
      if (Math.abs(y - R) < 0.05) return x + R;
      if (Math.abs(x - R) < 0.05) return 2 * R + (R - y);
      if (Math.abs(y + R) < 0.05) return 4 * R + (R - x);
      return 6 * R + (y + R);
    };
    const corners = [[2 * R, [R, R]], [4 * R, [R, -R]], [6 * R, [-R, -R]], [8 * R, [-R, R]]];
    for (const ch of chains) {
      if (ch.length < 2) continue;
      const pStart = rayBox(ch[1], ch[0]);
      const pEnd = rayBox(ch[ch.length - 2], ch[ch.length - 1]);
      const sEnd = cwParam(pEnd), sStart = cwParam(pStart);
      const span = ((sStart - sEnd) % (8 * R) + 8 * R) % (8 * R);
      const cwCorners = corners
        .map(c => [((c[0] - sEnd) % (8 * R) + 8 * R) % (8 * R), c[1]])
        .filter(c => c[0] > 0.05 && c[0] < span - 0.05)
        .sort((a, b) => a[0] - b[0])
        .map(c => c[1]);
      waterPolys.push({ outer: [pStart, ...ch, pEnd, ...cwCorners], holes: [], name: 'Morze / Zatoka' });
    }
  }

  // Add organic canopy trees in green polygons
  for (const gp of greenPolys) {
    const area = Math.abs(polyAreaSignedJS(gp.outer));
    if (area < 4) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    gp.outer.forEach(p => {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    });
    const count = Math.min(60, Math.floor(area * 0.16));
    for (let k = 0; k < count * 3 && trees.length < 1500; k++) {
      const px = minX + ((k * 0.6180339) % 1) * (maxX - minX);
      const py = minY + ((k * 0.3819660) % 1) * (maxY - minY);
      if (Math.abs(px) < halfW - 1.5 && Math.abs(py) < halfH - 1.5 && pointInPolyLocal(px, py, gp.outer)) {
        trees.push([Math.round(px * 100) / 100, Math.round(py * 100) / 100, 12.0]);
      }
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
    buildings
  };
}
