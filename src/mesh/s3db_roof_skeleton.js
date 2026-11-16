// ============================================================================
// src/mesh/s3db_roof_skeleton.js
// Backward-Compatible Shim -> src/buildings/roof_skeleton_poly.js
// ============================================================================

(function (root) {
  const mod = (typeof require === 'function')
    ? require('../buildings/roof_skeleton_poly.js')
    : {
        _buildStraightSkeletonRoof: root._buildStraightSkeletonRoof,
        _buildConeOrPyramidalRoof: root._buildConeOrPyramidalRoof,
        buildSkeletonOrPolyRoof: root.buildSkeletonOrPolyRoof,
      };

  Object.assign(root, mod);
  if (typeof window !== 'undefined') Object.assign(window, mod);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
