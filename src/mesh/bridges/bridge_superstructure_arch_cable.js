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

/**
 * Finds midpoint stations of dry islands flanked by water inside [wStart, wEnd]
 * so multi-channel river arches anchor naturally on real islands.
 * @param {object} spec
 * @param {number} wStart
 * @param {number} wEnd
 * @param {number} minBayU
 * @returns {number[]}
 */
function _collectDryIslandStopsJS(spec, wStart, wEnd, minBayU) {
  const out = [];
  const inW = spec.inWater || [];
  const n = inW.length;
  let i = 0;
  while (i < n) {
    if (inW[i]) { i++; continue; }
    const d0 = i;
    while (i + 1 < n && !inW[i + 1]) i++;
    const d1 = i++;
    const hasWaterLeft = d0 > 0 && inW[d0 - 1];
    const hasWaterRight = d1 < n - 1 && inW[d1 + 1];
    if (!hasWaterLeft || !hasWaterRight) continue;
    const sMid = (spec.sArr[d0] + spec.sArr[d1]) * 0.5;
    if (sMid > wStart + minBayU && sMid < wEnd - minBayU) out.push(sMid);
  }
  return out;
}

/**
 * Subdivides water-cutout arch bays exceeding MSLA printable span limits into
 * balanced architectural bays so curved spandrels stay self-supporting.
 * @param {number[]} bayStops
 * @param {number} maxBayU
 * @returns {number[]}
 */
function _subdivideArchBaysForWaterCutoutJS(bayStops, maxBayU) {
  const out = [bayStops[0]];
  for (let i = 0; i < bayStops.length - 1; i++) {
    const a = bayStops[i], b = bayStops[i + 1], span = b - a;
    if (span > maxBayU * 1.04) {
      const nSub = Math.max(2, Math.min(20, Math.ceil(span / maxBayU)));
      for (let k = 1; k < nSub; k++) out.push(a + (k / nSub) * span);
    }
    out.push(b);
  }
  return out;
}

/**
 * Builds a sleek bridge-aligned rectangular masonry pier at station sEnd.
 * @returns {object|null} Manifold solid or null
 */
function _buildAlignedArchPierJS(spec, sEnd, pierHalfL, pierHalfW, terrainWater, ctx, metrics) {
  const mf = ctx.mf;
  const scaleMm = ctx.scaleMm || 1.89;
  const minThickU = Math.min(0.05, 0.08 / scaleMm);
  const { pt, tx, ty } = _samplePtAtSJS(spec, sEnd);
  if (Number.isFinite(ctx.halfW) && Number.isFinite(ctx.halfH)) {
    if (Math.abs(pt[0]) > ctx.halfW + 0.4 || Math.abs(pt[1]) > ctx.halfH + 0.4) return null;
  }
  const zCap = typeof _safeSubDeckCapZJS === 'function'
    ? _safeSubDeckCapZJS(spec, sEnd, pierHalfL, scaleMm)
    : (_lerpArrAtSJS(spec.sArr, spec.zBotArr, sEnd) + Math.min(spec.deckThick * 0.4, 0.12 / scaleMm));
  const zFl = _anchorFloorZJS(pt[0], pt[1], terrainWater, ctx);
  if (zCap <= zFl + minThickU) return null;
  metrics.pierMinZ = Math.min(metrics.pierMinZ, zFl);
  const pA = [pt[0] - tx * pierHalfL, pt[1] - ty * pierHalfL];
  const pB = [pt[0] + tx * pierHalfL, pt[1] + ty * pierHalfL];
  return _buildSlopedWedgeCorbelJS(pA, pB, pierHalfW, zFl, zFl, zCap, zCap, mf, minThickU);
}

/**
 * Builds a curved parabolic spandrel arch vault beneath the bridge deck across [b0, b1],
 * keeping all arch haunches self-supporting and eliminating flat crown overhangs.
 */
