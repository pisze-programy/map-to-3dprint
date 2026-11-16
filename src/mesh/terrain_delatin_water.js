// ============================================================================
// src/mesh/terrain_delatin_water.js
// Adaptive Delatin TIN Terrain, Monotonic Mountain River Profiling & Water Carve
// ============================================================================

(function (root) {
  function _getCore() {
    if (typeof getManifoldLib === 'function' && typeof clipperUnionPolys === 'function') {
      return {
        getVendorDeps, signedArea2D, ensureWinding,
        clipperUnionPolys, clipperIntersectPolys, clipperDiffPolys, clipperOffsetPolys,
        clipperBufferOpenPaths, ringsToOutersWithHoles, safeDeleteManifold,
        batchUnionManifolds, extrudeRingSolid, manifoldFromRawSoup, boxManifoldFromBounds
      };
    }
    return require('../geometry/manifold_core.js');
  }

  function buildDelatinTerrainManifold(ctx, minX, maxX, minY, maxY) {
    const core = _getCore(), { mf } = ctx, { Delatin } = core.getVendorDeps();
    if (ctx.elevReliefM <= 0.35 || typeof Delatin !== 'function') {
      return core.boxManifoldFromBounds(mf, minX, maxX, minY, maxY, 0.0, ctx.zLandDatum);
    }
    const nx = 65, ny = 65, spanX = maxX - minX, spanY = maxY - minY, gridZ = new Float64Array(nx * ny);
    for (let iy = 0; iy < ny; iy++) {
      const wy = minY + (iy / (ny - 1)) * spanY;
      for (let ix = 0; ix < nx; ix++) {
        gridZ[iy * nx + ix] = Math.max(0.4, ctx.elevToZ(ctx.sampleDemElevM(minX + (ix / (nx - 1)) * spanX, wy)));
      }
    }
    const buildGridSolidFallback = () => {
      const pos = [], tris = [], idx = (ix, iy) => iy * nx + ix, bIdx = (ix, iy) => nx * ny + iy * nx + ix;
      for (const zZero of [false, true]) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
        pos.push(minX + (ix / (nx - 1)) * spanX, minY + (iy / (ny - 1)) * spanY, zZero ? 0.0 : gridZ[idx(ix, iy)]);
      }
      for (let iy = 0; iy < ny - 1; iy++) for (let ix = 0; ix < nx - 1; ix++) {
        const a = idx(ix, iy), b = idx(ix + 1, iy), c = idx(ix + 1, iy + 1), d = idx(ix, iy + 1);
        const ba = bIdx(ix, iy), bb = bIdx(ix + 1, iy), bc = bIdx(ix + 1, iy + 1), bd = bIdx(ix, iy + 1);
        tris.push(a, b, c, a, c, d, ba, bc, bb, ba, bd, bc);
      }
      for (let ix = 0; ix < nx - 1; ix++) {
        tris.push(bIdx(ix, 0), bIdx(ix + 1, 0), idx(ix + 1, 0), bIdx(ix, 0), idx(ix + 1, 0), idx(ix, 0));
        tris.push(bIdx(ix + 1, ny - 1), bIdx(ix, ny - 1), idx(ix, ny - 1), bIdx(ix + 1, ny - 1), idx(ix, ny - 1), idx(ix + 1, ny - 1));
      }
      for (let iy = 0; iy < ny - 1; iy++) {
        tris.push(bIdx(0, iy + 1), bIdx(0, iy), idx(0, iy), bIdx(0, iy + 1), idx(0, iy), idx(0, iy + 1));
        tris.push(bIdx(nx - 1, iy), bIdx(nx - 1, iy + 1), idx(nx - 1, iy + 1), bIdx(nx - 1, iy), idx(nx - 1, iy + 1), idx(nx - 1, iy));
      }
      return core.manifoldFromRawSoup(mf, new Float32Array(pos), new Uint32Array(tris), 1e-5);
    };
    try {
      const tin = new Delatin(gridZ, nx, ny);
      tin.run(Math.max(0.03, 0.08 / ctx.scaleMm));
      const { coords: tc, triangles: tt } = tin, nTop = Math.floor(tc.length / 2);
      if (nTop >= 4 && tt.length >= 6) {
        const topXYZ = [];
        for (let i = 0; i < nTop; i++) {
          const gx = tc[i * 2], gy = tc[i * 2 + 1];
          topXYZ.push(minX + (gx / (nx - 1)) * spanX, minY + (gy / (ny - 1)) * spanY, gridZ[Math.max(0, Math.min(ny - 1, Math.round(gy))) * nx + Math.max(0, Math.min(nx - 1, Math.round(gx)))]);
        }
        const dirEdgeCount = new Map(), directedTris = [];
        for (let t = 0; t < tt.length; t += 3) {
          let a = tt[t], b = tt[t + 1], c = tt[t + 2];
          const cross2 = (topXYZ[b * 3] - topXYZ[a * 3]) * (topXYZ[c * 3 + 1] - topXYZ[a * 3 + 1]) - (topXYZ[b * 3 + 1] - topXYZ[a * 3 + 1]) * (topXYZ[c * 3] - topXYZ[a * 3]);
          if (Math.abs(cross2) < 1e-10) continue;
          if (cross2 < 0) { const tmp = b; b = c; c = tmp; }
          directedTris.push(a, b, c);
          for (const [u, v] of [[a, b], [b, c], [c, a]]) {
            if (dirEdgeCount.has(`${v}:${u}`)) dirEdgeCount.delete(`${v}:${u}`); else dirEdgeCount.set(`${u}:${v}`, [u, v]);
          }
        }
        const boundaryEdges = Array.from(dirEdgeCount.values());
        if (boundaryEdges.length >= 4) {
          const pos = topXYZ.slice(), tris = directedTris.slice(), botMap = new Map(), centerBotIdx = pos.length / 3;
          const getBotVert = (ti) => { if (!botMap.has(ti)) { botMap.set(ti, pos.length / 3); pos.push(pos[ti * 3], pos[ti * 3 + 1], 0.0); } return botMap.get(ti); };
          pos.push((minX + maxX) * 0.5, (minY + maxY) * 0.5, 0.0);
          for (const [u, v] of boundaryEdges) { const bu = getBotVert(u), bv = getBotVert(v); tris.push(u, bu, bv, u, bv, v, centerBotIdx, bv, bu); }
          const man = core.manifoldFromRawSoup(mf, new Float32Array(pos), new Uint32Array(tris), 1e-5);
          if (man && man.numTri() > 0) return man;
        }
      }
    } catch (_) {}
    return buildGridSolidFallback();
  }

  function _buildSlopedPrism(core, mf, outer, holes, zBotFn, zTopFn) {
    const { earcut } = core.getVendorDeps(), oClean = core.ensureWinding(outer, true, 1e-4);
    if (!earcut || oClean.length < 3) return null;
    const rings = [oClean];
    for (const h of (holes || [])) { const hc = core.ensureWinding(h, false, 1e-4); if (hc.length >= 3) rings.push(hc); }
    const coords = [], holeIndices = [], pts2D = [], slices = [];
    for (let r = 0; r < rings.length; r++) {
      if (r > 0) holeIndices.push(pts2D.length);
      slices.push([pts2D.length, rings[r].length]);
      for (const p of rings[r]) { coords.push(p[0], p[1]); pts2D.push(p); }
    }
    const triIdx = earcut(coords, holeIndices.length > 0 ? holeIndices : undefined, 2);
    if (!triIdx || triIdx.length < 3) return null;
    const nPts = pts2D.length, pos = new Array(nPts * 6), tris = [];
    for (let i = 0; i < nPts; i++) {
      const x = pts2D[i][0], y = pts2D[i][1], zb = zBotFn(x, y), zt = Math.max(zb + 0.02, zTopFn(x, y));
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = zt;
      pos[(nPts + i) * 3] = x; pos[(nPts + i) * 3 + 1] = y; pos[(nPts + i) * 3 + 2] = zb;
    }
    for (let k = 0; k < triIdx.length; k += 3) {
      let a = triIdx[k], b = triIdx[k + 1], c = triIdx[k + 2];
      const cross2 = (pts2D[b][0] - pts2D[a][0]) * (pts2D[c][1] - pts2D[a][1]) - (pts2D[b][1] - pts2D[a][1]) * (pts2D[c][0] - pts2D[a][0]);
      if (Math.abs(cross2) < 1e-10) continue;
      if (cross2 < 0) { const t = b; b = c; c = t; }
      tris.push(a, b, c, nPts + a, nPts + c, nPts + b);
    }
    for (const [start, len] of slices) for (let i = 0; i < len; i++) {
      const u = start + i, v = start + ((i + 1) % len);
      tris.push(u, nPts + u, nPts + v, u, nPts + v, v);
    }
    return tris.length >= 12 ? core.manifoldFromRawSoup(mf, new Float32Array(pos), new Uint32Array(tris), 1e-5) : null;
  }

  function _ringBBox(ring) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const x = ring[i][0], y = ring[i][1];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return [x0, y0, x1, y1];
  }

  function _ptInRingLocal(px, py, poly) {
    let inside = false;
    for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }

  function _probeRingInteriorPt(poly) {
    if (!poly || poly.length < 3) return [0, 0];
    let cx = 0, cy = 0, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      cx += poly[i][0]; cy += poly[i][1];
      if (poly[i][1] < y0) y0 = poly[i][1];
      if (poly[i][1] > y1) y1 = poly[i][1];
    }
    cx /= poly.length; cy /= poly.length;
    if (_ptInRingLocal(cx, cy, poly)) return [cx, cy];
    const dy = y1 - y0;
    if (dy > 1e-9) {
      let bestMid = null, bestSpan = -1;
      for (const frac of [0.5, 0.37, 0.63, 0.25, 0.75]) {
        const sy = y0 + dy * frac, xs = [];
        for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
          const yi = poly[i][1], yj = poly[j][1];
          if ((yi > sy) !== (yj > sy)) xs.push(poly[i][0] + ((poly[j][0] - poly[i][0]) * (sy - yi)) / (yj - yi));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const span = xs[k + 1] - xs[k];
          if (span > bestSpan) {
            const mx = (xs[k] + xs[k + 1]) * 0.5;
            if (_ptInRingLocal(mx, sy, poly)) { bestSpan = span; bestMid = [mx, sy]; }
          }
        }
      }
      if (bestMid) return bestMid;
    }
    return [poly[0][0], poly[0][1]];
  }

  function _pointInWaterEntry(px, py, entry) {
    const bb = entry.bb;
    if (px < bb[0] - 1e-9 || px > bb[2] + 1e-9 || py < bb[1] - 1e-9 || py > bb[3] + 1e-9) return false;
    if (!_ptInRingLocal(px, py, entry.outer)) return false;
    const holes = entry.holes;
    for (let h = 0; h < holes.length; h++) {
      if (_ptInRingLocal(px, py, holes[h])) return false;
    }
    return true;
  }

  function _minDistSqToRing(px, py, ring) {
    let best = Infinity;
    for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
      const ax = ring[j][0], ay = ring[j][1], dx = ring[i][0] - ax, dy = ring[i][1] - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d2 = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      if (d2 < best) best = d2;
    }
    return best;
  }

  function _isPointNearWaterEntry(px, py, entry, maxDist) {
    const bb = entry.bb;
    if (px < bb[0] - maxDist || px > bb[2] + maxDist || py < bb[1] - maxDist || py > bb[3] + maxDist) return false;
    if (_pointInWaterEntry(px, py, entry)) return true;
    if (maxDist <= 0) return false;
    const maxD2 = maxDist * maxDist;
    if (_minDistSqToRing(px, py, entry.outer) <= maxD2) return true;
    for (let h = 0; h < entry.holes.length; h++) {
      if (_minDistSqToRing(px, py, entry.holes[h]) <= maxD2) return true;
    }
    return false;
  }

  function _computeMinWaterTerrainZ(ctx, wp, bb) {
    let minZ = Infinity;
    const sampleXY = (x, y) => {
      const z = ctx.getTerrainZ(x, y);
      if (z < minZ) minZ = z;
    };
    const holes = wp.holes || [];
    const allRings = [wp.outer, ...holes];
    for (let r = 0; r < allRings.length; r++) {
      const ring = allRings[r];
      if (!ring || ring.length < 3) continue;
      const n = ring.length, vStride = n > 512 ? Math.max(1, Math.floor(n / 512)) : 1;
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        if (i % vStride === 0) sampleXY(a[0], a[1]);
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (segLen > 3.0) {
          const steps = Math.min(64, Math.ceil(segLen / 3.0));
          for (let s = 1; s < steps; s++) {
            const t = s / steps;
            sampleXY(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
          }
        }
      }
    }
    const probe = _probeRingInteriorPt(wp.outer);
    if (_pointInWaterEntry(probe[0], probe[1], { outer: wp.outer, holes, bb })) sampleXY(probe[0], probe[1]);

    const spanX = bb[2] - bb[0], spanY = bb[3] - bb[1], nSlices = 16;
    if (spanY > 1e-6) {
      for (let s = 0; s < nSlices; s++) {
        const sy = bb[1] + spanY * ((s + 0.5) / nSlices), xs = [];
        for (let r = 0; r < allRings.length; r++) {
          const ring = allRings[r];
          for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
            const yi = ring[i][1], yj = ring[j][1];
            if ((yi > sy) !== (yj > sy)) xs.push(ring[i][0] + ((ring[j][0] - ring[i][0]) * (sy - yi)) / (yj - yi));
          }
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const x0 = xs[k], w = xs[k + 1] - x0;
          if (w <= 1e-6) continue;
          const sub = Math.max(1, Math.min(16, Math.ceil(w / 4.0)));
          for (let m = 0; m < sub; m++) sampleXY(x0 + w * ((m + 0.5) / sub), sy);
        }
      }
    }
    if (spanX > 1e-6) {
      for (let s = 0; s < nSlices; s++) {
        const sx = bb[0] + spanX * ((s + 0.5) / nSlices), ys = [];
        for (let r = 0; r < allRings.length; r++) {
          const ring = allRings[r];
          for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
            const xi = ring[i][0], xj = ring[j][0];
            if ((xi > sx) !== (xj > sx)) ys.push(ring[i][1] + ((ring[j][1] - ring[i][1]) * (sx - xi)) / (xj - xi));
          }
        }
        ys.sort((a, b) => a - b);
        for (let k = 0; k + 1 < ys.length; k += 2) {
          const y0 = ys[k], h = ys[k + 1] - y0;
          if (h <= 1e-6) continue;
          const sub = Math.max(1, Math.min(16, Math.ceil(h / 4.0)));
          for (let m = 0; m < sub; m++) sampleXY(sx, y0 + h * ((m + 0.5) / sub));
        }
      }
    }
    return Number.isFinite(minZ) ? minZ : ctx.zLandDatum;
  }

  function _classifyFlatWaterPolys(ctx, polys2D) {
    const { scaleMm } = ctx;
    const elThreshold = Math.max(ctx.zWaterTop + 1.2 / scaleMm, ctx.zLandDatum + 0.8 / scaleMm);
    const out = [];
    for (const wp of (polys2D || [])) {
      if (!wp || !wp.outer || wp.outer.length < 3) continue;
      const holes = wp.holes || [], bb = _ringBBox(wp.outer);
      let minTerrainZ = ctx.zLandDatum, isEl = false;
      if (ctx.elevReliefM > 2.0) {
        minTerrainZ = _computeMinWaterTerrainZ(ctx, wp, bb);
        isEl = minTerrainZ > elThreshold;
      }
      const topZ = isEl ? Math.max(ctx.zWaterTop, minTerrainZ - 0.25 / scaleMm) : ctx.zWaterTop;
      const flrZ = isEl ? Math.max(ctx.zWaterCarveFloor, topZ - 0.45 / scaleMm) : ctx.zWaterCarveFloor;
      out.push({ outer: wp.outer, holes, bb, minTerrainZ, isEl, topZ, flrZ });
    }
    return out;
  }

  function _bankZToSlopedWaterTopZ(ctx, bz) {
    const { scaleMm } = ctx;
    const slopeRecess = 0.25 / scaleMm;
    const datumRecess = Math.max(slopeRecess, ctx.zLandDatum - ctx.zWaterTop);
    const blendSpan = 1.5 / scaleMm;
    const hAbove = Math.max(0, bz - ctx.zLandDatum);
    const t = blendSpan > 1e-9 ? Math.min(1, hAbove / blendSpan) : 1;
    return Math.max(ctx.zWaterTop, bz - (datumRecess + (slopeRecess - datumRecess) * t));
  }

  function _resampleAndProfileWaterLine(ctx, rawPts, halfW, waterEntries, islandMaskEntries) {
    const { scaleToBed, scaleMm } = ctx;
    const minStep = Math.max(0.45, halfW * 0.9);
    const basePts = [rawPts[0]];
    for (let i = 1; i < rawPts.length - 1; i++) {
      if (Math.hypot(rawPts[i][0] - basePts[basePts.length - 1][0], rawPts[i][1] - basePts[basePts.length - 1][1]) >= minStep) {
        basePts.push(rawPts[i]);
      }
    }
    basePts.push(rawPts[rawPts.length - 1]);

    const maxStep = Math.max(2.0, halfW * 2.0);
    const coarsePts = [basePts[0]];
    for (let i = 0; i < basePts.length - 1; i++) {
      const a = basePts[i], b = basePts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nSub = Math.max(1, Math.ceil(len / maxStep));
      for (let s = 1; s <= nSub; s++) {
        const t = s / nSub;
        coarsePts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }

    const shoreStep = Math.max(0.35, Math.min(1.0, halfW * 0.65));
    const shoreSnapDist = Math.max(halfW + shoreStep + 0.05, halfW * 1.85);
    const nearProbeDist = shoreSnapDist + maxStep;
    const isNearWater = (pt) => waterEntries.some(we => _isPointNearWaterEntry(pt[0], pt[1], we, nearProbeDist));

    const pts = [coarsePts[0]];
    for (let i = 0; i < coarsePts.length - 1; i++) {
      const a = coarsePts[i], b = coarsePts[i + 1];
      if (waterEntries.length > 0 && (isNearWater(a) || isNearWater(b))) {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const nSub = Math.max(1, Math.ceil(len / shoreStep));
        for (let s = 1; s <= nSub; s++) {
          const t = s / nSub;
          pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
      } else {
        pts.push(b);
      }
    }

    const isInsideWaterOrIsland = (x, y) => (
      waterEntries.some(we => _pointInWaterEntry(x, y, we)) ||
      islandMaskEntries.some(ie => _pointInWaterEntry(x, y, ie))
    );

    let allSubmerged = (waterEntries.length > 0 || islandMaskEntries.length > 0);
    if (allSubmerged) {
      for (let i = 0; i < pts.length; i++) {
        if (!isInsideWaterOrIsland(pts[i][0], pts[i][1])) { allSubmerged = false; break; }
        if (i + 1 < pts.length && !isInsideWaterOrIsland((pts[i][0] + pts[i + 1][0]) * 0.5, (pts[i][1] + pts[i + 1][1]) * 0.5)) {
          allSubmerged = false; break;
        }
      }
    }
    if (allSubmerged) return { submerged: true, pts, halfW, despikedTopZ: [], nearWater: [] };

    const nearWater = new Array(pts.length).fill(false);
    const rawTopZ = new Array(pts.length);
    let totalLen = 0;
    for (let idx = 0; idx < pts.length; idx++) {
      const p = pts[idx];
      if (idx > 0) totalLen += Math.hypot(p[0] - pts[idx - 1][0], p[1] - pts[idx - 1][1]);
      let matchedZ = Infinity;
      for (let w = 0; w < waterEntries.length; w++) {
        if (_isPointNearWaterEntry(p[0], p[1], waterEntries[w], shoreSnapDist)) {
          if (waterEntries[w].topZ < matchedZ) matchedZ = waterEntries[w].topZ;
        }
      }
      if (!Number.isFinite(matchedZ)) {
        for (let k = 0; k < islandMaskEntries.length; k++) {
          if (_pointInWaterEntry(p[0], p[1], islandMaskEntries[k])) { matchedZ = ctx.zWaterTop; break; }
        }
      }
      if (Number.isFinite(matchedZ)) {
        nearWater[idx] = true;
        rawTopZ[idx] = matchedZ;
      } else {
        const nxt = pts[Math.min(pts.length - 1, idx + 1)], prv = pts[Math.max(0, idx - 1)];
        const tx = nxt[0] - prv[0], ty = nxt[1] - prv[1], tl = Math.hypot(tx, ty) || 1, off = halfW * 1.35;
        const bz = Math.min(
          ctx.getTerrainZ(p[0], p[1]),
          ctx.getTerrainZ(p[0] - (ty / tl) * off, p[1] + (tx / tl) * off),
          ctx.getTerrainZ(p[0] + (ty / tl) * off, p[1] - (tx / tl) * off)
        );
        rawTopZ[idx] = _bankZToSlopedWaterTopZ(ctx, bz);
      }
    }

    // Monotonic-preserving bridge DSM despike filter: leaves any genuine monotonic slope 100% untouched
    // while clamping isolated bridge/overpass DSM humps before flat/sloped classification & flow ordering
    const despikedTopZ = rawTopZ.slice();
    if (pts.length >= 3) {
      const avgStep = totalLen / Math.max(1, pts.length - 1);
      const bridgeSpanU = Math.max(2.5, 38.0 * ctx.mToU * scaleToBed);
      const winK = Math.max(1, Math.min(Math.floor((pts.length - 1) / 2), Math.ceil(bridgeSpanU / Math.max(0.4, avgStep))));
      for (let i = 1; i < pts.length - 1; i++) {
        if (nearWater[i]) continue;
        let lMin = Infinity, rMin = Infinity;
        for (let j = Math.max(0, i - winK); j < i; j++) if (rawTopZ[j] < lMin) lMin = rawTopZ[j];
        for (let j = i + 1; j <= Math.min(pts.length - 1, i + winK); j++) if (rawTopZ[j] < rMin) rMin = rawTopZ[j];
        const cap = Math.max(lMin, rMin);
        if (despikedTopZ[i] > cap) despikedTopZ[i] = cap;
      }
      if (pts.length >= 4) {
        if (!nearWater[0]) {
          const ref0 = Math.max(0, despikedTopZ[1] - despikedTopZ[2]);
          if (despikedTopZ[0] - despikedTopZ[1] > Math.max(1.5 / scaleMm, 3.0 * ref0 + 0.6 / scaleMm)) despikedTopZ[0] = despikedTopZ[1] + ref0;
        }
        const last = pts.length - 1;
        if (!nearWater[last]) {
          const refN = Math.max(0, despikedTopZ[last - 1] - despikedTopZ[last - 2]);
          if (despikedTopZ[last] - despikedTopZ[last - 1] > Math.max(1.5 / scaleMm, 3.0 * refN + 0.6 / scaleMm)) despikedTopZ[last] = despikedTopZ[last - 1] + refN;
        }
      }
    }
    return { submerged: false, pts, halfW, despikedTopZ, nearWater };
  }

  function _classifyLinearWaterways(ctx, scene, arealWaterEntries, islandMaskEntries) {
    if (ctx.waterCutout) return { flatWlPaths: [], slopedCandidates: [] };
    const { toBed, scaleToBed, scaleMm } = ctx;
    const flatWlPaths = [], slopedCandidates = [];
    for (const wl of (scene && scene.waterLines) || []) {
      if (!wl || !wl.pts || wl.pts.length < 2) continue;
      const halfW = Math.max(ctx.minPrintU * 0.65, ((wl.width || 0.7) * 0.5) * scaleToBed);
      const rawPts = wl.pts.map(toBed);
      if (ctx.elevReliefM <= 2.0) {
        flatWlPaths.push({ pts: rawPts, halfW });
        continue;
      }
      const prof = _resampleAndProfileWaterLine(ctx, rawPts, halfW, arealWaterEntries, islandMaskEntries);
      if (prof.submerged) continue;
      let zMin = Infinity, zMax = -Infinity;
      for (let i = 0; i < prof.despikedTopZ.length; i++) {
        const z = prof.despikedTopZ[i];
        if (z < zMin) zMin = z;
        if (z > zMax) zMax = z;
      }
      if (zMax - zMin <= 0.35 / scaleMm) {
        flatWlPaths.push({ pts: prof.pts, halfW });
      } else {
        slopedCandidates.push({ rawPts, halfW, prof });
      }
    }
    return { flatWlPaths, slopedCandidates };
  }

  function _emitSlopedWaterReaches(core, ctx, plateClipPoly, slopedCandidates, flatWaterRings, flatWaterEntries, effectiveIslandPolys, islandMaskEntries, protectedPolys, hasExtraBufferedCanals) {
    if (!slopedCandidates.length) return { slopedReaches: [], slopedRingList: [] };
    const { scaleMm } = ctx;
    const slopedReaches = [], slopedRingList = [];

    // Shrink flatWaterRings by 0.025u in the CSG exclusion mask so shoreline tributary mouths overlap
    // flat water by 0.025u at identical coplanar [flrZ, topZ] (eliminating float32/Clipper micro-cracks),
    // while strictly subtracting unshrunk effectiveIslandPolys and protectedPolys!
    let slopedExcludePolys = flatWaterRings.length > 0
      ? core.clipperOffsetPolys(flatWaterRings, -0.025, 'Miter', 1e-5)
      : [];
    if (effectiveIslandPolys.length > 0) {
      slopedExcludePolys = core.clipperUnionPolys(slopedExcludePolys, 1e-5, effectiveIslandPolys);
    }
    if (protectedPolys.length > 0) {
      slopedExcludePolys = core.clipperUnionPolys(slopedExcludePolys, 1e-5, protectedPolys);
    }

    const isInsideWaterOrIsland = (x, y) => (
      flatWaterEntries.some(we => _pointInWaterEntry(x, y, we)) ||
      islandMaskEntries.some(ie => _pointInWaterEntry(x, y, ie))
    );

    for (const cand of slopedCandidates) {
      const prof = hasExtraBufferedCanals
        ? _resampleAndProfileWaterLine(ctx, cand.rawPts, cand.halfW, flatWaterEntries, islandMaskEntries)
        : cand.prof;
      if (prof.submerged || prof.pts.length < 2) continue;

      const { pts, halfW, despikedTopZ } = prof;
      const q = Math.max(1, Math.floor(despikedTopZ.length / 4));
      const headAvg = despikedTopZ.slice(0, q).reduce((a, b) => a + b, 0) / q;
      const tailAvg = despikedTopZ.slice(-q).reduce((a, b) => a + b, 0) / q;
      const forward = headAvg >= tailAvg;
      const ordPts = forward ? pts : pts.slice().reverse();
      const ordTopZ = forward ? despikedTopZ.slice() : despikedTopZ.slice().reverse();
      for (let i = 1; i < ordTopZ.length; i++) ordTopZ[i] = Math.min(ordTopZ[i - 1], ordTopZ[i]);
      const ordFloorZ = ordTopZ.map(tz => Math.max(ctx.zWaterCarveFloor, tz - 0.45 / scaleMm));

      for (let i = 0; i < ordPts.length - 1; i++) {
        const a = ordPts[i], b = ordPts[i + 1];
        const mx = (a[0] + b[0]) * 0.5, my = (a[1] + b[1]) * 0.5;
        if (isInsideWaterOrIsland(a[0], a[1]) && isInsideWaterOrIsland(b[0], b[1]) && isInsideWaterOrIsland(mx, my)) {
          continue;
        }
        const segRings = core.clipperBufferOpenPaths([{ pts: [a, b], halfW }], 'Round', 1e-5);
        let clipped = segRings.length > 0 ? core.clipperIntersectPolys(segRings, plateClipPoly, 1e-5) : [];
        if (clipped.length > 0 && slopedExcludePolys.length > 0) {
          clipped = core.clipperDiffPolys(clipped, slopedExcludePolys, 1e-5);
        }
        const structured = clipped.length > 0 ? core.ringsToOutersWithHoles(clipped, 1e-4) : [];
        if (structured.length === 0) continue;
        for (const sp of structured) {
          slopedRingList.push(sp.outer);
          for (const h of sp.holes) slopedRingList.push(h);
        }
        const dx = b[0] - a[0], dy = b[1] - a[1];
        slopedReaches.push({
          ax: a[0], ay: a[1], dx, dy, len2: dx * dx + dy * dy,
          rSq: (halfW + 0.12) ** 2,
          topA: ordTopZ[i], topB: ordTopZ[i + 1],
          floorA: ordFloorZ[i], floorB: ordFloorZ[i + 1],
          ordPts, ordTopZ, ordFloorZ,
          polys: structured,
        });
      }
    }
    return { slopedReaches, slopedRingList };
  }

  function buildLayer1WaterAndCarve(core, mf, ctx, scene, terrainManifold, plateClipPoly, protectedPolys, keepIslet) {
    const { toBed, scaleToBed, waterCutout } = ctx;
    const appliedRot = (scene && typeof scene._appliedRotationDeg === 'number') ? scene._appliedRotationDeg : 0;
    const rotRad = (appliedRot * Math.PI) / 180.0;
    const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad);
    const mapUnrotRingToBed = (ring) => ring.map(p => toBed(appliedRot === 0 ? p : [p[0] * cosR - p[1] * sinR, p[0] * sinR + p[1] * cosR]));

    // 1. Collect all explicit island, standalone land, shingle, and open-sea island rings globally in bed space
    const islandEntries = [];
    const pushIslandBed = (rawBedRing) => {
      if (!rawBedRing || rawBedRing.length < 3 || !keepIslet(rawBedRing)) return;
      const ccw = core.ensureWinding(rawBedRing, true, 1e-5);
      const area = ccw.length >= 3 ? Math.abs(core.signedArea2D(ccw)) : 0;
      if (area > 1e-5) islandEntries.push({ ring: ccw, area });
    };

    for (const wp of (scene && scene.waterPolys) || []) {
      if (!wp) continue;
      for (const h of (wp.holes || [])) if (h && h.length >= 3) pushIslandBed(h.map(toBed));
      const landRings = Array.isArray(wp._rotatedLandRings)
        ? wp._rotatedLandRings.map(r => r.map(toBed))
        : (Array.isArray(wp._unrotatedLandRings) ? wp._unrotatedLandRings.map(mapUnrotRingToBed) : []);
      for (const lr of landRings) pushIslandBed(lr);
      const shingleRings = Array.isArray(wp._rotatedShingleRings)
        ? wp._rotatedShingleRings.map(r => r.map(toBed))
        : (Array.isArray(wp._unrotatedShingleRings) ? wp._unrotatedShingleRings.map(mapUnrotRingToBed) : []);
      for (const sr of shingleRings) pushIslandBed(sr);
    }
    if (scene && Array.isArray(scene._openSeaIslands)) {
      for (const isl of scene._openSeaIslands) if (isl && isl.length >= 3) pushIslandBed(isl.map(toBed));
    }
    const globalIslandPolys = islandEntries.length > 0
      ? core.clipperUnionPolys(islandEntries.map(e => e.ring), 1e-5)
      : [];

    // 2. Separate primary sea/river/marina polygons from genuine inland ponds strictly inside an island
    const primaryWaterOuterList = [];
    const nestedLakeOuters = [];
    for (const wp of (scene && scene.waterPolys) || []) {
      if (!wp || !wp.outer || wp.outer.length < 3) continue;
      const outerBed = wp.outer.map(toBed);
      const clipped = core.clipperIntersectPolys([outerBed], plateClipPoly, 1e-5);
      if (clipped.length === 0) continue;
      const wpArea = Math.abs(core.signedArea2D(outerBed));
      const probe = _probeRingInteriorPt(outerBed);
      const isNestedPond = islandEntries.some(isl => wpArea < isl.area * 0.88 && _ptInRingLocal(probe[0], probe[1], isl.ring));
      if (isNestedPond) {
        const subHoles = (wp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed)).filter(keepIslet);
        const pondPolys = subHoles.length > 0 ? core.clipperDiffPolys(clipped, subHoles, 1e-5) : clipped;
        for (const pr of pondPolys) nestedLakeOuters.push(pr);
      } else {
        for (const fr of clipped) primaryWaterOuterList.push(fr);
      }
    }
    if (scene && Array.isArray(scene._openSeaIslands) && scene._openSeaIslands.length > 0) {
      primaryWaterOuterList.push(plateClipPoly[0]);
    }

    // Effective dry island mask (all islands/shoals minus any genuine inland ponds strictly inside an island)
    const effectiveIslandPolys = (globalIslandPolys.length > 0 && nestedLakeOuters.length > 0)
      ? core.clipperDiffPolys(globalIslandPolys, nestedLakeOuters, 1e-5)
      : globalIslandPolys;
    const islandMaskEntries = core.ringsToOutersWithHoles(effectiveIslandPolys, 1e-5)
      .map(p => ({ outer: p.outer, holes: p.holes || [], bb: _ringBBox(p.outer) }));

    // Areal water mask prior to linear waterways (so linear centerlines know areal water extent & height)
    let arealWaterRings = primaryWaterOuterList.length > 0 ? core.clipperUnionPolys(primaryWaterOuterList, 1e-5) : [];
    if (arealWaterRings.length > 0 && globalIslandPolys.length > 0) {
      arealWaterRings = core.clipperDiffPolys(arealWaterRings, globalIslandPolys, 1e-5);
    }
    if (nestedLakeOuters.length > 0) {
      arealWaterRings = core.clipperUnionPolys(arealWaterRings, 1e-5, nestedLakeOuters);
    }
    if (arealWaterRings.length > 0 && protectedPolys.length > 0) {
      arealWaterRings = core.clipperDiffPolys(arealWaterRings, protectedPolys, 1e-5);
    }
    const arealWaterEntries = _classifyFlatWaterPolys(ctx, core.ringsToOutersWithHoles(arealWaterRings, 1e-5));

    const { flatWlPaths, slopedCandidates } = _classifyLinearWaterways(ctx, scene, arealWaterEntries, islandMaskEntries);
    const allWlPaths = waterCutout
      ? ((scene && scene.waterLines) || []).filter(w => w && w.pts && w.pts.length >= 2).map(wl => ({ pts: wl.pts.map(toBed), halfW: Math.max(ctx.minPrintU * 0.65, ((wl.width || 0.7) * 0.5) * scaleToBed) }))
      : flatWlPaths;
    // IMPORTANT: Clip the entire buffered waterway ring set together (never ring-by-ring!) so CW island holes enclosed by canal grids (e.g. Venice) are never inverted into solid water!
    const bufferedWlRings = allWlPaths.length > 0
      ? core.clipperIntersectPolys(core.clipperBufferOpenPaths(allWlPaths, 'Round', 1e-5), plateClipPoly, 1e-5)
      : [];
    if (waterCutout && primaryWaterOuterList.length === 0 && bufferedWlRings.length === 0 && nestedLakeOuters.length === 0 && scene && scene._hasMarineTags && (!scene.buildings || !scene.buildings.length) && (!scene.roads || !scene.roads.length) && Number((scene.dem && scene.dem.maxElev) || 0) <= 0.5) {
      primaryWaterOuterList.push(plateClipPoly[0]);
    }

    // 3. Three-pass Clipper2 topology: Union primary water + buffered canals -> Subtract ALL islands globally -> Re-apply nested ponds -> Subtract protected dry land
    let flatWaterRings = primaryWaterOuterList.length > 0 ? core.clipperUnionPolys(primaryWaterOuterList, 1e-5) : [];
    if (bufferedWlRings.length > 0) {
      flatWaterRings = core.clipperUnionPolys(flatWaterRings, 1e-5, bufferedWlRings);
    }
    if (flatWaterRings.length > 0 && globalIslandPolys.length > 0) {
      flatWaterRings = core.clipperDiffPolys(flatWaterRings, globalIslandPolys, 1e-5);
    }
    if (nestedLakeOuters.length > 0) {
      flatWaterRings = core.clipperUnionPolys(flatWaterRings, 1e-5, nestedLakeOuters);
    }
    if (flatWaterRings.length > 0 && protectedPolys.length > 0) {
      flatWaterRings = core.clipperDiffPolys(flatWaterRings, protectedPolys, 1e-5);
    }
    const flatWaterPolys2D = core.ringsToOutersWithHoles(flatWaterRings, 1e-5);
    const flatWaterEntries = _classifyFlatWaterPolys(ctx, flatWaterPolys2D);
    const elevatedFlatPolys = flatWaterEntries.filter(e => e.isEl);
    const standardFlatPolys = flatWaterEntries.filter(e => !e.isEl);

    // 4. Emit sloped tributary/mountain reaches strictly OUTSIDE flatWaterRings, effectiveIslandPolys, and protectedPolys
    const { slopedReaches, slopedRingList } = _emitSlopedWaterReaches(
      core, ctx, plateClipPoly, slopedCandidates, flatWaterRings, flatWaterEntries,
      effectiveIslandPolys, islandMaskEntries, protectedPolys, bufferedWlRings.length > 0
    );

    const slopedUnioned = slopedRingList.length > 0 ? core.clipperUnionPolys(slopedRingList, 1e-5) : [];
    let unionedWaterRings = (flatWaterRings.length || slopedUnioned.length)
      ? core.clipperUnionPolys(flatWaterRings, 1e-5, slopedUnioned)
      : [];
    if (unionedWaterRings.length > 0 && effectiveIslandPolys.length > 0) {
      unionedWaterRings = core.clipperDiffPolys(unionedWaterRings, effectiveIslandPolys, 1e-5);
    }
    if (unionedWaterRings.length > 0 && protectedPolys.length > 0) {
      unionedWaterRings = core.clipperDiffPolys(unionedWaterRings, protectedPolys, 1e-5);
    }
    const waterMaskPolys2D = core.ringsToOutersWithHoles(unionedWaterRings, 1e-5);
    if (waterCutout) for (const wm of waterMaskPolys2D) if (wm.holes && wm.holes.length) wm.holes = wm.holes.filter(keepIslet);

    let waterManifold = null;
    if ((flatWaterPolys2D.length > 0 || slopedReaches.length > 0) && terrainManifold) {
      const tMaxZ = terrainManifold.boundingBox().max[2] + 5.0, carveSolids = [], waterEmitSolids = [];
      if (waterCutout) {
        for (const wp of waterMaskPolys2D) {
          const cm = core.extrudeRingSolid(mf, wp.outer, wp.holes, -0.5, tMaxZ);
          if (cm) carveSolids.push(cm);
        }
      } else {
        for (const fe of flatWaterEntries) {
          const cm = core.extrudeRingSolid(mf, fe.outer, fe.holes, fe.flrZ, tMaxZ); if (cm) carveSolids.push(cm);
          const wm = core.extrudeRingSolid(mf, fe.outer, fe.holes, fe.flrZ, fe.topZ); if (wm) waterEmitSolids.push(wm);
        }
      }
      const evalPolylineZ = (ptsArr, zArr) => (x, y) => {
        let bestD2 = Infinity, bestZ = zArr[0];
        for (let s = 0; s < ptsArr.length - 1; s++) {
          const ax = ptsArr[s][0], ay = ptsArr[s][1];
          const dx = ptsArr[s + 1][0] - ax, dy = ptsArr[s + 1][1] - ay;
          const l2 = dx * dx + dy * dy;
          const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
          const d2 = (x - (ax + t * dx)) ** 2 + (y - (ay + t * dy)) ** 2;
          const zv = zArr[s] + (zArr[s + 1] - zArr[s]) * t;
          if (d2 < bestD2 - 1e-9 || (Math.abs(d2 - bestD2) <= 1e-9 && zv < bestZ)) {
            bestD2 = d2;
            bestZ = zv;
          }
        }
        return bestZ;
      };
      for (const sr of slopedReaches) {
        const flrFn = evalPolylineZ(sr.ordPts, sr.ordFloorZ);
        const topFn = evalPolylineZ(sr.ordPts, sr.ordTopZ);
        for (const p of sr.polys) {
          const cm = _buildSlopedPrism(core, mf, p.outer, p.holes, flrFn, () => tMaxZ); if (cm) carveSolids.push(cm);
          const wm = _buildSlopedPrism(core, mf, p.outer, p.holes, flrFn, topFn); if (wm) waterEmitSolids.push(wm);
        }
      }
      const combinedCarve = carveSolids.length > 0 ? core.batchUnionManifolds(mf, carveSolids) : null;
      if (combinedCarve) { try { const c = terrainManifold.subtract(combinedCarve); core.safeDeleteManifold(terrainManifold); terrainManifold = c; } finally { core.safeDeleteManifold(combinedCarve); } }
      if (!waterCutout && waterEmitSolids.length > 0) waterManifold = core.batchUnionManifolds(mf, waterEmitSolids);
    }
    const queryWaterZAt = (x, y, isFloor = false, ignoreCutout = false) => {
      if (waterCutout && !ignoreCutout) return 0.0;
      for (let i = 0; i < elevatedFlatPolys.length; i++) {
        const ep = elevatedFlatPolys[i];
        if (_pointInWaterEntry(x, y, ep)) return isFloor ? ep.flrZ : ep.topZ;
      }
      for (let i = 0; i < standardFlatPolys.length; i++) {
        if (_pointInWaterEntry(x, y, standardFlatPolys[i])) return isFloor ? ctx.zWaterCarveFloor : ctx.zWaterTop;
      }
      let bestDist2 = Infinity, bestVal = null;
      for (const sr of slopedReaches) {
        const t = sr.len2 > 1e-10 ? Math.max(0, Math.min(1, ((x - sr.ax) * sr.dx + (y - sr.ay) * sr.dy) / sr.len2)) : 0;
        const d2 = (x - (sr.ax + t * sr.dx)) ** 2 + (y - (sr.ay + t * sr.dy)) ** 2;
        if (d2 <= sr.rSq && d2 < bestDist2) { bestDist2 = d2; bestVal = isFloor ? (sr.floorA + (sr.floorB - sr.floorA) * t) : (sr.topA + (sr.topB - sr.topA) * t); }
      }
      if (bestVal !== null) return bestVal;
      for (let i = 0; i < elevatedFlatPolys.length; i++) {
        const ep = elevatedFlatPolys[i];
        if (_isPointNearWaterEntry(x, y, ep, 0.15)) return isFloor ? ep.flrZ : ep.topZ;
      }
      return isFloor ? ctx.zWaterCarveFloor : ctx.zWaterTop;
    };
    return { terrainManifold, waterManifold, unionedWaterRings, waterMaskPolys2D, queryWaterZAt, slopedRiverSegments: slopedReaches.length };
  }

  const exportsObj = { buildDelatinTerrainManifold, buildLayer1WaterAndCarve };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
