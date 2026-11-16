// ============================================================================
// src/gis_fetch/overpass_mirror_router.js
// Unified Overpass Mirror Registry, Hedged Transport & Proxy Remark Classifier
// Layer 2 (Depends only on optional fetch_diagnostics_trace.js)
// ============================================================================

(function (root) {
  let _diag = null;
  if (typeof recordFetchDiagnosticEvent === 'function') {
    _diag = { recordFetchDiagnosticEvent };
  } else if (typeof require === 'function') {
    try { _diag = require('./fetch_diagnostics_trace.js'); } catch (_) {}
  }

  const OVERPASS_MIRRORS = [
    '/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];

  const _origWindowFetch = (typeof window !== 'undefined' && window.fetch) ? window.fetch.bind(window) : null;
  let _mirrorRoundRobinIdx = 0;

  function resolveNativeOverpassFetch() {
    if (typeof globalThis !== 'undefined' && typeof globalThis._overpassCustomFetch === 'function') {
      return globalThis._overpassCustomFetch;
    }
    if (_origWindowFetch) return _origWindowFetch;
    return fetch;
  }

  function getPrioritizedOverpassMirrors() {
    const isHttpOrigin = typeof window === 'undefined' || !window.location || /^https?:$/i.test(window.location.protocol);
    const primary = [];
    if (isHttpOrigin) primary.push('/api/interpreter');
    const secondaryPool = OVERPASS_MIRRORS.filter((m) => !primary.includes(m));
    const rot = (_mirrorRoundRobinIdx++) % Math.max(1, secondaryPool.length);
    const rotatedSecondary = secondaryPool.map((_, i) => secondaryPool[(rot + i) % secondaryPool.length]);
    return primary.concat(rotatedSecondary);
  }

  function _parseAndClassifyOverpassBody(text) {
    const trimmed = text ? text.trim() : '';
    if (!trimmed || trimmed.startsWith('<') || trimmed.startsWith('#')) {
      throw new Error('Overpass XML/HTML rate-limit');
    }
    const j = JSON.parse(trimmed);
    if (!j || !Array.isArray(j.elements)) {
      throw new Error('Invalid Overpass JSON');
    }
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
    return j;
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
        const fetchFn = resolveNativeOverpassFetch();
        const r = await fetchFn(ep, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          signal: ctrl.signal,
        });
        if (!r.ok) {
          const httpErr = new Error(`HTTP ${r.status}`);
          httpErr.status = r.status;
          throw httpErr;
        }
        const text = await r.text();
        const parsed = _parseAndClassifyOverpassBody(text);
        return parsed.elements;
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
      let settled = false;
      let pending = 0;
      let nextMirrorIdx = 0;
      let stopLaunchingMore = false;
      const errors = [];
      const rawErrors = [];
      const hedgeTimers = [];
      const clearHedges = () => { while (hedgeTimers.length) clearTimeout(hedgeTimers.pop()); };

      const finishReject = () => {
        if (settled) return;
        settled = true;
        clearHedges();
        abortAllActive();
        const combined = new Error(`Mirrors failed: ${errors.join(', ')}`);
        combined.allFatalNetwork = rawErrors.length > 0 && rawErrors.every((e) => {
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
            if (_diag && typeof _diag.recordFetchDiagnosticEvent === 'function') {
              _diag.recordFetchDiagnosticEvent('mirror-ok', { endpoint: ep, elements: elements.length });
            }
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

  async function fetchHedgedOverpassJson(query, options = {}) {
    const signal = options.signal || null;
    const timeoutMs = options.timeoutMs || 23000;
    const elements = await fetchSingleOverpassQuery(query, timeoutMs, signal);
    return { elements };
  }

  const exportsObj = {
    OVERPASS_MIRRORS,
    resolveNativeOverpassFetch,
    getPrioritizedOverpassMirrors,
    fetchSingleOverpassQuery,
    fetchHedgedOverpassJson,
  };

  root._origWindowFetch = _origWindowFetch;
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
