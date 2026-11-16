// ============================================================================
// src/gis_fetch/fetch_diagnostics_trace.js
// Ring-Buffered Structured Diagnostics & Timing Telemetry for GIS Data Fetching
// Layer 0 (Zero internal module dependencies)
// ============================================================================

(function (root) {
  const MAX_DIAGNOSTIC_SESSIONS = 16;
  const MAX_EVENTS_PER_SESSION = 512;

  const _sessions = [];
  let _activeSession = null;
  let _nextSessionId = 1;

  function _nowMs() {
    return (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
  }

  function startFetchDiagnosticSession(meta = {}) {
    const session = {
      sessionId: _nextSessionId++,
      startedAtIso: new Date().toISOString(),
      t0Ms: _nowMs(),
      elapsedMs: null,
      status: 'running',
      meta: { ...meta },
      counters: {
        chunksPlanned: Number(meta.totalChunks) || 0,
        chunksSucceeded: 0,
        chunksFailed: 0,
        cacheHits: 0,
        subSplits: 0,
        retries: 0,
        rawElementsFetched: 0,
        dedupedElements: 0,
      },
      events: [],
    };
    _sessions.push(session);
    while (_sessions.length > MAX_DIAGNOSTIC_SESSIONS) _sessions.shift();
    _activeSession = session;
    return session;
  }

  function recordFetchDiagnosticEvent(type, detail = {}, explicitSession = null) {
    const sess = explicitSession || _activeSession;
    if (!sess) return;
    if (type === 'cache-hit') sess.counters.cacheHits++;
    else if (type === 'chunk-ok') {
      sess.counters.chunksSucceeded++;
      sess.counters.rawElementsFetched += Number(detail.elements) || 0;
    } else if (type === 'chunk-fail') sess.counters.chunksFailed++;
    else if (type === 'sub-split') sess.counters.subSplits++;
    else if (type === 'retry') sess.counters.retries++;
    else if (type === 'merge-done') sess.counters.dedupedElements = Number(detail.dedupedElements) || 0;

    if (sess.events.length < MAX_EVENTS_PER_SESSION) {
      sess.events.push({
        dtMs: Math.round((_nowMs() - sess.t0Ms) * 10) / 10,
        type,
        ...detail,
      });
    }
  }

  function finishFetchDiagnosticSession(status = 'ok', summary = {}, explicitSession = null) {
    const sess = explicitSession || _activeSession;
    if (!sess) return null;
    sess.status = status;
    sess.elapsedMs = Math.round((_nowMs() - sess.t0Ms) * 10) / 10;
    sess.summary = { ...summary };
    if (_activeSession === sess) _activeSession = null;
    return sess;
  }

  function getFetchDiagnosticsReport() {
    return {
      activeSessionId: _activeSession ? _activeSession.sessionId : null,
      sessionCount: _sessions.length,
      latestSession: _sessions.length > 0 ? _sessions[_sessions.length - 1] : null,
      sessions: _sessions.slice(),
    };
  }

  function clearFetchDiagnostics() {
    _sessions.length = 0;
    _activeSession = null;
  }

  const exportsObj = {
    startFetchDiagnosticSession,
    recordFetchDiagnosticEvent,
    finishFetchDiagnosticSession,
    getFetchDiagnosticsReport,
    clearFetchDiagnostics,
  };

  root.__map3dFetchDiagnostics = exportsObj;
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') {
    window.__map3dFetchDiagnostics = exportsObj;
    Object.assign(window, exportsObj);
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
