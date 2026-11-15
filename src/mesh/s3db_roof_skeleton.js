// ============================================================================
// src/mesh/s3db_roof_skeleton.js
// Straight-Skeleton, Courtyard-CSG & Multi-Slope S3DB Roof Builders
// ============================================================================

if (typeof _computeOBB === 'undefined' && typeof require !== 'undefined') {
  try { Object.assign(global, require('./s3db_roof_revolve.js')); } catch (_) {}
}

function _buildStraightSkeletonRoof(core, mf, outer, holes, zEaves, roofH, mode = 'hipped') {
  const { StraightSkeleton: ss, earcut } = core.getVendorDeps();
  if (!ss || !ss.SkeletonBuilder || !earcut) return null;

  const ccwOuter = core.ensureWinding(outer, true, 1e-4);
  if (ccwOuter.length < 3) return null;
  const rings = [ccwOuter.slice()];
  const cleanHoles = [];
  for (const h of (holes || [])) {
    const cwHole = core.ensureWinding(h, false, 1e-4);
    if (cwHole.length >= 3) { rings.push(cwHole.slice()); cleanHoles.push(cwHole); }
  }

  let sk = null;
  try { sk = ss.SkeletonBuilder.BuildFromGeoJSON([rings]); } catch (_) { return null; }
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
    return zEaves + norm * roofH;
  };

  const pos = [], tris = [], vertIndex = new Map();
  const addV = (x, y, z) => {
    const k = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
    let idx = vertIndex.get(k);
    if (idx === undefined) { idx = pos.length / 3; pos.push(x, y, z); vertIndex.set(k, idx); }
    return idx;
  };

  for (let ei = 0; ei < sk.Edges.length; ei++) {
    const poly = sk.Edges[ei].Polygon;
    if (!poly || poly.length < 3) continue;
    const flat2D = [], vIds = [];
    for (let j = 0; j < poly.length; j++) {
      const pt = poly[j];
      flat2D.push(pt.X, pt.Y);
      vIds.push(addV(pt.X, pt.Y, getZ(pt)));
    }
    const ecTris = earcut(flat2D, null, 2);
    for (let t = 0; t < ecTris.length; t += 3) {
      const ia = vIds[ecTris[t]], ib = vIds[ecTris[t + 1]], ic = vIds[ecTris[t + 2]];
      if (ia === ib || ib === ic || ic === ia) continue;
      const nz = (pos[ib * 3] - pos[ia * 3]) * (pos[ic * 3 + 1] - pos[ia * 3 + 1]) - (pos[ib * 3 + 1] - pos[ia * 3 + 1]) * (pos[ic * 3] - pos[ia * 3]);
      if (Math.abs(nz) < 1e-10) continue;
      if (nz > 0) tris.push(ia, ib, ic); else tris.push(ia, ic, ib);
    }
  }

  const zBot = zEaves - 0.04;
  for (const ring of [ccwOuter, ...cleanHoles]) {
    const topIds = ring.map(p => addV(p[0], p[1], zEaves));
    const botIdsRing = ring.map(p => addV(p[0], p[1], zBot));
    for (let i = 0; i < ring.length; i++) {
      const nxt = (i + 1) % ring.length;
      tris.push(botIdsRing[i], botIdsRing[nxt], topIds[nxt], botIdsRing[i], topIds[nxt], topIds[i]);
    }
  }

  const botFlat = [], holeStarts = [], botIds = [];
  for (const p of ccwOuter) { botFlat.push(p[0], p[1]); botIds.push(addV(p[0], p[1], zBot)); }
  for (const hr of cleanHoles) {
    holeStarts.push(botFlat.length / 2);
    for (const p of hr) { botFlat.push(p[0], p[1]); botIds.push(addV(p[0], p[1], zBot)); }
  }
  const botEc = earcut(botFlat, holeStarts.length > 0 ? holeStarts : null, 2);
  for (let t = 0; t < botEc.length; t += 3) {
    const ia = botIds[botEc[t]], ib = botIds[botEc[t + 1]], ic = botIds[botEc[t + 2]];
    if (ia === ib || ib === ic || ic === ia) continue;
    const nz = (pos[ib * 3] - pos[ia * 3]) * (pos[ic * 3 + 1] - pos[ia * 3 + 1]) - (pos[ib * 3 + 1] - pos[ia * 3 + 1]) * (pos[ic * 3] - pos[ia * 3]);
    if (Math.abs(nz) < 1e-10) continue;
    if (nz < 0) tris.push(ia, ib, ic); else tris.push(ia, ic, ib);
  }

  const raw = core.manifoldFromRawSoup(mf, new Float32Array(pos), new Uint32Array(tris), 1e-5);
  if (!raw || raw.numTri() === 0) return raw;
  if (cleanHoles.length > 0) {
    let cutter = null;
    try {
      cutter = core.extrudeRingSolid(mf, ccwOuter, cleanHoles, zBot - 0.06, zEaves + roofH + 0.5);
      if (cutter) {
        const clipped = raw.intersect(cutter);
        if (clipped && clipped.numTri() > 0) { core.safeDeleteManifold(raw); return clipped; }
        core.safeDeleteManifold(clipped);
      }
    } catch (_) {}
    finally { core.safeDeleteManifold(cutter); }
  }
  return raw;
}

