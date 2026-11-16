// ============================================================================
// src/mesh/bridges/bridge_multideck_solver.js
// Viaduct Y-Splits, Area Welding, Butt-Joints, Multi-Deck Clearance & Graph API
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

function _findCollinearButtJointsJS(lo, hi, scaleMm = 1.89) {
  const out = [];
  if (lo.isPierGangway || hi.isPierGangway) return out;
  if (Boolean(hi.isRail) !== Boolean(lo.isRail) || hi.deckLayer - lo.deckLayer !== 1) return out;
  const hitRad = Math.max(0.32 / scaleMm, (hi.width + lo.width) * 0.54);
  const hiMid = hi.pts[hi.pts.length >> 1];
  let minMidDist = Infinity;
  for (let q = 0; q < lo.pts.length; q++) {
    minMidDist = Math.min(minMidDist, Math.hypot(hiMid[0] - lo.pts[q][0], hiMid[1] - lo.pts[q][1]));
  }
  if (minMidDist <= hitRad * 1.4) return out;
  const joinSnap = Math.max(0.85 / scaleMm, (hi.width + lo.width) * 0.65);
  for (const [hiAtStart, hiIdx] of [[true, 0], [false, hi.pts.length - 1]]) {
    if (hiAtStart ? (hi.clippedStart || hi.joinPolyStart || hi.joinPierStart) : (hi.clippedEnd || hi.joinPolyEnd || hi.joinPierEnd)) continue;
    const tHi = _outTan2DJS(hi.pts, hiAtStart), pHi = hi.pts[hiIdx];
    for (const [loAtStart, loIdx] of [[true, 0], [false, lo.pts.length - 1]]) {
      if (loAtStart ? (lo.clippedStart || lo.joinPolyStart || lo.joinPierStart) : (lo.clippedEnd || lo.joinPolyEnd || lo.joinPierEnd)) continue;
      const tLo = _outTan2DJS(lo.pts, loAtStart), pLo = lo.pts[loIdx];
      if (Math.hypot(pHi[0] - pLo[0], pHi[1] - pLo[1]) <= joinSnap && -(tHi[0] * tLo[0] + tHi[1] * tLo[1]) >= 0.68) {
        out.push({ hiAtStart, loAtStart, hiIdx, loIdx });
      }
    }
  }
  return out;
}

