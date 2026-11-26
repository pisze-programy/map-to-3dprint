// ============================================================================
// src/geometry/scene_rotation.js
// Area Orientation / Rotation Transform (Vector + DEM Grid, Including
// bridgePolys, roadPolys, Water, Parks, Trees & S3DB Buildings)
// ============================================================================

'use strict';

/**
 * Normalizes any rotation angle in degrees to [-180, 179].
 * @param {number} deg
 * @returns {number}
 */
function normalizeRotationDeg(deg) {
  let d = Number(deg) || 0;
  d = ((d + 180) % 360 + 360) % 360 - 180;
  return Math.round(d);
}

/**
 * Captures an unrotated snapshot of all scene vectors and DEM grid once.
 * @param {object} scene
 * @returns {void}
 */
function ensureUnrotatedSceneSnapshot(scene) {
  if (!scene || scene._unrotatedSnapshot) return;
  const clonePt = p => [p[0], p[1]];
  const cloneRing = r => (r || []).map(clonePt);
  const cloneHoles = holes => (holes || []).map(cloneRing);

  scene._unrotatedSnapshot = {
    waterPolys: (scene.waterPolys || []).map(wp => ({
      ...wp,
      outer: cloneRing(wp.outer),
      holes: cloneHoles(wp.holes),
      _unrotatedLandRings: Array.isArray(wp._unrotatedLandRings) ? cloneHoles(wp._unrotatedLandRings) : undefined,
      _unrotatedShingleRings: Array.isArray(wp._unrotatedShingleRings) ? cloneHoles(wp._unrotatedShingleRings) : undefined
    })),
    waterLines: (scene.waterLines || []).map(wl => ({
      ...wl, pts: cloneRing(wl.pts)
    })),
    greenPolys: (scene.greenPolys || []).map(gp => ({
      ...gp, outer: cloneRing(gp.outer), holes: cloneHoles(gp.holes)
    })),
    trees: (scene.trees || []).map(t => [t[0], t[1], t[2]]),
    roads: (scene.roads || []).map(rd => ({
      ...rd, pts: cloneRing(rd.pts)
    })),
    roadPolys: (scene.roadPolys || []).map(rp => ({
      ...rp, outer: cloneRing(rp.outer), holes: cloneHoles(rp.holes)
    })),
    bridgePolys: (scene.bridgePolys || []).map(bp => ({
      ...bp, outer: cloneRing(bp.outer), holes: cloneHoles(bp.holes)
    })),
    pierPolys: (scene.pierPolys || []).map(pp => ({
      ...pp, outer: cloneRing(pp.outer), holes: cloneHoles(pp.holes)
    })),
    pierLines: (scene.pierLines || []).map(pl => ({
      ...pl, pts: cloneRing(pl.pts)
    })),
    bridgeSupports: (scene.bridgeSupports || []).map(bs => ({
      ...bs, pt: bs.pt ? [bs.pt[0], bs.pt[1]] : null, outer: bs.outer ? cloneRing(bs.outer) : null, pts: bs.pts ? cloneRing(bs.pts) : null
    })),
    openSeaIslands: Array.isArray(scene._openSeaIslands) ? scene._openSeaIslands.map(cloneRing) : null,
    openSeaRect: Array.isArray(scene._openSeaRect) ? cloneRing(scene._openSeaRect) : null,
    buildings: (scene.buildings || []).map(b => ({
      ...b, outer: cloneRing(b.outer), holes: cloneHoles(b.holes)
    })),
    dem: scene.dem ? {
      gridSize: scene.dem.gridSize,
      minElev: scene.dem.minElev,
      maxElev: scene.dem.maxElev,
      grid: (scene.dem.grid || []).map(row => row.slice())
    } : null,
    demHalfUnits: scene._demHalfUnits || Math.max((scene.halfW || ((typeof SCENE_CANONICAL_HALF_UNITS !== 'undefined') ? SCENE_CANONICAL_HALF_UNITS : 84.6)) + 0.4, (scene.halfH || ((typeof SCENE_CANONICAL_HALF_UNITS !== 'undefined') ? SCENE_CANONICAL_HALF_UNITS : 84.6)) + 0.4)
  };
  scene._appliedRotationDeg = null;
  scene._appliedDemSig = '';
}

/**
 * Resamples a DEM grid onto the rotated target frame using bilinear interpolation.
 * @param {object} rawDem
 * @param {number} rad
 * @param {number} [padW=85.0]
 * @param {number} [padH=85.0]
 * @param {number} [demHalfU=85.0]
 * @returns {object}
 */
