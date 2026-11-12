// ============================================================================
// src/mesh/features_bridges.js
// Bank-Anchored 3D Bridges & Harbour Piers (OSM man_made=bridge Polygons,
// 1:1 Width-Matched Ramped Linear Spans, and Watertight Piers/Pontoons/Breakwaters)
// ============================================================================

if (typeof cleanPolygonRing === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
}
if (typeof computeMinAreaOBB2D === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/obb_medial_2d.js'));
}
if (typeof emitClosedPrism === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./mesh_primitives.js'));
}
if (typeof splitClosedShellToTileGrid3D === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./mesh_clipper_3d.js'));
}
if (typeof appendShellClippedToTiles === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./features_roads_parks.js'));
}

const PIER_WAY_TYPES = new Set(['pier', 'pontoon', 'breakwater', 'groyne', 'jetty']);

function _isPierRoadRecord(rd) {
  if (!rd) return false;
  const kind = rd.man_made || rd.hwy || rd.type || rd.rtype || '';
  return PIER_WAY_TYPES.has(kind);
}

function _isFootpathBridgeWay(rd) {
  if (!rd) return false;
  if (rd.isPath) return true;
  const rtype = rd.hwy || rd.type || rd.rtype || '';
  return rtype === 'footway' || rtype === 'path' || rtype === 'steps' ||
         rtype === 'cycleway' || rtype === 'bridleway' || rtype === 'track' ||
         rtype === 'corridor' || rtype === 'pedestrian';
}

// Emits a closed, watertight 2-manifold hex-strip shell with per-station top Z (ramped/crowned)
function _emitRampedRibbonShell3D(leftPts, rightPts, zTopArr, zBot, layerId, outTris, tileId, shellId) {
  const n = leftPts.length;
  if (n < 2 || rightPts.length !== n || zTopArr.length !== n) return false;

  // Validate 2D footprint simplicity and minimum vertex separation (> 1/5000 quantizer)
  for (let i = 0; i < n; i++) {
    if (zTopArr[i] - zBot < 0.035) return false;
    if (Math.hypot(leftPts[i][0] - rightPts[i][0], leftPts[i][1] - rightPts[i][1]) < 0.05) return false;
    if (i < n - 1) {
      if (Math.hypot(leftPts[i + 1][0] - leftPts[i][0], leftPts[i + 1][1] - leftPts[i][1]) < 0.025) return false;
      if (Math.hypot(rightPts[i + 1][0] - rightPts[i][0], rightPts[i + 1][1] - rightPts[i][1]) < 0.025) return false;
    }
  }

  const ring2d = rightPts.concat(leftPts.slice().reverse());
  if (signedArea2D(ring2d) <= 1e-4 || !isSimplePolygon(ring2d) || hasSelfTouchingEdge2D(ring2d, 2.5e-3)) {
    return false;
  }

  const LT = new Array(n);
  const RT = new Array(n);
  const LB = new Array(n);
  const RB = new Array(n);
  for (let i = 0; i < n; i++) {
    LT[i] = [leftPts[i][0], leftPts[i][1], zTopArr[i]];
    RT[i] = [rightPts[i][0], rightPts[i][1], zTopArr[i]];
    LB[i] = [leftPts[i][0], leftPts[i][1], zBot];
    RB[i] = [rightPts[i][0], rightPts[i][1], zBot];
  }

  const tris = [];
  const emitQuadChecked = (p0, p1, p2, p3) => {
    if (isDegenerateTri3D(p0, p1, p2) || isDegenerateTri3D(p0, p2, p3)) return false;
    pushTri(tris, p0, p1, p2, computeFaceNormal(p0, p1, p2), layerId, shellId, tileId, shellId);
    pushTri(tris, p0, p2, p3, computeFaceNormal(p0, p2, p3), layerId, shellId, tileId, shellId);
    return true;
  };

  for (let i = 0; i < n - 1; i++) {
    // Top strip (+Z)
    if (!emitQuadChecked(RT[i], RT[i + 1], LT[i + 1], LT[i])) return false;
    // Bottom strip (-Z)
    if (!emitQuadChecked(LB[i], LB[i + 1], RB[i + 1], RB[i])) return false;
    // Right side wall
    if (!emitQuadChecked(RB[i], RB[i + 1], RT[i + 1], RT[i])) return false;
    // Left side wall
    if (!emitQuadChecked(LB[i + 1], LB[i], LT[i], LT[i + 1])) return false;
  }
  // Start & end abutment endcaps
  if (!emitQuadChecked(LB[0], RB[0], RT[0], LT[0])) return false;
  if (!emitQuadChecked(RB[n - 1], LB[n - 1], LT[n - 1], RT[n - 1])) return false;

  for (let i = 0; i < tris.length; i++) outTris.push(tris[i]);
  return true;
}

// Buffers a bed-space polyline into clean, simple CCW 2D polygon(s)
function _bufferBedPolylineToPolys2D(ptsInput, widthUnits) {
  if (!ptsInput || ptsInput.length < 2) return [];
  const pts = [ptsInput[0]];
  for (let i = 1; i < ptsInput.length; i++) {
    const prev = pts[pts.length - 1];
    if (Math.hypot(ptsInput[i][0] - prev[0], ptsInput[i][1] - prev[1]) >= 0.02) {
      pts.push(ptsInput[i]);
    }
  }
  if (pts.length < 2) return [];
  const halfW = Math.max(0.12, widthUnits * 0.5);
  const isLoop = pts.length >= 4 &&
    Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.035;

  if (!isLoop) {
    const leftPts = [];
    const rightPts = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      if (i === 0) {
        const dx = pts[1][0] - pts[0][0], dy = pts[1][1] - pts[0][1], l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l, ny = dx / l;
        leftPts.push([pts[0][0] + nx * halfW, pts[0][1] + ny * halfW]);
        rightPts.push([pts[0][0] - nx * halfW, pts[0][1] - ny * halfW]);
      } else if (i === n - 1) {
        const dx = pts[n - 1][0] - pts[n - 2][0], dy = pts[n - 1][1] - pts[n - 2][1], l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l, ny = dx / l;
        leftPts.push([pts[n - 1][0] + nx * halfW, pts[n - 1][1] + ny * halfW]);
        rightPts.push([pts[n - 1][0] - nx * halfW, pts[n - 1][1] - ny * halfW]);
      } else {
        const d1x = pts[i][0] - pts[i - 1][0], d1y = pts[i][1] - pts[i - 1][1], l1 = Math.hypot(d1x, d1y) || 1;
        const d2x = pts[i + 1][0] - pts[i][0], d2y = pts[i + 1][1] - pts[i][1], l2 = Math.hypot(d2x, d2y) || 1;
        const t1x = d1x / l1, t1y = d1y / l1, t2x = d2x / l2, t2y = d2y / l2;
        const n1x = -t1y, n1y = t1x, n2x = -t2y, n2y = t2x;
        const turnDot = t1x * t2x + t1y * t2y;
        const cross = t1x * t2y - t1y * t2x;
        if (turnDot < -0.15) {
          if (cross > 0) {
            rightPts.push([pts[i][0] - n1x * halfW, pts[i][1] - n1y * halfW]);
            rightPts.push([pts[i][0] - n2x * halfW, pts[i][1] - n2y * halfW]);
            const bx = n1x + n2x, by = n1y + n2y, bl = Math.hypot(bx, by) || 1;
            leftPts.push([pts[i][0] + (bx / bl) * halfW, pts[i][1] + (by / bl) * halfW]);
          } else {
            leftPts.push([pts[i][0] + n1x * halfW, pts[i][1] + n1y * halfW]);
            leftPts.push([pts[i][0] + n2x * halfW, pts[i][1] + n2y * halfW]);
            const bx = n1x + n2x, by = n1y + n2y, bl = Math.hypot(bx, by) || 1;
            rightPts.push([pts[i][0] - (bx / bl) * halfW, pts[i][1] - (by / bl) * halfW]);
          }
        } else {
          const tx = t1x + t2x, ty = t1y + t2y, tl = Math.hypot(tx, ty) || 1;
          const mnx = -ty / tl, mny = tx / tl;
          const dot = mnx * n1x + mny * n1y;
          const miter = Math.min(1.45, 1.0 / Math.max(0.68, dot));
          leftPts.push([pts[i][0] + mnx * halfW * miter, pts[i][1] + mny * halfW * miter]);
          rightPts.push([pts[i][0] - mnx * halfW * miter, pts[i][1] - mny * halfW * miter]);
        }
      }
    }
    const cleanRibbon = cleanPolygonRing(rightPts.concat(leftPts.slice().reverse()), true);
    if (cleanRibbon.length >= 3 && Math.abs(signedArea2D(cleanRibbon)) > 1e-4 &&
        isSimplePolygon(cleanRibbon) && !hasSelfTouchingEdge2D(cleanRibbon, 2.2e-3)) {
      return [cleanRibbon];
    }
  }

  const quads = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const pA = pts[i], pB = pts[i + 1];
    const dx = pB[0] - pA[0], dy = pB[1] - pA[1], len = Math.hypot(dx, dy);
    if (len < 0.025) continue;
    const tx = dx / len, ty = dy / len;
    const nx = -ty, ny = tx;
    const extA = (i > 0 || isLoop) ? Math.min(halfW * 0.45, len * 0.35) : 0;
    const extB = (i < pts.length - 2 || isLoop) ? Math.min(halfW * 0.45, len * 0.35) : 0;
    const ax = pA[0] - tx * extA, ay = pA[1] - ty * extA;
    const bx = pB[0] + tx * extB, by = pB[1] + ty * extB;
    quads.push([
      [ax - nx * halfW, ay - ny * halfW],
      [bx - nx * halfW, by - ny * halfW],
      [bx + nx * halfW, by + ny * halfW],
      [ax + nx * halfW, ay + ny * halfW]
    ]);
  }
  return quads;
}

