// ============================================================================
// src/mesh/features_greenery.js
// Greenery Layer: Park/Forest/Lawn Mask Construction & 3D Greenery Mesh Emission
// ============================================================================

if (typeof computeEuclideanDistGrid === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('../geometry/marching_squares_2d.js'));
}
if (typeof buildSmoothedBandField === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./mesh_tile_append.js'));
}

function _ringBBox2D(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const x = ring[i][0], y = ring[i][1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function _ringPerimeter2D(ring) {
  let len = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

function _intersectCanonical2D(p0, p1, la, lb) {
  let s0 = p0, s1 = p1;
  if (s1[0] < s0[0] || (s1[0] === s0[0] && s1[1] < s0[1])) { s0 = p1; s1 = p0; }
  let c0 = la, c1 = lb;
  if (c1[0] < c0[0] || (c1[0] === c0[0] && c1[1] < c0[1])) { c0 = lb; c1 = la; }
  const lx = c1[0] - c0[0], ly = c1[1] - c0[1];
  const d0 = lx * (s0[1] - c0[1]) - ly * (s0[0] - c0[0]);
  const d1 = lx * (s1[1] - c0[1]) - ly * (s1[0] - c0[0]);
  const denom = d0 - d1;
  if (Math.abs(denom) < 1e-15) return [0.5 * (s0[0] + s1[0]), 0.5 * (s0[1] + s1[1])];
  const t = Math.max(0, Math.min(1, d0 / denom));
  return [s0[0] + t * (s1[0] - s0[0]), s0[1] + t * (s1[1] - s0[1])];
}

// Clips convex polygon `poly` against half-plane of directed edge `a -> b` (shifted inward by `insetDist`).
// When `keepLeft` is true, keeps `nx*(x - a.x) + ny*(y - a.y) >= insetDist` where `n = (-ey, ex)/|e|`.
function _clipConvexByEdgeHalfPlane2D(poly, a, b, keepLeft, insetDist = 0.0) {
  if (!poly || poly.length < 3) return [];
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const len = Math.hypot(ex, ey);
  if (len < 1e-12) return poly;
  const sgn = keepLeft ? 1.0 : -1.0;
  const nx = (-ey / len) * sgn;
  const ny = (ex / len) * sgn;
  const ox = a[0] + nx * insetDist;
  const oy = a[1] + ny * insetDist;
  const lb = [ox - ny, oy + nx];

  const out = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const cur = poly[i];
    const nxt = poly[(i + 1) % n];
    const dCur = (cur[0] - ox) * nx + (cur[1] - oy) * ny;
    const dNxt = (nxt[0] - ox) * nx + (nxt[1] - oy) * ny;
    const inCur = dCur >= -1e-9;
    const inNxt = dNxt >= -1e-9;
    if (inCur && inNxt) {
      out.push(nxt);
    } else if (inCur && !inNxt) {
      out.push(_intersectCanonical2D(cur, nxt, [ox, oy], lb));
    } else if (!inCur && inNxt) {
      out.push(_intersectCanonical2D(cur, nxt, [ox, oy], lb));
      out.push(nxt);
    }
  }
  if (out.length < 3) return [];
  const cleaned = [];
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    if (!cleaned.length || Math.hypot(p[0] - cleaned[cleaned.length - 1][0], p[1] - cleaned[cleaned.length - 1][1]) > 1e-6) {
      cleaned.push(p);
    }
  }
  if (cleaned.length >= 2 && Math.hypot(cleaned[0][0] - cleaned[cleaned.length - 1][0], cleaned[0][1] - cleaned[cleaned.length - 1][1]) <= 1e-6) {
    cleaned.pop();
  }
  return (cleaned.length >= 3 && signedArea2D(cleaned) > 1e-7) ? cleaned : [];
}

function _subtractTrianglesFromConvexPieces2D(piecesInput, cutTris) {
  let pieces = piecesInput;
  for (let ci = 0; ci < cutTris.length && pieces.length > 0; ci++) {
    const tri = cutTris[ci];
    const cb = _ringBBox2D(tri);
    const nextPieces = [];
    for (let pi = 0; pi < pieces.length; pi++) {
      const pc = pieces[pi];
      const pb = _ringBBox2D(pc);
      if (pb[2] <= cb[0] + 1e-7 || pb[0] >= cb[2] - 1e-7 || pb[3] <= cb[1] + 1e-7 || pb[1] >= cb[3] - 1e-7) {
        nextPieces.push(pc);
        continue;
      }
      let rem = pc;
      const subOut = [];
      for (let ek = 0; ek < 3 && rem && rem.length >= 3; ek++) {
        const ea = tri[ek], eb = tri[(ek + 1) % 3];
        const outPart = _clipConvexByEdgeHalfPlane2D(rem, ea, eb, false, 0.0);
        if (outPart.length >= 3) subOut.push(outPart);
        rem = _clipConvexByEdgeHalfPlane2D(rem, ea, eb, true, 0.0);
      }
      if (rem && rem.length >= 3) {
        for (let si = 0; si < subOut.length; si++) nextPieces.push(subOut[si]);
      } else {
        nextPieces.push(pc);
      }
    }
    pieces = nextPieces;
  }
  return pieces;
}

function _triangulatePolygonWithHoles2D(outerPts, holesPts) {
  if (!outerPts || outerPts.length < 3) return [];
  let outerClean = cleanPolygonRing(outerPts, true);
  if (outerClean.length < 3) {
    outerClean = outerPts.map(p => [p[0], p[1]]);
    if (Math.abs(signedArea2D(outerClean)) < 1e-6) return [];
    if (signedArea2D(outerClean) < 0) outerClean.reverse();
  }
  const validHoles = [];
  if (holesPts && holesPts.length > 0) {
    for (let h = 0; h < holesPts.length; h++) {
      let hc = cleanPolygonRing(holesPts[h], false);
      if (hc.length < 3) {
        hc = holesPts[h].map(p => [p[0], p[1]]);
        if (signedArea2D(hc) > 0) hc.reverse();
      }
      if (hc.length >= 3 && Math.abs(signedArea2D(hc)) > 1e-5) {
        if (hc.some(pt => pointInPoly2D(pt[0], pt[1], outerClean))) validHoles.push(hc);
      }
    }
  }
  const mergedHoles = [];
  let ring = validHoles.length > 0
    ? mergeHolesIntoOuterKeyhole(outerClean, validHoles, mergedHoles)
    : outerClean;
  if (!ring || ring.length < 3) ring = outerClean;
  const triangulator = (typeof triangulateCutLoopExact === 'function' && mergedHoles.length > 0)
    ? triangulateCutLoopExact
    : triangulateSimplePoly;
  let pieces = triangulator(ring) || [];
  if (validHoles.length > mergedHoles.length && pieces.length > 0) {
    const mergedSet = new Set(mergedHoles);
    const unmergedTris = [];
    for (let h = 0; h < validHoles.length; h++) {
      if (mergedSet.has(validHoles[h])) continue;
      const ccwHole = validHoles[h].slice().reverse();
      const hTris = triangulateSimplePoly(ccwHole) || [];
      for (let ti = 0; ti < hTris.length; ti++) unmergedTris.push(hTris[ti]);
    }
    if (unmergedTris.length > 0) {
      pieces = _subtractTrianglesFromConvexPieces2D(pieces, unmergedTris);
    }
  }
  return pieces;
}

// Reconstructs interior-disjoint `{ outer, area, holes }` polygons from interior-disjoint CCW convex pieces
// by welding shared vertices, splitting collinear T-junctions, and cancelling shared interior edges.
function _reconstructPolygonsFromConvexPieces2D(pieces) {
  if (!pieces || !pieces.length) return [];
  const WELD = 2e-5;
  const invW = 1.0 / WELD;
  const vGrid = new Map();
  const verts = [];

  const getVid = (x, y) => {
    const gx = Math.floor(x * invW), gy = Math.floor(y * invW);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = vGrid.get((gx + dx) + '_' + (gy + dy));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const id = list[k];
          if (Math.hypot(verts[id][0] - x, verts[id][1] - y) <= WELD) return id;
        }
      }
    }
    const id = verts.length;
    verts.push([x, y]);
    const key = gx + '_' + gy;
    let bucket = vGrid.get(key);
    if (!bucket) { bucket = []; vGrid.set(key, bucket); }
    bucket.push(id);
    return id;
  };

  const rawEdges = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const ids = [];
    for (let j = 0; j < p.length; j++) {
      const id = getVid(p[j][0], p[j][1]);
      if (!ids.length || ids[ids.length - 1] !== id) ids.push(id);
    }
    if (ids.length >= 2 && ids[0] === ids[ids.length - 1]) ids.pop();
    if (ids.length < 3) continue;
    for (let j = 0; j < ids.length; j++) {
      rawEdges.push([ids[j], ids[(j + 1) % ids.length]]);
    }
  }
  if (!rawEdges.length) return [];

  const CELL = 0.5;
  const sGrid = new Map();
  for (let id = 0; id < verts.length; id++) {
    const cx = Math.floor(verts[id][0] / CELL), cy = Math.floor(verts[id][1] / CELL);
    const key = cx + '_' + cy;
    let b = sGrid.get(key);
    if (!b) { b = []; sGrid.set(key, b); }
    b.push(id);
  }

  const edgeCounts = new Map();
  const addDirEdge = (u, v) => {
    if (u === v) return;
    const k = u + '_' + v;
    edgeCounts.set(k, (edgeCounts.get(k) || 0) + 1);
  };

  for (let i = 0; i < rawEdges.length; i++) {
    const [u, v] = rawEdges[i];
    const a = verts[u], b = verts[v];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-10) continue;
    const invLen = 1.0 / Math.sqrt(lenSq);
    const x0 = Math.floor((Math.min(a[0], b[0]) - 1e-4) / CELL);
    const x1 = Math.floor((Math.max(a[0], b[0]) + 1e-4) / CELL);
    const y0 = Math.floor((Math.min(a[1], b[1]) - 1e-4) / CELL);
    const y1 = Math.floor((Math.max(a[1], b[1]) + 1e-4) / CELL);
    let splits = null;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = sGrid.get(cx + '_' + cy);
        if (!list) continue;
        for (let m = 0; m < list.length; m++) {
          const w = list[m];
          if (w === u || w === v) continue;
          const pw = verts[w];
          const perp = Math.abs((pw[0] - a[0]) * dy - (pw[1] - a[1]) * dx) * invLen;
          if (perp > 3.5e-5) continue;
          const t = ((pw[0] - a[0]) * dx + (pw[1] - a[1]) * dy) / lenSq;
          if (t > 1e-5 && t < 1.0 - 1e-5) {
            if (!splits) splits = [];
            splits.push({ w, t });
          }
        }
      }
    }
    if (!splits) {
      addDirEdge(u, v);
    } else {
      splits.sort((p, q) => p.t - q.t);
      let prev = u;
      for (let s = 0; s < splits.length; s++) {
        if (splits[s].w !== prev) {
          addDirEdge(prev, splits[s].w);
          prev = splits[s].w;
        }
      }
      addDirEdge(prev, v);
    }
  }

  const adj = new Map();
  for (const [k, cnt] of edgeCounts.entries()) {
    if (cnt <= 0) continue;
    const sep = k.indexOf('_');
    const u = Number(k.slice(0, sep)), v = Number(k.slice(sep + 1));
    const revCnt = edgeCounts.get(v + '_' + u) || 0;
    const net = cnt - Math.min(cnt, revCnt);
    if (net > 0) {
      let out = adj.get(u);
      if (!out) { out = []; adj.set(u, out); }
      for (let c = 0; c < net; c++) out.push(v);
    }
  }

  const outers = [];
  const holes = [];
  for (const [startU, startOut] of adj.entries()) {
    while (startOut.length > 0) {
      const startV = startOut.pop();
      const ringIds = [startU];
      let prevU = startU, curU = startV;
      let guard = 0;
      while (curU !== startU && guard++ < verts.length * 4) {
        ringIds.push(curU);
        const choices = adj.get(curU);
        if (!choices || !choices.length) break;
        let pickIdx = 0;
        if (choices.length > 1) {
          const pPrev = verts[prevU], pCur = verts[curU];
          const backAng = Math.atan2(pPrev[1] - pCur[1], pPrev[0] - pCur[0]);
          let bestTurn = Infinity;
          for (let ci = 0; ci < choices.length; ci++) {
            const pNxt = verts[choices[ci]];
            let turn = Math.atan2(pNxt[1] - pCur[1], pNxt[0] - pCur[0]) - backAng;
            while (turn <= 1e-9) turn += Math.PI * 2;
            if (turn < bestTurn) { bestTurn = turn; pickIdx = ci; }
          }
        }
        const nxtV = choices[pickIdx];
        choices.splice(pickIdx, 1);
        prevU = curU;
        curU = nxtV;
      }
      if (curU !== startU || ringIds.length < 3) continue;
      const pts = ringIds.map(id => [verts[id][0], verts[id][1]]);
      const area = signedArea2D(pts);
      if (area > 1e-4) outers.push({ outer: pts, area, holes: [] });
      else if (area < -1e-4) holes.push(pts);
    }
  }

  for (let hi = 0; hi < holes.length; hi++) {
    const h = holes[hi];
    const hArea = Math.abs(signedArea2D(h));
    let bestIdx = -1, bestArea = Infinity;
    for (let oi = 0; oi < outers.length; oi++) {
      if (outers[oi].area > hArea && outers[oi].area < bestArea &&
          h.some(pt => pointInPoly2D(pt[0], pt[1], outers[oi].outer))) {
        bestArea = outers[oi].area;
        bestIdx = oi;
      }
    }
    if (bestIdx >= 0) outers[bestIdx].holes.push(h);
  }
  return outers;
}

