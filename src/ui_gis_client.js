// ============================================================================
// src/ui_gis_client.js
// Direct In-Browser GIS Pipeline (AWS Terrarium DEM + Overpass QL Multipolygons)
// ============================================================================

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
  const nbbox = `${(south - 0.004).toFixed(5)},${(west - 0.005).toFixed(5)},${(north + 0.004).toFixed(5)},${(east + 0.005).toFixed(5)}`;
  // Fix B05: Include multipolygon relations for courtyard buildings, riverbanks, and parks
  const query = `[out:json][timeout:30][bbox:${bbox}];(way["building"];relation["building"];way["building:part"];relation["building:part"];way["natural"];relation["natural"="water"];way["waterway"];relation["waterway"="riverbank"];way["landuse"];way["leisure"];relation["leisure"="park"];node["natural"="tree"];way["highway"];way["railway"];way["man_made"="bridge"];);out body qt;>;out skel qt;`;

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];

  // Fix B08: Sample DEM over the exact metric square matching vector projection
  const centerLat = (south + north) * 0.5;
  const centerLon = (west + east) * 0.5;
  const cosLat = Math.max(0.2, Math.cos(centerLat * Math.PI / 180.0));
  const spanLatM = (north - south) * 111320.0;
  const spanLonM = (east - west) * 111320.0 * cosLat;
  const spanM = Math.max(spanLatM, spanLonM);
  const halfM = spanM * 0.5;
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

  const metersToUnits = 170.0 / spanM;

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
      if (el.tags && el.tags.natural === 'tree' && Math.abs(pt[0]) <= 85 && Math.abs(pt[1]) <= 85) {
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

  function pushBuilding(osmId, tags, outer, holes) {
    if (outer.length < 3) return;
    let sx = 0, sy = 0;
    outer.forEach(p => { sx += p[0]; sy += p[1]; });
    const cx = sx / outer.length, cy = sy / outer.length;
    if (Math.abs(cx) > 88 || Math.abs(cy) > 88) return;
    const btype = tags.building || tags['building:part'] || 'yes';
    const isPart = ('building:part' in tags) && !('building' in tags);
    const levels = parseFloat(tags['building:levels']) || null;
    let h = parseFloat(tags.height) || (levels ? levels * 3.6 + (isPart ? 0 : 3.5) : 16.5);
    const name = tags.name || (tags['addr:street'] ? `${tags['addr:street']} ${tags['addr:housenumber'] || ''}`.trim() : `Budynek OSM #${osmId}`);
    buildings.push({
      id: buildings.length + 1,
      osmId,
      name,
      btype,
      cx: Math.round(cx * 100) / 100,
      cy: Math.round(cy * 100) / 100,
      outer,
      holes,
      h: Math.round(h * 10) / 10,
      minH: 0,
      levels: Math.max(1, Math.round(h / 3.5)),
      roof: tags['roof:shape'] || 'hipped',
      roofH: Math.min(6.5, Math.max(2.6, h * 0.22)),
      part: isPart,
      church: btype === 'church' || btype === 'cathedral',
      tower: btype === 'tower' || tags['man_made'] === 'tower',
      landmark: Boolean(tags.name || tags.wikidata || tags.heritage)
    });
  }

  for (const rel of relations) {
    const tags = rel.tags || {};
    const outers = [], inners = [];
    for (const m of (rel.members || [])) {
      if (m.type === 'way' && ways.has(m.ref)) {
        const pts = nodesToPts(ways.get(m.ref).nodes);
        if (pts.length >= 3) {
          if (m.role === 'inner') inners.push(pts);
          else { outers.push(pts); usedWays.add(m.ref); }
        }
      }
    }
    if (!outers.length) continue;
    if (tags.natural === 'water' || tags.waterway === 'riverbank') {
      outers.forEach(op => waterPolys.push({ outer: op, holes: inners, name: tags.name || 'Woda' }));
    } else if (tags.building || tags['building:part']) {
      outers.forEach(op => pushBuilding(rel.id, tags, op, inners));
    } else if (tags.leisure || tags.landuse || tags.natural === 'wood') {
      outers.forEach(op => greenPolys.push({ outer: op, holes: inners, type: tags.leisure || tags.landuse || 'park' }));
    }
  }

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
    if (['pier', 'breakwater', 'groyne'].includes(tags.man_made) && isClosed && pts.length >= 3) {
      pushBuilding(wid, { ...tags, building: 'pier', height: '3.5', 'roof:shape': 'flat', name: tags.name || `Molo #${wid}` }, pts, []);
      continue;
    }
    if ((tags.building || tags['building:part']) && isClosed) {
      if (!usedWays.has(wid) || tags['building:part']) pushBuilding(wid, tags, pts, []);
      continue;
    }
    if ((tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'reservoir' || tags.landuse === 'basin') && isClosed) {
      if (!usedWays.has(wid)) waterPolys.push({ outer: pts, holes: [], name: tags.name || 'Woda' });
      continue;
    }
    if (tags.waterway && ['river', 'canal', 'stream', 'dock'].includes(tags.waterway) && tags.tunnel !== 'yes') {
      const wm = parseFloat(tags.width) || (tags.waterway === 'river' ? 18 : 8);
      waterLines.push({ pts, width: Math.max(0.8, wm * metersToUnits), name: tags.name || tags.waterway });
      continue;
    }
    if ((tags.leisure || tags.landuse || ['wood', 'scrub', 'grassland'].includes(tags.natural)) && isClosed) {
      if (!usedWays.has(wid) && !['residential', 'industrial', 'commercial', 'retail'].includes(tags.landuse)) {
        greenPolys.push({ outer: pts, holes: [], type: tags.leisure || tags.landuse || tags.natural });
      }
      continue;
    }
    if (tags.highway || tags.railway || ['bridge', 'pier', 'breakwater', 'groyne'].includes(tags.man_made)) {
      if (tags.tunnel === 'yes' || (parseFloat(tags.layer) < 0)) continue;
      const hwy = tags.highway || tags.railway || tags.man_made || 'bridge';
      const isBridge = tags.bridge === 'yes' || tags.bridge === 'viaduct' || ['bridge', 'pier', 'breakwater', 'groyne'].includes(tags.man_made);
      if (['footway', 'path', 'steps', 'cycleway'].includes(hwy) && !isBridge) continue;
      const rwm = ['motorway', 'trunk', 'primary'].includes(hwy) ? 11.0 : ['secondary', 'tertiary'].includes(hwy) ? 8.5 : 6.2;
      roads.push({ pts, width: Math.max(0.55, rwm * metersToUnits), hwy, bridge: isBridge, name: tags.name || '' });
    }
  }

  // Stitch any natural=coastline ways into closed sea polygons (land on left, sea on right -> clockwise around box)
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
    const R = 92.0;
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
    const area = Math.abs(signedArea2D(gp.outer));
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
      if (Math.abs(px) < 83 && Math.abs(py) < 83 && pointInPoly2D(px, py, gp.outer)) {
        trees.push([Math.round(px * 100) / 100, Math.round(py * 100) / 100, 12.0]);
      }
    }
  }

  return {
    bbox: [south, west, north, east],
    center: [centerLat, centerLon],
    spanMeters: Math.round(spanM),
    metersToUnits,
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

