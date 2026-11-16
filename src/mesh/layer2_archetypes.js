// ============================================================================
// src/mesh/layer2_archetypes.js
// Backward-Compatible Shim -> src/buildings/layer2_archetypes_solver.js
// ============================================================================

(function (root) {
  const mod = (typeof require === 'function')
    ? require('../buildings/layer2_archetypes_solver.js')
    : {
        _computeGroupDatums: root._computeGroupDatums,
        _mergeLayeredGroupManifolds: root._mergeLayeredGroupManifolds,
        buildLayer2Archetypes: root.buildLayer2Archetypes,
      };

  Object.assign(root, mod);
  if (typeof window !== 'undefined') Object.assign(window, mod);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
