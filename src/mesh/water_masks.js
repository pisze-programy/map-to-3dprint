// ============================================================================
// src/mesh/water_masks.js
// Water Mask & Smooth Euclidean Signed Distance Field (waterSDF > 0 on land, < 0 in water)
// ============================================================================

if (typeof computeEuclideanDistGrid === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/marching_squares_2d.js'));
}
if (typeof safeGetImageData === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./mesh_tile_append.js'));
}

function _maskPointInPoly2D(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function _maskRingAbsArea2D(ring) {
  if (!ring || ring.length < 3) return 0;
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) * 0.5;
}

function _maskPointToRingDistSq2D(px, py, ring) {
  let minD2 = Infinity;
  for (let i = 0, n = ring.length; i < n; i++) {
    const ax = ring[i][0], ay = ring[i][1];
    const bx = ring[(i + 1) % n][0], by = ring[(i + 1) % n][1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const qx = ax + t * dx, qy = ay + t * dy;
    const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
    if (d2 < minD2) minD2 = d2;
  }
  return minD2;
}

function _maskRingInteriorPt2D(ring) {
  if (!ring || ring.length === 0) return [0, 0];
  let cx = 0, cy = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const x = ring[i][0], y = ring[i][1];
    cx += x; cy += y;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  cx /= ring.length;
  cy /= ring.length;

  let bestPt = null;
  let bestD2 = -1;
  const consider = (px, py) => {
    if (!_maskPointInPoly2D(px, py, ring)) return;
    const d2 = _maskPointToRingDistSq2D(px, py, ring);
    if (d2 > bestD2) { bestD2 = d2; bestPt = [px, py]; }
  };

  consider(cx, cy);
  const steps = 7;
  for (let iy = 1; iy < steps; iy++) {
    const py = minY + (iy / steps) * (maxY - minY);
    for (let ix = 1; ix < steps; ix++) {
      const px = minX + (ix / steps) * (maxX - minX);
      consider(px, py);
    }
  }
  if (!bestPt) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length];
      consider((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3);
    }
  }
  return bestPt || [ring[0][0], ring[0][1]];
}

function _captureAlphaBinaryMask(mctx, w, h, outBuf) {
  const data = safeGetImageData(mctx, 0, 0, w, h).data;
  for (let i = 0, n = w * h; i < n; i++) {
    outBuf[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  }
}

function _fillSingleRingListOnCtx(mctx, rings, toBed, bedToMask) {
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    if (!ring || ring.length < 3) continue;
    mctx.beginPath();
    for (let i = 0; i < ring.length; i++) {
      const b = toBed(ring[i]);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    }
    mctx.closePath();
    mctx.fill();
  }
}

function _isPureOpenSeaScene(scene) {
  if (!scene || scene._fallback) return false;
  if ((scene.buildings || []).some(b => b && !b.hidden && b.btype !== 'pier')) return false;
  if ((scene.greenPolys || []).length > 0) return false;
  if ((scene.trees || []).length > 0) return false;
  if ((scene.roadPolys || []).length > 0) return false;
  if ((scene.roads || []).some(r => r && !r.man_made && !r.floating && !r.isBridge)) return false;

  const dem = scene.dem;
  if (!dem || !Array.isArray(dem.grid) || dem.grid.length < 2) return false;
  let gridMin = Infinity;
  let gridMax = -Infinity;
  let finiteCount = 0;
  for (let r = 0; r < dem.grid.length; r++) {
    const row = dem.grid[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c++) {
      const v = Number(row[c]);
      if (Number.isFinite(v)) {
        finiteCount++;
        if (v < gridMin) gridMin = v;
        if (v > gridMax) gridMax = v;
      }
    }
  }
  if (finiteCount === 0) return false;
  const rawMin = Number.isFinite(dem.minElev) ? Math.min(gridMin, Number(dem.minElev)) : gridMin;
  const rawMax = Number.isFinite(dem.maxElev) ? Math.max(gridMax, Number(dem.maxElev)) : gridMax;
  if (gridMax > 0.5 || rawMax > 0.5 || rawMin > 0.0) return false;
  return Boolean(scene._hasMarineTags) || gridMin < -0.05 || (dem.grid.length >= 4 && gridMax <= 0.05 && Number(dem.maxElev) <= 0.5);
}

