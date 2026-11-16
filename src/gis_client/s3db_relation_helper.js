// ============================================================================
// src/gis_client/s3db_relation_helper.js
// Backward-Compatible Shim -> src/buildings/s3db_containment_2d.js & s3db_wheel_consolidator.js
// ============================================================================

(function (root) {
  const mod = (typeof require === 'function')
    ? Object.assign(
        {},
        require('../buildings/s3db_containment_2d.js'),
        require('../buildings/s3db_wheel_consolidator.js')
      )
    : {
        _polyAreaSignedS3DB: root._polyAreaSignedS3DB,
        _pointInPolyS3DB: root._pointInPolyS3DB,
        _pointInAnyHoleS3DB: root._pointInAnyHoleS3DB,
        _minBoundaryDistSqS3DB: root._minBoundaryDistSqS3DB,
        computeSolidInteriorPtJS: root.computeSolidInteriorPtJS,
        computeRecordMetricsM: root.computeRecordMetricsM,
        isPartEnclosedByParentS3DB: root.isPartEnclosedByParentS3DB,
        consolidateWheelComplexesS3DB: root.consolidateWheelComplexesS3DB,
      };

  Object.assign(root, mod);
  if (typeof window !== 'undefined') Object.assign(window, mod);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
