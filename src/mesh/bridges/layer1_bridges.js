// ============================================================================
// src/mesh/bridges/layer1_bridges.js
// Layer-1 Bridge & Viaduct Orchestrator (Graph, Sloped Deck & Superstructure)
// ============================================================================

(function (root) {
  function _ensureBridgeDeps() {
    if ((typeof solveBridgeGraph === 'undefined' || typeof buildBridgeSuperstructure === 'undefined' || typeof computePierDeckHeights === 'undefined') && typeof require !== 'undefined') {
      Object.assign(root, require('../../Water/water_piers_solver.js'));
      Object.assign(root, require('./bridge_geom_2d.js'));
      Object.assign(root, require('./bridge_spine_stitch.js'));
      Object.assign(root, require('./bridge_tin_sampler.js'));
      Object.assign(root, require('./bridge_specs_extract.js'));
      Object.assign(root, require('./bridge_elevation_profile.js'));
      Object.assign(root, require('./bridge_multideck_solver.js'));
      Object.assign(root, require('./bridge_deck_builder.js'));
      Object.assign(root, require('./bridge_supports_solver.js'));
      Object.assign(root, require('./bridge_superstructure_arch_cable.js'));
    }
  }

  function _normalizeBridgeStructure(rawStruct, tags = {}) {
    _ensureBridgeDeps();
    return _normalizeBridgeStructJS(rawStruct, tags && tags.covered, tags);
  }

  function _computeMidspanClearanceU(sp, terrainWater, ctx) {
    let minC = Infinity, count = 0;
    const n = sp.pts.length;
    const start = sp.crossesWater ? 0 : (n >= 6 ? Math.max(1, Math.floor(n * 0.22)) : (n >= 3 ? 1 : 0));
    const end = sp.crossesWater ? n : (n >= 6 ? Math.min(n - 1, Math.ceil(n * 0.78)) : (n >= 3 ? n - 1 : n));
    for (let i = start; i < end; i++) {
      if (sp.crossesWater && !sp.inWater[i]) continue;
      const floor = sp.inWater[i] ? ctx.zWaterTop : terrainWater.getSurfaceZ(sp.pts[i][0], sp.pts[i][1]);
      minC = Math.min(minC, sp.zBotArr[i] - floor); count++;
    }
    return count > 0 ? Math.round(Math.max(0, minC) * 100) / 100 : 0;
  }

  function _clipToBedIfNeeded(mf, solid, bb, ctx) {
    if (!solid) return null;
    if (bb[0] >= -ctx.halfW && bb[2] <= ctx.halfW && bb[1] >= -ctx.halfH && bb[3] <= ctx.halfH) return solid;
    const bed = boxManifoldFromBounds(mf, -ctx.halfW, ctx.halfW, -ctx.halfH, ctx.halfH, -1.0, ctx.maxZUnits + 1.0);
    if (!bed) return solid;
    try {
      const clipped = solid.intersect(bed);
      solid.delete(); bed.delete();
      return clipped && clipped.numTri() > 0 ? clipped : (clipped ? (clipped.delete(), null) : null);
    } catch (_) {
      bed.delete();
      return solid;
    }
  }

  function buildLayer1Bridges(ctx, scene, terrainWater) {
    _ensureBridgeDeps();
    const mf = ctx.mf;
    const specs = solveBridgeGraph(scene || {}, terrainWater, ctx);
    const bridgeManifolds = [], bridgeAudits = [];

    for (const sp of specs) {
      if (sp.bbox[2] < -ctx.halfW || sp.bbox[0] > ctx.halfW || sp.bbox[3] < -ctx.halfH || sp.bbox[1] > ctx.halfH) continue;
      const deck = buildSlopedBridgeDeck(sp, mf);
      if (!deck || deck.numTri() === 0) { if (deck) deck.delete(); continue; }

      const abutments = buildBankAbutments(sp, terrainWater, ctx);
      const superRes = buildBridgeSuperstructure(sp, terrainWater, ctx);
      const corbels = buildSupportlessUndersideCorbels(sp, superRes.supportStationsS, terrainWater, ctx);
      const parts = [deck, ...abutments, ...superRes.parts, ...corbels].filter(p => p && p.numTri && p.numTri() > 0);
      if (!parts.length) continue;

      let combined = parts.length === 1 ? parts[0] : batchUnionManifolds(mf, parts);
      combined = _clipToBedIfNeeded(mf, combined, sp.bbox, ctx);
      if (!combined || combined.numTri() === 0) { if (combined) combined.delete(); continue; }

      const mbb = combined.boundingBox();
      const audit = {
        name: sp.name || 'Most',
        structure: sp.structNorm,
        deckLayer: sp.deckLayer,
        isRail: Boolean(sp.isRail),
        zDeckBot: Math.round(Math.min(...sp.zBotArr) * 100) / 100,
        zDeckTop: Math.round(Math.max(...sp.zTopArr) * 100) / 100,
        zStartDeck: Math.round(sp.zTopArr[0] * 100) / 100,
        zEndDeck: Math.round(sp.zTopArr[sp.zTopArr.length - 1] * 100) / 100,
        zAbutmentA: Math.round(sp.zAbutmentA * 100) / 100,
        zAbutmentB: Math.round(sp.zAbutmentB * 100) / 100,
        zPylonTop: Math.round(superRes.metrics.zPylonTop * 100) / 100,
        isThroughArch: Boolean(superRes.metrics.isThroughArch),
        syntheticWaterPiers: superRes.metrics.syntheticWaterPiers,
        explicitSupportsUsed: superRes.metrics.explicitSupportsUsed,
        minStrutMm: Math.round(superRes.metrics.minStrutMm * 1000) / 1000,
        minStayGapMm: Math.round(superRes.metrics.minStayGapMm * 1000) / 1000,
        supportlessMode: Boolean(ctx.supportlessMode),
        bbox: [mbb.min[0], mbb.min[1], mbb.max[0], mbb.max[1]],
        width: sp.width,
        axisPts: sp.pts,
        zBotArr: sp.zBotArr,
        zTopArr: sp.zTopArr,
        midspanClearanceU: _computeMidspanClearanceU(sp, terrainWater, ctx),
        crossesWater: sp.crossesWater,
        pierMinZ: Math.round(superRes.metrics.pierMinZ * 100) / 100
      };
      bridgeManifolds.push(combined);
      bridgeAudits.push(audit);
    }

    ctx.audit.bridgeAudits = bridgeAudits;
    return { bridgeManifolds, bridgeAudits, count: bridgeManifolds.length };
  }

  const exportsObj = { buildLayer1Bridges, _normalizeBridgeStructure };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
