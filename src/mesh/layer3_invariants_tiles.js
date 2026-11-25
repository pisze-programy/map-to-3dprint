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
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      throw new Error(
        `[layer3_invariants_tiles] Manifold intersect failed ` +
        `box=[${box.minX.toFixed(3)}..${box.maxX.toFixed(3)}, ${box.minY.toFixed(3)}..${box.maxY.toFixed(3)}, ${box.minZ.toFixed(3)}..${box.maxZ.toFixed(3)}] ` +
        `numTri=${man.numTri()}: ${msg}`
      );
    } finally {
      core.safeDeleteManifold(clipCube);
    }
  }

  // O(T log K) 2D KD-tree binary spatial clipper with incremental yields
  function* _clipSolidAcrossTilesKDGen(core, mf, fullMan, tileBounds, zMin, zMax) {
    const K = tileBounds.length;
    const out = new Array(K).fill(null);
    if (!fullMan || fullMan.numTri() === 0 || K === 0) return out;
    if (K < 6) {
      for (let i = 0; i < K; i++) {
        const tb = tileBounds[i];
        out[i] = _clipSolidToBox(core, mf, fullMan, { minX: tb.minX, maxX: tb.maxX, minY: tb.minY, maxY: tb.maxY, minZ: zMin, maxZ: zMax });
        yield;
      }
      return out;
    }

    function* recurseGen(man, indices, ownsMan) {
      if (!man || man.numTri() === 0 || indices.length === 0) {
        if (ownsMan) core.safeDeleteManifold(man);
        return;
      }
      if (indices.length === 1) {
        const idx = indices[0], tb = tileBounds[idx];
        const clipped = _clipSolidToBox(core, mf, man, { minX: tb.minX, maxX: tb.maxX, minY: tb.minY, maxY: tb.maxY, minZ: zMin, maxZ: zMax });
        if (ownsMan && clipped !== man) core.safeDeleteManifold(man);
        out[idx] = clipped;
        yield;
        return;
      }

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let k = 0; k < indices.length; k++) {
        const tb = tileBounds[indices[k]];
        if (tb.minX < minX) minX = tb.minX;
        if (tb.maxX > maxX) maxX = tb.maxX;
        if (tb.minY < minY) minY = tb.minY;
        if (tb.maxY > maxY) maxY = tb.maxY;
      }
      const splitX = (maxX - minX) >= (maxY - minY);
      const sorted = indices.slice().sort((a, b) => {
        const ta = tileBounds[a], tb = tileBounds[b];
        return splitX ? ((ta.minX + ta.maxX) - (tb.minX + tb.maxX)) : ((ta.minY + ta.maxY) - (tb.minY + tb.maxY));
      });
      const mid = sorted.length >> 1;
      const leftIdx = sorted.slice(0, mid);
      const rightIdx = sorted.slice(mid);

      const boundOf = (arr) => {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let k = 0; k < arr.length; k++) {
          const t = tileBounds[arr[k]];
          if (t.minX < x0) x0 = t.minX;
          if (t.maxX > x1) x1 = t.maxX;
          if (t.minY < y0) y0 = t.minY;
          if (t.maxY > y1) y1 = t.maxY;
        }
        return { minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: zMin, maxZ: zMax };
      };

      const mbb = man.boundingBox();
      const leftMan = _clipSolidToBox(core, mf, man, boundOf(leftIdx), mbb);
      yield;
      const rightMan = _clipSolidToBox(core, mf, man, boundOf(rightIdx), mbb);
      yield;
      const leftIsOrig = leftMan === man;
      const rightIsOrig = rightMan === man;

      if (leftMan) yield* recurseGen(leftMan, leftIdx, !leftIsOrig || (ownsMan && !rightIsOrig));
      if (rightMan) yield* recurseGen(rightMan, rightIdx, !rightIsOrig || (ownsMan && !leftIsOrig));
      if (ownsMan && !leftIsOrig && !rightIsOrig) core.safeDeleteManifold(man);
    }

    yield* recurseGen(fullMan, Array.from({ length: K }, (_, i) => i), false);
    return out;
  }

  function _emitDecomposed(core, man, outArr, layerId, buildingId, tid, nextSidFn) {
    if (!man || man.numTri() === 0) return;
    if (typeof core.appendManifoldComponentsToTriangles === 'function') {
      core.appendManifoldComponentsToTriangles(man, outArr, layerId, buildingId, tid, nextSidFn);
      return;
    }
    core.appendManifoldToTriangles(man, outArr, layerId, buildingId, tid, nextSidFn());
  }

  function* _finalize3LayerTilesAndInvariantsGen(ctx, layerOutputs, options = {}) {
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

    const recordSolids = (man, tid, checkCap = true, knownBb = null) => {
      if (!man || man.numTri() === 0) return 0;
      const bb = knownBb || man.boundingBox();
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
    if (hollowBase && !ctx.solidBaseNoTunnels && terrainWater.waterMaskPolys2D.length > 0) {
      const oBuf = core.clipperOffsetPolys(terrainWater.waterMaskPolys2D.map(w => w.outer), marginU, 'Miter', 1e-5);
      const holes = terrainWater.waterMaskPolys2D.flatMap(w => w.holes || []);
      if (holes.length > 0 && oBuf.length > 0) {
        const hShrunk = core.clipperOffsetPolys(holes, -marginU, 'Miter', 1e-5);
        waterMarginRings2D = hShrunk.length > 0 ? core.clipperDiffPolys(oBuf, hShrunk, 1e-5) : oBuf;
      } else waterMarginRings2D = oBuf;
    }
    yield;

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
    const DRY_CELL = 4.0;
    const dryBldGrid = new Map();
    if (waterCutout && terrainWater && typeof terrainWater.isPointInWater === 'function') {
      for (let biIdx = 0; biIdx < allBldItems.length; biIdx++) {
        if ((biIdx & 511) === 0 && biIdx > 0) yield;
        const bi = allBldItems[biIdx];
        if (!bi || !bi.manifold || bi.manifold.numTri() === 0 || bi.isFloatingPart) continue;
        const bbb = bi.bb || bi.manifold.boundingBox();
        const bcx = (bbb.min[0] + bbb.max[0]) * 0.5, bcy = (bbb.min[1] + bbb.max[1]) * 0.5;
        if (!terrainWater.isPointInWater(bcx, bcy)) {
          const rec = { man: bi.manifold, bb: bbb };
          const gx0 = Math.floor((bbb.min[0] - 0.06) / DRY_CELL), gx1 = Math.floor((bbb.max[0] + 0.06) / DRY_CELL);
          const gy0 = Math.floor((bbb.min[1] - 0.06) / DRY_CELL), gy1 = Math.floor((bbb.max[1] + 0.06) / DRY_CELL);
          for (let gx = gx0; gx <= gx1; gx++) {
            for (let gy = gy0; gy <= gy1; gy++) {
              const ck = `${gx}:${gy}`;
              let arr = dryBldGrid.get(ck);
              if (!arr) { arr = []; dryBldGrid.set(ck, arr); }
              arr.push(rec);
            }
          }
        }
      }
    }
    yield;

    const _isCompPhysicallyAnchored = (comp, bb) => {
      if (_manifoldsTouch3D(comp, terrainWater.terrainManifold, -0.25 / scaleMm)) return true;
      for (let ri = 0; ri < allRoadSolids.length; ri++) {
        const rs = allRoadSolids[ri];
        if (bb.max[0] < rs.bb.min[0] - 0.05 || bb.min[0] > rs.bb.max[0] + 0.05 ||
            bb.max[1] < rs.bb.min[1] - 0.05 || bb.min[1] > rs.bb.max[1] + 0.05) continue;
        if (_manifoldsTouch3D(comp, rs.man, -0.20 / scaleMm) && _isRoadSolidAnchored(ri)) return true;
      }
      if (dryBldGrid.size > 0) {
        const gx0 = Math.floor((bb.min[0] - 0.06) / DRY_CELL), gx1 = Math.floor((bb.max[0] + 0.06) / DRY_CELL);
        const gy0 = Math.floor((bb.min[1] - 0.06) / DRY_CELL), gy1 = Math.floor((bb.max[1] + 0.06) / DRY_CELL);
        const tested = new Set();
        for (let gx = gx0; gx <= gx1; gx++) {
          for (let gy = gy0; gy <= gy1; gy++) {
            const arr = dryBldGrid.get(`${gx}:${gy}`);
            if (!arr) continue;
            for (let di = 0; di < arr.length; di++) {
              const db = arr[di];
              if (db.man === comp || tested.has(db)) continue;
              tested.add(db);
              if (bb.max[0] < db.bb.min[0] - 0.05 || bb.min[0] > db.bb.max[0] + 0.05 ||
                  bb.max[1] < db.bb.min[1] - 0.05 || bb.min[1] > db.bb.max[1] + 0.05) continue;
              if (_manifoldsTouch3D(comp, db.man, 0) ||
                  _manifoldsTouch3D(comp, db.man, [0.02, 0, 0]) ||
                  _manifoldsTouch3D(comp, db.man, [-0.02, 0, 0]) ||
                  _manifoldsTouch3D(comp, db.man, [0, 0.02, 0]) ||
                  _manifoldsTouch3D(comp, db.man, [0, -0.02, 0])) return true;
            }
          }
        }
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

    for (let biIdx = 0; biIdx < allBldItems.length; biIdx++) {
      if ((biIdx & 255) === 0 && biIdx > 0) yield;
      const item = allBldItems[biIdx];
      if (!item || !item.manifold || item.manifold.numTri() === 0) continue;
      if (item.isSingleGroundedSolid && !waterCutout && item.bb) {
        if (item.bb.max[2] >= zTopCap - 0.02) zCapApplied = true;
        continue;
      }
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
    yield;

    const emitGreenTurf = !ctx.state || !ctx.state.layerVisible || ctx.state.layerVisible.greenery !== false;

    let maxTreeShellId = 0;
    for (const tr of allTrees) {
      if (!tr) continue;
      if (tr.shellId > maxTreeShellId) maxTreeShellId = tr.shellId;
      if (!tr.bb && tr.manifold) tr.bb = tr.manifold.boundingBox();
    }
    let nextPosShellId = maxTreeShellId + 1, nextTurfShellId = -2;

    const baseTilesKD = yield* _clipSolidAcrossTilesKDGen(core, mf, terrainWater.terrainManifold, tileBounds, -1.5, zTopCap);
    const waterTilesKD = (!waterCutout && terrainWater.waterManifold)
      ? (yield* _clipSolidAcrossTilesKDGen(core, mf, terrainWater.waterManifold, tileBounds, -1.5, zTopCap))
      : null;
    const greenTilesKD = (emitGreenTurf && terrainWater.greeneryManifold)
      ? (yield* _clipSolidAcrossTilesKDGen(core, mf, terrainWater.greeneryManifold, tileBounds, -1.5, zTopCap))
      : null;
    const mainRoadTilesKD = terrainWater.roadManifold
      ? (yield* _clipSolidAcrossTilesKDGen(core, mf, terrainWater.roadManifold, tileBounds, -1.5, zTopCap))
      : null;

    const extraRoadSolids = allRoadSolids.filter(rs => rs && rs.man && rs.man !== terrainWater.roadManifold);
    const tileTrees = Array.from({ length: numTiles }, () => []);
    const tileExtraRoads = Array.from({ length: numTiles }, () => []);
    const tileNormalBlds = Array.from({ length: numTiles }, () => []);
    const tileHiBlds = Array.from({ length: numTiles }, () => []);

    const bucketItems = (items, getMan, buckets) => {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const m = getMan(it);
        if (!m || m.numTri() === 0) continue;
        const bb = it.bb || (it.bb = m.boundingBox());
        for (let tIdx = 0; tIdx < numTiles; tIdx++) {
          const tb = tileBounds[tIdx];
          if (bb.max[0] <= tb.minX + 1e-5 || bb.min[0] >= tb.maxX - 1e-5 ||
              bb.max[1] <= tb.minY + 1e-5 || bb.min[1] >= tb.maxY - 1e-5) continue;
          buckets[tIdx].push(it);
        }
      }
    };
    bucketItems(allTrees, it => it && it.manifold, tileTrees);
    bucketItems(extraRoadSolids, it => it && it.man, tileExtraRoads);
    bucketItems(allNormalBuildings, it => it && it.manifold, tileNormalBlds);
    bucketItems(allHiBuildings, it => it && it.manifold, tileHiBlds);
    yield;

    for (let tIdx = 0; tIdx < tileBounds.length; tIdx++) {
      const tb = tileBounds[tIdx], tid = tb.tileId;
      const clipBox = { minX: tb.minX, maxX: tb.maxX, minY: tb.minY, maxY: tb.maxY, minZ: -1.5, maxZ: zTopCap };

      let baseTile = baseTilesKD[tIdx];
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
      yield;

      if (waterTilesKD && waterTilesKD[tIdx]) {
        const wTile = waterTilesKD[tIdx];
        recordSolids(wTile, tid, false);
        _emitDecomposed(core, wTile, meshes.water, 0, -1, tid, () => nextPosShellId++);
        if (wTile !== terrainWater.waterManifold) core.safeDeleteManifold(wTile);
      }
      if (greenTilesKD && greenTilesKD[tIdx]) {
        const gTile = greenTilesKD[tIdx];
        recordSolids(gTile, tid, false);
        _emitDecomposed(core, gTile, meshes.greenery, 2, -1, tid, () => nextTurfShellId--);
        if (gTile !== terrainWater.greeneryManifold) core.safeDeleteManifold(gTile);
      }
      yield;
      for (let tri = 0; tri < tileTrees[tIdx].length; tri++) {
        if ((tri & 255) === 0 && tri > 0) yield;
        const tr = tileTrees[tIdx][tri];
        const tClip = _clipSolidToBox(core, mf, tr.manifold, clipBox, tr.bb);
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
      if (mainRoadTilesKD && mainRoadTilesKD[tIdx]) {
        const mrTile = mainRoadTilesKD[tIdx];
        recordSolids(mrTile, tid, true);
        _emitDecomposed(core, mrTile, meshes.roads, 3, -1, tid, () => nextPosShellId++);
        if (mrTile !== terrainWater.roadManifold) core.safeDeleteManifold(mrTile);
      }
      yield;
      for (const rs of tileExtraRoads[tIdx]) {
        const rTile = _clipSolidToBox(core, mf, rs.man, clipBox, rs.bb);
        if (rTile) {
          recordSolids(rTile, tid, true);
          _emitDecomposed(core, rTile, meshes.roads, 3, -1, tid, () => nextPosShellId++);
          if (rTile !== rs.man) core.safeDeleteManifold(rTile);
        }
      }
      for (let bi = 0; bi < tileNormalBlds[tIdx].length; bi++) {
        if ((bi & 255) === 0 && bi > 0) yield;
        const item = tileNormalBlds[tIdx][bi];
        const bTile = _clipSolidToBox(core, mf, item.manifold, clipBox, item.bb);
        if (bTile) {
          recordSolids(bTile, tid, true, bTile === item.manifold ? item.bb : null);
          if (bTile === item.manifold && item.isSingleGroundedSolid) {
            core.appendManifoldToTriangles(bTile, meshes.buildings, 4, item.buildingId, tid, nextPosShellId++);
          } else {
            _emitDecomposed(core, bTile, meshes.buildings, 4, item.buildingId, tid, () => nextPosShellId++);
          }
          if (bTile !== item.manifold) core.safeDeleteManifold(bTile);
        }
      }
      for (let hi = 0; hi < tileHiBlds[tIdx].length; hi++) {
        if ((hi & 255) === 0 && hi > 0) yield;
        const item = tileHiBlds[tIdx][hi];
        const hTile = _clipSolidToBox(core, mf, item.manifold, clipBox, item.bb);
        if (hTile) {
          recordSolids(hTile, tid, true, hTile === item.manifold ? item.bb : null);
          if (hTile === item.manifold && item.isSingleGroundedSolid) {
            core.appendManifoldToTriangles(hTile, meshes.highlighted, 5, item.buildingId, tid, nextPosShellId++);
          } else {
            _emitDecomposed(core, hTile, meshes.highlighted, 5, item.buildingId, tid, () => nextPosShellId++);
          }
          if (hTile !== item.manifold) core.safeDeleteManifold(hTile);
        }
      }
      yield;
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
    yield;

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

  function finalize3LayerTilesAndInvariants(ctx, layerOutputs, options = {}) {
    const gen = _finalize3LayerTilesAndInvariantsGen(ctx, layerOutputs, options);
    let step;
    do { step = gen.next(); } while (!step.done);
    return step.value;
  }

  async function finalize3LayerTilesAndInvariantsAsync(ctx, layerOutputs, options = {}, yieldCtrl = null) {
    const gen = _finalize3LayerTilesAndInvariantsGen(ctx, layerOutputs, options);
    let step;
    while (true) {
      step = gen.next();
      if (step.done) return step.value;
      if (yieldCtrl) await yieldCtrl.yieldIfNeeded(step.value === 'force');
    }
  }

  const exportsObj = { finalize3LayerTilesAndInvariants, finalize3LayerTilesAndInvariantsAsync };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
