// ============================================================================
// src/mesh/features_roads.js
// Roads & Footpaths Layer: Street/Plaza/Footpath Mask Construction & 3D Road Mesh Emission
// ============================================================================

if (typeof computeEuclideanDistGrid === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/marching_squares_2d.js'));
}
if (typeof buildSmoothedBandField === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./mesh_tile_append.js'));
}

function isFootpathRoad(rd) {
  if (rd.isPath) return true;
  const rtype = rd.hwy || rd.type || rd.rtype || '';
  return rtype === 'footway' || rtype === 'path' || rtype === 'steps' ||
         rtype === 'cycleway' || rtype === 'bridleway' || rtype === 'track' || rtype === 'corridor';
}

function rasterizeRoadAndFootpathImages(scene, state, mctx, maskEnv) {
  const { MASK_RES_X, MASK_RES_Y, scaleMm, scaleToBed, pxPerUnit, toBed, bedToMask } = maskEnv;

  const lod = (state && state.lodSettings) || {};
  const spanKm = Number(state.spanKm) || (Number(state.mapSpanMeters) / 1000) || ((scene.spanMeters || 1200) / 1000);
  const roadDetail = lod.roadDetail || (spanKm > 20.0 ? 'major' : 'all');

  mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
  fillPolysOnMaskCtx(mctx, scene.roadPolys, toBed, bedToMask);
  (scene.roads || []).forEach(rd => {
    if (!rd.pts || rd.pts.length < 2 || isFootpathRoad(rd)) return;
    const rtype = rd.hwy || rd.type || rd.rtype || '';
    if (roadDetail === 'major') {
      if (['service', 'living_street', 'track', 'path', 'footway', 'cycleway', 'steps', 'pedestrian'].includes(rtype)) {
        return;
      }
    }
    const minWUnits = Math.max((rd.width || 1.0) * 0.90 * scaleToBed, 0.40 / scaleMm);
    const minRoadPx = (rtype === 'service' || rtype === 'living_street') ? 2.1 : 2.6;
    mctx.lineWidth = Math.max(minRoadPx, minWUnits * pxPerUnit + 0.25);
    mctx.beginPath();
    rd.pts.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.stroke();
  });
  const majorRoadImg = safeGetImageData(mctx, 0, 0, MASK_RES_X, MASK_RES_Y).data;

  mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
  if (roadDetail !== 'major') {
    (scene.roads || []).forEach(rd => {
      if (!rd.pts || rd.pts.length < 2 || !isFootpathRoad(rd)) return;
      const pathWUnits = Math.max(Math.min(0.62, rd.width || 0.36) * scaleToBed, 0.36 / scaleMm);
      mctx.lineWidth = Math.max(2.6, pathWUnits * pxPerUnit + 0.35);
      mctx.beginPath();
      rd.pts.forEach((p, i) => {
        const b = toBed(p);
        const [px, py] = bedToMask(b[0], b[1]);
        if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
      });
      mctx.stroke();
    });
  }
  const footpathImg = safeGetImageData(mctx, 0, 0, MASK_RES_X, MASK_RES_Y).data;

  return { majorRoadImg, footpathImg };
}

function finalizeRoadAndFootpathMasks(majorRoadImg, footpathImg, waterMask, shoreDist, bldMask, greenMask, greenInnerDist, greenOuterDist, MASK_RES_X, MASK_RES_Y) {
  const majorRoadMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  for (let i = 0; i < majorRoadMask.length; i++) {
    const clearOfWater = !waterMask[i] && shoreDist[i] >= 1.25;
    majorRoadMask[i] = (majorRoadImg[i * 4 + 3] > 96 && clearOfWater && !bldMask[i]) ? 1 : 0;
  }

  const majorRoadDist = computeEuclideanDistGrid(majorRoadMask, MASK_RES_X, MASK_RES_Y, false);

  const parkPathOnGreenMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  const parkPathOnGroundMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  const roadAndBldMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);

  for (let i = 0; i < parkPathOnGreenMask.length; i++) {
    const hasFoot = footpathImg[i * 4 + 3] > 96 && !waterMask[i] && shoreDist[i] >= 1.35 && !bldMask[i];
    if (hasFoot && greenInnerDist[i] >= 2.2 && majorRoadDist[i] >= 1.4) {
      parkPathOnGreenMask[i] = 1;
    } else if (hasFoot && !greenMask[i] && greenOuterDist[i] >= 1.8 && majorRoadDist[i] >= 1.4) {
      parkPathOnGroundMask[i] = 1;
    }
    roadAndBldMask[i] = (bldMask[i] || majorRoadMask[i] || parkPathOnGreenMask[i] || parkPathOnGroundMask[i]) ? 1 : 0;
  }

  return { majorRoadMask, majorRoadDist, parkPathOnGreenMask, parkPathOnGroundMask, roadAndBldMask };
}

