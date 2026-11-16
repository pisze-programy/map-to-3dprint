// ============================================================================
// src/gis_fetch/index.js
// Acyclic Barrel & Explicit DAG Manifest for the Modular GIS Fetching Package
// ============================================================================

const DAG_ORDER = [
  'fetch_diagnostics_trace.js',
  'spatial_bbox_grid_planner.js',
  'overpass_ql_builder.js',
  'gis_chunk_cache.js',
  'osm_element_merger.js',
  'dem_terrarium_fetcher.js',
  'overpass_mirror_router.js',
  'chunk_split_executor.js',
  'preloaded_scene_handoff.js',
  'gis_stream_coordinator.js',
];

const fetchDiagnosticsTrace = require('./fetch_diagnostics_trace.js');
const spatialBboxGridPlanner = require('./spatial_bbox_grid_planner.js');
const overpassQlBuilder = require('./overpass_ql_builder.js');
const gisChunkCache = require('./gis_chunk_cache.js');
const osmElementMerger = require('./osm_element_merger.js');
const demTerrariumFetcher = require('./dem_terrarium_fetcher.js');
const overpassMirrorRouter = require('./overpass_mirror_router.js');
const chunkSplitExecutor = require('./chunk_split_executor.js');
const preloadedSceneHandoff = require('./preloaded_scene_handoff.js');
const gisStreamCoordinator = require('./gis_stream_coordinator.js');

module.exports = {
  DAG_ORDER,
  ...fetchDiagnosticsTrace,
  ...spatialBboxGridPlanner,
  ...overpassQlBuilder,
  ...gisChunkCache,
  ...osmElementMerger,
  ...demTerrariumFetcher,
  ...overpassMirrorRouter,
  ...chunkSplitExecutor,
  ...preloadedSceneHandoff,
  ...gisStreamCoordinator,
  modules: {
    fetchDiagnosticsTrace,
    spatialBboxGridPlanner,
    overpassQlBuilder,
    gisChunkCache,
    osmElementMerger,
    demTerrariumFetcher,
    overpassMirrorRouter,
    chunkSplitExecutor,
    preloadedSceneHandoff,
    gisStreamCoordinator,
  },
};
