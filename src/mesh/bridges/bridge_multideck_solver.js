// ============================================================================
// src/mesh/bridges/bridge_multideck_solver.js
// Area-Approach Welding, Butt-Joint Alignment, Multi-Deck Clearance & Graph API
// ============================================================================

if (typeof _ptInRingJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(globalThis, require('./bridge_geom_2d.js'));
}
if (typeof _outTan2DJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(globalThis, require('./bridge_spine_stitch.js'));
}
if (typeof _buildTinSurfaceSamplerJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(globalThis, require('./bridge_tin_sampler.js'));
}
if (typeof _extractBridgeSpecsFromSceneJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(globalThis, require('./bridge_specs_extract.js'));
}
if (typeof solveSingleBridgeElevationProfileJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(globalThis, require('./bridge_elevation_profile.js'));
}

function _weldSplitApproachesToAreaDecksJS(specs) {
  const areaSpecs = specs.filter(s => s.isAreaPoly && s.outer && s.outer.length >= 3);
  if (areaSpecs.length === 0) return;
  for (const sp of specs) {
    if (sp.isAreaPoly || (!sp.joinPolyStart && !sp.joinPolyEnd)) continue;
    for (const [atStart, idx] of [[true, 0], [false, sp.pts.length - 1]]) {
      if (atStart ? !sp.joinPolyStart : !sp.joinPolyEnd) continue;
      const ep = sp.pts[idx];
      const targetArea = areaSpecs.find(as => _ptInRingJS(ep[0], ep[1], as.outer)) ||
        areaSpecs.find(as => typeof _ptToPolyDist2DJS === 'function' && _ptToPolyDist2DJS(ep[0], ep[1], as.outer) <= 0.8);
      if (!targetArea) continue;
      let nearZ = targetArea.zTopArr[0], nearD = Infinity;
      for (let q = 0; q < targetArea.pts.length; q++) {
        const d = Math.hypot(ep[0] - targetArea.pts[q][0], ep[1] - targetArea.pts[q][1]);
        if (d < nearD) { nearD = d; nearZ = targetArea.zTopArr[q]; }
      }
      const dz = nearZ - sp.zTopArr[idx];
      if (Math.abs(dz) > 0.005 && Math.abs(dz) < 3.5) {
        const rU = Math.min(sp.spanU * 0.45, Math.max(1.8, Math.abs(dz) * 6.0));
        for (let m = 0; m < sp.pts.length; m++) {
          const ds = atStart ? sp.sArr[m] : (sp.spanU - sp.sArr[m]);
          if (ds < rU) { const u = 1 - ds / rU, w = dz * u * u * (3 - 2 * u); sp.zTopArr[m] += w; sp.zBotArr[m] += w; }
        }
      }
    }
  }
}

