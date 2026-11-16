// ============================================================================
// src/gis_client/gis_chunk_streamer.js
// Compatibility Shim -> Delegates to src/gis_fetch/preloaded_scene_handoff.js
// and src/gis_fetch/gis_stream_coordinator.js
// ============================================================================

if (typeof require === 'function') {
  const _g = typeof globalThis !== 'undefined' ? globalThis : global;
  Object.assign(
    _g,
    require('../gis_fetch/fetch_diagnostics_trace.js'),
    require('../gis_fetch/spatial_bbox_grid_planner.js'),
    require('../gis_fetch/dem_terrarium_fetcher.js'),
    require('../gis_fetch/gis_chunk_cache.js'),
    require('../gis_fetch/osm_element_merger.js'),
    require('../gis_fetch/chunk_split_executor.js'),
    require('../gis_fetch/preloaded_scene_handoff.js'),
    require('../gis_fetch/gis_stream_coordinator.js')
  );
}

if (typeof window !== 'undefined' && typeof fetchChunkedGISInBrowser === 'function') {
  window.fetchChunkedGISInBrowser = fetchChunkedGISInBrowser;
  window.buildSceneFromPreloadedGis = buildSceneFromPreloadedGis;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildSceneFromPreloadedGis,
    buildTerrainOnlyFallbackScene,
    fetchChunkedGISInBrowser,
  };
}
