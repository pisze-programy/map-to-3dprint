// ============================================================================
// src/mesh_topology.js
// Exact Mathematical Volume (ml), Resin/PLA Mass (g) & Welded Topology Preflight
// ============================================================================

function computePrintMetricsAndTopology(meshes, buildingBounds, state, ctx = {}) {
  const totalWidthMm = (ctx && ctx.totalWidthMm) || (state && state.bedSizeMm) || 320.0;
  const totalHeightMm = (ctx && ctx.totalHeightMm) || (state && state.totalHeightMm) || totalWidthMm;
  const maxDimMm = Math.max(totalWidthMm, totalHeightMm);
  const scaleMm = maxDimMm / 169.2;
  const scaleMm3 = scaleMm * scaleMm * scaleMm;
  const halfW = 84.6 * (totalWidthMm / maxDimMm);
  const halfH = 84.6 * (totalHeightMm / maxDimMm);

  const tileCols = Math.max(1, (ctx && ctx.tileCols) || (state && state.tileCols) || 1);
  const tileRows = Math.max(1, (ctx && ctx.tileRows) || (state && state.tileRows) || 1);
  const numTiles = tileCols * tileRows;
  const tileWidthMm = totalWidthMm / tileCols;
  const tileHeightMm = totalHeightMm / tileRows;
  const tileSpanX = (2 * halfW) / tileCols;
  const tileSpanY = (2 * halfH) / tileRows;

  let totalTriangles = 0;
  const printableKeys = ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted'];
  const tileVolumesMm3 = new Float64Array(numTiles);
  const layerVolumesMm3 = {};
  const layerMetrics = {};

  let maxSceneZ = 3.0;
  let outOfTileTrisCount = 0;
  let openEdgesCount = 0;
  let nonManifoldEdgesCount = 0;
  let sameDirDupEdgesCount = 0;
  let unpairedDirEdgesCount = 0;
  let degenerateTrisCount = 0;
  let negativeWindingCount = 0;
  let floatingBuildingsCount = 0;

  // Measure real welded topology (toFixed(3) mm) across all printable layers
  printableKeys.forEach(k => {
    const arr = (meshes && meshes[k]) || [];
    totalTriangles += arr.length;
    if (state && state.layerVisible && !state.layerVisible[k]) {
      layerVolumesMm3[k] = 0;
      return;
    }
    let lVolScene = 0;
    const vMap = new Map();
    const undEdges = new Map();
    const dirEdges = new Map();
    let nextVid = 0;
    const isMultiShell = (k === 'buildings' || k === 'highlighted');

    const getVid = (pt, bId) => {
      const pfx = isMultiShell ? `${bId ?? 0}_` : '';
      const key = `${pfx}${((pt[0] + halfW) * scaleMm).toFixed(3)}_${((pt[1] + halfH) * scaleMm).toFixed(3)}_${Math.max(0, pt[2] * scaleMm).toFixed(3)}`;
      let id = vMap.get(key);
      if (id === undefined) {
        id = nextVid++;
        vMap.set(key, id);
      }
      return id;
    };

    let lDegenerate = 0;
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      const a = t.v0, b = t.v1, c = t.v2;
      if (a[2] > maxSceneZ) maxSceneZ = a[2];
      if (b[2] > maxSceneZ) maxSceneZ = b[2];
      if (c[2] > maxSceneZ) maxSceneZ = c[2];

      const v6 = (a[0] * (b[1] * c[2] - b[2] * c[1]) -
                  a[1] * (b[0] * c[2] - b[2] * c[0]) +
                  a[2] * (b[0] * c[1] - b[1] * c[0]));
      lVolScene += v6;
      const tid = (t.tileId >= 0 && t.tileId < numTiles) ? t.tileId : 0;
      tileVolumesMm3[tid] += v6;

      const bid = t.buildingId;
      const i0 = getVid(a, bid), i1 = getVid(b, bid), i2 = getVid(c, bid);
      if (i0 === i1 || i1 === i2 || i2 === i0) {
        degenerateTrisCount++;
        lDegenerate++;
        continue;
      }

      const pairs = [[i0, i1], [i1, i2], [i2, i0]];
      for (let e = 0; e < 3; e++) {
        const u = pairs[e][0], v = pairs[e][1];
        const dk = `${u}_${v}`;
        dirEdges.set(dk, (dirEdges.get(dk) || 0) + 1);

        const uk = u < v ? `${u}_${v}` : `${v}_${u}`;
        undEdges.set(uk, (undEdges.get(uk) || 0) + 1);
      }

      if (numTiles > 1) {
        const tcIdx = tid % tileCols, trIdx = Math.floor(tid / tileCols);
        const tx0 = -halfW + tcIdx * tileSpanX - 0.01;
        const tx1 = (tcIdx === tileCols - 1 ? halfW : -halfW + (tcIdx + 1) * tileSpanX) + 0.01;
        const ty0 = -halfH + trIdx * tileSpanY - 0.01;
        const ty1 = (trIdx === tileRows - 1 ? halfH : -halfH + (trIdx + 1) * tileSpanY) + 0.01;
        for (const v of [a, b, c]) {
          if (v[0] < tx0 || v[0] > tx1 || v[1] < ty0 || v[1] > ty1) {
            outOfTileTrisCount++;
            break;
          }
        }
      }
    }

    let lOpen = 0;
    let lNonMan = 0;
    for (const [, c] of undEdges) {
      if (c === 1) { openEdgesCount++; lOpen++; }
      else if (c > 2) { nonManifoldEdgesCount++; lNonMan++; }
    }

    let lDupDir = 0;
    let lUnpaired = 0;
    for (const [k, c] of dirEdges) {
      if (c > 1) { sameDirDupEdgesCount++; lDupDir++; }
      const [u, v] = k.split('_');
      const rev = dirEdges.get(`${v}_${u}`) || 0;
      if (rev !== c) { unpairedDirEdgesCount++; lUnpaired++; }
    }

    if (arr.length > 0 && lVolScene < -1e-3) {
      negativeWindingCount++;
    }
    const lVolMm3 = Math.max(0, (lVolScene / 6.0) * scaleMm3);
    layerVolumesMm3[k] = lVolMm3;
    layerMetrics[k] = {
      triangles: arr.length,
      degenerateTris: lDegenerate,
      openEdges: lOpen,
      nonManifoldEdges: lNonMan,
      sameDirDupEdges: lDupDir,
      unpairedDirEdges: lUnpaired,
      volumeMl: lVolMm3 / 1000.0
    };
  });

  // Measure real building ground clearance against actual printed surface or lower tier roofs
  const getActualPrintedSurfaceMinZ = ctx && ctx.getActualPrintedSurfaceMinZ;
  if (typeof getActualPrintedSurfaceMinZ === 'function' && Array.isArray(buildingBounds)) {
    // Collect upward-facing building roof triangles (tri.n[2] > 0.5)
    const roofTris = [];
    const bldgTris = [...(meshes.buildings || []), ...(meshes.highlighted || [])];
    for (let ti = 0; ti < bldgTris.length; ti++) {
      const t = bldgTris[ti];
      if (t.n && t.n[2] > 0.5) {
        const a = t.v0, b = t.v1, c = t.v2;
        roofTris.push({
          v0: a, v1: b, v2: c,
          buildingId: t.buildingId,
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
    const binW = (2 * halfW) / BIN_RES;
    const binH = (2 * halfH) / BIN_RES;
    const roofBins = Array.from({ length: BIN_RES * BIN_RES }, () => []);
    for (let ri = 0; ri < roofTris.length; ri++) {
      const rt = roofTris[ri];
      const bx0 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((rt.minX + halfW) / binW)));
      const bx1 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((rt.maxX + halfW) / binW)));
      const by0 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((rt.minY + halfH) / binH)));
      const by1 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((rt.maxY + halfH) / binH)));
      for (let by = by0; by <= by1; by++) {
        for (let bx = bx0; bx <= bx1; bx++) {
          roofBins[by * BIN_RES + bx].push(rt);
        }
      }
    }

    function pointInTri2D(px, py, a, b, c) {
      const v0x = c[0] - a[0], v0y = c[1] - a[1];
      const v1x = b[0] - a[0], v1y = b[1] - a[1];
      const v2x = px - a[0], v2y = py - a[1];
      const dot00 = v0x * v0x + v0y * v0y;
      const dot01 = v0x * v1x + v0y * v1y;
      const dot02 = v0x * v2x + v0y * v2y;
      const dot11 = v1x * v1x + v1y * v1y;
      const dot12 = v1x * v2x + v1y * v2y;
      const invDenom = 1 / (dot00 * dot11 - dot01 * dot01 || 1e-9);
      const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
      const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
      return (u >= -0.05) && (v >= -0.05) && (u + v <= 1.05);
    }

    const tol = 0.06 / scaleMm;

    for (let i = 0; i < buildingBounds.length; i++) {
      const bb = buildingBounds[i];
      if (bb.building && bb.building.btype === 'pier') continue;
      const cx = (bb.minX + bb.maxX) * 0.5, cy = (bb.minY + bb.maxY) * 0.5;
      let surfZ = getActualPrintedSurfaceMinZ(cx, cy);
      if (bb.building && bb.building.outer) {
        for (let pt of bb.building.outer) {
          const sz = getActualPrintedSurfaceMinZ(pt[0], pt[1]);
          if (sz > surfZ) surfZ = sz;
        }
      }

      // Check 1: Supported on ground/water surface or solid base slab
      const bBottomZ = (ctx && ctx.baseBottomZ !== undefined) ? ctx.baseBottomZ : -Infinity;
      if ((bb.minZ - surfZ) * scaleMm <= 0.05 || (bb.minZ - bBottomZ) * scaleMm <= 0.05) {
        continue;
      }

      // Check 2: Supported on lower building tier roof
      let isRoofSupported = false;
      const bx0 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((bb.minX + halfW) / binW)));
      const bx1 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((bb.maxX + halfW) / binW)));
      const by0 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((bb.minY + halfH) / binH)));
      const by1 = Math.max(0, Math.min(BIN_RES - 1, Math.floor((bb.maxY + halfH) / binH)));
      for (let by = by0; by <= by1; by++) {
        for (let bx = bx0; bx <= bx1; bx++) {
          const bin = roofBins[by * BIN_RES + bx];
          for (let j = 0; j < bin.length; j++) {
            const rt = bin[j];
            if (rt.maxZ < bb.minZ - tol || rt.minZ > bb.minZ + tol) continue;
            if (!(rt.maxX < bb.minX - 0.1 || rt.minX > bb.maxX + 0.1 || rt.maxY < bb.minY - 0.1 || rt.minY > bb.maxY + 0.1)) {
              isRoofSupported = true;
              break;
            }
          }
          if (isRoofSupported) break;
        }
        if (isRoofSupported) break;
      }

      if (!isRoofSupported) {
        floatingBuildingsCount++;
      }
    }
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

  // Photon Mono 4 build envelope: 153.4 x 87.0 x 165.0 mm (with 0.05 mm safety allowance, checking XY orientation)
  const fitsPhotonMono4 = (
    ((tileWidthMm <= 153.45 && tileHeightMm <= 87.05) ||
     (tileHeightMm <= 153.45 && tileWidthMm <= 87.05)) &&
    (maxZMm <= 165.0)
  );

  const isWatertightManifold = (
    openEdgesCount === 0 &&
    nonManifoldEdgesCount === 0 &&
    sameDirDupEdgesCount === 0 &&
    unpairedDirEdgesCount === 0 &&
    negativeWindingCount === 0 &&
    floatingBuildingsCount === 0 &&
    outOfTileTrisCount === 0 &&
    totalVolumeMl > 0
  );

  const printMetrics = {
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
    hasDrainChannels: hollowBase,
    fitsPhotonMono4,
    isWatertightManifold,
    isManifold: isWatertightManifold,
    frameExcludedFromExport: !(state && state.exportFrame),
    layerMetrics
  };

  return { meshes, buildingBounds, totalTriangles, printMetrics };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computePrintMetricsAndTopology };
}
