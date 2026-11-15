// ============================================================================
// src/mesh/tile_sla_vault_solver.js
// SLA Anti-Suction Hollow Vault (45 deg Ribs + Per-Chamber >=2 Drains)
// & Per-Tile Manifold CSG Union for Watertight Binary .STL Export
// ============================================================================

(function (root) {
  function _getDeps() {
    const embossMod = (typeof require !== 'undefined')
      ? require('./tile_id_emboss.js')
      : root;
    return {
      core: (typeof trianglesToShellManifolds === 'function' && typeof clipperDiffPolys === 'function') ? root : require('../geometry/manifold_core.js'),
      poly: (typeof pointInPoly2D === 'function' && typeof signedArea2D === 'function') ? root : require('../geometry/polygon_2d.js'),
      cfgMod: (typeof resolveSceneScaleAndSpec === 'function' && typeof resolveTriangleTileId === 'function') ? root : require('../geometry/print_physics_config.js'),
      embossMod,
    };
  }
  const _inPolyList = (poly, x, y, rings) => rings.some(r => poly.pointInPoly2D(x, y, r));
  const _inStructuredChamber = (poly, x, y, ch) => poly.pointInPoly2D(x, y, ch.outer) && !(ch.holes || []).some(h => poly.pointInPoly2D(x, y, h));

  function _buildDeepZones2D(core, ctx, tb, wallU, minColU) {
    const x0 = tb.minX + wallU, x1 = tb.maxX - wallU, y0 = tb.minY + wallU, y1 = tb.maxY - wallU;
    if (x1 <= x0 + 2 / ctx.scaleMm || y1 <= y0 + 2 / ctx.scaleMm) return [];
    const nx = 16, ny = 16, dx = (x1 - x0) / nx, dy = (y1 - y0) / ny;
    const rects = [];
    for (let r = 0; r < ny; r++) {
      const ry0 = y0 + r * dy, ry1 = ry0 + dy;
      let runStart = -1;
      for (let c = 0; c <= nx; c++) {
        let cellOk = false;
        if (c < nx) {
          const cx0 = x0 + c * dx, cx1 = cx0 + dx;
          cellOk = ctx.getTerrainZ((cx0 + cx1) * 0.5, (ry0 + ry1) * 0.5) >= minColU &&
                   ctx.getTerrainZ(cx0, ry0) >= minColU && ctx.getTerrainZ(cx1, ry0) >= minColU &&
                   ctx.getTerrainZ(cx1, ry1) >= minColU && ctx.getTerrainZ(cx0, ry1) >= minColU;
        }
        if (cellOk && runStart < 0) runStart = c;
        else if (!cellOk && runStart >= 0) {
          rects.push([[x0 + runStart * dx, ry0], [x0 + c * dx, ry0], [x0 + c * dx, ry1], [x0 + runStart * dx, ry1]]);
          runStart = -1;
        }
      }
    }
    return rects.length ? core.clipperUnionPolys(rects, 1e-5) : [];
  }

  function _subtractDiagonal45Ribs(core, poly, vault2D, tb, scaleMm, ribPitchU, ribThickU) {
    const gapU = Math.max(3.6 / scaleMm, ribPitchU * 0.34);
    const halfLen = (ribPitchU - gapU) * 0.5;
    if (halfLen <= ribThickU * 0.6 || vault2D.length === 0) return vault2D;
    const ribZone = core.clipperOffsetPolys(vault2D, -(ribThickU * 0.55 + 2.2 / scaleMm), 'Miter', 1e-5);
    if (ribZone.length === 0) return vault2D;

    const S = Math.SQRT1_2;
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const [x, y] of [[tb.minX, tb.minY], [tb.maxX, tb.minY], [tb.maxX, tb.maxY], [tb.minX, tb.maxY]]) {
      const u = S * (x + y), v = S * (y - x);
      uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
      vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
    }
    const uvToXY = (u, v) => [S * (u - v), S * (u + v)];
    const bars = [], ht = ribThickU * 0.5;
    for (let iu = Math.floor(uMin / ribPitchU); iu <= Math.ceil(uMax / ribPitchU); iu++) {
      for (let iv = Math.floor(vMin / ribPitchU); iv <= Math.ceil(vMax / ribPitchU); iv++) {
        const u0 = iu * ribPitchU, v0 = iv * ribPitchU;
        const [cx, cy] = uvToXY(u0, v0);
        if (!_inPolyList(poly, cx, cy, ribZone)) continue;
        bars.push([uvToXY(u0 - halfLen, v0 - ht), uvToXY(u0 + halfLen, v0 - ht), uvToXY(u0 + halfLen, v0 + ht), uvToXY(u0 - halfLen, v0 + ht)]);
        bars.push([uvToXY(u0 - ht, v0 - halfLen), uvToXY(u0 + ht, v0 - halfLen), uvToXY(u0 + ht, v0 + halfLen), uvToXY(u0 - ht, v0 + halfLen)]);
      }
    }
    return bars.length ? core.clipperDiffPolys(vault2D, core.clipperUnionPolys(bars, 1e-5), 1e-5) : vault2D;
  }

  function _findChamberDrains(ctx, terrainWater, poly, ch, tb, wallU, scaleMm, waterMarginRings2D, idPadRect) {
    const drainW = 3.6 / scaleMm, drainH = 1.55 / scaleMm;
    const minSurfZ = drainH + wallU * 0.45;
    const spanX = tb.maxX - tb.minX, spanY = tb.maxY - tb.minY;
    const marginCorner = wallU + drainW;
    const maxProbe = Math.min(Math.min(spanX, spanY) * 0.36, 26.0 / scaleMm);
    const stepEdge = Math.max(3.8 / scaleMm, Math.min(spanX, spanY) / 22);
    const sides = [
      { id: 'S', nx: 0, ny: 1, len: spanX, pt: (s) => [tb.minX + s, tb.minY] },
      { id: 'N', nx: 0, ny: -1, len: spanX, pt: (s) => [tb.minX + s, tb.maxY] },
      { id: 'W', nx: 1, ny: 0, len: spanY, pt: (s) => [tb.minX, tb.minY + s] },
      { id: 'E', nx: -1, ny: 0, len: spanY, pt: (s) => [tb.maxX, tb.minY + s] },
    ];
    const safePt = (x, y) => !terrainWater.isPointInWater(x, y) && ctx.getTerrainZ(x, y) >= minSurfZ &&
      (!idPadRect || !poly.pointInPoly2D(x, y, idPadRect)) && !_inPolyList(poly, x, y, waterMarginRings2D);

    const cands = [];
    for (const sd of sides) {
      if (sd.len <= marginCorner * 2.2) continue;
      for (let s = marginCorner; s <= sd.len - marginCorner; s += stepEdge) {
        const [ex, ey] = sd.pt(s);
        const px = -sd.ny * drainW * 0.48, py = sd.nx * drainW * 0.48;
        let pathOk = true, hitDist = -1;
        for (let d = 0.2 * wallU; d <= maxProbe; d += Math.max(0.6 / scaleMm, wallU * 0.4)) {
          const cx = ex + sd.nx * d, cy = ey + sd.ny * d;
          if (!safePt(cx, cy) || !safePt(cx + px, cy + py) || !safePt(cx - px, cy - py)) { pathOk = false; break; }
          if (_inStructuredChamber(poly, cx, cy, ch)) { hitDist = d + 1.2 / scaleMm; break; }
        }
        if (pathOk && hitDist > 0) {
          const tx = ex + sd.nx * hitDist, ty = ey + sd.ny * hitDist;
          const xMin = Math.min(ex - sd.nx * 0.15, tx) - Math.abs(sd.ny) * drainW * 0.5;
          const xMax = Math.max(ex - sd.nx * 0.15, tx) + Math.abs(sd.ny) * drainW * 0.5;
          const yMin = Math.min(ey - sd.ny * 0.15, ty) - Math.abs(sd.nx) * drainW * 0.5;
          const yMax = Math.max(ey - sd.ny * 0.15, ty) + Math.abs(sd.nx) * drainW * 0.5;
          cands.push({ side: sd.id, ex, ey, bounds: [xMin, xMax, yMin, yMax, -0.2, drainH] });
        }
      }
    }
    const chosen = [], minSep = 10.0 / scaleMm;
    const tryPick = (cand) => chosen.every(k => Math.hypot(k.ex - cand.ex, k.ey - cand.ey) >= minSep) && chosen.push(cand);
    for (const sid of ['S', 'N', 'W', 'E']) { const m = cands.find(c => c.side === sid); if (m) tryPick(m); }
    for (const c of cands) { if (chosen.length >= 4) break; tryPick(c); }
    return chosen;
  }

  function carveTileHollowVaultAndId(ctx, terrainWater, baseTile, tb, waterMarginRings2D) {
    const { core, poly, embossMod } = _getDeps();
    const { mf, scaleMm, hollowBase } = ctx;
    const tShellMm = Math.max(2.0, ctx.hollowWallMm || 2.0), wallU = tShellMm / scaleMm;
    const minColU = (tShellMm + 2.0) / scaleMm, ribPitchMm = 10.5;
    const markDepthU = Math.max(0.68 / scaleMm, Math.min(wallU * 0.42, 0.82 / scaleMm));
    const pad = embossMod.findSafeIdPad(ctx, terrainWater, tb, scaleMm, markDepthU, 0.78 / scaleMm);
    const cutSolids = pad ? embossMod.buildIdEngravingSolids(mf, `${tb.label || 'R1C1'}^`, pad, scaleMm, markDepthU) : [];
    let drainCount = 0, hollowChambersKept = 0, hollowChambersFilledSolid = 0;
    const minWallMm = (ctx.slaLaws && ctx.slaLaws.minWallThicknessMm) ? ctx.slaLaws.minWallThicknessMm(tb.maxZMm || 20) : 1.0;
    const ribThickU = Math.max(1.25 / scaleMm, minWallMm / scaleMm);
    if (hollowBase) {
      let vault2D = _buildDeepZones2D(core, ctx, tb, wallU, minColU);
      if (pad && vault2D.length) vault2D = core.clipperDiffPolys(vault2D, [pad.rect], 1e-5);
      if (waterMarginRings2D.length && vault2D.length) vault2D = core.clipperDiffPolys(vault2D, waterMarginRings2D, 1e-5);
      if (vault2D.length) vault2D = _subtractDiagonal45Ribs(core, poly, vault2D, tb, scaleMm, ribPitchMm / scaleMm, ribThickU);
      const chambers = core.ringsToOutersWithHoles(vault2D, 1e-5), minAreaU2 = 90.0 / (scaleMm * scaleMm);
      const keptSolids = [], drainBoxes = [];
      for (const ch of chambers) {
        if (Math.abs(poly.signedArea2D(ch.outer)) < minAreaU2) continue;
        const drains = _findChamberDrains(ctx, terrainWater, poly, ch, tb, wallU, scaleMm, waterMarginRings2D, pad ? pad.rect : null);
        if (drains.length < 2) { hollowChambersFilledSolid++; continue; }
        const cm = core.extrudeRingSolid(mf, ch.outer, ch.holes, -0.5, terrainWater.terrainManifold.boundingBox().max[2] + 5.0);
        if (!cm) continue;
        hollowChambersKept++; drainCount += drains.length; keptSolids.push(cm);
        for (const d of drains) { const db = core.boxManifoldFromBounds(mf, ...d.bounds); if (db) drainBoxes.push(db); }
      }
      if (keptSolids.length > 0) {
        const mask = core.batchUnionManifolds(mf, keptSolids), ceilRef = terrainWater.terrainManifold.translate([0, 0, -wallU]);
        const vaultCut = ceilRef.intersect(mask);
        core.safeDeleteManifold(ceilRef); core.safeDeleteManifold(mask);
        if (vaultCut && vaultCut.numTri() > 0) cutSolids.push(vaultCut); else core.safeDeleteManifold(vaultCut);
        for (const db of drainBoxes) cutSolids.push(db);
      } else for (const db of drainBoxes) core.safeDeleteManifold(db);
    }
    let outTile = baseTile;
    if (cutSolids.length > 0) {
      const fullCut = core.batchUnionManifolds(mf, cutSolids), carved = fullCut ? outTile.subtract(fullCut) : null;
      core.safeDeleteManifold(fullCut);
      if (carved && carved.numTri() > 0) {
        if (outTile !== terrainWater.terrainManifold) core.safeDeleteManifold(outTile);
        outTile = carved;
        if (typeof carved.simplify === 'function') {
          try { const simp = carved.simplify(6e-4); if (simp && simp.numTri() > 0) { core.safeDeleteManifold(carved); outTile = simp; } else core.safeDeleteManifold(simp); } catch (_) {}
        }
      } else core.safeDeleteManifold(carved);
    }
    return {
      baseTile: outTile, drainCount, hollowChambersKept, hollowChambersFilledSolid,
      ribPitchMm, ribThickMm: ribThickU * scaleMm,
      emboss: pad ? { strokeWidthMm: pad.strokeW * scaleMm, carveDepthMm: markDepthU * scaleMm, minRoofClearanceMm: pad.minRoofClearanceMm } : null,
    };
  }

  function buildUnifiedTileTrianglesForStlCSG(state, layerFilter = 'all', tileIdFilter = -1) {
    const { core, cfgMod } = _getDeps();
    let filtered = [], scaleMm = 1;
    if (Array.isArray(state)) {
      filtered = state;
    } else {
      const spec = cfgMod.resolveSceneScaleAndSpec(state, null);
      const { halfW, halfH } = spec;
      scaleMm = spec.scaleMm || 1;
      const tileCols = Math.max(1, (state && state.tileCols) || 1), tileRows = Math.max(1, (state && state.tileRows) || 1);
      const isCutout = Boolean(state && state.waterCutout);
      const keys = layerFilter === 'all'
        ? (isCutout ? ['base', 'greenery', 'roads', 'buildings', 'highlighted'] : ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted'])
        : ((isCutout && layerFilter === 'water') ? [] : [layerFilter]);
      const meshesObj = (state && (state.layerMeshes || state.meshes)) || {};
      for (const k of keys) {
        if (layerFilter === 'all' && state && state.layerVisible && state.layerVisible[k] === false) continue;
        for (const t of (meshesObj[k] || [])) {
          if (tileIdFilter >= 0 && cfgMod.resolveTriangleTileId(t, halfW, halfH, tileCols, tileRows) !== tileIdFilter) continue;
          filtered.push(t);
        }
      }
    }
    const mf = typeof core.getManifoldLib === 'function' ? core.getManifoldLib() : null;
    if (!mf || filtered.length === 0 || (layerFilter !== 'all' && !Array.isArray(state))) return filtered;
    const baseTris = filtered.filter(t => t.layerId === 1);
    const overTris = filtered.filter(t => t.layerId !== 1);
    const solids = core.trianglesToShellManifolds(mf, baseTris);
    for (const m of core.trianglesToShellManifolds(mf, overTris)) {
      const bb = m.boundingBox();
      if (bb.min[2] > 0.02) {
        const s = m.translate([0, 0, -Math.min(0.002, bb.min[2] * 0.1)]);
        core.safeDeleteManifold(m);
        solids.push(s);
      } else solids.push(m);
    }
    if (solids.length === 0) return filtered;
    const unified = solids.length === 1 ? solids[0] : core.batchUnionManifolds(mf, solids);
    if (!unified || unified.numTri() === 0) { core.safeDeleteManifold(unified); return []; }
    const out = core.extractDePinchedStlTriangles(mf, unified, Math.max(0, tileIdFilter), scaleMm);
    core.safeDeleteManifold(unified);
    return out;
  }

  const exportsObj = {
    carveTileHollowVaultAndId, buildUnifiedTileTrianglesForStlCSG,
    unionTileTrianglesForStlCSG: buildUnifiedTileTrianglesForStlCSG,
  };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) {
    const emb = require('./tile_id_emboss.js');
    module.exports = { ...exportsObj, buildTileIdLabelPolys: emb.buildTileIdLabelPolys, _buildTileIdLabelPolys: emb.buildTileIdLabelPolys };
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