// Idempotently carves explicit parks/gardens/grass/flowerbeds out of overlapping polygonal squares
// (`scene.roadPolys`) so town-square gardens (e.g. Gärtnerplatz, Market Square) win over outer square polygons,
// while linear motor streets (`scene.roads`), buildings, water, and small plazas nested inside huge parks still cut greenery.
function _carveSquareGreenIslandsFromRoadPolys(greenPolys, roadPolys) {
  if (!Array.isArray(greenPolys) || !greenPolys.length || !Array.isArray(roadPolys) || !roadPolys.length) return;

  const greenMeta = [];
  for (let gi = 0; gi < greenPolys.length; gi++) {
    const gp = greenPolys[gi];
    if (!gp || !gp.outer || gp.outer.length < 3) continue;
    const area = Math.abs(signedArea2D(gp.outer));
    if (area < 1e-4) continue;
    greenMeta.push({ gp, area, bbox: _ringBBox2D(gp.outer), tris: null });
  }
  if (!greenMeta.length) return;

  const extraRoadPolys = [];
  for (let ri = 0; ri < roadPolys.length; ri++) {
    const rp = roadPolys[ri];
    if (!rp || rp._greenIslandsCarved || !rp.outer || rp.outer.length < 3) continue;
    Object.defineProperty(rp, '_greenIslandsCarved', { value: true, enumerable: false, configurable: true });

    const rArea = Math.abs(signedArea2D(rp.outer));
    if (rArea < 1e-4) continue;
    const rBBox = _ringBBox2D(rp.outer);

    const cutters = [];
    for (let gi = 0; gi < greenMeta.length; gi++) {
      const gm = greenMeta[gi];
      if (gm.bbox[2] < rBBox[0] || gm.bbox[0] > rBBox[2] || gm.bbox[3] < rBBox[1] || gm.bbox[1] > rBBox[3]) continue;
      if (rArea < gm.area * 0.45) {
        let inCnt = 0;
        for (let vi = 0; vi < rp.outer.length; vi++) {
          const p = rp.outer[vi];
          if (pointInPoly2D(p[0], p[1], gm.gp.outer) &&
              !(gm.gp.holes || []).some(h => pointInPoly2D(p[0], p[1], h))) {
            inCnt++;
          }
        }
        if (inCnt >= rp.outer.length * 0.75) continue;
      }
      cutters.push(gm);
    }
    if (!cutters.length) continue;

    const cutTris = [];
    for (let ci = 0; ci < cutters.length; ci++) {
      const gm = cutters[ci];
      if (!gm.tris) {
        gm.tris = _triangulatePolygonWithHoles2D(gm.gp.outer, gm.gp.holes || [])
          .map(t => ({ tri: t, bbox: _ringBBox2D(t) }));
      }
      for (let ti = 0; ti < gm.tris.length; ti++) {
        const tb = gm.tris[ti].bbox;
        if (tb[2] < rBBox[0] || tb[0] > rBBox[2] || tb[3] < rBBox[1] || tb[1] > rBBox[3]) continue;
        cutTris.push(gm.tris[ti]);
      }
    }
    if (!cutTris.length) continue;

    let pieces = _triangulatePolygonWithHoles2D(rp.outer, rp.holes || []);
    if (!pieces.length) continue;

    let anyCut = false;
    for (let ci = 0; ci < cutTris.length && pieces.length > 0; ci++) {
      const { tri, bbox: cb } = cutTris[ci];
      const nextPieces = [];
      for (let pi = 0; pi < pieces.length; pi++) {
        const pc = pieces[pi];
        const pb = _ringBBox2D(pc);
        if (pb[2] <= cb[0] + 1e-7 || pb[0] >= cb[2] - 1e-7 || pb[3] <= cb[1] + 1e-7 || pb[1] >= cb[3] - 1e-7) {
          nextPieces.push(pc);
          continue;
        }
        let rem = pc;
        const subOut = [];
        for (let ek = 0; ek < 3 && rem && rem.length >= 3; ek++) {
          const ea = tri[ek], eb = tri[(ek + 1) % 3];
          const outPart = _clipConvexByEdgeHalfPlane2D(rem, ea, eb, false, 0.0);
          if (outPart.length >= 3) subOut.push(outPart);
          rem = _clipConvexByEdgeHalfPlane2D(rem, ea, eb, true, 0.0);
        }
        if (rem && rem.length >= 3) {
          anyCut = true;
          for (let si = 0; si < subOut.length; si++) nextPieces.push(subOut[si]);
        } else {
          nextPieces.push(pc);
        }
      }
      pieces = nextPieces;
    }

    if (!anyCut) continue;
    if (!pieces.length) {
      rp.outer = [];
      rp.holes = [];
      continue;
    }

    const rebuilt = _reconstructPolygonsFromConvexPieces2D(pieces);
    if (!rebuilt.length) {
      rp.outer = [];
      rp.holes = [];
      continue;
    }
    rp.outer = rebuilt[0].outer;
    rp.holes = rebuilt[0].holes;
    for (let k = 1; k < rebuilt.length; k++) {
      const extra = { outer: rebuilt[k].outer, holes: rebuilt[k].holes, name: rp.name || '' };
      Object.defineProperty(extra, '_greenIslandsCarved', { value: true, enumerable: false, configurable: true });
      extraRoadPolys.push(extra);
    }
  }

  for (let i = 0; i < extraRoadPolys.length; i++) {
    roadPolys.push(extraRoadPolys[i]);
  }
}

