// ============================================================================
// src/mesh/bridge_superstructure_solver.js
// OSM bridge:support Piers/Pylons, Channel Protection, Arch/Cable/Truss MSLA
// ============================================================================

if (typeof _lerpArrAtSJS === 'undefined' && typeof require !== 'undefined') Object.assign(global, require('./bridge_deck_builder.js'));

function _sidePtJS(pt, tx, ty, offset, z) { return [pt[0] - ty * offset, pt[1] + tx * offset, z]; }

function _beamOverlapJS(mf, p0, p1, radius) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2], l = Math.hypot(dx, dy, dz);
  if (l < 1e-4 || radius < 1e-4) return null;
  const ext = Math.min(radius * 0.45, l * 0.15) / l;
  return beamManifoldBetween(mf, [p0[0] - dx * ext, p0[1] - dy * ext, p0[2] - dz * ext], [p1[0] + dx * ext, p1[1] + dy * ext, p1[2] + dz * ext], radius);
}

function _anchorFloorZJS(x, y, terrainWater, ctx) {
  if (terrainWater.isPointInWater(x, y)) return ctx.waterCutout ? 0.0 : Math.max(0.0, terrainWater.getWaterFloorZ(x, y) - 0.35);
  return Math.max(0.0, terrainWater.getSurfaceZ(x, y) - 0.55);
}

function _computeAntiCapillarySamplesJS(availLenU, strutDiamMm, desiredCount, ctx) {
  const pitchMinU = (strutDiamMm * 1.02 + 0.48) / ctx.scaleMm;
  const count = Math.max(2, Math.min(desiredCount, Math.max(2, Math.floor(availLenU / Math.max(1e-4, pitchMinU)) + 1)));
  const rawGapMm = (availLenU / Math.max(1, count - 1)) * ctx.scaleMm - strutDiamMm;
  return { count, minGapMm: count <= 1 ? 0.48 : Math.max(0.48, (ctx.slaLaws || SLA_PRINT_LAWS).resolveAntiCapillaryGapMm(rawGapMm, 0.48)) };
}

function _resolvePylonTopZJS(spec, zDeckTop, zFloor, heightOverrideM, ctx) {
  const mToBedZ = ctx.mToU * ctx.zScale * (ctx.scaleToBed || 1.0), bayRefU = Math.min(spec.spanU, 72 / ctx.scaleMm);
  const minAboveU = Math.max(2.6 / ctx.scaleMm, Math.min(bayRefU * 0.14, 10.0 / ctx.scaleMm)), hM = heightOverrideM != null ? heightOverrideM : spec.heightM;
  let aboveU = Math.max(minAboveU, bayRefU * 0.22);
  if (hM != null && hM > 0) {
    const rawU = hM * mToBedZ, valleyH = Math.max(0, zDeckTop - zFloor);
    aboveU = (heightOverrideM != null && heightOverrideM < 200) ? Math.max(minAboveU, rawU) : Math.max(minAboveU, rawU > valleyH * 1.1 ? rawU - valleyH : rawU);
  }
  const capU = Math.min(ctx.maxZUnits - zDeckTop - 0.45, Math.max(minAboveU, Math.min(aboveU, Math.max(spec.spanU * 0.42, 34 / ctx.scaleMm))));
  return zDeckTop + Math.max(minAboveU, capU);
}

function _addTwinOrPortalPylonJS(parts, pt, tx, ty, halfW, zFloor, zDeckBot, zDeckTop, zPylonTop, shaftR, mf) {
  const lat = Math.max(halfW * 0.88, shaftR * 1.4), L = _sidePtJS(pt, tx, ty, lat, 0), R = _sidePtJS(pt, tx, ty, -lat, 0);
  const baseBox = beamManifoldBetween(mf, [pt[0], pt[1], zFloor], [pt[0], pt[1], zDeckBot + 0.1], Math.min(halfW * 0.68, shaftR * 1.55));
  const shL = beamManifoldBetween(mf, [L[0], L[1], zFloor], [L[0], L[1], zPylonTop], shaftR), shR = beamManifoldBetween(mf, [R[0], R[1], zFloor], [R[0], R[1], zPylonTop], shaftR);
  const tieTop = _beamOverlapJS(mf, [L[0], L[1], zPylonTop - shaftR * 1.1], [R[0], R[1], zPylonTop - shaftR * 1.1], shaftR * 0.9);
  const tieSub = _beamOverlapJS(mf, [L[0], L[1], zDeckBot], [R[0], R[1], zDeckBot], shaftR);
  for (const m of [baseBox, shL, shR, tieTop, tieSub]) if (m) parts.push(m);
}

