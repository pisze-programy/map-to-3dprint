// ============================================================================
// src/mesh_extrude.js
// 3D Mesh Primitive Emitters, Watertight 2-Manifold LoD2 Building Extrusion,
// 3D Canopy Tree Crowns, Exact 3D Planar Mesh Clipper & Marching-Squares Clipper
// ============================================================================

if (typeof cleanPolygonRing === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./geometry_2d.js'));
}

function pushTri(out, v0, v1, v2, n, layerId, buildingId = -1, tileId = 0) {
  out.push({ v0, v1, v2, n, layerId, buildingId, tileId });
}

function pushQuad(out, p0, p1, p2, p3, n, layerId, buildingId = -1, tileId = 0) {
  out.push({ v0: p0, v1: p1, v2: p2, n, layerId, buildingId, tileId });
  out.push({ v0: p0, v1: p2, v2: p3, n, layerId, buildingId, tileId });
}

function computeFaceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function isDegenerateTri3D(a, b, c) {
  const d01 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const d12 = (b[0] - c[0]) ** 2 + (b[1] - c[1]) ** 2 + (b[2] - c[2]) ** 2;
  const d20 = (c[0] - a[0]) ** 2 + (c[1] - a[1]) ** 2 + (c[2] - a[2]) ** 2;
  if (d01 < 1e-16 || d12 < 1e-16 || d20 < 1e-16) return true;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return (cx * cx + cy * cy + cz * cz) < 1e-24;
}

// Subdivides interior edges only (never touches boundary edges so roof matches walls 1-to-1 with 0 open edges)
function subdivideInteriorRoofEdges(tris, outerClean, holesClean) {
  const ptKey = p => p[0].toFixed(4) + '_' + p[1].toFixed(4);
  const edgeKey = (a, b) => {
    const ka = ptKey(a), kb = ptKey(b);
    return ka < kb ? ka + '|' + kb : kb + '|' + ka;
  };

  const edgeMap = new Map();
  for (let i = 0; i < tris.length; i++) {
    const tri = tris[i];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const ek = edgeKey(a, b);
      if (!edgeMap.has(ek)) {
        const mid = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
        const dist = distToPolygonBoundary2D(mid[0], mid[1], outerClean, holesClean);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const shouldSplit = (dist > 1e-3 && len > 0.05);
        edgeMap.set(ek, { shouldSplit, mid: shouldSplit ? mid : null });
      }
    }
  }

  const nextTris = [];
  for (let i = 0; i < tris.length; i++) {
    const [v0, v1, v2] = tris[i];
    const e0 = edgeMap.get(edgeKey(v0, v1));
    const e1 = edgeMap.get(edgeKey(v1, v2));
    const e2 = edgeMap.get(edgeKey(v2, v0));

    const s0 = e0 && e0.shouldSplit;
    const s1 = e1 && e1.shouldSplit;
    const s2 = e2 && e2.shouldSplit;

    const m0 = s0 ? e0.mid : null;
    const m1 = s1 ? e1.mid : null;
    const m2 = s2 ? e2.mid : null;

    const count = (s0 ? 1 : 0) + (s1 ? 1 : 0) + (s2 ? 1 : 0);
    if (count === 0) {
      nextTris.push([v0, v1, v2]);
    } else if (count === 1) {
      if (s0) {
        nextTris.push([v0, m0, v2], [m0, v1, v2]);
      } else if (s1) {
        nextTris.push([v1, m1, v0], [m1, v2, v0]);
      } else {
        nextTris.push([v2, m2, v1], [m2, v0, v1]);
      }
    } else if (count === 2) {
      if (!s0) {
        nextTris.push([v1, m1, v0], [m1, m2, v0], [m1, v2, m2]);
      } else if (!s1) {
        nextTris.push([v2, m2, v1], [m2, m0, v1], [m2, v0, m0]);
      } else {
        nextTris.push([v0, m0, v2], [m0, m1, v2], [m0, v1, m1]);
      }
    } else {
      nextTris.push(
        [v0, m0, m2],
        [m0, v1, m1],
        [m1, v2, m2],
        [m0, m1, m2]
      );
    }
  }
  return nextTris;
}

