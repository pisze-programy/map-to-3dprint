// ============================================================================
// src/ui/fast_render_manager.js
// Instant PickID-Aware Building Highlight Layer Swapper (Zero Roof Coarsening!)
// ============================================================================

function installFastGeometryHooks() {
  // Architectural roof subdivision in src/mesh/roof_architectural.js is natively
  // ridge-creased and < 0.5s per full city scene; never coarsen roof edges here!
}

/**
 * Fast-path swaps triangles between `buildings` (layer 4) and `highlighted` (layer 5)
 * in < 3 ms using compact 16-bit `pickId` (`b._pickId`), avoiding a full scene rebuild.
 */
function fastSwapHighlightedBuildings(state) {
  if (!state || !state.layerMeshes || !state.sceneData) return false;
  const bMeshes = state.layerMeshes.buildings;
  const hMeshes = state.layerMeshes.highlighted;
  if (!Array.isArray(bMeshes) || !Array.isArray(hMeshes)) return false;

  const hlPickIds = new Set();
  for (const b of (state.sceneData.buildings || [])) {
    if (b.highlighted && !b.hidden && b._pickId) {
      hlPickIds.add(b._pickId);
    }
  }

  const allTris = bMeshes.concat(hMeshes);
  const nextB = [];
  const nextH = [];
  for (let i = 0; i < allTris.length; i++) {
    const tri = allTris[i];
    if (hlPickIds.has(tri.buildingId)) {
      tri.layerId = 5;
      nextH.push(tri);
    } else {
      tri.layerId = 4;
      nextB.push(tri);
    }
  }
  state.layerMeshes.buildings = nextB;
  state.layerMeshes.highlighted = nextH;

  for (const bb of (state.buildingBounds || [])) {
    const pid = bb.pickId || (bb.building && bb.building._pickId);
    const isHl = hlPickIds.has(pid) || (bb.building && !!bb.building.highlighted);
    bb.layerId = isHl ? 5 : 4;
  }
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    installFastGeometryHooks,
    fastSwapHighlightedBuildings
  };
}