function buildRawGreeneryMask(scene, mctx, maskEnv) {
  const { MASK_RES_X, MASK_RES_Y, scaleMm, pxPerUnit, toBed, bedToMask } = maskEnv;
  const greenList = (scene && (scene.greenPolys || scene.greeneryPolys)) || [];

  if (scene && scene.roadPolys) {
    _carveSquareGreenIslandsFromRoadPolys(greenList, scene.roadPolys);
  }

  mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
  fillPolysOnMaskCtx(mctx, greenList, toBed, bedToMask);

  const bulkStrokePx = Math.max(1.15, Math.min(0.22, 0.28 / scaleMm) * pxPerUnit);
  const slenderStrokePx = Math.max(1.85, Math.min(0.28, 0.36 / scaleMm) * pxPerUnit);
  const slenderPolys = [];
  const strokedHoles = [];

  mctx.lineWidth = bulkStrokePx;
  for (let gi = 0; gi < greenList.length; gi++) {
    const poly = greenList[gi];
    if (!poly || !poly.outer || poly.outer.length < 3) continue;
    const bedPts = poly.outer.map(toBed);
    const areaBed = Math.abs(signedArea2D(bedPts));
    const perimBed = _ringPerimeter2D(bedPts);
    const estWidthUnits = perimBed > 1e-4 ? (4.0 * areaBed / perimBed) : 999.0;
    const hasHoles = Boolean(poly.holes && poly.holes.length > 0);

    if (estWidthUnits < 1.8) slenderPolys.push({ poly, bedPts, hasHoles });
    if (hasHoles) continue;

    mctx.beginPath();
    for (let i = 0; i < bedPts.length; i++) {
      const [px, py] = bedToMask(bedPts[i][0], bedPts[i][1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    }
    mctx.closePath();
    mctx.stroke();
  }

  const coreGreenImg = safeGetImageData(mctx, 0, 0, MASK_RES_X, MASK_RES_Y).data;
  const rawGreenMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  for (let i = 0; i < rawGreenMask.length; i++) {
    if (coreGreenImg[i * 4 + 3] > 64) rawGreenMask[i] = 1;
  }

  if (slenderPolys.length > 0) {
    mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
    mctx.lineWidth = slenderStrokePx;
    for (let si = 0; si < slenderPolys.length; si++) {
      const { poly, bedPts, hasHoles } = slenderPolys[si];
      mctx.beginPath();
      for (let i = 0; i < bedPts.length; i++) {
        const [px, py] = bedToMask(bedPts[i][0], bedPts[i][1]);
        if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
      }
      mctx.closePath();
      mctx.stroke();
      if (hasHoles) {
        for (let hi = 0; hi < poly.holes.length; hi++) {
          if (poly.holes[hi] && poly.holes[hi].length >= 3) strokedHoles.push(poly.holes[hi]);
        }
      }
    }
    const slImg = safeGetImageData(mctx, 0, 0, MASK_RES_X, MASK_RES_Y).data;
    for (let i = 0; i < rawGreenMask.length; i++) {
      if (!rawGreenMask[i] && slImg[i * 4 + 3] > 64) rawGreenMask[i] = 2;
    }
  }

  if (strokedHoles.length > 0) {
    const pureHoles = strokedHoles.filter(h => {
      for (let gi = 0; gi < greenList.length; gi++) {
        const gp = greenList[gi];
        if (gp && gp.outer && gp.outer.length >= 3 && pointInPoly2D(gp.outer[0][0], gp.outer[0][1], h)) {
          return false;
        }
      }
      return true;
    });
    if (pureHoles.length > 0) {
      mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
      fillPolysOnMaskCtx(mctx, pureHoles.map(h => ({ outer: h, holes: [] })), toBed, bedToMask);
      const holeImg = safeGetImageData(mctx, 0, 0, MASK_RES_X, MASK_RES_Y).data;
      for (let i = 0; i < rawGreenMask.length; i++) {
        if (holeImg[i * 4 + 3] > 96) rawGreenMask[i] = 0;
      }
    }
  }

  return rawGreenMask;
}

function finalizeGreeneryMask(rawGreenMask, waterMask, shoreDist, bldMask, majorRoadImg, MASK_RES_X, MASK_RES_Y) {
  const greenMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  const nx = MASK_RES_X, ny = MASK_RES_Y;
  for (let y = 0; y < ny; y++) {
    const r = y * nx;
    for (let x = 0; x < nx; x++) {
      const i = r + x;
      const rg = rawGreenMask[i];
      if (!rg) continue;
      const clearOfWater = !waterMask[i] && shoreDist[i] >= 1.15;
      const clearRoadHalo = majorRoadImg[i * 4 + 3] <= 96;
      if (!clearOfWater || bldMask[i] || !clearRoadHalo) continue;
      if (rg === 2) {
        if (x <= 0 || x >= nx - 1 || y <= 0 || y >= ny - 1) continue;
        let nearObs = false;
        for (let dy = -1; dy <= 1 && !nearObs; dy++) {
          const nr = (y + dy) * nx + x;
          for (let dx = -1; dx <= 1; dx++) {
            const ni = nr + dx;
            if (bldMask[ni] || waterMask[ni] || majorRoadImg[ni * 4 + 3] > 96) {
              nearObs = true;
              break;
            }
          }
        }
        if (nearObs) continue;
      }
      greenMask[i] = 1;
    }
  }
  const greenInnerDist = computeEuclideanDistGrid(greenMask, MASK_RES_X, MASK_RES_Y, true);
  const greenOuterDist = computeEuclideanDistGrid(greenMask, MASK_RES_X, MASK_RES_Y, false);
  return { greenMask, greenInnerDist, greenOuterDist };
}

// Builds a continuous dry-land greenery scalar field across all DEM contour bands simultaneously
// (zero rPx=3 concentric hill-forest dead zones), with C0 thin-ridge preservation so 1-2px grass
// medians never pinch into beads and strict obstacle capping so greenery never overlaps water/buildings/roads.
function _buildContinuousGreeneryFieldAndSupport(ctx, bandAssigner) {
  const { MASK_RES_X: nx, MASK_RES_Y: ny, greenMask, waterMask, bldMask, majorRoadMask } = ctx;
  const { pixelBandIdx, printedSurfaceState, bandHasGreen } = bandAssigner;
  const rawGrid = bandAssigner.rawBandGrid || pixelBandIdx;

  // Keep 1-px margin only against underwater/bed-edge pixels (rawGrid < 0), NEVER between dry contour steps >= 0
  const drySupportMask = new Uint8Array(nx * ny);
  for (let iy = 1; iy < ny - 1; iy++) {
    const r = iy * nx;
    for (let ix = 1; ix < nx - 1; ix++) {
      if (rawGrid[r + ix] < 0) continue;
      if (rawGrid[r - nx + ix - 1] >= 0 && rawGrid[r - nx + ix] >= 0 && rawGrid[r - nx + ix + 1] >= 0 &&
          rawGrid[r + ix - 1] >= 0 && rawGrid[r + ix + 1] >= 0 &&
          rawGrid[r + nx + ix - 1] >= 0 && rawGrid[r + nx + ix] >= 0 && rawGrid[r + nx + ix + 1] >= 0) {
        drySupportMask[r + ix] = 1;
      }
    }
  }

  const flipped = new Float32Array(nx * ny);
  let activeCount = 0;
  for (let iy = 0; iy < ny; iy++) {
    const srcRow = (ny - 1 - iy) * nx;
    const dstRow = iy * nx;
    for (let ix = 0; ix < nx; ix++) {
      const dstIdx = dstRow + ix;
      if (greenMask[srcRow + ix] && drySupportMask[dstIdx]) {
        flipped[dstIdx] = 1.0;
        activeCount++;
        const k = rawGrid[dstIdx];
        if (k >= 0 && k < bandHasGreen.length) bandHasGreen[k] = 1;
      }
    }
  }
  if (activeCount < 3) return null;

  const conv = new Float32Array(nx * ny);
  for (let iy = 1; iy < ny - 1; iy++) {
    const r = iy * nx;
    for (let ix = 1; ix < nx - 1; ix++) {
      const sum =
        flipped[r - nx + ix - 1] + 2 * flipped[r - nx + ix] + flipped[r - nx + ix + 1] +
        2 * flipped[r + ix - 1] + 8 * flipped[r + ix] + 2 * flipped[r + ix + 1] +
        flipped[r + nx + ix - 1] + 2 * flipped[r + nx + ix] + flipped[r + nx + ix + 1];
      conv[r + ix] = sum / 20.0;
    }
  }

  const isObsSrc = (si) => Boolean(
    (waterMask && waterMask[si]) ||
    (bldMask && bldMask[si]) ||
    (majorRoadMask && majorRoadMask[si])
  );

  const field = new Float32Array(nx * ny);
  for (let iy = 1; iy < ny - 1; iy++) {
    const r = iy * nx;
    const srcRow = (ny - 1 - iy) * nx;
    for (let ix = 1; ix < nx - 1; ix++) {
      const idx = r + ix;
      if (!drySupportMask[idx]) {
        field[idx] = 0.0;
        continue;
      }
      const srcIdx = srcRow + ix;
      if (flipped[idx] > 0.5) {
        let max3 = conv[idx];
        for (let dy = -1; dy <= 1; dy++) {
          const nr = (iy + dy) * nx + ix;
          if (conv[nr - 1] > max3) max3 = conv[nr - 1];
          if (conv[nr] > max3) max3 = conv[nr];
          if (conv[nr + 1] > max3) max3 = conv[nr + 1];
        }
        const adjBld = bldMask && (
          bldMask[srcIdx - 1] || bldMask[srcIdx + 1] ||
          bldMask[srcIdx - nx] || bldMask[srcIdx + nx] ||
          bldMask[srcIdx - nx - 1] || bldMask[srcIdx - nx + 1] ||
          bldMask[srcIdx + nx - 1] || bldMask[srcIdx + nx + 1]
        );
        if (adjBld) {
          field[idx] = conv[idx];
        } else {
          const adjRoad = majorRoadMask && (
            majorRoadMask[srcIdx - 1] || majorRoadMask[srcIdx + 1] ||
            majorRoadMask[srcIdx - nx] || majorRoadMask[srcIdx + nx] ||
            majorRoadMask[srcIdx - nx - 1] || majorRoadMask[srcIdx - nx + 1] ||
            majorRoadMask[srcIdx + nx - 1] || majorRoadMask[srcIdx + nx + 1]
          );
          const target = adjRoad ? 0.72 : 0.84;
          const ridgeBoost = Math.max(0.0, target - max3);
          field[idx] = ridgeBoost > 0.0 ? Math.min(target, conv[idx] + ridgeBoost) : conv[idx];
        }
      } else {
        field[idx] = isObsSrc(srcIdx) ? 0.0 : conv[idx];
      }
    }
  }

  // Mark printed lawn support for downstream park footpaths & 3D trees inside uniform contour bands
  for (let iy = 1; iy < ny - 1; iy++) {
    const r = iy * nx;
    for (let ix = 1; ix < nx - 1; ix++) {
      if (pixelBandIdx[r + ix] < 0) continue;
      const gf = field[r + ix];
      if (gf >= 0.78 &&
          field[r - nx + ix] >= 0.56 && field[r + nx + ix] >= 0.56 &&
          field[r + ix - 1] >= 0.56 && field[r + ix + 1] >= 0.56) {
        printedSurfaceState[r + ix] = 1;
      } else if (gf > 0.22) {
        printedSurfaceState[r + ix] = 0;
      }
    }
  }

  return field;
}

function _cleanLoopFine2D(ptsInput, wantCCW, minDist = 0.0035) {
  if (!ptsInput || ptsInput.length < 3) return [];
  let pts = [];
  for (let i = 0; i < ptsInput.length; i++) {
    const p = ptsInput[i];
    if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > minDist) {
      pts.push([p[0], p[1]]);
    }
  }
  if (pts.length >= 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= minDist) {
    pts.pop();
  }
  if (pts.length < 3) return [];
  const area = signedArea2D(pts);
  if (Math.abs(area) < 1e-4) return [];
  if (wantCCW ? area < 0 : area > 0) pts.reverse();

  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    const next = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[(i + n - 1) % n];
      const b = pts[i];
      const c = pts[(i + 1) % n];
      const ux = b[0] - a[0], uy = b[1] - a[1];
      const vx = c[0] - b[0], vy = c[1] - b[1];
      const l1 = Math.hypot(ux, uy), l2 = Math.hypot(vx, vy);
      if (l1 < minDist || Math.hypot(c[0] - a[0], c[1] - a[1]) < minDist) {
        changed = true;
        continue;
      }
      const sinTheta = Math.abs(ux * vy - uy * vx) / ((l1 * l2) || 1e-9);
      if (sinTheta < 0.004) {
        changed = true;
        continue;
      }
      next.push(b);
    }
    pts = next;
  }
  return (pts.length >= 3 && Math.abs(signedArea2D(pts)) >= 1e-4) ? pts : [];
}

