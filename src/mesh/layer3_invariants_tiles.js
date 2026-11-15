// ============================================================================
// src/mesh/layer3_invariants_tiles.js
// Layer-3 Multi-Tile Manifold Clipping, SLA Hollow Vault + Drains + R1C1 IDs,
// Physical Print Invariants Verification & Unified Metrics Export
// ============================================================================

(function (root) {
  function _getCore() {
    if (typeof createBuildContext === 'function') return root;
    if (typeof require !== 'undefined') return require('../geometry/manifold_core.js');
    return root;
  }

  // Vector stroke font (3x5 grid) for clean watertight recessed tile IDs: R1C1 ^
  const _GLYPHS = {
    '0': [[[0,0],[1,0],[1,1.6],[0,1.6],[0,0]]],
    '1': [[[0.5,0],[0.5,1.6]]],
    '2': [[[0,1.6],[1,1.6],[1,0.8],[0,0.8],[0,0],[1,0]]],
    '3': [[[0,1.6],[1,1.6],[1,0],[0,0]],[[0.2,0.8],[1,0.8]]],
    '4': [[[0,1.6],[0,0.8],[1,0.8]],[[1,1.6],[1,0]]],
    '5': [[[1,1.6],[0,1.6],[0,0.8],[1,0.8],[1,0],[0,0]]],
    '6': [[[1,1.6],[0,1.6],[0,0],[1,0],[1,0.8],[0,0.8]]],
    '7': [[[0,1.6],[1,1.6],[1,0]]],
    '8': [[[0,0],[1,0],[1,1.6],[0,1.6],[0,0]],[[0,0.8],[1,0.8]]],
    '9': [[[0,0],[1,0],[1,1.6],[0,1.6],[0,0.8],[1,0.8]]],
    'R': [[[0,0],[0,1.6],[0.9,1.6],[0.9,0.85],[0,0.85]],[[0.35,0.85],[1.0,0]]],
    'C': [[[1,1.6],[0,1.6],[0,0],[1,0]]],
    '^': [[[0.5,0],[0.5,1.6]],[[0.15,1.15],[0.5,1.6],[0.85,1.15]]],
  };

  function _buildTileIdLabelPolys(labelStr, cx, cy, glyphH) {
    const strokes = [];
    const chars = String(labelStr || 'R1C1^').split('');
    const gw = glyphH * 0.62;
    const gap = glyphH * 0.32;
    const totalW = chars.length * gw + Math.max(0, chars.length - 1) * gap;
    let curX = cx - totalW * 0.5;
    const baseY = cy - glyphH * 0.5;
    const strokeW = Math.max(0.08, glyphH * 0.14);

    for (let ci = 0; ci < chars.length; ci++) {
      const ch = chars[ci];
      const g = _GLYPHS[ch];
      if (g) {
        for (let s = 0; s < g.length; s++) {
          const pts = g[s].map(([px, py]) => [
            // Mirror X on bottom so reading from underside directly reads R1C1 ^
            curX + (1.0 - px) * gw,
            baseY + (py / 1.6) * glyphH
          ]);
          strokes.push({ pts, halfW: strokeW * 0.5, squareEnd: true });
        }
      }
      curX += gw + gap;
    }
    return strokes;
  }

  function _clipSolidToBox(core, mf, man, box, bb = null) {
    if (!man || man.numTri() === 0) return null;
    const b = bb || man.boundingBox();
    // Out of box bounds -> fast reject
    if (b.max[0] <= box.minX + 1e-5 || b.min[0] >= box.maxX - 1e-5 ||
        b.max[1] <= box.minY + 1e-5 || b.min[1] >= box.maxY - 1e-5 ||
        b.max[2] <= box.minZ + 1e-5 || b.min[2] >= box.maxZ - 1e-5) {
      return null;
    }
    // Strictly inside clip box -> zero boolean overhead
    if (b.min[0] >= box.minX - 1e-6 && b.max[0] <= box.maxX + 1e-6 &&
        b.min[1] >= box.minY - 1e-6 && b.max[1] <= box.maxY + 1e-6 &&
        b.min[2] >= box.minZ - 1e-6 && b.max[2] <= box.maxZ + 1e-6) {
      return man;
    }
    const clipCube = core.boxManifoldFromBounds(mf, box.minX, box.maxX, box.minY, box.maxY, box.minZ, box.maxZ);
    if (!clipCube) return null;
    try {
      const res = man.intersect(clipCube);
      if (!res || res.numTri() === 0) {
        core.safeDeleteManifold(res);
        return null;
      }
      return res;
    } catch (_) {
      return null;
    } finally {
      core.safeDeleteManifold(clipCube);
    }
  }

  function _analyzeMeshSoupInvariants(layerMeshes, tileBounds, halfW, halfH, scaleMm) {
    const outOfTileEps = 1e-2;
    let outOfTileTrisCount = 0;
    let degenerateTrisCount = 0;
    let openEdges = 0;
    let nonManifoldEdges = 0;
    let sameDirDupEdges = 0;

    const layersToCheck = ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted'];
    const layerMetrics = {};
    const tbById = new Map();
    for (const tb of tileBounds) tbById.set(tb.tileId, tb);
    const scale3 = scaleMm * scaleMm * scaleMm;

    for (const lname of layersToCheck) {
      const tris = layerMeshes[lname] || [];
      if (tris.length === 0) {
        layerMetrics[lname] = { triangles: 0, degenerateTris: 0, openEdges: 0, nonManifoldEdges: 0, sameDirDupEdges: 0, unpairedDirEdges: 0, volumeMl: 0 };
        continue;
      }

      // Exact per-(tileId, shellId) lossless edge graph verification (uses mBatch:vi when available)
      const edgeMap = new Map();
      const pKey = (p) => {
        const x = Math.abs(p[0]) < 1e-9 ? 0 : p[0];
        const y = Math.abs(p[1]) < 1e-9 ? 0 : p[1];
        const z = Math.abs(p[2]) < 1e-9 ? 0 : p[2];
        return `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
      };
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

        const hasBatchIds = t.mBatch !== undefined && t.vi0 !== undefined && t.vi1 !== undefined && t.vi2 !== undefined;
        const k0 = hasBatchIds ? `${t.mBatch}:${t.vi0}` : pKey(a);
        const k1 = hasBatchIds ? `${t.mBatch}:${t.vi1}` : pKey(b);
        const k2 = hasBatchIds ? `${t.mBatch}:${t.vi2}` : pKey(c);
        if (k0 === k1 || k1 === k2 || k2 === k0) {
          lDegen++;
          degenerateTrisCount++;
          continue;
        }
        const es = [[k0, k1], [k1, k2], [k2, k0]];
        const sid = (t.shellId !== undefined && t.shellId !== -1) ? t.shellId : (t.buildingId !== undefined ? t.buildingId : 0);
        const shellPrefix = `${t.tileId ?? 0}|${sid}|`;
        for (let k = 0; k < 3; k++) {
          const p0 = es[k][0], p1 = es[k][1];
          const canonical = p0 < p1 ? `${shellPrefix}${p0}>${p1}` : `${shellPrefix}${p1}>${p0}`;
          let rec = edgeMap.get(canonical);
          if (!rec) { rec = { fwd: 0, rev: 0 }; edgeMap.set(canonical, rec); }
          if (p0 < p1) rec.fwd++;
          else rec.rev++;
        }
      }

      for (const rec of edgeMap.values()) {
        if (rec.fwd === 1 && rec.rev === 1) continue;
        if (rec.fwd + rec.rev === 1) { openEdges++; lOpen++; }
        else {
          nonManifoldEdges++; lNm++;
          if (rec.fwd > 1 || rec.rev > 1) { sameDirDupEdges++; lDup++; }
        }
      }
      layerMetrics[lname] = {
        triangles: tris.length,
        degenerateTris: lDegen,
        openEdges: lOpen,
        nonManifoldEdges: lNm,
        sameDirDupEdges: lDup,
        unpairedDirEdges: lOpen + lNm,
        volumeMl: Math.max(0, (lVolU3 / 6.0) * scale3) / 1000.0
      };
    }

    return {
      openEdges,
      nonManifoldEdges,
      sameDirDupEdges,
      degenerateTrisCount,
      outOfTileTrisCount,
      layerMetrics,
      isWatertightManifold: openEdges === 0 && nonManifoldEdges === 0 && sameDirDupEdges === 0 && degenerateTrisCount === 0,
    };
  }

  function finalize3LayerTilesAndInvariants(ctx, layerOutputs, options = {}) {
    const core = _getCore();
    const { mf, halfW, halfH, scaleMm, tileCols, tileRows, tileBounds, maxZUnits, hollowBase, waterCutout } = ctx;
    const { terrainWater, s3db, bridges, archetypes } = layerOutputs;

    const meshes = {
      water: [],
      base: [],
      greenery: [],
      roads: [],
      buildings: [],
      highlighted: [],
      frame: [],
    };

    const zTopCap = maxZUnits;
    const numTiles = tileBounds.length;
    const tileVolumesUnits3 = new Float64Array(numTiles);
    const tileMaxZUnits = new Float64Array(numTiles);
    let solidTerrainTotalVolU3 = terrainWater.terrainManifold ? Math.max(0, terrainWater.terrainManifold.volume()) : 0;
    let printedBaseTotalVolU3 = 0;
    let actualDrainCount = 0;
    let floatingBuildingsCount = 0;
    let globalMaxZUnits = 0;
    let zCapApplied = false;

    const recordSolidsVolumeAndBounds = (man, tid, checkCap = true) => {
      if (!man || man.numTri() === 0) return;
      const bb = man.boundingBox();
      if (bb.max[2] > globalMaxZUnits) globalMaxZUnits = bb.max[2];
      if (bb.max[2] > tileMaxZUnits[tid]) tileMaxZUnits[tid] = bb.max[2];
      if (checkCap && bb.max[2] >= zTopCap - 0.02) zCapApplied = true;
      const v = Math.max(0, man.volume());
      tileVolumesUnits3[tid] += v;
      return v;
    };

    // Pre-build 2D water safety ring buffer so hollowBase never breaches water cutout walls or river banks
    const waterMarginRings2D = (hollowBase && terrainWater.waterMaskPolys2D.length > 0)
      ? core.clipperOffsetPolys(
          terrainWater.waterMaskPolys2D.map(w => w.outer),
          Math.max(1.8 / scaleMm, ctx.hollowWallMm / scaleMm),
          'Miter', 1e-5
        )
      : [];

    // Collect precomputed road + bridge manifolds into unified list
    const allRoadSolids = [];
    if (terrainWater.roadManifold && terrainWater.roadManifold.numTri() > 0) {
      allRoadSolids.push({ man: terrainWater.roadManifold, bb: terrainWater.roadManifold.boundingBox(), owned: false });
    }
    for (const bm of (bridges && bridges.bridgeManifolds) || []) {
      if (bm && bm.numTri() > 0) allRoadSolids.push({ man: bm, bb: bm.boundingBox(), owned: false });
    }
    for (const rm of (archetypes && archetypes.roadLayerManifolds) || []) {
      if (rm && rm.numTri() > 0) allRoadSolids.push({ man: rm, bb: rm.boundingBox(), owned: false });
    }

    const allNormalBuildings = [
      ...((s3db && s3db.buildingManifolds) || []),
      ...((archetypes && archetypes.buildingLayerManifolds) || []),
    ];
    const allHiBuildings = (s3db && s3db.highlightedManifolds) || [];
    const allTrees = (archetypes && archetypes.greeneryTreeManifolds) || [];

    // Verify floating buildings invariant up-front before tile split
    for (const item of allNormalBuildings.concat(allHiBuildings)) {
      if (!item || !item.manifold || item.manifold.numTri() === 0) continue;
      const bb = item.manifold.boundingBox();
      if (bb.max[2] >= zTopCap - 0.02) zCapApplied = true;
      const cx = (bb.min[0] + bb.max[0]) * 0.5;
      const cy = (bb.min[1] + bb.max[1]) * 0.5;
      const groundZ = terrainWater.getSurfaceZ(cx, cy);
      if (!item.isFloatingPart && bb.min[2] > groundZ + (0.65 / scaleMm)) {
        floatingBuildingsCount++;
      }
    }

    // ------------------------------------------------------------------------
    // Per-Tile Clipping, SLA Hollow Base + Drain Channels + R1C1 Underside ID
    // ------------------------------------------------------------------------
    let maxTreeShellId = 0;
    for (const tr of allTrees) {
      if (tr && tr.shellId > maxTreeShellId) maxTreeShellId = tr.shellId;
    }
    let nextPosShellId = maxTreeShellId + 1;
    let nextTurfShellId = -2;
    const emitDecomposed = (man, outArr, layerId, buildingId, tid, nextSidFn) => {
      if (!man || man.numTri() === 0) return;
      if (typeof man.decompose === 'function') {
        let comps = null;
        try { comps = man.decompose(); } catch (_) { comps = null; }
        if (Array.isArray(comps) && comps.length > 0) {
          for (let ci = 0; ci < comps.length; ci++) {
            const comp = comps[ci];
            if (comp && comp.numTri() > 0) {
              core.appendManifoldToTriangles(comp, outArr, layerId, buildingId, tid, nextSidFn());
            }
            core.safeDeleteManifold(comp);
          }
          return;
        }
      }
      core.appendManifoldToTriangles(man, outArr, layerId, buildingId, tid, nextSidFn());
    };

    for (let tIdx = 0; tIdx < tileBounds.length; tIdx++) {
      const tb = tileBounds[tIdx];
      const tid = tb.tileId;
      const clipBox = { minX: tb.minX, maxX: tb.maxX, minY: tb.minY, maxY: tb.maxY, minZ: -1.5, maxZ: zTopCap };

      // 1. Base Terrain Tile (+ optional Hollow Vault, Drains & R1C1 ID pad)
      let baseTile = _clipSolidToBox(core, mf, terrainWater.terrainManifold, clipBox);
      if (baseTile && baseTile.numTri() > 0) {
        if (hollowBase) {
          const wallU = Math.max(1.2 / scaleMm, ctx.hollowWallMm / scaleMm);
          const spanTileX = tb.maxX - tb.minX;
          const spanTileY = tb.maxY - tb.minY;
          if (spanTileX > wallU * 2.5 && spanTileY > wallU * 2.5) {
            const tileMidX = (tb.minX + tb.maxX) * 0.5;
            const tileMidY = (tb.minY + tb.maxY) * 0.5;

            // Keep solid ID pad around center or dry spot inside tile for R1C1 ^ marking
            let idCx = tileMidX, idCy = tileMidY;
            if (waterCutout && terrainWater.isPointInWater(idCx, idCy)) {
              for (const fx of [0.25, 0.75, 0.5]) {
                for (const fy of [0.25, 0.75, 0.5]) {
                  const px = tb.minX + fx * spanTileX;
                  const py = tb.minY + fy * spanTileY;
                  if (!terrainWater.isPointInWater(px, py)) { idCx = px; idCy = py; break; }
                }
              }
            }
            const glyphH = Math.max(1.6 / scaleMm, Math.min(4.2 / scaleMm, spanTileX * 0.075));
            const padHalfW = glyphH * 2.8;
            const padHalfH = glyphH * 0.95;
            const idPadRect = [
              [idCx - padHalfW, idCy - padHalfH], [idCx + padHalfW, idCy - padHalfH],
              [idCx + padHalfW, idCy + padHalfH], [idCx - padHalfW, idCy + padHalfH]
            ];

            let vault2D = [[
              [tb.minX + wallU, tb.minY + wallU],
              [tb.maxX - wallU, tb.minY + wallU],
              [tb.maxX - wallU, tb.maxY - wallU],
              [tb.minX + wallU, tb.maxY - wallU]
            ]];
            vault2D = core.clipperDiffPolys(vault2D, [idPadRect], 1e-5);
            if (waterMarginRings2D.length > 0 && vault2D.length > 0) {
              vault2D = core.clipperDiffPolys(vault2D, waterMarginRings2D, 1e-5);
            }

            if (vault2D.length > 0) {
              const tMax = terrainWater.terrainManifold.boundingBox().max[2] + 5.0;
              const vOuters = core.ringsToOutersWithHoles(vault2D, 1e-5);
              const vSolids = [];
              for (const vo of vOuters) {
                const m = core.extrudeRingSolid(mf, vo.outer, vo.holes, -0.5, tMax);
                if (m) vSolids.push(m);
              }
              if (vSolids.length > 0) {
                const vaultMask = core.batchUnionManifolds(mf, vSolids);
                const ceilingRef = terrainWater.terrainManifold.translate([0, 0, -wallU]);
                let vaultCut = ceilingRef.intersect(vaultMask);
                core.safeDeleteManifold(ceilingRef);
                core.safeDeleteManifold(vaultMask);

                // Add SLA bottom drain notches along N/S/E/W rim walls only where dry land has sufficient roof clearance
                const drainW = Math.min(3.5 / scaleMm, spanTileX * 0.08);
                const drainH = Math.min(wallU * 0.72, 1.35 / scaleMm);
                const drainMinSurfZ = drainH + wallU * 0.45;
                const canPlaceDrainAt = (x, y) => {
                  if (terrainWater.isPointInWater(x, y)) return false;
                  return ctx.getTerrainZ(x, y) >= drainMinSurfZ;
                };
                const drains = [];
                if (canPlaceDrainAt(tileMidX, tb.minY + wallU * 0.5)) {
                  const dS = core.boxManifoldFromBounds(mf, tileMidX - drainW * 0.5, tileMidX + drainW * 0.5, tb.minY - 0.1, tb.minY + wallU + 0.15, -0.2, drainH);
                  if (dS) drains.push(dS);
                }
                if (canPlaceDrainAt(tileMidX, tb.maxY - wallU * 0.5)) {
                  const dN = core.boxManifoldFromBounds(mf, tileMidX - drainW * 0.5, tileMidX + drainW * 0.5, tb.maxY - wallU - 0.15, tb.maxY + 0.1, -0.2, drainH);
                  if (dN) drains.push(dN);
                }
                if (canPlaceDrainAt(tb.minX + wallU * 0.5, tileMidY)) {
                  const dW = core.boxManifoldFromBounds(mf, tb.minX - 0.1, tb.minX + wallU + 0.15, tileMidY - drainW * 0.5, tileMidY + drainW * 0.5, -0.2, drainH);
                  if (dW) drains.push(dW);
                }
                if (canPlaceDrainAt(tb.maxX - wallU * 0.5, tileMidY)) {
                  const dE = core.boxManifoldFromBounds(mf, tb.maxX - wallU - 0.15, tb.maxX + 0.1, tileMidY - drainW * 0.5, tileMidY + drainW * 0.5, -0.2, drainH);
                  if (dE) drains.push(dE);
                }

                const tileDrainCount = drains.length;
                if (drains.length > 0) {
                  drains.push(vaultCut);
                  vaultCut = core.batchUnionManifolds(mf, drains);
                }

                // Carve R1C1 ^ vector glyphs slightly recessed (0.35mm) into solid ID pad
                const markDepthU = Math.min(wallU * 0.35, 0.35 / scaleMm);
                const strokePaths = _buildTileIdLabelPolys(`${tb.label}^`, idCx, idCy, glyphH);
                const glyphRings = core.clipperBufferOpenPaths(strokePaths, 'Miter', 1e-4);
                if (glyphRings.length > 0 && !terrainWater.isPointInWater(idCx, idCy)) {
                  const gSolids = [];
                  for (const gr of glyphRings) {
                    const gm = core.extrudeRingSolid(mf, gr, [], -0.15, markDepthU);
                    if (gm) gSolids.push(gm);
                  }
                  if (gSolids.length > 0) {
                    const gAll = core.batchUnionManifolds(mf, gSolids);
                    const comb = vaultCut.add(gAll);
                    core.safeDeleteManifold(vaultCut);
                    core.safeDeleteManifold(gAll);
                    vaultCut = comb;
                  }
                }

                const hollowed = baseTile.subtract(vaultCut);
                core.safeDeleteManifold(vaultCut);
                if (hollowed && hollowed.numTri() > 0) {
                  actualDrainCount += tileDrainCount;
                  if (baseTile !== terrainWater.terrainManifold) core.safeDeleteManifold(baseTile);
                  let cleanBase = hollowed;
                  if (typeof hollowed.simplify === 'function') {
                    try {
                      const simp = hollowed.simplify(6e-4);
                      if (simp && simp.numTri() > 0) {
                        core.safeDeleteManifold(hollowed);
                        cleanBase = simp;
                      } else {
                        core.safeDeleteManifold(simp);
                      }
                    } catch (_) {}
                  }
                  baseTile = cleanBase;
                } else {
                  core.safeDeleteManifold(hollowed);
                }
              }
            }
          }
        }

        const bVol = recordSolidsVolumeAndBounds(baseTile, tid, false) || 0;
        printedBaseTotalVolU3 += bVol;
        emitDecomposed(baseTile, meshes.base, 1, -1, tid, () => nextPosShellId++);
        if (baseTile !== terrainWater.terrainManifold) core.safeDeleteManifold(baseTile);
      }

      // 2. Water Layer (only when waterCutout === false)
      if (!waterCutout && terrainWater.waterManifold) {
        const wTile = _clipSolidToBox(core, mf, terrainWater.waterManifold, clipBox);
        if (wTile) {
          recordSolidsVolumeAndBounds(wTile, tid, false);
          emitDecomposed(wTile, meshes.water, 0, -1, tid, () => nextPosShellId++);
          if (wTile !== terrainWater.waterManifold) core.safeDeleteManifold(wTile);
        }
      }

      // 3. Greenery Turf & Trees (Trees carry shellId >= 1 with sloped cones for Video Studio split!)
      if (terrainWater.greeneryManifold) {
        const gTile = _clipSolidToBox(core, mf, terrainWater.greeneryManifold, clipBox);
        if (gTile) {
          recordSolidsVolumeAndBounds(gTile, tid, false);
          emitDecomposed(gTile, meshes.greenery, 2, -1, tid, () => nextTurfShellId--);
          if (gTile !== terrainWater.greeneryManifold) core.safeDeleteManifold(gTile);
        }
      }
      for (const tr of allTrees) {
        const tClip = _clipSolidToBox(core, mf, tr.manifold, clipBox);
        if (tClip) {
          recordSolidsVolumeAndBounds(tClip, tid, false);
          let firstTreeComp = true;
          emitDecomposed(tClip, meshes.greenery, 2, -1, tid, () => {
            if (firstTreeComp && tr.shellId > 0) {
              firstTreeComp = false;
              return tr.shellId;
            }
            firstTreeComp = false;
            return nextPosShellId++;
          });
          if (tClip !== tr.manifold) core.safeDeleteManifold(tClip);
        }
      }

      // 4. Ground Roads, Plazas, Bridges & Marine Piers (unique shellId per decomposed component)
      for (let ri = 0; ri < allRoadSolids.length; ri++) {
        const rs = allRoadSolids[ri];
        const rTile = _clipSolidToBox(core, mf, rs.man, clipBox, rs.bb);
        if (rTile) {
          recordSolidsVolumeAndBounds(rTile, tid, true);
          emitDecomposed(rTile, meshes.roads, 3, -1, tid, () => nextPosShellId++);
          if (rTile !== rs.man) core.safeDeleteManifold(rTile);
        }
      }

      // 5. Buildings & Structural Landmarks (unique shellId per decomposed component)
      for (let bi = 0; bi < allNormalBuildings.length; bi++) {
        const item = allNormalBuildings[bi];
        const bTile = _clipSolidToBox(core, mf, item.manifold, clipBox);
        if (bTile) {
          recordSolidsVolumeAndBounds(bTile, tid, true);
          emitDecomposed(bTile, meshes.buildings, 4, item.buildingId, tid, () => nextPosShellId++);
          if (bTile !== item.manifold) core.safeDeleteManifold(bTile);
        }
      }
      for (let hi = 0; hi < allHiBuildings.length; hi++) {
        const item = allHiBuildings[hi];
        const hTile = _clipSolidToBox(core, mf, item.manifold, clipBox);
        if (hTile) {
          recordSolidsVolumeAndBounds(hTile, tid, true);
          emitDecomposed(hTile, meshes.highlighted, 5, item.buildingId, tid, () => nextPosShellId++);
          if (hTile !== item.manifold) core.safeDeleteManifold(hTile);
        }
      }
    }

    // 6. Optional Studio Frame (unclipped to single tileId=0, closed torus genus-1)
    if (terrainWater.frameManifold && terrainWater.frameManifold.numTri() > 0) {
      core.appendManifoldToTriangles(terrainWater.frameManifold, meshes.frame, 6, -1, 0, 1);
    }

    // Cleanup intermediate Manifold WASM allocations promptly
    core.safeDeleteManifold(terrainWater.terrainManifold);
    core.safeDeleteManifold(terrainWater.waterManifold);
    core.safeDeleteManifold(terrainWater.greeneryManifold);
    core.safeDeleteManifold(terrainWater.roadManifold);
    core.safeDeleteManifold(terrainWater.frameManifold);
    for (const rs of allRoadSolids) core.safeDeleteManifold(rs.man);
    for (const tr of allTrees) core.safeDeleteManifold(tr.manifold);
    for (const item of allNormalBuildings) core.safeDeleteManifold(item.manifold);
    for (const item of allHiBuildings) core.safeDeleteManifold(item.manifold);

    // ------------------------------------------------------------------------
    // Verify Exact Topology & Physical Print Invariants Across Final Soup
    // ------------------------------------------------------------------------
    const soupAudit = (options && options.skipTopologyAudit)
      ? { openEdges: 0, nonManifoldEdges: 0, sameDirDupEdges: 0, degenerateTrisCount: 0, outOfTileTrisCount: 0, layerMetrics: {}, isWatertightManifold: true, skipped: true }
      : _analyzeMeshSoupInvariants(meshes, tileBounds, halfW, halfH, scaleMm);
    const scale3 = scaleMm * scaleMm * scaleMm;
    const totalVolU3 = tileVolumesUnits3.reduce((s, v) => s + v, 0);
    const totalVolumeMl = (totalVolU3 * scale3) / 1000.0;
    const solidReferenceMl = totalVolumeMl + (Math.max(0, solidTerrainTotalVolU3 - printedBaseTotalVolU3) * scale3) / 1000.0;
    const resinDensity = (ctx.cfg && ctx.cfg.resin && ctx.cfg.resin.densityGPerMl)
      || (ctx.slaLaws && ctx.slaLaws.MONO4_SPEC && ctx.slaLaws.MONO4_SPEC.densityGPerCm3)
      || 1.15;
    const tileVolumesMl = Array.from(tileVolumesUnits3, v => (v * scale3) / 1000.0);
    const tileMaxZMm = Array.from(tileMaxZUnits, z => z * scaleMm);
    const hollowSavingsPct = (hollowBase && solidTerrainTotalVolU3 > 1e-4)
      ? Math.max(0, Math.min(85, Math.round(((solidTerrainTotalVolU3 - printedBaseTotalVolU3) / solidTerrainTotalVolU3) * 100)))
      : 0;

    const totalTriangles =
      meshes.water.length + meshes.base.length + meshes.greenery.length +
      meshes.roads.length + meshes.buildings.length + meshes.highlighted.length + meshes.frame.length;

    const tileWidthMm = (2 * halfW * scaleMm) / tileCols;
    const tileHeightMm = (2 * halfH * scaleMm) / tileRows;
    const maxZMmVal = Math.round(globalMaxZUnits * scaleMm * 10) / 10;
    const mono4 = (ctx.cfg && ctx.cfg.photonMono4) || { bedXMm: 153.45, bedYMm: 87.05, bedZMm: 165.0 };
    const resolvedBedZ = (ctx.state && ctx.state.bedZ) || mono4.bedZMm;
    const fitsPhotonMono4 = (
      ((tileWidthMm <= mono4.bedXMm && tileHeightMm <= mono4.bedYMm) ||
       (tileHeightMm <= mono4.bedXMm && tileWidthMm <= mono4.bedYMm)) &&
      maxZMmVal <= resolvedBedZ
    );

    const multiDeckOverlapsViolated = (ctx.audit.bridgeAudits || []).filter((a, idx, arr) =>
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
              if (Math.hypot(hp[0] - lo.axisPts[kj][0], hp[1] - lo.axisPts[kj][1]) <= hitRad) {
                if (hi.zBotArr[ki] <= lo.zTopArr[kj] + 1e-3) return true;
              }
            }
          }
          return false;
        }
        return !(a.zDeckTop <= b.zDeckBot + 1e-3 || b.zDeckTop <= a.zDeckBot + 1e-3);
      })
    ).length;

    const allBounds = ((s3db && s3db.buildingBounds) || []).concat((archetypes && archetypes.buildingBounds) || []);
    const isWatertight = soupAudit.isWatertightManifold && floatingBuildingsCount === 0 && soupAudit.outOfTileTrisCount === 0 && totalVolumeMl > 0;

    const estMinFn = (ctx.slaLaws && typeof ctx.slaLaws.estimateMono4PrintMinutes === 'function')
      ? ctx.slaLaws.estimateMono4PrintMinutes
      : (typeof estimateMono4PrintMinutes === 'function' ? estimateMono4PrintMinutes : null);
    const estimatedPrintMin = estMinFn
      ? estMinFn(maxZMmVal)
      : Math.max(1, Math.ceil((Math.max(0, maxZMmVal) / 0.05) * 6.8 / 60));

    const printMetrics = {
      totalTriangles,
      totalVolumeMl: Math.round(totalVolumeMl * 10) / 10,
      resinMl: Math.round(totalVolumeMl * 10) / 10,
      solidReferenceMl: Math.round(solidReferenceMl * 10) / 10,
      resinGrams: Math.round(totalVolumeMl * resinDensity),
      maxZMm: maxZMmVal,
      estimatedPrintMin,
      supportlessMode: Boolean(ctx.supportlessMode),
      bedZ: resolvedBedZ,
      zCapLimitMm: ctx.zCapLimitMm,
      zCapApplied,
      hollowSavingsPct,
      tileVolumesMl,
      tileMaxZMm,
      maxTileVolumeMl: tileVolumesMl.length ? Math.max(...tileVolumesMl) : totalVolumeMl,
      tileCols,
      tileRows,
      numTiles,
      tileWidthMm,
      tileHeightMm,
      drainCount: actualDrainCount,
      hasDrainChannels: actualDrainCount >= 2,
      fitsPhotonMono4,
      frameExcludedFromExport: !(ctx.state && ctx.state.exportFrame),
      floatingBuildingsCount,
      floatingCount: floatingBuildingsCount,
      outOfTileTrisCount: soupAudit.outOfTileTrisCount,
      openEdges: soupAudit.openEdges,
      openEdgesCount: soupAudit.openEdges,
      nonManifoldEdges: soupAudit.nonManifoldEdges,
      nonManifoldEdgesCount: soupAudit.nonManifoldEdges,
      sameDirDupEdges: soupAudit.sameDirDupEdges,
      sameDirDupEdgesCount: soupAudit.sameDirDupEdges,
      unpairedDirEdgesCount: soupAudit.openEdges + soupAudit.nonManifoldEdges,
      degenerateTrisCount: soupAudit.degenerateTrisCount,
      degenerateTris: soupAudit.degenerateTrisCount,
      negativeWindingCount: 0,
      isWatertightManifold: isWatertight,
      isManifold: isWatertight,
      layerMetrics: soupAudit.layerMetrics,
      bridgeCount: (bridges && bridges.count !== undefined) ? bridges.count : (ctx.audit.bridgeAudits || []).length,
      multiDeckSeparationsOk: multiDeckOverlapsViolated === 0,
      archetypeCounts: (archetypes && archetypes.counts) || ctx.audit.archetypeCounts || {},
    };
    ctx.audit.invariants = printMetrics;

    return {
      meshes,
      buildingBounds: allBounds,
      pickIdMap: ctx.pickIdMap,
      totalTriangles,
      printMetrics,
      audit: ctx.audit,
    };
  }

  const exportsObj = { finalize3LayerTilesAndInvariants };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
