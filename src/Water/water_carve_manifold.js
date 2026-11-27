// ============================================================================
// src/Water/water_carve_manifold.js
// Layer-1 Clipper2 Water/Island/Pond Topology, 3D Terrain Carve & queryWaterZAt
// ============================================================================

(function (root) {
  function _getDeps() {
    const sampler = (typeof _classifyFlatWaterPolys === 'function' && typeof _ptInWaterEntryLocal === 'function')
      ? {
          _waterRingBBox, _ptInRingLocal, _probeRingInteriorPt,
          _ptInWaterEntryLocal, _isPointNearWaterEntry, _classifyFlatWaterPolys
        }
      : require('./water_elevation_sampler.js');
    const reaches = (typeof _buildSlopedWaterReaches === 'function' && typeof _buildSlopedPrism === 'function')
      ? { _buildSlopedPrism, _evalPolylineZ, _classifyLinearWaterways, _buildSlopedWaterReaches }
      : require('./water_sloped_reaches.js');
    return { sampler, reaches };
  }

  function buildLayer1WaterAndCarve(core, mf, ctx, scene, terrainManifold, plateClipPoly, protectedPolys, keepIslet) {
    const { sampler, reaches } = _getDeps();
    const { toBed, scaleToBed, waterCutout } = ctx;
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

    // 2. Separate primary sea/river/marina polygons, genuine inland ponds, and small interior
    // ornamental park pools (< 4500 m2 under waterCutout -> shallow recess above Z >= 2.2 mm)
    const ORNAMENTAL_POOL_TAGS = new Set(['pond', 'basin', 'fountain', 'reflecting_pool', 'swimming_pool']);
    const rawMToU = Math.max(1e-6, Number(ctx.rawMToU || ctx.mToU || 0.141));
    const borderTolU = 0.25 / (ctx.scaleMm || 1);
    const primaryWaterOuterList = [];
    const nestedLakeOuters = [];
    const shallowOrnamentalOuterList = [];
    for (const wp of (scene && scene.waterPolys) || []) {
      if (!wp || !wp.outer || wp.outer.length < 3) continue;
      const outerBed = wp.outer.map(toBed);
      const clipped = core.clipperIntersectPolys([outerBed], plateClipPoly, 1e-5);
      if (clipped.length === 0) continue;
      const wpTag = String(wp.waterTag || '').trim().toLowerCase();
      if (waterCutout && ORNAMENTAL_POOL_TAGS.has(wpTag)) {
        const areaM2 = Math.abs(core.signedArea2D(wp.outer)) / (rawMToU * rawMToU);
        const touchesPlateBorder = clipped.some(ring => ring.some(p =>
          Math.abs(p[0]) >= (ctx.halfW || 60) - borderTolU ||
          Math.abs(p[1]) >= (ctx.halfH || 60) - borderTolU
        ));
        if (areaM2 < 4500 && !touchesPlateBorder) {
          const subHoles = (wp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed)).filter(keepIslet);
          const poolPolys = subHoles.length > 0 ? core.clipperDiffPolys(clipped, subHoles, 1e-5) : clipped;
          for (const pr of poolPolys) shallowOrnamentalOuterList.push(pr);
          continue;
        }
      }
      const wpArea = Math.abs(core.signedArea2D(outerBed));
      const probe = sampler._probeRingInteriorPt(outerBed);
      const isNestedPond = islandEntries.some(isl => wpArea < isl.area * 0.88 && sampler._ptInRingLocal(probe[0], probe[1], isl.ring));
      if (isNestedPond) {
        const subHoles = (wp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed)).filter(keepIslet);
        const pondPolys = subHoles.length > 0 ? core.clipperDiffPolys(clipped, subHoles, 1e-5) : clipped;
        for (const pr of pondPolys) nestedLakeOuters.push(pr);
      } else {
        for (const fr of clipped) primaryWaterOuterList.push(fr);
      }
    }
    if (scene && Array.isArray(scene._openSeaIslands) && scene._openSeaIslands.length > 0) {
      primaryWaterOuterList.push(plateClipPoly[0]);
    }

    // Effective dry island mask (all islands/shoals minus any genuine inland ponds strictly inside an island)
    const effectiveIslandPolys = (globalIslandPolys.length > 0 && nestedLakeOuters.length > 0)
      ? core.clipperDiffPolys(globalIslandPolys, nestedLakeOuters, 1e-5)
      : globalIslandPolys;
    const islandMaskEntries = core.ringsToOutersWithHoles(effectiveIslandPolys, 1e-5)
      .map(p => ({ outer: p.outer, holes: p.holes || [], bb: sampler._waterRingBBox(p.outer) }));

    // Areal water mask prior to linear waterways (so linear centerlines know areal water extent & height)
    let arealWaterRings = primaryWaterOuterList.length > 0 ? core.clipperUnionPolys(primaryWaterOuterList, 1e-5) : [];
    if (arealWaterRings.length > 0 && globalIslandPolys.length > 0) {
      arealWaterRings = core.clipperDiffPolys(arealWaterRings, globalIslandPolys, 1e-5);
    }
    if (nestedLakeOuters.length > 0) {
      arealWaterRings = core.clipperUnionPolys(arealWaterRings, 1e-5, nestedLakeOuters);
    }
    if (arealWaterRings.length > 0 && protectedPolys.length > 0) {
      arealWaterRings = core.clipperDiffPolys(arealWaterRings, protectedPolys, 1e-5);
    }
    const arealWaterEntries = sampler._classifyFlatWaterPolys(ctx, core.ringsToOutersWithHoles(arealWaterRings, 1e-5));

    const { flatWlPaths, slopedCandidates } = reaches._classifyLinearWaterways(ctx, scene, arealWaterEntries, islandMaskEntries);
    // Under waterCutout, skip redundant waterway=river routing centerlines that already run inside
    // an exact natural=water polygon (coarse straight chords can otherwise graze convex headlands
    // and slice off razor-thin detached shoreline slivers). Canals/streams/ditch lines stay intact.
    const isRedundantRiverCenterline = (wl, ptsBed, halfW) => {
      if (!arealWaterEntries.length || !wl || wl.waterway !== 'river' || ptsBed.length < 2) return false;
      const hw = (ctx.halfW || 60) + 1.0, hh = (ctx.halfH || 60) + 1.0;
      const stepU = Math.max(0.5 / (ctx.scaleMm || 1), halfW);
      const nearTolU = Math.max(halfW * 3.5, 2.2 / (ctx.scaleMm || 1));
      let vis = 0, inside = 0, near = 0;
      for (let i = 0; i < ptsBed.length - 1; i++) {
        const a = ptsBed[i], b = ptsBed[i + 1];
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const nSub = Math.max(1, Math.min(40, Math.ceil(segLen / stepU)));
        for (let k = 0; k <= nSub; k++) {
          if (i > 0 && k === 0) continue;
          const t = k / nSub;
          const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
          if (px < -hw || px > hw || py < -hh || py > hh) continue;
          vis++;
          if (arealWaterEntries.some(we => sampler._ptInWaterEntryLocal(px, py, we))) {
            inside++;
            near++;
          } else if (arealWaterEntries.some(we => sampler._isPointNearWaterEntry(px, py, we, nearTolU))) {
            near++;
          }
        }
      }
      return vis >= 2 && inside >= Math.ceil(vis * 0.65) && near === vis;
    };
    const allWlPaths = waterCutout
      ? ((scene && scene.waterLines) || [])
          .filter(w => w && w.pts && w.pts.length >= 2)
          .map(wl => ({ wl, pts: wl.pts.map(toBed), halfW: Math.max(ctx.minPrintU * 0.65, ((wl.width || 0.7) * 0.5) * scaleToBed) }))
          .filter(item => !isRedundantRiverCenterline(item.wl, item.pts, item.halfW))
          .map(({ pts, halfW }) => ({ pts, halfW }))
      : flatWlPaths;
    // Clip the entire buffered waterway ring set together (never ring-by-ring) so CW island holes
    // enclosed by closed canal grids are never inverted into solid water.
    const bufferedWlRings = allWlPaths.length > 0
      ? core.clipperIntersectPolys(core.clipperBufferOpenPaths(allWlPaths, 'Round', 1e-5), plateClipPoly, 1e-5)
      : [];
    if (waterCutout && primaryWaterOuterList.length === 0 && bufferedWlRings.length === 0 && nestedLakeOuters.length === 0 && scene && scene._hasMarineTags && (!scene.buildings || !scene.buildings.length) && (!scene.roads || !scene.roads.length) && Number((scene.dem && scene.dem.maxElev) || 0) <= 0.5) {
      primaryWaterOuterList.push(plateClipPoly[0]);
    }

    // 3. Three-pass Clipper2 topology: Union primary water + buffered canals -> Subtract ALL islands globally -> Re-apply nested ponds -> Subtract protected dry land
    let flatWaterRings = primaryWaterOuterList.length > 0 ? core.clipperUnionPolys(primaryWaterOuterList, 1e-5) : [];
    if (bufferedWlRings.length > 0) flatWaterRings = core.clipperUnionPolys(flatWaterRings, 1e-5, bufferedWlRings);
    if (flatWaterRings.length > 0 && globalIslandPolys.length > 0) flatWaterRings = core.clipperDiffPolys(flatWaterRings, globalIslandPolys, 1e-5);
    if (nestedLakeOuters.length > 0) flatWaterRings = core.clipperUnionPolys(flatWaterRings, 1e-5, nestedLakeOuters);
    if (flatWaterRings.length > 0 && protectedPolys.length > 0) flatWaterRings = core.clipperDiffPolys(flatWaterRings, protectedPolys, 1e-5);

    const flatWaterPolys2D = core.ringsToOutersWithHoles(flatWaterRings, 1e-5);
    const flatWaterEntries = sampler._classifyFlatWaterPolys(ctx, flatWaterPolys2D);
    const elevatedFlatPolys = flatWaterEntries.filter(e => e.isEl);
    const standardFlatPolys = flatWaterEntries.filter(e => !e.isEl);

    // 4. Emit sloped tributary/mountain reaches strictly OUTSIDE flatWaterRings, effectiveIslandPolys, and protectedPolys
    const { slopedReaches, slopedRingList } = reaches._buildSlopedWaterReaches(
      core, ctx, plateClipPoly, slopedCandidates, flatWaterRings, flatWaterEntries,
      effectiveIslandPolys, islandMaskEntries, protectedPolys, bufferedWlRings.length > 0
    );

    const slopedUnioned = slopedRingList.length > 0 ? core.clipperUnionPolys(slopedRingList, 1e-5) : [];
    let unionedWaterRings = (flatWaterRings.length || slopedUnioned.length)
      ? core.clipperUnionPolys(flatWaterRings, 1e-5, slopedUnioned)
      : [];
    if (unionedWaterRings.length > 0 && effectiveIslandPolys.length > 0) {
      unionedWaterRings = core.clipperDiffPolys(unionedWaterRings, effectiveIslandPolys, 1e-5);
    }
    if (unionedWaterRings.length > 0 && protectedPolys.length > 0) {
      unionedWaterRings = core.clipperDiffPolys(unionedWaterRings, protectedPolys, 1e-5);
    }
    const cutoutWaterPolys2D = core.ringsToOutersWithHoles(unionedWaterRings, 1e-5);
    if (waterCutout) for (const wm of cutoutWaterPolys2D) if (wm.holes && wm.holes.length) wm.holes = wm.holes.filter(keepIslet);

    let shallowOrnamentalRings = shallowOrnamentalOuterList.length > 0
      ? core.clipperUnionPolys(shallowOrnamentalOuterList, 1e-5)
      : [];
    if (shallowOrnamentalRings.length > 0 && effectiveIslandPolys.length > 0) {
      shallowOrnamentalRings = core.clipperDiffPolys(shallowOrnamentalRings, effectiveIslandPolys, 1e-5);
    }
    if (shallowOrnamentalRings.length > 0 && protectedPolys.length > 0) {
      shallowOrnamentalRings = core.clipperDiffPolys(shallowOrnamentalRings, protectedPolys, 1e-5);
    }
    if (shallowOrnamentalRings.length > 0 && unionedWaterRings.length > 0) {
      shallowOrnamentalRings = core.clipperDiffPolys(shallowOrnamentalRings, unionedWaterRings, 1e-5);
    }
    const shallowOrnamentalPolys2D = core.ringsToOutersWithHoles(shallowOrnamentalRings, 1e-5);
    const baseBottomMm = Number(ctx.baseBottomMm) > 0 ? Number(ctx.baseBottomMm) : 2.35;
    const minReliefBaseMm = (ctx.cfg && Number(ctx.cfg.undersideReliefMinBaseMm) > 0) ? Number(ctx.cfg.undersideReliefMinBaseMm) : 2.60;
    const reliefEnabled = typeof ctx.undersideReliefEnabled === 'boolean'
      ? ctx.undersideReliefEnabled
      : (Boolean(ctx.solidBaseNoTunnels) && baseBottomMm > minReliefBaseMm);
    const minShallowFloorMm = (typeof root.resolveShallowPondMinFloorMm === 'function')
      ? root.resolveShallowPondMinFloorMm(baseBottomMm, reliefEnabled, 1.50)
      : (reliefEnabled ? (Math.min(1.50, Math.max(0.85, baseBottomMm - 1.20)) + 0.70) : Math.max(0.80, baseBottomMm - 0.80));
    const minShallowFloorU = minShallowFloorMm / (ctx.scaleMm || 1);
    const shallowRecessU = 0.40 / (ctx.scaleMm || 1);
    const shallowOrnamentalEntries = shallowOrnamentalPolys2D.length > 0
      ? sampler._classifyFlatWaterPolys(ctx, shallowOrnamentalPolys2D).map(fe => ({
          ...fe,
          floorZ: Math.max(minShallowFloorU, fe.minTerrainZ - shallowRecessU),
        }))
      : [];
    if (shallowOrnamentalRings.length > 0) {
      unionedWaterRings = unionedWaterRings.length > 0
        ? core.clipperUnionPolys(unionedWaterRings, 1e-5, shallowOrnamentalRings)
        : shallowOrnamentalRings;
    }
    const waterMaskPolys2D = shallowOrnamentalPolys2D.length > 0
      ? cutoutWaterPolys2D.concat(shallowOrnamentalPolys2D)
      : cutoutWaterPolys2D;

    let waterManifold = null;
    if ((flatWaterPolys2D.length > 0 || slopedReaches.length > 0 || shallowOrnamentalEntries.length > 0) && terrainManifold) {
      const tMaxZ = terrainManifold.boundingBox().max[2] + 5.0, carveSolids = [], waterEmitSolids = [];
      if (waterCutout) {
        for (const wp of cutoutWaterPolys2D) {
          const cm = core.extrudeRingSolid(mf, wp.outer, wp.holes, -0.5, tMaxZ);
          if (cm) carveSolids.push(cm);
        }
        for (const se of shallowOrnamentalEntries) {
          const cm = core.extrudeRingSolid(mf, se.outer, se.holes, se.floorZ, tMaxZ);
          if (cm) carveSolids.push(cm);
        }
      } else {
        for (const fe of flatWaterEntries) {
          const cm = core.extrudeRingSolid(mf, fe.outer, fe.holes, fe.flrZ, tMaxZ); if (cm) carveSolids.push(cm);
          const wm = core.extrudeRingSolid(mf, fe.outer, fe.holes, fe.flrZ, fe.topZ); if (wm) waterEmitSolids.push(wm);
        }
      }
      for (const sr of slopedReaches) {
        const flrFn = reaches._evalPolylineZ(sr.ordPts, sr.ordFloorZ);
        const topFn = reaches._evalPolylineZ(sr.ordPts, sr.ordTopZ);
        for (const p of sr.polys) {
          const cm = reaches._buildSlopedPrism(core, mf, p.outer, p.holes, flrFn, () => tMaxZ); if (cm) carveSolids.push(cm);
          const wm = reaches._buildSlopedPrism(core, mf, p.outer, p.holes, flrFn, topFn); if (wm) waterEmitSolids.push(wm);
        }
      }
      const combinedCarve = carveSolids.length > 0 ? core.batchUnionManifolds(mf, carveSolids) : null;
      if (combinedCarve) {
        try {
          const c = terrainManifold.subtract(combinedCarve);
          core.safeDeleteManifold(terrainManifold);
          terrainManifold = c;
        } finally {
          core.safeDeleteManifold(combinedCarve);
        }
      }
      if (!waterCutout && waterEmitSolids.length > 0) waterManifold = core.batchUnionManifolds(mf, waterEmitSolids);
    }

    const queryWaterZAt = (x, y, isFloor = false, ignoreCutout = false) => {
      for (let i = 0; i < shallowOrnamentalEntries.length; i++) {
        if (sampler._ptInWaterEntryLocal(x, y, shallowOrnamentalEntries[i])) {
          return shallowOrnamentalEntries[i].floorZ;
        }
      }
      if (waterCutout && !ignoreCutout) return 0.0;
      for (let i = 0; i < elevatedFlatPolys.length; i++) {
        const ep = elevatedFlatPolys[i];
        if (sampler._ptInWaterEntryLocal(x, y, ep)) return isFloor ? ep.flrZ : ep.topZ;
      }
      for (let i = 0; i < standardFlatPolys.length; i++) {
        if (sampler._ptInWaterEntryLocal(x, y, standardFlatPolys[i])) return isFloor ? ctx.zWaterCarveFloor : ctx.zWaterTop;
      }
      let bestDist2 = Infinity, bestVal = null;
      for (const sr of slopedReaches) {
        const t = sr.len2 > 1e-10 ? Math.max(0, Math.min(1, ((x - sr.ax) * sr.dx + (y - sr.ay) * sr.dy) / sr.len2)) : 0;
        const d2 = (x - (sr.ax + t * sr.dx)) ** 2 + (y - (sr.ay + t * sr.dy)) ** 2;
        if (d2 <= sr.rSq && d2 < bestDist2) {
          bestDist2 = d2;
          bestVal = isFloor ? (sr.floorA + (sr.floorB - sr.floorA) * t) : (sr.topA + (sr.topB - sr.topA) * t);
        }
      }
      if (bestVal !== null) return bestVal;
      for (let i = 0; i < elevatedFlatPolys.length; i++) {
        const ep = elevatedFlatPolys[i];
        if (sampler._isPointNearWaterEntry(x, y, ep, 0.15)) return isFloor ? ep.flrZ : ep.topZ;
      }
      return isFloor ? ctx.zWaterCarveFloor : ctx.zWaterTop;
    };

    return { terrainManifold, waterManifold, unionedWaterRings, waterMaskPolys2D, queryWaterZAt, slopedRiverSegments: slopedReaches.length };
  }

  const exportsObj = { buildLayer1WaterAndCarve };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
