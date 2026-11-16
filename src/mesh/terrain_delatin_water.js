// ============================================================================
// src/mesh/terrain_delatin_water.js
// Adaptive Delatin TIN Terrain, Monotonic Mountain River Profiling & Water Carve
// ============================================================================

(function (root) {
  function _getCore() {
    if (typeof getManifoldLib === 'function' && typeof clipperUnionPolys === 'function') {
      return {
        getVendorDeps, signedArea2D, ensureWinding,
        clipperUnionPolys, clipperIntersectPolys, clipperDiffPolys,
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

  function _buildSlopedPrism(core, mf, outer, holes, zBotFn, zTopFn) {
    const { earcut } = core.getVendorDeps(), oClean = core.ensureWinding(outer, true, 1e-4);
    if (!earcut || oClean.length < 3) return null;
    const rings = [oClean];
    for (const h of (holes || [])) { const hc = core.ensureWinding(h, false, 1e-4); if (hc.length >= 3) rings.push(hc); }
    const coords = [], holeIndices = [], pts2D = [], slices = [];
    for (let r = 0; r < rings.length; r++) {
      if (r > 0) holeIndices.push(pts2D.length);
      slices.push([pts2D.length, rings[r].length]);
      for (const p of rings[r]) { coords.push(p[0], p[1]); pts2D.push(p); }
    }
    const triIdx = earcut(coords, holeIndices.length > 0 ? holeIndices : undefined, 2);
    if (!triIdx || triIdx.length < 3) return null;
    const nPts = pts2D.length, pos = new Array(nPts * 6), tris = [];
    for (let i = 0; i < nPts; i++) {
      const x = pts2D[i][0], y = pts2D[i][1], zb = zBotFn(x, y), zt = Math.max(zb + 0.02, zTopFn(x, y));
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = zt;
      pos[(nPts + i) * 3] = x; pos[(nPts + i) * 3 + 1] = y; pos[(nPts + i) * 3 + 2] = zb;
    }
    for (let k = 0; k < triIdx.length; k += 3) {
      let a = triIdx[k], b = triIdx[k + 1], c = triIdx[k + 2];
      const cross2 = (pts2D[b][0] - pts2D[a][0]) * (pts2D[c][1] - pts2D[a][1]) - (pts2D[b][1] - pts2D[a][1]) * (pts2D[c][0] - pts2D[a][0]);
      if (Math.abs(cross2) < 1e-10) continue;
      if (cross2 < 0) { const t = b; b = c; c = t; }
      tris.push(a, b, c, nPts + a, nPts + c, nPts + b);
    }
    for (const [start, len] of slices) for (let i = 0; i < len; i++) {
      const u = start + i, v = start + ((i + 1) % len);
      tris.push(u, nPts + u, nPts + v, u, nPts + v, v);
    }
    return tris.length >= 12 ? core.manifoldFromRawSoup(mf, new Float32Array(pos), new Uint32Array(tris), 1e-5) : null;
  }

  function _buildSlopedWaterReaches(core, ctx, scene, plateClipPoly, protectedPolys) {
    if (ctx.waterCutout || ctx.elevReliefM <= 2.0) return { flatWlPaths: [], slopedReaches: [], slopedRingList: [] };
    const { toBed, scaleToBed, scaleMm } = ctx;
    const flatWlPaths = [], slopedReaches = [], slopedRingList = [];
    for (const wl of (scene && scene.waterLines) || []) {
      if (!wl || !wl.pts || wl.pts.length < 2) continue;
      const halfW = Math.max(ctx.minPrintU * 0.65, ((wl.width || 0.7) * 0.5) * scaleToBed);
      const rawPts = wl.pts.map(toBed), minStep = Math.max(0.45, halfW * 1.1);
      const pts = [rawPts[0]];
      for (let i = 1; i < rawPts.length - 1; i++) if (Math.hypot(rawPts[i][0] - pts[pts.length - 1][0], rawPts[i][1] - pts[pts.length - 1][1]) >= minStep) pts.push(rawPts[i]);
      pts.push(rawPts[rawPts.length - 1]);
      const rawBankZ = pts.map((p, idx) => {
        const nxt = pts[Math.min(pts.length - 1, idx + 1)], prv = pts[Math.max(0, idx - 1)];
        const tx = nxt[0] - prv[0], ty = nxt[1] - prv[1], tl = Math.hypot(tx, ty) || 1, off = halfW * 1.35;
        return Math.min(ctx.getTerrainZ(p[0], p[1]), ctx.getTerrainZ(p[0] - (ty / tl) * off, p[1] + (tx / tl) * off), ctx.getTerrainZ(p[0] + (ty / tl) * off, p[1] - (tx / tl) * off));
      });
      if (Math.max(...rawBankZ) - Math.min(...rawBankZ) <= 0.35 / scaleMm) { flatWlPaths.push({ pts, halfW }); continue; }
      const q = Math.max(1, Math.floor(rawBankZ.length / 4));
      const headAvg = rawBankZ.slice(0, q).reduce((a, b) => a + b, 0) / q;
      const tailAvg = rawBankZ.slice(-q).reduce((a, b) => a + b, 0) / q;
      const ordPts = headAvg >= tailAvg ? pts : pts.slice().reverse();
      const ordZ = headAvg >= tailAvg ? rawBankZ : rawBankZ.slice().reverse();
      for (let i = 1; i < ordZ.length; i++) ordZ[i] = Math.min(ordZ[i - 1], ordZ[i]);
      const topZ = ordZ.map(bz => Math.max(ctx.zWaterTop, bz - 0.25 / scaleMm));
      const floorZ = topZ.map(tz => Math.max(ctx.zWaterCarveFloor, tz - 0.45 / scaleMm));
      for (let i = 0; i < ordPts.length - 1; i++) {
        const a = ordPts[i], b = ordPts[i + 1], segRings = core.clipperBufferOpenPaths([{ pts: [a, b], halfW }], 'Round', 1e-5);
        let clipped = segRings.length > 0 ? core.clipperIntersectPolys(segRings, plateClipPoly, 1e-5) : [];
        if (clipped.length > 0 && protectedPolys.length > 0) clipped = core.clipperDiffPolys(clipped, protectedPolys, 1e-5);
        for (const cr of clipped) slopedRingList.push(cr);
        if (clipped.length > 0) {
          const dx = b[0] - a[0], dy = b[1] - a[1];
          slopedReaches.push({ ax: a[0], ay: a[1], dx, dy, len2: dx * dx + dy * dy, rSq: (halfW + 0.12) ** 2, topA: topZ[i], topB: topZ[i + 1], floorA: floorZ[i], floorB: floorZ[i + 1], polys: clipped });
        }
      }
    }
    return { flatWlPaths, slopedReaches, slopedRingList };
  }

  function _ptInRingLocal(px, py, poly) {
    let inside = false;
    for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }

  function _probeRingInteriorPt(poly) {
    if (!poly || poly.length < 3) return [0, 0];
    let cx = 0, cy = 0, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      cx += poly[i][0]; cy += poly[i][1];
      if (poly[i][1] < y0) y0 = poly[i][1];
      if (poly[i][1] > y1) y1 = poly[i][1];
    }
    cx /= poly.length; cy /= poly.length;
    if (_ptInRingLocal(cx, cy, poly)) return [cx, cy];
    const sy = (y0 + y1) * 0.5, xs = [];
    for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
      const yi = poly[i][1], yj = poly[j][1];
      if ((yi > sy) !== (yj > sy)) xs.push(poly[i][0] + ((poly[j][0] - poly[i][0]) * (sy - yi)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    if (xs.length >= 2) return [(xs[0] + xs[1]) * 0.5, sy];
    return [poly[0][0], poly[0][1]];
  }

  function buildLayer1WaterAndCarve(core, mf, ctx, scene, terrainManifold, plateClipPoly, protectedPolys, keepIslet) {
    const { toBed, scaleToBed, scaleMm, waterCutout } = ctx;
    const appliedRot = (scene && typeof scene._appliedRotationDeg === 'number') ? scene._appliedRotationDeg : 0;
    const rotRad = (appliedRot * Math.PI) / 180.0;
    const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad);
    const mapUnrotRingToBed = (ring) => ring.map(p => toBed(appliedRot === 0 ? p : [p[0] * cosR - p[1] * sinR, p[0] * sinR + p[1] * cosR]));

    // 1. Collect all explicit island, standalone land, shingle, and open-sea island rings globally in bed space
    const islandEntries = [];
    const pushIslandBed = (rawBedRing) => {
      if (!rawBedRing || rawBedRing.length < 3 || !keepIslet(rawBedRing)) return;
      const ccw = core.ensureWinding(rawBedRing, true, 1e-5);
      const area = ccw.length >= 3 ? Math.abs(core.signedArea2D(ccw)) : 0;
      if (area > 1e-5) islandEntries.push({ ring: ccw, area });
    };

    for (const wp of (scene && scene.waterPolys) || []) {
      if (!wp) continue;
      for (const h of (wp.holes || [])) if (h && h.length >= 3) pushIslandBed(h.map(toBed));
      const landRings = Array.isArray(wp._rotatedLandRings)
        ? wp._rotatedLandRings.map(r => r.map(toBed))
        : (Array.isArray(wp._unrotatedLandRings) ? wp._unrotatedLandRings.map(mapUnrotRingToBed) : []);
      for (const lr of landRings) pushIslandBed(lr);
      const shingleRings = Array.isArray(wp._rotatedShingleRings)
        ? wp._rotatedShingleRings.map(r => r.map(toBed))
        : (Array.isArray(wp._unrotatedShingleRings) ? wp._unrotatedShingleRings.map(mapUnrotRingToBed) : []);
      for (const sr of shingleRings) pushIslandBed(sr);
    }
    if (scene && Array.isArray(scene._openSeaIslands)) {
      for (const isl of scene._openSeaIslands) if (isl && isl.length >= 3) pushIslandBed(isl.map(toBed));
    }
    const globalIslandPolys = islandEntries.length > 0
      ? core.clipperUnionPolys(islandEntries.map(e => e.ring), 1e-5)
      : [];

    // 2. Separate primary sea/river/marina polygons from genuine inland ponds strictly inside an island
    const primaryWaterOuterList = [];
    const nestedLakeOuters = [];
    for (const wp of (scene && scene.waterPolys) || []) {
      if (!wp || !wp.outer || wp.outer.length < 3) continue;
      const outerBed = wp.outer.map(toBed);
      const clipped = core.clipperIntersectPolys([outerBed], plateClipPoly, 1e-5);
      if (clipped.length === 0) continue;
      const wpArea = Math.abs(core.signedArea2D(outerBed));
      const probe = _probeRingInteriorPt(outerBed);
      const isNestedPond = islandEntries.some(isl => wpArea < isl.area * 0.88 && _ptInRingLocal(probe[0], probe[1], isl.ring));
      if (isNestedPond) {
        const subHoles = (wp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed)).filter(keepIslet);
        const pondPolys = subHoles.length > 0 ? core.clipperDiffPolys(clipped, subHoles, 1e-5) : clipped;
        for (const pr of pondPolys) nestedLakeOuters.push(pr);
      } else {
        for (const fr of clipped) primaryWaterOuterList.push(fr);
      }
    }

    const { flatWlPaths, slopedReaches, slopedRingList } = _buildSlopedWaterReaches(core, ctx, scene, plateClipPoly, protectedPolys);
    const allWlPaths = waterCutout
      ? ((scene && scene.waterLines) || []).filter(w => w && w.pts && w.pts.length >= 2).map(wl => ({ pts: wl.pts.map(toBed), halfW: Math.max(ctx.minPrintU * 0.65, ((wl.width || 0.7) * 0.5) * scaleToBed) }))
      : flatWlPaths;
    // IMPORTANT: Clip the entire buffered waterway ring set together (never ring-by-ring!) so CW island holes enclosed by canal grids (e.g. Venice) are never inverted into solid water!
    const bufferedWlRings = allWlPaths.length > 0
      ? core.clipperIntersectPolys(core.clipperBufferOpenPaths(allWlPaths, 'Round', 1e-5), plateClipPoly, 1e-5)
      : [];
    if (scene && Array.isArray(scene._openSeaIslands) && scene._openSeaIslands.length > 0) {
      primaryWaterOuterList.push(plateClipPoly[0]);
    } else if (waterCutout && primaryWaterOuterList.length === 0 && bufferedWlRings.length === 0 && nestedLakeOuters.length === 0 && scene && scene._hasMarineTags && (!scene.buildings || !scene.buildings.length) && (!scene.roads || !scene.roads.length) && Number((scene.dem && scene.dem.maxElev) || 0) <= 0.5) {
      primaryWaterOuterList.push(plateClipPoly[0]);
    }

    // 3. Three-pass Clipper2 topology: Union primary water + buffered canals -> Subtract ALL islands globally -> Re-apply nested ponds -> Subtract protected dry land
    let flatWaterRings = primaryWaterOuterList.length > 0 ? core.clipperUnionPolys(primaryWaterOuterList, 1e-5) : [];
    if (bufferedWlRings.length > 0) {
      flatWaterRings = core.clipperUnionPolys(flatWaterRings, 1e-5, bufferedWlRings);
    }
    if (flatWaterRings.length > 0 && globalIslandPolys.length > 0) {
      flatWaterRings = core.clipperDiffPolys(flatWaterRings, globalIslandPolys, 1e-5);
    }
    if (nestedLakeOuters.length > 0) {
      flatWaterRings = core.clipperUnionPolys(flatWaterRings, 1e-5, nestedLakeOuters);
    }
    if (flatWaterRings.length > 0 && protectedPolys.length > 0) {
      flatWaterRings = core.clipperDiffPolys(flatWaterRings, protectedPolys, 1e-5);
    }
    const slopedUnioned = slopedRingList.length > 0 ? core.clipperUnionPolys(slopedRingList, 1e-5) : [];
    let unionedWaterRings = (flatWaterRings.length || slopedUnioned.length)
      ? core.clipperUnionPolys(flatWaterRings, 1e-5, slopedUnioned)
      : [];
    if (unionedWaterRings.length > 0 && protectedPolys.length > 0) {
      unionedWaterRings = core.clipperDiffPolys(unionedWaterRings, protectedPolys, 1e-5);
    }
    const flatWaterPolys2D = core.ringsToOutersWithHoles(flatWaterRings, 1e-5), waterMaskPolys2D = core.ringsToOutersWithHoles(unionedWaterRings, 1e-5);
    if (waterCutout) for (const wm of waterMaskPolys2D) if (wm.holes && wm.holes.length) wm.holes = wm.holes.filter(keepIslet);

    let waterManifold = null;
    if ((flatWaterPolys2D.length > 0 || slopedReaches.length > 0) && terrainManifold) {
      const tMaxZ = terrainManifold.boundingBox().max[2] + 5.0, carveSolids = [], waterEmitSolids = [];
      for (const wp of (waterCutout ? waterMaskPolys2D : flatWaterPolys2D)) {
        if (waterCutout) { const cm = core.extrudeRingSolid(mf, wp.outer, wp.holes, -0.5, tMaxZ); if (cm) carveSolids.push(cm); continue; }
        let minBankZ = Infinity;
        for (let k = 0; k < wp.outer.length; k += Math.max(1, Math.floor(wp.outer.length / 24))) minBankZ = Math.min(minBankZ, ctx.getTerrainZ(wp.outer[k][0], wp.outer[k][1]));
        const isEl = ctx.elevReliefM > 2.0 && minBankZ > ctx.zWaterTop + 1.2 / scaleMm;
        const topZ = isEl ? Math.max(ctx.zWaterTop, minBankZ - 0.25 / scaleMm) : ctx.zWaterTop;
        const flrZ = isEl ? Math.max(ctx.zWaterCarveFloor, topZ - 0.45 / scaleMm) : ctx.zWaterCarveFloor;
        const cm = core.extrudeRingSolid(mf, wp.outer, wp.holes, flrZ, tMaxZ); if (cm) carveSolids.push(cm);
        const wm = core.extrudeRingSolid(mf, wp.outer, wp.holes, flrZ, topZ); if (wm) waterEmitSolids.push(wm);
      }
      for (const sr of slopedReaches) {
        const zOf = (vA, vB) => (x, y) => { const t = sr.len2 > 1e-10 ? Math.max(0, Math.min(1, ((x - sr.ax) * sr.dx + (y - sr.ay) * sr.dy) / sr.len2)) : 0; return vA + (vB - vA) * t; };
        for (const r of sr.polys) {
          const cm = _buildSlopedPrism(core, mf, r, [], zOf(sr.floorA, sr.floorB), () => tMaxZ); if (cm) carveSolids.push(cm);
          const wm = _buildSlopedPrism(core, mf, r, [], zOf(sr.floorA, sr.floorB), zOf(sr.topA, sr.topB)); if (wm) waterEmitSolids.push(wm);
        }
      }
      const combinedCarve = carveSolids.length > 0 ? core.batchUnionManifolds(mf, carveSolids) : null;
      if (combinedCarve) { try { const c = terrainManifold.subtract(combinedCarve); core.safeDeleteManifold(terrainManifold); terrainManifold = c; } finally { core.safeDeleteManifold(combinedCarve); } }
      if (!waterCutout && waterEmitSolids.length > 0) waterManifold = core.batchUnionManifolds(mf, waterEmitSolids);
    }
    const queryWaterZAt = (x, y, isFloor = false, ignoreCutout = false) => {
      if (waterCutout && !ignoreCutout) return 0.0;
      let bestDist2 = Infinity, bestVal = null;
      for (const sr of slopedReaches) {
        const t = sr.len2 > 1e-10 ? Math.max(0, Math.min(1, ((x - sr.ax) * sr.dx + (y - sr.ay) * sr.dy) / sr.len2)) : 0;
        const d2 = (x - (sr.ax + t * sr.dx)) ** 2 + (y - (sr.ay + t * sr.dy)) ** 2;
        if (d2 <= sr.rSq && d2 < bestDist2) { bestDist2 = d2; bestVal = isFloor ? (sr.floorA + (sr.floorB - sr.floorA) * t) : (sr.topA + (sr.topB - sr.topA) * t); }
      }
      return bestVal !== null ? bestVal : (isFloor ? ctx.zWaterCarveFloor : ctx.zWaterTop);
    };
    return { terrainManifold, waterManifold, unionedWaterRings, waterMaskPolys2D, queryWaterZAt, slopedRiverSegments: slopedReaches.length };
  }

  const exportsObj = { buildDelatinTerrainManifold, buildLayer1WaterAndCarve };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