function _isStrictManifoldShell3D(tris, scaleMm) {
  if (!tris || tris.length < 4) return false;
  const checkQuant = (keyFn) => {
    const vMap = new Map();
    let nv = 0;
    const vid = (p) => {
      const k = keyFn(p);
      let id = vMap.get(k);
      if (id === undefined) { id = nv++; vMap.set(k, id); }
      return id;
    };
    const dir = new Map();
    let vol6 = 0;
    for (let i = 0; i < tris.length; i++) {
      const { v0: a, v1: b, v2: c } = tris[i];
      const ia = vid(a), ib = vid(b), ic = vid(c);
      if (ia === ib || ib === ic || ic === ia) return false;
      vol6 += a[0] * (b[1] * c[2] - b[2] * c[1]) -
              a[1] * (b[0] * c[2] - b[2] * c[0]) +
              a[2] * (b[0] * c[1] - b[1] * c[0]);
      for (const [u, v] of [[ia, ib], [ib, ic], [ic, ia]]) {
        const ek = u + '_' + v;
        if (dir.has(ek)) return false;
        dir.set(ek, 1);
      }
    }
    if (vol6 <= 1e-9) return false;
    for (const ek of dir.keys()) {
      const sep = ek.indexOf('_');
      const rk = ek.slice(sep + 1) + '_' + ek.slice(0, sep);
      if (!dir.has(rk)) return false;
    }
    return true;
  };

  const s = scaleMm || 1.89;
  return checkQuant(p => `${Math.round(p[0] * 5000)}_${Math.round(p[1] * 5000)}_${Math.round(p[2] * 5000)}`) &&
         checkQuant(p => `${((p[0] + 84.6) * s).toFixed(3)}_${((p[1] + 84.6) * s).toFixed(3)}_${Math.max(0, p[2] * s).toFixed(3)}`);
}

