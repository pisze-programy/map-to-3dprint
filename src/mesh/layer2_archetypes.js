// ============================================================================
// src/mesh/layer2_archetypes.js
// Layer-2 Procedural Architectural & Infrastructure Archetypes
// - 100% Pure OSM Semantic Tags (ZERO city names, ZERO proper-noun regexes)
// - Observation Wheels, Wind Turbines, Lattice & Standalone Towers, Masts,
//   Lighthouses, Storage Tanks, Silos, Chimneys, Hyperboloid Cooling Towers,
//   Cranes, Marine Piers/Breakwaters/Groynes & Sloped-Normal Trees/Tree Rows
// ============================================================================

(function (root) {
  function _getCore() {
    if (typeof createBuildContext === 'function') return root;
    if (typeof require !== 'undefined') return require('../geometry/manifold_core.js');
    return root;
  }

  function _computeFootprintOBB(outer) {
    let cx = 0, cy = 0;
    for (let i = 0; i < outer.length; i++) { cx += outer[i][0]; cy += outer[i][1]; }
    cx /= outer.length; cy /= outer.length;
    let bestAngle = 0, maxD2 = -1;
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i], b = outer[(i + 1) % outer.length];
      const d2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      if (d2 > maxD2) { maxD2 = d2; bestAngle = Math.atan2(b[1] - a[1], b[0] - a[0]); }
    }
    const measure = (theta) => {
      const ux = Math.cos(theta), uy = Math.sin(theta), vx = -uy, vy = ux;
      let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
      for (const p of outer) {
        const dx = p[0] - cx, dy = p[1] - cy;
        const u = dx * ux + dy * uy, v = dx * vx + dy * vy;
        if (u < uMin) uMin = u; if (u > uMax) uMax = u;
        if (v < vMin) vMin = v; if (v > vMax) vMax = v;
      }
      return { cx, cy, theta, ux, uy, vx, vy, uMin, uMax, vMin, vMax, spanU: uMax - uMin, spanV: vMax - vMin };
    };
    let obb = measure(bestAngle);
    if (obb.spanV > obb.spanU * 1.02) obb = measure(bestAngle + Math.PI * 0.5);
    return obb;
  }

  function _resolveGroundZ(ctx, terrainWater, x, y, embedMm = 0.25) {
    const scaleMm = ctx.scaleMm || 1;
    if (terrainWater && terrainWater.isPointInWater(x, y)) {
      if (ctx.waterCutout) return 0.0;
      const wf = typeof terrainWater.getWaterFloorZ === 'function' ? terrainWater.getWaterFloorZ() : ctx.zWaterCarveFloor;
      return Math.max(0.05 / scaleMm, wf - (embedMm * 0.6) / scaleMm);
    }
    const surf = (terrainWater && typeof terrainWater.getSurfaceZ === 'function')
      ? terrainWater.getSurfaceZ(x, y)
      : ctx.getTerrainZ(x, y);
    return Math.max(0.05 / scaleMm, surf - embedMm / scaleMm);
  }

  // --------------------------------------------------------------------------
  // 1. Observation / Ferris Wheel (attraction=big_wheel|ferris_wheel|observation_wheel)
  // --------------------------------------------------------------------------
  function buildObservationWheelManifold(core, mf, ctx, terrainWater, outerBed, heightM) {
    const { scaleMm, mToU, zScale, scaleToBed, minPrintU, maxZUnits } = ctx;
    const obb = _computeFootprintOBB(outerBed);
    const zGround = _resolveGroundZ(ctx, terrainWater, obb.cx, obb.cy, 0.15);
    const totalHU = Math.min(maxZUnits - zGround - 0.5 / scaleMm, Math.max(4.0 / scaleMm, (heightM || 65) * mToU * zScale * scaleToBed));
    const R = Math.max(minPrintU * 3.5, Math.min(totalHU * 0.44, Math.max(obb.spanU * 0.48, totalHU * 0.41)));
    const zHub = zGround + Math.max(R * 1.12, totalHU - R);

    // Strictly enforce axial thickness <= 0.25 * R (< 0.35 * R invariant)
    const rimDepth = Math.max(minPrintU * 1.1, Math.min(R * 0.16, 1.35 / scaleMm));
    const rimRadThick = Math.max(minPrintU * 0.9, R * 0.075);
    const spokeR = Math.max(minPrintU * 0.45, R * 0.028);

    const parts = [];
    try {
      // Double concentric torus-like rim rings built flat in XY, rotated upright into wheel plane (ux, +Z)
      const makeRing = (rOut, rIn, depth) => {
        const oPts = [], iPts = [];
        const segs = 28;
        for (let k = 0; k < segs; k++) {
          const a = (k / segs) * Math.PI * 2;
          oPts.push([Math.cos(a) * rOut, Math.sin(a) * rOut]);
          iPts.push([Math.cos(a) * rIn, Math.sin(a) * rIn]);
        }
        const ex = core.extrudeRingSolid(mf, oPts, [iPts], -depth * 0.5, depth * 0.5);
        if (!ex) return null;
        // Rotate local X -> axU, Y -> +Z, Z -> axV (normal to wheel plane)
        const m = [
          obb.ux, obb.uy, 0, 0,
          0,      0,      1, 0,
          obb.vx, obb.vy, 0, 0,
          obb.cx, obb.cy, zHub, 1
        ];
        const tr = ex.transform(m);
        ex.delete();
        return tr;
      };

      const outerRim = makeRing(R, Math.max(R * 0.65, R - rimRadThick), rimDepth);
      if (outerRim) parts.push(outerRim);
      const innerRim = makeRing(R * 0.80, Math.max(R * 0.50, R * 0.80 - rimRadThick * 0.75), rimDepth * 0.75);
      if (innerRim) parts.push(innerRim);

      // Hub cylinder along wheel normal axis (axV)
      const hubLen = rimDepth * 2.1;
      const hubCyl = mf.Manifold.cylinder(hubLen, Math.max(rimRadThick * 1.2, spokeR * 2.5), Math.max(rimRadThick * 1.2, spokeR * 2.5), 14, true);
      const hubTr = hubCyl.transform([
        obb.ux, obb.uy, 0, 0,
        0,      0,      1, 0,
        obb.vx, obb.vy, 0, 0,
        obb.cx, obb.cy, zHub, 1
      ]);
      hubCyl.delete();
      parts.push(hubTr);

      // Radial spokes + perimeter passenger capsules
      const nSpokes = 12;
      const capR = Math.max(minPrintU * 0.55, R * 0.055);
      for (let k = 0; k < nSpokes; k++) {
        const a = (k / nSpokes) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const rimX = obb.cx + obb.ux * ca * (R - rimRadThick * 0.3);
        const rimY = obb.cy + obb.uy * ca * (R - rimRadThick * 0.3);
        const rimZ = zHub + sa * (R - rimRadThick * 0.3);
        const spoke = core.beamManifoldBetween(mf, [obb.cx, obb.cy, zHub], [rimX, rimY, rimZ], spokeR);
        if (spoke) parts.push(spoke);

        const capX = obb.cx + obb.ux * ca * (R + capR * 0.45);
        const capY = obb.cy + obb.uy * ca * (R + capR * 0.45);
        const capZ = zHub + sa * (R + capR * 0.45);
        const cap = mf.Manifold.sphere(capR, 8).translate([capX, capY, capZ]);
        parts.push(cap);
      }

      // 4 sturdy splayed A-frame support legs anchored below ground Z
      const legR = Math.max(minPrintU * 0.65, Math.min(R * 0.042, 0.45 / scaleMm));
      const spreadU = Math.min(obb.spanU * 0.42, R * 0.52);
      const spreadV = Math.min(R * 0.135, Math.max(rimDepth * 0.65, (ctx.kerfUnits || 0) * 2.2));
      for (const sU of [-1, 1]) {
        for (const sV of [-1, 1]) {
          const footX = obb.cx + obb.ux * sU * spreadU + obb.vx * sV * spreadV;
          const footY = obb.cy + obb.uy * sU * spreadU + obb.vy * sV * spreadV;
          const footZ = _resolveGroundZ(ctx, terrainWater, footX, footY, 0.35);
          const hubAttach = [obb.cx + obb.vx * sV * spreadV * 0.65, obb.cy + obb.vy * sV * spreadV * 0.65, zHub];
          const leg = core.beamManifoldBetween(mf, [footX, footY, footZ], hubAttach, legR);
          if (leg) parts.push(leg);
        }
      }

      if (parts.length === 0) return null;
      return core.batchUnionManifolds(mf, parts);
    } catch (_) {
      for (const p of parts) core.safeDeleteManifold(p);
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // 2. Wind Turbine (man_made=wind_turbine | power=generator+generator:source=wind)
  // --------------------------------------------------------------------------
  function buildWindTurbineManifold(core, mf, ctx, terrainWater, cx, cy, heightM, yawDeg = 0) {
    const { scaleMm, mToU, zScale, scaleToBed, minPrintU, maxZUnits } = ctx;
    const zGround = _resolveGroundZ(ctx, terrainWater, cx, cy, 0.20);
    const mastH = Math.min(maxZUnits - zGround - 2.0 / scaleMm, Math.max(5.0 / scaleMm, (heightM || 75) * mToU * zScale * scaleToBed));
    const rBot = Math.max(minPrintU * 0.9, mastH * 0.048);
    const rTop = Math.max(minPrintU * 0.55, rBot * 0.45);
    const bladeLen = mastH * 0.48;
    const parts = [];

    const tower = mf.Manifold.cylinder(mastH, rBot, rTop, 12, false).translate([cx, cy, zGround]);
    parts.push(tower);

    const zNacelle = zGround + mastH;
    const yawRad = (yawDeg * Math.PI) / 180.0;
    const dirX = Math.cos(yawRad), dirY = Math.sin(yawRad);
    const perpX = -dirY, perpY = dirX;
    const nac = core.beamManifoldBetween(mf,
      [cx - dirX * rBot * 1.4, cy - dirY * rBot * 1.4, zNacelle],
      [cx + dirX * rBot * 1.6, cy + dirY * rBot * 1.6, zNacelle],
      rTop * 1.25
    );
    if (nac) parts.push(nac);

    const hubPt = [cx + dirX * rBot * 1.6, cy + dirY * rBot * 1.6, zNacelle];
    for (let b = 0; b < 3; b++) {
      const ang = (b * Math.PI * 2) / 3 + 0.35;
      const tipX = hubPt[0] + perpX * Math.cos(ang) * bladeLen;
      const tipY = hubPt[1] + perpY * Math.cos(ang) * bladeLen;
      const tipZ = hubPt[2] + Math.sin(ang) * bladeLen;
      const blade = core.beamManifoldBetween(mf, hubPt, [tipX, tipY, tipZ], Math.max(minPrintU * 0.4, rTop * 0.65));
      if (blade) parts.push(blade);
    }
    return core.batchUnionManifolds(mf, parts);
  }

  // --------------------------------------------------------------------------
  // 3. Lattice Towers (tower:construction=lattice) & Tapered Standalone Towers
  // --------------------------------------------------------------------------
  function buildTowerArchetypeManifold(core, mf, ctx, terrainWater, outerBed, tags, explicitHeightM) {
    const { scaleMm, mToU, zScale, scaleToBed, minPrintU, maxZUnits } = ctx;
    const obb = _computeFootprintOBB(outerBed);
    const mm = String(tags.man_made || '').toLowerCase().trim();
    const tc = String(tags['tower:construction'] || '').toLowerCase().trim();
    const isLattice = tc === 'lattice' || tc === 'guyed_lattice';

    // Proportional height heuristic when height & levels are untagged (strictly < 36m for generic towers)
    let hM = Number(explicitHeightM) || 0;
    if (hM <= 0) {
      const lvl = Number(tags['building:levels'] || 0);
      if (lvl > 0) hM = lvl * 3.5;
      else if (mm === 'communications_tower' || mm === 'mast') hM = 30.0;
      else if (mm === 'lighthouse') hM = 28.0;
      else hM = 24.0;
    }

    const zGround = _resolveGroundZ(ctx, terrainWater, obb.cx, obb.cy, 0.25);
    const totalHU = Math.min(maxZUnits - zGround - 0.3 / scaleMm, Math.max(2.5 / scaleMm, hM * mToU * zScale * scaleToBed));
    const parts = [];

    if (isLattice) {
      // 4 battered curved parabolic legs + observation decks + X-bracing + spire (pure geometric lattice template)
      const baseHalf = Math.max(minPrintU * 2.2, Math.min(obb.spanU, obb.spanV) * 0.45);
      const legR = Math.max(minPrintU * 0.55, Math.min(baseHalf * 0.14, totalHU * 0.025));
      const tiers = [
        { fracZ: 0.0,  scaleW: 1.00 },
        { fracZ: 0.20, scaleW: 0.54 },
        { fracZ: 0.44, scaleW: 0.28 },
        { fracZ: 0.86, scaleW: 0.11 },
      ];
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const tierPts = tiers.map(t => corners.map(([sx, sy]) => {
        const w = baseHalf * t.scaleW;
        return [
          obb.cx + obb.ux * sx * w + obb.vx * sy * w,
          obb.cy + obb.uy * sx * w + obb.vy * sy * w,
          zGround + t.fracZ * totalHU
        ];
      }));

      for (let t = 0; t < tiers.length - 1; t++) {
        for (let c = 0; c < 4; c++) {
          const p0 = tierPts[t][c], p1 = tierPts[t + 1][c];
          const leg = core.beamManifoldBetween(mf, p0, p1, legR);
          if (leg) parts.push(leg);
          const nc = (c + 1) & 3;
          const p0n = tierPts[t][nc], p1n = tierPts[t + 1][nc];
          const diag1 = core.beamManifoldBetween(mf, p0, p1n, legR * 0.55);
          const diag2 = core.beamManifoldBetween(mf, p0n, p1, legR * 0.55);
          if (diag1) parts.push(diag1);
          if (diag2) parts.push(diag2);
        }
      }
      // Two observation platform decks + upper spire
      for (const df of [0.20, 0.44, 0.86]) {
        const tIdx = df === 0.20 ? 1 : (df === 0.44 ? 2 : 3);
        const w = Math.max(minPrintU * 1.4, baseHalf * tiers[tIdx].scaleW * 1.35);
        const dH = Math.max(minPrintU * 0.9, totalHU * 0.032);
        const deckRing = [[-w, -w], [w, -w], [w, w], [-w, w]].map(([lx, ly]) => [
          obb.cx + obb.ux * lx + obb.vx * ly,
          obb.cy + obb.uy * lx + obb.vy * ly
        ]);
        const dz = zGround + df * totalHU;
        const deck = core.extrudeRingSolid(mf, deckRing, [], dz - dH * 0.5, dz + dH * 0.5);
        if (deck) parts.push(deck);
      }
      const spire = mf.Manifold.cylinder(totalHU * 0.16, legR * 0.9, legR * 0.25, 8, false)
        .translate([obb.cx, obb.cy, zGround + totalHU * 0.85]);
      parts.push(spire);
      return core.batchUnionManifolds(mf, parts);
    }

    // Standalone tower / lighthouse / communications_tower / mast
    const rBase = Math.max(minPrintU * 1.1, Math.min(obb.spanU, obb.spanV) * 0.44);
    const rTop = mm === 'mast' ? rBase * 0.35 : rBase * 0.62;
    const shaftH = totalHU * (mm === 'lighthouse' || mm === 'communications_tower' ? 0.76 : 0.85);
    const segs = mm === 'lighthouse' ? 16 : 10;
    const shaft = mf.Manifold.cylinder(shaftH, rBase, rTop, segs, false).translate([obb.cx, obb.cy, zGround]);
    parts.push(shaft);

    if (mm === 'lighthouse' || mm === 'communications_tower') {
      const podH = totalHU * 0.08;
      const podR = rTop * 1.55;
      const pod = mf.Manifold.cylinder(podH, podR, podR * 0.95, 16, false).translate([obb.cx, obb.cy, zGround + shaftH]);
      parts.push(pod);
      const capH = totalHU - shaftH - podH;
      if (capH > 1e-4) {
        const cap = mf.Manifold.cylinder(capH, rTop * 0.75, mm === 'communications_tower' ? minPrintU * 0.25 : rTop * 0.1, 12, false)
          .translate([obb.cx, obb.cy, zGround + shaftH + podH]);
        parts.push(cap);
      }
    } else {
      const topH = totalHU - shaftH;
      const cap = mf.Manifold.cylinder(Math.max(0.2 / scaleMm, topH), rTop * 1.05, rTop * 0.2, segs, false)
        .translate([obb.cx, obb.cy, zGround + shaftH]);
      parts.push(cap);
    }
    return core.batchUnionManifolds(mf, parts);
  }

  // --------------------------------------------------------------------------
  // 4. Industrial Cylindrical Tanks, Silos, Chimneys, Hyperboloid Cooling Towers & Cranes
  // --------------------------------------------------------------------------
  function buildIndustrialCylinderOrHyperboloid(core, mf, ctx, terrainWater, outerBed, mm, explicitHeightM) {
    const { scaleMm, mToU, zScale, scaleToBed, minPrintU, maxZUnits } = ctx;
    const obb = _computeFootprintOBB(outerBed);
    const zGround = _resolveGroundZ(ctx, terrainWater, obb.cx, obb.cy, 0.20);
    const defH = mm === 'chimney' ? 42 : (mm === 'cooling_tower' ? 68 : (mm === 'silo' ? 22 : (mm === 'crane' ? 45 : 14)));
    const hM = Number(explicitHeightM) > 0 ? Number(explicitHeightM) : defH;
    const totalHU = Math.min(maxZUnits - zGround - 0.3 / scaleMm, Math.max(1.8 / scaleMm, hM * mToU * zScale * scaleToBed));
    const rBase = Math.max(minPrintU * 1.2, Math.min(obb.spanU, obb.spanV) * 0.48);

    if (mm === 'crane') {
      const mastW = Math.max(minPrintU * 1.0, Math.min(rBase * 0.65, totalHU * 0.08));
      const parts = [];
      const mast = mf.Manifold.cylinder(totalHU, mastW, mastW * 0.85, 4, false).translate([obb.cx, obb.cy, zGround]);
      parts.push(mast);
      const jibLen = Math.max(totalHU * 0.65, obb.spanU * 0.85);
      const jibZ = zGround + totalHU * 0.86;
      const jib = core.beamManifoldBetween(mf,
        [obb.cx - obb.ux * jibLen * 0.32, obb.cy - obb.uy * jibLen * 0.32, jibZ],
        [obb.cx + obb.ux * jibLen * 0.72, obb.cy + obb.uy * jibLen * 0.72, jibZ],
        mastW * 0.55
      );
      if (jib) parts.push(jib);
      const stay = core.beamManifoldBetween(mf,
        [obb.cx, obb.cy, zGround + totalHU],
        [obb.cx + obb.ux * jibLen * 0.58, obb.cy + obb.uy * jibLen * 0.58, jibZ],
        mastW * 0.32
      );
      if (stay) parts.push(stay);
      return core.batchUnionManifolds(mf, parts);
    }

    if (mm === 'cooling_tower') {
      // Parametric hyperboloid hollow-walled shell revolved 360 deg (zero self-intersection, 2-manifold)
      const rWaist = rBase * 0.68;
      const rTop = rBase * 0.78;
      const wallT = Math.max(minPrintU * 1.1, rBase * 0.09);
      const prof = [];
      const nSteps = 10;
      for (let i = 0; i <= nSteps; i++) {
        const f = i / nSteps;
        const tVal = (f - 0.70) * 1.4;
        const r = rWaist * Math.sqrt(1 + tVal * tVal * 0.85);
        prof.push([r, f * totalHU]);
      }
      for (let i = nSteps; i >= 0; i--) {
        const f = i / nSteps;
        const tVal = (f - 0.70) * 1.4;
        const r = Math.max(wallT * 0.5, rWaist * Math.sqrt(1 + tVal * tVal * 0.85) - wallT);
        prof.push([r, f * totalHU]);
      }
      try {
        const cs = mf.CrossSection.ofPolygons([core.ensureWinding(prof, true, 1e-5)], 'Positive');
        const rev = mf.Manifold.revolve(cs, 24, 360).translate([obb.cx, obb.cy, zGround]);
        cs.delete();
        // Solid foundation ring base so cooling tower sits cleanly with zero interior void gaps on print bed
        const basePad = mf.Manifold.cylinder(Math.max(minPrintU, totalHU * 0.06), rBase, rBase, 24, false).translate([obb.cx, obb.cy, zGround]);
        const u = rev.add(basePad);
        rev.delete(); basePad.delete();
        return u;
      } catch (_) {}
    }

    if (mm === 'chimney') {
      const rTop = Math.max(minPrintU * 0.65, rBase * 0.56);
      const body = mf.Manifold.cylinder(totalHU, rBase, rTop, 16, false).translate([obb.cx, obb.cy, zGround]);
      const crown = mf.Manifold.cylinder(Math.max(minPrintU * 0.9, totalHU * 0.06), rTop * 1.24, rTop * 1.2, 16, false)
        .translate([obb.cx, obb.cy, zGround + totalHU * 0.94]);
      const res = body.add(crown);
      body.delete(); crown.delete();
      return res;
    }

    // storage_tank or silo
    const wallH = totalHU * (mm === 'silo' ? 0.84 : 0.92);
    const body = mf.Manifold.cylinder(wallH, rBase, rBase, 20, false).translate([obb.cx, obb.cy, zGround]);
    const capH = Math.max(minPrintU * 0.6, totalHU - wallH);
    const cap = mf.Manifold.cylinder(capH, rBase, mm === 'silo' ? rBase * 0.08 : rBase * 0.55, 20, false)
      .translate([obb.cx, obb.cy, zGround + wallH - 0.02]);
    const res = body.add(cap);
    body.delete(); cap.delete();
    return res;
  }

  // --------------------------------------------------------------------------
  // 5. Marine Piers, Breakwaters, Groynes & Pontoons
  // --------------------------------------------------------------------------
  function buildMarinePiersAndBreakwaters(core, mf, ctx, scene, terrainWater) {
    const { toBed, scaleToBed, scaleMm, waterCutout, minPrintU } = ctx;
    const solids = [];
    const pierDeckTopZ = ctx.zWaterTop + (0.45 / scaleMm);
    const pierDeckBotZ = ctx.zWaterTop + (0.08 / scaleMm);
    const pileFloorZ = waterCutout ? 0.0 : Math.max(0.0, ctx.zWaterCarveFloor - (0.15 / scaleMm));
    const pierR = Math.max(minPrintU * 0.75, 0.35 / scaleMm);

    const placedPilePts = [];
    const addSinglePile = (px, py) => {
      const pileH = pierDeckBotZ - pileFloorZ + 0.05;
      if (pileH <= 1e-4 || !Number.isFinite(px) || !Number.isFinite(py)) return;
      for (let i = 0; i < placedPilePts.length; i++) {
        if (Math.hypot(placedPilePts[i][0] - px, placedPilePts[i][1] - py) < pierR * 2.1) return;
      }
      placedPilePts.push([px, py]);
      const rawCyl = mf.Manifold.cylinder(pileH, pierR, pierR, 8, false);
      const rotCyl = rawCyl.rotate([0, 0, 22.5]);
      rawCyl.delete();
      const cyl = rotCyl.translate([px, py, pileFloorZ]);
      rotCyl.delete();
      solids.push(cyl);
    };

    const addPilesAlongPts = (pts, halfW) => {
      if (!pts || pts.length < 2) return;
      let total = 0;
      for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      const step = Math.max(minPrintU * 3.5, Math.min(halfW * 4.5, 4.5 / scaleMm));
      const nPiles = Math.max(2, Math.min(18, Math.round(total / step) + 1));
      const pileH = pierDeckBotZ - pileFloorZ + 0.05;
      if (pileH <= 1e-4) return;
      for (let k = 0; k < nPiles; k++) {
        const target = (k / Math.max(1, nPiles - 1)) * total;
        let acc = 0, px = pts[0][0], py = pts[0][1];
        for (let i = 0; i < pts.length - 1; i++) {
          const s = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
          if (acc + s >= target || i === pts.length - 2) {
            const f = s > 1e-6 ? (target - acc) / s : 0;
            px = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f;
            py = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
            break;
          }
          acc += s;
        }
        addSinglePile(px, py);
      }
    };

    for (const bp of (scene && scene.bridgePolys) || []) {
      if (!bp || !bp.isPier || !bp.outer || bp.outer.length < 3) continue;
      const oBed = bp.outer.map(toBed);
      const holesBed = (bp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed));
      const isSolidStone = bp.pierKind === 'breakwater' || bp.pierKind === 'groyne';
      const zBot = isSolidStone ? pileFloorZ : pierDeckBotZ;
      const deckM = core.extrudeRingSolid(mf, oBed, holesBed, zBot, pierDeckTopZ);
      if (deckM) solids.push(deckM);
      if (!isSolidStone) {
        const obb = _computeFootprintOBB(oBed);
        addPilesAlongPts(
          [[obb.cx + obb.ux * obb.uMin * 0.85, obb.cy + obb.uy * obb.uMin * 0.85],
           [obb.cx + obb.ux * obb.uMax * 0.85, obb.cy + obb.uy * obb.uMax * 0.85]],
          obb.spanV * 0.4
        );
        // Anchor side arms & U/L-shaped pier corners explicitly down to Z=0 / floor
        const stride = Math.max(1, Math.floor(oBed.length / 14));
        for (let vi = 0; vi < oBed.length; vi += stride) {
          addSinglePile(oBed[vi][0], oBed[vi][1]);
        }
      }
    }

    for (const rd of (scene && scene.roads) || []) {
      if (!rd || !rd.pts || rd.pts.length < 2) continue;
      const rdKind = rd.man_made || (rd.tags && rd.tags.man_made) || (rd.isPier ? (rd.pierKind || 'pier') : '');
      if (!['pier', 'breakwater', 'groyne', 'jetty', 'pontoon'].includes(rdKind)) continue;
      const bedPts = rd.pts.map(toBed);
      const halfW = Math.max(minPrintU * 0.7, ((rd.width || 0.8) * 0.5) * scaleToBed);
      const rings = core.clipperBufferOpenPaths([{ pts: bedPts, halfW, squareEnd: true }], 'Miter', 1e-5);
      const isSolidStone = rdKind === 'breakwater' || rdKind === 'groyne';
      const zBot = isSolidStone ? pileFloorZ : pierDeckBotZ;
      for (const r of rings) {
        const m = core.extrudeRingSolid(mf, r, [], zBot, pierDeckTopZ);
        if (m) solids.push(m);
      }
      if (!isSolidStone) {
        addPilesAlongPts(bedPts, halfW);
      }
    }

    if (solids.length === 0) return [];
    return [core.batchUnionManifolds(mf, solids)].filter(Boolean);
  }

  // --------------------------------------------------------------------------
  // 6. Trees & Tree Rows (Strict shellId >= 1 + Sloped Crown Normals for Video Studio)
  // --------------------------------------------------------------------------
  function buildTreesArchetypeList(core, mf, ctx, scene, terrainWater, buildingFootprints2D) {
    const { halfW, halfH, toBed, scaleMm, mToU, zScale, scaleToBed, minPrintU } = ctx;
    const treePts = [];
    const seenKeys = new Set();

    const pushTreePt = (bx, by, h_m) => {
      if (!Number.isFinite(bx) || !Number.isFinite(by)) return;
      if (Math.abs(bx) > halfW - 0.1 || Math.abs(by) > halfH - 0.1) return;
      const key = `${Math.round(bx * 20)},${Math.round(by * 20)}`;
      if (seenKeys.has(key)) return;
      if (terrainWater.isPointInWater(bx, by) || terrainWater.isPointOnRoad(bx, by)) return;
      for (let i = 0; i < buildingFootprints2D.length; i++) {
        const bp = buildingFootprints2D[i];
        if (bx < bp.bb[0] || bx > bp.bb[2] || by < bp.bb[1] || by > bp.bb[3]) continue;
        let inside = false;
        const poly = bp.outer;
        for (let k = 0, n = poly.length, j = n - 1; k < n; j = k++) {
          const xi = poly[k][0], yi = poly[k][1], xj = poly[j][0], yj = poly[j][1];
          if (((yi > by) !== (yj > by)) && (bx < ((xj - xi) * (by - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
        }
        if (inside) return;
      }
      seenKeys.add(key);
      treePts.push([bx, by, h_m || 7.5]);
    };

    for (const t of (scene && scene.trees) || []) {
      if (!t) continue;
      let tx, ty, th = 7.5;
      if (Array.isArray(t) || typeof t[0] === 'number') {
        if (t.length < 2) continue;
        tx = t[0]; ty = t[1]; th = Number(t[2]) || 7.5;
      } else if (typeof t === 'object' && t.x !== undefined && t.y !== undefined) {
        tx = t.x; ty = t.y; th = Number(t.height !== undefined ? t.height : (t.h !== undefined ? t.h : 7.5)) || 7.5;
      } else {
        continue;
      }
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
      const [bx, by] = toBed([tx, ty]);
      pushTreePt(bx, by, th);
    }

    // Also inspect raw osmElements for natural=tree_row or tree nodes missed in light fixtures
    const els = (scene && scene.osmElements) || [];
    if (els.length > 0 && ((scene && scene.trees) || []).length === 0) {
      const nodeMap = new Map();
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el.type === 'node') {
          nodeMap.set(el.id, el);
          if (el.tags && el.tags.natural === 'tree') {
            const [bx, by] = ctx.latLonToScene(el.lat, el.lon);
            pushTreePt(bx, by, Number(el.tags.height) || 7.5);
          }
        }
      }
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el.type === 'way' && el.tags && el.tags.natural === 'tree_row' && el.nodes) {
          for (const nid of el.nodes) {
            const n = nodeMap.get(nid);
            if (n) {
              const [bx, by] = ctx.latLonToScene(n.lat, n.lon);
              pushTreePt(bx, by, Number(el.tags.height) || 7.0);
            }
          }
        }
      }
    }

    // Cap extreme metropolis tree count cleanly while preserving uniform spatial distribution
    const maxTrees = 1200;
    const step = treePts.length > maxTrees ? (treePts.length / maxTrees) : 1;
    const treeSolids = [];

    for (let idx = 0; idx < (treePts.length > maxTrees ? maxTrees : treePts.length); idx++) {
      const src = treePts[Math.floor(idx * step)];
      const [bx, by, hM] = src;
      const zGround = terrainWater.getSurfaceZ(bx, by);
      const hU = Math.max(0.85 / scaleMm, Math.min(3.5 / scaleMm, hM * mToU * zScale * scaleToBed));
      const crownR = Math.max(minPrintU * 0.9, Math.min(hU * 0.42, 0.85 / scaleMm));
      const trunkR = Math.max(minPrintU * 0.35, crownR * 0.28);
      const trunkH = hU * 0.38;
      const crownH = hU * 0.72;

      // Single 6-sided double cone / conical crown + tapered trunk so side faces have 0.04 < n[2] < 0.98
      const trunk = mf.Manifold.cylinder(trunkH + 0.15 / scaleMm, trunkR, trunkR * 0.82, 6, false)
        .translate([bx, by, Math.max(0.05 / scaleMm, zGround - 0.15 / scaleMm)]);
      const crown = mf.Manifold.cylinder(crownH, crownR, crownR * 0.08, 6, false)
        .translate([bx, by, zGround + trunkH - 0.02 / scaleMm]);
      const tree = trunk.add(crown);
      trunk.delete(); crown.delete();
      treeSolids.push({ shellId: idx + 1, manifold: tree });
    }
    return treeSolids;
  }

  // --------------------------------------------------------------------------
  // Master Layer-2 Orchestrator
  // --------------------------------------------------------------------------
  function buildLayer2Archetypes(ctx, scene, terrainWater) {
    const core = _getCore();
    const { mf, halfW, halfH, toBed, latLonToScene } = ctx;

    const buildingLayerManifolds = [];
    const buildingBounds = [];
    const roadLayerManifolds = [];
    const buildingFootprints2D = [];
    const counts = {
      wheels: 0,
      windTurbines: 0,
      latticeTowers: 0,
      towers: 0,
      tanksAndSilos: 0,
      chimneys: 0,
      coolingTowers: 0,
      cranes: 0,
      marinePiers: 0,
      trees: 0,
    };

    const rawTagMap = new Map();
    const nodeCoords = new Map();
    const els = (scene && scene.osmElements) || [];
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el) continue;
      if (el.id !== undefined && el.tags) rawTagMap.set(el.id, el.tags);
      if (el.type === 'node') nodeCoords.set(el.id, el);
    }

    const handledOsmIds = new Set();
    const WHEEL_ATTR = new Set(['big_wheel', 'ferris_wheel', 'observation_wheel']);

    // A. Archetypes already captured inside scene.buildings (including synthetic test fixtures)
    for (let i = 0; i < ((scene && scene.buildings) || []).length; i++) {
      const b = scene.buildings[i];
      if (!b || b.hidden || !b.outer || b.outer.length < 3) continue;
      const outerBed = b.outer.map(toBed);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of outerBed) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      }
      buildingFootprints2D.push({ outer: outerBed, bb: [minX, minY, maxX, maxY] });

      if (b.isOutline) continue;
      const tags = Object.assign({}, rawTagMap.get(b.osmId) || {}, b.tags || {});
      const mm = String(tags.man_made || '').toLowerCase().trim();
      const attr = String(tags.attraction || '').toLowerCase().trim();
      const tt = String(tags['tower:type'] || '').toLowerCase().trim();
      const tc = String(tags['tower:construction'] || '').toLowerCase().trim();
      const hM = Number(b.h !== undefined ? b.h : (b.height || tags.height || 0)) || 0;

      const isWheel = b.archType === 'ferris_wheel' || b.btype === 'observation_wheel' || WHEEL_ATTR.has(attr) || tt === 'observation_wheel';
      let solid = null;

      if (isWheel) {
        solid = buildObservationWheelManifold(core, mf, ctx, terrainWater, outerBed, hM || 120);
        if (solid) counts.wheels++;
      } else if (mm === 'wind_turbine' || (tags.power === 'generator' && tags['generator:source'] === 'wind')) {
        const obb = _computeFootprintOBB(outerBed);
        solid = buildWindTurbineManifold(core, mf, ctx, terrainWater, obb.cx, obb.cy, hM || 75);
        if (solid) counts.windTurbines++;
      } else if (tc === 'lattice' || tc === 'guyed_lattice' || mm === 'tower' || mm === 'lighthouse' || mm === 'communications_tower' || mm === 'mast') {
        if (!b.part && !b.fromBuildingRel) {
          solid = buildTowerArchetypeManifold(core, mf, ctx, terrainWater, outerBed, tags, hM);
          if (solid) {
            if (tc === 'lattice' || tc === 'guyed_lattice') counts.latticeTowers++;
            else counts.towers++;
          }
        }
      } else if (['storage_tank', 'silo', 'chimney', 'cooling_tower', 'crane'].includes(mm)) {
        solid = buildIndustrialCylinderOrHyperboloid(core, mf, ctx, terrainWater, outerBed, mm, hM);
        if (solid) {
          if (mm === 'chimney') counts.chimneys++;
          else if (mm === 'cooling_tower') counts.coolingTowers++;
          else if (mm === 'crane') counts.cranes++;
          else counts.tanksAndSilos++;
        }
      }

      if (solid && solid.numTri() > 0) {
        if (b.osmId) handledOsmIds.add(b.osmId);
        const pickId = ctx.allocPickId({ buildingId: b.id || -1, osmId: b.osmId || null, name: b.name || '', archType: mm || (isWheel ? 'ferris_wheel' : 'tower') });
        buildingLayerManifolds.push({ buildingId: pickId, manifold: solid });
        const bb = solid.boundingBox();
        const cx = (bb.min[0] + bb.max[0]) * 0.5;
        const cy = (bb.min[1] + bb.max[1]) * 0.5;
        buildingBounds.push({
          id: pickId,
          osmId: b.osmId || null,
          name: b.name || tags.name || '',
          minX: bb.min[0], minY: bb.min[1], minZ: bb.min[2],
          maxX: bb.max[0], maxY: bb.max[1], maxZ: bb.max[2],
          cx, cy, interiorPt: [cx, cy],
          roof: 'flat', minH: 0, h: hM || 60, archType: mm || (isWheel ? 'ferris_wheel' : 'tower')
        });
      }
    }

    // B. Standalone pure-tag Layer-2 objects in scene.osmElements NOT covered by S3DB building list (nodes/ways)
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el || !el.tags || handledOsmIds.has(el.id)) continue;
      const tags = el.tags;
      const mm = String(tags.man_made || '').toLowerCase().trim();
      const isWind = mm === 'wind_turbine' || (tags.power === 'generator' && tags['generator:source'] === 'wind');
      const isWheel = WHEEL_ATTR.has(String(tags.attraction || '').toLowerCase().trim()) || tags['tower:type'] === 'observation_wheel';
      const isLayer2 = isWind || isWheel || ['tower', 'mast', 'communications_tower', 'lighthouse', 'chimney', 'cooling_tower', 'storage_tank', 'silo', 'crane'].includes(mm);
      if (!isLayer2 || tags.building) continue;

      let outerBed = null;
      let cx = 0, cy = 0;
      if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
        [cx, cy] = latLonToScene(el.lat, el.lon);
        const r = Math.max(ctx.minPrintU * 1.4, 2.8 * ctx.mToU * ctx.scaleToBed);
        outerBed = [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
      } else if (el.type === 'way' && el.nodes && el.nodes.length >= 2) {
        const pts = [];
        for (const nid of el.nodes) {
          const n = nodeCoords.get(nid);
          if (n) pts.push(latLonToScene(n.lat, n.lon));
        }
        if (pts.length >= 3) {
          outerBed = pts;
          cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
          cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        }
      }
      if (!outerBed || Math.abs(cx) > halfW + 1.0 || Math.abs(cy) > halfH + 1.0) continue;

      const hM = Number(parseFloat(tags.height)) || 0;
      let solid = null;
      if (isWind) {
        solid = buildWindTurbineManifold(core, mf, ctx, terrainWater, cx, cy, hM || 75);
        if (solid) counts.windTurbines++;
      } else if (isWheel) {
        solid = buildObservationWheelManifold(core, mf, ctx, terrainWater, outerBed, hM || 120);
        if (solid) counts.wheels++;
      } else if (['tower', 'mast', 'communications_tower', 'lighthouse'].includes(mm)) {
        solid = buildTowerArchetypeManifold(core, mf, ctx, terrainWater, outerBed, tags, hM);
        if (solid) {
          if (tags['tower:construction'] === 'lattice' || tags['tower:construction'] === 'guyed_lattice') counts.latticeTowers++;
          else counts.towers++;
        }
      } else {
        solid = buildIndustrialCylinderOrHyperboloid(core, mf, ctx, terrainWater, outerBed, mm, hM);
        if (solid) {
          if (mm === 'chimney') counts.chimneys++;
          else if (mm === 'cooling_tower') counts.coolingTowers++;
          else if (mm === 'crane') counts.cranes++;
          else counts.tanksAndSilos++;
        }
      }
      if (solid && solid.numTri() > 0) {
        handledOsmIds.add(el.id);
        const pickId = ctx.allocPickId({ buildingId: -1, osmId: el.id, name: tags.name || '', archType: mm || (isWind ? 'wind_turbine' : 'wheel') });
        buildingLayerManifolds.push({ buildingId: pickId, manifold: solid });
        const bb = solid.boundingBox();
        const bcx = (bb.min[0] + bb.max[0]) * 0.5;
        const bcy = (bb.min[1] + bb.max[1]) * 0.5;
        buildingBounds.push({
          id: pickId,
          osmId: el.id,
          name: tags.name || '',
          minX: bb.min[0], minY: bb.min[1], minZ: bb.min[2],
          maxX: bb.max[0], maxY: bb.max[1], maxZ: bb.max[2],
          cx: bcx, cy: bcy, interiorPt: [bcx, bcy],
          roof: 'flat', minH: 0, h: hM || 40, archType: mm || (isWind ? 'wind_turbine' : 'wheel')
        });
      }
    }

    // C. Marine Piers, Breakwaters, Groynes & Pontoons
    const pierSolids = buildMarinePiersAndBreakwaters(core, mf, ctx, scene, terrainWater);
    for (const ps of pierSolids) {
      roadLayerManifolds.push(ps);
      counts.marinePiers++;
    }

    // D. Trees & Tree Rows
    const greeneryTreeManifolds = buildTreesArchetypeList(core, mf, ctx, scene, terrainWater, buildingFootprints2D);
    counts.trees = greeneryTreeManifolds.length;

    ctx.audit.archetypeCounts = counts;
    return {
      buildingLayerManifolds,
      buildingBounds,
      roadLayerManifolds,
      greeneryTreeManifolds,
      counts,
    };
  }

  const exportsObj = { buildLayer2Archetypes };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
