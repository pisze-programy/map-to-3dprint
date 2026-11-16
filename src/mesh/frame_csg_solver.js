// ============================================================================
// src/mesh/frame_csg_solver.js
// Manifold CSG Frame Segmenter for Anycubic Photon Mono 4 (153.45 x 87.05 mm)
// Shared by stl_writer.js and zip_packager.js (zero manual triangle clipping)
// ============================================================================

(function (root) {
  function _getDeps() {
    const core = (typeof trianglesToShellManifolds === 'function' && typeof boxManifoldFromBounds === 'function')
      ? root
      : (typeof require !== 'undefined' ? require('../geometry/manifold_core.js') : root);
    const cfgMod = (typeof resolveSceneScaleAndSpec === 'function' && typeof PRINT_PHYSICS_CONFIG !== 'undefined')
      ? root
      : (typeof require !== 'undefined' ? require('../geometry/print_physics_config.js') : root);
    return { core, cfgMod };
  }

  function _cutBarStripSegments(core, mf, frameMan, strip, z0, z1, scaleMm, mono4, shiftZMm, startIdx) {
    const maxLongMm = Math.min(mono4.frameSplitMaxMm || 148.0, mono4.bedXMm - 1.5);
    const maxShortMm = Math.min(maxLongMm, mono4.bedYMm - 1.5);
    const swMm = (strip.x1 - strip.x0) * scaleMm;
    const shMm = (strip.y1 - strip.y0) * scaleMm;
    if (swMm <= 0.1 || shMm <= 0.1) return [];

    const maxXMm = swMm >= shMm ? maxLongMm : maxShortMm;
    const maxYMm = swMm >= shMm ? maxShortMm : maxLongMm;
    const nx = Math.max(1, Math.ceil(swMm / maxXMm));
    const ny = Math.max(1, Math.ceil(shMm / maxYMm));
    const dx = (strip.x1 - strip.x0) / nx;
    const dy = (strip.y1 - strip.y0) / ny;
    const out = [];
    let idx = startIdx;

    for (let ry = ny - 1; ry >= 0; ry--) {
      const y0 = ry === 0 ? strip.y0 : strip.y0 + ry * dy;
      const y1 = ry === ny - 1 ? strip.y1 : strip.y0 + (ry + 1) * dy;
      for (let cx = 0; cx < nx; cx++) {
        const x0 = cx === 0 ? strip.x0 : strip.x0 + cx * dx;
        const x1 = cx === nx - 1 ? strip.x1 : strip.x0 + (cx + 1) * dx;
        const box = core.boxManifoldFromBounds(mf, x0, x1, y0, y1, z0, z1);
        if (!box) continue;
        let segMan = null;
        try {
          segMan = frameMan.intersect(box);
          if (segMan && segMan.numTri() > 0) {
            const sbb = segMan.boundingBox();
            const segW = (sbb.max[0] - sbb.min[0]) * scaleMm;
            const segH = (sbb.max[1] - sbb.min[1]) * scaleMm;
            const fitsN = segW <= mono4.bedXMm + 1e-4 && segH <= mono4.bedYMm + 1e-4;
            const fitsR = segH <= mono4.bedXMm + 1e-4 && segW <= mono4.bedYMm + 1e-4;
            const tris = [];
            core.appendManifoldToTriangles(segMan, tris, 6, -1, 0, idx);
            if (tris.length > 0) {
              out.push({
                name: `Rama_${String(idx++).padStart(2, '0')}_${strip.tag}_${Math.round(segW)}x${Math.round(segH)}mm.stl`,
                tris,
                shiftX: -sbb.min[0],
                shiftY: -sbb.min[1],
                segW,
                segH,
                shouldRotate: !fitsN && fitsR,
                shiftZMm,
              });
            }
          }
        } catch (_) {
        } finally {
          core.safeDeleteManifold(segMan);
          core.safeDeleteManifold(box);
        }
      }
    }
    return out;
  }

  function buildFrameSegmentsCSG(state, frameTris) {
    if (!Array.isArray(frameTris) || frameTris.length === 0) return [];
    const { core, cfgMod } = _getDeps();
    const { scaleMm, halfW, halfH } = cfgMod.resolveSceneScaleAndSpec(state, null);
    const cfg = cfgMod.PRINT_PHYSICS_CONFIG || {};
    const mono4 = cfg.photonMono4 || { bedXMm: 153.45, bedYMm: 87.05, frameSplitMaxMm: 148.0 };
    const mf = typeof core.getManifoldLib === 'function' ? core.getManifoldLib() : null;
    if (!mf) return [];

    const shells = core.trianglesToShellManifolds(mf, frameTris);
    if (shells.length === 0) return [];
    const frameMan = shells.length === 1 ? shells[0] : core.batchUnionManifolds(mf, shells);
    if (!frameMan || frameMan.numTri() === 0) {
      core.safeDeleteManifold(frameMan);
      return [];
    }

    try {
      const bb = frameMan.boundingBox();
      const shiftZMm = bb.min[2] < 0 ? (-bb.min[2] * scaleMm) : 0;
      const fullW = (bb.max[0] - bb.min[0]) * scaleMm;
      const fullH = (bb.max[1] - bb.min[1]) * scaleMm;
      const fitsFullN = fullW <= mono4.bedXMm + 1e-4 && fullH <= mono4.bedYMm + 1e-4;
      const fitsFullR = fullH <= mono4.bedXMm + 1e-4 && fullW <= mono4.bedYMm + 1e-4;

      if (fitsFullN || fitsFullR) {
        const tris = [];
        core.appendManifoldToTriangles(frameMan, tris, 6, -1, 0, 1);
        return [{
          name: `Rama_01_Pelna_${Math.round(fullW)}x${Math.round(fullH)}mm.stl`,
          tris,
          shiftX: -bb.min[0],
          shiftY: -bb.min[1],
          segW: fullW,
          segH: fullH,
          shouldRotate: !fitsFullN && fitsFullR,
          shiftZMm,
        }];
      }

      const gapMm = cfg.frameInnerGapMm || 0.47;
      const outerHalfW = (bb.max[0] - bb.min[0]) * 0.5;
      const outerHalfH = (bb.max[1] - bb.min[1]) * 0.5;
      const cx = (bb.min[0] + bb.max[0]) * 0.5;
      const cy = (bb.min[1] + bb.max[1]) * 0.5;
      const minRailU = Math.min(0.20 / scaleMm, outerHalfW * 0.05, outerHalfH * 0.05);

      let inMinX = cx - (halfW + gapMm / scaleMm);
      let inMaxX = cx + (halfW + gapMm / scaleMm);
      let inMinY = cy - (halfH + gapMm / scaleMm);
      let inMaxY = cy + (halfH + gapMm / scaleMm);

      if (typeof frameMan.slice === 'function') {
        let cs = null;
        try {
          cs = frameMan.slice((bb.min[2] + bb.max[2]) * 0.5);
          const polys = cs.toPolygons();
          let bestHoleArea = 0;
          for (const ring of polys) {
            if (!ring || ring.length < 3) continue;
            const a = core.signedArea2D(ring);
            if (a < -1e-4 && Math.abs(a) > bestHoleArea) {
              bestHoleArea = Math.abs(a);
              let hx0 = Infinity, hx1 = -Infinity, hy0 = Infinity, hy1 = -Infinity;
              for (const p of ring) {
                if (p[0] < hx0) hx0 = p[0]; if (p[0] > hx1) hx1 = p[0];
                if (p[1] < hy0) hy0 = p[1]; if (p[1] > hy1) hy1 = p[1];
              }
              inMinX = hx0; inMaxX = hx1; inMinY = hy0; inMaxY = hy1;
            }
          }
        } catch (_) {
        } finally {
          core.safeDeleteManifold(cs);
        }
      }

      const hasHole = inMinX > bb.min[0] + minRailU && inMaxX < bb.max[0] - minRailU &&
                      inMinY > bb.min[1] + minRailU && inMaxY < bb.max[1] - minRailU;

      const strips = hasHole
        ? [
            { tag: 'N', x0: bb.min[0], x1: bb.max[0], y0: inMaxY, y1: bb.max[1] },
            { tag: 'S', x0: bb.min[0], x1: bb.max[0], y0: bb.min[1], y1: inMinY },
            { tag: 'W', x0: bb.min[0], x1: inMinX, y0: inMinY, y1: inMaxY },
            { tag: 'E', x0: inMaxX, x1: bb.max[0], y0: inMinY, y1: inMaxY },
          ]
        : [{ tag: 'S', x0: bb.min[0], x1: bb.max[0], y0: bb.min[1], y1: bb.max[1] }];

      const z0 = bb.min[2] - 0.5, z1 = bb.max[2] + 0.5;
      const segments = [];
      for (const strip of strips) {
        const part = _cutBarStripSegments(core, mf, frameMan, strip, z0, z1, scaleMm, mono4, shiftZMm, segments.length + 1);
        for (let i = 0; i < part.length; i++) segments.push(part[i]);
      }
      return segments;
    } finally {
      core.safeDeleteManifold(frameMan);
    }
  }

  const exportsObj = { buildFrameSegmentsCSG };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
