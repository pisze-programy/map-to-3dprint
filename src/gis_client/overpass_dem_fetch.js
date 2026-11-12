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

function stitchClippedMultipolygonRingsJS(outerWayNodeLists, innerWayNodeLists, nodesToPts, halfW, halfH, opts = {}) {
  const tol = opts.tol || 0.018;
  const innerPolys = stitchWayRingsJS(innerWayNodeLists)
    .map(r => nodesToPts(r, tol))
    .filter(p => p && p.length >= 3);

  const closedOuterPolys = [];
  const openChains = [];
  const segs = (outerWayNodeLists || []).filter(w => w && w.length >= 2).map(w => w.slice());

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
        if (pts.length >= 3) closedOuterPolys.push(pts);
      }
    } else if (curr.length >= 2) {
      const pts = nodesToPts(curr, tol);
      if (pts.length >= 2) openChains.push(pts);
    }
  }

  if (openChains.length > 0) {
    const Cx = halfW + 1.2;
    const Cy = halfH + 1.2;
    const P = 4 * (Cx + Cy);
    const rectArea = 4 * Cx * Cy;

    const isOnBoundary = (pt) => Math.abs(Math.abs(pt[0]) - Cx) < 0.08 || Math.abs(Math.abs(pt[1]) - Cy) < 0.08;
    const snapNearBoundary = (pt) => {
      const dx = Cx - Math.abs(pt[0]);
      const dy = Cy - Math.abs(pt[1]);
      if (Math.min(dx, dy) > Math.max(4.5, Math.min(Cx, Cy) * 0.16)) return null;
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
      const pieces = _clipPolylineToRectPieces(ch, Cx, Cy);
      for (const pc of pieces) {
        if (pc.length < 2) continue;
        let p0 = pc[0], pN = pc[pc.length - 1];
        if (!isOnBoundary(p0)) {
          if (pc.length >= 4 && Math.hypot(p0[0] - pN[0], p0[1] - pN[1]) < 2.5) {
            closedOuterPolys.push(pc);
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
          if (pc.length >= 4) closedOuterPolys.push(pc);
          continue;
        }
        rawChords.push(pc);
      }
    }

    // Merge chords sharing boundary endpoints
    let mergedChord = true;
    while (mergedChord && rawChords.length > 1) {
      mergedChord = false;
      for (let i = 0; i < rawChords.length && !mergedChord; i++) {
        for (let j = i + 1; j < rawChords.length; j++) {
          const A = rawChords[i], B = rawChords[j];
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
              if (joined.length >= 4) closedOuterPolys.push(joined);
            } else {
              rawChords[i] = joined;
            }
            mergedChord = true;
            break;
          }
        }
      }
    }

    const K = rawChords.length;
    if (K >= 1 && K <= 28) {
      const chords = rawChords.map((pts, idx) => ({
        idx,
        pts,
        sStart: ccwParam(pts[0]),
        sEnd: ccwParam(pts[pts.length - 1])
      }));

      const terminals = [];
      for (let i = 0; i < K; i++) {
        let s0 = chords[i].sStart, s1 = chords[i].sEnd;
        if (Math.abs(s0 - s1) < 1e-4) s1 = (s1 + 0.002) % P;
        terminals.push({ id: 2 * i, s: s0, outHe: 2 * i });
        terminals.push({ id: 2 * i + 1, s: s1, outHe: 2 * i + 1 });
      }
      terminals.sort((a, b) => a.s - b.s);
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
      if (validTopology && faces.length === K + 1 && Math.abs(sumArea - rectArea) <= rectArea * 0.14) {
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
        if (validTopology) {
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

          if (validTopology && colors.every(c => c === 0 || c === 1)) {
            const innerHits = [0, 0];
            const waterHits = [0, 0];
            const bldHits = [0, 0];
            const colorArea = [0, 0];
            const multiChordFaces = [0, 0];

            const waterSamples = opts.waterSamplePts || [];
            const bldSamples = opts.buildingSamplePts || [];

            for (let fi = 0; fi < faces.length; fi++) {
              const c = colors[fi];
              const poly = faces[fi].poly;
              colorArea[c] += faces[fi].area;
              if (faces[fi].chordTouchCount >= 2) multiChordFaces[c]++;
              for (let ii = 0; ii < innerPolys.length; ii++) {
                const ip = innerPolys[ii];
                if (ip.length > 0 && pointInPolyLocal(ip[0][0], ip[0][1], poly)) innerHits[c]++;
              }
              if (opts.isWater && waterSamples.length > 0) {
                for (let wi = 0; wi < waterSamples.length; wi++) {
                  const wp = waterSamples[wi];
                  if (pointInPolyLocal(wp[0], wp[1], poly)) waterHits[c] += (wp[2] || 1);
                }
              }
              if (bldSamples.length > 0) {
                for (let bi = 0; bi < bldSamples.length; bi++) {
                  const bp = bldSamples[bi];
                  if (pointInPolyLocal(bp[0], bp[1], poly)) bldHits[c]++;
                }
              }
            }

            let chosen = 0;
            if (innerHits[0] !== innerHits[1]) {
              chosen = innerHits[0] > innerHits[1] ? 0 : 1;
            } else if (opts.isWater && (waterHits[0] > 0 || waterHits[1] > 0) && waterHits[0] !== waterHits[1]) {
              const score0 = waterHits[0] * 4.0 - bldHits[0] * 1.2;
              const score1 = waterHits[1] * 4.0 - bldHits[1] * 1.2;
              chosen = score0 >= score1 ? 0 : 1;
            } else if ((bldHits[0] + bldHits[1]) >= 3 && bldHits[0] !== bldHits[1]) {
              chosen = bldHits[0] < bldHits[1] ? 0 : 1;
            } else if (K >= 2 && multiChordFaces[0] !== multiChordFaces[1]) {
              const cand = multiChordFaces[0] > multiChordFaces[1] ? 0 : 1;
              chosen = colorArea[cand] <= rectArea * 0.72 ? cand : (colorArea[0] <= colorArea[1] ? 0 : 1);
            } else {
              chosen = colorArea[0] <= colorArea[1] ? 0 : 1;
            }

            for (let fi = 0; fi < faces.length; fi++) {
              if (colors[fi] === chosen) {
                closedOuterPolys.push(faces[fi].poly);
              }
            }
          }
        }
      }
    }
  }

  const outerEntries = closedOuterPolys.map(op => {
    const holes = innerPolys.filter(ip => ip.length >= 3 && pointInPolyLocal(ip[0][0], ip[0][1], op));
    return { outer: op, holes };
  });

  return { outerEntries, outerPolys: closedOuterPolys, innerPolys };
}