// Watertight 2-Manifold LoD2 Building Extrusion:
// - Outer walls extruded directly from outerRing (CCW, outward normals)
// - Courtyard walls extruded directly from each hole in holeRings (CW, inward courtyard normals)
// - Zero internal slit walls across courtyards!
// - Watertight bottom floor cap at zBase (normal [0, 0, -1])
// - Realistic architectural roofs: flat, skillion, pyramidal/cone, dome/onion, hipped/gabled/mansard
function extrudeBuildingLoD2(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9, arg10) {
  let outerInput, holesInput, zBase, zEaves, zRidge, hasPitchedRoof, layerId, bId, outTris, tileId, roofShape;

  if (Array.isArray(arg0) && Array.isArray(arg1) && typeof arg3 === 'number' && typeof arg4 === 'number' && typeof arg5 === 'number') {
    // Signature: (targetArr, outerRing, holeRings, zBase, zEaves, zTop, roofShape, colorHex, tileId, groupId)
    outTris = arg0;
    outerInput = arg1;
    holesInput = arg2;
    zBase = arg3;
    zEaves = arg4;
    zRidge = arg5;
    roofShape = typeof arg6 === 'string' ? arg6 : 'hipped';
    hasPitchedRoof = (zRidge > zEaves + 1e-4) && (roofShape !== 'flat');
    layerId = 4;
    tileId = typeof arg8 === 'number' ? arg8 : 0;
    bId = typeof arg9 === 'number' ? arg9 : -1;
  } else {
    // Standard signature: (outerInput, holesInput, zBase, zEaves, zRidge, hasPitchedRoof, layerId, bId, outTris, tileId, roofShape)
    outerInput = arg0;
    holesInput = arg1;
    zBase = arg2;
    zEaves = arg3;
    zRidge = arg4;
    hasPitchedRoof = arg5;
    layerId = arg6;
    bId = arg7;
    outTris = arg8;
    tileId = arg9 ?? 0;
    roofShape = arg10 ?? 'hipped';
  }

  const outerClean = cleanPolygonRing(outerInput, true);
  if (outerClean.length < 3) return;

  const holesClean = (holesInput || [])
    .map(h => cleanPolygonRing(h, false))
    .filter(h => h.length >= 3);

  // Sanitize courtyard holes: ensure each hole is contained within outerClean.
  // When outerClean has been inset (e.g. by 0.012), hole boundaries may slightly protrude outside outerClean.
  for (let h = 0; h < holesClean.length; h++) {
    let hole = holesClean[h];
    const allInside = hole.every(p => pointInPolyOrNear2D(p[0], p[1], outerClean, 1e-4));
    if (!allInside) {
      for (const amount of [0.015, 0.025, 0.04, 0.08]) {
        const hTry = insetPolygonCentroid(hole, amount);
        if (hTry.length >= 3 && hTry.every(p => pointInPoly2D(p[0], p[1], outerClean))) {
          holesClean[h] = hTry;
          break;
        }
      }
    }
  }

  // Merge courtyard holes via non-intersecting keyhole slit so floor and roof share 1 single simple ring
  let ring = holesClean.length > 0 ? mergeHolesIntoOuterKeyhole(outerClean, holesClean) : outerClean;
  if (ring.length < 3) return;
  if (!isSimplePolygon(ring)) {
    ring = outerClean;
    if (!isSimplePolygon(ring)) return;
  }

  const actualHoles = (ring === outerClean) ? [] : holesClean;

  const roofTris = triangulateSimplePoly(ring);
  if (roofTris.length === 0) return;

  const roofH = Math.max(0, zRidge - zEaves);
  const canPitch = hasPitchedRoof && roofH > 0.05 && ring.length >= 3;

  // 1. Vertical walls:
  // Extrude outer walls directly from outerClean (CCW outward normals)
  // Extrude courtyard walls directly from holesClean (CW inward normals facing into courtyards)
  // NEVER extrude vertical walls along keyhole bridge slits!
  if (canPitch && roofShape === 'skillion') {
    // Skillion roof: compute dominant facade vector from longest edge of outerClean
    let maxEdgeLen = 0, bestEdge = [1, 0];
    for (let i = 0; i < outerClean.length; i++) {
      const p1 = outerClean[i], p2 = outerClean[(i + 1) % outerClean.length];
      const elen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (elen > maxEdgeLen) {
        maxEdgeLen = elen;
        bestEdge = [(p2[0] - p1[0]) / elen, (p2[1] - p1[1]) / elen];
      }
    }
    const perpX = -bestEdge[1], perpY = bestEdge[0];
    let vMin = Infinity, vMax = -Infinity;
    for (let i = 0; i < outerClean.length; i++) {
      const vVal = outerClean[i][0] * perpX + outerClean[i][1] * perpY;
      if (vVal < vMin) vMin = vVal;
      if (vVal > vMax) vMax = vVal;
    }
    const vSpan = vMax - vMin;

    function zRoofSkillion(x, y) {
      if (vSpan < 1e-4) return zEaves;
      const t = Math.max(0, Math.min(1, ((x * perpX + y * perpY) - vMin) / vSpan));
      return zEaves + t * roofH;
    }

    // Outer walls rising to zRoofSkillion
    for (let i = 0, n = outerClean.length; i < n; i++) {
      const p1 = outerClean[i], p2 = outerClean[(i + 1) % n];
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-5) continue;
      const nx = dy / len, ny = -dx / len;
      const z1 = zRoofSkillion(p1[0], p1[1]);
      const z2 = zRoofSkillion(p2[0], p2[1]);
      pushQuad(
        outTris,
        [p1[0], p1[1], zBase],
        [p2[0], p2[1], zBase],
        [p2[0], p2[1], z2],
        [p1[0], p1[1], z1],
        [nx, ny, 0],
        layerId,
        bId,
        tileId
      );
    }
    // Courtyard walls rising to zRoofSkillion
    for (let h = 0; h < actualHoles.length; h++) {
      const hole = actualHoles[h];
      for (let i = 0, n = hole.length; i < n; i++) {
        const p1 = hole[i], p2 = hole[(i + 1) % n];
        const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
        const len = Math.hypot(dx, dy);
        if (len < 1e-5) continue;
        const nx = dy / len, ny = -dx / len;
        const z1 = zRoofSkillion(p1[0], p1[1]);
        const z2 = zRoofSkillion(p2[0], p2[1]);
        pushQuad(
          outTris,
          [p1[0], p1[1], zBase],
          [p2[0], p2[1], zBase],
          [p2[0], p2[1], z2],
          [p1[0], p1[1], z1],
          [nx, ny, 0],
          layerId,
          bId,
          tileId
        );
      }
    }
  } else {
    // Standard horizontal wall top at zEaves
    for (let i = 0, n = outerClean.length; i < n; i++) {
      const p1 = outerClean[i], p2 = outerClean[(i + 1) % n];
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-5) continue;
      const nx = dy / len, ny = -dx / len;
      pushQuad(
        outTris,
        [p1[0], p1[1], zBase],
        [p2[0], p2[1], zBase],
        [p2[0], p2[1], zEaves],
        [p1[0], p1[1], zEaves],
        [nx, ny, 0],
        layerId,
        bId,
        tileId
      );
    }
    for (let h = 0; h < actualHoles.length; h++) {
      const hole = actualHoles[h];
      for (let i = 0, n = hole.length; i < n; i++) {
        const p1 = hole[i], p2 = hole[(i + 1) % n];
        const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
        const len = Math.hypot(dx, dy);
        if (len < 1e-5) continue;
        const nx = dy / len, ny = -dx / len;
        pushQuad(
          outTris,
          [p1[0], p1[1], zBase],
          [p2[0], p2[1], zBase],
          [p2[0], p2[1], zEaves],
          [p1[0], p1[1], zEaves],
          [nx, ny, 0],
          layerId,
          bId,
          tileId
        );
      }
    }
  }

  // 2. Watertight Bottom Floor Cap at zBase (reversed winding, normal [0, 0, -1])
  for (let i = 0; i < roofTris.length; i++) {
    const [a, b, c] = roofTris[i];
    pushTri(
      outTris,
      [a[0], a[1], zBase],
      [c[0], c[1], zBase],
      [b[0], b[1], zBase],
      [0, 0, -1],
      layerId,
      bId,
      tileId
    );
  }

  // 3. Watertight Top Roof Cap at zEaves / zRidge
  if (canPitch && roofShape === 'skillion') {
    // Dominant facade skillion top cap
    let maxEdgeLen = 0, bestEdge = [1, 0];
    for (let i = 0; i < outerClean.length; i++) {
      const p1 = outerClean[i], p2 = outerClean[(i + 1) % outerClean.length];
      const elen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (elen > maxEdgeLen) {
        maxEdgeLen = elen;
        bestEdge = [(p2[0] - p1[0]) / elen, (p2[1] - p1[1]) / elen];
      }
    }
    const perpX = -bestEdge[1], perpY = bestEdge[0];
    let vMin = Infinity, vMax = -Infinity;
    for (let i = 0; i < outerClean.length; i++) {
      const vVal = outerClean[i][0] * perpX + outerClean[i][1] * perpY;
      if (vVal < vMin) vMin = vVal;
      if (vVal > vMax) vMax = vVal;
    }
    const vSpan = vMax - vMin;

    function zRoofSk(x, y) {
      if (vSpan < 1e-4) return zEaves;
      const t = Math.max(0, Math.min(1, ((x * perpX + y * perpY) - vMin) / vSpan));
      return zEaves + t * roofH;
    }

    for (let i = 0; i < roofTris.length; i++) {
      const [a, b, c] = roofTris[i];
      const A = [a[0], a[1], zRoofSk(a[0], a[1])];
      const B = [b[0], b[1], zRoofSk(b[0], b[1])];
      const C = [c[0], c[1], zRoofSk(c[0], c[1])];
      pushTri(outTris, A, B, C, computeFaceNormal(A, B, C), layerId, bId, tileId);
    }
  } else if (canPitch && holesClean.length === 0 && (roofShape === 'pyramidal' || roofShape === 'cone') && (isConvexPoly(outerClean) || outerClean.length <= 8)) {
    // Single apex pyramidal/cone cap for convex or simple polygons without holes
    let cx = 0, cy = 0;
    for (let i = 0; i < outerClean.length; i++) {
      cx += outerClean[i][0];
      cy += outerClean[i][1];
    }
    cx /= outerClean.length;
    cy /= outerClean.length;
    const apex = [cx, cy, zRidge];
    for (let i = 0, n = outerClean.length; i < n; i++) {
      const a = [outerClean[i][0], outerClean[i][1], zEaves];
      const b = [outerClean[(i + 1) % n][0], outerClean[(i + 1) % n][1], zEaves];
      pushTri(outTris, a, b, apex, computeFaceNormal(a, b, apex), layerId, bId, tileId);
    }
  } else if (canPitch && holesClean.length === 0 && (roofShape === 'dome' || roofShape === 'onion') && (isConvexPoly(outerClean) || outerClean.length <= 24)) {
    // Clean 3-band hemispherical dome cap converging smoothly to apex (0 open edges)
    let cx = 0, cy = 0;
    for (let i = 0; i < outerClean.length; i++) {
      cx += outerClean[i][0];
      cy += outerClean[i][1];
    }
    cx /= outerClean.length;
    cy /= outerClean.length;

    const n = outerClean.length;
    const bands = [
      outerClean.map(p => [p[0], p[1], zEaves]),
      outerClean.map(p => [cx + (p[0] - cx) * 0.866, cy + (p[1] - cy) * 0.866, zEaves + roofH * 0.5]),
      outerClean.map(p => [cx + (p[0] - cx) * 0.500, cy + (p[1] - cy) * 0.500, zEaves + roofH * 0.866])
    ];
    const apex = [cx, cy, zRidge];

    for (let b = 0; b < 2; b++) {
      const bLo = bands[b], bHi = bands[b + 1];
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        pushQuad(outTris, bLo[i], bLo[next], bHi[next], bHi[i], computeFaceNormal(bLo[i], bLo[next], bHi[next]), layerId, bId, tileId);
      }
    }
    const topBand = bands[2];
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      pushTri(outTris, topBand[i], topBand[next], apex, computeFaceNormal(topBand[i], topBand[next], apex), layerId, bId, tileId);
    }
  } else if (canPitch && holesClean.length === 0 && outerClean.length === 4 && isConvexPoly(outerClean) && roofShape !== 'pyramidal' && roofShape !== 'dome') {
    // True 4-slope Hipped / Gabled Roof along longer quad axis (100% manifold)
    const p0 = outerClean[0], p1 = outerClean[1], p2 = outerClean[2], p3 = outerClean[3];
    const len01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
    const len12 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p0[0] - p3[0], p0[1] - p3[1]);
    const q = (len01 >= len12) ? [p0, p1, p2, p3] : [p1, p2, p3, p0];

    const mA = [(q[0][0] + q[3][0]) * 0.5, (q[0][1] + q[3][1]) * 0.5];
    const mB = [(q[1][0] + q[2][0]) * 0.5, (q[1][1] + q[2][1]) * 0.5];
    const cx = (mA[0] + mB[0]) * 0.5, cy = (mA[1] + mB[1]) * 0.5;
    const ridgeFactor = (roofShape === 'gabled') ? 0.95 : 0.45;
    const R0 = [cx + (mA[0] - cx) * ridgeFactor, cy + (mA[1] - cy) * ridgeFactor, zRidge];
    const R1 = [cx + (mB[0] - cx) * ridgeFactor, cy + (mB[1] - cy) * ridgeFactor, zRidge];

    const Q0 = [q[0][0], q[0][1], zEaves];
    const Q1 = [q[1][0], q[1][1], zEaves];
    const Q2 = [q[2][0], q[2][1], zEaves];
    const Q3 = [q[3][0], q[3][1], zEaves];

    pushTri(outTris, Q3, Q0, R0, computeFaceNormal(Q3, Q0, R0), layerId, bId, tileId);
    pushQuad(outTris, Q0, Q1, R1, R0, computeFaceNormal(Q0, Q1, R1), layerId, bId, tileId);
    pushTri(outTris, Q1, Q2, R1, computeFaceNormal(Q1, Q2, R1), layerId, bId, tileId);
    pushQuad(outTris, Q2, Q3, R0, R1, computeFaceNormal(Q2, Q3, R0), layerId, bId, tileId);
  } else if (canPitch) {
    // General / non-convex / courtyard pitched roof:
    // Interior-only edge midpoint subdivision with distance-to-boundary lifting
    // 0 spikes, 0 open edges, smooth architectural hipped ridges even around courtyards!
    const ptKey = p => p[0].toFixed(4) + '_' + p[1].toFixed(4);
    const edgeKey = (a, b) => {
      const ka = ptKey(a), kb = ptKey(b);
      return ka < kb ? ka + '|' + kb : kb + '|' + ka;
    };

    let subTris = roofTris;
    for (let pass = 0; pass < 2; pass++) {
      subTris = subdivideInteriorRoofEdges(subTris, outerClean, actualHoles);
    }

    let maxDist = 0;
    for (let i = 0; i < subTris.length; i++) {
      for (let j = 0; j < 3; j++) {
        const v = subTris[i][j];
        const d = distToPolygonBoundary2D(v[0], v[1], outerClean, actualHoles);
        if (d > maxDist) maxDist = d;
      }
    }

    function getRoofZ(pt) {
      const d = distToPolygonBoundary2D(pt[0], pt[1], outerClean, actualHoles);
      if (d < 1e-4 || maxDist < 1e-4) return zEaves;
      const t = Math.min(1.0, d / maxDist);
      const profile = (roofShape === 'mansard' || roofShape === 'gambrel')
        ? Math.min(1.0, Math.pow(t, 0.65))
        : t;
      return zEaves + profile * roofH;
    }

    for (let i = 0; i < subTris.length; i++) {
      const [a, b, c] = subTris[i];
      const A = [a[0], a[1], getRoofZ(a)];
      const B = [b[0], b[1], getRoofZ(b)];
      const C = [c[0], c[1], getRoofZ(c)];
      const n = computeFaceNormal(A, B, C);
      if (n[2] < 0) {
        pushTri(outTris, A, C, B, [-n[0], -n[1], -n[2]], layerId, bId, tileId);
      } else {
        pushTri(outTris, A, B, C, n, layerId, bId, tileId);
      }
    }
  } else {
    // Horizontal ear-clipped top cap at zEaves (normal [0, 0, 1])
    for (let i = 0; i < roofTris.length; i++) {
      const [a, b, c] = roofTris[i];
      pushTri(outTris, [a[0], a[1], zEaves], [b[0], b[1], zEaves], [c[0], c[1], zEaves], [0, 0, 1], layerId, bId, tileId);
    }
  }
}

