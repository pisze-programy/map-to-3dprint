// ============================================================================
// src/gis_fetch/gis_stream_coordinator.js
// Progressive Multi-Chunk GIS Stream Coordinator & Targeted Pass-2 Recovery
// Layer 4b (Orchestrates Layers 0–4a)
// ============================================================================

(function (root) {
  function _deps() {
    let diag = typeof startFetchDiagnosticSession === 'function'
      ? { startFetchDiagnosticSession, recordFetchDiagnosticEvent, finishFetchDiagnosticSession }
      : null;
    let planner = typeof buildSpatialChunkGrid === 'function' ? { buildSpatialChunkGrid } : null;
    let demMod = typeof fetchAdaptiveTerrariumDem === 'function' ? { fetchAdaptiveTerrariumDem } : null;
    let cacheMod = typeof storeOverpassChunkCache === 'function' ? { storeOverpassChunkCache } : null;
    let merger = typeof mergeAndDeduplicateElements === 'function' ? { mergeAndDeduplicateElements } : null;
    let executor = typeof fetchChunkWithRecursiveSplit === 'function' ? { fetchChunkWithRecursiveSplit } : null;
    let handoff = typeof buildSceneFromPreloadedGis === 'function'
      ? { buildSceneFromPreloadedGis, buildTerrainOnlyFallbackScene }
      : null;

    if (typeof require === 'function') {
      if (!diag) try { diag = require('./fetch_diagnostics_trace.js'); } catch (_) {}
      if (!planner) planner = require('./spatial_bbox_grid_planner.js');
      if (!demMod) demMod = require('./dem_terrarium_fetcher.js');
      if (!cacheMod) cacheMod = require('./gis_chunk_cache.js');
      if (!merger) merger = require('./osm_element_merger.js');
      if (!executor) executor = require('./chunk_split_executor.js');
      if (!handoff) handoff = require('./preloaded_scene_handoff.js');
    }
    return { diag, planner, demMod, cacheMod, merger, executor, handoff };
  }

  function _waitAbortable(ms, abortSignal) {
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
  }

  function _formatSubChunkStatus(subChunk, phase, subDone, subTotal, subCount) {
    if (phase === 'start') return `Pobieranie pod-sektora ${subChunk.id} (${subDone}/${subTotal})...`;
    if (phase === 'retry-start') return `Ponawianie pod-sektora ${subChunk.id} (${subDone}/${subTotal})...`;
    if (phase === 'done' || phase === 'retry-done') {
      return `Pobrano pod-sektor ${subChunk.id} (${subDone}/${subTotal} • +${Number(subCount || 0).toLocaleString()} el.)...`;
    }
    if (phase === 'retry-queued' || phase === 'failed') return `Oczekiwanie na pod-sektor ${subChunk.id} (${subDone}/${subTotal})...`;
    return `Pod-sektor ${subChunk.id} (${subDone}/${subTotal})...`;
  }

  async function _retryMissingSubChunksPass2(entry, abortSignal, subRetryDelayMs, subChunkCallbacks, executor, cacheMod) {
    const mergedForEntry = Array.isArray(entry.partialElements) ? entry.partialElements.slice() : [];
    const stillMissingSubs = [];
    for (let sIdx = 0; sIdx < entry.missingSubChunks.length; sIdx++) {
      const sc = entry.missingSubChunks[sIdx];
      if (abortSignal && abortSignal.aborted) { stillMissingSubs.push(sc); continue; }
      if (sIdx > 0) await _waitAbortable(subRetryDelayMs, abortSignal);
      if (abortSignal && abortSignal.aborted) { stillMissingSubs.push(sc); continue; }
      subChunkCallbacks.onSubChunkProgress(sc, 'retry-start', sIdx, entry.missingSubChunks.length, 0);
      try {
        const subEls = await executor.fetchChunkWithRecursiveSplit(sc, abortSignal, subChunkCallbacks);
        if (Array.isArray(subEls)) {
          cacheMod.storeOverpassChunkCache(sc, subEls);
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
        } else stillMissingSubs.push(sc);
        subChunkCallbacks.onSubChunkProgress(sc, 'failed', sIdx, entry.missingSubChunks.length, 0);
      }
    }
    return { mergedForEntry, stillMissingSubs };
  }

  async function fetchChunkedGISInBrowser(south, west, north, east, title, options = {}) {
    if (![south, west, north, east].every(Number.isFinite) || south >= north || west >= east) {
      throw new Error('Nieprawidłowy zakres współrzędnych BBox GIS.');
    }
    const { diag, planner, demMod, cacheMod, merger, executor, handoff } = _deps();

    const centerLat = (south + north) * 0.5, centerLon = (west + east) * 0.5;
    const cosLat = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180.0));
    const spanNsM = Math.abs(north - south) * 111320.0, spanEwM = Math.abs(east - west) * 111320.0 * cosLat;
    const maxSpanM = Math.max(spanEwM, spanNsM);
    const effectiveSpanM = (options && Number(options.targetSpanMeters) > 0) ? Number(options.targetSpanMeters) : maxSpanM;

    const lodSettings = (options && options.lodSettings) || null;
    const spanKm = effectiveSpanM / 1000.0;
    const wantTrees = lodSettings ? (lodSettings.enableTrees !== false && spanKm <= (lodSettings.treeMaxSpanKm ?? 4.0)) : (spanKm <= 4.0);
    const minBldFootprintM = (lodSettings && typeof lodSettings.minBuildingFootprintM === 'number') ? lodSettings.minBuildingFootprintM : 0;
    const roadDetail = (lodSettings && lodSettings.roadDetail) || 'all';
    const lodQueryOpts = {
      wantTrees, minBuildingFootprintM: minBldFootprintM, roadDetail, fetchSpanMeters: maxSpanM,
      printTileCols: options && options.tileCols, printTileRows: options && options.tileRows,
      rotationDeg: options && options.rotationDeg,
    };
    const sceneOptions = {
      targetSpanMeters: effectiveSpanM, targetWidthMm: options && options.targetWidthMm,
      targetHeightMm: options && options.targetHeightMm, rotationDeg: options && options.rotationDeg,
      isResin: true, xyPixelMm: (options && options.xyPixelMm) || 0.017, lodSettings, _alreadyDeduplicated: true,
    };

    const halfM = maxSpanM * 0.5, sqDLat = halfM / 111320.0, sqDLon = halfM / (111320.0 * cosLat);
    const { rows, cols, lodTier, chunks } = planner.buildSpatialChunkGrid(south, west, north, east, effectiveSpanM, lodQueryOpts);
    const totalChunks = chunks.length, abortSignal = options.signal || null;
    const diagSession = diag ? diag.startFetchDiagnosticSession({ title, south, west, north, east, effectiveSpanM, rows, cols, totalChunks, lodTier }) : null;
    const emitProgress = (payload) => { if (typeof options.onProgress === 'function') options.onProgress(payload); };

    emitProgress({
      loadedChunks: 0, totalChunks, pct: 8, progressKind: 'init',
      statusText: totalChunks > 1
        ? `Pobieranie siatki ${rows}×${cols} (${totalChunks} sektorów • tryb ${lodTier.toUpperCase()})...`
        : `Pobieranie danych GIS + DEM (${(effectiveSpanM / 1000).toFixed(2)} km)...`,
    });

    const collectedChunkElements = [], failedChunkEntries = [];
    let loadedChunks = 0, failedChunks = 0, totalLoadedEls = 0, partialRendered = false, partialPreviewPromise = null;
    let nextChunkIdx = 0, streamCompleted = false, infraOutageCount = 0, proxyUnreachableCount = 0, outageCircuitTripped = false;

    const demGridSize = effectiveSpanM > 5500 ? 96 : 72;
    const demPromise = demMod.fetchAdaptiveTerrariumDem(centerLat - sqDLat, centerLon - sqDLon, centerLat + sqDLat, centerLon + sqDLon, demGridSize, null, abortSignal);
    demPromise.then((demData) => {
      if (abortSignal && abortSignal.aborted) return;
      emitProgress({
        loadedChunks, totalChunks, pct: Math.min(90, Math.round(10 + ((loadedChunks + failedChunks) / Math.max(1, totalChunks)) * 75)),
        progressKind: 'dem',
        statusText: loadedChunks > 0
          ? `Model wysokościowy DEM gotowy (Z=${demData && demData.zoom ? demData.zoom : 14}) • sektory ${loadedChunks}/${totalChunks}...`
          : `Pobrano model wysokościowy DEM • pobieranie sektorów OSM (0/${totalChunks})...`,
      });
    }).catch(() => {});

    const concurrency = Math.min(6, totalChunks);
    const subRetryDelayMs = (options && typeof options.subRetryDelayMs === 'number') ? options.subRetryDelayMs : 1200;
    const pass2RetryDelayMs = (options && typeof options.retryDelayMs === 'number') ? options.retryDelayMs : 1800;
    const partialPreviewDelayMs = (options && typeof options.partialPreviewDelayMs === 'number') ? options.partialPreviewDelayMs : 400;

    const subChunkCallbacks = {
      retryDelayMs: subRetryDelayMs,
      onSubSplit: (splitChunk) => {
        if (abortSignal && abortSignal.aborted) return;
        emitProgress({
          loadedChunks, totalChunks, pct: Math.min(92, Math.round(12 + ((loadedChunks + failedChunks) / totalChunks) * 75)),
          progressKind: 'split', statusText: `Sektor ${splitChunk.id} duży — dzielenie na 2×2 pod-sektory...`,
        });
      },
      onSubChunkProgress: (subChunk, phase, subDone, subTotal, subCount = 0) => {
        if (abortSignal && abortSignal.aborted) return;
        emitProgress({
          loadedChunks, totalChunks,
          pct: Math.min(93, Math.round(13 + ((loadedChunks + (subDone / Math.max(1, subTotal))) / Math.max(1, totalChunks)) * 75)),
          progressKind: 'subchunk', subChunkId: subChunk.id, subChunkPhase: phase,
          statusText: _formatSubChunkStatus(subChunk, phase, subDone, subTotal, subCount),
        });
      },
    };

    const runChunkWorker = async () => {
      while (nextChunkIdx < chunks.length) {
        if ((abortSignal && abortSignal.aborted) || outageCircuitTripped) break;
        const cIdx = nextChunkIdx++, chunk = chunks[cIdx];
        emitProgress({
          loadedChunks, totalChunks, pct: Math.min(90, Math.round(11 + ((loadedChunks + failedChunks) / totalChunks) * 75)),
          progressKind: 'chunk-start',
          statusText: totalChunks > 1 ? `Pobieranie sektora ${chunk.id} (${cIdx + 1}/${totalChunks})...` : `Pobieranie danych OSM (${(maxSpanM / 1000).toFixed(2)} km)...`,
        });
        let chunkSucceeded = false;
        try {
          const els = await executor.fetchChunkWithRecursiveSplit(chunk, abortSignal, subChunkCallbacks);
          if (Array.isArray(els)) {
            collectedChunkElements.push(els); loadedChunks++; totalLoadedEls += els.length; chunkSucceeded = true; infraOutageCount = 0;
          } else {
            failedChunks++;
            failedChunkEntries.push({ chunk, partialElements: null, missingSubChunks: null, failedSubChunkIds: [chunk.id] });
          }
        } catch (err) {
          failedChunks++;
          const hasPartial = Boolean(err && Array.isArray(err.partialElements) && err.partialElements.length > 0);
          if (err && err.proxyUnreachable) proxyUnreachableCount++;
          if (!hasPartial && err && (err.isInfraOutage || err.allFatalNetwork)) {
            infraOutageCount++;
            if (loadedChunks === 0 && totalLoadedEls === 0 && infraOutageCount >= Math.min(4, totalChunks)) {
              outageCircuitTripped = true;
            }
          }
          failedChunkEntries.push({
            chunk,
            partialElements: hasPartial ? err.partialElements : null,
            missingSubChunks: (err && Array.isArray(err.missingSubChunks) && err.missingSubChunks.length > 0) ? err.missingSubChunks : null,
            failedSubChunkIds: (err && Array.isArray(err.failedSubChunkIds) && err.failedSubChunkIds.length > 0) ? err.failedSubChunkIds : [chunk.id],
          });
          if (!(abortSignal && abortSignal.aborted)) console.warn(`[GIS Chunk Streamer] Chunk ${chunk.id} failed on pass 1:`, err);
        }
        if (abortSignal && abortSignal.aborted) break;
        emitProgress({
          loadedChunks, totalChunks, pct: Math.min(92, Math.round(15 + ((loadedChunks + failedChunks) / totalChunks) * 75)),
          progressKind: chunkSucceeded ? 'chunk' : 'chunk-failed',
          statusText: chunkSucceeded
            ? `Pobrano sektor ${loadedChunks}/${totalChunks} (${totalLoadedEls.toLocaleString()} obiektów OSM)...`
            : `Pominięto niedostępny sektor ${chunk.id} (${loadedChunks}/${totalChunks})...`,
        });

        if (!partialRendered && !streamCompleted && totalChunks >= 4 && loadedChunks >= Math.ceil(totalChunks * 0.5) &&
            loadedChunks < totalChunks && typeof options.onPartialScene === 'function' && !(abortSignal && abortSignal.aborted)) {
          partialRendered = true;
          const snapshotArrays = collectedChunkElements.slice(), snapLoaded = loadedChunks;
          partialPreviewPromise = (async () => {
            try {
              await _waitAbortable(partialPreviewDelayMs, abortSignal);
              if (streamCompleted || loadedChunks + failedChunks >= totalChunks || (abortSignal && abortSignal.aborted)) return;
              const demNow = await demPromise;
              if (streamCompleted || loadedChunks + failedChunks >= totalChunks || (abortSignal && abortSignal.aborted)) return;
              const partialElements = merger.mergeAndDeduplicateElements(snapshotArrays, effectiveSpanM, lodQueryOpts);
              const partialScene = await handoff.buildSceneFromPreloadedGis(south, west, north, east, `${title} (${snapLoaded}/${totalChunks})`, demNow, partialElements, Infinity, sceneOptions);
              partialScene._isPartialPreview = true;
              if (!streamCompleted && loadedChunks < totalChunks && !(abortSignal && abortSignal.aborted)) options.onPartialScene(partialScene, snapLoaded, totalChunks);
            } catch (partialErr) { console.warn('[GIS Chunk Streamer] Partial preview skipped:', partialErr); }
          })();
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => runChunkWorker()));
    for (let uIdx = nextChunkIdx; uIdx < chunks.length; uIdx++) {
      failedChunks++;
      failedChunkEntries.push({ chunk: chunks[uIdx], partialElements: null, missingSubChunks: null, failedSubChunkIds: [chunks[uIdx].id] });
    }

    const remainingFailed = [];
    for (let rIdx = 0; rIdx < failedChunkEntries.length; rIdx++) {
      const entry = failedChunkEntries[rIdx];
      if ((abortSignal && abortSignal.aborted) || outageCircuitTripped) { remainingFailed.push(entry); continue; }
      emitProgress({
        loadedChunks, totalChunks, pct: Math.min(93, Math.round(86 + ((rIdx + 1) / failedChunkEntries.length) * 6)),
        progressKind: 'chunk-retry', statusText: `Ponawianie sektora ${entry.chunk.id} (${rIdx + 1}/${failedChunkEntries.length})...`,
      });
      await _waitAbortable(pass2RetryDelayMs, abortSignal);
      if (abortSignal && abortSignal.aborted) { remainingFailed.push(entry); continue; }

      if (Array.isArray(entry.missingSubChunks) && entry.missingSubChunks.length > 0) {
        const { mergedForEntry, stillMissingSubs } = await _retryMissingSubChunksPass2(entry, abortSignal, subRetryDelayMs, subChunkCallbacks, executor, cacheMod);
        if (stillMissingSubs.length === 0) {
          cacheMod.storeOverpassChunkCache(entry.chunk, mergedForEntry);
          collectedChunkElements.push(mergedForEntry); loadedChunks++;
          failedChunks = Math.max(0, failedChunks - 1); totalLoadedEls += mergedForEntry.length;
        } else {
          remainingFailed.push({ chunk: entry.chunk, partialElements: mergedForEntry, missingSubChunks: stillMissingSubs, failedSubChunkIds: stillMissingSubs.map((s) => s.id) });
        }
      } else {
        try {
          const retryEls = await executor.fetchChunkWithRecursiveSplit(entry.chunk, abortSignal, subChunkCallbacks);
          if (Array.isArray(retryEls)) {
            collectedChunkElements.push(retryEls); loadedChunks++;
            failedChunks = Math.max(0, failedChunks - 1); totalLoadedEls += retryEls.length;
          } else remainingFailed.push(entry);
        } catch (retryErr) {
          remainingFailed.push({
            chunk: entry.chunk,
            partialElements: (retryErr && Array.isArray(retryErr.partialElements) && retryErr.partialElements.length > 0) ? retryErr.partialElements : entry.partialElements,
            missingSubChunks: (retryErr && Array.isArray(retryErr.missingSubChunks) && retryErr.missingSubChunks.length > 0) ? retryErr.missingSubChunks : entry.missingSubChunks,
            failedSubChunkIds: (retryErr && Array.isArray(retryErr.failedSubChunkIds) && retryErr.failedSubChunkIds.length > 0) ? retryErr.failedSubChunkIds : (entry.failedSubChunkIds || [entry.chunk.id]),
          });
        }
      }
    }

    const allMissingSubChunkIds = [], seenMissingSet = new Set();
    for (const rem of remainingFailed) {
      if (Array.isArray(rem.partialElements) && rem.partialElements.length > 0) collectedChunkElements.push(rem.partialElements);
      const ids = (Array.isArray(rem.failedSubChunkIds) && rem.failedSubChunkIds.length > 0) ? rem.failedSubChunkIds : (rem.chunk && rem.chunk.id ? [rem.chunk.id] : []);
      for (const id of ids) if (!seenMissingSet.has(id)) { seenMissingSet.add(id); allMissingSubChunkIds.push(id); }
    }

    streamCompleted = true;
    if (partialPreviewPromise) { try { await partialPreviewPromise; } catch (_) {} }

    if (collectedChunkElements.length === 0) {
      if (diag) diag.finishFetchDiagnosticSession('empty-or-aborted', { loadedChunks, failedChunks, outageCircuitTripped }, diagSession);
      if (abortSignal && abortSignal.aborted) throw new Error('Przekroczono limit czasu oczekiwania na dane GIS po 45s');
      let dem = null;
      try { dem = await demPromise; } catch (_) {}
      if (dem) {
        const fbScene = handoff.buildTerrainOnlyFallbackScene(title, centerLat, centerLon, effectiveSpanM, halfM, dem);
        if (proxyUnreachableCount > 0) fbScene._proxyUnreachable = true;
        return fbScene;
      }
      throw new Error('Nie udało się pobrać danych GIS ani DEM.');
    }

    const dem = await demPromise;
    const mergedElements = merger.mergeAndDeduplicateElements(collectedChunkElements, effectiveSpanM, lodQueryOpts);
    if (diag) diag.recordFetchDiagnosticEvent('merge-done', { dedupedElements: mergedElements.length }, diagSession);
    emitProgress({ loadedChunks, totalChunks, pct: 95, progressKind: 'assemble', statusText: `Budowanie geometrii 3D (${mergedElements.length.toLocaleString()} elementów OSM)...` });

    const maxBlds = (options && Number.isFinite(options.maxBuildings) && options.maxBuildings > 0) ? options.maxBuildings : Infinity;
    const finalScene = await handoff.buildSceneFromPreloadedGis(south, west, north, east, title, dem, mergedElements, maxBlds, sceneOptions);
    const effectiveFailedCount = (failedChunks > 0 || allMissingSubChunkIds.length > 0) ? Math.max(1, failedChunks) : 0;
    finalScene._chunkStats = { rows, cols, loadedChunks, failedChunks: effectiveFailedCount, totalChunks, lodTier, demZoom: dem.zoom || 14, missingSubChunkIds: allMissingSubChunkIds };
    finalScene._partialIncomplete = effectiveFailedCount > 0;
    finalScene._failedChunkCount = effectiveFailedCount;
    finalScene._totalChunkCount = totalChunks;
    finalScene._missingSubChunkIds = effectiveFailedCount > 0 ? allMissingSubChunkIds : [];
    if (diag) diag.finishFetchDiagnosticSession(effectiveFailedCount > 0 ? 'partial' : 'ok', { loadedChunks, failedChunks: effectiveFailedCount, totalChunks, buildings: finalScene.buildings.length }, diagSession);
    return finalScene;
  }

  const exportsObj = { fetchChunkedGISInBrowser };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
