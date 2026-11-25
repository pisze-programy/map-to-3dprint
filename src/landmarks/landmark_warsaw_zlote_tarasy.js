// ============================================================================
// src/landmarks/landmark_warsaw_zlote_tarasy.js
// Curated Geo-Anchored Hero Landmark: Zlote Tarasy Complex
// Replaces OSM's broken multi-dome spheres with the continuous sweeping
// undulating glass-wave canopy (56x56 closed heightfield solid + delicate
// diagrid structural ribs), curved Lumen office crescent (55 m), Skylight
// wedge tower (105 m), and SW stepped retail rotunda terraces.
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

  /** Extrudes a closed bed-XY polygon between [zLoU, zHiU] if valid. */
  function _pushTier(solids, core, mf, ringBed, zLoU, zHiU) {
    if (zHiU <= zLoU + 1e-5) return;
    const m = core.extrudeRingSolid(mf, ringBed, [], zLoU, zHiU);
    if (m && m.numTri() > 0) solids.push(m);
  }

  /**
   * Evaluates the sweeping Zlote Tarasy glass-wave roof elevation (m) with
   * organic flowing billows and delicate raised diagrid structural mullions.
   * @param {number} xM
   * @param {number} yM
   * @param {number} mmPerM
   * @returns {number}
   */
  function _evalWaveHeightM(xM, yM, mmPerM) {
    const u = (xM - 30.0) / 55.0;
    const v = (yM - 10.0) / 53.0;
    const r2 = Math.min(1.85, u * u + v * v);
    const env = Math.max(0.06, 1.0 - 0.52 * r2);

    // Sweeping diagonal organic wave billows across atrium courtyard
    const w1 = 7.8 * Math.cos(1.65 * (u * 0.78 + v * 0.62) - 0.35);
    const w2 = 5.4 * Math.sin(2.15 * (u * 0.52 - v * 0.85) + 0.55);
    const w3 = 3.0 * Math.cos(2.75 * u - 1.25 * v);
    const smoothH = Math.max(19.0, Math.min(43.0, 21.5 + 14.2 * env + env * (w1 + w2 + w3) * 0.74));

    // Fine raised diagrid structural mullion lines over smooth wave surface
    const pitchM = 13.5;
    const cA = Math.abs(Math.cos(((xM + yM) * Math.PI) / pitchM));
    const cB = Math.abs(Math.cos(((xM - yM) * Math.PI) / pitchM));
    const ribMask = Math.max(Math.pow(cA, 12), Math.pow(cB, 12));
    const ribAmpM = Math.max(0.85, 0.17 / mmPerM);
    return smoothH + ribMask * ribAmpM * (0.45 + 0.55 * env);
  }

  /**
   * Builds a closed watertight 2-manifold 56x56 heightfield solid and intersects
   * it cleanly with the exact atrium courtyard polygon.
   * @param {object} core
   * @param {object} mf
   * @param {object} anchor
   * @param {number} zFloorU
   * @param {number} mmPerM
   * @returns {object|null}
   */
  function _buildAtriumWaveCanopy(core, mf, anchor, zFloorU, mmPerM) {
    const nx = 56, ny = 56;
    const x0 = -26.5, x1 = 90.0;
    const y0 = -45.5, y1 = 67.5;
    const nGrid = nx * ny;
    const pos = new Float32Array(nGrid * 2 * 3);

    for (let j = 0; j < ny; j++) {
      const yM = y0 + (y1 - y0) * (j / (ny - 1));
      for (let i = 0; i < nx; i++) {
        const xM = x0 + (x1 - x0) * (i / (nx - 1));
        const [bx, by] = anchor.toBedXY(xM, yM);
        const zTopU = anchor.toBedZ(_evalWaveHeightM(xM, yM, mmPerM));
        const idxTop = (j * nx + i) * 3;
        const idxBot = (nGrid + j * nx + i) * 3;
        pos[idxTop] = bx; pos[idxTop + 1] = by; pos[idxTop + 2] = zTopU;
        pos[idxBot] = bx; pos[idxBot + 1] = by; pos[idxBot + 2] = zFloorU;
      }
    }

    const tris = [];
    const vTop = (i, j) => j * nx + i;
    const vBot = (i, j) => nGrid + j * nx + i;
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const t00 = vTop(i, j), t10 = vTop(i + 1, j), t11 = vTop(i + 1, j + 1), t01 = vTop(i, j + 1);
        tris.push(t00, t10, t11, t00, t11, t01);
        const b00 = vBot(i, j), b10 = vBot(i + 1, j), b11 = vBot(i + 1, j + 1), b01 = vBot(i, j + 1);
        tris.push(b00, b11, b10, b00, b01, b11);
      }
    }
    for (let i = 0; i < nx - 1; i++) {
      tris.push(vBot(i, 0), vBot(i + 1, 0), vTop(i + 1, 0), vBot(i, 0), vTop(i + 1, 0), vTop(i, 0));
      tris.push(vBot(i + 1, ny - 1), vBot(i, ny - 1), vTop(i, ny - 1), vBot(i + 1, ny - 1), vTop(i, ny - 1), vTop(i + 1, ny - 1));
    }
    for (let j = 0; j < ny - 1; j++) {
      tris.push(vBot(0, j + 1), vBot(0, j), vTop(0, j), vBot(0, j + 1), vTop(0, j), vTop(0, j + 1));
      tris.push(vBot(nx - 1, j), vBot(nx - 1, j + 1), vTop(nx - 1, j + 1), vBot(nx - 1, j), vTop(nx - 1, j + 1), vTop(nx - 1, j));
    }

    const waveBox = core.manifoldFromRawSoup(mf, pos, new Uint32Array(tris), 1e-6);
    if (!waveBox) return null;

    const atriumPtsM = [
      [74.5, -25.5], [75.8, -18.5], [73.0, -14.8], [79.5, -6.0], [84.2, 1.0],
      [87.5, 13.5], [88.5, 23.0], [85.2, 34.0], [82.0, 44.2], [75.0, 50.5],
      [60.0, 60.0], [43.0, 65.2], [28.0, 65.4], [12.0, 60.5], [-4.0, 51.0],
      [-15.5, 43.8], [-20.5, 33.5], [-23.8, 13.5], [-25.2, -3.5], [-21.5, -18.5],
      [-13.5, -29.5], [-3.0, -36.5], [4.5, -31.5], [13.5, -26.5], [24.0, -31.0],
      [27.5, -42.5], [45.0, -41.5], [60.0, -38.5], [68.5, -34.0],
    ];
    const cutter = core.extrudeRingSolid(mf, _polyBed(anchor.toBedXY, atriumPtsM), [], zFloorU - 0.05, anchor.toBedZ(54.0));
    if (!cutter) return waveBox;
    const clipped = waveBox.intersect(cutter);
    core.safeDeleteManifold(waveBox);
    core.safeDeleteManifold(cutter);
    if (!clipped || clipped.numTri() === 0) {
      core.safeDeleteManifold(clipped);
      return null;
    }
    return clipped;
  }

  /** Builds the Zlote Tarasy retail podium, SW terraces, Lumen crescent, and Skylight tower. */
  function _buildZloteTarasyPerimeter(solids, core, mf, anchor, zFloorU, mmPerM) {
    const xy = anchor.toBedXY;
    const zB = (m) => anchor.toBedZ(m);
    const finW = Math.max(1.8, 0.32 / mmPerM);

    // Outer retail podium plinth (0..17 m)
    _pushTier(solids, core, mf, _polyBed(xy, [
      [-74.4, 15.0], [-74.4, 0.5], [-68.2, -3.0], [-68.6, -34.5], [-65.5, -50.0],
      [-56.5, -65.3], [-46.6, -73.9], [-34.7, -79.5], [-18.8, -81.9], [25.5, -79.0],
      [28.0, -56.9], [26.6, -42.1], [42.3, -41.1], [58.2, -38.7], [67.0, -33.4],
      [75.5, -28.9], [89.6, -43.7], [104.8, -51.7], [114.8, -54.1], [114.8, -28.7],
      [130.5, -23.8], [130.6, -2.1], [114.8, -1.4], [114.6, 65.7], [108.5, 73.0],
      [94.5, 80.0], [-42.0, 83.2], [-63.5, 76.4], [-64.1, 64.9], [-83.6, 50.2],
      [-76.9, 38.7],
    ]), zFloorU, zB(17.2));

    // SW Multikino & retail stepped terraces (16..35 m -> 35..40 m)
    _pushTier(solids, core, mf, _polyBed(xy, [
      [-64.7, -3.1], [-68.6, -29.0], [-66.9, -46.0], [-57.9, -57.7],
      [-46.5, -69.8], [-31.1, -77.0], [5.9, -78.8], [6.4, -47.8],
      [1.3, -37.1], [-11.5, -29.1], [-20.1, -17.9], [-24.0, -3.6],
    ]), zB(16.5), zB(35.0));
    _pushTier(solids, core, mf, _polyBed(xy, [
      [-56.0, -24.0], [-54.0, -45.0], [-42.0, -58.0], [-22.0, -64.5],
      [-2.0, -64.0], [-2.0, -44.0], [-14.0, -30.0], [-22.0, -17.0],
    ]), zB(34.5), zB(40.2));

    // SE curved retail terrace (16..27 m)
    _pushTier(solids, core, mf, _polyBed(xy, [
      [74.6, -18.5], [84.5, -29.9], [96.3, -38.3], [109.2, -43.6],
      [114.8, -28.7], [95.8, -28.9], [84.1, -24.7],
    ]), zB(16.5), zB(27.0));

    // Lumen curved crescent wings + recessed center connector link (16..55 m + crown)
    _pushTier(solids, core, mf, _polyBed(xy, [
      [-64.1, 7.2], [-48.7, 3.1], [-42.3, 19.6], [-32.3, 34.6], [-19.2, 46.5],
      [-3.8, 55.0], [11.8, 61.4], [28.1, 64.4], [28.2, 78.9], [6.7, 75.8],
      [-13.9, 68.2], [-29.5, 58.6], [-44.3, 45.0], [-55.3, 29.3], [-62.4, 13.0],
    ]), zB(16.5), zB(55.0));
    _pushTier(solids, core, mf, _polyBed(xy, [
      [35.6, 65.0], [50.3, 62.1], [67.9, 54.6], [82.3, 43.3], [96.5, 25.7],
      [100.1, 18.5], [114.5, 26.0], [106.7, 40.1], [90.8, 57.7], [71.2, 70.6],
      [49.9, 78.4], [36.0, 78.8],
    ]), zB(16.5), zB(55.0));
    _pushTier(solids, core, mf, _polyBed(xy, [
      [25.0, 66.5], [38.0, 66.5], [38.0, 77.5], [25.0, 77.5],
    ]), zB(16.5), zB(44.0));
    _pushTier(solids, core, mf, _polyBed(xy, [
      [-55.0, 21.0], [-42.0, 39.0], [-24.0, 54.0], [-2.0, 64.0], [22.0, 69.0],
      [22.0, 74.0], [-6.0, 68.0], [-30.0, 55.0], [-48.0, 38.0], [-58.0, 22.0],
    ]), zB(54.5), zB(58.0));
    _pushTier(solids, core, mf, _polyBed(xy, [
      [40.0, 68.5], [60.0, 62.0], [80.0, 50.0], [96.0, 34.0], [103.5, 24.0],
      [108.0, 27.5], [98.0, 42.0], [82.0, 57.0], [62.0, 68.0], [40.0, 74.0],
    ]), zB(54.5), zB(58.0));

    // Skylight wedge office tower (0..105 m) + stepped crown + vertical fins
    _pushTier(solids, core, mf, _polyBed(xy, [
      [71.4, -15.4], [79.2, -21.9], [89.8, -27.2], [104.0, -30.0], [114.8, -28.7],
      [127.9, -25.2], [130.5, -23.8], [130.6, -2.1], [114.8, -1.4], [82.9, -0.4],
      [76.1, -10.0],
    ]), zFloorU, zB(101.0));
    _pushTier(solids, core, mf, _polyBed(xy, [
      [77.0, -15.0], [89.0, -24.0], [105.0, -27.0], [126.5, -22.5],
      [126.5, -4.5], [84.5, -3.2],
    ]), zB(100.5), zB(105.0));
    for (let k = 0; k < 4; k++) {
      const fx = 88.0 + k * 10.5;
      _pushTier(solids, core, mf, _polyBed(xy, [
        [fx - finW * 0.5, -29.5], [fx + finW * 0.5, -29.5],
        [fx + finW * 0.5, -25.5], [fx - finW * 0.5, -25.5],
      ]), zB(17.0), zB(101.5));
    }
  }

  /**
   * Builds the watertight 2-manifold Zlote Tarasy complex with continuous
   * undulating diagrid glass-wave canopy, Lumen crescent, and Skylight tower.
   * @param {object} core
   * @param {object} mf
   * @param {object} ctx
   * @param {object} anchor
   * @returns {object|null}
   */
  function buildWarsawZloteTarasyManifold(core, mf, ctx, anchor) {
    if (!core || !mf || !ctx || !anchor) return null;
    const scaleMm = ctx.scaleMm || 1.0;
    const mmPerM = anchor.uPerM * scaleMm;
    if (!(mmPerM > 1e-4)) return null;

    const zFloorU = Math.max(0.15 / scaleMm, anchor.zDatumU - 0.65 / scaleMm);
    const solids = [];

    _buildZloteTarasyPerimeter(solids, core, mf, anchor, zFloorU, mmPerM);
    const waveCanopy = _buildAtriumWaveCanopy(core, mf, anchor, zFloorU, mmPerM);
    if (waveCanopy) solids.push(waveCanopy);

    if (solids.length === 0) return null;
    const merged = solids.length === 1 ? solids[0] : core.batchUnionManifolds(mf, solids);
    if (!merged || merged.numTri() === 0) {
      core.safeDeleteManifold(merged);
      return null;
    }
    return merged;
  }

  const WARSAW_ZLOTE_TARASY_SPEC = {
    id: 'warsaw_zlote_tarasy',
    name: 'Zlote Tarasy',
    lat: 52.2299715,
    lon: 21.0022125,
    headingDeg: 19.93,
    footprintRadiusM: 140.0,
    maxHeightM: 105.0,
    replaceOsmIds: [
      6432402, 30611687, 89365019, 89365020, 89365021,
      237541404, 237566782, 237574573, 238317271, 238317273,
      238317277, 238317278, 238711087, 239721518, 239721519,
      239721520, 239721521, 239721522, 239721523, 239721524,
      239721525, 239721526, 239721527, 239721528, 239721529,
      239721530, 239721531, 239721532, 983068952, 983068953,
      983068954, 983268131, 983268132, 1451160833, 1451160844,
    ],
    buildManifold: buildWarsawZloteTarasyManifold,
  };

  if (typeof root.registerHeroLandmark === 'function') {
    root.registerHeroLandmark(WARSAW_ZLOTE_TARASY_SPEC);
  }

  const exportsObj = { WARSAW_ZLOTE_TARASY_SPEC, buildWarsawZloteTarasyManifold };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
