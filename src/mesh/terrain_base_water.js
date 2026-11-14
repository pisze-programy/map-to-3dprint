// ============================================================================
// src/mesh/terrain_base_water.js
// Per-Tile Watertight Stepped DEM Base, SLA Hollow Vault Ribs + Drain Channels,
// Underside R1C1 Patch & Studio Frame (Water Basin delegated to features_water.js)
// ============================================================================

if (typeof emitUndersideIdPatch === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
  Object.assign(global, require('./mesh_primitives.js'));
  Object.assign(global, require('./roof_architectural.js'));
}
if (typeof getWaterBasinLevels === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./features_water.js'));
}

function buildTerrainBaseAndWaterMeshes(ctx, state, meshes, options = {}) {
  const isExport = Boolean((options && options.isExport) || (state && state.isExport) || (ctx && ctx.isExport));
  const {
    scaleMm, mmPerUnit, halfW, halfH, tileCols, tileRows, numTiles,
    TERRAIN_RES_X, TERRAIN_RES_Y, cellStepX, cellStepY, hollowBase,
    waterMask, sampleMaskIdx, numContourSteps, thresholds,
    baseBottomZ, zSubWater, zDrainVault,
    strideTX, zGrid, tileBounds, quantizeZUnits, getStepIdxForVal, sampleRawTerrainGridZ
  } = ctx;

  const waterLevels = getWaterBasinLevels(ctx, state);
  const { waterSurfZ } = waterLevels;
  const waterCutout = Boolean(state && state.waterCutout);
  const hollowWallUnits = Math.max(0.55, Math.min(1.15, (state.hollowWallMm || 1.8) / Math.max(1.05, mmPerUnit)));
  let vaultSavedSceneVol = 0;

  const cellMinTopZ = new Float32Array(TERRAIN_RES_X * TERRAIN_RES_Y);
  const wetCell = waterCutout ? new Uint8Array(TERRAIN_RES_X * TERRAIN_RES_Y) : null;
  for (let gy = 0; gy < TERRAIN_RES_Y; gy++) {
    for (let gx = 0; gx < TERRAIN_RES_X; gx++) {
      const vMin = Math.min(
        zGrid[gy * strideTX + gx],
        zGrid[gy * strideTX + (gx + 1)],
        zGrid[(gy + 1) * strideTX + (gx + 1)],
        zGrid[(gy + 1) * strideTX + gx]
      );
      const kMin = getStepIdxForVal(vMin);
      cellMinTopZ[gy * TERRAIN_RES_X + gx] = (kMin < 0) ? zSubWater : thresholds[kMin];
      if (wetCell && vMin < baseBottomZ) {
        wetCell[gy * TERRAIN_RES_X + gx] = 1;
      }
    }
  }

  function emitBoundaryStaircaseWall(ax, ay, vA, fA, bx, by, vB, fB, norm, tileId) {
    const getBandTopZ = (val) => {
      const k = getStepIdxForVal(val);
      return (k < 0) ? zSubWater : thresholds[k];
    };
    const cuts = [];
    const vLo = Math.min(vA, vB), vHi = Math.max(vA, vB);
    const maxK = ctx.isTopographicRelief ? numContourSteps : 0;
    for (let k = 0; k <= maxK; k++) {
      const thr = thresholds[k];
      if (thr > vLo && thr < vHi) {
        const pt = interpCellEdgeCanonical({ x: ax, y: ay, v: vA }, { x: bx, y: by, v: vB }, thr);
        const s = Math.hypot(pt.x - ax, pt.y - ay) / (Math.hypot(bx - ax, by - ay) || 1e-9);
        cuts.push({ x: pt.x, y: pt.y, thr, k, s });
      }
    }
    cuts.sort((a, b) => a.s - b.s);

    const chain = [];
    let currZ = getBandTopZ(vA);
    chain.push([ax, ay, currZ]);
    for (let i = 0; i < cuts.length; i++) {
      const c = cuts[i];
      chain.push([c.x, c.y, currZ]);
      const nextZ = (vB > vA) ? c.thr : (c.k === 0 ? zSubWater : thresholds[c.k - 1]);
      chain.push([c.x, c.y, nextZ]);
      currZ = nextZ;
    }
    chain.push([bx, by, currZ]);

    const AFloor = [ax, ay, fA], BFloor = [bx, by, fB];
    const lastTop = chain[chain.length - 1];
    for (let i = 0; i < chain.length - 1; i++) {
      const P0 = chain[i], P1 = chain[i + 1];
      if (Math.hypot(P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]) > 1e-6) {
        pushTri(meshes.base, AFloor, P1, P0, norm, 1, -1, tileId);
      }
    }
    pushTri(meshes.base, AFloor, BFloor, lastTop, norm, 1, -1, tileId);
  }

  function emitCutoutBoundaryWall(ax, ay, vA, fA, bx, by, vB, fB, norm, tileId) {
    if (vA < baseBottomZ && vB < baseBottomZ) return;
    if (vA >= baseBottomZ && vB >= baseBottomZ) {
      emitBoundaryStaircaseWall(ax, ay, vA, fA, bx, by, vB, fB, norm, tileId);
      return;
    }

    const pt = interpCellEdgeCanonical({ x: ax, y: ay, v: vA }, { x: bx, y: by, v: vB }, baseBottomZ);
    const maxK = ctx.isTopographicRelief ? numContourSteps : 0;
    const cuts = [];
    const eA = { x: ax, y: ay, v: vA };
    const eB = { x: bx, y: by, v: vB };
    const edgeLen = Math.hypot(bx - ax, by - ay) || 1e-9;
    const vHi = Math.max(vA, vB);
    for (let k = 1; k <= maxK; k++) {
      const thr = thresholds[k];
      if (thr > baseBottomZ && thr < vHi) {
        const cPt = interpCellEdgeCanonical(eA, eB, thr);
        const s = Math.hypot(cPt.x - ax, cPt.y - ay) / edgeLen;
        cuts.push({ x: cPt.x, y: cPt.y, thr, k, s });
      }
    }
    cuts.sort((a, b) => a.s - b.s);

    let xStart, yStart, fStart, xEnd, yEnd, fEnd, currZ;
    const chain = [];
    if (vA < baseBottomZ) {
      // A is wet, B is dry -> wall spans [pt -> B]
      if (Math.hypot(bx - pt.x, by - pt.y) <= 1e-7) return;
      xStart = pt.x; yStart = pt.y; fStart = 0.0;
      xEnd = bx; yEnd = by; fEnd = fB;
      currZ = thresholds[0];
      chain.push([xStart, yStart, currZ]);
      for (let i = 0; i < cuts.length; i++) {
        const c = cuts[i];
        chain.push([c.x, c.y, currZ]);
        chain.push([c.x, c.y, c.thr]);
        currZ = c.thr;
      }
      chain.push([xEnd, yEnd, currZ]);
    } else {
      // A is dry, B is wet -> wall spans [A -> pt]
      if (Math.hypot(pt.x - ax, pt.y - ay) <= 1e-7) return;
      xStart = ax; yStart = ay; fStart = fA;
      xEnd = pt.x; yEnd = pt.y; fEnd = 0.0;
      const kA = getStepIdxForVal(vA);
      currZ = (kA < 0) ? thresholds[0] : thresholds[kA];
      chain.push([xStart, yStart, currZ]);
      for (let i = 0; i < cuts.length; i++) {
        const c = cuts[i];
        chain.push([c.x, c.y, currZ]);
        const nextZ = thresholds[c.k - 1];
        chain.push([c.x, c.y, nextZ]);
        currZ = nextZ;
      }
      chain.push([xEnd, yEnd, currZ]);
    }

    const AFloor = [xStart, yStart, fStart], BFloor = [xEnd, yEnd, fEnd];
    const lastTop = chain[chain.length - 1];
    for (let i = 0; i < chain.length - 1; i++) {
      const P0 = chain[i], P1 = chain[i + 1];
      if (Math.hypot(P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]) > 1e-6) {
        pushTri(meshes.base, AFloor, P1, P0, norm, 1, -1, tileId);
      }
    }
    pushTri(meshes.base, AFloor, BFloor, lastTop, norm, 1, -1, tileId);
  }

  function emitBoundaryWallForEdge(ax, ay, vA, fA, bx, by, vB, fB, norm, tileId) {
    if (waterCutout) {
      emitCutoutBoundaryWall(ax, ay, vA, fA, bx, by, vB, fB, norm, tileId);
    } else {
      emitBoundaryStaircaseWall(ax, ay, vA, fA, bx, by, vB, fB, norm, tileId);
      emitWaterBoundaryWall(ctx, meshes, waterLevels, ax, ay, vA, bx, by, vB, norm, tileId);
    }
  }

  const cellTerracePolys = Array.from({ length: TERRAIN_RES_X * TERRAIN_RES_Y }, () => []);

  for (let tr = 0; tr < tileRows; tr++) {
    for (let tc = 0; tc < tileCols; tc++) {
      const tileId = tr * tileCols + tc;
      const tb = tileBounds[tileId];
      const { gx0, gx1, gy0, gy1, x0: tileX0, y0: tileY0, stepX: tileStepX, stepY: tileStepY } = tb;

      const rimCells = Math.max(3, Math.round(3.6 / (cellStepX * scaleMm)));
      const hasVault = hollowBase && (gx1 - gx0 > rimCells * 2 + 4) && (gy1 - gy0 > rimCells * 2 + 4);
      const nearWaterVertex = (vx, vy) => {
        if (!wetCell) return false;
        const cx0 = Math.max(0, vx - rimCells);
        const cx1 = Math.min(TERRAIN_RES_X - 1, vx + rimCells - 1);
        const cy0 = Math.max(0, vy - rimCells);
        const cy1 = Math.min(TERRAIN_RES_Y - 1, vy + rimCells - 1);
        for (let cy = cy0; cy <= cy1; cy++) {
          const row = cy * TERRAIN_RES_X;
          for (let cx = cx0; cx <= cx1; cx++) {
            if (wetCell[row + cx]) return true;
          }
        }
        return false;
      };

      const midGx = Math.floor((gx0 + gx1) * 0.5);
      const midGy = Math.floor((gy0 + gy1) * 0.5);
      const labelLen = 5;
      let startGx = Math.max(gx0 + 2, Math.min(gx1 - 3 - (labelLen - 1), midGx - 2));
      let endGx = startGx + (labelLen - 1);
      let idGy = Math.max(gy0 + 2, Math.min(gy1 - 3, midGy));
      const ribCellsX = Math.max(5, Math.round(25.0 / (cellStepX * scaleMm)));
      const ribCellsY = Math.max(5, Math.round(25.0 / (cellStepY * scaleMm)));

      const patchVertsDry = (sx, sy) => {
        for (let vy = sy; vy <= sy + 1; vy++) {
          for (let vx = sx; vx <= sx + labelLen; vx++) {
            if (nearWaterVertex(vx, vy)) return false;
          }
        }
        return true;
      };

      let canEmitIdPatch = true;
      if (waterCutout && !patchVertsDry(startGx, idGy)) {
        canEmitIdPatch = false;
        const scanGxMin = Math.max(gx0 + 2, gx0 + rimCells);
        const scanGxMax = Math.min(gx1 - 3 - (labelLen - 1), gx1 - rimCells - labelLen);
        const scanGyMin = Math.max(gy0 + 2, gy0 + rimCells);
        const scanGyMax = Math.min(gy1 - 3, gy1 - rimCells - 1);
        let bestDist = Infinity;
        for (let cy = scanGyMin; cy <= scanGyMax; cy++) {
          for (let cx = scanGxMin; cx <= scanGxMax; cx++) {
            if (!patchVertsDry(cx, cy)) continue;
            let mTop = Infinity;
            for (let g = cx; g < cx + labelLen; g++) {
              const ct = cellMinTopZ[cy * TERRAIN_RES_X + g];
              if (ct < mTop) mTop = ct;
            }
            if (hasVault && mTop - hollowWallUnits < zDrainVault) continue;
            const d = Math.hypot(cx - startGx, cy - idGy);
            if (d < bestDist) {
              bestDist = d;
              startGx = cx;
              endGx = cx + (labelLen - 1);
              idGy = cy;
              canEmitIdPatch = true;
            }
          }
        }
      }

      let minTop5 = Infinity;
      for (let g = startGx; g <= endGx; g++) {
        const ct = cellMinTopZ[idGy * TERRAIN_RES_X + g];
        if (ct < minTop5) minTop5 = ct;
      }
      const idFbase = (hasVault && (!waterCutout || canEmitIdPatch))
        ? Math.max(zDrainVault, quantizeZUnits(minTop5 - hollowWallUnits))
        : 0.0;

      const getBaseVertexFloorZ = (vx, vy) => {
        if (!hasVault) return 0.0;
        if (waterCutout && nearWaterVertex(vx, vy)) return 0.0;
        if ((!waterCutout || canEmitIdPatch) && vx >= startGx && vx <= endGx + 1 && vy >= idGy && vy <= idGy + 1) {
          return idFbase;
        }

        const inVaultX = (vx > gx0 + rimCells && vx < gx1 - rimCells);
        const inVaultY = (vy > gy0 + rimCells && vy < gy1 - rimCells);
        if (!inVaultX || !inVaultY) {
          const isOuterWest = (tc === 0) && (vx <= gx0 + rimCells);
          const isOuterEast = (tc === tileCols - 1) && (vx >= gx1 - rimCells);
          const isOuterSouth = (tr === 0) && (vy <= gy0 + rimCells);
          const isOuterNorth = (tr === tileRows - 1) && (vy >= gy1 - rimCells);
          const isInternalDrain = (numTiles > 1) && (
            (!isOuterSouth && !isOuterNorth && (vx >= midGx - 1 && vx <= midGx + 1) && (vy <= gy0 + rimCells || vy >= gy1 - rimCells)) ||
            (!isOuterWest && !isOuterEast && (vy >= midGy - 1 && vy <= midGy + 1) && (vx <= gx0 + rimCells || vx >= gx1 - rimCells))
          );
          return isInternalDrain ? zDrainVault : 0.0;
        }

        const relX = vx - gx0, relY = vy - gy0;
        const isRibX = (relX % ribCellsX === 0) && (relX >= rimCells + ribCellsX) && (relX <= (gx1 - gx0) - rimCells - ribCellsX);
        const isRibY = (relY % ribCellsY === 0) && (relY >= rimCells + ribCellsY) && (relY <= (gy1 - gy0) - rimCells - ribCellsY);
        if (isRibX || isRibY) {
          const midSpanY = Math.floor(ribCellsY * 0.5), midSpanX = Math.floor(ribCellsX * 0.5);
          const isNotch = (isRibX && Math.abs((relY % ribCellsY) - midSpanY) <= 1) ||
                          (isRibY && Math.abs((relX % ribCellsX) - midSpanX) <= 1);
          return isNotch ? zDrainVault : 0.0;
        }

        let minTop = Infinity;
        for (let dy = -1; dy <= 0; dy++) {
          for (let dx = -1; dx <= 0; dx++) {
            const cx = Math.min(gx1 - 1, Math.max(gx0, vx + dx));
            const cy = Math.min(gy1 - 1, Math.max(gy0, vy + dy));
            const ct = cellMinTopZ[cy * TERRAIN_RES_X + cx];
            if (ct < minTop) minTop = ct;
          }
        }
        const maxAllowedCeiling = minTop - hollowWallUnits;
        if (maxAllowedCeiling < zDrainVault) return 0.0;
        return Math.min(maxAllowedCeiling, Math.max(zDrainVault, quantizeZUnits(maxAllowedCeiling)));
      };

      for (let gy = gy0; gy < gy1; gy++) {
        const y0 = tileY0 + (gy - gy0) * tileStepY;
        const y1 = tileY0 + (gy + 1 - gy0) * tileStepY;
        for (let gx = gx0; gx < gx1; gx++) {
          const x0 = tileX0 + (gx - gx0) * tileStepX;
          const x1 = tileX0 + (gx + 1 - gx0) * tileStepX;

          const v00 = zGrid[gy * strideTX + gx];
          const v10 = zGrid[gy * strideTX + (gx + 1)];
          const v11 = zGrid[(gy + 1) * strideTX + (gx + 1)];
          const v01 = zGrid[(gy + 1) * strideTX + gx];

          const f00 = getBaseVertexFloorZ(gx, gy);
          const f10 = getBaseVertexFloorZ(gx + 1, gy);
          const f11 = getBaseVertexFloorZ(gx + 1, gy + 1);
          const f01 = getBaseVertexFloorZ(gx, gy + 1);

          const vMax = Math.max(v00, v10, v11, v01);
          const vMin = Math.min(v00, v10, v11, v01);

          const isCutoutStraddlingCell = waterCutout && vMin < baseBottomZ && vMax >= baseBottomZ;
          const isCutoutPureWaterCell = waterCutout && vMax < baseBottomZ;

          const avgFloor = (f00 + f10 + f11 + f01) * 0.25;
          if (!isCutoutPureWaterCell && !isCutoutStraddlingCell && avgFloor > 0) {
            vaultSavedSceneVol += avgFloor * tileStepX * tileStepY;
          }

          if (!isCutoutPureWaterCell && !isCutoutStraddlingCell) {
            const isIdCell = (!waterCutout || canEmitIdPatch) && (gx >= startGx && gx <= endGx && gy === idGy);
            if (isExport && isIdCell) {
              const chars = (tileCols === 1 && tileRows === 1) ? ['1', '-', '1', ' ', '↑'] : ['R', String(tr + 1), 'C', String(tc + 1), '↑'];
              const debossDepth = Math.max(0.12, Math.min(0.40 / scaleMm, cellMinTopZ[gy * TERRAIN_RES_X + gx] - idFbase - 0.4));
              emitUndersideIdPatch(x0, y0, x1, y1, f00, f10, f11, f01, chars[gx - startGx], debossDepth, tileId, meshes.base);
            } else {
              const pf00 = [x0, y0, f00], pf10 = [x1, y0, f10], pf11 = [x1, y1, f11], pf01 = [x0, y1, f01];
              pushTri(meshes.base, pf00, pf01, pf11, computeFaceNormal(pf00, pf01, pf11), 1, -1, tileId);
              pushTri(meshes.base, pf00, pf11, pf10, computeFaceNormal(pf00, pf11, pf10), 1, -1, tileId);
            }
          }

          if (isExport || (tileCols * tileRows <= 400)) {
            if (gy === gy0) emitBoundaryWallForEdge(x0, y0, v00, f00, x1, y0, v10, f10, [0, -1, 0], tileId);
            if (gy === gy1 - 1) emitBoundaryWallForEdge(x1, y1, v11, f11, x0, y1, v01, f01, [0, 1, 0], tileId);
            if (gx === gx0) emitBoundaryWallForEdge(x0, y1, v01, f01, x0, y0, v00, f00, [-1, 0, 0], tileId);
            if (gx === gx1 - 1) emitBoundaryWallForEdge(x1, y0, v10, f10, x1, y1, v11, f11, [1, 0, 0], tileId);
          } else {
            // Extreme synthetic grids (>400 tiles, e.g. 50x100): skip internal kerf walls in live preview
            if (tr === 0 && gy === gy0) emitBoundaryWallForEdge(x0, y0, v00, f00, x1, y0, v10, f10, [0, -1, 0], tileId);
            if (tr === tileRows - 1 && gy === gy1 - 1) emitBoundaryWallForEdge(x1, y1, v11, f11, x0, y1, v01, f01, [0, 1, 0], tileId);
            if (tc === 0 && gx === gx0) emitBoundaryWallForEdge(x0, y1, v01, f01, x0, y0, v00, f00, [-1, 0, 0], tileId);
            if (tc === tileCols - 1 && gx === gx1 - 1) emitBoundaryWallForEdge(x1, y0, v10, f10, x1, y1, v11, f11, [1, 0, 0], tileId);
          }

          if (vMax < baseBottomZ) {
            if (waterCutout) {
              cellTerracePolys[gy * TERRAIN_RES_X + gx].push({ poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], zSurf: 0.0, tileId });
            } else {
              pushQuad(meshes.base, [x0, y0, zSubWater], [x1, y0, zSubWater], [x1, y1, zSubWater], [x0, y1, zSubWater], [0, 0, 1], 1, -1, tileId);
              emitFullWaterBasinCell(meshes, waterLevels, x0, y0, x1, y1, tileId);
              cellTerracePolys[gy * TERRAIN_RES_X + gx].push({ poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], zSurf: waterSurfZ, tileId });
            }
            continue;
          }

          const kMinRaw = getStepIdxForVal(vMin);
          const kMax = getStepIdxForVal(vMax);
          if (kMinRaw >= 0 && kMinRaw === kMax) {
            const tZ = thresholds[kMinRaw];
            pushQuad(meshes.base, [x0, y0, tZ], [x1, y0, tZ], [x1, y1, tZ], [x0, y1, tZ], [0, 0, 1], 1, -1, tileId);
            cellTerracePolys[gy * TERRAIN_RES_X + gx].push({ poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], zSurf: tZ, tileId });
            continue;
          }

          const c00 = { x: x0, y: y0, v: v00, isCut: false };
          const c10 = { x: x1, y: y0, v: v10, isCut: false };
          const c11 = { x: x1, y: y1, v: v11, isCut: false };
          const c01 = { x: x0, y: y1, v: v01, isCut: false };
          const cellTris = [[c00, c10, c11], [c00, c11, c01]];

          const gradX = (v10 - v00) + (v11 - v01);
          const gradY = (v01 - v00) + (v11 - v10);
          const gLen = Math.hypot(gradX, gradY) || 1;
          const riserNorm = [-gradX / gLen, -gradY / gLen, 0];

          for (let ct = 0; ct < 2; ct++) {
            const cellTri = cellTris[ct];
            const tvMin = Math.min(cellTri[0].v, cellTri[1].v, cellTri[2].v);
            const tvMax = Math.max(cellTri[0].v, cellTri[1].v, cellTri[2].v);

            if (tvMin < baseBottomZ) {
              if (waterCutout) {
                const subWet = clipCellPolyByScalar(cellTri, baseBottomZ, false);
                if (subWet.poly.length >= 3) {
                  cellTerracePolys[gy * TERRAIN_RES_X + gx].push({
                    poly: subWet.poly.map(pt => [pt.x, pt.y]),
                    zSurf: 0.0,
                    tileId
                  });
                }
              } else {
                emitSubWaterBasinCell(ctx, meshes, waterLevels, cellTri, riserNorm, tileId, cellTerracePolys[gy * TERRAIN_RES_X + gx]);
              }
            }

            if (tvMax < baseBottomZ) continue;

            if (waterCutout && isCutoutStraddlingCell) {
              const dryBottomCap = clipCellPolyByScalar(cellTri, baseBottomZ, true);
              if (dryBottomCap.poly.length >= 3) {
                const b0 = dryBottomCap.poly[0];
                for (let ti = 1; ti < dryBottomCap.poly.length - 1; ti++) {
                  const b1 = dryBottomCap.poly[ti], b2 = dryBottomCap.poly[ti + 1];
                  const ux = b2.x - b0.x, uy = b2.y - b0.y, vx = b1.x - b0.x, vy = b1.y - b0.y;
                  if (Math.abs(ux * vy - uy * vx) > 1e-12) {
                    pushTri(meshes.base, [b0.x, b0.y, 0.0], [b2.x, b2.y, 0.0], [b1.x, b1.y, 0.0], [0, 0, -1], 1, -1, tileId);
                  }
                }
              }
            }

            const tkStart = Math.max(0, getStepIdxForVal(tvMin));
            const tkMax = ctx.isTopographicRelief ? getStepIdxForVal(tvMax) : 0;

            for (let k = tkStart; k <= tkMax; k++) {
              const tLow = thresholds[k];
              const tHigh = (!ctx.isTopographicRelief || k === numContourSteps) ? Infinity : thresholds[k + 1];
              if (tvMax < tLow) break;

              const aboveLow = clipCellPolyByScalar(cellTri, tLow, true);
              if (aboveLow.poly.length < 3) continue;

              for (const [cA, cB] of aboveLow.cuts) {
                const lowerZ = (k === 0) ? (waterCutout ? 0.0 : zSubWater) : thresholds[k - 1];
                pushQuad(meshes.base, [cA.x, cA.y, lowerZ], [cB.x, cB.y, lowerZ], [cB.x, cB.y, tLow], [cA.x, cA.y, tLow], riserNorm, 1, -1, tileId);
              }

              const bandPoly = (tHigh === Infinity) ? aboveLow.poly : clipCellPolyByScalar(aboveLow.poly, tHigh, false).poly;
              if (bandPoly.length >= 3) {
                const p0 = bandPoly[0];
                for (let ti = 1; ti < bandPoly.length - 1; ti++) {
                  const p1 = bandPoly[ti], p2 = bandPoly[ti + 1];
                  pushTri(meshes.base, [p0.x, p0.y, tLow], [p1.x, p1.y, tLow], [p2.x, p2.y, tLow], [0, 0, 1], 1, -1, tileId);
                }
                cellTerracePolys[gy * TERRAIN_RES_X + gx].push({ poly: bandPoly.map(pt => [pt.x, pt.y]), zSurf: tLow, tileId });
              }
            }
          }
        }
      }
    }
  }

  function getActualPrintedSurfaceMinZ(bx, by) {
    const u = Math.min(TERRAIN_RES_X - 1e-6, Math.max(0, ((bx + halfW) / (2 * halfW)) * TERRAIN_RES_X));
    const v = Math.min(TERRAIN_RES_Y - 1e-6, Math.max(0, ((by + halfH) / (2 * halfH)) * TERRAIN_RES_Y));
    const gx = Math.min(TERRAIN_RES_X - 1, Math.floor(u));
    const gy = Math.min(TERRAIN_RES_Y - 1, Math.floor(v));
    const tList = cellTerracePolys[gy * TERRAIN_RES_X + gx];
    if (tList && tList.length > 0) {
      if (tList.length === 1) return tList[0].zSurf;
      for (let i = 0; i < tList.length; i++) {
        if (tList[i].zSurf < baseBottomZ - 1e-4 && pointInPolyOrNear2D(bx, by, tList[i].poly, 0.015)) {
          return tList[i].zSurf;
        }
      }
      for (let i = 0; i < tList.length; i++) {
        if (pointInPolyOrNear2D(bx, by, tList[i].poly, 1e-4)) return tList[i].zSurf;
      }
      let minZ = Infinity;
      for (let i = 0; i < tList.length; i++) {
        if (tList[i].zSurf < minZ) minZ = tList[i].zSurf;
      }
      return minZ;
    }
    const wetZ = waterCutout ? 0.0 : waterSurfZ;
    if (waterMask[sampleMaskIdx(bx, by)]) return wetZ;
    const k = getStepIdxForVal(sampleRawTerrainGridZ(bx, by));
    return (k < 0) ? wetZ : thresholds[k];
  }

  return { cellTerracePolys, waterSurfZ, vaultSavedSceneVol, getActualPrintedSurfaceMinZ };
}

