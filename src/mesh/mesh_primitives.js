// ============================================================================
// src/mesh/mesh_primitives.js
// Core 3D Triangle/Quad Emitters, Watertight Prisms/Slabs with Holes,
// Recessed Underside Tile ID Patches, Sculpted Canopy Trees & Scalar Cell Clipping
// ============================================================================

if (typeof cleanPolygonRing === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/polygon_2d.js'));
  Object.assign(global, require('../geometry/obb_medial_2d.js'));
}

const BITMAP_FONT_5X3 = {
  'R': [[1,1,0],[1,0,1],[1,1,0],[1,0,1],[1,0,1]],
  'C': [[0,1,1],[1,0,0],[1,0,0],[1,0,0],[0,1,1]],
  '1': [[0,1,0],[1,1,0],[0,1,0],[0,1,0],[1,1,1]],
  '2': [[1,1,0],[0,0,1],[0,1,0],[1,0,0],[1,1,1]],
  '3': [[1,1,0],[0,0,1],[0,1,0],[0,0,1],[1,1,0]],
  '4': [[1,0,1],[1,0,1],[1,1,1],[0,0,1],[0,0,1]],
  '5': [[1,1,1],[1,0,0],[1,1,0],[0,0,1],[1,1,0]],
  '6': [[0,1,1],[1,0,0],[1,1,0],[1,0,1],[0,1,0]],
  '7': [[1,1,1],[0,0,1],[0,1,0],[0,0,1],[0,1,0]],
  '8': [[0,1,0],[1,0,1],[0,1,0],[1,0,1],[0,1,0]],
  '9': [[0,1,0],[1,0,1],[0,1,1],[0,0,1],[1,1,0]],
  '0': [[0,1,0],[1,0,1],[1,0,1],[1,0,1],[0,1,0]],
  '-': [[0,0,0],[0,0,0],[1,1,1],[0,0,0],[0,0,0]],
  ' ': [[0,0],[0,0],[0,0],[0,0],[0,0]],
  '^': [[0,1,0],[1,1,1],[0,1,0],[0,1,0],[0,1,0]],
  '↑': [[0,1,0],[1,1,1],[0,1,0],[0,1,0],[0,1,0]]
};

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
  if (p.length < 3 || Math.abs(signedArea2D(p)) < 1e-5 || !isSimplePolygon(p) || hasSelfTouchingEdge2D(p, 2.2e-3)) return;
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
  if (outerClean.length < 3 || Math.abs(signedArea2D(outerClean)) < 1e-4 || !isSimplePolygon(outerClean) || hasSelfTouchingEdge2D(outerClean, 2.2e-3)) return;

  const validHoles = [];
  if (holesInput && holesInput.length > 0) {
    for (let h = 0; h < holesInput.length; h++) {
      const hc = cleanPolygonRing(holesInput[h], false);
      if (hc.length >= 3 && Math.abs(signedArea2D(hc)) > 1e-4 && isSimplePolygon(hc) && !hasSelfTouchingEdge2D(hc, 2.2e-3)) {
        if (hc.every(pt => pointInPoly2D(pt[0], pt[1], outerClean) &&
                           distToPolygonBoundary2D(pt[0], pt[1], outerClean, validHoles) >= 2.5e-3) &&
            outerClean.every(pt => distToPolygonBoundary2D(pt[0], pt[1], hc, []) >= 2.5e-3)) {
          validHoles.push(hc);
        }
      }
    }
  }

  let ring = validHoles.length > 0 ? mergeHolesIntoOuterKeyhole(outerClean, validHoles) : outerClean;
  let actualHoles = validHoles;
  if (!isSimplePolygon(ring)) {
    ring = outerClean;
    actualHoles = [];
  }

  const triangulator = (typeof triangulateCutLoopExact === 'function' && actualHoles.length > 0)
    ? triangulateCutLoopExact
    : triangulateSimplePoly;
  const capTris = triangulator(ring);
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

