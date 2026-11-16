// ============================================================================
// src/gis_client/osm_buildings_extract.js
// Backward-Compatible Shim -> src/buildings/osm_buildings_extractor.js
// ============================================================================

(function (root) {
  const mod = (typeof require === 'function')
    ? require('../buildings/osm_buildings_extractor.js')
    : {
        _bldPolyAreaAbsJS: root._bldPolyAreaAbsJS,
        _bldPointInPolyJS: root._bldPointInPolyJS,
        pairMultipolygonHolesForOutersJS: root.pairMultipolygonHolesForOutersJS,
        collectOsmBuildingSampleCandidateJS: root.collectOsmBuildingSampleCandidateJS,
        processOsmS3DBRelationsPass1BJS: root.processOsmS3DBRelationsPass1BJS,
        processOsmBuildingMultipolygonJS: root.processOsmBuildingMultipolygonJS,
        processOsmBuildingWayJS: root.processOsmBuildingWayJS,
        finalizeOsmBuildingsLayerJS: root.finalizeOsmBuildingsLayerJS,
      };

  Object.assign(root, mod);
  if (typeof window !== 'undefined') Object.assign(window, mod);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