function _extrudePylonOuterSolidJS(mf, outer, pt, tx, ty, halfW, zFloor, zTop, zPylonTop, ctx) {
  const latSpan = (r) => { let lo = Infinity, hi = -Infinity; for (const p of r) { const l = -ty * (p[0] - pt[0]) + tx * (p[1] - pt[1]); if (l < lo) lo = l; if (l > hi) hi = l; } return [lo, hi]; };
  let ring = outer, [latMin, latMax] = latSpan(ring);
  const obb = typeof computeMinAreaOBB2D === 'function' ? computeMinAreaOBB2D(ring) : null;
  const minorU = obb && Number.isFinite(obb.halfW) ? obb.halfW * 2 : (latMax - latMin);
  const minPinU = (ctx.slaLaws || SLA_PRINT_LAWS).minPinDiameterMm(Math.max(0, (zPylonTop - zTop) * ctx.scaleMm)) / ctx.scaleMm;
  if (minorU < minPinU && typeof clipperOffsetPolys === 'function') {
    const offs = clipperOffsetPolys([ring], (minPinU - minorU) * 0.5, 'Round');
    if (offs && offs.length && offs[0].length >= 3) { ring = offs[0]; [latMin, latMax] = latSpan(ring); }
  }
  const solid = extrudeRingSolid(mf, ring, [], zFloor, zPylonTop);
  return solid ? { solid, latMin, latMax, cLat: (latMin + latMax) * 0.5, isCentral: (latMax - latMin) < halfW * 1.15 } : null;
}

