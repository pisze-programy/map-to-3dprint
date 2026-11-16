// ============================================================================
// src/Water/water_sloped_reaches.js
// Sloped Mountain River Reach Profiler, Bridge-DSM Despiker & Sloped Prism CSG
// ============================================================================

(function (root) {
  function _getSampler() {
    if (typeof _ptInWaterEntryLocal === 'function' && typeof _isPointNearWaterEntry === 'function') {
      return { _ptInWaterEntryLocal, _isPointNearWaterEntry };
    }
    return require('./water_elevation_sampler.js');
  }

  function _buildSlopedPrism(core, mf, outer, holes, zBotFn, zTopFn) {
    const { earcut } = core.getVendorDeps(), oClean = core.ensureWinding(outer, true, 1e-4);
    if (!earcut || oClean.length < 3) return null;
    const rings = [oClean];
    for (const h of (holes || [])) {
      const hc = core.ensureWinding(h, false, 1e-4);
      if (hc.length >= 3) rings.push(hc);
    }
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

  function _subdivideWaterLine(rawPts, halfW, waterEntries = []) {
    const sampler = _getSampler();
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
    const isNearWater = (pt) => waterEntries.some(we => sampler._isPointNearWaterEntry(pt[0], pt[1], we, nearProbeDist));

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
    return { pts, shoreSnapDist };
  }

  function _despikeBridgeBumpsMonotonic(rawTopZ, nearWater, pts, totalLen, mToU, scaleToBed, scaleMm) {
    const despikedTopZ = rawTopZ.slice();
    if (pts.length >= 3) {
      const avgStep = totalLen / Math.max(1, pts.length - 1);
      const bridgeSpanU = Math.max(2.5, 38.0 * mToU * scaleToBed);
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
          if (despikedTopZ[0] - despikedTopZ[1] > Math.max(1.5 / scaleMm, 3.0 * ref0 + 0.6 / scaleMm)) {
            despikedTopZ[0] = despikedTopZ[1] + ref0;
          }
        }
        const last = pts.length - 1;
        if (!nearWater[last]) {
          const refN = Math.max(0, despikedTopZ[last - 1] - despikedTopZ[last - 2]);
          if (despikedTopZ[last] - despikedTopZ[last - 1] > Math.max(1.5 / scaleMm, 3.0 * refN + 0.6 / scaleMm)) {
            despikedTopZ[last] = despikedTopZ[last - 1] + refN;
          }
        }
      }
    }
    return despikedTopZ;
  }

  function _evalPolylineClosestT(ptsArr, x, y, zArr = null) {
    let bestD2 = Infinity, bestSeg = 0, bestT = 0, bestZ = zArr ? zArr[0] : 0;
    for (let s = 0; s < ptsArr.length - 1; s++) {
      const ax = ptsArr[s][0], ay = ptsArr[s][1];
      const dx = ptsArr[s + 1][0] - ax, dy = ptsArr[s + 1][1] - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      const d2 = (x - (ax + t * dx)) ** 2 + (y - (ay + t * dy)) ** 2;
      const zv = zArr ? (zArr[s] + (zArr[s + 1] - zArr[s]) * t) : 0;
      if (d2 < bestD2 - 1e-9 || (zArr && Math.abs(d2 - bestD2) <= 1e-9 && zv < bestZ)) {
        bestD2 = d2; bestSeg = s; bestT = t; bestZ = zv;
      }
    }
    return { segIdx: bestSeg, t: bestT, distSq: bestD2, z: bestZ };
  }

  function _evalPolylineZ(ptsArr, zArr) {
    return (x, y) => _evalPolylineClosestT(ptsArr, x, y, zArr).z;
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
    const sampler = _getSampler();
    const { scaleToBed, scaleMm } = ctx;
    const { pts, shoreSnapDist } = _subdivideWaterLine(rawPts, halfW, waterEntries);
    const isInsideWaterOrIsland = (x, y) => (
      waterEntries.some(we => sampler._ptInWaterEntryLocal(x, y, we)) ||
      islandMaskEntries.some(ie => sampler._ptInWaterEntryLocal(x, y, ie))
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
        if (sampler._isPointNearWaterEntry(p[0], p[1], waterEntries[w], shoreSnapDist)) {
          if (waterEntries[w].topZ < matchedZ) matchedZ = waterEntries[w].topZ;
        }
      }
      if (!Number.isFinite(matchedZ)) {
        for (let k = 0; k < islandMaskEntries.length; k++) {
          if (sampler._ptInWaterEntryLocal(p[0], p[1], islandMaskEntries[k])) { matchedZ = ctx.zWaterTop; break; }
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

    const despikedTopZ = _despikeBridgeBumpsMonotonic(rawTopZ, nearWater, pts, totalLen, ctx.mToU, scaleToBed, scaleMm);
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
      if (ctx.elevReliefM <= 2.0) { flatWlPaths.push({ pts: rawPts, halfW }); continue; }
      const prof = _resampleAndProfileWaterLine(ctx, rawPts, halfW, arealWaterEntries, islandMaskEntries);
      if (prof.submerged) continue;
      let zMin = Infinity, zMax = -Infinity;
      for (let i = 0; i < prof.despikedTopZ.length; i++) {
        const z = prof.despikedTopZ[i];
        if (z < zMin) zMin = z;
        if (z > zMax) zMax = z;
      }
      if (zMax - zMin <= 0.35 / scaleMm) flatWlPaths.push({ pts: prof.pts, halfW });
      else slopedCandidates.push({ rawPts, halfW, prof });
    }
    return { flatWlPaths, slopedCandidates };
  }

  function _buildSlopedWaterReaches(core, ctx, plateClipPoly, slopedCandidates, flatWaterRings, flatWaterEntries, effectiveIslandPolys, islandMaskEntries, protectedPolys, hasExtraBufferedCanals) {
    if (!slopedCandidates.length) return { slopedReaches: [], slopedRingList: [] };
    const sampler = _getSampler();
    const { scaleMm } = ctx;
    const slopedReaches = [], slopedRingList = [];

    // Shrink flatWaterRings by 0.025u in the CSG exclusion mask so shoreline tributary mouths overlap
    // flat water by 0.025u at identical coplanar [flrZ, topZ], while strictly subtracting islands & dry land.
    let slopedExcludePolys = flatWaterRings.length > 0 ? core.clipperOffsetPolys(flatWaterRings, -0.025, 'Miter', 1e-5) : [];
    if (effectiveIslandPolys.length > 0) slopedExcludePolys = core.clipperUnionPolys(slopedExcludePolys, 1e-5, effectiveIslandPolys);
    if (protectedPolys.length > 0) slopedExcludePolys = core.clipperUnionPolys(slopedExcludePolys, 1e-5, protectedPolys);

    const isInsideWaterOrIsland = (x, y) => (
      flatWaterEntries.some(we => sampler._ptInWaterEntryLocal(x, y, we)) ||
      islandMaskEntries.some(ie => sampler._ptInWaterEntryLocal(x, y, ie))
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
        if (isInsideWaterOrIsland(a[0], a[1]) && isInsideWaterOrIsland(b[0], b[1]) && isInsideWaterOrIsland(mx, my)) continue;
        const segRings = core.clipperBufferOpenPaths([{ pts: [a, b], halfW }], 'Round', 1e-5);
        let clipped = segRings.length > 0 ? core.clipperIntersectPolys(segRings, plateClipPoly, 1e-5) : [];
        if (clipped.length > 0 && slopedExcludePolys.length > 0) clipped = core.clipperDiffPolys(clipped, slopedExcludePolys, 1e-5);
        const structured = clipped.length > 0 ? core.ringsToOutersWithHoles(clipped, 1e-4) : [];
        if (structured.length === 0) continue;
        for (const sp of structured) {
          slopedRingList.push(sp.outer);
          for (const h of sp.holes) slopedRingList.push(h);
        }
        const dx = b[0] - a[0], dy = b[1] - a[1];
        slopedReaches.push({
          ax: a[0], ay: a[1], dx, dy, len2: dx * dx + dy * dy, rSq: (halfW + 0.12) ** 2,
          topA: ordTopZ[i], topB: ordTopZ[i + 1], floorA: ordFloorZ[i], floorB: ordFloorZ[i + 1],
          ordPts, ordTopZ, ordFloorZ, polys: structured
        });
      }
    }
    return { slopedReaches, slopedRingList };
  }

  const exportsObj = {
    _buildSlopedPrism,
    _subdivideWaterLine,
    _despikeBridgeBumpsMonotonic,
    _evalPolylineClosestT,
    _evalPolylineZ,
    _resampleAndProfileWaterLine,
    _classifyLinearWaterways,
    _buildSlopedWaterReaches
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