// Canonical edge interpolation sorting endpoints lexicographically so shared edges produce bit-identical cut coordinates
function edgeInterpCanonical3D(A, B, axis, cutVal) {
  const swap = (A[0] > B[0]) || (A[0] === B[0] && A[1] > B[1]) || (A[0] === B[0] && A[1] === B[1] && A[2] > B[2]);
  const p0 = swap ? B : A, p1 = swap ? A : B;
  const denom = p1[axis] - p0[axis];
  const t = Math.abs(denom) < 1e-12 ? 0.5 : (cutVal - p0[axis]) / denom;
  const fix = v => Math.abs(v) < 1e-9 ? 0 : v;
  return [
    axis === 0 ? cutVal : fix(p0[0] + t * (p1[0] - p0[0])),
    axis === 1 ? cutVal : fix(p0[1] + t * (p1[1] - p0[1])),
    axis === 2 ? cutVal : fix(p0[2] + t * (p1[2] - p0[2]))
  ];
}

// Triangulates cut-plane loops preserving 100% of boundary vertices (never stripping collinear vertices to avoid T-junctions)
function triangulateCutLoopExact(loopPts) {
  if (!loopPts || loopPts.length < 3) return [];

  // 1. Weld coincident vertices (dist < 1e-8) while strictly preserving all collinear vertices
  const pts = [];
  for (let i = 0; i < loopPts.length; i++) {
    const p = loopPts[i];
    if (pts.length === 0 || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 1e-8) {
      pts.push([p[0], p[1]]);
    }
  }
  if (pts.length >= 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 1e-8) {
    pts.pop();
  }
  if (pts.length < 3) return [];

  // Ensure CCW winding
  let a2d = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n];
    a2d += (p1[0] * p2[1] - p2[0] * p1[1]);
  }
  if (a2d < 0) pts.reverse();

  const indices = pts.map((_, i) => i);
  const tris = [];
  let guard = 0;
  const maxIter = indices.length * 6 + 50;

  function ptDistSq(p1, p2) { return (p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2; }
  function isInsideTri(px, py, ax, ay, bx, by, cx, cy) {
    const v0x = cx - ax, v0y = cy - ay;
    const v1x = bx - ax, v1y = by - ay;
    const v2x = px - ax, v2y = py - ay;
    const dot00 = v0x * v0x + v0y * v0y;
    const dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y;
    const dot11 = v1x * v1x + v1y * v1y;
    const dot12 = v1x * v2x + v1y * v2y;
    const denom = dot00 * dot11 - dot01 * dot01;
    if (Math.abs(denom) < 1e-11) return false;
    const inv = 1 / denom;
    const u = (dot11 * dot02 - dot01 * dot12) * inv;
    const v = (dot00 * dot12 - dot01 * dot02) * inv;
    return (u > 1e-6) && (v > 1e-6) && (u + v < 1 - 1e-6);
  }

  while (indices.length > 3 && guard++ < maxIter) {
    const n = indices.length;
    let bestEarIdx = -1;
    let bestDiagSq = Infinity;

    for (let i = 0; i < n; i++) {
      const iPrev = indices[(i + n - 1) % n];
      const iCurr = indices[i];
      const iNext = indices[(i + 1) % n];
      const a = pts[iPrev], b = pts[iCurr], c = pts[iNext];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 1e-7) continue;

      let hasInside = false;
      const tMinX = Math.min(a[0], b[0], c[0]) - 1e-5;
      const tMaxX = Math.max(a[0], b[0], c[0]) + 1e-5;
      const tMinY = Math.min(a[1], b[1], c[1]) - 1e-5;
      const tMaxY = Math.max(a[1], b[1], c[1]) + 1e-5;

      const dax = c[0] - a[0], day = c[1] - a[1];
      const lenSq = dax * dax + day * day;

      for (let j = 0; j < n; j++) {
        const idx = indices[j];
        if (idx === iPrev || idx === iCurr || idx === iNext) continue;
        const p = pts[idx];
        if (p[0] < tMinX || p[0] > tMaxX || p[1] < tMinY || p[1] > tMaxY) continue;
        if (ptDistSq(p, a) < 1e-9 || ptDistSq(p, b) < 1e-9 || ptDistSq(p, c) < 1e-9) continue;
        if (isInsideTri(p[0], p[1], a[0], a[1], b[0], b[1], c[0], c[1])) {
          hasInside = true;
          break;
        }
        if (lenSq > 1e-12) {
          const pax = p[0] - a[0], pay = p[1] - a[1];
          const crossP = dax * pay - day * pax;
          if (Math.abs(crossP) < 1e-10) {
            const dotP = pax * dax + pay * day;
            if (dotP > 1e-8 && dotP < lenSq - 1e-8) {
              hasInside = true;
              break;
            }
          }
        }
      }
      if (!hasInside) {
        const dSq = ptDistSq(a, c);
        if (dSq < bestDiagSq) {
          bestDiagSq = dSq;
          bestEarIdx = i;
        }
      }
    }

    if (bestEarIdx >= 0) {
      const iPrev = indices[(bestEarIdx + n - 1) % n];
      const iCurr = indices[bestEarIdx];
      const iNext = indices[(bestEarIdx + 1) % n];
      tris.push([pts[iPrev], pts[iCurr], pts[iNext]]);
      indices.splice(bestEarIdx, 1);
      continue;
    }

    // Fallback: pick ear with largest strictly positive cross product to consume remaining vertices
    let fallbackIdx = -1;
    let bestCross = 1e-9;
    for (let i = 0; i < n; i++) {
      const iPrev = indices[(i + n - 1) % n];
      const iCurr = indices[i];
      const iNext = indices[(i + 1) % n];
      const a = pts[iPrev], b = pts[iCurr], c = pts[iNext];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross > bestCross) {
        bestCross = cross;
        fallbackIdx = i;
      }
    }
    if (fallbackIdx >= 0) {
      const iPrev = indices[(fallbackIdx + n - 1) % n];
      const iCurr = indices[fallbackIdx];
      const iNext = indices[(fallbackIdx + 1) % n];
      tris.push([pts[iPrev], pts[iCurr], pts[iNext]]);
      indices.splice(fallbackIdx, 1);
      continue;
    }
    break;
  }
  if (indices.length >= 3) {
    for (let k = 1; k < indices.length - 1; k++) {
      const a = pts[indices[0]], b = pts[indices[k]], c = pts[indices[k + 1]];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross > 1e-9) {
        tris.push([a, b, c]);
      } else if (cross < -1e-9) {
        tris.push([a, c, b]);
      }
    }
  }
  return tris;
}

