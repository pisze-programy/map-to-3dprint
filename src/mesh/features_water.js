// ============================================================================
// src/mesh/features_water.js
// Sub-Cell Smooth Water Basin Mesh Layer (Boundary Walls, Full Cells & Sub-Cell Cuts)
// ============================================================================

if (typeof pushTri === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
  Object.assign(global, require('./mesh_primitives.js'));
}

function getWaterBasinLevels(ctx, state) {
  const zWaterBot = ctx.zSubWater;
  const deepWaterZ = ctx.deepWaterZ;
  const waterSurfZ = (state.layerVisible && state.layerVisible.water === false) ? ctx.zSubWater : ctx.deepWaterZ;
  return { zWaterBot, deepWaterZ, waterSurfZ };
}

function emitWaterBoundaryWall(ctx, meshes, waterLevels, ax, ay, vA, bx, by, vB, norm, tileId) {
  const { baseBottomZ } = ctx;
  const { zWaterBot, deepWaterZ } = waterLevels;
  if (vA >= baseBottomZ && vB >= baseBottomZ) return;
  const pA = { x: ax, y: ay, v: vA }, pB = { x: bx, y: by, v: vB };
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

function emitFullWaterBasinCell(meshes, waterLevels, x0, y0, x1, y1, tileId) {
  const { zWaterBot, deepWaterZ } = waterLevels;
  pushQuad(meshes.water, [x0, y0, deepWaterZ], [x1, y0, deepWaterZ], [x1, y1, deepWaterZ], [x0, y1, deepWaterZ], [0, 0, 1], 0, -1, tileId);
  pushQuad(meshes.water, [x0, y0, zWaterBot], [x0, y1, zWaterBot], [x1, y1, zWaterBot], [x1, y0, zWaterBot], [0, 0, -1], 0, -1, tileId);
}

function emitSubWaterBasinCell(ctx, meshes, waterLevels, cellTri, riserNorm, tileId, cellTerraceList) {
  const { baseBottomZ, zSubWater } = ctx;
  const { zWaterBot, deepWaterZ, waterSurfZ } = waterLevels;
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
    cellTerraceList.push({ poly: swp.map(pt => [pt.x, pt.y]), zSurf: waterSurfZ, tileId });
    for (const [cA, cB] of subWater.cuts) {
      pushQuad(meshes.water, [cA.x, cA.y, zWaterBot], [cB.x, cB.y, zWaterBot], [cB.x, cB.y, deepWaterZ], [cA.x, cA.y, deepWaterZ], riserNorm, 0, -1, tileId);
    }
  }
}

const emitWaterBasinLayer = {
  getWaterBasinLevels,
  emitWaterBoundaryWall,
  emitFullWaterBasinCell,
  emitSubWaterBasinCell
};

if (typeof window !== 'undefined') {
  window.getWaterBasinLevels = getWaterBasinLevels;
  window.emitWaterBoundaryWall = emitWaterBoundaryWall;
  window.emitFullWaterBasinCell = emitFullWaterBasinCell;
  window.emitSubWaterBasinCell = emitSubWaterBasinCell;
  window.emitWaterBasinLayer = emitWaterBasinLayer;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getWaterBasinLevels,
    emitWaterBoundaryWall,
    emitFullWaterBasinCell,
    emitSubWaterBasinCell,
    emitWaterBasinLayer
  };
}
