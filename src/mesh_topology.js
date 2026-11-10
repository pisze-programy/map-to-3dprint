// ============================================================================
// src/mesh_topology.js
// Exact Mathematical Volume (ml), Resin/PLA Mass (g) & Welded Topology Preflight
// ============================================================================

function computePrintMetricsAndTopology(meshes, buildingBounds, state, ctx) {
  const {
    totalWidthMm,
    tileCols,
    tileRows,
    cellsPerCol,
    cellsPerRow,
    cellStep,
    hollowBase,
    vaultSavedSceneVol,
    getActualPrintedSurfaceMinZ
  } = ctx;
  let totalTriangles = 0;
  const printableKeys = ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted'];
  const scaleMm = totalWidthMm / 169.2;
  const scaleMm3 = scaleMm * scaleMm * scaleMm;

  const numTiles = tileCols * tileRows;
  const tileVolumesMm3 = new Float64Array(numTiles);
  const layerVolumesMm3 = {};
  let maxSceneZ = 3.0;
  let outOfTileTrisCount = 0;
  let openEdgesCount = 0;
  let nonManifoldEdgesCount = 0;
  let negativeWindingCount = 0;
  let floatingBuildingsCount = 0;

  // Measure real welded topology (toFixed(3) mm) across all printable layers
  printableKeys.forEach(k => {
    const arr = meshes[k] || [];
    totalTriangles += arr.length;
    if (state.layerVisible && !state.layerVisible[k]) {
      layerVolumesMm3[k] = 0;
      return;
    }
    let lVolScene = 0;
    const vMap = new Map();
    const edgeCounts = new Map();
    let nextVid = 0;
    const getVid = (pt) => {
      const key = `${((pt[0] + 84.6) * scaleMm).toFixed(3)}_${((pt[1] + 84.6) * scaleMm).toFixed(3)}_${Math.max(0, pt[2] * scaleMm).toFixed(3)}`;
      let id = vMap.get(key);
      if (id === undefined) {
        id = nextVid++;
        vMap.set(key, id);
      }
      return id;
    };

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

      const i0 = getVid(a), i1 = getVid(b), i2 = getVid(c);
      if (i0 !== i1 && i1 !== i2 && i2 !== i0) {
        const pairs = [[i0, i1], [i1, i2], [i2, i0]];
        for (let e = 0; e < 3; e++) {
          const u = pairs[e][0], v = pairs[e][1];
          const ek = u < v ? `${u}_${v}` : `${v}_${u}`;
          edgeCounts.set(ek, (edgeCounts.get(ek) || 0) + 1);
        }
      }

      if (numTiles > 1) {
        const tcIdx = tid % tileCols, trIdx = Math.floor(tid / tileCols);
        const tx0 = -84.6 + tcIdx * cellsPerCol * cellStep - 0.01;
        const tx1 = (tcIdx === tileCols - 1 ? 84.6 : -84.6 + (tcIdx + 1) * cellsPerCol * cellStep) + 0.01;
        const ty0 = -84.6 + trIdx * cellsPerRow * cellStep - 0.01;
        const ty1 = (trIdx === tileRows - 1 ? 84.6 : -84.6 + (trIdx + 1) * cellsPerRow * cellStep) + 0.01;
        for (const v of [a, b, c]) {
          if (v[0] < tx0 || v[0] > tx1 || v[1] < ty0 || v[1] > ty1) {
            outOfTileTrisCount++;
            break;
          }
        }
      }
    }

    for (const c of edgeCounts.values()) {
      if (c === 1) openEdgesCount++;
      else if (c > 2) nonManifoldEdgesCount++;
    }
    if (arr.length > 0 && lVolScene < -1e-3) {
      negativeWindingCount++;
    }
    layerVolumesMm3[k] = Math.max(0, (lVolScene / 6.0) * scaleMm3);
  });

  // Measure real building ground clearance against actual printed surface
  for (let i = 0; i < buildingBounds.length; i++) {
    const bb = buildingBounds[i];
    const cx = (bb.minX + bb.maxX) * 0.5, cy = (bb.minY + bb.maxY) * 0.5;
    const surfZ = getActualPrintedSurfaceMinZ(cx, cy);
    if ((bb.minZ - surfZ) * scaleMm > 0.05) {
      floatingBuildingsCount++;
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
  const solidReferenceMl = totalVolumeMl + (vaultSavedSceneVol * scaleMm3) / 1000.0;
  const hollowSavingsPct = hollowBase && solidReferenceMl > 0
    ? Math.round(((solidReferenceMl - totalVolumeMl) / solidReferenceMl) * 100)
    : 0;

  const maxZMm = Math.max(6.0, maxSceneZ * scaleMm);
  const tileWidthMm = totalWidthMm / tileCols;
  const tileHeightMm = (state.totalHeightMm || totalWidthMm) / tileRows;
  const maxTileVolumeMl = tileVolumesMl.length ? Math.max(...tileVolumesMl) : totalVolumeMl;

  // Fix R9: Remove artificial 2200.0 ml check from fitsPhotonMono4; compute isWatertightManifold from real welded topology!
  const printMetrics = {
    totalVolumeMl,
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
    openEdgesCount,
    nonManifoldEdgesCount,
    negativeWindingCount,
    floatingBuildingsCount,
    outOfTileTrisCount,
    hasDrainChannels: hollowBase,
    fitsPhotonMono4: (tileWidthMm <= 153.4 + 0.05) && (tileHeightMm <= 87.0 + 0.05) && (maxZMm <= 165.0),
    isWatertightManifold: (
      openEdgesCount === 0 &&
      nonManifoldEdgesCount === 0 &&
      negativeWindingCount === 0 &&
      floatingBuildingsCount === 0 &&
      outOfTileTrisCount === 0 &&
      totalVolumeMl > 0
    ),
    frameExcludedFromExport: true
  };

  return { meshes, buildingBounds, totalTriangles, printMetrics };
}