// Clips closed 2-manifold triangle mesh against an axis plane and caps the cut face with 100% manifold topology
function clipClosedMeshByAxisPlane(tris, axis, cutVal, keepGreater) {
  if (!tris || tris.length === 0) return [];

  const outTris = [];
  const cutSegs = [];
  const eps = 1e-7;
  const qv = v => Math.abs(v) < 1e-6 ? 0 : v;
  const key = p => qv(p[0]).toFixed(6) + '_' + qv(p[1]).toFixed(6) + '_' + qv(p[2]).toFixed(6);

  for (let ti = 0; ti < tris.length; ti++) {
    const tri = tris[ti];
    const in0 = keepGreater ? (tri.v0[axis] >= cutVal - eps) : (tri.v0[axis] <= cutVal + eps);
    const in1 = keepGreater ? (tri.v1[axis] >= cutVal - eps) : (tri.v1[axis] <= cutVal + eps);
    const in2 = keepGreater ? (tri.v2[axis] >= cutVal - eps) : (tri.v2[axis] <= cutVal + eps);
    const inCount = (in0 ? 1 : 0) + (in1 ? 1 : 0) + (in2 ? 1 : 0);

    if (inCount === 0) continue;
    if (inCount === 3) {
      outTris.push(tri);
      continue;
    }

    const verts = [tri.v0, tri.v1, tri.v2];
    const ins = [in0, in1, in2];
    let P1, P2, rawTris;

    if (inCount === 1) {
      const i = ins.indexOf(true);
      const V0 = verts[i], V1 = verts[(i + 1) % 3], V2 = verts[(i + 2) % 3];
      P1 = edgeInterpCanonical3D(V0, V1, axis, cutVal);
      P2 = edgeInterpCanonical3D(V2, V0, axis, cutVal);
      if (Math.hypot(P1[0] - P2[0], P1[1] - P2[1], P1[2] - P2[2]) < 1e-8) {
        rawTris = [];
      } else {
        rawTris = [{ v0: V0, v1: P1, v2: P2, layerId: tri.layerId, buildingId: tri.buildingId, tileId: tri.tileId }];
      }
    } else {
      const i = ins.indexOf(false);
      const Vout = verts[i], V1 = verts[(i + 1) % 3], V2 = verts[(i + 2) % 3];
      P1 = edgeInterpCanonical3D(V2, Vout, axis, cutVal);
      P2 = edgeInterpCanonical3D(Vout, V1, axis, cutVal);
      if (Math.hypot(P1[0] - P2[0], P1[1] - P2[1], P1[2] - P2[2]) < 1e-8) {
        rawTris = [{ v0: V1, v1: V2, v2: P1, layerId: tri.layerId, buildingId: tri.buildingId, tileId: tri.tileId }];
      } else {
        rawTris = [
          { v0: V1, v1: V2, v2: P1, layerId: tri.layerId, buildingId: tri.buildingId, tileId: tri.tileId },
          { v0: V1, v1: P1, v2: P2, layerId: tri.layerId, buildingId: tri.buildingId, tileId: tri.tileId }
        ];
      }
    }

    for (let k = 0; k < rawTris.length; k++) {
      const t = rawTris[k];
      if (!isDegenerateTri3D(t.v0, t.v1, t.v2)) {
        t.n = computeFaceNormal(t.v0, t.v1, t.v2);
        outTris.push(t);
      }
    }

    const dSeg = Math.hypot(P1[0] - P2[0], P1[1] - P2[1], P1[2] - P2[2]);
    if (dSeg > 1e-8 && key(P1) !== key(P2)) {
      // Directed cut segment on cut plane closing the 2-manifold
      cutSegs.push([P2, P1]);
    }
  }

  if (cutSegs.length < 3) return outTris;

  // Stitch directed segments by quantized key (1e-4), handling float jitter and negative zeros
  const map = new Map();
  for (let i = 0; i < cutSegs.length; i++) {
    const seg = cutSegs[i];
    const k0 = key(seg[0]);
    if (!map.has(k0)) map.set(k0, []);
    map.get(k0).push(seg);
  }

  const loops = [];
  const used = new Set();
  for (let i = 0; i < cutSegs.length; i++) {
    const startSeg = cutSegs[i];
    if (used.has(startSeg)) continue;
    const loop = [];
    let curr = startSeg;
    while (curr && !used.has(curr)) {
      used.add(curr);
      loop.push(curr[0]);
      const nextKey = key(curr[1]);
      const candidates = map.get(nextKey) || [];
      let nextSeg = candidates.find(s => !used.has(s));
      if (!nextSeg) {
        for (let j = 0; j < cutSegs.length; j++) {
          const other = cutSegs[j];
          if (!used.has(other)) {
            const d = Math.hypot(curr[1][0] - other[0][0], curr[1][1] - other[0][1], curr[1][2] - other[0][2]);
            if (d < 1e-4) {
              nextSeg = other;
              break;
            }
          }
        }
      }
      curr = nextSeg;
    }
    if (loop.length >= 3) loops.push(loop);
  }

  if (loops.length === 0) return outTris;

  // Coordinate projections for cut planes
  const fix = v => Math.abs(v) < 1e-9 ? 0 : v;
  let to2D, to3D;
  if (axis === 0 && keepGreater) {
    // xMin, outward normal [-1, 0, 0]
    to2D = p => [-p[1], p[2]];
    to3D = (u, v) => [cutVal, fix(-u), fix(v)];
  } else if (axis === 0 && !keepGreater) {
    // xMax, outward normal [+1, 0, 0]
    to2D = p => [p[1], p[2]];
    to3D = (u, v) => [cutVal, fix(u), fix(v)];
  } else if (axis === 1 && keepGreater) {
    // yMin, outward normal [0, -1, 0]
    to2D = p => [p[0], p[2]];
    to3D = (u, v) => [fix(u), cutVal, fix(v)];
  } else {
    // yMax, outward normal [0, +1, 0]
    to2D = p => [-p[0], p[2]];
    to3D = (u, v) => [fix(-u), cutVal, fix(v)];
  }

  // Separate loops into outers (signed area > 0) and holes (signed area < 0)
  const outerLoops = [];
  const holeLoops = [];
  for (let i = 0; i < loops.length; i++) {
    const l2d = loops[i].map(to2D);
    let a = 0;
    for (let j = 0, n = l2d.length; j < n; j++) {
      a += (l2d[j][0] * l2d[(j + 1) % n][1] - l2d[(j + 1) % n][0] * l2d[j][1]);
    }
    if (a * 0.5 >= 0) {
      outerLoops.push(l2d);
    } else {
      holeLoops.push(l2d);
    }
  }

  // Merge hole loops into their enclosing outer loops via keyhole bridge
  for (let h = 0; h < holeLoops.length; h++) {
    const hole = holeLoops[h];
    let parentIdx = -1;
    for (let o = 0; o < outerLoops.length; o++) {
      if (pointInPoly2D(hole[0][0], hole[0][1], outerLoops[o])) {
        parentIdx = o;
        break;
      }
    }
    if (parentIdx >= 0) {
      outerLoops[parentIdx] = mergeHolesIntoOuterKeyhole(outerLoops[parentIdx], [hole]);
    } else {
      hole.reverse();
      outerLoops.push(hole);
    }
  }

  // Triangulate each cut-plane loop
  for (let i = 0; i < outerLoops.length; i++) {
    const cap2D = triangulateCutLoopExact(outerLoops[i]);
    for (let k = 0; k < cap2D.length; k++) {
      const [a2, b2, c2] = cap2D[k];
      const t3 = {
        v0: to3D(a2[0], a2[1]),
        v1: to3D(b2[0], b2[1]),
        v2: to3D(c2[0], c2[1]),
        layerId: tris[0]?.layerId ?? 4,
        buildingId: tris[0]?.buildingId ?? -1,
        tileId: tris[0]?.tileId ?? 0
      };
      if (!isDegenerateTri3D(t3.v0, t3.v1, t3.v2)) {
        t3.n = computeFaceNormal(t3.v0, t3.v1, t3.v2);
        outTris.push(t3);
      }
    }
  }

  return outTris;
}

