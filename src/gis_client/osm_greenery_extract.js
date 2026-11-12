// ============================================================================
// src/gis_client/osm_greenery_extract.js
// OSM Greenery Layer Extractor (Parks, Forests, Grass, Gardens & Meadows)
// ============================================================================

if (typeof simplifyRingJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./overpass_dem_fetch.js'));
}
if (typeof parseFloatTagJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./s3db_client_matcher.js'));
}

const _GREENERY_LEISURE_TAGS = new Set([
  'park', 'garden', 'nature_reserve', 'pitch', 'playground',
  'common', 'golf_course', 'recreation_ground', 'dog_park'
]);

const _GREENERY_LANDUSE_TAGS = new Set([
  'forest', 'grass', 'meadow', 'village_green', 'recreation_ground',
  'cemetery', 'allotments', 'farmland', 'orchard', 'vineyard',
  'flowerbed', 'greenery', 'plant_nursery'
]);

const _GREENERY_NATURAL_TAGS = new Set([
  'wood', 'scrub', 'grassland', 'heath', 'shrubbery', 'fell'
]);

function isOsmGreeneryMultipolygonJS(tags) {
  if (!tags) return false;
  if (tags.indoor === 'yes' || tags.location === 'underground') return false;
  if (tags.tunnel && !['no', 'false', '0', 'none'].includes(String(tags.tunnel).toLowerCase())) return false;
  return Boolean(
    _GREENERY_LEISURE_TAGS.has(tags.leisure) ||
    _GREENERY_LANDUSE_TAGS.has(tags.landuse) ||
    _GREENERY_NATURAL_TAGS.has(tags.natural) ||
    (tags.barrier === 'hedge' && tags.area === 'yes')
  );
}

function _signedAreaLocal2D(ring) {
  if (!ring || ring.length < 3) return 0;
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a * 0.5;
}

function _pointInRingLocal2D(px, py, ring) {
  if (typeof pointInPolyLocal === 'function') return pointInPolyLocal(px, py, ring);
  let inside = false;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function _ringBBoxLocal2D(ring) {
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

function _cleanLoopLocal2D(ptsIn, wantCCW) {
  if (!ptsIn || ptsIn.length < 3) return [];
  const pts = [];
  for (let i = 0; i < ptsIn.length; i++) {
    const p = ptsIn[i];
    if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 1e-5) {
      pts.push([p[0], p[1]]);
    }
  }
  if (pts.length >= 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 1e-5) {
    pts.pop();
  }
  if (pts.length < 3) return [];
  const area = _signedAreaLocal2D(pts);
  if (Math.abs(area) < 1e-6) return [];
  if (wantCCW ? area < 0 : area > 0) pts.reverse();
  return pts;
}

function _mergeHolesKeyholeLocal2D(outerCCW, holesCW) {
  let ring = outerCCW.map(p => [p[0], p[1]]);
  if (!holesCW || !holesCW.length) return ring;
  const sorted = holesCW
    .map(h => {
      const c = _cleanLoopLocal2D(h, false);
      if (c.length < 3) return null;
      let maxX = -Infinity, maxIdx = 0;
      for (let i = 0; i < c.length; i++) {
        if (c[i][0] > maxX) { maxX = c[i][0]; maxIdx = i; }
      }
      return { ring: c, maxX, maxIdx };
    })
    .filter(Boolean)
    .sort((a, b) => b.maxX - a.maxX);

  for (let hi = 0; hi < sorted.length; hi++) {
    const h = sorted[hi];
    const hp = h.ring[h.maxIdx];
    let bestT = Infinity, bestEdge = -1, bestIx = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if ((a[1] > hp[1]) === (b[1] > hp[1]) && a[1] !== hp[1] && b[1] !== hp[1]) continue;
      const dy = b[1] - a[1];
      if (Math.abs(dy) < 1e-12) continue;
      const u = (hp[1] - a[1]) / dy;
      if (u < -1e-6 || u > 1 + 1e-6) continue;
      const ix = a[0] + u * (b[0] - a[0]);
      if (ix >= hp[0] - 1e-6 && (ix - hp[0]) < bestT) {
        bestT = ix - hp[0];
        bestEdge = i;
        bestIx = ix;
      }
    }
    if (bestEdge < 0) continue;
    const a = ring[bestEdge], b = ring[(bestEdge + 1) % ring.length];
    let bridgeIdx = Math.hypot(a[0] - bestIx, a[1] - hp[1]) <= Math.hypot(b[0] - bestIx, b[1] - hp[1])
      ? bestEdge
      : (bestEdge + 1) % ring.length;
    const bp = ring[bridgeIdx];
    const nextRing = [];
    for (let i = 0; i <= bridgeIdx; i++) nextRing.push(ring[i]);
    for (let k = 0; k < h.ring.length; k++) {
      nextRing.push(h.ring[(h.maxIdx + k) % h.ring.length]);
    }
    nextRing.push([hp[0], hp[1]]);
    nextRing.push([bp[0], bp[1]]);
    for (let i = bridgeIdx + 1; i < ring.length; i++) nextRing.push(ring[i]);
    ring = nextRing;
  }
  return ring;
}

