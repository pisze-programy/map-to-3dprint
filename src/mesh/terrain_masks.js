// ============================================================================
// src/mesh/terrain_masks.js
// Scene Coordinate Transform & High-Res 720px Euclidean Raster Masks
// (Water SDF, Crisp Building Clearance, Streets/Plazas, Parks & Footpaths)
// ============================================================================

if (typeof computeEuclideanDistGrid === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
  Object.assign(global, require('../geometry/obb_medial_2d.js'));
  Object.assign(global, require('../geometry/marching_squares_2d.js'));
  Object.assign(global, require('./terrain_dem_grid.js'));
}

function buildTerrainAndMasks(scene, state) {
  const totalWidthMm = state.bedSizeMm || state.targetWidthMm || 320;
  const totalHeightMm = state.totalHeightMm || state.targetHeightMm || totalWidthMm;
  const maxDimMm = Math.max(totalWidthMm, totalHeightMm);
  const scaleMm = maxDimMm / 169.2;
  const mmPerUnit = scaleMm;
  const halfW = 84.6 * (totalWidthMm / maxDimMm);
  const halfH = 84.6 * (totalHeightMm / maxDimMm);

  const tileCols = Math.max(1, Math.min(8, state.tileCols || 1));
  const tileRows = Math.max(1, Math.min(8, state.tileRows || 1));
  const numTiles = tileCols * tileRows;

  const cellsPerCol = Math.max(14, Math.round((156 * (totalWidthMm / maxDimMm)) / tileCols));
  const TERRAIN_RES_X = cellsPerCol * tileCols;
  const cellsPerRow = Math.max(10, Math.round((156 * (totalHeightMm / maxDimMm)) / tileRows));
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

  const MASK_RES_X = Math.max(256, Math.round(720 * (totalWidthMm / maxDimMm)));
  const MASK_RES_Y = Math.max(256, Math.round(720 * (totalHeightMm / maxDimMm)));
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

  const fillPolysOnCtx = (polys) => {
    (polys || []).forEach(poly => {
      if (!poly || !poly.outer || poly.outer.length < 3) return;
      mctx.beginPath();
      poly.outer.forEach((p, i) => {
        const b = toBed(p);
        const [px, py] = bedToMask(b[0], b[1]);
        if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
      });
      mctx.closePath();
      (poly.holes || []).forEach(h => {
        if (!h || h.length < 3) return;
        h.forEach((p, i) => {
          const b = toBed(p);
          const [px, py] = bedToMask(b[0], b[1]);
          if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
        });
        mctx.closePath();
      });
      mctx.fill('evenodd');
    });
  };

  // 1. Water Mask & Smooth Euclidean Signed Distance Field (waterSDF > 0 on land, < 0 in water)
  mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
  mctx.fillStyle = '#ffffff';
  mctx.strokeStyle = '#ffffff';
  mctx.lineCap = 'round';
  mctx.lineJoin = 'round';
  fillPolysOnCtx(scene.waterPolys);

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

  const waterImg = mctx.getImageData(0, 0, MASK_RES_X, MASK_RES_Y).data;
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
        next[y * MASK_RES_X + x] = sum / wSum;
      }
    }
    waterSDF = next;
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

  // 2. Crisp Building Footprint Clearance Mask (preserving narrow European Altstadt lanes!)
  mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
  mctx.lineWidth = Math.max(1.2, 0.08 * pxPerUnit);
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
  const bldImg = mctx.getImageData(0, 0, MASK_RES_X, MASK_RES_Y).data;
  const bldMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  for (let i = 0; i < bldMask.length; i++) bldMask[i] = bldImg[i * 4 + 3] > 96 ? 1 : 0;

  // 3. Raw Greenery Mask (authentic OSM parks, lawns, forests & gardens ONLY)
  mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
  fillPolysOnCtx(scene.greenPolys || scene.greeneryPolys);
  const rawGreenImg = mctx.getImageData(0, 0, MASK_RES_X, MASK_RES_Y).data;
  const rawGreenMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  for (let i = 0; i < rawGreenMask.length; i++) rawGreenMask[i] = rawGreenImg[i * 4 + 3] > 96 ? 1 : 0;

  // 4. Separate Major Streets/Plazas vs Delicate Park Footpaths (CityFrames Central Park Layering!)
  const isFootpathRoad = (rd) => {
    if (rd.isPath) return true;
    const rtype = rd.hwy || rd.type || rd.rtype || '';
    return rtype === 'footway' || rtype === 'path' || rtype === 'steps' ||
           rtype === 'cycleway' || rtype === 'bridleway' || rtype === 'track' || rtype === 'corridor';
  };

  mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
  fillPolysOnCtx(scene.roadPolys);
  (scene.roads || []).forEach(rd => {
    if (!rd.pts || rd.pts.length < 2 || isFootpathRoad(rd)) return;
    const minWUnits = Math.max((rd.width || 1.0) * 0.90 * scaleToBed, 0.44 / scaleMm);
    mctx.lineWidth = Math.max(3.8, minWUnits * pxPerUnit + 0.55);
    mctx.beginPath();
    rd.pts.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.stroke();
  });
  const majorRoadImg = mctx.getImageData(0, 0, MASK_RES_X, MASK_RES_Y).data;

  mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
  (scene.roads || []).forEach(rd => {
    if (!rd.pts || rd.pts.length < 2 || !isFootpathRoad(rd)) return;
    const pathWUnits = Math.max(Math.min(0.62, rd.width || 0.36) * scaleToBed, 0.38 / scaleMm);
    mctx.lineWidth = Math.max(3.3, pathWUnits * pxPerUnit + 0.45);
    mctx.beginPath();
    rd.pts.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.stroke();
  });
  const footpathImg = mctx.getImageData(0, 0, MASK_RES_X, MASK_RES_Y).data;

  const majorRoadMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  const greenMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  for (let i = 0; i < majorRoadMask.length; i++) {
    const clearOfWater = !waterMask[i] && shoreDist[i] >= 2.2;
    majorRoadMask[i] = (majorRoadImg[i * 4 + 3] > 96 && clearOfWater && !bldMask[i]) ? 1 : 0;
    const clearRoadHalo = majorRoadImg[i * 4 + 3] <= 48;
    greenMask[i] = (rawGreenMask[i] && clearOfWater && !bldMask[i] && clearRoadHalo) ? 1 : 0;
  }

  const greenInnerDist = computeEuclideanDistGrid(greenMask, MASK_RES_X, MASK_RES_Y, true);
  const majorRoadDist = computeEuclideanDistGrid(majorRoadMask, MASK_RES_X, MASK_RES_Y, false);
  const greenOuterDist = computeEuclideanDistGrid(greenMask, MASK_RES_X, MASK_RES_Y, false);

  const parkPathOnGreenMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  const parkPathOnGroundMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  const roadAndBldMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);

  for (let i = 0; i < parkPathOnGreenMask.length; i++) {
    const hasFoot = footpathImg[i * 4 + 3] > 96 && !waterMask[i] && shoreDist[i] >= 2.2 && !bldMask[i];
    if (hasFoot && greenInnerDist[i] >= 2.8 && majorRoadDist[i] >= 1.6) {
      parkPathOnGreenMask[i] = 1;
    } else if (hasFoot && !greenMask[i] && greenOuterDist[i] >= 2.2 && majorRoadDist[i] >= 1.6) {
      parkPathOnGroundMask[i] = 1;
    }
    roadAndBldMask[i] = (bldMask[i] || majorRoadMask[i] || parkPathOnGreenMask[i] || parkPathOnGroundMask[i]) ? 1 : 0;
  }

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