function emitRoadsLayerSync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner) {
  const lv = state.layerVisible || state.layers;
  const roadsVisible = !lv || lv.roads !== false;
  if (!roadsVisible) return;
  const greenVisible = !lv || lv.greenery !== false;

  const {
    MASK_RES_X, MASK_RES_Y,
    majorRoadMask, parkPathOnGreenMask, parkPathOnGroundMask,
    thresholds, gHeight, rHeight, pathHeight
  } = ctx;
  const { maxBandK, pixelBandIdx, printedSurfaceState, bandHasGreen } = bandAssigner;
  const bandMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  const strictGreenPathMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  const strictGroundPathMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);

  for (let k = 0; k <= maxBandK; k++) {
    let countK = 0;
    for (let i = 0; i < pixelBandIdx.length; i++) {
      const hit = pixelBandIdx[i] === k ? 1 : 0;
      bandMask[i] = hit;
      countK += hit;
    }
    if (countK < 6) continue;
    const tZ = thresholds[k];

    const roadField = buildSmoothedBandField(majorRoadMask, bandMask, MASK_RES_X, MASK_RES_Y);
    emitMarchingSquaresBandPolygonsSync(roadField, tZ, tZ + rHeight, 3, meshes.roads, 0.020, 0.52, bandAssigner, ctx, allocShellId);

    if (greenVisible && bandHasGreen[k]) {
      strictGreenPathMask.fill(0);
      strictGroundPathMask.fill(0);
      for (let iy = 0; iy < MASK_RES_Y; iy++) {
        const srcRow = (MASK_RES_Y - 1 - iy) * MASK_RES_X;
        const dstRow = iy * MASK_RES_X;
        for (let ix = 0; ix < MASK_RES_X; ix++) {
          const st = printedSurfaceState[dstRow + ix];
          if (st === 1 && parkPathOnGreenMask[srcRow + ix]) strictGreenPathMask[srcRow + ix] = 1;
          else if (st === 2 && (parkPathOnGroundMask[srcRow + ix] || parkPathOnGreenMask[srcRow + ix])) strictGroundPathMask[srcRow + ix] = 1;
        }
      }
      emitMarchingSquaresBandPolygonsSync(buildSmoothedBandField(strictGreenPathMask, bandMask, MASK_RES_X, MASK_RES_Y), tZ + gHeight, tZ + gHeight + pathHeight, 3, meshes.roads, 0.014, 0.48, bandAssigner, ctx, allocShellId);
      emitMarchingSquaresBandPolygonsSync(buildSmoothedBandField(strictGroundPathMask, bandMask, MASK_RES_X, MASK_RES_Y), tZ, tZ + pathHeight, 3, meshes.roads, 0.016, 0.52, bandAssigner, ctx, allocShellId);
    } else {
      emitMarchingSquaresBandPolygonsSync(buildSmoothedBandField(parkPathOnGreenMask, bandMask, MASK_RES_X, MASK_RES_Y), tZ, tZ + pathHeight, 3, meshes.roads, 0.014, 0.48, bandAssigner, ctx, allocShellId);
      emitMarchingSquaresBandPolygonsSync(buildSmoothedBandField(parkPathOnGroundMask, bandMask, MASK_RES_X, MASK_RES_Y), tZ, tZ + pathHeight, 3, meshes.roads, 0.016, 0.52, bandAssigner, ctx, allocShellId);
    }
  }
}