function buildBankAnchoredBridges(scene, ctx, baseInfo, state, meshes, allocShellId) {
  const lv = (state && (state.layerVisible || state.layers)) || null;
  const roadsVisible = !lv || lv.roads !== false;
  if (!roadsVisible) return;

  const greenVisible = !lv || lv.greenery !== false;
  const {
    scaleMm, halfW, halfH, scaleToBed,
    toBed, sampleMaskIdx, sampleBilinearMask,
    waterSDF, greenMask, majorRoadMask,
    baseBottomZ, zSubWater, gHeight, rHeight, pathHeight, brHeight,
    quantizeZUnits
  } = ctx;
  const { waterSurfZ, getActualPrintedSurfaceMinZ } = baseInfo;
  const effPathHeight = pathHeight || (rHeight * 0.72);
  const pierBasinZ = (zSubWater !== undefined && Number.isFinite(zSubWater))
    ? zSubWater
    : Math.min(waterSurfZ - 0.18, baseBottomZ - 0.35);

  const pierSpacingUnits = Math.max(1.85, 4.6 / scaleMm);
  const emittedBridgePolys = [];
  const coveredBridgeRawPolys = [];

  // Exact 1:1 road/footpath width law matching features_roads.js
  const computeLandRoadWidthUnits = (rd) => {
    if (_isFootpathBridgeWay(rd)) {
      return Math.max(Math.min(0.62, rd.width || 0.36) * scaleToBed, 0.36 / scaleMm);
    }
    return Math.max((rd.width || 1.0) * 0.90 * scaleToBed, 0.40 / scaleMm);
  };

  // Dry-land road top offset above terrain step tZ (matching features_roads.js)
  const evalRoadSurfaceOffset = (bx, by, isFootpath) => {
    if (!isFootpath) return rHeight;
    const mIdx = sampleMaskIdx(bx, by);
    if (greenVisible && greenMask && greenMask[mIdx] === 1 && (!majorRoadMask || !majorRoadMask[mIdx])) {
      return gHeight + effPathHeight;
    }
    return effPathHeight;
  };

  const isPrintedDryPoint = (bx, by) => {
    if (Math.abs(bx) > halfW - 0.26 || Math.abs(by) > halfH - 0.26) return false;
    return getActualPrintedSurfaceMinZ(bx, by) >= baseBottomZ - 1e-4 &&
           getActualPrintedSurfaceMinZ(bx - 0.14, by) >= baseBottomZ - 1e-4 &&
           getActualPrintedSurfaceMinZ(bx + 0.14, by) >= baseBottomZ - 1e-4 &&
           getActualPrintedSurfaceMinZ(bx, by - 0.14) >= baseBottomZ - 1e-4 &&
           getActualPrintedSurfaceMinZ(bx, by + 0.14) >= baseBottomZ - 1e-4;
  };

  const isWetPoint = (bx, by) => (
    getActualPrintedSurfaceMinZ(bx, by) < baseBottomZ - 1e-4 ||
    sampleBilinearMask(waterSDF, bx, by) < 0.05
  );

  // Emits each water pier (or twin piers on wide boulevards) as independent watertight 2-manifold shells
  const emitPiersAlongSpan = (ax, ay, bx, by, deckWidth, zDeckBot, containPoly = null) => {
    const spanLen = Math.hypot(bx - ax, by - ay);
    if (spanLen < pierSpacingUnits * 0.65 || zDeckBot - waterSurfZ <= 0.10) return;
    const tx = (bx - ax) / spanLen, ty = (by - ay) / spanLen;
    const nx = -ty, ny = tx;
    const numPiers = Math.max(1, Math.ceil(spanLen / pierSpacingUnits) - 1);
    const twinCols = (deckWidth * scaleMm > 7.5);
    const latOffsets = twinCols ? [-deckWidth * 0.26, deckWidth * 0.26] : [0.0];
    const pW = twinCols
      ? Math.max(0.46, deckWidth * 0.26)
      : Math.min(deckWidth * 0.72, Math.max(0.44, deckWidth * 0.58));
    const pT = Math.max(0.42, 0.90 / scaleMm);

    for (let p = 1; p <= numPiers; p++) {
      const frac = p / (numPiers + 1);
      const baseMx = ax + (bx - ax) * frac;
      const baseMy = ay + (by - ay) * frac;
      for (let li = 0; li < latOffsets.length; li++) {
        const mx = baseMx + nx * latOffsets[li];
        const my = baseMy + ny * latOffsets[li];
        if (containPoly && !pointInPoly2D(mx, my, containPoly)) continue;
        const corners = [
          [mx - nx * (pW * 0.5) - tx * (pT * 0.5), my - ny * (pW * 0.5) - ty * (pT * 0.5)],
          [mx + nx * (pW * 0.5) - tx * (pT * 0.5), my + ny * (pW * 0.5) - ty * (pT * 0.5)],
          [mx + nx * (pW * 0.5) + tx * (pT * 0.5), my + ny * (pW * 0.5) + ty * (pT * 0.5)],
          [mx - nx * (pW * 0.5) + tx * (pT * 0.5), my - ny * (pW * 0.5) + ty * (pT * 0.5)]
        ];
        const allInWater = getActualPrintedSurfaceMinZ(mx, my) < baseBottomZ - 1e-4 &&
                           corners.every(c => getActualPrintedSurfaceMinZ(c[0], c[1]) < baseBottomZ - 1e-4);
        if (allInWater) {
          const pierShell = [];
          emitClosedPrism(corners, waterSurfZ, zDeckBot, 3, pierShell, 0, allocShellId());
          appendShellClippedToTiles(pierShell, ctx, meshes.roads);
        }
      }
    }
  };

  // Pre-convert non-pier roads to bed coordinates once for corridor matching & chaining
  const rawBridgeWays = [];
  const otherRoads = [];
  const allBedRoadSegs = [];

  (scene.roads || []).forEach(rd => {
    if (!rd || !rd.pts || rd.pts.length < 2) return;
    if (_isPierRoadRecord(rd)) return;
    const bedPts = rd.pts.map(toBed);
    const isFootpath = _isFootpathBridgeWay(rd);
    const roadW = computeLandRoadWidthUnits(rd);
    const isBridge = Boolean(rd.bridge === true || (rd.layer && rd.layer >= 1));

    if (isBridge) {
      rawBridgeWays.push({ rd, pts: bedPts, isFootpath, roadW, used: false });
    } else {
      otherRoads.push({ rd, pts: bedPts, isFootpath, roadW });
    }

    for (let i = 0; i < bedPts.length - 1; i++) {
      const pA = bedPts[i], pB = bedPts[i + 1];
      const dx = pB[0] - pA[0], dy = pB[1] - pA[1];
      const len = Math.hypot(dx, dy);
      if (len < 0.02) continue;
      allBedRoadSegs.push({
        pA, pB,
        mx: (pA[0] + pB[0]) * 0.5,
        my: (pA[1] + pB[1]) * 0.5,
        tx: dx / len,
        ty: dy / len,
        len,
        minX: Math.min(pA[0], pB[0]),
        maxX: Math.max(pA[0], pB[0]),
        minY: Math.min(pA[1], pB[1]),
        maxY: Math.max(pA[1], pB[1]),
        isFootpath,
        isBridge,
        roadW
      });
    }
  });

  // ==========================================================================
  // STAGE 1: Exact OSM man_made=bridge Area Polygons
  // Uses exact OSM polygon contour, road-tensor span orientation, 1:1 lateral
  // street corridor taper, and compact 0.48-unit bank landing (no 45m OBB stretch)
  // ==========================================================================
  (scene.bridgePolys || []).forEach((bp, bpIdx) => {
    if (!bp || bp.isPier || !bp.outer || bp.outer.length < 3) return;
    const rawPoly = cleanPolygonRing(
      clipPolyToBox(bp.outer.map(toBed), -halfW + 0.25, -halfH + 0.25, halfW - 0.25, halfH - 0.25),
      true
    );
    if (rawPoly.length < 3 || Math.abs(signedArea2D(rawPoly)) < 0.04) return;

    const obb = computeMinAreaOBB2D(rawPoly);
    if (!obb || obb.halfW < 0.08) return;

    let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
    for (let i = 0; i < rawPoly.length; i++) {
      const p = rawPoly[i];
      if (p[0] < bMinX) bMinX = p[0];
      if (p[0] > bMaxX) bMaxX = p[0];
      if (p[1] < bMinY) bMinY = p[1];
      if (p[1] > bMaxY) bMaxY = p[1];
    }

    // Gather road segments traversing rawPoly and build sign-invariant 2x2 orientation tensor
    const insideSegs = [];
    let mxx = 0, mxy = 0, myy = 0;
    for (let i = 0; i < allBedRoadSegs.length; i++) {
      const seg = allBedRoadSegs[i];
      if (seg.maxX < bMinX - 0.2 || seg.minX > bMaxX + 0.2 ||
          seg.maxY < bMinY - 0.2 || seg.minY > bMaxY + 0.2) {
        continue;
      }
      const q1x = seg.pA[0] * 0.75 + seg.pB[0] * 0.25;
      const q1y = seg.pA[1] * 0.75 + seg.pB[1] * 0.25;
      const q3x = seg.pA[0] * 0.25 + seg.pB[0] * 0.75;
      const q3y = seg.pA[1] * 0.25 + seg.pB[1] * 0.75;
      const hitsMid = pointInPolyOrNear2D(seg.mx, seg.my, rawPoly, 0.12);
      const hitsSub = hitsMid ||
        pointInPolyOrNear2D(q1x, q1y, rawPoly, 0.08) ||
        pointInPolyOrNear2D(q3x, q3y, rawPoly, 0.08);
      if (!hitsSub) continue;

      insideSegs.push(seg);
      const classW = !seg.isFootpath
        ? (seg.isBridge ? 4.0 : 1.6) * seg.roadW
        : (seg.isBridge ? 1.2 : 0.4) * seg.roadW;
      const w = seg.len * classW;
      mxx += w * seg.tx * seg.tx;
      mxy += w * seg.tx * seg.ty;
      myy += w * seg.ty * seg.ty;
    }

    let sUx, sUy;
    const tensorTrace = mxx + myy;
    const tensorDiff = mxx - myy;
    const tensorRad = Math.hypot(tensorDiff, 2.0 * mxy);
    if (tensorTrace > 0.12 && tensorRad > 1e-5) {
      let vx = tensorDiff + tensorRad;
      let vy = 2.0 * mxy;
      if (Math.hypot(vx, vy) < 1e-6) {
        vx = 2.0 * mxy;
        vy = -tensorDiff + tensorRad;
      }
      const vl = Math.hypot(vx, vy) || 1;
      sUx = vx / vl;
      sUy = vy / vl;
    } else {
      // Multi-sample water-crossing fallback (immune to mid-river islands at t=0)
      const scoreWaterAxis = (ux, uy) => {
        let uMin = Infinity, uMax = -Infinity;
        for (let i = 0; i < rawPoly.length; i++) {
          const u = (rawPoly[i][0] - obb.cx) * ux + (rawPoly[i][1] - obb.cy) * uy;
          if (u < uMin) uMin = u;
          if (u > uMax) uMax = u;
        }
        const sNeg = Math.min(2.5, sampleBilinearMask(waterSDF, obb.cx + ux * (uMin - 0.8), obb.cy + uy * (uMin - 0.8)));
        const sPos = Math.min(2.5, sampleBilinearMask(waterSDF, obb.cx + ux * (uMax + 0.8), obb.cy + uy * (uMax + 0.8)));
        let sInteriorMin = Infinity;
        for (let k = 1; k <= 9; k++) {
          const u = uMin + (uMax - uMin) * (k / 10);
          const sv = sampleBilinearMask(waterSDF, obb.cx + ux * u, obb.cy + uy * u);
          if (sv < sInteriorMin) sInteriorMin = sv;
        }
        const crossesBankToBank = (sNeg > 0 && sPos > 0 && sInteriorMin < 0) ? 4.0 : 0.0;
        return (sNeg + sPos) - 2.2 * sInteriorMin + crossesBankToBank;
      };
      const useU = scoreWaterAxis(obb.ux, obb.uy) >= scoreWaterAxis(obb.vx, obb.vy);
      sUx = useU ? obb.ux : obb.vx;
      sUy = useU ? obb.uy : obb.vy;
    }
    const cVx = -sUy;
    const cVy = sUx;

    let uPolyMin = Infinity, uPolyMax = -Infinity;
    let vPolyMin = Infinity, vPolyMax = -Infinity;
    for (let i = 0; i < rawPoly.length; i++) {
      const dx = rawPoly[i][0] - obb.cx, dy = rawPoly[i][1] - obb.cy;
      const u = dx * sUx + dy * sUy;
      const v = dx * cVx + dy * cVy;
      if (u < uPolyMin) uPolyMin = u;
      if (u > uPolyMax) uPolyMax = u;
      if (v < vPolyMin) vPolyMin = v;
      if (v > vPolyMax) vPolyMax = v;
    }

    // Determine lateral corridor [vCorrMin, vCorrMax] from span-aligned roads (|dot| >= 0.55)
    // Excludes perpendicular riverside streets running along the banks!
    const alignedMotorSegs = [];
    const alignedFootSegs = [];
    for (let i = 0; i < insideSegs.length; i++) {
      const seg = insideSegs[i];
      if (Math.abs(seg.tx * sUx + seg.ty * sUy) < 0.55) continue;
      if (!seg.isFootpath) alignedMotorSegs.push(seg);
      else alignedFootSegs.push(seg);
    }

    // On motor/rail bridges, dry-land sidewalks are suppressed by features_roads.js,
    // so matching the motor/rail corridor prevents wide sidewalk/balcony step jumps on banks & islands
    const activeCorrSegs = alignedMotorSegs.length > 0 ? alignedMotorSegs : alignedFootSegs;
    const hasRoadCorridor = activeCorrSegs.length > 0;
    const isPureFootbridge = hasRoadCorridor && alignedMotorSegs.length === 0;

    let vCorrMin = vPolyMin;
    let vCorrMax = vPolyMax;
    if (hasRoadCorridor) {
      let cMin = Infinity, cMax = -Infinity;
      for (let i = 0; i < activeCorrSegs.length; i++) {
        const seg = activeCorrSegs[i];
        const hw = seg.roadW * 0.5;
        for (const pt of [seg.pA, seg.pB, [seg.mx, seg.my]]) {
          if (!pointInPolyOrNear2D(pt[0], pt[1], rawPoly, 0.35)) continue;
          const v = (pt[0] - obb.cx) * cVx + (pt[1] - obb.cy) * cVy;
          if (v - hw < cMin) cMin = v - hw;
          if (v + hw > cMax) cMax = v + hw;
        }
      }
      if (Number.isFinite(cMin) && Number.isFinite(cMax) && cMax > cMin) {
        const minCorrW = 0.38 / scaleMm;
        if (cMax - cMin < minCorrW) {
          const mid = 0.5 * (cMin + cMax);
          cMin = mid - minCorrW * 0.5;
          cMax = mid + minCorrW * 0.5;
        }
        vCorrMin = Math.max(vPolyMin - 0.08, cMin);
        vCorrMax = Math.min(vPolyMax + 0.08, cMax);
        if (vCorrMax - vCorrMin < 0.22) {
          vCorrMin = vPolyMin;
          vCorrMax = vPolyMax;
        }
      }
    }

    // Sample wet span [uWetMin, uWetMax] along span axis
    const uSpan = uPolyMax - uPolyMin;
    const nUSteps = Math.max(8, Math.ceil(uSpan / 0.18));
    let uWetMin = Infinity, uWetMax = -Infinity;
    const vSampleMid = 0.5 * (vCorrMin + vCorrMax);
    const vSampleHalf = 0.42 * (vCorrMax - vCorrMin);

    for (let k = 0; k <= nUSteps; k++) {
      const u = uPolyMin + (uSpan * k) / nUSteps;
      let stationWet = false;
      for (const vf of [-1, -0.5, 0, 0.5, 1]) {
        const v = vSampleMid + vf * vSampleHalf;
        const wx = obb.cx + sUx * u + cVx * v;
        const wy = obb.cy + sUy * u + cVy * v;
        if (!pointInPolyOrNear2D(wx, wy, rawPoly, 0.14)) continue;
        if (isWetPoint(wx, wy)) {
          stationWet = true;
          break;
        }
      }
      if (stationWet) {
        if (u < uWetMin) uWetMin = u;
        if (u > uWetMax) uWetMax = u;
      }
    }
    if (!Number.isFinite(uWetMin)) {
      for (let i = 0; i < rawPoly.length; i++) {
        if (isWetPoint(rawPoly[i][0], rawPoly[i][1])) {
          const u = (rawPoly[i][0] - obb.cx) * sUx + (rawPoly[i][1] - obb.cy) * sUy;
          if (u < uWetMin) uWetMin = u;
          if (u > uWetMax) uWetMax = u;
        }
      }
    }
    if (!Number.isFinite(uWetMin) || uWetMax < uWetMin) return;

    // Trim axial dry-land excess to compact 0.48-unit overlap and taper lateral width to 1:1 road corridor
    const BANK_OVERLAP = 0.48;
    const uClipMin = Math.max(uPolyMin, uWetMin - BANK_OVERLAP);
    const uClipMax = Math.min(uPolyMax, uWetMax + BANK_OVERLAP);
    if (uClipMax - uClipMin < 0.30) return;

    const uvToBed = (u, v) => [
      obb.cx + sUx * u + cVx * v,
      obb.cy + sUy * u + cVy * v
    ];

    let poly = rawPoly;
    let clipHull = null;
    if (hasRoadCorridor) {
      const corrW = vCorrMax - vCorrMin;
      const polyW = vPolyMax - vPolyMin;
      const parapetM = polyW > corrW + 0.04 ? Math.min(0.14, corrW * 0.14) : 0.0;
      const uMid = 0.5 * (uClipMin + uClipMax);
      const uTapNeg = Math.min(uMid - 0.02, Math.max(uClipMin + 0.04, uWetMin));
      const uTapPos = Math.max(uMid + 0.02, Math.min(uClipMax - 0.04, uWetMax));

      const rawHull = (parapetM > 0.01 && uTapPos > uTapNeg + 0.04)
        ? [
            uvToBed(uClipMin, vCorrMin),
            uvToBed(uTapNeg, vCorrMin - parapetM),
            uvToBed(uTapPos, vCorrMin - parapetM),
            uvToBed(uClipMax, vCorrMin),
            uvToBed(uClipMax, vCorrMax),
            uvToBed(uTapPos, vCorrMax + parapetM),
            uvToBed(uTapNeg, vCorrMax + parapetM),
            uvToBed(uClipMin, vCorrMax)
          ]
        : [
            uvToBed(uClipMin, vCorrMin),
            uvToBed(uClipMax, vCorrMin),
            uvToBed(uClipMax, vCorrMax),
            uvToBed(uClipMin, vCorrMax)
          ];
      clipHull = cleanPolygonRing(rawHull, true);
    } else {
      clipHull = cleanPolygonRing([
        uvToBed(uClipMin, vPolyMin - 0.15),
        uvToBed(uClipMax, vPolyMin - 0.15),
        uvToBed(uClipMax, vPolyMax + 0.15),
        uvToBed(uClipMin, vPolyMax + 0.15)
      ], true);
    }

    if (clipHull && clipHull.length >= 3) {
      const clipped = cleanPolygonRing(clipPolyByConvex(rawPoly, clipHull), true);
      if (clipped.length >= 3 && Math.abs(signedArea2D(clipped)) >= 0.03 && isSimplePolygon(clipped)) {
        poly = clipped;
      }
    }

    // If OSM bridge polygon stopped right at the water edge short of shoreline bevel,
    // extend ONLY within [vCorrMin, vCorrMax] up to <= 1.65 units to seat 0.44u into the bank road
    const findShortBankTouchup = (uBase, dirSign) => {
      const [bx0, by0] = uvToBed(uBase, vSampleMid);
      if (isPrintedDryPoint(bx0, by0)) {
        // Ensure at least 0.36u past shoreline so no road-to-bridge gap occurs
        const [bxIn, byIn] = uvToBed(uBase - dirSign * 0.34, vSampleMid);
        return isPrintedDryPoint(bxIn, byIn) ? 0.0 : 0.22;
      }
      for (let d = 0.20; d <= 1.65; d += 0.20) {
        const [tx, ty] = uvToBed(uBase + dirSign * d, vSampleMid);
        if (Math.abs(tx) > halfW - 0.28 || Math.abs(ty) > halfH - 0.28) return 0.0;
        if (isPrintedDryPoint(tx, ty)) return d + 0.44;
      }
      return -1.0;
    };

    const touchNeg = findShortBankTouchup(uClipMin, -1);
    const touchPos = findShortBankTouchup(uClipMax, +1);
    if (touchNeg < 0 || touchPos < 0) return;

    if (touchNeg > 0.01 || touchPos > 0.01) {
      const uSpanClipped = Math.max(0.3, uClipMax - uClipMin);
      const bandLen = Math.min(0.65, uSpanClipped * 0.35);
      const adjusted = poly.map(pt => {
        const dx = pt[0] - obb.cx, dy = pt[1] - obb.cy;
        let u = dx * sUx + dy * sUy;
        let v = dx * cVx + dy * cVy;
        if (touchNeg > 0.01 && u < uClipMin + bandLen) {
          const w = Math.min(1.0, Math.max(0.0, (uClipMin + bandLen - u) / bandLen));
          u -= touchNeg * w;
          v = Math.max(vCorrMin, Math.min(vCorrMax, v));
        } else if (touchPos > 0.01 && u > uClipMax - bandLen) {
          const w = Math.min(1.0, Math.max(0.0, (u - (uClipMax - bandLen)) / bandLen));
          u += touchPos * w;
          v = Math.max(vCorrMin, Math.min(vCorrMax, v));
        }
        const [nx, ny] = uvToBed(u, v);
        return [
          Math.max(-halfW + 0.25, Math.min(halfW - 0.25, nx)),
          Math.max(-halfH + 0.25, Math.min(halfH - 0.25, ny))
        ];
      });
      const adjClean = cleanPolygonRing(adjusted, true);
      if (adjClean.length >= 3 && Math.abs(signedArea2D(adjClean)) >= 0.03 &&
          isSimplePolygon(adjClean) && !hasSelfTouchingEdge2D(adjClean, 2.2e-3)) {
        poly = adjClean;
      }
    }

    // Compute flush road-matched Z bounds across dry abutment points
    let zLandMin = Infinity;
    let zRoadTopMax = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i], p1 = poly[(i + 1) % poly.length];
      for (const q of [p0, [(p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5]]) {
        const sz = getActualPrintedSurfaceMinZ(q[0], q[1]);
        if (sz >= baseBottomZ - 1e-4) {
          if (sz < zLandMin) zLandMin = sz;
          const rTop = sz + evalRoadSurfaceOffset(q[0], q[1], isPureFootbridge);
          if (rTop > zRoadTopMax) zRoadTopMax = rTop;
        }
      }
    }
    if (!Number.isFinite(zLandMin)) zLandMin = baseBottomZ;
    if (!Number.isFinite(zRoadTopMax)) {
      zRoadTopMax = zLandMin + (isPureFootbridge ? effPathHeight : rHeight);
    }

    const zDeckBot = zLandMin;
    const microZ = ((bpIdx % 4) + 1) * 0.003;
    const minWaterClearTop = Math.max(
      waterSurfZ + brHeight * 0.72,
      zDeckBot + (isPureFootbridge ? effPathHeight : rHeight)
    );
    const zDeckTop = quantizeZUnits(Math.max(minWaterClearTop, zRoadTopMax)) + microZ;

    const holes = (bp.holes || [])
      .map(h => {
        let hb = clipPolyToBox(h.map(toBed), -halfW + 0.3, -halfH + 0.3, halfW - 0.3, halfH - 0.3);
        if (clipHull && clipHull.length >= 3 && hb.length >= 3) {
          hb = clipPolyByConvex(hb, clipHull);
        }
        return hb;
      })
      .filter(h => h && h.length >= 3);

    const deckShell = [];
    emitPolygonWithHolesSlab3D(poly, holes, zDeckBot, zDeckTop, 3, deckShell, 0, allocShellId());
    if (deckShell.length > 0) {
      appendShellClippedToTiles(deckShell, ctx, meshes.roads);
      const endNegPt = uvToBed(uClipMin - Math.max(0, touchNeg) * 0.85, vSampleMid);
      const endPosPt = uvToBed(uClipMax + Math.max(0, touchPos) * 0.85, vSampleMid);
      const effDeckW = Math.max(0.45, vCorrMax - vCorrMin);
      emitPiersAlongSpan(endNegPt[0], endNegPt[1], endPosPt[0], endPosPt[1], effDeckW, zDeckBot, poly);
      emittedBridgePolys.push(poly);
      coveredBridgeRawPolys.push(rawPoly);
    }
  });

  // ==========================================================================
  // STAGE 2: Chained Linear bridge=yes Spans
  // Strict class/width chaining, exact 1:1 land road width, 0.48-unit bank
  // landing along connected street geometry, and smooth bank-to-bank Z ramp
  // ==========================================================================
  const chainedCandidates = [];
  for (let i = 0; i < rawBridgeWays.length; i++) {
    if (rawBridgeWays[i].used) continue;
    rawBridgeWays[i].used = true;
    let chain = rawBridgeWays[i].pts.slice();
    const baseItem = rawBridgeWays[i];
    let widthWeightedSum = baseItem.roadW;
    let widthWeightCount = 1;

    let merged = true;
    while (merged) {
      merged = false;
      for (let j = 0; j < rawBridgeWays.length; j++) {
        const cand = rawBridgeWays[j];
        if (cand.used) continue;
        // Never chain footpaths onto motor roads or merge ways with mismatched widths
        if (cand.isFootpath !== baseItem.isFootpath) continue;
        if (Math.abs(cand.roadW - baseItem.roadW) > Math.max(0.20, 0.26 * scaleToBed)) continue;

        const cStart = chain[0], cEnd = chain[chain.length - 1];
        const oStart = cand.pts[0], oEnd = cand.pts[cand.pts.length - 1];

        const dirDotOk = (a0, a1, b0, b1) => {
          const dax = a1[0] - a0[0], day = a1[1] - a0[1], la = Math.hypot(dax, day) || 1;
          const dbx = b1[0] - b0[0], dby = b1[1] - b0[1], lb = Math.hypot(dbx, dby) || 1;
          return ((dax * dbx + day * dby) / (la * lb)) >= 0.35;
        };

        if (Math.hypot(cEnd[0] - oStart[0], cEnd[1] - oStart[1]) < 0.10 &&
            dirDotOk(chain[chain.length - 2], cEnd, oStart, cand.pts[1])) {
          chain = chain.concat(cand.pts.slice(1));
          cand.used = true;
          merged = true;
          widthWeightedSum += cand.roadW;
          widthWeightCount++;
        } else if (Math.hypot(cEnd[0] - oEnd[0], cEnd[1] - oEnd[1]) < 0.10 &&
                   dirDotOk(chain[chain.length - 2], cEnd, oEnd, cand.pts[cand.pts.length - 2])) {
          chain = chain.concat(cand.pts.slice(0, -1).reverse());
          cand.used = true;
          merged = true;
          widthWeightedSum += cand.roadW;
          widthWeightCount++;
        } else if (Math.hypot(cStart[0] - oEnd[0], cStart[1] - oEnd[1]) < 0.10 &&
                   dirDotOk(cand.pts[cand.pts.length - 2], oEnd, cStart, chain[1])) {
          chain = cand.pts.slice(0, -1).concat(chain);
          cand.used = true;
          merged = true;
          widthWeightedSum += cand.roadW;
          widthWeightCount++;
        } else if (Math.hypot(cStart[0] - oStart[0], cStart[1] - oStart[1]) < 0.10 &&
                   dirDotOk(cand.pts[1], oStart, cStart, chain[1])) {
          chain = cand.pts.slice(1).reverse().concat(chain);
          cand.used = true;
          merged = true;
          widthWeightedSum += cand.roadW;
          widthWeightCount++;
        }
      }
    }
    chainedCandidates.push({
      rd: baseItem.rd,
      pts: chain,
      isFootpath: baseItem.isFootpath,
      roadW: widthWeightedSum / widthWeightCount
    });
  }

  // Helper: extend abutment end along connected dry-land road geometry (up to 0.48u overlap)
  const extendAbutmentToLandRoad = (endPt, outDx, outDy, isFootpath) => {
    const outLen = Math.hypot(outDx, outDy) || 1;
    const ux = outDx / outLen, uy = outDy / outLen;

    // Look for a connected ground road node at the bridge endpoint
    let bestContinuation = null;
    let bestDot = 0.40;
    for (let i = 0; i < otherRoads.length; i++) {
      const ord = otherRoads[i];
      if (ord.isFootpath !== isFootpath || ord.pts.length < 2) continue;
      const pFirst = ord.pts[0], pLast = ord.pts[ord.pts.length - 1];
      if (Math.hypot(pFirst[0] - endPt[0], pFirst[1] - endPt[1]) < 0.12) {
        const dx = ord.pts[1][0] - pFirst[0], dy = ord.pts[1][1] - pFirst[1], l = Math.hypot(dx, dy) || 1;
        const d = (dx / l) * ux + (dy / l) * uy;
        if (d > bestDot) {
          bestDot = d;
          bestContinuation = ord.pts.slice(1);
        }
      } else if (Math.hypot(pLast[0] - endPt[0], pLast[1] - endPt[1]) < 0.12) {
        const n = ord.pts.length;
        const dx = ord.pts[n - 2][0] - pLast[0], dy = ord.pts[n - 2][1] - pLast[1], l = Math.hypot(dx, dy) || 1;
        const d = (dx / l) * ux + (dy / l) * uy;
        if (d > bestDot) {
          bestDot = d;
          bestContinuation = ord.pts.slice(0, -1).reverse();
        }
      }
    }

    const extraPts = [];
    if (bestContinuation && bestContinuation.length > 0) {
      let prev = endPt;
      let totalD = 0;
      let dryD = isPrintedDryPoint(endPt[0], endPt[1]) ? 0.05 : 0.0;
      for (let k = 0; k < bestContinuation.length && totalD < 1.65 && dryD < 0.48; k++) {
        const next = bestContinuation[k];
        const segLen = Math.hypot(next[0] - prev[0], next[1] - prev[1]);
        if (segLen < 0.02) continue;
        const steps = Math.max(1, Math.ceil(segLen / 0.18));
        for (let s = 1; s <= steps && totalD < 1.65 && dryD < 0.48; s++) {
          const t = s / steps;
          const px = prev[0] + (next[0] - prev[0]) * t;
          const py = prev[1] + (next[1] - prev[1]) * t;
          if (Math.abs(px) > halfW - 0.26 || Math.abs(py) > halfH - 0.26) break;
          const stepD = segLen / steps;
          totalD += stepD;
          if (isPrintedDryPoint(px, py)) dryD += stepD;
          extraPts.push([px, py]);
        }
        prev = next;
      }
      if (extraPts.length > 0 && isPrintedDryPoint(extraPts[extraPts.length - 1][0], extraPts[extraPts.length - 1][1])) {
        return extraPts;
      }
    }

    // Fallback: short tangent walk (<= 1.65u max, 0.46u overlap onto dry land)
    let dryD = isPrintedDryPoint(endPt[0], endPt[1]) ? 0.05 : 0.0;
    const tangPts = [];
    for (let d = 0.20; d <= 1.65 && dryD < 0.46; d += 0.20) {
      const cx = endPt[0] + ux * d;
      const cy = endPt[1] + uy * d;
      if (Math.abs(cx) > halfW - 0.26 || Math.abs(cy) > halfH - 0.26) break;
      tangPts.push([cx, cy]);
      if (isPrintedDryPoint(cx, cy)) dryD += 0.20;
    }
    return tangPts;
  };

  let linSpanIdx = 0;
  chainedCandidates.forEach(({ pts, isFootpath, roadW }) => {
    const dense = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const pA = pts[i], pB = pts[i + 1];
      const segLen = Math.hypot(pB[0] - pA[0], pB[1] - pA[1]);
      const steps = Math.max(1, Math.ceil(segLen / 0.20));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        dense.push([pA[0] + (pB[0] - pA[0]) * t, pA[1] + (pB[1] - pA[1]) * t]);
      }
    }
    dense.push(pts[pts.length - 1]);
    if (dense.length < 2) return;

    const brWidth = roadW;
    const brHalfW = brWidth * 0.5;

    let idx = 0;
    while (idx < dense.length) {
      if (!isWetPoint(dense[idx][0], dense[idx][1])) { idx++; continue; }
      const iW0 = idx;
      while (idx < dense.length && isWetPoint(dense[idx][0], dense[idx][1])) idx++;
      const iW1 = idx - 1;

      // Walk along dense onto dry land for only ~0.48u overlap (max 1.65u search)
      let s0 = iW0, totalWalk0 = 0, dryWalk0 = 0;
      while (s0 > 0 && dryWalk0 < 0.48 && totalWalk0 < 1.65) {
        const step = Math.hypot(dense[s0][0] - dense[s0 - 1][0], dense[s0][1] - dense[s0 - 1][1]);
        totalWalk0 += step;
        s0--;
        if (isPrintedDryPoint(dense[s0][0], dense[s0][1])) dryWalk0 += step;
      }

      let s1 = iW1, totalWalk1 = 0, dryWalk1 = 0;
      while (s1 < dense.length - 1 && dryWalk1 < 0.48 && totalWalk1 < 1.65) {
        const step = Math.hypot(dense[s1 + 1][0] - dense[s1][0], dense[s1 + 1][1] - dense[s1][1]);
        totalWalk1 += step;
        s1++;
        if (isPrintedDryPoint(dense[s1][0], dense[s1][1])) dryWalk1 += step;
      }

      let sub = dense.slice(s0, s1 + 1);
      if (sub.length >= 2 && dryWalk0 < 0.36) {
        const pre = extendAbutmentToLandRoad(
          sub[0],
          sub[0][0] - sub[1][0],
          sub[0][1] - sub[1][1],
          isFootpath
        );
        if (pre.length > 0) sub = pre.reverse().concat(sub);
      }
      if (sub.length >= 2 && dryWalk1 < 0.36) {
        const nS = sub.length;
        const post = extendAbutmentToLandRoad(
          sub[nS - 1],
          sub[nS - 1][0] - sub[nS - 2][0],
          sub[nS - 1][1] - sub[nS - 2][1],
          isFootpath
        );
        if (post.length > 0) sub = sub.concat(post);
      }

      // Deduplicate against Stage 1 man_made=bridge polygons (and suppress parallel bridge sidewalks)
      const testPolys = isFootpath ? coveredBridgeRawPolys : emittedBridgePolys;
      if (testPolys.length > 0) {
        let covered = 0;
        const tol = isFootpath ? 0.38 : 0.42;
        for (let k = 0; k < sub.length; k++) {
          const p = sub[k];
          if (testPolys.some(bpPoly => pointInPolyOrNear2D(p[0], p[1], bpPoly, tol))) covered++;
        }
        if (covered >= sub.length * 0.42) continue;
      }

      if (!isPrintedDryPoint(sub[0][0], sub[0][1]) ||
          !isPrintedDryPoint(sub[sub.length - 1][0], sub[sub.length - 1][1])) {
        continue;
      }

      // Resample span stations (~0.55u spacing + abutment transition stations near both ends)
      const cumDist = [0];
      for (let k = 1; k < sub.length; k++) {
        cumDist.push(cumDist[k - 1] + Math.hypot(sub[k][0] - sub[k - 1][0], sub[k][1] - sub[k - 1][1]));
      }
      const totalArcLen = cumDist[cumDist.length - 1];
      if (totalArcLen < 0.55 ||
          Math.hypot(sub[sub.length - 1][0] - sub[0][0], sub[sub.length - 1][1] - sub[0][1]) < 0.50) {
        continue;
      }

      const spanPts = [sub[0]];
      const spanArc = [0];
      for (let k = 1; k < sub.length - 1; k++) {
        const dFromPrev = Math.hypot(
          sub[k][0] - spanPts[spanPts.length - 1][0],
          sub[k][1] - spanPts[spanPts.length - 1][1]
        );
        const dToEnd = Math.hypot(
          sub[sub.length - 1][0] - sub[k][0],
          sub[sub.length - 1][1] - sub[k][1]
        );
        const nearBank = (cumDist[k] >= 0.20 && cumDist[k] <= 0.45 && spanPts.length === 1) ||
                         (totalArcLen - cumDist[k] >= 0.20 && totalArcLen - cumDist[k] <= 0.45 && dToEnd >= 0.18);
        if ((dFromPrev >= 0.55 && dToEnd >= 0.22) || (nearBank && dFromPrev >= 0.18 && dToEnd >= 0.18)) {
          spanPts.push(sub[k]);
          spanArc.push(cumDist[k]);
        }
      }
      spanPts.push(sub[sub.length - 1]);
      spanArc.push(totalArcLen);
      if (spanPts.length < 2) continue;

      const N = spanPts.length;
      const leftPts = [];
      const rightPts = [];
      for (let i = 0; i < N; i++) {
        let nx, ny;
        if (i === 0) {
          const dx = spanPts[1][0] - spanPts[0][0], dy = spanPts[1][1] - spanPts[0][1], l = Math.hypot(dx, dy) || 1;
          nx = -dy / l; ny = dx / l;
        } else if (i === N - 1) {
          const dx = spanPts[N - 1][0] - spanPts[N - 2][0], dy = spanPts[N - 1][1] - spanPts[N - 2][1], l = Math.hypot(dx, dy) || 1;
          nx = -dy / l; ny = dx / l;
        } else {
          const d1x = spanPts[i][0] - spanPts[i - 1][0], d1y = spanPts[i][1] - spanPts[i - 1][1], l1 = Math.hypot(d1x, d1y) || 1;
          const d2x = spanPts[i + 1][0] - spanPts[i][0], d2y = spanPts[i + 1][1] - spanPts[i][1], l2 = Math.hypot(d2x, d2y) || 1;
          const tx = d1x / l1 + d2x / l2, ty = d1y / l1 + d2y / l2, tl = Math.hypot(tx, ty) || 1;
          const mnx = -ty / tl, mny = tx / tl;
          const dot = mnx * (-d1y / l1) + mny * (d1x / l1);
          const miter = Math.min(1.55, 1.0 / Math.max(0.62, dot));
          nx = mnx * miter; ny = mny * miter;
        }
        // Subtle 0.84x nose taper only at the buried dry-land tip so rounded road masks never expose square corners
        const endFactor = (i === 0 || i === N - 1) && N >= 3 ? 0.84 : 1.0;
        const hw = Math.max(0.16, brHalfW * endFactor);
        leftPts.push([spanPts[i][0] + nx * hw, spanPts[i][1] + ny * hw]);
        rightPts.push([spanPts[i][0] - nx * hw, spanPts[i][1] - ny * hw]);
      }

      // Bank elevations & smooth bank-to-bank ramped/crowned Z profile
      const zLand0 = Math.max(baseBottomZ, getActualPrintedSurfaceMinZ(spanPts[0][0], spanPts[0][1]));
      const zLand1 = Math.max(baseBottomZ, getActualPrintedSurfaceMinZ(spanPts[N - 1][0], spanPts[N - 1][1]));
      let zDryMin = Math.min(zLand0, zLand1);
      for (let i = 1; i < N - 1; i++) {
        const sz = getActualPrintedSurfaceMinZ(spanPts[i][0], spanPts[i][1]);
        if (sz >= baseBottomZ - 1e-4 && sz < zDryMin) zDryMin = sz;
      }

      const zDeckBot = zDryMin;
      const microZ = (((linSpanIdx++) % 5) + 1) * 0.003;
      const zEnd0 = quantizeZUnits(zLand0 + evalRoadSurfaceOffset(spanPts[0][0], spanPts[0][1], isFootpath)) + microZ;
      const zEnd1 = quantizeZUnits(zLand1 + evalRoadSurfaceOffset(spanPts[N - 1][0], spanPts[N - 1][1], isFootpath)) + microZ;

      const minMidZ = Math.max(
        waterSurfZ + brHeight * 0.72,
        zDeckBot + (isFootpath ? effPathHeight : rHeight)
      ) + microZ;
      const midLinZ = 0.5 * (zEnd0 + zEnd1);
      const reqCrown = Math.max(0.0, minMidZ - midLinZ);
      const subtleCamber = Math.min(0.10, totalArcLen * 0.012);
      const archCrown = Math.max(reqCrown, subtleCamber);

      const zTopArr = new Array(N);
      for (let i = 0; i < N; i++) {
        const t = totalArcLen > 1e-5 ? (spanArc[i] / totalArcLen) : 0;
        const zLin = zEnd0 + (zEnd1 - zEnd0) * t;
        const crown = (i === 0 || i === N - 1) ? 0.0 : archCrown * Math.sin(Math.PI * t);
        zTopArr[i] = Math.max(zDeckBot + 0.06, zLin + crown);
      }

      const deckShell = [];
      const shellId = allocShellId();
      const rampedOk = _emitRampedRibbonShell3D(leftPts, rightPts, zTopArr, zDeckBot, 3, deckShell, 0, shellId);
      const ribbonPoly = rightPts.concat(leftPts.slice().reverse());
      if (!rampedOk) {
        const zFlatTop = Math.max(...zTopArr);
        emitClosedPrism(ribbonPoly, zDeckBot, zFlatTop, 3, deckShell, 0, shellId);
      }
      if (deckShell.length > 0) {
        appendShellClippedToTiles(deckShell, ctx, meshes.roads);
        const cleanContain = cleanPolygonRing(ribbonPoly, true);
        emitPiersAlongSpan(
          spanPts[0][0], spanPts[0][1],
          spanPts[N - 1][0], spanPts[N - 1][1],
          brWidth, zDeckBot,
          cleanContain.length >= 3 ? cleanContain : null
        );
      }
    }
  });

  // ==========================================================================
  // STAGE 3: Harbour Piers, Marina Pontoons, Breakwaters & Groynes
  // Seated solidly on the water basin floor (zSubWater) up to realistic quay/dock
  // deck height even when one or both ends terminate in open water
  // ==========================================================================
  const pierItems = [];
  const hasExtractedBridgePolysPiers = Array.isArray(scene.bridgePolys) &&
    scene.bridgePolys.some(bp => bp && bp.isPier);

  // 3a. Piers carried through scene.bridgePolys (osm_bridges_piers_extract + map_rotation)
  (scene.bridgePolys || []).forEach(bp => {
    if (!bp || !bp.isPier || !bp.outer || bp.outer.length < 3) return;
    pierItems.push({
      bedOuter: bp.outer.map(toBed),
      bedHoles: (bp.holes || []).map(h => h.map(toBed)),
      pierKind: bp.pierKind || 'pier',
      floating: Boolean(bp.floating || bp.pierKind === 'pontoon'),
      isPierLine: Boolean(bp.isPierLine)
    });
  });

  // 3b. Direct scene.pierPolys / scene.pierLines (standalone callers & unit tests)
  (scene.pierPolys || []).forEach(pp => {
    if (!pp || !pp.outer || pp.outer.length < 3) return;
    if (pp._inBridgePolys && hasExtractedBridgePolysPiers) return;
    pierItems.push({
      bedOuter: pp.outer.map(toBed),
      bedHoles: (pp.holes || []).map(h => h.map(toBed)),
      pierKind: pp.pierKind || 'pier',
      floating: Boolean(pp.floating || pp.pierKind === 'pontoon'),
      isPierLine: false
    });
  });

  (scene.pierLines || []).forEach(pl => {
    if (!pl || !pl.pts || pl.pts.length < 2) return;
    if (pl._inBridgePolys && hasExtractedBridgePolysPiers) return;
    const bedPts = pl.pts.map(toBed);
    // Seat shoreward endpoint slightly into quay if right on shoreline bevel
    if (bedPts.length >= 2) {
      const s0 = sampleBilinearMask(waterSDF, bedPts[0][0], bedPts[0][1]);
      if (s0 >= -0.22 && s0 < 0.28) {
        const dx = bedPts[0][0] - bedPts[1][0], dy = bedPts[0][1] - bedPts[1][1], l = Math.hypot(dx, dy) || 1;
        bedPts[0] = [bedPts[0][0] + (dx / l) * 0.30, bedPts[0][1] + (dy / l) * 0.30];
      }
      const last = bedPts.length - 1;
      const s1 = sampleBilinearMask(waterSDF, bedPts[last][0], bedPts[last][1]);
      if (s1 >= -0.22 && s1 < 0.28) {
        const dx = bedPts[last][0] - bedPts[last - 1][0], dy = bedPts[last][1] - bedPts[last - 1][1], l = Math.hypot(dx, dy) || 1;
        bedPts[last] = [bedPts[last][0] + (dx / l) * 0.30, bedPts[last][1] + (dy / l) * 0.30];
      }
    }
    const wBed = Math.max((pl.width || 0.45) * scaleToBed, 0.40 / scaleMm);
    const rings = _bufferBedPolylineToPolys2D(bedPts, wBed);
    for (let i = 0; i < rings.length; i++) {
      pierItems.push({
        bedOuter: rings[i],
        bedHoles: [],
        pierKind: pl.pierKind || 'pier',
        floating: Boolean(pl.floating || pl.pierKind === 'pontoon'),
        isPierLine: true
      });
    }
  });

  // 3c. Legacy cached-scene fallbacks (buildings with btype='pier' and roads with pier/breakwater/groyne)
  (scene.buildings || []).forEach(b => {
    if (!b || b.btype !== 'pier' || !b.outer || b.outer.length < 3) return;
    pierItems.push({
      bedOuter: b.outer.map(toBed),
      bedHoles: (b.holes || []).map(h => h.map(toBed)),
      pierKind: 'pier',
      floating: false,
      isPierLine: false
    });
  });

  (scene.roads || []).forEach(rd => {
    if (!_isPierRoadRecord(rd) || !rd.pts || rd.pts.length < 2) return;
    const bedPts = rd.pts.map(toBed);
    const kind = rd.man_made || rd.hwy || rd.type || 'pier';
    const wBed = Math.max((rd.width || 0.50) * scaleToBed, 0.40 / scaleMm);
    const rings = _bufferBedPolylineToPolys2D(bedPts, wBed);
    for (let i = 0; i < rings.length; i++) {
      pierItems.push({
        bedOuter: rings[i],
        bedHoles: [],
        pierKind: kind,
        floating: kind === 'pontoon',
        isPierLine: true
      });
    }
  });

  const minPierSpan = Math.max(0.24, 0.40 / scaleMm);
  pierItems.forEach((item, pIdx) => {
    let poly = cleanPolygonRing(
      clipPolyToBox(item.bedOuter, -halfW + 0.25, -halfH + 0.25, halfW - 0.25, halfH - 0.25),
      true
    );
    if (poly.length < 3 || Math.abs(signedArea2D(poly)) < 0.015) return;

    const obb = computeMinAreaOBB2D(poly);
    if (!obb) return;

    // Enforce minimum printable width along minor OBB axis only (without stretching pier length)
    if (obb.halfW * 2.0 < minPierSpan && obb.halfW > 1e-4 && (!item.bedHoles || item.bedHoles.length === 0)) {
      const vScale = minPierSpan / (obb.halfW * 2.0);
      const widened = poly.map(pt => {
        const dx = pt[0] - obb.cx, dy = pt[1] - obb.cy;
        const u = dx * obb.ux + dy * obb.uy;
        const v = (dx * obb.vx + dy * obb.vy) * vScale;
        return [
          obb.cx + obb.ux * u + obb.vx * v,
          obb.cy + obb.uy * u + obb.vy * v
        ];
      });
      const wClipped = cleanPolygonRing(
        clipPolyToBox(widened, -halfW + 0.25, -halfH + 0.25, halfW - 0.25, halfH - 0.25),
        true
      );
      if (wClipped.length >= 3 && isSimplePolygon(wClipped) && !hasSelfTouchingEdge2D(wClipped, 2.2e-3)) {
        poly = wClipped;
      }
    }

    // If shore-adjacent linear pier stops within 0.24u of shoreline bevel, extend its shoreward end slightly
    if (item.isPierLine && obb.halfL > 0.35 && (!item.bedHoles || item.bedHoles.length === 0)) {
      const checkShoreSnap = (dirSign) => {
        const ex = obb.cx + obb.ux * (dirSign * obb.halfL);
        const ey = obb.cy + obb.uy * (dirSign * obb.halfL);
        if (isPrintedDryPoint(ex, ey)) return 0.0;
        const nx = ex + obb.ux * (dirSign * 0.32);
        const ny = ey + obb.uy * (dirSign * 0.32);
        return isPrintedDryPoint(nx, ny) ? 0.36 : 0.0;
      };
      const snapNeg = checkShoreSnap(-1);
      const snapPos = checkShoreSnap(+1);
      if (snapNeg > 0 || snapPos > 0) {
        const snapped = poly.map(pt => {
          const dx = pt[0] - obb.cx, dy = pt[1] - obb.cy;
          let u = dx * obb.ux + dy * obb.uy;
          const v = dx * obb.vx + dy * obb.vy;
          if (snapNeg > 0 && u < -obb.halfL + 0.25) u -= snapNeg;
          else if (snapPos > 0 && u > obb.halfL - 0.25) u += snapPos;
          return [
            Math.max(-halfW + 0.25, Math.min(halfW - 0.25, obb.cx + obb.ux * u + obb.vx * v)),
            Math.max(-halfH + 0.25, Math.min(halfH - 0.25, obb.cy + obb.uy * u + obb.vy * v))
          ];
        });
        const sClean = cleanPolygonRing(snapped, true);
        if (sClean.length >= 3 && isSimplePolygon(sClean) && !hasSelfTouchingEdge2D(sClean, 2.2e-3)) {
          poly = sClean;
        }
      }
    }

    // Sample water & dry-bank contact across pier perimeter and interior
    let touchesWater = isWetPoint(obb.cx, obb.cy);
    let touchesLand = false;
    let zLandMin = Infinity;

    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i], p1 = poly[(i + 1) % poly.length];
      for (const q of [p0, [(p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5]]) {
        const sz = getActualPrintedSurfaceMinZ(q[0], q[1]);
        if (sz < baseBottomZ - 1e-4 || sampleBilinearMask(waterSDF, q[0], q[1]) < 0.05) {
          touchesWater = true;
        }
        if (sz >= baseBottomZ - 1e-4) {
          touchesLand = true;
          if (sz < zLandMin) zLandMin = sz;
        }
      }
    }
    if (!touchesWater && !touchesLand) return;

    const zPierBot = touchesWater
      ? pierBasinZ
      : (Number.isFinite(zLandMin) ? zLandMin : baseBottomZ);

    const microZ = (((pIdx) % 5) + 1) * 0.0025;
    let targetTopZ;
    if (item.floating || !touchesLand) {
      // Floating marina pontoons & detached harbour floats: crisp low deck proud above waterSurfZ
      targetTopZ = Math.max(
        waterSurfZ + 0.38 / scaleMm,
        Math.min(baseBottomZ + effPathHeight * 0.25, waterSurfZ + 0.62 / scaleMm)
      );
    } else if (item.pierKind === 'breakwater') {
      const effQuayZ = Math.min(zLandMin, baseBottomZ + 0.85);
      targetTopZ = Math.max(effQuayZ + rHeight * 0.85, waterSurfZ + 0.65 / scaleMm);
    } else {
      // Shore-anchored piers, quayside finger docks, jetties & groynes
      const effQuayZ = Math.min(zLandMin, baseBottomZ + 0.75);
      targetTopZ = Math.max(effQuayZ + effPathHeight * 0.65, waterSurfZ + 0.48 / scaleMm);
    }
    const zPierTop = Math.max(zPierBot + 0.10, quantizeZUnits(targetTopZ) + microZ);

    const holes = (item.bedHoles || [])
      .map(h => clipPolyToBox(h, -halfW + 0.3, -halfH + 0.3, halfW - 0.3, halfH - 0.3))
      .filter(h => h && h.length >= 3);

    const pierShell = [];
    if (holes.length > 0) {
      emitPolygonWithHolesSlab3D(poly, holes, zPierBot, zPierTop, 3, pierShell, 0, allocShellId());
    } else {
      emitClosedPrism(poly, zPierBot, zPierTop, 3, pierShell, 0, allocShellId());
    }
    if (pierShell.length > 0) {
      appendShellClippedToTiles(pierShell, ctx, meshes.roads);
    }
  });
}

if (typeof window !== 'undefined') {
  window.buildBankAnchoredBridges = buildBankAnchoredBridges;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildBankAnchoredBridges };
}
