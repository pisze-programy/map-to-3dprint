// ============================================================================
// src/mesh/terrain_masks.js
// Scene Coordinate Transform & Per-Layer Mask Orchestrator
// (Delegates Water SDF, Greenery Masks, and Road/Footpath Masks to single-layer modules)
// ============================================================================

if (typeof computeEuclideanDistGrid === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
  Object.assign(global, require('../geometry/obb_medial_2d.js'));
  Object.assign(global, require('../geometry/marching_squares_2d.js'));
  Object.assign(global, require('./terrain_dem_grid.js'));
}
if (typeof safeGetImageData === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./mesh_tile_append.js'));
}
if (typeof buildWaterMasksAndSDF === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./water_masks.js'));
}
if (typeof buildRawGreeneryMask === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./features_greenery.js'));
}
if (typeof rasterizeRoadAndFootpathImages === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./features_roads.js'));
}

function buildTerrainAndMasks(scene, state) {
  const totalWidthMm = state.bedSizeMm || state.targetWidthMm || 320;
  const totalHeightMm = state.totalHeightMm || state.targetHeightMm || totalWidthMm;
  const maxDimMm = Math.max(totalWidthMm, totalHeightMm);
  const scaleMm = maxDimMm / 169.2;
  const mmPerUnit = scaleMm;
  const halfW = 84.6 * (totalWidthMm / maxDimMm);
  const halfH = 84.6 * (totalHeightMm / maxDimMm);

  const tileCols = Math.max(1, Math.min(50, state.tileCols || 1));
  const tileRows = Math.max(1, Math.min(100, state.tileRows || 1));
  const numTiles = tileCols * tileRows;

  // Budget total terrain resolution (~180x180 crisp shoreline/DEM cells on normal grids, capped at 240x240 on 50x100 stress grids)
  const maxAxisRes = 240;
  const desiredAxisRes = 180;
  const cellsPerCol = (numTiles <= 400)
    ? Math.max(1, Math.min(Math.floor(maxAxisRes / tileCols), Math.max(14, Math.round((desiredAxisRes * (totalWidthMm / maxDimMm)) / tileCols))))
    : Math.max(1, Math.min(14, Math.floor(maxAxisRes / tileCols)));
  const TERRAIN_RES_X = cellsPerCol * tileCols;
  const cellsPerRow = (numTiles <= 400)
    ? Math.max(1, Math.min(Math.floor(maxAxisRes / tileRows), Math.max(12, Math.round((desiredAxisRes * (totalHeightMm / maxDimMm)) / tileRows))))
    : Math.max(1, Math.min(10, Math.floor(maxAxisRes / tileRows)));
  const TERRAIN_RES_Y = cellsPerRow * tileRows;

  const cellStepX = (2 * halfW) / TERRAIN_RES_X;
  const cellStepY = (2 * halfH) / TERRAIN_RES_Y;
  const kerfMm = (tileCols > 1 || tileRows > 1)
    ? ((state.kerfMm !== undefined) ? state.kerfMm * 0.5 : (state.isResin ? 0.04 : 0.02))
    : 0.0;
  const kerfUnits = kerfMm / scaleMm;

  const baseCrop = scene._fetchedCropRatio || 1.0;
  const effectiveCrop = Math.min(1.0, Math.max(0.35, (state.cropRatio || 0.88) / baseCrop));
  const cropCX = (state.cropCenterX || 0) * halfW;
  const cropCY = (state.cropCenterY || 0) * halfH;
  const scaleToBed = 1.0 / effectiveCrop;

  function toBed(pt) {
    return [(pt[0] - cropCX) * scaleToBed, (pt[1] - cropCY) * scaleToBed];
  }

  const baseMaskRes = (numTiles <= 400 && maxDimMm >= 400) ? 864 : 720;
  const MASK_RES_X = Math.max(256, Math.round(baseMaskRes * (totalWidthMm / maxDimMm)));
  const MASK_RES_Y = Math.max(256, Math.round(baseMaskRes * (totalHeightMm / maxDimMm)));
  const maskCanvas = (typeof document !== 'undefined' && document.createElement)
    ? document.createElement('canvas')
    : createSoftwareMaskCanvas(MASK_RES_X, MASK_RES_Y);
  maskCanvas.width = MASK_RES_X;
  maskCanvas.height = MASK_RES_Y;
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });

  const padW = halfW + 0.4;
  const padH = halfH + 0.4;
  const spanW = 2 * padW;
  const spanH = 2 * padH;
  const pxPerUnit = MASK_RES_X / spanW;

  function bedToMask(bx, by) {
    return [((bx + padW) / spanW) * MASK_RES_X, ((padH - by) / spanH) * MASK_RES_Y];
  }
  function sampleMaskIdx(bx, by) {
    const mx = Math.min(MASK_RES_X - 1, Math.max(0, Math.floor(((bx + padW) / spanW) * MASK_RES_X)));
    const my = Math.min(MASK_RES_Y - 1, Math.max(0, Math.floor(((padH - by) / spanH) * MASK_RES_Y)));
    return my * MASK_RES_X + mx;
  }
  function sampleBilinearMask(buf, bx, by) {
    const [mx, my] = bedToMask(bx, by);
    const fx = Math.min(MASK_RES_X - 1.001, Math.max(0, mx));
    const fy = Math.min(MASK_RES_Y - 1.001, Math.max(0, my));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(MASK_RES_X - 1, x0 + 1), y1 = Math.min(MASK_RES_Y - 1, y0 + 1);
    const wx = fx - x0, wy = fy - y0;
    return (buf[y0 * MASK_RES_X + x0] * (1 - wx) + buf[y0 * MASK_RES_X + x1] * wx) * (1 - wy) +
           (buf[y1 * MASK_RES_X + x0] * (1 - wx) + buf[y1 * MASK_RES_X + x1] * wx) * wy;
  }

  const maskEnv = {
    MASK_RES_X, MASK_RES_Y, scaleMm, scaleToBed, pxPerUnit, toBed, bedToMask
  };

  // 1. Water Mask & Smooth Euclidean SDF (delegated to water_masks.js)
  const { waterMask, shoreDist, waterSDF } = buildWaterMasksAndSDF(scene, mctx, maskEnv);

  // 2. Crisp Building Footprint Clearance Mask
  mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
  mctx.lineWidth = Math.max(0.85, Math.min(0.08, 0.14 / scaleMm) * pxPerUnit);
  (scene.buildings || []).forEach(b => {
    if (b.hidden || b.btype === 'pier') return;
    mctx.beginPath();
    b.outer.forEach((p, i) => {
      const bp = toBed(p);
      const [px, py] = bedToMask(bp[0], bp[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.closePath();
    (b.holes || []).forEach(h => {
      if (!h || h.length < 3) return;
      h.forEach((p, i) => {
        const bp = toBed(p);
        const [px, py] = bedToMask(bp[0], bp[1]);
        if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
      });
      mctx.closePath();
    });
    mctx.fill('evenodd');
    mctx.stroke();
  });
  const bldImg = safeGetImageData(mctx, 0, 0, MASK_RES_X, MASK_RES_Y).data;
  const bldMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  for (let i = 0; i < bldMask.length; i++) bldMask[i] = bldImg[i * 4 + 3] > 96 ? 1 : 0;

  // 3. Raw Greenery Mask (delegated to features_greenery.js)
  const rawGreenMask = buildRawGreeneryMask(scene, mctx, maskEnv);

  // 4. Streets/Plazas & Park Footpaths Rasterization (delegated to features_roads.js)
  const { majorRoadImg, footpathImg } = rasterizeRoadAndFootpathImages(scene, state, mctx, maskEnv);

  // 5. Finalize Greenery & Road/Footpath Masks
  const { greenMask, greenInnerDist, greenOuterDist } = finalizeGreeneryMask(
    rawGreenMask, waterMask, shoreDist, bldMask, majorRoadImg, MASK_RES_X, MASK_RES_Y
  );
  const { majorRoadMask, parkPathOnGreenMask, parkPathOnGroundMask, roadAndBldMask } = finalizeRoadAndFootpathMasks(
    majorRoadImg, footpathImg, waterMask, shoreDist, bldMask, greenMask, greenInnerDist, greenOuterDist, MASK_RES_X, MASK_RES_Y
  );

  const maskCtx = {
    totalWidthMm, totalHeightMm, maxDimMm, scaleMm, mmPerUnit, halfW, halfH,
    tileCols, tileRows, numTiles, cellsPerCol, cellsPerRow, TERRAIN_RES_X, TERRAIN_RES_Y,
    cellStepX, cellStepY, kerfUnits, scaleToBed, cropCX, cropCY,
    MASK_RES_X, MASK_RES_Y, padW, padH, spanW, spanH, pxPerUnit,
    toBed, bedToMask, sampleMaskIdx, sampleBilinearMask,
    waterMask, waterSDF, shoreDist, bldMask,
    greenInnerDist, greenOuterDist,
    majorRoadMask, greenMask, parkPathOnGreenMask, parkPathOnGroundMask, roadAndBldMask
  };

  return buildTerrainDemGridAndTiles(scene, maskCtx, state);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildTerrainAndMasks };
}
