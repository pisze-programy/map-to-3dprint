// ============================================================================
// src/mesh/features_roads.js
// Roads & Footpaths Layer: Analytical Subpixel SDF, Unpinched Micro-Patch
// Extraction & Continuous Watertight DEM/Greenery 3D Draping
// ============================================================================

if (typeof cleanPolygonRing === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'), require('../geometry/obb_medial_2d.js'));
}
if (typeof computeEuclideanDistGrid === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/marching_squares_2d.js'));
}
if (typeof emitClosedPrism === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./mesh_primitives.js'));
}
if (typeof buildSmoothedBandField === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./mesh_tile_append.js'));
}

function isFootpathRoad(rd) {
  if (rd.isPath) return true;
  const rtype = rd.hwy || rd.type || rd.rtype || '';
  return rtype === 'footway' || rtype === 'path' || rtype === 'steps' ||
         rtype === 'cycleway' || rtype === 'bridleway' || rtype === 'track' || rtype === 'corridor';
}

function isStreetSkippedAtMajorLod(rtype) {
  return rtype === 'service' || rtype === 'living_street' || rtype === 'track' ||
         rtype === 'path' || rtype === 'footway' || rtype === 'cycleway' ||
         rtype === 'steps' || rtype === 'pedestrian';
}

function rasterizeRoadAndFootpathImages(scene, state, mctx, maskEnv) {
  const { MASK_RES_X, MASK_RES_Y, scaleMm, scaleToBed, pxPerUnit, toBed, bedToMask } = maskEnv;

  const lod = (state && state.lodSettings) || {};
  const spanKm = Number(state.spanKm) || (Number(state.mapSpanMeters) / 1000) || ((scene.spanMeters || 1200) / 1000);
  const roadDetail = lod.roadDetail || (spanKm > 20.0 ? 'major' : 'all');
  const nPix = MASK_RES_X * MASK_RES_Y;

  // 1. Plazas / squares, yielding interior garden wedges to explicit greenPolys (e.g. Gärtnerplatz)
  const plazaAlpha = new Uint8Array(nPix);
  if (scene.roadPolys && scene.roadPolys.length > 0) {
    mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
    fillPolysOnMaskCtx(mctx, scene.roadPolys, toBed, bedToMask);
    mctx.lineWidth = 1.6;
    (scene.roadPolys || []).forEach(poly => {
      if (!poly || !poly.outer || poly.outer.length < 3) return;
      mctx.beginPath();
      poly.outer.forEach((p, i) => {
        const b = toBed(p);
        const [px, py] = bedToMask(b[0], b[1]);
        if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
      });
      mctx.closePath();
      mctx.stroke();
    });
    const pData = safeGetImageData(mctx, 0, 0, MASK_RES_X, MASK_RES_Y).data;
    for (let i = 0; i < nPix; i++) {
      if (pData[i * 4 + 3] > 96) plazaAlpha[i] = 255;
    }
    if (scene.greenPolys && scene.greenPolys.length > 0) {
      mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
      fillPolysOnMaskCtx(mctx, scene.greenPolys, toBed, bedToMask);
      const gData = safeGetImageData(mctx, 0, 0, MASK_RES_X, MASK_RES_Y).data;
      for (let i = 0; i < nPix; i++) {
        if (gData[i * 4 + 3] > 96) plazaAlpha[i] = 0;
      }
    }
  }

  // 2. Linear streets (carve through parks & rotary squares cleanly with 1px lawn clearance)
  mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
  (scene.roads || []).forEach(rd => {
    if (!rd.pts || rd.pts.length < 2 || isFootpathRoad(rd)) return;
    const rtype = rd.hwy || rd.type || rd.rtype || '';
    if (roadDetail === 'major' && isStreetSkippedAtMajorLod(rtype)) return;
    const minWUnits = Math.max((rd.width || 1.0) * 0.90 * scaleToBed, 0.48 / scaleMm);
    const minRoadPx = (rtype === 'service' || rtype === 'living_street') ? 3.0 : 3.3;
    mctx.lineWidth = Math.max(minRoadPx, minWUnits * pxPerUnit + 1.15);
    mctx.beginPath();
    rd.pts.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.stroke();
  });
  const streetData = safeGetImageData(mctx, 0, 0, MASK_RES_X, MASK_RES_Y).data;
  const majorRoadImg = new Uint8ClampedArray(nPix * 4);
  for (let i = 0; i < nPix; i++) {
    const a = plazaAlpha[i] > streetData[i * 4 + 3] ? plazaAlpha[i] : streetData[i * 4 + 3];
    if (a > 0) {
      const k = i * 4;
      majorRoadImg[k] = 255;
      majorRoadImg[k + 1] = 255;
      majorRoadImg[k + 2] = 255;
      majorRoadImg[k + 3] = a;
    }
  }

  // 3. Linear footpaths / park trails / steps (copied to independent buffer)
  mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
  if (roadDetail !== 'major') {
    (scene.roads || []).forEach(rd => {
      if (!rd.pts || rd.pts.length < 2 || !isFootpathRoad(rd)) return;
      const pathWUnits = Math.max(Math.min(0.62, rd.width || 0.36) * scaleToBed, 0.38 / scaleMm);
      mctx.lineWidth = Math.max(2.4, pathWUnits * pxPerUnit + 0.20);
      mctx.beginPath();
      rd.pts.forEach((p, i) => {
        const b = toBed(p);
        const [px, py] = bedToMask(b[0], b[1]);
        if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
      });
      mctx.stroke();
    });
  }
  const footpathImg = new Uint8ClampedArray(safeGetImageData(mctx, 0, 0, MASK_RES_X, MASK_RES_Y).data);

  return { majorRoadImg, footpathImg };
}

function dilateBinaryMask2Px(srcMask, w, h, dstMask) {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const y0 = y > 1 ? y - 2 : 0;
    const y1 = y + 2 < h ? y + 2 : h - 1;
    for (let x = 0; x < w; x++) {
      if (!srcMask[row + x]) continue;
      const x0 = x > 1 ? x - 2 : 0;
      const x1 = x + 2 < w ? x + 2 : w - 1;
      for (let ny = y0; ny <= y1; ny++) {
        const dy2 = (ny - y) * (ny - y);
        const nRow = ny * w;
        for (let nx = x0; nx <= x1; nx++) {
          if ((nx - x) * (nx - x) + dy2 <= 5) {
            dstMask[nRow + nx] = 1;
          }
        }
      }
    }
  }
}

function finalizeRoadAndFootpathMasks(majorRoadImg, footpathImg, waterMask, _shoreDist, bldMask, greenMask, _greenInnerDist, _greenOuterDist, MASK_RES_X, MASK_RES_Y) {
  const nPix = MASK_RES_X * MASK_RES_Y;
  const majorRoadMask = new Uint8Array(nPix);
  for (let i = 0; i < nPix; i++) {
    majorRoadMask[i] = (majorRoadImg[i * 4 + 3] > 96 && !waterMask[i] && !bldMask[i]) ? 1 : 0;
  }

  const majorRoadDist = computeEuclideanDistGrid(majorRoadMask, MASK_RES_X, MASK_RES_Y, false);

  const parkPathOnGreenMask = new Uint8Array(nPix);
  const parkPathOnGroundMask = new Uint8Array(nPix);
  const rawRoadOrPath = new Uint8Array(nPix);

  for (let i = 0; i < nPix; i++) {
    const hasFoot = footpathImg[i * 4 + 3] > 96 && !waterMask[i] && !bldMask[i];
    if (hasFoot && greenMask[i] && !majorRoadMask[i]) {
      parkPathOnGreenMask[i] = 1;
    } else if (hasFoot && !greenMask[i] && !majorRoadMask[i]) {
      parkPathOnGroundMask[i] = 1;
    }
    if (majorRoadMask[i] || parkPathOnGreenMask[i] || parkPathOnGroundMask[i]) {
      rawRoadOrPath[i] = 1;
    }
  }

  const roadAndBldMask = new Uint8Array(bldMask);
  dilateBinaryMask2Px(rawRoadOrPath, MASK_RES_X, MASK_RES_Y, roadAndBldMask);

  return { majorRoadMask, majorRoadDist, parkPathOnGreenMask, parkPathOnGroundMask, roadAndBldMask };
}

// ============================================================================
// Fast Scanline Polygon Fill & Analytical Subpixel Distance Helpers
// ============================================================================

function fillPolygonEvenOddOnGrid2D(outerRing, holeRings, gridMask, nx, ny, xMin, yMin, invDx, invDy) {
  if (!outerRing || outerRing.length < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < outerRing.length; i++) {
    const y = outerRing[i][1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const iy0 = Math.max(0, Math.ceil((minY - yMin) * invDy));
  const iy1 = Math.min(ny - 1, Math.floor((maxY - yMin) * invDy));
  if (iy0 > iy1) return;

  const eX0 = [];
  const eYMin = [];
  const eYMax = [];
  const eInvSlope = [];
  const pushRingEdges = (ring) => {
    if (!ring || ring.length < 3) return;
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const dy = b[1] - a[1];
      if (Math.abs(dy) < 1e-12) continue;
      if (a[1] < b[1]) {
        eX0.push(a[0]); eYMin.push(a[1]); eYMax.push(b[1]); eInvSlope.push((b[0] - a[0]) / dy);
      } else {
        eX0.push(b[0]); eYMin.push(b[1]); eYMax.push(a[1]); eInvSlope.push((a[0] - b[0]) / (-dy));
      }
    }
  };
  pushRingEdges(outerRing);
  if (holeRings) {
    for (let h = 0; h < holeRings.length; h++) pushRingEdges(holeRings[h]);
  }
  const nEdges = eX0.length;
  if (nEdges < 2) return;

  const stepY = 1.0 / invDy;
  const xs = [];
  for (let iy = iy0; iy <= iy1; iy++) {
    const sy = yMin + iy * stepY + 1.37e-7;
    xs.length = 0;
    for (let e = 0; e < nEdges; e++) {
      const ym0 = eYMin[e];
      if (sy >= ym0 && sy < eYMax[e]) {
        xs.push(eX0[e] + (sy - ym0) * eInvSlope[e]);
      }
    }
    const m = xs.length;
    if (m < 2) continue;
    if (m === 2) {
      if (xs[0] > xs[1]) { const tmp = xs[0]; xs[0] = xs[1]; xs[1] = tmp; }
    } else {
      xs.sort((a, b) => a - b);
    }
    const row = iy * nx;
    for (let k = 0; k + 1 < m; k += 2) {
      const ix0 = Math.max(0, Math.ceil((xs[k] - xMin) * invDx));
      const ix1 = Math.min(nx - 1, Math.floor((xs[k + 1] - xMin) * invDx));
      for (let ix = ix0; ix <= ix1; ix++) {
        gridMask[row + ix] = 1;
      }
    }
  }
}

function splatSegmentMinDistSqActive2D(ax, ay, bx, by, pad, minDistSq, streetSDF, pathSDF, nx, ny, xMin, yMin, dx, dy, invDx, invDy) {
  const ix0 = Math.max(0, Math.floor((Math.min(ax, bx) - pad - xMin) * invDx));
  const ix1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + pad - xMin) * invDx));
  const iy0 = Math.max(0, Math.floor((Math.min(ay, by) - pad - yMin) * invDy));
  const iy1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by) + pad - yMin) * invDy));
  if (ix0 > ix1 || iy0 > iy1) return;

  const vx = bx - ax, vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const invL2 = l2 > 1e-12 ? (1.0 / l2) : 0.0;

  for (let iy = iy0; iy <= iy1; iy++) {
    const py = yMin + iy * dy;
    const dyA = py - ay;
    const row = iy * nx;
    for (let ix = ix0; ix <= ix1; ix++) {
      const idx = row + ix;
      if (streetSDF[idx] <= 0.01 && pathSDF[idx] <= 0.01) continue;
      const px = xMin + ix * dx;
      const dxA = px - ax;
      let d2;
      if (invL2 === 0.0) {
        d2 = dxA * dxA + dyA * dyA;
      } else {
        let t = (dxA * vx + dyA * vy) * invL2;
        if (t < 0.0) t = 0.0; else if (t > 1.0) t = 1.0;
        const ex = dxA - t * vx, ey = dyA - t * vy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 < minDistSq[idx]) minDistSq[idx] = d2;
    }
  }
}

function splatSegmentSDFMaxOnGrid2D(ax, ay, bx, by, r, hCell, sdfGrid, nx, ny, xMin, yMin, dx, dy, invDx, invDy) {
  const reach = r + hCell * 0.65;
  const ix0 = Math.max(1, Math.floor((Math.min(ax, bx) - reach - xMin) * invDx));
  const ix1 = Math.min(nx - 2, Math.ceil((Math.max(ax, bx) + reach - xMin) * invDx));
  const iy0 = Math.max(1, Math.floor((Math.min(ay, by) - reach - yMin) * invDy));
  const iy1 = Math.min(ny - 2, Math.ceil((Math.max(ay, by) + reach - yMin) * invDy));
  if (ix0 > ix1 || iy0 > iy1) return;

  const vx = bx - ax, vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const invL2 = l2 > 1e-12 ? (1.0 / l2) : 0.0;
  const invH = 1.0 / hCell;
  const reachSq = reach * reach;

  for (let iy = iy0; iy <= iy1; iy++) {
    const py = yMin + iy * dy;
    const dyA = py - ay;
    const row = iy * nx;
    for (let ix = ix0; ix <= ix1; ix++) {
      const idx = row + ix;
      if (sdfGrid[idx] >= 0.999) continue;
      const px = xMin + ix * dx;
      const dxA = px - ax;
      let d2;
      if (invL2 === 0.0) {
        d2 = dxA * dxA + dyA * dyA;
      } else {
        let t = (dxA * vx + dyA * vy) * invL2;
        if (t < 0.0) t = 0.0; else if (t > 1.0) t = 1.0;
        const ex = dxA - t * vx, ey = dyA - t * vy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 >= reachSq) continue;
      const val = Math.min(1.0, 0.5 + (r - Math.sqrt(d2)) * invH);
      if (val > sdfGrid[idx]) sdfGrid[idx] = val;
    }
  }
}