function solveMultiDeckClearancesJS(specs, ctx, mToBedXY, minDeckU) {
  specs.sort((a, b) => a.deckLayer - b.deckLayer);
  const gapU = Math.max(0.30, 0.48 / ctx.scaleMm, minDeckU * 0.48);

  const findButtJoints = (lo, hi, hitRad) => {
    const out = [];
    if (Boolean(hi.isRail) !== Boolean(lo.isRail) || hi.deckLayer - lo.deckLayer !== 1) return out;
    const hiMid = hi.pts[hi.pts.length >> 1];
    let minMidDist = Infinity;
    for (let q = 0; q < lo.pts.length; q++) minMidDist = Math.min(minMidDist, Math.hypot(hiMid[0] - lo.pts[q][0], hiMid[1] - lo.pts[q][1]));
    if (minMidDist <= hitRad * 1.6) return out;
    const joinSnap = Math.max(1.1, (hi.width + lo.width) * 0.65);
    for (const [hiAtStart, hiIdx] of [[true, 0], [false, hi.pts.length - 1]]) {
      const tHi = _outTan2DJS(hi.pts, hiAtStart), pHi = hi.pts[hiIdx];
      for (const [loAtStart, loIdx] of [[true, 0], [false, lo.pts.length - 1]]) {
        const tLo = _outTan2DJS(lo.pts, loAtStart), pLo = lo.pts[loIdx];
        if (Math.hypot(pHi[0] - pLo[0], pHi[1] - pLo[1]) <= joinSnap && -(tHi[0] * tLo[0] + tHi[1] * tLo[1]) >= 0.68) {
          out.push({ hiAtStart, loAtStart, hiIdx, loIdx });
        }
      }
    }
    return out;
  };

  for (let i = 0; i < specs.length; i++) {
    const hi = specs[i];
    for (let j = 0; j < i; j++) {
      const lo = specs[j];
      const hitRad = Math.max(0.82, (hi.width + lo.width) * 0.54);
      for (const bj of findButtJoints(lo, hi, hitRad)) {
        const zJoin = Math.max(hi.zTopArr[bj.hiIdx], lo.zTopArr[bj.loIdx]);
        const dHi = zJoin - hi.zTopArr[bj.hiIdx], dLo = zJoin - lo.zTopArr[bj.loIdx];
        if (dHi > 0.01 && dHi < 2.5) {
          const rU = Math.min(hi.spanU * 0.32, Math.max(2.2, dHi * 6.0));
          for (let m = 0; m < hi.pts.length; m++) {
            const ds = bj.hiAtStart ? hi.sArr[m] : (hi.spanU - hi.sArr[m]);
            if (ds < rU) { const u = 1 - ds / rU, w = dHi * u * u * (3 - 2 * u); hi.zTopArr[m] += w; hi.zBotArr[m] += w; }
          }
        }
        if (dLo > 0.01 && dLo < 2.5) {
          const rU = Math.min(lo.spanU * 0.32, Math.max(2.2, dLo * 6.0));
          for (let m = 0; m < lo.pts.length; m++) {
            const ds = bj.loAtStart ? lo.sArr[m] : (lo.spanU - lo.sArr[m]);
            if (ds < rU) { const u = 1 - ds / rU, w = dLo * u * u * (3 - 2 * u); lo.zTopArr[m] += w; lo.zBotArr[m] += w; }
          }
        }
      }
    }
  }

  for (let i = 0; i < specs.length; i++) {
    const hi = specs[i];
    const combinedNeed = new Array(hi.pts.length).fill(0);
    for (let j = 0; j < i; j++) {
      const lo = specs[j];
      if (lo.deckLayer >= hi.deckLayer || hi.bbox[2] + 0.9 < lo.bbox[0] || hi.bbox[0] - 0.9 > lo.bbox[2] || hi.bbox[3] + 0.9 < lo.bbox[1] || hi.bbox[1] - 0.9 > lo.bbox[3]) continue;
      if ((lo.isAreaPoly && lo.osmId != null && hi.linkedPolyOsmIds && hi.linkedPolyOsmIds.includes(lo.osmId)) ||
          (hi.isAreaPoly && hi.osmId != null && lo.linkedPolyOsmIds && lo.linkedPolyOsmIds.includes(hi.osmId))) {
        continue;
      }
      const hitRad = Math.max(0.82, (hi.width + lo.width) * 0.54);
      const segRad = (hi.width + lo.width) * 0.54;
      const buttJoints = findButtJoints(lo, hi, hitRad);
      const jointZoneU = Math.max(2.4, (hi.width + lo.width) * 1.15);
      const isNearButtJoint = (sHi, sLo) => buttJoints.some(bj =>
        (bj.hiAtStart ? sHi : hi.spanU - sHi) <= jointZoneU &&
        (bj.loAtStart ? sLo : lo.spanU - sLo) <= jointZoneU
      );

      for (let k = 0; k < hi.pts.length; k++) {
        const hp = hi.pts[k], sHiK = hi.sArr[k];
        let reqBot = -Infinity;
        if (lo.isAreaPoly && _ptInRingJS(hp[0], hp[1], lo.outer)) {
          let nearZ = lo.zTopArr[0], nearD = Infinity, nearS = 0;
          for (let q = 0; q < lo.pts.length; q++) {
            const d = Math.hypot(hp[0] - lo.pts[q][0], hp[1] - lo.pts[q][1]);
            if (d < nearD) { nearD = d; nearZ = lo.zTopArr[q]; nearS = lo.sArr[q]; }
          }
          if (!isNearButtJoint(sHiK, nearS)) reqBot = Math.max(reqBot, nearZ + gapU);
        }
        for (let q = 0; q < lo.pts.length; q++) {
          if (!isNearButtJoint(sHiK, lo.sArr[q]) && Math.hypot(hp[0] - lo.pts[q][0], hp[1] - lo.pts[q][1]) <= hitRad) {
            reqBot = Math.max(reqBot, lo.zTopArr[q] + gapU);
          }
        }
        for (let q = 0; q < lo.pts.length - 1; q++) {
          const a = lo.pts[q], b = lo.pts[q + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
          const t = Math.max(0, Math.min(1, ((hp[0] - a[0]) * dx + (hp[1] - a[1]) * dy) / l2));
          const sLoT = lo.sArr[q] + Math.sqrt(l2) * t;
          if (!isNearButtJoint(sHiK, sLoT) && Math.hypot(hp[0] - (a[0] + dx * t), hp[1] - (a[1] + dy * t)) <= hitRad) {
            reqBot = Math.max(reqBot, lo.zTopArr[q] + (lo.zTopArr[q + 1] - lo.zTopArr[q]) * t + gapU);
          }
          if (k < hi.pts.length - 1) {
            const cp = _segClosestPair2DJS(hp, hi.pts[k + 1], a, b);
            const sHiCp = sHiK + (hi.sArr[k + 1] - sHiK) * cp.sA;
            const sLoCp = lo.sArr[q] + (lo.sArr[q + 1] - lo.sArr[q]) * cp.tB;
            if (!isNearButtJoint(sHiCp, sLoCp) && cp.dist <= segRad) {
              const loZ = lo.zTopArr[q] + (lo.zTopArr[q + 1] - lo.zTopArr[q]) * cp.tB + gapU;
              const hiBotAtS = hi.zBotArr[k] + (hi.zBotArr[k + 1] - hi.zBotArr[k]) * cp.sA;
              if (loZ > hiBotAtS) {
                combinedNeed[k] = Math.max(combinedNeed[k], loZ - hiBotAtS);
                combinedNeed[k + 1] = Math.max(combinedNeed[k + 1], loZ - hiBotAtS);
              }
            }
          }
        }
        if (reqBot > hi.zBotArr[k]) combinedNeed[k] = Math.max(combinedNeed[k], reqBot - hi.zBotArr[k]);
      }
    }
    if (combinedNeed.some(v => v > 0)) {
      _bridgeCorridorPlateausJS(hi.zBotArr, combinedNeed, hi.sArr, Math.max(2.0 / ctx.scaleMm, 45.0 * mToBedXY));
      _applyLocalSmoothLiftJS(hi.zTopArr, hi.zBotArr, hi.sArr, hi.spanU, combinedNeed, 4.5, false, false);
    }
  }
}

function solveBridgeGraph(scene, terrainWater, ctx) {
  const s2b = ctx.scaleToBed || 1.0;
  const mToBedZ = ctx.mToU * ctx.zScale * s2b;
  const { specs, groundRoads, rawSupports, mToBedXY, minDeckU } = _extractBridgeSpecsFromSceneJS(scene, terrainWater, ctx);

  const tinSampler = _buildTinSurfaceSamplerJS(terrainWater, ctx);
  const minDryReliefU = Math.max(terrainWater.hRoadU || 0.19, 0.45 / ctx.scaleMm, 0.18);
  const airClearWater = Math.max(0.32, 0.48 / ctx.scaleMm, minDeckU * 0.55);
  const baseLandClearU = Math.max(0.30, 0.48 / ctx.scaleMm, Math.min(1.15, 4.8 * mToBedZ));
  const params = { mToBedXY, mToBedZ, minDryReliefU, airClearWater, baseLandClearU };

  for (const sp of specs) {
    solveSingleBridgeElevationProfileJS(sp, groundRoads, tinSampler, terrainWater, ctx, params);
  }

  _weldSplitApproachesToAreaDecksJS(specs);
  solveMultiDeckClearancesJS(specs, ctx, mToBedXY, minDeckU);
  _attachExplicitSupportsToSpecsJS(specs, rawSupports, mToBedXY);
  return specs;
}

const _BRIDGE_MULTIDECK_EXPORTS = {
  _weldSplitApproachesToAreaDecksJS, solveMultiDeckClearancesJS, solveBridgeGraph
};
if (typeof globalThis !== 'undefined') Object.assign(globalThis, _BRIDGE_MULTIDECK_EXPORTS);
if (typeof window !== 'undefined') Object.assign(window, _BRIDGE_MULTIDECK_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _BRIDGE_MULTIDECK_EXPORTS;
