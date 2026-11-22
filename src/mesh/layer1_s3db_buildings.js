// ============================================================================
// src/mesh/layer1_s3db_buildings.js
// Backward-Compatible Shim -> src/buildings/s3db_skybridge_anchoring.js & layer1_s3db_solver.js
// ============================================================================

(function (root) {
  const mod = (typeof require === 'function')
    ? (() => {
        const partMod = require('../buildings/s3db_part_solid_builder.js');
        return Object.assign(
          {
            isLayer2ArchetypeRecord: partMod.isLayer2ArchetypeRecord,
            _normalizeRoofShape: partMod._normalizeRoofShape,
            _buildRoofManifold: partMod._buildRoofManifold,
          },
          require('../buildings/s3db_skybridge_anchoring.js'),
          require('../buildings/layer1_s3db_solver.js')
        );
      })()
    : {
        isLayer2ArchetypeRecord: root.isLayer2ArchetypeRecord,
        _normalizeRoofShape: root._normalizeRoofShape,
        _buildRoofManifold: root._buildRoofManifold,
        _ptInSolid: root._ptInSolid,
        _segMinDistSq2D: root._segMinDistSq2D,
        _ringsMinDist2D: root._ringsMinDist2D,
        _ringsTouchOrOverlap2D: root._ringsTouchOrOverlap2D,
        recordsTouch3D: root.recordsTouch3D,
        _solidsOverlap3D: root._solidsOverlap3D,
        _weldElevatedGapCollar: root._weldElevatedGapCollar,
        _groundPortalOnEndPiers: root._groundPortalOnEndPiers,
        anchorAndMergeS3DBClusters: root.anchorAndMergeS3DBClusters,
        buildLayer1S3DBBuildings: root.buildLayer1S3DBBuildings,
        buildLayer1S3DBBuildingsAsync: root.buildLayer1S3DBBuildingsAsync,
      };

  Object.assign(root, mod);
  if (typeof window !== 'undefined') Object.assign(window, mod);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