function collectPrintedBuildingFootprints2D(scene, ctx, state) {
  const rawBuildings = scene.buildings || [];
  if (rawBuildings.length === 0) return [];
  const { halfW, halfH, scaleMm, mToU, toBed } = ctx;

  const BG = 32;
  const spanX = 2 * halfW, spanY = 2 * halfH;
  const childBuckets = new Array(BG * BG);
  const childGroupIds = new Set();
  let childCount = 0;
  const bedOuterCache = new Array(rawBuildings.length);

  for (let i = 0; i < rawBuildings.length; i++) {
    const b = rawBuildings[i];
    if (b.hidden || b.btype === 'pier' || !b.outer || b.outer.length < 3) continue;
    if (b.part) {
      const bedPoly = b.outer.map(toBed);
      bedOuterCache[i] = bedPoly;
      if (b.groupId) childGroupIds.add(b.groupId);
      let cx = 0, cy = 0;
      for (let k = 0; k < bedPoly.length; k++) { cx += bedPoly[k][0]; cy += bedPoly[k][1]; }
      cx /= bedPoly.length; cy /= bedPoly.length;
      const bx = Math.max(0, Math.min(BG - 1, Math.floor(((cx + halfW) / spanX) * BG)));
      const by = Math.max(0, Math.min(BG - 1, Math.floor(((cy + halfH) / spanY) * BG)));
      const cell = by * BG + bx;
      let list = childBuckets[cell];
      if (!list) childBuckets[cell] = list = [];
      list.push({ cx, cy, area: Math.abs(signedArea2D(bedPoly)) });
      childCount++;
    }
  }

  const suppressedIdx = new Uint8Array(rawBuildings.length);
  for (let i = 0; i < rawBuildings.length; i++) {
    const b = rawBuildings[i];
    if (b.hidden || b.btype === 'pier' || !b.outer || b.outer.length < 3) continue;
    if (b.isOutline) { suppressedIdx[i] = 1; continue; }
    if (!b.part && childCount > 0) {
      if ((b.id && childGroupIds.has(b.id)) || (b.osmId && childGroupIds.has(b.osmId))) {
        suppressedIdx[i] = 1;
        continue;
      }
      const bOuterBed = b.outer.map(toBed);
      bedOuterCache[i] = bOuterBed;
      let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
      for (let k = 0; k < bOuterBed.length; k++) {
        const p = bOuterBed[k];
        if (p[0] < bMinX) bMinX = p[0]; if (p[0] > bMaxX) bMaxX = p[0];
        if (p[1] < bMinY) bMinY = p[1]; if (p[1] > bMaxY) bMaxY = p[1];
      }
      const bArea = Math.abs(signedArea2D(bOuterBed));
      if (bArea < 1e-4) continue;
      const bx0 = Math.max(0, Math.min(BG - 1, Math.floor(((bMinX + halfW) / spanX) * BG)));
      const bx1 = Math.max(0, Math.min(BG - 1, Math.floor(((bMaxX + halfW) / spanX) * BG)));
      const by0 = Math.max(0, Math.min(BG - 1, Math.floor(((bMinY + halfH) / spanY) * BG)));
      const by1 = Math.max(0, Math.min(BG - 1, Math.floor(((bMaxY + halfH) / spanY) * BG)));
      let childAreaSum = 0;
      for (let by = by0; by <= by1 && childAreaSum < bArea * 0.30; by++) {
        const r = by * BG;
        for (let bx = bx0; bx <= bx1; bx++) {
          const list = childBuckets[r + bx];
          if (!list) continue;
          for (let j = 0; j < list.length; j++) {
            const ce = list[j];
            if (ce.cx < bMinX || ce.cx > bMaxX || ce.cy < bMinY || ce.cy > bMaxY) continue;
            if (pointInPoly2D(ce.cx, ce.cy, bOuterBed)) {
              childAreaSum += ce.area;
            }
          }
        }
      }
      if (childAreaSum >= bArea * 0.30) suppressedIdx[i] = 1;
    }
  }

  const minPrintMm = 0.35;
  const minPrintUnits = minPrintMm / scaleMm;
  const metersPerMm = 1.0 / ((mToU || 0.14) * scaleMm);
  const lodMin = state && state.lodSettings && (
    typeof state.lodSettings.minBuildingFootprintM === 'number' ? state.lodSettings.minBuildingFootprintM :
    typeof state.lodSettings.minBuildingMeters === 'number' ? state.lodSettings.minBuildingMeters : 0
  );
  const effectiveMinMeters = Math.max(lodMin || 0, minPrintMm * metersPerMm);

  const active = [];
  for (let i = 0; i < rawBuildings.length; i++) {
    const b = rawBuildings[i];
    if (b.hidden || b.btype === 'pier' || suppressedIdx[i] || !b.outer || b.outer.length < 3) continue;
    const rawOuterBed = bedOuterCache[i] || b.outer.map(toBed);
    const outerBed = clipPolyToBox(rawOuterBed, -halfW + 0.38, -halfH + 0.38, halfW - 0.38, halfH - 0.38);
    if (outerBed.length < 3) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < outerBed.length; k++) {
      const p = outerBed[k];
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    const minSpan = Math.min(maxX - minX, maxY - minY);
    const area = Math.abs(signedArea2D(outerBed));
    if (area < 1e-4) continue;

    const isImportant = Boolean(b.part || b.tower || b.church || b.landmark || (b.h || 0) >= 20 || b.isLandmark);
    if (!isImportant && mToU) {
      const spanM = minSpan / mToU;
      const areaM2 = area / (mToU * mToU);
      if (minSpan < minPrintUnits || spanM < effectiveMinMeters || areaM2 < effectiveMinMeters * effectiveMinMeters * 0.65) {
        continue;
      }
    }

    const holesBed = [];
    if (b.holes && b.holes.length > 0) {
      for (let h = 0; h < b.holes.length; h++) {
        if (!b.holes[h] || b.holes[h].length < 3) continue;
        const hc = clipPolyToBox(b.holes[h].map(toBed), -halfW + 0.38, -halfH + 0.38, halfW - 0.38, halfH - 0.38);
        if (hc.length >= 3) holesBed.push(hc);
      }
    }
    active.push({ outer: outerBed, holes: holesBed, minX, maxX, minY, maxY });
  }
  return active;
}

function buildAnalyticalRoadFields(scene, ctx, state, greenVisible) {
  const {
    MASK_RES_X, MASK_RES_Y, numTiles,
    halfW, halfH, padW, padH, spanW, spanH,
    scaleMm, scaleToBed, toBed, sampleBilinearMask, waterSDF
  } = ctx;

  const isStressGrid = ((numTiles || ((ctx.tileCols || 1) * (ctx.tileRows || 1))) > 400) && !ctx.isExport;
  const resScale = isStressGrid ? 0.36 : 0.85;
  const nx = Math.min(820, Math.max(256, Math.round(MASK_RES_X * resScale)));
  const ny = Math.min(820, Math.max(256, Math.round(MASK_RES_Y * resScale)));
  const xMin = -padW + 0.5 * (spanW / nx);
  const xMax = padW - 0.5 * (spanW / nx);
  const yMin = -padH + 0.5 * (spanH / ny);
  const yMax = padH - 0.5 * (spanH / ny);
  const dx = (xMax - xMin) / (nx - 1);
  const dy = (yMax - yMin) / (ny - 1);
  const invDx = 1.0 / dx;
  const invDy = 1.0 / dy;
  const hCell = Math.max(dx, dy);
  const nGrid = nx * ny;

  const lod = (state && state.lodSettings) || {};
  const spanKm = Number(state.spanKm) || (Number(state.mapSpanMeters) / 1000) || ((scene.spanMeters || 1200) / 1000);
  const roadDetail = lod.roadDetail || (spanKm > 20.0 ? 'major' : 'all');

  const streetSDF = new Float32Array(nGrid);
  const pathSDF = new Float32Array(nGrid);

  // 1. Plazas & squares (minus explicit park/garden polygons inside rotary squares)
  if (scene.roadPolys && scene.roadPolys.length > 0) {
    const plazaMask = new Uint8Array(nGrid);
    for (let i = 0; i < scene.roadPolys.length; i++) {
      const rp = scene.roadPolys[i];
      if (!rp || !rp.outer || rp.outer.length < 3) continue;
      const outerBed = rp.outer.map(toBed);
      const holesBed = (rp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed));
      fillPolygonEvenOddOnGrid2D(outerBed, holesBed, plazaMask, nx, ny, xMin, yMin, invDx, invDy);
    }
    if (greenVisible && scene.greenPolys && scene.greenPolys.length > 0) {
      const greenInside = new Uint8Array(nGrid);
      for (let i = 0; i < scene.greenPolys.length; i++) {
        const gp = scene.greenPolys[i];
        if (!gp || !gp.outer || gp.outer.length < 3) continue;
        const outerBed = gp.outer.map(toBed);
        const holesBed = (gp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed));
        fillPolygonEvenOddOnGrid2D(outerBed, holesBed, greenInside, nx, ny, xMin, yMin, invDx, invDy);
      }
      for (let i = 0; i < nGrid; i++) {
        if (greenInside[i]) plazaMask[i] = 0;
      }
    }
    for (let iy = 1; iy < ny - 1; iy++) {
      const r = iy * nx;
      for (let ix = 1; ix < nx - 1; ix++) {
        const sum =
          plazaMask[r - nx + ix - 1] + 2 * plazaMask[r - nx + ix] + plazaMask[r - nx + ix + 1] +
          2 * plazaMask[r + ix - 1] + 8 * plazaMask[r + ix] + 2 * plazaMask[r + ix + 1] +
          plazaMask[r + nx + ix - 1] + 2 * plazaMask[r + nx + ix] + plazaMask[r + nx + ix + 1];
        if (sum > 0) streetSDF[r + ix] = sum / 20.0;
      }
    }
  }

  // 2. Analytical subpixel Euclidean splatting for all streets & footpaths
  const roads = scene.roads || [];
  for (let ri = 0; ri < roads.length; ri++) {
    const rd = roads[ri];
    if (!rd || !rd.pts || rd.pts.length < 2) continue;
    const isFoot = isFootpathRoad(rd);
    const rtype = rd.hwy || rd.type || rd.rtype || '';
    if (isFoot) {
      if (roadDetail === 'major') continue;
      const pathW = Math.max(Math.min(0.62, rd.width || 0.36) * scaleToBed, 0.42 / scaleMm, hCell * 1.88);
      const r = pathW * 0.5;
      let prev = toBed(rd.pts[0]);
      for (let k = 1; k < rd.pts.length; k++) {
        const curr = toBed(rd.pts[k]);
        splatSegmentSDFMaxOnGrid2D(prev[0], prev[1], curr[0], curr[1], r, hCell, pathSDF, nx, ny, xMin, yMin, dx, dy, invDx, invDy);
        prev = curr;
      }
    } else {
      if (roadDetail === 'major' && isStreetSkippedAtMajorLod(rtype)) continue;
      const streetW = Math.max((rd.width || 1.0) * 0.90 * scaleToBed, 0.48 / scaleMm, hCell * 1.96);
      const r = streetW * 0.5;
      let prev = toBed(rd.pts[0]);
      for (let k = 1; k < rd.pts.length; k++) {
        const curr = toBed(rd.pts[k]);
        splatSegmentSDFMaxOnGrid2D(prev[0], prev[1], curr[0], curr[1], r, hCell, streetSDF, nx, ny, xMin, yMin, dx, dy, invDx, invDy);
        prev = curr;
      }
    }
  }

  // 3. Exact un-stroked ground building clearance (fast bldMask lookup on >400-tile live preview; exact un-stroked footprints on normal & export builds)
  const bldInside = new Uint8Array(nGrid);
  const epsClear = Math.max(0.070, hCell * 0.28);
  const wallPad = epsClear + hCell * 0.78;
  const maxWallDistSq = wallPad * wallPad;
  const wallMinDistSq = isStressGrid ? null : new Float32Array(nGrid).fill(maxWallDistSq);

  if (isStressGrid && ctx.bldMask && ctx.sampleMaskIdx) {
    for (let iy = 1; iy < ny - 1; iy++) {
      const by = yMin + iy * dy;
      const r = iy * nx;
      for (let ix = 1; ix < nx - 1; ix++) {
        if (streetSDF[r + ix] <= 0.01 && pathSDF[r + ix] <= 0.01) continue;
        if (ctx.bldMask[ctx.sampleMaskIdx(xMin + ix * dx, by)]) bldInside[r + ix] = 1;
      }
    }
  } else {
    const bldFootprints = collectPrintedBuildingFootprints2D(scene, ctx, state);
    for (let i = 0; i < bldFootprints.length; i++) {
      const bf = bldFootprints[i];
      const bix0 = Math.max(0, Math.floor((bf.minX - wallPad - xMin) * invDx));
      const bix1 = Math.min(nx - 1, Math.ceil((bf.maxX + wallPad - xMin) * invDx));
      const biy0 = Math.max(0, Math.floor((bf.minY - wallPad - yMin) * invDy));
      const biy1 = Math.min(ny - 1, Math.ceil((bf.maxY + wallPad - yMin) * invDy));
      let nearRoad = false;
      for (let iy = biy0; iy <= biy1 && !nearRoad; iy++) {
        const r = iy * nx;
        for (let ix = bix0; ix <= bix1; ix++) {
          if (streetSDF[r + ix] > 0.01 || pathSDF[r + ix] > 0.01) {
            nearRoad = true;
            break;
          }
        }
      }
      if (!nearRoad) continue;

      fillPolygonEvenOddOnGrid2D(bf.outer, bf.holes, bldInside, nx, ny, xMin, yMin, invDx, invDy);
      const splatRing = (ring) => {
        for (let k = 0, n = ring.length; k < n; k++) {
          const a = ring[k], b = ring[(k + 1) % n];
          splatSegmentMinDistSqActive2D(a[0], a[1], b[0], b[1], wallPad, wallMinDistSq, streetSDF, pathSDF, nx, ny, xMin, yMin, dx, dy, invDx, invDy);
        }
      };
      splatRing(bf.outer);
      for (let h = 0; h < bf.holes.length; h++) splatRing(bf.holes[h]);
    }
  }

  // 4. Combine street + footpath SDFs with exact building wall clearance, frame bounds & deep-water trim
  const combinedSDF = new Float32Array(nGrid);
  const frameLimX = halfW - 0.28;
  const frameLimY = halfH - 0.28;
  const invH = 1.0 / hCell;

  let activeCells = 0;
  for (let iy = 1; iy < ny - 1; iy++) {
    const by = yMin + iy * dy;
    const dFrameY = frameLimY - Math.abs(by);
    if (dFrameY <= -hCell) continue;
    const row = iy * nx;
    for (let ix = 1; ix < nx - 1; ix++) {
      const idx = row + ix;
      const rawVal = streetSDF[idx] >= pathSDF[idx] ? streetSDF[idx] : pathSDF[idx];
      if (rawVal <= 0.01) continue;

      const bx = xMin + ix * dx;
      const dFrame = Math.min(frameLimX - Math.abs(bx), dFrameY);
      const frameAllow = Math.max(0.0, Math.min(1.0, 0.5 + dFrame * invH));
      if (frameAllow <= 0.01) continue;

      let bldAllow = 1.0;
      if (wallMinDistSq === null) {
        if (bldInside[idx]) continue;
      } else if (bldInside[idx] || wallMinDistSq[idx] < maxWallDistSq) {
        const dWall = Math.sqrt(wallMinDistSq[idx]);
        const signedOut = bldInside[idx] ? -dWall : dWall;
        bldAllow = Math.max(0.0, Math.min(1.0, 0.5 + (signedOut - epsClear) * invH));
        if (bldAllow <= 0.01) continue;
      }

      let waterAllow = 1.0;
      if (waterSDF && sampleBilinearMask) {
        const wSdf = sampleBilinearMask(waterSDF, bx, by);
        if (wSdf < hCell * 0.5) {
          waterAllow = Math.max(0.0, Math.min(1.0, 0.5 + (wSdf + hCell * 1.4) * invH));
          if (waterAllow <= 0.01) continue;
        }
      }

      const allow = Math.min(frameAllow, bldAllow, waterAllow);
      const v = Math.min(rawVal, allow);
      combinedSDF[idx] = v;
      if (v > 0.5) activeCells++;
    }
  }

  return { nx, ny, xMin, xMax, yMin, yMax, dx, dy, invDx, invDy, isStressGrid, streetSDF, pathSDF, combinedSDF, activeCells };
}