function _triangulateLoopLocal2D(loopPts) {
  const pts = [];
  for (let i = 0; i < loopPts.length; i++) {
    const p = loopPts[i];
    if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 1e-7) {
      pts.push([p[0], p[1]]);
    }
  }
  if (pts.length >= 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 1e-7) {
    pts.pop();
  }
  if (pts.length < 3) return [];
  if (_signedAreaLocal2D(pts) < 0) pts.reverse();

  const n = pts.length;
  const nodes = new Array(n);
  for (let i = 0; i < n; i++) nodes[i] = { pt: pts[i], prev: null, next: null };
  for (let i = 0; i < n; i++) {
    nodes[i].prev = nodes[(i + n - 1) % n];
    nodes[i].next = nodes[(i + 1) % n];
  }

  const inTri = (p, a, b, c) => {
    if ((Math.abs(p[0] - a[0]) < 1e-7 && Math.abs(p[1] - a[1]) < 1e-7) ||
        (Math.abs(p[0] - b[0]) < 1e-7 && Math.abs(p[1] - b[1]) < 1e-7) ||
        (Math.abs(p[0] - c[0]) < 1e-7 && Math.abs(p[1] - c[1]) < 1e-7)) return false;
    const c1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const c2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
    const c3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
    return c1 >= -1e-9 && c2 >= -1e-9 && c3 >= -1e-9;
  };

  const tris = [];
  let curr = nodes[0], rem = n, guard = 0;
  while (rem > 3 && guard <= rem * 3) {
    const a = curr.prev.pt, b = curr.pt, c = curr.next.pt;
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    let ok = cr > 1e-10;
    if (ok) {
      let p = curr.next.next;
      while (p !== curr.prev) {
        if (inTri(p.pt, a, b, c)) { ok = false; break; }
        p = p.next;
      }
    }
    if (ok) {
      tris.push([a, b, c]);
      curr.prev.next = curr.next;
      curr.next.prev = curr.prev;
      curr = curr.next;
      rem--;
      guard = 0;
    } else {
      curr = curr.next;
      guard++;
    }
  }
  if (rem === 3) {
    const a = curr.prev.pt, b = curr.pt, c = curr.next.pt;
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cr > 1e-10) tris.push([a, b, c]);
  }
  return tris;
}

