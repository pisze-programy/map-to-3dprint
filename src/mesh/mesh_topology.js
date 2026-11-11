// ============================================================================
// src/mesh/mesh_topology.js
// Exact Signed-Tetrahedron Volume (ml), Resin/PLA Mass (g), Photon Mono 4 Fit,
// Multi-Shell Welded 2-Manifold Topology Audit & Interior-Point Support Check
// High-Performance 32-bit Numeric Spatial Hash & Fast Volume Estimation
// ============================================================================

/**
 * Fast O(N) Signed-Tetrahedron Volume and Print Dimensions Estimation (<10ms).
 * Computes exact volume, resin/PLA mass, bounding box, and Photon Mono 4 fit
 * with ZERO string allocations and ZERO half-edge pairing overhead.
 */
function computeFastVolumeAndExtents(meshes, buildingBounds, state, ctx) {
  const totalWidthMm = (ctx && ctx.totalWidthMm) || (state && state.bedSizeMm) || 320;
  const totalHeightMm = (ctx && ctx.totalHeightMm) || (state && state.totalHeightMm) || totalWidthMm;
  const maxDimMm = Math.max(totalWidthMm, totalHeightMm);
  const scaleMm = maxDimMm / 169.2;
  const scaleMm3 = scaleMm * scaleMm * scaleMm;

  const tileCols = Math.max(1, (ctx && ctx.tileCols) || (state && state.tileCols) || 1);
  const tileRows = Math.max(1, (ctx && ctx.tileRows) || (state && state.tileRows) || 1);
  const numTiles = tileCols * tileRows;
  const tileWidthMm = totalWidthMm / tileCols;
  const tileHeightMm = totalHeightMm / tileRows;

  let totalTriangles = 0;
  let maxSceneZ = 0;
  const tileVolumesMm3 = new Float64Array(numTiles);
  const layerVolumesMm3 = {};

  const printLayerKeys = ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted'];
  if (state && state.exportFrame) printLayerKeys.push('frame');
  const allDisplayKeys = ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted', 'frame'];

  for (let ki = 0; ki < allDisplayKeys.length; ki++) {
    totalTriangles += (meshes[allDisplayKeys[ki]] || []).length;
  }

  for (let ki = 0; ki < printLayerKeys.length; ki++) {
    const k = printLayerKeys[ki];
    const arr = meshes[k] || [];
    let lVolScene = 0;
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      const a = t.v0, b = t.v1, c = t.v2;
      const tid = Math.min(numTiles - 1, Math.max(0, t.tileId || 0));

      if (a[2] > maxSceneZ) maxSceneZ = a[2];
      if (b[2] > maxSceneZ) maxSceneZ = b[2];
      if (c[2] > maxSceneZ) maxSceneZ = c[2];

      const v6 =
        a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0]);
      lVolScene += v6;
      tileVolumesMm3[tid] += v6;
    }
    layerVolumesMm3[k] = Math.max(0, (lVolScene / 6.0) * scaleMm3);
  }

  let totalVolumeMm3 = 0;
  const tileVolumesMl = [];
  for (let tid = 0; tid < numTiles; tid++) {
    const vMm3 = Math.max(0, (tileVolumesMm3[tid] / 6.0) * scaleMm3);
    totalVolumeMm3 += vMm3;
    tileVolumesMl.push(vMm3 / 1000.0);
  }

  const totalVolumeMl = totalVolumeMm3 / 1000.0;
  const vaultSavedSceneVol = (ctx && ctx.vaultSavedSceneVol) || 0;
  const solidReferenceMl = totalVolumeMl + (vaultSavedSceneVol * scaleMm3) / 1000.0;
  const hollowBase = Boolean((ctx && ctx.hollowBase) || (state && state.hollowBase));
  const hollowSavingsPct = hollowBase && solidReferenceMl > 0
    ? Math.round(((solidReferenceMl - totalVolumeMl) / solidReferenceMl) * 100)
    : 0;

  const maxZMm = Math.max(6.0, maxSceneZ * scaleMm);
  const maxTileVolumeMl = tileVolumesMl.length ? Math.max(...tileVolumesMl) : totalVolumeMl;

  const fitsPhotonMono4 = (
    ((tileWidthMm <= 153.45 && tileHeightMm <= 87.05) ||
     (tileHeightMm <= 153.45 && tileWidthMm <= 87.05)) &&
    (maxZMm <= 165.0)
  );

  return {
    totalVolumeMl,
    resinMl: totalVolumeMl,
    solidReferenceMl,
    hollowSavingsPct,
    resinGrams: Math.round(totalVolumeMl * 1.12),
    plaGrams: Math.round(totalVolumeMl * 0.42),
    tileVolumesMl,
    maxTileVolumeMl,
    tileWidthMm,
    tileHeightMm,
    maxZMm,
    tileCols,
    tileRows,
    numTiles,
    totalTriangles,
    hasDrainChannels: hollowBase,
    fitsPhotonMono4,
    frameExcludedFromExport: !(state && state.exportFrame),
    layerVolumesMm3
  };
}

