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

// Clips a SINGLE watertight 2-manifold 3D shell across tile boundaries with fast centroid assignment
function appendShellClippedToTiles(shellTris, ctx, targetMeshArr) {
  if (!shellTris || shellTris.length === 0) return;
  const { tileCols, tileRows, halfW, halfH } = ctx;
  if (tileCols <= 1 && tileRows <= 1) {
    for (let i = 0; i < shellTris.length; i++) {
      shellTris[i].tileId = 0;
      targetMeshArr.push(shellTris[i]);
    }
    return;
  }

  // O(1) centroid tile assignment for live preview
  let sMinX = Infinity, sMaxX = -Infinity, sMinY = Infinity, sMaxY = -Infinity;
  for (let i = 0; i < shellTris.length; i++) {
    const t = shellTris[i];
    for (const v of [t.v0, t.v1, t.v2]) {
      if (v[0] < sMinX) sMinX = v[0]; if (v[0] > sMaxX) sMaxX = v[0];
      if (v[1] < sMinY) sMinY = v[1]; if (v[1] > sMaxY) sMaxY = v[1];
    }
  }
  const cx = (sMinX + sMaxX) * 0.5;
  const cy = (sMinY + sMaxY) * 0.5;
  const tileId = (typeof getTileIdForCentroid === 'function')
    ? getTileIdForCentroid(cx, cy, halfW, halfH, tileCols, tileRows)
    : 0;

  for (let i = 0; i < shellTris.length; i++) {
    shellTris[i].tileId = tileId;
    targetMeshArr.push(shellTris[i]);
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

function buildParksStreetsFootpathsAndTreesSync(scene, ctx, baseInfo, state, meshes, allocShellId) {
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
  const lod = (state && state.lodSettings) || {};
  const spanKm = Number(state.spanKm) || (Number(state.mapSpanMeters) / 1000) || ((scene.spanMeters || 1200) / 1000);
  const treeThresholdKm = (lod.treeThresholdKm !== undefined)
    ? Number(lod.treeThresholdKm)
    : (lod.treeMaxSpanKm !== undefined ? Number(lod.treeMaxSpanKm) : 4.0);
  const userEnableTrees = (lod.enableTrees !== undefined) ? Boolean(lod.enableTrees) : true;
  const allowTreesByScale = spanKm <= treeThresholdKm;
  const treesVisible = (!state.layerVisible || state.layerVisible.trees !== false) &&
                       userEnableTrees &&
                       allowTreesByScale;

  const xMinMS = -padW + 0.5 * (spanW / MASK_RES_X);
  const xMaxMS = padW - 0.5 * (spanW / MASK_RES_X);
  const yMinMS = -padH + 0.5 * (spanH / MASK_RES_Y);
  const yMaxMS = padH - 0.5 * (spanH / MASK_RES_Y);
  const dxMS = (xMaxMS - xMinMS) / (MASK_RES_X - 1);
  const dyMS = (yMaxMS - yMinMS) / (MASK_RES_Y - 1);

  const maxBandK = isTopographicRelief ? numContourSteps : 0;
  const rawBandGrid = new Int16Array(MASK_RES_X * MASK_RES_Y).fill(-1);
  if (roadsVisible || greenVisible || treesVisible) {
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
  }

  // Tracks actual emitted M.greenery support per MS grid cell: 1 = strictly inside printed lawn, 2 = strictly bare ground
  const printedSurfaceState = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  const pixelBandIdx = new Int16Array(MASK_RES_X * MASK_RES_Y).fill(-1);
  {
    const rPx = Math.max(2, Math.ceil(0.46 / dxMS));
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
        if (uniform) {
          pixelBandIdx[row + ix] = kC;
          printedSurfaceState[row + ix] = 2;
        }
      }
    }
  }

  if (roadsVisible || greenVisible) {
    const bandMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
    const emitPolysFromField = (field, zBot, zTop, layerId, targetArr, minArea, isoVal) => {
      if (!field) return;
      const polys = extractMarchingSquaresPolygons2D(field, MASK_RES_X, MASK_RES_Y, xMinMS, xMaxMS, yMinMS, yMaxMS, isoVal, minArea);
      for (let i = 0; i < polys.length; i++) {
        const shell = [];
        emitPolygonWithHolesSlab3D(polys[i].ring, polys[i].holes, zBot, zTop, layerId, shell, 0, allocShellId());
        appendShellClippedToTiles(shell, ctx, targetArr);
      }
    };

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

      let greenField = null;
      if (greenVisible) {
        greenField = buildSmoothedBandField(greenMask, bandMask, MASK_RES_X, MASK_RES_Y);
        emitPolysFromField(greenField, tZ, tZ + gHeight, 2, meshes.greenery, 0.030, 0.52);
        if (greenField) {
          for (let iy = 1; iy < MASK_RES_Y - 1; iy++) {
            const row = iy * MASK_RES_X;
            for (let ix = 1; ix < MASK_RES_X - 1; ix++) {
              if (!bandMask[row + ix]) continue;
              const gf = greenField[row + ix];
              if (gf >= 0.92 &&
                  greenField[row - MASK_RES_X + ix] >= 0.72 && greenField[row + MASK_RES_X + ix] >= 0.72 &&
                  greenField[row + ix - 1] >= 0.72 && greenField[row + ix + 1] >= 0.72) {
                printedSurfaceState[row + ix] = 1;
              } else if (gf > 0.12) {
                printedSurfaceState[row + ix] = 0; // boundary transition zone — keep trees & footpaths off edge!
              }
            }
          }
        }
      }

      if (roadsVisible) {
        const roadField = buildSmoothedBandField(majorRoadMask, bandMask, MASK_RES_X, MASK_RES_Y);
        emitPolysFromField(roadField, tZ, tZ + rHeight, 3, meshes.roads, 0.020, 0.52);

        if (greenVisible && greenField) {
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
          emitPolysFromField(buildSmoothedBandField(strictGreenPathMask, bandMask, MASK_RES_X, MASK_RES_Y), tZ + gHeight, tZ + gHeight + pathHeight, 3, meshes.roads, 0.014, 0.48);
          emitPolysFromField(buildSmoothedBandField(strictGroundPathMask, bandMask, MASK_RES_X, MASK_RES_Y), tZ, tZ + pathHeight, 3, meshes.roads, 0.016, 0.52);
        } else {
          emitPolysFromField(buildSmoothedBandField(parkPathOnGreenMask, bandMask, MASK_RES_X, MASK_RES_Y), tZ, tZ + pathHeight, 3, meshes.roads, 0.014, 0.48);
          emitPolysFromField(buildSmoothedBandField(parkPathOnGroundMask, bandMask, MASK_RES_X, MASK_RES_Y), tZ, tZ + pathHeight, 3, meshes.roads, 0.016, 0.52);
        }
      }
    }
  }

  if (treesVisible) {
    const sampleMSIdx = (bx, by) => {
      const ix = Math.min(MASK_RES_X - 1, Math.max(0, Math.round((bx - xMinMS) / dxMS)));
      const iy = Math.min(MASK_RES_Y - 1, Math.max(0, Math.round((by - yMinMS) / dyMS)));
      return iy * MASK_RES_X + ix;
    };
    const placedTrees = [];
    (scene.trees || []).forEach((tr, idx) => {
      const [bx, by] = toBed([tr[0], tr[1]]);
      if (bx < -halfW + 1.2 || bx > halfW - 1.2 || by < -halfH + 1.2 || by > halfH - 1.2) return;
      const mIdx = sampleMaskIdx(bx, by);
      if (waterMask[mIdx] || roadAndBldMask[mIdx]) return;

      const msCenter = sampleMSIdx(bx, by);
      const kCenter = pixelBandIdx[msCenter];
      const surfState = printedSurfaceState[msCenter];
      if (kCenter < 0 || (surfState !== 1 && surfState !== 2)) return;

      const realRadiusM = 3.0 + (idx % 5) * 0.52;
      const realHeightM = 5.5 + (idx % 6) * 0.65;
      const treeRadius = Math.max(0.18, Math.min(0.40, realRadiusM * mToU));
      const treeHeight = Math.max(0.22, Math.min(0.54, realHeightM * mToU * (state.zScale || 1.0)));

      const checkR = treeRadius + 0.24;
      let crownValid = true;
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const px = bx + Math.cos(ang) * checkR;
        const py = by + Math.sin(ang) * checkR;
        const pMask = sampleMaskIdx(px, py);
        const pMS = sampleMSIdx(px, py);
        if (waterMask[pMask] || roadAndBldMask[pMask] || pixelBandIdx[pMS] !== kCenter || printedSurfaceState[pMS] !== surfState) {
          crownValid = false; break;
        }
      }
      if (!crownValid) return;

      for (let j = 0; j < placedTrees.length; j++) {
        const pt = placedTrees[j];
        if (Math.hypot(bx - pt[0], by - pt[1]) < (treeRadius + pt[2]) * 1.12) return;
      }
      placedTrees.push([bx, by, treeRadius]);

      const tZ = thresholds[kCenter];
      const zGround = (surfState === 1 && greenVisible) ? (tZ + gHeight) : tZ;
      const treeShell = [];
      addTreeCrown3D(bx, by, zGround, treeRadius, treeHeight, 2, treeShell, 0, allocShellId());
      appendShellClippedToTiles(treeShell, ctx, meshes.greenery);
    });
  }
}