// Directly extrudes interior-disjoint CCW 2D pieces (with arbitrary holes, hilltop rings,
// islands-in-holes, and <0.047u chamfer crescents) into 100% watertight 2-manifold 3D shells
// by welding vertices above quantization threshold, splitting T-junctions, separating pinch
// vertices per angular wedge, cancelling shared interior 2D edges, and capping boundary edges.
function _extrudePlanarPiecesToManifoldSlabs3D(pieces, zBot, zTop, layerId, outMesh, tileId, allocShellId, scaleMm) {
  if (!pieces || !pieces.length || zTop - zBot <= 1e-6) return;

  const SNAP = Math.max(0.0022, 0.0022 / Math.min(1.0, scaleMm || 1.0));
  const invS = 1.0 / SNAP;
  const vGrid = new Map();
  const verts = [];

  const getVid = (x, y) => {
    const gx = Math.floor(x * invS), gy = Math.floor(y * invS);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = vGrid.get((gx + dx) + '_' + (gy + dy));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const id = list[k];
          if (Math.hypot(verts[id][0] - x, verts[id][1] - y) <= SNAP) return id;
        }
      }
    }
    const id = verts.length;
    verts.push([x, y]);
    const key = gx + '_' + gy;
    let bucket = vGrid.get(key);
    if (!bucket) { bucket = []; vGrid.set(key, bucket); }
    bucket.push(id);
    return id;
  };

  const pieceRings = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (!p || p.length < 3) continue;
    const ids = [];
    for (let j = 0; j < p.length; j++) {
      const id = getVid(p[j][0], p[j][1]);
      if (!ids.length || ids[ids.length - 1] !== id) ids.push(id);
    }
    if (ids.length >= 2 && ids[0] === ids[ids.length - 1]) ids.pop();
    if (ids.length >= 3) pieceRings.push(ids);
  }
  if (!pieceRings.length) return;

  const CELL = 0.5;
  const sGrid = new Map();
  for (let id = 0; id < verts.length; id++) {
    const cx = Math.floor(verts[id][0] / CELL), cy = Math.floor(verts[id][1] / CELL);
    const key = cx + '_' + cy;
    let b = sGrid.get(key);
    if (!b) { b = []; sGrid.set(key, b); }
    b.push(id);
  }

  const perpTol = SNAP * 0.72;
  const splitEdgeInto = (u, v, outIds) => {
    outIds.push(u);
    const a = verts[u], b = verts[v];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-10) return;
    const invLen = 1.0 / Math.sqrt(lenSq);
    const x0 = Math.floor((Math.min(a[0], b[0]) - 4e-3) / CELL);
    const x1 = Math.floor((Math.max(a[0], b[0]) + 4e-3) / CELL);
    const y0 = Math.floor((Math.min(a[1], b[1]) - 4e-3) / CELL);
    const y1 = Math.floor((Math.max(a[1], b[1]) + 4e-3) / CELL);
    let splits = null;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = sGrid.get(cx + '_' + cy);
        if (!list) continue;
        for (let m = 0; m < list.length; m++) {
          const w = list[m];
          if (w === u || w === v) continue;
          const pw = verts[w];
          const perp = Math.abs((pw[0] - a[0]) * dy - (pw[1] - a[1]) * dx) * invLen;
          if (perp > perpTol) continue;
          const t = ((pw[0] - a[0]) * dx + (pw[1] - a[1]) * dy) / lenSq;
          if (t > 1e-4 && t < 1.0 - 1e-4) {
            if (!splits) splits = [];
            splits.push({ w, t });
          }
        }
      }
    }
    if (splits) {
      splits.sort((p, q) => p.t - q.t);
      let prev = u;
      for (let s = 0; s < splits.length; s++) {
        const wid = splits[s].w;
        if (wid !== prev && wid !== v) {
          outIds.push(wid);
          prev = wid;
        }
      }
    }
  };

  const dirUsed = new Set();
  const tris = [];
  const tryAddTri = (ia, ib, ic) => {
    if (ia === ib || ib === ic || ic === ia) return;
    const a = verts[ia], b = verts[ib], c = verts[ic];
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cr <= 1e-8) return;
    const e0 = ia + '_' + ib, e1 = ib + '_' + ic, e2 = ic + '_' + ia;
    if (dirUsed.has(e0) || dirUsed.has(e1) || dirUsed.has(e2)) return;
    dirUsed.add(e0);
    dirUsed.add(e1);
    dirUsed.add(e2);
    tris.push([ia, ib, ic]);
  };

  for (let pi = 0; pi < pieceRings.length; pi++) {
    const raw = pieceRings[pi];
    let ring = [];
    for (let j = 0, n = raw.length; j < n; j++) {
      splitEdgeInto(raw[j], raw[(j + 1) % n], ring);
    }
    let changed = true;
    while (changed && ring.length >= 3) {
      changed = false;
      const next = [];
      for (let j = 0; j < ring.length; j++) {
        const prev = next.length ? next[next.length - 1] : ring[ring.length - 1];
        const cur = ring[j];
        const nxt = ring[(j + 1) % ring.length];
        if (cur === prev || prev === nxt) {
          if (prev === nxt && next.length) next.pop();
          changed = true;
          continue;
        }
        next.push(cur);
      }
      ring = next;
    }
    if (ring.length < 3) continue;
    if (ring.length === 3) {
      tryAddTri(ring[0], ring[1], ring[2]);
    } else {
      const pts = ring.map(id => verts[id]);
      if (signedArea2D(pts) <= 1e-7) continue;
      const sub = triangulateSimplePoly(pts) || [];
      for (let k = 0; k < sub.length; k++) {
        const [pa, pb, pc] = sub[k];
        tryAddTri(getVid(pa[0], pa[1]), getVid(pb[0], pb[1]), getVid(pc[0], pc[1]));
      }
    }
  }
  if (!tris.length) return;

  // Separate multi-wedge pinch vertices so every boundary vertex has out-degree 1 in 3D
  const vertTris = new Map();
  for (let ti = 0; ti < tris.length; ti++) {
    for (let c = 0; c < 3; c++) {
      const v = tris[ti][c];
      let arr = vertTris.get(v);
      if (!arr) { arr = []; vertTris.set(v, arr); }
      arr.push(ti);
    }
  }

  const activeTri = new Uint8Array(tris.length).fill(1);
  for (const [v, inc] of vertTris.entries()) {
    if (inc.length < 2) continue;
    const seen = new Uint8Array(inc.length);
    const wedges = [];
    for (let i = 0; i < inc.length; i++) {
      if (seen[i]) continue;
      const w = [inc[i]];
      seen[i] = 1;
      for (let q = 0; q < w.length; q++) {
        const tA = tris[w[q]];
        const idxA = tA[0] === v ? 0 : (tA[1] === v ? 1 : 2);
        const nPrev = tA[(idxA + 2) % 3], nNext = tA[(idxA + 1) % 3];
        for (let j = 0; j < inc.length; j++) {
          if (seen[j]) continue;
          const tB = tris[inc[j]];
          const idxB = tB[0] === v ? 0 : (tB[1] === v ? 1 : 2);
          const bPrev = tB[(idxB + 2) % 3], bNext = tB[(idxB + 1) % 3];
          if (nNext === bPrev || nPrev === bNext) {
            seen[j] = 1;
            w.push(inc[j]);
          }
        }
      }
      wedges.push(w);
    }
    if (wedges.length < 2) continue;

    const pv = verts[v];
    for (let wi = 0; wi < wedges.length; wi++) {
      const w = wedges[wi];
      let sx = 0, sy = 0, cnt = 0, minEdge = Infinity;
      for (let k = 0; k < w.length; k++) {
        const t = tris[w[k]];
        for (let c = 0; c < 3; c++) {
          if (t[c] !== v) {
            const p = verts[t[c]];
            sx += p[0]; sy += p[1]; cnt++;
            const d = Math.hypot(p[0] - pv[0], p[1] - pv[1]);
            if (d < minEdge) minEdge = d;
          }
        }
      }
      const dx = (sx / (cnt || 1)) - pv[0], dy = (sy / (cnt || 1)) - pv[1];
      const dLen = Math.hypot(dx, dy);
      const step = Math.min(SNAP * 0.85, minEdge * 0.22);
      if (dLen < 1e-8 || step < SNAP * 0.55) {
        for (let k = 0; k < w.length; k++) activeTri[w[k]] = 0;
        continue;
      }
      const newId = verts.length;
      verts.push([pv[0] + (dx / dLen) * step, pv[1] + (dy / dLen) * step]);
      let validWedge = true;
      for (let k = 0; k < w.length; k++) {
        const t = tris[w[k]];
        const na = t[0] === v ? newId : t[0];
        const nb = t[1] === v ? newId : t[1];
        const nc = t[2] === v ? newId : t[2];
        const a = verts[na], b = verts[nb], c = verts[nc];
        if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 1e-8) {
          validWedge = false;
          break;
        }
      }
      if (!validWedge) {
        for (let k = 0; k < w.length; k++) activeTri[w[k]] = 0;
      } else {
        for (let k = 0; k < w.length; k++) {
          const t = tris[w[k]];
          if (t[0] === v) t[0] = newId;
          if (t[1] === v) t[1] = newId;
          if (t[2] === v) t[2] = newId;
        }
      }
    }
  }

  const edgeOwner = new Map();
  for (let ti = 0; ti < tris.length; ti++) {
    if (!activeTri[ti]) continue;
    const [ia, ib, ic] = tris[ti];
    edgeOwner.set(ia + '_' + ib, ti);
    edgeOwner.set(ib + '_' + ic, ti);
    edgeOwner.set(ic + '_' + ia, ti);
  }

  const visited = new Uint8Array(tris.length);
  for (let start = 0; start < tris.length; start++) {
    if (!activeTri[start] || visited[start]) continue;
    const comp = [start];
    visited[start] = 1;
    let area2 = 0;
    for (let q = 0; q < comp.length; q++) {
      const ti = comp[q];
      const [ia, ib, ic] = tris[ti];
      const a = verts[ia], b = verts[ib], c = verts[ic];
      area2 += (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      for (const rk of [ib + '_' + ia, ic + '_' + ib, ia + '_' + ic]) {
        const nb = edgeOwner.get(rk);
        if (nb !== undefined && activeTri[nb] && !visited[nb]) {
          visited[nb] = 1;
          comp.push(nb);
        }
      }
    }
    if (area2 < 2.4e-4) continue;

    const compEdges = new Set();
    for (let q = 0; q < comp.length; q++) {
      const [ia, ib, ic] = tris[comp[q]];
      compEdges.add(ia + '_' + ib);
      compEdges.add(ib + '_' + ic);
      compEdges.add(ic + '_' + ia);
    }

    const cand = [];
    for (let q = 0; q < comp.length; q++) {
      const [ia, ib, ic] = tris[comp[q]];
      const a = verts[ia], b = verts[ib], c = verts[ic];
      pushTri(cand, [a[0], a[1], zTop], [b[0], b[1], zTop], [c[0], c[1], zTop], [0, 0, 1], layerId, 0, tileId, 0);
      pushTri(cand, [a[0], a[1], zBot], [c[0], c[1], zBot], [b[0], b[1], zBot], [0, 0, -1], layerId, 0, tileId, 0);
      for (const [u, v] of [[ia, ib], [ib, ic], [ic, ia]]) {
        if (!compEdges.has(v + '_' + u)) {
          const pa = verts[u], pb = verts[v];
          const dx = pb[0] - pa[0], dy = pb[1] - pa[1], len = Math.hypot(dx, dy);
          if (len > 1e-6) {
            pushQuad(cand, [pa[0], pa[1], zBot], [pb[0], pb[1], zBot], [pb[0], pb[1], zTop], [pa[0], pa[1], zTop], [dy / len, -dx / len, 0], layerId, 0, tileId, 0);
          }
        }
      }
    }

    if (_isStrictManifoldShell3D(cand, scaleMm)) {
      const sid = allocShellId();
      for (let i = 0; i < cand.length; i++) {
        cand[i].buildingId = sid;
        cand[i].shellId = sid;
        outMesh.push(cand[i]);
      }
    }
  }
}

