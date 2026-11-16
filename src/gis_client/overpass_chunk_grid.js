// ============================================================================
// src/gis_client/overpass_chunk_grid.js
// Compatibility Shim -> Delegates to modular task files in src/gis_fetch/
// (Preserves full Overpass QL quay, area:highway, building:part & S3DB contracts)
// ============================================================================

if (typeof require === 'function') {
  const _g = typeof globalThis !== 'undefined' ? globalThis : global;
  Object.assign(
    _g,
    require('../gis_fetch/fetch_diagnostics_trace.js'),
    require('../gis_fetch/spatial_bbox_grid_planner.js'),
    require('../gis_fetch/overpass_ql_builder.js'),
    require('../gis_fetch/gis_chunk_cache.js'),
    require('../gis_fetch/osm_element_merger.js'),
    require('../gis_fetch/overpass_mirror_router.js'),
    require('../gis_fetch/chunk_split_executor.js')
  );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TARGET_CHUNK_SPAN_METERS,
    MAX_CHUNK_SPLIT_DEPTH,
    MIN_CHUNK_SPLIT_SPAN_M,
    selectLodTier,
    computeBBoxSpanMeters,
    getChunkCanonicalBBoxKey,
    buildSpatialChunkGrid,
    subdivideChunk2x2,
    buildAdaptiveOverpassQL,
    estimateOverpassQlBytes,
    getOverpassChunkCacheKey,
    getCachedOverpassChunk,
    storeOverpassChunkCache,
    clearOverpassChunkCache,
    mergeOsmElementJS,
    mergeAndDeduplicateElements,
    filterPrintableBuildingsForScale,
    OVERPASS_MIRRORS,
    getPrioritizedOverpassMirrors,
    fetchSingleOverpassQuery,
    fetchHedgedOverpassJson,
    fetchChunkWithRecursiveSplit,
    fetchOverpassChunkWithSplitJS,
  };
}
