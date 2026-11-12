// ============================================================================
// src/mesh/features_trees.js
// Organic 3D Tree Crowns Layer (LoD Visibility, Clearance Validation & Tile Clipping)
// ============================================================================

if (typeof addTreeCrown3D === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./mesh_primitives.js'));
}
if (typeof appendShellClippedToTiles === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./mesh_tile_append.js'));
}

function isTreesLayerVisible(scene, state) {
  const lv = state.layerVisible || state.layers;
  const lod = (state && state.lodSettings) || {};
  const spanKm = Number(state.spanKm) || (Number(state.mapSpanMeters) / 1000) || ((scene.spanMeters || 1200) / 1000);
  const allDetailsFilter = (lod.minBuildingFootprintM === 0 || lod.minBuildingMeters === 0 || state.minFeatureSizeMeters === 0 || state.minBuildingMeters === 0);
  const defaultTreeKm = allDetailsFilter ? 6.0 : 4.5;
  const treeThresholdKm = (lod.treeThresholdKm !== undefined)
    ? Number(lod.treeThresholdKm)
    : (lod.treeMaxSpanKm !== undefined ? Number(lod.treeMaxSpanKm) : defaultTreeKm);
  const userEnableTrees = (lod.enableTrees !== undefined) ? Boolean(lod.enableTrees) : true;
  const allowTreesByScale = spanKm <= treeThresholdKm;
  return (!lv || lv.trees !== false) && userEnableTrees && allowTreesByScale;
}

function emitTreesLayerSync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner) {
  if (!isTreesLayerVisible(scene, state)) return;

  const lv = state.layerVisible || state.layers;
  const greenVisible = !lv || lv.greenery !== false;
  const {
    halfW, halfH, mToU,
    toBed, sampleMaskIdx,
    waterMask, greenMask, roadAndBldMask,
    thresholds, gHeight
  } = ctx;
  const scaleMm = ctx.scaleMm || 1.89;
  const bldMask = ctx.bldMask || roadAndBldMask;
  const { pixelBandIdx, printedSurfaceState, sampleMSIdx } = bandAssigner;

  const placedTrees = [];
  (scene.trees || []).forEach((tr, idx) => {
    const [bx, by] = toBed([tr[0], tr[1]]);
    if (bx < -halfW + 0.9 || bx > halfW - 0.9 || by < -halfH + 0.9 || by > halfH - 0.9) return;
    const mIdx = sampleMaskIdx(bx, by);
    if (waterMask[mIdx] || roadAndBldMask[mIdx]) return;

    const msCenter = sampleMSIdx(bx, by);
    const kCenter = pixelBandIdx[msCenter];
    const surfState = printedSurfaceState[msCenter];
    if (kCenter < 0) return;

    const realRadiusM = 3.2 + (idx % 5) * 0.55;
    const osmH = (Number(tr[2]) > 2.0) ? Number(tr[2]) : (6.0 + (idx % 6) * 0.75);
    const treeRadius = Math.max(0.24, Math.min(0.44, Math.max(realRadiusM * mToU * 1.30, 0.75 / scaleMm)));
    const baseTreeH = Math.max(0.30, Math.min(0.64, Math.max(osmH * mToU * 1.15, 0.92 / scaleMm) * (state.zScale || 1.0)));

    const checkR = treeRadius * 1.04;
    const innerCheckR = treeRadius * 0.65;
    let crownValid = true;
    let allOnLawn = (surfState === 1);
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const px = bx + ca * checkR;
      const py = by + sa * checkR;
      const pMask = sampleMaskIdx(px, py);
      const pMS = sampleMSIdx(px, py);
      const pInnerMask = sampleMaskIdx(bx + ca * innerCheckR, by + sa * innerCheckR);
      if (waterMask[pMask] || bldMask[pMask] || roadAndBldMask[pInnerMask] || pixelBandIdx[pMS] !== kCenter) {
        crownValid = false; break;
      }
      if (printedSurfaceState[pMS] !== 1) allOnLawn = false;
    }
    if (!crownValid) return;

    for (let j = 0; j < placedTrees.length; j++) {
      const pt = placedTrees[j];
      if (Math.hypot(bx - pt[0], by - pt[1]) < (treeRadius + pt[2]) * 0.96) return;
    }
    placedTrees.push([bx, by, treeRadius]);

    const tZ = thresholds[kCenter];
    const onLawn = (allOnLawn && greenVisible);
    const zGround = onLawn ? (tZ + gHeight) : tZ;
    const effTreeHeight = onLawn
      ? baseTreeH
      : (baseTreeH + ((surfState === 1 || surfState === 0 || greenMask[mIdx]) && greenVisible ? gHeight : 0));
    const treeShell = [];
    addTreeCrown3D(bx, by, zGround, treeRadius, effTreeHeight, 2, treeShell, 0, allocShellId());
    appendShellClippedToTiles(treeShell, ctx, meshes.greenery);
  });
}

