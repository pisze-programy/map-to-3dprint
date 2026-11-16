// ============================================================================
// src/mesh/bridges/bridge_superstructure_arch_cable.js
// Arch, Cable-Stayed, Suspension & Truss Superstructures (MSLA Anti-Capillary)
// ============================================================================

if (typeof _lerpArrAtSJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(globalThis, require('./bridge_deck_builder.js'));
}
if (typeof _addBridgeSupportSolidsJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(globalThis, require('./bridge_supports_solver.js'));
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

const _SUPER_EXPORTS = { _buildArchSuperstructureJS, _buildCableAndTrussSuperJS, buildBridgeSuperstructure };
if (typeof globalThis !== 'undefined') Object.assign(globalThis, _SUPER_EXPORTS);
if (typeof window !== 'undefined') Object.assign(window, _SUPER_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _SUPER_EXPORTS;