function _emitFlatPolygonToSingleTile3D(outerRing, holeRings, zBot, zTop, layerId, outMesh, tileId, allocShellId, scaleMm) {
  const probe = [];
  emitPolygonWithHolesSlab3D(outerRing, holeRings, zBot, zTop, layerId, probe, tileId, 0);
  if (probe.length > 0 && _isStrictManifoldShell3D(probe, scaleMm)) {
    const sid = allocShellId();
    for (let i = 0; i < probe.length; i++) {
      probe[i].buildingId = sid;
      probe[i].shellId = sid;
      outMesh.push(probe[i]);
    }
    return;
  }
  const pieces = _triangulatePolygonWithHoles2D(outerRing, holeRings);
  if (pieces.length > 0) {
    _extrudePlanarPiecesToManifoldSlabs3D(pieces, zBot, zTop, layerId, outMesh, tileId, allocShellId, scaleMm);
  }
}

function _emitDissolvedConvexPiecesToTile3D(pieces, zBot, zTop, layerId, outMesh, tileId, allocShellId, scaleMm) {
  let rawArea = 0;
  for (let i = 0; i < pieces.length; i++) rawArea += Math.max(0, signedArea2D(pieces[i]));
  if (rawArea < 1.2e-4) return;

  const loops = _reconstructPolygonsFromConvexPieces2D(pieces);
  let loopArea = 0;
  let hasAnyHole = false;
  for (let i = 0; i < loops.length; i++) {
    let net = loops[i].area;
    if (loops[i].holes.length > 0) hasAnyHole = true;
    for (let h = 0; h < loops[i].holes.length; h++) net -= Math.abs(signedArea2D(loops[i].holes[h]));
    loopArea += Math.max(0, net);
  }

  const areaTol = 0.015;
  if (!hasAnyHole && loops.length > 0 && Math.abs(loopArea - rawArea) <= areaTol) {
    const staged = [];
    for (let i = 0; i < loops.length; i++) {
      if (loops[i].area < 1.2e-4) continue;
      _emitFlatPolygonToSingleTile3D(loops[i].outer, [], zBot, zTop, layerId, staged, tileId, allocShellId, scaleMm);
    }
    let topArea = 0;
    for (let i = 0; i < staged.length; i++) {
      const t = staged[i];
      if (t.n && t.n[2] > 0.5) {
        const a = t.v0, b = t.v1, c = t.v2;
        topArea += 0.5 * Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      }
    }
    if (Math.abs(topArea - rawArea) <= areaTol) {
      for (let i = 0; i < staged.length; i++) outMesh.push(staged[i]);
      return;
    }
  }

  _extrudePlanarPiecesToManifoldSlabs3D(pieces, zBot, zTop, layerId, outMesh, tileId, allocShellId, scaleMm);
}

