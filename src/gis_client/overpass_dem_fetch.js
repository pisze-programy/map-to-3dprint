// ============================================================================
// src/gis_client/overpass_dem_fetch.js
// Multipolygon Ring Stitching, Coastline-to-Sea Polygon Builder & Adaptive
// AWS Terrarium DEM Tile Fetcher
// ============================================================================

const _demTilePixelCache = new Map();

function simplifyRingJS(pts, tol = 0.015) {
  if (!pts || pts.length < 4) return pts || [];
  const out = [pts[0]];
  const tolSq = tol * tol;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], last = out[out.length - 1];
    const dx = p[0] - last[0], dy = p[1] - last[1];
    if (dx * dx + dy * dy >= tolSq) out.push(p);
  }
  if (out.length >= 3 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) {
    out.pop();
  }
  return out;
}

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

function stitchCoastlineSeaPolysJS(coastWays, halfW, halfH, waterPolys) {
  if (!coastWays || coastWays.length === 0) return;
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
    if (ch.length >= 4 && Math.hypot(ch[0][0] - ch[ch.length - 1][0], ch[0][1] - ch[ch.length - 1][1]) < 1.0) {
      if (polyAreaSignedJS(ch) <= 0) waterPolys.push({ outer: ch, holes: [], name: 'Morze / Ocean' });
      continue;
    }
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

function chooseAdaptiveDemZoom(spanMeters) {
  const s = Number(spanMeters) || 1200;
  if (s <= 1300) return 15;
  if (s <= 2500) return 14;
  if (s <= 5500) return 13;
  if (s <= 11500) return 12;
  return 11;
}

async function fetchAdaptiveTerrariumDem(south, west, north, east, gridSize = 72, explicitZoom = null, abortSignal = null) {
  if (abortSignal && abortSignal.aborted) throw new Error('Aborted');
  const centerLat = (south + north) * 0.5;
  const cosLat = Math.max(0.2, Math.cos(centerLat * Math.PI / 180.0));
  const spanNsM = Math.abs(north - south) * 111320.0;
  const spanEwM = Math.abs(east - west) * 111320.0 * cosLat;
  const maxSpanM = Math.max(spanNsM, spanEwM);
  const zoom = explicitZoom || chooseAdaptiveDemZoom(maxSpanM);

  const xMinF = lon2tileF(west, zoom), xMaxF = lon2tileF(east, zoom);
  const yMinF = lat2tileF(north, zoom), yMaxF = lat2tileF(south, zoom);
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
      if (abortSignal && abortSignal.aborted) break;
      const cacheKey = `${zoom}_${tx}_${ty}`;
      if (_demTilePixelCache.has(cacheKey)) {
        tilePixels[`${tx}_${ty}`] = _demTilePixelCache.get(cacheKey);
        continue;
      }
      promises.push(new Promise((resolve) => {
        if (abortSignal && abortSignal.aborted) { resolve(); return; }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const timeoutId = setTimeout(() => resolve(), 8500);
        const onAbort = () => { clearTimeout(timeoutId); resolve(); };
        if (abortSignal) abortSignal.addEventListener('abort', onAbort, { once: true });
        img.onload = () => {
          clearTimeout(timeoutId);
          if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
          try {
            offCtx.clearRect(0, 0, 256, 256);
            offCtx.drawImage(img, 0, 0, 256, 256);
            const data = offCtx.getImageData(0, 0, 256, 256).data;
            _demTilePixelCache.set(cacheKey, data);
            if (_demTilePixelCache.size > 160) {
              _demTilePixelCache.delete(_demTilePixelCache.keys().next().value);
            }
            tilePixels[`${tx}_${ty}`] = data;
          } catch (_) {}
          resolve();
        };
        img.onerror = () => {
          clearTimeout(timeoutId);
          if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
          resolve();
        };
        img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`;
      }));
    }
  }
  if (promises.length > 0) await Promise.all(promises);
  if (abortSignal && abortSignal.aborted) throw new Error('Aborted');

  if (zoom === 15 && Object.keys(tilePixels).length === 0 && !explicitZoom) {
    return fetchAdaptiveTerrariumDem(south, west, north, east, gridSize, 14, abortSignal);
  }

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
  const resolutionMeters = Math.round((40075016 * cosLat / (256 * Math.pow(2, zoom))) * 10) / 10;
  return {
    gridSize,
    minElev,
    maxElev,
    grid,
    zoom,
    source: 'AWS Terrarium (USGS 3DEP 10m / LiDAR ~3-5m)',
    resolutionMeters
  };
}

let fetchTerrariumDemInBrowser = async function (south, west, north, east, gridSize = 72, zoom = null) {
  return fetchAdaptiveTerrariumDem(south, west, north, east, gridSize, zoom || null);
};

if (typeof window !== 'undefined') {
  window.chooseAdaptiveDemZoom = chooseAdaptiveDemZoom;
  window.fetchAdaptiveTerrariumDem = fetchAdaptiveTerrariumDem;
  window.fetchTerrariumDemInBrowser = fetchTerrariumDemInBrowser;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    chooseAdaptiveDemZoom,
    fetchAdaptiveTerrariumDem,
    fetchTerrariumDemInBrowser
  };
}
