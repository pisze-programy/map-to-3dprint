// ============================================================================
// src/gis_fetch/dem_terrarium_fetcher.js
// Adaptive AWS Terrarium DEM Fetcher with Exact O(G^2) Void-Fill & Iterative Zoom
// Layer 2 (Depends only on optional fetch_diagnostics_trace.js)
// ============================================================================

(function (root) {
  let _diag = null;
  if (typeof recordFetchDiagnosticEvent === 'function') {
    _diag = { recordFetchDiagnosticEvent };
  } else if (typeof require === 'function') {
    try { _diag = require('./fetch_diagnostics_trace.js'); } catch (_) {}
  }

  const _demTilePixelCache = new Map();
  let _preloadedDemOverride = null;

  function setDemPreloadedOverride(dem) {
    const prev = _preloadedDemOverride;
    _preloadedDemOverride = dem || null;
    return prev;
  }

  function demLon2TileF(lon, z) {
    return ((lon + 180.0) / 360.0) * Math.pow(2, z);
  }

  function demLat2TileF(lat, z) {
    const clampedLat = Math.max(-85.0, Math.min(85.0, lat));
    const rad = (clampedLat * Math.PI) / 180.0;
    return ((1.0 - Math.log(Math.tan(rad) + 1.0 / Math.cos(rad)) / Math.PI) / 2.0) * Math.pow(2, z);
  }

  function chooseAdaptiveDemZoom(spanMeters) {
    const s = Number(spanMeters) || 1200;
    if (s <= 1300) return 15;
    if (s <= 2500) return 14;
    if (s <= 5500) return 13;
    if (s <= 16000) return 12;
    if (s <= 35000) return 11;
    return 10;
  }

  // Exact O(G^2) Separable 2D Euclidean Distance Transform (Felzenszwalb-Huttenlocher)
  // Replaces the legacy O(G^4) brute-force scan while preserving exact nearest-pixel argmin.
  function fillDemVoidsNearestO_G2(rawGrid, validMask, gridSize, fallbackElev) {
    const total = gridSize * gridSize;
    const out = new Float64Array(rawGrid);
    const INF = 1e18;

    // Pass 1: 1D horizontal nearest valid column per row in O(G^2)
    const rowBestX = new Int32Array(total).fill(-1);
    for (let y = 0; y < gridSize; y++) {
      const base = y * gridSize;
      let lastX = -1;
      for (let x = 0; x < gridSize; x++) {
        if (validMask[base + x]) lastX = x;
        rowBestX[base + x] = lastX;
      }
      lastX = -1;
      for (let x = gridSize - 1; x >= 0; x--) {
        if (validMask[base + x]) lastX = x;
        if (lastX >= 0) {
          const prevX = rowBestX[base + x];
          if (prevX < 0 || (lastX - x) < (x - prevX)) {
            rowBestX[base + x] = lastX;
          }
        }
      }
    }

    // Pass 2: 1D vertical lower-envelope of parabolas per column in O(G^2)
    const v = new Int32Array(gridSize);
    const z = new Float64Array(gridSize + 1);
    const gCol = new Float64Array(gridSize);

    for (let x = 0; x < gridSize; x++) {
      let k = -1;
      for (let y = 0; y < gridSize; y++) {
        const bx = rowBestX[y * gridSize + x];
        if (bx < 0) {
          gCol[y] = INF;
          continue;
        }
        const dx = x - bx;
        const gy = dx * dx;
        gCol[y] = gy;

        if (k < 0) {
          k = 0;
          v[0] = y;
          z[0] = -INF;
          z[1] = INF;
          continue;
        }
        let s = ((gy + y * y) - (gCol[v[k]] + v[k] * v[k])) / (2 * (y - v[k]));
        while (k > 0 && s < z[k]) {
          k--;
          s = ((gy + y * y) - (gCol[v[k]] + v[k] * v[k])) / (2 * (y - v[k]));
        }
        k++;
        v[k] = y;
        z[k] = s;
        z[k + 1] = INF;
      }

      if (k < 0) {
        for (let y = 0; y < gridSize; y++) {
          if (!validMask[y * gridSize + x]) out[y * gridSize + x] = fallbackElev;
        }
        continue;
      }

      let ptr = 0;
      for (let y = 0; y < gridSize; y++) {
        const idx = y * gridSize + x;
        if (validMask[idx]) continue;
        while (z[ptr + 1] < y) ptr++;
        const bestY = v[ptr];
        const bestX = rowBestX[bestY * gridSize + x];
        out[idx] = bestX >= 0 ? rawGrid[bestY * gridSize + bestX] : fallbackElev;
      }
    }
    return out;
  }

  async function _loadDemTilesAtZoom(south, west, north, east, zoom, abortSignal) {
    const lonFn = typeof lon2tileF === 'function' ? lon2tileF : demLon2TileF;
    const latFn = typeof lat2tileF === 'function' ? lat2tileF : demLat2TileF;
    const xMinF = lonFn(west, zoom);
    const xMaxF = lonFn(east, zoom);
    const yMinF = latFn(north, zoom);
    const yMaxF = latFn(south, zoom);
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
    return tilePixels;
  }

  async function fetchAdaptiveTerrariumDem(south, west, north, east, gridSize = 72, explicitZoom = null, abortSignal = null) {
    if (abortSignal && abortSignal.aborted) throw new Error('Aborted');
    const centerLat = (south + north) * 0.5;
    const cosLat = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180.0));
    const spanNsM = Math.abs(north - south) * 111320.0;
    const spanEwM = Math.abs(east - west) * 111320.0 * cosLat;
    const maxSpanM = Math.max(spanNsM, spanEwM);
    const initialZoom = explicitZoom || chooseAdaptiveDemZoom(maxSpanM);

    // Loop-free bounded zoom candidate sequence (Z15 -> Z14 fallback without recursion)
    const zoomCandidates = (initialZoom === 15 && !explicitZoom) ? [15, 14] : [initialZoom];
    let zoom = initialZoom;
    let tilePixels = {};

    for (let zi = 0; zi < zoomCandidates.length; zi++) {
      zoom = zoomCandidates[zi];
      tilePixels = await _loadDemTilesAtZoom(south, west, north, east, zoom, abortSignal);
      if (abortSignal && abortSignal.aborted) throw new Error('Aborted');
      if (Object.keys(tilePixels).length > 0) break;
    }

    const lonFn = typeof lon2tileF === 'function' ? lon2tileF : demLon2TileF;
    const latFn = typeof lat2tileF === 'function' ? lat2tileF : demLat2TileF;
    const rawGrid = new Float64Array(gridSize * gridSize);
    const validMask = new Uint8Array(gridSize * gridSize);
    let validSum = 0;
    let validCount = 0;

    for (let gy = 0; gy < gridSize; gy++) {
      const lat = south + (gy / (gridSize - 1)) * (north - south);
      for (let gx = 0; gx < gridSize; gx++) {
        const lon = west + (gx / (gridSize - 1)) * (east - west);
        const xf = lonFn(lon, zoom);
        const yf = latFn(lat, zoom);
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
    const filled = (validCount === gridSize * gridSize)
      ? rawGrid
      : (validCount > 0 ? fillDemVoidsNearestO_G2(rawGrid, validMask, gridSize, avgValidElev) : new Float64Array(gridSize * gridSize));

    const grid = [];
    let minElev = Infinity;
    let maxElev = -Infinity;
    for (let gy = 0; gy < gridSize; gy++) {
      const row = new Array(gridSize);
      const base = gy * gridSize;
      for (let gx = 0; gx < gridSize; gx++) {
        const elev = filled[base + gx];
        row[gx] = Math.round(elev * 100) / 100;
        if (elev < minElev) minElev = elev;
        if (elev > maxElev) maxElev = elev;
      }
      grid.push(row);
    }

    if (!isFinite(minElev)) { minElev = 0; maxElev = 15; }
    const resolutionMeters = Math.round(((40075016 * cosLat) / (256 * Math.pow(2, zoom))) * 10) / 10;
    if (_diag && typeof _diag.recordFetchDiagnosticEvent === 'function') {
      _diag.recordFetchDiagnosticEvent('dem-ready', { zoom, gridSize, validCount, minElev, maxElev });
    }
    return {
      gridSize,
      minElev,
      maxElev,
      grid,
      zoom,
      source: 'AWS Terrarium (USGS 3DEP 10m / LiDAR ~3-5m)',
      resolutionMeters,
    };
  }

  let fetchTerrariumDemInBrowser = async function (south, west, north, east, gridSize = 72, zoom = null) {
    if (_preloadedDemOverride) return _preloadedDemOverride;
    return fetchAdaptiveTerrariumDem(south, west, north, east, gridSize, zoom || null);
  };

  const exportsObj = {
    demLon2TileF,
    demLat2TileF,
    chooseAdaptiveDemZoom,
    fillDemVoidsNearestO_G2,
    fetchAdaptiveTerrariumDem,
    fetchTerrariumDemInBrowser,
    setDemPreloadedOverride,
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
