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
  const { tileCols, tileRows, tileBounds, halfW, halfH } = ctx;
  const { prepared, clusters, pickIdMap } = prepareAndClusterS3DBBuildings(scene, ctx, baseInfo, state);
  const buildingBounds = [];

  // 1. Support-Aware Hierarchical Z-Tier Resolution
  for (const [, cluster] of clusters) {
    if (cluster.length <= 1) continue;
    cluster.sort((a, b) => (a.zTop - b.zTop) || (b.area - a.area));

    for (let i = 0; i < cluster.length; i++) {
      const C = cluster[i];
      if (C.skip) continue;
      for (let j = 0; j < cluster.length; j++) {
        if (i === j || cluster[j].skip) continue;
        const P = cluster[j];
        if (Math.abs(C.zTop - P.zTop) < 0.04 && C.area <= P.area * 1.01) {
          if (isPointInsidePart2D(C.interiorPt[0], C.interiorPt[1], P, 0.03) &&
              C.clippedOuter.every(pt => isPointInsidePart2D(pt[0], pt[1], P, 0.03))) {
            C.skip = true;
            break;
          }
        }
        if (C.zTop < P.zTop - 0.05 && (C.scaledMinH || 0) <= 0.01 && (P.scaledMinH || 0) <= 0.01 && C.area <= P.area * 0.96) {
          if (isPointInsidePart2D(C.interiorPt[0], C.interiorPt[1], P, 0.03) &&
              C.clippedOuter.every(pt => isPointInsidePart2D(pt[0], pt[1], P, 0.03))) {
            C.skip = true;
            break;
          }
        }
      }
    }

    const flattenSupportingPodium = (P) => {
      P.roofShape = 'flat';
      P.hasPitched = false;
      P.zRidge = P.zEaves;
      P.zTop = P.zEaves;
      for (let m = 0; m < cluster.length; m++) {
        if (cluster[m].supportRef === P) cluster[m].effBaseZ = P.zTop;
      }
    };

    for (let i = 0; i < cluster.length; i++) {
      const C = cluster[i];
      if (C.skip) continue;
      const candidates = cluster.filter((P, idx) => idx < i && !P.skip && P.zTop <= C.zTop + 0.01);
      const directUnder = candidates.filter(P => {
        if (C.scaledMinH !== undefined && C.scaledMinH > 0.01) {
          const expectedZ = C.tZ + C.scaledMinH;
          if (Math.abs(P.zTop - expectedZ) > 0.35 && P.zTop < expectedZ - 0.05) return false;
        }
        if (!isPointInsidePart2D(C.interiorPt[0], C.interiorPt[1], P, 0.02)) return false;
        const samples = C.samplePts || [C.interiorPt];
        return samples.filter(pt => isPointInsidePart2D(pt[0], pt[1], P, 0.01)).length >= Math.ceil(samples.length * 0.45);
      });

      if (directUnder.length > 0) {
        directUnder.sort((a, b) => (b.zTop - a.zTop) || (b.area - a.area));
        const bestP = directUnder[0];
        C.supportRef = bestP;
        C.effBaseZ = bestP.zTop;
        const samples = C.samplePts || [C.interiorPt];
        if (samples.length >= 2 && !samples.every(pt => isPointInsidePart2D(pt[0], pt[1], bestP, 0.01))) {
          C.isLateralCantilever = true;
        }
        if (bestP.hasPitched) {
          const samplesCovered = samples.every(pt => isPointInsidePart2D(pt[0], pt[1], bestP, 0.0));
          if (C.area >= bestP.area * 0.45 || (C.isTowerOrCore && !samplesCovered)) {
            flattenSupportingPodium(bestP);
          } else {
            C.effBaseZ = Math.max(bestP.zEaves, bestP.zTop);
          }
        }
      } else {
        const spanTol = Math.max(0.08, C.maxSpan * 0.06);
        const adjUnder = candidates.filter(P => {
          if (C.zTop < P.zTop - 0.08) return false;
          const dz = Math.abs(C.effBaseZ - P.zTop);
          return dz <= spanTol || (C.effBaseZ <= P.zTop && C.zTop >= P.zTop);
        });

        if (adjUnder.length > 0) {
          adjUnder.sort((a, b) => b.zTop - a.zTop);
          const topAdjZ = adjUnder[0].zTop;
          const vertSupps = adjUnder.filter(P => Math.abs(P.zTop - topAdjZ) <= 0.08);
          const samples = C.samplePts || [C.interiorPt];
          const bestP = vertSupps[0];
          if (isPointInsidePart2D(C.interiorPt[0], C.interiorPt[1], bestP, 0.025) &&
              samples.every(pt => isPointInsidePart2D(pt[0], pt[1], bestP, 0.025)) &&
              C.area <= bestP.area * 1.05) {
            C.supportRef = bestP;
            C.effBaseZ = topAdjZ;
            if (bestP.hasPitched) flattenSupportingPodium(bestP);
          } else {
            const cores = cluster.filter(K => !K.skip && K.zTop >= C.zTop - 0.05 && K !== C);
            if (cores.length > 0) {
              const maxDistToCore = Math.max(...samples.map(pt =>
                Math.min(...cores.map(K => isPointInsidePart2D(pt[0], pt[1], K, 0) ? 0 : distToPolygonBoundary2D(pt[0], pt[1], K.clippedOuter, K.clippedHoles)))
              ));
              if (maxDistToCore <= 0.65) C.isLateralCantilever = true;
            }
          }
        }
      }
    }

    for (let i = 0; i < cluster.length; i++) {
      const C = cluster[i];
      if (C.skip || C.roofShape !== 'skillion' || !C.b || C.b.roofDir !== undefined) continue;
      const tallerAdj = cluster.filter(P => !P.skip && P !== C && P.zTop >= C.zTop - 0.02);
      if (tallerAdj.length > 0) {
        let bestDist = Infinity, bestCore = null;
        for (let k = 0; k < tallerAdj.length; k++) {
          const d = Math.hypot(C.cx - tallerAdj[k].cx, C.cy - tallerAdj[k].cy);
          if (d < bestDist) {
            bestDist = d;
            bestCore = tallerAdj[k];
          }
        }
        C.leanTargetPt = [bestCore.cx, bestCore.cy];
      }
    }

    await yieldCtrl.tick();
  }

  // 2. Extrude Watertight 2-Manifold LoD2 Shells in Adaptive Time-Sliced Batches
  let nextBldShellId = 1;
  const activeItems = prepared.filter(it => !it.skip);
  const CHUNK_FLUSH_SIZE = 40;
  let chunkBuildingsTris = [];
  let chunkHlTris = [];

  for (let i = 0; i < activeItems.length; i++) {
    yieldCtrl.checkCancellation();
    const item = activeItems[i];
    const bld = item.b;

    const isHl = item.clusterHighlighted || !!bld.highlighted;
    const targetLayerId = isHl ? 5 : 4;
    const targetBatchArr = isHl ? chunkHlTris : chunkBuildingsTris;
    const targetMainList = isHl ? meshes.highlighted : meshes.buildings;

    if (item.zTop <= item.effBaseZ + 0.04) {
      item.zTop = item.effBaseZ + 0.45;
      item.zEaves = item.zTop;
      item.zRidge = item.zTop;
      item.hasPitched = false;
    } else if (item.zEaves < item.effBaseZ + 0.04) {
      item.zEaves = item.effBaseZ + Math.min(0.25, (item.zTop - item.effBaseZ) * 0.5);
    }

    const bShell = [];
    const shellId = nextBldShellId++;

    extrudeBuildingLoD2(
      item.clippedOuter,
      item.clippedHoles,
      item.effBaseZ,
      item.zEaves,
      item.zRidge,
      item.hasPitched,
      targetLayerId,
      item.pickId,
      bShell,
      0,
      item.roofShape || 'flat',
      {
        roofDir: bld.roofDir,
        roofOrient: bld.roofOrient,
        leanTargetPt: item.leanTargetPt || null
      }
    );

    const tagElevatedBottom = (t) => {
      if (item.effBaseZ > item.tZ + 0.05 && t.n && t.n[2] < -0.5) {
        t.n = [0, 0, -0.49];
      }
    };

    for (let ti = 0; ti < bShell.length; ti++) {
      bShell[ti].shellId = shellId;
      tagElevatedBottom(bShell[ti]);
    }

    const numTiles = (tileCols || 1) * (tileRows || 1);
    if (numTiles > 1 && (ctx.isExport || numTiles <= 400) && ctx.tileBounds && typeof splitClosedShellToTileGrid3D === 'function') {
      const pieces = splitClosedShellToTileGrid3D(bShell, ctx.tileBounds, tileCols, tileRows);
      for (let ti = 0; ti < pieces.length; ti++) {
        tagElevatedBottom(pieces[ti]);
        targetMainList.push(pieces[ti]);
        targetBatchArr.push(pieces[ti]);
      }
    } else {
      const cx = (item.minX + item.maxX) * 0.5;
      const cy = (item.minY + item.maxY) * 0.5;
      const tileId = (tileCols <= 1 && tileRows <= 1)
        ? 0
        : (typeof getTileIdForCentroid === 'function' ? getTileIdForCentroid(cx, cy, halfW, halfH, tileCols, tileRows) : 0);

      for (let ti = 0; ti < bShell.length; ti++) {
        bShell[ti].tileId = tileId;
        tagElevatedBottom(bShell[ti]);
        targetMainList.push(bShell[ti]);
        targetBatchArr.push(bShell[ti]);
      }
    }

    buildingBounds.push({
      building: bld,
      shellId,
      pickId: item.pickId,
      groupId: item.groupId,
      interiorPt: item.interiorPt,
      samplePts: [item.interiorPt, item.clippedOuter[0]],
      isCantileverSupported: !!item.isLateralCantilever,
      minX: item.minX,
      maxX: item.maxX,
      minY: item.minY,
      maxY: item.maxY,
      minZ: item.effBaseZ,
      maxZ: item.hasPitched ? item.zRidge : item.zEaves,
      layerId: targetLayerId
    });

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
