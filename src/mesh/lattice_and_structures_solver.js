// ============================================================================
// src/mesh/lattice_and_structures_solver.js
// Backward-Compatible Shim -> src/buildings/archetype_structures_solver.js
// ============================================================================

(function (root) {
  const mod = (typeof require === 'function')
    ? require('../buildings/archetype_structures_solver.js')
    : {
        buildObservationWheelManifold: root.buildObservationWheelManifold,
        buildWindTurbineManifold: root.buildWindTurbineManifold,
        buildParametricLatticeManifold: root.buildParametricLatticeManifold,
        buildTowerOrIndustrialManifold: root.buildTowerOrIndustrialManifold,
      };

  Object.assign(root, mod);
  if (typeof window !== 'undefined') Object.assign(window, mod);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
