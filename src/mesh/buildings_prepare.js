// ============================================================================
// src/mesh/buildings_prepare.js
// Coverage-Aware S3DB Outline Filtering, Solid Interior-Point Computation
// (Guaranteed Inside C/L/O-Rings), S3DB Clustering & 16-bit Pick IDs
// ============================================================================

if (typeof triangulateSimplePoly === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
  Object.assign(global, require('../geometry/obb_medial_2d.js'));
}

// Guaranteed interior point of a (possibly concave L/C-shaped or holed O-ring) footprint:
// picks the centroid of the largest 2D ear-clipped triangle!
function computeSolidInteriorPoint2D(outerPts, holesPts) {
  let ring = outerPts;
  if (holesPts && holesPts.length > 0) {
    const merged = mergeHolesIntoOuterKeyhole(outerPts, holesPts);
    if (merged.length >= 3 && isSimplePolygon(merged)) ring = merged;
  }
  const tris = triangulateSimplePoly(ring);
  let bestArea = -1;
  let bestPt = null;
  for (let i = 0; i < tris.length; i++) {
    const [a, b, c] = tris[i];
    const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (area2 > bestArea) {
      bestArea = area2;
      bestPt = [(a[0] + b[0] + c[0]) / 3.0, (a[1] + b[1] + c[1]) / 3.0];
    }
  }
  if (bestPt) return bestPt;
  let cx = 0, cy = 0;
  for (let i = 0; i < outerPts.length; i++) { cx += outerPts[i][0]; cy += outerPts[i][1]; }
  return [cx / (outerPts.length || 1), cy / (outerPts.length || 1)];
}

// Checks whether (px, py) lies inside `part.clippedOuter` (within tol) AND strictly outside all courtyard holes
function isPointInsidePart2D(px, py, part, tol = 0.0) {
  const inOuter = tol > 0
    ? pointInPolyOrNear2D(px, py, part.clippedOuter, tol)
    : pointInPoly2D(px, py, part.clippedOuter);
  if (!inOuter) return false;
  if (part.clippedHoles && part.clippedHoles.length > 0) {
    for (let h = 0; h < part.clippedHoles.length; h++) {
      if (pointInPoly2D(px, py, part.clippedHoles[h])) return false;
    }
  }
  return true;
}

