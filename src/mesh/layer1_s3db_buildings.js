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
        clipperUnionPolys: root.clipperUnionPolys,
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

  function _ringsMinDist2D(core, ringA, ringB) {
    if (!ringA || ringA.length < 3 || !ringB || ringB.length < 3) return Infinity;
    for (const pt of ringA) if (_ptInRing(pt[0], pt[1], ringB)) return 0;
    for (const pt of ringB) if (_ptInRing(pt[0], pt[1], ringA)) return 0;
    if (core && typeof core.clipperIntersectPolys === 'function' && core.clipperIntersectPolys([ringA], [ringB], 1e-5).length > 0) return 0;
    let bestSq = Infinity;
    for (let i = 0; i < ringA.length; i++) {
      const a1 = ringA[i], a2 = ringA[(i + 1) % ringA.length];
      for (let j = 0; j < ringB.length; j++) {
        const b1 = ringB[j], b2 = ringB[(j + 1) % ringB.length];
        const dSq = _segMinDistSq2D(a1[0], a1[1], a2[0], a2[1], b1[0], b1[1], b2[0], b2[1]);
        if (dSq <= 1e-12) return 0;
        if (dSq < bestSq) bestSq = dSq;
      }
    }
    return Math.sqrt(bestSq);
  }

  function _ringsTouchOrOverlap2D(core, ringA, ringB, pad = 0.15) {
    return _ringsMinDist2D(core, ringA, ringB) <= pad;
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

  function _solidsOverlap3D(core, mA, mB) {
    if (!mA || !mB || mA.numTri() === 0 || mB.numTri() === 0) return false;
    let hit = null;
    try {
      hit = mA.intersect(mB);
      return Boolean(hit && hit.numTri() > 0);
    } catch (_) {
      return false;
    } finally {
      core.safeDeleteManifold(hit);
    }
  }

  function _weldElevatedGapCollar(core, mf, rc, rg, maxGapXY, zTol, platePoly, scaleMm) {
    if (!rc || !rg || !rc.structured.length || !rg.structured.length) return false;
    if (rc.zBase > rg.zTop + zTol || rc.zTop < rg.bb.min[2] - zTol) return false;
    const rcRings = rc.structured.map(s => s.outer), rgRings = rg.structured.map(s => s.outer);
    let minD = Infinity;
    for (const ra of rcRings) for (const rb of rgRings) { const d = _ringsMinDist2D(core, ra, rb); if (d < minD) minD = d; }
    if (minD > maxGapXY) return false;
    if (minD <= 1e-4 && _solidsOverlap3D(core, rc.solid, rg.solid)) return true;
    const grow = Math.max(0.14 / scaleMm, minD + (0.20 / scaleMm));
    let col2D = core.clipperIntersectPolys(
      core.clipperOffsetPolys(rcRings, grow, 'Miter', 1e-5),
      core.clipperOffsetPolys(rgRings, grow, 'Miter', 1e-5),
      1e-5
    );
    if (col2D.length > 0) col2D = core.clipperIntersectPolys(col2D, platePoly, 1e-5);
    if (col2D.length === 0) return false;
    const rgWallTop = rg.zEaves !== undefined ? rg.zEaves : rg.zTop;
    const lateral = rgWallTop >= rc.zBase + (0.12 / scaleMm);
    const zBot = lateral ? rc.zBase : Math.max(rg.zGroundSeat, Math.min(rc.zBase, rgWallTop) - (0.16 / scaleMm));
    const zTop = lateral ? Math.min(rc.zTop, rgWallTop) : Math.min(rc.zTop, Math.max(rc.zBase, rg.zTop) + (0.20 / scaleMm));
    if (zTop <= zBot + (0.05 / scaleMm)) return false;
    const colParts = [];
    for (const st of core.ringsToOutersWithHoles(col2D, 1e-5)) {
      const m = core.extrudeRingSolid(mf, st.outer, st.holes, zBot, zTop);
      if (m) colParts.push(m);
    }
    if (!colParts.length) return false;
    const colSolid = colParts.length === 1 ? colParts[0] : core.batchUnionManifolds(mf, colParts);
    if (!_solidsOverlap3D(core, colSolid, rg.solid)) {
      core.safeDeleteManifold(colSolid);
      return false;
    }
    const fused = rc.solid.add(colSolid);
    core.safeDeleteManifold(colSolid);
    if (fused && fused.numTri() > 0) {
      core.safeDeleteManifold(rc.solid);
      rc.solid = fused;
      rc.bb = fused.boundingBox();
      return true;
    }
    core.safeDeleteManifold(fused);
    return false;
  }

  function _groundPortalOnEndPiers(core, mf, rc, platePoly, ctx) {
    const { scaleMm, slaLaws } = ctx;
    if (!rc || !rc.structured.length) return;
    const sr = rc.structured[0];
    const obb = _computeOBB(sr.outer, null, 'along', 0);
    const dropMm = Math.max(1.0, (rc.zBase - rc.zGroundSeat) * scaleMm);
    const minPinMm = (slaLaws && typeof slaLaws.minPinDiameterMm === 'function') ? slaLaws.minPinDiameterMm(dropMm) : 0.85;
    const pierW = Math.max((minPinMm * 1.18) / scaleMm, Math.min(obb.spanU * 0.17, 2.2 / scaleMm));
    const zTop = rc.zBase + (0.14 / scaleMm);
    const piers = [];

    if (obb.spanU >= pierW * 2.8) {
      const toW = (u, v) => [obb.cx + obb.ux * u + obb.vx * v, obb.cy + obb.uy * u + obb.vy * v];
      const vLo = obb.vMin - 0.5, vHi = obb.vMax + 0.5;
      const endBoxes = [
        [toW(obb.uMin - 0.1, vLo), toW(obb.uMin + pierW, vLo), toW(obb.uMin + pierW, vHi), toW(obb.uMin - 0.1, vHi)],
        [toW(obb.uMax - pierW, vLo), toW(obb.uMax + 0.1, vLo), toW(obb.uMax + 0.1, vHi), toW(obb.uMax - pierW, vHi)],
      ];
      const baseRings = sr.holes && sr.holes.length > 0 ? core.clipperDiffPolys([sr.outer], sr.holes, 1e-5) : [sr.outer];
      for (const eb of endBoxes) {
        let cut = core.clipperIntersectPolys(baseRings, [eb], 1e-5);
        if (cut.length > 0) cut = core.clipperIntersectPolys(cut, platePoly, 1e-5);
        for (const st of core.ringsToOutersWithHoles(cut, 1e-5)) {
          const pm = core.extrudeRingSolid(mf, st.outer, st.holes, rc.zGroundSeat, zTop);
          if (pm) piers.push(pm);
        }
      }
    }
    if (piers.length === 0) {
      const fb = core.extrudeRingSolid(mf, sr.outer, sr.holes, rc.zGroundSeat, zTop);
      if (fb) piers.push(fb);
    }
    if (piers.length > 0) {
      const anchor = piers.length === 1 ? piers[0] : core.batchUnionManifolds(mf, piers);
      const fused = rc.solid.add(anchor);
      core.safeDeleteManifold(anchor);
      if (fused && fused.numTri() > 0) {
        core.safeDeleteManifold(rc.solid);
        rc.solid = fused;
        rc.bb = fused.boundingBox();
      } else core.safeDeleteManifold(fused);
    }
  }

  function buildLayer1S3DBBuildings(ctx, scene, terrainWater) {
    const core = _getCore();
    const { mf, halfW, halfH, toBed, mToU, scaleMm, maxZUnits } = ctx;
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
      const terr = sampleFootprintTerrainZ([b.outer.map(toBed)], ctx, terrainWater);
      return {
        idx, b, tags, terr, areaM2: Math.abs(_ringAreaSigned(b.outer)) / Math.max(1e-8, mToU * mToU),
        cx: cx / b.outer.length, cy: cy / b.outer.length, minX, maxX, minY, maxY, bodyTopM: 0, bracedTopM: 0,
        rawH: Number((b.h !== undefined && b.h !== null) ? b.h : (b.height !== undefined ? b.height : 9.0)),
        rawMinH: Math.max(0, Number(b.minH !== undefined ? b.minH : (tags.min_height || 0)) || 0),
        normRoof: _normalizeRoofShape(tags['roof:shape'] || b.roof || 'flat'), skip: false, skipReason: null, flattened: false,
      };
    });

    const groupGroundedMinEle = new Map(), groupFallbackMinEle = new Map();
    for (const m of _prepMeta) {
      if (!m || m.b.groupId === undefined || m.b.groupId === null) continue;
      const gKey = String(m.b.groupId), dZ = m.terr.datumMinZ !== undefined ? m.terr.datumMinZ : m.terr.minZ;
      const tgt = m.rawMinH <= 0.05 ? groupGroundedMinEle : groupFallbackMinEle, prev = tgt.get(gKey);
      if (prev === undefined || dZ < prev) tgt.set(gKey, dZ);
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

    // Global C1-continuous soft-knee height compression above zKneeMm (preserves skyscraper hierarchy & stepped tiers)
    const maxSafeZMm = maxZUnits * scaleMm;
    let maxRawZMm = 0;
    for (const m of _prepMeta) {
      if (!m || m.skip) continue;
      const gKey = (m.b.groupId !== undefined && m.b.groupId !== null) ? String(m.b.groupId) : null;
      const tDat = m.terr.datumMinZ !== undefined ? m.terr.datumMinZ : m.terr.minZ;
      const zDat = (gKey && groupDatumById.has(gKey)) ? groupDatumById.get(gKey) : tDat;
      const hMult = (m.b.heightMult || 1.0) * ctx.zScale * ctx.scaleToBed, mToMm = mToU * hMult * scaleMm;
      let effH = Math.max(2.0, m.rawH);
      if (ctx.slaLaws && m.bodyTopM > 0 && effH > m.bodyTopM + 1.5 && m.rawMinH <= m.bodyTopM + 2.0) {
        const obb = _computeOBB(m.b.outer.map(toBed), null, 'along', 0);
        if (Math.min(obb.spanU, obb.spanV) * scaleMm <= 2.4) {
          const capD = ctx.slaLaws.capSpireProtrusionMm((effH - m.bodyTopM) * mToMm, m.bodyTopM * mToMm);
          if (capD > 0) effH = Math.min(effH, m.bodyTopM + capD / Math.max(1e-6, mToMm));
        }
      }
      const zRawMm = (zDat + Math.max(0.4 / scaleMm, effH * mToU * hMult)) * scaleMm;
      if (zRawMm > maxRawZMm) maxRawZMm = zRawMm;
    }
    if (maxRawZMm > maxSafeZMm) {
      ctx.zCapApplied = true;
      const zKneeMm = Math.min(maxSafeZMm * 0.65, Math.max(maxSafeZMm * 0.35, maxSafeZMm - 35.0));
      const H = Math.max(1.0, maxSafeZMm - zKneeMm), Xmax = Math.max(H + 1e-3, maxRawZMm - zKneeMm);
      const cCoeff = (Xmax - H) / (H * Xmax);
      ctx.compressZUnits = (zU) => {
        const zMm = zU * scaleMm;
        if (zMm <= zKneeMm) return zU;
        const x = zMm - zKneeMm;
        return Math.min(maxZUnits, (zKneeMm + (x / (1.0 + cCoeff * x))) / scaleMm);
      };
    } else {
      ctx.compressZUnits = (zU) => zU;
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
    const nearBridgeXY = Math.max(xyTouchPad, Math.min(3.5, Math.max(0.65, 2.0 * mToU * ctx.scaleToBed, 0.85 / scaleMm)));
    const nearBridgeZ = Math.max(zTouchTol, Math.max(0.55, 2.2 * mToU * ctx.zScale * ctx.scaleToBed, 0.95 / scaleMm));
    const absorbClusterInto = (src, dst) => {
      for (const rc of src.records) {
        dst.records.push(rc);
        dst.minX = Math.min(dst.minX, rc.bb.min[0]); dst.maxX = Math.max(dst.maxX, rc.bb.max[0]);
        dst.minY = Math.min(dst.minY, rc.bb.min[1]); dst.maxY = Math.max(dst.maxY, rc.bb.max[1]);
        dst.minZ = Math.min(dst.minZ, rc.bb.min[2]); dst.maxZ = Math.max(dst.maxZ, rc.bb.max[2]);
      }
      src.mergedOut = true;
    };

    for (let pass = 0; pass < 16; pass++) {
      let mergedAny = false;
      for (const c of allClusters) {
        if (c.mergedOut || c.hasGrounded || c.records.length === 0) continue;
        const hits = [];
        for (const [xyTol, zTol] of [[xyTouchPad, zTouchTol], [nearBridgeXY, nearBridgeZ]]) {
          for (const g of allClusters) {
            if (g === c || g.mergedOut || !g.hasGrounded) continue;
            if (c.maxX < g.minX - xyTol || c.minX > g.maxX + xyTol || c.maxY < g.minY - xyTol || c.minY > g.maxY + xyTol) continue;
            if (c.records.some(rc => g.records.some(rg => recordsTouch3D(rc, rg, xyTol, zTol, core)))) hits.push(g);
          }
          if (hits.length > 0) break;
        }
        if (hits.length > 0) {
          hits.sort((a, b) => (a.isHi === c.isHi ? 0 : 1) - (b.isHi === c.isHi ? 0 : 1));
          const bestG = hits[0];
          for (const rc of c.records) {
            if (!rc.isElevated) continue;
            for (const g of hits) {
              for (const rg of g.records) if (!rg.isElevated) _weldElevatedGapCollar(core, mf, rc, rg, nearBridgeXY, nearBridgeZ, platePoly, scaleMm);
            }
          }
          absorbClusterInto(c, bestG);
          for (let hi = 1; hi < hits.length; hi++) {
            if (!hits[hi].mergedOut && hits[hi].isHi === bestG.isHi) absorbClusterInto(hits[hi], bestG);
          }
          mergedAny = true;
        }
      }
      if (!mergedAny) break;
    }

    for (const c of allClusters) {
      if (c.mergedOut || c.records.length === 0 || c.records.some(r => r.groupId != null && consumedArchGroups.has(String(r.groupId)))) continue;
      if (c.hasGrounded) {
        const connected = new Set(c.records.filter(r => !r.isElevated));
        const pending = c.records.filter(r => r.isElevated).sort((a, b) => a.zBase - b.zBase);
        let progressed = true;
        while (progressed && pending.length > 0) {
          progressed = false;
          for (let pi = 0; pi < pending.length; pi++) {
            const rc = pending[pi];
            let linked = false;
            for (const rg of connected) {
              if (recordsTouch3D(rc, rg, 0.05, 0.12, core) && _solidsOverlap3D(core, rc.solid, rg.solid)) { linked = true; break; }
            }
            if (!linked) {
              for (const rg of connected) {
                if (_weldElevatedGapCollar(core, mf, rc, rg, nearBridgeXY, nearBridgeZ, platePoly, scaleMm)) linked = true;
              }
            }
            if (!linked) {
              for (const rg of connected) {
                const vertGapTol = Math.max(nearBridgeZ, rc.zBase - rg.bb.min[2] + (0.25 / scaleMm));
                if (_weldElevatedGapCollar(core, mf, rc, rg, xyTouchPad, vertGapTol, platePoly, scaleMm)) { linked = true; break; }
              }
            }
            if (linked) {
              connected.add(rc);
              pending.splice(pi, 1);
              pi--;
              progressed = true;
            }
          }
        }
        for (const rc of pending) _groundPortalOnEndPiers(core, mf, rc, platePoly, ctx);
        continue;
      }
      for (const rc of c.records) _groundPortalOnEndPiers(core, mf, rc, platePoly, ctx);
      c.hasGrounded = true;
    }

    const emitClusterGroup = (isHiFlag) => {
      const out = [];
      for (const c of allClusters) {
        if (c.mergedOut || c.isHi !== isHiFlag || c.records.length === 0) continue;
        const bestNamed = c.records.find(r => r.name && !/^(Building|Part|Budynek|Część)\s+#/i.test(r.name));
        const primary = bestNamed || c.records.find(r => !r.isElevated) || c.records[0];
        const maxH = Math.max(...c.records.map(r => r.rawH_m || 0));
        const pickId = ctx.allocPickId({
          id: primary.bId, buildingId: primary.bId, groupId: primary.groupId, osmId: primary.osmId,
          name: primary.name, maxH, btype: primary.btype, roof: primary.roofShape, heightM: primary.rawH_m,
          highlighted: isHiFlag, primaryBuilding: primary.b, buildings: c.records.map(r => r.b),
        });
        for (const r of c.records) if (r.b) r.b._pickId = pickId;
        const merged = c.records.length === 1 ? c.records[0].solid : core.batchUnionManifolds(mf, c.records.map(r => r.solid));
        if (!merged || merged.numTri() === 0) { core.safeDeleteManifold(merged); continue; }
        const mbb = merged.boundingBox();
        out.push({ buildingId: pickId, sourceBuildingId: primary.bId, groupId: primary.groupId ?? null, manifold: merged, isFloatingPart: false });
        for (const r of c.records) {
          const rCx = (r.bb.min[0] + r.bb.max[0]) * 0.5, rCy = (r.bb.min[1] + r.bb.max[1]) * 0.5;
          boundsOut.push({
            id: r.bId, pickId, building: r.b, layerId: isHiFlag ? 5 : 4, osmId: r.osmId, name: r.name,
            minX: r.bb.min[0], minY: r.bb.min[1], minZ: mbb.min[2], maxX: r.bb.max[0], maxY: r.bb.max[1], maxZ: r.bb.max[2],
            cx: rCx, cy: rCy, interiorPt: [rCx, rCy], roof: r.roofShape, minH: r.rawMinH_m, h: r.rawH_m,
          });
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
