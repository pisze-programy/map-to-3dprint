// ============================================================================
// src/gis_fetch/chunk_split_executor.js
// Bounded-DAG 2x2 Subchunk Split & Targeted Retry Executor (Mathematically Loop-Free)
// Layer 3 (Depends on Layers 0–2: grid planner, QL builder, cache, mirror router)
// ============================================================================

(function (root) {
  function _deps() {
    let diag = typeof recordFetchDiagnosticEvent === 'function' ? { recordFetchDiagnosticEvent } : null;
    let planner = typeof subdivideChunk2x2 === 'function'
      ? { subdivideChunk2x2, getChunkCanonicalBBoxKey, MAX_CHUNK_SPLIT_DEPTH }
      : null;
    let ql = typeof buildAdaptiveOverpassQL === 'function' ? { buildAdaptiveOverpassQL } : null;
    let cache = typeof getCachedOverpassChunk === 'function'
      ? { getCachedOverpassChunk, storeOverpassChunkCache }
      : null;
    let router = typeof fetchSingleOverpassQuery === 'function' ? { fetchSingleOverpassQuery } : null;

    if (typeof require === 'function') {
      if (!diag) try { diag = require('./fetch_diagnostics_trace.js'); } catch (_) {}
      if (!planner) planner = require('./spatial_bbox_grid_planner.js');
      if (!ql) ql = require('./overpass_ql_builder.js');
      if (!cache) cache = require('./gis_chunk_cache.js');
      if (!router) router = require('./overpass_mirror_router.js');
    }
    return { diag, planner, ql, cache, router };
  }

  function _abortableDelay(ms, abortSignal) {
    if (!ms || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      if (abortSignal && abortSignal.aborted) { resolve(); return; }
      let timer = null;
      const onAbort = () => {
        if (timer !== null) clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(() => {
        if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      if (abortSignal) abortSignal.addEventListener('abort', onAbort, { once: true });
    });
  }

  async function _executeChunkNode(chunk, abortSignal, callbacks, visitedBBoxKeys) {
    const { diag, planner, ql, cache, router } = _deps();
    const onSubSplit = typeof callbacks === 'function'
      ? callbacks
      : (callbacks && typeof callbacks.onSubSplit === 'function' ? callbacks.onSubSplit : null);
    const onSubChunkProgress = (callbacks && typeof callbacks === 'object' && typeof callbacks.onSubChunkProgress === 'function')
      ? callbacks.onSubChunkProgress
      : null;
    const onSubChunkDone = (callbacks && typeof callbacks === 'object' && typeof callbacks.onSubChunkDone === 'function')
      ? callbacks.onSubChunkDone
      : null;
    const retryDelayMs = (callbacks && typeof callbacks === 'object' && typeof callbacks.retryDelayMs === 'number')
      ? callbacks.retryDelayMs
      : 1200;

    const cached = cache.getCachedOverpassChunk(chunk);
    if (cached !== undefined) {
      if (diag) diag.recordFetchDiagnosticEvent('cache-hit', { chunkId: chunk.id });
      return cached;
    }

    const bboxKey = planner.getChunkCanonicalBBoxKey(chunk);
    const lo = chunk.lodOptions || null;
    const curDepth = Number(chunk.depth) || 0;
    const timeoutSec = curDepth === 0 ? 20 : 16;
    const perAttemptMs = curDepth === 0 ? 25000 : 22000;
    const query = ql.buildAdaptiveOverpassQL(chunk.south, chunk.west, chunk.north, chunk.east, chunk.lodTier, timeoutSec, lo);

    try {
      const elements = await router.fetchSingleOverpassQuery(query, perAttemptMs, abortSignal);
      cache.storeOverpassChunkCache(chunk, elements);
      if (diag) diag.recordFetchDiagnosticEvent('chunk-ok', { chunkId: chunk.id, depth: curDepth, elements: elements.length });
      return elements;
    } catch (err) {
      if (abortSignal && abortSignal.aborted) throw err;
      const isFatalNetwork = Boolean(err && err.allFatalNetwork);

      // Strict cycle + depth + minimum-span guard: guarantees finite DAG termination
      if (!isFatalNetwork && curDepth < planner.MAX_CHUNK_SPLIT_DEPTH && !visitedBBoxKeys.has(bboxKey)) {
        const subChunks = planner.subdivideChunk2x2(chunk).filter(
          (sc) => !visitedBBoxKeys.has(planner.getChunkCanonicalBBoxKey(sc))
        );
        if (subChunks.length > 0) {
          const childVisited = new Set(visitedBBoxKeys);
          childVisited.add(bboxKey);
          if (onSubSplit) onSubSplit(chunk);
          if (diag) diag.recordFetchDiagnosticEvent('sub-split', { chunkId: chunk.id, depth: curDepth, children: subChunks.length });

          const mergedSub = [];
          const failedSubs = [];
          const cascadedMissingLeaves = [];
          let subCursor = 0;
          let subDoneCount = 0;

          const subWorker = async () => {
            while (subCursor < subChunks.length) {
              if (abortSignal && abortSignal.aborted) break;
              const sc = subChunks[subCursor++];
              if (onSubChunkProgress) onSubChunkProgress(sc, 'start', subDoneCount, subChunks.length, 0);
              try {
                const subEls = await _executeChunkNode(sc, abortSignal, callbacks, childVisited);
                if (Array.isArray(subEls)) {
                  cache.storeOverpassChunkCache(sc, subEls);
                  for (let k = 0; k < subEls.length; k++) mergedSub.push(subEls[k]);
                  subDoneCount++;
                  if (onSubChunkProgress) onSubChunkProgress(sc, 'done', subDoneCount, subChunks.length, subEls.length);
                  if (onSubChunkDone) onSubChunkDone(sc, subEls.length, subDoneCount, subChunks.length);
                } else {
                  failedSubs.push(sc);
                  if (onSubChunkProgress) onSubChunkProgress(sc, 'retry-queued', subDoneCount, subChunks.length, 0);
                }
              } catch (subErr) {
                if (subErr && Array.isArray(subErr.partialElements)) {
                  for (let k = 0; k < subErr.partialElements.length; k++) mergedSub.push(subErr.partialElements[k]);
                }
                if (subErr && Array.isArray(subErr.missingSubChunks) && subErr.missingSubChunks.length > 0) {
                  // Child already subdivided and retried its own leaves once — propagate upward without O(d*4^d) ancestor re-retry cascade
                  for (const msc of subErr.missingSubChunks) cascadedMissingLeaves.push(msc);
                } else {
                  failedSubs.push(sc);
                }
                if (onSubChunkProgress) onSubChunkProgress(sc, 'retry-queued', subDoneCount, subChunks.length, 0);
              }
            }
          };

          const subConc = 2;
          await Promise.all(Array.from({ length: subConc }, () => subWorker()));
          if (subCursor < subChunks.length) {
            for (let remIdx = subCursor; remIdx < subChunks.length; remIdx++) {
              failedSubs.push(subChunks[remIdx]);
            }
          }

          if (failedSubs.length > 0 || cascadedMissingLeaves.length > 0) {
            const stillFailed = cascadedMissingLeaves.slice();
            for (let fIdx = 0; fIdx < failedSubs.length; fIdx++) {
              const sc = failedSubs[fIdx];
              if (abortSignal && abortSignal.aborted) { stillFailed.push(sc); continue; }
              await _abortableDelay(retryDelayMs, abortSignal);
              if (abortSignal && abortSignal.aborted) { stillFailed.push(sc); continue; }
              if (diag) diag.recordFetchDiagnosticEvent('retry', { chunkId: sc.id, depth: sc.depth });
              if (onSubChunkProgress) onSubChunkProgress(sc, 'retry-start', subDoneCount, subChunks.length, 0);
              try {
                const subEls = await _executeChunkNode(sc, abortSignal, callbacks, childVisited);
                if (Array.isArray(subEls)) {
                  cache.storeOverpassChunkCache(sc, subEls);
                  for (let k = 0; k < subEls.length; k++) mergedSub.push(subEls[k]);
                  subDoneCount++;
                  if (onSubChunkProgress) onSubChunkProgress(sc, 'retry-done', subDoneCount, subChunks.length, subEls.length);
                  if (onSubChunkDone) onSubChunkDone(sc, subEls.length, subDoneCount, subChunks.length);
                } else {
                  stillFailed.push(sc);
                  if (onSubChunkProgress) onSubChunkProgress(sc, 'failed', subDoneCount, subChunks.length, 0);
                }
              } catch (retryErr) {
                if (retryErr && Array.isArray(retryErr.partialElements)) {
                  for (let k = 0; k < retryErr.partialElements.length; k++) mergedSub.push(retryErr.partialElements[k]);
                }
                if (retryErr && Array.isArray(retryErr.missingSubChunks) && retryErr.missingSubChunks.length > 0) {
                  for (const msc of retryErr.missingSubChunks) stillFailed.push(msc);
                } else {
                  stillFailed.push(sc);
                }
                if (onSubChunkProgress) onSubChunkProgress(sc, 'failed', subDoneCount, subChunks.length, 0);
              }
            }
            if (stillFailed.length === 0) {
              cache.storeOverpassChunkCache(chunk, mergedSub);
              return mergedSub;
            }
            const partialErr = new Error(`Incomplete sub-chunk split (${stillFailed.length}/${subChunks.length} failed)`);
            partialErr.partialElements = mergedSub;
            partialErr.missingSubChunks = stillFailed;
            partialErr.failedSubChunkIds = stillFailed.map((s) => s.id);
            throw partialErr;
          }

          if (subDoneCount === subChunks.length) {
            cache.storeOverpassChunkCache(chunk, mergedSub);
            return mergedSub;
          }
        }
      }
      if (diag) diag.recordFetchDiagnosticEvent('chunk-fail', { chunkId: chunk.id, depth: curDepth, error: String(err && err.message ? err.message : err) });
      throw err;
    }
  }

  async function fetchChunkWithRecursiveSplit(chunk, abortSignal = null, callbacks = null) {
    return _executeChunkNode(chunk, abortSignal, callbacks, new Set());
  }

  const fetchOverpassChunkWithSplitJS = fetchChunkWithRecursiveSplit;

  const exportsObj = {
    fetchChunkWithRecursiveSplit,
    fetchOverpassChunkWithSplitJS,
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