/**
 * High-Performance Numeric Spatial-Hash Topology Audit.
 * Replaces string key allocations with 32-bit flat integer typed arrays (Int32Array).
 */
function auditMeshTopologyNumeric(meshes, buildingBounds, state, ctx, fastMetrics = null, yieldCtrl = null) {
  if (yieldCtrl) {
    return auditMeshTopologyNumericProgressive(meshes, buildingBounds, state, ctx, fastMetrics, yieldCtrl);
  }
  const pm = fastMetrics || computeFastVolumeAndExtents(meshes, buildingBounds, state, ctx);

  const totalWidthMm = (ctx && ctx.totalWidthMm) || (state && state.bedSizeMm) || 320;
  const totalHeightMm = (ctx && ctx.totalHeightMm) || (state && state.totalHeightMm) || totalWidthMm;
  const maxDimMm = Math.max(totalWidthMm, totalHeightMm);
  const scaleMm = maxDimMm / 169.2;
  const scaleMm3 = scaleMm * scaleMm * scaleMm;

  const halfW = 84.6 * (totalWidthMm / maxDimMm);
  const halfH = 84.6 * (totalHeightMm / maxDimMm);
  const tileCols = pm.tileCols, tileRows = pm.tileRows, numTiles = pm.numTiles;
  const tileStepX = (2 * halfW) / tileCols, tileStepY = (2 * halfH) / tileRows;

  let openEdgesCount = 0;
  let nonManifoldEdgesCount = 0;
  let sameDirDupEdgesCount = 0;
  let unpairedDirEdgesCount = 0;
  let degenerateTrisCount = 0;
  let negativeWindingCount = 0;
  let floatingBuildingsCount = 0;
  let outOfTileTrisCount = 0;

  const layerMetrics = {};
  const printLayerKeys = ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted'];
  if (state && state.exportFrame) printLayerKeys.push('frame');

  for (let ki = 0; ki < printLayerKeys.length; ki++) {
    const k = printLayerKeys[ki];
    const arr = meshes[k] || [];
    if (arr.length === 0) {
      layerMetrics[k] = {
        triangles: 0,
        degenerateTris: 0,
        openEdges: 0,
        nonManifoldEdges: 0,
        sameDirDupEdges: 0,
        unpairedDirEdges: 0,
        volumeMl: 0
      };
      continue;
    }

    const numTris = arr.length;
    const maxV = numTris * 3;
    let vCap = 1;
    while (vCap < maxV * 2) vCap <<= 1;
    const vMask = vCap - 1;
    const vHead = new Int32Array(vCap).fill(-1);
    const vNext = new Int32Array(maxV);
    const vertX = new Int32Array(maxV);
    const vertY = new Int32Array(maxV);
    const vertZ = new Int32Array(maxV);
    const vertShell = new Int32Array(maxV);
    let numVerts = 0;

    const shellMap = new Map();
    let nextShellIdx = 0;
    function getShellIndex(tid, rawShell) {
      const normShell = rawShell >= 0 ? (rawShell * 2) : ((-rawShell) * 2 + 1);
      const compositeKey = tid * 0x2000000 + normShell;
      let idx = shellMap.get(compositeKey);
      if (idx === undefined) {
        idx = nextShellIdx++;
        shellMap.set(compositeKey, idx);
      }
      return idx;
    }

    function getVertexId(x, y, z, shellKey) {
      const qx = Math.round(x * 5000) | 0;
      const qy = Math.round(y * 5000) | 0;
      const qz = Math.round(z * 5000) | 0;
      let h = ((qx * 73856093) ^ (qy * 19349663) ^ (qz * 83492791) ^ (shellKey * 2654435761)) | 0;
      h = (h ^ (h >>> 16)) & vMask;
      let idx = vHead[h];
      while (idx !== -1) {
        if (vertX[idx] === qx && vertY[idx] === qy && vertZ[idx] === qz && vertShell[idx] === shellKey) {
          return idx;
        }
        idx = vNext[idx];
      }
      const newId = numVerts++;
      vertX[newId] = qx;
      vertY[newId] = qy;
      vertZ[newId] = qz;
      vertShell[newId] = shellKey;
      vNext[newId] = vHead[h];
      vHead[h] = newId;
      return newId;
    }

    const maxE = numTris * 3;
    let eCap = 1;
    while (eCap < maxE * 2) eCap <<= 1;
    const eMask = eCap - 1;
    const eHead = new Int32Array(eCap).fill(-1);
    const eNext = new Int32Array(maxE);
    const edgeU = new Int32Array(maxE);
    const edgeV = new Int32Array(maxE);
    const edgeCount = new Int32Array(maxE);
    let numEdges = 0;

    function findOrAddDirectedEdge(u, v) {
      let h = ((u * 73856093) ^ (v * 19349663)) | 0;
      h = (h ^ (h >>> 16)) & eMask;
      let idx = eHead[h];
      while (idx !== -1) {
        if (edgeU[idx] === u && edgeV[idx] === v) {
          edgeCount[idx]++;
          return idx;
        }
        idx = eNext[idx];
      }
      const newE = numEdges++;
      edgeU[newE] = u;
      edgeV[newE] = v;
      edgeCount[newE] = 1;
      eNext[newE] = eHead[h];
      eHead[h] = newE;
      return newE;
    }

    function getDirectedEdgeCount(u, v) {
      let h = ((u * 73856093) ^ (v * 19349663)) | 0;
      h = (h ^ (h >>> 16)) & eMask;
      let idx = eHead[h];
      while (idx !== -1) {
        if (edgeU[idx] === u && edgeV[idx] === v) return edgeCount[idx];
        idx = eNext[idx];
      }
      return 0;
    }

    let lVolScene = 0;
    let lDegenerate = 0;

    for (let i = 0; i < numTris; i++) {
      const t = arr[i];
      const a = t.v0, b = t.v1, c = t.v2;
      const tid = Math.min(numTiles - 1, Math.max(0, t.tileId || 0));

      if (numTiles > 1) {
        const tc = tid % tileCols;
        const tr = Math.floor(tid / tileCols);
        const tx0 = -halfW + tc * tileStepX - 0.15;
        const tx1 = -halfW + (tc + 1) * tileStepX + 0.15;
        const ty0 = -halfH + tr * tileStepY - 0.15;
        const ty1 = -halfH + (tr + 1) * tileStepY + 0.15;
        if (a[0] < tx0 || a[0] > tx1 || a[1] < ty0 || a[1] > ty1 ||
            b[0] < tx0 || b[0] > tx1 || b[1] < ty0 || b[1] > ty1 ||
            c[0] < tx0 || c[0] > tx1 || c[1] < ty0 || c[1] > ty1) {
          outOfTileTrisCount++;
        }
      }

      lVolScene +=
        a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0]);

      const rawShell = (t.shellId !== undefined)
        ? t.shellId
        : ((k === 'buildings' || k === 'highlighted') ? (t.buildingId || 0) : tid);
      const shellKey = getShellIndex(tid, rawShell);

      const ia = getVertexId(a[0], a[1], a[2], shellKey);
      const ib = getVertexId(b[0], b[1], b[2], shellKey);
      const ic = getVertexId(c[0], c[1], c[2], shellKey);

      if (ia === ib || ib === ic || ic === ia) {
        degenerateTrisCount++;
        lDegenerate++;
        continue;
      }

      findOrAddDirectedEdge(ia, ib);
      findOrAddDirectedEdge(ib, ic);
      findOrAddDirectedEdge(ic, ia);
    }

    let lOpen = 0, lNonMan = 0, lDupDir = 0, lUnpaired = 0;
    for (let e = 0; e < numEdges; e++) {
      const c = edgeCount[e];
      if (c > 1) {
        sameDirDupEdgesCount++;
        lDupDir++;
      }
      const u = edgeU[e], v = edgeV[e];
      const rev = getDirectedEdgeCount(v, u);
      if (rev !== c) {
        unpairedDirEdgesCount++;
        lUnpaired++;
      }

      if (u < v) {
        const undirCount = c + rev;
        if (undirCount === 1) {
          openEdgesCount++;
          lOpen++;
        } else if (undirCount > 2) {
          nonManifoldEdgesCount++;
          lNonMan++;
        }
      } else if (rev === 0) {
        if (c === 1) {
          openEdgesCount++;
          lOpen++;
        } else if (c > 2) {
          nonManifoldEdgesCount++;
          lNonMan++;
        }
      }
    }

    if (arr.length > 0 && lVolScene < -1e-3) negativeWindingCount++;
    const lVolMm3 = Math.max(0, (lVolScene / 6.0) * scaleMm3);
    layerMetrics[k] = {
      triangles: arr.length,
      degenerateTris: lDegenerate,
      openEdges: lOpen,
      nonManifoldEdges: lNonMan,
      sameDirDupEdges: lDupDir,
      unpairedDirEdges: lUnpaired,
      volumeMl: lVolMm3 / 1000.0
    };
  }

  // Strict point-in-triangle building support verification using guaranteed solid interiorPt
  const getActualPrintedSurfaceMinZ = ctx && ctx.getActualPrintedSurfaceMinZ;
  if (typeof getActualPrintedSurfaceMinZ === 'function' && Array.isArray(buildingBounds)) {
    const roofTris = [];
    const bldgTris = [...(meshes.buildings || []), ...(meshes.highlighted || [])];
    for (let ti = 0; ti < bldgTris.length; ti++) {
      const t = bldgTris[ti];
      if (t.n && t.n[2] > 0.25) {
        const a = t.v0, b = t.v1, c = t.v2;
        roofTris.push({
          v0: a,
          v1: b,
          v2: c,
          buildingId: t.buildingId,
          shellId: t.shellId,
          minX: Math.min(a[0], b[0], c[0]),
          maxX: Math.max(a[0], b[0], c[0]),
          minY: Math.min(a[1], b[1], c[1]),
          maxY: Math.max(a[1], b[1], c[1]),
          minZ: Math.min(a[2], b[2], c[2]),
          maxZ: Math.max(a[2], b[2], c[2])
        });
      }
    }

    const BIN_RES = 32;
    const binW = (2 * halfW) / BIN_RES, binH = (2 * halfH) / BIN_RES;
    const roofBins = Array.from({ length: BIN_RES * BIN_RES }, () => []);
    for (let ri = 0; ri < roofTris.length; ri++) {
      const rt = roofTris[ri];
      const bx0 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((rt.minX + halfW) / binW)));
      const bx1 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((rt.maxX + halfW) / binW)));
      const by0 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((rt.minY + halfH) / binH)));
      const by1 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((rt.maxY + halfH) / binH)));
      for (let by = by0; by <= by1; by++) {
        for (let bx = bx0; bx <= bx1; bx++) roofBins[by * BIN_RES + bx].push(rt);
      }
    }

    const pointInTri2D = (px, py, a, b, c) => {
      const v0x = c[0] - a[0], v0y = c[1] - a[1];
      const v1x = b[0] - a[0], v1y = b[1] - a[1];
      const v2x = px - a[0], v2y = py - a[1];
      const dot00 = v0x * v0x + v0y * v0y, dot01 = v0x * v1x + v0y * v1y, dot02 = v0x * v2x + v0y * v2y;
      const dot11 = v1x * v1x + v1y * v1y, dot12 = v1x * v2x + v1y * v2y;
      const invDenom = 1 / (dot00 * dot11 - dot01 * dot01 || 1e-9);
      const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
      const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
      return (u >= -0.08) && (v >= -0.08) && (u + v <= 1.08);
    };

    const hasRoofTriAt = (px, py, minZ, maxZ, ownShellId, tol) => {
      const bx0 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((px + halfW) / binW)));
      const by0 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((py + halfH) / binH)));
      const bin = roofBins[by0 * BIN_RES + bx0];
      for (let j = 0; j < bin.length; j++) {
        const rt = bin[j];
        if (ownShellId !== undefined && rt.shellId === ownShellId) continue;
        if (rt.maxZ < minZ - tol || rt.minZ > Math.max(minZ + 0.65, maxZ - 0.02)) continue;
        if (pointInTri2D(px, py, rt.v0, rt.v1, rt.v2)) return true;
      }
      return false;
    };

    const tol = 0.08 / scaleMm;
    const kerfShift = Math.max(0.06, ((ctx && ctx.kerfUnits) || 0.025) * 2.5);
    for (let i = 0; i < buildingBounds.length; i++) {
      const bb = buildingBounds[i];
      if (bb.building && bb.building.btype === 'pier') continue;
      if (bb.isCantileverSupported) continue;

      const ip = bb.interiorPt || [(bb.minX + bb.maxX) * 0.5, (bb.minY + bb.maxY) * 0.5];
      const surfZ = getActualPrintedSurfaceMinZ(ip[0], ip[1]);
      const bBottomZ = (ctx && ctx.baseBottomZ !== undefined) ? ctx.baseBottomZ : -Infinity;
      if ((bb.minZ - surfZ) * scaleMm <= 0.08 || (bb.minZ - bBottomZ) * scaleMm <= 0.08) continue;

      const testPts = [ip];
      if (numTiles > 1) {
        testPts.push(
          [ip[0] + kerfShift, ip[1]],
          [ip[0] - kerfShift, ip[1]],
          [ip[0], ip[1] + kerfShift],
          [ip[0], ip[1] - kerfShift]
        );
      }
      if (Array.isArray(bb.samplePts)) {
        for (let k = 0; k < bb.samplePts.length; k++) testPts.push(bb.samplePts[k]);
      }

      let isRoofSupported = false;
      for (let k = 0; k < testPts.length && !isRoofSupported; k++) {
        isRoofSupported = hasRoofTriAt(testPts[k][0], testPts[k][1], bb.minZ, bb.maxZ, bb.shellId, tol);
      }
      if (!isRoofSupported) floatingBuildingsCount++;
    }
  }

  const isWatertightManifold = (
    openEdgesCount === 0 &&
    nonManifoldEdgesCount === 0 &&
    sameDirDupEdgesCount === 0 &&
    unpairedDirEdgesCount === 0 &&
    negativeWindingCount === 0 &&
    floatingBuildingsCount === 0 &&
    outOfTileTrisCount === 0 &&
    pm.totalVolumeMl > 0
  );

  return {
    ...pm,
    openEdgesCount,
    openEdges: openEdgesCount,
    nonManifoldEdgesCount,
    nonManifoldEdges: nonManifoldEdgesCount,
    sameDirDupEdgesCount,
    sameDirDupEdges: sameDirDupEdgesCount,
    unpairedDirEdgesCount,
    unpairedDirEdges: unpairedDirEdgesCount,
    degenerateTrisCount,
    degenerateTris: degenerateTrisCount,
    negativeWindingCount,
    floatingBuildingsCount,
    floatingCount: floatingBuildingsCount,
    outOfTileTrisCount,
    isWatertightManifold,
    isManifold: isWatertightManifold,
    layerMetrics
  };
}

