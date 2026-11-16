// ============================================================================
// src/gis_client/s3db_unit_parser.js
// Backward-Compatible Shim -> src/buildings/s3db_tag_parser.js
// ============================================================================

(function (root) {
  const mod = (typeof require === 'function')
    ? require('../buildings/s3db_tag_parser.js')
    : {
        OSM_17_ROOF_SHAPES_JS: root.OSM_17_ROOF_SHAPES_JS,
        ROOF_SHAPES_NORM: root.ROOF_SHAPES_NORM,
        CARDINAL_DEG_JS: root.CARDINAL_DEG_JS,
        SKIP_BUILDING_VALS_JS: root.SKIP_BUILDING_VALS_JS,
        WHEEL_ATTRACTION_VALS_JS: root.WHEEL_ATTRACTION_VALS_JS,
        normalizeRoofShapeS3DB: root.normalizeRoofShapeS3DB,
        parseFloatTagJS: root.parseFloatTagJS,
        parseOsmLengthMetersJS: root.parseOsmLengthMetersJS,
        parseRoofDirectionJS: root.parseRoofDirectionJS,
        resolveRoofAxesFromDirectionDeg: root.resolveRoofAxesFromDirectionDeg,
        isObservationWheelTagsJS: root.isObservationWheelTagsJS,
        hasAllNegativeLevelJS: root.hasAllNegativeLevelJS,
        isBridgeSupportTagJS: root.isBridgeSupportTagJS,
        isUndergroundOrSkippedBuildingJS: root.isUndergroundOrSkippedBuildingJS,
        isGroupingOnlyContainerTagsJS: root.isGroupingOnlyContainerTagsJS,
        estimateDefaultHeightM: root.estimateDefaultHeightM,
      };

  Object.assign(root, mod);
  if (typeof window !== 'undefined') Object.assign(window, mod);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
