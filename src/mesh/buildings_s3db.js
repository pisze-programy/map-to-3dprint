// ============================================================================
// src/mesh/buildings_s3db.js
// Support-Aware Hierarchical S3DB Z-Tier Resolver (0 Floating Bricks,
// Preserves Church Domes Under Lanterns & Stepped Skyscraper Fins) + LoD2 Extruder
// ============================================================================

if (typeof prepareAndClusterS3DBBuildings === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
  Object.assign(global, require('../geometry/obb_medial_2d.js'));
  Object.assign(global, require('./mesh_primitives.js'));
  Object.assign(global, require('./mesh_clipper_3d.js'));
  Object.assign(global, require('./roof_shapes.js'));
  Object.assign(global, require('./roof_architectural.js'));
  Object.assign(global, require('./buildings_prepare.js'));
}

/**
 * Resolves hierarchical Z-tiers, podium clamping, and cantilever anchoring for a single
 * connected S3DB building cluster. Shared identically by sync and progressive pipelines.
 */
function resolveS3DBClusterTiers(cluster, mToU, quantizeZUnits) {
  if (!cluster || cluster.length <= 1) return;
  cluster.sort((a, b) => ((a.scaledMinH || 0) - (b.scaledMinH || 0)) || (a.zTop - b.zTop) || (b.area - a.area));

  // Suppress strictly contained equal-height/equal-base duplicates & submerged interior shells
  for (let i = 0; i < cluster.length; i++) {
    const C = cluster[i];
    if (C.skip) continue;
    for (let j = 0; j < cluster.length; j++) {
      if (i === j || cluster[j].skip) continue;
      const P = cluster[j];
      if (C.isRotundaDrum && P.roofShape !== 'cone') continue;
      if (Math.abs(C.zTop - P.zTop) < 0.04 && Math.abs((C.scaledMinH || 0) - (P.scaledMinH || 0)) < 0.04 && C.area <= P.area * 1.01) {
        if (isPointInsidePart2D(C.interiorPt[0], C.interiorPt[1], P, 0.03) &&
            C.clippedOuter.every(pt => isPointInsidePart2D(pt[0], pt[1], P, 0.03))) {
          C.skip = true; break;
        }
      }
      if (C.zTop < P.zTop - 0.05 && (C.scaledMinH || 0) <= 0.01 && (P.scaledMinH || 0) <= 0.01 && C.area <= P.area * 0.96) {
        if (isPointInsidePart2D(C.interiorPt[0], C.interiorPt[1], P, 0.03) &&
            C.clippedOuter.every(pt => isPointInsidePart2D(pt[0], pt[1], P, 0.03))) {
          C.skip = true; break;
        }
      }
    }
  }

  const CROWN_ROOF_SET = new Set(['dome', 'onion', 'cone', 'pyramidal']);
  const shouldPreserveCrownUnderPart = (P, C) =>
    Boolean(P && C && CROWN_ROOF_SET.has(P.roofShape) && C.area <= P.area * 0.60);
  const crownSeatingZ = (P, C) => {
    const spanZ = Math.max(0, (P.zRidge || P.zTop) - (P.zEaves || P.zTop));
    const frac = (C && C.area <= P.area * 0.20) ? 0.72 : 0.42;
    return (P.zEaves || P.zTop) + spanZ * frac;
  };

  const flattenSupportingPodium = (P) => {
    P.roofShape = 'flat';
    P.hasPitched = false;
    P.zRidge = P.zEaves;
    P.zTop = P.zEaves;
    // Keep any earlier tier resting on P synced if P's pitched roof was lowered to zEaves
    for (let m = 0; m < cluster.length; m++) {
      if (cluster[m].supportRef === P && cluster[m].effBaseZ > P.zTop) {
        cluster[m].effBaseZ = P.zTop;
      }
    }
  };

  for (let i = 0; i < cluster.length; i++) {
    const C = cluster[i];
    if (C.skip) continue;
    const lower = cluster.filter((p, idx) => idx < i && !p.skip && p.zTop < C.zTop - 0.05 && (p.scaledMinH || 0) <= (C.scaledMinH || 0) + 0.05);

    const samples = [];
    for (let k = 0; k < C.clippedOuter.length; k++) {
      const p1 = C.clippedOuter[k], p2 = C.clippedOuter[(k + 1) % C.clippedOuter.length];
      samples.push(p1, [(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5]);
    }

    // Helper: snaps <= 0.03-unit OSM digitization jitter of upper tier C strictly inside podium P
    const clampChildRingIntoPodium = (child, P) => {
      if (P.clippedHoles && P.clippedHoles.length > 0) {
        if (!samples.every(pt => isPointInsidePart2D(pt[0], pt[1], P, 0.03))) return false;
        return true;
      }
      let changed = false;
      const snapped = child.clippedOuter.map(pt => {
        if (pointInPoly2D(pt[0], pt[1], P.clippedOuter)) return pt;
        let bestX = pt[0], bestY = pt[1], bestDSq = Infinity;
        const ring = P.clippedOuter;
        for (let e = 0; e < ring.length; e++) {
          const a = ring[e], b = ring[(e + 1) % ring.length];
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const lenSq = dx * dx + dy * dy;
          const t = lenSq > 1e-12 ? Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / lenSq)) : 0;
          const qx = a[0] + t * dx, qy = a[1] + t * dy;
          const dSq = (pt[0] - qx) ** 2 + (pt[1] - qy) ** 2;
          if (dSq < bestDSq) { bestDSq = dSq; bestX = qx; bestY = qy; }
        }
        changed = true;
        return [bestX + (P.interiorPt[0] - bestX) * 1e-3, bestY + (P.interiorPt[1] - bestY) * 1e-3];
      });
      if (!changed) return true;
      const cleaned = cleanPolygonRing(snapped, true);
      if (cleaned.length < 3 || !isSimplePolygon(cleaned) || hasSelfTouchingEdge2D(cleaned, 1e-4)) return false;
      child.clippedOuter = cleaned;
      return true;
    };

    // Case 1: Strict concentric setback promotion onto a lower podium roof (only when C itself isn't high-min_height arch/bridge)
    let supportingParts = null;
    if (lower.length > 0 && (C.scaledMinH || 0) <= 0.02) {
      const sortedLowerDesc = lower.slice().sort((a, b) => b.zTop - a.zTop);
      for (let s = 0; s < sortedLowerDesc.length; s++) {
        const P = sortedLowerDesc[s];
        if (P.area < C.area * 1.02) continue;
        if (isPointInsidePart2D(C.interiorPt[0], C.interiorPt[1], P, 0.025) &&
            samples.every(pt => isPointInsidePart2D(pt[0], pt[1], P, 0.025)) &&
            clampChildRingIntoPodium(C, P)) {
          supportingParts = [P];
          break;
        }
      }
    }

    // Case 2: Explicit S3DB min_height > 0 (skybridges, multi-pier arches, stepped rings, stilts, cantilevers)
    if (!supportingParts && C.scaledMinH > 0.02) {
      const zMinH = quantizeZUnits(C.tZ + C.scaledMinH * mToU * C.hMult);
      if (zMinH < C.zTop - 0.12) {
        // Active already-supported items whose vertical interval reaches or passes through zMinH
        const activeSupps = cluster.filter((p, idx) =>
          idx < i && !p.skip &&
          ((p.scaledMinH || 0) <= 0.05 || p.supportRef || p.isStructurallySupported3D || p.isLateralCantilever) &&
          p.effBaseZ <= zMinH + 0.12 &&
          p.zTop >= zMinH - 0.22 &&
          polygonsOverlap2D(C, p)
        );

        // 2A. Terminated lower podium / pier / crown roofs right under zMinH
        const roofSupps = activeSupps.filter(p =>
          (p.zEaves >= zMinH - 0.22 || CROWN_ROOF_SET.has(p.roofShape)) &&
          p.zTop <= zMinH + 0.45
        );
        let singleBest = null, singleBestDiff = Infinity;
        for (let s = 0; s < roofSupps.length; s++) {
          const P = roofSupps[s];
          if (!isPointInsidePart2D(C.interiorPt[0], C.interiorPt[1], P, 0.030)) continue;
          if (samples.every(pt => isPointInsidePart2D(pt[0], pt[1], P, 0.030))) {
            const refZ = CROWN_ROOF_SET.has(P.roofShape) ? P.zTop : P.zEaves;
            const diff = Math.abs(refZ - zMinH);
            if (diff < singleBestDiff) { singleBestDiff = diff; singleBest = P; }
          }
        }

        if (singleBest && clampChildRingIntoPodium(C, singleBest)) {
          supportingParts = [singleBest];
        } else if (activeSupps.length >= 2) {
          // 2B. Multi-pier skybridge or portal arch spanning >= 2 separated towers/piers (e.g. Marina Bay Sands, OCBC, Arc de Triomphe, Dubai Frame)
          let hasSeparatedSupports = false;
          for (let a = 0; a < activeSupps.length && !hasSeparatedSupports; a++) {
            for (let b = a + 1; b < activeSupps.length; b++) {
              if (Math.hypot(activeSupps[a].cx - activeSupps[b].cx, activeSupps[a].cy - activeSupps[b].cy) > 0.12) {
                hasSeparatedSupports = true;
                break;
              }
            }
          }
          if (hasSeparatedSupports) {
            const terminatedOnly = activeSupps.every(p => p.zTop <= zMinH + 0.35);
            if (terminatedOnly) {
              let anyPreservedCrown = false;
              let crownSeatMin = Infinity;
              for (let s = 0; s < activeSupps.length; s++) {
                const P = activeSupps[s];
                if (shouldPreserveCrownUnderPart(P, C)) {
                  anyPreservedCrown = true;
                  crownSeatMin = Math.min(crownSeatMin, crownSeatingZ(P, C));
                } else {
                  flattenSupportingPodium(P);
                }
              }
              C.effBaseZ = (anyPreservedCrown && Number.isFinite(crownSeatMin))
                ? Math.min(zMinH, crownSeatMin)
                : Math.min(zMinH, Math.min(...activeSupps.map(p => p.zTop)) - 0.02);
            } else {
              C.effBaseZ = zMinH;
            }
            C.effBaseZ = Math.max(C.effBaseZ, C.groundSeatZ !== undefined ? C.groundSeatZ : C.effBaseZ);
            C.zTop = Math.max(C.zTop, C.effBaseZ + 0.25);
            C.isStructurallySupported3D = true;
            C.supportRef = activeSupps[0];
          }
        }

        // 2C. Stepped Arch / Cantilever / Podium Overhang over >= 1 active support
        if (!supportingParts && !C.isStructurallySupported3D && activeSupps.length > 0) {
          const maxOverhang = Math.max(...samples.map(pt =>
            Math.min(...activeSupps.map(K =>
              isPointInsidePart2D(pt[0], pt[1], K, 0)
                ? 0
                : distToPolygonBoundary2D(pt[0], pt[1], K.clippedOuter, K.clippedHoles)
            ))
          ));
          const maxCoreSpan = Math.max(...activeSupps.map(K => K.maxSpan || 0));
          const partThick = Math.max(0.25, C.zTop - zMinH);
          const effMToU = Math.max(1e-4, Number(mToU) || 0.14);
          const maxAllowOverhang = Math.max(
            0.85,
            Math.min(38.0 * effMToU, Math.max(partThick * 1.6, maxCoreSpan * 2.5, 18.0 * effMToU))
          );
          if (maxOverhang <= maxAllowOverhang) {
            const terminatedOnly = activeSupps.every(p => p.zTop <= zMinH + 0.35);
            if (terminatedOnly) {
              let anyPreservedCrown = false;
              let crownSeatMin = Infinity;
              for (let s = 0; s < activeSupps.length; s++) {
                const P = activeSupps[s];
                if (shouldPreserveCrownUnderPart(P, C)) {
                  anyPreservedCrown = true;
                  crownSeatMin = Math.min(crownSeatMin, crownSeatingZ(P, C));
                } else {
                  flattenSupportingPodium(P);
                }
              }
              C.effBaseZ = (anyPreservedCrown && Number.isFinite(crownSeatMin))
                ? Math.min(zMinH, crownSeatMin)
                : Math.min(zMinH, Math.min(...activeSupps.map(p => p.zTop)) - 0.02);
            } else {
              C.effBaseZ = zMinH;
            }
            C.effBaseZ = Math.max(C.effBaseZ, C.groundSeatZ !== undefined ? C.groundSeatZ : C.effBaseZ);
            C.zTop = Math.max(C.zTop, C.effBaseZ + 0.25);
            C.isLateralCantilever = true;
            C.isStructurallySupported3D = true;
            C.supportRef = activeSupps[0];
          }
        }
      }
    }

    if (supportingParts && supportingParts.length > 0 && !C.isLateralCantilever && !C.isStructurallySupported3D) {
      if (supportingParts.length === 1) {
        const P = supportingParts[0];
        if (shouldPreserveCrownUnderPart(P, C)) {
          C.effBaseZ = crownSeatingZ(P, C);
          C.supportRef = P;
          C.isStructurallySupported3D = true;
        } else {
          flattenSupportingPodium(P);
          C.effBaseZ = P.zTop;
          C.supportRef = P;
          C.isStructurallySupported3D = true;
        }
      } else {
        let anyPreservedCrown = false;
        let crownSeatMin = Infinity;
        for (let s = 0; s < supportingParts.length; s++) {
          const P = supportingParts[s];
          if (shouldPreserveCrownUnderPart(P, C)) {
            anyPreservedCrown = true;
            crownSeatMin = Math.min(crownSeatMin, crownSeatingZ(P, C));
          } else {
            flattenSupportingPodium(P);
          }
        }
        C.effBaseZ = (anyPreservedCrown && Number.isFinite(crownSeatMin))
          ? Math.min(crownSeatMin, ...supportingParts.map(p => p.zTop))
          : Math.min(...supportingParts.map(p => p.zTop));
        C.supportRef = supportingParts[0];
        C.isStructurallySupported3D = true;
      }
    }

    // Compute leanTargetPt for skillion auxiliary parts leaning against a taller adjacent core
    if (C.roofShape === 'skillion') {
      const tallerAdj = cluster.filter(p => !p.skip && p !== C && p.zTop > C.zTop + 0.12);
      if (tallerAdj.length > 0) {
        let bestCore = tallerAdj[0], bestDist = Infinity;
        for (let k = 0; k < tallerAdj.length; k++) {
          const d = Math.hypot(tallerAdj[k].cx - C.cx, tallerAdj[k].cy - C.cy);
          if (d < bestDist) { bestDist = d; bestCore = tallerAdj[k]; }
        }
        C.leanTargetPt = [bestCore.cx, bestCore.cy];
      }
    }
  }
}

