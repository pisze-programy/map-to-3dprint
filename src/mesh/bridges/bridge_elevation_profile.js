// ============================================================================
// src/mesh/bridges/bridge_elevation_profile.js
// Single-Bridge Longitudinal Z(s) Grade, Water Clearance & Sag-Free Profile
// ============================================================================

if (typeof _segClosestPair2DJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(globalThis, require('./bridge_geom_2d.js'));
}
if (typeof _buildTinSurfaceSamplerJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(globalThis, require('./bridge_tin_sampler.js'));
}

function _bridgeCorridorPlateausJS(baseZArr, needArr, sArr, maxGapU) {
  const pos = [];
  for (let k = 0; k < needArr.length; k++) if (needArr[k] > 1e-4) pos.push(k);
  if (pos.length < 2) return;
  let cStart = 0;
  while (cStart < pos.length) {
    let cEnd = cStart;
    while (cEnd + 1 < pos.length && (sArr[pos[cEnd + 1]] - sArr[pos[cEnd]]) <= maxGapU) cEnd++;
    if (cEnd > cStart) {
      const i0 = pos[cStart], i1 = pos[cEnd], len = i1 - i0 + 1;
      const req = new Array(len);
      for (let m = cStart; m <= cEnd; m++) {
        const idx = pos[m];
        req[idx - i0] = baseZArr[idx] + needArr[idx];
        if (m < cEnd) {
          const nxt = pos[m + 1], rA = baseZArr[idx] + needArr[idx], rB = baseZArr[nxt] + needArr[nxt];
          const ds = Math.max(1e-6, sArr[nxt] - sArr[idx]);
          for (let q = idx + 1; q < nxt; q++) {
            req[q - i0] = rA + (rB - rA) * ((sArr[q] - sArr[idx]) / ds);
          }
        }
      }
      const lMax = new Array(len), rMax = new Array(len);
      lMax[0] = req[0];
      for (let m = 1; m < len; m++) lMax[m] = Math.max(lMax[m - 1], req[m]);
      rMax[len - 1] = req[len - 1];
      for (let m = len - 2; m >= 0; m--) rMax[m] = Math.max(rMax[m + 1], req[m]);
      for (let m = 0; m < len; m++) {
        const k = i0 + m, platZ = Math.max(req[m], Math.min(lMax[m], rMax[m]));
        if (platZ > baseZArr[k] + needArr[k]) needArr[k] = platZ - baseZArr[k];
      }
    }
    cStart = cEnd + 1;
  }
}

function _applyLocalSmoothLiftJS(zTopArr, zBotArr, sArr, spanU, needArr, baseRampU, pinStart, pinEnd) {
  const n = zTopArr.length, zRef = zTopArr.slice();
  for (let k = 0; k < n; k++) {
    if ((k === 0 && pinStart) || (k === n - 1 && pinEnd)) continue;
    const sk = sArr[k];
    const startTaper = pinStart ? Math.min(1.0, sk / Math.max(0.75, Math.min(spanU * 0.16, 2.2))) : 1.0;
    const endTaper = pinEnd ? Math.min(1.0, (spanU - sk) / Math.max(0.75, Math.min(spanU * 0.16, 2.2))) : 1.0;
    const pinEnv = Math.min(startTaper, endTaper);
    let lift = needArr[k] * pinEnv;
    for (let m = 0; m < n; m++) {
      const nm = needArr[m];
      if (nm <= 0) continue;
      const effNeed = Math.min(nm, Math.max(0, (zRef[m] + nm) - zRef[k]));
      if (effNeed * pinEnv <= lift) continue;
      const ramp = Math.max(baseRampU, Math.min(18.0, nm * 8.5));
      const ds = Math.abs(sk - sArr[m]);
      if (ds >= ramp) continue;
      const u = 1.0 - ds / ramp;
      const env = u * u * (3.0 - 2.0 * u) * pinEnv;
      if (effNeed * env > lift) lift = effNeed * env;
    }
    if (lift > 0) { zTopArr[k] += lift; zBotArr[k] += lift; }
  }
}