function _addBridgeSupportSolidsJS(spec, terrainWater, ctx, strutRU, parts, supportStationsS, pylonStations, metrics) {
  const mf = ctx.mf, halfW = spec.width * 0.5;
  const minColR = Math.max(strutRU * 1.15, Math.min(halfW * 0.25, 0.45 / ctx.scaleMm));
  const shaftR = Math.max(strutRU * 1.35, Math.min(halfW * 0.28, 0.85 / ctx.scaleMm));
  for (const sup of spec.explicitSupports) {
    const sPos = sup.sProj, { pt, tx, ty } = _samplePtAtSJS(spec, sPos);
    const zBot = _lerpArrAtSJS(spec.sArr, spec.zBotArr, sPos), zTop = _lerpArrAtSJS(spec.sArr, spec.zTopArr, sPos);
    const zFloor = _anchorFloorZJS(sup.pt[0], sup.pt[1], terrainWater, ctx);
    metrics.pierMinZ = Math.min(metrics.pierMinZ, zFloor); metrics.explicitSupportsUsed++;
    if (sup.kind === 'pylon') {
      const zPylonTop = _resolvePylonTopZJS(spec, zTop, zFloor, sup.heightM, ctx);
      const pyOut = (sup.outer && sup.outer.length >= 3) ? _extrudePylonOuterSolidJS(mf, sup.outer, pt, tx, ty, halfW, zFloor, zTop, zPylonTop, ctx) : null;
      if (pyOut) { parts.push(pyOut.solid); pylonStations.push({ s: sPos, pt, tx, ty, zTop, zPylonTop, ...pyOut }); }
      else { _addTwinOrPortalPylonJS(parts, pt, tx, ty, halfW, zFloor, zBot, zTop, zPylonTop, shaftR, mf); pylonStations.push({ s: sPos, pt, tx, ty, zTop, zPylonTop, isCentral: false }); }
      supportStationsS.push(sPos);
    } else {
      const zCap = sup.kind === 'abutment' ? zTop : zBot + 0.12;
      const colR = (ctx.waterCutout && terrainWater.isPointInWater(sup.pt[0], sup.pt[1])) ? minColR * 1.25 : minColR;
      const m = (sup.outer && sup.outer.length >= 3) ? extrudeRingSolid(mf, sup.outer, [], zFloor, zCap) : beamManifoldBetween(mf, [sup.pt[0], sup.pt[1], zFloor], [sup.pt[0], sup.pt[1], zCap], colR);
      if (m) parts.push(m);
      supportStationsS.push(sPos);
    }
  }
  const mToBedXY = Math.max(1e-5, (ctx.mToU || 0.1) * (ctx.scaleToBed || 1.0));
  const spanMetersEst = spec.spanU / mToBedXY;
  const isShortDryCableApproach = (spec.structNorm === 'cable-stayed' || spec.structNorm === 'suspension') &&
    !pylonStations.length && !spec.crossesWater && spanMetersEst < 110.0;
  const isDryMultiBayArchViaduct = spec.structNorm === 'arch' && !spec.crossesWater && !spec.explicitThroughArch && spanMetersEst > 85.0;
  const channelProtected = ['arch', 'suspension', 'cable-stayed', 'truss'].includes(spec.structNorm) && !isShortDryCableApproach && !isDryMultiBayArchViaduct;
  if (!spec.explicitSupports.length && spec.structNorm === 'floating') {
    for (let i = 0; i < spec.pts.length - 1; i++) {
      if (!spec.inWater[i] && !spec.inWater[i + 1]) continue;
      const a = spec.pts[i], b = spec.pts[i + 1], zB = ctx.waterCutout ? 0.0 : Math.max(0.0, ctx.zWaterTop - 0.35), zT = Math.min(spec.zBotArr[i], spec.zBotArr[i + 1]) + 0.12;
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
      if (l < 0.05 || zT <= zB + 0.05) continue;
      const nx = (-dy / l) * Math.max(minColR, halfW * 0.72), ny = (dx / l) * Math.max(minColR, halfW * 0.72);
      const pm = extrudeRingSolid(mf, [[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]], [], zB, zT);
      if (pm) parts.push(pm);
    }
  } else if (!channelProtected && spec.structNorm !== 'floating' && spec.spanU > 3.6 / ctx.scaleMm) {
    const step = isDryMultiBayArchViaduct
      ? Math.max(4.5 / ctx.scaleMm, Math.min(45.0 * mToBedXY, spec.spanU / 3))
      : Math.max(3.2 / ctx.scaleMm, spec.width * 2.3);
    for (let s = step; s < spec.spanU - step * 0.45; s += step) {
      if (spec.explicitSupports.some(es => Math.abs(es.sProj - s) < step * 0.72)) continue;
      const { pt } = _samplePtAtSJS(spec, s), zFloor = _anchorFloorZJS(pt[0], pt[1], terrainWater, ctx), zBot = _lerpArrAtSJS(spec.sArr, spec.zBotArr, s);
      if (zBot + 0.12 <= zFloor + 0.05) continue;
      const inWater = terrainWater.isPointInWater(pt[0], pt[1]), colR = (ctx.waterCutout && inWater) ? minColR * 1.25 : minColR;
      if (inWater) metrics.syntheticWaterPiers++;
      metrics.pierMinZ = Math.min(metrics.pierMinZ, zFloor);
      // Reinforce freestanding Z=0 piers in water against MSLA peel suction when waterCutout=true
      const col = beamManifoldBetween(mf, [pt[0], pt[1], zFloor], [pt[0], pt[1], zBot + 0.12], colR);
      if (col) parts.push(col);
      supportStationsS.push(s);
    }
  }
}

