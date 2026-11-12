// ============================================================================
// src/mesh/features_greenery.js
// Greenery Layer: Park/Forest/Lawn Mask Construction & 3D Greenery Mesh Emission
// ============================================================================

if (typeof computeEuclideanDistGrid === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/marching_squares_2d.js'));
}
if (typeof buildSmoothedBandField === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./mesh_tile_append.js'));
}

function buildRawGreeneryMask(scene, mctx, maskEnv) {
  const { MASK_RES_X, MASK_RES_Y, scaleMm, pxPerUnit, toBed, bedToMask } = maskEnv;

  mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
  fillPolysOnMaskCtx(mctx, scene.greenPolys || scene.greeneryPolys, toBed, bedToMask);
  mctx.lineWidth = Math.max(1.15, Math.min(0.22, 0.28 / scaleMm) * pxPerUnit);
  (scene.greenPolys || scene.greeneryPolys || []).forEach(poly => {
    if (!poly || !poly.outer || poly.outer.length < 3 || (poly.holes && poly.holes.length > 0)) return;
    mctx.beginPath();
    poly.outer.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.closePath();
    mctx.stroke();
  });
  const rawGreenImg = safeGetImageData(mctx, 0, 0, MASK_RES_X, MASK_RES_Y).data;
  const rawGreenMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  for (let i = 0; i < rawGreenMask.length; i++) rawGreenMask[i] = rawGreenImg[i * 4 + 3] > 64 ? 1 : 0;
  return rawGreenMask;
}

function finalizeGreeneryMask(rawGreenMask, waterMask, shoreDist, bldMask, majorRoadImg, MASK_RES_X, MASK_RES_Y) {
  const greenMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  for (let i = 0; i < greenMask.length; i++) {
    const clearOfWater = !waterMask[i] && shoreDist[i] >= 1.25;
    const clearRoadHalo = majorRoadImg[i * 4 + 3] <= 96;
    greenMask[i] = (rawGreenMask[i] && clearOfWater && !bldMask[i] && clearRoadHalo) ? 1 : 0;
  }
  const greenInnerDist = computeEuclideanDistGrid(greenMask, MASK_RES_X, MASK_RES_Y, true);
  const greenOuterDist = computeEuclideanDistGrid(greenMask, MASK_RES_X, MASK_RES_Y, false);
  return { greenMask, greenInnerDist, greenOuterDist };
}

function _markPrintedGreenerySupport(greenField, bandMask, printedSurfaceState, MASK_RES_X, MASK_RES_Y) {
  if (!greenField) return;
  for (let iy = 1; iy < MASK_RES_Y - 1; iy++) {
    const row = iy * MASK_RES_X;
    for (let ix = 1; ix < MASK_RES_X - 1; ix++) {
      if (!bandMask[row + ix]) continue;
      const gf = greenField[row + ix];
      if (gf >= 0.78 &&
          greenField[row - MASK_RES_X + ix] >= 0.56 && greenField[row + MASK_RES_X + ix] >= 0.56 &&
          greenField[row + ix - 1] >= 0.56 && greenField[row + ix + 1] >= 0.56) {
        printedSurfaceState[row + ix] = 1;
      } else if (gf > 0.24) {
        printedSurfaceState[row + ix] = 0; // boundary transition zone — footpaths stay off lawn edge
      }
    }
  }
}

function emitGreeneryLayerSync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner) {
  const lv = state.layerVisible || state.layers;
  const greenVisible = !lv || lv.greenery !== false;
  if (!greenVisible) return;

  const { MASK_RES_X, MASK_RES_Y, greenMask, thresholds, gHeight } = ctx;
  const scaleMm = ctx.scaleMm || 1.89;
  const greenMinArea = Math.min(0.030, 0.085 / (scaleMm * scaleMm));
  const greenIso = 0.48;
  const { maxBandK, pixelBandIdx, printedSurfaceState, bandHasGreen } = bandAssigner;
  const bandMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);

  for (let k = 0; k <= maxBandK; k++) {
    let countK = 0;
    for (let i = 0; i < pixelBandIdx.length; i++) {
      const hit = pixelBandIdx[i] === k ? 1 : 0;
      bandMask[i] = hit;
      countK += hit;
    }
    if (countK < 6) continue;
    const tZ = thresholds[k];

    const greenField = buildSmoothedBandField(greenMask, bandMask, MASK_RES_X, MASK_RES_Y);
    bandHasGreen[k] = greenField ? 1 : 0;
    emitMarchingSquaresBandPolygonsSync(greenField, tZ, tZ + gHeight, 2, meshes.greenery, greenMinArea, greenIso, bandAssigner, ctx, allocShellId);
    _markPrintedGreenerySupport(greenField, bandMask, printedSurfaceState, MASK_RES_X, MASK_RES_Y);
  }
}

async function emitGreeneryLayerAsync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl, progressTracker = null) {
  const lv = state.layerVisible || state.layers;
  const greenVisible = !lv || lv.greenery !== false;
  if (!greenVisible) return;

  const { MASK_RES_X, MASK_RES_Y, greenMask, thresholds, gHeight } = ctx;
  const scaleMm = ctx.scaleMm || 1.89;
  const greenMinArea = Math.min(0.030, 0.085 / (scaleMm * scaleMm));
  const greenIso = 0.48;
  const { maxBandK, pixelBandIdx, printedSurfaceState, bandHasGreen } = bandAssigner;
  const bandMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);

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

    const greenField = buildSmoothedBandField(greenMask, bandMask, MASK_RES_X, MASK_RES_Y);
    bandHasGreen[k] = greenField ? 1 : 0;
    await emitMarchingSquaresBandPolygonsAsync(
      greenField, tZ, tZ + gHeight, 2, meshes.greenery, greenMinArea, greenIso,
      bandAssigner, ctx, allocShellId, yieldCtrl,
      { progressType: 'greenery', bandK: k, tracker: progressTracker }
    );
    _markPrintedGreenerySupport(greenField, bandMask, printedSurfaceState, MASK_RES_X, MASK_RES_Y);
  }
}

function emitGreeneryLayer(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl = null, progressTracker = null) {
  if (yieldCtrl) {
    return emitGreeneryLayerAsync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl, progressTracker);
  }
  return emitGreeneryLayerSync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner);
}

if (typeof window !== 'undefined') {
  window.buildRawGreeneryMask = buildRawGreeneryMask;
  window.finalizeGreeneryMask = finalizeGreeneryMask;
  window.emitGreeneryLayer = emitGreeneryLayer;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildRawGreeneryMask,
    finalizeGreeneryMask,
    emitGreeneryLayerSync,
    emitGreeneryLayerAsync,
    emitGreeneryLayer
  };
}
