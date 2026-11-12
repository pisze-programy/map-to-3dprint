// ============================================================================
// src/mesh/features_roads_parks.js
// Thin Layer Orchestrator & Re-Export Shim for Greenery, Roads/Footpaths & Trees
// (Delegates each layer cleanly to features_greenery.js, features_roads.js, features_trees.js)
// ============================================================================

if (typeof extractMarchingSquaresPolygons2D === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
  Object.assign(global, require('../geometry/obb_medial_2d.js'));
  Object.assign(global, require('../geometry/marching_squares_2d.js'));
  Object.assign(global, require('./mesh_primitives.js'));
  Object.assign(global, require('./mesh_clipper_3d.js'));
}
if (typeof appendShellClippedToTiles === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./mesh_tile_append.js'));
}
if (typeof emitGreeneryLayer === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./features_greenery.js'));
}
if (typeof emitRoadsLayer === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./features_roads.js'));
}
if (typeof emitTreesLayer === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./features_trees.js'));
}

function buildParksStreetsFootpathsAndTreesSync(scene, ctx, baseInfo, state, meshes, allocShellId) {
  const lv = state.layerVisible || state.layers;
  const roadsVisible = !lv || lv.roads !== false;
  const greenVisible = !lv || lv.greenery !== false;
  const treesVisible = isTreesLayerVisible(scene, state);

  const bandAssigner = buildPixelContourBandAssignerSync(ctx, baseInfo, roadsVisible || greenVisible || treesVisible);
  emitGreeneryLayerSync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner);
  emitRoadsLayerSync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner);
  emitTreesLayerSync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner);
}

async function buildParksStreetsFootpathsAndTreesProgressive(scene, ctx, baseInfo, state, meshes, allocShellId, yieldCtrl, onProgress = null) {
  const lv = state.layerVisible || state.layers;
  const roadsVisible = !lv || lv.roads !== false;
  const greenVisible = !lv || lv.greenery !== false;
  const treesVisible = isTreesLayerVisible(scene, state);

  const progressTracker = { lastReportedPct: 42, onProgress };
  const bandAssigner = await buildPixelContourBandAssignerAsync(ctx, baseInfo, roadsVisible || greenVisible || treesVisible, yieldCtrl);
  await emitGreeneryLayerAsync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl, progressTracker);
  await emitRoadsLayerAsync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl, progressTracker);
  await emitTreesLayerAsync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl, progressTracker);
}

function buildParksStreetsFootpathsAndTrees(scene, ctx, baseInfo, state, meshes, allocShellId, yieldCtrl = null, onProgress = null) {
  if (yieldCtrl) {
    return buildParksStreetsFootpathsAndTreesProgressive(scene, ctx, baseInfo, state, meshes, allocShellId, yieldCtrl, onProgress);
  }
  return buildParksStreetsFootpathsAndTreesSync(scene, ctx, baseInfo, state, meshes, allocShellId);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    appendShellClippedToTiles,
    appendPolygonPrismClippedToTiles,
    buildSmoothedBandField,
    buildPixelContourBandAssigner,
    buildParksStreetsFootpathsAndTrees
  };
}