function _buildCurvedArchSpandrelVaultJS(spec, b0, b1, archRise, zFloorBay, vaultHalfW, mf, scaleMm, parts) {
  const minThickU = Math.min(0.04, 0.06 / scaleMm);
  const baySpan = Math.max(0.2 / scaleMm, b1 - b0);
  const nSeg = 10;
  const crownDrop = 0.14 / scaleMm;
  const embedTop = Math.min(spec.deckThick * 0.42, 0.14 / scaleMm);
  const zFloorMin = zFloorBay + 0.35 / scaleMm;
  let prevPt = null, prevZBot = 0, prevZTop = 0;

  for (let k = 0; k <= nSeg; k++) {
    const u = k / nSeg;
    const s = Math.max(0, Math.min(spec.spanU, b0 + u * baySpan));
    const { pt } = _samplePtAtSJS(spec, s);
    const zBotS = _lerpArrAtSJS(spec.sArr, spec.zBotArr, s);
    const zTopS = _lerpArrAtSJS(spec.sArr, spec.zTopArr, s);
    const zVaultTop = Math.min(zTopS - 0.05 / scaleMm, zBotS + embedTop);
    const zCrown = zBotS - crownDrop;
    const zArch = Math.max(zFloorMin, (zCrown - archRise) + 4 * u * (1 - u) * archRise);
    if (prevPt) {
      const seg = _buildSlopedWedgeCorbelJS(prevPt, pt, vaultHalfW, prevZBot, zArch, prevZTop, zVaultTop, mf, minThickU);
      if (seg) parts.push(seg);
    }
    prevPt = pt;
    prevZBot = zArch;
    prevZTop = zVaultTop;
  }
}