// Exact 3D Planar Mesh Clipper + Cross-Section Capper
// Clips closed 3D triangle shell against [xMin, xMax] × [yMin, yMax] with 0 open edges guaranteed
function clipMeshToBox3D(shellTris, xMin, xMax, yMin, yMax, tileId = 0) {
  if (!shellTris || shellTris.length === 0) return [];

  // 1. Fast-path: compute shell XY AABB
  let sMinX = Infinity, sMaxX = -Infinity;
  let sMinY = Infinity, sMaxY = -Infinity;
  for (let i = 0; i < shellTris.length; i++) {
    const t = shellTris[i];
    for (const v of [t.v0, t.v1, t.v2]) {
      const x = v[0], y = v[1];
      if (x < sMinX) sMinX = x;
      if (x > sMaxX) sMaxX = x;
      if (y < sMinY) sMinY = y;
      if (y > sMaxY) sMaxY = y;
    }
  }

  // If completely outside tile bounds, return [] in O(n)
  if (sMaxX < xMin - 1e-4 || sMinX > xMax + 1e-4 || sMaxY < yMin - 1e-4 || sMinY > yMax + 1e-4) {
    return [];
  }

  // If completely inside tile bounds, clone/tag tileId and return in O(n)
  if (sMinX >= xMin - 1e-4 && sMaxX <= xMax + 1e-4 && sMinY >= yMin - 1e-4 && sMaxY <= yMax + 1e-4) {
    return shellTris.map(t => ({
      v0: [t.v0[0], t.v0[1], t.v0[2]],
      v1: [t.v1[0], t.v1[1], t.v1[2]],
      v2: [t.v2[0], t.v2[1], t.v2[2]],
      n: t.n ? [t.n[0], t.n[1], t.n[2]] : computeFaceNormal(t.v0, t.v1, t.v2),
      layerId: t.layerId,
      buildingId: t.buildingId,
      tileId: tileId
    }));
  }

  // 2. Sequentially clip closed triangle list against the 4 half-spaces
  let cur = shellTris;
  cur = clipClosedMeshByAxisPlane(cur, 0, xMin, true);   // x >= xMin
  if (cur.length === 0) return [];
  cur = clipClosedMeshByAxisPlane(cur, 0, xMax, false);  // x <= xMax
  if (cur.length === 0) return [];
  cur = clipClosedMeshByAxisPlane(cur, 1, yMin, true);   // y >= yMin
  if (cur.length === 0) return [];
  cur = clipClosedMeshByAxisPlane(cur, 1, yMax, false);  // y <= yMax
  if (cur.length === 0) return [];

  // Tag tileId on resulting triangles and sanitize float coordinates
  const fix = v => Math.abs(v) < 1e-9 ? 0 : v;
  for (let i = 0; i < cur.length; i++) {
    cur[i].tileId = tileId;
    cur[i].v0 = [fix(cur[i].v0[0]), fix(cur[i].v0[1]), fix(cur[i].v0[2])];
    cur[i].v1 = [fix(cur[i].v1[0]), fix(cur[i].v1[1]), fix(cur[i].v1[2])];
    cur[i].v2 = [fix(cur[i].v2[0]), fix(cur[i].v2[1]), fix(cur[i].v2[2])];
    if (!cur[i].n) {
      cur[i].n = computeFaceNormal(cur[i].v0, cur[i].v1, cur[i].v2);
    }
  }

  return cur;
}