function polygonsOverlap2D(A, B) {
  if (A.maxX <= B.minX + 0.015 || A.minX >= B.maxX - 0.015 || A.maxY <= B.minY + 0.015 || A.minY >= B.maxY - 0.015) {
    return false;
  }
  if (isPointInsidePart2D(B.interiorPt[0], B.interiorPt[1], A, 0)) return true;
  if (isPointInsidePart2D(A.interiorPt[0], A.interiorPt[1], B, 0)) return true;
  for (let i = 0; i < B.clippedOuter.length; i++) {
    const p = B.clippedOuter[i];
    if (isPointInsidePart2D(p[0], p[1], A, 0)) return true;
  }
  for (let i = 0; i < A.clippedOuter.length; i++) {
    const p = A.clippedOuter[i];
    if (isPointInsidePart2D(p[0], p[1], B, 0)) return true;
  }
  for (let i = 0; i < A.clippedOuter.length; i++) {
    const a1 = A.clippedOuter[i], a2 = A.clippedOuter[(i + 1) % A.clippedOuter.length];
    for (let j = 0; j < B.clippedOuter.length; j++) {
      const b1 = B.clippedOuter[j], b2 = B.clippedOuter[(j + 1) % B.clippedOuter.length];
      if (segmentsIntersectProper(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function prepareAndClusterS3DBBuildings(scene, ctx, baseInfo, state) {
  const {
    maxDimMm, scaleMm, halfW, halfH,
    TERRAIN_RES_X, TERRAIN_RES_Y, mToU, baseBottomZ, quantizeZUnits, toBed
  } = ctx;
  const { cellTerracePolys, getActualPrintedSurfaceMinZ } = baseInfo;

  const rawBuildings = scene.buildings || [];
  const pickIdMap = new Map();

  // 1. Non-mutating coverage-aware S3DB parent outline suppression
  const suppressedIdx = new Set();
  const effectiveGid = new Map();
  const inheritedName = new Map();

  const childEntries = [];
  for (let i = 0; i < rawBuildings.length; i++) {
    const b = rawBuildings[i];
    if (b.hidden || b.btype === 'pier') continue;
    if (b.part) {
      const bedPoly = b.outer.map(toBed);
      let cx = 0, cy = 0;
      for (let k = 0; k < bedPoly.length; k++) { cx += bedPoly[k][0]; cy += bedPoly[k][1]; }
      cx /= (bedPoly.length || 1); cy /= (bedPoly.length || 1);
      childEntries.push({ idx: i, b, bedPoly, cx, cy, area: Math.abs(signedArea2D(bedPoly)) });
    }
  }

  for (let i = 0; i < rawBuildings.length; i++) {
    const b = rawBuildings[i];
    if (b.hidden || b.btype === 'pier') continue;
    if (b.isOutline) { suppressedIdx.add(i); continue; }
    if (!b.part && childEntries.length > 0) {
      const bOuterBed = b.outer.map(toBed);
      const bArea = Math.abs(signedArea2D(bOuterBed));
      if (bArea < 1e-4) continue;
      const parentKey = b.osmId || b.id;
      let explicitChild = false;
      let childAreaSum = 0;
      const matchedChildren = [];

      for (let j = 0; j < childEntries.length; j++) {
        const ce = childEntries[j];
        if (ce.b.groupId && (ce.b.groupId === b.id || ce.b.groupId === b.osmId)) {
          explicitChild = true;
          matchedChildren.push(ce);
        } else if (pointInPoly2D(ce.cx, ce.cy, bOuterBed)) {
          childAreaSum += ce.area;
          matchedChildren.push(ce);
        }
      }
      if (explicitChild || childAreaSum >= bArea * 0.30) {
        suppressedIdx.add(i);
        for (let k = 0; k < matchedChildren.length; k++) {
          const mc = matchedChildren[k];
          if (!mc.b.groupId) effectiveGid.set(mc.idx, parentKey);
          if (!mc.b.name && b.name) inheritedName.set(mc.idx, b.name);
        }
      }
    }
  }

  // 2. Prepare footprints, clip to bed frame, compute guaranteed interiorPt, dilate spires >= 0.48mm
  const prepared = [];
  for (let i = 0; i < rawBuildings.length; i++) {
    const b = rawBuildings[i];
    if (b.hidden || b.btype === 'pier' || suppressedIdx.has(i)) continue;
    const rawBedPts = b.outer.map(toBed);
    let uMinX = Infinity, uMaxX = -Infinity, uMinY = Infinity, uMaxY = -Infinity;
    for (let k = 0; k < rawBedPts.length; k++) {
      const p = rawBedPts[k];
      if (p[0] < uMinX) uMinX = p[0]; if (p[0] > uMaxX) uMaxX = p[0];
      if (p[1] < uMinY) uMinY = p[1]; if (p[1] > uMaxY) uMaxY = p[1];
    }
    const unclippedMinSpan = Math.min(uMaxX - uMinX, uMaxY - uMinY);

    let clippedOuter = cleanPolygonRing(clipPolyToBox(rawBedPts, -halfW + 0.38, -halfH + 0.38, halfW - 0.38, halfH - 0.38), true);
    if (clippedOuter.length < 3 || hasSelfTouchingEdge2D(clippedOuter, 1e-4)) continue;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < clippedOuter.length; k++) {
      const p = clippedOuter[k];
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    let minSpan = Math.min(maxX - minX, maxY - minY);
    let area = Math.abs(signedArea2D(clippedOuter));

    const isImportant = Boolean(b.part || b.tower || b.church || b.landmark || (b.h || 0) >= 20 || b.isLandmark);
    const metersPerMm = 1.0 / (mToU * scaleMm);

    // Print-Space Error (PSE) thresholds:
    // Printable wall limit = 0.35 mm on print (~17.5 m in reality at 50 km)
    const minPrintMm = 0.35;
    const minPrintUnits = minPrintMm / scaleMm;

    // Scale-adaptive or user-configured minimum building footprint in meters
    const lodMin = state.lodSettings && (
      typeof state.lodSettings.minBuildingFootprintM === 'number' ? state.lodSettings.minBuildingFootprintM :
      typeof state.lodSettings.minBuildingMeters === 'number' ? state.lodSettings.minBuildingMeters : 0
    );
    const userMinBuildingMeters = lodMin || 0;
    const effectiveMinMeters = Math.max(userMinBuildingMeters, minPrintMm * metersPerMm);

    const footprintSpanMeters = minSpan / mToU;
    const footprintAreaMeters2 = area / (mToU * mToU);

    // 1. Cull unprintable non-landmark micro-footprints
    if (!isImportant) {
      if (minSpan < minPrintUnits ||
          footprintSpanMeters < effectiveMinMeters ||
          footprintAreaMeters2 < (effectiveMinMeters * effectiveMinMeters * 0.65)) {
        continue; // Cull micro-footprint
      }
    } else {
      // Retain landmarks, spires, towers
      if (area < 0.002) continue;
    }

    // 2. Minimum-span dilation: ONLY applied to landmarks/towers/churches!
    // Non-landmarks are NEVER dilated to prevent inflating suburbs into solid blocks at 1:50,000 scale!
    if (isImportant && (minSpan * scaleMm < 0.48)) {
      clippedOuter = cleanPolygonRing(
        clipPolyToBox(dilatePolygonMinSpan2D(clippedOuter, 0.48 / scaleMm), -halfW + 0.38, -halfH + 0.38, halfW - 0.38, halfH - 0.38),
        true
      );
      if (clippedOuter.length < 3 || hasSelfTouchingEdge2D(clippedOuter, 1e-4)) continue;
      minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
      for (let k = 0; k < clippedOuter.length; k++) {
        const p = clippedOuter[k];
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      }
      minSpan = Math.min(maxX - minX, maxY - minY);
      area = Math.abs(signedArea2D(clippedOuter));
      if (minSpan < 0.18 || area < 0.004) continue;
    }

    // Douglas-Peucker tolerance: ~0.10 mm on print (~5 m at 50 km)
    const dpTolMm = 0.10;
    const dpTolUnits = dpTolMm / scaleMm;

    if (clippedOuter.length > 5 && dpTolUnits > 0.005 && typeof simplifyClosedRingDP2D === 'function') {
      const simplified = simplifyClosedRingDP2D(clippedOuter, dpTolUnits);
      if (simplified && simplified.length >= 3 && (typeof isSimplePolygon !== 'function' || isSimplePolygon(simplified))) {
        clippedOuter = cleanPolygonRing(simplified, true);
      }
    }

    const clippedHoles = (b.holes || [])
      .map(h => cleanPolygonRing(clipPolyToBox(h.map(toBed), -halfW + 0.38, -halfH + 0.38, halfW - 0.38, halfH - 0.38), false))
      .filter(h => h.length >= 3);

    const interiorPt = computeSolidInteriorPoint2D(clippedOuter, clippedHoles);

    prepared.push({
      rawIdx: i,
      b,
      displayName: b.name || inheritedName.get(i) || '',
      clippedOuter,
      clippedHoles,
      interiorPt,
      minX, maxX, minY, maxY,
      minSpan,
      area,
      cx: interiorPt[0],
      cy: interiorPt[1],
      groupId: effectiveGid.get(i) || b.groupId || b.osmId || b.id,
      scaledMinH: b.minH || 0,
      skip: false
    });
  }

  // 3. S3DB Clustering (ONLY shared groupId, overlapping parts, or tower-inside-podium; NEVER independent neighbors!)
  const parentCluster = new Int32Array(prepared.length).map((_, idx) => idx);
  const findRoot = (x) => { while (parentCluster[x] !== x) { parentCluster[x] = parentCluster[parentCluster[x]]; x = parentCluster[x]; } return x; };
  const union = (x, y) => { const rx = findRoot(x), ry = findRoot(y); if (rx !== ry) parentCluster[ry] = rx; };

  const byGid = new Map();
  for (let i = 0; i < prepared.length; i++) {
    const gid = prepared[i].groupId;
    if (gid !== undefined && gid !== null) {
      if (byGid.has(gid)) union(byGid.get(gid), i);
      else byGid.set(gid, i);
    }
  }

  for (let i = 0; i < prepared.length; i++) {
    const A = prepared[i];
    for (let j = i + 1; j < prepared.length; j++) {
      const B = prepared[j];
      if (A.maxX <= B.minX + 0.015 || A.minX >= B.maxX - 0.015 || A.maxY <= B.minY + 0.015 || A.minY >= B.maxY - 0.015) continue;
      const aInB = isPointInsidePart2D(A.interiorPt[0], A.interiorPt[1], B, 0) && A.area <= B.area * 0.94;
      const bInA = isPointInsidePart2D(B.interiorPt[0], B.interiorPt[1], A, 0) && B.area <= A.area * 0.94;
      if (aInB || bInA || ((A.b.part || B.b.part) && polygonsOverlap2D(A, B))) {
        union(i, j);
      }
    }
  }

  const clusters = new Map();
  for (let i = 0; i < prepared.length; i++) {
    const r = findRoot(i);
    let cl = clusters.get(r);
    if (!cl) clusters.set(r, cl = []);
    cl.push(prepared[i]);
  }

  // Assign sequential compact 16-bit integer pickId (1 .. K <= 65535 -> 100% exact in IEEE-754 Float32!)
  let nextPickId = 1;
  for (const [, cluster] of clusters) {
    const pickId = nextPickId++;
    let bestNamed = null;
    let maxH = 0;
    let isClusterHl = false;
    let clusterMult = 1.0;

    for (let i = 0; i < cluster.length; i++) {
      const it = cluster[i];
      it.pickId = pickId;
      it.b._pickId = pickId;
      if ((it.b.h || 0) > maxH) maxH = it.b.h || 0;
      if (!bestNamed && it.displayName) bestNamed = it;
      if (it.b.highlighted) isClusterHl = true;
      if (it.b.heightMult && it.b.heightMult !== 1.0) clusterMult = it.b.heightMult;
    }

    const primaryItem = bestNamed || cluster.reduce((best, cur) => ((cur.b.h || 0) > (best.b.h || 0) ? cur : best), cluster[0]);
    if (bestNamed && !primaryItem.b.name && bestNamed.displayName) {
      primaryItem.b.name = bestNamed.displayName;
    }
    for (let i = 0; i < cluster.length; i++) {
      cluster[i].clusterHighlighted = isClusterHl;
      cluster[i].clusterHeightMult = clusterMult;
    }

    pickIdMap.set(pickId, {
      pickId,
      groupId: primaryItem.groupId,
      name: (bestNamed && bestNamed.displayName) || primaryItem.b.name || '',
      maxH,
      primaryBuilding: primaryItem.b,
      buildings: cluster.map(c => c.b)
    });
  }

  // 4. Compute foundation ground pad tZ and exact S3DB heights (b.h = ground-to-ridge total height)
  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    const b = item.b;
    const gxMin = Math.max(0, Math.floor(((item.minX + halfW) / (2 * halfW)) * TERRAIN_RES_X));
    const gxMax = Math.min(TERRAIN_RES_X - 1, Math.floor(((item.maxX + halfW) / (2 * halfW)) * TERRAIN_RES_X));
    const gyMin = Math.max(0, Math.floor(((item.minY + halfH) / (2 * halfH)) * TERRAIN_RES_Y));
    const gyMax = Math.min(TERRAIN_RES_Y - 1, Math.floor(((item.maxY + halfH) / (2 * halfH)) * TERRAIN_RES_Y));

    let minPadZ = getActualPrintedSurfaceMinZ(item.cx, item.cy);
    for (let k = 0; k < item.clippedOuter.length; k++) {
      const pA = item.clippedOuter[k], pB = item.clippedOuter[(k + 1) % item.clippedOuter.length];
      const segLen = Math.hypot(pB[0] - pA[0], pB[1] - pA[1]);
      const steps = Math.max(1, Math.ceil(segLen / 0.45));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const sz = getActualPrintedSurfaceMinZ(pA[0] + (pB[0] - pA[0]) * t, pA[1] + (pB[1] - pA[1]) * t);
        if (sz < minPadZ) minPadZ = sz;
      }
    }

    const polyOverlapsTerrace = (tpPoly) => {
      if (pointInPolyOrNear2D(item.cx, item.cy, tpPoly, 0.015)) return true;
      for (let v = 0; v < item.clippedOuter.length; v++) {
        if (pointInPolyOrNear2D(item.clippedOuter[v][0], item.clippedOuter[v][1], tpPoly, 0.015)) return true;
      }
      for (let v = 0; v < tpPoly.length; v++) {
        if (isPointInsidePart2D(tpPoly[v][0], tpPoly[v][1], item, 0.015)) return true;
      }
      for (let a = 0; a < item.clippedOuter.length; a++) {
        const a1 = item.clippedOuter[a], a2 = item.clippedOuter[(a + 1) % item.clippedOuter.length];
        for (let c = 0; c < tpPoly.length; c++) {
          if (segmentsIntersectProper(a1, a2, tpPoly[c], tpPoly[(c + 1) % tpPoly.length])) return true;
        }
      }
      return false;
    };

    for (let gy = gyMin; gy <= gyMax; gy++) {
      for (let gx = gxMin; gx <= gxMax; gx++) {
        const tList = cellTerracePolys[gy * TERRAIN_RES_X + gx];
        for (let t = 0; t < tList.length; t++) {
          const tp = tList[t];
          if (tp.zSurf < minPadZ && polyOverlapsTerrace(tp.poly)) {
            minPadZ = tp.zSurf;
          }
        }
      }
    }

    let roofShape = b.roof || 'flat';
    if ((roofShape === 'dome' || roofShape === 'onion' || roofShape === 'pyramidal' || roofShape === 'cone') &&
        (item.clippedHoles.length > 0 || !isStarShapedFromCentroid(item.clippedOuter))) {
      roofShape = 'hipped';
    }

    const hMult = (item.clusterHeightMult || b.heightMult || 1.0) * (state.zScale || 1.0);
    const totalHMm = Math.max(0.95, (b.h || 6.0) * mToU * hMult);
    const isSpireRoof = (roofShape === 'dome' || roofShape === 'onion' || ((b.tower || b.church) && (roofShape === 'pyramidal' || roofShape === 'cone')));

    let roofHMm = (roofShape !== 'flat') ? Math.max(0.28, (b.roofH || 3.2) * mToU * hMult) : 0;
    if (isSpireRoof) {
      roofHMm = Math.min(roofHMm, item.minSpan * 1.45, totalHMm * 0.65);
    } else {
      roofHMm = Math.min(roofHMm, item.minSpan * 0.44, totalHMm * 0.40);
    }
    const roofPrintMm = roofHMm * scaleMm;
    const minSpanPrintMm = item.minSpan * scaleMm;
    // If physical roof pitch < 0.15 mm on print, or building print span < 0.8 mm, fall back to flat LoD1
    const hasPitched = (roofShape !== 'flat' && roofPrintMm >= 0.15 && minSpanPrintMm >= 0.80);
    if (!hasPitched) {
      roofShape = 'flat';
      roofHMm = 0;
    }

    const tZ = minPadZ;
    const zTop = quantizeZUnits(tZ + totalHMm);
    const zEaves = hasPitched ? quantizeZUnits(Math.max(tZ + 0.55, zTop - roofHMm)) : zTop;
    const zRidge = hasPitched ? Math.max(zEaves + 0.14, zTop) : zEaves;

    item.tZ = tZ;
    item.effBaseZ = tZ;
    item.roofShape = roofShape;
    item.hMult = hMult;
    item.totalHMm = totalHMm;
    item.roofHMm = roofHMm;
    item.hasPitched = hasPitched;
    item.zEaves = zEaves;
    item.zRidge = zRidge;
    item.zTop = zRidge;
  }

  // Scene-wide skyscraper envelope scaling so Anycubic Photon Mono 4 Z limit (<= 165 mm) is respected
  const maxAllowedZMm = Math.min(state.isResin ? 140.0 : 160.0, Math.max(48.0, maxDimMm * 0.34));
  const maxAllowedTopUnits = maxAllowedZMm / scaleMm;
  let maxRawTopUnits = 0, maxBuildingBaseTZ = baseBottomZ;
  for (let i = 0; i < prepared.length; i++) {
    if (prepared[i].zTop > maxRawTopUnits) {
      maxRawTopUnits = prepared[i].zTop;
      maxBuildingBaseTZ = prepared[i].tZ;
    }
  }
  if (maxRawTopUnits > maxAllowedTopUnits && maxRawTopUnits > maxBuildingBaseTZ + 0.5) {
    const skylineScale = (maxAllowedTopUnits - maxBuildingBaseTZ) / (maxRawTopUnits - maxBuildingBaseTZ);
    for (let i = 0; i < prepared.length; i++) {
      const item = prepared[i];
      item.totalHMm *= skylineScale;
      item.roofHMm *= skylineScale;
      item.scaledMinH *= skylineScale;
      const zTop = quantizeZUnits(item.tZ + Math.max(0.85, item.totalHMm));
      const zEaves = item.hasPitched ? quantizeZUnits(Math.max(item.tZ + 0.50, zTop - item.roofHMm)) : zTop;
      item.zEaves = zEaves;
      item.zRidge = item.hasPitched ? Math.max(zEaves + 0.12, zTop) : zEaves;
      item.zTop = item.zRidge;
    }
  }

  return { prepared, clusters, pickIdMap };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeSolidInteriorPoint2D,
    isPointInsidePart2D,
    polygonsOverlap2D,
    prepareAndClusterS3DBBuildings
  };
}
