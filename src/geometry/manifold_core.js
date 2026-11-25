// ============================================================================
// src/geometry/manifold_core.js
// Unified Dual-Runtime Geometry Kernel (Manifold 3.5.5 WASM + Clipper2 +
// Straight-Skeleton + Delatin + Earcut + Dual Scene/OSM Projection Helpers)
// ZERO external non-permissive deps, ZERO proper-noun heuristics.
// ============================================================================

(function (root) {
  function _tryRequireLocal(relPath) {
    try {
      let _req = (typeof require === 'function') ? require : null;
      if (!_req && typeof process !== 'undefined') {
        if (typeof process.getBuiltinModule === 'function') {
          const mod = process.getBuiltinModule('module');
          if (mod && typeof mod.createRequire === 'function') {
            _req = mod.createRequire(process.cwd() + '/src/geometry/manifold_core.js');
          }
        } else if (process.mainModule && typeof process.mainModule.require === 'function') {
          _req = process.mainModule.require.bind(process.mainModule);
        }
      }
      if (_req) return _req(relPath);
    } catch (_) {}
    return null;
  }

  function ensureVendorGlobals() {
    if (typeof root.__OSMTOGEOJSON__ === 'undefined' || typeof root.__CLIPPER2__ === 'undefined') {
      const vb = _tryRequireLocal('../vendor/vendor_bundle.js');
      if (vb) {
        if (vb.osmtogeojson) root.__OSMTOGEOJSON__ = vb.osmtogeojson;
        if (vb.Delatin) root.__DELATIN__ = vb.Delatin;
        if (vb.earcut) root.__EARCUT__ = vb.earcut;
        if (vb.fflate) root.__FFLATE__ = vb.fflate;
        if (vb.clipper2) root.__CLIPPER2__ = vb.clipper2;
        if (vb.straightSkeleton) root.__STRAIGHT_SKELETON__ = vb.straightSkeleton;
      }
    }
    if (typeof root.__getManifoldSync === 'undefined') {
      const mv = _tryRequireLocal('../vendor/manifold_vendor.js');
      if (mv) {
        if (mv.__ensureManifoldReady) root.__ensureManifoldReady = mv.__ensureManifoldReady;
        if (mv.__getManifoldSync) root.__getManifoldSync = mv.__getManifoldSync;
      }
    }
    if (typeof root.resolveSceneScaleAndSpec === 'undefined') {
      const cfg = _tryRequireLocal('./print_physics_config.js');
      if (cfg) Object.assign(root, cfg);
    }
    if (typeof root.SLA_PRINT_LAWS === 'undefined' || typeof root.MONO4_SPEC === 'undefined') {
      const laws = _tryRequireLocal('./sla_print_laws.js');
      if (laws) Object.assign(root, laws);
    }
  }

  function getManifoldLib() {
    ensureVendorGlobals();
    if (root.__MANIFOLD_LIB__) return root.__MANIFOLD_LIB__;
    if (typeof root.__getManifoldSync === 'function') {
      return root.__getManifoldSync();
    }
    throw new Error('Manifold WASM runtime not initialized (call await __ensureManifoldReady() first in browser)');
  }

  async function ensureManifoldLibAsync() {
    ensureVendorGlobals();
    if (root.__MANIFOLD_LIB__) return root.__MANIFOLD_LIB__;
    if (typeof root.__ensureManifoldReady === 'function') {
      return await root.__ensureManifoldReady();
    }
    return getManifoldLib();
  }

  function getVendorDeps() {
    ensureVendorGlobals();
    return {
      osmtogeojson: root.__OSMTOGEOJSON__,
      Delatin: root.__DELATIN__,
      earcut: root.__EARCUT__,
      fflate: root.__FFLATE__,
      Clipper2: root.__CLIPPER2__,
      StraightSkeleton: root.__STRAIGHT_SKELETON__,
    };
  }

  // --------------------------------------------------------------------------
  // Deterministic 2D Ring & Clipper2 (SCALE = 100000) Vector Topology Helpers
  // --------------------------------------------------------------------------
  const CLIPPER_SCALE = 100000;

  function signedArea2D(ring) {
    if (!ring || ring.length < 3) return 0;
    let s = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return 0.5 * s;
  }

  function ensureWinding(ring, wantCCW = true, minDist = 4e-4) {
    if (!Array.isArray(ring) || ring.length < 3) return [];
    const pts = [];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      if (pts.length === 0 || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > minDist) {
        pts.push([p[0], p[1]]);
      }
    }
    if (pts.length >= 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= minDist) {
      pts.pop();
    }
    if (pts.length < 3) return [];
    const a = signedArea2D(pts);
    if (Math.abs(a) < 1e-7) return [];
    if (wantCCW === true && a < 0) pts.reverse();
    else if (wantCCW === false && a > 0) pts.reverse();
    return pts;
  }

  function toPath64(C2, ring, wantCCW = null) {
    const clean = ensureWinding(ring, wantCCW, 1e-4);
    if (clean.length < 3) return null;
    const p = [];
    for (let i = 0; i < clean.length; i++) {
      const x = Math.round(clean[i][0] * CLIPPER_SCALE);
      const y = Math.round(clean[i][1] * CLIPPER_SCALE);
      if (p.length === 0 || p[p.length - 1].x !== x || p[p.length - 1].y !== y) {
        p.push({ x, y });
      }
    }
    if (p.length >= 2 && p[0].x === p[p.length - 1].x && p[0].y === p[p.length - 1].y) {
      p.pop();
    }
    return p.length >= 3 ? p : null;
  }

  function fromPaths64(paths64, minAreaUnits = 1e-5) {
    if (!paths64) return [];
    const out = [];
    for (let i = 0; i < paths64.length; i++) {
      const p = paths64[i];
      if (!p || p.length < 3) continue;
      const ring = [];
      for (let j = 0; j < p.length; j++) {
        const pt = p[j];
        const x = Number(pt.x) / CLIPPER_SCALE;
        const y = Number(pt.y) / CLIPPER_SCALE;
        if (ring.length === 0 || Math.hypot(x - ring[ring.length - 1][0], y - ring[ring.length - 1][1]) > 4e-4) {
          ring.push([x, y]);
        }
      }
      if (ring.length >= 2 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) <= 4e-4) {
        ring.pop();
      }
      if (ring.length >= 3 && Math.abs(signedArea2D(ring)) >= minAreaUnits) {
        out.push(ring);
      }
    }
    return out;
  }

  function _tryGetWasmCrossSection() {
    try {
      const mf = root.__MANIFOLD_LIB__ || (typeof root.__getManifoldSync === 'function' ? root.__getManifoldSync() : null);
      return mf && mf.CrossSection ? mf.CrossSection : null;
    } catch (_) {
      return null;
    }
  }

  function _fromWasmPolys(rawPolys, minAreaUnits = 1e-5) {
    if (!rawPolys) return [];
    const out = [];
    for (let i = 0; i < rawPolys.length; i++) {
      const p = rawPolys[i];
      if (!p || p.length < 3) continue;
      const ring = [];
      for (let j = 0; j < p.length; j++) {
        const pt = p[j];
        const x = Number(pt[0]), y = Number(pt[1]);
        if (ring.length === 0 || Math.hypot(x - ring[ring.length - 1][0], y - ring[ring.length - 1][1]) > 4e-4) {
          ring.push([x, y]);
        }
      }
      if (ring.length >= 2 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) <= 4e-4) {
        ring.pop();
      }
      if (ring.length >= 3 && Math.abs(signedArea2D(ring)) >= minAreaUnits) {
        out.push(ring);
      }
    }
    return out;
  }

  function _runClipperOp(clipType, subjPolys, clipPolys = [], fillRuleName = 'NonZero', minArea = 1e-5) {
    const { Clipper2: C2 } = getVendorDeps();
    const totalRings = (subjPolys ? subjPolys.length : 0) + (clipPolys ? clipPolys.length : 0);
    let totalVerts = 0;
    if (totalRings >= 64) {
      for (let i = 0; i < (subjPolys || []).length && totalVerts < 4500; i++) totalVerts += (subjPolys[i] ? subjPolys[i].length : 0);
      for (let i = 0; i < (clipPolys || []).length && totalVerts < 4500; i++) totalVerts += (clipPolys[i] ? clipPolys[i].length : 0);
    }
    const CS = (totalRings >= 350 || totalVerts >= 4500) ? _tryGetWasmCrossSection() : null;
    if (CS && fillRuleName === 'NonZero') {
      const sClean = [];
      for (let i = 0; i < (subjPolys || []).length; i++) {
        const c = ensureWinding(subjPolys[i], null, 1e-4);
        if (c.length >= 3) sClean.push(c);
      }
      if (sClean.length === 0) return [];
      const cClean = [];
      for (let i = 0; i < (clipPolys || []).length; i++) {
        const c = ensureWinding(clipPolys[i], null, 1e-4);
        if (c.length >= 3) cClean.push(c);
      }
      let csSubj = null, csClip = null, csRes = null;
      try {
        csSubj = CS.ofPolygons(sClean, 'NonZero');
        if (clipType === C2.ClipType.Union) {
          if (cClean.length > 0) {
            csClip = CS.ofPolygons(cClean, 'NonZero');
            csRes = csSubj.add(csClip);
          } else {
            csRes = csSubj;
            csSubj = null;
          }
        } else if (clipType === C2.ClipType.Intersection) {
          if (cClean.length === 0) return [];
          csClip = CS.ofPolygons(cClean, 'NonZero');
          csRes = csSubj.intersect(csClip);
        } else if (clipType === C2.ClipType.Difference) {
          if (cClean.length === 0) {
            csRes = csSubj;
            csSubj = null;
          } else {
            csClip = CS.ofPolygons(cClean, 'NonZero');
            csRes = csSubj.subtract(csClip);
          }
        }
        if (csRes) return _fromWasmPolys(csRes.toPolygons(), minArea);
      } catch (_) {
        // Fallback to pure-JS Clipper64 below
      } finally {
        if (csSubj) try { csSubj.delete(); } catch (_) {}
        if (csClip) try { csClip.delete(); } catch (_) {}
        if (csRes) try { csRes.delete(); } catch (_) {}
      }
    }

    const subj = [];
    for (let i = 0; i < (subjPolys || []).length; i++) {
      const p = toPath64(C2, subjPolys[i], null);
      if (p) subj.push(p);
    }
    if (subj.length === 0) return [];
    const clip = [];
    for (let i = 0; i < (clipPolys || []).length; i++) {
      const p = toPath64(C2, clipPolys[i], null);
      if (p) clip.push(p);
    }
    const c = new C2.Clipper64();
    c.preserveCollinear = false;
    c.addPaths(subj, C2.PathType.Subject);
    if (clip.length > 0) c.addPaths(clip, C2.PathType.Clip);
    const sol = [];
    const fr = C2.FillRule[fillRuleName] !== undefined ? C2.FillRule[fillRuleName] : C2.FillRule.NonZero;
    c.execute(clipType, fr, sol);
    return fromPaths64(sol, minArea);
  }

  function clipperUnionPolys(polys, minArea = 1e-5, clipPolys = []) {
    const hasSubj = Boolean(polys && polys.length > 0);
    const hasClip = Boolean(clipPolys && clipPolys.length > 0);
    if (!hasSubj && !hasClip) return [];
    const { Clipper2: C2 } = getVendorDeps();
    if (!hasSubj) return _runClipperOp(C2.ClipType.Union, clipPolys, [], 'NonZero', minArea);
    return _runClipperOp(C2.ClipType.Union, polys, hasClip ? clipPolys : [], 'NonZero', minArea);
  }

  function clipperIntersectPolys(subjPolys, clipPolys, minArea = 1e-5) {
    if (!subjPolys || subjPolys.length === 0 || !clipPolys || clipPolys.length === 0) return [];
    const { Clipper2: C2 } = getVendorDeps();
    return _runClipperOp(C2.ClipType.Intersection, subjPolys, clipPolys, 'NonZero', minArea);
  }

  function clipperDiffPolys(subjPolys, clipPolys, minArea = 1e-5) {
    if (!subjPolys || subjPolys.length === 0) return [];
    if (!clipPolys || clipPolys.length === 0) return clipperUnionPolys(subjPolys, minArea);
    const { Clipper2: C2 } = getVendorDeps();
    return _runClipperOp(C2.ClipType.Difference, subjPolys, clipPolys, 'NonZero', minArea);
  }

  function clipperOffsetPolys(polys, delta, joinTypeName = 'Miter', minArea = 1e-5) {
    if (!polys || polys.length === 0) return [];
    const { Clipper2: C2 } = getVendorDeps();
    const paths = [];
    for (let i = 0; i < polys.length; i++) {
      const p = toPath64(C2, polys[i], true);
      if (p) paths.push(p);
    }
    if (paths.length === 0) return [];
    const jt = C2.JoinType[joinTypeName] || C2.JoinType.Miter;
    const arcTol = Math.max(80, Math.min(2500, Math.abs(delta) * CLIPPER_SCALE * 0.035));
    const sol = C2.inflatePaths(paths, delta * CLIPPER_SCALE, jt, C2.EndType.Polygon, 2.5, arcTol);
    return fromPaths64(sol, minArea);
  }

  function clipperBufferOpenPaths(linesAndWidths, joinTypeName = 'Round', minArea = 1e-5) {
    if (!linesAndWidths || linesAndWidths.length === 0) return [];
    const { Clipper2: C2 } = getVendorDeps();
    const allPolys = [];
    const jt = C2.JoinType[joinTypeName] || C2.JoinType.Round;
    for (let i = 0; i < linesAndWidths.length; i++) {
      const item = linesAndWidths[i];
      const pts = item.pts || item;
      const halfW = Math.max(0.01, Number(item.halfW || item.width * 0.5 || 0.35));
      if (!pts || pts.length < 2) continue;
      const path64 = [];
      for (let j = 0; j < pts.length; j++) {
        const pt = pts[j];
        if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;
        const x = Math.round(pt[0] * CLIPPER_SCALE);
        const y = Math.round(pt[1] * CLIPPER_SCALE);
        if (path64.length === 0 || path64[path64.length - 1].x !== x || path64[path64.length - 1].y !== y) {
          path64.push({ x, y });
        }
      }
      if (path64.length < 2) continue;
      const arcTol = Math.max(80, Math.min(2500, halfW * CLIPPER_SCALE * 0.035));
      const sol = C2.inflatePaths([path64], halfW * CLIPPER_SCALE, jt, item.squareEnd ? C2.EndType.Square : C2.EndType.Round, 2.0, arcTol);
      const res = fromPaths64(sol, minArea);
      for (let r = 0; r < res.length; r++) allPolys.push(res[r]);
    }
    if (allPolys.length <= 1) return allPolys;
    return clipperUnionPolys(allPolys, minArea);
  }

  // Group Clipper2 Positive+Negative rings into [{ outer, holes }] via strictly-interior point containment
  function ringsToOutersWithHoles(rings, minArea = 1e-5) {
    const outers = [];
    const holes = [];
    const ringBBox = (poly) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < poly.length; i++) {
        const x = poly[i][0], y = poly[i][1];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      return [x0, y0, x1, y1];
    };
    for (let i = 0; i < (rings || []).length; i++) {
      const r = rings[i];
      if (!r || r.length < 3) continue;
      const a = signedArea2D(r);
      if (Math.abs(a) < minArea) continue;
      if (a > 0) outers.push({ outer: r, holes: [], area: a, bb: ringBBox(r) });
      else holes.push({ ring: r, area: Math.abs(a), bb: ringBBox(r) });
    }
    const ptInRing = (px, py, poly) => {
      let inside = false;
      for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
      }
      return inside;
    };
    // Computes a point guaranteed strictly inside `poly` (crucial for C-shaped / concave islands like Palm Crescent)
    const strictlyInteriorPt = (poly, bb) => {
      let cx = 0, cy = 0;
      for (let k = 0; k < poly.length; k++) { cx += poly[k][0]; cy += poly[k][1]; }
      cx /= poly.length; cy /= poly.length;
      if (ptInRing(cx, cy, poly)) return [cx, cy];

      const dy = bb[3] - bb[1];
      if (dy > 1e-9) {
        let bestMid = null, bestSpan = -1;
        for (const frac of [0.5, 0.37, 0.63, 0.25, 0.75]) {
          const sy = bb[1] + dy * frac;
          const xs = [];
          for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
            const yi = poly[i][1], yj = poly[j][1];
            if ((yi > sy) !== (yj > sy)) {
              xs.push(poly[i][0] + ((poly[j][0] - poly[i][0]) * (sy - yi)) / (yj - yi));
            }
          }
          xs.sort((a, b) => a - b);
          for (let k = 0; k + 1 < xs.length; k += 2) {
            const span = xs[k + 1] - xs[k];
            if (span > bestSpan) {
              const mx = (xs[k] + xs[k + 1]) * 0.5;
              if (ptInRing(mx, sy, poly)) { bestSpan = span; bestMid = [mx, sy]; }
            }
          }
        }
        if (bestMid) return bestMid;
      }

      for (let i = 0, n = poly.length; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        const dx = b[0] - a[0], edy = b[1] - a[1], len = Math.hypot(dx, edy);
        if (len < 1e-7) continue;
        const mx = (a[0] + b[0]) * 0.5, my = (a[1] + b[1]) * 0.5;
        const eps = Math.min(len * 0.15, 1e-3);
        const nx = -edy / len, ny = dx / len;
        if (ptInRing(mx + nx * eps, my + ny * eps, poly)) return [mx + nx * eps, my + ny * eps];
        if (ptInRing(mx - nx * eps, my - ny * eps, poly)) return [mx - nx * eps, my - ny * eps];
      }
      return [poly[0][0], poly[0][1]];
    };

    if (outers.length === 0 || holes.length === 0) {
      return outers.map(o => ({ outer: o.outer, holes: o.holes, area: o.area }));
    }

    // Spatial 2D grid index when hole * outer product is large (O(H + O) instead of O(H * O))
    const useGrid = outers.length * holes.length >= 2500;
    const CELL = 6.0;
    let outerGrid = null;
    if (useGrid) {
      outerGrid = new Map();
      for (let oi = 0; oi < outers.length; oi++) {
        const o = outers[oi];
        const gx0 = Math.floor((o.bb[0] - 1e-4) / CELL), gx1 = Math.floor((o.bb[2] + 1e-4) / CELL);
        const gy0 = Math.floor((o.bb[1] - 1e-4) / CELL), gy1 = Math.floor((o.bb[3] + 1e-4) / CELL);
        for (let gx = gx0; gx <= gx1; gx++) {
          for (let gy = gy0; gy <= gy1; gy++) {
            const k = `${gx}:${gy}`;
            let bucket = outerGrid.get(k);
            if (!bucket) { bucket = []; outerGrid.set(k, bucket); }
            bucket.push(o);
          }
        }
      }
    }

    for (let hi = 0; hi < holes.length; hi++) {
      const h = holes[hi];
      const ip = strictlyInteriorPt(h.ring, h.bb);
      let best = null;
      const candidates = outerGrid
        ? (outerGrid.get(`${Math.floor(ip[0] / CELL)}:${Math.floor(ip[1] / CELL)}`) || [])
        : outers;
      for (let ci = 0; ci < candidates.length; ci++) {
        const o = candidates[ci];
        if (o.area <= h.area * 1.0001) continue;
        if (best && o.area >= best.area) continue;
        if (ip[0] < o.bb[0] - 1e-4 || ip[0] > o.bb[2] + 1e-4 || ip[1] < o.bb[1] - 1e-4 || ip[1] > o.bb[3] + 1e-4) continue;
        if (ptInRing(ip[0], ip[1], o.outer)) {
          best = o;
        }
      }
      if (best) best.holes.push(h.ring);
    }
    return outers.map(o => ({ outer: o.outer, holes: o.holes, area: o.area }));
  }

  // --------------------------------------------------------------------------
  // Manifold Construction, Boolean Batching & Triangle Soup Packing
  // --------------------------------------------------------------------------

  function safeDeleteManifold(m) {
    try {
      if (m && typeof m.delete === 'function' && (!m.isDeleted || !m.isDeleted())) {
        m.delete();
      }
    } catch (_) {}
  }

  function batchUnionManifolds(mf, list) {
    if (!list || list.length === 0) return null;
    if (list.length === 1) return list[0];
    // Balanced binary union tree prevents O(N^2) cascading boolean slowdown
    let cur = list.slice();
    while (cur.length > 1) {
      const next = [];
      for (let i = 0; i < cur.length; i += 8) {
        const chunk = cur.slice(i, i + 8);
        if (chunk.length === 1) {
          next.push(chunk[0]);
        } else {
          const u = mf.Manifold.union(chunk);
          for (let k = 0; k < chunk.length; k++) safeDeleteManifold(chunk[k]);
          next.push(u);
        }
      }
      cur = next;
    }
    return cur[0];
  }

  function extrudeRingSolid(mf, outer, holes, zMin, zMax) {
    if (!(zMax > zMin + 1e-5)) return null;
    const ccwOuter = ensureWinding(outer, true, 1e-4);
    if (ccwOuter.length < 3) return null;
    const polyList = [ccwOuter];
    for (let i = 0; i < (holes || []).length; i++) {
      const cwHole = ensureWinding(holes[i], false, 1e-4);
      if (cwHole.length >= 3) polyList.push(cwHole);
    }
    let cs = null;
    let man = null;
    try {
      cs = mf.CrossSection.ofPolygons(polyList, 'Positive');
      if (cs.isEmpty && cs.isEmpty()) return null;
      const h = zMax - zMin;
      man = cs.extrude(h);
      if (Math.abs(zMin) > 1e-7) {
        const shifted = man.translate([0, 0, zMin]);
        man.delete();
        man = shifted;
      }
      if (!man || (man.isEmpty && man.isEmpty()) || man.numTri() === 0) {
        safeDeleteManifold(man);
        return null;
      }
      return man;
    } catch (_) {
      safeDeleteManifold(man);
      return null;
    } finally {
      safeDeleteManifold(cs);
    }
  }

  function manifoldFromRawSoup(mf, positions, indices, mergeTol = 1e-5) {
    if (!positions || positions.length < 9 || !indices || indices.length < 3) return null;
    try {
      const mesh = new mf.Mesh({
        numProp: 3,
        vertProperties: positions instanceof Float32Array ? positions : new Float32Array(positions),
        triVerts: indices instanceof Uint32Array ? indices : new Uint32Array(indices),
        tolerance: mergeTol,
      });
      mesh.merge();
      const man = new mf.Manifold(mesh);
      if (man.status() !== 'NoError' || man.numTri() === 0) {
        man.delete();
        return null;
      }
      return man;
    } catch (_) {
      return null;
    }
  }

  function trianglesToShellManifolds(mf, tris) {
    if (!mf || !Array.isArray(tris) || tris.length === 0) return [];
    const groups = new Map();
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      const key = `${t.mBatch !== undefined ? t.mBatch : -1}|${t.layerId ?? 0}|${t.tileId ?? 0}|${t.shellId ?? 0}`;
      let arr = groups.get(key);
      if (!arr) { arr = []; groups.set(key, arr); }
      arr.push(t);
    }
    const solids = [];
    for (const gTris of groups.values()) {
      let man = null;
      const allBatch = gTris.every(t => t.mBatch !== undefined && t.vi0 !== undefined && t.vi1 !== undefined && t.vi2 !== undefined);
      if (allBatch) {
        const viToIdx = new Map();
        const pos = [];
        const idx = new Uint32Array(gTris.length * 3);
        let nIdx = 0;
        const regVert = (vi, v) => {
          let li = viToIdx.get(vi);
          if (li === undefined) {
            li = pos.length / 3;
            viToIdx.set(vi, li);
            pos.push(v[0], v[1], v[2]);
          }
          return li;
        };
        for (let i = 0; i < gTris.length; i++) {
          const t = gTris[i];
          const a = regVert(t.vi0, t.v0), b = regVert(t.vi1, t.v1), c = regVert(t.vi2, t.v2);
          if (a === b || b === c || c === a) continue;
          idx[nIdx++] = a; idx[nIdx++] = b; idx[nIdx++] = c;
        }
        if (nIdx >= 12) {
          try {
            const mesh = new mf.Mesh({
              numProp: 3,
              vertProperties: new Float32Array(pos),
              triVerts: nIdx === idx.length ? idx : idx.subarray(0, nIdx),
            });
            man = new mf.Manifold(mesh);
            if (man.status() !== 'NoError' || man.numTri() === 0) {
              safeDeleteManifold(man);
              man = null;
            }
          } catch (_) {
            safeDeleteManifold(man);
            man = null;
          }
        }
      }
      if (!man) {
        const vMap = new Map();
        const pos = [];
        const idx = [];
        const regPt = (p) => {
          const x = Math.fround(p[0]), y = Math.fround(p[1]), z = Math.fround(p[2]);
          const k = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
          let li = vMap.get(k);
          if (li === undefined) {
            li = pos.length / 3;
            vMap.set(k, li);
            pos.push(x, y, z);
          }
          return li;
        };
        for (let i = 0; i < gTris.length; i++) {
          const t = gTris[i];
          const a = regPt(t.v0), b = regPt(t.v1), c = regPt(t.v2);
          if (a === b || b === c || c === a) continue;
          idx.push(a, b, c);
        }
        if (idx.length >= 12) {
          man = manifoldFromRawSoup(mf, new Float32Array(pos), new Uint32Array(idx), 1e-4);
        }
      }
      if (man && man.numTri() > 0 && man.volume() > 1e-9) {
        solids.push(man);
      } else {
        safeDeleteManifold(man);
      }
    }
    return solids;
  }

  function boxManifoldFromBounds(mf, minX, maxX, minY, maxY, minZ, maxZ) {
    const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    if (dx <= 1e-5 || dy <= 1e-5 || dz <= 1e-5) return null;
    const raw = mf.Manifold.cube([dx, dy, dz], false);
    const shifted = raw.translate([minX, minY, minZ]);
    raw.delete();
    return shifted;
  }

  // Oriented box prism between two 3D points (for 3D struts, bridge cables, truss members, crane jibs)
  function beamManifoldBetween(mf, p0, p1, radius) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4 || radius < 1e-4) return null;
    const cyl = mf.Manifold.cylinder(len, radius, radius, 8, false);
    // Align +Z axis onto unit vector (dx, dy, dz) / len
    const ux = dx / len, uy = dy / len, uz = dz / len;
    const pitchRad = Math.acos(Math.max(-1, Math.min(1, uz)));
    const pitchDeg = (pitchRad * 180) / Math.PI;
    const yawDeg = (Math.atan2(uy, ux) * 180) / Math.PI;
    // Rotate around Y by pitchDeg (tilts +Z towards +X), then rotate around Z by yawDeg
    const r1 = cyl.rotate([0, pitchDeg, 0]);
    cyl.delete();
    const r2 = r1.rotate([0, 0, yawDeg]);
    r1.delete();
    const moved = r2.translate([p0[0], p0[1], p0[2]]);
    r2.delete();
    return moved;
  }

  let _nextManifoldBatchId = 0;

  function appendManifoldToTriangles(manifoldObj, outArr, layerId, buildingId = -1, tileId = 0, shellId = -1) {
    if (!manifoldObj) return 0;
    const numTri = manifoldObj.numTri();
    if (numTri <= 0) return 0;
    const m = manifoldObj.getMesh();
    const vp = m.vertProperties;
    const tv = m.triVerts;
    const np = m.numProp || 3;
    const nTri = Math.floor(tv.length / 3);
    if (nTri <= 0) return 0;

    const mBatch = ++_nextManifoldBatchId;
    let added = 0;
    for (let t = 0; t < nTri; t++) {
      const i0 = tv[t * 3];
      const i1 = tv[t * 3 + 1];
      const i2 = tv[t * 3 + 2];
      if (i0 === i1 || i1 === i2 || i2 === i0) continue;

      const b0 = i0 * np, b1 = i1 * np, b2 = i2 * np;
      const x0 = vp[b0], y0 = vp[b0 + 1], z0 = vp[b0 + 2];
      const x1 = vp[b1], y1 = vp[b1 + 1], z1 = vp[b1 + 2];
      const x2 = vp[b2], y2 = vp[b2 + 1], z2 = vp[b2 + 2];

      const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
      const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz);
      if (nl >= 1e-18 && Number.isFinite(nl)) {
        nx /= nl; ny /= nl; nz /= nl;
      } else {
        nx = 0; ny = 0; nz = 1;
      }

      outArr.push({
        v0: [x0, y0, z0],
        v1: [x1, y1, z1],
        v2: [x2, y2, z2],
        n: [nx, ny, nz],
        layerId,
        buildingId,
        tileId,
        shellId,
        mBatch,
        vi0: i0,
        vi1: i1,
        vi2: i2,
      });
      added++;
    }
    return added;
  }

  // Pure-JS O(T) connected-component triangle emitter over a single getMesh() call.
  // Eliminates C++ Manifold._Decompose() WASM OOM/abort on scenes with thousands of islands/forest patches.
  function appendManifoldComponentsToTriangles(manifoldObj, outArr, layerId, buildingId = -1, tileId = 0, nextSidFn = null) {
    if (!manifoldObj) return 0;
    const numTri = manifoldObj.numTri();
    if (numTri <= 0) return 0;
    const m = manifoldObj.getMesh();
    const vp = m.vertProperties;
    const tv = m.triVerts;
    const np = m.numProp || 3;
    const nTri = Math.floor(tv.length / 3);
    const nv = Math.floor(vp.length / np);
    if (nTri <= 0 || nv <= 0) return 0;

    const parent = new Int32Array(nv);
    for (let i = 0; i < nv; i++) parent[i] = i;
    const find = (x) => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };

    for (let t = 0; t < nTri; t++) {
      const i0 = tv[t * 3], i1 = tv[t * 3 + 1], i2 = tv[t * 3 + 2];
      if (i0 === i1 || i1 === i2 || i2 === i0) continue;
      const r0 = find(i0), r1 = find(i1);
      if (r0 !== r1) parent[r1] = r0;
      const r2 = find(i2), r0b = find(r0);
      if (r0b !== r2) parent[r2] = r0b;
    }

    const rootToComp = new Int32Array(nv).fill(-1);
    const triComp = new Int32Array(nTri).fill(-1);
    const compCounts = [];
    let nComps = 0;

    for (let t = 0; t < nTri; t++) {
      const i0 = tv[t * 3], i1 = tv[t * 3 + 1], i2 = tv[t * 3 + 2];
      if (i0 === i1 || i1 === i2 || i2 === i0) continue;
      const r = find(i0);
      let cid = rootToComp[r];
      if (cid < 0) {
        cid = nComps++;
        rootToComp[r] = cid;
        compCounts.push(0);
      }
      triComp[t] = cid;
      compCounts[cid]++;
    }
    if (nComps === 0) return 0;

    // Fast path when the entire Manifold is already 1 connected component
    if (nComps === 1) {
      const sid = typeof nextSidFn === 'function' ? nextSidFn() : 1;
      const mBatch = ++_nextManifoldBatchId;
      let added = 0;
      for (let t = 0; t < nTri; t++) {
        if (triComp[t] < 0) continue;
        const i0 = tv[t * 3], i1 = tv[t * 3 + 1], i2 = tv[t * 3 + 2];
        const b0 = i0 * np, b1 = i1 * np, b2 = i2 * np;
        const x0 = vp[b0], y0 = vp[b0 + 1], z0 = vp[b0 + 2];
        const x1 = vp[b1], y1 = vp[b1 + 1], z1 = vp[b1 + 2];
        const x2 = vp[b2], y2 = vp[b2 + 1], z2 = vp[b2 + 2];
        const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
        const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz);
        if (nl >= 1e-18 && Number.isFinite(nl)) { nx /= nl; ny /= nl; nz /= nl; } else { nx = 0; ny = 0; nz = 1; }
        outArr.push({
          v0: [x0, y0, z0], v1: [x1, y1, z1], v2: [x2, y2, z2], n: [nx, ny, nz],
          layerId, buildingId, tileId, shellId: sid, mBatch, vi0: i0, vi1: i1, vi2: i2,
        });
        added++;
      }
      return added;
    }

    // Multi-component counting-sort bucket so every component is emitted contiguously in O(T)
    const offsets = new Int32Array(nComps + 1);
    for (let c = 0; c < nComps; c++) offsets[c + 1] = offsets[c] + compCounts[c];
    const cursor = offsets.slice(0, nComps);
    const orderedTris = new Int32Array(offsets[nComps]);
    for (let t = 0; t < nTri; t++) {
      const cid = triComp[t];
      if (cid >= 0) orderedTris[cursor[cid]++] = t;
    }

    let added = 0;
    for (let c = 0; c < nComps; c++) {
      const start = offsets[c], end = offsets[c + 1];
      if (end <= start) continue;
      const sid = typeof nextSidFn === 'function' ? nextSidFn() : (c + 1);
      const mBatch = ++_nextManifoldBatchId;
      for (let p = start; p < end; p++) {
        const t = orderedTris[p];
        const i0 = tv[t * 3], i1 = tv[t * 3 + 1], i2 = tv[t * 3 + 2];
        const b0 = i0 * np, b1 = i1 * np, b2 = i2 * np;
        const x0 = vp[b0], y0 = vp[b0 + 1], z0 = vp[b0 + 2];
        const x1 = vp[b1], y1 = vp[b1 + 1], z1 = vp[b1 + 2];
        const x2 = vp[b2], y2 = vp[b2 + 1], z2 = vp[b2 + 2];
        const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
        const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz);
        if (nl >= 1e-18 && Number.isFinite(nl)) { nx /= nl; ny /= nl; nz /= nl; } else { nx = 0; ny = 0; nz = 1; }
        outArr.push({
          v0: [x0, y0, z0], v1: [x1, y1, z1], v2: [x2, y2, z2], n: [nx, ny, nz],
          layerId, buildingId, tileId, shellId: sid, mBatch, vi0: i0, vi1: i1, vi2: i2,
        });
        added++;
      }
    }
    return added;
  }

  // Convert a Manifold to STL triangles. Remove floating micro-shells on grounded meshes.
  // Keep shared Float32 vertices separate and non-collinear for zero-defect topology.
  function extractDePinchedStlTriangles(mf, man, tid = 0, scaleMm = 1, options = null) {
    if (!man || man.numTri() === 0) return [];
    const scMm = Math.max(1e-4, Number(scaleMm) || 1);
    const opts = (options && typeof options === 'object') ? options : {};
    const intSeams = (opts.interiorSeams && typeof opts.interiorSeams === 'object') ? opts.interiorSeams : {};
    const tbMm = (opts.tileBoundsMm && typeof opts.tileBoundsMm === 'object') ? opts.tileBoundsMm : null;
    const lockXsMm = [];
    const lockYsMm = [];
    const interiorXsU = [];
    const interiorYsU = [];
    const addUniquePlane = (arr, v) => {
      if (!Number.isFinite(v)) return;
      for (let i = 0; i < arr.length; i++) {
        if (Math.abs(arr[i] - v) < 1e-6) return;
      }
      arr.push(v);
    };
    for (const sx of (intSeams.cutXsMm || [])) {
      const n = Number(sx);
      if (Number.isFinite(n)) { addUniquePlane(lockXsMm, n); interiorXsU.push(n / scMm); }
    }
    for (const sy of (intSeams.cutYsMm || [])) {
      const n = Number(sy);
      if (Number.isFinite(n)) { addUniquePlane(lockYsMm, n); interiorYsU.push(n / scMm); }
    }
    if (tbMm) {
      addUniquePlane(lockXsMm, Number(tbMm.minX));
      addUniquePlane(lockXsMm, Number(tbMm.maxX));
      addUniquePlane(lockYsMm, Number(tbMm.minY));
      addUniquePlane(lockYsMm, Number(tbMm.maxY));
    }
    let src = man;
    let ownsSrc = false;
    if (lockXsMm.length === 0 && lockYsMm.length === 0 && typeof man.simplify === 'function') {
      try {
        const tol = Math.max(1e-5, Math.min(1e-3, 0.0015 / scMm));
        const simp = man.simplify(tol);
        if (simp && simp.numTri() > 0) {
          src = simp;
          ownsSrc = true;
        } else {
          safeDeleteManifold(simp);
        }
      } catch (_) {}
    }
    const m = src.getMesh();
    const rawVp = m.vertProperties;
    const tv = m.triVerts;
    const np = m.numProp || 3;
    const nv = Math.floor(rawVp.length / np);
    const nTri = Math.floor(tv.length / 3);
    if (nv <= 0 || nTri <= 0) {
      if (ownsSrc) safeDeleteManifold(src);
      return [];
    }
    const vp = new Float64Array(nv * 3);
    for (let v = 0; v < nv; v++) {
      vp[v * 3] = rawVp[v * np];
      vp[v * 3 + 1] = rawVp[v * np + 1];
      vp[v * 3 + 2] = rawVp[v * np + 2];
    }

    const vNorm = new Float64Array(nv * 3);
    for (let t = 0; t < nTri; t++) {
      const i0 = tv[t * 3];
      const i1 = tv[t * 3 + 1];
      const i2 = tv[t * 3 + 2];
      if (i0 === i1 || i1 === i2 || i2 === i0) continue;
      const a = i0 * 3;
      const b = i1 * 3;
      const c = i2 * 3;
      const ux = vp[b] - vp[a];
      const uy = vp[b + 1] - vp[a + 1];
      const uz = vp[b + 2] - vp[a + 2];
      const vx = vp[c] - vp[a];
      const vy = vp[c + 1] - vp[a + 1];
      const vz = vp[c + 2] - vp[a + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      vNorm[a] += nx; vNorm[a + 1] += ny; vNorm[a + 2] += nz;
      vNorm[b] += nx; vNorm[b + 1] += ny; vNorm[b + 2] += nz;
      vNorm[c] += nx; vNorm[c + 1] += ny; vNorm[c + 2] += nz;
    }

    // Build a 3D spatial hash helper reused by unit depinching and mm collision checks.
    const createSpatialGrid = (cellSize, minDistSq, readX, readY, readZ) => {
      const cells = new Map();
      const key = (x, y, z) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`;
      const add = (id) => {
        const ck = key(readX(id), readY(id), readZ(id));
        let arr = cells.get(ck);
        if (!arr) { arr = []; cells.set(ck, arr); }
        arr.push(id);
      };
      const remove = (id, x, y, z) => {
        const list = cells.get(key(x, y, z));
        if (!list) return;
        const idx = list.indexOf(id);
        if (idx >= 0) list.splice(idx, 1);
      };
      const hasClose = (x, y, z, skipId = -1) => {
        const cx = Math.floor(x / cellSize);
        const cy = Math.floor(y / cellSize);
        const cz = Math.floor(z / cellSize);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              const list = cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
              if (!list) continue;
              for (let k = 0; k < list.length; k++) {
                const oid = list[k];
                if (oid === skipId) continue;
                const ddx = x - readX(oid);
                const ddy = y - readY(oid);
                const ddz = z - readZ(oid);
                if (ddx * ddx + ddy * ddy + ddz * ddz < minDistSq) return true;
              }
            }
          }
        }
        return false;
      };
      return { add, remove, hasClose };
    };

    const findClearSpiralXY = (bx, by, bz, stepSize, skipId, gridRef, roundF32, lockX = false, lockY = false) => {
      if (lockX && lockY) return null;
      for (let step = 1; step <= 6; step++) {
        const rad = stepSize * step;
        if (lockX) {
          for (const s of [1, -1]) {
            const ty = roundF32 ? Math.fround(by + s * rad) : (by + s * rad);
            if (!gridRef.hasClose(bx, ty, bz, skipId)) return [bx, ty];
          }
          continue;
        }
        if (lockY) {
          for (const s of [1, -1]) {
            const tx = roundF32 ? Math.fround(bx + s * rad) : (bx + s * rad);
            if (!gridRef.hasClose(tx, by, bz, skipId)) return [tx, by];
          }
          continue;
        }
        for (let ai = 0; ai < 16; ai++) {
          const ang = (ai * Math.PI) / 8;
          const rawX = bx + Math.cos(ang) * rad;
          const rawY = by + Math.sin(ang) * rad;
          const tx = roundF32 ? Math.fround(rawX) : rawX;
          const ty = roundF32 ? Math.fround(rawY) : rawY;
          if (!gridRef.hasClose(tx, ty, bz, skipId)) return [tx, ty];
        }
      }
      return null;
    };

    const vertLockX = new Uint8Array(nv);
    const vertLockY = new Uint8Array(nv);
    if (lockXsMm.length > 0 || lockYsMm.length > 0) {
      const planeTolMm = 0.009;
      const snapTolMm = 2e-4;
      for (let v = 0; v < nv; v++) {
        const b = v * 3;
        const xMm = vp[b] * scMm;
        const yMm = vp[b + 1] * scMm;
        for (let i = 0; i < lockXsMm.length; i++) {
          const dx = Math.abs(xMm - lockXsMm[i]);
          if (dx < planeTolMm) {
            vertLockX[v] = 1;
            if (dx < snapTolMm) vp[b] = lockXsMm[i] / scMm;
            break;
          }
        }
        for (let i = 0; i < lockYsMm.length; i++) {
          const dy = Math.abs(yMm - lockYsMm[i]);
          if (dy < planeTolMm) {
            vertLockY[v] = 1;
            if (dy < snapTolMm) vp[b + 1] = lockYsMm[i] / scMm;
            break;
          }
        }
      }
    }

    // Separate pinched or coincident vertices in scene units while keeping cut planes locked.
    const cellU = 0.001 / scMm;
    const shiftU = 0.0015 / scMm;
    const unitGrid = createSpatialGrid(
      cellU,
      (cellU * 0.5) * (cellU * 0.5),
      (v) => vp[v * 3],
      (v) => vp[v * 3 + 1],
      (v) => vp[v * 3 + 2]
    );

    for (let v = 0; v < nv; v++) {
      const b = v * 3;
      let x = vp[b];
      let y = vp[b + 1];
      let z = vp[b + 2];
      const origZ = z;
      const lx = Boolean(vertLockX[v]);
      const ly = Boolean(vertLockY[v]);
      if (unitGrid.hasClose(x, y, z, -1)) {
        const nx = lx ? 0 : vNorm[b];
        const ny = ly ? 0 : vNorm[b + 1];
        const nz = vNorm[b + 2];
        const dirs = [
          [nx, ny, nz],
          [nx, ny, 0],
          [lx ? 0 : 1, 0, 0],
          [0, ly ? 0 : 1, 0],
          [0, 0, origZ <= shiftU * 2 ? -1 : 1]
        ];
        let moved = false;
        outer: for (let di = 0; di < dirs.length; di++) {
          let [dx, dy, dz] = dirs[di];
          if (lx) dx = 0;
          if (ly) dy = 0;
          const dl = Math.hypot(dx, dy, dz);
          if (dl < 1e-9) continue;
          dx /= dl; dy /= dl; dz /= dl;
          for (let step = 1; step <= 8; step++) {
            const tx = vp[b] - dx * shiftU * step;
            const ty = vp[b + 1] - dy * shiftU * step;
            const tz = vp[b + 2] - dz * shiftU * step;
            if (origZ >= 0 && tz < 0) continue;
            if (!unitGrid.hasClose(tx, ty, tz, -1)) {
              x = tx; y = ty; z = tz;
              moved = true;
              break outer;
            }
          }
        }
        if (!moved) {
          const xy = findClearSpiralXY(vp[b], vp[b + 1], origZ, shiftU, -1, unitGrid, false, lx, ly);
          if (xy) { x = xy[0]; y = xy[1]; z = origZ; }
        }
        vp[b] = x; vp[b + 1] = y; vp[b + 2] = z;
      }
      unitGrid.add(v);
    }

    // Build Union-Find components over surviving triangles to filter floating shells (VAL-05).
    const parent = new Int32Array(nv);
    for (let i = 0; i < nv; i++) parent[i] = i;
    const find = (x) => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    const usedVerts = new Uint8Array(nv);
    for (let t = 0; t < nTri; t++) {
      const i0 = tv[t * 3];
      const i1 = tv[t * 3 + 1];
      const i2 = tv[t * 3 + 2];
      if (i0 === i1 || i1 === i2 || i2 === i0) continue;
      usedVerts[i0] = 1;
      usedVerts[i1] = 1;
      usedVerts[i2] = 1;
      const r0 = find(i0);
      const r1 = find(i1);
      if (r0 !== r1) parent[r1] = r0;
      const r2 = find(i2);
      const r0b = find(r0);
      if (r0b !== r2) parent[r2] = r0b;
    }

    const compMinZ = new Float64Array(nv);
    const compMinX = new Float64Array(nv);
    const compMaxX = new Float64Array(nv);
    const compMinY = new Float64Array(nv);
    const compMaxY = new Float64Array(nv);
    compMinZ.fill(Infinity);
    compMinX.fill(Infinity);
    compMaxX.fill(-Infinity);
    compMinY.fill(Infinity);
    compMaxY.fill(-Infinity);
    let globalMinZ = Infinity;
    let globalMinX = Infinity, globalMaxX = -Infinity, globalMinY = Infinity, globalMaxY = -Infinity;
    for (let v = 0; v < nv; v++) {
      if (!usedVerts[v]) continue;
      const x = vp[v * 3];
      const y = vp[v * 3 + 1];
      const z = vp[v * 3 + 2];
      if (z < globalMinZ) globalMinZ = z;
      if (x < globalMinX) globalMinX = x;
      if (x > globalMaxX) globalMaxX = x;
      if (y < globalMinY) globalMinY = y;
      if (y > globalMaxY) globalMaxY = y;
      const r = find(v);
      if (z < compMinZ[r]) compMinZ[r] = z;
      if (x < compMinX[r]) compMinX[r] = x;
      if (x > compMaxX[r]) compMaxX[r] = x;
      if (y < compMinY[r]) compMinY[r] = y;
      if (y > compMaxY[r]) compMaxY[r] = y;
    }
    if (!Number.isFinite(globalMinZ)) {
      if (ownsSrc) safeDeleteManifold(src);
      return [];
    }

    const groundThreshU = 0.05 / scMm;
    const isGroundedMesh = globalMinZ <= groundThreshU;

    // On full-sized grounded tiles, also drop detached clipped border stubs (thin < 16 mm2
    // slivers sitting on the tile perimeter that break loose under waterCutout).
    const dropComp = new Uint8Array(nv);
    if (isGroundedMesh) {
      const compVolMm3 = new Float64Array(nv);
      const scale3 = scMm * scMm * scMm;
      for (let t = 0; t < nTri; t++) {
        const i0 = tv[t * 3], i1 = tv[t * 3 + 1], i2 = tv[t * 3 + 2];
        if (i0 === i1 || i1 === i2 || i2 === i0) continue;
        const b0 = i0 * 3, b1 = i1 * 3, b2 = i2 * 3;
        const x0 = vp[b0], y0 = vp[b0 + 1], z0 = vp[b0 + 2];
        const x1 = vp[b1], y1 = vp[b1 + 1], z1 = vp[b1 + 2];
        const x2 = vp[b2], y2 = vp[b2 + 1], z2 = vp[b2 + 2];
        const v6 = x0 * (y1 * z2 - z1 * y2) + y0 * (z1 * x2 - x1 * z2) + z0 * (x1 * y2 - y1 * x2);
        compVolMm3[find(i0)] += (v6 / 6.0) * scale3;
      }
      let mainRoot = -1, mainAreaMm2 = 0;
      for (let v = 0; v < nv; v++) {
        if (!usedVerts[v] || find(v) !== v) continue;
        const area = (compMaxX[v] - compMinX[v]) * (compMaxY[v] - compMinY[v]) * scMm * scMm;
        if (area > mainAreaMm2) { mainAreaMm2 = area; mainRoot = v; }
      }
      const edgeTolU = 0.25 / scMm;
      if (mainRoot >= 0 && mainAreaMm2 >= 600.0) {
        for (let v = 0; v < nv; v++) {
          if (!usedVerts[v] || find(v) !== v || v === mainRoot) continue;
          const sxMm = (compMaxX[v] - compMinX[v]) * scMm;
          const syMm = (compMaxY[v] - compMinY[v]) * scMm;
          const areaMm2 = sxMm * syMm;
          const volMm3 = Math.abs(compVolMm3[v]);
          const touchesInteriorSeam =
            interiorXsU.some(sx => compMinX[v] <= sx + edgeTolU && compMaxX[v] >= sx - edgeTolU) ||
            interiorYsU.some(sy => compMinY[v] <= sy + edgeTolU && compMaxY[v] >= sy - edgeTolU);
          if (touchesInteriorSeam) continue;
          const touchesBorder =
            compMinX[v] <= globalMinX + edgeTolU || compMaxX[v] >= globalMaxX - edgeTolU ||
            compMinY[v] <= globalMinY + edgeTolU || compMaxY[v] >= globalMaxY - edgeTolU;
          const isMicroShard = areaMm2 < 1.5 && volMm3 < 6.0;
          const isBorderSliver = touchesBorder && areaMm2 < 16.0 && Math.min(sxMm, syMm) < 3.0 && volMm3 < 65.0;
          if (isMicroShard || isBorderSliver) {
            dropComp[v] = 1;
          }
        }
      }
    }

    // Quantize surviving vertices to Float32 in mm while keeping Manifold index sharing.
    const vToId = new Int32Array(nv);
    vToId.fill(-1);
    const verts = [];
    const mmLockX = [];
    const mmLockY = [];
    const tris = [];
    let hasNegativeZClamp = false;
    for (let t = 0; t < nTri; t++) {
      const i0 = tv[t * 3];
      const i1 = tv[t * 3 + 1];
      const i2 = tv[t * 3 + 2];
      if (i0 === i1 || i1 === i2 || i2 === i0) continue;
      const rComp = find(i0);
      if (isGroundedMesh && (compMinZ[rComp] > groundThreshU || dropComp[rComp])) continue;
      const tri = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const vi = k === 0 ? i0 : (k === 1 ? i1 : i2);
        let id = vToId[vi];
        if (id < 0) {
          id = verts.length;
          vToId[vi] = id;
          const b = vi * 3;
          const xMm = Math.fround(vp[b] * scMm);
          const yMm = Math.fround(vp[b + 1] * scMm);
          let zMm = Math.fround(vp[b + 2] * scMm);
          if (isGroundedMesh && zMm < 0) {
            zMm = 0;
            hasNegativeZClamp = true;
          }
          verts.push([xMm, yMm, zMm]);
          mmLockX.push(vertLockX[vi]);
          mmLockY.push(vertLockY[vi]);
        }
        tri[k] = id;
      }
      tris.push(tri);
    }
    if (tris.length === 0) {
      if (ownsSrc) safeDeleteManifold(src);
      return [];
    }

    // Build an mm spatial grid on demand so vertex nudges never create new pinches.
    let mmGrid = null;
    const ensureMmGrid = () => {
      if (mmGrid) return mmGrid;
      mmGrid = createSpatialGrid(
        0.001,
        0.0005 * 0.0005,
        (id) => verts[id][0],
        (id) => verts[id][1],
        (id) => verts[id][2]
      );
      for (let id = 0; id < verts.length; id++) mmGrid.add(id);
      return mmGrid;
    };
    const moveVertMm = (id, nx, ny, nz) => {
      const p = verts[id];
      if (mmGrid) mmGrid.remove(id, p[0], p[1], p[2]);
      p[0] = nx;
      p[1] = ny;
      p[2] = nz;
      if (mmGrid) mmGrid.add(id);
    };

    if (hasNegativeZClamp) {
      const g = ensureMmGrid();
      for (let id = 0; id < verts.length; id++) {
        const p = verts[id];
        if (!g.hasClose(p[0], p[1], p[2], id)) continue;
        const xy = findClearSpiralXY(p[0], p[1], p[2], 0.0015, id, g, true, Boolean(mmLockX[id]), Boolean(mmLockY[id]));
        if (xy) moveVertMm(id, xy[0], xy[1], p[2]);
      }
    }

    // Build vertex -> incident triangle list so collinearity nudges never break neighbors.
    const vertTris = new Array(verts.length);
    for (let id = 0; id < verts.length; id++) vertTris[id] = [];
    for (let i = 0; i < tris.length; i++) {
      const tri = tris[i];
      if (tri[0] === tri[1] || tri[1] === tri[2] || tri[2] === tri[0]) continue;
      vertTris[tri[0]].push(i);
      vertTris[tri[1]].push(i);
      vertTris[tri[2]].push(i);
    }

    const r4 = (v) => Math.round(v * 1e4) * 1e-4;
    const originXMm = (tbMm && Number.isFinite(Number(tbMm.minX))) ? Number(tbMm.minX) : 0;
    const originYMm = (tbMm && Number.isFinite(Number(tbMm.minY))) ? Number(tbMm.minY) : 0;
    const evalTriMetrics = (p0, p1, p2) => {
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
      const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
      const wx = p2[0] - p1[0], wy = p2[1] - p1[1], wz = p2[2] - p1[2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const len2 = nx * nx + ny * ny + nz * nz;
      const e01 = ux * ux + uy * uy + uz * uz;
      const e02 = vx * vx + vy * vy + vz * vz;
      const e12 = wx * wx + wy * wy + wz * wz;
      const maxE2 = Math.max(e01, e02, e12);

      // Mirror Python VAL-01 round(p, 4) topology area2 check in exact tile-local Float32 STL coordinates.
      const r0x = r4(Math.fround(p0[0] - originXMm)), r0y = r4(Math.fround(p0[1] - originYMm)), r0z = r4(Math.fround(Math.max(0, p0[2])));
      const r1x = r4(Math.fround(p1[0] - originXMm)), r1y = r4(Math.fround(p1[1] - originYMm)), r1z = r4(Math.fround(Math.max(0, p1[2])));
      const r2x = r4(Math.fround(p2[0] - originXMm)), r2y = r4(Math.fround(p2[1] - originYMm)), r2z = r4(Math.fround(Math.max(0, p2[2])));
      const sameR4 =
        (r0x === r1x && r0y === r1y && r0z === r1z) ||
        (r1x === r2x && r1y === r2y && r1z === r2z) ||
        (r2x === r0x && r2y === r0y && r2z === r0z);
      let area2R4 = 0;
      if (!sameR4) {
        const rux = r1x - r0x, ruy = r1y - r0y, ruz = r1z - r0z;
        const rvx = r2x - r0x, rvy = r2y - r0y, rvz = r2z - r0z;
        const rnx = ruy * rvz - ruz * rvy;
        const rny = ruz * rvx - rux * rvz;
        const rnz = rux * rvy - ruy * rvx;
        area2R4 = Math.hypot(rnx, rny, rnz);
      }
      return { len2, maxE2, e01, e02, e12, area2R4, sameR4 };
    };

    const MIN_SAFE_AREA2_R4 = 5e-7; // 50x above VAL-01 area2 < 1e-8 threshold
    const MIN_SAFE_LEN2_F32 = 1e-13; // sqrt = 3.16e-7 (> 30x above 1e-8)
    const isTriHealthy = (m) =>
      !m.sameR4 && m.area2R4 >= MIN_SAFE_AREA2_R4 && m.len2 > MIN_SAFE_LEN2_F32 &&
      m.len2 > 1.6e-7 * m.maxE2;

    const evalTriWithOverride = (triIdx, ovId, tx, ty, tz) => {
      const t = tris[triIdx];
      const q0 = t[0] === ovId ? [tx, ty, tz] : verts[t[0]];
      const q1 = t[1] === ovId ? [tx, ty, tz] : verts[t[1]];
      const q2 = t[2] === ovId ? [tx, ty, tz] : verts[t[2]];
      return evalTriMetrics(q0, q1, q2);
    };

    // Repair near-collinear Float32 and round(p, 4) triangles while keeping seam/outer cut-plane vertices locked (VAL-01, VAL-09).
    for (let pass = 0; pass < 16; pass++) {
      let found = 0;
      for (let i = 0; i < tris.length; i++) {
        const tri = tris[i];
        const a = tri[0];
        const b = tri[1];
        const c = tri[2];
        if (a === b || b === c || c === a) continue;
        const p0 = verts[a];
        const p1 = verts[b];
        const p2 = verts[c];
        const curM = evalTriMetrics(p0, p1, p2);
        if (isTriHealthy(curM)) continue;

        found++;
        const g = ensureMmGrid();
        const best = (curM.e12 >= curM.e02 && curM.e12 >= curM.e01) ? 0 : (curM.e02 >= curM.e01 ? 1 : 2);
        const triIds = [a, b, c];
        const orderedCands = [0, 1, 2]
          .map(k => triIds[(best + pass + k) % 3])
          .sort((u, v) => ((mmLockX[u] ? 1 : 0) + (mmLockY[u] ? 1 : 0)) - ((mmLockX[v] ? 1 : 0) + (mmLockY[v] ? 1 : 0)));

        const stepMags = [0.0012, 0.0022, 0.0036, 0.0055, 0.0080, 0.0120];
        let applied = false;

        candLoop: for (let ci = 0; ci < orderedCands.length; ci++) {
          const cand = orderedCands[ci];
          const lx = Boolean(mmLockX[cand]);
          const ly = Boolean(mmLockY[cand]);
          const vpC = verts[cand];
          const zFree = vpC[2] > 0.05;
          const o1 = cand === a ? p1 : p0;
          const o2 = cand === c ? p1 : p2;
          const ex = o2[0] - o1[0];
          const ey = o2[1] - o1[1];
          const ez = o2[2] - o1[2];

          const dirs = [];
          const pushDir = (dx, dy, dz) => {
            if (lx) dx = 0;
            if (ly) dy = 0;
            if (!zFree) dz = 0;
            const dl = Math.hypot(dx, dy, dz);
            if (dl < 1e-9) return;
            dirs.push([dx / dl, dy / dl, dz / dl]);
          };

          if (lx && ly) {
            pushDir(0, 0, 1);
            pushDir(0, 0, -1);
          } else if (lx && !ly) {
            // Locked X plane: move strictly inside YZ plane perpendicular to opposite edge (0, ey, ez).
            pushDir(0, -ez, ey);
            pushDir(0, ez, -ey);
            pushDir(0, 0, 1);
            pushDir(0, 0, -1);
            pushDir(0, 1, 0);
            pushDir(0, -1, 0);
          } else if (!lx && ly) {
            // Locked Y plane: move strictly inside XZ plane perpendicular to opposite edge (ex, 0, ez).
            pushDir(-ez, 0, ex);
            pushDir(ez, 0, -ex);
            pushDir(0, 0, 1);
            pushDir(0, 0, -1);
            pushDir(1, 0, 0);
            pushDir(-1, 0, 0);
          } else {
            // Interior vertex: prefer XY perpendicular, then Z and axis-aligned fallbacks.
            pushDir(-ey, ex, 0);
            pushDir(ey, -ex, 0);
            pushDir(0, 0, 1);
            pushDir(0, 0, -1);
            pushDir(1, 0, 0);
            pushDir(-1, 0, 0);
            pushDir(0, 1, 0);
            pushDir(0, -1, 0);
          }

          const inc = vertTris[cand];
          for (let si = 0; si < stepMags.length; si++) {
            const mag = stepMags[si];
            for (let di = 0; di < dirs.length; di++) {
              const d = dirs[di];
              const tx = lx ? vpC[0] : Math.fround(vpC[0] + d[0] * mag);
              const ty = ly ? vpC[1] : Math.fround(vpC[1] + d[1] * mag);
              const tz = zFree ? Math.fround(Math.max(0.051, vpC[2] + d[2] * mag)) : vpC[2];
              if (tx === vpC[0] && ty === vpC[1] && tz === vpC[2]) continue;
              if (g.hasClose(tx, ty, tz, cand)) continue;

              const newM = evalTriWithOverride(i, cand, tx, ty, tz);
              if (newM.sameR4 || newM.area2R4 < MIN_SAFE_AREA2_R4 || newM.len2 <= MIN_SAFE_LEN2_F32 || newM.len2 <= 1.6e-7 * newM.maxE2) continue;

              // Ensure moving cand does not degenerate any incident triangle after round(p, 4).
              let neighborBroken = false;
              for (let ni = 0; ni < inc.length; ni++) {
                const ntIdx = inc[ni];
                if (ntIdx === i) continue;
                const nt = tris[ntIdx];
                const beforeM = evalTriMetrics(verts[nt[0]], verts[nt[1]], verts[nt[2]]);
                const afterM = evalTriWithOverride(ntIdx, cand, tx, ty, tz);
                if (!isTriHealthy(afterM)) {
                  if (isTriHealthy(beforeM)) {
                    neighborBroken = true;
                    break;
                  }
                  if (afterM.area2R4 < beforeM.area2R4) {
                    neighborBroken = true;
                    break;
                  }
                }
              }
              if (neighborBroken) continue;

              moveVertMm(cand, tx, ty, tz);
              applied = true;
              break candLoop;
            }
          }
        }
        void applied;
      }
      if (found === 0) break;
    }

    const outVerts = new Array(verts.length);
    for (let id = 0; id < verts.length; id++) {
      const p = verts[id];
      outVerts[id] = [p[0] / scMm, p[1] / scMm, p[2] / scMm];
    }

    const out = new Array(tris.length);
    for (let i = 0; i < tris.length; i++) {
      const tri = tris[i];
      const p0 = verts[tri[0]];
      const p1 = verts[tri[1]];
      const p2 = verts[tri[2]];
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
      const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz);
      if (nl >= 1e-18 && Number.isFinite(nl)) {
        nx /= nl; ny /= nl; nz /= nl;
      } else {
        nx = 0; ny = 0; nz = 1;
      }
      const o0 = outVerts[tri[0]];
      const o1 = outVerts[tri[1]];
      const o2 = outVerts[tri[2]];
      out[i] = {
        v0: [o0[0], o0[1], o0[2]],
        v1: [o1[0], o1[1], o1[2]],
        v2: [o2[0], o2[1], o2[2]],
        n: [nx, ny, nz],
        layerId: 1,
        buildingId: -1,
        tileId: tid,
        shellId: 1,
      };
    }
    if (ownsSrc) safeDeleteManifold(src);
    return out;
  }

  // Build standardized 3-Layer Build Context matching exact scene bounds & printer physics
  function createBuildContext(scene, state, options = {}) {
    ensureVendorGlobals();
    const mf = getManifoldLib();
    const cfg = root.PRINT_PHYSICS_CONFIG || {};
    const spec = (typeof root.resolveSceneScaleAndSpec === 'function')
      ? root.resolveSceneScaleAndSpec(state || {}, scene || {})
      : null;

    const halfW = (spec && spec.halfW) || (scene && scene.halfW) || 84.6;
    const halfH = (spec && spec.halfH) || (scene && scene.halfH) || 84.6;
    const totalWidthMm = (spec && spec.totalWidthMm) || (Number(state && state.bedSizeMm) || 320);
    const totalHeightMm = (spec && spec.totalHeightMm) || (Number(state && state.totalHeightMm) || totalWidthMm);
    const mToU = (spec && spec.mToU) || (scene && scene.metersToUnits) || (169.2 / 1200);
    const scaleMm = (spec && spec.scaleMm) || (Math.max(totalWidthMm, totalHeightMm) / (2 * Math.max(halfW, halfH)));
    const tileCols = Math.max(1, (state && state.tileCols) | 0 || 1);
    const tileRows = Math.max(1, (state && state.tileRows) | 0 || 1);
    const isResin = true;
    const printSpec = (spec && spec.printSpec) || {};
    const xyPixelMm = (printSpec && printSpec.xyPixelMm) || (root.MONO4_SPEC && root.MONO4_SPEC.xyPixelMm) || 0.017;
    const supportlessMode = Boolean(state && state.supportlessMode);
    const slaLaws = root.SLA_PRINT_LAWS || (typeof SLA_PRINT_LAWS !== 'undefined' ? SLA_PRINT_LAWS : null);
    const defKerfMm = printSpec.defaultKerfMm !== undefined ? printSpec.defaultKerfMm : 0.0;
    const rawKerfMm = (state && state.kerfMm !== undefined) ? Number(state.kerfMm) : defKerfMm;
    const halfKerfMm = (tileCols > 1 || tileRows > 1) ? Math.max(0, rawKerfMm * 0.5) : 0.0;
    const kerfUnits = halfKerfMm / scaleMm;

    const tileBounds = [];
    const colSpan = (2 * halfW) / tileCols;
    const rowSpan = (2 * halfH) / tileRows;
    for (let tr = 0; tr < tileRows; tr++) {
      const northRow = tileRows - tr;
      const rawMinY = -halfH + tr * rowSpan;
      const rawMaxY = (tr === tileRows - 1) ? halfH : (-halfH + (tr + 1) * rowSpan);
      for (let tc = 0; tc < tileCols; tc++) {
        const colNum = tc + 1;
        const rawMinX = -halfW + tc * colSpan;
        const rawMaxX = (tc === tileCols - 1) ? halfW : (-halfW + (tc + 1) * colSpan);
        const minX = rawMinX + (tc > 0 ? kerfUnits : 0);
        const maxX = rawMaxX - (tc < tileCols - 1 ? kerfUnits : 0);
        const minY = rawMinY + (tr > 0 ? kerfUnits : 0);
        const maxY = rawMaxY - (tr < tileRows - 1 ? kerfUnits : 0);
        tileBounds.push({
          tileId: tr * tileCols + tc,
          tr,
          tc,
          northRow,
          colNum,
          label: `R${northRow}C${colNum}`,
          rawMinX, rawMaxX, rawMinY, rawMaxY,
          minX, maxX, minY, maxY,
        });
      }
    }

    const cutXs = [];
    for (let tc = 1; tc < tileCols; tc++) cutXs.push(-halfW + tc * colSpan);
    const cutYs = [];
    for (let tr = 1; tr < tileRows; tr++) cutYs.push(-halfH + tr * rowSpan);

    const mono4Cfg = cfg.photonMono4 || {};
    const bedZMm = Number(state && state.bedZ) || mono4Cfg.bedZMm || 165.0;
    const zCapLimitMm = Math.max(10.0, bedZMm - (mono4Cfg.safeMarginZMm || 2.0));
    const zScale = Math.max(0.1, Number((state && state.zScale) ?? 1.25));
    const terrainScale = Math.max(0.1, Number((state && state.terrainScale) ?? 1.15));
    const waterCutout = Boolean(state && state.waterCutout);
    const hollowBase = Boolean(state && state.hollowBase);
    const solidBaseNoTunnels = Boolean(state && state.solidBaseNoTunnels);
    const hollowWallMm = Math.max(0.8, Number((state && state.hollowWallMm) ?? 1.8));
    const isExport = Boolean((options && options.isExport) || (state && state.isExport));
    const minFeatureMm = (printSpec && printSpec.minFeatureMm) || 0.12;
    const minPrintU = Math.max(minFeatureMm / scaleMm, 0.22 / scaleMm);
    const quantizeZUnits = (spec && spec.quantizeZUnits) ? spec.quantizeZUnits : ((z) => z);

    // Exact toBed coordinate mapping matching terrain_masks.js
    const baseCrop = (scene && scene._fetchedCropRatio) || 1.0;
    const cropBounds = (root.OSM_METRIC_CONFIG && root.OSM_METRIC_CONFIG.cropRatioBounds) || [0.22, 1.0];
    const reqCrop = (state && typeof state.cropRatio === 'number' && Number.isFinite(state.cropRatio))
      ? state.cropRatio : 0.88;
    const effectiveCrop = Math.min(cropBounds[1], Math.max(cropBounds[0], reqCrop / baseCrop));
    const cropCX = (Number(state && state.cropCenterX) || 0) * halfW;
    const cropCY = (Number(state && state.cropCenterY) || 0) * halfH;
    const scaleToBed = 1.0 / effectiveCrop;
    const toBed = (pt) => [(pt[0] - cropCX) * scaleToBed, (pt[1] - cropCY) * scaleToBed];

    // DEM elevation mapper + continuous bilinear grid lookup in rotated/cropped bed coordinates
    const dem = (scene && scene.dem) || { gridSize: 8, minElev: 0, maxElev: 0, grid: [[0, 0], [0, 0]] };
    const demGrid = Array.isArray(dem.grid) && dem.grid.length > 0 ? dem.grid : [[0, 0], [0, 0]];
    const demRows = demGrid.length;
    const demCols = Array.isArray(demGrid[0]) ? demGrid[0].length : 2;
    const demHalfU = (scene && scene._demHalfUnits) || Math.max(halfW + 0.4, halfH + 0.4);
    const hasAppliedRot = Boolean(scene && typeof scene._appliedRotationDeg === 'number');
    const rotDeg = hasAppliedRot
      ? scene._appliedRotationDeg
      : Number((scene && scene._appliedRotDeg) ?? (state && state.mapRotationDeg) ?? 0);
    const padW = halfW + 0.4;
    const padH = halfH + 0.4;
    const demResampled = hasAppliedRot && (
      rotDeg !== 0 || Math.abs(demHalfU - padW) > 0.5 || Math.abs(demHalfU - padH) > 0.5
    );
    const demSpanX = demResampled ? padW : demHalfU;
    const demSpanY = demResampled ? padH : demHalfU;

    const allElevs = [];
    for (let r = 0; r < demRows; r++) {
      for (let c = 0; c < demCols; c++) {
        const v = Number(demGrid[r][c]);
        if (Number.isFinite(v)) allElevs.push(v);
      }
    }
    allElevs.sort((a, b) => a - b);
    const rawMin = allElevs.length ? allElevs[0] : 0;
    const rawMax = allElevs.length ? allElevs[allElevs.length - 1] : 0;
    const p05 = allElevs.length ? allElevs[Math.floor(allElevs.length * 0.05)] : 0;
    const hasMarineOrWater = Boolean(
      (scene && scene._hasMarineTags) ||
      (scene && scene.waterPolys && scene.waterPolys.length > 0) ||
      (scene && scene.waterLines && scene.waterLines.length > 0)
    );
    const clampFloorM = (rawMin < -3.0 && rawMax > 1.5 && hasMarineOrWater)
      ? Math.max(-2.0, Math.min(0.0, p05 > -3.0 ? p05 : -1.5))
      : rawMin;
    const effMinElev = Math.max(clampFloorM, rawMin);
    const elevReliefM = Math.max(0, rawMax - effMinElev);

    const sampleDemElevM = (bx, by) => {
      if (!Number.isFinite(bx) || !Number.isFinite(by)) return effMinElev;
      // Uncrop bed XY back into rotated scene XY
      const sx = bx * effectiveCrop + cropCX;
      const sy = by * effectiveCrop + cropCY;
      let ux = sx, uy = sy;
      if (!hasAppliedRot && rotDeg !== 0) {
        const rad = (-rotDeg * Math.PI) / 180.0;
        const cosR = Math.cos(rad), sinR = Math.sin(rad);
        ux = sx * cosR - sy * sinR;
        uy = sx * sinR + sy * cosR;
      }
      // Note: dem.grid[0] is SOUTH (-demSpanY), dem.grid[demRows-1] is NORTH (+demSpanY)
      const fx = Math.max(0, Math.min(1, (ux + demSpanX) / (2 * demSpanX))) * (demCols - 1);
      const fy = Math.max(0, Math.min(1, (uy + demSpanY) / (2 * demSpanY))) * (demRows - 1);
      const c0 = Math.floor(fx), r0 = Math.floor(fy);
      const c1 = Math.min(demCols - 1, c0 + 1), r1 = Math.min(demRows - 1, r0 + 1);
      const tx = fx - c0, ty = fy - r0;
      const clampM = (v) => Math.max(effMinElev, Number.isFinite(v) ? v : effMinElev);
      const e00 = clampM(demGrid[r0][c0]), e10 = clampM(demGrid[r0][c1]);
      const e01 = clampM(demGrid[r1][c0]), e11 = clampM(demGrid[r1][c1]);
      return (e00 * (1 - tx) + e10 * tx) * (1 - ty) + (e01 * (1 - tx) + e11 * tx) * ty;
    };

    const defaultBaseBottomMm = cfg.baseBottomMm || 2.35;
    const baseBottomMm = (typeof root.resolveBaseBottomMm === 'function')
      ? root.resolveBaseBottomMm(state, cfg)
      : defaultBaseBottomMm;
    const baseDeltaMm = baseBottomMm - defaultBaseBottomMm;
    const deepWaterMm = Math.max(0.8, (cfg.deepWaterMm || 1.68) + baseDeltaMm);
    const subWaterMm = Math.max(0.5, (cfg.subWaterMm || 1.30) + baseDeltaMm);
    const drainVaultMm = cfg.drainVaultMm || 0.70;
    const zLandDatum = baseBottomMm / scaleMm;
    const baseThickU = zLandDatum;
    // Scale relief physically, clamping softly only when mountains would consume >42% of Z build height
    const maxTerrainUnits = (zCapLimitMm * 0.42) / scaleMm;
    const rawRelToUnits = mToU * terrainScale;
    const effTerrainMult = (elevReliefM * rawRelToUnits > maxTerrainUnits && elevReliefM > 1e-3)
      ? (maxTerrainUnits / (elevReliefM * rawRelToUnits))
      : 1.0;

    const elevToZ = (elevM) => zLandDatum + Math.max(0, elevM - effMinElev) * rawRelToUnits * effTerrainMult;
    const zWaterTop = deepWaterMm / scaleMm;
    const zWaterCarveFloor = waterCutout ? 0.0 : (subWaterMm / scaleMm);
    const zDrainVault = drainVaultMm / scaleMm;

    // Coordinate converter for raw OSM lat/lon elements -> exact current bed XY
    const centerLat = (scene && Array.isArray(scene.center) && scene.center[0]) || 0;
    const centerLon = (scene && Array.isArray(scene.center) && scene.center[1]) || 0;
    const cosLat = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180.0));
    const rawMToU = (scene && scene.metersToUnits) || mToU;
    const rotRad = (rotDeg * Math.PI) / 180.0;
    const cosRot = Math.cos(rotRad), sinRot = Math.sin(rotRad);
    const latLonToScene = (lat, lon) => {
      const xm = (lon - centerLon) * 111320.0 * cosLat;
      const ym = (lat - centerLat) * 111320.0;
      const ux = xm * rawMToU;
      const uy = ym * rawMToU;
      const rx = rotDeg === 0 ? ux : (ux * cosRot - uy * sinRot);
      const ry = rotDeg === 0 ? uy : (ux * sinRot + uy * cosRot);
      return toBed([rx, ry]);
    };

    const pickIdMap = new Map();
    let nextPickId = 1;
    const allocPickId = (info = null) => {
      const id = nextPickId++;
      if (info) {
        pickIdMap.set(id, {
          ...info,
          id: info.id !== undefined ? info.id : info.buildingId,
        });
      }
      return id;
    };

    return {
      mf,
      scene,
      state: state || {},
      options,
      spec,
      cfg,
      halfW,
      halfH,
      totalWidthMm,
      totalHeightMm,
      mToU,
      rawMToU,
      scaleMm,
      minPrintU,
      tileCols,
      tileRows,
      tileBounds,
      cutXs,
      cutYs,
      bedZMm,
      zCapLimitMm,
      maxZUnits: zCapLimitMm / scaleMm,
      zScale,
      terrainScale,
      kerfMm: rawKerfMm,
      kerfUnits,
      effectiveCrop,
      cropCX,
      cropCY,
      scaleToBed,
      toBed,
      waterCutout,
      hollowBase,
      solidBaseNoTunnels,
      baseBottomMm,
      hollowWallMm,
      isExport,
      isResin,
      xyPixelMm,
      supportlessMode,
      slaLaws,
      rotDeg,
      baseThickU,
      baseBottomZ: 0.0,
      zLandDatum,
      zWaterTop,
      zSubWater: zWaterCarveFloor,
      zWaterCarveFloor,
      zDrainVault,
      effMinElev,
      rawMaxElev: rawMax,
      elevReliefM,
      sampleDemElevM,
      elevToZ,
      getTerrainZ: (x, y) => elevToZ(sampleDemElevM(x, y)),
      latLonToScene,
      quantizeZUnits,
      pickIdMap,
      allocPickId,
      audit: {
        osmElements: (scene && scene.osmElements) || [],
        preparedList: [],
        s3dbAllFinalBuildings: [],
        bridgeAudits: [],
        archetypeCounts: {},
        invariants: null,
      },
    };
  }

  const exportsObj = {
    getManifoldLib,
    ensureManifoldLibAsync,
    getVendorDeps,
    CLIPPER_SCALE,
    signedArea2D,
    ensureWinding,
    clipperUnionPolys,
    clipperIntersectPolys,
    clipperDiffPolys,
    clipperOffsetPolys,
    clipperBufferOpenPaths,
    ringsToOutersWithHoles,
    safeDeleteManifold,
    batchUnionManifolds,
    extrudeRingSolid,
    manifoldFromRawSoup,
    trianglesToShellManifolds,
    boxManifoldFromBounds,
    beamManifoldBetween,
    appendManifoldToTriangles,
    appendManifoldComponentsToTriangles,
    extractDePinchedStlTriangles,
    createBuildContext,
  };

  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
