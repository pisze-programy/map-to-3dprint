// ============================================================================
// src/mesh/terrain_dem_grid.js
// Real DEM Interpolation, P80 Relief Classification, Shoreline SDF Integration
// & Per-Tile Bounds Calculation
// ============================================================================

if (typeof pointInPolyOrNear2D === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
}

function buildTerrainDemGridAndTiles(scene, maskCtx, state) {
  scene = scene || {};
  maskCtx = maskCtx || {};
  state = state || {};
  const {
    maxDimMm = 320,
    scaleMm = maxDimMm / 169.2,
    mmPerUnit = scaleMm,
    halfW = 84.6,
    halfH = 84.6,
    tileCols = 1,
    tileRows = 1,
    cellsPerCol = 180,
    cellsPerRow = 180,
    TERRAIN_RES_X = cellsPerCol * tileCols,
    TERRAIN_RES_Y = cellsPerRow * tileRows,
    cellStepX = (2 * halfW) / TERRAIN_RES_X,
    cellStepY = (2 * halfH) / TERRAIN_RES_Y,
    kerfUnits = 0,
    scaleToBed = 1.0,
    cropCX = 0,
    cropCY = 0,
    padW = halfW + 0.4,
    padH = halfH + 0.4,
    spanW = 2 * padW,
    spanH = 2 * padH,
    toBed = (pt) => [(pt[0] - cropCX) * scaleToBed, (pt[1] - cropCY) * scaleToBed],
    sampleBilinearMask,
    waterSDF
  } = maskCtx;

  const demObj = scene.dem || { gridSize: 2, minElev: 0, maxElev: 10, grid: [[0, 0], [0, 0]] };
  const rawGrid = (Array.isArray(demObj.grid) && demObj.grid.length >= 2) ? demObj.grid : [[0, 0], [0, 0]];
  const demN = demObj.gridSize || rawGrid.length;

  let gridMin = Infinity;
  let gridMax = -Infinity;
  for (let j = 0; j < demN; j++) {
    const row = rawGrid[j];
    if (!row) continue;
    for (let i = 0; i < demN; i++) {
      const v = row[i];
      if (Number.isFinite(v)) {
        if (v < gridMin) gridMin = v;
        if (v > gridMax) gridMax = v;
      }
    }
  }
  const rawMin = Number.isFinite(gridMin)
    ? (Number.isFinite(demObj.minElev) ? Math.min(gridMin, demObj.minElev) : gridMin)
    : (Number.isFinite(demObj.minElev) ? demObj.minElev : 0);
  const rawMax = Number.isFinite(gridMax)
    ? (Number.isFinite(demObj.maxElev) ? Math.max(gridMax, demObj.maxElev) : gridMax)
    : (Number.isFinite(demObj.maxElev) ? demObj.maxElev : 10);

  let hasWaterOrCoastline = Boolean(
    (Array.isArray(scene.waterPolys) && scene.waterPolys.length > 0) ||
    (Array.isArray(scene.coastlines) && scene.coastlines.length > 0) ||
    (Array.isArray(scene.waterLines) && scene.waterLines.length > 0)
  );
  if (!hasWaterOrCoastline) {
    if (maskCtx.waterMask && maskCtx.waterMask.length > 0) {
      for (let i = 0; i < maskCtx.waterMask.length; i += 16) {
        if (maskCtx.waterMask[i]) { hasWaterOrCoastline = true; break; }
      }
    } else if (waterSDF && waterSDF.length > 0) {
      for (let i = 0; i < waterSDF.length; i += 16) {
        if (waterSDF[i] < 0) { hasWaterOrCoastline = true; break; }
      }
    }
  }

  // Clamp negative submarine ocean bathymetry (< 0 m) to 0 m sea-level datum on coastal/harbour scenes
  // before computing realMin, realElevDelta, p80Span, contourStepM, and demGrid, while preserving
  // genuine sub-sea-level dry land depressions (e.g. Dead Sea / Death Valley rawMax < 2 m, Dutch polders rawMin >= -8 m).
  const bathymetryClamped = (rawMin < -8.0) && (rawMax >= 2.0) && (hasWaterOrCoastline || rawMin < -15.0);

  let demRaw = rawGrid;
  let realMin;
  let realMax;
  if (bathymetryClamped) {
    demRaw = new Array(demN);
    let cMin = Infinity;
    let cMax = -Infinity;
    for (let j = 0; j < demN; j++) {
      const srcRow = rawGrid[j];
      const dstRow = new Float64Array(demN);
      for (let i = 0; i < demN; i++) {
        const v = (srcRow && Number.isFinite(srcRow[i])) ? srcRow[i] : 0;
        const cv = v < 0.0 ? 0.0 : v;
        dstRow[i] = cv;
        if (cv < cMin) cMin = cv;
        if (cv > cMax) cMax = cv;
      }
      demRaw[j] = dstRow;
    }
    realMin = Number.isFinite(cMin) ? cMin : 0.0;
    realMax = Number.isFinite(cMax) ? cMax : Math.max(0.0, rawMax);
  } else {
    realMin = Number.isFinite(demObj.minElev) ? demObj.minElev : rawMin;
    realMax = Number.isFinite(demObj.maxElev) ? demObj.maxElev : rawMax;
  }

  const minElev = realMin;
  const maxElev = Math.max(minElev + 4.0, realMax);

  function sampleRawDemMeters(bx, by) {
    const ox = bx / scaleToBed + cropCX;
    const oy = by / scaleToBed + cropCY;
    const u = Math.min(1, Math.max(0, (ox + padW) / spanW)) * (demN - 1);
    const v = Math.min(1, Math.max(0, (oy + padH) / spanH)) * (demN - 1);
    const i0 = Math.floor(u), i1 = Math.min(demN - 1, i0 + 1);
    const j0 = Math.floor(v), j1 = Math.min(demN - 1, j0 + 1);
    const fu = u - i0, fv = v - j0;
    return (demRaw[j0][i0] * (1 - fu) + demRaw[j0][i1] * fu) * (1 - fv) +
           (demRaw[j1][i0] * (1 - fu) + demRaw[j1][i1] * fu) * fv;
  }

  const strideTX = TERRAIN_RES_X + 1;
  const strideTY = TERRAIN_RES_Y + 1;
  let demGrid = new Float32Array(strideTX * strideTY);
  for (let gy = 0; gy <= TERRAIN_RES_Y; gy++) {
    const by = -halfH + (gy / TERRAIN_RES_Y) * (2 * halfH);
    for (let gx = 0; gx <= TERRAIN_RES_X; gx++) {
      const bx = -halfW + (gx / TERRAIN_RES_X) * (2 * halfW);
      demGrid[gy * strideTX + gx] = Math.max(0, sampleRawDemMeters(bx, by) - minElev);
    }
  }

  for (let pass = 0; pass < 3; pass++) {
    const next = new Float32Array(demGrid.length);
    for (let gy = 0; gy <= TERRAIN_RES_Y; gy++) {
      for (let gx = 0; gx <= TERRAIN_RES_X; gx++) {
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = Math.min(TERRAIN_RES_Y, Math.max(0, gy + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const nx = Math.min(TERRAIN_RES_X, Math.max(0, gx + dx));
            const w = (dx === 0 && dy === 0) ? 4 : (dx === 0 || dy === 0) ? 2 : 1;
            sum += demGrid[ny * strideTX + nx] * w;
            cnt += w;
          }
        }
        next[gy * strideTX + gx] = sum / cnt;
      }
    }
    demGrid = next;
  }

  const sortedElevs = Array.from(demGrid).sort((a, b) => a - b);
  const p10 = sortedElevs[Math.floor(sortedElevs.length * 0.10)] || 0;
  const p90 = sortedElevs[Math.floor(sortedElevs.length * 0.90)] || 0;
  const p80Span = Math.max(0, p90 - p10);
  const realElevDelta = Math.max(4.0, maxElev - minElev);
  const tScale = state.terrainScale || 1.0;

  const isTopographicRelief = (p80Span > 38.0) || (realElevDelta > 135.0) || (tScale > 1.25);
  const isAlpineRelief = (p80Span > 75.0) || (realElevDelta > 145.0);

  const mToU = (scene.metersToUnits || 0.13) * scaleToBed;
  const hollowBase = !!state.hollowBase;
  const layerHeightMm = state.layerHeightMm || (state.isResin ? 0.05 : 0.20);
  const quantizeZUnits = (uVal) => {
    const mm = uVal * mmPerUnit;
    const qMm = Math.max(layerHeightMm, Math.round(mm / layerHeightMm) * layerHeightMm);
    return qMm / mmPerUnit;
  };

  const baseBottomZ = quantizeZUnits(2.35 / scaleMm);
  const deepWaterZ = quantizeZUnits(1.68 / scaleMm);
  const zSubWater = quantizeZUnits(1.30 / scaleMm);
  const zDrainVault = quantizeZUnits(0.70 / scaleMm);
  const gHeight = Math.max(layerHeightMm / mmPerUnit, quantizeZUnits(0.24));
  const rHeight = Math.max(layerHeightMm / mmPerUnit, quantizeZUnits(0.30));
  const pathHeight = Math.max(layerHeightMm / mmPerUnit, quantizeZUnits(0.16));
  const brHeight = Math.max(layerHeightMm / mmPerUnit, quantizeZUnits(0.38));

  const maxReliefUnits = !isTopographicRelief
    ? 0.0
    : isAlpineRelief
      ? Math.max(3.6, Math.min(14.0, realElevDelta * mToU * 2.1 * tScale))
      : Math.max(1.2, Math.min(4.8, realElevDelta * mToU * 0.95 * tScale));
  const elevSpan = Math.max(10.0, realElevDelta);
  const numContourSteps = !isTopographicRelief
    ? 1
    : isAlpineRelief
      ? Math.max(8, Math.min(18, Math.round(maxReliefUnits / 0.42)))
      : Math.max(3, Math.min(8, Math.round(maxReliefUnits / 0.42)));
  const stepUnits = maxReliefUnits > 0 ? Math.max(layerHeightMm / mmPerUnit, quantizeZUnits(maxReliefUnits / numContourSteps)) : quantizeZUnits(0.42);
  const contourStepM = elevSpan / Math.max(1, numContourSteps);

  const thresholds = [];
  for (let k = 0; k <= numContourSteps + 2; k++) thresholds.push(baseBottomZ + k * stepUnits);

  const zGrid = new Float32Array(strideTX * strideTY);
  for (let gy = 0; gy <= TERRAIN_RES_Y; gy++) {
    const by = -halfH + (gy / TERRAIN_RES_Y) * (2 * halfH);
    for (let gx = 0; gx <= TERRAIN_RES_X; gx++) {
      const bx = -halfW + (gx / TERRAIN_RES_X) * (2 * halfW);
      const sdf = (sampleBilinearMask && waterSDF) ? sampleBilinearMask(waterSDF, bx, by) : 10.0;
      if (sdf < 0.0) {
        zGrid[gy * strideTX + gx] = baseBottomZ + Math.max(-0.95 / scaleMm, (sdf * 0.35) / scaleMm);
      } else if (!isTopographicRelief) {
        zGrid[gy * strideTX + gx] = baseBottomZ + Math.min(0.22, 0.015 + sdf * 0.35);
      } else {
        const relE = Math.max(0, demGrid[gy * strideTX + gx] - p10 * 0.35);
        const bankBlend = Math.min(1.0, sdf / (isAlpineRelief ? 1.4 : 2.8));
        const hUnits = (relE / elevSpan) * maxReliefUnits * bankBlend;
        zGrid[gy * strideTX + gx] = baseBottomZ + Math.min(0.16, 0.015 + sdf * 0.32) + hUnits;
      }
    }
  }

  // Level all 4 DEM cell corners under every building footprint (both waterfront quays & hillside terraces)
  // so no building is ever split internally by a contour step or shoreline bevel (0 floating, 0 base∩buildings!)
  {
    const nGridV = strideTX * strideTY;
    const ufParent = new Int32Array(nGridV).map((_, i) => i);
    const ufActive = new Uint8Array(nGridV);
    const ufFind = (x) => { while (ufParent[x] !== x) { ufParent[x] = ufParent[ufParent[x]]; x = ufParent[x]; } return x; };
    const ufUnion = (a, b) => { const ra = ufFind(a), rb = ufFind(b); if (ra !== rb) ufParent[rb] = ra; };

    const cellOverlapsBuilding = (x0, y0, x1, y1, poly) => {
      const cx = (x0 + x1) * 0.5, cy = (y0 + y1) * 0.5;
      if (pointInPolyOrNear2D(cx, cy, poly, 0.04) ||
          pointInPolyOrNear2D(x0, y0, poly, 0.04) ||
          pointInPolyOrNear2D(x1, y0, poly, 0.04) ||
          pointInPolyOrNear2D(x1, y1, poly, 0.04) ||
          pointInPolyOrNear2D(x0, y1, poly, 0.04)) return true;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        if (p[0] >= x0 - 0.04 && p[0] <= x1 + 0.04 && p[1] >= y0 - 0.04 && p[1] <= y1 + 0.04) return true;
      }
      const box = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      for (let i = 0; i < poly.length; i++) {
        const a1 = poly[i], a2 = poly[(i + 1) % poly.length];
        for (let e = 0; e < 4; e++) {
          if (segmentsIntersectProper(a1, a2, box[e], box[(e + 1) % 4])) return true;
        }
      }
      return false;
    };

    (scene.buildings || []).forEach(b => {
      if (b.hidden || b.btype === 'pier') return;
      const clipped = clipPolyToBox(b.outer.map(toBed), -halfW + 0.38, -halfH + 0.38, halfW - 0.38, halfH - 0.38);
      if (clipped.length < 3) return;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < clipped.length; i++) {
        const p = clipped[i];
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      }
      const isImportant = b.part || b.tower || b.church || b.landmark || (b.h || 0) >= 20 || b.isLandmark;
      const minSpan = Math.min(maxX - minX, maxY - minY);
      const area = Math.abs(signedArea2D(clipped));
      const minPrintUnits = 0.35 / scaleMm;
      if (isImportant ? (area < 0.002) : (minSpan < minPrintUnits || area < minPrintUnits * minPrintUnits * 0.65)) return;

      const padR = (minSpan * scaleMm < 0.48) ? Math.min(0.24, 0.32 / scaleMm) : Math.min(0.16, 0.28 / scaleMm);
      const gxMin = Math.max(0, Math.floor(((minX - padR + halfW) / (2 * halfW)) * TERRAIN_RES_X));
      const gxMax = Math.min(TERRAIN_RES_X - 1, Math.floor(((maxX + padR + halfW) / (2 * halfW)) * TERRAIN_RES_X));
      const gyMin = Math.max(0, Math.floor(((minY - padR + halfH) / (2 * halfH)) * TERRAIN_RES_Y));
      const gyMax = Math.min(TERRAIN_RES_Y - 1, Math.floor(((maxY + padR + halfH) / (2 * halfH)) * TERRAIN_RES_Y));

      let anchorV = -1;
      for (let gy = gyMin; gy <= gyMax; gy++) {
        const y0 = -halfH + gy * cellStepY, y1 = y0 + cellStepY;
        for (let gx = gxMin; gx <= gxMax; gx++) {
          const x0 = -halfW + gx * cellStepX, x1 = x0 + cellStepX;
          if (!cellOverlapsBuilding(x0 - padR, y0 - padR, x1 + padR, y1 + padR, clipped)) continue;
          const v00 = gy * strideTX + gx, v10 = v00 + 1;
          const v01 = (gy + 1) * strideTX + gx, v11 = v01 + 1;
          ufActive[v00] = ufActive[v10] = ufActive[v01] = ufActive[v11] = 1;
          ufUnion(v00, v10); ufUnion(v00, v01); ufUnion(v00, v11);
          if (anchorV >= 0) ufUnion(anchorV, v00);
          else anchorV = v00;
        }
      }
    });

    const compSum = new Float64Array(nGridV);
    const compCnt = new Int32Array(nGridV);
    for (let v = 0; v < nGridV; v++) {
      if (!ufActive[v]) continue;
      const r = ufFind(v);
      compSum[r] += Math.max(baseBottomZ + 0.08 / scaleMm, zGrid[v]);
      compCnt[r]++;
    }
    for (let v = 0; v < nGridV; v++) {
      if (!ufActive[v]) continue;
      const r = ufFind(v);
      zGrid[v] = compSum[r] / compCnt[r];
    }
  }

  for (let i = 0; i < zGrid.length; i++) {
    for (let k = 0; k <= numContourSteps + 2; k++) {
      if (Math.abs(zGrid[i] - thresholds[k]) < 1e-3) zGrid[i] += 1.2e-3;
    }
  }

  function getStepIdxForVal(zVal) {
    if (zVal < thresholds[0]) return -1;
    if (!isTopographicRelief) return 0;
    for (let k = numContourSteps; k >= 0; k--) {
      if (zVal >= thresholds[k]) return k;
    }
    return 0;
  }

  function sampleRawTerrainGridZ(bx, by) {
    const u = Math.min(TERRAIN_RES_X - 1e-6, Math.max(0, ((bx + halfW) / (2 * halfW)) * TERRAIN_RES_X));
    const v = Math.min(TERRAIN_RES_Y - 1e-6, Math.max(0, ((by + halfH) / (2 * halfH)) * TERRAIN_RES_Y));
    const gx = Math.min(TERRAIN_RES_X - 1, Math.floor(u));
    const gy = Math.min(TERRAIN_RES_Y - 1, Math.floor(v));
    const fu = u - gx, fv = v - gy;
    return (zGrid[gy * strideTX + gx] * (1 - fu) + zGrid[gy * strideTX + (gx + 1)] * fu) * (1 - fv) +
           (zGrid[(gy + 1) * strideTX + gx] * (1 - fu) + zGrid[(gy + 1) * strideTX + (gx + 1)] * fu) * fv;
  }

  const tileBounds = [];
  for (let tr = 0; tr < tileRows; tr++) {
    const gy0 = tr * cellsPerRow;
    const gy1 = (tr === tileRows - 1) ? TERRAIN_RES_Y : (tr + 1) * cellsPerRow;
    const nominalY0 = -halfH + gy0 * cellStepY;
    const nominalY1 = (tr === tileRows - 1) ? halfH : -halfH + gy1 * cellStepY;
    const tileY0 = nominalY0 + (tr > 0 ? kerfUnits : 0.0);
    const tileY1 = nominalY1 - (tr < tileRows - 1 ? kerfUnits : 0.0);
    for (let tc = 0; tc < tileCols; tc++) {
      const gx0 = tc * cellsPerCol;
      const gx1 = (tc === tileCols - 1) ? TERRAIN_RES_X : (tc + 1) * cellsPerCol;
      const nominalX0 = -halfW + gx0 * cellStepX;
      const nominalX1 = (tc === tileCols - 1) ? halfW : -halfW + gx1 * cellStepX;
      const tileX0 = nominalX0 + (tc > 0 ? kerfUnits : 0.0);
      const tileX1 = nominalX1 - (tc < tileCols - 1 ? kerfUnits : 0.0);
      const tileId = tr * tileCols + tc;
      tileBounds[tileId] = {
        tc, tr, gx0, gx1, gy0, gy1,
        x0: tileX0, x1: tileX1, y0: tileY0, y1: tileY1,
        stepX: (tileX1 - tileX0) / (gx1 - gx0),
        stepY: (tileY1 - tileY0) / (gy1 - gy0)
      };
    }
  }

  return Object.assign({}, maskCtx, {
    mToU, hollowBase, layerHeightMm,
    realMin, realMax, realElevDelta, p80Span, contourStepM, bathymetryClamped, demGrid,
    isTopographicRelief, isAlpineRelief, numContourSteps, stepUnits, thresholds,
    baseBottomZ, deepWaterZ, zSubWater, zDrainVault, gHeight, rHeight, pathHeight, brHeight,
    strideTX, strideTY, zGrid, tileBounds,
    quantizeZUnits, getStepIdxForVal, sampleRawTerrainGridZ
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildTerrainDemGridAndTiles };
}