/**
 * Shared 2-Manifold S3DB / Architectural Landmark Item Emitter used by BOTH
 * synchronous and progressive building pipelines for 100% geometric parity.
 */
function emitSingleS3DBBuildingItem(item, ctx, allocShellId, outTargetList, outBatchArr = null) {
  const b = item.b;
  const { tileCols, tileRows, halfW, halfH } = ctx;
  const isHl = item.clusterHighlighted || !!b.highlighted;
  const targetLayerId = isHl ? 5 : 4;

  if (item.zTop <= item.effBaseZ + 0.04) {
    item.zTop = item.effBaseZ + 0.45;
    item.zEaves = item.zTop;
    item.zRidge = item.zTop;
    item.hasPitched = false;
  } else if (item.zEaves < item.effBaseZ + 0.04) {
    item.zEaves = item.effBaseZ + Math.min(0.25, (item.zTop - item.effBaseZ) * 0.5);
  }

  const groundRefMaxZ = Math.max(item.tZ, item.groundSeatZ !== undefined ? item.groundSeatZ : item.tZ);
  const isElevatedTier = Boolean(item.supportRef || item.isLateralCantilever || item.isStructurallySupported3D || item.effBaseZ > groundRefMaxZ + 0.05);
  const tagElevatedBottom = (t) => {
    if (isElevatedTier && t.n && t.n[2] < -0.5) t.n = [0, 0, -0.49];
  };

  const numTiles = (tileCols || 1) * (tileRows || 1);
  const canSplitTiles = numTiles > 1 && (ctx.isExport || numTiles <= 400) && ctx.tileBounds && typeof splitClosedShellToTileGrid3D === 'function';

  const emitShellTriangles = (subShellTris, fallbackShellId) => {
    for (let ti = 0; ti < subShellTris.length; ti++) {
      subShellTris[ti].shellId = fallbackShellId;
      tagElevatedBottom(subShellTris[ti]);
    }
    if (canSplitTiles) {
      const pieces = splitClosedShellToTileGrid3D(subShellTris, ctx.tileBounds, tileCols, tileRows);
      for (let ti = 0; ti < pieces.length; ti++) {
        tagElevatedBottom(pieces[ti]);
        outTargetList.push(pieces[ti]);
        if (outBatchArr) outBatchArr.push(pieces[ti]);
      }
    } else {
      const cx = (item.minX + item.maxX) * 0.5;
      const cy = (item.minY + item.maxY) * 0.5;
      const tileId = (tileCols <= 1 && tileRows <= 1)
        ? 0
        : (typeof getTileIdForCentroid === 'function' ? getTileIdForCentroid(cx, cy, halfW, halfH, tileCols, tileRows) : 0);
      for (let ti = 0; ti < subShellTris.length; ti++) {
        subShellTris[ti].tileId = tileId;
        tagElevatedBottom(subShellTris[ti]);
        outTargetList.push(subShellTris[ti]);
        if (outBatchArr) outBatchArr.push(subShellTris[ti]);
      }
    }
  };

  let primaryShellId;
  if ((item.archType === 'ferris_wheel' || b.archType === 'ferris_wheel') && typeof emitFerrisWheel3D === 'function') {
    const subShells = emitFerrisWheel3D(item, ctx, targetLayerId, allocShellId);
    primaryShellId = subShells.length > 0 ? subShells[0].shellId : allocShellId();
    for (let si = 0; si < subShells.length; si++) {
      emitShellTriangles(subShells[si].tris, subShells[si].shellId);
    }
  } else {
    primaryShellId = allocShellId();
    const bShell = [];
    extrudeBuildingLoD2(
      item.clippedOuter,
      item.clippedHoles,
      item.effBaseZ,
      item.zEaves,
      item.zRidge,
      item.hasPitched,
      targetLayerId,
      item.pickId,
      bShell,
      0,
      item.roofShape || 'flat',
      {
        scaleMm: ctx.scaleMm,
        supportRef: item.supportRef || null,
        isGroundSeated: !isElevatedTier,
        roofDir: b.roofDir,
        roofOrient: b.roofOrient,
        leanTargetPt: item.leanTargetPt || null
      }
    );
    emitShellTriangles(bShell, primaryShellId);
  }

  item.shellId = primaryShellId;
  return {
    building: b,
    shellId: primaryShellId,
    pickId: item.pickId,
    groupId: item.groupId,
    interiorPt: item.interiorPt,
    samplePts: [item.interiorPt, item.clippedOuter[0], item.clippedOuter[item.clippedOuter.length >> 1]],
    isCantileverSupported: Boolean(item.isLateralCantilever || item.isStructurallySupported3D),
    minX: item.minX,
    maxX: item.maxX,
    minY: item.minY,
    maxY: item.maxY,
    minZ: item.effBaseZ,
    maxZ: item.hasPitched ? item.zRidge : item.zEaves,
    layerId: targetLayerId
  };
}

function buildS3DBBuildingsMesh(scene, ctx, baseInfo, state, meshes) {
  const { mToU, quantizeZUnits } = ctx;
  const { prepared, clusters, pickIdMap } = prepareAndClusterS3DBBuildings(scene, ctx, baseInfo, state);
  const buildingBounds = [];

  // 1. Support-Aware Hierarchical Z-Tier Resolution (0 Floating Bricks!)
  for (const [, cluster] of clusters) {
    resolveS3DBClusterTiers(cluster, mToU, quantizeZUnits);
  }

  // 2. Extrude Watertight 2-Manifold LoD2 Shells & Clip Per Tile
  let nextBldShellId = 1;
  const allocShellId = () => nextBldShellId++;
  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    if (item.skip) continue;
    const isHl = item.clusterHighlighted || !!item.b.highlighted;
    const targetList = isHl ? meshes.highlighted : meshes.buildings;
    buildingBounds.push(emitSingleS3DBBuildingItem(item, ctx, allocShellId, targetList, null));
  }

  return { buildingBounds, pickIdMap };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildS3DBBuildingsMesh, resolveS3DBClusterTiers, emitSingleS3DBBuildingItem };
}
