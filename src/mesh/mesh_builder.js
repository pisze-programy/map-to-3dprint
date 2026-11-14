// ============================================================================
// src/mesh/mesh_builder.js
// Clean Modular 3D Map-to-Print Orchestrator (Terrain/Water -> Marching-Squares
// Parks/Roads/Footpaths -> Bank-Anchored Bridges -> S3DB Buildings -> Topology)
// High-Performance Responsive Progressive 3D Pipeline & Time-Sliced Yielding
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

/**
 * High-performance macrotask yield avoiding the 4ms setTimeout clamp in browsers.
 * Fallback chain: scheduler.yield() -> MessageChannel -> setTimeout(0).
 */
function yieldToEventLoop() {
  if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') {
    return scheduler.yield();
  }
  if (typeof MessageChannel !== 'undefined') {
    return new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * TimeBudgetYieldController controls cooperative time-slicing on the main thread.
 * Guarantees that procedural loops never block the UI for > timeBudgetMs (target 16ms).
 * CheckInterval throttling avoids system clock query overhead.
 */
class TimeBudgetYieldController {
  constructor(timeBudgetMs = 16, options = {}) {
    this.timeBudgetMs = timeBudgetMs;
    this.sliceStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    this.signal = options.signal || null;
    this.isCancelled = options.isCancelled || null;
    this.checkInterval = options.checkInterval || 64;
    this.counter = 0;
  }

  checkCancellation() {
    if (this.signal && this.signal.aborted) {
      const err = new Error('Pipeline aborted');
      err.name = 'AbortError';
      throw err;
    }
    if (this.isCancelled && this.isCancelled()) {
      const err = new Error('Pipeline cancelled');
      err.name = 'AbortError';
      throw err;
    }
  }

  async yieldIfNeeded(force = false) {
    this.checkCancellation();
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (force || (now - this.sliceStart > this.timeBudgetMs)) {
      await yieldToEventLoop();
      this.checkCancellation();
      this.sliceStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      return true;
    }
    return false;
  }

  async tick(force = false) {
    if (force || (++this.counter % this.checkInterval === 0)) {
      return await this.yieldIfNeeded(force);
    }
    return false;
  }
}

/**
 * Progressive batch building extruder for Stage 4.
 * Emits S3DB buildings in batches of ~180, uploading incrementally to WebGL.
 */
async function buildS3DBBuildingsMeshProgressive(scene, ctx, baseInfo, state, meshes, yieldCtrl, onStageReady, onProgress) {
  const { tileCols, tileRows, tileBounds, halfW, halfH, mToU, quantizeZUnits } = ctx;
  const { prepared, clusters, pickIdMap } = prepareAndClusterS3DBBuildings(scene, ctx, baseInfo, state);
  const buildingBounds = [];

  // 1. Support-Aware Hierarchical Z-Tier Resolution (shared with synchronous pipeline)
  for (const [, cluster] of clusters) {
    if (cluster.length <= 1) continue;
    resolveS3DBClusterTiers(cluster, mToU, quantizeZUnits);
    await yieldCtrl.tick();
  }

  // 2. Extrude Watertight 2-Manifold LoD2 Shells in Adaptive Time-Sliced Batches
  let nextBldShellId = 1;
  const allocShellId = () => nextBldShellId++;
  const activeItems = prepared.filter(it => !it.skip);
  const CHUNK_FLUSH_SIZE = 40;
  let chunkBuildingsTris = [];
  let chunkHlTris = [];

  for (let i = 0; i < activeItems.length; i++) {
    yieldCtrl.checkCancellation();
    const item = activeItems[i];
    const bld = item.b;

    const isHl = item.clusterHighlighted || !!bld.highlighted;
    const targetBatchArr = isHl ? chunkHlTris : chunkBuildingsTris;
    const targetMainList = isHl ? meshes.highlighted : meshes.buildings;

    buildingBounds.push(emitSingleS3DBBuildingItem(item, ctx, allocShellId, targetMainList, targetBatchArr));

    const isLast = (i === activeItems.length - 1);
    const shouldFlush = (chunkBuildingsTris.length + chunkHlTris.length >= 600) ||
                        ((i + 1) % CHUNK_FLUSH_SIZE === 0) ||
                        isLast;

    if (shouldFlush) {
      if (chunkBuildingsTris.length > 0) {
        onStageReady('buildings', chunkBuildingsTris, { append: true });
        chunkBuildingsTris = [];
      }
      if (chunkHlTris.length > 0) {
        onStageReady('highlighted', chunkHlTris, { append: true });
        chunkHlTris = [];
      }

      const pct = 72 + Math.round(((i + 1) / activeItems.length) * 20);
      onProgress(pct, `Etap 4/5: Wznoszenie budynków 3D (${i + 1}/${activeItems.length})...`, `Dachy LoD2 i fasady (${i + 1}/${activeItems.length})`);
      await yieldCtrl.yieldIfNeeded();
    }
  }

  return { buildingBounds, pickIdMap };
}

/**
 * Responsive Progressive 3D Pipeline Orchestrator.
 * Yields periodically to the event loop, streaming layers to WebGL in 5 stages.
 */
async function rebuildModel3DProgressive(scene, state, options = {}) {
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
    const totalWidthMm = state.bedSizeMm || state.targetWidthMm || 320;
    const totalHeightMm = state.totalHeightMm || state.targetHeightMm || totalWidthMm;
    const maxDimMm = Math.max(totalWidthMm, totalHeightMm) || 320;
    const scaleMm = maxDimMm / 169.2;
    const halfW = 84.6 * (totalWidthMm / maxDimMm);
    const halfH = 84.6 * (totalHeightMm / maxDimMm);
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

  const yieldCtrl = new TimeBudgetYieldController(options.timeBudgetMs || 16, options);
  const rawOnProgress = typeof options.onProgress === 'function' ? options.onProgress : (() => {});
  let currentMaxPct = 0;
  const onProgress = (pct, label, sub) => {
    const monotonicPct = Math.max(currentMaxPct, Math.min(100, Math.round(pct)));
    currentMaxPct = monotonicPct;
    rawOnProgress(monotonicPct, label, sub);
  };
  const onStageReady = typeof options.onStageReady === 'function' ? options.onStageReady : (typeof options.onLayerReady === 'function' ? options.onLayerReady : (() => {}));

  let nextFeatureShellId = -100;
  const allocShellId = () => (nextFeatureShellId--);

  // STAGE 1: Fast Terrain DEM & Water (<0.8s)
  onProgress(25, 'Etap 1/5: Budowanie modelu terenu DEM i wód (<0.8s)...', 'Siatka wysokościowa Terrarium i batymetria zbiorników wodnych');
  await yieldCtrl.yieldIfNeeded(true);
  yieldCtrl.checkCancellation();

  const ctx = buildTerrainAndMasks(scene, state);
  ctx.isExport = Boolean(options && options.isExport);
  await yieldCtrl.yieldIfNeeded();
  yieldCtrl.checkCancellation();

  const tBase0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const baseInfo = buildTerrainBaseAndWaterMeshes(ctx, state, meshes, options);
  const baseDuration = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - tBase0;
  if (state) state.lastTerrainBaseWaterDurationMs = baseDuration;
  await yieldCtrl.yieldIfNeeded();
  yieldCtrl.checkCancellation();

  onStageReady('base', meshes.base, { append: false });
  onStageReady('water', meshes.water, { append: false });
  onProgress(40, 'Etap 1/5: Wyrenderowano rzeźbę terenu i batymetrię wody', `Wygenerowano ${meshes.base.length + meshes.water.length} trójkątów podłoża`);
  await yieldCtrl.yieldIfNeeded(true);
  yieldCtrl.checkCancellation();

  // STAGE 2: Greenery & Parks
  onProgress(42, 'Etap 2/5: Generowanie parków, skwerów i drzew 3D...', 'Konturowanie Marching-Squares i wygładzanie Taubina');
  await yieldCtrl.yieldIfNeeded();
  yieldCtrl.checkCancellation();

  await buildParksStreetsFootpathsAndTrees(scene, ctx, baseInfo, state, meshes, allocShellId, yieldCtrl, onProgress);
  yieldCtrl.checkCancellation();

  onStageReady('greenery', meshes.greenery, { append: false });
  onProgress(55, 'Etap 2/5: Wyrenderowano zieleń miejską i korony drzew', `${meshes.greenery.length} trójkątów roślinności`);
  await yieldCtrl.yieldIfNeeded(true);
  yieldCtrl.checkCancellation();

  // STAGE 3: Streets, Plazas & Bridges
  onProgress(58, 'Etap 3/5: Wznoszenie mostów i sieci drogowej...', 'Filarowe mosty rzeczne, ulice i ciągi piesze');
  await yieldCtrl.yieldIfNeeded();
  yieldCtrl.checkCancellation();

  buildBankAnchoredBridges(scene, ctx, baseInfo, state, meshes, allocShellId);
  yieldCtrl.checkCancellation();

  onStageReady('roads', meshes.roads, { append: false });
  onProgress(70, 'Etap 3/5: Wyrenderowano sieć drogową i mosty', `${meshes.roads.length} trójkątów infrastruktury`);
  await yieldCtrl.yieldIfNeeded(true);
  yieldCtrl.checkCancellation();

  // STAGE 4: Buildings LoD2 (Batched by ~150-200 buildings)
  onProgress(72, 'Etap 4/5: Wznoszenie budynków 3D i dachów LoD2...', 'Hierarchiczne kondygnacje S3DB i profile dachowe');
  await yieldCtrl.yieldIfNeeded();
  yieldCtrl.checkCancellation();

  const { buildingBounds, pickIdMap } = await buildS3DBBuildingsMeshProgressive(
    scene, ctx, baseInfo, state, meshes, yieldCtrl, onStageReady, onProgress
  );
  yieldCtrl.checkCancellation();
  state.pickIdMap = pickIdMap;
  onProgress(90, 'Etap 4/5: Wyrenderowano budynki 3D i dachy LoD2', `Wygenerowano ${meshes.buildings.length + meshes.highlighted.length} trójkątów budynków`);
  await yieldCtrl.yieldIfNeeded(true);
  yieldCtrl.checkCancellation();

  // STAGE 5: Frame & Fast Topology / Metrics
  onProgress(92, 'Etap 5/5: Miterowana rama wystawowa i metryki...', 'Generowanie ramy montażowej');
  await yieldCtrl.yieldIfNeeded();
  yieldCtrl.checkCancellation();

  emitStudioWallFrame(ctx, meshes);
  onStageReady('frame', meshes.frame, { append: false });

  onProgress(95, 'Etap 5/5: Obliczanie objętości i audyt topologii...', 'Metryki druku SLA/FDM i test Photon Mono 4');
  await yieldCtrl.yieldIfNeeded();
  yieldCtrl.checkCancellation();

  const fastMetrics = computeFastVolumeAndExtents(meshes, buildingBounds, state, ctx);
  const printMetrics = await auditMeshTopologyNumeric(meshes, buildingBounds, state, ctx, fastMetrics, yieldCtrl);

  onProgress(100, 'Model 3D gotowy!', `Łącznie ${(fastMetrics.totalTriangles || 0).toLocaleString()} trójkątów`);

  return {
    meshes,
    buildingBounds,
    pickIdMap,
    totalTriangles: fastMetrics.totalTriangles,
    printMetrics
  };
}

/**
 * Complete synchronous 3D model builder (preserved for backward compatibility).
 */
function buildComplete3DModel(scene, state, options = {}) {
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
    const totalWidthMm = state.bedSizeMm || state.targetWidthMm || 320;
    const totalHeightMm = state.totalHeightMm || state.targetHeightMm || totalWidthMm;
    const maxDimMm = Math.max(totalWidthMm, totalHeightMm) || 320;
    const scaleMm = maxDimMm / 169.2;
    const halfW = 84.6 * (totalWidthMm / maxDimMm);
    const halfH = 84.6 * (totalHeightMm / maxDimMm);
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

  let nextFeatureShellId = -100;
  const allocShellId = () => (nextFeatureShellId--);

  // 1. High-resolution masks (Euclidean Water SDF, Streets, Unbroken Parks, Footpaths) & DEM Grid
  const ctx = buildTerrainAndMasks(scene, state);
  ctx.isExport = Boolean(options && options.isExport);

  // 2. Per-tile watertight stepped DEM base, SLA hollow vault ribs/drains/ID patch & smooth water basin
  const tBase0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const baseInfo = buildTerrainBaseAndWaterMeshes(ctx, state, meshes, options);
  const baseDuration = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - tBase0;
  if (state) state.lastTerrainBaseWaterDurationMs = baseDuration;

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
  module.exports = {
    buildComplete3DModel,
    rebuildModel3DProgressive,
    yieldToEventLoop,
    TimeBudgetYieldController
  };
}
