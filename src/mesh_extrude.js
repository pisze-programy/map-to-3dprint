// ============================================================================
// src/mesh_extrude.js
// 3D Mesh Primitive Emitters, Watertight 2-Manifold LoD2 Building Extrusion,
// 3D Canopy Tree Crowns & Canonical Marching-Squares Scalar Clipper
// ============================================================================

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

// Watertight 2-Manifold LoD2 Building Extrusion:
// - Quads (n=4): True 4-slope architectural hipped/gabled roof along major axis (0 spikes, 0 open edges)
// - Convex polygons (n<=10): Single shared centroid apex (0 spikes, 0 open edges)
// - Arbitrary non-convex / multi-wing / L- / U-shaped buildings: Chordal-Axis Spine Pitched Roof (100% 2-manifold, 0 open edges)
function extrudeBuildingLoD2(outerInput, holesInput, zBase, zEaves, zRidge, hasPitchedRoof, layerId, bId, outTris, tileId = 0, roofShape = 'hipped') {
  const outerClean = cleanPolygonRing(outerInput, true);
  if (outerClean.length < 3) return;

  const holesClean = (holesInput || [])
    .map(h => cleanPolygonRing(h, false))
    .filter(h => h.length >= 3);

  // Merge courtyard holes via non-intersecting keyhole slit so walls, floor, and roof share 1 single simple ring
  let ring = holesClean.length > 0 ? mergeHolesIntoOuterKeyhole(outerClean, holesClean) : outerClean;
  if (ring.length < 3) return;
  if (!isSimplePolygon(ring)) {
    ring = outerClean;
    if (!isSimplePolygon(ring)) return;
  }

  const roofTris = triangulateSimplePoly(ring);
  if (roofTris.length === 0) return;

  // 1. Vertical walls along ring (exact 1-to-1 match with floor and roof boundary edges!)
  for (let i = 0, n = ring.length; i < n; i++) {
    const p1 = ring[i], p2 = ring[(i + 1) % n];
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

  const roofH = Math.max(0, zRidge - zEaves);
  const canPitch = hasPitchedRoof && roofH > 0.12 && ring.length >= 3;

  // 3. Watertight Top Roof Cap at zEaves / zRidge
  if (canPitch && holesClean.length === 0 && ring.length === 4 && isConvexPoly(ring) && roofShape !== 'pyramidal' && roofShape !== 'dome') {
    // True 4-slope Hipped / Gabled Roof along longer quad axis
    const p0 = ring[0], p1 = ring[1], p2 = ring[2], p3 = ring[3];
    const len01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
    const len12 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p0[0] - p3[0], p0[1] - p3[1]);
    const q = (len01 >= len12) ? [p0, p1, p2, p3] : [p1, p2, p3, p0];

    const mA = [(q[0][0] + q[3][0]) * 0.5, (q[0][1] + q[3][1]) * 0.5];
    const mB = [(q[1][0] + q[2][0]) * 0.5, (q[1][1] + q[2][1]) * 0.5];
    const cx = (mA[0] + mB[0]) * 0.5, cy = (mA[1] + mB[1]) * 0.5;
    const ridgeFactor = (roofShape === 'gabled') ? 0.78 : 0.45;
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
  } else if (canPitch && holesClean.length === 0 && ring.length <= 10 && isConvexPoly(ring)) {
    // Clean single-apex hipped/pyramidal cap for convex footprint (3..10 sides)
    let cx = 0, cy = 0;
    for (let i = 0; i < ring.length; i++) {
      cx += ring[i][0];
      cy += ring[i][1];
    }
    cx /= ring.length;
    cy /= ring.length;
    const apex = [cx, cy, zRidge];
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = [ring[i][0], ring[i][1], zEaves];
      const b = [ring[(i + 1) % n][0], ring[(i + 1) % n][1], zEaves];
      pushTri(outTris, a, b, apex, computeFaceNormal(a, b, apex), layerId, bId, tileId);
    }
  } else if (canPitch) {
    // Chordal-Axis Spine Pitched Roof for L/U/T/multi-wing and courtyard buildings (100% 2-manifold, 0 open edges)
    const ptKey = (p) => p[0].toFixed(4) + '_' + p[1].toFixed(4);
    const boundaryEdges = new Set();
    for (let i = 0, n = ring.length; i < n; i++) {
      const kA = ptKey(ring[i]), kB = ptKey(ring[(i + 1) % n]);
      boundaryEdges.add(kA + '|' + kB);
      boundaryEdges.add(kB + '|' + kA);
    }
    for (let i = 0; i < roofTris.length; i++) {
      const [a, b, c] = roofTris[i];
      const C = [(a[0] + b[0] + c[0]) / 3.0, (a[1] + b[1] + c[1]) / 3.0, zRidge];
      const edges = [[a, b], [b, c], [c, a]];
      for (let e = 0; e < 3; e++) {
        const u = edges[e][0], v = edges[e][1];
        const U = [u[0], u[1], zEaves];
        const V = [v[0], v[1], zEaves];
        if (boundaryEdges.has(ptKey(u) + '|' + ptKey(v))) {
          pushTri(outTris, U, V, C, computeFaceNormal(U, V, C), layerId, bId, tileId);
        } else {
          const swap = (u[0] > v[0]) || (u[0] === v[0] && u[1] > v[1]);
          const u0 = swap ? v : u, u1 = swap ? u : v;
          const M = [(u0[0] + u1[0]) * 0.5, (u0[1] + u1[1]) * 0.5, zRidge];
          pushTri(outTris, U, M, C, computeFaceNormal(U, M, C), layerId, bId, tileId);
          pushTri(outTris, M, V, C, computeFaceNormal(M, V, C), layerId, bId, tileId);
        }
      }
    }
  } else {
    // Clean flat architectural roof for explicitly flat-roofed buildings
    for (let i = 0; i < roofTris.length; i++) {
      const [a, b, c] = roofTris[i];
      pushTri(outTris, [a[0], a[1], zEaves], [b[0], b[1], zEaves], [c[0], c[1], zEaves], [0, 0, 1], layerId, bId, tileId);
    }
  }
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