// Closed watertight 5-sided sculpted tree crown anchored flush at zGround (0 overhanging base, 0 floating gap)
function addTreeCrown3D(tx, ty, zGround, radius, height, layerId, outTris, tileId = 0) {
  const sides = 5;
  const rMid = radius * 0.94;
  const z0 = zGround;
  const z1 = zGround + height * 0.48;
  const apex = [tx, ty, zGround + height];
  const basePts = [];

  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);

    const b0 = [tx + c0 * rMid, ty + s0 * rMid, z0];
    const b1 = [tx + c1 * rMid, ty + s1 * rMid, z0];
    const m0 = [tx + c0 * rMid * 0.88, ty + s0 * rMid * 0.88, z1];
    const m1 = [tx + c1 * rMid * 0.88, ty + s1 * rMid * 0.88, z1];
    basePts.push(b0);

    pushQuad(outTris, b0, b1, m1, m0, computeFaceNormal(b0, b1, m1), layerId, -1, tileId);
    pushTri(outTris, m0, m1, apex, computeFaceNormal(m0, m1, apex), layerId, -1, tileId);
  }

  // Watertight bottom pentagon cap at z0
  pushTri(outTris, basePts[0], basePts[2], basePts[1], [0, 0, -1], layerId, -1, tileId);
  pushTri(outTris, basePts[0], basePts[3], basePts[2], [0, 0, -1], layerId, -1, tileId);
  pushTri(outTris, basePts[0], basePts[4], basePts[3], [0, 0, -1], layerId, -1, tileId);
}

