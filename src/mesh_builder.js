// ============================================================================
// src/mesh_builder.js
// Core 3D Map & SLA Hollow Vault Builder (DEM Terraces, Bathymetry, Disjoint
// Feature Slabs, Riparian Greenery, Bridges/Piers, Buildings & Studio Frame)
// ============================================================================

function buildComplete3DModel(scene, state) {
  const meshes = {
    water: [],
    base: [],
    greenery: [],
    roads: [],
    buildings: [],
    highlighted: [],
    frame: []
  };
  const buildingBounds = [];

  if (!scene) return { meshes, buildingBounds, totalTriangles: 0 };

  // Fix U1/B04: If the scene was already fetched for a given cropRatio, only apply relative sub-cropping
  const baseCrop = scene._fetchedCropRatio || 1.0;
  const effectiveCrop = Math.min(1.0, Math.max(0.35, (state.cropRatio || 0.88) / baseCrop));
  const halfSpan = effectiveCrop * 85.0;
  const cropCX = (state.cropCenterX || 0) * 85.0;
  const cropCY = (state.cropCenterY || 0) * 85.0;
  const scaleToBed = 85.0 / halfSpan;

  function toBed(pt) {
    return [(pt[0] - cropCX) * scaleToBed, (pt[1] - cropCY) * scaleToBed];
  }

  // --------------------------------------------------------------------------
  // STEP 1: HIGH-RES 320x320 RASTER MASKS (WATER, GREEN, OCCUPIED)
  // --------------------------------------------------------------------------
  const MASK_RES = 320;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = MASK_RES;
  maskCanvas.height = MASK_RES;
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });

  function bedToMask(bx, by) {
    return [((bx + 85.0) / 170.0) * MASK_RES, ((85.0 - by) / 170.0) * MASK_RES];
  }
  function sampleMaskIdx(bx, by) {
    const mx = Math.min(MASK_RES - 1, Math.max(0, Math.floor(((bx + 85.0) / 170.0) * MASK_RES)));
    const my = Math.min(MASK_RES - 1, Math.max(0, Math.floor(((85.0 - by) / 170.0) * MASK_RES)));
    return my * MASK_RES + mx;
  }

  // 1A. Water Mask
  mctx.clearRect(0, 0, MASK_RES, MASK_RES);
  mctx.fillStyle = '#ffffff';
  mctx.strokeStyle = '#ffffff';
  mctx.lineCap = 'round';
  mctx.lineJoin = 'round';

  (scene.waterPolys || []).forEach(wp => {
    mctx.beginPath();
    wp.outer.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.closePath();
    (wp.holes || []).forEach(h => {
      h.forEach((p, i) => {
        const b = toBed(p);
        const [px, py] = bedToMask(b[0], b[1]);
        if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
      });
      mctx.closePath();
    });
    mctx.fill('evenodd');
  });

  // Fix B11: Realistic waterway width (no artificial 100 m widening)
  (scene.waterLines || []).forEach(wl => {
    const effW = Math.min(5.2, Math.max(1.1, wl.width || 2.0));
    mctx.lineWidth = Math.max(1.8, effW * scaleToBed * (MASK_RES / 170.0));
    mctx.beginPath();
    wl.pts.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.stroke();
  });

  const waterImg = mctx.getImageData(0, 0, MASK_RES, MASK_RES).data;
  const waterMask = new Uint8Array(MASK_RES * MASK_RES);
  for (let i = 0; i < MASK_RES * MASK_RES; i++) {
    waterMask[i] = waterImg[i * 4 + 3] > 90 ? 1 : 0;
  }

  const waterDepth = new Float32Array(MASK_RES * MASK_RES);
  const shoreDist = new Float32Array(MASK_RES * MASK_RES);
  for (let i = 0; i < MASK_RES * MASK_RES; i++) {
    waterDepth[i] = waterMask[i] ? 9999 : 0;
    shoreDist[i] = waterMask[i] ? 0 : 9999;
  }
  for (let y = 1; y < MASK_RES - 1; y++) {
    for (let x = 1; x < MASK_RES - 1; x++) {
      const idx = y * MASK_RES + x;
      if (waterDepth[idx] > 0) {
        waterDepth[idx] = Math.min(waterDepth[idx], waterDepth[idx - 1] + 1, waterDepth[idx - MASK_RES] + 1);
      }
      if (shoreDist[idx] > 0) {
        shoreDist[idx] = Math.min(shoreDist[idx], shoreDist[idx - 1] + 1, shoreDist[idx - MASK_RES] + 1);
      }
    }
  }
  for (let y = MASK_RES - 2; y >= 1; y--) {
    for (let x = MASK_RES - 2; x >= 1; x--) {
      const idx = y * MASK_RES + x;
      if (waterDepth[idx] > 0) {
        waterDepth[idx] = Math.min(waterDepth[idx], waterDepth[idx + 1] + 1, waterDepth[idx + MASK_RES] + 1);
      }
      if (shoreDist[idx] > 0) {
        shoreDist[idx] = Math.min(shoreDist[idx], shoreDist[idx + 1] + 1, shoreDist[idx + MASK_RES] + 1);
      }
    }
  }

  // 1B. Greenery Mask (Fix R1: read greenPolys || greeneryPolys, fill('evenodd') for holes, + riparian bank belt)
  mctx.clearRect(0, 0, MASK_RES, MASK_RES);
  (scene.greenPolys || scene.greeneryPolys || []).forEach(gp => {
    mctx.beginPath();
    gp.outer.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.closePath();
    (gp.holes || []).forEach(h => {
      h.forEach((p, i) => {
        const b = toBed(p);
        const [px, py] = bedToMask(b[0], b[1]);
        if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
      });
      mctx.closePath();
    });
    mctx.fill('evenodd');
  });
  const greenImg = mctx.getImageData(0, 0, MASK_RES, MASK_RES).data;

  // 1C. Separate Road Mask, Bridge/Pier Mask & Building Mask
  mctx.clearRect(0, 0, MASK_RES, MASK_RES);
  (scene.roads || []).forEach(rd => {
    if (rd.bridge) return;
    mctx.lineWidth = Math.max(2.2, rd.width * scaleToBed * (MASK_RES / 170.0) * 1.12);
    mctx.beginPath();
    rd.pts.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.stroke();
  });
  const roadImg = mctx.getImageData(0, 0, MASK_RES, MASK_RES).data;
  const roadMask = new Uint8Array(MASK_RES * MASK_RES);
  for (let i = 0; i < MASK_RES * MASK_RES; i++) {
    roadMask[i] = (roadImg[i * 4 + 3] > 90 && !waterMask[i]) ? 1 : 0;
  }

  mctx.clearRect(0, 0, MASK_RES, MASK_RES);
  (scene.roads || []).forEach(rd => {
    if (!rd.bridge) return;
    mctx.lineWidth = Math.max(2.4, rd.width * scaleToBed * (MASK_RES / 170.0) * 1.18);
    mctx.beginPath();
    rd.pts.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.stroke();
  });
  (scene.buildings || []).forEach(b => {
    if (b.hidden || b.btype !== 'pier') return;
    mctx.beginPath();
    b.outer.forEach((p, i) => {
      const bp = toBed(p);
      const [px, py] = bedToMask(bp[0], bp[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.closePath();
    mctx.fill();
  });
  const bridgeImg = mctx.getImageData(0, 0, MASK_RES, MASK_RES).data;
  const bridgeMask = new Uint8Array(MASK_RES * MASK_RES);
  for (let i = 0; i < MASK_RES * MASK_RES; i++) {
    bridgeMask[i] = bridgeImg[i * 4 + 3] > 90 ? 1 : 0;
  }

  mctx.clearRect(0, 0, MASK_RES, MASK_RES);
  mctx.lineWidth = 4.2;
  (scene.buildings || []).forEach(b => {
    if (b.hidden || b.btype === 'pier') return;
    mctx.beginPath();
    b.outer.forEach((p, i) => {
      const bp = toBed(p);
      const [px, py] = bedToMask(bp[0], bp[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.closePath();
    mctx.fill();
    mctx.stroke();
  });
  const bldImg = mctx.getImageData(0, 0, MASK_RES, MASK_RES).data;
  const bldMask = new Uint8Array(MASK_RES * MASK_RES);
  const roadAndBldMask = new Uint8Array(MASK_RES * MASK_RES);
  const greenMask = new Uint8Array(MASK_RES * MASK_RES);
  for (let i = 0; i < MASK_RES * MASK_RES; i++) {
    bldMask[i] = bldImg[i * 4 + 3] > 60 ? 1 : 0;
    if (bldMask[i]) {
      roadMask[i] = 0;
      bridgeMask[i] = 0;
    }
    roadAndBldMask[i] = (roadMask[i] || bridgeMask[i] || bldMask[i]) ? 1 : 0;
    const isRiparian = (!waterMask[i] && shoreDist[i] > 0 && shoreDist[i] <= 10.5 && !roadAndBldMask[i]);
    greenMask[i] = ((greenImg[i * 4 + 3] > 90 || isRiparian) && !waterMask[i] && !roadMask[i] && !bridgeMask[i] && !bldMask[i]) ? 1 : 0;
  }

  // --------------------------------------------------------------------------
  // STEP 2: REAL DEM INTERPOLATION, DENOISING & LAYER QUANTIZATION
  // --------------------------------------------------------------------------
  const demObj = scene.dem || { gridSize: 2, minElev: 0, maxElev: 10, grid: [[0, 0], [0, 0]] };
  const demN = demObj.gridSize;
  const demRaw = demObj.grid;
  const minElev = demObj.minElev;
  const maxElev = Math.max(minElev + 6.0, demObj.maxElev);

  function sampleRawDemMeters(bx, by) {
    const ox = bx / scaleToBed + cropCX;
    const oy = by / scaleToBed + cropCY;
    const u = Math.min(1, Math.max(0, (ox + 85.0) / 170.0)) * (demN - 1);
    const v = Math.min(1, Math.max(0, (oy + 85.0) / 170.0)) * (demN - 1);
    const i0 = Math.floor(u), i1 = Math.min(demN - 1, i0 + 1);
    const j0 = Math.floor(v), j1 = Math.min(demN - 1, j0 + 1);
    const fu = u - i0, fv = v - j0;
    const z00 = demRaw[j0][i0], z10 = demRaw[j0][i1];
    const z01 = demRaw[j1][i0], z11 = demRaw[j1][i1];
    return (z00 * (1 - fu) + z10 * fu) * (1 - fv) + (z01 * (1 - fu) + z11 * fu) * fv;
  }

  const TERRAIN_RES = 72; // Divisible by 1, 2, 3, 4 for exact multi-tile splits
  const strideT = TERRAIN_RES + 1;
  let demGrid = new Float32Array(strideT * strideT);

  for (let gy = 0; gy <= TERRAIN_RES; gy++) {
    const by = -84.6 + (gy / TERRAIN_RES) * 169.2;
    for (let gx = 0; gx <= TERRAIN_RES; gx++) {
      const bx = -84.6 + (gx / TERRAIN_RES) * 169.2;
      demGrid[gy * strideT + gx] = Math.max(0, sampleRawDemMeters(bx, by) - minElev);
    }
  }

  for (let pass = 0; pass < 3; pass++) {
    const next = new Float32Array(strideT * strideT);
    for (let gy = 0; gy <= TERRAIN_RES; gy++) {
      for (let gx = 0; gx <= TERRAIN_RES; gx++) {
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = Math.min(TERRAIN_RES, Math.max(0, gy + dy));
            const nx = Math.min(TERRAIN_RES, Math.max(0, gx + dx));
            const w = (dx === 0 && dy === 0) ? 4 : (dx === 0 || dy === 0) ? 2 : 1;
            sum += demGrid[ny * strideT + nx] * w;
            cnt += w;
          }
        }
        next[gy * strideT + gx] = sum / cnt;
      }
    }
    demGrid = next;
  }

  const totalWidthMm = state.bedSizeMm || 320;
  const mmPerUnit = totalWidthMm / 169.2;
  const hollowBase = !!state.hollowBase;
  // Fix R11: layerHeightMm comes strictly from printer profile (0.05 mm SLA, 0.20 mm FDM), not hollowBase!
  const layerHeightMm = state.layerHeightMm || (state.isResin ? 0.05 : 0.20);
  const quantizeZUnits = (uVal) => {
    const mm = uVal * mmPerUnit;
    const qMm = Math.max(layerHeightMm, Math.round(mm / layerHeightMm) * layerHeightMm);
    return qMm / mmPerUnit;
  };

  const baseBottomZ = quantizeZUnits(2.45);
  const realElevDelta = Math.max(6.0, maxElev - minElev);
  const adaptiveReliefBase = realElevDelta > 45.0
    ? Math.min(13.2, 7.4 + Math.log10(1.0 + (realElevDelta - 45.0) / 40.0) * 4.6)
    : 7.4;
  const maxReliefMm = adaptiveReliefBase * (state.terrainScale || 1.0);
  const elevSpan = Math.max(20.0, realElevDelta);
  const numContourSteps = 18;
  const stepMm = quantizeZUnits(maxReliefMm / numContourSteps);

  let zGrid = new Float32Array(strideT * strideT);
  for (let gy = 0; gy <= TERRAIN_RES; gy++) {
    const by = -84.6 + (gy / TERRAIN_RES) * 169.2;
    for (let gx = 0; gx <= TERRAIN_RES; gx++) {
      const bx = -84.6 + (gx / TERRAIN_RES) * 169.2;
      const mIdx = sampleMaskIdx(bx, by);
      const relE = demGrid[gy * strideT + gx];
      if (waterMask[mIdx]) {
        zGrid[gy * strideT + gx] = baseBottomZ - 0.14 - Math.min(0.85, waterDepth[mIdx] * 0.045);
      } else {
        const bankBlend = Math.min(1.0, shoreDist[mIdx] / 6.0);
        const hMm = (relE / elevSpan) * maxReliefMm * bankBlend;
        zGrid[gy * strideT + gx] = baseBottomZ + 0.20 + hMm;
      }
    }
  }

  {
    const nextZ = new Float32Array(zGrid.length);
    for (let gy = 0; gy <= TERRAIN_RES; gy++) {
      for (let gx = 0; gx <= TERRAIN_RES; gx++) {
        let sum = zGrid[gy * strideT + gx] * 4.0, w = 4.0;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dx, dy] of dirs) {
          const nx = gx + dx, ny = gy + dy;
          if (nx >= 0 && nx <= TERRAIN_RES && ny >= 0 && ny <= TERRAIN_RES) {
            sum += zGrid[ny * strideT + nx];
            w += 1.0;
          }
        }
        nextZ[gy * strideT + gx] = sum / w;
      }
    }
    zGrid = nextZ;
  }

  // Multi-Tile Grid Configuration (e.g., 1x1, 1x2, 2x2, 2x3, 2x4 for Anycubic Photon Mono 4)
  const tileCols = Math.max(1, Math.min(4, state.tileCols || 1));
  const tileRows = Math.max(1, Math.min(4, state.tileRows || 1));
  const cellsPerCol = Math.floor(TERRAIN_RES / tileCols);
  const cellsPerRow = Math.floor(TERRAIN_RES / tileRows);
  const cellStep = 169.2 / TERRAIN_RES;
  const deepWaterZ = quantizeZUnits(1.76);
  const zSubWater = quantizeZUnits(1.36);
  const zDrainVault = quantizeZUnits(0.72);
  const gHeight = Math.max(layerHeightMm / mmPerUnit, quantizeZUnits(0.28));
  const rHeight = Math.max(layerHeightMm / mmPerUnit, quantizeZUnits(0.36));
  const brHeight = Math.max(layerHeightMm / mmPerUnit, quantizeZUnits(0.56));
  const hollowWallUnits = Math.max(0.55, Math.min(1.15, (state.hollowWallMm || 1.8) / Math.max(1.05, mmPerUnit)));
  let vaultSavedSceneVol = 0;

  const thresholds = [];
  for (let k = 0; k <= numContourSteps + 2; k++) {
    thresholds.push(baseBottomZ + k * stepMm);
  }
  const epsSep = 6e-5;
  const zWaterBot = zSubWater + epsSep;

  // Ensure buildings with courtyards sit on a uniform flat land terrace so 100% of courtyard buildings remain single intact extrusions
  for (let pass = 0; pass < 2; pass++) {
    (scene.buildings || []).forEach(b => {
      if (b.hidden || b.btype === 'pier' || !b.holes || b.holes.length === 0) return;
      const clipped = clipPolyToBox(b.outer.map(toBed), -84.2, -84.2, 84.2, 84.2);
      if (clipped.length < 3) return;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < clipped.length; i++) {
        const p = clipped[i];
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      }
      const gxMin = Math.max(0, Math.floor(((minX + 84.6) / 169.2) * TERRAIN_RES));
      const gxMax = Math.min(TERRAIN_RES - 1, Math.floor(((maxX + 84.6) / 169.2) * TERRAIN_RES));
      const gyMin = Math.max(0, Math.floor(((minY + 84.6) / 169.2) * TERRAIN_RES));
      const gyMax = Math.min(TERRAIN_RES - 1, Math.floor(((maxY + 84.6) / 169.2) * TERRAIN_RES));
      let maxZVal = baseBottomZ + 0.25;
      for (let gy = gyMin; gy <= gyMax + 1; gy++) {
        for (let gx = gxMin; gx <= gxMax + 1; gx++) {
          const v = zGrid[gy * strideT + gx];
          if (v > maxZVal) maxZVal = v;
        }
      }
      for (let gy = gyMin; gy <= gyMax + 1; gy++) {
        for (let gx = gxMin; gx <= gxMax + 1; gx++) {
          zGrid[gy * strideT + gx] = maxZVal;
        }
      }
    });
  }

  // Simulation of Simplicity (Edelsbrunner & Mücke): perturb any grid vertex that lands within 1e-3 of a threshold
  for (let i = 0; i < zGrid.length; i++) {
    for (let k = 0; k <= numContourSteps + 2; k++) {
      if (Math.abs(zGrid[i] - thresholds[k]) < 1e-3) {
        zGrid[i] += 1.2e-3;
      }
    }
  }

  function getStepIdxForVal(zVal) {
    if (zVal < thresholds[0]) return -1;
    for (let k = numContourSteps; k >= 0; k--) {
      if (zVal >= thresholds[k]) return k;
    }
    return 0;
  }

  function getQuantizedTerrainZ(bx, by) {
    const u = Math.min(TERRAIN_RES - 1e-6, Math.max(0, ((bx + 84.6) / 169.2) * TERRAIN_RES));
    const v = Math.min(TERRAIN_RES - 1e-6, Math.max(0, ((by + 84.6) / 169.2) * TERRAIN_RES));
    const gx = Math.min(TERRAIN_RES - 1, Math.floor(u));
    const gy = Math.min(TERRAIN_RES - 1, Math.floor(v));
    const v00 = zGrid[gy * strideT + gx];
    const v10 = zGrid[gy * strideT + (gx + 1)];
    const v11 = zGrid[(gy + 1) * strideT + (gx + 1)];
    const v01 = zGrid[(gy + 1) * strideT + gx];
    const zVal = Math.max(v00, v10, v11, v01);
    const stepIdx = getStepIdxForVal(zVal);
    if (stepIdx < 0) return baseBottomZ;
    return thresholds[stepIdx];
  }

  // Fix R3 & R8: Returns the true minimum printed surface height in cell (gx, gy), including deepWaterZ over water!
  function getActualPrintedSurfaceMinZAtCell(gx, gy) {
    const cx = Math.min(TERRAIN_RES - 1, Math.max(0, gx));
    const cy = Math.min(TERRAIN_RES - 1, Math.max(0, gy));
    const v00 = zGrid[cy * strideT + cx];
    const v10 = zGrid[cy * strideT + (cx + 1)];
    const v11 = zGrid[(cy + 1) * strideT + (cx + 1)];
    const v01 = zGrid[(cy + 1) * strideT + cx];
    const vMin = Math.min(v00, v10, v11, v01);
    const stepIdx = getStepIdxForVal(vMin);
    if (stepIdx < 0) {
      return (state.layerVisible && state.layerVisible.water === false) ? zSubWater : deepWaterZ;
    }
    return thresholds[stepIdx];
  }

  function getActualPrintedSurfaceMinZ(bx, by) {
    const u = Math.min(TERRAIN_RES - 1e-6, Math.max(0, ((bx + 84.6) / 169.2) * TERRAIN_RES));
    const v = Math.min(TERRAIN_RES - 1e-6, Math.max(0, ((by + 84.6) / 169.2) * TERRAIN_RES));
    const gx = Math.min(TERRAIN_RES - 1, Math.floor(u));
    const gy = Math.min(TERRAIN_RES - 1, Math.floor(v));
    let minZ = getActualPrintedSurfaceMinZAtCell(gx, gy);
    if (waterMask[sampleMaskIdx(bx, by)]) {
      const wZ = (state.layerVisible && state.layerVisible.water === false) ? zSubWater : deepWaterZ;
      if (wZ < minZ) minZ = wZ;
    }
    return minZ;
  }

  function getTileColRowForXY(bx, by) {
    const tc = Math.max(0, Math.min(tileCols - 1, Math.floor(((bx + 84.6) / 169.2) * tileCols)));
    const tr = Math.max(0, Math.min(tileRows - 1, Math.floor(((by + 84.6) / 169.2) * tileRows)));
    return [tc, tr, tr * tileCols + tc];
  }

  const cellMinTopZ = new Float32Array(TERRAIN_RES * TERRAIN_RES);
  for (let gy = 0; gy < TERRAIN_RES; gy++) {
    for (let gx = 0; gx < TERRAIN_RES; gx++) {
      const v00 = zGrid[gy * strideT + gx];
      const v10 = zGrid[gy * strideT + (gx + 1)];
      const v11 = zGrid[(gy + 1) * strideT + (gx + 1)];
      const v01 = zGrid[(gy + 1) * strideT + gx];
      const vMin = Math.min(v00, v10, v11, v01);
      const kMin = getStepIdxForVal(vMin);
      cellMinTopZ[gy * TERRAIN_RES + gx] = (kMin < 0) ? zSubWater : thresholds[kMin];
    }
  }

  // Helper to emit a 100% watertight 1D staircase wall along an outer tile boundary cell edge (pA -> pB)
  function emitBoundaryStaircaseWall(ax, ay, vA, fA, bx, by, vB, fB, norm, tileId) {
    const getBandTopZ = (val) => {
      const k = getStepIdxForVal(val);
      return (k < 0) ? zSubWater : thresholds[k];
    };

    const cuts = [];
    const vLo = Math.min(vA, vB), vHi = Math.max(vA, vB);
    for (let k = 0; k <= numContourSteps; k++) {
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
      const nextZ = (vB > vA)
        ? c.thr
        : (c.k === 0 ? zSubWater : thresholds[c.k - 1]);
      chain.push([c.x, c.y, nextZ]);
      currZ = nextZ;
    }
    chain.push([bx, by, currZ]);

    const AFloor = [ax, ay, fA];
    const BFloor = [bx, by, fB];
    const lastTop = chain[chain.length - 1];

    for (let i = 0; i < chain.length - 1; i++) {
      const P0 = chain[i], P1 = chain[i + 1];
      if (Math.hypot(P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]) > 1e-6) {
        pushTri(meshes.base, AFloor, P1, P0, norm, 1, -1, tileId);
      }
    }
    pushTri(meshes.base, AFloor, BFloor, lastTop, norm, 1, -1, tileId);
  }

  // Helper to emit outer tile boundary wall for the water basin (v <= baseBottomZ)
  function emitWaterBoundaryWall(ax, ay, vA, bx, by, vB, norm, tileId) {
    if (vA >= baseBottomZ && vB >= baseBottomZ) return;
    const pA = { x: ax, y: ay, v: vA };
    const pB = { x: bx, y: by, v: vB };
    if (vA < baseBottomZ && vB < baseBottomZ) {
      pushQuad(meshes.water, [ax, ay, zWaterBot], [bx, by, zWaterBot], [bx, by, deepWaterZ], [ax, ay, deepWaterZ], norm, 0, -1, tileId);
    } else if (vA < baseBottomZ) {
      const cut = interpCellEdgeCanonical(pA, pB, baseBottomZ);
      pushQuad(meshes.water, [ax, ay, zWaterBot], [cut.x, cut.y, zWaterBot], [cut.x, cut.y, deepWaterZ], [ax, ay, deepWaterZ], norm, 0, -1, tileId);
    } else {
      const cut = interpCellEdgeCanonical(pA, pB, baseBottomZ);
      pushQuad(meshes.water, [cut.x, cut.y, zWaterBot], [bx, by, zWaterBot], [bx, by, deepWaterZ], [cut.x, cut.y, deepWaterZ], norm, 0, -1, tileId);
    }
  }

  // Helper to emit a closed prism slab (for greenery turf or road/bridge segments) sitting flush at zBot -> zTop
  function emitClosedSlab2D(poly2d, zBot, zTop, layerId, outTris, tileId) {
    const inset = insetPolygonCentroid(poly2d, 0.008);
    if (inset.length < 3 || Math.abs(signedArea2D(inset)) < 1e-3) return;
    if (signedArea2D(inset) < 0) inset.reverse();
    const p0 = inset[0];
    for (let ti = 1; ti < inset.length - 1; ti++) {
      const p1 = inset[ti], p2 = inset[ti + 1];
      pushTri(outTris, [p0[0], p0[1], zTop], [p1[0], p1[1], zTop], [p2[0], p2[1], zTop], [0, 0, 1], layerId, -1, tileId);
      pushTri(outTris, [p0[0], p0[1], zBot], [p2[0], p2[1], zBot], [p1[0], p1[1], zBot], [0, 0, -1], layerId, -1, tileId);
    }
    for (let i = 0; i < inset.length; i++) {
      const a = inset[i], b = inset[(i + 1) % inset.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len > 1e-5) {
        pushQuad(outTris, [a[0], a[1], zBot], [b[0], b[1], zBot], [b[0], b[1], zTop], [a[0], a[1], zTop], [dy / len, -dx / len, 0], layerId, -1, tileId);
      }
    }
  }

  function getCellSubTypes(x0, y0, x1, y1) {
    const mx = (x0 + x1) * 0.5, my = (y0 + y1) * 0.5;
    const subBoxes = [
      [x0, y0, mx, my],
      [mx, y0, x1, my],
      [x0, my, mx, y1],
      [mx, my, x1, y1]
    ];
    const subTypes = [0, 0, 0, 0]; // 0 = empty, 1 = road, 2 = green
    let rdCount = 0, grCount = 0;
    for (let s = 0; s < 4; s++) {
      const [sx0, sy0, sx1, sy1] = subBoxes[s];
      const mIdx = sampleMaskIdx((sx0 + sx1) * 0.5, (sy0 + sy1) * 0.5);
      const hasBld =
        bldMask[mIdx] === 1 ||
        bldMask[sampleMaskIdx(sx0, sy0)] === 1 ||
        bldMask[sampleMaskIdx(sx1, sy0)] === 1 ||
        bldMask[sampleMaskIdx(sx0, sy1)] === 1 ||
        bldMask[sampleMaskIdx(sx1, sy1)] === 1;
      const isRd = !hasBld && (roadMask[mIdx] === 1 || bridgeMask[mIdx] === 1);
      const isGr = !hasBld && !isRd && greenMask[mIdx] === 1;
      if (isRd) { subTypes[s] = 1; rdCount++; }
      else if (isGr) { subTypes[s] = 2; grCount++; }
    }
    return { subBoxes, subTypes, rdCount, grCount };
  }

  function emitCellFeatureSlabs(polyXY, x0, y0, x1, y1, tZ, tileId) {
    const { subBoxes, subTypes, rdCount, grCount } = getCellSubTypes(x0, y0, x1, y1);
    const zBot = tZ + epsSep;
    if (rdCount === 4) {
      const fullPoly = polyXY || [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      emitClosedSlab2D(fullPoly, zBot, tZ + rHeight, 3, meshes.roads, tileId);
      return;
    }
    if (grCount === 4) {
      const fullPoly = polyXY || [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      emitClosedSlab2D(fullPoly, zBot, tZ + gHeight, 2, meshes.greenery, tileId);
      return;
    }
    for (let s = 0; s < 4; s++) {
      if (subTypes[s] === 0) continue;
      const [sx0, sy0, sx1, sy1] = subBoxes[s];
      const clipped = polyXY ? clipPolyToBox(polyXY, sx0, sy0, sx1, sy1) : [[sx0, sy0], [sx1, sy0], [sx1, sy1], [sx0, sy1]];
      if (clipped.length < 3) continue;
      if (subTypes[s] === 1) {
        emitClosedSlab2D(clipped, zBot, tZ + rHeight, 3, meshes.roads, tileId);
      } else {
        emitClosedSlab2D(clipped, zBot, tZ + gHeight, 2, meshes.greenery, tileId);
      }
    }
  }

  // --------------------------------------------------------------------------
  // STEP 3: PER-TILE WATERTIGHT WATER, STEPPED DEM BASE, GREENERY & ROADS
  // --------------------------------------------------------------------------
  const cellTerracePolys = Array.from({ length: TERRAIN_RES * TERRAIN_RES }, () => []);
  const waterSurfZ = (state.layerVisible && state.layerVisible.water === false) ? zSubWater : deepWaterZ;
  for (let tr = 0; tr < tileRows; tr++) {
    const gy0 = tr * cellsPerRow;
    const gy1 = (tr === tileRows - 1) ? TERRAIN_RES : (tr + 1) * cellsPerRow;
    const tileY0 = -84.6 + gy0 * cellStep + (tr > 0 ? 0.002 : 0);
    const tileY1 = -84.6 + gy1 * cellStep - (tr < tileRows - 1 ? 0.002 : 0);
    const tileStepY = (tileY1 - tileY0) / (gy1 - gy0);

    for (let tc = 0; tc < tileCols; tc++) {
      const gx0 = tc * cellsPerCol;
      const gx1 = (tc === tileCols - 1) ? TERRAIN_RES : (tc + 1) * cellsPerCol;
      const tileX0 = -84.6 + gx0 * cellStep + (tc > 0 ? 0.002 : 0);
      const tileX1 = -84.6 + gx1 * cellStep - (tc < tileCols - 1 ? 0.002 : 0);
      const tileStepX = (tileX1 - tileX0) / (gx1 - gx0);
      const tileId = tr * tileCols + tc;

      const rimCells = 3;
      const hasVault = hollowBase && (gx1 - gx0 > rimCells * 2 + 2) && (gy1 - gy0 > rimCells * 2 + 2);
      const midGx = Math.floor((gx0 + gx1) * 0.5);
      const midGy = Math.floor((gy0 + gy1) * 0.5);

      // Fix R2: Continuous Vertex-Based Hollow Floor for Layer 1 (meshes.base) with 4 SLA Resin Drain Channels on the Rim!
      // Floor is ALWAYS strictly below cellMinTopZ (even under rivers, zDrainVault = 0.72 < zSubWater = 1.36), so 0 negative winding & 0 cavities!
      const getBaseVertexFloorZ = (vx, vy) => {
        if (!hasVault) return 0.0;
        const inVaultX = (vx > gx0 + rimCells && vx < gx1 - rimCells);
        const inVaultY = (vy > gy0 + rimCells && vy < gy1 - rimCells);
        const isDrainChannel =
          (vx >= midGx - 1 && vx <= midGx + 1 && (vy <= gy0 + rimCells || vy >= gy1 - rimCells)) ||
          (vy >= midGy - 1 && vy <= midGy + 1 && (vx <= gx0 + rimCells || vx >= gx1 - rimCells));
        if (!inVaultX || !inVaultY) {
          return isDrainChannel ? zDrainVault : 0.0;
        }
        let minTop = Infinity;
        for (let dy = -1; dy <= 0; dy++) {
          for (let dx = -1; dx <= 0; dx++) {
            const cx = Math.min(gx1 - 1, Math.max(gx0, vx + dx));
            const cy = Math.min(gy1 - 1, Math.max(gy0, vy + dy));
            const ct = cellMinTopZ[cy * TERRAIN_RES + cx];
            if (ct < minTop) minTop = ct;
          }
        }
        return Math.max(zDrainVault, quantizeZUnits(minTop - hollowWallUnits));
      };

      for (let gy = gy0; gy < gy1; gy++) {
        const y0 = tileY0 + (gy - gy0) * tileStepY;
        const y1 = tileY0 + (gy + 1 - gy0) * tileStepY;
        for (let gx = gx0; gx < gx1; gx++) {
          const x0 = tileX0 + (gx - gx0) * tileStepX;
          const x1 = tileX0 + (gx + 1 - gx0) * tileStepX;

          const v00 = zGrid[gy * strideT + gx];
          const v10 = zGrid[gy * strideT + (gx + 1)];
          const v11 = zGrid[(gy + 1) * strideT + (gx + 1)];
          const v01 = zGrid[(gy + 1) * strideT + gx];

          const f00 = getBaseVertexFloorZ(gx, gy);
          const f10 = getBaseVertexFloorZ(gx + 1, gy);
          const f11 = getBaseVertexFloorZ(gx + 1, gy + 1);
          const f01 = getBaseVertexFloorZ(gx, gy + 1);

          const avgFloor = (f00 + f10 + f11 + f01) * 0.25;
          if (avgFloor > 0) {
            vaultSavedSceneVol += avgFloor * tileStepX * tileStepY;
          }

          // Continuous bottom floor of Layer 1 (meshes.base) with true face normals so vault & drain channels render crisply from below!
          const pf00 = [x0, y0, f00], pf10 = [x1, y0, f10], pf11 = [x1, y1, f11], pf01 = [x0, y1, f01];
          pushTri(meshes.base, pf00, pf01, pf11, computeFaceNormal(pf00, pf01, pf11), 1, -1, tileId);
          pushTri(meshes.base, pf00, pf11, pf10, computeFaceNormal(pf00, pf11, pf10), 1, -1, tileId);

          // Outer tile boundary staircase walls for Layer 1 (meshes.base) & Layer 0 (meshes.water)
          if (gy === gy0) {
            emitBoundaryStaircaseWall(x0, y0, v00, f00, x1, y0, v10, f10, [0, -1, 0], tileId);
            emitWaterBoundaryWall(x0, y0, v00, x1, y0, v10, [0, -1, 0], tileId);
          }
          if (gy === gy1 - 1) {
            emitBoundaryStaircaseWall(x1, y1, v11, f11, x0, y1, v01, f01, [0, 1, 0], tileId);
            emitWaterBoundaryWall(x1, y1, v11, x0, y1, v01, [0, 1, 0], tileId);
          }
          if (gx === gx0) {
            emitBoundaryStaircaseWall(x0, y1, v01, f01, x0, y0, v00, f00, [-1, 0, 0], tileId);
            emitWaterBoundaryWall(x0, y1, v01, x0, y0, v00, [-1, 0, 0], tileId);
          }
          if (gx === gx1 - 1) {
            emitBoundaryStaircaseWall(x1, y0, v10, f10, x1, y1, v11, f11, [1, 0, 0], tileId);
            emitWaterBoundaryWall(x1, y0, v10, x1, y1, v11, [1, 0, 0], tileId);
          }

          const vMax = Math.max(v00, v10, v11, v01);
          const vMin = Math.min(v00, v10, v11, v01);

          // Pure underwater cell: base top at zSubWater, water slab from zWaterBot -> deepWaterZ (0 overlap, 0 cavities, 0 negative winding!)
          if (vMax < baseBottomZ) {
            pushQuad(meshes.base, [x0, y0, zSubWater], [x1, y0, zSubWater], [x1, y1, zSubWater], [x0, y1, zSubWater], [0, 0, 1], 1, -1, tileId);
            pushQuad(meshes.water, [x0, y0, deepWaterZ], [x1, y0, deepWaterZ], [x1, y1, deepWaterZ], [x0, y1, deepWaterZ], [0, 0, 1], 0, -1, tileId);
            pushQuad(meshes.water, [x0, y0, zWaterBot], [x0, y1, zWaterBot], [x1, y1, zWaterBot], [x1, y0, zWaterBot], [0, 0, -1], 0, -1, tileId);
            cellTerracePolys[gy * TERRAIN_RES + gx].push({
              poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
              zSurf: waterSurfZ,
              tileId
            });
            // Bridges / piers over pure water cell sit flush on deepWaterZ + epsSep
            const mx = (x0 + x1) * 0.5, my = (y0 + y1) * 0.5;
            const subBoxes = [
              [x0, y0, mx, my],
              [mx, y0, x1, my],
              [x0, my, mx, y1],
              [mx, my, x1, y1]
            ];
            for (let s = 0; s < 4; s++) {
              const [sx0, sy0, sx1, sy1] = subBoxes[s];
              const mIdx = sampleMaskIdx((sx0 + sx1) * 0.5, (sy0 + sy1) * 0.5);
              const hasBld =
                bldMask[mIdx] === 1 ||
                bldMask[sampleMaskIdx(sx0, sy0)] === 1 ||
                bldMask[sampleMaskIdx(sx1, sy0)] === 1 ||
                bldMask[sampleMaskIdx(sx0, sy1)] === 1 ||
                bldMask[sampleMaskIdx(sx1, sy1)] === 1;
              if (!hasBld && bridgeMask[mIdx] === 1) {
                emitClosedSlab2D([[sx0, sy0], [sx1, sy0], [sx1, sy1], [sx0, sy1]], deepWaterZ + epsSep, deepWaterZ + brHeight, 3, meshes.roads, tileId);
              }
            }
            continue;
          }

          const kMinRaw = getStepIdxForVal(vMin);
          const kMax = getStepIdxForVal(vMax);
          if (kMinRaw >= 0 && kMinRaw === kMax) {
            const tZ = thresholds[kMinRaw];
            pushQuad(meshes.base, [x0, y0, tZ], [x1, y0, tZ], [x1, y1, tZ], [x0, y1, tZ], [0, 0, 1], 1, -1, tileId);
            cellTerracePolys[gy * TERRAIN_RES + gx].push({
              poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
              zSurf: tZ,
              tileId
            });
            emitCellFeatureSlabs(null, x0, y0, x1, y1, tZ, tileId);
            continue;
          }

          const c00 = { x: x0, y: y0, v: v00, isCut: false };
          const c10 = { x: x1, y: y0, v: v10, isCut: false };
          const c11 = { x: x1, y: y1, v: v11, isCut: false };
          const c01 = { x: x0, y: y1, v: v01, isCut: false };
          const cellTris = [
            [c00, c10, c11],
            [c00, c11, c01]
          ];

          const gradX = (v10 - v00) + (v11 - v01);
          const gradY = (v01 - v00) + (v11 - v10);
          const gLen = Math.hypot(gradX, gradY) || 1;
          const riserNorm = [-gradX / gLen, -gradY / gLen, 0];

          for (let ct = 0; ct < 2; ct++) {
            const cellTri = cellTris[ct];
            const tvMin = Math.min(cellTri[0].v, cellTri[1].v, cellTri[2].v);
            const tvMax = Math.max(cellTri[0].v, cellTri[1].v, cellTri[2].v);

            if (tvMin < baseBottomZ) {
              const subWater = clipCellPolyByScalar(cellTri, baseBottomZ, false);
              const swp = subWater.poly;
              if (swp.length >= 3) {
                const p0 = swp[0];
                for (let ti = 1; ti < swp.length - 1; ti++) {
                  const p1 = swp[ti], p2 = swp[ti + 1];
                  pushTri(meshes.base, [p0.x, p0.y, zSubWater], [p1.x, p1.y, zSubWater], [p2.x, p2.y, zSubWater], [0, 0, 1], 1, -1, tileId);
                  pushTri(meshes.water, [p0.x, p0.y, deepWaterZ], [p1.x, p1.y, deepWaterZ], [p2.x, p2.y, deepWaterZ], [0, 0, 1], 0, -1, tileId);
                  pushTri(meshes.water, [p0.x, p0.y, zWaterBot], [p2.x, p2.y, zWaterBot], [p1.x, p1.y, zWaterBot], [0, 0, -1], 0, -1, tileId);
                }
                cellTerracePolys[gy * TERRAIN_RES + gx].push({
                  poly: swp.map(pt => [pt.x, pt.y]),
                  zSurf: waterSurfZ,
                  tileId
                });
                for (const [cA, cB] of subWater.cuts) {
                  pushQuad(
                    meshes.water,
                    [cB.x, cB.y, zWaterBot],
                    [cA.x, cA.y, zWaterBot],
                    [cA.x, cA.y, deepWaterZ],
                    [cB.x, cB.y, deepWaterZ],
                    [-riserNorm[0], -riserNorm[1], 0],
                    0,
                    -1,
                    tileId
                  );
                }
              }
            }

            if (tvMax < baseBottomZ) continue;

            const tkMinRaw = getStepIdxForVal(tvMin);
            const tkMax = getStepIdxForVal(tvMax);
            const tkStart = Math.max(0, tkMinRaw);

            for (let k = tkStart; k <= tkMax; k++) {
              const tLow = thresholds[k];
              const tHigh = (k === numContourSteps) ? Infinity : thresholds[k + 1];
              if (tvMax < tLow) break;

              const aboveLow = clipCellPolyByScalar(cellTri, tLow, true);
              if (aboveLow.poly.length < 3) continue;

              for (const [cA, cB] of aboveLow.cuts) {
                const zRiserBot = (k === 0) ? zSubWater : thresholds[k - 1];
                const zRiserTop = tLow;
                pushQuad(
                  meshes.base,
                  [cA.x, cA.y, zRiserBot],
                  [cB.x, cB.y, zRiserBot],
                  [cB.x, cB.y, zRiserTop],
                  [cA.x, cA.y, zRiserTop],
                  riserNorm,
                  1,
                  -1,
                  tileId
                );
              }

              if (tvMin < tHigh) {
                const band = clipCellPolyByScalar(aboveLow.poly, tHigh, false);
                const bp = band.poly;
                if (bp.length >= 3) {
                  const p0 = bp[0];
                  for (let ti = 1; ti < bp.length - 1; ti++) {
                    const p1 = bp[ti], p2 = bp[ti + 1];
                    pushTri(meshes.base, [p0.x, p0.y, tLow], [p1.x, p1.y, tLow], [p2.x, p2.y, tLow], [0, 0, 1], 1, -1, tileId);
                  }
                  const bpXY = bp.map(pt => [pt.x, pt.y]);
                  cellTerracePolys[gy * TERRAIN_RES + gx].push({
                    poly: bpXY,
                    zSurf: tLow,
                    tileId
                  });
                  emitCellFeatureSlabs(bpXY, x0, y0, x1, y1, tLow, tileId);
                }
              }
            }
          }
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // STEP 4: WATERTIGHT 3D SCULPTED TREES (FLUSH ON FLAT TERRACE / TURF, 0 FLOATING)
  // --------------------------------------------------------------------------
  const placedTrees = [];
  (scene.trees || []).forEach((tr, idx) => {
    const [bx, by] = toBed([tr[0], tr[1]]);
    if (bx < -82.8 || bx > 82.8 || by < -82.8 || by > 82.8) return;
    const mIdx = sampleMaskIdx(bx, by);
    if (waterMask[mIdx] || roadAndBldMask[mIdx]) return;

    const treeRadius = (0.54 + (idx % 5) * 0.09) * Math.min(1.15, Math.sqrt(scaleToBed));
    const u = ((bx + 84.6) / 169.2) * TERRAIN_RES;
    const v = ((by + 84.6) / 169.2) * TERRAIN_RES;
    const gx = Math.min(TERRAIN_RES - 1, Math.max(0, Math.floor(u)));
    const gy = Math.min(TERRAIN_RES - 1, Math.max(0, Math.floor(v)));

    // Ensure the entire tree crown base sits within a single flat terrain cell (0 step overhang!)
    const cellX0 = -84.6 + gx * cellStep;
    const cellX1 = cellX0 + cellStep;
    const cellY0 = -84.6 + gy * cellStep;
    const cellY1 = cellY0 + cellStep;
    const cx = Math.min(cellX1 - treeRadius - 0.05, Math.max(cellX0 + treeRadius + 0.05, bx));
    const cy = Math.min(cellY1 - treeRadius - 0.05, Math.max(cellY0 + treeRadius + 0.05, by));

    const v00 = zGrid[gy * strideT + gx];
    const v10 = zGrid[gy * strideT + (gx + 1)];
    const v11 = zGrid[(gy + 1) * strideT + (gx + 1)];
    const v01 = zGrid[(gy + 1) * strideT + gx];
    const kMinRaw = getStepIdxForVal(Math.min(v00, v10, v11, v01));
    const kMax = getStepIdxForVal(Math.max(v00, v10, v11, v01));
    if (kMinRaw < 0 || kMinRaw !== kMax) return;

    // Use exact same getCellSubTypes as emitCellFeatureSlabs so tree base height matches cell turf/bare state 1:1
    const { rdCount, grCount } = getCellSubTypes(cellX0, cellY0, cellX1, cellY1);
    if (rdCount > 0 || (grCount !== 0 && grCount !== 4)) return;

    // Check 8 points on tree perimeter so tree crown never touches buildings, roads, or water
    let crownBlocked = false;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const pIdx = sampleMaskIdx(cx + Math.cos(ang) * (treeRadius + 0.12), cy + Math.sin(ang) * (treeRadius + 0.12));
      if (bldMask[pIdx] || roadMask[pIdx] || bridgeMask[pIdx] || waterMask[pIdx]) {
        crownBlocked = true;
        break;
      }
    }
    if (crownBlocked) return;

    const [tc, trRow, tileId] = getTileColRowForXY(cx, cy);
    const tileX0 = -84.6 + tc * cellsPerCol * cellStep;
    const tileX1 = (tc === tileCols - 1) ? 84.6 : -84.6 + (tc + 1) * cellsPerCol * cellStep;
    const tileY0 = -84.6 + trRow * cellsPerRow * cellStep;
    const tileY1 = (trRow === tileRows - 1) ? 84.6 : -84.6 + (trRow + 1) * cellsPerRow * cellStep;

    const margin = treeRadius + 0.06;
    if (cx - margin < tileX0 || cx + margin > tileX1 || cy - margin < tileY0 || cy + margin > tileY1) return;

    for (let j = 0; j < placedTrees.length; j++) {
      const pt = placedTrees[j];
      if (Math.hypot(cx - pt[0], cy - pt[1]) < (treeRadius + pt[2]) * 1.08) return;
    }
    placedTrees.push([cx, cy, treeRadius]);

    // Anchor tree base at tZ + gHeight + epsSep on green turf or tZ + epsSep on bare terrain
    const tZ = thresholds[kMinRaw];
    const zG = (grCount === 4) ? (tZ + gHeight + epsSep) : (tZ + epsSep);
    const treeHeight = (1.30 + (idx % 6) * 0.22) * (state.zScale || 1.0) * 0.85;
    addTreeCrown3D(cx, cy, zG, treeRadius, treeHeight, 2, meshes.greenery, tileId);
  });

  // --------------------------------------------------------------------------
  // STEP 6: REAL OSM BUILDINGS (0 FLOATING, 0 INTER-LAYER OVERLAP, 0 OPEN EDGES)
  // --------------------------------------------------------------------------
  const mToU = (scene.metersToUnits || 0.13) * scaleToBed;
  const rawBuildings = scene.buildings || [];

  const prepared = [];
  for (let i = 0; i < rawBuildings.length; i++) {
    const b = rawBuildings[i];
    if (b.hidden || b.btype === 'pier') continue;
    const bedOuterRaw = b.outer.map(toBed);
    const clippedOuter = cleanPolygonRing(clipPolyToBox(bedOuterRaw, -84.2, -84.2, 84.2, 84.2), true);
    if (clippedOuter.length < 3 || hasSelfTouchingEdge2D(clippedOuter, 1e-4)) continue;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < clippedOuter.length; k++) {
      const p = clippedOuter[k];
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const minSpan = Math.min(spanX, spanY);
    const area = Math.abs(signedArea2D(clippedOuter));
    if (minSpan < 0.55 || area < 0.45) continue;

    const clippedHoles = (b.holes || [])
      .map(h => clipPolyToBox(h.map(toBed), -84.2, -84.2, 84.2, 84.2))
      .filter(h => h.length >= 3);

    prepared.push({
      b,
      clippedOuter,
      clippedHoles,
      minX, maxX, minY, maxY,
      minSpan,
      area,
      cx: (minX + maxX) * 0.5,
      cy: (minY + maxY) * 0.5,
      groupId: b.id,
      skipDuplicate: false
    });
  }

  prepared.sort((a, b) => b.area - a.area);

  function polygonsOverlap2D(A, B) {
    if (A.maxX <= B.minX + 0.015 || A.minX >= B.maxX - 0.015 || A.maxY <= B.minY + 0.015 || A.minY >= B.maxY - 0.015) {
      return false;
    }
    const inAHole = (px, py) => A.clippedHoles.some(h => pointInPoly2D(px, py, h));
    const inBHole = (px, py) => B.clippedHoles.some(h => pointInPoly2D(px, py, h));
    if (pointInPoly2D(B.cx, B.cy, A.clippedOuter) && !inAHole(B.cx, B.cy)) return true;
    if (pointInPoly2D(A.cx, A.cy, B.clippedOuter) && !inBHole(A.cx, A.cy)) return true;
    for (let i = 0; i < B.clippedOuter.length; i++) {
      const p = B.clippedOuter[i];
      if (pointInPoly2D(p[0], p[1], A.clippedOuter) && !inAHole(p[0], p[1])) return true;
    }
    for (let i = 0; i < A.clippedOuter.length; i++) {
      const p = A.clippedOuter[i];
      if (pointInPoly2D(p[0], p[1], B.clippedOuter) && !inBHole(p[0], p[1])) return true;
    }
    for (let i = 0; i < A.clippedOuter.length; i++) {
      const a1 = A.clippedOuter[i], a2 = A.clippedOuter[(i + 1) % A.clippedOuter.length];
      for (let j = 0; j < B.clippedOuter.length; j++) {
        const b1 = B.clippedOuter[j], b2 = B.clippedOuter[(j + 1) % B.clippedOuter.length];
        if (segmentsIntersectProper(a1, a2, b1, b2)) return true;
      }
    }
    return false;
  }

  // Deduplicate overlapping building / building:part footprints so 0 buildings self-overlap in 3D
  for (let i = 0; i < prepared.length; i++) {
    const P = prepared[i];
    if (P.skipDuplicate) continue;
    for (let j = i + 1; j < prepared.length; j++) {
      const C = prepared[j];
      if (C.skipDuplicate) continue;
      if (polygonsOverlap2D(P, C)) {
        if (C.b.h > P.b.h) {
          P.b.h = C.b.h;
          P.b.levels = C.b.levels;
        }
        if (C.b.highlighted) P.b.highlighted = true;
        C.skipDuplicate = true;
      }
    }
  }

  const groupHighlighted = new Set();
  const groupHeightMult = new Map();
  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    if (item.b.highlighted) groupHighlighted.add(item.groupId);
    if (item.b.heightMult && item.b.heightMult !== 1.0) {
      groupHeightMult.set(item.groupId, item.b.heightMult);
    }
  }

  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    if (item.skipDuplicate) continue;
    const b = item.b;
    const gid = item.groupId;

    const gxMin = Math.max(0, Math.floor(((item.minX + 84.6) / 169.2) * TERRAIN_RES));
    const gxMax = Math.min(TERRAIN_RES - 1, Math.floor(((item.maxX + 84.6) / 169.2) * TERRAIN_RES));
    const gyMin = Math.max(0, Math.floor(((item.minY + 84.6) / 169.2) * TERRAIN_RES));
    const gyMax = Math.min(TERRAIN_RES - 1, Math.floor(((item.maxY + 84.6) / 169.2) * TERRAIN_RES));

    const insetOuter = insetPolygonCentroid(item.clippedOuter, 0.012);
    const intersectingTerraces = [];
    const uniqueSurfs = new Set();
    let minTerrainZ = Infinity;
    let maxTerrainZ = -Infinity;

    for (let gy = gyMin; gy <= gyMax; gy++) {
      for (let gx = gxMin; gx <= gxMax; gx++) {
        const tList = cellTerracePolys[gy * TERRAIN_RES + gx];
        for (let t = 0; t < tList.length; t++) {
          const tp = tList[t];
          intersectingTerraces.push(tp);
          uniqueSurfs.add(tp.zSurf.toFixed(4));
          if (tp.zSurf < minTerrainZ) minTerrainZ = tp.zSurf;
          if (tp.zSurf > maxTerrainZ) maxTerrainZ = tp.zSurf;
        }
      }
    }
    if (!Number.isFinite(minTerrainZ)) {
      minTerrainZ = getActualPrintedSurfaceMinZ(item.cx, item.cy);
      maxTerrainZ = getQuantizedTerrainZ(item.cx, item.cy);
      uniqueSurfs.add(minTerrainZ.toFixed(4));
    }

    const hMult = (groupHeightMult.get(gid) || b.heightMult || 1.0) * (state.zScale || 1.0);
    let totalHMm = Math.max(1.25, b.h * mToU * hMult);

    if (item.minSpan < 2.6) {
      const maxPrintableH = Math.max(1.8, item.minSpan * 2.85);
      if (totalHMm > maxPrintableH) {
        totalHMm = maxPrintableH;
      }
    }

    let roofHMm = (b.roof !== 'flat') ? Math.max(0.45, (b.roofH || 3.2) * mToU * hMult) : 0;
    roofHMm = Math.min(roofHMm, item.minSpan * 0.45, totalHMm * 0.34);

    const isHl = groupHighlighted.has(gid) || !!b.highlighted;
    const zBase = minTerrainZ + epsSep;
    const zEaves = quantizeZUnits(maxTerrainZ + Math.max(0.95, totalHMm - roofHMm * 0.35));
    const zRidge = (b.roof !== 'flat' && roofHMm > 0.14)
      ? Math.max(zEaves + 0.16, quantizeZUnits(zEaves + roofHMm))
      : zEaves;

    const targetLayerId = isHl ? 5 : 4;
    const targetList = isHl ? meshes.highlighted : meshes.buildings;
    const hasPitched = (b.roof !== 'flat' && roofHMm > 0.14);

    if (uniqueSurfs.size <= 1) {
      // Uniform flat terrace underneath entire building bounding box: extrude intact!
      if (tileCols === 1 && tileRows === 1) {
        extrudeBuildingLoD2(insetOuter, item.clippedHoles, zBase, zEaves, zRidge, hasPitched, targetLayerId, gid, targetList, 0, b.roof || 'hipped');
      } else {
        for (let tr = 0; tr < tileRows; tr++) {
          const ty0 = -84.6 + tr * cellsPerRow * cellStep;
          const ty1 = (tr === tileRows - 1) ? 84.6 : -84.6 + (tr + 1) * cellsPerRow * cellStep;
          if (item.maxY <= ty0 || item.minY >= ty1) continue;

          for (let tc = 0; tc < tileCols; tc++) {
            const tx0 = -84.6 + tc * cellsPerCol * cellStep;
            const tx1 = (tc === tileCols - 1) ? 84.6 : -84.6 + (tc + 1) * cellsPerCol * cellStep;
            if (item.maxX <= tx0 || item.minX >= tx1) continue;

            const tileId = tr * tileCols + tc;
            if (item.minX >= tx0 + 0.03 && item.maxX <= tx1 - 0.03 && item.minY >= ty0 + 0.03 && item.maxY <= ty1 - 0.03) {
              extrudeBuildingLoD2(insetOuter, item.clippedHoles, zBase, zEaves, zRidge, hasPitched, targetLayerId, gid, targetList, tileId, b.roof || 'hipped');
              continue;
            }

            const tileBox = [[tx0, ty0], [tx1, ty0], [tx1, ty1], [tx0, ty1]];
            const outerClean = cleanPolygonRing(insetOuter, true);
            if (isConvexPoly(outerClean) && item.clippedHoles.length === 0) {
              const bTileOuter = cleanPolygonRing(clipPolyByConvex(outerClean, tileBox, 0.03), true);
              if (bTileOuter.length >= 3 && signedArea2D(bTileOuter) >= 0.06 && isSimplePolygon(bTileOuter)) {
                extrudeBuildingLoD2(bTileOuter, [], zBase, zEaves, zRidge, hasPitched, targetLayerId, gid, targetList, tileId, b.roof || 'hipped');
              }
            } else {
              const holesClean = (item.clippedHoles || []).map(h => cleanPolygonRing(h, false)).filter(h => h.length >= 3);
              let baseRing = holesClean.length > 0 ? mergeHolesIntoOuterKeyhole(outerClean, holesClean) : outerClean;
              if (!isSimplePolygon(baseRing)) baseRing = outerClean;
              const baseTris = triangulateSimplePoly(baseRing);
              for (let ti = 0; ti < baseTris.length; ti++) {
                const tri = baseTris[ti];
                if (signedArea2D(tri) <= 1e-4) continue;
                const triInset = clipPolyByConvex(tri, tri, 0.008);
                if (triInset.length < 3) continue;
                const clippedTri = cleanPolygonRing(clipPolyByConvex(triInset, tileBox, 0.03), true);
                if (clippedTri.length >= 3 && signedArea2D(clippedTri) >= 0.035 && isSimplePolygon(clippedTri)) {
                  extrudeBuildingLoD2(clippedTri, [], zBase, zEaves, zRidge, hasPitched, targetLayerId, gid, targetList, tileId, b.roof || 'hipped');
                }
              }
            }
          }
        }
      }
    } else {
      // Building straddles a contour riser or shoreline: clip convex pieces against each convex terrace polygon with 0.015 perpendicular margin!
      const outerClean = cleanPolygonRing(insetOuter, true);
      const holesClean = (item.clippedHoles || []).map(h => cleanPolygonRing(h, false)).filter(h => h.length >= 3);
      let baseRing = holesClean.length > 0 ? mergeHolesIntoOuterKeyhole(outerClean, holesClean) : outerClean;
      if (!isSimplePolygon(baseRing)) baseRing = outerClean;
      const isBaseConvex = (holesClean.length === 0 && isConvexPoly(baseRing));
      const baseTris = isBaseConvex ? [baseRing] : triangulateSimplePoly(baseRing);

      for (let t = 0; t < intersectingTerraces.length; t++) {
        const tp = intersectingTerraces[t];
        const zPieceBase = tp.zSurf + epsSep;
        for (let ti = 0; ti < baseTris.length; ti++) {
          const subjectRaw = baseTris[ti];
          if (signedArea2D(subjectRaw) <= 1e-4) continue;
          const subject = isBaseConvex ? subjectRaw : clipPolyByConvex(subjectRaw, subjectRaw, 0.008);
          if (subject.length < 3) continue;
          const piece = cleanPolygonRing(clipPolyByConvex(subject, tp.poly, 0.015), true);
          if (piece.length >= 3 && signedArea2D(piece) >= 0.035 && isSimplePolygon(piece)) {
            extrudeBuildingLoD2(piece, [], zPieceBase, zEaves, zRidge, hasPitched, targetLayerId, gid, targetList, tp.tileId, b.roof || 'hipped');
          }
        }
      }
    }

    buildingBounds.push({
      building: b,
      groupId: gid,
      minX: item.minX, maxX: item.maxX,
      minY: item.minY, maxY: item.maxY,
      minZ: zBase, maxZ: hasPitched ? zRidge : zEaves,
      layerId: targetLayerId
    });
  }

  // --------------------------------------------------------------------------
  // STEP 7: MITERED STUDIO FRAME (LAYER 6 — STUDIO DISPLAY ONLY, NOT EXPORTED!)
  // --------------------------------------------------------------------------
  const innerR = 84.85;
  const outerR = 94.5;
  const zFrameBot = -1.6;
  const zFrameTop = 3.55;
  const miterQuads = [
    [[-outerR, -outerR], [outerR, -outerR], [innerR, -innerR], [-innerR, -innerR]],
    [[outerR, -outerR], [outerR, outerR], [innerR, innerR], [innerR, -innerR]],
    [[outerR, outerR], [-outerR, outerR], [-innerR, innerR], [innerR, innerR]],
    [[-outerR, outerR], [-outerR, -outerR], [-innerR, -innerR], [-innerR, innerR]]
  ];
  miterQuads.forEach(mq => {
    extrudeBuildingLoD2(mq, [], zFrameBot, zFrameTop, zFrameTop, false, 6, -1, meshes.frame, -1, 'flat');
  });

  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // STEP 8: EXACT MATHEMATICAL VOLUME (ml), MASS (g) & REAL TOPOLOGY PREFLIGHT (Fix R9)
  // --------------------------------------------------------------------------
  return computePrintMetricsAndTopology(meshes, buildingBounds, state, {
    totalWidthMm,
    tileCols,
    tileRows,
    cellsPerCol,
    cellsPerRow,
    cellStep,
    hollowBase,
    vaultSavedSceneVol,
    getActualPrintedSurfaceMinZ
  });
}
