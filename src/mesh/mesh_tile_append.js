// ============================================================================
// src/mesh/mesh_tile_append.js
// Shared Per-Tile 2-Manifold Shell Clipping, Polygon Prism Emission,
// Mask Canvas Helpers & Contour Band Assignment
// ============================================================================

if (typeof extractMarchingSquaresPolygons2D === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
  Object.assign(global, require('../geometry/obb_medial_2d.js'));
  Object.assign(global, require('../geometry/marching_squares_2d.js'));
  Object.assign(global, require('./mesh_primitives.js'));
  Object.assign(global, require('./mesh_clipper_3d.js'));
}

function safeGetImageData(ctx, x, y, w, h) {
  if (typeof safeCanvasGetImageData === 'function') {
    return safeCanvasGetImageData(ctx, x, y, w, h);
  }
  try {
    return ctx.getImageData(x, y, w, h);
  } catch (_) {
    return { data: new Uint8ClampedArray(w * h * 4) };
  }
}

function fillPolysOnMaskCtx(mctx, polys, toBed, bedToMask) {
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
}

// Clips a SINGLE watertight 2-manifold 3D shell across tile boundaries cleanly (0 overhangs on Rozsuń & per-tile export)
function appendShellClippedToTiles(shellTris, ctx, targetMeshArr) {
  if (!shellTris || shellTris.length === 0) return;
  const { tileCols, tileRows, halfW, halfH, tileBounds } = ctx;
  const numTiles = (tileCols || 1) * (tileRows || 1);
  if (numTiles <= 1) {
    for (let i = 0; i < shellTris.length; i++) {
      shellTris[i].tileId = 0;
      targetMeshArr.push(shellTris[i]);
    }
    return;
  }

  if ((ctx.isExport || numTiles <= 400) && tileBounds && typeof splitClosedShellToTileGrid3D === 'function') {
    const pieces = splitClosedShellToTileGrid3D(shellTris, tileBounds, tileCols, tileRows);
    for (let i = 0; i < pieces.length; i++) {
      targetMeshArr.push(pieces[i]);
    }
    return;
  }

  // Fallback O(1) centroid assignment for synthetic >400-tile stress grids
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

function appendPolygonPrismClippedToTiles(ring, holes, zBot, zTop, layerId, ctx, targetMeshArr, allocShellId) {
  if (!ring || ring.length < 3) return;
  const shell = [];
  const shellId = typeof allocShellId === 'function' ? allocShellId() : 0;
  emitPolygonWithHolesSlab3D(ring, holes || [], zBot, zTop, layerId, shell, 0, shellId);
  appendShellClippedToTiles(shell, ctx, targetMeshArr);
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

function buildPixelContourBandAssignerSync(ctx, baseInfo, active) {
  const {
    halfW, halfH,
    MASK_RES_X, MASK_RES_Y, padW, padH, spanW, spanH,
    isTopographicRelief, numContourSteps,
    baseBottomZ, getStepIdxForVal, sampleRawTerrainGridZ
  } = ctx;
  const getSurfZ = baseInfo && baseInfo.getActualPrintedSurfaceMinZ;

  const xMinMS = -padW + 0.5 * (spanW / MASK_RES_X);
  const xMaxMS = padW - 0.5 * (spanW / MASK_RES_X);
  const yMinMS = -padH + 0.5 * (spanH / MASK_RES_Y);
  const yMaxMS = padH - 0.5 * (spanH / MASK_RES_Y);
  const dxMS = (xMaxMS - xMinMS) / (MASK_RES_X - 1);
  const dyMS = (yMaxMS - yMinMS) / (MASK_RES_Y - 1);

  const maxBandK = isTopographicRelief ? numContourSteps : 0;
  const totalBands = maxBandK + 1;
  const rawBandGrid = new Int16Array(MASK_RES_X * MASK_RES_Y).fill(-1);
  if (active) {
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
    const rPx = isTopographicRelief ? Math.max(2, Math.ceil(0.42 / dxMS)) : 1;
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

  const sampleMSIdx = (bx, by) => {
    const ix = Math.min(MASK_RES_X - 1, Math.max(0, Math.round((bx - xMinMS) / dxMS)));
    const iy = Math.min(MASK_RES_Y - 1, Math.max(0, Math.round((by - yMinMS) / dyMS)));
    return iy * MASK_RES_X + ix;
  };

  return {
    xMinMS, xMaxMS, yMinMS, yMaxMS, dxMS, dyMS,
    maxBandK, totalBands,
    rawBandGrid, printedSurfaceState, pixelBandIdx, sampleMSIdx,
    bandHasGreen: new Uint8Array(totalBands)
  };
}

async function buildPixelContourBandAssignerAsync(ctx, baseInfo, active, yieldCtrl) {
  const {
    halfW, halfH,
    MASK_RES_X, MASK_RES_Y, padW, padH, spanW, spanH,
    isTopographicRelief, numContourSteps,
    baseBottomZ, getStepIdxForVal, sampleRawTerrainGridZ
  } = ctx;
  const getSurfZ = baseInfo && baseInfo.getActualPrintedSurfaceMinZ;

  const xMinMS = -padW + 0.5 * (spanW / MASK_RES_X);
  const xMaxMS = padW - 0.5 * (spanW / MASK_RES_X);
  const yMinMS = -padH + 0.5 * (spanH / MASK_RES_Y);
  const yMaxMS = padH - 0.5 * (spanH / MASK_RES_Y);
  const dxMS = (xMaxMS - xMinMS) / (MASK_RES_X - 1);
  const dyMS = (yMaxMS - yMinMS) / (MASK_RES_Y - 1);

  const maxBandK = isTopographicRelief ? numContourSteps : 0;
  const totalBands = maxBandK + 1;
  const rawBandGrid = new Int16Array(MASK_RES_X * MASK_RES_Y).fill(-1);
  if (active) {
    for (let iy = 0; iy < MASK_RES_Y; iy++) {
      if ((iy & 31) === 0 && yieldCtrl) {
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

  const printedSurfaceState = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  const pixelBandIdx = new Int16Array(MASK_RES_X * MASK_RES_Y).fill(-1);
  {
    const rPx = isTopographicRelief ? Math.max(2, Math.ceil(0.42 / dxMS)) : 1;
    for (let iy = rPx; iy < MASK_RES_Y - rPx; iy++) {
      if ((iy & 31) === 0 && yieldCtrl) {
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

  const sampleMSIdx = (bx, by) => {
    const ix = Math.min(MASK_RES_X - 1, Math.max(0, Math.round((bx - xMinMS) / dxMS)));
    const iy = Math.min(MASK_RES_Y - 1, Math.max(0, Math.round((by - yMinMS) / dyMS)));
    return iy * MASK_RES_X + ix;
  };

  return {
    xMinMS, xMaxMS, yMinMS, yMaxMS, dxMS, dyMS,
    maxBandK, totalBands,
    rawBandGrid, printedSurfaceState, pixelBandIdx, sampleMSIdx,
    bandHasGreen: new Uint8Array(totalBands)
  };
}

function buildPixelContourBandAssigner(ctx, baseInfo, active = true, yieldCtrl = null) {
  if (yieldCtrl) {
    return buildPixelContourBandAssignerAsync(ctx, baseInfo, active, yieldCtrl);
  }
  return buildPixelContourBandAssignerSync(ctx, baseInfo, active);
}

function emitMarchingSquaresBandPolygonsSync(field, zBot, zTop, layerId, targetArr, minArea, isoVal, bandAssigner, ctx, allocShellId) {
  if (!field) return;
  const { MASK_RES_X, MASK_RES_Y } = ctx;
  const { xMinMS, xMaxMS, yMinMS, yMaxMS } = bandAssigner;
  const polys = extractMarchingSquaresPolygons2D(field, MASK_RES_X, MASK_RES_Y, xMinMS, xMaxMS, yMinMS, yMaxMS, isoVal, minArea);
  for (let i = 0; i < polys.length; i++) {
    const shell = [];
    emitPolygonWithHolesSlab3D(polys[i].ring, polys[i].holes, zBot, zTop, layerId, shell, 0, allocShellId());
    appendShellClippedToTiles(shell, ctx, targetArr);
  }
}

async function emitMarchingSquaresBandPolygonsAsync(field, zBot, zTop, layerId, targetArr, minArea, isoVal, bandAssigner, ctx, allocShellId, yieldCtrl, progressOpts = null) {
  if (!field) return;
  const { MASK_RES_X, MASK_RES_Y } = ctx;
  const { xMinMS, xMaxMS, yMinMS, yMaxMS, totalBands } = bandAssigner;
  if (yieldCtrl) {
    yieldCtrl.checkCancellation();
    await yieldCtrl.yieldIfNeeded();
  }
  const polys = extractMarchingSquaresPolygons2D(field, MASK_RES_X, MASK_RES_Y, xMinMS, xMaxMS, yMinMS, yMaxMS, isoVal, minArea);
  if (yieldCtrl) {
    await yieldCtrl.yieldIfNeeded();
    yieldCtrl.checkCancellation();
  }

  const totalP = Math.max(1, polys.length);
  const bandK = (progressOpts && progressOpts.bandK) || 0;
  const progressType = (progressOpts && progressOpts.progressType) || 'greenery';
  const tracker = progressOpts && progressOpts.tracker;

  for (let i = 0; i < polys.length; i++) {
    if (yieldCtrl && (i & 7) === 0) yieldCtrl.checkCancellation();
    const shell = [];
    emitPolygonWithHolesSlab3D(polys[i].ring, polys[i].holes, zBot, zTop, layerId, shell, 0, allocShellId());
    appendShellClippedToTiles(shell, ctx, targetArr);

    if (tracker && tracker.onProgress) {
      const layerBase = progressType === 'greenery' ? 0.0 : 0.45;
      const layerSpan = 0.45;
      const frac = layerBase + ((bandK + (i / totalP)) / Math.max(1, totalBands)) * layerSpan;
      const pct = 42 + Math.min(12, Math.round(frac * 12));
      if (pct !== tracker.lastReportedPct) {
        tracker.lastReportedPct = pct;
        tracker.onProgress(
          pct,
          `Etap 2/5: Konturowanie roślinności i dróg (${i + 1}/${totalP})...`,
          progressType === 'greenery'
            ? `Pasma zieleni miejskiej (pasmo ${bandK + 1}/${totalBands})`
            : `Infrastruktura drogowa (pasmo ${bandK + 1}/${totalBands})`
        );
      }
    }
    if (yieldCtrl) {
      await yieldCtrl.yieldIfNeeded();
    }
  }
}

if (typeof window !== 'undefined') {
  window.safeGetImageData = safeGetImageData;
  window.fillPolysOnMaskCtx = fillPolysOnMaskCtx;
  window.appendShellClippedToTiles = appendShellClippedToTiles;
  window.appendPolygonPrismClippedToTiles = appendPolygonPrismClippedToTiles;
  window.buildSmoothedBandField = buildSmoothedBandField;
  window.buildPixelContourBandAssigner = buildPixelContourBandAssigner;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    safeGetImageData,
    fillPolysOnMaskCtx,
    appendShellClippedToTiles,
    appendPolygonPrismClippedToTiles,
    buildSmoothedBandField,
    buildPixelContourBandAssignerSync,
    buildPixelContourBandAssignerAsync,
    buildPixelContourBandAssigner,
    emitMarchingSquaresBandPolygonsSync,
    emitMarchingSquaresBandPolygonsAsync
  };
}