function emitStudioWallFrame(ctx, meshes) {
  const { halfW, halfH } = ctx;
  const innerW = halfW + 0.25, innerH = halfH + 0.25;
  const outerW = halfW + 9.9, outerH = halfH + 9.9;
  const scaleMm = ctx.scaleMm || 1.0;
  const zFrameBot = -1.6 / scaleMm;
  const zFrameTop = (ctx.baseBottomZ || (2.35 / scaleMm)) + 1.1 / scaleMm;
  const miterQuads = [
    [[-outerW, -outerH], [outerW, -outerH], [innerW, -innerH], [-innerW, -innerH]],
    [[outerW, -outerH], [outerW, outerH], [innerW, innerH], [innerW, -innerH]],
    [[outerW, outerH], [-outerW, outerH], [-innerW, innerH], [innerW, innerH]],
    [[-outerW, outerH], [-outerW, -outerH], [-innerW, -innerH], [-innerW, innerH]]
  ];
  miterQuads.forEach(mq => {
    extrudeBuildingLoD2(mq, [], zFrameBot, zFrameTop, zFrameTop, false, 6, -1, meshes.frame, -1, 'flat');
  });
}

function emitBaseReliefChimneyShafts(ctx, chimneys, meshes) {
  if (!chimneys || chimneys.length === 0 || !meshes || !meshes.base) return;
  const defZBase = (ctx && ctx.baseBottomZ) || 2.35 / ((ctx && ctx.scaleMm) || 1.0);

  for (let ci = 0; ci < chimneys.length; ci++) {
    const c = chimneys[ci];
    const chimCW = c.chimneyCW || c.chimneyPoly || c;
    const zBase = typeof c.zBase === 'number' ? c.zBase : defZBase;
    const tileId = typeof c.tileId === 'number' ? c.tileId : 0;

    if (!chimCW || chimCW.length < 3 || zBase <= 1e-4) continue;

    for (let i = 0; i < chimCW.length; i++) {
      const p1 = chimCW[i], p2 = chimCW[(i + 1) % chimCW.length];
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
      const len = Math.hypot(dx, dy) || 1e-6;
      pushQuad(
        meshes.base,
        [p1[0], p1[1], zBase],
        [p2[0], p2[1], zBase],
        [p2[0], p2[1], 0.0],
        [p1[0], p1[1], 0.0],
        [dy / len, -dx / len, 0],
        1,
        -1,
        tileId
      );
    }
  }
}

if (typeof window !== 'undefined') {
  window.emitBaseReliefChimneyShafts = emitBaseReliefChimneyShafts;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildTerrainBaseAndWaterMeshes, emitStudioWallFrame, emitBaseReliefChimneyShafts };
}
