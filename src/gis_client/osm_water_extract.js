// ============================================================================
// src/gis_client/osm_water_extract.js
// Backward-Compatible Shim -> src/Water/water_osm_tags.js & water_osm_extractor.js
// ============================================================================

(function (root) {
  if (typeof require === 'function') {
    if (typeof parseFloatTagJS === 'undefined') {
      Object.assign(root, require('./s3db_client_matcher.js'));
    }
    Object.assign(
      root,
      require('../Water/water_ring_geometry.js'),
      require('../Water/water_multipolygon_stitcher.js'),
      require('../Water/water_coastline_stitcher.js'),
      require('../Water/water_osm_tags.js'),
      require('../Water/water_osm_extractor.js')
    );
  }

  const exportsObj = {
    isNonSurfaceWaterTagsJS: root.isNonSurfaceWaterTagsJS,
    isOsmShingleOrShoalTagsJS: root.isOsmShingleOrShoalTagsJS,
    isOsmStandaloneIslandTagsJS: root.isOsmStandaloneIslandTagsJS,
    defaultWaterwayWidthMetersJS: root.defaultWaterwayWidthMetersJS,
    isOsmArealRelationTypeJS: root.isOsmArealRelationTypeJS,
    isOsmWaterMultipolygonJS: root.isOsmWaterMultipolygonJS,
    collectOsmWaterSampleCandidateJS: root.collectOsmWaterSampleCandidateJS,
    processOsmWaterMultipolygonJS: root.processOsmWaterMultipolygonJS,
    processOsmCoastlineWayJS: root.processOsmCoastlineWayJS,
    processOsmWaterWayJS: root.processOsmWaterWayJS,
    finalizeOsmWaterLayerJS: root.finalizeOsmWaterLayerJS
  };

  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
