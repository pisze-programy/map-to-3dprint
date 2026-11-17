// ============================================================================
// src/mesh/bridges/bridge_supports_solver.js
// OSM bridge:support Piers, Twin/Portal/Polygon Pylons & Synthetic Span Piers
// ============================================================================

if (typeof _lerpArrAtSJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(globalThis, require('./bridge_deck_builder.js'));
}

function _sidePtJS(pt, tx, ty, offset, z) { return [pt[0] - ty * offset, pt[1] + tx * offset, z]; }

function _beamOverlapJS(mf, p0, p1, radius) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2], l = Math.hypot(dx, dy, dz);
  if (l < 1e-4 || radius < 1e-4) return null;
  const ext = Math.min(radius * 0.45, l * 0.15) / l;
  return beamManifoldBetween(mf, [p0[0] - dx * ext, p0[1] - dy * ext, p0[2] - dz * ext], [p1[0] + dx * ext, p1[1] + dy * ext, p1[2] + dz * ext], radius);
}

function _anchorFloorZJS(x, y, terrainWater, ctx) {
  const scaleMm = ctx.scaleMm || 1.89;
  if (terrainWater.isPointInWater(x, y)) return ctx.waterCutout ? 0.0 : Math.max(0.0, terrainWater.getWaterFloorZ(x, y) - Math.min(0.35, 0.50 / scaleMm));
  return Math.max(0.0, terrainWater.getSurfaceZ(x, y) - Math.min(0.55, 0.85 / scaleMm));
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
    aboveU = Math.max(minAboveU, rawU > valleyH * 1.15 ? rawU - valleyH : rawU);
  }
  const capU = Math.min(ctx.maxZUnits - zDeckTop - 0.45 / ctx.scaleMm, Math.max(minAboveU, Math.min(aboveU, Math.max(spec.spanU * 0.42, 34 / ctx.scaleMm))));
  return zDeckTop + Math.max(minAboveU, capU);
}

function _addTwinOrPortalPylonJS(parts, pt, tx, ty, halfW, zFloor, zDeckBot, zDeckTop, zPylonTop, shaftR, mf, scaleMm = 1.89) {
  const lat = Math.max(halfW * 0.88, shaftR * 1.4), L = _sidePtJS(pt, tx, ty, lat, 0), R = _sidePtJS(pt, tx, ty, -lat, 0);
  const baseCapZ = Math.min(zDeckTop - 0.06 / scaleMm, zDeckBot + Math.min(0.10, (zDeckTop - zDeckBot) * 0.45));
  const baseBox = baseCapZ > zFloor + 0.02
    ? beamManifoldBetween(mf, [pt[0], pt[1], zFloor], [pt[0], pt[1], baseCapZ], Math.min(halfW * 0.68, shaftR * 1.55))
    : null;
  const shL = beamManifoldBetween(mf, [L[0], L[1], zFloor], [L[0], L[1], zPylonTop], shaftR);
  const shR = beamManifoldBetween(mf, [R[0], R[1], zFloor], [R[0], R[1], zPylonTop], shaftR);
  const tieTop = _beamOverlapJS(mf, [L[0], L[1], zPylonTop - shaftR * 1.1], [R[0], R[1], zPylonTop - shaftR * 1.1], shaftR * 0.9);
  const tieSubR = Math.min(shaftR * 0.85, Math.max(0.20 / scaleMm, (zDeckTop - zFloor) * 0.18));
  const tieSubZ = Math.min(zDeckBot, zDeckTop - tieSubR - 0.06 / scaleMm);
  const tieSub = tieSubZ > zFloor + tieSubR ? _beamOverlapJS(mf, [L[0], L[1], tieSubZ], [R[0], R[1], tieSubZ], tieSubR) : null;
  for (const m of [baseBox, shL, shR, tieTop, tieSub]) if (m) parts.push(m);
}