/**
 * Asynchronous Numeric Topology Audit with event-loop yielding between layers.
 */
async function auditMeshTopologyNumericAsync(meshes, buildingBounds, state, ctx, onProgress = null) {
  const fastMetrics = computeFastVolumeAndExtents(meshes, buildingBounds, state, ctx);

  const printLayerKeys = ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted'];
  if (state && state.exportFrame) printLayerKeys.push('frame');

  for (let ki = 0; ki < printLayerKeys.length; ki++) {
    if (typeof onProgress === 'function') {
      onProgress(printLayerKeys[ki], ki, printLayerKeys.length);
    }
    if (typeof yieldToEventLoop === 'function') {
      await yieldToEventLoop();
    } else {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return auditMeshTopologyNumeric(meshes, buildingBounds, state, ctx, fastMetrics);
}

/**
 * Backward-compatible entrypoint combining fast volume and numeric spatial hash audit.
 */
function computePrintMetricsAndTopology(meshes, buildingBounds, state, ctx) {
  const fast = computeFastVolumeAndExtents(meshes, buildingBounds, state, ctx);
  const printMetrics = auditMeshTopologyNumeric(meshes, buildingBounds, state, ctx, fast);
  return {
    meshes,
    buildingBounds,
    pickIdMap: (ctx && ctx.pickIdMap) || new Map(),
    totalTriangles: fast.totalTriangles,
    printMetrics
  };
}

/**
 * Asynchronous Progressive Numeric Topology Audit yielding between layers.
 */
async function auditMeshTopologyNumericProgressive(meshes, buildingBounds, state, ctx, fastMetrics = null, yieldCtrl = null) {
  const pm = fastMetrics || computeFastVolumeAndExtents(meshes, buildingBounds, state, ctx);

  const totalWidthMm = (ctx && ctx.totalWidthMm) || (state && state.bedSizeMm) || 320;
  const totalHeightMm = (ctx && ctx.totalHeightMm) || (state && state.totalHeightMm) || totalWidthMm;
  const maxDimMm = Math.max(totalWidthMm, totalHeightMm);
  const scaleMm = maxDimMm / 169.2;
  const scaleMm3 = scaleMm * scaleMm * scaleMm;

  const halfW = 84.6 * (totalWidthMm / maxDimMm);
  const halfH = 84.6 * (totalHeightMm / maxDimMm);
  const tileCols = pm.tileCols, tileRows = pm.tileRows, numTiles = pm.numTiles;
  const tileStepX = (2 * halfW) / tileCols, tileStepY = (2 * halfH) / tileRows;

  let openEdgesCount = 0;
  let nonManifoldEdgesCount = 0;
  let sameDirDupEdgesCount = 0;
  let unpairedDirEdgesCount = 0;
  let degenerateTrisCount = 0;
  let negativeWindingCount = 0;
  let floatingBuildingsCount = 0;
  let outOfTileTrisCount = 0;

  const layerMetrics = {};
  const printLayerKeys = ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted'];
  if (state && state.exportFrame) printLayerKeys.push('frame');

  for (let ki = 0; ki < printLayerKeys.length; ki++) {
    if (yieldCtrl) {
      yieldCtrl.checkCancellation();
      await yieldCtrl.yieldIfNeeded();
    }
    const k = printLayerKeys[ki];
    const arr = meshes[k] || [];
    if (arr.length === 0) {
      layerMetrics[k] = {
        triangles: 0,
        degenerateTris: 0,
        openEdges: 0,
        nonManifoldEdges: 0,
        sameDirDupEdges: 0,
        unpairedDirEdges: 0,
        volumeMl: 0
      };
      continue;
    }

    const numTris = arr.length;
    const maxV = numTris * 3;
    let vCap = 1;
    while (vCap < maxV * 2) vCap <<= 1;
    const vMask = vCap - 1;
    const vHead = new Int32Array(vCap).fill(-1);
    const vNext = new Int32Array(maxV);
    const vertX = new Int32Array(maxV);
    const vertY = new Int32Array(maxV);
    const vertZ = new Int32Array(maxV);
    const vertShell = new Int32Array(maxV);
    let numVerts = 0;

    const shellMap = new Map();
    let nextShellIdx = 0;
    function getShellIndex(tid, rawShell) {
      const normShell = rawShell >= 0 ? (rawShell * 2) : ((-rawShell) * 2 + 1);
      const compositeKey = tid * 0x2000000 + normShell;
      let idx = shellMap.get(compositeKey);
      if (idx === undefined) {
        idx = nextShellIdx++;
        shellMap.set(compositeKey, idx);
      }
      return idx;
    }

    function getVertexId(x, y, z, shellKey) {
      const qx = Math.round(x * 5000) | 0;
      const qy = Math.round(y * 5000) | 0;
      const qz = Math.round(z * 5000) | 0;
      let h = ((qx * 73856093) ^ (qy * 19349663) ^ (qz * 83492791) ^ (shellKey * 2654435761)) | 0;
      h = (h ^ (h >>> 16)) & vMask;
      let idx = vHead[h];
      while (idx !== -1) {
        if (vertX[idx] === qx && vertY[idx] === qy && vertZ[idx] === qz && vertShell[idx] === shellKey) {
          return idx;
        }
        idx = vNext[idx];
      }
      const newId = numVerts++;
      vertX[newId] = qx;
      vertY[newId] = qy;
      vertZ[newId] = qz;
      vertShell[newId] = shellKey;
      vNext[newId] = vHead[h];
      vHead[h] = newId;
      return newId;
    }

    const maxE = numTris * 3;
    let eCap = 1;
    while (eCap < maxE * 2) eCap <<= 1;
    const eMask = eCap - 1;
    const eHead = new Int32Array(eCap).fill(-1);
    const eNext = new Int32Array(maxE);
    const edgeU = new Int32Array(maxE);
    const edgeV = new Int32Array(maxE);
    const edgeCount = new Int32Array(maxE);
    let numEdges = 0;

    function findOrAddDirectedEdge(u, v) {
      let h = ((u * 73856093) ^ (v * 19349663)) | 0;
      h = (h ^ (h >>> 16)) & eMask;
      let idx = eHead[h];
      while (idx !== -1) {
        if (edgeU[idx] === u && edgeV[idx] === v) {
          edgeCount[idx]++;
          return idx;
        }
        idx = eNext[idx];
      }
      const newE = numEdges++;
      edgeU[newE] = u;
      edgeV[newE] = v;
      edgeCount[newE] = 1;
      eNext[newE] = eHead[h];
      eHead[h] = newE;
      return newE;
    }

    function getDirectedEdgeCount(u, v) {
      let h = ((u * 73856093) ^ (v * 19349663)) | 0;
      h = (h ^ (h >>> 16)) & eMask;
      let idx = eHead[h];
      while (idx !== -1) {
        if (edgeU[idx] === u && edgeV[idx] === v) return edgeCount[idx];
        idx = eNext[idx];
      }
      return 0;
    }

    let lVolScene = 0;
    let lDegenerate = 0;

    for (let i = 0; i < numTris; i++) {
      const t = arr[i];
      const a = t.v0, b = t.v1, c = t.v2;
      const tid = Math.min(numTiles - 1, Math.max(0, t.tileId || 0));

      if (numTiles > 1) {
        const tc = tid % tileCols;
        const tr = Math.floor(tid / tileCols);
        const tx0 = -halfW + tc * tileStepX - 0.15;
        const tx1 = -halfW + (tc + 1) * tileStepX + 0.15;
        const ty0 = -halfH + tr * tileStepY - 0.15;
        const ty1 = -halfH + (tr + 1) * tileStepY + 0.15;
        if (a[0] < tx0 || a[0] > tx1 || a[1] < ty0 || a[1] > ty1 ||
            b[0] < tx0 || b[0] > tx1 || b[1] < ty0 || b[1] > ty1 ||
            c[0] < tx0 || c[0] > tx1 || c[1] < ty0 || c[1] > ty1) {
          outOfTileTrisCount++;
        }
      }

      lVolScene +=
        a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0]);

      const rawShell = (t.shellId !== undefined)
        ? t.shellId
        : ((k === 'buildings' || k === 'highlighted') ? (t.buildingId || 0) : tid);
      const shellKey = getShellIndex(tid, rawShell);

      const ia = getVertexId(a[0], a[1], a[2], shellKey);
      const ib = getVertexId(b[0], b[1], b[2], shellKey);
      const ic = getVertexId(c[0], c[1], c[2], shellKey);

      if (ia === ib || ib === ic || ic === ia) {
        degenerateTrisCount++;
        lDegenerate++;
        continue;
      }

      findOrAddDirectedEdge(ia, ib);
      findOrAddDirectedEdge(ib, ic);
      findOrAddDirectedEdge(ic, ia);
    }

    let lOpen = 0, lNonMan = 0, lDupDir = 0, lUnpaired = 0;
    for (let e = 0; e < numEdges; e++) {
      const c = edgeCount[e];
      if (c > 1) {
        sameDirDupEdgesCount++;
        lDupDir++;
      }
      const u = edgeU[e], v = edgeV[e];
      const rev = getDirectedEdgeCount(v, u);
      if (rev !== c) {
        unpairedDirEdgesCount++;
        lUnpaired++;
      }

      if (u < v) {
        const undirCount = c + rev;
        if (undirCount === 1) {
          openEdgesCount++;
          lOpen++;
        } else if (undirCount > 2) {
          nonManifoldEdgesCount++;
          lNonMan++;
        }
      } else if (rev === 0) {
        if (c === 1) {
          openEdgesCount++;
          lOpen++;
        } else if (c > 2) {
          nonManifoldEdgesCount++;
          lNonMan++;
        }
      }
    }

    if (arr.length > 0 && lVolScene < -1e-3) negativeWindingCount++;
    const lVolMm3 = Math.max(0, (lVolScene / 6.0) * scaleMm3);
    layerMetrics[k] = {
      triangles: arr.length,
      degenerateTris: lDegenerate,
      openEdges: lOpen,
      nonManifoldEdges: lNonMan,
      sameDirDupEdges: lDupDir,
      unpairedDirEdges: lUnpaired,
      volumeMl: lVolMm3 / 1000.0
    };
  }

  // Strict point-in-triangle building support verification using guaranteed solid interiorPt
  const getActualPrintedSurfaceMinZ = ctx && ctx.getActualPrintedSurfaceMinZ;
  if (typeof getActualPrintedSurfaceMinZ === 'function' && Array.isArray(buildingBounds)) {
    const roofTris = [];
    const bldgTris = [...(meshes.buildings || []), ...(meshes.highlighted || [])];
    for (let ti = 0; ti < bldgTris.length; ti++) {
      const t = bldgTris[ti];
      if (t.n && t.n[2] > 0.25) {
        const a = t.v0, b = t.v1, c = t.v2;
        roofTris.push({
          v0: a,
          v1: b,
          v2: c,
          buildingId: t.buildingId,
          shellId: t.shellId,
          minX: Math.min(a[0], b[0], c[0]),
          maxX: Math.max(a[0], b[0], c[0]),
          minY: Math.min(a[1], b[1], c[1]),
          maxY: Math.max(a[1], b[1], c[1]),
          minZ: Math.min(a[2], b[2], c[2]),
          maxZ: Math.max(a[2], b[2], c[2])
        });
      }
    }

    const BIN_RES = 32;
    const binW = (2 * halfW) / BIN_RES, binH = (2 * halfH) / BIN_RES;
    const roofBins = Array.from({ length: BIN_RES * BIN_RES }, () => []);
    for (let ri = 0; ri < roofTris.length; ri++) {
      const rt = roofTris[ri];
      const bx0 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((rt.minX + halfW) / binW)));
      const bx1 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((rt.maxX + halfW) / binW)));
      const by0 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((rt.minY + halfH) / binH)));
      const by1 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((rt.maxY + halfH) / binH)));
      for (let by = by0; by <= by1; by++) {
        for (let bx = bx0; bx <= bx1; bx++) roofBins[by * BIN_RES + bx].push(rt);
      }
    }

    const pointInTri2D = (px, py, a, b, c) => {
      const v0x = c[0] - a[0], v0y = c[1] - a[1];
      const v1x = b[0] - a[0], v1y = b[1] - a[1];
      const v2x = px - a[0], v2y = py - a[1];
      const dot00 = v0x * v0x + v0y * v0y, dot01 = v0x * v1x + v0y * v1y, dot02 = v0x * v2x + v0y * v2y;
      const dot11 = v1x * v1x + v1y * v1y, dot12 = v1x * v2x + v1y * v2y;
      const invDenom = 1 / (dot00 * dot11 - dot01 * dot01 || 1e-9);
      const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
      const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
      return (u >= -0.08) && (v >= -0.08) && (u + v <= 1.08);
    };

    const hasRoofTriAt = (px, py, minZ, maxZ, ownShellId, tol) => {
      const bx0 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((px + halfW) / binW)));
      const by0 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((py + halfH) / binH)));
      const bin = roofBins[by0 * BIN_RES + bx0];
      for (let j = 0; j < bin.length; j++) {
        const rt = bin[j];
        if (ownShellId !== undefined && rt.shellId === ownShellId) continue;
        if (rt.maxZ < minZ - tol || rt.minZ > Math.max(minZ + 0.65, maxZ - 0.02)) continue;
        if (pointInTri2D(px, py, rt.v0, rt.v1, rt.v2)) return true;
      }
      return false;
    };

    const tol = 0.08 / scaleMm;
    const kerfShift = Math.max(0.06, ((ctx && ctx.kerfUnits) || 0.025) * 2.5);
    for (let i = 0; i < buildingBounds.length; i++) {
      const bb = buildingBounds[i];
      if (bb.building && bb.building.btype === 'pier') continue;
      if (bb.isCantileverSupported) continue;

      const ip = bb.interiorPt || [(bb.minX + bb.maxX) * 0.5, (bb.minY + bb.maxY) * 0.5];
      const surfZ = getActualPrintedSurfaceMinZ(ip[0], ip[1]);
      const bBottomZ = (ctx && ctx.baseBottomZ !== undefined) ? ctx.baseBottomZ : -Infinity;
      if ((bb.minZ - surfZ) * scaleMm <= 0.08 || (bb.minZ - bBottomZ) * scaleMm <= 0.08) continue;

      const testPts = [ip];
      if (numTiles > 1) {
        testPts.push(
          [ip[0] + kerfShift, ip[1]],
          [ip[0] - kerfShift, ip[1]],
          [ip[0], ip[1] + kerfShift],
          [ip[0], ip[1] - kerfShift]
        );
      }
      if (Array.isArray(bb.samplePts)) {
        for (let k = 0; k < bb.samplePts.length; k++) testPts.push(bb.samplePts[k]);
      }

      let isRoofSupported = false;
      for (let k = 0; k < testPts.length && !isRoofSupported; k++) {
        isRoofSupported = hasRoofTriAt(testPts[k][0], testPts[k][1], bb.minZ, bb.maxZ, bb.shellId, tol);
      }
      if (!isRoofSupported) floatingBuildingsCount++;
    }
  }

  const isWatertightManifold = (
    openEdgesCount === 0 &&
    nonManifoldEdgesCount === 0 &&
    sameDirDupEdgesCount === 0 &&
    unpairedDirEdgesCount === 0 &&
    negativeWindingCount === 0 &&
    floatingBuildingsCount === 0 &&
    outOfTileTrisCount === 0 &&
    pm.totalVolumeMl > 0
  );

  return {
    ...pm,
    openEdgesCount,
    openEdges: openEdgesCount,
    nonManifoldEdgesCount,
    nonManifoldEdges: nonManifoldEdgesCount,
    sameDirDupEdgesCount,
    sameDirDupEdges: sameDirDupEdgesCount,
    unpairedDirEdgesCount,
    unpairedDirEdges: unpairedDirEdgesCount,
    degenerateTrisCount,
    degenerateTris: degenerateTrisCount,
    negativeWindingCount,
    floatingBuildingsCount,
    floatingCount: floatingBuildingsCount,
    outOfTileTrisCount,
    isWatertightManifold,
    isManifold: isWatertightManifold,
    layerMetrics
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computePrintMetricsAndTopology,
    computeFastVolumeAndExtents,
    auditMeshTopologyNumeric,
    auditMeshTopologyNumericAsync,
    auditMeshTopologyNumericProgressive
  };
}
