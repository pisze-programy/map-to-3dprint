// ============================================================================
// src/gis_client/overpass_dem_fetch.js
// Multipolygon Ring Stitching, Coastline-to-Sea Polygon Builder & Adaptive
// AWS Terrarium DEM Tile Fetcher
// ============================================================================

const _demTilePixelCache = new Map();

function simplifyRingJS(pts, tol = 0.015) {
  if (!pts || pts.length < 4) return pts || [];
  const out = [pts[0]];
  const tolSq = tol * tol;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], last = out[out.length - 1];
    const dx = p[0] - last[0], dy = p[1] - last[1];
    if (dx * dx + dy * dy >= tolSq) out.push(p);
  }
  if (out.length >= 3 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) {
    out.pop();
  }
  return out;
}

function stitchWayRingsJS(wayNodeLists) {
  const rings = [];
  const openSegs = (wayNodeLists || []).filter(w => w && w.length >= 2).map(w => w.slice());
  while (openSegs.length > 0) {
    let curr = openSegs.shift();
    if (curr[0] === curr[curr.length - 1]) {
      if (curr.length >= 4) rings.push(curr);
      continue;
    }
    let changed = true;
    while (changed && curr[0] !== curr[curr.length - 1]) {
      changed = false;
      for (let i = 0; i < openSegs.length; i++) {
        const seg = openSegs[i];
        if (seg[0] === curr[curr.length - 1]) {
          curr = curr.concat(seg.slice(1));
          openSegs.splice(i, 1);
          changed = true;
          break;
        } else if (seg[seg.length - 1] === curr[curr.length - 1]) {
          curr = curr.concat(seg.slice(0, -1).reverse());
          openSegs.splice(i, 1);
          changed = true;
          break;
        } else if (seg[seg.length - 1] === curr[0]) {
          curr = seg.slice(0, -1).concat(curr);
          openSegs.splice(i, 1);
          changed = true;
          break;
        } else if (seg[0] === curr[0]) {
          curr = seg.slice(1).reverse().concat(curr);
          openSegs.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    if (curr.length >= 4) {
      if (curr[0] !== curr[curr.length - 1]) curr.push(curr[0]);
      rings.push(curr);
    }
  }
  return rings;
}

function polyAreaSignedJS(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
    a += p1[0] * p2[1] - p2[0] * p1[1];
  }
  return a * 0.5;
}

function pointInPolyLocal(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function _clipSegmentLiangBarsky(p0, p1, Cx, Cy) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  let t0 = 0.0, t1 = 1.0;
  const checks = [
    [-dx, p0[0] + Cx],
    [dx, Cx - p0[0]],
    [-dy, p0[1] + Cy],
    [dy, Cy - p0[1]]
  ];
  for (let i = 0; i < 4; i++) {
    const p = checks[i][0], q = checks[i][1];
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  if (t0 > t1) return null;
  const clampPt = (t) => [
    Math.max(-Cx, Math.min(Cx, p0[0] + t * dx)),
    Math.max(-Cy, Math.min(Cy, p0[1] + t * dy))
  ];
  return { a: clampPt(t0), b: clampPt(t1), entered: t0 > 1e-6, exited: t1 < 1.0 - 1e-6 };
}

function _clipPolylineToRectPieces(pts, Cx, Cy) {
  const pieces = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = _clipSegmentLiangBarsky(pts[i], pts[i + 1], Cx, Cy);
    if (!seg) {
      if (cur && cur.length >= 2) pieces.push(cur);
      cur = null;
      continue;
    }
    if (!cur || seg.entered) {
      if (cur && cur.length >= 2) pieces.push(cur);
      cur = [seg.a, seg.b];
    } else {
      const last = cur[cur.length - 1];
      if (Math.hypot(seg.b[0] - last[0], seg.b[1] - last[1]) > 1e-4) {
        cur.push(seg.b);
      }
    }
    if (seg.exited) {
      if (cur && cur.length >= 2) pieces.push(cur);
      cur = null;
    }
  }
  if (cur && cur.length >= 2) pieces.push(cur);
  return pieces;
}

function _extractRoleChainsJS(wayNodeLists, role, nodesToPts, Cx, Cy, tol, closedLoops, openChains) {
  const segs = (wayNodeLists || []).filter(w => w && w.length >= 2).map(w => w.slice());
  while (segs.length > 0) {
    let curr = segs.shift();
    let changed = true;
    while (changed && curr[0] !== curr[curr.length - 1]) {
      changed = false;
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        if (seg[0] === curr[curr.length - 1]) {
          curr = curr.concat(seg.slice(1));
          segs.splice(i, 1);
          changed = true;
          break;
        } else if (seg[seg.length - 1] === curr[curr.length - 1]) {
          curr = curr.concat(seg.slice(0, -1).reverse());
          segs.splice(i, 1);
          changed = true;
          break;
        } else if (seg[seg.length - 1] === curr[0]) {
          curr = seg.slice(0, -1).concat(curr);
          segs.splice(i, 1);
          changed = true;
          break;
        } else if (seg[0] === curr[0]) {
          curr = seg.slice(1).reverse().concat(curr);
          segs.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    if (curr[0] === curr[curr.length - 1]) {
      if (curr.length >= 4) {
        const pts = nodesToPts(curr, tol);
        if (pts.length >= 3) {
          let outIdx = -1;
          for (let k = 0; k < pts.length; k++) {
            if (Math.abs(pts[k][0]) > Cx - 0.02 || Math.abs(pts[k][1]) > Cy - 0.02) {
              outIdx = k;
              break;
            }
          }
          if (outIdx === -1) {
            const area = Math.abs(polyAreaSignedJS(pts));
            if (area > 0.02) closedLoops.push({ poly: pts, area, role });
          } else {
            // Closed ring crosses or touches bbox boundary: rotate seam to outside vertex
            // so interior arcs clip into clean boundary-to-boundary chords.
            const rotPts = pts.slice(outIdx).concat(pts.slice(0, outIdx + 1));
            openChains.push({ pts: rotPts, role });
          }
        }
      }
    } else if (curr.length >= 2) {
      const pts = nodesToPts(curr, tol);
      if (pts.length >= 2) openChains.push({ pts, role });
    }
  }
}

function _pickLoopProbePtJS(poly, Cx, Cy) {
  let best = poly[0];
  let bestMargin = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const m = Math.min(Cx - Math.abs(p[0]), Cy - Math.abs(p[1]));
    if (m > bestMargin) {
      bestMargin = m;
      best = p;
    }
  }
  return best;
}

function _buildPureLoopEntriesJS(closedLoops, Cx, Cy) {
  if (closedLoops.length === 0) return { outerEntries: [], outerPolys: [], innerPolys: [] };
  const sorted = closedLoops.slice().sort((a, b) => b.area - a.area);
  const n = sorted.length;
  const parent = new Int32Array(n).fill(-1);
  const isShell = new Array(n).fill(false);
  const probes = sorted.map(l => _pickLoopProbePtJS(l.poly, Cx, Cy));

  for (let i = 0; i < n; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (pointInPolyLocal(probes[i][0], probes[i][1], sorted[j].poly)) {
        parent[i] = j;
        break;
      }
    }
    if (parent[i] === -1) {
      isShell[i] = (sorted[i].role !== 'inner');
    } else {
      isShell[i] = !isShell[parent[i]];
    }
  }

  const outerEntries = [];
  const innerPolys = [];
  for (let i = 0; i < n; i++) {
    if (!isShell[i]) innerPolys.push(sorted[i].poly);
  }
  for (let i = 0; i < n; i++) {
    if (!isShell[i]) continue;
    const holes = [];
    for (let j = i + 1; j < n; j++) {
      if (parent[j] === i && !isShell[j]) holes.push(sorted[j].poly);
    }
    outerEntries.push({ outer: sorted[i].poly, holes });
  }
  return {
    outerEntries,
    outerPolys: outerEntries.map(e => e.outer),
    innerPolys
  };
}

function stitchClippedMultipolygonRingsJS(outerWayNodeLists, innerWayNodeLists, nodesToPts, halfW, halfH, opts = {}) {
  const tol = opts.tol || 0.018;
  const Cx = Math.max(4.0, (opts.clipHalfW || halfW) - 0.35);
  const Cy = Math.max(4.0, (opts.clipHalfH || halfH) - 0.35);
  const isWater = Boolean(opts.isWater);
  const relName = String(opts.relName || '').trim().toLowerCase();
  const waterSamples = opts.waterSamplePts || [];
  const bldSamples = opts.buildingSamplePts || [];
  const roadSamples = opts.roadSamplePts || [];

  // Insert ALL outer and inner boundary rings of this multipolygon TOGETHER into ONE
  // combined planar arrangement clipped to [-Cx, Cx] x [-Cy, Cy].
  const closedLoops = [];
  const openChains = [];
  _extractRoleChainsJS(outerWayNodeLists, 'outer', nodesToPts, Cx, Cy, tol, closedLoops, openChains);
  _extractRoleChainsJS(innerWayNodeLists, 'inner', nodesToPts, Cx, Cy, tol, closedLoops, openChains);

  if (openChains.length === 0) {
    return _buildPureLoopEntriesJS(closedLoops, Cx, Cy);
  }

  const P = 4 * (Cx + Cy);
  const rectArea = 4 * Cx * Cy;

  const isOnBoundary = (pt) => Math.abs(Math.abs(pt[0]) - Cx) < 0.08 || Math.abs(Math.abs(pt[1]) - Cy) < 0.08;
  const snapNearBoundary = (pt) => {
    const dx = Cx - Math.abs(pt[0]);
    const dy = Cy - Math.abs(pt[1]);
    if (Math.min(dx, dy) > 1.6) return null;
    if (dx <= dy) return [pt[0] >= 0 ? Cx : -Cx, Math.max(-Cy, Math.min(Cy, pt[1]))];
    return [Math.max(-Cx, Math.min(Cx, pt[0])), pt[1] >= 0 ? Cy : -Cy];
  };
  const ccwParam = (pt) => {
    const x = pt[0], y = pt[1];
    if (Math.abs(y + Cy) <= 0.09) return Math.max(0, Math.min(2 * Cx, x + Cx));
    if (Math.abs(x - Cx) <= 0.09) return 2 * Cx + Math.max(0, Math.min(2 * Cy, y + Cy));
    if (Math.abs(y - Cy) <= 0.09) return 2 * Cx + 2 * Cy + Math.max(0, Math.min(2 * Cx, Cx - x));
    return 4 * Cx + 2 * Cy + Math.max(0, Math.min(2 * Cy, Cy - y));
  };
  const ccwCorners = [
    [2 * Cx, [Cx, -Cy]],
    [2 * Cx + 2 * Cy, [Cx, Cy]],
    [4 * Cx + 2 * Cy, [-Cx, Cy]],
    [P, [-Cx, -Cy]]
  ];
  const ccwBoundaryArc = (sFrom, sTo) => {
    const span = ((sTo - sFrom) % P + P) % P;
    if (span < 1e-4) return [];
    return ccwCorners
      .map(c => [((c[0] - sFrom) % P + P) % P, c[1]])
      .filter(c => c[0] > 0.04 && c[0] < span - 0.04)
      .sort((a, b) => a[0] - b[0])
      .map(c => c[1]);
  };

  const rawChords = [];
  for (const ch of openChains) {
    const pieces = _clipPolylineToRectPieces(ch.pts, Cx, Cy);
    for (const pc of pieces) {
      if (pc.length < 2) continue;
      let p0 = pc[0], pN = pc[pc.length - 1];
      if (!isOnBoundary(p0)) {
        if (pc.length >= 4 && Math.hypot(p0[0] - pN[0], p0[1] - pN[1]) < 0.85) {
          const area = Math.abs(polyAreaSignedJS(pc));
          if (area > 0.02) closedLoops.push({ poly: pc, area, role: ch.role });
          continue;
        }
        const sn0 = snapNearBoundary(p0);
        if (!sn0) continue;
        pc[0] = sn0;
        p0 = sn0;
      }
      if (!isOnBoundary(pN)) {
        const snN = snapNearBoundary(pN);
        if (!snN) continue;
        pc[pc.length - 1] = snN;
        pN = snN;
      }
      if (Math.hypot(p0[0] - pN[0], p0[1] - pN[1]) < 0.12) {
        if (pc.length >= 4) {
          const area = Math.abs(polyAreaSignedJS(pc));
          if (area > 0.02) closedLoops.push({ poly: pc, area, role: ch.role });
        }
        continue;
      }
      rawChords.push({ pts: pc, role: ch.role });
    }
  }

  // Merge chords sharing boundary endpoints within the same role
  let mergedChord = true;
  while (mergedChord && rawChords.length > 1) {
    mergedChord = false;
    for (let i = 0; i < rawChords.length && !mergedChord; i++) {
      for (let j = i + 1; j < rawChords.length; j++) {
        const cA = rawChords[i], cB = rawChords[j];
        if (cA.role !== cB.role) continue;
        const A = cA.pts, B = cB.pts;
        const a0 = A[0], a1 = A[A.length - 1], b0 = B[0], b1 = B[B.length - 1];
        let joined = null;
        if (Math.hypot(a1[0] - b0[0], a1[1] - b0[1]) < 0.08) joined = A.concat(B.slice(1));
        else if (Math.hypot(a1[0] - b1[0], a1[1] - b1[1]) < 0.08) joined = A.concat(B.slice(0, -1).reverse());
        else if (Math.hypot(a0[0] - b1[0], a0[1] - b1[1]) < 0.08) joined = B.slice(0, -1).concat(A);
        else if (Math.hypot(a0[0] - b0[0], a0[1] - b0[1]) < 0.08) joined = B.slice(1).reverse().concat(A);
        if (joined) {
          rawChords.splice(j, 1);
          if (Math.hypot(joined[0][0] - joined[joined.length - 1][0], joined[0][1] - joined[joined.length - 1][1]) < 0.12) {
            rawChords.splice(i, 1);
            if (joined.length >= 4) {
              const area = Math.abs(polyAreaSignedJS(joined));
              if (area > 0.02) closedLoops.push({ poly: joined, area, role: cA.role });
            }
          } else {
            rawChords[i] = { pts: joined, role: cA.role };
          }
          mergedChord = true;
          break;
        }
      }
    }
  }

  const K = rawChords.length;
  if (K === 0) {
    return _buildPureLoopEntriesJS(closedLoops, Cx, Cy);
  }
  if (K > 96) {
    return _buildPureLoopEntriesJS(closedLoops, Cx, Cy);
  }

  const chords = rawChords.map((c, idx) => ({
    idx,
    pts: c.pts,
    role: c.role,
    sStart: ccwParam(c.pts[0]),
    sEnd: ccwParam(c.pts[c.pts.length - 1])
  }));

  const terminals = [];
  for (let i = 0; i < K; i++) {
    let s0 = chords[i].sStart, s1 = chords[i].sEnd;
    if (Math.abs(s0 - s1) < 1e-4) s1 = (s1 + 0.002) % P;
    terminals.push({ id: 2 * i, s: s0, outHe: 2 * i });
    terminals.push({ id: 2 * i + 1, s: s1, outHe: 2 * i + 1 });
  }
  terminals.sort((a, b) => a.s - b.s || a.id - b.id);
  const termRank = new Array(2 * K);
  for (let r = 0; r < terminals.length; r++) termRank[terminals[r].id] = r;

  const visitedHe = new Array(2 * K).fill(false);
  const heFace = new Array(2 * K).fill(-1);
  const faces = [];
  let validTopology = true;

  for (let startHe = 0; startHe < 2 * K; startHe++) {
    if (visitedHe[startHe]) continue;
    const facePts = [];
    let curHe = startHe;
    let steps = 0;
    let chordTouchCount = 0;
    while (!visitedHe[curHe]) {
      if (++steps > 2 * K + 2) { validTopology = false; break; }
      visitedHe[curHe] = true;
      heFace[curHe] = faces.length;
      chordTouchCount++;
      const chordIdx = curHe >> 1;
      const isRev = (curHe & 1) === 1;
      const cPts = isRev ? chords[chordIdx].pts.slice().reverse() : chords[chordIdx].pts;
      for (let k = 0; k < cPts.length; k++) {
        const p = cPts[k];
        const prev = facePts[facePts.length - 1];
        if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.01) facePts.push(p);
      }
      const endTermId = isRev ? (2 * chordIdx) : (2 * chordIdx + 1);
      const rank = termRank[endTermId];
      const nextTerm = terminals[(rank + 1) % (2 * K)];
      const arcPts = ccwBoundaryArc(terminals[rank].s, nextTerm.s);
      for (let k = 0; k < arcPts.length; k++) facePts.push(arcPts[k]);
      curHe = nextTerm.outHe;
    }
    if (curHe !== startHe || facePts.length < 3) { validTopology = false; break; }
    if (Math.hypot(facePts[0][0] - facePts[facePts.length - 1][0], facePts[0][1] - facePts[facePts.length - 1][1]) < 0.02) {
      facePts.pop();
    }
    const area = Math.abs(polyAreaSignedJS(facePts));
    if (facePts.length >= 3 && area > 0.02) {
      faces.push({ poly: facePts, area, chordTouchCount });
    } else {
      validTopology = false;
      break;
    }
  }

  const sumArea = faces.reduce((acc, f) => acc + f.area, 0);
  if (!validTopology || faces.length !== K + 1 || Math.abs(sumArea - rectArea) > rectArea * 0.16) {
    return _buildPureLoopEntriesJS(closedLoops, Cx, Cy);
  }

  const adj = Array.from({ length: faces.length }, () => []);
  for (let i = 0; i < K; i++) {
    const fA = heFace[2 * i], fB = heFace[2 * i + 1];
    if (fA >= 0 && fB >= 0 && fA !== fB) {
      adj[fA].push(fB);
      adj[fB].push(fA);
    } else {
      validTopology = false;
    }
  }
  if (!validTopology) {
    return _buildPureLoopEntriesJS(closedLoops, Cx, Cy);
  }

  const colors = new Array(faces.length).fill(-1);
  colors[0] = 0;
  const queue = [0];
  for (let qi = 0; qi < queue.length && validTopology; qi++) {
    const u = queue[qi];
    for (const v of adj[u]) {
      if (colors[v] === -1) {
        colors[v] = 1 - colors[u];
        queue.push(v);
      } else if (colors[v] === colors[u]) {
        validTopology = false;
        break;
      }
    }
  }
  if (!validTopology || !colors.every(c => c === 0 || c === 1)) {
    return _buildPureLoopEntriesJS(closedLoops, Cx, Cy);
  }

  // Sort interior closedLoops by descending area and assign each to its containing minimal chord-face
  const sortedLoops = closedLoops.slice().sort((a, b) => b.area - a.area);
  const L = sortedLoops.length;
  const loopProbes = sortedLoops.map(l => _pickLoopProbePtJS(l.poly, Cx, Cy));
  const loopFace = new Int32Array(L).fill(-1);
  const loopParent = new Int32Array(L).fill(-1);
  const loopRelDepth = new Int32Array(L).fill(0);
  const faceLoopIndices = Array.from({ length: faces.length }, () => []);

  for (let li = 0; li < L; li++) {
    const pr = loopProbes[li];
    for (let fi = 0; fi < faces.length; fi++) {
      if (pointInPolyLocal(pr[0], pr[1], faces[fi].poly)) {
        loopFace[li] = fi;
        break;
      }
    }
    const fi = loopFace[li];
    if (fi < 0) continue;
    for (let pj = li - 1; pj >= 0; pj--) {
      if (loopFace[pj] === fi && pointInPolyLocal(pr[0], pr[1], sortedLoops[pj].poly)) {
        loopParent[li] = pj;
        loopRelDepth[li] = loopRelDepth[pj] + 1;
        break;
      }
    }
    faceLoopIndices[fi].push(li);
  }

  const effArea = [0, 0];
  const multiChordFaces = [0, 0];
  const orphanInnerHits = [0, 0];
  for (let fi = 0; fi < faces.length; fi++) {
    const c = colors[fi];
    effArea[c] += faces[fi].area;
    if (faces[fi].chordTouchCount >= 2) multiChordFaces[c]++;
    for (const li of faceLoopIndices[fi]) {
      const d = loopRelDepth[li];
      const la = sortedLoops[li].area;
      if ((d & 1) === 0) {
        effArea[c] -= la;
        effArea[1 - c] += la;
        if (d === 0) {
          if (sortedLoops[li].role === 'inner') orphanInnerHits[c]++;
          else if (sortedLoops[li].role === 'outer') orphanInnerHits[1 - c]++;
        }
      } else {
        effArea[1 - c] -= la;
        effArea[c] += la;
      }
    }
  }
  effArea[0] = Math.max(1.0, effArea[0]);
  effArea[1] = Math.max(1.0, effArea[1]);

  const evalSampleParity = (px, py) => {
    let hitFi = -1;
    for (let fi = 0; fi < faces.length; fi++) {
      if (pointInPolyLocal(px, py, faces[fi].poly)) {
        hitFi = fi;
        break;
      }
    }
    if (hitFi < 0) return null;
    let d = 0;
    const fLoops = faceLoopIndices[hitFi];
    for (let k = 0; k < fLoops.length; k++) {
      if (pointInPolyLocal(px, py, sortedLoops[fLoops[k]].poly)) d++;
    }
    return { fi: hitFi, c: (colors[hitFi] + d) & 1, inLoop: d > 0 };
  };

  const dryBldHits = [0, 0];
  const dryRoadHits = [0, 0];
  const dryMotorRoadHits = [0, 0];
  const matchedWaterHits = [0, 0];
  const faceExposedBlds = new Int32Array(faces.length);
  const faceExposedRoads = new Int32Array(faces.length);

  for (let bi = 0; bi < bldSamples.length; bi++) {
    const bp = bldSamples[bi];
    const hit = evalSampleParity(bp[0], bp[1]);
    if (hit) {
      dryBldHits[hit.c]++;
      if (!hit.inLoop) faceExposedBlds[hit.fi]++;
    }
  }

  for (let ri = 0; ri < roadSamples.length; ri++) {
    const rp = roadSamples[ri];
    const rKind = rp[2] || 1;
    if (!isWater && rKind < 2) continue;
    const hit = evalSampleParity(rp[0], rp[1]);
    if (hit) {
      dryRoadHits[hit.c]++;
      if (rKind >= 2) {
        dryMotorRoadHits[hit.c]++;
        if (!hit.inLoop) faceExposedRoads[hit.fi]++;
      }
    }
  }

  if (isWater && waterSamples.length > 0) {
    for (let wi = 0; wi < waterSamples.length; wi++) {
      const wp = waterSamples[wi];
      const wWeight = wp[2] || 1;
      const wName = wp[3] || '';
      const hit = evalSampleParity(wp[0], wp[1]);
      if (!hit) continue;
      if (relName) {
        if (wName === relName) matchedWaterHits[hit.c] += wWeight;
      } else if (!wName && faces[hit.fi].chordTouchCount >= 2 && faces[hit.fi].area <= rectArea * 0.45) {
        matchedWaterHits[hit.c] += wWeight;
      }
    }
  }

  const b0 = dryBldHits[0], b1 = dryBldHits[1];
  const r0 = dryRoadHits[0], r1 = dryRoadHits[1];
  const bd0 = b0 / Math.max(25, effArea[0]);
  const bd1 = b1 / Math.max(25, effArea[1]);
  const rd0 = r0 / Math.max(25, effArea[0]);
  const rd1 = r1 / Math.max(25, effArea[1]);

  let chosen = -1;
  if (isWater) {
    // 1. Dry-land building veto: open water never contains dry-land city buildings
    if ((b0 + b1) >= 2) {
      if (b0 === 0 && b1 >= 2) chosen = 0;
      else if (b1 === 0 && b0 >= 2) chosen = 1;
      else if (b0 * 2.5 + 2 <= b1 && bd0 <= bd1 * 0.65) chosen = 0;
      else if (b1 * 2.5 + 2 <= b0 && bd1 <= bd0 * 0.65) chosen = 1;
      else if (Math.abs(b0 - b1) >= 8 && (b0 < b1 ? effArea[0] : effArea[1]) <= rectArea * 0.68) {
        chosen = b0 < b1 ? 0 : 1;
      }
    }
    // 2. Ground-street veto: open water never contains non-bridge ground streets/paths
    if (chosen < 0 && (r0 + r1) >= 2) {
      if (r0 === 0 && r1 >= 2) chosen = 0;
      else if (r1 === 0 && r0 >= 2) chosen = 1;
      else if (r0 * 2.5 + 2 <= r1 && rd0 <= rd1 * 0.65) chosen = 0;
      else if (r1 * 2.5 + 2 <= r0 && rd1 <= rd0 * 0.65) chosen = 1;
    }
    // 3. Explicit OSM outer/inner island parity
    if (chosen < 0 && orphanInnerHits[0] !== orphanInnerHits[1]) {
      chosen = orphanInnerHits[0] > orphanInnerHits[1] ? 0 : 1;
    }
    // 4. Same-name river/canal centerline match
    if (chosen < 0 && matchedWaterHits[0] !== matchedWaterHits[1]) {
      const cand = matchedWaterHits[0] > matchedWaterHits[1] ? 0 : 1;
      chosen = effArea[cand] <= rectArea * 0.70 ? cand : (effArea[0] <= effArea[1] ? 0 : 1);
    }
    // 5. Multi-chord channel strip (2-bank river/canal in wilderness)
    if (chosen < 0 && K >= 2 && multiChordFaces[0] !== multiChordFaces[1]) {
      const cand = multiChordFaces[0] > multiChordFaces[1] ? 0 : 1;
      chosen = effArea[cand] <= rectArea * 0.72 ? cand : (effArea[0] <= effArea[1] ? 0 : 1);
    }
    // 6. Smaller-area fallback
    if (chosen < 0) {
      chosen = effArea[0] <= effArea[1] ? 0 : 1;
    }
  } else {
    // Green / Plaza multipolygons: dense urban building + motor-road veto
    const urb0 = b0 + r0 * 0.7;
    const urb1 = b1 + r1 * 0.7;
    const ud0 = urb0 / Math.max(25, effArea[0]);
    const ud1 = urb1 / Math.max(25, effArea[1]);
    if ((urb0 + urb1) >= 5) {
      if (urb0 * 3.5 + 3 <= urb1 && ud0 <= ud1 * 0.45) chosen = 0;
      else if (urb1 * 3.5 + 3 <= urb0 && ud1 <= ud0 * 0.45) chosen = 1;
    }
    if (chosen < 0 && orphanInnerHits[0] !== orphanInnerHits[1]) {
      chosen = orphanInnerHits[0] > orphanInnerHits[1] ? 0 : 1;
    }
    if (chosen < 0 && K >= 2 && multiChordFaces[0] !== multiChordFaces[1]) {
      const cand = multiChordFaces[0] > multiChordFaces[1] ? 0 : 1;
      chosen = effArea[cand] <= rectArea * 0.72 ? cand : (effArea[0] <= effArea[1] ? 0 : 1);
    }
    if (chosen < 0) {
      chosen = effArea[0] <= effArea[1] ? 0 : 1;
    }
  }

  // Reconstruct exact { outer, holes } entries across all chord-faces and nested closedLoops
  const outerEntries = [];
  const innerPolys = [];
  const oppColor = 1 - chosen;
  const oppUrbCount = dryBldHits[oppColor] + dryMotorRoadHits[oppColor] * 0.8;
  const oppUrbDensity = oppUrbCount / Math.max(25, effArea[oppColor]);

  for (let fi = 0; fi < faces.length; fi++) {
    let faceActive = (colors[fi] === chosen);
    // Per-face city-flood safety net: veto huge urban city complement faces, while preserving
    // genuine harbours/bays (e.g. Sydney Harbour) whose urban density is far sparser than dry land
    if (isWater && faceActive && faces[fi].area > rectArea * 0.42) {
      const faceUrbCount = faceExposedBlds[fi] + faceExposedRoads[fi] * 0.8;
      const faceUrbDensity = faceUrbCount / Math.max(25, faces[fi].area);
      const isMuchSparserThanDryLand = (oppUrbCount >= 6 && faceUrbDensity <= oppUrbDensity * 0.18);
      if (!isMuchSparserThanDryLand && (faceExposedBlds[fi] >= 12 || (faceExposedBlds[fi] >= 6 && faceExposedRoads[fi] >= 6))) {
        faceActive = false;
      }
    }

    const fLoops = faceLoopIndices[fi];
    const loopIsShell = new Map();
    for (const li of fLoops) {
      const d = loopRelDepth[li];
      let shell;
      if (d === 0) {
        shell = faceActive ? false : (sortedLoops[li].role !== 'inner');
      } else {
        shell = !loopIsShell.get(loopParent[li]);
      }
      loopIsShell.set(li, shell);
      if (!shell) innerPolys.push(sortedLoops[li].poly);
    }

    if (faceActive) {
      const holes = [];
      for (const li of fLoops) {
        if (loopRelDepth[li] === 0 && !loopIsShell.get(li)) {
          holes.push(sortedLoops[li].poly);
        }
      }
      outerEntries.push({ outer: faces[fi].poly, holes });
    }

    for (const li of fLoops) {
      if (!loopIsShell.get(li)) continue;
      const holes = [];
      for (const cj of fLoops) {
        if (loopParent[cj] === li && !loopIsShell.get(cj)) {
          holes.push(sortedLoops[cj].poly);
        }
      }
      outerEntries.push({ outer: sortedLoops[li].poly, holes });
    }
  }

  return {
    outerEntries,
    outerPolys: outerEntries.map(e => e.outer),
    innerPolys
  };
}

function stitchCoastlineSeaPolysJS(coastWays, halfW, halfH, waterPolys) {
  if (!coastWays || coastWays.length === 0) return;

  // 1. Merge connected coastline ways strictly in forward direction (OSM invariant:
  //    walking forward along natural=coastline ALWAYS has LAND on LEFT and WATER on RIGHT).
  const chains = coastWays.filter(c => c && c.length >= 2).map(c => c.slice());
  let merged = true;
  while (merged && chains.length > 1) {
    merged = false;
    for (let i = 0; i < chains.length && !merged; i++) {
      for (let j = 0; j < chains.length; j++) {
        if (i === j) continue;
        const endI = chains[i][chains[i].length - 1];
        const startJ = chains[j][0];
        if (Math.hypot(endI[0] - startJ[0], endI[1] - startJ[1]) < 0.35) {
          chains[i] = chains[i].concat(chains[j].slice(1));
          chains.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }

  const Cx = Math.max(4.0, halfW - 0.25);
  const Cy = Math.max(4.0, halfH - 0.25);
  const P = 4 * (Cx + Cy);
  const rectArea = 4 * Cx * Cy;

  const isOnBoundary = (pt) => Math.abs(Math.abs(pt[0]) - Cx) < 0.08 || Math.abs(Math.abs(pt[1]) - Cy) < 0.08;
  const snapNearBoundary = (pt) => {
    const dx = Cx - Math.abs(pt[0]);
    const dy = Cy - Math.abs(pt[1]);
    if (Math.min(dx, dy) > 1.8) return null;
    if (dx <= dy) return [pt[0] >= 0 ? Cx : -Cx, Math.max(-Cy, Math.min(Cy, pt[1]))];
    return [Math.max(-Cx, Math.min(Cx, pt[0])), pt[1] >= 0 ? Cy : -Cy];
  };

  // Parameterize boundary CLOCKWISE in [0, P): Top (-Cx->+Cx), Right (+Cy->-Cy), Bottom (+Cx->-Cx), Left (-Cy->+Cy)
  const cwParam = (pt) => {
    const x = pt[0], y = pt[1];
    if (Math.abs(y - Cy) <= 0.09) return Math.max(0, Math.min(2 * Cx, x + Cx));
    if (Math.abs(x - Cx) <= 0.09) return 2 * Cx + Math.max(0, Math.min(2 * Cy, Cy - y));
    if (Math.abs(y + Cy) <= 0.09) return 2 * Cx + 2 * Cy + Math.max(0, Math.min(2 * Cx, Cx - x));
    return 4 * Cx + 2 * Cy + Math.max(0, Math.min(2 * Cy, y + Cy));
  };
  const cwCorners = [
    [2 * Cx, [Cx, Cy]],
    [2 * Cx + 2 * Cy, [Cx, -Cy]],
    [4 * Cx + 2 * Cy, [-Cx, -Cy]],
    [P, [-Cx, Cy]]
  ];
  const cwBoundaryArc = (sFrom, sTo) => {
    const span = ((sTo - sFrom) % P + P) % P;
    if (span < 1e-4) return [];
    return cwCorners
      .map(c => [((c[0] - sFrom) % P + P) % P, c[1]])
      .filter(c => c[0] > 0.04 && c[0] < span - 0.04)
      .sort((a, b) => a[0] - b[0])
      .map(c => c[1]);
  };

  const seaPolysOut = [];
  const landIslands = [];
  const directedChords = [];

  const classifyClosedCoastRing = (ring) => {
    if (!ring || ring.length < 3) return;
    const sArea = polyAreaSignedJS(ring);
    if (sArea < -0.04) {
      // Clockwise -> interior on RIGHT -> sea/lagoon basin
      seaPolysOut.push(ring);
    } else if (sArea > 0.04) {
      // Counter-clockwise -> interior on LEFT -> dry land island inside sea
      landIslands.push(ring);
    }
  };

  for (const ch of chains) {
    if (ch.length >= 4 && Math.hypot(ch[0][0] - ch[ch.length - 1][0], ch[0][1] - ch[ch.length - 1][1]) < 0.45) {
      // Clip closed ring if it extends wildly outside [-Cx, Cx] x [-Cy, Cy], or keep if wholly inside
      const allInside = ch.every(p => Math.abs(p[0]) <= Cx + 0.05 && Math.abs(p[1]) <= Cy + 0.05);
      if (allInside) {
        classifyClosedCoastRing(ch);
        continue;
      }
    }

    const pieces = _clipPolylineToRectPieces(ch, Cx, Cy);
    for (const rawPc of pieces) {
      const pc = simplifyRingJS(rawPc, 0.02);
      if (pc.length < 2) continue;
      let p0 = pc[0], pN = pc[pc.length - 1];
      if (!isOnBoundary(p0) && !isOnBoundary(pN) && pc.length >= 4 && Math.hypot(p0[0] - pN[0], p0[1] - pN[1]) < 0.6) {
        classifyClosedCoastRing(pc);
        continue;
      }
      if (!isOnBoundary(p0)) {
        const sn0 = snapNearBoundary(p0);
        if (!sn0) continue;
        pc[0] = sn0;
        p0 = sn0;
      }
      if (!isOnBoundary(pN)) {
        const snN = snapNearBoundary(pN);
        if (!snN) continue;
        pc[pc.length - 1] = snN;
        pN = snN;
      }
      if (Math.hypot(p0[0] - pN[0], p0[1] - pN[1]) < 0.12) {
        if (pc.length >= 4) classifyClosedCoastRing(pc);
        continue;
      }
      directedChords.push(pc);
    }
  }

  // Merge directed chords whose exit touches another chord's entry on the boundary
  let mergedDir = true;
  while (mergedDir && directedChords.length > 1) {
    mergedDir = false;
    for (let i = 0; i < directedChords.length && !mergedDir; i++) {
      for (let j = 0; j < directedChords.length; j++) {
        if (i === j) continue;
        const A = directedChords[i], B = directedChords[j];
        const aEnd = A[A.length - 1], bStart = B[0];
        if (Math.hypot(aEnd[0] - bStart[0], aEnd[1] - bStart[1]) < 0.08) {
          const joined = A.concat(B.slice(1));
          directedChords.splice(Math.max(i, j), 1);
          directedChords.splice(Math.min(i, j), 1);
          if (Math.hypot(joined[0][0] - joined[joined.length - 1][0], joined[0][1] - joined[joined.length - 1][1]) < 0.12) {
            if (joined.length >= 4) classifyClosedCoastRing(joined);
          } else {
            directedChords.push(joined);
          }
          mergedDir = true;
          break;
        }
      }
    }
  }

  const K = directedChords.length;
  if (K >= 1) {
    // Primary exact directed coastline planar cycle tracer:
    // Walking forward along chord i (water on RIGHT) and turning RIGHT (CLOCKWISE) along dRect
    // reaches the exact matching entry terminal of the next coastline chord bounding the same water face.
    const terminals = [];
    for (let i = 0; i < K; i++) {
      const pts = directedChords[i];
      let sEntry = cwParam(pts[0]);
      let sExit = cwParam(pts[pts.length - 1]);
      if (Math.abs(sEntry - sExit) < 1e-4) sExit = (sExit + 0.002) % P;
      terminals.push({ kind: 'entry', chordIdx: i, s: sEntry });
      terminals.push({ kind: 'exit', chordIdx: i, s: sExit });
    }
    terminals.sort((a, b) => a.s - b.s);

    const exitRank = new Array(K).fill(-1);
    for (let r = 0; r < terminals.length; r++) {
      if (terminals[r].kind === 'exit') exitRank[terminals[r].chordIdx] = r;
    }

    const usedChord = new Array(K).fill(false);
    const tracedDirectedFaces = [];
    let allCyclesValid = true;

    for (let startIdx = 0; startIdx < K; startIdx++) {
      if (usedChord[startIdx]) continue;
      const facePts = [];
      let curIdx = startIdx;
      let steps = 0;
      while (!usedChord[curIdx]) {
        if (++steps > K + 2) { allCyclesValid = false; break; }
        usedChord[curIdx] = true;
        const pts = directedChords[curIdx];
        for (let k = 0; k < pts.length; k++) {
          const p = pts[k];
          const prev = facePts[facePts.length - 1];
          if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.01) facePts.push(p);
        }
        const rExit = exitRank[curIdx];
        const nextTerm = terminals[(rExit + 1) % (2 * K)];
        if (nextTerm.kind !== 'entry') {
          allCyclesValid = false;
          break;
        }
        const arcPts = cwBoundaryArc(terminals[rExit].s, nextTerm.s);
        for (let k = 0; k < arcPts.length; k++) facePts.push(arcPts[k]);
        curIdx = nextTerm.chordIdx;
      }
      if (!allCyclesValid || curIdx !== startIdx || facePts.length < 3) {
        allCyclesValid = false;
        break;
      }
      if (Math.hypot(facePts[0][0] - facePts[facePts.length - 1][0], facePts[0][1] - facePts[facePts.length - 1][1]) < 0.02) {
        facePts.pop();
      }
      const sArea = polyAreaSignedJS(facePts);
      // A valid clockwise water face inside Rect has negative signed area and area < rectArea
      if (facePts.length >= 3 && sArea < -0.02 && Math.abs(sArea) <= rectArea * 1.02) {
        tracedDirectedFaces.push(facePts);
      } else {
        allCyclesValid = false;
        break;
      }
    }

    if (allCyclesValid && tracedDirectedFaces.length > 0) {
      for (const fp of tracedDirectedFaces) seaPolysOut.push(fp);
    } else {
      // Fallback for incomplete OSM coastline segments: sample right-hand water probes along each chord
      // and run undirected planar face 2-coloring.
      const rightWaterProbes = [];
      for (const pts of directedChords) {
        const mid = Math.floor((pts.length - 1) * 0.5);
        const pA = pts[mid], pB = pts[Math.min(pts.length - 1, mid + 1)];
        const dx = pB[0] - pA[0], dy = pB[1] - pA[1];
        const len = Math.hypot(dx, dy);
        if (len > 1e-4) {
          // Right-hand normal of (dx, dy) in (+x East, +y North) is (+dy/len, -dx/len)
          const mx = 0.5 * (pA[0] + pB[0]) + (dy / len) * 0.35;
          const my = 0.5 * (pA[1] + pB[1]) - (dx / len) * 0.35;
          if (Math.abs(mx) < Cx && Math.abs(my) < Cy) rightWaterProbes.push([mx, my, 4, '__coast_sea__']);
        }
      }
      const pseudoNodes = new Map();
      let nextNid = 1;
      const chordIdLists = directedChords.map(pts => pts.map(pt => {
        const id = nextNid++;
        pseudoNodes.set(id, pt);
        return id;
      }));
      const fallbackRes = stitchClippedMultipolygonRingsJS(
        chordIdLists,
        [],
        (ids) => ids.map(id => pseudoNodes.get(id)).filter(Boolean),
        halfW, halfH,
        {
          isWater: true,
          relName: '__coast_sea__',
          waterSamplePts: rightWaterProbes,
          clipHalfW: Cx + 0.35,
          clipHalfH: Cy + 0.35,
          tol: 0.015
        }
      );
      for (const fp of fallbackRes.outerPolys) seaPolysOut.push(fp);
    }
  }

  for (const sp of seaPolysOut) {
    const holes = landIslands.filter(isl => isl.length >= 3 && pointInPolyLocal(isl[0][0], isl[0][1], sp));
    waterPolys.push({ outer: sp, holes, name: 'Morze / Zatoka' });
  }
}

function chooseAdaptiveDemZoom(spanMeters) {
  const s = Number(spanMeters) || 1200;
  if (s <= 1300) return 15;
  if (s <= 2500) return 14;
  if (s <= 5500) return 13;
  if (s <= 11500) return 12;
  return 11;
}

async function fetchAdaptiveTerrariumDem(south, west, north, east, gridSize = 72, explicitZoom = null, abortSignal = null) {
  if (abortSignal && abortSignal.aborted) throw new Error('Aborted');
  const centerLat = (south + north) * 0.5;
  const cosLat = Math.max(0.2, Math.cos(centerLat * Math.PI / 180.0));
  const spanNsM = Math.abs(north - south) * 111320.0;
  const spanEwM = Math.abs(east - west) * 111320.0 * cosLat;
  const maxSpanM = Math.max(spanNsM, spanEwM);
  const zoom = explicitZoom || chooseAdaptiveDemZoom(maxSpanM);

  const xMinF = lon2tileF(west, zoom), xMaxF = lon2tileF(east, zoom);
  const yMinF = lat2tileF(north, zoom), yMaxF = lat2tileF(south, zoom);
  const tx0 = Math.floor(xMinF), tx1 = Math.floor(xMaxF);
  const ty0 = Math.floor(yMinF), ty1 = Math.floor(yMaxF);

  const tilePixels = {};
  const offCanvas = document.createElement('canvas');
  offCanvas.width = 256;
  offCanvas.height = 256;
  const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

  const promises = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      if (abortSignal && abortSignal.aborted) break;
      const cacheKey = `${zoom}_${tx}_${ty}`;
      if (_demTilePixelCache.has(cacheKey)) {
        tilePixels[`${tx}_${ty}`] = _demTilePixelCache.get(cacheKey);
        continue;
      }
      promises.push(new Promise((resolve) => {
        if (abortSignal && abortSignal.aborted) { resolve(); return; }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const timeoutId = setTimeout(() => resolve(), 8500);
        const onAbort = () => { clearTimeout(timeoutId); resolve(); };
        if (abortSignal) abortSignal.addEventListener('abort', onAbort, { once: true });
        img.onload = () => {
          clearTimeout(timeoutId);
          if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
          try {
            offCtx.clearRect(0, 0, 256, 256);
            offCtx.drawImage(img, 0, 0, 256, 256);
            const data = offCtx.getImageData(0, 0, 256, 256).data;
            _demTilePixelCache.set(cacheKey, data);
            if (_demTilePixelCache.size > 160) {
              _demTilePixelCache.delete(_demTilePixelCache.keys().next().value);
            }
            tilePixels[`${tx}_${ty}`] = data;
          } catch (_) {}
          resolve();
        };
        img.onerror = () => {
          clearTimeout(timeoutId);
          if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
          resolve();
        };
        img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`;
      }));
    }
  }
  if (promises.length > 0) await Promise.all(promises);
  if (abortSignal && abortSignal.aborted) throw new Error('Aborted');

  if (zoom === 15 && Object.keys(tilePixels).length === 0 && !explicitZoom) {
    return fetchAdaptiveTerrariumDem(south, west, north, east, gridSize, 14, abortSignal);
  }

  const grid = [];
  let minElev = Infinity, maxElev = -Infinity;
  for (let gy = 0; gy < gridSize; gy++) {
    const lat = south + (gy / (gridSize - 1)) * (north - south);
    const row = [];
    for (let gx = 0; gx < gridSize; gx++) {
      const lon = west + (gx / (gridSize - 1)) * (east - west);
      const xf = lon2tileF(lon, zoom), yf = lat2tileF(lat, zoom);
      const tx = Math.floor(xf), ty = Math.floor(yf);
      const px = Math.min(255, Math.max(0, Math.floor((xf - tx) * 256)));
      const py = Math.min(255, Math.max(0, Math.floor((yf - ty) * 256)));
      const data = tilePixels[`${tx}_${ty}`];
      let elev = 0;
      if (data) {
        const idx = (py * 256 + px) * 4;
        elev = (data[idx] * 256.0 + data[idx + 1] + data[idx + 2] / 256.0) - 32768.0;
      }
      row.push(Math.round(elev * 100) / 100);
      if (elev < minElev) minElev = elev;
      if (elev > maxElev) maxElev = elev;
    }
    grid.push(row);
  }
  if (!isFinite(minElev)) { minElev = 0; maxElev = 15; }
  const resolutionMeters = Math.round((40075016 * cosLat / (256 * Math.pow(2, zoom))) * 10) / 10;
  return {
    gridSize,
    minElev,
    maxElev,
    grid,
    zoom,
    source: 'AWS Terrarium (USGS 3DEP 10m / LiDAR ~3-5m)',
    resolutionMeters
  };
}

let fetchTerrariumDemInBrowser = async function (south, west, north, east, gridSize = 72, zoom = null) {
  return fetchAdaptiveTerrariumDem(south, west, north, east, gridSize, zoom || null);
};

if (typeof window !== 'undefined') {
  window.chooseAdaptiveDemZoom = chooseAdaptiveDemZoom;
  window.fetchAdaptiveTerrariumDem = fetchAdaptiveTerrariumDem;
  window.fetchTerrariumDemInBrowser = fetchTerrariumDemInBrowser;
  window.stitchClippedMultipolygonRingsJS = stitchClippedMultipolygonRingsJS;
  window.stitchCoastlineSeaPolysJS = stitchCoastlineSeaPolysJS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    simplifyRingJS,
    stitchWayRingsJS,
    polyAreaSignedJS,
    pointInPolyLocal,
    chooseAdaptiveDemZoom,
    fetchAdaptiveTerrariumDem,
    fetchTerrariumDemInBrowser,
    stitchClippedMultipolygonRingsJS,
    stitchCoastlineSeaPolysJS
  };
}
