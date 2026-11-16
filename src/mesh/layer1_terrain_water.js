// ============================================================================
// src/mesh/layer1_terrain_water.js
// Layer 1 Orchestrator: Adaptive Terrain, Mountain River Carve, Water & Draping
// ============================================================================

(function (root) {
  function _getDeps() {
    const core = (typeof getManifoldLib === 'function' && typeof clipperUnionPolys === 'function')
      ? {
          getManifoldLib, getVendorDeps, signedArea2D, ensureWinding, clipperUnionPolys, clipperIntersectPolys,
          clipperDiffPolys, clipperOffsetPolys, clipperBufferOpenPaths, ringsToOutersWithHoles,
          safeDeleteManifold, batchUnionManifolds, extrudeRingSolid, manifoldFromRawSoup, boxManifoldFromBounds
        }
      : require('../geometry/manifold_core.js');
    const waterMod = (typeof buildDelatinTerrainManifold === 'function' && typeof buildLayer1WaterAndCarve === 'function')
      ? { buildDelatinTerrainManifold, buildLayer1WaterAndCarve }
      : require('./terrain_delatin_water.js');
    const drapeMod = (typeof collectSurfacePolys === 'function' && typeof buildSurfaceDrapesAndFrame === 'function')
      ? { collectSurfacePolys, buildSurfaceDrapesAndFrame }
      : require('./terrain_surface_drape.js');
    return { core, waterMod, drapeMod };
  }

  function _ptInRing(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }

  function _ringBBox(ring) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    return [minX, minY, maxX, maxY];
  }

  function _indexRing2D(poly) {
    if (!poly || poly.length < 3) return null;
    const [minX, minY, maxX, maxY] = _ringBBox(poly);
    const n = poly.length, spanY = maxY - minY;
    if (n < 32 || spanY <= 1e-9) return { poly, minX, minY, maxX, maxY, slabs: null, invH: 0, nSlabs: 0 };
    const nSlabs = Math.min(256, Math.max(32, n >> 3)), invH = nSlabs / spanY;
    const slabs = Array.from({ length: nSlabs }, () => []);
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = poly[i][1], yj = poly[j][1];
      if (yi === yj) continue;
      const yLo = yi < yj ? yi : yj, yHi = yi < yj ? yj : yi;
      const s0 = Math.max(0, Math.floor((yLo - minY) * invH - 1e-6));
      const s1 = Math.min(nSlabs - 1, Math.floor((yHi - minY) * invH + 1e-6));
      for (let s = s0; s <= s1; s++) slabs[s].push(i);
    }
    return { poly, minX, minY, maxX, maxY, slabs, invH, nSlabs };
  }

  function _ptInIndexedRing(px, py, ir) {
    if (!ir || px < ir.minX - 1e-9 || px > ir.maxX + 1e-9 || py < ir.minY - 1e-9 || py > ir.maxY + 1e-9) return false;
    if (!ir.slabs) return _ptInRing(px, py, ir.poly);
    const s = Math.min(ir.nSlabs - 1, Math.max(0, Math.floor((py - ir.minY) * ir.invH)));
    const idxs = ir.slabs[s], poly = ir.poly, n = poly.length;
    let inside = false;
    for (let k = 0; k < idxs.length; k++) {
      const i = idxs[k], j = i === 0 ? n - 1 : i - 1;
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }

  function _indexStructuredPolys(polys) {
    const out = [];
    for (const wp of (polys || [])) {
      const outer = wp && _indexRing2D(wp.outer);
      if (!outer) continue;
      const holes = (wp.holes || []).map(_indexRing2D).filter(Boolean);
      out.push({ outer, holes });
    }
    return out;
  }

  function _pointInIndexedPolys(x, y, idxPolys) {
    for (let i = 0; i < idxPolys.length; i++) {
      const wp = idxPolys[i];
      if (!_ptInIndexedRing(x, y, wp.outer)) continue;
      let inHole = false;
      for (let h = 0; h < wp.holes.length; h++) {
        if (_ptInIndexedRing(x, y, wp.holes[h])) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
    return false;
  }

  function _buildIsletKeeper(core, ctx, scene) {
    const { toBed, scaleMm, waterCutout } = ctx;
    const seeds = [];
    for (const b of (scene && scene.buildings) || []) {
      if (!b || b.hidden || b.isOutline || !b.outer || b.outer.length < 3) continue;
      let sx = 0, sy = 0;
      for (const p of b.outer) { const bp = toBed(p); sx += bp[0]; sy += bp[1]; }
      seeds.push([sx / b.outer.length, sy / b.outer.length]);
    }
    for (const rd of (scene && scene.roads) || []) {
      if (!rd || !rd.pts || rd.pts.length < 2 || !(rd.bridge || rd.isBridge || rd.man_made)) continue;
      for (const p of rd.pts) seeds.push(toBed(p));
    }
    const minIsletU2 = ((ctx.cfg && ctx.cfg.minCutoutIsletMm2) || 6.0) / (scaleMm * scaleMm);
    return (h) => {
      if (!waterCutout) return true;
      const a = (h && h.length >= 3) ? Math.abs(core.signedArea2D(h)) : 0;
      if (a >= minIsletU2) return true;
      const bb = _ringBBox(h);
      return seeds.some(pt => pt[0] >= bb[0] && pt[0] <= bb[2] && pt[1] >= bb[1] && pt[1] <= bb[3] && _ptInRing(pt[0], pt[1], h));
    };
  }

  function buildLayer1TerrainAndWater(ctx, scene, _options = {}) {
    const { core, waterMod, drapeMod } = _getDeps();
    const { mf, halfW, halfH, waterCutout } = ctx;

    const padU = 0.25;
    const minX = -halfW - padU, maxX = halfW + padU;
    const minY = -halfH - padU, maxY = halfH + padU;
    const plateClipPoly = [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]];

    const rawTerrain = waterMod.buildDelatinTerrainManifold(ctx, minX, maxX, minY, maxY);
    const surfaceData = drapeMod.collectSurfacePolys(core, ctx, scene, plateClipPoly);
    const keepIslet = _buildIsletKeeper(core, ctx, scene);

    const waterRes = waterMod.buildLayer1WaterAndCarve(
      core, mf, ctx, scene, rawTerrain, plateClipPoly, surfaceData.protectedWaterfrontPolys, keepIslet
    );
    const { terrainManifold, waterManifold, unionedWaterRings, waterMaskPolys2D, queryWaterZAt, slopedRiverSegments } = waterRes;

    const drapeRes = drapeMod.buildSurfaceDrapesAndFrame(
      core, mf, ctx, terrainManifold, plateClipPoly, unionedWaterRings, surfaceData
    );
    const {
      greeneryManifold, roadManifold, frameManifold,
      roadPolys2D, streetPolys2D, footpathPolys2D, greenPolys2D,
      hGreenU, hRoadU, hFootpathU: rawHFootpathU
    } = drapeRes;
    const hFootpathU = rawHFootpathU !== undefined
      ? rawHFootpathU
      : Math.max(0.15 / ctx.scaleMm, ((ctx.cfg && ctx.cfg.footpathHeightMm) || 0.303) / ctx.scaleMm);
    const waterIdx = _indexStructuredPolys(waterMaskPolys2D);
    const roadIdx = _indexStructuredPolys(roadPolys2D);
    const streetIdx = _indexStructuredPolys(streetPolys2D || roadPolys2D);
    const footpathIdx = _indexStructuredPolys(footpathPolys2D || []);
    const greenIdx = _indexStructuredPolys(greenPolys2D);

    const isPointInWater = (x, y) => {
      if (waterIdx.length === 0) return false;
      if (_pointInIndexedPolys(x, y, waterIdx)) return true;
      let hits = 0;
      for (const [dx, dy] of [[0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22]]) {
        if (_pointInIndexedPolys(x + dx, y + dy, waterIdx)) hits++;
      }
      return hits >= 3;
    };
    const isPointOnRoad = (x, y) => _pointInIndexedPolys(x, y, roadIdx);
    const isPointOnStreet = (x, y) => _pointInIndexedPolys(x, y, streetIdx);
    const isPointOnFootpath = (x, y) => footpathIdx.length > 0 && _pointInIndexedPolys(x, y, footpathIdx);
    const isPointInGreen = (x, y) => _pointInIndexedPolys(x, y, greenIdx);

    const getSurfaceZ = (x, y) => {
      if (isPointInWater(x, y)) return queryWaterZAt(x, y, false);
      let z = ctx.getTerrainZ(x, y);
      if (isPointOnStreet(x, y)) z += hRoadU;
      else if (isPointInGreen(x, y)) z += hGreenU + (isPointOnFootpath(x, y) ? hFootpathU : 0);
      else if (isPointOnFootpath(x, y)) z += hFootpathU;
      return z;
    };

    const getWaterFloorZ = (x, y) => (Number.isFinite(x) && Number.isFinite(y) ? queryWaterZAt(x, y, true) : (waterCutout ? 0.0 : ctx.zWaterCarveFloor));
    const getWaterTopZ = (x, y) => (Number.isFinite(x) && Number.isFinite(y) ? queryWaterZAt(x, y, false) : (waterCutout ? 0.0 : ctx.zWaterTop));

    ctx.audit.baseInfo = {
      isTopographicRelief: ctx.elevReliefM > 0.35,
      waterPolyCount: waterMaskPolys2D.length,
      slopedRiverSegments,
      protectedWaterfrontCount: surfaceData.protectedWaterfrontPolys.length,
      roadPolyCount: roadPolys2D.length,
      greenPolyCount: greenPolys2D.length,
      realMin: ctx.elevInfo ? ctx.elevInfo.realMin : ctx.effMinElev,
      realMax: ctx.elevInfo ? ctx.elevInfo.realMax : ctx.rawMaxElev,
      realElevDelta: Math.round(ctx.elevReliefM * 100) / 100,
      p80Span: ctx.elevInfo ? ctx.elevInfo.p80Span : ctx.elevReliefM,
      numContourSteps: ctx.elevReliefM > 0.35 ? Math.max(2, Math.round(ctx.elevReliefM / 5)) : 1,
      baseBottomZ: 0.0,
      zSubWater: ctx.zWaterCarveFloor,
    };

    return {
      terrainManifold, waterManifold, greeneryManifold, roadManifold, frameManifold,
      waterMaskPolys2D, roadPolys2D, greenPolys2D, hGreenU, hRoadU,
      isPointInWater, isPointOnRoad, isPointInGreen, getSurfaceZ, getWaterFloorZ, getWaterTopZ,
    };
  }

  const exportsObj = { buildLayer1TerrainAndWater };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
