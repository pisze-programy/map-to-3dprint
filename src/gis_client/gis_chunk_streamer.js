// ============================================================================
// src/gis_client/gis_chunk_streamer.js
// Progressive Multi-Chunk GIS Streamer, Preloaded Scene Assembly & Fallback
// ============================================================================

const _gisSceneMemoryCache = new Map();
let _injectedGisPayload = null;

if (typeof fetchTerrariumDemInBrowser === 'function') {
  fetchTerrariumDemInBrowser = async function (south, west, north, east, gridSize = 72) {
    if (_injectedGisPayload && _injectedGisPayload.dem) return _injectedGisPayload.dem;
    return fetchAdaptiveTerrariumDem(south, west, north, east, gridSize, null);
  };
}

if (typeof window !== 'undefined' && window.fetch) {
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    if (_injectedGisPayload && _injectedGisPayload.osmElements && url.includes('overpass')) {
      const payload = { elements: _injectedGisPayload.osmElements };
      return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload)
      };
    }
    return _origWindowFetch(input, init);
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

  const sceneCacheKey = `v5_${south.toFixed(4)}_${west.toFixed(4)}_${north.toFixed(4)}_${east.toFixed(4)}`;
  if (!options.forceRefresh && _gisSceneMemoryCache.has(sceneCacheKey)) {
    const cached = JSON.parse(JSON.stringify(_gisSceneMemoryCache.get(sceneCacheKey)));
    cached.title = title || cached.title;
    if (typeof options.onProgress === 'function') {
      options.onProgress({
        loadedChunks: 1,
        totalChunks: 1,
        pct: 100,
        statusText: `Załadowano z pamięci podręcznej (${cached.buildings.length} bud.)`
      });
    }
    return cached;
  }

  if (!options.forceRefresh && typeof window !== 'undefined' && window.location && /^https?:$/.test(window.location.protocol)) {
    try {
      const apiUrl = `/api/gis?south=${south.toFixed(5)}&west=${west.toFixed(5)}&north=${north.toFixed(5)}&east=${east.toFixed(5)}&title=${encodeURIComponent(title || 'MAP3D')}`;
      const rApi = await _origWindowFetch(apiUrl, { signal: options.signal || undefined });
      if (rApi.ok) {
        const apiScene = await rApi.json();
        if (apiScene && Array.isArray(apiScene.buildings) && !apiScene.error) {
          const filtered = filterPrintableBuildingsForScale(apiScene, maxSpanM > 4500 ? 1550 : 1950);
          _gisSceneMemoryCache.set(sceneCacheKey, JSON.parse(JSON.stringify(filtered)));
          return filtered;
        }
      }
    } catch (_) {
      // Static host without /api/gis -> proceed with browser chunk streamer
    }
  }

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
    if (typeof options.onProgress === 'function') {
      options.onProgress({ loadedChunks: 0, totalChunks, pct: 50, statusText: `Próba pobrania przez lokalny serwer /api/gis...` });
    }
    const apiUrl = `/api/gis?south=${south.toFixed(5)}&west=${west.toFixed(5)}&north=${north.toFixed(5)}&east=${east.toFixed(5)}&title=${encodeURIComponent(title || 'MAP3D')}`;
    const r = await _origWindowFetch(apiUrl, { signal: abortSignal || undefined });
    if (!r.ok) throw new Error(`Nie udało się pobrać danych GIS (${r.status}).`);
    const scene = await r.json();
    if (scene && scene.error) throw new Error(scene.error);
    return filterPrintableBuildingsForScale(scene, 1850);
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

  if (failedChunks === 0 && !(abortSignal && abortSignal.aborted)) {
    try {
      _gisSceneMemoryCache.set(sceneCacheKey, JSON.parse(JSON.stringify(finalScene)));
      if (_gisSceneMemoryCache.size > 15) _gisSceneMemoryCache.delete(_gisSceneMemoryCache.keys().next().value);
    } catch (_) {}
  }
  return finalScene;
}

if (typeof window !== 'undefined') {
  window.fetchChunkedGISInBrowser = fetchChunkedGISInBrowser;
}