function _detectViaductBranchJunctionsJS(specs, mToBedXY, scaleMm = 1.89) {
  for (let i = 0; i < specs.length; i++) {
    const hi = specs[i];
    if (hi.isAreaPoly || hi.isPierGangway) continue;
    for (let j = 0; j < specs.length; j++) {
      if (i === j) continue;
      const lo = specs[j];
      if (lo.isAreaPoly || lo.isPierGangway || hi.deckLayer - lo.deckLayer !== 1) continue;
      for (const bj of _findCollinearButtJointsJS(lo, hi, scaleMm)) {
        if (bj.hiAtStart && !hi.joinBridgeStart) hi.joinBridgeStart = { host: lo, uHost: bj.loAtStart ? 0 : 1, isButtJoint: true };
        if (!bj.hiAtStart && !hi.joinBridgeEnd) hi.joinBridgeEnd = { host: lo, uHost: bj.loAtStart ? 0 : 1, isButtJoint: true };
        if (bj.loAtStart && !lo.joinBridgeStart) lo.joinBridgeStart = { host: hi, uHost: bj.hiAtStart ? 0 : 1, isButtJoint: true };
        if (!bj.loAtStart && !lo.joinBridgeEnd) lo.joinBridgeEnd = { host: hi, uHost: bj.hiAtStart ? 0 : 1, isButtJoint: true };
      }
    }
  }

  const sArrList = specs.map(sp => {
    const cs = [0];
    for (let i = 1; i < sp.pts.length; i++) {
      cs.push(cs[i - 1] + Math.hypot(sp.pts[i][0] - sp.pts[i - 1][0], sp.pts[i][1] - sp.pts[i - 1][1]));
    }
    return cs;
  });
  const bbList = specs.map(sp => _bbox2DJS(sp.pts));

  for (let i = 0; i < specs.length; i++) {
    const sp = specs[i];
    if (sp.isAreaPoly || sp.isPierGangway) continue;
    const lenSp = sArrList[i][sArrList[i].length - 1];

    for (const [atStart, idx] of [[true, 0], [false, sp.pts.length - 1]]) {
      if (atStart
        ? (sp.clippedStart || sp.joinPolyStart || sp.joinPierStart || sp.joinBridgeStart)
        : (sp.clippedEnd || sp.joinPolyEnd || sp.joinPierEnd || sp.joinBridgeEnd)) {
        continue;
      }
      const ep = sp.pts[idx];
      const tSp = _outTan2DJS(sp.pts, atStart);
      let bestHost = null, bestRatio = 0, bestDist = Infinity;

      for (let j = 0; j < specs.length; j++) {
        if (i === j) continue;
        const host = specs[j];
        if (host.isAreaPoly || host.isPierGangway) continue;
        if (Boolean(sp.isRail) !== Boolean(host.isRail)) continue;
        if (Math.abs((sp.deckLayer ?? 1) - (host.deckLayer ?? 1)) > 1) continue;

        const juncRad = Math.max((sp.width + host.width) * 0.56, Math.min(0.65 / scaleMm, 4.0 * mToBedXY));
        const hbb = bbList[j];
        if (ep[0] < hbb[0] - juncRad || ep[0] > hbb[2] + juncRad || ep[1] < hbb[1] - juncRad || ep[1] > hbb[3] + juncRad) continue;
        const spMid = sp.pts[sp.pts.length >> 1];
        if (_ptToPolyDist2DJS(spMid[0], spMid[1], host.pts) <= Math.max((sp.width + host.width) * 0.85, juncRad * 1.35)) continue;

        const lenHost = sArrList[j][sArrList[j].length - 1];
        for (let q = 0; q < host.pts.length - 1; q++) {
          const a = host.pts[q], b = host.pts[q + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
          const t = Math.max(0, Math.min(1, ((ep[0] - a[0]) * dx + (ep[1] - a[1]) * dy) / l2));
          const d = Math.hypot(ep[0] - (a[0] + dx * t), ep[1] - (a[1] + dy * t));
          if (d > juncRad || d >= bestDist) continue;
          const dl = Math.sqrt(l2) || 1;
          const absDot = Math.abs(tSp[0] * (dx / dl) + tSp[1] * (dy / dl));
          if (absDot < 0.35) continue;

          const sHit = sArrList[j][q] + dl * t;
          const isHostInterior = sHit > Math.min(0.8 / scaleMm, lenHost * 0.06) && sHit < lenHost - Math.min(0.8 / scaleMm, lenHost * 0.06);
          if (!isHostInterior) {
            if ((sp.deckLayer ?? 1) !== (host.deckLayer ?? 1)) continue;
            if (lenHost < lenSp - 1e-4 || (Math.abs(lenHost - lenSp) <= 1e-4 && j < i)) continue;
          }
          bestDist = d;
          bestHost = host;
          bestRatio = Math.max(0, Math.min(1, sHit / Math.max(1e-5, lenHost)));
        }
      }

      if (bestHost) {
        if (atStart) sp.joinBridgeStart = { host: bestHost, uHost: bestRatio };
        else sp.joinBridgeEnd = { host: bestHost, uHost: bestRatio };
      }
    }
  }
}

function _weldBranchingViaductRampsJS(specs, scaleMm = 1.89) {
  for (let pass = 0; pass < 2; pass++) {
    for (const sp of specs) {
      if (sp.isAreaPoly || (!sp.joinBridgeStart && !sp.joinBridgeEnd)) continue;
      for (const [atStart, idx] of [[true, 0], [false, sp.pts.length - 1]]) {
        const jb = atStart ? sp.joinBridgeStart : sp.joinBridgeEnd;
        if (!jb || jb.isButtJoint || !jb.host || !jb.host.zTopArr) continue;
        const host = jb.host;
        const targetS = (jb.uHost ?? 0) * (host.spanU || 0);
        let k0 = 0;
        while (k0 < host.sArr.length - 2 && host.sArr[k0 + 1] < targetS) k0++;
        const seg = (host.sArr[k0 + 1] - host.sArr[k0]) || 1e-6;
        const f = Math.max(0, Math.min(1, (targetS - host.sArr[k0]) / seg));
        const hostTopZ = host.zTopArr[k0] + (host.zTopArr[k0 + 1] - host.zTopArr[k0]) * f;
        const dz = hostTopZ - sp.zTopArr[idx];
        const maxWeldDz = Math.max(3.5, 6.5 / scaleMm);
        if (Math.abs(dz) > 0.003 && Math.abs(dz) < maxWeldDz) {
          const otherPinned = atStart ? sp.pinEnd : sp.pinStart;
          const maxFrac = otherPinned ? 0.78 : 0.92;
          const rU = Math.min(sp.spanU * maxFrac, Math.max(1.4 / scaleMm, Math.abs(dz) * 7.5));
          for (let m = 0; m < sp.pts.length; m++) {
            const ds = atStart ? sp.sArr[m] : (sp.spanU - sp.sArr[m]);
            if (ds < rU) {
              const u = 1.0 - ds / Math.max(1e-5, rU);
              const w = dz * u * u * (3.0 - 2.0 * u);
              sp.zTopArr[m] += w;
              sp.zBotArr[m] += w;
            }
          }
        }
      }
    }
  }
}

function _weldSplitApproachesToAreaDecksJS(specs, scaleMm = 1.89) {
  const areaSpecs = specs.filter(s => s.isAreaPoly && s.outer && s.outer.length >= 3);
  if (areaSpecs.length === 0) return;
  const searchTol = Math.max(0.8, 1.5 / scaleMm);
  const maxWeldDz = Math.max(3.5, 6.5 / scaleMm);
  for (const sp of specs) {
    if (sp.isAreaPoly || (!sp.joinPolyStart && !sp.joinPolyEnd)) continue;
    for (const [atStart, idx] of [[true, 0], [false, sp.pts.length - 1]]) {
      if (atStart ? !sp.joinPolyStart : !sp.joinPolyEnd) continue;
      const ep = sp.pts[idx];
      const targetArea = areaSpecs.find(as => _ptInRingJS(ep[0], ep[1], as.outer)) ||
        areaSpecs.find(as => typeof _ptToPolyDist2DJS === 'function' && _ptToPolyDist2DJS(ep[0], ep[1], as.outer.concat([as.outer[0]])) <= searchTol);
      if (!targetArea) continue;
      let nearZ = targetArea.zTopArr[0], nearD = Infinity;
      for (let q = 0; q < targetArea.pts.length; q++) {
        const d = Math.hypot(ep[0] - targetArea.pts[q][0], ep[1] - targetArea.pts[q][1]);
        if (d < nearD) { nearD = d; nearZ = targetArea.zTopArr[q]; }
      }
      const dz = nearZ - sp.zTopArr[idx];
      if (Math.abs(dz) > 0.003 && Math.abs(dz) < maxWeldDz) {
        const otherPinned = atStart ? sp.pinEnd : sp.pinStart;
        const rU = Math.min(sp.spanU * (otherPinned ? 0.65 : 0.85), Math.max(1.4 / scaleMm, Math.abs(dz) * 6.5));
        for (let m = 0; m < sp.pts.length; m++) {
          const ds = atStart ? sp.sArr[m] : (sp.spanU - sp.sArr[m]);
          if (ds < rU) { const u = 1 - ds / rU, w = dz * u * u * (3 - 2 * u); sp.zTopArr[m] += w; sp.zBotArr[m] += w; }
        }
      }
    }
  }
}

function solveMultiDeckClearancesJS(specs, ctx, mToBedXY, minDeckU, mToBedZ) {
  const scaleMm = ctx.scaleMm || 1.89;
  specs.sort((a, b) => a.deckLayer - b.deckLayer);
  const gapU = Math.max(0.50 / scaleMm, minDeckU * 0.55, Math.min(1.6 / scaleMm, 4.2 * (mToBedZ || mToBedXY)));

  for (let i = 0; i < specs.length; i++) {
    const hi = specs[i];
    for (let j = 0; j < i; j++) {
      const lo = specs[j];
      for (const bj of _findCollinearButtJointsJS(lo, hi, scaleMm)) {
        if (bj.hiAtStart && !hi.joinBridgeStart) hi.joinBridgeStart = { host: lo, uHost: bj.loAtStart ? 0 : 1, isButtJoint: true };
        if (!bj.hiAtStart && !hi.joinBridgeEnd) hi.joinBridgeEnd = { host: lo, uHost: bj.loAtStart ? 0 : 1, isButtJoint: true };
        if (bj.loAtStart && !lo.joinBridgeStart) lo.joinBridgeStart = { host: hi, uHost: bj.hiAtStart ? 0 : 1, isButtJoint: true };
        if (!bj.loAtStart && !lo.joinBridgeEnd) lo.joinBridgeEnd = { host: hi, uHost: bj.hiAtStart ? 0 : 1, isButtJoint: true };
      }
    }
  }

  const bboxPad = Math.min(0.9, 1.6 / scaleMm);
  for (let i = 0; i < specs.length; i++) {
    const hi = specs[i];
    if (hi.isPierGangway) continue;
    const combinedNeed = new Array(hi.pts.length).fill(0);
    for (let j = 0; j < i; j++) {
      const lo = specs[j];
      if (lo.isPierGangway) continue;
      if (lo.deckLayer >= hi.deckLayer || hi.bbox[2] + bboxPad < lo.bbox[0] || hi.bbox[0] - bboxPad > lo.bbox[2] || hi.bbox[3] + bboxPad < lo.bbox[1] || hi.bbox[1] - bboxPad > lo.bbox[3]) continue;
      if ((lo.isAreaPoly && lo.osmId != null && hi.linkedPolyOsmIds && hi.linkedPolyOsmIds.includes(lo.osmId)) ||
          (hi.isAreaPoly && hi.osmId != null && lo.linkedPolyOsmIds && lo.linkedPolyOsmIds.includes(hi.osmId))) {
        continue;
      }
      const hitRad = Math.max(0.28 / scaleMm, (hi.width + lo.width) * 0.54);
      const segRad = (hi.width + lo.width) * 0.54;
      const buttJoints = _findCollinearButtJointsJS(lo, hi, scaleMm);
      const jointZoneU = Math.max(2.0 / scaleMm, (hi.width + lo.width) * 1.25);

      const branchZones = [];
      if (lo.joinBridgeStart && lo.joinBridgeStart.host === hi) branchZones.push({ sHi: lo.joinBridgeStart.uHost * hi.spanU, loAtStart: true });
      if (lo.joinBridgeEnd && lo.joinBridgeEnd.host === hi) branchZones.push({ sHi: lo.joinBridgeEnd.uHost * hi.spanU, loAtStart: false });
      if (hi.joinBridgeStart && hi.joinBridgeStart.host === lo) branchZones.push({ sHi: 0, sLoFixed: hi.joinBridgeStart.uHost * lo.spanU });
      if (hi.joinBridgeEnd && hi.joinBridgeEnd.host === lo) branchZones.push({ sHi: hi.spanU, sLoFixed: hi.joinBridgeEnd.uHost * lo.spanU });

      const isNearSharedJoint = (sHi, sLo) => {
        if (buttJoints.some(bj => (bj.hiAtStart ? sHi : hi.spanU - sHi) <= jointZoneU && (bj.loAtStart ? sLo : lo.spanU - sLo) <= jointZoneU)) {
          return true;
        }
        for (const bz of branchZones) {
          if (Math.abs(sHi - bz.sHi) > jointZoneU * 1.25) continue;
          if (bz.sLoFixed !== undefined) {
            if (Math.abs(sLo - bz.sLoFixed) <= jointZoneU * 1.25) return true;
          } else if ((bz.loAtStart ? sLo : lo.spanU - sLo) <= jointZoneU * 1.25) {
            return true;
          }
        }
        return false;
      };

      for (let k = 0; k < hi.pts.length; k++) {
        const hp = hi.pts[k], sHiK = hi.sArr[k];
        let reqBot = -Infinity;
        if (lo.isAreaPoly && _ptInRingJS(hp[0], hp[1], lo.outer)) {
          let nearZ = lo.zTopArr[0], nearD = Infinity, nearS = 0;
          for (let q = 0; q < lo.pts.length; q++) {
            const d = Math.hypot(hp[0] - lo.pts[q][0], hp[1] - lo.pts[q][1]);
            if (d < nearD) { nearD = d; nearZ = lo.zTopArr[q]; nearS = lo.sArr[q]; }
          }
          if (!isNearSharedJoint(sHiK, nearS)) reqBot = Math.max(reqBot, nearZ + gapU);
        }
        for (let q = 0; q < lo.pts.length; q++) {
          if (!isNearSharedJoint(sHiK, lo.sArr[q]) && Math.hypot(hp[0] - lo.pts[q][0], hp[1] - lo.pts[q][1]) <= hitRad) {
            reqBot = Math.max(reqBot, lo.zTopArr[q] + gapU);
          }
        }
        for (let q = 0; q < lo.pts.length - 1; q++) {
          const a = lo.pts[q], b = lo.pts[q + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
          const t = Math.max(0, Math.min(1, ((hp[0] - a[0]) * dx + (hp[1] - a[1]) * dy) / l2));
          const sLoT = lo.sArr[q] + Math.sqrt(l2) * t;
          if (!isNearSharedJoint(sHiK, sLoT) && Math.hypot(hp[0] - (a[0] + dx * t), hp[1] - (a[1] + dy * t)) <= hitRad) {
            reqBot = Math.max(reqBot, lo.zTopArr[q] + (lo.zTopArr[q + 1] - lo.zTopArr[q]) * t + gapU);
          }
          if (k < hi.pts.length - 1) {
            const cp = _segClosestPair2DJS(hp, hi.pts[k + 1], a, b);
            const sHiCp = sHiK + (hi.sArr[k + 1] - sHiK) * cp.sA;
            const sLoCp = lo.sArr[q] + (lo.sArr[q + 1] - lo.sArr[q]) * cp.tB;
            if (!isNearSharedJoint(sHiCp, sLoCp) && cp.dist <= segRad) {
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
    hi._clearNeedArr = combinedNeed;
    if (combinedNeed.some(v => v > 0)) {
      _bridgeCorridorPlateausJS(hi.zBotArr, combinedNeed, hi.sArr, Math.max(2.0 / scaleMm, 45.0 * mToBedXY));
      const endGuardU = Math.min(hi.spanU * 0.14, 1.2 / scaleMm);
      const pinHiA = Boolean(hi.pinStart && !hi.joinBridgeStart && !combinedNeed.some((v, idx) => v > 0 && hi.sArr[idx] <= endGuardU));
      const pinHiB = Boolean(hi.pinEnd && !hi.joinBridgeEnd && !combinedNeed.some((v, idx) => v > 0 && (hi.spanU - hi.sArr[idx]) <= endGuardU));
      const hasButtEnd = Boolean((hi.joinBridgeStart && hi.joinBridgeStart.isButtJoint) || (hi.joinBridgeEnd && hi.joinBridgeEnd.isButtJoint));
      const baseRampU = Math.min(hi.spanU * (hasButtEnd ? 0.46 : 0.36), Math.max(2.2 / scaleMm, (hasButtEnd ? 45.0 : 35.0) * mToBedXY));
      _applyLocalSmoothLiftJS(hi.zTopArr, hi.zBotArr, hi.sArr, hi.spanU, combinedNeed, baseRampU, pinHiA, pinHiB, scaleMm);
    }
  }

  const maxWeldDz = Math.max(4.0, 7.5 / scaleMm);
  for (let i = 0; i < specs.length; i++) {
    const hi = specs[i];
    for (let j = 0; j < i; j++) {
      const lo = specs[j];
      for (const bj of _findCollinearButtJointsJS(lo, hi, scaleMm)) {
        const hiZ = hi.zTopArr[bj.hiIdx], loZ = lo.zTopArr[bj.loIdx];
        if (Math.abs(hiZ - loZ) >= maxWeldDz) continue;
        let zJoin = Math.max(hiZ, loZ);
        let hiDownSpan = 0;
        if (!hi.isAreaPoly && !lo.isAreaPoly && hiZ > loZ + 0.004) {
          let clearDistHi = Infinity;
          if (hi._clearNeedArr) {
            for (let k = 0; k < hi.pts.length; k++) {
              if (hi._clearNeedArr[k] > 0) {
                const ds = bj.hiAtStart ? hi.sArr[k] : (hi.spanU - hi.sArr[k]);
                if (ds < clearDistHi) clearDistHi = ds;
              }
            }
          }
          if (clearDistHi > 1.2 / scaleMm) {
            const loOtherPinned = bj.loAtStart ? lo.pinEnd : lo.pinStart;
            const loCap = lo.spanU * (loOtherPinned ? 0.78 : 0.90);
            hiDownSpan = Math.min(clearDistHi * 0.72, hi.spanU * 0.36);
            const shareHi = Math.min(0.36, hiDownSpan / Math.max(1e-4, hiDownSpan + loCap));
            zJoin = hiZ - (hiZ - loZ) * shareHi;
          }
        }

        const dHi = zJoin - hiZ, dLo = zJoin - loZ;
        if (Math.abs(dHi) > 0.003) {
          const rU = dHi < 0
            ? hiDownSpan
            : Math.min(hi.spanU * 0.42, Math.max(1.8 / scaleMm, dHi * 6.5));
          if (rU > 1e-4) {
            for (let m = 0; m < hi.pts.length; m++) {
              const ds = bj.hiAtStart ? hi.sArr[m] : (hi.spanU - hi.sArr[m]);
              if (ds < rU) { const u = 1 - ds / rU, w = dHi * u * u * (3 - 2 * u); hi.zTopArr[m] += w; hi.zBotArr[m] += w; }
            }
          }
        }
        if (Math.abs(dLo) > 0.003) {
          const loOtherPinned = bj.loAtStart ? lo.pinEnd : lo.pinStart;
          const maxLoFrac = (lo.isAreaPoly || hi.isAreaPoly) ? 0.42 : (loOtherPinned ? 0.80 : 0.92);
          const rU = Math.min(lo.spanU * maxLoFrac, Math.max(1.8 / scaleMm, Math.abs(dLo) * 8.0));
          for (let m = 0; m < lo.pts.length; m++) {
            const ds = bj.loAtStart ? lo.sArr[m] : (lo.spanU - lo.sArr[m]);
            if (ds < rU) { const u = 1 - ds / rU, w = dLo * u * u * (3 - 2 * u); lo.zTopArr[m] += w; lo.zBotArr[m] += w; }
          }
        }
      }
    }
  }
}

function solveBridgeGraph(scene, terrainWater, ctx) {
  const s2b = ctx.scaleToBed || 1.0;
  const scaleMm = ctx.scaleMm || 1.89;
  const mToBedZ = ctx.mToU * ctx.zScale * s2b;
  const { specs, groundRoads, rawSupports, mToBedXY, minDeckU } = _extractBridgeSpecsFromSceneJS(scene, terrainWater, ctx);

  _detectViaductBranchJunctionsJS(specs, mToBedXY, scaleMm);

  const tinSampler = _buildTinSurfaceSamplerJS(terrainWater, ctx);
  const minDryReliefU = Math.max(terrainWater.hRoadU || (0.567 / scaleMm), 0.45 / scaleMm);
  const airClearWater = Math.max(0.48 / scaleMm, minDeckU * 0.58, Math.min(0.62 / scaleMm, 2.6 * mToBedZ));
  const baseLandClearU = Math.max(0.52 / scaleMm, minDeckU * 0.65, Math.min(2.2 / scaleMm, 4.8 * mToBedZ));
  const params = { mToBedXY, mToBedZ, minDryReliefU, airClearWater, baseLandClearU };

  for (const sp of specs) {
    solveSingleBridgeElevationProfileJS(sp, groundRoads, tinSampler, terrainWater, ctx, params);
  }

  _weldSplitApproachesToAreaDecksJS(specs, scaleMm);
  _weldBranchingViaductRampsJS(specs, scaleMm);
  solveMultiDeckClearancesJS(specs, ctx, mToBedXY, minDeckU, mToBedZ);
  _weldSplitApproachesToAreaDecksJS(specs, scaleMm);
  _weldBranchingViaductRampsJS(specs, scaleMm);
  _attachExplicitSupportsToSpecsJS(specs, rawSupports, mToBedXY, scaleMm);
  return specs;
}

const _BRIDGE_MULTIDECK_EXPORTS = {
  _detectViaductBranchJunctionsJS, _weldBranchingViaductRampsJS,
  _weldSplitApproachesToAreaDecksJS, solveMultiDeckClearancesJS, solveBridgeGraph
};
if (typeof globalThis !== 'undefined') Object.assign(globalThis, _BRIDGE_MULTIDECK_EXPORTS);
if (typeof window !== 'undefined') Object.assign(window, _BRIDGE_MULTIDECK_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _BRIDGE_MULTIDECK_EXPORTS;