function _intersectCanonicalHalfPlane2D(p0, p1, la, lb) {
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

function _clipConvexHalfPlaneLocal2D(poly, a, b, keepLeft) {
  if (!poly || poly.length < 3) return [];
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const sgn = keepLeft ? 1 : -1;
  const out = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const cur = poly[i];
    const nxt = poly[(i + 1) % n];
    const dCur = sgn * (ex * (cur[1] - a[1]) - ey * (cur[0] - a[0]));
    const dNxt = sgn * (ex * (nxt[1] - a[1]) - ey * (nxt[0] - a[0]));
    const inCur = dCur >= -1e-9;
    const inNxt = dNxt >= -1e-9;
    if (inCur && inNxt) {
      out.push(nxt);
    } else if (inCur && !inNxt) {
      out.push(_intersectCanonicalHalfPlane2D(cur, nxt, a, b));
    } else if (!inCur && inNxt) {
      out.push(_intersectCanonicalHalfPlane2D(cur, nxt, a, b));
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
  return (cleaned.length >= 3 && _signedAreaLocal2D(cleaned) > 1e-6) ? cleaned : [];
}

function _reconstructPolysFromConvexPiecesLocal2D(pieces) {
  const WELD = 2e-5;
  const invW = 1 / WELD;
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

  // Spatial bucket over welded vertices to split any collinear T-junctions
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
    const invLen = 1 / Math.sqrt(lenSq);
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
          if (t > 1e-5 && t < 1 - 1e-5) {
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
    const revKey = v + '_' + u;
    const revCnt = edgeCounts.get(revKey) || 0;
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
      const area = _signedAreaLocal2D(pts);
      if (area > 1e-4) outers.push({ outer: pts, area, holes: [] });
      else if (area < -1e-4) holes.push(pts);
    }
  }

  for (let hi = 0; hi < holes.length; hi++) {
    const h = holes[hi];
    const hArea = Math.abs(_signedAreaLocal2D(h));
    let bestIdx = -1, bestArea = Infinity;
    for (let oi = 0; oi < outers.length; oi++) {
      if (outers[oi].area > hArea && outers[oi].area < bestArea &&
          h.some(pt => _pointInRingLocal2D(pt[0], pt[1], outers[oi].outer))) {
        bestArea = outers[oi].area;
        bestIdx = oi;
      }
    }
    if (bestIdx >= 0) outers[bestIdx].holes.push(h);
  }
  return outers;
}

// Preserves explicit parks/gardens/grass/flowerbeds inside or across polygonal town squares (place=square, highway=pedestrian)
function carveGreenIslandsFromRoadPolysJS(greenPolys, roadPolys) {
  if (!Array.isArray(greenPolys) || !greenPolys.length || !Array.isArray(roadPolys) || !roadPolys.length) return;

  const greenMeta = [];
  for (let gi = 0; gi < greenPolys.length; gi++) {
    const gp = greenPolys[gi];
    if (!gp || !gp.outer || gp.outer.length < 3) continue;
    const area = Math.abs(_signedAreaLocal2D(gp.outer));
    if (area < 1e-4) continue;
    greenMeta.push({ gp, area, bbox: _ringBBoxLocal2D(gp.outer), tris: null });
  }
  if (!greenMeta.length) return;

  const extraRoadPolys = [];
  for (let ri = 0; ri < roadPolys.length; ri++) {
    const rp = roadPolys[ri];
    if (!rp || rp._greenIslandsCarved || !rp.outer || rp.outer.length < 3) continue;
    Object.defineProperty(rp, '_greenIslandsCarved', { value: true, enumerable: false, configurable: true });

    const rArea = Math.abs(_signedAreaLocal2D(rp.outer));
    if (rArea < 1e-4) continue;
    const rBBox = _ringBBoxLocal2D(rp.outer);

    const cutters = [];
    for (let gi = 0; gi < greenMeta.length; gi++) {
      const gm = greenMeta[gi];
      if (gm.bbox[2] < rBBox[0] || gm.bbox[0] > rBBox[2] || gm.bbox[3] < rBBox[1] || gm.bbox[1] > rBBox[3]) continue;
      // Keep small paved plazas nested inside much larger parks paved
      if (rArea < gm.area * 0.45) {
        let inCnt = 0;
        for (let vi = 0; vi < rp.outer.length; vi++) {
          const p = rp.outer[vi];
          if (_pointInRingLocal2D(p[0], p[1], gm.gp.outer) &&
              !(gm.gp.holes || []).some(h => _pointInRingLocal2D(p[0], p[1], h))) {
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
        const oc = _cleanLoopLocal2D(gm.gp.outer, true);
        const merged = _mergeHolesKeyholeLocal2D(oc, gm.gp.holes || []);
        gm.tris = _triangulateLoopLocal2D(merged).map(t => ({ tri: t, bbox: _ringBBoxLocal2D(t) }));
      }
      for (let ti = 0; ti < gm.tris.length; ti++) {
        const tb = gm.tris[ti].bbox;
        if (tb[2] < rBBox[0] || tb[0] > rBBox[2] || tb[3] < rBBox[1] || tb[1] > rBBox[3]) continue;
        cutTris.push(gm.tris[ti]);
      }
    }
    if (!cutTris.length) continue;

    const rOuterClean = _cleanLoopLocal2D(rp.outer, true);
    const rMerged = _mergeHolesKeyholeLocal2D(rOuterClean, rp.holes || []);
    let pieces = _triangulateLoopLocal2D(rMerged);
    if (!pieces.length) continue;

    let anyCut = false;
    for (let ci = 0; ci < cutTris.length && pieces.length > 0; ci++) {
      const { tri, bbox: cb } = cutTris[ci];
      const nextPieces = [];
      for (let pi = 0; pi < pieces.length; pi++) {
        const pc = pieces[pi];
        const pb = _ringBBoxLocal2D(pc);
        if (pb[2] <= cb[0] + 1e-7 || pb[0] >= cb[2] - 1e-7 || pb[3] <= cb[1] + 1e-7 || pb[1] >= cb[3] - 1e-7) {
          nextPieces.push(pc);
          continue;
        }
        // Quick check whether pc intersects tri interior at all
        let rem = pc;
        const subOut = [];
        for (let ek = 0; ek < 3 && rem && rem.length >= 3; ek++) {
          const ea = tri[ek], eb = tri[(ek + 1) % 3];
          const outPart = _clipConvexHalfPlaneLocal2D(rem, ea, eb, false);
          if (outPart.length >= 3) subOut.push(outPart);
          rem = _clipConvexHalfPlaneLocal2D(rem, ea, eb, true);
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

    const rebuilt = _reconstructPolysFromConvexPiecesLocal2D(pieces);
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

function processOsmGreeneryMultipolygonJS(rel, tags, raw, ctx, extraFlags = null) {
  if (!isOsmGreeneryMultipolygonJS(tags)) return false;
  const relName = String(tags.name || tags['name:en'] || '').trim().toLowerCase();
  const clipped = (typeof stitchClippedMultipolygonRingsJS === 'function')
    ? stitchClippedMultipolygonRingsJS(raw.outerWays, raw.innerWays, ctx.nodesToPts, ctx.fetchHalfW, ctx.fetchHalfH, {
        isWater: false,
        isGreen: true,
        isPlaza: Boolean(extraFlags && extraFlags.isPlaza),
        relName,
        waterSamplePts: ctx.waterSamplePts,
        buildingSamplePts: ctx.buildingSamplePts,
        roadSamplePts: ctx.roadSamplePts,
        tol: 0.018
      })
    : null;
  const stFallback = ctx.stitchedRelPolys.get(rel.id) || { outerPolys: [], innerPolys: [] };
  const entries = clipped
    ? clipped.outerEntries
    : stFallback.outerPolys.map(op => ({
        outer: op,
        holes: (stFallback.innerPolys || []).filter(h => h && h.length >= 3 && _pointInRingLocal2D(h[0][0], h[0][1], op))
      }));
  if (entries.length === 0) return true;
  for (const wid of raw.memberWayIds) ctx.usedWays.add(wid);
  const gType = tags.leisure || tags.landuse || tags.natural || (tags.barrier === 'hedge' ? 'hedge' : 'park');
  for (const e of entries) {
    ctx.greenPolys.push({ outer: e.outer, holes: e.holes, type: gType });
  }
  return true;
}

function processOsmGreeneryWayJS(wid, w, tags, nids, isClosed, ctx) {
  if (isOsmGreeneryMultipolygonJS(tags) && isClosed) {
    if (!ctx.usedWays.has(wid)) {
      const pts = ctx.nodesToPts(nids, 0.018);
      if (pts.length >= 3) {
        const gType = tags.leisure || tags.landuse || tags.natural || (tags.barrier === 'hedge' ? 'hedge' : 'park');
        ctx.greenPolys.push({ outer: pts, holes: [], type: gType });
      }
    }
    return true;
  }
  return false;
}

function finalizeOsmGreeneryLayerJS(ctx) {
  if (!ctx) return;
  carveGreenIslandsFromRoadPolysJS(ctx.greenPolys, ctx.roadPolys);
}

if (typeof window !== 'undefined') {
  window.isOsmGreeneryMultipolygonJS = isOsmGreeneryMultipolygonJS;
  window.processOsmGreeneryMultipolygonJS = processOsmGreeneryMultipolygonJS;
  window.processOsmGreeneryWayJS = processOsmGreeneryWayJS;
  window.finalizeOsmGreeneryLayerJS = finalizeOsmGreeneryLayerJS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isOsmGreeneryMultipolygonJS,
    processOsmGreeneryMultipolygonJS,
    processOsmGreeneryWayJS,
    finalizeOsmGreeneryLayerJS
  };
}