function _emitFlatPolygonClippedToTiles3D(outerRing, holeRings, pBBox, zBot, zTop, layerId, ctx, outMesh, allocShellId, scaleMm) {
  const { tileCols, tileRows, tileBounds } = ctx;
  const numTiles = (tileCols || 1) * (tileRows || 1);
  if (numTiles <= 1) {
    _emitFlatPolygonToSingleTile3D(outerRing, holeRings, zBot, zTop, layerId, outMesh, 0, allocShellId, scaleMm);
    return;
  }

  if ((ctx.isExport || numTiles <= 400) && tileBounds && tileBounds.length === numTiles) {
    // Check if strictly inside a single tile box (zero clipping needed!)
    for (let tid = 0; tid < numTiles; tid++) {
      const tb = tileBounds[tid];
      if (pBBox[0] >= tb.x0 + 1e-5 && pBBox[2] <= tb.x1 - 1e-5 &&
          pBBox[1] >= tb.y0 + 1e-5 && pBBox[3] <= tb.y1 - 1e-5) {
        _emitFlatPolygonToSingleTile3D(outerRing, holeRings, zBot, zTop, layerId, outMesh, tid, allocShellId, scaleMm);
        return;
      }
    }

    // Clip 2D pieces cleanly against each overlapping tile's [x0, x1] x [y0, y1] kerf box
    const pieces = _triangulatePolygonWithHoles2D(outerRing, holeRings);
    if (!pieces.length) return;
    for (let tid = 0; tid < numTiles; tid++) {
      const tb = tileBounds[tid];
      if (pBBox[2] <= tb.x0 + 1e-7 || pBBox[0] >= tb.x1 - 1e-7 ||
          pBBox[3] <= tb.y0 + 1e-7 || pBBox[1] >= tb.y1 - 1e-7) continue;
      const c00 = [tb.x0, tb.y0], c10 = [tb.x1, tb.y0], c11 = [tb.x1, tb.y1], c01 = [tb.x0, tb.y1];
      const tilePieces = [];
      for (let pi = 0; pi < pieces.length; pi++) {
        let c = pieces[pi];
        c = _clipConvexByEdgeHalfPlane2D(c, c00, c10, true, 0.0);
        if (c.length < 3) continue;
        c = _clipConvexByEdgeHalfPlane2D(c, c10, c11, true, 0.0);
        if (c.length < 3) continue;
        c = _clipConvexByEdgeHalfPlane2D(c, c11, c01, true, 0.0);
        if (c.length < 3) continue;
        c = _clipConvexByEdgeHalfPlane2D(c, c01, c00, true, 0.0);
        if (c.length >= 3) tilePieces.push(c);
      }
      if (tilePieces.length > 0) {
        _emitDissolvedConvexPiecesToTile3D(tilePieces, zBot, zTop, layerId, outMesh, tid, allocShellId, scaleMm);
      }
    }
    return;
  }

  // Fallback O(1) centroid path for synthetic >400-tile live-preview stress grids
  const shell = [];
  _emitFlatPolygonToSingleTile3D(outerRing, holeRings, zBot, zTop, layerId, shell, 0, allocShellId, scaleMm);
  appendShellClippedToTiles(shell, ctx, outMesh);
}

// Precomputes per-edge riser inset flags for cellTerracePolys[cellIdx] lazily once per build
function _getPreparedCellTerraces(cellIdx, gx, gy, cellTerracePolys, ctx, cache) {
  let prep = cache.get(cellIdx);
  if (prep !== undefined) return prep;

  const { TERRAIN_RES_X, TERRAIN_RES_Y, baseBottomZ, tileBounds } = ctx;
  const rawList = cellTerracePolys[cellIdx];
  if (!rawList || !rawList.length) {
    cache.set(cellIdx, null);
    return null;
  }

  const RISER_INSET = 0.0028;
  const out = [];

  const isSameLevelAt = (px, py, tileId, zSurf) => {
    for (let dy = -1; dy <= 1; dy++) {
      const ny = gy + dy;
      if (ny < 0 || ny >= TERRAIN_RES_Y) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = gx + dx;
        if (nx < 0 || nx >= TERRAIN_RES_X) continue;
        const nList = cellTerracePolys[ny * TERRAIN_RES_X + nx];
        if (!nList) continue;
        for (let k = 0; k < nList.length; k++) {
          const np = nList[k];
          if (np.tileId !== tileId || Math.abs(np.zSurf - zSurf) > 1e-5) continue;
          if (pointInPolyOrNear2D(px, py, np.poly, 2e-4)) return true;
        }
      }
    }
    return false;
  };

  for (let i = 0; i < rawList.length; i++) {
    const tp = rawList[i];
    if (tp.zSurf < baseBottomZ - 1e-4 || !tp.poly || tp.poly.length < 3) continue;
    const poly = signedArea2D(tp.poly) >= 0 ? tp.poly : tp.poly.slice().reverse();
    const bbox = _ringBBox2D(poly);
    const tb = tileBounds && tileBounds[tp.tileId || 0];
    const edges = [];

    for (let e = 0, n = poly.length; e < n; e++) {
      const a = poly[e], b = poly[(e + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-7) continue;
      const inNx = -dy / len, inNy = dx / len;
      const midX = 0.5 * (a[0] + b[0]) - inNx * 1.2e-3;
      const midY = 0.5 * (a[1] + b[1]) - inNy * 1.2e-3;

      let inset = RISER_INSET;
      if (tb && (midX < tb.x0 || midX > tb.x1 || midY < tb.y0 || midY > tb.y1)) {
        inset = 0.0; // tile kerf boundary — already exact
      } else {
        const p1X = a[0] + 0.12 * dx - inNx * 1.2e-3, p1Y = a[1] + 0.12 * dy - inNy * 1.2e-3;
        const p2X = a[0] + 0.88 * dx - inNx * 1.2e-3, p2Y = a[1] + 0.88 * dy - inNy * 1.2e-3;
        if (isSameLevelAt(midX, midY, tp.tileId, tp.zSurf) &&
            isSameLevelAt(p1X, p1Y, tp.tileId, tp.zSurf) &&
            isSameLevelAt(p2X, p2Y, tp.tileId, tp.zSurf)) {
          inset = 0.0; // shared internal seam on same terrace & tile along entire segment
        }
      }
      edges.push({ a, b, inset });
    }
    out.push({ poly, bbox, edges, zSurf: tp.zSurf, tileId: tp.tileId || 0 });
  }

  prep = out.length > 0 ? out : null;
  cache.set(cellIdx, prep);
  return prep;
}

