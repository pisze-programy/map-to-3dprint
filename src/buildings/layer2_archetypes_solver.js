// ============================================================================
// src/buildings/layer2_archetypes_solver.js
// Layer 2 Orchestrator: Architectural/Engineering Archetypes, Piers & Trees
// ============================================================================

(function (root) {
  function _getDeps() {
    const core = (typeof root.getManifoldLib === 'function' && typeof root.clipperUnionPolys === 'function')
      ? root : require('../geometry/manifold_core.js');
    const pierMod = (typeof root.buildMarinePiersAndBreakwaters === 'function' && typeof root.computeFootprintOBB === 'function')
      ? root : require('../Water/water_piers_solver.js');
    const structMod = (typeof root.buildParametricLatticeManifold === 'function' && typeof root.buildObservationWheelManifold === 'function')
      ? root : require('./archetype_structures_solver.js');
    const treeMod = (typeof root.buildTreesArchetypeList === 'function')
      ? root : require('../mesh/tree_scatter_solver.js');
    return { core, pierMod, structMod, treeMod };
  }

  const WHEEL_ATTR = new Set(['big_wheel', 'ferris_wheel', 'observation_wheel']);
  const IND_SET = new Set(['storage_tank', 'silo', 'chimney', 'cooling_tower', 'crane']);
  const TOWER_SET = new Set(['tower', 'mast', 'communications_tower', 'lighthouse']);

  function _computeGroupDatums(ctx, scene, terrainWater, targetGroupIds = null) {
    const grd = new Map(), fbk = new Map(), { toBed } = ctx;
    if (targetGroupIds && targetGroupIds.size === 0) return grd;
    for (const b of (scene && scene.buildings) || []) {
      if (!b || b.hidden || b.isOutline || !b.outer || b.outer.length < 3 || b.groupId == null) continue;
      const gKey = String(b.groupId);
      if (targetGroupIds && !targetGroupIds.has(gKey)) continue;
      const tags = b.tags || {};
      const rawMinH = Math.max(0, Number(b.minH !== undefined ? b.minH : (tags.min_height || 0)) || 0);
      let dryMinZ = Infinity, waterMinZ = Infinity;
      for (const p of b.outer) {
        const bp = toBed(p), inW = Boolean(terrainWater && terrainWater.isPointInWater(bp[0], bp[1]));
        if (!inW) {
          const z = (terrainWater && typeof terrainWater.getDrySurfaceZ === 'function')
            ? terrainWater.getDrySurfaceZ(bp[0], bp[1])
            : ((terrainWater && typeof terrainWater.getSurfaceZ === 'function') ? terrainWater.getSurfaceZ(bp[0], bp[1]) : ctx.getTerrainZ(bp[0], bp[1]));
          if (z < dryMinZ) dryMinZ = z;
        } else {
          const zw = (terrainWater && typeof terrainWater.getNominalWaterTopZ === 'function') ? terrainWater.getNominalWaterTopZ(bp[0], bp[1]) : ctx.zWaterTop;
          if (zw < waterMinZ) waterMinZ = zw;
        }
      }
      const rawZ = Number.isFinite(dryMinZ) ? dryMinZ : waterMinZ;
      if (!Number.isFinite(rawZ)) continue;
      const minZ = Math.max(ctx.zLandDatum, rawZ), tgt = rawMinH <= 0.05 ? grd : fbk, prev = tgt.get(gKey);
      if (prev === undefined || minZ < prev) tgt.set(gKey, minZ);
    }
    const out = new Map(fbk);
    for (const [k, v] of grd) out.set(k, v);
    return out;
  }

  function _mergeLayeredGroupManifolds(core, mf, ctx, buildingLayerManifolds, buildingBounds, s3db) {
    const grpIds = new Set(buildingLayerManifolds.map(x => x.groupId).filter(g => g != null));
    if (grpIds.size === 0) return;
    const s3dbNorm = (s3db && Array.isArray(s3db.buildingManifolds)) ? s3db.buildingManifolds : [];
    const s3dbByGrp = new Map(), l2ByGrp = new Map();
    for (let i = 0; i < s3dbNorm.length; i++) {
      const gid = s3dbNorm[i].groupId != null ? String(s3dbNorm[i].groupId) : null;
      if (gid && grpIds.has(gid)) { if (!s3dbByGrp.has(gid)) s3dbByGrp.set(gid, []); s3dbByGrp.get(gid).push(s3dbNorm[i]); }
    }
    for (let i = 0; i < buildingLayerManifolds.length; i++) {
      const gid = buildingLayerManifolds[i].groupId;
      if (gid != null) { if (!l2ByGrp.has(gid)) l2ByGrp.set(gid, []); l2ByGrp.get(gid).push(i); }
    }
    const removedS3dbSet = new Set(), removedL2IdxSet = new Set(), pidRemap = new Map();
    for (const gid of grpIds) {
      const l2Idx = l2ByGrp.get(gid) || [], s1Items = s3dbByGrp.get(gid) || [];
      if (l2Idx.length + s1Items.length < 2 || (s1Items.length === 0 && l2Idx.length < 2)) continue;
      const allMans = [...s1Items.map(x => x.manifold), ...l2Idx.map(i => buildingLayerManifolds[i].manifold)];
      const keepId = (s1Items[0] || buildingLayerManifolds[l2Idx[0]]).buildingId;
      const mergedPids = new Set([...s1Items.map(x => x.buildingId), ...l2Idx.map(i => buildingLayerManifolds[i].buildingId)]);
      let unified = core.batchUnionManifolds(mf, allMans);
      if (!unified || unified.numTri() === 0) { core.safeDeleteManifold(unified); continue; }
      if (typeof unified.decompose === 'function') {
        let comps = null;
        try { comps = unified.decompose(); } catch (_) { comps = null; }
        if (Array.isArray(comps) && comps.length > 1) {
          const meta = comps.map(c => ({ c, bb: c.boundingBox(), vol: Math.max(0, c.volume()) }));
          meta.sort((a, b) => (a.bb.min[2] - b.bb.min[2]) || (b.vol - a.vol));
          const anchorMesh = meta[0].c.getMesh(), aVp = anchorMesh.vertProperties, aStride = anchorMesh.numProp || 3;
          const braceR = Math.max(ctx.minPrintU * 0.55, 0.30 / ctx.scaleMm), braces = [unified];
          for (let ci = 1; ci < meta.length; ci++) {
            const sub = meta[ci];
            if (sub.bb.min[2] <= meta[0].bb.min[2] + (0.45 / ctx.scaleMm)) continue;
            const sMesh = sub.c.getMesh(), sVp = sMesh.vertProperties, sStride = sMesh.numProp || 3;
            if (!sVp || sVp.length < sStride || !aVp || aVp.length < aStride) continue;
            let sx = sVp[0], sy = sVp[1], sz = sVp[2];
            for (let si = 0; si <= sVp.length - sStride; si += sStride) if (sVp[si + 2] < sz) { sx = sVp[si]; sy = sVp[si + 1]; sz = sVp[si + 2]; }
            let bestAx = aVp[0], bestAy = aVp[1], bestAz = aVp[2], bestScore = Infinity;
            const aStep = Math.max(1, Math.floor((aVp.length / aStride) / 600)) * aStride;
            for (let ai = 0; ai <= aVp.length - aStride; ai += aStep) {
              const ax = aVp[ai], ay = aVp[ai + 1], az = aVp[ai + 2], dz = sz - az;
              const d = Math.hypot(ax - sx, ay - sy) + (dz < -(0.3 / ctx.scaleMm) ? Math.abs(dz) * 4.0 : Math.abs(dz) * 0.65);
              if (d < bestScore) { bestScore = d; bestAx = ax; bestAy = ay; bestAz = az; }
            }
            const bm = core.beamManifoldBetween(mf, [sx, sy, sz], [bestAx, bestAy, bestAz], braceR);
            if (bm) braces.push(bm, mf.Manifold.sphere(braceR * 1.08, 8).translate([sx, sy, sz]), mf.Manifold.sphere(braceR * 1.08, 8).translate([bestAx, bestAy, bestAz]));
          }
          for (const m of meta) core.safeDeleteManifold(m.c);
          if (braces.length > 1) { const braced = core.batchUnionManifolds(mf, braces); if (braced && braced.numTri() > 0) unified = braced; }
          const postComps = typeof unified.decompose === 'function' ? unified.decompose() : null;
          if (Array.isArray(postComps) && postComps.length > 1) {
            const scaleMm3 = ctx.scaleMm ** 3, kept = [];
            for (const pc of postComps) {
              const pbb = pc.boundingBox();
              if (pbb.min[2] > meta[0].bb.min[2] + (0.45 / ctx.scaleMm) && (pbb.max[2] - pbb.min[2]) * ctx.scaleMm < 0.12 && Math.max(0, pc.volume()) * scaleMm3 < 0.01) {
                core.safeDeleteManifold(pc);
              } else kept.push(pc);
            }
            if (kept.length > 0 && kept.length < postComps.length) {
              core.safeDeleteManifold(unified);
              unified = kept.length === 1 ? kept[0] : core.batchUnionManifolds(mf, kept);
            } else for (const pc of kept) core.safeDeleteManifold(pc);
          } else if (Array.isArray(postComps)) for (const pc of postComps) core.safeDeleteManifold(pc);
        } else if (Array.isArray(comps)) for (const c of comps) core.safeDeleteManifold(c);
      }
      const keepInfo = ctx.pickIdMap && ctx.pickIdMap.get(keepId);
      if (keepInfo && Array.isArray(keepInfo.buildings)) {
        for (const pid of mergedPids) if (pid !== keepId) {
          const inf = ctx.pickIdMap.get(pid);
          if (inf && Array.isArray(inf.buildings)) for (const mb of inf.buildings) if (mb) { mb._pickId = keepId; if (!keepInfo.buildings.includes(mb)) keepInfo.buildings.push(mb); }
        }
      }
      for (const pid of mergedPids) if (pid !== keepId) pidRemap.set(pid, keepId);
      for (const s1 of s1Items) removedS3dbSet.add(s1);
      for (let k = 0; k < l2Idx.length; k++) removedL2IdxSet.add(l2Idx[k]);
      buildingLayerManifolds.push({ buildingId: keepId, groupId: gid, manifold: unified, isFloatingPart: false });
    }
    if (pidRemap.size > 0) {
      for (const bb of (buildingBounds || [])) if (bb && pidRemap.has(bb.pickId)) bb.pickId = pidRemap.get(bb.pickId);
      for (const bb of ((s3db && s3db.buildingBounds) || [])) if (bb && pidRemap.has(bb.pickId)) bb.pickId = pidRemap.get(bb.pickId);
    }
    if (removedS3dbSet.size > 0) {
      let w = 0;
      for (let i = 0; i < s3dbNorm.length; i++) if (!removedS3dbSet.has(s3dbNorm[i])) s3dbNorm[w++] = s3dbNorm[i];
      s3dbNorm.length = w;
    }
    if (removedL2IdxSet.size > 0) {
      let w = 0;
      for (let i = 0; i < buildingLayerManifolds.length; i++) if (!removedL2IdxSet.has(i)) buildingLayerManifolds[w++] = buildingLayerManifolds[i];
      buildingLayerManifolds.length = w;
    }
  }

  function _incKindCount(counts, kind) {
    if (TOWER_SET.has(kind)) counts.towers++;
    else if (kind === 'chimney') counts.chimneys++;
    else if (kind === 'cooling_tower') counts.coolingTowers++;
    else if (kind === 'crane') counts.cranes++;
    else counts.tanksAndSilos++;
  }

  function* _buildLayer2ArchetypesGen(ctx, scene, terrainWater, s3db = null) {
    const { core, pierMod, structMod, treeMod } = _getDeps();
    const { mf, halfW, halfH, toBed, latLonToScene } = ctx;
    const utils = { computeFootprintOBB: pierMod.computeFootprintOBB, resolveGroundZ: pierMod.resolveGroundZ };
    const buildingLayerManifolds = [], highlightedLayerManifolds = [], buildingBounds = [], roadLayerManifolds = [], handledOsmIds = new Set();
    const counts = { wheels: 0, windTurbines: 0, latticeTowers: 0, towers: 0, tanksAndSilos: 0, chimneys: 0, coolingTowers: 0, cranes: 0, marinePiers: 0, trees: 0 };

    const els = (scene && scene.osmElements) || [], bldOsmIds = new Set();
    for (const b of (scene && scene.buildings) || []) if (b && b.osmId != null) bldOsmIds.add(b.osmId);
    const rawTagMap = new Map(), l2Candidates = [], neededNodeIds = new Set();
    const classifyTags = (tags, b = null) => {
      const mm = String(tags.man_made || '').toLowerCase().trim(), attr = String(tags.attraction || '').toLowerCase().trim();
      const tt = String(tags['tower:type'] || '').toLowerCase().trim(), tc = String(tags['tower:construction'] || (b && b.towerConstruction) || '').toLowerCase().trim();
      const isWheel = Boolean((b && (b.archType === 'ferris_wheel' || b.btype === 'observation_wheel')) || WHEEL_ATTR.has(attr) || tt === 'observation_wheel');
      const isWind = mm === 'wind_turbine' || (tags.power === 'generator' && tags['generator:source'] === 'wind');
      const isLattice = tc === 'lattice' || tc === 'guyed_lattice';
      return { mm, isWheel, isWind, isLattice, isL2: isWheel || isWind || isLattice || TOWER_SET.has(mm) || IND_SET.has(mm) };
    };

    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el || !el.tags) continue;
      if (bldOsmIds.has(el.id)) rawTagMap.set(el.id, el.tags);
      if (el.tags.building) continue;
      if (classifyTags(el.tags).isL2) {
        l2Candidates.push(el);
        if (el.type === 'way' && Array.isArray(el.nodes)) for (let k = 0; k < el.nodes.length; k++) neededNodeIds.add(el.nodes[k]);
      }
    }
    const nodeCoords = new Map();
    if (neededNodeIds.size > 0) for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el && el.type === 'node' && neededNodeIds.has(el.id) && Number.isFinite(el.lat) && Number.isFinite(el.lon)) nodeCoords.set(el.id, el);
    }
    yield;

    // Collect only group IDs referenced by lattice towers before computing group datums
    const latticeGroupIds = new Set();
    const allSceneBlds = (scene && scene.buildings) || [];
    for (let i = 0; i < allSceneBlds.length; i++) {
      const b = allSceneBlds[i];
      if (!b || b.hidden || b.isOutline || !b.outer || b.outer.length < 3 || b.groupId == null) continue;
      const tags = Object.assign({}, rawTagMap.get(b.osmId) || {}, b.tags || {});
      if (classifyTags(tags, b).isLattice) latticeGroupIds.add(String(b.groupId));
    }
    const groupDatumById = latticeGroupIds.size > 0
      ? _computeGroupDatums(ctx, scene, terrainWater, latticeGroupIds)
      : new Map();
    yield;

    const hasTrees = Array.isArray(scene && scene.trees) && scene.trees.length > 0;
    const buildingFootprints2D = [], limX = halfW + 2.0, limY = halfH + 2.0;
    for (let bi = 0; bi < allSceneBlds.length; bi++) {
      if ((bi & 511) === 0 && bi > 0) yield;
      const b = allSceneBlds[bi];
      if (!b || b.hidden || b.isOutline || !b.outer || b.outer.length < 3) continue;
      const tags = Object.assign({}, rawTagMap.get(b.osmId) || {}, b.tags || {}), cl = classifyTags(tags, b);
      if (!cl.isL2 && !hasTrees) continue;
      const oBed = b.outer.map(toBed);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of oBed) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
      if (maxX < -limX || minX > limX || maxY < -limY || minY > limY) continue;
      if (hasTrees) {
        const holesBed = (b.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed));
        buildingFootprints2D.push({ outer: oBed, holes: holesBed, bb: [minX, minY, maxX, maxY], minH: Math.max(0, Number(b.minH !== undefined ? b.minH : (tags.min_height || 0)) || 0) });
      }
      if (!cl.isL2) continue;

      const hM = Number(b.h !== undefined ? b.h : (b.height || tags.height || 0)) || 0;
      let solid = null;
      if (cl.isWheel) { solid = structMod.buildObservationWheelManifold(core, mf, ctx, terrainWater, oBed, hM, utils); if (solid) counts.wheels++; }
      else if (cl.isWind) { const obb = pierMod.computeFootprintOBB(oBed); solid = structMod.buildWindTurbineManifold(core, mf, ctx, terrainWater, obb.cx, obb.cy, hM || 75, 0, utils); if (solid) counts.windTurbines++; }
      else if (cl.isLattice) {
        const gDatum = b.groupId != null ? groupDatumById.get(String(b.groupId)) : undefined;
        solid = structMod.buildParametricLatticeManifold(core, mf, ctx, terrainWater, Number.isFinite(gDatum) ? Object.assign({}, b, { groupDatumZ: gDatum }) : b, oBed, tags, hM, utils);
        if (solid) counts.latticeTowers++;
      } else if (TOWER_SET.has(cl.mm) && !b.part && !b.fromBuildingRel) {
        solid = structMod.buildTowerOrIndustrialManifold(core, mf, ctx, terrainWater, oBed, cl.mm, tags, hM, utils);
        if (solid) counts.towers++;
      } else if (IND_SET.has(cl.mm)) {
        solid = structMod.buildTowerOrIndustrialManifold(core, mf, ctx, terrainWater, oBed, cl.mm, tags, hM, utils);
        if (solid) _incKindCount(counts, cl.mm);
      }
      if (solid && solid.numTri() > 0) {
        if (b.osmId) handledOsmIds.add(b.osmId);
        const isHi = Boolean(b.highlighted), archType = cl.isLattice ? 'lattice_tower' : (cl.mm || (cl.isWheel ? 'ferris_wheel' : 'tower'));
        const pickId = ctx.allocPickId({ buildingId: b.id != null ? b.id : -1, osmId: b.osmId || null, groupId: b.groupId ?? null, name: b.name || '', archType, highlighted: isHi, primaryBuilding: b, buildings: [b] });
        b._pickId = pickId;
        (isHi ? highlightedLayerManifolds : buildingLayerManifolds).push({ buildingId: pickId, groupId: b.groupId != null ? String(b.groupId) : null, manifold: solid });
        const bb = solid.boundingBox(), bcx = (bb.min[0] + bb.max[0]) * 0.5, bcy = (bb.min[1] + bb.max[1]) * 0.5;
        buildingBounds.push({ id: b.id != null ? b.id : pickId, pickId, building: b, layerId: isHi ? 5 : 4, osmId: b.osmId || null, name: b.name || tags.name || '', minX: bb.min[0], minY: bb.min[1], minZ: bb.min[2], maxX: bb.max[0], maxY: bb.max[1], maxZ: bb.max[2], cx: bcx, cy: bcy, interiorPt: [bcx, bcy], roof: b.roof || 'flat', minH: b.minH || 0, h: hM || 60, archType });
      }
    }
    yield;

    for (let i = 0; i < l2Candidates.length; i++) {
      if ((i & 63) === 0 && i > 0) yield;
      const el = l2Candidates[i];
      if (!el || !el.tags || el.tags.building || handledOsmIds.has(el.id)) continue;
      const tags = el.tags, cl = classifyTags(tags);
      if (!cl.isL2) continue;

      let oBed = null, cx = 0, cy = 0;
      if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
        [cx, cy] = latLonToScene(el.lat, el.lon);
        const r = Math.max(ctx.minPrintU * 1.4, 2.8 * ctx.mToU * ctx.scaleToBed);
        oBed = [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
      } else if (el.type === 'way' && el.nodes && el.nodes.length >= 2) {
        const isClosedWay = el.nodes.length >= 4 && el.nodes[0] === el.nodes[el.nodes.length - 1];
        const pts = (isClosedWay ? el.nodes.slice(0, -1) : el.nodes).map(nid => nodeCoords.get(nid)).filter(Boolean).map(n => latLonToScene(n.lat, n.lon));
        if (isClosedWay && pts.length >= 3 && Math.abs(core.signedArea2D(pts)) > 1e-5) {
          oBed = pts; cx = pts.reduce((s, p) => s + p[0], 0) / pts.length; cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        } else if (!isClosedWay && pts.length >= 2 && (cl.mm === 'crane' || cl.isWind)) {
          const buf = core.clipperBufferOpenPaths([{ pts, halfW: Math.max(ctx.minPrintU * 1.1, 1.8 * ctx.mToU * ctx.scaleToBed) }], 'Round', 1e-5);
          if (buf.length > 0 && buf[0].length >= 3) { oBed = buf[0]; cx = oBed.reduce((s, p) => s + p[0], 0) / oBed.length; cy = oBed.reduce((s, p) => s + p[1], 0) / oBed.length; }
        }
      }
      if (!oBed || Math.abs(cx) > halfW + 1.0 || Math.abs(cy) > halfH + 1.0) continue;

      const hM = Number(parseFloat(tags.height)) || 0;
      let solid = null;
      if (cl.isWind) { solid = structMod.buildWindTurbineManifold(core, mf, ctx, terrainWater, cx, cy, hM || 75, 0, utils); if (solid) counts.windTurbines++; }
      else if (cl.isWheel) { solid = structMod.buildObservationWheelManifold(core, mf, ctx, terrainWater, oBed, hM, utils); if (solid) counts.wheels++; }
      else if (cl.isLattice) { solid = structMod.buildParametricLatticeManifold(core, mf, ctx, terrainWater, null, oBed, tags, hM, utils); if (solid) counts.latticeTowers++; }
      else {
        const kind = TOWER_SET.has(cl.mm) ? cl.mm : (IND_SET.has(cl.mm) ? cl.mm : 'tower');
        solid = structMod.buildTowerOrIndustrialManifold(core, mf, ctx, terrainWater, oBed, kind, tags, hM, utils);
        if (solid) _incKindCount(counts, kind);
      }
      if (solid && solid.numTri() > 0) {
        handledOsmIds.add(el.id);
        const archType = cl.isLattice ? 'lattice_tower' : (cl.mm || (cl.isWind ? 'wind_turbine' : 'wheel'));
        const stubB = { id: -1, osmId: el.id, name: tags.name || '', archType };
        const pickId = ctx.allocPickId({ buildingId: -1, osmId: el.id, name: tags.name || '', archType, primaryBuilding: stubB, buildings: [stubB] });
        stubB._pickId = pickId;
        buildingLayerManifolds.push({ buildingId: pickId, manifold: solid });
        const bb = solid.boundingBox(), bcx = (bb.min[0] + bb.max[0]) * 0.5, bcy = (bb.min[1] + bb.max[1]) * 0.5;
        buildingBounds.push({ id: pickId, pickId, building: stubB, layerId: 4, osmId: el.id, name: tags.name || '', minX: bb.min[0], minY: bb.min[1], minZ: bb.min[2], maxX: bb.max[0], maxY: bb.max[1], maxZ: bb.max[2], cx: bcx, cy: bcy, interiorPt: [bcx, bcy], roof: 'flat', minH: 0, h: hM || 40, archType });
      }
    }
    yield;

    _mergeLayeredGroupManifolds(core, mf, ctx, buildingLayerManifolds, buildingBounds, s3db);
    yield;
    if (highlightedLayerManifolds.length > 0 && s3db && Array.isArray(s3db.highlightedManifolds)) {
      for (const hm of highlightedLayerManifolds) s3db.highlightedManifolds.push(hm);
    }
    const pierRes = pierMod.buildMarinePiersAndBreakwaters(core, mf, ctx, scene, terrainWater);
    yield;
    for (const ps of (pierRes.solids || [])) roadLayerManifolds.push(ps);
    counts.marinePiers = pierRes.pierCount || 0;
    const greeneryTreeManifolds = treeMod.buildTreesArchetypeList(mf, ctx, scene, terrainWater, buildingFootprints2D);
    counts.trees = greeneryTreeManifolds.length;

    ctx.audit.archetypeCounts = counts;
    return { buildingLayerManifolds, buildingBounds, roadLayerManifolds, greeneryTreeManifolds, counts };
  }

  function buildLayer2Archetypes(ctx, scene, terrainWater, s3db = null) {
    const gen = _buildLayer2ArchetypesGen(ctx, scene, terrainWater, s3db);
    let step;
    do { step = gen.next(); } while (!step.done);
    return step.value;
  }

  async function buildLayer2ArchetypesAsync(ctx, scene, terrainWater, s3db = null, yieldCtrl = null) {
    const gen = _buildLayer2ArchetypesGen(ctx, scene, terrainWater, s3db);
    let step;
    while (true) {
      step = gen.next();
      if (step.done) return step.value;
      if (yieldCtrl) await yieldCtrl.yieldIfNeeded(step.value === 'force');
    }
  }

  const exportsObj = { _computeGroupDatums, _mergeLayeredGroupManifolds, buildLayer2Archetypes, buildLayer2ArchetypesAsync };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