// ============================================================================
// BBox-Pruned Self-Touch Check & Fast Micro-Patch Marching Squares Extractor
// ============================================================================

function hasRingSelfTouchFast2D(poly, tolSq = 4e-6) {
  const n = poly.length;
  if (n < 3) return true;
  const tol = Math.sqrt(tolSq);
  const eMinX = new Float64Array(n);
  const eMaxX = new Float64Array(n);
  const eMinY = new Float64Array(n);
  const eMaxY = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    eMinX[i] = (a[0] < b[0] ? a[0] : b[0]) - tol;
    eMaxX[i] = (a[0] > b[0] ? a[0] : b[0]) + tol;
    eMinY[i] = (a[1] < b[1] ? a[1] : b[1]) - tol;
    eMaxY[i] = (a[1] > b[1] ? a[1] : b[1]) + tol;
  }

  for (let i = 0; i < n; i++) {
    const ax0 = eMinX[i], ax1 = eMaxX[i], ay0 = eMinY[i], ay1 = eMaxY[i];
    const a1 = poly[i], a2 = poly[(i + 1) % n];
    const jEnd = (i === 0) ? (n - 1) : n;
    for (let j = i + 2; j < jEnd; j++) {
      if (ax1 < eMinX[j] || ax0 > eMaxX[j] || ay1 < eMinY[j] || ay0 > eMaxY[j]) continue;
      const b1 = poly[j], b2 = poly[(j + 1) % n];
      if (segmentsIntersectProper(a1, a2, b1, b2)) return true;
      if (pointToSegmentDistSq2D(a1, b1, b2) < tolSq) return true;
      if (pointToSegmentDistSq2D(a2, b1, b2) < tolSq) return true;
      if (pointToSegmentDistSq2D(b1, a1, a2) < tolSq) return true;
      if (pointToSegmentDistSq2D(b2, a1, a2) < tolSq) return true;
    }
  }
  return false;
}

function simplifyPinnedRingDP2D(pts, tol, isPinned) {
  const n = pts.length;
  if (n <= 4 || tol <= 0) return pts;
  const tolSq = tol * tol;

  let anchors = [];
  if (isPinned) {
    for (let i = 0; i < n; i++) {
      if (isPinned(pts[i])) anchors.push(i);
    }
  }
  if (anchors.length === 0) {
    let bestIdx = -1, bestD2 = -1;
    const p0 = pts[0];
    for (let i = 1; i < n; i++) {
      const dx = pts[i][0] - p0[0], dy = pts[i][1] - p0[1];
      const d2 = dx * dx + dy * dy;
      if (d2 > bestD2) { bestD2 = d2; bestIdx = i; }
    }
    if (bestD2 <= tolSq || bestIdx <= 0) return pts;
    anchors = [0, bestIdx];
  } else if (anchors.length === 1) {
    const i0 = anchors[0];
    const p0 = pts[i0];
    let bestIdx = -1, bestD2 = -1;
    for (let i = 0; i < n; i++) {
      if (i === i0) continue;
      const dx = pts[i][0] - p0[0], dy = pts[i][1] - p0[1];
      const d2 = dx * dx + dy * dy;
      if (d2 > bestD2) { bestD2 = d2; bestIdx = i; }
    }
    if (bestD2 <= tolSq || bestIdx < 0) return pts;
    anchors = i0 < bestIdx ? [i0, bestIdx] : [bestIdx, i0];
  }

  const keep = new Uint8Array(n);
  const stack = [];
  const m = anchors.length;
  for (let k = 0; k < m; k++) {
    const s = anchors[k];
    const e = (k + 1 < m) ? anchors[k + 1] : (anchors[0] + n);
    keep[s % n] = 1;
    keep[e % n] = 1;
    if (e - s <= 1) continue;
    stack.push(s, e);
    while (stack.length > 0) {
      const hi = stack.pop();
      const lo = stack.pop();
      if (hi - lo <= 1) continue;
      const pa = pts[lo % n], pb = pts[hi % n];
      let maxD2 = -1, splitIdx = -1;
      for (let idx = lo + 1; idx < hi; idx++) {
        const d2 = pointToSegmentDistSq2D(pts[idx % n], pa, pb);
        if (d2 > maxD2) { maxD2 = d2; splitIdx = idx; }
      }
      if (maxD2 > tolSq && splitIdx !== -1) {
        keep[splitIdx % n] = 1;
        stack.push(lo, splitIdx, splitIdx, hi);
      }
    }
  }

  const out = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(pts[i]);
  }
  return out.length >= 3 ? out : pts;
}

function cleanRoadRing2D(ptsInput, wantCCW = true, pinBox = null, simplifyCollinear = true, dpTol = 0.016) {
  if (!ptsInput || ptsInput.length < 3) return [];
  let pts = [];
  for (let i = 0; i < ptsInput.length; i++) {
    const p = ptsInput[i];
    if (pts.length === 0 || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 0.0035) {
      pts.push([p[0], p[1]]);
    }
  }
  if (pts.length >= 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 0.0035) {
    pts.pop();
  }
  if (pts.length < 3) return [];
  const area = signedArea2D(pts);
  if (Math.abs(area) < 3e-5) return [];
  if (wantCCW ? (area < 0) : (area > 0)) pts.reverse();

  const isPinned = pinBox
    ? (p) => (
        Math.abs(p[0] - pinBox.x0) < 1e-4 || Math.abs(p[0] - pinBox.x1) < 1e-4 ||
        Math.abs(p[1] - pinBox.y0) < 1e-4 || Math.abs(p[1] - pinBox.y1) < 1e-4
      )
    : null;

  if (simplifyCollinear && dpTol > 0 && pts.length > 6) {
    pts = simplifyPinnedRingDP2D(pts, dpTol, isPinned);
  }

  let changed = true;
  let passes = 0;
  while (changed && pts.length >= 3 && passes++ < 3) {
    changed = false;
    const next = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = next.length > 0 ? next[next.length - 1] : pts[(i + n - 1) % n];
      const b = pts[i];
      const c = pts[(i + 1) % n];
      const ux = b[0] - a[0], uy = b[1] - a[1];
      const vx = c[0] - b[0], vy = c[1] - b[1];
      const l1 = Math.hypot(ux, uy), l2 = Math.hypot(vx, vy);
      if (l1 < 0.0035 || Math.hypot(c[0] - a[0], c[1] - a[1]) < 0.0035) {
        changed = true;
        continue;
      }
      const crossAbs = Math.abs(ux * vy - uy * vx);
      const sinTheta = crossAbs / ((l1 * l2) || 1e-9);
      if (sinTheta < 0.003) {
        changed = true;
        continue;
      }
      if (simplifyCollinear && (!isPinned || !isPinned(b)) && sinTheta < 0.065) {
        const acLen = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1e-9;
        if (crossAbs / acLen < 0.014 && acLen < 3.5) {
          changed = true;
          continue;
        }
      }
      next.push(b);
    }
    pts = next;
  }
  if (pts.length < 3 || Math.abs(signedArea2D(pts)) < 3e-5) return [];
  return pts;
}

function extractRoadMicroPatchCore2D(vals, subNx, subNy, pxMin, pyMin, dx, dy, spanIx, spanIy, threshold, minArea, pinBox, dpTol, msScratch) {
  const vOffset = subNx * subNy;
  const totalCap = vOffset * 2;
  if (msScratch.cap < totalCap) {
    msScratch.cap = totalCap + 256;
    msScratch.edgeX = new Float64Array(msScratch.cap);
    msScratch.edgeY = new Float64Array(msScratch.cap);
    msScratch.hasEdge = new Uint8Array(msScratch.cap);
    msScratch.nextEdge = new Int32Array(msScratch.cap);
    msScratch.visited = new Uint8Array(msScratch.cap);
  }
  const { edgeX, edgeY, hasEdge, nextEdge, visited } = msScratch;
  const touched = [];
  const startEdges = [];

  const clampX = u => pxMin + (u <= 0 ? 0 : (u >= spanIx ? spanIx : u)) * dx;
  const clampY = v => pyMin + (v <= 0 ? 0 : (v >= spanIy ? spanIy : v)) * dy;

  const getHEdge = (ix, iy) => {
    const id = iy * subNx + ix;
    if (!hasEdge[id]) {
      hasEdge[id] = 1;
      nextEdge[id] = -1;
      visited[id] = 0;
      touched.push(id);
      const v0 = vals[id], v1 = vals[id + 1];
      const t = Math.max(0.01, Math.min(0.99, (threshold - v0) / ((v1 - v0) || 1e-9)));
      edgeX[id] = clampX(ix + t - 1);
      edgeY[id] = clampY(iy - 1);
    }
    return id;
  };
  const getVEdge = (ix, iy) => {
    const id = vOffset + iy * subNx + ix;
    if (!hasEdge[id]) {
      hasEdge[id] = 1;
      nextEdge[id] = -1;
      visited[id] = 0;
      touched.push(id);
      const i0 = iy * subNx + ix, i1 = (iy + 1) * subNx + ix;
      const v0 = vals[i0], v1 = vals[i1];
      const t = Math.max(0.01, Math.min(0.99, (threshold - v0) / ((v1 - v0) || 1e-9)));
      edgeX[id] = clampX(ix - 1);
      edgeY[id] = clampY(iy + t - 1);
    }
    return id;
  };
  const linkEdge = (u, v) => {
    nextEdge[u] = v;
    startEdges.push(u);
  };

  for (let iy = 0; iy < subNy - 1; iy++) {
    const r0 = iy * subNx, r1 = (iy + 1) * subNx;
    for (let ix = 0; ix < subNx - 1; ix++) {
      const v0 = vals[r0 + ix], v1 = vals[r0 + ix + 1], v2 = vals[r1 + ix + 1], v3 = vals[r1 + ix];
      const mask = (v0 > threshold ? 1 : 0) | (v1 > threshold ? 2 : 0) | (v2 > threshold ? 4 : 0) | (v3 > threshold ? 8 : 0);
      if (mask === 0 || mask === 15) continue;
      switch (mask) {
        case 1: linkEdge(getHEdge(ix, iy), getVEdge(ix, iy)); break;
        case 2: linkEdge(getVEdge(ix + 1, iy), getHEdge(ix, iy)); break;
        case 3: linkEdge(getVEdge(ix + 1, iy), getVEdge(ix, iy)); break;
        case 4: linkEdge(getHEdge(ix, iy + 1), getVEdge(ix + 1, iy)); break;
        case 5: {
          if (0.25 * (v0 + v1 + v2 + v3) > threshold) {
            linkEdge(getHEdge(ix, iy), getVEdge(ix + 1, iy));
            linkEdge(getHEdge(ix, iy + 1), getVEdge(ix, iy));
          } else {
            linkEdge(getHEdge(ix, iy), getVEdge(ix, iy));
            linkEdge(getHEdge(ix, iy + 1), getVEdge(ix + 1, iy));
          }
          break;
        }
        case 6: linkEdge(getHEdge(ix, iy + 1), getHEdge(ix, iy)); break;
        case 7: linkEdge(getHEdge(ix, iy + 1), getVEdge(ix, iy)); break;
        case 8: linkEdge(getVEdge(ix, iy), getHEdge(ix, iy + 1)); break;
        case 9: linkEdge(getHEdge(ix, iy), getHEdge(ix, iy + 1)); break;
        case 10: {
          if (0.25 * (v0 + v1 + v2 + v3) > threshold) {
            linkEdge(getVEdge(ix + 1, iy), getHEdge(ix, iy + 1));
            linkEdge(getVEdge(ix, iy), getHEdge(ix, iy));
          } else {
            linkEdge(getVEdge(ix + 1, iy), getHEdge(ix, iy));
            linkEdge(getVEdge(ix, iy), getHEdge(ix, iy + 1));
          }
          break;
        }
        case 11: linkEdge(getVEdge(ix + 1, iy), getHEdge(ix, iy + 1)); break;
        case 12: linkEdge(getVEdge(ix, iy), getVEdge(ix + 1, iy)); break;
        case 13: linkEdge(getHEdge(ix, iy), getVEdge(ix + 1, iy)); break;
        case 14: linkEdge(getVEdge(ix, iy), getHEdge(ix, iy)); break;
      }
    }
  }

  const maxSmoothDisp = Math.max(dx, dy) * 0.62;
  const outers = [];
  const holes = [];

  for (let si = 0; si < startEdges.length; si++) {
    const startId = startEdges[si];
    if (visited[startId]) continue;
    const rawRing = [];
    let cur = startId;
    while (cur >= 0 && !visited[cur]) {
      visited[cur] = 1;
      rawRing.push([edgeX[cur], edgeY[cur]]);
      cur = nextEdge[cur];
    }
    if (rawRing.length < 3) continue;
    const rawArea = signedArea2D(rawRing);
    if (Math.abs(rawArea) < minArea) continue;
    const isOuter = rawArea > 0;

    const smoothed = smoothClosedRingTaubin2D(rawRing, 3, maxSmoothDisp, pinBox);
    let cleaned = cleanRoadRing2D(smoothed, isOuter, pinBox, true, dpTol);
    if (cleaned.length < 3 || Math.abs(signedArea2D(cleaned)) < minArea * 0.4 || hasRingSelfTouchFast2D(cleaned, 4e-6)) {
      cleaned = cleanRoadRing2D(smoothed, isOuter, pinBox, false, 0);
      if (cleaned.length < 3 || Math.abs(signedArea2D(cleaned)) < minArea * 0.4 || hasRingSelfTouchFast2D(cleaned, 4e-6)) {
        cleaned = cleanRoadRing2D(rawRing, isOuter, pinBox, false, 0);
        if (cleaned.length < 3 || Math.abs(signedArea2D(cleaned)) < minArea * 0.4 || hasRingSelfTouchFast2D(cleaned, 4e-6)) {
          continue;
        }
      }
    }

    let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
    for (let i = 0; i < cleaned.length; i++) {
      const p = cleaned[i];
      if (p[0] < bMinX) bMinX = p[0]; if (p[0] > bMaxX) bMaxX = p[0];
      if (p[1] < bMinY) bMinY = p[1]; if (p[1] > bMaxY) bMaxY = p[1];
    }
    const obj = { ring: cleaned, area: Math.abs(signedArea2D(cleaned)), minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY, holes: [] };
    if (isOuter) outers.push(obj);
    else holes.push(obj);
  }

  for (let i = 0; i < touched.length; i++) {
    hasEdge[touched[i]] = 0;
  }

  for (let hi = 0; hi < holes.length; hi++) {
    const h = holes[hi], hp = h.ring[0];
    let bestOuter = null, bestArea = Infinity;
    for (let oi = 0; oi < outers.length; oi++) {
      const o = outers[oi];
      if (o.area <= h.area || hp[0] < o.minX || hp[0] > o.maxX || hp[1] < o.minY || hp[1] > o.maxY) continue;
      if (pointInPoly2D(hp[0], hp[1], o.ring) && o.area < bestArea) {
        bestArea = o.area;
        bestOuter = o;
      }
    }
    if (bestOuter) bestOuter.holes.push(h.ring);
  }
  return outers;
}