function _emitSingleGreeneryPolygon(poly, ctx, baseInfo, maxBandK, meshes, allocShellId, cellCache) {
  const { halfW, halfH, TERRAIN_RES_X, TERRAIN_RES_Y, thresholds, gHeight, baseBottomZ } = ctx;
  const scaleMm = ctx.scaleMm || 1.89;
  const cellTerracePolys = baseInfo && baseInfo.cellTerracePolys;
  const pBBox = _ringBBox2D(poly.ring);

  // Fast Path 1: Non-topographic scene (single contour terrace thresholds[0]) without shoreline cuts
  if (!cellTerracePolys) {
    _emitFlatPolygonClippedToTiles3D(poly.ring, poly.holes, pBBox, thresholds[0], thresholds[0] + gHeight, 2, ctx, meshes.greenery, allocShellId, scaleMm);
    return;
  }

  const gx0 = Math.max(0, Math.floor(((pBBox[0] + halfW) / (2 * halfW)) * TERRAIN_RES_X));
  const gx1 = Math.min(TERRAIN_RES_X - 1, Math.floor(((pBBox[2] + halfW) / (2 * halfW)) * TERRAIN_RES_X));
  const gy0 = Math.max(0, Math.floor(((pBBox[1] + halfH) / (2 * halfH)) * TERRAIN_RES_Y));
  const gy1 = Math.min(TERRAIN_RES_Y - 1, Math.floor(((pBBox[3] + halfH) / (2 * halfH)) * TERRAIN_RES_Y));

  // Fast Path 2: Polygon sits wholly on a single flat terrace step with no internal contour/water cuts
  let uniformZ = null;
  let isSingleTerrace = true;
  for (let gy = gy0; gy <= gy1 && isSingleTerrace; gy++) {
    const row = gy * TERRAIN_RES_X;
    for (let gx = gx0; gx <= gx1; gx++) {
      const tList = cellTerracePolys[row + gx];
      if (!tList || !tList.length) { isSingleTerrace = false; break; }
      for (let i = 0; i < tList.length; i++) {
        const zs = tList[i].zSurf;
        if (zs < baseBottomZ - 1e-4) { isSingleTerrace = false; break; }
        if (uniformZ === null) uniformZ = zs;
        else if (Math.abs(zs - uniformZ) > 1e-5) { isSingleTerrace = false; break; }
      }
      if (!isSingleTerrace) break;
    }
  }

  if (isSingleTerrace && uniformZ !== null) {
    _emitFlatPolygonClippedToTiles3D(poly.ring, poly.holes, pBBox, uniformZ, uniformZ + gHeight, 2, ctx, meshes.greenery, allocShellId, scaleMm);
    return;
  }

  // Multi-Contour Mountain Draping Path:
  // Clip 2D greenery triangulation against exact per-tile terrace polygons and extrude
  // directly into 100% watertight 2-manifold slabs (preserving every hilltop/depression hole
  // and narrow slope crescent with zero concentric dead-zone gaps).
  const tris2D = _triangulatePolygonWithHoles2D(poly.ring, poly.holes);
  if (!tris2D.length) return;

  const buckets = new Map();
  for (let ti = 0; ti < tris2D.length; ti++) {
    const tri = tris2D[ti];
    if (Math.abs(signedArea2D(tri)) < 1e-7) continue;
    const tb = _ringBBox2D(tri);
    const tgx0 = Math.max(gx0, Math.floor(((tb[0] + halfW) / (2 * halfW)) * TERRAIN_RES_X));
    const tgx1 = Math.min(gx1, Math.floor(((tb[2] + halfW) / (2 * halfW)) * TERRAIN_RES_X));
    const tgy0 = Math.max(gy0, Math.floor(((tb[1] + halfH) / (2 * halfH)) * TERRAIN_RES_Y));
    const tgy1 = Math.min(gy1, Math.floor(((tb[3] + halfH) / (2 * halfH)) * TERRAIN_RES_Y));

    for (let gy = tgy0; gy <= tgy1; gy++) {
      const row = gy * TERRAIN_RES_X;
      for (let gx = tgx0; gx <= tgx1; gx++) {
        const tPieces = _getPreparedCellTerraces(row + gx, gx, gy, cellTerracePolys, ctx, cellCache);
        if (!tPieces) continue;
        for (let pi = 0; pi < tPieces.length; pi++) {
          const tp = tPieces[pi];
          if (tb[2] <= tp.bbox[0] + 1e-7 || tb[0] >= tp.bbox[2] - 1e-7 ||
              tb[3] <= tp.bbox[1] + 1e-7 || tb[1] >= tp.bbox[3] - 1e-7) continue;

          let clipped = tri;
          for (let ei = 0; ei < tp.edges.length && clipped.length >= 3; ei++) {
            const ed = tp.edges[ei];
            clipped = _clipConvexByEdgeHalfPlane2D(clipped, ed.a, ed.b, true, ed.inset);
          }
          if (clipped.length < 3) continue;

          const bKey = tp.tileId + '_' + Math.round(tp.zSurf * 100000);
          let bObj = buckets.get(bKey);
          if (!bObj) {
            bObj = { tileId: tp.tileId, zSurf: tp.zSurf, pieces: [] };
            buckets.set(bKey, bObj);
          }
          bObj.pieces.push(clipped);
        }
      }
    }
  }

  for (const bObj of buckets.values()) {
    _emitDissolvedConvexPiecesToTile3D(
      bObj.pieces,
      bObj.zSurf,
      bObj.zSurf + gHeight,
      2,
      meshes.greenery,
      bObj.tileId,
      allocShellId,
      scaleMm
    );
  }
}

function emitGreeneryLayerSync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner) {
  const lv = state.layerVisible || state.layers;
  const greenVisible = !lv || lv.greenery !== false;
  if (!greenVisible) return;

  const { MASK_RES_X, MASK_RES_Y } = ctx;
  const scaleMm = ctx.scaleMm || 1.89;
  const greenMinArea = Math.min(0.016, 0.050 / (scaleMm * scaleMm));
  const greenIso = 0.47;
  const { xMinMS, xMaxMS, yMinMS, yMaxMS, maxBandK } = bandAssigner;

  const greenField = _buildContinuousGreeneryFieldAndSupport(ctx, bandAssigner);
  if (!greenField) return;

  const polys = extractMarchingSquaresPolygons2D(
    greenField, MASK_RES_X, MASK_RES_Y, xMinMS, xMaxMS, yMinMS, yMaxMS, greenIso, greenMinArea
  );
  const cellCache = new Map();
  for (let i = 0; i < polys.length; i++) {
    _emitSingleGreeneryPolygon(polys[i], ctx, baseInfo, maxBandK, meshes, allocShellId, cellCache);
  }
}

async function emitGreeneryLayerAsync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl, progressTracker = null) {
  const lv = state.layerVisible || state.layers;
  const greenVisible = !lv || lv.greenery !== false;
  if (!greenVisible) return;

  if (yieldCtrl) {
    yieldCtrl.checkCancellation();
    await yieldCtrl.yieldIfNeeded();
  }

  const { MASK_RES_X, MASK_RES_Y } = ctx;
  const scaleMm = ctx.scaleMm || 1.89;
  const greenMinArea = Math.min(0.016, 0.050 / (scaleMm * scaleMm));
  const greenIso = 0.47;
  const { xMinMS, xMaxMS, yMinMS, yMaxMS, maxBandK, totalBands } = bandAssigner;

  const greenField = _buildContinuousGreeneryFieldAndSupport(ctx, bandAssigner);
  if (!greenField) return;

  if (yieldCtrl) {
    await yieldCtrl.yieldIfNeeded();
    yieldCtrl.checkCancellation();
  }

  const polys = extractMarchingSquaresPolygons2D(
    greenField, MASK_RES_X, MASK_RES_Y, xMinMS, xMaxMS, yMinMS, yMaxMS, greenIso, greenMinArea
  );

  if (yieldCtrl) {
    await yieldCtrl.yieldIfNeeded();
    yieldCtrl.checkCancellation();
  }

  const totalP = Math.max(1, polys.length);
  const cellCache = new Map();
  for (let i = 0; i < polys.length; i++) {
    if (yieldCtrl && (i & 7) === 0) yieldCtrl.checkCancellation();
    _emitSingleGreeneryPolygon(polys[i], ctx, baseInfo, maxBandK, meshes, allocShellId, cellCache);

    if (progressTracker && progressTracker.onProgress) {
      const frac = ((i + 1) / totalP) * 0.45;
      const pct = 42 + Math.min(12, Math.round(frac * 12));
      if (pct !== progressTracker.lastReportedPct) {
        progressTracker.lastReportedPct = pct;
        progressTracker.onProgress(
          pct,
          `Etap 2/5: Konturowanie roślinności i dróg (${i + 1}/${totalP})...`,
          `Pasma zieleni miejskiej (${totalBands} poziomów terenu)`
        );
      }
    }
    if (yieldCtrl) {
      await yieldCtrl.yieldIfNeeded();
    }
  }
}

function emitGreeneryLayer(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl = null, progressTracker = null) {
  if (yieldCtrl) {
    return emitGreeneryLayerAsync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl, progressTracker);
  }
  return emitGreeneryLayerSync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner);
}

if (typeof window !== 'undefined') {
  window.buildRawGreeneryMask = buildRawGreeneryMask;
  window.finalizeGreeneryMask = finalizeGreeneryMask;
  window.emitGreeneryLayer = emitGreeneryLayer;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildRawGreeneryMask,
    finalizeGreeneryMask,
    emitGreeneryLayerSync,
    emitGreeneryLayerAsync,
    emitGreeneryLayer
  };
}