function stitchCoastlineSeaPolysJS(coastWays, halfW, halfH, waterPolys) {
  if (!coastWays || coastWays.length === 0) return;
  const chains = coastWays.map(c => c.slice());
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < chains.length && !merged; i++) {
      for (let j = 0; j < chains.length; j++) {
        if (i === j) continue;
        const endI = chains[i][chains[i].length - 1];
        const startJ = chains[j][0];
        if (Math.hypot(endI[0] - startJ[0], endI[1] - startJ[1]) < 0.8) {
          chains[i] = chains[i].concat(chains[j].slice(1));
          chains.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }
  const R = Math.max(halfW, halfH) + 7.4;
  const rayBox = (pFrom, pTo) => {
    const dx = pTo[0] - pFrom[0], dy = pTo[1] - pFrom[1];
    let bestT = Infinity, bestPt = [Math.max(-R, Math.min(R, pTo[0])), Math.max(-R, Math.min(R, pTo[1]))];
    for (const ex of [-R, R]) {
      if (Math.abs(dx) > 1e-6) {
        const t = (ex - pFrom[0]) / dx, y = pFrom[1] + t * dy;
        if (t > 0 && y >= -R - 1e-2 && y <= R + 1e-2 && t < bestT) { bestT = t; bestPt = [ex, Math.max(-R, Math.min(R, y))]; }
      }
    }
    for (const ey of [-R, R]) {
      if (Math.abs(dy) > 1e-6) {
        const t = (ey - pFrom[1]) / dy, x = pFrom[0] + t * dx;
        if (t > 0 && x >= -R - 1e-2 && x <= R + 1e-2 && t < bestT) { bestT = t; bestPt = [Math.max(-R, Math.min(R, x)), ey]; }
      }
    }
    return bestPt;
  };
  const cwParam = (pt) => {
    const [x, y] = pt;
    if (Math.abs(y - R) < 0.05) return x + R;
    if (Math.abs(x - R) < 0.05) return 2 * R + (R - y);
    if (Math.abs(y + R) < 0.05) return 4 * R + (R - x);
    return 6 * R + (y + R);
  };
  const corners = [[2 * R, [R, R]], [4 * R, [R, -R]], [6 * R, [-R, -R]], [8 * R, [-R, R]]];
  for (const ch of chains) {
    if (ch.length < 2) continue;
    if (ch.length >= 4 && Math.hypot(ch[0][0] - ch[ch.length - 1][0], ch[0][1] - ch[ch.length - 1][1]) < 1.0) {
      if (polyAreaSignedJS(ch) <= 0) waterPolys.push({ outer: ch, holes: [], name: 'Morze / Ocean' });
      continue;
    }
    const pStart = rayBox(ch[1], ch[0]);
    const pEnd = rayBox(ch[ch.length - 2], ch[ch.length - 1]);
    const sEnd = cwParam(pEnd), sStart = cwParam(pStart);
    const span = ((sStart - sEnd) % (8 * R) + 8 * R) % (8 * R);
    const cwCorners = corners
      .map(c => [((c[0] - sEnd) % (8 * R) + 8 * R) % (8 * R), c[1]])
      .filter(c => c[0] > 0.05 && c[0] < span - 0.05)
      .sort((a, b) => a[0] - b[0])
      .map(c => c[1]);
    waterPolys.push({ outer: [pStart, ...ch, pEnd, ...cwCorners], holes: [], name: 'Morze / Zatoka' });
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
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    chooseAdaptiveDemZoom,
    fetchAdaptiveTerrariumDem,
    fetchTerrariumDemInBrowser,
    stitchWayRingsJS,
    stitchClippedMultipolygonRingsJS
  };
}
