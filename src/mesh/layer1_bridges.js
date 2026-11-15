// ============================================================================
// src/mesh/layer1_bridges.js
// Layer-1 Universal OSM Bridge & Viaduct Geometry Solver
// - Supports man_made=bridge polygons, relation type=bridge & linear bridges
// - Multi-deck layer/level separation (guarantees open air gap between decks)
// - Pure bridge:structure catalog: arch, suspension, cable-stayed, truss,
//   covered=yes, beam/viaduct/trestle, floating/pontoon + dry/Z=0 piers
// ============================================================================

(function (root) {
  function _getCore() {
    if (typeof createBuildContext === 'function') return root;
    if (typeof require !== 'undefined') return require('../geometry/manifold_core.js');
    return root;
  }

  function _normalizeBridgeStructure(rawStruct, tags = {}) {
    const s = String(rawStruct || (tags && (tags['bridge:structure'] || tags.bridge)) || '').toLowerCase().trim().replace(/_/g, '-');
    if (s === 'arch' || s === 'humpback' || s === 'masonry-arch' || s === 'tied-arch') return 'arch';
    if (s === 'suspension' || s === 'simple-suspension') return 'suspension';
    if (s === 'cable-stayed' || s === 'extradosed') return 'cable-stayed';
    if (s === 'truss' || s === 'bailey' || s === 'cantilever' || s === 'lattice') return 'truss';
    if (s === 'floating' || s === 'pontoon') return 'floating';
    if (s === 'beam' || s === 'viaduct' || s === 'trestle' || s === 'girder' || s === 'box-girder' || s === 'slab') return 'beam';
    return 'beam';
  }

  function _polyLength(pts) {
    let L = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    }
    return L;
  }

  function _samplePolylineAt(pts, tNorm) {
    const total = _polyLength(pts);
    if (total <= 1e-6 || pts.length < 2) {
      return { pt: pts[0] || [0, 0], dir: [1, 0], perp: [0, 1], dist: 0, total: 0 };
    }
    const target = Math.max(0, Math.min(1, tNorm)) * total;
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (seg < 1e-8) continue;
      if (acc + seg >= target || i === pts.length - 2) {
        const f = Math.max(0, Math.min(1, (target - acc) / seg));
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const ux = dx / seg, uy = dy / seg;
        return {
          pt: [a[0] + dx * f, a[1] + dy * f],
          dir: [ux, uy],
          perp: [-uy, ux],
          dist: target,
          total,
        };
      }
      acc += seg;
    }
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const seg = Math.hypot(last[0] - prev[0], last[1] - prev[1]) || 1;
    return {
      pt: last,
      dir: [(last[0] - prev[0]) / seg, (last[1] - prev[1]) / seg],
      perp: [-(last[1] - prev[1]) / seg, (last[0] - prev[0]) / seg],
      dist: total,
      total,
    };
  }

  function _polylineToStations(pts, stepDist) {
    const total = _polyLength(pts);
    const n = Math.max(4, Math.min(36, Math.ceil(total / Math.max(0.5, stepDist))));
    const out = [];
    for (let i = 0; i <= n; i++) {
      out.push({ t: i / n, ..._samplePolylineAt(pts, i / n) });
    }
    return out;
  }

  // Merge collinear/connected linear bridge segments sharing endpoints and same deck layer/structure
  function _stitchBridgeWays(linearBridges) {
    const pools = linearBridges.map(b => ({ ...b, pts: b.pts.slice(), used: false }));
    const chains = [];
    const eps2 = 0.08 * 0.08;
    const dist2 = (a, b) => (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]);

    for (let i = 0; i < pools.length; i++) {
      if (pools[i].used || pools[i].pts.length < 2) continue;
      pools[i].used = true;
      const chain = { ...pools[i], pts: pools[i].pts.slice() };
      let grew = true;
      while (grew) {
        grew = false;
        const head = chain.pts[0];
        const tail = chain.pts[chain.pts.length - 1];
        for (let j = 0; j < pools.length; j++) {
          const cand = pools[j];
          if (cand.used || cand.layer !== chain.layer || cand.structure !== chain.structure) continue;
          const cH = cand.pts[0], cT = cand.pts[cand.pts.length - 1];
          if (dist2(tail, cH) <= eps2) {
            chain.pts.push(...cand.pts.slice(1));
            cand.used = true; grew = true; break;
          }
          if (dist2(tail, cT) <= eps2) {
            chain.pts.push(...cand.pts.slice(0, -1).reverse());
            cand.used = true; grew = true; break;
          }
          if (dist2(head, cT) <= eps2) {
            chain.pts = cand.pts.slice(0, -1).concat(chain.pts);
            cand.used = true; grew = true; break;
          }
          if (dist2(head, cH) <= eps2) {
            chain.pts = cand.pts.slice(1).reverse().concat(chain.pts);
            cand.used = true; grew = true; break;
          }
        }
      }
      chains.push(chain);
    }
    return chains;
  }

  function _bbox2D(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    return [minX, minY, maxX, maxY];
  }

  function _bboxesOverlap2D(a, b, pad = 0) {
    return a[0] <= b[2] + pad && a[2] >= b[0] - pad && a[1] <= b[3] + pad && a[3] >= b[1] - pad;
  }

  function _distPtToSegSq2D(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 <= 1e-12) return (px - ax) * (px - ax) + (py - ay) * (py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const qx = ax + dx * t, qy = ay + dy * t;
    return (px - qx) * (px - qx) + (py - qy) * (py - qy);
  }

  function _segsIntersect2D(a0, a1, b0, b1) {
    const ccw = (p, q, r) => (r[1] - p[1]) * (q[0] - p[0]) > (q[1] - p[1]) * (r[0] - p[0]);
    return ccw(a0, b0, b1) !== ccw(a1, b0, b1) && ccw(a0, a1, b0) !== ccw(a0, a1, b1);
  }

  function _clipPolylineToBox2D(pts, minX, minY, maxX, maxY) {
    if (!pts || pts.length < 2) return [];
    const clipSeg = (p0, p1) => {
      let t0 = 0, t1 = 1;
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
      const checks = [
        [-dx, p0[0] - minX],
        [dx, maxX - p0[0]],
        [-dy, p0[1] - minY],
        [dy, maxY - p0[1]],
      ];
      for (const [p, q] of checks) {
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
      return [
        [p0[0] + dx * t0, p0[1] + dy * t0],
        [p0[0] + dx * t1, p0[1] + dy * t1],
      ];
    };
    const chains = [];
    let cur = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = clipSeg(pts[i], pts[i + 1]);
      if (!seg) {
        if (cur && cur.length >= 2) chains.push(cur);
        cur = null;
        continue;
      }
      if (!cur) {
        cur = [seg[0], seg[1]];
      } else {
        const last = cur[cur.length - 1];
        if (Math.hypot(last[0] - seg[0][0], last[1] - seg[0][1]) <= 1e-4) {
          cur.push(seg[1]);
        } else {
          if (cur.length >= 2) chains.push(cur);
          cur = [seg[0], seg[1]];
        }
      }
    }
    if (cur && cur.length >= 2) chains.push(cur);
    return chains;
  }

  function _spansCorridorOverlap2D(spA, spB, pad = 0.25) {
    if (!_bboxesOverlap2D(spA.bbox, spB.bbox, Math.min(4.0, spA.halfW + spB.halfW + pad))) return false;
    if (spA.isAreaPoly && spA.outerPolyBed) {
      for (const p of spB.pts) if (_ptInRing(p[0], p[1], spA.outerPolyBed)) return true;
    }
    if (spB.isAreaPoly && spB.outerPolyBed) {
      for (const p of spA.pts) if (_ptInRing(p[0], p[1], spB.outerPolyBed)) return true;
    }
    const ptsA = spA.pts || [];
    const ptsB = spB.pts || [];
    if (ptsA.length < 2 || ptsB.length < 2) return false;
    const thresh = Math.min(6.0, spA.halfW) + Math.min(6.0, spB.halfW) + pad;
    const threshSq = thresh * thresh;
    for (let i = 0; i < ptsA.length - 1; i++) {
      for (let j = 0; j < ptsB.length - 1; j++) {
        if (_segsIntersect2D(ptsA[i], ptsA[i + 1], ptsB[j], ptsB[j + 1])) return true;
        if (_distPtToSegSq2D(ptsA[i][0], ptsA[i][1], ptsB[j][0], ptsB[j][1], ptsB[j + 1][0], ptsB[j + 1][1]) <= threshSq) return true;
        if (_distPtToSegSq2D(ptsB[j][0], ptsB[j][1], ptsA[i][0], ptsA[i][1], ptsA[i + 1][0], ptsA[i + 1][1]) <= threshSq) return true;
      }
    }
    const lastA = ptsA[ptsA.length - 1], lastB = ptsB[ptsB.length - 1];
    for (let j = 0; j < ptsB.length - 1; j++) {
      if (_distPtToSegSq2D(lastA[0], lastA[1], ptsB[j][0], ptsB[j][1], ptsB[j + 1][0], ptsB[j + 1][1]) <= threshSq) return true;
    }
    for (let i = 0; i < ptsA.length - 1; i++) {
      if (_distPtToSegSq2D(lastB[0], lastB[1], ptsA[i][0], ptsA[i][1], ptsA[i + 1][0], ptsA[i + 1][1]) <= threshSq) return true;
    }
    return false;
  }

  function _ptInRing(px, py, ring) {
    if (!ring || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  function _buildSpanSolidParts(core, mf, ctx, terrainWater, span) {
    const { pts, halfW, layerVal, structure, isCovered, explicitH_m, isAreaPoly, outerPolyBed, holesPolyBed } = span;
    const { scaleMm, mToU, zScale, scaleToBed, waterCutout } = ctx;
    const spanLen = _polyLength(pts);
    if (spanLen < 0.25 && !isAreaPoly) return null;

    const minDeckThickU = Math.max(0.45 / scaleMm, ((ctx.cfg && ctx.cfg.bridgeDeckMinMm) || 0.719) / scaleMm);
    const deckHalfW = isAreaPoly ? Math.min(halfW, 10.0 / scaleMm) : halfW;
    const deckThickU = Math.max(minDeckThickU, Math.min(1.8 / scaleMm, deckHalfW * 0.28));
    const minClearanceU = Math.max(1.2 / scaleMm, 4.5 * mToU * zScale * scaleToBed);
    const waterTopZ = waterCutout ? ctx.zWaterTop : ctx.zWaterTop;
    const waterFloorZ = terrainWater.getWaterFloorZ(); // 0.0 if waterCutout else zWaterCarveFloor

    // Sample terrain / water elevation along span to find end bank landings & midspan obstacle height
    const stations = _polylineToStations(pts, Math.max(1.2, spanLen / 16));
    let maxSpanSurfaceZ = 0;
    let endStartGroundZ = ctx.getTerrainZ(pts[0][0], pts[0][1]);
    let endEndGroundZ = ctx.getTerrainZ(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    let crossesWater = false;

    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      const inW = terrainWater.isPointInWater(st.pt[0], st.pt[1]);
      if (inW) crossesWater = true;
      const surfZ = inW ? waterTopZ : ctx.getTerrainZ(st.pt[0], st.pt[1]);
      if (surfZ > maxSpanSurfaceZ) maxSpanSurfaceZ = surfZ;
    }

    const startInW = terrainWater.isPointInWater(pts[0][0], pts[0][1]);
    const endInW = terrainWater.isPointInWater(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    if (startInW) endStartGroundZ = waterFloorZ;
    if (endInW) endEndGroundZ = waterFloorZ;

    // Height clearance from explicit OSM height or multi-deck layer offset
    const explicitDeckLiftU = explicitH_m > 0 ? (explicitH_m * mToU * zScale * scaleToBed) : 0;
    const baseDeckTopZ = span.resolvedDeckTopZ !== undefined
      ? span.resolvedDeckTopZ
      : Math.max(
          maxSpanSurfaceZ + deckThickU + (structure === 'floating' ? 0.15 / scaleMm : minClearanceU * (0.45 + 0.35 * Math.max(0, layerVal - 1))),
          Math.max(endStartGroundZ, endEndGroundZ) + deckThickU + (0.35 / scaleMm),
          explicitDeckLiftU > 0 ? (ctx.zWaterTop + explicitDeckLiftU) : 0
        );
    const zDeckTop = Math.min(ctx.maxZUnits - (1.0 / scaleMm), baseDeckTopZ);
    const zDeckBot = Math.max(waterFloorZ + (structure === 'floating' ? 0.0 : minClearanceU * 0.35), zDeckTop - deckThickU);
    const clearGapUnder = zDeckBot - (crossesWater ? waterTopZ : maxSpanSurfaceZ);

    const parts = [];

    // 1. Bridge Deck Slab (from exact polygon if man_made=bridge area, or Clipper2 buffered centerline)
    if (isAreaPoly && outerPolyBed && outerPolyBed.length >= 3) {
      const deckM = core.extrudeRingSolid(mf, outerPolyBed, holesPolyBed || [], zDeckBot, zDeckTop);
      if (deckM) parts.push(deckM);
    } else {
      const rings = core.clipperBufferOpenPaths([{ pts, halfW, squareEnd: true }], 'Miter', 1e-5);
      const grouped = core.ringsToOutersWithHoles(rings, 1e-5);
      for (const g of grouped) {
        const deckM = core.extrudeRingSolid(mf, g.outer, g.holes, zDeckBot, zDeckTop);
        if (deckM) parts.push(deckM);
      }
    }

    // 2. Bank Abutments / Landings at Start & End (skip flush dam wall if middle is over water!)
    const emitSupportPier = (pt, tangent, widthAcross, thickAlong, zBottom, zTop) => {
      const px = -tangent[1], py = tangent[0];
      const hw = Math.max(ctx.minPrintU * 0.75, widthAcross * 0.5);
      const ht = Math.max(ctx.minPrintU * 0.75, thickAlong * 0.5);
      const c = [
        [pt[0] - px * hw - tangent[0] * ht, pt[1] - py * hw - tangent[1] * ht],
        [pt[0] + px * hw - tangent[0] * ht, pt[1] + py * hw - tangent[1] * ht],
        [pt[0] + px * hw + tangent[0] * ht, pt[1] + py * hw + tangent[1] * ht],
        [pt[0] - px * hw + tangent[0] * ht, pt[1] - py * hw + tangent[1] * ht],
      ];
      return core.extrudeRingSolid(mf, c, [], Math.max(0.0, zBottom), zTop);
    };

    const getSupportBottomZ = (pt) => {
      if (terrainWater.isPointInWater(pt[0], pt[1])) {
        return waterCutout ? 0.0 : Math.max(0.0, waterFloorZ - 0.08);
      }
      return Math.max(0.0, ctx.getTerrainZ(pt[0], pt[1]) - (0.35 / scaleMm));
    };

    if (pts.length >= 2) {
      const s0 = _samplePolylineAt(pts, 0.03);
      const s1 = _samplePolylineAt(pts, 0.97);
      const abThick = Math.max(ctx.minPrintU * 1.2, Math.min(8.0 / scaleMm, deckHalfW * 0.7));
      if (!isAreaPoly || _ptInRing(s0.pt[0], s0.pt[1], outerPolyBed)) {
        const a0 = emitSupportPier(s0.pt, s0.dir, deckHalfW * 1.75, abThick, getSupportBottomZ(s0.pt), zDeckBot + 0.05);
        if (a0) parts.push(a0);
      }
      if (!isAreaPoly || _ptInRing(s1.pt[0], s1.pt[1], outerPolyBed)) {
        const a1 = emitSupportPier(s1.pt, s1.dir, deckHalfW * 1.75, abThick, getSupportBottomZ(s1.pt), zDeckBot + 0.05);
        if (a1) parts.push(a1);
      }
    }

    // 3. Structural Typology From Standard OSM bridge:structure
    const strutR = Math.max(ctx.minPrintU * 0.45, Math.min(deckHalfW * 0.25, 0.45 / scaleMm));
    const pierW = Math.max(ctx.minPrintU * 1.1, deckHalfW * 1.45);
    const pierT = Math.max(ctx.minPrintU * 0.9, Math.min(deckHalfW * 0.85, spanLen * 0.045));
    let pierMinZ = Infinity;

    const addPierAtT = (tNorm, widthFactor = 1.0, topZ = zDeckBot + 0.05) => {
      const s = _samplePolylineAt(pts, tNorm);
      if (isAreaPoly && !_ptInRing(s.pt[0], s.pt[1], outerPolyBed)) return { s, zBot: zDeckBot };
      const zBot = getSupportBottomZ(s.pt);
      if (zBot < pierMinZ) pierMinZ = zBot;
      const wcBoost = (waterCutout && terrainWater.isPointInWater(s.pt[0], s.pt[1])) ? 1.32 : 1.0;
      const p = emitSupportPier(s.pt, s.dir, pierW * widthFactor * wcBoost, pierT * wcBoost, zBot, topZ);
      if (p) parts.push(p);
      return { s, zBot };
    };

    if (structure === 'floating') {
      // Pontoon blocks under deck; guide piles down to 0.0 under waterCutout=true
      const nFloats = Math.max(2, Math.min(8, Math.floor(spanLen / Math.max(2.0, halfW * 3.5))));
      for (let k = 1; k < nFloats; k++) {
        const s = _samplePolylineAt(pts, k / nFloats);
        const zBot = terrainWater.isPointInWater(s.pt[0], s.pt[1]) ? (waterCutout ? 0.0 : ctx.zWaterTop - (0.25 / scaleMm)) : getSupportBottomZ(s.pt);
        if (zBot < pierMinZ) pierMinZ = zBot;
        const p = emitSupportPier(s.pt, s.dir, halfW * 1.9, halfW * 1.6, zBot, zDeckBot + 0.04);
        if (p) parts.push(p);
      }
    } else if (structure === 'arch') {
      // Multi-bay masonry arches (if tall gorge/viaduct) OR grand single parabolic arch beneath deck (open center!)
      const nBays = spanLen > halfW * 16 ? Math.min(6, Math.max(2, Math.round(spanLen / (halfW * 8)))) : 1;
      for (let b = 0; b < nBays; b++) {
        const t0 = b / nBays;
        const t1 = (b + 1) / nBays;
        if (b > 0) addPierAtT(t0, 0.95);
        const zArchFoot = Math.max(waterTopZ + (0.2 / scaleMm), zDeckBot - Math.min(clearGapUnder * 0.78, spanLen * 0.24 / nBays));
        const nSegs = 8;
        const offsets = [-halfW * 0.72, halfW * 0.72];
        for (const off of offsets) {
          let prevPt = null;
          for (let k = 0; k <= nSegs; k++) {
            const f = k / nSegs;
            const sCur = _samplePolylineAt(pts, t0 + (t1 - t0) * f);
            const archZ = zArchFoot + (zDeckBot - zArchFoot - 0.05) * (1 - 4 * (f - 0.5) * (f - 0.5));
            const curPt = [sCur.pt[0] + sCur.perp[0] * off, sCur.pt[1] + sCur.perp[1] * off, archZ];
            if (prevPt) {
              const rib = core.beamManifoldBetween(mf, prevPt, curPt, strutR * 1.15);
              if (rib) parts.push(rib);
            }
            if (k > 0 && k < nSegs && k % 2 === 0 && zDeckBot - archZ > strutR * 1.5) {
              const post = core.beamManifoldBetween(mf, curPt, [curPt[0], curPt[1], zDeckBot + 0.04], strutR * 0.75);
              if (post) parts.push(post);
            }
            prevPt = curPt;
          }
        }
      }
      if (crossesWater && pierMinZ === Infinity) {
        for (const tProbe of [0.15, 0.85]) {
          const sp = _samplePolylineAt(pts, tProbe);
          if (terrainWater.isPointInWater(sp.pt[0], sp.pt[1])) {
            addPierAtT(tProbe, 0.9);
          }
        }
      }
    } else if ((structure === 'suspension' || structure === 'cable-stayed')) {
      const towerH = Math.max(3.5 / scaleMm, Math.min(ctx.maxZUnits - zDeckTop - (1.0 / scaleMm), spanLen * (structure === 'suspension' ? 0.22 : 0.26)));
      const zPylonTop = zDeckTop + towerH;
      const pylonTs = structure === 'suspension'
        ? [0.24, 0.76]
        : (spanLen > halfW * 20 ? [0.20, 0.50, 0.80] : [0.30, 0.70]);
      const sideOffsets = [-halfW * 0.88, halfW * 0.88];

      const towerAnchors = [];
      for (const ptT of pylonTs) {
        const { s } = addPierAtT(ptT, 1.05, zDeckBot + 0.05);
        const pair = [];
        for (const off of sideOffsets) {
          const legBot = [s.pt[0] + s.perp[0] * off, s.pt[1] + s.perp[1] * off, zDeckBot];
          const legTop = [s.pt[0] + s.perp[0] * off * 0.82, s.pt[1] + s.perp[1] * off * 0.82, zPylonTop];
          const legM = core.beamManifoldBetween(mf, legBot, legTop, strutR * 1.25);
          if (legM) parts.push(legM);
          pair.push(legTop);
        }
        // Portal crossbeam above deck
        const cross = core.beamManifoldBetween(mf, pair[0], pair[1], strutR * 1.05);
        if (cross) parts.push(cross);
        towerAnchors.push({ ptT, pair, s });
      }

      if (structure === 'suspension' && towerAnchors.length >= 2) {
        const tA = towerAnchors[0], tB = towerAnchors[towerAnchors.length - 1];
        for (let side = 0; side < 2; side++) {
          const off = sideOffsets[side];
          const sStart = _samplePolylineAt(pts, 0.02);
          const sEnd = _samplePolylineAt(pts, 0.98);
          const backL = core.beamManifoldBetween(mf, [sStart.pt[0] + sStart.perp[0] * off, sStart.pt[1] + sStart.perp[1] * off, zDeckTop], tA.pair[side], strutR * 0.7);
          const backR = core.beamManifoldBetween(mf, tB.pair[side], [sEnd.pt[0] + sEnd.perp[0] * off, sEnd.pt[1] + sEnd.perp[1] * off, zDeckTop], strutR * 0.7);
          if (backL) parts.push(backL);
          if (backR) parts.push(backR);

          const nCab = 8;
          let prevC = null;
          for (let k = 0; k <= nCab; k++) {
            const f = k / nCab;
            const tt = tA.ptT + (tB.ptT - tA.ptT) * f;
            const sc = _samplePolylineAt(pts, tt);
            const sagZ = zDeckTop + (zPylonTop - zDeckTop) * Math.max(0.14, 4 * (f - 0.5) * (f - 0.5));
            const curC = [sc.pt[0] + sc.perp[0] * off * 0.88, sc.pt[1] + sc.perp[1] * off * 0.88, sagZ];
            if (prevC) {
              const seg = core.beamManifoldBetween(mf, prevC, curC, strutR * 0.72);
              if (seg) parts.push(seg);
            }
            if (k > 0 && k < nCab) {
              const hanger = core.beamManifoldBetween(mf, curC, [sc.pt[0] + sc.perp[0] * off * 0.88, sc.pt[1] + sc.perp[1] * off * 0.88, zDeckTop], strutR * 0.45);
              if (hanger) parts.push(hanger);
            }
            prevC = curC;
          }
        }
      } else {
        // Harp/semi-fan stay cables staggered cleanly along upper pylon shaft into deck body
        const dOffs = [-0.14, -0.07, 0.07, 0.14];
        for (const ta of towerAnchors) {
          for (let di = 0; di < dOffs.length; di++) {
            const dOff = dOffs[di];
            const targetT = Math.max(0.03, Math.min(0.97, ta.ptT + dOff));
            const sc = _samplePolylineAt(pts, targetT);
            const zTopStep = Math.max(zDeckTop + strutR, zPylonTop - (di % 2 === 0 ? strutR * 0.65 : strutR * 1.45) - (Math.abs(dOff) > 0.1 ? strutR * 0.9 : 0));
            const fracZ = Math.max(0, Math.min(1, (zTopStep - zDeckBot) / Math.max(1e-5, zPylonTop - zDeckBot)));
            for (let side = 0; side < 2; side++) {
              const pLeg = [
                ta.s.pt[0] + ta.s.perp[0] * sideOffsets[side] * (1.0 - 0.18 * fracZ),
                ta.s.pt[1] + ta.s.perp[1] * sideOffsets[side] * (1.0 - 0.18 * fracZ),
                zTopStep,
              ];
              const stay = core.beamManifoldBetween(mf, pLeg, [sc.pt[0] + sc.perp[0] * sideOffsets[side], sc.pt[1] + sc.perp[1] * sideOffsets[side], zDeckTop - deckThickU * 0.25], strutR * 0.5);
              if (stay) parts.push(stay);
            }
          }
        }
      }
    } else if (structure === 'truss' || isCovered) {
      const trussH = Math.max(1.2 / scaleMm, Math.min(3.5 / scaleMm, deckThickU * 2.8));
      const zTrussTop = Math.min(ctx.maxZUnits - (0.5 / scaleMm), zDeckTop + trussH);
      const nBays = Math.max(3, Math.min(12, Math.round(spanLen / Math.max(1.5, halfW * 3))));
      for (const off of [-halfW * 0.88, halfW * 0.88]) {
        let prevBot = null, prevTop = null;
        for (let k = 0; k <= nBays; k++) {
          const sc = _samplePolylineAt(pts, k / nBays);
          const pB = [sc.pt[0] + sc.perp[0] * off, sc.pt[1] + sc.perp[1] * off, zDeckTop];
          const pT = [sc.pt[0] + sc.perp[0] * off, sc.pt[1] + sc.perp[1] * off, zTrussTop];
          const post = core.beamManifoldBetween(mf, pB, pT, strutR * 0.72);
          if (post) parts.push(post);
          if (prevTop && prevBot) {
            const topChord = core.beamManifoldBetween(mf, prevTop, pT, strutR * 0.78);
            const diag = core.beamManifoldBetween(mf, (k % 2 === 0 ? prevBot : prevTop), (k % 2 === 0 ? pT : pB), strutR * 0.65);
            if (topChord) parts.push(topChord);
            if (diag) parts.push(diag);
          }
          prevBot = pB; prevTop = pT;
        }
      }
      // Intermediate water/valley piers under long truss
      if (crossesWater || spanLen > halfW * 10) {
        addPierAtT(0.5, 0.95);
      }
    } else {
      // Standard beam / viaduct / trestle: evenly spaced slender piers + guaranteed Z=0 water pier if crossing water
      const pierSpacing = Math.max(4.5, 42 * mToU * scaleToBed);
      const nInnerPiers = Math.max(crossesWater ? 1 : 0, Math.min(7, Math.floor(spanLen / pierSpacing) - 1));
      for (let k = 1; k <= nInnerPiers; k++) {
        addPierAtT(k / (nInnerPiers + 1), 0.9);
      }
    }

    if (parts.length === 0) return null;
    const solid = parts.length === 1 ? parts[0] : core.batchUnionManifolds(mf, parts);
    if (!solid || solid.numTri() === 0) {
      core.safeDeleteManifold(solid);
      return null;
    }

    const solidBb = solid.boundingBox();
    return {
      manifold: solid,
      audit: {
        name: span.name || '',
        structure,
        deckLayer: layerVal,
        zDeckBot,
        zDeckTop,
        bbox: [solidBb.min[0], solidBb.min[1], solidBb.max[0], solidBb.max[1]],
        midspanClearanceU: Math.max(0, clearGapUnder),
        crossesWater,
        pierMinZ: pierMinZ === Infinity ? endStartGroundZ : pierMinZ,
      }
    };
  }

  function buildLayer1Bridges(ctx, scene, terrainWater) {
    const core = _getCore();
    const { mf, halfW, halfH, toBed, scaleMm, mToU, zScale, scaleToBed } = ctx;

    const tileClipPoly = [[
      [-halfW - 0.15, -halfH - 0.15],
      [halfW + 0.15, -halfH - 0.15],
      [halfW + 0.15, halfH + 0.15],
      [-halfW - 0.15, halfH + 0.15],
    ]];

    // 1. Collect all linear bridge ways & closed bridge polygons
    const rawAreas = [];
    for (const bp of (scene && scene.bridgePolys) || []) {
      if (!bp || bp.isPier || !bp.outer || bp.outer.length < 3) continue;
      const outerRaw = bp.outer.map(toBed);
      const clippedOuters = core.clipperIntersectPolys([outerRaw], tileClipPoly, 1e-4);
      if (!clippedOuters || clippedOuters.length === 0) continue;
      const holesBed = (bp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed));
      const tags = bp.tags || {};
      const layerVal = Math.max(1, Math.trunc(Number(bp.layer || bp.level || tags.layer || 1) || 1));
      const structure = _normalizeBridgeStructure(bp.bridgeStructure || tags['bridge:structure'] || tags.bridge, tags);
      for (const co of clippedOuters) {
        if (!co || co.length < 3) continue;
        rawAreas.push({
          outerBed: co,
          holesBed,
          bbox: _bbox2D(co),
          layer: layerVal,
          structure,
          isCovered: tags.covered === 'yes' || bp.covered === 'yes',
          explicitH_m: Number(tags.height || 0) || 0,
          name: bp.name || '',
        });
      }
    }

    const rawLinear = [];
    for (const rd of (scene && scene.roads) || []) {
      if (!rd || !rd.pts || rd.pts.length < 2) continue;
      if (!(rd.bridge || rd.isBridge || rd.man_made === 'bridge')) continue;
      if (rd.man_made === 'pier' || rd.man_made === 'breakwater' || rd.man_made === 'groyne' || rd.man_made === 'jetty') continue;
      const bedPts = rd.pts.map(toBed);
      const tags = rd.tags || {};
      const layerVal = Math.max(1, Math.trunc(Number(rd.layer || rd.level || tags.layer || 1) || 1));
      const structure = _normalizeBridgeStructure(rd.bridgeStructure || tags['bridge:structure'] || rd.bridge, tags);
      const halfWidth = Math.max(ctx.minPrintU * 0.75, ((rd.width || 0.9) * 0.5) * scaleToBed);

      // Deduplicate linear ways falling inside SAME-LAYER man_made=bridge polygons
      let insideSameLayerArea = false;
      if (rawAreas.length > 0) {
        const mid = bedPts[Math.floor(bedPts.length * 0.5)];
        for (const area of rawAreas) {
          if (area.layer === layerVal && _ptInRing(mid[0], mid[1], area.outerBed)) {
            insideSameLayerArea = true;
            break;
          }
        }
      }
      if (insideSameLayerArea) continue;

      rawLinear.push({
        pts: bedPts,
        halfW: halfWidth,
        layer: layerVal,
        structure,
        isCovered: tags.covered === 'yes' || rd.covered === 'yes',
        explicitH_m: Number(tags.height || 0) || 0,
        name: rd.name || '',
      });
    }

    const stitchedLinear = _stitchBridgeWays(rawLinear);

    // 2. Build unified candidate spans sorted from lowest deck layer up so multi-deck bridges NEVER collide vertically
    const allSpans = [];
    // Compute true centerline major axis for area bridge polygons so abutments, arches & piers anchor solidly
    const computeAreaMajorAxis = (ring) => {
      let cx = 0, cy = 0;
      for (const p of ring) { cx += p[0]; cy += p[1]; }
      cx /= ring.length; cy /= ring.length;
      let maxD2 = -1, bestAng = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const d2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
        if (d2 > maxD2) { maxD2 = d2; bestAng = Math.atan2(b[1] - a[1], b[0] - a[0]); }
      }
      const ux = Math.cos(bestAng), uy = Math.sin(bestAng);
      let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
      for (const p of ring) {
        const u = (p[0] - cx) * ux + (p[1] - cy) * uy;
        const v = -(p[0] - cx) * uy + (p[1] - cy) * ux;
        if (u < uMin) uMin = u; if (u > uMax) uMax = u;
        if (v < vMin) vMin = v; if (v > vMax) vMax = v;
      }
      if (vMax - vMin > uMax - uMin) {
        const vx = -uy, vy = ux;
        return {
          pts: [[cx + vx * vMin, cy + vy * vMin], [cx + vx * vMax, cy + vy * vMax]],
          halfW: Math.max(ctx.minPrintU, (uMax - uMin) * 0.45),
        };
      }
      return {
        pts: [[cx + ux * uMin, cy + uy * uMin], [cx + ux * uMax, cy + uy * uMax]],
        halfW: Math.max(ctx.minPrintU, (vMax - vMin) * 0.45),
      };
    };

    for (const a of rawAreas) {
      const axis = computeAreaMajorAxis(a.outerBed);
      allSpans.push({
        isAreaPoly: true,
        pts: axis.pts,
        outerPolyBed: a.outerBed,
        holesPolyBed: a.holesBed,
        bbox: a.bbox,
        halfW: axis.halfW,
        layerVal: a.layer,
        structure: a.structure,
        isCovered: a.isCovered,
        explicitH_m: a.explicitH_m,
        name: a.name,
      });
    }
    for (const c of stitchedLinear) {
      allSpans.push({
        isAreaPoly: false,
        pts: c.pts,
        bbox: _bbox2D(c.pts),
        halfW: c.halfW,
        layerVal: c.layer,
        structure: c.structure,
        isCovered: c.isCovered,
        explicitH_m: c.explicitH_m,
        name: c.name,
      });
    }

    allSpans.sort((a, b) => a.layerVal - b.layerVal);
    const minDeckGapU = Math.max(1.2 / scaleMm, 5.5 * mToU * zScale * scaleToBed);
    const resolvedSpans = [];

    for (let i = 0; i < allSpans.length; i++) {
      const sp = allSpans[i];
      // Check against already placed spans on strictly lower layerVal whose 2D bbox overlaps
      let forcedMinDeckBotZ = 0;
      for (let j = 0; j < resolvedSpans.length; j++) {
        const lower = resolvedSpans[j];
        if (sp.layerVal > lower.layerVal && _bboxesOverlap2D(sp.bbox, lower.bbox, 0.5)) {
          forcedMinDeckBotZ = Math.max(forcedMinDeckBotZ, lower.audit.zDeckTop + minDeckGapU);
        }
      }
      if (forcedMinDeckBotZ > 0) {
        const minDeckThickU = Math.max(0.45 / scaleMm, ((ctx.cfg && ctx.cfg.bridgeDeckMinMm) || 0.719) / scaleMm, sp.halfW * 0.28);
        sp.resolvedDeckTopZ = forcedMinDeckBotZ + minDeckThickU;
      }

      const built = _buildSpanSolidParts(core, mf, ctx, terrainWater, sp);
      if (built) {
        resolvedSpans.push({ ...sp, ...built });
      }
    }

    const bridgeManifolds = resolvedSpans.map(s => s.manifold);
    const bridgeAudits = resolvedSpans.map(s => s.audit);
    ctx.audit.bridgeAudits = bridgeAudits;

    return {
      bridgeManifolds,
      bridgeAudits,
      count: bridgeManifolds.length,
    };
  }

  const exportsObj = { buildLayer1Bridges, _normalizeBridgeStructure };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
