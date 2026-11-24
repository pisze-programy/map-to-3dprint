// ============================================================================
// src/buildings/archetype_structures_solver.js
// Parametric 3D Lattice, Observation Wheels, Turbines, Cranes & Industrial Towers
// ============================================================================

(function (root) {
  function _getLaws(ctx) {
    if (ctx && ctx.slaLaws) return ctx.slaLaws;
    return typeof root.SLA_PRINT_LAWS !== 'undefined'
      ? root.SLA_PRINT_LAWS
      : (() => { try { return require('../geometry/sla_print_laws.js'); } catch (_) { return null; } })();
  }

  function _minStrutRadU(ctx, spanMm = 4.0) {
    const laws = _getLaws(ctx);
    const clampSpan = Math.max(2.0, Math.min(20.0, Number(spanMm) || 4.0));
    const dMm = laws && typeof laws.minStrutDiameterMm === 'function' ? laws.minStrutDiameterMm(clampSpan) : 0.52;
    return Math.max(ctx.minPrintU * 0.5, (dMm * 0.5) / ctx.scaleMm);
  }

  function _extractPerimeterCorners(outerBed, maxCorners = 6) {
    const pts = outerBed.slice();
    if (pts.length >= 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-4) pts.pop();
    if (pts.length <= maxCorners) return pts;
    const out = [];
    for (let i = 0; i < maxCorners; i++) out.push(pts[Math.floor((i * pts.length) / maxCorners)]);
    return out;
  }

  function buildObservationWheelManifold(core, mf, ctx, terrainWater, outerBed, heightM, utils) {
    const { scaleMm, mToU, zScale, scaleToBed, minPrintU, maxZUnits, supportlessMode } = ctx;
    const obb = utils.computeFootprintOBB(outerBed);
    const zGround = utils.resolveGroundZ(ctx, terrainWater, obb.cx, obb.cy, 0.15);
    const spanBasedM = Math.max(8.0, Math.min(280.0, (Math.max(obb.spanU, obb.spanV) / (mToU * scaleToBed)) * 0.98));
    const hM = Number(heightM) > 0 ? Number(heightM) : spanBasedM;
    const totalHU = Math.min(maxZUnits - zGround - 0.3 / scaleMm, Math.max(2.0 / scaleMm, hM * mToU * zScale * scaleToBed));
    const R = Math.max(minPrintU * 2.8, Math.min(totalHU * 0.44, Math.max(obb.spanU * 0.48, totalHU * 0.41)));
    const zHub = zGround + Math.max(R * 1.10, totalHU - R);
    const minStrutR = _minStrutRadU(ctx);
    const rimDepth = Math.max(minPrintU * 1.1, minStrutR * 1.5, Math.min(R * 0.16, 1.35 / scaleMm));
    const rimRadThick = Math.max(minPrintU * 1.1, minStrutR * 1.35, R * 0.095);
    const spokeR = Math.max(minStrutR, minPrintU * 0.48, R * 0.030);
    const parts = [];
    try {
      const makeRing = (rOut, rIn, depth) => {
        const oPts = [], iPts = [], segs = 28;
        for (let k = 0; k < segs; k++) { const a = (k / segs) * Math.PI * 2; oPts.push([Math.cos(a) * rOut, Math.sin(a) * rOut]); iPts.push([Math.cos(a) * rIn, Math.sin(a) * rIn]); }
        const ex = core.extrudeRingSolid(mf, oPts, [iPts], -depth * 0.5, depth * 0.5);
        if (!ex) return null;
        const tr = ex.transform([obb.ux, obb.uy, 0, 0, 0, 0, 1, 0, obb.vx, obb.vy, 0, 0, obb.cx, obb.cy, zHub, 1]);
        ex.delete();
        return tr;
      };
      const outerRim = makeRing(R, Math.max(R * 0.62, R - rimRadThick), rimDepth);
      if (outerRim) parts.push(outerRim);
      const innerRim = makeRing(R * 0.78, Math.max(R * 0.48, R * 0.78 - rimRadThick * 0.75), rimDepth * 0.75);
      if (innerRim) parts.push(innerRim);
      parts.push(mf.Manifold.cylinder(rimDepth * 2.1, Math.max(rimRadThick * 1.2, spokeR * 2.5), Math.max(rimRadThick * 1.2, spokeR * 2.5), 14, true).transform([obb.ux, obb.uy, 0, 0, 0, 0, 1, 0, obb.vx, obb.vy, 0, 0, obb.cx, obb.cy, zHub, 1]));

      const capR = supportlessMode ? Math.min(rimRadThick * 0.44, Math.max(minPrintU * 0.52, R * 0.048)) : Math.max(minPrintU * 0.55, R * 0.052);
      const capDist = supportlessMode ? (R - rimRadThick * 0.5) : (R + capR * 0.45);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const sp = core.beamManifoldBetween(mf, [obb.cx, obb.cy, zHub], [obb.cx + obb.ux * ca * (R - rimRadThick * 0.3), obb.cy + obb.uy * ca * (R - rimRadThick * 0.3), zHub + sa * (R - rimRadThick * 0.3)], spokeR);
        if (sp) parts.push(sp);
        if (!supportlessMode || zHub + sa * capDist >= zHub - R * 0.68) {
          parts.push(mf.Manifold.sphere(capR, 8).translate([obb.cx + obb.ux * ca * capDist, obb.cy + obb.uy * ca * capDist, zHub + sa * capDist]));
        }
      }
      const legR = Math.max(minStrutR, minPrintU * 0.65, Math.min(R * 0.045, 0.48 / scaleMm));
      const spreadU = Math.min(obb.spanU * 0.42, R * 0.54), spreadV = Math.min(R * 0.135, Math.max(rimDepth * 0.65, (ctx.kerfUnits || 0) * 2.2));
      for (const sU of [-1, 1]) for (const sV of [-1, 1]) {
        const fx = obb.cx + obb.ux * sU * spreadU + obb.vx * sV * spreadV, fy = obb.cy + obb.uy * sU * spreadU + obb.vy * sV * spreadV;
        const leg = core.beamManifoldBetween(mf, [fx, fy, utils.resolveGroundZ(ctx, terrainWater, fx, fy, 0.35)], [obb.cx + obb.vx * sV * spreadV * 0.65, obb.cy + obb.vy * sV * spreadV * 0.65, zHub], legR);
        if (leg) parts.push(leg);
      }
      if (supportlessMode) {
        const zPlinthTop = Math.max(zGround + 0.5 / scaleMm, zHub - R * 0.68);
        const pU = Math.max(spreadU + legR, R * 0.78), pV = Math.max(spreadV + legR, rimDepth * 0.85);
        const pRing = [[-pU, -pV], [pU, -pV], [pU, pV], [-pU, pV]].map(([lu, lv]) => [obb.cx + obb.ux * lu + obb.vx * lv, obb.cy + obb.uy * lu + obb.vy * lv]);
        const plinth = core.extrudeRingSolid(mf, pRing, [], zGround - 0.15 / scaleMm, zPlinthTop);
        if (plinth) parts.push(plinth);
      }
      return parts.length ? core.batchUnionManifolds(mf, parts) : null;
    } catch (_) { for (const p of parts) core.safeDeleteManifold(p); return null; }
  }

  function buildWindTurbineManifold(core, mf, ctx, terrainWater, cx, cy, heightM, yawDeg, utils, tags = null) {
    const { scaleMm, mToU, zScale, scaleToBed, minPrintU, maxZUnits, supportlessMode } = ctx;
    const zGround = utils.resolveGroundZ(ctx, terrainWater, cx, cy, 0.20);
    const mastH = Math.min(maxZUnits - zGround - 2.0 / scaleMm, Math.max(5.0 / scaleMm, (heightM || 75) * mToU * zScale * scaleToBed));
    const minStrutR = _minStrutRadU(ctx);
    const rBot = Math.max(minPrintU * 0.9, minStrutR * 1.15, mastH * 0.052);
    const rTop = Math.max(minPrintU * 0.55, minStrutR * 0.9, rBot * 0.52);
    const explicitRotorDiaM = tags ? parseFloat(tags['rotor:diameter']) : NaN;
    const bladeLen = (Number.isFinite(explicitRotorDiaM) && explicitRotorDiaM > 0)
      ? Math.max(mastH * 0.20, Math.min(mastH * 0.55, explicitRotorDiaM * 0.5 * mToU * scaleToBed))
      : mastH * 0.48;
    const zNacelle = zGround + mastH, bladeR = Math.max(minStrutR, minPrintU * 0.45, rTop * 0.72);
    const yawRad = ((yawDeg || 0) * Math.PI) / 180.0, dirX = Math.cos(yawRad), dirY = Math.sin(yawRad), perpX = -dirY, perpY = dirX;
    const parts = [mf.Manifold.cylinder(mastH, rBot, rTop, 12, false).translate([cx, cy, zGround])];
    const hubX = cx + dirX * rBot * 1.35, hubY = cy + dirY * rBot * 1.35;
    const nacR = supportlessMode ? Math.max(rTop * 1.25, bladeR * 1.15) : rTop * 1.25;
    const nacEnd = supportlessMode ? rBot * 1.35 + bladeR * 1.05 : rBot * 1.35;
    const nac = core.beamManifoldBetween(mf, [cx - dirX * rBot * 1.15, cy - dirY * rBot * 1.15, zNacelle], [cx + dirX * nacEnd, cy + dirY * nacEnd, zNacelle], nacR);
    if (nac) parts.push(nac);

    const bladeAngs = supportlessMode ? [Math.PI / 6, (5 * Math.PI) / 6] : [0.35, 0.35 + (Math.PI * 2) / 3, 0.35 + (Math.PI * 4) / 3];
    for (const a of bladeAngs) {
      const b = core.beamManifoldBetween(mf, [hubX, hubY, zNacelle], [hubX + perpX * Math.cos(a) * bladeLen, hubY + perpY * Math.cos(a) * bladeLen, zNacelle + Math.sin(a) * bladeLen], bladeR);
      if (b) parts.push(b);
    }
    if (supportlessMode) {
      const zLowTip = Math.max(zGround + 0.5 / scaleMm, zNacelle - bladeLen);
      const collar = core.beamManifoldBetween(mf, [cx, cy, zNacelle - rBot * 1.6], [hubX, hubY, zNacelle], Math.max(bladeR * 0.95, rTop * 0.85));
      const backBrace = core.beamManifoldBetween(mf, [cx, cy, zNacelle - rBot * 1.5], [cx - dirX * rBot * 1.15, cy - dirY * rBot * 1.15, zNacelle], rTop * 0.75);
      const lowB = core.beamManifoldBetween(mf, [hubX, hubY, zNacelle], [hubX, hubY, zLowTip], bladeR);
      if (collar) parts.push(collar); if (backBrace) parts.push(backBrace); if (lowB) parts.push(lowB);
      const halfW = Math.max(minStrutR, bladeR * 0.9), extBack = -rTop * 0.3, extFwd = rBot * 1.35 + bladeR * 0.95;
      const webRing = [[extBack, -halfW], [extFwd, -halfW], [extFwd, halfW], [extBack, halfW]].map(([lx, ly]) => [cx + dirX * lx - dirY * ly, cy + dirY * lx + dirX * ly]);
      const web = core.extrudeRingSolid(mf, webRing, [], zLowTip - 0.12 / scaleMm, zNacelle);
      if (web) parts.push(web);
    }
    return core.batchUnionManifolds(mf, parts);
  }

  function buildParametricLatticeManifold(core, mf, ctx, terrainWater, b, outerBed, tags, explicitHeightM, utils) {
    const { scaleMm, mToU, zScale, scaleToBed, minPrintU, maxZUnits } = ctx;
    const laws = _getLaws(ctx);
    const obb = utils.computeFootprintOBB(outerBed);
    const rawMinH = Math.max(0, Number(b && b.minH !== undefined ? b.minH : (tags.min_height || 0)) || 0);
    const rawH = Number(explicitHeightM) > 0 ? Number(explicitHeightM) : (Number(tags['building:levels'] || 0) * 3.5 || 28.0);
    const zDatum = (b && Number.isFinite(b.groupDatumZ))
      ? b.groupDatumZ
      : utils.resolveGroundZ(ctx, terrainWater, obb.cx, obb.cy, rawMinH > 0 ? 0.0 : 0.22);
    const zBotRaw = zDatum + rawMinH * mToU * zScale * scaleToBed;
    const isNarrowSpire = Boolean(b && b.part && rawMinH > 10 && (!b.parentHeightM || rawH >= b.parentHeightM - 1.0) && Math.min(obb.spanU, obb.spanV) * scaleMm < 2.2 && (rawH - rawMinH) > 8.0);
    let topOffsetU = rawH * mToU * zScale * scaleToBed;
    if (isNarrowSpire && laws && typeof laws.capSpireProtrusionMm === 'function') {
      topOffsetU = rawMinH * mToU * zScale * scaleToBed + laws.capSpireProtrusionMm((rawH - rawMinH) * mToU * zScale * scaleToBed * scaleMm, rawMinH * mToU * zScale * scaleToBed * scaleMm) / scaleMm;
    }
    const compressZ = (ctx && typeof ctx.compressZUnits === 'function') ? ctx.compressZUnits : (zU => zU);
    const zBottom = Math.max(0.05 / scaleMm, compressZ(zBotRaw) - (rawMinH > 0 ? 0.45 / scaleMm : 0.20 / scaleMm));
    const zTop = Math.min(maxZUnits - 0.3 / scaleMm, compressZ(zDatum + topOffsetU) + (b && b.part && !isNarrowSpire ? 0.25 / scaleMm : 0));
    const partH = zTop - zBottom;
    if (partH <= 0.2 / scaleMm) return null;

    const corners = _extractPerimeterCorners(outerBed, 6);
    if (corners.length < 3) return null;
    const cCen = [corners.reduce((s, p) => s + p[0], 0) / corners.length, corners.reduce((s, p) => s + p[1], 0) / corners.length];
    let topCenter = cCen, taper = isNarrowSpire ? 0.45 : 0.35;
    if (b && b.roof === 'skillion' && Number.isFinite(b.roofDir)) {
      const rad = (b.roofDir * Math.PI) / 180.0, ux = Math.sin(rad), uy = Math.cos(rad);
      const proj = corners.map(c => (c[0] - cCen[0]) * ux + (c[1] - cCen[1]) * uy);
      const sMin = Math.min(...proj), sLim = sMin + 0.32 * Math.max(1e-4, Math.max(...proj) - sMin);
      const hiPts = corners.filter((_, idx) => proj[idx] <= sLim);
      if (hiPts.length > 0) topCenter = [hiPts.reduce((s, p) => s + p[0], 0) / hiPts.length, hiPts.reduce((s, p) => s + p[1], 0) / hiPts.length];
      taper = 0.24;
    }
    const topCorners = corners.map(c => [topCenter[0] + (c[0] - topCenter[0]) * taper, topCenter[1] + (c[1] - topCenter[1]) * taper]);
    const minStrutR = _minStrutRadU(ctx, Math.min(18.0, Math.max(2.5, Math.min(obb.spanU, obb.spanV) * scaleMm)));
    const legR = Math.max(minStrutR, minPrintU * 0.55, Math.min(Math.min(obb.spanU, obb.spanV) * 0.11, 0.90 / scaleMm), Math.min(partH * 0.032, 0.70 / scaleMm));
    const braceR = Math.max(minStrutR, legR * 0.78);
    const nBays = Math.max(2, Math.min(7, Math.round(partH / Math.max(Math.min(obb.spanU, obb.spanV) * 0.85, 1.8 / scaleMm))));
    const rings = [], parts = [];
    for (let k = 0; k <= nBays; k++) {
      const f = k / nBays, z = zBottom + f * partH;
      rings.push(corners.map((c, idx) => [c[0] + (topCorners[idx][0] - c[0]) * f, c[1] + (topCorners[idx][1] - c[1]) * f, z]));
    }
    for (let k = 0; k < rings.length; k++) {
      for (let i = 0; i < corners.length; i++) {
        parts.push(mf.Manifold.sphere(legR * 1.06, 8).translate(rings[k][i]));
        const nxt = (i + 1) % corners.length;
        const g = core.beamManifoldBetween(mf, rings[k][i], rings[k][nxt], braceR);
        if (g) parts.push(g);
        if (k < rings.length - 1) {
          for (const [p0, p1, r] of [[rings[k][i], rings[k + 1][i], legR], [rings[k][i], rings[k + 1][nxt], braceR], [rings[k][nxt], rings[k + 1][i], braceR]]) {
            const bm = core.beamManifoldBetween(mf, p0, p1, r);
            if (bm) parts.push(bm);
          }
        }
      }
    }
    if (!b || !b.part) {
      const topHub = [topCenter[0], topCenter[1], zTop], topRing = rings[rings.length - 1];
      for (let i = 0; i < topRing.length; i++) {
        const cb = core.beamManifoldBetween(mf, topRing[i], topHub, braceR);
        if (cb) parts.push(cb);
      }
      parts.push(mf.Manifold.sphere(legR * 1.05, 8).translate(topHub));
      parts.push(mf.Manifold.cylinder(partH * 0.12, legR * 0.9, minStrutR * 0.55, 8, false).translate([topCenter[0], topCenter[1], zTop - 0.1 / scaleMm]));
    }
    return parts.length ? core.batchUnionManifolds(mf, parts) : null;
  }

  function buildTowerOrIndustrialManifold(core, mf, ctx, terrainWater, outerBed, mm, tags, explicitHeightM, utils) {
    const { scaleMm, mToU, zScale, scaleToBed, minPrintU, maxZUnits, supportlessMode } = ctx;
    const obb = utils.computeFootprintOBB(outerBed);
    const zGround = utils.resolveGroundZ(ctx, terrainWater, obb.cx, obb.cy, 0.22);
    const defH = mm === 'chimney' ? 42 : (mm === 'cooling_tower' ? 68 : (mm === 'silo' ? 22 : (mm === 'crane' ? 45 : (mm === 'mast' || mm === 'communications_tower' ? 30 : (mm === 'lighthouse' ? 28 : (mm === 'tower' ? 24 : 14))))));
    const hM = Number(explicitHeightM) > 0 ? Number(explicitHeightM) : (Number(tags['building:levels'] || 0) * 3.5 || defH);
    const totalHU = Math.min(maxZUnits - zGround - 0.3 / scaleMm, Math.max(1.8 / scaleMm, hM * mToU * zScale * scaleToBed));
    const minStrutR = _minStrutRadU(ctx), rBase = Math.max(minPrintU * 1.15, minStrutR * 1.1, Math.min(obb.spanU, obb.spanV) * 0.45);
    const parts = [];

    if (mm === 'crane') {
      const mastW = Math.max(minPrintU * 1.0, minStrutR * 1.25, Math.min(rBase * 0.65, totalHU * 0.085));
      parts.push(mf.Manifold.cylinder(totalHU, mastW, mastW * 0.85, 4, false).translate([obb.cx, obb.cy, zGround]));
      const jibLen = Math.max(totalHU * 0.65, obb.spanU * 0.85), jibZ = zGround + totalHU * 0.84;
      const jib = core.beamManifoldBetween(mf, [obb.cx - obb.ux * jibLen * 0.32, obb.cy - obb.uy * jibLen * 0.32, jibZ], [obb.cx + obb.ux * jibLen * 0.70, obb.cy + obb.uy * jibLen * 0.70, jibZ], Math.max(minStrutR, mastW * 0.55));
      const stay = core.beamManifoldBetween(mf, [obb.cx, obb.cy, zGround + totalHU], [obb.cx + obb.ux * jibLen * 0.56, obb.cy + obb.uy * jibLen * 0.56, jibZ], Math.max(minStrutR, mastW * 0.36));
      if (jib) parts.push(jib); if (stay) parts.push(stay);
      if (supportlessMode) {
        const reachF = jibLen * 0.52, reachB = jibLen * 0.24, brR = Math.min(mastW * 0.65, Math.max(minStrutR, mastW * 0.45));
        const brF = core.beamManifoldBetween(mf, [obb.cx, obb.cy, Math.max(zGround + 0.4 / scaleMm, jibZ - reachF * 1.05)], [obb.cx + obb.ux * reachF, obb.cy + obb.uy * reachF, jibZ], brR);
        const brB = core.beamManifoldBetween(mf, [obb.cx, obb.cy, Math.max(zGround + 0.4 / scaleMm, jibZ - reachB * 1.05)], [obb.cx - obb.ux * reachB, obb.cy - obb.uy * reachB, jibZ], brR);
        if (brF) parts.push(brF); if (brB) parts.push(brB);
      }
      return core.batchUnionManifolds(mf, parts);
    }
    if (mm === 'cooling_tower') {
      const rWaist = rBase * 0.68, wallT = Math.max(minPrintU * 1.1, rBase * 0.09), prof = [];
      for (let i = 0; i <= 10; i++) { const f = i / 10, tVal = (f - 0.70) * 1.4; prof.push([rWaist * Math.sqrt(1 + tVal * tVal * 0.85), f * totalHU]); }
      for (let i = 10; i >= 0; i--) { const f = i / 10, tVal = (f - 0.70) * 1.4; prof.push([Math.max(wallT * 0.5, rWaist * Math.sqrt(1 + tVal * tVal * 0.85) - wallT), f * totalHU]); }
      try {
        const cs = mf.CrossSection.ofPolygons([core.ensureWinding(prof, true, 1e-5)], 'Positive');
        const rev = mf.Manifold.revolve(cs, 24, 360).translate([obb.cx, obb.cy, zGround]); cs.delete();
        const pad = mf.Manifold.cylinder(Math.max(minPrintU, totalHU * 0.06), rBase, rBase, 24, false).translate([obb.cx, obb.cy, zGround]);
        const u = rev.add(pad); rev.delete(); pad.delete(); return u;
      } catch (_) {}
    }
    if (mm === 'chimney') {
      const rTop = Math.max(minPrintU * 0.65, rBase * 0.56);
      const body = mf.Manifold.cylinder(totalHU, rBase, rTop, 16, false).translate([obb.cx, obb.cy, zGround]);
      const crown = mf.Manifold.cylinder(Math.max(minPrintU * 0.9, totalHU * 0.06), rTop * 1.24, rTop * 1.2, 16, false).translate([obb.cx, obb.cy, zGround + totalHU * 0.94]);
      const res = body.add(crown); body.delete(); crown.delete(); return res;
    }
    if (['tower', 'lighthouse', 'communications_tower', 'mast'].includes(mm)) {
      const rTop = mm === 'mast' ? rBase * 0.35 : rBase * 0.62, hasPod = mm === 'lighthouse' || mm === 'communications_tower';
      const shaftH = totalHU * (hasPod ? 0.76 : 0.85), segs = mm === 'lighthouse' ? 16 : 10;
      parts.push(mf.Manifold.cylinder(shaftH, rBase, rTop, segs, false).translate([obb.cx, obb.cy, zGround]));
      if (hasPod) {
        const podH = totalHU * 0.08, capH = totalHU - shaftH - podH;
        parts.push(mf.Manifold.cylinder(podH, rTop * 1.55, rTop * 1.47, 16, false).translate([obb.cx, obb.cy, zGround + shaftH]));
        if (capH > 1e-4) parts.push(mf.Manifold.cylinder(capH, rTop * 0.75, mm === 'communications_tower' ? minPrintU * 0.3 : rTop * 0.1, 12, false).translate([obb.cx, obb.cy, zGround + shaftH + podH]));
      } else parts.push(mf.Manifold.cylinder(Math.max(0.2 / scaleMm, totalHU - shaftH), rTop * 1.05, rTop * 0.2, segs, false).translate([obb.cx, obb.cy, zGround + shaftH]));
      return core.batchUnionManifolds(mf, parts);
    }
    const wallH = totalHU * (mm === 'silo' ? 0.84 : 0.92), capH = Math.max(minPrintU * 0.6, totalHU - wallH);
    const body = mf.Manifold.cylinder(wallH, rBase, rBase, 20, false).translate([obb.cx, obb.cy, zGround]);
    const cap = mf.Manifold.cylinder(capH, rBase, mm === 'silo' ? rBase * 0.08 : rBase * 0.55, 20, false).translate([obb.cx, obb.cy, zGround + wallH - 0.02]);
    const res = body.add(cap); body.delete(); cap.delete(); return res;
  }

  const exportsObj = {
    buildObservationWheelManifold,
    buildWindTurbineManifold,
    buildParametricLatticeManifold,
    buildTowerOrIndustrialManifold,
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