function extractRoadMicroPatchPolygons2D(valsInput, nx, ny, xMin, xMax, yMin, yMax, threshold = 0.5, minArea = 0.008, isStressGrid = false) {
  const valsGlobal = new Float32Array(nx * ny);
  for (let iy = 0; iy < ny; iy++) {
    const isBorderY = (iy === 0 || iy === ny - 1);
    const row = iy * nx;
    for (let ix = 0; ix < nx; ix++) {
      if (isBorderY || ix === 0 || ix === nx - 1) {
        valsGlobal[row + ix] = 0.0;
      } else {
        let v = valsInput[row + ix];
        if (Math.abs(v - threshold) < 1e-5) v = threshold + 1.5e-5;
        valsGlobal[row + ix] = v;
      }
    }
  }

  const dx = (xMax - xMin) / (nx - 1);
  const dy = (yMax - yMin) / (ny - 1);
  const patchCells = isStressGrid ? 18 : 16;
  const dpTol = isStressGrid ? 0.055 : 0.017;
  const nSplitX = Math.max(1, Math.round((nx - 1) / patchCells));
  const nSplitY = Math.max(1, Math.round((ny - 1) / patchCells));
  const msScratch = { cap: 0, edgeX: null, edgeY: null, hasEdge: null, nextEdge: null, visited: null };
  const allOuters = [];

  for (let py = 0; py < nSplitY; py++) {
    const iy0 = Math.floor((ny - 1) * py / nSplitY);
    const iy1 = Math.floor((ny - 1) * (py + 1) / nSplitY);
    const spanIy = iy1 - iy0;
    const subNy = spanIy + 3;
    const pyMin = yMin + iy0 * dy, pyMax = yMin + iy1 * dy;

    for (let px = 0; px < nSplitX; px++) {
      const ix0 = Math.floor((nx - 1) * px / nSplitX);
      const ix1 = Math.floor((nx - 1) * (px + 1) / nSplitX);
      const spanIx = ix1 - ix0;

      let hasActive = false;
      for (let ly = 0; ly <= spanIy && !hasActive; ly++) {
        const gRow = (iy0 + ly) * nx + ix0;
        for (let lx = 0; lx <= spanIx; lx++) {
          if (valsGlobal[gRow + lx] > threshold) { hasActive = true; break; }
        }
      }
      if (!hasActive) continue;

      const subNx = spanIx + 3;
      const subVals = new Float32Array(subNx * subNy);
      for (let ly = 0; ly <= spanIy; ly++) {
        const gRow = (iy0 + ly) * nx + ix0;
        const sRow = (ly + 1) * subNx + 1;
        for (let lx = 0; lx <= spanIx; lx++) subVals[sRow + lx] = valsGlobal[gRow + lx];
      }

      const pxMin = xMin + ix0 * dx, pxMax = xMin + ix1 * dx;
      const pinBox = (nSplitX > 1 || nSplitY > 1)
        ? {
            x0: px > 0 ? pxMin : -1e9,
            x1: px < nSplitX - 1 ? pxMax : 1e9,
            y0: py > 0 ? pyMin : -1e9,
            y1: py < nSplitY - 1 ? pyMax : 1e9
          }
        : null;
      const patchOuters = extractRoadMicroPatchCore2D(
        subVals, subNx, subNy, pxMin, pyMin, dx, dy, spanIx, spanIy, threshold, minArea, pinBox, dpTol, msScratch
      );
      for (let i = 0; i < patchOuters.length; i++) allOuters.push(patchOuters[i]);
    }
  }
  return allOuters;
}

// ============================================================================
// Exact Convex 2D Clipping & Continuous DEM / Greenery 3D Draping
// ============================================================================

function intersectEdgeWithHalfPlaneCanonical2D(p1, p2, ax, ay, ux, uy) {
  const swap = (p1[0] > p2[0]) || (p1[0] === p2[0] && p1[1] > p2[1]);
  const s = swap ? p2 : p1;
  const e = swap ? p1 : p2;
  const d0 = ux * (s[1] - ay) - uy * (s[0] - ax);
  const d1 = ux * (e[1] - ay) - uy * (e[0] - ax);
  const denom = d1 - d0;
  const t = Math.abs(denom) > 1e-14 ? Math.max(0.0, Math.min(1.0, -d0 / denom)) : 0.5;
  return [s[0] + (e[0] - s[0]) * t, s[1] + (e[1] - s[1]) * t];
}

function clipConvexPolyHalfPlane2D(poly, ax, ay, bx, by, keepLeft) {
  const n = poly.length;
  if (n < 3) return [];
  const ux = bx - ax, uy = by - ay;
  const sign = keepLeft ? 1.0 : -1.0;
  const out = [];
  let prev = poly[n - 1];
  let prevD = (ux * (prev[1] - ay) - uy * (prev[0] - ax)) * sign;
  let prevIn = prevD >= -1e-9;

  for (let i = 0; i < n; i++) {
    const curr = poly[i];
    const currD = (ux * (curr[1] - ay) - uy * (curr[0] - ax)) * sign;
    const currIn = currD >= -1e-9;
    if (currIn) {
      if (!prevIn) out.push(intersectEdgeWithHalfPlaneCanonical2D(prev, curr, ax, ay, ux, uy));
      out.push(curr);
    } else if (prevIn) {
      out.push(intersectEdgeWithHalfPlaneCanonical2D(prev, curr, ax, ay, ux, uy));
    }
    prev = curr;
    prevD = currD;
    prevIn = currIn;
  }
  return out;
}

function clipConvexPolyToRect2D(poly, rx0, ry0, rx1, ry1) {
  let cur = clipConvexPolyHalfPlane2D(poly, rx0, ry1, rx0, ry0, true);
  if (cur.length < 3) return [];
  cur = clipConvexPolyHalfPlane2D(cur, rx1, ry0, rx1, ry1, true);
  if (cur.length < 3) return [];
  cur = clipConvexPolyHalfPlane2D(cur, rx0, ry0, rx1, ry0, true);
  if (cur.length < 3) return [];
  cur = clipConvexPolyHalfPlane2D(cur, rx1, ry1, rx0, ry1, true);
  return cur.length >= 3 ? cur : [];
}

function intersectConvexPolys2D(subjectPoly, clipPolyInput) {
  let cur = subjectPoly;
  if (!cur || cur.length < 3 || !clipPolyInput || clipPolyInput.length < 3) return [];
  const clipCCW = signedArea2D(clipPolyInput) >= 0 ? clipPolyInput : clipPolyInput.slice().reverse();
  for (let i = 0, m = clipCCW.length; i < m && cur.length >= 3; i++) {
    const a = clipCCW[i], b = clipCCW[(i + 1) % m];
    if (Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) < 1e-9) continue;
    cur = clipConvexPolyHalfPlane2D(cur, a[0], a[1], b[0], b[1], true);
  }
  return cur.length >= 3 ? cur : [];
}

function buildGreeneryTopSpatialIndex2D(greeneryTris, halfW, halfH, doTileClip = false, skipWalls = false) {
  const G = 64;
  const spanX = 2 * halfW, spanY = 2 * halfH;
  const cells = new Array(G * G);
  const wallCells = new Array(G * G);
  const items = [];
  const wallItems = [];
  if (!greeneryTris || greeneryTris.length === 0) {
    return {
      G, halfW, halfH, spanX, spanY,
      cells, items,
      wallCells, wallItems, wallStamp: new Int32Array(0), curWallStamp: 0
    };
  }

  const wallSeen = skipWalls ? null : new Set();
  const invSpanGX = G / spanX, invSpanGY = G / spanY;
  for (let i = 0; i < greeneryTris.length; i++) {
    const t = greeneryTris[i];
    if (!t.n) continue;
    const p0 = t.v0, p1 = t.v1, p2 = t.v2;
    const tid = doTileClip ? (t.tileId ?? 0) : 0;
    const nz = t.n[2];

    if (nz > 0.5) {
      const area2 = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
      if (area2 > -1e-9 && area2 < 1e-9) continue;
      const triCCW = area2 > 0 ? [p0, p1, p2] : [p0, p2, p1];
      const minX = p0[0] < p1[0] ? (p0[0] < p2[0] ? p0[0] : p2[0]) : (p1[0] < p2[0] ? p1[0] : p2[0]);
      const maxX = p0[0] > p1[0] ? (p0[0] > p2[0] ? p0[0] : p2[0]) : (p1[0] > p2[0] ? p1[0] : p2[0]);
      const minY = p0[1] < p1[1] ? (p0[1] < p2[1] ? p0[1] : p2[1]) : (p1[1] < p2[1] ? p1[1] : p2[1]);
      const maxY = p0[1] > p1[1] ? (p0[1] > p2[1] ? p0[1] : p2[1]) : (p1[1] > p2[1] ? p1[1] : p2[1]);
      const zTop = (p0[2] + p1[2] + p2[2]) * (1.0 / 3.0);
      const idx = items.length;
      items.push({ triCCW, minX, maxX, minY, maxY, zTop, tileId: tid });

      const bx0 = Math.max(0, Math.min(G - 1, ((minX + halfW) * invSpanGX) | 0));
      const bx1 = Math.max(0, Math.min(G - 1, ((maxX + halfW) * invSpanGX) | 0));
      const by0 = Math.max(0, Math.min(G - 1, ((minY + halfH) * invSpanGY) | 0));
      const by1 = Math.max(0, Math.min(G - 1, ((maxY + halfH) * invSpanGY) | 0));
      for (let by = by0; by <= by1; by++) {
        const r = by * G;
        for (let bx = bx0; bx <= bx1; bx++) {
          let bucket = cells[r + bx];
          if (!bucket) cells[r + bx] = bucket = [];
          bucket.push(idx);
        }
      }
    } else if (!skipWalls && nz > -0.2 && nz < 0.2) {
      // Vertical perimeter/step wall of greenery -> extract 2D boundary segment
      const dx01 = p1[0] - p0[0], dy01 = p1[1] - p0[1], d01 = dx01 * dx01 + dy01 * dy01;
      const dx12 = p2[0] - p1[0], dy12 = p2[1] - p1[1], d12 = dx12 * dx12 + dy12 * dy12;
      const dx20 = p0[0] - p2[0], dy20 = p0[1] - p2[1], d20 = dx20 * dx20 + dy20 * dy20;
      let a = p0, b = p1, maxD = d01;
      if (d12 > maxD) { a = p1; b = p2; maxD = d12; }
      if (d20 > maxD) { a = p2; b = p0; maxD = d20; }
      if (maxD < 1e-12) continue;
      const ax0 = Math.round(a[0] * 10000), ay0 = Math.round(a[1] * 10000);
      const bx0i = Math.round(b[0] * 10000), by0i = Math.round(b[1] * 10000);
      const kA = (ax0 + 1048576) * 2097152 + (ay0 + 1048576);
      const kB = (bx0i + 1048576) * 2097152 + (by0i + 1048576);
      const sk = doTileClip
        ? (kA <= kB ? (tid + ':' + kA + '_' + kB) : (tid + ':' + kB + '_' + kA))
        : (kA <= kB ? (kA + '_' + kB) : (kB + '_' + kA));
      if (wallSeen.has(sk)) continue;
      wallSeen.add(sk);

      const ux = b[0] - a[0], uy = b[1] - a[1];
      const len = Math.sqrt(maxD);
      const minX = a[0] < b[0] ? a[0] : b[0], maxX = a[0] > b[0] ? a[0] : b[0];
      const minY = a[1] < b[1] ? a[1] : b[1], maxY = a[1] > b[1] ? a[1] : b[1];
      const wIdx = wallItems.length;
      wallItems.push({ a, b, ux, uy, len, minX, maxX, minY, maxY, tileId: tid });

      const gx0 = Math.max(0, Math.min(G - 1, ((minX + halfW) * invSpanGX) | 0));
      const gx1 = Math.max(0, Math.min(G - 1, ((maxX + halfW) * invSpanGX) | 0));
      const gy0 = Math.max(0, Math.min(G - 1, ((minY + halfH) * invSpanGY) | 0));
      const gy1 = Math.max(0, Math.min(G - 1, ((maxY + halfH) * invSpanGY) | 0));
      for (let gy = gy0; gy <= gy1; gy++) {
        const r = gy * G;
        for (let gx = gx0; gx <= gx1; gx++) {
          let bucket = wallCells[r + gx];
          if (!bucket) wallCells[r + gx] = bucket = [];
          bucket.push(wIdx);
        }
      }
    }
  }
  return {
    G, halfW, halfH, spanX, spanY,
    cells, items,
    wallCells, wallItems, wallStamp: new Int32Array(wallItems.length), curWallStamp: 0
  };
}

