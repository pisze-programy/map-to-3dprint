// ============================================================================
// src/mesh/layer1_s3db_buildings.js
// Layer 1 Pure S3DB Solid Extraction, Courtyard-Safe Grouping & Cluster Merge
// ============================================================================

if (typeof _computeOBB === 'undefined' && typeof require !== 'undefined') {
  try { Object.assign(global, require('./s3db_roof_revolve.js')); } catch (_) {}
}
if (typeof buildSkeletonOrPolyRoof === 'undefined' && typeof require !== 'undefined') {
  try { Object.assign(global, require('./s3db_roof_skeleton.js')); } catch (_) {}
}
if (typeof buildS3DBPartSolid === 'undefined' && typeof require !== 'undefined') {
  try { Object.assign(global, require('./s3db_part_builder.js')); } catch (_) {}
}

(function (root) {
  function _getCore() {
    if (typeof createBuildContext === 'function') {
      return {
        ensureWinding: root.ensureWinding, clipperIntersectPolys: root.clipperIntersectPolys,
        clipperDiffPolys: root.clipperDiffPolys, clipperOffsetPolys: root.clipperOffsetPolys,
        ringsToOutersWithHoles: root.ringsToOutersWithHoles, batchUnionManifolds: root.batchUnionManifolds,
        extrudeRingSolid: root.extrudeRingSolid, manifoldFromRawSoup: root.manifoldFromRawSoup,
        safeDeleteManifold: root.safeDeleteManifold, getVendorDeps: root.getVendorDeps,
      };
    }
    return require('../geometry/manifold_core.js');
  }

  function _ptInSolid(px, py, outer, holes) {
    if (!_ptInRing(px, py, outer)) return false;
    for (const h of (holes || [])) if (h && h.length >= 3 && _ptInRing(px, py, h)) return false;
    return true;
  }

  function _segMinDistSq2D(ax, ay, bx, by, cx, cy, dx, dy) {
    const ptSeg = (px, py, x1, y1, x2, y2) => {
      const vx = x2 - x1, vy = y2 - y1, l2 = vx * vx + vy * vy;
      const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / l2)) : 0;
      return (px - (x1 + t * vx)) ** 2 + (py - (y1 + t * vy)) ** 2;
    };
    const ccw = (x1, y1, x2, y2, x3, y3) => (y3 - y1) * (x2 - x1) > (y2 - y1) * (x3 - x1);
    if ((ccw(ax, ay, cx, cy, dx, dy) !== ccw(bx, by, cx, cy, dx, dy)) && (ccw(ax, ay, bx, by, cx, cy) !== ccw(ax, ay, bx, by, dx, dy))) return 0;
    return Math.min(ptSeg(ax, ay, cx, cy, dx, dy), ptSeg(bx, by, cx, cy, dx, dy), ptSeg(cx, cy, ax, ay, bx, by), ptSeg(dx, dy, ax, ay, bx, by));
  }

  function _ringsTouchOrOverlap2D(core, ringA, ringB, pad = 0.15) {
    if (!ringA || ringA.length < 3 || !ringB || ringB.length < 3) return false;
    for (const pt of ringA) if (_ptInRing(pt[0], pt[1], ringB)) return true;
    for (const pt of ringB) if (_ptInRing(pt[0], pt[1], ringA)) return true;
    if (core && typeof core.clipperIntersectPolys === 'function' && core.clipperIntersectPolys([ringA], [ringB], 1e-5).length > 0) return true;
    const padSq = pad * pad;
    for (let i = 0; i < ringA.length; i++) {
      const a1 = ringA[i], a2 = ringA[(i + 1) % ringA.length];
      for (let j = 0; j < ringB.length; j++) {
        const b1 = ringB[j], b2 = ringB[(j + 1) % ringB.length];
        if (_segMinDistSq2D(a1[0], a1[1], a2[0], a2[1], b1[0], b1[1], b2[0], b2[1]) <= padSq) return true;
      }
    }
    return false;
  }

  function _extractRecordBoxAndRings(r) {
    const rings = (r.structured && r.structured.length > 0) ? r.structured.map(sr => sr.outer) : (r.outer ? [r.outer] : []);
    if (r.bb) return { bb: r.bb, rings };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const ring of rings) for (const p of ring) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    return { bb: { min: [minX, minY, r.minZ ?? 0], max: [maxX, maxY, r.maxZ ?? 0] }, rings };
  }

  function recordsTouch3D(a, b, xyTouchPad = 0.15, zTouchTol = 0.35, coreArg = null) {
    if (!a || !b) return false;
    const ra = _extractRecordBoxAndRings(a), rb = _extractRecordBoxAndRings(b);
    if (ra.bb.max[0] < rb.bb.min[0] - xyTouchPad || ra.bb.min[0] > rb.bb.max[0] + xyTouchPad ||
        ra.bb.max[1] < rb.bb.min[1] - xyTouchPad || ra.bb.min[1] > rb.bb.max[1] + xyTouchPad) return false;
    if (ra.bb.min[2] > rb.bb.max[2] + zTouchTol || ra.bb.max[2] < rb.bb.min[2] - zTouchTol) return false;
    const core = coreArg || _getCore();
    for (const ringA of ra.rings) for (const ringB of rb.rings) if (_ringsTouchOrOverlap2D(core, ringA, ringB, xyTouchPad)) return true;
    return false;
  }

  function buildLayer1S3DBBuildings(ctx, scene, terrainWater) {
    const core = _getCore();
    const { mf, halfW, halfH, toBed, mToU, scaleMm } = ctx;
    const rawTagById = new Map();
    for (const el of ((scene && scene.osmElements) || [])) if (el && el.id !== undefined && el.tags) rawTagById.set(el.id, el.tags);
    const padClip = 0.25, platePoly = [[[-halfW - padClip, -halfH - padClip], [halfW + padClip, -halfH - padClip], [halfW + padClip, halfH + padClip], [-halfW - padClip, halfH + padClip]]];
    const normalGroups = new Map(), highlightGroups = new Map(), boundsOut = [], consumedArchBuildingIds = new Set(), consumedArchGroups = new Set();

    const buildingsList = (scene && scene.buildings) || [];
    const _prepMeta = buildingsList.map((b, idx) => {
      if (!b || b.hidden || b.isOutline || !b.outer || b.outer.length < 3) return null;
      const tags = Object.assign({}, rawTagById.get(b.osmId) || {}, b.tags || {});
      if (isLayer2ArchetypeRecord(b, tags)) return null;
      let cx = 0, cy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const pt of b.outer) { cx += pt[0]; cy += pt[1]; if (pt[0] < minX) minX = pt[0]; if (pt[0] > maxX) maxX = pt[0]; if (pt[1] < minY) minY = pt[1]; if (pt[1] > maxY) maxY = pt[1]; }
      return {
        idx, b, tags, areaM2: Math.abs(_ringAreaSigned(b.outer)) / Math.max(1e-8, mToU * mToU),
        cx: cx / b.outer.length, cy: cy / b.outer.length, minX, maxX, minY, maxY, bodyTopM: 0, bracedTopM: 0,
        rawH: Number((b.h !== undefined && b.h !== null) ? b.h : (b.height !== undefined ? b.height : 9.0)),
        rawMinH: Math.max(0, Number(b.minH !== undefined ? b.minH : (tags.min_height || 0)) || 0),
        normRoof: _normalizeRoofShape(tags['roof:shape'] || b.roof || 'flat'), skip: false, skipReason: null, flattened: false,
      };
    });

    const groupGroundedMinEle = new Map(), groupFallbackMinEle = new Map();
    for (const m of _prepMeta) {
      if (!m || m.b.groupId === undefined || m.b.groupId === null) continue;
      const gKey = String(m.b.groupId), terr = sampleFootprintTerrainZ([m.b.outer.map(toBed)], ctx, terrainWater);
      const tgt = m.rawMinH <= 0.05 ? groupGroundedMinEle : groupFallbackMinEle, prev = tgt.get(gKey);
      if (prev === undefined || terr.minZ < prev) tgt.set(gKey, terr.minZ);
    }
    const groupDatumById = new Map(groupFallbackMinEle);
    for (const [k, v] of groupGroundedMinEle) groupDatumById.set(k, v);

    const spireRoofSet = new Set(['dome', 'onion', 'cone', 'pyramidal']);
    for (let i = 0; i < _prepMeta.length; i++) {
      const m = _prepMeta[i]; if (!m) continue;
      for (let j = 0; j < _prepMeta.length; j++) {
        if (i === j) continue;
        const o = _prepMeta[j]; if (!o || o.skip) continue;
        const sameGroup = m.b.groupId !== undefined && m.b.groupId !== null && m.b.groupId === o.b.groupId;
        const overlapsBox = !(m.maxX < o.minX || m.minX > o.maxX || m.maxY < o.minY || m.minY > o.maxY);
        const insideOther = overlapsBox && _ptInSolid(m.cx, m.cy, o.b.outer, o.b.holes);
        if (o.areaM2 > m.areaM2 * 1.25 && o.rawH >= 6.0 && (sameGroup || insideOther)) { if (o.rawH > m.bracedTopM) m.bracedTopM = o.rawH; if (m.rawH > o.rawH + 1.5 && o.rawH > m.bodyTopM) m.bodyTopM = o.rawH; }
        if (!overlapsBox) continue;
        if ((m.b.part || m.tags['building:part']) && o.areaM2 > m.areaM2 * 1.15 && insideOther && m.rawMinH >= o.rawMinH - 0.5 && m.rawH <= o.rawH + 0.5 &&
            m.b.outer.every(pt => _ptInSolid(pt[0], pt[1], o.b.outer, o.b.holes))) { m.skip = true; m.skipReason = 'cluster_swallowed_interior'; break; }
        if (spireRoofSet.has(m.normRoof) && (sameGroup || insideOther || _ptInSolid(o.cx, o.cy, m.b.outer, m.b.holes)) &&
            o.normRoof === 'flat' && o.rawMinH >= m.rawH - 2.0 && o.rawMinH <= m.rawH + 1.5 && (o.areaM2 / Math.max(1e-6, m.areaM2)) > 0.60) m.flattened = true;
      }
    }

    for (let i = 0; i < buildingsList.length; i++) {
      const b = buildingsList[i];
      if (!b || b.hidden || b.isOutline || !b.outer || b.outer.length < 3) continue;
      const tags = Object.assign({}, rawTagById.get(b.osmId) || {}, b.tags || {});
      if (isLayer2ArchetypeRecord(b, tags)) { if (b.id !== undefined) consumedArchBuildingIds.add(b.id); if (b.groupId != null) consumedArchGroups.add(String(b.groupId)); continue; }
      const metaP = _prepMeta[i];
      if (metaP && metaP.skip) {
        ctx.audit.preparedList.push({ id: b.id ?? (i + 1), osmId: b.osmId || null, groupId: b.groupId ?? null, name: b.name || '', btype: b.btype || 'yes', isPart: Boolean(b.part || tags['building:part']), part: Boolean(b.part), skip: true, skipReason: metaP.skipReason, preRoofShape: metaP.normRoof, roofShape: metaP.normRoof, roof: metaP.normRoof, h: metaP.rawH, minH: metaP.rawMinH, zBase: metaP.rawMinH, zTop: metaP.rawH, area: metaP.areaM2 });
        continue;
      }
      const built = buildS3DBPartSolid(core, b, tags, metaP, groupDatumById, platePoly, scene, ctx, terrainWater);
      if (!built) continue;
      const bId = b.id !== undefined ? b.id : (i + 1), isHi = Boolean(b.highlighted);
      const grpKey = (b.groupId !== undefined && b.groupId !== null) ? `${isHi ? 'hg' : 'ng'}:${b.groupId}` : `${isHi ? 'hb' : 'nb'}:${bId}`;
      const bb = built.bSolid.boundingBox(), targetMap = isHi ? highlightGroups : normalGroups;
      if (!targetMap.has(grpKey)) targetMap.set(grpKey, { groupKey: grpKey, isHi, records: [], hasGrounded: false, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });
      const grp = targetMap.get(grpKey);
      const rec = {
        b, bId, osmId: b.osmId || null, groupId: b.groupId ?? null, name: b.name || '', btype: b.btype || 'yes', isHi,
        structured: built.structured, zGroundSeat: built.zGroundSeat, zDatum: built.zDatum, zBase: built.zBase, zEaves: built.zEaves, zTop: built.zTop,
        rawH_m: built.rawH_m, rawMinH_m: built.rawMinH_m, preRoofShape: built.preNormShape, roofShape: built.roofShape, flattenedUnderSuperstructure: built.flattenedUnderSuperstructure,
        area: metaP ? metaP.areaM2 : 0, isPart: Boolean(b.part || tags['building:part']), part: Boolean(b.part),
        isElevated: built.effMinHU > 0 && built.zBase > built.zGroundSeat + (0.45 / scaleMm), solid: built.bSolid, bb,
      };
      grp.records.push(rec);
      if (!rec.isElevated) grp.hasGrounded = true;
      grp.minX = Math.min(grp.minX, bb.min[0]); grp.maxX = Math.max(grp.maxX, bb.max[0]);
      grp.minY = Math.min(grp.minY, bb.min[1]); grp.maxY = Math.max(grp.maxY, bb.max[1]);
      grp.minZ = Math.min(grp.minZ, bb.min[2]); grp.maxZ = Math.max(grp.maxZ, bb.max[2]);
    }

    const allClusters = [...normalGroups.values(), ...highlightGroups.values()];
    const xyTouchPad = Math.max(0.15, 0.25 / scaleMm), zTouchTol = Math.max(0.65 / scaleMm, 0.25);
    for (let pass = 0; pass < 16; pass++) {
      let mergedAny = false;
      for (const c of allClusters) {
        if (c.mergedOut || c.hasGrounded || c.records.length === 0) continue;
        let bestG = null;
        for (const g of allClusters) {
          if (g === c || g.mergedOut || !g.hasGrounded) continue;
          if (c.maxX < g.minX - xyTouchPad || c.minX > g.maxX + xyTouchPad || c.maxY < g.minY - xyTouchPad || c.minY > g.maxY + xyTouchPad) continue;
          if (bestG && bestG.isHi === c.isHi && g.isHi !== c.isHi) continue;
          if (c.records.some(rc => g.records.some(rg => recordsTouch3D(rc, rg, xyTouchPad, zTouchTol, core)))) { bestG = g; if (g.isHi === c.isHi) break; }
        }
        if (bestG) {
          for (const rc of c.records) {
            bestG.records.push(rc);
            bestG.minX = Math.min(bestG.minX, rc.bb.min[0]); bestG.maxX = Math.max(bestG.maxX, rc.bb.max[0]);
            bestG.minY = Math.min(bestG.minY, rc.bb.min[1]); bestG.maxY = Math.max(bestG.maxY, rc.bb.max[1]);
            bestG.minZ = Math.min(bestG.minZ, rc.bb.min[2]); bestG.maxZ = Math.max(bestG.maxZ, rc.bb.max[2]);
          }
          c.mergedOut = true; mergedAny = true;
        }
      }
      if (!mergedAny) break;
    }

    for (const c of allClusters) {
      if (c.mergedOut || c.hasGrounded || c.records.length === 0 || c.records.some(r => r.groupId != null && consumedArchGroups.has(String(r.groupId)))) continue;
      for (const rc of c.records) if (rc.structured.length) {
        const anchor = core.extrudeRingSolid(mf, rc.structured[0].outer, rc.structured[0].holes, rc.zGroundSeat, rc.zBase + (0.12 / scaleMm));
        if (anchor) {
          const fused = rc.solid.add(anchor); core.safeDeleteManifold(anchor);
          if (fused && fused.numTri() > 0) { core.safeDeleteManifold(rc.solid); rc.solid = fused; rc.bb = fused.boundingBox(); } else core.safeDeleteManifold(fused);
        }
      }
      c.hasGrounded = true;
    }

    const emitClusterGroup = (isHiFlag) => {
      const out = [];
      for (const c of allClusters) {
        if (c.mergedOut || c.isHi !== isHiFlag || c.records.length === 0) continue;
        const primary = c.records.find(r => !r.isElevated) || c.records[0];
        const pickId = ctx.allocPickId({ id: primary.bId, buildingId: primary.bId, groupId: primary.groupId, osmId: primary.osmId, name: primary.name, btype: primary.btype, roof: primary.roofShape, heightM: primary.rawH_m, highlighted: isHiFlag, buildings: c.records.map(r => ({ id: r.bId, osmId: r.osmId })) });
        let merged = c.records.length === 1 ? c.records[0].solid : core.batchUnionManifolds(mf, c.records.map(r => r.solid));
        if (!merged || merged.numTri() === 0) { core.safeDeleteManifold(merged); continue; }
        let mbb = merged.boundingBox();
        const mCx = (mbb.min[0] + mbb.max[0]) * 0.5, mCy = (mbb.min[1] + mbb.max[1]) * 0.5;
        const mGroundZ = terrainWater && typeof terrainWater.getSurfaceZ === 'function' ? terrainWater.getSurfaceZ(mCx, mCy) : ctx.getTerrainZ(mCx, mCy);
        if (!ctx.waterCutout && mbb.min[2] > mGroundZ + (0.35 / scaleMm) && primary.structured.length > 0) {
          const anchor = core.extrudeRingSolid(mf, primary.structured[0].outer, primary.structured[0].holes, Math.max(0.10 / scaleMm, mGroundZ - (0.20 / scaleMm)), mbb.min[2] + (0.12 / scaleMm));
          if (anchor) { const g = merged.add(anchor); core.safeDeleteManifold(anchor); if (g && g.numTri() > 0) { core.safeDeleteManifold(merged); merged = g; mbb = merged.boundingBox(); } else core.safeDeleteManifold(g); }
        }
        out.push({ buildingId: pickId, sourceBuildingId: primary.bId, groupId: primary.groupId ?? null, manifold: merged, isFloatingPart: false });
        for (const r of c.records) {
          const rCx = (r.bb.min[0] + r.bb.max[0]) * 0.5, rCy = (r.bb.min[1] + r.bb.max[1]) * 0.5;
          boundsOut.push({ id: r.bId, osmId: r.osmId, name: r.name, minX: r.bb.min[0], minY: r.bb.min[1], minZ: mbb.min[2], maxX: r.bb.max[0], maxY: r.bb.max[1], maxZ: r.bb.max[2], cx: rCx, cy: rCy, interiorPt: [rCx, rCy], roof: r.roofShape, minH: r.rawMinH_m, h: r.rawH_m });
          const auditEntry = { id: r.bId, osmId: r.osmId, groupId: r.groupId, pickId, name: r.name, btype: r.btype, tZ: r.zDatum, preRoofShape: r.preRoofShape, roofShape: r.roofShape, roof: r.roofShape, flattenedUnderSuperstructure: r.flattenedUnderSuperstructure, skip: false, h: r.rawH_m, minH: r.rawMinH_m, zBase: r.zBase, zEaves: r.zEaves, zRidge: r.zTop, zTop: r.zTop, area: r.area, isPart: r.isPart, part: r.part, highlighted: isHiFlag };
          ctx.audit.preparedList.push(auditEntry); ctx.audit.s3dbAllFinalBuildings.push(auditEntry);
        }
      }
      return out;
    };

    const buildingManifolds = emitClusterGroup(false), highlightedManifolds = emitClusterGroup(true);
    return { buildingManifolds, highlightedManifolds, buildingBounds: boundsOut, consumedArchBuildingIds, count: buildingManifolds.length + highlightedManifolds.length };
  }

  const exportsObj = { buildLayer1S3DBBuildings, isLayer2ArchetypeRecord, _normalizeRoofShape, _buildRoofManifold, recordsTouch3D };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
