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

const _BRIDGE_SUPPORTS_EXPORTS = {
  _sidePtJS, _beamOverlapJS, _anchorFloorZJS, _computeAntiCapillarySamplesJS,
  _resolvePylonTopZJS, _addTwinOrPortalPylonJS, _extrudePylonOuterSolidJS, _addBridgeSupportSolidsJS
};
if (typeof globalThis !== 'undefined') Object.assign(globalThis, _BRIDGE_SUPPORTS_EXPORTS);
if (typeof window !== 'undefined') Object.assign(window, _BRIDGE_SUPPORTS_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _BRIDGE_SUPPORTS_EXPORTS;
