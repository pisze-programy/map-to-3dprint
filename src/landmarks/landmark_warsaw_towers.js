// ============================================================================
// src/landmarks/landmark_warsaw_towers.js
// Curated Geo-Anchored Hero Landmarks:
// 1. Varso Tower (310 m): 3-tier asymmetric setback glass shafts, rooftop
//    terraces, vertical structural mullions, and braced offset 80 m mast.
// 2. Zlota 44 (192 m): Libeskind curved "eagle wing" facade slice with
//    swept diagonal knife-edge crest and vertical architectural fins.
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

  /** @param {function(number, number): [number, number]} toBedXY @returns {number[][]} */
  function _regPolyBed(toBedXY, cx, cy, radM, sides, phaseRad = 0) {
    const pts = new Array(sides);
    for (let i = 0; i < sides; i++) {
      const a = phaseRad + (i / sides) * Math.PI * 2;
      pts[i] = toBedXY(cx + Math.cos(a) * radM, cy + Math.sin(a) * radM);
    }
    return pts;
  }

  /**
   * Builds a watertight lofted mesh from K horizontal/sloped CCW rings of M points.
   * @param {object} core
   * @param {object} mf
   * @param {object} anchor
   * @param {number[][][]} ringsM
   * @returns {object|null}
   */
  function _loftRingsManifold(core, mf, anchor, ringsM) {
    const nSlices = ringsM.length;
    if (nSlices < 2) return null;
    const nPts = ringsM[0].length;
    if (nPts < 3) return null;

    const pos = new Float32Array((nSlices * nPts + 2) * 3);
    for (let k = 0; k < nSlices; k++) {
      const ring = ringsM[k];
      for (let j = 0; j < nPts; j++) {
        const [bx, by] = anchor.toBedXY(ring[j][0], ring[j][1]);
        const bz = ring[j][2] <= 0.01 ? ring[j][2] : anchor.toBedZ(ring[j][2]);
        const idx = (k * nPts + j) * 3;
        pos[idx] = bx; pos[idx + 1] = by; pos[idx + 2] = bz;
      }
    }

    const botCenterIdx = nSlices * nPts;
    const topCenterIdx = botCenterIdx + 1;
    let bx0 = 0, by0 = 0, bz0 = 0, tx0 = 0, ty0 = 0, tz0 = 0;
    for (let j = 0; j < nPts; j++) {
      const bOff = j * 3, tOff = ((nSlices - 1) * nPts + j) * 3;
      bx0 += pos[bOff]; by0 += pos[bOff + 1]; bz0 += pos[bOff + 2];
      tx0 += pos[tOff]; ty0 += pos[tOff + 1]; tz0 += pos[tOff + 2];
    }
    pos[botCenterIdx * 3] = bx0 / nPts; pos[botCenterIdx * 3 + 1] = by0 / nPts; pos[botCenterIdx * 3 + 2] = bz0 / nPts;
    pos[topCenterIdx * 3] = tx0 / nPts; pos[topCenterIdx * 3 + 1] = ty0 / nPts; pos[topCenterIdx * 3 + 2] = tz0 / nPts;

    const tris = [];
    for (let j = 0; j < nPts; j++) {
      const jN = (j + 1) % nPts;
      tris.push(botCenterIdx, jN, j);
      tris.push(topCenterIdx, (nSlices - 1) * nPts + j, (nSlices - 1) * nPts + jN);
    }
    for (let k = 0; k < nSlices - 1; k++) {
      const b0 = k * nPts, b1 = (k + 1) * nPts;
      for (let j = 0; j < nPts; j++) {
        const jN = (j + 1) % nPts;
        tris.push(b0 + j, b0 + jN, b1 + jN, b0 + j, b1 + jN, b1 + j);
      }
    }
    return core.manifoldFromRawSoup(mf, pos, new Uint32Array(tris), 1e-6);
  }

  /**
   * Builds the watertight 2-manifold Varso Tower (310 m) with 3 asymmetric
   * terraced shafts, vertical mullion fins, rooftop parapets, and braced 80 m mast.
   * @param {object} core
   * @param {object} mf
   * @param {object} ctx
   * @param {object} anchor
   * @returns {object|null}
   */
  function buildWarsawVarsoTowerManifold(core, mf, ctx, anchor) {
    if (!core || !mf || !ctx || !anchor) return null;
    const scaleMm = ctx.scaleMm || 1.0;
    const mmPerM = anchor.uPerM * scaleMm;
    if (!(mmPerM > 1e-4)) return null;

    const xy = anchor.toBedXY;
    const zB = (m) => anchor.toBedZ(m);
    const zFloorU = Math.max(0.15 / scaleMm, anchor.zDatumU - 0.65 / scaleMm);
    const solids = [];
    const finW = Math.max(1.8, 0.34 / mmPerM);
    const finOut = Math.max(1.1, 0.20 / mmPerM);

    // 1. Ground lobby & urban block podium (0..12 m)
    _pushTier(solids, core, mf, _polyBed(xy, [
      [-42.1, -1.5], [-32.8, -14.0], [-7.8, -21.2], [3.5, -23.5],
      [31.0, -16.2], [31.2, -5.2], [15.3, 20.1], [-23.9, 21.1], [-40.5, 14.5],
    ]), zFloorU, zB(12.2));

    // 2. Tier 1 North-East terraced glass shaft (0..175 m + 175..180 m terrace rim)
    _pushTier(solids, core, mf, _polyBed(xy, [
      [-23.9, 13.5], [-14.5, 13.2], [10.1, 13.0], [22.6, -6.7],
      [31.2, -5.8], [23.5, 7.3], [15.0, 20.4], [-23.9, 21.1],
    ]), zFloorU, zB(175.0));
    _pushTier(solids, core, mf, _polyBed(xy, [
      [-21.5, 15.0], [10.5, 14.8], [23.2, -4.5], [29.2, -4.5], [14.2, 19.2], [-21.5, 19.6],
    ]), zB(174.5), zB(180.0));

    // 3. Tier 2 Central setback terraced shaft (0..204 m + 204..209 m terrace rim)
    _pushTier(solids, core, mf, _polyBed(xy, [
      [-25.2, 4.9], [-12.2, -15.4], [-7.0, -21.8], [3.5, -23.5],
      [31.6, -23.1], [31.4, -15.6], [23.1, -14.8], [22.6, -6.7],
      [10.1, 13.0], [-14.5, 13.2], [-20.7, 12.5], [-20.6, 5.5],
    ]), zFloorU, zB(204.0));
    _pushTier(solids, core, mf, _polyBed(xy, [
      [-17.0, 1.5], [-8.0, -13.0], [18.0, -13.5], [18.0, -4.5], [9.0, 10.5], [-17.0, 10.5],
    ]), zB(203.5), zB(209.0));

    // 4. Tier 3 Main summit shaft (0..230 m + 230..236 m observation terrace & core)
    _pushTier(solids, core, mf, _polyBed(xy, [
      [-25.2, 4.9], [-12.2, -15.4], [-7.0, -21.8], [3.5, -23.5],
      [31.6, -23.1], [31.2, -15.8], [23.1, -14.4], [1.1, -14.3], [-3.0, -12.3], [-13.8, 4.8],
    ]), zFloorU, zB(230.0));
    _pushTier(solids, core, mf, _polyBed(xy, [
      [-19.5, -4.0], [-8.5, -20.5], [27.5, -20.8], [27.5, -16.5], [1.0, -16.5], [-14.0, -4.0],
    ]), zB(229.5), zB(235.5));

    // Vertical structural facade mullions on South and North faces
    for (const sx of [2.5, 10.5, 18.5, 26.5]) {
      _pushTier(solids, core, mf, _polyBed(xy, [
        [sx - finW * 0.5, -23.5 - finOut], [sx + finW * 0.5, -23.5 - finOut],
        [sx + finW * 0.5, -21.5], [sx - finW * 0.5, -21.5],
      ]), zFloorU, zB(229.5));
    }
    for (const fx of [-16.0, -6.0, 4.0]) {
      _pushTier(solids, core, mf, _polyBed(xy, [
        [fx - finW * 0.5, 19.5], [fx + finW * 0.5, 19.5],
        [fx + finW * 0.5, 21.1 + finOut], [fx - finW * 0.5, 21.1 + finOut],
      ]), zFloorU, zB(175.5));
    }

    // 5. Integrated mast buttress & sleek 80 m spire (195..310 m) inside Tier 3 SW corner
    const mx = -4.5, my = -18.2;
    const zMastBaseU = zB(234.0), zMastTopU = zB(310.0);
    const mastHMm = Math.max(1.0, (zMastTopU - zMastBaseU) * scaleMm);
    const reqDiaMm = (ctx.slaLaws && typeof ctx.slaLaws.minPinDiameterMm === 'function')
      ? ctx.slaLaws.minPinDiameterMm(mastHMm)
      : 0.65;
    const rBotMm = Math.min(0.62, Math.max(0.50, reqDiaMm * 0.42));
    const rBot = Math.max(rBotMm / scaleMm, 2.6 * anchor.uPerM);
    const rMid = rBot * 0.78;
    const rTop = rBot * 0.62;
    const rTip = Math.max(0.325 / scaleMm, rBot * 0.52);
    const spineHalfM = Math.max(2.8, (rBot / anchor.uPerM) * 1.15);
    _pushTier(solids, core, mf, _regPolyBed(xy, mx, my, spineHalfM, 8, Math.PI / 8), zB(195.0), zB(236.0));

    const [mbx, mby] = xy(mx, my);
    const zS1 = zMastBaseU + (zMastTopU - zMastBaseU) * 0.34;
    const zS2 = zMastBaseU + (zMastTopU - zMastBaseU) * 0.68;
    const zOv = 0.04 / scaleMm;

    const pushMastCyl = (z0, z1, ra, rb) => {
      const h = z1 - z0;
      if (h <= 1e-5) return;
      const raw = mf.Manifold.cylinder(h, ra, rb, 10, false);
      const moved = raw.translate([mbx, mby, z0]);
      core.safeDeleteManifold(raw);
      if (moved && moved.numTri() > 0) solids.push(moved);
    };
    pushMastCyl(zMastBaseU - zOv, zS1 + zOv, rBot, rMid);
    pushMastCyl(zS1 - zOv, zS2 + zOv, rMid, rTop);
    pushMastCyl(zS2 - zOv, zMastTopU, rTop, rTip);

    if (solids.length === 0) return null;
    const merged = solids.length === 1 ? solids[0] : core.batchUnionManifolds(mf, solids);
    if (!merged || merged.numTri() === 0) {
      core.safeDeleteManifold(merged);
      return null;
    }
    return merged;
  }

  /**
   * Computes a smooth CCW Libeskind "eagle wing" cross-section at elevation hM.
   * @param {number} hM
   * @param {number} zOverride
   * @returns {number[][]}
   */
  function _zlota44WingRing(hM, zOverride = NaN) {
    const t = Math.max(0, Math.min(1, hM / 192.0));
    const taper = 1.0 - 0.38 * Math.pow(t, 1.25);
    const xWest = -28.5 + 9.2 * Math.pow(t, 1.15);
    const ySouth = -16.8 + 6.0 * Math.pow(t, 1.35);
    const yNorth = 23.6 - 2.0 * t;
    const xSpineEast = 1.2 - 1.2 * t;
    const bulgeM = 6.2 * taper;

    const pts = [];
    for (let i = 0; i <= 9; i++) {
      const f = i / 9;
      const y = ySouth + (yNorth - ySouth) * f;
      const x = xSpineEast + bulgeM * Math.sin(Math.PI * (0.08 + 0.84 * f));
      pts.push([x, y]);
    }
    pts.push([-7.8 + 2.0 * t, yNorth - 0.4]);
    pts.push([xWest, yNorth]);
    pts.push([xWest - 0.8 * taper, (ySouth + yNorth) * 0.4]);
    pts.push([xWest + 1.2 * taper, ySouth + 1.5]);
    pts.push([-12.5 + 3.0 * t, ySouth - 0.8]);

    return pts.map(([x, y]) => {
      if (Number.isFinite(zOverride)) return [x, y, zOverride];
      const zPlaneM = 192.0 - 0.52 * (x - xWest) - 0.44 * (yNorth - y);
      return [x, y, Math.max(150.0, Math.min(192.0, zPlaneM))];
    });
  }

  /**
   * Builds the watertight 2-manifold Zlota 44 (192 m) Libeskind eagle-wing tower
   * with retail podium, swept convex wing blade, diagonal knife-edge crest, and fins.
   * @param {object} core
   * @param {object} mf
   * @param {object} ctx
   * @param {object} anchor
   * @returns {object|null}
   */
  function buildWarsawZlota44Manifold(core, mf, ctx, anchor) {
    if (!core || !mf || !ctx || !anchor) return null;
    const scaleMm = ctx.scaleMm || 1.0;
    const mmPerM = anchor.uPerM * scaleMm;
    if (!(mmPerM > 1e-4)) return null;

    const xy = anchor.toBedXY;
    const zB = (m) => anchor.toBedZ(m);
    const zFloorU = Math.max(0.15 / scaleMm, anchor.zDatumU - 0.65 / scaleMm);
    const solids = [];

    // 1. East & North retail podium terraces (0..28 m and 0..32 m)
    _pushTier(solids, core, mf, _polyBed(xy, [
      [-28.7, -14.8], [22.9, -14.9], [28.0, 23.8], [-28.7, 24.2],
    ]), zFloorU, zB(28.0));
    _pushTier(solids, core, mf, _polyBed(xy, [
      [-1.3, -14.7], [16.1, -14.9], [10.9, 23.2], [3.0, 22.2],
    ]), zFloorU, zB(32.0));

    // 2. Lofted Libeskind curved "eagle wing" shaft rising to diagonal knife-edge crest (0..192 m)
    const sliceHeightsM = [0, 28, 60, 95, 125, 148, 164];
    const rings = [_zlota44WingRing(0, zFloorU)];
    for (let i = 1; i < sliceHeightsM.length; i++) {
      rings.push(_zlota44WingRing(sliceHeightsM[i], sliceHeightsM[i]));
    }
    rings.push(_zlota44WingRing(182.0, NaN));
    const wingSolid = _loftRingsManifold(core, mf, anchor, rings);
    if (wingSolid) solids.push(wingSolid);

    // 3. Stepped dorsal wing setback crest aligned strictly below diagonal roof plane
    const finRings = [
      [[-20.5, 9.0, 146.0], [-10.0, 11.5, 146.0], [-7.5, 21.8, 146.0], [-20.0, 22.0, 146.0]],
      [[-20.5, 9.0, 183.0], [-10.0, 11.5, 179.0], [-7.5, 21.8, 185.0], [-20.0, 22.0, 192.0]],
    ];
    const dorsalFin = _loftRingsManifold(core, mf, anchor, finRings);
    if (dorsalFin) solids.push(dorsalFin);

    const finW = Math.max(1.8, 0.34 / mmPerM);
    for (const fy of [-6.0, 4.0, 14.0]) {
      _pushTier(solids, core, mf, _polyBed(xy, [
        [-28.6, fy - finW * 0.5], [-23.0, fy - finW * 0.5],
        [-23.0, fy + finW * 0.5], [-28.6, fy + finW * 0.5],
      ]), zFloorU, zB(152.0));
    }

    if (solids.length === 0) return null;
    const merged = solids.length === 1 ? solids[0] : core.batchUnionManifolds(mf, solids);
    if (!merged || merged.numTri() === 0) {
      core.safeDeleteManifold(merged);
      return null;
    }
    return merged;
  }

  const WARSAW_VARSO_TOWER_SPEC = {
    id: 'warsaw_varso_tower',
    name: 'Varso Tower',
    lat: 52.2288540,
    lon: 21.0001216,
    headingDeg: 19.93,
    footprintRadiusM: 55.0,
    maxHeightM: 310.0,
    replaceOsmIds: [
      693894333, 875519277, 875519279, 875519280, 875519281, 875519282,
      912427955, 984591962, 984591963, 984591964, 984591965, 984591966,
      984842458, 984842460, 984842461, 984842462, 984842463, 984842464,
      984842466, 984842486, 984842487, 984842488, 984842489,
      1429126521, 1429126522, 1429126523, 1429126524, 1429126525,
      1429126526, 1429126527, 1429126528, 1429126529, 1429126530, 1429126531,
      1433398506,
    ],
    buildManifold: buildWarsawVarsoTowerManifold,
  };

  const WARSAW_ZLOTA_44_SPEC = {
    id: 'warsaw_zlota_44',
    name: 'Zlota 44',
    lat: 52.2311831,
    lon: 21.0024991,
    headingDeg: 19.93,
    footprintRadiusM: 42.0,
    maxHeightM: 192.0,
    replaceOsmIds: [
      33068248, 239175869, 239175870, 979893146,
      982221142, 982221143, 982221144, 982799287,
    ],
    buildManifold: buildWarsawZlota44Manifold,
  };

  if (typeof root.registerHeroLandmark === 'function') {
    root.registerHeroLandmark(WARSAW_VARSO_TOWER_SPEC);
    root.registerHeroLandmark(WARSAW_ZLOTA_44_SPEC);
  }

  const exportsObj = {
    WARSAW_VARSO_TOWER_SPEC,
    WARSAW_ZLOTA_44_SPEC,
    buildWarsawVarsoTowerManifold,
    buildWarsawZlota44Manifold,
  };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
