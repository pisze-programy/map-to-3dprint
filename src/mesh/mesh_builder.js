// ============================================================================
// src/mesh/mesh_builder.js
// 3-Layer Manifold Mesh Pipeline Orchestrator (Synchronous + Progressive)
//   Layer 1: Standard OSM/S3DB buildings, bridges, Delatin terrain, water/roads
//   Layer 2: Semantic OSM tag archetypes (0 proper-noun regexes)
//   Layer 3: Multi-tile Manifold CSG split, hollowBase/drains & physical audit
// ============================================================================

(function _initMeshBuilderDeps() {
  const _req = typeof require === 'function'
    ? require
    : (typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function'
      ? process.getBuiltinModule('module').createRequire(process.cwd() + '/src/mesh/mesh_builder.js')
      : null);
  if (!_req) return;
  const g = typeof globalThis !== 'undefined' ? globalThis : global;

  if (typeof g.__CLIPPER2__ === 'undefined' || typeof g.__DELATIN__ === 'undefined') {
    _req('../vendor/vendor_bundle.js');
  }
  if (typeof g.__ensureManifoldReady !== 'function' || typeof g.__getManifoldSync !== 'function') {
    _req('../vendor/manifold_vendor.js');
  }
  if (typeof resolveSceneScaleAndSpec === 'undefined') {
    Object.assign(g, _req('../geometry/print_physics_config.js'));
  }
  if (typeof MONO4_SPEC === 'undefined' || typeof SLA_PRINT_LAWS === 'undefined') {
    Object.assign(g, _req('../geometry/sla_print_laws.js'));
  }
  if (typeof cleanPolygonRing === 'undefined') {
    Object.assign(g, _req('../geometry/polygon_2d.js'));
  }
  if (typeof computeMinAreaOBB2D === 'undefined') {
    Object.assign(g, _req('../geometry/obb_medial_2d.js'));
  }
  if (typeof emitPolygonWithHolesSlab3D === 'undefined') {
    Object.assign(g, _req('./mesh_primitives.js'));
  }
  if (typeof createBuildContext === 'undefined') {
    Object.assign(g, _req('../geometry/manifold_core.js'));
  }
  if (typeof buildFrameSegmentsCSG === 'undefined') {
    Object.assign(g, _req('./frame_csg_solver.js'));
  }
  if (typeof buildTileIdLabelPolys === 'undefined') {
    Object.assign(g, _req('./tile_id_emboss.js'));
  }
  if (typeof carveTileHollowVaultAndId === 'undefined') {
    Object.assign(g, _req('./tile_sla_vault_solver.js'));
  }
  if (typeof assemblePrintMetricsReport === 'undefined') {
    Object.assign(g, _req('./global_invariants_auditor.js'));
  }
  if (typeof buildLayer1TerrainAndWater === 'undefined') {
    Object.assign(g, _req('./terrain_delatin_water.js'));
    Object.assign(g, _req('./terrain_surface_drape.js'));
    Object.assign(g, _req('./layer1_terrain_water.js'));
  }
  if (typeof buildDirectionalOrRevolveRoof === 'undefined') {
    Object.assign(g, _req('./s3db_roof_revolve.js'));
  }
  if (typeof buildSkeletonOrPolyRoof === 'undefined') {
    Object.assign(g, _req('./s3db_roof_skeleton.js'));
  }
  if (typeof buildS3DBPartSolid === 'undefined') {
    Object.assign(g, _req('./s3db_part_builder.js'));
  }
  if (typeof buildLayer1S3DBBuildings === 'undefined') {
    Object.assign(g, _req('./layer1_s3db_buildings.js'));
  }
  if (typeof solveBridgeGraph === 'undefined') {
    Object.assign(g, _req('./bridges/bridge_geom_2d.js'));
    Object.assign(g, _req('./bridges/bridge_spine_stitch.js'));
    Object.assign(g, _req('./bridges/bridge_tin_sampler.js'));
    Object.assign(g, _req('./bridges/bridge_specs_extract.js'));
    Object.assign(g, _req('./bridges/bridge_elevation_profile.js'));
    Object.assign(g, _req('./bridges/bridge_multideck_solver.js'));
    Object.assign(g, _req('./bridges/bridge_deck_builder.js'));
    Object.assign(g, _req('./bridges/bridge_supports_solver.js'));
    Object.assign(g, _req('./bridges/bridge_superstructure_arch_cable.js'));
  }
  if (typeof buildLayer1Bridges === 'undefined') {
    Object.assign(g, _req('./bridges/layer1_bridges.js'));
  }
  if (typeof buildLayer2Archetypes === 'undefined') {
    Object.assign(g, _req('./waterfront_piers_solver.js'));
    Object.assign(g, _req('./lattice_and_structures_solver.js'));
    Object.assign(g, _req('./tree_scatter_solver.js'));
    Object.assign(g, _req('./layer2_archetypes.js'));
  }
  if (typeof finalize3LayerTilesAndInvariants === 'undefined') {
    Object.assign(g, _req('./layer3_invariants_tiles.js'));
  }
})();

