// ============================================================================
// src/mesh/mesh_builder.js
// Clean Modular 3D Map-to-Print Orchestrator (Terrain/Water -> Marching-Squares
// Parks/Roads/Footpaths -> Bank-Anchored Bridges -> S3DB Buildings -> Topology)
// ============================================================================

if (typeof buildTerrainAndMasks === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
  Object.assign(global, require('../geometry/obb_medial_2d.js'));
  Object.assign(global, require('../geometry/marching_squares_2d.js'));
  Object.assign(global, require('./mesh_primitives.js'));
  Object.assign(global, require('./mesh_clipper_3d.js'));
  Object.assign(global, require('./roof_shapes.js'));
  Object.assign(global, require('./roof_architectural.js'));
  Object.assign(global, require('./terrain_dem_grid.js'));
  Object.assign(global, require('./terrain_masks.js'));
  Object.assign(global, require('./terrain_base_water.js'));
  Object.assign(global, require('./features_roads_parks.js'));
  Object.assign(global, require('./features_bridges.js'));
  Object.assign(global, require('./buildings_prepare.js'));
  Object.assign(global, require('./buildings_s3db.js'));
  Object.assign(global, require('./mesh_topology.js'));
}

function buildComplete3DModel(scene, state) {
  const meshes = {
    water: [],
    base: [],
    greenery: [],
    roads: [],
    buildings: [],
    highlighted: [],
    frame: []
  };
  if (!scene) {
    return { meshes, buildingBounds: [], pickIdMap: new Map(), totalTriangles: 0 };
  }

  let nextFeatureShellId = -100;
  const allocShellId = () => (nextFeatureShellId--);

  // 1. High-resolution 720px masks (Euclidean Water SDF, Streets, Unbroken Parks, Footpaths) & DEM Grid
  const ctx = buildTerrainAndMasks(scene, state);

  // 2. Per-tile watertight stepped DEM base, SLA hollow vault ribs/drains/ID patch & smooth water basin
  const baseInfo = buildTerrainBaseAndWaterMeshes(ctx, state, meshes);

  // 3. Global Marching-Squares + Taubin-smoothed parks, streets, embossed footpaths & organic trees
  buildParksStreetsFootpathsAndTrees(scene, ctx, baseInfo, state, meshes, allocShellId);

  // 4. Bank-anchored 3D bridges (man_made=bridge polygons + linear spans + flush abutments + piers)
  buildBankAnchoredBridges(scene, ctx, baseInfo, state, meshes, allocShellId);

  // 5. Hierarchical S3DB buildings, architectural roofs & compact 16-bit pickId assignment
  const { buildingBounds, pickIdMap } = buildS3DBBuildingsMesh(scene, ctx, baseInfo, state, meshes);
  state.pickIdMap = pickIdMap;

  // 6. Mitered Studio Wall Frame (display layer 6; excluded from STL/3MF unless exportFrame=true)
  emitStudioWallFrame(ctx, meshes);

  // 7. Exact volume (ml), mass (g), Mono 4 fit & welded 2-manifold topology audit
  return computePrintMetricsAndTopology(meshes, buildingBounds, state, {
    totalWidthMm: ctx.totalWidthMm,
    totalHeightMm: ctx.totalHeightMm,
    tileCols: ctx.tileCols,
    tileRows: ctx.tileRows,
    kerfUnits: ctx.kerfUnits,
    hollowBase: ctx.hollowBase,
    vaultSavedSceneVol: baseInfo.vaultSavedSceneVol,
    baseBottomZ: ctx.baseBottomZ,
    getActualPrintedSurfaceMinZ: baseInfo.getActualPrintedSurfaceMinZ,
    pickIdMap
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildComplete3DModel };
}
