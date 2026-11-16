// ============================================================================
// src/mesh/waterfront_piers_solver.js
// Backward-Compatible Shim -> src/Water/water_piers_solver.js
// ============================================================================

(function (root) {
  const mod = (typeof root.buildMarinePiersAndBreakwaters === 'function' && typeof root.computeFootprintOBB === 'function')
    ? {
        computeFootprintOBB: root.computeFootprintOBB,
        resolveGroundZ: root.resolveGroundZ,
        buildMarinePiersAndBreakwaters: root.buildMarinePiersAndBreakwaters
      }
    : require('../Water/water_piers_solver.js');

  Object.assign(root, mod);
  if (typeof window !== 'undefined') Object.assign(window, mod);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
