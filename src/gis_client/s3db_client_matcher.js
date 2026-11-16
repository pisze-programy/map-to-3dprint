// ============================================================================
// src/gis_client/s3db_client_matcher.js
// Backward-Compatible Shim -> src/buildings/s3db_outline_suppressor.js & s3db_client_matcher.js
// ============================================================================

(function (root) {
  const mod = (typeof require === 'function')
    ? Object.assign(
        {},
        require('../buildings/s3db_tag_parser.js'),
        require('../buildings/s3db_containment_2d.js'),
        require('../buildings/s3db_wheel_consolidator.js'),
        require('../buildings/s3db_outline_suppressor.js'),
        require('../buildings/s3db_client_matcher.js')
      )
    : {
        SKIP_BUILDING_VALS_JS: root.SKIP_BUILDING_VALS_JS,
        parseFloatTagJS: root.parseFloatTagJS,
        parseOsmLengthMetersJS: root.parseOsmLengthMetersJS,
        parseRoofDirectionJS: root.parseRoofDirectionJS,
        isObservationWheelTagsJS: root.isObservationWheelTagsJS,
        isUndergroundOrSkippedBuildingJS: root.isUndergroundOrSkippedBuildingJS,
        isGroupingOnlyContainerTagsJS: root.isGroupingOnlyContainerTagsJS,
        computeSolidInteriorPtJS: root.computeSolidInteriorPtJS,
        _fallbackPartsCoverageS3DB: root._fallbackPartsCoverageS3DB,
        evaluateParentOutlineSuppressionS3DB: root.evaluateParentOutlineSuppressionS3DB,
        groupOrphanBuildingPartsS3DB: root.groupOrphanBuildingPartsS3DB,
        createS3DBClientCollector: root.createS3DBClientCollector,
      };

  Object.assign(root, mod);
  if (typeof window !== 'undefined') Object.assign(window, mod);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
