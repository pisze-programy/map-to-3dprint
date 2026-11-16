// ============================================================================
// src/gis_client/overpass_chunk_grid.js
// Scale-Adaptive Overpass QL Builder, Spatial Chunk Grid, Hedged Multi-Mirror
// Fetcher & Recursive 2x2 Sub-Chunk Fallback
// ============================================================================

const _overpassChunkCache = new Map();
const _origWindowFetch = (typeof window !== 'undefined' && window.fetch) ? window.fetch.bind(window) : null;

function _resolveOverpassFetch() {
  if (typeof globalThis !== 'undefined' && typeof globalThis._overpassCustomFetch === 'function') {
    return globalThis._overpassCustomFetch;
  }
  if (_origWindowFetch) return _origWindowFetch;
  return fetch;
}

function getOverpassChunkCacheKey(chunk) {
  const lo = chunk.lodOptions || null;
  const lodKey = lo
    ? `t${lo.wantTrees === false ? 0 : 1}_b${Math.round(lo.minBuildingFootprintM || 0)}_r${lo.roadDetail || 'all'}`
    : 'def';
  return `v14_${chunk.lodTier}_${lodKey}_${chunk.south.toFixed(5)}_${chunk.west.toFixed(5)}_${chunk.north.toFixed(5)}_${chunk.east.toFixed(5)}`;
}

function storeOverpassChunkCache(chunk, elements) {
  if (!chunk || !Array.isArray(elements)) return;
  const key = getOverpassChunkCacheKey(chunk);
  _overpassChunkCache.set(key, elements);
  if (_overpassChunkCache.size > 256) {
    _overpassChunkCache.delete(_overpassChunkCache.keys().next().value);
  }
}

function clearOverpassChunkCache() {
  _overpassChunkCache.clear();
}