function queryGreeneryWallsSpatialIndex2D(gIdx, minX, maxX, minY, maxY) {
  if (gIdx.wallItems.length === 0) return [];
  const { G, halfW, halfH, spanX, spanY, wallCells, wallItems, wallStamp } = gIdx;
  const tag = ++gIdx.curWallStamp;
  const bx0 = Math.max(0, Math.min(G - 1, Math.floor(((minX - 1e-3 + halfW) / spanX) * G)));
  const bx1 = Math.max(0, Math.min(G - 1, Math.floor(((maxX + 1e-3 + halfW) / spanX) * G)));
  const by0 = Math.max(0, Math.min(G - 1, Math.floor(((minY - 1e-3 + halfH) / spanY) * G)));
  const by1 = Math.max(0, Math.min(G - 1, Math.floor(((maxY + 1e-3 + halfH) / spanY) * G)));
  const out = [];
  for (let by = by0; by <= by1; by++) {
    const r = by * G;
    for (let bx = bx0; bx <= bx1; bx++) {
      const bucket = wallCells[r + bx];
      if (!bucket) continue;
      for (let k = 0; k < bucket.length; k++) {
        const id = bucket[k];
        if (wallStamp[id] === tag) continue;
        wallStamp[id] = tag;
        const it = wallItems[id];
        if (it.maxX >= minX - 5e-4 && it.minX <= maxX + 5e-4 && it.maxY >= minY - 5e-4 && it.minY <= maxY + 5e-4) {
          out.push(it);
        }
      }
    }
  }
  return out;
}

function queryGreeneryPointTopZ(gIdx, px, py, tileId, doTileClip) {
  if (gIdx.items.length === 0) return null;
  const { G, halfW, halfH, spanX, spanY, cells, items } = gIdx;
  const bx = Math.max(0, Math.min(G - 1, Math.floor(((px + halfW) / spanX) * G)));
  const by = Math.max(0, Math.min(G - 1, Math.floor(((py + halfH) / spanY) * G)));
  const bucket = cells[by * G + bx];
  if (!bucket) return null;
  let bestZ = null;
  for (let k = 0; k < bucket.length; k++) {
    const it = items[bucket[k]];
    if (doTileClip && it.tileId !== tileId) continue;
    if (px < it.minX - 1e-6 || px > it.maxX + 1e-6 || py < it.minY - 1e-6 || py > it.maxY + 1e-6) continue;
    if (pointStrictlyOrOnTri2D(px, py, it.triCCW)) {
      if (bestZ === null || it.zTop > bestZ) bestZ = it.zTop;
    }
  }
  return bestZ;
}

function pointInConvexCCWTol2D(px, py, poly, tol = 2e-4) {
  for (let i = 0, m = poly.length; i < m; i++) {
    const a = poly[i], b = poly[(i + 1) % m];
    if ((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]) < -tol) return false;
  }
  return true;
}

function convexPolyNearSegment2D(poly, sa, sb, tolSq = 9e-8) {
  if (pointInConvexCCWTol2D(sa[0], sa[1], poly) || pointInConvexCCWTol2D(sb[0], sb[1], poly)) {
    return true;
  }
  for (let i = 0, m = poly.length; i < m; i++) {
    const a = poly[i], b = poly[(i + 1) % m];
    if (segmentsIntersectProper(a, b, sa, sb)) return true;
    if (pointToSegmentDistSq2D(a, sa, sb) <= tolSq) return true;
    if (pointToSegmentDistSq2D(b, sa, sb) <= tolSq) return true;
    if (pointToSegmentDistSq2D(sa, a, b) <= tolSq) return true;
    if (pointToSegmentDistSq2D(sb, a, b) <= tolSq) return true;
  }
  return false;
}

function pointStrictlyOrOnTri2D(px, py, triCCW) {
  const [a, b, c] = triCCW;
  const c0 = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
  if (c0 < -1e-6) return false;
  const c1 = (c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0]);
  if (c1 < -1e-6) return false;
  const c2 = (a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0]);
  return c2 >= -1e-6;
}

function triangulatePrecleanedRoadPoly2D(outerClean, holesInput) {
  if (!outerClean || outerClean.length < 3) return null;
  const validHoles = [];
  if (holesInput && holesInput.length > 0) {
    for (let h = 0; h < holesInput.length; h++) {
      const hc = holesInput[h];
      if (!hc || hc.length < 3 || Math.abs(signedArea2D(hc)) <= 6e-5) continue;
      let hMinX = Infinity, hMaxX = -Infinity, hMinY = Infinity, hMaxY = -Infinity;
      let insideOk = true;
      for (let k = 0; k < hc.length; k++) {
        const pt = hc[k];
        if (!pointInPoly2D(pt[0], pt[1], outerClean) ||
            distToPolygonBoundary2D(pt[0], pt[1], outerClean, validHoles) < 2.2e-3) {
          insideOk = false;
          break;
        }
        if (pt[0] < hMinX) hMinX = pt[0]; if (pt[0] > hMaxX) hMaxX = pt[0];
        if (pt[1] < hMinY) hMinY = pt[1]; if (pt[1] > hMaxY) hMaxY = pt[1];
      }
      if (!insideOk) continue;
      hMinX -= 2.5e-3; hMaxX += 2.5e-3; hMinY -= 2.5e-3; hMaxY += 2.5e-3;
      for (let k = 0; k < outerClean.length; k++) {
        const pt = outerClean[k];
        if (pt[0] < hMinX || pt[0] > hMaxX || pt[1] < hMinY || pt[1] > hMaxY) continue;
        if (distToPolygonBoundary2D(pt[0], pt[1], hc, []) < 2.2e-3) {
          insideOk = false;
          break;
        }
      }
      if (insideOk) validHoles.push(hc);
    }
  }
  const mergedHoles = [];
  let ring = validHoles.length > 0 ? mergeHolesIntoOuterKeyhole(outerClean, validHoles, mergedHoles) : outerClean;
  let actualHoles = mergedHoles;
  if (actualHoles.length > 0 && !isSimplePolygon(ring)) {
    ring = outerClean;
    actualHoles = [];
  }
  const triangulator = (typeof triangulateCutLoopExact === 'function' && actualHoles.length > 0)
    ? triangulateCutLoopExact
    : triangulateSimplePoly;
  const capTris = triangulator(ring);
  if (!capTris || capTris.length === 0) return null;
  return { outerClean, actualHoles, capTris };
}

function isTriDataWeldBijective(triData, zBot, zTop, scaleMm) {
  const zBotK = Math.max(0, zBot * scaleMm).toFixed(3);
  const zTopK = Math.max(0, zTop * scaleMm).toFixed(3);
  if (zBotK === zTopK || Math.round(zBot * 5000) === Math.round(zTop * 5000)) return false;
  const seen = new Set();
  const seenQ5k = new Set();
  const wk = (p) => ((p[0] + 84.6) * scaleMm).toFixed(3) + '_' + ((p[1] + 84.6) * scaleMm).toFixed(3);
  const q5k = (p) => (Math.round(p[0] * 5000) + 2097152) * 4194304 + (Math.round(p[1] * 5000) + 2097152);
  const { outerClean, actualHoles, capTris } = triData;
  for (let i = 0; i < outerClean.length; i++) {
    const p = outerClean[i];
    const k = wk(p), q = q5k(p);
    if (seen.has(k) || seenQ5k.has(q)) return false;
    seen.add(k);
    seenQ5k.add(q);
  }
  for (let h = 0; h < actualHoles.length; h++) {
    const hole = actualHoles[h];
    for (let i = 0; i < hole.length; i++) {
      const p = hole[i];
      const k = wk(p), q = q5k(p);
      if (seen.has(k) || seenQ5k.has(q)) return false;
      seen.add(k);
      seenQ5k.add(q);
    }
  }
  for (let i = 0; i < capTris.length; i++) {
    const [a, b, c] = capTris[i];
    const ka = wk(a), kb = wk(b), kc = wk(c);
    if (ka === kb || kb === kc || ka === kc) return false;
    const qa = q5k(a), qb = q5k(b), qc = q5k(c);
    if (qa === qb || qb === qc || qa === qc) return false;
  }
  return true;
}

function emitRoadSlabFromTriData3D(triData, zBot, zTop, layerId, outTris, tileId, shellId) {
  const { outerClean, actualHoles, capTris } = triData;
  for (let i = 0; i < capTris.length; i++) {
    const [a, b, c] = capTris[i];
    pushTri(outTris, [a[0], a[1], zTop], [b[0], b[1], zTop], [c[0], c[1], zTop], [0, 0, 1], layerId, shellId, tileId, shellId);
    pushTri(outTris, [a[0], a[1], zBot], [c[0], c[1], zBot], [b[0], b[1], zBot], [0, 0, -1], layerId, shellId, tileId, shellId);
  }
  const emitWallLoop = (loopPts) => {
    for (let i = 0, n = loopPts.length; i < n; i++) {
      const a = loopPts[i], b = loopPts[(i + 1) % n];
      const ddx = b[0] - a[0], ddy = b[1] - a[1], len = Math.hypot(ddx, ddy);
      if (len > 1e-6) {
        pushQuad(outTris, [a[0], a[1], zBot], [b[0], b[1], zBot], [b[0], b[1], zTop], [a[0], a[1], zTop], [ddy / len, -ddx / len, 0], layerId, shellId, tileId, shellId);
      }
    }
  };
  emitWallLoop(outerClean);
  for (let h = 0; h < actualHoles.length; h++) emitWallLoop(actualHoles[h]);
}

function emitSingleQuantizedTriPrism3D(pa, pb, pc, zBot, zTop, layerId, outTris, tileId, shellId) {
  pushTri(outTris, [pa[0], pa[1], zTop], [pb[0], pb[1], zTop], [pc[0], pc[1], zTop], [0, 0, 1], layerId, shellId, tileId, shellId);
  pushTri(outTris, [pa[0], pa[1], zBot], [pc[0], pc[1], zBot], [pb[0], pb[1], zBot], [0, 0, -1], layerId, shellId, tileId, shellId);
  const loop = [pa, pb, pc];
  for (let i = 0; i < 3; i++) {
    const u = loop[i], v = loop[(i + 1) % 3];
    const ddx = v[0] - u[0], ddy = v[1] - u[1], len = Math.hypot(ddx, ddy) || 1;
    pushQuad(outTris, [u[0], u[1], zBot], [v[0], v[1], zBot], [v[0], v[1], zTop], [u[0], u[1], zTop], [ddy / len, -ddx / len, 0], layerId, shellId, tileId, shellId);
  }
}