function solveSingleBridgeElevationProfileJS(sp, groundRoads, tinSampler, terrainWater, ctx, params) {
  const { mToBedXY, mToBedZ, minDryReliefU, airClearWater, baseLandClearU } = params;
  const pts = sp.pts, n = pts.length, L = Math.max(0.2, _polyLenJS(pts));
  sp.spanU = L;
  const t0x = pts[1][0] - pts[0][0], t0y = pts[1][1] - pts[0][1], l0 = Math.hypot(t0x, t0y) || 1;
  const t1x = pts[n - 1][0] - pts[n - 2][0], t1y = pts[n - 1][1] - pts[n - 2][1], l1 = Math.hypot(t1x, t1y) || 1;
  const abA = _sampleAbutmentZJS(pts[0], -t0x / l0, -t0y / l0, sp.outer, terrainWater, ctx, tinSampler, minDryReliefU);
  const abB = _sampleAbutmentZJS(pts[n - 1], t1x / l1, t1y / l1, sp.outer, terrainWater, ctx, tinSampler, minDryReliefU);
  sp.zAbutmentA = abA.z; sp.zAbutmentB = abB.z;
  const inW = _stationWaterFlagsJS(pts, terrainWater);
  sp.inWater = inW; sp.crossesWater = inW.some(Boolean);
  sp.isElevatedViaduct = Boolean((sp.isRail && sp.deckLayer >= 2) || (sp.deckLayer >= 2 && sp.clippedStart && sp.clippedEnd));

  const cumS = [0];
  for (let i = 1; i < n; i++) cumS.push(cumS[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  sp.sArr = cumS;

  const baseStart = abA.inWater ? Math.max(abA.z, ctx.zWaterTop + sp.deckThick + airClearWater) : abA.z;
  const baseEnd = abB.inWater ? Math.max(abB.z, ctx.zWaterTop + sp.deckThick + airClearWater) : abB.z;
  const waterFrac = inW.filter(Boolean).length / Math.max(1, n);

  const chordTop = cumS.map(s => baseStart + (baseEnd - baseStart) * (s / L));
  const spanMetersEst = L / Math.max(1e-5, mToBedXY);
  let baseTop;
  if (spanMetersEst > 900.0 && waterFrac < 0.45) {
    const rawDry = pts.map((p, i) => i === 0 ? baseStart : i === n - 1 ? baseEnd : (inW[i] ? null : tinSampler.getTrueSurfaceZ(p[0], p[1])));
    if (rawDry[0] == null) rawDry[0] = baseStart;
    if (rawDry[n - 1] == null) rawDry[n - 1] = baseEnd;
    let prevIdx = 0;
    for (let i = 1; i < n; i++) {
      if (rawDry[i] != null) {
        for (let m = prevIdx + 1; m < i; m++) {
          const f = (cumS[m] - cumS[prevIdx]) / Math.max(1e-5, cumS[i] - cumS[prevIdx]);
          rawDry[m] = rawDry[prevIdx] + (rawDry[i] - rawDry[prevIdx]) * f;
        }
        prevIdx = i;
      }
    }
    baseTop = rawDry.map((z, i) => {
      if (i === 0 || i === n - 1) return z;
      const sm = (rawDry[i - 1] + 2 * z + rawDry[i + 1]) * 0.25;
      return sp.isElevatedViaduct ? sm : Math.max(chordTop[i], sm);
    });
  } else {
    baseTop = chordTop;
  }

  const zTopArr = baseTop.slice();

  let wi = 0;
  while (wi < n) {
    if (!inW[wi]) { wi++; continue; }
    const w0 = wi;
    while (wi + 1 < n && inW[wi + 1]) wi++;
    const w1 = wi++;
    const bL = Math.max(0, w0 - 1), bR = Math.min(n - 1, w1 + 1);
    const spanW = Math.max(0.5, cumS[bR] - cumS[bL]);
    const clearNeedU = (sp.clearanceM != null && sp.clearanceM > 0)
      ? Math.min(spanW * 0.24, Math.max(airClearWater, sp.clearanceM * mToBedZ)) : airClearWater;
    const reqW = ctx.zWaterTop + sp.deckThick + clearNeedU;
    let maxDef = 0;
    for (let k = w0; k <= w1; k++) if (reqW > baseTop[k]) maxDef = Math.max(maxDef, reqW - baseTop[k]);
    if (maxDef > 0) {
      const rampU = Math.min(L * 0.38, Math.max(3.0, maxDef * 6.0));
      const s0 = w0 === 0 ? 0 : Math.max(0, cumS[w0] - rampU);
      const s1 = w1 === n - 1 ? L : Math.min(L, cumS[w1] + rampU);
      for (let k = 0; k < n; k++) {
        if ((k === 0 && !abA.inWater && !sp.clippedStart && !sp.joinPolyStart) || (k === n - 1 && !abB.inWater && !sp.clippedEnd && !sp.joinPolyEnd)) continue;
        const sk = cumS[k];
        if (sk < s0 || sk > s1) continue;
        let lift = 0;
        if (k >= w0 && k <= w1) {
          const uW = Math.max(0, Math.min(1, (sk - cumS[bL]) / spanW));
          lift = Math.max(reqW - baseTop[k], maxDef * (1.0 + 0.08 * Math.sin(Math.PI * uW)));
        } else if (sk < cumS[w0]) {
          const u = (sk - s0) / Math.max(1e-5, cumS[w0] - s0);
          lift = maxDef * u * u * (3 - 2 * u);
        } else {
          const u = (s1 - sk) / Math.max(1e-5, s1 - cumS[w1]);
          lift = maxDef * u * u * (3 - 2 * u);
        }
        if (baseTop[k] + lift > zTopArr[k]) zTopArr[k] = baseTop[k] + lift;
      }
    }
    for (let k = w0; k <= w1; k++) {
      if ((k === 0 && !abA.inWater) || (k === n - 1 && !abB.inWater)) continue;
      zTopArr[k] = Math.max(zTopArr[k], ctx.zWaterTop + sp.deckThick + airClearWater);
    }
  }

  const zBotArr = zTopArr.map(zt => zt - sp.deckThick);
  sp.bbox = _bbox2DJS(sp.isAreaPoly ? sp.outer : pts);
  if (!sp.isAreaPoly) { sp.bbox[0] -= sp.width * 0.6; sp.bbox[1] -= sp.width * 0.6; sp.bbox[2] += sp.width * 0.6; sp.bbox[3] += sp.width * 0.6; }

  const endSnapU = Math.max(0.55, sp.width * 0.70 + 0.25);
  const hasPosLvl = _hasPositiveOsmLevelJS(sp.level);
  let touchesGroundStart = false, touchesGroundEnd = false;
  for (const gr of groundRoads) {
    if (gr.layer > 0) continue;
    const g0 = gr.pts[0], g1 = gr.pts[gr.pts.length - 1];
    if (!touchesGroundStart && (Math.hypot(g0[0] - pts[0][0], g0[1] - pts[0][1]) <= endSnapU || Math.hypot(g1[0] - pts[0][0], g1[1] - pts[0][1]) <= endSnapU)) touchesGroundStart = true;
    if (!touchesGroundEnd && (Math.hypot(g0[0] - pts[n - 1][0], g0[1] - pts[n - 1][1]) <= endSnapU || Math.hypot(g1[0] - pts[n - 1][0], g1[1] - pts[n - 1][1]) <= endSnapU)) touchesGroundEnd = true;
    if (touchesGroundStart && touchesGroundEnd) break;
  }
  const isSkyFootway = Boolean(sp.isPath && sp.deckLayer >= 1 && !sp.isBoardwalk && (hasPosLvl || !sp.crossesWater));
  sp.elevatedDeadEndStart = Boolean(isSkyFootway && !sp.clippedStart && !sp.joinPolyStart && !abA.inWater && (hasPosLvl || !touchesGroundStart));
  sp.elevatedDeadEndEnd = Boolean(isSkyFootway && !sp.clippedEnd && !sp.joinPolyEnd && !abB.inWater && (hasPosLvl || !touchesGroundEnd));

  const pinA = !sp.isElevatedViaduct && !sp.clippedStart && !sp.joinPolyStart && !sp.elevatedDeadEndStart && !abA.inWater;
  const pinB = !sp.isElevatedViaduct && !sp.clippedEnd && !sp.joinPolyEnd && !sp.elevatedDeadEndEnd && !abB.inWater;
  const endZoneU = Math.min(L * 0.20, Math.max(0.95, sp.width * 1.25));
  const natSlope = Math.abs(baseEnd - baseStart) / Math.max(1.0, L);
  const gradeLim = Math.max(natSlope + 0.035, (sp.isRail ? 0.055 : (sp.isPath ? 0.13 : 0.095)) * (ctx.zScale || 1.0));
  const zAnchorA = zTopArr[0], zAnchorB = zTopArr[n - 1];
  const maxGradeTopAt = (sk) => Math.min(
    pinA ? zAnchorA + gradeLim * sk : Infinity,
    pinB ? zAnchorB + gradeLim * Math.max(0, L - sk) : Infinity
  );

  if (!sp.crossesWater && sp.deckLayer >= 1 && !sp.isBoardwalk && !sp.isElevatedViaduct && n >= 3) {
    let maxNatClear = -Infinity;
    for (let k = 1; k < n - 1; k++) {
      maxNatClear = Math.max(maxNatClear, (chordTop[k] - sp.deckThick) - tinSampler.getTrueSurfaceZ(pts[k][0], pts[k][1]));
    }
    if (maxNatClear < baseLandClearU * 0.90) {
      const freeStart = sp.clippedStart || sp.joinPolyStart || sp.elevatedDeadEndStart;
      const freeEnd = sp.clippedEnd || sp.joinPolyEnd || sp.elevatedDeadEndEnd;
      const ramp = Math.min(L * 0.20, Math.max(1.2, baseLandClearU * 4.2));
      for (let k = 0; k < n; k++) {
        if ((k === 0 && !freeStart) || (k === n - 1 && !freeEnd)) continue;
        const sk = cumS[k];
        const wA = freeStart ? 1.0 : Math.min(1.0, sk / Math.max(1e-4, ramp));
        const wB = freeEnd ? 1.0 : Math.min(1.0, (L - sk) / Math.max(1e-4, ramp));
        const env = Math.min(wA * wA * (3 - 2 * wA), wB * wB * (3 - 2 * wB));
        const rawReq = tinSampler.getTrueSurfaceZ(pts[k][0], pts[k][1]) + baseLandClearU * env + sp.deckThick;
        const reqTop = Math.min(rawReq, maxGradeTopAt(sk));
        if (reqTop > zTopArr[k]) { zTopArr[k] = reqTop; zBotArr[k] = reqTop - sp.deckThick; }
      }
    }
  }

  const landNeed = new Array(n).fill(0);
  if (sp.isElevatedViaduct) {
    const viadClearU = baseLandClearU + Math.min(0.42, 3.0 * mToBedZ) * Math.max(0, Math.min(2, sp.deckLayer - 1));
    for (let k = 0; k < n; k++) {
      if (inW[k]) continue;
      const reqTop = tinSampler.getTrueSurfaceZ(pts[k][0], pts[k][1]) + viadClearU + sp.deckThick;
      if (reqTop > zTopArr[k]) landNeed[k] = Math.max(landNeed[k], reqTop - zTopArr[k]);
    }
  }

  const pedLandClearU = Math.max(0.24, 0.36 / ctx.scaleMm, Math.min(0.62, 2.5 * mToBedZ));
  const juncSnapU = Math.max(0.25, 2.2 * mToBedXY);
  const cvList = sp.carriedVerts || [];

  if (!sp.isBoardwalk || sp.deckLayer >= 2) {
    for (const gr of groundRoads) {
      if (gr.layer >= sp.deckLayer) continue;
      if (sp.deckLayer >= 0 && gr.layer < 0) continue;
      if (sp.acrossOsmIdSet && gr.osmId != null && sp.acrossOsmIdSet.has(gr.osmId)) continue;
      if (sp.name && gr.name && sp.name === gr.name) continue;
      if (sp.bbox[2] < gr.bbox[0] || sp.bbox[0] > gr.bbox[2] || sp.bbox[3] < gr.bbox[1] || sp.bbox[1] > gr.bbox[3]) continue;
      const g0 = gr.pts[0], g1 = gr.pts[gr.pts.length - 1];
      if (cvList.length > 0 && cvList.some(cv => Math.hypot(g0[0] - cv[0], g0[1] - cv[1]) <= juncSnapU || Math.hypot(g1[0] - cv[0], g1[1] - cv[1]) <= juncSnapU)) {
        continue;
      }
      const touchesStartAbutment = pinA && (Math.hypot(g0[0] - pts[0][0], g0[1] - pts[0][1]) <= endSnapU || Math.hypot(g1[0] - pts[0][0], g1[1] - pts[0][1]) <= endSnapU);
      const touchesEndAbutment = pinB && (Math.hypot(g0[0] - pts[n - 1][0], g0[1] - pts[n - 1][1]) <= endSnapU || Math.hypot(g1[0] - pts[n - 1][0], g1[1] - pts[n - 1][1]) <= endSnapU);
      const rad = sp.width * 0.5 + gr.halfW + 0.08;
      const clearU = gr.isPath ? pedLandClearU : baseLandClearU;
      for (let k = 0; k < n - 1; k++) {
        const bdx = pts[k + 1][0] - pts[k][0], bdy = pts[k + 1][1] - pts[k][1], bl = Math.hypot(bdx, bdy) || 1;
        for (let q = 0; q < gr.pts.length - 1; q++) {
          const cp = _segClosestPair2DJS(pts[k], pts[k + 1], gr.pts[q], gr.pts[q + 1]);
          if (cp.dist > rad) continue;
          const sHit = cumS[k] + (cumS[k + 1] - cumS[k]) * cp.sA;
          const gdx = gr.pts[q + 1][0] - gr.pts[q][0], gdy = gr.pts[q + 1][1] - gr.pts[q][1], gl = Math.hypot(gdx, gdy) || 1;
          const absDot = Math.abs((bdx / bl) * (gdx / gl) + (bdy / bl) * (gdy / gl));
          if (absDot >= 0.72) continue;
          if (pinA && sHit <= endZoneU * 1.35 && (touchesStartAbutment || absDot >= 0.52)) continue;
          if (pinB && (L - sHit) <= endZoneU * 1.35 && (touchesEndAbutment || absDot >= 0.52)) continue;
          if (terrainWater.isPointInWater(cp.qb[0], cp.qb[1])) continue;
          const zGr = Math.max(tinSampler.getTrueSurfaceZ(cp.qb[0], cp.qb[1]), tinSampler.getTinZ(cp.qb[0], cp.qb[1]) + (terrainWater.hRoadU || 0));
          const rawReqTop = zGr + clearU + sp.deckThick;
          const reqTop = sp.isElevatedViaduct ? rawReqTop : Math.min(rawReqTop, maxGradeTopAt(sHit));
          const zCur = zTopArr[k] + (zTopArr[k + 1] - zTopArr[k]) * cp.sA;
          if (reqTop > zCur) {
            const def = reqTop - zCur;
            if (!(k === 0 && pinA)) landNeed[k] = Math.max(landNeed[k], Math.min(def, Math.max(0, maxGradeTopAt(cumS[k]) - zTopArr[k])));
            if (!(k + 1 === n - 1 && pinB)) landNeed[k + 1] = Math.max(landNeed[k + 1], Math.min(def, Math.max(0, maxGradeTopAt(cumS[k + 1]) - zTopArr[k + 1])));
          }
        }
      }
    }
  }

  if (landNeed.some(v => v > 0)) {
    _bridgeCorridorPlateausJS(zTopArr, landNeed, cumS, Math.max(2.5 / ctx.scaleMm, 55.0 * mToBedXY));
    if (!sp.isElevatedViaduct) {
      for (let k = 0; k < n; k++) {
        const cap = Math.max(0, maxGradeTopAt(cumS[k]) - zTopArr[k]);
        if (landNeed[k] > cap) landNeed[k] = cap;
      }
    }
    _applyLocalSmoothLiftJS(zTopArr, zBotArr, cumS, L, landNeed, 3.8, pinA, pinB);
  }

  for (let k = 0; k < n; k++) {
    if (inW[k]) continue;
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], dl = Math.hypot(dx, dy) || 1;
    const minDryTop = _sampleDryCrossSectionMinTopJS(
      pts[k][0], pts[k][1], -dy / dl, dx / dl, sp.width, sp.outer, terrainWater, tinSampler, minDryReliefU, ctx
    );
    if (minDryTop > zTopArr[k]) {
      zTopArr[k] = minDryTop;
      zBotArr[k] = minDryTop - sp.deckThick;
    }
  }

  if (sp.crossesWater && n >= 3) {
    const shoreBandU = Math.min(L * 0.36, Math.max(3.5, 65.0 * mToBedXY));
    let sw = 0;
    while (sw < n) {
      if (!inW[sw]) { sw++; continue; }
      const w0 = sw;
      while (sw + 1 < n && inW[sw + 1]) sw++;
      const w1 = sw++;
      let iPeakL = Math.max(0, w0 - 1), zPeakL = zTopArr[iPeakL];
      for (let k = iPeakL; k >= 0 && (cumS[w0] - cumS[k]) <= shoreBandU; k--) {
        if (inW[k] && k < w0) break;
        if (zTopArr[k] >= zPeakL) { zPeakL = zTopArr[k]; iPeakL = k; }
      }
      let iPeakR = Math.min(n - 1, w1 + 1), zPeakR = zTopArr[iPeakR];
      for (let k = iPeakR; k < n && (cumS[k] - cumS[w1]) <= shoreBandU; k++) {
        if (inW[k] && k > w1) break;
        if (zTopArr[k] >= zPeakR) { zPeakR = zTopArr[k]; iPeakR = k; }
      }
      if (iPeakR > iPeakL + 1) {
        const spanBridge = Math.max(1e-4, cumS[iPeakR] - cumS[iPeakL]);
        const camberAmp = Math.min(0.30 / ctx.scaleMm, spanBridge * (sp.isHumpback ? 0.022 : 0.008));
        for (let k = iPeakL; k <= iPeakR; k++) {
          const u = (cumS[k] - cumS[iPeakL]) / spanBridge;
          const zNoSag = zPeakL + (zPeakR - zPeakL) * u + camberAmp * Math.sin(Math.PI * u);
          if (zNoSag > zTopArr[k]) {
            zTopArr[k] = zNoSag;
            zBotArr[k] = zNoSag - sp.deckThick;
          }
        }
      }
    }
  }

  if (!inW[0] && !abA.inWater && !sp.elevatedDeadEndStart && !sp.isElevatedViaduct && !sp.joinPolyStart) sp.zAbutmentA = zTopArr[0];
  if (!inW[n - 1] && !abB.inWater && !sp.elevatedDeadEndEnd && !sp.isElevatedViaduct && !sp.joinPolyEnd) sp.zAbutmentB = zTopArr[n - 1];

  sp.zTopArr = zTopArr;
  sp.zBotArr = zBotArr;
}

const _BRIDGE_ELEV_PROFILE_EXPORTS = {
  _bridgeCorridorPlateausJS, _applyLocalSmoothLiftJS, solveSingleBridgeElevationProfileJS
};
if (typeof globalThis !== 'undefined') Object.assign(globalThis, _BRIDGE_ELEV_PROFILE_EXPORTS);
if (typeof window !== 'undefined') Object.assign(window, _BRIDGE_ELEV_PROFILE_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _BRIDGE_ELEV_PROFILE_EXPORTS;
