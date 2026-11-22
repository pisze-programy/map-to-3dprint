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
        safeDeleteManifold, batchUnionManifolds, extrudeRingSolid, boxManifoldFromBounds
      };
    }
    return require('../geometry/manifold_core.js');
  }

  function _tryWasmOffsetStructured(core, groups, delta, minEdge = 6e-4) {
    let totalContours = 0;
    for (let i = 0; i < (groups || []).length; i++) {
      const g = groups[i];
      if (g && g.outer) totalContours += 1 + (g.holes ? g.holes.length : 0);
    }
    if (totalContours < 250) return null;
    try {
      const gRoot = typeof globalThis !== 'undefined' ? globalThis : window;
      const mf = gRoot.__MANIFOLD_LIB__ || (typeof gRoot.__getManifoldSync === 'function' ? gRoot.__getManifoldSync() : null);
      if (!mf || !mf.CrossSection) return null;
      const allRings = [];
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        if (!g || !g.outer || g.outer.length < 3) continue;
        const o = core.ensureWinding(g.outer, true, minEdge);
        if (o.length < 3) continue;
        allRings.push(o);
        for (let hi = 0; hi < (g.holes || []).length; hi++) {
          const h = core.ensureWinding(g.holes[hi], false, minEdge);
          if (h.length >= 3) allRings.push(h);
        }
      }
      if (allRings.length === 0) return [];
      const cs = mf.CrossSection.ofPolygons(allRings, 'Positive');
      const csOff = Math.abs(delta) > 1e-7 ? cs.offset(delta, 'Miter', 2.5) : cs;
      if (csOff !== cs) cs.delete();
      const raw = csOff.toPolygons();
      csOff.delete();
      const cleaned = [];
      for (let i = 0; i < raw.length; i++) {
        const c = core.ensureWinding(raw[i], null, minEdge);
        if (c.length >= 3 && Math.abs(core.signedArea2D(c)) >= 1e-5) cleaned.push(c);
      }
      return cleaned;
    } catch (_) {
      return null;
    }
  }

  function _regularizePolys2D(core, groups, minEdge = 6e-4, openEps = 3.5e-4) {
    const out = [], ringAbs = (r) => (r && r.length >= 3) ? Math.abs(core.signedArea2D(r)) : 0;
    const fastRings = _tryWasmOffsetStructured(core, groups, -openEps, minEdge);
    if (fastRings !== null) {
      const reg = core.ringsToOutersWithHoles(fastRings, minEdge);
      for (let ri = 0; ri < reg.length; ri++) {
        const ro = core.ensureWinding(reg[ri].outer, true, minEdge);
        if (ro.length < 3 || ringAbs(ro) < 1e-4) continue;
        const rh = (reg[ri].holes || [])
          .map(h => core.ensureWinding(h, false, minEdge))
          .filter(h => h.length >= 3 && ringAbs(h) >= 1e-4);
        out.push({ outer: ro, holes: rh, area: ringAbs(ro) });
      }
      return out;
    }
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

    let totalContours = 0;
    for (let i = 0; i < polyPairs.length; i++) {
      if (polyPairs[i] && polyPairs[i].outer) totalContours += 1 + (polyPairs[i].holes ? polyPairs[i].holes.length : 0);
    }
    if (totalContours >= 120 && mf && mf.CrossSection) {
      let csSubj = null, csClip = null, csFinal = null;
      try {
        const directRings = [];
        for (let i = 0; i < polyPairs.length; i++) {
          const pp = polyPairs[i];
          if (!pp || !pp.outer || pp.outer.length < 3) continue;
          const o = core.ensureWinding(pp.outer, true, 6e-4);
          if (o.length < 3) continue;
          directRings.push(o);
          for (const h of (pp.holes || [])) {
            const hc = core.ensureWinding(h, false, 6e-4);
            if (hc.length >= 3) directRings.push(hc);
          }
        }
        if (directRings.length === 0) return null;
        csSubj = mf.CrossSection.ofPolygons(directRings, 'Positive');
        if (clipRectPolys && clipRectPolys.length > 0) {
          csClip = mf.CrossSection.ofPolygons(clipRectPolys.map(r => core.ensureWinding(r, true, 1e-4)), 'Positive');
          csFinal = csSubj.intersect(csClip);
        } else {
          csFinal = csSubj;
          csSubj = null;
        }
        if (csFinal && (!csFinal.isEmpty || !csFinal.isEmpty())) {
          let man = csFinal.extrude(zTop - zBot);
          if (Math.abs(zBot) > 1e-7) {
            const shifted = man.translate([0, 0, zBot]);
            man.delete();
            man = shifted;
          }
          if (man && man.numTri() > 0) return man;
          core.safeDeleteManifold(man);
        }
        return null;
      } catch (_) {
        // Fallback to standard path below
      } finally {
        core.safeDeleteManifold(csSubj);
        core.safeDeleteManifold(csClip);
        core.safeDeleteManifold(csFinal);
      }
    }

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

    const allCrossRings = [];
    for (let i = 0; i < structured.length; i++) {
      const cleanOuter = core.ensureWinding(structured[i].outer, true, 6e-4);
      if (cleanOuter.length < 3) continue;
      allCrossRings.push(cleanOuter);
      for (const h of (structured[i].holes || [])) {
        const cwHole = core.ensureWinding(h, false, 6e-4);
        if (cwHole.length >= 3) allCrossRings.push(cwHole);
      }
    }
    if (allCrossRings.length === 0) return null;

    // Extrude all planar-disjoint Clipper2 polygons in ONE single CrossSection.extrude() call
    // instead of thousands of 3D Manifold extrusions + 3D CSG union tree.
    let cs = null;
    try {
      cs = mf.CrossSection.ofPolygons(allCrossRings, 'Positive');
      if (cs && (!cs.isEmpty || !cs.isEmpty())) {
        let man = cs.extrude(zTop - zBot);
        if (Math.abs(zBot) > 1e-7) {
          const shifted = man.translate([0, 0, zBot]);
          man.delete();
          man = shifted;
        }
        if (man && man.numTri() > 0) return man;
        core.safeDeleteManifold(man);
      }
    } catch (_) {
    } finally {
      core.safeDeleteManifold(cs);
    }

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
    const fastRings = _tryWasmOffsetStructured(core, structuredPolys, -(shrinkDist > 1e-6 ? shrinkDist : 0), 4e-4);
    if (fastRings !== null) return fastRings;
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

  function* _collectSurfacePolysGen(core, ctx, scene, plateClipPoly) {
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
    yield;
    if (openStreetLines.length > 0) {
      for (const r of core.clipperBufferOpenPaths(openStreetLines, 'Round', 1e-5)) roadRawPolys.push(r);
      yield;
    }
    if (openFootpathLines.length > 0) {
      for (const r of core.clipperBufferOpenPaths(openFootpathLines, 'Round', 1e-5)) footpathRawPolys.push(r);
      yield;
    }
    if (openQuayLines.length > 0) {
      for (const r of core.clipperBufferOpenPaths(openQuayLines, 'Round', 1e-5)) waterfrontRawPolys.push(r);
      yield;
    }

    const ringBb2D = (ring) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < ring.length; i++) {
        const px = ring[i][0], py = ring[i][1];
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
      }
      return [x0, y0, x1, y1];
    };
    const polyCullX = (ctx.halfW || 85) + 1.5;
    const polyCullY = (ctx.halfH || 85) + 1.5;

    const greenRawPolys = [], greenWithArea = [];
    for (const gp of (scene && scene.greenPolys) || []) {
      if (!gp || !gp.outer || gp.outer.length < 3) continue;
      const oBed = gp.outer.map(toBed);
      const gbb = ringBb2D(oBed);
      if (gbb[2] < -polyCullX || gbb[0] > polyCullX || gbb[3] < -polyCullY || gbb[1] > polyCullY) continue;
      const holesBed = (gp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed));
      const clean = holesBed.length > 0 ? core.clipperDiffPolys([oBed], holesBed, 1e-5) : [oBed];
      for (const r of clean) {
        greenRawPolys.push(r);
        greenWithArea.push({ ring: r, area: Math.abs(core.signedArea2D(r)), bb: ringBb2D(r) });
      }
    }
    yield;

    for (const rp of (scene && scene.roadPolys) || []) {
      if (!rp || !rp.outer || rp.outer.length < 3) continue;
      const oBed = rp.outer.map(toBed);
      const rbb = ringBb2D(oBed);
      if (rbb[2] < -polyCullX || rbb[0] > polyCullX || rbb[3] < -polyCullY || rbb[1] > polyCullY) continue;
      const holesBed = (rp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed));
      let clean = holesBed.length > 0 ? core.clipperDiffPolys([oBed], holesBed, 1e-5) : [oBed];
      const isProtected = Boolean(
        rp.isQuay || rp.isAreaHighway || rp.isWaterfrontPromenade ||
        rp.hwy === 'quay' || rp.hwy === 'area:highway' || rp.hwy === 'pedestrian'
      );
      // Preserve explicit park/garden islands inside uncarved town squares (e.g. Python prebuilt scenes)
      if (!rp._greenIslandsCarved && !rp.isQuay && rp.hwy !== 'quay' && greenWithArea.length > 0 && clean.length > 0) {
        const rpArea = Math.abs(core.signedArea2D(oBed));
        const cutters = greenWithArea
          .filter(g => rpArea >= g.area * 0.45 && g.bb[2] >= rbb[0] && g.bb[0] <= rbb[2] && g.bb[3] >= rbb[1] && g.bb[1] <= rbb[3])
          .map(g => g.ring);
        if (cutters.length > 0) clean = core.clipperDiffPolys(clean, cutters, 1e-5);
      }
      for (const r of clean) {
        if (isProtected) waterfrontRawPolys.push(r);
        else roadRawPolys.push(r);
      }
    }
    yield;

    let protectedWaterfrontPolys = waterfrontRawPolys.length > 0 ? core.clipperUnionPolys(waterfrontRawPolys, 1e-5) : [];
    if (protectedWaterfrontPolys.length > 0) {
      protectedWaterfrontPolys = core.clipperIntersectPolys(protectedWaterfrontPolys, plateClipPoly, 1e-5);
    }
    yield;

    const bldFootprintPolys = collectPrintedBuildingFootprints2D(core, ctx, scene, plateClipPoly);
    return { roadRawPolys, footpathRawPolys, protectedWaterfrontPolys, greenRawPolys, bldFootprintPolys };
  }

  function collectSurfacePolys(core, ctx, scene, plateClipPoly) {
    const gen = _collectSurfacePolysGen(core, ctx, scene, plateClipPoly);
    let step;
    do { step = gen.next(); } while (!step.done);
    return step.value;
  }

  function* _buildSurfaceDrapesAndFrameGen(core, mf, ctx, terrainManifold, plateClipPoly, unionedWaterRings, surfaceData) {
    const { halfW, halfH, scaleMm } = ctx;
    const {
      roadRawPolys,
      footpathRawPolys = [],
      protectedWaterfrontPolys,
      greenRawPolys,
      bldFootprintPolys = []
    } = surfaceData;

    let regularStreetRings = roadRawPolys.length > 0 ? core.clipperUnionPolys(roadRawPolys, 1e-5) : [];
    yield;
    if (regularStreetRings.length > 0) {
      regularStreetRings = core.clipperIntersectPolys(regularStreetRings, plateClipPoly, 1e-5);
      yield;
    }
    if (regularStreetRings.length > 0 && unionedWaterRings.length > 0) {
      regularStreetRings = core.clipperDiffPolys(regularStreetRings, unionedWaterRings, 1e-5);
      yield;
    }

    let streetUnionRings = (regularStreetRings.length > 0 || protectedWaterfrontPolys.length > 0)
      ? core.clipperUnionPolys([...regularStreetRings, ...protectedWaterfrontPolys], 1e-5)
      : [];
    yield;
    if (streetUnionRings.length > 0 && bldFootprintPolys.length > 0) {
      streetUnionRings = core.clipperDiffPolys(streetUnionRings, bldFootprintPolys, 1e-5);
      yield;
    }
    const streetPolys2D = _regularizePolys2D(core, core.ringsToOutersWithHoles(streetUnionRings, 6e-4), 6e-4, 3.5e-4);
    yield;

    // Greenery is carved ONLY by water, grounded buildings, and vehicular streets/plazas -- NEVER by footpaths
    let greenUnionRings = greenRawPolys.length > 0 ? core.clipperUnionPolys(greenRawPolys, 1e-5) : [];
    greenUnionRings = greenUnionRings.length > 0 ? core.clipperIntersectPolys(greenUnionRings, plateClipPoly, 1e-5) : [];
    yield;
    if (greenUnionRings.length > 0 && unionedWaterRings.length > 0) {
      greenUnionRings = core.clipperDiffPolys(greenUnionRings, unionedWaterRings, 1e-5);
    }
    if (greenUnionRings.length > 0 && bldFootprintPolys.length > 0) {
      greenUnionRings = core.clipperDiffPolys(greenUnionRings, bldFootprintPolys, 1e-5);
    }
    yield;
    if (greenUnionRings.length > 0 && streetUnionRings.length > 0) {
      greenUnionRings = core.clipperDiffPolys(greenUnionRings, streetUnionRings, 1e-5);
    }
    const greenPolys2D = _regularizePolys2D(core, core.ringsToOutersWithHoles(greenUnionRings, 6e-4), 6e-4, 3.5e-4);
    yield;

    // Footpaths and park alleys: subtracted by water and buildings, tucked slightly into streets, draped on top of parks
    let footpathRings = footpathRawPolys.length > 0 ? core.clipperUnionPolys(footpathRawPolys, 1e-5) : [];
    if (footpathRings.length > 0) {
      footpathRings = core.clipperIntersectPolys(footpathRings, plateClipPoly, 1e-5);
    }
    yield;
    if (footpathRings.length > 0 && unionedWaterRings.length > 0) {
      footpathRings = core.clipperDiffPolys(footpathRings, unionedWaterRings, 1e-5);
    }
    if (footpathRings.length > 0 && bldFootprintPolys.length > 0) {
      footpathRings = core.clipperDiffPolys(footpathRings, bldFootprintPolys, 1e-5);
    }
    yield;
    if (footpathRings.length > 0 && streetPolys2D.length > 0) {
      const streetCoreBlock = _shrinkStructuredPolys2D(core, streetPolys2D, Math.min(0.04 / scaleMm, 0.03));
      yield;
      if (streetCoreBlock.length > 0) {
        footpathRings = core.clipperDiffPolys(footpathRings, streetCoreBlock, 1e-5);
        yield;
      }
    }

    let footpathGroundPolys2D = [], footpathGreenPolys2D = [];
    if (footpathRings.length > 0) {
      if (greenPolys2D.length > 0) {
        const greenOnParkMask = _shrinkStructuredPolys2D(core, greenPolys2D, 0.025 / scaleMm);
        const greenGroundCutMask = _shrinkStructuredPolys2D(core, greenPolys2D, 0.065 / scaleMm);
        yield;
        const onGreenRings = greenOnParkMask.length > 0 ? core.clipperIntersectPolys(footpathRings, greenOnParkMask, 1e-5) : [];
        const onGroundRings = greenGroundCutMask.length > 0 ? core.clipperDiffPolys(footpathRings, greenGroundCutMask, 1e-5) : footpathRings;
        yield;
        footpathGreenPolys2D = _regularizePolys2D(core, core.ringsToOutersWithHoles(onGreenRings, 6e-4), 6e-4, 2.5e-4);
        footpathGroundPolys2D = _regularizePolys2D(core, core.ringsToOutersWithHoles(onGroundRings, 6e-4), 6e-4, 2.5e-4);
      } else {
        footpathGroundPolys2D = _regularizePolys2D(core, core.ringsToOutersWithHoles(footpathRings, 6e-4), 6e-4, 2.5e-4);
      }
      yield;
    }

    const hGreenU = Math.max(0.22 / scaleMm, ((ctx.cfg && ctx.cfg.greeneryHeightMm) || 0.454) / scaleMm);
    const hRoadU = Math.max(0.26 / scaleMm, ((ctx.cfg && ctx.cfg.roadHeightMm) || 0.567) / scaleMm);
    const hFootpathU = Math.max(0.15 / scaleMm, ((ctx.cfg && ctx.cfg.footpathHeightMm) || 0.303) / scaleMm);

    // Lazily partition terrainManifold into spatial cells for large 3D drape booleans
    let cachedTerrCells = null;
    const ensureTerrCells = () => {
      if (cachedTerrCells) return cachedTerrCells;
      const tbb = terrainManifold.boundingBox();
      const x0 = tbb.min[0] - 0.05, x1 = tbb.max[0] + 0.05;
      const y0 = tbb.min[1] - 0.05, y1 = tbb.max[1] + 0.05;
      const z0 = tbb.min[2] - 0.5, z1 = tbb.max[2] + 5.0;
      const nx = (x1 - x0) > (y1 - y0) * 1.15 ? 3 : 2;
      const ny = (y1 - y0) > (x1 - x0) * 1.15 ? 3 : 2;
      const dx = (x1 - x0) / nx, dy = (y1 - y0) / ny;
      const seamPad = 2e-4;
      const cells = [];
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const cx0 = x0 + ix * dx - (ix > 0 ? seamPad : 0);
          const cx1 = x0 + (ix + 1) * dx + (ix < nx - 1 ? seamPad : 0);
          const cy0 = y0 + iy * dy - (iy > 0 ? seamPad : 0);
          const cy1 = y0 + (iy + 1) * dy + (iy < ny - 1 ? seamPad : 0);
          const cBox = core.boxManifoldFromBounds(mf, cx0, cx1, cy0, cy1, z0, z1);
          if (!cBox) continue;
          let tCell = null;
          try {
            tCell = terrainManifold.intersect(cBox);
          } catch (_) {
            tCell = null;
          } finally {
            core.safeDeleteManifold(cBox);
          }
          if (tCell && tCell.numTri() > 0) {
            cells.push({ cx0, cx1, cy0, cy1, terr: tCell });
          } else {
            core.safeDeleteManifold(tCell);
          }
        }
      }
      cachedTerrCells = cells;
      return cells;
    };

    function* drapePolysOntoTerrainGen(structuredPolys, zOffBotU, zOffTopU) {
      if (!structuredPolys || structuredPolys.length === 0 || !terrainManifold || terrainManifold.numTri() === 0 || !(zOffTopU > zOffBotU + 1e-5)) return null;
      if (ctx.elevReliefM <= 0.35) {
        const flatRes = _buildClippedPolysExtrude(core, mf, structuredPolys, ctx.zLandDatum + zOffBotU, ctx.zLandDatum + zOffTopU, plateClipPoly);
        yield;
        return flatRes;
      }

      let totalContours = 0;
      for (let i = 0; i < structuredPolys.length; i++) {
        if (structuredPolys[i] && structuredPolys[i].outer) {
          totalContours += 1 + (structuredPolys[i].holes ? structuredPolys[i].holes.length : 0);
        }
      }

      const tMaxZ = terrainManifold.boundingBox().max[2] + zOffTopU + 5.0;
      if (totalContours >= 250 && mf && mf.CrossSection && typeof core.boxManifoldFromBounds === 'function') {
        const directRings = [];
        for (let i = 0; i < structuredPolys.length; i++) {
          const pp = structuredPolys[i];
          if (!pp || !pp.outer || pp.outer.length < 3) continue;
          const o = core.ensureWinding(pp.outer, true, 6e-4);
          if (o.length < 3) continue;
          directRings.push(o);
          for (const h of (pp.holes || [])) {
            const hc = core.ensureWinding(h, false, 6e-4);
            if (hc.length >= 3) directRings.push(hc);
          }
        }
        if (directRings.length > 0) {
          let csSubj = null, csClip = null, csPlate = null;
          const cellSlabs = [];
          let chunkedOk = false;
          try {
            csSubj = mf.CrossSection.ofPolygons(directRings, 'Positive');
            yield;
            if (plateClipPoly && plateClipPoly.length > 0) {
              csClip = mf.CrossSection.ofPolygons(plateClipPoly.map(r => core.ensureWinding(r, true, 1e-4)), 'Positive');
              csPlate = csSubj.intersect(csClip);
            } else {
              csPlate = csSubj;
              csSubj = null;
            }
            yield;
            const cells = ensureTerrCells();
            if (csPlate && (!csPlate.isEmpty || !csPlate.isEmpty()) && cells.length > 0) {
              for (let ci = 0; ci < cells.length; ci++) {
                const cell = cells[ci];
                let csBox = null, csCell = null, cellPrism = null, raisedTop = null, raisedBot = null, clippedTop = null, slab = null;
                try {
                  csBox = mf.CrossSection.ofPolygons([[[cell.cx0, cell.cy0], [cell.cx1, cell.cy0], [cell.cx1, cell.cy1], [cell.cx0, cell.cy1]]], 'Positive');
                  csCell = csPlate.intersect(csBox);
                  if (csCell && (!csCell.isEmpty || !csCell.isEmpty())) {
                    cellPrism = csCell.extrude(tMaxZ - (-0.5));
                    const shifted = cellPrism.translate([0, 0, -0.5]);
                    cellPrism.delete();
                    cellPrism = shifted;
                    yield;
                    raisedTop = cell.terr.translate([0, 0, zOffTopU]);
                    clippedTop = raisedTop.intersect(cellPrism);
                    yield;
                    if (zOffBotU > 1e-5) {
                      raisedBot = cell.terr.translate([0, 0, zOffBotU]);
                      slab = clippedTop.subtract(raisedBot);
                    } else {
                      slab = clippedTop.subtract(cell.terr);
                    }
                    if (slab && slab.numTri() > 0) {
                      cellSlabs.push(slab);
                      slab = null;
                    }
                  }
                } finally {
                  core.safeDeleteManifold(csBox);
                  core.safeDeleteManifold(csCell);
                  core.safeDeleteManifold(cellPrism);
                  core.safeDeleteManifold(raisedTop);
                  core.safeDeleteManifold(raisedBot);
                  core.safeDeleteManifold(clippedTop);
                  core.safeDeleteManifold(slab);
                }
                yield;
              }
              chunkedOk = true;
            }
          } catch (_) {
            for (let k = 0; k < cellSlabs.length; k++) core.safeDeleteManifold(cellSlabs[k]);
            cellSlabs.length = 0;
            chunkedOk = false;
          } finally {
            core.safeDeleteManifold(csSubj);
            core.safeDeleteManifold(csClip);
            core.safeDeleteManifold(csPlate);
          }
          if (chunkedOk) {
            if (cellSlabs.length === 0) return null;
            const merged = cellSlabs.length === 1 ? cellSlabs[0] : core.batchUnionManifolds(mf, cellSlabs);
            yield;
            if (!merged || merged.numTri() === 0) { core.safeDeleteManifold(merged); return null; }
            return merged;
          }
        }
      }

      const maskPrism = _buildClippedPolysExtrude(core, mf, structuredPolys, -0.5, tMaxZ, plateClipPoly);
      yield;
      if (!maskPrism) return null;
      let raisedTop = null, raisedBot = null, clippedTop = null, slab = null;
      try {
        raisedTop = terrainManifold.translate([0, 0, zOffTopU]);
        clippedTop = raisedTop.intersect(maskPrism);
        yield;
        if (zOffBotU > 1e-5) {
          raisedBot = terrainManifold.translate([0, 0, zOffBotU]);
          slab = clippedTop.subtract(raisedBot);
        } else {
          slab = clippedTop.subtract(terrainManifold);
        }
        yield;
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
    }

    let greeneryManifold = null, streetManifold = null, fpGroundManifold = null, fpGreenManifold = null;
    try {
      greeneryManifold = yield* drapePolysOntoTerrainGen(greenPolys2D, 0, hGreenU);
      streetManifold = yield* drapePolysOntoTerrainGen(streetPolys2D, 0, hRoadU);
      fpGroundManifold = yield* drapePolysOntoTerrainGen(footpathGroundPolys2D, 0, hFootpathU);
      const zParkAnchorBotU = Math.min(hFootpathU * 0.58, hGreenU * 0.45);
      fpGreenManifold = yield* drapePolysOntoTerrainGen(footpathGreenPolys2D, zParkAnchorBotU, hGreenU + hFootpathU);
    } finally {
      if (cachedTerrCells) {
        for (let ci = 0; ci < cachedTerrCells.length; ci++) core.safeDeleteManifold(cachedTerrCells[ci].terr);
      }
    }
    const roadParts = [streetManifold, fpGroundManifold, fpGreenManifold].filter(Boolean);
    const roadManifold = roadParts.length === 0 ? null : (roadParts.length === 1 ? roadParts[0] : core.batchUnionManifolds(mf, roadParts));
    yield;

    const allRoadAndPathRings = (streetUnionRings.length > 0 || footpathRings.length > 0)
      ? core.clipperUnionPolys([...streetUnionRings, ...footpathRings], 1e-5)
      : [];
    yield;
    const roadPolys2D = allRoadAndPathRings.length > 0
      ? _regularizePolys2D(core, core.ringsToOutersWithHoles(allRoadAndPathRings, 6e-4), 6e-4, 2.5e-4)
      : streetPolys2D;
    yield;
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

  function buildSurfaceDrapesAndFrame(core, mf, ctx, terrainManifold, plateClipPoly, unionedWaterRings, surfaceData) {
    const gen = _buildSurfaceDrapesAndFrameGen(core, mf, ctx, terrainManifold, plateClipPoly, unionedWaterRings, surfaceData);
    let step;
    do { step = gen.next(); } while (!step.done);
    return step.value;
  }

  const exportsObj = {
    isFootpathRoad,
    _regularizePolys2D,
    _buildClippedPolysExtrude,
    collectPrintedBuildingFootprints2D,
    _collectSurfacePolysGen,
    collectSurfacePolys,
    _buildSurfaceDrapesAndFrameGen,
    buildSurfaceDrapesAndFrame
  };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
