// ============================================================================
// src/mesh/layer1_s3db_buildings.js
// Layer-1 OSM Simple 3D Buildings (S3DB) Geometric Solver
// - Supports type=building relations (outline vs part), min_height, height/levels
// - All 16 standard OSM roof:shape catalog via Straight Skeleton + Manifold CSG
// - 100% Pure OSM Tags (ZERO proper-noun regexes or city-specific overrides)
// ============================================================================

(function (root) {
  function _getCore() {
    if (typeof createBuildContext === 'function') return root;
    if (typeof require !== 'undefined') return require('../geometry/manifold_core.js');
    return root;
  }

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
      if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  function _computeOBB(outer, dirDeg = null, orient = 'along') {
    let cx = 0, cy = 0;
    for (let i = 0; i < outer.length; i++) { cx += outer[i][0]; cy += outer[i][1]; }
    cx /= outer.length; cy /= outer.length;

    let bestAngle = 0;
    if (typeof dirDeg === 'number' && Number.isFinite(dirDeg)) {
      // OSM roof:direction points downhill perpendicular to ridge; ridge runs along tangent (+90 deg)
      const rad = ((90 - dirDeg) * Math.PI) / 180.0;
      bestAngle = rad;
    } else {
      let maxEdgeLen2 = -1;
      for (let i = 0; i < outer.length; i++) {
        const a = outer[i], b = outer[(i + 1) % outer.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const d2 = dx * dx + dy * dy;
        if (d2 > maxEdgeLen2) {
          maxEdgeLen2 = d2;
          bestAngle = Math.atan2(dy, dx);
        }
      }
    }

    const computeAxesBounds = (theta) => {
      const ux = Math.cos(theta), uy = Math.sin(theta);
      const vx = -uy, vy = ux;
      let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
      for (let i = 0; i < outer.length; i++) {
        const rx = outer[i][0] - cx, ry = outer[i][1] - cy;
        const u = rx * ux + ry * uy;
        const v = rx * vx + ry * vy;
        if (u < uMin) uMin = u; if (u > uMax) uMax = u;
        if (v < vMin) vMin = v; if (v > vMax) vMax = v;
      }
      return { cx, cy, theta, ux, uy, vx, vy, uMin, uMax, vMin, vMax, spanU: uMax - uMin, spanV: vMax - vMin };
    };

    let obb = computeAxesBounds(bestAngle);
    if (dirDeg === null || !Number.isFinite(dirDeg)) {
      if (orient === 'across' && obb.spanV > obb.spanU) {
        // Keep ridge across short axis when explicitly requested
      } else if (orient !== 'across' && obb.spanV > obb.spanU * 1.05) {
        obb = computeAxesBounds(bestAngle + Math.PI * 0.5);
      }
    } else if (orient === 'across') {
      obb = computeAxesBounds(bestAngle + Math.PI * 0.5);
    }
    return obb;
  }

  function _normalizeRoofShape(rawRoof) {
    const r = String(rawRoof || 'flat').toLowerCase().trim().replace(/_/g, '-');
    if (!r || r === 'flat' || r === 'none') return 'flat';
    if (r === 'gable' || r === 'gabled' || r === 'pitched' || r === 'dual-pent') return 'gabled';
    if (r === 'hip' || r === 'hipped' || r === 'hipped-and-valley') return 'hipped';
    if (r === 'half-hip' || r === 'half-hipped' || r === 'jerkinhead') return 'half-hipped';
    if (r === 'pyramidal' || r === 'pyramid') return 'pyramidal';
    if (r === 'dome' || r === 'cupola') return 'dome';
    if (r === 'onion') return 'onion';
    if (r === 'round' || r === 'barrel' || r === 'arched' || r === 'vault') return 'round';
    if (r === 'skillion' || r === 'lean-to' || r === 'shed' || r === 'mono-pitched') return 'skillion';
    if (r === 'mansard') return 'mansard';
    if (r === 'gambrel') return 'gambrel';
    if (r === 'saltbox' || r === 'catslide') return 'saltbox';
    if (r === 'quadruple-saltbox') return 'quadruple_saltbox';
    if (r === 'cone' || r === 'conical' || r === 'spire') return 'cone';
    if (r === 'stepped' || r === 'ziggurat') return 'stepped';
    if (r === 'sawtooth') return 'sawtooth';
    if (r === 'butterfly') return 'butterfly';
    return 'flat';
  }

  // Classify structures intentionally handled by Layer-2 pure-tag procedural archetypes
  const LAYER2_MAN_MADE = new Set([
    'wind_turbine', 'cooling_tower', 'chimney', 'storage_tank', 'silo',
    'crane', 'mast', 'communications_tower', 'pier', 'breakwater', 'groyne', 'jetty'
  ]);
  const WHEEL_ATTR = new Set(['big_wheel', 'ferris_wheel', 'observation_wheel']);

  function isLayer2ArchetypeRecord(b, tags = {}) {
    if (!b) return false;
    if (b.archType === 'ferris_wheel' || b.btype === 'pier' || b.btype === 'observation_wheel') return true;
    const attr = String(tags.attraction || '').toLowerCase().trim();
    const tt = String(tags['tower:type'] || '').toLowerCase().trim();
    const mm = String(tags.man_made || '').toLowerCase().trim();
    const tc = String(tags['tower:construction'] || '').toLowerCase().trim();
    if (WHEEL_ATTR.has(attr) || tt === 'observation_wheel') return true;
    if (LAYER2_MAN_MADE.has(mm)) return true;
    if (tc === 'lattice' || tc === 'guyed_lattice') return true;
    if (mm === 'lighthouse') return true;
    if (mm === 'tower' && !b.part && !b.fromBuildingRel) return true;
    return false;
  }

  // Extrude 2D profile (v in [vMin..vMax], z relative to zEaves) along uAxis, rotate to world, intersect footprint
  function _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, profileVZ, useRotated90 = false) {
    const rH = zTop - zEaves;
    if (rH <= 1e-4) return null;
    const pad = 0.25;
    const lenU = (useRotated90 ? obb.spanV : obb.spanU) + pad * 2;
    const uStart = (useRotated90 ? obb.vMin : obb.uMin) - pad;
    const axU = useRotated90 ? [obb.vx, obb.vy] : [obb.ux, obb.uy];
    const axV = useRotated90 ? [-obb.ux, -obb.uy] : [obb.vx, obb.vy];

    // CrossSection in (V, Z) extruded along +W (length lenU), then rotate 90deg so +W aligns along axU
    const pts2D = core.ensureWinding(profileVZ, true, 1e-5);
    if (pts2D.length < 3) return null;

    let rawPrism = null;
    let cutter = null;
    try {
      const cs = mf.CrossSection.ofPolygons([pts2D], 'Positive');
      if (cs.isEmpty && cs.isEmpty()) {
        cs.delete();
        return null;
      }
      const ex = cs.extrude(lenU); // X_ex = V, Y_ex = Z, Z_ex = 0..lenU
      cs.delete();

      // Rotate ex: X' = Z_ex (along U), Y' = X_ex (along V), Z' = Y_ex (along +Z height)
      // Transform 4x3 column-major / affine via Manifold.transform(mat):
      // M * [x_ex, y_ex, z_ex, 1] -> [axU[0]*z_ex + axV[0]*x_ex + cx + axU[0]*uStart, ...]
      const m0 = axV[0], m1 = axV[1], m2 = 0;       // col 0 (x_ex -> V)
      const m4 = 0,      m5 = 0,      m6 = 1;       // col 1 (y_ex -> +Z)
      const m8 = axU[0], m9 = axU[1], m10 = 0;      // col 2 (z_ex -> U)
      const tx = obb.cx + axU[0] * uStart;
      const ty = obb.cy + axU[1] * uStart;
      const tz = 0;
      rawPrism = ex.transform([m0, m1, m2, 0, m4, m5, m6, 0, m8, m9, m10, 0, tx, ty, tz, 1]);
      ex.delete();

      cutter = core.extrudeRingSolid(mf, outer, holes, zEaves - 0.12, zTop + 0.5);
      if (!cutter) return null;
      const clipped = rawPrism.intersect(cutter);
      if (!clipped || (clipped.isEmpty && clipped.isEmpty()) || clipped.numTri() === 0) {
        core.safeDeleteManifold(clipped);
        return null;
      }
      return clipped;
    } catch (_) {
      return null;
    } finally {
      core.safeDeleteManifold(rawPrism);
      core.safeDeleteManifold(cutter);
    }
  }

  // Straight Skeleton roof generator (exact hipped, half-hipped, mansard on arbitrary/L/courtyard footprints)
  function _buildStraightSkeletonRoof(core, mf, outer, holes, zEaves, roofH, mode = 'hipped') {
    const { StraightSkeleton: ss, earcut } = core.getVendorDeps();
    if (!ss || !ss.SkeletonBuilder || !earcut) return null;

    const ccwOuter = core.ensureWinding(outer, true, 1e-4);
    if (ccwOuter.length < 3) return null;
    const rings = [ccwOuter.slice()];
    const cleanHoles = [];
    for (let h = 0; h < (holes || []).length; h++) {
      const cwHole = core.ensureWinding(holes[h], false, 1e-4);
      if (cwHole.length >= 3) {
        rings.push(cwHole.slice());
        cleanHoles.push(cwHole);
      }
    }

    let sk = null;
    try {
      // StraightSkeleton expects open GeoJSON rings inside MultiPolygon coordinates
      sk = ss.SkeletonBuilder.BuildFromGeoJSON([rings]);
    } catch (_) {
      return null;
    }
    if (!sk || !sk.Edges || sk.Edges.length === 0) return null;

    let maxDist = 0;
    const distLookup = new Map();
    for (const [vec, d] of sk.Distances) {
      if (d > maxDist) maxDist = d;
      distLookup.set(`${vec.X.toFixed(5)},${vec.Y.toFixed(5)}`, d);
    }
    if (maxDist <= 1e-5) return null;

    const getZ = (vec) => {
      let d = sk.Distances.get(vec);
      if (d === undefined) d = distLookup.get(`${vec.X.toFixed(5)},${vec.Y.toFixed(5)}`) || 0;
      const norm = Math.max(0, Math.min(1, d / maxDist));
      if (mode === 'mansard') {
        return zEaves + (norm < 0.35 ? (norm / 0.35) * 0.78 : 0.78 + ((norm - 0.35) / 0.65) * 0.22) * roofH;
      }
      if (mode === 'half-hipped') {
        return zEaves + Math.min(1, norm / 0.72) * roofH;
      }
      return zEaves + norm * roofH;
    };

    const pos = [];
    const tris = [];
    const vertIndex = new Map();
    const addV = (x, y, z) => {
      const k = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
      let idx = vertIndex.get(k);
      if (idx === undefined) {
        idx = pos.length / 3;
        pos.push(x, y, z);
        vertIndex.set(k, idx);
      }
      return idx;
    };

    // 1. Sloped roof facets from straight skeleton edges
    for (let ei = 0; ei < sk.Edges.length; ei++) {
      const poly = sk.Edges[ei].Polygon;
      if (!poly || poly.length < 3) continue;
      const flat2D = [];
      const vIds = [];
      for (let j = 0; j < poly.length; j++) {
        const pt = poly[j];
        const z = getZ(pt);
        flat2D.push(pt.X, pt.Y);
        vIds.push(addV(pt.X, pt.Y, z));
      }
      const ecTris = earcut(flat2D, null, 2);
      for (let t = 0; t < ecTris.length; t += 3) {
        const ia = vIds[ecTris[t]], ib = vIds[ecTris[t + 1]], ic = vIds[ecTris[t + 2]];
        if (ia === ib || ib === ic || ic === ia) continue;
        // Verify upward face normal (+Z)
        const ax = pos[ia * 3], ay = pos[ia * 3 + 1], az = pos[ia * 3 + 2];
        const bx = pos[ib * 3], by = pos[ib * 3 + 1], bz = pos[ib * 3 + 2];
        const cx = pos[ic * 3], cy = pos[ic * 3 + 1], cz = pos[ic * 3 + 2];
        const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (Math.abs(nz) < 1e-10) continue;
        if (nz > 0) tris.push(ia, ib, ic);
        else tris.push(ia, ic, ib);
      }
    }

    // 1b. Overlap skirt [zBot, zEaves] so roof embeds solidly inside wall top cap with zero coplanar edges
    const zBot = zEaves - 0.04;
    for (const ring of [ccwOuter, ...cleanHoles]) {
      const topIds = ring.map(p => addV(p[0], p[1], zEaves));
      const botIdsRing = ring.map(p => addV(p[0], p[1], zBot));
      for (let i = 0; i < ring.length; i++) {
        const nxt = (i + 1) % ring.length;
        tris.push(botIdsRing[i], botIdsRing[nxt], topIds[nxt]);
        tris.push(botIdsRing[i], topIds[nxt], topIds[i]);
      }
    }

    // 2. Bottom eaves cap at zBot (downward -Z) sharing exact skirt bottom vertices!
    const botFlat = [];
    const holeStarts = [];
    const botIds = [];
    for (let i = 0; i < ccwOuter.length; i++) {
      botFlat.push(ccwOuter[i][0], ccwOuter[i][1]);
      botIds.push(addV(ccwOuter[i][0], ccwOuter[i][1], zBot));
    }
    for (let h = 0; h < cleanHoles.length; h++) {
      holeStarts.push(botFlat.length / 2);
      const hr = cleanHoles[h];
      for (let i = 0; i < hr.length; i++) {
        botFlat.push(hr[i][0], hr[i][1]);
        botIds.push(addV(hr[i][0], hr[i][1], zBot));
      }
    }
    const botEc = earcut(botFlat, holeStarts.length > 0 ? holeStarts : null, 2);
    for (let t = 0; t < botEc.length; t += 3) {
      const ia = botIds[botEc[t]], ib = botIds[botEc[t + 1]], ic = botIds[botEc[t + 2]];
      if (ia === ib || ib === ic || ic === ia) continue;
      // Downward face normal (-Z)
      const ax = pos[ia * 3], ay = pos[ia * 3 + 1];
      const bx = pos[ib * 3], by = pos[ib * 3 + 1];
      const cx = pos[ic * 3], cy = pos[ic * 3 + 1];
      const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(nz) < 1e-10) continue;
      if (nz < 0) tris.push(ia, ib, ic);
      else tris.push(ia, ic, ib);
    }

    return core.manifoldFromRawSoup(mf, new Float32Array(pos), new Uint32Array(tris), 1e-5);
  }

  function _buildLatheRoofClipped(core, mf, outer, holes, zEaves, roofH, isOnion = false) {
    const obb = _computeOBB(outer);
    const rx = Math.max(0.2, obb.spanU * 0.52);
    const ry = Math.max(0.2, obb.spanV * 0.52);
    const baseR = Math.max(rx, ry);

    // Axisymmetric profile for Manifold.revolve
    const prof = [];
    const steps = 10;
    prof.push([0, 0]);
    if (!isOnion) {
      for (let i = 0; i <= steps; i++) {
        const ang = (i / steps) * (Math.PI * 0.5);
        const r = Math.cos(ang) * baseR;
        const z = Math.sin(ang) * roofH;
        prof.push([Math.max(0, r), z]);
      }
    } else {
      // Classical bulbous onion cupola profile
      const pts = [
        [0.72, 0.0], [0.96, 0.14], [1.0, 0.30], [0.85, 0.48],
        [0.52, 0.65], [0.22, 0.80], [0.06, 0.92], [0.0, 1.0]
      ];
      prof.push([pts[0][0] * baseR, -0.05]);
      for (let i = 0; i < pts.length; i++) {
        prof.push([pts[i][0] * baseR, pts[i][1] * roofH]);
      }
    }

    let rev = null;
    let cutter = null;
    let moved = null;
    try {
      const cs = mf.CrossSection.ofPolygons([prof], 'Positive');
      rev = mf.Manifold.revolve(cs, 24, 360);
      cs.delete();

      // Stretch ellipse cleanly to match OBB aspect ratio
      const sx = rx / baseR;
      const sy = ry / baseR;
      let oriented = rev;
      if (Math.abs(sx - 1) > 0.03 || Math.abs(sy - 1) > 0.03 || Math.abs(obb.theta) > 1e-3) {
        const scaled = rev.scale([sx, sy, 1]);
        rev.delete();
        const rot = scaled.rotate([0, 0, (obb.theta * 180) / Math.PI]);
        scaled.delete();
        oriented = rot;
      }
      moved = oriented.translate([obb.cx, obb.cy, zEaves - 0.04]);
      oriented.delete();

      cutter = core.extrudeRingSolid(mf, outer, holes, zEaves - 0.10, zEaves + roofH + 0.5);
      if (!cutter) return moved;
      const res = moved.intersect(cutter);
      if (res && res.numTri() > 0) return res;
      core.safeDeleteManifold(res);
      return null;
    } catch (_) {
      return null;
    } finally {
      core.safeDeleteManifold(cutter);
      core.safeDeleteManifold(moved);
    }
  }

  function _buildConeOrPyramidalRoof(core, mf, outer, holes, zEaves, roofH, isCone = false) {
    const obb = _computeOBB(outer);
    const zTop = zEaves + roofH;
    const zBot = zEaves - 0.04;

    if (isCone && holes.length === 0) {
      const rBase = Math.max(0.2, Math.min(obb.spanU, obb.spanV) * 0.5);
      const isApproxCircular = outer.length >= 12 && Math.abs(obb.spanU - obb.spanV) <= Math.max(obb.spanU, obb.spanV) * 0.14;
      let cone = null;
      let cutter = null;
      let moved = null;
      try {
        if (isApproxCircular) {
          const segs = Math.min(32, Math.max(16, outer.length));
          cone = mf.Manifold.cylinder(roofH + 0.04, rBase, 0.001, segs, false);
          moved = cone.translate([obb.cx, obb.cy, zBot]);
          cone.delete();
          return moved;
        }
        cone = mf.Manifold.cylinder(roofH + 0.05, rBase * 1.05, 0.001, 20, false);
        moved = cone.translate([obb.cx, obb.cy, zBot]);
        cone.delete();
        cutter = core.extrudeRingSolid(mf, outer, holes, zBot - 0.05, zTop + 0.3);
        const res = cutter ? moved.intersect(cutter) : moved;
        if (cutter) moved.delete();
        return res;
      } catch (_) {
        core.safeDeleteManifold(moved);
        return null;
      } finally {
        core.safeDeleteManifold(cutter);
      }
    }

    // Closed pyramidal fan for hole-free footprints, StraightSkeleton fallback otherwise
    if (holes.length > 0) {
      return _buildStraightSkeletonRoof(core, mf, outer, holes, zEaves, roofH, 'hipped');
    }

    const { earcut } = core.getVendorDeps();
    const ccw = core.ensureWinding(outer, true, 1e-4);
    if (ccw.length < 3) return null;
    const n = ccw.length;
    const pos = [];
    const tris = [];
    const flat = [];
    for (let i = 0; i < n; i++) {
      pos.push(ccw[i][0], ccw[i][1], zEaves);
      flat.push(ccw[i][0], ccw[i][1]);
    }
    for (let i = 0; i < n; i++) {
      pos.push(ccw[i][0], ccw[i][1], zBot);
    }
    const apexIdx = 2 * n;
    pos.push(obb.cx, obb.cy, zTop);

    for (let i = 0; i < n; i++) {
      const nxt = (i + 1) % n;
      tris.push(i, nxt, apexIdx);
      tris.push(n + i, n + nxt, nxt);
      tris.push(n + i, nxt, i);
    }
    if (earcut) {
      const bot = earcut(flat, null, 2);
      for (let t = 0; t < bot.length; t += 3) {
        tris.push(n + bot[t], n + bot[t + 2], n + bot[t + 1]);
      }
    } else {
      const botC = 2 * n + 1;
      pos.push(obb.cx, obb.cy, zBot);
      for (let i = 0; i < n; i++) tris.push(botC, n + ((i + 1) % n), n + i);
    }
    return core.manifoldFromRawSoup(mf, new Float32Array(pos), new Uint32Array(tris), 1e-5);
  }

  function _buildRoofManifold(core, mf, outer, holes, zEaves, roofH, roofShape, roofDirDeg, roofOrient) {
    if (roofH <= 1e-4 || roofShape === 'flat') return null;
    // Microscopic 0.004u (~7 microns) inward inset eliminates coplanar vertical roof/wall faces while keeping 0 downward overhangs.
    // IMPORTANT: Offset outer inward (-0.004) and each hole outward (+0.004) separately so courtyards stay open!
    let rOuter = outer;
    let rHoles = holes;
    try {
      const cleanOuter = core.ensureWinding(outer, true, 4e-4);
      const origA = Math.abs(_ringAreaSigned(cleanOuter));
      if (cleanOuter.length >= 3 && origA > 1e-4) {
        const shrunkOuters = core.clipperOffsetPolys([cleanOuter], -0.004, 'Miter', 1e-5)
          .map(r => core.ensureWinding(r, true, 4e-4))
          .filter(r => r.length >= 3);
        const expandedHoles = [];
        for (let hi = 0; hi < (holes || []).length; hi++) {
          const hCCW = core.ensureWinding(holes[hi], true, 4e-4);
          if (hCCW.length < 3) continue;
          const offH = core.clipperOffsetPolys([hCCW], 0.004, 'Miter', 1e-5);
          for (let oi = 0; oi < offH.length; oi++) {
            const cleaned = core.ensureWinding(offH[oi], true, 4e-4);
            if (cleaned.length >= 3) expandedHoles.push(cleaned);
          }
        }
        const insetPolys = expandedHoles.length > 0 && shrunkOuters.length > 0
          ? core.clipperDiffPolys(shrunkOuters, expandedHoles, 1e-5)
          : shrunkOuters;
        const grouped = core.ringsToOutersWithHoles(insetPolys, 1e-5);
        if (grouped.length > 0 && grouped[0].outer.length >= 3) {
          let best = grouped[0];
          let bestA = Math.abs(_ringAreaSigned(best.outer));
          for (let gi = 1; gi < grouped.length; gi++) {
            const a = Math.abs(_ringAreaSigned(grouped[gi].outer));
            if (a > bestA) { best = grouped[gi]; bestA = a; }
          }
          const finalOuter = core.ensureWinding(best.outer, true, 4e-4);
          if (finalOuter.length >= 3 && bestA >= origA * 0.35) {
            rOuter = finalOuter;
            rHoles = (best.holes || [])
              .map(hr => core.ensureWinding(hr, false, 4e-4))
              .filter(hr => hr.length >= 3);
          }
        }
      }
    } catch (_) {}
    outer = rOuter;
    holes = rHoles;

    const zTop = zEaves + roofH;
    const zOverlapBot = zEaves - 0.04;
    const obb = _computeOBB(outer, roofDirDeg, roofOrient);
    const vMin = obb.vMin - 0.15, vMax = obb.vMax + 0.15;
    const spanV = vMax - vMin;
    const vMid = (vMin + vMax) * 0.5;

    if (roofShape === 'hipped' || roofShape === 'half-hipped' || roofShape === 'mansard') {
      const skMan = _buildStraightSkeletonRoof(core, mf, outer, holes, zEaves, roofH, roofShape);
      if (skMan) return skMan;
    }

    if (roofShape === 'gabled') {
      return _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, [
        [vMin, zOverlapBot], [vMax, zOverlapBot], [vMax, zEaves], [vMid, zTop], [vMin, zEaves]
      ]);
    }
    if (roofShape === 'saltbox') {
      const ridgeV = vMin + spanV * 0.30;
      return _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, [
        [vMin, zOverlapBot], [vMax, zOverlapBot], [vMax, zEaves], [ridgeV, zTop], [vMin, zEaves]
      ]);
    }
    if (roofShape === 'gambrel') {
      const kL = vMin + spanV * 0.22;
      const kR = vMax - spanV * 0.22;
      const zShoulder = zEaves + roofH * 0.68;
      return _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, [
        [vMin, zOverlapBot], [vMax, zOverlapBot], [vMax, zEaves],
        [kR, zShoulder], [vMid, zTop], [kL, zShoulder], [vMin, zEaves]
      ]);
    }
    if (roofShape === 'skillion') {
      return _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, [
        [vMin, zOverlapBot], [vMax, zOverlapBot], [vMax, zTop], [vMin, zEaves]
      ]);
    }
    if (roofShape === 'round') {
      const prof = [[vMin, zOverlapBot], [vMax, zOverlapBot], [vMax, zEaves]];
      const segs = 12;
      for (let i = 0; i <= segs; i++) {
        const ang = (i / segs) * Math.PI;
        const v = vMid + Math.cos(ang) * (spanV * 0.5);
        const z = zEaves + Math.sin(ang) * roofH;
        prof.push([v, z]);
      }
      prof.push([vMin, zEaves]);
      return _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, prof);
    }
    if (roofShape === 'sawtooth') {
      const nTeeth = 3;
      const prof = [[vMin, zOverlapBot], [vMax, zOverlapBot], [vMax, zEaves]];
      for (let i = nTeeth; i >= 1; i--) {
        const vt1 = vMin + (i / nTeeth) * spanV;
        const vt0 = vMin + ((i - 1) / nTeeth) * spanV;
        prof.push([vt1, zTop], [vt0, i === 1 ? zEaves : (zEaves + 0.025)]);
      }
      return _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, prof);
    }
    if (roofShape === 'butterfly') {
      return _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, [
        [vMin, zOverlapBot], [vMax, zOverlapBot], [vMax, zTop],
        [vMid, zEaves + roofH * 0.14], [vMin, zTop]
      ]);
    }
    if (roofShape === 'quadruple_saltbox') {
      const g1 = _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, [
        [vMin, zOverlapBot], [vMax, zOverlapBot], [vMax, zEaves], [vMin + spanV * 0.35, zTop], [vMin, zEaves]
      ], false);
      const uMin = obb.uMin - 0.15, uMax = obb.uMax + 0.15;
      const spanU = uMax - uMin;
      const g2 = _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, [
        [uMin, zOverlapBot], [uMax, zOverlapBot], [uMax, zEaves], [uMin + spanU * 0.35, zTop], [uMin, zEaves]
      ], true);
      if (g1 && g2) {
        const res = g1.intersect(g2);
        core.safeDeleteManifold(g1);
        core.safeDeleteManifold(g2);
        if (res && res.numTri() > 0) return res;
        core.safeDeleteManifold(res);
      } else {
        core.safeDeleteManifold(g1);
        core.safeDeleteManifold(g2);
      }
    }
    if (roofShape === 'dome' || roofShape === 'onion') {
      const dom = _buildLatheRoofClipped(core, mf, outer, holes, zEaves, roofH, roofShape === 'onion');
      if (dom) return dom;
    }
    if (roofShape === 'stepped') {
      const tiers = [];
      let curRings = core.clipperDiffPolys([outer], holes, 1e-5);
      const steps = 3;
      const inset = -Math.min(obb.spanU, obb.spanV) * 0.12;
      for (let s = 0; s < steps && curRings.length > 0; s++) {
        const z0 = zEaves - 0.02 + (s / steps) * roofH;
        const z1 = zEaves + ((s + 1) / steps) * roofH;
        const grouped = core.ringsToOutersWithHoles(curRings, 1e-5);
        for (const g of grouped) {
          const m = core.extrudeRingSolid(mf, g.outer, g.holes, z0, z1);
          if (m) tiers.push(m);
        }
        curRings = core.clipperOffsetPolys(curRings, inset, 'Miter', 1e-5);
      }
      if (tiers.length > 0) return core.batchUnionManifolds(mf, tiers);
    }

    // Cone, pyramidal, or clean fallback
    const pyr = _buildConeOrPyramidalRoof(core, mf, outer, holes, zEaves, roofH, roofShape === 'cone');
    if (pyr) return pyr;
    return _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, [
      [vMin, zOverlapBot], [vMax, zOverlapBot], [vMax, zEaves], [vMid, zTop], [vMin, zEaves]
    ]);
  }

  function _collectRawOsmTagIndex(scene) {
    const map = new Map();
    const els = (scene && scene.osmElements) || [];
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el && el.id !== undefined && el.tags) {
        map.set(el.id, el.tags);
      }
    }
    return map;
  }

  function buildLayer1S3DBBuildings(ctx, scene, terrainWater) {
    const core = _getCore();
    const { mf, halfW, halfH, toBed, scaleToBed, mToU, zScale, scaleMm, maxZUnits } = ctx;
    const rawTagById = _collectRawOsmTagIndex(scene);

    const padClip = 0.25;
    const platePoly = [[[-halfW - padClip, -halfH - padClip], [halfW + padClip, -halfH - padClip], [halfW + padClip, halfH + padClip], [-halfW - padClip, halfH + padClip]]];

    const normalGroups = new Map();   // key -> { groupId, pickId, bId, solids: [] }
    const highlightGroups = new Map();
    const boundsOut = [];
    const consumedArchBuildingIds = new Set();

    const buildingsList = (scene && scene.buildings) || [];
    const _prepMeta = buildingsList.map((b, idx) => {
      if (!b || b.hidden || b.isOutline || !b.outer || b.outer.length < 3) return null;
      const tags = Object.assign({}, rawTagById.get(b.osmId) || {}, b.tags || {});
      if (isLayer2ArchetypeRecord(b, tags)) return null;
      const areaM2 = Math.abs(_ringAreaSigned(b.outer)) / Math.max(1e-8, mToU * mToU);
      let cx = 0, cy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let k = 0; k < b.outer.length; k++) {
        const pt = b.outer[k];
        cx += pt[0]; cy += pt[1];
        if (pt[0] < minX) minX = pt[0]; if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] < minY) minY = pt[1]; if (pt[1] > maxY) maxY = pt[1];
      }
      cx /= b.outer.length; cy /= b.outer.length;
      const rawH = Number((b.h !== undefined && b.h !== null) ? b.h : (b.height !== undefined ? b.height : 9.0));
      const rawMinH = Math.max(0, Number(b.minH !== undefined ? b.minH : (tags.min_height || 0)) || 0);
      const rawRoofTag = tags['roof:shape'] || b.roof || 'flat';
      const normRoof = _normalizeRoofShape(rawRoofTag);
      return { idx, b, tags, areaM2, cx, cy, minX, maxX, minY, maxY, rawH, rawMinH, normRoof, skip: false, skipReason: null, flattened: false };
    });

    // Unify elevation datum across sibling parts in the same building relation (groupId)
    // so matching height/min_height interfaces align flush without terrain-gradient steps.
    const groupGroundedDatumById = new Map();
    const groupFallbackDatumById = new Map();
    for (let i = 0; i < _prepMeta.length; i++) {
      const m = _prepMeta[i];
      if (!m || m.b.groupId === undefined || m.b.groupId === null) continue;
      const gKey = String(m.b.groupId);
      const outer = m.b.outer;
      let minZ = Infinity, maxZ = -Infinity, sumZ = 0, cntZ = 0;
      for (let k = 0; k < outer.length; k++) {
        const px = outer[k][0], py = outer[k][1];
        const inW = terrainWater && terrainWater.isPointInWater(px, py);
        if (ctx.waterCutout && inW) continue;
        const z = (terrainWater && typeof terrainWater.getSurfaceZ === 'function')
          ? terrainWater.getSurfaceZ(px, py)
          : ctx.getTerrainZ(px, py);
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
        sumZ += z;
        cntZ++;
      }
      if (cntZ === 0) continue;
      const partDatum = (maxZ - minZ) > 1e-3 ? (sumZ / cntZ) : minZ;
      if (m.rawMinH <= 0.05) {
        const prev = groupGroundedDatumById.get(gKey);
        if (prev === undefined || partDatum > prev) groupGroundedDatumById.set(gKey, partDatum);
      } else {
        const prev = groupFallbackDatumById.get(gKey);
        if (prev === undefined || partDatum > prev) groupFallbackDatumById.set(gKey, partDatum);
      }
    }
    const groupDatumById = new Map(groupFallbackDatumById);
    for (const [gKey, val] of groupGroundedDatumById) {
      groupDatumById.set(gKey, val);
    }

    const spireRoofSet = new Set(['dome', 'onion', 'cone', 'pyramidal']);
    for (let i = 0; i < _prepMeta.length; i++) {
      const m = _prepMeta[i];
      if (!m) continue;
      for (let j = 0; j < _prepMeta.length; j++) {
        if (i === j) continue;
        const o = _prepMeta[j];
        if (!o || o.skip) continue;
        if (m.maxX < o.minX || m.minX > o.maxX || m.maxY < o.minY || m.minY > o.maxY) continue;
        const sameGroup = m.b.groupId !== undefined && m.b.groupId !== null && m.b.groupId === o.b.groupId;
        const insideOther = _ptInRing(m.cx, m.cy, o.b.outer);

        // 1. Suppress completely swallowed equal/sub-height interior building:part inside enclosing parent part
        if ((m.b.part || m.tags['building:part']) && o.areaM2 > m.areaM2 * 1.15 && insideOther &&
            m.rawMinH >= o.rawMinH - 0.5 && m.rawH <= o.rawH + 0.5 &&
            m.b.outer.every(pt => _ptInRing(pt[0], pt[1], o.b.outer))) {
          m.skip = true;
          m.skipReason = 'cluster_swallowed_interior';
          break;
        }

        // 2. Flatten spire roof buried under oversized flat superstructure (>60% area coverage at roof base)
        if (spireRoofSet.has(m.normRoof) && (sameGroup || insideOther || _ptInRing(o.cx, o.cy, m.b.outer)) &&
            o.normRoof === 'flat' && o.rawMinH >= m.rawH - 2.0 && o.rawMinH <= m.rawH + 1.5 &&
            (o.areaM2 / Math.max(1e-6, m.areaM2)) > 0.60) {
          m.flattened = true;
        }
      }
    }

    for (let i = 0; i < buildingsList.length; i++) {
      const b = buildingsList[i];
      if (!b || b.hidden || b.isOutline || !b.outer || b.outer.length < 3) continue;
      const tags = Object.assign({}, rawTagById.get(b.osmId) || {}, b.tags || {});
      if (isLayer2ArchetypeRecord(b, tags)) {
        if (b.id !== undefined) consumedArchBuildingIds.add(b.id);
        continue;
      }
      const metaP = _prepMeta[i];
      if (metaP && metaP.skip) {
        const skipEntry = {
          id: b.id !== undefined ? b.id : (i + 1),
          osmId: b.osmId || null,
          groupId: b.groupId ?? null,
          name: b.name || '',
          btype: b.btype || 'yes',
          isPart: Boolean(b.part || tags['building:part']),
          part: Boolean(b.part),
          skip: true,
          skipReason: metaP.skipReason,
          preRoofShape: metaP.normRoof,
          roofShape: metaP.normRoof,
          roof: metaP.normRoof,
          h: metaP.rawH,
          minH: metaP.rawMinH,
          zBase: metaP.rawMinH,
          zTop: metaP.rawH,
          area: metaP.areaM2,
        };
        ctx.audit.preparedList.push(skipEntry);
        continue;
      }

      const outerBed = b.outer.map(toBed);
      const holesBed = (b.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed));
      let cleanOuters = core.clipperIntersectPolys([outerBed], platePoly, 1e-5)
        .map(r => core.ensureWinding(r, true, 6e-4))
        .filter(r => r.length >= 3);
      if (cleanOuters.length === 0) continue;

      // Eliminate 1D vertex/edge pinches:
      // - Multi-part S3DB groups get a microscopic +4.5e-4 bridge overlap so corner/edge-kissing sibling parts weld into valid 2-manifolds.
      // - Standalone buildings get zero-net morphological closing (+3.5e-4 -> -3.5e-4) to fuse self-touching figure-8 corners.
      const isGroupedPart = (b.groupId !== undefined && b.groupId !== null);
      let adjOuters = cleanOuters;
      let adjHoles = holesBed.map(h => core.ensureWinding(h, true, 6e-4)).filter(h => h.length >= 3);
      try {
        if (isGroupedPart) {
          const grown = core.clipperOffsetPolys(cleanOuters, 4.5e-4, 'Miter', 1e-5)
            .map(r => core.ensureWinding(r, true, 6e-4)).filter(r => r.length >= 3);
          if (grown.length > 0) adjOuters = core.clipperIntersectPolys(grown, platePoly, 1e-5);
          if (adjHoles.length > 0) {
            adjHoles = core.clipperOffsetPolys(adjHoles, -4.5e-4, 'Miter', 1e-5)
              .map(r => core.ensureWinding(r, true, 6e-4)).filter(r => r.length >= 3);
          }
        } else {
          const grown = core.clipperOffsetPolys(cleanOuters, 3.5e-4, 'Miter', 1e-5);
          if (grown.length > 0) {
            const closed = core.clipperOffsetPolys(grown, -3.5e-4, 'Miter', 1e-5)
              .map(r => core.ensureWinding(r, true, 6e-4)).filter(r => r.length >= 3);
            if (closed.length > 0) adjOuters = core.clipperIntersectPolys(closed, platePoly, 1e-5);
          }
        }
      } catch (_) {}
      if (adjOuters.length === 0) adjOuters = cleanOuters;

      const cleanRings = adjHoles.length > 0 ? core.clipperDiffPolys(adjOuters, adjHoles, 1e-5) : adjOuters;
      const structured = core.ringsToOutersWithHoles(cleanRings, 6e-4);
      if (structured.length === 0) continue;

      const rawH_m = Number((b.h !== undefined && b.h !== null) ? b.h : (b.height !== undefined ? b.height : 9.0));
      const rawMinH_m = Math.max(0, Number(b.minH !== undefined ? b.minH : (tags.min_height || 0)) || 0);
      const hMult = (b.heightMult || 1.0) * zScale * scaleToBed;
      const totalHU = Math.max(0.4 / scaleMm, Math.max(2.0, rawH_m) * mToU * hMult);
      const minHU = rawMinH_m > 0.2 ? (rawMinH_m * mToU * hMult) : 0;

      const rawRoof = tags['roof:shape'] || b.roof || 'flat';
      const preRoofShape = _normalizeRoofShape(rawRoof);
      let roofShape = (metaP && metaP.flattened) ? 'flat' : preRoofShape;
      const flattenedUnderSuperstructure = Boolean(metaP && metaP.flattened);
      let roofH_m = Number(b.roofH !== undefined ? b.roofH : (tags['roof:height'] || 0)) || 0;
      if (roofShape !== 'flat' && roofH_m <= 0) {
        const lvl = Number(tags['roof:levels'] || 0);
        roofH_m = lvl > 0 ? lvl * 3.0 : (roofShape === 'dome' || roofShape === 'onion' || roofShape === 'pyramidal' || roofShape === 'cone' ? 5.5 : 3.4);
      }
      // Sample terrain Z under footprint perimeter + centroid so hillside buildings embed deeply with ZERO floating gaps
      let minFootZ = Infinity, maxFootZ = -Infinity, sumZ = 0, cntZ = 0;
      let touchesWaterCutout = false;
      for (const sRing of structured) {
        for (let k = 0; k < sRing.outer.length; k++) {
          const px = sRing.outer[k][0], py = sRing.outer[k][1];
          const inWater = terrainWater && terrainWater.isPointInWater(px, py);
          if (ctx.waterCutout && inWater) touchesWaterCutout = true;
          const z = (ctx.waterCutout && inWater)
            ? 0.0
            : (terrainWater && typeof terrainWater.getSurfaceZ === 'function' ? terrainWater.getSurfaceZ(px, py) : ctx.getTerrainZ(px, py));
          if (z < minFootZ) minFootZ = z;
          if (z > maxFootZ) maxFootZ = z;
          sumZ += z; cntZ++;
        }
      }
      const centerZ = cntZ > 0 ? (sumZ / cntZ) : ctx.zLandDatum;
      if (!Number.isFinite(minFootZ)) minFootZ = ctx.zLandDatum;
      if (!Number.isFinite(maxFootZ)) maxFootZ = ctx.zLandDatum;

      const embedU = touchesWaterCutout ? 0.0 : Math.min(0.45 / scaleMm, Math.max(0.18 / scaleMm, (maxFootZ - minFootZ) * 0.25));
      const zGroundSeat = touchesWaterCutout ? 0.0 : Math.max(0.15 / scaleMm, minFootZ - embedU);
      const localDatum = (maxFootZ - minFootZ) > 1e-3 ? centerZ : minFootZ;
      const grpDatumKey = (b.groupId !== undefined && b.groupId !== null) ? String(b.groupId) : null;
      const zDatum = (grpDatumKey && groupDatumById.has(grpDatumKey))
        ? Math.max(zGroundSeat, groupDatumById.get(grpDatumKey))
        : localDatum;
      const rawTopZ = zDatum + totalHU;
      const zCapRatio = (rawTopZ > maxZUnits && totalHU > 1e-6)
        ? Math.max(0.05, (maxZUnits - zDatum) / totalHU)
        : 1.0;
      const effTotalHU = totalHU * zCapRatio;
      const effMinHU = minHU * zCapRatio;
      const zTop = Math.min(maxZUnits, zDatum + effTotalHU);
      const zBase = effMinHU > 0 ? Math.max(zGroundSeat, zDatum + effMinHU - (0.04 / scaleMm)) : zGroundSeat;
      if (zTop <= zBase + (0.15 / scaleMm)) continue;

      let roofHU = roofShape !== 'flat' ? Math.max(0.20 / scaleMm, roofH_m * mToU * hMult * zCapRatio) : 0;
      const availHU = Math.max(0.2 / scaleMm, zTop - zBase);
      if (roofHU > availHU * 0.72) roofHU = availHU * 0.65;
      if (roofHU * scaleMm < 0.12) {
        roofShape = 'flat';
        roofHU = 0;
      }

      const roofDir = (b.roofDir !== undefined && b.roofDir !== null) ? Number(b.roofDir) : (tags['roof:direction'] !== undefined ? Number(tags['roof:direction']) : null);
      const roofOrient = String(b.roofOrient || tags['roof:orientation'] || 'along').toLowerCase();

      const effRoofHU = Math.min(roofHU, Math.max(0, zTop - zBase - (0.20 / scaleMm)));
      const zEaves = (roofShape !== 'flat' && effRoofHU > (0.12 / scaleMm)) ? (zTop - effRoofHU) : zTop;

      const partSolids = [];
      for (const sr of structured) {
        const wallM = core.extrudeRingSolid(mf, sr.outer, sr.holes, zBase, zEaves);
        if (wallM) partSolids.push(wallM);

        if (roofShape !== 'flat' && zTop > zEaves + 1e-4) {
          const roofM = _buildRoofManifold(core, mf, sr.outer, sr.holes, zEaves, zTop - zEaves, roofShape, roofDir, roofOrient);
          if (roofM) partSolids.push(roofM);
        }
      }

      if (partSolids.length === 0) continue;
      const bSolid = partSolids.length === 1 ? partSolids[0] : core.batchUnionManifolds(mf, partSolids);
      if (!bSolid || bSolid.numTri() === 0) {
        core.safeDeleteManifold(bSolid);
        continue;
      }

      const bId = b.id !== undefined ? b.id : (i + 1);
      const isHi = Boolean(b.highlighted);
      const grpKey = b.groupId !== undefined && b.groupId !== null ? `${isHi ? 'hg' : 'ng'}:${b.groupId}` : `${isHi ? 'hb' : 'nb'}:${bId}`;
      const bb = bSolid.boundingBox();
      const targetMap = isHi ? highlightGroups : normalGroups;
      if (!targetMap.has(grpKey)) {
        targetMap.set(grpKey, {
          groupKey: grpKey,
          isHi,
          records: [],
          hasGrounded: false,
          minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity,
        });
      }
      const grp = targetMap.get(grpKey);
      const rec = {
        b,
        bId,
        osmId: b.osmId || null,
        groupId: b.groupId ?? null,
        name: b.name || '',
        btype: b.btype || 'yes',
        isHi,
        structured,
        zGroundSeat,
        zDatum,
        zBase,
        zEaves,
        zTop,
        rawH_m,
        rawMinH_m,
        preRoofShape,
        roofShape,
        flattenedUnderSuperstructure,
        area: metaP ? metaP.areaM2 : 0,
        isPart: Boolean(b.part || tags['building:part']),
        part: Boolean(b.part),
        isElevated: effMinHU > 0 && zBase > zGroundSeat + (0.45 / scaleMm),
        solid: bSolid,
        bb,
      };
      grp.records.push(rec);
      if (!rec.isElevated) grp.hasGrounded = true;
      grp.minX = Math.min(grp.minX, bb.min[0]); grp.maxX = Math.max(grp.maxX, bb.max[0]);
      grp.minY = Math.min(grp.minY, bb.min[1]); grp.maxY = Math.max(grp.maxY, bb.max[1]);
      grp.minZ = Math.min(grp.minZ, bb.min[2]); grp.maxZ = Math.max(grp.maxZ, bb.max[2]);
    }

    // Merge elevated min_height > 0 groups (skybridges, cantilevered spheres/canopies) into XY+Z-supporting grounded clusters
    const allClusters = [...normalGroups.values(), ...highlightGroups.values()];
    const xyTouchPad = Math.max(0.15, 0.25 / scaleMm);
    const zTouchTol = 0.65 / scaleMm;
    const recordsTouch3D = (a, b) => {
      if (a.bb.max[0] < b.bb.min[0] - xyTouchPad || a.bb.min[0] > b.bb.max[0] + xyTouchPad ||
          a.bb.max[1] < b.bb.min[1] - xyTouchPad || a.bb.min[1] > b.bb.max[1] + xyTouchPad) return false;
      if (a.bb.min[2] > b.bb.max[2] + zTouchTol || a.bb.max[2] < b.bb.min[2] - zTouchTol) return false;
      // Verify actual polygon footprint intersection/proximity when available
      for (const srA of a.structured) {
        for (const srB of b.structured) {
          for (const pt of srA.outer) { if (_ptInRing(pt[0], pt[1], srB.outer)) return true; }
          for (const pt of srB.outer) { if (_ptInRing(pt[0], pt[1], srA.outer)) return true; }
          if (core.clipperIntersectPolys([srA.outer], [srB.outer], 1e-5).length > 0) return true;
        }
      }
      return true;
    };

    for (let pass = 0; pass < 2; pass++) {
      let mergedAny = false;
      for (const c of allClusters) {
        if (c.mergedOut || c.hasGrounded || c.records.length === 0) continue;
        let bestG = null;
        for (const g of allClusters) {
          if (g === c || g.mergedOut || !g.hasGrounded) continue;
          if (c.maxX < g.minX - xyTouchPad || c.minX > g.maxX + xyTouchPad ||
              c.maxY < g.minY - xyTouchPad || c.minY > g.maxY + xyTouchPad) continue;
          // Prefer matching highlight flag if one exists
          if (bestG && bestG.isHi === c.isHi && g.isHi !== c.isHi) continue;
          let touches = false;
          for (const rc of c.records) {
            for (const rg of g.records) {
              if (recordsTouch3D(rc, rg)) { touches = true; break; }
            }
            if (touches) break;
          }
          if (touches) {
            bestG = g;
            if (g.isHi === c.isHi) break;
          }
        }
        if (bestG) {
          for (const rc of c.records) {
            bestG.records.push(rc);
            bestG.minX = Math.min(bestG.minX, rc.bb.min[0]); bestG.maxX = Math.max(bestG.maxX, rc.bb.max[0]);
            bestG.minY = Math.min(bestG.minY, rc.bb.min[1]); bestG.maxY = Math.max(bestG.maxY, rc.bb.max[1]);
            bestG.minZ = Math.min(bestG.minZ, rc.bb.min[2]); bestG.maxZ = Math.max(bestG.maxZ, rc.bb.max[2]);
          }
          c.mergedOut = true;
          mergedAny = true;
        }
      }
      if (!mergedAny) break;
    }

    // Anchor any genuinely isolated unattached min_height slab with no supporting towers/shafts down to terrain seat
    for (const c of allClusters) {
      if (c.mergedOut || c.hasGrounded || c.records.length === 0) continue;
      const r0 = c.records[0];
      if (r0.structured.length > 0) {
        const sr0 = r0.structured[0];
        const anchor = core.extrudeRingSolid(mf, sr0.outer, sr0.holes, r0.zGroundSeat, r0.zBase + (0.08 / scaleMm));
        if (anchor) {
          const fused = r0.solid.add(anchor);
          core.safeDeleteManifold(anchor);
          if (fused && fused.numTri() > 0) {
            core.safeDeleteManifold(r0.solid);
            r0.solid = fused;
            r0.bb = fused.boundingBox();
          } else {
            core.safeDeleteManifold(fused);
          }
        }
      }
      c.hasGrounded = true;
    }

    const emitClusterGroup = (isHiFlag) => {
      const out = [];
      for (const c of allClusters) {
        if (c.mergedOut || c.isHi !== isHiFlag || c.records.length === 0) continue;
        // Prefer grounded primary record for canonical pick metadata
        const primary = c.records.find(r => !r.isElevated) || c.records[0];
        const grpMembers = c.records.map(r => ({ id: r.bId, osmId: r.osmId }));
        const pickId = ctx.allocPickId({
          id: primary.bId,
          buildingId: primary.bId,
          groupId: primary.groupId,
          osmId: primary.osmId,
          name: primary.name,
          btype: primary.btype,
          roof: primary.roofShape,
          heightM: primary.rawH_m,
          highlighted: isHiFlag,
          buildings: grpMembers,
        });

        const solids = c.records.map(r => r.solid);
        const merged = solids.length === 1 ? solids[0] : core.batchUnionManifolds(mf, solids);
        if (!merged || merged.numTri() === 0) {
          core.safeDeleteManifold(merged);
          continue;
        }
        const mbb = merged.boundingBox();
        out.push({ buildingId: pickId, sourceBuildingId: primary.bId, manifold: merged, isFloatingPart: false });

        for (const r of c.records) {
          const rCx = (r.bb.min[0] + r.bb.max[0]) * 0.5;
          const rCy = (r.bb.min[1] + r.bb.max[1]) * 0.5;
          boundsOut.push({
            id: r.bId,
            osmId: r.osmId,
            name: r.name,
            minX: r.bb.min[0], minY: r.bb.min[1], minZ: mbb.min[2],
            maxX: r.bb.max[0], maxY: r.bb.max[1], maxZ: r.bb.max[2],
            cx: rCx,
            cy: rCy,
            interiorPt: [rCx, rCy],
            roof: r.roofShape,
            minH: r.rawMinH_m,
            h: r.rawH_m,
          });

          const auditEntry = {
            id: r.bId,
            osmId: r.osmId,
            groupId: r.groupId,
            pickId,
            name: r.name,
            btype: r.btype,
            tZ: r.zDatum,
            preRoofShape: r.preRoofShape,
            roofShape: r.roofShape,
            roof: r.roofShape,
            flattenedUnderSuperstructure: r.flattenedUnderSuperstructure,
            skip: false,
            h: r.rawH_m,
            minH: r.rawMinH_m,
            zBase: r.zBase,
            zEaves: r.zEaves,
            zRidge: r.zTop,
            zTop: r.zTop,
            area: r.area,
            isPart: r.isPart,
            part: r.part,
            highlighted: isHiFlag,
          };
          ctx.audit.preparedList.push(auditEntry);
          ctx.audit.s3dbAllFinalBuildings.push(auditEntry);
        }
      }
      return out;
    };

    const buildingManifolds = emitClusterGroup(false);
    const highlightedManifolds = emitClusterGroup(true);

    return {
      buildingManifolds,
      highlightedManifolds,
      buildingBounds: boundsOut,
      consumedArchBuildingIds,
      count: buildingManifolds.length + highlightedManifolds.length,
    };
  }

  const exportsObj = {
    buildLayer1S3DBBuildings,
    isLayer2ArchetypeRecord,
    _normalizeRoofShape,
    _buildRoofManifold,
  };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
