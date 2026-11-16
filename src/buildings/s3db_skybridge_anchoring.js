// ============================================================================
// src/buildings/s3db_skybridge_anchoring.js
// 3D Contact Graph, Skybridge Gap Collars & Standalone Portal End-Pier Anchoring
// ============================================================================

(function (root) {
  if (typeof root._ptInRing !== 'function' && typeof require === 'function') {
    Object.assign(root, require('./roof_directional_revolve.js'));
  }

  function _getCore() {
    if (typeof root.createBuildContext === 'function') {
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
    if (!root._ptInRing(px, py, outer)) return false;
    for (const h of (holes || [])) if (h && h.length >= 3 && root._ptInRing(px, py, h)) return false;
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
    for (const pt of ringA) if (root._ptInRing(pt[0], pt[1], ringB)) return 0;
    for (const pt of ringB) if (root._ptInRing(pt[0], pt[1], ringA)) return 0;
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
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
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
    try { hit = mA.intersect(mB); return Boolean(hit && hit.numTri() > 0); }
    catch (_) { return false; }
    finally { core.safeDeleteManifold(hit); }
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
    if (!_solidsOverlap3D(core, colSolid, rg.solid)) { core.safeDeleteManifold(colSolid); return false; }
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
    const sr = rc.structured[0], obb = root._computeOBB(sr.outer, null, 'along', 0);
    const dropMm = Math.max(1.0, (rc.zBase - rc.zGroundSeat) * scaleMm);
    const minPinMm = (slaLaws && typeof slaLaws.minPinDiameterMm === 'function') ? slaLaws.minPinDiameterMm(dropMm) : 0.85;
    const pierW = Math.max((minPinMm * 1.18) / scaleMm, Math.min(obb.spanU * 0.17, 2.2 / scaleMm));
    const zTop = rc.zBase + (0.14 / scaleMm), piers = [];

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

  function anchorAndMergeS3DBClusters(core, mf, ctx, allClusters, consumedArchGroups, platePoly) {
    const { mToU, scaleMm } = ctx;
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

    const CLUSTER_CELL = 4.0;
    for (let pass = 0; pass < 16; pass++) {
      let mergedAny = false;
      if (!allClusters.some(c => !c.mergedOut && !c.hasGrounded && c.records.length > 0)) break;
      const groundedGrid = new Map();
      for (const g of allClusters) {
        if (g.mergedOut || !g.hasGrounded) continue;
        for (let gx = Math.floor(g.minX / CLUSTER_CELL), gx1 = Math.floor(g.maxX / CLUSTER_CELL); gx <= gx1; gx++) {
          for (let gy = Math.floor(g.minY / CLUSTER_CELL), gy1 = Math.floor(g.maxY / CLUSTER_CELL); gy <= gy1; gy++) {
            const ck = `${gx}:${gy}`;
            let arr = groundedGrid.get(ck);
            if (!arr) { arr = []; groundedGrid.set(ck, arr); }
            arr.push(g);
          }
        }
      }
      for (const c of allClusters) {
        if (c.mergedOut || c.hasGrounded || c.records.length === 0) continue;
        const hits = [];
        for (const [xyTol, zTol] of [[xyTouchPad, zTouchTol], [nearBridgeXY, nearBridgeZ]]) {
          const seenG = new Set();
          for (let gx = Math.floor((c.minX - xyTol) / CLUSTER_CELL), gx1 = Math.floor((c.maxX + xyTol) / CLUSTER_CELL); gx <= gx1; gx++) {
            for (let gy = Math.floor((c.minY - xyTol) / CLUSTER_CELL), gy1 = Math.floor((c.maxY + xyTol) / CLUSTER_CELL); gy <= gy1; gy++) {
              const arr = groundedGrid.get(`${gx}:${gy}`);
              if (!arr) continue;
              for (let k = 0; k < arr.length; k++) {
                const g = arr[k];
                if (g === c || g.mergedOut || !g.hasGrounded || seenG.has(g)) continue;
                seenG.add(g);
                if (c.maxX < g.minX - xyTol || c.minX > g.maxX + xyTol || c.maxY < g.minY - xyTol || c.minY > g.maxY + xyTol) continue;
                if (c.records.some(rc => g.records.some(rg => recordsTouch3D(rc, rg, xyTol, zTol, core)))) hits.push(g);
              }
            }
          }
          if (hits.length > 0) break;
        }
        if (hits.length > 0) {
          hits.sort((a, b) => (a.isHi === c.isHi ? 0 : 1) - (b.isHi === c.isHi ? 0 : 1));
          const bestG = hits[0];
          for (const rc of c.records) {
            if (!rc.isElevated) continue;
            for (const g of hits) for (const rg of g.records) if (!rg.isElevated) _weldElevatedGapCollar(core, mf, rc, rg, nearBridgeXY, nearBridgeZ, platePoly, scaleMm);
          }
          absorbClusterInto(c, bestG);
          for (let hi = 1; hi < hits.length; hi++) if (!hits[hi].mergedOut && hits[hi].isHi === bestG.isHi) absorbClusterInto(hits[hi], bestG);
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
            for (const rg of connected) if (recordsTouch3D(rc, rg, 0.05, 0.12, core) && _solidsOverlap3D(core, rc.solid, rg.solid)) { linked = true; break; }
            if (!linked) for (const rg of connected) if (_weldElevatedGapCollar(core, mf, rc, rg, nearBridgeXY, nearBridgeZ, platePoly, scaleMm)) linked = true;
            if (!linked) {
              for (const rg of connected) {
                const vertGapTol = Math.max(nearBridgeZ, rc.zBase - rg.bb.min[2] + (0.25 / scaleMm));
                if (_weldElevatedGapCollar(core, mf, rc, rg, xyTouchPad, vertGapTol, platePoly, scaleMm)) { linked = true; break; }
              }
            }
            if (linked) { connected.add(rc); pending.splice(pi, 1); pi--; progressed = true; }
          }
        }
        for (const rc of pending) _groundPortalOnEndPiers(core, mf, rc, platePoly, ctx);
        continue;
      }
      for (const rc of c.records) _groundPortalOnEndPiers(core, mf, rc, platePoly, ctx);
      c.hasGrounded = true;
    }
    return allClusters;
  }

  const exportsObj = {
    _ptInSolid,
    _segMinDistSq2D,
    _ringsMinDist2D,
    _ringsTouchOrOverlap2D,
    recordsTouch3D,
    _solidsOverlap3D,
    _weldElevatedGapCollar,
    _groundPortalOnEndPiers,
    anchorAndMergeS3DBClusters,
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