async function buildParksStreetsFootpathsAndTreesProgressive(scene, ctx, baseInfo, state, meshes, allocShellId, yieldCtrl, onProgress = null) {
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
  const lod = (state && state.lodSettings) || {};
  const spanKm = Number(state.spanKm) || (Number(state.mapSpanMeters) / 1000) || ((scene.spanMeters || 1200) / 1000);
  const treeThresholdKm = (lod.treeThresholdKm !== undefined)
    ? Number(lod.treeThresholdKm)
    : (lod.treeMaxSpanKm !== undefined ? Number(lod.treeMaxSpanKm) : 4.0);
  const userEnableTrees = (lod.enableTrees !== undefined) ? Boolean(lod.enableTrees) : true;
  const allowTreesByScale = spanKm <= treeThresholdKm;
  const treesVisible = (!state.layerVisible || state.layerVisible.trees !== false) &&
                       userEnableTrees &&
                       allowTreesByScale;

  const xMinMS = -padW + 0.5 * (spanW / MASK_RES_X);
  const xMaxMS = padW - 0.5 * (spanW / MASK_RES_X);
  const yMinMS = -padH + 0.5 * (spanH / MASK_RES_Y);
  const yMaxMS = padH - 0.5 * (spanH / MASK_RES_Y);
  const dxMS = (xMaxMS - xMinMS) / (MASK_RES_X - 1);
  const dyMS = (yMaxMS - yMinMS) / (MASK_RES_Y - 1);

  const maxBandK = isTopographicRelief ? numContourSteps : 0;
  const totalBands = maxBandK + 1;
  let lastReportedPct = 42;

  const rawBandGrid = new Int16Array(MASK_RES_X * MASK_RES_Y).fill(-1);
  if (roadsVisible || greenVisible || treesVisible) {
    for (let iy = 0; iy < MASK_RES_Y; iy++) {
      if ((iy & 31) === 0) {
        yieldCtrl.checkCancellation();
        await yieldCtrl.yieldIfNeeded();
      }
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
  }

  // Tracks actual emitted M.greenery support per MS grid cell: 1 = strictly inside printed lawn, 2 = strictly bare ground
  const printedSurfaceState = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  const pixelBandIdx = new Int16Array(MASK_RES_X * MASK_RES_Y).fill(-1);
  {
    const rPx = Math.max(2, Math.ceil(0.46 / dxMS));
    for (let iy = rPx; iy < MASK_RES_Y - rPx; iy++) {
      if ((iy & 31) === 0) {
        yieldCtrl.checkCancellation();
        await yieldCtrl.yieldIfNeeded();
      }
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
        if (uniform) {
          pixelBandIdx[row + ix] = kC;
          printedSurfaceState[row + ix] = 2;
        }
      }
    }
  }

  if (roadsVisible || greenVisible) {
    const bandMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
    const emitPolysFromField = async (field, zBot, zTop, layerId, targetArr, minArea, isoVal, progressType = 'greenery', bandK = 0) => {
      if (!field) return;
      yieldCtrl.checkCancellation();
      await yieldCtrl.yieldIfNeeded();
      const polys = extractMarchingSquaresPolygons2D(field, MASK_RES_X, MASK_RES_Y, xMinMS, xMaxMS, yMinMS, yMaxMS, isoVal, minArea);
      await yieldCtrl.yieldIfNeeded();
      yieldCtrl.checkCancellation();

      const totalP = Math.max(1, polys.length);
      const bandBaseFrac = bandK / totalBands;
      const bandSpanFrac = 1.0 / totalBands;

      for (let i = 0; i < polys.length; i++) {
        if ((i & 7) === 0) yieldCtrl.checkCancellation();
        const shell = [];
        emitPolygonWithHolesSlab3D(polys[i].ring, polys[i].holes, zBot, zTop, layerId, shell, 0, allocShellId());
        appendShellClippedToTiles(shell, ctx, targetArr);

        if (onProgress) {
          let frac;
          if (progressType === 'greenery') {
            frac = bandBaseFrac + (i / totalP) * (bandSpanFrac * 0.40);
          } else {
            frac = bandBaseFrac + bandSpanFrac * 0.40 + (i / totalP) * (bandSpanFrac * 0.50);
          }
          const pct = 42 + Math.min(12, Math.round(frac * 12));
          if (pct !== lastReportedPct) {
            lastReportedPct = pct;
            onProgress(
              pct,
              `Etap 2/5: Konturowanie roślinności i dróg (${i + 1}/${totalP})...`,
              progressType === 'greenery'
                ? `Pasma zieleni miejskiej (pasmo ${bandK + 1}/${totalBands})`
                : `Infrastruktura drogowa (pasmo ${bandK + 1}/${totalBands})`
            );
          }
        }
        await yieldCtrl.yieldIfNeeded();
      }
    };

    const strictGreenPathMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
    const strictGroundPathMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);

    for (let k = 0; k <= maxBandK; k++) {
      yieldCtrl.checkCancellation();
      await yieldCtrl.yieldIfNeeded();

      let countK = 0;
      for (let i = 0; i < pixelBandIdx.length; i++) {
        const hit = pixelBandIdx[i] === k ? 1 : 0;
        bandMask[i] = hit;
        countK += hit;
      }
      if (countK < 6) continue;
      const tZ = thresholds[k];

      let greenField = null;
      if (greenVisible) {
        greenField = buildSmoothedBandField(greenMask, bandMask, MASK_RES_X, MASK_RES_Y);
        await emitPolysFromField(greenField, tZ, tZ + gHeight, 2, meshes.greenery, 0.030, 0.52, 'greenery', k);
        if (greenField) {
          for (let iy = 1; iy < MASK_RES_Y - 1; iy++) {
            const row = iy * MASK_RES_X;
            for (let ix = 1; ix < MASK_RES_X - 1; ix++) {
              if (!bandMask[row + ix]) continue;
              const gf = greenField[row + ix];
              if (gf >= 0.92 &&
                  greenField[row - MASK_RES_X + ix] >= 0.72 && greenField[row + MASK_RES_X + ix] >= 0.72 &&
                  greenField[row + ix - 1] >= 0.72 && greenField[row + ix + 1] >= 0.72) {
                printedSurfaceState[row + ix] = 1;
              } else if (gf > 0.12) {
                printedSurfaceState[row + ix] = 0; // boundary transition zone — keep trees & footpaths off edge!
              }
            }
          }
        }
      }

      if (roadsVisible) {
        const roadField = buildSmoothedBandField(majorRoadMask, bandMask, MASK_RES_X, MASK_RES_Y);
        await emitPolysFromField(roadField, tZ, tZ + rHeight, 3, meshes.roads, 0.020, 0.52, 'roads', k);

        if (greenVisible && greenField) {
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
          await emitPolysFromField(buildSmoothedBandField(strictGreenPathMask, bandMask, MASK_RES_X, MASK_RES_Y), tZ + gHeight, tZ + gHeight + pathHeight, 3, meshes.roads, 0.014, 0.48, 'roads', k);
          await emitPolysFromField(buildSmoothedBandField(strictGroundPathMask, bandMask, MASK_RES_X, MASK_RES_Y), tZ, tZ + pathHeight, 3, meshes.roads, 0.016, 0.52, 'roads', k);
        } else {
          await emitPolysFromField(buildSmoothedBandField(parkPathOnGreenMask, bandMask, MASK_RES_X, MASK_RES_Y), tZ, tZ + pathHeight, 3, meshes.roads, 0.014, 0.48, 'roads', k);
          await emitPolysFromField(buildSmoothedBandField(parkPathOnGroundMask, bandMask, MASK_RES_X, MASK_RES_Y), tZ, tZ + pathHeight, 3, meshes.roads, 0.016, 0.52, 'roads', k);
        }
      }
    }
  }

  if (treesVisible) {
    const sampleMSIdx = (bx, by) => {
      const ix = Math.min(MASK_RES_X - 1, Math.max(0, Math.round((bx - xMinMS) / dxMS)));
      const iy = Math.min(MASK_RES_Y - 1, Math.max(0, Math.round((by - yMinMS) / dyMS)));
      return iy * MASK_RES_X + ix;
    };
    const placedTrees = [];
    const treeList = scene.trees || [];
    const totalTrees = Math.max(1, treeList.length);

    for (let idx = 0; idx < treeList.length; idx++) {
      if ((idx & 31) === 0) {
        yieldCtrl.checkCancellation();
        await yieldCtrl.yieldIfNeeded();
        if (onProgress) {
          const treeFrac = 0.90 + (idx / totalTrees) * 0.10;
          const pct = 42 + Math.min(12, Math.round(treeFrac * 12));
          if (pct !== lastReportedPct) {
            lastReportedPct = pct;
            onProgress(
              pct,
              `Etap 2/5: Osadzanie koron drzew 3D (${idx + 1}/${totalTrees})...`,
              `Organiczne korony drzew (${placedTrees.length} posadzonych)`
            );
          }
        }
      }

      const tr = treeList[idx];
      const [bx, by] = toBed([tr[0], tr[1]]);
      if (bx < -halfW + 1.2 || bx > halfW - 1.2 || by < -halfH + 1.2 || by > halfH - 1.2) continue;
      const mIdx = sampleMaskIdx(bx, by);
      if (waterMask[mIdx] || roadAndBldMask[mIdx]) continue;

      const msCenter = sampleMSIdx(bx, by);
      const kCenter = pixelBandIdx[msCenter];
      const surfState = printedSurfaceState[msCenter];
      if (kCenter < 0 || (surfState !== 1 && surfState !== 2)) continue;

      const realRadiusM = 3.0 + (idx % 5) * 0.52;
      const realHeightM = 5.5 + (idx % 6) * 0.65;
      const treeRadius = Math.max(0.18, Math.min(0.40, realRadiusM * mToU));
      const treeHeight = Math.max(0.22, Math.min(0.54, realHeightM * mToU * (state.zScale || 1.0)));

      const checkR = treeRadius + 0.24;
      let crownValid = true;
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const px = bx + Math.cos(ang) * checkR;
        const py = by + Math.sin(ang) * checkR;
        const pMask = sampleMaskIdx(px, py);
        const pMS = sampleMSIdx(px, py);
        if (waterMask[pMask] || roadAndBldMask[pMask] || pixelBandIdx[pMS] !== kCenter || printedSurfaceState[pMS] !== surfState) {
          crownValid = false; break;
        }
      }
      if (!crownValid) continue;

      let collided = false;
      for (let j = 0; j < placedTrees.length; j++) {
        const pt = placedTrees[j];
        if (Math.hypot(bx - pt[0], by - pt[1]) < (treeRadius + pt[2]) * 1.12) {
          collided = true;
          break;
        }
      }
      if (collided) continue;
      placedTrees.push([bx, by, treeRadius]);

      const tZ = thresholds[kCenter];
      const zGround = (surfState === 1 && greenVisible) ? (tZ + gHeight) : tZ;
      const treeShell = [];
      addTreeCrown3D(bx, by, zGround, treeRadius, treeHeight, 2, treeShell, 0, allocShellId());
      appendShellClippedToTiles(treeShell, ctx, meshes.greenery);
    }
  }
}

function buildParksStreetsFootpathsAndTrees(scene, ctx, baseInfo, state, meshes, allocShellId, yieldCtrl = null, onProgress = null) {
  if (yieldCtrl) {
    return buildParksStreetsFootpathsAndTreesProgressive(scene, ctx, baseInfo, state, meshes, allocShellId, yieldCtrl, onProgress);
  }
  return buildParksStreetsFootpathsAndTreesSync(scene, ctx, baseInfo, state, meshes, allocShellId);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { appendShellClippedToTiles, buildSmoothedBandField, buildParksStreetsFootpathsAndTrees };
}
