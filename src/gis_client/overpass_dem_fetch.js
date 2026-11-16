// ============================================================================
// src/gis_client/overpass_dem_fetch.js
// Adaptive AWS Terrarium DEM Tile Fetcher & Water Ring/Coastline Stitcher Shim
// ============================================================================

if (typeof require === 'function') {
  const _g = typeof globalThis !== 'undefined' ? globalThis : global;
  Object.assign(
    _g,
    require('../Water/water_ring_geometry.js'),
    require('../Water/water_multipolygon_stitcher.js'),
    require('../Water/water_coastline_stitcher.js')
  );
}

const _demTilePixelCache = new Map();

function chooseAdaptiveDemZoom(spanMeters) {
  const s = Number(spanMeters) || 1200;
  if (s <= 1300) return 15;
  if (s <= 2500) return 14;
  if (s <= 5500) return 13;
  if (s <= 16000) return 12;
  if (s <= 35000) return 11;
  return 10;
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
  const rawGrid = new Float64Array(gridSize * gridSize);
  const validMask = new Uint8Array(gridSize * gridSize);
  let validSum = 0, validCount = 0;
  for (let gy = 0; gy < gridSize; gy++) {
    const lat = south + (gy / (gridSize - 1)) * (north - south);
    for (let gx = 0; gx < gridSize; gx++) {
      const lon = west + (gx / (gridSize - 1)) * (east - west);
      const xf = lon2tileF(lon, zoom), yf = lat2tileF(lat, zoom);
      const tx = Math.floor(xf), ty = Math.floor(yf);
      const px = Math.min(255, Math.max(0, Math.floor((xf - tx) * 256)));
      const py = Math.min(255, Math.max(0, Math.floor((yf - ty) * 256)));
      const data = tilePixels[`${tx}_${ty}`];
      const cellIdx = gy * gridSize + gx;
      if (data) {
        const idx = (py * 256 + px) * 4;
        const elev = (data[idx] * 256.0 + data[idx + 1] + data[idx + 2] / 256.0) - 32768.0;
        rawGrid[cellIdx] = elev;
        validMask[cellIdx] = 1;
        validSum += elev;
        validCount++;
      }
    }
  }
  const avgValidElev = validCount > 0 ? (validSum / validCount) : 0;
  let minElev = Infinity, maxElev = -Infinity;
  for (let gy = 0; gy < gridSize; gy++) {
    const row = [];
    for (let gx = 0; gx < gridSize; gx++) {
      const cellIdx = gy * gridSize + gx;
      let elev = rawGrid[cellIdx];
      if (!validMask[cellIdx]) {
        if (validCount > 0) {
          // Interpolate / carry nearest valid Terrarium pixel instead of emitting 0m sinkholes
          let bestDistSq = Infinity;
          let bestElev = avgValidElev;
          for (let ny = 0; ny < gridSize; ny++) {
            const dy = ny - gy;
            const dySq = dy * dy;
            if (dySq >= bestDistSq) continue;
            for (let nx = 0; nx < gridSize; nx++) {
              if (!validMask[ny * gridSize + nx]) continue;
              const dSq = dySq + (nx - gx) * (nx - gx);
              if (dSq < bestDistSq) {
                bestDistSq = dSq;
                bestElev = rawGrid[ny * gridSize + nx];
              }
            }
          }
          elev = bestElev;
        } else {
          elev = 0;
        }
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
  window.stitchClippedMultipolygonRingsJS = stitchClippedMultipolygonRingsJS;
  window.stitchCoastlineSeaPolysJS = stitchCoastlineSeaPolysJS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    simplifyRingJS,
    stitchWayRingsJS,
    polyAreaSignedJS,
    pointInPolyLocal,
    chooseAdaptiveDemZoom,
    fetchAdaptiveTerrariumDem,
    fetchTerrariumDemInBrowser,
    stitchClippedMultipolygonRingsJS,
    stitchCoastlineSeaPolysJS
  };
}