// Canonical edge interpolation so adjacent cells and multi-step band clips compute bit-identical intersection coordinates
function interpCellEdgeCanonical(a, b, threshold) {
  const eA = a.isCut ? a.edgeA : (b.isCut ? b.edgeA : a);
  const eB = a.isCut ? a.edgeB : (b.isCut ? b.edgeB : b);
  const ax = eA.x, ay = eA.y, av = eA.v;
  const bx = eB.x, by = eB.y, bv = eB.v;

  const swap = (ax > bx) || (ax === bx && ay > by);
  const x0 = swap ? bx : ax, y0 = swap ? by : ay, v0 = swap ? bv : av;
  const x1 = swap ? ax : bx, y1 = swap ? ay : by, v1 = swap ? av : bv;
  const t = (threshold - v0) / ((v1 - v0) || 1e-9);
  return {
    x: x0 + (x1 - x0) * t,
    y: y0 + (y1 - y0) * t,
    v: threshold,
    edgeA: eA,
    edgeB: eB,
    isCut: true
  };
}

function clipCellPolyByScalar(poly, threshold, keepGreater) {
  const out = [];
  const cutSegments = [];
  const n = poly.length;
  if (n < 3) return { poly: out, cuts: cutSegments };

  for (let i = 0; i < n; i++) {
    const curr = poly[i];
    const prev = poly[(i + n - 1) % n];
    const currIn = keepGreater ? (curr.v >= threshold) : (curr.v <= threshold);
    const prevIn = keepGreater ? (prev.v >= threshold) : (prev.v <= threshold);

    if (currIn) {
      if (!prevIn) {
        out.push(interpCellEdgeCanonical(prev, curr, threshold));
      }
      out.push(curr);
    } else if (prevIn) {
      out.push(interpCellEdgeCanonical(prev, curr, threshold));
    }
  }

  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    const b = out[(i + 1) % out.length];
    if (a.isCut && b.isCut) {
      cutSegments.push([a, b]);
    }
  }
  return { poly: out, cuts: cutSegments };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    pushTri,
    pushQuad,
    computeFaceNormal,
    isDegenerateTri3D,
    subdivideInteriorRoofEdges,
    extrudeBuildingLoD2,
    edgeInterpCanonical3D,
    triangulateCutLoopExact,
    clipClosedMeshByAxisPlane,
    clipMeshToBox3D,
    addTreeCrown3D,
    interpCellEdgeCanonical,
    clipCellPolyByScalar
  };
}