function _extrudePylonOuterSolidJS(mf, outer, pt, tx, ty, halfW, zFloor, zTop, zPylonTop, ctx) {
  const scaleMm = ctx.scaleMm || 1.89;
  const latSpan = (r) => { let lo = Infinity, hi = -Infinity; for (const p of r) { const l = -ty * (p[0] - pt[0]) + tx * (p[1] - pt[1]); if (l < lo) lo = l; if (l > hi) hi = l; } return [lo, hi]; };
  let ring = outer, [latMin, latMax] = latSpan(ring);
  const obb = typeof computeMinAreaOBB2D === 'function' ? computeMinAreaOBB2D(ring) : null;
  const minorU = obb && Number.isFinite(obb.halfW) ? obb.halfW * 2 : (latMax - latMin);
  const minPinU = (ctx.slaLaws || SLA_PRINT_LAWS).minPinDiameterMm(Math.max(0, (zPylonTop - zTop) * scaleMm)) / scaleMm;
  if (minorU < minPinU && typeof clipperOffsetPolys === 'function') {
    const offs = clipperOffsetPolys([ring], (minPinU - minorU) * 0.5, 'Round');
    if (offs && offs.length && offs[0].length >= 3) { ring = offs[0]; [latMin, latMax] = latSpan(ring); }
  }
  let solid = extrudeRingSolid(mf, ring, [], zFloor, zPylonTop);
  if (!solid) return null;

  // Carve roadway portal cutout if the pylon footprint spans laterally across the bridge deck
  const spansAcrossDeck = latMin < -halfW * 0.42 && latMax > halfW * 0.42 && (latMax - latMin) > halfW * 1.35;
  if (spansAcrossDeck && zPylonTop > zTop + 1.2 / scaleMm) {
    const wallKeep = Math.max(0.32 / scaleMm, (latMax - latMin) * 0.16);
    const cutHalfW = Math.min(halfW * 0.88, (latMax - latMin) * 0.5 - wallKeep);
    const zPortalTop = Math.min(zPylonTop - Math.max(0.45 / scaleMm, wallKeep), zTop + Math.max(0.9 / scaleMm, (zPylonTop - zTop) * 0.62));
    if (cutHalfW > 0.20 / scaleMm && zPortalTop > zTop + 0.45 / scaleMm) {
      const lenCut = Math.max(halfW * 4.0, minorU * 3.0 + 2.0);
      const nx = -ty, ny = tx;
      const cutRing = [
        [pt[0] - tx * lenCut - nx * cutHalfW, pt[1] - ty * lenCut - ny * cutHalfW],
        [pt[0] + tx * lenCut - nx * cutHalfW, pt[1] + ty * lenCut - ny * cutHalfW],
        [pt[0] + tx * lenCut + nx * cutHalfW, pt[1] + ty * lenCut + ny * cutHalfW],
        [pt[0] - tx * lenCut + nx * cutHalfW, pt[1] - ty * lenCut + ny * cutHalfW]
      ];
      const portalCut = extrudeRingSolid(mf, cutRing, [], zTop - 0.02 / scaleMm, zPortalTop);
      if (portalCut) {
        try {
          const carved = solid.subtract(portalCut);
          portalCut.delete();
          if (carved && carved.numTri() > 0) { solid.delete(); solid = carved; }
          else if (carved) carved.delete();
        } catch (_) { portalCut.delete(); }
      }
    }
  }

  return { solid, latMin, latMax, cLat: (latMin + latMax) * 0.5, isCentral: (latMax - latMin) < halfW * 1.15 };
}

