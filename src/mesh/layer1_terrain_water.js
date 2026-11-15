// ============================================================================
// src/mesh/layer1_terrain_water.js
// Layer-1 Terrain, Water, Coastline & Ground Road/Park Planar Solvers
// - Continuous Adaptive Delatin TIN Terrain (Zero Staircase Facets)
// - Clipper2 Exact Vector Union/Difference for Water, Roads, Plazas & Parks
// - Terrain-Conformal CSG Road & Park Draping + waterCutout Islet Guard
// ============================================================================

(function (root) {
  function _getCore() {
    if (typeof createBuildContext === 'function') return root;
    if (typeof require !== 'undefined') return require('../geometry/manifold_core.js');
    return root;
  }

  function _ringAreaAbs(ring) {
    if (!ring || ring.length < 3) return 0;
    let s = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) * 0.5;
  }

  function _ptInRing(px, py, ring) {
    if (!ring || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  function _ringBBox(ring) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    return [minX, minY, maxX, maxY];
  }

  function _bboxOverlaps(a, b, pad = 0) {
    return a[0] <= b[2] + pad && a[2] >= b[0] - pad && a[1] <= b[3] + pad && a[3] >= b[1] - pad;
  }

  // Build watertight closed TIN terrain solid down to z = 0.0
  function buildDelatinTerrainManifold(ctx, minX, maxX, minY, maxY) {
    const core = _getCore();
    const { mf } = ctx;
    const { Delatin } = core.getVendorDeps();

    if (ctx.elevReliefM <= 0.35 || typeof Delatin !== 'function') {
      return core.boxManifoldFromBounds(mf, minX, maxX, minY, maxY, 0.0, ctx.zLandDatum);
    }

    const nx = 65;
    const ny = 65;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const gridZ = new Float64Array(nx * ny);
    for (let iy = 0; iy < ny; iy++) {
      const wy = minY + (iy / (ny - 1)) * spanY;
      for (let ix = 0; ix < nx; ix++) {
        const wx = minX + (ix / (nx - 1)) * spanX;
        const elevM = ctx.sampleDemElevM(wx, wy);
        gridZ[iy * nx + ix] = Math.max(0.4, ctx.elevToZ(elevM));
      }
    }

    const buildGridSolidFallback = () => {
      const pos = [];
      const tris = [];
      const idx = (ix, iy) => iy * nx + ix;
      for (let iy = 0; iy < ny; iy++) {
        const wy = minY + (iy / (ny - 1)) * spanY;
        for (let ix = 0; ix < nx; ix++) {
          const wx = minX + (ix / (nx - 1)) * spanX;
          pos.push(wx, wy, gridZ[idx(ix, iy)]);
        }
      }
      const topVerts = pos.length / 3;
      for (let iy = 0; iy < ny; iy++) {
        const wy = minY + (iy / (ny - 1)) * spanY;
        for (let ix = 0; ix < nx; ix++) {
          const wx = minX + (ix / (nx - 1)) * spanX;
          pos.push(wx, wy, 0.0);
        }
      }
      const bIdx = (ix, iy) => topVerts + iy * nx + ix;
      for (let iy = 0; iy < ny - 1; iy++) {
        for (let ix = 0; ix < nx - 1; ix++) {
          const a = idx(ix, iy), b = idx(ix + 1, iy), c = idx(ix + 1, iy + 1), d = idx(ix, iy + 1);
          tris.push(a, b, c, a, c, d);
          const ba = bIdx(ix, iy), bb = bIdx(ix + 1, iy), bc = bIdx(ix + 1, iy + 1), bd = bIdx(ix, iy + 1);
          tris.push(ba, bc, bb, ba, bd, bc);
        }
      }
      for (let ix = 0; ix < nx - 1; ix++) {
        // South border (y = minY, normal -Y)
        tris.push(bIdx(ix, 0), bIdx(ix + 1, 0), idx(ix + 1, 0), bIdx(ix, 0), idx(ix + 1, 0), idx(ix, 0));
        // North border (y = maxY, normal +Y)
        const ny1 = ny - 1;
        tris.push(bIdx(ix + 1, ny1), bIdx(ix, ny1), idx(ix, ny1), bIdx(ix + 1, ny1), idx(ix, ny1), idx(ix + 1, ny1));
      }
      for (let iy = 0; iy < ny - 1; iy++) {
        // West border (x = minX, normal -X)
        tris.push(bIdx(0, iy + 1), bIdx(0, iy), idx(0, iy), bIdx(0, iy + 1), idx(0, iy), idx(0, iy + 1));
        // East border (x = maxX, normal +X)
        const nx1 = nx - 1;
        tris.push(bIdx(nx1, iy), bIdx(nx1, iy + 1), idx(nx1, iy + 1), bIdx(nx1, iy), idx(nx1, iy + 1), idx(nx1, iy));
      }
      return core.manifoldFromRawSoup(mf, new Float32Array(pos), new Uint32Array(tris), 1e-5);
    };

    try {
      const tin = new Delatin(gridZ, nx, ny);
      const maxErrU = Math.max(0.03, (ctx.isResin ? 0.08 : 0.16) / ctx.scaleMm);
      tin.run(maxErrU);
      const tinCoords = tin.coords;
      const tinTris = tin.triangles;
      const nTopPts = Math.floor(tinCoords.length / 2);
      if (nTopPts < 4 || tinTris.length < 6) return buildGridSolidFallback();

      // Remap Delaunay triangles into world XYZ and verify CCW upward winding (+Z)
      const topXYZ = [];
      for (let i = 0; i < nTopPts; i++) {
        const gx = tinCoords[i * 2];
        const gy = tinCoords[i * 2 + 1];
        const wx = minX + (gx / (nx - 1)) * spanX;
        const wy = minY + (gy / (ny - 1)) * spanY;
        const ix = Math.max(0, Math.min(nx - 1, Math.round(gx)));
        const iy = Math.max(0, Math.min(ny - 1, Math.round(gy)));
        const wz = gridZ[iy * nx + ix];
        topXYZ.push(wx, wy, wz);
      }

      // Extract boundary half-edges directly from TIN so side walls + bottom fan share 100% exact vertices
      const dirEdgeCount = new Map();
      const directedTris = [];
      for (let t = 0; t < tinTris.length; t += 3) {
        let a = tinTris[t], b = tinTris[t + 1], c = tinTris[t + 2];
        const ax = topXYZ[a * 3], ay = topXYZ[a * 3 + 1];
        const bx = topXYZ[b * 3], by = topXYZ[b * 3 + 1];
        const cx = topXYZ[c * 3], cy = topXYZ[c * 3 + 1];
        const cross2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (Math.abs(cross2) < 1e-10) continue;
        if (cross2 < 0) { const tmp = b; b = c; c = tmp; }
        directedTris.push(a, b, c);
        const edges = [[a, b], [b, c], [c, a]];
        for (let k = 0; k < 3; k++) {
          const u = edges[k][0], v = edges[k][1];
          const rev = `${v}:${u}`;
          if (dirEdgeCount.has(rev)) {
            dirEdgeCount.delete(rev);
          } else {
            dirEdgeCount.set(`${u}:${v}`, [u, v]);
          }
        }
      }

      const boundaryEdges = Array.from(dirEdgeCount.values());
      if (boundaryEdges.length < 4) return buildGridSolidFallback();

      const pos = topXYZ.slice();
      const tris = directedTris.slice();
      const botMap = new Map();
      const getBotVert = (topIdx) => {
        let bi = botMap.get(topIdx);
        if (bi === undefined) {
          bi = pos.length / 3;
          pos.push(pos[topIdx * 3], pos[topIdx * 3 + 1], 0.0);
          botMap.set(topIdx, bi);
        }
        return bi;
      };

      const centerBotIdx = pos.length / 3;
      pos.push((minX + maxX) * 0.5, (minY + maxY) * 0.5, 0.0);

      for (let i = 0; i < boundaryEdges.length; i++) {
        const [u, v] = boundaryEdges[i];
        const bu = getBotVert(u);
        const bv = getBotVert(v);
        // Outward wall facing outside rectangle
        tris.push(u, bu, bv, u, bv, v);
        // Bottom cap facing -Z (reverse edge orientation relative to top CCW)
        tris.push(centerBotIdx, bv, bu);
      }

      const man = core.manifoldFromRawSoup(mf, new Float32Array(pos), new Uint32Array(tris), 1e-5);
      if (man && man.numTri() > 0) return man;
    } catch (_) {}

    return buildGridSolidFallback();
  }

  function _collectProtectedIsletSeedPts(ctx, scene) {
    const seeds = [];
    const { toBed } = ctx;
    for (const b of (scene && scene.buildings) || []) {
      if (!b || b.hidden || b.isOutline || !b.outer || b.outer.length < 3) continue;
      let sx = 0, sy = 0;
      for (const p of b.outer) {
        const bp = toBed(p);
        sx += bp[0]; sy += bp[1];
      }
      seeds.push([sx / b.outer.length, sy / b.outer.length]);
    }
    for (const rd of (scene && scene.roads) || []) {
      if (!rd || !rd.pts || rd.pts.length < 2) continue;
      if (rd.bridge || rd.isBridge || rd.man_made) {
        for (const p of rd.pts) seeds.push(toBed(p));
      }
    }
    return seeds;
  }

  function _buildClippedPolysExtrude(core, mf, polyPairs, zBot, zTop, clipRectPolys) {
    if (!polyPairs || polyPairs.length === 0) return null;
    const flatRings = [];
    for (let i = 0; i < polyPairs.length; i++) {
      const pp = polyPairs[i];
      if (!pp.outer || pp.outer.length < 3) continue;
      flatRings.push(pp.outer);
      for (let h = 0; h < (pp.holes || []).length; h++) {
        flatRings.push(pp.holes[h]);
      }
    }
    // Note: intersect outer contours against plate bounds safely in 2D first
    const clippedPolys = [];
    for (let i = 0; i < polyPairs.length; i++) {
      const pp = polyPairs[i];
      let outers = core.clipperIntersectPolys([pp.outer], clipRectPolys, 1e-5);
      if (pp.holes && pp.holes.length > 0 && outers.length > 0) {
        outers = core.clipperDiffPolys(outers, pp.holes, 1e-5);
      }
      for (let k = 0; k < outers.length; k++) clippedPolys.push(outers[k]);
    }
    if (clippedPolys.length === 0) return null;

    const unioned = core.clipperUnionPolys(clippedPolys, 1e-5);
    const structured = core.ringsToOutersWithHoles(unioned, 6e-4);
    if (structured.length === 0) return null;

    const solids = [];
    for (let i = 0; i < structured.length; i++) {
      const cleanOuter = core.ensureWinding(structured[i].outer, true, 6e-4);
      if (cleanOuter.length < 3) continue;
      const cleanHoles = (structured[i].holes || [])
        .map(h => core.ensureWinding(h, false, 6e-4))
        .filter(h => h.length >= 3);
      const m = core.extrudeRingSolid(mf, cleanOuter, cleanHoles, zBot, zTop);
      if (m) solids.push(m);
    }
    return core.batchUnionManifolds(mf, solids);
  }

  function _regularizePolys2D(core, groups, minEdge = 6e-4, openEps = 3.5e-4) {
    const out = [];
    for (let gi = 0; gi < (groups || []).length; gi++) {
      const g = groups[gi];
      if (!g || !g.outer || g.outer.length < 3) continue;
      const oClean = core.ensureWinding(g.outer, true, minEdge);
      if (oClean.length < 3) continue;
      try {
        const shrunk = core.clipperOffsetPolys([oClean], -openEps, 'Miter', 1e-5)
          .map(r => core.ensureWinding(r, true, minEdge))
          .filter(r => r.length >= 3);
        const expHoles = [];
        for (let hi = 0; hi < (g.holes || []).length; hi++) {
          const hCCW = core.ensureWinding(g.holes[hi], true, minEdge);
          if (hCCW.length < 3) continue;
          const off = core.clipperOffsetPolys([hCCW], openEps, 'Miter', 1e-5);
          for (let oi = 0; oi < off.length; oi++) {
            const c = core.ensureWinding(off[oi], true, minEdge);
            if (c.length >= 3) expHoles.push(c);
          }
        }
        const diff = expHoles.length > 0 && shrunk.length > 0
          ? core.clipperDiffPolys(shrunk, expHoles, 1e-5)
          : shrunk;
        const reg = core.ringsToOutersWithHoles(diff, minEdge);
        for (let ri = 0; ri < reg.length; ri++) {
          const ro = core.ensureWinding(reg[ri].outer, true, minEdge);
          if (ro.length < 3 || _ringAreaAbs(ro) < 1e-4) continue;
          const rh = (reg[ri].holes || [])
            .map(h => core.ensureWinding(h, false, minEdge))
            .filter(h => h.length >= 3 && _ringAreaAbs(h) >= 1e-4);
          out.push({ outer: ro, holes: rh, area: _ringAreaAbs(ro) });
        }
      } catch (_) {
        out.push({ outer: oClean, holes: g.holes || [], area: _ringAreaAbs(oClean) });
      }
    }
    return out;
  }

  function buildLayer1TerrainAndWater(ctx, scene, options = {}) {
    const core = _getCore();
    const { mf, halfW, halfH, toBed, scaleToBed, scaleMm, waterCutout } = ctx;

    const padU = 0.25;
    const minX = -halfW - padU, maxX = halfW + padU;
    const minY = -halfH - padU, maxY = halfH + padU;
    const plateClipPoly = [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]];

    // 1. Continuous adaptive TIN terrain base down to Z = 0.0
    let terrainManifold = buildDelatinTerrainManifold(ctx, minX, maxX, minY, maxY);

    // 2. Gather exact Clipper2 water shapes (waterPolys + waterLines)
    const protectedSeeds = _collectProtectedIsletSeedPts(ctx, scene);
    const minIsletMm2 = (ctx.cfg && ctx.cfg.minCutoutIsletMm2) || 6.0;
    const minIsletU2 = minIsletMm2 / (scaleMm * scaleMm);

    const waterOuterList = [];
    for (const wp of (scene && scene.waterPolys) || []) {
      if (!wp || !wp.outer || wp.outer.length < 3) continue;
      const oBed = wp.outer.map(toBed);
      const holesBed = (wp.holes || [])
        .filter(h => h && h.length >= 3)
        .map(h => h.map(toBed))
        .filter(h => {
          if (!waterCutout) return true;
          const a = _ringAreaAbs(h);
          if (a >= minIsletU2) return true;
          const bb = _ringBBox(h);
          for (let s = 0; s < protectedSeeds.length; s++) {
            const pt = protectedSeeds[s];
            if (pt[0] >= bb[0] && pt[0] <= bb[2] && pt[1] >= bb[1] && pt[1] <= bb[3] && _ptInRing(pt[0], pt[1], h)) {
              return true;
            }
          }
          return false;
        });

      const clippedOuters = core.clipperIntersectPolys([oBed], plateClipPoly, 1e-5);
      if (clippedOuters.length === 0) continue;
      const finalRegions = holesBed.length > 0
        ? core.clipperDiffPolys(clippedOuters, holesBed, 1e-5)
        : clippedOuters;
      for (let i = 0; i < finalRegions.length; i++) waterOuterList.push(finalRegions[i]);
    }

    const wlPaths = [];
    for (const wl of (scene && scene.waterLines) || []) {
      if (!wl || !wl.pts || wl.pts.length < 2) continue;
      const bedPts = wl.pts.map(toBed);
      const halfWidth = Math.max(ctx.minPrintU * 0.65, ((wl.width || 0.7) * 0.5) * scaleToBed);
      wlPaths.push({ pts: bedPts, halfW: halfWidth });
    }
    if (wlPaths.length > 0) {
      const wlRings = core.clipperBufferOpenPaths(wlPaths, 'Round', 1e-5);
      for (let i = 0; i < wlRings.length; i++) {
        const clipped = core.clipperIntersectPolys([wlRings[i]], plateClipPoly, 1e-5);
        for (let k = 0; k < clipped.length; k++) waterOuterList.push(clipped[k]);
      }
    }

    if (scene && Array.isArray(scene._openSeaIslands) && scene._openSeaIslands.length > 0) {
      const islandsBed = [];
      for (let i = 0; i < scene._openSeaIslands.length; i++) {
        const ring = scene._openSeaIslands[i];
        if (!ring || ring.length < 3) continue;
        const bRing = ring.map(toBed);
        const ccw = core.ensureWinding(bRing, true, 1e-5);
        if (ccw.length >= 3) islandsBed.push(ccw);
      }
      if (islandsBed.length > 0) {
        const seaDiff = core.clipperDiffPolys(plateClipPoly, islandsBed, 1e-5);
        for (let i = 0; i < seaDiff.length; i++) waterOuterList.push(seaDiff[i]);
      }
    } else if (
      waterCutout &&
      waterOuterList.length === 0 &&
      Boolean(scene && scene._hasMarineTags) &&
      (!scene.buildings || scene.buildings.length === 0) &&
      (!scene.roads || scene.roads.length === 0) &&
      Number((scene && scene.dem && scene.dem.maxElev) || 0) <= 0.5
    ) {
      waterOuterList.push(plateClipPoly[0]);
    }

    const unionedWaterRings = waterOuterList.length > 0 ? core.clipperUnionPolys(waterOuterList, 1e-5) : [];
    const waterMaskPolys2D = core.ringsToOutersWithHoles(unionedWaterRings, 1e-5);

    // Filter tiny uninhabited islands generated inside merged water rings when waterCutout=true
    if (waterCutout && waterMaskPolys2D.length > 0) {
      for (let i = 0; i < waterMaskPolys2D.length; i++) {
        const wm = waterMaskPolys2D[i];
        if (!wm.holes || wm.holes.length === 0) continue;
        wm.holes = wm.holes.filter(h => {
          if (_ringAreaAbs(h) >= minIsletU2) return true;
          const bb = _ringBBox(h);
          for (let s = 0; s < protectedSeeds.length; s++) {
            const pt = protectedSeeds[s];
            if (pt[0] >= bb[0] && pt[0] <= bb[2] && pt[1] >= bb[1] && pt[1] <= bb[3] && _ptInRing(pt[0], pt[1], h)) {
              return true;
            }
          }
          return false;
        });
      }
    }

    // 3. Carve water channels/basins out of terrain & emit water solid (unless waterCutout=true)
    let waterManifold = null;
    if (waterMaskPolys2D.length > 0 && terrainManifold) {
      const tMaxZ = terrainManifold.boundingBox().max[2] + 5.0;
      const carveSolids = [];
      const waterEmitSolids = [];

      for (let i = 0; i < waterMaskPolys2D.length; i++) {
        const wp = waterMaskPolys2D[i];
        if (waterCutout) {
          const cutM = core.extrudeRingSolid(mf, wp.outer, wp.holes, -0.5, tMaxZ);
          if (cutM) carveSolids.push(cutM);
        } else {
          // Sample lowest bank/terrain height around contour so highland lakes sit cleanly without impossible chasm drops
          let minBankZ = Infinity;
          const step = Math.max(1, Math.floor(wp.outer.length / 24));
          for (let k = 0; k < wp.outer.length; k += step) {
            const zHere = ctx.getTerrainZ(wp.outer[k][0], wp.outer[k][1]);
            if (zHere < minBankZ) minBankZ = zHere;
          }
          const isElevatedBasin = ctx.elevReliefM > 2.0 && minBankZ > ctx.zWaterTop + (1.2 / scaleMm);
          const localTopZ = isElevatedBasin ? Math.max(ctx.zWaterTop, minBankZ - (0.25 / scaleMm)) : ctx.zWaterTop;
          const localFloorZ = isElevatedBasin ? Math.max(ctx.zWaterCarveFloor, localTopZ - (0.45 / scaleMm)) : ctx.zWaterCarveFloor;

          const cutM = core.extrudeRingSolid(mf, wp.outer, wp.holes, localFloorZ, tMaxZ);
          if (cutM) carveSolids.push(cutM);

          const wM = core.extrudeRingSolid(mf, wp.outer, wp.holes, localFloorZ, localTopZ);
          if (wM) waterEmitSolids.push(wM);
        }
      }

      if (carveSolids.length > 0) {
        const combinedCarve = core.batchUnionManifolds(mf, carveSolids);
        if (combinedCarve) {
          const carved = terrainManifold.subtract(combinedCarve);
          core.safeDeleteManifold(combinedCarve);
          core.safeDeleteManifold(terrainManifold);
          terrainManifold = carved;
        }
      }
      if (!waterCutout && waterEmitSolids.length > 0) {
        waterManifold = core.batchUnionManifolds(mf, waterEmitSolids);
      } else {
        for (const s of waterEmitSolids) core.safeDeleteManifold(s);
      }
    }

    // 4. Planar Clipper2 ground roads & plazas (excluding bridges/piers and water)
    const roadRawPolys = [];
    const openRoadLines = [];
    for (const rd of (scene && scene.roads) || []) {
      if (!rd || !rd.pts || rd.pts.length < 2) continue;
      if (rd.bridge || rd.isBridge || rd.man_made === 'bridge' || rd.man_made === 'pier' || rd.man_made === 'breakwater' || rd.man_made === 'groyne' || rd.man_made === 'jetty') continue;
      if ((rd.layer !== undefined && Number(rd.layer) < 0)) continue;
      const bedPts = rd.pts.map(toBed);
      const minW = rd.isPath ? ctx.minPrintU * 0.55 : ctx.minPrintU * 0.65;
      const halfW = Math.max(minW, ((rd.width || 0.7) * 0.5) * scaleToBed);
      openRoadLines.push({ pts: bedPts, halfW });
    }
    if (openRoadLines.length > 0) {
      const buf = core.clipperBufferOpenPaths(openRoadLines, 'Round', 1e-5);
      for (let i = 0; i < buf.length; i++) roadRawPolys.push(buf[i]);
    }
    for (const rp of (scene && scene.roadPolys) || []) {
      if (!rp || !rp.outer || rp.outer.length < 3) continue;
      const oBed = rp.outer.map(toBed);
      const holesBed = (rp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed));
      const clean = holesBed.length > 0 ? core.clipperDiffPolys([oBed], holesBed, 1e-5) : [oBed];
      for (let i = 0; i < clean.length; i++) roadRawPolys.push(clean[i]);
    }

    let roadUnionRings = roadRawPolys.length > 0 ? core.clipperUnionPolys(roadRawPolys, 1e-5) : [];
    roadUnionRings = roadUnionRings.length > 0 ? core.clipperIntersectPolys(roadUnionRings, plateClipPoly, 1e-5) : [];
    if (roadUnionRings.length > 0 && unionedWaterRings.length > 0) {
      roadUnionRings = core.clipperDiffPolys(roadUnionRings, unionedWaterRings, 1e-5);
    }
    const roadPolys2D = _regularizePolys2D(core, core.ringsToOutersWithHoles(roadUnionRings, 6e-4), 6e-4, 3.5e-4);

    // 5. Planar Clipper2 greenery (parks, forests, gardens — never inside water or roads)
    const greenRawPolys = [];
    for (const gp of (scene && scene.greenPolys) || []) {
      if (!gp || !gp.outer || gp.outer.length < 3) continue;
      const oBed = gp.outer.map(toBed);
      const holesBed = (gp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed));
      const clean = holesBed.length > 0 ? core.clipperDiffPolys([oBed], holesBed, 1e-5) : [oBed];
      for (let i = 0; i < clean.length; i++) greenRawPolys.push(clean[i]);
    }

    let greenUnionRings = greenRawPolys.length > 0 ? core.clipperUnionPolys(greenRawPolys, 1e-5) : [];
    greenUnionRings = greenUnionRings.length > 0 ? core.clipperIntersectPolys(greenUnionRings, plateClipPoly, 1e-5) : [];
    if (greenUnionRings.length > 0 && unionedWaterRings.length > 0) {
      greenUnionRings = core.clipperDiffPolys(greenUnionRings, unionedWaterRings, 1e-5);
    }
    if (greenUnionRings.length > 0 && roadUnionRings.length > 0) {
      greenUnionRings = core.clipperDiffPolys(greenUnionRings, roadUnionRings, 1e-5);
    }
    const greenPolys2D = _regularizePolys2D(core, core.ringsToOutersWithHoles(greenUnionRings, 6e-4), 6e-4, 3.5e-4);

    // 6. Drape greenery & roads flush onto the 3D TIN terrain surface (zero Z-fighting, watertight)
    const hGreenU = Math.max(0.22 / scaleMm, ((ctx.cfg && ctx.cfg.greeneryHeightMm) || 0.454) / scaleMm);
    const hRoadU = Math.max(0.26 / scaleMm, ((ctx.cfg && ctx.cfg.roadHeightMm) || 0.567) / scaleMm);

    const drapePolysOntoTerrain = (structuredPolys, thicknessU) => {
      if (!structuredPolys || structuredPolys.length === 0 || !terrainManifold || terrainManifold.numTri() === 0) return null;
      if (ctx.elevReliefM <= 0.35) {
        return _buildClippedPolysExtrude(core, mf, structuredPolys, ctx.zLandDatum, ctx.zLandDatum + thicknessU, plateClipPoly);
      }
      const tMaxZ = terrainManifold.boundingBox().max[2] + thicknessU + 5.0;
      const maskPrism = _buildClippedPolysExtrude(core, mf, structuredPolys, -0.5, tMaxZ, plateClipPoly);
      if (!maskPrism) return null;
      let raisedTerrain = null;
      let clippedRaised = null;
      let slab = null;
      try {
        raisedTerrain = terrainManifold.translate([0, 0, thicknessU]);
        clippedRaised = raisedTerrain.intersect(maskPrism);
        slab = clippedRaised.subtract(terrainManifold);
        if (!slab || slab.numTri() === 0) {
          core.safeDeleteManifold(slab);
          return null;
        }
        return slab;
      } catch (_) {
        core.safeDeleteManifold(slab);
        return null;
      } finally {
        core.safeDeleteManifold(maskPrism);
        core.safeDeleteManifold(raisedTerrain);
        core.safeDeleteManifold(clippedRaised);
      }
    };

    const greeneryManifold = drapePolysOntoTerrain(greenPolys2D, hGreenU);
    const roadManifold = drapePolysOntoTerrain(roadPolys2D, hRoadU);

    // 7. Decorative / Studio Frame (single watertight genus-1 rectangular ring)
    let frameManifold = null;
    if (!ctx.state || ctx.state.showFrame !== false) {
      const cfg = ctx.cfg || {};
      const gapU = (cfg.frameInnerGapMm || 0.47) / scaleMm;
      const fwMm = (ctx.state && Number(ctx.state.frameWidthMm) > 0) ? Number(ctx.state.frameWidthMm) : (cfg.defaultFrameWidthMm || 12.0);
      const fwU = fwMm / scaleMm;
      const innerW = halfW + gapU;
      const innerH = halfH + gapU;
      const outerW = halfW + fwU;
      const outerH = halfH + fwU;
      const z0 = -(cfg.frameSkirtDepthMm || 1.6) / scaleMm;
      const z1 = ctx.zLandDatum + ((cfg.frameLipAboveBaseMm || 1.1) / scaleMm);
      const outerR = [[-outerW, -outerH], [outerW, -outerH], [outerW, outerH], [-outerW, outerH]];
      const innerR = [[-innerW, -innerH], [innerW, -innerH], [innerW, innerH], [-innerW, innerH]];
      frameManifold = core.extrudeRingSolid(mf, outerR, [innerR], z0, z1);
    }

    const isPointInWater = (x, y) => {
      for (let i = 0; i < waterMaskPolys2D.length; i++) {
        const wp = waterMaskPolys2D[i];
        if (!_ptInRing(x, y, wp.outer)) continue;
        let inHole = false;
        for (let h = 0; h < (wp.holes || []).length; h++) {
          if (_ptInRing(x, y, wp.holes[h])) { inHole = true; break; }
        }
        if (!inHole) return true;
      }
      return false;
    };

    const pointInPolysList = (x, y, polyList) => {
      for (let i = 0; i < polyList.length; i++) {
        const pp = polyList[i];
        if (!_ptInRing(x, y, pp.outer)) continue;
        let inHole = false;
        for (let h = 0; h < (pp.holes || []).length; h++) {
          if (_ptInRing(x, y, pp.holes[h])) { inHole = true; break; }
        }
        if (!inHole) return true;
      }
      return false;
    };

    const getSurfaceZ = (x, y) => {
      if (isPointInWater(x, y)) return waterCutout ? 0.0 : ctx.zWaterTop;
      let z = ctx.getTerrainZ(x, y);
      if (pointInPolysList(x, y, roadPolys2D)) z += hRoadU;
      else if (pointInPolysList(x, y, greenPolys2D)) z += hGreenU;
      return z;
    };

    ctx.audit.baseInfo = {
      hasWaterCutout: waterCutout,
      minCutoutIsletMm2: minIsletMm2,
      waterPolyCount: waterMaskPolys2D.length,
      roadPolyCount: roadPolys2D.length,
      greenPolyCount: greenPolys2D.length,
    };

    return {
      terrainManifold,
      waterManifold,
      greeneryManifold,
      roadManifold,
      frameManifold,
      waterMaskPolys2D,
      roadPolys2D,
      greenPolys2D,
      hGreenU,
      hRoadU,
      isPointInWater,
      isPointOnRoad: (x, y) => pointInPolysList(x, y, roadPolys2D),
      isPointInGreen: (x, y) => pointInPolysList(x, y, greenPolys2D),
      getSurfaceZ,
      getWaterFloorZ: () => (waterCutout ? 0.0 : ctx.zWaterCarveFloor),
    };
  }

  const exportsObj = { buildLayer1TerrainAndWater };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