function _buildArchSuperstructureJS(spec, terrainWater, ctx, strutDiamMm, strutRU, parts, supportStationsS, metrics) {
  const mf = ctx.mf, L = spec.spanU, halfW = spec.width * 0.5;
  const mToBedXY = Math.max(1e-5, (ctx.mToU || 0.1) * (ctx.scaleToBed || 1.0));
  const mToBedZ = (ctx.mToU || 0.1) * (ctx.zScale || 1.0) * (ctx.scaleToBed || 1.0);
  let wStart = L * 0.06, wEnd = L * 0.94;
  if (spec.crossesWater) {
    const idxs = spec.inWater.map((w, i) => w ? i : -1).filter(i => i >= 0);
    wStart = Math.max(0, spec.sArr[Math.max(0, idxs[0] - 1)]); wEnd = Math.min(L, spec.sArr[Math.min(spec.pts.length - 1, idxs[idxs.length - 1] + 1)]);
  }
  const totalArchSpan = Math.max(0.8, wEnd - wStart), nPts = spec.pts.length;
  const minBayU = Math.max(1.4, Math.min(totalArchSpan * 0.45, 22.0 * mToBedXY));
  const interiorStops = [];
  for (const sRaw of (supportStationsS || []).slice().sort((a, b) => a - b)) {
    if (sRaw <= wStart + minBayU || sRaw >= wEnd - minBayU) continue;
    if (!interiorStops.length || sRaw - interiorStops[interiorStops.length - 1] >= minBayU) interiorStops.push(sRaw);
  }
  const archSpanMeters = totalArchSpan / mToBedXY;
  if (!interiorStops.length && !spec.explicitThroughArch && archSpanMeters > 265.0) {
    const nAutoBays = Math.max(2, Math.round(archSpanMeters / 110.0));
    for (let b = 1; b < nAutoBays; b++) interiorStops.push(wStart + (b / nAutoBays) * totalArchSpan);
  }
  const bayStops = [wStart, ...interiorStops, wEnd];

  const waterClears = [];
  let minL = Infinity;
  for (let i = 0; i < nPts; i++) {
    if (spec.inWater[i]) waterClears.push(spec.zBotArr[i] - ctx.zWaterTop);
    else if (nPts <= 2 || (i > 0 && i < nPts - 1)) minL = Math.min(minL, spec.zBotArr[i] - terrainWater.getSurfaceZ(spec.pts[i][0], spec.pts[i][1]));
  }
  waterClears.sort((a, b) => a - b);
  const medW = waterClears.length ? waterClears[waterClears.length >> 1] : Infinity;
  const avgBaySpan = totalArchSpan / Math.max(1, bayStops.length - 1);
  const waterThroughThresh = spec.isRail ? 1.45 : Math.max(0.75, Math.min(1.5, avgBaySpan * 0.085));
  const isThrough = !spec.isHumpback && Boolean(
    spec.explicitThroughArch ||
    (spec.crossesWater ? (medW < waterThroughThresh) : (bayStops.length === 2 && minL < 0.72))
  );
  metrics.isThroughArch = isThrough;
  const ribR = Math.max(strutRU * 1.15, spec.deckThick * 0.34), lat = Math.max(halfW * 0.86, ribR * 1.4) * (isThrough ? 1 : 0.85);

  if (!isThrough) {
    for (const sEnd of [wStart, wEnd]) {
      const { pt } = _samplePtAtSJS(spec, sEnd);
      if (!terrainWater.isPointInWater(pt[0], pt[1])) {
        const pier = beamManifoldBetween(mf, [pt[0], pt[1], _anchorFloorZJS(pt[0], pt[1], terrainWater, ctx)], [pt[0], pt[1], _lerpArrAtSJS(spec.sArr, spec.zBotArr, sEnd) + 0.1], Math.max(ribR * 1.25, halfW * 0.4));
        if (pier) parts.push(pier);
      }
    }
  }

  for (let bi = 0; bi < bayStops.length - 1; bi++) {
    const b0 = bayStops[bi], b1 = bayStops[bi + 1], baySpan = Math.max(0.6, b1 - b0);
    const { count: nHang, minGapMm } = _computeAntiCapillarySamplesJS(baySpan * 0.86, strutDiamMm, 9, ctx);
    metrics.minStayGapMm = Math.min(metrics.minStayGapMm, minGapMm);
    const sMid = (b0 + b1) * 0.5, { pt: ptMid } = _samplePtAtSJS(spec, sMid);
    const zDeckMid = _lerpArrAtSJS(spec.sArr, isThrough ? spec.zTopArr : spec.zBotArr, sMid);
    const zFloorLim = terrainWater.isPointInWater(ptMid[0], ptMid[1]) ? ctx.zWaterTop + 0.24 : terrainWater.getSurfaceZ(ptMid[0], ptMid[1]) + 0.2;
    if (!isThrough && spec.isHumpback && (zDeckMid - zFloorLim) < 0.28) continue;
    const riseOrDrop = isThrough
      ? Math.max(1.8 / ctx.scaleMm, Math.min(baySpan * 0.28, spec.heightM ? spec.heightM * mToBedZ : baySpan * 0.22))
      : Math.max(0.45, Math.min(baySpan * 0.32, Math.max(0.45, zDeckMid - zFloorLim)));
    if (isThrough) metrics.zPylonTop = Math.max(metrics.zPylonTop, _lerpArrAtSJS(spec.sArr, spec.zTopArr, sMid) + riseOrDrop);
    for (const sign of [-1, 1]) {
      let prev = null;
      for (let k = 0; k <= 8; k++) {
        const u = k / 8, s = b0 + u * baySpan, { pt, tx, ty } = _samplePtAtSJS(spec, s);
        const zBase = isThrough ? _lerpArrAtSJS(spec.sArr, spec.zTopArr, s) - 0.04 : _lerpArrAtSJS(spec.sArr, spec.zBotArr, s) - riseOrDrop;
        const p = _sidePtJS(pt, tx, ty, sign * lat, zBase + 4 * u * (1 - u) * (riseOrDrop + (isThrough ? 0 : 0.05)));
        if (prev) { const b = _beamOverlapJS(mf, prev, p, ribR); if (b) parts.push(b); }
        prev = p;
      }
      for (let h = 1; h < nHang - 1; h++) {
        const u = h / (nHang - 1), s = b0 + u * baySpan, { pt, tx, ty } = _samplePtAtSJS(spec, s);
        const zD = isThrough ? _lerpArrAtSJS(spec.sArr, spec.zTopArr, s) - 0.05 : _lerpArrAtSJS(spec.sArr, spec.zBotArr, s) + 0.08;
        const zA = (isThrough ? zD : zD - 0.08 - riseOrDrop) + 4 * u * (1 - u) * riseOrDrop;
        if (Math.abs(zD - zA) < 0.08) continue;
        const bar = _beamOverlapJS(mf, _sidePtJS(pt, tx, ty, sign * lat, Math.min(zD, zA)), _sidePtJS(pt, tx, ty, sign * lat, Math.max(zD, zA)), strutRU);
        if (bar) parts.push(bar);
      }
    }
  }
}

