// ============================================================================
// src/mesh/s3db_roof_revolve.js
// Backward-Compatible Shim -> src/buildings/roof_directional_revolve.js
// ============================================================================

(function (root) {
  const mod = (typeof require === 'function')
    ? require('../buildings/roof_directional_revolve.js')
    : {
        _ringAreaSigned: root._ringAreaSigned,
        _ptInRing: root._ptInRing,
        _computeOBB: root._computeOBB,
        _insetRoofOuterAndHoles: root._insetRoofOuterAndHoles,
        _extrudeProfileRoofClipped: root._extrudeProfileRoofClipped,
        _buildLatheRoofClipped: root._buildLatheRoofClipped,
        buildDirectionalOrRevolveRoof: root.buildDirectionalOrRevolveRoof,
      };

  Object.assign(root, mod);
  if (typeof window !== 'undefined') Object.assign(window, mod);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
