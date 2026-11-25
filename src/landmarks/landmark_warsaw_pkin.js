// ============================================================================
// src/landmarks/landmark_warsaw_pkin.js
// Curated Geo-Anchored Hero Landmark: Palac Kultury i Nauki (237 m)
// Watertight 2-manifold stepped limestone podium, colonnade wings, Sala
// Kongresowa apse, 4 flanking pavilions, 4 octagonal corner shoulder turrets,
// fluted central tower shaft, 4 protruding clock dials, cupola & steel spire.
// ============================================================================

(function (root) {
  'use strict';

  if (typeof root.registerHeroLandmark !== 'function' && typeof require === 'function') {
    Object.assign(root, require('./landmark_registry.js'));
  }

  /** @param {function(number, number): [number, number]} toBedXY @param {number[][]} ptsM @returns {number[][]} */
  function _polyBed(toBedXY, ptsM) {
    return ptsM.map((p) => toBedXY(p[0], p[1]));
  }

  /** @param {function(number, number): [number, number]} toBedXY @returns {number[][]} */
  function _rectBed(toBedXY, x0, x1, y0, y1) {
    return [toBedXY(x0, y0), toBedXY(x1, y0), toBedXY(x1, y1), toBedXY(x0, y1)];
  }

  /** @param {function(number, number): [number, number]} toBedXY @returns {number[][]} */
  function _chamferBoxBed(toBedXY, cx, cy, hx, hy, chamM) {
    const c = Math.max(0.1, Math.min(Math.min(hx, hy) * 0.45, chamM));
    return [
      toBedXY(cx - hx + c, cy - hy), toBedXY(cx + hx - c, cy - hy),
      toBedXY(cx + hx, cy - hy + c), toBedXY(cx + hx, cy + hy - c),
      toBedXY(cx + hx - c, cy + hy), toBedXY(cx - hx + c, cy + hy),
      toBedXY(cx - hx, cy + hy - c), toBedXY(cx - hx, cy - hy + c),
    ];
  }

  /** @param {function(number, number): [number, number]} toBedXY @returns {number[][]} */
  function _regPolyBed(toBedXY, cx, cy, radM, sides, phaseRad = 0) {
    const pts = new Array(sides);
    for (let i = 0; i < sides; i++) {
      const a = phaseRad + (i / sides) * Math.PI * 2;
      pts[i] = toBedXY(cx + Math.cos(a) * radM, cy + Math.sin(a) * radM);
    }
    return pts;
  }

  /** Extrudes a closed bed-XY ring between [zLoU, zHiU] and pushes into solids. */
  function _pushTier(solids, core, mf, ringBed, zLoU, zHiU) {
    if (zHiU <= zLoU + 1e-5) return;
    const m = core.extrudeRingSolid(mf, ringBed, [], zLoU, zHiU);
    if (m && m.numTri() > 0) solids.push(m);
  }

  /** Adds a >= 48 deg self-supporting stepped chamfer flare between two radii. */
  function _pushChamferFlare(solids, core, mf, anchor, cx, cy, rBotM, rTopM, chamFrac, zBotM, zTopM, nSteps) {
    for (let s = 0; s < nSteps; s++) {
      const f0 = s / nSteps, f1 = (s + 1) / nSteps;
      const rCur = rBotM + (rTopM - rBotM) * f1;
      const z0 = anchor.toBedZ(zBotM + (zTopM - zBotM) * f0 - (s > 0 ? 0.25 : 0));
      const z1 = anchor.toBedZ(zBotM + (zTopM - zBotM) * f1 + 0.25);
      _pushTier(solids, core, mf, _chamferBoxBed(anchor.toBedXY, cx, cy, rCur, rCur, rCur * chamFrac), z0, z1);
    }
  }

  /** Builds the stepped limestone podium, 4 flanking pavilions, N/S wings, East portico, and Sala Kongresowa. */
  function _buildPkinPodiumAndWings(solids, core, mf, anchor, zFloorU, mmPerM) {
    const xy = anchor.toBedXY;
    const zB = (m) => anchor.toBedZ(m);
    const ribMinM = Math.max(2.2, 0.38 / mmPerM);

    _pushTier(solids, core, mf, _rectBed(xy, -52.0, 36.5, -76.5, 76.5), zFloorU, zB(18.0));
    _pushTier(solids, core, mf, _rectBed(xy, -86.5, 85.0, 69.5, 123.5), zFloorU, zB(18.0));
    _pushTier(solids, core, mf, _rectBed(xy, -86.5, 85.0, -123.5, -69.5), zFloorU, zB(18.0));

    for (const [x0, x1, y0, y1] of [
      [-90.5, -49.0, 66.5, 133.5], [48.0, 90.5, 66.5, 133.5],
      [-90.5, -49.0, -133.5, -66.5], [48.0, 90.5, -133.5, -66.5],
    ]) {
      _pushTier(solids, core, mf, _rectBed(xy, x0, x1, y0, y1), zFloorU, zB(22.5));
      _pushTier(solids, core, mf, _rectBed(xy, x0 + 2.5, x1 - 2.5, y0 + 2.5, y1 - 2.5), zB(22.0), zB(24.6));
    }

    for (const ySign of [-1, 1]) {
      const yA = ySign > 0 ? 19.5 : -69.5, yB = ySign > 0 ? 69.5 : -19.5;
      _pushTier(solids, core, mf, _rectBed(xy, -17.5, 17.5, yA, yB), zFloorU, zB(30.2));
      _pushTier(solids, core, mf, _rectBed(xy, -13.5, 13.5, yA + 2.0, yB - 2.0), zB(29.8), zB(33.2));
      for (let k = -1; k <= 1; k++) {
        const py = (yA + yB) * 0.5 + k * 12.0;
        _pushTier(solids, core, mf, _rectBed(xy, -19.0, 19.0, py - ribMinM * 0.5, py + ribMinM * 0.5), zFloorU, zB(29.0));
      }
    }

    // East Plac Defilad grand portico, colonnade ribs & stepped plaza
    _pushTier(solids, core, mf, _rectBed(xy, 28.0, 52.0, -21.0, 21.0), zFloorU, zB(22.6));
    _pushTier(solids, core, mf, _rectBed(xy, 30.0, 47.0, -14.0, 14.0), zB(22.2), zB(26.0));
    _pushTier(solids, core, mf, _rectBed(xy, 48.0, 58.0, -24.5, 24.5), zFloorU, zB(5.4));
    _pushTier(solids, core, mf, _rectBed(xy, 56.0, 64.5, -20.5, 20.5), zFloorU, zB(2.8));

    // West Sala Kongresowa semicircular auditorium apse + raised drum + pilasters
    _pushTier(solids, core, mf, _rectBed(xy, -87.0, -28.0, -39.5, 39.5), zFloorU, zB(22.5));
    const apsePts = [];
    for (let i = 0; i <= 14; i++) {
      const ang = Math.PI * 0.5 + (i / 14) * Math.PI;
      apsePts.push([-86.5 + Math.cos(ang) * 39.5, Math.sin(ang) * 39.5]);
    }
    _pushTier(solids, core, mf, _polyBed(xy, apsePts), zFloorU, zB(22.5));
    _pushTier(solids, core, mf, _regPolyBed(xy, -82.0, 0.0, 29.0, 18), zB(22.0), zB(27.8));
    for (let i = 1; i < 10; i++) {
      const ang = Math.PI * 0.5 + (i / 10) * Math.PI;
      _pushTier(solids, core, mf, _regPolyBed(xy, -86.5 + Math.cos(ang) * 39.8, Math.sin(ang) * 39.8, ribMinM * 0.6, 6), zFloorU, zB(23.6));
    }
  }

  /** Builds the 4 stepped octagonal corner shoulder turrets around the 67 m terrace. */
  function _buildPkinCornerTurrets(solids, core, mf, anchor, zFloorU) {
    const xy = anchor.toBedXY;
    const zB = (m) => anchor.toBedZ(m);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cx = sx * 24.5, cy = sy * 25.0;
        _pushTier(solids, core, mf, _chamferBoxBed(xy, cx, cy, 8.2, 8.2, 1.8), zFloorU, zB(67.2));
        _pushTier(solids, core, mf, _regPolyBed(xy, cx, cy, 7.6, 8, Math.PI / 8), zB(66.5), zB(76.8));
        _pushChamferFlare(solids, core, mf, anchor, cx, cy, 7.0, 7.9, 0.28, 75.5, 78.0, 2);
        _pushTier(solids, core, mf, _regPolyBed(xy, cx, cy, 6.2, 8, Math.PI / 8), zB(77.6), zB(81.8));
        _pushTier(solids, core, mf, _regPolyBed(xy, cx, cy, 4.4, 8, Math.PI / 8), zB(81.4), zB(84.8));
        _pushTier(solids, core, mf, _regPolyBed(xy, cx, cy, 2.2, 8, Math.PI / 8), zB(84.4), zB(87.8));
      }
    }
  }

  /** Builds the central tower shaft, pilasters, crown attic, 4 clock dials, cupola, and spire (16..237 m). */
  function _buildPkinCentralTower(solids, core, mf, ctx, anchor, zFloorU, mmPerM) {
    const xy = anchor.toBedXY;
    const zB = (m) => anchor.toBedZ(m);
    const scaleMm = ctx.scaleMm || 1.0;

    // Cruciform base shaft (16..67 m)
    _pushTier(solids, core, mf, _chamferBoxBed(xy, 0, 0, 22.8, 22.8, 2.8), zFloorU, zB(67.2));
    _pushTier(solids, core, mf, _rectBed(xy, -32.2, 32.2, -17.5, 17.5), zFloorU, zB(67.0));
    _pushTier(solids, core, mf, _rectBed(xy, -17.5, 17.5, -35.0, 35.0), zFloorU, zB(67.0));
    _pushChamferFlare(solids, core, mf, anchor, 0, 0, 21.6, 23.8, 0.16, 65.2, 68.5, 3);

    // Fluted central tower shaft (66..139 m) + vertical pilaster ribs
    _pushTier(solids, core, mf, _chamferBoxBed(xy, 0, 0, 21.6, 21.6, 3.2), zB(66.0), zB(139.5));
    const ribW = Math.max(2.3, 0.40 / mmPerM);
    const ribOut = Math.max(1.4, 0.25 / mmPerM);
    for (const off of [-12.6, -6.3, 0.0, 6.3, 12.6]) {
      _pushTier(solids, core, mf, _rectBed(xy, off - ribW * 0.5, off + ribW * 0.5, -21.6 - ribOut, 21.6 + ribOut), zB(66.5), zB(138.2));
      _pushTier(solids, core, mf, _rectBed(xy, -21.6 - ribOut, 21.6 + ribOut, off - ribW * 0.5, off + ribW * 0.5), zB(66.5), zB(138.2));
    }

    // Crown balustrade attic (137..146 m) + 4 corner pinnacles (140..151 m)
    _pushChamferFlare(solids, core, mf, anchor, 0, 0, 21.4, 23.4, 0.16, 137.0, 140.4, 3);
    _pushTier(solids, core, mf, _chamferBoxBed(xy, 0, 0, 18.4, 18.4, 2.6), zB(139.8), zB(144.8));
    const finHalf = Math.max(2.2, 0.38 / mmPerM);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const fx = sx * 19.4, fy = sy * 19.4;
        _pushTier(solids, core, mf, _chamferBoxBed(xy, fx, fy, finHalf, finHalf, finHalf * 0.25), zB(139.5), zB(146.5));
        _pushTier(solids, core, mf, _regPolyBed(xy, fx, fy, finHalf * 0.72, 8, Math.PI / 8), zB(146.0), zB(151.0));
      }
    }

    // Clock-level drum (142..168 m) + 4 protruding bevelled clock dials
    _pushTier(solids, core, mf, _chamferBoxBed(xy, 0, 0, 9.8, 9.8, 2.2), zB(142.0), zB(168.5));
    const dialReach = Math.max(2.5, 0.42 / mmPerM);
    const dialHalf = Math.max(4.6, 0.75 / mmPerM);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let s = 1; s <= 4; s++) {
        const reach = dialReach * (s / 4);
        const x0 = dx !== 0 ? (dx > 0 ? 8.0 : -8.0 - reach) : -dialHalf;
        const x1 = dx !== 0 ? (dx > 0 ? 8.0 + reach : -8.0) : dialHalf;
        const y0 = dy !== 0 ? (dy > 0 ? 8.0 : -8.0 - reach) : -dialHalf;
        const y1 = dy !== 0 ? (dy > 0 ? 8.0 + reach : -8.0) : dialHalf;
        _pushTier(solids, core, mf, _rectBed(xy, x0, x1, y0, y1), zB(145.8 + (s - 1) * 1.5), zB(146.3 + s * 1.5));
      }
      const hx0 = dx !== 0 ? (dx > 0 ? 8.0 : -9.8 - dialReach) : -dialHalf;
      const hx1 = dx !== 0 ? (dx > 0 ? 9.8 + dialReach : -8.0) : dialHalf;
      const hy0 = dy !== 0 ? (dy > 0 ? 8.0 : -9.8 - dialReach) : -dialHalf;
      const hy1 = dy !== 0 ? (dy > 0 ? 9.8 + dialReach : -8.0) : dialHalf;
      _pushTier(solids, core, mf, _rectBed(xy, hx0, hx1, hy0, hy1), zB(151.5), zB(164.5));
      _pushTier(solids, core, mf, _regPolyBed(xy, dx * (9.8 + dialReach * 1.12), dy * (9.8 + dialReach * 1.12), dialHalf * 0.78, 8, Math.PI / 8), zB(153.2), zB(162.8));
    }
    _pushChamferFlare(solids, core, mf, anchor, 0, 0, 9.6, 11.1, 0.22, 166.5, 169.8, 3);

    // Upper lantern pavilion (169..188 m) + monotonic tapering cupola -> spire (188..237 m)
    const zSpireBaseU = zB(205.8);
    const zSpireTopU = zB(237.0);
    const spireHMm = Math.max(1.0, (zSpireTopU - zSpireBaseU) * scaleMm);
    const reqDiaMm = (ctx.slaLaws && typeof ctx.slaLaws.minPinDiameterMm === 'function')
      ? ctx.slaLaws.minPinDiameterMm(spireHMm)
      : 0.65;
    const minTipRadU = (reqDiaMm * 0.54) / scaleMm;
    const r0 = Math.max(minTipRadU * 1.68, 2.8 * anchor.uPerM);
    const r1 = Math.max(minTipRadU * 1.32, 1.8 * anchor.uPerM);
    const r2 = Math.max(minTipRadU * 1.08, 1.1 * anchor.uPerM);
    const rSpireBaseM = r0 / anchor.uPerM;

    _pushTier(solids, core, mf, _regPolyBed(xy, 0, 0, Math.max(8.0, rSpireBaseM * 1.55), 8, Math.PI / 8), zB(169.0), zB(188.2));
    _pushChamferFlare(solids, core, mf, anchor, 0, 0, Math.max(7.2, rSpireBaseM * 1.4), Math.max(8.2, rSpireBaseM * 1.6), 0.24, 186.5, 189.2, 2);

    const cupTopM = Math.max(3.4, rSpireBaseM * 1.06);
    const cupStartM = Math.max(7.4, cupTopM * 1.85);
    for (let s = 0; s < 4; s++) {
      const rC = cupStartM + (cupTopM - cupStartM) * (s / 3);
      _pushTier(solids, core, mf, _regPolyBed(xy, 0, 0, rC, 8, Math.PI / 8), zB(188.6 + s * 4.2), zB(193.2 + s * 4.6));
    }

    const zS1 = zSpireBaseU + (zSpireTopU - zSpireBaseU) * 0.36;
    const zS2 = zSpireBaseU + (zSpireTopU - zSpireBaseU) * 0.70;
    const zOv = 0.04 / scaleMm;
    const pushCone = (z0, z1, ra, rb) => {
      const h = z1 - z0;
      if (h <= 1e-5) return;
      const raw = mf.Manifold.cylinder(h, ra, rb, 10, false);
      const moved = raw.translate([anchor.cxBed, anchor.cyBed, z0]);
      core.safeDeleteManifold(raw);
      if (moved && moved.numTri() > 0) solids.push(moved);
    };
    pushCone(zSpireBaseU - zOv, zS1 + zOv, r0, r1);
    pushCone(zS1 - zOv, zS2 + zOv, r1, r2);
    pushCone(zS2 - zOv, zSpireTopU, r2, minTipRadU);
  }

  /**
   * Builds the watertight 2-manifold Palac Kultury i Nauki hero landmark (0..237 m).
   * @param {object} core
   * @param {object} mf
   * @param {object} ctx
   * @param {object} anchor
   * @returns {object|null}
   */
  function buildWarsawPkinManifold(core, mf, ctx, anchor) {
    if (!core || !mf || !ctx || !anchor) return null;
    const scaleMm = ctx.scaleMm || 1.0;
    const mmPerM = anchor.uPerM * scaleMm;
    if (!(mmPerM > 1e-4)) return null;

    const zFloorU = Math.max(0.15 / scaleMm, anchor.zDatumU - 0.65 / scaleMm);
    const solids = [];

    _buildPkinPodiumAndWings(solids, core, mf, anchor, zFloorU, mmPerM);
    _buildPkinCornerTurrets(solids, core, mf, anchor, zFloorU);
    _buildPkinCentralTower(solids, core, mf, ctx, anchor, zFloorU, mmPerM);

    if (solids.length === 0) return null;
    const merged = solids.length === 1 ? solids[0] : core.batchUnionManifolds(mf, solids);
    if (!merged || merged.numTri() === 0) {
      core.safeDeleteManifold(merged);
      return null;
    }
    return merged;
  }

  const WARSAW_PKIN_SPEC = {
    id: 'warsaw_pkin',
    name: 'Palac Kultury i Nauki',
    lat: 52.2317636,
    lon: 21.0061898,
    headingDeg: 19.93,
    footprintRadiusM: 145.0,
    maxHeightM: 237.0,
    replaceOsmIds: [
      7305241, 1319250, 6432294, 20623070,
      89352674, 89352699, 89352693, 89352683, 89352680, 89352677,
      240119158, 240119160,
      89354141, 89354142, 89354143, 89354144, 89354145, 89354146, 89354148, 89354149,
      1424432260,
    ],
    replacePolygonM: [[-132, -138], [96, -138], [96, 138], [-132, 138]],
    buildManifold: buildWarsawPkinManifold,
  };

  if (typeof root.registerHeroLandmark === 'function') {
    root.registerHeroLandmark(WARSAW_PKIN_SPEC);
  }

  const exportsObj = { WARSAW_PKIN_SPEC, buildWarsawPkinManifold };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
