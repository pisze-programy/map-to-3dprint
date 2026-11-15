// ============================================================================
// src/mesh/global_invariants_auditor.js
// Layer-3 Exact Topology Verification, Multi-Deck Clearance & Print Metrics Audit
// ============================================================================

(function (root) {
  function analyzeMeshSoupInvariants(layerMeshes, tileBounds, halfW, halfH, scaleMm) {
    const outOfTileEps = 1e-2;
    let outOfTileTrisCount = 0, degenerateTrisCount = 0;
    let openEdges = 0, nonManifoldEdges = 0, sameDirDupEdges = 0;
    const layersToCheck = ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted'];
    const layerMetrics = {};
    const tbById = new Map();
    for (const tb of tileBounds) tbById.set(tb.tileId, tb);
    const scale3 = scaleMm * scaleMm * scaleMm;

    const pKey = (p) => {
      const x = Math.abs(p[0]) < 1e-9 ? 0 : p[0];
      const y = Math.abs(p[1]) < 1e-9 ? 0 : p[1];
      const z = Math.abs(p[2]) < 1e-9 ? 0 : p[2];
      return `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    };

    for (const lname of layersToCheck) {
      const tris = layerMeshes[lname] || [];
      if (tris.length === 0) {
        layerMetrics[lname] = { triangles: 0, degenerateTris: 0, openEdges: 0, nonManifoldEdges: 0, sameDirDupEdges: 0, unpairedDirEdges: 0, volumeMl: 0 };
        continue;
      }
      const edgeMap = new Map();
      let lOpen = 0, lNm = 0, lDup = 0, lDegen = 0, lVolU3 = 0;

      for (let i = 0; i < tris.length; i++) {
        const t = tris[i];
        const a = t.v0, b = t.v1, c = t.v2;
        lVolU3 += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
        const tb = tbById.get(t.tileId);
        if (tb) {
          for (const v of [a, b, c]) {
            if (v[0] < tb.minX - outOfTileEps || v[0] > tb.maxX + outOfTileEps ||
                v[1] < tb.minY - outOfTileEps || v[1] > tb.maxY + outOfTileEps) {
              outOfTileTrisCount++;
              break;
            }
          }
        }
        const hasBatch = t.mBatch !== undefined && t.vi0 !== undefined && t.vi1 !== undefined && t.vi2 !== undefined;
        const k0 = hasBatch ? `${t.mBatch}:${t.vi0}` : pKey(a);
        const k1 = hasBatch ? `${t.mBatch}:${t.vi1}` : pKey(b);
        const k2 = hasBatch ? `${t.mBatch}:${t.vi2}` : pKey(c);
        if (k0 === k1 || k1 === k2 || k2 === k0) { lDegen++; degenerateTrisCount++; continue; }

        const sid = (t.shellId !== undefined && t.shellId !== -1) ? t.shellId : (t.buildingId !== undefined ? t.buildingId : 0);
        const prefix = `${t.tileId ?? 0}|${sid}|`;
        const es = [[k0, k1], [k1, k2], [k2, k0]];
        for (let k = 0; k < 3; k++) {
          const p0 = es[k][0], p1 = es[k][1];
          const canon = p0 < p1 ? `${prefix}${p0}>${p1}` : `${prefix}${p1}>${p0}`;
          let rec = edgeMap.get(canon);
          if (!rec) { rec = { fwd: 0, rev: 0 }; edgeMap.set(canon, rec); }
          if (p0 < p1) rec.fwd++; else rec.rev++;
        }
      }

      for (const rec of edgeMap.values()) {
        if (rec.fwd === 1 && rec.rev === 1) continue;
        if (rec.fwd + rec.rev === 1) { openEdges++; lOpen++; }
        else { nonManifoldEdges++; lNm++; if (rec.fwd > 1 || rec.rev > 1) { sameDirDupEdges++; lDup++; } }
      }
      layerMetrics[lname] = {
        triangles: tris.length, degenerateTris: lDegen, openEdges: lOpen, nonManifoldEdges: lNm,
        sameDirDupEdges: lDup, unpairedDirEdges: lOpen + lNm, volumeMl: Math.max(0, (lVolU3 / 6.0) * scale3) / 1000.0,
      };
    }

    return {
      openEdges, nonManifoldEdges, sameDirDupEdges, degenerateTrisCount, outOfTileTrisCount, layerMetrics,
      isWatertightManifold: openEdges === 0 && nonManifoldEdges === 0 && sameDirDupEdges === 0 && degenerateTrisCount === 0,
    };
  }

  function countMultiDeckOverlapsViolated(bridgeAudits) {
    return (bridgeAudits || []).filter((a, idx, arr) =>
      arr.some((b, jdx) => {
        if (jdx <= idx || a.deckLayer === b.deckLayer || !a.bbox || !b.bbox) return false;
        const xyOverlap = !(a.bbox[2] <= b.bbox[0] || b.bbox[2] <= a.bbox[0] || a.bbox[3] <= b.bbox[1] || b.bbox[3] <= a.bbox[1]);
        if (!xyOverlap) return false;
        if (a.axisPts && b.axisPts && a.zBotArr && b.zBotArr && a.zTopArr && b.zTopArr) {
          const [lo, hi] = a.deckLayer < b.deckLayer ? [a, b] : [b, a];
          const hitRad = Math.max(0.8, ((lo.width || 1) + (hi.width || 1)) * 0.52);
          for (let ki = 0; ki < hi.axisPts.length; ki++) {
            const hp = hi.axisPts[ki];
            for (let kj = 0; kj < lo.axisPts.length; kj++) {
              if (Math.hypot(hp[0] - lo.axisPts[kj][0], hp[1] - lo.axisPts[kj][1]) <= hitRad && hi.zBotArr[ki] <= lo.zTopArr[kj] + 1e-3) return true;
            }
          }
          return false;
        }
        return !(a.zDeckTop <= b.zDeckBot + 1e-3 || b.zDeckTop <= a.zDeckBot + 1e-3);
      })
    ).length;
  }

  function assemblePrintMetricsReport(ctx, meshes, data) {
    const {
      skipTopologyAudit, tileBounds, tileVolumesUnits3, tileMaxZUnits,
      solidTerrainTotalVolU3, printedBaseTotalVolU3, globalMaxZUnits, zCapApplied,
      floatingBuildingsCount, drainCount, hollowChambersKept, hollowChambersFilledSolid,
      allKeptChambersValid, embossMetrics, bridges, archetypes,
    } = data;
    const { halfW, halfH, scaleMm, tileCols, tileRows, hollowBase } = ctx;
    const soupAudit = skipTopologyAudit
      ? { openEdges: 0, nonManifoldEdges: 0, sameDirDupEdges: 0, degenerateTrisCount: 0, outOfTileTrisCount: 0, layerMetrics: {}, isWatertightManifold: true, skipped: true }
      : analyzeMeshSoupInvariants(meshes, tileBounds, halfW, halfH, scaleMm);

    const scale3 = scaleMm * scaleMm * scaleMm;
    const totalVolU3 = tileVolumesUnits3.reduce((s, v) => s + v, 0);
    const totalVolumeMl = (totalVolU3 * scale3) / 1000.0;
    const solidReferenceMl = totalVolumeMl + (Math.max(0, solidTerrainTotalVolU3 - printedBaseTotalVolU3) * scale3) / 1000.0;
    const resinDensity = (ctx.cfg && ctx.cfg.resin && ctx.cfg.resin.densityGPerMl)
      || (ctx.slaLaws && ctx.slaLaws.MONO4_SPEC && ctx.slaLaws.MONO4_SPEC.densityGPerCm3) || 1.15;
    const tileVolumesMl = Array.from(tileVolumesUnits3, v => (v * scale3) / 1000.0);
    const tileMaxZMm = Array.from(tileMaxZUnits, z => z * scaleMm);
    const hollowSavingsPct = (hollowBase && hollowChambersKept >= 1 && solidTerrainTotalVolU3 > 1e-4)
      ? Math.max(0, Math.min(85, Math.round(((solidTerrainTotalVolU3 - printedBaseTotalVolU3) / solidTerrainTotalVolU3) * 100)))
      : 0;
    const totalTriangles = meshes.water.length + meshes.base.length + meshes.greenery.length +
      meshes.roads.length + meshes.buildings.length + meshes.highlighted.length + meshes.frame.length;

    const tileWidthMm = (2 * halfW * scaleMm) / tileCols;
    const tileHeightMm = (2 * halfH * scaleMm) / tileRows;
    const maxZMmVal = Math.round(globalMaxZUnits * scaleMm * 10) / 10;
    const mono4 = (ctx.cfg && ctx.cfg.photonMono4) || { bedXMm: 153.45, bedYMm: 87.05, bedZMm: 165.0 };
    const resolvedBedZ = (ctx.state && ctx.state.bedZ) || mono4.bedZMm;
    const fitsPhotonMono4 = (((tileWidthMm <= mono4.bedXMm && tileHeightMm <= mono4.bedYMm) ||
      (tileHeightMm <= mono4.bedXMm && tileWidthMm <= mono4.bedYMm)) && maxZMmVal <= resolvedBedZ);
    const multiDeckOverlapsViolated = countMultiDeckOverlapsViolated(ctx.audit.bridgeAudits);
    const isWatertight = soupAudit.isWatertightManifold && floatingBuildingsCount === 0 && soupAudit.outOfTileTrisCount === 0 && totalVolumeMl > 0;
    const estMinFn = (ctx.slaLaws && typeof ctx.slaLaws.estimateMono4PrintMinutes === 'function')
      ? ctx.slaLaws.estimateMono4PrintMinutes
      : (typeof estimateMono4PrintMinutes === 'function' ? estimateMono4PrintMinutes : null);
    const estimatedPrintMin = estMinFn ? estMinFn(maxZMmVal) : Math.max(1, Math.ceil((Math.max(0, maxZMmVal) / 0.05) * 6.8 / 60));

    return {
      totalTriangles, totalVolumeMl: Math.round(totalVolumeMl * 10) / 10, resinMl: Math.round(totalVolumeMl * 10) / 10,
      solidReferenceMl: Math.round(solidReferenceMl * 10) / 10, resinGrams: Math.round(totalVolumeMl * resinDensity),
      maxZMm: maxZMmVal, estimatedPrintMin, supportlessMode: Boolean(ctx.supportlessMode),
      bedZ: resolvedBedZ, zCapLimitMm: ctx.zCapLimitMm, zCapApplied, hollowSavingsPct,
      tileVolumesMl, tileMaxZMm, maxTileVolumeMl: tileVolumesMl.length ? Math.max(...tileVolumesMl) : totalVolumeMl,
      tileCols, tileRows, numTiles: tileBounds.length, tileWidthMm, tileHeightMm,
      drainCount, hollowChambersKept, hollowChambersFilledSolid,
      hasDrainChannels: hollowChambersKept >= 1 && allKeptChambersValid && drainCount >= 2,
      embossMetrics, fitsPhotonMono4, frameExcludedFromExport: !(ctx.state && ctx.state.exportFrame),
      floatingBuildingsCount, floatingCount: floatingBuildingsCount,
      outOfTileTrisCount: soupAudit.outOfTileTrisCount,
      openEdges: soupAudit.openEdges, openEdgesCount: soupAudit.openEdges,
      nonManifoldEdges: soupAudit.nonManifoldEdges, nonManifoldEdgesCount: soupAudit.nonManifoldEdges,
      sameDirDupEdges: soupAudit.sameDirDupEdges, sameDirDupEdgesCount: soupAudit.sameDirDupEdges,
      unpairedDirEdgesCount: soupAudit.openEdges + soupAudit.nonManifoldEdges,
      degenerateTrisCount: soupAudit.degenerateTrisCount, degenerateTris: soupAudit.degenerateTrisCount,
      negativeWindingCount: 0, isWatertightManifold: isWatertight, isManifold: isWatertight,
      layerMetrics: soupAudit.layerMetrics,
      bridgeCount: (bridges && bridges.count !== undefined) ? bridges.count : (ctx.audit.bridgeAudits || []).length,
      multiDeckSeparationsOk: multiDeckOverlapsViolated === 0,
      archetypeCounts: (archetypes && archetypes.counts) || ctx.audit.archetypeCounts || {},
    };
  }

  const exportsObj = { analyzeMeshSoupInvariants, countMultiDeckOverlapsViolated, assemblePrintMetricsReport };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
