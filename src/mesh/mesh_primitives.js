// ============================================================================
// src/mesh/mesh_primitives.js
// Core 3D Triangle/Quad Emitters, Watertight Prisms/Slabs with Holes & Trees
// ============================================================================

if (typeof cleanPolygonRing === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
  Object.assign(global, require('../geometry/obb_medial_2d.js'));
}

function pushTri(out, v0, v1, v2, n, layerId, buildingId = -1, tileId = 0, shellId = undefined) {
  out.push({ v0, v1, v2, n, layerId, buildingId, tileId, shellId: shellId !== undefined ? shellId : buildingId });
}

function pushQuad(out, p0, p1, p2, p3, n, layerId, buildingId = -1, tileId = 0, shellId = undefined) {
  const sid = shellId !== undefined ? shellId : buildingId;
  out.push({ v0: p0, v1: p1, v2: p2, n, layerId, buildingId, tileId, shellId: sid });
  out.push({ v0: p0, v1: p2, v2: p3, n, layerId, buildingId, tileId, shellId: sid });
}

function computeFaceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
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

function emitClosedPrism(poly2d, zBot, zTop, layerId, outTris, tileId = 0, shellId = -1) {
  if (zTop <= zBot + 1e-5) return;
  const p = cleanPolygonRing(poly2d.slice(), true);
  if (p.length < 3 || Math.abs(signedArea2D(p)) < 1e-5 || !isSimplePolygon(p) || hasSelfTouchingEdge2D(p, 1e-4)) return;
  const tris = triangulateSimplePoly(p);
  if (!tris || tris.length === 0) return;

  for (let ti = 0; ti < tris.length; ti++) {
    const [a, b, c] = tris[ti];
    if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) <= 1e-9) continue;
    pushTri(outTris, [a[0], a[1], zTop], [b[0], b[1], zTop], [c[0], c[1], zTop], [0, 0, 1], layerId, shellId, tileId);
    pushTri(outTris, [a[0], a[1], zBot], [c[0], c[1], zBot], [b[0], b[1], zBot], [0, 0, -1], layerId, shellId, tileId);
  }
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len > 1e-6) {
      pushQuad(outTris, [a[0], a[1], zBot], [b[0], b[1], zBot], [b[0], b[1], zTop], [a[0], a[1], zTop], [dy / len, -dx / len, 0], layerId, shellId, tileId);
    }
  }
}

// Extrudes a 2D polygon with optional CW interior holes into a 100% closed watertight 2-manifold slab
function emitPolygonWithHolesSlab3D(outerInput, holesInput, zBot, zTop, layerId, outTris, tileId = 0, shellId = -1) {
  if (zTop <= zBot + 1e-5) return;
  const outerClean = cleanPolygonRing(outerInput, true);
  if (outerClean.length < 3 || Math.abs(signedArea2D(outerClean)) < 1e-4 || !isSimplePolygon(outerClean) || hasSelfTouchingEdge2D(outerClean, 1e-4)) return;

  const validHoles = [];
  if (holesInput && holesInput.length > 0) {
    for (let h = 0; h < holesInput.length; h++) {
      const hc = cleanPolygonRing(holesInput[h], false);
      if (hc.length >= 3 && Math.abs(signedArea2D(hc)) > 2e-5 && isSimplePolygon(hc) && !hasSelfTouchingEdge2D(hc, 1e-4)) {
        if (hc.every(pt => pointInPoly2D(pt[0], pt[1], outerClean) &&
                           distToPolygonBoundary2D(pt[0], pt[1], outerClean, validHoles) >= 4e-4) &&
            outerClean.every(pt => distToPolygonBoundary2D(pt[0], pt[1], hc, []) >= 4e-4)) {
          validHoles.push(hc);
        }
      }
    }
  }

  const mergedHoles = [];
  let ring = validHoles.length > 0 ? mergeHolesIntoOuterKeyhole(outerClean, validHoles, mergedHoles) : outerClean;
  let actualHoles = mergedHoles;
  if (validHoles.length > 0 && (!isSimplePolygon(ring) || actualHoles.length < validHoles.length)) {
    let curRing = outerClean;
    const keptHoles = [];
    for (let h = 0; h < validHoles.length; h++) {
      const vh = validHoles[h];
      const acc = [];
      const nextRing = mergeHolesIntoOuterKeyhole(curRing, [vh], acc);
      if (acc.length > 0 && isSimplePolygon(nextRing)) {
        curRing = nextRing;
        keptHoles.push(vh);
      }
    }
    ring = curRing;
    actualHoles = keptHoles;
  }
  if (!isSimplePolygon(ring)) {
    ring = outerClean;
    actualHoles = [];
  }

  const capTris = triangulateSimplePoly(ring);
  if (!capTris || capTris.length === 0) return;

  for (let i = 0; i < capTris.length; i++) {
    const [a, b, c] = capTris[i];
    pushTri(outTris, [a[0], a[1], zTop], [b[0], b[1], zTop], [c[0], c[1], zTop], [0, 0, 1], layerId, shellId, tileId);
    pushTri(outTris, [a[0], a[1], zBot], [c[0], c[1], zBot], [b[0], b[1], zBot], [0, 0, -1], layerId, shellId, tileId);
  }

  const emitWallLoop = (loopPts) => {
    for (let i = 0, n = loopPts.length; i < n; i++) {
      const a = loopPts[i], b = loopPts[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len > 1e-6) {
        pushQuad(outTris, [a[0], a[1], zBot], [b[0], b[1], zBot], [b[0], b[1], zTop], [a[0], a[1], zTop], [dy / len, -dx / len, 0], layerId, shellId, tileId);
      }
    }
  };
  emitWallLoop(outerClean);
  for (let h = 0; h < actualHoles.length; h++) emitWallLoop(actualHoles[h]);
}

