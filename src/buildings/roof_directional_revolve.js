// ============================================================================
// src/buildings/roof_directional_revolve.js
// Rotational, Dome & Directional S3DB Roof Builders (with +90 deg Azimuth)
// ============================================================================

(function (root) {
  function _ringAreaSigned(ring) {
    if (!ring || ring.length < 3) return 0;
    let s = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return 0.5 * s;
  }

  function _ptInRing(px, py, ring) {
    if (!ring || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }

  // Compass dirDeg is DOWNHILL slope direction (0=N/+Y, 90=E/+X).
  // Ridge axis axU runs perpendicular (+90 deg CCW from downhill), placing vMax uphill and vMin downhill.
  function _computeOBB(outer, dirDeg = null, orient = 'along', rotDeg = 0) {
    let cx = 0, cy = 0;
    for (let i = 0; i < outer.length; i++) { cx += outer[i][0]; cy += outer[i][1]; }
    cx /= outer.length; cy /= outer.length;

    let bestAngle = 0;
    const hasDir = typeof dirDeg === 'number' && Number.isFinite(dirDeg);
    if (hasDir) {
      const effDeg = (((dirDeg - (Number(rotDeg) || 0)) % 360) + 360) % 360;
      bestAngle = ((180.0 - effDeg) * Math.PI) / 180.0;
    } else {
      let maxEdgeLen2 = -1;
      for (let i = 0; i < outer.length; i++) {
        const a = outer[i], b = outer[(i + 1) % outer.length];
        const d2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
        if (d2 > maxEdgeLen2) { maxEdgeLen2 = d2; bestAngle = Math.atan2(b[1] - a[1], b[0] - a[0]); }
      }
    }

    const computeAxesBounds = (theta) => {
      const ux = Math.cos(theta), uy = Math.sin(theta), vx = -uy, vy = ux;
      let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
      for (let i = 0; i < outer.length; i++) {
        const rx = outer[i][0] - cx, ry = outer[i][1] - cy;
        const u = rx * ux + ry * uy, v = rx * vx + ry * vy;
        if (u < uMin) uMin = u; if (u > uMax) uMax = u;
        if (v < vMin) vMin = v; if (v > vMax) vMax = v;
      }
      return { cx, cy, theta, ux, uy, vx, vy, uMin, uMax, vMin, vMax, spanU: uMax - uMin, spanV: vMax - vMin };
    };

    let obb = computeAxesBounds(bestAngle);
    if (!hasDir) {
      if (orient !== 'across' && obb.spanV > obb.spanU * 1.05) obb = computeAxesBounds(bestAngle + Math.PI * 0.5);
    } else if (orient === 'across') {
      obb = computeAxesBounds(bestAngle + Math.PI * 0.5);
    }
    return obb;
  }

  function _insetRoofOuterAndHoles(core, outer, holes) {
    let rOuter = outer, rHoles = holes || [];
    try {
      const cleanOuter = core.ensureWinding(outer, true, 4e-4);
      const origA = Math.abs(_ringAreaSigned(cleanOuter));
      if (cleanOuter.length >= 3 && origA > 1e-4) {
        const shrunkOuters = core.clipperOffsetPolys([cleanOuter], -0.004, 'Miter', 1e-5).map(r => core.ensureWinding(r, true, 4e-4)).filter(r => r.length >= 3);
        const expandedHoles = [];
        for (const h of rHoles) {
          const hCCW = core.ensureWinding(h, true, 4e-4);
          if (hCCW.length < 3) continue;
          for (const oh of core.clipperOffsetPolys([hCCW], 0.004, 'Miter', 1e-5)) {
            const cl = core.ensureWinding(oh, true, 4e-4);
            if (cl.length >= 3) expandedHoles.push(cl);
          }
        }
        const insetPolys = expandedHoles.length > 0 && shrunkOuters.length > 0 ? core.clipperDiffPolys(shrunkOuters, expandedHoles, 1e-5) : shrunkOuters;
        const grouped = core.ringsToOutersWithHoles(insetPolys, 1e-5);
        if (grouped.length > 0 && grouped[0].outer.length >= 3) {
          const best = grouped.reduce((b, g) => Math.abs(_ringAreaSigned(g.outer)) > Math.abs(_ringAreaSigned(b.outer)) ? g : b, grouped[0]);
          const finalOuter = core.ensureWinding(best.outer, true, 4e-4);
          if (finalOuter.length >= 3 && Math.abs(_ringAreaSigned(finalOuter)) >= origA * 0.35) {
            rOuter = finalOuter;
            rHoles = (best.holes || []).map(hr => core.ensureWinding(hr, false, 4e-4)).filter(hr => hr.length >= 3);
          }
        }
      }
    } catch (_) {}
    return { outer: rOuter, holes: rHoles };
  }

  function _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, profileVZ, useRotated90 = false) {
    if (zTop - zEaves <= 1e-4) return null;
    const pad = 0.25;
    const lenU = (useRotated90 ? obb.spanV : obb.spanU) + pad * 2;
    const uStart = (useRotated90 ? obb.vMin : obb.uMin) - pad;
    const axU = useRotated90 ? [obb.vx, obb.vy] : [obb.ux, obb.uy];
    const axV = useRotated90 ? [-obb.ux, -obb.uy] : [obb.vx, obb.vy];
    const pts2D = core.ensureWinding(profileVZ, true, 1e-5);
    if (pts2D.length < 3) return null;

    let rawPrism = null, cutter = null;
    try {
      const cs = mf.CrossSection.ofPolygons([pts2D], 'Positive');
      if (cs.isEmpty && cs.isEmpty()) { cs.delete(); return null; }
      const ex = cs.extrude(lenU);
      cs.delete();
      const tx = obb.cx + axU[0] * uStart, ty = obb.cy + axU[1] * uStart;
      rawPrism = ex.transform([axV[0], axV[1], 0, 0, 0, 0, 1, 0, axU[0], axU[1], 0, 0, tx, ty, 0, 1]);
      ex.delete();
      let maxProfZ = zTop;
      for (let i = 0; i < pts2D.length; i++) if (pts2D[i][1] > maxProfZ) maxProfZ = pts2D[i][1];
      cutter = core.extrudeRingSolid(mf, outer, holes, zEaves - 0.12, maxProfZ + 0.5);
      if (!cutter) return null;
      const clipped = rawPrism.intersect(cutter);
      if (!clipped || (clipped.isEmpty && clipped.isEmpty()) || clipped.numTri() === 0) { core.safeDeleteManifold(clipped); return null; }
      return clipped;
    } catch (_) { return null; }
    finally { core.safeDeleteManifold(rawPrism); core.safeDeleteManifold(cutter); }
  }

  function _buildLatheRoofClipped(core, mf, outer, holes, zEaves, roofH, isOnion = false, rotDeg = 0) {
    const obb = _computeOBB(outer, null, 'along', rotDeg);
    const radFrac = isOnion ? 0.48 : 0.43;
    const rx = Math.max(0.2, obb.spanU * radFrac), ry = Math.max(0.2, obb.spanV * radFrac), baseR = Math.max(rx, ry);
    const prof = [[0, 0]];
    if (!isOnion) {
      for (let i = 0; i <= 10; i++) {
        const ang = (i / 10) * (Math.PI * 0.5);
        prof.push([Math.max(0, Math.cos(ang) * baseR), Math.sin(ang) * roofH]);
      }
    } else {
      const pts = [[0.72, 0.0], [0.96, 0.14], [1.0, 0.30], [0.85, 0.48], [0.52, 0.65], [0.22, 0.80], [0.06, 0.92], [0.0, 1.0]];
      prof.push([pts[0][0] * baseR, -0.05]);
      for (const pt of pts) prof.push([pt[0] * baseR, pt[1] * roofH]);
    }
    let cutter = null, moved = null;
    try {
      const cs = mf.CrossSection.ofPolygons([prof], 'Positive');
      let rev = mf.Manifold.revolve(cs, 24, 360);
      cs.delete();
      const sx = rx / baseR, sy = ry / baseR;
      if (Math.abs(sx - 1) > 0.03 || Math.abs(sy - 1) > 0.03 || Math.abs(obb.theta) > 1e-3) {
        const sc = rev.scale([sx, sy, 1]); rev.delete();
        const rt = sc.rotate([0, 0, (obb.theta * 180) / Math.PI]); sc.delete();
        rev = rt;
      }
      moved = rev.translate([obb.cx, obb.cy, zEaves - 0.04]); rev.delete();
      cutter = core.extrudeRingSolid(mf, outer, holes, zEaves - 0.10, zEaves + roofH + 0.5);
      if (!cutter) return moved;
      const res = moved.intersect(cutter);
      if (res && res.numTri() > 0) return res;
      core.safeDeleteManifold(res);
      return null;
    } catch (_) { return null; }
    finally { core.safeDeleteManifold(cutter); core.safeDeleteManifold(moved); }
  }

  function buildDirectionalOrRevolveRoof(core, mf, outer, holes, zEaves, roofH, roofShape, roofDirDeg, roofOrient, rotDeg = 0) {
    const obb = _computeOBB(outer, roofDirDeg, roofOrient, rotDeg);
    const zTop = zEaves + roofH, zOverlapBot = zEaves - 0.04;
    const vMin = obb.vMin - 0.15, vMax = obb.vMax + 0.15, spanV = vMax - vMin, vMid = (vMin + vMax) * 0.5;

    if (roofShape === 'skillion') {
      // Extrapolate the exact linear slope over [obb.vMin, obb.vMax] so padding does not flatten steep wedges
      const exactSpanV = Math.max(1e-5, obb.vMax - obb.vMin);
      const slope = roofH / exactSpanV;
      const zAtVMax = zTop + slope * 0.15;
      const zAtVMin = zEaves - slope * 0.15;
      const skillionProf = zAtVMin >= zOverlapBot + 1e-4
        ? [[vMin, zOverlapBot], [vMax, zOverlapBot], [vMax, zAtVMax], [vMin, zAtVMin]]
        : [[obb.vMin - (zEaves - zOverlapBot) / Math.max(1e-5, slope), zOverlapBot], [vMax, zOverlapBot], [vMax, zAtVMax]];
      return _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, skillionProf);
    }
    if (roofShape === 'saltbox') {
      const ridgeV = vMin + spanV * 0.30;
      return _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, [
        [vMin, zOverlapBot], [vMax, zOverlapBot], [vMax, zEaves], [ridgeV, zTop], [vMin, zEaves],
      ]);
    }
    if (roofShape === 'round') {
      const prof = [[vMin, zOverlapBot], [vMax, zOverlapBot], [vMax, zEaves]];
      for (let i = 0; i <= 12; i++) {
        const ang = (i / 12) * Math.PI;
        prof.push([vMid + Math.cos(ang) * (spanV * 0.5), zEaves + Math.sin(ang) * roofH]);
      }
      prof.push([vMin, zEaves]);
      return _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, prof);
    }
    if (roofShape === 'sawtooth') {
      const nTeeth = 3, prof = [[vMin, zOverlapBot], [vMax, zOverlapBot], [vMax, zEaves]];
      for (let i = nTeeth; i >= 1; i--) {
        const vt1 = vMin + (i / nTeeth) * spanV, vt0 = vMin + ((i - 1) / nTeeth) * spanV;
        prof.push([vt1, zTop], [vt0, i === 1 ? zEaves : (zEaves + 0.025)]);
      }
      return _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, prof);
    }
    if (roofShape === 'butterfly') {
      return _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, [
        [vMin, zOverlapBot], [vMax, zOverlapBot], [vMax, zTop], [vMid, zEaves + roofH * 0.14], [vMin, zTop],
      ]);
    }
    if (roofShape === 'dome' || roofShape === 'onion') {
      return _buildLatheRoofClipped(core, mf, outer, holes, zEaves, roofH, roofShape === 'onion', rotDeg);
    }
    if (roofShape === 'stepped') {
      const tiers = [], inset = -Math.min(obb.spanU, obb.spanV) * 0.12;
      let curRings = core.clipperDiffPolys([outer], holes, 1e-5);
      for (let s = 0; s < 3 && curRings.length > 0; s++) {
        const z0 = zEaves - 0.02 + (s / 3) * roofH, z1 = zEaves + ((s + 1) / 3) * roofH;
        for (const g of core.ringsToOutersWithHoles(curRings, 1e-5)) {
          const m = core.extrudeRingSolid(mf, g.outer, g.holes, z0, z1);
          if (m) tiers.push(m);
        }
        curRings = core.clipperOffsetPolys(curRings, inset, 'Miter', 1e-5);
      }
      return tiers.length > 0 ? core.batchUnionManifolds(mf, tiers) : null;
    }
    return null;
  }

  const exportsObj = {
    _ringAreaSigned,
    _ptInRing,
    _computeOBB,
    _insetRoofOuterAndHoles,
    _extrudeProfileRoofClipped,
    _buildLatheRoofClipped,
    buildDirectionalOrRevolveRoof,
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
