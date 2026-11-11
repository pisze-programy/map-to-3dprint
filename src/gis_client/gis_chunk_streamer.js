// ============================================================================
// src/gis_client/gis_chunk_streamer.js
// Progressive Multi-Chunk GIS Streamer, Preloaded Scene Assembly & Fallback
// ============================================================================

let _injectedGisPayload = null;

if (typeof fetchTerrariumDemInBrowser === 'function') {
  fetchTerrariumDemInBrowser = async function (south, west, north, east, gridSize = 72) {
    if (_injectedGisPayload && _injectedGisPayload.dem) return _injectedGisPayload.dem;
    return fetchAdaptiveTerrariumDem(south, west, north, east, gridSize, null);
  };
}

if (typeof window !== 'undefined' && window.fetch) {
  const _savedFetch = (typeof _origWindowFetch === 'function') ? _origWindowFetch : window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === 'string'
      ? input
      : (input && typeof input.url === 'string'
          ? input.url
          : (input && typeof input.href === 'string'
              ? input.href
              : ''));
    const isHttp = !!(typeof window !== 'undefined' && window.location && /^https?:$/i.test(window.location.protocol));
    if (!isHttp && (
      url.startsWith('/') ||
      url.startsWith('cache/') ||
      url.startsWith('./') ||
      url.startsWith('file:') ||
      url.startsWith('file://')
    )) {
      return {
        ok: false,
        status: 404,
        statusText: 'File URI scheme does not support relative server fetch',
        json: async () => ({ error: 'File URI protocol' }),
        text: async () => 'File URI protocol'
      };
    }
    if (_injectedGisPayload && _injectedGisPayload.osmElements && url.includes('overpass')) {
      const payload = { elements: _injectedGisPayload.osmElements };
      return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload)
      };
    }
    const nativeFetch = typeof _origWindowFetch === 'function' ? _origWindowFetch : _savedFetch;
    return nativeFetch(input, init);
  };
}

async function buildSceneFromPreloadedGis(south, west, north, east, title, dem, osmElements, maxBuildings = 1850) {
  const prevPayload = _injectedGisPayload;
  _injectedGisPayload = { dem, osmElements };
  try {
    const scene = await fetchRealGISInBrowser(south, west, north, east, title);
    return filterPrintableBuildingsForScale(scene, maxBuildings);
  } finally {
    _injectedGisPayload = prevPayload;
  }
}