function buildWaterMasksAndSDF(scene, mctx, maskEnv) {
  const { MASK_RES_X, MASK_RES_Y, scaleMm, scaleToBed, pxPerUnit, toBed, bedToMask } = maskEnv;
  const totalPixels = MASK_RES_X * MASK_RES_Y;
  const effScaleMm = Math.max(0.5, Number(scaleMm) || (320 / 169.2));

  const rotDeg = Number(scene && scene._appliedRotationDeg) || 0;
  const rotRad = (rotDeg * Math.PI) / 180.0;
  const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad);
  const rotateUnrotRing = (ring) => {
    if (!ring || rotDeg === 0) return ring;
    return ring.map(p => [p[0] * cosR - p[1] * sinR, p[0] * sinR + p[1] * cosR]);
  };

  const waterPolys = (scene && scene.waterPolys) || [];
  const waterLines = (scene && scene.waterLines) || [];
  const isWaterCutout = Boolean(maskEnv && maskEnv.waterCutout);

  // Collect all island/land holes from waterPolys + standalone island/shingle carriers
  const allIslandRings = [];
  const shingleRings = [];
  for (let wi = 0; wi < waterPolys.length; wi++) {
    const wp = waterPolys[wi];
    if (!wp) continue;
    const shIdxSet = new Set(wp.shingleHoleIndices || []);
    const holes = wp.holes || [];
    for (let hi = 0; hi < holes.length; hi++) {
      const h = holes[hi];
      if (!h || h.length < 3) continue;
      allIslandRings.push(h);
      if (shIdxSet.has(hi)) shingleRings.push(h);
    }
    if (Array.isArray(wp._unrotatedLandRings)) {
      for (const lr of wp._unrotatedLandRings) {
        const rr = rotateUnrotRing(lr);
        if (rr && rr.length >= 3) allIslandRings.push(rr);
      }
    }
    if (Array.isArray(wp._unrotatedShingleRings)) {
      for (const sr of wp._unrotatedShingleRings) {
        const rr = rotateUnrotRing(sr);
        if (rr && rr.length >= 3) {
          allIslandRings.push(rr);
          shingleRings.push(rr);
        }
      }
    }
  }

  const hasOpenSeaIslands = isWaterCutout && Array.isArray(scene && scene._openSeaIslands) && scene._openSeaIslands.length > 0;
  if (hasOpenSeaIslands) {
    for (const isl of scene._openSeaIslands) {
      const rr = rotateUnrotRing(isl);
      if (rr && rr.length >= 3) allIslandRings.push(rr);
    }
  }

  const islandInfos = allIslandRings.map(ring => ({
    ring,
    area: _maskRingAbsArea2D(ring)
  })).filter(inf => inf.area > 1e-5);

  // Separate nested island ponds/lakes (strictly inside an island hole & smaller than that island)
  // from primary exterior waterPolys (rivers, harbours, marinas, lakes).
  const primaryWaterPolys = [];
  const nestedLakePolys = [];
  for (let wi = 0; wi < waterPolys.length; wi++) {
    const wp = waterPolys[wi];
    if (!wp || !wp.outer || wp.outer.length < 3) continue;
    const wpArea = _maskRingAbsArea2D(wp.outer);
    const probe = _maskRingInteriorPt2D(wp.outer);
    let isNestedInsideIsland = false;
    for (let ii = 0; ii < islandInfos.length; ii++) {
      const isl = islandInfos[ii];
      if (wpArea >= isl.area * 0.90) continue;
      if (!_maskPointInPoly2D(probe[0], probe[1], isl.ring)) continue;
      let insideVerts = 0;
      for (let k = 0; k < wp.outer.length; k++) {
        if (_maskPointInPoly2D(wp.outer[k][0], wp.outer[k][1], isl.ring)) insideVerts++;
      }
      if (insideVerts >= Math.ceil(wp.outer.length * 0.85)) {
        isNestedInsideIsland = true;
        break;
      }
    }
    if (isNestedInsideIsland) nestedLakePolys.push(wp);
    else primaryWaterPolys.push(wp);
  }

  mctx.fillStyle = '#ffffff';
  mctx.strokeStyle = '#ffffff';
  mctx.lineCap = 'round';
  mctx.lineJoin = 'round';

  // Pass 1: Primary water polygons (or full open-sea cutout under waterCutout=true)
  const polyWaterMask = new Uint8Array(totalPixels);
  if (hasOpenSeaIslands) {
    polyWaterMask.fill(1);
  } else if (primaryWaterPolys.length > 0) {
    mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
    fillPolysOnMaskCtx(mctx, primaryWaterPolys, toBed, bedToMask);
    _captureAlphaBinaryMask(mctx, MASK_RES_X, MASK_RES_Y, polyWaterMask);
  } else if (isWaterCutout && waterLines.length === 0 && _isPureOpenSeaScene(scene)) {
    polyWaterMask.fill(1);
  }

  // Pass 2: Explicit island holes & standalone islands/shoals (enforced across overlapping waterPolys)
  const islandHoleMask = new Uint8Array(totalPixels);
  if (allIslandRings.length > 0) {
    mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
    _fillSingleRingListOnCtx(mctx, allIslandRings, toBed, bedToMask);
    _captureAlphaBinaryMask(mctx, MASK_RES_X, MASK_RES_Y, islandHoleMask);
    for (let i = 0; i < totalPixels; i++) {
      if (islandHoleMask[i]) polyWaterMask[i] = 0;
    }
  }

  // Pass 3: Genuine nested ponds/lakes strictly inside islands
  let nestedLakeMask = null;
  if (nestedLakePolys.length > 0) {
    nestedLakeMask = new Uint8Array(totalPixels);
    mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
    fillPolysOnMaskCtx(mctx, nestedLakePolys, toBed, bedToMask);
    _captureAlphaBinaryMask(mctx, MASK_RES_X, MASK_RES_Y, nestedLakeMask);
    for (let i = 0; i < totalPixels; i++) {
      if (nestedLakeMask[i]) polyWaterMask[i] = 1;
    }
  }

  // Pass 4: Outer hull of all waterPolys (including interior holes) to suppress redundant centerlines
  let hullOuterDist = null;
  if (waterPolys.length > 0 && waterLines.length > 0) {
    const polyOuterHullMask = new Uint8Array(totalPixels);
    mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
    const outerRings = waterPolys.map(wp => wp && wp.outer).filter(r => r && r.length >= 3);
    _fillSingleRingListOnCtx(mctx, outerRings, toBed, bedToMask);
    _captureAlphaBinaryMask(mctx, MASK_RES_X, MASK_RES_Y, polyOuterHullMask);
    hullOuterDist = computeEuclideanDistGrid(polyOuterHullMask, MASK_RES_X, MASK_RES_Y, false);
  }

  // Pass 5: Linear waterways (rivers, canals, streams, ditches) with physical width & hull clipping
  const waterLineMask = new Uint8Array(totalPixels);
  if (waterLines.length > 0) {
    mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
    mctx.fillStyle = '#ffffff';
    mctx.strokeStyle = '#ffffff';
    mctx.lineCap = 'round';
    mctx.lineJoin = 'round';

    const minPrintableBedUnits = ((maskEnv.printSpec && maskEnv.printSpec.minChannelMm) || 0.42) / effScaleMm;
    let drewAnyLine = false;

    for (let li = 0; li < waterLines.length; li++) {
      const wl = waterLines[li];
      if (!wl || !wl.pts || wl.pts.length < 2) continue;
      const rawBedW = (wl.width !== undefined && wl.width > 0 ? wl.width : 0.32) * scaleToBed;
      const effBedW = Math.min(8.5, Math.max(minPrintableBedUnits, rawBedW));
      const lineWidthPx = Math.max(1.2, effBedW * pxPerUnit);

      // Convert polyline to mask pixel space and subdivide to <= 1.0 px spacing
      const maskVerts = wl.pts.map(p => {
        const b = toBed(p);
        return bedToMask(b[0], b[1]);
      });

      if (!hullOuterDist) {
        mctx.lineWidth = lineWidthPx;
        mctx.beginPath();
        for (let i = 0; i < maskVerts.length; i++) {
          const [px, py] = maskVerts[i];
          if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
        }
        mctx.stroke();
        drewAnyLine = true;
        continue;
      }

      const subPts = [maskVerts[0]];
      for (let i = 0; i < maskVerts.length - 1; i++) {
        const a = maskVerts[i], b = maskVerts[i + 1];
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const steps = Math.max(1, Math.ceil(segLen / 1.0));
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          subPts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
      }

      // Suppress segments inside or grazing waterPoly outer hulls (prevents carving islands & inflating narrow creeks)
      const suppressTolPx = Math.max(2.0, lineWidthPx * 0.55);
      const isOutside = new Uint8Array(subPts.length);
      for (let k = 0; k < subPts.length; k++) {
        const sx = Math.round(subPts[k][0]);
        const sy = Math.round(subPts[k][1]);
        if (sx < 0 || sx >= MASK_RES_X || sy < 0 || sy >= MASK_RES_Y) {
          isOutside[k] = 1;
        } else {
          const idx = sy * MASK_RES_X + sx;
          isOutside[k] = hullOuterDist[idx] > suppressTolPx ? 1 : 0;
        }
      }

      const minRunPts = Math.max(3, Math.ceil(Math.max(3.0, lineWidthPx * 0.85)));
      const maxBridgeSteps = Math.ceil(suppressTolPx + 2.5);
      let k = 0;
      while (k < subPts.length) {
        if (!isOutside[k]) { k++; continue; }
        let endK = k;
        while (endK + 1 < subPts.length && isOutside[endK + 1]) endK++;
        let arcPx = 0;
        for (let m = k; m < endK; m++) {
          arcPx += Math.hypot(subPts[m + 1][0] - subPts[m][0], subPts[m + 1][1] - subPts[m][1]);
        }
        if ((endK - k + 1) >= minRunPts || arcPx >= Math.max(3.0, lineWidthPx * 0.85) || (k === 0 && endK === subPts.length - 1)) {
          let drawStart = k;
          let drawEnd = endK;
          // Seamlessly connect external tributary into waterPoly shoreline without touching island holes
          if (k > 0) {
            for (let bStep = 1; bStep <= maxBridgeSteps && (k - bStep) >= 0; bStep++) {
              const bx = Math.round(subPts[k - bStep][0]);
              const by = Math.round(subPts[k - bStep][1]);
              if (bx >= 0 && bx < MASK_RES_X && by >= 0 && by < MASK_RES_Y) {
                const bIdx = by * MASK_RES_X + bx;
                if (islandHoleMask[bIdx]) break;
                drawStart = k - bStep;
                if (polyWaterMask[bIdx]) break;
              }
            }
          }
          if (endK < subPts.length - 1) {
            for (let fStep = 1; fStep <= maxBridgeSteps && (endK + fStep) < subPts.length; fStep++) {
              const fx = Math.round(subPts[endK + fStep][0]);
              const fy = Math.round(subPts[endK + fStep][1]);
              if (fx >= 0 && fx < MASK_RES_X && fy >= 0 && fy < MASK_RES_Y) {
                const fIdx = fy * MASK_RES_X + fx;
                if (islandHoleMask[fIdx]) break;
                drawEnd = endK + fStep;
                if (polyWaterMask[fIdx]) break;
              }
            }
          }

          mctx.lineWidth = lineWidthPx;
          mctx.beginPath();
          for (let m = drawStart; m <= drawEnd; m++) {
            const [px, py] = subPts[m];
            if (m === drawStart) mctx.moveTo(px, py); else mctx.lineTo(px, py);
          }
          mctx.stroke();
          drewAnyLine = true;
        }
        k = endK + 1;
      }
    }

    if (drewAnyLine) {
      _captureAlphaBinaryMask(mctx, MASK_RES_X, MASK_RES_Y, waterLineMask);
    }
  }

  // Combine polygon water + linear waterways, keeping explicit islands strictly dry (except nested island lakes)
  const waterMask = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    let w = (polyWaterMask[i] || waterLineMask[i]) ? 1 : 0;
    if (w && islandHoleMask[i] && !(nestedLakeMask && nestedLakeMask[i])) {
      w = 0;
    }
    waterMask[i] = w;
  }

  // Sub-cell Nyquist guard for tiny rock islets (e.g. Tuzo Rock): ensure explicit islands surrounded by water
  // cover at least 1 terrain zGrid vertex (half-diagonal of ~0.94u cell = 0.67u) so they never drown underwater.
  const minIsletRadiusPx = Math.max(2.0, 0.70 * pxPerUnit);
  const minIsletRadiusSq = minIsletRadiusPx * minIsletRadiusPx;
  for (let ii = 0; ii < islandInfos.length; ii++) {
    const ring = islandInfos[ii].ring;
    const bedRing = ring.map(toBed);
    const bedArea = _maskRingAbsArea2D(bedRing);
    if (bedArea <= 0 || bedArea > 1.85) continue;
    if (isWaterCutout && (bedArea * effScaleMm * effScaleMm) < 6.0) continue;
    const probeBed = _maskRingInteriorPt2D(bedRing);
    const [cxPx, cyPx] = bedToMask(probeBed[0], probeBed[1]);
    const ix = Math.round(cxPx), iy = Math.round(cyPx);
    if (ix < 2 || ix >= MASK_RES_X - 2 || iy < 2 || iy >= MASK_RES_Y - 2) continue;
    // Only apply if surrounded by water in local neighborhood
    let nearbyWater = 0;
    const chkR = Math.ceil(minIsletRadiusPx + 2);
    for (let dy = -chkR; dy <= chkR; dy += 2) {
      const ny = iy + dy;
      if (ny < 0 || ny >= MASK_RES_Y) continue;
      for (let dx = -chkR; dx <= chkR; dx += 2) {
        const nx = ix + dx;
        if (nx >= 0 && nx < MASK_RES_X && waterMask[ny * MASK_RES_X + nx]) nearbyWater++;
      }
    }
    if (nearbyWater < 4) continue;
    const rCeil = Math.ceil(minIsletRadiusPx);
    for (let dy = -rCeil; dy <= rCeil; dy++) {
      const ny = iy + dy;
      if (ny < 0 || ny >= MASK_RES_Y) continue;
      for (let dx = -rCeil; dx <= rCeil; dx++) {
        if (dx * dx + dy * dy > minIsletRadiusSq) continue;
        const nx = ix + dx;
        if (nx >= 0 && nx < MASK_RES_X) {
          waterMask[ny * MASK_RES_X + nx] = 0;
        }
      }
    }
  }

  // Filter out disconnected micro-islets (< 6.0 mm²) exclusively when waterCutout is active,
  // protecting any dry ground carrying buildings, bridge abutments, or touching the frame border.
  if (isWaterCutout) {
    const halfWEnv = Number(maskEnv && maskEnv.halfW) || 84.6;
    const halfHEnv = Number(maskEnv && maskEnv.halfH) || 84.6;
    const padWEnv = Number(maskEnv && maskEnv.padW) || (halfWEnv + 0.4);
    const padHEnv = Number(maskEnv && maskEnv.padH) || (halfHEnv + 0.4);
    const spanWEnv = Number(maskEnv && maskEnv.spanW) || (2 * padWEnv);
    const spanHEnv = Number(maskEnv && maskEnv.spanH) || (2 * padHEnv);
    const pxAreaMm2 = ((spanWEnv / MASK_RES_X) * effScaleMm) * ((spanHEnv / MASK_RES_Y) * effScaleMm);
    const minIsletPx = Math.max(2, Math.ceil(6.0 / Math.max(1e-6, pxAreaMm2)));

    let hasAnyWater = false;
    let hasAnyDry = false;
    for (let i = 0; i < totalPixels; i++) {
      if (waterMask[i]) hasAnyWater = true;
      else hasAnyDry = true;
      if (hasAnyWater && hasAnyDry) break;
    }

    if (hasAnyWater && hasAnyDry) {
      const protectedDry = new Uint8Array(totalPixels);
      mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
      mctx.fillStyle = '#ffffff';
      mctx.strokeStyle = '#ffffff';
      mctx.lineCap = 'round';
      mctx.lineJoin = 'round';

      const bldRings = [];
      for (const b of (scene && scene.buildings) || []) {
        if (!b || b.hidden || b.btype === 'pier' || b.isOutline || !b.outer || b.outer.length < 3) continue;
        bldRings.push(b.outer);
      }
      if (bldRings.length > 0) {
        _fillSingleRingListOnCtx(mctx, bldRings, toBed, bedToMask);
      }

      const bridgePolysList = [];
      for (const bp of (scene && scene.bridgePolys) || []) {
        if (!bp || bp.btype === 'pier' || bp.floating || !bp.outer || bp.outer.length < 3) continue;
        bridgePolysList.push(bp.outer);
      }
      if (bridgePolysList.length > 0) {
        _fillSingleRingListOnCtx(mctx, bridgePolysList, toBed, bedToMask);
      }

      for (const rd of (scene && scene.roads) || []) {
        if (!rd || !rd.isBridge || !rd.pts || rd.pts.length < 2) continue;
        mctx.lineWidth = Math.max(2.5, ((rd.width || 0.8) * scaleToBed) * pxPerUnit);
        mctx.beginPath();
        for (let k = 0; k < rd.pts.length; k++) {
          const b = toBed(rd.pts[k]);
          const [px, py] = bedToMask(b[0], b[1]);
          if (k === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
        }
        mctx.stroke();
      }
      _captureAlphaBinaryMask(mctx, MASK_RES_X, MASK_RES_Y, protectedDry);

      const visited = new Uint8Array(totalPixels);
      const queue = new Int32Array(totalPixels);
      for (let startIdx = 0; startIdx < totalPixels; startIdx++) {
        if (waterMask[startIdx] !== 0 || visited[startIdx]) continue;
        let head = 0;
        let tail = 0;
        visited[startIdx] = 1;
        queue[tail++] = startIdx;
        let touchesBoundary = false;
        let touchesProtected = false;
        let touchesWater = false;

        while (head < tail) {
          const idx = queue[head++];
          const x = idx % MASK_RES_X;
          const y = (idx - x) / MASK_RES_X;
          if (x <= 2 || x >= MASK_RES_X - 3 || y <= 2 || y >= MASK_RES_Y - 3) {
            touchesBoundary = true;
          } else {
            const bx = ((x + 0.5) / MASK_RES_X) * spanWEnv - padWEnv;
            const by = padHEnv - ((y + 0.5) / MASK_RES_Y) * spanHEnv;
            if (Math.abs(bx) >= halfWEnv - 0.5 || Math.abs(by) >= halfHEnv - 0.5) {
              touchesBoundary = true;
            }
          }
          if (protectedDry[idx]) touchesProtected = true;

          if (x > 0) {
            const n = idx - 1;
            if (waterMask[n] !== 0) touchesWater = true;
            else if (!visited[n]) { visited[n] = 1; queue[tail++] = n; }
          }
          if (x + 1 < MASK_RES_X) {
            const n = idx + 1;
            if (waterMask[n] !== 0) touchesWater = true;
            else if (!visited[n]) { visited[n] = 1; queue[tail++] = n; }
          }
          if (y > 0) {
            const n = idx - MASK_RES_X;
            if (waterMask[n] !== 0) touchesWater = true;
            else if (!visited[n]) { visited[n] = 1; queue[tail++] = n; }
          }
          if (y + 1 < MASK_RES_Y) {
            const n = idx + MASK_RES_X;
            if (waterMask[n] !== 0) touchesWater = true;
            else if (!visited[n]) { visited[n] = 1; queue[tail++] = n; }
          }
        }

        if (touchesWater && !touchesBoundary && !touchesProtected && tail < minIsletPx) {
          for (let k = 0; k < tail; k++) {
            waterMask[queue[k]] = 1;
          }
        }
      }
    }
  }

  // Optional shingle / shoal gravel-bar mask (kept flat at riverbed terrace step 0)
  let shingleMask = null;
  if (shingleRings.length > 0) {
    shingleMask = new Uint8Array(totalPixels);
    mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
    _fillSingleRingListOnCtx(mctx, shingleRings, toBed, bedToMask);
    _captureAlphaBinaryMask(mctx, MASK_RES_X, MASK_RES_Y, shingleMask);
  }

  const waterDepth = computeEuclideanDistGrid(waterMask, MASK_RES_X, MASK_RES_Y, true);
  const shoreDist = computeEuclideanDistGrid(waterMask, MASK_RES_X, MASK_RES_Y, false);

  // Half-pixel centered Euclidean SDF eliminates 2.0-px shoreline step discontinuity & diagonal staircase artifacts
  const rawWaterSDF = new Float32Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const signedPx = waterMask[i] ? -(waterDepth[i] - 0.5) : (shoreDist[i] - 0.5);
    rawWaterSDF[i] = signedPx / pxPerUnit;
  }

  let waterSDF = rawWaterSDF;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(totalPixels);
    for (let y = 0; y < MASK_RES_Y; y++) {
      for (let x = 0; x < MASK_RES_X; x++) {
        let sum = 0, wSum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = Math.min(MASK_RES_Y - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const nx = Math.min(MASK_RES_X - 1, Math.max(0, x + dx));
            const w = (dx === 0 && dy === 0) ? 4 : (dx === 0 || dy === 0) ? 2 : 1;
            sum += waterSDF[ny * MASK_RES_X + nx] * w;
            wSum += w;
          }
        }
        const idx = y * MASK_RES_X + x;
        let val = sum / wSum;
        // Preserve sign of true land/water mask and protect narrow islands/peninsulas from erosion
        if (!waterMask[idx]) {
          const minLandFloor = Math.max(0.004, Math.min(0.10, rawWaterSDF[idx] * 0.45));
          if (val < minLandFloor) val = minLandFloor;
        } else if (val > -0.004) {
          val = -0.004;
        }
        next[idx] = val;
      }
    }
    waterSDF = next;
  }

  if (shingleMask) {
    for (let i = 0; i < totalPixels; i++) {
      if (shingleMask[i] && !waterMask[i] && waterSDF[i] > 0.055) {
        waterSDF[i] = 0.055;
      }
    }
  }

  return { waterMask, waterDepth, shoreDist, waterSDF };
}

if (typeof window !== 'undefined') {
  window.buildWaterMasksAndSDF = buildWaterMasksAndSDF;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildWaterMasksAndSDF };
}
