// ============================================================================
// src/landmarks/landmark_paris_eiffel_summit.js
// Curated Geo-Anchored Hero Landmark: Tour Eiffel 3rd-Floor Gallery,
// Architectural Octagonal Cupola & Stepped Radio Broadcast Mast (274..330 m)
// ============================================================================

(function (root) {
  if (typeof root.registerHeroLandmark !== 'function' && typeof require === 'function') {
    Object.assign(root, require('./landmark_registry.js'));
  }

  /**
   * Builds a local-meter square ring centered at (0, 0) transformed to bed XY.
   * @param {function(number, number): [number, number]} toBedXY
   * @param {number} halfM
   * @returns {number[][]}
   */
  function _squareBedRing(toBedXY, halfM) {
    return [
      toBedXY(-halfM, -halfM),
      toBedXY(halfM, -halfM),
      toBedXY(halfM, halfM),
      toBedXY(-halfM, halfM),
    ];
  }

  /**
   * Builds a chamfered square (regular-feeling 8-gon) ring in bed XY.
   * @param {function(number, number): [number, number]} toBedXY
   * @param {number} halfM
   * @param {number} chamferFrac
   * @returns {number[][]}
   */
  function _chamferSquareBedRing(toBedXY, halfM, chamferFrac) {
    const c = halfM * Math.max(0.05, Math.min(0.45, chamferFrac));
    const a = halfM - c;
    return [
      toBedXY(-a, -halfM),
      toBedXY(a, -halfM),
      toBedXY(halfM, -a),
      toBedXY(halfM, a),
      toBedXY(a, halfM),
      toBedXY(-a, halfM),
      toBedXY(-halfM, a),
      toBedXY(-halfM, -a),
    ];
  }

  /**
   * Builds a regular N-sided polygon ring centered at (0, 0) in bed XY.
   * @param {function(number, number): [number, number]} toBedXY
   * @param {number} radiusM
   * @param {number} sides
   * @param {number} [phaseRad=0]
   * @returns {number[][]}
   */
  function _regularPolyBedRing(toBedXY, radiusM, sides, phaseRad = 0) {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const ang = phaseRad + (i / sides) * Math.PI * 2;
      pts.push(toBedXY(Math.cos(ang) * radiusM, Math.sin(ang) * radiusM));
    }
    return pts;
  }

  /**
   * Pushes a watertight extruded tier between [zLoM, zHiM] with clean Z overlap.
   * @param {object[]} solids
   * @param {object} core
   * @param {object} mf
   * @param {number[][]} ringBed
   * @param {number} zLoU
   * @param {number} zHiU
   */
  function _pushTier(solids, core, mf, ringBed, zLoU, zHiU) {
    if (zHiU <= zLoU + 1e-5) return;
    const m = core.extrudeRingSolid(mf, ringBed, [], zLoU, zHiU);
    if (m && m.numTri() > 0) solids.push(m);
  }

  /**
   * Adds a self-supporting >= 48 deg stepped chamfer flaring from halfBotM to halfTopM.
   * @param {object[]} solids
   * @param {object} core
   * @param {object} mf
   * @param {object} anchor
   * @param {number} halfBotM
   * @param {number} halfTopM
   * @param {number} zBotM
   * @param {number} zTopM
   * @param {number} nSteps
   * @param {number} [chamferFrac=0]
   */
  function _pushSteppedFlare(solids, core, mf, anchor, halfBotM, halfTopM, zBotM, zTopM, nSteps, chamferFrac = 0) {
    const zOvM = 0.25;
    for (let s = 0; s < nSteps; s++) {
      const f0 = s / nSteps;
      const f1 = (s + 1) / nSteps;
      const hCur = halfBotM + (halfTopM - halfBotM) * f1;
      const z0 = anchor.toBedZ(zBotM + (zTopM - zBotM) * f0 - (s > 0 ? zOvM : 0));
      const z1 = anchor.toBedZ(zBotM + (zTopM - zBotM) * f1 + zOvM);
      const ring = chamferFrac > 0
        ? _chamferSquareBedRing(anchor.toBedXY, hCur, chamferFrac)
        : _squareBedRing(anchor.toBedXY, hCur);
      _pushTier(solids, core, mf, ring, z0, z1);
    }
  }

  /**
   * Builds the curated watertight 2-manifold Tour Eiffel summit assembly
   * spanning 273.5 m to 330.0 m above ground datum:
   * - >= 48 deg underside flared corbel collar seated inside the 4 upper shafts
   * - Cantilevered square 3rd-floor observation deck gallery & parapet rim
   * - Recessed glazed observation cabin with 4 proud corner pilasters
   * - Upper open viewing balcony cornice (>= 48 deg underside chamfer)
   * - Stepped octagonal architectural cupola & lantern drum (zero bubble dome)
   * - Multi-stage stepped Eiffel radio broadcast mast enforcing SLA pin minimum
   * @param {object} core
   * @param {object} mf
   * @param {object} ctx
   * @param {object} anchor
   * @returns {object|null}
   */
  function buildParisEiffelSummitManifold(core, mf, ctx, anchor) {
    if (!core || !mf || !ctx || !anchor) return null;
    const scaleMm = ctx.scaleMm || 1.0;
    const uPerM = anchor.uPerM;
    const mmPerM = uPerM * scaleMm;
    if (!(mmPerM > 1e-4)) return null;

    const solids = [];
    const zOv = 0.04 / scaleMm;

    // 1. Base anchor socket seated cleanly inside the 276.13 m inclined lattice shafts
    _pushTier(
      solids, core, mf,
      _squareBedRing(anchor.toBedXY, 7.6),
      anchor.toBedZ(273.0),
      anchor.toBedZ(276.6)
    );

    // 2. Self-supporting >= 48 deg flared underside corbel collar (274.5 -> 278.4 m)
    _pushSteppedFlare(solids, core, mf, anchor, 7.6, 9.7, 274.5, 278.4, 4, 0.0);

    // 3. Cantilevered 3rd-floor main observation gallery deck & crisp parapet rim (278.2 -> 281.8 m)
    _pushSteppedFlare(solids, core, mf, anchor, 9.7, 10.4, 278.2, 279.6, 2, 0.0);
    _pushTier(
      solids, core, mf,
      _squareBedRing(anchor.toBedXY, 10.4),
      anchor.toBedZ(279.4),
      anchor.toBedZ(281.8)
    );

    // 4. Recessed glazed 3rd-floor observation cabin (281.5 -> 287.6 m) + 4 proud corner pilasters
    const cabinHalfM = 8.1;
    _pushTier(
      solids, core, mf,
      _squareBedRing(anchor.toBedXY, cabinHalfM),
      anchor.toBedZ(281.4),
      anchor.toBedZ(287.8)
    );
    const pilOffsetM = cabinHalfM - 0.55;
    const pilHalfM = Math.max(1.05, 0.28 / mmPerM);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const px = sx * pilOffsetM;
        const py = sy * pilOffsetM;
        const pRing = [
          anchor.toBedXY(px - pilHalfM, py - pilHalfM),
          anchor.toBedXY(px + pilHalfM, py - pilHalfM),
          anchor.toBedXY(px + pilHalfM, py + pilHalfM),
          anchor.toBedXY(px - pilHalfM, py + pilHalfM),
        ];
        _pushTier(solids, core, mf, pRing, anchor.toBedZ(281.4), anchor.toBedZ(288.0));
      }
    }

    // 5. Upper open viewing balcony cornice (286.6 -> 289.4 m, >= 48 deg chamfered underside)
    _pushSteppedFlare(solids, core, mf, anchor, cabinHalfM, 9.1, 286.6, 288.2, 3, 0.0);
    _pushTier(
      solids, core, mf,
      _squareBedRing(anchor.toBedXY, 9.1),
      anchor.toBedZ(288.0),
      anchor.toBedZ(289.4)
    );

    // 6. Gustave Eiffel office & meteorological octagonal lantern drum (289.0 -> 296.8 m)
    _pushTier(
      solids, core, mf,
      _chamferSquareBedRing(anchor.toBedXY, 6.9, 0.24),
      anchor.toBedZ(289.0),
      anchor.toBedZ(293.8)
    );
    _pushTier(
      solids, core, mf,
      _chamferSquareBedRing(anchor.toBedXY, 5.9, 0.28),
      anchor.toBedZ(293.4),
      anchor.toBedZ(297.2)
    );

    // 7. Stepped octagonal architectural cupola & broadcast base (296.8 -> 304.8 m, zero dome bulge)
    const cupolaTiers = [
      { rM: 5.2, z0: 296.8, z1: 299.2 },
      { rM: 4.3, z0: 298.8, z1: 301.2 },
      { rM: 3.3, z0: 300.8, z1: 303.0 },
      { rM: 2.35, z0: 302.6, z1: 304.8 },
    ];
    for (let i = 0; i < cupolaTiers.length; i++) {
      const ct = cupolaTiers[i];
      _pushTier(
        solids, core, mf,
        _regularPolyBedRing(anchor.toBedXY, ct.rM, 8, Math.PI / 8),
        anchor.toBedZ(ct.z0),
        anchor.toBedZ(ct.z1)
      );
    }

    // 8. Multi-stage stepped Eiffel radio broadcast mast (304.2 -> 330.0 m) respecting SLA pin laws
    const zCupolaTopU = anchor.toBedZ(304.4);
    const zMastRawTopU = anchor.toBedZ(330.0);
    const rawProtMm = Math.max(0.5, (zMastRawTopU - zCupolaTopU) * scaleMm);
    const bodyTopMm = zCupolaTopU * scaleMm;
    const cappedProtMm = (ctx.slaLaws && typeof ctx.slaLaws.capSpireProtrusionMm === 'function')
      ? ctx.slaLaws.capSpireProtrusionMm(rawProtMm, bodyTopMm)
      : rawProtMm;
    const mastHMm = Math.max(1.2, Math.min(rawProtMm, cappedProtMm > 0 ? cappedProtMm : rawProtMm));
    const zMastTopU = zCupolaTopU + mastHMm / scaleMm;

    const reqTipDiaMm = (ctx.slaLaws && typeof ctx.slaLaws.minPinDiameterMm === 'function')
      ? ctx.slaLaws.minPinDiameterMm(mastHMm)
      : 0.65;
    const minTipRadU = (reqTipDiaMm * 0.52) / scaleMm;
    const rStage1 = Math.max(minTipRadU * 1.65, 1.55 * uPerM);
    const rStage2 = Math.max(minTipRadU * 1.32, 1.12 * uPerM);
    const rStage3Bot = Math.max(minTipRadU * 1.12, 0.85 * uPerM);
    const rStage3Top = Math.max(minTipRadU, 0.62 * uPerM);

    const zS1Top = zCupolaTopU + (zMastTopU - zCupolaTopU) * 0.34;
    const zS2Top = zCupolaTopU + (zMastTopU - zCupolaTopU) * 0.68;

    const addCyl = (z0, z1, rBot, rTop, segs = 12) => {
      const h = z1 - z0;
      if (h <= 1e-4) return;
      const c = mf.Manifold.cylinder(h, rBot, rTop, segs, false).translate([anchor.cxBed, anchor.cyBed, z0]);
      if (c && c.numTri() > 0) solids.push(c);
    };

    // Lower mast pedestal, mid dipole shaft with crisp technical collar, upper broadcast tip
    addCyl(zCupolaTopU - zOv * 2, zS1Top + zOv, rStage1, rStage2 * 1.08, 12);
    addCyl(zS1Top - zOv, zS2Top + zOv, rStage2, rStage3Bot * 1.06, 12);
    // Small technical broadcast collar at Stage 1->2 junction (beveled >= 50 deg)
    const collarH = Math.min(0.28 / scaleMm, (zS2Top - zS1Top) * 0.25);
    addCyl(zS1Top - collarH, zS1Top, rStage2, rStage1 * 1.06, 12);
    addCyl(zS1Top, zS1Top + collarH * 0.85, rStage1 * 1.06, rStage1 * 1.06, 12);
    addCyl(zS2Top - zOv, zMastTopU, rStage3Bot, rStage3Top, 12);

    if (solids.length === 0) return null;
    const merged = solids.length === 1 ? solids[0] : core.batchUnionManifolds(mf, solids);
    if (!merged || merged.numTri() === 0) {
      core.safeDeleteManifold(merged);
      return null;
    }
    return merged;
  }

  if (typeof root.registerHeroLandmark === 'function') {
    root.registerHeroLandmark({
      id: 'paris_eiffel_summit',
      name: 'Tour Eiffel Summit',
      lat: 48.8582713,
      lon: 2.2945061,
      headingDeg: -45.0,
      footprintRadiusM: 18.0,
      maxHeightM: 330.0,
      replaceOsmIds: [308021389, 1462597762],
      buildManifold: buildParisEiffelSummitManifold,
    });
  }

  const exportsObj = { buildParisEiffelSummitManifold };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
