// ============================================================================
// src/Water/water_multipolygon_stitcher.js
// Clipped Multipolygon Planar Arrangement, Micro-Sliver Filter & Gap Bridging
// ============================================================================

(function (root) {
  function _getGeom() {
    if (typeof polyAreaSignedJS === 'function' && typeof _extractRoleChainsJS === 'function' && typeof _buildPureLoopEntriesJS === 'function') {
      return { polyAreaSignedJS, pointInPolyLocal, _pickLoopProbePtJS, _buildPureLoopEntriesJS, _extractRoleChainsJS, _clipPolylineToRectPieces, _bridgeSegHitsPolylinesJS };
    }
    return require('./water_ring_geometry.js');
  }

  function _bridgeInteriorOpenChainsJS(openChains, closedLoops, Cx, Cy) {
    if (!openChains || openChains.length === 0) return;
    const geom = _getGeom(), maxGap = Math.min(4.5, Math.max(Cx, Cy) * 0.06);
    const isInteriorPt = (pt) => Math.abs(pt[0]) < Cx - 1.8 && Math.abs(pt[1]) < Cy - 1.8;
    let bridged = true;
    while (bridged && openChains.length > 1) {
      bridged = false;
      const ends = [];
      for (let ci = 0; ci < openChains.length; ci++) {
        const pts = openChains[ci].pts;
        if (!pts || pts.length < 2) continue;
        const p0 = pts[0], pN = pts[pts.length - 1], selfSpan = Math.hypot(p0[0] - pN[0], p0[1] - pN[1]);
        if (selfSpan < 0.85) continue;
        if (isInteriorPt(p0)) ends.push({ ci, isEnd: false, pt: p0, role: openChains[ci].role, selfSpan });
        if (isInteriorPt(pN)) ends.push({ ci, isEnd: true, pt: pN, role: openChains[ci].role, selfSpan });
      }
      if (ends.length < 2) break;
      const nearestIdx = new Int32Array(ends.length).fill(-1), nearestDist = new Float64Array(ends.length).fill(Infinity);
      for (let i = 0; i < ends.length; i++) {
        for (let j = 0; j < ends.length; j++) {
          if (ends[i].ci === ends[j].ci || ends[i].role !== ends[j].role) continue;
          const d = Math.hypot(ends[i].pt[0] - ends[j].pt[0], ends[i].pt[1] - ends[j].pt[1]);
          if (d < nearestDist[i]) { nearestDist[i] = d; nearestIdx[i] = j; }
        }
      }
      const cands = [];
      for (let i = 0; i < ends.length; i++) {
        const j = nearestIdx[i], gap = nearestDist[i];
        if (j > i && nearestIdx[j] === i && gap <= maxGap && ends[i].selfSpan > gap * 1.5 && ends[j].selfSpan > gap * 1.5) cands.push({ u: ends[i], v: ends[j], gap });
      }
      if (cands.length === 0) break;
      cands.sort((a, b) => a.gap - b.gap);
      const chainPtsList = openChains.map(c => c.pts);
      for (const { u, v } of cands) {
        if (geom._bridgeSegHitsPolylinesJS(u.pt, v.pt, chainPtsList, u.ci, v.ci, closedLoops)) continue;
        const A = openChains[u.ci].pts, B = openChains[v.ci].pts;
        const joined = (u.isEnd && !v.isEnd) ? A.concat(B) : (u.isEnd && v.isEnd) ? A.concat(B.slice().reverse())
          : (!u.isEnd && !v.isEnd) ? A.slice().reverse().concat(B) : B.concat(A);
        openChains[Math.min(u.ci, v.ci)] = { pts: joined, role: u.role };
        openChains.splice(Math.max(u.ci, v.ci), 1);
        bridged = true; break;
      }
    }
    const chainPtsList = openChains.map(c => c.pts);
    for (let ci = 0; ci < openChains.length; ci++) {
      const pts = openChains[ci].pts;
      if (!pts || pts.length < 4) continue;
      const p0 = pts[0], pN = pts[pts.length - 1];
      if (!isInteriorPt(p0) || !isInteriorPt(pN)) continue;
      const gap = Math.hypot(p0[0] - pN[0], p0[1] - pN[1]);
      if (gap <= 1e-4 || gap > maxGap) continue;
      let outIdx = -1;
      for (let k = 0; k < pts.length; k++) if (Math.abs(pts[k][0]) > Cx - 0.02 || Math.abs(pts[k][1]) > Cy - 0.02) { outIdx = k; break; }
      if (outIdx === -1) continue;
      let competing = false;
      for (let oj = 0; oj < openChains.length && !competing; oj++) {
        if (oj === ci || !openChains[oj].pts || openChains[oj].pts.length < 2) continue;
        const op = openChains[oj].pts;
        for (const ep of [op[0], op[op.length - 1]]) {
          if (isInteriorPt(ep) && (Math.hypot(ep[0] - p0[0], ep[1] - p0[1]) < gap * 1.5 || Math.hypot(ep[0] - pN[0], ep[1] - pN[1]) < gap * 1.5)) { competing = true; break; }
        }
      }
      if (competing || geom._bridgeSegHitsPolylinesJS(pN, p0, chainPtsList, ci, ci, closedLoops)) continue;
      const rotPts = pts.slice(outIdx).concat(pts.slice(0, outIdx + 1));
      openChains[ci] = { pts: rotPts, role: openChains[ci].role };
      chainPtsList[ci] = rotPts;
    }
  }

  function _chooseArrangementColorJS(opts, K, rectArea, effArea, dryBldHits, dryRoadHits, orphanInnerHits, matchedWaterHits, anyWaterHits, multiChordFaces) {
    const { isWater, isIsland } = opts;
    const b0 = dryBldHits[0], b1 = dryBldHits[1], r0 = dryRoadHits[0], r1 = dryRoadHits[1];
    const bd0 = b0 / Math.max(25, effArea[0]), bd1 = b1 / Math.max(25, effArea[1]);
    const rd0 = r0 / Math.max(25, effArea[0]), rd1 = r1 / Math.max(25, effArea[1]);
    let chosen = -1;
    if (isWater) {
      if ((b0 + b1) >= 2) {
        if (b0 === 0 && b1 >= 2) chosen = 0; else if (b1 === 0 && b0 >= 2) chosen = 1;
        else if (b0 * 2.5 + 2 <= b1 && bd0 <= bd1 * 0.65) chosen = 0; else if (b1 * 2.5 + 2 <= b0 && bd1 <= bd0 * 0.65) chosen = 1;
        else if (Math.abs(b0 - b1) >= 8 && (b0 < b1 ? effArea[0] : effArea[1]) <= rectArea * 0.68) chosen = b0 < b1 ? 0 : 1;
      }
      if (chosen < 0 && (r0 + r1) >= 2) {
        if (r0 === 0 && r1 >= 2) chosen = 0; else if (r1 === 0 && r0 >= 2) chosen = 1;
        else if (r0 * 2.5 + 2 <= r1 && rd0 <= rd1 * 0.65) chosen = 0; else if (r1 * 2.5 + 2 <= r0 && rd1 <= rd0 * 0.65) chosen = 1;
      }
      if (chosen < 0 && orphanInnerHits[0] !== orphanInnerHits[1]) chosen = orphanInnerHits[0] > orphanInnerHits[1] ? 0 : 1;
      if (chosen < 0 && matchedWaterHits[0] !== matchedWaterHits[1]) {
        const cand = matchedWaterHits[0] > matchedWaterHits[1] ? 0 : 1;
        chosen = effArea[cand] <= rectArea * 0.70 ? cand : (effArea[0] <= effArea[1] ? 0 : 1);
      }
      if (chosen < 0 && K >= 2 && multiChordFaces[0] !== multiChordFaces[1]) {
        const cand = multiChordFaces[0] > multiChordFaces[1] ? 0 : 1;
        chosen = effArea[cand] <= rectArea * 0.72 ? cand : (effArea[0] <= effArea[1] ? 0 : 1);
      }
      return chosen < 0 ? (effArea[0] <= effArea[1] ? 0 : 1) : chosen;
    }
    const urb0 = b0 + r0 * 0.7, urb1 = b1 + r1 * 0.7, ud0 = urb0 / Math.max(25, effArea[0]), ud1 = urb1 / Math.max(25, effArea[1]);
    if (isIsland) {
      const w0 = anyWaterHits[0], w1 = anyWaterHits[1];
      if ((urb0 + urb1) >= 2) {
        if (urb0 >= urb1 * 2.5 + 2 && ud0 >= ud1 * 1.4) chosen = 0; else if (urb1 >= urb0 * 2.5 + 2 && ud1 >= ud0 * 1.4) chosen = 1;
      }
      if (chosen < 0 && (w0 + w1) >= 2) { if (w0 === 0 && w1 >= 2) chosen = 0; else if (w1 === 0 && w0 >= 2) chosen = 1; }
      if (chosen < 0 && orphanInnerHits[0] !== orphanInnerHits[1]) chosen = orphanInnerHits[0] > orphanInnerHits[1] ? 0 : 1;
      if (chosen < 0 && Math.min(effArea[0], effArea[1]) <= rectArea * 0.40) chosen = effArea[0] <= effArea[1] ? 0 : 1;
      return (chosen < 0 || effArea[chosen] > rectArea * 0.45) ? -1 : chosen;
    }
    if ((urb0 + urb1) >= 5) {
      if (urb0 * 3.5 + 3 <= urb1 && ud0 <= ud1 * 0.45) chosen = 0; else if (urb1 * 3.5 + 3 <= urb0 && ud1 <= ud0 * 0.45) chosen = 1;
    }
    if (chosen < 0 && orphanInnerHits[0] !== orphanInnerHits[1]) chosen = orphanInnerHits[0] > orphanInnerHits[1] ? 0 : 1;
    if (chosen < 0 && K >= 2 && multiChordFaces[0] !== multiChordFaces[1]) {
      const cand = multiChordFaces[0] > multiChordFaces[1] ? 0 : 1;
      chosen = effArea[cand] <= rectArea * 0.72 ? cand : (effArea[0] <= effArea[1] ? 0 : 1);
    }
    return chosen < 0 ? (effArea[0] <= effArea[1] ? 0 : 1) : chosen;
  }

  function stitchClippedMultipolygonRingsJS(outerWayNodeLists, innerWayNodeLists, nodesToPts, halfW, halfH, opts = {}) {
    const geom = _getGeom(), tol = opts.tol || 0.018;
    const Cx = Math.max(4.0, (opts.clipHalfW || halfW) - 0.35), Cy = Math.max(4.0, (opts.clipHalfH || halfH) - 0.35);
    const isWater = Boolean(opts.isWater), isIsland = Boolean(opts.isIsland);
    const relName = String(opts.relName || '').trim().toLowerCase();
    const waterSamples = opts.waterSamplePts || [], bldSamples = opts.buildingSamplePts || [], roadSamples = opts.roadSamplePts || [];

    const closedLoops = [], openChains = [];
    geom._extractRoleChainsJS(outerWayNodeLists, 'outer', nodesToPts, Cx, Cy, tol, closedLoops, openChains);
    geom._extractRoleChainsJS(innerWayNodeLists, 'inner', nodesToPts, Cx, Cy, tol, closedLoops, openChains);
    if (openChains.length === 0) return geom._buildPureLoopEntriesJS(closedLoops, Cx, Cy);
    _bridgeInteriorOpenChainsJS(openChains, closedLoops, Cx, Cy);

    const P = 4 * (Cx + Cy), rectArea = 4 * Cx * Cy;
    const isOnBoundary = (pt) => Math.abs(Math.abs(pt[0]) - Cx) < 0.08 || Math.abs(Math.abs(pt[1]) - Cy) < 0.08;
    const snapNearBoundary = (pt) => {
      const dx = Cx - Math.abs(pt[0]), dy = Cy - Math.abs(pt[1]);
      if (Math.min(dx, dy) > 2.4) return null;
      return dx <= dy ? [pt[0] >= 0 ? Cx : -Cx, Math.max(-Cy, Math.min(Cy, pt[1]))] : [Math.max(-Cx, Math.min(Cx, pt[0])), pt[1] >= 0 ? Cy : -Cy];
    };
    const ccwParam = (pt) => {
      const x = pt[0], y = pt[1];
      if (Math.abs(y + Cy) <= 0.09) return Math.max(0, Math.min(2 * Cx, x + Cx));
      if (Math.abs(x - Cx) <= 0.09) return 2 * Cx + Math.max(0, Math.min(2 * Cy, y + Cy));
      if (Math.abs(y - Cy) <= 0.09) return 2 * Cx + 2 * Cy + Math.max(0, Math.min(2 * Cx, Cx - x));
      return 4 * Cx + 2 * Cy + Math.max(0, Math.min(2 * Cy, Cy - y));
    };
    const ccwCorners = [[2 * Cx, [Cx, -Cy]], [2 * Cx + 2 * Cy, [Cx, Cy]], [4 * Cx + 2 * Cy, [-Cx, Cy]], [P, [-Cx, -Cy]]];
    const ccwBoundaryArc = (sFrom, sTo) => {
      const span = ((sTo - sFrom) % P + P) % P;
      return span < 1e-4 ? [] : ccwCorners.map(c => [((c[0] - sFrom) % P + P) % P, c[1]]).filter(c => c[0] > 0.012 && c[0] < span - 0.012).sort((a, b) => a[0] - b[0]).map(c => c[1]);
    };

    const rawChords = [];
    for (const ch of openChains) {
      for (const pc of geom._clipPolylineToRectPieces(ch.pts, Cx, Cy)) {
        if (pc.length < 2) continue;
        let p0 = pc[0], pN = pc[pc.length - 1];
        if (!isOnBoundary(p0)) {
          if (pc.length >= 4 && Math.hypot(p0[0] - pN[0], p0[1] - pN[1]) < 0.85) {
            const area = Math.abs(geom.polyAreaSignedJS(pc));
            if (area > 0.02) closedLoops.push({ poly: pc, area, role: ch.role });
            continue;
          }
          const sn0 = snapNearBoundary(p0); if (!sn0) continue; pc[0] = p0 = sn0;
        }
        if (!isOnBoundary(pN)) {
          const snN = snapNearBoundary(pN); if (!snN) continue; pc[pc.length - 1] = pN = snN;
        }
        if (Math.hypot(p0[0] - pN[0], p0[1] - pN[1]) < 0.12) {
          if (pc.length >= 4) { const area = Math.abs(geom.polyAreaSignedJS(pc)); if (area > 0.02) closedLoops.push({ poly: pc, area, role: ch.role }); }
          continue;
        }
        rawChords.push({ pts: pc, role: ch.role });
      }
    }

    let mergedChord = true;
    while (mergedChord && rawChords.length > 1) {
      mergedChord = false;
      for (let i = 0; i < rawChords.length && !mergedChord; i++) {
        for (let j = i + 1; j < rawChords.length; j++) {
          const cA = rawChords[i], cB = rawChords[j];
          if (cA.role !== cB.role) continue;
          const A = cA.pts, B = cB.pts, a0 = A[0], a1 = A[A.length - 1], b0 = B[0], b1 = B[B.length - 1];
          let joined = null;
          if (Math.hypot(a1[0] - b0[0], a1[1] - b0[1]) < 0.08) joined = A.concat(B.slice(1));
          else if (Math.hypot(a1[0] - b1[0], a1[1] - b1[1]) < 0.08) joined = A.concat(B.slice(0, -1).reverse());
          else if (Math.hypot(a0[0] - b1[0], a0[1] - b1[1]) < 0.08) joined = B.slice(0, -1).concat(A);
          else if (Math.hypot(a0[0] - b0[0], a0[1] - b0[1]) < 0.08) joined = B.slice(1).reverse().concat(A);
          if (joined) {
            rawChords.splice(j, 1);
            if (Math.hypot(joined[0][0] - joined[joined.length - 1][0], joined[0][1] - joined[joined.length - 1][1]) < 0.12) {
              rawChords.splice(i, 1);
              if (joined.length >= 4) { const area = Math.abs(geom.polyAreaSignedJS(joined)); if (area > 0.02) closedLoops.push({ poly: joined, area, role: cA.role }); }
            } else rawChords[i] = { pts: joined, role: cA.role };
            mergedChord = true; break;
          }
        }
      }
    }

    for (let i = rawChords.length - 1; i >= 0; i--) {
      const pts = rawChords[i].pts, sStart = ccwParam(pts[0]), sEnd = ccwParam(pts[pts.length - 1]), spanCCW = ((sStart - sEnd) % P + P) % P;
      const capRaw = spanCCW <= (P - spanCCW) ? pts.concat(ccwBoundaryArc(sEnd, sStart)) : pts.slice().reverse().concat(ccwBoundaryArc(sStart, sEnd));
      const capPoly = [];
      for (const p of capRaw) { const prev = capPoly[capPoly.length - 1]; if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.01) capPoly.push(p); }
      if (capPoly.length >= 2 && Math.hypot(capPoly[0][0] - capPoly[capPoly.length - 1][0], capPoly[0][1] - capPoly[capPoly.length - 1][1]) < 0.02) capPoly.pop();
      const capArea = capPoly.length >= 3 ? Math.abs(geom.polyAreaSignedJS(capPoly)) : 0;
      if (capPoly.length < 3 || capArea <= 0.02 || (capArea <= 0.05 && capArea < rectArea * 1e-4)) rawChords.splice(i, 1);
    }

    const K = rawChords.length;
    if (K === 0 || K > 96) return geom._buildPureLoopEntriesJS(closedLoops, Cx, Cy);

    const chords = rawChords.map((c, idx) => ({ idx, pts: c.pts, role: c.role, sStart: ccwParam(c.pts[0]), sEnd: ccwParam(c.pts[c.pts.length - 1]) }));
    const terminals = [];
    for (let i = 0; i < K; i++) {
      let s0 = chords[i].sStart, s1 = chords[i].sEnd;
      if (Math.abs(s0 - s1) < 1e-4) s1 = (s1 + 0.002) % P;
      terminals.push({ id: 2 * i, s: s0, outHe: 2 * i }, { id: 2 * i + 1, s: s1, outHe: 2 * i + 1 });
    }
    terminals.sort((a, b) => a.s - b.s || a.id - b.id);
    const termRank = new Array(2 * K);
    for (let r = 0; r < terminals.length; r++) termRank[terminals[r].id] = r;

    const visitedHe = new Array(2 * K).fill(false), heFace = new Array(2 * K).fill(-1), faces = [];
    let validTopology = true;
    for (let startHe = 0; startHe < 2 * K; startHe++) {
      if (visitedHe[startHe]) continue;
      const facePts = [];
      let curHe = startHe, steps = 0, chordTouchCount = 0;
      const pushDedup = (p) => { const prev = facePts[facePts.length - 1]; if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.01) facePts.push(p); };
      while (!visitedHe[curHe]) {
        if (++steps > 2 * K + 2) { validTopology = false; break; }
        visitedHe[curHe] = true; heFace[curHe] = faces.length; chordTouchCount++;
        const chordIdx = curHe >> 1, isRev = (curHe & 1) === 1;
        for (const p of (isRev ? chords[chordIdx].pts.slice().reverse() : chords[chordIdx].pts)) pushDedup(p);
        const rank = termRank[isRev ? (2 * chordIdx) : (2 * chordIdx + 1)], nextTerm = terminals[(rank + 1) % (2 * K)];
        for (const p of ccwBoundaryArc(terminals[rank].s, nextTerm.s)) pushDedup(p);
        curHe = nextTerm.outHe;
      }
      if (curHe !== startHe) { validTopology = false; break; }
      while (facePts.length > 3 && Math.hypot(facePts[0][0] - facePts[facePts.length - 1][0], facePts[0][1] - facePts[facePts.length - 1][1]) < 0.02) facePts.pop();
      const area = facePts.length >= 3 ? Math.abs(geom.polyAreaSignedJS(facePts)) : 0;
      if (facePts.length >= 3 && area > 1e-4) faces.push({ poly: facePts, area, chordTouchCount });
      else { validTopology = false; break; }
    }
    if (!validTopology || faces.length !== K + 1 || Math.abs(faces.reduce((a, f) => a + f.area, 0) - rectArea) > rectArea * 0.16) {
      return geom._buildPureLoopEntriesJS(closedLoops, Cx, Cy);
    }

    const adj = Array.from({ length: faces.length }, () => []);
    for (let i = 0; i < K; i++) {
      const fA = heFace[2 * i], fB = heFace[2 * i + 1];
      if (fA >= 0 && fB >= 0 && fA !== fB) { adj[fA].push(fB); adj[fB].push(fA); } else validTopology = false;
    }
    const colors = new Array(faces.length).fill(-1); colors[0] = 0;
    const queue = [0];
    for (let qi = 0; qi < queue.length && validTopology; qi++) {
      const u = queue[qi];
      for (const v of adj[u]) {
        if (colors[v] === -1) { colors[v] = 1 - colors[u]; queue.push(v); }
        else if (colors[v] === colors[u]) { validTopology = false; break; }
      }
    }
    if (!validTopology || !colors.every(c => c === 0 || c === 1)) return geom._buildPureLoopEntriesJS(closedLoops, Cx, Cy);

    const sortedLoops = closedLoops.slice().sort((a, b) => b.area - a.area), L = sortedLoops.length;
    const loopProbes = sortedLoops.map(l => geom._pickLoopProbePtJS(l.poly, Cx, Cy));
    const loopFace = new Int32Array(L).fill(-1), loopParent = new Int32Array(L).fill(-1), loopRelDepth = new Int32Array(L).fill(0);
    const faceLoopIndices = Array.from({ length: faces.length }, () => []);
    for (let li = 0; li < L; li++) {
      const pr = loopProbes[li];
      for (let fi = 0; fi < faces.length; fi++) if (geom.pointInPolyLocal(pr[0], pr[1], faces[fi].poly)) { loopFace[li] = fi; break; }
      const fi = loopFace[li];
      if (fi < 0) continue;
      for (let pj = li - 1; pj >= 0; pj--) {
        if (loopFace[pj] === fi && geom.pointInPolyLocal(pr[0], pr[1], sortedLoops[pj].poly)) { loopParent[li] = pj; loopRelDepth[li] = loopRelDepth[pj] + 1; break; }
      }
      faceLoopIndices[fi].push(li);
    }

    const effArea = [0, 0], multiChordFaces = [0, 0], orphanInnerHits = [0, 0];
    for (let fi = 0; fi < faces.length; fi++) {
      const c = colors[fi];
      effArea[c] += faces[fi].area;
      if (faces[fi].chordTouchCount >= 2) multiChordFaces[c]++;
      for (const li of faceLoopIndices[fi]) {
        const d = loopRelDepth[li], la = sortedLoops[li].area;
        if ((d & 1) === 0) {
          effArea[c] -= la; effArea[1 - c] += la;
          if (d === 0) { if (sortedLoops[li].role === 'inner') orphanInnerHits[c]++; else if (sortedLoops[li].role === 'outer') orphanInnerHits[1 - c]++; }
        } else { effArea[1 - c] -= la; effArea[c] += la; }
      }
    }
    effArea[0] = Math.max(1.0, effArea[0]); effArea[1] = Math.max(1.0, effArea[1]);

    const evalSampleParity = (px, py) => {
      let hitFi = -1;
      for (let fi = 0; fi < faces.length; fi++) if (geom.pointInPolyLocal(px, py, faces[fi].poly)) { hitFi = fi; break; }
      if (hitFi < 0) return null;
      let d = 0;
      for (const li of faceLoopIndices[hitFi]) if (geom.pointInPolyLocal(px, py, sortedLoops[li].poly)) d++;
      return { fi: hitFi, c: (colors[hitFi] + d) & 1, inLoop: d > 0 };
    };

    const dryBldHits = [0, 0], dryRoadHits = [0, 0], dryMotorRoadHits = [0, 0], matchedWaterHits = [0, 0], anyWaterHits = [0, 0];
    const faceExposedBlds = new Int32Array(faces.length), faceExposedRoads = new Int32Array(faces.length);
    for (const bp of bldSamples) { const hit = evalSampleParity(bp[0], bp[1]); if (hit) { dryBldHits[hit.c]++; if (!hit.inLoop) faceExposedBlds[hit.fi]++; } }
    for (const rp of roadSamples) {
      const rKind = rp[2] || 1;
      if (!isWater && rKind < 2) continue;
      const hit = evalSampleParity(rp[0], rp[1]);
      if (hit) { dryRoadHits[hit.c]++; if (rKind >= 2) { dryMotorRoadHits[hit.c]++; if (!hit.inLoop) faceExposedRoads[hit.fi]++; } }
    }
    if ((isWater || isIsland) && waterSamples.length > 0) {
      for (const wp of waterSamples) {
        const wWeight = wp[2] || 1, wName = wp[3] || '', hit = evalSampleParity(wp[0], wp[1]);
        if (!hit) continue;
        anyWaterHits[hit.c] += wWeight;
        if (isWater) {
          if (relName) { if (wName === relName) matchedWaterHits[hit.c] += wWeight; }
          else if (!wName && faces[hit.fi].chordTouchCount >= 2 && faces[hit.fi].area <= rectArea * 0.45) matchedWaterHits[hit.c] += wWeight;
        }
      }
    }

    const chosen = _chooseArrangementColorJS({ isWater, isIsland }, K, rectArea, effArea, dryBldHits, dryRoadHits, orphanInnerHits, matchedWaterHits, anyWaterHits, multiChordFaces);
    if (chosen < 0) return geom._buildPureLoopEntriesJS(closedLoops, Cx, Cy);

    const outerEntries = [], innerPolys = [], oppColor = 1 - chosen;
    const oppUrbCount = dryBldHits[oppColor] + dryMotorRoadHits[oppColor] * 0.8, oppUrbDensity = oppUrbCount / Math.max(25, effArea[oppColor]);
    for (let fi = 0; fi < faces.length; fi++) {
      let faceActive = (colors[fi] === chosen);
      if (isWater && faceActive && faces[fi].area > rectArea * 0.42) {
        const faceUrbDensity = (faceExposedBlds[fi] + faceExposedRoads[fi] * 0.8) / Math.max(25, faces[fi].area);
        if (!(oppUrbCount >= 6 && faceUrbDensity <= oppUrbDensity * 0.18) && (faceExposedBlds[fi] >= 12 || (faceExposedBlds[fi] >= 6 && faceExposedRoads[fi] >= 6))) faceActive = false;
      }
      const fLoops = faceLoopIndices[fi], loopIsShell = new Map();
      for (const li of fLoops) {
        const shell = loopRelDepth[li] === 0 ? (faceActive ? false : (sortedLoops[li].role !== 'inner')) : !loopIsShell.get(loopParent[li]);
        loopIsShell.set(li, shell);
        if (!shell) innerPolys.push(sortedLoops[li].poly);
      }
      if (faceActive && faces[fi].area > 0.02) {
        outerEntries.push({ outer: faces[fi].poly, holes: fLoops.filter(li => loopRelDepth[li] === 0 && !loopIsShell.get(li)).map(li => sortedLoops[li].poly) });
      }
      for (const li of fLoops) {
        if (loopIsShell.get(li)) outerEntries.push({ outer: sortedLoops[li].poly, holes: fLoops.filter(cj => loopParent[cj] === li && !loopIsShell.get(cj)).map(cj => sortedLoops[cj].poly) });
      }
    }
    return { outerEntries, outerPolys: outerEntries.map(e => e.outer), innerPolys };
  }

  const g = _getGeom();
  const exportsObj = { _bridgeInteriorOpenChainsJS, _pickLoopProbePtJS: g._pickLoopProbePtJS, _buildPureLoopEntriesJS: g._buildPureLoopEntriesJS, stitchClippedMultipolygonRingsJS };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
