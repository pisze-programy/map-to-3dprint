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

  const FOOTPATH_HWY_SET = new Set(['footway', 'path', 'cycleway', 'steps', 'bridleway', 'track', 'corridor']);
  const MARINE_PIER_SET = new Set(['pier', 'breakwater', 'groyne', 'jetty', 'pontoon']);

  function isFootpathRoad(rd) {
    if (!rd) return false;
    if (rd.isPath) return true;
    return FOOTPATH_HWY_SET.has(String(rd.hwy || rd.type || rd.rtype || '').toLowerCase());
  }

  function _shrinkStructuredPolys2D(core, structuredPolys, shrinkDist) {
    if (!structuredPolys || structuredPolys.length === 0) return [];
    if (!(shrinkDist > 1e-6)) {
      const passthrough = [];
      for (let i = 0; i < structuredPolys.length; i++) {
        const sp = structuredPolys[i];
        const clean = sp.holes && sp.holes.length > 0 ? core.clipperDiffPolys([sp.outer], sp.holes, 1e-5) : [sp.outer];
        for (let k = 0; k < clean.length; k++) passthrough.push(clean[k]);
      }
      return passthrough.length > 1 ? core.clipperUnionPolys(passthrough, 1e-5) : passthrough;
    }
    const out = [];
    for (let i = 0; i < structuredPolys.length; i++) {
      const sp = structuredPolys[i];
      if (!sp || !sp.outer || sp.outer.length < 3) continue;
      const shrunkOuter = core.clipperOffsetPolys([sp.outer], -shrinkDist, 'Miter', 1e-5);
      if (shrunkOuter.length === 0) continue;
      let cur = shrunkOuter;
      if (sp.holes && sp.holes.length > 0) {
        const grownHoles = core.clipperOffsetPolys(sp.holes, shrinkDist, 'Miter', 1e-5);
        if (grownHoles.length > 0) cur = core.clipperDiffPolys(cur, grownHoles, 1e-5);
      }
      for (let k = 0; k < cur.length; k++) out.push(cur[k]);
    }
    return out.length > 1 ? core.clipperUnionPolys(out, 1e-5) : out;
  }

  function collectPrintedBuildingFootprints2D(core, ctx, scene, plateClipPoly) {
    if (ctx && ctx.state && ctx.state.layerVisible && ctx.state.layerVisible.buildings === false) return [];
    const buildings = (scene && scene.buildings) || [];
    if (buildings.length === 0) return [];
    const { toBed, halfW: bedHalfW = 85, halfH: bedHalfH = 85 } = ctx;
    const limX = bedHalfW + 1.0, limY = bedHalfH + 1.0;
    const rawBldRings = [];
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (!b || b.hidden || b.isOutline || b.btype === 'pier' || !b.outer || b.outer.length < 3) continue;
      const tags = b.tags || {};
      const mm = String(tags.man_made || b.man_made || '').toLowerCase().trim();
      if (MARINE_PIER_SET.has(mm)) continue;
      const rawMinH = Math.max(0, Number(b.minH !== undefined ? b.minH : (tags.min_height || 0)) || 0);
      // Allow streets/alleys to pass cleanly beneath elevated bridge-buildings, gatehouses & skybridges
      if (rawMinH > 2.5) continue;
      const oBed = b.outer.map(toBed);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let p = 0; p < oBed.length; p++) {
        const px = oBed[p][0], py = oBed[p][1];
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
      if (maxX < -limX || minX > limX || maxY < -limY || minY > limY) continue;
      const holesBed = (b.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed));
      const clean = holesBed.length > 0 ? core.clipperDiffPolys([oBed], holesBed, 1e-5) : [oBed];
      for (let k = 0; k < clean.length; k++) rawBldRings.push(clean[k]);
    }
    if (rawBldRings.length === 0) return [];
    const unioned = core.clipperUnionPolys(rawBldRings, 1e-5);
    return (plateClipPoly && plateClipPoly.length > 0 && unioned.length > 0)
      ? core.clipperIntersectPolys(unioned, plateClipPoly, 1e-5)
      : unioned;
  }

  function _getSplitOutsideFn() {
    if (typeof _splitPolylineOutsideRingsJS === 'function') return _splitPolylineOutsideRingsJS;
    if (typeof require === 'function') return require('./bridges/bridge_geom_2d.js')._splitPolylineOutsideRingsJS;
    return null;
  }

  function collectSurfacePolys(core, ctx, scene, plateClipPoly) {
    const { toBed, scaleToBed, scaleMm } = ctx;
    const mToBedXY = ((ctx.mToU || ctx.metersToUnits || (scene && scene.metersToUnits) || (scene && scene.meta && scene.meta.metersToUnits)) || 0.141) * (scaleToBed || 1.0);
    const lod = (ctx.state && ctx.state.lodSettings) || {};
    const roadDetail = lod.roadDetail || 'all';
    const roadRawPolys = [], footpathRawPolys = [], waterfrontRawPolys = [];
    const openStreetLines = [], openFootpathLines = [], openQuayLines = [];

    const bpEntries = [];
    for (const bp of (scene && scene.bridgePolys) || []) {
      if (!bp || bp.isPier || !bp.outer || bp.outer.length < 3) continue;
      bpEntries.push({ bp, outerBed: bp.outer.map(toBed) });
    }
    const splitOutsideFn = bpEntries.length > 0 ? _getSplitOutsideFn() : null;

    for (const rd of (scene && scene.roads) || []) {
      if (!rd || !rd.pts || rd.pts.length < 2) continue;
      const mm = String(rd.man_made || '').toLowerCase();
      if (MARINE_PIER_SET.has(mm)) continue;

      let candidatePolylines = null;
      if (rd.bridge || rd.isBridge) {
        const rawBr = String((rd.tags && rd.tags.bridge) || rd.bridgeStructure || '').trim().toLowerCase();
        if (rawBr !== 'boardwalk' || !splitOutsideFn || bpEntries.length === 0) continue;
        const linkedRings = [];
        const idSet = new Set(rd._bridgePolyOsmIds || (rd._bridgePolyOsmId != null ? [rd._bridgePolyOsmId] : []));
        for (const e of bpEntries) {
          if ((e.bp.osmId != null && idSet.has(e.bp.osmId)) ||
              (rd.osmId != null && Array.isArray(e.bp.acrossRoadIds) && e.bp.acrossRoadIds.includes(rd.osmId))) {
            linkedRings.push(e.outerBed);
          }
        }
        if (linkedRings.length === 0) continue;
        const subs = splitOutsideFn(rd.pts.map(toBed), linkedRings, Math.max(0.25, 0.6 * mToBedXY), Math.max(0.10, 0.8 * mToBedXY));
        if (!subs.length) continue;
        candidatePolylines = subs.map(s => s.pts);
      } else {
        candidatePolylines = [rd.pts.map(toBed)];
      }

      const isQuay = Boolean(rd.isQuay || mm === 'quay' || rd.hwy === 'quay');
      const isPath = !isQuay && isFootpathRoad(rd);
      const hwyNorm = String(rd.hwy || '').toLowerCase();
      if (roadDetail === 'major' && !isQuay && (isPath || hwyNorm === 'service' || hwyNorm === 'living_street')) continue;

      // Physical MSLA minimum width (0.45 mm cured street wall, 0.25 mm embossed park path) converted to buffer half-width (radius = 0.5 * fullW)
      const fullMinMm = isPath ? 0.25 : 0.45;
      const minHalfW = isPath
        ? Math.max((fullMinMm * 0.5) / scaleMm, ((ctx.xyPixelMm || 0.017) * 6) / scaleMm)
        : Math.max(ctx.minPrintU * 0.5, (fullMinMm * 0.5) / scaleMm);
      const halfW = Math.max(minHalfW, ((rd.width || (isPath ? 0.30 : 0.70)) * 0.5) * scaleToBed);
      const cullX = (ctx.halfW || 85) + halfW + 1.0;
      const cullY = (ctx.halfH || 85) + halfW + 1.0;
      for (const bedPts of candidatePolylines) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let p = 0; p < bedPts.length; p++) {
          const px = bedPts[p][0], py = bedPts[p][1];
          if (px < minX) minX = px; if (px > maxX) maxX = px;
          if (py < minY) minY = py; if (py > maxY) maxY = py;
        }
        if (maxX < -cullX || minX > cullX || maxY < -cullY || minY > cullY) continue;
        if (isQuay) openQuayLines.push({ pts: bedPts, halfW });
        else if (isPath) openFootpathLines.push({ pts: bedPts, halfW });
        else openStreetLines.push({ pts: bedPts, halfW });
      }
    }
    if (openStreetLines.length > 0) {
      for (const r of core.clipperBufferOpenPaths(openStreetLines, 'Round', 1e-5)) roadRawPolys.push(r);
    }
    if (openFootpathLines.length > 0) {
      for (const r of core.clipperBufferOpenPaths(openFootpathLines, 'Round', 1e-5)) footpathRawPolys.push(r);
    }
    if (openQuayLines.length > 0) {
      for (const r of core.clipperBufferOpenPaths(openQuayLines, 'Round', 1e-5)) waterfrontRawPolys.push(r);
    }

    const greenRawPolys = [], greenWithArea = [];
    for (const gp of (scene && scene.greenPolys) || []) {
      if (!gp || !gp.outer || gp.outer.length < 3) continue;
      const oBed = gp.outer.map(toBed);
      const holesBed = (gp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed));
      const clean = holesBed.length > 0 ? core.clipperDiffPolys([oBed], holesBed, 1e-5) : [oBed];
      for (const r of clean) {
        greenRawPolys.push(r);
        greenWithArea.push({ ring: r, area: Math.abs(core.signedArea2D(r)) });
      }
    }

    for (const rp of (scene && scene.roadPolys) || []) {
      if (!rp || !rp.outer || rp.outer.length < 3) continue;
      const oBed = rp.outer.map(toBed);
      const holesBed = (rp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed));
      let clean = holesBed.length > 0 ? core.clipperDiffPolys([oBed], holesBed, 1e-5) : [oBed];
      const isProtected = Boolean(
        rp.isQuay || rp.isAreaHighway || rp.isWaterfrontPromenade ||
        rp.hwy === 'quay' || rp.hwy === 'area:highway' || rp.hwy === 'pedestrian'
      );
      // Preserve explicit park/garden islands inside uncarved town squares (e.g. Python prebuilt scenes)
      if (!rp._greenIslandsCarved && !rp.isQuay && rp.hwy !== 'quay' && greenWithArea.length > 0 && clean.length > 0) {
        const rpArea = Math.abs(core.signedArea2D(oBed));
        const cutters = greenWithArea.filter(g => rpArea >= g.area * 0.45).map(g => g.ring);
        if (cutters.length > 0) clean = core.clipperDiffPolys(clean, cutters, 1e-5);
      }
      for (const r of clean) {
        if (isProtected) waterfrontRawPolys.push(r);
        else roadRawPolys.push(r);
      }
    }

    let protectedWaterfrontPolys = waterfrontRawPolys.length > 0 ? core.clipperUnionPolys(waterfrontRawPolys, 1e-5) : [];
    if (protectedWaterfrontPolys.length > 0) {
      protectedWaterfrontPolys = core.clipperIntersectPolys(protectedWaterfrontPolys, plateClipPoly, 1e-5);
    }

    const bldFootprintPolys = collectPrintedBuildingFootprints2D(core, ctx, scene, plateClipPoly);
    return { roadRawPolys, footpathRawPolys, protectedWaterfrontPolys, greenRawPolys, bldFootprintPolys };
  }

  function buildSurfaceDrapesAndFrame(core, mf, ctx, terrainManifold, plateClipPoly, unionedWaterRings, surfaceData) {
    const { halfW, halfH, scaleMm } = ctx;
    const {
      roadRawPolys,
      footpathRawPolys = [],
      protectedWaterfrontPolys,
      greenRawPolys,
      bldFootprintPolys = []
    } = surfaceData;

    let regularStreetRings = roadRawPolys.length > 0 ? core.clipperUnionPolys(roadRawPolys, 1e-5) : [];
    if (regularStreetRings.length > 0) {
      regularStreetRings = core.clipperIntersectPolys(regularStreetRings, plateClipPoly, 1e-5);
    }
    if (regularStreetRings.length > 0 && unionedWaterRings.length > 0) {
      regularStreetRings = core.clipperDiffPolys(regularStreetRings, unionedWaterRings, 1e-5);
    }

    let streetUnionRings = (regularStreetRings.length > 0 || protectedWaterfrontPolys.length > 0)
      ? core.clipperUnionPolys([...regularStreetRings, ...protectedWaterfrontPolys], 1e-5)
      : [];
    if (streetUnionRings.length > 0 && bldFootprintPolys.length > 0) {
      streetUnionRings = core.clipperDiffPolys(streetUnionRings, bldFootprintPolys, 1e-5);
    }
    const streetPolys2D = _regularizePolys2D(core, core.ringsToOutersWithHoles(streetUnionRings, 6e-4), 6e-4, 3.5e-4);

    // Greenery is carved ONLY by water, grounded buildings, and vehicular streets/plazas — NEVER by footpaths!
    let greenUnionRings = greenRawPolys.length > 0 ? core.clipperUnionPolys(greenRawPolys, 1e-5) : [];
    greenUnionRings = greenUnionRings.length > 0 ? core.clipperIntersectPolys(greenUnionRings, plateClipPoly, 1e-5) : [];
    if (greenUnionRings.length > 0 && unionedWaterRings.length > 0) {
      greenUnionRings = core.clipperDiffPolys(greenUnionRings, unionedWaterRings, 1e-5);
    }
    if (greenUnionRings.length > 0 && bldFootprintPolys.length > 0) {
      greenUnionRings = core.clipperDiffPolys(greenUnionRings, bldFootprintPolys, 1e-5);
    }
    if (greenUnionRings.length > 0 && streetUnionRings.length > 0) {
      greenUnionRings = core.clipperDiffPolys(greenUnionRings, streetUnionRings, 1e-5);
    }
    const greenPolys2D = _regularizePolys2D(core, core.ringsToOutersWithHoles(greenUnionRings, 6e-4), 6e-4, 3.5e-4);

    // Footpaths & park alleys: subtracted by water and buildings, tucked slightly into streets, and draped ON TOP of parks
    let footpathRings = footpathRawPolys.length > 0 ? core.clipperUnionPolys(footpathRawPolys, 1e-5) : [];
    if (footpathRings.length > 0) {
      footpathRings = core.clipperIntersectPolys(footpathRings, plateClipPoly, 1e-5);
    }
    if (footpathRings.length > 0 && unionedWaterRings.length > 0) {
      footpathRings = core.clipperDiffPolys(footpathRings, unionedWaterRings, 1e-5);
    }
    if (footpathRings.length > 0 && bldFootprintPolys.length > 0) {
      footpathRings = core.clipperDiffPolys(footpathRings, bldFootprintPolys, 1e-5);
    }
    if (footpathRings.length > 0 && streetPolys2D.length > 0) {
      const streetCoreBlock = _shrinkStructuredPolys2D(core, streetPolys2D, Math.min(0.04 / scaleMm, 0.03));
      if (streetCoreBlock.length > 0) {
        footpathRings = core.clipperDiffPolys(footpathRings, streetCoreBlock, 1e-5);
      }
    }

    let footpathGroundPolys2D = [], footpathGreenPolys2D = [];
    if (footpathRings.length > 0) {
      if (greenPolys2D.length > 0) {
        const greenOnParkMask = _shrinkStructuredPolys2D(core, greenPolys2D, 0.025 / scaleMm);
        const greenGroundCutMask = _shrinkStructuredPolys2D(core, greenPolys2D, 0.065 / scaleMm);
        const onGreenRings = greenOnParkMask.length > 0 ? core.clipperIntersectPolys(footpathRings, greenOnParkMask, 1e-5) : [];
        const onGroundRings = greenGroundCutMask.length > 0 ? core.clipperDiffPolys(footpathRings, greenGroundCutMask, 1e-5) : footpathRings;
        footpathGreenPolys2D = _regularizePolys2D(core, core.ringsToOutersWithHoles(onGreenRings, 6e-4), 6e-4, 2.5e-4);
        footpathGroundPolys2D = _regularizePolys2D(core, core.ringsToOutersWithHoles(onGroundRings, 6e-4), 6e-4, 2.5e-4);
      } else {
        footpathGroundPolys2D = _regularizePolys2D(core, core.ringsToOutersWithHoles(footpathRings, 6e-4), 6e-4, 2.5e-4);
      }
    }

    const hGreenU = Math.max(0.22 / scaleMm, ((ctx.cfg && ctx.cfg.greeneryHeightMm) || 0.454) / scaleMm);
    const hRoadU = Math.max(0.26 / scaleMm, ((ctx.cfg && ctx.cfg.roadHeightMm) || 0.567) / scaleMm);
    const hFootpathU = Math.max(0.15 / scaleMm, ((ctx.cfg && ctx.cfg.footpathHeightMm) || 0.303) / scaleMm);

    const drapePolysOntoTerrain = (structuredPolys, zOffBotU, zOffTopU) => {
      if (!structuredPolys || structuredPolys.length === 0 || !terrainManifold || terrainManifold.numTri() === 0 || !(zOffTopU > zOffBotU + 1e-5)) return null;
      if (ctx.elevReliefM <= 0.35) {
        return _buildClippedPolysExtrude(core, mf, structuredPolys, ctx.zLandDatum + zOffBotU, ctx.zLandDatum + zOffTopU, plateClipPoly);
      }
      const tMaxZ = terrainManifold.boundingBox().max[2] + zOffTopU + 5.0;
      const maskPrism = _buildClippedPolysExtrude(core, mf, structuredPolys, -0.5, tMaxZ, plateClipPoly);
      if (!maskPrism) return null;
      let raisedTop = null, raisedBot = null, clippedTop = null, slab = null;
      try {
        raisedTop = terrainManifold.translate([0, 0, zOffTopU]);
        clippedTop = raisedTop.intersect(maskPrism);
        if (zOffBotU > 1e-5) {
          raisedBot = terrainManifold.translate([0, 0, zOffBotU]);
          slab = clippedTop.subtract(raisedBot);
        } else {
          slab = clippedTop.subtract(terrainManifold);
        }
        if (!slab || slab.numTri() === 0) { core.safeDeleteManifold(slab); return null; }
        return slab;
      } catch (_) {
        core.safeDeleteManifold(slab);
        return null;
      } finally {
        core.safeDeleteManifold(maskPrism);
        core.safeDeleteManifold(raisedTop);
        core.safeDeleteManifold(raisedBot);
        core.safeDeleteManifold(clippedTop);
      }
    };

    const greeneryManifold = drapePolysOntoTerrain(greenPolys2D, 0, hGreenU);
    const streetManifold = drapePolysOntoTerrain(streetPolys2D, 0, hRoadU);
    const fpGroundManifold = drapePolysOntoTerrain(footpathGroundPolys2D, 0, hFootpathU);
    const zParkAnchorBotU = Math.min(hFootpathU * 0.58, hGreenU * 0.45);
    const fpGreenManifold = drapePolysOntoTerrain(footpathGreenPolys2D, zParkAnchorBotU, hGreenU + hFootpathU);
    const roadParts = [streetManifold, fpGroundManifold, fpGreenManifold].filter(Boolean);
    const roadManifold = roadParts.length === 0 ? null : (roadParts.length === 1 ? roadParts[0] : core.batchUnionManifolds(mf, roadParts));

    const allRoadAndPathRings = (streetUnionRings.length > 0 || footpathRings.length > 0)
      ? core.clipperUnionPolys([...streetUnionRings, ...footpathRings], 1e-5)
      : [];
    const roadPolys2D = allRoadAndPathRings.length > 0
      ? _regularizePolys2D(core, core.ringsToOutersWithHoles(allRoadAndPathRings, 6e-4), 6e-4, 2.5e-4)
      : streetPolys2D;
    const footpathPolys2D = footpathRings.length > 0
      ? core.ringsToOutersWithHoles(footpathRings, 6e-4)
      : [];

    let frameManifold = null;
    if (!ctx.state || ctx.state.showFrame !== false) {
      const cfg = ctx.cfg || {}, gapU = (cfg.frameInnerGapMm || 0.47) / scaleMm;
      const fwMm = (ctx.state && Number(ctx.state.frameWidthMm) > 0) ? Number(ctx.state.frameWidthMm) : (cfg.defaultFrameWidthMm || 12.0);
      const fwU = fwMm / scaleMm, innerW = halfW + gapU, innerH = halfH + gapU;
      const outerW = Math.max(innerW + 0.8 / scaleMm, halfW + fwU), outerH = Math.max(innerH + 0.8 / scaleMm, halfH + fwU);
      const z0 = -(cfg.frameSkirtDepthMm || 1.6) / scaleMm, z1 = ctx.zLandDatum + ((cfg.frameLipAboveBaseMm || 1.1) / scaleMm);
      frameManifold = core.extrudeRingSolid(
        mf,
        [[-outerW, -outerH], [outerW, -outerH], [outerW, outerH], [-outerW, outerH]],
        [[[-innerW, -innerH], [innerW, -innerH], [innerW, innerH], [-innerW, innerH]]],
        z0, z1
      );
    }

    return {
      greeneryManifold, roadManifold, frameManifold,
      roadPolys2D, streetPolys2D, footpathPolys2D, greenPolys2D,
      hGreenU, hRoadU, hFootpathU
    };
  }

  const exportsObj = {
    isFootpathRoad,
    _regularizePolys2D,
    _buildClippedPolysExtrude,
    collectPrintedBuildingFootprints2D,
    collectSurfacePolys,
    buildSurfaceDrapesAndFrame
  };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
