// ============================================================================
// src/mesh/terrain_surface_drape.js
// Planar Road/Quay/Pedestrian/Greenery Extraction, Waterfront Protection & TIN Drape
// ============================================================================

(function (root) {
  function _getCore() {
    if (typeof getManifoldLib === 'function' && typeof clipperUnionPolys === 'function') {
      return {
        signedArea2D, ensureWinding, clipperUnionPolys, clipperIntersectPolys, clipperDiffPolys,
        clipperOffsetPolys, clipperBufferOpenPaths, ringsToOutersWithHoles,
        safeDeleteManifold, batchUnionManifolds, extrudeRingSolid
      };
    }
    return require('../geometry/manifold_core.js');
  }

  function _regularizePolys2D(core, groups, minEdge = 6e-4, openEps = 3.5e-4) {
    const out = [], ringAbs = (r) => (r && r.length >= 3) ? Math.abs(core.signedArea2D(r)) : 0;
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
          if (ro.length < 3 || ringAbs(ro) < 1e-4) continue;
          const rh = (reg[ri].holes || [])
            .map(h => core.ensureWinding(h, false, minEdge))
            .filter(h => h.length >= 3 && ringAbs(h) >= 1e-4);
          out.push({ outer: ro, holes: rh, area: ringAbs(ro) });
        }
      } catch (_) {
        out.push({ outer: oClean, holes: g.holes || [], area: ringAbs(oClean) });
      }
    }
    return out;
  }

  function _buildClippedPolysExtrude(core, mf, polyPairs, zBot, zTop, clipRectPolys) {
    if (!polyPairs || polyPairs.length === 0) return null;
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

  function collectSurfacePolys(core, ctx, scene, plateClipPoly) {
    const { toBed, scaleToBed, scaleMm } = ctx;
    const roadRawPolys = [], waterfrontRawPolys = [], openRoadLines = [], openQuayLines = [];

    for (const rd of (scene && scene.roads) || []) {
      if (!rd || !rd.pts || rd.pts.length < 2 || rd.bridge || rd.isBridge) continue;
      const mm = String(rd.man_made || '').toLowerCase();
      if (mm === 'pier' || mm === 'breakwater' || mm === 'groyne' || mm === 'jetty' || mm === 'pontoon') continue;
      const bedPts = rd.pts.map(toBed);
      const minW = Math.max(ctx.minPrintU * 0.42, (rd.isPath ? 0.25 : 0.45) / scaleMm);
      const halfW = Math.max(minW, ((rd.width || 0.7) * 0.5) * scaleToBed);
      if (rd.isQuay || mm === 'quay' || rd.hwy === 'quay') openQuayLines.push({ pts: bedPts, halfW });
      else openRoadLines.push({ pts: bedPts, halfW });
    }
    if (openRoadLines.length > 0) {
      for (const r of core.clipperBufferOpenPaths(openRoadLines, 'Round', 1e-5)) roadRawPolys.push(r);
    }
    if (openQuayLines.length > 0) {
      for (const r of core.clipperBufferOpenPaths(openQuayLines, 'Round', 1e-5)) waterfrontRawPolys.push(r);
    }

    for (const rp of (scene && scene.roadPolys) || []) {
      if (!rp || !rp.outer || rp.outer.length < 3) continue;
      const oBed = rp.outer.map(toBed);
      const holesBed = (rp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed));
      const clean = holesBed.length > 0 ? core.clipperDiffPolys([oBed], holesBed, 1e-5) : [oBed];
      const isProtected = Boolean(
        rp.isQuay || rp.isAreaHighway || rp.isWaterfrontPromenade ||
        rp.hwy === 'quay' || rp.hwy === 'area:highway' || rp.hwy === 'pedestrian'
      );
      for (const r of clean) {
        if (isProtected) waterfrontRawPolys.push(r);
        else roadRawPolys.push(r);
      }
    }

    let protectedWaterfrontPolys = waterfrontRawPolys.length > 0 ? core.clipperUnionPolys(waterfrontRawPolys, 1e-5) : [];
    if (protectedWaterfrontPolys.length > 0) {
      protectedWaterfrontPolys = core.clipperIntersectPolys(protectedWaterfrontPolys, plateClipPoly, 1e-5);
    }

    const greenRawPolys = [];
    for (const gp of (scene && scene.greenPolys) || []) {
      if (!gp || !gp.outer || gp.outer.length < 3) continue;
      const oBed = gp.outer.map(toBed);
      const holesBed = (gp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed));
      const clean = holesBed.length > 0 ? core.clipperDiffPolys([oBed], holesBed, 1e-5) : [oBed];
      for (const r of clean) greenRawPolys.push(r);
    }

    return { roadRawPolys, protectedWaterfrontPolys, greenRawPolys };
  }

  function buildSurfaceDrapesAndFrame(core, mf, ctx, terrainManifold, plateClipPoly, unionedWaterRings, surfaceData) {
    const { halfW, halfH, scaleMm } = ctx;
    const { roadRawPolys, protectedWaterfrontPolys, greenRawPolys } = surfaceData;

    let regularRoadRings = roadRawPolys.length > 0 ? core.clipperUnionPolys(roadRawPolys, 1e-5) : [];
    if (regularRoadRings.length > 0) {
      regularRoadRings = core.clipperIntersectPolys(regularRoadRings, plateClipPoly, 1e-5);
    }
    if (regularRoadRings.length > 0 && unionedWaterRings.length > 0) {
      regularRoadRings = core.clipperDiffPolys(regularRoadRings, unionedWaterRings, 1e-5);
    }

    const roadUnionRings = (regularRoadRings.length > 0 || protectedWaterfrontPolys.length > 0)
      ? core.clipperUnionPolys([...regularRoadRings, ...protectedWaterfrontPolys], 1e-5)
      : [];
    const roadPolys2D = _regularizePolys2D(core, core.ringsToOutersWithHoles(roadUnionRings, 6e-4), 6e-4, 3.5e-4);

    let greenUnionRings = greenRawPolys.length > 0 ? core.clipperUnionPolys(greenRawPolys, 1e-5) : [];
    greenUnionRings = greenUnionRings.length > 0 ? core.clipperIntersectPolys(greenUnionRings, plateClipPoly, 1e-5) : [];
    if (greenUnionRings.length > 0 && unionedWaterRings.length > 0) {
      greenUnionRings = core.clipperDiffPolys(greenUnionRings, unionedWaterRings, 1e-5);
    }
    if (greenUnionRings.length > 0 && roadUnionRings.length > 0) {
      greenUnionRings = core.clipperDiffPolys(greenUnionRings, roadUnionRings, 1e-5);
    }
    const greenPolys2D = _regularizePolys2D(core, core.ringsToOutersWithHoles(greenUnionRings, 6e-4), 6e-4, 3.5e-4);

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
      let raisedTerrain = null, clippedRaised = null, slab = null;
      try {
        raisedTerrain = terrainManifold.translate([0, 0, thicknessU]);
        clippedRaised = raisedTerrain.intersect(maskPrism);
        slab = clippedRaised.subtract(terrainManifold);
        if (!slab || slab.numTri() === 0) { core.safeDeleteManifold(slab); return null; }
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

    let frameManifold = null;
    if (!ctx.state || ctx.state.showFrame !== false) {
      const cfg = ctx.cfg || {}, gapU = (cfg.frameInnerGapMm || 0.47) / scaleMm;
      const fwMm = (ctx.state && Number(ctx.state.frameWidthMm) > 0) ? Number(ctx.state.frameWidthMm) : (cfg.defaultFrameWidthMm || 12.0);
      const fwU = fwMm / scaleMm, innerW = halfW + gapU, innerH = halfH + gapU, outerW = halfW + fwU, outerH = halfH + fwU;
      const z0 = -(cfg.frameSkirtDepthMm || 1.6) / scaleMm, z1 = ctx.zLandDatum + ((cfg.frameLipAboveBaseMm || 1.1) / scaleMm);
      frameManifold = core.extrudeRingSolid(
        mf,
        [[-outerW, -outerH], [outerW, -outerH], [outerW, outerH], [-outerW, outerH]],
        [[[-innerW, -innerH], [innerW, -innerH], [innerW, innerH], [-innerW, innerH]]],
        z0, z1
      );
    }

    return { greeneryManifold, roadManifold, frameManifold, roadPolys2D, greenPolys2D, hGreenU, hRoadU };
  }

  const exportsObj = { _regularizePolys2D, _buildClippedPolysExtrude, collectSurfacePolys, buildSurfaceDrapesAndFrame };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