function yieldToEventLoop() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

class TimeBudgetYieldController {
  constructor(signal = null, budgetMs = 14) {
    this.signal = signal || null;
    this.budgetMs = Math.max(2, Number(budgetMs) || 14);
    this.sliceStart = Date.now();
  }

  checkCancellation() {
    if (this.signal && this.signal.aborted) {
      const err = new Error('3D build aborted');
      err.name = 'AbortError';
      throw err;
    }
  }

  async yieldIfNeeded(force = false) {
    this.checkCancellation();
    const now = Date.now();
    if (force || (now - this.sliceStart) >= this.budgetMs) {
      await yieldToEventLoop();
      this.checkCancellation();
      this.sliceStart = Date.now();
    }
  }

  async tick() {
    return this.yieldIfNeeded(false);
  }
}

function _buildEmptySceneFallback(state) {
  const meshes = {
    water: [],
    base: [],
    greenery: [],
    roads: [],
    buildings: [],
    highlighted: [],
    frame: []
  };
  const { scaleMm, halfW, halfH } = resolveSceneScaleAndSpec(state, null);
  const baseBedRing = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH]
  ];
  if (typeof emitPolygonWithHolesSlab3D === 'function') {
    emitPolygonWithHolesSlab3D(baseBedRing, [], 0, 1.8 / scaleMm, 1, meshes.base, 0, -1);
  }
  const totalTriangles = meshes.base.length;
  return { meshes, buildingBounds: [], pickIdMap: new Map(), totalTriangles };
}

function _runThreeLayerPipelineSync(scene, state, options = {}) {
  const ctx = createBuildContext(scene, state, options);
  const terrainWater = buildLayer1TerrainAndWater(ctx, scene, options);
  const s3db = buildLayer1S3DBBuildings(ctx, scene, terrainWater);
  const bridges = buildLayer1Bridges(ctx, scene, terrainWater);
  const archetypes = buildLayer2Archetypes(ctx, scene, terrainWater, s3db);
  return finalize3LayerTilesAndInvariants(ctx, { terrainWater, s3db, bridges, archetypes }, options);
}

/**
 * Synchronous 3-Layer 3D Model Builder.
 * Produces deterministic, watertight 2-manifold geometry identical to Progressive mode.
 */
function buildComplete3DModel(scene, state, options = {}) {
  if (!scene) {
    return _buildEmptySceneFallback(state);
  }
  return _runThreeLayerPipelineSync(scene, state, options);
}

/**
 * Responsive Progressive 3-Layer 3D Pipeline Orchestrator.
 * Yields periodically to the event loop, streaming verified layers to WebGL
 * with bit-exact triangle/metric parity against buildComplete3DModel().
 */