const OVERPASS_MIRRORS = [
  '/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];

let _mirrorRoundRobinIdx = 0;

function selectLodTier(spanMeters) {
  const s = Number(spanMeters) || 1200;
  if (s <= 1650) return 'detail';
  if (s <= 3800) return 'urban';
  if (s <= 7200) return 'regional';
  return 'mountain';
}

const _MP_EXCL_CONTINENTAL = '[!building][!"building:part"][!route][!boundary][!restriction][natural!~"^(bay$|stra|peninsula|cape|moun|mass|dese|vall|sea$|ridg)"][place!~"^(sea$|ocea|peni|arch|cont|coun|stat|regi)"]';
const _BR_VAL_RE = '^(yes|via|aqu|boa|can|cov|mov|sus|tre)';
const _MAJ_HWY_CORE = 'motor|(trun|prim|seco|tert).*|uncl|resi|livi';

function buildAdaptiveOverpassQL(south, west, north, east, lodTier = 'detail', timeoutSec = 20, lodOptions = null) {
  const bbox = `${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)}`;
  const wantTrees = (lodOptions && typeof lodOptions.wantTrees === 'boolean')
    ? lodOptions.wantTrees
    : (lodTier === 'detail' || lodTier === 'urban');
  const minBldM = (lodOptions && typeof lodOptions.minBuildingFootprintM === 'number')
    ? lodOptions.minBuildingFootprintM
    : 0;
  const roadDetail = (lodOptions && lodOptions.roadDetail) || 'all';

  const head = `[out:json][timeout:${timeoutSec}][bbox:${bbox}];way->.bw;rel(bw.bw)->.a;(.bw;.a;)->.c;` +
    `nw["bridge:support"]->.s;` +
    `(rel.a[type~"^(building|bridge)$"];rel.a[~"^(building(:part)?$|bridge:s)"~"."];wr.c[~"^(man_|attr)"~"^(bridge$|.*_wheel$)"];)->.k;rel.k->.b;rel(r.b)->.r;` +
    `rel.a[type=multipolygon]${_MP_EXCL_CONTINENTAL}->.mpr;(.bw;.mpr;)->.u;` +
    `wr.u[place~"^(isl|square$)"]->.i;rel.i->.isl;way(r.isl)->.islw;`;

  const treeN = ((lodTier === 'regional' || lodTier === 'mountain') ? (lodOptions && lodOptions.wantTrees === true) : wantTrees)
    ? 'node[natural=tree];'
    : '';
  const nwL2 = `nw[man_made][man_made~"^(wind_|(comm.*)?tower$|mast$|light|chim|cran)"]->.n;`;
  const foot = `(.r;.w;${treeN}node[power=generator][~":source$"~"^wind$"];node(r.b););out body qt;node(w.w);out skel qt;`;
  const bldClause = minBldM <= 0
    ? `way.bw[building];`
    : `way.bw[building][building!~"^(shed$|gara|hut$|cabi|kios|(all.*|green)house$|sty$|static|ger$)"];`;

  if (lodTier === 'detail') {
    const hwy = roadDetail === 'major'
      ? `way.bw[highway~"^(${_MAJ_HWY_CORE}|pede)"];way.bw[highway][bridge~"${_BR_VAL_RE}"];`
      : `way.bw[highway];`;
    const shared = `(wr.u[~"^(water(way)?|area:highway|building:p)"~"."];wr.u[~"^(natural|man_made|railway|public_transport)$"~"^(water$|wood$|scru|grass|heat|wetl|beach$|shin|shoa|mud$|bare|quay|pier|pont|brea|groy|jett|platf)"];rel.mpr[~"^(landuse|leisure|highway)$"~"^(reser|basi|fore|grass$|mead|(dog_)?park$|recr|ceme|vill|allo|farml|orch|vine|gard|natu|pitc|play|commo|golf|mari|swim.*p|pede)"];)->.x;`;
    const ways = `(.k;.i;.x;.s;.n;way.bw[~"^(building|landuse|leisure|railway)$"~"."];way.bw[~"^(natural|amenity|power|man_made)$"~"^(coast|tree_|fountain$|gener|(cool|stor).*_|silo$)"];${hwy}way(r.b);way(r.r);.islw;way.bw(r.x);)->.w;`;
    return head + nwL2 + shared + ways + foot;
  }
  if (lodTier === 'urban') {
    const hwy = roadDetail === 'major'
      ? `way.bw[highway~"^(${_MAJ_HWY_CORE}|pede)"];way.d[highway];`
      : `way.bw[highway~"^(${_MAJ_HWY_CORE}|pede|service$|cycl|foot|path$|step|trac|brid|corr)"];`;
    const brd = `way.bw[bridge~"${_BR_VAL_RE}"]->.d;`;
    const shared = `(wr.u[~"^(water(way)?|area:highway|building:p)"~"."];wr.u[highway=pedestrian];wr.u[~"^(natural|landuse|leisure|man_made|railway|public_transport)$"~"^(water$|wood$|scru|grass|heat|wetl|beach$|shin|shoa|mud$|bare|reser|basi|fore|mead|(dog_)?park$|recr|ceme|vill|allo|farml|orch|vine|gard|natu|pitc|play|commo|golf|mari|swim.*p|quay|pier|pont|brea|groy|jett|platf)"];)->.x;`;
    const ways = `${brd}(.k;.i;.x;.s;.n;${bldClause}${hwy}way.bw[~"^(natural|amenity|railway|power|man_made)$"~"^(coast|tree_|fountain$|(light_)?rail$|tram$|narro|funic|gener|(cool|stor).*_|silo$)"];way.d[railway~"^(mono|subw)"];way(r.b);way(r.r);.islw;way.bw(r.x);)->.w;`;
    return head + nwL2 + shared + ways + foot;
  }

  // Regional & wide-span ('mountain') tiers: zero artificial stripping of buildings, building:part, streets, or parks.
  // Scale handling is achieved cleanly via finer spatial tiling in buildSpatialChunkGrid + recursive 2x2 splitting.
  const natPart = (lodOptions && lodOptions.wantTrees === true) ? 'coast|tree_' : 'coast';
  const hwy = roadDetail === 'major'
    ? `way.bw[highway~"^(${_MAJ_HWY_CORE}|pede)"];`
    : `way.bw[highway~"^(${_MAJ_HWY_CORE}|pede|service$|path$|cycl|step|trac|brid|corr)"];way.bw[highway=footway][footway!~"^(sid|cro|acc|isl)"];`;
  const brd = `way.bw[bridge~"${_BR_VAL_RE}"]->.d;`;
  const shared = `(wr.u[~"^(water(way)?|area:highway|building:p)"~"."];wr.u[~"^(nat|lan|lei|man_|railw|pub)"~"^(water$|wood$|scru|grass|heat|wetl|beach$|shin|shoa|mud$|bare|reser|basi|fore|mead|(dog_)?park$|recr|ceme|vill|allo|farml|orch|vine|gard|natu|pitc|play|commo|golf|mari|swim.*p|quay|pier|pont|brea|groy|jett|platf)"];rel.mpr[highway=pedestrian];)->.x;`;
  const ways = `${brd}(.k;.i;.x;.s;.n;${bldClause}${hwy}way.d[highway];way.bw[~"^(nat|amen|railw|pow|man_)"~"^(${natPart}|fountain$|(light_)?rail$|tram$|narro|funic|gener|(cool|stor).*_|silo$)"];way.d[railway~"^(mono|subw)"];way(r.b);way(r.r);.islw;way.bw(r.x);)->.w;`;
  return head + nwL2 + shared + ways + foot;
}

const TARGET_CHUNK_SPAN_METERS = 2300;

function buildSpatialChunkGrid(south, west, north, east, spanMeters, lodOptions = null) {
  const s = Number(spanMeters) || 1200;
  const midLat = (south + north) * 0.5;
  const cosLat = Math.max(0.2, Math.cos(midLat * Math.PI / 180));
  const bboxNsM = Math.abs(north - south) * 111320;
  const bboxEwM = Math.abs(east - west) * 111320 * cosLat;
  const fetchSpan = (lodOptions && Number(lodOptions.fetchSpanMeters) > 0)
    ? Number(lodOptions.fetchSpanMeters)
    : Math.max(s, bboxNsM, bboxEwM);
  const lodTier = selectLodTier(s);
  let rows = 1, cols = 1;
  if (fetchSpan > 3600) {
    const effNs = bboxNsM > 10 ? bboxNsM : fetchSpan;
    const effEw = bboxEwM > 10 ? bboxEwM : fetchSpan;
    rows = Math.max(2, Math.ceil(effNs / TARGET_CHUNK_SPAN_METERS));
    cols = Math.max(2, Math.ceil(effEw / TARGET_CHUNK_SPAN_METERS));
  } else if (fetchSpan > 1650) {
    rows = 2;
    cols = 2;
  }
  const dLat = (north - south) / rows;
  const dLon = (east - west) / cols;
  const padLat = rows > 1 ? dLat * 0.015 : 0;
  const padLon = cols > 1 ? dLon * 0.015 : 0;

  const centerLat = (south + north) * 0.5;
  const centerLon = (west + east) * 0.5;
  const chunks = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cSouth = Math.max(south, south + r * dLat - padLat);
      const cNorth = Math.min(north, south + (r + 1) * dLat + padLat);
      const cWest = Math.max(west, west + c * dLon - padLon);
      const cEast = Math.min(east, west + (c + 1) * dLon + padLon);
      const midLat = (cSouth + cNorth) * 0.5;
      const midLon = (cWest + cEast) * 0.5;
      chunks.push({
        id: `R${r + 1}C${c + 1}`,
        south: cSouth, west: cWest, north: cNorth, east: cEast,
        lodTier,
        lodOptions: lodOptions || null,
        totalChunks: rows * cols,
        distCenter: Math.hypot(midLat - centerLat, midLon - centerLon),
        depth: 0
      });
    }
  }
  chunks.sort((a, b) => a.distCenter - b.distCenter);
  return { rows, cols, lodTier, chunks };
}