function rotateDemGridBilinear(rawDem, rad, padW = 85.0, padH = 85.0, demHalfU = 85.0) {
  if (!rawDem || !rawDem.grid || rawDem.grid.length < 2) return rawDem;
  const N = rawDem.gridSize || rawDem.grid.length;
  const src = rawDem.grid;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const denom = Math.max(1, N - 1);
  const effDemHalf = Math.max(1.0, demHalfU || Math.max(padW, padH));
  const invDemSpan = 1.0 / (2.0 * effDemHalf);
  const outGrid = [];
  let minElev = Infinity;
  let maxElev = -Infinity;

  for (let gy = 0; gy < N; gy++) {
    const by = -padH + (gy / denom) * (2.0 * padH);
    const row = new Array(N);
    for (let gx = 0; gx < N; gx++) {
      const bx = -padW + (gx / denom) * (2.0 * padW);
      const wx = bx * cosA + by * sinA;
      const wy = -bx * sinA + by * cosA;
      const su = Math.min(N - 1.0001, Math.max(0, (wx + effDemHalf) * invDemSpan * denom));
      const sv = Math.min(N - 1.0001, Math.max(0, (wy + effDemHalf) * invDemSpan * denom));
      const i0 = Math.floor(su);
      const i1 = Math.min(N - 1, i0 + 1);
      const j0 = Math.floor(sv);
      const j1 = Math.min(N - 1, j0 + 1);
      const fu = su - i0;
      const fv = sv - j0;
      const val = (src[j0][i0] * (1 - fu) + src[j0][i1] * fu) * (1 - fv) +
                  (src[j1][i0] * (1 - fu) + src[j1][i1] * fu) * fv;
      const rVal = Math.round(val * 100) / 100;
      row[gx] = rVal;
      if (rVal < minElev) minElev = rVal;
      if (rVal > maxElev) maxElev = rVal;
    }
    outGrid.push(row);
  }

  return {
    gridSize: N,
    minElev: Number.isFinite(minElev) ? minElev : rawDem.minElev,
    maxElev: Number.isFinite(maxElev) ? maxElev : rawDem.maxElev,
    grid: outGrid
  };
}

/**
 * Rotates all scene geometry layers and DEM heights around the bed center.
 * @param {object} scene
 * @param {number} rotationDeg
 * @param {number|null} [bedHalfW=null]
 * @param {number|null} [bedHalfH=null]
 * @returns {object}
 */
