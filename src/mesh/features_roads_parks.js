// ============================================================================
// src/mesh/features_roads_parks.js
// Global 720px Marching-Squares + Shrinkage-Free Taubin-Smoothed Park Lawns,
// Streets/Plazas, Embossed Central Park Footpaths & Proportionate Organic Trees
// ============================================================================

if (typeof extractMarchingSquaresPolygons2D === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
  Object.assign(global, require('../geometry/obb_medial_2d.js'));
  Object.assign(global, require('../geometry/marching_squares_2d.js'));
  Object.assign(global, require('./mesh_primitives.js'));
  Object.assign(global, require('./mesh_clipper_3d.js'));
}

// Clips a SINGLE watertight 2-manifold 3D shell across tile boundaries with fast AABB culling
function appendShellClippedToTiles(shellTris, ctx, targetMeshArr) {
  if (!shellTris || shellTris.length === 0) return;
  const { tileCols, tileRows, halfW, halfH, tileBounds } = ctx;
  if (tileCols === 1 && tileRows === 1) {
    const clipped = clipMeshToBox3D(shellTris, -halfW, halfW, -halfH, halfH, 0);
    for (let i = 0; i < clipped.length; i++) targetMeshArr.push(clipped[i]);
    return;
  }
  let sMinX = Infinity, sMaxX = -Infinity, sMinY = Infinity, sMaxY = -Infinity;
  for (let i = 0; i < shellTris.length; i++) {
    const t = shellTris[i];
    for (const v of [t.v0, t.v1, t.v2]) {
      if (v[0] < sMinX) sMinX = v[0]; if (v[0] > sMaxX) sMaxX = v[0];
      if (v[1] < sMinY) sMinY = v[1]; if (v[1] > sMaxY) sMaxY = v[1];
    }
  }
  for (let tr = 0; tr < tileRows; tr++) {
    for (let tc = 0; tc < tileCols; tc++) {
      const tileId = tr * tileCols + tc;
      const tb = tileBounds[tileId];
      if (sMaxX < tb.x0 - 1e-4 || sMinX > tb.x1 + 1e-4 || sMaxY < tb.y0 - 1e-4 || sMinY > tb.y1 + 1e-4) continue;
      const clipped = clipMeshToBox3D(shellTris, tb.x0, tb.x1, tb.y0, tb.y1, tileId);
      for (let i = 0; i < clipped.length; i++) targetMeshArr.push(clipped[i]);
    }
  }
}

// Center-weighted [1,2,1; 2,8,2; 1,2,1]/20 smoothing + Y-flip into scene Marching-Squares order
// Preserves slender 2.8px footpaths & 3.2px streets without pinching while eliminating staircase steps!
function buildSmoothedBandField(binaryMask, bandSupportMask, nx, ny) {
  const flipped = new Float32Array(nx * ny);
  let activeCount = 0;
  for (let iy = 0; iy < ny; iy++) {
    const srcRow = (ny - 1 - iy) * nx;
    const dstRow = iy * nx;
    for (let ix = 0; ix < nx; ix++) {
      const v = (binaryMask[srcRow + ix] && bandSupportMask[dstRow + ix]) ? 1.0 : 0.0;
      flipped[dstRow + ix] = v;
      if (v > 0) activeCount++;
    }
  }
  if (activeCount < 3) return null;

  const smoothed = new Float32Array(nx * ny);
  for (let iy = 1; iy < ny - 1; iy++) {
    const r = iy * nx;
    for (let ix = 1; ix < nx - 1; ix++) {
      const sum =
        flipped[r - nx + ix - 1] + 2 * flipped[r - nx + ix] + flipped[r - nx + ix + 1] +
        2 * flipped[r + ix - 1] + 8 * flipped[r + ix] + 2 * flipped[r + ix + 1] +
        flipped[r + nx + ix - 1] + 2 * flipped[r + nx + ix] + flipped[r + nx + ix + 1];
      smoothed[r + ix] = sum / 20.0;
    }
  }
  return smoothed;
}