function getPrioritizedOverpassMirrors() {
  const isHttpOrigin = typeof window === 'undefined' || !window.location || /^https?:$/i.test(window.location.protocol);
  const primary = [];
  if (isHttpOrigin) primary.push('/api/interpreter');
  const secondaryPool = OVERPASS_MIRRORS.filter(m => !primary.includes(m));
  const rot = (_mirrorRoundRobinIdx++) % Math.max(1, secondaryPool.length);
  const rotatedSecondary = secondaryPool.map((_, i) => secondaryPool[(rot + i) % secondaryPool.length]);
  return primary.concat(rotatedSecondary);
}

async function fetchSingleOverpassQuery(query, timeoutMs = 12500, abortSignal = null) {
  const orderedMirrors = getPrioritizedOverpassMirrors();
  const activeControllers = new Set();

  const abortAllActive = () => {
    for (const c of activeControllers) {
      try { c.abort(); } catch (_) {}
    }
    activeControllers.clear();
  };

  const attemptMirror = async (ep, perMirrorTimeoutMs) => {
    const ctrl = new AbortController();
    activeControllers.add(ctrl);
    let timedOutLocal = false;
    const timer = setTimeout(() => {
      timedOutLocal = true;
      try { ctrl.abort(); } catch (_) {}
    }, perMirrorTimeoutMs);
    const onParentAbort = () => { try { ctrl.abort(); } catch (_) {} };
    if (abortSignal) {
      if (abortSignal.aborted) {
        clearTimeout(timer);
        activeControllers.delete(ctrl);
        throw new Error('Aborted');
      }
      abortSignal.addEventListener('abort', onParentAbort, { once: true });
    }
    try {
      const fetchFn = _resolveOverpassFetch();
      const r = await fetchFn(ep, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        signal: ctrl.signal
      });
      if (!r.ok) {
        const httpErr = new Error(`HTTP ${r.status}`);
        httpErr.status = r.status;
        throw httpErr;
      }
      const text = await r.text();
      const trimmed = text ? text.trim() : '';
      if (!trimmed || trimmed.startsWith('<') || trimmed.startsWith('#')) {
        throw new Error('Overpass XML/HTML rate-limit');
      }
      const j = JSON.parse(trimmed);
      if (!j || !Array.isArray(j.elements)) throw new Error('Invalid Overpass JSON');
      if (j.remark && String(j.remark).trim().length > 0) {
        const rem = String(j.remark).trim();
        const isProxy = typeof j.generator === 'string' && /proxy/i.test(j.generator);
        const remErr = new Error(`Overpass remark: ${rem}`);
        if (isProxy) {
          remErr.isProxyTimeout = true;
          remErr.isTimeout = true;
        }
        if (/timed out|out of memory|runtime error|split\s*2x2/i.test(rem)) {
          remErr.isQueryTooHeavy = true;
        }
        throw remErr;
      }
      return j.elements;
    } catch (err) {
      if (timedOutLocal && !(abortSignal && abortSignal.aborted)) {
        const tErr = new Error(`Mirror timeout (${perMirrorTimeoutMs}ms)`);
        tErr.isTimeout = true;
        throw tErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      activeControllers.delete(ctrl);
      if (abortSignal) abortSignal.removeEventListener('abort', onParentAbort);
    }
  };

  return new Promise((resolve, reject) => {
    let settled = false, pending = 0, nextMirrorIdx = 0, stopLaunchingMore = false;
    const errors = [], rawErrors = [], hedgeTimers = [];
    const clearHedges = () => { while (hedgeTimers.length) clearTimeout(hedgeTimers.pop()); };

    const finishReject = () => {
      if (settled) return;
      settled = true;
      clearHedges();
      abortAllActive();
      const combined = new Error(`Mirrors failed: ${errors.join(', ')}`);
      combined.allFatalNetwork = rawErrors.length > 0 && rawErrors.every(e => {
        const m = String(e && e.message ? e.message : e);
        return (
          !e.isTimeout &&
          !e.isQueryTooHeavy &&
          (m.includes('Failed to fetch') || m.includes('NetworkError') || m.includes('ECONNREFUSED') || m.includes('ENOTFOUND') || m.includes('Load failed'))
        );
      });
      reject(combined);
    };

    const launchNext = () => {
      if (settled || stopLaunchingMore || nextMirrorIdx >= orderedMirrors.length) return;
      if (abortSignal && abortSignal.aborted) {
        settled = true;
        clearHedges();
        abortAllActive();
        reject(new Error('Aborted'));
        return;
      }
      const ep = orderedMirrors[nextMirrorIdx++];
      pending++;
      const attemptMs = ep === '/api/interpreter' ? Math.max(timeoutMs, 35000) : timeoutMs;
      attemptMirror(ep, attemptMs)
        .then((elements) => {
          if (settled) return;
          settled = true;
          clearHedges();
          abortAllActive();
          resolve(elements);
        })
        .catch((err) => {
          if (abortSignal && abortSignal.aborted) {
            if (!settled) {
              settled = true;
              clearHedges();
              abortAllActive();
              reject(new Error('Aborted'));
            }
            return;
          }
          rawErrors.push(err);
          errors.push(err && err.message ? err.message : String(err));
          pending--;
          if (settled) return;
          if (err && err.isQueryTooHeavy) {
            stopLaunchingMore = true;
            clearHedges();
            abortAllActive();
            finishReject();
            return;
          }
          if (!stopLaunchingMore && nextMirrorIdx < orderedMirrors.length) {
            launchNext();
            if (ep === '/api/interpreter' && !(err && err.isProxyTimeout)) {
              hedgeTimers.push(setTimeout(() => { if (!settled && !stopLaunchingMore && nextMirrorIdx < orderedMirrors.length) launchNext(); }, 2200));
              hedgeTimers.push(setTimeout(() => { if (!settled && !stopLaunchingMore && nextMirrorIdx < orderedMirrors.length) launchNext(); }, 4500));
            }
          } else if (pending === 0) {
            finishReject();
          }
        });
    };

    const startsWithLocalProxy = orderedMirrors[0] === '/api/interpreter';
    launchNext();
    if (!startsWithLocalProxy) {
      hedgeTimers.push(setTimeout(() => { if (!settled && !stopLaunchingMore && nextMirrorIdx < orderedMirrors.length) launchNext(); }, 2200));
      hedgeTimers.push(setTimeout(() => { if (!settled && !stopLaunchingMore && nextMirrorIdx < orderedMirrors.length) launchNext(); }, 4500));
      hedgeTimers.push(setTimeout(() => { if (!settled && !stopLaunchingMore && nextMirrorIdx < orderedMirrors.length) launchNext(); }, 7500));
    }
  });
}

