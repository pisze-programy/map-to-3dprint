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

function buildS3DBBuildingsMesh(scene, ctx, baseInfo, state, meshes) {
  const { tileCols, tileRows, mToU, tileBounds, quantizeZUnits, halfW, halfH } = ctx;
  const { prepared, clusters, pickIdMap } = prepareAndClusterS3DBBuildings(scene, ctx, baseInfo, state);
  const buildingBounds = [];

  // 1. Support-Aware Hierarchical Z-Tier Resolution (0 Floating Bricks!)
  for (const [, cluster] of clusters) {
    if (cluster.length <= 1) continue;
    cluster.sort((a, b) => (a.zTop - b.zTop) || (b.area - a.area));

    // Suppress strictly contained equal-height duplicates & submerged interior shells
    for (let i = 0; i < cluster.length; i++) {
      const C = cluster[i];
      if (C.skip) continue;
      for (let j = 0; j < cluster.length; j++) {
        if (i === j || cluster[j].skip) continue;
        const P = cluster[j];
        if (Math.abs(C.zTop - P.zTop) < 0.04 && C.area <= P.area * 1.01) {
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

    const flattenSupportingPodium = (P) => {
      P.roofShape = 'flat';
      P.hasPitched = false;
      P.zRidge = P.zEaves;
      P.zTop = P.zEaves;
      // Keep any earlier tier resting on P synced if P's pitched roof was lowered to zEaves
      for (let m = 0; m < cluster.length; m++) {
        if (cluster[m].supportRef === P) cluster[m].effBaseZ = P.zTop;
      }
    };

    for (let i = 0; i < cluster.length; i++) {
      const C = cluster[i];
      if (C.skip) continue;
      const lower = cluster.filter((p, idx) => idx < i && !p.skip && p.zTop < C.zTop - 0.05);

      const samples = [];
      for (let k = 0; k < C.clippedOuter.length; k++) {
        const p1 = C.clippedOuter[k], p2 = C.clippedOuter[(k + 1) % C.clippedOuter.length];
        samples.push(p1, [(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5]);
      }

      // Helper: snaps <= 0.03-unit OSM digitization jitter of upper tier C strictly inside podium P
      const clampChildRingIntoPodium = (child, P) => {
        if (P.clippedHoles && P.clippedHoles.length > 0) {
          if (!samples.every(pt => isPointInsidePart2D(pt[0], pt[1], P, 0.0))) return false;
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

      // Case 1: Strict concentric setback promotion onto a lower podium roof
      let supportingParts = null;
      if (lower.length > 0) {
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

      // Case 2: Explicit S3DB min_height > 0 (skybridge, cantilever, or upper tier)
      if (!supportingParts && C.scaledMinH > 0.02) {
        const zMinH = quantizeZUnits(C.tZ + C.scaledMinH * mToU * C.hMult);
        if (zMinH < C.zTop - 0.12) {
          const vertSupps = lower.filter(p => p.zEaves >= zMinH - 0.12 && polygonsOverlap2D(C, p));
          let singleBest = null, singleBestDiff = Infinity;
          for (let s = 0; s < vertSupps.length; s++) {
            const P = vertSupps[s];
            if (!isPointInsidePart2D(C.interiorPt[0], C.interiorPt[1], P, 0.030)) continue;
            if (samples.every(pt => isPointInsidePart2D(pt[0], pt[1], P, 0.030))) {
              const diff = Math.abs(P.zEaves - zMinH);
              if (diff < singleBestDiff) { singleBestDiff = diff; singleBest = P; }
            }
          }

          if (singleBest && clampChildRingIntoPodium(C, singleBest)) {
            supportingParts = [singleBest];
          } else if (vertSupps.length >= 2 && vertSupps.some(P => isPointInsidePart2D(C.interiorPt[0], C.interiorPt[1], P, 0.005))) {
            if (samples.every(pt => vertSupps.some(P => isPointInsidePart2D(pt[0], pt[1], P, 0.002)))) {
              supportingParts = vertSupps;
            }
          }

          if (!supportingParts) {
            // Printable lateral cantilever anchored into a taller solid core K
            const cores = cluster.filter(p => !p.skip && p !== C && p.effBaseZ <= C.tZ + 0.08 && p.zTop >= zMinH + 0.20 && polygonsOverlap2D(C, p));
            if (cores.length > 0) {
              const maxOverhang = Math.max(...samples.map(pt =>
                Math.min(...cores.map(K => isPointInsidePart2D(pt[0], pt[1], K, 0) ? 0 : distToPolygonBoundary2D(pt[0], pt[1], K.clippedOuter, K.clippedHoles)))
              ));
              if (maxOverhang <= 0.65) {
                C.effBaseZ = zMinH;
                C.isLateralCantilever = true;
              }
            }
          }
        }
      }

      if (supportingParts && supportingParts.length > 0 && !C.isLateralCantilever) {
        if (supportingParts.length === 1) {
          const P = supportingParts[0];
          if ((P.roofShape === 'dome' || P.roofShape === 'onion') && C.area <= P.area * 0.48) {
            C.effBaseZ = P.zEaves + (P.zRidge - P.zEaves) * 0.22;
            C.supportRef = P;
          } else {
            flattenSupportingPodium(P);
            C.effBaseZ = P.zTop;
            C.supportRef = P;
          }
        } else {
          for (let s = 0; s < supportingParts.length; s++) flattenSupportingPodium(supportingParts[s]);
          C.effBaseZ = Math.min(...supportingParts.map(p => p.zTop));
          C.supportRef = supportingParts[0];
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

  // 2. Extrude Watertight 2-Manifold LoD2 Shells & Clip Per Tile
  let nextBldShellId = 1;
  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    if (item.skip) continue;
    const b = item.b;

    const isHl = item.clusterHighlighted || !!b.highlighted;
    const targetLayerId = isHl ? 5 : 4;
    const targetList = isHl ? meshes.highlighted : meshes.buildings;

    if (item.zTop <= item.effBaseZ + 0.04) {
      item.zTop = item.effBaseZ + 0.45;
      item.zEaves = item.zTop;
      item.zRidge = item.zTop;
      item.hasPitched = false;
    } else if (item.zEaves < item.effBaseZ + 0.04) {
      item.zEaves = item.effBaseZ + Math.min(0.25, (item.zTop - item.effBaseZ) * 0.5);
    }

    const groundRefMaxZ = Math.max(item.tZ, item.groundSeatZ !== undefined ? item.groundSeatZ : item.tZ);
    const isElevatedTier = Boolean(item.supportRef || item.isLateralCantilever || item.effBaseZ > groundRefMaxZ + 0.05);

    const bShell = [];
    const shellId = nextBldShellId++;

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

    const tagElevatedBottom = (t) => {
      if (isElevatedTier && t.n && t.n[2] < -0.5) {
        t.n = [0, 0, -0.49];
      }
    };

    for (let ti = 0; ti < bShell.length; ti++) {
      bShell[ti].shellId = shellId;
      tagElevatedBottom(bShell[ti]);
    }

    const numTiles = (tileCols || 1) * (tileRows || 1);
    if (numTiles > 1 && (ctx.isExport || numTiles <= 400) && ctx.tileBounds && typeof splitClosedShellToTileGrid3D === 'function') {
      const pieces = splitClosedShellToTileGrid3D(bShell, ctx.tileBounds, tileCols, tileRows);
      for (let ti = 0; ti < pieces.length; ti++) {
        tagElevatedBottom(pieces[ti]);
        targetList.push(pieces[ti]);
      }
    } else {
      const cx = (item.minX + item.maxX) * 0.5;
      const cy = (item.minY + item.maxY) * 0.5;
      const tileId = (tileCols <= 1 && tileRows <= 1)
        ? 0
        : (typeof getTileIdForCentroid === 'function' ? getTileIdForCentroid(cx, cy, halfW, halfH, tileCols, tileRows) : 0);

      for (let ti = 0; ti < bShell.length; ti++) {
        bShell[ti].tileId = tileId;
        tagElevatedBottom(bShell[ti]);
        targetList.push(bShell[ti]);
      }
    }

    buildingBounds.push({
      building: b,
      shellId,
      pickId: item.pickId,
      groupId: item.groupId,
      interiorPt: item.interiorPt,
      samplePts: [item.interiorPt, item.clippedOuter[0], item.clippedOuter[item.clippedOuter.length >> 1]],
      isCantileverSupported: !!item.isLateralCantilever,
      minX: item.minX, maxX: item.maxX,
      minY: item.minY, maxY: item.maxY,
      minZ: item.effBaseZ, maxZ: item.hasPitched ? item.zRidge : item.zEaves,
      layerId: targetLayerId
    });
  }

  return { buildingBounds, pickIdMap };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildS3DBBuildingsMesh };
}
