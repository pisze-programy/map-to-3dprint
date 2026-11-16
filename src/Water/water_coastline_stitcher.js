// ============================================================================
// src/Water/water_coastline_stitcher.js
// Forward Coastline Chain Merging, Directed Gap Bridging & Sea Basin Stitching
// ============================================================================

(function (root) {
  function _getDeps() {
    const geom = (typeof polyAreaSignedJS === 'function' && typeof _clipPolylineToRectPieces === 'function' && typeof _bridgeSegHitsPolylinesJS === 'function')
      ? { simplifyRingJS, polyAreaSignedJS, pointInPolyLocal, _clipPolylineToRectPieces, _bridgeSegHitsPolylinesJS }
      : require('./water_ring_geometry.js');
    const mp = (typeof stitchClippedMultipolygonRingsJS === 'function' && typeof _pickLoopProbePtJS === 'function')
      ? { _pickLoopProbePtJS, stitchClippedMultipolygonRingsJS }
      : require('./water_multipolygon_stitcher.js');
    return { geom, mp };
  }

  function _bridgeDirectedCoastlineGapsJS(chains, Cx, Cy) {
    if (!chains || chains.length === 0) return;
    const { geom } = _getDeps();
    const maxCoastGap = 3.5;
    const isInteriorPt = (pt) => Math.abs(pt[0]) < Cx - 1.8 && Math.abs(pt[1]) < Cy - 1.8;
    const isClosedChain = (ch) => ch.length >= 4 && Math.hypot(ch[0][0] - ch[ch.length - 1][0], ch[0][1] - ch[ch.length - 1][1]) < 0.45;

    let bridged = true;
    while (bridged && chains.length > 1) {
      bridged = false;
      const exits = [], entries = [], allOpenEnds = [];
      for (let i = 0; i < chains.length; i++) {
        const ch = chains[i];
        if (!ch || ch.length < 2 || isClosedChain(ch)) continue;
        const pStart = ch[0], pEnd = ch[ch.length - 1];
        const selfSpan = Math.hypot(pStart[0] - pEnd[0], pStart[1] - pEnd[1]);
        if (isInteriorPt(pEnd)) { exits.push({ ci: i, pt: pEnd, selfSpan }); allOpenEnds.push({ ci: i, isExit: true, pt: pEnd }); }
        if (isInteriorPt(pStart)) { entries.push({ ci: i, pt: pStart, selfSpan }); allOpenEnds.push({ ci: i, isExit: false, pt: pStart }); }
      }
      if (exits.length === 0 || entries.length === 0) break;

      const exitNearestEntry = new Int32Array(exits.length).fill(-1);
      const exitNearestDist = new Float64Array(exits.length).fill(Infinity);
      const entryNearestExit = new Int32Array(entries.length).fill(-1);
      const entryNearestDist = new Float64Array(entries.length).fill(Infinity);
      for (let ei = 0; ei < exits.length; ei++) {
        for (let nj = 0; nj < entries.length; nj++) {
          if (exits[ei].ci === entries[nj].ci) continue;
          const d = Math.hypot(exits[ei].pt[0] - entries[nj].pt[0], exits[ei].pt[1] - entries[nj].pt[1]);
          if (d < exitNearestDist[ei]) { exitNearestDist[ei] = d; exitNearestEntry[ei] = nj; }
          if (d < entryNearestDist[nj]) { entryNearestDist[nj] = d; entryNearestExit[nj] = ei; }
        }
      }

      const cands = [];
      for (let ei = 0; ei < exits.length; ei++) {
        const nj = exitNearestEntry[ei];
        if (nj < 0 || entryNearestExit[nj] !== ei) continue;
        const gap = exitNearestDist[ei];
        if (gap > maxCoastGap) continue;
        const ex = exits[ei], en = entries[nj];
        if (ex.selfSpan <= gap * 1.5 || en.selfSpan <= gap * 1.5) continue;
        let competing = false;
        for (const ep of allOpenEnds) {
          if ((ep.ci === ex.ci && ep.isExit) || (ep.ci === en.ci && !ep.isExit)) continue;
          if (Math.hypot(ep.pt[0] - ex.pt[0], ep.pt[1] - ex.pt[1]) <= gap * 1.35 ||
              Math.hypot(ep.pt[0] - en.pt[0], ep.pt[1] - en.pt[1]) <= gap * 1.35) {
            competing = true;
            break;
          }
        }
        if (!competing) cands.push({ ex, en, gap });
      }
      if (cands.length === 0) break;
      cands.sort((a, b) => a.gap - b.gap);

      for (const { ex, en } of cands) {
        if (geom._bridgeSegHitsPolylinesJS(ex.pt, en.pt, chains, ex.ci, en.ci, null)) continue;
        chains[ex.ci] = chains[ex.ci].concat(chains[en.ci]);
        chains.splice(en.ci, 1);
        bridged = true;
        break;
      }
    }

    for (let i = 0; i < chains.length; i++) {
      const ch = chains[i];
      if (!ch || ch.length < 4 || isClosedChain(ch)) continue;
      const pStart = ch[0], pEnd = ch[ch.length - 1];
      if (!isInteriorPt(pStart) || !isInteriorPt(pEnd)) continue;
      const gap = Math.hypot(pStart[0] - pEnd[0], pStart[1] - pEnd[1]);
      if (gap > maxCoastGap) continue;
      let hasOutside = false;
      for (let k = 0; k < ch.length; k++) {
        if (Math.abs(ch[k][0]) > Cx + 0.05 || Math.abs(ch[k][1]) > Cy + 0.05) { hasOutside = true; break; }
      }
      if (!hasOutside) continue;
      let competing = false;
      for (let j = 0; j < chains.length && !competing; j++) {
        if (j === i || !chains[j] || chains[j].length < 2 || isClosedChain(chains[j])) continue;
        for (const ep of [chains[j][0], chains[j][chains[j].length - 1]]) {
          if (isInteriorPt(ep) && (Math.hypot(ep[0] - pStart[0], ep[1] - pStart[1]) <= gap * 1.35 || Math.hypot(ep[0] - pEnd[0], ep[1] - pEnd[1]) <= gap * 1.35)) {
            competing = true;
            break;
          }
        }
      }
      if (!competing && !geom._bridgeSegHitsPolylinesJS(pEnd, pStart, chains, i, i, null)) {
        chains[i] = ch.concat([pStart]);
      }
    }
  }

  function stitchCoastlineSeaPolysJS(coastWays, halfW, halfH, waterPolys, metaOut = null) {
    if (!coastWays || coastWays.length === 0) return;
    const { geom, mp } = _getDeps();

    // Merge connected coastline ways strictly in forward direction (land on LEFT, water on RIGHT)
    const chains = coastWays.filter(c => c && c.length >= 2).map(c => c.slice());
    let merged = true;
    while (merged && chains.length > 1) {
      merged = false;
      for (let i = 0; i < chains.length && !merged; i++) {
        for (let j = 0; j < chains.length; j++) {
          if (i === j) continue;
          const endI = chains[i][chains[i].length - 1], startJ = chains[j][0];
          if (Math.hypot(endI[0] - startJ[0], endI[1] - startJ[1]) < 0.35) {
            chains[i] = chains[i].concat(chains[j].slice(1));
            chains.splice(j, 1);
            merged = true;
            break;
          }
        }
      }
    }

    const Cx = Math.max(4.0, halfW - 0.25), Cy = Math.max(4.0, halfH - 0.25);
    const P = 4 * (Cx + Cy), rectArea = 4 * Cx * Cy;
    _bridgeDirectedCoastlineGapsJS(chains, Cx, Cy);

    const isOnBoundary = (pt) => Math.abs(Math.abs(pt[0]) - Cx) < 0.08 || Math.abs(Math.abs(pt[1]) - Cy) < 0.08;
    const snapNearBoundary = (pt) => {
      const dx = Cx - Math.abs(pt[0]), dy = Cy - Math.abs(pt[1]);
      if (Math.min(dx, dy) > 1.8) return null;
      return dx <= dy ? [pt[0] >= 0 ? Cx : -Cx, Math.max(-Cy, Math.min(Cy, pt[1]))] : [Math.max(-Cx, Math.min(Cx, pt[0])), pt[1] >= 0 ? Cy : -Cy];
    };
    const cwParam = (pt) => {
      const x = pt[0], y = pt[1];
      if (Math.abs(y - Cy) <= 0.09) return Math.max(0, Math.min(2 * Cx, x + Cx));
      if (Math.abs(x - Cx) <= 0.09) return 2 * Cx + Math.max(0, Math.min(2 * Cy, Cy - y));
      if (Math.abs(y + Cy) <= 0.09) return 2 * Cx + 2 * Cy + Math.max(0, Math.min(2 * Cx, Cx - x));
      return 4 * Cx + 2 * Cy + Math.max(0, Math.min(2 * Cy, y + Cy));
    };
    const cwCorners = [[2 * Cx, [Cx, Cy]], [2 * Cx + 2 * Cy, [Cx, -Cy]], [4 * Cx + 2 * Cy, [-Cx, -Cy]], [P, [-Cx, Cy]]];
    const cwBoundaryArc = (sFrom, sTo) => {
      const span = ((sTo - sFrom) % P + P) % P;
      if (span < 1e-4) return [];
      return cwCorners.map(c => [((c[0] - sFrom) % P + P) % P, c[1]]).filter(c => c[0] > 0.04 && c[0] < span - 0.04).sort((a, b) => a[0] - b[0]).map(c => c[1]);
    };

    const seaPolysOut = [], landIslands = [], directedChords = [];
    const classifyClosedCoastRing = (ring) => {
      if (!ring || ring.length < 3) return;
      const sArea = geom.polyAreaSignedJS(ring);
      if (sArea < -0.025) seaPolysOut.push(ring);
      else if (sArea > 0.0025) landIslands.push(ring);
    };

    for (const rawCh of chains) {
      let ch = rawCh;
      if (ch.length >= 4 && Math.hypot(ch[0][0] - ch[ch.length - 1][0], ch[0][1] - ch[ch.length - 1][1]) < 0.45) {
        let outIdx = -1;
        for (let k = 0; k < ch.length; k++) {
          if (Math.abs(ch[k][0]) > Cx + 0.05 || Math.abs(ch[k][1]) > Cy + 0.05) { outIdx = k; break; }
        }
        if (outIdx === -1) { classifyClosedCoastRing(ch); continue; }
        const baseRing = Math.hypot(ch[0][0] - ch[ch.length - 1][0], ch[0][1] - ch[ch.length - 1][1]) < 0.02 ? ch.slice(0, -1) : ch.slice();
        if (baseRing.length >= 3) {
          const safeOut = Math.min(outIdx, baseRing.length - 1);
          ch = baseRing.slice(safeOut).concat(baseRing.slice(0, safeOut + 1));
        }
      }

      for (const rawPc of geom._clipPolylineToRectPieces(ch, Cx, Cy)) {
        const pc = geom.simplifyRingJS(rawPc, 0.02);
        if (pc.length < 2) continue;
        let p0 = pc[0], pN = pc[pc.length - 1];
        if (!isOnBoundary(p0) && !isOnBoundary(pN) && pc.length >= 4 && Math.hypot(p0[0] - pN[0], p0[1] - pN[1]) < 0.6) {
          classifyClosedCoastRing(pc);
          continue;
        }
        const sn0 = isOnBoundary(p0) ? p0 : snapNearBoundary(p0);
        const snN = isOnBoundary(pN) ? pN : snapNearBoundary(pN);
        if (!sn0 || !snN) {
          // Recover multi-way CCW island coastline chains missing one short interior segment
          if (!sn0 && !snN && pc.length >= 3) {
            let arcLen = 0;
            for (let s = 1; s < pc.length; s++) arcLen += Math.hypot(pc[s][0] - pc[s - 1][0], pc[s][1] - pc[s - 1][1]);
            const gap = Math.hypot(p0[0] - pN[0], p0[1] - pN[1]);
            const closedCand = pc.concat([pc[0]]);
            const sArea = geom.polyAreaSignedJS(closedCand);
            if (arcLen > 0.25 && gap <= arcLen * 0.90 && sArea > 0.0025 && sArea < Math.max(1, 4 * Cx * Cy) * 0.15) {
              landIslands.push(closedCand);
            }
          }
          continue;
        }
        pc[0] = p0 = sn0;
        pc[pc.length - 1] = pN = snN;
        if (Math.hypot(p0[0] - pN[0], p0[1] - pN[1]) < 0.12) {
          if (pc.length >= 4) classifyClosedCoastRing(pc);
          continue;
        }
        directedChords.push(pc);
      }
    }

    let mergedDir = true;
    while (mergedDir && directedChords.length > 1) {
      mergedDir = false;
      for (let i = 0; i < directedChords.length && !mergedDir; i++) {
        for (let j = 0; j < directedChords.length; j++) {
          if (i === j) continue;
          const A = directedChords[i], B = directedChords[j];
          if (Math.hypot(A[A.length - 1][0] - B[0][0], A[A.length - 1][1] - B[0][1]) < 0.08) {
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
      const terminals = [];
      for (let i = 0; i < K; i++) {
        const pts = directedChords[i];
        let sEntry = cwParam(pts[0]), sExit = cwParam(pts[pts.length - 1]);
        if (Math.abs(sEntry - sExit) < 1e-4) sExit = (sExit + 0.002) % P;
        terminals.push({ kind: 'entry', chordIdx: i, s: sEntry }, { kind: 'exit', chordIdx: i, s: sExit });
      }
      terminals.sort((a, b) => a.s - b.s);

      const exitRank = new Array(K).fill(-1);
      for (let r = 0; r < terminals.length; r++) if (terminals[r].kind === 'exit') exitRank[terminals[r].chordIdx] = r;

      const usedChord = new Array(K).fill(false), tracedDirectedFaces = [];
      let allCyclesValid = true;
      for (let startIdx = 0; startIdx < K; startIdx++) {
        if (usedChord[startIdx]) continue;
        const facePts = [];
        let curIdx = startIdx, steps = 0;
        while (!usedChord[curIdx]) {
          if (++steps > K + 2) { allCyclesValid = false; break; }
          usedChord[curIdx] = true;
          for (const p of directedChords[curIdx]) {
            const prev = facePts[facePts.length - 1];
            if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.01) facePts.push(p);
          }
          const rExit = exitRank[curIdx], nextTerm = terminals[(rExit + 1) % (2 * K)];
          if (nextTerm.kind !== 'entry') { allCyclesValid = false; break; }
          for (const ap of cwBoundaryArc(terminals[rExit].s, nextTerm.s)) facePts.push(ap);
          curIdx = nextTerm.chordIdx;
        }
        if (!allCyclesValid || curIdx !== startIdx || facePts.length < 3) { allCyclesValid = false; break; }
        if (Math.hypot(facePts[0][0] - facePts[facePts.length - 1][0], facePts[0][1] - facePts[facePts.length - 1][1]) < 0.02) facePts.pop();
        const sArea = geom.polyAreaSignedJS(facePts);
        if (facePts.length >= 3 && sArea < -0.02 && Math.abs(sArea) <= rectArea * 1.02) tracedDirectedFaces.push(facePts);
        else { allCyclesValid = false; break; }
      }

      if (allCyclesValid && tracedDirectedFaces.length > 0) {
        for (const fp of tracedDirectedFaces) seaPolysOut.push(fp);
      } else {
        const rightWaterProbes = [];
        for (const pts of directedChords) {
          const mid = Math.floor((pts.length - 1) * 0.5);
          const pA = pts[mid], pB = pts[Math.min(pts.length - 1, mid + 1)];
          const dx = pB[0] - pA[0], dy = pB[1] - pA[1], len = Math.hypot(dx, dy);
          if (len > 1e-4) {
            const mx = 0.5 * (pA[0] + pB[0]) + (dy / len) * 0.35, my = 0.5 * (pA[1] + pB[1]) - (dx / len) * 0.35;
            if (Math.abs(mx) < Cx && Math.abs(my) < Cy) rightWaterProbes.push([mx, my, 4, '__coast_sea__']);
          }
        }
        const pseudoNodes = new Map();
        let nextNid = 1;
        const chordIdLists = directedChords.map(pts => pts.map(pt => { const id = nextNid++; pseudoNodes.set(id, pt); return id; }));
        const fallbackRes = mp.stitchClippedMultipolygonRingsJS(
          chordIdLists, [], (ids) => ids.map(id => pseudoNodes.get(id)).filter(Boolean), halfW, halfH,
          { isWater: true, relName: '__coast_sea__', waterSamplePts: rightWaterProbes, clipHalfW: Cx + 0.35, clipHalfH: Cy + 0.35, tol: 0.015 }
        );
        for (const fp of fallbackRes.outerPolys) seaPolysOut.push(fp);
      }
    }

    if (metaOut && seaPolysOut.length === 0 && landIslands.length > 0) {
      metaOut.openSeaIslands = landIslands.map(r => r.slice());
      metaOut.seaRect = [[-Cx, -Cy], [Cx, -Cy], [Cx, Cy], [-Cx, Cy]];
    }
    for (const sp of seaPolysOut) {
      const holes = landIslands.filter(isl => {
        if (!isl || isl.length < 3) return false;
        const probe = mp._pickLoopProbePtJS(isl, Cx, Cy);
        if (!geom.pointInPolyLocal(probe[0], probe[1], sp)) return false;
        for (let i = 0; i < isl.length; i++) if (!geom.pointInPolyLocal(isl[i][0], isl[i][1], sp)) return false;
        return true;
      });
      waterPolys.push({ outer: sp, holes, name: 'Morze / Zatoka' });
    }
  }

  const exportsObj = { _bridgeDirectedCoastlineGapsJS, stitchCoastlineSeaPolysJS };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