function applySceneRotation(scene, rotationDeg, bedHalfW = null, bedHalfH = null) {
  if (!scene) return scene;
  ensureUnrotatedSceneSnapshot(scene);
  const normDeg = normalizeRotationDeg(rotationDeg);
  const canonHalfU = (typeof SCENE_CANONICAL_HALF_UNITS !== 'undefined') ? SCENE_CANONICAL_HALF_UNITS : 84.6;
  const effHalfW = (typeof bedHalfW === 'number' && bedHalfW > 0) ? bedHalfW : (scene.halfW || canonHalfU);
  const effHalfH = (typeof bedHalfH === 'number' && bedHalfH > 0) ? bedHalfH : (scene.halfH || canonHalfU);
  const padW = effHalfW + 0.4;
  const padH = effHalfH + 0.4;
  const snap = scene._unrotatedSnapshot;
  const demHalfU = snap.demHalfUnits || scene._demHalfUnits || Math.max(padW, padH);
  const demSig = `${normDeg}_${padW.toFixed(2)}_${padH.toFixed(2)}_${demHalfU.toFixed(2)}`;
  if (scene._appliedRotationDeg === normDeg && scene._appliedDemSig === demSig) return scene;
  const bStateById = new Map();
  for (const b of (scene.buildings || [])) {
    bStateById.set(b.id, {
      highlighted: b.highlighted,
      hidden: b.hidden,
      heightMult: b.heightMult,
      _pickId: b._pickId
    });
  }

  const rad = (normDeg * Math.PI) / 180.0;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const rotPt = (normDeg === 0)
    ? (p => [p[0], p[1]])
    : (p => [
        Math.round((p[0] * cosA - p[1] * sinA) * 1000) / 1000,
        Math.round((p[0] * sinA + p[1] * cosA) * 1000) / 1000
      ]);
  const rotRing = r => (r || []).map(rotPt);
  const rotHoles = holes => (holes || []).map(rotRing);

  scene.waterPolys = snap.waterPolys.map(wp => ({
    ...wp,
    outer: rotRing(wp.outer),
    holes: rotHoles(wp.holes),
    _rotatedLandRings: Array.isArray(wp._unrotatedLandRings) ? rotHoles(wp._unrotatedLandRings) : undefined,
    _rotatedShingleRings: Array.isArray(wp._unrotatedShingleRings) ? rotHoles(wp._unrotatedShingleRings) : undefined
  }));
  scene.waterLines = snap.waterLines.map(wl => ({ ...wl, pts: rotRing(wl.pts) }));
  scene.greenPolys = snap.greenPolys.map(gp => ({ ...gp, outer: rotRing(gp.outer), holes: rotHoles(gp.holes) }));
  scene.trees = snap.trees.map(t => {
    const rp = rotPt(t);
    return [Math.round(rp[0] * 100) / 100, Math.round(rp[1] * 100) / 100, t[2]];
  });
  scene.roads = snap.roads.map(rd => ({ ...rd, pts: rotRing(rd.pts) }));
  scene.roadPolys = snap.roadPolys.map(rp => ({ ...rp, outer: rotRing(rp.outer), holes: rotHoles(rp.holes) }));
  scene.bridgePolys = (snap.bridgePolys || []).map(bp => ({ ...bp, outer: rotRing(bp.outer), holes: rotHoles(bp.holes) }));
  scene.pierPolys = (snap.pierPolys || []).map(pp => ({ ...pp, outer: rotRing(pp.outer), holes: rotHoles(pp.holes) }));
  scene.pierLines = (snap.pierLines || []).map(pl => ({ ...pl, pts: rotRing(pl.pts) }));
  scene.bridgeSupports = (snap.bridgeSupports || []).map(bs => ({
    ...bs,
    pt: bs.pt ? rotPt(bs.pt) : null,
    outer: bs.outer ? rotRing(bs.outer) : null,
    pts: bs.pts ? rotRing(bs.pts) : null
  }));
  if (Array.isArray(snap.openSeaIslands)) {
    scene._openSeaIslands = snap.openSeaIslands.map(rotRing);
  }
  if (Array.isArray(snap.openSeaRect)) {
    scene._openSeaRect = rotRing(snap.openSeaRect);
  }

  scene.buildings = snap.buildings.map(b => {
    const outer = rotRing(b.outer);
    const holes = rotHoles(b.holes);
    const rc = rotPt([b.cx || 0, b.cy || 0]);
    const st = bStateById.get(b.id);
    const outB = {
      ...b,
      cx: Math.round(rc[0] * 100) / 100,
      cy: Math.round(rc[1] * 100) / 100,
      outer,
      holes
    };
    if (typeof b.roofDir === 'number') {
      outB.roofDir = Math.round((((b.roofDir - normDeg) % 360) + 360) % 360 * 10) / 10;
    }
    if (st) {
      if (st.highlighted !== undefined) outB.highlighted = st.highlighted;
      if (st.hidden !== undefined) outB.hidden = st.hidden;
      if (st.heightMult !== undefined) outB.heightMult = st.heightMult;
      if (st._pickId !== undefined) outB._pickId = st._pickId;
    }
    return outB;
  });

  if (snap.dem) {
    const needsDemResample = normDeg !== 0 || Math.abs(demHalfU - padW) > 0.5 || Math.abs(demHalfU - padH) > 0.5;
    scene.dem = !needsDemResample
      ? {
          gridSize: snap.dem.gridSize,
          minElev: snap.dem.minElev,
          maxElev: snap.dem.maxElev,
          grid: snap.dem.grid.map(r => r.slice())
        }
      : rotateDemGridBilinear(snap.dem, rad, padW, padH, demHalfU);
  }

  scene._appliedRotationDeg = normDeg;
  scene._appliedDemSig = demSig;
  return scene;
}

if (typeof globalThis !== 'undefined') {
  globalThis.normalizeRotationDeg = normalizeRotationDeg;
  globalThis.ensureUnrotatedSceneSnapshot = ensureUnrotatedSceneSnapshot;
  globalThis.rotateDemGridBilinear = rotateDemGridBilinear;
  globalThis.applySceneRotation = applySceneRotation;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeRotationDeg,
    ensureUnrotatedSceneSnapshot,
    rotateDemGridBilinear,
    applySceneRotation
  };
}
