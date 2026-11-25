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

function _collectInsideBedSpansJS(pts, sArr, bedHalfW, bedHalfH) {
  const spans = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const s0 = sArr[i], s1 = sArr[i + 1], ds = s1 - s0;
    if (ds <= 1e-8) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const ts = [0, 1];
    if (Math.abs(dx) > 1e-9) {
      const tPos = (bedHalfW - a[0]) / dx;
      const tNeg = (-bedHalfW - a[0]) / dx;
      if (tPos > 1e-5 && tPos < 1 - 1e-5) ts.push(tPos);
      if (tNeg > 1e-5 && tNeg < 1 - 1e-5) ts.push(tNeg);
    }
    if (Math.abs(dy) > 1e-9) {
      const tPos = (bedHalfH - a[1]) / dy;
      const tNeg = (-bedHalfH - a[1]) / dy;
      if (tPos > 1e-5 && tPos < 1 - 1e-5) ts.push(tPos);
      if (tNeg > 1e-5 && tNeg < 1 - 1e-5) ts.push(tNeg);
    }
    ts.sort((u, v) => u - v);
    for (let k = 0; k < ts.length - 1; k++) {
      const tA = ts[k], tB = ts[k + 1];
      if (tB - tA <= 1e-5) continue;
      const tm = 0.5 * (tA + tB);
      const xm = a[0] + dx * tm, ym = a[1] + dy * tm;
      const inBed = Math.abs(xm) < bedHalfW && Math.abs(ym) < bedHalfH;
      const subA = s0 + ds * tA, subB = s0 + ds * tB;
      if (spans.length && spans[spans.length - 1].inBed === inBed) {
        spans[spans.length - 1].sB = subB;
      } else {
        spans.push({ sA: subA, sB: subB, inBed });
      }
    }
  }
  return spans;
}

function _addBorderCrossingStationsJS(spec, ctx, scaleMm, pierStationsS) {
  if (!Number.isFinite(ctx.halfW) || !Number.isFinite(ctx.halfH)) return;
  if (!Array.isArray(spec.pts) || spec.pts.length < 2 || !Array.isArray(spec.sArr) || spec.sArr.length !== spec.pts.length) return;
  const clampMin = 0.25 / scaleMm, clampMax = spec.spanU - 0.25 / scaleMm;
  if (clampMin >= clampMax) return;

  // Add piers inside the bed at border crossings so clipped stubs do not cantilever.
  const spans = _collectInsideBedSpansJS(spec.pts, spec.sArr, ctx.halfW, ctx.halfH);
  const insetU = Math.min(spec.spanU * 0.15, 0.55 / scaleMm);
  const minSepU = 1.2 / scaleMm;
  const candidates = [];
  for (let idx = 0; idx < spans.length; idx++) {
    const spn = spans[idx];
    if (!spn.inBed) continue;
    const localInset = Math.min(insetU, (spn.sB - spn.sA) * 0.5);
    if (idx > 0) candidates.push(spn.sA + localInset);
    if (idx < spans.length - 1) candidates.push(spn.sB - localInset);
  }
  for (const rawS of candidates) {
    const sCand = Math.max(clampMin, Math.min(clampMax, rawS));
    const { pt } = _samplePtAtSJS(spec, sCand);
    if (Math.abs(pt[0]) >= ctx.halfW || Math.abs(pt[1]) >= ctx.halfH) continue;
    if (pierStationsS.some(ps => Math.abs(ps - sCand) < minSepU)) continue;
    const nearExplicit = spec.explicitSupports.some(es => {
      if (es.pt && (Math.abs(es.pt[0]) >= ctx.halfW || Math.abs(es.pt[1]) >= ctx.halfH)) return false;
      return Math.abs(es.sProj - sCand) < minSepU;
    });
    if (!nearExplicit) pierStationsS.push(sCand);
  }
}

