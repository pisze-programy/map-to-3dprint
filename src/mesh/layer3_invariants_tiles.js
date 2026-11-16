// ============================================================================
// src/mesh/layer3_invariants_tiles.js
// Layer-3 Multi-Tile Manifold Clipping & Pipeline Orchestration
// Delegates SLA Hollow Vault / R1C1^ to tile_sla_vault_solver.js & Audit to global_invariants_auditor.js
// ============================================================================

(function (root) {
  function _getDeps() {
    const core = (typeof createBuildContext === 'function')
      ? root : (typeof require !== 'undefined' ? require('../geometry/manifold_core.js') : root);
    const vault = (typeof carveTileHollowVaultAndId === 'function')
      ? root : (typeof require !== 'undefined' ? require('./tile_sla_vault_solver.js') : root);
    const auditor = (typeof assemblePrintMetricsReport === 'function')
      ? root : (typeof require !== 'undefined' ? require('./global_invariants_auditor.js') : root);
    return { core, vault, auditor };
  }

  function _clipSolidToBox(core, mf, man, box, bb = null) {
    if (!man || man.numTri() === 0) return null;
    const b = bb || man.boundingBox();
    if (b.max[0] <= box.minX + 1e-5 || b.min[0] >= box.maxX - 1e-5 ||
        b.max[1] <= box.minY + 1e-5 || b.min[1] >= box.maxY - 1e-5 ||
        b.max[2] <= box.minZ + 1e-5 || b.min[2] >= box.maxZ - 1e-5) {
      return null;
    }
    if (b.min[0] >= box.minX - 1e-6 && b.max[0] <= box.maxX + 1e-6 &&
        b.min[1] >= box.minY - 1e-6 && b.max[1] <= box.maxY + 1e-6 &&
        b.min[2] >= box.minZ - 1e-6 && b.max[2] <= box.maxZ + 1e-6) {
      return man;
    }
    const clipCube = core.boxManifoldFromBounds(mf, box.minX, box.maxX, box.minY, box.maxY, box.minZ, box.maxZ);
    if (!clipCube) return null;
    try {
      const res = man.intersect(clipCube);
      if (!res || res.numTri() === 0) { core.safeDeleteManifold(res); return null; }
      return res;
    } catch (_) {
      return null;
    } finally {
      core.safeDeleteManifold(clipCube);
    }
  }

  function _emitDecomposed(core, man, outArr, layerId, buildingId, tid, nextSidFn) {
    if (!man || man.numTri() === 0) return;
    if (typeof man.decompose === 'function') {
      let comps = null;
      try { comps = man.decompose(); } catch (_) { comps = null; }
      if (Array.isArray(comps) && comps.length > 0) {
        for (let ci = 0; ci < comps.length; ci++) {
          const comp = comps[ci];
          if (comp && comp.numTri() > 0) core.appendManifoldToTriangles(comp, outArr, layerId, buildingId, tid, nextSidFn());
          core.safeDeleteManifold(comp);
        }
        return;
      }
    }
    core.appendManifoldToTriangles(man, outArr, layerId, buildingId, tid, nextSidFn());
  }

  function finalize3LayerTilesAndInvariants(ctx, layerOutputs, options = {}) {
    const { core, vault, auditor } = _getDeps();
    const { mf, scaleMm, tileBounds, maxZUnits, hollowBase, waterCutout } = ctx;
    const { terrainWater, s3db, bridges, archetypes } = layerOutputs;

    const meshes = { water: [], base: [], greenery: [], roads: [], buildings: [], highlighted: [], frame: [] };
    const zTopCap = maxZUnits;
    const numTiles = tileBounds.length;
    const tileVolumesUnits3 = new Float64Array(numTiles);
    const tileMaxZUnits = new Float64Array(numTiles);
    const solidTerrainTotalVolU3 = terrainWater.terrainManifold ? Math.max(0, terrainWater.terrainManifold.volume()) : 0;
    let printedBaseTotalVolU3 = 0, drainCount = 0, hollowChambersKept = 0, hollowChambersFilledSolid = 0;
    let floatingBuildingsCount = 0, globalMaxZUnits = 0, zCapApplied = Boolean(ctx.zCapApplied);
    const embossStats = { engravedTiles: 0, minStrokeWidthMm: Infinity, minCarveDepthMm: Infinity, minRoofClearanceMm: Infinity, ribPitchMm: null, ribThickMm: null };

    const recordSolids = (man, tid, checkCap = true) => {
      if (!man || man.numTri() === 0) return 0;
      const bb = man.boundingBox();
      if (bb.max[2] > globalMaxZUnits) globalMaxZUnits = bb.max[2];
      if (bb.max[2] > tileMaxZUnits[tid]) tileMaxZUnits[tid] = bb.max[2];
      if (checkCap && bb.max[2] >= zTopCap - 0.02) zCapApplied = true;
      const v = Math.max(0, man.volume());
      tileVolumesUnits3[tid] += v;
      return v;
    };

    const rawWallMm = Number(ctx.hollowWallMm);
    const marginU = Math.max(0.8, (Number.isFinite(rawWallMm) && rawWallMm > 0) ? rawWallMm : 1.8) / scaleMm;
    let waterMarginRings2D = [];
    if (hollowBase && terrainWater.waterMaskPolys2D.length > 0) {
      const oBuf = core.clipperOffsetPolys(terrainWater.waterMaskPolys2D.map(w => w.outer), marginU, 'Miter', 1e-5);
      const holes = terrainWater.waterMaskPolys2D.flatMap(w => w.holes || []);
      if (holes.length > 0 && oBuf.length > 0) {
        const hShrunk = core.clipperOffsetPolys(holes, -marginU, 'Miter', 1e-5);
        waterMarginRings2D = hShrunk.length > 0 ? core.clipperDiffPolys(oBuf, hShrunk, 1e-5) : oBuf;
      } else waterMarginRings2D = oBuf;
    }

    const allRoadSolids = [];
    if (terrainWater.roadManifold && terrainWater.roadManifold.numTri() > 0) {
      allRoadSolids.push({ man: terrainWater.roadManifold, bb: terrainWater.roadManifold.boundingBox() });
    }
    for (const bm of (bridges && bridges.bridgeManifolds) || []) {
      if (bm && bm.numTri() > 0) allRoadSolids.push({ man: bm, bb: bm.boundingBox() });
    }
    for (const rm of (archetypes && archetypes.roadLayerManifolds) || []) {
      if (rm && rm.numTri() > 0) allRoadSolids.push({ man: rm, bb: rm.boundingBox() });
    }

    const allNormalBuildings = [...((s3db && s3db.buildingManifolds) || []), ...((archetypes && archetypes.buildingLayerManifolds) || [])];
    const allHiBuildings = (s3db && s3db.highlightedManifolds) || [];
    const allTrees = (archetypes && archetypes.greeneryTreeManifolds) || [];

    const _manifoldsTouch3D = (mA, mB, shiftA = 0) => {
      if (!mA || !mB || mA.numTri() === 0 || mB.numTri() === 0) return false;
      const vec = Array.isArray(shiftA) ? shiftA : [0, 0, shiftA];
      let probe = mA, owns = false, hit = null;
      try {
        if (Math.hypot(vec[0], vec[1], vec[2]) > 1e-6) { probe = mA.translate(vec); owns = true; }
        hit = probe.intersect(mB);
        return Boolean(hit && hit.numTri() > 0);
      } catch (_) { return false; }
      finally { core.safeDeleteManifold(hit); if (owns) core.safeDeleteManifold(probe); }
    };

    const roadAnchorCache = new Map();
    const _isRoadSolidAnchored = (startIdx) => {
      if (!waterCutout) return true;
      if (roadAnchorCache.has(startIdx)) return roadAnchorCache.get(startIdx);
      const visited = new Set([startIdx]), queue = [startIdx];
      let anchored = false;
      while (queue.length > 0) {
        const idx = queue.shift(), cur = allRoadSolids[idx];
        if (roadAnchorCache.get(idx) === true || _manifoldsTouch3D(cur.man, terrainWater.terrainManifold, -0.25 / scaleMm)) {
          anchored = true;
          break;
        }
        for (let j = 0; j < allRoadSolids.length; j++) {
          if (visited.has(j)) continue;
          const nxt = allRoadSolids[j];
          if (cur.bb.max[0] < nxt.bb.min[0] - 0.08 || cur.bb.min[0] > nxt.bb.max[0] + 0.08 ||
              cur.bb.max[1] < nxt.bb.min[1] - 0.08 || cur.bb.min[1] > nxt.bb.max[1] + 0.08) continue;
          if (_manifoldsTouch3D(cur.man, nxt.man, -0.15 / scaleMm) || _manifoldsTouch3D(nxt.man, cur.man, -0.15 / scaleMm)) {
            visited.add(j);
            queue.push(j);
          }
        }
      }
      for (const v of visited) if (anchored || !roadAnchorCache.has(v)) roadAnchorCache.set(v, anchored);
      return anchored;
    };

    const allBldItems = allNormalBuildings.concat(allHiBuildings);
    const dryBldSolids = [];
    if (waterCutout && terrainWater && typeof terrainWater.isPointInWater === 'function') {
      for (const bi of allBldItems) {
        if (!bi || !bi.manifold || bi.manifold.numTri() === 0 || bi.isFloatingPart) continue;
        const bbb = bi.manifold.boundingBox();
        const bcx = (bbb.min[0] + bbb.max[0]) * 0.5, bcy = (bbb.min[1] + bbb.max[1]) * 0.5;
        if (!terrainWater.isPointInWater(bcx, bcy)) dryBldSolids.push({ man: bi.manifold, bb: bbb });
      }
    }

    const _isCompPhysicallyAnchored = (comp, bb) => {
      if (_manifoldsTouch3D(comp, terrainWater.terrainManifold, -0.25 / scaleMm)) return true;
      for (let ri = 0; ri < allRoadSolids.length; ri++) {
        const rs = allRoadSolids[ri];
        if (bb.max[0] < rs.bb.min[0] - 0.05 || bb.min[0] > rs.bb.max[0] + 0.05 ||
            bb.max[1] < rs.bb.min[1] - 0.05 || bb.min[1] > rs.bb.max[1] + 0.05) continue;
        if (_manifoldsTouch3D(comp, rs.man, -0.20 / scaleMm) && _isRoadSolidAnchored(ri)) return true;
      }
      for (let di = 0; di < dryBldSolids.length; di++) {
        const db = dryBldSolids[di];
        if (db.man === comp) continue;
        if (bb.max[0] < db.bb.min[0] - 0.05 || bb.min[0] > db.bb.max[0] + 0.05 ||
            bb.max[1] < db.bb.min[1] - 0.05 || bb.min[1] > db.bb.max[1] + 0.05) continue;
        if (_manifoldsTouch3D(comp, db.man, 0) ||
            _manifoldsTouch3D(comp, db.man, [0.02, 0, 0]) ||
            _manifoldsTouch3D(comp, db.man, [-0.02, 0, 0]) ||
            _manifoldsTouch3D(comp, db.man, [0, 0.02, 0]) ||
            _manifoldsTouch3D(comp, db.man, [0, -0.02, 0])) return true;
      }
      return false;
    };

    const VESSEL_BTYPE_RE = /^(ship|boat|houseboat|floating_home|barge|boathouse)$/;
    const _isMooredZ0Vessel = (item, bb) => {
      if (bb.min[2] > 0.05) return false;
      const pInfo = ctx.pickIdMap && typeof ctx.pickIdMap.get === 'function' ? ctx.pickIdMap.get(item.buildingId) : null;
      const recs = (pInfo && Array.isArray(pInfo.buildings)) ? pInfo.buildings : (pInfo && pInfo.primaryBuilding ? [pInfo.primaryBuilding] : []);
      return recs.length > 0 && recs.every(b => {
        if (!b) return false;
        if (b.isVessel) return true;
        const bt = String(b.btype || '').toLowerCase();
        const t = b.tags || {};
        return VESSEL_BTYPE_RE.test(bt) || t.historic === 'ship' || Boolean(t['ship:type']) || t.floating === 'yes';
      });
    };

    for (const item of allBldItems) {
      if (!item || !item.manifold || item.manifold.numTri() === 0) continue;
      let comps = null;
      try { comps = typeof item.manifold.decompose === 'function' ? item.manifold.decompose() : null; } catch (_) { comps = null; }
      const checkList = (Array.isArray(comps) && comps.length > 0) ? comps : [item.manifold];
      for (const comp of checkList) {
        if (!comp || comp.numTri() === 0) continue;
        const bb = comp.boundingBox();
        if (bb.min[0] >= ctx.halfW - 1e-3 || bb.max[0] <= -ctx.halfW + 1e-3 ||
            bb.min[1] >= ctx.halfH - 1e-3 || bb.max[1] <= -ctx.halfH + 1e-3) continue;
        if (bb.max[2] >= zTopCap - 0.02) zCapApplied = true;
        if (!item.isFloatingPart) {
          const touchesFrameBorder = (bb.min[0] <= -ctx.halfW + 0.02 || bb.max[0] >= ctx.halfW - 0.02 || bb.min[1] <= -ctx.halfH + 0.02 || bb.max[1] >= ctx.halfH - 0.02);
          const cx = (bb.min[0] + bb.max[0]) * 0.5, cy = (bb.min[1] + bb.max[1]) * 0.5;
          const dx = (bb.max[0] - bb.min[0]) * 0.32, dy = (bb.max[1] - bb.min[1]) * 0.32;
          const samples = [[cx, cy], [cx - dx, cy - dy], [cx + dx, cy - dy], [cx + dx, cy + dy], [cx - dx, cy + dy]];
          const allInCutoutSea = waterCutout && terrainWater && typeof terrainWater.isPointInWater === 'function' &&
            samples.every(([px, py]) => terrainWater.isPointInWater(px, py)) && !_isMooredZ0Vessel(item, bb);
          const aboveSurf = bb.min[2] > terrainWater.getSurfaceZ(cx, cy) + (0.65 / scaleMm);
          if ((aboveSurf || (allInCutoutSea && !touchesFrameBorder)) && !_isCompPhysicallyAnchored(comp, bb)) {
            floatingBuildingsCount++;
          }
        }
      }
      if (Array.isArray(comps)) for (const c of comps) core.safeDeleteManifold(c);
    }

    const emitGreenTurf = !ctx.state || !ctx.state.layerVisible || ctx.state.layerVisible.greenery !== false;

    let maxTreeShellId = 0;
    for (const tr of allTrees) if (tr && tr.shellId > maxTreeShellId) maxTreeShellId = tr.shellId;
    let nextPosShellId = maxTreeShellId + 1, nextTurfShellId = -2;

    for (let tIdx = 0; tIdx < tileBounds.length; tIdx++) {
      const tb = tileBounds[tIdx], tid = tb.tileId;
      const clipBox = { minX: tb.minX, maxX: tb.maxX, minY: tb.minY, maxY: tb.maxY, minZ: -1.5, maxZ: zTopCap };

      let baseTile = _clipSolidToBox(core, mf, terrainWater.terrainManifold, clipBox);
      if (baseTile && baseTile.numTri() > 0) {
        const res = vault.carveTileHollowVaultAndId(ctx, terrainWater, baseTile, tb, waterMarginRings2D);
        baseTile = res.baseTile;
        drainCount += res.drainCount;
        hollowChambersKept += res.hollowChambersKept;
        hollowChambersFilledSolid += res.hollowChambersFilledSolid;
        embossStats.ribPitchMm = res.ribPitchMm;
        embossStats.ribThickMm = res.ribThickMm;
        if (res.emboss) {
          embossStats.engravedTiles++;
          embossStats.minStrokeWidthMm = Math.min(embossStats.minStrokeWidthMm, res.emboss.strokeWidthMm);
          embossStats.minCarveDepthMm = Math.min(embossStats.minCarveDepthMm, res.emboss.carveDepthMm);
          embossStats.minRoofClearanceMm = Math.min(embossStats.minRoofClearanceMm, res.emboss.minRoofClearanceMm);
        }
        printedBaseTotalVolU3 += recordSolids(baseTile, tid, false);
        _emitDecomposed(core, baseTile, meshes.base, 1, -1, tid, () => nextPosShellId++);
        if (baseTile !== terrainWater.terrainManifold) core.safeDeleteManifold(baseTile);
      }

      if (!waterCutout && terrainWater.waterManifold) {
        const wTile = _clipSolidToBox(core, mf, terrainWater.waterManifold, clipBox);
        if (wTile) {
          recordSolids(wTile, tid, false);
          _emitDecomposed(core, wTile, meshes.water, 0, -1, tid, () => nextPosShellId++);
          if (wTile !== terrainWater.waterManifold) core.safeDeleteManifold(wTile);
        }
      }
      if (emitGreenTurf && terrainWater.greeneryManifold) {
        const gTile = _clipSolidToBox(core, mf, terrainWater.greeneryManifold, clipBox);
        if (gTile) {
          recordSolids(gTile, tid, false);
          _emitDecomposed(core, gTile, meshes.greenery, 2, -1, tid, () => nextTurfShellId--);
          if (gTile !== terrainWater.greeneryManifold) core.safeDeleteManifold(gTile);
        }
      }
      for (const tr of allTrees) {
        const tClip = _clipSolidToBox(core, mf, tr.manifold, clipBox);
        if (tClip) {
          recordSolids(tClip, tid, false);
          let firstTree = true;
          _emitDecomposed(core, tClip, meshes.greenery, 2, -2, tid, () => {
            if (firstTree && tr.shellId > 0) { firstTree = false; return tr.shellId; }
            firstTree = false;
            return nextPosShellId++;
          });
          if (tClip !== tr.manifold) core.safeDeleteManifold(tClip);
        }
      }
      for (const rs of allRoadSolids) {
        const rTile = _clipSolidToBox(core, mf, rs.man, clipBox, rs.bb);
        if (rTile) {
          recordSolids(rTile, tid, true);
          _emitDecomposed(core, rTile, meshes.roads, 3, -1, tid, () => nextPosShellId++);
          if (rTile !== rs.man) core.safeDeleteManifold(rTile);
        }
      }
      for (const item of allNormalBuildings) {
        const bTile = _clipSolidToBox(core, mf, item.manifold, clipBox);
        if (bTile) {
          recordSolids(bTile, tid, true);
          _emitDecomposed(core, bTile, meshes.buildings, 4, item.buildingId, tid, () => nextPosShellId++);
          if (bTile !== item.manifold) core.safeDeleteManifold(bTile);
        }
      }
      for (const item of allHiBuildings) {
        const hTile = _clipSolidToBox(core, mf, item.manifold, clipBox);
        if (hTile) {
          recordSolids(hTile, tid, true);
          _emitDecomposed(core, hTile, meshes.highlighted, 5, item.buildingId, tid, () => nextPosShellId++);
          if (hTile !== item.manifold) core.safeDeleteManifold(hTile);
        }
      }
    }

    if (terrainWater.frameManifold && terrainWater.frameManifold.numTri() > 0) {
      core.appendManifoldToTriangles(terrainWater.frameManifold, meshes.frame, 6, -1, 0, 1);
    }
    [terrainWater.terrainManifold, terrainWater.waterManifold, terrainWater.greeneryManifold, terrainWater.roadManifold, terrainWater.frameManifold]
      .forEach(core.safeDeleteManifold);
    for (const rs of allRoadSolids) core.safeDeleteManifold(rs.man);
    for (const tr of allTrees) core.safeDeleteManifold(tr.manifold);
    for (const b of allNormalBuildings) core.safeDeleteManifold(b.manifold);
    for (const b of allHiBuildings) core.safeDeleteManifold(b.manifold);

    const embossMetrics = {
      engravedTiles: embossStats.engravedTiles,
      strokeWidthMm: embossStats.engravedTiles ? Math.round(embossStats.minStrokeWidthMm * 100) / 100 : 0,
      carveDepthMm: embossStats.engravedTiles ? Math.round(embossStats.minCarveDepthMm * 100) / 100 : 0,
      minRoofClearanceMm: embossStats.engravedTiles ? Math.round(embossStats.minRoofClearanceMm * 100) / 100 : 0,
      ribPitchMm: embossStats.ribPitchMm,
      ribThickMm: embossStats.ribThickMm ? Math.round(embossStats.ribThickMm * 100) / 100 : 0,
    };

    const printMetrics = auditor.assemblePrintMetricsReport(ctx, meshes, {
      skipTopologyAudit: Boolean(options && options.skipTopologyAudit),
      tileBounds, tileVolumesUnits3, tileMaxZUnits, solidTerrainTotalVolU3, printedBaseTotalVolU3,
      globalMaxZUnits, zCapApplied, floatingBuildingsCount, drainCount, hollowChambersKept,
      hollowChambersFilledSolid, allKeptChambersValid: hollowChambersKept > 0, embossMetrics, bridges, archetypes,
    });
    ctx.audit.invariants = printMetrics;
    ctx.audit.embossMetrics = embossMetrics;

    const allBounds = ((s3db && s3db.buildingBounds) || []).concat((archetypes && archetypes.buildingBounds) || []);
    return { meshes, buildingBounds: allBounds, pickIdMap: ctx.pickIdMap, totalTriangles: printMetrics.totalTriangles, printMetrics, audit: ctx.audit };
  }

  const exportsObj = { finalize3LayerTilesAndInvariants };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
