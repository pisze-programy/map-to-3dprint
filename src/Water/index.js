// ============================================================================
// src/Water/index.js
// Unified Water Architecture Barrel (2D OSM Ring/Coastline/Extractor + 3D Mesh)
// ============================================================================

(function (root) {
  let exportsObj = {};
  if (typeof require === 'function') {
    const ringGeometry = require('./water_ring_geometry.js');
    const multipolygonStitcher = require('./water_multipolygon_stitcher.js');
    const coastlineStitcher = require('./water_coastline_stitcher.js');
    const osmTags = require('./water_osm_tags.js');
    const osmExtractor = require('./water_osm_extractor.js');
    const elevationSampler = require('./water_elevation_sampler.js');
    const slopedReaches = require('./water_sloped_reaches.js');
    const carveManifold = require('./water_carve_manifold.js');
    const pierOsmHelper = require('./water_pier_osm_helper.js');
    const piersSolver = require('./water_piers_solver.js');

    exportsObj = Object.assign(
      {},
      ringGeometry,
      multipolygonStitcher,
      coastlineStitcher,
      osmTags,
      osmExtractor,
      elevationSampler,
      slopedReaches,
      carveManifold,
      pierOsmHelper,
      piersSolver,
      {
        modules: {
          ringGeometry,
          multipolygonStitcher,
          coastlineStitcher,
          osmTags,
          osmExtractor,
          elevationSampler,
          slopedReaches,
          carveManifold,
          pierOsmHelper,
          piersSolver
        }
      }
    );
  }

  if (root && typeof root === 'object') {
    root.WaterModules = exportsObj.modules || root.WaterModules || {};
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