function _buildArchSuperstructureJS(spec, terrainWater, ctx, strutDiamMm, strutRU, parts, supportStationsS, metrics) {
  const mf = ctx.mf, L = spec.spanU, halfW = spec.width * 0.5, scaleMm = ctx.scaleMm || 1.89;
  const mToBedXY = Math.max(1e-5, (ctx.mToU || 0.1) * (ctx.scaleToBed || 1.0));
  const mToBedZ = (ctx.mToU || 0.1) * (ctx.zScale || 1.0) * (ctx.scaleToBed || 1.0);
  let wStart = L * 0.06, wEnd = L * 0.94;
  if (spec.crossesWater) {
    const idxs = spec.inWater.map((w, i) => w ? i : -1).filter(i => i >= 0);
    let iL = Math.max(0, idxs[0] - 1), iR = Math.min(spec.pts.length - 1, idxs[idxs.length - 1] + 1);
    while (iL > 0 && terrainWater.isPointInWater(spec.pts[iL][0], spec.pts[iL][1])) iL--;
    while (iR < spec.pts.length - 1 && terrainWater.isPointInWater(spec.pts[iR][0], spec.pts[iR][1])) iR++;
    wStart = Math.max(0, spec.sArr[iL]);
    wEnd = Math.min(L, spec.sArr[iR]);
    const bankSnapMax = L * 0.25;
    for (const sSup of (supportStationsS || [])) {
      if (sSup < wStart && wStart - sSup <= bankSnapMax) wStart = sSup;
      if (sSup > wEnd && sSup - wEnd <= bankSnapMax) wEnd = sSup;
    }
  }
  const totalArchSpan = Math.max(0.4 / scaleMm, wEnd - wStart), nPts = spec.pts.length;
  const minBayU = Math.max(1.2 / scaleMm, Math.min(totalArchSpan * 0.45, 22.0 * mToBedXY));
  const interiorStops = [];
  for (const sRaw of (supportStationsS || []).slice().sort((a, b) => a - b)) {
    if (sRaw <= wStart + minBayU || sRaw >= wEnd - minBayU) continue;
    if (!interiorStops.length || sRaw - interiorStops[interiorStops.length - 1] >= minBayU) interiorStops.push(sRaw);
  }
  if (spec.crossesWater) {
    for (const sIsl of _collectDryIslandStopsJS(spec, wStart, wEnd, minBayU)) {
      if (!interiorStops.some(s => Math.abs(s - sIsl) < minBayU)) interiorStops.push(sIsl);
    }
    interiorStops.sort((a, b) => a - b);
  }
  const archSpanMeters = totalArchSpan / mToBedXY;
  const isAbutmentOnly = String(spec.bridgeSupport || '').trim().toLowerCase() === 'abutment';
  // Measure deck clearance above nominal water/land datum so deep gorges stay deck-arches
  // while flat-harbour long-span abutment arches under waterCutout rise as through-arches.
  const zNominalWaterRef = Math.max(ctx.zWaterTop || 0, (ctx.zLandDatum || 0) - 0.6 / scaleMm);
  const nominalClears = [];
  for (let i = 0; i < nPts; i++) {
    if (spec.inWater[i]) nominalClears.push(spec.zBotArr[i] - zNominalWaterRef);
  }
  nominalClears.sort((a, b) => a - b);
  const medWNominal = nominalClears.length ? nominalClears[nominalClears.length >> 1] : Infinity;
  const isLongSpanThroughArch = Boolean(
    spec.crossesWater &&
    !spec.isHumpback &&
    !interiorStops.length &&
    medWNominal < 3.5 / scaleMm &&
    ((isAbutmentOnly && archSpanMeters >= 130.0) || archSpanMeters >= 240.0)
  );
  if (!interiorStops.length && !spec.explicitThroughArch && !isLongSpanThroughArch && archSpanMeters > 265.0) {
    const nAutoBays = Math.max(2, Math.round(archSpanMeters / 110.0));
    for (let b = 1; b < nAutoBays; b++) interiorStops.push(wStart + (b / nAutoBays) * totalArchSpan);
  }
  let bayStops = [wStart, ...interiorStops, wEnd];

  // Under waterCutout the river channel is carved to Z = 0.0, providing full under-deck arch clearance.
  const zWaterRef = ctx.waterCutout ? 0.0 : ctx.zWaterTop;
  const waterClears = [];
  let minL = Infinity;
  for (let i = 0; i < nPts; i++) {
    if (spec.inWater[i]) waterClears.push(spec.zBotArr[i] - zWaterRef);
    else if (nPts <= 2 || (i > 0 && i < nPts - 1)) minL = Math.min(minL, spec.zBotArr[i] - terrainWater.getSurfaceZ(spec.pts[i][0], spec.pts[i][1]));
  }
  waterClears.sort((a, b) => a - b);
  const medW = waterClears.length ? waterClears[waterClears.length >> 1] : Infinity;
  const initAvgBay = totalArchSpan / Math.max(1, bayStops.length - 1);
  const waterThroughThresh = spec.isRail
    ? (2.4 / scaleMm)
    : Math.max(1.25 / scaleMm, Math.min(2.5 / scaleMm, initAvgBay * 0.085));
  const isThrough = !spec.isHumpback && Boolean(
    spec.explicitThroughArch ||
    isLongSpanThroughArch ||
    (spec.crossesWater && medW < waterThroughThresh)
  );
  metrics.isThroughArch = isThrough;

  const isWaterCutoutArch = Boolean(ctx.waterCutout && spec.crossesWater);
  // Keep above-deck through-arch spans undivided so long-span steel harbour arches rise as one
  // continuous soaring arch while MSLA-safe sub-deck support piers stay cleanly spaced underneath.
  const superBayStops = bayStops.slice();
  if (isWaterCutoutArch) {
    bayStops = _subdivideArchBaysForWaterCutoutJS(bayStops, 4.4 / scaleMm);
  }
  const avgBaySpan = totalArchSpan / Math.max(1, bayStops.length - 1);
  const ribR = Math.max(strutRU * 1.15, spec.deckThick * 0.34);
  const lat = Math.max(halfW * 0.86, ribR * 1.4) * (isThrough ? 1 : 0.85);
  const endBankTolU = 0.35 / scaleMm;

  if (!isThrough || isWaterCutoutArch) {
    const pierHalfL = Math.max(0.32 / scaleMm, Math.min(0.42 / scaleMm, avgBaySpan * 0.085));
    const pierHalfW = isThrough
      ? Math.max(0.28 / scaleMm, Math.min(halfW * 0.62, 0.55 / scaleMm))
      : Math.max(0.30 / scaleMm, Math.min(halfW * 0.96, halfW + 0.04 / scaleMm));
    for (let si = 0; si < bayStops.length; si++) {
      const sEnd = bayStops[si];
      const isInteriorStop = si > 0 && si < bayStops.length - 1;
      const { pt, tx, ty } = _samplePtAtSJS(spec, sEnd);
      const hasExplicitNear = (spec.explicitSupports || []).some(es => Math.abs(es.sProj - sEnd) <= Math.max(0.5 / scaleMm, spec.width * 0.8));
      const inWaterPt = terrainWater.isPointInWater(pt[0], pt[1]);
      if (isWaterCutoutArch && isInteriorStop && !hasExplicitNear) {
        const pier = _buildAlignedArchPierJS(spec, sEnd, pierHalfL, pierHalfW, terrainWater, ctx, metrics);
        if (pier) {
          parts.push(pier);
          supportStationsS.push(sEnd);
        }
      } else if (!isThrough && !inWaterPt && !hasExplicitNear) {
        if (isWaterCutoutArch && (sEnd <= endBankTolU || sEnd >= L - endBankTolU)) continue;
        const pR = Math.max(ribR * 1.25, halfW * 0.4);
        const zCap = typeof _safeSubDeckCapZJS === 'function'
          ? _safeSubDeckCapZJS(spec, sEnd, pR, scaleMm)
          : (_lerpArrAtSJS(spec.sArr, spec.zBotArr, sEnd) + Math.min(spec.deckThick * 0.4, 0.10 / scaleMm));
        const zFl = _anchorFloorZJS(pt[0], pt[1], terrainWater, ctx);
        const pier = zCap > zFl + 0.03 / scaleMm ? beamManifoldBetween(mf, [pt[0], pt[1], zFl], [pt[0], pt[1], zCap], pR) : null;
        if (pier) parts.push(pier);
      } else if (!isThrough && !inWaterPt && hasExplicitNear) {
        // Ensure lateral arch rib springings also ground cleanly into steep cliffside slopes
        for (const sign of [-1, 1]) {
          const sp = _sidePtJS(pt, tx, ty, sign * lat, 0);
          if (terrainWater.isPointInWater(sp[0], sp[1])) continue;
          const zCap = typeof _safeSubDeckCapZJS === 'function' ? _safeSubDeckCapZJS(spec, sEnd, ribR, scaleMm) : _lerpArrAtSJS(spec.sArr, spec.zBotArr, sEnd);
          const zFl = _anchorFloorZJS(sp[0], sp[1], terrainWater, ctx);
          if (zCap > zFl + 0.04 / scaleMm) {
            const leg = beamManifoldBetween(mf, [sp[0], sp[1], zFl], [sp[0], sp[1], zCap], ribR * 1.05);
            if (leg) parts.push(leg);
          }
        }
      }
    }
  }

  const activeBays = isThrough ? superBayStops : bayStops;
  for (let bi = 0; bi < activeBays.length - 1; bi++) {
    const b0 = activeBays[bi], b1 = activeBays[bi + 1], baySpan = Math.max(0.4 / scaleMm, b1 - b0);
    const baySpanMm = baySpan * scaleMm;
    const desiredHang = isThrough ? Math.max(9, Math.min(30, Math.ceil(baySpanMm / 1.9))) : 9;
    const { count: nHang, minGapMm } = _computeAntiCapillarySamplesJS(baySpan * 0.90, strutDiamMm, desiredHang, ctx);
    metrics.minStayGapMm = Math.min(metrics.minStayGapMm, minGapMm);
    const sMid = (b0 + b1) * 0.5, { pt: ptMid } = _samplePtAtSJS(spec, sMid);
    const zDeckMid = _lerpArrAtSJS(spec.sArr, isThrough ? spec.zTopArr : spec.zBotArr, sMid);
    const midInWater = terrainWater.isPointInWater(ptMid[0], ptMid[1]);
    const zFloorLim = midInWater
      ? (ctx.waterCutout ? 0.0 : ctx.zWaterTop + 0.32 / scaleMm)
      : terrainWater.getSurfaceZ(ptMid[0], ptMid[1]) + 0.25 / scaleMm;
    if (!isThrough && spec.isHumpback && (zDeckMid - zFloorLim) < 0.35 / scaleMm) continue;

    if (isWaterCutoutArch && !isThrough) {
      const archRise = Math.max(0.65 / scaleMm, Math.min(baySpan * 0.46, Math.max(0.65 / scaleMm, zDeckMid - zFloorLim - 0.65 / scaleMm)));
      const vaultHalfW = Math.max(0.28 / scaleMm, halfW * 0.88);
      _buildCurvedArchSpandrelVaultJS(spec, b0, b1, archRise, zFloorLim, vaultHalfW, mf, scaleMm, parts);
      const fasciaLat = Math.max(vaultHalfW, halfW * 0.94);
      const fasciaR = Math.max(0.14 / scaleMm, Math.min(ribR * 0.85, spec.deckThick * 0.26));
      for (const sign of [-1, 1]) {
        let prev = null;
        for (let k = 0; k <= 8; k++) {
          const u = k / 8, s = b0 + u * baySpan, { pt, tx, ty } = _samplePtAtSJS(spec, s);
          const zBotS = _lerpArrAtSJS(spec.sArr, spec.zBotArr, s);
          const zCrown = zBotS - 0.14 / scaleMm;
          const zArch = Math.max(zFloorLim + 0.35 / scaleMm, (zCrown - archRise) + 4 * u * (1 - u) * archRise);
          const p = _sidePtJS(pt, tx, ty, sign * fasciaLat, zArch);
          if (prev) { const b = _beamOverlapJS(mf, prev, p, fasciaR); if (b) parts.push(b); }
          prev = p;
        }
      }
      continue;
    }

    const riseOrDrop = isThrough
      ? Math.max(2.0 / scaleMm, Math.min(baySpan * 0.28, spec.heightM ? spec.heightM * mToBedZ : baySpan * 0.23))
      : Math.max(0.45 / scaleMm, Math.min(baySpan * 0.32, Math.max(0.45 / scaleMm, zDeckMid - zFloorLim)));
    if (isThrough) metrics.zPylonTop = Math.max(metrics.zPylonTop, _lerpArrAtSJS(spec.sArr, spec.zTopArr, sMid) + riseOrDrop);
    if (!isThrough) {
      for (const sEnd of [b0, b1]) {
        const { pt, tx, ty } = _samplePtAtSJS(spec, sEnd);
        const zSpring = _lerpArrAtSJS(spec.sArr, spec.zBotArr, sEnd) - riseOrDrop;
        const tie = _beamOverlapJS(mf, _sidePtJS(pt, tx, ty, -lat, zSpring), _sidePtJS(pt, tx, ty, lat, zSpring), ribR * 1.02);
        if (tie) parts.push(tie);
      }
    }

    const isMajorSteelThroughTruss = Boolean(isThrough && baySpanMm >= 14.0);
    const nArchSeg = isMajorSteelThroughTruss ? Math.max(12, Math.min(28, Math.ceil(baySpanMm / 2.0))) : 8;
    const crownTrussDepth = isMajorSteelThroughTruss ? Math.max(1.1 / scaleMm, Math.min(2.4 / scaleMm, riseOrDrop * 0.22)) : 0;
    const trussDepthAtU = (u) => crownTrussDepth * (1.0 + 0.50 * (1.0 - 4.0 * u * (1.0 - u)));

    for (const sign of [-1, 1]) {
      let prevLo = null;
      let prevHi = null;
      for (let k = 0; k <= nArchSeg; k++) {
        const u = k / nArchSeg, s = b0 + u * baySpan, { pt, tx, ty } = _samplePtAtSJS(spec, s);
        const zTopS = _lerpArrAtSJS(spec.sArr, spec.zTopArr, s);
        const zBotS = _lerpArrAtSJS(spec.sArr, spec.zBotArr, s);
        const crownEmbed = Math.min(0.08 / scaleMm, Math.max(0, (zTopS - zBotS) - ribR - 0.06 / scaleMm));
        const zBase = isThrough ? (zTopS - 0.04 / scaleMm) : (zBotS - riseOrDrop);
        const zArch = isThrough
          ? (zBase + 4 * u * (1 - u) * riseOrDrop)
          : Math.min(zTopS - ribR - 0.05 / scaleMm, zBase + 4 * u * (1 - u) * (riseOrDrop + crownEmbed));
        const pLo = _sidePtJS(pt, tx, ty, sign * lat, zArch);
        if (prevLo) { const b = _beamOverlapJS(mf, prevLo, pLo, ribR); if (b) parts.push(b); }
        prevLo = pLo;

        if (isMajorSteelThroughTruss) {
          const zUpper = zArch + trussDepthAtU(u);
          const pHi = _sidePtJS(pt, tx, ty, sign * lat, zUpper);
          if (prevHi) { const bHi = _beamOverlapJS(mf, prevHi, pHi, ribR * 0.95); if (bHi) parts.push(bHi); }
          if (k === 0 || k === nArchSeg) {
            const endPost = _beamOverlapJS(mf, _sidePtJS(pt, tx, ty, sign * lat, zTopS - 0.05 / scaleMm), pHi, ribR * 1.05);
            if (endPost) parts.push(endPost);
          }
          prevHi = pHi;
        }
      }
      for (let h = 1; h < nHang - 1; h++) {
        const u = h / (nHang - 1), s = b0 + u * baySpan, { pt, tx, ty } = _samplePtAtSJS(spec, s);
        const zTopS = _lerpArrAtSJS(spec.sArr, spec.zTopArr, s);
        const zBotS = _lerpArrAtSJS(spec.sArr, spec.zBotArr, s);
        const zD = isThrough ? (zTopS - 0.04 / scaleMm) : Math.min(zTopS - 0.05 / scaleMm, zBotS + Math.min(spec.deckThick * 0.4, 0.12 / scaleMm));
        const zA = (isThrough ? zD : zBotS - riseOrDrop) + 4 * u * (1 - u) * riseOrDrop;
        const zTopHanger = isMajorSteelThroughTruss ? (zA + trussDepthAtU(u)) : zA;
        if (Math.abs(zD - zTopHanger) < 0.08 / scaleMm) continue;
        const bar = _beamOverlapJS(mf, _sidePtJS(pt, tx, ty, sign * lat, Math.min(zD, zTopHanger)), _sidePtJS(pt, tx, ty, sign * lat, Math.max(zD, zTopHanger)), strutRU);
        if (bar) parts.push(bar);
      }
    }

    // Add self-supporting >= 45 deg chevron lateral bracing between left/right ribs on major steel through-arches
    if (isMajorSteelThroughTruss && lat > 0.35 / scaleMm) {
      const nBraces = Math.max(3, Math.min(9, Math.floor(nHang / 3)));
      const braceR = Math.max(strutRU * 0.92, ribR * 0.72);
      const chevronRise = Math.min(crownTrussDepth * 1.15, lat * 1.02);
      for (let k = 1; k < nBraces; k++) {
        const u = k / nBraces;
        const s = b0 + u * baySpan;
        const { pt, tx, ty } = _samplePtAtSJS(spec, s);
        const zTopS = _lerpArrAtSJS(spec.sArr, spec.zTopArr, s);
        const zArch = (zTopS - 0.04 / scaleMm) + 4 * u * (1 - u) * riseOrDrop;
        if (zArch - zTopS < 2.2 / scaleMm) continue;
        const pL = _sidePtJS(pt, tx, ty, -lat, zArch);
        const pR = _sidePtJS(pt, tx, ty, lat, zArch);
        const pApex = [pt[0], pt[1], zArch + chevronRise];
        const bL = _beamOverlapJS(mf, pL, pApex, braceR);
        const bR = _beamOverlapJS(mf, pR, pApex, braceR);
        if (bL) parts.push(bL);
        if (bR) parts.push(bR);
      }
    }
  }
}