function _abortableDelay(ms, abortSignal) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    if (abortSignal && abortSignal.aborted) {
      resolve();
      return;
    }
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

async function fetchChunkWithRecursiveSplit(chunk, abortSignal = null, callbacks = null) {
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

  const lo = chunk.lodOptions || null;
  const cacheKey = getOverpassChunkCacheKey(chunk);
  if (_overpassChunkCache.has(cacheKey)) return _overpassChunkCache.get(cacheKey);

  const timeoutSec = chunk.depth === 0 ? 20 : 16;
  const perAttemptMs = chunk.depth === 0 ? 25000 : 22000;
  const query = buildAdaptiveOverpassQL(chunk.south, chunk.west, chunk.north, chunk.east, chunk.lodTier, timeoutSec, lo);

  try {
    const elements = await fetchSingleOverpassQuery(query, perAttemptMs, abortSignal);
    storeOverpassChunkCache(chunk, elements);
    return elements;
  } catch (err) {
    if (abortSignal && abortSignal.aborted) throw err;
    const isFatalNetwork = Boolean(err && err.allFatalNetwork);
    const midLat = (chunk.south + chunk.north) * 0.5;
    const midLon = (chunk.west + chunk.east) * 0.5;
    const chunkSpanM = Math.max(
      Math.abs(chunk.north - chunk.south) * 111320,
      Math.abs(chunk.east - chunk.west) * 111320 * Math.max(0.2, Math.cos(midLat * Math.PI / 180))
    );
    const curDepth = Number(chunk.depth) || 0;
    if (curDepth < 3 && !isFatalNetwork && chunkSpanM > 250) {
      if (onSubSplit) onSubSplit(chunk);
      const fallbackTier = chunk.lodTier;
      const parentTotalChunks = chunk.totalChunks || 1;
      const subPadLat = (chunk.north - chunk.south) * 0.008;
      const subPadLon = (chunk.east - chunk.west) * 0.008;
      const subChunks = [
        { id: `${chunk.id}.1`, south: chunk.south, west: chunk.west, north: Math.min(chunk.north, midLat + subPadLat), east: Math.min(chunk.east, midLon + subPadLon), lodTier: fallbackTier, lodOptions: lo, totalChunks: parentTotalChunks, depth: curDepth + 1 },
        { id: `${chunk.id}.2`, south: chunk.south, west: Math.max(chunk.west, midLon - subPadLon), north: Math.min(chunk.north, midLat + subPadLat), east: chunk.east, lodTier: fallbackTier, lodOptions: lo, totalChunks: parentTotalChunks, depth: curDepth + 1 },
        { id: `${chunk.id}.3`, south: Math.max(chunk.south, midLat - subPadLat), west: chunk.west, north: chunk.north, east: Math.min(chunk.east, midLon + subPadLon), lodTier: fallbackTier, lodOptions: lo, totalChunks: parentTotalChunks, depth: curDepth + 1 },
        { id: `${chunk.id}.4`, south: Math.max(chunk.south, midLat - subPadLat), west: Math.max(chunk.west, midLon - subPadLon), north: chunk.north, east: chunk.east, lodTier: fallbackTier, lodOptions: lo, totalChunks: parentTotalChunks, depth: curDepth + 1 }
      ];
      const mergedSub = [];
      const failedSubs = [];
      let subCursor = 0;
      let subDoneCount = 0;
      const subWorker = async () => {
        while (subCursor < subChunks.length) {
          if (abortSignal && abortSignal.aborted) break;
          const sc = subChunks[subCursor++];
          if (onSubChunkProgress) onSubChunkProgress(sc, 'start', subDoneCount, subChunks.length, 0);
          try {
            const subEls = await fetchChunkWithRecursiveSplit(sc, abortSignal, callbacks);
            if (Array.isArray(subEls)) {
              storeOverpassChunkCache(sc, subEls);
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
              for (const msc of subErr.missingSubChunks) failedSubs.push(msc);
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

      // Dedicated targeted retry of ONLY failed sub-sectors (already-succeeded sub-chunks stay cached)
      if (failedSubs.length > 0) {
        const stillFailed = [];
        for (let fIdx = 0; fIdx < failedSubs.length; fIdx++) {
          const sc = failedSubs[fIdx];
          if (abortSignal && abortSignal.aborted) {
            stillFailed.push(sc);
            continue;
          }
          await _abortableDelay(retryDelayMs, abortSignal);
          if (abortSignal && abortSignal.aborted) {
            stillFailed.push(sc);
            continue;
          }
          if (onSubChunkProgress) onSubChunkProgress(sc, 'retry-start', subDoneCount, subChunks.length, 0);
          try {
            const subEls = await fetchChunkWithRecursiveSplit(sc, abortSignal, callbacks);
            if (Array.isArray(subEls)) {
              storeOverpassChunkCache(sc, subEls);
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
          storeOverpassChunkCache(chunk, mergedSub);
          return mergedSub;
        }
        // NEVER poison _overpassChunkCache under parent cacheKey when any sub-sector is missing!
        const partialErr = new Error(`Incomplete sub-chunk split (${stillFailed.length}/${subChunks.length} failed)`);
        partialErr.partialElements = mergedSub;
        partialErr.missingSubChunks = stillFailed;
        partialErr.failedSubChunkIds = stillFailed.map(s => s.id);
        throw partialErr;
      }

      if (subDoneCount === subChunks.length) {
        storeOverpassChunkCache(chunk, mergedSub);
        return mergedSub;
      }
    }
    throw err;
  }
}

const fetchOverpassChunkWithSplitJS = fetchChunkWithRecursiveSplit;

function mergeAndDeduplicateElements(elementArrays, maxSpanM = 1200, lodOptions = null) {
  const nodes = [], ways = [], relations = [];
  const nodeMap = new Map(), wayMap = new Map(), relMap = new Map();
  for (const arr of elementArrays) {
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const el = arr[i];
      if (!el) continue;
      if (el.type === 'node') {
        const prev = nodeMap.get(el.id);
        if (!prev) {
          nodeMap.set(el.id, el);
          nodes.push(el);
        } else if (el.tags && !prev.tags) {
          prev.tags = el.tags;
        }
      } else if (el.type === 'way') {
        const prev = wayMap.get(el.id);
        if (!prev) {
          wayMap.set(el.id, el);
          ways.push(el);
        } else {
          if (el.tags && !prev.tags) prev.tags = el.tags;
          if (el.nodes && (!prev.nodes || el.nodes.length > prev.nodes.length)) prev.nodes = el.nodes;
        }
      } else if (el.type === 'relation') {
        const prev = relMap.get(el.id);
        if (!prev) {
          relMap.set(el.id, el);
          relations.push(el);
        } else if (el.tags && !prev.tags) {
          prev.tags = el.tags;
        }
      }
    }
  }

  return nodes.concat(ways, relations);
}

function filterPrintableBuildingsForScale(scene, maxBuildings = Infinity) {
  if (!scene || !Array.isArray(scene.buildings) || !Number.isFinite(maxBuildings) || scene.buildings.length <= maxBuildings) return scene;
  const inBedFn = typeof scene._priorityBedCheck === 'function' ? scene._priorityBedCheck : null;
  const mustKeep = [], candidates = [];
  const mustKeepGroups = new Set();
  for (const b of scene.buildings) {
    if (b.landmark || b.church || b.tower || (b.h && b.h >= 22)) {
      mustKeep.push(b);
      if (b.groupId) mustKeepGroups.add(b.groupId);
    } else {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [x, y] of (b.outer || b.poly || [])) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      const approxArea = Math.max(0.01, (maxX - minX) * (maxY - minY));
      const inBedBoost = (inBedFn && inBedFn(b.cx || 0, b.cy || 0)) ? 6.0 : 1.0;
      candidates.push({ b, approxArea, inBedBoost });
    }
  }
  const scored = candidates.map(c => {
    const partMult = c.b.part
      ? (c.b.groupId && mustKeepGroups.has(c.b.groupId) ? 1.8 : 0.75)
      : 1.0;
    return {
      b: c.b,
      score: c.approxArea * (1 + (c.b.h || 10) * 0.04) * c.inBedBoost * partMult
    };
  });
  scored.sort((a, b) => b.score - a.score);
  const remainSlots = Math.max(0, maxBuildings - mustKeep.length);
  const kept = mustKeep.concat(scored.slice(0, remainSlots).map(c => c.b));
  for (let i = 0; i < kept.length; i++) kept[i].id = i + 1;
  scene.buildings = kept;
  return scene;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    selectLodTier,
    buildAdaptiveOverpassQL,
    buildSpatialChunkGrid,
    fetchChunkWithRecursiveSplit,
    fetchOverpassChunkWithSplitJS,
    mergeAndDeduplicateElements,
    filterPrintableBuildingsForScale,
    getOverpassChunkCacheKey,
    storeOverpassChunkCache,
    clearOverpassChunkCache
  };
}
