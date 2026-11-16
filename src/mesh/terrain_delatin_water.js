// ============================================================================
// src/mesh/terrain_delatin_water.js
// Adaptive Delatin TIN Terrain Mesh & Shim -> src/Water/water_carve_manifold.js
// ============================================================================

(function (root) {
  function _getCore() {
    if (typeof getManifoldLib === 'function' && typeof clipperUnionPolys === 'function') {
      return {
        getVendorDeps, signedArea2D, ensureWinding,
        clipperUnionPolys, clipperIntersectPolys, clipperDiffPolys, clipperOffsetPolys,
        clipperBufferOpenPaths, ringsToOutersWithHoles, safeDeleteManifold,
        batchUnionManifolds, extrudeRingSolid, manifoldFromRawSoup, boxManifoldFromBounds
      };
    }
    return require('../geometry/manifold_core.js');
  }

  function buildDelatinTerrainManifold(ctx, minX, maxX, minY, maxY) {
    const core = _getCore(), { mf } = ctx, { Delatin } = core.getVendorDeps();
    if (ctx.elevReliefM <= 0.35 || typeof Delatin !== 'function') {
      return core.boxManifoldFromBounds(mf, minX, maxX, minY, maxY, 0.0, ctx.zLandDatum);
    }
    const nx = 65, ny = 65, spanX = maxX - minX, spanY = maxY - minY, gridZ = new Float64Array(nx * ny);
    for (let iy = 0; iy < ny; iy++) {
      const wy = minY + (iy / (ny - 1)) * spanY;
      for (let ix = 0; ix < nx; ix++) {
        gridZ[iy * nx + ix] = Math.max(0.4, ctx.elevToZ(ctx.sampleDemElevM(minX + (ix / (nx - 1)) * spanX, wy)));
      }
    }
    const buildGridSolidFallback = () => {
      const pos = [], tris = [], idx = (ix, iy) => iy * nx + ix, bIdx = (ix, iy) => nx * ny + iy * nx + ix;
      for (const zZero of [false, true]) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
        pos.push(minX + (ix / (nx - 1)) * spanX, minY + (iy / (ny - 1)) * spanY, zZero ? 0.0 : gridZ[idx(ix, iy)]);
      }
      for (let iy = 0; iy < ny - 1; iy++) for (let ix = 0; ix < nx - 1; ix++) {
        const a = idx(ix, iy), b = idx(ix + 1, iy), c = idx(ix + 1, iy + 1), d = idx(ix, iy + 1);
        const ba = bIdx(ix, iy), bb = bIdx(ix + 1, iy), bc = bIdx(ix + 1, iy + 1), bd = bIdx(ix, iy + 1);
        tris.push(a, b, c, a, c, d, ba, bc, bb, ba, bd, bc);
      }
      for (let ix = 0; ix < nx - 1; ix++) {
        tris.push(bIdx(ix, 0), bIdx(ix + 1, 0), idx(ix + 1, 0), bIdx(ix, 0), idx(ix + 1, 0), idx(ix, 0));
        tris.push(bIdx(ix + 1, ny - 1), bIdx(ix, ny - 1), idx(ix, ny - 1), bIdx(ix + 1, ny - 1), idx(ix, ny - 1), idx(ix + 1, ny - 1));
      }
      for (let iy = 0; iy < ny - 1; iy++) {
        tris.push(bIdx(0, iy + 1), bIdx(0, iy), idx(0, iy), bIdx(0, iy + 1), idx(0, iy), idx(0, iy + 1));
        tris.push(bIdx(nx - 1, iy), bIdx(nx - 1, iy + 1), idx(nx - 1, iy + 1), bIdx(nx - 1, iy), idx(nx - 1, iy + 1), idx(nx - 1, iy));
      }
      return core.manifoldFromRawSoup(mf, new Float32Array(pos), new Uint32Array(tris), 1e-5);
    };
    try {
      const tin = new Delatin(gridZ, nx, ny);
      tin.run(Math.max(0.03, 0.08 / ctx.scaleMm));
      const { coords: tc, triangles: tt } = tin, nTop = Math.floor(tc.length / 2);
      if (nTop >= 4 && tt.length >= 6) {
        const topXYZ = [];
        for (let i = 0; i < nTop; i++) {
          const gx = tc[i * 2], gy = tc[i * 2 + 1];
          topXYZ.push(minX + (gx / (nx - 1)) * spanX, minY + (gy / (ny - 1)) * spanY, gridZ[Math.max(0, Math.min(ny - 1, Math.round(gy))) * nx + Math.max(0, Math.min(nx - 1, Math.round(gx)))]);
        }
        const dirEdgeCount = new Map(), directedTris = [];
        for (let t = 0; t < tt.length; t += 3) {
          let a = tt[t], b = tt[t + 1], c = tt[t + 2];
          const cross2 = (topXYZ[b * 3] - topXYZ[a * 3]) * (topXYZ[c * 3 + 1] - topXYZ[a * 3 + 1]) - (topXYZ[b * 3 + 1] - topXYZ[a * 3 + 1]) * (topXYZ[c * 3] - topXYZ[a * 3]);
          if (Math.abs(cross2) < 1e-10) continue;
          if (cross2 < 0) { const tmp = b; b = c; c = tmp; }
          directedTris.push(a, b, c);
          for (const [u, v] of [[a, b], [b, c], [c, a]]) {
            if (dirEdgeCount.has(`${v}:${u}`)) dirEdgeCount.delete(`${v}:${u}`); else dirEdgeCount.set(`${u}:${v}`, [u, v]);
          }
        }
        const boundaryEdges = Array.from(dirEdgeCount.values());
        if (boundaryEdges.length >= 4) {
          const pos = topXYZ.slice(), tris = directedTris.slice(), botMap = new Map(), centerBotIdx = pos.length / 3;
          const getBotVert = (ti) => { if (!botMap.has(ti)) { botMap.set(ti, pos.length / 3); pos.push(pos[ti * 3], pos[ti * 3 + 1], 0.0); } return botMap.get(ti); };
          pos.push((minX + maxX) * 0.5, (minY + maxY) * 0.5, 0.0);
          for (const [u, v] of boundaryEdges) { const bu = getBotVert(u), bv = getBotVert(v); tris.push(u, bu, bv, u, bv, v, centerBotIdx, bv, bu); }
          const man = core.manifoldFromRawSoup(mf, new Float32Array(pos), new Uint32Array(tris), 1e-5);
          if (man && man.numTri() > 0) return man;
        }
      }
    } catch (_) {}
    return buildGridSolidFallback();
  }

  const _carveMod = (typeof root.buildLayer1WaterAndCarve === 'function')
    ? { buildLayer1WaterAndCarve: root.buildLayer1WaterAndCarve }
    : require('../Water/water_carve_manifold.js');

  const exportsObj = {
    buildDelatinTerrainManifold,
    buildLayer1WaterAndCarve: _carveMod.buildLayer1WaterAndCarve
  };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
