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
    if (_injectedGisPayload && _injectedGisPayload.osmElements && (url.includes('overpass') || url.includes('interpreter'))) {
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

async function buildSceneFromPreloadedGis(south, west, north, east, title, dem, osmElements, maxBuildings = 1850, sceneOptions = {}) {
  const prevPayload = _injectedGisPayload;
  _injectedGisPayload = { dem, osmElements };
  try {
    const scene = await fetchRealGISInBrowser(south, west, north, east, title, sceneOptions);
    const filtered = filterPrintableBuildingsForScale(scene, maxBuildings);
    if (filtered && filtered._priorityBedCheck) delete filtered._priorityBedCheck;
    return filtered;
  } finally {
    _injectedGisPayload = prevPayload;
  }
}

async function fetchChunkedGISInBrowser(south, west, north, east, title, options = {}) {
  if (![south, west, north, east].every(Number.isFinite) || south >= north || west >= east) {
    throw new Error('Nieprawidłowy zakres współrzędnych BBox GIS.');
  }

  const centerLat = (south + north) * 0.5;
  const centerLon = (west + east) * 0.5;
  const cosLat = Math.max(0.2, Math.cos(centerLat * Math.PI / 180.0));
  const spanNsM = Math.abs(north - south) * 111320.0;
  const spanEwM = Math.abs(east - west) * 111320.0 * cosLat;
  const maxSpanM = Math.max(spanEwM, spanNsM);
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
  const lodQueryOpts = {
    wantTrees,
    minBuildingFootprintM: minBldFootprintM,
    roadDetail,
    fetchSpanMeters: maxSpanM
  };

  const sceneOptions = {
    targetSpanMeters: effectiveSpanM,
    targetWidthMm: options && options.targetWidthMm,
    targetHeightMm: options && options.targetHeightMm,
    rotationDeg: options && options.rotationDeg,
    isResin: true,
    xyPixelMm: (options && options.xyPixelMm) || 0.017,
    lodSettings
  };

  const halfM = maxSpanM * 0.5;
  const sqDLat = halfM / 111320.0;
  const sqDLon = halfM / (111320.0 * cosLat);

  const { rows, cols, lodTier, chunks } = buildSpatialChunkGrid(south, west, north, east, effectiveSpanM, lodQueryOpts);
  const totalChunks = chunks.length;
  const abortSignal = options.signal || null;

  if (typeof options.onProgress === 'function') {
    options.onProgress({
      loadedChunks: 0,
      totalChunks,
      pct: 8,
      progressKind: 'init',
      statusText: totalChunks > 1
        ? `Pobieranie siatki ${rows}×${cols} (${totalChunks} sektorów • tryb ${lodTier.toUpperCase()})...`
        : `Pobieranie danych GIS + DEM (${(effectiveSpanM / 1000).toFixed(2)} km)...`
    });
  }

  const collectedChunkElements = [];
  let loadedChunks = 0, failedChunks = 0, totalLoadedEls = 0, partialRendered = false;
  let partialPreviewPromise = null;

  const demPromise = fetchAdaptiveTerrariumDem(
    centerLat - sqDLat, centerLon - sqDLon, centerLat + sqDLat, centerLon + sqDLon, 72, null, abortSignal
  );
  demPromise.then((demData) => {
    if (abortSignal && abortSignal.aborted) return;
    if (typeof options.onProgress === 'function') {
      options.onProgress({
        loadedChunks,
        totalChunks,
        pct: Math.min(90, Math.round(10 + ((loadedChunks + failedChunks) / Math.max(1, totalChunks)) * 75)),
        progressKind: 'dem',
        statusText: loadedChunks > 0
          ? `Model wysokościowy DEM gotowy (Z=${demData && demData.zoom ? demData.zoom : 14}) • sektory ${loadedChunks}/${totalChunks}...`
          : `Pobrano model wysokościowy DEM • pobieranie sektorów OSM (0/${totalChunks})...`
      });
    }
  }).catch(() => {});

  const concurrency = Math.min(2, totalChunks);
  const subRetryDelayMs = (options && typeof options.subRetryDelayMs === 'number') ? options.subRetryDelayMs : 1200;
  const pass2RetryDelayMs = (options && typeof options.retryDelayMs === 'number') ? options.retryDelayMs : 1800;
  const partialPreviewDelayMs = (options && typeof options.partialPreviewDelayMs === 'number') ? options.partialPreviewDelayMs : 400;
  let nextChunkIdx = 0;
  let streamCompleted = false;
  const failedChunkEntries = [];

  const subChunkCallbacks = {
    retryDelayMs: subRetryDelayMs,
    onSubSplit: (splitChunk) => {
      if (abortSignal && abortSignal.aborted) return;
      if (typeof options.onProgress === 'function') {
        options.onProgress({
          loadedChunks,
          totalChunks,
          pct: Math.min(92, Math.round(12 + ((loadedChunks + failedChunks) / totalChunks) * 75)),
          progressKind: 'split',
          statusText: `Sektor ${splitChunk.id} duży — dzielenie na 2×2 pod-sektory...`
        });
      }
    },
    onSubChunkProgress: (subChunk, phase, subDone, subTotal, subCount = 0) => {
      if (abortSignal && abortSignal.aborted) return;
      if (typeof options.onProgress === 'function') {
        let statusText = `Pod-sektor ${subChunk.id} (${subDone}/${subTotal})...`;
        if (phase === 'start') {
          statusText = `Pobieranie pod-sektora ${subChunk.id} (${subDone}/${subTotal})...`;
        } else if (phase === 'retry-start') {
          statusText = `Ponawianie pod-sektora ${subChunk.id} (${subDone}/${subTotal})...`;
        } else if (phase === 'done' || phase === 'retry-done') {
          statusText = `Pobrano pod-sektor ${subChunk.id} (${subDone}/${subTotal} • +${Number(subCount || 0).toLocaleString()} el.)...`;
        } else if (phase === 'retry-queued' || phase === 'failed') {
          statusText = `Oczekiwanie na pod-sektor ${subChunk.id} (${subDone}/${subTotal})...`;
        }
        options.onProgress({
          loadedChunks,
          totalChunks,
          pct: Math.min(93, Math.round(13 + ((loadedChunks + (subDone / Math.max(1, subTotal))) / Math.max(1, totalChunks)) * 75)),
          progressKind: 'subchunk',
          subChunkId: subChunk.id,
          subChunkPhase: phase,
          statusText
        });
      }
    }
  };

  const _waitDelayAbortable = (ms) => {
    if (!ms || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      if (abortSignal && abortSignal.aborted) { resolve(); return; }
      let t = null;
      const onAbt = () => { if (t !== null) clearTimeout(t); resolve(); };
      t = setTimeout(() => {
        if (abortSignal) abortSignal.removeEventListener('abort', onAbt);
        resolve();
      }, ms);
      if (abortSignal) abortSignal.addEventListener('abort', onAbt, { once: true });
    });
  };

  const runChunkWorker = async () => {
    while (nextChunkIdx < chunks.length) {
      if (abortSignal && abortSignal.aborted) break;
      const cIdx = nextChunkIdx++;
      const chunk = chunks[cIdx];

      if (typeof options.onProgress === 'function') {
        options.onProgress({
          loadedChunks,
          totalChunks,
          pct: Math.min(90, Math.round(11 + ((loadedChunks + failedChunks) / totalChunks) * 75)),
          progressKind: 'chunk-start',
          statusText: totalChunks > 1
            ? `Pobieranie sektora ${chunk.id} (${cIdx + 1}/${totalChunks})...`
            : `Pobieranie danych OSM (${(maxSpanM / 1000).toFixed(2)} km)...`
        });
      }

      let chunkSucceeded = false;
      try {
        const els = await fetchChunkWithRecursiveSplit(chunk, abortSignal, subChunkCallbacks);

        if (Array.isArray(els)) {
          collectedChunkElements.push(els);
          loadedChunks++;
          totalLoadedEls += els.length;
          chunkSucceeded = true;
        } else {
          failedChunks++;
          failedChunkEntries.push({ chunk, partialElements: null, missingSubChunks: null, failedSubChunkIds: [chunk.id] });
        }
      } catch (err) {
        failedChunks++;
        failedChunkEntries.push({
          chunk,
          partialElements: (err && Array.isArray(err.partialElements)) ? err.partialElements : null,
          missingSubChunks: (err && Array.isArray(err.missingSubChunks) && err.missingSubChunks.length > 0) ? err.missingSubChunks : null,
          failedSubChunkIds: (err && Array.isArray(err.failedSubChunkIds) && err.failedSubChunkIds.length > 0) ? err.failedSubChunkIds : [chunk.id]
        });
        if (!(abortSignal && abortSignal.aborted)) {
          console.warn(`[GIS Chunk Streamer] Chunk ${chunk.id} failed on pass 1:`, err);
        }
      }

      if (abortSignal && abortSignal.aborted) break;

      if (typeof options.onProgress === 'function') {
        options.onProgress({
          loadedChunks,
          totalChunks,
          pct: Math.min(92, Math.round(15 + ((loadedChunks + failedChunks) / totalChunks) * 75)),
          progressKind: chunkSucceeded ? 'chunk' : 'chunk-failed',
          statusText: chunkSucceeded
            ? `Pobrano sektor ${loadedChunks}/${totalChunks} (${totalLoadedEls.toLocaleString()} obiektów OSM)...`
            : `Pominięto niedostępny sektor ${chunk.id} (${loadedChunks}/${totalChunks})...`
        });
      }

      if (
        !partialRendered &&
        !streamCompleted &&
        totalChunks >= 4 &&
        loadedChunks >= Math.ceil(totalChunks * 0.5) &&
        loadedChunks < totalChunks &&
        typeof options.onPartialScene === 'function' &&
        !(abortSignal && abortSignal.aborted)
      ) {
        partialRendered = true;
        const snapshotArrays = collectedChunkElements.slice();
        const snapLoaded = loadedChunks;
        partialPreviewPromise = (async () => {
          try {
            await _waitDelayAbortable(partialPreviewDelayMs);
            if (streamCompleted || loadedChunks + failedChunks >= totalChunks || (abortSignal && abortSignal.aborted)) return;
            const demNow = await demPromise;
            if (streamCompleted || loadedChunks + failedChunks >= totalChunks || (abortSignal && abortSignal.aborted)) return;
            const partialElements = mergeAndDeduplicateElements(snapshotArrays, effectiveSpanM, lodQueryOpts);
            const partialScene = await buildSceneFromPreloadedGis(
              south, west, north, east, `${title} (${snapLoaded}/${totalChunks})`, demNow, partialElements, 4500, sceneOptions
            );
            partialScene._isPartialPreview = true;
            if (!streamCompleted && loadedChunks < totalChunks && !(abortSignal && abortSignal.aborted)) {
              options.onPartialScene(partialScene, snapLoaded, totalChunks);
            }
          } catch (partialErr) {
            console.warn('[GIS Chunk Streamer] Partial preview skipped:', partialErr);
          }
        })();
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runChunkWorker()));
  if (nextChunkIdx < chunks.length) {
    for (let uIdx = nextChunkIdx; uIdx < chunks.length; uIdx++) {
      failedChunks++;
      failedChunkEntries.push({
        chunk: chunks[uIdx],
        partialElements: null,
        missingSubChunks: null,
        failedSubChunkIds: [chunks[uIdx].id]
      });
    }
  }

  // Pass 2: Sequential targeted retry (retries ONLY missing sub-chunks when parent chunk partially succeeded)
  const remainingFailed = [];
  if (failedChunkEntries.length > 0) {
    for (let rIdx = 0; rIdx < failedChunkEntries.length; rIdx++) {
      const entry = failedChunkEntries[rIdx];
      if (abortSignal && abortSignal.aborted) {
        remainingFailed.push(entry);
        continue;
      }
      if (typeof options.onProgress === 'function') {
        options.onProgress({
          loadedChunks,
          totalChunks,
          pct: Math.min(93, Math.round(86 + ((rIdx + 1) / failedChunkEntries.length) * 6)),
          progressKind: 'chunk-retry',
          statusText: `Ponawianie sektora ${entry.chunk.id} (${rIdx + 1}/${failedChunkEntries.length})...`
        });
      }
      await _waitDelayAbortable(pass2RetryDelayMs);
      if (abortSignal && abortSignal.aborted) {
        remainingFailed.push(entry);
        continue;
      }

      if (Array.isArray(entry.missingSubChunks) && entry.missingSubChunks.length > 0) {
        const mergedForEntry = Array.isArray(entry.partialElements) ? entry.partialElements.slice() : [];
        const stillMissingSubs = [];
        for (let sIdx = 0; sIdx < entry.missingSubChunks.length; sIdx++) {
          const sc = entry.missingSubChunks[sIdx];
          if (abortSignal && abortSignal.aborted) {
            stillMissingSubs.push(sc);
            continue;
          }
          if (sIdx > 0) await _waitDelayAbortable(subRetryDelayMs);
          if (abortSignal && abortSignal.aborted) {
            stillMissingSubs.push(sc);
            continue;
          }
          subChunkCallbacks.onSubChunkProgress(sc, 'retry-start', sIdx, entry.missingSubChunks.length, 0);
          try {
            const subEls = await fetchChunkWithRecursiveSplit(sc, abortSignal, subChunkCallbacks);
            if (Array.isArray(subEls)) {
              if (typeof storeOverpassChunkCache === 'function') storeOverpassChunkCache(sc, subEls);
              for (let k = 0; k < subEls.length; k++) mergedForEntry.push(subEls[k]);
              subChunkCallbacks.onSubChunkProgress(sc, 'retry-done', sIdx + 1, entry.missingSubChunks.length, subEls.length);
            } else {
              stillMissingSubs.push(sc);
              subChunkCallbacks.onSubChunkProgress(sc, 'failed', sIdx, entry.missingSubChunks.length, 0);
            }
          } catch (subRetryErr) {
            if (subRetryErr && Array.isArray(subRetryErr.partialElements)) {
              for (let k = 0; k < subRetryErr.partialElements.length; k++) mergedForEntry.push(subRetryErr.partialElements[k]);
            }
            if (subRetryErr && Array.isArray(subRetryErr.missingSubChunks) && subRetryErr.missingSubChunks.length > 0) {
              for (const msc of subRetryErr.missingSubChunks) stillMissingSubs.push(msc);
            } else {
              stillMissingSubs.push(sc);
            }
            subChunkCallbacks.onSubChunkProgress(sc, 'failed', sIdx, entry.missingSubChunks.length, 0);
          }
        }
        if (stillMissingSubs.length === 0) {
          if (typeof storeOverpassChunkCache === 'function') storeOverpassChunkCache(entry.chunk, mergedForEntry);
          collectedChunkElements.push(mergedForEntry);
          loadedChunks++;
          failedChunks = Math.max(0, failedChunks - 1);
          totalLoadedEls += mergedForEntry.length;
        } else {
          remainingFailed.push({
            chunk: entry.chunk,
            partialElements: mergedForEntry,
            missingSubChunks: stillMissingSubs,
            failedSubChunkIds: stillMissingSubs.map(s => s.id)
          });
        }
      } else {
        try {
          const retryEls = await fetchChunkWithRecursiveSplit(entry.chunk, abortSignal, subChunkCallbacks);
          if (Array.isArray(retryEls)) {
            collectedChunkElements.push(retryEls);
            loadedChunks++;
            failedChunks = Math.max(0, failedChunks - 1);
            totalLoadedEls += retryEls.length;
          } else {
            remainingFailed.push(entry);
          }
        } catch (retryErr) {
          const bestPartial = (retryErr && Array.isArray(retryErr.partialElements) && retryErr.partialElements.length > 0)
            ? retryErr.partialElements
            : entry.partialElements;
          const missingSubs = (retryErr && Array.isArray(retryErr.missingSubChunks) && retryErr.missingSubChunks.length > 0)
            ? retryErr.missingSubChunks
            : entry.missingSubChunks;
          const failedIds = (retryErr && Array.isArray(retryErr.failedSubChunkIds) && retryErr.failedSubChunkIds.length > 0)
            ? retryErr.failedSubChunkIds
            : (entry.failedSubChunkIds || [entry.chunk.id]);
          remainingFailed.push({
            chunk: entry.chunk,
            partialElements: bestPartial,
            missingSubChunks: missingSubs,
            failedSubChunkIds: failedIds
          });
        }
      }
    }
  }

  const allMissingSubChunkIds = [];
  for (const rem of remainingFailed) {
    if (Array.isArray(rem.partialElements) && rem.partialElements.length > 0) {
      collectedChunkElements.push(rem.partialElements);
    }
    if (Array.isArray(rem.failedSubChunkIds) && rem.failedSubChunkIds.length > 0) {
      for (const id of rem.failedSubChunkIds) {
        if (!allMissingSubChunkIds.includes(id)) allMissingSubChunkIds.push(id);
      }
    } else if (rem.chunk && rem.chunk.id && !allMissingSubChunkIds.includes(rem.chunk.id)) {
      allMissingSubChunkIds.push(rem.chunk.id);
    }
  }

  streamCompleted = true;

  if (partialPreviewPromise) {
    try { await partialPreviewPromise; } catch (_) {}
  }

  if (collectedChunkElements.length === 0) {
    if (abortSignal && abortSignal.aborted) {
      throw new Error('Przekroczono limit czasu oczekiwania na dane GIS po 45s');
    }
    console.warn('[GIS Chunk Streamer] Overpass unavailable, building terrain-only DEM scene fallback.');
    let dem = null;
    try {
      dem = await demPromise;
    } catch (e) {
      console.warn('DEM fetch error during fallback:', e);
    }
    if (dem) {
      const spanU = (typeof SCENE_CANONICAL_SPAN_UNITS !== 'undefined') ? SCENE_CANONICAL_SPAN_UNITS : 169.2;
      const mToU = spanU / Math.max(1, effectiveSpanM);
      const fallbackScene = {
        title: `${title || 'TEREN'} (DEM)`,
        center: [centerLat, centerLon],
        spanMeters: Math.round(effectiveSpanM),
        metersToUnits: mToU,
        _demHalfUnits: Math.round((halfM * mToU) * 100) / 100,
        buildings: [],
        waterPolys: [],
        waterLines: [],
        greenPolys: [],
        trees: [],
        roads: [],
        roadPolys: [],
        bridgePolys: [],
        pierPolys: [],
        pierLines: [],
        bridgeSupports: [],
        dem,
        _fallback: true
      };
      return fallbackScene;
    }
    throw new Error('Nie udało się pobrać danych GIS ani DEM.');
  }

  const dem = await demPromise;
  const mergedElements = mergeAndDeduplicateElements(collectedChunkElements, effectiveSpanM, lodQueryOpts);

  if (typeof options.onProgress === 'function') {
    options.onProgress({
      loadedChunks,
      totalChunks,
      pct: 95,
      progressKind: 'assemble',
      statusText: `Budowanie geometrii 3D (${mergedElements.length.toLocaleString()} elementów OSM)...`
    });
  }

  const isResin = true;
  const maxBlds = ((minBldFootprintM === 0 && effectiveSpanM <= 7500) || (isResin && effectiveSpanM <= 5500))
    ? (effectiveSpanM <= 2600 ? 12000 : 8500)
    : (effectiveSpanM > 12000 ? 2500 : 6000);
  const finalScene = await buildSceneFromPreloadedGis(south, west, north, east, title, dem, mergedElements, maxBlds, sceneOptions);
  const effectiveFailedCount = (failedChunks > 0 || allMissingSubChunkIds.length > 0)
    ? Math.max(1, failedChunks)
    : 0;
  finalScene._chunkStats = {
    rows,
    cols,
    loadedChunks,
    failedChunks: effectiveFailedCount,
    totalChunks,
    lodTier,
    demZoom: dem.zoom || 14,
    missingSubChunkIds: allMissingSubChunkIds
  };
  if (effectiveFailedCount > 0) {
    finalScene._partialIncomplete = true;
    finalScene._failedChunkCount = effectiveFailedCount;
    finalScene._totalChunkCount = totalChunks;
    finalScene._missingSubChunkIds = allMissingSubChunkIds;
  } else {
    finalScene._partialIncomplete = false;
    finalScene._failedChunkCount = 0;
    finalScene._totalChunkCount = totalChunks;
    finalScene._missingSubChunkIds = [];
  }

  return finalScene;
}

if (typeof window !== 'undefined') {
  window.fetchChunkedGISInBrowser = fetchChunkedGISInBrowser;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildSceneFromPreloadedGis,
    fetchChunkedGISInBrowser
  };
}