function _buildConeOrPyramidalRoof(core, mf, outer, holes, zEaves, roofH, isCone = false, rotDeg = 0) {
  const obb = _computeOBB(outer, null, 'along', rotDeg);
  const zTop = zEaves + roofH, zBot = zEaves - 0.04;
  if (isCone) {
    const isApproxCirc = holes.length === 0 && outer.length >= 12 && Math.abs(obb.spanU - obb.spanV) <= Math.max(obb.spanU, obb.spanV) * 0.14;
    const rBase = Math.max(0.2, (isApproxCirc ? Math.min(obb.spanU, obb.spanV) : Math.hypot(obb.spanU, obb.spanV)) * 0.52);
    let cone = null, moved = null, cutter = null;
    try {
      cone = mf.Manifold.cylinder(roofH + 0.05, rBase, 0.001, isApproxCirc ? Math.min(32, Math.max(16, outer.length)) : 24, false);
      moved = cone.translate([obb.cx, obb.cy, zBot]); cone.delete(); cone = null;
      if (isApproxCirc) return moved;
      cutter = core.extrudeRingSolid(mf, outer, holes, zBot - 0.05, zTop + 0.5);
      const res = cutter ? moved.intersect(cutter) : moved;
      if (cutter && res && res.numTri() > 0) { moved.delete(); return res; }
      core.safeDeleteManifold(res);
      return moved;
    } catch (_) { core.safeDeleteManifold(moved); core.safeDeleteManifold(cone); return null; }
    finally { core.safeDeleteManifold(cutter); }
  }
  if (holes.length > 0) return _buildStraightSkeletonRoof(core, mf, outer, holes, zEaves, roofH, 'hipped');
  const { earcut } = core.getVendorDeps();
  const ccw = core.ensureWinding(outer, true, 1e-4);
  if (ccw.length < 3) return null;
  const n = ccw.length, pos = [], tris = [], flat = [];
  for (const p of ccw) { pos.push(p[0], p[1], zEaves); flat.push(p[0], p[1]); }
  for (const p of ccw) pos.push(p[0], p[1], zBot);
  const apexIdx = 2 * n;
  pos.push(obb.cx, obb.cy, zTop);
  for (let i = 0; i < n; i++) {
    const nxt = (i + 1) % n;
    tris.push(i, nxt, apexIdx, n + i, n + nxt, nxt, n + i, nxt, i);
  }
  if (earcut) {
    const bot = earcut(flat, null, 2);
    for (let t = 0; t < bot.length; t += 3) tris.push(n + bot[t], n + bot[t + 2], n + bot[t + 1]);
  } else {
    const botC = 2 * n + 1;
    pos.push(obb.cx, obb.cy, zBot);
    for (let i = 0; i < n; i++) tris.push(botC, n + ((i + 1) % n), n + i);
  }
  return core.manifoldFromRawSoup(mf, new Float32Array(pos), new Uint32Array(tris), 1e-5);
}

