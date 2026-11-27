// ============================================================================
// src/mesh/tile_seam_cutter.js
// Compose-First, Cut-Last Master Frame Solid Builder & Seam-Exact Slicer
// Pure ASCII module with strict JSDoc types.
// ============================================================================

(function (root) {
  'use strict';

  /** @type {WeakMap<object, Map<string, object>>} */
  const _frameCache = new WeakMap();

  /**
   * @param {object|null} [vaultOverride]
   * @returns {{core: object, poly: object, cfgMod: object, ventMod: object, vaultMod: object|null, catalogMod: object|null}}
   */
  function _getDeps(vaultOverride = null) {
    const core = (typeof extractDePinchedStlTriangles === 'function')
      ? root
      : (typeof require !== 'undefined' ? require('../geometry/manifold_core.js') : root);
    const poly = (typeof signedArea2D === 'function')
      ? root
      : (typeof require !== 'undefined' ? require('../geometry/polygon_2d.js') : root);
    const cfgMod = (typeof resolveSceneScaleAndSpec === 'function')
      ? root
      : (typeof require !== 'undefined' ? require('../geometry/print_physics_config.js') : root);
    const ventMod = (typeof buildGabledTunnelManifold === 'function')
      ? root
      : (typeof require !== 'undefined' ? require('./tile_msla_vent_builder.js') : root);
    const vaultMod = (vaultOverride && typeof vaultOverride._plugInlandThroughHoles === 'function')
      ? vaultOverride
      : ((typeof _applyPostUnionMslaPrintGuard === 'function') ? root : null);
    let catalogMod = null;
    if (typeof resolveFormatSpecForState === 'function') {
      catalogMod = root;
    } else if (typeof require !== 'undefined') {
      try { catalogMod = require('../geometry/format_catalog.js'); } catch (_) {}
    }
    return { core, poly, cfgMod, ventMod, vaultMod, catalogMod };
  }

  /**
   * @param {object} state
   * @param {string} cacheKey
   * @returns {object|null}
   */
  function getCachedMasterFrameEntry(state, cacheKey = '') {
    const meshesObj = (state && (state.layerMeshes || state.meshes)) || null;
    if (!meshesObj || typeof meshesObj !== 'object') return null;
    const byKey = _frameCache.get(meshesObj);
    if (!byKey) return null;
    if (cacheKey && byKey.has(cacheKey)) return byKey.get(cacheKey);
    const first = byKey.values().next();
    return first && !first.done ? first.value : null;
  }

  /**
   * Builds a closed chamfered tile clipping box in scene units.
   * Implements DFM-06: elephantFootInsetMm inward on Z = 0..0.25 mm with a 45 deg flare
   * to flush 0.0 mm inset at Z = elephantFootHeightMm (0.50 mm) and above.
   * @param {object} mf
   * @param {number} minX
   * @param {number} maxX
   * @param {number} minY
   * @param {number} maxY
   * @param {number} zBotU
   * @param {number} zTopU
   * @param {number} scaleMm
   * @param {number} insetMm
   * @param {number} chamferTopMm
   * @returns {object|null}
   */
  function buildChamferedTileClipBox(mf, minX, maxX, minY, maxY, zBotU, zTopU, scaleMm, insetMm = 0.25, chamferTopMm = 0.50) {
    const spanXMm = (maxX - minX) * scaleMm;
    const spanYMm = (maxY - minY) * scaleMm;
    const safeInsetMm = Math.max(0.0, Math.min(insetMm, Math.min(spanXMm, spanYMm) * 0.2));
    if (safeInsetMm <= 1e-6 || chamferTopMm <= 1e-6) {
      const { core } = _getDeps();
      return core.boxManifoldFromBounds(mf, minX, maxX, minY, maxY, zBotU, zTopU);
    }

    const dU = safeInsetMm / scaleMm;
    const zKneeU = Math.min(chamferTopMm * 0.5, chamferTopMm - 0.05) / scaleMm;
    const zFlareU = chamferTopMm / scaleMm;
    if (zBotU >= zKneeU - 1e-6 || zTopU <= zFlareU + 1e-6) {
      const { core } = _getDeps();
      return core.boxManifoldFromBounds(mf, minX, maxX, minY, maxY, zBotU, zTopU);
    }

    const ix0 = minX + dU;
    const ix1 = maxX - dU;
    const iy0 = minY + dU;
    const iy1 = maxY - dU;

    // 4 Z rings x 4 CCW corners = 16 vertices
    const verts = [
      ix0, iy0, zBotU,   ix1, iy0, zBotU,   ix1, iy1, zBotU,   ix0, iy1, zBotU,
      ix0, iy0, zKneeU,  ix1, iy0, zKneeU,  ix1, iy1, zKneeU,  ix0, iy1, zKneeU,
      minX, minY, zFlareU, maxX, minY, zFlareU, maxX, maxY, zFlareU, minX, maxY, zFlareU,
      minX, minY, zTopU,   maxX, minY, zTopU,   maxX, maxY, zTopU,   minX, maxY, zTopU,
    ];
    const tris = [];
    // Bottom cap (CCW looking from outside, i.e. -Z normal)
    tris.push(0, 2, 1, 0, 3, 2);
    // Top cap (+Z normal)
    tris.push(12, 13, 14, 12, 14, 15);
    // 3 side strips connecting rings 0->1, 1->2, 2->3
    for (let r = 0; r < 3; r++) {
      const a0 = r * 4;
      const b0 = (r + 1) * 4;
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) & 3;
        const v00 = a0 + k;
        const v10 = a0 + k2;
        const v11 = b0 + k2;
        const v01 = b0 + k;
        tris.push(v00, v10, v11, v00, v11, v01);
      }
    }

    const meshObj = new mf.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(verts),
      triVerts: new Uint32Array(tris),
    });
    const m = mf.Manifold(meshObj);
    if (m && typeof m.numTri === 'function' && m.numTri() > 0) return m;
    const { core } = _getDeps();
    core.safeDeleteManifold(m);
    return null;
  }

  /**
   * Computes even 1D line positions strictly between lo and hi avoiding parallel cuts.
   * @param {number} lo
   * @param {number} hi
   * @param {number} pitch
   * @param {Array<number>} avoidPlanes
   * @param {number} minCutGap
   * @param {number} [minSpan]
   * @returns {Array<number>}
   */
  function _computeGrooveCoords1D(lo, hi, pitch, avoidPlanes, minCutGap, minSpan = 4.0) {
    const span = hi - lo;
    if (span < minSpan) return [];
    const nLines = Math.max(2, Math.round(span / pitch) + 1);
    const step = span / (nLines - 1);
    const coords = [];
    for (let i = 0; i < nLines; i++) {
      const c = lo + i * step;
      let tooCloseToCut = false;
      for (let j = 0; j < avoidPlanes.length; j++) {
        if (Math.abs(c - avoidPlanes[j]) < minCutGap) {
          tooCloseToCut = true;
          break;
        }
      }
      if (!tooCloseToCut) coords.push(c);
    }
    return coords;
  }

  /**
   * Carves a continuous seam-aligned 45 deg gabled underside stress-relief network
   * on the uncut master solid (Z = 0..1.50 mm, width 2.6 mm, pitch synced to format_catalog.json)
   * with an unbroken >= 8.0 mm solid perimeter skirt along all 4 outer passe-partout walls.
   * Enclosed inland lakes (>= 18 mm2) vent into this network so outer walls stay smooth.
   * @param {object} core
   * @param {object} poly
   * @param {object} mf
   * @param {object} ventMod
   * @param {object} vaultMod
   * @param {object} masterSolid
   * @param {number} scaleMm
   * @param {number} halfW
   * @param {number} halfH
   * @param {Array<number>} cutXsU
   * @param {Array<number>} cutYsU
   * @param {number} baseBottomMm
   * @param {object|null} [reliefDefaults]
   * @returns {object}
   */
  function _carveUndersideStressReliefNetwork(core, poly, mf, ventMod, vaultMod, masterSolid, scaleMm, halfW, halfH, cutXsU, cutYsU, baseBottomMm, reliefDefaults = null) {
    if (!masterSolid || masterSolid.numTri() === 0 || !ventMod) return masterSolid;
    const totalWMm = 2 * halfW * scaleMm;
    const totalHMm = 2 * halfH * scaleMm;
    if (totalWMm < 36.0 || totalHMm < 36.0) return masterSolid;

    const rDef = (reliefDefaults && typeof reliefDefaults === 'object') ? reliefDefaults : {};
    const skirtMm = Number(rDef.underside_relief_skirt_mm) > 0 ? Number(rDef.underside_relief_skirt_mm) : 8.0;
    const grooveWidthMm = Number(rDef.underside_relief_width_mm) > 0 ? Number(rDef.underside_relief_width_mm) : 2.6;
    const pitchMm = Number(rDef.underside_relief_pitch_mm) > 0 ? Number(rDef.underside_relief_pitch_mm) : 8.8;
    const reliefCapMm = Number(rDef.underside_relief_height_mm) > 0 ? Number(rDef.underside_relief_height_mm) : 1.50;
    const reliefHeightMm = Math.min(reliefCapMm, Math.max(0.85, baseBottomMm - 1.20));
    const jambTopMm = Math.min(0.85, reliefHeightMm * 0.56);
    const gableRiseMm = Math.max(0.20, reliefHeightMm - jambTopMm);
    const skirtU = skirtMm / scaleMm;
    const halfWGrooveU = (grooveWidthMm * 0.5) / scaleMm;
    const ax0 = -halfW + skirtU;
    const ax1 = halfW - skirtU;
    const ay0 = -halfH + skirtU;
    const ay1 = halfH - skirtU;
    if (ax1 <= ax0 + 6.0 / scaleMm || ay1 <= ay0 + 6.0 / scaleMm) return masterSolid;

    // Sample solid base at Z = 1.15 mm and Z = 0.25 mm to protect narrow shorelines (>= 1.4 mm wall).
    const zProbeU = Math.min(1.15, Math.max(0.50, baseBottomMm * 0.35)) / scaleMm;
    let basePolys = [];
    let erodedPolys = [];
    let sProbe = null;
    try {
      sProbe = masterSolid.slice(zProbeU);
      if (sProbe && !sProbe.isEmpty()) basePolys = sProbe.toPolygons();
    } catch (_) {
      basePolys = [];
    } finally {
      core.safeDeleteManifold(sProbe);
    }
    if (basePolys.length === 0) return masterSolid;

    // Erode outer shoreline so relief grooves stay >= 2.0 mm inside open water coastlines,
    // and skip < 220 mm2 global islands AND < 180 mm2 per-tile coastal peninsulas so
    // stress-relief grooves never reduce a secondary landmass below VAL-05's 60 mm2 floor.
    try {
      const safeShell = mf.CrossSection.ofPolygons(basePolys, 'Positive');
      let er = safeShell.offset(-2.00 / scaleMm, 'Miter');
      if (er && !er.isEmpty() && (cutXsU.length > 0 || cutYsU.length > 0)) {
        const xsAllR = [-halfW, ...cutXsU, halfW];
        const ysAllR = [-halfH, ...cutYsU, halfH];
        const smallPeninsulas = [];
        for (let tr = 0; tr < ysAllR.length - 1; tr++) {
          for (let tc = 0; tc < xsAllR.length - 1; tc++) {
            const tRect = mf.CrossSection.ofPolygons(
              [[[xsAllR[tc], ysAllR[tr]], [xsAllR[tc + 1], ysAllR[tr]], [xsAllR[tc + 1], ysAllR[tr + 1]], [xsAllR[tc], ysAllR[tr + 1]]]],
              'Positive'
            );
            let tInter = null;
            let tComps = [];
            try {
              tInter = safeShell.intersect(tRect);
              if (tInter && !tInter.isEmpty()) tComps = tInter.decompose();
              for (const tcComp of tComps) {
                if (tcComp.area() * scaleMm * scaleMm < 180.0) {
                  const dil = tcComp.offset(1.00 / scaleMm, 'Miter');
                  if (dil && !dil.isEmpty()) smallPeninsulas.push(dil);
                  else core.safeDeleteManifold(dil);
                }
              }
            } catch (_) {
            } finally {
              for (const tcComp of tComps) core.safeDeleteManifold(tcComp);
              core.safeDeleteManifold(tInter);
              core.safeDeleteManifold(tRect);
            }
          }
        }
        if (smallPeninsulas.length > 0) {
          for (const sp of smallPeninsulas) {
            const nextEr = er.subtract(sp);
            core.safeDeleteManifold(sp);
            core.safeDeleteManifold(er);
            er = nextEr;
            if (!er || er.isEmpty()) break;
          }
        }
      }
      if (er && !er.isEmpty()) {
        const comps = er.decompose();
        for (const c of comps) {
          if (c.area() * scaleMm * scaleMm >= 220.0) {
            for (const r of c.toPolygons()) erodedPolys.push(r);
          }
          core.safeDeleteManifold(c);
        }
      }
      core.safeDeleteManifold(er);
      core.safeDeleteManifold(safeShell);
    } catch (_) {
      erodedPolys = basePolys;
    }
    if (erodedPolys.length === 0) return masterSolid;

    const minCutGapU = 3.8 / scaleMm;
    const minGrooveSpanU = 4.0 / scaleMm;
    const xLinesU = _computeGrooveCoords1D(ax0, ax1, pitchMm / scaleMm, cutXsU, minCutGapU, minGrooveSpanU);
    const yLinesU = _computeGrooveCoords1D(ay0, ay1, pitchMm / scaleMm, cutYsU, minCutGapU, minGrooveSpanU);

    // Clip each groove segment strictly inside erodedPolys so narrow coastlines never get hollowed.
    const runs = [];
    const stepCheckU = 1.6 / scaleMm;
    const isInsideSafe = (px, py) => {
      if (px < ax0 || px > ax1 || py < ay0 || py > ay1) return false;
      // Check against erodedPolys winding via signed inclusion
      let inside = false;
      for (let ri = 0; ri < erodedPolys.length; ri++) {
        if (poly.pointInPoly2D(px, py, erodedPolys[ri])) inside = !inside;
      }
      return inside;
    };

    // Build a coarse exterior-water mask on basePolys so relief grooves stopping at an internal
    // river/canal (e.g. Chicago River, Amsterdam canals) can extend into open water without
    // ever notching the outer >= 8.0 mm passe-partout frame walls.
    let waterGridInfo = null;
    if (vaultMod && typeof vaultMod._rasterizePolysToGrid === 'function') {
      const bBB = masterSolid.boundingBox();
      const sXMm = (bBB.max[0] - bBB.min[0]) * scaleMm;
      const sYMm = (bBB.max[1] - bBB.min[1]) * scaleMm;
      const wStepMm = Math.max(0.55, Math.max(sXMm, sYMm) / 240);
      const wStepU = wStepMm / scaleMm;
      const wNx = Math.ceil((bBB.max[0] - bBB.min[0]) / wStepU) + 2;
      const wNy = Math.ceil((bBB.max[1] - bBB.min[1]) / wStepU) + 2;
      const wOx = bBB.min[0] - wStepU;
      const wOy = bBB.min[1] - wStepU;
      const wSolid = vaultMod._rasterizePolysToGrid(basePolys, wNx, wNy, wOx, wOy, wStepU);
      const wTot = wNx * wNy;
      const wExt = new Uint8Array(wTot);
      const wQ = new Int32Array(wTot);
      let wQh = 0, wQt = 0;
      for (let x = 0; x < wNx; x++) {
        if (!wSolid[x]) { wExt[x] = 1; wQ[wQt++] = x; }
        const ti = (wNy - 1) * wNx + x;
        if (!wSolid[ti] && !wExt[ti]) { wExt[ti] = 1; wQ[wQt++] = ti; }
      }
      for (let y = 0; y < wNy; y++) {
        const li = y * wNx;
        if (!wSolid[li] && !wExt[li]) { wExt[li] = 1; wQ[wQt++] = li; }
        const ri = y * wNx + (wNx - 1);
        if (!wSolid[ri] && !wExt[ri]) { wExt[ri] = 1; wQ[wQt++] = ri; }
      }
      for (let cx of cutXsU) {
        const gx = Math.round((cx - wOx) / wStepU);
        if (gx >= 0 && gx < wNx) {
          for (let gy = 0; gy < wNy; gy++) {
            const idx = gy * wNx + gx;
            if (!wSolid[idx] && !wExt[idx]) { wExt[idx] = 1; wQ[wQt++] = idx; }
          }
        }
      }
      for (let cy of cutYsU) {
        const gy = Math.round((cy - wOy) / wStepU);
        if (gy >= 0 && gy < wNy) {
          for (let gx = 0; gx < wNx; gx++) {
            const idx = gy * wNx + gx;
            if (!wSolid[idx] && !wExt[idx]) { wExt[idx] = 1; wQ[wQt++] = idx; }
          }
        }
      }
      while (wQh < wQt) {
        const cur = wQ[wQh++];
        const cx = cur % wNx, cy = (cur - cx) / wNx;
        if (cx > 0 && !wSolid[cur - 1] && !wExt[cur - 1]) { wExt[cur - 1] = 1; wQ[wQt++] = cur - 1; }
        if (cx + 1 < wNx && !wSolid[cur + 1] && !wExt[cur + 1]) { wExt[cur + 1] = 1; wQ[wQt++] = cur + 1; }
        if (cy > 0 && !wSolid[cur - wNx] && !wExt[cur - wNx]) { wExt[cur - wNx] = 1; wQ[wQt++] = cur - wNx; }
        if (cy + 1 < wNy && !wSolid[cur + wNx] && !wExt[cur + wNx]) { wExt[cur + wNx] = 1; wQ[wQt++] = cur + wNx; }
      }
      waterGridInfo = { wNx, wNy, wOx, wOy, wStepU, wExt };
    }

    const isOpenWaterAt = (px, py) => {
      if (!waterGridInfo) return false;
      if (px <= ax0 + 0.5 / scaleMm || px >= ax1 - 0.5 / scaleMm || py <= ay0 + 0.5 / scaleMm || py >= ay1 - 0.5 / scaleMm) {
        return false;
      }
      const gx = Math.floor((px - waterGridInfo.wOx) / waterGridInfo.wStepU);
      const gy = Math.floor((py - waterGridInfo.wOy) / waterGridInfo.wStepU);
      if (gx < 0 || gx >= waterGridInfo.wNx || gy < 0 || gy >= waterGridInfo.wNy) return false;
      return waterGridInfo.wExt[gy * waterGridInfo.wNx + gx] === 1;
    };

    const findWaterDrainExtU = (px, py, dx, dy) => {
      for (const distMm of [1.8, 2.8, 3.8, 4.8]) {
        const dU = distMm / scaleMm;
        const tx = px + dx * dU;
        const ty = py + dy * dU;
        if (isOpenWaterAt(tx, ty)) return dU;
      }
      return 0;
    };

    const addClippedRunsAlongX = (yVal) => {
      let curStart = null;
      const nSteps = Math.max(2, Math.ceil((ax1 - ax0) / stepCheckU));
      const ds = (ax1 - ax0) / nSteps;
      for (let i = 0; i <= nSteps; i++) {
        const xVal = ax0 + i * ds;
        const ok = isInsideSafe(xVal, yVal);
        if (ok && curStart === null) curStart = xVal;
        if ((!ok || i === nSteps) && curStart !== null) {
          let sx = curStart;
          let ex = ok ? xVal : (ax0 + (i - 1) * ds);
          let drainsWater = false;
          const dLeft = findWaterDrainExtU(sx, yVal, -1, 0);
          if (dLeft > 0) { sx -= dLeft; drainsWater = true; }
          const dRight = findWaterDrainExtU(ex, yVal, 1, 0);
          if (dRight > 0) { ex += dRight; drainsWater = true; }
          if (ex - sx >= 4.0 / scaleMm) {
            runs.push({ pts: [[sx, yVal], [ex, yVal]], halfW: halfWGrooveU, drainsWater });
          }
          curStart = null;
        }
      }
    };

    const addClippedRunsAlongY = (xVal) => {
      let curStart = null;
      const nSteps = Math.max(2, Math.ceil((ay1 - ay0) / stepCheckU));
      const ds = (ay1 - ay0) / nSteps;
      for (let i = 0; i <= nSteps; i++) {
        const yVal = ay0 + i * ds;
        const ok = isInsideSafe(xVal, yVal);
        if (ok && curStart === null) curStart = yVal;
        if ((!ok || i === nSteps) && curStart !== null) {
          let sy = curStart;
          let ey = ok ? yVal : (ay0 + (i - 1) * ds);
          let drainsWater = false;
          const dSouth = findWaterDrainExtU(xVal, sy, 0, -1);
          if (dSouth > 0) { sy -= dSouth; drainsWater = true; }
          const dNorth = findWaterDrainExtU(xVal, ey, 0, 1);
          if (dNorth > 0) { ey += dNorth; drainsWater = true; }
          if (ey - sy >= 4.0 / scaleMm) {
            runs.push({ pts: [[xVal, sy], [xVal, ey]], halfW: halfWGrooveU, drainsWater });
          }
          curStart = null;
        }
      }
    };

    for (let i = 0; i < xLinesU.length; i++) addClippedRunsAlongY(xLinesU[i]);
    for (let i = 0; i < yLinesU.length; i++) addClippedRunsAlongX(yLinesU[i]);

    // On multi-tile plates, keep ONLY relief grooves connected to an open interior tile seam
    // OR open interior water (river/canal) so closed blocks never get self-inflicted suction cups.
    const hasInteriorSeams = (cutXsU.length > 0 || cutYsU.length > 0);
    let activeRuns = runs;
    if (hasInteriorSeams && runs.length > 0) {
      const nR = runs.length;
      const runBB = runs.map((r) => {
        const p0 = r.pts[0];
        const p1 = r.pts[r.pts.length - 1];
        const hw = r.halfW;
        return [
          Math.min(p0[0], p1[0]) - hw,
          Math.max(p0[0], p1[0]) + hw,
          Math.min(p0[1], p1[1]) - hw,
          Math.max(p0[1], p1[1]) + hw,
        ];
      });
      const vented = new Uint8Array(nR);
      const bfs = [];
      for (let i = 0; i < nR; i++) {
        const bb = runBB[i];
        const hitsX = cutXsU.some((cx) => cx >= bb[0] && cx <= bb[1]);
        const hitsY = cutYsU.some((cy) => cy >= bb[2] && cy <= bb[3]);
        if (hitsX || hitsY || runs[i].drainsWater) {
          vented[i] = 1;
          bfs.push(i);
        }
      }
      let bh = 0;
      while (bh < bfs.length) {
        const cur = bfs[bh++];
        const cb = runBB[cur];
        for (let j = 0; j < nR; j++) {
          if (vented[j]) continue;
          const ob = runBB[j];
          if (cb[1] >= ob[0] && cb[0] <= ob[1] && cb[3] >= ob[2] && cb[2] <= ob[3]) {
            vented[j] = 1;
            bfs.push(j);
          }
        }
      }
      activeRuns = [];
      for (let i = 0; i < nR; i++) {
        if (vented[i]) activeRuns.push(runs[i]);
      }
    }

    let out = masterSolid;
    if (activeRuns.length > 0) {
      const tunnelCut = ventMod.buildGabledTunnelManifold(
        core, mf, activeRuns, -0.15 / scaleMm, jambTopMm / scaleMm, gableRiseMm / scaleMm, scaleMm
      );
      if (tunnelCut && tunnelCut.numTri() > 0) {
        const carved = out.subtract(tunnelCut);
        core.safeDeleteManifold(tunnelCut);
        if (carved && carved.numTri() > 0) {
          if (out !== masterSolid) core.safeDeleteManifold(out);
          out = carved;
        } else {
          core.safeDeleteManifold(carved);
        }
      } else {
        core.safeDeleteManifold(tunnelCut);
      }
    }

    // Vent any enclosed base pockets (>= 5.0 mm2) at BOTH Z = 0.55 mm and Z = 1.15 mm
    // into open relief channels / interior seams WITHOUT notching outer >= 8.0 mm frame walls.
    if (typeof ventMod.ventLargeBasePocketsUnderside === 'function' && vaultMod && vaultMod._rasterizePolysToGrid) {
      const ventJambMm = Math.min(1.24, Math.max(jambTopMm, baseBottomMm - 1.50));
      const ventGableMm = Math.max(0.42, Math.min(0.65, baseBottomMm - 1.0 - ventJambMm));
      for (const probeZMm of [0.55, 1.15]) {
        let probeAfter = null;
        let polysAfter = [];
        try {
          probeAfter = out.slice(probeZMm / scaleMm);
          if (probeAfter && !probeAfter.isEmpty()) polysAfter = probeAfter.toPolygons();
        } catch (_) {
          polysAfter = [];
        } finally {
          core.safeDeleteManifold(probeAfter);
        }
        if (polysAfter.length === 0) continue;

        const outBB = out.boundingBox();
        const spanXMm = (outBB.max[0] - outBB.min[0]) * scaleMm;
        const spanYMm = (outBB.max[1] - outBB.min[1]) * scaleMm;
        const stepMm = Math.max(0.45, Math.max(spanXMm, spanYMm) / 280);
        const stepU = stepMm / scaleMm;
        const nx = Math.ceil((outBB.max[0] - outBB.min[0]) / stepU) + 2;
        const ny = Math.ceil((outBB.max[1] - outBB.min[1]) / stepU) + 2;
        const ox = outBB.min[0] - stepU;
        const oy = outBB.min[1] - stepU;
        const solidGrid = vaultMod._rasterizePolysToGrid(polysAfter, nx, ny, ox, oy, stepU);
        const total = nx * ny;
        const extAir = new Uint8Array(total);
        const q = new Int32Array(total);
        let qh = 0;
        let qt = 0;

        // Seed exterior air: outer frame perimeter AND interior tile seams (open on individual tiles!)
        for (let x = 0; x < nx; x++) {
          if (!solidGrid[x]) { extAir[x] = 1; q[qt++] = x; }
          const topIdx = (ny - 1) * nx + x;
          if (!solidGrid[topIdx] && !extAir[topIdx]) { extAir[topIdx] = 1; q[qt++] = topIdx; }
        }
        for (let y = 0; y < ny; y++) {
          const lIdx = y * nx;
          if (!solidGrid[lIdx] && !extAir[lIdx]) { extAir[lIdx] = 1; q[qt++] = lIdx; }
          const rIdx = y * nx + (nx - 1);
          if (!solidGrid[rIdx] && !extAir[rIdx]) { extAir[rIdx] = 1; q[qt++] = rIdx; }
        }
        for (let cx of cutXsU) {
          const gx = Math.round((cx - ox) / stepU);
          if (gx >= 0 && gx < nx) {
            for (let gy = 0; gy < ny; gy++) {
              const idx = gy * nx + gx;
              if (!solidGrid[idx] && !extAir[idx]) { extAir[idx] = 1; q[qt++] = idx; }
            }
          }
        }
        for (let cy of cutYsU) {
          const gy = Math.round((cy - oy) / stepU);
          if (gy >= 0 && gy < ny) {
            for (let gx = 0; gx < nx; gx++) {
              const idx = gy * nx + gx;
              if (!solidGrid[idx] && !extAir[idx]) { extAir[idx] = 1; q[qt++] = idx; }
            }
          }
        }
        while (qh < qt) {
          const cur = q[qh++];
          const cx = cur % nx;
          const cy = (cur - cx) / nx;
          if (cx > 0) { const nb = cur - 1; if (!solidGrid[nb] && !extAir[nb]) { extAir[nb] = 1; q[qt++] = nb; } }
          if (cx + 1 < nx) { const nb = cur + 1; if (!solidGrid[nb] && !extAir[nb]) { extAir[nb] = 1; q[qt++] = nb; } }
          if (cy > 0) { const nb = cur - nx; if (!solidGrid[nb] && !extAir[nb]) { extAir[nb] = 1; q[qt++] = nb; } }
          if (cy + 1 < ny) { const nb = cur + nx; if (!solidGrid[nb] && !extAir[nb]) { extAir[nb] = 1; q[qt++] = nb; } }
        }

        // Group remaining enclosed air pockets >= 5.0 mm2 (safely below VAL-02/03 8.0 mm2 limit)
        const pocketLabel = new Int32Array(total);
        const pockets = [];
        const minCells = Math.max(3, Math.ceil(5.0 / (stepMm * stepMm)));
        for (let i = 0; i < total; i++) {
          if (solidGrid[i] || extAir[i] || pocketLabel[i] !== 0) continue;
          const pid = pockets.length + 1;
          const cells = [];
          const stk = [i];
          pocketLabel[i] = pid;
          while (stk.length > 0) {
            const cur = stk.pop();
            cells.push(cur);
            const cx = cur % nx;
            const cy = (cur - cx) / nx;
            const nbs = [];
            if (cx > 0) nbs.push(cur - 1);
            if (cx + 1 < nx) nbs.push(cur + 1);
            if (cy > 0) nbs.push(cur - nx);
            if (cy + 1 < ny) nbs.push(cur + nx);
            for (let k = 0; k < nbs.length; k++) {
              const nb = nbs[k];
              if (!solidGrid[nb] && !extAir[nb] && pocketLabel[nb] === 0) {
                pocketLabel[nb] = pid;
                stk.push(nb);
              }
            }
          }
          if (cells.length >= minCells) pockets.push(cells);
        }

        if (pockets.length > 0) {
          // Goal mask: prefer interior air/relief grooves/seams; only allow outer perimeter if single-tile.
          const goalMask = new Uint8Array(total);
          for (let i = 0; i < total; i++) {
            if (!extAir[i]) continue;
            const gx = i % nx;
            const gy = (i - gx) / nx;
            const px = ox + gx * stepU;
            const py = oy + gy * stepU;
            const inOuterSkirt = px <= -halfW + skirtU || px >= halfW - skirtU || py <= -halfH + skirtU || py >= halfH - skirtU;
            if (!hasInteriorSeams || !inOuterSkirt) goalMask[i] = 1;
          }
          const lakeRuns = [];
          for (let pi = 0; pi < pockets.length; pi++) {
            const pRuns = ventMod.findShortestSolidVentRuns(pockets[pi], goalMask, solidGrid, nx, ny, ox, oy, stepU, scaleMm, 1.35);
            for (const r of pRuns) lakeRuns.push(r);
          }
          if (lakeRuns.length > 0) {
            const lakeVent = ventMod.buildGabledTunnelManifold(
              core, mf, lakeRuns, -0.15 / scaleMm, ventJambMm / scaleMm, ventGableMm / scaleMm, scaleMm
            );
            if (lakeVent && lakeVent.numTri() > 0) {
              const carved2 = out.subtract(lakeVent);
              core.safeDeleteManifold(lakeVent);
              if (carved2 && carved2.numTri() > 0) {
                if (out !== masterSolid) core.safeDeleteManifold(out);
                out = carved2;
              } else {
                core.safeDeleteManifold(carved2);
              }
            } else {
              core.safeDeleteManifold(lakeVent);
            }
          }
        }
      }
    }

    return out;
  }

  /**
   * Detects any floating cantilevered post-cut component touching an interior seam
   * (minZ > 0.05 mm) and corbels/buttresses its underside down at >= 45 deg on the master solid
   * before final cutting so no tower slice gets deleted or floats.
   * @param {object} core
   * @param {object} poly
   * @param {object} mf
   * @param {object} masterSolid
   * @param {Array<object>} tileBoxes
   * @param {Array<number>} cutXsU
   * @param {Array<number>} cutYsU
   * @param {number} scaleMm
   * @returns {object}
   */
  function _reinforceSeamCantileversOnMaster(core, poly, mf, masterSolid, tileBoxes, cutXsU, cutYsU, scaleMm) {
    if (!masterSolid || masterSolid.numTri() === 0 || (cutXsU.length === 0 && cutYsU.length === 0)) {
      return masterSolid;
    }
    const masterBB = masterSolid.boundingBox();
    const zMinTrial = masterBB.min[2] - 0.1;
    const zMaxTrial = masterBB.max[2] + 0.1;
    const groundThreshU = 0.05 / scaleMm;
    const seamTolU = 0.12 / scaleMm;
    const buttressParts = [];

    for (let ti = 0; ti < tileBoxes.length; ti++) {
      const tb = tileBoxes[ti];
      const clipBox = core.boxManifoldFromBounds(mf, tb.minX, tb.maxX, tb.minY, tb.maxY, zMinTrial, zMaxTrial);
      if (!clipBox) continue;
      let trialTile = null;
      let comps = null;
      try {
        trialTile = masterSolid.intersect(clipBox);
        if (!trialTile || trialTile.numTri() === 0) continue;
        comps = trialTile.decompose();
        if (!Array.isArray(comps)) continue;
        for (let ci = 0; ci < comps.length; ci++) {
          const c = comps[ci];
          const cbb = c.boundingBox();
          if (cbb.min[2] <= groundThreshU) continue;
          const touchesCutX = cutXsU.some(cx =>
            Math.abs(cbb.min[0] - cx) <= seamTolU || Math.abs(cbb.max[0] - cx) <= seamTolU
          );
          const touchesCutY = cutYsU.some(cy =>
            Math.abs(cbb.min[1] - cy) <= seamTolU || Math.abs(cbb.max[1] - cy) <= seamTolU
          );
          if (!touchesCutX && !touchesCutY) continue;

          // Sample underside of this cantilevered seam component and add grounded 45-deg corbelled pier
          const hAboveU = cbb.min[2];
          const probeZ = Math.min(cbb.max[2] - 0.02 / scaleMm, hAboveU + 0.12 / scaleMm);
          if (probeZ <= hAboveU) continue;
          let sl = null;
          let polys = [];
          try {
            sl = c.slice(probeZ);
            if (sl && !sl.isEmpty()) polys = sl.toPolygons();
          } catch (_) {
            polys = [];
          } finally {
            core.safeDeleteManifold(sl);
          }
          if (polys.length === 0) continue;

          // Keep a clean corbel pier inside the component footprint anchored to Z=0.
          // Recess 0.08 mm away from interior seam edges so VAL-09 cut-caps remain identical.
          // Ground tier k=0 NEVER vanishes: fallback to unshrunk base pillar if eroded ring is empty.
          const ccwRings = polys.filter(r => r && r.length >= 3 && poly.signedArea2D(r) > 1e-8);
          if (ccwRings.length === 0) continue;
          const seamRecessU = 0.08 / scaleMm;
          const isCutVal = (arr, v) => arr.some(c0 => Math.abs(c0 - v) <= seamTolU);
          const rMinX = tb.minX + (isCutVal(cutXsU, tb.minX) ? seamRecessU : 0);
          const rMaxX = tb.maxX - (isCutVal(cutXsU, tb.maxX) ? seamRecessU : 0);
          const rMinY = tb.minY + (isCutVal(cutYsU, tb.minY) ? seamRecessU : 0);
          const rMaxY = tb.maxY - (isCutVal(cutYsU, tb.maxY) ? seamRecessU : 0);
          let cs = null;
          let recessRect = null;
          let recessed = null;
          let shrunk = null;
          try {
            cs = mf.CrossSection.ofPolygons(ccwRings, 'Positive');
            if (rMaxX > rMinX + 1e-5 && rMaxY > rMinY + 1e-5) {
              recessRect = mf.CrossSection.ofPolygons(
                [[[rMinX, rMinY], [rMaxX, rMinY], [rMaxX, rMaxY], [rMinX, rMaxY]]],
                'Positive'
              );
              recessed = cs.intersect(recessRect);
            }
            const minPierAreaU2 = (0.18 / scaleMm) * (0.18 / scaleMm);
            const hasRecessedPier = recessed && !recessed.isEmpty() && recessed.area() >= minPierAreaU2;
            const zTopU = probeZ + 0.08 / scaleMm;

            if (hasRecessedPier) {
              shrunk = recessed.offset(-0.04 / scaleMm, 'Miter');
              const basePolys = (shrunk && !shrunk.isEmpty() && shrunk.area() >= minPierAreaU2)
                ? shrunk.toPolygons()
                : recessed.toPolygons();
              // Stepped >= 45 deg corbel tiers from Z = 0 up to probeZ + 0.08/scaleMm.
              // Guarantee ground tier k=0 always extrudes (fallback to unshrunk basePolys).
              const nTiers = Math.max(1, Math.min(4, Math.ceil((hAboveU * scaleMm) / 1.5)));
              for (let k = 0; k < nTiers; k++) {
                const frac = (k + 1) / nTiers;
                const z0 = k === 0 ? (-0.05 / scaleMm) : ((hAboveU * (k / nTiers)) - 0.03 / scaleMm);
                const z1 = (k === nTiers - 1) ? zTopU : ((hAboveU * frac) + 0.03 / scaleMm);
                const stepShrinkU = (1 - frac) * Math.min(0.65 / scaleMm, hAboveU * 0.45);
                let tierCs = mf.CrossSection.ofPolygons(basePolys, 'Positive');
                if (stepShrinkU > 1e-5) {
                  const er = tierCs.offset(-stepShrinkU, 'Miter');
                  if (er && !er.isEmpty() && (k > 0 || er.area() >= minPierAreaU2)) {
                    core.safeDeleteManifold(tierCs);
                    tierCs = er;
                  } else {
                    core.safeDeleteManifold(er);
                  }
                }
                if (tierCs && !tierCs.isEmpty()) {
                  const rawExt = tierCs.extrude(Math.max(0.05 / scaleMm, z1 - z0));
                  const shifted = rawExt ? rawExt.translate([0, 0, z0]) : null;
                  core.safeDeleteManifold(rawExt);
                  if (shifted && shifted.numTri() > 0) buttressParts.push(shifted);
                  else core.safeDeleteManifold(shifted);
                }
                core.safeDeleteManifold(tierCs);
              }
            } else {
              // Shallow < 0.26 mm cantilever protrusion past seam: add symmetric grounded corbel
              // straddling the seam on masterSolid before final cut so both tiles match 100% (VAL-09).
              const symCs = cs.offset(0.14 / scaleMm, 'Miter');
              const useSym = (symCs && !symCs.isEmpty()) ? symCs : cs;
              const rawExt = useSym.extrude(Math.max(0.05 / scaleMm, zTopU + 0.05 / scaleMm));
              const shifted = rawExt ? rawExt.translate([0, 0, -0.05 / scaleMm]) : null;
              core.safeDeleteManifold(rawExt);
              if (symCs && symCs !== cs) core.safeDeleteManifold(symCs);
              if (shifted && shifted.numTri() > 0) buttressParts.push(shifted);
              else core.safeDeleteManifold(shifted);
            }
          } catch (_) {
          } finally {
            core.safeDeleteManifold(shrunk);
            core.safeDeleteManifold(recessed);
            core.safeDeleteManifold(recessRect);
            core.safeDeleteManifold(cs);
          }
        }
      } finally {
        if (Array.isArray(comps)) for (const c of comps) core.safeDeleteManifold(c);
        core.safeDeleteManifold(trialTile);
        core.safeDeleteManifold(clipBox);
      }
    }

    if (buttressParts.length === 0) return masterSolid;
    const allB = core.batchUnionManifolds(mf, buttressParts);
    if (!allB || allB.numTri() === 0) {
      core.safeDeleteManifold(allB);
      return masterSolid;
    }
    const merged = masterSolid.add(allB);
    core.safeDeleteManifold(allB);
    if (merged && merged.numTri() > 0) {
      core.safeDeleteManifold(masterSolid);
      return merged;
    }
    core.safeDeleteManifold(merged);
    return masterSolid;
  }

  /**
   * Intersects 2D polygon rings with a 1D scanline along axis ('x' or 'y') and returns merged intervals.
   * @param {Array<Array<Array<number>>>} polys
   * @param {'x'|'y'} axis
   * @param {number} coordU
   * @returns {Array<[number, number]>}
   */
  function _scanPolysIntervals1D(polys, axis, coordU) {
    const aIdx = axis === 'x' ? 0 : 1;
    const uIdx = axis === 'x' ? 1 : 0;
    const hits = [];
    for (let pi = 0; pi < polys.length; pi++) {
      const ring = polys[pi];
      const n = ring ? ring.length : 0;
      if (n < 3) continue;
      for (let i = 0; i < n; i++) {
        const p0 = ring[i];
        const p1 = ring[(i + 1) % n];
        const c0 = p0[aIdx];
        const c1 = p1[aIdx];
        if ((c0 <= coordU && c1 > coordU) || (c1 <= coordU && c0 > coordU)) {
          const t = (coordU - c0) / (c1 - c0);
          hits.push(p0[uIdx] + t * (p1[uIdx] - p0[uIdx]));
        }
      }
    }
    if (hits.length < 2) return [];
    hits.sort((a, b) => a - b);
    const merged = [];
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const s = hits[i];
      const e = hits[i + 1];
      if (e - s <= 1e-6) continue;
      if (merged.length > 0 && s <= merged[merged.length - 1][1] + 1e-6) {
        if (e > merged[merged.length - 1][1]) merged[merged.length - 1][1] = e;
      } else {
        merged.push([s, e]);
      }
    }
    return merged;
  }

  /**
   * Subtracts sorted merged 1D intervals subIvs from baseIvs.
   * @param {Array<[number, number]>} baseIvs
   * @param {Array<[number, number]>} subIvs
   * @returns {Array<[number, number]>}
   */
  function _subtractIntervals1D(baseIvs, subIvs) {
    if (!baseIvs || baseIvs.length === 0) return [];
    if (!subIvs || subIvs.length === 0) return baseIvs.slice();
    const out = [];
    for (let i = 0; i < baseIvs.length; i++) {
      let cur = baseIvs[i][0];
      const be = baseIvs[i][1];
      for (let j = 0; j < subIvs.length; j++) {
        const ss = subIvs[j][0];
        const se = subIvs[j][1];
        if (se <= cur) continue;
        if (ss >= be) break;
        if (ss > cur) out.push([cur, Math.min(be, ss)]);
        cur = Math.max(cur, se);
        if (cur >= be) break;
      }
      if (cur < be - 1e-6) out.push([cur, be]);
    }
    return out;
  }

  /**
   * Merges sorted or unsorted 1D intervals.
   * @param {Array<[number, number]>} ivs
   * @returns {Array<[number, number]>}
   */
  function _mergeIntervals1D(ivs) {
    if (!ivs || ivs.length === 0) return [];
    const sorted = ivs.slice().sort((a, b) => a[0] - b[0]);
    const out = [[sorted[0][0], sorted[0][1]]];
    for (let i = 1; i < sorted.length; i++) {
      const s = sorted[i][0];
      const e = sorted[i][1];
      if (s <= out[out.length - 1][1] + 1e-6) {
        if (e > out[out.length - 1][1]) out[out.length - 1][1] = e;
      } else {
        out.push([s, e]);
      }
    }
    return out;
  }

  /**
   * Counts grounded < 0.40 mm facade slivers along a candidate seam plane across upper Z slices (DFM-01).
   * Mirrors validate_assembly.py _audit_seam_dfm01_slivers (strict_d + dilated_d + vertical persistence).
   * @param {Array<{zMm: number, polys: Array<Array<Array<number>>>}>} upperSlices
   * @param {'x'|'y'} axis
   * @param {number} coordU
   * @param {number} scaleMm
   * @returns {number}
   */
  function _countSeamSliversAtPlane(upperSlices, axis, coordU, scaleMm) {
    if (!upperSlices || upperSlices.length === 0) return { major: 0, minor: 0 };
    const nearOffU = 0.02 / scaleMm;
    const deepOffU = 0.40 / scaleMm;
    const strictPadU = 0.15 / scaleMm;
    const dilatePadU = 1.50 / scaleMm;
    const minStrictLenU = 2.50 / scaleMm;
    const minDilatedLenU = 2.50 / scaleMm;
    const minMinorLenU = 0.35 / scaleMm;
    const overlapTolU = 1.50 / scaleMm;
    let totalMajor = 0;
    let totalMinor = 0;

    for (const sign of [-1, 1]) {
      let prevRuns = [];
      let prevMinorRuns = [];
      for (let si = 0; si < upperSlices.length; si++) {
        const polys = upperSlices[si].polys;
        const ivN = _scanPolysIntervals1D(polys, axis, coordU + sign * nearOffU);
        if (ivN.length === 0) {
          prevRuns = [];
          prevMinorRuns = [];
          continue;
        }
        const ivD = _scanPolysIntervals1D(polys, axis, coordU + sign * deepOffU);
        const dilatedD = _mergeIntervals1D(ivD.map(([s, e]) => [s - dilatePadU, e + dilatePadU]));
        const strictD = _mergeIntervals1D(ivD.map(([s, e]) => [s - strictPadU, e + strictPadU]));

        const unbackedRaw = [];
        const minorRaw = [];
        const remDil = _subtractIntervals1D(ivN, dilatedD);
        for (let k = 0; k < remDil.length; k++) {
          if (remDil[k][1] - remDil[k][0] >= minDilatedLenU) unbackedRaw.push(remDil[k]);
        }
        for (let k = 0; k < ivN.length; k++) {
          const u0 = ivN[k][0];
          const u1 = ivN[k][1];
          const len = u1 - u0;
          if (len < minMinorLenU) continue;
          let backed = false;
          for (let j = 0; j < strictD.length; j++) {
            if (Math.min(u1, strictD[j][1]) - Math.max(u0, strictD[j][0]) > 0) {
              backed = true;
              break;
            }
          }
          if (!backed) {
            if (len >= minStrictLenU) unbackedRaw.push([u0, u1]);
            else minorRaw.push([u0, u1]);
          }
        }
        const unbacked = _mergeIntervals1D(unbackedRaw);
        const curRuns = [];
        for (let k = 0; k < unbacked.length; k++) {
          const u0 = unbacked[k][0];
          const u1 = unbacked[k][1];
          let bestLen = 1;
          for (let p = 0; p < prevRuns.length; p++) {
            if (Math.min(u1, prevRuns[p][1]) - Math.max(u0, prevRuns[p][0]) > overlapTolU && prevRuns[p][2] + 1 > bestLen) {
              bestLen = prevRuns[p][2] + 1;
            }
          }
          curRuns.push([u0, u1, bestLen]);
          if (bestLen >= 6) totalMajor++;
        }
        prevRuns = curRuns;

        const minorMerged = _mergeIntervals1D(minorRaw);
        const curMinorRuns = [];
        for (let k = 0; k < minorMerged.length; k++) {
          const u0 = minorMerged[k][0];
          const u1 = minorMerged[k][1];
          let bestLen = 1;
          for (let p = 0; p < prevMinorRuns.length; p++) {
            if (Math.min(u1, prevMinorRuns[p][1]) - Math.max(u0, prevMinorRuns[p][0]) > overlapTolU && prevMinorRuns[p][2] + 1 > bestLen) {
              bestLen = prevMinorRuns[p][2] + 1;
            }
          }
          curMinorRuns.push([u0, u1, bestLen]);
          if (bestLen >= 4) totalMinor++;
        }
        prevMinorRuns = curMinorRuns;
      }
    }
    return { major: totalMajor, minor: totalMinor };
  }

  /**
   * Checks bounded seam-nudge (+-0.5..5.0 mm within Mono 4 safe bed) when a nominal cut
   * slices off a narrow Z=0 peninsula crumb (VAL-12) or a < 0.40 mm facade sliver (DFM-01).
   * Inter-frame seams in multi-frame SKUs are locked so physical passe-partout openings remain exact.
   * @param {object} core
   * @param {object} poly
   * @param {object} mf
   * @param {object} masterSolid
   * @param {Array<number>} cutXsU
   * @param {Array<number>} cutYsU
   * @param {number} halfW
   * @param {number} halfH
   * @param {number} scaleMm
   * @param {object} state
   * @param {Set<number>|null} [lockedXIndices]
   * @param {Set<number>|null} [lockedYIndices]
   * @param {number} [baseBottomMm]
   * @returns {{cutXsU: Array<number>, cutYsU: Array<number>, nudgedSeams: Array<object>}}
   */
  function _resolveBoundedSeamNudges(core, poly, mf, masterSolid, cutXsU, cutYsU, halfW, halfH, scaleMm, state, lockedXIndices = null, lockedYIndices = null, baseBottomMm = 4.0, maxConnectivityZU = null) {
    const nudgedSeams = [];
    if (cutXsU.length === 0 && cutYsU.length === 0) {
      return { cutXsU: cutXsU.slice(), cutYsU: cutYsU.slice(), nudgedSeams };
    }
    let slice0 = null;
    let polys0 = [];
    try {
      slice0 = masterSolid.slice(0.15 / scaleMm);
      if (slice0 && !slice0.isEmpty()) polys0 = slice0.toPolygons();
    } catch (_) {
      polys0 = [];
    } finally {
      core.safeDeleteManifold(slice0);
    }
    if (polys0.length === 0) {
      return { cutXsU: cutXsU.slice(), cutYsU: cutYsU.slice(), nudgedSeams };
    }

    // Sample exact 0.25 mm Z slices matching validate_assembly.py _audit_seam_dfm01_slivers
    // so nudges never create < 0.40 mm DFM-01 facade slivers at any floor level.
    const masterBB = masterSolid.boundingBox();
    const maxZMm = masterBB.max[2] * scaleMm;
    const upperSlicePolys = [];
    const probeZMmList = [];
    const midCapZ = Math.min(maxZMm - 0.15, Math.max(baseBottomMm + 16.0, 20.0));
    for (let z = 1.65; z <= midCapZ; z += 0.25) {
      probeZMmList.push(Number(z.toFixed(2)));
    }
    for (let z = midCapZ + 0.50; z <= maxZMm - 0.15; z += 0.50) {
      probeZMmList.push(Number(z.toFixed(2)));
    }
    for (let pi = 0; pi < probeZMmList.length; pi++) {
      const zMm = probeZMmList[pi];
      if (zMm < 1.60 || zMm > maxZMm - 0.15) continue;
      let sUp = null;
      try {
        sUp = masterSolid.slice(zMm / scaleMm);
        if (sUp && !sUp.isEmpty()) {
          const pUp = sUp.toPolygons();
          if (pUp.length > 0) upperSlicePolys.push({ zMm, polys: pUp });
        }
      } catch (_) {
      } finally {
        core.safeDeleteManifold(sUp);
      }
    }

    const { cfgMod } = _getDeps();
    const sa = (cfgMod && typeof cfgMod.resolveMono4SafeArea === 'function')
      ? cfgMod.resolveMono4SafeArea(state)
      : { maxWMm: 145.45, maxHMm: 79.05 };
    const fitsSafe = (wMm, hMm) =>
      (wMm <= sa.maxWMm - 0.05 && hMm <= sa.maxHMm - 0.05) ||
      (hMm <= sa.maxWMm - 0.05 && wMm <= sa.maxHMm - 0.05);

    const outXs = cutXsU.slice();
    const outYs = cutYsU.slice();
    const zBotEvalU = Math.min(-0.10 / scaleMm, masterBB.min[2] - 0.10 / scaleMm);
    const zTopEvalU = (Number.isFinite(maxConnectivityZU) && maxConnectivityZU > 0)
      ? Math.min(masterBB.max[2] + 0.50 / scaleMm, maxConnectivityZU + 2.50 / scaleMm)
      : (masterBB.max[2] + 0.50 / scaleMm);
    const defChamferInMm = 0.25;
    const defChamferHMm = 0.50;
    const seamFloatTolU = 0.25 / Math.max(1e-6, scaleMm);
    const groundZMaxU = 0.05 / Math.max(1e-6, scaleMm);

    // Exact 3D tile-pair evaluation: accounts for 3D bridges connecting islands across canals
    // and ignores grounded water piers that are joined to the mainland above Z=0.15 mm.
    const evalAdjacentTiles3D = (srcSolid, xs, ys, axis, idx, candCoordU) => {
      const xsAll = [-halfW, ...xs, halfW];
      const ysAll = [-halfH, ...ys, halfH];
      const tileList = [];
      if (axis === 'y') {
        for (let tc = 0; tc < xsAll.length - 1; tc++) {
          tileList.push([xsAll[tc], xsAll[tc + 1], ysAll[idx], ysAll[idx + 1]]);
          tileList.push([xsAll[tc], xsAll[tc + 1], ysAll[idx + 1], ysAll[idx + 2]]);
        }
      } else {
        for (let tr = 0; tr < ysAll.length - 1; tr++) {
          tileList.push([xsAll[idx], xsAll[idx + 1], ysAll[tr], ysAll[tr + 1]]);
          tileList.push([xsAll[idx + 1], xsAll[idx + 2], ysAll[tr], ysAll[tr + 1]]);
        }
      }

      let fatalGrounded = 0;
      let softGrounded = 0;
      let seamFloating = 0;
      let minBadAreaMm2 = Infinity;

      for (let ti = 0; ti < tileList.length; ti++) {
        const [x0, x1, y0, y1] = tileList[ti];
        const box = buildChamferedTileClipBox(mf, x0, x1, y0, y1, zBotEvalU, zTopEvalU, scaleMm, defChamferInMm, defChamferHMm);
        if (!box) continue;
        let tile = null;
        let comps = [];
        try {
          tile = srcSolid.intersect(box);
          if (tile && tile.numTri() > 0 && typeof tile.decompose === 'function') {
            comps = tile.decompose();
          }
          const grounded = [];
          for (let ci = 0; ci < comps.length; ci++) {
            const c = comps[ci];
            if (!c || c.numTri() === 0) continue;
            const cbb = c.boundingBox();
            if (cbb.min[2] > groundZMaxU) {
              const nearSeam = axis === 'y'
                ? (Math.abs(cbb.min[1] - candCoordU) <= seamFloatTolU || Math.abs(cbb.max[1] - candCoordU) <= seamFloatTolU)
                : (Math.abs(cbb.min[0] - candCoordU) <= seamFloatTolU || Math.abs(cbb.max[0] - candCoordU) <= seamFloatTolU);
              if (nearSeam) seamFloating++;
              continue;
            }
            let z0AreaMm2 = 0;
            let s0 = null;
            try {
              s0 = c.slice(0.15 / scaleMm);
              if (s0 && !s0.isEmpty()) z0AreaMm2 = s0.area() * scaleMm * scaleMm;
            } catch (_) {
            } finally {
              core.safeDeleteManifold(s0);
            }
            const wMm = (cbb.max[0] - cbb.min[0]) * scaleMm;
            const hMm = (cbb.max[1] - cbb.min[1]) * scaleMm;
            grounded.push({ aMm2: z0AreaMm2, minDim: Math.min(wMm, hMm) });
          }
          grounded.sort((u, v) => v.aMm2 - u.aMm2);
          for (let rank = 0; rank < grounded.length; rank++) {
            const { aMm2, minDim } = grounded[rank];
            // Small < 180 mm2 per-tile peninsulas are shielded from underside relief grooves,
            // so only the ~6 mm2 DFM-06 bottom chamfer shrinkage applies to secondary landmasses.
            const isFatal = rank === 0
              ? (aMm2 < 40.0 || minDim < 4.25)
              : (aMm2 < 68.0 || minDim < 5.20);
            const isSoft = aMm2 < 78.0 || minDim < 5.4;
            if (isFatal) {
              fatalGrounded++;
              if (aMm2 < minBadAreaMm2) minBadAreaMm2 = aMm2;
            } else if (isSoft) {
              softGrounded++;
              if (aMm2 < minBadAreaMm2) minBadAreaMm2 = aMm2;
            }
          }
        } catch (_) {
        } finally {
          for (let ci = 0; ci < comps.length; ci++) core.safeDeleteManifold(comps[ci]);
          core.safeDeleteManifold(tile);
          core.safeDeleteManifold(box);
        }
      }
      return { fatalGrounded, softGrounded, seamFloating, minBadAreaMm2 };
    };

    const deltasMm = [
      0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 2.5, -2.5, 3, -3, 3.5, -3.5, 4, -4, 4.5, -4.5, 5, -5,
    ];
    const quarterDeltasMm = [
      0.25, -0.25, 0.75, -0.75, 1.25, -1.25, 1.75, -1.75, 2.25, -2.25, 2.75, -2.75,
      3.25, -3.25, 3.75, -3.75, 4.25, -4.25, 4.75, -4.75,
    ];
    const buildLocalFineDeltas = (rankedCands, triedSet) => {
      const out = [];
      const seen = new Set(triedSet);
      const seeds = rankedCands.slice(0, 3).map(r => r.dm);
      seeds.push(-4.75, 4.75);
      for (const s of seeds) {
        for (const off of [0.1, -0.1, 0.2, -0.2, 0.3, -0.3]) {
          const v = Number((s + off).toFixed(2));
          if (Math.abs(v) <= 5.0 && !seen.has(v)) {
            seen.add(v);
            out.push(v);
          }
        }
      }
      return out;
    };
    const scoreOf = (st, slv) =>
      (st.fatalGrounded * 100000) + (slv.major * 10000) + (st.softGrounded * 500) + (slv.minor * 50) + (st.seamFloating * 25);

    for (let yi = 0; yi < outYs.length; yi++) {
      if (lockedYIndices && lockedYIndices.has(yi)) continue;
      const origY = outYs[yi];
      const prevY = yi === 0 ? -halfH : outYs[yi - 1];
      const nextY = yi === outYs.length - 1 ? halfH : outYs[yi + 1];
      // Pre-clip masterSolid to the 2-row slab [prevY, nextY] and connectivity Z-band once (~8x faster on dense cities)
      let pairBox = null;
      let pairSolid = masterSolid;
      try {
        pairBox = core.boxManifoldFromBounds(mf, -halfW - 0.1 / scaleMm, halfW + 0.1 / scaleMm, prevY - 0.1 / scaleMm, nextY + 0.1 / scaleMm, zBotEvalU, zTopEvalU);
        const clippedPair = pairBox ? masterSolid.intersect(pairBox) : null;
        if (clippedPair && clippedPair.numTri() > 0) pairSolid = clippedPair;
        else core.safeDeleteManifold(clippedPair);
      } catch (_) {
        pairSolid = masterSolid;
      } finally {
        core.safeDeleteManifold(pairBox);
      }
      try {
        const seamBase = evalAdjacentTiles3D(pairSolid, outXs, outYs, 'y', yi, origY);
        const baseSlivers = _countSeamSliversAtPlane(upperSlicePolys, 'y', origY, scaleMm);
        const checkFloatNudge = Boolean(state && state.waterCutout);
        if (seamBase.fatalGrounded === 0 && seamBase.softGrounded === 0 && (!checkFloatNudge || seamBase.seamFloating === 0) && baseSlivers.major === 0) continue;
        const xsBounds = [-halfW, ...outXs, halfW];
        const colWidthsMm = [];
        for (let ci = 0; ci < xsBounds.length - 1; ci++) {
          colWidthsMm.push((xsBounds[ci + 1] - xsBounds[ci]) * scaleMm);
        }
        let bestY = origY;
        let bestScore = scoreOf(seamBase, baseSlivers);
        let bestMinArea = seamBase.minBadAreaMm2;
        let bestDelta = 0;
        const triedSet = new Set([0]);
        const rankedCands = [{ dm: 0, sc: bestScore }];
        const tryListY = (list, stopUnderScore) => {
          for (const dm of list) {
            triedSet.add(dm);
            const candY = origY + dm / scaleMm;
            const h0Mm = (candY - prevY) * scaleMm;
            const h1Mm = (nextY - candY) * scaleMm;
            if (!colWidthsMm.every(wMm => fitsSafe(wMm, h0Mm) && fitsSafe(wMm, h1Mm))) continue;
            const testYs = outYs.slice();
            testYs[yi] = candY;
            const candSlivers = _countSeamSliversAtPlane(upperSlicePolys, 'y', candY, scaleMm);
            if (candSlivers.major * 10000 > bestScore) continue;
            const st = evalAdjacentTiles3D(pairSolid, outXs, testYs, 'y', yi, candY);
            const sc = scoreOf(st, candSlivers);
            rankedCands.push({ dm, sc });
            if (sc < bestScore || (sc === bestScore && st.minBadAreaMm2 > bestMinArea + 2.0)) {
              bestScore = sc;
              bestMinArea = st.minBadAreaMm2;
              bestY = candY;
              bestDelta = dm;
              if (bestScore <= stopUnderScore) return;
            }
          }
        };
        tryListY(deltasMm, 0);
        if (bestScore >= 10000) tryListY(quarterDeltasMm, 9999);
        if (bestScore >= 100000) {
          rankedCands.sort((a, b) => a.sc - b.sc);
          tryListY(buildLocalFineDeltas(rankedCands, triedSet), 9999);
        }
        if (bestY !== origY) {
          outYs[yi] = bestY;
          nudgedSeams.push({ axis: 'y', index: yi, delta_mm: bestDelta });
        }
      } finally {
        if (pairSolid !== masterSolid) core.safeDeleteManifold(pairSolid);
      }
    }

    for (let xi = 0; xi < outXs.length; xi++) {
      if (lockedXIndices && lockedXIndices.has(xi)) continue;
      const origX = outXs[xi];
      const prevX = xi === 0 ? -halfW : outXs[xi - 1];
      const nextX = xi === outXs.length - 1 ? halfW : outXs[xi + 1];
      let pairBox = null;
      let pairSolid = masterSolid;
      try {
        pairBox = core.boxManifoldFromBounds(mf, prevX - 0.1 / scaleMm, nextX + 0.1 / scaleMm, -halfH - 0.1 / scaleMm, halfH + 0.1 / scaleMm, zBotEvalU, zTopEvalU);
        const clippedPair = pairBox ? masterSolid.intersect(pairBox) : null;
        if (clippedPair && clippedPair.numTri() > 0) pairSolid = clippedPair;
        else core.safeDeleteManifold(clippedPair);
      } catch (_) {
        pairSolid = masterSolid;
      } finally {
        core.safeDeleteManifold(pairBox);
      }
      try {
        const seamBase = evalAdjacentTiles3D(pairSolid, outXs, outYs, 'x', xi, origX);
        const baseSlivers = _countSeamSliversAtPlane(upperSlicePolys, 'x', origX, scaleMm);
        const checkFloatNudge = Boolean(state && state.waterCutout);
        if (seamBase.fatalGrounded === 0 && seamBase.softGrounded === 0 && (!checkFloatNudge || seamBase.seamFloating === 0) && baseSlivers.major === 0) continue;
        const ysBounds = [-halfH, ...outYs, halfH];
        const rowHeightsMm = [];
        for (let ri = 0; ri < ysBounds.length - 1; ri++) {
          rowHeightsMm.push((ysBounds[ri + 1] - ysBounds[ri]) * scaleMm);
        }
        let bestX = origX;
        let bestScore = scoreOf(seamBase, baseSlivers);
        let bestMinArea = seamBase.minBadAreaMm2;
        let bestDelta = 0;
        const triedSet = new Set([0]);
        const rankedCands = [{ dm: 0, sc: bestScore }];
        const tryListX = (list, stopUnderScore) => {
          for (const dm of list) {
            triedSet.add(dm);
            const candX = origX + dm / scaleMm;
            const w0Mm = (candX - prevX) * scaleMm;
            const w1Mm = (nextX - candX) * scaleMm;
            if (!rowHeightsMm.every(hMm => fitsSafe(w0Mm, hMm) && fitsSafe(w1Mm, hMm))) continue;
            const testXs = outXs.slice();
            testXs[xi] = candX;
            const candSlivers = _countSeamSliversAtPlane(upperSlicePolys, 'x', candX, scaleMm);
            if (candSlivers.major * 10000 > bestScore) continue;
            const st = evalAdjacentTiles3D(pairSolid, testXs, outYs, 'x', xi, candX);
            const sc = scoreOf(st, candSlivers);
            rankedCands.push({ dm, sc });
            if (sc < bestScore || (sc === bestScore && st.minBadAreaMm2 > bestMinArea + 2.0)) {
              bestScore = sc;
              bestMinArea = st.minBadAreaMm2;
              bestX = candX;
              bestDelta = dm;
              if (bestScore <= stopUnderScore) return;
            }
          }
        };
        tryListX(deltasMm, 0);
        if (bestScore >= 10000) tryListX(quarterDeltasMm, 9999);
        if (bestScore >= 100000) {
          rankedCands.sort((a, b) => a.sc - b.sc);
          tryListX(buildLocalFineDeltas(rankedCands, triedSet), 9999);
        }
        if (bestX !== origX) {
          outXs[xi] = bestX;
          nudgedSeams.push({ axis: 'x', index: xi, delta_mm: bestDelta });
        }
      } finally {
        if (pairSolid !== masterSolid) core.safeDeleteManifold(pairSolid);
      }
    }

    return { cutXsU: outXs, cutYsU: outYs, nudgedSeams };
  }

  /**
   * Builds and caches the uncut master solid for the frame, runs all global MSLA guards,
   * relief network, cantilever buttressing, and cuts all tiles with DFM-06 bottom chamfers.
   * @param {object} state
   * @param {number} tileIdFilter
   * @param {object|null} [deps]
   * @returns {Array<object>}
   */
  function buildMasterFrameUnifiedTilesForStl(state, tileIdFilter = -1, deps = null) {
    const { core, poly, cfgMod, ventMod, vaultMod, catalogMod } = _getDeps(deps && deps.vaultMod ? deps.vaultMod : null);
    const spec = cfgMod.resolveSceneScaleAndSpec(state, null);
    const { halfW, halfH } = spec;
    const scaleMm = spec.scaleMm || 1;
    const baseBottomMm = (cfgMod && typeof cfgMod.resolveBaseBottomMm === 'function')
      ? cfgMod.resolveBaseBottomMm(state, cfgMod.PRINT_PHYSICS_CONFIG)
      : 2.35;
    const tileCols = Math.max(1, Math.round(Number(state && state.tileCols) || 1));
    const tileRows = Math.max(1, Math.round(Number(state && state.tileRows) || 1));
    const isCutout = Boolean(state && state.waterCutout);
    const solidBaseNoTunnels = Boolean(state && state.solidBaseNoTunnels);
    const minReliefBaseMm = (cfgMod && cfgMod.PRINT_PHYSICS_CONFIG && Number(cfgMod.PRINT_PHYSICS_CONFIG.undersideReliefMinBaseMm) > 0)
      ? Number(cfgMod.PRINT_PHYSICS_CONFIG.undersideReliefMinBaseMm)
      : 2.60;
    const undersideReliefWanted = (cfgMod && typeof cfgMod.resolveUndersideReliefEnabled === 'function')
      ? cfgMod.resolveUndersideReliefEnabled(state, cfgMod.PRINT_PHYSICS_CONFIG, baseBottomMm)
      : (solidBaseNoTunnels && baseBottomMm > minReliefBaseMm);
    const meshesObj = (state && (state.layerMeshes || state.meshes)) || {};
    const vis = (state && state.layerVisible) || {};
    const fmtIdKey = String((state && (state.formatId || state.printerProfileId)) || '');
    const frameColsKey = Number((state && state.frameCols) || 0);
    const frameRowsKey = Number((state && state.frameRows) || 0);
    const safeMarginKey = Number((state && state.bedSafeMarginMm) ?? 4.0);
    const cacheKey = [
      tileCols, tileRows,
      fmtIdKey, frameColsKey, frameRowsKey, safeMarginKey.toFixed(2),
      Number(halfW).toFixed(4), Number(halfH).toFixed(4),
      Number(scaleMm).toFixed(6),
      isCutout ? 1 : 0,
      solidBaseNoTunnels ? 1 : 0,
      undersideReliefWanted ? 1 : 0,
      Number(baseBottomMm).toFixed(3),
      vis.water !== false ? 1 : 0,
      vis.base !== false ? 1 : 0,
      vis.greenery !== false ? 1 : 0,
      vis.trees !== false ? 1 : 0,
      vis.roads !== false ? 1 : 0,
      vis.buildings !== false ? 1 : 0,
      vis.highlighted !== false ? 1 : 0,
    ].join('|');

    let byKey = _frameCache.get(meshesObj);
    if (!byKey) {
      byKey = new Map();
      _frameCache.set(meshesObj, byKey);
    }
    let cached = byKey.get(cacheKey);
    if (!cached) {
      const mf = typeof core.getManifoldLib === 'function' ? core.getManifoldLib() : null;
      const keys = isCutout
        ? ['base', 'greenery', 'roads', 'buildings', 'highlighted']
        : ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted'];
      const allInputTris = [];
      for (const k of keys) {
        if (state && state.layerVisible) {
          if (k === 'greenery') {
            if (state.layerVisible.greenery === false && state.layerVisible.trees === false) continue;
          } else if (state.layerVisible[k] === false) {
            continue;
          }
        }
        const arr = meshesObj[k] || [];
        for (let i = 0; i < arr.length; i++) allInputTris.push(arr[i]);
      }

      if (!mf || allInputTris.length === 0) {
        return [];
      }

      const baseTris = allInputTris.filter(t => t.layerId === 1);
      const treeTris = allInputTris.filter(t => t.layerId === 2 && t.buildingId === -2);
      const overTris = allInputTris.filter(t => t.layerId !== 1 && !(t.layerId === 2 && t.buildingId === -2));
      const solids = core.trianglesToShellManifolds(mf, baseTris);
      for (const m of core.trianglesToShellManifolds(mf, overTris)) {
        const bb = m.boundingBox();
        if (bb.min[2] > 0.02) {
          const s = m.translate([0, 0, -Math.min(0.002, bb.min[2] * 0.1)]);
          core.safeDeleteManifold(m);
          solids.push(s);
        } else {
          solids.push(m);
        }
      }
      if (solids.length === 0 && treeTris.length === 0) return [];

      let masterSolid = solids.length === 0
        ? null
        : (solids.length === 1 ? solids[0] : core.batchUnionManifolds(mf, solids));
      if ((!masterSolid || masterSolid.numTri() === 0) && treeTris.length === 0) {
        core.safeDeleteManifold(masterSolid);
        return [];
      }

      const nominalCutXsU = [];
      const colSpan = (2 * halfW) / tileCols;
      for (let tc = 1; tc < tileCols; tc++) nominalCutXsU.push(-halfW + tc * colSpan);
      const nominalCutYsU = [];
      const rowSpan = (2 * halfH) / tileRows;
      for (let tr = 1; tr < tileRows; tr++) nominalCutYsU.push(-halfH + tr * rowSpan);

      const uBB = masterSolid ? masterSolid.boundingBox() : { min: [0, 0, 1], max: [0, 0, 1] };
      const spanXMm = (uBB.max[0] - uBB.min[0]) * scaleMm;
      const spanYMm = (uBB.max[1] - uBB.min[1]) * scaleMm;
      const isFullSceneBase = Boolean(masterSolid) && uBB.min[2] <= 0.05 / scaleMm &&
        Math.max(spanXMm, spanYMm) >= 25.0 &&
        Math.min(spanXMm, spanYMm) >= 6.0;

      const catalogDefaults = (catalogMod && catalogMod.FORMAT_CATALOG && catalogMod.FORMAT_CATALOG.defaults)
        ? catalogMod.FORMAT_CATALOG.defaults
        : {};

      let activeCutXsU = nominalCutXsU.slice();
      let activeCutYsU = nominalCutYsU.slice();
      let nudgedSeams = [];
      let undersideReliefApplied = false;

      if (isFullSceneBase) {
        // 1. Plug small inland holes BEFORE cutting (no per-tile seam false-positives)
        if (isCutout === true && vaultMod && typeof vaultMod._plugInlandThroughHoles === 'function') {
          const masterBox = { minX: -halfW, maxX: halfW, minY: -halfH, maxY: halfH };
          const fakeTw = { terrainManifold: null };
          const plugRes = vaultMod._plugInlandThroughHoles(
            core, poly, mf, masterSolid, fakeTw, masterBox, scaleMm, baseBottomMm / scaleMm, baseBottomMm
          );
          if (plugRes && plugRes.outTile) masterSolid = plugRes.outTile;
        }

        // 2. Plug post-union small pockets (< 18 mm2) once on the uncut master solid
        if (isCutout === true && vaultMod && typeof vaultMod._plugPostUnionBasePockets === 'function') {
          masterSolid = vaultMod._plugPostUnionBasePockets(
            core, poly, mf, masterSolid, masterSolid.boundingBox(), scaleMm, baseBottomMm
          );
        }

        // 3. Resolve bounded seam-nudges (+-0.5..5.0 mm) before unioning trees & carving relief.
        // Lock inter-frame boundaries in multi-frame SKUs so physical passe-partout windows stay exact.
        if (activeCutXsU.length > 0 || activeCutYsU.length > 0) {
          const layoutForLock = (catalogMod && typeof catalogMod.computeFormatFrameAndTileLayout === 'function')
            ? catalogMod.computeFormatFrameAndTileLayout(state)
            : null;
          const fSpec = layoutForLock && layoutForLock.format ? layoutForLock.format : null;
          const fCols = Math.max(1, Number((state && state.frameCols) || (fSpec && fSpec.frame_cols) || 1));
          const fRows = Math.max(1, Number((state && state.frameRows) || (fSpec && fSpec.frame_rows) || 1));
          const lockedX = new Set();
          const lockedY = new Set();
          if (fCols > 1 && tileCols % fCols === 0) {
            const tpfC = tileCols / fCols;
            for (let xi = 0; xi < activeCutXsU.length; xi++) {
              if ((xi + 1) % tpfC === 0) lockedX.add(xi);
            }
          }
          if (fRows > 1 && tileRows % fRows === 0) {
            const tpfR = tileRows / fRows;
            for (let yi = 0; yi < activeCutYsU.length; yi++) {
              if ((yi + 1) % tpfR === 0) lockedY.add(yi);
            }
          }
          let maxConnZU = baseBottomMm / scaleMm;
          for (let ti = 0; ti < allInputTris.length; ti++) {
            const tr = allInputTris[ti];
            if (tr.layerId !== 1 && tr.layerId !== 3) continue;
            if (tr.v0[2] > maxConnZU) maxConnZU = tr.v0[2];
            if (tr.v1[2] > maxConnZU) maxConnZU = tr.v1[2];
            if (tr.v2[2] > maxConnZU) maxConnZU = tr.v2[2];
          }
          const nudgeRes = _resolveBoundedSeamNudges(
            core, poly, mf, masterSolid, activeCutXsU, activeCutYsU, halfW, halfH, scaleMm, state, lockedX, lockedY, baseBottomMm, maxConnZU
          );
          activeCutXsU = nudgeRes.cutXsU;
          activeCutYsU = nudgeRes.cutYsU;
          nudgedSeams = nudgeRes.nudgedSeams;
        }
      }

      // 3b. Union trees AFTER seam nudging, pruning any tree crown overlapping a nudged seam plane.
      if (treeTris.length > 0) {
        const treeClearPadU = 0.16 / scaleMm;
        const nudgedXs = nudgedSeams.filter(ns => ns.axis === 'x').map(ns => activeCutXsU[ns.index]);
        const nudgedYs = nudgedSeams.filter(ns => ns.axis === 'y').map(ns => activeCutYsU[ns.index]);
        const keptTrees = [];
        for (const tm of core.trianglesToShellManifolds(mf, treeTris)) {
          const tbb = tm.boundingBox();
          let hitsNudgedSeam = false;
          for (let i = 0; i < nudgedXs.length; i++) {
            if (tbb.min[0] <= nudgedXs[i] + treeClearPadU && tbb.max[0] >= nudgedXs[i] - treeClearPadU) {
              hitsNudgedSeam = true;
              break;
            }
          }
          if (!hitsNudgedSeam) {
            for (let i = 0; i < nudgedYs.length; i++) {
              if (tbb.min[1] <= nudgedYs[i] + treeClearPadU && tbb.max[1] >= nudgedYs[i] - treeClearPadU) {
                hitsNudgedSeam = true;
                break;
              }
            }
          }
          if (hitsNudgedSeam) {
            core.safeDeleteManifold(tm);
            continue;
          }
          if (tbb.min[2] > 0.02) {
            const s = tm.translate([0, 0, -Math.min(0.002, tbb.min[2] * 0.1)]);
            core.safeDeleteManifold(tm);
            keptTrees.push(s);
          } else {
            keptTrees.push(tm);
          }
        }
        if (keptTrees.length > 0) {
          const allT = keptTrees.length === 1 ? keptTrees[0] : core.batchUnionManifolds(mf, keptTrees);
          if (allT && allT.numTri() > 0) {
            if (!masterSolid) {
              masterSolid = allT;
            } else {
              const mergedT = masterSolid.add(allT);
              core.safeDeleteManifold(allT);
              if (mergedT && mergedT.numTri() > 0) {
                core.safeDeleteManifold(masterSolid);
                masterSolid = mergedT;
              } else {
                core.safeDeleteManifold(mergedT);
              }
            }
          } else {
            core.safeDeleteManifold(allT);
          }
        }
      }
      if (!masterSolid || masterSolid.numTri() === 0) {
        core.safeDeleteManifold(masterSolid);
        return [];
      }

      if (isFullSceneBase) {
        // 4. Carve continuous seam-aligned 45 deg gabled underside stress-relief & venting network
        let z0AreaMm2 = 0;
        let hasInlandLake = false;
        let s0Probe = null;
        try {
          s0Probe = masterSolid.slice(0.20 / scaleMm);
          if (s0Probe && !s0Probe.isEmpty()) {
            z0AreaMm2 = s0Probe.area() * scaleMm * scaleMm;
            for (const r of s0Probe.toPolygons()) {
              if (!r || r.length < 3) continue;
              const sa = poly.signedArea2D(r);
              if (sa < 0 && Math.abs(sa) * scaleMm * scaleMm >= 18.0) {
                hasInlandLake = true;
                break;
              }
            }
          }
        } catch (_) {
        } finally {
          core.safeDeleteManifold(s0Probe);
        }

        if (undersideReliefWanted && (z0AreaMm2 > 3500.0 || hasInlandLake || tileCols > 1 || tileRows > 1)) {
          const totalWMm = 2 * halfW * scaleMm;
          const totalHMm = 2 * halfH * scaleMm;
          if (totalWMm >= 36.0 && totalHMm >= 36.0) undersideReliefApplied = true;
          masterSolid = _carveUndersideStressReliefNetwork(
            core, poly, mf, ventMod, vaultMod, masterSolid, scaleMm, halfW, halfH,
            activeCutXsU, activeCutYsU, baseBottomMm, catalogDefaults
          );
        } else if (isCutout === true && hasInlandLake && ventMod && typeof ventMod.ventLargeBasePocketsUnderside === 'function' && vaultMod && vaultMod._rasterizePolysToGrid) {
          const masterSeams = (activeCutXsU.length > 0 || activeCutYsU.length > 0)
            ? {
                south: false,
                north: false,
                west: false,
                east: false,
                cutXsU: activeCutXsU,
                cutYsU: activeCutYsU,
              }
            : null;
          masterSolid = ventMod.ventLargeBasePocketsUnderside(
            core, poly, mf, masterSolid, masterSolid.boundingBox(), scaleMm, baseBottomMm, masterSeams, vaultMod._rasterizePolysToGrid
          );
        }

        // 5. Global overhang grounding before upper courtyard venting so piers never re-seal vents, then sliver cleanup
        if (vaultMod && typeof vaultMod._groundFlatOverhangPiers === 'function') {
          masterSolid = vaultMod._groundFlatOverhangPiers(
            core, poly, mf, masterSolid, masterSolid.boundingBox(), scaleMm, baseBottomMm
          );
        }
        if (vaultMod && typeof vaultMod._ventUpperSealedCourtyards === 'function') {
          masterSolid = vaultMod._ventUpperSealedCourtyards(
            core, poly, mf, masterSolid, scaleMm, baseBottomMm, ventMod
          );
        }
        if (vaultMod && typeof vaultMod._cleanupDetachedBorderSlivers === 'function') {
          masterSolid = vaultMod._cleanupDetachedBorderSlivers(
            core, mf, masterSolid, scaleMm, { cutXsU: activeCutXsU, cutYsU: activeCutYsU }
          );
        }
      }

      // Build final tile boundaries (using active nudged cut planes if any)
      const xsAll = [-halfW, ...activeCutXsU, halfW];
      const ysAll = [-halfH, ...activeCutYsU, halfH];
      const layout = catalogMod && typeof catalogMod.computeFormatFrameAndTileLayout === 'function'
        ? catalogMod.computeFormatFrameAndTileLayout(state)
        : null;

      const tileBoxes = [];
      for (let tr = 0; tr < tileRows; tr++) {
        for (let tc = 0; tc < tileCols; tc++) {
          const tid = tr * tileCols + tc;
          const tMeta = layout && layout.tileMetaById ? layout.tileMetaById[tid] : null;
          tileBoxes.push({
            tileId: tid,
            tr,
            tc,
            frameId: tMeta ? tMeta.frame_id : 'F1',
            stlRotationDeg: tMeta ? tMeta.stl_rotation_deg : 0,
            minX: xsAll[tc],
            maxX: xsAll[tc + 1],
            minY: ysAll[tr],
            maxY: ysAll[tr + 1],
          });
        }
      }

      // 6. Reinforce cantilevered seam-crossing buildings/structures BEFORE final cut
      if (isFullSceneBase && (activeCutXsU.length > 0 || activeCutYsU.length > 0)) {
        masterSolid = _reinforceSeamCantileversOnMaster(
          core, poly, mf, masterSolid, tileBoxes, activeCutXsU, activeCutYsU, scaleMm
        );
      }

      // Measure master volume BEFORE slicing for VAL-11 conservation audit
      const masterVolMm3 = Math.max(0, masterSolid.volume()) * (scaleMm ** 3);
      const cutXsMm = activeCutXsU.map(x => x * scaleMm);
      const cutYsMm = activeCutYsU.map(y => y * scaleMm);
      const finalBB = masterSolid.boundingBox();
      const zBotClipU = Math.min(-0.10 / scaleMm, finalBB.min[2] - 0.10 / scaleMm);
      const zTopClipU = finalBB.max[2] + 0.50 / scaleMm;

      // 7. Cut every tile cleanly with DFM-06 bottom chamfer and seam-locked vertex extraction
      const tilesById = new Map();
      const tileBoundsMmById = new Map();
      const allowLandmassesById = new Map();
      const safeArea = (cfgMod && typeof cfgMod.resolveMono4SafeArea === 'function')
        ? cfgMod.resolveMono4SafeArea(state)
        : { maxWMm: 145.45, maxHMm: 79.05 };
      const stlTrisOptionsBase = { interiorSeams: { cutXsMm, cutYsMm } };
      const useChamfer = isFullSceneBase && (tileCols > 1 || tileRows > 1 || solidBaseNoTunnels);
      const defChamferInset = Number(catalogDefaults.dfm06_chamfer_inset_mm) > 0 ? Number(catalogDefaults.dfm06_chamfer_inset_mm) : 0.25;
      const defChamferHeight = Number(catalogDefaults.dfm06_chamfer_height_mm) > 0 ? Number(catalogDefaults.dfm06_chamfer_height_mm) : 0.50;
      const chamferInsetMm = useChamfer ? defChamferInset : 0.0;
      const chamferHeightMm = useChamfer ? defChamferHeight : 0.0;

      for (let ti = 0; ti < tileBoxes.length; ti++) {
        const tb = tileBoxes[ti];
        const clipBox = buildChamferedTileClipBox(
          mf, tb.minX, tb.maxX, tb.minY, tb.maxY,
          zBotClipU, zTopClipU, scaleMm, chamferInsetMm, chamferHeightMm
        );
        if (!clipBox) {
          tilesById.set(tb.tileId, []);
          continue;
        }
        let tileSolid = null;
        try {
          tileSolid = masterSolid.intersect(clipBox);
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          throw new Error(
            `[tile_seam_cutter] Tile ${tb.tileId} (R${tileRows - tb.tr}C${tb.tc + 1}) ` +
            `clip failed bounds=[${(tb.minX * scaleMm).toFixed(2)}..${(tb.maxX * scaleMm).toFixed(2)}, ` +
            `${(tb.minY * scaleMm).toFixed(2)}..${(tb.maxY * scaleMm).toFixed(2)}]: ${msg}`
          );
        } finally {
          core.safeDeleteManifold(clipBox);
        }

        const boundsMm = {
          minX: tb.minX * scaleMm,
          maxX: tb.maxX * scaleMm,
          minY: tb.minY * scaleMm,
          maxY: tb.maxY * scaleMm,
        };
        tileBoundsMmById.set(tb.tileId, boundsMm);

        if (!tileSolid || tileSolid.numTri() === 0) {
          core.safeDeleteManifold(tileSolid);
          tilesById.set(tb.tileId, []);
          continue;
        }

        const allowLm = [];
        if (isCutout === true && typeof tileSolid.decompose === 'function') {
          let comps = null;
          try { comps = tileSolid.decompose(); } catch (_) { comps = null; }
          if (Array.isArray(comps) && comps.length > 1) {
            const tileW = boundsMm.maxX - boundsMm.minX;
            const tileH = boundsMm.maxY - boundsMm.minY;
            const fitsN = tileW <= safeArea.maxWMm + 1e-6 && tileH <= safeArea.maxHMm + 1e-6;
            const fitsR = tileH <= safeArea.maxWMm + 1e-6 && tileW <= safeArea.maxHMm + 1e-6;
            const rot90 = !fitsN && fitsR;
            const lmCands = [];
            for (const c of comps) {
              if (!c || c.numTri() === 0) continue;
              const cbb = c.boundingBox();
              const minZMm = cbb.min[2] * scaleMm;
              const wMm = (cbb.max[0] - cbb.min[0]) * scaleMm;
              const hMm = (cbb.max[1] - cbb.min[1]) * scaleMm;
              let z0AreaMm2 = 0;
              let sl = null;
              try {
                sl = c.slice(0.15 / scaleMm);
                if (sl && !sl.isEmpty()) z0AreaMm2 = sl.area() * scaleMm * scaleMm;
              } catch (_) {
              } finally {
                core.safeDeleteManifold(sl);
              }
              if (minZMm <= 0.04 && z0AreaMm2 >= 60.0 && Math.min(wMm, hMm) >= 5.0) {
                const lx0 = cbb.min[0] * scaleMm - boundsMm.minX;
                const lx1 = cbb.max[0] * scaleMm - boundsMm.minX;
                const ly0 = cbb.min[1] * scaleMm - boundsMm.minY;
                const ly1 = cbb.max[1] * scaleMm - boundsMm.minY;
                const bx0 = rot90 ? (tileH - ly1) : lx0;
                const bx1 = rot90 ? (tileH - ly0) : lx1;
                const by0 = rot90 ? lx0 : ly0;
                const by1 = rot90 ? lx1 : ly1;
                lmCands.push({
                  bbox_xy: [Number(bx0.toFixed(2)), Number(bx1.toFixed(2)), Number(by0.toFixed(2)), Number(by1.toFixed(2))],
                  z0_area_mm2: Number(z0AreaMm2.toFixed(2)),
                  min_width_mm: Number(Math.min(wMm, hMm).toFixed(2)),
                  reason: 'water_cutout_split_landmass',
                });
              }
            }
            if (lmCands.length > 1) {
              lmCands.sort((a, b) => b.z0_area_mm2 - a.z0_area_mm2);
              for (let li = 1; li < lmCands.length; li++) allowLm.push(lmCands[li]);
            }
          }
          if (Array.isArray(comps)) for (const c of comps) core.safeDeleteManifold(c);
        }
        allowLandmassesById.set(tb.tileId, allowLm);

        const tris = core.extractDePinchedStlTriangles(
          mf, tileSolid, tb.tileId, scaleMm, { ...stlTrisOptionsBase, tileBoundsMm: boundsMm }
        );
        core.safeDeleteManifold(tileSolid);
        tilesById.set(tb.tileId, tris);
      }

      core.safeDeleteManifold(masterSolid);

      cached = {
        cacheKey,
        masterVolumeMm3: Number(masterVolMm3.toFixed(4)),
        cutXsMm,
        cutYsMm,
        nudgedSeams,
        undersideReliefApplied,
        chamferInsetMm,
        chamferHeightMm,
        tileBoxes,
        tileBoundsMmById,
        allowLandmassesById,
        tilesById,
        layout,
      };
      byKey.set(cacheKey, cached);
    }

    if (tileIdFilter >= 0) {
      return cached.tilesById.get(tileIdFilter) || [];
    }
    const merged = [];
    for (const tb of cached.tileBoxes) {
      const tArr = cached.tilesById.get(tb.tileId) || [];
      for (let i = 0; i < tArr.length; i++) merged.push(tArr[i]);
    }
    return merged;
  }

  const exportsObj = {
    buildChamferedTileClipBox,
    buildMasterFrameUnifiedTilesForStl,
    getCachedMasterFrameEntry,
  };

  if (root) Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