function _buildCableAndTrussSuperJS(spec, terrainWater, ctx, strutDiamMm, strutRU, parts, pylonStations, metrics) {
  const mf = ctx.mf, L = spec.spanU, halfW = spec.width * 0.5, lat = Math.max(halfW * 0.84, strutRU * 1.5);
  const mToBedXY = Math.max(1e-5, (ctx.mToU || 0.1) * (ctx.scaleToBed || 1.0));
  const shaftR = Math.max(strutRU * 1.35, Math.min(halfW * 0.28, 0.85 / ctx.scaleMm));
  const clampLat = (py, sg) => py.isCentral ? py.cLat : (py.latMin != null ? Math.max(py.latMin + strutRU * 0.5, Math.min(py.latMax - strutRU * 0.5, sg * lat)) : sg * lat);
  if (spec.structNorm === 'cable-stayed' || spec.structNorm === 'suspension') {
    if (!pylonStations.length && !spec.crossesWater && (L / mToBedXY) < 110.0) return;
    if (!pylonStations.length) {
      const fW = spec.inWater.indexOf(true), lW = spec.inWater.lastIndexOf(true);
      const cands = (fW > 0 && lW < spec.inWater.length - 1) ? [Math.max(0.06 * L, spec.sArr[fW - 1]), Math.min(0.94 * L, spec.sArr[lW + 1])] : [0.22 * L, 0.78 * L];
      for (const sPos of (Math.abs(cands[1] - cands[0]) < 1.2 ? [L * 0.5] : cands)) {
        const { pt, tx, ty } = _samplePtAtSJS(spec, sPos), zFloor = _anchorFloorZJS(pt[0], pt[1], terrainWater, ctx);
        const zBot = _lerpArrAtSJS(spec.sArr, spec.zBotArr, sPos), zTop = _lerpArrAtSJS(spec.sArr, spec.zTopArr, sPos), zPTop = _resolvePylonTopZJS(spec, zTop, zFloor, null, ctx);
        metrics.pierMinZ = Math.min(metrics.pierMinZ, zFloor);
        _addTwinOrPortalPylonJS(parts, pt, tx, ty, halfW, zFloor, zBot, zTop, zPTop, shaftR, mf);
        pylonStations.push({ s: sPos, pt, tx, ty, zTop, zPylonTop: zPTop, isCentral: false });
      }
    }
    for (let pi = 0; pi < pylonStations.length; pi++) {
      const py = pylonStations[pi]; metrics.zPylonTop = Math.max(metrics.zPylonTop, py.zPylonTop);
      if (spec.structNorm !== 'cable-stayed') continue;
      const sL = pi === 0 ? 0.04 * L : (pylonStations[pi - 1].s + py.s) * 0.5, sR = pi === pylonStations.length - 1 ? 0.96 * L : (py.s + pylonStations[pi + 1].s) * 0.5;
      const canFan = (py.zPylonTop - py.zTop) >= 4.0 / ctx.scaleMm, lats = py.isCentral ? [[py.cLat, 0]] : [[-1, -1], [1, 1]].map(([sg]) => [clampLat(py, sg), sg * lat]);
      for (const [a, b, rev] of [[sL, Math.max(sL, py.s - 0.35), false], [Math.min(sR, py.s + 0.35), sR, true]]) {
        if (b - a < 0.4) continue;
        const { count, minGapMm } = _computeAntiCapillarySamplesJS(b - a, strutDiamMm, 5, ctx);
        metrics.minStayGapMm = Math.min(metrics.minStayGapMm, minGapMm);
        for (let k = 0; k < count; k++) {
          const u = k / Math.max(1, count - 1), sk = a + u * (b - a), { pt, tx, ty } = _samplePtAtSJS(spec, sk), zAnc = _lerpArrAtSJS(spec.sArr, spec.zTopArr, sk) - 0.04;
          const zPyA = canFan ? py.zTop + (py.zPylonTop - py.zTop) * (0.55 + 0.40 * (rev ? u : 1 - u)) : py.zPylonTop - strutRU * 1.2;
          for (const [pLat, dLat] of lats) { const st = _beamOverlapJS(mf, _sidePtJS(py.pt, py.tx, py.ty, pLat, zPyA), _sidePtJS(pt, tx, ty, dLat, zAnc), strutRU); if (st) parts.push(st); }
        }
      }
    }
    if (spec.structNorm === 'suspension' && pylonStations.length >= 2) {
      for (let pi = 0; pi < pylonStations.length - 1; pi++) {
        const pA = pylonStations[pi], pB = pylonStations[pi + 1], sp = Math.max(0.5, pB.s - pA.s), sagU = Math.max(0.8, Math.min(sp * 0.22, (pA.zPylonTop - pA.zTop) * 0.72));
        const { count, minGapMm } = _computeAntiCapillarySamplesJS(sp * 0.85, strutDiamMm, 8, ctx);
        metrics.minStayGapMm = Math.min(metrics.minStayGapMm, minGapMm);
        for (const sign of (pA.isCentral && pB.isCentral ? [0] : [-1, 1])) {
          const lA = clampLat(pA, sign), lB = clampLat(pB, sign);
          let prev = null;
          for (let k = 0; k <= 8; k++) { const u = k / 8, sk = pA.s + u * sp, { pt, tx, ty } = _samplePtAtSJS(spec, sk), p = _sidePtJS(pt, tx, ty, lA + (lB - lA) * u, (pA.zPylonTop + (pB.zPylonTop - pA.zPylonTop) * u) - 4 * u * (1 - u) * sagU); if (prev) { const c = _beamOverlapJS(mf, prev, p, strutRU * 1.2); if (c) parts.push(c); } prev = p; }
          for (let h = 1; h < count - 1; h++) { const u = h / (count - 1), sk = pA.s + u * sp, { pt, tx, ty } = _samplePtAtSJS(spec, sk), lU = lA + (lB - lA) * u, zD = _lerpArrAtSJS(spec.sArr, spec.zTopArr, sk) - 0.04, zC = (pA.zPylonTop + (pB.zPylonTop - pA.zPylonTop) * u) - 4 * u * (1 - u) * sagU; const hg = _beamOverlapJS(mf, _sidePtJS(pt, tx, ty, lU, zD), _sidePtJS(pt, tx, ty, lU, zC), strutRU); if (hg) parts.push(hg); }
        }
      }
    }
  } else if (spec.structNorm === 'truss') {
    const trussH = Math.max(1.5 / ctx.scaleMm, Math.min(L * 0.14, spec.width * 0.85)), { count, minGapMm } = _computeAntiCapillarySamplesJS(L * 0.9, strutDiamMm, 8, ctx);
    metrics.minStayGapMm = Math.min(metrics.minStayGapMm, minGapMm); metrics.zPylonTop = Math.max(metrics.zPylonTop, Math.max(...spec.zTopArr) + trussH);
    for (const sign of [-1, 1]) {
      let prevB = null, prevT = null;
      for (let k = 0; k < count; k++) {
        const s = (k / (count - 1)) * L, { pt, tx, ty } = _samplePtAtSJS(spec, s), zD = _lerpArrAtSJS(spec.sArr, spec.zTopArr, s) - 0.04;
        const pB = _sidePtJS(pt, tx, ty, sign * lat, zD), pT = [pB[0], pB[1], zD + trussH];
        const post = _beamOverlapJS(mf, pB, pT, strutRU); if (post) parts.push(post);
        if (prevT) { const ch = _beamOverlapJS(mf, prevT, pT, strutRU * 1.15); if (ch) parts.push(ch); }
        if (prevB && prevT) { const dg = _beamOverlapJS(mf, k % 2 ? prevB : prevT, k % 2 ? pT : pB, strutRU); if (dg) parts.push(dg); }
        prevB = pB; prevT = pT;
      }
    }
  }
}