async function emitRoadsLayerAsync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl, progressTracker = null) {
  const lv = state.layerVisible || state.layers;
  const roadsVisible = !lv || lv.roads !== false;
  if (!roadsVisible) return;
  const greenVisible = !lv || lv.greenery !== false;

  const {
    MASK_RES_X, MASK_RES_Y,
    majorRoadMask, parkPathOnGreenMask, parkPathOnGroundMask,
    thresholds, gHeight, rHeight, pathHeight
  } = ctx;
  const { maxBandK, pixelBandIdx, printedSurfaceState, bandHasGreen } = bandAssigner;
  const bandMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  const strictGreenPathMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  const strictGroundPathMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);

  for (let k = 0; k <= maxBandK; k++) {
    if (yieldCtrl) {
      yieldCtrl.checkCancellation();
      await yieldCtrl.yieldIfNeeded();
    }
    let countK = 0;
    for (let i = 0; i < pixelBandIdx.length; i++) {
      const hit = pixelBandIdx[i] === k ? 1 : 0;
      bandMask[i] = hit;
      countK += hit;
    }
    if (countK < 6) continue;
    const tZ = thresholds[k];
    const pOpts = { progressType: 'roads', bandK: k, tracker: progressTracker };

    const roadField = buildSmoothedBandField(majorRoadMask, bandMask, MASK_RES_X, MASK_RES_Y);
    await emitMarchingSquaresBandPolygonsAsync(roadField, tZ, tZ + rHeight, 3, meshes.roads, 0.020, 0.52, bandAssigner, ctx, allocShellId, yieldCtrl, pOpts);

    if (greenVisible && bandHasGreen[k]) {
      strictGreenPathMask.fill(0);
      strictGroundPathMask.fill(0);
      for (let iy = 0; iy < MASK_RES_Y; iy++) {
        const srcRow = (MASK_RES_Y - 1 - iy) * MASK_RES_X;
        const dstRow = iy * MASK_RES_X;
        for (let ix = 0; ix < MASK_RES_X; ix++) {
          const st = printedSurfaceState[dstRow + ix];
          if (st === 1 && parkPathOnGreenMask[srcRow + ix]) strictGreenPathMask[srcRow + ix] = 1;
          else if (st === 2 && (parkPathOnGroundMask[srcRow + ix] || parkPathOnGreenMask[srcRow + ix])) strictGroundPathMask[srcRow + ix] = 1;
        }
      }
      await emitMarchingSquaresBandPolygonsAsync(buildSmoothedBandField(strictGreenPathMask, bandMask, MASK_RES_X, MASK_RES_Y), tZ + gHeight, tZ + gHeight + pathHeight, 3, meshes.roads, 0.014, 0.48, bandAssigner, ctx, allocShellId, yieldCtrl, pOpts);
      await emitMarchingSquaresBandPolygonsAsync(buildSmoothedBandField(strictGroundPathMask, bandMask, MASK_RES_X, MASK_RES_Y), tZ, tZ + pathHeight, 3, meshes.roads, 0.016, 0.52, bandAssigner, ctx, allocShellId, yieldCtrl, pOpts);
    } else {
      await emitMarchingSquaresBandPolygonsAsync(buildSmoothedBandField(parkPathOnGreenMask, bandMask, MASK_RES_X, MASK_RES_Y), tZ, tZ + pathHeight, 3, meshes.roads, 0.014, 0.48, bandAssigner, ctx, allocShellId, yieldCtrl, pOpts);
      await emitMarchingSquaresBandPolygonsAsync(buildSmoothedBandField(parkPathOnGroundMask, bandMask, MASK_RES_X, MASK_RES_Y), tZ, tZ + pathHeight, 3, meshes.roads, 0.016, 0.52, bandAssigner, ctx, allocShellId, yieldCtrl, pOpts);
    }
  }
}

function emitRoadsLayer(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl = null, progressTracker = null) {
  if (yieldCtrl) {
    return emitRoadsLayerAsync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl, progressTracker);
  }
  return emitRoadsLayerSync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner);
}

if (typeof window !== 'undefined') {
  window.isFootpathRoad = isFootpathRoad;
  window.rasterizeRoadAndFootpathImages = rasterizeRoadAndFootpathImages;
  window.finalizeRoadAndFootpathMasks = finalizeRoadAndFootpathMasks;
  window.emitRoadsLayer = emitRoadsLayer;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isFootpathRoad,
    rasterizeRoadAndFootpathImages,
    finalizeRoadAndFootpathMasks,
    emitRoadsLayerSync,
    emitRoadsLayerAsync,
    emitRoadsLayer
  };
}
