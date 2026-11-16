// ============================================================================
// src/gis_client/overpass_dem_fetch.js
// Compatibility Shim -> Delegates to src/gis_fetch/dem_terrarium_fetcher.js & src/Water/
// ============================================================================

if (typeof require === 'function') {
  const _g = typeof globalThis !== 'undefined' ? globalThis : global;
  Object.assign(
    _g,
    require('../Water/water_ring_geometry.js'),
    require('../Water/water_multipolygon_stitcher.js'),
    require('../Water/water_coastline_stitcher.js'),
    require('../gis_fetch/dem_terrarium_fetcher.js')
  );
}

if (typeof window !== 'undefined') {
  if (typeof chooseAdaptiveDemZoom === 'function') window.chooseAdaptiveDemZoom = chooseAdaptiveDemZoom;
  if (typeof fetchAdaptiveTerrariumDem === 'function') window.fetchAdaptiveTerrariumDem = fetchAdaptiveTerrariumDem;
  if (typeof fetchTerrariumDemInBrowser === 'function') window.fetchTerrariumDemInBrowser = fetchTerrariumDemInBrowser;
  if (typeof stitchClippedMultipolygonRingsJS === 'function') window.stitchClippedMultipolygonRingsJS = stitchClippedMultipolygonRingsJS;
  if (typeof stitchCoastlineSeaPolysJS === 'function') window.stitchCoastlineSeaPolysJS = stitchCoastlineSeaPolysJS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    simplifyRingJS,
    stitchWayRingsJS,
    polyAreaSignedJS,
    pointInPolyLocal,
    chooseAdaptiveDemZoom,
    fillDemVoidsNearestO_G2,
    fetchAdaptiveTerrariumDem,
    fetchTerrariumDemInBrowser,
    setDemPreloadedOverride,
    stitchClippedMultipolygonRingsJS,
    stitchCoastlineSeaPolysJS,
  };
}
