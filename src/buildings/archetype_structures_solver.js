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

  /**
   * Slices a polygon in panel-local (s, w) coordinates at s = sVal and returns
   * sorted non-degenerate [w0, w1] intervals.
   * @param {number[][]} polySW
   * @param {number} sVal
   * @param {number} minWidthU
   * @returns {number[][]}
   */
  function _slicePanelSWIntervals(polySW, sVal, minWidthU) {
    const hits = [];
    const n = polySW.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = polySW[j], b = polySW[i];
      if ((a[0] <= sVal && b[0] > sVal) || (b[0] <= sVal && a[0] > sVal)) {
        const t = (sVal - a[0]) / (b[0] - a[0]);
        hits.push(a[1] + t * (b[1] - a[1]));
      }
    }
    if (hits.length < 2) return [];
    hits.sort((a, b) => a - b);
    const out = [];
    for (let k = 0; k + 1 < hits.length; k += 2) {
      if (hits[k + 1] - hits[k] >= minWidthU) out.push([hits[k], hits[k + 1]]);
    }
    return out;
  }

  /**
   * Generates MSLA-printable proud wrought-iron X-lattice truss relief ribs on the
   * outer sloped face of an S3DB skillion lattice panel while keeping open arches clear.
   * @returns {object[]} Array of Manifold beam solids
   */
  function _buildSkillionFaceLatticeRelief(
    core, mf, outerBed, dx, dy, wx, wy,
    sMin, sMax, wMin, wMax, zEavesU, slope, zBottom, zTop,
    isOpenRoofShell, halfDz, scaleMm
  ) {
    const runU = sMax - sMin;
    const spanW = wMax - wMin;
    const riseU = Math.max(1e-4, zTop - zEavesU);
    const panelHMm = (zTop - zBottom) * scaleMm;
    if (panelHMm < 2.2 || spanW * scaleMm < 1.4 || runU < 1e-4) return [];

    const polySW = [];
    for (let i = 0; i < outerBed.length; i++) {
      const p = outerBed[i];
      polySW.push([p[0] * dx + p[1] * dy, p[0] * wx + p[1] * wy]);
    }
    if (polySW.length < 3) return [];

    const hyp = Math.hypot(runU, riseU);
    const nS = riseU / hyp;
    const nZ = runU / hyp;
    const ribR = Math.max(0.21 / scaleMm, Math.min(0.28 / scaleMm, spanW * 0.038));
    const chordR = Math.min(0.32 / scaleMm, ribR * 1.18);
    const outOff = ribR * 0.24;
    const minIntervalW = Math.max(0.45 / scaleMm, ribR * 1.8);
    const sAtZ = (z) => sMax - (z - zEavesU) / slope;
    const zOuterAtS = (s) => zEavesU + slope * (sMax - Math.max(sMin, s)) + (isOpenRoofShell ? halfDz : 0.0);
    const ptOuter = (s, w, off = outOff) => {
      const sp = s + nS * off;
      const zp = zOuterAtS(s) + nZ * off;
      return [sp * dx + w * wx, sp * dy + w * wy, zp];
    };

    const beams = [];
    const maxBeams = 92;
    const addBeam = (p0, p1, r) => {
      if (beams.length >= maxBeams) return;
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      if (len < 0.20 / scaleMm) return;
      const bm = core.beamManifoldBetween(mf, p0, p1, r);
      if (bm) beams.push(bm);
    };

    const zPadBot = Math.max(0.30 / scaleMm, ribR * 1.25);
    const zPadTop = isOpenRoofShell
      ? Math.max(0.45 / scaleMm, ribR * 1.65)
      : Math.max(0.32 / scaleMm, ribR * 1.25);
    const zLo = Math.max(zBottom + zPadBot, zEavesU + zPadBot * 0.65);
    const zHi = zTop - zPadTop;
    if (zHi <= zLo + 0.65 / scaleMm) return [];

    // Locate arch-crown transition Z where a 2-leg open shell merges into a 1-piece spandrel frieze.
    let zLastTwo = null;
    let zFirstOne = null;
    if (isOpenRoofShell) {
      const nProbe = 36;
      for (let k = 0; k <= nProbe; k++) {
        const z = zLo + (k / nProbe) * (zHi - zLo);
        const ivs = _slicePanelSWIntervals(polySW, sAtZ(z), minIntervalW);
        if (ivs.length >= 2) {
          zLastTwo = z;
        } else if (zLastTwo !== null && ivs.length === 1 && zFirstOne === null) {
          zFirstOne = z;
          break;
        }
      }
    }

    const zones = [];
    if (zLastTwo !== null && zLastTwo > zLo + 0.65 / scaleMm) {
      zones.push({ za: zLo, zb: zLastTwo, expectedCount: 2 });
      if (zFirstOne !== null && zHi > zFirstOne + 0.65 / scaleMm) {
        zones.push({ za: zFirstOne, zb: zHi, expectedCount: 1 });
      }
    } else {
      zones.push({ za: zLo, zb: zHi, expectedCount: 1 });
    }

    const buildXZone = (za, zb, expectedCount) => {
      const zoneH = zb - za;
      if (zoneH < 0.65 / scaleMm) return;
      // Build proportional self-similar tier elevations so X-braces stay >= 45 deg as width tapers.
      const zLevels = [za];
      let zCur = za;
      while (zCur < zb - 0.1 / scaleMm && zLevels.length < 11) {
        const ivMid = _slicePanelSWIntervals(polySW, sAtZ(Math.min(zb, zCur + 0.35 / scaleMm)), minIntervalW);
        const refW = ivMid.length > 0
          ? Math.max(...ivMid.map(iv => iv[1] - iv[0]))
          : spanW * 0.5;
        const stepH = Math.max(1.45 / scaleMm, Math.min(3.30 / scaleMm, refW * 1.04));
        if (zCur + stepH * 1.42 >= zb) {
          zLevels.push(zb);
          break;
        }
        zCur += stepH;
        zLevels.push(zCur);
      }
      if (zLevels[zLevels.length - 1] < zb - 1e-4) zLevels.push(zb);

      for (let ri = 0; ri < zLevels.length - 1; ri++) {
        const z0 = zLevels[ri], z1 = zLevels[ri + 1];
        const s0 = sAtZ(z0), s1 = sAtZ(z1);
        const ivs0 = _slicePanelSWIntervals(polySW, s0, minIntervalW);
        const ivs1 = _slicePanelSWIntervals(polySW, s1, minIntervalW);
        if (ivs0.length === 0 || ivs1.length === 0 || ivs0.length !== ivs1.length) continue;
        if (expectedCount > 1 && ivs0.length < 2) continue;

        const pairCount = ivs0.length;
        const bayH = z1 - z0;
        const edgeInset = ribR * 0.45;
        for (let pi = 0; pi < pairCount; pi++) {
          const a0 = ivs0[pi][0] + edgeInset, a1 = ivs0[pi][1] - edgeInset;
          const b0 = ivs1[pi][0] + edgeInset, b1 = ivs1[pi][1] - edgeInset;
          const wBot = a1 - a0, wTop = b1 - b0;
          if (wBot < ribR * 1.1 || wTop < ribR * 1.1) continue;

          // Outer silhouette chord ribs + horizontal tier stringers.
          const isLeftOuter = pi === 0;
          const isRightOuter = pi === pairCount - 1;
          addBeam(ptOuter(s0, a0), ptOuter(s1, b0), isLeftOuter ? chordR : ribR);
          addBeam(ptOuter(s0, a1), ptOuter(s1, b1), isRightOuter ? chordR : ribR);
          if (ri === 0) addBeam(ptOuter(s0, a0), ptOuter(s0, a1), ribR * 0.92);
          addBeam(ptOuter(s1, b0), ptOuter(s1, b1), ribR * 0.95);

          // Keep each arched leg a clean single X-truss column; subdivide only wide unified spandrel bands.
          const maxCellW = Math.max(0.85 / scaleMm, bayH * 1.05);
          const nCols = expectedCount >= 2
            ? 1
            : Math.max(1, Math.min(5, Math.ceil(Math.max(wBot, wTop) / maxCellW)));
          for (let ci = 0; ci < nCols; ci++) {
            const fL = ci / nCols, fR = (ci + 1) / nCols;
            const xBL = a0 + wBot * fL, xBR = a0 + wBot * fR;
            const xTL = b0 + wTop * fL, xTR = b0 + wTop * fR;
            addBeam(ptOuter(s0, xBL), ptOuter(s1, xTR), ribR * 0.88);
            addBeam(ptOuter(s0, xBR), ptOuter(s1, xTL), ribR * 0.88);
            if (ci > 0 && ci < nCols) {
              addBeam(ptOuter(s0, xBL), ptOuter(s1, xTL), ribR * 0.82);
            }
          }
        }
      }
    };

    for (const zBand of zones) buildXZone(zBand.za, zBand.zb, zBand.expectedCount);

    // Trace contiguous interior arch-rim chains on open arched shells with a proud cast-iron arch band.
    if (isOpenRoofShell && zLastTwo !== null) {
      const wInnerLo = wMin + spanW * 0.14;
      const wInnerHi = wMax - spanW * 0.14;
      const sUphillGuard = sMin + runU * 0.08;
      const sBaseGuard = sMax - 0.08 / scaleMm;
      const n = polySW.length;
      const isArchEdge = (a, b) => (
        a[1] > wInnerLo && a[1] < wInnerHi && b[1] > wInnerLo && b[1] < wInnerHi &&
        a[0] > sUphillGuard && b[0] > sUphillGuard && a[0] < sBaseGuard && b[0] < sBaseGuard &&
        Math.hypot(b[0] - a[0], b[1] - a[1]) <= spanW * 0.45
      );
      const chains = [];
      let cur = null;
      for (let i = 0; i < n; i++) {
        const a = polySW[i], b = polySW[(i + 1) % n];
        if (isArchEdge(a, b)) {
          if (!cur) { cur = [a, b]; chains.push(cur); }
          else cur.push(b);
        } else {
          cur = null;
        }
      }
      for (const ch of chains) {
        if (ch.length < 2) continue;
        const nSegs = ch.length - 1;
        const stride = Math.max(1, Math.ceil(nSegs / 14));
        for (let k = 0; k < nSegs; k += stride) {
          const pA = ch[k];
          const pB = ch[Math.min(nSegs, k + stride)];
          if (Math.hypot(pB[0] - pA[0], pB[1] - pA[1]) > spanW * 0.48) continue;
          addBeam(ptOuter(pA[0], pA[1], outOff * 1.05), ptOuter(pB[0], pB[1], outOff * 1.05), chordR);
        }
      }
    }

    return beams;
  }

  /**
   * Builds a watertight sloped architectural shell or solid tapered wedge from a
   * full-resolution S3DB skillion polygon (preserving curved arch cutouts, miter edges,
   * and proud MSLA-printable wrought-iron X-lattice truss relief).
   * @returns {object|null} Manifold solid or null
   */
  function _buildSlopedSkillionLatticePanel(core, mf, ctx, b, outerBed, tags, rawH, rawMinH, zBottom, zTop) {
    const { scaleMm } = ctx;
    const partSpanM = Math.max(1e-3, rawH - rawMinH);
    const explicitRoofHM = Number(
      b && b.roofH !== undefined ? b.roofH : (tags && tags['roof:height'] !== undefined ? tags['roof:height'] : 0)
    ) || 0;
    const dirRad = (Number(b.roofDir) * Math.PI) / 180.0;
    const dx = Math.sin(dirRad), dy = Math.cos(dirRad); // Downhill unit vector (0=N/+Y, 90=E/+X)
    const wx = dy, wy = -dx; // Right-handed extrusion axis: d x +Z = [dy, -dx, 0]

    let sMin = Infinity, sMax = -Infinity, wMin = Infinity, wMax = -Infinity;
    for (let i = 0; i < outerBed.length; i++) {
      const p = outerBed[i];
      const s = p[0] * dx + p[1] * dy;
      const w = p[0] * wx + p[1] * wy;
      if (s < sMin) sMin = s;
      if (s > sMax) sMax = s;
      if (w < wMin) wMin = w;
      if (w > wMax) wMax = w;
    }
    const runU = sMax - sMin;
    const spanW = wMax - wMin;
    if (runU < 1e-4 || spanW < 1e-4 || zTop - zBottom < 0.15 / scaleMm) return null;

    const isOpenRoofShell = String(tags.wall || '').toLowerCase() === 'no' ||
      String(tags['building:part'] || '').toLowerCase() === 'roof';
    const eavesFrac = (explicitRoofHM > 0 && explicitRoofHM < partSpanM - 0.5)
      ? Math.max(0, Math.min(0.35, 1.0 - explicitRoofHM / partSpanM))
      : 0.0;
    const zEavesU = zBottom + eavesFrac * (zTop - zBottom);
    const riseU = Math.max(1e-4, zTop - zEavesU);
    const slope = riseU / runU;

    const padW = 0.25 / scaleMm;
    const padS = 0.20 / scaleMm;
    const overlapBot = 0.30 / scaleMm;
    const overlapTop = 0.45 / scaleMm;
    const miterPadU = 0.035 / scaleMm;

    let clipRings = [core.ensureWinding(outerBed, true, 4e-4)].filter(r => r.length >= 3);
    if (clipRings.length === 0) return null;
    try {
      const grown = core.clipperOffsetPolys(clipRings, miterPadU, 'Miter', 1e-5)
        .map(r => core.ensureWinding(r, true, 4e-4)).filter(r => r.length >= 3);
      if (grown.length > 0) clipRings = grown;
    } catch (_) {}

    let profileSZ = null;
    let halfDz = 0.0;
    if (isOpenRoofShell) {
      // Sloped open-underside shell centered on the exact skillion plane, keeping arches open
      // while ensuring >= 0.85 mm structural landing seat thickness beneath upper floor decks.
      const tPerpU = Math.max(0.85 / scaleMm, Math.min(1.15 / scaleMm, runU * 0.32));
      const dzShell = Math.min(
        (zTop - zBottom) * 0.42,
        Math.max(0.88 / scaleMm, (tPerpU * Math.hypot(runU, riseU)) / runU)
      );
      halfDz = dzShell * 0.5;
      // Add an uphill landing haunch strictly along the top seat (s <= sMin + 0.22*runU) so
      // arched legs embed solidly under upper floor decks without triggering vertical stilts.
      const topSeatU = Math.min(0.85 / scaleMm, runU * 0.52);
      if (topSeatU > 1e-4) {
        const upThresh = sMin + runU * 0.22;
        clipRings = clipRings.map(r => r.map(p => {
          const ps = p[0] * dx + p[1] * dy;
          return ps <= upThresh ? [p[0] - dx * topSeatU, p[1] - dy * topSeatU] : p;
        }));
      }
      const sLo = sMin - topSeatU - padS;
      const sHi = sMax + padS;
      // Clamp s >= sMin on the top profile so the uphill haunch stays flush beneath zTop,
      // while sloping the underside upward at >= 51 deg so no flat shelf overhangs an open arch.
      const zPlane = (s) => zEavesU + slope * (sMax - Math.max(sMin, s));
      const slopeHaunch = Math.max(1.25, Math.min(slope, 1.85));
      const zTopAt = (s) => Math.min(zTop + overlapTop, zPlane(s) + halfDz);
      const zBotAt = (s) => {
        if (s < sMin) {
          return Math.min(zTop - 0.04 / scaleMm, (zPlane(sMin) - halfDz) + (sMin - s) * slopeHaunch);
        }
        return Math.max(zBottom - overlapBot, zPlane(s) - halfDz);
      };
      // Sample cleanly along [sLo, sHi] so clamped knees at zBottom, haunch, and zTop are exact.
      const sKneeTop = sMax - (zTop + overlapTop - halfDz - zEavesU) / slope;
      const sKneeBot = sMax - (zBottom - overlapBot + halfDz - zEavesU) / slope;
      const sKneeHaunch = sMin - Math.max(0, ((zTop - 0.04 / scaleMm) - (zPlane(sMin) - halfDz)) / slopeHaunch);
      const sTopSamples = [sLo, sMin, sKneeTop, sMax, sHi]
        .filter(s => s >= sLo - 1e-6 && s <= sHi + 1e-6)
        .sort((a, b) => a - b);
      const sBotSamples = [sLo, sKneeHaunch, sMin, sKneeBot, sMax, sHi]
        .filter(s => s >= sLo - 1e-6 && s <= sHi + 1e-6)
        .sort((a, b) => b - a);
      const pts = [];
      for (const s of sTopSamples) {
        if (!pts.length || Math.abs(s - pts[pts.length - 1][0]) > 1e-5) pts.push([s, zTopAt(s)]);
      }
      for (const s of sBotSamples) {
        const zb = zBotAt(s);
        if (Math.abs(s - pts[pts.length - 1][0]) > 1e-5 || Math.abs(zb - pts[pts.length - 1][1]) > 1e-5) {
          pts.push([s, zb]);
        }
      }
      profileSZ = pts;
    } else {
      // Solid tapered skillion shaft wedge: extend ONLY the narrow uphill vertices inward
      // along -d so adjacent trapezoidal faces fuse solidly at the summit without widening
      // the tapered sides or leaving a zero-thickness knife edge.
      const inwardCoreU = riseU > runU * 2.2
        ? Math.max(0.65 / scaleMm, Math.min(1.05 / scaleMm, runU * 0.85))
        : 0.0;
      if (inwardCoreU > 1e-4) {
        const uphillThresh = sMin + runU * 0.25;
        clipRings = clipRings.map(r => r.map(p => {
          const ps = p[0] * dx + p[1] * dy;
          return ps <= uphillThresh ? [p[0] - dx * inwardCoreU, p[1] - dy * inwardCoreU] : p;
        }));
      }
      const sInner = sMin - inwardCoreU - padS;
      const sOuter = sMax + padS;
      // Keep elevated upper-tier shafts seated inside the floor deck above zBottom
      // so they never punch a flat solid bottom through the deck ceiling below.
      const zBotFace = rawMinH > 0.2 ? (zBottom + 0.08 / scaleMm) : (zBottom - overlapBot);
      const zTopFace = zTop + overlapTop;
      const zOuterEaves = Math.max(zBotFace + 0.15 / scaleMm, zEavesU);
      profileSZ = [
        [sInner, zBotFace],
        [sOuter, zBotFace],
        [sOuter, zOuterEaves],
        [sMax, zOuterEaves],
        [sMin, zTopFace],
        [sInner, zTopFace],
      ];
    }

    const pts2D = core.ensureWinding(profileSZ, true, 1e-5);
    if (pts2D.length < 3) return null;

    let cs = null, ex = null, prism = null, cutter = null;
    const reliefBeams = [];
    try {
      cs = mf.CrossSection.ofPolygons([pts2D], 'Positive');
      if (cs.isEmpty && cs.isEmpty()) return null;
      const lenW = spanW + padW * 2;
      ex = cs.extrude(lenW);
      const tx = wx * (wMin - padW), ty = wy * (wMin - padW);
      prism = ex.transform([dx, dy, 0, 0, 0, 0, 1, 0, wx, wy, 0, 0, tx, ty, 0, 1]);
      const cutSolids = [];
      for (const r of clipRings) {
        const cm = core.extrudeRingSolid(mf, r, [], zBottom - overlapBot - 0.1 / scaleMm, zTop + overlapTop + 0.2 / scaleMm);
        if (cm) cutSolids.push(cm);
      }
      if (cutSolids.length === 0) return null;
      cutter = cutSolids.length === 1 ? cutSolids[0] : core.batchUnionManifolds(mf, cutSolids);
      const clipped = prism.intersect(cutter);
      if (!clipped || clipped.numTri() === 0) {
        core.safeDeleteManifold(clipped);
        return null;
      }

      const beams = _buildSkillionFaceLatticeRelief(
        core, mf, outerBed, dx, dy, wx, wy,
        sMin, sMax, wMin, wMax, zEavesU, slope, zBottom, zTop,
        isOpenRoofShell, halfDz, scaleMm
      );
      if (beams.length === 0) return clipped;
      for (const bm of beams) reliefBeams.push(bm);
      const merged = core.batchUnionManifolds(mf, [clipped, ...reliefBeams]);
      reliefBeams.length = 0;
      return merged && merged.numTri() > 0 ? merged : null;
    } catch (_) {
      for (const bm of reliefBeams) core.safeDeleteManifold(bm);
      return null;
    } finally {
      core.safeDeleteManifold(cs);
      core.safeDeleteManifold(ex);
      core.safeDeleteManifold(prism);
      core.safeDeleteManifold(cutter);
    }
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

    // 1. Sloped S3DB skillion lattice face (e.g. multi-stage arched tower legs / tapered shafts):
    // preserve exact arch polygon geometry on the true inclined skillion plane instead of a boxy cage.
    const explicitRoofHM = Number(
      b && b.roofH !== undefined ? b.roofH : (tags && tags['roof:height'] !== undefined ? tags['roof:height'] : 0)
    ) || 0;
    const partSpanM = Math.max(1e-3, rawH - rawMinH);
    const isSlopedSkillionPanel = Boolean(
      b && b.part && b.roof === 'skillion' && Number.isFinite(b.roofDir) &&
      (explicitRoofHM >= partSpanM * 0.78 || String(tags.wall || '').toLowerCase() === 'no' || String(tags['building:part'] || '').toLowerCase() === 'roof')
    );
    if (isSlopedSkillionPanel) {
      const panel = _buildSlopedSkillionLatticePanel(core, mf, ctx, b, outerBed, tags, rawH, rawMinH, zBottom, zTop);
      if (panel) return panel;
    }

    // 2. Narrow top summit spire/antenna: emit a sleek tapered spire instead of a 6-corner cage.
    if (isNarrowSpire) {
      const protMm = Math.max(0.5, partH * scaleMm);
      const reqBaseR = (laws && typeof laws.minPinDiameterMm === 'function')
        ? (laws.minPinDiameterMm(protMm) * 0.5) / scaleMm
        : (0.34 / scaleMm);
      const rBot = Math.max(reqBaseR, Math.min(obb.spanU, obb.spanV) * 0.45);
      const rTop = Math.max(minPrintU * 0.35, Math.min(rBot * 0.32, 0.22 / scaleMm));
      return mf.Manifold.cylinder(partH + 0.25 / scaleMm, rBot, rTop, 10, false)
        .translate([obb.cx, obb.cy, zBottom - 0.25 / scaleMm]);
    }

    const corners = _extractPerimeterCorners(outerBed, 6);
    if (corners.length < 3) return null;
    const cCen = [corners.reduce((s, p) => s + p[0], 0) / corners.length, corners.reduce((s, p) => s + p[1], 0) / corners.length];
    let topCenter = cCen, taper = 0.35;
    if (b && b.roof === 'skillion' && Number.isFinite(b.roofDir)) {
      const rad = (b.roofDir * Math.PI) / 180.0, ux = Math.sin(rad), uy = Math.cos(rad);
      const proj = corners.map(c => (c[0] - cCen[0]) * ux + (c[1] - cCen[1]) * uy);
      const sMin = Math.min(...proj), sLim = sMin + 0.32 * Math.max(1e-4, Math.max(...proj) - sMin);
      const hiPts = corners.filter((_, idx) => proj[idx] <= sLim);
      if (hiPts.length > 0) topCenter = [hiPts.reduce((s, p) => s + p[0], 0) / hiPts.length, hiPts.reduce((s, p) => s + p[1], 0) / hiPts.length];
      taper = 0.24;
    }
    const topCorners = corners.map(c => [topCenter[0] + (c[0] - topCenter[0]) * taper, topCenter[1] + (c[1] - topCenter[1]) * taper]);
    const minorSpan = Math.min(obb.spanU, obb.spanV);
    const minStrutR = _minStrutRadU(ctx, Math.min(18.0, Math.max(2.5, minorSpan * scaleMm)));
    const legR = Math.max(minStrutR, minPrintU * 0.55, Math.min(minorSpan * 0.11, 0.65 / scaleMm));
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
