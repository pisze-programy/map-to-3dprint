// ============================================================================
// src/mesh/layer2_archetypes.js
// Layer 2 Orchestrator: Specialized Architectural/Engineering Archetypes & Trees
// ============================================================================

(function (root) {
  function _getDeps() {
    const core = (typeof getManifoldLib === 'function' && typeof clipperUnionPolys === 'function')
      ? {
          getManifoldLib, getVendorDeps, signedArea2D, ensureWinding, clipperUnionPolys, clipperIntersectPolys,
          clipperDiffPolys, clipperOffsetPolys, clipperBufferOpenPaths,
          ringsToOutersWithHoles, safeDeleteManifold, batchUnionManifolds,
          extrudeRingSolid, manifoldFromRawSoup, boxManifoldFromBounds, beamManifoldBetween
        }
      : require('../geometry/manifold_core.js');
    const pierMod = (typeof buildMarinePiersAndBreakwaters === 'function' && typeof computeFootprintOBB === 'function')
      ? { computeFootprintOBB, resolveGroundZ, buildMarinePiersAndBreakwaters }
      : require('./waterfront_piers_solver.js');
    const structMod = (typeof buildParametricLatticeManifold === 'function' && typeof buildObservationWheelManifold === 'function')
      ? { buildObservationWheelManifold, buildWindTurbineManifold, buildParametricLatticeManifold, buildTowerOrIndustrialManifold }
      : require('./lattice_and_structures_solver.js');
    const treeMod = (typeof buildTreesArchetypeList === 'function')
      ? { buildTreesArchetypeList }
      : require('./tree_scatter_solver.js');
    return { core, pierMod, structMod, treeMod };
  }

  const WHEEL_ATTR = new Set(['big_wheel', 'ferris_wheel', 'observation_wheel']);
  const IND_SET = new Set(['storage_tank', 'silo', 'chimney', 'cooling_tower', 'crane']);
  const TOWER_SET = new Set(['tower', 'mast', 'communications_tower', 'lighthouse']);

  function _computeGroupDatums(ctx, scene, terrainWater) {
    const grd = new Map(), fbk = new Map(), { toBed } = ctx;
    for (const b of (scene && scene.buildings) || []) {
      if (!b || b.hidden || b.isOutline || !b.outer || b.outer.length < 3 || b.groupId == null) continue;
      const gKey = String(b.groupId), tags = b.tags || {};
      const rawMinH = Math.max(0, Number(b.minH !== undefined ? b.minH : (tags.min_height || 0)) || 0);
      let minZ = Infinity;
      for (const p of b.outer) {
        const bp = toBed(p);
        const z = (ctx.waterCutout && terrainWater && terrainWater.isPointInWater(bp[0], bp[1])) ? 0.0
          : (terrainWater && typeof terrainWater.getSurfaceZ === 'function' ? terrainWater.getSurfaceZ(bp[0], bp[1]) : ctx.getTerrainZ(bp[0], bp[1]));
        if (z < minZ) minZ = z;
      }
      if (!Number.isFinite(minZ)) continue;
      const tgt = rawMinH <= 0.05 ? grd : fbk, prev = tgt.get(gKey);
      if (prev === undefined || minZ < prev) tgt.set(gKey, minZ);
    }
    const out = new Map(fbk);
    for (const [k, v] of grd) out.set(k, v);
    return out;
  }

  function _mergeLayeredGroupManifolds(core, mf, buildingLayerManifolds, s3db) {
    const grpIds = new Set(buildingLayerManifolds.map(x => x.groupId).filter(g => g != null));
    if (grpIds.size === 0) return;
    const s3dbNorm = (s3db && Array.isArray(s3db.buildingManifolds)) ? s3db.buildingManifolds : [];
    for (const gid of grpIds) {
      const l2Idx = [], s1Items = [];
      for (let i = 0; i < buildingLayerManifolds.length; i++) if (buildingLayerManifolds[i].groupId === gid) l2Idx.push(i);
      for (let i = 0; i < s3dbNorm.length; i++) if (s3dbNorm[i].groupId != null && String(s3dbNorm[i].groupId) === gid) s1Items.push(s3dbNorm[i]);
      if (l2Idx.length + s1Items.length < 2 || s1Items.length === 0 && l2Idx.length < 2) continue;
      const allMans = [...s1Items.map(x => x.manifold), ...l2Idx.map(i => buildingLayerManifolds[i].manifold)];
      const keepId = (s1Items[0] || buildingLayerManifolds[l2Idx[0]]).buildingId;
      const unified = core.batchUnionManifolds(mf, allMans);
      if (!unified || unified.numTri() === 0) { core.safeDeleteManifold(unified); continue; }
      for (const s1 of s1Items) { const ix = s3dbNorm.indexOf(s1); if (ix >= 0) s3dbNorm.splice(ix, 1); }
      for (let k = l2Idx.length - 1; k >= 0; k--) buildingLayerManifolds.splice(l2Idx[k], 1);
      buildingLayerManifolds.push({ buildingId: keepId, groupId: gid, manifold: unified, isFloatingPart: false });
    }
  }

  function buildLayer2Archetypes(ctx, scene, terrainWater, s3db = null) {
    const { core, pierMod, structMod, treeMod } = _getDeps();
    const { mf, halfW, halfH, toBed, latLonToScene } = ctx;
    const utils = { computeFootprintOBB: pierMod.computeFootprintOBB, resolveGroundZ: pierMod.resolveGroundZ };
    const groupDatumById = _computeGroupDatums(ctx, scene, terrainWater);

    const buildingLayerManifolds = [];
    const buildingBounds = [];
    const roadLayerManifolds = [];
    const handledOsmIds = new Set();
    const counts = {
      wheels: 0, windTurbines: 0, latticeTowers: 0, towers: 0,
      tanksAndSilos: 0, chimneys: 0, coolingTowers: 0, cranes: 0, marinePiers: 0, trees: 0
    };

    const els = (scene && scene.osmElements) || [];
    const rawTagMap = new Map();
    const nodeCoords = new Map();
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el) continue;
      if (el.tags) rawTagMap.set(el.id, el.tags);
      if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) nodeCoords.set(el.id, el);
    }

    const buildingFootprints2D = [];
    for (const b of (scene && scene.buildings) || []) {
      if (!b || b.hidden || b.isOutline || !b.outer || b.outer.length < 3) continue;
      const oBed = b.outer.map(toBed);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of oBed) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      }
      buildingFootprints2D.push({ outer: oBed, bb: [minX, minY, maxX, maxY] });

      const tags = Object.assign({}, rawTagMap.get(b.osmId) || {}, b.tags || {});
      const mm = String(tags.man_made || '').toLowerCase().trim();
      const attr = String(tags.attraction || '').toLowerCase().trim();
      const tt = String(tags['tower:type'] || '').toLowerCase().trim();
      const tc = String(tags['tower:construction'] || b.towerConstruction || '').toLowerCase().trim();
      const hM = Number(b.h !== undefined ? b.h : (b.height || tags.height || 0)) || 0;
      const isWheel = b.archType === 'ferris_wheel' || b.btype === 'observation_wheel' || WHEEL_ATTR.has(attr) || tt === 'observation_wheel';
      const isWind = mm === 'wind_turbine' || (tags.power === 'generator' && tags['generator:source'] === 'wind');
      const isLattice = tc === 'lattice' || tc === 'guyed_lattice';
      let solid = null;

      if (isWheel) {
        solid = structMod.buildObservationWheelManifold(core, mf, ctx, terrainWater, oBed, hM, utils);
        if (solid) counts.wheels++;
      } else if (isWind) {
        const obb = pierMod.computeFootprintOBB(oBed);
        solid = structMod.buildWindTurbineManifold(core, mf, ctx, terrainWater, obb.cx, obb.cy, hM || 75, 0, utils);
        if (solid) counts.windTurbines++;
      } else if (isLattice) {
        const gDatum = b.groupId != null ? groupDatumById.get(String(b.groupId)) : undefined;
        const bInput = Number.isFinite(gDatum) ? Object.assign({}, b, { groupDatumZ: gDatum }) : b;
        solid = structMod.buildParametricLatticeManifold(core, mf, ctx, terrainWater, bInput, oBed, tags, hM, utils);
        if (solid) counts.latticeTowers++;
      } else if (TOWER_SET.has(mm)) {
        if (!b.part && !b.fromBuildingRel) {
          solid = structMod.buildTowerOrIndustrialManifold(core, mf, ctx, terrainWater, oBed, mm, tags, hM, utils);
          if (solid) counts.towers++;
        }
      } else if (IND_SET.has(mm)) {
        solid = structMod.buildTowerOrIndustrialManifold(core, mf, ctx, terrainWater, oBed, mm, tags, hM, utils);
        if (solid) {
          if (mm === 'chimney') counts.chimneys++;
          else if (mm === 'cooling_tower') counts.coolingTowers++;
          else if (mm === 'crane') counts.cranes++;
          else counts.tanksAndSilos++;
        }
      }

      if (solid && solid.numTri() > 0) {
        if (b.osmId) handledOsmIds.add(b.osmId);
        const archType = isLattice ? 'lattice_tower' : (mm || (isWheel ? 'ferris_wheel' : 'tower'));
        const pickId = ctx.allocPickId({ buildingId: b.id != null ? b.id : -1, osmId: b.osmId || null, name: b.name || '', archType });
        buildingLayerManifolds.push({ buildingId: pickId, groupId: b.groupId != null ? String(b.groupId) : null, manifold: solid });
        const bb = solid.boundingBox(), bcx = (bb.min[0] + bb.max[0]) * 0.5, bcy = (bb.min[1] + bb.max[1]) * 0.5;
        buildingBounds.push({
          id: b.id != null ? b.id : pickId, pickId, osmId: b.osmId || null, name: b.name || tags.name || '',
          minX: bb.min[0], minY: bb.min[1], minZ: bb.min[2], maxX: bb.max[0], maxY: bb.max[1], maxZ: bb.max[2],
          cx: bcx, cy: bcy, interiorPt: [bcx, bcy], roof: b.roof || 'flat', minH: b.minH || 0, h: hM || 60, archType
        });
      }
    }

    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el || !el.tags || handledOsmIds.has(el.id)) continue;
      const tags = el.tags, mm = String(tags.man_made || '').toLowerCase().trim(), tc = String(tags['tower:construction'] || '').toLowerCase().trim();
      const isWind = mm === 'wind_turbine' || (tags.power === 'generator' && tags['generator:source'] === 'wind');
      const isWheel = WHEEL_ATTR.has(String(tags.attraction || '').toLowerCase().trim()) || tags['tower:type'] === 'observation_wheel';
      const isLat = tc === 'lattice' || tc === 'guyed_lattice';
      if (tags.building || (!isWind && !isWheel && !isLat && !TOWER_SET.has(mm) && !IND_SET.has(mm))) continue;

      let oBed = null, cx = 0, cy = 0;
      if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
        [cx, cy] = latLonToScene(el.lat, el.lon);
        const r = Math.max(ctx.minPrintU * 1.4, 2.8 * ctx.mToU * ctx.scaleToBed);
        oBed = [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
      } else if (el.type === 'way' && el.nodes && el.nodes.length >= 2) {
        const pts = el.nodes.map(nid => nodeCoords.get(nid)).filter(Boolean).map(n => latLonToScene(n.lat, n.lon));
        if (pts.length >= 3) { oBed = pts; cx = pts.reduce((s, p) => s + p[0], 0) / pts.length; cy = pts.reduce((s, p) => s + p[1], 0) / pts.length; }
      }
      if (!oBed || Math.abs(cx) > halfW + 1.0 || Math.abs(cy) > halfH + 1.0) continue;

      const hM = Number(parseFloat(tags.height)) || 0;
      let solid = null;
      if (isWind) { solid = structMod.buildWindTurbineManifold(core, mf, ctx, terrainWater, cx, cy, hM || 75, 0, utils); if (solid) counts.windTurbines++; }
      else if (isWheel) { solid = structMod.buildObservationWheelManifold(core, mf, ctx, terrainWater, oBed, hM, utils); if (solid) counts.wheels++; }
      else if (isLat) { solid = structMod.buildParametricLatticeManifold(core, mf, ctx, terrainWater, null, oBed, tags, hM, utils); if (solid) counts.latticeTowers++; }
      else {
        const kind = TOWER_SET.has(mm) ? mm : (IND_SET.has(mm) ? mm : 'tower');
        solid = structMod.buildTowerOrIndustrialManifold(core, mf, ctx, terrainWater, oBed, kind, tags, hM, utils);
        if (solid) {
          if (TOWER_SET.has(kind)) counts.towers++;
          else if (kind === 'chimney') counts.chimneys++;
          else if (kind === 'cooling_tower') counts.coolingTowers++;
          else if (kind === 'crane') counts.cranes++;
          else counts.tanksAndSilos++;
        }
      }
      if (solid && solid.numTri() > 0) {
        handledOsmIds.add(el.id);
        const archType = isLat ? 'lattice_tower' : (mm || (isWind ? 'wind_turbine' : 'wheel'));
        const pickId = ctx.allocPickId({ buildingId: -1, osmId: el.id, name: tags.name || '', archType });
        buildingLayerManifolds.push({ buildingId: pickId, manifold: solid });
        const bb = solid.boundingBox(), bcx = (bb.min[0] + bb.max[0]) * 0.5, bcy = (bb.min[1] + bb.max[1]) * 0.5;
        buildingBounds.push({
          id: pickId, osmId: el.id, name: tags.name || '', minX: bb.min[0], minY: bb.min[1], minZ: bb.min[2],
          maxX: bb.max[0], maxY: bb.max[1], maxZ: bb.max[2], cx: bcx, cy: bcy, interiorPt: [bcx, bcy],
          roof: 'flat', minH: 0, h: hM || 40, archType
        });
      }
    }

    _mergeLayeredGroupManifolds(core, mf, buildingLayerManifolds, s3db);
    const pierRes = pierMod.buildMarinePiersAndBreakwaters(core, mf, ctx, scene, terrainWater);
    for (const ps of (pierRes.solids || [])) roadLayerManifolds.push(ps);
    counts.marinePiers = pierRes.pierCount || 0;

    const greeneryTreeManifolds = treeMod.buildTreesArchetypeList(mf, ctx, scene, terrainWater, buildingFootprints2D);
    counts.trees = greeneryTreeManifolds.length;

    ctx.audit.archetypeCounts = counts;
    return { buildingLayerManifolds, buildingBounds, roadLayerManifolds, greeneryTreeManifolds, counts };
  }

  const exportsObj = { buildLayer2Archetypes };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