function _buildCableAndTrussSuperJS(spec, terrainWater, ctx, strutDiamMm, strutRU, parts, pylonStations, metrics) {
  const mf = ctx.mf, L = spec.spanU, halfW = spec.width * 0.5, scaleMm = ctx.scaleMm || 1.89;
  const lat = Math.max(halfW * 0.84, strutRU * 1.5);
  const mToBedXY = Math.max(1e-5, (ctx.mToU || 0.1) * (ctx.scaleToBed || 1.0));
  const shaftR = Math.max(strutRU * 1.35, Math.min(halfW * 0.28, 0.85 / scaleMm));
  const clampLat = (py, sg) => py.isCentral ? py.cLat : (py.latMin != null ? Math.max(py.latMin + strutRU * 0.5, Math.min(py.latMax - strutRU * 0.5, sg * lat)) : sg * lat);
  if (spec.structNorm === 'cable-stayed' || spec.structNorm === 'suspension') {
    if (!pylonStations.length && !spec.crossesWater && (L / mToBedXY) < 110.0) return;
    if (!pylonStations.length) {
      const fW = spec.inWater.indexOf(true), lW = spec.inWater.lastIndexOf(true);
      const cands = (fW > 0 && lW < spec.inWater.length - 1) ? [Math.max(0.06 * L, spec.sArr[fW - 1]), Math.min(0.94 * L, spec.sArr[lW + 1])] : [0.22 * L, 0.78 * L];
      for (const sPos of (Math.abs(cands[1] - cands[0]) < 1.2 / scaleMm ? [L * 0.5] : cands)) {
        const { pt, tx, ty } = _samplePtAtSJS(spec, sPos), zFloor = _anchorFloorZJS(pt[0], pt[1], terrainWater, ctx);
        const zBot = _lerpArrAtSJS(spec.sArr, spec.zBotArr, sPos), zTop = _lerpArrAtSJS(spec.sArr, spec.zTopArr, sPos), zPTop = _resolvePylonTopZJS(spec, zTop, zFloor, null, ctx);
        metrics.pierMinZ = Math.min(metrics.pierMinZ, zFloor);
        _addTwinOrPortalPylonJS(parts, pt, tx, ty, halfW, zFloor, zBot, zTop, zPTop, shaftR, mf, scaleMm);
        pylonStations.push({ s: sPos, pt, tx, ty, zTop, zPylonTop: zPTop, isCentral: false });
      }
    }
    for (let pi = 0; pi < pylonStations.length; pi++) {
      const py = pylonStations[pi]; metrics.zPylonTop = Math.max(metrics.zPylonTop, py.zPylonTop);
      if (spec.structNorm !== 'cable-stayed') continue;
      const sL = pi === 0 ? 0.04 * L : (pylonStations[pi - 1].s + py.s) * 0.5, sR = pi === pylonStations.length - 1 ? 0.96 * L : (py.s + pylonStations[pi + 1].s) * 0.5;
      const canFan = (py.zPylonTop - py.zTop) >= 4.0 / scaleMm, lats = py.isCentral ? [[py.cLat, 0]] : [[-1, -1], [1, 1]].map(([sg]) => [clampLat(py, sg), sg * lat]);
      const clearOff = Math.min(0.35, 0.55 / scaleMm);
      for (const [a, b, rev] of [[sL, Math.max(sL, py.s - clearOff), false], [Math.min(sR, py.s + clearOff), sR, true]]) {
        if (b - a < 0.4 / scaleMm) continue;
        const { count, minGapMm } = _computeAntiCapillarySamplesJS(b - a, strutDiamMm, 5, ctx);
        metrics.minStayGapMm = Math.min(metrics.minStayGapMm, minGapMm);
        for (let k = 0; k < count; k++) {
          const u = k / Math.max(1, count - 1), sk = a + u * (b - a), { pt, tx, ty } = _samplePtAtSJS(spec, sk), zAnc = _lerpArrAtSJS(spec.sArr, spec.zTopArr, sk) - 0.04 / scaleMm;
          const zPyA = canFan ? py.zTop + (py.zPylonTop - py.zTop) * (0.55 + 0.40 * (rev ? u : 1 - u)) : py.zPylonTop - strutRU * 1.2;
          for (const [pLat, dLat] of lats) { const st = _beamOverlapJS(mf, _sidePtJS(py.pt, py.tx, py.ty, pLat, zPyA), _sidePtJS(pt, tx, ty, dLat, zAnc), strutRU); if (st) parts.push(st); }
        }
      }
    }
    if (spec.structNorm === 'suspension' && pylonStations.length >= 2) {
      for (let pi = 0; pi < pylonStations.length - 1; pi++) {
        const pA = pylonStations[pi], pB = pylonStations[pi + 1], sp = Math.max(0.4 / scaleMm, pB.s - pA.s), sagU = Math.max(0.6 / scaleMm, Math.min(sp * 0.22, (pA.zPylonTop - pA.zTop) * 0.72));
        const { count, minGapMm } = _computeAntiCapillarySamplesJS(sp * 0.85, strutDiamMm, 8, ctx);
        metrics.minStayGapMm = Math.min(metrics.minStayGapMm, minGapMm);
        for (const sign of (pA.isCentral && pB.isCentral ? [0] : [-1, 1])) {
          const lA = clampLat(pA, sign), lB = clampLat(pB, sign);
          let prev = null;
          for (let k = 0; k <= 8; k++) { const u = k / 8, sk = pA.s + u * sp, { pt, tx, ty } = _samplePtAtSJS(spec, sk), p = _sidePtJS(pt, tx, ty, lA + (lB - lA) * u, (pA.zPylonTop + (pB.zPylonTop - pA.zPylonTop) * u) - 4 * u * (1 - u) * sagU); if (prev) { const c = _beamOverlapJS(mf, prev, p, strutRU * 1.2); if (c) parts.push(c); } prev = p; }
          for (let h = 1; h < count - 1; h++) { const u = h / (count - 1), sk = pA.s + u * sp, { pt, tx, ty } = _samplePtAtSJS(spec, sk), lU = lA + (lB - lA) * u, zD = _lerpArrAtSJS(spec.sArr, spec.zTopArr, sk) - 0.04 / scaleMm, zC = (pA.zPylonTop + (pB.zPylonTop - pA.zPylonTop) * u) - 4 * u * (1 - u) * sagU; const hg = _beamOverlapJS(mf, _sidePtJS(pt, tx, ty, lU, zD), _sidePtJS(pt, tx, ty, lU, zC), strutRU); if (hg) parts.push(hg); }
        }
      }
    }
  } else if (spec.structNorm === 'truss') {
    const trussH = Math.max(1.5 / scaleMm, Math.min(L * 0.14, spec.width * 0.85)), { count, minGapMm } = _computeAntiCapillarySamplesJS(L * 0.9, strutDiamMm, 8, ctx);
    metrics.minStayGapMm = Math.min(metrics.minStayGapMm, minGapMm); metrics.zPylonTop = Math.max(metrics.zPylonTop, Math.max(...spec.zTopArr) + trussH);
    for (const sign of [-1, 1]) {
      let prevB = null, prevT = null;
      for (let k = 0; k < count; k++) {
        const s = (k / (count - 1)) * L, { pt, tx, ty } = _samplePtAtSJS(spec, s), zD = _lerpArrAtSJS(spec.sArr, spec.zTopArr, s) - 0.04 / scaleMm;
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