function buildBridgeSuperstructure(spec, terrainWater, ctx) {
  const laws = ctx.slaLaws || SLA_PRINT_LAWS, baySpanMm = Math.max(2.0, Math.min(10.0, (spec.spanU * ctx.scaleMm) / 8));
  const minStrutMm = laws.minStrutDiameterMm(baySpanMm), strutRU = Math.min((0.52 * minStrutMm) / ctx.scaleMm, Math.max(0.30 / ctx.scaleMm, spec.width * 0.16));
  const parts = [], supportStationsS = [], pylonStations = [];
  const metrics = { explicitSupportsUsed: 0, syntheticWaterPiers: 0, isThroughArch: false, minStrutMm, minStayGapMm: Infinity, zPylonTop: Math.max(...spec.zTopArr), pierMinZ: Infinity };
  _addBridgeSupportSolidsJS(spec, terrainWater, ctx, strutRU, parts, supportStationsS, pylonStations, metrics);
  if (spec.structNorm === 'arch') _buildArchSuperstructureJS(spec, terrainWater, ctx, minStrutMm, strutRU, parts, supportStationsS, metrics);
  else if (spec.structNorm !== 'beam' && spec.structNorm !== 'floating') _buildCableAndTrussSuperJS(spec, terrainWater, ctx, minStrutMm, strutRU, parts, pylonStations, metrics);
  if (!Number.isFinite(metrics.minStayGapMm)) metrics.minStayGapMm = minStrutMm;
  if (!Number.isFinite(metrics.pierMinZ)) metrics.pierMinZ = Math.min(...spec.zBotArr);
  return { parts, supportStationsS, metrics };
}

const _SUPER_EXPORTS = { buildBridgeSuperstructure };
if (typeof window !== 'undefined') Object.assign(window, _SUPER_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _SUPER_EXPORTS;