function emitMergedSlabPiecesManifold(slabRecords, ctx, targetArr, allocShellId, hadWallSplit = false) {
  const nInput = slabRecords.length;
  if (nInput === 0) return;
  const scaleMm = ctx.scaleMm || 1.891;
  const invScaleMm = 1.0 / scaleMm;
  const minAreaUnits2 = 2.5e-6 * invScaleMm * invScaleMm;
  const { tileCols, tileRows, halfW, halfH } = ctx;
  const numTiles = (tileCols || 1) * (tileRows || 1);
  const assignCentroidTile = numTiles > 400 && !ctx.isExport && typeof getTileIdForCentroid === 'function';

  // Exact unperturbed coordinates keyed at 1e-4 units, plus dual (.toFixed(3) mm & 5000-grid) weld-key bijection check
  const vMap = new Map();
  const vCoords = [];
  const vWeldKeys = [];
  const vQ5kKeys = [];
  const weldKey2D = assignCentroidTile
    ? (pt) => Math.round(((pt[0] + 84.6) * scaleMm) * 1000) * 1048576 + Math.round(((pt[1] + 84.6) * scaleMm) * 1000)
    : (pt) => ((pt[0] + 84.6) * scaleMm).toFixed(3) + '_' + ((pt[1] + 84.6) * scaleMm).toFixed(3);
  const q5kKey2D = (pt) => (Math.round(pt[0] * 5000) + 2097152) * 4194304 + (Math.round(pt[1] * 5000) + 2097152);
  const getVid = (pt) => {
    const ix = Math.round(pt[0] * 10000);
    const iy = Math.round(pt[1] * 10000);
    const k = (ix + 4194304) * 16777216 + (iy + 4194304);
    let id = vMap.get(k);
    if (id === undefined) {
      id = vCoords.length;
      vMap.set(k, id);
      vCoords.push(pt);
      vWeldKeys.push(weldKey2D(pt));
      vQ5kKeys.push(q5kKey2D(pt));
    }
    return id;
  };

  // Group triangles by integer (tileId, zBotI, zTopI) slab level so all edge keys are fast 53-bit integers
  const levelMap = new Map();
  const levels = [];
  for (let i = 0; i < nInput; i++) {
    const rec = slabRecords[i];
    const lKey = rec.tileId * 4294967296 + ((rec.zBotI & 65535) * 65536 + (rec.zTopI & 65535));
    let lvl = levelMap.get(lKey);
    if (lvl === undefined) {
      const validMmZ = assignCentroidTile
        ? (Math.round(Math.max(0, rec.zTop * scaleMm) * 1000) !== Math.round(Math.max(0, rec.zBot * scaleMm) * 1000))
        : (Math.max(0, rec.zTop * scaleMm).toFixed(3) !== Math.max(0, rec.zBot * scaleMm).toFixed(3));
      const validZ = validMmZ && (Math.round(rec.zTop * 5000) !== Math.round(rec.zBot * 5000));
      lvl = { validZ, tileId: rec.tileId, zBot: rec.zBot, zTop: rec.zTop, tris: [] };
      levelMap.set(lKey, lvl);
      levels.push(lvl);
    }
    if (!lvl.validZ) continue;
    const [a, b, c] = rec.tri;
    const va = getVid(a), vb = getVid(b), vc = getVid(c);
    if (va === vb || vb === vc || va === vc) continue;
    const wka = vWeldKeys[va], wkb = vWeldKeys[vb], wkc = vWeldKeys[vc];
    if (wka === wkb || wkb === wkc || wka === wkc) continue;
    const q5a = vQ5kKeys[va], q5b = vQ5kKeys[vb], q5c = vQ5kKeys[vc];
    if (q5a === q5b || q5b === q5c || q5a === q5c) continue;
    const pa = vCoords[va], pb = vCoords[vb], pc = vCoords[vc];
    const cross2 = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
    if (0.5 * Math.abs(cross2) < minAreaUnits2) continue;
    lvl.tris.push(cross2 > 0 ? [va, vb, vc] : [va, vc, vb]);
  }

  const emitSingleVidTri = (tri, zBot, zTop, baseTid) => {
    const pa = vCoords[tri[0]], pb = vCoords[tri[1]], pc = vCoords[tri[2]];
    const outTid = assignCentroidTile
      ? getTileIdForCentroid((pa[0] + pb[0] + pc[0]) * (1.0 / 3.0), (pa[1] + pb[1] + pc[1]) * (1.0 / 3.0), halfW, halfH, tileCols, tileRows)
      : baseTid;
    emitSingleQuantizedTriPrism3D(pa, pb, pc, zBot, zTop, 3, targetArr, outTid, allocShellId());
  };

  const emitConnectedCleanGroup = (triList, subIdxs, zBot, zTop, baseTid) => {
    const m = subIdxs.length;
    if (m === 0) return;
    if (m === 1) {
      emitSingleVidTri(triList[subIdxs[0]], zBot, zTop, baseTid);
      return;
    }

    const subParent = new Int32Array(m);
    for (let k = 0; k < m; k++) subParent[k] = k;
    const subFind = (x) => { while (subParent[x] !== x) { subParent[x] = subParent[subParent[x]]; x = subParent[x]; } return x; };
    const subOwner = new Map();
    for (let k = 0; k < m; k++) {
      const t = triList[subIdxs[k]];
      for (let e = 0; e < 3; e++) {
        const u = t[e], v = t[(e + 1) % 3];
        const prevK = subOwner.get(v * 67108864 + u);
        if (prevK !== undefined) {
          const ra = subFind(k), rb = subFind(prevK);
          if (ra !== rb) subParent[rb] = ra;
        } else {
          subOwner.set(u * 67108864 + v, k);
        }
      }
    }

    const comps = new Map();
    for (let k = 0; k < m; k++) {
      const r = subFind(k);
      let c = comps.get(r);
      if (!c) comps.set(r, c = []);
      c.push(subIdxs[k]);
    }

    for (const [, cIdxs] of comps) {
      if (cIdxs.length === 1) {
        emitSingleVidTri(triList[cIdxs[0]], zBot, zTop, baseTid);
        continue;
      }

      const dirCnt = new Map();
      let sumX = 0, sumY = 0;
      for (let k = 0; k < cIdxs.length; k++) {
        const [va, vb, vc] = triList[cIdxs[k]];
        sumX += vCoords[va][0]; sumY += vCoords[va][1];
        const e0 = va * 67108864 + vb, e1 = vb * 67108864 + vc, e2 = vc * 67108864 + va;
        dirCnt.set(e0, (dirCnt.get(e0) || 0) + 1);
        dirCnt.set(e1, (dirCnt.get(e1) || 0) + 1);
        dirCnt.set(e2, (dirCnt.get(e2) || 0) + 1);
      }

      const outTid = assignCentroidTile
        ? getTileIdForCentroid(sumX / cIdxs.length, sumY / cIdxs.length, halfW, halfH, tileCols, tileRows)
        : baseTid;
      const sid = allocShellId();

      for (let k = 0; k < cIdxs.length; k++) {
        const [va, vb, vc] = triList[cIdxs[k]];
        const pa = vCoords[va], pb = vCoords[vb], pc = vCoords[vc];
        pushTri(targetArr, [pa[0], pa[1], zTop], [pb[0], pb[1], zTop], [pc[0], pc[1], zTop], [0, 0, 1], 3, sid, outTid, sid);
        pushTri(targetArr, [pa[0], pa[1], zBot], [pc[0], pc[1], zBot], [pb[0], pb[1], zBot], [0, 0, -1], 3, sid, outTid, sid);
      }
      for (const [ek] of dirCnt) {
        const u = Math.floor(ek / 67108864);
        const v = ek - u * 67108864;
        if (!dirCnt.has(v * 67108864 + u)) {
          const pa = vCoords[u], pb = vCoords[v];
          const ddx = pb[0] - pa[0], ddy = pb[1] - pa[1], len = Math.hypot(ddx, ddy) || 1;
          pushQuad(targetArr, [pa[0], pa[1], zBot], [pb[0], pb[1], zBot], [pb[0], pb[1], zTop], [pa[0], pa[1], zTop], [ddy / len, -ddx / len, 0], 3, sid, outTid, sid);
        }
      }
    }
  };

  const emitGroupWithPinchPeel = (triList, curIdxs, zBot, zTop, baseTid, depth) => {
    if (curIdxs.length === 0) return;
    if (curIdxs.length === 1) {
      emitSingleVidTri(triList[curIdxs[0]], zBot, zTop, baseTid);
      return;
    }

    const dirCnt = new Map();
    for (let k = 0; k < curIdxs.length; k++) {
      const [va, vb, vc] = triList[curIdxs[k]];
      const e0 = va * 67108864 + vb, e1 = vb * 67108864 + vc, e2 = vc * 67108864 + va;
      dirCnt.set(e0, (dirCnt.get(e0) || 0) + 1);
      dirCnt.set(e1, (dirCnt.get(e1) || 0) + 1);
      dirCnt.set(e2, (dirCnt.get(e2) || 0) + 1);
    }

    const outDeg = new Map();
    const inDeg = new Map();
    const badVerts = new Set();
    const weldOwner = new Map();
    const q5kOwner = new Map();

    for (const [ek, cnt] of dirCnt) {
      const u = Math.floor(ek / 67108864);
      const v = ek - u * 67108864;
      const wku = vWeldKeys[u];
      const prevU = weldOwner.get(wku);
      if (prevU === undefined) weldOwner.set(wku, u);
      else if (prevU !== u) { badVerts.add(u); badVerts.add(prevU); }

      const wkv = vWeldKeys[v];
      const prevV = weldOwner.get(wkv);
      if (prevV === undefined) weldOwner.set(wkv, v);
      else if (prevV !== v) { badVerts.add(v); badVerts.add(prevV); }

      const q5u = vQ5kKeys[u];
      const prevQU = q5kOwner.get(q5u);
      if (prevQU === undefined) q5kOwner.set(q5u, u);
      else if (prevQU !== u) { badVerts.add(u); badVerts.add(prevQU); }

      const q5v = vQ5kKeys[v];
      const prevQV = q5kOwner.get(q5v);
      if (prevQV === undefined) q5kOwner.set(q5v, v);
      else if (prevQV !== v) { badVerts.add(v); badVerts.add(prevQV); }

      if (cnt > 1) { badVerts.add(u); badVerts.add(v); continue; }
      const revCnt = dirCnt.get(v * 67108864 + u) || 0;
      if (revCnt === 0) {
        const od = (outDeg.get(u) || 0) + 1;
        const id = (inDeg.get(v) || 0) + 1;
        outDeg.set(u, od);
        inDeg.set(v, id);
        if (od > 1) badVerts.add(u);
        if (id > 1) badVerts.add(v);
      } else if (revCnt > 1) {
        badVerts.add(u);
        badVerts.add(v);
      }
    }

    if (badVerts.size === 0) {
      emitConnectedCleanGroup(triList, curIdxs, zBot, zTop, baseTid);
      return;
    }

    if (depth >= 2) {
      for (let k = 0; k < curIdxs.length; k++) {
        emitSingleVidTri(triList[curIdxs[k]], zBot, zTop, baseTid);
      }
      return;
    }

    const cleanRest = [];
    for (let k = 0; k < curIdxs.length; k++) {
      const ti = curIdxs[k];
      const [va, vb, vc] = triList[ti];
      if (badVerts.has(va) || badVerts.has(vb) || badVerts.has(vc)) {
        emitSingleVidTri(triList[ti], zBot, zTop, baseTid);
      } else {
        cleanRest.push(ti);
      }
    }
    if (cleanRest.length > 0) {
      emitGroupWithPinchPeel(triList, cleanRest, zBot, zTop, baseTid, depth + 1);
    }
  };

  for (let li = 0; li < levels.length; li++) {
    const lvl = levels[li];
    let triList = lvl.tris;
    if (triList.length === 0) continue;
    if (triList.length === 1) {
      emitSingleVidTri(triList[0], lvl.zBot, lvl.zTop, lvl.tileId);
      continue;
    }

    // Resolve any T-junctions on unmatched boundary edges ONLY when local greenery wall splits occurred
    const maxTjPasses = hadWallSplit ? 2 : 0;
    for (let tjPass = 0; tjPass < maxTjPasses; tjPass++) {
      const edgeSet = new Set();
      for (let i = 0; i < triList.length; i++) {
        const [a, b, c] = triList[i];
        edgeSet.add(a * 67108864 + b);
        edgeSet.add(b * 67108864 + c);
        edgeSet.add(c * 67108864 + a);
      }
      const bVertSet = new Set();
      const hasUnmatched = new Uint8Array(triList.length);
      for (let i = 0; i < triList.length; i++) {
        const t = triList[i];
        for (let e = 0; e < 3; e++) {
          const u = t[e], v = t[(e + 1) % 3];
          if (!edgeSet.has(v * 67108864 + u)) {
            hasUnmatched[i] = 1;
            bVertSet.add(u);
            bVertSet.add(v);
          }
        }
      }
      if (bVertSet.size === 0) break;
      const bVerts = Array.from(bVertSet);
      let anySplit = false;
      const nextTriList = [];

      for (let i = 0; i < triList.length; i++) {
        const t = triList[i];
        if (!hasUnmatched[i]) {
          nextTriList.push(t);
          continue;
        }
        let splitDone = false;
        for (let e = 0; e < 3; e++) {
          const u = t[e], v = t[(e + 1) % 3];
          if (edgeSet.has(v * 67108864 + u)) continue;
          const pu = vCoords[u], pv = vCoords[v];
          const minEx = (pu[0] < pv[0] ? pu[0] : pv[0]) - 2e-4;
          const maxEx = (pu[0] > pv[0] ? pu[0] : pv[0]) + 2e-4;
          const minEy = (pu[1] < pv[1] ? pu[1] : pv[1]) - 2e-4;
          const maxEy = (pu[1] > pv[1] ? pu[1] : pv[1]) + 2e-4;
          const dx = pv[0] - pu[0], dy = pv[1] - pu[1];
          const lenSq = dx * dx + dy * dy;
          if (lenSq < 1e-8) continue;

          const mids = [];
          const third = t[(e + 2) % 3];
          for (let bi = 0; bi < bVerts.length; bi++) {
            const w = bVerts[bi];
            if (w === u || w === v || w === third) continue;
            const pw = vCoords[w];
            if (pw[0] < minEx || pw[0] > maxEx || pw[1] < minEy || pw[1] > maxEy) continue;
            const param = ((pw[0] - pu[0]) * dx + (pw[1] - pu[1]) * dy) / lenSq;
            if (param <= 1e-4 || param >= 1.0 - 1e-4) continue;
            const px = pu[0] + param * dx - pw[0];
            const py = pu[1] + param * dy - pw[1];
            if (px * px + py * py <= 4e-8) {
              mids.push({ w, param });
            }
          }
          if (mids.length > 0) {
            mids.sort((m1, m2) => m1.param - m2.param);
            const chain = [u];
            for (let mi = 0; mi < mids.length; mi++) chain.push(mids[mi].w);
            chain.push(v);
            const pc = vCoords[third], wkc = vWeldKeys[third], q5c = vQ5kKeys[third];
            for (let ci = 0; ci < chain.length - 1; ci++) {
              const aId = chain[ci], bId = chain[ci + 1];
              const wka = vWeldKeys[aId], wkb = vWeldKeys[bId];
              if (wka === wkb || wkb === wkc || wka === wkc) continue;
              const q5a = vQ5kKeys[aId], q5b = vQ5kKeys[bId];
              if (q5a === q5b || q5b === q5c || q5a === q5c) continue;
              const pa = vCoords[aId], pb = vCoords[bId];
              const cr2 = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
              if (0.5 * Math.abs(cr2) >= minAreaUnits2) {
                nextTriList.push(cr2 > 0 ? [aId, bId, third] : [aId, third, bId]);
              }
            }
            splitDone = true;
            anySplit = true;
            break;
          }
        }
        if (!splitDone) nextTriList.push(t);
      }
      triList = nextTriList;
      if (!anySplit || triList.length === 0) break;
    }

    const m = triList.length;
    if (m === 0) continue;
    const parent = new Int32Array(m);
    for (let i = 0; i < m; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const halfEdgeOwner = new Map();

    for (let i = 0; i < m; i++) {
      const vids = triList[i];
      for (let e = 0; e < 3; e++) {
        const u = vids[e], v = vids[(e + 1) % 3];
        const ownKey = u * 67108864 + v;
        if (halfEdgeOwner.has(ownKey)) continue;
        const oppKey = v * 67108864 + u;
        const oppIdx = halfEdgeOwner.get(oppKey);
        if (oppIdx !== undefined) {
          halfEdgeOwner.delete(oppKey);
          const ra = find(i), rb = find(oppIdx);
          if (ra !== rb) parent[rb] = ra;
        } else {
          halfEdgeOwner.set(ownKey, i);
        }
      }
    }

    const groups = new Map();
    for (let i = 0; i < m; i++) {
      const r = find(i);
      let g = groups.get(r);
      if (!g) groups.set(r, g = []);
      g.push(i);
    }

    for (const [, idxs] of groups) {
      emitGroupWithPinchPeel(triList, idxs, lvl.zBot, lvl.zTop, lvl.tileId, 0);
    }
  }
}

function drapeConvexPieceOverGreenery2D(
  dryPoly, zTerrace, pieceTid, wallHits, gSpatialIdx,
  doTileClip, isStreet, rHeight, pathHeight, hBare, pushConvexPiece, splitState, depth
) {
  const localWalls = [];
  for (let wi = 0; wi < wallHits.length; wi++) {
    const w = wallHits[wi];
    if (doTileClip && w.tileId !== pieceTid) continue;
    if (convexPolyNearSegment2D(dryPoly, w.a, w.b)) {
      localWalls.push(w);
    }
  }

  if (localWalls.length === 0) {
    let dcx = 0, dcy = 0;
    const m = dryPoly.length;
    for (let k = 0; k < m; k++) { dcx += dryPoly[k][0]; dcy += dryPoly[k][1]; }
    dcx /= m; dcy /= m;
    const gZ = queryGreeneryPointTopZ(gSpatialIdx, dcx, dcy, pieceTid, doTileClip);
    if (gZ === null) {
      pushConvexPiece(dryPoly, pieceTid, zTerrace, zTerrace + hBare);
    } else {
      pushConvexPiece(dryPoly, pieceTid, gZ, Math.max(gZ + pathHeight, zTerrace + (isStreet ? rHeight : 0)));
    }
    return;
  }

  if (localWalls.length > 3 && depth < 3) {
    let pMinX = Infinity, pMaxX = -Infinity, pMinY = Infinity, pMaxY = -Infinity;
    for (let k = 0; k < dryPoly.length; k++) {
      const p = dryPoly[k];
      if (p[0] < pMinX) pMinX = p[0]; if (p[0] > pMaxX) pMaxX = p[0];
      if (p[1] < pMinY) pMinY = p[1]; if (p[1] > pMaxY) pMaxY = p[1];
    }
    const dxSpan = pMaxX - pMinX, dySpan = pMaxY - pMinY;
    if (Math.max(dxSpan, dySpan) > 0.04) {
      let halfA, halfB;
      if (dxSpan >= dySpan) {
        const xm = 0.5 * (pMinX + pMaxX);
        halfA = clipConvexPolyHalfPlane2D(dryPoly, xm, pMinY, xm, pMaxY, true);
        halfB = clipConvexPolyHalfPlane2D(dryPoly, xm, pMinY, xm, pMaxY, false);
      } else {
        const ym = 0.5 * (pMinY + pMaxY);
        halfA = clipConvexPolyHalfPlane2D(dryPoly, pMinX, ym, pMaxX, ym, true);
        halfB = clipConvexPolyHalfPlane2D(dryPoly, pMinX, ym, pMaxX, ym, false);
      }
      splitState.hadWallSplit = true;
      if (halfA.length >= 3 && Math.abs(signedArea2D(halfA)) >= 2e-6) {
        drapeConvexPieceOverGreenery2D(halfA, zTerrace, pieceTid, localWalls, gSpatialIdx, doTileClip, isStreet, rHeight, pathHeight, hBare, pushConvexPiece, splitState, depth + 1);
      }
      if (halfB.length >= 3 && Math.abs(signedArea2D(halfB)) >= 2e-6) {
        drapeConvexPieceOverGreenery2D(halfB, zTerrace, pieceTid, localWalls, gSpatialIdx, doTileClip, isStreet, rHeight, pathHeight, hBare, pushConvexPiece, splitState, depth + 1);
      }
      return;
    }
  }

  let cells = [dryPoly];
  for (let wi = 0; wi < localWalls.length; wi++) {
    const w = localWalls[wi];
    const ax = w.a[0], ay = w.a[1], bx = w.b[0], by = w.b[1];
    const ux = w.ux, uy = w.uy;
    const epsD = 2e-6 * w.len;
    const nextCells = [];
    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci];
      if (!convexPolyNearSegment2D(cell, w.a, w.b)) {
        nextCells.push(cell);
        continue;
      }
      let minD = Infinity, maxD = -Infinity;
      for (let k = 0; k < cell.length; k++) {
        const d = ux * (cell[k][1] - ay) - uy * (cell[k][0] - ax);
        if (d < minD) minD = d;
        if (d > maxD) maxD = d;
      }
      if (minD < -epsD && maxD > epsD) {
        const cL = clipConvexPolyHalfPlane2D(cell, ax, ay, bx, by, true);
        const cR = clipConvexPolyHalfPlane2D(cell, ax, ay, bx, by, false);
        splitState.hadWallSplit = true;
        if (cL.length >= 3 && Math.abs(signedArea2D(cL)) >= 2e-6) nextCells.push(cL);
        if (cR.length >= 3 && Math.abs(signedArea2D(cR)) >= 2e-6) nextCells.push(cR);
      } else {
        nextCells.push(cell);
      }
    }
    cells = nextCells;
    if (cells.length === 0) return;
  }

  for (let ci = 0; ci < cells.length; ci++) {
    const cell = cells[ci];
    let dcx = 0, dcy = 0;
    const m = cell.length;
    for (let k = 0; k < m; k++) { dcx += cell[k][0]; dcy += cell[k][1]; }
    dcx /= m; dcy /= m;
    const gZ = queryGreeneryPointTopZ(gSpatialIdx, dcx, dcy, pieceTid, doTileClip);
    if (gZ === null) {
      pushConvexPiece(cell, pieceTid, zTerrace, zTerrace + hBare);
    } else {
      pushConvexPiece(cell, pieceTid, gZ, Math.max(gZ + pathHeight, zTerrace + (isStreet ? rHeight : 0)));
    }
  }
}