function buildParksStreetsFootpathsAndTrees(scene, ctx, baseInfo, state, meshes, allocShellId) {
  const {
    halfW, halfH, mToU,
    MASK_RES_X, MASK_RES_Y, padW, padH, spanW, spanH,
    toBed, sampleMaskIdx,
    waterMask, greenInnerDist, greenOuterDist,
    majorRoadMask, greenMask, parkPathOnGreenMask, parkPathOnGroundMask, roadAndBldMask,
    isTopographicRelief, numContourSteps, thresholds,
    baseBottomZ, gHeight, rHeight, pathHeight,
    getStepIdxForVal, sampleRawTerrainGridZ, cellStepX, cellStepY
  } = ctx;
  const getSurfZ = baseInfo && baseInfo.getActualPrintedSurfaceMinZ;

  const roadsVisible = !state.layerVisible || state.layerVisible.roads !== false;
  const greenVisible = !state.layerVisible || state.layerVisible.greenery !== false;
  const treesVisible = !state.layerVisible || state.layerVisible.trees !== false;

  const xMinMS = -padW + 0.5 * (spanW / MASK_RES_X);
  const xMaxMS = padW - 0.5 * (spanW / MASK_RES_X);
  const yMinMS = -padH + 0.5 * (spanH / MASK_RES_Y);
  const yMaxMS = padH - 0.5 * (spanH / MASK_RES_Y);
  const dxMS = (xMaxMS - xMinMS) / (MASK_RES_X - 1);
  const dyMS = (yMaxMS - yMinMS) / (MASK_RES_Y - 1);

  if (roadsVisible || greenVisible) {
    const maxBandK = isTopographicRelief ? numContourSteps : 0;
    const rawBandGrid = new Int16Array(MASK_RES_X * MASK_RES_Y).fill(-1);
    for (let iy = 0; iy < MASK_RES_Y; iy++) {
      const by = yMinMS + iy * dyMS;
      if (by < -halfH + 0.26 || by > halfH - 0.26) continue;
      const row = iy * MASK_RES_X;
      for (let ix = 0; ix < MASK_RES_X; ix++) {
        const bx = xMinMS + ix * dxMS;
        if (bx < -halfW + 0.26 || bx > halfW - 0.26) continue;
        const zC = getSurfZ ? getSurfZ(bx, by) : sampleRawTerrainGridZ(bx, by);
        if (zC < baseBottomZ - 1e-4) continue;
        rawBandGrid[row + ix] = getStepIdxForVal(zC + 1e-4);
      }
    }

    const rPx = Math.max(2, Math.ceil(0.56 / dxMS));
    const pixelBandIdx = new Int16Array(MASK_RES_X * MASK_RES_Y).fill(-1);
    for (let iy = rPx; iy < MASK_RES_Y - rPx; iy++) {
      const row = iy * MASK_RES_X;
      for (let ix = rPx; ix < MASK_RES_X - rPx; ix++) {
        const kC = rawBandGrid[row + ix];
        if (kC < 0) continue;
        let uniform = true;
        for (let dy = -rPx; dy <= rPx && uniform; dy++) {
          const nRow = (iy + dy) * MASK_RES_X;
          for (let dx = -rPx; dx <= rPx; dx++) {
            if (rawBandGrid[nRow + ix + dx] !== kC) { uniform = false; break; }
          }
        }
        if (uniform) pixelBandIdx[row + ix] = kC;
      }
    }

    const bandMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
    const emitMSLayer = (binaryMask, zBot, zTop, layerId, targetArr, minArea, isoVal = 0.52) => {
      const field = buildSmoothedBandField(binaryMask, bandMask, MASK_RES_X, MASK_RES_Y);
      if (!field) return;
      const polys = extractMarchingSquaresPolygons2D(field, MASK_RES_X, MASK_RES_Y, xMinMS, xMaxMS, yMinMS, yMaxMS, isoVal, minArea);
      for (let i = 0; i < polys.length; i++) {
        const shell = [];
        emitPolygonWithHolesSlab3D(polys[i].ring, polys[i].holes, zBot, zTop, layerId, shell, 0, allocShellId());
        appendShellClippedToTiles(shell, ctx, targetArr);
      }
    };

    for (let k = 0; k <= maxBandK; k++) {
      let countK = 0;
      for (let i = 0; i < pixelBandIdx.length; i++) {
        const hit = pixelBandIdx[i] === k ? 1 : 0;
        bandMask[i] = hit;
        countK += hit;
      }
      if (countK < 6) continue;
      const tZ = thresholds[k];

      // isoVal = 0.52 for greenMask and majorRoadMask -> 0.52 + 0.52 = 1.04 > 1.0 (0% volumetric overlap!)
      if (greenVisible) {
        emitMSLayer(greenMask, tZ, tZ + gHeight, 2, meshes.greenery, 0.030, 0.52);
      }
      if (roadsVisible) {
        emitMSLayer(majorRoadMask, tZ, tZ + rHeight, 3, meshes.roads, 0.020, 0.52);
        const pathBaseZ = greenVisible ? (tZ + gHeight) : tZ;
        emitMSLayer(parkPathOnGreenMask, pathBaseZ, pathBaseZ + pathHeight, 3, meshes.roads, 0.014, 0.46);
        emitMSLayer(parkPathOnGroundMask, tZ, tZ + pathHeight, 3, meshes.roads, 0.016, 0.52);
      }
    }
  }

  if (treesVisible) {
    const placedTrees = [];
    (scene.trees || []).forEach((tr, idx) => {
      const [bx, by] = toBed([tr[0], tr[1]]);
      if (bx < -halfW + 1.2 || bx > halfW - 1.2 || by < -halfH + 1.2 || by > halfH - 1.2) return;
      const mIdx = sampleMaskIdx(bx, by);
      if (waterMask[mIdx] || roadAndBldMask[mIdx]) return;

      const realRadiusM = 3.0 + (idx % 5) * 0.52;
      const realHeightM = 5.5 + (idx % 6) * 0.65;
      const treeRadius = Math.max(0.18, Math.min(0.40, realRadiusM * mToU));
      const treeHeight = Math.max(0.22, Math.min(0.54, realHeightM * mToU * (state.zScale || 1.0)));

      const zCenter = getSurfZ ? getSurfZ(bx, by) : sampleRawTerrainGridZ(bx, by);
      if (zCenter < baseBottomZ - 1e-4) return;
      const kCenter = getStepIdxForVal(zCenter + 1e-4);
      if (kCenter < 0) return;
      const tZ = thresholds[kCenter];

      const onGreen = greenVisible && greenMask[mIdx] === 1 && (!greenInnerDist || greenInnerDist[mIdx] >= 3.0);
      if (!onGreen && greenVisible && greenOuterDist && greenOuterDist[mIdx] < 2.4) return;

      const checkR = treeRadius + 0.52;
      let crownValid = true;
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const px = bx + Math.cos(ang) * checkR;
        const py = by + Math.sin(ang) * checkR;
        const pIdx = sampleMaskIdx(px, py);
        if (waterMask[pIdx] || roadAndBldMask[pIdx]) {
          crownValid = false; break;
        }
        if (onGreen) {
          if (!greenMask[pIdx] || (greenInnerDist && greenInnerDist[pIdx] < 2.4)) { crownValid = false; break; }
        } else if (greenVisible) {
          if (greenMask[pIdx] || (greenOuterDist && greenOuterDist[pIdx] < 2.0)) { crownValid = false; break; }
        }
        const zP = getSurfZ ? getSurfZ(px, py) : sampleRawTerrainGridZ(px, py);
        if (Math.abs((getSurfZ ? zP : thresholds[Math.max(0, getStepIdxForVal(zP))]) - tZ) > 1e-4) {
          crownValid = false; break;
        }
      }
      if (!crownValid) return;

      for (let j = 0; j < placedTrees.length; j++) {
        const pt = placedTrees[j];
        if (Math.hypot(bx - pt[0], by - pt[1]) < (treeRadius + pt[2]) * 1.12) return;
      }
      placedTrees.push([bx, by, treeRadius]);

      const zGround = onGreen ? (tZ + gHeight) : tZ;
      const treeShell = [];
      addTreeCrown3D(bx, by, zGround, treeRadius, treeHeight, 2, treeShell, 0, allocShellId());
      appendShellClippedToTiles(treeShell, ctx, meshes.greenery);
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { appendShellClippedToTiles, buildSmoothedBandField, buildParksStreetsFootpathsAndTrees };
}
