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
   * @returns {Array<number>}
   */
  function _computeGrooveCoords1D(lo, hi, pitch, avoidPlanes, minCutGap) {
    const span = hi - lo;
    if (span < 4.0) return [];
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
   * on the uncut master solid (Z = 0..1.50 mm, width 2.6 mm, pitch ~9.0 mm) with an
   * unbroken >= 8.0 mm solid perimeter skirt along all 4 outer passe-partout walls.
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
   * @returns {object}
   */
  function _carveUndersideStressReliefNetwork(core, poly, mf, ventMod, vaultMod, masterSolid, scaleMm, halfW, halfH, cutXsU, cutYsU, baseBottomMm) {
    if (!masterSolid || masterSolid.numTri() === 0 || !ventMod) return masterSolid;
    const totalWMm = 2 * halfW * scaleMm;
    const totalHMm = 2 * halfH * scaleMm;
    if (totalWMm < 36.0 || totalHMm < 36.0) return masterSolid;

    const skirtMm = 8.0;
    const grooveWidthMm = 2.6;
    const pitchMm = 8.8;
    const reliefHeightMm = Math.min(1.50, Math.max(0.85, baseBottomMm - 1.20));
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
    // and skip < 250 mm2 small islands so stress-relief channels never split islands into crumbs.
    try {
      const safeShell = mf.CrossSection.ofPolygons(basePolys, 'Positive');
      const er = safeShell.offset(-2.00 / scaleMm, 'Miter');
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
    const xLinesU = _computeGrooveCoords1D(ax0, ax1, pitchMm / scaleMm, cutXsU, minCutGapU);
    const yLinesU = _computeGrooveCoords1D(ay0, ay1, pitchMm / scaleMm, cutYsU, minCutGapU);

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

    const addClippedRunsAlongX = (yVal) => {
      let curStart = null;
      const nSteps = Math.max(2, Math.ceil((ax1 - ax0) / stepCheckU));
      const ds = (ax1 - ax0) / nSteps;
      for (let i = 0; i <= nSteps; i++) {
        const xVal = ax0 + i * ds;
        const ok = isInsideSafe(xVal, yVal);
        if (ok && curStart === null) curStart = xVal;
        if ((!ok || i === nSteps) && curStart !== null) {
          const endX = ok ? xVal : (ax0 + (i - 1) * ds);
          if (endX - curStart >= 4.0 / scaleMm) {
            runs.push({ pts: [[curStart, yVal], [endX, yVal]], halfW: halfWGrooveU });
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
          const endY = ok ? yVal : (ay0 + (i - 1) * ds);
          if (endY - curStart >= 4.0 / scaleMm) {
            runs.push({ pts: [[xVal, curStart], [xVal, endY]], halfW: halfWGrooveU });
          }
          curStart = null;
        }
      }
    };

    for (let i = 0; i < xLinesU.length; i++) addClippedRunsAlongY(xLinesU[i]);
    for (let i = 0; i < yLinesU.length; i++) addClippedRunsAlongX(yLinesU[i]);

    let out = masterSolid;
    if (runs.length > 0) {
      const tunnelCut = ventMod.buildGabledTunnelManifold(
        core, mf, runs, -0.15 / scaleMm, jambTopMm / scaleMm, gableRiseMm / scaleMm, scaleMm
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

    // Vent any enclosed inland lakes (>= 18 mm2) into the relief network / interior seams
    // WITHOUT cutting notches through the outer >= 8.0 mm passe-partout frame walls when multi-tile.
    const hasInteriorSeams = (cutXsU.length > 0 || cutYsU.length > 0);
    if (typeof ventMod.ventLargeBasePocketsUnderside === 'function' && vaultMod && vaultMod._rasterizePolysToGrid) {
      const seamFlags = hasInteriorSeams
        ? {
            south: false,
            north: false,
            west: false,
            east: false,
            cutXsU,
            cutYsU,
            keepOuterSkirtIntact: true,
          }
        : null;
      // Check CW holes >= 18 mm2 at Z = 0.25..1.15 mm on out; vent any remaining trapped pocket
      // directly into open relief channels or interior seam crossings.
      let probeAfter = null;
      let polysAfter = [];
      try {
        probeAfter = out.slice(0.55 / scaleMm);
        if (probeAfter && !probeAfter.isEmpty()) polysAfter = probeAfter.toPolygons();
      } catch (_) {
        polysAfter = [];
      } finally {
        core.safeDeleteManifold(probeAfter);
      }
      if (polysAfter.length > 0) {
        const outBB = out.boundingBox();
        const spanXMm = (outBB.max[0] - outBB.min[0]) * scaleMm;
        const spanYMm = (outBB.max[1] - outBB.min[1]) * scaleMm;
        const stepMm = Math.max(0.60, Math.max(spanXMm, spanYMm) / 240);
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

        // Group remaining enclosed air pockets (not reached by relief grid or outer water)
        const pocketLabel = new Int32Array(total);
        const pockets = [];
        const minCells = Math.max(4, Math.ceil(16.0 / (stepMm * stepMm)));
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
              core, mf, lakeRuns, -0.15 / scaleMm, jambTopMm / scaleMm, gableRiseMm / scaleMm, scaleMm
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
        void seamFlags;
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

          // Keep a clean corbel pier inside the component footprint anchored to Z=0
          const ccwRings = polys.filter(r => r && r.length >= 3 && poly.signedArea2D(r) > 1e-8);
          if (ccwRings.length === 0) continue;
          let cs = null;
          let shrunk = null;
          try {
            cs = mf.CrossSection.ofPolygons(ccwRings, 'Positive');
            shrunk = cs.offset(-0.08 / scaleMm, 'Miter');
            const usePolys = (shrunk && !shrunk.isEmpty()) ? shrunk.toPolygons() : ccwRings;
            // Stepped >= 45 deg corbel tiers from Z = 0 up to probeZ + 0.08/scaleMm
            const zTopU = probeZ + 0.08 / scaleMm;
            const nTiers = Math.max(1, Math.min(4, Math.ceil((hAboveU * scaleMm) / 1.5)));
            for (let k = 0; k < nTiers; k++) {
              const frac = (k + 1) / nTiers;
              const z0 = k === 0 ? (-0.05 / scaleMm) : ((hAboveU * (k / nTiers)) - 0.03 / scaleMm);
              const z1 = (k === nTiers - 1) ? zTopU : ((hAboveU * frac) + 0.03 / scaleMm);
              const stepShrinkU = (1 - frac) * Math.min(0.65 / scaleMm, hAboveU * 0.45);
              let tierCs = mf.CrossSection.ofPolygons(usePolys, 'Positive');
              if (stepShrinkU > 1e-5) {
                const er = tierCs.offset(-stepShrinkU, 'Miter');
                core.safeDeleteManifold(tierCs);
                tierCs = er;
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
          } catch (_) {
          } finally {
            core.safeDeleteManifold(shrunk);
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
   * Checks bounded seam-nudge (+-2..5 mm within Mono 4 safe bed) when a nominal cut
   * slices off a < 35 mm2 or < 4.0 mm narrow Z=0 peninsula crumb.
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
   * @returns {{cutXsU: Array<number>, cutYsU: Array<number>, nudgedSeams: Array<object>}}
   */
  function _resolveBoundedSeamNudges(core, poly, mf, masterSolid, cutXsU, cutYsU, halfW, halfH, scaleMm, state, lockedXIndices = null, lockedYIndices = null) {
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

    const { cfgMod } = _getDeps();
    const sa = (cfgMod && typeof cfgMod.resolveMono4SafeArea === 'function')
      ? cfgMod.resolveMono4SafeArea(state)
      : { maxWMm: 145.45, maxHMm: 79.05 };
    const fitsSafe = (wMm, hMm) =>
      (wMm <= sa.maxWMm - 0.05 && hMm <= sa.maxHMm - 0.05) ||
      (hMm <= sa.maxWMm - 0.05 && wMm <= sa.maxHMm - 0.05);

    const outXs = cutXsU.slice();
    const outYs = cutYsU.slice();
    const crossSectionZ0 = mf.CrossSection.ofPolygons(polys0, 'Positive');

    const countSmallCrumbsForAxis = (xs, ys, focusAxis = null, focusCoordU = null) => {
      const xsAll = [-halfW, ...xs, halfW];
      const ysAll = [-halfH, ...ys, halfH];
      const nearTolU = 1.5 / Math.max(1e-6, scaleMm);
      let badCount = 0;
      let badMinArea = Infinity;
      let nearBadCount = 0;
      let nearBadMinArea = Infinity;
      for (let tr = 0; tr < ysAll.length - 1; tr++) {
        for (let tc = 0; tc < xsAll.length - 1; tc++) {
          const rx0 = xsAll[tc], rx1 = xsAll[tc + 1];
          const ry0 = ysAll[tr], ry1 = ysAll[tr + 1];
          const rect = mf.CrossSection.ofPolygons([[[rx0, ry0], [rx1, ry0], [rx1, ry1], [rx0, ry1]]], 'Positive');
          let tile2d = null;
          let decomp = [];
          try {
            tile2d = crossSectionZ0.intersect(rect);
            if (tile2d && !tile2d.isEmpty()) decomp = tile2d.decompose();
            for (let k = 0; k < decomp.length; k++) {
              const dp = decomp[k];
              const aMm2 = dp.area() * scaleMm * scaleMm;
              const b = dp.bounds();
              const wMm = (b.max[0] - b.min[0]) * scaleMm;
              const hMm = (b.max[1] - b.min[1]) * scaleMm;
              if (aMm2 < 78.0 || Math.min(wMm, hMm) < 5.5) {
                badCount++;
                if (aMm2 < badMinArea) badMinArea = aMm2;
                if (focusAxis === 'y' && focusCoordU !== null) {
                  if (b.min[1] <= focusCoordU + nearTolU && b.max[1] >= focusCoordU - nearTolU) {
                    nearBadCount++;
                    if (aMm2 < nearBadMinArea) nearBadMinArea = aMm2;
                  }
                } else if (focusAxis === 'x' && focusCoordU !== null) {
                  if (b.min[0] <= focusCoordU + nearTolU && b.max[0] >= focusCoordU - nearTolU) {
                    nearBadCount++;
                    if (aMm2 < nearBadMinArea) nearBadMinArea = aMm2;
                  }
                }
              }
            }
          } finally {
            for (const dp of decomp) core.safeDeleteManifold(dp);
            core.safeDeleteManifold(tile2d);
            core.safeDeleteManifold(rect);
          }
        }
      }
      return { badCount, badMinArea, nearBadCount, nearBadMinArea };
    };

    try {
      let curStats = countSmallCrumbsForAxis(outXs, outYs);
      if (curStats.badCount === 0) {
        return { cutXsU: outXs, cutYsU: outYs, nudgedSeams };
      }
      const deltasMm = [2, -2, 3, -3, 4, -4, 5, -5];
      for (let yi = 0; yi < outYs.length; yi++) {
        if (lockedYIndices && lockedYIndices.has(yi)) continue;
        const origY = outYs[yi];
        const seamBase = countSmallCrumbsForAxis(outXs, outYs, 'y', origY);
        if (seamBase.nearBadCount === 0) continue;
        const prevY = yi === 0 ? -halfH : outYs[yi - 1];
        const nextY = yi === outYs.length - 1 ? halfH : outYs[yi + 1];
        const tileWEst = (outXs.length === 0 ? 2 * halfW : (outXs[0] - (-halfW))) * scaleMm;
        let bestY = origY;
        let bestCount = seamBase.badCount;
        let bestNearCount = seamBase.nearBadCount;
        let bestNearMinArea = seamBase.nearBadMinArea;
        let bestDelta = 0;
        for (const dm of deltasMm) {
          const candY = origY + dm / scaleMm;
          const h0Mm = (candY - prevY) * scaleMm;
          const h1Mm = (nextY - candY) * scaleMm;
          if (!fitsSafe(tileWEst, h0Mm) || !fitsSafe(tileWEst, h1Mm)) continue;
          const testYs = outYs.slice();
          testYs[yi] = candY;
          const st = countSmallCrumbsForAxis(outXs, testYs, 'y', candY);
          const strictlyBetterCount = st.badCount < bestCount;
          const sameCountBetterNear = st.badCount === bestCount && (
            st.nearBadCount < bestNearCount ||
            (st.nearBadCount === bestNearCount && st.nearBadMinArea > bestNearMinArea + 2.0)
          );
          if (strictlyBetterCount || sameCountBetterNear) {
            bestCount = st.badCount;
            bestNearCount = st.nearBadCount;
            bestNearMinArea = st.nearBadMinArea;
            bestY = candY;
            bestDelta = dm;
          }
        }
        if (bestY !== origY) {
          outYs[yi] = bestY;
          curStats = countSmallCrumbsForAxis(outXs, outYs);
          nudgedSeams.push({ axis: 'y', index: yi, delta_mm: bestDelta });
        }
      }
      for (let xi = 0; xi < outXs.length; xi++) {
        if (lockedXIndices && lockedXIndices.has(xi)) continue;
        const origX = outXs[xi];
        const seamBase = countSmallCrumbsForAxis(outXs, outYs, 'x', origX);
        if (seamBase.nearBadCount === 0) continue;
        const prevX = xi === 0 ? -halfW : outXs[xi - 1];
        const nextX = xi === outXs.length - 1 ? halfW : outXs[xi + 1];
        const tileHEst = (outYs.length === 0 ? 2 * halfH : (outYs[0] - (-halfH))) * scaleMm;
        let bestX = origX;
        let bestCount = seamBase.badCount;
        let bestNearCount = seamBase.nearBadCount;
        let bestNearMinArea = seamBase.nearBadMinArea;
        let bestDelta = 0;
        for (const dm of deltasMm) {
          const candX = origX + dm / scaleMm;
          const w0Mm = (candX - prevX) * scaleMm;
          const w1Mm = (nextX - candX) * scaleMm;
          if (!fitsSafe(w0Mm, tileHEst) || !fitsSafe(w1Mm, tileHEst)) continue;
          const testXs = outXs.slice();
          testXs[xi] = candX;
          const st = countSmallCrumbsForAxis(testXs, outYs, 'x', candX);
          const strictlyBetterCount = st.badCount < bestCount;
          const sameCountBetterNear = st.badCount === bestCount && (
            st.nearBadCount < bestNearCount ||
            (st.nearBadCount === bestNearCount && st.nearBadMinArea > bestNearMinArea + 2.0)
          );
          if (strictlyBetterCount || sameCountBetterNear) {
            bestCount = st.badCount;
            bestNearCount = st.nearBadCount;
            bestNearMinArea = st.nearBadMinArea;
            bestX = candX;
            bestDelta = dm;
          }
        }
        if (bestX !== origX) {
          outXs[xi] = bestX;
          curStats = countSmallCrumbsForAxis(outXs, outYs);
          nudgedSeams.push({ axis: 'x', index: xi, delta_mm: bestDelta });
        }
      }
    } finally {
      core.safeDeleteManifold(crossSectionZ0);
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
      const overTris = allInputTris.filter(t => t.layerId !== 1);
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
      if (solids.length === 0) return [];

      let masterSolid = solids.length === 1 ? solids[0] : core.batchUnionManifolds(mf, solids);
      if (!masterSolid || masterSolid.numTri() === 0) {
        core.safeDeleteManifold(masterSolid);
        return [];
      }

      const nominalCutXsU = [];
      const colSpan = (2 * halfW) / tileCols;
      for (let tc = 1; tc < tileCols; tc++) nominalCutXsU.push(-halfW + tc * colSpan);
      const nominalCutYsU = [];
      const rowSpan = (2 * halfH) / tileRows;
      for (let tr = 1; tr < tileRows; tr++) nominalCutYsU.push(-halfH + tr * rowSpan);

      const uBB = masterSolid.boundingBox();
      const spanXMm = (uBB.max[0] - uBB.min[0]) * scaleMm;
      const spanYMm = (uBB.max[1] - uBB.min[1]) * scaleMm;
      const isFullSceneBase = uBB.min[2] <= 0.05 / scaleMm &&
        Math.max(spanXMm, spanYMm) >= 25.0 &&
        Math.min(spanXMm, spanYMm) >= 6.0;

      let activeCutXsU = nominalCutXsU.slice();
      let activeCutYsU = nominalCutYsU.slice();
      let nudgedSeams = [];

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

        // 3. Resolve any bounded seam-nudges (+-2..5 mm) before carving seam-aligned relief
        // Lock inter-frame boundaries in multi-frame SKUs so physical passe-partout windows stay exact.
        if (isCutout && (activeCutXsU.length > 0 || activeCutYsU.length > 0)) {
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
          const nudgeRes = _resolveBoundedSeamNudges(
            core, poly, mf, masterSolid, activeCutXsU, activeCutYsU, halfW, halfH, scaleMm, state, lockedX, lockedY
          );
          activeCutXsU = nudgeRes.cutXsU;
          activeCutYsU = nudgeRes.cutYsU;
          nudgedSeams = nudgeRes.nudgedSeams;
        }

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

        if (solidBaseNoTunnels && (z0AreaMm2 > 3500.0 || hasInlandLake || tileCols > 1 || tileRows > 1)) {
          masterSolid = _carveUndersideStressReliefNetwork(
            core, poly, mf, ventMod, vaultMod, masterSolid, scaleMm, halfW, halfH,
            activeCutXsU, activeCutYsU, baseBottomMm
          );
        } else if (isCutout === true && hasInlandLake && ventMod && typeof ventMod.ventLargeBasePocketsUnderside === 'function' && vaultMod && vaultMod._rasterizePolysToGrid) {
          const masterSeams = (activeCutXsU.length > 0 || activeCutYsU.length > 0)
            ? { south: false, north: false, west: false, east: false }
            : null;
          masterSolid = ventMod.ventLargeBasePocketsUnderside(
            core, poly, mf, masterSolid, masterSolid.boundingBox(), scaleMm, baseBottomMm, masterSeams, vaultMod._rasterizePolysToGrid
          );
        }

        // 5. Global upper courtyard venting, overhang grounding, and outer-only sliver cleanup
        if (vaultMod && typeof vaultMod._ventUpperSealedCourtyards === 'function') {
          masterSolid = vaultMod._ventUpperSealedCourtyards(
            core, poly, mf, masterSolid, scaleMm, baseBottomMm, ventMod
          );
        }
        if (vaultMod && typeof vaultMod._groundFlatOverhangPiers === 'function') {
          masterSolid = vaultMod._groundFlatOverhangPiers(
            core, poly, mf, masterSolid, masterSolid.boundingBox(), scaleMm, baseBottomMm
          );
        }
        if (vaultMod && typeof vaultMod._cleanupDetachedBorderSlivers === 'function') {
          masterSolid = vaultMod._cleanupDetachedBorderSlivers(core, mf, masterSolid, scaleMm);
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
      const chamferInsetMm = useChamfer ? 0.25 : 0.0;
      const chamferHeightMm = useChamfer ? 0.50 : 0.0;

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