function drapeAndEmitRoadPolygon2D(polyObj, fields, gSpatialIdx, ctx, baseInfo, meshes, allocShellId) {
  const {
    halfW, halfH, TERRAIN_RES_X, TERRAIN_RES_Y,
    tileCols, tileRows, tileBounds,
    baseBottomZ, rHeight, pathHeight
  } = ctx;
  const scaleMm = ctx.scaleMm || 1.891;
  const numTiles = (tileCols || 1) * (tileRows || 1);
  const doTileClip = numTiles > 1 && (Boolean(ctx.isExport) || numTiles <= 400) && Boolean(tileBounds);
  const assignCentroidTile = numTiles > 400 && !ctx.isExport && typeof getTileIdForCentroid === 'function';

  const { cellTerracePolys, getActualPrintedSurfaceMinZ } = baseInfo;
  const { nx, ny, xMin, yMin, invDx, invDy, streetSDF, pathSDF } = fields;

  const sampleGridField = (buf, bx, by) => {
    const ix = Math.min(nx - 1, Math.max(0, Math.round((bx - xMin) * invDx)));
    const iy = Math.min(ny - 1, Math.max(0, Math.round((by - yMin) * invDy)));
    return buf[iy * nx + ix];
  };

  const triData = triangulatePrecleanedRoadPoly2D(polyObj.ring, polyObj.holes);
  if (!triData) return;

  // O(1) per-micro-patch centroid tile assignment for >400-tile live interactive WebGL preview
  if (assignCentroidTile) {
    const t0 = triData.capTris[0];
    const cx0 = (t0[0][0] + t0[1][0] + t0[2][0]) * (1.0 / 3.0);
    const cy0 = (t0[0][1] + t0[1][1] + t0[2][1]) * (1.0 / 3.0);
    const pcx = 0.5 * (polyObj.minX + polyObj.maxX);
    const pcy = 0.5 * (polyObj.minY + polyObj.maxY);
    let zSurf = getActualPrintedSurfaceMinZ ? getActualPrintedSurfaceMinZ(pcx, pcy) : baseBottomZ;
    if (zSurf < baseBottomZ - 1e-4) {
      zSurf = getActualPrintedSurfaceMinZ ? getActualPrintedSurfaceMinZ(cx0, cy0) : baseBottomZ;
      if (zSurf < baseBottomZ - 1e-4) zSurf = baseBottomZ;
    }
    const sVal = Math.max(sampleGridField(streetSDF, cx0, cy0), sampleGridField(streetSDF, pcx, pcy));
    const pVal = sampleGridField(pathSDF, cx0, cy0);
    const isStreet = sVal >= pVal - 0.03 && sVal > 0.22;
    const gZ = queryGreeneryPointTopZ(gSpatialIdx, cx0, cy0, 0, false);
    const zBot = gZ !== null ? gZ : zSurf;
    const zTop = gZ !== null
      ? Math.max(gZ + pathHeight, zSurf + (isStreet ? rHeight : 0))
      : (zSurf + (isStreet ? rHeight : pathHeight));
    const outTid = getTileIdForCentroid(pcx, pcy, halfW, halfH, tileCols, tileRows);
    if (isTriDataWeldBijective(triData, zBot, zTop, scaleMm)) {
      emitRoadSlabFromTriData3D(triData, zBot, zTop, 3, meshes.roads, outTid, allocShellId());
    } else {
      const zBotI = Math.round(zBot * 10000), zTopI = Math.round(zTop * 10000);
      const fastRecs = triData.capTris.map(tri => ({ tri, tileId: outTid, zBot, zTop, zBotI, zTopI }));
      emitMergedSlabPiecesManifold(fastRecs, ctx, meshes.roads, allocShellId, false);
    }
    return;
  }

  const spanX = 2 * halfW, spanY = 2 * halfH;
  const cellStepX = spanX / TERRAIN_RES_X, cellStepY = spanY / TERRAIN_RES_Y;
  const padKerf = doTileClip ? 0.08 : 0.0;
  const toGx = x => Math.max(0, Math.min(TERRAIN_RES_X - 1, Math.floor(((x + halfW) / spanX) * TERRAIN_RES_X)));
  const toGy = y => Math.max(0, Math.min(TERRAIN_RES_Y - 1, Math.floor(((y + halfH) / spanY) * TERRAIN_RES_Y)));

  // Fast whole-patch shortcut when micro-patch sits on one uniform dry DEM terrace and crosses 0 greenery boundary walls
  if (cellTerracePolys) {
    const pgx0 = toGx(polyObj.minX - padKerf), pgx1 = toGx(polyObj.maxX + padKerf);
    const pgy0 = toGy(polyObj.minY - padKerf), pgy1 = toGy(polyObj.maxY + padKerf);
    const pWallHits = queryGreeneryWallsSpatialIndex2D(gSpatialIdx, polyObj.minX, polyObj.maxX, polyObj.minY, polyObj.maxY);
    if (pWallHits.length === 0) {
      let uniformZ = null;
      let uniformTid = 0;
      let allUniformDry = true;
      for (let gy = pgy0; gy <= pgy1 && allUniformDry; gy++) {
        const r = gy * TERRAIN_RES_X;
        for (let gx = pgx0; gx <= pgx1; gx++) {
          const tList = cellTerracePolys[r + gx];
          if (!tList || tList.length !== 1 || tList[0].zSurf < baseBottomZ - 1e-4) {
            allUniformDry = false;
            break;
          }
          if (uniformZ === null) {
            uniformZ = tList[0].zSurf;
            uniformTid = tList[0].tileId ?? 0;
          } else if (Math.abs(tList[0].zSurf - uniformZ) > 1e-5 || (doTileClip && (tList[0].tileId ?? 0) !== uniformTid)) {
            allUniformDry = false;
            break;
          }
        }
      }
      if (allUniformDry && doTileClip) {
        const tb = tileBounds[uniformTid];
        if (!tb || polyObj.minX < tb.x0 || polyObj.maxX > tb.x1 || polyObj.minY < tb.y0 || polyObj.maxY > tb.y1) {
          allUniformDry = false;
        }
      }
      if (allUniformDry && uniformZ !== null) {
        let hasStreet = false, hasPath = false;
        const ring = triData.outerClean;
        const step = Math.max(1, Math.floor(ring.length / 16));
        for (let i = 0; i < ring.length; i += step) {
          const sV = sampleGridField(streetSDF, ring[i][0], ring[i][1]);
          const pV = sampleGridField(pathSDF, ring[i][0], ring[i][1]);
          if (sV >= pV - 0.02 && sV > 0.22) hasStreet = true;
          else if (pV > 0.22) hasPath = true;
          if (hasStreet && hasPath) break;
        }
        if (hasStreet !== hasPath) {
          const t0 = triData.capTris[0];
          const cx0 = (t0[0][0] + t0[1][0] + t0[2][0]) / 3.0;
          const cy0 = (t0[0][1] + t0[1][1] + t0[2][1]) / 3.0;
          const gZ = queryGreeneryPointTopZ(gSpatialIdx, cx0, cy0, uniformTid, doTileClip);
          const zBot = gZ !== null ? gZ : uniformZ;
          const zTop = gZ !== null
            ? Math.max(gZ + pathHeight, uniformZ + (hasStreet ? rHeight : 0))
            : (uniformZ + (hasStreet ? rHeight : pathHeight));
          if (isTriDataWeldBijective(triData, zBot, zTop, scaleMm)) {
            const outTid = assignCentroidTile
              ? getTileIdForCentroid(0.5 * (polyObj.minX + polyObj.maxX), 0.5 * (polyObj.minY + polyObj.maxY), halfW, halfH, tileCols, tileRows)
              : (doTileClip ? uniformTid : 0);
            emitRoadSlabFromTriData3D(triData, zBot, zTop, 3, meshes.roads, outTid, allocShellId());
            return;
          }
        }
      }
    }
  }

  const { capTris } = triData;
  const slabRecords = [];
  const splitState = { hadWallSplit: false };
  const pushConvexPiece = (polyPts, tileId, zBot, zTop) => {
    if (zTop <= zBot + 1e-5 || !polyPts || polyPts.length < 3) return;
    const zBotI = Math.round(zBot * 10000);
    const zTopI = Math.round(zTop * 10000);
    if (polyPts.length === 3) {
      const [a, b, c] = polyPts;
      const a2 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (a2 > 2e-6 || a2 < -2e-6) {
        slabRecords.push({ tri: a2 > 0 ? [a, b, c] : [a, c, b], tileId, zBot, zTop, zBotI, zTopI });
      }
      return;
    }
    const p0 = polyPts[0];
    for (let i = 1; i < polyPts.length - 1; i++) {
      const p1 = polyPts[i], p2 = polyPts[i + 1];
      const a2 = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
      if (a2 > 2e-6 || a2 < -2e-6) {
        slabRecords.push({ tri: a2 > 0 ? [p0, p1, p2] : [p0, p2, p1], tileId, zBot, zTop, zBotI, zTopI });
      }
    }
  };

  for (let ti = 0; ti < capTris.length; ti++) {
    const tri = capTris[ti];
    const [a, b, c] = tri;
    const area2 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area2) <= 1e-7) continue;
    const triCCW = area2 > 0 ? [a, b, c] : [a, c, b];

    const cx = (a[0] + b[0] + c[0]) / 3.0;
    const cy = (a[1] + b[1] + c[1]) / 3.0;
    const sVal = Math.max(
      sampleGridField(streetSDF, cx, cy),
      0.5 * (sampleGridField(streetSDF, a[0], a[1]) + sampleGridField(streetSDF, b[0], b[1]))
    );
    const pVal = sampleGridField(pathSDF, cx, cy);
    const isStreet = sVal >= pVal - 0.03 && sVal > 0.22;
    const hBare = isStreet ? rHeight : pathHeight;

    const minX = Math.min(a[0], b[0], c[0]), maxX = Math.max(a[0], b[0], c[0]);
    const minY = Math.min(a[1], b[1], c[1]), maxY = Math.max(a[1], b[1], c[1]);
    const wallHits = queryGreeneryWallsSpatialIndex2D(gSpatialIdx, minX, maxX, minY, maxY);

    if (!cellTerracePolys) {
      const zSurf = getActualPrintedSurfaceMinZ ? getActualPrintedSurfaceMinZ(cx, cy) : baseBottomZ;
      if (zSurf < baseBottomZ - 1e-4) continue;
      if (doTileClip) {
        for (let tid = 0; tid < tileBounds.length; tid++) {
          const tb = tileBounds[tid];
          if (!tb || maxX < tb.x0 || minX > tb.x1 || maxY < tb.y0 || minY > tb.y1) continue;
          const cp = clipConvexPolyToRect2D(triCCW, tb.x0, tb.y0, tb.x1, tb.y1);
          if (cp.length >= 3) pushConvexPiece(cp, tid, zSurf, zSurf + hBare);
        }
      } else {
        pushConvexPiece(triCCW, 0, zSurf, zSurf + hBare);
      }
      continue;
    }

    const gx0 = toGx(minX - padKerf), gx1 = toGx(maxX + padKerf);
    const gy0 = toGy(minY - padKerf), gy1 = toGy(maxY + padKerf);

    let uniformZ = null;
    let uniformTid = 0;
    let isUniformDry = true;
    for (let gy = gy0; gy <= gy1 && isUniformDry; gy++) {
      const r = gy * TERRAIN_RES_X;
      for (let gx = gx0; gx <= gx1; gx++) {
        const tList = cellTerracePolys[r + gx];
        if (!tList || tList.length !== 1 || tList[0].zSurf < baseBottomZ - 1e-4) {
          isUniformDry = false;
          break;
        }
        if (uniformZ === null) {
          uniformZ = tList[0].zSurf;
          uniformTid = tList[0].tileId ?? 0;
        } else if (Math.abs(tList[0].zSurf - uniformZ) > 1e-5 || (doTileClip && (tList[0].tileId ?? 0) !== uniformTid)) {
          isUniformDry = false;
          break;
        }
      }
    }
    if (isUniformDry && doTileClip) {
      const tb = tileBounds[uniformTid];
      if (!tb || minX < tb.x0 || maxX > tb.x1 || minY < tb.y0 || maxY > tb.y1) {
        isUniformDry = false;
      }
    }

    if (isUniformDry && uniformZ !== null) {
      const tid = doTileClip ? uniformTid : 0;
      let touchesWall = false;
      for (let wi = 0; wi < wallHits.length; wi++) {
        const w = wallHits[wi];
        if (doTileClip && w.tileId !== tid) continue;
        if (convexPolyNearSegment2D(triCCW, w.a, w.b)) {
          touchesWall = true;
          break;
        }
      }
      if (!touchesWall) {
        const gZ = queryGreeneryPointTopZ(gSpatialIdx, cx, cy, tid, doTileClip);
        if (gZ === null) {
          pushConvexPiece(triCCW, tid, uniformZ, uniformZ + hBare);
        } else {
          pushConvexPiece(triCCW, tid, gZ, Math.max(gZ + pathHeight, uniformZ + (isStreet ? rHeight : 0)));
        }
        continue;
      }
    }

    const dryPieces = [];
    if (isUniformDry && uniformZ !== null) {
      dryPieces.push({ poly: triCCW, zTerrace: uniformZ, tileId: doTileClip ? uniformTid : 0 });
    } else {
      const wSub = gx1 - gx0 + 1;
      const hSub = gy1 - gy0 + 1;
      const visCell = new Uint8Array(wSub * hSub);

      for (let ly = 0; ly < hSub; ly++) {
        const gy = gy0 + ly;
        const r = gy * TERRAIN_RES_X;
        for (let lx = 0; lx < wSub; lx++) {
          const vIdx = ly * wSub + lx;
          if (visCell[vIdx]) continue;
          const gx = gx0 + lx;
          const tList = cellTerracePolys[r + gx];
          if (!tList || tList.length === 0) {
            visCell[vIdx] = 1;
            continue;
          }
          if (tList.length > 1) {
            visCell[vIdx] = 1;
            for (let k = 0; k < tList.length; k++) {
              const tp = tList[k];
              if (tp.zSurf < baseBottomZ - 1e-4) continue;
              const clipped = intersectConvexPolys2D(triCCW, tp.poly);
              if (clipped.length >= 3 && Math.abs(signedArea2D(clipped)) >= 1e-5) {
                dryPieces.push({ poly: clipped, zTerrace: tp.zSurf, tileId: doTileClip ? (tp.tileId ?? 0) : 0 });
              }
            }
            continue;
          }

          const tp0 = tList[0];
          const z0 = tp0.zSurf;
          if (z0 < baseBottomZ - 1e-4) {
            visCell[vIdx] = 1;
            continue;
          }
          const tid0 = tp0.tileId ?? 0;

          // Greedily merge contiguous uniform-Z (and same-tile when doTileClip) cells into one rectangle
          let lxEnd = lx;
          while (lxEnd + 1 < wSub && !visCell[ly * wSub + lxEnd + 1]) {
            const tl = cellTerracePolys[r + gx0 + lxEnd + 1];
            if (!tl || tl.length !== 1 || Math.abs(tl[0].zSurf - z0) > 1e-5) break;
            if (doTileClip && (tl[0].tileId ?? 0) !== tid0) break;
            lxEnd++;
          }
          let lyEnd = ly;
          outerRow: while (lyEnd + 1 < hSub) {
            const nr = (gy0 + lyEnd + 1) * TERRAIN_RES_X;
            const nvRow = (lyEnd + 1) * wSub;
            for (let tx = lx; tx <= lxEnd; tx++) {
              if (visCell[nvRow + tx]) break outerRow;
              const tl = cellTerracePolys[nr + gx0 + tx];
              if (!tl || tl.length !== 1 || Math.abs(tl[0].zSurf - z0) > 1e-5) break outerRow;
              if (doTileClip && (tl[0].tileId ?? 0) !== tid0) break outerRow;
            }
            lyEnd++;
          }

          for (let ty = ly; ty <= lyEnd; ty++) {
            const vr = ty * wSub;
            for (let tx = lx; tx <= lxEnd; tx++) visCell[vr + tx] = 1;
          }

          let rx0, ry0, rx1, ry1;
          if (doTileClip) {
            const tpMax = cellTerracePolys[(gy0 + lyEnd) * TERRAIN_RES_X + (gx0 + lxEnd)][0];
            rx0 = tp0.poly[0][0];
            ry0 = tp0.poly[0][1];
            rx1 = tpMax.poly[2][0];
            ry1 = tpMax.poly[2][1];
          } else {
            rx0 = -halfW + (gx0 + lx) * cellStepX;
            ry0 = -halfH + (gy0 + ly) * cellStepY;
            rx1 = -halfW + (gx0 + lxEnd + 1) * cellStepX;
            ry1 = -halfH + (gy0 + lyEnd + 1) * cellStepY;
          }

          if (maxX < rx0 || minX > rx1 || maxY < ry0 || minY > ry1) continue;
          const clipped = (minX >= rx0 && maxX <= rx1 && minY >= ry0 && maxY <= ry1)
            ? triCCW
            : clipConvexPolyToRect2D(triCCW, rx0, ry0, rx1, ry1);
          if (clipped.length >= 3 && Math.abs(signedArea2D(clipped)) >= 1e-5) {
            dryPieces.push({ poly: clipped, zTerrace: z0, tileId: doTileClip ? tid0 : 0 });
          }
        }
      }
    }

    for (let pi = 0; pi < dryPieces.length; pi++) {
      const { poly: dryPoly, zTerrace, tileId: pieceTid } = dryPieces[pi];
      drapeConvexPieceOverGreenery2D(
        dryPoly, zTerrace, pieceTid, wallHits, gSpatialIdx,
        doTileClip, isStreet, rHeight, pathHeight, hBare, pushConvexPiece, splitState, 0
      );
    }
  }

  if (slabRecords.length > 0) {
    emitMergedSlabPiecesManifold(slabRecords, ctx, meshes.roads, allocShellId, splitState.hadWallSplit);
  }
}

