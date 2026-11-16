// ============================================================================
// src/mesh/s3db_part_builder.js
// Backward-Compatible Shim -> src/buildings/s3db_part_solid_builder.js
// ============================================================================

(function (root) {
  const mod = (typeof require === 'function')
    ? require('../buildings/s3db_part_solid_builder.js')
    : {
        isLayer2ArchetypeRecord: root.isLayer2ArchetypeRecord,
        _normalizeRoofShape: root._normalizeRoofShape,
        _buildRoofManifold: root._buildRoofManifold,
        sampleFootprintTerrainZ: root.sampleFootprintTerrainZ,
        widenNarrowSpirePolys: root.widenNarrowSpirePolys,
        buildSupportlessCorbel: root.buildSupportlessCorbel,
        buildS3DBPartSolid: root.buildS3DBPartSolid,
      };

  Object.assign(root, mod);
  if (typeof window !== 'undefined') Object.assign(window, mod);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