function emitUndersideIdPatch(x0, y0, x1, y1, arg5, arg6, arg7, arg8, arg9, arg10, arg11, arg12) {
  let fz00, fz10, fz11, fz01, label, maxDebossDepth, tileId, outTris;
  if (typeof arg6 === 'number' && typeof arg7 === 'number' && typeof arg8 === 'number') {
    fz00 = arg5; fz10 = arg6; fz11 = arg7; fz01 = arg8;
    label = arg9; maxDebossDepth = arg10; tileId = arg11; outTris = arg12;
  } else {
    fz00 = arg5; fz10 = arg5; fz11 = arg5; fz01 = arg5;
    label = arg6; maxDebossDepth = arg7; tileId = arg8; outTris = arg9;
  }
  const isSingle = (label.length === 1);
  const Nx = isSingle ? 7 : 26;
  const Ny = isSingle ? 7 : 10;
  const grid = Array.from({ length: Ny }, () => new Uint8Array(Nx));

  if (isSingle) {
    const glyph = BITMAP_FONT_5X3[label] || BITMAP_FONT_5X3[' '];
    const gw = glyph[0].length;
    const startX = Math.max(1, Math.floor((Nx - gw) * 0.5));
    const startY = Math.max(1, Math.floor((Ny - 5) * 0.5));
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < gw; c++) {
        if (glyph[r][c]) {
          const gy = startY + (4 - r), gx = startX + c;
          if (gy >= 1 && gy < Ny - 1 && gx >= 1 && gx < Nx - 1) grid[gy][gx] = 1;
        }
      }
    }
  } else {
    let totalW = 0;
    for (const ch of label) {
      const glyph = BITMAP_FONT_5X3[ch] || BITMAP_FONT_5X3[' '];
      totalW += glyph[0].length + 1;
    }
    totalW--;
    let startX = Math.max(1, Math.floor((Nx - totalW) * 0.5));
    const startY = Math.max(1, Math.floor((Ny - 5) * 0.5));
    for (const ch of label) {
      const glyph = BITMAP_FONT_5X3[ch] || BITMAP_FONT_5X3[' '];
      const gw = glyph[0].length;
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < gw; c++) {
          if (glyph[r][c]) {
            const gy = startY + (4 - r), gx = startX + c;
            if (gy >= 1 && gy < Ny - 1 && gx >= 1 && gx < Nx - 1) grid[gy][gx] = 1;
          }
        }
      }
      startX += gw + 1;
    }
  }

  const P = [];
  for (let j = 0; j <= Ny; j++) {
    P[j] = [];
    const v = j / Ny;
    const py = y0 + 0.12 * (y1 - y0) + v * 0.76 * (y1 - y0);
    for (let i = 0; i <= Nx; i++) {
      const u = i / Nx;
      const px = x0 + 0.12 * (x1 - x0) + u * 0.76 * (x1 - x0);
      const isStroke = (j < Ny && i < Nx && grid[j][i] === 1);
      const fBaseGrid = (1 - u) * (1 - v) * fz00 + u * (1 - v) * fz10 + u * v * fz11 + (1 - u) * v * fz01;
      P[j][i] = [px, py, isStroke ? (fBaseGrid + maxDebossDepth) : fBaseGrid];
    }
  }

  const C00 = [x0, y0, fz00], C10 = [x1, y0, fz10], C11 = [x1, y1, fz11], C01 = [x0, y1, fz01];
  for (let j = 0; j < Ny; j++) {
    for (let i = 0; i < Nx; i++) {
      const p00 = P[j][i], p01 = P[j + 1][i], p11 = P[j + 1][i + 1], p10 = P[j][i + 1];
      pushTri(outTris, p00, p01, p11, computeFaceNormal(p00, p01, p11), 1, -1, tileId);
      pushTri(outTris, p00, p11, p10, computeFaceNormal(p00, p11, p10), 1, -1, tileId);
    }
  }
  for (let i = 0; i < Nx; i++) pushTri(outTris, C00, P[0][i], P[0][i + 1], computeFaceNormal(C00, P[0][i], P[0][i + 1]), 1, -1, tileId);
  pushTri(outTris, C00, P[0][Nx], C10, computeFaceNormal(C00, P[0][Nx], C10), 1, -1, tileId);
  for (let j = 0; j < Ny; j++) pushTri(outTris, C10, P[j][Nx], P[j + 1][Nx], computeFaceNormal(C10, P[j][Nx], P[j + 1][Nx]), 1, -1, tileId);
  pushTri(outTris, C10, P[Ny][Nx], C11, computeFaceNormal(C10, P[Ny][Nx], C11), 1, -1, tileId);
  for (let i = Nx; i > 0; i--) pushTri(outTris, C11, P[Ny][i], P[Ny][i - 1], computeFaceNormal(C11, P[Ny][i], P[Ny][i - 1]), 1, -1, tileId);
  pushTri(outTris, C11, P[Ny][0], C01, computeFaceNormal(C11, P[Ny][0], C01), 1, -1, tileId);
  for (let j = Ny; j > 0; j--) pushTri(outTris, C01, P[j][0], P[j - 1][0], computeFaceNormal(C01, P[j][0], P[j - 1][0]), 1, -1, tileId);
  pushTri(outTris, C01, P[0][0], C00, computeFaceNormal(C01, P[0][0], C00), 1, -1, tileId);
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

function interpCellEdgeCanonical(a, b, threshold) {
  const eA = a.isCut ? a.edgeA : (b.isCut ? b.edgeA : a);
  const eB = a.isCut ? a.edgeB : (b.isCut ? b.edgeB : b);
  const ax = eA.x, ay = eA.y, av = eA.v;
  const bx = eB.x, by = eB.y, bv = eB.v;

  const swap = (ax > bx) || (ax === bx && ay > by);
  const x0 = swap ? bx : ax, y0 = swap ? by : ay, v0 = swap ? bv : av;
  const x1 = swap ? ax : bx, y1 = swap ? ay : by, v1 = swap ? av : bv;
  const t = (threshold - v0) / ((v1 - v0) || 1e-9);
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, v: threshold, edgeA: eA, edgeB: eB, isCut: true };
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
      if (!prevIn) out.push(interpCellEdgeCanonical(prev, curr, threshold));
      out.push(curr);
    } else if (prevIn) {
      out.push(interpCellEdgeCanonical(prev, curr, threshold));
    }
  }

  for (let i = 0; i < out.length; i++) {
    const a = out[i], b = out[(i + 1) % out.length];
    if (a.isCut && b.isCut) cutSegments.push([a, b]);
  }
  return { poly: out, cuts: cutSegments };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BITMAP_FONT_5X3,
    pushTri,
    pushQuad,
    computeFaceNormal,
    isDegenerateTri3D,
    emitClosedPrism,
    emitPolygonWithHolesSlab3D,
    emitUndersideIdPatch,
    addTreeCrown3D,
    interpCellEdgeCanonical,
    clipCellPolyByScalar
  };
}