async function emitTreesLayerAsync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl, progressTracker = null) {
  if (!isTreesLayerVisible(scene, state)) return;

  const lv = state.layerVisible || state.layers;
  const greenVisible = !lv || lv.greenery !== false;
  const {
    halfW, halfH, mToU,
    toBed, sampleMaskIdx,
    waterMask, greenMask, roadAndBldMask,
    thresholds, gHeight
  } = ctx;
  const scaleMm = ctx.scaleMm || 1.89;
  const bldMask = ctx.bldMask || roadAndBldMask;
  const { pixelBandIdx, printedSurfaceState, sampleMSIdx } = bandAssigner;

  const placedTrees = [];
  const treeList = scene.trees || [];
  const totalTrees = Math.max(1, treeList.length);

  for (let idx = 0; idx < treeList.length; idx++) {
    if ((idx & 31) === 0) {
      if (yieldCtrl) {
        yieldCtrl.checkCancellation();
        await yieldCtrl.yieldIfNeeded();
      }
      if (progressTracker && progressTracker.onProgress) {
        const treeFrac = 0.90 + (idx / totalTrees) * 0.10;
        const pct = 42 + Math.min(12, Math.round(treeFrac * 12));
        if (pct !== progressTracker.lastReportedPct) {
          progressTracker.lastReportedPct = pct;
          progressTracker.onProgress(
            pct,
            `Etap 2/5: Osadzanie koron drzew 3D (${idx + 1}/${totalTrees})...`,
            `Organiczne korony drzew (${placedTrees.length} posadzonych)`
          );
        }
      }
    }

    const tr = treeList[idx];
    const [bx, by] = toBed([tr[0], tr[1]]);
    if (bx < -halfW + 0.9 || bx > halfW - 0.9 || by < -halfH + 0.9 || by > halfH - 0.9) continue;
    const mIdx = sampleMaskIdx(bx, by);
    if (waterMask[mIdx] || roadAndBldMask[mIdx]) continue;

    const msCenter = sampleMSIdx(bx, by);
    const kCenter = pixelBandIdx[msCenter];
    const surfState = printedSurfaceState[msCenter];
    if (kCenter < 0) return;

    const realRadiusM = 3.2 + (idx % 5) * 0.55;
    const osmH = (Number(tr[2]) > 2.0) ? Number(tr[2]) : (6.0 + (idx % 6) * 0.75);
    const treeRadius = Math.max(0.24, Math.min(0.44, Math.max(realRadiusM * mToU * 1.30, 0.75 / scaleMm)));
    const baseTreeH = Math.max(0.30, Math.min(0.64, Math.max(osmH * mToU * 1.15, 0.92 / scaleMm) * (state.zScale || 1.0)));

    const checkR = treeRadius * 1.04;
    const innerCheckR = treeRadius * 0.65;
    let crownValid = true;
    let allOnLawn = (surfState === 1);
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const px = bx + ca * checkR;
      const py = by + sa * checkR;
      const pMask = sampleMaskIdx(px, py);
      const pMS = sampleMSIdx(px, py);
      const pInnerMask = sampleMaskIdx(bx + ca * innerCheckR, by + sa * innerCheckR);
      if (waterMask[pMask] || bldMask[pMask] || roadAndBldMask[pInnerMask] || pixelBandIdx[pMS] !== kCenter) {
        crownValid = false; break;
      }
      if (printedSurfaceState[pMS] !== 1) allOnLawn = false;
    }
    if (!crownValid) continue;

    let collided = false;
    for (let j = 0; j < placedTrees.length; j++) {
      const pt = placedTrees[j];
      if (Math.hypot(bx - pt[0], by - pt[1]) < (treeRadius + pt[2]) * 0.96) {
        collided = true;
        break;
      }
    }
    if (collided) continue;
    placedTrees.push([bx, by, treeRadius]);

    const tZ = thresholds[kCenter];
    const onLawn = (allOnLawn && greenVisible);
    const zGround = onLawn ? (tZ + gHeight) : tZ;
    const effTreeHeight = onLawn
      ? baseTreeH
      : (baseTreeH + ((surfState === 1 || surfState === 0 || greenMask[mIdx]) && greenVisible ? gHeight : 0));
    const treeShell = [];
    addTreeCrown3D(bx, by, zGround, treeRadius, effTreeHeight, 2, treeShell, 0, allocShellId());
    appendShellClippedToTiles(treeShell, ctx, meshes.greenery);
  }
}

function emitTreesLayer(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl = null, progressTracker = null) {
  if (yieldCtrl) {
    return emitTreesLayerAsync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl, progressTracker);
  }
  return emitTreesLayerSync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner);
}

if (typeof window !== 'undefined') {
  window.isTreesLayerVisible = isTreesLayerVisible;
  window.emitTreesLayer = emitTreesLayer;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isTreesLayerVisible,
    emitTreesLayerSync,
    emitTreesLayerAsync,
    emitTreesLayer
  };
}