function buildSkeletonOrPolyRoof(core, mf, outer, holes, zEaves, roofH, roofShape, roofDirDeg, roofOrient, rotDeg = 0) {
  const obb = _computeOBB(outer, roofDirDeg, roofOrient, rotDeg);
  const zTop = zEaves + roofH, zBot = zEaves - 0.04;
  const vMin = obb.vMin - 0.15, vMax = obb.vMax + 0.15, spanV = vMax - vMin, vMid = (vMin + vMax) * 0.5;
  const uMin = obb.uMin - 0.15, uMax = obb.uMax + 0.15, spanU = uMax - uMin;

  if (roofShape === 'hipped' || roofShape === 'mansard') {
    const skMan = _buildStraightSkeletonRoof(core, mf, outer, holes, zEaves, roofH, roofShape);
    if (skMan) return skMan;
  }
  if (roofShape === 'half-hipped' || roofShape === 'side_hipped') {
    const gV = _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, [[vMin, zBot], [vMax, zBot], [vMax, zEaves], [vMid, zTop], [vMin, zEaves]], false);
    const profU = roofShape === 'half-hipped'
      ? [[uMin, zBot], [uMax, zBot], [uMax, zEaves + roofH * 0.42], [uMax - spanU * 0.22, zTop], [uMin + spanU * 0.22, zTop], [uMin, zEaves + roofH * 0.42]]
      : [[uMin, zBot], [uMax, zBot], [uMax, zTop], [uMin + spanU * 0.30, zTop], [uMin, zEaves]];
    const gU = _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, profU, true);
    if (gV && gU) {
      const res = gV.intersect(gU); core.safeDeleteManifold(gV); core.safeDeleteManifold(gU);
      if (res && res.numTri() > 0) return res;
      core.safeDeleteManifold(res);
    } else { core.safeDeleteManifold(gV); core.safeDeleteManifold(gU); }
    const skFb = _buildStraightSkeletonRoof(core, mf, outer, holes, zEaves, roofH, 'hipped');
    if (skFb) return skFb;
  }
  if (roofShape === 'gabled') {
    return _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, [[vMin, zBot], [vMax, zBot], [vMax, zEaves], [vMid, zTop], [vMin, zEaves]]);
  }
  if (roofShape === 'gambrel') {
    const zSh = zEaves + roofH * 0.68;
    return _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, [
      [vMin, zBot], [vMax, zBot], [vMax, zEaves], [vMax - spanV * 0.22, zSh], [vMid, zTop], [vMin + spanV * 0.22, zSh], [vMin, zEaves],
    ]);
  }
  if (roofShape === 'quadruple_saltbox') {
    const g1 = _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, [[vMin, zBot], [vMax, zBot], [vMax, zEaves], [vMin + spanV * 0.35, zTop], [vMin, zEaves]], false);
    const g2 = _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, [[uMin, zBot], [uMax, zBot], [uMax, zEaves], [uMin + spanU * 0.35, zTop], [uMin, zEaves]], true);
    if (g1 && g2) {
      const res = g1.intersect(g2); core.safeDeleteManifold(g1); core.safeDeleteManifold(g2);
      if (res && res.numTri() > 0) return res;
      core.safeDeleteManifold(res);
    } else { core.safeDeleteManifold(g1); core.safeDeleteManifold(g2); }
  }
  return _buildConeOrPyramidalRoof(core, mf, outer, holes, zEaves, roofH, roofShape === 'cone', rotDeg)
    || _extrudeProfileRoofClipped(core, mf, outer, holes, zEaves, zTop, obb, [[vMin, zBot], [vMax, zBot], [vMax, zEaves], [vMid, zTop], [vMin, zEaves]]);
}

const _s3dbSkeletonExports = { _buildStraightSkeletonRoof, _buildConeOrPyramidalRoof, buildSkeletonOrPolyRoof };
if (typeof window !== 'undefined') Object.assign(window, _s3dbSkeletonExports);
if (typeof module !== 'undefined' && module.exports) module.exports = _s3dbSkeletonExports;