function _collectSeamCrossingStationsJS(spec, ctx, scaleMm, terrainWater, existingS) {
  const cutXs = Array.isArray(ctx && ctx.cutXs) ? ctx.cutXs : [];
  const cutYs = Array.isArray(ctx && ctx.cutYs) ? ctx.cutYs : [];
  if (cutXs.length === 0 && cutYs.length === 0) return [];
  if (!ctx || !ctx.waterCutout) return [];
  if (!Array.isArray(spec.pts) || spec.pts.length < 2 || !Array.isArray(spec.sArr) || spec.sArr.length !== spec.pts.length) return [];

  const crossings = [];
  for (let i = 0; i < spec.pts.length - 1; i++) {
    const a = spec.pts[i], b = spec.pts[i + 1];
    const s0 = spec.sArr[i], s1 = spec.sArr[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.abs(dx) > 1e-9) {
      for (let ci = 0; ci < cutXs.length; ci++) {
        const cx = cutXs[ci];
        if ((a[0] <= cx && b[0] >= cx) || (a[0] >= cx && b[0] <= cx)) {
          const t = Math.max(0, Math.min(1, (cx - a[0]) / dx));
          crossings.push({ s: s0 + t * (s1 - s0), axis: 'x' });
        }
      }
    }
    if (Math.abs(dy) > 1e-9) {
      for (let ci = 0; ci < cutYs.length; ci++) {
        const cy = cutYs[ci];
        if ((a[1] <= cy && b[1] >= cy) || (a[1] >= cy && b[1] <= cy)) {
          const t = Math.max(0, Math.min(1, (cy - a[1]) / dy));
          crossings.push({ s: s0 + t * (s1 - s0), axis: 'y' });
        }
      }
    }
  }
  if (crossings.length === 0) return [];

  const clampMin = 0.20 / scaleMm;
  const clampMax = spec.spanU - 0.20 / scaleMm;
  const minSepU = 0.70 / scaleMm;
  const maxCheckU = 1.50 / scaleMm;
  const out = [];
  const hasSupportNear = (sVal, sideDir) => {
    for (let i = 0; i < existingS.length; i++) {
      const d = existingS[i] - sVal;
      if (sideDir === 0 ? Math.abs(d) < minSepU : (d * sideDir >= 0 && d * sideDir <= maxCheckU)) return true;
    }
    for (let i = 0; i < spec.explicitSupports.length; i++) {
      const d = spec.explicitSupports[i].sProj - sVal;
      if (sideDir === 0 ? Math.abs(d) < minSepU : (d * sideDir >= 0 && d * sideDir <= maxCheckU)) return true;
    }
    for (let i = 0; i < out.length; i++) {
      if (Math.abs(out[i] - sVal) < minSepU) return true;
    }
    return false;
  };

  for (let i = 0; i < crossings.length; i++) {
    const cr = crossings[i];
    const { pt, tx, ty } = _samplePtAtSJS(spec, cr.s);
    if (Number.isFinite(ctx.halfW) && Math.abs(pt[0]) >= ctx.halfW - 0.1 / scaleMm) continue;
    if (Number.isFinite(ctx.halfH) && Math.abs(pt[1]) >= ctx.halfH - 0.1 / scaleMm) continue;
    if (!terrainWater.isPointInWater(pt[0], pt[1])) continue;
    const perpCos = cr.axis === 'x' ? Math.abs(tx) : Math.abs(ty);
    const twinOffU = Math.min(2.40 / scaleMm, Math.max(0.85 / scaleMm, 0.70 / (scaleMm * Math.max(0.20, perpCos))));
    const sMinus = cr.s - twinOffU;
    const sPlus = cr.s + twinOffU;
    let placedAny = false;
    if (sMinus >= clampMin && !hasSupportNear(cr.s, -1)) {
      out.push(Math.max(clampMin, Math.min(clampMax, sMinus)));
      placedAny = true;
    }
    if (sPlus <= clampMax && !hasSupportNear(cr.s, 1)) {
      out.push(Math.max(clampMin, Math.min(clampMax, sPlus)));
      placedAny = true;
    }
    if (!placedAny && sMinus < clampMin && sPlus > clampMax && !hasSupportNear(cr.s, 0)) {
      out.push(Math.max(clampMin, Math.min(clampMax, cr.s)));
    }
  }
  return out;
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
  } else if (!channelProtected && spec.structNorm !== 'floating') {
    const pierStationsS = [];
    const hasBedBounds = Number.isFinite(ctx.halfW) && Number.isFinite(ctx.halfH);
    if (isDryMultiBayArchViaduct) {
      if (spec.spanU > 3.6 / scaleMm) {
        const step = Math.max(4.5 / scaleMm, Math.min(45.0 * mToBedXY, spec.spanU / 3));
        const guardDist = step * 0.72;
        for (let s = step; s < spec.spanU - step * 0.45; s += step) {
          if (!spec.explicitSupports.some(es => Math.abs(es.sProj - s) < guardDist)) pierStationsS.push(s);
        }
      }
    } else {
      if (spec.spanU > 3.6 / scaleMm) {
        // Limit unsupported bay span to 4.2 mm (2.1 mm half-span).
        const maxClearSpanU = 4.2 / scaleMm;
        const desiredStep = Math.min(maxClearSpanU, Math.max(3.0 / scaleMm, spec.width * 2.1));
        const nBays = spec.spanU > maxClearSpanU ? Math.max(2, Math.ceil(spec.spanU / desiredStep)) : 2;
        const bayStep = spec.spanU / nBays;
        const guardDist = bayStep * 0.65;
        for (let bi = 1; bi < nBays; bi++) {
          const sBay = bi * bayStep;
          if (spec.explicitSupports.some(es => Math.abs(es.sProj - sBay) < guardDist)) continue;
          if (hasBedBounds) {
            const { pt } = _samplePtAtSJS(spec, sBay);
            if (Math.abs(pt[0]) >= ctx.halfW || Math.abs(pt[1]) >= ctx.halfH) continue;
          }
          pierStationsS.push(sBay);
        }
      }
      _addBorderCrossingStationsJS(spec, ctx, scaleMm, pierStationsS);
      pierStationsS.sort((a, b) => a - b);
    }

    // Place twin lateral piers under wide flat decks to keep deck edges supported.
    const placeTwin = !isDryMultiBayArchViaduct && spec.width * scaleMm > 4.2;
    const latOffU = placeTwin ? Math.max(minColR * 1.35, halfW - 1.4 / scaleMm) : 0;
    for (const s of pierStationsS) {
      const { pt, tx, ty } = _samplePtAtSJS(spec, s);
      const colPts = placeTwin
        ? [_sidePtJS(pt, tx, ty, latOffU, 0), _sidePtJS(pt, tx, ty, -latOffU, 0)]
        : [pt];
      let placedAny = false;
      for (const lp of colPts) {
        const zFloor = _anchorFloorZJS(lp[0], lp[1], terrainWater, ctx);
        const inWater = terrainWater.isPointInWater(lp[0], lp[1]);
        const colR = Math.max(strutRU, Math.min(halfW * 0.88, (ctx.waterCutout && inWater) ? minColR * 1.25 : minColR));
        const zCap = capAt(s, colR);
        if (zCap <= zFloor + 0.04 / scaleMm) continue;
        if (inWater) metrics.syntheticWaterPiers++;
        metrics.pierMinZ = Math.min(metrics.pierMinZ, zFloor);
        const col = beamManifoldBetween(mf, [lp[0], lp[1], zFloor], [lp[0], lp[1], zCap], colR);
        if (col) {
          parts.push(col);
          placedAny = true;
        }
      }
      if (placedAny) supportStationsS.push(s);
    }
  }

  if (ctx.waterCutout && ((ctx.cutXs && ctx.cutXs.length) || (ctx.cutYs && ctx.cutYs.length))) {
    const seamStationsS = _collectSeamCrossingStationsJS(spec, ctx, scaleMm, terrainWater, supportStationsS);
    const placeTwinSeam = spec.width * scaleMm > 4.2;
    const latOffSeamU = placeTwinSeam ? Math.max(minColR * 1.35, halfW - 1.4 / scaleMm) : 0;
    for (const s of seamStationsS) {
      const { pt, tx, ty } = _samplePtAtSJS(spec, s);
      const colPts = placeTwinSeam
        ? [_sidePtJS(pt, tx, ty, latOffSeamU, 0), _sidePtJS(pt, tx, ty, -latOffSeamU, 0)]
        : [pt];
      let placedAny = false;
      for (const lp of colPts) {
        const zFloor = _anchorFloorZJS(lp[0], lp[1], terrainWater, ctx);
        const inWater = terrainWater.isPointInWater(lp[0], lp[1]);
        const colR = Math.max(strutRU, Math.min(halfW * 0.88, inWater ? minColR * 1.25 : minColR));
        const zCap = capAt(s, colR);
        if (zCap <= zFloor + 0.04 / scaleMm) continue;
        if (inWater) metrics.syntheticWaterPiers++;
        metrics.pierMinZ = Math.min(metrics.pierMinZ, zFloor);
        const col = beamManifoldBetween(mf, [lp[0], lp[1], zFloor], [lp[0], lp[1], zCap], colR);
        if (col) {
          parts.push(col);
          placedAny = true;
        }
      }
      if (placedAny) supportStationsS.push(s);
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