function _addBridgeSupportSolidsJS(spec, terrainWater, ctx, strutRU, parts, supportStationsS, pylonStations, metrics) {
  const mf = ctx.mf, halfW = spec.width * 0.5, scaleMm = ctx.scaleMm || 1.89;
  const minColR = Math.max(strutRU * 1.15, Math.min(halfW * 0.25, 0.45 / scaleMm));
  const shaftR = Math.max(strutRU * 1.35, Math.min(halfW * 0.28, 0.85 / scaleMm));
  const capAt = (sVal, rVal) => (typeof _safeSubDeckCapZJS === 'function')
    ? _safeSubDeckCapZJS(spec, sVal, rVal, scaleMm)
    : (_lerpArrAtSJS(spec.sArr, spec.zBotArr, sVal) + Math.min(spec.deckThick * 0.4, 0.12 / scaleMm));

  for (const sup of spec.explicitSupports) {
    const sPos = sup.sProj, { pt, tx, ty } = _samplePtAtSJS(spec, sPos);
    const zBot = _lerpArrAtSJS(spec.sArr, spec.zBotArr, sPos), zTop = _lerpArrAtSJS(spec.sArr, spec.zTopArr, sPos);
    const zFloor = _anchorFloorZJS(sup.pt[0], sup.pt[1], terrainWater, ctx);
    metrics.pierMinZ = Math.min(metrics.pierMinZ, zFloor); metrics.explicitSupportsUsed++;
    if (sup.kind === 'pylon') {
      const zPylonTop = _resolvePylonTopZJS(spec, zTop, zFloor, sup.heightM, ctx);
      const pyOut = (sup.outer && sup.outer.length >= 3) ? _extrudePylonOuterSolidJS(mf, sup.outer, pt, tx, ty, halfW, zFloor, zTop, zPylonTop, ctx) : null;
      if (pyOut) { parts.push(pyOut.solid); pylonStations.push({ s: sPos, pt, tx, ty, zTop, zPylonTop, ...pyOut }); }
      else { _addTwinOrPortalPylonJS(parts, pt, tx, ty, halfW, zFloor, zBot, zTop, zPylonTop, shaftR, mf, scaleMm); pylonStations.push({ s: sPos, pt, tx, ty, zTop, zPylonTop, isCentral: false }); }
      supportStationsS.push(sPos);
    } else {
      const colR = (ctx.waterCutout && terrainWater.isPointInWater(sup.pt[0], sup.pt[1])) ? minColR * 1.25 : minColR;
      let capSpanU = colR;
      if (sup.outer && sup.outer.length >= 3) {
        for (const op of sup.outer) {
          const dAlong = Math.abs(tx * (op[0] - pt[0]) + ty * (op[1] - pt[1]));
          if (dAlong > capSpanU) capSpanU = dAlong;
        }
      }
      const zCap = capAt(sPos, capSpanU);
      if (zCap > zFloor + 0.02 / scaleMm) {
        const m = (sup.outer && sup.outer.length >= 3)
          ? extrudeRingSolid(mf, sup.outer, [], zFloor, zCap)
          : beamManifoldBetween(mf, [sup.pt[0], sup.pt[1], zFloor], [sup.pt[0], sup.pt[1], zCap], colR);
        if (m) parts.push(m);
      }
      supportStationsS.push(sPos);
    }
  }

  if (spec.isPierGangway && spec.spanU * scaleMm <= 6.5) return;

  const mToBedXY = Math.max(1e-5, (ctx.mToU || 0.1) * (ctx.scaleToBed || 1.0));
  const spanMetersEst = spec.spanU / mToBedXY;
  const isShortDryCableApproach = (spec.structNorm === 'cable-stayed' || spec.structNorm === 'suspension') &&
    !pylonStations.length && !spec.crossesWater && spanMetersEst < 110.0;
  const isDryMultiBayArchViaduct = spec.structNorm === 'arch' && !spec.crossesWater && !spec.explicitThroughArch && spanMetersEst > 85.0;
  const channelProtected = ['arch', 'suspension', 'cable-stayed', 'truss'].includes(spec.structNorm) && !isShortDryCableApproach && !isDryMultiBayArchViaduct;
  if (!spec.explicitSupports.length && spec.structNorm === 'floating') {
    for (let i = 0; i < spec.pts.length - 1; i++) {
      if (!spec.inWater[i] && !spec.inWater[i + 1]) continue;
      const a = spec.pts[i], b = spec.pts[i + 1];
      const zB = ctx.waterCutout ? 0.0 : Math.max(0.0, ctx.zWaterTop - Math.min(0.35, 0.50 / scaleMm));
      const zT = Math.min(
        Math.min(spec.zTopArr[i], spec.zTopArr[i + 1]) - 0.05 / scaleMm,
        Math.min(spec.zBotArr[i], spec.zBotArr[i + 1]) + Math.min(spec.deckThick * 0.45, 0.15 / scaleMm)
      );
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
      if (l < 0.03 / scaleMm || zT <= zB + 0.03 / scaleMm) continue;
      const nx = (-dy / l) * Math.max(minColR, halfW * 0.72), ny = (dx / l) * Math.max(minColR, halfW * 0.72);
      const pm = extrudeRingSolid(mf, [[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]], [], zB, zT);
      if (pm) parts.push(pm);
    }
  } else if (!channelProtected && spec.structNorm !== 'floating' && spec.spanU > 3.6 / scaleMm) {
    const step = isDryMultiBayArchViaduct
      ? Math.max(4.5 / scaleMm, Math.min(45.0 * mToBedXY, spec.spanU / 3))
      : Math.max(3.2 / scaleMm, spec.width * 2.3);
    for (let s = step; s < spec.spanU - step * 0.45; s += step) {
      if (spec.explicitSupports.some(es => Math.abs(es.sProj - s) < step * 0.72)) continue;
      const { pt } = _samplePtAtSJS(spec, s), zFloor = _anchorFloorZJS(pt[0], pt[1], terrainWater, ctx);
      const inWater = terrainWater.isPointInWater(pt[0], pt[1]);
      const colR = Math.min(halfW * 0.44, (ctx.waterCutout && inWater) ? minColR * 1.25 : minColR);
      const zCap = capAt(s, colR);
      if (zCap <= zFloor + 0.04 / scaleMm) continue;
      if (inWater) metrics.syntheticWaterPiers++;
      metrics.pierMinZ = Math.min(metrics.pierMinZ, zFloor);
      const col = beamManifoldBetween(mf, [pt[0], pt[1], zFloor], [pt[0], pt[1], zCap], colR);
      if (col) parts.push(col);
      supportStationsS.push(s);
    }
  }
}

const _BRIDGE_SUPPORTS_EXPORTS = {
  _sidePtJS, _beamOverlapJS, _anchorFloorZJS, _computeAntiCapillarySamplesJS,
  _resolvePylonTopZJS, _addTwinOrPortalPylonJS, _extrudePylonOuterSolidJS, _addBridgeSupportSolidsJS
};
if (typeof globalThis !== 'undefined') Object.assign(globalThis, _BRIDGE_SUPPORTS_EXPORTS);
if (typeof window !== 'undefined') Object.assign(window, _BRIDGE_SUPPORTS_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _BRIDGE_SUPPORTS_EXPORTS;