async function rebuildModel3DProgressive(scene, state, options = {}) {
  const opts = options || {};
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const onStageReady = typeof opts.onStageReady === 'function' ? opts.onStageReady : () => {};
  const yieldCtrl = new TimeBudgetYieldController(opts.signal || null, opts.budgetMs || opts.timeBudgetMs || 14);

  if (typeof ensureManifoldLibAsync === 'function') {
    await ensureManifoldLibAsync();
  }
  yieldCtrl.checkCancellation();

  if (!scene) {
    const emptyRes = _buildEmptySceneFallback(state);
    onStageReady('base', emptyRes.meshes.base, { append: false, deferShadow: false });
    onProgress(100, 'Gotowe', 'Pusta płyta bazowa');
    return emptyRes;
  }

  onProgress(12, 'Etap 1/5: Teren DEM (Delatin) i maski wody/dróg...', 'Konstrukcja siatki bazowej Manifold 3D');
  await yieldCtrl.yieldIfNeeded(true);
  const ctx = createBuildContext(scene, state, opts);
  const terrainWater = (typeof buildLayer1TerrainAndWaterAsync === 'function')
    ? await buildLayer1TerrainAndWaterAsync(ctx, scene, opts, yieldCtrl)
    : buildLayer1TerrainAndWater(ctx, scene, opts);
  await yieldCtrl.yieldIfNeeded(true);

  onProgress(32, 'Etap 2/5: Budynki S3DB i dachy architektoniczne...', 'Straight Skeleton + CSG 2-manifold');
  await yieldCtrl.yieldIfNeeded(true);
  const s3db = (typeof buildLayer1S3DBBuildingsAsync === 'function')
    ? await buildLayer1S3DBBuildingsAsync(ctx, scene, terrainWater, yieldCtrl)
    : buildLayer1S3DBBuildings(ctx, scene, terrainWater);
  await yieldCtrl.yieldIfNeeded(true);

  onProgress(52, 'Etap 3/5: Mosty i archetypy semantyczne OSM...', 'Mosty bridge:structure + obiekty specjalne');
  await yieldCtrl.yieldIfNeeded(true);
  const bridges = buildLayer1Bridges(ctx, scene, terrainWater);
  await yieldCtrl.yieldIfNeeded(true);
  const archetypes = (typeof buildLayer2ArchetypesAsync === 'function')
    ? await buildLayer2ArchetypesAsync(ctx, scene, terrainWater, s3db, yieldCtrl)
    : buildLayer2Archetypes(ctx, scene, terrainWater, s3db);
  await yieldCtrl.yieldIfNeeded(true);

  onProgress(68, 'Etap 4/5: Podział na kafle, drążenie SLA i audyt fizyczny...', 'Weryfikacja niezmienników 2-manifold');
  await yieldCtrl.yieldIfNeeded(true);
  const result = (typeof finalize3LayerTilesAndInvariantsAsync === 'function')
    ? await finalize3LayerTilesAndInvariantsAsync(ctx, { terrainWater, s3db, bridges, archetypes }, opts, yieldCtrl)
    : finalize3LayerTilesAndInvariants(ctx, { terrainWater, s3db, bridges, archetypes }, opts);
  await yieldCtrl.yieldIfNeeded(true);

  const { meshes } = result;
  onStageReady('base', meshes.base, { append: false, deferShadow: true });
  onProgress(76, 'Etap 5/5: Przesyłanie warstw bazowych do WebGL...', `${meshes.base.length} trójkątów podstawy`);
  await yieldCtrl.yieldIfNeeded(true);

  if (meshes.water.length > 0) {
    onStageReady('water', meshes.water, { append: false, deferShadow: true });
  }
  if (meshes.greenery.length > 0) {
    onStageReady('greenery', meshes.greenery, { append: false, deferShadow: true });
  }
  if (meshes.roads.length > 0) {
    onStageReady('roads', meshes.roads, { append: false, deferShadow: true });
  }
  if (meshes.frame.length > 0) {
    onStageReady('frame', meshes.frame, { append: false, deferShadow: true });
  }
  onProgress(84, 'Etap 5/5: Przesyłanie dróg, zieleni i wody...', `${meshes.roads.length + meshes.greenery.length} trójkątów`);
  await yieldCtrl.yieldIfNeeded(true);

  const CHUNK_TRIS = 18000;
  const bldTris = meshes.buildings || [];
  if (bldTris.length === 0) {
    onStageReady('buildings', [], { append: false, deferShadow: true });
  } else {
    for (let off = 0; off < bldTris.length; off += CHUNK_TRIS) {
      yieldCtrl.checkCancellation();
      const end = Math.min(bldTris.length, off + CHUNK_TRIS);
      const isLastBld = end >= bldTris.length && (!meshes.highlighted || meshes.highlighted.length === 0);
      onStageReady('buildings', bldTris.slice(off, end), { append: true, deferShadow: !isLastBld });
      const pct = 85 + Math.round((end / bldTris.length) * 12);
      onProgress(pct, `Etap 5/5: Wznoszenie budynków 3D (${end}/${bldTris.length} tr.)...`, 'Strumieniowanie buforów WebGL');
      await yieldCtrl.yieldIfNeeded();
    }
  }

  const hlTris = meshes.highlighted || [];
  if (hlTris.length === 0) {
    onStageReady('highlighted', [], { append: false, deferShadow: false });
  } else {
    for (let off = 0; off < hlTris.length; off += CHUNK_TRIS) {
      yieldCtrl.checkCancellation();
      const end = Math.min(hlTris.length, off + CHUNK_TRIS);
      const isLastHl = end >= hlTris.length;
      onStageReady('highlighted', hlTris.slice(off, end), { append: true, deferShadow: !isLastHl });
      await yieldCtrl.yieldIfNeeded();
    }
  }

  onProgress(100, 'Gotowe', `${result.totalTriangles} trójkątów (0 open / 0 nm)`);
  return result;
}

if (typeof window !== 'undefined') {
  window.buildComplete3DModel = buildComplete3DModel;
  window.rebuildModel3DProgressive = rebuildModel3DProgressive;
  window.yieldToEventLoop = yieldToEventLoop;
  window.TimeBudgetYieldController = TimeBudgetYieldController;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildComplete3DModel,
    rebuildModel3DProgressive,
    yieldToEventLoop,
    TimeBudgetYieldController
  };
}
