// ============================================================================
// src/mesh/water_masks.js
// Water Mask & Smooth Euclidean Signed Distance Field (waterSDF > 0 on land, < 0 in water)
// ============================================================================

if (typeof computeEuclideanDistGrid === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/marching_squares_2d.js'));
}
if (typeof safeGetImageData === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./mesh_tile_append.js'));
}

function buildWaterMasksAndSDF(scene, mctx, maskEnv) {
  const { MASK_RES_X, MASK_RES_Y, scaleToBed, pxPerUnit, toBed, bedToMask } = maskEnv;

  mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
  mctx.fillStyle = '#ffffff';
  mctx.strokeStyle = '#ffffff';
  mctx.lineCap = 'round';
  mctx.lineJoin = 'round';
  fillPolysOnMaskCtx(mctx, scene.waterPolys, toBed, bedToMask);

  (scene.waterLines || []).forEach(wl => {
    if (!wl || !wl.pts || wl.pts.length < 2) return;
    const effW = Math.min(5.2, Math.max(1.0, wl.width || 2.0));
    mctx.lineWidth = Math.max(2.2, effW * scaleToBed * pxPerUnit);
    mctx.beginPath();
    wl.pts.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.stroke();
  });

  const waterImg = safeGetImageData(mctx, 0, 0, MASK_RES_X, MASK_RES_Y).data;
  const waterMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  for (let i = 0; i < waterMask.length; i++) waterMask[i] = waterImg[i * 4 + 3] > 96 ? 1 : 0;

  const waterDepth = computeEuclideanDistGrid(waterMask, MASK_RES_X, MASK_RES_Y, true);
  const shoreDist = computeEuclideanDistGrid(waterMask, MASK_RES_X, MASK_RES_Y, false);

  let waterSDF = new Float32Array(MASK_RES_X * MASK_RES_Y);
  for (let i = 0; i < waterSDF.length; i++) {
    waterSDF[i] = (shoreDist[i] - waterDepth[i]) / pxPerUnit;
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(waterSDF.length);
    for (let y = 0; y < MASK_RES_Y; y++) {
      for (let x = 0; x < MASK_RES_X; x++) {
        let sum = 0, wSum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = Math.min(MASK_RES_Y - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const nx = Math.min(MASK_RES_X - 1, Math.max(0, x + dx));
            const w = (dx === 0 && dy === 0) ? 4 : (dx === 0 || dy === 0) ? 2 : 1;
            sum += waterSDF[ny * MASK_RES_X + nx] * w;
            wSum += w;
          }
        }
        const idx = y * MASK_RES_X + x;
        let val = sum / wSum;
        // Preserve sign of true land/water mask so narrow peninsulas, bays & islands never erode across zero
        if (!waterMask[idx] && val < 0.015) val = 0.015;
        else if (waterMask[idx] && val > -0.015) val = -0.015;
        next[idx] = val;
      }
    }
    waterSDF = next;
  }

  return { waterMask, waterDepth, shoreDist, waterSDF };
}

if (typeof window !== 'undefined') {
  window.buildWaterMasksAndSDF = buildWaterMasksAndSDF;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildWaterMasksAndSDF };
}