function syncRoadExclusionIntoTreeMask(fields, ctx) {
  const { MASK_RES_X, MASK_RES_Y, padW, padH, spanW, spanH, roadAndBldMask } = ctx;
  if (!roadAndBldMask) return;
  const { nx, ny, xMin, yMin, dx, dy, combinedSDF } = fields;
  const scaleX = MASK_RES_X / spanW;
  const scaleY = MASK_RES_Y / spanH;

  for (let iy = 1; iy < ny - 1; iy++) {
    const by = yMin + iy * dy;
    const myC = Math.floor(((padH - by) * scaleY));
    const my0 = myC > 2 ? myC - 2 : 0;
    const my1 = myC + 2 < MASK_RES_Y ? myC + 2 : MASK_RES_Y - 1;
    const gRow = iy * nx;
    for (let ix = 1; ix < nx - 1; ix++) {
      if (combinedSDF[gRow + ix] <= 0.30) continue;
      const bx = xMin + ix * dx;
      const mxC = Math.floor(((bx + padW) * scaleX));
      const mx0 = mxC > 2 ? mxC - 2 : 0;
      const mx1 = mxC + 2 < MASK_RES_X ? mxC + 2 : MASK_RES_X - 1;
      for (let my = my0; my <= my1; my++) {
        const dy2 = (my - myC) * (my - myC);
        const mRow = my * MASK_RES_X;
        for (let mx = mx0; mx <= mx1; mx++) {
          if ((mx - mxC) * (mx - mxC) + dy2 <= 5) {
            roadAndBldMask[mRow + mx] = 1;
          }
        }
      }
    }
  }
}

function emitRoadsLayerSync(scene, ctx, baseInfo, state, meshes, allocShellId, _bandAssigner) {
  const lv = state.layerVisible || state.layers;
  const roadsVisible = !lv || lv.roads !== false;
  if (!roadsVisible) return;
  const greenVisible = !lv || lv.greenery !== false;

  const fields = buildAnalyticalRoadFields(scene, ctx, state, greenVisible);
  if (fields.activeCells < 2) return;
  syncRoadExclusionIntoTreeMask(fields, ctx);

  const polys = extractRoadMicroPatchPolygons2D(
    fields.combinedSDF, fields.nx, fields.ny,
    fields.xMin, fields.xMax, fields.yMin, fields.yMax,
    0.50, 0.008, fields.isStressGrid
  );
  if (polys.length === 0) return;

  const numTiles = (ctx.tileCols || 1) * (ctx.tileRows || 1);
  const doTileClip = numTiles > 1 && (Boolean(ctx.isExport) || numTiles <= 400) && Boolean(ctx.tileBounds);
  const gSpatialIdx = buildGreeneryTopSpatialIndex2D(greenVisible ? meshes.greenery : null, ctx.halfW, ctx.halfH, doTileClip, fields.isStressGrid);
  for (let i = 0; i < polys.length; i++) {
    drapeAndEmitRoadPolygon2D(polys[i], fields, gSpatialIdx, ctx, baseInfo, meshes, allocShellId);
  }
}

async function emitRoadsLayerAsync(scene, ctx, baseInfo, state, meshes, allocShellId, _bandAssigner, yieldCtrl, progressTracker = null) {
  const lv = state.layerVisible || state.layers;
  const roadsVisible = !lv || lv.roads !== false;
  if (!roadsVisible) return;
  const greenVisible = !lv || lv.greenery !== false;

  if (yieldCtrl) {
    yieldCtrl.checkCancellation();
    await yieldCtrl.yieldIfNeeded();
  }

  const fields = buildAnalyticalRoadFields(scene, ctx, state, greenVisible);
  if (fields.activeCells < 2) return;
  syncRoadExclusionIntoTreeMask(fields, ctx);

  if (yieldCtrl) {
    yieldCtrl.checkCancellation();
    await yieldCtrl.yieldIfNeeded();
  }

  const polys = extractRoadMicroPatchPolygons2D(
    fields.combinedSDF, fields.nx, fields.ny,
    fields.xMin, fields.xMax, fields.yMin, fields.yMax,
    0.50, 0.008, fields.isStressGrid
  );
  if (polys.length === 0) return;

  if (yieldCtrl) {
    await yieldCtrl.yieldIfNeeded();
    yieldCtrl.checkCancellation();
  }

  const numTiles = (ctx.tileCols || 1) * (ctx.tileRows || 1);
  const doTileClip = numTiles > 1 && (Boolean(ctx.isExport) || numTiles <= 400) && Boolean(ctx.tileBounds);
  const gSpatialIdx = buildGreeneryTopSpatialIndex2D(greenVisible ? meshes.greenery : null, ctx.halfW, ctx.halfH, doTileClip, fields.isStressGrid);
  const totalP = Math.max(1, polys.length);

  for (let i = 0; i < polys.length; i++) {
    if (yieldCtrl && (i & 7) === 0) yieldCtrl.checkCancellation();
    drapeAndEmitRoadPolygon2D(polys[i], fields, gSpatialIdx, ctx, baseInfo, meshes, allocShellId);

    if (progressTracker && progressTracker.onProgress) {
      const frac = 0.45 + ((i + 1) / totalP) * 0.45;
      const pct = 42 + Math.min(12, Math.round(frac * 12));
      if (pct !== progressTracker.lastReportedPct) {
        progressTracker.lastReportedPct = pct;
        progressTracker.onProgress(
          pct,
          `Etap 2/5: Konturowanie roślinności i dróg (${i + 1}/${totalP})...`,
          `Infrastruktura drogowa (${i + 1}/${totalP})`
        );
      }
    }
    if (yieldCtrl && (i & 7) === 7) {
      await yieldCtrl.yieldIfNeeded();
    }
  }
}

function emitRoadsLayer(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl = null, progressTracker = null) {
  if (yieldCtrl) {
    return emitRoadsLayerAsync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl, progressTracker);
  }
  return emitRoadsLayerSync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner);
}

if (typeof window !== 'undefined') {
  window.isFootpathRoad = isFootpathRoad;
  window.rasterizeRoadAndFootpathImages = rasterizeRoadAndFootpathImages;
  window.finalizeRoadAndFootpathMasks = finalizeRoadAndFootpathMasks;
  window.emitRoadsLayer = emitRoadsLayer;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isFootpathRoad,
    rasterizeRoadAndFootpathImages,
    finalizeRoadAndFootpathMasks,
    emitRoadsLayerSync,
    emitRoadsLayerAsync,
    emitRoadsLayer
  };
}
