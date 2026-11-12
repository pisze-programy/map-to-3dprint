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
// picks the centroid of the largest 2D ear-clipped triangle strictly outside all holes,
// with horizontal scanline chord-midpoint fallback when a keyhole ring is non-simple!
function computeSolidInteriorPoint2D(outerPts, holesPts) {
  if (!outerPts || outerPts.length === 0) return [0, 0];
  const validHoles = (holesPts || []).filter(h => h && h.length >= 3);
  const inAnyHole = (px, py) => {
    for (let h = 0; h < validHoles.length; h++) {
      if (pointInPoly2D(px, py, validHoles[h])) return true;
    }
    return false;
  };

  let ring = outerPts;
  if (validHoles.length > 0) {
    const merged = mergeHolesIntoOuterKeyhole(outerPts, validHoles);
    if (merged.length >= 3 && isSimplePolygon(merged)) ring = merged;
  }
  const tris = triangulateSimplePoly(ring);
  let bestArea = -1;
  let bestPt = null;
  for (let i = 0; i < tris.length; i++) {
    const [a, b, c] = tris[i];
    const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (area2 > bestArea) {
      const mx = (a[0] + b[0] + c[0]) / 3.0;
      const my = (a[1] + b[1] + c[1]) / 3.0;
      if (pointInPoly2D(mx, my, outerPts) && !inAnyHole(mx, my)) {
        bestArea = area2;
        bestPt = [mx, my];
      }
    }
  }
  if (bestPt) return bestPt;

  // Scanline chord-midpoint fallback (exact for O-rings & concave polygons even if keyhole failed)
  const ys = [];
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < outerPts.length; i++) {
    const y = outerPts[i][1];
    ys.push(y);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  for (let h = 0; h < validHoles.length; h++) {
    for (let i = 0; i < validHoles[h].length; i++) ys.push(validHoles[h][i][1]);
  }
  ys.sort((a, b) => a - b);
  const yMids = [];
  for (let i = 0; i < ys.length - 1; i++) {
    if (ys[i + 1] - ys[i] > 1e-5) yMids.push((ys[i] + ys[i + 1]) * 0.5);
  }
  if (maxY - minY > 1e-5) {
    for (let k = 1; k <= 7; k++) yMids.push(minY + (maxY - minY) * (k / 8));
  }
  const scanYs = yMids.length <= 28
    ? yMids
    : Array.from({ length: 28 }, (_, idx) => yMids[Math.floor((idx * yMids.length) / 28)]);

  let bestChord = -1;
  const collectHits = (loop, yScan, xs) => {
    for (let i = 0, n = loop.length; i < n; i++) {
      const a = loop[i], b = loop[(i + 1) % n];
      if ((a[1] > yScan) !== (b[1] > yScan)) {
        xs.push(a[0] + (yScan - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
    }
  };
  for (let si = 0; si < scanYs.length; si++) {
    const yScan = scanYs[si];
    const xs = [];
    collectHits(outerPts, yScan, xs);
    for (let h = 0; h < validHoles.length; h++) collectHits(validHoles[h], yScan, xs);
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k < xs.length - 1; k++) {
      const w = xs[k + 1] - xs[k];
      if (w <= bestChord || w <= 1e-5) continue;
      const xm = (xs[k] + xs[k + 1]) * 0.5;
      if (pointInPoly2D(xm, yScan, outerPts) && !inAnyHole(xm, yScan)) {
        bestChord = w;
        bestPt = [xm, yScan];
      }
    }
  }
  if (bestPt) return bestPt;

  let cx = 0, cy = 0;
  for (let i = 0; i < outerPts.length; i++) { cx += outerPts[i][0]; cy += outerPts[i][1]; }
  cx /= (outerPts.length || 1); cy /= (outerPts.length || 1);
  if (pointInPoly2D(cx, cy, outerPts) && !inAnyHole(cx, cy)) return [cx, cy];
  return [outerPts[0][0], outerPts[0][1]];
}

// Sanitizes courtyard holes against clippedOuter so grazing/simplified OSM inner rings
// stay strictly interior and never trigger keyhole drop in extrudeBuildingLoD2.
function sanitizeBuildingHoles2D(clippedOuter, rawClippedHoles) {
  if (!rawClippedHoles || rawClippedHoles.length === 0 || !clippedOuter || clippedOuter.length < 3) return [];
  const outerArea = Math.abs(signedArea2D(clippedOuter));
  if (outerArea < 1e-4) return [];

  const nearestOuterBoundaryPt = (px, py) => {
    let bestX = px, bestY = py, bestDSq = Infinity;
    for (let e = 0, n = clippedOuter.length; e < n; e++) {
      const a = clippedOuter[e], b = clippedOuter[(e + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const lenSq = dx * dx + dy * dy;
      const t = lenSq > 1e-12 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / lenSq)) : 0;
      const qx = a[0] + t * dx, qy = a[1] + t * dy;
      const dSq = (px - qx) * (px - qx) + (py - qy) * (py - qy);
      if (dSq < bestDSq) { bestDSq = dSq; bestX = qx; bestY = qy; }
    }
    return [bestX, bestY, bestDSq];
  };

  const candidates = [];
  for (let hi = 0; hi < rawClippedHoles.length; hi++) {
    let h = rawClippedHoles[hi];
    if (!h || h.length < 3) continue;
    let hArea = Math.abs(signedArea2D(h));
    if (hArea < 0.01 || hArea >= outerArea * 0.985) continue;

    const hIp = computeSolidInteriorPoint2D(h, []);
    if (!pointInPoly2D(hIp[0], hIp[1], clippedOuter)) continue;

    let needsClamp = false;
    for (let v = 0; v < h.length; v++) {
      const pt = h[v];
      if (!pointInPoly2D(pt[0], pt[1], clippedOuter) || nearestOuterBoundaryPt(pt[0], pt[1])[2] < 4e-4) {
        needsClamp = true;
        break;
      }
    }

    if (needsClamp) {
      const clamped = h.map(pt => {
        const inside = pointInPoly2D(pt[0], pt[1], clippedOuter);
        const [bx, by, dSq] = nearestOuterBoundaryPt(pt[0], pt[1]);
        if (inside && dSq >= 4e-4) return pt;
        const baseX = inside ? pt[0] : bx;
        const baseY = inside ? pt[1] : by;
        const vx = hIp[0] - baseX, vy = hIp[1] - baseY;
        const vLen = Math.hypot(vx, vy);
        if (vLen <= 1e-6) return [baseX, baseY];
        const pull = Math.min(0.032, vLen * 0.35);
        return [baseX + (vx / vLen) * pull, baseY + (vy / vLen) * pull];
      });
      const cleaned = cleanPolygonRing(clamped, false);
      if (cleaned.length < 3 || !isSimplePolygon(cleaned) || !cleaned.every(p => pointInPoly2D(p[0], p[1], clippedOuter))) {
        continue;
      }
      h = cleaned;
      hArea = Math.abs(signedArea2D(h));
      if (hArea < 0.01) continue;
    }

    candidates.push({ h, area: hArea, ip: hIp });
  }

  if (candidates.length === 0) return [];
  candidates.sort((a, b) => b.area - a.area);

  // Drop duplicate/nested holes and verify keyhole simplicity incrementally
  const accepted = [];
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    if (accepted.some(prev => pointInPoly2D(cand.ip[0], cand.ip[1], prev))) continue;
    const trial = accepted.concat([cand.h]);
    const merged = mergeHolesIntoOuterKeyhole(clippedOuter, trial);
    if (merged.length >= 3 && isSimplePolygon(merged)) {
      accepted.push(cand.h);
    } else if (typeof insetPolygonCentroid === 'function') {
      const insetH = cleanPolygonRing(insetPolygonCentroid(cand.h, 0.028), false);
      if (insetH.length >= 3 && insetH.every(p => pointInPoly2D(p[0], p[1], clippedOuter))) {
        const trialInset = accepted.concat([insetH]);
        const mergedInset = mergeHolesIntoOuterKeyhole(clippedOuter, trialInset);
        if (mergedInset.length >= 3 && isSimplePolygon(mergedInset)) {
          accepted.push(insetH);
        }
      }
    }
  }
  return accepted;
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
      if (bedPoly.length < 3) continue;
      const holesBed = (b.holes || []).map(h => h.map(toBed)).filter(h => h.length >= 3);
      const interiorPt = computeSolidInteriorPoint2D(bedPoly, holesBed);
      let cMinX = Infinity, cMaxX = -Infinity, cMinY = Infinity, cMaxY = -Infinity;
      for (let k = 0; k < bedPoly.length; k++) {
        const p = bedPoly[k];
        if (p[0] < cMinX) cMinX = p[0]; if (p[0] > cMaxX) cMaxX = p[0];
        if (p[1] < cMinY) cMinY = p[1]; if (p[1] > cMaxY) cMaxY = p[1];
      }
      const outerArea = Math.abs(signedArea2D(bedPoly));
      const holesArea = holesBed.reduce((acc, h) => acc + ( pointInPoly2D(computeSolidInteriorPoint2D(h, [])[0], computeSolidInteriorPoint2D(h, [])[1], bedPoly) ? Math.abs(signedArea2D(h)) : 0 ), 0);
      const netArea = Math.max(1e-4, outerArea - holesArea);
      childEntries.push({
        idx: i,
        b,
        bedPoly,
        holesBed,
        interiorPt,
        cx: interiorPt[0],
        cy: interiorPt[1],
        bbox: [cMinX, cMinY, cMaxX, cMaxY],
        area: netArea,
        minH: b.minH || 0
      });
    }
  }

  for (let i = 0; i < rawBuildings.length; i++) {
    const b = rawBuildings[i];
    if (b.hidden || b.btype === 'pier') continue;
    if (b.isOutline) { suppressedIdx.add(i); continue; }
    if (!b.part && childEntries.length > 0) {
      const bOuterBed = b.outer.map(toBed);
      const bOuterArea = Math.abs(signedArea2D(bOuterBed));
      if (bOuterArea < 1e-4) continue;
      let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
      for (let k = 0; k < bOuterBed.length; k++) {
        const p = bOuterBed[k];
        if (p[0] < bMinX) bMinX = p[0]; if (p[0] > bMaxX) bMaxX = p[0];
        if (p[1] < bMinY) bMinY = p[1]; if (p[1] > bMaxY) bMaxY = p[1];
      }
      const bHolesBed = (b.holes || []).map(h => h.map(toBed)).filter(h => {
        if (h.length < 3) return false;
        const hip = computeSolidInteriorPoint2D(h, []);
        return pointInPoly2D(hip[0], hip[1], bOuterBed);
      });
      const bHolesArea = bHolesBed.reduce((acc, h) => acc + Math.abs(signedArea2D(h)), 0);
      const bNetArea = Math.max(1e-4, bOuterArea - bHolesArea);
      const parentKey = b.osmId || b.id;

      let childAreaSum = 0;
      let groundChildAreaSum = 0;
      let groundChildCount = 0;
      const matchedChildren = [];

      for (let j = 0; j < childEntries.length; j++) {
        const ce = childEntries[j];
        const [cMinX, cMinY, cMaxX, cMaxY] = ce.bbox;
        const bboxOverlaps = !(cMinX > bMaxX + 0.25 || cMaxX < bMinX - 0.25 || cMinY > bMaxY + 0.25 || cMaxY < bMinY - 0.25);
        if (!bboxOverlaps) continue;

        const [pix, piy] = ce.interiorPt;
        const inHole = bHolesBed.some(h => pointInPoly2D(pix, piy, h));
        let matched = false;
        if (ce.b.groupId && (ce.b.groupId === b.id || ce.b.groupId === b.osmId) && !inHole) {
          matched = true;
        } else if (!inHole && pointInPoly2D(pix, piy, bOuterBed)) {
          matched = true;
        } else if (!inHole) {
          let inCnt = 0;
          const nPts = ce.bedPoly.length;
          for (let k = 0; k < nPts; k++) {
            const a = ce.bedPoly[k];
            const vx = a[0] + (pix - a[0]) * 1e-3, vy = a[1] + (piy - a[1]) * 1e-3;
            if (pointInPoly2D(vx, vy, bOuterBed) && !bHolesBed.some(h => pointInPoly2D(vx, vy, h))) inCnt++;
          }
          if (nPts > 0 && inCnt >= nPts * 0.55) matched = true;
        }

        if (matched) {
          childAreaSum += ce.area;
          if (ce.minH <= 3.5) {
            groundChildAreaSum += ce.area;
            groundChildCount++;
          }
          matchedChildren.push(ce);
        }
      }

      if (matchedChildren.length > 0) {
        for (let k = 0; k < matchedChildren.length; k++) {
          const mc = matchedChildren[k];
          if (!mc.b.groupId) effectiveGid.set(mc.idx, parentKey);
          if (!mc.b.name && b.name) inheritedName.set(mc.idx, b.name);
        }
        const groundCov = groundChildAreaSum / bNetArea;
        const totalCov = childAreaSum / bNetArea;
        const holelessMultiWing = bHolesBed.length === 0 && groundChildCount >= 2 && groundCov >= 0.16;
        if (groundCov >= 0.28 || totalCov >= 0.34 || holelessMultiWing) {
          suppressedIdx.add(i);
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
      if (minSpan < Math.min(0.18, 0.35 / scaleMm) || area < Math.min(0.004, 0.10 / (scaleMm * scaleMm))) continue;
    }

    // Douglas-Peucker tolerance: ~0.10 mm on print (~5 m at 50 km)
    const dpTolMm = 0.10;
    const dpTolUnits = dpTolMm / scaleMm;

    if (clippedOuter.length > 5 && dpTolUnits > 0.005 && (!b.holes || b.holes.length === 0) && typeof simplifyClosedRingDP2D === 'function') {
      const simplified = simplifyClosedRingDP2D(clippedOuter, dpTolUnits);
      if (simplified && simplified.length >= 3) {
        const cleanedSimp = cleanPolygonRing(simplified, true);
        if (cleanedSimp.length >= 3 && (typeof isSimplePolygon !== 'function' || isSimplePolygon(cleanedSimp)) && !hasSelfTouchingEdge2D(cleanedSimp, 1e-4)) {
          clippedOuter = cleanedSimp;
        }
      }
    }

    const rawClippedHoles = (b.holes || [])
      .map(h => cleanPolygonRing(clipPolyToBox(h.map(toBed), -halfW + 0.38, -halfH + 0.38, halfW - 0.38, halfH - 0.38), false))
      .filter(h => h.length >= 3);
    const clippedHoles = sanitizeBuildingHoles2D(clippedOuter, rawClippedHoles);

    const interiorPt = computeSolidInteriorPoint2D(clippedOuter, clippedHoles);
    const maxSpan = Math.max(maxX - minX, maxY - minY);

    prepared.push({
      rawIdx: i,
      b,
      displayName: b.name || inheritedName.get(i) || '',
      clippedOuter,
      clippedHoles,
      interiorPt,
      minX, maxX, minY, maxY,
      minSpan,
      maxSpan,
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

  // 4. Compute foundation ground pad tZ, slope foundation seating effBaseZ, and exact S3DB heights
  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    const b = item.b;
    const gxMin = Math.max(0, Math.floor(((item.minX + halfW) / (2 * halfW)) * TERRAIN_RES_X));
    const gxMax = Math.min(TERRAIN_RES_X - 1, Math.floor(((item.maxX + halfW) / (2 * halfW)) * TERRAIN_RES_X));
    const gyMin = Math.max(0, Math.floor(((item.minY + halfH) / (2 * halfH)) * TERRAIN_RES_Y));
    const gyMax = Math.min(TERRAIN_RES_Y - 1, Math.floor(((item.maxY + halfH) / (2 * halfH)) * TERRAIN_RES_Y));

    const centerSurfZ = getActualPrintedSurfaceMinZ(item.cx, item.cy);
    let minPadZ = centerSurfZ;
    let maxPadZ = centerSurfZ;

    const hasRawDemSampler = Boolean(ctx && ctx.isTopographicRelief && typeof ctx.sampleRawTerrainGridZ === 'function');
    const rawFloorClamp = (ctx && ctx.zSubWater !== undefined) ? ctx.zSubWater : (0.40 / scaleMm);

    const sampleFootprintTerrainZ = (px, py) => {
      const sz = getActualPrintedSurfaceMinZ(px, py);
      if (sz < minPadZ) minPadZ = sz;
      if (sz > maxPadZ) maxPadZ = sz;
      if (hasRawDemSampler) {
        const isWet = Boolean(ctx.waterMask && typeof ctx.sampleMaskIdx === 'function' && ctx.waterMask[ctx.sampleMaskIdx(px, py)]);
        if (!isWet) {
          const rz = ctx.sampleRawTerrainGridZ(px, py);
          if (Number.isFinite(rz) && rz >= rawFloorClamp && rz < minPadZ) minPadZ = rz;
        }
      }
    };

    for (let k = 0; k < item.clippedOuter.length; k++) {
      const pA = item.clippedOuter[k], pB = item.clippedOuter[(k + 1) % item.clippedOuter.length];
      const segLen = Math.hypot(pB[0] - pA[0], pB[1] - pA[1]);
      const steps = Math.max(1, Math.ceil(segLen / 0.30));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        sampleFootprintTerrainZ(pA[0] + (pB[0] - pA[0]) * t, pA[1] + (pB[1] - pA[1]) * t);
      }
    }

    for (let h = 0; h < item.clippedHoles.length; h++) {
      const hole = item.clippedHoles[h];
      for (let k = 0; k < hole.length; k++) {
        const pA = hole[k], pB = hole[(k + 1) % hole.length];
        sampleFootprintTerrainZ(pA[0], pA[1]);
        sampleFootprintTerrainZ((pA[0] + pB[0]) * 0.5, (pA[1] + pB[1]) * 0.5);
      }
    }

    const gridStep = Math.max(0.35, Math.min((ctx && ctx.cellStepX) || 0.65, 0.65));
    if (item.maxX - item.minX > gridStep || item.maxY - item.minY > gridStep) {
      const nx = Math.min(12, Math.max(1, Math.floor((item.maxX - item.minX) / gridStep)));
      const ny = Math.min(12, Math.max(1, Math.floor((item.maxY - item.minY) / gridStep)));
      for (let iy = 1; iy <= ny; iy++) {
        const py = item.minY + ((item.maxY - item.minY) * iy) / (ny + 1);
        for (let ix = 1; ix <= nx; ix++) {
          const px = item.minX + ((item.maxX - item.minX) * ix) / (nx + 1);
          if (isPointInsidePart2D(px, py, item, 0)) {
            sampleFootprintTerrainZ(px, py);
          }
        }
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
        if (!tList) continue;
        for (let t = 0; t < tList.length; t++) {
          const tp = tList[t];
          if ((tp.zSurf < minPadZ || tp.zSurf > maxPadZ) && polyOverlapsTerrace(tp.poly)) {
            if (tp.zSurf < minPadZ) minPadZ = tp.zSurf;
            if (tp.zSurf > maxPadZ) maxPadZ = tp.zSurf;
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

    const slopeSpan = Math.max(0, maxPadZ - minPadZ);
    const hasSlope = Boolean((ctx && ctx.isTopographicRelief) || slopeSpan > 1e-3);
    let effBaseZ = minPadZ;
    if (hasSlope) {
      const embedDepth = Math.min(0.30 / scaleMm, Math.max(0.15 / scaleMm, slopeSpan * 0.12));
      const minSafeFloorZ = Math.min(
        minPadZ,
        Math.max(0.15 / scaleMm, (ctx && ctx.zDrainVault !== undefined) ? (ctx.zDrainVault + 0.15 / scaleMm) : (0.40 / scaleMm))
      );
      effBaseZ = quantizeZUnits(Math.max(minSafeFloorZ, minPadZ - embedDepth));
    }

    const tZ = slopeSpan > 1e-3
      ? Math.min(maxPadZ, Math.max(centerSurfZ, maxPadZ - totalHMm * 0.45))
      : minPadZ;
    const zTop = quantizeZUnits(tZ + totalHMm);
    const zEaves = hasPitched ? quantizeZUnits(Math.max(tZ + 0.55, zTop - roofHMm)) : zTop;
    const zRidge = hasPitched ? Math.max(zEaves + 0.14, zTop) : zEaves;

    item.tZ = tZ;
    item.effBaseZ = effBaseZ;
    item.groundSeatZ = effBaseZ;
    item.roofShape = roofShape;
    item.hMult = hMult;
    item.totalHMm = totalHMm;
    item.roofHMm = roofHMm;
    item.hasPitched = hasPitched;
    item.zEaves = zEaves;
    item.zRidge = zRidge;
    item.zTop = zRidge;
  }

  // M6.2: Printer Z-Axis Height Cap Protection with C1-continuous soft compression
  const bedZ = (state && state.bedZ) || (ctx && ctx.bedZ) || (typeof PRINT_PROFILES !== 'undefined' && PRINT_PROFILES[state && state.printerProfileId] && PRINT_PROFILES[state.printerProfileId].bedZ) || 165.0;
  const maxSafeZMm = Math.max(20.0, bedZ - 2.0); // e.g. 163.0 mm on Mono 4

  let maxRawTopUnits = 0;
  for (let i = 0; i < prepared.length; i++) {
    if (prepared[i].zTop > maxRawTopUnits) {
      maxRawTopUnits = prepared[i].zTop;
    }
  }
  const maxRawZMm = maxRawTopUnits * scaleMm;

  if (maxRawZMm > maxSafeZMm) {
    if (state) { state.zCapApplied = true; state.maxPrintZMm = maxSafeZMm; state.zCapLimitMm = maxSafeZMm; }
    if (ctx) { ctx.zCapApplied = true; ctx.maxPrintZMm = maxSafeZMm; ctx.zCapLimitMm = maxSafeZMm; }

    const zKneeMm = Math.min(maxSafeZMm * 0.65, maxSafeZMm - 35.0);
    const H = maxSafeZMm - zKneeMm;
    const Xmax = maxRawZMm - zKneeMm;
    const c = (Xmax - H) / (H * Xmax);

    for (let i = 0; i < prepared.length; i++) {
      const item = prepared[i];
      const zRawMm = item.zTop * scaleMm;
      if (zRawMm <= zKneeMm) continue;

      const x = zRawMm - zKneeMm;
      const zCompMm = zKneeMm + (x / (1.0 + c * x));
      const zCompUnits = quantizeZUnits(zCompMm / scaleMm);

      const hOld = Math.max(1e-4, item.zTop - item.tZ);
      const hNew = Math.max(0.60 / scaleMm, zCompUnits - item.tZ);
      const r = hNew / hOld;

      item.totalHMm *= r;
      item.roofHMm *= r;
      item.scaledMinH *= r;
      const zTop = quantizeZUnits(item.tZ + Math.max(0.85 / scaleMm, item.totalHMm));
      const zEaves = item.hasPitched ? quantizeZUnits(Math.max(item.tZ + 0.50 / scaleMm, zTop - item.roofHMm)) : zTop;
      item.zEaves = zEaves;
      item.zRidge = item.hasPitched ? Math.max(zEaves + 0.12 / scaleMm, zTop) : zEaves;
      item.zTop = item.zRidge;
    }
  } else {
    if (state) { state.zCapApplied = false; state.maxPrintZMm = maxRawZMm; state.zCapLimitMm = maxSafeZMm; }
    if (ctx) { ctx.zCapApplied = false; ctx.maxPrintZMm = maxRawZMm; ctx.zCapLimitMm = maxSafeZMm; }
  }

  return { prepared, clusters, pickIdMap };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeSolidInteriorPoint2D,
    sanitizeBuildingHoles2D,
    isPointInsidePart2D,
    polygonsOverlap2D,
    prepareAndClusterS3DBBuildings
  };
}