// Closed watertight 8-sided rounded organic cushion canopy anchored flush at zGround (0 overhangs, 0 open edges)
function addTreeCrown3D(tx, ty, zGround, radius, height, layerId, outTris, tileId = 0, shellId = -1) {
  const sides = 8;
  const rot = (((tx * 12.9898 + ty * 78.233) % 1) + 1) % 1 * Math.PI * 2;
  const bands = [
    [1.00, 0.00],
    [0.93, 0.38],
    [0.64, 0.74]
  ];
  const rings = bands.map(([rScale, hScale], bIdx) => {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const ang = rot + (i / sides) * Math.PI * 2;
      const wobble = 1.0 + 0.05 * Math.sin(ang * 3.0 + tx * 2.1);
      const r = radius * rScale * wobble;
      pts.push([tx + Math.cos(ang) * r, ty + Math.sin(ang) * r, bIdx === 0 ? zGround : zGround + height * hScale]);
    }
    return pts;
  });
  const apex = [tx, ty, zGround + height];

  for (let b = 0; b < rings.length - 1; b++) {
    const lo = rings[b], hi = rings[b + 1];
    for (let i = 0; i < sides; i++) {
      const next = (i + 1) % sides;
      pushQuad(outTris, lo[i], lo[next], hi[next], hi[i], computeFaceNormal(lo[i], lo[next], hi[next]), layerId, shellId, tileId);
    }
  }
  const topRing = rings[rings.length - 1];
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    pushTri(outTris, topRing[i], topRing[next], apex, computeFaceNormal(topRing[i], topRing[next], apex), layerId, shellId, tileId);
  }
  const basePts = rings[0];
  for (let i = 1; i < sides - 1; i++) {
    pushTri(outTris, basePts[0], basePts[i + 1], basePts[i], [0, 0, -1], layerId, shellId, tileId);
  }
}

function getTileIdForCentroid(cx, cy, halfW, halfH, tileCols, tileRows) {
  if (tileCols <= 1 && tileRows <= 1) return 0;
  const tileStepX = (2 * halfW) / tileCols;
  const tileStepY = (2 * halfH) / tileRows;
  const tc = Math.max(0, Math.min(tileCols - 1, Math.floor((cx + halfW) / tileStepX)));
  const tr = Math.max(0, Math.min(tileRows - 1, Math.floor((cy + halfH) / tileStepY)));
  return tr * tileCols + tc;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    pushTri,
    pushQuad,
    computeFaceNormal,
    isDegenerateTri3D,
    emitClosedPrism,
    emitPolygonWithHolesSlab3D,
    addTreeCrown3D,
    getTileIdForCentroid
  };
}
