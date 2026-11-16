// ============================================================================
// src/gis_fetch/gis_chunk_cache.js
// Bounded O(1) LRU In-Memory Cache for Fetched Overpass Tile Payloads
// Layer 1 (Zero internal module dependencies)
// ============================================================================

(function (root) {
  const MAX_CHUNK_CACHE_ENTRIES = 256;
  const _overpassChunkCache = new Map();

  function getOverpassChunkCacheKey(chunk) {
    const lo = chunk.lodOptions || null;
    const lodKey = lo
      ? `t${lo.wantTrees === false ? 0 : 1}_b${Math.round(lo.minBuildingFootprintM || 0)}_r${lo.roadDetail || 'all'}`
      : 'def';
    return `v14_${chunk.lodTier}_${lodKey}_${chunk.south.toFixed(5)}_${chunk.west.toFixed(5)}_${chunk.north.toFixed(5)}_${chunk.east.toFixed(5)}`;
  }

  function getCachedOverpassChunk(chunk) {
    if (!chunk) return undefined;
    const key = getOverpassChunkCacheKey(chunk);
    if (!_overpassChunkCache.has(key)) return undefined;
    const val = _overpassChunkCache.get(key);
    // Refresh LRU order in O(1)
    _overpassChunkCache.delete(key);
    _overpassChunkCache.set(key, val);
    return val;
  }

  function storeOverpassChunkCache(chunk, elements) {
    if (!chunk || !Array.isArray(elements)) return;
    const key = getOverpassChunkCacheKey(chunk);
    if (_overpassChunkCache.has(key)) _overpassChunkCache.delete(key);
    _overpassChunkCache.set(key, elements);
    while (_overpassChunkCache.size > MAX_CHUNK_CACHE_ENTRIES) {
      _overpassChunkCache.delete(_overpassChunkCache.keys().next().value);
    }
  }

  function clearOverpassChunkCache() {
    _overpassChunkCache.clear();
  }

  const exportsObj = {
    MAX_CHUNK_CACHE_ENTRIES,
    getOverpassChunkCacheKey,
    getCachedOverpassChunk,
    storeOverpassChunkCache,
    clearOverpassChunkCache,
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