async function fetchChunkedGISInBrowser(south, west, north, east, title, options = {}) {
  const centerLat = (south + north) * 0.5;
  const centerLon = (west + east) * 0.5;
  const cosLat = Math.max(0.2, Math.cos(centerLat * Math.PI / 180.0));
  const spanNsM = Math.abs(north - south) * 111320.0;
  const spanEwM = Math.abs(east - west) * 111320.0 * cosLat;
  const maxSpanM = Math.max(spanEwM, spanNsM);

  const halfM = maxSpanM * 0.5;
  const sqDLat = halfM / 111320.0;
  const sqDLon = halfM / (111320.0 * cosLat);

  const { rows, cols, lodTier, chunks } = buildSpatialChunkGrid(south, west, north, east, maxSpanM);
  const totalChunks = chunks.length;
  const abortSignal = options.signal || null;

  if (typeof options.onProgress === 'function') {
    options.onProgress({
      loadedChunks: 0,
      totalChunks,
      pct: 8,
      statusText: totalChunks > 1
        ? `Pobieranie siatki ${rows}×${cols} (${totalChunks} sektorów • tryb ${lodTier.toUpperCase()})...`
        : `Pobieranie danych GIS + DEM (${(maxSpanM / 1000).toFixed(2)} km)...`
    });
  }

  const demPromise = fetchAdaptiveTerrariumDem(
    centerLat - sqDLat, centerLon - sqDLon, centerLat + sqDLat, centerLon + sqDLon, 72, null
  );

  const collectedChunkElements = [];
  let loadedChunks = 0, failedChunks = 0, partialRendered = false;

  for (let i = 0; i < chunks.length; i += 2) {
    if (abortSignal && abortSignal.aborted) break;
    const batch = chunks.slice(i, i + 2);
    const batchResults = await Promise.allSettled(
      batch.map(chunk => fetchChunkWithRecursiveSplit(chunk, abortSignal, (splitChunk) => {
        if (typeof options.onProgress === 'function') {
          options.onProgress({
            loadedChunks,
            totalChunks,
            pct: Math.min(92, Math.round(12 + (loadedChunks / totalChunks) * 75)),
            statusText: `Sektor ${splitChunk.id} duży — dzielenie na 2×2 pod-sektory...`
          });
        }
      }))
    );

    for (let bIdx = 0; bIdx < batchResults.length; bIdx++) {
      const res = batchResults[bIdx];
      if (res.status === 'fulfilled' && Array.isArray(res.value)) {
        collectedChunkElements.push(res.value);
        loadedChunks++;
      } else {
        failedChunks++;
        console.warn(`[GIS Chunk Streamer] Chunk ${batch[bIdx].id} failed:`, res.reason);
      }
    }

    const totalLoadedEls = collectedChunkElements.reduce((acc, a) => acc + a.length, 0);
    if (typeof options.onProgress === 'function') {
      options.onProgress({
        loadedChunks,
        totalChunks,
        pct: Math.min(92, Math.round(15 + ((loadedChunks + failedChunks) / totalChunks) * 75)),
        statusText: `Pobrano sektor ${loadedChunks}/${totalChunks} (${totalLoadedEls.toLocaleString()} obiektów OSM)...`
      });
    }

    if (
      !partialRendered &&
      totalChunks >= 4 &&
      loadedChunks >= Math.ceil(totalChunks * 0.5) &&
      loadedChunks < totalChunks &&
      typeof options.onPartialScene === 'function' &&
      !(abortSignal && abortSignal.aborted)
    ) {
      partialRendered = true;
      try {
        const demNow = await demPromise;
        const partialElements = mergeAndDeduplicateElements(collectedChunkElements, maxSpanM);
        const partialScene = await buildSceneFromPreloadedGis(
          south, west, north, east, `${title} (${loadedChunks}/${totalChunks})`, demNow, partialElements, 900
        );
        partialScene._isPartialPreview = true;
        options.onPartialScene(partialScene, loadedChunks, totalChunks);
      } catch (partialErr) {
        console.warn('[GIS Chunk Streamer] Partial preview skipped:', partialErr);
      }
    }
  }

  if (collectedChunkElements.length === 0) {
    if (abortSignal && abortSignal.aborted) {
      throw new Error('Przekroczono limit czasu oczekiwania na dane GIS po 20s');
    }
    console.warn('[GIS Chunk Streamer] Overpass unavailable, building terrain-only DEM scene fallback.');
    let dem = null;
    try {
      dem = await demPromise;
    } catch (e) {
      console.warn('DEM fetch error during fallback:', e);
    }
    if (dem) {
      const fallbackScene = {
        title: `${title || 'TEREN'} (DEM)`,
        center: [centerLat, centerLon],
        spanMeters: Math.round(maxSpanM),
        buildings: [],
        waterPolys: [],
        greenPolys: [],
        roads: [],
        roadPolys: [],
        bridgePolys: [],
        dem,
        _fallback: true
      };
      return fallbackScene;
    }
    throw new Error('Nie udało się pobrać danych GIS ani DEM.');
  }

  const dem = await demPromise;
  const mergedElements = mergeAndDeduplicateElements(collectedChunkElements, maxSpanM);

  if (typeof options.onProgress === 'function') {
    options.onProgress({
      loadedChunks,
      totalChunks,
      pct: 95,
      statusText: `Budowanie geometrii 3D (${mergedElements.length.toLocaleString()} elementów OSM)...`
    });
  }

  const maxBlds = maxSpanM > 4500 ? 1550 : 1950;
  const finalScene = await buildSceneFromPreloadedGis(south, west, north, east, title, dem, mergedElements, maxBlds);
  finalScene._chunkStats = { rows, cols, loadedChunks, totalChunks, lodTier, demZoom: dem.zoom || 14 };

  return finalScene;
}

if (typeof window !== 'undefined') {
  window.fetchChunkedGISInBrowser = fetchChunkedGISInBrowser;
}
